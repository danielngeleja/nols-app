/**
 * TypeScript types for property-related data structures
 */

export type PolicyItem = {
  text: string;
  Icon?: any;
  iconColor?: string;
};

export type RoomSpecRow = {
  roomType: string;
  roomsCount: number | null;
  bedsSummary: string;
  description: string;
  amenities: string[];
  bathItems: string[];
  bathPrivate: string;
  pricePerNight: number | null;
  discountLabel: string | null;
  payActionLabel: string;
  policies: PolicyItem[];
};

export type PropertyMode = "admin" | "public" | "owner";

export interface PropertyPreviewProps {
  propertyId: number;
  mode?: PropertyMode;
  onApproved?: () => void;
  onRejected?: () => void;
  onUpdated?: () => void;
  onClose?: () => void;
  /** NIGHTLY or LONG_STAY. Long stays hide the nightly price table and the check-in house rules. */
  rentalMode?: string | null;
  /** Admin: extra steps for the review progress bar (long-stay readiness). */
  reviewChecks?: Array<{ label: string; ok: boolean }>;
  /** Admin: the extra steps are still loading, so the bar shows "Checking" instead of a low score. */
  reviewPending?: boolean;
  /** Admin: shown right under the command bar (the long-stay review). */
  adminTop?: import("react").ReactNode;
}

export interface PropertyLocation {
  address?: string;
  city?: string;
  region?: string;
  regionName?: string;
  district?: string;
  ward?: string;
  street?: string;
  apartment?: string;
  zip?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
}

export interface HouseRules {
  checkIn?: string;
  checkInFrom?: string;
  checkInTo?: string;
  checkOut?: string;
  checkOutFrom?: string;
  checkOutTo?: string;
  smoking?: boolean | string;
  pets?: boolean | string;
  petsNote?: string;
  parties?: string;
  safetyMeasures?: string[];
  other?: string;
}

export interface PropertyServices {
  commissionPercent?: number;
  discountRules?: Array<{
    minDays: number;
    discountPercent: number;
    enabled: boolean;
  }>;
  [key: string]: any; // For other service properties
}

export interface RoomSpec {
  roomType?: string;
  name?: string;
  label?: string;
  roomsCount?: number;
  count?: number;
  quantity?: number;
  beds?: {
    twin?: number;
    full?: number;
    queen?: number;
    king?: number;
  };
  roomDescription?: string;
  description?: string;
  amenities?: string[];
  otherAmenities?: string[];
  bathItems?: string[];
  bathPrivate?: string;
  smoking?: string;
  towelColor?: string;
  pricePerNight?: number;
  price?: number;
  discountPercent?: number;
  discountAmount?: number;
  discountedPrice?: number;
  [key: string]: any;
}

export interface Property {
  id: number;
  name?: string;
  title?: string;
  description?: string;
  photos?: string[];
  images?: string[];
  roomsSpec?: RoomSpec[];
  services?: PropertyServices | string[] | string | null;
  location?: PropertyLocation;
  status?: string;
  totalBedrooms?: number;
  totalBathrooms?: number;
  maxGuests?: number;
  houseRules?: HouseRules | string | null;
  basePrice?: number | null;
  currency?: string | null;
  ownerId?: number;
  owner?: {
    id: number;
    name: string;
    email: string;
    phone?: string | null;
  };
  [key: string]: any; // Allow additional properties
}

export interface Review {
  id: number;
  rating: number;
  comment?: string;
  title?: string;
  ownerResponse?: string;
  ownerResponseAt?: string;
  isVerified?: boolean;
  user?: {
    id: number;
    name: string | null;
  };
  createdAt?: string;
  [key: string]: any;
}

export interface ReviewsData {
  reviews: Review[];
  averageRating?: number;
  totalReviews?: number;
  [key: string]: any;
}

export interface AuditHistoryItem {
  id: number;
  action: string;
  performedBy?: {
    id: number;
    name: string;
  };
  timestamp: string;
  details?: string;
  [key: string]: any;
}

