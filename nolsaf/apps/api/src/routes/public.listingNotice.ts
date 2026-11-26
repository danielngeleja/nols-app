/**
 * The owner's "Not expecting this?" link from an assisted listing SMS
 * (docs/SALES_ASSISTED_LISTING.md, section 6).
 *
 * GET  /api/public/listing-notice/:token          what is being listed and by whom
 * POST /api/public/listing-notice/:token/object   pause the listing and alert NoLSAF
 * POST /api/public/listing-notice/:token/confirm-rent  agree the long-stay rent shown
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
import { confirmOwnerRentByToken, findByNoticeToken, isNoticeToken, ownerRentState, recordObjection } from "../lib/salesAssistedListing.js";

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
  // Long stay: the money terms the owner is asked to confirm (section 15.1).
  const rent = await ownerRentState(row.propertyId).catch(() => null);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  return res.json({
    propertyTitle: row.property?.title ?? null,
    partnerName: row.salesPartner?.user?.fullName || row.salesPartner?.user?.name || null,
    partnerCode: row.salesPartner?.agentCode ?? null,
    paused: row.status === "PAUSED_OBJECTION",
    closed: row.status === "CANCELLED",
    rent: rent ? { lines: rent.lines, confirmed: rent.confirmed, version: rent.fingerprint } : null,
  });
}) as RequestHandler);

const confirmRentSchema = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

/** POST /api/public/listing-notice/:token/confirm-rent { version }: the owner agrees the long-stay rent shown. */
publicListingNoticeRouter.post("/:token/confirm-rent", limitAssistedListingNotice as any, asyncHandler(async (req, res: Response) => {
  const token = String(req.params.token || "");
  if (!isNoticeToken(token)) return res.status(404).json(NOT_FOUND);
  const parsed = confirmRentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Reload the page and try again." });
  const outcome = await confirmOwnerRentByToken(token, parsed.data.version);
  if (outcome === "NOT_FOUND") return res.status(404).json(NOT_FOUND);
  if (outcome === "CHANGED") return res.status(409).json({ error: "The rent was changed since you opened this page. Check the new terms and confirm again.", code: "CHANGED" });
  if (outcome === "CLOSED") return res.status(409).json({ error: "This listing is paused or withdrawn. NoLSAF will call you." });
  return res.json({ ok: true, confirmed: outcome !== "NOT_NEEDED" });
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
