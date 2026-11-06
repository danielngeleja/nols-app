"use client";

/**
 * NoLScope: Tanzania trip cost estimator.
 *
 * Five steps (basics, destinations, activities, style, estimate) beside a live
 * "Your trip" panel. The page is built to show what NoLSAF knows about travel
 * here: the visa fee for your passport the moment you pick it, how each
 * destination fits your travel month (best, peak or off-peak), a route whose
 * order drives transport pricing, and an itemised estimate that opens every
 * line (park by park, leg by leg, night by night) instead of one number.
 */

import DatePickerField from "@/components/DatePickerField";
import { openAdminReportPrintWindow, renderAndPrintAdminReport, updateAdminReportPrintWindowStatus } from "@/lib/adminReportPrint";
import { buildEstimatePrintHtml } from "@/lib/nolscopeEstimatePrint";
import {
  ESTIMATE_CATEGORIES,
  MONTHS,
  NATIONALITIES,
  cleanLabel,
  confidenceText,
  estimateInsights,
  estimatePrintInput,
  estimateReportPath,
  fmtDate,
  fmtUSD,
  monthRanges,
  parseMonths,
  seasonFit,
  type EstimateCategoryKey,
} from "@/lib/nolscopeEstimateReport";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BedDouble,
  Binoculars,
  Building2,
  Bus,
  Calculator,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  FileCheck,
  Globe,
  HandCoins,
  Info,
  Loader2,
  MapPin,
  Minus,
  Moon,
  Mountain,
  Plane,
  Plus,
  Receipt,
  RefreshCw,
  Route,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  TentTree,
  Ticket,
  Trees,
  TriangleAlert,
  Users,
  Waves,
  X,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Destination {
  code: string;
  name: string;
  region: string;
  destinationType: string;
  description?: string;
  popularity: number;
  avgStayDays?: number;
  nearestCity?: string;
  mainAirport?: string;
  accessDifficulty?: string;
  bestMonths: number[];
  peakMonths: number[];
  offPeakMonths: number[];
  imageUrl?: string;
}

interface Activity {
  code: string;
  name: string;
  category: string;
  basePrice?: number;
  description?: string;
  destinationCode?: string;
  destinationCodes?: string[];
}

interface VisaInfo {
  amount: number;
  currency: string;
  entries?: string;
  durationDays?: number;
  processingTime?: string;
  description?: string;
  fallback?: boolean;
}

interface BreakdownItem {
  total: number;
  range?: { min: number; max: number };
  detail?: any;
  note?: string;
}

interface EstimateResult {
  estimateId: number | null;
  /** Opaque es_ reference for the shareable printable report; null when the estimate was not saved. */
  reference?: string | null;
  currency: string;
  travelers: { adults: number; children: number; total: number };
  totalDays: number;
  destinations: string[];
  season: string;
  tier: string;
  breakdown: {
    visa: BreakdownItem & { perAdult?: number; entries?: string; durationDays?: number; processingTime?: string };
    parkFees: BreakdownItem;
    transport: BreakdownItem;
    activities: BreakdownItem;
    accommodation: BreakdownItem;
    tips: BreakdownItem & { percent?: number };
    travelInsurance: BreakdownItem & { percent?: number };
    serviceCharge: BreakdownItem & { percent?: number };
  };
  totalMin: number;
  totalAvg: number;
  totalMax: number;
  perAdultAvg: number;
  confidence: number;
  appliedRules?: { ruleName: string; seasonName: string; multiplier: number; description?: string }[];
  dataFreshness?: {
    lastUpdatedAt: string | null;
    updatedBy: string;
    categories: {
      visaFees: string | null;
      parkFees: string | null;
      transport: string | null;
      activities: string | null;
      pricingRules: string | null;
    };
  };
}

interface DestinationEntry {
  code: string;
  days: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const BRAND = "#02665e";

/** ISO-3166-1 alpha-2 code to emoji flag (🌍 for XX/unknown) */
function countryFlag(code: string): string {
  if (!code || code === "XX" || code.length !== 2) return "🌍";
  return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const TIERS = [
  { key: "budget", label: "Budget", sub: "Shared transport, guesthouses and budget lodges", Icon: TentTree, hex: "#16a34a" },
  { key: "standard", label: "Standard", sub: "Private transfers, mid-range lodges and hotels", Icon: BedDouble, hex: "#2563eb" },
  { key: "luxury", label: "Luxury", sub: "Luxury camps, private chefs and charter flights", Icon: Sparkles, hex: "#d97706" },
];

const TRANSPORT_OPTIONS = [
  { value: "any", label: "Best available", sub: "Cheapest route we know", Icon: Sparkles, hex: BRAND },
  { value: "shared-taxi", label: "Shared / public", sub: "Lowest cost", Icon: Users, hex: "#10b981" },
  { value: "private-car", label: "Private vehicle", sub: "Priced per vehicle", Icon: Car, hex: "#3b82f6" },
  { value: "flight", label: "Charter / flight", sub: "Fastest", Icon: Plane, hex: "#8b5cf6" },
  { value: "bus", label: "Bus / ferry", sub: "Scheduled services", Icon: Bus, hex: "#f59e0b" },
];

const CATEGORY_ICONS: Record<CategoryKey, typeof Globe> = {
  visa: FileCheck,
  parkFees: Mountain,
  transport: Route,
  activities: Binoculars,
  accommodation: BedDouble,
  tips: HandCoins,
  travelInsurance: Shield,
  serviceCharge: Receipt,
};

/** Cost categories, in the order they appear, each with its own colour (shared with the printable report). */
const CATEGORIES = ESTIMATE_CATEGORIES.map((c) => ({ ...c, Icon: CATEGORY_ICONS[c.key] }));

type CategoryKey = EstimateCategoryKey;

const STEPS = [
  { label: "Trip basics", Icon: Globe },
  { label: "Destinations", Icon: MapPin },
  { label: "Activities", Icon: Sparkles },
  { label: "Style", Icon: Mountain },
  { label: "Estimate", Icon: Calculator },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Each kind of place gets its own emblem and colour, so the cards are told apart at a glance. */
function destLook(dest: Destination): { Icon: typeof Globe; hex: string } {
  const t = dest.destinationType.toLowerCase();
  const n = dest.name.toLowerCase();
  if (n.includes("kilimanjaro") || n.includes("mount") || n.includes("meru")) return { Icon: Mountain, hex: "#7c3aed" };
  if (t.includes("island") || t.includes("beach") || t.includes("coast")) return { Icon: Waves, hex: "#0284c7" };
  if (n.includes("crater") || n.includes("ngorongoro") || t.includes("conservation")) return { Icon: Binoculars, hex: "#d97706" };
  if (t.includes("park") || t.includes("reserve")) return { Icon: Trees, hex: "#059669" };
  if (t.includes("city") || t.includes("town")) return { Icon: Building2, hex: "#475569" };
  return { Icon: Globe, hex: BRAND };
}

/** Each kind of activity keeps one colour everywhere it appears. */
function categoryLook(category: string): { hex: string } {
  const c = category.toLowerCase();
  if (c.includes("safari") || c.includes("wildlife") || c.includes("game")) return { hex: "#d97706" };
  if (c.includes("water") || c.includes("marine") || c.includes("beach") || c.includes("div")) return { hex: "#0284c7" };
  if (c.includes("cultur") || c.includes("heritage") || c.includes("history")) return { hex: "#e11d48" };
  if (c.includes("adventure") || c.includes("hik") || c.includes("trek") || c.includes("climb")) return { hex: "#7c3aed" };
  if (c.includes("food") || c.includes("culinary")) return { hex: "#ea580c" };
  return { hex: "#475569" };
}

function confidenceLabel(c: number) {
  const text = confidenceText(c);
  if (c >= 0.8) return { text, tone: "text-emerald-300" };
  if (c >= 0.6) return { text, tone: "text-amber-300" };
  return { text, tone: "text-rose-300" };
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function NolScopeEstimator() {
  const estimatorRef = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState(0);

  // Step 0: basics
  const [nationality, setNationality] = useState("TZ");
  const [startDate, setStartDate] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [natSearch, setNatSearch] = useState("");
  const [natOpen, setNatOpen] = useState(false);
  const natBtnRef = useRef<HTMLButtonElement>(null);
  const [natPortalPos, setNatPortalPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [visa, setVisa] = useState<VisaInfo | null>(null);
  const [visaLoading, setVisaLoading] = useState(false);

  // Step 1: destinations
  const [destinations, setDestinations] = useState<DestinationEntry[]>([]);
  const [availableDests, setAvailableDests] = useState<Destination[]>([]);
  const [loadingDests, setLoadingDests] = useState(true);

  // Step 2: activities
  const [availableActivities, setAvailableActivities] = useState<Activity[]>([]);
  const [loadingActs, setLoadingActs] = useState(false);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>("all");

  // Step 3: style
  const [tier, setTier] = useState("standard");
  const [transportPref, setTransportPref] = useState("any");

  // Step 4: result
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [estimateError, setEstimateError] = useState("");

  const travelMonth = startDate ? new Date(`${startDate}T00:00:00`).getMonth() + 1 : null;

  // ── nationality dropdown position (portal, so no card clips it) ────────────
  const computeNatPos = useCallback(() => {
    const el = natBtnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(Math.max(260, rect.width), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setNatPortalPos({ top: rect.bottom + 6, left, width });
  }, []);

  useEffect(() => {
    if (!natOpen) return;
    computeNatPos();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (natBtnRef.current?.contains(t)) return;
      if (document.querySelector("[data-nat-portal]")?.contains(t)) return;
      setNatOpen(false);
    };
    window.addEventListener("resize", computeNatPos);
    window.addEventListener("scroll", computeNatPos, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", computeNatPos);
      window.removeEventListener("scroll", computeNatPos, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [natOpen, computeNatPos]);

  // ── visa fee for the chosen passport, shown the moment it is picked ───────
  useEffect(() => {
    let alive = true;
    setVisaLoading(true);
    fetch(`/api/public/nolscope/visa-fee/${encodeURIComponent(nationality)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setVisa({
          amount: Number(d.amount) || 0,
          currency: d.currency || "USD",
          entries: d.entries,
          durationDays: d.durationDays,
          processingTime: d.processingTime,
          description: d.description,
          fallback: Boolean(d.fallback),
        });
      })
      .catch(() => {})
      .finally(() => alive && setVisaLoading(false));
    return () => {
      alive = false;
    };
  }, [nationality]);

  // ── destinations ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/public/nolscope/destinations")
      .then((r) => r.json())
      .then((d) =>
        setAvailableDests(
          (d.destinations ?? []).map((r: any) => ({
            code: r.destinationCode ?? r.code,
            name: r.displayName ?? r.destinationName ?? r.name,
            region: r.region ?? r.country ?? "",
            destinationType: r.destinationType ?? "",
            description: r.description ?? undefined,
            popularity: r.popularity ?? 0,
            avgStayDays: r.avgStayDays ?? undefined,
            nearestCity: r.nearestCity ?? undefined,
            mainAirport: r.mainAirport ?? undefined,
            accessDifficulty: r.accessDifficulty ?? undefined,
            bestMonths: parseMonths(r.bestMonths),
            peakMonths: parseMonths(r.peakMonths),
            offPeakMonths: parseMonths(r.offPeakMonths),
            imageUrl: r.imageUrl ?? undefined,
          }))
        )
      )
      .catch(() => {})
      .finally(() => setLoadingDests(false));
  }, []);

  // ── activities for the chosen destinations ────────────────────────────────
  const destCodesKey = useMemo(() => [...new Set(destinations.map((d) => d.code))].sort().join("|"), [destinations]);
  useEffect(() => {
    const codes = destCodesKey ? destCodesKey.split("|") : [];
    if (!codes.length) {
      setAvailableActivities([]);
      return;
    }
    setLoadingActs(true);
    Promise.all(
      codes.map((c) =>
        fetch(`/api/public/nolscope/activities?dest=${encodeURIComponent(c)}`)
          .then((r) => r.json())
          .then((d) =>
            (d.activities ?? []).map((a: any) => ({
              code: a.activityCode ?? a.code,
              name: a.activityName ?? a.name,
              category: a.category ?? "",
              basePrice: a.averageCost ?? a.basePrice ?? a.minCost ?? 0,
              description: a.description,
              destinationCode: c,
              destinationCodes: [c],
            }))
          )
          .catch(() => [] as Activity[])
      )
    )
      .then((groups) => {
        const seen = new Map<string, Activity>();
        const merged: Activity[] = [];
        for (const grp of groups) {
          for (const a of grp as Activity[]) {
            const key = a.code || a.name;
            const existing = seen.get(key);
            if (existing) {
              existing.destinationCodes = [...new Set([...(existing.destinationCodes ?? []), ...(a.destinationCodes ?? [])])];
            } else {
              seen.set(key, a);
              merged.push(a);
            }
          }
        }
        setAvailableActivities(merged);
        // Drop selections that no longer belong to any chosen destination
        setSelectedActivities((prev) => prev.filter((code) => merged.some((a) => a.code === code)));
      })
      .finally(() => setLoadingActs(false));
  }, [destCodesKey]);

  // ── derived ───────────────────────────────────────────────────────────────
  const destByCode = useMemo(() => {
    const map = new Map<string, Destination>();
    for (const d of availableDests) map.set(d.code.toUpperCase(), d);
    return map;
  }, [availableDests]);

  const totalNights = destinations.reduce((s, d) => s + d.days, 0);
  const travellers = adults + children;

  const activitiesByDestination = useMemo(
    () =>
      destinations
        .map((dest) => {
          const code = dest.code.toUpperCase();
          const activities = availableActivities.filter((a) =>
            (a.destinationCodes ?? []).some((c) => String(c).toUpperCase() === code)
          );
          return {
            code,
            days: dest.days,
            name: destByCode.get(code)?.name ?? cleanLabel(code),
            activities,
            selectedCount: activities.filter((a) => selectedActivities.includes(a.code)).length,
          };
        })
        .filter((g) => g.activities.length > 0),
    [availableActivities, destByCode, destinations, selectedActivities]
  );

  // Kinds of activity on offer for this route, with counts, for the filter chips
  const activityCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of availableActivities) counts.set(a.category || "Other", (counts.get(a.category || "Other") || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: cleanLabel(key), count }));
  }, [availableActivities]);

  // A filter left over from another route falls back to All
  useEffect(() => {
    if (activityFilter !== "all" && !activityCategories.some((c) => c.key === activityFilter)) setActivityFilter("all");
  }, [activityCategories, activityFilter]);

  const selectedActivityCost = useMemo(
    () =>
      availableActivities
        .filter((a) => selectedActivities.includes(a.code))
        .reduce((sum, a) => sum + (Number(a.basePrice) || 0), 0),
    [availableActivities, selectedActivities]
  );

  const canNext = useCallback((): boolean => {
    if (step === 0) return !!nationality && !!startDate && adults >= 1;
    if (step === 1) return destinations.length > 0 && destinations.every((d) => d.days >= 1);
    return step === 2 || step === 3;
  }, [step, nationality, startDate, adults, destinations]);

  // ── estimate ──────────────────────────────────────────────────────────────
  const runEstimate = useCallback(async () => {
    setLoadingEstimate(true);
    setLoadingStage(0);
    setEstimateError("");
    // Walk the named checks while the engine works; a short floor keeps the reveal from flashing
    const stageTimer = window.setInterval(() => setLoadingStage((s) => Math.min(s + 1, 4)), 550);
    const started = Date.now();
    const settle = async () => {
      const wait = Math.max(0, 2400 - (Date.now() - started));
      if (wait) await new Promise((r) => setTimeout(r, wait));
    };
    try {
      const res = await fetch("/api/public/nolscope/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nationality,
          destinations,
          startDate,
          travelers: { adults, children },
          transportPreference: transportPref,
          activities: selectedActivities,
          tier,
        }),
      });
      const data = await res.json();
      await settle();
      if (!res.ok) setEstimateError(data?.error ?? "We could not build this estimate.");
      else setResult(data);
    } catch {
      await settle();
      setEstimateError("Network error. Please try again.");
    } finally {
      window.clearInterval(stageTimer);
      setLoadingEstimate(false);
    }
  }, [nationality, destinations, startDate, adults, children, transportPref, selectedActivities, tier]);

  const focusEstimator = useCallback(() => {
    window.setTimeout(() => estimatorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, []);

  const goNext = () => {
    if (step === 3) {
      setStep(4);
      focusEstimator();
      void runEstimate();
    } else {
      setStep((s) => Math.min(s + 1, 4));
      focusEstimator();
    }
  };

  const goBack = () => {
    setStep((s) => Math.max(s - 1, 0));
    focusEstimator();
  };

  const goTo = (target: number) => {
    // Jump back to any finished step from the step bar or the trip panel
    if (target >= step || loadingEstimate) return;
    setStep(target);
    focusEstimator();
  };

  const restart = () => {
    setStep(0);
    setResult(null);
    setEstimateError("");
    focusEstimator();
  };

  const toggleDestination = (code: string) =>
    setDestinations((ds) => (ds.some((d) => d.code === code) ? ds.filter((d) => d.code !== code) : [...ds, { code, days: destByCode.get(code.toUpperCase())?.avgStayDays || 3 }]));

  const setNights = (code: string, days: number) =>
    setDestinations((ds) => ds.map((d) => (d.code === code ? { ...d, days: Math.max(1, Math.min(30, days)) } : d)));

  const moveDestination = (index: number, dir: -1 | 1) =>
    setDestinations((ds) => {
      const next = [...ds];
      const target = index + dir;
      if (target < 0 || target >= next.length) return ds;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const selectedNat = NATIONALITIES.find((n) => n.code === nationality) ?? NATIONALITIES[0];
  const filteredNats = NATIONALITIES.filter(
    (n) => n.label.toLowerCase().includes(natSearch.toLowerCase()) || n.code.toLowerCase().includes(natSearch.toLowerCase())
  );

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div ref={estimatorRef} id="nolscope-estimator" className="w-full scroll-mt-24">
      <style>{"#nolscope-estimator, #nolscope-estimator * { box-sizing: border-box; }"}</style>

      <StepBar current={step} onJump={goTo} />

      <div className={`grid gap-6 ${step < 4 ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        {/* ── Step card ── */}
        <div className="min-w-0 overflow-hidden rounded-xl border border-solid border-slate-300/80 bg-white shadow-[0_10px_30px_-24px_rgba(2,40,36,0.45)]">
          {/* Step 0: basics */}
          {step === 0 && (
            <StepPanel index={0} title="Tell us about your trip" sub="Your passport decides visa and park rates, so start there.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>Nationality</FieldLabel>
                  <button
                    ref={natBtnRef}
                    type="button"
                    onClick={() => {
                      setNatOpen((o) => !o);
                      computeNatPos();
                    }}
                    aria-expanded={natOpen}
                    className="flex h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-solid border-slate-300 bg-white px-3 text-left [font-family:inherit] transition hover:border-slate-400 focus:outline-none focus-visible:border-[#02665e] focus-visible:ring-4 focus-visible:ring-[#02665e]/10"
                  >
                    <span className="text-2xl leading-none" suppressHydrationWarning>{countryFlag(nationality)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{selectedNat.label}</span>
                    <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${natOpen ? "rotate-180" : ""}`} />
                  </button>
                  {typeof document !== "undefined" && natOpen && natPortalPos
                    ? createPortal(
                        // Portalled to <body>, outside the estimator's box-sizing scope, so every child sets border-box itself
                        <div
                          data-nat-portal
                          className="fixed z-[9999] box-border overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_18px_40px_-12px_rgba(15,23,42,0.35)] [&_*]:box-border"
                          style={{ top: natPortalPos.top, left: natPortalPos.left, width: natPortalPos.width }}
                        >
                          <div className="border-0 border-b border-solid border-slate-100 p-2">
                            <input
                              autoFocus
                              type="text"
                              value={natSearch}
                              onChange={(e) => setNatSearch(e.target.value)}
                              placeholder="Search country"
                              className="block h-10 w-full rounded-lg border border-solid border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#02665e]/40 focus:bg-white focus:outline-none"
                            />
                          </div>
                          <div className="max-h-64 overflow-y-auto p-1">
                            {filteredNats.map((n) => (
                              <button
                                key={n.code}
                                type="button"
                                onClick={() => {
                                  setNationality(n.code);
                                  setNatOpen(false);
                                  setNatSearch("");
                                }}
                                className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 px-3 py-2 text-left text-sm transition ${
                                  nationality === n.code ? "bg-[#02665e]/[0.07] font-semibold text-[#02665e]" : "bg-transparent text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                <span className="text-xl leading-none" suppressHydrationWarning>{countryFlag(n.code)}</span>
                                <span className="min-w-0 flex-1 truncate">{n.label}</span>
                                {nationality === n.code ? <CheckCircle2 className="h-4 w-4 text-[#02665e]" /> : null}
                              </button>
                            ))}
                          </div>
                        </div>,
                        document.body
                      )
                    : null}
                </div>

                <div>
                  <FieldLabel>Travel start date</FieldLabel>
                  <DatePickerField
                    label="Travel start date"
                    value={startDate}
                    onChangeAction={setStartDate}
                    min={new Date().toISOString().slice(0, 10)}
                    widthClassName="w-full"
                    size="md"
                    allowPast={false}
                    twoMonths={false}
                    strongBorder
                    squared
                  />
                </div>
              </div>

              {/* What we already know about this traveller */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InsightCard Icon={FileCheck} hex="#0f766e" title="Your visa">
                  {visaLoading && !visa ? (
                    <span className="text-slate-400">Checking visa rules</span>
                  ) : visa ? (
                    visa.amount > 0 ? (
                      <>
                        <span className="font-bold text-slate-900">{fmtUSD(visa.amount)}</span> per adult
                        {visa.entries ? `, ${cleanLabel(visa.entries).toLowerCase()} entry` : ""}
                        {visa.durationDays ? `, ${visa.durationDays} days` : ""}
                        {visa.processingTime ? ` · ${cleanLabel(visa.processingTime).toLowerCase()}` : ""}
                      </>
                    ) : (
                      <span className="font-semibold text-emerald-700">No visa fee for this passport</span>
                    )
                  ) : (
                    <span className="text-slate-400">Visa details unavailable</span>
                  )}
                </InsightCard>
                <InsightCard Icon={Calendar} hex="#d97706" title="Your travel month">
                  {travelMonth ? (
                    <>
                      <span className="font-bold text-slate-900">{MONTHS[travelMonth - 1]}</span>. We will show how each destination fits it next.
                    </>
                  ) : (
                    <span className="text-slate-400">Pick a date to see seasons</span>
                  )}
                </InsightCard>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <CounterField label="Adults" sub="16 and over" value={adults} min={1} max={20} onChange={setAdults} />
                <CounterField label="Children" sub="under 16" value={children} min={0} max={10} onChange={setChildren} />
              </div>
            </StepPanel>
          )}

          {/* Step 1: destinations */}
          {step === 1 && (
            <StepPanel
              index={1}
              title="Where would you like to go?"
              sub={travelMonth ? `Each place is matched to ${MONTHS[travelMonth - 1]}, your travel month.` : "Pick one or more places and the nights for each."}
            >
              <div className="-mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-slate-500">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-[2px] bg-emerald-400" />Best months</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-[2px] bg-amber-400" />Peak months</span>
                {travelMonth ? <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-[2px] bg-slate-200 outline outline-2 outline-offset-1 outline-slate-900" />{MONTHS[travelMonth - 1]}, your month</span> : null}
              </div>
              {loadingDests ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-36 animate-pulse rounded-xl bg-slate-100" />
                  ))}
                </div>
              ) : (
                <>
                  {/* items-start: an open card grows on its own, its row-mates keep their height */}
                  <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {availableDests.map((dest) => {
                      const entry = destinations.find((d) => d.code === dest.code);
                      return (
                        <DestCard
                          key={dest.code}
                          dest={dest}
                          month={travelMonth}
                          order={entry ? destinations.indexOf(entry) + 1 : 0}
                          days={entry?.days ?? 0}
                          onToggle={() => toggleDestination(dest.code)}
                          onDaysChange={(days) => setNights(dest.code, days)}
                        />
                      );
                    })}
                  </div>

                  {/* The route: order matters, transport is priced leg by leg */}
                  {destinations.length > 1 ? (
                    <div className="rounded-2xl border border-solid border-[#02665e]/20 bg-[#02665e]/[0.04] p-4">
                      <div className="flex items-center gap-2">
                        <Route className="h-4 w-4 text-[#02665e]" aria-hidden />
                        <p className="m-0 text-[14px] font-bold text-slate-900">Your route</p>
                        <span className="text-[12px] text-slate-500">· transport is priced between each stop, in this order</span>
                      </div>
                      <ol className="m-0 mt-3 list-none space-y-2 p-0">
                        {destinations.map((d, i) => (
                          <li key={d.code} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200/80">
                            <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-[12px] font-black text-white">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-800">{destByCode.get(d.code.toUpperCase())?.name ?? d.code}</span>
                            <span className="text-[12px] tabular-nums text-slate-500">{d.days} night{d.days === 1 ? "" : "s"}</span>
                            <span className="flex gap-1">
                              <IconButton label="Move earlier" disabled={i === 0} onClick={() => moveDestination(i, -1)}>
                                <ArrowUp className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton label="Move later" disabled={i === destinations.length - 1} onClick={() => moveDestination(i, 1)}>
                                <ArrowDown className="h-3.5 w-3.5" />
                              </IconButton>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </>
              )}
            </StepPanel>
          )}

          {/* Step 2: activities */}
          {step === 2 && (
            <StepPanel index={2} title="What would you like to do?" sub="Optional. Skip it for a base trip cost.">
              {loadingActs ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
                  ))}
                </div>
              ) : activitiesByDestination.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-5 py-10 text-center">
                  <Sparkles className="mx-auto h-6 w-6 text-slate-300" />
                  <p className="m-0 mt-2 text-[14px] font-semibold text-slate-800">No activities listed for these places yet</p>
                  <p className="m-0 mt-1 text-[13px] text-slate-500">Continue for the base trip cost.</p>
                </div>
              ) : (
                <>
                  {/* Filter by kind of activity, so fewer choices show at once */}
                  {activityCategories.length > 1 ? (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Activity type">
                      {[{ key: "all", label: "All", count: availableActivities.length }, ...activityCategories].map((c) => {
                        const on = activityFilter === c.key;
                        const look = c.key === "all" ? null : categoryLook(c.key);
                        return (
                          <button
                            key={c.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setActivityFilter(c.key)}
                            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-solid px-2.5 text-[12.5px] font-semibold [font-family:inherit] transition-colors ${
                              on ? "border-[#02665e] bg-[#02665e]/[0.08] text-[#02665e]" : "border-slate-300/80 bg-white text-slate-700 hover:border-slate-400"
                            }`}
                          >
                            {look ? <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: look.hex }} /> : null}
                            {c.label}
                            <span className={`tabular-nums ${on ? "text-[#02665e]/70" : "text-slate-400"}`}>{c.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="space-y-5">
                    {activitiesByDestination.map((group) => {
                      const shown = group.activities.filter((a) => activityFilter === "all" || (a.category || "Other") === activityFilter);
                      if (!shown.length) return null;
                      const groupTotal = group.activities.filter((a) => selectedActivities.includes(a.code)).reduce((s, a) => s + (Number(a.basePrice) || 0), 0);
                      return (
                        <section key={group.code} aria-label={group.name}>
                          {/* Place heading: a line, not another box */}
                          <div className="mb-2 flex items-baseline justify-between gap-3">
                            <p className="m-0 flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-slate-900">
                              <MapPin className="h-3.5 w-3.5 flex-shrink-0 self-center text-[#02665e]" aria-hidden />
                              <span className="truncate">{group.name}</span>
                              <span className="flex-shrink-0 font-normal text-slate-400">· {group.days} night{group.days === 1 ? "" : "s"}</span>
                            </p>
                            <p className="m-0 flex-shrink-0 text-[12px] text-slate-500">
                              {groupTotal > 0 ? <span className="font-semibold tabular-nums text-[#02665e]">{fmtUSD(groupTotal)} · </span> : null}
                              {group.selectedCount} of {group.activities.length} added
                            </p>
                          </div>

                          {/* One list per place: tick, what it is, what it costs */}
                          <ul className="m-0 list-none overflow-hidden rounded-lg border border-solid border-slate-300/80 p-0">
                            {shown.map((act) => {
                              const on = selectedActivities.includes(act.code);
                              const look = categoryLook(act.category || "Other");
                              return (
                                <li key={`${group.code}-${act.code}`} className="border-0 border-t border-solid border-slate-100 first:border-t-0">
                                  <button
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => setSelectedActivities((prev) => (on ? prev.filter((c) => c !== act.code) : [...prev, act.code]))}
                                    className={`flex w-full cursor-pointer items-center gap-3 border-0 px-3.5 py-3 text-left [font-family:inherit] transition-colors ${
                                      on ? "bg-[#02665e]/[0.05]" : "bg-white hover:bg-slate-50"
                                    }`}
                                  >
                                    <span
                                      className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border border-solid ${
                                        on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white"
                                      }`}
                                    >
                                      {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[14px] font-semibold leading-snug text-slate-900">{act.name}</span>
                                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500">
                                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: look.hex }} />
                                        <span className="flex-shrink-0 font-medium text-slate-600">{cleanLabel(act.category || "Activity")}</span>
                                        {act.description ? <span className="hidden truncate sm:inline">· {act.description}</span> : null}
                                      </span>
                                    </span>
                                    {act.basePrice ? (
                                      <span className="flex-shrink-0 text-right leading-tight">
                                        <span className={`block text-[14.5px] font-bold tabular-nums ${on ? "text-[#02665e]" : "text-slate-900"}`}>{fmtUSD(act.basePrice)}</span>
                                        <span className="block text-[10.5px] text-slate-400">per person</span>
                                      </span>
                                    ) : null}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      );
                    })}
                  </div>

                  {/* Running total of what is chosen */}
                  {selectedActivities.length ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#02665e] px-4 py-3 text-white">
                      <p className="m-0 text-[13.5px]">
                        <span className="font-bold">{selectedActivities.length} activit{selectedActivities.length === 1 ? "y" : "ies"} chosen</span>
                        <span className="text-white/75"> · about {fmtUSD(selectedActivityCost)} per person</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setSelectedActivities([])}
                        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border-0 bg-white/15 px-3 text-[12.5px] font-semibold text-white [font-family:inherit] hover:bg-white/25"
                      >
                        <X className="h-3.5 w-3.5" /> Clear
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </StepPanel>
          )}

          {/* Step 3: style */}
          {step === 3 && (
            <StepPanel index={3} title="Travel style and transport" sub="These two choices move the estimate the most.">
              <div>
                <p className="m-0 mb-2.5 text-[14px] font-semibold text-slate-900">Where you sleep</p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="Where you sleep">
                  {TIERS.map((t, i) => {
                    const on = tier === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setTier(t.key)}
                        className={`relative flex cursor-pointer items-start gap-3 rounded-lg border border-solid p-3.5 text-left [font-family:inherit] transition-colors ${
                          on ? "border-[#02665e] bg-[#02665e]/[0.04] ring-1 ring-[#02665e]" : "border-slate-300/80 bg-white hover:border-slate-400"
                        }`}
                      >
                        <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md ${on ? "bg-[#02665e] text-white" : "bg-[#02665e]/[0.07] text-[#02665e]"}`}>
                          <t.Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1 pr-5">
                          <span className="flex items-baseline gap-2">
                            <span className="text-[14.5px] font-semibold text-slate-900">{t.label}</span>
                            {/* Relative cost at a glance */}
                            <span className="text-[12px] font-semibold tracking-wide" aria-label={["Lowest cost", "Mid cost", "Highest cost"][i] ?? undefined}>
                              <span className="text-[#02665e]">{"$".repeat(i + 1)}</span>
                              <span className="text-slate-300">{"$".repeat(Math.max(0, TIERS.length - i - 1))}</span>
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">{t.sub}</span>
                        </span>
                        <RadioDot on={on} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-0 border-t border-solid border-slate-100 pt-5">
                <p className="m-0 mb-2.5 text-[14px] font-semibold text-slate-900">How you move between places</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label="How you move between places">
                  {TRANSPORT_OPTIONS.map((opt) => {
                    const on = transportPref === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setTransportPref(opt.value)}
                        className={`relative flex cursor-pointer flex-col items-start gap-1 rounded-lg border border-solid px-3 py-2.5 text-left [font-family:inherit] transition-colors ${
                          on ? "border-[#02665e] bg-[#02665e]/[0.04] ring-1 ring-[#02665e]" : "border-slate-300/80 bg-white hover:border-slate-400"
                        }`}
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <opt.Icon className={`h-4 w-4 ${on ? "text-[#02665e]" : "text-slate-500"}`} aria-hidden />
                          <RadioDot on={on} inline />
                        </span>
                        <span className={`mt-0.5 text-[13px] font-semibold leading-tight ${on ? "text-[#02665e]" : "text-slate-800"}`}>{opt.label}</span>
                        <span className="text-[11px] leading-tight text-slate-500">{opt.sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </StepPanel>
          )}

          {/* Step 4: estimate */}
          {step === 4 && (
            <div className="p-5 sm:p-7">
              {loadingEstimate ? (
                <EstimateLoading stage={loadingStage} />
              ) : estimateError ? (
                <div className="py-12 text-center">
                  <TriangleAlert className="mx-auto h-8 w-8 text-rose-500" />
                  <p className="m-0 mt-3 font-semibold text-slate-900">{estimateError}</p>
                  <button
                    type="button"
                    onClick={() => void runEstimate()}
                    className="mt-4 inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 text-sm font-semibold text-white hover:bg-[#014d47]"
                  >
                    <RefreshCw className="h-4 w-4" /> Try again
                  </button>
                </div>
              ) : result ? (
                <ResultView
                  result={result}
                  nationality={nationality}
                  destByCode={destByCode}
                  route={destinations}
                  startDate={startDate}
                  month={travelMonth}
                  transportPref={transportPref}
                  onChangeStyle={() => goTo(3)}
                  onRestart={restart}
                />
              ) : null}
            </div>
          )}

          {/* Navigation */}
          {step < 4 ? (
            <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-7">
              <button
                type="button"
                onClick={goBack}
                suppressHydrationWarning
                disabled={step === 0}
                className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 [font-family:inherit] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <span className="hidden text-[12px] text-slate-400 sm:block">Step {step + 1} of {STEPS.length}</span>
              <button
                type="button"
                onClick={goNext}
                suppressHydrationWarning
                disabled={!canNext()}
                className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-6 text-sm font-semibold text-white [font-family:inherit] transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-[#02665e]/35"
              >
                {step === 3 ? (
                  <>
                    <Calculator className="h-4 w-4" /> Build my estimate
                  </>
                ) : step === 2 && selectedActivities.length === 0 ? (
                  <>
                    Skip activities <ArrowRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Continue <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          ) : null}
        </div>

        {/* ── Live trip panel ── */}
        {step < 4 ? (
          <aside className="h-fit space-y-3 lg:sticky lg:top-24">
            <TripPanel
              step={step}
              nationalityLabel={selectedNat.label}
              flag={countryFlag(nationality)}
              visa={visa}
              startDate={startDate}
              adults={adults}
              childCount={children}
              destinations={destinations}
              destByCode={destByCode}
              month={travelMonth}
              totalNights={totalNights}
              activityCount={selectedActivities.length}
              activityCost={selectedActivityCost * Math.max(1, adults)}
              tier={tier}
              transportPref={transportPref}
              onJump={goTo}
            />
            <p className="m-0 flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-slate-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" />
              Rates come from official park and immigration tariffs and operator surveys, kept by the NoLSAF Research Team.
            </p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

// ─── Layout pieces ─────────────────────────────────────────────────────────────

function StepBar({ current, onJump }: { current: number; onJump: (i: number) => void }) {
  // A light progress stepper: square markers joined by lines that fill as you
  // pass each step. Finished steps are buttons back; the rest are plain labels.
  return (
    <nav aria-label="Estimate steps" className="mb-6 rounded-xl border border-solid border-slate-300/80 bg-white px-3 py-3 sm:px-5">
      <ol className="m-0 flex list-none items-center p-0">
        {STEPS.map(({ label }, i) => {
          const done = i < current;
          const active = i === current;
          const last = i === STEPS.length - 1;
          return (
            <li key={label} className={`flex min-w-0 items-center ${last ? "" : "flex-1"}`}>
              <button
                type="button"
                onClick={() => onJump(i)}
                suppressHydrationWarning
                disabled={!done}
                aria-current={active ? "step" : undefined}
                aria-label={done ? `Back to ${label}` : `Step ${i + 1}: ${label}`}
                className={`group inline-flex min-w-0 items-center gap-2 rounded-md border-0 bg-transparent p-0.5 [font-family:inherit] ${done ? "cursor-pointer" : "cursor-default"}`}
              >
                <span
                  className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[11.5px] font-bold tabular-nums transition-colors ${
                    done
                      ? "bg-[#02665e] text-white group-hover:bg-[#014d47]"
                      : active
                        ? "bg-[#02665e] text-white ring-4 ring-[#02665e]/15"
                        : "border border-solid border-slate-300 bg-white text-slate-400"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={`truncate text-[13px] font-semibold ${active ? "block text-slate-900" : "hidden sm:block"} ${
                    done ? "text-[#02665e] group-hover:underline" : active ? "" : "text-slate-400"
                  }`}
                >
                  {label}
                </span>
              </button>
              {!last && (
                <span aria-hidden className={`mx-2 h-px min-w-3 flex-1 sm:mx-3 ${done ? "bg-[#02665e]" : "bg-slate-200"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Single-choice marker for radio cards: a small ring, filled in brand green when chosen. */
function RadioDot({ on, inline = false }: { on: boolean; inline?: boolean }) {
  return (
    <span
      aria-hidden
      className={`${inline ? "" : "absolute right-3 top-3.5 "}inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-solid ${
        on ? "border-[#02665e] bg-[#02665e]" : "border-slate-300 bg-white"
      }`}
    >
      {on ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
    </span>
  );
}

function StepPanel({ index, title, sub, children }: { index: number; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="border-0 border-b border-solid border-slate-100 px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
        <p className="m-0 text-[12px] font-bold text-[#02665e]">Step {index + 1} of {STEPS.length}</p>
        <h2 className="m-0 mt-0.5 text-[20px] font-bold leading-tight tracking-tight text-slate-950 sm:text-[22px]">{title}</h2>
        {sub ? <p className="m-0 mt-1 text-[13.5px] text-slate-500">{sub}</p> : null}
      </div>
      <div className="flex flex-col gap-5 p-5 sm:p-7">{children}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-600">{children}</span>;
}

function InsightCard({ Icon, hex, title, children }: { Icon: typeof Globe; hex: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200">
      <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${hex}14`, color: hex }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 leading-snug">
        <p className="m-0 text-[11.5px] font-semibold text-slate-500">{title}</p>
        <p className="m-0 mt-0.5 text-[13px] text-slate-700">{children}</p>
      </div>
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      suppressHydrationWarning
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 transition hover:border-[#02665e]/40 hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function CounterField({ label, sub, value, min, max, onChange }: { label: string; sub?: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-solid border-slate-300 bg-white px-4 py-3">
      <div className="leading-tight">
        <span className="block text-[14px] font-semibold text-slate-800">{label}</span>
        {sub ? <span className="text-[11.5px] text-slate-400">{sub}</span> : null}
      </div>
      <div className="inline-flex items-center overflow-hidden rounded-md border border-solid border-slate-300 bg-white">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(min, value - 1))}
          suppressHydrationWarning
          disabled={value <= min}
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center border-0 bg-transparent text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#02665e] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="flex h-9 w-9 items-center justify-center border-0 border-x border-solid border-slate-200 text-[15px] font-bold tabular-nums text-slate-900">{value}</span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(Math.min(max, value + 1))}
          suppressHydrationWarning
          disabled={value >= max}
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center border-0 bg-transparent text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#02665e] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** A 12-month strip: best months green, peak months amber, the travel month outlined. */
function MonthStrip({ dest, month }: { dest: Destination; month: number | null }) {
  if (!dest.bestMonths.length && !dest.peakMonths.length) return null;
  // Twelve small cells; the travel month is outlined in place, so there is no
  // floating marker to read around. The legend sits in the step header.
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {MONTHS.map((m, i) => {
        const n = i + 1;
        const tone = dest.peakMonths.includes(n) ? "bg-amber-400" : dest.bestMonths.includes(n) ? "bg-emerald-400" : "bg-slate-200";
        const isTravel = month === n;
        return (
          <span
            key={m}
            className={`flex-1 rounded-[2px] ${tone} ${isTravel ? "h-3 outline outline-2 outline-offset-1 outline-slate-900" : "h-2"}`}
          />
        );
      })}
    </span>
  );
}

function DestCard({
  dest,
  month,
  order,
  days,
  onToggle,
  onDaysChange,
}: {
  dest: Destination;
  month: number | null;
  order: number;
  days: number;
  onToggle: () => void;
  onDaysChange: (days: number) => void;
}) {
  const selected = order > 0;
  const { Icon } = destLook(dest);
  const fit = seasonFit(dest, month);
  const best = monthRanges(dest.bestMonths);
  const typical = dest.avgStayDays || 0;
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-solid bg-white transition-colors ${
        selected ? "border-[#02665e] ring-1 ring-[#02665e]" : "border-slate-300/80 hover:border-slate-400"
      }`}
    >
      <button type="button" onClick={onToggle} aria-pressed={selected} className="flex w-full cursor-pointer flex-col border-0 bg-transparent p-0 text-left [font-family:inherit]">
        {dest.imageUrl ? (
          <span className="relative block h-28 w-full overflow-hidden bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dest.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            <span className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </span>
        ) : null}

        {/* Header: what the place is, and whether it is in the trip (its stop number when it is) */}
        <span className="flex items-start gap-3 px-3.5 pb-2.5 pt-3.5">
          <span
            className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
              selected ? "bg-[#02665e] text-white" : "bg-[#02665e]/[0.07] text-[#02665e]"
            }`}
          >
            {selected ? <span className="text-[13px] font-bold tabular-nums">{order}</span> : <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold leading-snug text-slate-900">{dest.name}</span>
            <span className="mt-0.5 block truncate text-[12px] text-slate-500">
              {[cleanLabel(dest.destinationType), dest.region, typical ? `${typical} nights typical` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span
            className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border border-solid ${
              selected ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white"
            }`}
          >
            {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
          </span>
        </span>

        {/* Season: how your month fits, when it is best, and the year at a glance */}
        <span className="block px-3.5 pb-3.5">
          <span className="mb-2 flex items-center justify-between gap-3">
            {fit ? (
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${fit.tone}`}>
                {month ? `${MONTHS[month - 1].slice(0, 3)} · ` : ""}{fit.label}
              </span>
            ) : (
              <span className="text-[11.5px] text-slate-400">Pick a date to see the season</span>
            )}
            {best ? <span className="truncate text-[11.5px] text-slate-500">Best {best}</span> : null}
          </span>
          <MonthStrip dest={dest} month={month} />
        </span>
      </button>

      {selected ? (
        <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-[#02665e]/15 bg-[#02665e]/[0.04] px-3.5 py-2.5">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
              <Moon className="h-3.5 w-3.5 text-[#02665e]" aria-hidden /> Nights here
            </span>
            {typical ? (
              days === typical ? (
                <span className="mt-0.5 flex items-center gap-1 text-[11.5px] font-medium text-[#02665e]">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> Typical stay
                </span>
              ) : (
                <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-slate-500">
                  Most stay {typical}
                  <button
                    type="button"
                    onClick={() => onDaysChange(typical)}
                    className="cursor-pointer border-0 bg-transparent p-0 text-[11.5px] font-semibold text-[#02665e] underline-offset-2 [font-family:inherit] hover:underline"
                  >
                    Use {typical}
                  </button>
                </span>
              )
            ) : null}
          </span>
          <div className="inline-flex flex-shrink-0 items-center overflow-hidden rounded-md border border-solid border-slate-300 bg-white">
            <button type="button" aria-label="Fewer nights" onClick={() => onDaysChange(days - 1)} disabled={days <= 1} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center border-0 bg-transparent text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="flex h-8 w-9 items-center justify-center border-0 border-x border-solid border-slate-200 text-[14px] font-bold tabular-nums text-slate-900" aria-live="polite">
              {days}
            </span>
            <button type="button" aria-label="More nights" onClick={() => onDaysChange(days + 1)} disabled={days >= 30} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center border-0 bg-transparent text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TripPanel({
  step,
  nationalityLabel,
  flag,
  visa,
  startDate,
  adults,
  childCount,
  destinations,
  destByCode,
  month,
  totalNights,
  activityCount,
  activityCost,
  tier,
  transportPref,
  onJump,
}: {
  step: number;
  nationalityLabel: string;
  flag: string;
  visa: VisaInfo | null;
  startDate: string;
  adults: number;
  childCount: number;
  destinations: DestinationEntry[];
  destByCode: Map<string, Destination>;
  month: number | null;
  totalNights: number;
  activityCount: number;
  activityCost: number;
  tier: string;
  transportPref: string;
  onJump: (i: number) => void;
}) {
  const endDate = startDate && totalNights ? new Date(new Date(`${startDate}T00:00:00`).getTime() + totalNights * 86_400_000) : null;
  const dateText = startDate
    ? `${new Date(`${startDate}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${endDate ? ` to ${endDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}`
    : "";
  const rows: Array<{ i: number; label: string; Icon: typeof Globe; value: React.ReactNode; empty: boolean }> = [
    {
      i: 0,
      label: "Travellers",
      Icon: Users,
      value: (
        <>
          <span suppressHydrationWarning>{flag}</span> {nationalityLabel} · {adults} adult{adults === 1 ? "" : "s"}
          {childCount ? `, ${childCount} child${childCount === 1 ? "" : "ren"}` : ""}
        </>
      ),
      empty: false,
    },
    { i: 0, label: "Dates", Icon: Calendar, value: dateText || "Not set", empty: !startDate },
    {
      i: 0,
      label: "Visa",
      Icon: FileCheck,
      value: visa ? (visa.amount > 0 ? `${fmtUSD(visa.amount * adults)} for ${adults} adult${adults === 1 ? "" : "s"}` : "No visa fee") : "Checking",
      empty: !visa,
    },
    {
      i: 1,
      label: "Route",
      Icon: Route,
      value: destinations.length ? `${destinations.length} place${destinations.length === 1 ? "" : "s"} · ${totalNights} night${totalNights === 1 ? "" : "s"}` : "Not chosen yet",
      empty: !destinations.length,
    },
    {
      i: 2,
      label: "Activities",
      Icon: Sparkles,
      value: activityCount ? `${activityCount} chosen · about ${fmtUSD(activityCost)}` : step > 2 ? "None, base cost only" : "Not chosen yet",
      empty: !activityCount && step <= 2,
    },
    {
      i: 3,
      label: "Style",
      Icon: BedDouble,
      value: step >= 3 ? `${cleanLabel(tier)} · ${TRANSPORT_OPTIONS.find((o) => o.value === transportPref)?.label ?? "Best available"}` : "Not chosen yet",
      empty: step < 3,
    },
  ];
  const ready = rows.filter((r) => !r.empty).length;
  return (
    <div className="overflow-hidden rounded-xl border border-solid border-slate-300/80 bg-white">
      {/* Header: what the trip is so far, and how complete it is */}
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="m-0 text-[15px] font-semibold text-slate-950">Your trip</p>
          <span className="text-[11.5px] font-medium tabular-nums text-slate-500">
            {ready} of {rows.length} ready
          </span>
        </div>
        <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">{destinations.length ? `${totalNights} night${totalNights === 1 ? "" : "s"} in Tanzania` : "Fill in the steps to build it"}</p>
        <div className="mt-2.5 h-1 overflow-hidden rounded-sm bg-slate-100">
          <div className="h-full rounded-sm bg-[#02665e] transition-all duration-500" style={{ width: `${(ready / rows.length) * 100}%` }} />
        </div>
      </div>

      {/* Summary lines: label left, value right; finished steps open for editing */}
      <div className="border-0 border-t border-solid border-slate-100">
        {rows.map((row) => {
          const clickable = row.i < step;
          const body = (
            <>
              <span className="w-[76px] flex-shrink-0 text-[12px] text-slate-500">{row.label}</span>
              <span className={`block min-w-0 flex-1 truncate text-right text-[12.5px] ${row.empty ? "text-slate-400" : "font-semibold text-slate-900"} ${clickable ? "group-hover:hidden" : ""}`}>
                {row.value}
              </span>
              {clickable ? <span className="hidden flex-1 text-right text-[12.5px] font-semibold text-[#02665e] group-hover:block">Edit</span> : null}
            </>
          );
          return clickable ? (
            <button
              key={row.label}
              type="button"
              onClick={() => onJump(row.i)}
              title={`Edit ${row.label.toLowerCase()}`}
              className="group flex w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-slate-100 bg-transparent px-4 py-2.5 text-left [font-family:inherit] last:border-b-0 hover:bg-slate-50"
            >
              {body}
            </button>
          ) : (
            <div key={row.label} className="flex items-center gap-3 border-0 border-b border-solid border-slate-100 px-4 py-2.5 last:border-b-0">
              {body}
            </div>
          );
        })}
      </div>

      {destinations.length ? (
        <div className="border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-4 py-3">
          <p className="m-0 mb-2 text-[11.5px] font-medium text-slate-500">Route order</p>
          <ol className="m-0 list-none space-y-1.5 p-0">
            {destinations.map((d, i) => {
              const dest = destByCode.get(d.code.toUpperCase());
              const fit = dest ? seasonFit(dest, month) : null;
              return (
                <li key={d.code} className="flex items-center gap-2 text-[12.5px]">
                  <span className="inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded bg-[#02665e] text-[10.5px] font-bold tabular-nums text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{dest?.name ?? d.code}</span>
                  <span className="flex-shrink-0 text-[11px] tabular-nums text-slate-500">{d.days}n</span>
                  {fit ? <span className={`flex-shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${fit.tone}`}>{fit.label.replace(" to go", "")}</span> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** The engine's checks, ticked off in turn while the estimate is built. */
function EstimateLoading({ stage }: { stage: number }) {
  const checks = ["Visa rules for your passport", "Park fees for each stop", "Transport between stops", "Seasonal pricing for your month", "Accommodation and extras"];
  return (
    <div className="mx-auto max-w-md py-8">
      <div className="flex items-center gap-3">
        <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#02665e] text-white">
          <span className="absolute inset-0 animate-ping rounded-2xl bg-[#02665e]/30" />
          <Calculator className="relative h-6 w-6" />
        </span>
        <div>
          <p className="m-0 text-[18px] font-bold text-slate-950">Building your estimate</p>
          <p className="m-0 text-[13px] text-slate-500">Checking current rates for your exact trip.</p>
        </div>
      </div>
      <ol className="m-0 mt-5 list-none space-y-2 p-0">
        {checks.map((label, i) => {
          const done = i < stage;
          const active = i === stage;
          return (
            <li key={label} className={`flex items-center gap-3 rounded-xl border border-solid px-3.5 py-2.5 transition ${active ? "border-[#02665e]/30 bg-[#02665e]/[0.05]" : "border-slate-200 bg-white"}`}>
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${done ? "bg-[#02665e] text-white" : active ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-400"}`}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="text-[11px] font-bold">{i + 1}</span>}
              </span>
              <span className={`text-[13.5px] ${done ? "font-semibold text-slate-700" : active ? "font-semibold text-[#02665e]" : "text-slate-400"}`}>{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Result ────────────────────────────────────────────────────────────────────

function ResultView({
  result,
  nationality,
  destByCode,
  route,
  startDate,
  month,
  transportPref,
  onChangeStyle,
  onRestart,
}: {
  result: EstimateResult;
  nationality: string;
  destByCode: Map<string, Destination>;
  route: DestinationEntry[];
  startDate: string;
  month: number | null;
  transportPref: string;
  onChangeStyle: () => void;
  onRestart: () => void;
}) {
  const [open, setOpen] = useState<CategoryKey | null>("parkFees");
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);
  const conf = confidenceLabel(result.confidence);
  const nat = NATIONALITIES.find((n) => n.code === nationality) ?? NATIONALITIES[0];
  const nameOf = (code: string) => destByCode.get(String(code).toUpperCase())?.name ?? cleanLabel(code);
  const pax = Math.max(1, result.travelers.total);
  const perPersonPerDay = result.totalAvg / pax / Math.max(1, result.totalDays);
  const spread = Math.max(1, result.totalMax - result.totalMin);
  const avgPos = Math.min(100, Math.max(0, ((result.totalAvg - result.totalMin) / spread) * 100));

  const amounts = CATEGORIES.map((c) => ({ ...c, amount: Number((result.breakdown as any)[c.key]?.total) || 0 }));
  const sum = amounts.reduce((s, a) => s + a.amount, 0) || 1;
  const biggest = [...amounts].sort((a, b) => b.amount - a.amount)[0];

  // What to know before booking, drawn from the estimate's own detail
  const insights = estimateInsights(result, nameOf);
  const reportUrl = result.reference && typeof window !== "undefined" ? new URL(estimateReportPath(result.reference), window.location.origin).toString() : null;

  const staysHref = (() => {
    // The browse page runs one text search, so only a single destination filters usefully
    const names = (result.destinations || []).map((code) =>
      nameOf(code)
        .replace(/\s+(National Park|Conservation Area|Game Reserve|Nature Reserve|Archipelago|Islands?|Region|District)$/i, "")
        .replace(/^(Mount|Lake|River|Cape)\s+/i, "")
        .trim()
    );
    return names.length === 1 && names[0] ? `/public/properties?q=${encodeURIComponent(names[0])}` : "/public/properties";
  })();

  const copyLink = () => {
    // The saved report link reopens this exact estimate; the page URL alone would start a blank one
    navigator.clipboard?.writeText(reportUrl ?? window.location.href).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  // Print on the shared NoLSAF report template: a proper document, not a screenshot of this page
  const printEstimate = async () => {
    if (printing) return;
    const w = openAdminReportPrintWindow();
    if (!w) {
      window.print(); // pop-up blocked: fall back to printing the page
      return;
    }
    setPrinting(true);
    try {
      updateAdminReportPrintWindowStatus(w, "prepare");
      const origin = window.location.origin;
      // The QR on the document reopens this exact estimate when it was saved
      const verifyUrl = reportUrl ?? `${origin}/public/nolscope`;
      let qrDataUrl: string | null = null;
      try {
        const QRCode = (await import("qrcode")).default;
        qrDataUrl = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: "M", margin: 0, width: 320, color: { dark: "#073c35", light: "#ffffff" } });
      } catch {
        qrDataUrl = null;
      }
      updateAdminReportPrintWindowStatus(w, "preview");

      const html = buildEstimatePrintHtml(
        estimatePrintInput({
          result,
          route,
          startDate: startDate || null,
          month,
          transportPref,
          nationality,
          destByCode,
          logoUrl: new URL("/assets/NoLS2025-04.png", origin).toString(),
          verifyUrl,
          qrDataUrl,
          generatedAt: new Date(),
        })
      );
      await renderAndPrintAdminReport(w, html);
    } catch {
      if (!w.closed) w.close();
      window.print();
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── Headline ── */}
      <div className="overflow-hidden rounded-xl bg-[#024d47] text-white">
        <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_240px] md:gap-8">
          <div className="min-w-0">
            <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-white/70">
              Estimated trip cost · {pax} traveller{pax === 1 ? "" : "s"} ·
              <span className="inline-flex items-center gap-1 text-white/90">
                <span suppressHydrationWarning>{countryFlag(nationality)}</span> {nat.label}
              </span>
            </p>
            <p className="m-0 mt-1.5 text-[40px] font-bold leading-none tracking-tight tabular-nums">{fmtUSD(result.totalAvg)}</p>

            {/* Range with the estimate marked on it */}
            <div className="mt-4 max-w-md">
              <div className="relative h-1.5 rounded-sm bg-white/15">
                <span className="absolute inset-y-0 left-0 rounded-sm bg-emerald-300/60" style={{ width: `${avgPos}%` }} />
                <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-emerald-300" style={{ left: `${avgPos}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11.5px] tabular-nums text-white/60">
                <span>Low {fmtUSD(result.totalMin)}</span>
                <span>High {fmtUSD(result.totalMax)}</span>
              </div>
            </div>

            <p className="m-0 mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-white/75">
              <span>{result.totalDays} night{result.totalDays === 1 ? "" : "s"} · {cleanLabel(result.season)} season · {cleanLabel(result.tier)}</span>
              <span className={`rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold ${conf.tone}`}>{conf.text}</span>
            </p>
          </div>

          {/* Three figures that explain the total, divided by hairlines */}
          <dl className="m-0 grid grid-cols-3 self-center border-0 border-t border-solid border-white/10 pt-4 md:grid-cols-1 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            {[
              { label: "Per adult", value: fmtUSD(result.perAdultAvg) },
              { label: "Per person, per day", value: fmtUSD(perPersonPerDay) },
              { label: "Biggest cost", value: biggest ? `${biggest.label} · ${Math.round((biggest.amount / sum) * 100)}%` : "None" },
            ].map((f, i) => (
              <div key={f.label} className={`min-w-0 ${i > 0 ? "border-0 border-l border-solid border-white/10 pl-3 md:border-l-0 md:border-t md:pl-0 md:pt-3" : ""} ${i < 2 ? "pr-3 md:pb-3 md:pr-0" : ""}`}>
                <dt className="truncate text-[11px] text-white/60">{f.label}</dt>
                <dd className="m-0 mt-0.5 truncate text-[15px] font-semibold tabular-nums text-white">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Where the money goes: one segmented bar, then a legend you can open */}
        <div className="border-0 border-t border-solid border-white/10 bg-black/10 px-5 py-4 sm:px-6">
          <div className="flex h-2 gap-[2px] overflow-hidden rounded-sm">
            {amounts.map((a) => (a.amount > 0 ? <span key={a.key} title={`${a.label}: ${fmtUSD(a.amount)}`} style={{ width: `${(a.amount / sum) * 100}%`, backgroundColor: a.hex }} /> : null))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {amounts.filter((a) => a.amount > 0).map((a) => {
              const pct = (a.amount / sum) * 100;
              return (
                <button key={a.key} type="button" onClick={() => setOpen(a.key)} className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[11.5px] text-white/75 [font-family:inherit] hover:text-white">
                  <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: a.hex }} />
                  {a.label} <span className="font-semibold tabular-nums text-white">{pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Know before you book ── */}
      {(() => {
        // Split the engine's notes: legs we could not price become one list,
        // other cautions stay as bullets, and plain facts (rates applied,
        // fees included) drop to a quiet info line instead of a warning.
        const gaps: Array<[string, string]> = [];
        const cautions: string[] = [];
        const facts: string[] = [];
        for (const t of insights) {
          const m = t.match(/^No transport route found between (.+?) and (.+?)\./i);
          if (m) gaps.push([m[1], m[2]]);
          else if (/applied|included/i.test(t)) facts.push(t);
          else cautions.push(t);
        }
        if (!gaps.length && !cautions.length && !facts.length) return null;
        return (
          <div className="space-y-2">
            {gaps.length || cautions.length ? (
              <div className="rounded-lg border border-solid border-amber-300/70 bg-amber-50/70 px-4 py-3">
                <p className="m-0 flex items-center gap-2 text-[13.5px] font-semibold text-amber-950">
                  <TriangleAlert className="h-4 w-4 text-amber-600" aria-hidden /> Check before you book
                </p>
                {gaps.length ? (
                  <div className="mt-2">
                    <p className="m-0 text-[12.5px] text-amber-950/85">
                      Transport is not priced for {gaps.length === 1 ? "this leg" : `these ${gaps.length} legs`}. Ask operators for the fares:
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {gaps.map(([from, to]) => (
                        <span key={`${from}-${to}`} className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[12px] font-medium text-amber-950 ring-1 ring-inset ring-amber-200">
                          {from} <ArrowRight className="h-3 w-3 text-amber-500" aria-hidden /> {to}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {cautions.length ? (
                  <ul className="m-0 mt-2 list-none space-y-1 p-0">
                    {cautions.map((t) => (
                      <li key={t} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-amber-950/90">
                        <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-amber-500" />
                        {t}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {facts.length ? (
              <p className="m-0 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden />
                {facts.join(" · ")}
              </p>
            ) : null}
          </div>
        );
      })()}

      {/* ── Itemised breakdown: a cost table you can open line by line ── */}
      <div className="overflow-hidden rounded-xl border border-solid border-slate-300/80 bg-white">
        <div className="flex items-baseline justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3 sm:px-5">
          <p className="m-0 text-[15px] font-semibold text-slate-950">Line by line</p>
          <span className="text-[12px] text-slate-500">Open a line for the detail</span>
        </div>
        <ul className="m-0 list-none p-0">
          {amounts.map((cat) => {
            const item = (result.breakdown as any)[cat.key] as BreakdownItem | undefined;
            if (!item) return null;
            const isOpen = open === cat.key;
            const pct = (cat.amount / sum) * 100;
            // Transport at zero means legs we could not price, not free travel
            const unpriced = cat.key === "transport" && cat.amount === 0;
            return (
              <li key={cat.key} className="border-0 border-b border-solid border-slate-100 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : cat.key)}
                  aria-expanded={isOpen}
                  className={`flex w-full cursor-pointer items-center gap-3 border-0 px-4 py-3 text-left [font-family:inherit] transition-colors sm:px-5 ${isOpen ? "bg-slate-50" : "bg-transparent hover:bg-slate-50/70"}`}
                >
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-[3px]" style={{ backgroundColor: cat.hex }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-slate-900">{cat.label}</span>
                    <span className="mt-1.5 block h-1 max-w-[320px] overflow-hidden rounded-sm bg-slate-100">
                      <span className="block h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: cat.hex }} />
                    </span>
                  </span>
                  <span className="w-11 flex-shrink-0 text-right text-[12px] tabular-nums text-slate-400">
                    {cat.amount > 0 ? (pct < 1 ? "<1%" : `${Math.round(pct)}%`) : ""}
                  </span>
                  <span className={`w-24 flex-shrink-0 text-right text-[14.5px] font-semibold tabular-nums ${unpriced ? "text-[12.5px] font-medium text-amber-700" : "text-slate-950"}`}>
                    {unpriced ? "Not priced" : fmtUSD(cat.amount)}
                  </span>
                  <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {isOpen ? (
                  <div className="border-0 border-t border-solid border-slate-100 bg-slate-50 px-4 pb-4 pt-3 sm:px-5 sm:pl-[42px]">
                    <CategoryDetail cat={cat.key} result={result} nameOf={nameOf} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex items-baseline justify-between gap-3 border-0 border-t border-solid border-slate-200 bg-slate-50/60 px-4 py-3 sm:px-5">
          <span className="text-[13px] font-semibold text-slate-700">Estimated total</span>
          <span className="text-[16px] font-bold tabular-nums text-slate-950">{fmtUSD(result.totalAvg)}</span>
        </div>
      </div>

      {/* ── Seasonal pricing ── */}
      {result.appliedRules?.length ? (
        <div className="rounded-xl border border-solid border-slate-300/80 bg-white p-4 sm:p-5">
          <p className="m-0 text-[15px] font-semibold text-slate-950">Seasonal pricing applied</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {result.appliedRules.map((r, i) => (
              <div key={i} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-slate-900">{cleanLabel(r.seasonName)}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${r.multiplier > 1 ? "bg-amber-100 text-amber-900" : r.multiplier < 1 ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                    {r.multiplier > 1 ? `+${Math.round((r.multiplier - 1) * 100)}%` : r.multiplier < 1 ? `${Math.round((r.multiplier - 1) * 100)}%` : "Standard rate"}
                  </span>
                </div>
                <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-slate-600">{r.description || r.ruleName}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Where the numbers come from ── */}
      <div className="rounded-xl border border-solid border-[#02665e]/20 bg-[#02665e]/[0.04] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 flex items-center gap-2 text-[15px] font-semibold text-slate-950">
            <ShieldCheck className="h-5 w-5 text-[#02665e]" /> Where these numbers come from
          </p>
          {result.dataFreshness?.lastUpdatedAt ? (
            <span className="rounded bg-white px-2 py-0.5 text-[11.5px] font-semibold text-[#02665e] ring-1 ring-[#02665e]/20">
              Last verified {fmtDate(result.dataFreshness.lastUpdatedAt)}
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { label: "Park fees", ts: result.dataFreshness?.categories?.parkFees },
            { label: "Visa fees", ts: result.dataFreshness?.categories?.visaFees },
            { label: "Transport", ts: result.dataFreshness?.categories?.transport },
            { label: "Activities", ts: result.dataFreshness?.categories?.activities },
            { label: "Seasonal rules", ts: result.dataFreshness?.categories?.pricingRules },
            { label: "Accommodation", ts: null as string | null, fixed: "NoLSAF verified" },
          ].map((row) => (
            <div key={row.label} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/80">
              <p className="m-0 text-[12px] font-semibold text-slate-800">{row.label}</p>
              <p className="m-0 text-[11.5px] text-slate-500">{row.ts ? fmtDate(row.ts) : "fixed" in row && row.fixed ? row.fixed : "Not recorded"}</p>
            </div>
          ))}
        </div>
        <p className="m-0 mt-3 text-[12px] leading-relaxed text-slate-600">
          Sources: TANAPA official rates, Tanzania Immigration and operator market surveys, maintained by the NoLSAF Research Team. Final prices can change with availability, exchange rates and operator pricing.
          {result.estimateId ? <span className="font-semibold text-slate-700"> Ref EST-{result.estimateId}.</span> : null}
        </p>
      </div>

      {/* ── Next: book it, keep it, or change it ── */}
      <div className="overflow-hidden rounded-xl border border-solid border-slate-300/80 bg-white">
        <div className="grid gap-2.5 p-3.5 sm:grid-cols-2 sm:p-4">
          <a
            href={staysHref}
            className="group flex items-center gap-3 rounded-lg bg-[#02665e] px-4 py-3.5 text-white no-underline transition-colors hover:bg-[#014d47]"
          >
            <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-white/15">
              <BedDouble className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[14.5px] font-semibold">Find verified stays</span>
              <span className="mt-0.5 block text-[12px] text-white/75">Book the nights this estimate priced</span>
            </span>
            <ArrowRight className="h-5 w-5 flex-shrink-0 transition-transform group-hover:translate-x-0.5" />
          </a>
          <Link
            href="/public/tour-packages"
            className="group flex items-center gap-3 rounded-lg border border-solid border-slate-300/80 bg-white px-4 py-3.5 text-[#02665e] no-underline transition-colors hover:border-[#02665e]/40 hover:bg-[#02665e]/[0.03]"
          >
            <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-[#02665e]/[0.07]">
              <Ticket className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[14.5px] font-semibold text-slate-900">Compare tour packages</span>
              <span className="mt-0.5 block text-[12px] text-slate-500">Verified operators, all-in prices</span>
            </span>
            <ArrowRight className="h-5 w-5 flex-shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="grid grid-cols-2 border-0 border-t border-solid border-slate-100 sm:grid-cols-4">
          <ToolAction onClick={printEstimate} Icon={printing ? Loader2 : Download} spin={printing} label={printing ? "Preparing" : "Print or save PDF"} sub="Full itemised document" highlight />
          <ToolAction onClick={copyLink} Icon={copied ? CheckCircle2 : Copy} label={copied ? "Link copied" : "Copy link"} sub="Share this page" />
          <ToolAction onClick={onChangeStyle} Icon={ArrowLeft} label="Change style" sub="Try another level" />
          <ToolAction onClick={onRestart} Icon={RefreshCw} label="New estimate" sub="Start again" />
        </div>
      </div>
    </div>
  );
}

/** A tool in the action strip: icon tile, label, one-line purpose. */
function ToolAction({
  onClick,
  Icon,
  label,
  sub,
  spin,
  highlight,
}: {
  onClick: () => void;
  Icon: typeof Share2;
  label: string;
  sub: string;
  spin?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex cursor-pointer items-center gap-3 border-0 border-b border-r border-solid border-slate-100 bg-transparent px-4 py-3 text-left [font-family:inherit] transition-colors hover:bg-slate-50 sm:border-b-0"
    >
      <span
        className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
          highlight ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-600 group-hover:bg-[#02665e]/10 group-hover:text-[#02665e]"
        }`}
      >
        <Icon className={`h-4 w-4 ${spin ? "animate-spin" : ""}`} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13px] font-semibold text-slate-900">{label}</span>
        <span className="block truncate text-[11px] text-slate-500">{sub}</span>
      </span>
    </button>
  );
}

/** One category opened: the real rows behind its total. */
function CategoryDetail({ cat, result, nameOf }: { cat: CategoryKey; result: EstimateResult; nameOf: (code: string) => string }) {
  const b = result.breakdown as any;
  const range = b[cat]?.range as { min: number; max: number } | undefined;
  const Range = range ? (
    <p className="m-0 mt-2 text-[12px] text-slate-500">
      Likely range {fmtUSD(range.min)} to {fmtUSD(range.max)}
    </p>
  ) : null;
  const Note = ({ text }: { text?: string }) => (text ? <p className="m-0 mt-2 text-[12px] leading-relaxed text-slate-500">{text}</p> : null);

  if (cat === "visa") {
    const v = result.breakdown.visa;
    return (
      <div>
        <DetailGrid
          rows={[
            ["Per adult", fmtUSD(v.perAdult ?? 0)],
            ["Entry", cleanLabel(v.entries ?? "single")],
            ["Valid for", `${v.durationDays ?? 90} days`],
            ["Processing", cleanLabel(v.processingTime ?? "on arrival")],
          ]}
        />
        <Note text={v.note} />
      </div>
    );
  }

  if (cat === "parkFees") {
    const rows: any[] = Array.isArray(b.parkFees.detail) ? b.parkFees.detail : [];
    return (
      <div>
        {rows.length ? (
          <div className="space-y-2">
            {rows.map((p, i) => (
              <div key={i} className="rounded-md bg-white px-3 py-2.5 ring-1 ring-slate-200">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] font-semibold text-slate-900">{p.parkName || nameOf(p.destination)}</span>
                  <span className="text-[13.5px] font-semibold tabular-nums">{fmtUSD(p.subtotal)}</span>
                </div>
                <p className="m-0 mt-1 text-[12px] text-slate-600">
                  {p.days} day{p.days === 1 ? "" : "s"} · {fmtUSD(p.adultFeePerDay)} per adult per day · {cleanLabel(p.rateCategory)} rate
                  {p.vehicleFee ? ` · vehicle ${fmtUSD(p.vehicleFee)}` : ""}
                  {p.guideFee ? ` · guide ${fmtUSD(p.guideFee)}` : ""}
                </p>
                {p.note ? <p className="m-0 mt-1 text-[11.5px] font-semibold text-amber-700">{p.note}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[12.5px] text-slate-500">No park entry on this route.</p>
        )}
        {Range}
        <Note text={b.parkFees.note} />
      </div>
    );
  }

  if (cat === "transport") {
    const legs: any[] = Array.isArray(b.transport.detail) ? b.transport.detail : [];
    return (
      <div>
        {legs.length ? (
          <ol className="m-0 list-none space-y-2 p-0">
            {legs.map((l, i) => (
              <li key={i} className={`rounded-md px-3 py-2.5 ring-1 ${l.status === "no-data" ? "bg-amber-50 ring-amber-200" : "bg-white ring-slate-200/80"}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] font-semibold text-slate-900">
                    {nameOf(l.from)} <span className="text-slate-400">to</span> {nameOf(l.to)}
                  </span>
                  <span className="text-[13.5px] font-semibold tabular-nums">{l.legCostAvg != null ? fmtUSD(l.legCostAvg) : "Not priced"}</span>
                </div>
                <p className="m-0 mt-1 text-[12px] text-slate-600">
                  {l.status === "no-data"
                    ? l.note
                    : [
                        l.type ? cleanLabel(l.type) : null,
                        l.provider || null,
                        l.durationHours ? `about ${l.durationHours} h` : null,
                        l.unitCostAvg != null ? `${fmtUSD(l.unitCostAvg)} ${l.priceUnit === "per-vehicle" ? "per vehicle" : "per person"}` : null,
                        l.bookingLeadDays ? `book ${l.bookingLeadDays} days ahead` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
                {l.status !== "no-data" && l.note ? <p className="m-0 mt-1 text-[11.5px] text-slate-500">{l.note}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-[12.5px] text-slate-500">No transport legs priced.</p>
        )}
        {Range}
      </div>
    );
  }

  if (cat === "activities") {
    const acts: any[] = Array.isArray(b.activities.detail) ? b.activities.detail : [];
    return (
      <div>
        {acts.length ? (
          <div className="space-y-2">
            {acts.map((a, i) => (
              <div key={i} className="rounded-md bg-white px-3 py-2.5 ring-1 ring-slate-200">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] font-semibold text-slate-900">{a.activityName}</span>
                  <span className="text-[13.5px] font-semibold tabular-nums">{fmtUSD(a.totalCostAvg)}</span>
                </div>
                <p className="m-0 mt-1 text-[12px] text-slate-600">
                  {fmtUSD(a.unitCostAvg)} {a.priceUnit === "per-vehicle" ? "per vehicle" : a.priceUnit === "per-group" ? "per group" : "per adult"}
                  {a.category ? ` · ${cleanLabel(a.category)}` : ""}
                </p>
                {a.includes ? (
                  <p className="m-0 mt-1 text-[11.5px] text-slate-500">
                    <span className="font-semibold text-slate-600">Includes:</span> {Array.isArray(a.includes) ? a.includes.join(", ") : String(a.includes)}
                  </p>
                ) : null}
                {a.requirements ? (
                  <p className="m-0 mt-0.5 text-[11.5px] text-slate-500">
                    <span className="font-semibold text-slate-600">Needs:</span> {Array.isArray(a.requirements) ? a.requirements.join(", ") : String(a.requirements)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[12.5px] text-slate-500">No activities added. Go back to add some for a fuller estimate.</p>
        )}
        {Range}
      </div>
    );
  }

  if (cat === "accommodation") {
    const stays: any[] = Array.isArray(b.accommodation.detail) ? b.accommodation.detail : [];
    return (
      <div>
        {stays.length ? (
          <div className="space-y-2">
            {stays.map((s, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 rounded-md bg-white p-3 ring-1 ring-slate-200/80">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-slate-900">{nameOf(s.destination)}</span>
                  <span className="block text-[12px] text-slate-600">
                    {s.nights} night{s.nights === 1 ? "" : "s"} · {fmtUSD(s.perNightPerAdultAvg)} per adult per night · {cleanLabel(s.tier)}
                  </span>
                </span>
                <span className="text-[13.5px] font-semibold tabular-nums">{fmtUSD(s.subtotalAvg)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {Range}
        <Note text={b.accommodation.note} />
      </div>
    );
  }

  if (cat === "tips") {
    const d = (b.tips.detail || {}) as Record<string, number | undefined>;
    const rows: Array<[string, string]> = [];
    if (d.safariGuidesDrivers) rows.push(["Safari guides and drivers", fmtUSD(d.safariGuidesDrivers)]);
    if (d.accommodationStaff) rows.push(["Lodge and hotel staff", fmtUSD(d.accommodationStaff)]);
    if (d.activityGuides) rows.push(["Activity guides", fmtUSD(d.activityGuides)]);
    return (
      <div>
        {rows.length ? <DetailGrid rows={rows} /> : null}
        {Range}
        <Note text={b.tips.note} />
      </div>
    );
  }

  if (cat === "travelInsurance") {
    return (
      <div>
        <DetailGrid rows={[["Share of trip cost", `${b.travelInsurance.percent ?? 6}%`]]} />
        {Range}
        <Note text={b.travelInsurance.note} />
      </div>
    );
  }

  return (
    <div>
      <DetailGrid rows={[["Planning fee", `${b.serviceCharge.percent ?? 5}% of the trip cost`]]} />
      {Range}
      <Note text={b.serviceCharge.note} />
    </div>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {rows.map(([k, v]) => (
        <div key={k} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200/80">
          <dt className="text-[11px] font-semibold text-slate-500">{k}</dt>
          <dd className="m-0 mt-0.5 text-[13.5px] font-bold text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
