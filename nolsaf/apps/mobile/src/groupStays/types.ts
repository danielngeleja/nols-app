export const GROUP_TYPES = ["family", "workers", "event", "students", "team", "safari_stay", "other"] as const;
export type GroupType = (typeof GROUP_TYPES)[number];

export const ACCOMMODATION_TYPES = [
  "villa",
  "apartment",
  "hotel",
  "hostel",
  "lodge",
  "condo",
  "guest_house",
  "bungalow",
  "cabin",
  "homestay",
  "townhouse",
  "house",
  "dorm",
  "other"
] as const;
export type AccommodationType = (typeof ACCOMMODATION_TYPES)[number];

export const HOTEL_STAR_LABELS = ["basic", "simple", "moderate", "high", "luxury"] as const;
export type HotelStarLabel = (typeof HOTEL_STAR_LABELS)[number];

export type Passenger = {
  firstname: string;
  lastname: string;
  phone?: string;
  age?: string;
  gender?: string;
  nationality?: string;
};

export type Arrangement = {
  pickup: boolean;
  transport: boolean;
  meals: boolean;
  guide: boolean;
  equipment: boolean;
  pickupLocation?: string | null;
  pickupTime?: string | null;
  notes?: string | null;
};

export type CreateGroupBookingInput = {
  groupType: GroupType;
  fromCountry?: string | null;
  fromRegion?: string | null;
  fromDistrict?: string | null;
  fromWard?: string | null;
  fromLocation?: string | null;
  toRegion: string;
  toDistrict?: string | null;
  toWard?: string | null;
  toLocation?: string | null;
  accommodationType: AccommodationType | string;
  minHotelStarLabel?: HotelStarLabel | null;
  headcount: number;
  maleCount?: number | null;
  femaleCount?: number | null;
  otherCount?: number | null;
  roomSize: number;
  roomsNeeded: number;
  needsPrivateRoom: boolean;
  privateRoomCount: number;
  checkin?: string | null;
  checkout?: string | null;
  useDates: boolean;
  arrangements: Arrangement;
  roster: Passenger[];
};

export type CreateGroupBookingResult = {
  success: boolean;
  bookingId: number;
  booking?: {
    id: number;
    status?: string;
    destination?: string;
  };
};

export type GroupBookingStatus = "PENDING" | "AWAITING_DEPOSIT" | "CONFIRMED" | "PROCESSING" | "CANCELED" | "COMPLETED" | "EXPIRED";

export type GroupBookingListItem = {
  id: number;
  groupType: GroupType | string;
  toRegion: string;
  toDistrict?: string | null;
  toWard?: string | null;
  accommodationType: string;
  headcount: number;
  roomsNeeded: number;
  status: GroupBookingStatus | string;
  checkIn?: string | null;
  checkOut?: string | null;
  useDates: boolean;
  totalAmount?: number | null;
  ownerAmount?: number | null;
  commissionPercent?: number | null;
  currency?: string | null;
  depositAmount?: number | null;
  depositPaid?: boolean | null;
  depositDueAt?: string | null;
  isOpenForClaims?: boolean | null;
  recommendedPropertyIds?: number[] | null;
  confirmedPropertyId?: number | null;
  adminNotes?: string | null;
  createdAt: string;
};

export type GroupBookingDetail = GroupBookingListItem & {
  fromCountry?: string | null;
  fromRegion?: string | null;
  fromDistrict?: string | null;
  fromWard?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  minHotelStarLabel?: HotelStarLabel | string | null;
  maleCount?: number | null;
  femaleCount?: number | null;
  otherCount?: number | null;
  roomSize: number;
  needsPrivateRoom: boolean;
  privateRoomCount: number;
  arrPickup: boolean;
  arrTransport: boolean;
  arrMeals: boolean;
  arrGuide: boolean;
  arrEquipment: boolean;
  pickupLocation?: string | null;
  pickupTime?: string | null;
  arrangementNotes?: string | null;
  roster?: Passenger[] | null;
};

export type GroupBookingDetailResponse = {
  success: boolean;
  data: GroupBookingDetail;
};

export type GroupBookingMessage = {
  id: number;
  messageType: string;
  message: string;
  senderRole: "ADMIN" | "USER" | "SYSTEM" | string;
  senderName: string;
  createdAt: string;
  formattedDate?: string;
};

export type GroupBookingMessagesResponse = {
  success: boolean;
  messages: GroupBookingMessage[];
};

export type SendGroupBookingMessageResponse = {
  success: boolean;
  message: string;
};

export type AuctionOffer = {
  claimId: number;
  property: {
    id: number;
    title: string;
    type?: string | null;
    regionName?: string | null;
    district?: string | null;
    ward?: string | null;
    city?: string | null;
    imageUrl?: string | null;
  };
  offer: {
    offeredPricePerNight?: number | null;
    discountPercent?: number | null;
    totalAmount?: number | null;
    customerPricePerNight?: number | null;
    customerOriginalPricePerNight?: number | null;
    customerTotalAmount?: number | null;
    customerOriginalTotalAmount?: number | null;
    customerSavingsAmount?: number | null;
    currency?: string | null;
    specialOffers?: string | null;
    notes?: string | null;
  };
};

export type AuctionOffersResponse = {
  bookingId: number;
  confirmedPropertyId: number | null;
  offers: AuctionOffer[];
};

export type AuctionConfirmResponse = {
  ok: boolean;
  bookingId: number;
  propertyId: number;
  ownerAmount?: number | null;
  commissionPercent?: number | null;
  totalAmount?: number | null;
  depositAmount?: number | null;
};

export type GroupBookingDepositStatusResponse = {
  ok: boolean;
  status: string;
  totalAmount?: number | null;
  ownerAmount?: number | null;
  commissionPercent?: number | null;
  currency?: string | null;
  depositAmount?: number | null;
  depositPaid?: boolean | null;
  depositPaidAt?: string | null;
  depositDueAt?: string | null;
};

export type DepositPaymentInitiateResult = {
  ok: boolean;
  paymentRef: string;
  transactionId?: string | null;
  checkoutUrl?: string | null;
  status: string;
};

export type GroupBookingListResponse = {
  success: boolean;
  data: GroupBookingListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
};
