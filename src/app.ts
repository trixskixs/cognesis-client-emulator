import cors from "cors";
import express, { Request, Response } from "express";
import fs from "fs/promises";
import mime from "mime-types";
import path from "path";
import { randomUUID } from "crypto";
import config from "./config";
import FixtureRegistry from "./fixtures";
import { sessionStore } from "./sessionStore";
import { sseHub } from "./sse";
import { signMediaPath } from "./signing";
import { getMetrics, shareCounter, turnCounter } from "./metrics";
import {
  HomefeedResponse,
  LoadedFixture,
  SessionStartRequest,
  SessionStartResponse,
  TimelineV1,
  TurnCacheEntry,
  TurnRequestBody,
  TurnResponseBody,
} from "./types";
import { minutesFromNow, percentToHit, sanitizeMediaPath, withJitter } from "./utils";
import { z } from "zod";

const sessionStartSchema = z.object({
  mode: z.string(),
  personas: z.array(z.object({
    id: z.string(),
    view: z.string().optional(),
  })).min(1),
  device: z
    .object({
      kind: z.string().optional(),
      user_agent: z.string().optional(),
      lang: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
});

const turnSchema = z
  .object({
    audio_url: z.string().url().optional(),
    transcript: z
      .object({
        text: z.string().min(1),
        lang: z.string().optional(),
      })
      .optional(),
    transcript_hint: z.string().optional(),
    persona_id: z.string(),
    session_id: z.string().optional(),
  })
  .refine((val) => !!val.audio_url || !!val.transcript, {
    message: "audio_url or transcript is required",
  });

function extractSessionId(req: Request, body: Partial<TurnRequestBody>): string | undefined {
  if (typeof req.query.session_id === "string") {
    return req.query.session_id;
  }
  if (body.session_id) {
    return body.session_id;
  }
  const header = req.get("x-session-id");
  if (header) {
    return header;
  }
  const auth = req.get("authorization");
  if (auth) {
    const parts = auth.split(" ");
    if (parts.length === 2) {
      return parts[1];
    }
    return auth;
  }
  return undefined;
}

function cloneTimeline(source: TimelineV1): TimelineV1 {
  return JSON.parse(JSON.stringify(source));
}

function estimateTimelineDurationMs(timeline: TimelineV1): number {
  const durations = timeline.tracks
    .map((track) => ((track.offset ?? 0) + (track.duration ?? 0)) * 1000)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (durations.length === 0) {
    return 4000;
  }
  return Math.max(...durations);
}

function applyFixtureToggles(
  fixture: LoadedFixture,
  miss: { tts?: boolean; clip?: boolean },
): TimelineV1 {
  const timeline = cloneTimeline(fixture.timeline);
  timeline.meta = timeline.meta ?? {};
  const idleMs = fixture.idle_after_ms ?? timeline.meta.stage_idle_after_ms ?? estimateTimelineDurationMs(timeline);
  timeline.meta.fixture_id = fixture.id;
  timeline.meta.stage_idle_after_ms = idleMs;

  if (!config.swapEnabled || fixture.swap_enabled === false) {
    timeline.swap_points = [];
  }

  if (!config.shareEnabled || fixture.share_enabled === false) {
    timeline.share_ref = null;
  } else if (timeline.share_ref) {
    const ttlSeconds = config.shareTtlMinutes * 60;
    timeline.share_ref.ttl_s = ttlSeconds;
    timeline.share_ref.expires_at = minutesFromNow(config.shareTtlMinutes).toISOString();
  }

  if (miss.clip) {
    timeline.tracks = timeline.tracks.filter((track) => track.type !== "video");
    timeline.swap_points = [];
    timeline.meta.miss_clip = true;
  }

  if (miss.tts) {
    timeline.meta.miss_tts = true;
  }

  if (config.pairAudioOnly) {
    timeline.meta.pair_audio_only = true;
  }

  return timeline;
}

function sendError(res: Response, status: number, code: string, message?: string): void {
  res.status(status).json({ error: code, message });
}

function buildCorsOptions(): cors.CorsOptions {
  if (config.corsOrigins.length === 0) {
    return {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    };
  }
  return {
    origin: config.corsOrigins,
    credentials: true,
  };
}

async function resolveMediaFile(relative: string): Promise<string> {
  const clean = sanitizeMediaPath(relative);
  const candidate = path.resolve(config.mediaRoot, clean);
  const root = path.resolve(config.mediaRoot);
  if (!candidate.startsWith(root)) {
    throw new Error("MEDIA_FORBIDDEN");
  }
  const stats = await fs.stat(candidate);
  if (!stats.isFile()) {
    throw new Error("MEDIA_NOT_FILE");
  }
  return candidate;
}

export interface AppDependencies {
  fixtureRegistry: FixtureRegistry;
}

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  const { fixtureRegistry } = dependencies;

  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: "1mb" }));

  app.post("/v1/session/start", (req, res) => {
    const parseResult = sessionStartSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "EMU_BAD_REQUEST", parseResult.error.message);
      return;
    }
    const payload = parseResult.data as SessionStartRequest;
    const sessionId = `sess_${randomUUID()}`;
    const session: SessionStartResponse = {
      session_id: sessionId,
      token: sessionId,
      ttl_s: config.sessionTtlSeconds,
      mode: payload.mode,
      personas: payload.personas,
    };
    sessionStore.createSession({
      id: session.session_id,
      token: session.token,
      mode: session.mode,
      personas: session.personas,
    });
    res.json(session);
  });

  app.post("/v1/session/turn", async (req, res) => {
    const idempotencyKey = req.get("idempotency-key");
    if (!idempotencyKey) {
      sendError(res, 400, "EMU_BAD_REQUEST", "Idempotency-Key header is required");
      return;
    }

    const parseResult = turnSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "EMU_BAD_REQUEST", parseResult.error.message);
      return;
    }
    const payload = parseResult.data as TurnRequestBody;
    const sessionId = `sess_${randomUUID()}`;
    if (!sessionId) {
      sendError(res, 400, "EMU_BAD_REQUEST", "session_id is required");
      return;
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      sendError(res, 404, "EMU_SESSION_UNKNOWN", "Session not found or expired");
      return;
    }

    const discriminator = payload.transcript?.text ?? payload.audio_url ?? payload.transcript_hint ?? payload.persona_id;

    let fixture: LoadedFixture;
    try {
      fixture = fixtureRegistry.selectFixture(payload.persona_id, discriminator);
    } catch (error) {
      sendError(res, 503, "EMU_FIXTURE_MISSING", (error as Error).message);
      return;
    }

    const miss = {
      tts: percentToHit(config.missPct.tts),
      clip: percentToHit(config.missPct.clip),
    };

    const timeline = applyFixtureToggles(fixture, miss);
    const requestId = `req_${randomUUID()}`;
    const entryData: Omit<TurnCacheEntry, "idempotencyKey" | "createdAt" | "expiresAt" | "bodyHash"> = {
      requestId,
      fixtureId: fixture.id,
      timeline,
      personaId: payload.persona_id,
      miss,
      latencyMs: {
        audio: withJitter(config.latency.tts, config.latency.jitter),
        clip: withJitter(config.latency.clip, config.latency.jitter),
      },
    };

    let result: { entry: TurnCacheEntry; reused: boolean };
    try {
      result = sessionStore.putTurn(sessionId, idempotencyKey, payload, entryData);
    } catch (error) {
      if ((error as Error & { code?: string }).code === "IDEMPOTENCY_BODY_MISMATCH") {
        sendError(res, 409, "EMU_IDEMPOTENCY_REPLAY", "Payload does not match cached turn for this key");
        return;
      }
      sendError(res, 500, "EMU_INTERNAL_ERROR", (error as Error).message);
      return;
    }

    const { entry, reused } = result;
    if (!reused) {
      turnCounter.inc({ fixture_id: entry.fixtureId });
      sessionStore.enqueueTurn(sessionId, entry);
      if (entry.timeline.share_ref) {
        shareCounter.inc({ status: "issued" });
        setTimeout(() => {
          shareCounter.inc({ status: "expired" });
        }, entry.timeline.share_ref.ttl_s * 1000);
      }
      if (sseHub.hasClients(sessionId)) {
        const pending = sessionStore.takePendingTurns(sessionId);
        sseHub.broadcastTurns(sessionId, pending);
      }
    }

    const response: TurnResponseBody = {
      request_id: entry.requestId,
      status: "accepted",
      policy: { pair_audio_only: config.pairAudioOnly },
      fixture_id: entry.fixtureId,
    };
    res.json(response);
  });

  app.get("/v1/sse/turn", (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const sessionId = typeof q.session_id === "string" ? q.session_id : undefined;
    if (!sessionId) {
      sendError(res, 400, "EMU_BAD_REQUEST", "session_id query parameter required");
      return;
    }
    const session = sessionStore.getSession(sessionId);
    if (!session) {
      sendError(res, 404, "EMU_SESSION_UNKNOWN", "Session not found or expired");
      return;
    }

    sseHub.addClient(sessionId, res);
    const pending = sessionStore.takePendingTurns(sessionId);
    sseHub.broadcastTurns(sessionId, pending);
  });

  app.post("/v1/media/sign", async (req, res) => {
    const pathRequest = req.body?.path;
    if (typeof pathRequest !== "string") {
      sendError(res, 400, "EMU_BAD_REQUEST", "path is required");
      return;
    }
    try {
      const signed = await signMediaPath(pathRequest);
      res.json(signed);
    } catch (error) {
      sendError(res, 404, "EMU_MEDIA_NOT_FOUND", (error as Error).message);
    }
  });

  app.get("/v1/homefeed", (_req, res) => {
    const homefeed = fixtureRegistry.getHomefeed();
    if (!homefeed) {
      res.json({ schema: "homefeed_row_contract_v1.0.0", rows: [] } satisfies HomefeedResponse);
      return;
    }
    res.json(homefeed);
  });

  app.get("/media/*", async (req, res) => {
    const params = req.params as Record<string, string | undefined>;
    const relative = params["0"];
    if (typeof relative !== "string") {
      sendError(res, 400, "EMU_BAD_REQUEST", "Invalid media path");
      return;
    }
    try {
      const absolute = await resolveMediaFile(relative);
      const type = mime.lookup(absolute) || "application/octet-stream";
      res.type(type);
      res.sendFile(absolute, (err) => {
        if (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 500;
          if (!res.headersSent) {
            sendError(res, status, "EMU_MEDIA_STREAM_ERROR", err.message);
          } else {
            res.end();
          }
          return;
        }
        if (relative.startsWith("share/")) {
          shareCounter.inc({ status: "hit" });
        }
      });
    } catch (error) {
      // If a figure manifest is missing, serve an empty JSON array to keep dev UX clean
      if (/^figures\/[^/]+\/manifests\/(stills|scenes|clips)\.json$/.test(relative)) {
        res.type("application/json").send("[]");
        return;
      }
      sendError(res, 404, "EMU_MEDIA_NOT_FOUND", (error as Error).message);
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, version: config.version, uptime_s: Math.round(process.uptime()) });
  });

  app.get("/ready", (_req, res) => {
    res.json({
      ok: true,
      toggles: {
        pair_audio_only: config.pairAudioOnly,
        swap_enabled: config.swapEnabled,
        share_enabled: config.shareEnabled,
        miss_pct: config.missPct,
      },
      fixtures: {
        count: fixtureRegistry.getFixtureCount(),
      },
      sse_clients: sseHub.totalClients(),
      backoff_sequence_ms: config.sseBackoffSequenceMs,
    });
  });

  app.get("/metrics", async (_req, res) => {
    const metrics = await getMetrics();
    res.type("text/plain").send(metrics);
  });

  return app;
}
















