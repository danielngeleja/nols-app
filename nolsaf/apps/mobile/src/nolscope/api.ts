import { apiRequest } from "../lib/apiClient";

export type NolScopeDestination = {
  code: string;
  name: string;
  country: string;
  destinationType: string;
  description?: string | null;
  popularity: number;
  avgStayDays?: number | null;
};

export type NolScopeActivity = {
  code: string;
  name: string;
  category: string;
  basePrice: number;
  description?: string | null;
  destinationCode?: string;
  destinationCodes?: string[];
};

export type NolScopeDestinationInput = {
  code: string;
  days: number;
};

export type NolScopeEstimateInput = {
  nationality: string;
  destinations: NolScopeDestinationInput[];
  startDate: string;
  travelers: { adults: number; children: number };
  transportPreference: string;
  activities: string[];
  tier: "budget" | "standard" | "luxury";
};

export type NolScopeBreakdownItem = {
  total: number;
  range?: { min: number; max: number };
  note?: string;
};

export type NolScopeEstimateResult = {
  estimateId: number | null;
  currency: string;
  travelers: { adults: number; children: number; total: number };
  totalDays: number;
  destinations: string[];
  season: string;
  tier: string;
  transportPreference?: string;
  breakdown: {
    visa: NolScopeBreakdownItem & { perAdult?: number; entries?: string; processingTime?: string };
    parkFees: NolScopeBreakdownItem;
    transport: NolScopeBreakdownItem;
    activities: NolScopeBreakdownItem;
    accommodation: NolScopeBreakdownItem;
    tips: NolScopeBreakdownItem;
    travelInsurance: NolScopeBreakdownItem;
    serviceCharge: NolScopeBreakdownItem & { percent?: number };
  };
  totalMin: number;
  totalAvg: number;
  totalMax: number;
  perAdultAvg: number;
  confidence: number;
  appliedRules?: Array<{ ruleName: string; seasonName: string; multiplier: number; description?: string }>;
  dataFreshness?: {
    lastUpdatedAt: string | null;
    updatedBy: string;
    categories: Record<string, string | null>;
  };
};

type DestinationsResponse = {
  destinations?: DestinationRow[];
};

type ActivitiesResponse = {
  activities?: ActivityRow[];
};

type DestinationRow = {
  destinationCode?: string;
  code?: string;
  displayName?: string;
  destinationName?: string;
  name?: string;
  region?: string;
  country?: string;
  destinationType?: string;
  description?: string | null;
  popularity?: number;
  avgStayDays?: number | null;
};

type ActivityRow = {
  activityCode?: string;
  code?: string;
  activityName?: string;
  name?: string;
  category?: string;
  averageCost?: number;
  basePrice?: number;
  minCost?: number;
  description?: string | null;
};

export async function fetchNolScopeDestinations() {
  const data = await apiRequest<DestinationsResponse>("/api/public/nolscope/destinations");
  return (data.destinations ?? [])
    .map((row: DestinationRow): NolScopeDestination => ({
      code: String(row.destinationCode ?? row.code ?? "").toUpperCase(),
      name: String(row.displayName ?? row.destinationName ?? row.name ?? row.destinationCode ?? ""),
      country: String(row.region ?? row.country ?? ""),
      destinationType: String(row.destinationType ?? ""),
      description: row.description ?? null,
      popularity: Number(row.popularity ?? 0),
      avgStayDays: row.avgStayDays ?? null
    }))
    .filter((row: NolScopeDestination) => row.code && row.name);
}

export async function fetchNolScopeActivities(destinationCode: string) {
  const query = new URLSearchParams({ dest: destinationCode });
  const data = await apiRequest<ActivitiesResponse>(`/api/public/nolscope/activities?${query.toString()}`);
  return (data.activities ?? [])
    .map((row: ActivityRow): NolScopeActivity => ({
      code: String(row.activityCode ?? row.code ?? "").toUpperCase(),
      name: String(row.activityName ?? row.name ?? row.activityCode ?? ""),
      category: String(row.category ?? ""),
      basePrice: Number(row.averageCost ?? row.basePrice ?? row.minCost ?? 0),
      description: row.description ?? null,
      destinationCode,
      destinationCodes: [destinationCode]
    }))
    .filter((row: NolScopeActivity) => row.code && row.name);
}

export function createNolScopeEstimate(input: NolScopeEstimateInput) {
  return apiRequest<NolScopeEstimateResult>("/api/public/nolscope/estimate", {
    method: "POST",
    body: input
  });
}
