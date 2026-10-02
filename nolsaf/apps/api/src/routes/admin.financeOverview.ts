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
 * GET /overview/series?from=&to=&bucket=day|week|month
 * Revenue, GMV and partner payouts per bucket across a range, for the chart
 * on /admin/finance. Each bucket uses the same rules as /overview, so the
 * points add up to its totals. Buckets are calendar days, weeks starting
 * Monday, or months, in EAT; at most 40.
 */
const SERIES_CACHE = new Map<string, { at: number; body: unknown }>();
const EAT_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" });
const eatMidnight = (day: string) => new Date(`${day}T00:00:00.000+03:00`);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

router.get("/overview/series", async (req, res) => {
  try {
    const from = new Date(String(req.query.from ?? ""));
    const to = new Date(String(req.query.to ?? ""));
    const bucket = String(req.query.bucket ?? "day");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return res.status(400).json({ ok: false, error: "Pick a valid range" });
    if (!["day", "week", "month"].includes(bucket)) return res.status(400).json({ ok: false, error: "Unknown bucket" });

    const key = `${EAT_DAY.format(from)}|${EAT_DAY.format(to)}|${bucket}`;
    const hit = SERIES_CACHE.get(key);
    if (hit && Date.now() - hit.at < 60_000) return res.json(hit.body);

    // Bucket edges as EAT calendar days.
    const first = EAT_DAY.format(from);
    const last = EAT_DAY.format(to);
    const edges: Array<{ start: string; end: string }> = [];
    let cursor = first;
    if (bucket === "week") {
      const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
      cursor = addDays(first, -weekday);
    } else if (bucket === "month") {
      cursor = `${first.slice(0, 7)}-01`;
    }
    while (cursor <= last && edges.length < 40) {
      let next: string;
      if (bucket === "day") next = addDays(cursor, 1);
      else if (bucket === "week") next = addDays(cursor, 7);
      else {
        const [y, m] = cursor.split("-").map(Number);
        next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      }
      edges.push({ start: cursor, end: next });
      cursor = next;
    }

    const points: Array<{ start: string; end: string; revenue: number; gmv: number; partnerNet: number; count: number }> = [];
    // A few at a time: each bucket runs the full stream aggregation.
    for (let i = 0; i < edges.length; i += 6) {
      const batch = await Promise.all(edges.slice(i, i + 6).map(async (e) => {
        const lo = new Date(Math.max(eatMidnight(e.start).getTime(), from.getTime()));
        const hi = new Date(Math.min(eatMidnight(e.end).getTime() - 1, to.getTime()));
        const o = await computeFinanceOverview(lo.toISOString(), hi.toISOString(), { margin: false });
        return { start: e.start, end: addDays(e.end, -1), revenue: n(o.totals.nolsafRevenue), gmv: n(o.totals.gmv), partnerNet: n(o.totals.partnerNet), count: o.totals.realizedCount };
      }));
      points.push(...batch);
    }

    const body = { ok: true, bucket, points };
    SERIES_CACHE.set(key, { at: Date.now(), body });
    if (SERIES_CACHE.size > 200) SERIES_CACHE.delete(SERIES_CACHE.keys().next().value as string);
    return res.json(body);
  } catch (err: any) {
    console.error("[GET /api/admin/finance/overview/series] Error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load the revenue series" });
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
