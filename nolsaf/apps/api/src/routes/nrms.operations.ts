import crypto from "crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth } from "../middleware/auth.js";
import { getNrmsEnrollment, isNrmsEntitled } from "../lib/nrms.js";
import { lockPropertyInventory } from "../lib/nrmsAvailability.js";
import { advanceNrmsOutletOrder } from "../lib/nrmsOrders.js";
import { sanitizeText } from "../lib/sanitize.js";
import { sendMail } from "../lib/mailer.js";
import { nrmsStaffInviteEmail } from "../lib/nrmsStaffEmails.js";
import { signNrmsStaffInviteToken, verifyNrmsStaffInviteToken } from "../lib/nrmsStaffInviteToken.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
const STAFF_ROLES = ["MANAGER", "FRONT_DESK", "RESTAURANT", "BAR", "OUTLET_SUPERVISOR"] as const;
const OUTLET_TYPES = ["RESTAURANT", "BAR", "OTHER"] as const;
const ORDER_SETTLEMENTS = ["ROOM_FOLIO", "OUTLET_PAYMENT"] as const;

type AccessRole = "OWNER" | (typeof STAFF_ROLES)[number];
type Access = {
  property: { id: number; ownerId: number; title: string; currency: string | null; nrmsActivatedAt: Date | null };
  role: AccessRole;
  outletId: number | null;
  membershipId: number | null;
};

const outletSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(OUTLET_TYPES),
  currency: z.string().trim().length(3).optional(),
});

const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(80).optional().nullable(),
  sku: z.string().trim().max(50).optional().nullable(),
  price: z.number().positive(),
});

const staffSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(STAFF_ROLES),
  outletId: z.number().int().positive().optional().nullable(),
});

const orderSchema = z.object({
  outletId: z.number().int().positive(),
  reservationId: z.number().int().positive(),
  settlementMode: z.enum(ORDER_SETTLEMENTS).default("ROOM_FOLIO"),
  note: z.string().trim().max(300).optional().nullable(),
  items: z.array(z.object({ menuItemId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).min(1).max(60),
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });
const advanceSchema = z.object({ settlementMethod: z.enum(["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"]).optional() });

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roleCanManage(access: Access): boolean {
  return access.role === "OWNER" || access.role === "MANAGER";
}

function roleCanCorrect(access: Access): boolean {
  return roleCanManage(access) || access.role === "OUTLET_SUPERVISOR";
}

function outletAllowed(access: Access, outlet: { id: number; type: string }): boolean {
  if (["OWNER", "MANAGER", "FRONT_DESK"].includes(access.role)) return true;
  if (access.outletId != null && access.outletId !== outlet.id) return false;
  if (access.role === "RESTAURANT") return outlet.type === "RESTAURANT";
  if (access.role === "BAR") return outlet.type === "BAR";
  return access.role === "OUTLET_SUPERVISOR";
}

async function loadAccess(req: AuthedRequest, res: Response, propertyId: number): Promise<Access | null> {
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    res.status(400).json({ error: "Invalid property id" });
    return null;
  }
  const userId = req.user!.id;
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { id: true, ownerId: true, title: true, currency: true, nrmsActivatedAt: true },
  });
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return null;
  }

  let access: Access | null = null;
  if (req.user!.role === "OWNER" && property.ownerId === userId) {
    access = { property, role: "OWNER", outletId: null, membershipId: null };
  } else {
    const membership = await db.nrmsStaffMembership.findFirst({
      where: { propertyId, userId, status: "ACTIVE" },
      orderBy: { id: "asc" },
    });
    if (membership) {
      access = { property, role: membership.role as AccessRole, outletId: membership.outletId, membershipId: membership.id };
    }
  }
  if (!access) {
    res.status(403).json({ error: "You do not have access to this NRMS property", code: "NRMS_PROPERTY_FORBIDDEN" });
    return null;
  }

  const [enrollment, account] = await Promise.all([
    getNrmsEnrollment(property.ownerId),
    db.ownerPaygAccount.findUnique({ where: { propertyId }, select: { id: true, status: true } }),
  ]);
  if (!property.nrmsActivatedAt || !account || !isNrmsEntitled(enrollment)) {
    res.status(403).json({ error: "NRMS operations are not active for this property", code: "NRMS_NOT_ACTIVE" });
    return null;
  }
  return access;
}

async function accessForOutlet(req: AuthedRequest, res: Response, outletId: number) {
  const outlet = await db.nrmsOutlet.findUnique({ where: { id: outletId }, include: { menuItems: { orderBy: { name: "asc" } } } });
  if (!outlet) {
    res.status(404).json({ error: "Outlet not found" });
    return null;
  }
  const access = await loadAccess(req, res, outlet.propertyId);
  if (!access) return null;
  if (!outletAllowed(access, outlet)) {
    res.status(403).json({ error: "This outlet is outside your assignment", code: "NRMS_OUTLET_FORBIDDEN" });
    return null;
  }
  return { access, outlet };
}

function formatOrder(order: any) {
  return {
    ...order,
    subtotal: number(order.subtotal),
    total: number(order.total),
    items: (order.items ?? []).map((item: any) => ({ ...item, unitPrice: number(item.unitPrice), lineTotal: number(item.lineTotal) })),
  };
}

const orderInclude = {
  outlet: { select: { id: true, name: true, code: true, type: true } },
  reservation: {
    select: {
      id: true,
      status: true,
      currency: true,
      guestProfile: { select: { fullName: true } },
      allocations: { where: { status: "ACTIVE" }, select: { roomUnit: { select: { code: true } }, roomType: { select: { name: true } } } },
    },
  },
  items: { orderBy: { id: "asc" as const } },
  createdBy: { select: { id: true, fullName: true, name: true } },
};

router.get("/me", (async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.id;
  if (req.user!.role === "OWNER") {
    const enrollment = await getNrmsEnrollment(userId);
    const properties = await db.property.findMany({
      where: { ownerId: userId },
      select: { id: true, title: true, currency: true, nrmsActivatedAt: true, nrmsPaygAccount: true },
      orderBy: { id: "asc" },
    });
    return res.json({ entitled: isNrmsEntitled(enrollment), workspaceMode: isNrmsEntitled(enrollment) ? "MARKETPLACE_NRMS" : "MARKETPLACE_ONLY", properties: properties.map((property: any) => ({ ...property, nrmsAccessRole: "OWNER", nrmsOutletId: null })) });
  }
  const memberships = await db.nrmsStaffMembership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { property: { select: { id: true, title: true, currency: true, nrmsActivatedAt: true, nrmsPaygAccount: true } } },
    orderBy: { id: "asc" },
  });
  const byProperty = new Map<number, any>();
  for (const membership of memberships) {
    if (!byProperty.has(membership.propertyId)) byProperty.set(membership.propertyId, { ...membership.property, nrmsAccessRole: membership.role, nrmsOutletId: membership.outletId });
  }
  const properties = [...byProperty.values()];
  res.json({ entitled: properties.length > 0, workspaceMode: properties.length > 0 ? "MARKETPLACE_NRMS" : "MARKETPLACE_ONLY", properties });
}) as RequestHandler);

router.get("/property/:propertyId/context", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const outlets = await db.nrmsOutlet.findMany({
    where: {
      propertyId: access.property.id,
      ...(access.outletId != null ? { id: access.outletId } : {}),
    },
    include: { menuItems: { where: { status: "ACTIVE" }, orderBy: [{ category: "asc" }, { name: "asc" }] } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  res.json({ access: { role: access.role, outletId: access.outletId }, property: access.property, outlets });
}) as RequestHandler);

router.get("/property/:propertyId/in-house", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const reservations = await db.reservation.findMany({
    where: { propertyId: access.property.id, status: "CHECKED_IN" },
    select: {
      id: true,
      currency: true,
      guestProfile: { select: { fullName: true } },
      allocations: { where: { status: "ACTIVE" }, select: { roomUnit: { select: { code: true } }, roomType: { select: { name: true } } } },
    },
    orderBy: { checkedInAt: "desc" },
  });
  res.json({ reservations });
}) as RequestHandler);

router.get("/property/:propertyId/outlets", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const outlets = await db.nrmsOutlet.findMany({
    where: { propertyId: access.property.id, ...(access.outletId != null ? { id: access.outletId } : {}) },
    include: { menuItems: { orderBy: [{ status: "asc" }, { name: "asc" }] }, _count: { select: { orders: true, memberships: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  res.json({ outlets });
}) as RequestHandler);

router.post("/property/:propertyId/outlets", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or NRMS manager can create outlets" });
  const parsed = outletSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid outlet", details: parsed.error.flatten() });
  const currency = parsed.data.currency?.toUpperCase() || access.property.currency?.toUpperCase();
  if (!currency) return res.status(409).json({ error: "Set the property currency before creating an outlet" });
  const outlet = await db.nrmsOutlet.create({
    data: {
      propertyId: access.property.id,
      name: sanitizeText(parsed.data.name),
      code: parsed.data.code.trim().toUpperCase(),
      type: parsed.data.type,
      currency,
    },
  });
  res.status(201).json({ outlet });
}) as RequestHandler);

router.post("/outlets/:outletId/menu-items", (async (req: AuthedRequest, res: Response) => {
  const resolved = await accessForOutlet(req, res, Number(req.params.outletId));
  if (!resolved) return;
  if (!roleCanManage(resolved.access) && resolved.access.role !== "OUTLET_SUPERVISOR") {
    return res.status(403).json({ error: "Only a manager or outlet supervisor can manage the menu" });
  }
  const parsed = menuItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid menu item", details: parsed.error.flatten() });
  const item = await db.nrmsMenuItem.create({
    data: {
      outletId: resolved.outlet.id,
      name: sanitizeText(parsed.data.name),
      category: parsed.data.category ? sanitizeText(parsed.data.category) : null,
      sku: parsed.data.sku ? sanitizeText(parsed.data.sku).toUpperCase() : null,
      price: parsed.data.price,
    },
  });
  res.status(201).json({ item });
}) as RequestHandler);

router.get("/property/:propertyId/staff", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or NRMS manager can view staff" });
  const staff = await db.nrmsStaffMembership.findMany({
    where: { propertyId: access.property.id },
    include: { user: { select: { id: true, fullName: true, name: true, email: true, phone: true } }, outlet: { select: { id: true, name: true, type: true } } },
    orderBy: [{ status: "asc" }, { role: "asc" }, { id: "desc" }],
  });
  res.json({ staff });
}) as RequestHandler);

router.post("/property/:propertyId/staff", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or NRMS manager can assign staff" });
  const parsed = staffSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid staff assignment", details: parsed.error.flatten() });
  const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() }, select: { id: true, email: true, fullName: true, name: true, suspendedAt: true, isDisabled: true } });
  if (!user) return res.status(404).json({ error: "No NoLSAF account uses this email. Ask the staff member to register first.", code: "STAFF_ACCOUNT_NOT_FOUND" });
  if (user.suspendedAt || user.isDisabled) return res.status(400).json({ error: "This account is suspended or disabled and cannot be assigned staff access.", code: "STAFF_ACCOUNT_BLOCKED" });
  if (parsed.data.outletId) {
    const outlet = await db.nrmsOutlet.findFirst({ where: { id: parsed.data.outletId, propertyId: access.property.id } });
    if (!outlet) return res.status(400).json({ error: "Selected outlet does not belong to this property" });
  }
  const membershipKey = { propertyId: access.property.id, userId: user.id, role: parsed.data.role };
  const existing = await db.nrmsStaffMembership.findUnique({ where: { propertyId_userId_role: membershipKey } });

  // Already confirmed assignments keep working; only the outlet scope changes.
  // New or unconfirmed assignments stay PENDING until the staff member confirms
  // the emailed invitation, and PENDING grants no access anywhere (all checks
  // filter on status ACTIVE).
  let membership;
  let needsConfirmation = false;
  if (existing && existing.status === "ACTIVE") {
    membership = await db.nrmsStaffMembership.update({
      where: { id: existing.id },
      data: { outletId: parsed.data.outletId ?? null },
    });
  } else if (existing) {
    membership = await db.nrmsStaffMembership.update({
      where: { id: existing.id },
      data: { outletId: parsed.data.outletId ?? null, status: "PENDING" },
    });
    needsConfirmation = true;
  } else {
    membership = await db.nrmsStaffMembership.create({
      data: { ...membershipKey, outletId: parsed.data.outletId ?? null, status: "PENDING" },
    });
    needsConfirmation = true;
  }

  let emailSent = false;
  if (needsConfirmation && user.email) {
    try {
      const [assignedBy, outlet] = await Promise.all([
        db.user.findUnique({ where: { id: req.user!.id }, select: { fullName: true, name: true } }),
        membership.outletId ? db.nrmsOutlet.findUnique({ where: { id: membership.outletId }, select: { name: true } }) : Promise.resolve(null),
      ]);
      const token = signNrmsStaffInviteToken(membership.id, user.id);
      const origin = (process.env.APP_URL || process.env.WEB_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
      const confirmUrl = `${origin}/nrms/confirm?token=${encodeURIComponent(token)}`;
      const { subject, html } = nrmsStaffInviteEmail({
        staffName: user.fullName || user.name || "there",
        propertyTitle: access.property.title,
        role: membership.role,
        outletName: outlet?.name ?? null,
        assignedByName: assignedBy?.fullName || assignedBy?.name || "The property manager",
        confirmUrl,
      });
      const delivery = await sendMail(user.email, subject, html);
      emailSent = (delivery as any)?.provider !== "suppressed";
    } catch (cause) {
      console.error("[NRMS] staff invite email failed", cause);
    }
  }

  res.status(201).json({ membership, user, needsConfirmation, emailSent });
}) as RequestHandler);

// Revoke a staff assignment. Soft-disable: the row is kept for the team list
// history, access dies instantly (all checks filter on ACTIVE), and any
// outstanding invite link for it is rejected by the confirm endpoint.
// Re-assigning the same email and role later re-invites through PENDING.
router.delete("/property/:propertyId/staff/:membershipId", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or NRMS manager can revoke staff access" });
  const membershipId = Number(req.params.membershipId);
  if (!Number.isInteger(membershipId) || membershipId <= 0) return res.status(400).json({ error: "Invalid staff assignment id" });
  const parsedReason = reasonSchema.safeParse(req.body ?? {});
  if (!parsedReason.success) return res.status(400).json({ error: "Provide a short reason for revoking access" });
  const reason = sanitizeText(parsedReason.data.reason);
  const membership = await db.nrmsStaffMembership.findFirst({ where: { id: membershipId, propertyId: access.property.id } });
  if (!membership) return res.status(404).json({ error: "Staff assignment not found" });
  if (membership.status === "DISABLED") return res.json({ membership });
  const updated = await db.nrmsStaffMembership.update({ where: { id: membership.id }, data: { status: "DISABLED" } });
  try {
    await db.auditLog.create({
      data: {
        actorId: req.user!.id,
        actorRole: req.user!.role ?? null,
        action: "NRMS_STAFF_REVOKE",
        entity: "NRMS_STAFF_MEMBERSHIP",
        entityId: membership.id,
        beforeJson: { status: membership.status },
        afterJson: { status: "DISABLED", reason, propertyId: access.property.id, userId: membership.userId, role: membership.role },
      },
    });
  } catch (cause) {
    console.error("[NRMS] revoke audit log failed", cause);
  }
  res.json({ membership: updated, reason });
}) as RequestHandler);

// Staff member confirms the emailed assignment invitation. Requires the invited
// user to be signed in; activates the PENDING membership.
router.post("/staff/confirm", (async (req: AuthedRequest, res: Response) => {
  const token = String(req.body?.token ?? "");
  const payload = verifyNrmsStaffInviteToken(token);
  if (!payload) return res.status(400).json({ error: "This invitation link is invalid or has expired. Ask the property manager to assign you again.", code: "NRMS_INVITE_INVALID" });

  const membership = await db.nrmsStaffMembership.findUnique({
    where: { id: payload.membershipId },
    include: {
      property: { select: { id: true, title: true } },
      outlet: { select: { id: true, name: true, type: true } },
    },
  });
  if (!membership || membership.userId !== payload.userId) {
    return res.status(400).json({ error: "This invitation is no longer valid.", code: "NRMS_INVITE_INVALID" });
  }
  if (membership.userId !== req.user!.id) {
    return res.status(403).json({ error: "This invitation belongs to another account. Sign in with the email address that received it.", code: "NRMS_INVITE_WRONG_ACCOUNT" });
  }
  if (membership.status !== "PENDING" && membership.status !== "ACTIVE") {
    return res.status(403).json({ error: "This assignment has been deactivated. Contact the property manager.", code: "NRMS_INVITE_DISABLED" });
  }

  const alreadyActive = membership.status === "ACTIVE";
  const confirmed = alreadyActive
    ? membership
    : await db.nrmsStaffMembership.update({
        where: { id: membership.id },
        data: { status: "ACTIVE" },
        include: {
          property: { select: { id: true, title: true } },
          outlet: { select: { id: true, name: true, type: true } },
        },
      });

  res.json({
    alreadyActive,
    membership: {
      id: confirmed.id,
      role: confirmed.role,
      status: confirmed.status,
      property: confirmed.property,
      outlet: confirmed.outlet,
    },
  });
}) as RequestHandler);

router.get("/property/:propertyId/orders", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const requestedOutletId = Number(req.query.outletId);
  const outletId = access.outletId ?? (Number.isInteger(requestedOutletId) && requestedOutletId > 0 ? requestedOutletId : null);
  const view = req.query.view === "live" ? "live" : req.query.view === "history" ? "history" : "all";
  const liveStatuses = ["CONFIRMED", "PREPARING"];
  const historyStatuses = ["POSTED_TO_FOLIO", "SETTLED", "CANCELLED", "VOIDED"];
  const requestedStatus = String(req.query.status ?? "");
  const allowedStatuses = view === "live" ? liveStatuses : historyStatuses;
  const status = requestedStatus && allowedStatuses.includes(requestedStatus)
    ? requestedStatus
    : view === "all" ? null : { in: allowedStatuses };
  const limit = Math.min(Math.max(Number(req.query.limit) || (view === "history" ? 12 : 150), 1), 150);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where: any = {
    propertyId: access.property.id,
    ...(outletId ? { outletId } : {}),
    ...(status ? { status } : {}),
    ...(access.role === "RESTAURANT" && !outletId ? { outlet: { type: "RESTAURANT" } } : {}),
    ...(access.role === "BAR" && !outletId ? { outlet: { type: "BAR" } } : {}),
  };
  const [total, orders] = await Promise.all([db.nrmsOutletOrder.count({ where }), db.nrmsOutletOrder.findMany({
    where,
    include: orderInclude,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  })]);
  res.json({ total, limit, offset, orders: orders.filter((order: any) => outletAllowed(access, order.outlet)).map(formatOrder) });
}) as RequestHandler);

router.post("/property/:propertyId/orders", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order", details: parsed.error.flatten() });
  const outlet = await db.nrmsOutlet.findFirst({ where: { id: parsed.data.outletId, propertyId: access.property.id, status: "ACTIVE" } });
  if (!outlet || !outletAllowed(access, outlet)) return res.status(403).json({ error: "Outlet is unavailable for this account" });
  if (access.role === "FRONT_DESK") return res.status(403).json({ error: "Front desk can review outlet orders but cannot create them" });
  const reservation = await db.reservation.findFirst({ where: { id: parsed.data.reservationId, propertyId: access.property.id, status: "CHECKED_IN" } });
  if (!reservation) return res.status(409).json({ error: "Select an actively checked-in guest before confirming the order", code: "GUEST_NOT_IN_HOUSE" });

  const requested = new Map<number, number>();
  for (const item of parsed.data.items) requested.set(item.menuItemId, (requested.get(item.menuItemId) ?? 0) + item.quantity);
  const menuItems = await db.nrmsMenuItem.findMany({ where: { id: { in: [...requested.keys()] }, outletId: outlet.id, status: "ACTIVE" } });
  if (menuItems.length !== requested.size) return res.status(400).json({ error: "One or more selected items are unavailable" });
  const lines = menuItems.map((item: any) => {
    const quantity = requested.get(item.id)!;
    const unitPrice = number(item.price);
    return { menuItemId: item.id, nameSnapshot: item.name, quantity, unitPrice, lineTotal: Number((unitPrice * quantity).toFixed(2)) };
  });
  const total = Number(lines.reduce((sum: number, line: any) => sum + line.lineTotal, 0).toFixed(2));
  const prefix = outlet.type === "RESTAURANT" ? "RST" : outlet.type === "BAR" ? "BAR" : "SVC";
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const orderNumber = `${prefix}-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const order = await db.nrmsOutletOrder.create({
    data: {
      propertyId: access.property.id,
      outletId: outlet.id,
      reservationId: reservation.id,
      orderNumber,
      status: "CONFIRMED",
      settlementMode: parsed.data.settlementMode,
      currency: reservation.currency,
      subtotal: total,
      total,
      note: parsed.data.note ? sanitizeText(parsed.data.note) : null,
      createdById: req.user!.id,
      confirmedById: req.user!.id,
      confirmedAt: new Date(),
      items: { create: lines },
    },
    include: orderInclude,
  });
  res.status(201).json({ order: formatOrder(order) });
}) as RequestHandler);

router.post("/orders/:orderId/advance", (async (req: AuthedRequest, res: Response) => {
  const parsed = advanceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Select a supported payment method" });
  const orderId = Number(req.params.orderId);
  const seed = await db.nrmsOutletOrder.findUnique({ where: { id: orderId }, include: { outlet: true } });
  if (!seed) return res.status(404).json({ error: "Order not found" });
  const access = await loadAccess(req, res, seed.propertyId);
  if (!access) return;
  if (!outletAllowed(access, seed.outlet) || access.role === "FRONT_DESK") return res.status(403).json({ error: "You cannot advance this order" });

  try {
    await db.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, seed.propertyId);
      await advanceNrmsOutletOrder(tx, { orderId, actorId: req.user!.id, settlementMethod: parsed.data.settlementMethod });
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NRMS_ORDER_NOT_FOUND") return res.status(404).json({ error: "Order not found" });
    if (code === "NRMS_ORDER_GUEST_NOT_IN_HOUSE") {
      return res.status(409).json({ error: "The guest is no longer checked in. This order cannot be posted to the room folio." });
    }
    if (code === "NRMS_ORDER_INVALID_TRANSITION") {
      return res.status(409).json({ error: "This order cannot move to the next stage from its current status." });
    }
    if (code === "NRMS_ORDER_TENDER_REQUIRED") return res.status(400).json({ error: "Select how the outlet payment was received before settling this order." });
    console.error("Failed to advance NRMS outlet order", error);
    return res.status(500).json({ error: "Unable to advance the order" });
  }
  const order = await db.nrmsOutletOrder.findUnique({ where: { id: orderId }, include: orderInclude });
  res.json({ order: formatOrder(order) });
}) as RequestHandler);

router.post("/orders/:orderId/cancel", (async (req: AuthedRequest, res: Response) => {
  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A cancellation reason is required" });
  const order = await db.nrmsOutletOrder.findUnique({ where: { id: Number(req.params.orderId) }, include: { outlet: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  const access = await loadAccess(req, res, order.propertyId);
  if (!access) return;
  if (!outletAllowed(access, order.outlet)) return res.status(403).json({ error: "You cannot cancel this order" });
  const changed = await db.nrmsOutletOrder.updateMany({
    where: { id: order.id, status: { in: ["CONFIRMED", "PREPARING"] } },
    data: { status: "CANCELLED", cancelledAt: new Date(), voidReason: sanitizeText(parsed.data.reason) },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "Only confirmed or preparing orders can be cancelled" });
  res.json({ ok: true });
}) as RequestHandler);

router.post("/orders/:orderId/void", (async (req: AuthedRequest, res: Response) => {
  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A void reason is required" });
  const seed = await db.nrmsOutletOrder.findUnique({ where: { id: Number(req.params.orderId) }, include: { outlet: true } });
  if (!seed) return res.status(404).json({ error: "Order not found" });
  const access = await loadAccess(req, res, seed.propertyId);
  if (!access) return;
  if (!roleCanCorrect(access) || !outletAllowed(access, seed.outlet)) return res.status(403).json({ error: "A manager or outlet supervisor must void a posted order" });
  await db.$transaction(async (tx: any) => {
    await lockPropertyInventory(tx, seed.propertyId);
    const order = await tx.nrmsOutletOrder.findUnique({ where: { id: seed.id } });
    if (!order || order.status !== "POSTED_TO_FOLIO" || !order.folioChargeId) throw new Error("NRMS_ORDER_NOT_VOIDABLE");
    const now = new Date();
    await tx.reservationCharge.update({ where: { id: order.folioChargeId }, data: { voidedAt: now, voidReason: sanitizeText(parsed.data.reason) } });
    const aggregate = await tx.reservationCharge.aggregate({ where: { reservationId: order.reservationId, voidedAt: null }, _sum: { amount: true } });
    await tx.reservation.update({ where: { id: order.reservationId }, data: { chargesTotal: aggregate._sum.amount ?? 0 } });
    await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "VOIDED", voidedAt: now, voidReason: sanitizeText(parsed.data.reason) } });
    await tx.reservationEvent.create({ data: { reservationId: order.reservationId, type: "CHARGE_VOIDED", actorId: req.user!.id, data: { chargeId: order.folioChargeId, orderId: order.id, reason: sanitizeText(parsed.data.reason) } } });
  });
  res.json({ ok: true });
}) as RequestHandler);

export default router;
