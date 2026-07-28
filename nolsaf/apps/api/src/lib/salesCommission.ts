import {
  CONTRACT_EARNING_STATUSES,
  VALIDATION_WINDOW_DAYS,
  commissionSourceKey,
} from "./salesPartner.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CommissionCalculation = {
  grossAmount: number;
  taxAmount: number;
  processingFeeAmount: number;
  refundAmount: number;
  discountAmount: number;
  eligibleNetRevenue: number;
  commissionRate: number;
  commissionAmount: number;
};

export type CommissionAccrualResult = {
  created: boolean;
  skippedReason?: string;
  commission?: any;
  partnerUserId?: number;
  propertyTitle?: string;
};

export function roundSalesMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function inclusiveTaxComponent(grossAmount: number, taxPercent: number): number {
  const gross = Math.max(0, Number(grossAmount) || 0);
  const rate = Math.max(0, Number(taxPercent) || 0);
  if (!gross || !rate) return 0;
  return roundSalesMoney(gross - gross / (1 + rate / 100));
}

export function exclusiveTaxAmount(grossAmount: number, taxPercent: number): number {
  const gross = Math.max(0, Number(grossAmount) || 0);
  const rate = Math.max(0, Number(taxPercent) || 0);
  return roundSalesMoney(gross * (rate / 100));
}

export function calculateSalesCommission(input: {
  grossAmount: number;
  taxAmount?: number;
  processingFeeAmount?: number;
  refundAmount?: number;
  discountAmount?: number;
  commissionRate: number;
}): CommissionCalculation {
  const grossAmount = roundSalesMoney(Math.max(0, input.grossAmount));
  const taxAmount = roundSalesMoney(Math.max(0, input.taxAmount || 0));
  const processingFeeAmount = roundSalesMoney(Math.max(0, input.processingFeeAmount || 0));
  const refundAmount = roundSalesMoney(Math.max(0, input.refundAmount || 0));
  const discountAmount = roundSalesMoney(Math.max(0, input.discountAmount || 0));
  const commissionRate = roundSalesMoney(Math.max(0, Math.min(100, input.commissionRate)));
  const eligibleNetRevenue = roundSalesMoney(Math.max(
    0,
    grossAmount - taxAmount - processingFeeAmount - refundAmount - discountAmount,
  ));
  return {
    grossAmount,
    taxAmount,
    processingFeeAmount,
    refundAmount,
    discountAmount,
    eligibleNetRevenue,
    commissionRate,
    commissionAmount: roundSalesMoney(eligibleNetRevenue * (commissionRate / 100)),
  };
}

function validationEndsAt(earnedAt: Date, type: "NRMS_USAGE" | "MARKETPLACE_BOOKING") {
  return new Date(earnedAt.getTime() + VALIDATION_WINDOW_DAYS[type] * DAY_MS);
}

function attributionOpen(attribution: any, earnedAt: Date): boolean {
  if (!attribution || attribution.status !== "ACTIVE") return false;
  if (!attribution.commissionStartsAt || attribution.commissionStartsAt > earnedAt) return false;
  if (attribution.commissionEndsAt && attribution.commissionEndsAt <= earnedAt) return false;
  const contract = attribution.contract;
  if (!contract || !CONTRACT_EARNING_STATUSES.includes(contract.status)) return false;
  if (contract.startsAt > earnedAt || contract.expiresAt <= earnedAt) return false;
  return contract.salesPartnerId === attribution.salesPartnerId;
}

async function existingCommission(tx: any, sourceKey: string) {
  return tx.salesCommission.findUnique({ where: { sourceKey } });
}

async function createIdempotently(tx: any, data: any): Promise<{ created: boolean; commission: any }> {
  try {
    return { created: true, commission: await tx.salesCommission.create({ data }) };
  } catch (error: any) {
    if (error?.code !== "P2002" && !String(error?.message || "").includes("Unique constraint")) throw error;
    const existing = await existingCommission(tx, data.sourceKey);
    if (!existing) throw error;
    return { created: false, commission: existing };
  }
}

async function recordAccrualAudit(tx: any, commission: any, afterJson: any) {
  await tx.auditLog.create({
    data: {
      actorId: null,
      actorRole: "SYSTEM",
      action: "SALES_COMMISSION_ACCRUE",
      entity: "SALES_COMMISSION",
      entityId: commission.id,
      beforeJson: null,
      afterJson,
    },
  });
}

export async function accrueNrmsSalesCommission(tx: any, statementId: number): Promise<CommissionAccrualResult> {
  const sourceKey = commissionSourceKey("NRMS_STATEMENT", statementId);
  const replay = await existingCommission(tx, sourceKey);
  if (replay) return { created: false, commission: replay };
  const statement = await tx.nrmsBillingStatement.findUnique({
    where: { id: statementId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      paidAt: true,
      account: { select: { propertyId: true, property: { select: { title: true } } } },
      items: { select: { usageEvent: { select: { classification: true, amount: true } } } },
    },
  });
  if (!statement || statement.status !== "PAID" || !statement.paidAt) {
    return { created: false, skippedReason: "SOURCE_NOT_PAID" };
  }
  const eligibleUsage = statement.items.some(
    (item: any) => item.usageEvent.classification !== "TRIAL_FREE" && Number(item.usageEvent.amount) > 0,
  );
  if (!eligibleUsage) return { created: false, skippedReason: "NO_ELIGIBLE_USAGE" };
  const attribution = await tx.propertySalesAttribution.findUnique({
    where: { propertyId_productType: { propertyId: statement.account.propertyId, productType: "NRMS" } },
    include: { contract: true, salesPartner: { select: { userId: true } } },
  });
  if (!attributionOpen(attribution, statement.paidAt)) {
    return { created: false, skippedReason: "NO_ACTIVE_ATTRIBUTION" };
  }
  const settings = await tx.systemSetting.findUnique({ where: { id: 1 }, select: { taxPercent: true } });
  const grossAmount = Number(statement.amount);
  const calculation = calculateSalesCommission({
    grossAmount,
    taxAmount: inclusiveTaxComponent(grossAmount, Number(settings?.taxPercent || 0)),
    // Actual provider fees are not persisted on this source yet. Keep zero
    // visible in VALIDATING rather than inventing a deduction.
    processingFeeAmount: 0,
    commissionRate: Number(attribution.contract.nrmsCommissionRate),
  });
  if (calculation.commissionAmount <= 0) return { created: false, skippedReason: "NO_ELIGIBLE_REVENUE" };
  const result = await createIdempotently(tx, {
    salesPartnerId: attribution.salesPartnerId,
    propertyId: statement.account.propertyId,
    attributionId: attribution.id,
    contractId: attribution.contractId,
    type: "NRMS_USAGE",
    status: "VALIDATING",
    sourceKey,
    sourceStatementId: statement.id,
    ...calculation,
    currency: statement.currency,
    description: `NRMS usage revenue from paid statement #${statement.id}`,
    earnedAt: statement.paidAt,
    eligibleAt: validationEndsAt(statement.paidAt, "NRMS_USAGE"),
  });
  if (result.created) {
    await recordAccrualAudit(tx, result.commission, {
      sourceKey,
      type: "NRMS_USAGE",
      salesPartnerId: attribution.salesPartnerId,
      propertyId: statement.account.propertyId,
      calculation,
    });
  }
  return { ...result, partnerUserId: attribution.salesPartner.userId, propertyTitle: statement.account.property.title };
}

export async function accrueMarketplaceSalesCommission(tx: any, invoiceId: number): Promise<CommissionAccrualResult> {
  const sourceKey = commissionSourceKey("INVOICE", invoiceId);
  const replay = await existingCommission(tx, sourceKey);
  if (replay) return { created: false, commission: replay };
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      commissionPercent: true,
      commissionAmount: true,
      taxPercent: true,
      paidAt: true,
      bookingId: true,
      booking: {
        select: {
          propertyId: true,
          property: { select: { title: true, currency: true } },
        },
      },
    },
  });
  if (!invoice || invoice.status !== "PAID" || !invoice.paidAt) {
    return { created: false, skippedReason: "SOURCE_NOT_PAID" };
  }
  const grossCommission = Number(invoice.commissionAmount || 0);
  if (grossCommission <= 0 || Number(invoice.commissionPercent || 0) <= 0) {
    return { created: false, skippedReason: "COMMISSION_BASIS_MISSING" };
  }
  const attribution = await tx.propertySalesAttribution.findUnique({
    where: { propertyId_productType: { propertyId: invoice.booking.propertyId, productType: "MARKETPLACE" } },
    include: { contract: true, salesPartner: { select: { userId: true } } },
  });
  if (!attributionOpen(attribution, invoice.paidAt)) {
    return { created: false, skippedReason: "NO_ACTIVE_ATTRIBUTION" };
  }
  const calculation = calculateSalesCommission({
    // Gross is NoLSAF commission, deliberately not booking value.
    grossAmount: grossCommission,
    taxAmount: exclusiveTaxAmount(grossCommission, Number(invoice.taxPercent || 0)),
    processingFeeAmount: 0,
    commissionRate: Number(attribution.contract.marketplaceRevenueRate),
  });
  if (calculation.commissionAmount <= 0) return { created: false, skippedReason: "NO_ELIGIBLE_REVENUE" };
  const result = await createIdempotently(tx, {
    salesPartnerId: attribution.salesPartnerId,
    propertyId: invoice.booking.propertyId,
    attributionId: attribution.id,
    contractId: attribution.contractId,
    type: "MARKETPLACE_BOOKING",
    status: "VALIDATING",
    sourceKey,
    sourceInvoiceId: invoice.id,
    sourceBookingId: invoice.bookingId,
    ...calculation,
    currency: invoice.booking.property.currency || "TZS",
    description: `Marketplace revenue share from paid invoice #${invoice.id}`,
    earnedAt: invoice.paidAt,
    eligibleAt: validationEndsAt(invoice.paidAt, "MARKETPLACE_BOOKING"),
  });
  if (result.created) {
    await recordAccrualAudit(tx, result.commission, {
      sourceKey,
      type: "MARKETPLACE_BOOKING",
      salesPartnerId: attribution.salesPartnerId,
      propertyId: invoice.booking.propertyId,
      calculation,
    });
  }
  return { ...result, partnerUserId: attribution.salesPartner.userId, propertyTitle: invoice.booking.property.title };
}
