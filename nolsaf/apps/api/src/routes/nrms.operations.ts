import crypto from "crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth } from "../middleware/auth.js";
import { getNrmsEnrollment, isNrmsEntitled } from "../lib/nrms.js";
import { lockPropertyInventory } from "../lib/nrmsAvailability.js";
import { advanceNrmsOutletOrder } from "../lib/nrmsOrders.js";
import { type PerformancePeriod, ON_TIME_MINUTES, customPerformanceWindow, fillSeries, performanceWindow, shapePerformanceSummary } from "../lib/nrmsPerformance.js";
import { assertNrmsBusinessDayWritable, ensureBusinessDay, expectedCashForShift, NRMS_BUSINESS_DAY_LOCKED, shiftDayKey, shiftHandoverSummary } from "../lib/nrmsShifts.js";
import { StockError, deriveStockPatch, reserveMenuStock, restoreMenuStock } from "../lib/nrmsStock.js";
import { computeOutstanding } from "../lib/nrmsFolio.js";
import { voidRoutedCharge } from "../lib/nrmsMasterFolio.js";
import {
  HOUSEKEEPING_STATUSES,
  HOUSEKEEPING_TASK_PRIORITIES,
  HOUSEKEEPING_TASK_TYPES,
  dailyHousekeepingWindow,
  ensureDailyOccupiedCleaning,
  isCleaningTaskType,
  roleCanHousekeep,
  roleCanManageHousekeeping,
  setRoomHousekeepingStatus,
  taskActionAllowed,
} from "../lib/nrmsHousekeeping.js";
import { sanitizeText } from "../lib/sanitize.js";
import { sendMail } from "../lib/mailer.js";
import { RESTRICTION_SCOPE, findOpenRestrictionCase } from "../lib/restrictionCases.js";
import { nrmsAssignmentNeedsConfirmation } from "../lib/nrmsStaffAssignment.js";
import { nrmsStaffInviteEmail } from "../lib/nrmsStaffEmails.js";
import { checkNrmsQuota } from "../lib/nrmsQuotas.js";
import { buildBreakfastList } from "../lib/nrmsBreakfastList.js";
import { generateNrmsBreakfastListPdf, generateNrmsRandomCode } from "../lib/pdfDocuments.js";
import { signNrmsStaffInviteToken, verifyNrmsStaffInviteToken } from "../lib/nrmsStaffInviteToken.js";
import {
  generateOrderPointToken,
  generateQrSheetPdf,
  makeOrderPointQR,
  buildMenuUrl,
  isValidOrderPointType,
} from "../lib/nrmsOrderPoints.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
// These order transactions take the property inventory lock and then do several
// dependent writes. Prisma's 5s interactive-transaction default was tripping
// P2028 in production because the Render-to-database round trips are slow; the
// work itself is small. 15s gives headroom without holding the lock indefinitely.
// Same values as owner.nrms.reservations EXTENDED_TX_OPTIONS.
const ORDER_TX_OPTIONS = { maxWait: 5000, timeout: 15000 };
const LIVE_ORDER_STATUSES = ["PLACED", "CONFIRMED", "PREPARING", "SERVING"];
// Two disjoint order worlds that must never be mixed on the same board: anything
// tied to a checked-in guest or a room QR point is "room" service (handled in the
// Live order queue); a table QR point or a walk-in with no reservation is "table"
// service (handled in Tables & tabs). Every live order falls in exactly one.
const ROOM_ORDER_FILTER = { OR: [{ reservationId: { not: null } }, { orderPoint: { is: { type: "ROOM" } } }] };
const TABLE_ORDER_FILTER = { reservationId: null, OR: [{ orderPointId: null }, { orderPoint: { is: { type: "TABLE" } } }] };
const STAFF_ROLES = ["MANAGER", "FRONT_DESK", "HOUSEKEEPER", "RESTAURANT", "BAR", "OUTLET_SUPERVISOR"] as const;
const OUTLET_TYPES = ["RESTAURANT", "BAR", "OTHER"] as const;
const ORDER_SETTLEMENTS = ["ROOM_FOLIO", "OUTLET_PAYMENT"] as const;

type AccessRole = "OWNER" | (typeof STAFF_ROLES)[number];
type Access = {
  property: {
    id: number;
    ownerId: number;
    title: string;
    status: string;
    currency: string | null;
    nrmsActivatedAt: Date | null;
    nrmsMenuPublic: boolean;
    housekeepingDailyServiceEnabled: boolean;
    housekeepingDailyServiceTime: string;
  };
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

const RESTAURANT_MENU_CATEGORIES = new Set([
  "Breakfast", "Starters", "Soups", "Salads", "Local specialities", "Main courses",
  "Grills and barbecue", "Seafood", "Chicken dishes", "Meat dishes", "Vegetarian and vegan",
  "Rice dishes", "Pasta and noodles", "Pizza", "Burgers and sandwiches", "Sides", "Kids menu",
  "Desserts", "Tea and coffee", "Fresh juices", "Soft drinks", "Water",
]);

const BAR_MENU_CATEGORIES = new Set([
  "Beer", "Cider", "Red wine", "White wine", "Rosé wine", "Sparkling wine", "Whisky", "Gin",
  "Vodka", "Rum", "Tequila", "Brandy and cognac", "Liqueurs", "Cocktails", "Mocktails",
  "Soft drinks and mixers", "Energy drinks", "Water", "Bar snacks",
]);

export function menuCategoryAllowed(outletType: string, category: string): boolean {
  if (outletType === "RESTAURANT") return RESTAURANT_MENU_CATEGORIES.has(category);
  if (outletType === "BAR") return BAR_MENU_CATEGORIES.has(category);
  return RESTAURANT_MENU_CATEGORIES.has(category) || BAR_MENU_CATEGORIES.has(category);
}

const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(80).optional().nullable(),
  sku: z.string().trim().max(50).optional().nullable(),
  price: z.number().positive(),
  description: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().trim().url().max(500).startsWith("https://").optional().nullable(),
  inStock: z.boolean().optional(),
});

const menuItemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category: z.string().trim().max(80).optional().nullable(),
  sku: z.string().trim().max(50).optional().nullable(),
  price: z.number().positive().optional(),
  description: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().trim().url().max(500).startsWith("https://").optional().nullable(),
  inStock: z.boolean().optional(),
  stockQuantity: z.number().int().min(0).max(1_000_000).optional().nullable(),
  lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

const categoryOrderSchema = z.object({
  categoryOrder: z.array(z.string().trim().min(1).max(80)).max(40),
});

const staffSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(STAFF_ROLES),
  outletId: z.number().int().positive().optional().nullable(),
});

const orderSchema = z.object({
  outletId: z.number().int().positive(),
  /// Absent for walk-in / non-resident sales (doc NRMS_QR_ORDERING.md m1).
  reservationId: z.number().int().positive().optional().nullable(),
  /// Staff picking a configured dining table, e.g. from the Tables & tabs board.
  orderPointId: z.number().int().positive().optional().nullable(),
  /// Who the walk-in order is for: "Table 4", a name, defaults to "Walk-in".
  customerLabel: z.string().trim().min(1).max(120).optional().nullable(),
  settlementMode: z.enum(ORDER_SETTLEMENTS).default("ROOM_FOLIO"),
  note: z.string().trim().max(300).optional().nullable(),
  items: z.array(z.object({ menuItemId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).min(1).max(60),
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });
const advanceSchema = z.object({ settlementMethod: z.enum(["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"]).optional() });
const tipRecordSchema = z.object({
  paymentAmountReceived: z.number().finite().nonnegative().optional().nullable(),
  tipAmount: z.number().finite().nonnegative().default(0),
  tipRecipientId: z.number().int().positive().optional().nullable(),
  tipMethod: z.enum(["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"]).optional().nullable(),
});

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
    select: {
      id: true,
      ownerId: true,
      title: true,
      status: true,
      currency: true,
      nrmsActivatedAt: true,
      nrmsMenuPublic: true,
      housekeepingDailyServiceEnabled: true,
      housekeepingDailyServiceTime: true,
    },
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
  if (property.status !== "APPROVED") {
    res.status(403).json({
      error: "This property must be an approved Marketplace listing before NRMS can be used",
      code: "NRMS_PROPERTY_NOT_APPROVED",
      propertyStatus: property.status,
    });
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
  if (["FROZEN", "CLOSED"].includes(account.status)) {
    const restriction = await findOpenRestrictionCase(RESTRICTION_SCOPE.NRMS_PROPERTY, propertyId);
    res.status(423).json({
      error: "NRMS operations are temporarily unavailable for this property",
      code: "NRMS_PROPERTY_FROZEN",
      referenceCode: restriction?.referenceCode ?? null,
      reason: restriction?.reason ?? null,
    });
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
  // A room-folio order never collects its own cash: the money lands when the
  // guest's whole stay is settled, not per outlet ticket. Once that reservation
  // balance is at zero, "no tip recorded" is a finished fact, not an open task
  // for staff to keep chasing on this specific order.
  const transferredToMaster = (order.reservation?.masterFolioItems ?? []).reduce((sum: number, item: any) => sum + number(item.amount), 0);
  const reservationSettled = order.settlementMode === "ROOM_FOLIO" && order.reservation
    ? computeOutstanding(order.reservation.totalAmount, order.reservation.chargesTotal, number(order.reservation.amountPaid) + transferredToMaster) <= 0
    : false;
  const { totalAmount: _totalAmount, chargesTotal: _chargesTotal, amountPaid: _amountPaid, masterFolioItems: _masterFolioItems, ...reservationPublic } = order.reservation ?? {};
  return {
    ...order,
    subtotal: number(order.subtotal),
    total: number(order.total),
    paymentAmountReceived: order.paymentAmountReceived == null ? null : number(order.paymentAmountReceived),
    tipSuggestedAmount: order.tipSuggestedAmount == null ? null : number(order.tipSuggestedAmount),
    tipAmount: order.tipAmount == null ? null : number(order.tipAmount),
    items: (order.items ?? []).map((item: any) => ({ ...item, unitPrice: number(item.unitPrice), lineTotal: number(item.lineTotal) })),
    reservation: order.reservation ? reservationPublic : null,
    reservationSettled,
  };
}

const orderInclude = {
  outlet: { select: { id: true, name: true, code: true, type: true } },
  reservation: {
    select: {
      id: true,
      status: true,
      currency: true,
      totalAmount: true,
      chargesTotal: true,
      amountPaid: true,
      masterFolioItems: { where: { voidedAt: null }, select: { amount: true } },
      guestProfile: { select: { fullName: true } },
      allocations: { where: { status: "ACTIVE" }, select: { roomUnit: { select: { code: true } }, roomType: { select: { name: true } } } },
    },
  },
  items: { orderBy: { id: "asc" as const } },
  createdBy: { select: { id: true, fullName: true, name: true } },
  settledBy: { select: { id: true, fullName: true, name: true } },
  tipRecipient: { select: { id: true, fullName: true, name: true } },
  tipConfirmedBy: { select: { id: true, fullName: true, name: true } },
  orderPoint: { select: { id: true, type: true, label: true } },
};

router.get("/me", (async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.id;
  // First name for the workspace greeting. The JWT does not reliably carry the
  // full name, so read it once; a failure just yields a nameless greeting.
  const viewerRecord = await db.user.findUnique({ where: { id: userId }, select: { fullName: true, name: true } });
  const firstName = String(viewerRecord?.fullName || viewerRecord?.name || "").trim().split(/\s+/)[0] || null;
  if (req.user!.role === "OWNER") {
    const enrollment = await getNrmsEnrollment(userId);
    const properties = await db.property.findMany({
      where: { ownerId: userId },
      select: { id: true, title: true, currency: true, nrmsActivatedAt: true, nrmsPaygAccount: true },
      orderBy: { id: "asc" },
    });
    return res.json({ viewer: { firstName }, entitled: isNrmsEntitled(enrollment), workspaceMode: isNrmsEntitled(enrollment) ? "MARKETPLACE_NRMS" : "MARKETPLACE_ONLY", properties: properties.map((property: any) => ({ ...property, nrmsAccessRole: "OWNER", nrmsOutletId: null })) });
  }
  const memberships = await db.nrmsStaffMembership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { property: { select: { id: true, title: true, status: true, currency: true, nrmsActivatedAt: true, nrmsPaygAccount: true } } },
    orderBy: { id: "asc" },
  });
  const byProperty = new Map<number, any>();
  for (const membership of memberships) {
    if (!byProperty.has(membership.propertyId)) byProperty.set(membership.propertyId, { ...membership.property, nrmsAccessRole: membership.role, nrmsOutletId: membership.outletId });
  }
  const properties = [...byProperty.values()];
  res.json({ viewer: { firstName }, entitled: properties.length > 0, workspaceMode: properties.length > 0 ? "MARKETPLACE_NRMS" : "MARKETPLACE_ONLY", properties });
}) as RequestHandler);

/**
 * Breakfast list, the sheet the restaurant serves the morning from.
 *
 * Lives on the operations router rather than the owner one because it is a
 * handover between two desks: front office prepares it, the restaurant works
 * from it, and both need to be able to open and print it.
 *
 * Two routes over one builder, so the list reviewed on screen and the PDF
 * carried to the pass can never disagree. Defaults to tomorrow's service,
 * because the sheet is produced at night audit for the morning ahead, while
 * the kitchen still has time to act on the numbers.
 */
const BREAKFAST_LIST_ROLES: AccessRole[] = ["OWNER", "MANAGER", "FRONT_DESK", "RESTAURANT"];

const breakfastListQuery = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entitledOnly: z.union([z.literal("1"), z.literal("true")]).optional(),
});

/** Tomorrow as a business date in the operating timezone. */
function defaultBreakfastServiceDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 86400000));
}

async function loadBreakfastList(req: AuthedRequest, res: Response) {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return null;
  if (!BREAKFAST_LIST_ROLES.includes(access.role)) {
    res.status(403).json({ error: "Your role cannot open the breakfast list" });
    return null;
  }
  const query = breakfastListQuery.parse(req.query);
  const serviceDate = query.date ?? defaultBreakfastServiceDate();
  const list = await buildBreakfastList({
    propertyId: access.property.id,
    propertyTitle: access.property.title,
    serviceDate,
    entitledOnly: !!query.entitledOnly,
  });
  return { access, list, serviceDate };
}

function breakfastPdfFilename(propertyName: string, serviceDate: string): string {
  const safeProperty = propertyName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 &()_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "HOTEL";
  return `${safeProperty}_BREAKFAST_${serviceDate.replace(/-/g, "")}.pdf`;
}

router.get("/property/:propertyId/breakfast-list", (async (req: AuthedRequest, res: Response) => {
  try {
    const loaded = await loadBreakfastList(req, res);
    if (!loaded) return;
    res.json({ ok: true, ...loaded.list });
  } catch (err) {
    console.error("[nrms.operations] breakfast list failed", err);
    res.status(500).json({ error: "Failed to build the breakfast list" });
  }
}) as RequestHandler);

router.get("/property/:propertyId/breakfast-list.pdf", (async (req: AuthedRequest, res: Response) => {
  try {
    const loaded = await loadBreakfastList(req, res);
    if (!loaded) return;
    const { list, serviceDate } = loaded;

    // Every print gets its own number on purpose: two copies on the pass with
    // different counts must be tellable apart at a glance.
    const documentNumber = `BFL-${loaded.access.property.id}-${serviceDate.replace(/-/g, "")}-${generateNrmsRandomCode()}`;
    const pdf = await generateNrmsBreakfastListPdf({
      propertyName: loaded.access.property.title,
      serviceDate,
      nightOf: list.nightOf,
      documentNumber,
      generatedAt: list.generatedAt,
      preparedBy: req.user?.name ?? null,
      rows: list.rows,
      totals: list.totals,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${breakfastPdfFilename(loaded.access.property.title, serviceDate)}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf);
  } catch (err) {
    console.error("[nrms.operations] breakfast list pdf failed", err);
    res.status(500).json({ error: "Failed to generate the breakfast list" });
  }
}) as RequestHandler);

router.get("/property/:propertyId/context", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const [outlets, memberships, owner] = await Promise.all([
    db.nrmsOutlet.findMany({
      where: { propertyId: access.property.id, ...(access.outletId != null ? { id: access.outletId } : {}) },
      include: { menuItems: { where: { status: "ACTIVE" }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }] } },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    db.nrmsStaffMembership.findMany({
      where: {
        propertyId: access.property.id,
        status: "ACTIVE",
        role: { in: ["MANAGER", "RESTAURANT", "BAR", "OUTLET_SUPERVISOR"] },
        ...(access.outletId != null ? { OR: [{ outletId: access.outletId }, { outletId: null }] } : {}),
      },
      select: { role: true, outletId: true, user: { select: { id: true, fullName: true, name: true } } },
      orderBy: { id: "asc" },
    }),
    db.user.findUnique({ where: { id: access.property.ownerId }, select: { id: true, fullName: true, name: true } }),
  ]);
  const attendantMap = new Map<number, any>();
  if (owner) attendantMap.set(owner.id, { ...owner, role: "OWNER", outletId: null });
  for (const membership of memberships) attendantMap.set(membership.user.id, { ...membership.user, role: membership.role, outletId: membership.outletId });
  res.json({ access: { role: access.role, outletId: access.outletId, userId: req.user!.id }, property: access.property, outlets, attendants: [...attendantMap.values()] });
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

router.get("/property/:propertyId/performance", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const propertyId = access.property.id;
  const period = (["day", "week", "month", "year"].includes(String(req.query.period)) ? req.query.period : "day") as PerformancePeriod;
  // Staff assigned to one outlet only ever see that outlet. A manager/owner may
  // narrow to a chosen outlet via ?outletId, or leave it off for the whole property.
  const requestedOutlet = req.query.outletId ? Number(req.query.outletId) : null;
  const outletId = access.outletId != null ? access.outletId : (Number.isInteger(requestedOutlet) && requestedOutlet! > 0 ? requestedOutlet : null);
  // Only someone who oversees others can single out one attendant's own figures.
  const canFilterAttendant = ["OWNER", "MANAGER", "OUTLET_SUPERVISOR"].includes(access.role);
  const requestedAttendant = req.query.attendantId ? Number(req.query.attendantId) : null;
  const attendantId = canFilterAttendant && Number.isInteger(requestedAttendant) && requestedAttendant! > 0 ? requestedAttendant : null;

  // An explicit from/to range (both YYYY-MM-DD, from <= to) overrides the preset.
  const dateKey = /^\d{4}-\d{2}-\d{2}$/;
  const fromKey = String(req.query.from ?? "");
  const toKey = String(req.query.to ?? "");
  const isCustom = dateKey.test(fromKey) && dateKey.test(toKey) && fromKey <= toKey;
  const window = isCustom ? customPerformanceWindow(fromKey, toKey) : performanceWindow(period, new Date());
  const { start, end, format, buckets } = window;
  const activePeriod = isCustom ? "custom" : period;
  const granularity = isCustom ? (window as ReturnType<typeof customPerformanceWindow>).granularity : (period === "day" ? "hour" : period === "year" ? "month" : "day");
  // Comparison tables only make sense on the dimension not already pinned down:
  // no single outlet chosen -> compare outlets; no single attendant chosen ->
  // compare staff (scoped to whichever outlet is selected, if any).
  const wantsOutletBreakdown = outletId == null;
  const wantsStaffBreakdown = canFilterAttendant && attendantId == null;
  try {
    const [summaryRows, bucketRows, shift, outlets, staff, outletBreakdownRows, staffBreakdownRows] = await Promise.all([
      db.$queryRaw<any[]>`
        SELECT COUNT(*) AS orders,
               COALESCE(SUM(total), 0) AS sales,
               AVG(TIMESTAMPDIFF(SECOND, COALESCE(placedAt, createdAt), confirmedAt)) AS acceptSec,
               AVG(TIMESTAMPDIFF(SECOND, confirmedAt, servingAt)) AS prepSec,
               AVG(TIMESTAMPDIFF(SECOND, servingAt, servedAt)) AS serveSec,
               AVG(TIMESTAMPDIFF(SECOND, COALESCE(placedAt, createdAt), servedAt)) AS totalSec,
               SUM(servedAt IS NOT NULL AND TIMESTAMPDIFF(MINUTE, COALESCE(placedAt, createdAt), servedAt) <= ${ON_TIME_MINUTES}) AS onTime,
               SUM(servedAt IS NOT NULL) AS served
        FROM nrms_outlet_order
        WHERE propertyId = ${propertyId}
          AND status IN ('SETTLED', 'POSTED_TO_FOLIO')
          AND COALESCE(settledAt, postedAt, servedAt, createdAt) >= ${start}
          AND COALESCE(settledAt, postedAt, servedAt, createdAt) < ${end}
          AND (${outletId} IS NULL OR outletId = ${outletId})
          AND (${attendantId} IS NULL OR settledById = ${attendantId})`,
      db.$queryRaw<any[]>`
        SELECT DATE_FORMAT(COALESCE(settledAt, postedAt, servedAt, createdAt), ${format}) AS bucket,
               COALESCE(SUM(total), 0) AS sales
        FROM nrms_outlet_order
        WHERE propertyId = ${propertyId}
          AND status IN ('SETTLED', 'POSTED_TO_FOLIO')
          AND COALESCE(settledAt, postedAt, servedAt, createdAt) >= ${start}
          AND COALESCE(settledAt, postedAt, servedAt, createdAt) < ${end}
          AND (${outletId} IS NULL OR outletId = ${outletId})
          AND (${attendantId} IS NULL OR settledById = ${attendantId})
        GROUP BY bucket
        ORDER BY bucket`,
      db.nrmsCashierShift.findFirst({
        where: { propertyId, userId: req.user!.id, status: "OPEN" },
        orderBy: { openedAt: "desc" },
        select: { id: true, userId: true, propertyId: true, openedAt: true, openingFloat: true, currency: true, handoverFrom: { select: { user: { select: { fullName: true, name: true, email: true } } } } },
      }),
      db.nrmsOutlet.findMany({ where: { propertyId, ...(access.outletId != null ? { id: access.outletId } : {}) }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
      canFilterAttendant
        ? db.nrmsStaffMembership.findMany({
            where: { propertyId, status: "ACTIVE", role: { in: ["RESTAURANT", "BAR", "OUTLET_SUPERVISOR"] }, ...(outletId != null ? { OR: [{ outletId }, { outletId: null }] } : {}) },
            select: { role: true, outletId: true, user: { select: { id: true, fullName: true, name: true } } },
            orderBy: { id: "asc" },
          })
        : Promise.resolve([]),
      wantsOutletBreakdown
        ? db.$queryRaw<any[]>`
            SELECT outletId,
                   COUNT(*) AS orders,
                   COALESCE(SUM(total), 0) AS sales,
                   SUM(servedAt IS NOT NULL AND TIMESTAMPDIFF(MINUTE, COALESCE(placedAt, createdAt), servedAt) <= ${ON_TIME_MINUTES}) AS onTime,
                   SUM(servedAt IS NOT NULL) AS served
            FROM nrms_outlet_order
            WHERE propertyId = ${propertyId}
              AND status IN ('SETTLED', 'POSTED_TO_FOLIO')
              AND COALESCE(settledAt, postedAt, servedAt, createdAt) >= ${start}
              AND COALESCE(settledAt, postedAt, servedAt, createdAt) < ${end}
              AND (${attendantId} IS NULL OR settledById = ${attendantId})
            GROUP BY outletId`
        : Promise.resolve([]),
      wantsStaffBreakdown
        ? db.$queryRaw<any[]>`
            SELECT settledById,
                   COUNT(*) AS orders,
                   COALESCE(SUM(total), 0) AS sales,
                   SUM(servedAt IS NOT NULL AND TIMESTAMPDIFF(MINUTE, COALESCE(placedAt, createdAt), servedAt) <= ${ON_TIME_MINUTES}) AS onTime,
                   SUM(servedAt IS NOT NULL) AS served
            FROM nrms_outlet_order
            WHERE propertyId = ${propertyId}
              AND status IN ('SETTLED', 'POSTED_TO_FOLIO')
              AND COALESCE(settledAt, postedAt, servedAt, createdAt) >= ${start}
              AND COALESCE(settledAt, postedAt, servedAt, createdAt) < ${end}
              AND (${outletId} IS NULL OR outletId = ${outletId})
              AND settledById IS NOT NULL
            GROUP BY settledById`
        : Promise.resolve([]),
    ]);

    const summary = shapePerformanceSummary(summaryRows[0] ?? {});
    const outletNameById = new Map(outlets.map((item: any) => [item.id, item.name]));
    const staffNameById = new Map(staff.map((member: any) => [member.user.id, attendeeName(member.user)]));
    const breakdownRow = (row: any) => shapePerformanceSummary(row);
    const byOutlet = outletBreakdownRows
      .map((row: any) => ({ id: row.outletId, name: outletNameById.get(row.outletId) ?? "Outlet", ...breakdownRow(row) }))
      .sort((a: any, b: any) => b.sales - a.sales);
    const byStaff = staffBreakdownRows
      .map((row: any) => ({ id: row.settledById, name: staffNameById.get(row.settledById) ?? "Team member", ...breakdownRow(row) }))
      .sort((a: any, b: any) => b.sales - a.sales);
    // The stored expectedCash is only written at close time; recompute it live so
    // an open shift shows the true drawer figure.
    const liveExpected = shift ? await expectedCashForShift(db, shift) : 0;
    // A recently closed drawer nobody has confirmed yet is offered to the next
    // attendee as a takeover. 12 hours covers a late-night to morning gap without
    // resurfacing stale drawers from days ago.
    const pendingHandover = !shift && SHIFT_ROLES.has(access.role)
      ? await db.nrmsCashierShift.findFirst({
          where: { propertyId, status: "CLOSED", handoverTo: null, closedAt: { gte: new Date(Date.now() - 12 * 3600 * 1000) } },
          orderBy: { closedAt: "desc" },
          select: { id: true, expectedCash: true, closedAt: true, currency: true, user: { select: { fullName: true, name: true, email: true } } },
        })
      : null;
    res.json({
      period: activePeriod,
      granularity,
      range: isCustom ? { from: fromKey, to: toKey } : null,
      currency: access.property.currency,
      outletId,
      outlets,
      canFilterOutlet: access.outletId == null,
      attendantId,
      staff: staff.map((member: any) => ({ id: member.user.id, name: attendeeName(member.user), role: member.role, outletId: member.outletId })),
      canFilterAttendant,
      breakdown: { byOutlet: wantsOutletBreakdown ? byOutlet : null, byStaff: wantsStaffBreakdown ? byStaff : null },
      canManageShift: SHIFT_ROLES.has(access.role),
      summary,
      series: fillSeries(bucketRows, buckets),
      shift: shift
        ? { id: shift.id, openedAt: shift.openedAt, openingFloat: Number(shift.openingFloat), expectedCash: liveExpected, currency: shift.currency, takenOverFrom: shift.handoverFrom ? attendeeName(shift.handoverFrom.user) : null }
        : null,
      handover: pendingHandover
        ? { shiftId: pendingHandover.id, attendeeName: attendeeName(pendingHandover.user), amount: Number(pendingHandover.expectedCash), closedAt: pendingHandover.closedAt, currency: pendingHandover.currency }
        : null,
    });
  } catch (error) {
    console.error("[nrms.operations] performance failed", error);
    res.status(500).json({ error: "Unable to load performance" });
  }
}) as RequestHandler);

// Shift & cash is scoped to outlet staff who run a drawer at their assigned
// bar or restaurant. Owner, manager, front desk and outlet supervisor do not
// get a personal shift here.
const SHIFT_ROLES = new Set(["RESTAURANT", "BAR"]);

function attendeeName(user: any): string {
  return user?.fullName || user?.name || user?.email || "Previous attendee";
}
// Every sale is recorded in the system by the attendee who took it, so shifts
// carry no manually typed amounts. Opening fresh starts at zero; opening as a
// handover inherits the outgoing shift's system-computed drawer figure.
const openShiftSchema = z.object({ handoverFromShiftId: z.number().int().positive().optional() });
const closeShiftSchema = z.object({ closeNote: z.string().trim().max(300).nullable().optional() });

// A staff member sees and controls only their own shift. The business date is set
// from the server clock in the property timezone, never chosen by the attendant.
router.post("/property/:propertyId/shifts/open", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!SHIFT_ROLES.has(access.role)) return res.status(403).json({ error: "Your role does not run a cash shift" });
  const parsed = openShiftSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid shift request" });
  const currency = access.property.currency?.toUpperCase();
  if (!currency) return res.status(409).json({ error: "Set the property currency before opening a shift" });
  try {
    const shift = await db.$transaction(async (tx: any) => {
      const existing = await tx.nrmsCashierShift.findFirst({ where: { propertyId: access.property.id, userId: req.user!.id, status: "OPEN" } });
      if (existing) throw new Error("SHIFT_ALREADY_OPEN");
      // Confirming a handover: the incoming attendee, authenticated as themselves,
      // accepts the outgoing shift's drawer at the amount the system computed.
      // The confirmation itself is the signature; nothing is typed by hand.
      let openingFloat = 0;
      let handoverFromId: number | null = null;
      if (parsed.data.handoverFromShiftId) {
        const outgoing = await tx.nrmsCashierShift.findFirst({
          where: { id: parsed.data.handoverFromShiftId, propertyId: access.property.id, status: "CLOSED" },
        });
        if (!outgoing) throw new Error("HANDOVER_NOT_FOUND");
        const taken = await tx.nrmsCashierShift.findFirst({ where: { handoverFromId: outgoing.id } });
        if (taken) throw new Error("HANDOVER_TAKEN");
        openingFloat = Number(outgoing.expectedCash);
        handoverFromId = outgoing.id;
      }
      const day = await ensureBusinessDay(tx, access.property.id, shiftDayKey(new Date()), req.user!.id);
      if (day.status === "CLOSED") throw new Error("BUSINESS_DAY_CLOSED");
      return tx.nrmsCashierShift.create({ data: { propertyId: access.property.id, businessDayId: day.id, userId: req.user!.id, businessDate: day.businessDate, currency, openingFloat, handoverFromId } });
    }, ORDER_TX_OPTIONS);
    res.status(201).json({ shift: { id: shift.id, openedAt: shift.openedAt, openingFloat: Number(shift.openingFloat), currency: shift.currency } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SHIFT_ALREADY_OPEN") return res.status(409).json({ error: "You already have an open shift. Close it before opening another." });
    if (code === "BUSINESS_DAY_CLOSED") return res.status(409).json({ error: "Today is already closed by the night audit and cannot accept a new shift." });
    if (code === "HANDOVER_NOT_FOUND") return res.status(404).json({ error: "That closed shift is no longer available for handover." });
    // The unique index on handoverFromId also backstops a concurrent double-confirm.
    if (code === "HANDOVER_TAKEN" || (error as any)?.code === "P2002") return res.status(409).json({ error: "Another attendee already confirmed this handover." });
    console.error("[nrms.operations] shift open failed", error);
    res.status(500).json({ error: "Unable to open the shift" });
  }
}) as RequestHandler);

// The pre-handover review: everything the attendee is accountable for, classified,
// before they seal the shift. The manager later sees the identical snapshot.
router.get("/property/:propertyId/shifts/current/summary", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!SHIFT_ROLES.has(access.role)) return res.status(403).json({ error: "Your role does not run a cash shift" });
  const shift = await db.nrmsCashierShift.findFirst({ where: { propertyId: access.property.id, userId: req.user!.id, status: "OPEN" } });
  if (!shift) return res.status(404).json({ error: "You have no open shift" });
  const until = new Date();
  const [summary, expectedCash] = await Promise.all([shiftHandoverSummary(db, shift, until), expectedCashForShift(db, shift, until)]);
  res.json({ shiftId: shift.id, openingFloat: Number(shift.openingFloat), expectedCash, summary });
}) as RequestHandler);

router.post("/property/:propertyId/shifts/:shiftId/close", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!SHIFT_ROLES.has(access.role)) return res.status(403).json({ error: "Your role does not run a cash shift" });
  const parsed = closeShiftSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid close request" });
  // Staff may only close their OWN shift. Managers close others through Finance.
  const shift = await db.nrmsCashierShift.findFirst({ where: { id: Number(req.params.shiftId), propertyId: access.property.id, userId: req.user!.id, status: "OPEN" } });
  if (!shift) return res.status(404).json({ error: "You have no open shift to close" });
  // No manual count: every sale was recorded in the system by this attendee, so
  // the system figure IS the drawer figure. Closing seals it under their name
  // together with the classified snapshot they just reviewed, and the next
  // attendee's takeover confirmation acknowledges receipt of it. One timestamp
  // for both computations so the drawer figure and the snapshot cannot disagree.
  const until = new Date();
  const [expected, summary] = await Promise.all([expectedCashForShift(db, shift, until), shiftHandoverSummary(db, shift, until)]);
  // Leaving with unsettled orders is allowed (the next attendee serves them),
  // but never silently: the outgoing attendee must say what is outstanding.
  if (summary.unpaid.count > 0 && !parsed.data.closeNote) {
    return res.status(400).json({ error: `${summary.unpaid.count} order${summary.unpaid.count === 1 ? " is" : "s are"} not settled. Note what is outstanding before closing.` });
  }
  const closed = await db.nrmsCashierShift.update({
    where: { id: shift.id },
    data: { status: "CLOSED", expectedCash: expected, closeNote: parsed.data.closeNote || null, closeSummary: summary, approvedById: req.user!.id, closedAt: until },
  });
  res.json({ shift: { id: closed.id, expectedCash: expected, availableForHandover: true } });
}) as RequestHandler);

// Standalone shift state for the "Shift & cash" workspace: the same open shift,
// live drawer figure and pending takeover the performance page shows, without the
// sales analytics payload.
router.get("/property/:propertyId/shift", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const propertyId = access.property.id;
  const shift = await db.nrmsCashierShift.findFirst({
    where: { propertyId, userId: req.user!.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true, userId: true, propertyId: true, openedAt: true, openingFloat: true, currency: true, handoverFrom: { select: { user: { select: { fullName: true, name: true, email: true } } } } },
  });
  const liveExpected = shift ? await expectedCashForShift(db, shift) : 0;
  const [pendingHandover, history] = await Promise.all([
    !shift && SHIFT_ROLES.has(access.role)
      ? db.nrmsCashierShift.findFirst({
          where: { propertyId, status: "CLOSED", handoverTo: null, closedAt: { gte: new Date(Date.now() - 12 * 3600 * 1000) } },
          orderBy: { closedAt: "desc" },
          select: { id: true, expectedCash: true, closedAt: true, currency: true, user: { select: { fullName: true, name: true, email: true } } },
        })
      : null,
    // The attendee's own recent closed shifts, with who they took the drawer
    // from and who confirmed receiving it, so the page doubles as their record.
    db.nrmsCashierShift.findMany({
      where: { propertyId, userId: req.user!.id, status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 10,
      select: {
        id: true, openedAt: true, closedAt: true, expectedCash: true, currency: true, closeNote: true,
        handoverFrom: { select: { user: { select: { fullName: true, name: true, email: true } } } },
        handoverTo: { select: { user: { select: { fullName: true, name: true, email: true } } } },
      },
    }),
  ]);
  res.json({
    currency: access.property.currency,
    canManageShift: SHIFT_ROLES.has(access.role),
    shift: shift
      ? { id: shift.id, openedAt: shift.openedAt, openingFloat: Number(shift.openingFloat), expectedCash: liveExpected, currency: shift.currency, takenOverFrom: shift.handoverFrom ? attendeeName(shift.handoverFrom.user) : null }
      : null,
    handover: pendingHandover
      ? { shiftId: pendingHandover.id, attendeeName: attendeeName(pendingHandover.user), amount: Number(pendingHandover.expectedCash), closedAt: pendingHandover.closedAt, currency: pendingHandover.currency }
      : null,
    history: history.map((row: any) => ({
      id: row.id, openedAt: row.openedAt, closedAt: row.closedAt, expectedCash: Number(row.expectedCash), currency: row.currency, closeNote: row.closeNote,
      takenOverFrom: row.handoverFrom ? attendeeName(row.handoverFrom.user) : null,
      handedTo: row.handoverTo ? attendeeName(row.handoverTo.user) : null,
    })),
  });
}) as RequestHandler);

router.get("/property/:propertyId/outlets", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const outlets = await db.nrmsOutlet.findMany({
    where: { propertyId: access.property.id, ...(access.outletId != null ? { id: access.outletId } : {}) },
    include: { menuItems: { orderBy: [{ status: "asc" }, { category: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }, _count: { select: { orders: true, memberships: true } } },
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
  const outletQuota = await checkNrmsQuota(db, access.property.id, "outlets");
  if (!outletQuota.allowed) return res.status(409).json({ error: "NRMS outlet quota reached", quota: outletQuota });
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
  const category = parsed.data.category?.trim();
  if (!category) return res.status(400).json({ error: "Choose a menu category" });
  if (!menuCategoryAllowed(resolved.outlet.type, category)) {
    return res.status(400).json({ error: `Choose a category available for this ${resolved.outlet.type === "BAR" ? "bar" : resolved.outlet.type === "RESTAURANT" ? "restaurant" : "outlet"}` });
  }
  const menuQuota = await checkNrmsQuota(db, resolved.outlet.propertyId, "menuItems");
  if (!menuQuota.allowed) return res.status(409).json({ error: "NRMS menu item quota reached", quota: menuQuota });
  const item = await db.nrmsMenuItem.create({
    data: {
      outletId: resolved.outlet.id,
      name: sanitizeText(parsed.data.name),
      category: sanitizeText(category),
      sku: parsed.data.sku ? sanitizeText(parsed.data.sku).toUpperCase() : null,
      price: parsed.data.price,
      description: parsed.data.description ? sanitizeText(parsed.data.description) : null,
      imageUrl: parsed.data.imageUrl ?? null,
      inStock: parsed.data.inStock ?? true,
    },
  });
  res.status(201).json({ item });
}) as RequestHandler);

/**
 * PATCH /menu-items/:menuItemId
 * Edit guest-facing menu content, price, daily stock state, or retire the
 * item (status INACTIVE keeps history; retired items leave every menu).
 */
router.patch("/menu-items/:menuItemId", (async (req: AuthedRequest, res: Response) => {
  const menuItemId = Number(req.params.menuItemId);
  if (!Number.isInteger(menuItemId) || menuItemId <= 0) return res.status(400).json({ error: "Invalid menu item id" });
  const item = await db.nrmsMenuItem.findUnique({ where: { id: menuItemId }, select: { id: true, outletId: true, inStock: true, stockQuantity: true } });
  if (!item) return res.status(404).json({ error: "Menu item not found" });
  const resolved = await accessForOutlet(req, res, item.outletId);
  if (!resolved) return;
  if (!roleCanManage(resolved.access) && resolved.access.role !== "OUTLET_SUPERVISOR") {
    return res.status(403).json({ error: "Only a manager or outlet supervisor can manage the menu" });
  }
  const parsed = menuItemUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid menu item update", details: parsed.error.flatten() });
  const input = parsed.data;
  if (input.category !== undefined) {
    const category = input.category?.trim();
    if (!category) return res.status(400).json({ error: "Choose a menu category" });
    if (!menuCategoryAllowed(resolved.outlet.type, category)) {
      return res.status(400).json({ error: `Choose a category available for this ${resolved.outlet.type === "BAR" ? "bar" : resolved.outlet.type === "RESTAURANT" ? "restaurant" : "outlet"}` });
    }
  }
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = sanitizeText(input.name);
  if (input.category !== undefined) data.category = sanitizeText(input.category!);
  if (input.sku !== undefined) data.sku = input.sku ? sanitizeText(input.sku).toUpperCase() : null;
  if (input.price !== undefined) data.price = input.price;
  if (input.description !== undefined) data.description = input.description ? sanitizeText(input.description) : null;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl ?? null;
  if (input.inStock !== undefined || input.stockQuantity !== undefined) {
    // Same availability/quantity contract as the stock endpoint, so the menu
    // editor cannot put an item "in stock" that the count says is at zero.
    const derived = deriveStockPatch(item, { inStock: input.inStock, stockQuantity: input.stockQuantity });
    if (derived.error) return res.status(409).json({ error: derived.error });
    Object.assign(data, derived.data);
  }
  if (input.lowStockThreshold !== undefined) data.lowStockThreshold = input.lowStockThreshold;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.status !== undefined) data.status = input.status;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });
  const updated = await db.nrmsMenuItem.update({ where: { id: item.id }, data });
  res.json({ item: updated });
}) as RequestHandler);

// Roles that serve at an outlet and may flip an item's availability. Editing the
// menu itself (price, name, retiring) stays with managers via PATCH /menu-items.
const STOCK_ROLES = new Set(["OWNER", "MANAGER", "OUTLET_SUPERVISOR", "RESTAURANT", "BAR"]);

/** GET /property/:propertyId/stock - live availability board scoped to the caller's outlets. */
router.get("/property/:propertyId/stock", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const outlets = await db.nrmsOutlet.findMany({
    where: { propertyId: access.property.id, status: "ACTIVE", ...(access.outletId != null ? { id: access.outletId } : {}) },
    select: { id: true, name: true, type: true, menuItems: { where: { status: "ACTIVE" }, select: { id: true, name: true, category: true, price: true, inStock: true, stockQuantity: true, lowStockThreshold: true }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }] } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  // Only outlets the caller is allowed to serve, so bar staff never see the
  // kitchen's list (and vice versa) even when unscoped to a single outletId.
  const visible = outlets.filter((outlet: any) => outletAllowed(access, outlet)).map((outlet: any) => ({
    id: outlet.id, name: outlet.name, type: outlet.type,
    items: outlet.menuItems.map((item: any) => ({ id: item.id, name: item.name, category: item.category, price: number(item.price), inStock: item.inStock, stockQuantity: item.stockQuantity, lowStockThreshold: item.lowStockThreshold })),
    outCount: outlet.menuItems.filter((item: any) => !item.inStock).length,
    lowCount: outlet.menuItems.filter((item: any) => item.inStock && item.stockQuantity != null && item.stockQuantity <= item.lowStockThreshold).length,
  }));
  res.json({ canManageStock: STOCK_ROLES.has(access.role), outlets: visible });
}) as RequestHandler);

/**
 * PATCH /menu-items/:menuItemId/stock - availability and counted quantity.
 * A narrow capability the serving roles hold for their own outlet: never price
 * or content, so a bar attendant can 86 a drink or record received stock
 * mid-service. Quantity rules live in deriveStockPatch: a count decides
 * availability outright and a tracked item at zero cannot be toggled back on.
 */
router.patch("/menu-items/:menuItemId/stock", (async (req: AuthedRequest, res: Response) => {
  const menuItemId = Number(req.params.menuItemId);
  if (!Number.isInteger(menuItemId) || menuItemId <= 0) return res.status(400).json({ error: "Invalid menu item id" });
  const item = await db.nrmsMenuItem.findUnique({ where: { id: menuItemId }, select: { id: true, outletId: true, inStock: true, stockQuantity: true } });
  if (!item) return res.status(404).json({ error: "Menu item not found" });
  const resolved = await accessForOutlet(req, res, item.outletId);
  if (!resolved) return;
  if (!STOCK_ROLES.has(resolved.access.role)) return res.status(403).json({ error: "Your role cannot change stock" });
  const parsed = z.object({
    inStock: z.boolean().optional(),
    stockQuantity: z.number().int().min(0).max(1_000_000).nullable().optional(),
    lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid stock update" });
  if (parsed.data.inStock === undefined && parsed.data.stockQuantity === undefined && parsed.data.lowStockThreshold === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  const derived = deriveStockPatch(item, parsed.data);
  if (derived.error) return res.status(409).json({ error: derived.error });
  const updated = await db.nrmsMenuItem.update({
    where: { id: item.id },
    data: { ...derived.data, ...(parsed.data.lowStockThreshold !== undefined ? { lowStockThreshold: parsed.data.lowStockThreshold } : {}) },
    select: { id: true, inStock: true, stockQuantity: true, lowStockThreshold: true },
  });
  res.json({ item: updated });
}) as RequestHandler);

/** PATCH /outlets/:outletId/category-order - browse order for menu categories */
router.patch("/outlets/:outletId/category-order", (async (req: AuthedRequest, res: Response) => {
  const resolved = await accessForOutlet(req, res, Number(req.params.outletId));
  if (!resolved) return;
  if (!roleCanManage(resolved.access) && resolved.access.role !== "OUTLET_SUPERVISOR") {
    return res.status(403).json({ error: "Only a manager or outlet supervisor can manage the menu" });
  }
  const parsed = categoryOrderSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid category order", details: parsed.error.flatten() });
  const categoryOrder = [...new Set(parsed.data.categoryOrder.map((name) => sanitizeText(name)))];
  const outlet = await db.nrmsOutlet.update({ where: { id: resolved.outlet.id }, data: { categoryOrder } });
  res.json({ outlet: { id: outlet.id, categoryOrder: outlet.categoryOrder } });
}) as RequestHandler);

/** PATCH /outlets/:outletId/qr-settings - guest QR ordering behaviour */
router.patch("/outlets/:outletId/qr-settings", (async (req: AuthedRequest, res: Response) => {
  const resolved = await accessForOutlet(req, res, Number(req.params.outletId));
  if (!resolved) return;
  if (!roleCanManage(resolved.access)) {
    return res.status(403).json({ error: "Only an owner or manager can change QR order settings" });
  }
  const parsed = z.object({ autoAcceptQrOrders: z.boolean() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid QR settings" });
  const outlet = await db.nrmsOutlet.update({ where: { id: resolved.outlet.id }, data: { autoAcceptQrOrders: parsed.data.autoAcceptQrOrders } });
  res.json({ outlet: { id: outlet.id, autoAcceptQrOrders: outlet.autoAcceptQrOrders } });
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
  const membershipKey = { propertyId: access.property.id, userId: user.id };
  const existing = await db.nrmsStaffMembership.findUnique({ where: { propertyId_userId: membershipKey } });

  if (!existing || existing.status === "DISABLED") {
    const staffQuota = await checkNrmsQuota(db, access.property.id, "staff");
    if (!staffQuota.allowed) return res.status(409).json({ error: "NRMS staff quota reached", quota: staffQuota });
  }

  // A user has one authoritative assignment per property. Re-sending a pending
  // invite, re-enabling a disabled assignment, or changing an active role/scope
  // rotates the invitation version and requires fresh confirmation. Repeating
  // an unchanged ACTIVE assignment is idempotent.
  let membership;
  let needsConfirmation = false;
  const requestedOutletId = parsed.data.outletId ?? null;
  needsConfirmation = nrmsAssignmentNeedsConfirmation(existing, parsed.data.role, requestedOutletId);
  if (!needsConfirmation && existing) {
    membership = existing;
  } else if (existing) {
    membership = await db.nrmsStaffMembership.update({
      where: { id: existing.id },
      data: {
        role: parsed.data.role,
        outletId: requestedOutletId,
        status: "PENDING",
        confirmedAt: null,
        inviteVersion: { increment: 1 },
      },
    });
  } else {
    membership = await db.nrmsStaffMembership.create({
      data: {
        ...membershipKey,
        role: parsed.data.role,
        outletId: requestedOutletId,
        status: "PENDING",
        inviteVersion: 1,
      },
    });
  }

  let emailSent = false;
  if (needsConfirmation && user.email) {
    try {
      const [assignedBy, outlet] = await Promise.all([
        db.user.findUnique({ where: { id: req.user!.id }, select: { fullName: true, name: true } }),
        membership.outletId ? db.nrmsOutlet.findUnique({ where: { id: membership.outletId }, select: { name: true } }) : Promise.resolve(null),
      ]);
      const token = signNrmsStaffInviteToken(membership.id, user.id, membership.inviteVersion);
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
  // Re-assigning the same email later re-invites through PENDING with a new
  // invitation version, so every older link stays invalid.
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
  const updated = await db.nrmsStaffMembership.update({
    where: { id: membership.id },
    data: { status: "DISABLED", inviteVersion: { increment: 1 } },
  });
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
  if (membership.inviteVersion !== payload.inviteVersion) {
    return res.status(409).json({ error: "This invitation has been replaced by a newer one. Open the latest assignment email.", code: "NRMS_INVITE_SUPERSEDED" });
  }

  let alreadyActive = membership.status === "ACTIVE";
  let confirmed = membership;
  if (!alreadyActive) {
    // Conditional activation makes revocation and invite rotation win any race:
    // the row must still be the same PENDING invitation at update time.
    const activated = await db.nrmsStaffMembership.updateMany({
      where: {
        id: membership.id,
        userId: req.user!.id,
        status: "PENDING",
        inviteVersion: payload.inviteVersion,
      },
      data: { status: "ACTIVE", confirmedAt: new Date() },
    });
    confirmed = await db.nrmsStaffMembership.findUnique({
      where: { id: membership.id },
      include: {
        property: { select: { id: true, title: true } },
        outlet: { select: { id: true, name: true, type: true } },
      },
    });
    if (!confirmed || confirmed.userId !== req.user!.id || confirmed.inviteVersion !== payload.inviteVersion) {
      return res.status(409).json({ error: "This invitation changed while it was being confirmed. Open the latest assignment email.", code: "NRMS_INVITE_SUPERSEDED" });
    }
    if (activated.count !== 1 && confirmed.status !== "ACTIVE") {
      return res.status(409).json({ error: "This assignment is no longer awaiting confirmation.", code: "NRMS_INVITE_NOT_PENDING" });
    }
    alreadyActive = activated.count !== 1;
  }

  res.json({
    alreadyActive,
    membership: {
      id: confirmed.id,
      role: confirmed.role,
      status: confirmed.status,
      confirmedAt: confirmed.confirmedAt,
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
  const liveStatuses = ["PLACED", "CONFIRMED", "PREPARING", "SERVING"];
  const historyStatuses = ["POSTED_TO_FOLIO", "SETTLED", "CANCELLED", "VOIDED"];
  const requestedStatus = String(req.query.status ?? "");
  const allowedStatuses = view === "live" ? liveStatuses : historyStatuses;
  const status = requestedStatus && allowedStatuses.includes(requestedStatus)
    ? requestedStatus
    : view === "all" ? null : { in: allowedStatuses };
  const limit = Math.min(Math.max(Number(req.query.limit) || (view === "history" ? 12 : 150), 1), 150);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  // A page asks for only its world so room and table boards never overlap.
  const scope = req.query.scope === "room" ? ROOM_ORDER_FILTER : req.query.scope === "table" ? TABLE_ORDER_FILTER : {};
  const where: any = {
    propertyId: access.property.id,
    ...(outletId ? { outletId } : {}),
    ...(status ? { status } : {}),
    ...(access.role === "RESTAURANT" && !outletId ? { outlet: { type: "RESTAURANT" } } : {}),
    ...(access.role === "BAR" && !outletId ? { outlet: { type: "BAR" } } : {}),
    ...scope,
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

// Cheap counts for the sidebar badge: how many orders are still open, and how
// many are brand-new guest orders (PLACED) awaiting accept. Scoped to the
// caller's outlet the same way the orders list is.
router.get("/property/:propertyId/orders/live-count", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const outletTypeScope = access.outletId == null && access.role === "BAR" ? { outlet: { type: "BAR" } }
    : access.outletId == null && access.role === "RESTAURANT" ? { outlet: { type: "RESTAURANT" } }
    : {};
  const base = { propertyId: access.property.id, ...(access.outletId ? { outletId: access.outletId } : {}), ...outletTypeScope };
  // Split so each nav item shows its own arrivals: room orders badge the Live
  // order queue ("Bar orders"), table orders badge "Tables & tabs".
  const [openRoom, openTable, placedRoom, placedTable] = await Promise.all([
    db.nrmsOutletOrder.count({ where: { ...base, status: { in: LIVE_ORDER_STATUSES }, ...ROOM_ORDER_FILTER } }),
    db.nrmsOutletOrder.count({ where: { ...base, status: { in: LIVE_ORDER_STATUSES }, ...TABLE_ORDER_FILTER } }),
    db.nrmsOutletOrder.count({ where: { ...base, status: "PLACED", ...ROOM_ORDER_FILTER } }),
    db.nrmsOutletOrder.count({ where: { ...base, status: "PLACED", ...TABLE_ORDER_FILTER } }),
  ]);
  res.json({ openRoom, openTable, placedRoom, placedTable });
}) as RequestHandler);

router.post("/property/:propertyId/orders", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order", details: parsed.error.flatten() });
  const outlet = await db.nrmsOutlet.findFirst({ where: { id: parsed.data.outletId, propertyId: access.property.id, status: "ACTIVE" } });
  if (!outlet || !outletAllowed(access, outlet)) return res.status(403).json({ error: "Outlet is unavailable for this account" });
  if (access.role === "FRONT_DESK") return res.status(403).json({ error: "Front desk can review outlet orders but cannot create them" });
  let reservation: any = null;
  if (parsed.data.reservationId != null) {
    reservation = await db.reservation.findFirst({ where: { id: parsed.data.reservationId, propertyId: access.property.id, status: "CHECKED_IN" } });
    if (!reservation) return res.status(409).json({ error: "Select an actively checked-in guest before confirming the order", code: "GUEST_NOT_IN_HOUSE" });
  }
  let orderPoint: any = null;
  if (parsed.data.orderPointId != null) {
    orderPoint = await db.nrmsOrderPoint.findFirst({ where: { id: parsed.data.orderPointId, propertyId: access.property.id, type: "TABLE", active: true } });
    if (!orderPoint) return res.status(409).json({ error: "Select an active table before confirming the order" });
  }
  // Walk-in sales can never post to a room folio; they settle at the outlet.
  const settlementMode = reservation ? parsed.data.settlementMode : "OUTLET_PAYMENT";
  const customerLabel = reservation ? null : sanitizeText(parsed.data.customerLabel || orderPoint?.label || "Walk-in");

  const requested = new Map<number, number>();
  for (const item of parsed.data.items) requested.set(item.menuItemId, (requested.get(item.menuItemId) ?? 0) + item.quantity);
  const menuItems = await db.nrmsMenuItem.findMany({ where: { id: { in: [...requested.keys()] }, outletId: outlet.id, status: "ACTIVE", inStock: true } });
  if (menuItems.length !== requested.size) return res.status(400).json({ error: "One or more selected items are unavailable or out of stock" });
  const lines = menuItems.map((item: any) => {
    const quantity = requested.get(item.id)!;
    const unitPrice = number(item.price);
    return { menuItemId: item.id, nameSnapshot: item.name, quantity, unitPrice, lineTotal: Number((unitPrice * quantity).toFixed(2)) };
  });
  const total = Number(lines.reduce((sum: number, line: any) => sum + line.lineTotal, 0).toFixed(2));
  const prefix = outlet.type === "RESTAURANT" ? "RST" : outlet.type === "BAR" ? "BAR" : "SVC";
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const orderNumber = `${prefix}-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  try {
    // Tracked stock is reserved in the same transaction that creates the order,
    // so a failed reservation leaves no order and no quantity change.
    const order = await db.$transaction(async (tx: any) => {
      await reserveMenuStock(tx, menuItems, requested);
      return tx.nrmsOutletOrder.create({
        data: {
          propertyId: access.property.id,
          outletId: outlet.id,
          reservationId: reservation?.id ?? null,
          orderPointId: orderPoint?.id ?? null,
          customerLabel,
          orderNumber,
          status: "CONFIRMED",
          settlementMode,
          currency: reservation?.currency ?? outlet.currency,
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
    }, ORDER_TX_OPTIONS);
    res.status(201).json({ order: formatOrder(order) });
  } catch (error) {
    if (error instanceof StockError) return res.status(409).json({ error: `"${error.itemName}" does not have enough stock left for this order.` });
    console.error("[nrms.operations] order create failed", error);
    res.status(500).json({ error: "Unable to create the order" });
  }
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
    }, ORDER_TX_OPTIONS);
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
    if (code === NRMS_BUSINESS_DAY_LOCKED) return res.status(409).json({ error: "This business date is closing or closed. The order cannot be settled or posted now.", code });
    console.error("Failed to advance NRMS outlet order", error);
    return res.status(500).json({ error: "Unable to advance the order" });
  }
  const order = await db.nrmsOutletOrder.findUnique({ where: { id: orderId }, include: orderInclude });
  res.json({ order: formatOrder(order) });
}) as RequestHandler);

router.post("/orders/:orderId/tip", (async (req: AuthedRequest, res: Response) => {
  const parsed = tipRecordSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the received amount and tip details", details: parsed.error.flatten() });
  const orderId = Number(req.params.orderId);
  const seed = await db.nrmsOutletOrder.findUnique({ where: { id: orderId }, include: { outlet: true } });
  if (!seed) return res.status(404).json({ error: "Order not found" });
  const access = await loadAccess(req, res, seed.propertyId);
  if (!access) return;
  if (!outletAllowed(access, seed.outlet) || access.role === "FRONT_DESK") return res.status(403).json({ error: "You cannot record a tip for this order" });
  if (!["SETTLED", "POSTED_TO_FOLIO"].includes(seed.status) || !seed.servedAt) return res.status(409).json({ error: "Tips can only be confirmed after service is completed" });

  const orderTotal = number(seed.total);
  const tipAmount = parsed.data.tipAmount;
  let amountReceived: number | null = null;
  if (seed.settlementMode === "OUTLET_PAYMENT") {
    amountReceived = parsed.data.paymentAmountReceived ?? null;
    if (amountReceived == null || amountReceived < orderTotal) return res.status(400).json({ error: `Amount received must cover the ${seed.currency} ${orderTotal.toLocaleString()} bill.` });
    const overpayment = Number((amountReceived - orderTotal).toFixed(2));
    if (tipAmount > overpayment) return res.status(400).json({ error: "Confirmed tip cannot be greater than the amount received above the bill." });
  }
  // A room-folio order needs no tip. Zero is a valid, complete answer; it records
  // no tip (or clears any prior one) rather than blocking the attendant.

  if (tipAmount > 0 && (!parsed.data.tipRecipientId || !parsed.data.tipMethod)) {
    return res.status(400).json({ error: "Select the serving team member and how the tip was received." });
  }

  if (tipAmount > 0) {
    const recipientId = parsed.data.tipRecipientId!;
    const propertyOwner = recipientId === access.property.ownerId;
    const membership = propertyOwner ? null : await db.nrmsStaffMembership.findFirst({
      where: {
        propertyId: seed.propertyId,
        userId: recipientId,
        status: "ACTIVE",
        role: { in: ["MANAGER", "RESTAURANT", "BAR", "OUTLET_SUPERVISOR"] },
        OR: [{ outletId: seed.outletId }, { outletId: null }],
      },
      select: { userId: true },
    });
    if (!propertyOwner && !membership) return res.status(400).json({ error: "Select an active team member assigned to this outlet." });
    if (!roleCanCorrect(access) && recipientId !== req.user!.id) return res.status(403).json({ error: "Only a manager or outlet supervisor can assign a tip to another team member." });
  }

  try {
    const updated = await db.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, seed.propertyId);
      await assertNrmsBusinessDayWritable(tx, seed.propertyId);
      return tx.nrmsOutletOrder.update({
        where: { id: orderId },
        data: {
          paymentAmountReceived: amountReceived,
          tipAmount: tipAmount > 0 ? tipAmount : null,
          tipRecipientId: tipAmount > 0 ? parsed.data.tipRecipientId : null,
          tipMethod: tipAmount > 0 ? parsed.data.tipMethod : null,
          tipConfirmedById: tipAmount > 0 ? req.user!.id : null,
          tipConfirmedAt: tipAmount > 0 ? new Date() : null,
        },
        include: orderInclude,
      });
    }, ORDER_TX_OPTIONS);
    res.json({ order: formatOrder(updated) });
  } catch (error) {
    if (error instanceof Error && error.message === NRMS_BUSINESS_DAY_LOCKED) return res.status(409).json({ error: "This business date is closing or closed. The tip cannot be changed now.", code: NRMS_BUSINESS_DAY_LOCKED });
    throw error;
  }
}) as RequestHandler);

router.post("/orders/:orderId/cancel", (async (req: AuthedRequest, res: Response) => {
  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A cancellation reason is required" });
  const order = await db.nrmsOutletOrder.findUnique({ where: { id: Number(req.params.orderId) }, include: { outlet: true, items: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  const access = await loadAccess(req, res, order.propertyId);
  if (!access) return;
  if (!outletAllowed(access, order.outlet)) return res.status(403).json({ error: "You cannot cancel this order" });
  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsOutletOrder.updateMany({
        where: { id: order.id, status: { in: ["PLACED", "CONFIRMED", "PREPARING", "SERVING"] } },
        data: { status: "CANCELLED", cancelledAt: new Date(), voidReason: sanitizeText(parsed.data.reason) },
      });
      if (changed.count !== 1) throw new Error("NRMS_ORDER_NOT_CANCELLABLE");
      // The goods were never served: a cancelled order gives its quantities back.
      // (Voids stay as-is: a voided posted order was consumed, only the money moves.)
      await restoreMenuStock(tx, order.items);
    }, ORDER_TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_ORDER_NOT_CANCELLABLE") {
      return res.status(409).json({ error: "Only placed, confirmed or preparing orders can be cancelled" });
    }
    console.error("[nrms.operations] order cancel failed", error);
    return res.status(500).json({ error: "Unable to cancel the order" });
  }
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
  try {
    await db.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, seed.propertyId);
      await assertNrmsBusinessDayWritable(tx, seed.propertyId);
      const order = await tx.nrmsOutletOrder.findUnique({ where: { id: seed.id } });
      if (!order) throw new Error("NRMS_ORDER_NOT_VOIDABLE");
      const now = new Date();
      if (order.status === "POSTED_TO_FOLIO" && order.folioChargeId) {
        await tx.reservationCharge.update({ where: { id: order.folioChargeId }, data: { voidedAt: now, voidReason: sanitizeText(parsed.data.reason) } });
        await voidRoutedCharge(tx, order.folioChargeId, sanitizeText(parsed.data.reason));
        const aggregate = await tx.reservationCharge.aggregate({ where: { reservationId: order.reservationId, voidedAt: null }, _sum: { amount: true } });
        await tx.reservation.update({ where: { id: order.reservationId }, data: { chargesTotal: aggregate._sum.amount ?? 0 } });
        await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "VOIDED", voidedAt: now, voidReason: sanitizeText(parsed.data.reason) } });
        await tx.reservationEvent.create({ data: { reservationId: order.reservationId, type: "CHARGE_VOIDED", actorId: req.user!.id, data: { chargeId: order.folioChargeId, orderId: order.id, reason: sanitizeText(parsed.data.reason) } } });
      } else if (order.status === "SETTLED" && order.settlementMode === "OUTLET_PAYMENT") {
        // No folio charge involved: the sale was paid directly at the outlet. Voiding
        // only flips status/voidedAt here; the reversing ledger entry is generated by
        // buildPostings() off these same fields the next time a business date closes.
        await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "VOIDED", voidedAt: now, voidReason: sanitizeText(parsed.data.reason) } });
      } else {
        throw new Error("NRMS_ORDER_NOT_VOIDABLE");
      }
    }, ORDER_TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === NRMS_BUSINESS_DAY_LOCKED) return res.status(409).json({ error: "This business date is closing or closed. Post a controlled correction on an open date.", code: NRMS_BUSINESS_DAY_LOCKED });
    if (error instanceof Error && error.message === "NRMS_ORDER_NOT_VOIDABLE") {
      return res.status(409).json({ error: "Only a posted folio charge or a settled outlet-paid sale can be voided" });
    }
    throw error;
  }
  res.json({ ok: true });
}) as RequestHandler);

// ---------------------------------------------------------------------------
// Housekeeping: room cleanliness board and task workflow. Live state sits on
// RoomUnit.housekeepingStatus; NrmsHousekeepingTask rows are the audit trail.

const NRMS_TZ_OFFSET = "+03:00"; // Africa/Dar_es_Salaam, no DST

function nrmsToday(): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const start = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00${NRMS_TZ_OFFSET}`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

const hkStatusSchema = z.object({ status: z.enum(HOUSEKEEPING_STATUSES) });
const hkTaskSchema = z.object({
  roomUnitId: z.number().int().positive(),
  type: z.enum(HOUSEKEEPING_TASK_TYPES),
  priority: z.enum(HOUSEKEEPING_TASK_PRIORITIES).default("NORMAL"),
  note: z.string().trim().max(500).optional().nullable(),
  assignedToId: z.number().int().positive().optional().nullable(),
});
const hkAdvanceSchema = z.object({ action: z.enum(["START", "COMPLETE", "CANCEL"]) });
const hkAssignSchema = z.object({ assignedToId: z.number().int().positive().nullable() });
const hkSettingsSchema = z.object({
  dailyServiceEnabled: z.boolean(),
  dailyServiceTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 11:00"),
});

function formatHkTask(task: any) {
  return {
    id: task.id,
    roomUnitId: task.roomUnitId,
    roomCode: task.roomUnit?.code,
    roomTypeName: task.roomUnit?.roomType?.name,
    reservationId: task.reservationId,
    type: task.type,
    status: task.status,
    priority: task.priority,
    note: task.note,
    assignedTo: task.assignedTo ? { id: task.assignedTo.id, name: task.assignedTo.fullName || task.assignedTo.name || task.assignedTo.email } : null,
    completedBy: task.completedBy ? { id: task.completedBy.id, name: task.completedBy.fullName || task.completedBy.name || task.completedBy.email } : null,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
  };
}

const hkTaskInclude = {
  roomUnit: { select: { code: true, roomType: { select: { name: true } } } },
  assignedTo: { select: { id: true, fullName: true, name: true, email: true } },
  completedBy: { select: { id: true, fullName: true, name: true, email: true } },
};

/** Confirms the assignee actually works housekeeping at this property. */
async function validHousekeepingAssignee(propertyId: number, ownerId: number, userId: number): Promise<boolean> {
  if (userId === ownerId) return true;
  const membership = await db.nrmsStaffMembership.findFirst({
    where: { propertyId, userId, status: "ACTIVE", role: { in: ["HOUSEKEEPER", "MANAGER", "FRONT_DESK"] } },
    select: { id: true },
  });
  return Boolean(membership);
}

router.get("/property/:propertyId/housekeeping", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanHousekeep(access.role)) return res.status(403).json({ error: "Your role has no access to housekeeping", code: "NRMS_HOUSEKEEPING_FORBIDDEN" });
  await ensureDailyOccupiedCleaning(db, access.property.id);
  const today = nrmsToday();
  const [units, occupied, arrivals, doneToday, housekeepers] = await Promise.all([
    db.roomUnit.findMany({
      where: { propertyId: access.property.id },
      include: {
        roomType: { select: { id: true, name: true } },
        housekeepingTasks: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, include: hkTaskInclude, orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ floor: "asc" }, { code: "asc" }],
    }),
    db.reservationRoomAllocation.findMany({
      where: { status: "ACTIVE", roomUnitId: { not: null }, reservation: { propertyId: access.property.id, status: "CHECKED_IN" } },
      select: { roomUnitId: true, reservation: { select: { id: true, checkIn: true, checkOut: true, guestProfile: { select: { fullName: true } } } } },
    }),
    db.reservationRoomAllocation.findMany({
      where: {
        status: "ACTIVE",
        roomUnitId: { not: null },
        reservation: { propertyId: access.property.id, status: "CONFIRMED", checkIn: { gte: today.start, lt: today.end } },
      },
      select: { roomUnitId: true, reservation: { select: { id: true, guestProfile: { select: { fullName: true } } } } },
    }),
    db.nrmsHousekeepingTask.findMany({
      where: { propertyId: access.property.id, status: "DONE", completedAt: { gte: today.start } },
      include: hkTaskInclude,
      orderBy: { completedAt: "desc" },
      take: 20,
    }),
    db.nrmsStaffMembership.findMany({
      where: { propertyId: access.property.id, status: "ACTIVE", role: "HOUSEKEEPER" },
      include: { user: { select: { id: true, fullName: true, name: true, email: true } } },
      orderBy: { id: "asc" },
    }),
  ]);
  const occupantByUnit = new Map<number, any>();
  for (const row of occupied) occupantByUnit.set(row.roomUnitId, { reservationId: row.reservation.id, guestName: row.reservation.guestProfile?.fullName ?? "Guest", checkIn: row.reservation.checkIn, checkOut: row.reservation.checkOut });
  const arrivalByUnit = new Map<number, any>();
  for (const row of arrivals) arrivalByUnit.set(row.roomUnitId, { reservationId: row.reservation.id, guestName: row.reservation.guestProfile?.fullName ?? "Guest" });

  const counts: Record<string, number> = { CLEAN: 0, DIRTY: 0, IN_PROGRESS: 0, INSPECTED: 0, OUT_OF_SERVICE: 0, OCCUPIED: occupantByUnit.size, openTasks: 0 };
  const rooms = units.map((unit: any) => {
    const outOfService = unit.status !== "ACTIVE";
    if (outOfService) counts.OUT_OF_SERVICE += 1;
    else counts[unit.housekeepingStatus] = (counts[unit.housekeepingStatus] ?? 0) + 1;
    counts.openTasks += unit.housekeepingTasks.length;
    return {
      id: unit.id,
      code: unit.code,
      floor: unit.floor,
      status: unit.status,
      housekeepingStatus: unit.housekeepingStatus,
      housekeepingUpdatedAt: unit.housekeepingUpdatedAt,
      roomType: unit.roomType,
      occupant: occupantByUnit.get(unit.id) ?? null,
      arrival: arrivalByUnit.get(unit.id) ?? null,
      openTasks: unit.housekeepingTasks.map(formatHkTask),
    };
  });
  const dailyWindow = dailyHousekeepingWindow(new Date(), access.property.housekeepingDailyServiceTime);
  res.json({
    access: { role: access.role },
    counts,
    businessDate: today.start.toISOString(),
    settings: {
      dailyServiceEnabled: access.property.housekeepingDailyServiceEnabled,
      dailyServiceTime: access.property.housekeepingDailyServiceTime,
      timezone: "Africa/Dar_es_Salaam",
      nextDailyServiceAt: dailyWindow.nextServiceAt.toISOString(),
    },
    rooms,
    recentDone: doneToday.map(formatHkTask),
    housekeepers: housekeepers.map((row: any) => ({ id: row.user.id, name: row.user.fullName || row.user.name || row.user.email })),
  });
}) as RequestHandler);

router.put("/property/:propertyId/housekeeping/settings", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManageHousekeeping(access.role)) return res.status(403).json({ error: "Only the front desk or a manager can configure housekeeping" });
  const parsed = hkSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid housekeeping settings", details: parsed.error.flatten() });
  const property = await db.property.update({
    where: { id: access.property.id },
    data: {
      housekeepingDailyServiceEnabled: parsed.data.dailyServiceEnabled,
      housekeepingDailyServiceTime: parsed.data.dailyServiceTime,
    },
    select: { housekeepingDailyServiceEnabled: true, housekeepingDailyServiceTime: true },
  });
  const window = dailyHousekeepingWindow(new Date(), property.housekeepingDailyServiceTime);
  res.json({
    settings: {
      dailyServiceEnabled: property.housekeepingDailyServiceEnabled,
      dailyServiceTime: property.housekeepingDailyServiceTime,
      timezone: "Africa/Dar_es_Salaam",
      nextDailyServiceAt: window.nextServiceAt.toISOString(),
    },
  });
}) as RequestHandler);

router.post("/rooms/:roomUnitId/housekeeping-status", (async (req: AuthedRequest, res: Response) => {
  const roomUnitId = Number(req.params.roomUnitId);
  if (!Number.isInteger(roomUnitId) || roomUnitId <= 0) return res.status(400).json({ error: "Invalid room id" });
  const unit = await db.roomUnit.findUnique({ where: { id: roomUnitId }, select: { id: true, propertyId: true, code: true } });
  if (!unit) return res.status(404).json({ error: "Room not found" });
  const access = await loadAccess(req, res, unit.propertyId);
  if (!access) return;
  if (!roleCanHousekeep(access.role)) return res.status(403).json({ error: "Your role cannot update room cleanliness" });
  const parsed = hkStatusSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid housekeeping status" });
  // Inspection is a supervision step: a housekeeper marks CLEAN, the front
  // desk or a manager confirms INSPECTED.
  if (parsed.data.status === "INSPECTED" && !roleCanManageHousekeeping(access.role)) {
    return res.status(403).json({ error: "Only the front desk or a manager can mark a room inspected", code: "NRMS_HK_INSPECT_FORBIDDEN" });
  }
  await db.$transaction(async (tx: any) => {
    await setRoomHousekeepingStatus(tx, unit.id, parsed.data.status, req.user!.id);
  });
  const updated = await db.roomUnit.findUnique({ where: { id: unit.id }, select: { id: true, code: true, housekeepingStatus: true, housekeepingUpdatedAt: true } });
  res.json({ room: updated });
}) as RequestHandler);

router.post("/property/:propertyId/housekeeping/tasks", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManageHousekeeping(access.role)) return res.status(403).json({ error: "Only the front desk or a manager can create housekeeping tasks" });
  const parsed = hkTaskSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid housekeeping task", details: parsed.error.flatten() });
  const unit = await db.roomUnit.findFirst({ where: { id: parsed.data.roomUnitId, propertyId: access.property.id }, select: { id: true } });
  if (!unit) return res.status(400).json({ error: "Selected room does not belong to this property" });
  if (parsed.data.assignedToId != null) {
    const valid = await validHousekeepingAssignee(access.property.id, access.property.ownerId, parsed.data.assignedToId);
    if (!valid) return res.status(400).json({ error: "The selected assignee is not active housekeeping staff for this property" });
  }
  const task = await db.nrmsHousekeepingTask.create({
    data: {
      propertyId: access.property.id,
      roomUnitId: unit.id,
      type: parsed.data.type,
      priority: parsed.data.priority,
      note: parsed.data.note ? sanitizeText(parsed.data.note) : null,
      assignedToId: parsed.data.assignedToId ?? null,
      createdById: req.user!.id,
    },
    include: hkTaskInclude,
  });
  res.status(201).json({ task: formatHkTask(task) });
}) as RequestHandler);

router.post("/housekeeping/tasks/:taskId/advance", (async (req: AuthedRequest, res: Response) => {
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ error: "Invalid task id" });
  const parsed = hkAdvanceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid task action" });
  const seed = await db.nrmsHousekeepingTask.findUnique({ where: { id: taskId }, select: { id: true, propertyId: true } });
  if (!seed) return res.status(404).json({ error: "Task not found" });
  const access = await loadAccess(req, res, seed.propertyId);
  if (!access) return;
  if (!roleCanHousekeep(access.role)) return res.status(403).json({ error: "Your role cannot work housekeeping tasks" });
  if (parsed.data.action === "CANCEL" && !roleCanManageHousekeeping(access.role)) {
    return res.status(403).json({ error: "Only the front desk or a manager can cancel a task" });
  }
  try {
    await db.$transaction(async (tx: any) => {
      const task = await tx.nrmsHousekeepingTask.findUnique({ where: { id: taskId } });
      if (!task || !taskActionAllowed(task.status, parsed.data.action)) throw new Error("NRMS_HK_INVALID_TRANSITION");
      if (parsed.data.action === "START") {
        await tx.nrmsHousekeepingTask.update({ where: { id: task.id }, data: { status: "IN_PROGRESS", startedAt: new Date(), assignedToId: task.assignedToId ?? req.user!.id } });
        if (isCleaningTaskType(task.type)) {
          await tx.roomUnit.update({ where: { id: task.roomUnitId }, data: { housekeepingStatus: "IN_PROGRESS", housekeepingUpdatedAt: new Date() } });
        }
      } else if (parsed.data.action === "COMPLETE") {
        await tx.nrmsHousekeepingTask.update({ where: { id: task.id }, data: { status: "DONE", completedAt: new Date(), completedById: req.user!.id } });
        // Completing a cleaning task makes the room CLEAN and closes any
        // sibling cleaning tasks for the same room in one sweep.
        if (isCleaningTaskType(task.type)) await setRoomHousekeepingStatus(tx, task.roomUnitId, "CLEAN", req.user!.id);
      } else {
        await tx.nrmsHousekeepingTask.update({ where: { id: task.id }, data: { status: "CANCELLED" } });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_HK_INVALID_TRANSITION") {
      return res.status(409).json({ error: "This task cannot move to that state from its current status" });
    }
    console.error("[NRMS] housekeeping task advance failed", error);
    return res.status(500).json({ error: "Unable to update the task" });
  }
  const task = await db.nrmsHousekeepingTask.findUnique({ where: { id: taskId }, include: hkTaskInclude });
  res.json({ task: formatHkTask(task) });
}) as RequestHandler);

router.post("/housekeeping/tasks/:taskId/assign", (async (req: AuthedRequest, res: Response) => {
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ error: "Invalid task id" });
  const parsed = hkAssignSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid assignee" });
  const task = await db.nrmsHousekeepingTask.findUnique({ where: { id: taskId }, select: { id: true, propertyId: true, status: true } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const access = await loadAccess(req, res, task.propertyId);
  if (!access) return;
  if (!roleCanManageHousekeeping(access.role)) return res.status(403).json({ error: "Only the front desk or a manager can assign tasks" });
  if (!["OPEN", "IN_PROGRESS"].includes(task.status)) return res.status(409).json({ error: "Only open tasks can be reassigned" });
  if (parsed.data.assignedToId != null) {
    const valid = await validHousekeepingAssignee(access.property.id, access.property.ownerId, parsed.data.assignedToId);
    if (!valid) return res.status(400).json({ error: "The selected assignee is not active housekeeping staff for this property" });
  }
  const updated = await db.nrmsHousekeepingTask.update({ where: { id: task.id }, data: { assignedToId: parsed.data.assignedToId }, include: hkTaskInclude });
  res.json({ task: formatHkTask(updated) });
}) as RequestHandler);

// ─── Order points & QR ────────────────────────────────────────

const orderPointSchema = z.object({
  type: z.enum(["ROOM", "TABLE"]),
  label: z.string().trim().min(1).max(60),
  roomUnitId: z.number().int().positive().optional().nullable(),
});

router.get("/property/:propertyId/order-points", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const [points, propertyRow] = await Promise.all([
    // The PREVIEW point (public listing-page menu link) is system-managed
    // from the "publish live menu" toggle, not a physical QR staff print and
    // hand out, so it never appears mixed into this admin list.
    db.nrmsOrderPoint.findMany({
      where: { propertyId: access.property.id, type: { not: "PREVIEW" } },
      include: {
        roomUnit: {
          select: {
            id: true,
            code: true,
            floor: true,
            status: true,
            allocations: {
              where: { status: "ACTIVE", reservation: { status: "CHECKED_IN" } },
              select: {
                reservation: {
                  select: {
                    id: true,
                    checkIn: true,
                    checkOut: true,
                    checkedInAt: true,
                    guestProfile: { select: { fullName: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ type: "asc" }, { label: "asc" }],
    }),
    db.property.findUnique({ where: { id: access.property.id }, select: { nrmsGuestPayInstructions: true } }),
  ]);
  res.json({
    orderPoints: points.map((p: any) => {
      const activeStay = [...(p.roomUnit?.allocations ?? [])]
        .sort((left: any, right: any) => {
          const leftTime = left.reservation.checkedInAt ? new Date(left.reservation.checkedInAt).getTime() : 0;
          const rightTime = right.reservation.checkedInAt ? new Date(right.reservation.checkedInAt).getTime() : 0;
          return rightTime - leftTime;
        })[0]?.reservation ?? null;
      return {
        ...p,
        roomUnit: p.roomUnit
          ? { id: p.roomUnit.id, code: p.roomUnit.code, floor: p.roomUnit.floor, status: p.roomUnit.status }
          : null,
        currentStay: activeStay
          ? {
              reservationId: activeStay.id,
              guestName: activeStay.guestProfile?.fullName ?? null,
              checkIn: activeStay.checkIn,
              checkOut: activeStay.checkOut,
            }
          : null,
        menuUrl: p.active ? buildMenuUrl(p.token) : null,
      };
    }),
    guestPayInstructions: Array.isArray(propertyRow?.nrmsGuestPayInstructions) ? propertyRow.nrmsGuestPayInstructions : [],
  });
}) as RequestHandler);

/**
 * The public "View live menu" link on this property's marketplace listing.
 * Reuses the QR order-point mechanism: enabling creates (or reactivates) one
 * PREVIEW point, orderingEnabled false, that the public property page links
 * to. Disabling deactivates it, so any previously shared link dies with it.
 */
router.get("/property/:propertyId/menu-public", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const point = await db.nrmsOrderPoint.findFirst({ where: { propertyId: access.property.id, type: "PREVIEW" } });
  res.json({
    enabled: Boolean(access.property.nrmsMenuPublic),
    menuUrl: point?.active ? buildMenuUrl(point.token) : null,
  });
}) as RequestHandler);

router.post("/property/:propertyId/menu-public", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or manager can change the public menu" });
  const enabled = Boolean(req.body?.enabled);
  await db.property.update({ where: { id: access.property.id }, data: { nrmsMenuPublic: enabled } });
  let point = await db.nrmsOrderPoint.findFirst({ where: { propertyId: access.property.id, type: "PREVIEW" } });
  if (enabled) {
    // No table/room QR quota is spent here: this point is never printed or
    // handed to a guest, it exists only to be linked from the listing page.
    point = point
      ? await db.nrmsOrderPoint.update({ where: { id: point.id }, data: { active: true } })
      : await db.nrmsOrderPoint.create({
          data: { propertyId: access.property.id, type: "PREVIEW", label: "Menu preview", token: generateOrderPointToken(), orderingEnabled: false },
        });
  } else if (point?.active) {
    point = await db.nrmsOrderPoint.update({ where: { id: point.id }, data: { active: false } });
  }
  res.json({ enabled, menuUrl: enabled && point?.active ? buildMenuUrl(point.token) : null });
}) as RequestHandler);

/**
 * The property's own receiving channels for guest QR payments: Lipa Namba,
 * bank account, card at counter. Shown verbatim on the guest order page so
 * money goes straight to the hotel with no NoLSAF collection or disbursement.
 */
const guestPayInstructionsSchema = z.object({
  instructions: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        value: z.string().trim().min(1).max(80),
        name: z.string().trim().max(60).optional().nullable(),
      }),
    )
    .max(6),
});

router.patch("/property/:propertyId/guest-pay-instructions", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or manager can change payment instructions" });
  const parsed = guestPayInstructionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payment instructions", details: parsed.error.flatten() });
  const instructions = parsed.data.instructions.map((row) => ({
    label: sanitizeText(row.label),
    value: sanitizeText(row.value),
    name: row.name ? sanitizeText(row.name) : null,
  }));
  await db.property.update({ where: { id: access.property.id }, data: { nrmsGuestPayInstructions: instructions } });
  res.json({ guestPayInstructions: instructions });
}) as RequestHandler);

router.post("/property/:propertyId/order-points", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or manager can create order points" });
  const parsed = orderPointSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order point", details: parsed.error.flatten() });
  if (parsed.data.type === "ROOM" && parsed.data.roomUnitId) {
    const unit = await db.roomUnit.findFirst({ where: { id: parsed.data.roomUnitId, propertyId: access.property.id }, select: { id: true } });
    if (!unit) return res.status(400).json({ error: "Room unit does not belong to this property" });
  }
  const existing = await db.nrmsOrderPoint.findUnique({
    where: { propertyId_type_label: { propertyId: access.property.id, type: parsed.data.type, label: parsed.data.label } },
  });
  if (existing) return res.status(409).json({ error: `An order point for ${parsed.data.type} "${parsed.data.label}" already exists` });
  const pointQuota = await checkNrmsQuota(db, access.property.id, "orderPoints");
  if (!pointQuota.allowed) return res.status(409).json({ error: "NRMS order point quota reached", quota: pointQuota });
  const point = await db.nrmsOrderPoint.create({
    data: {
      propertyId: access.property.id,
      type: parsed.data.type,
      label: sanitizeText(parsed.data.label),
      roomUnitId: parsed.data.type === "ROOM" ? (parsed.data.roomUnitId ?? null) : null,
      token: generateOrderPointToken(),
    },
    include: { roomUnit: { select: { id: true, code: true, floor: true, status: true } } },
  });
  res.status(201).json({ orderPoint: { ...point, menuUrl: buildMenuUrl(point.token) } });
}) as RequestHandler);

router.post("/property/:propertyId/order-points/generate-rooms", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or manager can generate order points" });
  const rooms = await db.roomUnit.findMany({
    where: { propertyId: access.property.id, status: "ACTIVE" },
    select: { id: true, code: true },
    orderBy: [{ floor: "asc" }, { code: "asc" }],
  });
  const existing = await db.nrmsOrderPoint.findMany({
    where: { propertyId: access.property.id, type: "ROOM" },
    select: { roomUnitId: true, label: true },
  });
  const existingRoomIds = new Set(existing.map((p: any) => p.roomUnitId).filter(Boolean));
  const existingLabels = new Set(existing.map((p: any) => p.label));
  const toCreate = rooms.filter((r: any) => !existingRoomIds.has(r.id) && !existingLabels.has(r.code));
  if (toCreate.length === 0) return res.json({ created: 0, message: "All active rooms already have order points" });
  const pointQuota = await checkNrmsQuota(db, access.property.id, "orderPoints", toCreate.length);
  if (!pointQuota.allowed) return res.status(409).json({ error: "NRMS order point quota reached", quota: pointQuota });
  await db.nrmsOrderPoint.createMany({
    data: toCreate.map((r: any) => ({
      propertyId: access.property.id,
      type: "ROOM",
      label: r.code,
      roomUnitId: r.id,
      token: generateOrderPointToken(),
    })),
  });
  res.status(201).json({ created: toCreate.length });
}) as RequestHandler);

router.post("/order-points/:orderPointId/rotate", (async (req: AuthedRequest, res: Response) => {
  const pointId = Number(req.params.orderPointId);
  if (!Number.isInteger(pointId) || pointId <= 0) return res.status(400).json({ error: "Invalid order point id" });
  const seed = await db.nrmsOrderPoint.findUnique({ where: { id: pointId }, select: { id: true, propertyId: true } });
  if (!seed) return res.status(404).json({ error: "Order point not found" });
  const access = await loadAccess(req, res, seed.propertyId);
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or manager can rotate tokens" });
  const point = await db.nrmsOrderPoint.update({
    where: { id: pointId },
    data: { token: generateOrderPointToken(), active: true },
    include: { roomUnit: { select: { id: true, code: true, floor: true, status: true } } },
  });
  const now = new Date();
  const metricDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  await db.nrmsPublicMetric.upsert({
    where: { propertyId_metricDate_kind: { propertyId: point.propertyId, metricDate, kind: "QR_ROTATION" } },
    update: { count: { increment: 1 } },
    create: { propertyId: point.propertyId, metricDate, kind: "QR_ROTATION", count: 1 },
  });
  res.json({ orderPoint: { ...point, menuUrl: buildMenuUrl(point.token) } });
}) as RequestHandler);

router.post("/order-points/:orderPointId/deactivate", (async (req: AuthedRequest, res: Response) => {
  const pointId = Number(req.params.orderPointId);
  if (!Number.isInteger(pointId) || pointId <= 0) return res.status(400).json({ error: "Invalid order point id" });
  const seed = await db.nrmsOrderPoint.findUnique({ where: { id: pointId }, select: { id: true, propertyId: true } });
  if (!seed) return res.status(404).json({ error: "Order point not found" });
  const access = await loadAccess(req, res, seed.propertyId);
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or manager can deactivate order points" });
  const point = await db.nrmsOrderPoint.update({
    where: { id: pointId },
    data: { active: false },
    include: { roomUnit: { select: { id: true, code: true, floor: true, status: true } } },
  });
  res.json({ orderPoint: { ...point, menuUrl: null } });
}) as RequestHandler);

router.delete("/order-points/:orderPointId", (async (req: AuthedRequest, res: Response) => {
  const pointId = Number(req.params.orderPointId);
  if (!Number.isInteger(pointId) || pointId <= 0) return res.status(400).json({ error: "Invalid order point id" });
  const seed = await db.nrmsOrderPoint.findUnique({ where: { id: pointId }, select: { id: true, propertyId: true } });
  if (!seed) return res.status(404).json({ error: "Order point not found" });
  const access = await loadAccess(req, res, seed.propertyId);
  if (!access) return;
  if (!roleCanManage(access)) return res.status(403).json({ error: "Only an owner or manager can delete order points" });
  await db.nrmsOrderPoint.delete({ where: { id: pointId } });
  res.json({ deleted: true });
}) as RequestHandler);

router.get("/order-points/:orderPointId/qr.png", (async (req: AuthedRequest, res: Response) => {
  const pointId = Number(req.params.orderPointId);
  if (!Number.isInteger(pointId) || pointId <= 0) return res.status(400).json({ error: "Invalid order point id" });
  const point = await db.nrmsOrderPoint.findUnique({ where: { id: pointId }, select: { id: true, propertyId: true, token: true, active: true } });
  if (!point) return res.status(404).json({ error: "Order point not found" });
  const access = await loadAccess(req, res, point.propertyId);
  if (!access) return;
  if (!point.active) return res.status(410).json({ error: "This order point is deactivated" });
  const png = await makeOrderPointQR(point.token);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.end(png);
}) as RequestHandler);

router.get("/property/:propertyId/order-points/qr-sheet.pdf", (async (req: AuthedRequest, res: Response) => {
  const access = await loadAccess(req, res, Number(req.params.propertyId));
  if (!access) return;
  const typeFilter = typeof req.query.type === "string" && isValidOrderPointType(req.query.type.toUpperCase())
    ? req.query.type.toUpperCase()
    : undefined;
  const points = await db.nrmsOrderPoint.findMany({
    where: { propertyId: access.property.id, active: true, ...(typeFilter ? { type: typeFilter } : {}) },
    select: { label: true, type: true, token: true },
    orderBy: [{ type: "asc" }, { label: "asc" }],
  });
  if (points.length === 0) return res.status(404).json({ error: "No active order points to print" });
  const pdf = await generateQrSheetPdf(access.property.title, points);
  const safeName = access.property.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}_QR_Sheet.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(pdf);
}) as RequestHandler);

export default router;
