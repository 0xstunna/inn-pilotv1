/**
 * Firestore-backed rate limiting for the public guest chat endpoint.
 *
 * Unlike the small in-memory limiter used by the diagnostic endpoints, this
 * counter is shared by every serverless instance: an old function container
 * and a freshly cold-started one see the same hits. That matters for the
 * concierge, where each turn can spend a hotel's model budget.
 *
 * The stored document contains only a SHA-256 of the scope key and the
 * timestamps of recent hits — never a visitor IP or a hotel workspace id.
 */
import { createHash } from "node:crypto";
import { adminDb } from "../admin.js";
import { AiRateLimitError, AiUnavailableError, errorMessage } from "./errors.js";

const COLLECTION = "aiRateLimits";

export interface SharedRateLimitScope {
  /** Prefixed key, e.g. `concierge:hotel:<publicId>` or `concierge:ip:<hash>`. */
  key: string;
  limit: number;
  windowMs: number;
}

export interface SharedRateLimitOptions {
  now?: number;
}

function documentId(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Records one hit against every scope in a single Firestore transaction.
 * Throws `AiRateLimitError` (HTTP 429) before writing anything if any scope
 * has reached its allowance.
 */
export async function enforceSharedRateLimits(
  scopes: SharedRateLimitScope[],
  options: SharedRateLimitOptions = {}
): Promise<void> {
  if (scopes.length === 0) return;

  const db = adminDb();
  const now = options.now ?? Date.now();
  // Duplicate keys (same hotel as visitor, for example) must count once.
  const unique = new Map<string, SharedRateLimitScope>();
  for (const scope of scopes) unique.set(documentId(scope.key), scope);
  const entries = Array.from(unique.entries());

  try {
    await db.runTransaction(async (transaction) => {
      const refs = entries.map(([id]) => db.collection(COLLECTION).doc(id));
      const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));

      let rejected: AiRateLimitError | null = null;
      const updates = entries.map(([id, scope], index) => {
        const cutoff = now - scope.windowMs;
        const stored = snapshots[index].data()?.hits;
        const hits: number[] = Array.isArray(stored)
          ? stored.filter((at): at is number => typeof at === "number" && at > cutoff)
          : [];

        if (hits.length >= scope.limit && !rejected) {
          const oldest = hits[0];
          const retryAfterSeconds = Math.max(1, Math.ceil((oldest + scope.windowMs - now) / 1000));
          rejected = new AiRateLimitError(retryAfterSeconds);
        }
        if (hits.length < scope.limit) hits.push(now);
        return { ref: refs[index], id, hits, windowMs: scope.windowMs };
      });

      if (rejected) throw rejected;

      for (const update of updates) {
        transaction.set(
          update.ref,
          { keyHash: update.id, hits: update.hits, expiresAt: now + update.windowMs },
          { merge: true }
        );
      }
    });
  } catch (error) {
    if (error instanceof AiRateLimitError) throw error;
    // A limiter that cannot reach its store fails closed with the same
    // guest-safe 503 as any other unavailable dependency, never a raw 500.
    throw new AiUnavailableError(`Shared rate limit unavailable: ${errorMessage(error)}`);
  }
}

/** Test seam: clears stored counters between emulator-backed cases. */
export async function resetSharedRateLimits(): Promise<void> {
  const db = adminDb();
  const docs = await db.collection(COLLECTION).listDocuments();
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    for (const ref of docs.slice(i, i + 500)) batch.delete(ref);
    await batch.commit();
  }
}
