import crypto from "node:crypto";

/**
 * Per-stay guest ordering token (NRMS_QR_ORDERING.md milestone 7).
 *
 * The printed room QR carries an order-point token: a permanent bearer
 * capability for that physical room, which by design serves whoever is checked
 * in right now. That is correct for a code screwed to the wall, and it is why
 * it never has to be rotated or reprinted.
 *
 * It is the wrong thing to put in an SMS. A message lives in the guest's phone
 * forever, so a checked-out guest would keep a working link to whoever occupies
 * the room next. Binding could not be bolted onto the same link either: any
 * extra URL parameter is simply deleted by the person we are trying to stop.
 *
 * So the SMS carries a different class of token, derived here, which names the
 * reservation it was issued for. Validity is then a status lookup rather than a
 * rotation: the link works while that reservation is CHECKED_IN and stops on
 * its own at checkout. Nothing is stored, so there is no schema change and no
 * row to clean up; the HMAC is what makes the reservation id unforgeable.
 */

const PREFIX = "s";
const DIGEST_LENGTH = 24;

function getSecret(): string {
  const secret =
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "");

  if (!secret) {
    throw new Error("nrms_stay_token_secret_missing");
  }

  return secret;
}

function digestFor(reservationId: number): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`NRMS_STAY_ORDERING:${reservationId}`)
    .digest("base64url")
    .slice(0, DIGEST_LENGTH);
}

/**
 * Deterministic for a given reservation, so re-queuing the welcome SMS after a
 * retry produces the same link rather than a second live one.
 */
export function buildStayOrderingToken(reservationId: number): string {
  return `${PREFIX}${reservationId}_${digestFor(reservationId)}`;
}

/**
 * Returns the reservation id a stay token refers to, or null when the value is
 * not a stay token at all (an order-point token, which the caller then resolves
 * the existing way) or when the signature does not verify.
 */
export function readStayOrderingToken(token: string): number | null {
  const match = /^s(\d{1,12})_([A-Za-z0-9_-]{8,64})$/.exec(String(token || ""));
  if (!match) return null;

  const reservationId = Number(match[1]);
  if (!Number.isSafeInteger(reservationId) || reservationId <= 0) return null;

  const expected = digestFor(reservationId);
  const provided = match[2];
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;

  return reservationId;
}

/** True when the value looks like a stay token, whether or not it verifies. */
export function isStayOrderingTokenShape(token: string): boolean {
  return /^s\d{1,12}_[A-Za-z0-9_-]{8,64}$/.test(String(token || ""));
}
