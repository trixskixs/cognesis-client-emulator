import { describe, expect, it } from "vitest";
import { hashString, selectDeterministic, withJitter } from "../src/utils";

describe("utils", () => {
  it("produces deterministic hashes", () => {
    expect(hashString("hello")).toBe(hashString("hello"));
    expect(hashString("hello")).not.toBe(hashString("world"));
  });

  it("selects deterministic entry", () => {
    const items = ["a", "b", "c"];
    const first = selectDeterministic(items, "key");
    const second = selectDeterministic(items, "key");
    expect(first).toBe(second);
  });

  it("applies jitter within bounds", () => {
    const base = 1000;
    const jitter = 100;
    for (let index = 0; index < 100; index += 1) {
      const value = withJitter(base, jitter);
      expect(value).toBeGreaterThanOrEqual(base - jitter);
      expect(value).toBeLessThanOrEqual(base + jitter);
    }
  });
});
