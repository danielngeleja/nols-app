// apps/api/src/routes/owner.nrms.roomingList.ts
//
// The rooming list: the desk shares one link with the agency, the agency types
// who is staying, the desk reviews those names and confirms them into real
// reservations. It is the second half of the group flow that group blocks
// started, and it exists because the alternative is a clerk typing twenty names
// off a phone call, which is where group check-in goes wrong everywhere.
//
// Two rules hold the whole design together:
//   1. The agency never touches inventory. Submitted rows are staging text.
//      Only the desk confirming a row calls pickup, and pickup is the single
//      shared path in lib/nrmsGroupPickup that the manual naming flow uses too.
//   2. publicToken is a bearer credential. It is generated here and served by
//      the public route with no-store, no-referrer and noindex.
import crypto from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { requireNrms, loadOwnedActiveNrmsProperty } from "../lib/nrms.js";
import { sanitizeText } from "../lib/sanitize.js";
import {
  BLOCK_LIVE_STATUSES,
  PICKUP_RACE,
  pickupErrorBody,
  resolveGroupGuestProfile,
  runBlockPickup,
  type PickupErrorCode,
} from "../lib/nrmsGroupPickup.js";

export const router = Router();

router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, requireNrms as RequestHandler);

const DEFAULT_VALID_DAYS = 14;
const MAX_VALID_DAYS = 90;

const createSchema = z.object({
  instructions: z.string().trim().max(2000).optional().nullable(),
  validDays: z.number().int().min(1).max(MAX_VALID_DAYS).optional(),
});

const rejectSchema = z.object({ rejectionReason: z.string().trim().min(2).max(300) });
const acceptSchema = z.object({ blockRoomId: z.number().int().positive().optional().nullable() });
const returnSchema = z.object({ deskNotes: z.string().trim().min(2).max(2000) });

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function expiryFrom(validDays: number | undefined, block: { checkOut: Date }): Date {
  const days = validDays ?? DEFAULT_VALID_DAYS;
  const requested = new Date(Date.now() + days * 86_400_000);
  // A link outliving the stay it serves is only a loose credential, so it is
  // capped at departure whenever departure comes first.
  const departure = new Date(block.checkOut);
  departure.setUTCHours(23, 59, 59, 999);
  return requested.getTime() > departure.getTime() && departure.getTime() > Date.now() ? departure : requested;
}

const listInclude = {
  rows: { include: { blockRoom: { include: { roomType: { select: { name: true } } } } }, orderBy: { id: "asc" as const } },
  reviewedBy: { select: { name: true } },
};

function formatRow(row: any) {
  return {
    id: row.id,
    blockRoomId: row.blockRoomId,
    roomTypeName: row.blockRoom?.roomType?.name ?? null,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    nationality: row.nationality,
    adults: row.adults,
    children: row.children,
    sharingWith: row.sharingWith,
    notes: row.notes,
    status: row.status,
    rejectionReason: row.rejectionReason,
    reservationId: row.reservationId,
    createdAt: row.createdAt,
  };
}

function formatList(list: any, block: { checkIn: Date; checkOut: Date }) {
  const rows = (list.rows ?? []).map(formatRow);
  return {
    id: list.id,
    blockId: list.blockId,
    publicToken: list.publicToken,
    status: list.status,
    expiresAt: list.expiresAt,
    expired: new Date(list.expiresAt).getTime() <= Date.now(),
    sentAt: list.sentAt,
    submittedAt: list.submittedAt,
    reviewedAt: list.reviewedAt,
    reviewedByName: list.reviewedBy?.name ?? null,
    submitterName: list.submitterName,
    submitterEmail: list.submitterEmail,
    deskNotes: list.deskNotes,
    instructions: list.instructions,
    createdAt: list.createdAt,
    stayCheckIn: block.checkIn,
    stayCheckOut: block.checkOut,
    rows,
    counts: {
      total: rows.length,
      pending: rows.filter((row: any) => row.status === "PENDING").length,
      accepted: rows.filter((row: any) => row.status === "ACCEPTED").length,
      rejected: rows.filter((row: any) => row.status === "REJECTED").length,
      confirmed: rows.filter((row: any) => row.reservationId != null).length,
    },
  };
}

const blockInclude = {
  rooms: { include: { roomType: { select: { name: true } } }, orderBy: { id: "asc" as const } },
};

async function loadOwnedBlock(res: Response, ownerId: number, blockId: number) {
  if (!Number.isInteger(blockId) || blockId <= 0) {
    res.status(400).json({ error: "Invalid group block id" });
    return null;
  }
  const block = await prisma.nrmsGroupBlock.findFirst({ where: { id: blockId, ownerId }, include: blockInclude });
  if (!block) {
    res.status(404).json({ error: "Group block not found" });
    return null;
  }
  const active = await loadOwnedActiveNrmsProperty(res, ownerId, block.propertyId);
  if (!active) return null;
  return block;
}

/** Loads the block and its list together, answering for both if either is missing. */
async function loadOwnedList(res: Response, ownerId: number, blockId: number) {
  const block = await loadOwnedBlock(res, ownerId, blockId);
  if (!block) return null;
  const list = await prisma.nrmsRoomingList.findUnique({ where: { blockId: block.id }, include: listInclude });
  if (!list) {
    res.status(404).json({ error: "No rooming list has been started for this block yet", code: "NO_ROOMING_LIST" });
    return null;
  }
  return { block, list };
}

/**
 * POST /blocks/:blockId
 *
 * Starts the list, or issues a fresh token for an existing one. Regenerating is
 * the same operation as creating on purpose: a desk that suspects the old link
 * leaked should not have to decide between revoking and starting over, and the
 * names already collected are kept either way.
 */
router.post("/blocks/:blockId", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid rooming list", details: parsed.error.flatten() });
    const ownerId = req.user!.id;
    const block = await loadOwnedBlock(res, ownerId, Number(req.params.blockId));
    if (!block) return;
    if (!BLOCK_LIVE_STATUSES.includes(block.status)) {
      return res.status(409).json({ error: "This block is no longer holding rooms, so there are no names left to collect", code: "INVALID_STATUS" });
    }

    const data = parsed.data;
    const instructions = data.instructions ? sanitizeText(data.instructions) : null;
    const expiresAt = expiryFrom(data.validDays, block);
    const existing = await prisma.nrmsRoomingList.findUnique({ where: { blockId: block.id } });

    if (existing) {
      await prisma.nrmsRoomingList.update({
        where: { id: existing.id },
        data: {
          publicToken: newToken(),
          expiresAt,
          // A regenerated link is live again, but a list already reviewed keeps
          // the state the desk left it in so its notes still make sense.
          status: existing.status === "REVOKED" || existing.status === "DRAFT" ? "SENT" : existing.status,
          sentAt: new Date(),
          ...(data.instructions !== undefined ? { instructions } : {}),
        },
      });
    } else {
      await prisma.nrmsRoomingList.create({
        data: {
          blockId: block.id,
          publicToken: newToken(),
          status: "SENT",
          expiresAt,
          sentAt: new Date(),
          instructions,
          createdById: ownerId,
        },
      });
    }

    const list = await prisma.nrmsRoomingList.findUnique({ where: { blockId: block.id }, include: listInclude });
    res.status(existing ? 200 : 201).json({ roomingList: formatList(list, block) });
  } catch (err) {
    console.error("[owner.nrms.roomingList] create failed", err);
    res.status(500).json({ error: "Failed to create the rooming list link" });
  }
}) as RequestHandler);

/** GET /blocks/:blockId */
router.get("/blocks/:blockId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const block = await loadOwnedBlock(res, ownerId, Number(req.params.blockId));
    if (!block) return;
    const list = await prisma.nrmsRoomingList.findUnique({ where: { blockId: block.id }, include: listInclude });
    res.json({ roomingList: list ? formatList(list, block) : null });
  } catch (err) {
    console.error("[owner.nrms.roomingList] detail failed", err);
    res.status(500).json({ error: "Failed to load the rooming list" });
  }
}) as RequestHandler);

/**
 * POST /blocks/:blockId/revoke
 *
 * Kills the link. Names already collected stay, because they are the desk's
 * record of what the agency asked for, not the agency's property.
 */
router.post("/blocks/:blockId/revoke", (async (req: AuthedRequest, res: Response) => {
  try {
    const loaded = await loadOwnedList(res, req.user!.id, Number(req.params.blockId));
    if (!loaded) return;
    if (loaded.list.status === "REVOKED") return res.status(409).json({ error: "This link is already revoked", code: "INVALID_STATUS" });
    await prisma.nrmsRoomingList.update({
      where: { id: loaded.list.id },
      // The token is replaced as well as the status: a revoked credential that
      // still exists in the database is one bug away from working again.
      data: { status: "REVOKED", publicToken: newToken() },
    });
    const list = await prisma.nrmsRoomingList.findUnique({ where: { id: loaded.list.id }, include: listInclude });
    res.json({ roomingList: formatList(list, loaded.block) });
  } catch (err) {
    console.error("[owner.nrms.roomingList] revoke failed", err);
    res.status(500).json({ error: "Failed to revoke the rooming list link" });
  }
}) as RequestHandler);

/**
 * POST /blocks/:blockId/rows/:rowId/accept
 *
 * Accepting is the desk saying this person is good to arrive. It creates
 * nothing: the stay only exists once the desk confirms.
 */
router.post("/blocks/:blockId/rows/:rowId/accept", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = acceptSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid update", details: parsed.error.flatten() });
    const ownerId = req.user!.id;
    const loaded = await loadOwnedList(res, ownerId, Number(req.params.blockId));
    if (!loaded) return;
    const row = loaded.list.rows.find((item: any) => item.id === Number(req.params.rowId));
    if (!row) return res.status(404).json({ error: "That name is not on this rooming list" });
    if (row.reservationId != null) return res.status(409).json({ error: "A stay already exists for this guest", code: "ROW_ALREADY_CONFIRMED" });

    const blockRoomId = parsed.data.blockRoomId ?? row.blockRoomId;
    if (blockRoomId != null && !loaded.block.rooms.some((line: any) => line.id === blockRoomId)) {
      return res.status(400).json({ error: "That room type is not part of this block" });
    }

    await prisma.nrmsRoomingListRow.update({
      where: { id: row.id },
      data: { status: "ACCEPTED", rejectionReason: null, blockRoomId: blockRoomId ?? null },
    });
    await prisma.nrmsRoomingList.update({ where: { id: loaded.list.id }, data: { reviewedAt: new Date(), reviewedById: ownerId } });
    const list = await prisma.nrmsRoomingList.findUnique({ where: { id: loaded.list.id }, include: listInclude });
    res.json({ roomingList: formatList(list, loaded.block) });
  } catch (err) {
    console.error("[owner.nrms.roomingList] accept row failed", err);
    res.status(500).json({ error: "Failed to accept this name" });
  }
}) as RequestHandler);

/** POST /blocks/:blockId/rows/:rowId/reject */
router.post("/blocks/:blockId/rows/:rowId/reject", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = rejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Say why the name was sent back so the agency can fix it", details: parsed.error.flatten() });
    const ownerId = req.user!.id;
    const loaded = await loadOwnedList(res, ownerId, Number(req.params.blockId));
    if (!loaded) return;
    const row = loaded.list.rows.find((item: any) => item.id === Number(req.params.rowId));
    if (!row) return res.status(404).json({ error: "That name is not on this rooming list" });
    if (row.reservationId != null) {
      return res.status(409).json({
        error: "A stay already exists for this guest, so it cannot be rejected here. Cancel the reservation instead.",
        code: "ROW_ALREADY_CONFIRMED",
      });
    }

    await prisma.nrmsRoomingListRow.update({
      where: { id: row.id },
      data: { status: "REJECTED", rejectionReason: sanitizeText(parsed.data.rejectionReason) },
    });
    await prisma.nrmsRoomingList.update({ where: { id: loaded.list.id }, data: { reviewedAt: new Date(), reviewedById: ownerId } });
    const list = await prisma.nrmsRoomingList.findUnique({ where: { id: loaded.list.id }, include: listInclude });
    res.json({ roomingList: formatList(list, loaded.block) });
  } catch (err) {
    console.error("[owner.nrms.roomingList] reject row failed", err);
    res.status(500).json({ error: "Failed to send this name back" });
  }
}) as RequestHandler);

/**
 * POST /blocks/:blockId/return
 *
 * Hands the list back to the agency with a note. The link starts working again
 * for editing, which is the whole point: nobody should have to email a
 * spreadsheet back and forth to fix one passport spelling.
 */
router.post("/blocks/:blockId/return", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = returnSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Write a note telling the agency what to fix", details: parsed.error.flatten() });
    const ownerId = req.user!.id;
    const loaded = await loadOwnedList(res, ownerId, Number(req.params.blockId));
    if (!loaded) return;
    if (loaded.list.status === "REVOKED") return res.status(409).json({ error: "This link is revoked. Issue a new one before sending the list back.", code: "INVALID_STATUS" });

    const expired = new Date(loaded.list.expiresAt).getTime() <= Date.now();
    await prisma.nrmsRoomingList.update({
      where: { id: loaded.list.id },
      data: {
        status: "RETURNED",
        deskNotes: sanitizeText(parsed.data.deskNotes),
        reviewedAt: new Date(),
        reviewedById: ownerId,
        // Sending a list back through a dead link would be sending it nowhere.
        ...(expired ? { expiresAt: expiryFrom(undefined, loaded.block) } : {}),
      },
    });
    const list = await prisma.nrmsRoomingList.findUnique({ where: { id: loaded.list.id }, include: listInclude });
    res.json({ roomingList: formatList(list, loaded.block) });
  } catch (err) {
    console.error("[owner.nrms.roomingList] return failed", err);
    res.status(500).json({ error: "Failed to send the list back to the agency" });
  }
}) as RequestHandler);

/**
 * POST /blocks/:blockId/confirm
 *
 * Turns every accepted name into a real stay. Each row goes through the same
 * pickup path the desk uses when it names a guest by hand, one transaction per
 * row, so a row that cannot be picked up reports why and leaves the rest of the
 * party confirmed rather than failing the whole list.
 */
router.post("/blocks/:blockId/confirm", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const loaded = await loadOwnedList(res, ownerId, Number(req.params.blockId));
    if (!loaded) return;
    const { block } = loaded;
    if (!BLOCK_LIVE_STATUSES.includes(block.status)) {
      return res.status(409).json({ error: "This block is no longer holding rooms", code: "INVALID_STATUS" });
    }

    const pending = loaded.list.rows.filter((row: any) => row.status === "ACCEPTED" && row.reservationId == null);
    if (!pending.length) return res.status(409).json({ error: "There are no accepted names waiting to be confirmed", code: "NOTHING_TO_CONFIRM" });

    const confirmed: Array<{ rowId: number; reservationId: number }> = [];
    const failed: Array<{ rowId: number; fullName: string; error: string; code: string }> = [];

    for (const row of pending) {
      if (row.blockRoomId == null) {
        failed.push({ rowId: row.id, fullName: row.fullName, error: "Choose which room type this guest takes before confirming", code: "NO_ROOM_TYPE" });
        continue;
      }
      const guest = await resolveGroupGuestProfile(block.propertyId, ownerId, {
        fullName: row.fullName,
        phone: row.phone,
        email: row.email,
        nationality: row.nationality,
      });
      if ("error" in guest) {
        failed.push({ rowId: row.id, fullName: row.fullName, error: "Guest details could not be saved", code: "GUEST_NOT_FOUND" });
        continue;
      }

      try {
        const outcome = await runBlockPickup({
          blockId: block.id,
          ownerId,
          blockRoomId: row.blockRoomId,
          guestProfileId: guest.guestProfileId,
          adults: row.adults,
          children: row.children,
          notes: row.notes ?? null,
          roomingListRowId: row.id,
          actorId: ownerId,
        });
        if ("error" in outcome) {
          const body = pickupErrorBody(outcome as { error: PickupErrorCode });
          failed.push({ rowId: row.id, fullName: row.fullName, error: body.error, code: body.code });
          // A block that stopped holding rooms will fail identically for every
          // remaining row, so stop instead of reporting the same line 19 times.
          if (outcome.error === "BLOCK_NOT_LIVE" || outcome.error === "BLOCK_NOT_FOUND") break;
          continue;
        }
        confirmed.push({ rowId: row.id, reservationId: outcome.reservationId });
      } catch (err) {
        // Each row committed in its own transaction, so throwing here would
        // answer 500 and lose the record of the guests that were already
        // booked. Every failure is reported against its row instead.
        if (err instanceof Error && err.message === PICKUP_RACE) {
          failed.push({ rowId: row.id, fullName: row.fullName, error: "Another room from this block was named at the same time. Try again.", code: "PICKUP_RACE" });
          continue;
        }
        console.error("[owner.nrms.roomingList] confirm row failed", { rowId: row.id, blockId: block.id }, err);
        failed.push({ rowId: row.id, fullName: row.fullName, error: "This guest could not be booked. Try again, and tell support if it keeps failing.", code: "PICKUP_FAILED" });
      }
    }

    // The list is finished only when nothing is left waiting: a rejected name
    // the agency may still fix keeps it open.
    const after = await prisma.nrmsRoomingList.findUnique({ where: { id: loaded.list.id }, include: listInclude });
    const outstanding = (after?.rows ?? []).some((row: any) => row.reservationId == null && row.status !== "REJECTED");
    if (after && !outstanding && after.status !== "CONFIRMED") {
      await prisma.nrmsRoomingList.update({ where: { id: after.id }, data: { status: "CONFIRMED", reviewedAt: new Date(), reviewedById: ownerId } });
    }

    const list = await prisma.nrmsRoomingList.findUnique({ where: { id: loaded.list.id }, include: listInclude });
    const updatedBlock = await prisma.nrmsGroupBlock.findUnique({ where: { id: block.id }, include: blockInclude });
    res.status(confirmed.length ? 200 : 409).json({
      roomingList: list ? formatList(list, block) : null,
      confirmed,
      failed,
      blockStatus: updatedBlock?.status ?? block.status,
    });
  } catch (err) {
    console.error("[owner.nrms.roomingList] confirm failed", err);
    res.status(500).json({ error: "Failed to confirm the rooming list" });
  }
}) as RequestHandler);

export default router;
