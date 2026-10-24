import type { PublicPropertyDetail } from "./types";
import type { NormalizedRoom } from "./roomSpec";
import { priceWithCommission } from "../bookings/priceUtils";

const WHOLE_PLACE_TYPES = new Set(["VILLA", "APARTMENT", "CONDO", "BUNGALOW", "CABIN", "TOWNHOUSE", "HOUSE"]);

export function getStayBookingMode(detail: Pick<PublicPropertyDetail, "type" | "roomsSpec">): "ROOM" | "ENTIRE_UNIT" {
  const entries = Array.isArray(detail.roomsSpec) ? detail.roomsSpec : [];
  if (entries.some((entry) => entry.bookingMode === "ROOM")) return "ROOM";
  if (entries.some((entry) => entry.bookingMode === "ENTIRE_UNIT")) return "ENTIRE_UNIT";
  if (entries.length > 1) return "ROOM";
  return WHOLE_PLACE_TYPES.has(String(detail.type || "").toUpperCase().replace(/[\s-]+/g, "_")) ? "ENTIRE_UNIT" : "ROOM";
}

export function selectedGuestCapacity(room: NormalizedRoom | null, units: number): number | null {
  if (!room?.maxGuestsPerUnit) return null;
  return room.maxGuestsPerUnit * Math.max(1, units);
}

export function occupancyPrice(room: NormalizedRoom | null, guests: number, units: number, commission: number) {
  const unitCount = Math.max(1, units);
  const maximumGuests = selectedGuestCapacity(room, unitCount);
  const includedGuests = room?.includedGuests;
  const extraGuestFee = room?.extraGuestFee;
  const hasExtraGuestRate = Boolean(
    includedGuests && extraGuestFee &&
    (maximumGuests == null || includedGuests * unitCount < maximumGuests)
  );
  const extraGuests = hasExtraGuestRate ? Math.max(0, guests - includedGuests! * unitCount) : 0;
  const grossExtraGuestFee = hasExtraGuestRate ? priceWithCommission(extraGuestFee!, commission) : 0;
  return { maximumGuests, includedGuests: hasExtraGuestRate ? includedGuests : null, extraGuests, grossExtraGuestFee };
}
