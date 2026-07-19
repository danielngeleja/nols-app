import { randomBytes } from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { sendMail } from "./mailer.js";
import {
  getRestrictionNoticeEmail,
  getRestrictionResolvedEmail,
  type RestrictionEmailScope,
} from "./restrictionEmailTemplates.js";

export const RESTRICTION_SCOPE = {
  MARKETPLACE_PROPERTY: "MARKETPLACE_PROPERTY",
  NRMS_ENROLLMENT: "NRMS_ENROLLMENT",
  NRMS_PROPERTY: "NRMS_PROPERTY",
  NRMS_QR_ORDERING: "NRMS_QR_ORDERING",
} as const satisfies Record<string, RestrictionEmailScope>;

export type RestrictionScope = (typeof RESTRICTION_SCOPE)[keyof typeof RESTRICTION_SCOPE];

const scopePrefix: Record<RestrictionScope, string> = {
  MARKETPLACE_PROPERTY: "MKT",
  NRMS_ENROLLMENT: "NRA",
  NRMS_PROPERTY: "NRP",
  NRMS_QR_ORDERING: "QR",
};

const APPEAL_EMAIL = "partners@nolsaf.com";
const db = prisma as any;

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replace(/-/g, "");
}

export function generateRestrictionReference(scope: RestrictionScope, targetId: number, at = new Date()): string {
  const nonce = randomBytes(3).toString("hex").toUpperCase();
  return `NLS-${scopePrefix[scope]}-${targetId}-${compactDate(at)}-${nonce}`;
}

export async function createRestrictionCase(
  client: any,
  input: {
    scope: RestrictionScope;
    ownerId: number;
    targetId: number;
    propertyId?: number | null;
    reason: string;
    appliedByAdminId: number;
    appliedAt?: Date;
  },
) {
  const appliedAt = input.appliedAt ?? new Date();
  return client.platformRestrictionCase.create({
    data: {
      referenceCode: generateRestrictionReference(input.scope, input.targetId, appliedAt),
      activeKey: `${input.scope}:${input.targetId}`,
      scope: input.scope,
      status: "OPEN",
      ownerId: input.ownerId,
      targetId: input.targetId,
      propertyId: input.propertyId ?? null,
      reason: input.reason,
      appliedByAdminId: input.appliedByAdminId,
      appliedAt,
    },
  });
}

export async function findOpenRestrictionCase(scope: RestrictionScope, targetId: number) {
  return db.platformRestrictionCase.findFirst({
    where: { scope, targetId, status: "OPEN" },
    orderBy: { id: "desc" },
  });
}

export async function resolveRestrictionCase(
  client: any,
  input: { scope: RestrictionScope; targetId: number; resolvedByAdminId: number; resolutionNote: string; resolvedAt?: Date },
) {
  const current = await client.platformRestrictionCase.findFirst({
    where: { scope: input.scope, targetId: input.targetId, status: "OPEN" },
    orderBy: { id: "desc" },
  });
  if (!current) return null;
  return client.platformRestrictionCase.update({
    where: { id: current.id },
    data: {
      status: "RESOLVED",
      activeKey: null,
      resolvedByAdminId: input.resolvedByAdminId,
      resolvedAt: input.resolvedAt ?? new Date(),
      resolutionNote: input.resolutionNote,
    },
  });
}

async function ownerRecipient(ownerId: number) {
  const owner = await db.user.findUnique({
    where: { id: ownerId },
    select: { email: true, fullName: true, name: true },
  });
  return owner
    ? { email: String(owner.email || "").trim(), name: owner.fullName || owner.name || "Property partner" }
    : null;
}

function errorText(error: unknown): string {
  return String((error as any)?.message || error || "Unknown email delivery error").slice(0, 500);
}

export async function sendRestrictionOpenedEmail(restriction: any, targetName?: string | null) {
  let recipient;
  try {
    recipient = await ownerRecipient(restriction.ownerId);
  } catch (error) {
    const message = errorText(error);
    console.error(`[restriction-email] Could not load recipient ref=${restriction.referenceCode}: ${message}`);
    return { sent: false, error: message };
  }
  if (!recipient?.email) {
    const error = "Owner has no email address";
    await db.platformRestrictionCase.update({ where: { id: restriction.id }, data: { notificationEmailError: error } }).catch(() => undefined);
    return { sent: false, error };
  }

  try {
    const email = getRestrictionNoticeEmail({
      ownerName: recipient.name,
      referenceCode: restriction.referenceCode,
      scope: restriction.scope,
      targetName,
      reason: restriction.reason,
      effectiveAt: restriction.appliedAt,
      appealEmail: APPEAL_EMAIL,
    });
    const delivery = await sendMail(recipient.email, email.subject, email.html, undefined, {
      bypassEligibilityCheck: true,
      replyTo: APPEAL_EMAIL,
    });
    try {
      await db.platformRestrictionCase.update({
        where: { id: restriction.id },
        data: { notificationEmailSentAt: new Date(), notificationEmailError: null },
      });
      return { sent: true, provider: delivery?.provider ?? "email" };
    } catch (trackingError) {
      const message = errorText(trackingError);
      console.error(`[restriction-email] Sent but could not record delivery ref=${restriction.referenceCode}: ${message}`);
      return { sent: true, provider: delivery?.provider ?? "email", trackingError: message };
    }
  } catch (error) {
    const message = errorText(error);
    await db.platformRestrictionCase.update({ where: { id: restriction.id }, data: { notificationEmailError: message } }).catch(() => undefined);
    console.error(`[restriction-email] Failed ref=${restriction.referenceCode}: ${message}`);
    return { sent: false, error: message };
  }
}

export async function sendRestrictionResolvedEmail(restriction: any, targetName?: string | null) {
  let recipient;
  try {
    recipient = await ownerRecipient(restriction.ownerId);
  } catch (error) {
    const message = errorText(error);
    console.error(`[restriction-email] Could not load resolution recipient ref=${restriction.referenceCode}: ${message}`);
    return { sent: false, error: message };
  }
  if (!recipient?.email) {
    const error = "Owner has no email address";
    await db.platformRestrictionCase.update({ where: { id: restriction.id }, data: { resolutionEmailError: error } }).catch(() => undefined);
    return { sent: false, error };
  }

  try {
    const email = getRestrictionResolvedEmail({
      ownerName: recipient.name,
      referenceCode: restriction.referenceCode,
      scope: restriction.scope,
      targetName,
      reason: restriction.reason,
      effectiveAt: restriction.appliedAt,
      resolutionNote: restriction.resolutionNote || "The administrative review has been completed.",
      resolvedAt: restriction.resolvedAt || new Date(),
      appealEmail: APPEAL_EMAIL,
    });
    const delivery = await sendMail(recipient.email, email.subject, email.html, undefined, {
      bypassEligibilityCheck: true,
      replyTo: APPEAL_EMAIL,
    });
    try {
      await db.platformRestrictionCase.update({
        where: { id: restriction.id },
        data: { resolutionEmailSentAt: new Date(), resolutionEmailError: null },
      });
      return { sent: true, provider: delivery?.provider ?? "email" };
    } catch (trackingError) {
      const message = errorText(trackingError);
      console.error(`[restriction-email] Resolution sent but could not record delivery ref=${restriction.referenceCode}: ${message}`);
      return { sent: true, provider: delivery?.provider ?? "email", trackingError: message };
    }
  } catch (error) {
    const message = errorText(error);
    await db.platformRestrictionCase.update({ where: { id: restriction.id }, data: { resolutionEmailError: message } }).catch(() => undefined);
    console.error(`[restriction-email] Failed resolution ref=${restriction.referenceCode}: ${message}`);
    return { sent: false, error: message };
  }
}
