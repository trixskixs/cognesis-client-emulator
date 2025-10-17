import crypto from "crypto";

export function hashString(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function selectDeterministic<T>(items: T[], key: string): T {
  if (items.length === 0) {
    throw new Error("Cannot select from empty list");
  }
  const hash = hashString(key);
  const segment = hash.slice(0, 8);
  const index = Number.parseInt(segment, 16) % items.length;
  return items[index];
}

export function withJitter(base: number, jitter: number): number {
  if (jitter <= 0) {
    return Math.max(0, base);
  }
  const delta = Math.floor(Math.random() * (jitter * 2 + 1)) - jitter;
  return Math.max(0, base + delta);
}

export function percentToHit(pct: number): boolean {
  if (pct <= 0) {
    return false;
  }
  if (pct >= 100) {
    return true;
  }
  return Math.random() * 100 < pct;
}

export function ensureLeadingSlash(pathname: string): string {
  if (!pathname.startsWith("/")) {
    return `/${pathname}`;
  }
  return pathname;
}

export function sanitizeMediaPath(input: string): string {
  const base = input.split("?")[0];
  const normalized = base
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.+/g, ".");
  if (normalized.includes("..")) {
    throw new Error("INVALID_MEDIA_PATH");
  }
  return normalized;
}

export function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

export function minutesFromNow(minutes: number): Date {
  return secondsFromNow(minutes * 60);
}

export function isoTimestamp(): string {
  return new Date().toISOString();
}
