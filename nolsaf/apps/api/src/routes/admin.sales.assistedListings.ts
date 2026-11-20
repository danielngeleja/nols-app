/**
 * Sales assisted listing, admin side (docs/SALES_ASSISTED_LISTING.md).
 *
 * GET  /api/admin/sales/assisted-listings                    queue (filter by status)
 * POST /api/admin/sales/assisted-listings/:id/resolve        owner objection: RESUME or CANCEL
 * POST /api/admin/sales/assisted-listings/:id/cancel         withdraw a listing (any open state)
 * GET  /api/admin/sales/partners/:id/assisted-listing        a partner's right and counts
 * POST /api/admin/sales/partners/:id/assisted-listing        ENABLE, DISABLE, PAUSE, UNPAUSE
 *
 * Listing approval itself stays on the normal property moderation route; it
 * calls the assisted-listing hooks (SMS to the owner, partner notified).
 * Attribution stays on the normal conversion review.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitSalesAdminRead, limitSalesAdminWrite } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { notifyUser } from "../lib/notifications.js";
import { invalidateCache, cacheKeys } from "../lib/performance.js";
import { propertyRef, leadRef } from "../lib/salesReference.js";
import {
  ASSISTED_STATUSES,
  AssistedListingError,
  maskOwnerPhone,
  releaseUnusedOwnerAccount,
  resolveObjection,
} from "../lib/salesAssistedListing.js";

const router = Router();
const db = prisma as any;

router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);

const idParams = z.object({ id: z.coerce.number().int().positive() });
const reason = z.string().trim().min(5, "Give a reason of at least 5 characters").max(300).transform(sanitizeText);
const listSchema = z.object({
  status: z.enum(ASSISTED_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const resolveSchema = z.object({ outcome: z.enum(["RESUME", "CANCEL"]), reason }).strict();
const cancelSchema = z.object({ reason }).strict();
const rightSchema = z.object({ action: z.enum(["ENABLE", "DISABLE", "PAUSE", "UNPAUSE"]), reason }).strict();

function bad(res: Response, parsed: { success: boolean; error?: any }): boolean {
  if (parsed.success) return false;
  res.status(400).json({ error: parsed.error?.issues?.[0]?.message || "Invalid request" });
  return true;
}

router.get("/assisted-listings", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (bad(res, parsed)) return;
  const { status, page, pageSize } = parsed.data!;
  const where = status ? { status } : {};
  const [total, rows, counts] = await Promise.all([
    db.salesAssistedListing.count({ where }),
    db.salesAssistedListing.findMany({
      where,
      // Owner queries first, then the oldest waiting work.
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        leadId: true,
        propertyId: true,
        status: true,
        ownerAccountOutcome: true,
        noticeSentAt: true,
        liveNoticeSentAt: true,
        objectedAt: true,
        objectionNote: true,
        statusBeforeObjection: true,
        objectionOutcome: true,
        submittedAt: true,
        approvedAt: true,
        returnedAt: true,
        cancelledAt: true,
        cancelReason: true,
        createdAt: true,
        updatedAt: true,
        property: { select: { title: true, status: true, regionName: true, district: true } },
        owner: { select: { name: true, fullName: true, phone: true, phoneVerifiedAt: true } },
        salesPartner: { select: { id: true, agentCode: true, user: { select: { name: true, fullName: true } } } },
        visit: { select: { capturedAt: true, distanceMeters: true, status: true } },
      },
    }),
    db.salesAssistedListing.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    total,
    page,
    pageSize,
    counts: Object.fromEntries(counts.map((row: any) => [row.status, row._count._all])),
    listings: rows.map((row: any) => ({
      id: row.id,
      leadRef: leadRef(row.leadId),
      propertyRef: propertyRef(row.propertyId),
      propertyId: row.propertyId,
      status: row.status,
      ownerAccount: row.ownerAccountOutcome,
      ownerName: row.owner?.fullName || row.owner?.name || null,
      ownerPhone: maskOwnerPhone(row.owner?.phone),
      // The owner has signed in at least once (phone verified by an SMS code).
      ownerEngaged: Boolean(row.owner?.phoneVerifiedAt),
      property: row.property,
      partner: { id: row.salesPartner?.id, code: row.salesPartner?.agentCode, name: row.salesPartner?.user?.fullName || row.salesPartner?.user?.name || null },
      visit: row.visit ?? null,
      noticeSentAt: row.noticeSentAt,
      liveNoticeSentAt: row.liveNoticeSentAt,
      objectedAt: row.objectedAt,
      objectionNote: row.objectionNote,
      statusBeforeObjection: row.statusBeforeObjection,
      objectionOutcome: row.objectionOutcome,
      submittedAt: row.submittedAt,
      approvedAt: row.approvedAt,
      returnedAt: row.returnedAt,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  });
}));

router.post("/assisted-listings/:id/resolve", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = resolveSchema.safeParse(req.body ?? {});
  if (bad(res, params) || bad(res, parsed)) return;
  try {
    const result = await resolveObjection({
      assistedId: params.data!.id,
      outcome: parsed.data!.outcome,
      adminUserId: req.user!.id,
      reason: parsed.data!.reason,
    });
    await audit(req as any, "SALES_ASSISTED_LISTING_OBJECTION_RESOLVE", "SALES_ASSISTED_LISTING", { status: "PAUSED_OBJECTION" }, {
      outcome: parsed.data!.outcome,
      status: result.status,
      partnerPaused: result.partnerPaused,
      reason: parsed.data!.reason,
    }, params.data!.id);
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AssistedListingError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}));

router.post("/assisted-listings/:id/cancel", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = cancelSchema.safeParse(req.body ?? {});
  if (bad(res, params) || bad(res, parsed)) return;
  const row = await db.salesAssistedListing.findUnique({
    where: { id: params.data!.id },
    select: { id: true, status: true, propertyId: true, ownerUserId: true, ownerAccountOutcome: true, property: { select: { title: true } }, salesPartner: { select: { userId: true } } },
  });
  if (!row) return res.status(404).json({ error: "Assisted listing not found" });
  if (row.status === "CANCELLED") return res.status(409).json({ error: "This listing is already cancelled" });
  if (row.status === "PAUSED_OBJECTION") return res.status(409).json({ error: "Resolve the owner's query instead (Cancel or Resume)." });
  const now = new Date();
  let accountReleased = false;
  await db.$transaction(async (tx: any) => {
    const moved = await tx.salesAssistedListing.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: "CANCELLED", cancelledAt: now, cancelReason: parsed.data!.reason },
    });
    if (moved.count !== 1) throw new AssistedListingError(409, "This listing was changed by someone else. Reload.");
    // Off NoLSAF for good; the record is kept, not deleted.
    await tx.property.update({ where: { id: row.propertyId }, data: { status: "SUSPENDED" } });
    // A never-used account made for this listing gives its phone number back.
    accountReleased = await releaseUnusedOwnerAccount(tx, row);
  });
  await Promise.all([
    invalidateCache(cacheKeys.property(row.propertyId)),
    invalidateCache("properties:list:*"),
    invalidateCache(cacheKeys.adminSummary()),
  ]).catch(() => undefined);
  await notifyUser(row.salesPartner.userId, "sales_assisted_listing_cancelled", { propertyTitle: row.property?.title, reason: parsed.data!.reason }).catch(() => undefined);
  await audit(req as any, "SALES_ASSISTED_LISTING_CANCEL", "SALES_ASSISTED_LISTING", { status: row.status }, { status: "CANCELLED", reason: parsed.data!.reason, accountReleased }, row.id);
  return res.json({ ok: true, status: "CANCELLED", accountReleased });
}));

router.get("/partners/:id/assisted-listing", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  if (bad(res, params)) return;
  const id = params.data!.id;
  const [profile, counts, upheld] = await Promise.all([
    db.salesPartnerProfile.findUnique({
      where: { id },
      select: { id: true, assistedListingEnabledAt: true, assistedListingPausedAt: true, assistedListingPauseReason: true },
    }),
    db.salesAssistedListing.groupBy({ by: ["status"], where: { salesPartnerId: id }, _count: { _all: true } }),
    db.salesAssistedListing.count({ where: { salesPartnerId: id, objectionOutcome: "CANCEL" } }),
  ]);
  if (!profile) return res.status(404).json({ error: "Partner not found" });
  return res.json({
    enabledAt: profile.assistedListingEnabledAt,
    pausedAt: profile.assistedListingPausedAt,
    pauseReason: profile.assistedListingPauseReason,
    upheldObjections: upheld,
    counts: Object.fromEntries(counts.map((row: any) => [row.status, row._count._all])),
  });
}));

router.post("/partners/:id/assisted-listing", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = rightSchema.safeParse(req.body ?? {});
  if (bad(res, params) || bad(res, parsed)) return;
  const id = params.data!.id;
  const { action, reason: why } = parsed.data!;
  const before = await db.salesPartnerProfile.findUnique({
    where: { id },
    select: { id: true, status: true, assistedListingEnabledAt: true, assistedListingPausedAt: true },
  });
  if (!before) return res.status(404).json({ error: "Partner not found" });
  if (action === "ENABLE" && before.status !== "ACTIVE") return res.status(409).json({ error: "Only an active partner can be given this right" });
  const now = new Date();
  const data =
    action === "ENABLE" ? { assistedListingEnabledAt: before.assistedListingEnabledAt ?? now, assistedListingPausedAt: null, assistedListingPauseReason: null }
    : action === "DISABLE" ? { assistedListingEnabledAt: null, assistedListingPausedAt: null, assistedListingPauseReason: null }
    : action === "PAUSE" ? { assistedListingPausedAt: now, assistedListingPauseReason: why }
    : { assistedListingPausedAt: null, assistedListingPauseReason: null };
  const after = await db.salesPartnerProfile.update({
    where: { id },
    data,
    select: { assistedListingEnabledAt: true, assistedListingPausedAt: true, assistedListingPauseReason: true },
  });
  await audit(req as any, "SALES_ASSISTED_LISTING_RIGHT", "SALES_PARTNER", {
    enabledAt: before.assistedListingEnabledAt,
    pausedAt: before.assistedListingPausedAt,
  }, { action, reason: why, ...after }, id);
  return res.json({ ok: true, enabledAt: after.assistedListingEnabledAt, pausedAt: after.assistedListingPausedAt, pauseReason: after.assistedListingPauseReason });
}));

export default router;
