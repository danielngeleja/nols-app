// apps/api/src/routes/public.nrmsRoomingList.ts
//
// The agency side of the rooming list. One capability link, no account, no
// password: the tour operator opens it, types who is staying, and sends it.
//
// Nothing here touches inventory or creates a reservation. Rows are staging
// text until a member of staff accepts them and confirms, which is what stops
// an agency submitting at midnight from overselling the property. The token is
// a bearer credential and is served exactly like the guest payment link:
// no-store, no-referrer, noindex.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { sanitizeText } from "../lib/sanitize.js";
import { limitPublicNrmsGuestCapability, limitPublicNrmsRoomingListSubmit } from "../middleware/rateLimit.js";

export const router = Router();

const capabilityResponseHeaders: RequestHandler = (_req, res, next) => {
  // Capability URLs are bearer credentials. Keep them out of browser/CDN
  // caches and prevent the full URL leaking in an outbound Referer header.
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
};

router.use("/:token", capabilityResponseHeaders);

/** Statuses in which the agency may still open and fill the link. */
const OPEN_STATUSES = ["DRAFT", "SENT", "SUBMITTED", "RETURNED"];

// Every message here is written to be shown to the agency as-is. A person
// filling twenty names needs to know which line is wrong, not that "the request
// was invalid", so nothing in this schema falls back to a zod default.
const rowSchema = z.object({
  blockRoomId: z.number().int().positive("Choose a room from the list").nullable().optional(),
  fullName: z.string().trim().min(2, "Enter the guest's full name").max(160, "That name is too long"),
  // Phone and nationality are how the desk reaches a guest and how it fills
  // immigration paperwork on arrival, so unlike email they are not optional.
  phone: z.string().trim().min(7, "Enter a phone number of at least 7 digits").max(40, "That phone number is too long"),
  email: z.string().trim().email("Enter a valid email address or leave it blank").max(160, "That email address is too long").nullable().optional(),
  nationality: z.string().trim().min(2, "Enter the guest's nationality").max(80, "That nationality is too long"),
  adults: z.number().int().min(1, "At least one adult per room").max(20, "That is too many adults for one room").default(1),
  children: z.number().int().min(0, "Children cannot be negative").max(20, "That is too many children for one room").default(0),
  sharingWith: z.string().trim().max(160, "That is too long").nullable().optional(),
  notes: z.string().trim().max(1000, "That note is too long").nullable().optional(),
});

const submitSchema = z.object({
  submitterName: z.string().trim().min(2, "Enter your name so the desk knows who sent this list").max(160, "That name is too long"),
  submitterEmail: z.string().trim().email("Enter a valid email address or leave it blank").max(160, "That email address is too long").nullable().optional(),
  rows: z.array(rowSchema).min(1, "Add at least one guest").max(200, "A single list cannot carry more than 200 guests"),
});

/**
 * Turns a zod failure into something the agency can act on: which guest line
 * broke, which field, and what to do about it. Without the row index a list of
 * twenty names gives no clue where the problem is.
 */
function submissionIssues(error: z.ZodError) {
  const rows: Array<{ rowIndex: number; field: string; message: string }> = [];
  const form: Array<{ field: string; message: string }> = [];
  for (const issue of error.issues) {
    const [head, second, third] = issue.path;
    if (head === "rows" && typeof second === "number" && typeof third === "string") {
      rows.push({ rowIndex: second, field: third, message: issue.message });
    } else if (typeof head === "string") {
      form.push({ field: head, message: issue.message });
    }
  }
  const first = form[0]
    ? form[0].message
    : rows[0]
      ? `Guest ${rows[0].rowIndex + 1}: ${rows[0].message}`
      : "Check the details and try again";
  return { error: first, code: "INVALID_SUBMISSION" as const, rowIssues: rows, formIssues: form };
}

const listInclude = {
  rows: { orderBy: { id: "asc" as const } },
  block: {
    include: {
      rooms: { include: { roomType: { select: { name: true } } }, orderBy: { id: "asc" as const } },
      property: { select: { title: true } },
    },
  },
};

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * What the agency is allowed to see: the stay, how many rooms of each type are
 * expected, and their own names back. Rates, other guests, contact details of
 * the desk's other business and anything else on the block stay behind.
 */
function publicView(list: any) {
  const block = list.block;
  const stayNights = Math.max(1, Math.round((utcDay(block.checkOut).getTime() - utcDay(block.checkIn).getTime()) / 86_400_000));
  const rows = (list.rows ?? []).map((row: any) => ({
    id: row.id,
    blockRoomId: row.blockRoomId,
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
    // Locked exactly where the submit handler keeps the row: a name the desk
    // accepted or already turned into a stay survives a resubmission, so
    // letting the agency retype it would only duplicate it.
    locked: row.reservationId != null || row.status === "ACCEPTED",
  }));
  return {
    status: list.status,
    expiresAt: list.expiresAt,
    instructions: list.instructions,
    deskNotes: list.status === "RETURNED" ? list.deskNotes : null,
    submittedAt: list.submittedAt,
    submitterName: list.submitterName,
    submitterEmail: list.submitterEmail,
    property: block.property?.title ?? "The property",
    block: {
      name: block.name,
      reference: block.reference,
      agencyName: block.agencyName,
      checkIn: block.checkIn,
      checkOut: block.checkOut,
      nights: stayNights,
      namesDueBy: block.cutOffAt,
    },
    roomTypes: (block.rooms ?? []).map((line: any) => ({
      blockRoomId: line.id,
      roomTypeName: line.roomType?.name ?? "Room",
      quantity: line.quantity,
      // How many names this line still needs, which is the only number the
      // agency has to act on.
      remaining: Math.max(0, line.quantity - line.pickedUp),
    })),
    rows,
  };
}

/** Every failure looks the same from outside, so a token cannot be probed. */
function notFound(res: Response) {
  return res.status(404).json({ error: "This rooming list link is not available. Ask the property for a new one." });
}

router.get("/:token", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  try {
    const list = await prisma.nrmsRoomingList.findUnique({ where: { publicToken: req.params.token }, include: listInclude });
    if (!list || list.status === "REVOKED") return notFound(res);
    if (new Date(list.expiresAt).getTime() <= Date.now()) {
      return res.status(410).json({ error: "This rooming list link has expired. Ask the property to send a new one.", code: "EXPIRED" });
    }
    if (list.status === "CONFIRMED") {
      return res.json({ roomingList: publicView(list), readOnly: true });
    }
    if (!OPEN_STATUSES.includes(list.status)) return notFound(res);
    res.json({ roomingList: publicView(list), readOnly: false });
  } catch (error) {
    console.error("[public.nrms.roomingList] load failed", error);
    res.status(500).json({ error: "The rooming list could not be loaded" });
  }
}) as RequestHandler);

/**
 * POST /:token
 *
 * Replaces the names still in play and marks the list submitted. Rows the desk
 * already accepted or turned into stays are left alone: a resubmission is the
 * agency fixing what was sent back, not permission to rewrite history.
 */
router.post("/:token", limitPublicNrmsRoomingListSubmit as RequestHandler, (async (req, res: Response) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(submissionIssues(parsed.error));
  try {
    const list = await prisma.nrmsRoomingList.findUnique({ where: { publicToken: req.params.token }, include: listInclude });
    if (!list || list.status === "REVOKED") return notFound(res);
    if (new Date(list.expiresAt).getTime() <= Date.now()) {
      return res.status(410).json({ error: "This rooming list link has expired. Ask the property to send a new one.", code: "EXPIRED" });
    }
    if (list.status === "CONFIRMED") {
      return res.status(409).json({ error: "The property has already confirmed this list. Contact them to change a name.", code: "ALREADY_CONFIRMED" });
    }
    if (!OPEN_STATUSES.includes(list.status)) return notFound(res);

    const lineIds = new Set((list.block.rooms ?? []).map((line: any) => line.id));
    const data = parsed.data;
    for (const row of data.rows) {
      if (row.blockRoomId != null && !lineIds.has(row.blockRoomId)) {
        return res.status(400).json({ error: "One of the rooms chosen is not part of this booking. Reload the page and try again." });
      }
    }

    const keptIds = list.rows.filter((row: any) => row.reservationId != null || row.status === "ACCEPTED").map((row: any) => row.id);

    await prisma.$transaction(async (tx: any) => {
      await tx.nrmsRoomingListRow.deleteMany({ where: { roomingListId: list.id, id: { notIn: keptIds.length ? keptIds : [0] } } });
      await tx.nrmsRoomingListRow.createMany({
        data: data.rows.map((row) => ({
          roomingListId: list.id,
          blockRoomId: row.blockRoomId ?? null,
          fullName: sanitizeText(row.fullName),
          phone: row.phone ? sanitizeText(row.phone) : null,
          email: row.email ? sanitizeText(row.email) : null,
          nationality: row.nationality ? sanitizeText(row.nationality) : null,
          adults: row.adults,
          children: row.children,
          sharingWith: row.sharingWith ? sanitizeText(row.sharingWith) : null,
          notes: row.notes ? sanitizeText(row.notes) : null,
          status: "PENDING",
        })),
      });
      await tx.nrmsRoomingList.update({
        where: { id: list.id },
        data: {
          status: "SUBMITTED",
          submittedAt: new Date(),
          submitterName: sanitizeText(data.submitterName),
          submitterEmail: data.submitterEmail ? sanitizeText(data.submitterEmail) : null,
          // The note that came with the send-back has been answered by this
          // submission, so it stops being shown as an outstanding request.
          deskNotes: null,
        },
      });
    });

    const saved = await prisma.nrmsRoomingList.findUnique({ where: { id: list.id }, include: listInclude });
    res.json({ roomingList: saved ? publicView(saved) : null, readOnly: false });
  } catch (error) {
    console.error("[public.nrms.roomingList] submit failed", error);
    res.status(500).json({ error: "The rooming list could not be submitted" });
  }
}) as RequestHandler);

export default router;
