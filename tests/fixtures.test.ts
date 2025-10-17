import { describe, expect, it } from "vitest";
import FixtureRegistry from "../src/fixtures";

const loadRegistry = async () => FixtureRegistry.init();

describe("FixtureRegistry", () => {
  it("loads fixtures from manifest", async () => {
    const registry = await loadRegistry();
    expect(registry.getFixtureCount()).toBeGreaterThan(0);
    const fixture = registry.getFixtureById("fx_socrates_opening_01");
    expect(fixture?.timeline.version).toBe("1");
  });

  it("selects deterministic fixtures per persona", async () => {
    const registry = await loadRegistry();
    const first = registry.selectFixture("socrates", "virtue");
    const second = registry.selectFixture("socrates", "virtue");
    expect(first.id).toBe(second.id);
  });
});
