/**
 * Which hotel one guest conversation may reach (DECISIONS D32).
 *
 * Every conversation belongs to exactly one hotel. On a hotel's own link,
 * `/#/c/:publicHotelId`, the conversation reaches that hotel and nothing
 * else. There is no network directory, no cross-hotel search, and no
 * multi-hotel conversation.
 *
 * Tools never resolve a hotel themselves. They hand the reference the model
 * gave them to `resolve()`, which answers null for anything this
 * conversation may not reach — a malformed id, a workspace hotelId, an
 * unlisted hotel, or any other hotel — so the model gets one uniform
 * "unknown hotel" whatever it tried.
 *
 * The reference is a public id or, failing that, the hotel's exact name
 * (case and spacing aside). A guest turn carries text history, not earlier
 * tool results, so on a later turn the model often knows the hotel's name
 * but no longer its id; without this it had to search again (DECISIONS D31).
 *
 * Built once per guest turn.
 */
import { isPublicHotelId } from "../src/lib/publicHotel.js";
import { resolveHotel, type HotelScope } from "./hotels.js";

export interface NetworkContext {
  /** The one hotel this conversation is limited to. */
  readonly scopedPublicId: string;
  /** The resolved scope for the one hotel this conversation reaches. */
  readonly scopedHotel: HotelScope;
  /** The hotel behind a public id (or exact name) the model named, or null when it isn't this hotel. */
  resolve(reference: unknown): Promise<HotelScope | null>;
}

const nameKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** The one hotel a reference names: by public id, else by exact name match. */
export function findHotel(scope: HotelScope, reference: unknown): HotelScope | null {
  if (typeof reference !== "string" || !reference.trim() || reference.length > 120) return null;
  if (isPublicHotelId(reference)) {
    if (scope.publicId === reference) return scope;
  }
  if (nameKey(scope.profile.name) === nameKey(reference)) return scope;
  return null;
}

/**
 * `scopedPublicId` comes from the request (a hotel's own concierge link).
 * An invalid one throws the same guest-safe error resolveHotel() always has.
 * Every conversation is scoped to exactly one hotel: there is no network mode.
 */
export async function createNetworkContext(scopedPublicId: unknown): Promise<NetworkContext> {
  const scope = await resolveHotel(scopedPublicId);
  return {
    scopedPublicId: scope.publicId,
    scopedHotel: scope,
    resolve: (reference) => Promise.resolve(findHotel(scope, reference)),
  };
}

/** Test seam: no-op kept for callers that imported it previously. */
export function resetNetworkCache(): void {
  // No network cache remains; every context resolves fresh from Firestore.
}
