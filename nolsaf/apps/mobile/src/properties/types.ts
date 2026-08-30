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
  /** Optional gallery. The list endpoint usually sends one image; when more are
   *  present the card auto slides through them. */
  images?: string[] | null;
  /** Rooms available for the selected day. Set only when a date filter is
   *  active; null means sold out, undefined means no date chosen. */
  roomsAvailable?: number | null;
  services: unknown;
  basePrice: number | null;
  currency: string | null;
  maxGuests: number | null;
  totalBedrooms: number | null;
  totalBathrooms: number | null;
};

export type RoomSpec = {
  roomType?: string;
  name?: string;
  code?: string;
  price?: number | string;
  pricePerNight?: number | string;
  count?: number;
  quantity?: number;
  maxGuests?: number;
  capacity?: number;
  beds?: number | Record<string, number | string | null | undefined>;
  images?: string[];
  roomImages?: string[];
  [key: string]: unknown;
};

export type PublicPropertyDetail = {
  id: number;
  slug: string;
  title: string;
  type: string;
  status: string;
  description: string | null;
  buildingType: string | null;
  totalFloors: number | null;
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
  services: unknown;
  roomsSpec: RoomSpec[];
  /**
   * Link to the property's public read-only NRMS menu preview. Present only
   * when NRMS is active on the property and the owner turned the public menu
   * on; the API resolves it to the property's PREVIEW order point.
   */
  nrmsMenuUrl?: string | null;
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
};

/** Shape returned by GET /api/public/properties/verification?token=... */
export type PropertyVerificationCertificate = {
  issuer: string;
  property: {
    id: number;
    title: string;
    type: string;
    location: string;
  };
  verification: {
    status: "VERIFIED";
    verifiedAt: string | null;
    verifiedBy: string;
    verifiedByRole: string;
    method: string;
    note: string;
    checklist: string[];
    lastRefreshedAt: string | null;
  };
};

export type PropertyVerificationResponse = {
  ok: boolean;
  valid?: boolean;
  certificate?: PropertyVerificationCertificate;
};

export type PropertyListResponse = {
  items: PublicPropertyCard[];
  total: number;
  page: number;
  pageSize: number;
  warning?: string;
};

export type PropertySearchParams = {
  q?: string;
  region?: string;
  district?: string;
  city?: string;
  types?: string;
  guests?: number;
  minPrice?: number;
  maxPrice?: number;
  paymentModes?: string;
  page?: number;
  pageSize?: number;
  sort?: "newest" | "price_asc" | "price_desc";
};

export type PublicHomeSummary = {
  propertyTypes?: {
    counts?: Record<string, number | null>;
    samples?: Record<string, PublicPropertyCard | null>;
  };
};

export type SavedPropertyItem = {
  id: number;
  slug: string;
  title: string;
  location: string;
  primaryImage: string | null;
  basePrice: number | null;
  currency: string | null;
  services: unknown;
  savedAt: string;
  sharedAt: string | null;
};

export type SavedPropertyListResponse = {
  ok: boolean;
  items: SavedPropertyItem[];
  total: number;
  page: number;
  pageSize: number;
};
