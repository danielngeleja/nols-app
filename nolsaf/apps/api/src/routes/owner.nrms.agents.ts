// apps/api/src/routes/owner.nrms.agents.ts
//
// Hotel-side management of approved travel agents (NRMS Agent B2B).
//
// A hotel looks up an existing agency (or, later, invites a new one via the
// step-7 auth flow), attaches it as a per-hotel link with its own commercial
// terms, and approves / rejects / suspends it. The admin-controlled maxAgents
// cap is enforced here; a hotel at its cap must contact NoLSAF to raise it.
//
// Ownership is scoped through loadOwnedActiveNrmsProperty, so a hotel can only
// ever see and change links for a property it owns - the portfolio isolation
// boundary in practice.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { loadOwnedActiveNrmsProperty } from "../lib/nrms.js";
import { audit, auditOrThrow } from "../lib/audit.js";
import { findAgencyMatches } from "../lib/nrmsAgentIdentity.js";
import { adjustRate, money } from "../lib/nrmsRateMath.js";
import { inviteAgentUserInTransaction, signAgentInviteToken } from "../lib/nrmsAgentInvite.js";
import { approveAgentHold, releaseAgentHold } from "../lib/nrmsAgentInventory.js";
import { getPropertyAgentCurrencies } from "../lib/nrmsAgentRates.js";
import { sendMail } from "../lib/mailer.js";
import { notifyUser } from "../lib/notifications.js";
import { getNrmsAgentInviteEmail, getNrmsAgentRequestDeclinedEmail } from "../lib/authEmailTemplates.js";
import { signedAgentTravellerDocumentUrl } from "../lib/nrmsAgentDocuments.js";
import { sanitizeText } from "../lib/sanitize.js";
import { agentInvoiceInclude, agentProFormaSource, ensureAgentMasterFolio } from "../lib/nrmsAgentInvoice.js";
import { createMasterProForma, emailMasterProForma, renderMasterProFormaPdf, serializeProForma } from "../lib/nrmsProForma.js";
import { generatePaymentReceiptPdf } from "../lib/pdfDocuments.js";
import QRCode from "qrcode";
import { buildMasterPaymentReceiptNumber, getMasterFolioTotals, refreshMasterFolioStatus } from "../lib/nrmsMasterFolio.js";
import { emailAgentVoucher } from "../lib/nrmsAgentVoucher.js";
import { describeIncidentalCover } from "../lib/nrmsAgentIncidentals.js";
import { materialiseAgentBookingRooms, repairSplitAgencyBooking, type MaterialiseOutcome } from "../lib/nrmsAgentGroupMaterialise.js";
import {
  attachAgentToProperty,
  authorizeHeldAgentBookingApproval,
  countAgentSeats,
  lockAgentSeatAllocation,
  setAgentLinkStatus,
  setAgentRateAccess,
  updateAgentLinkTerms,
  type LinkTerms,
} from "../lib/nrmsAgentLinks.js";

const webOrigin = () => String(process.env.WEB_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "https://nolsaf.com").replace(/\/$/, "");

class AgentLinkCreationError extends Error {
  constructor(public readonly result: { reason: string; message: string }) {
    super(result.message);
  }
}

export const router = Router();
router.use(requireAuth as RequestHandler);

const termsSchema = z.object({
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/).transform((v) => v.toUpperCase()).optional(),
  paymentTerms: z.enum(["PREPAID"]).optional(), // CREDIT reserved for a later phase
  bookingMode: z.enum(["REQUEST", "INSTANT"]).optional(),
  creditLimit: z.number().min(0).max(1_000_000_000).optional(),
});
const lookupSchema = z.object({
  registrationNo: z.string().trim().max(80).optional(),
  tin: z.string().trim().max(50).optional(),
  contactEmail: z.string().trim().email().max(200).optional(),
});
const attachSchema = z.object({ agentAccountId: z.number().int().positive(), terms: termsSchema.optional() });
const inviteSchema = z.object({
  email: z.string().trim().email().max(200),
  legalName: z.string().trim().min(2).max(200),
  nationality: z.string().trim().min(2).max(80),
  tradingName: z.string().trim().max(200).optional(),
  registrationNo: z.string().trim().max(80).optional(),
  tin: z.string().trim().max(50).optional(),
  contactName: z.string().trim().max(160).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  terms: termsSchema.optional(),
});
const rateAccessSchema = z.object({
  entries: z.array(z.object({ ratePlanId: z.number().int().positive(), roomTypeId: z.number().int().positive().nullable().default(null) })).max(200),
});
const decisionSchema = z.object({ reason: z.string().trim().max(300).optional() });
const manifestReviewSchema = z.object({
  action: z.enum(["VERIFY", "RETURN"]),
  note: z.string().trim().max(1000).optional(),
  guestIssues: z.array(z.object({ guestId: z.number().int().positive(), note: z.string().trim().min(2).max(500) })).max(40).default([]),
}).strict();
const invoiceCreateSchema = z.object({
  discountAmount: z.number().min(0).max(1_000_000_000).default(0),
  discountReason: z.string().trim().max(300).optional(),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.discountAmount > 0 && !value.discountReason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountReason"], message: "Explain the commercial discount" });
});
const invoiceSendSchema = z.object({ email: z.string().trim().email().max(160).optional() }).strict();
const receivedPaymentSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  method: z.enum(["BANK_TRANSFER", "MOBILE_MONEY", "CASH", "CARD", "OTHER"]),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

/** Stable human-facing agent reference, e.g. AGT-000123. */
const agentRef = (id: number) => `AGT-${String(id).padStart(6, "0")}`;

function agencySummary(account: any) {
  return {
    id: account.id,
    reference: agentRef(account.id),
    legalName: account.legalName,
    tradingName: account.tradingName,
    verificationStatus: account.verificationStatus,
    status: account.status,
    activationPending: account.primaryUser ? !account.primaryUser.passwordHash : false,
  };
}

function maskedIdentifier(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length <= 4) return "••••";
  return `${"•".repeat(Math.min(8, text.length - 4))}${text.slice(-4)}`;
}

/** Privacy-minimised agency record for a hotel. Raw KYC remains admin-only. */
function agencyDetail(account: any, shareContact: boolean) {
  const docs = Array.isArray(account.documents) ? account.documents : [];
  return {
    ...agencySummary(account),
    registrationNo: maskedIdentifier(account.registrationNo),
    tin: maskedIdentifier(account.tin),
    licenseNo: maskedIdentifier(account.licenseNo),
    nationality: account.nationality,
    countryCode: account.countryCode,
    contactName: shareContact ? account.contactName : null,
    contactEmail: shareContact ? account.contactEmail : null,
    contactPhone: shareContact ? account.contactPhone : null,
    address: shareContact ? account.address : null,
    documents: docs.map((d: any) => ({ type: d?.type ?? "OTHER", uploadedAt: d?.uploadedAt ?? null })),
    documentCount: docs.length,
    verifiedAt: account.verifiedAt,
    verificationNote: null,
    createdAt: account.createdAt,
  };
}

function linkDto(link: any) {
  return {
    id: link.id,
    status: link.status,
    initiatedBy: link.initiatedBy,
    requestedByUserId: link.requestedByUserId,
    requestedAt: link.requestedAt,
    hotelConsentStatus: link.hotelConsentStatus,
    hotelConsentedAt: link.hotelConsentedAt,
    agentConsentStatus: link.agentConsentStatus,
    agentConsentedAt: link.agentConsentedAt,
    activatedAt: link.activatedAt,
    suspendedAt: link.suspendedAt,
    suspensionAuthority: link.suspensionAuthority,
    terminatedAt: link.terminatedAt,
    terminationReason: link.terminationReason,
    currency: link.currency,
    paymentTerms: link.paymentTerms,
    bookingMode: link.bookingMode,
    creditLimit: Number(link.creditLimit),
    decidedAt: link.decidedAt,
    decisionReason: link.decisionReason,
    agency: link.agentAccount ? agencySummary(link.agentAccount) : null,
    rateAccess: (link.rateAccess ?? []).map((r: any) => ({ ratePlanId: r.ratePlanId, roomTypeId: r.roomTypeId })),
  };
}

// Kept in the legacy DTO for older clients; the invoice workflow has no
// automatic AzamPay/prepay countdown.
const prepayWindowMinutes = 0;

/**
 * Validate an explicit currency against real room/rate compatibility. When a
 * new link omits currency, choose a genuinely sellable default where possible.
 */
async function resolveLinkTerms(propertyId: number, terms?: LinkTerms) {
  const supportedCurrencies = await getPropertyAgentCurrencies(prisma as any, propertyId);
  const requested = terms?.currency?.toUpperCase();
  if (requested && !supportedCurrencies.includes(requested)) {
    return {
      ok: false as const,
      supportedCurrencies,
      message: supportedCurrencies.length
        ? `${requested} cannot be used for agent bookings because this property has no compatible active room and rate plan in that currency. Available: ${supportedCurrencies.join(", ")}.`
        : `${requested} cannot be used for agent bookings until this property has an active priced room and a compatible active rate plan in that currency.`,
    };
  }
  const defaultCurrency = supportedCurrencies.includes("TZS") ? "TZS" : supportedCurrencies[0];
  return {
    ok: true as const,
    supportedCurrencies,
    terms: defaultCurrency && !requested ? { ...(terms ?? {}), currency: defaultCurrency } : terms,
  };
}

/** Resolve a link the caller owns (via its property), or send the error and return null. */
async function loadOwnedLink(req: AuthedRequest, res: Response, linkId: number) {
  const link = await prisma.nrmsAgentPropertyLink.findUnique({
    where: { id: linkId },
    select: {
      id: true,
      propertyId: true,
      status: true,
      property: { select: { title: true, ownerId: true } },
      agentAccount: { select: { legalName: true, primaryUserId: true } },
    },
  });
  if (!link) { res.status(404).json({ error: "Agent link not found" }); return null; }
  const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, link.propertyId);
  if (!active) return null; // helper already sent the response
  return { linkId, propertyId: link.propertyId, status: link.status, property: link.property, agentAccount: link.agentAccount, account: active.account };
}

// Mounted at /api/owner/nrms/agents.
// List agents linked to a property.
router.get("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const links = await prisma.nrmsAgentPropertyLink.findMany({
      where: { propertyId: active.property.id },
      include: { agentAccount: { include: { primaryUser: { select: { passwordHash: true } } } }, rateAccess: true },
      orderBy: [{ status: "asc" }, { id: "desc" }],
      take: 200,
    });
    res.json({ maxAgents: active.account.maxAgents, prepayWindowMinutes, links: links.map(linkDto) });
  } catch (err) {
    console.error("[owner.nrms.agents] list failed", err);
    res.status(500).json({ error: "Failed to load agents" });
  }
}) as RequestHandler);

// Cheap, actionable counts for the NRMS sidebar. This deliberately counts
// work that still needs the hotel's attention, not historical agent activity,
// so the marker clears once the queue is handled. Expired booking holds are
// excluded even if their asynchronous expiry update has not run yet.
router.get("/property/:propertyId/live-count", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const now = new Date();
    const [partnershipRequests, acceptedInvites, bookingRequests, guestManifests] = await Promise.all([
      prisma.nrmsAgentPropertyLink.count({
        where: {
          propertyId: active.property.id,
          initiatedBy: "AGENT",
          status: "REQUESTED",
        },
      }),
      prisma.nrmsAgentPropertyLink.count({
        where: { propertyId: active.property.id, status: "AGENT_ACCEPTED" },
      }),
      prisma.nrmsAgentBookingRequest.count({
        where: {
          propertyId: active.property.id,
          status: "PENDING",
          OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
        },
      }),
      prisma.nrmsAgentBookingRequest.count({
        where: { propertyId: active.property.id, status: "CONFIRMED", guestManifestStatus: "SUBMITTED" },
      }),
    ]);
    res.json({
      partnershipRequests,
      acceptedInvites,
      bookingRequests,
      guestManifests,
      total: partnershipRequests + acceptedInvites + bookingRequests + guestManifests,
    });
  } catch (err) {
    console.error("[owner.nrms.agents] live-count failed", err);
    res.status(500).json({ error: "Failed to load travel agent notifications" });
  }
}) as RequestHandler);

// Lightweight rate-plan list for the rate-access picker, with the RESOLVED
// nightly price per room type so the hotel can review the rate before granting
// it. Prices use the same adjustment math as every booking channel.
router.get("/property/:propertyId/rate-plans", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const [plans, roomTypes] = await Promise.all([
      prisma.nrmsRatePlan.findMany({
        where: { propertyId: active.property.id, status: "ACTIVE" },
        select: { id: true, code: true, name: true, mealPlan: true, roomTypeId: true, currency: true, adjustmentType: true, adjustment: true, roomType: { select: { name: true } } },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      }),
      prisma.roomType.findMany({
        where: { propertyId: active.property.id, status: "ACTIVE", baseRate: { not: null } },
        select: { id: true, name: true, baseRate: true, currency: true },
        orderBy: { sortOrder: "asc" },
      }),
    ]);
    const supportedCurrencies = Array.from(new Set(
      roomTypes
        .filter((roomType) => plans.some((plan) => plan.currency === roomType.currency && (plan.roomTypeId == null || plan.roomTypeId === roomType.id)))
        .map((roomType) => roomType.currency),
    )).sort();
    res.json({
      ratePlans: plans.map((p) => {
        const applicable = roomTypes.filter((rt) => rt.currency === p.currency && (p.roomTypeId == null || rt.id === p.roomTypeId));
        const sampleRates = applicable.map((rt) => ({
          roomTypeName: rt.name,
          rate: money(adjustRate(Number(rt.baseRate), p.adjustmentType, Number(p.adjustment))),
        }));
        return {
          id: p.id, code: p.code, name: p.name, mealPlan: p.mealPlan, roomTypeId: p.roomTypeId,
          roomTypeName: p.roomType?.name ?? null, currency: p.currency,
          adjustmentType: p.adjustmentType, adjustment: Number(p.adjustment), sampleRates,
        };
      }),
      supportedCurrencies,
    });
  } catch (err) {
    console.error("[owner.nrms.agents] rate-plans failed", err);
    res.status(500).json({ error: "Failed to load rate plans" });
  }
}) as RequestHandler);

// Look up an existing agency to claim instead of creating a duplicate.
router.post("/property/:propertyId/lookup", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = lookupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide a registration number, TIN or email to search" });
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const matches = await findAgencyMatches(prisma as any, parsed.data);
    res.json({ matches: matches.map((match) => ({ ...match, registrationNo: maskedIdentifier(match.registrationNo), tin: maskedIdentifier(match.tin) })) });
  } catch (err) {
    console.error("[owner.nrms.agents] lookup failed", err);
    res.status(500).json({ error: "Agency lookup failed" });
  }
}) as RequestHandler);

// Attach (invite) an existing agency to the property, enforcing the maxAgents cap.
router.post("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = attachSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid agent invite", details: parsed.error.flatten() });
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const resolvedTerms = await resolveLinkTerms(active.property.id, parsed.data.terms as LinkTerms | undefined);
    if (!resolvedTerms.ok) return res.status(409).json({ error: resolvedTerms.message, code: "AGENT_CURRENCY_UNSUPPORTED", supportedCurrencies: resolvedTerms.supportedCurrencies });
    const result = await prisma.$transaction(async (tx: any) => {
      await lockAgentSeatAllocation(tx, active.property.id);
      const account = await tx.ownerPaygAccount.findUnique({ where: { propertyId: active.property.id }, select: { maxAgents: true } });
      if (!account) return { ok: false as const, reason: "AGENCY_NOT_FOUND" as const, message: "This property no longer has an NRMS account." };
      const attached = await attachAgentToProperty(tx, {
        agentAccountId: parsed.data.agentAccountId,
        propertyId: active.property.id,
        maxAgents: account.maxAgents,
        terms: resolvedTerms.terms,
        initiatedBy: "HOTEL",
        requestedByUserId: req.user!.id,
      });
      if (attached.ok) {
        await auditOrThrow(tx, req, "NRMS_AGENT_LINK_INVITE", "NRMS_AGENT_PROPERTY_LINK", null, { agentAccountId: parsed.data.agentAccountId, propertyId: active.property.id }, attached.linkId);
      }
      return attached;
    });
    if (!result.ok) {
      const code = result.reason === "CAP_REACHED" ? 409 : result.reason === "AGENCY_NOT_FOUND" ? 404 : 409;
      return res.status(code).json({ error: result.message, code: result.reason });
    }
    const agency = await prisma.nrmsAgentAccount.findUnique({ where: { id: parsed.data.agentAccountId }, select: { primaryUserId: true } });
    if (agency?.primaryUserId) {
      await notifyUser(agency.primaryUserId, "nrms_agent_hotel_invitation", { propertyTitle: active.property.title, linkId: result.linkId, transition: "INVITED" });
    }
    res.status(201).json({ linkId: result.linkId });
  } catch (err) {
    console.error("[owner.nrms.agents] attach failed", err);
    res.status(500).json({ error: "Failed to add agent" });
  }
}) as RequestHandler);

// Invite a brand-new agency: creates the NRMS_AGENT user + PENDING agency, links
// it to this property (INVITED), and emails the one-time set-password link. The
// agency still needs central NoLSAF verification before the link can go ACTIVE.
router.post("/property/:propertyId/invite", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid agency details", details: parsed.error.flatten() });
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const resolvedTerms = await resolveLinkTerms(active.property.id, parsed.data.terms as LinkTerms | undefined);
    if (!resolvedTerms.ok) return res.status(409).json({ error: resolvedTerms.message, code: "AGENT_CURRENCY_UNSUPPORTED", supportedCurrencies: resolvedTerms.supportedCurrencies });
    const outcome = await prisma.$transaction(async (tx: any) => {
      await lockAgentSeatAllocation(tx, active.property.id);
      const account = await tx.ownerPaygAccount.findUnique({ where: { propertyId: active.property.id }, select: { maxAgents: true } });
      if (!account) return { ok: false as const, reason: "NRMS_PROPERTY_NOT_ACTIVE" as const, message: "This property no longer has an NRMS account." };
      const seats = await countAgentSeats(tx, active.property.id);
      if (seats >= account.maxAgents) {
        return { ok: false as const, reason: "CAP_REACHED" as const, message: "You have reached your approved-agent limit. Contact NoLSAF to increase it." };
      }

      const invited = await inviteAgentUserInTransaction(tx, {
        email: parsed.data.email,
        legalName: parsed.data.legalName,
        nationality: parsed.data.nationality,
        tradingName: parsed.data.tradingName ?? null,
        registrationNo: parsed.data.registrationNo ?? null,
        tin: parsed.data.tin ?? null,
        contactName: parsed.data.contactName ?? null,
        contactPhone: parsed.data.contactPhone ?? null,
        contactEmail: parsed.data.email,
      });
      if (!invited.ok) return invited;

      const link = await attachAgentToProperty(tx, {
        agentAccountId: invited.accountId,
        propertyId: active.property.id,
        maxAgents: account.maxAgents,
        terms: resolvedTerms.terms,
        initiatedBy: "HOTEL",
        requestedByUserId: req.user!.id,
      });
      if (!link.ok) throw new AgentLinkCreationError(link);
      await auditOrThrow(tx, req, "NRMS_AGENT_INVITE", "NRMS_AGENT_ACCOUNT", null, { propertyId: active.property.id, linkId: link.linkId }, invited.accountId);
      await auditOrThrow(tx, req, "NRMS_AGENT_LINK_INVITE", "NRMS_AGENT_PROPERTY_LINK", null, { agentAccountId: invited.accountId, propertyId: active.property.id, externalOnboarding: true }, link.linkId);
      return { ok: true as const, invited, link };
    });
    if (!outcome.ok) return res.status(409).json({ error: outcome.message, code: outcome.reason });
    const { invited, link } = outcome;

    const inviteUrl = `${webOrigin()}/nrms/agent/activate?t=${encodeURIComponent(invited.token)}`;
    let delivery: "SENT" | "FAILED" = "SENT";
    try {
      const email = getNrmsAgentInviteEmail(inviteUrl, parsed.data.tradingName || parsed.data.legalName);
      await sendMail(parsed.data.email, email.subject, email.html, undefined, { sensitiveContent: true });
    } catch (mailErr) {
      console.error("[owner.nrms.agents] invite email failed", mailErr);
      delivery = "FAILED";
    }
    res.status(201).json({ accountId: invited.accountId, linkId: link.linkId, delivery, resendAvailable: delivery === "FAILED" });
  } catch (err) {
    if (err instanceof AgentLinkCreationError) return res.status(409).json({ error: err.result.message, code: err.result.reason });
    console.error("[owner.nrms.agents] invite failed", err);
    res.status(500).json({ error: "Failed to invite agency" });
  }
}) as RequestHandler);

// Re-mint the same scoped, single-use activation capability if initial delivery
// failed or the seven-day link expired. A password-bearing account cannot be
// resent an activation link.
router.post("/:linkId/resend-invite", (async (req: AuthedRequest, res: Response) => {
  try {
    const owned = await loadOwnedLink(req, res, Number(req.params.linkId));
    if (!owned) return;
    const link = await prisma.nrmsAgentPropertyLink.findUnique({
      where: { id: owned.linkId },
      select: { id: true, agentAccount: { select: { id: true, legalName: true, tradingName: true, primaryUser: { select: { id: true, email: true, passwordHash: true } } } } },
    });
    const user = link?.agentAccount?.primaryUser;
    if (!link?.agentAccount || !user?.email) return res.status(404).json({ error: "Agency invitation recipient not found" });
    if (user.passwordHash) return res.status(409).json({ error: "This agency account is already activated", code: "ALREADY_ACTIVE" });
    const token = signAgentInviteToken(user.id, link.agentAccount.id);
    const inviteUrl = `${webOrigin()}/nrms/agent/activate?t=${encodeURIComponent(token)}`;
    const email = getNrmsAgentInviteEmail(inviteUrl, link.agentAccount.tradingName || link.agentAccount.legalName);
    await sendMail(user.email, email.subject, email.html, undefined, { sensitiveContent: true });
    await audit(req, "NRMS_AGENT_INVITE_RESEND", "NRMS_AGENT_ACCOUNT", null, { propertyId: owned.propertyId, linkId: link.id }, link.agentAccount.id);
    res.json({ ok: true, delivery: "SENT" });
  } catch (err) {
    console.error("[owner.nrms.agents] resend invite failed", err);
    res.status(502).json({ error: "The invitation email could not be delivered. Please try again." });
  }
}) as RequestHandler);

// Booking requests (request-to-book queue) for a property.
router.get("/property/:propertyId/requests", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const [requests, roomTypes] = await Promise.all([
      prisma.nrmsAgentBookingRequest.findMany({
        where: { propertyId: active.property.id },
        select: {
          id: true, status: true, checkIn: true, checkOut: true, adults: true, children: true, roomsRequested: true, roomTypeId: true,
          currency: true, quotedTotal: true, holdExpiresAt: true, decidedAt: true, decisionReason: true, notes: true, createdAt: true,
          incidentalBilling: true, incidentalScope: true, incidentalCategories: true, incidentalCapAmount: true, incidentalCapBasis: true,
          guestManifestStatus: true, guestManifestSubmittedAt: true, guestManifestReviewedAt: true, guestManifestReviewNote: true,
          guests: { select: { id: true, fullName: true, documentKey: true } },
          link: { select: { bookingMode: true, agentAccount: { select: { id: true, legalName: true } } } },
        },
        orderBy: [{ status: "asc" }, { id: "desc" }],
        take: 200,
      }),
      prisma.roomType.findMany({ where: { propertyId: active.property.id }, select: { id: true, name: true } }),
    ]);
    const roomName = new Map(roomTypes.map((rt) => [rt.id, rt.name]));
    res.json({ requests: requests.map((r) => ({
      id: r.id, status: r.status,
      agency: r.link?.agentAccount ? { legalName: r.link.agentAccount.legalName, reference: agentRef(r.link.agentAccount.id) } : null,
      bookingMode: r.link?.bookingMode ?? null,
      roomType: r.roomTypeId ? (roomName.get(r.roomTypeId) ?? null) : null,
      checkIn: r.checkIn, checkOut: r.checkOut, adults: r.adults, children: r.children, rooms: r.roomsRequested,
      currency: r.currency, total: Number(r.quotedTotal), holdExpiresAt: r.holdExpiresAt,
      decidedAt: r.decidedAt, decisionReason: r.decisionReason, notes: r.notes, createdAt: r.createdAt,
      manifest: {
        status: r.guestManifestStatus,
        incidentalBilling: r.incidentalBilling,
        incidentalCover: describeIncidentalCover(r),
        guestsAdded: r.guests.filter((guest) => Boolean(guest.fullName)).length,
        requiredGuests: r.adults + r.children,
        documentsUploaded: r.guests.filter((guest) => Boolean(guest.documentKey)).length,
        submittedAt: r.guestManifestSubmittedAt,
        reviewedAt: r.guestManifestReviewedAt,
        reviewNote: r.guestManifestReviewNote,
      },
    })) });
  } catch (err) {
    console.error("[owner.nrms.agents] requests failed", err);
    res.status(500).json({ error: "Failed to load booking requests" });
  }
}) as RequestHandler);

// Hotel review of the agency-submitted occupant manifest. Verification is a
// check-in readiness decision only; the booking's secured inventory and room
// price are never rewritten here.
router.get("/requests/:requestId/manifest", (async (req: AuthedRequest, res: Response) => {
  try {
    const request = await prisma.nrmsAgentBookingRequest.findUnique({
      where: { id: Number(req.params.requestId) },
      include: {
        guests: { orderBy: [{ roomNumber: "asc" }, { isLead: "desc" }, { id: "asc" }] },
        link: { select: { agentAccount: { select: { legalName: true, tradingName: true, primaryUserId: true } } } },
        masterFolio: {
          include: {
            ...agentInvoiceInclude(),
            // Set once the manifest is verified and the rooms are split out.
            block: { select: { id: true, reference: true, status: true, groupId: true } },
          },
        },
        reservation: {
          select: {
            id: true, status: true, receiptNumber: true, amountPaid: true, totalAmount: true,
          },
        },
      },
    });
    if (!request) return res.status(404).json({ error: "Booking request not found" });
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, request.propertyId);
    if (!active) return;
    res.setHeader("Cache-Control", "private, no-store");
    // Once the booking is split, each party has a real stay of its own. The
    // manifest reads them back so the desk can see a room number appear against
    // the traveller it belongs to, without leaving this page.
    const groupId = request.masterFolio?.block?.groupId ?? null;
    const stays = groupId
      ? await prisma.reservation.findMany({
          where: { groupId },
          orderBy: [{ externalRef: "asc" }, { id: "asc" }],
          select: {
            id: true, status: true, externalRef: true,
            guestProfile: { select: { fullName: true } },
            allocations: {
              where: { status: "ACTIVE" },
              select: { roomUnit: { select: { code: true } }, roomType: { select: { name: true } } },
            },
          },
        })
      : [];
    const latestInvoice = request.masterFolio?.proFormas.find((invoice) => !invoice.supersededAt) ?? request.masterFolio?.proFormas[0] ?? null;
    const received = request.masterFolio?.payments.filter((payment) => !payment.voidedAt).reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0;
    const bookingTotal = Number(request.quotedTotal);
    const amountPaid = Number(request.reservation?.amountPaid ?? 0);
    res.json({
      booking: {
        id: request.id,
        status: request.status,
        agency: request.link?.agentAccount ? { legalName: request.link.agentAccount.legalName, tradingName: request.link.agentAccount.tradingName } : null,
        property: { id: active.property.id, title: active.property.title },
        checkIn: request.checkIn,
        checkOut: request.checkOut,
        adults: request.adults,
        children: request.children,
        rooms: request.roomsRequested,
        receiptNumber: request.reservation?.receiptNumber ?? null,
        financials: {
          currency: request.currency,
          total: bookingTotal,
          amountPaid: received || amountPaid,
          balance: Math.max(0, Number(latestInvoice?.quotedTotal ?? bookingTotal) - received),
          status: request.masterFolio?.status ?? "AWAITING_INVOICE",
          invoice: latestInvoice ? serializeProForma({ ...latestInvoice, masterFolio: request.masterFolio }) : null,
          payments: request.masterFolio?.payments.filter((payment) => !payment.voidedAt).map((payment) => ({ id: payment.id, amount: Number(payment.amount), method: payment.method, reference: payment.reference, receiptNumber: payment.receiptNumber, createdAt: payment.createdAt })) ?? [],
        },
      },
      // Present once the verified manifest has been split into per-room stays,
      // so the review page can hand the desk over to the group workspace.
      rooms: request.masterFolio?.block
        ? {
            blockId: request.masterFolio.block.id,
            blockReference: request.masterFolio.block.reference,
            blockStatus: request.masterFolio.block.status,
            groupId: request.masterFolio.block.groupId,
            stays: stays.map((stay) => ({
              reservationId: stay.id,
              reference: stay.externalRef,
              status: stay.status,
              guestName: stay.guestProfile?.fullName ?? null,
              roomCode: stay.allocations[0]?.roomUnit?.code ?? null,
              roomTypeName: stay.allocations[0]?.roomType?.name ?? null,
            })),
          }
        : null,
      manifest: {
        status: request.guestManifestStatus,
        incidentalBilling: request.incidentalBilling,
        incidentalCover: describeIncidentalCover(request),
        requiredGuests: request.adults + request.children,
        guestsAdded: request.guests.filter((guest) => Boolean(guest.fullName)).length,
        submittedAt: request.guestManifestSubmittedAt,
        reviewedAt: request.guestManifestReviewedAt,
        reviewNote: request.guestManifestReviewNote,
      },
      guests: request.guests.map((guest) => ({
        id: guest.id,
        reservationId: guest.reservationId,
        roomNumber: guest.roomNumber,
        guestType: guest.guestType,
        isLead: guest.isLead,
        fullName: guest.fullName,
        phone: guest.phone,
        email: guest.email,
        nationality: guest.nationality,
        dateOfBirth: guest.dateOfBirth,
        documentType: guest.documentType,
        documentNumber: guest.documentNumber,
        documentExpiry: guest.documentExpiry,
        documentUploaded: Boolean(guest.documentKey),
        status: guest.status,
        reviewNote: guest.reviewNote,
      })),
    });
  } catch (err) {
    console.error("[owner.nrms.agents] manifest load failed", err);
    res.status(500).json({ error: "Failed to load the guest manifest" });
  }
}) as RequestHandler);

// Split a verified manifest into one stay per room. Verification does this by
// itself now, so this exists for bookings verified before that shipped, and for
// a manifest whose split was skipped because it had no named travellers yet.
const MATERIALISE_MESSAGES: Record<string, string> = {
  ALREADY_MATERIALISED: "This booking is already split into individual stays",
  NO_RESERVATION: "This booking has no reservation to split",
  RESERVATION_NOT_CONFIRMED: "Only a confirmed booking can be split into rooms",
  NO_ACTIVE_ALLOCATIONS: "This booking is no longer holding any rooms",
  MASTER_FOLIO_MISSING: "Issue and settle the agency invoice before splitting this booking into room stays",
  NIGHTS_ALREADY_BILLED: "This stay has already started billing nights, so it cannot be split now",
  NO_NAMED_TRAVELLERS: "No traveller has been named on this manifest yet",
};

router.post("/requests/:requestId/rooms", (async (req: AuthedRequest, res: Response) => {
  try {
    const requestId = Number(req.params.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) return res.status(400).json({ error: "Invalid booking request" });
    const request = await prisma.nrmsAgentBookingRequest.findUnique({
      where: { id: requestId },
      select: { id: true, propertyId: true, guestManifestStatus: true },
    });
    if (!request) return res.status(404).json({ error: "Booking request not found" });
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, request.propertyId);
    if (!active) return;
    if (request.guestManifestStatus !== "VERIFIED") {
      return res.status(409).json({ error: "Verify the traveller manifest before splitting the booking into rooms", code: "MANIFEST_NOT_VERIFIED" });
    }

    const outcome = await prisma.$transaction(
      async (tx: any) => materialiseAgentBookingRooms(tx, { requestId: request.id, ownerId: req.user!.id, actorId: req.user!.id }),
      { maxWait: 5000, timeout: 30000 },
    );
    if (!outcome.ok) {
      // Already split is not a failure. It is the case that needs re-checking,
      // because a booking split before the double-charge was found still has
      // the duplicate room lines that reopened its settled bill.
      if (outcome.skipped === "ALREADY_MATERIALISED") {
        const repair = await prisma.$transaction(
          async (tx: any) => repairSplitAgencyBooking(tx, request.id),
          { maxWait: 5000, timeout: 30000 },
        );
        if (!repair.ok) return res.status(409).json({ error: MATERIALISE_MESSAGES[outcome.skipped], code: outcome.skipped });
        await audit(req, "NRMS_AGENT_BOOKING_ROOMS_RECHECK", "NRMS_AGENT_BOOKING_REQUEST", null, { reservations: repair.reservations, folioStatus: repair.folioStatus }, request.id);
        return res.json({ ok: true, repaired: true, reservations: repair.reservations, folioStatus: repair.folioStatus });
      }
      return res.status(409).json({ error: MATERIALISE_MESSAGES[outcome.skipped] ?? "This booking cannot be split into rooms", code: outcome.skipped });
    }
    await audit(req, "NRMS_AGENT_BOOKING_SPLIT_ROOMS", "NRMS_AGENT_BOOKING_REQUEST", null, { blockId: outcome.blockId, groupId: outcome.groupId, created: outcome.reservationIds.length }, request.id);
    res.status(201).json({ ok: true, groupId: outcome.groupId, blockId: outcome.blockId, created: outcome.reservationIds.length, unnamed: outcome.roomsLeftUnnamed });
  } catch (err) {
    console.error("[owner.nrms.agents] room split failed", err);
    res.status(500).json({ error: "The booking could not be split into rooms" });
  }
}) as RequestHandler);

router.post("/requests/:requestId/manifest/review", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = manifestReviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose a valid manifest decision", details: parsed.error.flatten() });
    const request = await prisma.nrmsAgentBookingRequest.findUnique({
      where: { id: Number(req.params.requestId) },
      include: { guests: true, link: { select: { agentAccount: { select: { primaryUserId: true, legalName: true } } } } },
    });
    if (!request) return res.status(404).json({ error: "Booking request not found" });
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, request.propertyId);
    if (!active) return;
    if (request.guestManifestStatus !== "SUBMITTED") {
      return res.status(409).json({ error: "Only a submitted guest manifest can be reviewed", code: "MANIFEST_NOT_SUBMITTED" });
    }
    const data = parsed.data;
    if (data.action === "RETURN" && !data.note && data.guestIssues.length === 0) {
      return res.status(400).json({ error: "Explain what the agency must correct before returning the manifest" });
    }
    const guestIds = new Set(request.guests.map((guest) => guest.id));
    if (data.guestIssues.some((issue) => !guestIds.has(issue.guestId))) {
      return res.status(400).json({ error: "One of the selected travellers is not part of this booking" });
    }
    if (data.action === "VERIFY") {
      const required = request.adults + request.children;
      if (request.guests.length !== required || request.guests.some((guest) => !guest.fullName || !guest.nationality || !guest.dateOfBirth || !guest.documentType || !guest.documentNumber || !guest.documentKey)) {
        return res.status(409).json({ error: "Every booked traveller needs complete identity details and a document before verification", code: "MANIFEST_INCOMPLETE" });
      }
    }

    const now = new Date();
    // Returned out of the transaction rather than captured, so the response
    // reads the outcome the committed transaction actually produced.
    const materialised = await prisma.$transaction(async (tx: any): Promise<MaterialiseOutcome | null> => {
      let outcome: MaterialiseOutcome | null = null;
      if (data.action === "VERIFY") {
        // Verification is where anonymous rooms become named stays, so the
        // placeholder reservation is split into one reservation per party and
        // party is handed to the group workspace. This is atomic: a manifest
        // must never say VERIFIED while its occupants still point at an
        // anonymous placeholder.
        outcome = await materialiseAgentBookingRooms(tx, { requestId: request.id, ownerId: req.user!.id, actorId: req.user!.id });
        if (!outcome.ok) {
          throw new Error(`AGENT_MANIFEST_MATERIALISE:${outcome.skipped}`);
        }
        // Materialisation locks request -> property -> occupants. Keep that
        // global order here as well so a manual repair cannot deadlock a
        // simultaneous verification transaction.
        await tx.nrmsAgentBookingGuest.updateMany({ where: { bookingRequestId: request.id }, data: { status: "ACCEPTED", reviewNote: null } });
      } else {
        await tx.nrmsAgentBookingGuest.updateMany({ where: { bookingRequestId: request.id }, data: { status: "ACCEPTED", reviewNote: null } });
        for (const issue of data.guestIssues) {
          await tx.nrmsAgentBookingGuest.update({ where: { id: issue.guestId }, data: { status: "CHANGES_REQUESTED", reviewNote: sanitizeText(issue.note) } });
        }
      }
      const changed = await tx.nrmsAgentBookingRequest.updateMany({
        where: { id: request.id, guestManifestStatus: "SUBMITTED" },
        data: {
          guestManifestStatus: data.action === "VERIFY" ? "VERIFIED" : "CHANGES_REQUESTED",
          guestManifestReviewedAt: now,
          guestManifestReviewedById: req.user!.id,
          guestManifestReviewNote: data.note ? sanitizeText(data.note) : null,
        },
      });
      if (changed.count !== 1) throw new Error("AGENT_MANIFEST_REVIEW_RACE");
      // The verified manifest is recorded on whichever stays now carry it: the
      // per-room reservations after a split, or the single reservation when the
      // booking stayed on the old path.
      const eventTargets = outcome?.ok ? outcome.reservationIds : (request.reservationId ? [request.reservationId] : []);
      if (eventTargets.length) {
        await tx.reservationEvent.createMany({
          data: eventTargets.map((reservationId) => ({
            reservationId,
            type: data.action === "VERIFY" ? "AGENT_MANIFEST_VERIFIED" : "AGENT_MANIFEST_RETURNED",
            actorId: req.user!.id,
            data: { bookingRequestId: request.id, note: data.note ?? null, issueCount: data.guestIssues.length },
          })),
        });
      }
      return outcome;
    });
    const agentUserId = request.link?.agentAccount?.primaryUserId;
    if (agentUserId) {
      await notifyUser(agentUserId, data.action === "VERIFY" ? "nrms_agent_guest_manifest_verified" : "nrms_agent_guest_manifest_returned", {
        requestId: request.id,
        propertyTitle: active.property.title,
        note: data.note ?? null,
        transition: data.action === "VERIFY" ? "VERIFIED" : "CHANGES_REQUESTED",
      });
    }
    res.json({
      ok: true,
      status: data.action === "VERIFY" ? "VERIFIED" : "CHANGES_REQUESTED",
      rooms: materialised?.ok
        ? { groupId: materialised.groupId, blockId: materialised.blockId, created: materialised.reservationIds.length, unnamed: materialised.roomsLeftUnnamed }
        : null,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "AGENT_MANIFEST_REVIEW_RACE") {
      return res.status(409).json({ error: "This manifest changed before the decision was saved. Reload it and review the current version.", code: "MANIFEST_REVIEW_RACE" });
    }
    if (err instanceof Error && err.message.startsWith("AGENT_MANIFEST_MATERIALISE:")) {
      const code = err.message.slice("AGENT_MANIFEST_MATERIALISE:".length);
      return res.status(409).json({
        error: MATERIALISE_MESSAGES[code] ?? "The room stays could not be created, so the manifest was not verified",
        code,
      });
    }
    console.error("[owner.nrms.agents] manifest review failed", err);
    res.status(500).json({ error: "The guest manifest decision could not be saved" });
  }
}) as RequestHandler);

router.get("/requests/:requestId/guests/:guestId/document", (async (req: AuthedRequest, res: Response) => {
  try {
    const request = await prisma.nrmsAgentBookingRequest.findUnique({
      where: { id: Number(req.params.requestId) },
      select: { propertyId: true, guests: { where: { id: Number(req.params.guestId) }, select: { documentKey: true, documentResourceType: true } } },
    });
    if (!request) return res.status(404).json({ error: "Booking request not found" });
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, request.propertyId);
    if (!active) return;
    const guest = request.guests[0];
    if (!guest?.documentKey) return res.status(404).json({ error: "Traveller document not found" });
    res.setHeader("Cache-Control", "private, no-store");
    res.redirect(302, signedAgentTravellerDocumentUrl(guest.documentKey, guest.documentResourceType));
  } catch (err) {
    console.error("[owner.nrms.agents] traveller document failed", err);
    res.status(500).json({ error: "Traveller document could not be opened" });
  }
}) as RequestHandler);

/** Load a booking request the caller owns (via its property), with the agent user to notify. */
async function loadOwnedRequest(req: AuthedRequest, res: Response, requestId: number) {
  const request = await prisma.nrmsAgentBookingRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, propertyId: true, checkIn: true, checkOut: true, currency: true, quotedTotal: true, reservationId: true, link: { select: { id: true, agentAccount: { select: { primaryUserId: true, legalName: true, primaryUser: { select: { email: true } } } } } } },
  });
  if (!request) { res.status(404).json({ error: "Request not found" }); return null; }
  const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, request.propertyId);
  if (!active) return null;
  return {
    request, propertyTitle: active.property.title as string,
    agentUserId: request.link?.agentAccount?.primaryUserId ?? null,
    agencyName: request.link?.agentAccount?.legalName ?? "Travel agent",
    agentEmail: request.link?.agentAccount?.primaryUser?.email ?? null,
  };
}

const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10);

// Approve a request-to-book: HELD -> CONFIRMED.
router.post("/requests/:requestId/approve", (async (req: AuthedRequest, res: Response) => {
  try {
    const owned = await loadOwnedRequest(req, res, Number(req.params.requestId));
    if (!owned) return;
    const result = await prisma.$transaction(async (tx: any) => {
      const linkId = owned.request.link?.id;
      if (!linkId) return { ok: false as const, reason: "RELATIONSHIP_NOT_ACTIVE", message: "This partnership is no longer available." };
      const bookingPolicy = await authorizeHeldAgentBookingApproval(tx, { linkId, propertyId: owned.request.propertyId });
      if (!bookingPolicy.ok) return { ok: false as const, reason: bookingPolicy.reason, message: bookingPolicy.message };
      return approveAgentHold(tx, owned.request.id, req.user!.id);
    });
    if (!result.ok) return res.status(result.reason === "NOT_FOUND" ? 404 : 409).json({ error: result.message, code: result.reason });
    if (owned.agentUserId) void notifyUser(owned.agentUserId, "nrms_agent_request_approved", { propertyTitle: owned.propertyTitle, checkIn: ymd(owned.request.checkIn), checkOut: ymd(owned.request.checkOut), requestId: owned.request.id });
    await audit(req, "NRMS_AGENT_REQUEST_APPROVE", "NRMS_AGENT_BOOKING_REQUEST", null, { reservationId: result.reservationId }, owned.request.id);
    res.json({ ok: true, reservationId: result.reservationId });
  } catch (err) {
    console.error("[owner.nrms.agents] approve request failed", err);
    res.status(500).json({ error: "Failed to approve the request" });
  }
}) as RequestHandler);

const agentProFormaRecordInclude = {
  masterFolio: {
    include: {
      payments: { orderBy: { createdAt: "asc" as const } },
      refunds: { orderBy: { createdAt: "asc" as const } },
      block: true,
      agentBookingRequest: { include: { link: { include: { agentAccount: true } } } },
    },
  },
};

async function loadOwnedAgentCommercialRequest(req: AuthedRequest, res: Response, requestId: number) {
  const request = await prisma.nrmsAgentBookingRequest.findUnique({
    where: { id: requestId },
    include: {
      link: { include: { agentAccount: { include: { primaryUser: { select: { id: true, email: true } } } } } },
      masterFolio: { include: agentInvoiceInclude() },
      reservation: { select: { id: true, status: true, receiptNumber: true, amountPaid: true, totalAmount: true } },
    },
  });
  if (!request) { res.status(404).json({ error: "Booking request not found" }); return null; }
  const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, request.propertyId);
  if (!active) return null;
  return { request, active };
}

// Owner issues an immutable property-direct invoice after approving inventory.
router.post("/requests/:requestId/invoices", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = invoiceCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check the invoice details", details: parsed.error.flatten() });
    const requestId = Number(req.params.requestId);
    const owned = await loadOwnedAgentCommercialRequest(req, res, requestId);
    if (!owned) return;
    // Once the booking is split, the placeholder reservation is cancelled and
    // the agency's room line has been re-cut per stay. Re-running the invoice
    // would restore the aggregate line on top of those, charging the rooms
    // twice, so the revision has to come from the block instead.
    const split = await prisma.nrmsMasterFolio.findUnique({
      where: { agentBookingRequestId: requestId },
      select: { blockId: true, block: { select: { reference: true } } },
    });
    if (split?.blockId) {
      return res.status(409).json({
        error: `This booking is split into individual stays. Revise the agency bill from group block ${split.block?.reference ?? ""}`.trim(),
        code: "BOOKING_SPLIT_INTO_ROOMS",
      });
    }
    if (owned.request.status !== "CONFIRMED" || owned.request.reservation?.status !== "CONFIRMED") {
      return res.status(409).json({ error: "Approve the booking request before generating its invoice", code: "BOOKING_REVIEW_REQUIRED" });
    }
    if (Number(owned.request.quotedTotal) - parsed.data.discountAmount <= 0) {
      return res.status(400).json({ error: "The final invoice amount must be greater than zero", code: "INVALID_FINAL_TOTAL" });
    }
    const created = await prisma.$transaction(async (tx: any) => {
      const fresh = await tx.nrmsAgentBookingRequest.findUnique({
        where: { id: requestId },
        include: {
          link: { include: { agentAccount: { include: { primaryUser: { select: { email: true } } } } } },
        },
      });
      if (!fresh || fresh.status !== "CONFIRMED") throw new Error("NRMS_AGENT_BOOKING_NOT_APPROVED");
      const [property, roomType] = await Promise.all([
        tx.property.findUnique({ where: { id: fresh.propertyId }, select: { id: true, ownerId: true, title: true, street: true, ward: true, city: true, district: true, regionName: true, country: true } }),
        fresh.roomTypeId ? tx.roomType.findUnique({ where: { id: fresh.roomTypeId }, select: { id: true, name: true } }) : null,
      ]);
      if (!property) throw new Error("NRMS_PRO_FORMA_PROPERTY_REQUIRED");
      const source = { ...fresh, property, roomType };
      const folio = await ensureAgentMasterFolio(tx, source, parsed.data.discountAmount, parsed.data.discountReason || null);
      return createMasterProForma(tx, agentProFormaSource(source, folio), {
        createdById: req.user!.id,
        dueAt: parsed.data.dueAt || null,
        validUntil: parsed.data.dueAt || null,
        notes: parsed.data.notes ? sanitizeText(parsed.data.notes) : null,
      });
    });
    const invoice = await prisma.nrmsMasterFolioProForma.findUnique({ where: { id: created.id }, include: agentProFormaRecordInclude });
    await audit(req, "NRMS_AGENT_INVOICE_GENERATE", "NRMS_AGENT_BOOKING_REQUEST", null, { invoiceId: created.id, discountAmount: parsed.data.discountAmount }, requestId);
    res.status(201).json({ invoice: serializeProForma(invoice) });
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "NRMS_PRO_FORMA_CONTACT_REQUIRED") return res.status(409).json({ error: "Add the agency billing contact and email before generating an invoice", code: "BILLING_CONTACT_REQUIRED" });
    if (code === "NRMS_PRO_FORMA_BANK_REQUIRED") return res.status(409).json({ error: "Configure property bank instructions or a verified payout bank account before invoicing", code: "BANK_INSTRUCTIONS_REQUIRED" });
    if (code === "NRMS_PRO_FORMA_ALREADY_PAID") return res.status(409).json({ error: "This booking is already fully paid", code: "PAYMENT_COMPLETE" });
    console.error("[owner.nrms.agents] invoice generation failed", err);
    res.status(500).json({ error: "The agent invoice could not be generated" });
  }
}) as RequestHandler);

async function loadOwnedAgentInvoice(req: AuthedRequest, res: Response, requestId: number, invoiceId: number) {
  const owned = await loadOwnedAgentCommercialRequest(req, res, requestId);
  if (!owned) return null;
  const record = await prisma.nrmsMasterFolioProForma.findFirst({
    where: { id: invoiceId, masterFolio: { agentBookingRequestId: requestId, ownerId: req.user!.id } },
    include: agentProFormaRecordInclude,
  });
  if (!record) { res.status(404).json({ error: "Invoice not found" }); return null; }
  return { ...owned, record };
}

router.get("/requests/:requestId/invoices/:invoiceId/pdf", (async (req: AuthedRequest, res: Response) => {
  try {
    const loaded = await loadOwnedAgentInvoice(req, res, Number(req.params.requestId), Number(req.params.invoiceId));
    if (!loaded) return;
    const pdf = await renderMasterProFormaPdf(loaded.record);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${loaded.record.number}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    console.error("[owner.nrms.agents] invoice PDF failed", err);
    res.status(500).json({ error: "The invoice PDF could not be opened" });
  }
}) as RequestHandler);

// The receipt is the counterpart to the invoice: it exists only once the
// property has actually recorded the money, so it is rendered from the folio
// payment rather than from the pro forma.
router.get("/requests/:requestId/payments/:paymentId/receipt", (async (req: AuthedRequest, res: Response) => {
  try {
    const requestId = Number(req.params.requestId);
    const owned = await loadOwnedAgentCommercialRequest(req, res, requestId);
    if (!owned) return;
    const payment = await prisma.nrmsMasterFolioPayment.findFirst({
      where: { id: Number(req.params.paymentId), masterFolio: { agentBookingRequestId: requestId, ownerId: req.user!.id }, voidedAt: null },
    });
    if (!payment) { res.status(404).json({ error: "Receipt not found" }); return; }
    const currentInvoice = owned.request.masterFolio?.proFormas.find((entry: any) => !entry.supersededAt)
      ?? owned.request.masterFolio?.proFormas[0]
      ?? null;
    const invoiceNumber = currentInvoice?.number ?? "";
    const invoiceTotal = currentInvoice ? Number(currentInvoice.quotedTotal) : null;
    const receivedToDate = (owned.request.masterFolio?.payments ?? [])
      .filter((entry: any) => !entry.voidedAt && new Date(entry.createdAt) <= payment.createdAt)
      .reduce((sum: number, entry: any) => sum + Number(entry.amount), 0);
    const agencyName = owned.request.link?.agentAccount?.tradingName || owned.request.link?.agentAccount?.legalName || "Travel agency";
    const pdf = await generatePaymentReceiptPdf({
      receiptNumber: payment.receiptNumber,
      invoiceNumber,
      bookingId: owned.request.id,
      bookingCode: owned.request.reservation?.receiptNumber ?? null,
      guestName: agencyName,
      guestEmail: owned.request.link?.agentAccount?.contactEmail ?? null,
      propertyName: owned.active.property.title,
      propertyLocation: [owned.active.property.regionName, owned.active.property.district].filter(Boolean).join(", ") || null,
      checkIn: owned.request.checkIn,
      checkOut: owned.request.checkOut,
      total: Number(payment.amount),
      invoiceTotal,
      // Balance as at this receipt, so a part payment reconciles on its face.
      balanceAfter: invoiceTotal == null ? null : Math.max(0, Number((invoiceTotal - receivedToDate).toFixed(2))),
      paymentMethod: payment.method,
      paymentRef: payment.reference,
      paidAt: payment.createdAt,
      currency: payment.currency,
      qrPng: await QRCode.toBuffer(payment.receiptNumber, { type: "png", margin: 1, width: 256, errorCorrectionLevel: "M" }).catch(() => null),
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${payment.receiptNumber}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    console.error("[owner.nrms.agents] receipt PDF failed", err);
    res.status(500).json({ error: "The receipt PDF could not be opened" });
  }
}) as RequestHandler);

router.post("/requests/:requestId/invoices/:invoiceId/send", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = invoiceSendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid agency email" });
    const loaded = await loadOwnedAgentInvoice(req, res, Number(req.params.requestId), Number(req.params.invoiceId));
    if (!loaded) return;
    if (loaded.record.status === "SUPERSEDED") return res.status(409).json({ error: "Generate or send the latest invoice revision", code: "INVOICE_SUPERSEDED" });
    const recipient = String(parsed.data.email || loaded.record.contactEmail).trim().toLowerCase();
    const { delivery } = await emailMasterProForma(loaded.record, recipient);
    const sent = await prisma.nrmsMasterFolioProForma.update({
      where: { id: loaded.record.id },
      data: { status: "SENT", sentById: req.user!.id, sentAt: new Date(), sentToEmail: recipient, deliveryProvider: String((delivery as any)?.provider || "unknown").slice(0, 30), deliveryMessageId: (delivery as any)?.messageId ? String((delivery as any).messageId).slice(0, 160) : null },
      include: agentProFormaRecordInclude,
    });
    if (loaded.request.link.agentAccount.primaryUserId) void notifyUser(loaded.request.link.agentAccount.primaryUserId, "nrms_agent_invoice_sent", { requestId: loaded.request.id, invoiceNumber: sent.number, propertyTitle: loaded.active.property.title, amount: Number(sent.balanceDue), currency: sent.currency });
    await audit(req, "NRMS_AGENT_INVOICE_SEND", "NRMS_AGENT_BOOKING_REQUEST", null, { invoiceId: sent.id, recipient }, loaded.request.id);
    res.json({ invoice: serializeProForma(sent) });
  } catch (err) {
    console.error("[owner.nrms.agents] invoice send failed", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "The invoice could not be sent" });
  }
}) as RequestHandler);

// Recording payment is the owner's explicit confirmation that money reached
// the property. An agency's "paid" declaration alone never settles the folio.
router.post("/requests/:requestId/payments/confirm", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = receivedPaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Check the received payment details", details: parsed.error.flatten() });
    const owned = await loadOwnedAgentCommercialRequest(req, res, Number(req.params.requestId));
    if (!owned) return;
    if (!owned.request.masterFolio) return res.status(409).json({ error: "Generate and send an invoice first", code: "INVOICE_REQUIRED" });
    const latest = owned.request.masterFolio.proFormas.find((invoice: any) => !invoice.supersededAt);
    if (!latest?.payerMarkedPaidAt) return res.status(409).json({ error: "The agency has not declared this invoice paid yet", code: "AGENCY_PAYMENT_DECLARATION_REQUIRED" });
    const data = parsed.data;
    const result = await prisma.$transaction(async (tx: any) => {
      // Serialize the balance check and insert. Idempotency protects retries;
      // this row lock also protects two genuinely concurrent requests carrying
      // different keys from both spending the same outstanding balance.
      await tx.$executeRawUnsafe(
        "SELECT id FROM `nrms_master_folio` WHERE id = ? FOR UPDATE",
        owned.request.masterFolio!.id,
      );
      const duplicate = await tx.nrmsMasterFolioPayment.findUnique({ where: { masterFolioId_idempotencyKey: { masterFolioId: owned.request.masterFolio!.id, idempotencyKey: data.idempotencyKey } } });
      if (duplicate) {
        const current = await tx.nrmsMasterFolio.findUnique({ where: { id: owned.request.masterFolio!.id }, select: { status: true } });
        return { payment: duplicate, status: current?.status ?? owned.request.masterFolio!.status, idempotent: true };
      }
      const totals = await getMasterFolioTotals(tx, owned.request.masterFolio!.id);
      if (totals.balance <= 0.005) throw new Error("NRMS_MASTER_PAYMENT_COMPLETE");
      if (data.amount > totals.balance + 0.005) throw new Error(`NRMS_MASTER_PAYMENT_EXCEEDS_BALANCE:${totals.balance}`);
      const reference = data.reference ? sanitizeText(data.reference) : latest.payerPaymentReference;
      if (reference) {
        const referenceDuplicate = await tx.nrmsMasterFolioPayment.findFirst({
          where: { masterFolioId: owned.request.masterFolio!.id, reference, voidedAt: null },
          select: { id: true },
        });
        if (referenceDuplicate) throw new Error("NRMS_MASTER_PAYMENT_REFERENCE_DUPLICATE");
      }
      const payment = await tx.nrmsMasterFolioPayment.create({ data: { masterFolioId: owned.request.masterFolio!.id, amount: data.amount, currency: owned.request.currency, method: data.method, reference, idempotencyKey: data.idempotencyKey, receiptNumber: buildMasterPaymentReceiptNumber(owned.request.masterFolio!.id), note: data.note ? sanitizeText(data.note) : null, recordedById: req.user!.id } });
      const totalsAfter = await refreshMasterFolioStatus(tx, owned.request.masterFolio!.id);
      // The folio is the only ledger for agency money. Mirroring its total onto
      // the reservation used to be how the front desk saw a paid agency stay,
      // and it made the same payment appear twice wherever a view added the
      // reservation's own amountPaid to the folio. Views now read the folio.
      return { payment, status: totalsAfter.status, idempotent: false };
    });
    if (result.status === "SETTLED" || result.status === "CREDIT") {
      void emailAgentVoucher(prisma as any, owned.request.id);
      if (owned.request.link.agentAccount.primaryUserId) void notifyUser(owned.request.link.agentAccount.primaryUserId, "nrms_agent_payment_confirmed", { requestId: owned.request.id, propertyTitle: owned.active.property.title, receiptNumber: result.payment.receiptNumber });
    }
    await audit(req, "NRMS_AGENT_PAYMENT_RECEIVED", "NRMS_AGENT_BOOKING_REQUEST", null, { paymentId: result.payment.id, receiptNumber: result.payment.receiptNumber, amount: data.amount }, owned.request.id);
    res.status(result.idempotent ? 200 : 201).json({ ok: true, settled: result.status === "SETTLED", receiptNumber: result.payment.receiptNumber });
  } catch (err) {
    if (err instanceof Error && err.message === "NRMS_MASTER_PAYMENT_COMPLETE") return res.status(409).json({ error: "This invoice is already fully paid", code: "PAYMENT_COMPLETE" });
    if (err instanceof Error && err.message.startsWith("NRMS_MASTER_PAYMENT_EXCEEDS_BALANCE:")) return res.status(400).json({ error: "The received amount cannot exceed the outstanding invoice balance", code: "PAYMENT_EXCEEDS_BALANCE", balance: Number(err.message.split(":")[1]) });
    if (err instanceof Error && err.message === "NRMS_MASTER_PAYMENT_REFERENCE_DUPLICATE") return res.status(409).json({ error: "A payment with this property reference is already recorded on the agency folio", code: "PAYMENT_REFERENCE_DUPLICATE" });
    console.error("[owner.nrms.agents] received payment failed", err);
    res.status(500).json({ error: "The received payment could not be recorded" });
  }
}) as RequestHandler);

// Decline a request-to-book: releases the hold.
router.post("/requests/:requestId/reject", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
    const owned = await loadOwnedRequest(req, res, Number(req.params.requestId));
    if (!owned) return;
    const result = await prisma.$transaction((tx: any) => releaseAgentHold(tx, owned.request.id, { status: "DECLINED", decidedByUserId: req.user!.id, reason: parsed.data.reason ?? null }));
    if (!result.ok) return res.status(result.reason === "NOT_FOUND" ? 404 : 409).json({ error: result.message, code: result.reason });
    if (owned.agentUserId) void notifyUser(owned.agentUserId, "nrms_agent_request_declined", { propertyTitle: owned.propertyTitle, checkIn: ymd(owned.request.checkIn), checkOut: ymd(owned.request.checkOut), reason: parsed.data.reason ?? null, requestId: owned.request.id });
    if (owned.agentEmail) {
      const email = getNrmsAgentRequestDeclinedEmail(owned.agencyName, owned.propertyTitle, ymd(owned.request.checkIn), ymd(owned.request.checkOut), parsed.data.reason ?? null, `${webOrigin()}/agent-portal`);
      void sendMail(owned.agentEmail, email.subject, email.html).catch((e) => console.warn("[owner.nrms.agents] decline email failed", e?.message));
    }
    await audit(req, "NRMS_AGENT_REQUEST_REJECT", "NRMS_AGENT_BOOKING_REQUEST", null, { reason: parsed.data.reason ?? null }, owned.request.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[owner.nrms.agents] reject request failed", err);
    res.status(500).json({ error: "Failed to decline the request" });
  }
}) as RequestHandler);

// Single link detail.
router.get("/:linkId", (async (req: AuthedRequest, res: Response) => {
  try {
    const owned = await loadOwnedLink(req, res, Number(req.params.linkId));
    if (!owned) return;
    const link = await prisma.nrmsAgentPropertyLink.findUnique({ where: { id: owned.linkId }, include: { agentAccount: { include: { primaryUser: { select: { passwordHash: true } } } }, rateAccess: true } });
    const shareContact = Boolean(link && ["AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"].includes(link.status));
    res.json({ link: { ...linkDto(link), agency: link?.agentAccount ? agencyDetail(link.agentAccount, shareContact) : null } });
  } catch (err) {
    console.error("[owner.nrms.agents] detail failed", err);
    res.status(500).json({ error: "Failed to load agent" });
  }
}) as RequestHandler);

// Update commercial terms.
router.patch("/:linkId/terms", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = termsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid terms", details: parsed.error.flatten() });
    const owned = await loadOwnedLink(req, res, Number(req.params.linkId));
    if (!owned) return;
    if (parsed.data.currency) {
      const resolvedTerms = await resolveLinkTerms(owned.propertyId, parsed.data as LinkTerms);
      if (!resolvedTerms.ok) return res.status(409).json({ error: resolvedTerms.message, code: "AGENT_CURRENCY_UNSUPPORTED", supportedCurrencies: resolvedTerms.supportedCurrencies });
    }
    const result = await updateAgentLinkTerms(prisma as any, { linkId: owned.linkId, propertyId: owned.propertyId, terms: parsed.data });
    if (!result.ok) return res.status(404).json({ error: "Agent link not found" });
    await audit(req, "NRMS_AGENT_LINK_TERMS", "NRMS_AGENT_PROPERTY_LINK", null, parsed.data, owned.linkId);
    res.json({ ok: true });
  } catch (err) {
    console.error("[owner.nrms.agents] terms failed", err);
    res.status(500).json({ error: "Failed to update terms" });
  }
}) as RequestHandler);

// Replace rate/room access.
router.put("/:linkId/rate-access", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = rateAccessSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid rate access", details: parsed.error.flatten() });
    const owned = await loadOwnedLink(req, res, Number(req.params.linkId));
    if (!owned) return;
    const result = await prisma.$transaction(async (tx: any) => {
      const link = await tx.nrmsAgentPropertyLink.findFirst({ where: { id: owned.linkId, propertyId: owned.propertyId }, select: { currency: true } });
      if (!link) return { ok: false as const, reason: "NOT_FOUND" as const };
      if (parsed.data.entries.length) {
        const [plans, roomTypes] = await Promise.all([
          tx.nrmsRatePlan.findMany({
            where: { id: { in: Array.from(new Set(parsed.data.entries.map((entry) => entry.ratePlanId))) }, propertyId: owned.propertyId, status: "ACTIVE", currency: link.currency },
            select: { id: true, roomTypeId: true },
          }),
          tx.roomType.findMany({
            where: { propertyId: owned.propertyId, status: "ACTIVE", baseRate: { not: null }, currency: link.currency },
            select: { id: true },
          }),
        ]);
        const planById = new Map<number, { id: number; roomTypeId: number | null }>(
          plans.map((plan: any) => [plan.id, { id: plan.id, roomTypeId: plan.roomTypeId }] as const),
        );
        const roomIds = new Set(roomTypes.map((roomType: any) => roomType.id));
        const invalid = parsed.data.entries.some((entry) => {
          const plan = planById.get(entry.ratePlanId);
          if (!plan || roomIds.size === 0) return true;
          if (plan.roomTypeId != null && !roomIds.has(plan.roomTypeId)) return true;
          if (entry.roomTypeId != null && (!roomIds.has(entry.roomTypeId) || (plan.roomTypeId != null && plan.roomTypeId !== entry.roomTypeId))) return true;
          return false;
        });
        if (invalid) return { ok: false as const, reason: "CURRENCY_MISMATCH" as const };
      }
      return setAgentRateAccess(tx, { linkId: owned.linkId, propertyId: owned.propertyId, entries: parsed.data.entries });
    });
    if (!result.ok && result.reason === "CURRENCY_MISMATCH") {
      return res.status(409).json({ error: "Rate access can include only active rooms and rate plans in the agent link currency.", code: "AGENT_RATE_CURRENCY_MISMATCH" });
    }
    if (!result.ok) return res.status(404).json({ error: "Agent link not found" });
    await audit(req, "NRMS_AGENT_LINK_RATE_ACCESS", "NRMS_AGENT_PROPERTY_LINK", null, { count: parsed.data.entries.length }, owned.linkId);
    res.json({ ok: true });
  } catch (err) {
    console.error("[owner.nrms.agents] rate access failed", err);
    res.status(500).json({ error: "Failed to update rate access" });
  }
}) as RequestHandler);

// Approve / reject / suspend, sharing one handler.
function decisionHandler(status: "ACTIVE" | "REJECTED" | "SUSPENDED" | "TERMINATED", action: string): RequestHandler {
  return (async (req: AuthedRequest, res: Response) => {
    try {
      const parsed = decisionSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
      const owned = await loadOwnedLink(req, res, Number(req.params.linkId));
      if (!owned) return;
      const result = await prisma.$transaction(async (tx: any) => {
        const transitioned = await setAgentLinkStatus(tx, { linkId: owned.linkId, propertyId: owned.propertyId, status, decidedByUserId: req.user!.id, reason: parsed.data.reason ?? null });
        if (transitioned.ok && transitioned.changed) {
          await auditOrThrow(tx, req, action, "NRMS_AGENT_PROPERTY_LINK", null, { status, reason: parsed.data.reason ?? null }, owned.linkId);
        }
        return transitioned;
      });
      if (!result.ok) {
        const code = result.reason === "NOT_FOUND" ? 404 : 409;
        return res.status(code).json({ error: result.message, code: result.reason });
      }
      if (result.changed && owned.agentAccount.primaryUserId) {
        const template = status === "ACTIVE"
          ? "nrms_partnership_activated"
          : status === "REJECTED"
            ? "nrms_partnership_rejected"
            : status === "SUSPENDED"
              ? "nrms_partnership_suspended"
              : "nrms_partnership_terminated";
        await notifyUser(owned.agentAccount.primaryUserId, template, {
          linkId: owned.linkId,
          propertyTitle: owned.property.title,
          agencyName: owned.agentAccount.legalName,
          reason: parsed.data.reason ?? null,
          transition: status,
        });
      }
      res.json({ ok: true, status, unchanged: !result.changed });
    } catch (err) {
      console.error(`[owner.nrms.agents] ${action} failed`, err);
      res.status(500).json({ error: "Failed to update agent status" });
    }
  }) as RequestHandler;
}

router.post("/:linkId/approve", decisionHandler("ACTIVE", "NRMS_AGENT_LINK_APPROVE"));
router.post("/:linkId/reject", decisionHandler("REJECTED", "NRMS_AGENT_LINK_REJECT"));
router.post("/:linkId/suspend", decisionHandler("SUSPENDED", "NRMS_AGENT_LINK_SUSPEND"));
router.post("/:linkId/terminate", decisionHandler("TERMINATED", "NRMS_AGENT_LINK_TERMINATE"));

export default router;
