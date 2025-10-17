# AGENTS.md — Cognesis Orchestrator Emulator (CLIENTS/emulator)

This guide is for agents maintaining or extending the local Orchestrator Emulator. It summarizes scope, contracts, layout, run/debug, and the sharp edges you’re likely to hit.

## What This Is
- A local/dev drop-in for the public Orchestrator surface so clients (web/Android/TV) can be built in parallel with server work.
- Authoritative spec: `design_docs/clients/orchestrator_emulator_spec_v1.0.1.md`.
- No downstream calls; everything is deterministic playback of fixtures + static media.

## Architecture (High-Level)
- HTTP server (Express) with:
  - Session & turn endpoints, idempotency cache, and a per-session SSE hub.
  - Static media server with explicit MIME handling.
  - Health/ready/metrics endpoints for uniform ops.
- In-memory stores only (sessions, idempotency, pending turns). Restart clears state.

```
client ? POST /v1/session/start ? sessionStore
client ? POST /v1/session/turn   ? sessionStore (idempotency) ? sseHub.enqueue
client ? GET  /v1/sse/turn?session_id=…  ? sseHub (heartbeat/turn/timeline/swap/idle)
client ? GET  /v1/homefeed                ? fixtures.manifest.homefeed
client ? GET  /media/*                    ? static files
```

## Directory Map
- `src/`
  - `server.ts` entrypoint (http + shutdown hooks).
  - `app.ts` route handlers & JSON schemas (zod).
  - `config.ts` environment toggles + CLI flags.
  - `fixtures.ts` manifest loader + deterministic selection + overrides.
  - `sessionStore.ts` sessions + idempotency + pending turns.
  - `sse.ts` SSE hub (clients, timers, scheduling, heartbeats).
  - `signing.ts` mock presigner for dev GET URLs.
  - `metrics.ts` Prometheus registry & metrics.
  - `types.ts`, `utils.ts` helpers.
- `fixtures/manifest.json` - homefeed + fixture catalogue.
- `fixtures/timelines/*.json` — Timeline v1 payloads.
- `media/` - audio/video/captions/share images + figure manifests (`media/figures/<id>/manifests/*.json`).
- `tests/` - small unit tests (utils/session store/fixtures).

## Catalog & Homefeed
- Homefeed rows are curated for breadth and recognition. Current rows (IDs):
  - `gallery_featured`, `us_presidents`, `uk_monarchs`, `scientists_inventors`, `philosophers`, `fictional`,
    `ancient_world`, `renaissance_invention`, `science_greats`, `wars_strategy`, `leadership`, `women_history`, `kids`, `companion_edu`.
- Each card supports: `figure_id`, `display_name`, `category`, optional `summary`, and `preview.url` (prefer local `http://localhost:8080/media/share/*.jpg`).
- Personas: every `figure_id` in homefeed should exist under `personas` with a `default_fixture_id`. Dev default is the Socrates timeline (`fx_socrates_opening_01`).
- Manifests: client prefetches `media/figures/<id>/manifests/{stills,scenes,clips}.json` opportunistically. Stubs are optional (fetch is tolerant), but adding empty arrays reduces console noise.

Authoring tips:
- Add new rows/cards in `fixtures/manifest.json` and keep copy short and neutral (avoid IP-sensitive claims).
- Reuse preview posters to avoid 404s until artwork lands.
- If you add new `figure_id`s, mirror them into `personas`.

## Contracts (Authoritative)
- Session start (dev only):
```json
POST /v1/session/start
{
  "mode": "portrait_chat",
  "personas": [{"id": "socrates", "view": "bust"}],
  "device": {"kind": "browser", "user_agent": "<ua>", "lang": "en-US", "timezone": "America/Los_Angeles"}
}
? 200 {"session_id":"sess_…","token":"sess_…","ttl_s":1800, "mode":"portrait_chat", "personas":[…]}
```
- Turn (idempotent): `Idempotency-Key` required; same session+key returns same `{request_id, fixture_id}`.
- SSE events (ordered): `heartbeat` ? `turn_started` ? `timeline` ? optional `swap` ? `stage.play_idle`.
- Homefeed (this emulator’s schema to support the web client):
```json
GET /v1/homefeed
{
  "schema": "homefeed_row_contract_v1.0.0",
  "rows": [
    {
      "row_id": "gallery_featured",
      "category": "Featured",
      "figure_cards": [
        {"figure_id":"socrates","display_name":"Socrates","category":"Philosophy","preview":{"url":"http://localhost:8080/media/share/socrates_poster.jpg"}}
      ]
    }
  ]
}
```
- Media signing (dev GETs only): `{ "path": "/media/tts/tts_socrates_hello.wav" } ? { "signed_url": "http://localhost:8080/media/…?sig=dev&ttl=300", "ttl":300, "etag":"\"abc123\"" }`.

## Timeline / Scheduling
- Audio is the clock; `timeline.tracks` offsets/durations define playback; `swap_points` may trigger b-roll.
- Latency model: `effective = base + uniform(±jitter)` per phase (`audio`, `clip`).
- MISS model: when toggled, video track is omitted/delayed; audio/idle still proceed.

## Config & Toggles (dev)
- Common envs: `PORT`, `EMU_SSE_HEARTBEAT_SEC`, `EMU_LATENCY_*`, `EMU_MISS_*_PCT`, `EMU_SWAP_ENABLED`, `EMU_SHARE_ENABLED`, `EMU_SHARE_TTL_MIN`, `EMU_SIGNED_TTL_SECONDS`, `EMU_CORS_ORIGINS`.
- CLI: `--fixtures=path` to point at an alternate manifest/timelines folder; `EMU_FIXTURE_MAP` path to overrides JSON.

## Run & Debug
- Dev: `npm install && npm run dev` (default `http://localhost:8080`).
- Build: `npm run build` ? `npm start`.
- Smoke:
  - `curl -s -X POST :8080/v1/session/start -H 'content-type: application/json' -d '{"mode":"portrait_chat","personas":[{"id":"socrates"}],"device":{"kind":"browser"}}'`
  - `curl -N 'http://localhost:8080/v1/sse/turn?session_id=<sess>'`
  - `curl :8080/v1/homefeed`
  - `curl :8080/metrics`

## Fixtures & Homefeed
- Edit `fixtures/manifest.json` to add rows and preview URLs (prefer local `http://localhost:8080/media/share/*.jpg`).
- Add per-figure stub manifests under `media/figures/<figure>/manifests/{stills,scenes,clips}.json` to unblock client prefetch.
- Deterministic selection ties transcript/audio to fixture via hashing; you can override with `EMU_FIXTURE_MAP` (e.g., `"socrates::*": "fx_socrates_s2_virtue"`).

## Observability
- `GET /metrics` exposes: `emu_turns_total{fixture_id}`, `emu_miss_total{kind}`, `emu_sse_clients`, `emu_latency_ms{phase}`.
- Ready probe: `GET /ready` returns toggle snapshot, fixture counts, SSE client count.

## Troubleshooting
- 400 EMU_BAD_REQUEST — check JSON schema for required fields.
- 409 EMU_IDEMPOTENCY_REPLAY — same idempotency key with different body; keep request body identical or rotate key.
- 503 EMU_FIXTURE_MISSING — fixture id referenced but not found; update `manifest.json` or timelines.
- Media 404 — ensure path under `media/` exists and MIME is correct; URLs should not contain `..`.
- CORS — defaults allow localhost; set `EMU_CORS_ORIGINS` if needed.

## Coding Standards
- TypeScript strict, Node 18+. Keep handlers cohesive and pure where possible.
- Avoid renaming public routes without updating the design doc and the web client.
- Keep SSE payloads backward compatible; introduce new fields behind toggles.

## PR Checklist
- Contracts unchanged or spec updated.
- Added/updated fixtures and media previews.
- Smoke tested: session start, turn + SSE, homefeed, media.
- Metrics include any new counters/gauges/histograms as needed.
- Documented toggles/assumptions in this file if behavior changed.

