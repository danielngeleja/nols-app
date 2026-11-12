/**
 * Client side of an Agency Desk group request.
 *
 * POST /api/agency-group/preview  { token }  what the partner prepared
 * POST /api/agency-group/confirm  { token }  turn it into the client's group stay
 *
 * The client must be signed in, and the account's phone must be the phone the
 * partner entered and must have been verified by a code, so a partner cannot
 * confirm their own request or create a group stay in someone else's name. The token only travels in the SMS link and
 * is looked up by its SHA-256. Every failure answers the same 404, so the
 * endpoint says nothing about which tokens exist.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitAgencyGroupConfirm } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import { loadPartnerIdentity, phoneKey } from "../lib/salesSelfDealing.js";
import { agencyGateFailure, loadAgencyGateInput } from "../lib/salesAgency.js";
import { createAgencyGroupBooking, hashGroupRequestToken, isWellFormedGroupToken } from "../lib/salesAgencyGroups.js";

const router = Router();
const db = prisma as any;
const NOT_FOUND = { error: "This link is not valid for your account. Sign in with the phone number the request was sent to." };

router.use(requireAuth as RequestHandler, limitAgencyGroupConfirm);

const bodySchema = z.object({ token: z.string().max(64) }).strict();

const PHONE_NOT_VERIFIED = {
  error: "Your phone number is not verified yet. Sign out, sign in again with the code we text to your phone, then open this link again.",
  code: "PHONE_NOT_VERIFIED",
};

/**
 * The request this signed-in user may confirm, "UNVERIFIED" when the account
 * matches but its phone was never proven by a code, or null.
 *
 * A phone typed at password registration is not proof of anything: without
 * this check a partner could register the client's number themself and
 * confirm their own request.
 */
async function loadForUser(userId: number, token: unknown, now: Date): Promise<any | "UNVERIFIED" | null> {
  if (!isWellFormedGroupToken(token)) return null;
  const request = await db.salesAgencyGroupRequest.findUnique({ where: { tokenHash: hashGroupRequestToken(token) } });
  if (!request || request.status !== "AWAITING_CLIENT") return null;
  if (new Date(request.tokenExpiresAt).getTime() <= now.getTime()) return null;
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, phone: true, phoneVerifiedAt: true } });
  const key = phoneKey(user?.phone);
  if (!key || key !== request.clientPhoneKey) return null;
  // The partner can never be their own client.
  const identity = await loadPartnerIdentity(db, request.salesPartnerId);
  if (!identity || identity.userId === userId || identity.phones.has(key)) return null;
  // A partner who lost the desk cannot have new groups confirmed.
  if (agencyGateFailure(await loadAgencyGateInput(db, request.salesPartnerId, now), { at: now })) return null;
  if (!user?.phoneVerifiedAt) return "UNVERIFIED";
  return request;
}

router.post("/preview", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(404).json(NOT_FOUND);
  const request = await loadForUser(Number(req.user!.id), parsed.data.token, new Date());
  if (request === "UNVERIFIED") return res.status(403).json(PHONE_NOT_VERIFIED);
  if (!request) return res.status(404).json(NOT_FOUND);
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: request.salesPartnerId }, select: { agentCode: true } });
  const p: any = request.payload || {};
  return res.json({
    partnerCode: partner?.agentCode ?? null,
    expiresAt: request.tokenExpiresAt,
    request: {
      groupType: p.groupType,
      destination: [p.toWard, p.toDistrict, p.toRegion].filter(Boolean).join(", "),
      accommodationType: p.accommodationType,
      headcount: p.headcount,
      roomsNeeded: p.roomsNeeded,
      checkIn: p.checkin ?? null,
      checkOut: p.checkout ?? null,
      arrangements: p.arrangements ?? null,
      rosterCount: Array.isArray(p.roster) ? p.roster.length : 0,
    },
    payment: "You pay the full amount to NoLSAF on the NoLSAF payment page once you choose an offer. Never pay anyone else.",
  });
}) as RequestHandler);

router.post("/confirm", blockImpersonated as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(404).json(NOT_FOUND);
  const now = new Date();
  const userId = Number(req.user!.id);
  const request = await loadForUser(userId, parsed.data.token, now);
  if (request === "UNVERIFIED") return res.status(403).json(PHONE_NOT_VERIFIED);
  if (!request) return res.status(404).json(NOT_FOUND);
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: request.salesPartnerId }, select: { userId: true, agentCode: true } });

  const result = await db.$transaction(async (tx: any) => {
    // Conditional claim first: a double click or a replay confirms once.
    const moved = await tx.salesAgencyGroupRequest.updateMany({
      where: { id: request.id, status: "AWAITING_CLIENT", tokenHash: request.tokenHash },
      data: { status: "CONFIRMED", confirmedAt: now, confirmedUserId: userId },
    });
    if (moved.count !== 1) return null;
    const { booking, deadline } = await createAgencyGroupBooking(tx, { request, clientUserId: userId, partnerUserId: partner.userId, now });
    await tx.salesAgencyGroupRequest.update({ where: { id: request.id }, data: { groupBookingId: booking.id } });
    if (request.clientId) {
      await tx.salesClientActivity.create({ data: { clientId: request.clientId, createdById: userId, type: "SYSTEM", description: `The client confirmed group stay request ${request.reference}.` } });
    }
    return { booking, deadline };
  }, { maxWait: 5_000, timeout: 20_000 });
  if (!result) return res.status(404).json(NOT_FOUND);

  await audit(req, "SALES_AGENCY_GROUP_CONFIRM", "GROUP_BOOKING", null, { reference: request.reference, salesPartnerId: request.salesPartnerId }, result.booking.id);
  await notifyUser(partner.userId, "sales_partner_agency_group_confirmed", { reference: request.reference, actionPath: `/sales/agency/groups/${request.reference}` }).catch(() => undefined);
  void notifyAdmins("group_stay_request_created", {
    groupBookingId: result.booking.id,
    customerName: "An Agency Desk client",
    headcount: result.booking.headcount ?? null,
    destination: [result.booking.toDistrict, result.booking.toRegion].filter(Boolean).join(", ") || null,
    href: "/admin/group-stays/bookings",
  }).catch(() => undefined);
  return res.json({ ok: true, biddingClosesAt: result.deadline });
}) as RequestHandler);

export default router;
