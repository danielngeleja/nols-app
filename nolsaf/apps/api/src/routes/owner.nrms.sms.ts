import { Router, type RequestHandler, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { z } from "zod";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { requireNrms, loadOwnedActiveNrmsProperty } from "../lib/nrms.js";
import {
  canonicalGuestPhone,
  currentGuestSmsQuotaYear,
  GUEST_SMS_ANNUAL_LIMIT,
  GUEST_SMS_MAX_AUDIENCE,
  guestSmsAudienceTypes,
  loadGuestSmsEligibility,
  matchesGuestSmsAudience,
  noPhoneEligibility,
  type GuestSmsAudienceType,
} from "../lib/guestSmsCampaigns.js";

export const router = Router();
router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, requireNrms as RequestHandler);

const preferenceSchema = z.object({
  status: z.enum(["OPTED_IN", "OPTED_OUT"]),
  confirmedByGuest: z.literal(true),
});

const audienceSchema = z.object({
  audienceType: z.enum(guestSmsAudienceTypes),
  guestIds: z.array(z.number().int().positive()).max(GUEST_SMS_MAX_AUDIENCE).default([]),
});

const campaignSchema = audienceSchema.extend({
  name: z.string().trim().min(3).max(120),
  kind: z.enum(["OFFER", "RETURN_INVITATION"]),
  message: z.string().trim().min(5).max(612),
});

type Candidate = {
  id: number;
  fullName: string;
  phone: string | null;
  reservationCount: number;
  lastStayAt: Date | null;
};

async function loadCandidates(propertyId: number, audienceType: GuestSmsAudienceType, guestIds: number[]): Promise<Candidate[]> {
  const guests = await prisma.guestProfile.findMany({
    where: {
      propertyId,
      ...(audienceType === "SELECTED" ? { id: { in: guestIds } } : {}),
    },
    select: {
      id: true,
      fullName: true,
      phone: true,
      _count: { select: { reservations: true } },
      reservations: {
        where: { status: { in: ["CHECKED_OUT", "CHECKED_IN"] } },
        orderBy: { checkIn: "desc" },
        take: 1,
        select: { checkIn: true, checkOut: true },
      },
    },
    orderBy: { id: "asc" },
    take: GUEST_SMS_MAX_AUDIENCE,
  });

  return guests
    .map((guest) => ({
      id: guest.id,
      fullName: guest.fullName,
      phone: guest.phone,
      reservationCount: guest._count.reservations,
      lastStayAt: guest.reservations[0]?.checkOut ?? guest.reservations[0]?.checkIn ?? null,
    }))
    .filter((guest) => matchesGuestSmsAudience(guest, audienceType));
}

async function buildPreview(ownerId: number, candidates: Candidate[]) {
  const eligibilityByPhone = await loadGuestSmsEligibility(ownerId, candidates.map((guest) => guest.phone));
  const uniquePhones = new Set<string>();
  const reasons: Record<string, number> = { NO_PHONE: 0, NO_CONSENT: 0, OPTED_OUT: 0, ANNUAL_LIMIT: 0, DUPLICATE_PHONE: 0 };
  let eligibleCount = 0;

  for (const guest of candidates) {
    const phone = canonicalGuestPhone(guest.phone);
    if (!phone) {
      reasons.NO_PHONE += 1;
      continue;
    }
    if (uniquePhones.has(phone)) {
      reasons.DUPLICATE_PHONE += 1;
      continue;
    }
    uniquePhones.add(phone);
    const eligibility = eligibilityByPhone.get(phone) ?? noPhoneEligibility();
    if (eligibility.eligible) eligibleCount += 1;
    else reasons[eligibility.reason] = (reasons[eligibility.reason] ?? 0) + 1;
  }

  return { totalCount: candidates.length, eligibleCount, skippedCount: candidates.length - eligibleCount, reasons };
}

router.put("/:propertyId/preferences/:guestId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const parsed = preferenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Guest confirmation is required to change SMS consent" });

    const guest = await prisma.guestProfile.findFirst({
      where: { id: Number(req.params.guestId), propertyId: active.property.id, ownerId },
      select: { phone: true },
    });
    if (!guest) return res.status(404).json({ error: "Guest not found" });
    const normalizedPhone = canonicalGuestPhone(guest.phone);
    if (!normalizedPhone) return res.status(400).json({ error: "Guest needs a valid phone number" });
    const now = new Date();
    const preference = await prisma.guestSmsPreference.upsert({
      where: { ownerId_normalizedPhone: { ownerId, normalizedPhone } },
      create: {
        ownerId,
        normalizedPhone,
        status: parsed.data.status,
        consentSource: "OWNER_CONFIRMED",
        consentAt: parsed.data.status === "OPTED_IN" ? now : null,
        optedOutAt: parsed.data.status === "OPTED_OUT" ? now : null,
      },
      update: {
        status: parsed.data.status,
        consentSource: "OWNER_CONFIRMED",
        consentAt: parsed.data.status === "OPTED_IN" ? now : null,
        optedOutAt: parsed.data.status === "OPTED_OUT" ? now : null,
      },
    });
    res.json({ preference: { status: preference.status, normalizedPhone } });
  } catch (error) {
    console.error("[owner.nrms.sms] preference failed", error);
    res.status(500).json({ error: "Failed to update SMS consent" });
  }
}) as RequestHandler);

router.post("/:propertyId/preview", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const parsed = audienceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid SMS audience" });
    if (parsed.data.audienceType === "SELECTED" && parsed.data.guestIds.length === 0) {
      return res.status(400).json({ error: "Select at least one guest" });
    }
    const candidates = await loadCandidates(active.property.id, parsed.data.audienceType, parsed.data.guestIds);
    res.json({ preview: await buildPreview(ownerId, candidates), annualLimit: GUEST_SMS_ANNUAL_LIMIT });
  } catch (error) {
    console.error("[owner.nrms.sms] preview failed", error);
    res.status(500).json({ error: "Failed to preview SMS audience" });
  }
}) as RequestHandler);

router.post("/:propertyId/campaigns", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const parsed = campaignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid SMS campaign", details: parsed.error.flatten() });
    if (parsed.data.audienceType === "SELECTED" && parsed.data.guestIds.length === 0) {
      return res.status(400).json({ error: "Select at least one guest" });
    }

    const candidates = await loadCandidates(active.property.id, parsed.data.audienceType, parsed.data.guestIds);
    if (candidates.length === 0) return res.status(400).json({ error: "This audience has no guests" });
    const eligibilityByPhone = await loadGuestSmsEligibility(ownerId, candidates.map((guest) => guest.phone));
    const year = currentGuestSmsQuotaYear();

    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.guestSmsCampaign.create({
        data: {
          ownerId,
          propertyId: active.property.id,
          name: parsed.data.name,
          kind: parsed.data.kind,
          message: parsed.data.message,
          audienceType: parsed.data.audienceType,
          audienceFilter: { guestIds: parsed.data.audienceType === "SELECTED" ? parsed.data.guestIds : [] },
          status: "QUEUED",
          totalCount: candidates.length,
          queuedAt: new Date(),
        },
      });

      const seenPhones = new Set<string>();
      let eligibleCount = 0;
      let skippedCount = 0;
      for (const guest of candidates) {
        const normalizedPhone = canonicalGuestPhone(guest.phone);
        if (!normalizedPhone) {
          skippedCount += 1;
          continue;
        }
        if (seenPhones.has(normalizedPhone)) {
          skippedCount += 1;
          continue;
        }
        seenPhones.add(normalizedPhone);

        const eligibility = eligibilityByPhone.get(normalizedPhone) ?? noPhoneEligibility();
        let status = "SKIPPED";
        let skipReason: string | null = eligibility.reason;
        let quotaYear: number | null = null;

        if (eligibility.eligible) {
          const quota = await tx.guestSmsAnnualQuota.upsert({
            where: { ownerId_normalizedPhone_year: { ownerId, normalizedPhone, year } },
            create: { ownerId, normalizedPhone, year, usedCount: 0 },
            update: {},
          });
          const reserved = await tx.guestSmsAnnualQuota.updateMany({
            where: { id: quota.id, usedCount: { lt: GUEST_SMS_ANNUAL_LIMIT } },
            data: { usedCount: { increment: 1 } },
          });
          if (reserved.count === 1) {
            status = "QUEUED";
            skipReason = null;
            quotaYear = year;
            eligibleCount += 1;
          } else {
            skipReason = "ANNUAL_LIMIT";
            skippedCount += 1;
          }
        } else {
          skippedCount += 1;
        }

        await tx.guestSmsCampaignRecipient.create({
          data: {
            campaignId: created.id,
            guestProfileId: guest.id,
            normalizedPhone,
            guestName: guest.fullName,
            status,
            skipReason,
            quotaYear,
          },
        });
      }

      return tx.guestSmsCampaign.update({
        where: { id: created.id },
        data: {
          eligibleCount,
          skippedCount,
          ...(eligibleCount === 0 ? { status: "COMPLETED", completedAt: new Date() } : {}),
        },
      });
    }, { timeout: 30_000 });

    res.status(201).json({
      campaign: {
        id: campaign.id,
        status: campaign.status,
        totalCount: campaign.totalCount,
        eligibleCount: campaign.eligibleCount,
        skippedCount: campaign.skippedCount,
      },
    });
  } catch (error) {
    console.error("[owner.nrms.sms] campaign queue failed", error);
    res.status(500).json({ error: "Failed to queue SMS campaign" });
  }
}) as RequestHandler);

router.get("/:propertyId/campaigns", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const campaigns = await prisma.guestSmsCampaign.findMany({
      where: { ownerId, propertyId: active.property.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, name: true, kind: true, audienceType: true, status: true, totalCount: true,
        eligibleCount: true, sentCount: true, failedCount: true, skippedCount: true,
        createdAt: true, completedAt: true,
      },
    });
    res.json({ campaigns });
  } catch (error) {
    console.error("[owner.nrms.sms] campaign list failed", error);
    res.status(500).json({ error: "Failed to load SMS campaigns" });
  }
}) as RequestHandler);

export default router;
