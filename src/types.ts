export interface SessionStartRequest {
  mode: string;
  personas: Array<{ id: string; view?: string }>;
  device?: {
    kind?: string;
    user_agent?: string;
    lang?: string;
    timezone?: string;
  };
}

export interface SessionStartResponse {
  session_id: string;
  token: string;
  ttl_s: number;
  mode: string;
  personas: Array<{ id: string; view?: string }>;
}

export interface TurnRequestBody {
  audio_url?: string;
  transcript?: { text: string; lang?: string };
  transcript_hint?: string;
  persona_id: string;
  session_id?: string;
}

export interface TurnResponseBody {
  request_id: string;
  status: "accepted";
  policy: { pair_audio_only: boolean };
  fixture_id: string;
}

export interface FixtureDefinition {
  id: string;
  persona_id: string;
  title?: string;
  tags?: string[];
  timeline_path: string;
  swap_enabled?: boolean;
  share_enabled?: boolean;
  sources_badge?: boolean;
  idle_after_ms?: number;
}

export interface FixtureManifest {
  fixtures: FixtureDefinition[];
  personas?: Record<string, { default_fixture_id?: string }>;
  homefeed?: HomefeedResponse;
}

export interface TimelineTrack {
  type: string;
  id: string;
  source: Record<string, unknown>;
  offset?: number;
  duration?: number;
  marks?: Record<string, unknown>;
}

export interface TimelineSwapPoint {
  at: number;
  replace: string;
  with: Record<string, unknown>;
}

export interface TimelineSidecar {
  sentences?: Array<Record<string, unknown>>;
  citation_map?: Record<string, string>;
  pair_policy?: Record<string, unknown>;
}

export interface TimelineShareRef {
  id: string;
  ttl_s: number;
  poster?: string;
  expires_at?: string;
}

export interface TimelineV1 {
  version: string;
  clock: string;
  start_at: string;
  sources_badge?: boolean;
  tracks: TimelineTrack[];
  swap_points?: TimelineSwapPoint[];
  sidecar?: TimelineSidecar;
  share_ref?: TimelineShareRef | null;
  meta?: Record<string, unknown>;
}

export interface LoadedFixture extends FixtureDefinition {
  timeline: TimelineV1;
}

export interface HomefeedCard {
  kind: string;
  label: string;
  [key: string]: unknown;
}

export interface HomefeedRow {
  id: string;
  title: string;
  cards: HomefeedCard[];
}

export interface HomefeedResponse {
  schema: string;
  rows: HomefeedRow[];
}

export interface SessionRecord {
  id: string;
  token: string;
  mode: string;
  personas: Array<{ id: string; view?: string }>;
  createdAt: number;
  expiresAt: number;
}

export interface TurnCacheEntry {
  requestId: string;
  fixtureId: string;
  createdAt: number;
  expiresAt: number;
  bodyHash: string;
  timeline: TimelineV1;
  personaId: string;
  idempotencyKey: string;
  miss?: { tts?: boolean; clip?: boolean };
  latencyMs: { audio: number; clip: number };
}

export interface IdempotencyResult {
  entry: TurnCacheEntry;
  reused: boolean;
}

export interface BackoffConfig {
  sequenceMs: number[];
}
