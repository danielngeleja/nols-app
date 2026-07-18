// NRMS Admin Oversight, Phase 6: read-only support snapshot, dispute exports,
// and explicit retention scheduling for permanently closed accounts.
import PDFDocument from "pdfkit";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireFinanceGrant, requireNrmsFinanceApprover } from "../middleware/financeGrant.js";
import { notifyOwner } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import { NRMS_GUEST_RETENTION_DAYS, NRMS_OPERATIONAL_RETENTION_DAYS } from "../workers/nrmsRetention.js";

const router = Router();
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);
const db = prisma as any;
const reason = z.string().trim().min(5).max(300).transform(sanitizeText);

function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function csvCell(value: unknown) { const text = value == null ? "" : String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }

async function loadProperty(propertyId: number) {
  return db.property.findUnique({ where: { id: propertyId }, select: { id: true, title: true, ownerId: true, nrmsActivatedAt: true } });
}

async function exportData(propertyId: number, from: Date, to: Date) {
  const [orders, reservations, statements] = await Promise.all([
    db.nrmsOutletOrder.findMany({ where: { propertyId, createdAt: { gte: from, lte: to } }, include: { outlet: { select: { name: true } }, items: true }, orderBy: { createdAt: "asc" } }),
    db.reservation.findMany({ where: { propertyId, createdAt: { gte: from, lte: to } }, include: { guestProfile: { select: { id: true } }, payments: true, charges: true }, orderBy: { createdAt: "asc" } }),
    db.nrmsBillingStatement.findMany({ where: { account: { propertyId }, createdAt: { gte: from, lte: to } }, include: { items: { include: { usageEvent: true } }, tokens: { include: { payment: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  return { orders, reservations, statements };
}

function pdfBuffer(propertyTitle: string, from: Date, to: Date, data: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, compress: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(18).fillColor("#02665e").text("NRMS dispute export");
    doc.fontSize(11).fillColor("#222222").text(propertyTitle).text(`${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`);
    doc.moveDown();
    doc.fontSize(13).fillColor("#02665e").text(`Orders (${data.orders.length})`);
    for (const order of data.orders.slice(0, 300)) doc.fontSize(8).fillColor("#333333").text(`#${order.id} ${order.orderNumber} | ${order.outlet?.name || "Outlet"} | ${order.status} | ${order.currency} ${number(order.total).toLocaleString("en-TZ")} | ${new Date(order.createdAt).toISOString()}`);
    doc.moveDown();
    doc.fontSize(13).fillColor("#02665e").text(`Reservations and folios (${data.reservations.length})`);
    for (const reservation of data.reservations.slice(0, 300)) doc.fontSize(8).fillColor("#333333").text(`#${reservation.id} Guest record redacted | ${reservation.status} | ${reservation.currency} ${number(reservation.totalAmount).toLocaleString("en-TZ")} | paid ${number(reservation.amountPaid).toLocaleString("en-TZ")} | charges ${number(reservation.chargesTotal).toLocaleString("en-TZ")}`);
    doc.moveDown();
    doc.fontSize(13).fillColor("#02665e").text(`PAYG statements (${data.statements.length})`);
    for (const statement of data.statements.slice(0, 300)) doc.fontSize(8).fillColor("#333333").text(`#${statement.id} ${statement.status} | ${statement.currency} ${number(statement.amount).toLocaleString("en-TZ")} | ${new Date(statement.createdAt).toISOString()}`);
    doc.end();
  });
}

router.get("/property/:propertyId/snapshot", requireFinanceGrant as RequestHandler, (async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  const property = await db.property.findUnique({ where: { id: propertyId }, include: { owner: { select: { id: true, fullName: true, name: true, email: true, phone: true } }, nrmsPaygAccount: { include: { policy: true } } } });
  if (!property?.nrmsPaygAccount) return res.status(404).json({ error: "NRMS property not found" });
  const [rooms, openReservations, openOrders, openHousekeeping, activeStaff, openShift, lastAudit] = await Promise.all([
    db.roomUnit.groupBy({ by: ["housekeepingStatus"], where: { propertyId, status: "ACTIVE" }, _count: { _all: true } }),
    db.reservation.count({ where: { propertyId, status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] } } }),
    db.nrmsOutletOrder.count({ where: { propertyId, status: { in: ["PLACED", "CONFIRMED", "PREPARING", "SERVING"] } } }),
    db.nrmsHousekeepingTask.count({ where: { propertyId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.nrmsStaffMembership.count({ where: { propertyId, status: "ACTIVE" } }),
    db.nrmsCashierShift.findFirst({ where: { propertyId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true, openedAt: true, userId: true } }),
    db.nrmsNightAuditRun.findFirst({ where: { propertyId }, orderBy: { startedAt: "desc" }, select: { id: true, status: true, reportNumber: true, completedAt: true } }),
  ]);
  res.json({ readOnly: true, property: { id: property.id, title: property.title, owner: { id: property.owner.id, name: property.owner.fullName || property.owner.name || property.owner.email, email: property.owner.email, phone: property.owner.phone } }, account: { status: property.nrmsPaygAccount.status, trialEndsAt: property.nrmsPaygAccount.trialEndsAt, unpaidBalance: number(property.nrmsPaygAccount.unpaidBalance), unpaidLimit: number(property.nrmsPaygAccount.unpaidLimit), policyVersion: property.nrmsPaygAccount.policy.version }, operations: { rooms: rooms.map((row: any) => ({ status: row.housekeepingStatus, count: row._count._all })), openReservations, openOrders, openHousekeeping, activeStaff, openShift, lastAudit } });
}) as RequestHandler);

router.post("/property/:propertyId/dispute-export", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const parsed = z.object({ format: z.enum(["CSV", "PDF"]), from: z.coerce.date(), to: z.coerce.date(), reason }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid export request" });
  if (parsed.data.to < parsed.data.from || parsed.data.to.getTime() - parsed.data.from.getTime() > 366 * 86400000) return res.status(400).json({ error: "Choose a period of up to 366 days" });
  const property = await loadProperty(Number(req.params.propertyId));
  if (!property) return res.status(404).json({ error: "Property not found" });
  const exportRecord = await db.nrmsAdminExport.create({ data: {
    adminId: req.user!.id,
    propertyId: property.id,
    kind: "DISPUTE",
    purpose: parsed.data.reason,
    fromAt: parsed.data.from,
    toAt: parsed.data.to,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    downloadedAt: new Date(),
    ipAddress: req.ip,
    userAgent: req.get("user-agent")?.slice(0, 255),
    sessionRef: String(req.headers.authorization || req.headers.cookie || "").slice(0, 128) || null,
  } });
  const data = await exportData(property.id, parsed.data.from, parsed.data.to);
  await db.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: property.ownerId, action: "NRMS_DISPUTE_EXPORT", details: { exportId: exportRecord.id, propertyId: property.id, format: parsed.data.format, piiRedacted: true, from: parsed.data.from, to: parsed.data.to, counts: { orders: data.orders.length, reservations: data.reservations.length, statements: data.statements.length }, reason: parsed.data.reason, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) } } });
  await notifyOwner(property.ownerId, "nrms_dispute_exported", { propertyTitle: property.title, from: parsed.data.from.toISOString(), to: parsed.data.to.toISOString(), reason: parsed.data.reason });
  const baseName = `nrms-dispute-${property.id}-${parsed.data.from.toISOString().slice(0, 10)}-${parsed.data.to.toISOString().slice(0, 10)}`;
  if (parsed.data.format === "PDF") {
    const pdf = await pdfBuffer(property.title, parsed.data.from, parsed.data.to, data);
    res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `attachment; filename="${baseName}.pdf"`); return res.end(pdf);
  }
  const rows: unknown[][] = [["record_type", "record_id", "reference", "status", "amount", "currency", "occurred_at", "details"]];
  for (const order of data.orders) rows.push(["ORDER", order.id, order.orderNumber, order.status, number(order.total), order.currency, order.createdAt.toISOString(), `${order.outlet?.name || "Outlet"}; ${order.items.map((i: any) => `${i.quantity} x ${i.nameSnapshot}`).join(" | ")}`]);
  for (const reservation of data.reservations) rows.push(["RESERVATION", reservation.id, reservation.receiptNumber || "", reservation.status, number(reservation.totalAmount), reservation.currency, reservation.createdAt.toISOString(), `Guest record redacted; paid ${number(reservation.amountPaid)}; charges ${number(reservation.chargesTotal)}`]);
  for (const statement of data.statements) rows.push(["PAYG_STATEMENT", statement.id, "", statement.status, number(statement.amount), statement.currency, statement.createdAt.toISOString(), `${statement.items.length} usage events`]);
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${baseName}.csv"`); res.send(`\uFEFF${csv}`);
}) as RequestHandler);

router.post("/property/:propertyId/retention", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const parsed = z.object({ closedAt: z.coerce.date(), reason }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  if (parsed.data.closedAt > new Date()) return res.status(400).json({ error: "Closure time cannot be in the future" });
  const property = await loadProperty(Number(req.params.propertyId));
  if (!property) return res.status(404).json({ error: "Property not found" });
  const account = await db.ownerPaygAccount.findUnique({ where: { propertyId: property.id } });
  if (!account || account.status !== "CLOSED") return res.status(409).json({ error: "Retention can only be scheduled for a closed account" });
  await db.ownerPaygAccount.update({ where: { id: account.id }, data: { retentionClosedAt: parsed.data.closedAt, guestDataAnonymizedAt: null, operationalDataMinimizedAt: null } });
  await db.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: property.ownerId, action: "NRMS_RETENTION_SCHEDULE", details: { propertyId: property.id, closedAt: parsed.data.closedAt, guestRetentionDays: NRMS_GUEST_RETENTION_DAYS, operationalRetentionDays: NRMS_OPERATIONAL_RETENTION_DAYS, reason: parsed.data.reason } } });
  await notifyOwner(property.ownerId, "nrms_retention_scheduled", { propertyTitle: property.title, closedAt: parsed.data.closedAt.toISOString(), guestRetentionDays: NRMS_GUEST_RETENTION_DAYS, operationalRetentionDays: NRMS_OPERATIONAL_RETENTION_DAYS, reason: parsed.data.reason });
  res.json({ retention: { closedAt: parsed.data.closedAt, guestRetentionDays: NRMS_GUEST_RETENTION_DAYS, operationalRetentionDays: NRMS_OPERATIONAL_RETENTION_DAYS } });
}) as RequestHandler);

router.get("/retention-policy", ((_req, res) => res.json({ guestDataDays: NRMS_GUEST_RETENTION_DAYS, operationalDataDays: NRMS_OPERATIONAL_RETENTION_DAYS, policy: "Guest identifiers are anonymized after 24 months. Operational notes and free text are minimized after 7 years. Financial totals, ledger entries, audits and immutable PAYG usage remain." })) as RequestHandler);

export default router;
