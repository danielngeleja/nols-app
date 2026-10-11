import AsyncStorage from "@react-native-async-storage/async-storage";

import { webOrigin } from "../lib/webOrigin";

/** One policy as served by the website's /policies.json (apps/web/lib/policyMeta.ts on staging). */
export type PolicySummary = {
  key: string;
  title: string;
  /** Public page on the website. */
  path: string;
  /** As printed on the page, e.g. "10 October 2026". Empty when not loaded yet. */
  lastUpdated: string;
  /** YYYY-MM-DD, for "updated recently". */
  lastUpdatedIso: string;
  summary: string;
  keyPoints: string[];
  latestChanges: string[];
};

export type PolicyFeed = { policies: PolicySummary[]; source: "live" | "saved" | "basic" };

const CACHE_KEY = "nolsaf:policies:v1";
/** How long an update counts as recent enough to flag. */
const RECENT_DAYS = 45;

/**
 * Shown only before the first successful load: titles and pages, no dates or
 * rules, so the app never presents an out-of-date summary as current.
 */
const BASIC: PolicySummary[] = [
  ["privacy", "Privacy policy", "/privacy", "What personal data NoLSAF collects, why, and your rights over it."],
  ["terms", "Terms of service", "/terms", "The agreement for bookings, payments and using NoLSAF."],
  ["cancellation", "Cancellation policy", "/cancellation-policy", "When you can cancel a stay or tour, and how refunds work."],
  ["verification", "Verification policy", "/verification-policy", "How properties, operators and accounts are verified."],
  ["cookies", "Cookies policy", "/cookies-policy", "How the NoLSAF website uses cookies."],
  ["disbursement", "Disbursement policy", "/disbursement-policy", "How payments are released to service partners."]
].map(([key, title, path, summary]) => ({ key, title, path, summary, lastUpdated: "", lastUpdatedIso: "", keyPoints: [], latestChanges: [] }));

function isPolicyList(value: unknown): value is PolicySummary[] {
  return Array.isArray(value) && value.every((p) => p && typeof p.key === "string" && typeof p.title === "string" && typeof p.path === "string");
}

export async function loadSavedPolicies(): Promise<PolicyFeed> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (isPolicyList(parsed)) return { policies: parsed, source: "saved" };
  } catch {
    // Fall through to the basic list.
  }
  return { policies: BASIC, source: "basic" };
}

/** The live list from the website; saved on the device for next time and offline use. */
export async function fetchPolicies(): Promise<PolicyFeed> {
  const response = await fetch(`${webOrigin()}/policies.json`, { headers: { Accept: "application/json" }, credentials: "omit" });
  if (!response.ok) throw new Error(`Policies request failed with status ${response.status}`);
  const body = (await response.json()) as { policies?: unknown };
  if (!isPolicyList(body.policies)) throw new Error("Unexpected policies response");
  const policies = body.policies.map((p) => ({
    ...p,
    keyPoints: Array.isArray(p.keyPoints) ? p.keyPoints : [],
    latestChanges: Array.isArray(p.latestChanges) ? p.latestChanges : []
  }));
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(policies)).catch(() => undefined);
  return { policies, source: "live" };
}

/** True when the policy changed within the last few weeks and the change is worth pointing out. */
export function isRecentlyUpdated(policy: PolicySummary, now = Date.now()) {
  if (!policy.lastUpdatedIso || !policy.latestChanges.length) return false;
  const at = Date.parse(`${policy.lastUpdatedIso}T00:00:00Z`);
  return Number.isFinite(at) && now - at <= RECENT_DAYS * 86_400_000;
}

/** "10 October 2026" reads as "10 Oct 2026" in tight rows. */
export function shortPolicyDate(policy: PolicySummary) {
  if (!policy.lastUpdatedIso) return "";
  const d = new Date(`${policy.lastUpdatedIso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? policy.lastUpdated : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
