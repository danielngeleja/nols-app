/**
 * The owner's "Not expecting this?" link from an assisted listing SMS
 * (docs/SALES_ASSISTED_LISTING.md, section 6).
 *
 * GET  /api/public/listing-notice/:token          what is being listed and by whom
 * POST /api/public/listing-notice/:token/object   pause the listing and alert NoLSAF
 *
 * No sign-in: the link only ever goes to the owner's phone, and objecting can
 * only pause a listing, never publish, change or delete anything. The token is
 * random; only its hash is stored. Responses carry no owner contact details.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitAssistedListingNotice } from "../middleware/rateLimit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { findByNoticeToken, isNoticeToken, recordObjection } from "../lib/salesAssistedListing.js";

export const publicListingNoticeRouter = Router();

const NOT_FOUND = { error: "This link is not valid any more. If something is wrong, call NoLSAF support." };
// A pause needs a stated reason: a bare tap must not be able to take a listing off sale.
const objectSchema = z.object({
  note: z.string().trim().min(3).max(500),
}).strict();

publicListingNoticeRouter.get("/:token", limitAssistedListingNotice as any, asyncHandler(async (req, res: Response) => {
  const token = String(req.params.token || "");
  if (!isNoticeToken(token)) return res.status(404).json(NOT_FOUND);
  const row = await findByNoticeToken(token);
  if (!row) return res.status(404).json(NOT_FOUND);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  return res.json({
    propertyTitle: row.property?.title ?? null,
    partnerName: row.salesPartner?.user?.fullName || row.salesPartner?.user?.name || null,
    partnerCode: row.salesPartner?.agentCode ?? null,
    paused: row.status === "PAUSED_OBJECTION",
    closed: row.status === "CANCELLED",
  });
}) as RequestHandler);

publicListingNoticeRouter.post("/:token/object", limitAssistedListingNotice as any, asyncHandler(async (req, res: Response) => {
  const token = String(req.params.token || "");
  if (!isNoticeToken(token)) return res.status(404).json(NOT_FOUND);
  const parsed = objectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Tell us what is wrong (under 500 characters)." });
  const note = sanitizeText(parsed.data.note).trim().slice(0, 500);
  if (note.length < 3) return res.status(400).json({ error: "Tell us what is wrong (under 500 characters)." });
  const outcome = await recordObjection(token, note);
  if (outcome === "NOT_FOUND") return res.status(404).json(NOT_FOUND);
  if (outcome === "CLOSED") return res.json({ ok: true, paused: false, closed: true });
  return res.json({ ok: true, paused: true });
}) as RequestHandler);
