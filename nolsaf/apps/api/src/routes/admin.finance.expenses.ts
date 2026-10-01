import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { auditOrThrow } from "../lib/audit.js";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, REVENUE_STREAMS } from "../lib/platformMargin.js";

/**
 * NoLSAF's expense ledger (platform_expense), the cost side of the margin on
 * /admin/finance.
 *
 * - ADMIN with the finance verification grant, like the rest of finance.
 * - Writes are blocked for impersonated sessions and rate limited.
 * - Append-only: an entry is corrected by reversing it (a negative row that
 *   points back at the original), never edited or deleted.
 * - Every write is recorded in the audit log in the same transaction.
 */
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler, requireAdminFinanceGrant as unknown as RequestHandler);

const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => (req?.user?.id ? `finance-expenses:${String(req.user.id)}` : req.ip || "unknown"),
  message: { error: "Too many changes. Please wait a minute and try again." },
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A YYYY-MM-DD calendar day in East Africa Time. */
const eatDay = (day: string, end = false) => new Date(`${day}T${end ? "23:59:59.999" : "00:00:00.000"}+03:00`);
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function serialize(row: any) {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    vendor: row.vendor,
    reference: row.reference,
    amount: n(row.amount),
    currency: row.currency,
    incurredAt: row.incurredAt,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    stream: row.stream,
    origin: row.origin,
    note: row.note,
    reversedAt: row.reversedAt,
    reversesExpenseId: row.reversesExpenseId,
    createdAt: row.createdAt,
  };
}

/** GET / ?from=YYYY-MM-DD&to=YYYY-MM-DD&category=&page=&pageSize= */
router.get("/", async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const where: any = {};
    const from = q.from && DAY.test(q.from) ? eatDay(q.from) : null;
    const to = q.to && DAY.test(q.to) ? eatDay(q.to, true) : null;
    if (from || to) where.incurredAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (q.category && EXPENSE_CATEGORY_KEYS.has(q.category)) where.category = q.category;
    const page = Math.max(1, Math.floor(n(q.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(n(q.pageSize) || 25)));

    const [items, total, byCategory, setting] = await Promise.all([
      prisma.platformExpense.findMany({ where, orderBy: [{ incurredAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.platformExpense.count({ where }),
      prisma.platformExpense.groupBy({ by: ["category", "currency"], where, _sum: { amount: true } }),
      prisma.systemSetting.findUnique({ where: { id: 1 }, select: { gatewayFeeEstimatePercent: true } }),
    ]);

    res.json({
      items: items.map(serialize),
      total,
      page,
      pageSize,
      totals: byCategory.map((row) => ({ category: row.category, currency: row.currency, amount: n(row._sum.amount) })),
      categories: EXPENSE_CATEGORIES,
      streams: REVENUE_STREAMS,
      gatewayFeeEstimatePercent: setting?.gatewayFeeEstimatePercent == null ? null : n(setting.gatewayFeeEstimatePercent),
    });
  } catch (err: any) {
    console.error("GET /admin/finance/expenses error:", err?.message || err);
    res.status(500).json({ error: "Could not load expenses" });
  }
});

const createSchema = z
  .object({
    category: z.string().refine((v) => EXPENSE_CATEGORY_KEYS.has(v), "Pick a category"),
    description: z.string().trim().min(3, "Describe the expense").max(300),
    amount: z.coerce.number().positive("Enter an amount above zero").max(1_000_000_000_000),
    currency: z.enum(["TZS", "USD"]).default("TZS"),
    incurredOn: z.string().regex(DAY, "Pick the date of the cost"),
    periodStart: z.string().regex(DAY).optional().nullable(),
    periodEnd: z.string().regex(DAY).optional().nullable(),
    vendor: z.string().trim().max(120).optional().nullable(),
    reference: z.string().trim().max(120).optional().nullable(),
    stream: z.enum(REVENUE_STREAMS).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => !v.periodStart || !v.periodEnd || v.periodStart <= v.periodEnd, { message: "The period ends before it starts", path: ["periodEnd"] });

/** POST / record an expense */
router.post("/", writeLimiter, blockImpersonated, async (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid expense" });
  const v = parsed.data;
  const incurredAt = eatDay(v.incurredOn);
  if (incurredAt.getTime() > Date.now() + 86_400_000) return res.status(400).json({ error: "The cost date cannot be in the future" });
  const adminId = Number((req as any).user?.id);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.platformExpense.create({
        data: {
          category: v.category,
          description: v.description,
          amount: v.amount.toFixed(2) as any,
          currency: v.currency,
          incurredAt,
          periodStart: v.periodStart ? eatDay(v.periodStart) : null,
          periodEnd: v.periodEnd ? eatDay(v.periodEnd, true) : null,
          vendor: v.vendor || null,
          reference: v.reference || null,
          stream: v.stream || null,
          note: v.note || null,
          origin: "MANUAL",
          recordedById: Number.isInteger(adminId) ? adminId : null,
        },
      });
      await auditOrThrow(tx as any, req, "PLATFORM_EXPENSE_RECORDED", `PLATFORM_EXPENSE:${row.id}`, null, serialize(row), row.id);
      return row;
    });
    res.status(201).json({ ok: true, expense: serialize(created) });
  } catch (err: any) {
    console.error("POST /admin/finance/expenses error:", err?.message || err);
    res.status(500).json({ error: "The expense was not recorded. Please try again." });
  }
});

const reverseSchema = z.object({ reason: z.string().trim().min(3, "Say why it is being reversed").max(300) });

/** POST /:id/reverse  correct a mistaken entry with a reversing row */
router.post("/:id(\\d+)/reverse", writeLimiter, blockImpersonated, async (req, res) => {
  const parsed = reverseSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "A reason is required" });
  const id = Number(req.params.id);
  const adminId = Number((req as any).user?.id);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const original = await tx.platformExpense.findUnique({ where: { id } });
      if (!original) return { status: 404 as const, error: "Expense not found" };
      if (original.reversesExpenseId) return { status: 409 as const, error: "A reversing entry cannot itself be reversed" };
      // Conditional claim: only one reversal can ever succeed.
      const claimed = await tx.platformExpense.updateMany({ where: { id, reversedAt: null }, data: { reversedAt: new Date() } });
      if (claimed.count !== 1) return { status: 409 as const, error: "This expense has already been reversed" };
      const reversal = await tx.platformExpense.create({
        data: {
          category: original.category,
          description: `Reversal: ${original.description}`.slice(0, 300),
          vendor: original.vendor,
          reference: original.reference,
          amount: (-n(original.amount)).toFixed(2) as any,
          currency: original.currency,
          incurredAt: original.incurredAt,
          periodStart: original.periodStart,
          periodEnd: original.periodEnd,
          stream: original.stream,
          origin: "MANUAL",
          recordedById: Number.isInteger(adminId) ? adminId : null,
          note: parsed.data.reason,
          reversesExpenseId: original.id,
        },
      });
      await auditOrThrow(tx as any, req, "PLATFORM_EXPENSE_REVERSED", `PLATFORM_EXPENSE:${original.id}`, serialize(original), { reversalId: reversal.id, reason: parsed.data.reason }, original.id);
      return { status: 200 as const, reversal };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, reversal: serialize(result.reversal) });
  } catch (err: any) {
    console.error("POST /admin/finance/expenses/:id/reverse error:", err?.message || err);
    res.status(500).json({ error: "The expense was not reversed. Please try again." });
  }
});

const settingsSchema = z.object({ gatewayFeeEstimatePercent: z.union([z.coerce.number().min(0).max(20), z.null()]) });

/** PUT /settings  the gateway fee estimate rate (percent of guest money collected) */
router.put("/settings", writeLimiter, blockImpersonated, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Enter a rate between 0 and 20 percent, or clear it" });
  const rate = parsed.data.gatewayFeeEstimatePercent;
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { id: 1 }, select: { gatewayFeeEstimatePercent: true } });
      await tx.systemSetting.upsert({
        where: { id: 1 },
        update: { gatewayFeeEstimatePercent: rate == null || rate === 0 ? null : (rate.toFixed(2) as any) },
        create: { id: 1, gatewayFeeEstimatePercent: rate == null || rate === 0 ? null : (rate.toFixed(2) as any) },
      });
      await auditOrThrow(tx as any, req, "GATEWAY_FEE_ESTIMATE_CHANGED", "SYSTEM_SETTING:gatewayFeeEstimatePercent", { gatewayFeeEstimatePercent: before?.gatewayFeeEstimatePercent == null ? null : n(before.gatewayFeeEstimatePercent) }, { gatewayFeeEstimatePercent: rate || null });
    });
    res.json({ ok: true, gatewayFeeEstimatePercent: rate || null });
  } catch (err: any) {
    console.error("PUT /admin/finance/expenses/settings error:", err?.message || err);
    res.status(500).json({ error: "The rate was not saved. Please try again." });
  }
});

export default router;
