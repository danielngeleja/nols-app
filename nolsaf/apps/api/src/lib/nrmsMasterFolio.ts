import crypto from "crypto";
import { agentCoverDecision } from "./nrmsAgentIncidentals.js";

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

/**
 * Read-only settlement context for a reservation whose liability was routed to
 * a group master folio. This deliberately does not allocate the agency's one
 * payment across guest payment rows; it only gives reservation views enough
 * context to describe who paid and whether the group bill is truly clear.
 */
export function summarizeReservationMasterSettlement(group: any, transferredAmount: unknown) {
  const transferred = money(transferredAmount);
  const block = group?.block;
  const folio = block?.masterFolio;
  if (transferred <= 0.005 || !folio || !billingUsesMasterFolio(block?.billingMode ?? folio.billingMode)) return null;

  const methods = [...new Set(
    (folio.payments ?? [])
      .filter((payment: any) => !payment.voidedAt)
      .map((payment: any) => String(payment.method || "").trim().toUpperCase())
      .filter(Boolean),
  )];
  const status = String(folio.status || "OPEN").toUpperCase();

  return {
    // GROUP means the room charge was moved off this reservation's folio onto
    // the master, so the two amounts are separate money and add up. Callers
    // must not add them for an agent booking, where they are the same payment.
    source: "GROUP" as const,
    billingMode: String(block?.billingMode ?? folio.billingMode).toUpperCase(),
    masterFolioReference: String(folio.reference),
    status,
    settled: status === "SETTLED" || status === "CREDIT",
    settledAt: folio.settledAt ?? null,
    methods,
  };
}

/**
 * The same context for an agent booking. A master folio hangs off either a
 * group block or an agent booking request, and an agency stay is invoiced on
 * that folio directly rather than transferred there from a guest folio, so
 * there is no transferred amount to gate on.
 */
export function summarizeAgentBookingSettlement(request: any) {
  const folio = request?.masterFolio;
  if (!folio) return null;

  const live = (folio.payments ?? []).filter((payment: any) => !payment.voidedAt);
  const methods = [...new Set(
    live
      .map((payment: any) => String(payment.method || "").trim().toUpperCase())
      .filter(Boolean),
  )];
  const status = String(folio.status || "OPEN").toUpperCase();
  // What the agency has actually paid. An agent booking is one folio for one
  // booking, so this belongs to the reservation exactly; a group folio covers
  // many members at once and cannot be attributed to any single one, which is
  // why the group summary deliberately has no equivalent field.
  const paidAmount = live.reduce((sum: number, payment: any) => sum + money(payment.amount), 0);

  return {
    // The agency's payment is already recorded against the reservation, and the
    // room also sits on this folio. Adding the two would count one payment
    // twice, so this source never contributes to a paid total.
    source: "AGENT_BOOKING" as const,
    paidAmount,
    billingMode: String(folio.billingMode || "MASTER").toUpperCase(),
    masterFolioReference: String(folio.reference),
    status,
    settled: status === "SETTLED" || status === "CREDIT",
    settledAt: folio.settledAt ?? null,
    methods,
  };
}

export type GroupChargeRegisterRow = {
  id: string;
  occurredAt: Date | string;
  sourceType: "ROOM" | "OUTLET_ORDER" | "MANUAL_CHARGE" | "FOLIO_ADJUSTMENT";
  sourceReference: string;
  category: string;
  description: string;
  outlet: string | null;
  orderStatus: string | null;
  reservationId: number;
  reservationStatus: string;
  guestName: string;
  room: string;
  payer: "AGENCY" | "GUEST";
  destination: string;
  settlementStatus: "PAID_BY_AGENCY" | "AGENCY_DUE" | "GUEST_FOLIO_SETTLED" | "GUEST_DUE" | "VOIDED";
  documentRevisionRequired: boolean;
  amount: number;
  currency: string;
};

/**
 * One read model for explaining every group liability from its operational
 * source to the folio that owns it. It never allocates payments or mutates the
 * ledger; the register is derived entirely from authoritative rows.
 */
export function buildGroupChargeRegister(block: any): { rows: GroupChargeRegisterRow[]; revisionRequired: boolean } {
  const reservations = block?.group?.reservations ?? [];
  const folio = block?.masterFolio ?? null;
  const allMasterItems = folio?.items ?? [];
  const activeMasterItems = allMasterItems.filter((item: any) => !item.voidedAt);
  const currentProForma = (folio?.proFormas ?? []).find((record: any) => !record.supersededAt && record.status !== "SUPERSEDED") ?? null;
  const proFormaIssuedAt = currentProForma?.issuedAt ? new Date(currentProForma.issuedAt).getTime() : null;
  const agencySettled = ["SETTLED", "CREDIT"].includes(String(folio?.status || "").toUpperCase());
  const rows: GroupChargeRegisterRow[] = [];

  for (const reservation of reservations) {
    const reservationItems = activeMasterItems.filter((item: any) => item.reservationId === reservation.id);
    const transferred = reservationItems.reduce((sum: number, item: any) => sum + money(item.amount), 0);
    const activeCharges = (reservation.charges ?? []).filter((charge: any) => !charge.voidedAt);
    const guestBalance = money(
      money(reservation.totalAmount)
      + activeCharges.reduce((sum: number, charge: any) => sum + money(charge.amount), 0)
      - money(reservation.amountPaid)
      - transferred,
    );
    const room = (reservation.allocations ?? [])
      .map((allocation: any) => allocation.roomUnit?.code ?? allocation.roomType?.name)
      .filter(Boolean)
      .join(", ") || "Unassigned";
    const guestName = reservation.guestProfile?.fullName || "Guest not recorded";
    const reservationVoided = ["CANCELLED", "NO_SHOW", "EXPIRED"].includes(String(reservation.status || "").toUpperCase());
    // A stay can carry more than one room line once a bill has been re-cut: the
    // live line, and a voided one it replaced. The live line is the truth, so
    // the register shows that and only falls back to a voided line when the
    // room really was withdrawn.
    const roomItem = activeMasterItems.find((item: any) => item.reservationId === reservation.id && item.kind === "ROOM")
      ?? allMasterItems.find((item: any) => item.reservationId === reservation.id && item.kind === "ROOM");
    const roomPayer: "AGENCY" | "GUEST" = roomItem ? "AGENCY" : "GUEST";

    if (money(reservation.totalAmount) > 0.005 || roomItem) {
      rows.push({
        id: roomItem ? `MASTER_ITEM:${roomItem.id}` : `ROOM:${reservation.id}`,
        occurredAt: roomItem?.createdAt ?? reservation.createdAt,
        sourceType: "ROOM",
        sourceReference: reservation.externalRef || `Reservation ${reservation.id}`,
        category: "ROOM",
        description: roomItem?.description || "Room accommodation",
        outlet: null,
        orderStatus: null,
        reservationId: reservation.id,
        reservationStatus: reservation.status,
        guestName,
        room,
        payer: roomPayer,
        destination: roomPayer === "AGENCY" ? (currentProForma?.number || folio?.reference || "Agency master folio") : `Guest folio · ${reservation.externalRef || reservation.id}`,
        settlementStatus: reservationVoided || roomItem?.voidedAt
          ? "VOIDED"
          : roomPayer === "AGENCY"
            ? agencySettled ? "PAID_BY_AGENCY" : "AGENCY_DUE"
            : guestBalance <= 0.005 ? "GUEST_FOLIO_SETTLED" : "GUEST_DUE",
        documentRevisionRequired: false,
        amount: money(roomItem?.amount ?? reservation.totalAmount),
        currency: roomItem?.currency || reservation.currency,
      });
    }

    for (const charge of reservation.charges ?? []) {
      const masterItem = allMasterItems.find((item: any) => item.reservationChargeId === charge.id);
      // A void preserves the original routing for audit display even though it
      // removes the amount from every live balance.
      const payer: "AGENCY" | "GUEST" = masterItem ? "AGENCY" : "GUEST";
      const occurredAt = masterItem?.createdAt ?? charge.createdAt;
      const revisionRequired = Boolean(
        payer === "AGENCY"
        && currentProForma
        && proFormaIssuedAt != null
        && new Date(occurredAt).getTime() > proFormaIssuedAt,
      );
      const order = charge.outletOrder ?? null;
      rows.push({
        id: masterItem ? `MASTER_ITEM:${masterItem.id}` : `CHARGE:${charge.id}`,
        occurredAt,
        sourceType: order ? "OUTLET_ORDER" : "MANUAL_CHARGE",
        sourceReference: order?.orderNumber || `Charge ${charge.id}`,
        category: charge.category || masterItem?.kind || "EXTRA",
        description: charge.description || masterItem?.description || "Guest extra",
        outlet: order?.outlet?.name ?? null,
        orderStatus: order?.status ?? null,
        reservationId: reservation.id,
        reservationStatus: reservation.status,
        guestName,
        room,
        payer,
        destination: payer === "AGENCY" ? (currentProForma?.number || folio?.reference || "Agency master folio") : `Guest folio · ${reservation.externalRef || reservation.id}`,
        settlementStatus: charge.voidedAt || masterItem?.voidedAt
          ? "VOIDED"
          : payer === "AGENCY"
            ? agencySettled ? "PAID_BY_AGENCY" : "AGENCY_DUE"
            : guestBalance <= 0.005 ? "GUEST_FOLIO_SETTLED" : "GUEST_DUE",
        documentRevisionRequired: revisionRequired,
        amount: money(masterItem?.amount ?? charge.amount),
        currency: masterItem?.currency || charge.currency || reservation.currency,
      });
    }
  }

  // Lines on the agency bill that belong to no single stay: a commercial
  // discount, or anything raised against a booking record rather than a room.
  // Leaving them out made the register's agency total disagree with the invoice
  // it is meant to explain, which is the one thing a register must never do.
  // Live items only. A voided line is already visible against its own stay when
  // it has one, and a retired adjustment is history the register does not need
  // to repeat.
  const accountedItemIds = new Set(rows.map((row) => row.id));
  for (const item of activeMasterItems) {
    const id = `MASTER_ITEM:${item.id}`;
    if (accountedItemIds.has(id)) continue;
    rows.push({
      id,
      occurredAt: item.createdAt,
      sourceType: "FOLIO_ADJUSTMENT",
      sourceReference: currentProForma?.number || folio?.reference || "Agency master folio",
      category: item.kind || "ADJUSTMENT",
      description: item.description || (money(item.amount) < 0 ? "Adjustment" : "Agency charge"),
      outlet: null,
      orderStatus: null,
      reservationId: item.reservationId ?? 0,
      reservationStatus: "N/A",
      guestName: folio?.billToName || "Agency account",
      room: "Whole booking",
      payer: "AGENCY",
      destination: currentProForma?.number || folio?.reference || "Agency master folio",
      settlementStatus: agencySettled ? "PAID_BY_AGENCY" : "AGENCY_DUE",
      documentRevisionRequired: false,
      amount: money(item.amount),
      currency: item.currency || folio?.currency || "TZS",
    });
  }

  rows.sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  return { rows, revisionRequired: rows.some((row) => row.documentRevisionRequired && row.settlementStatus !== "VOIDED") };
}

export type MasterFolioJoinConflict = "CURRENCY_MISMATCH" | "GUEST_PAYMENT_RECORDED" | "OTHER_MASTER_FOLIO";

/**
 * Moving an existing stay onto an agency bill is safe only before money has
 * landed on the guest folio and while no other agency already owns liability.
 */
export function masterFolioJoinConflict(
  reservation: {
    currency: string;
    payments?: Array<{ amount: unknown }>;
    masterFolioItems?: Array<{ masterFolioId: number }>;
  },
  masterFolio: { id: number; currency: string },
): MasterFolioJoinConflict | null {
  if (reservation.currency !== masterFolio.currency) return "CURRENCY_MISMATCH";
  const guestPaid = (reservation.payments ?? []).reduce((sum, payment) => sum + money(payment.amount), 0);
  if (guestPaid > 0.005) return "GUEST_PAYMENT_RECORDED";
  if ((reservation.masterFolioItems ?? []).some((item) => item.masterFolioId !== masterFolio.id)) return "OTHER_MASTER_FOLIO";
  return null;
}

export async function getMasterFolioTotals(tx: any, masterFolioId: number) {
  const [items, payments, refunds] = await Promise.all([
    tx.nrmsMasterFolioItem.aggregate({
      where: { masterFolioId, voidedAt: null },
      _sum: { amount: true },
    }),
    tx.nrmsMasterFolioPayment.aggregate({
      where: { masterFolioId, voidedAt: null },
      _sum: { amount: true },
    }),
    tx.nrmsMasterFolioRefund?.aggregate
      ? tx.nrmsMasterFolioRefund.aggregate({
          where: { masterFolioId, voidedAt: null },
          _sum: { amount: true },
        })
      : Promise.resolve({ _sum: { amount: null } }),
  ]);
  const billed = money(items._sum.amount);
  const paymentsReceived = money(payments._sum.amount);
  const refunded = money(refunds._sum.amount);
  const paid = money(paymentsReceived - refunded);
  return { billed, paymentsReceived, refunded, paid, balance: money(billed - paid) };
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
  // An agency booking was invoiced for its rooms before any of them became a
  // stay, and that invoice is the contract. Routing a room here would charge it
  // a second time, and re-syncing after a desk edit would silently re-price a
  // settled bill. Changing what the agency owes is an invoice revision, which
  // is a deliberate act elsewhere, never a side effect of editing one room.
  if (folio.agentBookingRequestId != null) return null;
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
  // An agency only pays for what it declared it would pay for.
  const cover = await agentCoverDecision(tx, folio.id, charge);
  if (!cover.route) return null;
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

export function buildMasterRefundNumber(masterFolioId: number): string {
  return `MFR-${masterFolioId}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`.slice(0, 40);
}
