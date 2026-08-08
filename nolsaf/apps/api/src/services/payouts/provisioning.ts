/**
 * Payout Account Provisioning
 *
 * Owners have a self-service screen to register a PayoutAccount
 * (owner.payouts.ts). Tour operators, drivers and sales partners don't —
 * but their mobile money / bank details already exist in User.payout
 * (the same JSON field owners' details come from), because each of their
 * own profile screens already collects it. This module turns that existing
 * data into a verified PayoutAccount on demand, instead of requiring a
 * second data-entry step admin would have to invent from scratch.
 *
 * Explicitly admin-triggered (a button on the Disbursements request form),
 * not automatic — provisioning fires a real AzamPay Name Lookup call, and
 * that should be a deliberate action, not a side effect of loading a page.
 */

import { prisma } from "@nolsaf/prisma";
import { loadEligiblePayoutSource, type PayoutSourceType } from "./eligibility.js";
import { azamPayNameLookup } from "../azampay/disbursement/client.js";
import { AzamPayDisburseError } from "../azampay/disbursement/errors.js";
import type { AzamPayDisburseBankName } from "../azampay/disbursement/types.js";
import { decrypt } from "../../lib/crypto.js";

/**
 * Account/mobile numbers are stored encrypted in User.payout (see account.ts).
 * Return the plaintext number: decrypt() throws both for genuinely bad data
 * and for values that are already plaintext (its own guard), so on failure we
 * fall back to the raw value, mirroring how account.ts reads these fields back.
 */
function decryptPayoutValue(raw: string): string {
  const trimmed = String(raw).trim();
  try {
    return decrypt(trimmed, { log: false });
  } catch {
    return trimmed;
  }
}

export class NoPayoutProfileError extends Error {
  constructor(userId: number) {
    super(`User ${userId} has no payout details on file (User.payout is empty) — ask them to add one in their profile first.`);
    this.name = "NoPayoutProfileError";
  }
}

interface UserPayoutProfile {
  payoutPreferred?: string | null;
  bankAccountName?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  mobileMoneyProvider?: string | null;
  mobileMoneyNumber?: string | null;
}

function extractDestination(profile: UserPayoutProfile): { type: "MOBILE_MONEY" | "BANK"; provider: string; accountNumber: string } | null {
  const preferred = String(profile.payoutPreferred || "").toUpperCase();
  const hasMobile = profile.mobileMoneyProvider && profile.mobileMoneyNumber;
  const hasBank = profile.bankName && profile.bankAccountNumber;

  if (preferred === "BANK" && hasBank) {
    return { type: "BANK", provider: profile.bankName!, accountNumber: decryptPayoutValue(profile.bankAccountNumber!) };
  }
  if (hasMobile) {
    return { type: "MOBILE_MONEY", provider: profile.mobileMoneyProvider!, accountNumber: decryptPayoutValue(profile.mobileMoneyNumber!) };
  }
  if (hasBank) {
    return { type: "BANK", provider: profile.bankName!, accountNumber: decryptPayoutValue(profile.bankAccountNumber!) };
  }
  return null;
}

export interface ProvisionResult {
  account: { id: number; type: string; provider: string; accountNumber: string; accountName: string; isVerified: boolean };
  verificationWarning: string | null;
  reused: boolean;
}

/**
 * Resolves the payee for a source, reads their existing profile payout
 * details, and creates (or reuses) a PayoutAccount, attempting an AzamPay
 * Name Lookup to verify it. Mirrors owner.payouts.ts's own account
 * registration, minus the owner typing anything in — the data already
 * exists on their profile.
 */
export async function provisionPayoutAccountFromProfile(
  sourceType: PayoutSourceType,
  sourceId: number
): Promise<ProvisionResult> {
  const source = await loadEligiblePayoutSource(sourceType, sourceId);

  const user = await prisma.user.findUnique({ where: { id: source.payeeUserId }, select: { name: true, payout: true } });
  const profile = (user?.payout && typeof user.payout === "object" ? (user.payout as UserPayoutProfile) : {}) ?? {};
  const destination = extractDestination(profile);
  if (!destination) throw new NoPayoutProfileError(source.payeeUserId);

  const existing = await prisma.payoutAccount.findFirst({
    where: { userId: source.payeeUserId, provider: destination.provider, accountNumber: destination.accountNumber },
  });
  if (existing) {
    return {
      account: {
        id: existing.id,
        type: existing.type,
        provider: existing.provider,
        accountNumber: existing.accountNumber,
        accountName: existing.accountName,
        isVerified: existing.isVerified,
      },
      verificationWarning: existing.isVerified ? null : "This account exists but is not yet verified by AzamPay.",
      reused: true,
    };
  }

  let accountName = profile.bankAccountName || user?.name || `User #${source.payeeUserId}`;
  let isVerified = false;
  let verifiedAt: Date | null = null;
  let verificationWarning: string | null = null;

  try {
    const lookup = await azamPayNameLookup({
      bankName: destination.provider as AzamPayDisburseBankName,
      accountNumber: destination.accountNumber,
    });
    accountName = lookup.name || accountName;
    isVerified = Boolean(lookup.status);
    verifiedAt = isVerified ? new Date() : null;
  } catch (err) {
    verificationWarning =
      err instanceof AzamPayDisburseError
        ? `AzamPay verification unavailable: ${err.providerMessage ?? err.message}`
        : err instanceof Error
          ? `AzamPay verification unavailable: ${err.message}`
          : "AzamPay verification unavailable";
  }

  const created = await prisma.payoutAccount.create({
    data: {
      userId: source.payeeUserId,
      type: destination.type,
      provider: destination.provider,
      accountNumber: destination.accountNumber,
      accountName,
      isVerified,
      verifiedAt,
    },
  });

  return {
    account: {
      id: created.id,
      type: created.type,
      provider: created.provider,
      accountNumber: created.accountNumber,
      accountName: created.accountName,
      isVerified: created.isVerified,
    },
    verificationWarning,
    reused: false,
  };
}
