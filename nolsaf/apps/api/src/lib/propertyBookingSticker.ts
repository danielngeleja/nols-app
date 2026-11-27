/**
 * Round "Book, Pay this property via NoLSAF" sticker for a property's door or reception.
 *
 * The QR opens the property's public page with `?src=qr&qr=sticker`, so the
 * channel report (docs/CHANNEL_ATTRIBUTION.md) counts walk-in bookings as QR.
 * It carries no partner code and no row id: the public page address uses the
 * opaque booking key only. Only an APPROVED property gets a sticker, because
 * any other status has no public page to land on.
 */
import QRCode from "qrcode";
import { buildPropertySlug } from "./publicPropertyDto.js";
import { webOrigin } from "./salesPartnerCard.js";

export const STICKER_QR_KIND = "sticker";

export const bookingStickerSelect = {
  id: true,
  title: true,
  status: true,
  type: true,
  city: true,
  district: true,
  regionName: true,
  rentalMode: true,
  nrmsBookingKey: true,
} as const;

export type StickerProperty = {
  title: string;
  status: string;
  type?: string | null;
  city?: string | null;
  district?: string | null;
  regionName?: string | null;
  rentalMode?: string | null;
  nrmsBookingKey: string | null;
};

export type BookingSticker = {
  title: string;
  place: string | null;
  rentalMode: "NIGHTLY" | "LONG_STAY";
  url: string;
  qrSvg: string;
};

/** Why a property has no sticker, in words an owner or partner can act on. */
export function stickerUnavailableReason(property: Pick<StickerProperty, "status" | "nrmsBookingKey">): string | null {
  if (String(property.status || "").toUpperCase() !== "APPROVED") {
    return "The sticker is available once NoLSAF approves this property and it is live for booking.";
  }
  if (!property.nrmsBookingKey) return "This property has no public page yet.";
  return null;
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bEs\b/g, "es");
}

/** "DAR ES SALAAM, UBUNGO" reads as "Ubungo, Dar es Salaam"; repeats dropped. */
export function stickerPlace(property: Pick<StickerProperty, "district" | "city" | "regionName">): string | null {
  const seen = new Set<string>();
  const parts = [property.district, property.city, property.regionName]
    .map((part) => titleCase(String(part || "").trim()))
    .filter((part) => {
      const key = part.toLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return parts.length ? parts.slice(0, 2).join(", ") : null;
}

export function stickerUrl(property: Pick<StickerProperty, "title" | "nrmsBookingKey">, origin = webOrigin()): string {
  const slug = buildPropertySlug(String(property.title || ""), String(property.nrmsBookingKey || ""));
  return `${origin}/public/properties/${encodeURIComponent(slug)}?src=qr&qr=${STICKER_QR_KIND}`;
}

export async function buildBookingSticker(property: StickerProperty, origin = webOrigin()): Promise<BookingSticker> {
  const url = stickerUrl(property, origin);
  // SVG stays sharp at any print size. "H" (30% recovery) because the sticker
  // prints the NoLSAF mark over the centre (about 9% of the code), and still
  // leaves room for a scratched or sun-faded sticker.
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "H", color: { dark: "#0b2420", light: "#ffffff" } });
  return {
    title: property.title,
    place: stickerPlace(property),
    rentalMode: property.rentalMode === "LONG_STAY" ? "LONG_STAY" : "NIGHTLY",
    url,
    qrSvg,
  };
}
