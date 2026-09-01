import type { Prisma } from "@prisma/client";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { getRoomTypeAvailability, lockPropertyInventory } from "./nrmsAvailability.js";
import { computeNightlyRates, money, nightsBetween } from "./nrmsRateMath.js";
import { findRestrictionBlocks } from "./nrmsRestrictions.js";
import { sanitizeText } from "./sanitize.js";

const HOLD_TX_OPTIONS = { maxWait: 5000, timeout: 15000 };

export type InquiryHoldInput = {
  propertyId: number;
  ownerId: number;
  actorId: number;
  actorName: string;
  inquiryId: number;
  version: number;
  guestName: string;
  guestPhone: string;
  guestEmail?: string | null;
  checkIn: string;
  checkOut: string;
  roomTypeId: number;
  adults: number;
  children: number;
};

export type InquiryHoldFailureCode =
  | "INQUIRY_NOT_CONVERTIBLE"
  | "VERSION_CONFLICT"
  | "ROOM_TYPE_NOT_FOUND"
  | "ROOM_TYPE_MISMATCH"
  | "INVALID_DATES"
  | "RESTRICTION_BLOCKED"
  | "NO_AVAILABILITY";

export type InquiryHoldResult =
  | {
      ok: true;
      reservationId: number;
      status: string;
      expiresAt: Date;
      totalAmount: number;
      roomRate: number;
      currency: string;
    }
  | { ok: false; code: InquiryHoldFailureCode; message: string };

class InquiryConversionRace extends Error {
  constructor() { super("INQUIRY_CONVERSION_RACE"); }
}

function day(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }

function todayInNrmsTimeZone(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Converts a property-scoped reception inquiry into a short room hold.
 *
 * The server owns pricing, expiry, inventory locking and the inquiry state
 * transition. Reception can therefore convert a genuine lead without gaining
 * access to arbitrary commercial reservation fields or owner-only endpoints.
 */
export async function createInquiryRoomHold(
  input: InquiryHoldInput,
  db: typeof prisma = prisma,
): Promise<InquiryHoldResult> {
  if (input.checkIn < todayInNrmsTimeZone() || input.checkOut <= input.checkIn) {
    return { ok: false, code: "INVALID_DATES", message: "Choose future stay dates with check-out after check-in" };
  }
  const checkIn = day(input.checkIn);
  const checkOut = day(input.checkOut);
  const stayNights = nightsBetween(checkIn, checkOut);
  const stayDates = Array.from({ length: Math.max(0, stayNights) }, (_, offset) => new Date(checkIn.getTime() + offset * 86_400_000));
  if (!stayDates.length || stayDates.length > 365) {
    return { ok: false, code: "INVALID_DATES", message: "Choose a stay between 1 and 365 nights" };
  }

  try {
    return await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockPropertyInventory(tx, input.propertyId);

      const inquiry = await tx.nrmsGuestInquiry.findFirst({
        where: {
          id: input.inquiryId,
          propertyId: input.propertyId,
          ownerId: input.ownerId,
          reservationId: null,
          status: { notIn: ["RESOLVED", "CONVERTED", "CLOSED"] },
        },
        select: { id: true, reference: true, channel: true, roomTypeId: true, version: true },
      });
      if (!inquiry) return { ok: false, code: "INQUIRY_NOT_CONVERTIBLE", message: "This inquiry is already closed or converted" } as const;
      if (inquiry.version !== input.version) return { ok: false, code: "VERSION_CONFLICT", message: "This inquiry changed on another device. Refresh and try again." } as const;
      if (inquiry.roomTypeId && inquiry.roomTypeId !== input.roomTypeId) {
        return { ok: false, code: "ROOM_TYPE_MISMATCH", message: "The room must match the guest's selected inquiry room" } as const;
      }

      const roomType = await tx.roomType.findFirst({
        where: { id: input.roomTypeId, propertyId: input.propertyId, status: "ACTIVE", baseRate: { not: null } },
        select: { id: true, baseRate: true, currency: true },
      });
      if (!roomType) return { ok: false, code: "ROOM_TYPE_NOT_FOUND", message: "The selected room type is no longer sellable" } as const;

      const ratePlan = await tx.nrmsRatePlan.findFirst({
        where: {
          propertyId: input.propertyId,
          status: "ACTIVE",
          isDefault: true,
          OR: [{ roomTypeId: roomType.id }, { roomTypeId: null }],
        },
        include: {
          seasons: {
            where: { status: "ACTIVE", startDate: { lte: checkOut }, endDate: { gte: checkIn } },
            orderBy: { priority: "desc" },
          },
        },
        orderBy: [{ roomTypeId: "desc" }, { id: "asc" }],
      });

      const restrictionBlocks = await findRestrictionBlocks(tx, {
        propertyId: input.propertyId,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan?.id ?? null,
        checkIn,
        checkOut,
        channelCode: "DIRECT",
      });
      if (restrictionBlocks.length) {
        return { ok: false, code: "RESTRICTION_BLOCKED", message: restrictionBlocks[0]!.message } as const;
      }

      const availability = await getRoomTypeAvailability(tx, input.propertyId, roomType.id, checkIn, checkOut);
      if (availability.available < 1) {
        return { ok: false, code: "NO_AVAILABILITY", message: "The selected room was just booked. Choose another available room." } as const;
      }

      const { nightly, subtotal } = computeNightlyRates(Number(roomType.baseRate), ratePlan, stayDates);
      const taxPolicy = (ratePlan?.taxPolicy && typeof ratePlan.taxPolicy === "object" ? ratePlan.taxPolicy : {}) as Record<string, unknown>;
      const feePolicy = (ratePlan?.feePolicy && typeof ratePlan.feePolicy === "object" ? ratePlan.feePolicy : {}) as Record<string, unknown>;
      const taxAmount = money(subtotal * Math.max(0, Number(taxPolicy.percent || 0)) / 100);
      const fees = money(Number(feePolicy.fixed || 0));
      const totalAmount = money(subtotal + taxAmount + fees);
      const roomRate = nightly[0]?.rate ?? Number(roomType.baseRate);

      const phone = sanitizeText(input.guestPhone);
      const existingGuest = await tx.guestProfile.findFirst({ where: { propertyId: input.propertyId, phone } });
      const guest = existingGuest
        ? await tx.guestProfile.update({
            where: { id: existingGuest.id },
            data: { fullName: sanitizeText(input.guestName), ...(input.guestEmail ? { email: sanitizeText(input.guestEmail) } : {}) },
          })
        : await tx.guestProfile.create({
            data: {
              propertyId: input.propertyId,
              ownerId: input.ownerId,
              fullName: sanitizeText(input.guestName),
              phone,
              email: input.guestEmail ? sanitizeText(input.guestEmail) : null,
              nationality: null,
            },
          });

      const expiresAt = new Date(Date.now() + 60 * 60_000);
      const reservation = await tx.reservation.create({
        data: {
          propertyId: input.propertyId,
          ownerId: input.ownerId,
          guestProfileId: guest.id,
          source: inquiry.channel === "PHONE" ? "PHONE" : "DIRECT",
          attribution: "OWNER_DIRECT",
          externalRef: inquiry.reference,
          status: "HELD",
          holdExpiresAt: expiresAt,
          checkIn,
          checkOut,
          adults: input.adults,
          children: input.children,
          currency: roomType.currency,
          roomRate,
          taxAmount,
          totalAmount,
          depositAmount: 0,
          notes: `Reception hold created from ${inquiry.channel.toLowerCase()} inquiry ${inquiry.reference}.`,
          createdById: input.actorId,
          allocations: {
            create: {
              roomTypeId: roomType.id,
              startDate: checkIn,
              endDate: checkOut,
              ratePlanId: ratePlan?.id ?? null,
              mealPlan: ratePlan?.mealPlan ?? null,
            },
          },
          events: {
            create: {
              type: "CREATED",
              actorId: input.actorId,
              data: { source: "RECEPTION_INQUIRY", inquiryId: inquiry.id, channel: inquiry.channel },
            },
          },
        },
      });

      const linked = await tx.nrmsGuestInquiry.updateMany({
        where: {
          id: inquiry.id,
          propertyId: input.propertyId,
          version: input.version,
          reservationId: null,
          status: { notIn: ["RESOLVED", "CONVERTED", "CLOSED"] },
        },
        data: {
          reservationId: reservation.id,
          status: "CONVERTED",
          activeConversationKey: null,
          convertedAt: new Date(),
          lastMessageAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (!linked.count) throw new InquiryConversionRace();

      await tx.nrmsGuestMessage.create({
        data: {
          inquiryId: inquiry.id,
          channel: inquiry.channel,
          direction: "SYSTEM",
          body: `Room hold ${reservation.id} created for one hour.`,
          senderName: input.actorName,
          sentById: input.actorId,
          metadata: { reservationId: reservation.id, expiresAt: expiresAt.toISOString(), totalAmount, currency: roomType.currency },
        },
      });

      return { ok: true, reservationId: reservation.id, status: reservation.status, expiresAt, totalAmount, roomRate, currency: roomType.currency } as const;
    }, HOLD_TX_OPTIONS);
  } catch (error) {
    if (error instanceof InquiryConversionRace || (error instanceof Error && error.message === "INQUIRY_CONVERSION_RACE")) {
      return { ok: false, code: "VERSION_CONFLICT", message: "This inquiry was converted on another device" };
    }
    throw error;
  }
}
