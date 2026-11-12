/**
 * Per-hotel WhatsApp Business connections.
 *
 * Each hotel independently connects its own WhatsApp Business account.
 * Credentials are stored server-only (top-level collection, Admin SDK only)
 * and never exposed to the browser. The webhook resolves a hotel's
 * credentials from the receiving phone_number_id, so Hotel A can never
 * use Hotel B's access token or app secret.
 *
 * Connection lifecycle:
 *   - active    — webhook and outbound send work normally
 *   - disconnected — hotel disconnected; webhook returns 503, send fails
 *   - expired   — access token expired; webhook returns 503, send fails
 *   - revoked   — Meta revoked the grant; webhook returns 503, send fails
 *
 * Document id: the hotel's internal hotelId (workspace key).
 * Shape:
 *   {
 *     phoneNumberId: string,      // Meta WhatsApp phone number ID
 *     accessToken: string,        // Meta access token (server-only secret)
 *     appSecret: string,          // Meta app secret for signature verification
 *     verifyToken: string,        // webhook verify token
 *     status: "active" | "disconnected" | "expired" | "revoked",
 *     connectedAt: timestamp,
 *     updatedAt: timestamp,
 *   }
 *
 * Pure types + Firestore helpers — no HTTP, no AI imports.
 */

import { adminDb } from "../admin.js";
import { COLLECTIONS } from "../../src/lib/collections.js";
import type { FieldValue } from "firebase-admin/firestore";

export type WhatsAppConnectionStatus = "active" | "disconnected" | "expired" | "revoked";

export interface WhatsAppConnection {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  status: WhatsAppConnectionStatus;
  connectedAt: FieldValue | Date;
  updatedAt: FieldValue | Date;
}

/** Resolves a hotel's WhatsApp connection by its internal hotelId. */
export async function getWhatsAppConnection(
  hotelId: string,
): Promise<WhatsAppConnection | null> {
  const db = adminDb();
  const snap = await db.collection(COLLECTIONS.WHATSAPP_CONNECTIONS).doc(hotelId).get();
  if (!snap.exists) return null;
  const data = snap.data() as WhatsAppConnection | undefined;
  if (!data) return null;
  return data;
}

/** Returns the connection only when it is active and usable. */
export async function getActiveWhatsAppConnection(
  hotelId: string,
): Promise<WhatsAppConnection | null> {
  const connection = await getWhatsAppConnection(hotelId);
  if (!connection || connection.status !== "active") return null;
  return connection;
}

/** Builds a credentials object the WhatsApp adapter reads, from a connection. */
export function connectionToCredentials(connection: WhatsAppConnection): Record<string, string> {
  return {
    WHATSAPP_ACCESS_TOKEN: connection.accessToken,
    WHATSAPP_PHONE_NUMBER_ID: connection.phoneNumberId,
    WHATSAPP_APP_SECRET: connection.appSecret,
    WHATSAPP_VERIFY_TOKEN: connection.verifyToken,
  };
}

/** Checks whether a connection status permits processing. */
export function isConnectionActive(connection: WhatsAppConnection | null): boolean {
  return Boolean(connection && connection.status === "active");
}
