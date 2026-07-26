"use client";

/**
 * NoLScope — Trip Cost Estimator
 * Multi-step form: nationality + dates → destinations → activities → tier → results
 */

import DatePickerField from "@/components/DatePickerField";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Binoculars,
  Bus,
  Calculator,
  Calendar,
  Camera,
  Car,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Fish,
  Footprints,
  Globe,
  Info,
  Loader2,
  MapPin,
  Minus,
  Mountain,
  Palmtree,
  Plane,
  Plus,
  RefreshCw,
  Share2,
  Shield,
  Sparkles,
  TentTree,
  Users,
  UtensilsCrossed,
  Waves,
  Wine,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Destination {
  code: string;
  name: string;
  country: string;
  destinationType: string;
  description?: string;
  popularity: number;
  avgStayDays?: number;
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

interface BreakdownItem {
  total: number;
  range?: { min: number; max: number };
  detail?: unknown[];
  note?: string;
}

interface EstimateResult {
  estimateId: number | null;
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

const NATIONALITIES = [
  { code: "XX", label: "Other" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "IT", label: "Italy" },
  { code: "ES", label: "Spain" },
  { code: "NL", label: "Netherlands" },
  { code: "SE", label: "Sweden" },
  { code: "NO", label: "Norway" },
  { code: "DK", label: "Denmark" },
  { code: "CH", label: "Switzerland" },
  { code: "AT", label: "Austria" },
  { code: "BE", label: "Belgium" },
  { code: "PT", label: "Portugal" },
  { code: "PL", label: "Poland" },
  { code: "CZ", label: "Czech Republic" },
  { code: "AU", label: "Australia" },
  { code: "NZ", label: "New Zealand" },
  { code: "CA", label: "Canada" },
  { code: "JP", label: "Japan" },
  { code: "KR", label: "South Korea" },
  { code: "CN", label: "China" },
  { code: "IN", label: "India" },
  { code: "ZA", label: "South Africa" },
  { code: "NG", label: "Nigeria" },
  { code: "KE", label: "Kenya" },
  { code: "UG", label: "Uganda" },
  { code: "RW", label: "Rwanda" },
  { code: "TZ", label: "Tanzania (local)" },
  { code: "IL", label: "Israel" },
  { code: "SA", label: "Saudi Arabia" },
  { code: "AE", label: "UAE" },
  { code: "BR", label: "Brazil" },
  { code: "AR", label: "Argentina" },
  { code: "MX", label: "Mexico" },
];

/** Convert ISO-3166-1 alpha-2 code to emoji flag (returns 🌍 for XX/unknown) */
function countryFlag(code: string): string {
  if (!code || code === "XX" || code.length !== 2) return "🌍";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

const TIERS = [
  {
    key: "budget",
    label: "Budget",
    sub: "Shared transport, guesthouses & budget lodges",
    icon: "🏕️",
    color: "border-green-400 bg-green-50",
    badge: "bg-green-100 text-green-700",
    active: "ring-2 ring-green-500",
  },
  {
    key: "standard",
    label: "Standard",
    sub: "Private transfers, mid-range lodges & hotels",
    icon: "🏨",
    color: "border-blue-400 bg-blue-50",
    badge: "bg-blue-100 text-blue-700",
    active: "ring-2 ring-blue-500",
  },
  {
    key: "luxury",
    label: "Luxury",
    sub: "Luxury camps, private chefs & charter flights",
    icon: "✨",
    color: "border-amber-400 bg-amber-50",
    badge: "bg-amber-100 text-amber-700",
    active: "ring-2 ring-amber-500",
  },
];

const TRANSPORT_OPTIONS = [
  { value: "any", label: "Best available", icon: Sparkles, color: "#02665e" },
  { value: "shared-taxi", label: "Shared / public", icon: Users, color: "#10b981" },
  { value: "private-car", label: "Private vehicle", icon: Car, color: "#3b82f6" },
  { value: "flight", label: "Charter / flight", icon: Plane, color: "#8b5cf6" },
  { value: "bus", label: "Bus / ferry", icon: Bus, color: "#f59e0b" },
];

const DEST_ICONS: Record<string, React.ReactNode> = {
  island: <Waves className="w-4 h-4" />,
  park: <Mountain className="w-4 h-4" />,
  city: <MapPin className="w-4 h-4" />,
  region: <Globe className="w-4 h-4" />,
};

// Helper to get activity icon based on name/category
const getActivityIcon = (activityName: string, category: string) => {
  const name = activityName.toLowerCase();
  const cat = category.toLowerCase();
  
  if (name.includes('game drive') || name.includes('safari')) return Binoculars;
  if (name.includes('photography') || name.includes('photo')) return Camera;
  if (name.includes('hiking') || name.includes('trek') || name.includes('walk')) return Footprints;
  if (name.includes('camping') || name.includes('camp')) return TentTree;
  if (name.includes('fishing')) return Fish;
  if (name.includes('beach') || name.includes('island')) return Palmtree;
  if (name.includes('wine') || name.includes('tasting')) return Wine;
  if (name.includes('food') || name.includes('culinary') || name.includes('dining')) return UtensilsCrossed;
  if (cat.includes('wildlife') || cat.includes('safari')) return Binoculars;
  if (cat.includes('adventure') || cat.includes('hiking')) return Footprints;
  if (cat.includes('cultural') || cat.includes('tour')) return Camera;
  
  return Sparkles; // default
};

const getActivityColor = (activityName: string) => {
  const name = activityName.toLowerCase();
  
  if (name.includes('game drive') || name.includes('safari')) return '#8b5cf6'; // purple
  if (name.includes('private')) return '#3b82f6'; // blue
  if (name.includes('shared')) return '#10b981'; // green
  if (name.includes('hiking') || name.includes('trek')) return '#f59e0b'; // amber
  if (name.includes('beach') || name.includes('island')) return '#06b6d4'; // cyan
  if (name.includes('food') || name.includes('wine')) return '#ef4444'; // red
  
  return '#8b5cf6'; // default purple
};

function destIcon(type: string) {
  return DEST_ICONS[type] ?? <MapPin className="w-4 h-4" />;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtUSD(n: number) {
  return `$${fmt(n)}`;
}

function fmtFresh(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function confidenceLabel(c: number) {
  if (c >= 0.8) return { text: "High", color: "text-green-600" };
  if (c >= 0.6) return { text: "Medium", color: "text-amber-600" };
  return { text: "Low", color: "text-red-500" };
}

// ─── Steps ─────────────────────────────────────────────────────────────────────

const STEPS = ["Trip basics", "Destinations", "Activities", "Style", "Your estimate"];

// ─── Main component ────────────────────────────────────────────────────────────

export default function NolScopeEstimator() {
  const estimatorRef = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState(0);

  // Step 0 — basics
  const [nationality, setNationality] = useState("TZ");  // Default to Tanzania
  const [startDate, setStartDate] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [natSearch, setNatSearch] = useState("");
  const [natOpen, setNatOpen] = useState(false);
  const natRef = useRef<HTMLDivElement>(null);
  const natBtnRef = useRef<HTMLButtonElement>(null);
  const [natPortalPos, setNatPortalPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const computeNatPos = useCallback(() => {
    const el = natBtnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxW = window.innerWidth - 16; // 8px gutter each side
    const width = Math.min(Math.max(240, rect.width), maxW);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setNatPortalPos({ top: rect.bottom + 6, left, width });
  }, []);

  useEffect(() => {
    if (!natOpen) return;
    computeNatPos();
    window.addEventListener("resize", computeNatPos);
    window.addEventListener("scroll", computeNatPos, true);
    return () => {
      window.removeEventListener("resize", computeNatPos);
      window.removeEventListener("scroll", computeNatPos, true);
    };
  }, [natOpen, computeNatPos]);

  // Step 1 — destinations
  const [destinations, setDestinations] = useState<DestinationEntry[]>([]);
  const [availableDests, setAvailableDests] = useState<Destination[]>([]);
  const [loadingDests, setLoadingDests] = useState(false);

  // Step 2 — activities
  const [availableActivities, setAvailableActivities] = useState<Activity[]>([]);
  const [loadingActs, setLoadingActs] = useState(false);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);

  // Step 3 — style
  const [tier, setTier] = useState("standard");
  const [transportPref, setTransportPref] = useState("any");

  // Step 4 — results
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [estimateError, setEstimateError] = useState("");

  // ── load destinations on mount ──────────────────────────────────────────────
  useEffect(() => {
    setLoadingDests(true);
    fetch("/api/public/nolscope/destinations")
      .then((r) => r.json())
      .then((d) =>
        setAvailableDests(
          (d.destinations ?? []).map((r: any) => ({
            code: r.destinationCode ?? r.code,
            name: r.displayName ?? r.destinationName ?? r.name,
            country: r.region ?? r.country ?? "",
            destinationType: r.destinationType ?? "",
            description: r.description,
            popularity: r.popularity ?? 0,
            avgStayDays: r.avgStayDays ?? undefined,
          }))
        )
      )
      .catch(() => {})
      .finally(() => setLoadingDests(false));
  }, []);

  // ── load activities when destinations change ────────────────────────────────
  useEffect(() => {
    if (destinations.length === 0) {
      setAvailableActivities([]);
      return;
    }
    setLoadingActs(true);
    const codes = [...new Set(destinations.map((d) => d.code))];
    Promise.all(
      codes.map((c) =>
        fetch(`/api/public/nolscope/activities?dest=${c}`)
          .then((r) => r.json())
          .then((d) =>
            (d.activities ?? []).map((a: any) => ({
              code: a.activityCode ?? a.code,
              name: a.activityName ?? a.name,
              category: a.category ?? '',
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
          for (const a of grp) {
            const key = a.code || a.name;
            const existing = seen.get(key);
            if (existing) {
              const existingCodes = existing.destinationCodes ?? (existing.destinationCode ? [existing.destinationCode] : []);
              const nextCodes = a.destinationCodes ?? (a.destinationCode ? [a.destinationCode] : []);
              existing.destinationCodes = [...new Set([...existingCodes, ...nextCodes])];
            } else {
              seen.set(key, a);
              merged.push(a);
            }
          }
        }
        setAvailableActivities(merged);
      })
      .finally(() => setLoadingActs(false));
  }, [destinations]);

  // ── close nat dropdown on outside click (works with portal) ───────────────
  useEffect(() => {
    if (!natOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        natBtnRef.current && !natBtnRef.current.contains(t) &&
        natRef.current && !natRef.current.contains(t)
      ) {
        // also allow clicks inside the portal panel — check by class marker
        const portal = document.querySelector("[data-nat-portal]");
        if (portal && portal.contains(t)) return;
        setNatOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [natOpen]);

  // ── helpers ─────────────────────────────────────────────────────────────────
  const totalDays = destinations.reduce((s, d) => s + d.days, 0);
  const destinationLabelByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const dest of availableDests) {
      map.set(dest.code.toUpperCase(), dest.name || dest.code);
    }
    return map;
  }, [availableDests]);

  const activitiesByDestination = useMemo(() => {
    return destinations
      .map((dest) => {
        const code = dest.code.toUpperCase();
        const activities = availableActivities.filter((activity) => {
          const codes = activity.destinationCodes ?? (activity.destinationCode ? [activity.destinationCode] : []);
          return codes.some((activityCode) => String(activityCode).toUpperCase() === code);
        });

        return {
          code,
          days: dest.days,
          name: destinationLabelByCode.get(code) ?? code.replace(/_/g, " "),
          activities,
          selectedCount: activities.filter((activity) => selectedActivities.includes(activity.code)).length,
        };
      })
      .filter((group) => group.activities.length > 0);
  }, [availableActivities, destinationLabelByCode, destinations, selectedActivities]);

  const canNext = useCallback((): boolean => {
    if (step === 0) return !!nationality && !!startDate && adults >= 1;
    if (step === 1) return destinations.length > 0 && destinations.every((d) => d.days >= 1);
    if (step === 2) return true; // activities optional
    if (step === 3) return true;
    return false;
  }, [step, nationality, startDate, adults, destinations]);

  const runEstimate = useCallback(async () => {
    setLoadingEstimate(true);
    setEstimateError("");
    
    // Start the API call and a minimum display timer in parallel
    const startTime = Date.now();
    const minDisplayTime = 7000; // 7 seconds minimum display
    
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
      
      // Calculate how much time has elapsed
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, minDisplayTime - elapsed);
      
      // Wait for the remaining time to ensure minimum 7 seconds display
      if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }
      
      if (!res.ok) {
        setEstimateError(data?.error ?? "Failed to generate estimate");
      } else {
        setResult(data);
      }
    } catch {
      // Even on error, respect minimum display time
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, minDisplayTime - elapsed);
      if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }
      setEstimateError("Network error — please try again");
    } finally {
      setLoadingEstimate(false);
    }
  }, [nationality, destinations, startDate, adults, children, transportPref, selectedActivities, tier]);

  const focusEstimator = useCallback(() => {
    window.setTimeout(() => {
      estimatorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  const goNext = () => {
    if (step === 3) {
      setStep(4);
      focusEstimator();
      runEstimate();
    } else {
      setStep((s) => Math.min(s + 1, 4));
      focusEstimator();
    }
  };

  const goBack = () => {
    setStep((s) => Math.max(s - 1, 0));
    focusEstimator();
  };

  const restart = () => {
    setStep(0);
    setResult(null);
    setEstimateError("");
    focusEstimator();
  };

  const selectedNatLabel =
    NATIONALITIES.find((n) => n.code === nationality)?.label ?? nationality;
  const filteredNats = NATIONALITIES.filter((n) =>
    n.label.toLowerCase().includes(natSearch.toLowerCase()) ||
    n.code.toLowerCase().includes(natSearch.toLowerCase())
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div ref={estimatorRef} className="max-w-2xl mx-auto px-4 sm:px-0 scroll-mt-24">
      {/* Step indicator */}
      <StepBar current={step} steps={STEPS} />

      <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.07),0_1px_4px_rgba(0,0,0,0.04)] border border-slate-100/80 overflow-hidden">
        {/* Step 0 — Trip basics */}
        {step === 0 && (
          <StepPanel title="Tell us about your trip" icon={<Globe className="w-5 h-5 text-[#02665e]" />}>
            {/* ── 2-col: nationality | date ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* Nationality */}
              <div className="relative" ref={natRef}>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Nationality
                </label>
                <button
                  ref={natBtnRef}
                  type="button"
                  onClick={() => { setNatOpen((o) => !o); computeNatPos(); }}
                  className="w-full h-12 flex items-center gap-2.5 px-3 border border-slate-200 rounded-xl bg-white hover:border-[#02665e]/60 focus:outline-none focus:ring-2 focus:ring-[#02665e]/25 transition shadow-sm"
                >
                  <span className="text-2xl leading-none shrink-0" suppressHydrationWarning>{countryFlag(nationality)}</span>
                  <span className="flex-1 text-slate-800 font-medium text-sm truncate text-left">{selectedNatLabel}</span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${natOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Portal dropdown — rendered to body so overflow-hidden never clips it */}
                {typeof document !== 'undefined' && natOpen && natPortalPos && createPortal(
                  <div
                    data-nat-portal
                    className="fixed z-[9999] bg-white rounded-2xl overflow-hidden"
                    style={{
                      top: natPortalPos.top,
                      left: natPortalPos.left,
                      width: natPortalPos.width,
                      boxShadow: "0 8px 32px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.06)",
                      border: "1px solid rgba(0,0,0,0.08)",
                    }}
                  >
                    {/* search */}
                    <div className="px-4 pt-3 pb-2 flex justify-center">
                      <div className="relative w-44">
                        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                        <input
                          autoFocus
                          type="text"
                          value={natSearch}
                          onChange={(e) => setNatSearch(e.target.value)}
                          placeholder="Search country..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#02665e]/25 focus:border-[#02665e]/40 focus:bg-white transition"
                        />
                      </div>
                    </div>
                    <div className="h-px mx-3 bg-slate-100" />
                    {/* items */}
                    <div className="max-h-60 overflow-y-auto py-1">
                      {filteredNats.map((n) => (
                        <button
                          key={n.code}
                          type="button"
                          onClick={() => { setNationality(n.code); setNatOpen(false); setNatSearch(""); }}
                          className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 transition ${
                            nationality === n.code
                              ? "bg-[#02665e]/[0.07] text-[#02665e] font-semibold"
                              : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span className="text-xl leading-none shrink-0" suppressHydrationWarning>{countryFlag(n.code)}</span>
                          <span className="flex-1 truncate">{n.label}</span>
                          {nationality === n.code && (
                            <CheckCircle2 className="w-4 h-4 text-[#02665e] shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}
              </div>

              {/* Travel date — using DatePickerField */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Travel start date
                </label>
                <DatePickerField
                  label="Travel start date"
                  value={startDate}
                  onChangeAction={setStartDate}
                  min={new Date().toISOString().slice(0, 10)}
                  widthClassName="w-full"
                  size="md"
                  allowPast={false}
                  twoMonths={false}
                />
              </div>

            </div>

            {/* Traveler counts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <CounterField label="Adults" value={adults} min={1} max={20} onChange={setAdults} />
              <CounterField label="Children" sub="under 16" value={children} min={0} max={10} onChange={setChildren} />
            </div>
          </StepPanel>
        )}

        {/* Step 1 — Destinations */}
        {step === 1 && (
          <StepPanel title="Where would you like to go?" icon={<MapPin className="w-5 h-5 text-emerald-500" />}>
            {loadingDests ? (
              <div className="flex items-center gap-2 text-slate-400 py-6">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading destinations...
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-500 -mt-1 mb-1">
                  Select one or more destinations and how many nights you plan to spend there.
                </p>
                <div className="grid grid-cols-1 gap-3">
                  {availableDests.map((dest, i) => {
                    const entry = destinations.find((d) => d.code === dest.code);
                    const selected = !!entry;
                    return (
                      <DestCard
                        key={`dest-${dest.code ?? i}-${i}`}
                        dest={dest}
                        days={entry?.days ?? 0}
                        selected={selected}
                        onToggle={(code) => {
                          if (selected) {
                            setDestinations((ds) => ds.filter((d) => d.code !== code));
                          } else {
                            setDestinations((ds) => [...ds, { code, days: 3 }]);
                          }
                        }}
                        onDaysChange={(code, days) =>
                          setDestinations((ds) => ds.map((d) => (d.code === code ? { ...d, days } : d)))
                        }
                      />
                    );
                  })}
                </div>
                {destinations.length > 0 && (
                  <p className="text-sm text-[#02665e] font-medium mt-2">
                    Total trip length: {totalDays} night{totalDays !== 1 ? "s" : ""}
                  </p>
                )}
              </>
            )}
          </StepPanel>
        )}

        {/* Step 2 — Activities */}
        {step === 2 && (
          <StepPanel title="What would you like to do?" icon={<Sparkles className="w-5 h-5 text-violet-500" />}>
            {loadingActs ? (
              <div className="flex items-center gap-2 text-slate-400 py-6">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading activities...
              </div>
            ) : availableActivities.length === 0 ? (
              <p className="text-sm text-slate-500 py-6">
                No activities catalogued for selected destinations yet. You can skip this step.
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-500 -mt-1 mb-3">
                  Select activities to include in the estimate. You can skip to get a base cost.
                </p>
                <div className="space-y-4">
                  {activitiesByDestination.map((group) => (
                    <section
                      key={`activity-group-${group.code}`}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                              <MapPin className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-extrabold text-slate-900">{group.name}</p>
                              <p className="text-[11px] font-medium text-slate-500">
                                {group.days} night{group.days === 1 ? "" : "s"} selected for this destination
                              </p>
                            </div>
                          </div>
                        </div>
                        <span className="rounded-full bg-violet-50 px-3 py-1 text-[11px] font-bold text-violet-700 ring-1 ring-violet-100">
                          {group.selectedCount}/{group.activities.length} selected
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                        {group.activities.map((act, i) => {
                          const on = selectedActivities.includes(act.code);
                          const Icon = getActivityIcon(act.name, act.category);
                          const color = getActivityColor(act.name);
                          return (
                            <button
                              key={`act-${group.code}-${act.code ?? i}-${i}`}
                              type="button"
                              onClick={() =>
                                setSelectedActivities((prev) =>
                                  on ? prev.filter((c) => c !== act.code) : [...prev, act.code]
                                )
                              }
                              className={`relative flex min-h-[86px] items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all duration-200 ${
                                on
                                  ? "border-[#8b5cf6] bg-[#8b5cf6]/5 shadow-md"
                                  : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                              }`}
                            >
                              <div
                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                                  on ? "shadow-md" : "shadow-sm"
                                }`}
                                style={{ backgroundColor: on ? color : `${color}15` }}
                              >
                                <Icon
                                  className="h-5 w-5 transition-colors duration-200"
                                  style={{ color: on ? "white" : color }}
                                />
                              </div>

                              <div className="min-w-0 flex-1 pr-5">
                                <div className={`text-sm font-bold leading-snug transition-colors duration-200 ${
                                  on ? "text-[#8b5cf6]" : "text-slate-800"
                                }`}>
                                  {act.name}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  {act.category ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                      {act.category}
                                    </span>
                                  ) : null}
                                  {act.basePrice ? (
                                    <span className={`text-xs font-semibold transition-colors duration-200 ${
                                      on ? "text-violet-600" : "text-slate-400"
                                    }`}>
                                      ~{fmtUSD(act.basePrice)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              {on && (
                                <div className="absolute right-2.5 top-2.5">
                                  <CheckCircle2 className="h-5 w-5 text-[#8b5cf6]" />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
                {selectedActivities.length > 0 && (
                  <p className="text-sm text-violet-600 mt-3 font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {selectedActivities.length} activit{selectedActivities.length === 1 ? "y" : "ies"} selected
                  </p>
                )}
              </>
            )}
          </StepPanel>
        )}

        {/* Step 3 — Style */}
        {step === 3 && (
          <StepPanel title="Travel style & transport" icon={<Mountain className="w-5 h-5 text-amber-500" />}>
            <div>
              <div className="mb-3">
                <label className="block text-[15px] font-bold text-slate-800">Accommodation tier</label>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Select the accommodation level that matches your comfort preference and how you want the estimate priced.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {TIERS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTier(t.key)}
                    className={`relative flex w-full items-center gap-4 rounded-xl border-2 px-5 py-4 text-left transition-all duration-200
                      ${tier === t.key ? `${t.color} ${t.active} shadow-sm` : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"}`}
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/75 text-2xl shadow-sm ring-1 ring-slate-100">
                      {t.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-extrabold text-slate-900">{t.label}</p>
                        {tier === t.key ? (
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">
                            Selected
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">{t.sub}</p>
                    </div>
                    {tier === t.key && (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-slate-600" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200/80">
              <div className="mb-3 rounded-xl border border-[#02665e]/12 bg-[#02665e]/[0.035] px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
                    <Car className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <label className="block text-[15px] font-bold text-slate-800">Transport preference</label>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      Choose how you prefer to move between destinations. This changes vehicle costs, transfer assumptions, and the final estimate.
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {TRANSPORT_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const selected = transportPref === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTransportPref(opt.value)}
                      className={`relative flex flex-col items-center gap-2 px-4 py-4 rounded-xl border-2 text-sm font-medium transition-all duration-200
                        ${selected
                          ? "border-[#02665e] bg-[#02665e]/5 shadow-md"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"}`}
                    >
                      {/* Icon circle */}
                      <div 
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200
                          ${selected ? "shadow-md" : "shadow-sm"}`}
                        style={{
                          backgroundColor: selected ? opt.color : `${opt.color}15`
                        }}
                      >
                        <Icon 
                          className={`w-5 h-5 transition-colors duration-200`}
                          style={{ color: selected ? 'white' : opt.color }}
                        />
                      </div>
                      {/* Label */}
                      <span className={`text-xs font-semibold text-center transition-colors duration-200
                        ${selected ? "text-[#02665e]" : "text-slate-600"}`}>
                        {opt.label}
                      </span>
                      {/* Check indicator */}
                      {selected && (
                        <div className="absolute top-2 right-2">
                          <CheckCircle2 className="w-4 h-4 text-[#02665e]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </StepPanel>
        )}

        {/* Step 4 — Results */}
        {step === 4 && (
          <div className="p-6 sm:p-8">
            {loadingEstimate && (
              <div 
                className="relative z-10 flex min-h-[360px] items-center justify-center animate-in fade-in duration-300"
              >
                <div 
                  className="relative mx-2 w-full max-w-md overflow-hidden rounded-2xl p-[1px] shadow-xl animate-in zoom-in-95 duration-500"
                  style={{
                    background: "linear-gradient(135deg, rgba(2,180,245,0.45), rgba(2,102,94,0.85), rgba(20,184,166,0.35))",
                  }}
                >
                  <div
                    className="relative overflow-hidden rounded-[calc(1rem-1px)] px-5 py-6 text-white sm:px-6"
                    style={{
                      background: [
                        "radial-gradient(circle at 16% 0%, rgba(255,255,255,0.18), transparent 30%)",
                        "radial-gradient(circle at 100% 100%, rgba(2,180,245,0.16), transparent 32%)",
                        "linear-gradient(135deg, #013d38 0%, #02665e 54%, #014d47 100%)",
                      ].join(", "),
                    }}
                  >
                    <div
                      className="absolute inset-0 opacity-[0.12]"
                      style={{
                        backgroundImage: "repeating-linear-gradient(135deg, white 0px, white 1px, transparent 1px, transparent 18px)",
                      }}
                    />
                    <div className="absolute -left-16 -top-16 h-36 w-36 rounded-full bg-white/10 blur-2xl animate-pulse" />
                    <div className="absolute -right-12 bottom-0 h-32 w-32 rounded-full bg-[#02b4f5]/20 blur-2xl animate-pulse" />

                    <div className="relative z-10">
                      <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                          <div className="absolute inset-0 rounded-2xl border border-white/20" />
                          <div className="absolute inset-1 rounded-2xl border border-dashed border-white/35 animate-spin" style={{ animationDuration: "6s" }} />
                          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#02665e] shadow-lg ring-2 ring-white/25">
                            <Calculator className="h-5 w-5" />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">NoLScope</p>
                          <h3 className="mt-0.5 text-lg font-extrabold tracking-tight text-white sm:text-xl">Calculating estimate</h3>
                          <p className="mt-1 text-xs leading-relaxed text-white/68">
                            Combining rates, routes, activities, and seasonal rules.
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 rounded-2xl border border-white/10 bg-white/8 p-3 backdrop-blur-sm">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <span className="text-[11px] font-semibold text-white/70">Estimate engine</span>
                          <span className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-emerald-100">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-ping" />
                            Live
                          </span>
                        </div>
                        {[
                          "Destination rates",
                          "Transport costs",
                          "Cost range",
                        ].map((label, index) => (
                          <div key={label} className="grid grid-cols-[108px_1fr_34px] items-center gap-2 py-1.5">
                            <span className="text-[11px] font-semibold text-white/78">{label}</span>
                            <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-200 via-white to-cyan-100 shadow-[0_0_16px_rgba(255,255,255,0.65)] animate-pulse"
                                style={{ width: `${56 + index * 15}%`, animationDelay: `${index * 140}ms` }}
                              />
                            </div>
                            <span
                              className="h-2 w-2 rounded-full bg-emerald-300 justify-self-end shadow-[0_0_12px_rgba(110,231,183,0.85)] animate-pulse"
                              style={{ animationDelay: `${index * 180}ms` }}
                            />
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex items-center justify-center gap-1.5">
                        {[0, 1, 2, 3].map((dot) => (
                          <span
                            key={dot}
                            className="h-1.5 w-1.5 rounded-full bg-white/70 animate-bounce"
                            style={{ animationDelay: `${dot * 120}ms`, animationDuration: "900ms" }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {estimateError && (
              <div className="text-center py-12">
                <div className="text-red-500 font-medium mb-4">{estimateError}</div>
                <button
                  onClick={() => runEstimate()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#02665e] text-white rounded-xl text-sm font-medium hover:bg-[#014d47] transition"
                >
                  <RefreshCw className="w-4 h-4" /> Retry
                </button>
              </div>
            )}

            {!loadingEstimate && !estimateError && result && (
              <ResultCard result={result} onRestart={restart} nationality={nationality} availableDests={availableDests} />
            )}
          </div>
        )}

        {/* Navigation */}
        {step < 4 && (
          <div className="px-6 pb-6 sm:px-8 sm:pb-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0 ? true : false}
              suppressHydrationWarning
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!canNext() ? true : false}
              suppressHydrationWarning
              className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-[#02665e] text-white text-sm font-semibold hover:bg-[#014d47] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {step === 3 ? (
                <>
                  <Sparkles className="w-4 h-4" /> Get estimate
                </>
              ) : (
                <>
                  Next <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}

        {step === 4 && !loadingEstimate && (
          <div className="px-6 pb-6 sm:px-8 sm:pb-8 border-t border-slate-100 pt-5">
            <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
              <button
                type="button"
                onClick={goBack}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:border-[#02665e]/40 hover:text-[#02665e] transition shadow-sm"
              >
                <ArrowLeft className="w-4 h-4" /> Change style
              </button>
              <button
                type="button"
                onClick={restart}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:border-[#02665e]/40 hover:text-[#02665e] transition shadow-sm"
              >
                <RefreshCw className="w-4 h-4" /> Start over
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StepBar({ current, steps }: { current: number; steps: string[] }) {
  const STEP_ICONS = [Globe, MapPin, Sparkles, Mountain, Waves];

  return (
    <div className="mb-8">
      {/* Thin animated progress track */}
      <div className="h-0.5 bg-slate-100 rounded-full mb-5 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#02665e] via-[#028074] to-emerald-400 rounded-full transition-all duration-500 ease-out"
          style={{ width: current === 0 ? "0%" : `${(current / (steps.length - 1)) * 100}%` }}
        />
      </div>

      {/* Nodes row */}
      <div className="flex items-start">
        {steps.map((label, i) => {
          const Icon = STEP_ICONS[i];
          const done = i < current;
          const active = i === current;

          return (
            <React.Fragment key={label}>
              {/* Connector (before node, except first) */}
              {i > 0 && (
                <div
                  className={`flex-1 h-px mt-[18px] transition-colors duration-500 ${
                    i <= current ? "bg-[#02665e]/35" : "bg-slate-200"
                  }`}
                />
              )}

              {/* Node + label */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${
                    done
                      ? "bg-[#02665e] shadow-[0_2px_10px_rgba(2,102,94,0.40)]"
                      : active
                      ? "bg-white border-2 border-[#02665e] shadow-[0_0_0_5px_rgba(2,102,94,0.10),0_2px_8px_rgba(2,102,94,0.18)]"
                      : "bg-white border-2 border-slate-200 shadow-none"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="w-[18px] h-[18px] text-white" />
                  ) : (
                    <Icon
                      className={`w-[17px] h-[17px] transition-colors duration-300 ${
                        active ? "text-[#02665e]" : "text-slate-300"
                      }`}
                      strokeWidth={active ? 2 : 1.5}
                    />
                  )}
                </div>
                <span
                  className={`text-[10.5px] font-medium whitespace-nowrap transition-colors duration-300 ${
                    active
                      ? "text-[#02665e] font-semibold"
                      : done
                      ? "text-slate-500"
                      : "text-slate-400"
                  }`}
                >
                  {label}
                </span>
              </div>

              {/* Connector (after node, except last) */}
              {i < steps.length - 1 && (
                <div
                  className={`flex-1 h-px mt-[18px] transition-colors duration-500 ${
                    i < current ? "bg-[#02665e]/35" : "bg-slate-200"
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function StepPanel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      {/* Gradient header strip */}
      <div
        className="relative px-6 py-5 flex items-center gap-3 overflow-hidden"
        style={{
          background: [
            "repeating-linear-gradient(135deg,rgba(255,255,255,0.05) 0px,rgba(255,255,255,0.05) 12px,transparent 12px,transparent 24px)",
            "linear-gradient(135deg,#02665e 0%,#014d47 60%,#013d38 100%)",
          ].join(","),
        }}
      >
        {/* glow accent */}
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-40"
          style={{ background: "radial-gradient(ellipse at 100% 50%,rgba(255,255,255,0.10) 0%,transparent 70%)" }}
        />
        {/* icon bubble */}
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-white">
          {icon}
        </div>
        <h2 className="text-base font-semibold text-white tracking-tight">{title}</h2>
      </div>
      {/* body */}
      <div className="p-6 sm:p-8 flex flex-col gap-5">
        {children}
      </div>
    </div>
  );
}

function CounterField({
  label,
  sub,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  sub?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
      style={{ boxShadow: "inset 0 1px 3px rgba(0,0,0,0.04)" }}
    >
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        {sub && <span className="text-[11px] text-slate-400">{sub}</span>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min ? true : false}
          className="w-8 h-8 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:border-[#02665e]/50 hover:text-[#02665e] disabled:opacity-30 transition shadow-sm"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="text-slate-800 font-bold text-base w-7 text-center tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max ? true : false}
          className="w-8 h-8 rounded-full bg-[#02665e] text-white flex items-center justify-center hover:bg-[#014d47] disabled:opacity-30 transition shadow-sm shadow-[#02665e]/25"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function DestCard({
  dest,
  days,
  selected,
  onToggle,
  onDaysChange,
}: {
  dest: Destination;
  days: number;
  selected: boolean;
  onToggle: (code: string) => void;
  onDaysChange: (code: string, days: number) => void;
}) {
  return (
    <div
      className={`rounded-2xl border transition-all duration-200 overflow-hidden
        ${selected
          ? "border-[#02665e]/25 shadow-md"
          : "border-slate-200 bg-white hover:border-[#02665e]/20 hover:shadow-md"
        }`}
    >
      {/* Top row: icon + name/desc + toggle */}
      <div className={`flex items-start gap-3 p-4 transition-all duration-200
        ${selected
          ? "bg-gradient-to-r from-[#02665e]/[0.08] via-[#02665e]/[0.04] to-white"
          : "bg-white"
        }`}>
        {/* Icon */}
        <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all
          ${selected
            ? "bg-[#02665e] text-white shadow-sm"
            : "bg-slate-100 text-slate-400 group-hover:bg-slate-200"
          }`}>
          {destIcon(dest.destinationType)}
        </div>

        {/* Name + type + description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold text-sm leading-tight transition-colors ${selected ? "text-[#014d47]" : "text-slate-800"}`}>
              {dest.name}
            </span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide
              ${selected ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-400"}`}>
              {dest.destinationType}
            </span>
          </div>
          {dest.description && (
            <p className={`text-xs mt-1 leading-relaxed line-clamp-2 transition-colors ${selected ? "text-[#02665e]/70" : "text-slate-500"}`}>
              {dest.description}
            </p>
          )}
        </div>

        {/* Explicit checkbox toggle — only this button toggles the card */}
        <button
          type="button"
          onClick={() => onToggle(dest.code)}
          aria-label={selected ? `Remove ${dest.name}` : `Add ${dest.name}`}
          className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
            ${selected
              ? "bg-[#02665e] border-[#02665e] text-white shadow-sm"
              : "border-slate-300 bg-white hover:border-[#02665e]/60 hover:bg-[#02665e]/5"
            }`}
        >
          {selected && (
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="2,6 5,9 10,3" />
            </svg>
          )}
        </button>
      </div>

      {/* Nights row — only shown when selected, click is fully isolated */}
      {selected && (
        <div className="px-4 pb-4 pt-0 space-y-2 bg-gradient-to-r from-[#02665e]/[0.08] via-[#02665e]/[0.04] to-white">
          <div className="flex items-center gap-3 bg-white/80 backdrop-blur-sm rounded-xl px-4 py-2.5 border border-[#02665e]/15 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex-1">Nights</span>
            <button
              type="button"
              onClick={() => onDaysChange(dest.code, Math.max(1, days - 1))}
              className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:border-[#02665e]/40 hover:text-[#02665e] hover:bg-[#02665e]/5 transition"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="font-bold text-[#02665e] w-6 text-center text-sm">{days}</span>
            <button
              type="button"
              onClick={() => onDaysChange(dest.code, Math.min(30, days + 1))}
              className="w-7 h-7 rounded-full bg-[#02665e] flex items-center justify-center text-white hover:bg-[#014d47] transition shadow-sm"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          {/* contextual hint */}
          <p className={`text-[11px] px-1 leading-snug font-medium ${
            dest.avgStayDays && days === dest.avgStayDays
              ? "text-[#02665e]"
              : dest.avgStayDays && days < dest.avgStayDays
              ? "text-amber-500"
              : dest.avgStayDays && days > dest.avgStayDays
              ? "text-sky-500"
              : "text-slate-400"
          }`}>
            {dest.avgStayDays && days === dest.avgStayDays
              ? `Matches the typical ${dest.avgStayDays}-night stay for ${dest.name}.`
              : dest.avgStayDays && days < dest.avgStayDays
              ? `Most visitors spend ${dest.avgStayDays} nights here. Consider adding more time.`
              : dest.avgStayDays && days > dest.avgStayDays
              ? `Typical stay is ${dest.avgStayDays} nights. You are allowing extra time to explore.`
              : `Set how many nights you plan to spend at ${dest.name}.`}
          </p>
        </div>
      )}
    </div>
  );
}

// strips hyphens and title-cases a label ("mid-range" → "Mid Range")
function cleanLabel(s: string) {
  return s
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ResultCard({ result, onRestart, nationality, availableDests }: { result: EstimateResult; onRestart: () => void; nationality: string; availableDests: Destination[] }) {
  const conf = confidenceLabel(result.confidence);
  const [detailOpen, setDetailOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  
  // Get nationality label and flag
  const nationalityInfo = NATIONALITIES.find(n => n.code === nationality) || NATIONALITIES.find(n => n.code === 'XX')!;
  const flag = countryFlag(nationality);
  
  // Share handlers
  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setShareOpen(false);
      }, 2000);
    });
  };
  
  const handleDownload = () => {
    window.print();
    setShareOpen(false);
  };
  
  // Close share dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    };
    
    if (shareOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [shareOpen]);

  // Diagonal-slash branded background — brand teal #02665e
  const heroBg: React.CSSProperties = {
    background: [
      "repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 14px, transparent 14px, transparent 28px)",
      "linear-gradient(135deg, #02665e 0%, #014d47 55%, #013d38 100%)",
    ].join(", "),
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── Hero banner ────────────────────────────────────────────────── */}
      <div
        className="relative rounded-2xl overflow-hidden px-6 py-7 text-white"
        style={heroBg}
      >
        {/* top label */}
        <div className="flex items-center gap-2 mb-1">
          <p className="text-xs font-medium text-white/70 tracking-wide uppercase">
            Trip estimate for {result.travelers.total} traveller{result.travelers.total !== 1 ? "s" : ""}
          </p>
          <span className="text-xs font-medium text-white/60">·</span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/10 backdrop-blur-sm">
            <span className="text-sm" suppressHydrationWarning>{flag}</span>
            <span className="text-xs font-medium text-white/90">{nationalityInfo.label}</span>
          </div>
        </div>

        {/* main price */}
        <p className="text-4xl font-extrabold tracking-tight leading-none">
          {fmtUSD(result.totalAvg)}
        </p>

        {/* range */}
        <p className="text-sm text-white/60 mt-1 font-medium">
          {fmtUSD(result.totalMin)} &ndash; {fmtUSD(result.totalMax)}
        </p>

        {result.travelers.adults > 1 && (
          <p className="text-xs text-white/50 mt-0.5">{fmtUSD(result.perAdultAvg)} per adult</p>
        )}

        {/* pill row */}
        <div className="flex flex-wrap gap-2 mt-4">
          <HeroPill>{result.totalDays} night{result.totalDays !== 1 ? "s" : ""}</HeroPill>
          <HeroPill>{cleanLabel(result.season)} season</HeroPill>
          <HeroPill>{cleanLabel(result.tier)}</HeroPill>
          <HeroPill className={conf.color === "text-green-600" ? "!text-emerald-300" : conf.color === "text-amber-600" ? "!text-amber-300" : "!text-red-300"}>
            {conf.text} accuracy
          </HeroPill>
        </div>
      </div>

      {/* ── Cost breakdown ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-800 uppercase tracking-wide">Cost Breakdown</h3>
          <button
            type="button"
            onClick={() => setDetailOpen((o) => !o)}
            className="text-xs font-semibold text-[#02665e] hover:text-[#014d47] transition px-3 py-1.5 rounded-lg hover:bg-[#02665e]/5"
          >
            {detailOpen ? "Hide detail" : "Show detail"}
          </button>
        </div>
        <div className="flex flex-col gap-4">
          <BreakdownRow label="Visa fees"     accent="#02665e" icon="✈️" amount={result.breakdown.visa.total}          total={result.totalAvg} detail={detailOpen ? `${cleanLabel(result.breakdown.visa.entries ?? "single")} entry · ${cleanLabel(result.breakdown.visa.processingTime ?? "on arrival")}` : undefined} />
          <BreakdownRow label="Park fees"     accent="#10b981" icon="🦁" amount={result.breakdown.parkFees.total}      total={result.totalAvg} detail={detailOpen ? (result.breakdown.parkFees.note ?? undefined) : undefined} />
          <BreakdownRow label="Transport"     accent="#f59e0b" icon="🚐" amount={result.breakdown.transport.total}     total={result.totalAvg} detail={detailOpen && result.breakdown.transport.range ? `${fmtUSD(result.breakdown.transport.range.min)} to ${fmtUSD(result.breakdown.transport.range.max)}` : undefined} />
          <BreakdownRow label="Activities"    accent="#8b5cf6" icon="🤿" amount={result.breakdown.activities.total}    total={result.totalAvg} detail={detailOpen ? (result.breakdown.activities.note ?? undefined) : undefined} />
          <BreakdownRow label="Accommodation" accent="#ec4899" icon="🏨" amount={result.breakdown.accommodation.total} total={result.totalAvg} detail={detailOpen ? result.breakdown.accommodation.note : undefined} />
          <BreakdownRow label="Tips & gratuities" accent="#f97316" icon="🙏" amount={result.breakdown.tips.total} total={result.totalAvg} detail={detailOpen ? result.breakdown.tips.note : undefined} />
          <BreakdownRow label="Travel insurance" accent="#06b6d4" icon="🛡️" amount={result.breakdown.travelInsurance.total} total={result.totalAvg} detail={detailOpen ? result.breakdown.travelInsurance.note : undefined} />
          <BreakdownRow label="Service charge" accent="#64748b" icon="💼" amount={result.breakdown.serviceCharge.total} total={result.totalAvg} detail={detailOpen ? `${result.breakdown.serviceCharge.percent ?? 5}% planning fee` : undefined} />
        </div>
      </div>

      {/* ── Season notes ───────────────────────────────────────────────── */}
      {result.appliedRules && result.appliedRules.length > 0 && (
        <div className="bg-gradient-to-br from-amber-50 via-orange-50/30 to-white border border-amber-200 rounded-2xl px-4 sm:px-6 py-4 sm:py-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 shadow-md">
              <Info className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-amber-900 mb-2.5">Seasonal Pricing Applied</h3>
              <div className="space-y-2">
                {result.appliedRules.map((r, i) => (
                  <div key={i} className="bg-white/70 rounded-xl px-3 py-2.5 border border-amber-100">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-xs font-bold text-amber-900">{cleanLabel(r.seasonName)}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap">
                        {r.multiplier}× rate
                      </span>
                    </div>
                    <p className="text-xs text-amber-800 leading-relaxed">{r.description || r.ruleName}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Accuracy + Data Freshness ──────────────────────────────────── */}
      <div className="rounded-2xl border border-[#02665e]/25 overflow-hidden shadow-sm">
        {/* Accuracy statement */}
        <div className="flex items-start gap-3 bg-[#02665e]/5 px-4 py-3 border-b border-[#02665e]/15">
          <div className="w-7 h-7 rounded-lg bg-[#02665e]/10 flex items-center justify-center shrink-0 mt-0.5">
            <Shield className="w-3.5 h-3.5 text-[#02665e]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-[#02665e] mb-0.5">Accuracy-Verified Estimate</p>
            <p className="text-xs text-slate-600 leading-relaxed">
              All rates are sourced from <strong>official and operator-verified data</strong>, actively managed
              by the <strong>NoLSAF Research Team</strong>. Accommodation is based on{" "}
              <strong>NoLSAF verified properties</strong>. Confirm final prices at time of booking.
            </p>
          </div>
        </div>

        {/* Data freshness per category */}
        <div className="relative overflow-hidden border-b border-[#02665e]/10">
          {/* Background: deep teal gradient with subtle texture */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#02665e] via-[#027a71] to-[#014d47]" />
          {/* Decorative circles for depth */}
          <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-white/5" />
          <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-white/5" />
          <div className="absolute top-2 right-16 w-10 h-10 rounded-full bg-[#02b4f5]/10" />

          <div className="relative flex flex-col gap-3 px-3 py-4 sm:flex-row sm:items-start sm:px-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/15 shadow-sm sm:mt-0.5">
              <Clock className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="text-sm font-bold tracking-tight text-white sm:text-[15px]">Rate Data - Last Verified</p>
                {result.dataFreshness?.lastUpdatedAt && (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-white/25 bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />
                    {fmtFresh(result.dataFreshness.lastUpdatedAt)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-x-4">
                {[
                  { label: "Park Fees",      ts: result.dataFreshness?.categories?.parkFees },
                  { label: "Visa Fees",      ts: result.dataFreshness?.categories?.visaFees },
                  { label: "Transport",      ts: result.dataFreshness?.categories?.transport },
                  { label: "Activities",     ts: result.dataFreshness?.categories?.activities },
                  { label: "Seasonal Rules", ts: result.dataFreshness?.categories?.pricingRules },
                  { label: "Accommodation",  ts: null },
                ].map(({ label, ts }) => (
                  <div key={label} className="flex min-w-0 items-start gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2.5">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight text-white">{label}</p>
                      <p className="mt-1 text-[11px] leading-tight text-white/65">
                        {ts ? fmtFresh(ts) : label === "Accommodation" ? "NoLSAF verified" : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-white/58">
                Maintained by NoLSAF Research Team ·{" "}
                Sources: TANAPA official rates · Tanzania Immigration · Operator market surveys
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer note ────────────────────────────────────────────────── */}
      <p className="text-xs text-slate-400 leading-relaxed bg-slate-50 px-4 py-3 rounded-lg">
        Prices shown are verified estimates. Final costs may vary with availability, exchange rates, and operator
        pricing at time of booking.
        {result.estimateId && (
          <span className="ml-1 font-semibold text-slate-500">Ref: EST-{result.estimateId}</span>
        )}
      </p>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        {/* Primary CTA - Book with NoLSAF */}
        <a
          href={(() => {
            // Smart extraction of destination names for relevant search results
            if (result?.destinations && result.destinations.length > 0) {
              // Helper to extract core location name from full destination name
              const extractLocationName = (fullName: string): string => {
                // Remove common generic terms to get the actual location name
                const genericTerms = [
                  'National Park',
                  'Conservation Area',
                  'Game Reserve',
                  'Nature Reserve',
                  'Archipelago',
                  'Island',
                  'Islands',
                  'Region',
                  'District',
                  'Mount',
                  'Lake',
                  'River',
                  'Bay',
                  'Peninsula',
                ];
                
                let cleaned = fullName;
                
                // Remove generic suffixes
                for (const term of genericTerms) {
                  const regex = new RegExp(`\\s+${term}$`, 'i');
                  cleaned = cleaned.replace(regex, '');
                }
                
                // Remove generic prefixes (like "Mount Kilimanjaro" → "Kilimanjaro")
                const prefixes = ['Mount', 'Lake', 'River', 'Cape'];
                for (const prefix of prefixes) {
                  const regex = new RegExp(`^${prefix}\\s+`, 'i');
                  if (regex.test(cleaned)) {
                    cleaned = cleaned.replace(regex, '');
                    break; // Only remove one prefix
                  }
                }
                
                return cleaned.trim() || fullName; // Fallback to original if empty
              };
              
              const destNamesList = result.destinations
                .map(code => {
                  const dest = availableDests.find((d: Destination) => d.code.toUpperCase() === code.toUpperCase());
                  const fullName = dest?.name || code;
                  // Extract meaningful location name (e.g., "Serengeti", "Zanzibar", "Kilimanjaro")
                  return extractLocationName(fullName);
                })
                .filter(Boolean);
              
              // IMPORTANT: The browse page uses a single LIKE text search for q=.
              // Joining multiple destinations with a comma (e.g. "Serengeti, Zanzibar") produces
              // a literal string match that returns 0 results. Instead:
              // - 1 destination  → use q= filter so results are relevant to the trip
              // - 2+ destinations → show all approved properties (let user filter from there)
              //   This prevents the blank/photo-less card problem on multi-destination trips.
              if (destNamesList.length === 1) {
                return `/public/properties?q=${encodeURIComponent(destNamesList[0])}`;
              }
              return `/public/properties`;
            }
            return "/public/properties";
          })()}
          className="group relative flex items-center justify-center gap-3 px-8 py-5 rounded-2xl text-base font-bold text-white transition-all duration-300 shadow-lg hover:shadow-2xl no-underline overflow-hidden"
          style={{ background: "linear-gradient(135deg, #02665e 0%, #014d47 100%)" }}
        >
          {/* Animated background layer */}
          <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
          <Calendar className="w-5 h-5 relative z-10" />
          <span className="relative z-10">Book with NoLSAF</span>
        </a>
        
        {/* Secondary Actions Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Share button with dropdown */}
          <div className="relative" ref={shareRef}>
            <button
              type="button"
              onClick={() => setShareOpen(!shareOpen)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 shadow-sm hover:shadow-md"
            >
              <Share2 className="w-4 h-4" />
              <span>Share</span>
            </button>
            
            {/* Share dropdown */}
            {shareOpen && (
              <div className="absolute bottom-full left-0 right-0 sm:left-auto sm:right-0 sm:min-w-[200px] mb-2 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition text-left"
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                      <span className="text-sm font-medium text-green-600">Link copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-slate-600 shrink-0" />
                      <span className="text-sm font-medium text-slate-700">Copy link</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition text-left border-t border-slate-100"
                >
                  <Download className="w-4 h-4 text-slate-600 shrink-0" />
                  <span className="text-sm font-medium text-slate-700">Print / Save PDF</span>
                </button>
              </div>
            )}
          </div>
          
          {/* Direct booking follow-up */}
          <Link
            href="/public/properties"
            className="flex items-center justify-center gap-2 px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 shadow-sm hover:shadow-md no-underline"
          >
            <Sparkles className="w-4 h-4" />
            <span>Browse stays</span>
          </Link>
          
          {/* New estimate */}
          <button
            type="button"
            onClick={onRestart}
            className="flex items-center justify-center gap-2 px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 shadow-sm hover:shadow-md"
          >
            <RefreshCw className="w-4 h-4" />
            <span>New estimate</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function HeroPill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/10 text-white/80 ${className}`}>
      {children}
    </span>
  );
}

function BreakdownRow({
  label,
  accent,
  icon,
  amount,
  total,
  detail,
}: {
  label: string;
  accent: string;
  icon: string;
  amount: number;
  total: number;
  detail?: string;
}) {
  const pct = total > 0 ? Math.min(100, (amount / total) * 100) : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}15` }}>
        <span className="text-lg">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-700 font-semibold">{label}</span>
          <span className="text-slate-900 font-bold tabular-nums">{fmtUSD(amount)}</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
          <div
            className="h-full rounded-full transition-all duration-500 shadow-sm"
            style={{ width: `${pct}%`, backgroundColor: accent }}
          />
        </div>
        {detail && <p className="text-xs text-slate-500 mt-1.5 font-medium">{detail}</p>}
      </div>
    </div>
  );
}
