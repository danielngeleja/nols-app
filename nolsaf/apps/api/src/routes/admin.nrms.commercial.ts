// NRMS Admin Oversight, Phase 3: versioned pricing and reasoned property levers.
import crypto from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireFinanceGrant, requireNrmsFinanceApprover } from "../middleware/financeGrant.js";
import { notifyOwner } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import { evaluateNrmsDunning } from "../lib/nrmsDunning.js";

const router = Router();
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);
const db = prisma as any;

const reason = z.string().trim().min(5).max(300).transform(sanitizeText);
const money = z.coerce.number().finite().nonnegative().max(1_000_000_000);
const policySchema = z.object({
  roomNightPrice: money.positive(),
  trialDays: z.coerce.number().int().min(0).max(365),
  reminderAmount: money,
  warningAmount: money,
  unpaidLimit: money.positive(),
  graceDays: z.coerce.number().int().min(0).max(30).default(3),
  effectiveFrom: z.coerce.date(),
  reason,
}).refine((v) => v.reminderAmount < v.warningAmount && v.warningAmount < v.unpaidLimit, {
  message: "Reminder, warning and unpaid limit must increase in that order",
  path: ["warningAmount"],
});

class PolicyConflictError extends Error {}

function fail(res: Response, parsed: { success: boolean; error?: any }) {
  if (!parsed.success) res.status(400).json({ error: parsed.error?.issues?.[0]?.message || "Invalid request" });
  return !parsed.success;
}

async function loadAccount(res: Response, propertyId: number) {
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    res.status(400).json({ error: "Invalid property id" });
    return null;
  }
  const account = await db.ownerPaygAccount.findUnique({
    where: { propertyId },
    include: { property: { select: { id: true, title: true, ownerId: true } }, policy: true },
  });
  if (!account) res.status(404).json({ error: "This property has no NRMS account" });
  return account;
}

async function audit(adminId: number, action: string, targetUserId: number | null, details: Record<string, unknown>) {
  await db.adminAudit.create({ data: { adminId, targetUserId, action, details } });
}

router.get("/policies", requireFinanceGrant as RequestHandler, (async (_req, res) => {
  const policies = await db.nrmsUsageChargePolicy.findMany({ orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }] });
  const accountsByPolicy = await db.ownerPaygAccount.groupBy({ by: ["policyId"], _count: { _all: true } });
  const counts = new Map(accountsByPolicy.map((row: any) => [row.policyId, row._count._all]));
  res.json({ policies: policies.map((p: any) => ({ ...p, roomNightPrice: Number(p.roomNightPrice), reminderAmount: Number(p.reminderAmount), warningAmount: Number(p.warningAmount), unpaidLimit: Number(p.unpaidLimit), accountCount: counts.get(p.id) ?? 0 })) });
}) as RequestHandler);

router.post("/policies", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = policySchema.safeParse(req.body);
  if (fail(res, parsed)) return;
  const input = parsed.data!;
  const now = new Date();
  if (input.effectiveFrom < now) return res.status(400).json({ error: "Effective time must be now or later" });
  const version = `NRMS-${input.effectiveFrom.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  try {
    const created = await db.$transaction(async (tx: any) => {
      // Lock every currently-active policy row first so two concurrent publishes
      // (double-submit, or two admins publishing at once) can't both read "nothing
      // to close" before either commits. FOR UPDATE over the indexed `status` column
      // takes InnoDB next-key locks, which also blocks a concurrent transaction from
      // inserting a new ACTIVE row until this one finishes.
      const active: Array<{ id: number; effectiveFrom: Date; effectiveTo: Date | null }> = await tx.$queryRaw`
        SELECT id, effectiveFrom, effectiveTo FROM nrms_usage_charge_policy WHERE status = 'ACTIVE' FOR UPDATE
      `;

      const laterOrSameStart = active.find((p) => p.effectiveFrom >= input.effectiveFrom);
      if (laterOrSameStart) {
        throw new PolicyConflictError(`A policy version already starts at or after this effective time (from ${laterOrSameStart.effectiveFrom.toISOString()}). Choose a later effective time, or edit that version instead.`);
      }

      // Close every still-open policy that this new version supersedes. Normally
      // there is exactly one, but this also self-heals any pre-existing duplicate
      // "open" rows left over from before this fix.
      const toClose = active.filter((p) => p.effectiveFrom < input.effectiveFrom && (p.effectiveTo === null || p.effectiveTo > input.effectiveFrom));
      for (const p of toClose) {
        await tx.nrmsUsageChargePolicy.update({ where: { id: p.id }, data: { effectiveTo: input.effectiveFrom } });
      }

      return tx.nrmsUsageChargePolicy.create({ data: { version, status: "ACTIVE", currency: "TZS", effectiveFrom: input.effectiveFrom, roomNightPrice: input.roomNightPrice, trialDays: input.trialDays, reminderAmount: input.reminderAmount, warningAmount: input.warningAmount, unpaidLimit: input.unpaidLimit, graceDays: input.graceDays } });
    });
    await audit(req.user!.id, "NRMS_POLICY_PUBLISH", null, { policyId: created.id, version, effectiveFrom: input.effectiveFrom, reason: input.reason });
    res.status(201).json({ policy: created });
  } catch (err: any) {
    if (err instanceof PolicyConflictError) return res.status(409).json({ error: err.message });
    throw err;
  }
}) as RequestHandler);

router.get("/accounts", requireFinanceGrant as RequestHandler, (async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const accounts = await db.ownerPaygAccount.findMany({
    ...(cursor ? { where: { id: { gt: cursor } } } : {}),
    include: { property: { select: { title: true } }, owner: { select: { id: true, fullName: true, name: true, email: true } }, policy: true },
    orderBy: [{ unpaidBalance: "desc" }, { id: "asc" }],
    take: limit + 1,
  });
  const hasMore = accounts.length > limit;
  const pageAccounts = hasMore ? accounts.slice(0, limit) : accounts;
  res.json({ accounts: pageAccounts.map((a: any) => {
    const dunning = evaluateNrmsDunning({ balance: Number(a.unpaidBalance), reminderAmount: Number(a.policy.reminderAmount), warningAmount: Number(a.policy.warningAmount), unpaidLimit: Number(a.unpaidLimit), graceDays: a.policy.graceDays, limitReachedAt: a.limitReachedAt, trialEndsAt: a.trialEndsAt, currentStatus: a.status });
    return { id: a.id, propertyId: a.propertyId, propertyTitle: a.property.title, owner: { id: a.owner.id, name: a.owner.fullName || a.owner.name || a.owner.email }, status: a.status, trialEndsAt: a.trialEndsAt, unpaidBalance: Number(a.unpaidBalance), unpaidLimit: Number(a.unpaidLimit), policy: { id: a.policy.id, version: a.policy.version }, dunning };
  }), pagination: { limit, nextCursor: hasMore ? pageAccounts[pageAccounts.length - 1].id : null } });
}) as RequestHandler);

router.post("/property/:propertyId/trial", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = z.object({ trialEndsAt: z.coerce.date(), reason }).safeParse(req.body);
  if (fail(res, parsed)) return;
  const account = await loadAccount(res, Number(req.params.propertyId));
  if (!account) return;
  if (account.status !== "TRIAL") return res.status(409).json({ error: "Only a running trial can be changed" });
  const shortening = parsed.data!.trialEndsAt < new Date(account.trialEndsAt);
  if (shortening && parsed.data!.trialEndsAt.getTime() < Date.now() + 7 * 86400000) return res.status(400).json({ error: "A shortened trial must leave at least 7 days notice" });
  await db.ownerPaygAccount.update({ where: { id: account.id }, data: { trialEndsAt: parsed.data!.trialEndsAt } });
  await audit(req.user!.id, shortening ? "NRMS_TRIAL_SHORTEN" : "NRMS_TRIAL_EXTEND", account.ownerId, { propertyId: account.propertyId, before: account.trialEndsAt, after: parsed.data!.trialEndsAt, reason: parsed.data!.reason });
  await notifyOwner(account.ownerId, "nrms_trial_changed", { propertyTitle: account.property.title, trialEndsAt: parsed.data!.trialEndsAt.toISOString(), shortening, reason: parsed.data!.reason });
  res.json({ trialEndsAt: parsed.data!.trialEndsAt });
}) as RequestHandler);

router.post("/property/:propertyId/unpaid-limit", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = z.object({ unpaidLimit: money.positive(), reason }).safeParse(req.body);
  if (fail(res, parsed)) return;
  const account = await loadAccount(res, Number(req.params.propertyId));
  if (!account) return;
  await db.ownerPaygAccount.update({ where: { id: account.id }, data: { unpaidLimit: parsed.data!.unpaidLimit, limitReachedAt: null } });
  await audit(req.user!.id, "NRMS_UNPAID_LIMIT_ADJUST", account.ownerId, { propertyId: account.propertyId, before: Number(account.unpaidLimit), after: parsed.data!.unpaidLimit, reason: parsed.data!.reason });
  await notifyOwner(account.ownerId, "nrms_unpaid_limit_changed", { propertyTitle: account.property.title, unpaidLimit: parsed.data!.unpaidLimit, reason: parsed.data!.reason });
  res.json({ unpaidLimit: parsed.data!.unpaidLimit });
}) as RequestHandler);

router.post("/property/:propertyId/credit", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = z.object({ amount: money.positive(), reason }).safeParse(req.body);
  if (fail(res, parsed)) return;
  const account = await loadAccount(res, Number(req.params.propertyId));
  if (!account) return;
  if (parsed.data!.amount > Number(account.unpaidBalance)) return res.status(400).json({ error: "Credit cannot exceed the current unpaid balance" });
  const balance = Math.max(0, Number(account.unpaidBalance) - parsed.data!.amount);
  const dunning = evaluateNrmsDunning({ balance, reminderAmount: Number(account.policy.reminderAmount), warningAmount: Number(account.policy.warningAmount), unpaidLimit: Number(account.unpaidLimit), graceDays: account.policy.graceDays, trialEndsAt: account.trialEndsAt });
  const event = await db.$transaction(async (tx: any) => {
    const created = await tx.nrmsUsageEvent.create({ data: { accountId: account.id, propertyId: account.propertyId, reservationId: null, allocationId: null, policyId: account.policyId, serviceDate: new Date(), classification: "REVERSAL", source: "ADMIN", currency: account.policy.currency, amount: -parsed.data!.amount } });
    const statement = await tx.nrmsBillingStatement.findFirst({ where: { accountId: account.id, status: "PAYABLE" }, orderBy: { id: "desc" } });
    if (statement) {
      const statementCredit = Math.min(parsed.data!.amount, Number(statement.amount));
      const adjustedAmount = Math.max(0, Number(statement.amount) - statementCredit);
      await tx.nrmsBillingStatementItem.create({ data: { statementId: statement.id, usageEventId: created.id, amount: -statementCredit } });
      await tx.nrmsBillingStatement.update({ where: { id: statement.id }, data: { amount: adjustedAmount, status: adjustedAmount === 0 ? "VOID" : "PAYABLE" } });
      await tx.nrmsServicePaymentToken.updateMany({ where: { statementId: statement.id, status: { not: "PAID" } }, data: { status: "VOID" } });
      if (adjustedAmount > 0) {
        await tx.nrmsServicePaymentToken.create({ data: { statementId: statement.id, token: `NRMS-${crypto.randomBytes(18).toString("hex").toUpperCase()}`, amount: adjustedAmount, currency: statement.currency, expiresAt: new Date(Date.now() + 7 * 86400000) } });
      }
    }
    await tx.ownerPaygAccount.update({ where: { id: account.id }, data: { unpaidBalance: balance, status: dunning.status, limitReachedAt: dunning.limitReachedAt } });
    return created;
  });
  await audit(req.user!.id, "NRMS_CREDIT_GRANT", account.ownerId, { propertyId: account.propertyId, usageEventId: event.id, amount: parsed.data!.amount, reason: parsed.data!.reason });
  await notifyOwner(account.ownerId, "nrms_credit_granted", { propertyTitle: account.property.title, amount: parsed.data!.amount, reason: parsed.data!.reason });
  res.status(201).json({ usageEventId: event.id, unpaidBalance: balance });
}) as RequestHandler);

router.post("/property/:propertyId/policy", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = z.object({ policyId: z.coerce.number().int().positive(), reason }).safeParse(req.body);
  if (fail(res, parsed)) return;
  const account = await loadAccount(res, Number(req.params.propertyId));
  if (!account) return;
  const policy = await db.nrmsUsageChargePolicy.findUnique({ where: { id: parsed.data!.policyId } });
  if (!policy) return res.status(404).json({ error: "Policy version not found" });
  if (policy.effectiveFrom < account.policy.effectiveFrom) return res.status(400).json({ error: "Accounts can only move to a newer policy" });
  if (policy.id === account.policyId) return res.status(409).json({ error: "This account already uses that policy" });
  await db.ownerPaygAccount.update({ where: { id: account.id }, data: { policyId: policy.id } });
  await audit(req.user!.id, "NRMS_ACCOUNT_POLICY_MIGRATE", account.ownerId, { propertyId: account.propertyId, beforePolicyId: account.policyId, afterPolicyId: policy.id, reason: parsed.data!.reason });
  await notifyOwner(account.ownerId, "nrms_policy_changed", { propertyTitle: account.property.title, version: policy.version, reason: parsed.data!.reason });
  res.json({ policy: { id: policy.id, version: policy.version } });
}) as RequestHandler);

export default router;
