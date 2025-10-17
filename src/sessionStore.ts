import { config } from "./config";
import { IdempotencyResult, SessionRecord, TurnCacheEntry } from "./types";
import { hashString } from "./utils";

function now(): number {
  return Date.now();
}

function isExpired(timestamp: number): boolean {
  return timestamp <= now();
}

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private idempotency = new Map<string, Map<string, TurnCacheEntry>>();
  private pendingTurns = new Map<string, TurnCacheEntry[]>();

  createSession(record: Omit<SessionRecord, "createdAt" | "expiresAt">): SessionRecord {
    const createdAt = now();
    const expiresAt = createdAt + config.sessionTtlSeconds * 1000;
    const session: SessionRecord = { ...record, createdAt, expiresAt };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    if (isExpired(session.expiresAt)) {
      this.sessions.delete(sessionId);
      this.idempotency.delete(sessionId);
      this.pendingTurns.delete(sessionId);
      return undefined;
    }
    return session;
  }

  putTurn(
    sessionId: string,
    idempotencyKey: string,
    body: unknown,
    entryData: Omit<TurnCacheEntry, "idempotencyKey" | "createdAt" | "expiresAt" | "bodyHash">,
  ): IdempotencyResult {
    const bodyHash = hashString(JSON.stringify(body ?? {}));
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    if (!this.idempotency.has(sessionId)) {
      this.idempotency.set(sessionId, new Map());
    }

    const sessionCache = this.idempotency.get(sessionId)!;
    const cached = sessionCache.get(idempotencyKey);
    if (cached) {
      if (cached.bodyHash !== bodyHash) {
        const error = new Error("IDEMPOTENCY_BODY_MISMATCH");
        (error as Error & { code?: string }).code = "IDEMPOTENCY_BODY_MISMATCH";
        throw error;
      }
      return { entry: cached, reused: true };
    }

    const createdAt = now();
    const entry: TurnCacheEntry = {
      ...entryData,
      idempotencyKey,
      bodyHash,
      createdAt,
      expiresAt: createdAt + config.idempotencyTtlSeconds * 1000,
    };
    sessionCache.set(idempotencyKey, entry);
    return { entry, reused: false };
  }

  enqueueTurn(sessionId: string, entry: TurnCacheEntry): void {
    if (!this.pendingTurns.has(sessionId)) {
      this.pendingTurns.set(sessionId, []);
    }
    this.pendingTurns.get(sessionId)!.push(entry);
  }

  takePendingTurns(sessionId: string): TurnCacheEntry[] {
    const queue = this.pendingTurns.get(sessionId) ?? [];
    this.pendingTurns.set(sessionId, []);
    return queue;
  }

  cleanupExpired(): void {
    const nowTs = now();
    for (const sessionId of this.sessions.keys()) {
      const session = this.sessions.get(sessionId);
      if (session && session.expiresAt <= nowTs) {
        this.sessions.delete(sessionId);
        this.idempotency.delete(sessionId);
        this.pendingTurns.delete(sessionId);
      }
    }
    for (const [sessionId, entries] of this.idempotency.entries()) {
      for (const [key, entry] of entries.entries()) {
        if (entry.expiresAt <= nowTs) {
          entries.delete(key);
        }
      }
      if (entries.size === 0) {
        this.idempotency.delete(sessionId);
      }
    }
  }
}

export const sessionStore = new SessionStore();

