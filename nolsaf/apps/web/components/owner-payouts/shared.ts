"use client";

import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";

/**
 * Shared vocabulary and data for the owner Payouts workspace
 * (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md). Every screen uses STAGES for its
 * wording, so one state is never described two ways. The stage itself is
 * computed by the API (ownerPayoutStage in services/payouts/release.ts).
 */

export type PayoutStage =
  | "UNLOCKING"
  | "WAITING"
  | "ON_HOLD"
  | "READY"
  | "SENDING"
  | "UNDER_REVIEW"
  | "PAID"
  | "SETTLED"
  | "CANCELLED";

export type OwnerPayout = {
  bookingReference: string;
  invoiceReference: string;
  propertyTitle: string | null;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
  amount: number | string | null;
  recoveryDeducted: number;
  currency: string;
  stage: PayoutStage;
  rule: "CHECKIN_CONFIRMED" | "CHECKIN_24H" | "CARD_CHECKOUT_24H" | string;
  releaseAt: string;
  availableAt: string | null;
  reason: string | null;
  releasedAt: string | null;
  paidAt: string | null;
};

export const STAGES: Record<PayoutStage, { label: string; chip: string; dot: string; active: boolean }> = {
  UNLOCKING: { label: "Unlocking", chip: "bg-slate-100 text-slate-700", dot: "bg-slate-400", active: true },
  WAITING: { label: "Waiting", chip: "bg-slate-100 text-slate-700", dot: "bg-slate-400", active: true },
  ON_HOLD: { label: "On hold", chip: "bg-amber-50 text-amber-800", dot: "bg-amber-500", active: true },
  READY: { label: "Ready", chip: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500", active: true },
  SENDING: { label: "Sending", chip: "bg-sky-50 text-sky-800", dot: "bg-sky-500", active: true },
  UNDER_REVIEW: { label: "Under review", chip: "bg-sky-50 text-sky-800", dot: "bg-sky-500", active: true },
  PAID: { label: "Paid", chip: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-600", active: false },
  SETTLED: { label: "Settled against a refund", chip: "bg-slate-100 text-slate-700", dot: "bg-slate-500", active: false },
  CANCELLED: { label: "Cancelled", chip: "bg-rose-50 text-rose-700", dot: "bg-rose-500", active: false },
};

export function formatTzs(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return `TZS ${Math.round(Number.isFinite(n) ? n : 0).toLocaleString("en-US")}`;
}

export function formatEat(iso: string | Date | null | undefined, withTime = true): string {
  if (!iso) return "";
  try {
    const text = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Dar_es_Salaam",
      day: "2-digit",
      month: "short",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : { year: "numeric" }),
    }).format(new Date(iso));
    return withTime ? `${text} EAT` : text;
  } catch {
    return String(iso);
  }
}

export function stayDates(checkIn: string, checkOut: string): string {
  const fmt = (d: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short" }).format(new Date(d));
  return `${fmt(checkIn)} to ${fmt(checkOut)}`;
}

export function timeLeft(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "any moment";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 48) return `in ${Math.floor(hours / 24)} days`;
  if (hours >= 1) return `in ${hours}h ${minutes}m`;
  return `in ${Math.max(1, minutes)}m`;
}

export function ruleLabel(rule: string): string {
  if (rule === "CHECKIN_CONFIRMED") return "After validated check-in and payout checks";
  if (rule === "CARD_CHECKOUT_24H") return "24h after checkout, because the guest paid by card";
  return "24h after check-in";
}

export function sum(payouts: OwnerPayout[], stages: PayoutStage[]): number {
  return payouts.filter((p) => stages.includes(p.stage)).reduce((total, p) => total + (Number(p.amount) || 0), 0);
}

/** Loads the owner's payouts. `enabled` is false until the new flow is switched on. */
export function useOwnerPayouts() {
  const [payouts, setPayouts] = useState<OwnerPayout[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [recoveryDue, setRecoveryDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiClient.get<{ enabled: boolean; releases: OwnerPayout[]; recoveryDue?: number }>("/api/owner/payouts/releases");
      setEnabled(Boolean(res.data?.enabled));
      setPayouts(res.data?.enabled ? res.data.releases ?? [] : []);
      setRecoveryDue(res.data?.enabled ? Number(res.data.recoveryDue ?? 0) : 0);
      setError(null);
    } catch {
      setError("Your payouts could not be loaded. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { payouts, enabled, recoveryDue, loading, error, reload };
}

/** Re-renders every minute so countdowns stay current. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
