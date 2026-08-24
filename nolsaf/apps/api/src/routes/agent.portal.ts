// apps/api/src/routes/agent.portal.ts
//
// The travel agent's own portal API (NRMS Agent B2B). A logged-in NRMS_AGENT
// user sees the hotels that have approved them, searches live availability at
// their negotiated rates, and books (request-to-book or instant confirm).
//
// Scope: every route resolves the agent's ONE agency account from the session
// and only ever touches property links that belong to it. An agent can never
// see or book against a hotel that has not approved them, nor another agency's
// data. Booking is allowed only where the link is ACTIVE and the agency is
// centrally VERIFIED.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { getRoomTypesAvailability } from "../lib/nrmsAvailability.js";
import { getPropertyAgentCurrencies, quoteAgentRates, quoteAgentRoom } from "../lib/nrmsAgentRates.js";
import { createAgentHold } from "../lib/nrmsAgentInventory.js";
import { generateAgentVoucher } from "../lib/nrmsAgentVoucher.js";
import { notifyOwner } from "../lib/notifications.js";
import { lockPropertyInventory } from "../lib/nrmsAvailability.js";
import { limitAgentTourRosterLookup, limitNrmsAgentBookingCreate } from "../middleware/rateLimit.js";
import { audit, auditOrThrow } from "../lib/audit.js";
import { ACCOMMODATION_WORKSPACE, evaluateAccommodationPortalAccess } from "../lib/nrmsPartnerCapability.js";
import { attachAgentToProperty, lockAgentPartnership, lockAgentSeatAllocation } from "../lib/nrmsAgentLinks.js";
import { canBookPartnership } from "../lib/nrmsPartnershipPolicy.js";
import { sanitizeText } from "../lib/sanitize.js";
import { isAgentTravellerDocumentKey, signedAgentTravellerDocumentUrl } from "../lib/nrmsAgentDocuments.js";
import { describeIncidentalCover } from "../lib/nrmsAgentIncidentals.js";
import { CHARGE_CATEGORIES } from "../lib/nrmsFolio.js";
import { agentInvoiceInclude } from "../lib/nrmsAgentInvoice.js";
import { renderMasterProFormaPdf, serializeProForma } from "../lib/nrmsProForma.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const agentRef = (id: number) => `AGT-${String(id).padStart(6, "0")}`;

const HOLD_TX = { maxWait: 5000, timeout: 15000 };
const prepayWindowMinutes = 0;
const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

function firstLegacyPropertyPhoto(value: unknown): string | null {
  let candidates: unknown[] = [];
  if (Array.isArray(value)) candidates = value;
  else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      candidates = Array.isArray(parsed) ? parsed : [value];
    } catch {
      candidates = [value];
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      const url = record.thumbnailUrl || record.url || record.secure_url;
      if (typeof url === "string" && url.trim()) return url.trim();
    }
  }
  return null;
}

const searchSchema = z.object({
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.coerce.number().int().min(1).max(20).default(1),
  children: z.coerce.number().int().min(0).max(20).default(0),
});
const partnershipRequestSchema = z.object({ propertyId: z.number().int().positive() }).strict();
const partnershipDecisionSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();
const partnershipDiscoverySchema = z.object({
  q: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(24).default(12),
}).strict();
const bookSchema = searchSchema.extend({
  clientMutationId: z.string().trim().min(16).max(120).regex(/^[A-Za-z0-9._:-]+$/),
  roomTypeId: z.number().int().positive(),
  ratePlanId: z.number().int().positive(),
  rooms: z.number().int().min(1).max(10).default(1),
  incidentalBilling: z.enum(["AGENCY", "INDIVIDUAL_GUEST"]),
  notes: z.string().trim().max(1000).optional(),
});
const manifestGuestSchema = z.object({
  roomNumber: z.number().int().min(1).max(10),
  guestType: z.enum(["ADULT", "CHILD"]),
  isLead: z.boolean().default(false),
  fullName: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().min(7).max(40).nullable().optional(),
  email: z.string().trim().email().max(160).nullable().optional(),
  nationality: z.string().trim().max(80).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  documentType: z.enum(["PASSPORT", "NATIONAL_ID", "OTHER"]).nullable().optional(),
  documentNumber: z.string().trim().max(100).nullable().optional(),
  documentExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  documentKey: z.string().refine(isAgentTravellerDocumentKey, "Upload the identity document through the protected traveller-document service").nullable().optional(),
  documentMimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"]).nullable().optional(),
  documentResourceType: z.enum(["image", "raw"]).default("image"),
});
// The declaration answers two questions: who settles extras, and how far the
// agency's cover reaches. A cover with no stated ceiling is unlimited, which is
// a real commitment, so the shape is validated rather than trusted.
export const INCIDENTAL_CAP_BASES = ["PER_TRAVELLER_PER_NIGHT", "PER_TRAVELLER_STAY", "BOOKING_TOTAL"] as const;
const manifestSchema = z.object({
  incidentalBilling: z.enum(["AGENCY", "INDIVIDUAL_GUEST"]),
  incidentalScope: z.enum(["ALL", "SELECTED"]).nullable().optional(),
  incidentalCategories: z.array(z.enum(CHARGE_CATEGORIES)).max(CHARGE_CATEGORIES.length).optional(),
  incidentalCapAmount: z.number().nonnegative().max(999_999_999).nullable().optional(),
  incidentalCapBasis: z.enum(INCIDENTAL_CAP_BASES).nullable().optional(),
  submit: z.boolean().default(false),
  guests: z.array(manifestGuestSchema).max(40),
}).strict().superRefine((value, ctx) => {
  if (value.incidentalBilling !== "AGENCY") return;
  if (!value.incidentalScope) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["incidentalScope"], message: "State whether the agency covers every extra or only selected ones" });
    return;
  }
  if (value.incidentalScope === "SELECTED" && !(value.incidentalCategories ?? []).length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["incidentalCategories"], message: "Choose at least one category the agency covers" });
  }
  if (value.incidentalCapAmount != null && !value.incidentalCapBasis) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["incidentalCapBasis"], message: "Say what the spending limit is measured against" });
  }
  if (value.incidentalCapAmount == null && value.incidentalCapBasis) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["incidentalCapAmount"], message: "Enter the spending limit, or remove the basis" });
  }
});
// The reference is the only thread the property has to tie a declared payment
// to a real credit in its account, so it is required rather than advisory.
// A cash hand-over has no paying account, so the name is required for every
// other method and rejected for CASH.
const AGENT_PAYMENT_METHODS = ["BANK", "CARD", "MOBILE", "CASH"] as const;
const invoicePaidSchema = z.object({
  reference: z.string().trim().min(3).max(120),
  method: z.enum(AGENT_PAYMENT_METHODS),
  accountName: z.string().trim().min(2).max(160).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.method !== "CASH" && !value.accountName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accountName"], message: "Name the account the payment came from" });
  }
});
const agentDocumentSchema = z.object({
  type: z.enum(["TOURISM_LICENSE", "BUSINESS_LICENSE", "TIN_CERTIFICATE", "ID", "PASSPORT", "OTHER"]),
  url: z.string().url().max(1000).refine((value) => {
    try { const parsed = new URL(value); return parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com"; } catch { return false; }
  }, "Documents must come from the protected NoLSAF upload service"),
  uploadedAt: z.string().datetime().optional(),
});
const profileSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradingName: z.string().trim().max(200).nullable().optional(),
  registrationNo: z.string().trim().max(80).nullable().optional(),
  tin: z.string().trim().max(50).nullable().optional(),
  licenseNo: z.string().trim().max(80).nullable().optional(),
  contactName: z.string().trim().max(160).nullable().optional(),
  contactEmail: z.string().trim().email().max(200).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
  nationality: z.string().trim().max(80).nullable().optional(),
  documents: z.array(agentDocumentSchema).max(10),
});

/** Resolve the caller's agency account, or send the error and return null. */
async function loadAgentAccount(req: AuthedRequest, res: Response) {
  const user = req.user;
  const role = String(user?.role || "").toUpperCase();
  if (!user || !["AGENT", "NRMS_AGENT"].includes(role)) {
    res.status(403).json({ error: "This area is for approved travel agents only" });
    return null;
  }
  const [account, operator, capability] = await Promise.all([
    prisma.nrmsAgentAccount.findUnique({
      where: { primaryUserId: user.id },
      select: { id: true, legalName: true, tradingName: true, status: true, verificationStatus: true },
    }),
    role === "AGENT"
      ? prisma.agent.findUnique({ where: { userId: user.id }, select: { status: true, operatorProfile: true } })
      : Promise.resolve(null),
    role === "AGENT"
      ? prisma.userWorkspaceAccess.findUnique({ where: { userId_workspace: { userId: user.id, workspace: ACCOMMODATION_WORKSPACE } }, select: { status: true, expiresAt: true } })
      : Promise.resolve(null),
  ]);
  if (!account && role === "NRMS_AGENT") { res.status(404).json({ error: "Agent profile not found" }); return null; }
  const operatorProfile = operator?.operatorProfile && typeof operator.operatorProfile === "object" && !Array.isArray(operator.operatorProfile)
    ? operator.operatorProfile as Record<string, any>
    : {};
  const access = evaluateAccommodationPortalAccess({
    role,
    capabilityStatus: capability?.status,
    capabilityExpiresAt: capability?.expiresAt,
    operatorStatus: operator?.status,
    operatorProfileReviewStatus: String(operatorProfile.reviewStatus || operatorProfile.review?.status || ""),
    hasAgencyIdentity: Boolean(account),
    agencyStatus: account?.status,
  });
  if (!access.ok) {
    res.status(access.reason === "AGENCY_INACTIVE" ? 423 : 403).json({ error: access.message, code: access.reason });
    return null;
  }
  return account;
}

async function loadOwnedAgentBooking(req: AuthedRequest, res: Response, requestId: number) {
  const account = await loadAgentAccount(req, res);
  if (!account) return null;
  if (!Number.isInteger(requestId) || requestId <= 0) {
    res.status(400).json({ error: "Invalid booking id" });
    return null;
  }
  const booking = await prisma.nrmsAgentBookingRequest.findFirst({
    where: { id: requestId, link: { agentAccountId: account.id } },
    include: {
      guests: { orderBy: [{ roomNumber: "asc" }, { isLead: "desc" }, { id: "asc" }] },
      link: { select: { property: { select: { id: true, title: true, ownerId: true } } } },
      reservation: {
        select: {
          id: true, status: true, receiptNumber: true, amountPaid: true, totalAmount: true,
        },
      },
      masterFolio: { include: agentInvoiceInclude() },
    },
  });
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return null;
  }
  return { account, booking };
}

function manifestSummary(booking: any) {
  const guests = Array.isArray(booking.guests) ? booking.guests : [];
  const requiredGuests = Number(booking.adults ?? 0) + Number(booking.children ?? 0);
  const documentsUploaded = guests.filter((guest: any) => Boolean(guest.documentKey)).length;
  const guestsAdded = guests.filter((guest: any) => Boolean(String(guest.fullName ?? "").trim())).length;
  return {
    status: booking.guestManifestStatus ?? "NOT_STARTED",
    requiredGuests,
    guestsAdded,
    documentsUploaded,
    incidentalBilling: booking.incidentalBilling ?? null,
    incidentalCover: describeIncidentalCover(booking),
    submittedAt: booking.guestManifestSubmittedAt ?? null,
    reviewedAt: booking.guestManifestReviewedAt ?? null,
    reviewNote: booking.guestManifestReviewNote ?? null,
    readyForCheckIn: booking.guestManifestStatus === "VERIFIED" && guestsAdded === requiredGuests && documentsUploaded === requiredGuests,
  };
}

function commercialSummary(booking: any) {
  const folio = booking.masterFolio;
  const invoices = folio?.proFormas ?? [];
  const latest = invoices.find((invoice: any) => !invoice.supersededAt) ?? invoices[0] ?? null;
  const received = (folio?.payments ?? []).filter((payment: any) => !payment.voidedAt).reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
  return {
    status: folio?.status ?? (booking.status === "CONFIRMED" ? "AWAITING_INVOICE" : "AWAITING_REVIEW"),
    settled: ["SETTLED", "CREDIT"].includes(String(folio?.status || "")),
    received,
    invoice: latest ? serializeProForma({ ...latest, masterFolio: folio }) : null,
    invoices: invoices.map((invoice: any) => serializeProForma({ ...invoice, masterFolio: folio })),
    payments: (folio?.payments ?? []).filter((payment: any) => !payment.voidedAt).map((payment: any) => ({ id: payment.id, amount: Number(payment.amount), method: payment.method, reference: payment.reference, receiptNumber: payment.receiptNumber, createdAt: payment.createdAt })),
  };
}

router.get("/profile", (async (req: AuthedRequest, res: Response) => {
  const account = await loadAgentAccount(req, res);
  if (!account) return;
  const profile = await prisma.nrmsAgentAccount.findUnique({
    where: { id: account.id },
    select: { id: true, legalName: true, tradingName: true, registrationNo: true, tin: true, licenseNo: true, contactName: true, contactEmail: true, contactPhone: true, address: true, countryCode: true, nationality: true, documents: true, verificationStatus: true, verificationNote: true, verifiedAt: true, updatedAt: true },
  });
  res.json({ profile });
}) as RequestHandler);

router.put("/profile", (async (req: AuthedRequest, res: Response) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check the agency profile", details: parsed.error.flatten() });
  const account = await loadAgentAccount(req, res);
  if (!account) return;
  const now = new Date();
  const documents = parsed.data.documents.map((document) => ({ ...document, uploadedAt: document.uploadedAt || now.toISOString() }));
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.nrmsAgentAccount.update({
      where: { id: account.id },
      data: {
        ...parsed.data,
        documents,
        verificationStatus: "PENDING",
        verifiedAt: null,
        verifiedByAdminId: null,
        verificationNote: null,
      },
      select: { id: true, verificationStatus: true, updatedAt: true },
    });
    await auditOrThrow(tx, req, "NRMS_AGENT_PROFILE_SUBMIT", "NRMS_AGENT_ACCOUNT", { verificationStatus: account.verificationStatus }, { verificationStatus: "PENDING", documentCount: documents.length }, account.id);
    return saved;
  });
  res.json({ ok: true, profile: updated });
}) as RequestHandler);

/** Resolve a bookable link the agent owns (ACTIVE + agency VERIFIED), or send the error. */
async function loadBookableLink(req: AuthedRequest, res: Response, linkId: number) {
  const account = await loadAgentAccount(req, res);
  if (!account) return null;
  const link = await prisma.nrmsAgentPropertyLink.findFirst({
    where: { id: linkId, agentAccountId: account.id },
    select: {
      id: true, status: true, initiatedBy: true, hotelConsentStatus: true, agentConsentStatus: true, currency: true, bookingMode: true, propertyId: true,
      property: { select: { id: true, title: true, ownerId: true, status: true, nrmsActivatedAt: true, nrmsGuestPayInstructions: true } },
    },
  });
  if (!link || !link.property) { res.status(404).json({ error: "Hotel not found for your account" }); return null; }
  const payg = await prisma.ownerPaygAccount.findUnique({ where: { propertyId: link.propertyId }, select: { status: true } });
  const bookingPolicy = canBookPartnership({
    linkStatus: link.status,
    initiatedBy: link.initiatedBy,
    hotelConsentStatus: link.hotelConsentStatus,
    agentConsentStatus: link.agentConsentStatus,
    agencyStatus: account.status,
    agencyVerificationStatus: account.verificationStatus,
    propertyStatus: link.property.status,
    propertyNrmsActivated: Boolean(link.property.nrmsActivatedAt),
    paygStatus: payg?.status,
  });
  if (!bookingPolicy.ok) {
    res.status(423).json({ error: bookingPolicy.message, code: bookingPolicy.reason });
    return null;
  }
  const supportedCurrencies = await getPropertyAgentCurrencies(prisma as any, link.propertyId);
  if (!supportedCurrencies.includes(link.currency.toUpperCase())) {
    res.status(409).json({
      error: `${link.property.title} does not currently have a compatible active room and rate plan in ${link.currency}. Ask the hotel to update your agent terms.`,
      code: "AGENT_CURRENCY_UNSUPPORTED",
      linkCurrency: link.currency,
      supportedCurrencies,
    });
    return null;
  }
  return { account, link };
}

// Active hotels plus invitations awaiting the agency's explicit consent.
router.get("/hotels", (async (req: AuthedRequest, res: Response) => {
  try {
    const account = await loadAgentAccount(req, res);
    if (!account) return;
    const links = await prisma.nrmsAgentPropertyLink.findMany({
      where: { agentAccountId: account.id, status: { in: ["INVITED", "REQUESTED", "AGENT_ACCEPTED", "ACTIVE"] } },
      select: {
        id: true, status: true, initiatedBy: true, requestedAt: true, hotelConsentStatus: true, agentConsentStatus: true, currency: true, bookingMode: true,
        property: { select: { id: true, title: true } },
        _count: { select: { rateAccess: true } },
      },
      orderBy: { id: "desc" },
    });
    res.json({
      agency: { legalName: account.legalName, tradingName: account.tradingName, reference: agentRef(account.id), verificationStatus: account.verificationStatus, status: account.status },
      canBook: account.verificationStatus === "VERIFIED",
      hotels: links.filter((l) => l.status === "ACTIVE" && l.property).map((l) => ({
        linkId: l.id,
        property: { id: l.property!.id, title: l.property!.title },
        currency: l.currency,
        bookingMode: l.bookingMode,
        ratePlans: l._count.rateAccess,
        prepayWindowMinutes,
      })),
      invitations: links.filter((l) => l.status === "INVITED" && l.property).map((l) => ({
        linkId: l.id,
        property: { id: l.property!.id, title: l.property!.title },
        currency: l.currency,
        bookingMode: l.bookingMode,
      })),
      awaitingHotelApproval: links.filter((l) => l.status === "AGENT_ACCEPTED" && l.property).map((l) => ({
        linkId: l.id,
        property: { id: l.property!.id, title: l.property!.title },
      })),
      outgoingRequests: links.filter((l) => l.status === "REQUESTED" && l.property).map((l) => ({
        linkId: l.id,
        requestedAt: l.requestedAt,
        property: { id: l.property!.id, title: l.property!.title },
        hotelConsentStatus: l.hotelConsentStatus,
      })),
    });
  } catch (err) {
    console.error("[agent.portal] hotels failed", err);
    res.status(500).json({ error: "Failed to load your hotels" });
  }
}) as RequestHandler);

async function decideHotelInvitation(req: AuthedRequest, res: Response, status: "AGENT_ACCEPTED" | "REJECTED") {
  const parsed = partnershipDecisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid invitation decision" });
  const account = await loadAgentAccount(req, res);
  if (!account) return;
  const linkId = Number(req.params.linkId);
  if (!Number.isInteger(linkId) || linkId <= 0) return res.status(400).json({ error: "Invalid hotel invitation" });
  const link = await prisma.nrmsAgentPropertyLink.findFirst({
    where: { id: linkId, agentAccountId: account.id, status: "INVITED" },
    select: { id: true, property: { select: { ownerId: true, title: true } } },
  });
  if (!link) return res.status(409).json({ error: "This invitation is no longer pending", code: "INVITATION_NOT_PENDING" });
  const changed = await prisma.$transaction(async (tx: any) => {
    const updated = await tx.nrmsAgentPropertyLink.updateMany({
      where: { id: link.id, agentAccountId: account.id, status: "INVITED" },
      data: {
        status,
        agentConsentStatus: status === "AGENT_ACCEPTED" ? "ACCEPTED" : "DECLINED",
        agentConsentedByUserId: req.user!.id,
        agentConsentedAt: new Date(),
        decisionReason: parsed.data.reason ?? null,
      },
    });
    if (updated.count === 1) {
      await auditOrThrow(tx, req, status === "AGENT_ACCEPTED" ? "NRMS_PARTNERSHIP_ACCEPT_AGENT" : "NRMS_PARTNERSHIP_DECLINE_AGENT", "NRMS_AGENT_PROPERTY_LINK", { status: "INVITED" }, { status, reason: parsed.data.reason ?? null }, link.id);
    }
    return updated;
  });
  if (changed.count !== 1) return res.status(409).json({ error: "This invitation was already decided", code: "INVITATION_NOT_PENDING" });
  if (link.property?.ownerId) {
    await notifyOwner(link.property.ownerId, status === "AGENT_ACCEPTED" ? "nrms_agent_invitation_accepted" : "nrms_agent_invitation_rejected", {
      linkId: link.id,
      agencyName: account.legalName,
      propertyTitle: link.property.title,
      reason: parsed.data.reason ?? null,
      transition: status,
    });
  }
  return res.json({ ok: true, status });
}

router.post("/hotels/:linkId/accept", ((req: AuthedRequest, res: Response) => decideHotelInvitation(req, res, "AGENT_ACCEPTED")) as RequestHandler);
router.post("/hotels/:linkId/reject", ((req: AuthedRequest, res: Response) => decideHotelInvitation(req, res, "REJECTED")) as RequestHandler);

// Privacy-safe hotel directory for activated operators. It exposes only public
// listing identity/location plus the caller's own relationship state—never
// owner contacts, private hotel terms, exact coordinates, inventory, or rates.
router.get("/partnerships/discover", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = partnershipDiscoverySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid discovery filters" });
    const account = await loadAgentAccount(req, res);
    if (!account) return;
    const blockedBilling = ["FROZEN", "PAYMENT_REQUIRED", "PAYMENT_PENDING", "CLOSED"];
    const paygAccounts = await prisma.ownerPaygAccount.findMany({
      where: { status: { notIn: blockedBilling } },
      select: { propertyId: true, maxAgents: true },
    });
    const eligiblePropertyIds = paygAccounts.map((row) => row.propertyId);
    if (!eligiblePropertyIds.length) return res.json({ items: [], page: parsed.data.page, pageSize: parsed.data.pageSize, total: 0, totalPages: 0 });
    const q = parsed.data.q;
    const region = parsed.data.region;
    const where: any = {
      id: { in: eligiblePropertyIds },
      status: "APPROVED",
      nrmsActivatedAt: { not: null },
      ...(q ? { OR: [
        { title: { contains: q } },
        { type: { contains: q } },
        { regionName: { contains: q } },
        { city: { contains: q } },
        { country: { contains: q } },
      ] } : {}),
      ...(region ? { AND: [{ OR: [{ regionName: { contains: region } }, { city: { contains: region } }, { country: { contains: region } }] }] } : {}),
    };
    const [total, properties] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        select: {
          id: true, title: true, type: true, description: true, hotelStar: true,
          regionName: true, city: true, country: true,
          images: { where: { status: "READY", url: { not: null } }, select: { url: true, thumbnailUrl: true }, orderBy: { id: "asc" }, take: 1 },
        },
        orderBy: [{ title: "asc" }, { id: "asc" }],
        skip: (parsed.data.page - 1) * parsed.data.pageSize,
        take: parsed.data.pageSize,
      }),
    ]);
    const propertyIds = properties.map((property) => property.id);
    const [relationships, seats, legacyPhotos, readyRoomTypes, readyRatePlans] = await Promise.all([
      prisma.nrmsAgentPropertyLink.findMany({
        where: { agentAccountId: account.id, propertyId: { in: propertyIds } },
        select: { id: true, propertyId: true, status: true, initiatedBy: true, requestedAt: true },
      }),
      propertyIds.length ? prisma.nrmsAgentPropertyLink.groupBy({
        by: ["propertyId"],
        where: { propertyId: { in: propertyIds }, status: { in: ["INVITED", "REQUESTED", "AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"] } },
        _count: { _all: true },
      }) : Promise.resolve([]),
      propertyIds.length ? prisma.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true, photos: true },
      }) : Promise.resolve([]),
      propertyIds.length ? prisma.roomType.findMany({
        where: { propertyId: { in: propertyIds }, status: "ACTIVE", baseRate: { not: null } },
        select: { id: true, propertyId: true, currency: true },
      }) : Promise.resolve([]),
      propertyIds.length ? prisma.nrmsRatePlan.findMany({
        where: { propertyId: { in: propertyIds }, status: "ACTIVE" },
        select: { propertyId: true, roomTypeId: true, currency: true },
      }) : Promise.resolve([]),
    ]);
    const relationByProperty = new Map(relationships.map((relationship) => [relationship.propertyId, relationship]));
    const seatsByProperty = new Map<number, number>(seats.map((row: any) => [row.propertyId, Number(row._count?._all ?? 0)] as const));
    const paygByProperty = new Map(paygAccounts.map((row) => [row.propertyId, row]));
    const legacyPhotoByProperty = new Map<number, string | null>(
      legacyPhotos.map((row) => [Number(row.id), firstLegacyPropertyPhoto(row.photos)] as const),
    );
    const configuredPropertyIds = new Set<number>();
    for (const roomType of readyRoomTypes) {
      const roomCurrency = String(roomType.currency || "").toUpperCase();
      if (!roomCurrency) continue;
      const compatiblePlan = readyRatePlans.some((plan) =>
        Number(plan.propertyId) === Number(roomType.propertyId) &&
        String(plan.currency || "").toUpperCase() === roomCurrency &&
        (plan.roomTypeId == null || Number(plan.roomTypeId) === Number(roomType.id)),
      );
      if (compatiblePlan) configuredPropertyIds.add(Number(roomType.propertyId));
    }
    return res.json({
      items: properties.map((property) => {
        const relationship = relationByProperty.get(property.id);
        const image = property.images[0];
        const location = [property.city, property.regionName, property.country].map((value) => String(value || "").trim()).filter((value, index, rows) => value && rows.indexOf(value) === index).join(", ");
        const maxAgents = paygByProperty.get(property.id)?.maxAgents ?? 0;
        const seatAvailable = Number(seatsByProperty.get(property.id) ?? 0) < maxAgents;
        const configuredForAgents = configuredPropertyIds.has(property.id);
        const canCreateRequest = !relationship || ["REJECTED", "TERMINATED"].includes(relationship.status);
        const acceptingRequests = canCreateRequest && seatAvailable && configuredForAgents;
        const requestAvailability = !configuredForAgents
          ? { code: "SETUP_PENDING", label: "Hotel setup pending" }
          : !seatAvailable
            ? { code: "NOT_ACCEPTING", label: "Not accepting requests" }
            : { code: "OPEN", label: "Accepting requests" };
        return {
          property: {
            id: property.id,
            title: property.title,
            type: property.type,
            summary: String(property.description || "").trim().slice(0, 220) || null,
            hotelStar: property.hotelStar,
            location: location || "Tanzania",
            imageUrl: image?.thumbnailUrl || image?.url || legacyPhotoByProperty.get(property.id) || null,
          },
          relationship: relationship ? { linkId: relationship.id, status: relationship.status, initiatedBy: relationship.initiatedBy, requestedAt: relationship.requestedAt } : null,
          acceptingRequests,
          requestAvailability,
        };
      }),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total,
      totalPages: Math.ceil(total / parsed.data.pageSize),
    });
  } catch (err) {
    console.error("[agent.portal] partnership discovery failed", err);
    return res.status(500).json({ error: "Partner hotels could not be loaded" });
  }
}) as RequestHandler);

// Operator-initiated partnership request. This creates no rate access and cannot
// become bookable until the hotel explicitly approves it.
router.post("/partnerships/requests", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = partnershipRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose a valid hotel" });
    const account = await loadAgentAccount(req, res);
    if (!account) return;
    const property = await prisma.property.findFirst({
      where: { id: parsed.data.propertyId, status: "APPROVED", nrmsActivatedAt: { not: null } },
      select: { id: true, title: true, ownerId: true },
    });
    if (!property) return res.status(404).json({ error: "This hotel is not available for NRMS partnerships", code: "PROPERTY_NOT_ELIGIBLE" });
    const payg = await prisma.ownerPaygAccount.findUnique({ where: { propertyId: property.id }, select: { status: true, maxAgents: true } });
    if (!payg || ["FROZEN", "PAYMENT_REQUIRED", "PAYMENT_PENDING", "CLOSED"].includes(payg.status)) {
      return res.status(423).json({ error: "This hotel is not currently accepting partnership requests", code: "PROPERTY_NOT_ELIGIBLE" });
    }
    const currencies = await getPropertyAgentCurrencies(prisma as any, property.id);
    const currency = currencies.includes("TZS") ? "TZS" : currencies[0];
    if (!currency) return res.status(409).json({ error: "This hotel is not ready to accept partnership requests yet", code: "PROPERTY_NOT_READY" });
    const result = await prisma.$transaction(async (tx: any) => {
      // Serialize seat allocation per hotel so concurrent operators cannot both
      // pass the maxAgents check and oversubscribe the property.
      await lockAgentSeatAllocation(tx, property.id);
      const created = await attachAgentToProperty(tx, {
        agentAccountId: account.id,
        propertyId: property.id,
        maxAgents: payg.maxAgents,
        terms: { currency, paymentTerms: "PREPAID", bookingMode: "REQUEST", creditLimit: 0 },
        initiatedBy: "AGENT",
        requestedByUserId: req.user!.id,
      });
      if (created.ok) {
        await auditOrThrow(tx, req, "NRMS_PARTNERSHIP_REQUEST_AGENT", "NRMS_AGENT_PROPERTY_LINK", null, { propertyId: property.id, initiatedBy: "AGENT" }, created.linkId);
      }
      return created;
    });
    if (!result.ok) return res.status(result.reason === "CAP_REACHED" || result.reason === "ALREADY_LINKED" ? 409 : 404).json({ error: result.message, code: result.reason });
    if (property.ownerId) await notifyOwner(property.ownerId, "nrms_agent_partnership_requested", { agencyName: account.legalName, propertyTitle: property.title, linkId: result.linkId, transition: "REQUESTED" });
    return res.status(201).json({ ok: true, linkId: result.linkId, status: "REQUESTED" });
  } catch (err: any) {
    console.error("[agent.portal] partnership request failed", err);
    if (err?.code === "P2002") return res.status(409).json({ error: "A partnership with this hotel already exists", code: "ALREADY_LINKED" });
    return res.status(500).json({ error: "Partnership request could not be created" });
  }
}) as RequestHandler);

router.post("/partnerships/:linkId/terminate", (async (req: AuthedRequest, res: Response) => {
  const parsed = partnershipDecisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid termination request" });
  const account = await loadAgentAccount(req, res);
  if (!account) return;
  const now = new Date();
  const linkId = Number(req.params.linkId);
  if (!Number.isInteger(linkId) || linkId <= 0) return res.status(400).json({ error: "Invalid partnership" });
  const link = await prisma.nrmsAgentPropertyLink.findFirst({
    where: { id: linkId, agentAccountId: account.id, status: { in: ["REQUESTED", "AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"] } },
    select: { id: true, status: true, property: { select: { ownerId: true, title: true } } },
  });
  if (!link) return res.status(409).json({ error: "This partnership cannot be terminated from its current state", code: "INVALID_TRANSITION" });
  const changed = await prisma.$transaction(async (tx: any) => {
    const updated = await tx.nrmsAgentPropertyLink.updateMany({
      where: { id: linkId, agentAccountId: account.id, status: { in: ["REQUESTED", "AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"] } },
      data: { status: "TERMINATED", agentConsentStatus: "WITHDRAWN", agentConsentedByUserId: req.user!.id, agentConsentedAt: now, terminatedAt: now, terminationReason: parsed.data.reason ?? null },
    });
    if (updated.count === 1) {
      await auditOrThrow(tx, req, "NRMS_PARTNERSHIP_TERMINATE_AGENT", "NRMS_AGENT_PROPERTY_LINK", null, { reason: parsed.data.reason ?? null }, linkId);
    }
    return updated;
  });
  if (changed.count !== 1) return res.status(409).json({ error: "This partnership cannot be terminated from its current state", code: "INVALID_TRANSITION" });
  if (link.property?.ownerId) {
    await notifyOwner(link.property.ownerId, "nrms_partnership_terminated", {
      linkId,
      propertyTitle: link.property.title,
      agencyName: account.legalName,
      reason: parsed.data.reason ?? null,
      transition: "TERMINATED",
      initiatedBy: "AGENT",
    });
  }
  return res.json({ ok: true, status: "TERMINATED" });
}) as RequestHandler);

// Live availability + negotiated quote for one hotel and date range.
router.get("/hotels/:linkId/availability", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Choose valid check-in and check-out dates" });
    const ctx = await loadBookableLink(req, res, Number(req.params.linkId));
    if (!ctx) return;
    const checkIn = dateOnly(parsed.data.checkIn);
    const checkOut = dateOnly(parsed.data.checkOut);
    const today = dateOnly(new Date().toISOString().slice(0, 10));
    const stayNights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
    if (!Number.isFinite(checkIn.getTime()) || !Number.isFinite(checkOut.getTime()) || checkIn < today || checkOut <= checkIn || stayNights > 365) return res.status(400).json({ error: "Stay dates must be valid, in the future, and no longer than 365 nights" });

    const quotes = await quoteAgentRates(prisma as any, {
      linkId: ctx.link.id, propertyId: ctx.link.propertyId, checkIn, checkOut, adults: parsed.data.adults, children: parsed.data.children, currency: ctx.link.currency,
    });
    const availability = await getRoomTypesAvailability(prisma, ctx.link.propertyId, quotes.map((q) => q.roomType.id), checkIn, checkOut);

    const rooms = quotes
      .map((q) => ({ ...q, available: availability.get(q.roomType.id)?.available ?? 0 }))
      .filter((q) => q.available > 0);

    res.json({
      hotel: { linkId: ctx.link.id, property: ctx.link.property, bookingMode: ctx.link.bookingMode },
      checkIn: parsed.data.checkIn, checkOut: parsed.data.checkOut,
      rooms,
    });
  } catch (err) {
    console.error("[agent.portal] availability failed", err);
    res.status(500).json({ error: "Availability could not be loaded" });
  }
}) as RequestHandler);

// Create a booking: request-to-book (HELD) or instant confirm (CONFIRMED).
router.post("/hotels/:linkId/book", limitNrmsAgentBookingCreate as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Complete the booking details", details: parsed.error.flatten() });
    if (parsed.data.rooms > parsed.data.adults) {
      return res.status(400).json({
        error: "Add at least one adult for every room. Guest details can be completed after the booking is secured.",
        code: "ADULT_PER_ROOM_REQUIRED",
      });
    }
    const ctx = await loadBookableLink(req, res, Number(req.params.linkId));
    if (!ctx) return;
    const checkIn = dateOnly(parsed.data.checkIn);
    const checkOut = dateOnly(parsed.data.checkOut);
    const today = dateOnly(new Date().toISOString().slice(0, 10));
    const stayNights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
    if (!Number.isFinite(checkIn.getTime()) || !Number.isFinite(checkOut.getTime()) || checkIn < today || checkOut <= checkIn || stayNights > 365) return res.status(400).json({ error: "Stay dates must be valid, in the future, and no longer than 365 nights" });

    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe("SELECT id FROM `nrms_agent_account` WHERE id = ? FOR UPDATE", ctx.account.id);
      await lockAgentPartnership(tx, ctx.link.id);
      await lockAgentSeatAllocation(tx, ctx.link.propertyId);
      await lockPropertyInventory(tx, ctx.link.propertyId);
      const [freshLink, payg] = await Promise.all([
        tx.nrmsAgentPropertyLink.findFirst({
          where: { id: ctx.link.id, agentAccountId: ctx.account.id, status: "ACTIVE" },
          select: { id: true, propertyId: true, status: true, initiatedBy: true, hotelConsentStatus: true, agentConsentStatus: true, currency: true, bookingMode: true, agentAccount: { select: { status: true, verificationStatus: true } }, property: { select: { id: true, title: true, ownerId: true, status: true, nrmsActivatedAt: true, nrmsGuestPayInstructions: true } } },
        }),
        tx.ownerPaygAccount.findUnique({ where: { propertyId: ctx.link.propertyId }, select: { status: true } }),
      ]);
      if (!freshLink || !freshLink.property) {
        return { ok: false as const, reason: "ACCESS_REVOKED", message: "Your access to this hotel changed before the booking completed." };
      }
      const bookingPolicy = canBookPartnership({
        linkStatus: freshLink.status,
        initiatedBy: freshLink.initiatedBy,
        hotelConsentStatus: freshLink.hotelConsentStatus,
        agentConsentStatus: freshLink.agentConsentStatus,
        agencyStatus: freshLink.agentAccount.status,
        agencyVerificationStatus: freshLink.agentAccount.verificationStatus,
        propertyStatus: freshLink.property.status,
        propertyNrmsActivated: Boolean(freshLink.property.nrmsActivatedAt),
        paygStatus: payg?.status,
      });
      if (!bookingPolicy.ok) {
        return { ok: false as const, reason: bookingPolicy.reason, message: bookingPolicy.message };
      }

      // The agency account row is locked above, so this read and the create
      // below are serialized even when a browser or proxy retries the request.
      // Returning the original request is safer than asking inventory to guess
      // whether two identical payloads were intentional.
      const duplicate = await tx.nrmsAgentBookingRequest.findUnique({
        where: {
          linkId_clientMutationId: {
            linkId: freshLink.id,
            clientMutationId: parsed.data.clientMutationId,
          },
        },
        select: {
          id: true,
          status: true,
          reservationId: true,
          quotedTotal: true,
          currency: true,
          holdExpiresAt: true,
          reservation: { select: { status: true } },
        },
      });
      if (duplicate) {
        return {
          ok: true as const,
          reservationId: duplicate.reservationId!,
          requestId: duplicate.id,
          status: duplicate.reservation?.status === "CONFIRMED" ? "CONFIRMED" as const : "HELD" as const,
          holdExpiresAt: duplicate.holdExpiresAt,
          bookingTotal: Number(duplicate.quotedTotal),
          currency: duplicate.currency,
          property: freshLink.property,
          idempotent: true,
        };
      }
      const activeExposure = await tx.nrmsAgentBookingRequest.count({ where: { link: { agentAccountId: ctx.account.id }, status: { in: ["PENDING", "CONFIRMED"] }, checkOut: { gte: new Date() } } });
      if (activeExposure >= 10) return { ok: false as const, reason: "ACTIVE_BOOKING_LIMIT", message: "Settle or complete an existing booking before creating another." };

      // Re-authorize rate access and compute the final price under the same lock
      // that protects the subsequent inventory allocation.
      const quote = await quoteAgentRoom(tx, {
        linkId: freshLink.id, propertyId: freshLink.propertyId, checkIn, checkOut,
        // Capacity is a per-room rule while the booking payload carries totals.
        // Quote against the busiest room in an even distribution.
        adults: Math.ceil(parsed.data.adults / parsed.data.rooms),
        children: Math.ceil(parsed.data.children / parsed.data.rooms),
        roomTypeId: parsed.data.roomTypeId, currency: freshLink.currency,
      });
      if (!quote || quote.ratePlan.id !== parsed.data.ratePlanId) {
        return { ok: false as const, reason: "RATE_UNAVAILABLE", message: "That room or rate is not available to you anymore." };
      }
      const bookingTotal = Number((quote.total * parsed.data.rooms).toFixed(2));
      const held = await createAgentHold(tx, {
        // Agent inventory is always owner-reviewed. Commercial link terms may
        // still say INSTANT for legacy rows, but this workflow never bypasses
        // the hotel's booking and invoice decisions.
        link: { id: freshLink.id, propertyId: freshLink.propertyId, ownerId: freshLink.property.ownerId, bookingMode: "REQUEST" },
        clientMutationId: parsed.data.clientMutationId,
        roomTypeId: parsed.data.roomTypeId,
        ratePlanId: quote.ratePlan.id,
        mealPlan: quote.ratePlan.mealPlan,
        checkIn, checkOut,
        adults: parsed.data.adults, children: parsed.data.children, roomsRequested: parsed.data.rooms,
        incidentalBilling: parsed.data.incidentalBilling,
        quote: { currency: quote.currency, nightly: quote.nightly, subtotal: quote.subtotal, tax: quote.tax, fees: quote.fees, total: quote.total },
        createdByUserId: req.user!.id,
        inventoryLocked: true,
        notes: parsed.data.notes ?? null,
      });
      return { ...held, bookingTotal, currency: quote.currency, property: freshLink.property, idempotent: false };
    }, HOLD_TX);

    if (!result.ok) {
      const code = result.reason === "NO_AVAILABILITY" ? 409 : 409;
      return res.status(code).json({ error: result.message, code: result.reason });
    }
    // Request-to-book needs the hotel's attention before the hold lapses.
    if (result.status === "HELD" && !result.idempotent) {
      void notifyOwner(ctx.link.property!.ownerId, "nrms_agent_booking_request", {
        agencyName: ctx.account.legalName, propertyTitle: ctx.link.property!.title,
        rooms: parsed.data.rooms, checkIn: parsed.data.checkIn, checkOut: parsed.data.checkOut, requestId: result.requestId,
      });
    }
    res.status(201).json({
      requestId: result.requestId,
      status: result.status,
      holdExpiresAt: result.holdExpiresAt,
      instant: false,
      total: result.bookingTotal,
      currency: result.currency,
      paymentToken: null,
      paymentDueAt: null,
      idempotent: result.idempotent,
    });
  } catch (err) {
    console.error("[agent.portal] book failed", err);
    res.status(500).json({ error: "The booking could not be created" });
  }
}) as RequestHandler);

// The agent's bookings across all their hotels.
router.get("/bookings", (async (req: AuthedRequest, res: Response) => {
  try {
    const account = await loadAgentAccount(req, res);
    if (!account) return;
    const rows = await prisma.nrmsAgentBookingRequest.findMany({
      where: { link: { agentAccountId: account.id } },
      select: {
        id: true, status: true, checkIn: true, checkOut: true, adults: true, children: true, roomsRequested: true,
        currency: true, quotedTotal: true, holdExpiresAt: true, createdAt: true,
        incidentalBilling: true, guestManifestStatus: true, guestManifestSubmittedAt: true, guestManifestReviewedAt: true, guestManifestReviewNote: true,
        guests: { select: { id: true, fullName: true, documentKey: true } },
        link: { select: { property: { select: { id: true, title: true } } } },
        reservation: { select: { receiptNumber: true, status: true, amountPaid: true, totalAmount: true } },
        masterFolio: { include: agentInvoiceInclude() },
      },
      orderBy: { id: "desc" },
      take: 200,
    });
    res.json({
      bookings: rows.map((r) => {
        return {
          id: r.id, status: r.status,
          property: r.link?.property ?? null,
          checkIn: r.checkIn, checkOut: r.checkOut, adults: r.adults, children: r.children, rooms: r.roomsRequested,
          currency: r.currency, total: Number(r.quotedTotal), holdExpiresAt: r.holdExpiresAt,
          receiptNumber: r.reservation?.receiptNumber ?? null, reservationStatus: r.reservation?.status ?? null,
          payment: null,
          commercial: commercialSummary(r),
          amountPaid: Number(r.reservation?.amountPaid ?? 0),
          manifest: manifestSummary(r),
          createdAt: r.createdAt,
        };
      }),
    });
  } catch (err) {
    console.error("[agent.portal] bookings failed", err);
    res.status(500).json({ error: "Failed to load your bookings" });
  }
}) as RequestHandler);

// One booking's detail (scoped to the agent's account).
router.get("/bookings/:requestId", (async (req: AuthedRequest, res: Response) => {
  try {
    const account = await loadAgentAccount(req, res);
    if (!account) return;
    const r = await prisma.nrmsAgentBookingRequest.findFirst({
      where: { id: Number(req.params.requestId), link: { agentAccountId: account.id } },
      select: {
        id: true, status: true, checkIn: true, checkOut: true, adults: true, children: true, roomsRequested: true,
        currency: true, quotedTotal: true, holdExpiresAt: true, decidedAt: true, decisionReason: true, notes: true, createdAt: true,
        incidentalBilling: true, guestManifestStatus: true, guestManifestSubmittedAt: true, guestManifestReviewedAt: true, guestManifestReviewNote: true,
        guests: { select: { id: true, fullName: true, documentKey: true } },
        link: { select: { bookingMode: true, property: { select: { id: true, title: true } } } },
        reservation: { select: { receiptNumber: true, status: true, checkIn: true, checkOut: true } },
        masterFolio: { include: agentInvoiceInclude() },
      },
    });
    if (!r) return res.status(404).json({ error: "Booking not found" });
    res.json({ booking: {
      id: r.id, status: r.status, bookingMode: r.link?.bookingMode ?? null,
      property: r.link?.property ?? null,
      checkIn: r.checkIn, checkOut: r.checkOut, adults: r.adults, children: r.children, rooms: r.roomsRequested,
      currency: r.currency, total: Number(r.quotedTotal), holdExpiresAt: r.holdExpiresAt,
      decidedAt: r.decidedAt, decisionReason: r.decisionReason, notes: r.notes,
      receiptNumber: r.reservation?.receiptNumber ?? null, reservationStatus: r.reservation?.status ?? null,
      manifest: manifestSummary(r),
      commercial: commercialSummary(r),
      createdAt: r.createdAt,
    } });
  } catch (err) {
    console.error("[agent.portal] booking detail failed", err);
    res.status(500).json({ error: "Failed to load the booking" });
  }
}) as RequestHandler);

// Guest manifest for an already secured/approved agent booking. Saving names
// never touches inventory; the existing reservation remains the single source
// of truth for rooms and price.
router.get("/bookings/:requestId/manifest", (async (req: AuthedRequest, res: Response) => {
  try {
    const loaded = await loadOwnedAgentBooking(req, res, Number(req.params.requestId));
    if (!loaded) return;
    const { booking } = loaded;
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      booking: {
        id: booking.id,
        status: booking.status,
        property: booking.link?.property ?? null,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        adults: booking.adults,
        children: booking.children,
        rooms: booking.roomsRequested,
        receiptNumber: booking.reservation?.receiptNumber ?? null,
        payment: null,
      },
      commercial: commercialSummary(booking),
      manifest: manifestSummary(booking),
      guests: booking.guests.map((guest: any) => ({
        id: guest.id,
        roomNumber: guest.roomNumber,
        guestType: guest.guestType,
        isLead: guest.isLead,
        fullName: guest.fullName,
        phone: guest.phone,
        email: guest.email,
        nationality: guest.nationality,
        dateOfBirth: guest.dateOfBirth ? guest.dateOfBirth.toISOString().slice(0, 10) : null,
        documentType: guest.documentType,
        documentNumber: guest.documentNumber,
        documentExpiry: guest.documentExpiry ? guest.documentExpiry.toISOString().slice(0, 10) : null,
        documentKey: guest.documentKey,
        documentMimeType: guest.documentMimeType,
        documentResourceType: guest.documentResourceType,
        status: guest.status,
        reviewNote: guest.reviewNote,
      })),
      editable: booking.status === "CONFIRMED" && booking.reservation?.status === "CONFIRMED" && ["SETTLED", "CREDIT"].includes(String(booking.masterFolio?.status || "")) && !["SUBMITTED", "VERIFIED"].includes(booking.guestManifestStatus),
    });
  } catch (err) {
    console.error("[agent.portal] manifest load failed", err);
    res.status(500).json({ error: "Guest details could not be loaded" });
  }
}) as RequestHandler);

router.put("/bookings/:requestId/manifest", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = manifestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Complete each traveller's required identity details", details: parsed.error.flatten() });
    const loaded = await loadOwnedAgentBooking(req, res, Number(req.params.requestId));
    if (!loaded) return;
    const { booking } = loaded;
    if (booking.status !== "CONFIRMED" || booking.reservation?.status !== "CONFIRMED") {
      return res.status(409).json({ error: "Guest details open after the hotel has confirmed the booking", code: "BOOKING_NOT_CONFIRMED" });
    }
    if (!["SETTLED", "CREDIT"].includes(String(booking.masterFolio?.status || ""))) {
      return res.status(409).json({ error: "Guest details open after the hotel confirms receipt of the invoice payment", code: "PAYMENT_CONFIRMATION_REQUIRED" });
    }
    if (booking.guestManifestStatus === "VERIFIED") {
      return res.status(409).json({ error: "The hotel already verified this guest manifest. Ask the hotel to return it before changing identity details.", code: "MANIFEST_LOCKED" });
    }
    if (booking.guestManifestStatus === "SUBMITTED") {
      return res.status(409).json({ error: "This manifest is being reviewed by the hotel. You can edit it only if the hotel returns it for correction.", code: "MANIFEST_UNDER_REVIEW" });
    }

    const data = parsed.data;
    const expectedAdults = Number(booking.adults);
    const expectedChildren = Number(booking.children);
    const expectedGuests = expectedAdults + expectedChildren;
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    const issue = (error: string, code: string) => res.status(400).json({ error, code });
    const bookingDocumentPrefix = `agent-traveller-documents/booking-${booking.id}/`;
    if (data.guests.some((guest) => guest.documentKey && !guest.documentKey.startsWith(bookingDocumentPrefix))) {
      return issue("Upload every identity document from this booking's protected traveller workspace", "INVALID_DOCUMENT_SCOPE");
    }
    if (data.guests.some((guest) => guest.roomNumber > booking.roomsRequested)) return issue("Assign every traveller to one of the rooms in this booking", "INVALID_ROOM_ASSIGNMENT");
    if (data.guests.some((guest) => guest.dateOfBirth && dateOnly(guest.dateOfBirth) >= checkIn)) return issue("Every date of birth must be before check-in", "INVALID_DATE_OF_BIRTH");
    if (data.guests.some((guest) => guest.documentExpiry && dateOnly(guest.documentExpiry) < checkOut)) return issue("Identity documents must remain valid through check-out", "DOCUMENT_EXPIRES_BEFORE_CHECKOUT");
    if (data.submit) {
      const adultCount = data.guests.filter((guest) => guest.guestType === "ADULT").length;
      const childCount = data.guests.filter((guest) => guest.guestType === "CHILD").length;
      if (data.guests.length !== expectedGuests || adultCount !== expectedAdults || childCount !== expectedChildren) {
        return issue(`Add exactly ${expectedAdults} adult(s) and ${expectedChildren} child(ren) before submitting`, "GUEST_COUNT_MISMATCH");
      }
      if (data.guests.filter((guest) => guest.isLead).length !== 1) return issue("Choose exactly one lead guest", "LEAD_GUEST_REQUIRED");
      if (data.guests.some((guest) => !guest.fullName || guest.fullName.length < 2 || !guest.nationality || guest.nationality.length < 2 || !guest.dateOfBirth || !guest.documentType || !guest.documentNumber || guest.documentNumber.length < 2 || !guest.documentKey)) {
        return issue("Complete every traveller's legal name, nationality, birth date and protected identity document before submitting", "MANIFEST_INCOMPLETE");
      }
      for (let roomNumber = 1; roomNumber <= booking.roomsRequested; roomNumber += 1) {
        if (!data.guests.some((guest) => guest.roomNumber === roomNumber && guest.guestType === "ADULT")) {
          return issue(`Room ${roomNumber} needs at least one adult`, "ADULT_PER_ROOM_REQUIRED");
        }
      }
    }

    const nextStatus = data.submit ? "SUBMITTED" : data.guests.length ? "IN_PROGRESS" : "NOT_STARTED";
    const agencyCovers = data.incidentalBilling === "AGENCY";
    await prisma.$transaction(async (tx: any) => {
      await tx.nrmsAgentBookingGuest.deleteMany({ where: { bookingRequestId: booking.id } });
      if (data.guests.length) {
        await tx.nrmsAgentBookingGuest.createMany({
          data: data.guests.map((guest) => ({
            bookingRequestId: booking.id,
            roomNumber: guest.roomNumber,
            guestType: guest.guestType,
            isLead: guest.isLead,
            fullName: guest.fullName ? sanitizeText(guest.fullName) : null,
            phone: guest.phone ? sanitizeText(guest.phone) : null,
            email: guest.email ? guest.email.toLowerCase() : null,
            nationality: guest.nationality ? sanitizeText(guest.nationality) : null,
            dateOfBirth: guest.dateOfBirth ? dateOnly(guest.dateOfBirth) : null,
            documentType: guest.documentType ?? null,
            documentNumber: guest.documentNumber ? sanitizeText(guest.documentNumber) : null,
            documentExpiry: guest.documentExpiry ? dateOnly(guest.documentExpiry) : null,
            documentKey: guest.documentKey ?? null,
            documentMimeType: guest.documentMimeType ?? null,
            documentResourceType: guest.documentResourceType,
            status: "PENDING",
            reviewNote: null,
          })),
        });
      }
      await tx.nrmsAgentBookingRequest.update({
        where: { id: booking.id },
        data: {
          incidentalBilling: data.incidentalBilling,
          // Guests settling their own extras leaves nothing for the agency to
          // cover, so the cover fields are cleared rather than left stale.
          incidentalScope: agencyCovers ? data.incidentalScope ?? "ALL" : null,
          incidentalCategories: agencyCovers && data.incidentalScope === "SELECTED" ? (data.incidentalCategories ?? []) : null,
          incidentalCapAmount: agencyCovers ? data.incidentalCapAmount ?? null : null,
          incidentalCapBasis: agencyCovers && data.incidentalCapAmount != null ? data.incidentalCapBasis ?? null : null,
          guestManifestStatus: nextStatus,
          guestManifestSubmittedAt: data.submit ? new Date() : null,
          guestManifestReviewedAt: null,
          guestManifestReviewedById: null,
          guestManifestReviewNote: null,
        },
      });
      if (data.submit && booking.reservationId) {
        await tx.reservationEvent.create({ data: { reservationId: booking.reservationId, type: "AGENT_MANIFEST_SUBMITTED", actorId: req.user!.id, data: { bookingRequestId: booking.id, guests: data.guests.length, incidentalBilling: data.incidentalBilling } } });
      }
    });
    if (data.submit && booking.link?.property?.ownerId) {
      await notifyOwner(booking.link.property.ownerId, "nrms_agent_guest_manifest_submitted", {
        requestId: booking.id,
        propertyTitle: booking.link.property.title,
        agencyName: loaded.account.legalName,
        guests: data.guests.length,
        incidentalBilling: data.incidentalBilling,
      });
    }
    const saved = await prisma.nrmsAgentBookingRequest.findUnique({ where: { id: booking.id }, include: { guests: true } });
    res.json({ ok: true, manifest: manifestSummary(saved), message: data.submit ? "Guest manifest submitted to the hotel for verification." : "Guest details saved." });
  } catch (err) {
    console.error("[agent.portal] manifest save failed", err);
    res.status(500).json({ error: "Guest details could not be saved" });
  }
}) as RequestHandler);

// ---------------------------------------------------------------------------
// Import a traveller roster from a tour booking the same account already owns.
//
// The tour roster lives in TourBooking.metadata.groupMembers, not in the
// tour_travelers table (that table is in the schema but no route writes it).
// Nothing here writes to the manifest: the operator reviews the returned rows
// in the browser and saves them through the existing manifest endpoint, so the
// import adds no new write surface.
// ---------------------------------------------------------------------------
const tourRosterSchema = z.object({ code: z.string().trim().min(4).max(40) }).strict();
const ROSTER_DOCUMENT_TYPES = new Set(["PASSPORT", "NATIONAL_ID", "OTHER"]);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const rosterText = (value: unknown, max: number) => {
  const text = sanitizeText(typeof value === "string" ? value : "").trim();
  return text ? text.slice(0, max) : null;
};
const rosterDate = (value: unknown) => {
  const text = typeof value === "string" ? value.trim().slice(0, 10) : "";
  return DATE_ONLY.test(text) ? text : null;
};

/** Age at check-in decides adult or child. Without a birth date the operator
 * keeps whatever the card already had, so nothing is silently reclassified. */
function rosterGuestType(dateOfBirth: string | null, checkIn: Date | string) {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const stay = new Date(checkIn);
  if (Number.isNaN(born.getTime()) || Number.isNaN(stay.getTime())) return null;
  let age = stay.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = stay.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && stay.getUTCDate() < born.getUTCDate())) age -= 1;
  return age < 18 ? "CHILD" : "ADULT";
}

function mapRosterMember(member: any, checkIn: Date | string) {
  const documentTypeRaw = String(member?.documentType || "").toUpperCase();
  const dateOfBirth = rosterDate(member?.dateOfBirth);
  const documentNumber = rosterText(member?.documentNumber, 100);
  const nationality = rosterText(member?.nationality, 80);
  const fullName = rosterText(member?.fullName, 160);
  // The tour side stores a plain Cloudinary URL, but this manifest serves
  // identity documents through the protected key service. A URL cannot be
  // promoted into a key, so the file is reported as "held on the trip" and the
  // operator re-attaches it here.
  const documentOnFile = Boolean(rosterText(member?.documentUrl, 1000)) || (Array.isArray(member?.documents) && member.documents.length > 0);
  const missing: string[] = [];
  if (!fullName) missing.push("Full legal name");
  if (!nationality) missing.push("Nationality");
  if (!dateOfBirth) missing.push("Date of birth");
  if (!documentNumber) missing.push("Document number");
  missing.push("Identity document upload");
  return {
    sourceId: rosterText(member?.id, 60),
    fullName,
    nationality,
    phone: rosterText(member?.phone, 40),
    email: rosterText(member?.email, 160),
    dateOfBirth,
    documentType: ROSTER_DOCUMENT_TYPES.has(documentTypeRaw) ? documentTypeRaw : null,
    documentNumber,
    documentExpiry: rosterDate(member?.documentExpiry),
    guestType: rosterGuestType(dateOfBirth, checkIn),
    documentOnFile,
    permitStatus: rosterText(member?.permitStatus, 40),
    missing,
  };
}

router.post("/bookings/:requestId/manifest/tour-roster", limitAgentTourRosterLookup as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = tourRosterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter the tour booking code" });
    const loaded = await loadOwnedAgentBooking(req, res, Number(req.params.requestId));
    if (!loaded) return;
    const { booking } = loaded;
    const code = parsed.data.code.toUpperCase();

    // Ownership, not possession of the code, is what opens the roster. The
    // caller must be the operator who received the trip, or the customer who
    // booked it. Anything else is a 404 so the endpoint cannot confirm which
    // codes are real.
    const operator = String(req.user?.role || "").toUpperCase() === "AGENT"
      ? await prisma.agent.findUnique({ where: { userId: req.user!.id }, select: { id: true } })
      : null;
    const ownership: any[] = [{ customerId: req.user!.id }];
    if (operator?.id) ownership.push({ operatorAgentId: operator.id });
    const tour = await prisma.tourBooking.findFirst({
      where: { bookingCode: code, OR: ownership },
      select: { id: true, bookingCode: true, title: true, destination: true, startDate: true, endDate: true, travelerCount: true, metadata: true },
    });
    if (!tour) {
      await audit(req, "NRMS_AGENT_TOUR_ROSTER_LOOKUP_MISS", "TOUR_BOOKING", null, { code, requestId: booking.id }, null);
      return res.status(404).json({ error: "No tour booking with that code was found in this account", code: "TOUR_NOT_FOUND" });
    }

    const metadata = tour.metadata && typeof tour.metadata === "object" && !Array.isArray(tour.metadata) ? tour.metadata as Record<string, any> : {};
    const members = Array.isArray(metadata.groupMembers) ? metadata.groupMembers : [];
    const travellers = members.map((member: any) => mapRosterMember(member, booking.checkIn)).filter((traveller) => traveller.fullName || traveller.documentNumber);

    await audit(req, "NRMS_AGENT_TOUR_ROSTER_IMPORT", "TOUR_BOOKING", null, { requestId: booking.id, travellers: travellers.length }, tour.id);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      tour: {
        code: tour.bookingCode,
        title: tour.title,
        destination: tour.destination,
        startDate: tour.startDate,
        endDate: tour.endDate,
        travellerCount: tour.travelerCount,
      },
      travellers,
      requiredGuests: Number(booking.adults ?? 0) + Number(booking.children ?? 0),
    });
  } catch (err) {
    console.error("[agent.portal] tour roster import failed", err);
    res.status(500).json({ error: "The tour roster could not be loaded" });
  }
}) as RequestHandler);

const agentInvoiceRecordInclude = {
  masterFolio: {
    include: {
      payments: { orderBy: { createdAt: "asc" as const } },
      refunds: { orderBy: { createdAt: "asc" as const } },
      block: true,
      agentBookingRequest: { include: { link: { include: { agentAccount: true } } } },
    },
  },
};

async function loadAgentInvoice(req: AuthedRequest, res: Response, requestId: number, invoiceId: number) {
  const account = await loadAgentAccount(req, res);
  if (!account) return null;
  const record = await prisma.nrmsMasterFolioProForma.findFirst({
    where: { id: invoiceId, masterFolio: { agentBookingRequestId: requestId, agentBookingRequest: { link: { agentAccountId: account.id } } } },
    include: agentInvoiceRecordInclude,
  });
  if (!record) { res.status(404).json({ error: "Invoice not found" }); return null; }
  return { account, record };
}

router.get("/bookings/:requestId/invoices/:invoiceId/pdf", (async (req: AuthedRequest, res: Response) => {
  try {
    const loaded = await loadAgentInvoice(req, res, Number(req.params.requestId), Number(req.params.invoiceId));
    if (!loaded) return;
    const pdf = await renderMasterProFormaPdf(loaded.record);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${loaded.record.number}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    console.error("[agent.portal] invoice PDF failed", err);
    res.status(500).json({ error: "The invoice PDF could not be opened" });
  }
}) as RequestHandler);

router.post("/bookings/:requestId/invoices/:invoiceId/mark-paid", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = invoicePaidSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message === "Name the account the payment came from" ? "Name the account the payment came from" : "Choose how you paid and enter the transfer reference so the hotel can trace it", code: "PAYMENT_DECLARATION_INCOMPLETE" });
    const requestId = Number(req.params.requestId);
    const loaded = await loadAgentInvoice(req, res, requestId, Number(req.params.invoiceId));
    if (!loaded) return;
    if (loaded.record.status !== "SENT" || loaded.record.supersededAt) return res.status(409).json({ error: "Only the latest invoice sent by the hotel can be declared paid", code: "CURRENT_SENT_INVOICE_REQUIRED" });
    if (["SETTLED", "CREDIT"].includes(String(loaded.record.masterFolio.status))) return res.status(409).json({ error: "The hotel already confirmed this payment", code: "PAYMENT_COMPLETE" });
    const updated = await prisma.nrmsMasterFolioProForma.update({
      where: { id: loaded.record.id },
      data: {
        payerMarkedPaidAt: new Date(),
        payerMarkedPaidById: req.user!.id,
        payerPaymentReference: sanitizeText(parsed.data.reference),
        payerPaymentMethod: parsed.data.method,
        payerPaymentAccountName: parsed.data.method === "CASH" ? null : sanitizeText(parsed.data.accountName!),
      },
      include: agentInvoiceRecordInclude,
    });
    const booking = updated.masterFolio.agentBookingRequest;
    if (booking?.propertyId) {
      const property = await prisma.property.findUnique({ where: { id: booking.propertyId }, select: { ownerId: true, title: true } });
      if (property?.ownerId) void notifyOwner(property.ownerId, "nrms_agent_invoice_marked_paid", { requestId, invoiceNumber: updated.number, agencyName: loaded.account.legalName, propertyTitle: property.title, reference: parsed.data.reference, method: parsed.data.method, accountName: parsed.data.accountName ?? null });
    }
    await auditOrThrow(prisma, req, "NRMS_AGENT_INVOICE_MARK_PAID", "NRMS_AGENT_BOOKING_REQUEST", null, { invoiceId: updated.id, reference: parsed.data.reference, method: parsed.data.method, accountName: parsed.data.accountName ?? null }, requestId);
    res.json({ ok: true, invoice: serializeProForma(updated), message: "Payment declared. The hotel must verify its account and confirm receipt before traveller entry opens." });
  } catch (err) {
    console.error("[agent.portal] invoice paid declaration failed", err);
    res.status(500).json({ error: "The payment declaration could not be saved" });
  }
}) as RequestHandler);

router.get("/bookings/:requestId/guests/:guestId/document", (async (req: AuthedRequest, res: Response) => {
  try {
    const loaded = await loadOwnedAgentBooking(req, res, Number(req.params.requestId));
    if (!loaded) return;
    const guest = loaded.booking.guests.find((row: any) => row.id === Number(req.params.guestId));
    if (!guest?.documentKey) return res.status(404).json({ error: "Traveller document not found" });
    const url = signedAgentTravellerDocumentUrl(guest.documentKey, guest.documentResourceType);
    res.setHeader("Cache-Control", "private, no-store");
    res.redirect(302, url);
  } catch (err) {
    console.error("[agent.portal] traveller document failed", err);
    res.status(500).json({ error: "Traveller document could not be opened" });
  }
}) as RequestHandler);

// Download the voucher PDF for a CONFIRMED booking (scoped to the agent).
router.get("/bookings/:requestId/voucher", (async (req: AuthedRequest, res: Response) => {
  try {
    const account = await loadAgentAccount(req, res);
    if (!account) return;
    const readiness = await prisma.nrmsAgentBookingRequest.findFirst({
      where: { id: Number(req.params.requestId), link: { agentAccountId: account.id } },
      select: { masterFolio: { select: { status: true } } },
    });
    if (!readiness) return res.status(404).json({ error: "Booking not found" });
    if (!["SETTLED", "CREDIT"].includes(String(readiness.masterFolio?.status || ""))) {
      return res.status(409).json({ error: "The voucher is released after the hotel confirms receipt of the invoice payment", code: "PAYMENT_CONFIRMATION_REQUIRED" });
    }
    const voucher = await generateAgentVoucher(prisma as any, Number(req.params.requestId), { agentAccountId: account.id });
    if (!voucher) return res.status(404).json({ error: "No voucher is available for this booking yet" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="voucher-${voucher.voucherNumber}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(voucher.pdf);
  } catch (err) {
    console.error("[agent.portal] voucher failed", err);
    res.status(500).json({ error: "The voucher could not be generated" });
  }
}) as RequestHandler);

export default router;
