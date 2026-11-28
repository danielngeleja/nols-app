"use client";

/**
 * Shared data and vocabulary for the admin Event hire workspace.
 * One fetch of the operating pulse (summary, venue counts, date requests)
 * lives in the shell and is read by every page through context, so the
 * sidebar badges, the command centre and the queues always agree.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import type { EventTerms } from "../eventHireTypes";

export type Summary = {
  enabled: boolean;
  paymentsEnabled: boolean;
  statuses: Record<string, number>;
  pendingRequests: number;
  collected: number;
  depositHeld: number;
  settlementPending: number;
  settled: number;
};

export type RequestRow = {
  reference: string;
  version: number;
  status: string;
  propertyTitle?: string;
  startsAt: string;
  endsAt: string;
  people: number;
  eventType: string;
  seating?: string;
  package?: string;
  assisted: boolean;
  partnerAssigned: boolean;
  partnerApprovedAt?: string | null;
  assignedPartnerId?: number | null;
  confirmationVia?: string | null;
  ownerConfirmedAt?: string | null;
  expiresAt?: string;
  holdExpiresAt?: string | null;
  needsAssistance: boolean;
  terms?: EventTerms;
  quote: { total: number; deposit: number; cleaningFee: number; clientFee: number; ownerReceives: number };
};

export type Pulse = {
  summary: Summary | null;
  venueCounts: Record<string, number> | null;
  requests: RequestRow[] | null;
  /** Date requests are switched off (the API answers 404 until EVENT_HIRE_REQUESTS_ENABLED). */
  requestsOff: boolean;
  loading: boolean;
  error: string;
  reload: () => void;
};

export const ACTIVE_REQUEST = ["WAITING_OWNER", "OWNER_CONFIRMED", "READY_TO_PAY", "PAYMENT_PENDING", "PAYMENT_REVIEW"];

/** What a date request needs from NoLSAF right now, most urgent first. */
export function requestNeeds(r: RequestRow): Array<"callback" | "partner" | "escalated"> {
  const out: Array<"callback" | "partner" | "escalated"> = [];
  if (r.status === "OWNER_CONFIRMED" && r.confirmationVia === "PARTNER_CALL") out.push("callback");
  if (r.assisted && !r.partnerAssigned && !r.partnerApprovedAt && ACTIVE_REQUEST.includes(r.status) && r.status !== "PAYMENT_PENDING") out.push("partner");
  if (r.needsAssistance) out.push("escalated");
  return out;
}

export const REQUEST_LABEL: Record<string, string> = {
  WAITING_OWNER: "Waiting for owner",
  OWNER_CONFIRMED: "Owner confirmed",
  READY_TO_PAY: "Ready for checkout",
  PAYMENT_PENDING: "Payment pending",
  PAYMENT_REVIEW: "Payment under review",
  BOOKED: "Booked",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export const NEED_LABEL = {
  callback: "Verify owner callback",
  partner: "Assign a sales partner",
  escalated: "Owner has not answered",
} as const;

const LABELS: Record<string, string> = {
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  PAYMENT_PENDING: "Payment pending",
  PAYMENT_REVIEW: "Payment review",
  EXPIRED: "Expired",
  HELD: "Held by NoLSAF",
  UNPAID: "Not collected",
  REVIEW: "Awaiting approval",
  APPROVED: "Approved",
  PAID: "Paid",
  DISPUTED: "Disputed",
  SETTLED: "Settled",
  REFUND_REVIEW: "Refund review",
  ON_HOLD: "On hold",
  NONE: "No deposit",
  OWNER_PAYOUT: "Owner earnings",
  DAMAGE_AWARD: "Damage award",
  DEPOSIT_REFUND: "Deposit refund",
  CANCELLATION_REFUND: "Cancellation refund",
  STATUS_UNKNOWN: "Provider status unknown",
  PROCESSING: "Provider processing",
  SUCCEEDED: "Payment verified",
  FAILED: "Payment declined",
  INITIATING: "Starting checkout",
  CREATED: "Awaiting checkout",
  AWAITING_CLIENT: "Awaiting client",
  RESOLVED: "Resolved",
  EXTERNAL_BOOKING: "Booked elsewhere",
  MAINTENANCE: "Maintenance",
  UNAVAILABLE: "Unavailable",
};
export const label = (v: string | null | undefined) => {
  if (!v) return "-";
  if (v.startsWith("EXTRA_REFUND_")) return "Additional payment refund";
  return LABELS[v] || REQUEST_LABEL[v] || v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
};

/** Status tone for pills: one small, consistent palette. */
export function tone(v: string): "green" | "amber" | "red" | "slate" | "teal" {
  if (["CONFIRMED", "APPROVED", "READY_TO_PAY", "SUCCEEDED", "OWNER_CONFIRMED", "BOOKED"].includes(v)) return "teal";
  if (["COMPLETED", "PAID", "SETTLED", "RESOLVED"].includes(v)) return "green";
  if (["PAYMENT_REVIEW", "PAYMENT_PENDING", "REVIEW", "WAITING_OWNER", "HELD", "AWAITING_CLIENT", "REFUND_REVIEW", "ON_HOLD", "PROCESSING", "STATUS_UNKNOWN", "PENDING", "AWAITING_OWNER"].includes(v)) return "amber";
  if (["CANCELLED", "DECLINED", "FAILED", "DISPUTED", "RETURNED", "PAUSED"].includes(v)) return "red";
  return "slate";
}

const TZ = "Africa/Dar_es_Salaam";
export const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
export const day = (v: string) => new Date(v).toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit" });
export const month = (v: string) => new Date(v).toLocaleDateString("en-GB", { timeZone: TZ, month: "short" });
export const weekday = (v: string) => new Date(v).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short" });
export const clock = (v: string) => new Date(v).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** A time range that does not repeat the date when it is the same day. */
export function span(start: string, end: string) {
  const sameDay = new Date(start).toLocaleDateString("en-GB", { timeZone: TZ }) === new Date(end).toLocaleDateString("en-GB", { timeZone: TZ });
  return sameDay ? `${when(start)} to ${clock(end)}` : `${when(start)} to ${when(end)}`;
}

/** "in 3 days", "tomorrow", "2 hours ago": how far the moment is from now. */
export function relative(v: string, now = Date.now()) {
  const diff = new Date(v).getTime() - now;
  const abs = Math.abs(diff);
  const h = Math.round(abs / 3600000), d = Math.round(abs / 86400000);
  const text = abs < 3600000 ? "within the hour" : h < 24 ? `${h} hour${h === 1 ? "" : "s"}` : d === 1 ? "1 day" : `${d} days`;
  if (abs < 3600000) return text;
  return diff > 0 ? (d === 1 && h >= 24 ? "tomorrow" : `in ${text}`) : `${text} ago`;
}

export const errorText = (e: any, fallback = "Could not complete that action. Refresh and try again.") => e?.response?.data?.error || fallback;
export const needsFinanceGrant = (e: any) => Boolean(e?.response?.data?.require2fa);
export const askFinanceGrant = () => window.dispatchEvent(new CustomEvent("finance-grant-required"));
export const refreshEventHire = () => window.dispatchEvent(new Event("event-hire-refresh"));

/** Re-run a loader when anything in the workspace asks for a refresh or finance is unlocked. */
export function useWorkspaceRefresh(load: () => void, finance = false) {
  useEffect(() => {
    const run = () => load();
    window.addEventListener("event-hire-refresh", run);
    if (finance) window.addEventListener("finance-grant-granted", run);
    return () => {
      window.removeEventListener("event-hire-refresh", run);
      if (finance) window.removeEventListener("finance-grant-granted", run);
    };
  }, [load, finance]);
}

export function usePulseLoader(): Pulse {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [venueCounts, setVenueCounts] = useState<Record<string, number> | null>(null);
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [requestsOff, setRequestsOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    // Each figure fails on its own; one closed endpoint never blanks the workspace.
    const [a, b, c] = await Promise.allSettled([
      apiClient.get("/api/admin/event-hire/operations/workspace"),
      apiClient.get("/api/admin/event-hire", { params: { status: "PENDING" } }),
      apiClient.get("/api/admin/event-requests"),
    ]);
    setSummary(a.status === "fulfilled" ? a.value.data : null);
    setVenueCounts(b.status === "fulfilled" ? b.value.data?.counts ?? {} : null);
    if (c.status === "fulfilled") { setRequests(c.value.data?.requests ?? []); setRequestsOff(false); }
    else { setRequests(null); setRequestsOff((c.reason as any)?.response?.status === 404); }
    setError(a.status === "rejected" && b.status === "rejected" ? "Event hire figures are unavailable right now." : "");
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useWorkspaceRefresh(useCallback(() => { void load(); }, [load]));
  return { summary, venueCounts, requests, requestsOff, loading, error, reload: () => void load() };
}

export const PulseContext = createContext<Pulse | null>(null);
export function usePulse(): Pulse {
  const value = useContext(PulseContext);
  if (!value) throw new Error("usePulse must be used inside the Event hire workspace");
  return value;
}

/** Counts that drive the sidebar badges and the command centre queue. */
export function pulseCounts(p: Pulse) {
  const rows = p.requests ?? [];
  const active = rows.filter(r => ACTIVE_REQUEST.includes(r.status));
  return {
    // A status with no venues is simply absent from the counts: that is zero, not unknown.
    venuesToReview: p.venueCounts ? p.venueCounts.PENDING ?? 0 : null,
    venuesWithOwner: p.venueCounts ? p.venueCounts.AWAITING_OWNER ?? 0 : null,
    liveVenues: p.venueCounts ? p.venueCounts.APPROVED ?? 0 : null,
    openRequests: p.requests ? active.length : null,
    callbacks: p.requests ? rows.filter(r => requestNeeds(r).includes("callback")).length : null,
    needPartner: p.requests ? rows.filter(r => requestNeeds(r).includes("partner")).length : null,
    escalated: p.requests ? rows.filter(r => r.needsAssistance).length : null,
    requestActions: p.requests ? rows.filter(r => requestNeeds(r).length > 0).length : null,
    paymentReview: p.summary ? p.summary.statuses.PAYMENT_REVIEW || 0 : null,
  };
}
