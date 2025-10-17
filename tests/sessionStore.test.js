"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const sessionStore_1 = require("../src/sessionStore");
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
(0, vitest_1.describe)("SessionStore", () => {
    (0, vitest_1.it)("stores and retrieves sessions", () => {
        const store = new sessionStore_1.SessionStore();
        const session = store.createSession({
            id: "sess_test",
            token: "sess_test",
            mode: "portrait_chat",
            personas: [{ id: "socrates" }],
        });
        (0, vitest_1.expect)(store.getSession(session.id)).toBeDefined();
    });
    (0, vitest_1.it)("enforces idempotency", () => {
        const store = new sessionStore_1.SessionStore();
        store.createSession({
            id: "sess_test",
            token: "sess_test",
            mode: "portrait_chat",
            personas: [{ id: "socrates" }],
        });
        const body = { persona_id: "socrates", transcript: { text: "hello" } };
        const first = store.putTurn("sess_test", "key", body, makeTurn());
        (0, vitest_1.expect)(first.reused).toBe(false);
        const replay = store.putTurn("sess_test", "key", body, makeTurn());
        (0, vitest_1.expect)(replay.reused).toBe(true);
        (0, vitest_1.expect)(replay.entry.requestId).toBe(first.entry.requestId);
    });
    (0, vitest_1.it)("throws on mismatched idempotency payload", () => {
        const store = new sessionStore_1.SessionStore();
        store.createSession({
            id: "sess_test",
            token: "sess_test",
            mode: "portrait_chat",
            personas: [{ id: "socrates" }],
        });
        store.putTurn("sess_test", "key", { persona_id: "socrates" }, makeTurn());
        (0, vitest_1.expect)(() => store.putTurn("sess_test", "key", { persona_id: "plato" }, makeTurn())).toThrowError(/IDEMPOTENCY_BODY_MISMATCH/);
    });
});
//# sourceMappingURL=sessionStore.test.js.map