// Supplier payables (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 5): what the
// property owes each supplier, their invoices, the payments made, the
// statement and the ageing. Mounted at /api/nrms/stock beside the other stock
// routers. Owner and manager only (stock.payables.manage).
//
// What is owed is the accepted value of deliveries on credit, less payments.
// An invoice documents the debt and is checked against those deliveries; a
// bill above what was accepted is flagged, never silently added to the debt.
// NRMS records money, it never moves it.

import crypto from "crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { sanitizeText } from "../lib/sanitize.js";
import { requireNrmsPropertyCapability } from "../lib/nrmsPropertyAccess.js";
import { lockPropertyInventory } from "../lib/nrmsAvailability.js";
import { assertNrmsBusinessDayWritable, NRMS_BUSINESS_DAY_LOCKED } from "../lib/nrmsShifts.js";
import { roundMoney } from "../lib/nrmsInventory.js";
import { AGEING_BUCKETS, type StatementEvent, ageDebts, dueDateFor, invoiceCheck, statementLines } from "../lib/nrmsPayables.js";
import { DEBT_SELECT, debtDue, payablesFor, postedAt } from "../lib/nrmsStockQueries.js";
import { generateNrmsSupplierStatementPdf } from "../lib/pdfDocuments.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
const TX_OPTIONS = { maxWait: 5000, timeout: 20000 };
const PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"] as const;
const CAPABILITY = "stock.payables.manage";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const METHOD_LABELS: Record<string, string> = { CASH: "Cash", MOBILE_MONEY: "Mobile money", BANK: "Bank transfer", CARD: "Card", OTHER: "Other" };
const TERM_LABELS: Record<string, string> = { CASH_ON_DELIVERY: "Cash on delivery", CREDIT_7: "Credit, 7 days", CREDIT_14: "Credit, 14 days", CREDIT_30: "Credit, 30 days" };

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function idParam(req: AuthedRequest, name: string): number | null {
  const value = Number(req.params[name]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function documentNumber(prefix: string): string {
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `${prefix}-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function userNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id): id is number => Number.isInteger(id)))];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, fullName: true, email: true } });
  return new Map(users.map((user: any) => [user.id, user.fullName || user.name || user.email || `User ${user.id}`]));
}

router.get("/property/:propertyId/payables", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), CAPABILITY);
  if (!access) return;
  const rows = await payablesFor(access.property.id, new Date());
  const totals = { outstanding: 0, credit: 0, overdue: 0, buckets: Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, 0])) as Record<string, number> };
  for (const row of rows) {
    totals.outstanding = roundMoney(totals.outstanding + row.outstanding);
    totals.credit = roundMoney(totals.credit + row.credit);
    totals.overdue = roundMoney(totals.overdue + row.overdue);
    for (const bucket of AGEING_BUCKETS) totals.buckets[bucket] = roundMoney(totals.buckets[bucket] + row.buckets[bucket]);
  }
  rows.sort((a: any, b: any) => b.overdue - a.overdue || b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  const flaggedInvoices = rows.reduce((sum: number, row: any) => sum + row.flaggedInvoices, 0);
  res.json({ currency: access.property.currency || "TZS", suppliers: rows, totals, flaggedInvoices });
}) as RequestHandler);

async function loadSupplier(req: AuthedRequest, res: Response) {
  const supplierId = idParam(req, "supplierId");
  if (!supplierId) { res.status(400).json({ error: "Invalid supplier" }); return null; }
  const supplier = await db.nrmsSupplier.findUnique({ where: { id: supplierId } });
  if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return null; }
  const access = await requireNrmsPropertyCapability(req, res, supplier.propertyId, CAPABILITY);
  if (!access) return null;
  return { supplier, access };
}

/** Every event that changed, or explains, what is owed to one supplier. */
async function statementFor(supplier: any, range: { from: string | null; to: string | null }) {
  const [receipts, payments, invoices] = await Promise.all([
    db.nrmsGoodsReceipt.findMany({ where: { supplierId: supplier.id, status: { in: ["POSTED", "VOIDED"] } }, select: { ...DEBT_SELECT, paymentMode: true, paymentMethod: true, status: true, voidedAt: true, voidReason: true, location: { select: { name: true } } }, orderBy: { receivedAt: "asc" } }),
    db.nrmsSupplierPayment.findMany({ where: { supplierId: supplier.id }, orderBy: { paidAt: "asc" } }),
    db.nrmsSupplierInvoice.findMany({ where: { supplierId: supplier.id }, include: { _count: { select: { receipts: true } } }, orderBy: { invoiceDate: "asc" } }),
  ]);
  const events: StatementEvent[] = [];
  for (const row of receipts) {
    const amount = number(row.totalCost);
    // A voided delivery only counts if it had entered stock; status VOIDED means it had.
    if (row.paymentMode === "CREDIT") {
      events.push({ date: postedAt(row), kind: "DELIVERY_CREDIT", reference: row.receiptNumber, description: `On credit, into ${row.location?.name ?? "stock"}`, amount, sourceId: row.id });
      if (row.status === "VOIDED" && row.voidedAt) events.push({ date: new Date(row.voidedAt), kind: "DELIVERY_VOIDED", reference: row.receiptNumber, description: `Delivery voided${row.voidReason ? `: ${row.voidReason}` : ""}`, amount: -amount, sourceId: row.id });
    } else {
      events.push({ date: postedAt(row), kind: "DELIVERY_PAID", reference: row.receiptNumber, description: `Paid on delivery, ${METHOD_LABELS[row.paymentMethod] ?? "paid"} ${amount.toLocaleString("en-US")}`, amount: 0, sourceId: row.id });
    }
  }
  for (const row of payments) {
    const amount = number(row.amount);
    events.push({ date: new Date(row.paidAt), kind: "PAYMENT", reference: row.paymentNumber, description: `Payment by ${METHOD_LABELS[row.method] ?? row.method}${row.reference ? `, ref ${row.reference}` : ""}`, amount: -amount, sourceId: row.id });
    if (row.voidedAt) events.push({ date: new Date(row.voidedAt), kind: "PAYMENT_VOIDED", reference: row.paymentNumber, description: `Payment voided${row.voidReason ? `: ${row.voidReason}` : ""}`, amount, sourceId: row.id });
  }
  for (const row of invoices) {
    if (row.voidedAt) continue;
    const check = row.matchStatus === "BILLED_MORE" ? `, billed ${(number(row.amount) - number(row.receivedValue)).toLocaleString("en-US")} more than accepted` : row.matchStatus === "BILLED_LESS" ? ", billed less than accepted" : "";
    events.push({ date: new Date(row.invoiceDate), kind: "INVOICE", reference: row.invoiceNumber, description: `Invoice for ${row._count.receipts} ${row._count.receipts === 1 ? "delivery" : "deliveries"}, ${number(row.amount).toLocaleString("en-US")}${check}`, amount: 0, sourceId: row.id });
  }
  const all = statementLines(events);
  const fromTime = range.from ? dateOnly(range.from).getTime() : null;
  const toTime = range.to ? dateOnly(range.to).getTime() + 86_400_000 : null;
  const before = fromTime == null ? [] : all.filter((line) => line.date.getTime() < fromTime);
  const opening = before.length ? before[before.length - 1].balance : 0;
  const lines = all.filter((line) => (fromTime == null || line.date.getTime() >= fromTime) && (toTime == null || line.date.getTime() < toTime));
  const closing = lines.length ? lines[lines.length - 1].balance : opening;
  const goods = roundMoney(lines.filter((line) => line.amount > 0 && line.kind === "DELIVERY_CREDIT").reduce((sum, line) => sum + line.amount, 0));
  const paid = roundMoney(-lines.filter((line) => line.kind === "PAYMENT").reduce((sum, line) => sum + line.amount, 0));
  const adjustments = roundMoney(closing - opening - goods + paid);

  const debts = receipts.filter((row: any) => row.status === "POSTED" && row.paymentMode === "CREDIT");
  const paidTotal = payments.filter((row: any) => !row.voidedAt).reduce((sum: number, row: any) => sum + number(row.amount), 0);
  const aged = ageDebts(debts.map((row: any) => ({ id: row.id, amount: number(row.totalCost), dueDate: debtDue(row, supplier.paymentTerms) })), paidTotal, new Date());
  const receiptNumber = new Map<number, string>(debts.map((row: any) => [row.id, row.receiptNumber]));
  return {
    opening,
    closing,
    goods,
    paid,
    adjustments,
    lines,
    ageing: { buckets: aged.buckets, outstanding: aged.outstanding, credit: aged.credit, open: aged.open.map((debt) => ({ ...debt, receiptNumber: receiptNumber.get(debt.id) ?? "" })) },
    payments,
    invoices,
    receipts,
  };
}

const rangeSchema = z.object({ from: z.string().regex(DATE).optional(), to: z.string().regex(DATE).optional() });

router.get("/suppliers/:supplierId/statement", (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadSupplier(req, res);
  if (!loaded) return;
  const range = rangeSchema.safeParse(req.query);
  if (!range.success) return res.status(400).json({ error: "Choose valid dates" });
  const { supplier, access } = loaded;
  const statement = await statementFor(supplier, { from: range.data.from ?? null, to: range.data.to ?? null });
  const names = await userNames([...statement.payments.map((row: any) => row.recordedById), ...statement.invoices.map((row: any) => row.recordedById)]);
  res.json({
    currency: access.property.currency || "TZS",
    supplier: { id: supplier.id, name: supplier.name, contactName: supplier.contactName, phone: supplier.phone, email: supplier.email, tin: supplier.tin, paymentTerms: supplier.paymentTerms, payChannels: supplier.payChannels, status: supplier.status },
    range: { from: range.data.from ?? null, to: range.data.to ?? null },
    summary: { opening: statement.opening, goods: statement.goods, paid: statement.paid, adjustments: statement.adjustments, closing: statement.closing },
    lines: statement.lines,
    ageing: statement.ageing,
    invoices: statement.invoices.map((row: any) => ({
      id: row.id, invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate, dueDate: row.dueDate, amount: number(row.amount), vatAmount: number(row.vatAmount),
      receivedValue: number(row.receivedValue), matchStatus: row.matchStatus, difference: roundMoney(number(row.amount) - number(row.receivedValue)), photoUrl: row.photoUrl, note: row.note,
      deliveries: row._count.receipts, recordedBy: row.recordedById ? names.get(row.recordedById) ?? null : null, voidedAt: row.voidedAt, voidReason: row.voidReason, createdAt: row.createdAt,
    })),
    payments: statement.payments.map((row: any) => ({
      id: row.id, paymentNumber: row.paymentNumber, amount: number(row.amount), method: row.method, reference: row.reference, paidAt: row.paidAt, invoiceId: row.invoiceId, note: row.note,
      recordedBy: row.recordedById ? names.get(row.recordedById) ?? null : null, voidedAt: row.voidedAt, voidReason: row.voidReason, createdAt: row.createdAt,
    })),
    uninvoiced: statement.receipts
      .filter((row: any) => row.status === "POSTED" && (!row.supplierInvoiceId || row.invoice?.voidedAt))
      .map((row: any) => ({ id: row.id, receiptNumber: row.receiptNumber, receivedAt: postedAt(row), totalCost: number(row.totalCost), paymentMode: row.paymentMode, locationName: row.location?.name ?? null })),
  });
}) as RequestHandler);

router.get("/suppliers/:supplierId/statement.pdf", (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadSupplier(req, res);
  if (!loaded) return;
  const range = rangeSchema.safeParse(req.query);
  if (!range.success) return res.status(400).json({ error: "Choose valid dates" });
  const { supplier, access } = loaded;
  try {
    const statement = await statementFor(supplier, { from: range.data.from ?? null, to: range.data.to ?? null });
    const property = await db.property.findUnique({ where: { id: access.property.id }, select: { title: true, street: true, ward: true, city: true, district: true, regionName: true, country: true } });
    const pdf = await generateNrmsSupplierStatementPdf({
      propertyName: property?.title ?? access.property.title,
      propertyLocation: [property?.street, property?.ward, property?.city, property?.district, property?.regionName, property?.country].filter(Boolean).join(", ") || null,
      supplier: { name: supplier.name, contactName: supplier.contactName, phone: supplier.phone, tin: supplier.tin, paymentTerms: TERM_LABELS[supplier.paymentTerms] ?? supplier.paymentTerms },
      currency: access.property.currency || "TZS",
      from: range.data.from ?? null,
      to: range.data.to ?? null,
      generatedAt: new Date(),
      summary: { opening: statement.opening, goods: statement.goods, paid: statement.paid, adjustments: statement.adjustments, closing: statement.closing },
      ageing: statement.ageing.buckets,
      lines: statement.lines.map((line) => ({ date: line.date, reference: line.reference, description: line.description, charge: line.amount > 0 ? line.amount : 0, payment: line.amount < 0 ? -line.amount : 0, balance: line.balance })),
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="statement-${supplier.name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (error) {
    console.error("[nrms.stock.payables] statement PDF failed", error);
    res.status(500).json({ error: "Unable to build the statement" });
  }
}) as RequestHandler);

// ======================================================================= invoices

const invoiceSchema = z.object({
  supplierId: z.number().int().positive(),
  invoiceNumber: z.string().trim().min(1).max(80),
  invoiceDate: z.string().regex(DATE),
  dueDate: z.string().regex(DATE).optional().nullable(),
  amount: z.number().finite().positive().max(100_000_000_000),
  vatAmount: z.number().finite().min(0).max(100_000_000_000).optional(),
  receiptIds: z.array(z.number().int().positive()).min(1).max(100),
  photoUrl: z.string().trim().url().max(500).startsWith("https://").optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

/**
 * POST /property/:propertyId/supplier-invoices - record the supplier's bill
 * against the deliveries it covers. A bill above what was accepted is saved
 * and flagged; the debt stays what arrived.
 */
router.post("/property/:propertyId/supplier-invoices", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), CAPABILITY);
  if (!access) return;
  const parsed = invoiceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the invoice details", details: parsed.error.flatten() });
  const input = parsed.data;
  const propertyId = access.property.id;
  const supplier = await db.nrmsSupplier.findFirst({ where: { id: input.supplierId, propertyId } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  if ((input.vatAmount ?? 0) > input.amount) return res.status(400).json({ error: "VAT cannot be more than the invoice total" });
  const receiptIds = [...new Set(input.receiptIds)];
  const receipts = await db.nrmsGoodsReceipt.findMany({
    where: { id: { in: receiptIds }, propertyId, supplierId: supplier.id, status: "POSTED" },
    select: { id: true, totalCost: true, supplierInvoiceId: true, invoice: { select: { voidedAt: true } } },
  });
  if (receipts.length !== receiptIds.length) return res.status(400).json({ error: "Choose deliveries from this supplier that are in stock" });
  if (receipts.some((row: any) => row.supplierInvoiceId && !row.invoice?.voidedAt)) return res.status(409).json({ error: "A chosen delivery is already on another invoice" });
  const receivedValue = roundMoney(receipts.reduce((sum: number, row: any) => sum + number(row.totalCost), 0));
  const check = invoiceCheck({ amount: input.amount, receivedValue });
  const invoiceDate = dateOnly(input.invoiceDate);
  const dueDate = input.dueDate ? dateOnly(input.dueDate) : dueDateFor(invoiceDate, supplier.paymentTerms);
  try {
    const invoice = await db.$transaction(async (tx: any) => {
      const created = await tx.nrmsSupplierInvoice.create({
        data: {
          propertyId,
          supplierId: supplier.id,
          invoiceNumber: sanitizeText(input.invoiceNumber),
          invoiceDate,
          dueDate,
          amount: roundMoney(input.amount),
          vatAmount: roundMoney(input.vatAmount ?? 0),
          receivedValue,
          matchStatus: check.flag,
          photoUrl: input.photoUrl ?? null,
          note: input.note ? sanitizeText(input.note) : null,
          recordedById: req.user!.id,
        },
      });
      // Claim only deliveries still free, so two invoices never bill the same goods.
      const claimed = await tx.nrmsGoodsReceipt.updateMany({
        where: { id: { in: receiptIds }, OR: [{ supplierInvoiceId: null }, { invoice: { voidedAt: { not: null } } }] },
        data: { supplierInvoiceId: created.id },
      });
      if (claimed.count !== receiptIds.length) throw new Error("NRMS_RECEIPT_ALREADY_INVOICED");
      return created;
    }, TX_OPTIONS);
    res.status(201).json({ invoiceId: invoice.id, matchStatus: check.flag, difference: check.difference, receivedValue });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "This supplier invoice number is already recorded" });
    if (error instanceof Error && error.message === "NRMS_RECEIPT_ALREADY_INVOICED") return res.status(409).json({ error: "A chosen delivery is already on another invoice" });
    console.error("[nrms.stock.payables] invoice failed", error);
    res.status(500).json({ error: "Unable to record the invoice" });
  }
}) as RequestHandler);

router.get("/property/:propertyId/supplier-invoices", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), CAPABILITY);
  if (!access) return;
  const flag = typeof req.query.flag === "string" ? req.query.flag : "";
  const rows = await db.nrmsSupplierInvoice.findMany({
    where: { propertyId: access.property.id, ...(flag === "flagged" ? { matchStatus: "BILLED_MORE", voidedAt: null } : {}), ...(Number(req.query.supplierId) ? { supplierId: Number(req.query.supplierId) } : {}) },
    include: { supplier: { select: { name: true } }, _count: { select: { receipts: true } } },
    orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 80)),
  });
  const names = await userNames(rows.map((row: any) => row.recordedById));
  res.json({
    invoices: rows.map((row: any) => ({
      id: row.id, supplierId: row.supplierId, supplierName: row.supplier?.name ?? null, invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate, dueDate: row.dueDate,
      amount: number(row.amount), vatAmount: number(row.vatAmount), receivedValue: number(row.receivedValue), matchStatus: row.matchStatus,
      difference: roundMoney(number(row.amount) - number(row.receivedValue)), deliveries: row._count.receipts, photoUrl: row.photoUrl, note: row.note,
      recordedBy: row.recordedById ? names.get(row.recordedById) ?? null : null, voidedAt: row.voidedAt, voidReason: row.voidReason,
    })),
  });
}) as RequestHandler);

/** POST /supplier-invoices/:invoiceId/void - a wrong invoice; its deliveries become free to invoice again. */
router.post("/supplier-invoices/:invoiceId/void", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const invoiceId = idParam(req, "invoiceId");
  if (!invoiceId) return res.status(400).json({ error: "Invalid invoice" });
  const invoice = await db.nrmsSupplierInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  const access = await requireNrmsPropertyCapability(req, res, invoice.propertyId, CAPABILITY);
  if (!access) return;
  const parsed = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Say why this invoice is being voided" });
  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsSupplierInvoice.updateMany({ where: { id: invoice.id, voidedAt: null }, data: { voidedAt: new Date(), voidedById: req.user!.id, voidReason: sanitizeText(parsed.data.reason) } });
      if (changed.count !== 1) throw new Error("NRMS_INVOICE_ALREADY_VOIDED");
      await tx.nrmsGoodsReceipt.updateMany({ where: { supplierInvoiceId: invoice.id }, data: { supplierInvoiceId: null } });
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_INVOICE_ALREADY_VOIDED") return res.status(409).json({ error: "This invoice is already voided" });
    console.error("[nrms.stock.payables] invoice void failed", error);
    return res.status(500).json({ error: "Unable to void the invoice" });
  }
  res.json({ ok: true });
}) as RequestHandler);

// ======================================================================= payments

const paymentSchema = z.object({
  supplierId: z.number().int().positive(),
  amount: z.number().finite().positive().max(100_000_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(80).optional().nullable(),
  paidAt: z.string().regex(DATE),
  invoiceId: z.number().int().positive().optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

/**
 * POST /property/:propertyId/supplier-payments - money paid to a supplier.
 * Posts at that business date's Night Audit, so the date must still be open,
 * exactly like an expense.
 */
router.post("/property/:propertyId/supplier-payments", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), CAPABILITY);
  if (!access) return;
  const parsed = paymentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the payment details", details: parsed.error.flatten() });
  const input = parsed.data;
  const propertyId = access.property.id;
  if (input.method !== "CASH" && !input.reference?.trim()) return res.status(400).json({ error: "Enter the transaction reference (M-Pesa code, bank reference)" });
  const supplier = await db.nrmsSupplier.findFirst({ where: { id: input.supplierId, propertyId } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  if (input.invoiceId) {
    const invoice = await db.nrmsSupplierInvoice.findFirst({ where: { id: input.invoiceId, supplierId: supplier.id, voidedAt: null } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found for this supplier" });
  }
  const currency = (access.property.currency || "TZS").toUpperCase().slice(0, 3);
  const before = (await payablesFor(propertyId, new Date())).find((row: any) => row.id === supplier.id);
  try {
    const payment = await db.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, propertyId);
      await assertNrmsBusinessDayWritable(tx, propertyId, new Date(`${input.paidAt}T12:00:00+03:00`));
      return tx.nrmsSupplierPayment.create({
        data: {
          propertyId,
          supplierId: supplier.id,
          paymentNumber: documentNumber("PAY"),
          amount: roundMoney(input.amount),
          method: input.method,
          reference: input.reference?.trim() ? sanitizeText(input.reference.trim()) : null,
          paidAt: dateOnly(input.paidAt),
          invoiceId: input.invoiceId ?? null,
          note: input.note ? sanitizeText(input.note) : null,
          currency,
          recordedById: req.user!.id,
        },
      });
    }, TX_OPTIONS);
    const owed = before?.outstanding ?? 0;
    res.status(201).json({ paymentId: payment.id, paymentNumber: payment.paymentNumber, overpaid: roundMoney(Math.max(0, input.amount - owed)) });
  } catch (error) {
    if (error instanceof Error && error.message === NRMS_BUSINESS_DAY_LOCKED) return res.status(409).json({ error: "That business date is closed. Record the payment on an open business date.", code: NRMS_BUSINESS_DAY_LOCKED });
    console.error("[nrms.stock.payables] payment failed", error);
    res.status(500).json({ error: "Unable to record the payment" });
  }
}) as RequestHandler);

router.get("/property/:propertyId/supplier-payments", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), CAPABILITY);
  if (!access) return;
  const rows = await db.nrmsSupplierPayment.findMany({
    where: { propertyId: access.property.id, ...(Number(req.query.supplierId) ? { supplierId: Number(req.query.supplierId) } : {}) },
    include: { supplier: { select: { name: true } }, invoice: { select: { invoiceNumber: true } } },
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 80)),
  });
  const names = await userNames(rows.map((row: any) => row.recordedById));
  res.json({
    payments: rows.map((row: any) => ({
      id: row.id, paymentNumber: row.paymentNumber, supplierId: row.supplierId, supplierName: row.supplier?.name ?? null, amount: number(row.amount), method: row.method,
      reference: row.reference, paidAt: row.paidAt, invoiceNumber: row.invoice?.invoiceNumber ?? null, note: row.note,
      recordedBy: row.recordedById ? names.get(row.recordedById) ?? null : null, voidedAt: row.voidedAt, voidReason: row.voidReason, createdAt: row.createdAt,
    })),
  });
}) as RequestHandler);

router.post("/supplier-payments/:paymentId/void", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const paymentId = idParam(req, "paymentId");
  if (!paymentId) return res.status(400).json({ error: "Invalid payment" });
  const payment = await db.nrmsSupplierPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  const access = await requireNrmsPropertyCapability(req, res, payment.propertyId, CAPABILITY);
  if (!access) return;
  const parsed = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Say why this payment is being voided" });
  try {
    await db.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, payment.propertyId);
      // Same rule as an expense: a payment dated on a closed day stays; a
      // correction is recorded on an open day instead.
      await assertNrmsBusinessDayWritable(tx, payment.propertyId, new Date(`${new Date(payment.paidAt).toISOString().slice(0, 10)}T12:00:00+03:00`));
      const changed = await tx.nrmsSupplierPayment.updateMany({ where: { id: payment.id, voidedAt: null }, data: { voidedAt: new Date(), voidedById: req.user!.id, voidReason: sanitizeText(parsed.data.reason) } });
      if (changed.count !== 1) throw new Error("NRMS_PAYMENT_ALREADY_VOIDED");
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_PAYMENT_ALREADY_VOIDED") return res.status(409).json({ error: "This payment is already voided" });
    if (error instanceof Error && error.message === NRMS_BUSINESS_DAY_LOCKED) return res.status(409).json({ error: "The payment's business date is closed. Record a correcting entry on an open date instead.", code: NRMS_BUSINESS_DAY_LOCKED });
    console.error("[nrms.stock.payables] payment void failed", error);
    return res.status(500).json({ error: "Unable to void the payment" });
  }
  res.json({ ok: true });
}) as RequestHandler);

export default router;
