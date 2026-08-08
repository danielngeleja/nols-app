/**
 * Batch Release Challenge — step-up authentication bound to one release
 *
 * The batch architecture's strongest control is two-person release: the
 * authorizer may not be the admin who formed the batch or approved its
 * members. NoLSAF operates with a single finance admin today, so that control
 * would make release impossible rather than safe.
 *
 * This is the compensating control, decided deliberately: one admin may
 * authorize their own batch, but only by answering a fresh challenge that is
 * bound to THAT batch. It is not the ambient finance grant — that grant is a
 * 15-minute, session-wide "this admin re-authenticated recently" flag, which
 * covers every money action taken in that window and proves nothing about any
 * one of them. This challenge proves the person releasing this specific set of
 * payouts, for this specific total, is in possession of the admin's second
 * channel at the moment of release.
 *
 * Three properties make it worth the extra step:
 *
 *  1. BOUND TO THE BATCH. The OTP's purpose encodes the batch id and a prefix
 *     of its fingerprint. Change the batch, and every outstanding code for it
 *     becomes unusable — a code cannot be harvested against a small batch and
 *     spent on a larger one.
 *  2. SINGLE USE, SHORT LIVED. Marked used inside the same transaction that
 *     reads it, so two concurrent authorize calls cannot both spend it.
 *  3. OUT OF BAND AND DESCRIPTIVE. The message states the batch reference,
 *     item count and total. An attacker holding a hijacked admin session but
 *     not the admin's mailbox cannot complete a release; if they hold both,
 *     the notification is still an independent record that a release happened
 *     and for how much.
 *
 * Set DISBURSEMENT_REQUIRE_TWO_PERSON=true once a second finance admin exists
 * to retire this path and require genuine two-person release.
 */

import { prisma } from "@nolsaf/prisma";
import { generate6, hashCode } from "../../lib/otp.js";
import { sendMail, SECURITY_EMAIL_FROM } from "../../lib/mailer.js";
import { sendSms } from "../../lib/sms.js";
import { proEmail, proNoteCard, proReferenceCard } from "../../lib/emailBase.js";

export class ReleaseChallengeError extends Error {
  constructor(
    message: string,
    readonly reason: "EXPIRED" | "INVALID" | "LOCKED" | "DELIVERY_FAILED" | "NO_DESTINATION"
  ) {
    super(message);
    this.name = "ReleaseChallengeError";
  }
}

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/** True when a second finance admin exists and genuine two-person release is required. */
export function twoPersonReleaseRequired(): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.DISBURSEMENT_REQUIRE_TWO_PERSON || "").trim().toLowerCase()
  );
}

/**
 * AdminOtp.purpose is VarChar(60); this stays well inside it. Including the
 * fingerprint prefix is what binds the code to the batch's exact contents:
 * if a member's amount or destination changes, formation would have to change
 * the fingerprint, and the purpose no longer matches any outstanding code.
 */
export function releaseChallengePurpose(batchId: number, batchFingerprint: string): string {
  return `BR:${batchId}:${batchFingerprint.slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Brute-force protection
// ---------------------------------------------------------------------------

interface AttemptRecord {
  count: number;
  lockedUntil: number | null;
  lastAttempt: number;
}
const attempts = new Map<string, AttemptRecord>();

function attemptKey(adminId: number, purpose: string): string {
  return `${adminId}:${purpose}`;
}

function assertNotLocked(adminId: number, purpose: string): void {
  const record = attempts.get(attemptKey(adminId, purpose));
  if (record?.lockedUntil && record.lockedUntil > Date.now()) {
    const minutes = Math.ceil((record.lockedUntil - Date.now()) / 60_000);
    throw new ReleaseChallengeError(
      `Too many incorrect release codes. Try again in ${minutes} minute(s).`,
      "LOCKED"
    );
  }
}

function recordFailure(adminId: number, purpose: string): void {
  const key = attemptKey(adminId, purpose);
  const record = attempts.get(key) ?? { count: 0, lockedUntil: null, lastAttempt: 0 };
  record.count += 1;
  record.lastAttempt = Date.now();
  if (record.count >= MAX_ATTEMPTS) record.lockedUntil = Date.now() + LOCKOUT_MS;
  attempts.set(key, record);
}

function clearFailures(adminId: number, purpose: string): void {
  attempts.delete(attemptKey(adminId, purpose));
}

// Bounded cleanup so a long-lived process does not accumulate stale keys.
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts.entries()) {
    if (record.lockedUntil && record.lockedUntil < now) attempts.delete(key);
    else if (!record.lockedUntil && now - record.lastAttempt > LOCKOUT_MS) attempts.delete(key);
  }
}, 15 * 60_000).unref?.();

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface BatchReleaseSummary {
  id: number;
  batchReference: string;
  itemCount: number;
  totalAmount: string;
  currency: string;
}

function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  const rendered = Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : amount;
  return `${currency === "TZS" ? "TSh" : currency} ${rendered}`;
}

/**
 * The amount and item count are in the message on purpose. A code that only
 * says "here is your verification code" authenticates the session; a code that
 * says "this releases TSh 4,200,000 across 18 payouts" lets the admin catch a
 * release they did not initiate, which is the failure this control exists for.
 */
function buildEmail(code: string, batch: BatchReleaseSummary): { subject: string; html: string } {
  const body = `
    <p style="margin:0 0 16px;color:#374151;line-height:1.7;">
      Someone is releasing a disbursement batch from your admin account. Confirm the details below before entering this code.
      If this was not you, do not enter it, and change your password immediately.
    </p>
    ${proReferenceCard(
      "Release code",
      code,
      `This code expires in ${Math.ceil(CHALLENGE_TTL_MS / 60_000)} minutes and works only for batch ${batch.batchReference}.`,
      "#02665e",
      "#eaf7f4",
    )}
    <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
    ${proNoteCard(
      "#92400e",
      `Releasing ${formatMoney(batch.totalAmount, batch.currency)} across ${batch.itemCount} payout(s)`,
      `Batch ${batch.batchReference}. Once released, these payouts are submitted to AzamPay and cannot be recalled by NoLSAF.`,
      "#fffbeb",
    )}
  `;
  return {
    subject: `Release code for batch ${batch.batchReference} (${formatMoney(batch.totalAmount, batch.currency)})`,
    html: proEmail("Confirm this batch release", body),
  };
}

async function deliver(
  admin: { email: string | null; phone: string | null },
  code: string,
  batch: BatchReleaseSummary
): Promise<{ provider: string; destination: "EMAIL" | "PHONE" | "CONSOLE" }> {
  if (admin.email) {
    const email = buildEmail(code, batch);
    await sendMail(admin.email, email.subject, email.html, undefined, {
      bypassEligibilityCheck: true,
      from: SECURITY_EMAIL_FROM,
      replyTo: "support@nolsaf.com",
    });
    return { provider: "email", destination: "EMAIL" };
  }
  if (admin.phone) {
    const text =
      `NoLSAF: code ${code} releases batch ${batch.batchReference} — ` +
      `${formatMoney(batch.totalAmount, batch.currency)} across ${batch.itemCount} payout(s). ` +
      `Expires in ${Math.ceil(CHALLENGE_TTL_MS / 60_000)} min. Do not share it.`;
    const result = await sendSms(admin.phone, text, { bypassEligibilityCheck: true });
    if (!result.success) throw new ReleaseChallengeError(result.error || "SMS delivery failed", "DELIVERY_FAILED");
    return { provider: result.provider || "sms", destination: "PHONE" };
  }
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[release-challenge:DEV] no email or phone for this admin; code for batch ${batch.batchReference} is ${code}`);
    return { provider: "console", destination: "CONSOLE" };
  }
  throw new ReleaseChallengeError(
    "This admin has no email or phone on file, so a release code cannot be delivered. Add one before releasing batches.",
    "NO_DESTINATION"
  );
}

// ---------------------------------------------------------------------------
// Issue and consume
// ---------------------------------------------------------------------------

export interface IssuedChallenge {
  expiresAt: Date;
  sentVia: "EMAIL" | "PHONE" | "CONSOLE";
  /** Enough to tell the admin where to look, never the destination itself. */
  hint: string;
}

/** Issues a fresh, batch-bound release code and sends it out of band. */
export async function issueBatchReleaseChallenge(
  adminId: number,
  batch: BatchReleaseSummary,
  batchFingerprint: string
): Promise<IssuedChallenge> {
  const purpose = releaseChallengePurpose(batch.id, batchFingerprint);
  assertNotLocked(adminId, purpose);

  const recent = await prisma.adminOtp.findFirst({
    where: { adminId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { id: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime())) / 1000);
    throw new ReleaseChallengeError(`A release code was just sent. Wait ${wait} second(s) before requesting another.`, "INVALID");
  }

  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { email: true, phone: true } });
  if (!admin) throw new ReleaseChallengeError("Admin not found", "INVALID");

  const code = generate6();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  // Deliver first, persist second. A stored code that never arrived is a
  // support ticket; a delivered code with no stored record is unusable.
  const delivery = await deliver(admin, code, batch);

  // Any earlier outstanding code for this batch is retired, so exactly one
  // live code exists per batch per admin at a time.
  await prisma.$transaction(async (tx) => {
    await tx.adminOtp.updateMany({
      where: { adminId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.adminOtp.create({
      data: { adminId, purpose, codeHash: hashCode(code), expiresAt },
    });
  });

  return {
    expiresAt,
    sentVia: delivery.destination,
    hint:
      delivery.destination === "EMAIL"
        ? "Sent to the email address on your admin account."
        : delivery.destination === "PHONE"
          ? "Sent by SMS to the phone number on your admin account."
          : "Development mode: the code was written to the server log.",
  };
}

/**
 * Verifies and spends a release code. Marks it used inside the read
 * transaction, so two concurrent authorize calls cannot both spend one code.
 * Throws rather than returning false: a caller must not be able to ignore the
 * result of an authentication check by forgetting to branch on it.
 */
export async function consumeBatchReleaseChallenge(
  adminId: number,
  batchId: number,
  batchFingerprint: string,
  code: string
): Promise<void> {
  const purpose = releaseChallengePurpose(batchId, batchFingerprint);
  assertNotLocked(adminId, purpose);

  const codeHash = hashCode(String(code || "").trim());

  const spent = await prisma.$transaction(async (tx) => {
    const otp = await tx.adminOtp.findFirst({
      where: { adminId, purpose, usedAt: null, expiresAt: { gt: new Date() }, codeHash },
      orderBy: { id: "desc" },
    });
    if (!otp) return false;
    const claimed = await tx.adminOtp.updateMany({
      where: { id: otp.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return claimed.count === 1;
  });

  if (!spent) {
    recordFailure(adminId, purpose);
    throw new ReleaseChallengeError(
      "That release code is not valid for this batch, has already been used, or has expired. Request a new one.",
      "INVALID"
    );
  }

  clearFailures(adminId, purpose);
}
