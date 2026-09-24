"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Filter, Search } from "lucide-react";
import apiClient from "@/lib/apiClient";
import PublicTourOperatorCard, { type PublicTourOperatorProfile, type PublicTourPackageItem } from "@/components/PublicTourOperatorCard";

type NamedOption = {
  id?: number | string;
  name: string;
  country?: string;
};

type PublicAgent = {
  id?: number;
  publicKey?: string;
  level?: string;
  totalCompletedTrips?: number;
  profile?: PublicTourOperatorProfile | null;
};

const defaultCategories = [
  "Safari Tours",
  "Beach Holidays",
  "Cultural Tours",
  "Mountain Trekking",
  "City Tours",
  "Family Travel",
];

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_20px_40px_rgba(15,23,42,0.07)]">
      {/* Company name line above card */}
      <div className="mb-2 h-4 w-2/3 animate-pulse rounded-full bg-slate-200" />
      {/* Photo area */}
      <div className="relative h-52 w-full animate-pulse bg-slate-200">
        {/* Dots */}
        <div className="absolute bottom-2.5 left-0 right-0 flex justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1 w-4 rounded-sm bg-white/40" />
          ))}
        </div>
      </div>
      {/* Body */}
      <div className="space-y-3 p-4">
        {/* Location + price row */}
        <div className="h-10 w-full animate-pulse rounded-xl bg-slate-100" />
        {/* Service chips grid */}
        <div className="grid grid-cols-2 gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-7 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
        {/* CTA button */}
        <div className="h-11 w-full animate-pulse rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}

export default function TourPackagesFilterPanel() {
  const [search, setSearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [category, setCategory] = useState("All");
  const [parkOrSite, setParkOrSite] = useState("All");
  const [sortBy, setSortBy] = useState("recommended");
  const [categories, setCategories] = useState<string[]>(defaultCategories);
  const [parksAndSites, setParksAndSites] = useState<NamedOption[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [systemCommission, setSystemCommission] = useState<number>(15);

  useEffect(() => {
    let cancelled = false;

    async function loadFilters() {
      try {
        const [categoryRes, sitesRes] = await Promise.all([
          apiClient.get<{ items?: Array<{ name?: string } | string> }>("/api/public/agents/categories").catch(() => ({ data: { items: [] } })),
          apiClient.get<{ items?: NamedOption[] }>("/api/public/tourism-sites", { params: { country: "all" } }).catch(() => ({ data: { items: [] } })),
        ]);

        if (cancelled) return;

        const categoryItems = (categoryRes.data.items || [])
          .map((item) => (typeof item === "string" ? item : item.name))
          .map((item) => String(item || "").trim())
          .filter(Boolean);

        if (categoryItems.length > 0) {
          setCategories(Array.from(new Set(categoryItems)).sort((a, b) => a.localeCompare(b)));
        }

        setParksAndSites((sitesRes.data.items || []).filter((item) => item?.name));
      } catch {
        // Keep the static fallbacks so the public page still renders.
      }
    }

    void loadFilters();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSystemCommission() {
      try {
        const res = await fetch("/api/public/support/system-settings", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const loaded = Number(data?.agentCommissionPercent ?? data?.commissionPercent ?? 15);
        if (!cancelled && Number.isFinite(loaded)) {
          setSystemCommission(loaded);
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

  useEffect(() => {
    let cancelled = false;

    async function loadApprovedOperators() {
      setAgentsLoading(true);
      try {
        const res = await apiClient.get<{ items?: PublicAgent[] }>("/api/public/agents", { params: { page: 1, pageSize: 50 } });
        if (!cancelled) setAgents(res.data.items || []);
      } catch {
        if (!cancelled) setAgents([]);
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    }

    void loadApprovedOperators();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasActiveLookup = Boolean(search.trim() || category !== "All" || parkOrSite !== "All");
  const lookupLabel = search.trim() || (parkOrSite !== "All" ? parkOrSite : category !== "All" ? category : "your filters");
  const operatorCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    const isApprovedPackage = (pkg: PublicTourPackageItem) => {
      const status = String(pkg.status || "APPROVED").toUpperCase();
      return ["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"].includes(status);
    };

    const cards = agents
      .map((agent) => {
        const agentId = Number(agent.id);
        if (!Number.isFinite(agentId) || agentId <= 0) return null;
        const profile = agent.profile || {};
        const packages = (profile.packageItems || []).filter(isApprovedPackage);
        const agentPublicKey = String(agent.publicKey || "");
        if (!/^[a-z0-9]{20,40}$/.test(agentPublicKey)) return null;
        return { agentId, agentPublicKey, agent, profile, packages };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => item.packages.length > 0);

    const filtered = cards.filter(({ profile, packages }) => {
      const bag = [
        profile.companyName,
        profile.physicalLocation,
        profile.businessAddress,
        ...(profile.operatingRegions || []),
        ...(profile.services || []),
        ...(profile.addOns || []),
        ...(profile.tourismTypes || []),
        ...(profile.specializations || []),
        ...packages.flatMap((pkg) => [pkg.name, pkg.title, pkg.destination, pkg.category]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (q && !bag.includes(q)) return false;
      if (category !== "All" && !bag.includes(category.toLowerCase())) return false;
      if (parkOrSite !== "All" && !bag.includes(parkOrSite.toLowerCase())) return false;
      return true;
    });

    const priceOf = (pkg: PublicTourPackageItem) => Number(pkg.pricePerPerson || pkg.price || 0) || Number.POSITIVE_INFINITY;
    const confidenceOf = (item: typeof filtered[number]) => {
      const confidence = (item.profile as any)?.tripConfidence || {};
      const score = Number(confidence?.score || 0);
      const totalRatings = Number(confidence?.totalRatings || 0);
      return score > 0 && totalRatings > 0 ? score : -1;
    };
    return [...filtered].sort((a, b) => {
      if (sortBy === "price-asc") return Math.min(...a.packages.map(priceOf)) - Math.min(...b.packages.map(priceOf));
      if (sortBy === "price-desc") return Math.min(...b.packages.map(priceOf)) - Math.min(...a.packages.map(priceOf));
      if (sortBy === "rating") {
        const scoreDelta = confidenceOf(b) - confidenceOf(a);
        if (scoreDelta !== 0) return scoreDelta;
        return Number(b.agent.totalCompletedTrips || 0) - Number(a.agent.totalCompletedTrips || 0);
      }
      return Number(b.agent.totalCompletedTrips || 0) - Number(a.agent.totalCompletedTrips || 0);
    });
  }, [agents, search, category, parkOrSite, sortBy]);

  useEffect(() => {
    if (!hasActiveLookup) {
      setHasSearched(false);
      setIsChecking(false);
      return;
    }

    setHasSearched(true);
    setIsChecking(true);
    const timeout = window.setTimeout(() => setIsChecking(false), 450);
    return () => window.clearTimeout(timeout);
  }, [hasActiveLookup, search, category, parkOrSite]);

  return (
    <section className="mt-10 min-w-0 overflow-x-hidden">
      <div
        className="overflow-hidden rounded-xl"
        style={{
          backgroundColor: "#02665e",
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.16) 1px, transparent 1.2px), linear-gradient(135deg, rgba(255,255,255,0.05), rgba(0,0,0,0.08))",
          backgroundPosition: "0 0, 0 0",
          backgroundSize: "30px 30px, auto",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 8px 32px rgba(2,102,94,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        <div className="px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
          <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <label className="min-w-0 flex-1">
            <span className="sr-only">Search</span>
                <div className="relative w-full min-w-0 max-w-full">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 sm:left-3 sm:h-5 sm:w-5" style={{ color: "rgba(255,255,255,0.54)" }} aria-hidden />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search package or operator"
                    className="box-border w-full min-w-0 max-w-full rounded-lg py-2 pl-9 pr-3 text-xs font-medium outline-none transition-all placeholder:text-white/45 sm:py-2.5 sm:pl-10 sm:pr-4 sm:text-sm"
                    style={{ background: "#0b6f68", border: "1.5px solid rgba(255,255,255,0.20)", color: "rgba(255,255,255,0.92)" }}
              />
            </div>
              </label>

          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
                className="flex flex-shrink-0 items-center justify-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold transition-all sm:px-2.5 sm:py-1.5"
                style={showAdvanced ? { background: "#0b6f68", border: "1.5px solid rgba(255,255,255,0.30)", color: "#ffffff" } : { background: "#0b6f68", border: "1.5px solid rgba(255,255,255,0.20)", color: "rgba(255,255,255,0.86)" }}
            aria-expanded={showAdvanced}
                aria-label="Advanced Filters"
                title="Advanced Filters"
          >
                <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
                <span className="hidden sm:inline">Advanced Filters</span>
                <span className="hidden sm:inline-flex">
                  {showAdvanced ? <ChevronUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />}
                </span>
          </button>
            </div>
        </div>

        {showAdvanced ? (
            <div className="mt-3 space-y-3 rounded-lg bg-[#075d56]/80 p-3 sm:mt-4 sm:space-y-4 sm:p-4" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>Advanced Filters</h2>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Category</span>
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="box-border w-full rounded-lg px-3 py-2 text-xs outline-none transition-all sm:text-sm"
                    style={{ background: "#0b6f68", border: "1.5px solid rgba(255,255,255,0.20)", color: "rgba(255,255,255,0.90)" }}
                  >
                    <option value="All" style={{ background: "#0d2320" }}>All</option>
                    {categories.map((item) => (
                      <option key={item} value={item} style={{ background: "#0d2320" }}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Parks &amp; Sites</span>
                  <select
                    value={parkOrSite}
                    onChange={(event) => setParkOrSite(event.target.value)}
                    className="box-border w-full rounded-lg px-3 py-2 text-xs outline-none transition-all sm:text-sm"
                    style={{ background: "#0b6f68", border: "1.5px solid rgba(255,255,255,0.20)", color: "rgba(255,255,255,0.90)" }}
                  >
                    <option value="All" style={{ background: "#0d2320" }}>All Parks & Sites</option>
                    {parksAndSites.map((site) => (
                      <option key={site.id ?? `${site.country || "site"}-${site.name}`} value={site.name} style={{ background: "#0d2320" }}>
                        {site.name}
                        {site.country ? `, ${site.country}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Sort</span>
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value)}
                    className="box-border w-full rounded-lg px-3 py-2 text-xs outline-none transition-all sm:text-sm"
                    style={{ background: "#0b6f68", border: "1.5px solid rgba(255,255,255,0.20)", color: "rgba(255,255,255,0.90)" }}
                  >
                    <option value="recommended" style={{ background: "#0d2320" }}>Recommended</option>
                    <option value="rating" style={{ background: "#0d2320" }}>Top Rated</option>
                    <option value="price-asc" style={{ background: "#0d2320" }}>Price: Low to High</option>
                    <option value="price-desc" style={{ background: "#0d2320" }}>Price: High to Low</option>
                  </select>
                </label>
              </div>
            </div>
        ) : null}
          </div>
      </div>

      <div className="mt-8">
        {agentsLoading ? (
          <>
            {/* Mobile skeleton carousel */}
            <div className="flex gap-4 overflow-x-hidden pb-3 sm:hidden">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-[78vw] flex-none">
                  <SkeletonCard />
                </div>
              ))}
            </div>
            {/* sm+ skeleton grid */}
            <div className="hidden gap-5 sm:grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </>
        ) : operatorCards.length > 0 ? (
          <>
            {/* Mobile: horizontal snap carousel — 3 cards visible, scroll right */}
            <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 sm:hidden" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {operatorCards.map(({ agentId, agentPublicKey, profile, packages }) => (
                <div key={agentId} className="w-[78vw] flex-none snap-start">
                  <PublicTourOperatorCard
                    agentId={agentId}
                    agentPublicKey={agentPublicKey}
                    profile={profile}
                    packages={packages}
                    commissionPercent={systemCommission}
                  />
                </div>
              ))}
            </div>
            {/* sm+: grid, sized like the stays grid now the card matches the stay card: 2 cols on sm/md, 4 on lg, 5 on xl+ */}
            <div className="hidden gap-5 sm:grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {operatorCards.map(({ agentId, agentPublicKey, profile, packages }) => (
                <PublicTourOperatorCard
                  key={agentId}
                  agentId={agentId}
                  agentPublicKey={agentPublicKey}
                  profile={profile}
                  packages={packages}
                  commissionPercent={systemCommission}
                />
              ))}
            </div>
          </>
        ) : hasSearched ? (
        <div className="mt-5 rounded-2xl border border-[#02665e]/25 bg-white px-4 py-5 text-center shadow-[0_12px_30px_rgba(2,102,94,0.08)] sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#02665e]">
            {isChecking ? "Checking approved packages" : "No approved package found yet"}
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-700">
            {isChecking
              ? `Searching for ${lookupLabel} among approved tour packages...`
              : `We could not find an approved tour package matching ${lookupLabel} right now. Try another destination, park, site, or tour category while we continue onboarding verified operators and packages.`}
          </p>
        </div>
        ) : (
        <div className="mt-8 rounded-3xl border border-dashed border-[#02665e]/35 bg-emerald-50/70 px-5 py-7 text-center shadow-[0_14px_34px_rgba(2,102,94,0.08)] sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#02665e]">Tour Packages Onboarding</p>
          <h2 className="mt-3 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">Thank you for exploring Tour Packages</h2>
          <p className="mx-auto mt-3 max-w-3xl text-sm leading-6 text-slate-700 sm:text-base">
            We are currently working on onboarding verified tour packages so you can soon find the option that fits you best.
            For now, continue enjoying the NoLSAF services that are already available.
          </p>
          <div className="mt-5 flex justify-center">
            <Link
              href="/public/properties"
              className="inline-flex items-center rounded-full bg-[#02665e] px-5 py-2.5 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-[#02554f]"
            >
              Browse Properties
            </Link>
          </div>
        </div>
        )}
      </div>
    </section>
  );
}
