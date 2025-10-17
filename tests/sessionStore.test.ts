import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/sessionStore";

const makeTurn = () => ({
  requestId: "req_test",
  fixtureId: "fx_test",
  timeline: {
    version: "1",
    clock: "audio",
    start_at: "now",
    tracks: [],
  },
  personaId: "socrates",
  miss: {},
  latencyMs: { audio: 100, clip: 200 },
});

describe("SessionStore", () => {
  it("stores and retrieves sessions", () => {
    const store = new SessionStore();
    const session = store.createSession({
      id: "sess_test",
      token: "sess_test",
      mode: "portrait_chat",
      personas: [{ id: "socrates" }],
    });
    expect(store.getSession(session.id)).toBeDefined();
  });

  it("enforces idempotency", () => {
    const store = new SessionStore();
    store.createSession({
      id: "sess_test",
      token: "sess_test",
      mode: "portrait_chat",
      personas: [{ id: "socrates" }],
    });
    const body = { persona_id: "socrates", transcript: { text: "hello" } };
    const first = store.putTurn("sess_test", "key", body, makeTurn());
    expect(first.reused).toBe(false);
    const replay = store.putTurn("sess_test", "key", body, makeTurn());
    expect(replay.reused).toBe(true);
    expect(replay.entry.requestId).toBe(first.entry.requestId);
  });

  it("throws on mismatched idempotency payload", () => {
    const store = new SessionStore();
    store.createSession({
      id: "sess_test",
      token: "sess_test",
      mode: "portrait_chat",
      personas: [{ id: "socrates" }],
    });
    store.putTurn("sess_test", "key", { persona_id: "socrates" }, makeTurn());
    expect(() =>
      store.putTurn("sess_test", "key", { persona_id: "plato" }, makeTurn()),
    ).toThrowError(/IDEMPOTENCY_BODY_MISMATCH/);
  });
});

