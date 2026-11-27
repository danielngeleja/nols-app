/**
 * Agency Desk quote and pay request, partner side (docs/SALES_AGENCY_QUOTES_STRATEGY.md).
 *
 * POST /api/sales/agency/search                 a client's need -> ready / close / own leads (+ demand signal)
 * POST /api/sales/agency/quotes                 create and text 1 to 3 options to the client
 * GET  /api/sales/agency/quotes                 own quotes with live status
 * GET  /api/sales/agency/quotes/:ref            one quote
 * POST /api/sales/agency/quotes/:ref/resend     new link by SMS (the old link stops working)
 * POST /api/sales/agency/quotes/:ref/cancel
 *
 * Every route answers 404 unless the session's partner holds the Agency Desk.
 * Prices always come from the server (lib/stayPrice.ts); the partner never sets one.
 */
import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { partnerIdFor, requireWorkspaceAccess, type SalesAuthedRequest } from "../middleware/salesWorkspace.js";
import { limitSalesLeadRead, limitSalesLeadWrite } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { sendSms } from "../lib/sms.js";
import { agencyGateFailure, loadAgencyGateInput, maskClientPhone } from "../lib/salesAgency.js";
import {
  NEED_FEATURES,
  QUOTE_DEFAULT_HOURS,
  QUOTE_MAX_HOURS,
  QUOTE_MAX_OPTIONS,
  QuoteError,
  assertCanQuote,
  effectiveQuoteStatus,
  isoDay,
  newQuoteRef,
  newQuoteToken,
  quoteOption,
  searchByNeed,
} from "../lib/salesAgencyQuotes.js";

const router = Router();
const db = prisma as any;
const NOT_FOUND = { error: "Not found" };

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"));

function webOrigin(): string {
  const candidate = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.APP_URL || "https://www.nolsaf.com";
  try { return new URL(candidate).origin; } catch { return "https://www.nolsaf.com"; }
}
export function quoteUrl(rawToken: string): string {
  return `${webOrigin()}/q/${encodeURIComponent(rawToken)}`;
}

function requireAgencyDesk(): RequestHandler {
  return (async (req: SalesAuthedRequest & { agency?: any }, res: Response, next: NextFunction) => {
    const partnerId = partnerIdFor(req);
    if (!partnerId) return res.status(404).json(NOT_FOUND);
    const gate = await loadAgencyGateInput(db, partnerId);
    if (agencyGateFailure(gate)) return res.status(404).json(NOT_FOUND);
    req.agency = gate.capabilityRow;
    return next();
  }) as RequestHandler;
}

function sendQuoteError(res: Response, error: unknown): boolean {
  if (error instanceof QuoteError) { res.status(error.status).json({ error: error.message }); return true; }
  if ((error as any)?.code === "P2021") { res.status(503).json({ error: "Quotes need a database update first." }); return true; }
  return false;
}

const eat = (d: Date) => `${d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" })} EAT`;

// ---------- Search by need ----------

const searchSchema = z.object({
  people: z.number().int().min(1).max(500),
  checkIn: z.string().trim().max(10).nullish(),
  checkOut: z.string().trim().max(10).nullish(),
  dayUse: z.boolean().optional(),
  wholePlace: z.boolean().optional(),
  features: z.array(z.enum(Object.keys(NEED_FEATURES) as [keyof typeof NEED_FEATURES, ...Array<keyof typeof NEED_FEATURES>])).max(8).optional(),
  area: z.string().trim().max(120).nullish(),
  budgetTzs: z.number().int().min(0).max(1_000_000_000).nullish(),
}).strict();

router.post("/agency/search", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const parsed = searchSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the client's need", details: parsed.error.issues });
  try {
    const result = await searchByNeed(db, req.agency.salesPartnerId, { ...parsed.data, area: parsed.data.area ? sanitizeText(parsed.data.area) : null });
    res.setHeader("Cache-Control", "no-store");
    return res.json(result);
  } catch (error) {
    if (sendQuoteError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

// ---------- Quotes ----------

const optionSchema = z.object({
  propertyRef: z.string().trim().min(3).max(80),
  roomCode: z.string().trim().max(60).nullish(),
  rooms: z.number().int().min(1).max(20),
  checkIn: z.string().trim().max(10),
  checkOut: z.string().trim().max(10),
  adults: z.number().int().min(1).max(100),
  children: z.number().int().min(0).max(100).optional(),
}).strict();

const createSchema = z.object({
  clientName: z.string().trim().min(2).max(160),
  clientPhone: z.string().trim().min(9).max(40),
  clientEmail: z.string().trim().email().max(190).nullish(),
  note: z.string().trim().max(500).nullish(),
  expiresInHours: z.number().int().min(1).max(QUOTE_MAX_HOURS).optional(),
  options: z.array(optionSchema).min(1).max(QUOTE_MAX_OPTIONS),
}).strict();

async function partnerName(salesPartnerId: number): Promise<string> {
  const p = await db.salesPartnerProfile.findUnique({ where: { id: salesPartnerId }, select: { agentCode: true, user: { select: { name: true, fullName: true } } } });
  return p?.user?.fullName || p?.user?.name || p?.agentCode || "Your NoLSAF sales partner";
}

function quoteSms(clientName: string, partner: string, link: string, expiresAt: Date) {
  const first = String(clientName).trim().split(/\s+/)[0] || "there";
  return `Habari ${first}. ${partner} from NoLSAF prepared your stay options: ${link} Pay NoLSAF only on that page. Valid until ${eat(expiresAt)}.`;
}

function serializeQuote(q: any, bookingStatus: string | null, now = new Date()) {
  return {
    ref: q.publicRef,
    status: effectiveQuoteStatus(q, bookingStatus, now),
    clientName: q.clientName,
    clientPhone: maskClientPhone(q.clientPhone),
    note: q.note,
    expiresAt: q.expiresAt,
    sentAt: q.sentAt,
    viewedAt: q.viewedAt,
    payingAt: q.payingAt,
    createdAt: q.createdAt,
    chosenPosition: q.options?.find((o: any) => o.id === q.chosenOptionId)?.position ?? null,
    options: (q.options ?? []).sort((a: any, b: any) => a.position - b.position).map((o: any) => ({
      position: o.position,
      title: o.priceSnapshot?.title ?? "Property",
      roomLabel: o.priceSnapshot?.roomLabel ?? null,
      rooms: o.rooms,
      checkIn: isoDay(new Date(o.checkIn)),
      checkOut: isoDay(new Date(o.checkOut)),
      nights: o.nights,
      adults: o.adults,
      children: o.children,
      total: Number(o.totalPrice),
      currency: o.currency,
    })),
  };
}

router.post("/agency/quotes", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the quote details", details: parsed.error.issues });
  const input = parsed.data;
  const partnerId = req.agency.salesPartnerId;
  const now = new Date();
  try {
    const phoneNormalized = await assertCanQuote(db, partnerId, input.clientPhone, now);
    // Every option re-priced and re-checked on the server.
    const options: Array<Awaited<ReturnType<typeof quoteOption>>> = [];
    for (const option of input.options) options.push(await quoteOption(db, { ...option, roomCode: option.roomCode ?? null }, now));
    const latestCheckIn = Math.min(...options.map((o) => o.checkIn.getTime()));
    const expiresAt = new Date(Math.min(now.getTime() + (input.expiresInHours ?? QUOTE_DEFAULT_HOURS) * 3_600_000, latestCheckIn + 12 * 3_600_000));
    const token = newQuoteToken();
    const quote = await db.salesQuote.create({
      data: {
        publicRef: newQuoteRef(),
        salesPartnerId: partnerId,
        clientName: sanitizeText(input.clientName).slice(0, 160),
        clientPhone: sanitizeText(input.clientPhone).slice(0, 40),
        clientPhoneNormalized: phoneNormalized,
        clientEmail: input.clientEmail ? input.clientEmail.toLowerCase() : null,
        note: input.note ? sanitizeText(input.note).slice(0, 500) : null,
        status: "SENT",
        tokenHash: token.hash,
        expiresAt,
        sentAt: now,
        options: {
          create: options.map((o, index) => ({
            position: index + 1,
            propertyId: o.property.id,
            roomCode: o.priced.roomCode,
            rooms: o.rooms,
            checkIn: o.checkIn,
            checkOut: o.checkOut,
            adults: o.adults,
            children: o.children,
            nights: o.priced.nights,
            currency: o.priced.currency,
            totalPrice: o.priced.total,
            priceSnapshot: {
              title: o.property.title,
              roomLabel: o.priced.roomLabel,
              nightlyNet: o.priced.nightlyNet,
              commissionPercent: o.priced.commissionPercent,
              total: o.priced.total,
              pricedAt: now.toISOString(),
            },
          })),
        },
      },
      include: { options: true },
    });
    const partner = await partnerName(partnerId);
    const sms = await sendSms(input.clientPhone, quoteSms(input.clientName, partner, quoteUrl(token.raw), expiresAt), { bypassEligibilityCheck: true }).catch(() => null);
    await audit(req, "SALES_AGENCY_QUOTE_CREATE", "SALES_PARTNER", null, { ref: quote.publicRef, options: options.length, smsSent: Boolean(sms?.success) }, partnerId);
    return res.status(201).json({
      quote: serializeQuote(quote, null, now),
      smsSent: Boolean(sms?.success && sms.provider !== "suppressed"),
      // Shown once so the partner can also share it on WhatsApp; never stored.
      link: quoteUrl(token.raw),
    });
  } catch (error) {
    if (sendQuoteError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

async function bookingStatuses(quotes: any[]): Promise<Map<number, string>> {
  const ids = quotes.map((q) => q.bookingId).filter((id): id is number => Number.isInteger(id));
  if (!ids.length) return new Map();
  const rows = await db.booking.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  return new Map(rows.map((r: any) => [r.id, String(r.status)]));
}

router.get("/agency/quotes", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  try {
    const quotes = await db.salesQuote.findMany({
      where: { salesPartnerId: req.agency.salesPartnerId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { options: true },
    });
    const statuses = await bookingStatuses(quotes);
    const now = new Date();
    const items = quotes.map((q: any) => serializeQuote(q, q.bookingId ? statuses.get(q.bookingId) ?? null : null, now));
    const count = (s: string) => items.filter((i: any) => i.status === s).length;
    res.setHeader("Cache-Control", "no-store");
    return res.json({ quotes: items, counts: { open: items.filter((i: any) => ["SENT", "VIEWED", "PAYING"].includes(i.status)).length, paid: count("PAID"), expired: count("EXPIRED") } });
  } catch (error) {
    if (sendQuoteError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

async function ownQuote(req: any) {
  const ref = String(req.params.ref || "");
  if (!/^qt_[a-z0-9]{10}$/.test(ref)) return null;
  return db.salesQuote.findFirst({ where: { publicRef: ref, salesPartnerId: req.agency.salesPartnerId }, include: { options: true } });
}

router.get("/agency/quotes/:ref", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const quote = await ownQuote(req);
  if (!quote) return res.status(404).json(NOT_FOUND);
  const statuses = await bookingStatuses([quote]);
  return res.json({ quote: serializeQuote(quote, quote.bookingId ? statuses.get(quote.bookingId) ?? null : null) });
}) as RequestHandler);

router.post("/agency/quotes/:ref/resend", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const quote = await ownQuote(req);
  if (!quote) return res.status(404).json(NOT_FOUND);
  const statuses = await bookingStatuses([quote]);
  const status = effectiveQuoteStatus(quote, quote.bookingId ? statuses.get(quote.bookingId) ?? null : null);
  if (!["SENT", "VIEWED", "PAYING"].includes(status)) return res.status(409).json({ error: `This quote is ${status.toLowerCase()}. Send a new one.` });
  // Only the hash is kept, so a resend issues a new link; the old one stops working.
  const token = newQuoteToken();
  await db.salesQuote.update({ where: { id: quote.id }, data: { tokenHash: token.hash, sentAt: new Date() } });
  const sms = await sendSms(quote.clientPhone, quoteSms(quote.clientName, await partnerName(quote.salesPartnerId), quoteUrl(token.raw), quote.expiresAt), { bypassEligibilityCheck: true }).catch(() => null);
  await audit(req, "SALES_AGENCY_QUOTE_RESEND", "SALES_PARTNER", null, { ref: quote.publicRef }, quote.salesPartnerId);
  return res.json({ ok: true, smsSent: Boolean(sms?.success && sms.provider !== "suppressed"), link: quoteUrl(token.raw) });
}) as RequestHandler);

router.post("/agency/quotes/:ref/cancel", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const quote = await ownQuote(req);
  if (!quote) return res.status(404).json(NOT_FOUND);
  const statuses = await bookingStatuses([quote]);
  if (effectiveQuoteStatus(quote, quote.bookingId ? statuses.get(quote.bookingId) ?? null : null) === "PAID") {
    return res.status(409).json({ error: "This quote is paid. Cancelling the stay goes through NoLSAF support." });
  }
  await db.salesQuote.update({ where: { id: quote.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await audit(req, "SALES_AGENCY_QUOTE_CANCEL", "SALES_PARTNER", null, { ref: quote.publicRef }, quote.salesPartnerId);
  return res.json({ ok: true });
}) as RequestHandler);

export default router;
