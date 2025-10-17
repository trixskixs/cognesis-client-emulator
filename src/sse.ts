import { Response } from "express";
import config from "./config";
import { latencyHistogram, missCounter, sseGauge } from "./metrics";
import { TurnCacheEntry } from "./types";
import { isoTimestamp } from "./utils";

interface ManagedClient {
  sessionId: string;
  res: Response;
  heartbeat?: NodeJS.Timeout;
  timers: NodeJS.Timeout[];
  closed: boolean;
}

function computeTimelineDuration(entry: TurnCacheEntry): number {
  const durations = entry.timeline.tracks
    .map((track) => ((track.offset ?? 0) + (track.duration ?? 0)) * 1000)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (durations.length === 0) {
    const shareTtl = entry.timeline.share_ref?.ttl_s;
    if (shareTtl) {
      return shareTtl * 1000;
    }
    return 4000;
  }
  return Math.max(...durations);
}

function writeEvent(client: ManagedClient, event: string, data: unknown): void {
  if (client.closed) {
    return;
  }
  client.res.write(`event: ${event}\n`);
  client.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeMessage(client: ManagedClient, data: unknown): void {
  if (client.closed) {
    return;
  }
  client.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeRetry(client: ManagedClient, retryMs: number): void {
  client.res.write(`retry: ${retryMs}\n\n`);
}

function clearTimers(client: ManagedClient): void {
  if (client.heartbeat) {
    clearInterval(client.heartbeat);
  }
  for (const timer of client.timers) {
    clearTimeout(timer);
  }
  client.timers = [];
}

export class SseHub {
  private clients = new Map<string, Set<ManagedClient>>();

  hasClients(sessionId: string): boolean {
    const set = this.clients.get(sessionId);
    return !!set && set.size > 0;
  }

  totalClients(): number {
    return this.countClients();
  }

  addClient(sessionId: string, res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const client: ManagedClient = {
      sessionId,
      res,
      timers: [],
      closed: false,
    };

    client.heartbeat = setInterval(() => {
      writeEvent(client, "heartbeat", { t: isoTimestamp() });
    }, config.sseHeartbeatSec * 1000);

    if (!this.clients.has(sessionId)) {
      this.clients.set(sessionId, new Set());
    }
    this.clients.get(sessionId)!.add(client);
    sseGauge.set(this.countClients());

    writeRetry(client, config.sseBackoffSequenceMs[0] ?? 1000);
    writeEvent(client, "sse_backoff", { sequence_ms: config.sseBackoffSequenceMs });

    res.on("close", () => this.removeClient(sessionId, client));
  }

  removeClient(sessionId: string, client: ManagedClient): void {
    if (client.closed) {
      return;
    }
    client.closed = true;
    clearTimers(client);

    const set = this.clients.get(sessionId);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        this.clients.delete(sessionId);
      }
    }
    sseGauge.set(this.countClients());
  }

  broadcastTurns(sessionId: string, turns: TurnCacheEntry[]): void {
    if (turns.length === 0) {
      return;
    }
    const targets = this.clients.get(sessionId);
    if (!targets || targets.size === 0) {
      return;
    }

    for (const entry of turns) {
      for (const client of targets) {
        this.dispatchTurn(client, entry);
      }
    }
  }

  private dispatchTurn(client: ManagedClient, entry: TurnCacheEntry): void {
    if (entry.miss?.tts) {
      missCounter.inc({ kind: "tts" });
      writeEvent(client, "miss", { kind: "tts", request_id: entry.requestId });
    }
    if (entry.miss?.clip) {
      missCounter.inc({ kind: "clip" });
      writeEvent(client, "miss", { kind: "clip", request_id: entry.requestId });
    }

    writeMessage(client, { stage: { type: "stage.stop_idle", payload: { reason: "new_turn" } } });

    const audioTimer = setTimeout(() => {
      latencyHistogram.observe({ phase: "audio" }, entry.latencyMs.audio);
      // Map emulator timeline to client envelope
      const t = entry.timeline as any;
      const tracks = (t.tracks ?? []).map((track: any) => {
        const raw = track?.source?.url ?? track?.url ?? "";
        let url = raw;
        if (typeof raw === "string" && !/^https?:\/\//i.test(raw)) {
          // Strip leading '/media/' so client resolver doesn't duplicate the segment
          url = raw.startsWith("/media/") ? raw.slice(7) : (raw.startsWith("/") ? raw.slice(1) : raw);
        }
        const kind = track?.type === "audio" ? "audio" : track?.type === "video" ? "video" : (track?.type ?? "unknown");
        const mime_type = kind === "audio"
          ? "audio/wav"
          : kind === "video"
          ? "video/mp4"
          : kind === "captions" ? "text/vtt" : "application/octet-stream";
        return { kind, url, mime_type };
      });
      const swap_points = (t.swap_points ?? []).map((sp: any) => ({ t_ms: Math.round(((sp?.at ?? 0) as number) * 1000) }));
      writeMessage(client, {
        timeline: {
          turn_id: entry.requestId,
          session_id: client.sessionId,
          swap_points,
          tracks,
          sidecar: t.sidecar ?? null,
          sources_badge: Boolean(t.sources_badge),
          citations_ref: t.citations_ref ?? null,
          share_ref: t.share_ref ?? null,
        }
      });
    }, entry.latencyMs.audio);
    client.timers.push(audioTimer);

    if (entry.timeline.swap_points && entry.timeline.swap_points.length > 0) {
      const swapTimer = setTimeout(() => {
        latencyHistogram.observe({ phase: "clip" }, entry.latencyMs.clip);
        // Optional swap notification as a stage hint
        writeMessage(client, { stage_hints: { swap_points: entry.timeline.swap_points } });
      }, entry.latencyMs.clip);
      client.timers.push(swapTimer);
    }

    const stageIdle = (entry.timeline.meta as { stage_idle_after_ms?: unknown } | undefined)?.stage_idle_after_ms;
    const idleAfterMs = typeof stageIdle === "number" ? stageIdle : computeTimelineDuration(entry);
    const idleTimer = setTimeout(() => {
      // Offer a persona-local stage media path the client can resolve
      const personaStage = `figures/${entry.personaId}/stage.mp4`;
      writeMessage(client, { stage: { type: "stage.play_idle", payload: { after_ms: idleAfterMs, media_url: personaStage } } });
    }, entry.latencyMs.audio + idleAfterMs);
    client.timers.push(idleTimer);
  }

  private countClients(): number {
    let total = 0;
    for (const set of this.clients.values()) {
      total += set.size;
    }
    return total;
  }
}

export const sseHub = new SseHub();

