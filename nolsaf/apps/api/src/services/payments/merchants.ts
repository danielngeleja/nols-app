/**
 * Resolves which merchant, provider account and wallet a payment must reach.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * This is the module that decides whose money it is. Every refusal here is
 * final: there is no path that answers "route it to NoLSAF instead". If a
 * property has no active merchant, or the merchant's provider account is not
 * ACTIVE, or the chosen channel is not enabled on that account, or no wallet
 * exists for the currency, then online payment is unavailable for that
 * property and the checkout says so. Falling back to the platform's own
 * merchant account would silently make NoLSAF the recipient of an owner's
 * money, which is the single outcome this whole design exists to prevent.
 *
 * The database handle is typed loosely, matching the convention already used
 * by nrmsOrders and the other NRMS services, so the same function works
 * against a client or an interactive transaction.
 */

import { canOriginatePayment, isMerchantAccountStatus, type PaymentChannel } from "./types.js";

export type PayableMerchant = {
  merchantId: number;
  providerAccountId: number;
  walletId: number;
  /** Provider-native identifiers, frozen onto the intent before any call. */
  providerMerchantId: string;
  providerWalletId: string;
};

export type MerchantRefusalCode =
  | "no_merchant_link"
  | "merchant_not_active"
  | "no_provider_account"
  | "provider_account_not_active"
  | "channel_not_enabled"
  | "no_wallet_for_currency"
  | "provider_identifiers_missing";

export type PayableMerchantResult =
  | { ok: true; merchant: PayableMerchant }
  | { ok: false; code: MerchantRefusalCode; message: string };

/** One message for every refusal. The payer learns nothing about why. */
const UNAVAILABLE = "Online payment is not available for this property.";

function linkIsInEffect(link: { effectiveFrom: Date; effectiveTo: Date | null }, at: Date): boolean {
  if (link.effectiveFrom.getTime() > at.getTime()) return false;
  if (link.effectiveTo !== null && link.effectiveTo.getTime() <= at.getTime()) return false;
  return true;
}

/**
 * Finds the merchant link governing a sale.
 *
 * An outlet-scoped link wins over the property-wide one, because an outlet
 * link is only ever created when a provider contract deliberately establishes
 * a separate merchant for that bar or restaurant. Absent one, the property's
 * merchant receives outlet money like everything else.
 */
export async function resolveMerchantLink(
  db: any,
  input: { propertyId: number; outletId?: number | null; at?: Date }
): Promise<{ merchantId: number } | null> {
  const at = input.at ?? new Date();

  const links = await db.merchantPropertyLink.findMany({
    where: {
      propertyId: input.propertyId,
      OR: [{ outletId: null }, ...(input.outletId ? [{ outletId: input.outletId }] : [])],
    },
    select: {
      merchantId: true,
      outletId: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });

  const live = (links as Array<{
    merchantId: number;
    outletId: number | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }>).filter((link) => linkIsInEffect(link, at));

  if (live.length === 0) return null;

  const outletScoped = live.find((link) => link.outletId !== null);
  const chosen = outletScoped ?? live.find((link) => link.outletId === null);
  return chosen ? { merchantId: chosen.merchantId } : null;
}

/**
 * Full eligibility resolution for one collection.
 *
 * Runs the checks in the order an operator would want to fix them, so the
 * refusal code names the first genuinely blocking problem rather than a
 * downstream symptom of it.
 */
export async function resolvePayableMerchant(
  db: any,
  input: {
    propertyId: number;
    outletId?: number | null;
    connectionId: number;
    channel: PaymentChannel;
    currency: string;
    at?: Date;
  }
): Promise<PayableMerchantResult> {
  const at = input.at ?? new Date();
  const currency = String(input.currency || "").toUpperCase();

  const link = await resolveMerchantLink(db, {
    propertyId: input.propertyId,
    outletId: input.outletId ?? null,
    at,
  });
  if (!link) return { ok: false, code: "no_merchant_link", message: UNAVAILABLE };

  const merchant = await db.merchantLegalEntity.findUnique({
    where: { id: link.merchantId },
    select: { id: true, status: true },
  });
  if (!merchant || merchant.status !== "ACTIVE") {
    return { ok: false, code: "merchant_not_active", message: UNAVAILABLE };
  }

  const account = await db.merchantProviderAccount.findUnique({
    where: {
      merchantId_connectionId: { merchantId: merchant.id, connectionId: input.connectionId },
    },
    select: { id: true, status: true, providerMerchantId: true },
  });
  if (!account) return { ok: false, code: "no_provider_account", message: UNAVAILABLE };

  // A status the schema does not recognise is treated as not-active rather
  // than compared loosely, so a future value added to the column cannot
  // accidentally become payable before this code knows what it means.
  if (!isMerchantAccountStatus(account.status) || !canOriginatePayment(account.status)) {
    return { ok: false, code: "provider_account_not_active", message: UNAVAILABLE };
  }

  const capability = await db.merchantChannelCapability.findUnique({
    where: {
      providerAccountId_channel: { providerAccountId: account.id, channel: input.channel },
    },
    select: { isEnabled: true },
  });
  if (!capability?.isEnabled) {
    return { ok: false, code: "channel_not_enabled", message: UNAVAILABLE };
  }

  const wallets = await db.merchantWallet.findMany({
    where: { providerAccountId: account.id, currency, isActive: true },
    select: { id: true, providerWalletId: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });
  const wallet = (wallets as Array<{ id: number; providerWalletId: string; isDefault: boolean }>)[0];
  if (!wallet) return { ok: false, code: "no_wallet_for_currency", message: UNAVAILABLE };

  // Routing needs both provider-native identifiers. An account marked ACTIVE
  // without them means the provider callback that activated it did not carry
  // what it should have, and sending a payment now would be a guess about the
  // destination.
  if (!account.providerMerchantId || !wallet.providerWalletId) {
    return { ok: false, code: "provider_identifiers_missing", message: UNAVAILABLE };
  }

  return {
    ok: true,
    merchant: {
      merchantId: merchant.id,
      providerAccountId: account.id,
      walletId: wallet.id,
      providerMerchantId: account.providerMerchantId,
      providerWalletId: wallet.providerWalletId,
    },
  };
}
