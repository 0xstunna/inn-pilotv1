/**
 * The hotel's own record: hotels/{hotelId}.
 *
 * Holds the settings that change how the app presents itself — currency
 * above all, since every money figure in the product runs through it.
 * Subscription and plan stay super-admin territory and are read-only
 * here; the security rules enforce that, not this module.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import { hotelDocRef } from "./hotelScope";
import { logAction } from "./audit";
import { errorMessage, fail, ok, type ServiceResult } from "./serviceResult";
import { DEFAULT_CURRENCY } from "./format";
import { makePublicHotelId, PUBLIC_HOTELS_COLLECTION } from "./publicHotel";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_POLICIES_LENGTH,
  readAmenities,
  toHotelListing,
  type HotelListing,
} from "./hotelListing";

export interface HotelProfile extends HotelListing {
  name: string;
  location: string;
  /** Address, town/city, region and country details */
  address?: string;
  town?: string;
  region?: string;
  country?: string;
  /** ISO-ish currency code used for every amount shown in the app. */
  currency: string;
  phone: string;
  email: string;
  /** Printed on receipts and vouchers. */
  taxId: string;
  plan: string;
  planStatus: string;
  /** The guest-facing id in the concierge link; "" for a workspace created before public ids. */
  publicId: string;
  /** Property-wide facilities and amenities */
  propertyAmenities?: string[];
  /** Property photographs */
  photos?: string[];
}

export const EMPTY_PROFILE: HotelProfile = {
  name: "",
  location: "",
  currency: DEFAULT_CURRENCY,
  phone: "",
  email: "",
  taxId: "",
  plan: "trial",
  planStatus: "active",
  publicId: "",
  propertyAmenities: [],
  photos: [],
  ...toHotelListing({}),
};

/** Fields a hotel admin may change. Everything else is platform-owned. */
export type EditableProfile = Pick<
  HotelProfile,
  "name" | "location" | "currency" | "phone" | "email" | "taxId"
> & {
  address?: string;
  town?: string;
  region?: string;
  country?: string;
  propertyAmenities?: string[];
  photos?: string[];
};

export const EDITABLE_KEYS: (keyof EditableProfile)[] = [
  "name",
  "location",
  "currency",
  "phone",
  "email",
  "taxId",
  "address",
  "town",
  "region",
  "country",
  "propertyAmenities",
  "photos",
];

export const CURRENCIES = ["UGX", "KES", "TZS", "RWF", "USD", "EUR", "GBP"];

function toProfile(data: Record<string, unknown> | undefined): HotelProfile {
  if (!data) return EMPTY_PROFILE;
  const subscription = (data.subscription ?? {}) as Record<string, unknown>;
  return {
    name: String(data.name ?? ""),
    location: String(data.location ?? ""),
    address: typeof data.address === "string" ? data.address : undefined,
    town: typeof data.town === "string" ? data.town : undefined,
    region: typeof data.region === "string" ? data.region : (data as any).region || undefined,
    country: typeof data.country === "string" ? data.country : undefined,
    currency: String(data.currency ?? DEFAULT_CURRENCY) || DEFAULT_CURRENCY,
    phone: String(data.phone ?? ""),
    email: String(data.email ?? ""),
    taxId: String(data.taxId ?? ""),
    plan: String(subscription.plan ?? "trial"),
    planStatus: String(subscription.status ?? "active"),
    publicId: typeof data.publicId === "string" ? data.publicId : "",
    propertyAmenities: Array.isArray(data.propertyAmenities) ? data.propertyAmenities.filter((a) => typeof a === "string") : Array.isArray((data as any).amenities) ? (data as any).amenities.filter((a: any) => typeof a === "string") : [],
    photos: Array.isArray(data.photos) ? data.photos.filter((a) => typeof a === "string") : [],
    ...toHotelListing(data),
  };
}

/**
 * Live hotel profile. Returns the default profile — not null — while
 * loading, so callers can format money on the first render instead of
 * flashing a placeholder currency.
 */
export function useHotelProfile(hotelId: string | null): {
  profile: HotelProfile;
  loading: boolean;
} {
  const [profile, setProfile] = useState<HotelProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hotelId) {
      setProfile(EMPTY_PROFILE);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      hotelDocRef(hotelId),
      (snap) => {
        setProfile(toProfile(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined));
        setLoading(false);
      },
      (err) => {
        console.error("Failed to read hotel profile:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [hotelId]);

  return { profile, loading };
}

export async function saveHotelProfile(
  hotelId: string,
  input: EditableProfile
): Promise<ServiceResult<null>> {
  if (!input.name.trim()) return fail("The hotel needs a name.");
  if (!input.currency.trim()) return fail("Choose a currency.");

  try {
    const payload: Record<string, unknown> = {
      name: input.name.trim(),
      location: input.location.trim(),
      currency: input.currency.trim().toUpperCase(),
      phone: input.phone.trim(),
      email: input.email.trim(),
      taxId: input.taxId.trim(),
    };
    if (input.address !== undefined) payload.address = input.address.trim();
    if (input.town !== undefined) payload.town = input.town.trim();
    if (input.region !== undefined) payload.region = input.region.trim();
    if (input.country !== undefined) payload.country = input.country.trim();
    if (Array.isArray(input.propertyAmenities)) payload.propertyAmenities = input.propertyAmenities.filter((a) => typeof a === "string" && a.trim());
    if (Array.isArray(input.photos)) payload.photos = input.photos.filter((a) => typeof a === "string" && a.trim());
    await updateDoc(hotelDocRef(hotelId), payload);
    logAction(hotelId, "Hotel settings updated", "settings", hotelId, input.name.trim());
    return ok(null);
  } catch (err) {
    console.error("Failed to save hotel profile:", err);
    return fail(errorMessage(err) || "Could not save these settings.");
  }
}

/**
 * How the hotel appears to guests in the network AI Concierge (DECISIONS D24).
 * Listing needs a public id; the rules refuse it otherwise.
 */
export async function saveConciergeListing(
  hotelId: string,
  listing: HotelListing,
  hasPublicId: boolean
): Promise<ServiceResult<null>> {
  if (listing.listed && !hasPublicId) return fail("Create your concierge link first, then list the hotel.");
  if (listing.description.length > MAX_DESCRIPTION_LENGTH) return fail(`Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`);
  if (listing.policies.length > MAX_POLICIES_LENGTH) return fail(`Keep the policies under ${MAX_POLICIES_LENGTH} characters.`);
  try {
    await updateDoc(hotelDocRef(hotelId), {
      listed: listing.listed,
      region: listing.region.trim(),
      country: listing.country.trim(),
      description: listing.description.trim(),
      amenities: readAmenities(listing.amenities),
      checkInTime: listing.checkInTime.trim(),
      checkOutTime: listing.checkOutTime.trim(),
      policies: listing.policies.trim(),
    });
    logAction(hotelId, listing.listed ? "Concierge listing saved (listed)" : "Concierge listing saved (not listed)", "settings", hotelId);
    return ok(null);
  } catch (err) {
    console.error("Failed to save the concierge listing:", err);
    return fail("Couldn't save the listing. Please try again.");
  }
}

/**
 * Gives a workspace created before public ids its concierge link: the
 * hotel's publicId and its publicHotels mapping, written together as the
 * rules require (DECISIONS D14). Only works once; a hotel that already has
 * a public id keeps it.
 */
export async function publishConciergeLink(
  hotelId: string,
  hotelName: string
): Promise<ServiceResult<{ publicId: string }>> {
  const publicId = makePublicHotelId(hotelName);
  const batch = writeBatch(db);
  batch.update(hotelDocRef(hotelId), { publicId });
  batch.set(doc(db, PUBLIC_HOTELS_COLLECTION, publicId), { hotelId, createdAt: serverTimestamp() });
  try {
    await batch.commit();
  } catch (err) {
    console.error("Failed to create the concierge link:", err);
    return fail("Couldn't create the concierge link. Please try again.");
  }
  logAction(hotelId, "Concierge link created", "settings", hotelId, publicId);
  return ok({ publicId });
}
