/**
 * What a guest pays for a nightly stay, in one place. Used by the public
 * booking route (the amount charged) and by Agency Desk quotes (the amount a
 * client is shown before paying), so the two can never disagree.
 *
 * Model: the owner's nightly net (room price, less the owner's room discount)
 * x rooms, plus extra-guest fees, x nights; then NoLSAF's commission on top.
 * Transport is added separately by the booking route.
 */
import { prisma } from "@nolsaf/prisma";
import { discountedNightlyNet, roomDiscountPercent } from "./roomDiscount.js";
import { guestOccupancyPricing } from "./guestOccupancyPricing.js";

/** Room-type key from a roomCode ("Suite-1" -> "Suite", "Suite" -> "Suite"). */
export function roomCodeToTypeKey(roomCode: string | null | undefined): string {
  const s = String(roomCode ?? "").trim();
  if (!s) return "default";
  return s.replace(/-\d+$/, "") || s;
}

/** Stable room-type key from a roomsSpec entry across its differing shapes. */
export function roomTypeKeyFromSpec(rt: any): string {
  const rawKey = String(rt?.code ?? rt?.roomCode ?? rt?.roomType ?? rt?.type ?? rt?.name ?? rt?.label ?? "").trim();
  return roomCodeToTypeKey(rawKey);
}

function roomTypesOf(roomsSpec: unknown): any[] {
  if (!roomsSpec || typeof roomsSpec !== "object") return [];
  const spec = roomsSpec as any;
  if (Array.isArray(spec)) return spec;
  if (spec.rooms && Array.isArray(spec.rooms)) return spec.rooms;
  // Some properties store rooms under different keys; flatten any arrays found.
  return Object.values(spec).filter((v: any) => Array.isArray(v)).flat();
}

function parseRoomPrice(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, "")); // accepts "88,000"
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The roomsSpec entry a roomCode refers to (index, type key or code prefix), or null. */
export function selectPricingRoom(roomsSpec: unknown, roomCode: string | null | undefined): any | null {
  if (!roomCode) return null;
  const roomTypes = roomTypesOf(roomsSpec);
  const roomCodeRaw = String(roomCode).trim();
  const asIndex = /^\d+$/.test(roomCodeRaw) ? Number(roomCodeRaw) : NaN;
  if (Number.isFinite(asIndex) && asIndex >= 0 && asIndex < roomTypes.length) return roomTypes[asIndex];
  const typeFromCode = roomCodeToTypeKey(roomCodeRaw);
  return (
    roomTypes.find((rt) => roomTypeKeyFromSpec(rt) === typeFromCode) ||
    roomTypes.find((rt) => {
      const c = String(rt?.code ?? rt?.roomCode ?? rt?.roomType ?? rt?.type ?? rt?.name ?? rt?.label ?? "").trim();
      return c && (roomCodeRaw === c || roomCodeRaw.startsWith(c + "-"));
    }) ||
    null
  );
}

/**
 * The owner's nightly net for a selection: the room's own price less the
 * owner's room discount, or the property base price when no room is chosen.
 */
export function nightlyNetFor(input: { basePrice: unknown; roomsSpec: unknown; roomCode: string | null | undefined }) {
  let pricePerNight = input.basePrice ? Number(input.basePrice) : 0;
  const room = input.roomCode && input.roomsSpec ? selectPricingRoom(input.roomsSpec, input.roomCode) : null;
  if (room) {
    const roomPrice = parseRoomPrice(room.pricePerNight ?? room.price ?? null);
    // The owner's room discount is charged, not just shown.
    if (roomPrice != null) pricePerNight = discountedNightlyNet(roomPrice, roomDiscountPercent(room));
  }
  return { pricePerNight, room };
}

/** NoLSAF's commission percent: the property override, else the system default (0 to 100). */
export async function effectiveCommissionPercent(propertyServices: unknown): Promise<number> {
  const fromProperty = (() => {
    const v = (propertyServices as any)?.commissionPercent;
    // null means "use the system default".
    if (v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
  })();
  if (fromProperty != null) return fromProperty;
  try {
    const s =
      (await prisma.systemSetting.findUnique({ where: { id: 1 }, select: { commissionPercent: true } as any })) ??
      (await prisma.systemSetting.create({ data: { id: 1 } } as any));
    const n = Number((s as any)?.commissionPercent ?? 0);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  } catch {
    return 0;
  }
}

/** Accommodation amounts for a selection (no transport). */
export function accommodationTotals(input: {
  pricePerNight: number;
  room: any | null;
  roomsQty: number;
  guestCount: number;
  nights: number;
  commissionPercent: number;
}) {
  const safeCommission = Number.isFinite(input.commissionPercent) ? Math.max(0, Math.min(100, input.commissionPercent)) : 0;
  const occupancy = guestOccupancyPricing(input.room, input.guestCount, input.roomsQty);
  const accommodationNet = (input.pricePerNight * input.roomsQty + occupancy.extraGuests * occupancy.extraGuestFee) * input.nights;
  const commissionAmount = safeCommission > 0 ? (accommodationNet * safeCommission) / 100 : 0;
  return {
    maximumGuests: occupancy.maximumGuests,
    overCapacity: occupancy.maximumGuests !== null && input.guestCount > occupancy.maximumGuests,
    accommodationNet,
    commissionAmount,
    accommodationGross: accommodationNet + commissionAmount,
  };
}
