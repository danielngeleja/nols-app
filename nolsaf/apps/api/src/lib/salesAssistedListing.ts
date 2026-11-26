/**
 * Sales assisted listing: a sales partner lists a property on the owner's
 * behalf (docs/SALES_ASSISTED_LISTING.md).
 *
 * The owner's whole part is two information SMS messages and, later, adding a
 * payout account when money is waiting. So the rules that keep this safe live
 * here, in one place:
 *
 *  - The owner account is created by the system from the phone the partner
 *    entered, with no password. Nobody but the owner ever sets a password: the
 *    owner signs in with an SMS code, or uses the setup link in the "live" SMS.
 *  - The partner can never be the owner (same account, phone or email).
 *  - The property is an ordinary Property owned by the owner. The partner
 *    fills it in through the owner listing handlers, scoped by the
 *    SalesAssistedListing row, only while it is DRAFTING or RETURNED.
 *  - Every SMS carries a "Not expecting this?" link. Using it pauses the
 *    listing at once (and unpublishes it if live) until an admin resolves it.
 */
import crypto from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { normalizePhoneForAuth } from "./authDestination.js";
import { normalizeTzPhone } from "./salesTeamInvites.js";
import { loadPartnerIdentity, phoneKey } from "./salesSelfDealing.js";
import { sendSms } from "./sms.js";
import { webOrigin } from "./salesPartnerCard.js";
import { issuePasswordSetupToken, ONBOARDING_SETUP_HOURS, passwordSetupLink } from "./passwordSetupLink.js";
import { notifyAdmins, notifyOwner, notifyUser } from "./notifications.js";
import { invalidateCache, cacheKeys } from "./performance.js";
import { revokeLongStayFromCancelledListing, withdrawLongStayRequests } from "./longStay/accessRequest.js";
import { regionLeadUserFor } from "./salesRegions.js";

/** Before migration 20261126100000 the request table does not exist; nothing to withdraw then. */
function ignoreMissingRequestTable(error: any) {
  if (error?.code === "P2021") return;
  throw error;
}

const db = prisma as any;

export const ASSISTED_STATUSES = ["DRAFTING", "SUBMITTED", "RETURNED", "APPROVED", "PAUSED_OBJECTION", "CANCELLED"] as const;
export type AssistedStatus = (typeof ASSISTED_STATUSES)[number];

/** The partner may edit the listing only in these states. */
export const ASSISTED_EDITABLE: readonly AssistedStatus[] = ["DRAFTING", "RETURNED"];
/** Listings still in the partner's hands, counted against the open-draft limit. */
export const ASSISTED_OPEN: readonly AssistedStatus[] = ["DRAFTING", "RETURNED"];
export const ASSISTED_MAX_OPEN_DRAFTS = 10;
/** Upheld owner objections after which the partner's assisted listing is paused automatically. */
export const ASSISTED_OBJECTION_PAUSE_THRESHOLD = 2;

/** Lead statuses from which an assisted listing may not start. */
const CLOSED_LEAD = ["CONVERTED", "LOST", "CANCELLED"];

const PROPERTY_TYPES = new Set([
  "VILLA", "APARTMENT", "HOTEL", "LODGE", "CONDO", "GUEST_HOUSE", "BUNGALOW",
  "CABIN", "HOMESTAY", "TOWNHOUSE", "HOUSE", "OTHER",
]);

export class AssistedListingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export type AssistedGate = {
  granted: boolean;
  paused: boolean;
  pauseReason: string | null;
};

export function assistedGateOf(profile: { assistedListingEnabledAt?: Date | null; assistedListingPausedAt?: Date | null; assistedListingPauseReason?: string | null } | null): AssistedGate {
  return {
    granted: Boolean(profile?.assistedListingEnabledAt),
    paused: Boolean(profile?.assistedListingPausedAt),
    pauseReason: profile?.assistedListingPauseReason ?? null,
  };
}

export async function loadAssistedGate(salesPartnerId: number): Promise<AssistedGate> {
  const profile = await db.salesPartnerProfile.findUnique({
    where: { id: salesPartnerId },
    select: { assistedListingEnabledAt: true, assistedListingPausedAt: true, assistedListingPauseReason: true },
  });
  return assistedGateOf(profile);
}

/** Why the partner may not write assisted listings right now, or null. */
export function assistedGateRefusal(gate: AssistedGate): string | null {
  if (!gate.granted) return "Listing for owners is not switched on for your account. Ask NoLSAF to enable it.";
  if (gate.paused) return `Listing for owners is paused on your account${gate.pauseReason ? `: ${gate.pauseReason}` : ""}. Contact NoLSAF.`;
  return null;
}

// ---------------------------------------------------------------------------
// Owner phone and account
// ---------------------------------------------------------------------------

/** The form User.phone is stored in for sign-in (+255…), or null if not a Tanzanian mobile. */
export function canonicalOwnerPhone(raw: string): string | null {
  const tz = normalizeTzPhone(raw);
  return tz ? normalizePhoneForAuth(tz) : null;
}

/** Every stored spelling one Tanzanian mobile number may have on an older account. */
function phoneVariants(canonical: string): string[] {
  const digits = canonical.replace(/\D/g, "");
  const local = digits.slice(-9);
  return [`+255${local}`, `255${local}`, `0${local}`, local];
}

export function maskOwnerPhone(phone: string | null | undefined): string {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length >= 4 ? `+${d.slice(0, 3)} ••• ••${d.slice(-3)}` : "•••";
}

export type OwnerAccountInput = { name: string; phone: string; email?: string | null };
export type OwnerAccountResult = { ownerUserId: number; outcome: "CREATED" | "ATTACHED_EXISTING"; phone: string };

/**
 * Finds or creates the owner account for an assisted listing, inside the
 * caller's transaction. Refuses anything that would let a partner act as the
 * owner or quietly change another kind of account.
 */
export async function resolveOwnerAccount(tx: any, salesPartnerId: number, input: OwnerAccountInput): Promise<OwnerAccountResult> {
  const phone = canonicalOwnerPhone(input.phone);
  if (!phone) throw new AssistedListingError(400, "Enter the owner's Tanzanian mobile number, for example 0712 345 678.");
  const email = input.email ? String(input.email).trim().toLowerCase() : null;

  const identity = await loadPartnerIdentity(tx, salesPartnerId);
  if (!identity) throw new AssistedListingError(403, "Sales partner context required");
  if (identity.phones.has(phoneKey(phone) ?? "") || (email && identity.emails.has(email))) {
    throw new AssistedListingError(409, "The owner must be a different person from you. Enter the owner's own phone number.");
  }

  const byPhone = await tx.user.findFirst({
    where: { phone: { in: phoneVariants(phone) } },
    select: { id: true, role: true, email: true, suspendedAt: true, isDisabled: true },
  });
  const byEmail = email
    ? await tx.user.findFirst({ where: { email }, select: { id: true, role: true } })
    : null;

  if (byPhone) {
    if (byPhone.id === identity.userId) {
      throw new AssistedListingError(409, "The owner must be a different person from you. Enter the owner's own phone number.");
    }
    if (byEmail && byEmail.id !== byPhone.id) {
      throw new AssistedListingError(409, "That email belongs to a different NoLSAF account from the phone number. Leave the email empty or check it.");
    }
    if (byPhone.suspendedAt || byPhone.isDisabled) {
      throw new AssistedListingError(409, "This owner's NoLSAF account cannot take new listings. Contact NoLSAF support.");
    }
    if (String(byPhone.role).toUpperCase() !== "OWNER") {
      // One role per account: never turn a guest, driver or operator into an owner silently.
      throw new AssistedListingError(409, "This phone number already belongs to another kind of NoLSAF account. Contact NoLSAF support to list this property.");
    }
    return { ownerUserId: byPhone.id, outcome: "ATTACHED_EXISTING", phone };
  }

  if (byEmail) {
    throw new AssistedListingError(409, "That email already belongs to another NoLSAF account. Leave the email empty or check it.");
  }

  const name = String(input.name).trim().slice(0, 160);
  const created = await tx.user.create({
    data: {
      role: "OWNER",
      name,
      fullName: name,
      phone,
      // Never the email the partner typed: password reset sends its link to the
      // account email, so a partner-chosen address would let the partner reset
      // the owner's password and take the account. The email stays on the lead
      // as a contact note; the owner adds their own after signing in by SMS.
      email: null,
      // No password. The owner signs in with an SMS code, or sets one from the setup link.
      passwordHash: null,
      registrationSource: "SALES_ASSISTED",
    },
    select: { id: true },
  });
  return { ownerUserId: created.id, outcome: "CREATED", phone };
}

// ---------------------------------------------------------------------------
// Property draft and lead checks
// ---------------------------------------------------------------------------

export function propertyTypeFromLead(value: string | null | undefined): string {
  const key = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return PROPERTY_TYPES.has(key) ? key : "OTHER";
}

export function leadCanStartAssisted(status: string): boolean {
  return !CLOSED_LEAD.includes(status);
}

// ---------------------------------------------------------------------------
// "Not expecting this?" token
// ---------------------------------------------------------------------------

export function hashNoticeToken(raw: string): string {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

export function newNoticeToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(24).toString("base64url");
  return { raw, hash: hashNoticeToken(raw) };
}

export function isNoticeToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{32}$/.test(raw);
}

export function noticeUrl(raw: string): string {
  return `${webOrigin()}/listing-notice/${encodeURIComponent(raw)}`;
}

function ownerSignInUrl(): string {
  const next = encodeURIComponent("/owner/payouts");
  return `${webOrigin()}/account/login?next=${next}`;
}

function firstName(name: string | null | undefined): string {
  const first = String(name || "").trim().split(/\s+/)[0];
  return first || "there";
}

function supportPhone(): string {
  return process.env.SUPPORT_PHONE || process.env.NOLSAF_SUPPORT_PHONE || "NoLSAF support";
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

export function noticeSmsText(input: { ownerName: string; partnerName: string; propertyName: string; noticeLink: string }): string {
  return `Habari ${firstName(input.ownerName)}. ${input.partnerName}, a NoLSAF sales partner, is preparing ${input.propertyName} to go live on NoLSAF for you. You do not need to do anything now. Not expecting this? ${input.noticeLink} or call ${supportPhone()}.`;
}

export function liveSmsText(input: { propertyName: string; signInLink: string; setupLink: string | null; noticeLink: string }): string {
  const setup = input.setupLink ? ` Optional: set a password ${input.setupLink}.` : "";
  return `${input.propertyName} is now live on NoLSAF. View it and set up how you get paid: ${input.signInLink}.${setup} Not expecting this? ${input.noticeLink}`;
}

/**
 * SMS 1. Sent once the listing row exists. The raw token is only ever in this
 * message; the database holds its hash.
 */
export async function sendAssistedNotice(input: {
  assistedId: number;
  ownerUserId: number;
  ownerAccountOutcome: "CREATED" | "ATTACHED_EXISTING";
  ownerPhone: string;
  ownerName: string;
  partnerName: string;
  propertyName: string;
  noticeRaw: string;
}): Promise<boolean> {
  try {
    const noticeLink = noticeUrl(input.noticeRaw);
    const text = noticeSmsText({
      ownerName: input.ownerName,
      partnerName: input.partnerName,
      propertyName: input.propertyName,
      noticeLink,
    });
    // A brand-new account has no SMS preference yet and this notice is its only
    // safeguard, so it always goes. An existing owner's opt-out is respected,
    // and they get the same notice in their NoLSAF inbox instead.
    const existing = input.ownerAccountOutcome === "ATTACHED_EXISTING";
    const result = await sendSms(input.ownerPhone, text, { bypassEligibilityCheck: !existing, sensitiveContent: true });
    if (existing) {
      await notifyOwner(input.ownerUserId, "assisted_listing_started", { partnerName: input.partnerName, propertyTitle: input.propertyName, noticeLink }).catch(() => undefined);
    }
    if (!result?.success || result.provider === "suppressed") {
      // The inbox notice still counts as telling an existing owner.
      if (existing) await db.salesAssistedListing.update({ where: { id: input.assistedId }, data: { noticeSentAt: new Date() } });
      return existing;
    }
    await db.salesAssistedListing.update({ where: { id: input.assistedId }, data: { noticeSentAt: new Date() } });
    return true;
  } catch (error) {
    console.error("[assisted-listing] notice SMS failed", (error as any)?.message ?? error);
    return false;
  }
}

/**
 * Re-issues the notice token. The live SMS needs a working link, and only the
 * hash of the first one was kept, so a fresh token replaces it.
 */
async function rotateNoticeToken(assistedId: number): Promise<string> {
  const token = newNoticeToken();
  await db.salesAssistedListing.update({ where: { id: assistedId }, data: { objectionReferenceHash: token.hash } });
  return token.raw;
}

export function longStaySmsText(input: { ownerName: string; partnerName: string; propertyName: string; noticeLink: string }): string {
  return `Habari ${firstName(input.ownerName)}. NoLSAF switched on monthly rentals (long stay) for ${input.propertyName}, prepared by ${input.partnerName}. You do not need to do anything now. Not expecting this? ${input.noticeLink} or call ${supportPhone()}.`;
}

/**
 * Tells the owner that long stay was switched on from a partner's request
 * (docs/LONG_STAY_RENTALS.md section 15), with a fresh "Not expecting this?"
 * link. Same delivery rule as the first notice: a system-created account
 * always gets the SMS; an existing owner's SMS opt-out is respected and they
 * get it in their inbox. Never throws.
 */
export async function sendLongStayOwnerNotice(assistedId: number): Promise<boolean> {
  try {
    const row = await db.salesAssistedListing.findUnique({
      where: { id: assistedId },
      select: {
        id: true, ownerUserId: true, ownerAccountOutcome: true,
        property: { select: { title: true } },
        owner: { select: { name: true, fullName: true, phone: true } },
        salesPartner: { select: { user: { select: { name: true, fullName: true } } } },
      },
    });
    if (!row?.owner?.phone) return false;
    const noticeLink = noticeUrl(await rotateNoticeToken(row.id));
    const propertyName = row.property?.title || "your property";
    const partnerName = row.salesPartner?.user?.fullName || row.salesPartner?.user?.name || "a NoLSAF sales partner";
    const ownerName = row.owner.fullName || row.owner.name || "";
    const existing = row.ownerAccountOutcome === "ATTACHED_EXISTING";
    const result = await sendSms(row.owner.phone, longStaySmsText({ ownerName, partnerName, propertyName, noticeLink }), { bypassEligibilityCheck: !existing, sensitiveContent: true });
    if (existing) {
      await notifyOwner(row.ownerUserId, "assisted_listing_started", { partnerName, propertyTitle: `${propertyName} (monthly rentals)`, noticeLink }).catch(() => undefined);
    }
    return Boolean(result?.success && result.provider !== "suppressed") || existing;
  } catch (error) {
    console.error("[assisted-listing] long-stay notice failed", (error as any)?.message ?? error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

/**
 * Runs after the shared owner submit handler moved the property to PENDING.
 * Marks the listing submitted and puts the lead into the existing conversion
 * queue, so attribution is verified through the usual admin step, not a copy.
 */
export async function onAssistedSubmitted(assistedId: number, actorUserId: number): Promise<void> {
  try {
    const row = await db.salesAssistedListing.findUnique({
      where: { id: assistedId },
      select: {
        id: true,
        leadId: true,
        status: true,
        property: { select: { title: true } },
        salesPartner: { select: { agentCode: true } },
        lead: { select: { status: true } },
      },
    });
    if (!row) return;
    const now = new Date();
    await db.$transaction(async (tx: any) => {
      await tx.salesAssistedListing.updateMany({
        where: { id: row.id, status: { in: [...ASSISTED_EDITABLE] } },
        data: { status: "SUBMITTED", submittedAt: now },
      });
      const moved = await tx.salesLead.updateMany({
        where: { id: row.leadId, status: { notIn: ["CONVERSION_REQUESTED", "CONVERTED", "LOST", "CANCELLED"] } },
        data: { status: "CONVERSION_REQUESTED", conversionRequestedAt: now },
      });
      await tx.salesLeadActivity.create({
        data: {
          leadId: row.leadId,
          createdById: actorUserId,
          type: "STATUS_CHANGED",
          description: moved.count
            ? "Assisted listing submitted for review. Conversion requested for administrator verification."
            : "Assisted listing submitted for review.",
        },
      });
    });
    await notifyAdmins("sales_assisted_listing_submitted", {
      propertyTitle: row.property?.title,
      partnerCode: row.salesPartner?.agentCode,
    }).catch(() => undefined);
  } catch (error) {
    console.error("[assisted-listing] submit hook failed", (error as any)?.message ?? error);
  }
}

/** Called by the admin property approval. Sends SMS 2 and tells the partner. */
export async function onAssistedPropertyApproved(propertyId: number): Promise<void> {
  try {
    const row = await db.salesAssistedListing.findUnique({
      where: { propertyId },
      select: {
        id: true,
        status: true,
        ownerUserId: true,
        ownerAccountOutcome: true,
        property: { select: { title: true } },
        owner: { select: { phone: true, passwordHash: true } },
        salesPartner: { select: { userId: true } },
      },
    });
    if (!row || row.status !== "SUBMITTED") return;
    const moved = await db.salesAssistedListing.updateMany({
      where: { id: row.id, status: "SUBMITTED" },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
    if (moved.count !== 1) return;

    const noticeRaw = await rotateNoticeToken(row.id);
    // A setup link only for an owner who has no password yet. An existing
    // owner's own password and reset token are never touched.
    let setupLink: string | null = null;
    if (!row.owner?.passwordHash) {
      const { raw } = await issuePasswordSetupToken(row.ownerUserId, ONBOARDING_SETUP_HOURS);
      setupLink = passwordSetupLink(webOrigin(), raw, { onboarding: true, next: "/owner" });
    }
    if (row.owner?.phone) {
      const text = liveSmsText({
        propertyName: row.property?.title || "Your property",
        signInLink: ownerSignInUrl(),
        setupLink,
        noticeLink: noticeUrl(noticeRaw),
      });
      const existing = row.ownerAccountOutcome === "ATTACHED_EXISTING";
      const sent = await sendSms(row.owner.phone, text, { bypassEligibilityCheck: !existing, sensitiveContent: true }).catch(() => null);
      if (existing) {
        await notifyOwner(row.ownerUserId, "assisted_listing_live", { propertyTitle: row.property?.title, noticeLink: noticeUrl(noticeRaw) }).catch(() => undefined);
      }
      if (sent?.success && sent.provider !== "suppressed") {
        await db.salesAssistedListing.update({ where: { id: row.id }, data: { liveNoticeSentAt: new Date() } });
      }
    }
    await notifyUser(row.salesPartner.userId, "sales_assisted_listing_approved", { propertyTitle: row.property?.title }).catch(() => undefined);
  } catch (error) {
    console.error("[assisted-listing] approve hook failed", (error as any)?.message ?? error);
  }
}

/** Called by the admin property rejection: the listing goes back to the partner. */
export async function onAssistedPropertyRejected(propertyId: number, reasons: string[], note?: string | null): Promise<void> {
  try {
    const row = await db.salesAssistedListing.findUnique({
      where: { propertyId },
      select: { id: true, status: true, property: { select: { title: true } }, salesPartner: { select: { userId: true } } },
    });
    if (!row || row.status !== "SUBMITTED") return;
    const moved = await db.salesAssistedListing.updateMany({
      where: { id: row.id, status: "SUBMITTED" },
      data: { status: "RETURNED", returnedAt: new Date(), returnReasons: { reasons, note: note ?? null } },
    });
    if (moved.count !== 1) return;
    const text = [reasons.join("; "), note].filter(Boolean).join(". ");
    await notifyUser(row.salesPartner.userId, "sales_assisted_listing_returned", {
      propertyTitle: row.property?.title,
      reasons: text ? `Reason: ${text}.` : "",
    }).catch(() => undefined);
  } catch (error) {
    console.error("[assisted-listing] reject hook failed", (error as any)?.message ?? error);
  }
}

// ---------------------------------------------------------------------------
// Releasing an account made by mistake
// ---------------------------------------------------------------------------

/**
 * When a listing is cancelled, the owner account the system created for it is
 * released if nobody ever used it: no sign-in (phone never verified by a code,
 * no password) and nothing else of theirs on NoLSAF. Its phone and email are
 * cleared and it is disabled, so a mistyped number does not stay blocked for
 * the real person behind it. Accounts in use are never touched.
 */
export async function releaseUnusedOwnerAccount(tx: any, row: { id: number; propertyId: number; ownerUserId: number; ownerAccountOutcome: string }): Promise<boolean> {
  if (row.ownerAccountOutcome !== "CREATED") return false;
  const owner = await tx.user.findUnique({
    where: { id: row.ownerUserId },
    select: { id: true, phoneVerifiedAt: true, emailVerifiedAt: true, passwordHash: true, registrationSource: true },
  });
  if (!owner || owner.registrationSource !== "SALES_ASSISTED") return false;
  if (owner.phoneVerifiedAt || owner.emailVerifiedAt || owner.passwordHash) return false;
  const [otherProperties, otherListings, bookings] = await Promise.all([
    tx.property.count({ where: { ownerId: owner.id, id: { not: row.propertyId } } }),
    tx.salesAssistedListing.count({ where: { ownerUserId: owner.id, id: { not: row.id }, status: { not: "CANCELLED" } } }),
    tx.booking.count({ where: { propertyId: row.propertyId } }),
  ]);
  if (otherProperties > 0 || otherListings > 0 || bookings > 0) return false;
  await tx.user.update({
    where: { id: owner.id },
    data: { phone: null, email: null, isDisabled: true, tokensValidAfter: new Date() },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Objection
// ---------------------------------------------------------------------------

const OBJECTABLE: readonly AssistedStatus[] = ["DRAFTING", "SUBMITTED", "RETURNED", "APPROVED"];

export async function findByNoticeToken(raw: string) {
  if (!isNoticeToken(raw)) return null;
  return db.salesAssistedListing.findUnique({
    where: { objectionReferenceHash: hashNoticeToken(raw) },
    select: {
      id: true,
      status: true,
      objectedAt: true,
      propertyId: true,
      salesPartnerId: true,
      property: { select: { title: true, status: true } },
      salesPartner: { select: { agentCode: true, userId: true, user: { select: { name: true, fullName: true } } } },
    },
  });
}

async function invalidatePropertyCaches(propertyId: number) {
  await Promise.all([
    invalidateCache(cacheKeys.property(propertyId)),
    invalidateCache("properties:list:*"),
    invalidateCache(cacheKeys.adminSummary()),
  ]).catch(() => undefined);
}

/**
 * The owner tapped "Not expecting this?". Pauses the listing at once, and
 * takes it off sale if it was live. Only an admin can cancel or resume it.
 */
export async function recordObjection(raw: string, note: string | null): Promise<"PAUSED" | "ALREADY" | "CLOSED" | "NOT_FOUND"> {
  const row = await findByNoticeToken(raw);
  if (!row) return "NOT_FOUND";
  if (row.status === "PAUSED_OBJECTION") return "ALREADY";
  if (!OBJECTABLE.includes(row.status)) return "CLOSED";
  const now = new Date();
  const moved = await db.$transaction(async (tx: any) => {
    const updated = await tx.salesAssistedListing.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: "PAUSED_OBJECTION", statusBeforeObjection: row.status, objectedAt: now, objectionNote: note },
    });
    if (updated.count !== 1) return false;
    if (row.status === "APPROVED") {
      await tx.property.update({ where: { id: row.propertyId }, data: { status: "SUSPENDED" } });
    }
    // A waiting long-stay request goes with the paused listing (section 15).
    await withdrawLongStayRequests(tx, row.id, now).catch(ignoreMissingRequestTable);
    return true;
  });
  if (!moved) return "ALREADY";
  await invalidatePropertyCaches(row.propertyId);
  await Promise.all([
    notifyAdmins("sales_assisted_listing_objection", {
      propertyTitle: row.property?.title,
      partnerCode: row.salesPartner?.agentCode,
      note,
    }),
    notifyUser(row.salesPartner.userId, "sales_assisted_listing_paused", { propertyTitle: row.property?.title }),
  ]).catch(() => undefined);
  // The partner's Regional lead hears it too (docs/SALES_REGIONS.md).
  const regionLead = await regionLeadUserFor(db, row.salesPartnerId);
  if (regionLead) {
    await notifyUser(regionLead.userId, "sales_region_owner_objection", {
      propertyTitle: row.property?.title,
      partnerName: row.salesPartner?.user?.fullName || row.salesPartner?.user?.name || row.salesPartner?.agentCode,
      actionPath: "/sales/region",
    }).catch(() => undefined);
  }
  return "PAUSED";
}

/**
 * Admin decision on a paused listing. RESUME restores the previous state (and
 * puts a live listing back on sale); CANCEL takes it off NoLSAF for good and
 * may pause the partner's assisted listing right.
 */
export async function resolveObjection(input: { assistedId: number; outcome: "RESUME" | "CANCEL"; adminUserId: number; reason: string }) {
  const row = await db.salesAssistedListing.findUnique({
    where: { id: input.assistedId },
    select: { id: true, status: true, statusBeforeObjection: true, propertyId: true, salesPartnerId: true, ownerUserId: true, ownerAccountOutcome: true, property: { select: { title: true } }, salesPartner: { select: { userId: true } } },
  });
  if (!row) throw new AssistedListingError(404, "Assisted listing not found");
  if (row.status !== "PAUSED_OBJECTION") throw new AssistedListingError(409, "Only a paused listing can be resolved");
  const now = new Date();
  const before = (row.statusBeforeObjection || "DRAFTING") as AssistedStatus;
  let partnerPaused = false;
  let accountReleased = false;
  await db.$transaction(async (tx: any) => {
    const moved = await tx.salesAssistedListing.updateMany({
      where: { id: row.id, status: "PAUSED_OBJECTION" },
      data: input.outcome === "RESUME"
        ? { status: before, objectionResolvedAt: now, objectionResolvedById: input.adminUserId, objectionOutcome: "RESUME" }
        : { status: "CANCELLED", cancelledAt: now, cancelReason: input.reason, objectionResolvedAt: now, objectionResolvedById: input.adminUserId, objectionOutcome: "CANCEL" },
    });
    if (moved.count !== 1) throw new AssistedListingError(409, "This listing was changed by someone else. Reload.");
    if (input.outcome === "RESUME" && before === "APPROVED") {
      await tx.property.update({ where: { id: row.propertyId }, data: { status: "APPROVED" } });
    }
    if (input.outcome === "CANCEL") {
      await tx.property.update({ where: { id: row.propertyId }, data: { status: "SUSPENDED" } });
      // The owner said they never agreed: a long-stay switch that came only from
      // this listing's request is taken back too (section 15).
      await revokeLongStayFromCancelledListing(tx, row.id, row.ownerUserId, row.propertyId).catch(ignoreMissingRequestTable);
      accountReleased = await releaseUnusedOwnerAccount(tx, row);
      const upheld = await tx.salesAssistedListing.count({ where: { salesPartnerId: row.salesPartnerId, objectionOutcome: "CANCEL" } });
      if (upheld >= ASSISTED_OBJECTION_PAUSE_THRESHOLD) {
        const paused = await tx.salesPartnerProfile.updateMany({
          where: { id: row.salesPartnerId, assistedListingPausedAt: null },
          data: { assistedListingPausedAt: now, assistedListingPauseReason: `${upheld} owners said they did not agree to a listing` },
        });
        partnerPaused = paused.count === 1;
      }
    }
  });
  await invalidatePropertyCaches(row.propertyId);
  if (input.outcome === "CANCEL") {
    await notifyUser(row.salesPartner.userId, "sales_assisted_listing_cancelled", { propertyTitle: row.property?.title, reason: input.reason }).catch(() => undefined);
  }
  return { status: input.outcome === "RESUME" ? before : "CANCELLED", partnerPaused, accountReleased };
}
