/**
 * Long-stay tenancies: refs, loading, messages and views
 * (docs/LONG_STAY_RENTALS.md section 3.3).
 *
 * Rules every route relies on:
 *  - a tenancy is reached only by its random tn_ reference AND the caller's own
 *    side (tenant or landlord); anyone else gets "not found";
 *  - status moves only through tenancyState.ts, compare-and-set on version;
 *  - every move and every message is a TenancyEvent (append-only);
 *  - NoLSAF is the bridge until the booking is paid: tenant and landlord cannot
 *    message each other and see no phone numbers before RESERVED. Questions
 *    before that go to NoLSAF (lib/longStay/enquiry.ts).
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { rowToTerms } from "./listing.js";
import { holdsBookingPayment, isTerminalTenancyStatus, isTenancyStatus, tenancyTransitionUpdate, type TenancyActor, type TenancyStatus } from "./tenancyState.js";

export class TenancyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "TenancyError";
  }
}

export const TENANCY_REF_PATTERN = /^tn_[A-Za-z0-9_-]{22}$/;
export function newTenancyRef(): string {
  return `tn_${randomBytes(16).toString("base64url")}`;
}
export function isTenancyRef(value: unknown): value is string {
  return typeof value === "string" && TENANCY_REF_PATTERN.test(value);
}

/** Open reservations a tenant may hold at once, so one account cannot flood landlords. */
export const MAX_OPEN_REQUESTS_PER_TENANT = 3;
const OPEN_BEFORE_LEASE: TenancyStatus[] = ["OFFERED"];
/** The landlord has this long to confirm a reservation; then it lapses. */
export const CONFIRM_WITHIN_HOURS = 24;

// ---------- Masking ----------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// 9 or more digits, allowing spaces, dots, dashes and a leading +, e.g. +255 712 345 678.
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const LINK = /\b(?:https?:\/\/|www\.|wa\.me\/|t\.me\/)\S+/gi;

/** Hides contact details typed into text that goes through NoLSAF (questions to NoLSAF). */
export function maskContacts(text: string): { text: string; masked: boolean } {
  let masked = false;
  const out = text
    .replace(EMAIL, () => { masked = true; return "[email hidden]"; })
    .replace(LINK, () => { masked = true; return "[link hidden]"; })
    .replace(PHONE, (match) => {
      if (match.replace(/\D/g, "").length < 9) return match;
      masked = true;
      return "[number hidden]";
    });
  return { text: out, masked };
}

/** Contact details are shared once the booking is paid (RESERVED onwards). */
export function contactsShared(status: string): boolean {
  if (!isTenancyStatus(status)) return false;
  return holdsBookingPayment(status) || ["ACTIVE", "ENDING", "ENDED", "OVERDUE"].includes(status);
}

// ---------- Input ----------

export const reserveSchema = z.object({
  property: z.string().trim().min(8).max(200),
  moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  termMonths: z.coerce.number().int().min(1).max(24),
}).strict();

export const messageSchema = z.object({ text: z.string().trim().min(1).max(1000) }).strict();
export const reasonSchema = z.object({ reason: z.string().trim().min(5).max(300) }).strict();

// ---------- Events ----------

export async function logEvent(db: any, tenancyId: number, actorId: number | null, actorRole: TenancyActor, type: string, extra: { fromStatus?: string; toStatus?: string; data?: unknown } = {}) {
  await db.tenancyEvent.create({
    data: { tenancyId, actorId, actorRole, type, fromStatus: extra.fromStatus ?? null, toStatus: extra.toStatus ?? null, data: extra.data ?? null },
  });
}

/** Applies a guarded move; throws 409 if someone else moved it first. */
export async function moveTenancy(db: any, tenancy: { id: number; status: string; version: number }, to: TenancyStatus, actor: TenancyActor, actorId: number | null, data: Record<string, unknown> = {}, eventData?: unknown) {
  const update = tenancyTransitionUpdate(tenancy, to, actor, data);
  const result = await db.tenancy.updateMany(update);
  if (result.count !== 1) throw new TenancyError("This request changed a moment ago. Refresh and try again.", 409);
  await logEvent(db, tenancy.id, actorId, actor, `STATUS_${to}`, { fromStatus: tenancy.status, toStatus: to, data: eventData });
}

// ---------- Loading on one side ----------

export type TenancySide = "TENANT" | "LANDLORD";

export async function loadOwnTenancy(db: any, ref: string, side: TenancySide, userId: number) {
  if (!isTenancyRef(ref)) throw new TenancyError("Not found", 404);
  const tenancy = await db.tenancy.findFirst({
    where: { publicRef: ref, ...(side === "TENANT" ? { tenantId: userId } : { landlordId: userId }) },
  });
  if (!tenancy) throw new TenancyError("Not found", 404);
  return tenancy;
}

// ---------- Messages ----------

export async function postMessage(db: any, tenancy: any, side: TenancySide, userId: number, text: string) {
  if (!isTenancyStatus(tenancy.status) || isTerminalTenancyStatus(tenancy.status)) throw new TenancyError("This request is closed.", 409);
  // Before payment NoLSAF is the bridge: no direct messages, so no deal goes round it.
  if (!contactsShared(tenancy.status)) throw new TenancyError("Messages open once the booking is paid. Until then, ask NoLSAF from the home's page.", 409);
  const clean = { text, masked: false };
  await logEvent(db, tenancy.id, userId, side, "MESSAGE", { data: { text: clean.text, masked: clean.masked } });
  return clean;
}

// ---------- Views ----------

const PUBLIC_EVENT_TYPES = new Set(["RESERVATION_REQUESTED", "MESSAGE", "STATUS_CANCELLED", "STATUS_OFFERED", "STATUS_ACCEPTED", "STATUS_AWAITING_PAYMENT", "LEASE_ACCEPTED", "STATUS_RESERVED", "STATUS_MOVE_IN", "MOVE_IN_CONFIRMED", "STATUS_ACTIVE", "STATUS_DISPUTED", "CONDITION_PHOTOS", "PAYOUT_PAID", "PAYOUT_RECORDED", "STATUS_ENDING", "STATUS_ENDED", "STATUS_OVERDUE", "RENEWAL_REQUESTED", "RENEWAL_REMINDER"]);

/**
 * What one side sees. Never includes row ids, the other side's email, or the
 * other side's name and phone before the booking is paid.
 */
export async function tenancyView(db: any, tenancy: any, side: TenancySide) {
  const [property, tenant, landlord, events] = await Promise.all([
    db.property.findUnique({ where: { id: tenancy.propertyId }, select: { title: true, nrmsBookingKey: true, regionName: true, district: true, longStayListing: true } }),
    db.user.findUnique({ where: { id: tenancy.tenantId }, select: { name: true, fullName: true, phone: true } }),
    db.user.findUnique({ where: { id: tenancy.landlordId }, select: { name: true, fullName: true, phone: true } }),
    db.tenancyEvent.findMany({ where: { tenancyId: tenancy.id }, orderBy: { id: "asc" }, take: 300, select: { actorRole: true, type: true, data: true, createdAt: true } }),
  ]);
  const shared = contactsShared(tenancy.status);
  const other = side === "TENANT" ? landlord : tenant;
  return {
    ref: tenancy.publicRef,
    status: tenancy.status,
    side,
    home: property ? { title: property.title, key: property.nrmsBookingKey, area: [property.district, property.regionName].filter(Boolean).join(", "), terms: rowToTerms(property.longStayListing) } : null,
    // The landlord answers a reservation within 24 hours of it being made.
    confirmBy: tenancy.status === "OFFERED" && tenancy.offeredAt ? new Date(new Date(tenancy.offeredAt).getTime() + CONFIRM_WITHIN_HOURS * 3_600_000) : null,
    otherParty: {
      name: shared ? other?.fullName || other?.name || null : side === "TENANT" ? "The landlord" : (other?.fullName || other?.name || "The tenant").split(" ")[0],
      phone: shared ? other?.phone ?? null : null,
    },
    contactsShared: shared,
    cancelReason: tenancy.cancelReason,
    offer: tenancy.moveInDate && tenancy.termMonths ? {
      moveInDate: new Date(tenancy.moveInDate).toISOString().slice(0, 10),
      termMonths: tenancy.termMonths,
      endDate: tenancy.endDate ? new Date(tenancy.endDate).toISOString().slice(0, 10) : null,
    } : null,
    // Money is shown only once frozen, and each side sees its own figures.
    money: tenancy.bookingAmount != null ? {
      currency: tenancy.currency,
      monthlyRent: Number(tenancy.monthlyRent),
      upfrontMonths: tenancy.upfrontMonths,
      balanceDue: Number(tenancy.balanceDue),
      ...(side === "TENANT"
        ? { bookingAmount: Number(tenancy.bookingAmount), tenantFee: Number(tenancy.tenantFee) }
        : { landlordCommission: Number(tenancy.landlordCommission), landlordPayout: Number((tenancy.termsSnapshot as any)?.landlordPayout ?? 0), firstMonth: Number(tenancy.monthlyRent) }),
    } : null,
    lease: tenancy.leaseHash ? {
      version: tenancy.leaseVersion,
      hash: tenancy.leaseHash,
      tenantAcceptedAt: tenancy.tenantLeaseAcceptedAt,
      landlordAcceptedAt: tenancy.landlordLeaseAcceptedAt,
    } : null,
    paymentDueAt: tenancy.paymentDueAt,
    paidAt: tenancy.paidAt ?? null,
    notice: tenancy.noticeGivenAt ? { givenBy: tenancy.noticeGivenBy, givenAt: tenancy.noticeGivenAt } : null,
    endDate: tenancy.endDate ? new Date(tenancy.endDate).toISOString().slice(0, 10) : null,
    cancellation: (tenancy.termsSnapshot as any)?.cancellation ?? null,
    claims: (db.tenancyClaim ? await db.tenancyClaim.findMany({ where: { tenancyId: tenancy.id }, orderBy: { id: "asc" } }).catch(() => []) : []).map((c: any) => ({
      id: c.id, kind: c.kind, amount: Number(c.amount), recoveredAmount: Number(c.recoveredAmount), currency: c.currency, status: c.status, reason: c.reason, dueAt: c.dueAt, closedAt: c.closedAt,
    })),
    moveIn: {
      landlordConfirmedAt: tenancy.landlordConfirmedAt ?? null,
      tenantConfirmedAt: tenancy.tenantConfirmedAt ?? null,
      landlordBalanceAmount: tenancy.landlordBalanceAmount != null ? Number(tenancy.landlordBalanceAmount) : null,
      tenantBalanceAmount: tenancy.tenantBalanceAmount != null ? Number(tenancy.tenantBalanceAmount) : null,
      confirmedAt: tenancy.moveInConfirmedAt ?? null,
      confirmedBy: tenancy.moveInConfirmedBy ?? null,
      balanceMismatch: Boolean(tenancy.balanceMismatch),
    },
    // The landlord follows the payout; the tenant does not need it.
    payout: side === "LANDLORD" ? { status: tenancy.payoutStatus, releasedAt: tenancy.payoutReleasedAt ?? null } : null,
    createdAt: tenancy.createdAt,
    events: events.filter((e: any) => PUBLIC_EVENT_TYPES.has(e.type)).map((e: any) => ({
      by: e.actorRole === side ? "YOU" : e.actorRole === "TENANT" || e.actorRole === "LANDLORD" ? "THEM" : "NOLSAF",
      type: (e.data as any)?.type ?? e.type,
      text: e.type === "MESSAGE" ? String((e.data as any)?.text ?? "") : null,
      masked: Boolean((e.data as any)?.masked),
      photos: e.type === "CONDITION_PHOTOS" && Array.isArray((e.data as any)?.urls) ? (e.data as any).urls : undefined,
      at: e.createdAt,
    })),
  };
}

/** One line per tenancy for lists. */
export async function tenancyListItems(db: any, where: Record<string, unknown>, side: TenancySide) {
  const rows = await db.tenancy.findMany({ where, orderBy: { updatedAt: "desc" }, take: 100 });
  return presentTenancyRows(db, rows, side);
}

export const tenantBookingListQuery = z.object({
  scope: z.enum(["open", "closed"]).default("open"),
  page: z.string().regex(/^[1-9]\d{0,8}$/).transform(Number),
  q: z.string().trim().max(100).default(""),
  filter: z.enum(["all", "action", "waiting", "moving", "active", "ended", "cancelled"]).default("all"),
  sort: z.enum(["priority", "recent", "move-in"]).default("priority"),
});

export async function tenantBookingPage(db: Pick<Prisma.TransactionClient, "tenancy" | "property" | "user">, tenantId: number, query: z.infer<typeof tenantBookingListQuery>) {
  const pageSize = 10;
  const owned = { tenantId };
  const closed = ["CANCELLED", "ENDED"];
  const scopeWhere: Prisma.TenancyWhereInput = { ...owned, status: query.scope === "closed" ? { in: closed } : { notIn: closed } };
  const action: Prisma.TenancyWhereInput = {
    OR: [{ status: { in: ["AWAITING_PAYMENT", "MOVE_IN"] } }, { status: "ACCEPTED", tenantLeaseAcceptedAt: null }],
  };
  const filters: Record<typeof query.filter, Prisma.TenancyWhereInput> = {
    all: {},
    action,
    waiting: { OR: [{ status: "OFFERED" }, { status: "ACCEPTED", tenantLeaseAcceptedAt: { not: null } }] },
    moving: { status: { in: ["RESERVED", "MOVE_IN"] } },
    active: { status: { in: ["ACTIVE", "ENDING", "OVERDUE", "DISPUTED"] } },
    ended: { status: "ENDED" },
    cancelled: { status: "CANCELLED" },
  };
  const where: Prisma.TenancyWhereInput = {
    ...scopeWhere,
    AND: [
      filters[query.filter],
      ...(query.q ? [{ OR: [{ publicRef: { contains: query.q } }, { property: { is: { title: { contains: query.q } } } }] }] : []),
    ],
  };
  const prioritize = query.scope === "open" && query.filter === "all" && query.sort === "priority";
  const priorityWhere = { AND: [where, action] };
  const [current, history, total, priorityCount] = await Promise.all([
    db.tenancy.count({ where: { ...owned, status: { notIn: closed } } }),
    db.tenancy.count({ where: { ...owned, status: { in: closed } } }),
    db.tenancy.count({ where }),
    prioritize ? db.tenancy.count({ where: priorityWhere }) : 0,
  ]);
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / pageSize)));
  const skip = (page - 1) * pageSize;
  const orderBy: Prisma.TenancyOrderByWithRelationInput[] = query.sort === "move-in"
    ? [{ moveInDate: { sort: "asc", nulls: "last" } }, { id: "desc" }]
    : [{ updatedAt: "desc" }, { id: "desc" }];
  const priorityTake = Math.min(pageSize, Math.max(0, priorityCount - skip));
  const regularTake = pageSize - priorityTake;
  const [priorityRows, regularRows] = await Promise.all([
    priorityTake ? db.tenancy.findMany({ where: priorityWhere, orderBy, skip, take: priorityTake }) : [],
    regularTake ? db.tenancy.findMany({
      where: prioritize ? { AND: [where, { NOT: action }] } : where,
      orderBy, skip: prioritize ? Math.max(0, skip - priorityCount) : skip, take: regularTake,
    }) : [],
  ]);
  return {
    items: await presentTenancyRows(db, [...priorityRows, ...regularRows], "TENANT"),
    pagination: { page, pageSize, total },
    counts: { open: current, closed: history },
  };
}

async function presentTenancyRows(db: any, rows: any[], side: TenancySide) {
  if (!rows.length) return [];
  const propertyIds = Array.from(new Set(rows.map((r: any) => r.propertyId)));
  const userIds = Array.from(new Set(rows.map((r: any) => (side === "TENANT" ? r.landlordId : r.tenantId))));
  const [properties, users] = await Promise.all([
    db.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true, title: true } }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } }),
  ]);
  const titles = new Map(properties.map((p: any) => [p.id, p.title]));
  const names = new Map(users.map((u: any) => [u.id, u.fullName || u.name || null]));
  return rows.map((r: any) => ({
    ref: r.publicRef,
    status: r.status,
    homeTitle: titles.get(r.propertyId) ?? null,
    otherPartyName: contactsShared(r.status) ? names.get(side === "TENANT" ? r.landlordId : r.tenantId) ?? null : null,
    moveInDate: r.moveInDate ? new Date(r.moveInDate).toISOString().slice(0, 10) : null,
    termMonths: r.termMonths ?? null,
    endDate: r.endDate ? new Date(r.endDate).toISOString().slice(0, 10) : null,
    // What the next deadline is, so a list can say "confirm by" or "pay by".
    confirmBy: r.status === "OFFERED" && r.offeredAt ? new Date(new Date(r.offeredAt).getTime() + CONFIRM_WITHIN_HOURS * 3_600_000) : null,
    paymentDueAt: r.status === "AWAITING_PAYMENT" ? r.paymentDueAt ?? null : null,
    leaseSigned: r.status === "ACCEPTED" ? { tenant: Boolean(r.tenantLeaseAcceptedAt), landlord: Boolean(r.landlordLeaseAcceptedAt) } : null,
    currency: r.currency ?? null,
    monthlyRent: r.monthlyRent != null ? Number(r.monthlyRent) : null,
    updatedAt: r.updatedAt,
  }));
}

export { OPEN_BEFORE_LEASE };
