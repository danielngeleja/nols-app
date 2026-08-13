export type TourismType =
  | "Wildlife Safari"
  | "Beach & Marine"
  | "Mountain & Hiking"
  | "Cultural & Heritage"
  | "City & Day Tours"
  | "Adventure & Sports"
  | "Luxury & VIP"
  | "Family & Educational"
  | "Corporate & MICE";

export const TOURISM_TYPES: TourismType[] = [
  "Wildlife Safari",
  "Beach & Marine",
  "Mountain & Hiking",
  "Cultural & Heritage",
  "City & Day Tours",
  "Adventure & Sports",
  "Luxury & VIP",
  "Family & Educational",
  "Corporate & MICE",
];

export const COMMON_SERVICES: string[] = [
  "Airport Pickup & Drop-off",
  "Hotel & Lodge Transfers",
  "Inter-city Road Transfers",
  "Cross-border Transfers",
  "Accommodation Coordination",
  "Lodge & Camp Booking",
  "24/7 Emergency Support",
  "Meet & Greet Services",
  "Travel Insurance Assistance",
  "Visa & Documentation Assistance",
];

export const TOURISM_TYPE_SERVICES: Record<TourismType, string[]> = {
  "Wildlife Safari": [
    "Game Drive (Private)",
    "Game Drive (Shared / Group)",
    "Walking Safari",
    "Night Game Drive",
    "Migration Safari",
    "Bird Watching Tours",
    "Photography & Film Safari Support",
  ],
  "Beach & Marine": [
    "Zanzibar Beach Packages",
    "Snorkeling & Diving",
    "Boat & Dhow Cruises",
    "Deep Sea Fishing",
    "Island Hopping (Zanzibar / Mafia / Pemba)",
  ],
  "Mountain & Hiking": [
    "Kilimanjaro Trekking",
    "Mount Meru Trekking",
    "Day Hikes & Nature Walks",
    "Bush Camping",
  ],
  "Cultural & Heritage": [
    "Cultural Village Visits",
    "Maasai / Local Community Tours",
    "Spice Farm Tours",
    "Historical & Heritage Site Tours",
    "Cooking Classes & Food Tours",
  ],
  "City & Day Tours": [
    "City Sightseeing Tours",
    "Market Tours",
    "Museum & Landmark Tours",
  ],
  "Adventure & Sports": [
    "Cycling Tours",
    "Kayaking & Canoeing",
    "Rock Climbing",
    "Hot Air Balloon Safari",
  ],
  "Luxury & VIP": [
    "Private Vehicle Charter",
    "Private Licensed Guide",
    "VIP Concierge",
    "Executive Transport",
  ],
  "Family & Educational": [
    "School & Educational Tours",
    "Family Holiday Packages",
    "Child-friendly Guided Activities",
  ],
  "Corporate & MICE": [
    "Corporate & MICE Tours",
    "Incentive Travel Programs",
    "Conference Logistics Support",
  ],
};

export const TOOLS_ASSETS_OPTIONS: string[] = [
  "Professional Guides",
  "Certified Drivers",
  "Radio Communications",
  "GPS Tracking",
  "First-aid Kit",
  "Emergency Evacuation Protocol",
  "Translation Support",
  "Binoculars",
  "Camping Equipment",
  "Child Safety Seats",
  "Wheelchair Accessibility Support",
  "Satellite Phone",
  "Portable WiFi",
  "Branded Uniforms",
  "Photography Equipment",
];

export const VEHICLE_SERVICE_MODES: string[] = [
  "Private",
  "Shared Group",
  "Scheduled",
  "On-demand",
  "Corporate Contract",
];

export type PartnershipVehicle = {
  type?: string | null;
  ownership?: string | null;
  count?: number | null;
  capacity?: number | null;
  condition?: string | null;
  registrationNumber?: string | null;
  serviceMode?: string | null;
};

export type NormalizedPartnershipProfile = {
  companyName: string | null;
  businessAddress: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  companyWebsite: string | null;
  businessRegistrationNumber: string | null;
  tinNumber: string | null;
  businessLicenseNumber: string | null;
  tourismPermitNumber: string | null;
  vehiclePermitNumber: string | null;
  yearsInOperation: number | null;
  teamSize: number | null;
  services: string[];
  serviceClassification: Record<string, string[]>;
  tourismTypes: string[];
  toolsAndAssets: string[];
  registeredParks: string[];
  hasVehicles: boolean;
  fleet: PartnershipVehicle[];
};

export function getServiceOptionsForTypes(selectedTypes: string[]): string[] {
  const unique = new Set<string>(COMMON_SERVICES);
  selectedTypes.forEach((type) => {
    const key = type as TourismType;
    if (TOURISM_TYPE_SERVICES[key]) {
      TOURISM_TYPE_SERVICES[key].forEach((svc) => unique.add(svc));
    }
  });
  return Array.from(unique);
}

export function normalizePartnershipProfile(source: any): NormalizedPartnershipProfile {
  const profile = source && typeof source === "object" ? source : {};
  const asList = (value: unknown): string[] =>
    Array.isArray(value) ? Array.from(new Set(value.map((v) => String(v).trim()).filter(Boolean))) : [];
  const asClassification = (value: unknown): Record<string, string[]> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, list]) => [String(key), asList(list)] as const)
      .filter(([, list]) => list.length > 0);
    return Object.fromEntries(entries);
  };

  const fleetRaw = Array.isArray(profile.fleet)
    ? profile.fleet
    : Array.isArray(profile.vehicles)
      ? profile.vehicles
      : [];

  return {
    companyName: profile.companyName ? String(profile.companyName) : null,
    businessAddress: profile.businessAddress ? String(profile.businessAddress) : null,
    companyEmail: profile.companyEmail ? String(profile.companyEmail) : null,
    companyPhone: profile.companyPhone ? String(profile.companyPhone) : null,
    companyWebsite: profile.companyWebsite ? String(profile.companyWebsite) : null,
    businessRegistrationNumber: profile.businessRegistrationNumber ? String(profile.businessRegistrationNumber) : null,
    tinNumber: profile.tinNumber ? String(profile.tinNumber) : null,
    businessLicenseNumber: profile.businessLicenseNumber ? String(profile.businessLicenseNumber) : null,
    tourismPermitNumber: profile.tourismPermitNumber
      ? String(profile.tourismPermitNumber)
      : (profile.tourismLicenseNumber ? String(profile.tourismLicenseNumber) : null),
    vehiclePermitNumber: profile.vehiclePermitNumber ? String(profile.vehiclePermitNumber) : null,
    yearsInOperation: Number.isFinite(Number(profile.yearsInOperation)) ? Number(profile.yearsInOperation) : null,
    teamSize: Number.isFinite(Number(profile.teamSize)) ? Number(profile.teamSize) : null,
    services: asList(profile.services),
    serviceClassification: asClassification(profile.serviceClassification),
    tourismTypes: asList(profile.tourismTypes),
    toolsAndAssets: asList(profile.toolsAndAssets ?? profile.tools),
    registeredParks: asList(profile.registeredParks),
    hasVehicles: typeof profile.hasVehicles === "boolean" ? profile.hasVehicles : fleetRaw.length > 0,
    fleet: fleetRaw
      .map((v: any) => ({
        type: v?.type ? String(v.type) : null,
        ownership: v?.ownership ? String(v.ownership) : null,
        count: Number.isFinite(Number(v?.count)) ? Number(v.count) : null,
        capacity: Number.isFinite(Number(v?.capacity)) ? Number(v.capacity) : null,
        condition: v?.condition ? String(v.condition) : null,
        registrationNumber: v?.registrationNumber ? String(v.registrationNumber) : null,
        serviceMode: v?.serviceMode ? String(v.serviceMode) : null,
      }))
      .filter((v: PartnershipVehicle) => Boolean(v.type)),
  };
}
