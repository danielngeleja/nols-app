export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  ForgotPassword: undefined;
  Register: { ref?: string } | undefined;
  CostCalculator: undefined;
  MyRides: undefined;
  /**
   * Customer record screens receive the row id (for in-app state and older
   * APIs) plus `ref`, the opaque reference the API resolves (bk_, tr_, gs_, rd_).
   * API calls send `ref` when present, so paths do not carry database ids.
   */
  RideDetail: { id: number; ref?: string | null };
  MyBookings: undefined;
  CancelBooking: {
    /** Booking code to pre-resolve the cancellation lookup. */
    bookingCode: string;
    /** Shown in the header while the lookup resolves. */
    propertyTitle?: string;
  };
  MyCancellations: undefined;
  CancellationDetail: { id: number };
  AddTransport: {
    bookingId: number;
    bookingRef?: string | null;
    mode: "scheduled" | "instant";
    propertyId?: number | null;
    propertyTitle: string;
    propertyArea: string;
  };
  Account: undefined;
  AccountPreferences: undefined;
  BusinessAccess: undefined;
  Notifications: undefined;
  SafetyCenter: undefined;
  SavedProperties: undefined;
  AccountSecurity: { mode: "password" | "passkeys" | "2fa" | "applock" };
  AccountResources: { mode: "policies" | "help" | "support" };
  TravellerGroups: { tourBookingId?: number; tourBookingRef?: string | null; tourBookingTitle?: string } | undefined;
  GroupStayRequest: undefined;
  MyGroupStays: undefined;
  GroupStayDetail: { id: number; ref?: string | null };
  GroupStayDeposit: { id: number; ref?: string | null };
  ProfileCompletion: undefined;
  Payments: undefined;
  VerifiedStays:
    | {
        region?: string;
        propertyType?: "HOTEL" | "LODGE" | "APARTMENT" | "VILLA" | "GUEST_HOUSE" | "BUNGALOW" | "CABIN" | "HOMESTAY" | "CONDO" | "HOUSE";
      }
    | undefined;
  TourPackages: undefined;
  /** `operatorKey` (the opaque public key) is how the operator is loaded; `agentId` is still sent in the booking body. */
  TourOperator: { agentId: number; operatorKey?: string | null; operatorName?: string };
  TourPackageDetail: { agentId: number; operatorKey?: string | null; packageId: string | number | null; operatorName?: string };
  TourBookingReview: { agentId: number; operatorKey?: string | null; packageId: string | number; packageName?: string; operatorName?: string };
  TourBookingPayment: { bookingId: number; accessToken: string };
  MyTours: undefined;
  TourDetail: { id: number; ref?: string | null };
  /**
   * `slug` (title plus the property's public key) is how the API finds a stay;
   * the numeric id is kept for in-app state (saved, availability) and as a
   * fallback for an older API. Always pass the slug when the card has one.
   */
  PropertyDetail: { id: number; slug?: string; title?: string; startBooking?: boolean };
  /**
   * Public certificate view. `token` is the signed `t` value from a
   * /verify/property link, which is also what the printed QR code encodes.
   */
  PropertyVerification: { token: string };
  /**
   * Guest menu. `token` is an NRMS order-point token: a PREVIEW point for
   * read-only browsing, or the guest's own ROOM point while checked in. The
   * server decides which, so the screen never has to trust the caller.
   */
  NrmsMenu: { token: string; title?: string };
  BookingReview: {
    propertyId: number;
    /** Public slug used to load the stay; see PropertyDetail. */
    propertySlug?: string;
    propertyTitle?: string;
    /** roomsSpec index preselected from detail; legacy room type/code is also accepted. */
    roomCode?: string | null;
    /** Preselected dates as YYYY-MM-DD, if the guest already picked them. */
    checkIn?: string | null;
    checkOut?: string | null;
  };
  BookingPayment: {
    invoiceId: number;
    accessToken: string;
  };
  Search:
    | {
        destination?: string;
        filter?: "all" | "stays" | "tours" | "places";
        city?: string;
        propertyType?: "HOTEL" | "LODGE" | "APARTMENT" | "VILLA" | "GUEST_HOUSE" | "BUNGALOW" | "CABIN" | "HOMESTAY" | "CONDO" | "HOUSE";
      }
    | undefined;
};
