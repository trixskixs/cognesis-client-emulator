"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const utils_1 = require("../src/utils");
(0, vitest_1.describe)("utils", () => {
    (0, vitest_1.it)("produces deterministic hashes", () => {
        (0, vitest_1.expect)((0, utils_1.hashString)("hello")).toBe((0, utils_1.hashString)("hello"));
        (0, vitest_1.expect)((0, utils_1.hashString)("hello")).not.toBe((0, utils_1.hashString)("world"));
    });
    (0, vitest_1.it)("selects deterministic entry", () => {
        const items = ["a", "b", "c"];
        const first = (0, utils_1.selectDeterministic)(items, "key");
        const second = (0, utils_1.selectDeterministic)(items, "key");
        (0, vitest_1.expect)(first).toBe(second);
    });
    (0, vitest_1.it)("applies jitter within bounds", () => {
        const base = 1000;
        const jitter = 100;
        for (let index = 0; index < 100; index += 1) {
            const value = (0, utils_1.withJitter)(base, jitter);
            (0, vitest_1.expect)(value).toBeGreaterThanOrEqual(base - jitter);
            (0, vitest_1.expect)(value).toBeLessThanOrEqual(base + jitter);
        }
    });
});
//# sourceMappingURL=utils.test.js.map