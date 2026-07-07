export type BookingProperty = {
  id: number;
  title: string | null;
  type?: string | null;
  regionName?: string | null;
  district?: string | null;
  city?: string | null;
  slug?: string | null;
};

/** A row from GET /api/customer/bookings. Only paid/active stays (and payable
 *  drafts) are returned; transport is offered on paid stays only. */
export type BookingListItem = {
  id: number;
  property: BookingProperty | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  totalAmount: number | null;
  roomType?: string | null;
  rooms?: number | null;
  isValid: boolean;
  isPaid: boolean;
  bookingCode: string | null;
  codeStatus?: string | null;
  invoice?: {
    id: number;
    invoiceNumber?: string | null;
    receiptNumber?: string | null;
    status?: string | null;
    total?: number | null;
    netPayable?: number | null;
    paidAt?: string | null;
  } | null;
  dashboardBucket: "PAID" | "DRAFT";
  draftExpiresAt?: string | null;
  draftExpiryStatus?: "ACTIVE" | "EXPIRED" | string | null;
  invoiceId?: number | null;
  invoiceAccessToken?: string | null;
  draftAvailability?: InvoiceDraftAvailability | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type BookingListResponse = {
  items: BookingListItem[];
  total: number;
  page: number;
  pageSize: number;
};

/** Full property record carried by GET /api/customer/bookings/:id. Coordinates
 *  may be null when the owner hasn't registered them yet. */
export type BookingDetailProperty = BookingProperty & {
  latitude?: number | null;
  longitude?: number | null;
  currency?: string | null;
  country?: string | null;
};

export type BookingDetail = {
  id: number;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  isPaid: boolean;
  isValid: boolean;
  property: BookingDetailProperty | null;
};

/** A booked stay that can carry transport, passed into the transport flow. */
export type TransportBookingContext = {
  bookingId: number;
  propertyId: number | null;
  propertyTitle: string;
  propertyArea: string;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Checkout: create booking → create invoice → pay. Mirrors the web flow
 * (apps/web/app/public/booking/confirm + payment) against the same endpoints.
 * ──────────────────────────────────────────────────────────────────────────── */

export type GuestSex = "Male" | "Female" | "Other";

/** Request body for POST /api/public/bookings. The server computes the
 *  authoritative price and fare; transport fields are only sent when bundled. */
export type CreateBookingInput = {
  propertyId: number;
  checkIn: string; // ISO 8601
  checkOut: string; // ISO 8601
  guestName: string;
  guestPhone: string; // normalized to +255XXXXXXXXX
  guestEmail?: string | null;
  nationality?: string | null;
  sex?: GuestSex | null;
  adults?: number;
  children?: number;
  pets?: number;
  rooms?: number;
  roomCode?: string | null;
  specialRequests?: string | null;
  includeTransport?: boolean;
  transportPickupMode?: "current" | "arrival" | "manual" | null;
  transportVehicleType?: "BODA" | "BAJAJI" | "CAR" | "XL" | "PREMIUM" | null;
  transportOriginLat?: number | null;
  transportOriginLng?: number | null;
  transportOriginAddress?: string | null;
  transportFare?: number | null;
  arrivalType?: "FLIGHT" | "BUS" | "TRAIN" | "FERRY" | "OTHER" | null;
  arrivalNumber?: string | null;
  transportCompany?: string | null;
  arrivalTime?: string | null; // ISO 8601
  pickupLocation?: string | null;
};

export type CreateBookingResult = {
  ok: boolean;
  bookingId: number;
  /** Short-lived proof-of-creation token required by from-booking. */
  bookingAccessToken: string;
  totalAmount: number;
  accommodationAmount: number;
  transportFare: number;
  nights: number;
  checkIn: string;
  checkOut: string;
  currency: string;
  property: { id: number; title: string | null };
};

export type InvoiceFromBookingResult = {
  invoiceId: number;
  /** Signed access token gating reads of and payments against this invoice. */
  accessToken: string;
};

export type InvoicePriceBreakdown = {
  accommodationSubtotal: number;
  taxPercent: number;
  taxAmount: number;
  discount: number;
  transportFare: number;
  commission: number;
  subtotal: number;
  total: number;
};

export type InvoiceDraftAvailability = {
  available: boolean;
  status: "AVAILABLE" | "UNAVAILABLE" | "PROPERTY_UNAVAILABLE";
  reason: string;
  message: string;
  requestedRooms: number;
  availableRooms: number;
  selectedRoomType: string | null;
};

export type InvoiceData = {
  id: number;
  invoiceNumber: string;
  paymentRef: string;
  status: string; // DRAFT | PENDING | PAID | ...
  totalAmount: number;
  currency: string;
  booking: {
    id: number;
    bookingCode: string | null;
    checkIn: string;
    checkOut: string;
    nights: number;
    guestName: string | null;
    guestPhone: string | null;
    roomCode: string | null;
    roomsQty?: number;
    includeTransport?: boolean;
    totalAmount: number;
  };
  property: {
    id: number;
    title: string;
    type: string;
    slug?: string;
    primaryImage: string | null;
    basePrice: number;
  };
  draftAvailability?: InvoiceDraftAvailability | null;
  priceBreakdown: InvoicePriceBreakdown;
};

/** AzamPay mobile money provider ids, matching the API's enum. */
export type MnoProvider = "Airtel" | "Mpesa" | "Tigo" | "Halopesa";

export type PaymentInitiateResult = {
  paymentRef?: string;
  transactionId?: string;
  message?: string;
  retryAfterSeconds?: number;
};
