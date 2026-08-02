// apps/api/src/routes/admin.financeOverview.ts
//
// "Mother of all revenue" — a READ-ONLY aggregator.
//
// IMPORTANT: This route never writes and never alters any per-stream collection
// logic. It only reads the existing authoritative models (Invoice, TourBooking,
// TransportPayout, GroupBooking, NrmsServicePayment/NrmsBillingStatement) and
// normalizes them into one shape so a single admin page can show total GMV +
// total NoLSAF revenue across every stream.
//
// Definitions used everywhere here:
//   GMV            = gross transaction value flowing through the platform.
//   NoLSAF revenue = the platform's OWN take (commission / markup). NOT gross.
//   Partner net    = what is paid out to the owner / operator / driver.
//   Realized       = customer cash collected (per-stream signal below).
//   Pending        = in the pipeline, not yet realized.
//
// Recognition signal per stream (realized):
//   Accommodation : Invoice.status = PAID              (rev = commissionAmount)
//   Tours         : TourBooking.paymentStatus = PAID   (rev = commissionAmount)
//   Transport     : TransportPayout.status = PAID      (rev = commissionAmount)
//   Group stay    : GroupBooking.depositPaid = true    (rev = totalAmount - ownerAmount)
//   Subscriptions : NrmsServicePayment.status = VERIFIED or MANUALLY_VERIFIED
//                   (rev = amount, no partner split)
//
// Money of record is TZS. Tours and Subscriptions (NRMS) are the multi-currency
// streams; both are normalized to TZS via the display-rate layer (lib/fx) for
// the headline totals.

import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getFxRates, BASE_CURRENCY } from "../lib/fx.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler);
router.use(requireRole("ADMIN") as unknown as RequestHandler);

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

type StreamSummary = {
  key: "accommodation" | "tours" | "transport" | "groupStay" | "subscriptions";
  label: string;
  gmv: number; // realized gross, in TZS
  nolsafRevenue: number; // realized platform take, in TZS
  partnerNet: number; // realized paid/payable to partner, in TZS
  realizedCount: number;
  pendingRevenue: number; // platform take in the pipeline, in TZS
  pendingCount: number;
  note?: string;
};

/**
 * GET /overview?from=&to=
 * Optional ISO from/to filter the *realized* timestamp of each stream.
 * Default (no range) = all-time, which avoids dropping rows that have a null
 * realized timestamp on older data.
 */
router.get("/overview", async (req, res) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const hasRange = Boolean(from || to);
    const dateClause = () => {
      if (!hasRange) return undefined;
      const range: any = {};
      if (from) range.gte = new Date(String(from));
      if (to) range.lte = new Date(String(to));
      return range;
    };

    const fx = await getFxRates();
    // Convert an amount expressed in `currency` into TZS (the money of record).
    const toTzs = (amount: number, currency?: string | null): number => {
      const cur = String(currency || BASE_CURRENCY).toUpperCase();
      if (cur === BASE_CURRENCY) return amount;
      const rate = fx.tzsPerUnit[cur];
      return Number.isFinite(rate) && rate > 0 ? amount * rate : amount;
    };

    // ── Accommodation (Invoice) ─────────────────────────────────────────────
    const accDate = dateClause();
    const [accRealized, accPending] = await Promise.all([
      prisma.invoice.aggregate({
        where: { status: "PAID", ...(accDate ? { paidAt: accDate } : {}) },
        _sum: { total: true, commissionAmount: true, netPayable: true },
        _count: { _all: true },
      }),
      prisma.invoice.aggregate({
        where: {
          status: { in: ["REQUESTED", "VERIFIED", "APPROVED", "PROCESSING"] },
          ...(accDate ? { issuedAt: accDate } : {}),
        },
        _sum: { commissionAmount: true },
        _count: { _all: true },
      }),
    ]);

    const accommodation: StreamSummary = {
      key: "accommodation",
      label: "Accommodation",
      gmv: n(accRealized._sum.total),
      nolsafRevenue: n(accRealized._sum.commissionAmount),
      partnerNet: n(accRealized._sum.netPayable),
      realizedCount: accRealized._count._all,
      pendingRevenue: n(accPending._sum.commissionAmount),
      pendingCount: accPending._count._all,
    };

    // ── Tours (TourBooking) — multi-currency, normalize to TZS ───────────────
    const tourDate = dateClause();
    const [tourRealizedRows, tourPendingRows] = await Promise.all([
      prisma.tourBooking.groupBy({
        by: ["currency"],
        where: { paymentStatus: "PAID", ...(tourDate ? { paidAt: tourDate } : {}) },
        _sum: { grossAmount: true, commissionAmount: true },
        _count: { _all: true },
      }),
      prisma.tourBooking.groupBy({
        by: ["currency"],
        where: {
          paymentStatus: { not: "PAID" },
          payoutStatus: { in: ["CLAIMED", "VERIFIED", "APPROVED", "REQUESTED"] },
          ...(tourDate ? { createdAt: tourDate } : {}),
        },
        _sum: { commissionAmount: true },
        _count: { _all: true },
      }),
    ]);

    const tours: StreamSummary = {
      key: "tours",
      label: "Tours",
      gmv: 0,
      nolsafRevenue: 0,
      partnerNet: 0,
      realizedCount: 0,
      pendingRevenue: 0,
      pendingCount: 0,
      note: "Tours in other currencies are normalized to TZS at display rates.",
    };
    for (const row of tourRealizedRows) {
      const gross = toTzs(n(row._sum.grossAmount), row.currency);
      const commission = toTzs(n(row._sum.commissionAmount), row.currency);
      tours.gmv += gross;
      tours.nolsafRevenue += commission;
      tours.partnerNet += gross - commission;
      tours.realizedCount += row._count._all;
    }
    for (const row of tourPendingRows) {
      tours.pendingRevenue += toTzs(n(row._sum.commissionAmount), row.currency);
      tours.pendingCount += row._count._all;
    }

    // ── Transport (TransportPayout) ──────────────────────────────────────────
    const txDate = dateClause();
    const [txRealized, txPending] = await Promise.all([
      prisma.transportPayout.aggregate({
        where: { status: "PAID", ...(txDate ? { paidAt: txDate } : {}) },
        _sum: { grossAmount: true, commissionAmount: true, netPaid: true },
        _count: { _all: true },
      }),
      prisma.transportPayout.aggregate({
        where: { status: { in: ["PENDING", "APPROVED"] }, ...(txDate ? { createdAt: txDate } : {}) },
        _sum: { commissionAmount: true },
        _count: { _all: true },
      }),
    ]);

    const transport: StreamSummary = {
      key: "transport",
      label: "Transport",
      gmv: n(txRealized._sum.grossAmount),
      nolsafRevenue: n(txRealized._sum.commissionAmount),
      partnerNet: n(txRealized._sum.netPaid),
      realizedCount: txRealized._count._all,
      pendingRevenue: n(txPending._sum.commissionAmount),
      pendingCount: txPending._count._all,
    };

    // ── Group stay (GroupBooking) ────────────────────────────────────────────
    // NoLSAF take = totalAmount - ownerAmount (commission markup).
    const gsDate = dateClause();
    const [gsRealized, gsPending] = await Promise.all([
      prisma.groupBooking.aggregate({
        where: { depositPaid: true, ...(gsDate ? { depositPaidAt: gsDate } : {}) },
        _sum: { totalAmount: true, ownerAmount: true },
        _count: { _all: true },
      }),
      prisma.groupBooking.aggregate({
        where: {
          depositPaid: false,
          status: { in: ["AWAITING_DEPOSIT", "CONFIRMED", "PROCESSING"] },
          ...(gsDate ? { createdAt: gsDate } : {}),
        },
        _sum: { totalAmount: true, ownerAmount: true },
        _count: { _all: true },
      }),
    ]);

    const gsGmv = n(gsRealized._sum.totalAmount);
    const gsOwner = n(gsRealized._sum.ownerAmount);
    const groupStay: StreamSummary = {
      key: "groupStay",
      label: "Group stay",
      gmv: gsGmv,
      nolsafRevenue: Math.max(0, gsGmv - gsOwner),
      partnerNet: gsOwner,
      realizedCount: gsRealized._count._all,
      pendingRevenue: Math.max(0, n(gsPending._sum.totalAmount) - n(gsPending._sum.ownerAmount)),
      pendingCount: gsPending._count._all,
      note: "Realized at deposit; full settlement may be partial.",
    };

    // ── Subscriptions (NRMS PAYG) ─────────────────────────────────────────────
    // NRMS room-night billing is NoLSAF's subscription/software-fee product:
    // properties pay directly for the tool, so the whole amount IS NoLSAF
    // revenue (no partner split). Realized includes both provider-verified and
    // administrator-reconciled payments. The reconciliation route records the
    // latter as MANUALLY_VERIFIED, and both represent collected money. Pending
    // means open PAYABLE statements not yet collected. Both are normalized to
    // TZS in case a future policy currency differs (today NRMS is always TZS).
    const subDate = dateClause();
    const [subRealizedRows, subPendingRows] = await Promise.all([
      prisma.nrmsServicePayment.groupBy({
        by: ["currency"],
        where: {
          status: { in: ["VERIFIED", "MANUALLY_VERIFIED"] },
          ...(subDate ? { verifiedAt: subDate } : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.nrmsBillingStatement.groupBy({
        by: ["currency"],
        where: { status: "PAYABLE", ...(subDate ? { createdAt: subDate } : {}) },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const subscriptions: StreamSummary = {
      key: "subscriptions",
      label: "Subscriptions",
      gmv: 0,
      nolsafRevenue: 0,
      partnerNet: 0,
      realizedCount: 0,
      pendingRevenue: 0,
      pendingCount: 0,
      note: "NRMS property-management billing. The full amount is NoLSAF revenue (no partner split).",
    };
    for (const row of subRealizedRows) {
      const amount = toTzs(n(row._sum.amount), row.currency);
      subscriptions.gmv += amount;
      subscriptions.nolsafRevenue += amount;
      subscriptions.realizedCount += row._count._all;
    }
    for (const row of subPendingRows) {
      subscriptions.pendingRevenue += toTzs(n(row._sum.amount), row.currency);
      subscriptions.pendingCount += row._count._all;
    }

    const streams = [accommodation, tours, transport, groupStay, subscriptions];

    const totals = streams.reduce(
      (acc, s) => {
        acc.gmv += s.gmv;
        acc.nolsafRevenue += s.nolsafRevenue;
        acc.partnerNet += s.partnerNet;
        acc.realizedCount += s.realizedCount;
        acc.pendingRevenue += s.pendingRevenue;
        acc.pendingCount += s.pendingCount;
        return acc;
      },
      { gmv: 0, nolsafRevenue: 0, partnerNet: 0, realizedCount: 0, pendingRevenue: 0, pendingCount: 0 },
    );

    // round to 2dp for transport
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const cleanup = (s: StreamSummary): StreamSummary => ({
      ...s,
      gmv: round2(s.gmv),
      nolsafRevenue: round2(s.nolsafRevenue),
      partnerNet: round2(s.partnerNet),
      pendingRevenue: round2(s.pendingRevenue),
    });

    return res.json({
      ok: true,
      baseCurrency: BASE_CURRENCY,
      range: { from: from ?? null, to: to ?? null, allTime: !hasRange },
      totals: {
        gmv: round2(totals.gmv),
        nolsafRevenue: round2(totals.nolsafRevenue),
        partnerNet: round2(totals.partnerNet),
        realizedCount: totals.realizedCount,
        pendingRevenue: round2(totals.pendingRevenue),
        pendingCount: totals.pendingCount,
      },
      streams: streams.map(cleanup),
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[GET /api/admin/finance/overview] Error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load finance overview" });
  }
});

export default router;
