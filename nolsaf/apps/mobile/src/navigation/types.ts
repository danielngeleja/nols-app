export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  AccountMfa: { challengeId: string; expiresInSeconds?: number };
  ForgotPassword: undefined;
  Register: { ref?: string } | undefined;
  CustomerHome: undefined;
  CostCalculator: undefined;
  MyRides: undefined;
  RideDetail: { id: number };
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
    mode: "scheduled" | "instant";
    propertyId?: number | null;
    propertyTitle: string;
    propertyArea: string;
  };
  Account: undefined;
  AccountPreferences: undefined;
  BusinessAccess: undefined;
  Notifications: undefined;
  SavedProperties: undefined;
  AccountSecurity: { mode: "password" | "passkeys" | "2fa" };
  AccountResources: { mode: "policies" | "help" | "support" };
  TravellerGroups: { tourBookingId?: number; tourBookingTitle?: string } | undefined;
  GroupStayRequest: undefined;
  MyGroupStays: undefined;
  GroupStayDetail: { id: number };
  GroupStayDeposit: { id: number };
  ProfileCompletion: undefined;
  Payments: undefined;
  VerifiedStays:
    | {
        region?: string;
        propertyType?: "HOTEL" | "LODGE" | "APARTMENT" | "VILLA" | "GUEST_HOUSE" | "BUNGALOW" | "CABIN" | "HOMESTAY" | "CONDO" | "HOUSE";
      }
    | undefined;
  TourPackages: undefined;
  TourOperator: { operatorKey: string; operatorName?: string };
  TourPackageDetail: { operatorKey: string; packageId: string | number | null; operatorName?: string };
  TourBookingReview: { operatorKey: string; packageId: string | number; packageName?: string; operatorName?: string };
  TourBookingPayment: { bookingId: number; accessToken: string };
  MyTours: undefined;
  TourDetail: { id: number };
  PropertyDetail: { propertyKey: string; title?: string };
  BookingReview: {
    propertyId: number;
    /** Opaque public slug/key used to reload the public property detail. */
    propertyKey: string;
    propertyTitle?: string;
    /** Room type key preselected from the detail screen, if any. */
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
