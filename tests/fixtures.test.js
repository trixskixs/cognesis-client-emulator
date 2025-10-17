"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fixtures_1 = __importDefault(require("../src/fixtures"));
const loadRegistry = async () => fixtures_1.default.init();
(0, vitest_1.describe)("FixtureRegistry", () => {
    (0, vitest_1.it)("loads fixtures from manifest", async () => {
        const registry = await loadRegistry();
        (0, vitest_1.expect)(registry.getFixtureCount()).toBeGreaterThan(0);
        const fixture = registry.getFixtureById("fx_socrates_opening_01");
        (0, vitest_1.expect)(fixture?.timeline.version).toBe("1");
    });
    (0, vitest_1.it)("selects deterministic fixtures per persona", async () => {
        const registry = await loadRegistry();
        const first = registry.selectFixture("socrates", "virtue");
        const second = registry.selectFixture("socrates", "virtue");
        (0, vitest_1.expect)(first.id).toBe(second.id);
    });
});
//# sourceMappingURL=fixtures.test.js.map