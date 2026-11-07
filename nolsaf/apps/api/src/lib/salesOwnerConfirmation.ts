/**
 * Owner confirmation of sales partner attributions.
 *
 * When a lead converts (or a property is reassigned), the property owner is
 * asked one question: "Did this sales partner bring you to NoLSAF?". Their
 * answer is the one piece of attribution evidence a partner cannot produce
 * themselves, so activation waits for it.
 *
 * This is deliberately not a public gate:
 * - an answer is accepted only from the signed-in owner of the property: the
 *   session user must be both the owner recorded on the request and the
 *   property's owner at answer time, and impersonated sessions are refused
 *   (routes/owner.salesConfirmations.ts);
 * - SMS and email carry an opaque reference that opens the owner portal after
 *   sign-in. The reference confirms nothing on its own and only its SHA-256
 *   hash is stored. In-app notifications carry no reference at all;
 * - one open request per attribution (activeKey unique index), with expiry.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { notifyUser } from "./notifications.js";
import { sendMail } from "./mailer.js";
import { sendSms } from "./sms.js";
import { publicLinkSigningSecret } from "./publicLinkSecrets.js";
import { proButton, proDetailRows, proEmail, proNoteCard, BRAND_TEAL } from "./emailBase.js";

const db = prisma as any;
const DAY_MS = 24 * 60 * 60 * 1000;

export const OWNER_CONFIRMATION_TTL_DAYS = 7;
/** Send one in-app reminder when this little time is left. */
const REMINDER_BEFORE_MS = 2 * DAY_MS;

export const OWNER_ANSWERS = ["CONFIRMED", "DENIED", "UNKNOWN_PARTNER"] as const;
export type OwnerAnswer = (typeof OWNER_ANSWERS)[number];

export class OwnerConfirmationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function hashConfirmationReference(reference: string): string {
  return createHash("sha256").update(String(reference)).digest("hex");
}

/** Keyed hash of the answering IP: evidence for a dispute without storing the address. */
export function hashResponseIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  try {
    return createHmac("sha256", publicLinkSigningSecret("sales_owner_confirmation_ip_secret_missing"))
      .update(`sales-owner-confirmation-ip:${ip}`)
      .digest("hex");
  } catch {
    return null;
  }
}

function webOrigin(): string {
  const candidate = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.APP_URL || "https://www.nolsaf.com";
  try {
    return new URL(candidate).origin;
  } catch {
    return "https://www.nolsaf.com";
  }
}

export const OWNER_CONFIRMATION_PATH = "/owner/partner-confirmations";

export type OwnerConfirmationNotice = {
  ownerUserId: number;
  /** Plain reference: only ever placed in SMS and email, never stored. */
  reference: string;
  confirmationIds: number[];
  propertyTitle: string;
  partnerName: string;
  agentCode: string;
  expiresAt: Date;
};

/**
 * Open a confirmation request for each attribution, replacing any request
 * still open on it. Run inside the transaction that creates or moves the
 * attribution; deliver the returned notices after it commits.
 */
export async function requestOwnerConfirmations(tx: any, attributionIds: number[], now = new Date()): Promise<OwnerConfirmationNotice[]> {
  const ids = [...new Set(attributionIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return [];
  const attributions = await tx.propertySalesAttribution.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      propertyId: true,
      salesPartnerId: true,
      property: { select: { ownerId: true, title: true } },
      salesPartner: { select: { agentCode: true, user: { select: { name: true } } } },
    },
  });
  const expiresAt = new Date(now.getTime() + OWNER_CONFIRMATION_TTL_DAYS * DAY_MS);
  // One notice per owner, property and partner, even when several products convert together.
  const notices = new Map<string, OwnerConfirmationNotice>();
  for (const attribution of attributions) {
    const ownerUserId = Number(attribution.property?.ownerId);
    if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) continue;
    await tx.salesOwnerConfirmation.updateMany({
      where: { attributionId: attribution.id, status: "PENDING" },
      data: { status: "CANCELLED", activeKey: null },
    });
    const reference = randomBytes(24).toString("base64url");
    const created = await tx.salesOwnerConfirmation.create({
      data: {
        attributionId: attribution.id,
        propertyId: attribution.propertyId,
        salesPartnerId: attribution.salesPartnerId,
        ownerUserId,
        status: "PENDING",
        activeKey: attribution.id,
        referenceHash: hashConfirmationReference(reference),
        requestedAt: now,
        expiresAt,
      },
      select: { id: true },
    });
    const key = `${ownerUserId}:${attribution.propertyId}:${attribution.salesPartnerId}`;
    const existing = notices.get(key);
    if (existing) {
      existing.confirmationIds.push(created.id);
      continue;
    }
    notices.set(key, {
      ownerUserId,
      reference,
      confirmationIds: [created.id],
      propertyTitle: attribution.property?.title || "your property",
      partnerName: attribution.salesPartner?.user?.name || "A NoLSAF sales partner",
      agentCode: attribution.salesPartner?.agentCode || "",
      expiresAt,
    });
  }
  return [...notices.values()];
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ownerConfirmationEmail(input: OwnerConfirmationNotice & { ownerName: string; url: string }) {
  const expiry = input.expiresAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
  const body = `
    <p style="margin:0 0 16px;">Hello <strong>${escapeHtml(input.ownerName || "there")}</strong>,</p>
    <p style="margin:0 0 20px;">
      A NoLSAF sales partner says they helped you list <strong>${escapeHtml(input.propertyTitle)}</strong>.
      Please tell us whether that is true. It takes one tap and protects you from anyone claiming to represent you.
    </p>
    ${proDetailRows("Request", [
      ["Property", escapeHtml(input.propertyTitle)],
      ["Sales partner", escapeHtml(input.partnerName)],
      ["Partner code", escapeHtml(input.agentCode)],
      ["Answer by", escapeHtml(expiry)],
    ])}
    <div style="height:20px;font-size:0;line-height:0;">&nbsp;</div>
    <div style="text-align:center;">${proButton(escapeHtml(input.url), "Answer in your owner portal", BRAND_TEAL)}</div>
    <div style="height:8px;font-size:0;line-height:0;">&nbsp;</div>
    ${proNoteCard(
      BRAND_TEAL,
      "Your sign-in is required",
      "This link only opens the question in your owner portal. You must sign in to your own NoLSAF account to answer, and nobody else can answer for you. We never show partner earnings.",
    )}
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
      If you do not recognise this partner, choose "I don't know them" and our team will review it.
    </p>`;
  return {
    subject: `Did ${input.partnerName} help you join NoLSAF?`,
    html: proEmail("Confirm your sales partner", body),
  };
}

/** Send the in-app, email and SMS notices. Best effort: a failed channel never blocks the flow. */
export async function deliverOwnerConfirmationNotices(notices: OwnerConfirmationNotice[]): Promise<void> {
  for (const notice of notices) {
    try {
      const owner = await db.user.findUnique({ where: { id: notice.ownerUserId }, select: { name: true, email: true, phone: true } });
      const url = `${webOrigin()}${OWNER_CONFIRMATION_PATH}?r=${encodeURIComponent(notice.reference)}`;
      await notifyUser(notice.ownerUserId, "sales_owner_confirmation_requested", {
        propertyName: notice.propertyTitle,
        partnerName: notice.partnerName,
        agentCode: notice.agentCode,
      });
      if (owner?.email) {
        const email = ownerConfirmationEmail({ ...notice, ownerName: owner.name || "", url });
        await sendMail(owner.email, email.subject, email.html, undefined, {
          bypassEligibilityCheck: true,
          replyTo: "support@nolsaf.com",
          sensitiveContent: true,
        }).catch(() => undefined);
      }
      if (owner?.phone) {
        await sendSms(
          owner.phone,
          `NoLSAF: ${notice.partnerName} says they helped you list ${notice.propertyTitle}. Sign in to confirm or deny: ${url}`,
          { bypassEligibilityCheck: true, sensitiveContent: true },
        ).catch(() => undefined);
      }
      await db.salesOwnerConfirmation.updateMany({
        where: { id: { in: notice.confirmationIds } },
        data: { notifiedAt: new Date() },
      });
    } catch (error: any) {
      console.warn("[sales-owner-confirmation] notice failed:", error?.message || error);
    }
  }
}

/** The latest confirmation on an attribution, for the activation gate and admin views. */
export async function latestOwnerConfirmation(tx: any, attributionId: number) {
  return tx.salesOwnerConfirmation.findFirst({
    where: { attributionId },
    orderBy: { id: "desc" },
    select: { id: true, status: true, expiresAt: true, respondedAt: true, responseNote: true },
  });
}

/**
 * Record the owner's answer. The answer covers every open request from the
 * same partner on the same property, so the owner answers once.
 */
export async function answerOwnerConfirmation(tx: any, input: {
  confirmationId: number;
  userId: number;
  answer: OwnerAnswer;
  note?: string | null;
  ipHash: string | null;
  userAgent: string | null;
  sessionId: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const current = await tx.salesOwnerConfirmation.findUnique({
    where: { id: input.confirmationId },
    select: {
      id: true,
      status: true,
      ownerUserId: true,
      propertyId: true,
      salesPartnerId: true,
      expiresAt: true,
      property: { select: { ownerId: true, title: true } },
      salesPartner: { select: { userId: true } },
    },
  });
  // Not found and not yours look the same, so the endpoint reveals nothing.
  if (!current || current.ownerUserId !== input.userId || current.property?.ownerId !== input.userId) {
    throw new OwnerConfirmationError("Request not found", 404);
  }
  if (current.status !== "PENDING") throw new OwnerConfirmationError("This request has already been answered", 409);
  if (current.expiresAt <= now) throw new OwnerConfirmationError("This request has expired. NoLSAF will review it.", 409);

  const group = await tx.salesOwnerConfirmation.findMany({
    where: {
      propertyId: current.propertyId,
      salesPartnerId: current.salesPartnerId,
      ownerUserId: input.userId,
      status: "PENDING",
      expiresAt: { gt: now },
    },
    select: { id: true, attributionId: true },
  });
  const ids = group.map((row: any) => row.id);
  const changed = await tx.salesOwnerConfirmation.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: {
      status: input.answer,
      activeKey: null,
      respondedAt: now,
      respondedById: input.userId,
      responseNote: input.note || null,
      responseIpHash: input.ipHash,
      responseUserAgent: input.userAgent ? input.userAgent.slice(0, 255) : null,
      responseSessionId: input.sessionId ? input.sessionId.slice(0, 64) : null,
    },
  });
  if (changed.count !== ids.length) throw new OwnerConfirmationError("This request was changed. Refresh and try again.", 409);

  const attributionIds = group.map((row: any) => row.attributionId);
  if (input.answer === "CONFIRMED") {
    // A fresh "yes" (for example after the owner first answered by mistake and
    // an administrator asked again) lifts the hold that a "no" put on the claim.
    await tx.propertySalesAttribution.updateMany({
      where: { id: { in: attributionIds }, status: "DISPUTED" },
      data: { status: "VERIFIED", disputeReason: null },
    });
  } else {
    // A "no" freezes the claim until an administrator reviews it.
    await tx.propertySalesAttribution.updateMany({
      where: { id: { in: attributionIds }, status: { in: ["PENDING", "VERIFIED"] } },
      data: {
        status: "DISPUTED",
        disputeReason: input.answer === "DENIED" ? "The owner denied this partner brought them." : "The owner does not know this partner.",
      },
    });
  }
  await tx.auditLog.create({
    data: {
      actorId: input.userId,
      actorRole: "OWNER",
      action: "SALES_OWNER_CONFIRMATION_ANSWER",
      entity: "SALES_OWNER_CONFIRMATION",
      entityId: current.id,
      beforeJson: { status: "PENDING" },
      afterJson: { status: input.answer, confirmationIds: ids, attributionIds, note: input.note || null },
    },
  });
  return {
    answer: input.answer,
    attributionIds,
    partnerUserId: current.salesPartner?.userId as number | undefined,
    propertyTitle: current.property?.title as string | undefined,
  };
}

/**
 * Housekeeping, run by the sales lifecycle worker: expire unanswered requests
 * (they go to admin review), cancel requests whose property changed owner,
 * and send one in-app reminder before expiry.
 */
export async function sweepOwnerConfirmations(now = new Date()): Promise<{ expired: number; cancelled: number; reminded: number }> {
  const expired = await db.salesOwnerConfirmation.updateMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", activeKey: null },
  });

  const pending = await db.salesOwnerConfirmation.findMany({
    where: { status: "PENDING" },
    take: 500,
    select: {
      id: true,
      ownerUserId: true,
      notifiedAt: true,
      remindedAt: true,
      expiresAt: true,
      property: { select: { ownerId: true, title: true } },
      salesPartner: { select: { agentCode: true, user: { select: { name: true } } } },
    },
  });
  const ownerChanged = pending.filter((row: any) => row.property?.ownerId !== row.ownerUserId).map((row: any) => row.id);
  const cancelled = ownerChanged.length
    ? await db.salesOwnerConfirmation.updateMany({
        where: { id: { in: ownerChanged }, status: "PENDING" },
        data: { status: "CANCELLED", activeKey: null },
      })
    : { count: 0 };

  let reminded = 0;
  const reminderDue = pending.filter((row: any) =>
    !ownerChanged.includes(row.id) &&
    row.notifiedAt &&
    !row.remindedAt &&
    row.expiresAt.getTime() - now.getTime() <= REMINDER_BEFORE_MS,
  );
  const remindedOwners = new Set<string>();
  for (const row of reminderDue) {
    const claim = await db.salesOwnerConfirmation.updateMany({
      where: { id: row.id, status: "PENDING", remindedAt: null },
      data: { remindedAt: now },
    });
    if (claim.count !== 1) continue;
    const key = `${row.ownerUserId}:${row.property?.title}`;
    if (remindedOwners.has(key)) continue;
    remindedOwners.add(key);
    await notifyUser(row.ownerUserId, "sales_owner_confirmation_reminder", {
      propertyName: row.property?.title,
      partnerName: row.salesPartner?.user?.name,
      agentCode: row.salesPartner?.agentCode,
    });
    reminded += 1;
  }
  return { expired: expired.count, cancelled: cancelled.count, reminded };
}
