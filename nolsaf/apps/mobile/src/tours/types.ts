export type PublicItineraryEvent = {
  id?: string | number;
  startTime?: string;
  endTime?: string;
  activity?: string;
  /** The operator declared experience vibe for the event. */
  difficulty?: string;
};

export type PublicItineraryDay = {
  id?: string | number;
  day?: number;
  title?: string;
  description?: string;
  events?: PublicItineraryEvent[];
  /** Fallback timeline (string or array of entries) when events is empty. */
  timeline?: unknown;
};

export type PublicTourPackageItem = {
  id?: string | number;
  name?: string;
  title?: string;
  destination?: string;
  category?: string;
  pricePerPerson?: string | number;
  price?: string | number;
  currency?: string;
  status?: string;
  description?: string;
  notes?: string;
  difficulty?: string;
  duration?: string | number;
  mode?: string;
  minPax?: string | number;
  maxPax?: string | number;
  accommodation?: string;
  mealPlan?: string;
  meetingPoint?: string;
  included?: string[];
  excluded?: string[];
  itinerary?: PublicItineraryDay[];
};

export type PublicTourOperatorProfile = {
  companyName?: string;
  description?: string;
  physicalLocation?: string;
  businessAddress?: string;
  operatingRegions?: string[];
  contactPhone?: string;
  contactEmail?: string;
  companyLogoUrl?: string;
  gallery?: string[];
  classifiedPhotos?: Record<string, string[]>;
  services?: string[];
  addOns?: string[];
  tourismTypes?: string[];
  specializations?: string[];
  toolsAndAssets?: string[];
  registeredParks?: string[];
  packageItems?: PublicTourPackageItem[];
  vehicles?: unknown[];
  tools?: unknown[];
  yearsInOperation?: number;
  teamSize?: number;
  languages?: string;
  commissionPercent?: string | number;
  tripConfidence?: {
    score?: number;
    averageRating?: number;
    totalRatings?: number;
    completedTimelines?: number;
    completedTravellers?: number;
    topFeeling?: string | null;
  };
};

export type PublicTourAgent = {
  id?: number;
  level?: string;
  totalCompletedTrips?: number;
  profile?: PublicTourOperatorProfile | null;
};

export type PublicTourAgentsResponse = {
  items?: PublicTourAgent[];
};

export type FeaturedTourPackage = {
  key: string;
  packageId?: string | number;
  agentId: number;
  title: string;
  operatorName: string;
  destination: string;
  category: string;
  currency: string;
  pricePerPerson: number | null;
  image: string | null;
  location: string;
  confidenceScore: number | null;
  averageRating: number | null;
  totalRatings: number;
  topFeeling: string | null;
  services: string[];
  packageCount: number;
};

export type TourismSite = {
  id?: number | string;
  name: string;
  country?: string;
};

/** One timetable entry within a day: a time window, the event, and its experience vibe. */
export type DiscoveryEvent = { start: string; end: string; activity: string; vibe: string };
export type DiscoveryItineraryDay = { day: number; title: string; description: string; events: DiscoveryEvent[] };

/** One approved package, enriched for the discovery and detail screens. */
export type DiscoveryPackage = {
  id: string | number | null;
  title: string;
  destination: string;
  category: string;
  currency: string;
  /** Gross price per person, commission already applied. Null when not priced. */
  pricePerPerson: number | null;
  image: string | null;
  description: string | null;
  notes: string | null;
  difficulty: string | null;
  duration: string | null;
  mode: string | null;
  groupSize: string | null;
  minPax: number | null;
  maxPax: number | null;
  accommodation: string | null;
  mealPlan: string | null;
  meetingPoint: string | null;
  included: string[];
  excluded: string[];
  itinerary: DiscoveryItineraryDay[];
};

/** One operator with its approved packages, ready for filtering, search, and sort. */
export type DiscoveryOperator = {
  agentId: number;
  operatorName: string;
  description: string | null;
  location: string;
  image: string | null;
  images: string[];
  logoUrl: string | null;
  services: string[];
  tourismTypes: string[];
  confidenceScore: number | null;
  averageRating: number | null;
  totalRatings: number;
  topFeeling: string | null;
  completedTrips: number;
  currency: string;
  lowestPricePerPerson: number | null;
  packageCount: number;
  packages: DiscoveryPackage[];
  contactPhone: string | null;
  contactEmail: string | null;
  operatingRegions: string[];
  registeredParks: string[];
  vehiclePhotos: string[];
  fleet: DiscoveryVehicle[];
  tools: string[];
  specializations: string[];
  yearsInOperation: number | null;
  teamSize: number | null;
  languages: string | null;
  vehicleCount: number;
  toolCount: number;
  /** Lowercased haystack for substring search, mirrors the web search bag. */
  searchBag: string;
};

export type DiscoveryVehicle = {
  type: string;
  ownership: string | null;
  count: number | null;
  capacity: number | null;
  condition: string | null;
  serviceMode: string | null;
};

export type FeaturedTourOperator = {
  key: string;
  agentId: number;
  operatorName: string;
  location: string;
  currency: string;
  lowestPricePerPerson: number | null;
  image: string | null;
  images: string[];
  services: string[];
  confidenceScore: number | null;
  averageRating: number | null;
  totalRatings: number;
  topFeeling: string | null;
  packageCount: number;
  packageTitles: string[];
  completedTrips: number;
  /** Lowercased haystack for substring search, mirrors the web search bag. */
  searchBag: string;
};

export type TourDashboardBucket = "DRAFT" | "PAID_PACKAGES" | "ACTIVE_TIMELINE" | "COMPLETED" | string;

export type CustomerTourBookingSummary = {
  id: number;
  bookingCode?: string | null;
  bookingCodeSuffix?: string | null;
  title?: string | null;
  destination?: string | null;
  category?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelerCount?: number | null;
  status?: string | null;
  paymentStatus?: string | null;
  payoutStatus?: string | null;
  timelineStatus?: string | null;
  timelineCompletionStatus?: string | null;
  dashboardBucket?: TourDashboardBucket;
  hasTimeline?: boolean;
  currency?: string | null;
  grossAmount?: number | null;
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  paidAt?: string | null;
  confirmedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  draftExpiresAt?: string | null;
  draftExpiryStatus?: string | null;
  operatorSnapshot?: Record<string, unknown> | null;
  packageSnapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  pickupValidation?: Record<string, unknown> | null;
  pickupCheckIn?: Record<string, unknown> | null;
  pickupTimeline?: Record<string, unknown> | null;
  timelineCompletion?: {
    totalEvents?: number;
    ratedEvents?: number;
    isComplete?: boolean;
    status?: string;
  } | null;
  timelineRatingSummary?: {
    totalRatings?: number;
    averageRating?: number;
  } | null;
};

export type CustomerTourBookingDetail = CustomerTourBookingSummary & {
  packageId?: string | number | null;
  operatorAgentId?: number | null;
  unitPrice?: number | null;
  commissionPercent?: number | null;
  commissionAmount?: number | null;
  operatorPayoutAmount?: number | null;
  nationality?: string | null;
  notes?: string | null;
  paymentProvider?: string | null;
  paymentRef?: string | null;
  payerPhone?: string | null;
  paymentResume?: {
    paymentUrl?: string | null;
    paymentAccessToken?: string | null;
    paymentAccessTokenExpiresAt?: string | null;
    paymentAccessTokenStatus?: string | null;
  } | null;
  timelineTeam?: {
    joinedTotal?: number;
    totalTravellers?: number;
    remainingTravellers?: number;
    invitedCapacity?: number;
  } | null;
  timelineShare?: {
    hasInvite?: boolean;
    invitePath?: string | null;
    inviteUrl?: string | null;
    expiresAt?: string | null;
  } | null;
  clientTimelineEvents?: unknown[];
};

export type CustomerTourBookingsResponse = {
  items?: CustomerTourBookingSummary[];
  total?: number;
  page?: number;
  pageSize?: number;
};

export type TourVoucherPayload = {
  bookingId: number;
  bookingCode?: string | null;
  voucherIdentity?: {
    voucherNumber?: string | null;
    securityMark?: string | null;
    machineLine?: string | null;
    issuedAt?: string | null;
  } | null;
  title?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelerCount?: number | null;
  guestName?: string | null;
  guestPhone?: string | null;
  operatorSnapshot?: Record<string, unknown> | null;
  itinerary?: unknown[];
  meetingPoints?: string[];
  inclusions?: string[];
};

export type TourGroupMemberDocumentType = "PASSPORT" | "NATIONAL_ID" | "BIRTH_CERTIFICATE" | "OTHER";
export type TourGroupMemberRelation = "SPOUSE" | "CHILD" | "PARENT" | "SIBLING" | "RELATIVE" | "FRIEND" | "COLLEAGUE" | "OTHER";

export type TourGroupMember = {
  id: string;
  fullName: string;
  documentType?: TourGroupMemberDocumentType | null;
  documentNumber?: string | null;
  nationality?: string | null;
  phone?: string | null;
  relation?: TourGroupMemberRelation | string | null;
  notes?: string | null;
  photoUrl?: string | null;
  documentUrl?: string | null;
  documentFileName?: string | null;
  addedByUserId?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type TourGroupMembersResponse = {
  ok?: boolean;
  bookingId?: number;
  title?: string | null;
  bookingCode?: string | null;
  travelerCount?: number | null;
  members?: TourGroupMember[];
};

export type TourReceiptPayload = {
  bookingId: number;
  bookingCode?: string | null;
  title?: string | null;
  currency?: string | null;
  amount?: number | null;
  paymentStatus?: string | null;
  paymentProvider?: string | null;
  paymentRef?: string | null;
  paidAt?: string | null;
  travelerCount?: number | null;
  guestName?: string | null;
};
