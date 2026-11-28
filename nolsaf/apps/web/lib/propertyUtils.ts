/**
 * Utility functions for property-related operations
 */

import { CheckCircle, CigaretteOff } from "lucide-react";
import type { PolicyItem, RoomSpecRow, RoomSpec } from "./types/property";

/**
 * Format money amount with currency
 */
export function fmtMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  const cur = currency || "TZS";
  try {
    return new Intl.NumberFormat(undefined, { 
      style: "currency", 
      currency: cur, 
      maximumFractionDigits: 0 
    }).format(Number(amount));
  } catch {
    return `${cur} ${Number(amount).toLocaleString()}`;
  }
}

/**
 * Cap words to max characters with ellipsis
 */
export function capWords(s: string, maxChars: number): string {
  const t = String(s || "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1).trimEnd() + "…";
}

/**
 * Bed size dimensions reference
 */
export const BED_DIMENSIONS: Record<string, string> = {
  twin: "38\" × 75\" (96.5 × 190.5 cm)",
  full: "54\" × 75\" (137 × 190.5 cm)",
  queen: "60\" × 80\" (152.4 × 203.2 cm)",
  king: "76\" × 80\" (193 × 203.2 cm)",
};

/**
 * Convert beds object to summary string
 */
export function bedsToSummary(beds: any): string {
  if (!beds || typeof beds !== "object") return "—";
  const entries: Array<{ key: string; label: string }> = [
    { key: "twin", label: "twin" },
    { key: "full", label: "full" },
    { key: "queen", label: "queen" },
    { key: "king", label: "king" },
  ];
  const parts = entries
    .map(({ key, label }) => {
      const n = Number((beds as any)[key]);
      if (!Number.isFinite(n) || n <= 0) return null;
      return `${n} ${label}`;
    })
    .filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : "—";
}

/**
 * Get bed dimensions from beds summary
 */
export function getBedDimensions(bedsSummary: string): string | null {
  if (!bedsSummary || bedsSummary === "—") return null;
  
  // Extract bed types from summary (e.g., "2 queen, 1 twin")
  const bedTypes = bedsSummary.split(',').map(s => {
    const match = s.trim().match(/\d+\s+(twin|full|queen|king)/i);
    return match ? match[1].toLowerCase() : null;
  }).filter(Boolean) as string[];
  
  if (bedTypes.length === 0) return null;
  
  // Get unique bed types and their dimensions
  const uniqueTypes = Array.from(new Set(bedTypes));
  const dimensions = uniqueTypes
    .map(type => {
      const dim = BED_DIMENSIONS[type];
      return dim ? `${type.charAt(0).toUpperCase() + type.slice(1)}: ${dim}` : null;
    })
    .filter(Boolean) as string[];
  
  return dimensions.length > 0 ? dimensions.join(" • ") : null;
}

export function formatClockTime(time: string): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours, 10);
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${displayHour}:${minutes || '00'} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function formatTimeRange(from: string | undefined, to: string | undefined): string | null {
  if (!from && !to) return null;
  if (from && to) {
    return `${formatClockTime(from)} - ${formatClockTime(to)}`;
  }
  return from || to || null;
}

/**
 * Normalize a single room spec to RoomSpecRow
 */
export function normalizeRoomSpec(
  r: any, 
  idx: number, 
  currency: string | null | undefined, 
  fallbackBasePrice: number | null | undefined
): RoomSpecRow {
  const roomType = String(r?.roomType || r?.name || r?.label || `Room ${idx + 1}`).trim() || `Room ${idx + 1}`;
  const roomsCountRaw = r?.roomsCount ?? r?.count ?? r?.quantity ?? null;
  const roomsCount = roomsCountRaw == null ? null : (Number.isFinite(Number(roomsCountRaw)) ? Number(roomsCountRaw) : null);

  const bedsSummary = bedsToSummary(r?.beds);
  const description = String(r?.roomDescription || r?.description || "").trim();

  const amenities = Array.from(
    new Set<string>([
      ...(Array.isArray(r?.otherAmenities) ? r.otherAmenities : []),
      ...(Array.isArray(r?.amenities) ? r.amenities : []),
    ].map((x: any) => String(x || "").trim()).filter(Boolean))
  );

  const priceRaw = r?.pricePerNight ?? r?.price ?? null;
  const pricePerNight = Number.isFinite(Number(priceRaw)) && Number(priceRaw) > 0 
    ? Number(priceRaw) 
    : (fallbackBasePrice != null ? Number(fallbackBasePrice) : null);

  const discountPercent = Number.isFinite(Number(r?.discountPercent)) ? Number(r.discountPercent) : null;
  const discountAmount = Number.isFinite(Number(r?.discountAmount)) ? Number(r.discountAmount) : null;
  const discountedPrice = Number.isFinite(Number(r?.discountedPrice)) ? Number(r.discountedPrice) : null;
  const discountLabel =
    discountPercent && discountPercent > 0
      ? `${discountPercent}% off`
      : discountAmount && discountAmount > 0
        ? `${fmtMoney(discountAmount, currency)} off`
        : discountedPrice && discountedPrice > 0 && pricePerNight && discountedPrice < pricePerNight
          ? `Now ${fmtMoney(discountedPrice, currency)}`
          : null;

  const smoking = String(r?.smoking || "").toLowerCase();
  const bathPrivate = String(r?.bathPrivate || "").toLowerCase();
  const towelColor = String(r?.towelColor || "").trim();
  const bathItems = Array.isArray(r?.bathItems) 
    ? r.bathItems.map((x: any) => String(x || "").trim()).filter(Boolean) 
    : [];

  const policies: PolicyItem[] = [
    smoking ? {
      text: "Smoking",
      Icon: smoking === "yes" ? CheckCircle : CigaretteOff,
      iconColor: smoking === "yes" ? "text-green-600" : "text-red-600",
    } : null,
    towelColor ? {
      text: `Towels: ${towelColor}`,
    } : null,
  ].filter(Boolean) as PolicyItem[];

  return {
    roomType,
    roomsCount,
    bedsSummary,
    description,
    amenities,
    bathItems,
    bathPrivate,
    pricePerNight,
    discountLabel,
    payActionLabel: "Pay now",
    policies: policies.length ? policies : [{ text: "—" }],
  };
}

/**
 * Normalize array of room specs to RoomSpecRow[]
 */
export function normalizeRoomsSpec(
  roomsSpec: RoomSpec[] | any[], 
  currency: string | null | undefined, 
  fallbackBasePrice: number | null | undefined
): RoomSpecRow[] {
  if (!Array.isArray(roomsSpec)) return [];
  return roomsSpec.map((r, idx) => normalizeRoomSpec(r, idx, currency ?? null, fallbackBasePrice ?? null));
}

