import { apiRequest } from "../lib/apiClient";
import type { AccountExport } from "./dataReport";

/** What the account holds, as counts and flags (GET /api/account/data-summary). No record contents. */
export type DataSummary = {
  memberSince: string;
  profile: { hasName: boolean; hasEmail: boolean; hasPhone: boolean };
  counts: {
    stays: number;
    completedStays: number;
    upcomingStays: number;
    rides: number;
    welcomes: number;
    tours?: number;
    groupStays?: number;
    reviews?: number;
    saved?: number;
  };
  welcomePreferences: { saved: boolean; shareWithProperty: boolean; celebrateOptIn: boolean; drinkLikes: string[]; dietaryTags: string[] };
  lastExportAt: string | null;
  /** Three wrong codes lock data downloads until NoLSAF support unlocks them. */
  exportLocked?: boolean;
};

export type DataExportReason = "KNOW_WHAT_WE_HOLD" | "MOVE_TO_ANOTHER_SERVICE" | "CLOSING_ACCOUNT" | "SUPPORT_OR_DISPUTE" | "LEGAL" | "OTHER";

export const DATA_EXPORT_REASONS: [DataExportReason, string][] = [
  ["KNOW_WHAT_WE_HOLD", "I want to know what NoLSAF holds about me"],
  ["MOVE_TO_ANOTHER_SERVICE", "I want to move my data to another service"],
  ["CLOSING_ACCOUNT", "I plan to close my account soon"],
  ["SUPPORT_OR_DISPUTE", "I need it for a support or dispute matter"],
  ["LEGAL", "I need it for legal reasons"],
  ["OTHER", "Other"]
];

export const DATA_EXPORT_COUNTRIES = [
  "Tanzania", "Kenya", "Uganda", "Rwanda", "Burundi", "Democratic Republic of the Congo", "Zambia", "Malawi",
  "Mozambique", "South Africa", "United Kingdom", "United States", "Germany", "Other country"
];

type Wrapped<T> = T | { data?: T };
const unwrap = <T,>(payload: Wrapped<T>): T => ((payload as { data?: T })?.data ?? payload) as T;

export async function fetchDataSummary(token: string) {
  return unwrap(await apiRequest<Wrapped<DataSummary>>("/api/account/data-summary", { token }));
}

/** Step 1: where the person lives and why (optional). A code goes to a contact already verified on the account. */
export async function requestDataExport(
  token: string,
  input: { country: string; reason: DataExportReason | null; otherReason: string | null; format: "pdf" | "json" }
) {
  return unwrap(
    await apiRequest<Wrapped<{ sentVia: "email" | "phone"; sentTo: string; expiresInMinutes?: number }>>("/api/account/export/request", {
      token,
      method: "POST",
      body: input
    })
  );
}

/** Step 2: the 6-digit code. A right code returns a 10-minute download grant. */
export async function verifyDataExport(token: string, code: string) {
  return unwrap(await apiRequest<Wrapped<{ grant: string; expiresInMinutes?: number }>>("/api/account/export/verify", {
    token,
    method: "POST",
    body: { code }
  }));
}

/** Step 3: the copy itself, released only with the grant. */
export async function downloadDataExport(token: string, grant: string) {
  return apiRequest<AccountExport>("/api/account/export", { token, headers: { "X-Data-Export-Grant": grant } });
}
