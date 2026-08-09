import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import QRCode from "qrcode";
import { Prisma } from "@prisma/client";
import { getEffectiveCommissionPercent, resolveOwnerPayoutAmount } from "../lib/accommodationPayout.js";
import { NOLSAF_BILLING_CONTACT } from "../lib/companyBillingContact.js";
import {
  buildOwnerPayoutReceiptVerificationUrl,
  createOwnerPayoutReceiptSnapshot,
  maskPayoutDestination,
  signOwnerPayoutReceipt,
  type OwnerPayoutReceiptSnapshot,
} from "../lib/ownerPayoutReceiptSeal.js";
export const router = Router();
router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler);

function revenueVisibilityClause() {
  return {
    OR: [
      { invoiceNumber: { startsWith: "OINV-" } },
      {
        AND: [
          { invoiceNumber: { startsWith: "INV-" } },
          { status: "PAID" },
        ],
      },
    ],
  };
}

function applyRevenueVisibility(where: any) {
  const currentAnd = Array.isArray(where?.AND) ? where.AND : [];
  where.AND = [...currentAnd, revenueVisibilityClause()];
  return where;
}

function extractPropertyCommissionPercent(propertyServices: unknown, fallbackPercent: number): number {
  const value = Number((propertyServices as any)?.commissionPercent);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallbackPercent;
}

async function ensureOwnerReceiptSeal(inv: any, payout: number): Promise<{
  snapshot: OwnerPayoutReceiptSnapshot;
  verificationUrl: string;
  qrPng: Buffer | null;
}> {
  if (inv.receiptSnapshot && inv.receiptQrPayload) {
    return {
      snapshot: inv.receiptSnapshot as OwnerPayoutReceiptSnapshot,
      verificationUrl: String(inv.receiptQrPayload),
      qrPng: inv.receiptQrPng ? Buffer.from(inv.receiptQrPng) : null,
    };
  }

  const settledAt = inv.paidAt ? new Date(inv.paidAt) : null;
  if (!settledAt || Number.isNaN(settledAt.getTime())) throw new Error("paid_invoice_missing_settlement_time");

  const disbursement = await prisma.disbursement.findFirst({
    where: { sourceType: "OWNER_INVOICE", sourceId: inv.id, status: "PAID" },
    orderBy: { paidAt: "desc" },
    include: { payoutAccount: { select: { accountNumber: true } } },
  });
  const receiptNumber = inv.receiptNumber || `RCPT-${settledAt.getFullYear()}${String(settledAt.getMonth() + 1).padStart(2, "0")}-${String(inv.id).padStart(7, "0")}`;
  const providerReference =
    disbursement?.fspReferenceId || disbursement?.pgReferenceId || disbursement?.externalReferenceId || "Not recorded";
  const nolsafReference = disbursement?.externalReferenceId || inv.paymentRef || receiptNumber;
  const amount = Number(disbursement?.amount ?? inv.netPayable ?? payout);
  const snapshot = createOwnerPayoutReceiptSnapshot({
    receiptNumber,
    invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber || `INV-${inv.id}`,
    ownerId: inv.ownerId,
    ownerName: inv.owner?.fullName || inv.owner?.name || `Owner #${inv.ownerId}`,
    ownerEmail: inv.owner?.email || null,
    bookingId: inv.bookingId,
    bookingCode: inv.booking?.code?.codeVisible || inv.booking?.codeVisible || null,
    propertyName: inv.booking?.property?.title || "Property",
    checkIn: new Date(inv.booking.checkIn).toISOString(),
    checkOut: new Date(inv.booking.checkOut).toISOString(),
    totalRevenue: Number(inv.total),
    commissionPercent: inv.commissionPercent == null ? null : Number(inv.commissionPercent),
    commissionAmount: inv.commissionAmount == null ? null : Number(inv.commissionAmount),
    taxPercent: inv.taxPercent == null ? null : Number(inv.taxPercent),
    taxAmount: null,
    netPayable: Number.isFinite(amount) ? amount : payout,
    currency: disbursement?.currency || "TZS",
    paymentMethod: disbursement?.bankName || inv.paymentMethod || "Not recorded",
    payoutProvider: disbursement?.provider || "azampay",
    providerReference,
    nolsafReference,
    maskedDestination: disbursement?.payoutAccount?.accountNumber
      ? maskPayoutDestination(disbursement.payoutAccount.accountNumber)
      : "Not recorded",
    settledAt: settledAt.toISOString(),
    issuedAt: settledAt.toISOString(),
  });
  const verificationUrl = buildOwnerPayoutReceiptVerificationUrl(signOwnerPayoutReceipt(snapshot));

  await prisma.invoice.updateMany({
    where: { id: inv.id, receiptIssuedAt: null },
    data: {
      receiptNumber,
      receiptSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      receiptIssuedAt: settledAt,
      receiptQrPayload: verificationUrl,
    },
  });
  const sealed = await prisma.invoice.findUnique({
    where: { id: inv.id },
    select: { receiptSnapshot: true, receiptQrPayload: true, receiptQrPng: true },
  });
  if (!sealed?.receiptSnapshot || !sealed.receiptQrPayload) throw new Error("receipt_snapshot_persistence_failed");
  return {
    snapshot: sealed.receiptSnapshot as unknown as OwnerPayoutReceiptSnapshot,
    verificationUrl: sealed.receiptQrPayload,
    qrPng: sealed.receiptQrPng ? Buffer.from(sealed.receiptQrPng) : null,
  };
}

router.get("/invoices", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    const status = req.query.status as string | undefined;
    const propertyId = req.query.propertyId ? Number(req.query.propertyId) : undefined;
    const date_from = req.query.date_from ? new Date(String(req.query.date_from)) : undefined;
    const date_to = req.query.date_to ? new Date(String(req.query.date_to)) : undefined;
    const beforeIdRaw = req.query.beforeId ? Number(req.query.beforeId) : undefined;
    const beforeId = Number.isFinite(beforeIdRaw as any) ? beforeIdRaw : undefined;
    const take = Math.min(Math.max(Number(req.query.take ?? 50), 1), 200);

    const where: any = applyRevenueVisibility({ ownerId });
    if (status) {
      const parts = String(status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      where.status = parts.length > 1 ? { in: parts } : (parts[0] as any);
    }
    if (date_from || date_to) {
      where.issuedAt = {};
      if (date_from) where.issuedAt.gte = date_from;
      if (date_to) where.issuedAt.lte = date_to;
    }
    if (propertyId) where.booking = { propertyId };
    if (beforeId) where.id = { lt: beforeId };

    // Keep payload lean: do not fetch blobs/notes/QR data for list views.
    const defaultCommissionPercent = await getEffectiveCommissionPercent(null);
    const rows = await prisma.invoice.findMany({
      where,
      orderBy: { id: "desc" },
      take: take + 1,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        issuedAt: true,
        paidAt: true,
        total: true,
        netPayable: true,
        receiptNumber: true,
        paymentRef: true,
        booking: {
          select: {
            id: true,
            totalAmount: true,
            transportFare: true,
            property: {
              select: {
                id: true,
                title: true,
                services: true,
              },
            },
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const nextBeforeId = items.length ? items[items.length - 1]!.id : null;

    // Owners should not see platform commission/service fee amounts.
    // Always expose only the owner payout amount.
    const masked = items.map((inv: any) => {
      const commissionPercent = extractPropertyCommissionPercent(inv?.booking?.property?.services, defaultCommissionPercent);
      const payout = resolveOwnerPayoutAmount({
        invoiceNumber: inv.invoiceNumber,
        invoiceTotal: inv.total,
        netPayable: inv.netPayable,
        bookingTotalAmount: inv?.booking?.totalAmount,
        transportFare: inv?.booking?.transportFare,
        commissionPercent,
      });
      return {
        ...inv,
        total: payout,
        netPayable: payout,
        commissionPercent: null,
        commissionAmount: null,
        taxPercent: null,
        notes: null,
      };
    });

    res.json({ items: masked, hasMore, nextBeforeId });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to load invoices", items: [] });
  }
}) as RequestHandler);

router.get("/stats", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    const status = req.query.status as string | undefined;
    const propertyId = req.query.propertyId ? Number(req.query.propertyId) : undefined;
    const date_from = req.query.date_from ? new Date(String(req.query.date_from)) : undefined;
    const date_to = req.query.date_to ? new Date(String(req.query.date_to)) : undefined;

    const defaultCommissionPercent = await getEffectiveCommissionPercent(null);
    const where: any = applyRevenueVisibility({ ownerId });
    if (status) {
      const parts = String(status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      where.status = parts.length > 1 ? { in: parts } : (parts[0] as any);
    }
    if (date_from || date_to) {
      where.issuedAt = {};
      if (date_from) where.issuedAt.gte = date_from;
      if (date_to) where.issuedAt.lte = date_to;
    }
    if (propertyId) where.booking = { propertyId };

    const items = await prisma.invoice.findMany({
      where,
      select: {
        id: true,
        status: true,
        invoiceNumber: true,
        total: true,
        netPayable: true,
        booking: {
          select: {
            totalAmount: true,
            transportFare: true,
            property: { select: { services: true } },
          },
        },
      },
    });

    const payouts = items.map((inv: any) => {
      const commissionPercent = extractPropertyCommissionPercent(inv?.booking?.property?.services, defaultCommissionPercent);
      return resolveOwnerPayoutAmount({
        invoiceNumber: inv.invoiceNumber,
        invoiceTotal: inv.total,
        netPayable: inv.netPayable,
        bookingTotalAmount: inv?.booking?.totalAmount,
        transportFare: inv?.booking?.transportFare,
        commissionPercent,
      });
    });

    const totalInvoices = items.length;
    const paidInvoices = items.filter((inv) => String(inv.status).toUpperCase() === "PAID").length;
    const pendingInvoices = Math.max(0, totalInvoices - paidInvoices);

    const totalRevenue = payouts.reduce((sum, payout) => sum + payout, 0);
    const paidRevenue = items.reduce((sum, inv: any, index) => {
      return String(inv.status).toUpperCase() === "PAID" ? sum + payouts[index]! : sum;
    }, 0);
    const pendingRevenue = Math.max(0, totalRevenue - paidRevenue);

    res.json({
      totalRevenue,
      paidRevenue,
      pendingRevenue,
      totalInvoices,
      paidInvoices,
      pendingInvoices,
    });
  } catch {
    return res.status(500).json({
      error: "Failed to load stats",
      totalRevenue: 0,
      paidRevenue: 0,
      pendingRevenue: 0,
      totalInvoices: 0,
      paidInvoices: 0,
      pendingInvoices: 0,
    });
  }
}) as RequestHandler);

router.get("/invoices.csv", (async (req: AuthedRequest, res) => {
  const ownerId = req.user!.id;
  const status = req.query.status as string | undefined;
  const propertyId = req.query.propertyId ? Number(req.query.propertyId) : undefined;
  const date_from = req.query.date_from ? new Date(String(req.query.date_from)) : undefined;
  const date_to = req.query.date_to ? new Date(String(req.query.date_to)) : undefined;

  const where: any = applyRevenueVisibility({ ownerId });
  if (status) where.status = status as any;
  if (date_from || date_to) {
    where.issuedAt = {};
    if (date_from) where.issuedAt.gte = date_from;
    if (date_to) where.issuedAt.lte = date_to;
  }
  if (propertyId) where.booking = { propertyId };

  const items = await prisma.invoice.findMany({
    where,
    include: {
      booking: {
        include: {
          property: { select: { id: true, title: true, services: true } },
          code: true,
        },
      },
    } as any,
    orderBy: { id: "desc" },
    take: 1000,
  });

  const defaultCommissionPercent = await getEffectiveCommissionPercent(null);

  const header = [
    "invoiceNumber","status","issuedAt","property","bookingId","code",
    "ownerPayout",
    "paidAt","receiptNumber","paymentRef",
  ];
  const lines = [header.join(",")];
  for (const inv of items) {
    const commissionPercent = extractPropertyCommissionPercent((inv as any)?.booking?.property?.services, defaultCommissionPercent);
    const payout = resolveOwnerPayoutAmount({
      invoiceNumber: (inv as any).invoiceNumber,
      invoiceTotal: (inv as any).total,
      netPayable: (inv as any).netPayable,
      bookingTotalAmount: (inv as any)?.booking?.totalAmount,
      transportFare: (inv as any)?.booking?.transportFare,
      commissionPercent,
    });
    const row = [
      inv.invoiceNumber,
      inv.status,
      inv.issuedAt.toISOString(),
      inv.booking?.property?.title ?? "",
      String(inv.bookingId),
      (inv as any).booking?.code?.codeVisible ?? "",
      String(payout),
      inv.paidAt ? inv.paidAt.toISOString() : "",
      inv.receiptNumber ?? "",
      inv.paymentRef ?? "",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(row.join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="nolsaf-revenue.csv"`);
  res.send(lines.join("\n"));
}) as RequestHandler);

router.get("/invoices/:id", (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const inv = await prisma.invoice.findFirst({
    where: applyRevenueVisibility({ id, ownerId: req.user!.id }),
    include: {
      booking: {
        include: {
          property: { select: { id: true, title: true, services: true } },
          user: true,
          code: true,
        },
      },
    } as any,
  });
  if (!inv) return res.status(404).json({ error: "Not found" });
  const commissionPercent = await getEffectiveCommissionPercent((inv as any)?.booking?.property?.services);
  const payout = resolveOwnerPayoutAmount({
    invoiceNumber: (inv as any).invoiceNumber,
    invoiceTotal: (inv as any).total,
    netPayable: (inv as any).netPayable,
    bookingTotalAmount: (inv as any)?.booking?.totalAmount,
    transportFare: (inv as any)?.booking?.transportFare,
    commissionPercent,
  });
  res.json({
    ...(inv as any),
    total: payout,
    netPayable: payout,
    commissionPercent: null,
    commissionAmount: null,
    notes: null,
    receiverName: NOLSAF_BILLING_CONTACT.name,
    receiverEmail: NOLSAF_BILLING_CONTACT.email,
    receiverAddress: NOLSAF_BILLING_CONTACT.address,
  });
}) as RequestHandler);


router.get("/invoices/:id/receipt", (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const inv = await prisma.invoice.findFirst({
    where: { id, ownerId: req.user!.id, status: "PAID" },
    include: {
      owner: { select: { id: true, email: true, name: true, fullName: true } },
      booking: {
        include: {
          property: {
            select: {
              id: true,
              title: true,
              type: true,
              regionName: true,
              district: true,
              city: true,
              country: true,
              services: true,
              photos: true,
              images: {
                where: { status: "READY" },
                take: 1,
                orderBy: { createdAt: "asc" },
                select: { url: true, thumbnailUrl: true },
              },
            },
          },
          code: true,
        },
      },
    } as any,
  });
  if (!inv) return res.status(404).json({ error: "Receipt not available" });

  const commissionPercent = await getEffectiveCommissionPercent((inv as any)?.booking?.property?.services);
  const payout = resolveOwnerPayoutAmount({
    invoiceNumber: (inv as any).invoiceNumber,
    invoiceTotal: (inv as any).total,
    netPayable: (inv as any).netPayable,
    bookingTotalAmount: (inv as any)?.booking?.totalAmount,
    transportFare: (inv as any)?.booking?.transportFare,
    commissionPercent,
  });

  const sealed = await ensureOwnerReceiptSeal(inv as any, payout);
  const snapshot = sealed.snapshot;

  const safeInvoice = {
    ...(inv as any),
    invoiceNumber: snapshot.invoiceNumber,
    receiptNumber: snapshot.receiptNumber,
    total: snapshot.totalRevenue,
    netPayable: snapshot.netPayable,
    commissionPercent: snapshot.commissionPercent,
    commissionAmount: snapshot.commissionAmount,
    taxPercent: snapshot.taxPercent,
    paidAt: snapshot.settledAt,
    paymentMethod: snapshot.paymentMethod,
    paymentRef: snapshot.providerReference,
    notes: null,
    booking: {
      id: snapshot.bookingId,
      checkIn: snapshot.checkIn,
      checkOut: snapshot.checkOut,
      codeVisible: snapshot.bookingCode,
      code: { codeVisible: snapshot.bookingCode },
      property: {
        title: snapshot.propertyName,
      },
    },
  };

  res.json({ invoice: safeInvoice, receipt: snapshot, verificationUrl: sealed.verificationUrl });
}) as RequestHandler);


router.get("/invoices/:id/receipt/qr.png", (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const inv = await prisma.invoice.findFirst({
    where: { id, ownerId: req.user!.id, status: "PAID" },
    include: {
      owner: { select: { id: true, email: true, name: true, fullName: true } },
      booking: {
        include: {
          code: true,
          property: { select: { title: true, services: true } },
        },
      },
    } as any,
  });
  if (!inv) return res.status(404).json({ error: "Receipt not available" });

  const commissionPercent = await getEffectiveCommissionPercent((inv as any)?.booking?.property?.services);
  const payout = resolveOwnerPayoutAmount({
    invoiceNumber: (inv as any).invoiceNumber,
    invoiceTotal: (inv as any).total,
    netPayable: (inv as any).netPayable,
    bookingTotalAmount: (inv as any)?.booking?.totalAmount,
    transportFare: (inv as any)?.booking?.transportFare,
    commissionPercent,
  });

  const sealed = await ensureOwnerReceiptSeal(inv as any, payout);
  const png = sealed.qrPng || await QRCode.toBuffer(sealed.verificationUrl, { type: "png", margin: 1, width: 256, errorCorrectionLevel: "M" });
  if (!sealed.qrPng) {
    await prisma.invoice.updateMany({
      where: { id, receiptQrPng: null },
      data: { receiptQrPng: png },
    });
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=3600, immutable");
  res.send(png);
}) as RequestHandler);
