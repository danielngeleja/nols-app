import type { PropertyImage } from "@prisma/client";

const DEFAULT_PROPERTY_VERIFICATION_METHOD = "Site visit and listing review";

export type PublicPropertyCard = {
  id: number;
  slug: string;
  title: string;
  type: string;
  location: string;
  regionName: string | null;
  district: string | null;
  ward: string | null;
  city: string | null;
  country: string | null;
  parkPlacement: "INSIDE" | "NEARBY" | null;
  primaryImage: string | null;
  services: string[];
  basePrice: number | null;
  currency: string | null;
  maxGuests: number | null;
  totalBedrooms: number | null;
  totalBathrooms: number | null;
};

export type PublicPropertyDetail = {
  id: number;
  slug: string;
  title: string;
  type: string;
  status: string;
  description: string | null;
  buildingType?: string | null;
  totalFloors?: number | null;
  regionName: string | null;
  district: string | null;
  ward: string | null;
  city: string | null;
  street: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  images: string[];
  basePrice: number | null;
  currency: string | null;
  maxGuests: number | null;
  totalBedrooms: number | null;
  totalBathrooms: number | null;
  services: any; // Can be array of strings OR object with commissionPercent and discountRules
  roomsSpec: any[];
  physicalVerification?: {
    status: "VERIFIED" | "PENDING";
    verifiedAt: string | null;
    verifiedBy: string | null;
    verifiedByRole: string | null;
    method: string;
    note: string | null;
    checklist: string[];
    verificationUrl?: string | null;
    qrCodeDataUrl?: string | null;
  };
  ownerId?: number; // Include ownerId to check ownership on frontend
  /// Read-only preview of the property's live NRMS restaurant/bar menu, only
  /// present when the owner has opted in. Null means either NRMS isn't
  /// active, there's no restaurant/bar, or the owner hasn't published it.
  nrmsMenuUrl?: string | null;
};

export function slugify(input: string) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function buildPropertySlug(title: string, id: number) {
  const base = slugify(title);
  return base ? `${base}-${id}` : String(id);
}

function safeString(v: any): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function normalizeRoomsSpecInput(roomsSpec: any): any[] {
  if (Array.isArray(roomsSpec)) return roomsSpec;
  if (typeof roomsSpec === "string") {
    try {
      const parsed = JSON.parse(roomsSpec);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function publicVerifierName(actor: any): string | null {
  if (!actor || typeof actor !== "object") return null;
  return safeString(actor.fullName) || safeString(actor.name) || "NoLSAF Admin";
}

function buildPhysicalVerification(p: any): PublicPropertyDetail["physicalVerification"] | undefined {
  const record = p?.physicalVerification || p?.verification;
  if (!record || typeof record !== "object") return undefined;

  const status = String(record.status || "").toUpperCase();
  if (status !== "VERIFIED" && status !== "PENDING") return undefined;

  const verifiedAt = record?.verifiedAt instanceof Date
    ? record.verifiedAt.toISOString()
    : typeof record?.verifiedAt === "string"
      ? record.verifiedAt
      : null;
  const checklist = Array.isArray(record.checklist)
    ? record.checklist.map((item: any) => String(item || "").trim()).filter(Boolean)
    : [];

  return {
    status,
    verifiedAt,
    verifiedBy: publicVerifierName(record.verifier),
    verifiedByRole: "ADMIN",
    method: safeString(record.method) || DEFAULT_PROPERTY_VERIFICATION_METHOD,
    note: safeString(record.note),
    checklist: checklist.length
      ? checklist
      : ["Property details reviewed", "Location and listing information checked", "Photos and stay information reviewed", "Host listing approved"],
    verificationUrl: safeString(record.verificationUrl),
    qrCodeDataUrl: safeString(record.qrCodeDataUrl)
  };
}

function extractEffectiveBasePrice(p: any): number | null {
  const basePrice = p?.basePrice != null ? Number(p.basePrice) : NaN;
  if (Number.isFinite(basePrice) && basePrice > 0) return basePrice;

  const roomsSpec = normalizeRoomsSpecInput(p?.roomsSpec);
  const roomPrices = roomsSpec
    .map((room: any) => {
      const raw = room?.pricePerNight ?? room?.price ?? null;
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    })
    .filter((value: number | null): value is number => value != null);

  if (roomPrices.length === 0) return null;
  return Math.min(...roomPrices);
}

function isRenderablePublicImageUrl(url: string) {
  // Never expose browser-only blob URLs on the public site (they won't load for other users)
  // Also exclude file:// style local paths and base64 data URIs. Data URIs can make
  // public property payloads multiple megabytes before the browser even paints.
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith("blob:")) return false;
  if (u.startsWith("file:")) return false;
  if (u.startsWith("data:")) return false;
  return true;
}

function optimizeCloudinaryImageUrl(url: string, width = 1280): string {
  if (!/res\.cloudinary\.com\/.+\/image\/upload\//i.test(url)) return url;
  if (/\/image\/upload\/[^/]*(?:f_auto|q_auto|w_)\b/i.test(url)) return url;
  const clampedWidth = Math.min(2400, Math.max(320, Math.round(width)));
  return url.replace("/image/upload/", `/image/upload/f_auto,q_auto,w_${clampedWidth}/`);
}

function toPublicImageUrl(url: string, width?: number): string | null {
  const safe = safeString(url);
  if (!safe || !isRenderablePublicImageUrl(safe)) return null;
  return optimizeCloudinaryImageUrl(safe, width);
}

function pickRoomImages(roomsSpec: any): string[] {
  if (!Array.isArray(roomsSpec)) return [];
  const out: string[] = [];
  for (const r of roomsSpec) {
    const arr = (r as any)?.roomImages;
    if (!Array.isArray(arr)) continue;
    for (const v of arr) {
      const s = safeString(v);
      if (s && isRenderablePublicImageUrl(s)) out.push(s);
    }
  }
  return out;
}

export function pickImages(opts: {
  images?: Array<Pick<PropertyImage, "url" | "thumbnailUrl" | "status">> | null;
  photos?: any;
  limit?: number | null;
}): string[] {
  const { images, limit = 12 } = opts;

  // Normalize photos: MariaDB adapter may return JSON fields as strings rather than parsed arrays
  let photos = opts.photos;
  if (typeof photos === "string") {
    try { photos = JSON.parse(photos); } catch { photos = null; }
  }

  const out: string[] = [];

  // Prefer moderated/processed images when available; otherwise take whatever exists.
  if (Array.isArray(images) && images.length) {
    const urls = images
      .map((i) => toPublicImageUrl(safeString(i.thumbnailUrl) || safeString(i.url) || "", i.thumbnailUrl ? 900 : 1600))
      .filter((u): u is string => typeof u === "string");
    out.push(...urls);
  }

  if (Array.isArray(photos) && photos.length) {
    const urls = photos
      .map((p: any) => toPublicImageUrl(String(p || ""), 1600))
      .filter((u): u is string => typeof u === "string");
    out.push(...urls);
  }

  // Unique, preserve order
  const uniq = Array.from(new Set(out));
  if (limit === null) return uniq;
  return uniq.slice(0, Math.max(1, limit));
}

export function formatLocation(p: {
  city?: string | null;
  district?: string | null;
  ward?: string | null;
  regionName?: string | null;
  country?: string | null;
}) {
  const parts = [p.city, p.ward, p.district, p.regionName, p.country]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return parts.join(", ");
}

export function toPublicCard(p: any): PublicPropertyCard {
  const id = Number(p.id);
  const slug = buildPropertySlug(String(p.title || ""), id);
  const effectiveBasePrice = extractEffectiveBasePrice(p);
  // If primaryImage is pre-extracted (e.g. from a raw SQL query using JSON_EXTRACT or
  // batchResolvePrimaryImages), use it directly — but still validate it's a renderable URL
  // so base64 data URIs from the legacy photos JSON field can never reach the browser.
  let primaryImage: string | null;
  if (Object.prototype.hasOwnProperty.call(p, 'primaryImage')) {
    const raw = typeof p.primaryImage === 'string' ? p.primaryImage.trim() : null;
    const batched = raw ? toPublicImageUrl(raw, 900) : null;
    if (batched) {
      primaryImage = batched;
    } else if (p.photos || p.images) {
      // batchResolvePrimaryImages only checks photos[0]. If that was a data: URI, it returns null.
      // Fall back to pickImages which scans the entire photos array for any valid URL.
      // This handles properties that have a valid URL at photos[1+] but a data: URI at photos[0].
      const fallback = pickImages({ images: p.images, photos: p.photos, limit: 1 });
      primaryImage = fallback[0] ?? null;
    } else {
      primaryImage = null;
    }
  } else {
    const images = pickImages({ images: p.images, photos: p.photos, limit: 1 });
    primaryImage = images[0] ?? null;
  }

  return {
    id,
    slug,
    title: String(p.title || ""),
    type: String(p.type || ""),
    location: formatLocation(p),
    regionName: p.regionName ?? null,
    district: p.district ?? null,
    ward: p.ward ?? null,
    city: p.city ?? null,
    country: p.country ?? null,
    parkPlacement: p.parkPlacement === "INSIDE" || p.parkPlacement === "NEARBY" ? p.parkPlacement : null,
    primaryImage,
    services: p.services ?? null, // Preserve full services object (may contain commissionPercent, discountRules)
    basePrice: effectiveBasePrice,
    currency: p.currency ?? null,
    maxGuests: typeof p.maxGuests === "number" ? p.maxGuests : (p.maxGuests != null ? Number(p.maxGuests) : null),
    totalBedrooms: typeof p.totalBedrooms === "number" ? p.totalBedrooms : (p.totalBedrooms != null ? Number(p.totalBedrooms) : null),
    totalBathrooms: typeof p.totalBathrooms === "number" ? p.totalBathrooms : (p.totalBathrooms != null ? Number(p.totalBathrooms) : null),
  };
}

export function toPublicDetail(p: any): PublicPropertyDetail {
  const id = Number(p.id);
  const slug = buildPropertySlug(String(p.title || ""), id);
  const propertyImages = pickImages({ images: p.images, photos: p.photos, limit: null });
  const roomImages = pickRoomImages(p.roomsSpec);
  const images = Array.from(new Set<string>([...propertyImages, ...roomImages]));
  const effectiveBasePrice = extractEffectiveBasePrice(p);

  return {
    id,
    slug,
    title: String(p.title || ""),
    type: String(p.type || ""),
    status: String(p.status || ""),
    description: typeof p.description === "string" ? p.description : null,
    buildingType: typeof p.buildingType === "string" ? p.buildingType : (p.buildingType ?? null),
    totalFloors: typeof p.totalFloors === "number" ? p.totalFloors : (p.totalFloors != null ? Number(p.totalFloors) : null),
    regionName: p.regionName ?? null,
    district: p.district ?? null,
    ward: p.ward ?? null,
    city: p.city ?? null,
    street: p.street ?? null,
    country: p.country ?? null,
    latitude: p.latitude !== null && typeof p.latitude !== "undefined" ? Number(p.latitude) : null,
    longitude: p.longitude !== null && typeof p.longitude !== "undefined" ? Number(p.longitude) : null,
    images,
    basePrice: effectiveBasePrice,
    currency: p.currency ?? null,
    maxGuests: typeof p.maxGuests === "number" ? p.maxGuests : (p.maxGuests != null ? Number(p.maxGuests) : null),
    totalBedrooms: typeof p.totalBedrooms === "number" ? p.totalBedrooms : (p.totalBedrooms != null ? Number(p.totalBedrooms) : null),
    totalBathrooms: typeof p.totalBathrooms === "number" ? p.totalBathrooms : (p.totalBathrooms != null ? Number(p.totalBathrooms) : null),
    services: p.services ?? null, // Preserve full services object (may contain commissionPercent, discountRules)
    roomsSpec: Array.isArray(p.roomsSpec) ? p.roomsSpec : [],
    physicalVerification: buildPhysicalVerification(p),
    ownerId: p.ownerId ? Number(p.ownerId) : undefined, // Include ownerId to check ownership
    nrmsMenuUrl: typeof p.nrmsMenuUrl === "string" ? p.nrmsMenuUrl : null,
  };
}

