# Orchestrator Emulator

Local emulator for the Orchestrator public API so web, Android, and TV clients can integrate against stable fixtures while the real control plane evolves. The implementation follows design_docs/clients/orchestrator_emulator_spec_v1.0.1.md.

## Getting Started

`ash
npm install
npm run dev   # starts with tsx watcher
# or build + run compiled output
npm run build
npm start
`

The service listens on http://localhost:8080 by default. Override the port with PORT=<value>.

## Endpoints

- POST /v1/session/start
- POST /v1/session/turn
- GET /v1/sse/turn?session_id=<id>
- POST /v1/media/sign
- GET /v1/homefeed
- GET /media/<path>
- GET /health, GET /ready, GET /metrics

## Fixtures & Media

Fixtures live under ixtures/ and mirror the structure defined in the design doc. Media assets are lightweight placeholders that satisfy MIME requirements; they are suitable for client wiring tests but not final production visuals or audio.

To point the emulator at a different fixtures directory:

`ash
npm run dev -- --fixtures=../path/to/fixtures
`

## Behavior Toggles

Control runtime behavior through environment variables (defaults in parentheses):

| Variable | Description |
| --- | --- |
| EMU_PAIR_AUDIO_ONLY (1) | Enforce audio-first playback policy. |
| EMU_SSE_HEARTBEAT_SEC (15) | Heartbeat cadence for SSE clients. |
| EMU_SSE_BACKOFF_SEQUENCE_MS ("1000,3000,5000,10000") | Client reconnect guidance. |
| EMU_LATENCY_TTS_MS / EMU_LATENCY_CLIP_MS (600/1200) | Base latencies per phase. |
| EMU_LATENCY_JITTER_MS (300) | Random jitter range for each latency. |
| EMU_MISS_TTS_PCT / EMU_MISS_CLIP_PCT (0/0) | Chance to simulate misses. |
| EMU_SWAP_ENABLED (1) | Enable swap events for fixtures that support them. |
| EMU_SHARE_ENABLED (1) | Emit share links when available. |
| EMU_SHARE_TTL_MIN (10) | Share link lifetime in minutes. |
| EMU_SIGNED_TTL_SECONDS (300) | TTL for /v1/media/sign responses. |
| EMU_FIXTURE_MAP | Path to JSON override map for deterministic fixture routing. |

## Testing

`ash
npm test
`

Vitest covers configuration helpers and deterministic fixture selection. Extend with integration tests as the emulator surface grows.

## Notes

- SSE connections stream turn lifecycle events, heartbeat messages, and guidance for reconnect backoff.
- The emulator never performs real authentication; it accepts bearer tokens purely for parity.
- Idempotency on /v1/session/turn is enforced for 24 hours per session as described in the spec.

### Fixture overrides

Provide a JSON object via `EMU_FIXTURE_MAP` to map discriminators to fixture IDs. Keys use the form `persona::phrase`. Wildcards are supported with `persona::*` or `*::phrase`.

```json
{
  "socrates::virtue": "fx_socrates_s2_virtue",
  "*::follow up": "fx_socrates_swap_cutaway"
}
```
