import crypto from "node:crypto";
import { getMasterFolioPayableBalance } from "./nrmsMasterFolio.js";
import { checkOrchestrationGate } from "../services/payments/config.js";
import { resolveMerchantLink, resolvePayableMerchant } from "../services/payments/merchants.js";
import { resolveRoute } from "../services/payments/routing.js";
import { loadRoutingCandidates } from "../services/payments/routingStore.js";
import type { PaymentChannel } from "../services/payments/types.js";

export const MASTER_FOLIO_PAYMENT_LINK_TTL_MS = 3 * 60 * 60 * 1000;
export const MASTER_FOLIO_PAYMENT_LINK_LIVE_STATUSES = ["ACTIVE", "PROCESSING"];
/** Checkouts an agency may start for itself from one Pro Forma per rolling day. */
export const AGENCY_SELF_SERVE_DAILY_LIMIT = 5;

export function masterFolioPaymentUrl(token: string): string {
  const origin = String(process.env.WEB_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "https://nolsaf.com").replace(/\/$/, "");
  return `${origin}/nrms/group/payment/${encodeURIComponent(token)}`;
}

export async function issueMasterFolioPaymentLink(
  db: any,
  masterFolioId: number,
  createdById: number | null,
  options: { reuseMatching?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const folio = await db.nrmsMasterFolio.findUnique({
    where: { id: masterFolioId },
    select: { id: true, currency: true, status: true },
  });
  if (!folio) throw new Error("NRMS_MASTER_FOLIO_MISSING");
  // The link carries the same amount the desk would accept by hand, including
  // an advance against the Pro Forma before any room has been billed.
  const { payableBalance } = await getMasterFolioPayableBalance(db, masterFolioId);
  if (payableBalance <= 0.005) throw new Error("NRMS_MASTER_PAYMENT_COMPLETE");

  if (options.reuseMatching) {
    const existing = await db.nrmsMasterFolioPaymentLink.findFirst({
      where: {
        masterFolioId,
        status: { in: MASTER_FOLIO_PAYMENT_LINK_LIVE_STATUSES },
        expiresAt: { gt: now },
        amount: payableBalance,
        currency: folio.currency,
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;
  }

  const processing = await db.nrmsMasterFolioPaymentLink.findFirst({
    where: { masterFolioId, status: "PROCESSING", expiresAt: { gt: now } },
    select: { id: true },
  });
  if (processing) throw new Error("NRMS_MASTER_PAYMENT_IN_FLIGHT");

  await db.nrmsMasterFolioPaymentLink.updateMany({
    where: { masterFolioId, status: { in: MASTER_FOLIO_PAYMENT_LINK_LIVE_STATUSES } },
    data: { status: "REVOKED", revokedAt: now },
  });
  return db.nrmsMasterFolioPaymentLink.create({
    data: {
      masterFolioId,
      publicToken: crypto.randomBytes(24).toString("base64url"),
      amount: payableBalance,
      currency: folio.currency,
      status: "ACTIVE",
      expiresAt: new Date(now.getTime() + MASTER_FOLIO_PAYMENT_LINK_TTL_MS),
      createdById,
    },
  });
}

export function serializeMasterFolioPaymentLink(link: any) {
  if (!link) return null;
  return {
    amount: Number(link.amount),
    currency: link.currency,
    status: link.status,
    expiresAt: link.expiresAt,
    url: masterFolioPaymentUrl(link.publicToken),
  };
}

/** Which online channels this property can take for an agency account right now. */
export async function masterFolioPaymentOptions(db: any, input: { propertyId: number; currency: string }) {
  const gate = checkOrchestrationGate();
  if (!gate.ok) return { available: false, channels: [] as PaymentChannel[], provider: null as string | null, message: "Online payment is being prepared for this property." };
  const merchantLink = await resolveMerchantLink(db, { propertyId: input.propertyId });
  if (!merchantLink) return { available: false, channels: [] as PaymentChannel[], provider: null as string | null, message: "Online payment setup is not complete for this property." };
  const candidates = await loadRoutingCandidates(db, { merchantId: merchantLink.merchantId, propertyId: input.propertyId, outletId: null });
  const channels: PaymentChannel[] = [];
  let provider: string | null = null;
  for (const channel of ["MNO", "BANK"] as const) {
    const route = resolveRoute(candidates, { merchantId: merchantLink.merchantId, propertyId: input.propertyId, outletId: null, purpose: "MASTER_FOLIO", currency: input.currency, channel });
    if (!route.ok) continue;
    const payable = await resolvePayableMerchant(db, { propertyId: input.propertyId, connectionId: route.connectionId, channel, currency: input.currency });
    if (!payable.ok || route.provider !== "AZAMPAY") continue;
    channels.push(channel);
    provider = route.provider;
  }
  const contractReady = process.env.AZAMPAY_OWNER_COLLECTION_CONTRACT_CONFIRMED === "true"
    && Boolean(process.env.AZAMPAY_OWNER_MERCHANT_FIELD)
    && Boolean(process.env.AZAMPAY_OWNER_WALLET_FIELD);
  return {
    available: channels.length > 0 && contractReady,
    channels: contractReady ? channels : [],
    provider: channels.length ? provider : null,
    message: channels.length === 0
      ? "Online payment setup is not complete for this property."
      : contractReady ? null : "AzamPay owner-payment activation is awaiting the confirmed merchant routing contract.",
  };
}

/**
 * Why a Pro Forma cannot be paid online by the agency itself, or null when it
 * can. Kept pure so the public view and the Pay online action agree.
 */
export function agencyProFormaPayBlocker(
  record: { status: string; validUntil: Date | string; masterFolioId: number },
  now: Date = new Date(),
): { code: string; message: string } | null {
  if (!["DRAFT", "SENT"].includes(record.status)) return { code: "SUPERSEDED", message: "A newer Pro Forma replaced this one. Use the latest copy from the property." };
  // validUntil is a calendar date; the whole of that day still counts.
  const lastDay = new Date(record.validUntil);
  lastDay.setUTCHours(23, 59, 59, 999);
  if (lastDay.getTime() < now.getTime()) return { code: "EXPIRED", message: "This Pro Forma has passed its validity date. Ask the property to issue a new revision." };
  return null;
}

/**
 * The Pro Forma an agency should pay from after a checkout link dies: the
 * newest one still in force for this account, or null.
 */
export async function currentAgencyProFormaToken(db: any, masterFolioId: number, now: Date = new Date()): Promise<string | null> {
  const latest = await db.nrmsMasterFolioProForma.findFirst({
    where: { masterFolioId, status: { in: ["DRAFT", "SENT"] } },
    orderBy: { revision: "desc" },
    select: { status: true, validUntil: true, masterFolioId: true, publicToken: true },
  });
  if (!latest || agencyProFormaPayBlocker(latest, now)) return null;
  return latest.publicToken;
}
