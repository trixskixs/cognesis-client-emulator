import fs from "fs/promises";
import path from "path";
import { config } from "./config";
import {
  FixtureDefinition,
  FixtureManifest,
  HomefeedResponse,
  LoadedFixture,
} from "./types";
import { selectDeterministic } from "./utils";

export type FixtureOverrideMap = Record<string, string>;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildOverrideKey(personaId: string, discriminator: string): string {
  return `${normalizeKey(personaId)}::${normalizeKey(discriminator)}`;
}

function parseOverride(data: unknown): FixtureOverrideMap {
  if (!data || typeof data !== "object") {
    throw new Error("Fixture override file must be a JSON object");
  }
  const map: FixtureOverrideMap = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === "string") {
      map[normalizeKey(key)] = value;
    }
  }
  return map;
}

function indexFixtures(fixtures: LoadedFixture[]): Map<string, LoadedFixture[]> {
  const index = new Map<string, LoadedFixture[]>();
  for (const fixture of fixtures) {
    const personaKey = normalizeKey(fixture.persona_id);
    if (!index.has(personaKey)) {
      index.set(personaKey, []);
    }
    index.get(personaKey)!.push(fixture);
  }
  return index;
}

export class FixtureRegistry {
  private fixtureMap: Map<string, LoadedFixture>;
  private personaIndex: Map<string, LoadedFixture[]>;
  private manifest: FixtureManifest;
  private overrides: FixtureOverrideMap;

  private constructor(
    manifest: FixtureManifest,
    fixtures: LoadedFixture[],
    overrides: FixtureOverrideMap,
  ) {
    this.manifest = manifest;
    this.fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    this.personaIndex = indexFixtures(fixtures);
    this.overrides = overrides;
  }

  static async init(): Promise<FixtureRegistry> {
    const manifestPath = path.join(config.fixturesPath, "manifest.json");
    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as FixtureManifest;

    const fixtures: LoadedFixture[] = [];
    for (const definition of manifest.fixtures ?? []) {
      const timelinePath = path.join(config.fixturesPath, definition.timeline_path);
      const timelineRaw = await fs.readFile(timelinePath, "utf-8");
      const timeline = JSON.parse(timelineRaw);
      fixtures.push({ ...definition, timeline });
    }

    let overrides: FixtureOverrideMap = {};
    if (config.fixtureMapPath) {
      const overrideRaw = await fs.readFile(config.fixtureMapPath, "utf-8");
      overrides = parseOverride(JSON.parse(overrideRaw));
    }

    return new FixtureRegistry(manifest, fixtures, overrides);
  }

  getHomefeed(): HomefeedResponse | undefined {
    return this.manifest.homefeed;
  }

  getFixtureById(fixtureId: string): LoadedFixture | undefined {
    return this.fixtureMap.get(fixtureId);
  }

  getFixturesByPersona(personaId: string): LoadedFixture[] {
    const normalized = normalizeKey(personaId);
    if (normalized === "*") {
      return this.getAllFixtures();
    }
    const list = this.personaIndex.get(normalized);
    if (list && list.length > 0) {
      return list;
    }
    return this.getAllFixtures();
  }

  getAllFixtures(): LoadedFixture[] {
    return Array.from(this.fixtureMap.values());
  }

  getFixtureCount(): number {
    return this.fixtureMap.size;
  }

  selectFixture(personaId: string, discriminator: string): LoadedFixture {
    const normalizedPersona = normalizeKey(personaId);
    const normalizedDiscriminator = normalizeKey(discriminator);

    const override = this.resolveOverride(normalizedPersona, normalizedDiscriminator);
    if (override) {
      const fixture = this.getFixtureById(override);
      if (!fixture) {
        throw new Error(`Override fixture '${override}' not found`);
      }
      return fixture;
    }

    const candidates = this.getFixturesByPersona(personaId);
    if (candidates.length === 0) {
      throw new Error(`No fixtures registered for persona '${personaId}'`);
    }
    return selectDeterministic(candidates, `${personaId}:${discriminator}`);
  }

  private resolveOverride(personaId: string, discriminator: string): string | undefined {
    const personaSpecificKey = buildOverrideKey(personaId, discriminator);
    if (this.overrides[personaSpecificKey]) {
      return this.overrides[personaSpecificKey];
    }

    const wildcardDiscriminator = buildOverrideKey(personaId, "*");
    if (this.overrides[wildcardDiscriminator]) {
      return this.overrides[wildcardDiscriminator];
    }

    const wildcardPersonaKey = buildOverrideKey("*", discriminator);
    if (this.overrides[wildcardPersonaKey]) {
      return this.overrides[wildcardPersonaKey];
    }

    return this.overrides["*::*"];
  }
}

export default FixtureRegistry;
