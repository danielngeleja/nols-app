import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { notifyOwner } from "../lib/notifications.js";
import { customerBookingReference } from "../lib/customerBookingReference.js";
import { deliverGuestCheckinCode, maskPhone, OPEN_GUEST_CODE_STATUSES } from "../lib/guestCodeRequests.js";

/**
 * NoLSAF's queue of owner requests to get a guest's check-in code back to the
 * guest. Most requests are delivered automatically (SENT); the ones a person
 * must handle arrive as NEEDS_REVIEW (owner and guest contacts overlap) or
 * UNREACHABLE (no guest contact worked). Admins resend, optionally after
 * correcting the guest phone on the booking, or close the request with a note
 * the owner sees. The code itself is never returned to the browser.
 */
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

const db = prisma as any;
const AWAITING = ["CONFIRMED", "PENDING_CHECKIN"];

const listSchema = z.object({
  status: z.enum(["OPEN", "SENT", "RESOLVED", "REJECTED", "ALL"]).default("OPEN"),
  bookingId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function migrationMissing(err: any): boolean {
  return ["P2021", "P2022"].includes(err?.code) || /guest_code_request|guestCodeRequest/i.test(String(err?.message ?? ""));
}

router.get("/", (async (req: AuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filters" });
  const { status, bookingId, page, pageSize } = parsed.data;
  const where = {
    ...(status === "OPEN" ? { status: { in: OPEN_GUEST_CODE_STATUSES } } : status === "ALL" ? {} : { status }),
    ...(bookingId ? { bookingId } : {}),
  };
  try {
    const [total, rows, needsReview, unreachable, sentToday] = await Promise.all([
      db.guestCodeRequest.count({ where }),
      db.guestCodeRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          booking: {
            select: {
              id: true, status: true, guestName: true, guestPhone: true, checkIn: true, checkOut: true, userId: true,
              code: { select: { status: true } },
              property: { select: { title: true, owner: { select: { id: true, name: true, fullName: true, phone: true } } } },
            },
          },
        },
      }),
      db.guestCodeRequest.count({ where: { status: "NEEDS_REVIEW" } }),
      db.guestCodeRequest.count({ where: { status: "UNREACHABLE" } }),
      db.guestCodeRequest.count({ where: { status: "SENT", createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);
    const resolverIds = [...new Set(rows.map((row: any) => row.resolvedById).filter(Boolean))] as number[];
    const resolvers = resolverIds.length
      ? await db.user.findMany({ where: { id: { in: resolverIds } }, select: { id: true, name: true, fullName: true } })
      : [];
    const resolverName = new Map(resolvers.map((u: any) => [u.id, u.fullName || u.name || `Admin ${u.id}`]));
    return res.json({
      total,
      page,
      pageSize,
      counts: { open: needsReview + unreachable, needsReview, unreachable, sentToday },
      requests: rows.map((row: any) => {
        const owner = row.booking?.property?.owner;
        return {
          id: row.id,
          status: row.status,
          channel: row.channel,
          destinationMasked: row.destinationMasked,
          reason: row.reason,
          resolution: row.resolution,
          adminNote: row.adminNote,
          resolvedBy: row.resolvedById ? resolverName.get(row.resolvedById) ?? null : null,
          resolvedAt: row.resolvedAt,
          createdAt: row.createdAt,
          booking: {
            reference: customerBookingReference(row.booking.id),
            status: row.booking.status,
            codeStatus: row.booking.code?.status ?? null,
            awaitingCheckIn: AWAITING.includes(row.booking.status) && row.booking.code?.status === "ACTIVE",
            guestName: row.booking.guestName,
            guestPhoneMasked: maskPhone(row.booking.guestPhone),
            hasAccount: Boolean(row.booking.userId),
            checkIn: row.booking.checkIn,
            checkOut: row.booking.checkOut,
            propertyTitle: row.booking.property?.title ?? null,
          },
          owner: owner ? { name: owner.fullName || owner.name || `Owner ${owner.id}`, phoneMasked: maskPhone(owner.phone) } : null,
        };
      }),
    });
  } catch (err: any) {
    if (migrationMissing(err)) return res.json({ total: 0, page, pageSize, counts: { open: 0, needsReview: 0, unreachable: 0, sentToday: 0 }, requests: [], migrationPending: true });
    console.error("[admin.guestCodeRequests] list failed", err);
    return res.status(500).json({ error: "Could not load guest code requests" });
  }
}) as RequestHandler);

async function loadOpenRequest(res: Response, id: number) {
  const request = await db.guestCodeRequest.findUnique({
    where: { id },
    include: {
      booking: {
        select: {
          id: true, status: true, guestPhone: true, userId: true,
          code: { select: { status: true, code: true } },
          property: { select: { ownerId: true } },
        },
      },
    },
  });
  if (!request) { res.status(404).json({ error: "Request not found" }); return null; }
  if (!OPEN_GUEST_CODE_STATUSES.includes(request.status)) { res.status(409).json({ error: "This request is already closed" }); return null; }
  return request;
}

const resendSchema = z.object({
  phone: z.string().trim().max(40).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Resend the code to the guest's booking contact, optionally correcting the phone first. */
router.post("/:id/resend", blockImpersonated as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = resendSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the phone number and note" });
  try {
    const request = await loadOpenRequest(res, Number(req.params.id));
    if (!request) return;
    const booking = request.booking;
    if (!booking.code || booking.code.status !== "ACTIVE" || !AWAITING.includes(booking.status)) {
      return res.status(409).json({ error: "The booking is no longer awaiting check-in. Close the request instead." });
    }

    const newPhone = parsed.data.phone ? parsed.data.phone.replace(/[^\d+]/g, "") : "";
    if (parsed.data.phone && newPhone.replace(/\D/g, "").length < 9) return res.status(400).json({ error: "Enter the guest's full phone number" });
    const phoneChanged = Boolean(newPhone) && newPhone !== String(booking.guestPhone || "");
    if (phoneChanged) {
      await db.booking.update({ where: { id: booking.id }, data: { guestPhone: newPhone } });
      await db.auditLog.create({
        data: {
          actorId: req.user!.id, actorRole: "ADMIN", action: "ADMIN_UPDATED_GUEST_PHONE", entity: "BOOKING", entityId: booking.id,
          beforeJson: { guestPhone: maskPhone(booking.guestPhone) }, afterJson: { guestPhone: maskPhone(newPhone), requestId: request.id },
        },
      });
    }

    const delivered = await deliverGuestCheckinCode({ id: booking.id, userId: booking.userId, guestPhone: phoneChanged ? newPhone : booking.guestPhone, code: { code: booking.code.code } });
    if (!delivered.channel) {
      return res.status(503).json({ error: "The guest still could not be reached. Correct the phone number or close the request with a note." });
    }
    const now = new Date();
    await db.guestCodeRequest.update({
      where: { id: request.id },
      data: {
        status: "RESOLVED",
        resolution: phoneChanged ? "CONTACT_UPDATED" : "RESENT",
        channel: delivered.channel,
        destinationMasked: delivered.destinationMasked,
        adminNote: parsed.data.note || null,
        resolvedById: req.user!.id,
        resolvedAt: now,
      },
    });
    await db.auditLog.create({
      data: {
        actorId: req.user!.id, actorRole: "ADMIN", action: "ADMIN_RESENT_GUEST_CHECKIN_CODE", entity: "BOOKING", entityId: booking.id,
        afterJson: { requestId: request.id, channel: delivered.channel, phoneChanged, codeShared: false },
      },
    });
    void notifyOwner(request.ownerId, "guest_code_request_resolved", { bookingReference: customerBookingReference(booking.id), destinationMasked: delivered.destinationMasked });
    return res.json({ ok: true, channel: delivered.channel, destinationMasked: delivered.destinationMasked });
  } catch (err: any) {
    if (migrationMissing(err)) return res.status(503).json({ error: "Guest code requests are not set up yet (migration pending)." });
    console.error("[admin.guestCodeRequests] resend failed", err);
    return res.status(500).json({ error: "Could not resend the code" });
  }
}) as RequestHandler);

const rejectSchema = z.object({ note: z.string().trim().min(3).max(500) });

/** Close the request without sending; the owner sees the note. */
router.post("/:id/reject", blockImpersonated as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Add a short note for the owner" });
  try {
    const request = await loadOpenRequest(res, Number(req.params.id));
    if (!request) return;
    await db.guestCodeRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", resolution: "REJECTED", adminNote: parsed.data.note, resolvedById: req.user!.id, resolvedAt: new Date() },
    });
    await db.auditLog.create({
      data: {
        actorId: req.user!.id, actorRole: "ADMIN", action: "ADMIN_CLOSED_GUEST_CODE_REQUEST", entity: "BOOKING", entityId: request.bookingId,
        afterJson: { requestId: request.id, note: parsed.data.note },
      },
    });
    void notifyOwner(request.ownerId, "guest_code_request_rejected", { bookingReference: customerBookingReference(request.bookingId), note: parsed.data.note });
    return res.json({ ok: true });
  } catch (err: any) {
    if (migrationMissing(err)) return res.status(503).json({ error: "Guest code requests are not set up yet (migration pending)." });
    console.error("[admin.guestCodeRequests] reject failed", err);
    return res.status(500).json({ error: "Could not close the request" });
  }
}) as RequestHandler);

export default router;
