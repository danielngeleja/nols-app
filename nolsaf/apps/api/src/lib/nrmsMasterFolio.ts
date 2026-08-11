import crypto from "crypto";

export const MASTER_BILLING_MODES = ["SPLIT", "MASTER"] as const;
export const STRICT_MASTER_SETTLEMENT_POLICY = "PAY_BEFORE_DEPARTURE";

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

export function billingUsesMasterFolio(mode: unknown): boolean {
  return MASTER_BILLING_MODES.includes(String(mode || "").toUpperCase() as (typeof MASTER_BILLING_MODES)[number]);
}

export function billingRoutesExtras(mode: unknown): boolean {
  return String(mode || "").toUpperCase() === "MASTER";
}

export async function getMasterFolioTotals(tx: any, masterFolioId: number) {
  const [items, payments] = await Promise.all([
    tx.nrmsMasterFolioItem.aggregate({
      where: { masterFolioId, voidedAt: null },
      _sum: { amount: true },
    }),
    tx.nrmsMasterFolioPayment.aggregate({
      where: { masterFolioId, voidedAt: null },
      _sum: { amount: true },
    }),
  ]);
  const billed = money(items._sum.amount);
  const paid = money(payments._sum.amount);
  return { billed, paid, balance: money(billed - paid) };
}

export async function refreshMasterFolioStatus(tx: any, masterFolioId: number) {
  const totals = await getMasterFolioTotals(tx, masterFolioId);
  const status = totals.balance > 0.005 ? "OPEN" : totals.balance < -0.005 ? "CREDIT" : "SETTLED";
  await tx.nrmsMasterFolio.update({
    where: { id: masterFolioId },
    data: { status, settledAt: status === "SETTLED" ? new Date() : null },
  });
  return { ...totals, status };
}

export async function ensureMasterFolioForBlock(tx: any, block: any) {
  if (!billingUsesMasterFolio(block.billingMode)) return null;
  const billToName = String(block.agencyName || block.contactName || block.name || `Group ${block.reference}`).slice(0, 160);
  return tx.nrmsMasterFolio.upsert({
    where: { blockId: block.id },
    create: {
      blockId: block.id,
      propertyId: block.propertyId,
      ownerId: block.ownerId,
      reference: `MF-${block.reference}`.slice(0, 40),
      billingMode: block.billingMode,
      currency: block.currency,
      status: "OPEN",
      settlementPolicy: STRICT_MASTER_SETTLEMENT_POLICY,
      billToName,
      contactName: block.contactName || null,
      contactPhone: block.contactPhone || null,
      contactEmail: block.contactEmail || null,
    },
    // The commercial snapshot is frozen after first pickup. A retry only needs
    // the existing row and must not rewrite who accepted the original bill.
    update: {},
  });
}

export async function routeRoomToMasterFolio(tx: any, block: any, reservation: any) {
  if (!billingUsesMasterFolio(block.billingMode)) return null;
  const folio = await ensureMasterFolioForBlock(tx, block);
  const item = await tx.nrmsMasterFolioItem.upsert({
    where: { sourceKey: `ROOM:${reservation.id}` },
    create: {
      masterFolioId: folio.id,
      reservationId: reservation.id,
      sourceKey: `ROOM:${reservation.id}`,
      kind: "ROOM",
      description: `Room stay ${reservation.externalRef || reservation.id}`.slice(0, 300),
      amount: reservation.totalAmount,
      currency: reservation.currency,
    },
    update: {
      amount: reservation.totalAmount,
      currency: reservation.currency,
      description: `Room stay ${reservation.externalRef || reservation.id}`.slice(0, 300),
    },
  });
  await refreshMasterFolioStatus(tx, folio.id);
  return item;
}

/** Keep the routed room liability aligned with an allowed pre-arrival edit. */
export async function syncRoutedRoomAmount(tx: any, reservationId: number) {
  const reservation = await tx.reservation.findUnique({
    where: { id: reservationId },
    select: { id: true, groupId: true, externalRef: true, totalAmount: true, currency: true },
  });
  if (!reservation?.groupId) return null;
  const block = await tx.nrmsGroupBlock.findUnique({ where: { groupId: reservation.groupId } });
  if (!block || !billingUsesMasterFolio(block.billingMode)) return null;
  return routeRoomToMasterFolio(tx, block, reservation);
}

export async function routeChargeToMasterFolio(tx: any, charge: any) {
  const reservation = await tx.reservation.findUnique({
    where: { id: charge.reservationId },
    select: { id: true, groupId: true },
  });
  if (!reservation?.groupId) return null;
  const block = await tx.nrmsGroupBlock.findUnique({ where: { groupId: reservation.groupId } });
  if (!block || !billingRoutesExtras(block.billingMode)) return null;
  const folio = await ensureMasterFolioForBlock(tx, block);
  const item = await tx.nrmsMasterFolioItem.upsert({
    where: { sourceKey: `CHARGE:${charge.id}` },
    create: {
      masterFolioId: folio.id,
      reservationId: charge.reservationId,
      reservationChargeId: charge.id,
      sourceKey: `CHARGE:${charge.id}`,
      kind: "EXTRA",
      description: String(charge.description || `${charge.category || "EXTRA"} charge`).slice(0, 300),
      amount: charge.amount,
      currency: charge.currency,
    },
    update: {},
  });
  await refreshMasterFolioStatus(tx, folio.id);
  return item;
}

export async function voidRoutedCharge(tx: any, reservationChargeId: number, reason?: string | null) {
  const item = await tx.nrmsMasterFolioItem.findUnique({
    where: { reservationChargeId },
    select: { id: true, masterFolioId: true, voidedAt: true },
  });
  if (!item || item.voidedAt) return null;
  await tx.nrmsMasterFolioItem.update({
    where: { id: item.id },
    data: { voidedAt: new Date(), voidReason: reason || "Source charge voided" },
  });
  await refreshMasterFolioStatus(tx, item.masterFolioId);
  return item;
}

export async function voidRoutedRoom(tx: any, reservationId: number, reason?: string | null) {
  const item = await tx.nrmsMasterFolioItem.findUnique({
    where: { sourceKey: `ROOM:${reservationId}` },
    select: { id: true, masterFolioId: true, voidedAt: true },
  });
  if (!item || item.voidedAt) return null;
  await tx.nrmsMasterFolioItem.update({
    where: { id: item.id },
    data: { voidedAt: new Date(), voidReason: reason || "Reservation cancelled" },
  });
  await refreshMasterFolioStatus(tx, item.masterFolioId);
  return item;
}

export async function transferredToMasterForReservation(tx: any, reservationId: number): Promise<number> {
  const aggregate = await tx.nrmsMasterFolioItem.aggregate({
    where: { reservationId, voidedAt: null },
    _sum: { amount: true },
  });
  return money(aggregate._sum.amount);
}

export type MasterCheckoutBlocker = {
  code: "MASTER_FOLIO_MISSING" | "MASTER_BALANCE_DUE" | "MASTER_CREDIT_REMAINS";
  balance: number;
};

/**
 * Strict master settlement blocks a group batch before it becomes partial.
 * A single early-departing guest may leave once their own folio is clear, but
 * the last checked-in member cannot close the group around unpaid agency debt.
 */
export async function getMasterCheckoutBlocker(
  tx: any,
  groupId: number | null | undefined,
  options: { groupBatch?: boolean; reservationId?: number } = {},
): Promise<MasterCheckoutBlocker | null> {
  let block = groupId
    ? await tx.nrmsGroupBlock.findUnique({ where: { groupId }, include: { masterFolio: true } })
    : null;
  // Operational groups may be disbanded or a member may be detached without
  // erasing the commercial liability. Follow the routed item back to its block
  // so that cannot become a checkout escape hatch.
  if (!block && options.reservationId) {
    const routedItem = await tx.nrmsMasterFolioItem.findFirst({
      where: { reservationId: options.reservationId, voidedAt: null },
      include: { masterFolio: { include: { block: true } } },
    });
    if (routedItem?.masterFolio?.block) block = { ...routedItem.masterFolio.block, masterFolio: routedItem.masterFolio };
  }
  if (!block || !billingUsesMasterFolio(block.billingMode)) return null;
  if (!block.masterFolio) return { code: "MASTER_FOLIO_MISSING", balance: 0 };
  if (block.masterFolio.settlementPolicy !== STRICT_MASTER_SETTLEMENT_POLICY) return null;

  if (!options.groupBatch && options.reservationId) {
    const otherInHouse = await tx.nrmsMasterFolioItem.count({
      where: {
        masterFolioId: block.masterFolio.id,
        voidedAt: null,
        reservationId: { not: options.reservationId },
        reservation: { status: "CHECKED_IN" },
      },
    });
    if (otherInHouse > 0) return null;
  }

  const { balance } = await getMasterFolioTotals(tx, block.masterFolio.id);
  if (balance > 0.005) return { code: "MASTER_BALANCE_DUE", balance };
  if (balance < -0.005) return { code: "MASTER_CREDIT_REMAINS", balance };
  return null;
}

export function buildMasterPaymentReceiptNumber(masterFolioId: number): string {
  return `MFP-${masterFolioId}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`.slice(0, 40);
}
