// NRMS Admin Oversight, Phase 4: PAYG statement and payment reconciliation.
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
const actionSchema = z.object({ reason: z.string().trim().min(5).max(300).transform(sanitizeText) });

function nrmsTokenFromEvent(event: any): string | null {
  const payload = event?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload.nrmsToken ?? payload.paymentRef;
  return typeof value === "string" && value.startsWith("NRMS-") ? value : null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function audit(adminId: number, action: string, targetUserId: number | null, details: Record<string, unknown>) {
  await db.adminAudit.create({ data: { adminId, targetUserId, action, details } });
}

router.get("/statements", requireFinanceGrant as RequestHandler, (async (req, res) => {
  const propertyId = req.query.propertyId ? Number(req.query.propertyId) : undefined;
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const statements = await db.nrmsBillingStatement.findMany({
    where: { ...(status ? { status } : {}), ...(propertyId ? { account: { propertyId } } : {}), ...(cursor ? { id: { lt: cursor } } : {}) },
    include: {
      account: { include: { property: { select: { id: true, title: true } }, owner: { select: { id: true, fullName: true, name: true, email: true } } } },
      items: { include: { usageEvent: { include: { allocation: { include: { roomUnit: { select: { code: true } }, roomType: { select: { name: true } } } } } } }, orderBy: { id: "asc" } },
      tokens: { include: { payment: true }, orderBy: { id: "desc" } },
    },
    orderBy: { id: "desc" }, take: limit + 1,
  });
  const hasMore = statements.length > limit;
  const pageStatements = hasMore ? statements.slice(0, limit) : statements;
  res.json({ statements: pageStatements.map((s: any) => ({ id: s.id, status: s.status, amount: number(s.amount), currency: s.currency, closedAt: s.closedAt, paidAt: s.paidAt, property: s.account.property, owner: { id: s.account.owner.id, name: s.account.owner.fullName || s.account.owner.name || s.account.owner.email }, items: s.items.map((i: any) => ({ id: i.id, amount: number(i.amount), usageEventId: i.usageEventId, serviceDate: i.usageEvent.serviceDate, classification: i.usageEvent.classification, source: i.usageEvent.source, reservationId: i.usageEvent.reservationId, room: i.usageEvent.allocation?.roomUnit?.code || i.usageEvent.allocation?.roomType?.name || null })), tokens: s.tokens.map((t: any) => ({ id: t.id, token: t.token, status: t.status, method: t.method, amount: number(t.amount), createdAt: t.createdAt, expiresAt: t.expiresAt, payment: t.payment ? { provider: t.payment.provider, providerRef: t.payment.providerRef, status: t.payment.status, verifiedAt: t.payment.verifiedAt } : null })) })), pagination: { limit, nextCursor: hasMore ? pageStatements[pageStatements.length - 1].id : null } });
}) as RequestHandler);

router.get("/payments", requireFinanceGrant as RequestHandler, (async (_req, res) => {
  const [tokens, rawEvents] = await Promise.all([
    db.nrmsServicePaymentToken.findMany({ include: { statement: { include: { account: { include: { property: { select: { id: true, title: true } }, owner: { select: { id: true, fullName: true, name: true, email: true } }, policy: true } } } }, payment: true }, orderBy: { id: "desc" }, take: 300 }),
    db.paymentEvent.findMany({ where: { payload: { not: null } }, orderBy: { id: "desc" }, take: 1000 }),
  ]);
  const eventsByToken = new Map<string, any[]>();
  for (const event of rawEvents) {
    const token = nrmsTokenFromEvent(event);
    if (!token) continue;
    const rows = eventsByToken.get(token) ?? [];
    rows.push({ id: event.id, provider: event.provider, eventId: event.eventId, amount: number(event.amount), currency: event.currency, status: event.status, rawStatus: event.rawStatus, createdAt: event.createdAt, updatedAt: event.updatedAt });
    eventsByToken.set(token, rows);
  }
  const payments = tokens.map((t: any) => ({ id: t.id, token: t.token, status: t.status, method: t.method, amount: number(t.amount), currency: t.currency, createdAt: t.createdAt, expiresAt: t.expiresAt, statementId: t.statementId, statementStatus: t.statement.status, property: t.statement.account.property, owner: { id: t.statement.account.owner.id, name: t.statement.account.owner.fullName || t.statement.account.owner.name || t.statement.account.owner.email }, payment: t.payment ? { id: t.payment.id, provider: t.payment.provider, providerRef: t.payment.providerRef, status: t.payment.status, verifiedAt: t.payment.verifiedAt } : null, events: eventsByToken.get(t.token) ?? [] }));
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  const queue = payments.filter((p: any) => p.status === "FAILED" || (p.status === "PROCESSING" && new Date(p.createdAt).getTime() <= cutoff) || p.events.some((event: any) => event.amount !== p.amount));
  res.json({ payments, queue });
}) as RequestHandler);

router.post("/tokens/:tokenId/reconcile", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = actionSchema.extend({ providerRef: z.string().trim().min(3).max(120).transform(sanitizeText) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  const tokenId = Number(req.params.tokenId);
  const token = await db.nrmsServicePaymentToken.findUnique({ where: { id: tokenId }, include: { payment: true, statement: { include: { account: { include: { property: true, policy: true } } } } } });
  if (!token) return res.status(404).json({ error: "Payment token not found" });
  if (token.payment || token.status === "PAID") return res.status(409).json({ error: "This token is already reconciled" });
  if (token.statement.status !== "PAYABLE") return res.status(409).json({ error: "The statement is no longer payable" });
  const account = token.statement.account;
  const balance = Math.max(0, number(account.unpaidBalance) - number(token.amount));
  const dunning = evaluateNrmsDunning({ balance, reminderAmount: number(account.policy.reminderAmount), warningAmount: number(account.policy.warningAmount), unpaidLimit: number(account.unpaidLimit), graceDays: account.policy.graceDays, trialEndsAt: account.trialEndsAt });
  const payment = await db.$transaction(async (tx: any) => {
    const claimed = await tx.nrmsBillingStatement.updateMany({ where: { id: token.statementId, status: "PAYABLE" }, data: { status: "PAID", paidAt: new Date() } });
    if (claimed.count !== 1) throw new Error("NRMS_STATEMENT_NOT_PAYABLE");
    const created = await tx.nrmsServicePayment.create({ data: { tokenId: token.id, provider: "ADMIN_MANUAL", providerRef: parsed.data.providerRef, idempotencyKey: `ADMIN-NRMS-${token.id}-${Date.now()}`, amount: token.amount, currency: token.currency, status: "MANUALLY_VERIFIED", verifiedAt: new Date() } });
    await tx.nrmsServicePaymentToken.update({ where: { id: token.id }, data: { status: "PAID" } });
    await tx.nrmsServicePaymentToken.updateMany({ where: { statementId: token.statementId, id: { not: token.id }, status: { not: "PAID" } }, data: { status: "VOID" } });
    await tx.ownerPaygAccount.update({ where: { id: account.id }, data: { unpaidBalance: balance, status: dunning.status, limitReachedAt: dunning.limitReachedAt } });
    return created;
  });
  await audit(req.user!.id, "NRMS_PAYMENT_MANUAL_RECONCILE", account.ownerId, { propertyId: account.propertyId, tokenId: token.id, statementId: token.statementId, paymentId: payment.id, providerRef: parsed.data.providerRef, reason: parsed.data.reason });
  await notifyOwner(account.ownerId, "nrms_payment_reconciled", { propertyTitle: account.property.title, reason: parsed.data.reason });
  res.json({ payment: { id: payment.id, status: payment.status }, unpaidBalance: balance });
}) as RequestHandler);

router.post("/tokens/:tokenId/void", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  const token = await db.nrmsServicePaymentToken.findUnique({ where: { id: Number(req.params.tokenId) }, include: { payment: true, statement: { include: { account: { include: { property: true, policy: true } } } } } });
  if (!token) return res.status(404).json({ error: "Payment token not found" });
  if (token.payment || ["PAID", "VOID"].includes(token.status)) return res.status(409).json({ error: "This token cannot be voided" });
  const account = token.statement.account;
  const dunning = evaluateNrmsDunning({ balance: number(account.unpaidBalance), reminderAmount: number(account.policy.reminderAmount), warningAmount: number(account.policy.warningAmount), unpaidLimit: number(account.unpaidLimit), graceDays: account.policy.graceDays, limitReachedAt: account.limitReachedAt, trialEndsAt: account.trialEndsAt });
  const resolution = await db.$transaction(async (tx: any) => {
    await tx.nrmsServicePaymentToken.update({ where: { id: token.id }, data: { status: "VOID" } });
    const created = await tx.nrmsServicePayment.create({ data: { tokenId: token.id, provider: "ADMIN_MANUAL", providerRef: `ADMIN-VOID-${token.id}-${Date.now()}`, idempotencyKey: `ADMIN-VOID-${token.id}-${Date.now()}-${req.user!.id}`, amount: 0, currency: token.currency, status: "VOID", verifiedAt: new Date() } });
    await tx.ownerPaygAccount.update({ where: { id: account.id }, data: { status: dunning.status, limitReachedAt: dunning.limitReachedAt } });
    return created;
  });
  await audit(req.user!.id, "NRMS_PAYMENT_TOKEN_VOID", account.ownerId, { propertyId: account.propertyId, tokenId: token.id, statementId: token.statementId, paymentId: resolution.id, reason: parsed.data.reason });
  await notifyOwner(account.ownerId, "nrms_payment_token_voided", { propertyTitle: account.property.title, reason: parsed.data.reason });
  res.json({ token: { id: token.id, status: "VOID" } });
}) as RequestHandler);

router.get("/export.csv", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from || to.getTime() - from.getTime() > 366 * 86400000) return res.status(400).json({ error: "Choose a valid period of up to 366 days" });
  const statements = await db.nrmsBillingStatement.findMany({ where: { createdAt: { gte: from, lte: to } }, include: { account: { include: { property: { select: { title: true } }, owner: { select: { email: true } } } }, tokens: { include: { payment: true } } }, orderBy: { id: "asc" } });
  const header = ["statement_id", "property", "owner_email", "status", "amount", "currency", "closed_at", "paid_at", "payment_provider", "provider_reference"];
  const rows = statements.map((s: any) => { const paid = s.tokens.find((t: any) => t.payment)?.payment; return [s.id, s.account.property.title, s.account.owner.email, s.status, number(s.amount), s.currency, s.closedAt.toISOString(), s.paidAt?.toISOString() ?? "", paid?.provider ?? "", paid?.providerRef ?? ""]; });
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const exportRecord = await db.nrmsAdminExport.create({ data: { adminId: req.user!.id, kind: "RECONCILIATION", purpose: "NRMS reconciliation export", fromAt: from, toAt: to, expiresAt: new Date(Date.now() + 15 * 60 * 1000), downloadedAt: new Date(), ipAddress: req.ip, userAgent: req.get("user-agent")?.slice(0, 255), sessionRef: String(req.headers.authorization || req.headers.cookie || "").slice(0, 128) || null } });
  await audit(req.user!.id, "NRMS_RECONCILIATION_EXPORT", null, { exportId: exportRecord.id, from, to, rows: rows.length - 1, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="nrms-reconciliation-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${csv}`);
}) as RequestHandler);

export default router;
