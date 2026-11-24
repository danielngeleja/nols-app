/**
 * Route handlers shared by the tenant (/api/customer/long-stay) and landlord
 * (/api/owner/long-stay) sides, so both run the same checks. Each handler is
 * built for one side and only ever loads that side's tenancies.
 */
import { type RequestHandler, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import type { AuthedRequest } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { notifyAdmins, notifyOwner, notifyUser } from "../notifications.js";
import { isTrustedUserDocumentUrl } from "../userDocumentSecurity.js";
import { addConditionPhotos, confirmMoveIn, disputeSchema, ensureMoveInDay, landlordConfirmSchema, openDispute, photosSchema, tenantConfirmSchema } from "./moveIn.js";
import { todayInEat } from "./listing.js";
import { cancelReserved, cancelSchema, cancellationTerms, confirmMoveOut, giveNotice, noticeSchema, startRenewal } from "./lifecycle.js";
import { closeClaim } from "./claims.js";
import { syncLongStayRevenue } from "../revenueRecognition.js";
import { sanitizeText } from "../sanitize.js";
import {
  loadOwnTenancy,
  messageSchema,
  moveTenancy,
  OPEN_BEFORE_LEASE,
  postMessage,
  reasonSchema,
  TenancyError,
  tenantBookingListQuery,
  tenantBookingPage,
  tenancyListItems,
  tenancyView,
  type TenancySide,
} from "./tenancyService.js";
import { acceptLease, acceptOffer, cancelClashingReservations, leaseAcceptSchema, leaseTextOf, PAYMENT_WINDOW_HOURS } from "./offerService.js";

export function sendTenancyError(res: Response, error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
    res.status(409).json({ error: "The reservation changed while this was being saved. Try again." });
    return true;
  }
  if (!(error instanceof TenancyError)) return false;
  res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  return true;
}

function guard(handler: (req: AuthedRequest, res: Response) => Promise<unknown>): RequestHandler {
  return asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!sendTenancyError(res, error)) throw error;
    }
  }) as RequestHandler;
}

async function displayName(userId: number): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, name: true } });
  return user?.fullName || user?.name || null;
}

async function propertyTitle(propertyId: number): Promise<string | null> {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { title: true } });
  return p?.title ?? null;
}

function eatLabel(date: Date): string {
  return `${date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

export function listTenancies(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    if (side === "TENANT" && req.query.page !== undefined) {
      const parsed = tenantBookingListQuery.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: "Invalid booking search, filter or page." });
      res.setHeader("Cache-Control", "private, no-store");
      return res.json(await tenantBookingPage(prisma, req.user!.id, parsed.data));
    }
    const scope = String(req.query.scope || "open");
    const statusFilter = scope === "closed" ? { in: ["CANCELLED", "ENDED"] } : { notIn: ["CANCELLED", "ENDED"] };
    const where = { ...(side === "TENANT" ? { tenantId: req.user!.id } : { landlordId: req.user!.id }), status: statusFilter };
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ items: await tenancyListItems(prisma, where, side) });
  });
}

export function getTenancy(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await tenancyView(prisma, tenancy, side));
  });
}

export function sendMessage(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const body = messageSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Write a message of up to 1000 characters." });
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    const text = sanitizeText(body.data.text).trim();
    if (!text) return res.status(400).json({ error: "Write a message first." });
    const result = await postMessage(prisma, tenancy, side, req.user!.id, text);
    const [fromName, title] = await Promise.all([displayName(req.user!.id), propertyTitle(tenancy.propertyId)]);
    if (side === "TENANT") await notifyOwner(tenancy.landlordId, "long_stay_message", { fromName, propertyTitle: title }).catch(() => undefined);
    else await notifyUser(tenancy.tenantId, "long_stay_message_tenant", { fromName, propertyTitle: title }).catch(() => undefined);
    res.json({ ok: true, masked: result.masked });
  });
}

/** Tenant withdraws, or landlord declines, before any money or lease. */
export function closeRequest(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const body = reasonSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Give a short reason (at least 5 characters)." });
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    // Closable until money moves; after payment, cancellation follows the refund rules (milestone 6).
    if (![...OPEN_BEFORE_LEASE, "ACCEPTED", "AWAITING_PAYMENT"].includes(tenancy.status)) throw new TenancyError("This request can no longer be closed here.", 409);
    const reason = sanitizeText(body.data.reason).slice(0, 300);
    await moveTenancy(prisma, tenancy, "CANCELLED", side, req.user!.id, { cancelledAt: new Date(), cancelledBy: side, cancelReason: reason }, { reason });
    if (side === "LANDLORD") {
      await notifyUser(tenancy.tenantId, "long_stay_request_closed", { propertyTitle: await propertyTitle(tenancy.propertyId), reason }).catch(() => undefined);
    }
    res.json({ ok: true, status: "CANCELLED" });
  });
}

// ---------- Reservation and lease ----------

export const acceptOfferRoute: RequestHandler = guard(async (req, res) => {
  const landlordId = req.user!.id;
  const { tenancy, result } = await prisma.$transaction(async (tx) => {
    const tenancy = await loadOwnTenancy(tx, String(req.params.ref), "LANDLORD", landlordId);
    return { tenancy, result: await acceptOffer(tx, tenancy, landlordId) };
  }, { isolationLevel: "Serializable" });
  const title = await propertyTitle(tenancy.propertyId);
  await notifyUser(tenancy.tenantId, "long_stay_offer_accepted", { propertyTitle: title }).catch(() => undefined);
  // Other reservations for the same dates can no longer be confirmed: close them now.
  const closed = await cancelClashingReservations(prisma, tenancy);
  for (const tenantId of closed) {
    await notifyUser(tenantId, "long_stay_request_closed", { propertyTitle: title, reason: "The landlord confirmed another tenant for these dates." }).catch(() => undefined);
  }
  res.json({ ok: true, status: "ACCEPTED", leaseHash: result.leaseHash });
});

export function getLease(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    const text = leaseTextOf(tenancy);
    if (!text) return res.status(404).json({ error: "There is no lease for this request yet." });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ version: tenancy.leaseVersion, hash: tenancy.leaseHash, text });
  });
}

export function acceptLeaseRoute(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const body = leaseAcceptSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Reload the lease and accept it again." });
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    const result = await acceptLease(prisma, tenancy, side, req.user!.id, body.data.leaseHash);
    const title = await propertyTitle(tenancy.propertyId);
    if (result.bothAccepted) {
      await notifyUser(tenancy.tenantId, "long_stay_lease_signed", { propertyTitle: title, hours: PAYMENT_WINDOW_HOURS }).catch(() => undefined);
      await notifyOwner(tenancy.landlordId, "long_stay_lease_signed_owner", { propertyTitle: title }).catch(() => undefined);
    } else if (side === "TENANT") {
      await notifyOwner(tenancy.landlordId, "long_stay_lease_waiting", { propertyTitle: title }).catch(() => undefined);
    } else {
      await notifyUser(tenancy.tenantId, "long_stay_lease_waiting_tenant", { propertyTitle: title }).catch(() => undefined);
    }
    res.json({ ok: true, bothAccepted: result.bothAccepted });
  });
}

// ---------- Move-in (milestone 7) ----------

export function confirmMoveInRoute(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const schema = side === "LANDLORD" ? landlordConfirmSchema : tenantConfirmSchema;
    const body = schema.safeParse(req.body ?? {});
    if (!body.success) {
      return res.status(400).json({ error: side === "TENANT" ? "Enter the balance you paid and how. If you did not get the keys or the home is not as listed, report a problem instead." : "Enter the balance you received and how." });
    }
    let tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    tenancy = await ensureMoveInDay(prisma, tenancy, todayInEat());
    const result = await confirmMoveIn(prisma, tenancy, side, req.user!.id, body.data);
    const title = await propertyTitle(tenancy.propertyId);
    if (result.let) {
      await notifyUser(tenancy.tenantId, "long_stay_moved_in", { propertyTitle: title }).catch(() => undefined);
      await notifyOwner(tenancy.landlordId, "long_stay_moved_in_owner", { propertyTitle: title }).catch(() => undefined);
      await notifyAdmins("long_stay_payout_ready", { tenancyRef: tenancy.publicRef, propertyTitle: title, mismatch: result.mismatch }).catch(() => undefined);
    } else if (side === "TENANT") {
      await notifyOwner(tenancy.landlordId, "long_stay_confirm_move_in_owner", { propertyTitle: title }).catch(() => undefined);
    } else {
      await notifyUser(tenancy.tenantId, "long_stay_confirm_move_in", { propertyTitle: title }).catch(() => undefined);
    }
    res.json({ ok: true, let: result.let });
  });
}

export function disputeRoute(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const body = disputeSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Tell NoLSAF what is wrong (at least 10 characters)." });
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    const reason = sanitizeText(body.data.reason).slice(0, 1000);
    await openDispute(prisma, tenancy, side, req.user!.id, reason);
    await notifyAdmins("long_stay_dispute_opened", { tenancyRef: tenancy.publicRef, propertyTitle: await propertyTitle(tenancy.propertyId), side, reason: reason.slice(0, 200) }).catch(() => undefined);
    res.json({ ok: true, status: "DISPUTED" });
  });
}

export function photosRoute(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const body = photosSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Add between 1 and 12 photos." });
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    const role = String(req.user?.role || "");
    const result = await addConditionPhotos(prisma, tenancy, side, req.user!.id, body.data.urls, (url) => isTrustedUserDocumentUrl(url, role));
    res.json({ ok: true, added: result.added });
  });
}

// ---------- After the booking (milestone 8) ----------

/** What cancelling today would mean for the money, before the side decides. */
export function cancelTermsRoute(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    if (tenancy.status !== "RESERVED" || !tenancy.paidAt) return res.status(409).json({ error: "This booking cannot be cancelled here." });
    res.json({ terms: cancellationTerms(tenancy, side), currency: tenancy.currency });
  });
}

export function cancelReservedRoute(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const body = cancelSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Give a short reason (at least 5 characters)." });
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    const reason = sanitizeText(body.data.reason).slice(0, 300);
    const result = await cancelReserved(prisma, tenancy, side, req.user!.id, reason);
    await syncLongStayRevenue(prisma, tenancy.id).catch((error: any) => console.error(`[longStay] revenue sync failed for tenancy ${tenancy.id}:`, error?.message ?? error));
    const title = await propertyTitle(tenancy.propertyId);
    const other = side === "TENANT" ? "long_stay_cancelled_owner" : "long_stay_cancelled";
    if (side === "TENANT") await notifyOwner(tenancy.landlordId, other, { propertyTitle: title, reason }).catch(() => undefined);
    else await notifyUser(tenancy.tenantId, other, { propertyTitle: title, reason }).catch(() => undefined);
    await notifyAdmins("long_stay_cancelled_paid", { tenancyRef: tenancy.publicRef, propertyTitle: title, by: side, refund: result.terms.refundToTenant, payout: result.terms.landlordPayout, landlordPaused: result.landlordPaused }).catch(() => undefined);
    res.json({ ok: true, status: "CANCELLED", terms: result.terms });
  });
}

export function noticeRoute(side: TenancySide): RequestHandler {
  return guard(async (req, res) => {
    const body = noticeSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Choose the day you will leave." });
    const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), side, req.user!.id);
    const reason = body.data.reason ? sanitizeText(body.data.reason).slice(0, 500) : null;
    await giveNotice(prisma, tenancy, side, req.user!.id, { leaveOn: body.data.leaveOn, reason });
    const title = await propertyTitle(tenancy.propertyId);
    if (side === "TENANT") await notifyOwner(tenancy.landlordId, "long_stay_notice_owner", { propertyTitle: title, leaveOn: body.data.leaveOn }).catch(() => undefined);
    else {
      await notifyUser(tenancy.tenantId, "long_stay_notice", { propertyTitle: title, leaveOn: body.data.leaveOn, reason }).catch(() => undefined);
      await notifyAdmins("long_stay_landlord_notice", { tenancyRef: tenancy.publicRef, propertyTitle: title, leaveOn: body.data.leaveOn, reason }).catch(() => undefined);
    }
    res.json({ ok: true, status: "ENDING" });
  });
}

export const moveOutRoute: RequestHandler = guard(async (req, res) => {
  const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), "LANDLORD", req.user!.id);
  await confirmMoveOut(prisma, tenancy, req.user!.id);
  await notifyUser(tenancy.tenantId, "long_stay_ended", { propertyTitle: await propertyTitle(tenancy.propertyId) }).catch(() => undefined);
  res.json({ ok: true, status: "ENDED" });
});

export const renewRoute: RequestHandler = guard(async (req, res) => {
  const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), "TENANT", req.user!.id);
  const term = Number((req.body ?? {}).termMonths);
  const result = await startRenewal(prisma, tenancy, req.user!.id, Number.isInteger(term) && term > 0 ? term : null);
  if (!result.existing) await notifyOwner(tenancy.landlordId, "long_stay_renewal_owner", { propertyTitle: await propertyTitle(tenancy.propertyId) }).catch(() => undefined);
  res.json({ ok: true, ref: result.ref });
});

/** The tenant confirms the landlord paid a claim directly. */
export const claimReceivedRoute: RequestHandler = guard(async (req, res) => {
  const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), "TENANT", req.user!.id);
  const claimId = Number(req.params.claimId);
  const claim = Number.isInteger(claimId) ? await prisma.tenancyClaim.findFirst({ where: { id: claimId, tenancyId: tenancy.id } }) : null;
  if (!claim) return res.status(404).json({ error: "Not found" });
  await closeClaim(prisma, claim, "SETTLED", "The tenant confirmed receiving it");
  res.json({ ok: true, status: "SETTLED" });
});
