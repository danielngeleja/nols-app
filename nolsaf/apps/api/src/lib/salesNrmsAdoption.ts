/**
 * Lapse NRMS claims the owner never adopted (lib/salesAttribution.ts, "NRMS
 * adoption"). Run by the sales lifecycle worker.
 *
 * An NRMS attribution whose property still has no nrmsActivatedAt
 * NRMS_ADOPTION_DAYS after approval becomes LAPSED: it stops any commission
 * window, its open owner question is cancelled, and the property is free for a
 * new NRMS claim (a new conversion takes the lapsed row over in place). The
 * marketplace claim on the same property is untouched. Every lapse is audited
 * and the partner is told.
 */
import { prisma } from "@nolsaf/prisma";
import { notifyAdmins, notifyUser } from "./notifications.js";
import { NRMS_ADOPTION_DAYS, NRMS_LAPSABLE_STATUSES } from "./salesAttribution.js";

const db = prisma as any;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

export const NRMS_LAPSE_REASON = `NRMS was not switched on for this property within ${NRMS_ADOPTION_DAYS} days of the claim being approved.`;

export async function lapseUnadoptedNrmsClaims(now = new Date(), client: any = db): Promise<{ lapsed: number }> {
  const cutoff = new Date(now.getTime() - NRMS_ADOPTION_DAYS * DAY_MS);
  const due = await client.propertySalesAttribution.findMany({
    where: {
      productType: "NRMS",
      status: { in: [...NRMS_LAPSABLE_STATUSES] },
      property: { nrmsActivatedAt: null },
      OR: [{ verifiedAt: { lte: cutoff } }, { verifiedAt: null, attributedAt: { lte: cutoff } }],
    },
    orderBy: { id: "asc" },
    take: BATCH,
    select: {
      id: true,
      status: true,
      salesPartnerId: true,
      propertyId: true,
      property: { select: { title: true } },
      salesPartner: { select: { userId: true, agentCode: true } },
    },
  });

  let lapsed = 0;
  for (const row of due) {
    const changed = await client.$transaction(async (tx: any) => {
      // Guarded: the owner may switch NRMS on, or an admin act, between the read and now.
      const updated = await tx.propertySalesAttribution.updateMany({
        where: { id: row.id, status: row.status, salesPartnerId: row.salesPartnerId, property: { nrmsActivatedAt: null } },
        data: { status: "LAPSED", commissionEndsAt: now, disputeReason: NRMS_LAPSE_REASON, notes: NRMS_LAPSE_REASON },
      });
      if (updated.count !== 1) return false;
      await tx.salesOwnerConfirmation.updateMany({
        where: { attributionId: row.id, status: "PENDING" },
        data: { status: "CANCELLED", activeKey: null },
      });
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: "SYSTEM",
          action: "SALES_ATTRIBUTION_NRMS_LAPSE",
          entity: "PROPERTY_SALES_ATTRIBUTION",
          entityId: row.id,
          beforeJson: { status: row.status, salesPartnerId: row.salesPartnerId },
          afterJson: { status: "LAPSED", commissionEndsAt: now, reason: NRMS_LAPSE_REASON, adoptionDays: NRMS_ADOPTION_DAYS },
        },
      });
      return true;
    });
    if (!changed) continue;
    lapsed += 1;
    if (row.salesPartner?.userId) {
      await notifyUser(row.salesPartner.userId, "sales_partner_attribution_lapsed", {
        propertyName: row.property?.title,
        productType: "NRMS",
        days: NRMS_ADOPTION_DAYS,
      }).catch(() => undefined);
    }
    await notifyAdmins("sales_partner_nrms_claim_lapsed", {
      propertyTitle: row.property?.title,
      agentCode: row.salesPartner?.agentCode ?? null,
      attributionId: row.id,
      days: NRMS_ADOPTION_DAYS,
      href: "/admin/sales",
    }).catch(() => undefined);
  }
  return { lapsed };
}
