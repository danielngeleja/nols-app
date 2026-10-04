"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CalendarX2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Lock,
  Mail,
  MapPin,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import LayoutFrame from "@/components/LayoutFrame";
import LogoSpinner from "@/components/LogoSpinner";

const api = apiClient;

type LookupResponse = {
  booking: {
    id: number;
    status: string;
    createdAt: string;
    checkIn: string;
    checkOut: string;
    totalAmount: number;
    bookingCode: string;
    codeStatus: string;
    property: {
      id: number;
      title: string;
      type: string;
      regionName?: string | null;
      district?: string | null;
      city?: string | null;
      country?: string | null;
    };
  };
  eligibility: {
    eligible: boolean;
    reason?: string;
    refundPercent?: number;
    rule?: string;
    nextStep?: "PLATFORM" | "EMAIL";
  };
  existingRequest: { id: number; status: string; createdAt: string } | null;
};

/** A paid, upcoming booking the customer can pick instead of typing its code. */
type PickableBooking = {
  bookingCode: string;
  title: string;
  checkIn: string;
  checkOut: string;
  place: string;
};

function normalizeCode(input: string) {
  return (input || "").trim().toUpperCase().replace(/\s+/g, "");
}

function formatDate(d: string) {
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

function formatTZS(n: number) {
  return `TZS ${Math.round(Number(n || 0)).toLocaleString("en-US")}`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

const CANCELLATION_EMAIL = "cancellation@nolsaf.com";
const LOOKUP_LIMIT = 4;

/** The three refund outcomes of the policy, in the order time runs out. */
const REFUND_TIERS = [
  { pct: 100, title: "Full refund", rule: "Within 24 hours of booking and at least 72 hours before check-in." },
  { pct: 50, title: "Half refund", rule: "At least 96 hours before check-in, after the free window." },
  { pct: 0, title: "No refund", rule: "Later than that, after check-in, or on non-refundable rates." },
];

const CLAIM_STATUS: Record<string, { label: string; tone: string }> = {
  SUBMITTED: { label: "Submitted", tone: "bg-sky-50 text-sky-700 ring-sky-200" },
  REVIEWING: { label: "In review", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  NEED_INFO: { label: "Needs your reply", tone: "bg-orange-50 text-orange-800 ring-orange-200" },
  APPROVED: { label: "Approved", tone: "bg-teal-50 text-teal-700 ring-teal-200" },
  REFUND_PENDING: { label: "Refund on the way", tone: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  REFUNDED: { label: "Refunded", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  REJECTED: { label: "Declined", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
};

/** One numbered step of the request: number on a rail, content beside it. */
function Step({
  n,
  title,
  hint,
  state,
  last,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  state: "done" | "current" | "waiting";
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={[
            "relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
            state === "done"
              ? "bg-[#02665e] text-white"
              : state === "current"
                ? "bg-white text-[#02665e] ring-2 ring-[#02665e]"
                : "bg-slate-100 text-slate-400 ring-1 ring-slate-200",
          ].join(" ")}
        >
          {state === "done" ? <Check className="h-4 w-4" aria-hidden /> : n}
        </span>
        {!last ? <span className={`mt-1 w-px flex-1 ${state === "done" ? "bg-[#02665e]/40" : "bg-slate-200"}`} aria-hidden /> : null}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-7"}`}>
        <h2 className={`m-0 pt-1 text-[15px] font-bold leading-tight ${state === "waiting" ? "text-slate-400" : "text-slate-900"}`}>{title}</h2>
        {hint ? <p className={`m-0 mt-0.5 text-[12.5px] ${state === "waiting" ? "text-slate-300" : "text-slate-500"}`}>{hint}</p> : null}
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </section>
  );
}

export default function CancellationRequestPage() {
  const sp = useSearchParams();
  const initialCode = useMemo(() => normalizeCode(sp?.get("code") || ""), [sp]);

  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: number; status: string } | null>(null);

  // Rate-limit lockout: timestamp (ms) until which the user is blocked from validating
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState("");
  // How many lookup attempts the server says remain before lockout (null = not yet fetched)
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  // Ref: last code that was successfully resolved, prevents redundant re-fetches
  const lastResolvedCodeRef = useRef<string>("");

  const [reason, setReason] = useState("");
  const [confirmPolicy, setConfirmPolicy] = useState(false);
  const [confirmTerms, setConfirmTerms] = useState(false);
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [showAllClaims, setShowAllClaims] = useState(false);
  const [pickable, setPickable] = useState<PickableBooking[]>([]);

  async function loadMyRequests() {
    setLoadingRequests(true);
    try {
      const res = await api.get("/api/customer/cancellations");
      setMyRequests(res.data.items || []);
    } catch {
      // ignore (page can still work without list)
    } finally {
      setLoadingRequests(false);
    }
  }

  // Paid, upcoming stays with a live code: the customer can tap one instead of typing
  async function loadPickable() {
    try {
      const res = await api.get("/api/customer/bookings?pageSize=50");
      const now = Date.now();
      const items: any[] = res.data.items || [];
      setPickable(
        items
          .filter((b) => b?.bookingCode && b.codeStatus === "ACTIVE" && b.status !== "CANCELED" && new Date(b.checkIn).getTime() > now)
          .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())
          .slice(0, 4)
          .map((b) => ({
            bookingCode: normalizeCode(b.bookingCode),
            title: String(b.property?.title || "Your stay"),
            checkIn: b.checkIn,
            checkOut: b.checkOut,
            place: [b.property?.district, b.property?.regionName].filter(Boolean).join(", "),
          })),
      );
    } catch {
      // Typing the code still works
    }
  }

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      void doLookup(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  useEffect(() => {
    void loadMyRequests();
    void loadPickable();
  }, []);

  // Countdown ticker for rate-limit lockout UI, formats as hh:mm:ss
  useEffect(() => {
    if (!rateLimitedUntil) return;
    const fmt = (secs: number) => {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
      return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
    };
    const tick = () => {
      const remaining = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setRateLimitedUntil(null);
        setRateLimitCountdown("");
        setAttemptsRemaining(null);
      } else {
        setRateLimitCountdown(fmt(remaining));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [rateLimitedUntil]);

  // Auto-validate when code changes (debounced)
  // Rules: min 8 chars, 1500ms debounce, skip if already resolved the same code
  useEffect(() => {
    const normalized = normalizeCode(code);
    if (normalized.length >= 8) {
      if (normalized === lastResolvedCodeRef.current && lookup !== null) return;
      const timer = setTimeout(() => {
        void doLookup(normalized);
      }, 1500);
      return () => clearTimeout(timer);
    } else if (normalized.length === 0) {
      setLookup(null);
      setError(null);
      lastResolvedCodeRef.current = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function doLookup(overrideCode?: string) {
    const c = normalizeCode(overrideCode ?? code);
    if (!c) {
      setError("Please enter your booking code.");
      setLookup(null);
      return;
    }

    // Guard: refuse if client-side lockout is still active
    if (rateLimitedUntil && Date.now() < rateLimitedUntil) {
      const secs = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      const display = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
      setError(`Validation locked. Please wait ${display} before trying again.`);
      return;
    }

    // Guard: skip if we already have a valid resolved result for this exact code
    if (c === lastResolvedCodeRef.current && lookup !== null) return;

    setLoadingLookup(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await api.get<LookupResponse>("/api/customer/cancellations/lookup", { params: { code: c } });
      const remaining = Number(res.headers["ratelimit-remaining"] ?? res.headers["x-ratelimit-remaining"]);
      if (Number.isFinite(remaining)) setAttemptsRemaining(remaining);
      setLookup(res.data);
      lastResolvedCodeRef.current = c;
      setConfirmPolicy(false);
      setConfirmTerms(false);
      setReason("");
    } catch (e: any) {
      setLookup(null);
      lastResolvedCodeRef.current = "";
      const headers = e?.response?.headers || {};
      const remaining = Number(headers["ratelimit-remaining"] ?? headers["x-ratelimit-remaining"]);
      if (Number.isFinite(remaining)) setAttemptsRemaining(remaining);
      if (e?.response?.status === 429) {
        setAttemptsRemaining(0);
        const until = Date.now() + 60 * 60_000; // 1-hour lockout
        setRateLimitedUntil(until);
        setError("Too many failed attempts. Validation is locked for 1 hour.");
      } else {
        setError(e?.response?.data?.error || "Failed to validate booking code.");
      }
    } finally {
      setLoadingLookup(false);
    }
  }

  function pickBooking(bookingCode: string) {
    setCode(bookingCode);
    void doLookup(bookingCode);
  }

  function resetLookup() {
    setCode("");
    setLookup(null);
    setError(null);
    setSuccess(null);
    lastResolvedCodeRef.current = "";
  }

  async function submitRequest() {
    if (!lookup) return;
    if (lookup.existingRequest) {
      setError("A cancellation request has already been submitted for this booking code. Each booking code can only be used once for cancellation requests.");
      return;
    }
    if (!lookup.eligibility.eligible) {
      setError("This booking does not qualify for platform cancellation. Please contact us directly via email for assistance.");
      return;
    }
    if (!confirmPolicy) {
      setError("You must read and agree to the cancellation policy to proceed.");
      return;
    }
    if (!confirmTerms) {
      setError("You must read and agree to the terms and conditions to proceed.");
      return;
    }
    const wordCount = countWords(reason);
    if (!reason.trim()) {
      setError("Please provide a reason for cancellation (50-100 words required).");
      return;
    }
    if (wordCount < 50) {
      setError(`Your cancellation reason must be at least 50 words. You have ${wordCount} word${wordCount !== 1 ? "s" : ""}.`);
      return;
    }
    if (wordCount > 100) {
      setError(`Your cancellation reason must not exceed 100 words. You have ${wordCount} words.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post("/api/customer/cancellations/request", {
        code: lookup.booking.bookingCode,
        reason,
        confirmPolicy: true,
      });
      setSuccess(res.data?.request || { id: 0, status: "SUBMITTED" });
      await loadMyRequests();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to submit cancellation request.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived view state ─────────────────────────────────────────────────
  const words = countWords(reason);
  const wordsOk = words >= 50 && words <= 100;
  const eligible = Boolean(lookup?.eligibility.eligible) && !lookup?.existingRequest;
  const refundPct = lookup?.eligibility.refundPercent;
  const refundAmount = lookup && typeof refundPct === "number" ? (Number(lookup.booking.totalAmount || 0) * refundPct) / 100 : null;
  const activeTier = !lookup || lookup.existingRequest ? -1 : !lookup.eligibility.eligible ? 2 : refundPct === 100 ? 0 : refundPct === 50 ? 1 : -1;
  const hoursToCheckIn = lookup ? Math.round((new Date(lookup.booking.checkIn).getTime() - Date.now()) / 3_600_000) : null;
  const checkInLabel =
    hoursToCheckIn == null ? null
    : hoursToCheckIn <= 0 ? "Check-in has passed"
    : hoursToCheckIn < 48 ? `Check-in in ${hoursToCheckIn} hours`
    : `Check-in in ${Math.floor(hoursToCheckIn / 24)} days`;
  const openClaims = myRequests.filter((r) => !["REFUNDED", "REJECTED"].includes(String(r.status))).length;
  const shownClaims = showAllClaims ? myRequests : myRequests.slice(0, 5);
  const step1: "done" | "current" = lookup ? "done" : "current";
  const step2: "done" | "current" | "waiting" = !lookup ? "waiting" : eligible ? "done" : "current";
  const step3: "done" | "current" | "waiting" = success ? "done" : eligible ? "current" : "waiting";

  return (
    <div id="cancel-desk" className="w-full min-w-0 space-y-4">
      <style>{`#cancel-desk, #cancel-desk * { box-sizing: border-box; }`}</style>
      <LayoutFrame />

      {/* ── Header band: the same family as My bookings ── */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0a1110] text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.8)]" style={{ isolation: "isolate" }}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(190,18,60,0.42), rgba(190,18,60,0))" }} />
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div className="min-w-0">
            <Link href="/account/bookings" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/60 no-underline transition-colors hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              My bookings
            </Link>
            <h1 className="m-0 mt-2 flex items-center gap-3 text-[26px] font-bold leading-tight text-white">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/30">
                <CalendarX2 className="h-5 w-5" aria-hidden />
              </span>
              Cancel a booking
            </h1>
            <p className="m-0 mt-1 max-w-xl text-[13.5px] text-white/60">
              See your refund before you decide. Requests are reviewed by the NoLSAF team, and refunds go back to the way you paid.
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <div className={`rounded-xl border border-solid px-3.5 py-2 ${openClaims > 0 ? "border-rose-400/30 bg-rose-500/10" : "border-white/10 bg-white/[0.04]"}`}>
              <div className={`text-[11px] font-semibold ${openClaims > 0 ? "text-rose-200/80" : "text-white/50"}`}>Open claims</div>
              <div className="text-[18px] font-bold leading-tight tabular-nums text-white">{openClaims}</div>
            </div>
            <Link
              href="/cancellation-policy"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-solid border-white/20 bg-white/5 px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-white/10"
            >
              <FileText className="h-4 w-4" aria-hidden />
              Policy
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* ── The request, in three steps ── */}
        <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
          <Step
            n={1}
            title="Choose the booking"
            hint={lookup ? undefined : "Pick an upcoming stay, or type the booking code from your confirmation."}
            state={step1}
          >
            {lookup ? (
              <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-bold text-slate-900">{lookup.booking.property.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      {formatDate(lookup.booking.checkIn)} to {formatDate(lookup.booking.checkOut)}
                    </span>
                    {[lookup.booking.property.district, lookup.booking.property.regionName].filter(Boolean).length ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" aria-hidden />
                        {[lookup.booking.property.district, lookup.booking.property.regionName].filter(Boolean).join(", ")}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="font-mono text-[12px] font-semibold text-slate-500">{lookup.booking.bookingCode}</div>
                    <div className="text-[14px] font-bold tabular-nums text-slate-900">{formatTZS(lookup.booking.totalAmount)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={resetLookup}
                    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-slate-300 bg-white px-3 text-[12.5px] font-semibold text-slate-700 transition-colors hover:border-slate-400"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {pickable.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {pickable.map((b) => (
                      <button
                        key={b.bookingCode}
                        type="button"
                        disabled={loadingLookup || !!rateLimitedUntil}
                        onClick={() => pickBooking(b.bookingCode)}
                        className="group flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-solid border-slate-200 bg-white p-3 text-left transition-colors hover:border-[#02665e]/50 hover:bg-[#02665e]/[0.03] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex h-11 w-11 flex-shrink-0 flex-col items-center justify-center rounded-lg bg-[#02665e]/[0.08] text-[#02665e]">
                          <span className="text-[9.5px] font-bold uppercase leading-none">{new Date(b.checkIn).toLocaleDateString("en-US", { month: "short" })}</span>
                          <span className="text-[16px] font-extrabold leading-tight tabular-nums">{new Date(b.checkIn).getDate()}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-slate-900">{b.title}</span>
                          <span className="block truncate text-[12px] text-slate-500">{b.place || "Upcoming stay"} · <span className="font-mono">{b.bookingCode}</span></span>
                        </span>
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 transition-colors group-hover:text-[#02665e]" aria-hidden />
                      </button>
                    ))}
                  </div>
                ) : null}

                <div>
                  {pickable.length > 0 ? <div className="mb-1.5 text-[12px] font-semibold text-slate-500">Or enter a booking code</div> : null}
                  <label
                    className={[
                      "flex h-12 items-center gap-2.5 rounded-xl border border-solid bg-white px-3.5 transition-[border-color,box-shadow]",
                      rateLimitedUntil
                        ? "cursor-not-allowed border-rose-300 bg-rose-50/60"
                        : "border-slate-300 hover:border-slate-400 focus-within:border-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]",
                    ].join(" ")}
                  >
                    {rateLimitedUntil ? <Lock className="h-4 w-4 flex-shrink-0 text-rose-500" aria-hidden /> : <Search className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden />}
                    <span className="sr-only">Booking code</span>
                    <input
                      value={code}
                      onChange={(e) => setCode(normalizeCode(e.target.value))}
                      placeholder="e.g. ABCD9F3A"
                      disabled={!!rateLimitedUntil}
                      autoComplete="off"
                      spellCheck={false}
                      className="h-full w-full min-w-0 border-0 bg-transparent p-0 font-mono text-[15px] font-semibold tracking-[0.12em] text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
                    />
                    {loadingLookup ? <LogoSpinner size="xs" className="h-4 w-4 flex-shrink-0" ariaLabel="Checking booking code" /> : null}
                  </label>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                    {rateLimitedUntil ? (
                      <span className="font-semibold text-rose-700">
                        Locked after too many tries. Try again in <span className="tabular-nums">{rateLimitCountdown}</span>.
                      </span>
                    ) : (
                      <span className="text-slate-400">{loadingLookup ? "Checking your code..." : "We check the code as soon as you finish typing."}</span>
                    )}
                    {attemptsRemaining !== null && !rateLimitedUntil ? (
                      <span className={`font-semibold tabular-nums ${attemptsRemaining <= 2 ? "text-rose-600" : "text-slate-500"}`}>
                        {attemptsRemaining} of {LOOKUP_LIMIT} tries left
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </Step>

          <Step
            n={2}
            title="See your refund"
            hint={lookup ? checkInLabel || undefined : "Your refund appears here once the booking is found."}
            state={step2}
          >
            {lookup ? (
              <div className="space-y-3">
                {lookup.existingRequest ? (
                  <div className="flex flex-col gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 sm:flex-row sm:items-center">
                    <Clock className="h-5 w-5 flex-shrink-0 text-amber-700" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold text-amber-950">A request is already open for this booking</div>
                      <div className="mt-0.5 text-[12.5px] text-amber-800">The team is reviewing it. You can follow it and reply from the claim.</div>
                    </div>
                    <Link
                      href={`/account/cancellations/${lookup.existingRequest.id}`}
                      className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg bg-amber-900 px-3.5 text-[12.5px] font-semibold text-white no-underline hover:bg-amber-950"
                    >
                      Open claim #{lookup.existingRequest.id}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                ) : (
                  <>
                    {/* The verdict, in money */}
                    <div className={`rounded-xl p-4 ring-1 ${eligible ? "bg-[#02665e]/[0.05] ring-[#02665e]/20" : "bg-slate-50 ring-slate-200"}`}>
                      <div className="text-[12px] font-semibold text-slate-500">{eligible ? "You would get back" : "Refund through the platform"}</div>
                      <div className={`mt-0.5 text-[26px] font-extrabold leading-tight tabular-nums ${eligible ? "text-[#02665e]" : "text-slate-500"}`}>
                        {eligible
                          ? refundAmount != null
                            ? formatTZS(refundAmount)
                            : "Reviewed case by case"
                          : "Not available"}
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-slate-500">
                        {eligible
                          ? typeof refundPct === "number"
                            ? `${refundPct}% of ${formatTZS(lookup.booking.totalAmount)}, back to the way you paid, 5 to 10 business days after approval.`
                            : "The team will confirm the amount when they review your request."
                          : "This booking is outside the refund windows or on non-refundable terms."}
                      </div>
                    </div>

                    {/* Where this booking sits in the policy */}
                    <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
                      {REFUND_TIERS.map((t, i) => {
                        const on = i === activeTier;
                        return (
                          <li
                            key={t.title}
                            className={[
                              "rounded-xl p-3 ring-1",
                              on ? (t.pct > 0 ? "bg-white ring-2 ring-[#02665e]" : "bg-white ring-2 ring-slate-400") : "bg-white ring-slate-200",
                            ].join(" ")}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-[13px] font-bold ${on ? "text-slate-900" : "text-slate-500"}`}>{t.title}</span>
                              {on ? (
                                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${t.pct > 0 ? "bg-[#02665e] text-white" : "bg-slate-600 text-white"}`}>Your booking</span>
                              ) : (
                                <span className="text-[11.5px] font-bold tabular-nums text-slate-400">{t.pct}%</span>
                              )}
                            </div>
                            <p className={`m-0 mt-1 text-[11.5px] leading-snug ${on ? "text-slate-600" : "text-slate-400"}`}>{t.rule}</p>
                          </li>
                        );
                      })}
                    </ol>

                    {!eligible ? (
                      <div className="flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-bold text-slate-900">Special circumstances?</div>
                          <div className="mt-0.5 text-[12.5px] text-slate-500">
                            Medical emergencies, travel restrictions and similar cases are reviewed by email, with documents.
                          </div>
                        </div>
                        <a
                          href={`mailto:${CANCELLATION_EMAIL}?subject=${encodeURIComponent(`Cancellation request - Booking ${lookup.booking.bookingCode}`)}`}
                          className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-[#02665e] px-4 text-[13px] font-semibold text-white no-underline hover:bg-[#014e47]"
                        >
                          <Mail className="h-4 w-4" aria-hidden />
                          Email the team
                        </a>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </Step>

          <Step
            n={3}
            title="Tell us why"
            hint={eligible ? "A short, honest reason helps the team decide quickly." : "Available once the booking qualifies for a refund."}
            state={step3}
            last
          >
            {success ? (
              <div className="flex flex-col gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200 sm:flex-row sm:items-center">
                <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-emerald-600" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold text-emerald-950">Request sent</div>
                  <div className="mt-0.5 text-[12.5px] text-emerald-800">Every reply from the team shows up in the claim, under Your claims.</div>
                </div>
                {success.id ? (
                  <Link
                    href={`/account/cancellations/${success.id}`}
                    className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-[12.5px] font-semibold text-white no-underline hover:bg-emerald-800"
                  >
                    Follow claim
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                ) : null}
              </div>
            ) : eligible ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="cancel-reason" className="sr-only">Reason for cancelling</label>
                  <textarea
                    id="cancel-reason"
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      if (error?.includes("cancellation reason") || error?.includes("words")) setError(null);
                    }}
                    placeholder="What changed? For example: dates moved, a family matter, travel plans cancelled..."
                    rows={5}
                    className="block w-full resize-none rounded-xl border border-solid border-slate-300 bg-white px-3.5 py-3 text-[14px] leading-relaxed text-slate-900 placeholder:text-slate-400 transition-[border-color,box-shadow] focus:border-[#02665e] focus:shadow-[0_0_0_3px_rgba(2,102,94,0.14)] focus:outline-none"
                  />
                  {/* Word meter: fills to 50, stays green to 100 */}
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="presentation">
                      <div
                        className={`h-full rounded-full transition-all ${words > 100 ? "bg-rose-500" : wordsOk ? "bg-[#02665e]" : "bg-amber-400"}`}
                        style={{ width: `${Math.min(100, (words / 100) * 100)}%` }}
                      />
                    </div>
                    <span className={`flex-shrink-0 text-[11.5px] font-semibold tabular-nums ${words > 100 ? "text-rose-600" : wordsOk ? "text-[#02665e]" : "text-slate-500"}`}>
                      {words < 50 ? `${words} of 50 words minimum` : words > 100 ? `${words - 100} over the 100 limit` : `${words} words, good`}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {[
                    {
                      checked: confirmPolicy,
                      set: (v: boolean) => {
                        setConfirmPolicy(v);
                        if (v && error?.includes("cancellation policy")) setError(null);
                      },
                      label: (
                        <>
                          I have read the{" "}
                          <Link href="/cancellation-policy" className="font-semibold text-[#02665e] underline underline-offset-2">cancellation policy</Link>{" "}
                          and understand this is a request for review.
                        </>
                      ),
                    },
                    {
                      checked: confirmTerms,
                      set: (v: boolean) => {
                        setConfirmTerms(v);
                        if (v && error?.includes("terms and conditions")) setError(null);
                      },
                      label: <>I agree to the terms and conditions.</>,
                    },
                  ].map((item, i) => (
                    <label key={i} className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-slate-200 transition-colors hover:ring-slate-300">
                      <input type="checkbox" checked={item.checked} onChange={(e) => item.set(e.target.checked)} className="sr-only" />
                      <span
                        aria-hidden
                        className={`mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] transition-colors ${
                          item.checked ? "bg-[#02665e] text-white" : "bg-white ring-1 ring-slate-300"
                        }`}
                      >
                        {item.checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="text-[13px] leading-snug text-slate-700">{item.label}</span>
                    </label>
                  ))}
                </div>

                <div className="flex flex-col-reverse gap-3 border-0 border-t border-solid border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
                    <ShieldCheck className="h-4 w-4 text-[#02665e]" aria-hidden />
                    Your booking stays active until the request is approved.
                  </span>
                  <button
                    type="button"
                    onClick={submitRequest}
                    disabled={submitting || !confirmPolicy || !confirmTerms || !wordsOk}
                    className="inline-flex h-11 flex-shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-rose-700 px-5 text-[14px] font-semibold text-white transition-colors hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {submitting ? <LogoSpinner size="xs" ariaLabel="Sending request" /> : null}
                    {submitting ? "Sending..." : "Send cancellation request"}
                  </button>
                </div>
              </div>
            ) : null}
          </Step>

          {error ? (
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-600" aria-hidden />
              <div className="min-w-0 flex-1 text-[13px] text-rose-800">{error}</div>
              <button type="button" aria-label="Dismiss" onClick={() => setError(null)} className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-rose-500 hover:bg-rose-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>

        {/* ── Side: claims and the rules in brief ── */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3.5">
              <h2 className="m-0 text-[14.5px] font-bold text-slate-900">Your claims</h2>
              {myRequests.length > 0 ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-bold tabular-nums text-slate-600">{myRequests.length}</span>
              ) : null}
            </div>
            {loadingRequests ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-slate-500">
                <LogoSpinner size="xs" className="h-4 w-4" ariaLabel="Loading claims" />
                Loading...
              </div>
            ) : myRequests.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <FileText className="h-5 w-5" aria-hidden />
                </span>
                <div className="mt-2.5 text-[13.5px] font-bold text-slate-900">No claims yet</div>
                <div className="mt-0.5 text-[12px] text-slate-500">Requests you send appear here with every reply.</div>
              </div>
            ) : (
              <>
                <ul className="m-0 list-none p-0">
                  {shownClaims.map((r: any) => {
                    const meta = CLAIM_STATUS[String(r.status)] || { label: String(r.status || "").replace(/_/g, " ").toLowerCase(), tone: "bg-slate-50 text-slate-600 ring-slate-200" };
                    return (
                      <li key={r.id} className="border-0 border-b border-solid border-slate-100 last:border-b-0">
                        <Link href={`/account/cancellations/${r.id}`} className="group flex items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-slate-50">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13.5px] font-semibold text-slate-900">{r.booking?.property?.title || `Booking ${r.bookingCode}`}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-slate-500">
                              <span className="font-mono">{r.bookingCode}</span>
                              {r.createdAt ? <span>· {formatDate(r.createdAt)}</span> : null}
                            </div>
                          </div>
                          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ring-1 ${meta.tone}`}>{meta.label}</span>
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {myRequests.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllClaims((v) => !v)}
                    className="w-full cursor-pointer border-0 border-t border-solid border-slate-100 bg-transparent px-4 py-2.5 text-[12.5px] font-semibold text-[#02665e] hover:bg-slate-50"
                  >
                    {showAllClaims ? "Show fewer" : `Show all ${myRequests.length}`}
                  </button>
                ) : null}
              </>
            )}
          </div>

          <div className="rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <h2 className="m-0 text-[14.5px] font-bold text-slate-900">How refunds work</h2>
            <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
              {REFUND_TIERS.map((t) => (
                <li key={t.title} className="flex gap-3">
                  <span className={`mt-0.5 w-10 flex-shrink-0 rounded-md py-0.5 text-center text-[11px] font-bold tabular-nums ${t.pct > 0 ? "bg-[#02665e]/[0.08] text-[#02665e]" : "bg-slate-100 text-slate-500"}`}>
                    {t.pct}%
                  </span>
                  <span className="text-[12.5px] leading-snug text-slate-600">{t.rule}</span>
                </li>
              ))}
              <li className="flex gap-3">
                <span className="mt-0.5 flex w-10 flex-shrink-0 justify-center text-slate-400">
                  <Clock className="h-4 w-4" aria-hidden />
                </span>
                <span className="text-[12.5px] leading-snug text-slate-600">Approved refunds reach your original payment method in 5 to 10 business days.</span>
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-0 border-t border-solid border-slate-100 pt-3 text-[12.5px]">
              <Link href="/cancellation-policy" className="font-semibold text-[#02665e] no-underline hover:underline">Read the full policy</Link>
              <a href={`mailto:${CANCELLATION_EMAIL}`} className="font-semibold text-slate-600 no-underline hover:underline">{CANCELLATION_EMAIL}</a>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
