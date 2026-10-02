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
//   Accommodation : guest has paid the booking invoice (money stage, see
//                   lib/platformMargin.accommodationTake) (rev = commissionAmount)
//   Tours         : TourBooking.paymentStatus = PAID   (rev = commissionAmount)
//   Transport     : TransportBooking.paymentStatus = PAID (rev = commissionAmount)
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
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { getFxRates, BASE_CURRENCY } from "../lib/fx.js";
import { computeFinanceOverview } from "../lib/financeOverview.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler);
router.use(requireRole("ADMIN") as unknown as RequestHandler);
// Platform-wide revenue is sensitive: require the short-lived finance OTP grant, not just an admin session.
router.use(requireAdminFinanceGrant as unknown as RequestHandler);

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
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
    return res.json(await computeFinanceOverview(from, to));
  } catch (err: any) {
    console.error("[GET /api/admin/finance/overview] Error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load finance overview" });
  }
});

/**
 * GET /invoice-register?from=&to=&page=&pageSize=
 *
 * The invoice level detail behind the management revenue report: invoice number,
 * property, total, net payable and the implied NoLSAF commission, row by row.
 * It lives on this router on purpose, so reading the register needs the finance
 * OTP grant and not merely an admin session (the same gate as /overview).
 *
 * Visibility matches GET /admin/revenue/invoices exactly, so both surfaces
 * report the same figures: owner invoices in any state, plus paid booking
 * invoices.
 */
router.get("/invoice-register", async (req, res) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const page = Math.max(1, Number((req.query as any).page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number((req.query as any).pageSize) || 50));

    // A date only `to` must cover that whole day, otherwise the last day of the
    // period is silently dropped.
    const dayOnly = (value: string) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);
    const where: any = {
      AND: [
        {
          OR: [
            { invoiceNumber: { startsWith: "OINV-" } },
            { AND: [{ invoiceNumber: { startsWith: "INV-" } }, { status: "PAID" }] },
          ],
        },
      ],
    };

    if (from || to) {
      const issuedAt: any = {};
      if (from) issuedAt.gte = new Date(dayOnly(String(from)) ? `${from}T00:00:00.000Z` : String(from));
      if (to) issuedAt.lte = new Date(dayOnly(String(to)) ? `${to}T23:59:59.999Z` : String(to));
      where.issuedAt = issuedAt;
    }

    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        select: {
          id: true,
          invoiceNumber: true,
          receiptNumber: true,
          status: true,
          issuedAt: true,
          total: true,
          netPayable: true,
          commissionAmount: true,
          commissionPercent: true,
          booking: {
            select: {
              id: true,
              property: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: { issuedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.invoice.count({ where }),
    ]);

    return res.json({ ok: true, items, total, page, pageSize });
  } catch (err: any) {
    console.error("[GET /api/admin/finance/invoice-register] Error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load the invoice register" });
  }
});

export default router;
