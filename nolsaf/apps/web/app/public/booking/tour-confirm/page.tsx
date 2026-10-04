"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import DatePickerField from "@/components/DatePickerField";
import { TANZANIA_LOCATIONS } from "@/lib/tanzania-locations";
import {
  ChevronLeft,
  ChevronDown,
  ShieldCheck,
  Users,
  CalendarDays,
  Phone,
  Mail,
  User,
  Globe2,
  Plane,
  BadgeCheck,
  CheckCircle2,
  Tag,
  MapPin,
  Loader2,
  Lock,
  Clock,
  Minus,
  Plus,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeTzPhone(raw: string): string | null {
  let n = raw.replace(/[\s\-()]/g, "");
  const hasPlus = n.startsWith("+");
  n = (hasPlus ? "+" : "") + n.replace(/\+/g, "");
  if (n.startsWith("+255")) { /* ok */ }
  else if (n.startsWith("255") && n.length === 12) n = `+${n}`;
  else if (n.startsWith("0") && n.length === 10) n = `+255${n.slice(1)}`;
  else return null;
  if (!/^(\+255)(6|7|2)\d{8}$/.test(n)) return null;
  return n;
}

/** Nationality suggestions (same list as the stay booking): Tanzania and the region first, then common visitor origins. */
const NATIONALITIES = [
  "Tanzanian", "Kenyan", "Ugandan", "Rwandan", "Burundian", "Congolese", "Zambian", "Malawian", "Mozambican",
  "South Sudanese", "Somali", "Ethiopian", "Comorian", "South African", "Zimbabwean", "Botswanan", "Namibian",
  "Nigerian", "Ghanaian", "Egyptian", "Moroccan", "Algerian", "Tunisian", "Sudanese", "Senegalese", "Cameroonian",
  "Ivorian", "Malagasy", "Mauritian", "Angolan",
  "British", "American", "Canadian", "German", "French", "Italian", "Spanish", "Dutch", "Belgian", "Swiss",
  "Swedish", "Norwegian", "Danish", "Finnish", "Irish", "Polish", "Portuguese", "Russian", "Ukrainian", "Czech",
  "Austrian", "Chinese", "Indian", "Pakistani", "Japanese", "Korean", "Emirati", "Saudi", "Omani", "Qatari",
  "Israeli", "Turkish", "Iranian", "Australian", "New Zealander", "Brazilian", "Mexican", "Argentine",
];

/** Drop digits and collapse spaces; letters and punctuation stay as typed. */
function cleanNationality(value: string): string {
  return String(value ?? "").replace(/\d+/g, "").replace(/\s+/g, " ");
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function fmt(n: number, currency = "TZS"): string {
  return `${currency} ${Number(n).toLocaleString("en-US")}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Package = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  destination?: string;
  category?: string;
  duration?: string | number;
  pricePerPerson?: number;
  price?: number;
  currency?: string;
  minPax?: number;
  maxPax?: number;
  images?: string[];
};

type OperatorProfile = {
  companyName?: string;
  contactPhone?: string;
  contactEmail?: string;
  tagline?: string;
  logoUrl?: string;
  packageItems?: Package[];
  commissionPercent?: string | number;
};

type AgentData = {
  id: number;
  publicKey: string;
  profile: OperatorProfile;
};

// ── Component ─────────────────────────────────────────────────────────────────
const TANZANIA_INTERNATIONAL_AIRPORTS = TANZANIA_LOCATIONS.filter(
  (location) => location.category === "airport" && /international airport/i.test(location.label)
);

export default function TourConfirmPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const agentKey = String(searchParams?.get("agentKey") || "").trim().toLowerCase();
  const packageId = searchParams?.get("packageId") || "";
  const travelersParam = searchParams?.get("travelers") || "";

  const [agent, setAgent] = useState<AgentData | null>(null);
  const [pkg, setPkg] = useState<Package | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemCommission, setSystemCommission] = useState(15);

  // Form state
  const [travelers, setTravelers] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [nationality, setNationality] = useState("");
  const [nationalityOpen, setNationalityOpen] = useState(false);
  const [nationalityCursor, setNationalityCursor] = useState(0);
  const [departureAirportId, setDepartureAirportId] = useState("");
  const [cancellationPolicyAccepted, setCancellationPolicyAccepted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [prefilledFromAccount, setPrefilledFromAccount] = useState(false);

  // Signed-in guests: prefill name, phone, email and nationality, as the stay
  // booking does. Only empty fields are filled, so nothing typed is overwritten.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/account/me", { credentials: "include", cache: "no-store" });
        if (!res.ok) return; // not signed in: leave the form empty
        const json = await res.json().catch(() => null);
        const me = json?.data ?? json ?? null;
        if (!alive || !me || typeof me !== "object") return;
        const name = String(me.fullName || me.name || "").trim();
        const phone = String(me.phone || "").trim();
        const email = String(me.email || "").trim();
        const nat = String(me.nationality || "").trim();
        if (name) setGuestName((v) => v || name);
        if (phone) setGuestPhone((v) => v || normalizeTzPhone(phone) || phone);
        if (email) setGuestEmail((v) => v || email);
        if (nat) setNationality((v) => v || cleanNationality(nat));
        if (name || phone || email) setPrefilledFromAccount(true);
      } catch {
        /* offline or signed out: the guest fills the form by hand */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ── Load agent/package ────────────────────────────────────────────────────
  const loadAgent = useCallback(async () => {
    if (!/^[a-z0-9]{20,40}$/.test(agentKey) || !packageId) {
      setLoadError("Missing booking information. Please go back and select a package.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/public/agents/${encodeURIComponent(agentKey)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Operator not found");
      const data = await res.json();
      setAgent(data);
      const found = (data.profile?.packageItems as Package[] | undefined)?.find(
        (p, idx) => String(p.id ?? idx) === packageId
      );
      if (!found) throw new Error("Package not found");
      setPkg(found);
      // Default traveler count to minPax, or the count picked on the operator
      // profile, kept inside the package's group limits
      const minPax = Math.max(1, Number(found.minPax) || 1);
      const maxPax = Math.max(minPax, Number(found.maxPax) || Number.MAX_SAFE_INTEGER);
      const picked = Math.floor(Number(travelersParam));
      setTravelers(Number.isFinite(picked) && picked > 0 ? Math.min(maxPax, Math.max(minPax, picked)) : minPax);
    } catch (err: any) {
      setLoadError(err?.message || "Failed to load package information.");
    } finally {
      setLoading(false);
    }
  }, [agentKey, packageId, travelersParam]);

  useEffect(() => { void loadAgent(); }, [loadAgent]);

  useEffect(() => {
    let cancelled = false;

    async function loadSystemCommission() {
      try {
        const res = await fetch("/api/public/support/system-settings", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const loaded = Number(data?.agentCommissionPercent ?? data?.commissionPercent ?? 15);
        if (!cancelled && Number.isFinite(loaded)) {
          setSystemCommission(Math.max(0, loaded));
        }
      } catch {
        // Keep default fallback.
      }
    }

    void loadSystemCommission();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!guestName.trim()) { setFormError("Please enter your full name."); return; }
    if (!startDate) { setFormError("Please select your preferred travel date."); return; }
    if (!guestPhone.trim()) { setFormError("Please enter your phone number."); return; }
    const phoneForApi = normalizeTzPhone(guestPhone);
    if (!phoneForApi) {
      setFormError("Please enter a valid phone number. Example: +255 7XX XXX XXX or 07XX XXX XXX.");
      return;
    }
    if (!guestEmail.trim()) { setFormError("Please enter your email address."); return; }
    if (!isValidEmail(guestEmail.trim())) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (!nationality.trim()) { setFormError("Please enter your nationality."); return; }
    if (!cancellationPolicyAccepted) { setFormError("Please review and accept the Tour Package Cancellation and Refund Policy."); return; }
    const minPax = Math.max(1, Number(pkg?.minPax) || 1);
    const maxPax = Math.max(minPax, Number(pkg?.maxPax) || minPax);
    if (travelers < minPax || travelers > maxPax) {
      setFormError(`Traveler count must be between ${minPax} and ${maxPax}.`);
      return;
    }

    setSubmitting(true);
    const departureAirport = TANZANIA_INTERNATIONAL_AIRPORTS.find((airport) => airport.id === departureAirportId);
    try {
      const res = await fetch("/api/public/tour-bookings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorAgentId: agent?.id,
          packageId,
          travelerCount: travelers,
          startDate: startDate ? new Date(startDate).toISOString() : null,
          guestName: guestName.trim(),
          guestPhone: phoneForApi,
          guestEmail: guestEmail.trim(),
          nationality: nationality.trim(),
          notes: "",
          cancellationPolicyAccepted: true,
          metadata: {
            departureAirport: departureAirport
              ? {
                  id: departureAirport.id,
                  label: departureAirport.label,
                  shortLabel: departureAirport.shortLabel,
                  city: departureAirport.city,
                  iataCode: departureAirport.iataCode ?? null,
                  lat: departureAirport.lat,
                  lng: departureAirport.lng,
                }
              : null,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error || data?.message || "Failed to create booking";
        throw new Error(msg);
      }

      const tourBookingId = data.booking?.id;
      const accessToken = data.accessToken;
      if (!tourBookingId || !accessToken) throw new Error("Booking created but missing payment info.");

      router.push(
        `/public/booking/tour-payment?tourBookingId=${tourBookingId}&accessToken=${encodeURIComponent(accessToken)}`
      );
    } catch (err: any) {
      setFormError(err?.message || "Booking failed. Please try again.");
      setSubmitting(false);
    }
  }

  // ── Price calculation ─────────────────────────────────────────────────────
  const baseUnitPrice = Number(pkg?.pricePerPerson || pkg?.price || 0);
  const profileCommission = Number(agent?.profile?.commissionPercent);
  const effectiveCommissionPercent = Number.isFinite(profileCommission)
    ? Math.max(0, profileCommission)
    : Math.max(0, systemCommission);
  const unitPrice = baseUnitPrice > 0
    ? Math.round(baseUnitPrice * (1 + effectiveCommissionPercent / 100) * 100) / 100
    : 0;
  const currency = pkg?.currency || "TZS";
  const total = unitPrice * travelers;
  const minPax = Math.max(1, Number(pkg?.minPax) || 1);
  const maxPax = Math.max(minPax, Number(pkg?.maxPax) || minPax);
  const pkgName = pkg?.name || pkg?.title || "Tour Package";

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#f5faf9]">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
          style={{ background: "linear-gradient(135deg, #02665e, #4ecdc4)" }}
        >
          <Tag className="w-7 h-7 text-white" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-[#02665e]" />
        <p className="text-sm text-gray-400">Loading package details…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5faf9] px-4">
        <div className="bg-white rounded-2xl border border-red-200 p-6 max-w-sm w-full text-center shadow-sm">
          <p className="text-sm text-red-600 mb-4">{loadError}</p>
          <button type="button" onClick={() => router.back()} className="cursor-pointer border-0 bg-transparent text-[#02665e] text-sm font-semibold underline">
            Go back
          </button>
        </div>
      </div>
    );
  }

  // Shared package hero card — rendered in mobile header AND desktop sidebar
  const packageHeroCard = (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-solid border-[#02665e]/10">
      <div
        className="px-5 pt-5 pb-4"
        style={{ background: "linear-gradient(135deg, #02665e 0%, #028570 55%, #3ab8af 100%)" }}
      >
        <span className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm text-white/90 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mb-3">
          <Tag className="w-2.5 h-2.5" /> Selected Package
        </span>
        <h2 className="text-xl font-extrabold text-white leading-snug">{pkgName}</h2>
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          {pkg?.destination && (
            <span className="flex items-center gap-1 text-white/85 text-xs bg-white/15 px-2.5 py-1 rounded-full">
              <MapPin className="w-3 h-3 flex-shrink-0" />{pkg.destination}
            </span>
          )}
          {pkg?.category && (
            <span className="flex items-center gap-1 text-white/85 text-xs bg-white/15 px-2.5 py-1 rounded-full">
              <BadgeCheck className="w-3 h-3 flex-shrink-0" />{pkg.category}
            </span>
          )}
          {pkg?.duration && (
            <span className="flex items-center gap-1 text-white/85 text-xs bg-white/15 px-2.5 py-1 rounded-full">
              <Clock className="w-3 h-3 flex-shrink-0" />
              {pkg.duration}{typeof pkg.duration === "number" ? " days" : ""}
            </span>
          )}
        </div>
      </div>
      {unitPrice > 0 && (
        <div className="bg-white px-5 py-3.5 flex items-center justify-between">
          <span className="text-sm text-gray-400">
            {fmt(unitPrice, currency)}&nbsp;<span className="text-gray-300">/ person</span>
          </span>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-none mb-0.5">Estimated total</p>
            <p className="text-lg font-extrabold text-[#02665e] leading-none">{fmt(total, currency)}</p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f5faf9]">

      {/* ── Sticky top bar ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-0 border-b border-solid border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button
            type="button"
            aria-label="Back"
            onClick={() => router.back()}
            className="-ml-2 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent transition-colors hover:bg-gray-100 active:bg-gray-200"
          >
            <ChevronLeft className="w-5 h-5 text-gray-700" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 leading-tight truncate">Book Tour Package</p>
            <p className="text-xs text-gray-400 truncate">{agent?.profile?.companyName || "Tour Operator"}</p>
          </div>
          <span className="flex-shrink-0 text-[10px] font-bold text-[#02665e] bg-[#02665e]/10 px-2.5 py-1 rounded-full tracking-wide">
            STEP 1 OF 2
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-10 xl:gap-14 lg:items-start">

          {/* ─── LEFT: Form ──────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Package card — mobile only (desktop shows it in sidebar) */}
            <div className="lg:hidden">{packageHeroCard}</div>

        {/* ── Booking form ─────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── Section 1: Trip Details ─────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-solid border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center gap-2.5">
              <span
                className="w-6 h-6 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #02665e, #4ecdc4)" }}
              >1</span>
              <h3 className="text-sm font-bold text-gray-800">Trip Details</h3>
            </div>

            {/* Traveler stepper */}
            <div className="px-5 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-gray-800">
                    <Users className="w-4 h-4 text-[#02665e]" /> Travelers
                  </p>
                  <p className="m-0 mt-0.5 text-[12.5px] text-gray-400">
                    {minPax === maxPax ? `Fixed group: ${minPax}` : `Group of ${minPax} to ${maxPax}`}
                  </p>
                </div>
                {/* Pill stepper; preflight is off, so buttons need their own background and border */}
                <div className="inline-flex items-center rounded-full border border-solid border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    aria-label="Fewer travellers"
                    onClick={() => setTravelers((v) => Math.max(minPax, v - 1))}
                    disabled={travelers <= minPax}
                    className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-slate-700 transition-colors hover:bg-[#02665e]/5 hover:text-[#02665e] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-9 text-center text-[18px] font-black tabular-nums text-gray-900" aria-live="polite">{travelers}</span>
                  <button
                    type="button"
                    aria-label="More travellers"
                    onClick={() => setTravelers((v) => Math.min(maxPax, v + 1))}
                    disabled={travelers >= maxPax}
                    className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-slate-700 transition-colors hover:bg-[#02665e]/5 hover:text-[#02665e] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="mx-5 border-0 border-t border-solid border-gray-100" />

            {/* Travel date */}
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-gray-500 mb-2.5 flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5 text-[#02665e]" /> Preferred Travel Date
                <span className="text-red-500 ml-0.5">*</span>
              </p>
              <DatePickerField
                label="Select travel date"
                value={startDate}
                onChangeAction={(iso) => setStartDate(iso)}
                min={new Date().toISOString().slice(0, 10)}
                widthClassName="w-full"
                allowPast={false}
              />
            </div>
          </div>

          {/* ── Section 2: Your Information ── (no overflow-hidden: the nationality list drops below the card) */}
          <div className="relative z-10 bg-white rounded-2xl border border-solid border-gray-100 shadow-sm">
            <div className="px-5 pt-4 pb-3 flex items-center gap-2.5">
              <span
                className="w-6 h-6 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #02665e, #4ecdc4)" }}
              >2</span>
              <h3 className="text-sm font-bold text-gray-800">Your Information</h3>
              {prefilledFromAccount ? (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#02665e]/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-[#02665e]">
                  <BadgeCheck className="h-3 w-3" aria-hidden />
                  Filled from your account
                </span>
              ) : null}
            </div>

            <div className="px-5 pb-5">
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                {/* Full name */}
                <div className="min-w-0">
                  <label className="flex items-center gap-1 text-xs font-medium text-slate-600 mb-1">
                    <User className="w-3 h-3 text-gray-400" />
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="e.g. John Doe"
                    autoComplete="name"
                    className="block w-full max-w-full min-w-0 box-border rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-[#02665e]"
                  />
                </div>

                {/* Phone */}
                <div className="min-w-0">
                  <label className="flex items-center gap-1 text-xs font-medium text-slate-600 mb-1">
                    <Phone className="w-3 h-3 text-gray-400" />
                    Phone Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="07XX XXX XXX or +255 7XX XXX XXX"
                    autoComplete="tel"
                    className="block w-full max-w-full min-w-0 box-border rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-[#02665e]"
                  />
                  <p className="mt-1 text-[10px] leading-4 text-slate-400">You&apos;ll use this number to pay via mobile money</p>
                </div>

                {/* Email */}
                <div className="min-w-0">
                  <label className="flex items-center gap-1 text-xs font-medium text-slate-600 mb-1">
                    <Mail className="w-3 h-3 text-gray-400" />
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="your@email.com"
                    autoComplete="email"
                    required
                    className="block w-full max-w-full min-w-0 box-border rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-[#02665e]"
                  />
                </div>

                {/* Nationality: type to search a known list, same as the stay booking; anything else is kept as typed ("Other") */}
                {(() => {
                  const q = nationality.trim().toLowerCase();
                  const known = NATIONALITIES.some((n) => n.toLowerCase() === q);
                  const matches = (q
                    ? NATIONALITIES.filter((n) => n.toLowerCase().startsWith(q)).concat(
                        NATIONALITIES.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))
                      )
                    : NATIONALITIES.slice(0, 8)
                  ).slice(0, 7);
                  const showOther = q.length >= 2 && !known;
                  const options = [...matches, ...(showOther ? ["__other__"] : [])];
                  const pick = (value: string) => {
                    setNationality(cleanNationality(value));
                    setNationalityOpen(false);
                  };
                  return (
                    <div className="relative min-w-0">
                      <label htmlFor="tour-nationality" className="flex items-center gap-1 text-xs font-medium text-slate-600 mb-1">
                        <Globe2 className="w-3 h-3 text-gray-400" />
                        Nationality <span className="text-red-500">*</span>
                      </label>
                      <span className="relative block">
                        <input
                          id="tour-nationality"
                          type="text"
                          role="combobox"
                          aria-expanded={nationalityOpen}
                          aria-controls="tour-nationality-options"
                          aria-autocomplete="list"
                          value={nationality}
                          autoComplete="off"
                          onFocus={() => {
                            setNationalityOpen(true);
                            setNationalityCursor(0);
                          }}
                          onBlur={() => window.setTimeout(() => setNationalityOpen(false), 120)}
                          onChange={(e) => {
                            setFormError(null);
                            setNationality(cleanNationality(e.target.value));
                            setNationalityOpen(true);
                            setNationalityCursor(0);
                          }}
                          onKeyDown={(e) => {
                            if (!nationalityOpen || options.length === 0) return;
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              setNationalityCursor((c) => Math.min(options.length - 1, c + 1));
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault();
                              setNationalityCursor((c) => Math.max(0, c - 1));
                            } else if (e.key === "Enter") {
                              e.preventDefault();
                              const chosen = options[nationalityCursor];
                              pick(chosen === "__other__" ? nationality : chosen);
                            } else if (e.key === "Escape") {
                              setNationalityOpen(false);
                            }
                          }}
                          placeholder="Search, e.g. Tanzanian"
                          className={`block w-full max-w-full min-w-0 box-border rounded-md border border-solid bg-white py-2 pl-3 pr-16 text-sm text-gray-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-[#02665e] ${known ? "border-[#02665e]/50" : "border-slate-200"}`}
                        />
                        {known ? (
                          <CheckCircle2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#02665e]" aria-hidden />
                        ) : nationality ? (
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500">Other</span>
                        ) : null}
                      </span>

                      {nationalityOpen && options.length > 0 && (
                        <ul
                          id="tour-nationality-options"
                          role="listbox"
                          className="absolute left-0 right-0 top-full z-30 m-0 mt-1 max-h-64 list-none overflow-y-auto rounded-xl border border-solid border-slate-200 bg-white p-1 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.35)]"
                        >
                          {options.map((opt, i) => {
                            const active = i === nationalityCursor;
                            const isOther = opt === "__other__";
                            return (
                              <li
                                key={opt}
                                role="option"
                                aria-selected={active}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  pick(isOther ? nationality : opt);
                                }}
                                onMouseEnter={() => setNationalityCursor(i)}
                                className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-[14px] ${
                                  active ? "bg-[#02665e]/[0.07] text-[#02665e]" : "text-slate-700"
                                } ${isOther ? "mt-1 border-0 border-t border-solid border-slate-100" : ""}`}
                              >
                                {isOther ? (
                                  <span className="min-w-0 truncate">
                                    Use <span className="font-semibold">&ldquo;{nationality.trim()}&rdquo;</span>
                                    <span className="ml-1.5 text-[12px] text-slate-400">Other</span>
                                  </span>
                                ) : (
                                  <span className="min-w-0 truncate">{opt}</span>
                                )}
                                {!isOther && opt.toLowerCase() === q && <CheckCircle2 className="h-4 w-4 flex-none text-[#02665e]" aria-hidden />}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* ── Section 3: Special Requests ──────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-solid border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full border-2 border-solid border-gray-200 text-gray-400 text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">3</span>
              <h3 className="text-sm font-bold text-gray-800">Departure Airport</h3>
            </div>
            <div className="px-5 pb-5">
              <div>
                <label htmlFor="departure-airport" className="block text-sm font-medium text-slate-700">
                  Select your Departure Airport <span className="text-[10px] font-semibold text-[#02665e]">(important, optional)</span>
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  This will help us schedule your pickup.
                </p>

                <div className="relative mt-3">
                  <Plane className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <select
                    id="departure-airport"
                    value={departureAirportId}
                    onChange={(e) => setDepartureAirportId(e.target.value)}
                    className="block w-full appearance-none rounded-md border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-[#02665e]"
                  >
                    <option value="">Select departure airport</option>
                    {TANZANIA_INTERNATIONAL_AIRPORTS.map((airport) => (
                      <option key={airport.id} value={airport.id}>
                        {airport.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              </div>
            </div>
          </div>
          </div>

          {/* Form error */}
          {formError && (
            <div className="rounded-xl bg-red-50 border border-solid border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <span className="flex-shrink-0 font-bold text-red-400 mt-0.5">!</span>
              {formError}
            </div>
          )}

          {/* Price summary */}
          {unitPrice > 0 && (
            <div className="bg-white rounded-2xl border border-solid border-gray-100 shadow-sm px-5 py-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-500">
                  {fmt(unitPrice, currency)} × {travelers} {travelers === 1 ? "person" : "people"}
                </span>
                <span className="font-semibold text-gray-700">{fmt(total, currency)}</span>
              </div>
              <div className="flex items-center justify-between border-0 border-t border-solid border-gray-100 pt-2.5">
                <span className="text-sm font-bold text-gray-800">Total Due</span>
                <span className="text-lg font-extrabold text-[#02665e]">{fmt(total, currency)}</span>
              </div>
            </div>
          )}

          {/* Submit button */}
          {/* Policy acceptance as a real switch: preflight is off, so the native checkbox rendered invisible */}
          <div
            className={`rounded-2xl border border-solid p-4 transition-colors ${
              cancellationPolicyAccepted ? "border-[#02665e]/40 bg-[#02665e]/[0.05]" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-start gap-3">
              <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${cancellationPolicyAccepted ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"}`}>
                <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p id="policy-switch-label" className="m-0 text-[14px] font-semibold leading-snug text-slate-900">
                  I accept the cancellation and refund policy
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["24-hour cooling-off", "Partial refund window", "Some parts non-refundable", "Rules once the tour starts"].map((point) => (
                    <span key={point} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-600">{point}</span>
                  ))}
                </div>
                <Link href="/cancellation-policy" target="_blank" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#02665e] no-underline hover:underline">
                  Read the full policy
                  <span aria-hidden>↗</span>
                </Link>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={cancellationPolicyAccepted}
                aria-labelledby="policy-switch-label"
                onClick={() => {
                  setFormError(null);
                  setCancellationPolicyAccepted((v) => !v);
                }}
                className={`relative mt-1 inline-flex h-7 w-12 flex-shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/40 focus-visible:ring-offset-2 ${
                  cancellationPolicyAccepted ? "bg-[#02665e]" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${cancellationPolicyAccepted ? "translate-x-5" : "translate-x-0"}`}
                />
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !cancellationPolicyAccepted}
            className="w-full cursor-pointer border-0 py-4 rounded-2xl text-white font-bold text-base disabled:opacity-60 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2 shadow-lg shadow-[#02665e]/25"
            style={{
              background: submitting
                ? "#9ca3af"
                : "linear-gradient(135deg, #02665e 0%, #4ecdc4 100%)",
            }}
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating booking…
              </>
            ) : (
              <>
                <Lock className="w-5 h-5" />
                Continue to Payment
              </>
            )}
          </button>

          {/* Trust badges */}
          <div className="grid grid-cols-3 gap-2 pb-4">
            {[
              { Icon: ShieldCheck, label: "Secure booking" },
              { Icon: BadgeCheck, label: "Verified operator" },
              { Icon: Lock, label: "Payment protected" },
            ].map(({ Icon, label }) => (
              <div key={label} className="bg-white rounded-xl border border-solid border-gray-100 shadow-sm px-2 py-3 flex flex-col items-center gap-1.5 text-center">
                <Icon className="w-4 h-4 text-[#02665e]" />
                <span className="text-[10px] font-medium text-gray-500 leading-tight">{label}</span>
              </div>
            ))}
          </div>

        </form>
          </div>{/* end left column */}

          {/* ─── RIGHT: Sticky sidebar (desktop only) ────────────────────── */}
          <div className="hidden lg:block">
            <div className="sticky top-24 space-y-4">

              {packageHeroCard}

              {/* Live booking summary */}
              <div className="bg-white rounded-2xl border border-solid border-gray-100 shadow-sm p-5">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4">Booking summary</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[#02665e]" /> Travelers
                    </span>
                    <span className="font-bold text-gray-900">{travelers} {travelers === 1 ? "person" : "people"}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5 text-[#02665e]" /> Travel date
                    </span>
                    <span className="font-bold text-gray-900">
                      {startDate
                        ? new Date(startDate + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
                        : <span className="text-gray-300 font-normal text-xs">Not selected</span>}
                    </span>
                  </div>
                  {unitPrice > 0 && (
                    <>
                      <div className="flex items-center justify-between text-xs text-gray-400 pt-1">
                        <span>{fmt(unitPrice, currency)} × {travelers}</span>
                        <span>{fmt(total, currency)}</span>
                      </div>
                      <div className="flex items-center justify-between border-0 border-t border-solid border-gray-100 pt-3">
                        <span className="text-sm font-bold text-gray-800">Total Due</span>
                        <span className="text-xl font-extrabold text-[#02665e]">{fmt(total, currency)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Trust list */}
              <div className="bg-white rounded-2xl border border-solid border-gray-100 shadow-sm p-5 space-y-3.5">
                {[
                  { Icon: ShieldCheck, title: "Secure booking", desc: "Your data is encrypted and safe" },
                  { Icon: BadgeCheck, title: "Verified operator", desc: "All operators are vetted by NoLSAF" },
                  { Icon: Lock, title: "Payment protected", desc: "Secure mobile money transaction" },
                ].map(({ Icon, title, desc }) => (
                  <div key={title} className="flex items-start gap-3">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-[#02665e]/10 flex-shrink-0">
                      <Icon className="w-3.5 h-3.5 text-[#02665e]" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-800">{title}</p>
                      <p className="text-[11px] text-gray-400 leading-snug">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </div>{/* end right sidebar */}

        </div>{/* end grid */}
      </div>
    </div>
  );
}
