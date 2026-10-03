"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, CheckCircle2, TrendingUp, DollarSign, CalendarDays, Clock, HandCoins, Info, Search, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import LogoSpinner from "@/components/LogoSpinner";
import TableScroller from "@/components/TableScroller";
import { publishRailCounts } from "@/lib/agentRailSignals";
import TableRow from "@/components/TableRow";
import OperatorPayoutDestination, { isPayoutDestinationComplete } from "@/components/agent/OperatorPayoutDestination";
import TourAdvanceClaims, { type AdvanceTrip } from "@/components/agent/TourAdvanceClaims";

const api = apiClient;

type RevenueItem = {
  source?: "TOUR_BOOKING";
  id: string | number;
  bookingCode?: string | null;
  paymentRef?: string | null;
  invoiceNumber?: string | null;
  invoiceStatus?: string | null;
  title: string;
  tripType: string;
  status: string;
  paymentStatus?: string | null;
  payoutStatus?: string | null;
  isCompleted: boolean;
  budget: number;
  commissionPercent: number;
  commissionAmount: number;
  agentEarning: number;
  currency: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  payoutRequestedAt?: string | null;
  payoutApprovedAt?: string | null;
  payoutPaidAt?: string | null;
  client: string;
  nationality?: string | null;
  /** Server-side result of the same gate the claim endpoint applies. */
  claimEligibility?: { ok: boolean; reason: string | null; availableAt: string | null } | null;
  openCaseCount?: number;
  /** Net share minus advances already paid: what the balance claim pays. */
  balanceAmount?: number;
  advance?: AdvanceTrip["advance"];
};

type RevenueSummary = {
  totalTrips: number;
  completedTrips: number;
  totalRevenue: number;
  pendingRevenue: number;
  totalCommissionPaid: number;
  commissionPercent: number;
  currency: string;
  lifetimeRevenue: number;
};

type SortField = "operation" | "stage" | "updatedAt";
type SortDirection = "asc" | "desc";
type TrackerFilter = "ALL" | "NEW" | "CLAIMED" | "VERIFIED" | "APPROVED" | "DISBURSED" | "REJECTED";

const TRACKER_FILTERS: TrackerFilter[] = ["ALL", "NEW", "CLAIMED", "VERIFIED", "APPROVED", "DISBURSED", "REJECTED"];

// The tracker stage lives in the URL so the sidebar can deep link into it and a
// shared link reopens the same one.
const TRACKER_PARAM = "track";

function parseTracker(value: string | null): TrackerFilter {
  const key = String(value || "").toUpperCase();
  return (TRACKER_FILTERS as string[]).includes(key) ? (key as TrackerFilter) : "ALL";
}
type TrendRange = "24H" | "7D" | "1M" | "3M";

type AgentPayoutProfile = {
  payoutPreferred?: string | null;
  bankAccountName?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankBranch?: string | null;
  mobileMoneyProvider?: string | null;
  mobileMoneyNumber?: string | null;
};

const STAT_TONES: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
};

function claimBlockedReason(item: RevenueItem): string {
  const e = item.claimEligibility;
  if (!e || e.ok) return "";
  switch (e.reason) {
    case "already_claimed":
      return "Already claimed. Follow it in the tracker below.";
    case "tour_not_completed":
      return "The trip is not completed yet. Claims open once it is completed.";
    case "open_case":
      return `Held while ${item.openCaseCount && item.openCaseCount > 1 ? `${item.openCaseCount} cases are` : "a case is"} open on this trip.`;
    case "payment_not_confirmed":
      return "The guest payment is not confirmed yet.";
    case "dispute_window_open":
      return e.availableAt
        ? `Claimable from ${new Date(e.availableAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}, after the guest dispute window, or sooner if the guest confirms completion.`
        : "Waiting for the guest to confirm completion.";
    default:
      return "This trip is not eligible for a payout claim.";
  }
}

function claimBlockedShort(item: RevenueItem): string {
  const e = item.claimEligibility;
  switch (e?.reason) {
    case "tour_not_completed":
      return "Trip not completed";
    case "open_case":
      return "Held by open case";
    case "payment_not_confirmed":
      return "Payment unconfirmed";
    case "advance_in_flight":
      return "Advance in progress";
    case "dispute_window_open":
      return e.availableAt
        ? `From ${new Date(e.availableAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
        : "Awaiting guest confirmation";
    default:
      return "Not claimable yet";
  }
}

function placeCodeFor(title: string): string {
  const [tour, destination] = String(title || "").split(" • ");
  return ((destination || tour || "").replace(/[^A-Za-z]/g, "").slice(0, 3) || "TRP").toUpperCase();
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "emerald",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: keyof typeof STAT_TONES;
}) {
  return (
    <article className="flex min-w-0 items-center gap-3 rounded-xl border border-solid border-neutral-200 bg-white p-3">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${STAT_TONES[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="m-0 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400" title={label}>
          {label}
        </p>
        <p className="m-0 mt-0.5 truncate text-lg font-bold leading-none tabular-nums text-neutral-900" title={value}>
          {value}
        </p>
        {sub ? <p className="m-0 mt-1 truncate text-[10px] text-neutral-400" title={sub}>{sub}</p> : null}
      </div>
    </article>
  );
}

export default function AgentRevenuesPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<RevenueItem[]>([]);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const [currentPage, setCurrentPage] = useState(1);
  const [payoutProfile, setPayoutProfile] = useState<AgentPayoutProfile | null>(null);
  const [claimLookupCode, setClaimLookupCode] = useState("");
  const [claimLookupError, setClaimLookupError] = useState<string | null>(null);
  const [claimLookupMatch, setClaimLookupMatch] = useState<RevenueItem | null>(null);
  const [claimConsent, setClaimConsent] = useState(false);
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimSubmitSuccessCard, setClaimSubmitSuccessCard] = useState<string | null>(null);
  const [showClaimConfirm, setShowClaimConfirm] = useState(false);
  const [showWaiting, setShowWaiting] = useState(false);
  const [trendRange, setTrendRange] = useState<TrendRange>("7D");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const trackerFilter = parseTracker(searchParams.get(TRACKER_PARAM));

  // Tracker chips and sidebar links both go through the URL, so there is a
  // single source of truth for which stage is being viewed.
  const setTrackerFilter = useCallback(
    (next: TrackerFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "ALL") params.delete(TRACKER_PARAM);
      else params.set(TRACKER_PARAM, next.toLowerCase());
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const pageSize = 10;

  useEffect(() => {
    (async () => {
      try {
        const [revenuesRes, meRes] = await Promise.all([
          api.get("/api/agent/revenues"),
          api.get("/api/account/me").catch(() => null),
        ]);

        const data = (revenuesRes as any)?.data;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setSummary(data?.summary ?? null);

        const mePayload = (meRes as any)?.data;
        const me = mePayload?.data ?? mePayload ?? null;
        if (me && typeof me === "object") {
          setPayoutProfile({
            payoutPreferred: me.payoutPreferred ?? null,
            bankAccountName: me.bankAccountName ?? null,
            bankName: me.bankName ?? null,
            bankAccountNumber: me.bankAccountNumber ?? null,
            bankBranch: me.bankBranch ?? null,
            mobileMoneyProvider: me.mobileMoneyProvider ?? null,
            mobileMoneyNumber: me.mobileMoneyNumber ?? null,
          });
        }
      } catch {
        setError("Could not load revenue data.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const lookupTourCode = useCallback((rawCode: string) => {
    const lookup = String(rawCode || "").trim().toUpperCase();
    if (!lookup) {
      setClaimLookupMatch(null);
      setClaimLookupError(null);
      return;
    }

    const match = items.find((item) => String(item.bookingCode || "").trim().toUpperCase() === lookup) || null;
    if (!match) {
      setClaimLookupMatch(null);
      setClaimLookupError("Tour code not found in your operations list.");
      return;
    }

    setClaimLookupError(null);
    setClaimLookupMatch(match);
  }, [items]);

  // Only a new code clears the success note. This effect also re-runs when
  // `items` changes, which happens the moment a claim succeeds.
  useEffect(() => {
    if (claimLookupCode) setClaimSubmitSuccessCard(null);
  }, [claimLookupCode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      lookupTourCode(claimLookupCode);
    }, 120);

    return () => clearTimeout(timer);
  }, [claimLookupCode, lookupTourCode]);

  const handleSubmitClaimInitiator = () => {
    if (!claimLookupMatch?.bookingCode) {
      setClaimLookupError("Please lookup and select a valid tour code first.");
      return;
    }
    if (claimLookupMatch.claimEligibility && !claimLookupMatch.claimEligibility.ok) {
      setClaimLookupError(claimBlockedReason(claimLookupMatch));
      return;
    }
    if (!isPayoutDestinationComplete(payoutProfile)) {
      setClaimLookupError("Add a verified payout destination first. Claims are paid to the destination on your account.");
      document.getElementById("operator-payout")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!claimConsent) {
      setClaimLookupError("Please agree to the disbursement policy before submitting.");
      return;
    }
    setClaimLookupError(null);
    setShowClaimConfirm(true);
  };

  const confirmClaimSubmit = async () => {
    setShowClaimConfirm(false);
    setClaimSubmitting(true);
    try {
      const res = await api.post("/api/agent/revenues/claim-by-tour-code", {
        tourCode: claimLookupMatch!.bookingCode,
      });
      const data = (res as any)?.data;
      if (data?.ok) {
        const claimedAt = data?.claimedAt || new Date().toISOString();
        const status = data?.payoutStatus || "REQUESTED";
        setItems((prev) =>
          prev.map((item) =>
            String(item.bookingCode || "").trim().toUpperCase() === String(claimLookupMatch!.bookingCode || "").trim().toUpperCase()
              ? {
                  ...item,
                  payoutRequestedAt: claimedAt,
                  payoutStatus: status,
                  invoiceStatus: item.invoiceStatus || status,
                  claimEligibility: { ok: false, reason: "already_claimed", availableAt: null },
                }
              : item
          )
        );
        setClaimSubmitSuccessCard("Thanks for submitting your claim. NoLSAF is processing it and you can track the status above.");
        setClaimConsent(false);
        setClaimLookupCode("");
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || "Failed to submit payout claim";
      setClaimLookupError(String(msg));
    } finally {
      setClaimSubmitting(false);
    }
  };

  const trend = useMemo(() => {
    const now = new Date();

    const config =
      trendRange === "24H"
        ? { count: 24, unit: "hour" as const }
        : trendRange === "7D"
          ? { count: 7, unit: "day" as const }
          : trendRange === "1M"
            ? { count: 30, unit: "day" as const }
            : { count: 12, unit: "week" as const }; // 3M

    const startAt = new Date(now);
    if (config.unit === "hour") {
      startAt.setMinutes(0, 0, 0);
      startAt.setHours(startAt.getHours() - (config.count - 1));
    } else if (config.unit === "day") {
      startAt.setHours(0, 0, 0, 0);
      startAt.setDate(startAt.getDate() - (config.count - 1));
    } else {
      startAt.setHours(0, 0, 0, 0);
      startAt.setDate(startAt.getDate() - ((config.count - 1) * 7));
    }

    const buckets = Array.from({ length: config.count }, (_, idx) => {
      const d = new Date(startAt);
      if (config.unit === "hour") d.setHours(d.getHours() + idx);
      else if (config.unit === "day") d.setDate(d.getDate() + idx);
      else d.setDate(d.getDate() + idx * 7);

      const key =
        config.unit === "hour"
          ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}`
          : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const label =
        config.unit === "hour"
          ? d.toLocaleString(undefined, { hour: "2-digit" })
          : config.unit === "day"
            ? d.toLocaleString(undefined, { month: "short", day: "numeric" })
            : d.toLocaleString(undefined, { month: "short", day: "numeric" });

      return { key, label, paid: 0, pending: 0, time: d.getTime() };
    });

    const byKey = new Map(buckets.map((b) => [b.key, b]));

    for (const item of items) {
      const raw = item.completedAt || item.createdAt || item.dateFrom || item.dateTo;
      if (!raw) continue;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime()) || d < startAt || d > now) continue;

      let key = "";
      if (config.unit === "hour") {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}`;
      } else if (config.unit === "day") {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      } else {
        const weekStart = new Date(d);
        weekStart.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((weekStart.getTime() - startAt.getTime()) / (24 * 60 * 60 * 1000));
        const bucketIndex = Math.min(config.count - 1, Math.max(0, Math.floor(diffDays / 7)));
        key = buckets[bucketIndex]?.key || "";
      }

      const bucket = byKey.get(key);
      if (!bucket) continue;
      if (item.isCompleted) bucket.paid += Number(item.agentEarning || 0);
      else bucket.pending += Number(item.agentEarning || 0);
    }

    const maxY = Math.max(1, ...buckets.map((b) => Math.max(b.paid, b.pending)));
    const pointsFor = (field: "paid" | "pending") =>
      buckets
        .map((b, i) => {
          const x = (i / Math.max(1, buckets.length - 1)) * 100;
          const y = 100 - (b[field] / maxY) * 100;
          return `${x},${Number.isFinite(y) ? y : 100}`;
        })
        .join(" ");

    return {
      buckets,
      maxY,
      paidPoints: pointsFor("paid"),
      pendingPoints: pointsFor("pending"),
    };
  }, [items, trendRange]);

  const normalizedStage = useCallback((item: RevenueItem): "NEW" | "VERIFIED" | "APPROVED" | "DISBURSED" | "REJECTED" => {
    const payment = String(item.paymentStatus || "").toUpperCase();
    const payout = String(item.payoutStatus || "").toUpperCase();
    const invoice = String(item.invoiceStatus || "").toUpperCase();

    if (payment === "REJECTED" || payout === "REJECTED" || invoice === "REJECTED") return "REJECTED";
    if (item.payoutPaidAt || payment === "DISBURSED" || payout === "DISBURSED" || payout === "PAID") return "DISBURSED";
    if (item.payoutApprovedAt || payment === "APPROVED" || payout === "APPROVED" || invoice === "APPROVED") return "APPROVED";
    // VERIFIED is an explicit admin action on a submitted claim. A customer
    // payment of PAID does NOT verify the payout — the record stays NEW until
    // the operator sends a claim, then CLAIMED until NoLSAF verifies it.
    if (payout === "VERIFIED" || invoice === "VERIFIED" || payment === "VERIFIED") return "VERIFIED";
    return "NEW";
  }, []);

  const hasClaimStarted = useCallback((item: RevenueItem) => {
    const payout = String(item.payoutStatus || "").toUpperCase();
    return Boolean(item.invoiceNumber || item.invoiceStatus || item.payoutRequestedAt || payout === "CLAIMED" || payout === "REQUESTED");
  }, []);

  const trackerStage = useCallback((item: RevenueItem): Exclude<TrackerFilter, "ALL"> => {
    const stage = normalizedStage(item);
    if (stage === "REJECTED") return "REJECTED";
    if (stage === "DISBURSED") return "DISBURSED";
    if (stage === "APPROVED") return "APPROVED";
    if (stage === "VERIFIED") return "VERIFIED";
    if (hasClaimStarted(item)) return "CLAIMED";
    return "NEW";
  }, [hasClaimStarted, normalizedStage]);

  const trackerCounts = useMemo(() => {
    const counts: Record<TrackerFilter, number> = {
      ALL: items.length,
      NEW: 0,
      CLAIMED: 0,
      VERIFIED: 0,
      APPROVED: 0,
      DISBURSED: 0,
      REJECTED: 0,
    };
    for (const item of items) {
      counts[trackerStage(item)] += 1;
    }
    return counts;
  }, [items, trackerStage]);

  // Claim candidates: what can be claimed now, and what will be claimable
  // later (with the reason), so nobody has to guess a tour code.
  const claimReady = useMemo(
    () => items.filter((item) => item.claimEligibility?.ok),
    [items]
  );
  const claimWaiting = useMemo(
    () =>
      items
        .filter((item) => !item.claimEligibility?.ok && trackerStage(item) === "NEW" && item.claimEligibility?.reason !== "already_claimed")
        .sort((a, b) => {
          const ta = a.claimEligibility?.availableAt ? new Date(a.claimEligibility.availableAt).getTime() : Number.MAX_SAFE_INTEGER;
          const tb = b.claimEligibility?.availableAt ? new Date(b.claimEligibility.availableAt).getTime() : Number.MAX_SAFE_INTEGER;
          return ta - tb;
        }),
    [items, trackerStage]
  );
  const claimReadyTotal = useMemo(() => claimReady.reduce((sum, item) => sum + Number(item.agentEarning || 0), 0), [claimReady]);

  // Where every operator dollar sits right now, left to right: claimable,
  // about to be claimable, with NoLSAF finance, and already paid out.
  const payoutPipeline = useMemo(() => {
    const sum = (rows: RevenueItem[]) => rows.reduce((total, item) => total + Number(item.balanceAmount ?? item.agentEarning ?? 0), 0);
    // Advances count too: available now, with finance, or already paid out.
    const advanceReady = items.filter((item) => item.advance?.offer?.ok && !item.advance?.inFlight);
    const advanceReadyTotal = advanceReady.reduce((total, item) => total + Math.floor(item.advance!.offer!.availableWithoutEvidence), 0);
    const advanceInFlight = items.reduce((total, item) => total + Number(item.advance?.inFlight || 0), 0);
    const advancePaid = items.reduce((total, item) => total + Number(item.advance?.paid || 0), 0);
    const withFinance = items.filter((item) => ["CLAIMED", "VERIFIED", "APPROVED"].includes(trackerStage(item)));
    const paidOut = items.filter((item) => trackerStage(item) === "DISBURSED");
    return [
      { key: "ready", label: "Ready to claim", amount: claimReadyTotal + advanceReadyTotal, count: claimReady.length + advanceReady.length, hint: "claim it below", tone: "brand" as const },
      { key: "soon", label: "Opening soon", amount: sum(claimWaiting), count: claimWaiting.length, hint: "not claimable yet", tone: "amber" as const },
      { key: "finance", label: "With NoLSAF", amount: sum(withFinance) + advanceInFlight, count: withFinance.length + items.filter((item) => (item.advance?.inFlight || 0) > 0).length, hint: "being processed", tone: "sky" as const },
      { key: "paid", label: "Paid out", amount: sum(paidOut) + advancePaid, count: paidOut.length + items.filter((item) => (item.advance?.paid || 0) > 0 && trackerStage(item) !== "DISBURSED").length, hint: "in your account", tone: "emerald" as const },
    ];
  }, [items, trackerStage, claimReady, claimReadyTotal, claimWaiting]);
  const payoutReady = isPayoutDestinationComplete(payoutProfile);

  const operationRows = useMemo(() => {
    const filtered = trackerFilter === "ALL" ? [...items] : items.filter((item) => trackerStage(item) === trackerFilter);
    const sorted = filtered.sort((a, b) => {
      const latestA = new Date(a.payoutPaidAt || a.payoutApprovedAt || a.payoutRequestedAt || a.completedAt || a.createdAt || a.dateFrom || a.dateTo || 0).getTime();
      const latestB = new Date(b.payoutPaidAt || b.payoutApprovedAt || b.payoutRequestedAt || b.completedAt || b.createdAt || b.dateFrom || b.dateTo || 0).getTime();

      let cmp = 0;
      if (sortField === "operation") {
        cmp = String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
      } else if (sortField === "stage") {
        cmp = normalizedStage(a).localeCompare(normalizedStage(b), undefined, { sensitivity: "base" });
      } else {
        cmp = latestA - latestB;
      }

      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [items, sortField, sortDirection, trackerFilter, trackerStage, normalizedStage]);

  const totalPages = Math.max(1, Math.ceil(operationRows.length / pageSize));

  const pagedOperationRows = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * pageSize;
    return operationRows.slice(start, start + pageSize);
  }, [operationRows, currentPage, totalPages]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Reset on the filter itself, not on the chip click: sidebar links change the
  // stage without going through that handler.
  useEffect(() => {
    setCurrentPage(1);
  }, [trackerFilter]);

  const toggleSort = (field: SortField) => {
    setCurrentPage(1);
    setSortField((prevField) => {
      if (prevField === field) {
        setSortDirection((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevField;
      }
      setSortDirection("asc");
      return field;
    });
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  };

  const hasTourRows = useMemo(() => items.some((item) => item.source === "TOUR_BOOKING"), [items]);
  const displayCurrency = hasTourRows ? "USD" : (summary?.currency || "USD");
  const cancelledTrips = useMemo(
    () => items.filter((item) => /CANCEL|REJECT|REFUND/i.test(String(item.status || ""))).length,
    [items]
  );
  const trendLabelStep = useMemo(() => {
    const len = trend.buckets.length;
    if (len <= 8) return 1;
    if (len <= 16) return 2;
    return Math.ceil(len / 8);
  }, [trend.buckets.length]);
  const trendTotals = useMemo(() => {
    return trend.buckets.reduce(
      (acc, b) => {
        acc.paid += Number(b.paid || 0);
        acc.pending += Number(b.pending || 0);
        return acc;
      },
      { paid: 0, pending: 0 }
    );
  }, [trend.buckets]);

  // The rail marks each stage that has operations waiting; publish the tally the
  // page already has rather than having the rail fetch the list again.
  useEffect(() => {
    if (loading) return;
    publishRailCounts("revenues", {
      all: trackerCounts.ALL,
      new: trackerCounts.NEW,
      claimed: trackerCounts.CLAIMED,
      verified: trackerCounts.VERIFIED,
      approved: trackerCounts.APPROVED,
      disbursed: trackerCounts.DISBURSED,
      rejected: trackerCounts.REJECTED,
    });
  }, [loading, trackerCounts]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LogoSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-clip pb-10">
      <Link
        href="/account/agent"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 no-underline transition hover:text-emerald-700"
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to dashboard
      </Link>

      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Operator earnings</p>
          <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">My revenues</h1>
          <p className="m-0 mt-1 text-sm text-neutral-500">
            Earnings, payout claims and commission history from completed bookings.
          </p>
        </div>

        <div className="group/tooltip relative inline-flex shrink-0">
          <button
            type="button"
            aria-label="Revenue flow information"
            className="inline-flex min-h-9 cursor-pointer appearance-none items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 outline-none transition hover:border-emerald-200 hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600/25"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
            Revenue flow
          </button>
          <div
            role="tooltip"
            className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-solid border-neutral-200 bg-white p-3 text-left opacity-0 shadow-[0_18px_45px_-25px_rgba(15,23,42,0.5)] transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
          >
            <p className="m-0 text-[11px] font-bold text-neutral-800">Revenue flow</p>
            <p className="m-0 mt-1 text-[11px] leading-relaxed text-neutral-500">
              Track completed-trip earnings, pending payout claims and commission retained by the platform.
            </p>
          </div>
        </div>
      </header>

      {/* Claim a payout. The page's primary action, so it leads: it lists what is
          claimable now, what will be and why, and fixes the payout destination
          in place instead of sending the operator away. */}
      <section id="claim-payout" className="mb-4 overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white">
        <style>{"#claim-payout, #claim-payout * { box-sizing: border-box; }"}</style>

        {/* Header: title, then where the money sits as a left-to-right flow */}
        <div className="border-0 border-b border-solid border-neutral-100 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#02665e]/10 text-[#02665e]">
              <HandCoins className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="m-0 text-[16px] font-bold text-neutral-900">Claim a payout</h2>
              <p className="m-0 mt-0.5 text-[12.5px] text-neutral-500">
                {claimReady.length
                  ? `${claimReady.length} ${claimReady.length === 1 ? "trip is" : "trips are"} ready. Pick one below and send the claim.`
                  : claimWaiting.length
                    ? `Nothing to claim today. ${claimWaiting.length} ${claimWaiting.length === 1 ? "trip opens" : "trips open"} for claims soon.`
                    : "Your earnings move through these stages. Completed trips become claimable here."}
              </p>
            </div>
          </div>

          {/* Money rail: four stops joined by one line. Dashes run into any stop
              that holds money, so the page reads as a flow, not a table. */}
          <style>{`
            @keyframes payout-flow { to { background-position: 28px 0; } }
            @keyframes payout-dash { to { stroke-dashoffset: -28; } }
            .payout-flow-x { background-image: repeating-linear-gradient(90deg, currentColor 0 10px, transparent 10px 14px); background-size: 28px 100%; animation: payout-flow 1.1s linear infinite; }
            .payout-dash { stroke-dasharray: 10 4; animation: payout-dash 1.1s linear infinite; }
            @media (prefers-reduced-motion: reduce) { .payout-flow-x, .payout-dash { animation: none; } }
          `}</style>
          {(() => {
            const stops = payoutPipeline.map((stage, index) => {
              const next = payoutPipeline[index + 1];
              const tone = {
                brand: { node: "bg-[#02665e] text-white shadow-[0_0_0_5px_rgba(2,102,94,0.12)]", amount: "text-[#02665e]", line: "text-[#02665e]" },
                amber: { node: "bg-amber-500 text-white shadow-[0_0_0_5px_rgba(245,158,11,0.14)]", amount: "text-amber-700", line: "text-amber-400" },
                sky: { node: "bg-sky-600 text-white shadow-[0_0_0_5px_rgba(2,132,199,0.12)]", amount: "text-sky-700", line: "text-sky-400" },
                emerald: { node: "bg-emerald-600 text-white shadow-[0_0_0_5px_rgba(5,150,105,0.12)]", amount: "text-emerald-700", line: "text-emerald-400" },
              };
              return {
                ...stage,
                active: stage.count > 0,
                last: index === payoutPipeline.length - 1,
                tone: tone[stage.tone],
                Icon: stage.key === "ready" ? HandCoins : stage.key === "soon" ? Clock : stage.key === "finance" ? Building2 : CheckCircle2,
                // The segment leading out of a stop animates when the next stop holds money.
                flowing: Boolean(next && next.count > 0),
                nextLine: next ? tone[next.tone].line : "",
              };
            });
            const node = (s: (typeof stops)[number]) => (
              <span className={`relative z-10 grid h-10 w-10 flex-shrink-0 place-items-center rounded-full transition-colors ${s.active ? s.tone.node : "border-2 border-solid border-neutral-200 bg-white text-neutral-300"}`}>
                <s.Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
            );
            const text = (s: (typeof stops)[number], align: "left" | "right" | "center") => (
              <div className={`min-w-0 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`}>
                <div className={`text-[12.5px] font-semibold ${s.active ? "text-neutral-800" : "text-neutral-400"}`}>{s.label}</div>
                <div className={`mt-0.5 text-[18px] font-extrabold leading-tight tabular-nums ${s.active ? s.tone.amount : "text-neutral-300"}`}>
                  {s.active ? `${displayCurrency} ${s.amount.toLocaleString("en-US")}` : `${displayCurrency} 0`}
                </div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-neutral-400">
                  {s.active ? `${s.count} ${s.count === 1 ? "trip" : "trips"} · ${s.hint}` : s.hint}
                </div>
              </div>
            );
            return (
              <>
                {/* Phones: a zigzag. Stops alternate left and right, joined by
                    diagonals that run node centre to node centre. */}
                <ol className="m-0 mt-5 list-none p-0 sm:hidden" aria-label="Where your earnings are">
                  {stops.map((s, index) => {
                    const onLeft = index % 2 === 0;
                    return (
                      <li key={s.key} className="min-w-0">
                        <div className={`flex items-center gap-3 ${onLeft ? "" : "flex-row-reverse"}`}>
                          {node(s)}
                          {text(s, onLeft ? "left" : "right")}
                        </div>
                        {!s.last ? (
                          <div className="relative -my-1 h-9" aria-hidden>
                            {/* spans from one node centre (20px in) to the other side's */}
                            <svg className="absolute inset-y-0 left-5 right-5 h-full w-[calc(100%-2.5rem)] overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                              <line
                                x1={onLeft ? 0 : 100}
                                y1={0}
                                x2={onLeft ? 100 : 0}
                                y2={100}
                                vectorEffect="non-scaling-stroke"
                                strokeWidth={2}
                                strokeLinecap="round"
                                className={s.flowing ? `payout-dash ${s.nextLine}` : "text-neutral-200"}
                                stroke="currentColor"
                              />
                            </svg>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>

                {/* Tablet up: one horizontal rail */}
                <ol className="m-0 mt-5 hidden list-none p-0 sm:flex sm:flex-row" aria-label="Where your earnings are">
                  {stops.map((s) => (
                    <li key={s.key} className="relative flex min-w-0 flex-1 flex-col items-center gap-2.5">
                      {!s.last ? (
                        <span aria-hidden className={`absolute left-[calc(50%+26px)] right-[calc(-50%+26px)] top-[19px] h-0.5 rounded-full ${s.flowing ? `payout-flow-x ${s.nextLine}` : "bg-neutral-200"}`} />
                      ) : null}
                      {node(s)}
                      <div className="px-2">{text(s, "center")}</div>
                    </li>
                  ))}
                </ol>
              </>
            );
          })()}
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {/* Payout destination: the saved one with Change, or the editor when none is set */}
          <OperatorPayoutDestination
            key={payoutReady ? "saved" : "missing"}
            saved={payoutProfile || {}}
            onSaved={(next) => {
              setPayoutProfile((current) => ({ ...(current || {}), ...next }));
              setClaimLookupError(null);
            }}
          />

          {/* Pre-trip advance (Tour Operator Disbursement Policy) */}
          <TourAdvanceClaims
            trips={items as AdvanceTrip[]}
            onClaimed={(tripId, row) =>
              setItems((prev) =>
                prev.map((item) =>
                  item.id === tripId
                    ? {
                        ...item,
                        advance: {
                          offer: item.advance?.offer ?? null,
                          paid: item.advance?.paid ?? 0,
                          inFlight: (item.advance?.inFlight ?? 0) + row.amount,
                          claims: [...(item.advance?.claims ?? []), row],
                        },
                        claimEligibility: item.claimEligibility?.ok ? { ok: false, reason: "advance_in_flight", availableAt: null } : item.claimEligibility,
                      }
                    : item
                )
              )
            }
          />

          {/* Ready to claim: pick a trip instead of typing a code */}
          <div>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
              <h3 className="m-0 text-[13.5px] font-bold text-neutral-900">
                Ready to claim <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700">{claimReady.length}</span>
              </h3>
              <label className="flex h-9 w-full items-center gap-2 rounded-full border border-solid border-neutral-300 bg-white px-3.5 text-neutral-400 transition-[border-color,box-shadow] hover:border-neutral-400 focus-within:border-[#02665e] focus-within:text-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)] sm:w-72">
                <Search className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                <span className="sr-only">Tour code</span>
                <input
                  type="text"
                  value={claimLookupCode}
                  onChange={(e) => setClaimLookupCode(e.target.value.toUpperCase())}
                  placeholder="Or paste a tour code"
                  className="h-full w-full min-w-0 border-0 bg-transparent p-0 font-mono text-[12px] font-bold uppercase tracking-wide text-neutral-800 placeholder:font-sans placeholder:font-medium placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-400 focus:outline-none focus:ring-0"
                />
              </label>
            </div>

            {claimReady.length === 0 ? (
              <p className="m-0 rounded-2xl border border-dashed border-neutral-300 px-4 py-6 text-center text-[12.5px] text-neutral-500">
                No trip can be claimed right now. Claims open after a trip is completed and the guest confirms it, or the dispute window closes.
              </p>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {claimReady.map((item) => {
                  const selected = claimLookupMatch?.id === item.id;
                  return (
                    <button
                      key={String(item.id)}
                      type="button"
                      onClick={() => { setClaimLookupCode(String(item.bookingCode || "")); setClaimConsent(false); setShowClaimConfirm(false); }}
                      aria-pressed={selected}
                      style={{ fontFamily: "inherit" }}
                      className={`flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-solid p-3.5 text-left transition-all ${
                        selected ? "border-[#02665e] bg-[#02665e]/5 shadow-[0_0_0_3px_rgba(2,102,94,0.12)]" : "border-neutral-200 bg-white hover:-translate-y-px hover:border-neutral-300"
                      }`}
                    >
                      <span className={`inline-flex h-11 w-12 flex-shrink-0 items-center justify-center rounded-xl text-[13px] font-black tracking-[0.08em] ${selected ? "bg-[#02665e] text-white" : "bg-neutral-100 text-[#02665e]"}`}>
                        {placeCodeFor(item.title)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold text-neutral-900">{item.client}</span>
                        <span className="block truncate font-mono text-[11px] text-neutral-400">{item.bookingCode}</span>
                      </span>
                      <span className="flex-shrink-0 text-right">
                        <span className="block text-[14px] font-extrabold tabular-nums text-neutral-900">{Number(item.balanceAmount ?? item.agentEarning ?? 0).toLocaleString("en-US")}</span>
                        <span className="block text-[10.5px] font-semibold text-neutral-400">{item.currency} to you</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {claimWaiting.length > 0 ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowWaiting((open) => !open)}
                  aria-expanded={showWaiting}
                  style={{ fontFamily: "inherit" }}
                  className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[12.5px] font-semibold text-neutral-500 hover:text-neutral-900"
                >
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {claimWaiting.length} not claimable yet
                  <span className="text-neutral-400">{showWaiting ? "· hide" : "· see why"}</span>
                </button>
                {showWaiting ? (
                  <ul className="m-0 mt-2 list-none divide-y divide-solid divide-neutral-100 overflow-hidden rounded-2xl border border-solid border-neutral-200 p-0 [&>*]:border-x-0">
                    {claimWaiting.map((item) => (
                      <li key={String(item.id)} className="flex flex-wrap items-center justify-between gap-2 bg-white px-3.5 py-2.5">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-neutral-800">{item.client}</span>
                          <span className="block truncate font-mono text-[11px] text-neutral-400">{item.bookingCode}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="text-[12.5px] font-bold tabular-nums text-neutral-500">{item.currency} {Number(item.agentEarning || 0).toLocaleString("en-US")}</span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${item.claimEligibility?.reason === "open_case" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}
                            title={claimBlockedReason(item)}
                          >
                            {claimBlockedShort(item)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          {claimLookupError ? (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-solid border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-rose-700">
              <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              {claimLookupError}
            </div>
          ) : null}

          {/* The claim itself: money split, destination and send */}
          {claimLookupMatch ? (() => {
            const m = claimLookupMatch;
            const gross = Number(m.budget || 0);
            const commission = Number(m.commissionAmount || 0);
            // The balance: net share minus any advance already paid.
            const advancedAlready = Number(m.advance?.paid || 0);
            const net = Number(m.balanceAmount ?? m.agentEarning ?? 0);
            const commissionShare = gross > 0 ? Math.min(100, Math.max(0, (commission / gross) * 100)) : 0;
            const advanceShare = gross > 0 ? Math.min(100 - commissionShare, Math.max(0, (advancedAlready / gross) * 100)) : 0;
            const eligible = !m.claimEligibility || m.claimEligibility.ok;
            const canSend = eligible && payoutReady && claimConsent && !claimSubmitting;
            return (
              <div className="overflow-hidden rounded-2xl border border-solid border-[#02665e]/30 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 bg-[#02665e]/5 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold text-neutral-900">{m.title}</div>
                    <div className="truncate text-[12px] text-neutral-500">
                      {[m.client, m.nationality, m.dateFrom ? new Date(m.dateFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className="max-w-full truncate rounded-full bg-white px-2.5 py-1 font-mono text-[11px] font-bold text-[#02665e] ring-1 ring-inset ring-[#02665e]/20">{m.bookingCode}</span>
                </div>

                <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  {/* Money split */}
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-neutral-400">You receive</div>
                    <div className="mt-1 text-[34px] font-black leading-none tabular-nums text-[#02665e]">
                      {m.currency} {net.toLocaleString("en-US")}
                    </div>
                    <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                      <span className="h-full bg-[#02665e]" style={{ width: `${Math.max(0, 100 - commissionShare - advanceShare)}%` }} />
                      {advanceShare > 0 ? <span className="h-full bg-sky-400" style={{ width: `${advanceShare}%` }} /> : null}
                      <span className="h-full bg-amber-400" style={{ width: `${commissionShare}%` }} />
                    </div>
                    <dl className="m-0 mt-3 space-y-1.5 text-[13px]">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-neutral-500">Guest paid</dt>
                        <dd className="m-0 font-semibold tabular-nums text-neutral-800">{m.currency} {gross.toLocaleString("en-US")}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="inline-flex items-center gap-1.5 text-neutral-500"><span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />NoLSAF commission ({Number(m.commissionPercent || 0)}%)</dt>
                        <dd className="m-0 font-semibold tabular-nums text-neutral-800">- {m.currency} {commission.toLocaleString("en-US")}</dd>
                      </div>
                      {advancedAlready > 0 ? (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="inline-flex items-center gap-1.5 text-neutral-500"><span className="h-2 w-2 rounded-full bg-sky-400" aria-hidden />Advance already paid</dt>
                          <dd className="m-0 font-semibold tabular-nums text-neutral-800">- {m.currency} {advancedAlready.toLocaleString("en-US")}</dd>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-3 border-0 border-t border-dashed border-neutral-200 pt-1.5">
                        <dt className="inline-flex items-center gap-1.5 font-bold text-neutral-900"><span className="h-2 w-2 rounded-full bg-[#02665e]" aria-hidden />{advancedAlready > 0 ? "Balance to you" : "Your payout"}</dt>
                        <dd className="m-0 font-extrabold tabular-nums text-neutral-900">{m.currency} {net.toLocaleString("en-US")}</dd>
                      </div>
                    </dl>
                  </div>

                  {/* What happens after sending */}
                  <div className="min-w-0 rounded-2xl bg-neutral-50 p-4">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-neutral-400">After you send</div>
                    <ol className="m-0 mt-2.5 list-none space-y-2.5 p-0">
                      {[
                        { title: "Claimed", text: "Your invoice claim reaches NoLSAF finance." },
                        { title: "Verified", text: "Finance checks the trip and amounts." },
                        { title: "Approved", text: "The payout is approved for release." },
                        { title: "Disbursed", text: "Money is sent to your payout destination." },
                      ].map((step, index) => (
                        <li key={step.title} className="flex gap-2.5">
                          <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white text-[10.5px] font-bold text-[#02665e] ring-1 ring-inset ring-[#02665e]/25">{index + 1}</span>
                          <span className="min-w-0 text-[12px] leading-snug text-neutral-600"><strong className="font-bold text-neutral-900">{step.title}.</strong> {step.text}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                <div className="border-0 border-t border-solid border-neutral-100 px-4 py-4 sm:px-5">
                  {!eligible ? (
                    <div className="flex items-start gap-2 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] font-semibold text-amber-900">
                      <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                      {claimBlockedReason(m)}
                    </div>
                  ) : showClaimConfirm ? (
                    <div className="rounded-2xl border border-solid border-amber-200 bg-amber-50 p-4">
                      <p className="m-0 text-[13.5px] font-bold text-neutral-900">
                        Send a claim for {m.currency} {net.toLocaleString("en-US")}?
                      </p>
                      <p className="m-0 mt-1 text-[12px] text-neutral-600">A claim cannot be withdrawn once sent. NoLSAF will pay it to your saved payout destination.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={confirmClaimSubmit}
                          disabled={claimSubmitting}
                          style={{ fontFamily: "inherit" }}
                          className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <HandCoins className="h-4 w-4" aria-hidden />
                          {claimSubmitting ? "Submitting..." : "Yes, send claim"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowClaimConfirm(false)}
                          disabled={claimSubmitting}
                          style={{ fontFamily: "inherit" }}
                          className="inline-flex h-10 cursor-pointer items-center rounded-full border border-solid border-neutral-300 bg-white px-5 text-[13px] font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-neutral-700">
                        <input
                          type="checkbox"
                          checked={claimConsent}
                          onChange={(e) => setClaimConsent(e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300"
                        />
                        <span>I agree with the <Link href="/tour-operator-disbursement-policy" target="_blank" className="font-semibold text-[#02665e]">Tour Operator Disbursement Policy</Link> and confirm my payout destination is correct.</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleSubmitClaimInitiator}
                        disabled={!canSend}
                        title={!payoutReady ? "Add a verified payout destination first" : !claimConsent ? "Agree to the policy first" : undefined}
                        style={{ fontFamily: "inherit" }}
                        className="inline-flex h-10 flex-shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <HandCoins className="h-4 w-4" aria-hidden />
                        Claim {m.currency} {net.toLocaleString("en-US")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })() : null}

          {claimSubmitSuccessCard ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" aria-hidden />
                <div>
                  <p className="m-0 text-[13.5px] font-bold text-emerald-900">Claim sent to NoLSAF</p>
                  <p className="m-0 mt-0.5 text-[12px] text-emerald-800/80">Finance verifies it next. You can follow each step in the tracker.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setTrackerFilter("CLAIMED"); setClaimSubmitSuccessCard(null); setClaimLookupCode(""); }}
                style={{ fontFamily: "inherit" }}
                className="inline-flex h-9 flex-shrink-0 cursor-pointer items-center rounded-full border border-solid border-emerald-300 bg-white px-4 text-[12.5px] font-bold text-emerald-800 hover:bg-emerald-100"
              >
                Track my claims
              </button>
            </div>
          ) : null}
        </div>
      </section>

        {/* Summary cards */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<DollarSign className="h-4 w-4" />}
            label="My earnings"
            value={`${displayCurrency} ${(summary?.totalRevenue ?? 0).toLocaleString()}`}
            sub="Your cut from paid trips"
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Pending payout"
            value={`${displayCurrency} ${(summary?.pendingRevenue ?? 0).toLocaleString()}`}
            sub="Trips not yet paid out"
            tone="amber"
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Trips done"
            value={`${summary?.completedTrips ?? 0} / ${summary?.totalTrips ?? 0}`}
            sub="Completed out of assigned"
          />
          <StatCard
            icon={<XCircle className="h-4 w-4" />}
            label="Cancelled"
            value={String(cancelledTrips)}
            sub="Cancelled or rejected trips"
            tone="red"
          />
        </div>

        {/* Error & Success Messages */}
        {error && (
          <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Payments tracker (moved to trend area) */}
        <div className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
          <div className="bg-white px-4 py-3 shadow-[inset_0_-1px_0_0_#f5f5f5]">
            <div>
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Payments tracker</p>
              <p className="m-0 mt-1 text-xs text-neutral-500">Click invoice-flow status to quickly filter and track disbursement progress.</p>
            </div>
          </div>

          <div className="mx-auto w-full max-w-5xl min-w-0 px-2 py-4 sm:px-4">
            {/* Stage chips. Hidden from lg up, where the workspace sidebar owns
                stage selection; below lg the sidebar is not rendered, so these
                stay as the only way to filter. */}
            <div className="overflow-x-auto pb-1 [scrollbar-width:thin] lg:hidden">
              <div className="flex min-w-max items-center gap-2 px-1 pr-4 sm:min-w-0 sm:justify-center sm:px-0 sm:pr-0">
              {([
                ["ALL", "All"],
                ["NEW", "New"],
                ["CLAIMED", "Claimed"],
                ["VERIFIED", "Verified"],
                ["APPROVED", "Approved"],
                ["DISBURSED", "Disbursed"],
                ["REJECTED", "Rejected"],
              ] as const).map(([key, label]) => {
                const active = trackerFilter === key;
                const tone =
                  key === "DISBURSED"
                    ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                    : key === "APPROVED"
                      ? "border-cyan-200 text-cyan-700 bg-cyan-50"
                      : key === "VERIFIED"
                        ? "border-amber-200 text-amber-700 bg-amber-50"
                        : key === "REJECTED"
                          ? "border-red-200 text-red-700 bg-red-50"
                          : key === "CLAIMED"
                            ? "border-indigo-200 text-indigo-700 bg-indigo-50"
                            : "border-neutral-200 text-neutral-700 bg-white";

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setTrackerFilter(key);
                      setCurrentPage(1);
                    }}
                    className={`inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-md border border-solid px-2.5 py-1.5 text-sm font-semibold transition ${active ? tone : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-800"}`}
                  >
                    <span className="inline-flex items-center gap-2 leading-none">
                      <span>{label}</span>
                      <span className={`inline-flex h-6 w-8 items-center justify-center rounded-md px-0 py-0.5 text-[11px] font-bold sm:h-auto sm:w-9 sm:rounded-full sm:text-xs ${active ? "bg-white/80" : "bg-neutral-100"}`}>
                        {trackerCounts[key]}
                      </span>
                    </span>
                  </button>
                );
              })}
              </div>
            </div>
            <p className="mx-auto mt-2 max-w-3xl text-center text-xs leading-relaxed text-neutral-500">
              Track invoice processing pipeline by status: New, Claimed, Verified, Approved, Disbursed, and Rejected.
            </p>

          </div>
        </div>

        {/* Payout tracker */}
        <div className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
          <div className="px-4 py-3 shadow-[inset_0_-1px_0_0_#f5f5f5]">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Payout operations</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">Invoice and payout workflow per trip: NEW, CLAIMED, VERIFIED, APPROVED, DISBURSED.</p>
          </div>

          {operationRows.length === 0 ? (
            <div className="px-4 py-8">
              <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-2xl border border-solid border-dashed border-neutral-300 px-6 py-12 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-400">
                  <TrendingUp className="h-5 w-5" aria-hidden />
                </span>
                <p className="m-0 mt-1 text-sm font-bold text-neutral-800">No operations found</p>
                <p className="m-0 text-xs text-neutral-500">Assigned and completed trips will appear here automatically.</p>
              </div>
            </div>
          ) : (
            <TableScroller label="payout operations table">
              <table className="w-full min-w-[1320px] border-collapse text-left text-sm">
                <thead className="bg-neutral-50/90 [&>tr>th]:shadow-[inset_0_-1px_0_0_#e5e5e5]">
                  <tr className="text-left text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                    <th className="px-4 py-3 whitespace-nowrap">S/N</th>
                    <th className="px-4 py-3 whitespace-nowrap">Tour Code</th>
                    <th className="px-4 py-3 whitespace-nowrap">Receipt</th>
                    <th className="px-4 py-3 whitespace-nowrap">
                      <button type="button" onClick={() => toggleSort("stage")} className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 transition hover:text-emerald-700">
                        Invoice Stage{sortIndicator("stage")}
                      </button>
                    </th>
                    <th className="px-4 py-3 whitespace-nowrap">
                      Trip Workflow
                    </th>
                    <th className="px-4 py-3 whitespace-nowrap">
                      <button type="button" onClick={() => toggleSort("updatedAt")} className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 transition hover:text-emerald-700">
                        Last Updated{sortIndicator("updatedAt")}
                      </button>
                    </th>
                    <th className="px-4 py-3 whitespace-nowrap">My Earning</th>
                    <th className="px-4 py-3 whitespace-nowrap">Payout Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white [&>tr>td]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>tr:last-child>td]:shadow-none">
              {pagedOperationRows.map((item, rowIndex) => {
                const serialNumber = (currentPage - 1) * pageSize + rowIndex + 1;
                const earningCurrency = item.source === "TOUR_BOOKING" ? "USD" : (item.currency || displayCurrency);
                const stage = normalizedStage(item);
                const receiptRef = String(item.paymentRef || "").trim();
                const receiptAt = item.payoutPaidAt || item.payoutApprovedAt || item.payoutRequestedAt || item.completedAt || item.createdAt;
                const receiptTimestamp = receiptAt
                  ? new Date(receiptAt).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })
                  : null;
                const claimStarted = hasClaimStarted(item);
                const stageTone =
                  stage === "DISBURSED"
                    ? "bg-emerald-50 text-emerald-700"
                    : stage === "APPROVED"
                      ? "bg-blue-50 text-blue-700"
                      : stage === "VERIFIED"
                        ? "bg-amber-50 text-amber-700"
                        : stage === "REJECTED"
                          ? "bg-red-50 text-red-700"
                          : "bg-neutral-100 text-neutral-700";
                const latestAt = item.payoutPaidAt || item.payoutApprovedAt || item.payoutRequestedAt || item.completedAt || item.createdAt;

                const workflowStage = trackerStage(item);
                const stepDone = (target: "NEW" | "CLAIMED" | "VERIFIED" | "APPROVED" | "DISBURSED" | "REJECTED") => {
                  const order = { NEW: 1, CLAIMED: 2, VERIFIED: 3, APPROVED: 4, DISBURSED: 5, REJECTED: 6 } as const;
                  if (workflowStage === "REJECTED") {
                    return target === "NEW" || target === "CLAIMED" || target === "REJECTED";
                  }
                  return order[workflowStage] >= order[target];
                };

                const workflowTone: Record<"NEW" | "CLAIMED" | "VERIFIED" | "APPROVED" | "DISBURSED" | "REJECTED", { active: string; inactive: string }> = {
                  NEW: {
                    active: "bg-teal-100 text-teal-800 ring-1 ring-teal-200",
                    inactive: "bg-neutral-100 text-neutral-400 ring-1 ring-neutral-200",
                  },
                  CLAIMED: {
                    active: "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200",
                    inactive: "bg-neutral-100 text-neutral-400 ring-1 ring-neutral-200",
                  },
                  VERIFIED: {
                    active: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
                    inactive: "bg-neutral-100 text-neutral-400 ring-1 ring-neutral-200",
                  },
                  APPROVED: {
                    active: "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-200",
                    inactive: "bg-neutral-100 text-neutral-400 ring-1 ring-neutral-200",
                  },
                  DISBURSED: {
                    active: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
                    inactive: "bg-neutral-100 text-neutral-400 ring-1 ring-neutral-200",
                  },
                  REJECTED: {
                    active: "bg-red-100 text-red-800 ring-1 ring-red-200",
                    inactive: "bg-neutral-100 text-neutral-400 ring-1 ring-neutral-200",
                  },
                };

                return (
                  <TableRow key={item.id} className="align-top" hover>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-neutral-700">
                      {serialNumber}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs font-semibold text-neutral-700">
                      {item.bookingCode ? (
                        <span className="inline-block whitespace-nowrap rounded border border-solid border-teal-200 bg-teal-50 px-2 py-0.5 font-bold text-teal-700" title={item.bookingCode}>
                          {item.bookingCode}
                        </span>
                      ) : (
                        <span className="text-neutral-400">Not assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs">
                      {receiptRef ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-emerald-700">{receiptRef}</span>
                          {receiptTimestamp ? <span className="text-[10px] text-neutral-500">{receiptTimestamp}</span> : null}
                        </div>
                      ) : (
                        <span className="text-neutral-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase ${stageTone}`}>
                        {stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 min-w-[420px]">
                      <div className="grid grid-cols-6 gap-1 text-[10px] font-semibold uppercase tracking-wide">
                        {(["NEW", "CLAIMED", "VERIFIED", "APPROVED", "DISBURSED", "REJECTED"] as const).map((step) => (
                          <div
                            key={step}
                            className={`relative rounded px-2 py-1 text-center ${stepDone(step) ? workflowTone[step].active : workflowTone[step].inactive}`}
                          >
                            {stepDone(step) ? <span aria-hidden className="absolute left-1.5 top-1 text-[10px] leading-none">✓</span> : null}
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-500 min-w-[170px]">
                      <div className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3 shrink-0" />
                        {latestAt
                          ? new Date(latestAt).toLocaleString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })
                          : "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-[#02665e]">
                      {earningCurrency} {Number(item.agentEarning || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {!item.isCompleted ? (
                        <span className="text-[11px] font-semibold text-neutral-500">Awaiting completion</span>
                      ) : stage === "REJECTED" ? (
                        <span className="text-[11px] font-semibold text-red-600">Rejected</span>
                      ) : stage === "DISBURSED" ? (
                        <span className="text-[11px] font-semibold text-emerald-600">Disbursed</span>
                      ) : stage === "APPROVED" ? (
                        <span className="text-[11px] font-semibold text-cyan-700">Approved</span>
                      ) : stage === "VERIFIED" ? (
                        <span className="text-[11px] font-semibold text-amber-700">Verified</span>
                      ) : claimStarted ? (
                        <span className="text-[11px] font-semibold text-blue-600">Submitted / In review</span>
                      ) : (
                        <span className="text-[11px] font-semibold text-neutral-500">Not started</span>
                      )}
                    </td>
                  </TableRow>
                );
              })}
                </tbody>
              </table>
            </TableScroller>
          )}

          {operationRows.length > 0 && (
            <div className="flex flex-col gap-3 bg-neutral-50/70 px-4 py-3 text-[11px] font-semibold text-neutral-500 shadow-[inset_0_1px_0_0_#eeeeee] sm:flex-row sm:items-center sm:justify-between">
              <div>
                Showing {(Math.min((currentPage - 1) * pageSize + 1, operationRows.length)).toLocaleString()}-
                {(Math.min(currentPage * pageSize, operationRows.length)).toLocaleString()} of {operationRows.length.toLocaleString()} operations
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="inline-flex min-h-8 cursor-pointer appearance-none items-center rounded-lg border border-solid border-neutral-200 bg-white px-3 font-semibold text-neutral-600 transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="px-2 font-semibold text-neutral-500">Page {currentPage} / {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="inline-flex min-h-8 cursor-pointer appearance-none items-center rounded-lg border border-solid border-neutral-200 bg-white px-3 font-semibold text-neutral-600 transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Trend chart (pushed down) */}
        <div className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
          <div className="flex items-center justify-between gap-3 bg-white px-4 py-3 shadow-[inset_0_-1px_0_0_#f5f5f5]">
            <div>
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Operations trend</p>
              <p className="m-0 mt-1 text-xs text-neutral-500">Paid vs pending earnings ({trendRange})</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] font-semibold">
              {(["24H", "7D", "1M", "3M"] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTrendRange(range)}
                  className={`rounded-md border border-solid px-2 py-1 text-[10px] font-bold tracking-wide transition ${trendRange === range ? "border-[#02665e] bg-[#02665e]/10 text-[#02665e]" : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300"}`}
                >
                  {range}
                </button>
              ))}
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Paid
              </span>
              <span className="inline-flex items-center gap-1 text-amber-600">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Pending
              </span>
            </div>
          </div>

          <div className="mx-4 mt-4 rounded-xl border border-solid border-neutral-100 bg-neutral-50/60 p-3">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-600">
              <span className="font-semibold">Range total:</span>
              <span className="font-bold text-emerald-700">Paid {displayCurrency} {trendTotals.paid.toLocaleString()}</span>
              <span className="font-bold text-amber-700">Pending {displayCurrency} {trendTotals.pending.toLocaleString()}</span>
            </div>

            <div className="relative overflow-x-auto pb-2">
              <div
                className="relative w-full"
                style={{ minWidth: `${Math.max(360, trend.buckets.length * 30)}px` }}
              >
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-x-0 top-0 border-0 border-t border-solid border-neutral-200" />
                  <div className="absolute inset-x-0 top-1/3 border-0 border-t border-solid border-neutral-200/80" />
                  <div className="absolute inset-x-0 top-2/3 border-0 border-t border-solid border-neutral-200/80" />
                  <div className="absolute inset-x-0 bottom-0 border-0 border-t border-solid border-neutral-300" />
                </div>

                <div
                  className="relative grid h-52 items-end gap-1.5"
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, trend.buckets.length)}, minmax(0, 1fr))` }}
                >
                  {trend.buckets.map((b, idx) => {
                    const paidH = trend.maxY > 0 ? (b.paid / trend.maxY) * 100 : 0;
                    const pendingH = trend.maxY > 0 ? (b.pending / trend.maxY) * 100 : 0;
                    const paidHeight = b.paid > 0 ? Math.max(6, paidH) : 0;
                    const pendingHeight = b.pending > 0 ? Math.max(6, pendingH) : 0;

                    return (
                      <div key={b.key} className="flex h-full min-w-0 flex-col justify-end">
                        <div className="flex h-[84%] items-end justify-center gap-1">
                          <div
                            className="w-3 rounded-t bg-emerald-500"
                            style={{ height: `${paidHeight}%` }}
                            title={`${b.label} - Paid: ${displayCurrency} ${Number(b.paid || 0).toLocaleString()}`}
                          />
                          <div
                            className="w-3 rounded-t bg-amber-500"
                            style={{ height: `${pendingHeight}%` }}
                            title={`${b.label} - Pending: ${displayCurrency} ${Number(b.pending || 0).toLocaleString()}`}
                          />
                        </div>
                        <span className="mt-2 block truncate text-center text-[10px] font-semibold text-neutral-500" title={b.label}>
                          {trend.buckets.length <= 8 || idx % trendLabelStep === 0 || idx === trend.buckets.length - 1
                            ? b.label
                            : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}
