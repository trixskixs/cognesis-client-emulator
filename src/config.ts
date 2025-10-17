import path from "path";
import pkg from "../package.json";

const SESSION_TTL_SECONDS = 1800; // 30 minutes
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const DEFAULT_SIGNED_TTL_SECONDS = 300;

function envFlag(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) {
    return defaultValue;
  }
  const lower = raw.toLowerCase();
  if (raw === "0" || lower === "false" || lower === "no") {
    return false;
  }
  if (raw === "1" || lower === "true" || lower === "yes") {
    return true;
  }
  return defaultValue;
}

function envNumber(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseCsv(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseArgValue(flag: string): string | undefined {
  const prefix = `${flag}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === flag) {
      const next = process.argv[index + 1];
      if (next && !next.startsWith("--")) {
        return next;
      }
    }
  }
  return undefined;
}

export interface EmulatorConfig {
  version: string;
  port: number;
  corsOrigins: string[];
  pairAudioOnly: boolean;
  sseHeartbeatSec: number;
  sseBackoffSequenceMs: number[];
  latency: { tts: number; clip: number; jitter: number };
  missPct: { tts: number; clip: number };
  swapEnabled: boolean;
  shareEnabled: boolean;
  shareTtlMinutes: number;
  signedUrlTtlSeconds: number;
  fixturesPath: string;
  fixtureMapPath?: string;
  mediaRoot: string;
  sessionTtlSeconds: number;
  idempotencyTtlSeconds: number;
}

const defaultFixturesPath = path.resolve(
  process.cwd(),
  parseArgValue("--fixtures") ?? parseArgValue("-f") ?? "fixtures",
);
const fixtureMapPath = process.env.EMU_FIXTURE_MAP ?? parseArgValue("--fixture-map");

const backoffSequence = parseCsv(process.env.EMU_SSE_BACKOFF_SEQUENCE_MS)
  .map((value) => Number(value))
  .filter((value) => Number.isFinite(value));

export const config: EmulatorConfig = {
  version: pkg.version ?? "0.0.0",
  port: envNumber("PORT", 8080),
  corsOrigins: parseCsv(process.env.EMU_CORS_ORIGINS),
  pairAudioOnly: envFlag("EMU_PAIR_AUDIO_ONLY", true),
  sseHeartbeatSec: envNumber("EMU_SSE_HEARTBEAT_SEC", 15),
  sseBackoffSequenceMs: backoffSequence.length > 0 ? backoffSequence : [1000, 3000, 5000, 10000],
  latency: {
    tts: envNumber("EMU_LATENCY_TTS_MS", 600),
    clip: envNumber("EMU_LATENCY_CLIP_MS", 1200),
    jitter: Math.max(0, envNumber("EMU_LATENCY_JITTER_MS", 300)),
  },
  missPct: {
    tts: Math.min(Math.max(envNumber("EMU_MISS_TTS_PCT", 0), 0), 100),
    clip: Math.min(Math.max(envNumber("EMU_MISS_CLIP_PCT", 0), 0), 100),
  },
  swapEnabled: envFlag("EMU_SWAP_ENABLED", true),
  shareEnabled: envFlag("EMU_SHARE_ENABLED", true),
  shareTtlMinutes: Math.max(envNumber("EMU_SHARE_TTL_MIN", 10), 1),
  signedUrlTtlSeconds: envNumber("EMU_SIGNED_TTL_SECONDS", DEFAULT_SIGNED_TTL_SECONDS),
  fixturesPath: defaultFixturesPath,
  fixtureMapPath: fixtureMapPath ? path.resolve(process.cwd(), fixtureMapPath) : undefined,
  mediaRoot: path.resolve(process.cwd(), "media"),
  sessionTtlSeconds: SESSION_TTL_SECONDS,
  idempotencyTtlSeconds: IDEMPOTENCY_TTL_SECONDS,
};

export function toBackoffConfig(): { sequence_ms: number[] } {
  return { sequence_ms: config.sseBackoffSequenceMs };
}

export default config;
