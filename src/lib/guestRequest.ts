/**
 * Guest requests and complaints (R13/R14) — the Jatigi Stay differentiator.
 *
 * One record per guest issue or request, per hotel:
 *
 *   hotels/{hotelId}/guestRequests/{requestId}
 *
 * Pure — no Firestore import — so the app, the server and the tests share
 * one definition. Keep the enums in sync with firestore.rules.
 *
 * The AI never promises refunds, compensation or resolution times. It
 * acknowledges, gives the reference, and says staff will follow up.
 */

export type GuestRequestType = "request" | "complaint" | "feedback";
export type GuestRequestCategory =
  | "housekeeping"
  | "maintenance"
  | "food_beverage"
  | "front_desk"
  | "noise"
  | "billing"
  | "safety"
  | "other";
export type GuestRequestPriority = "normal" | "high" | "urgent";
export type GuestRequestStatus =
  | "new"
  | "acknowledged"
  | "in_progress"
  | "resolved"
  | "closed";

export interface GuestRequestNote {
  text: string;
  /** ms since epoch. */
  at: number;
  /** Who wrote it: a staff name, or "system". */
  by: string;
}

export interface GuestRequest {
  id: string; // REQ-YYYYMMDD-XXXXXX
  hotelId: string;
  type: GuestRequestType;
  category: GuestRequestCategory;
  priority: GuestRequestPriority;
  status: GuestRequestStatus;
  /** Which department owns this, derived from category by departmentFor(). */
  department: string;
  assigneeId?: string;
  assigneeName?: string;
  channel: "web" | "whatsapp";
  /** The guest thread this record is linked to. */
  conversationId?: string;
  guestName?: string;
  guestPhone?: string;
  guestRoom?: string;
  summary: string; // short staff-facing summary
  /** The guest's own words, capped; never re-sent to the guest. */
  guestExcerpt?: string;
  /** ms since epoch. */
  createdAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  notes: GuestRequestNote[];
}

/** What the log_guest_request tool accepts. */
export interface CreateGuestRequestInput {
  type: GuestRequestType;
  category: GuestRequestCategory;
  priority: GuestRequestPriority;
  channel: "web" | "whatsapp";
  conversationId?: string;
  guestName?: string;
  guestPhone?: string;
  guestRoom?: string;
  summary: string;
  guestExcerpt?: string;
}

/** Max characters of the guest's own words we keep (never shown back to them). */
export const MAX_GUEST_EXCERPT_CHARS = 500;

/** REQ-YYYYMMDD-XXXXXX — a short, human-readable reference the guest can quote. */
export function makeRequestId(): string {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${today.getUTCFullYear()}${pad(today.getUTCMonth() + 1)}${pad(today.getUTCDate())}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I chars
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `REQ-${date}-${random}`;
}

/** Status transitions a staff member may make. `closed` is terminal. */
export function validStatusTransitions(current: GuestRequestStatus): GuestRequestStatus[] {
  const transitions: Record<GuestRequestStatus, GuestRequestStatus[]> = {
    new: ["acknowledged", "in_progress", "resolved", "closed"],
    acknowledged: ["in_progress", "resolved", "closed"],
    in_progress: ["resolved", "closed"],
    resolved: ["closed"],
    closed: [],
  };
  return transitions[current];
}

export function isValidStatusTransition(current: GuestRequestStatus, next: GuestRequestStatus): boolean {
  return validStatusTransitions(current).includes(next);
}

/** Safe default department per category. A hotel can override these later
 *  with per-property routing rules; this is the fallback everywhere. */
export function departmentFor(category: GuestRequestCategory): string {
  const defaults: Record<GuestRequestCategory, string> = {
    housekeeping: "Housekeeping",
    maintenance: "Maintenance",
    food_beverage: "Food & Beverage",
    front_desk: "Front Desk",
    noise: "Front Desk",
    billing: "Accounts",
    safety: "Management",
    other: "Front Desk",
  };
  return defaults[category];
}

/** Default priority by category (safety first, then money). The classifier
 *  (Task 2) can raise it further based on the guest's words. */
export function defaultPriority(category: GuestRequestCategory): GuestRequestPriority {
  if (category === "safety") return "urgent";
  if (category === "billing") return "high";
  return "normal";
}

/** Trim a guest excerpt to the cap, or undefined when empty. */
export function excerptOf(text?: string): string | undefined {
  if (!text || !text.trim()) return undefined;
  return text.trim().slice(0, MAX_GUEST_EXCERPT_CHARS);
}

/* ------------------------------------------------------------------ */
/* Deterministic pre-classifier (R13)                                 */
/*                                                                    */
/* Cheap keyword/pattern matching — zero model calls. The result is a
 * hint the model may or may not act on; it never creates a record by
 * itself. That only happens when the model calls log_guest_request. */
/* ------------------------------------------------------------------ */

export type MessageClassificationConfidence = "low" | "medium" | "high";

export interface MessageClassification {
  /** Whether the message looks like a request or complaint at all. */
  isLikelyRequest: boolean;
  type: GuestRequestType;
  category: GuestRequestCategory;
  priority: GuestRequestPriority;
  confidence: MessageClassificationConfidence;
  /** Why the classifier landed here, for logs and the hint line. */
  reasons: string[];
}

const hasAny = (text: string, needles: string[]): boolean =>
  needles.some((n) => text.includes(n));

const categoryKeywords: Record<GuestRequestCategory, string[]> = {
  housekeeping: ["clean", "cleaning", "dirty", "towel", "linen", "bed sheet", "housekeeping", "room service", "trash", "rubbish", "vacuum", "dust"],
  maintenance: ["broken", "not working", "doesn't work", "does not work", "fix", "repair", "leak", "leaky", "ac", "air conditioning", "heater", "heating", "lift", "elevator", "light", "bulb", "tv", "television", "key card", "keycard", "door", "window", "plumbing", "toilet", "shower", "sink", "tap", "faucet"],
  food_beverage: ["breakfast", "restaurant", "bar", "room service", "food", "drink", "menu", "beverage", "dinner", "lunch", "coffee", "tea"],
  front_desk: ["late checkout", "late check out", "early check", "check-in", "check out", "checkout", "room change", "upgrade", "wake up", "wake-up", "taxi", "airport", "shuttle", "bell", "luggage", "reception", "front desk"],
  noise: ["noise", "noisy", "loud", "party", "shouting", "shout", "music", "quiet", "silence"],
  billing: ["refund", "money back", "overcharg", "overcharge", "wrong charge", "billing", "invoice", "receipt", "payment", "bill", "charge", "cost", "price dispute"],
  safety: ["fire", "gas", "flood", "electrical", "electric", "shock", "emergency", "dangerous", "unsafe", "security", "intruder", "alarm", "smoke", "carbon monoxide"],
  other: [],
};

const complaintSignals = ["complain", "complaint", "terrible", "awful", "worst", "disappointed", "unhappy", "unacceptable", "outrageous", "disgusting", "horrible", "issue", "problem", "fault", "faulty", "broken", "not working", "rude", "slow", "wrong", "overcharg", "refund"];
const requestSignals = ["request", "can i", "can you", "could you", "please", "arrange", "ask", "need", "want", "would like", "like to", "extra", "another", "additional"];

/** Classify a guest message deterministically — no model, no cost. */
export function classifyGuestMessage(text: string): MessageClassification {
  const lower = text.toLowerCase();

  const matchedCategories: Array<{ category: GuestRequestCategory; hits: number }> = [];
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    const hits = keywords.filter((k) => lower.includes(k)).length;
    if (hits > 0) matchedCategories.push({ category: category as GuestRequestCategory, hits });
  }
  matchedCategories.sort((a, b) => b.hits - a.hits);

  const isComplaint = hasAny(lower, complaintSignals);
  const isRequest = hasAny(lower, requestSignals);
  const isSafety = hasAny(lower, categoryKeywords.safety);
  const isBilling = hasAny(lower, categoryKeywords.billing);

  const category = matchedCategories[0]?.category ?? "other";
  const type = isComplaint ? "complaint" : isRequest ? "request" : "feedback";
  let priority: GuestRequestPriority = defaultPriority(category);
  if (isSafety) priority = "urgent";
  else if (isBilling) priority = "high";
  else if (isComplaint) priority = "high";

  let confidence: MessageClassificationConfidence = "low";
  const reasons: string[] = [];
  if (matchedCategories.length > 0) {
    reasons.push(`category keywords: ${matchedCategories.map((m) => `${m.category}(${m.hits})`).join(", ")}`);
    confidence = "medium";
  }
  if (isComplaint) { reasons.push("complaint signals"); confidence = "high"; }
  if (isRequest) { reasons.push("request signals"); if (confidence === "low") confidence = "medium"; }
  if (isSafety) reasons.push("safety keywords");
  if (isBilling) reasons.push("billing/refund keywords");

  const isLikelyRequest = confidence !== "low";

  return { isLikelyRequest, type, category, priority, confidence, reasons };
}
