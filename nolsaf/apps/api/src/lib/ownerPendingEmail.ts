/**
 * The owner's email from an assisted listing (docs/SALES_ASSISTED_LISTING.md).
 *
 * The sales partner must type the owner's email, but it is only a candidate:
 * it sits PENDING on the listing and is never put on the owner's account until
 * the owner enters a code sent to that inbox. "Forgot password" sends its link
 * to the account email, so a partner-chosen email would let the partner take
 * the account. The owner can also say "Not my email" (REJECTED).
 */
import { prisma } from "@nolsaf/prisma";
import { consumeContactChangeCode, codeHash, deleteContactChangeChallenge, generateOtp, storeContactChangeChallenge } from "./contactChangeOtp.js";

const db = prisma as any;

export type PendingOwnerEmail = { assistedId: number; email: string };

export function maskEmail(email: string): string {
  const [name, domain] = String(email).split("@");
  if (!domain) return "•••";
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
}

/** A pending email for an owner who has no email on their account yet, if any. */
export async function pendingOwnerEmailFor(user: { id: number; email?: string | null }): Promise<PendingOwnerEmail | null> {
  if (user.email) return null;
  try {
    const row = await db.salesAssistedListing.findFirst({
      where: { ownerUserId: user.id, ownerEmailStatus: "PENDING", ownerEmail: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, ownerEmail: true },
    });
    return row?.ownerEmail ? { assistedId: row.id, email: String(row.ownerEmail).toLowerCase() } : null;
  } catch (error: any) {
    if (error?.code === "P2022" || error?.code === "P2021") return null; // columns not migrated yet
    throw error;
  }
}

export type SendResult = { ok: true; code: string; email: string } | { ok: false; reason: "NONE" | "TAKEN" };

/**
 * Prepares a 6-digit code for the pending email (5 minutes, 5 tries, stored
 * hashed). The caller emails it. Refuses an address another account now uses.
 */
export async function preparePendingEmailCode(user: { id: number; email?: string | null }): Promise<SendResult> {
  const pending = await pendingOwnerEmailFor(user);
  if (!pending) return { ok: false, reason: "NONE" };
  const taken = await db.user.findFirst({ where: { email: pending.email, id: { not: user.id } }, select: { id: true } });
  if (taken) return { ok: false, reason: "TAKEN" };
  const code = generateOtp();
  await storeContactChangeChallenge(user.id, { field: "email", value: pending.email, oldValue: null, stage: "VERIFY_NEW", codeHash: codeHash(code) });
  return { ok: true, code, email: pending.email };
}

export type VerifyResult = "VERIFIED" | "INVALID" | "LOCKED" | "EXPIRED" | "NONE" | "TAKEN";

/** Checks the code; on success the email becomes the owner's verified account email. */
export async function verifyPendingEmailCode(user: { id: number; email?: string | null }, code: string): Promise<VerifyResult> {
  const pending = await pendingOwnerEmailFor(user);
  if (!pending) return "NONE";
  const { result, entry } = await consumeContactChangeCode(user.id, "email", "VERIFY_NEW", String(code).trim());
  if (result === "MISSING" || result === "WRONG_STAGE") return "EXPIRED";
  if (result === "LOCKED") return "LOCKED";
  if (result !== "VALID") return "INVALID";
  // The code proves this address only; a different pending email needs its own code.
  if (!entry || entry.value !== pending.email) return "EXPIRED";
  const now = new Date();
  try {
    await db.$transaction(async (tx: any) => {
      const taken = await tx.user.findFirst({ where: { email: pending.email, id: { not: user.id } }, select: { id: true } });
      if (taken) throw Object.assign(new Error("taken"), { code: "TAKEN" });
      // Only fills an empty email: never replaces one the owner set themselves.
      const updated = await tx.user.updateMany({ where: { id: user.id, email: null }, data: { email: pending.email, emailVerifiedAt: now } });
      if (updated.count !== 1) throw Object.assign(new Error("has email"), { code: "NONE" });
      await tx.salesAssistedListing.updateMany({
        where: { ownerUserId: user.id, ownerEmailStatus: "PENDING" },
        data: { ownerEmailStatus: "VERIFIED", ownerEmailDecidedAt: now },
      });
    });
  } catch (error: any) {
    if (error?.code === "TAKEN" || error?.code === "P2002") return "TAKEN";
    if (error?.code === "NONE") return "NONE";
    throw error;
  }
  return "VERIFIED";
}

/** "Not my email": the partner's email is dropped and never offered again. */
export async function rejectPendingEmail(user: { id: number; email?: string | null }): Promise<boolean> {
  const pending = await pendingOwnerEmailFor(user);
  if (!pending) return false;
  await db.salesAssistedListing.updateMany({
    where: { ownerUserId: user.id, ownerEmailStatus: "PENDING" },
    data: { ownerEmailStatus: "REJECTED", ownerEmailDecidedAt: new Date() },
  });
  await deleteContactChangeChallenge(user.id, "email");
  return true;
}
