import { refreshMasterFolioStatus, STRICT_MASTER_SETTLEMENT_POLICY } from "./nrmsMasterFolio.js";

const money = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

export function agentInvoiceInclude() {
  return {
    items: { orderBy: { createdAt: "asc" as const } },
    payments: { orderBy: { createdAt: "asc" as const } },
    refunds: { orderBy: { createdAt: "asc" as const } },
    proFormas: { orderBy: { revision: "desc" as const } },
  };
}

/**
 * Establish the property-owned commercial ledger for one approved agent stay.
 * The room quote remains the immutable gross amount; an owner discount is a
 * separate negative ledger item so every invoice revision explains the change.
 */
export async function ensureAgentMasterFolio(tx: any, request: any, discountAmount = 0, discountReason?: string | null) {
  if (!request.reservationId) throw new Error("NRMS_AGENT_RESERVATION_REQUIRED");
  const account = request.link?.agentAccount;
  const contactEmail = String(account?.contactEmail || account?.primaryUser?.email || "").trim().toLowerCase();
  const contactName = String(account?.contactName || account?.tradingName || account?.legalName || "").trim();
  if (!contactEmail || !contactName) throw new Error("NRMS_PRO_FORMA_CONTACT_REQUIRED");
  const gross = money(request.quotedTotal);
  const discount = money(discountAmount);
  if (discount < 0 || discount > gross) throw new Error("NRMS_AGENT_DISCOUNT_INVALID");

  const folio = await tx.nrmsMasterFolio.upsert({
    where: { agentBookingRequestId: request.id },
    create: {
      agentBookingRequestId: request.id,
      propertyId: request.propertyId,
      ownerId: request.property.ownerId,
      reference: `AF-${String(request.id).padStart(6, "0")}`,
      billingMode: "SPLIT",
      currency: request.currency,
      status: "OPEN",
      settlementPolicy: STRICT_MASTER_SETTLEMENT_POLICY,
      billToName: String(account?.tradingName || account?.legalName || contactName).slice(0, 160),
      contactName: contactName.slice(0, 160),
      contactPhone: account?.contactPhone || null,
      contactEmail: contactEmail.slice(0, 160),
    },
    update: {},
  });
  await tx.nrmsMasterFolioItem.upsert({
    where: { sourceKey: `AGENT_ROOM:${request.id}` },
    create: {
      masterFolioId: folio.id,
      reservationId: request.reservationId,
      sourceKey: `AGENT_ROOM:${request.id}`,
      kind: "ROOM",
      description: `${request.roomsRequested} × ${request.roomType?.name || "Accommodation"}`.slice(0, 300),
      amount: gross,
      currency: request.currency,
    },
    update: { amount: gross, currency: request.currency, voidedAt: null, voidReason: null },
  });
  const existingDiscount = await tx.nrmsMasterFolioItem.findUnique({ where: { sourceKey: `AGENT_DISCOUNT:${request.id}` } });
  if (discount > 0) {
    await tx.nrmsMasterFolioItem.upsert({
      where: { sourceKey: `AGENT_DISCOUNT:${request.id}` },
      create: {
        masterFolioId: folio.id,
        reservationId: request.reservationId,
        sourceKey: `AGENT_DISCOUNT:${request.id}`,
        kind: "EXTRA",
        description: `Commercial discount${discountReason ? ` · ${discountReason}` : ""}`.slice(0, 300),
        amount: -discount,
        currency: request.currency,
      },
      update: {
        description: `Commercial discount${discountReason ? ` · ${discountReason}` : ""}`.slice(0, 300),
        amount: -discount,
        voidedAt: null,
        voidReason: null,
      },
    });
  } else if (existingDiscount && !existingDiscount.voidedAt) {
    await tx.nrmsMasterFolioItem.update({ where: { id: existingDiscount.id }, data: { voidedAt: new Date(), voidReason: "Discount removed in later invoice revision" } });
  }
  await tx.reservation.update({
    where: { id: request.reservationId },
    data: { totalAmount: money(gross - discount), discountAmount: discount },
  });
  await refreshMasterFolioStatus(tx, folio.id);
  return tx.nrmsMasterFolio.findUnique({ where: { id: folio.id }, include: agentInvoiceInclude() });
}

/** Shape understood by the shared group Pro Forma generator. */
export function agentProFormaSource(request: any, masterFolio: any) {
  const start = new Date(request.checkIn).getTime();
  const end = new Date(request.checkOut).getTime();
  const nights = Math.max(1, Math.round((end - start) / 86_400_000));
  const quantity = Math.max(1, Number(request.roomsRequested));
  const nightlyRate = money(Number(request.quotedTotal) / quantity / nights);
  const account = request.link.agentAccount;
  return {
    id: request.id,
    propertyId: request.propertyId,
    ownerId: request.property.ownerId,
    property: request.property,
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    currency: request.currency,
    name: account.tradingName || account.legalName,
    reference: `AGB-${String(request.id).padStart(6, "0")}`,
    agencyName: account.tradingName || account.legalName,
    contactName: account.contactName || account.tradingName || account.legalName,
    contactEmail: account.contactEmail || account.primaryUser?.email,
    contactPhone: account.contactPhone || null,
    rooms: [{
      quantity,
      nightlyRate,
      amount: money(request.quotedTotal),
      roomType: { name: request.roomType?.name || "Accommodation" },
      ratePlan: { name: "Negotiated agent rate" },
    }],
    masterFolio,
  };
}
