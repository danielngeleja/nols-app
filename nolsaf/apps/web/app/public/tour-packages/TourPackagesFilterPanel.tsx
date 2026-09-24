"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Filter, Search, X } from "lucide-react";
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

// Words that describe the kind of thing, not the thing itself, so they never decide a match
const GENERIC_WORDS = new Set(["tours", "tour", "travel", "holidays", "holiday", "trips", "trip", "national", "park", "parks", "conservation", "area", "game", "reserve", "the", "and", "of", "&"]);

/** The meaningful lowercase words of a label: "Serengeti National Park" -> ["serengeti"]. */
function keyWords(label: string): string[] {
  const words = label.toLowerCase().split(/[\s,/()-]+/).filter(Boolean);
  const meaningful = words.filter((w) => !GENERIC_WORDS.has(w));
  return meaningful.length ? meaningful : words;
}

/** Whether an operator's text matches a search, category and park. */
function matchesLookup(bag: string, lookup: { q: string; category: string; park: string }): boolean {
  // Search: every word must appear somewhere, in any order ("serengeti safari" finds "Safari ... Serengeti")
  if (lookup.q && !lookup.q.split(/\s+/).filter(Boolean).every((word) => bag.includes(word))) return false;
  // Category: match on its meaningful words, so "Safari Tours" also finds "Wildlife Safari"
  if (lookup.category !== "All" && !keyWords(lookup.category).every((word) => bag.includes(word))) return false;
  // Park or site: match on the name without generic words ("Serengeti National Park" -> "serengeti")
  if (lookup.park !== "All" && !keyWords(lookup.park).every((word) => bag.includes(word))) return false;
  return true;
}

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
          apiClient.get<{ items?: NamedOption[] }>("/api/public/tourism-sites", { params: { country: "Tanzania" } }).catch(() => ({ data: { items: [] } })),
        ]);

        if (cancelled) return;

        const categoryItems = (categoryRes.data.items || [])
          .map((item) => (typeof item === "string" ? item : item.name))
          .map((item) => String(item || "").trim())
          .filter(Boolean);

        if (categoryItems.length > 0) {
          setCategories(Array.from(new Set(categoryItems)).sort((a, b) => a.localeCompare(b)));
        }

        // Coverage is Tanzania only (sites are requested for Tanzania), so e.g. Diani Beach, Kenya is not offered
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

  // What the listing holds overall, for the hero's live counts
  const catalogStats = useMemo(() => {
    let operators = 0;
    let packages = 0;
    for (const agent of agents) {
      if (!(Number(agent.id) > 0) || !/^[a-z0-9]{20,40}$/.test(String(agent.publicKey || ""))) continue;
      const live = (agent.profile?.packageItems || []).filter((pkg) =>
        ["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"].includes(String(pkg.status || "APPROVED").toUpperCase())
      ).length;
      if (!live) continue;
      operators += 1;
      packages += live;
    }
    return { operators, packages };
  }, [agents]);

  // Filters in use (search counts separately; sort counts only when changed)
  const activeFilterCount = (category !== "All" ? 1 : 0) + (parkOrSite !== "All" ? 1 : 0) + (sortBy !== "recommended" ? 1 : 0);
  const resetFilters = () => {
    setCategory("All");
    setParkOrSite("All");
    setSortBy("recommended");
  };
  const clearAll = () => {
    setSearch("");
    resetFilters();
  };
  const SORT_LABELS: Record<string, string> = { rating: "Top rated", "price-asc": "Price: low to high", "price-desc": "Price: high to low" };

  const hasActiveLookup = Boolean(search.trim() || category !== "All" || parkOrSite !== "All");
  const lookupLabel = search.trim() || (parkOrSite !== "All" ? parkOrSite : category !== "All" ? category : "your filters");
  // Every listable operator once, with the text that search and filters match against
  const catalog = useMemo(() => {
    const isApprovedPackage = (pkg: PublicTourPackageItem) => ["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"].includes(String(pkg.status || "APPROVED").toUpperCase());
    return agents
      .map((agent) => {
        const agentId = Number(agent.id);
        if (!Number.isFinite(agentId) || agentId <= 0) return null;
        const profile = agent.profile || {};
        const packages = (profile.packageItems || []).filter(isApprovedPackage);
        const agentPublicKey = String(agent.publicKey || "");
        if (!/^[a-z0-9]{20,40}$/.test(agentPublicKey) || !packages.length) return null;
        const p = profile as any;
        const bag = [
          profile.companyName,
          profile.physicalLocation,
          profile.businessAddress,
          ...(profile.operatingRegions || []),
          ...(p.registeredParks || []), // parks the operator is registered for (was missing, so park filters never matched)
          ...(profile.services || []),
          ...(profile.addOns || []),
          ...(profile.tourismTypes || []),
          ...(profile.specializations || []),
          ...Object.values((p.serviceClassification || {}) as Record<string, string[]>).flat(),
          ...packages.flatMap((pkg) => [pkg.name, pkg.title, pkg.destination, pkg.category]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return { agentId, agentPublicKey, agent, profile, packages, bag };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [agents]);

  /** How many operators match a given search, category and park, for the result count and suggestions. */
  const countMatches = (lookup: { q: string; category: string; park: string }) => catalog.filter((item) => matchesLookup(item.bag, lookup)).length;

  const operatorCards = useMemo(() => {
    const lookup = { q: search.trim().toLowerCase(), category, park: parkOrSite };
    const filtered = catalog.filter((item) => matchesLookup(item.bag, lookup));
    const priceOf = (pkg: PublicTourPackageItem) => Number(pkg.pricePerPerson || pkg.price || 0) || Number.POSITIVE_INFINITY;
    const confidenceOf = (item: (typeof filtered)[number]) => {
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
  }, [catalog, search, category, parkOrSite, sortBy]);

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
    <section className="min-w-0 overflow-x-clip">
      {/* overflow-x-clip, not -hidden: hidden makes this section a scroll box and draws a stray vertical scrollbar */}
      {/* One calm hero: title, one line, search and filters in it, live counts under it */}
      <div className="overflow-hidden rounded-3xl bg-[#024d47] text-white">
        <div className="px-4 py-6 sm:px-10 sm:py-10">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="m-0 text-[28px] font-extrabold leading-tight tracking-tight sm:text-[42px]">Tour Packages</h1>
            <p className="m-0 mt-1.5 text-[13.5px] text-white/70 sm:mt-2 sm:text-[15px]">Compare prices, inclusions and itineraries from verified operators.</p>

            <div className="mt-5 flex min-w-0 items-center gap-1.5 rounded-xl bg-white p-1 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.5)] sm:mt-6 sm:gap-2 sm:rounded-2xl sm:p-1.5">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search tours or operators</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 sm:left-3 sm:h-5 sm:w-5" aria-hidden />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search a tour, park or operator"
                  className="box-border h-9 w-full min-w-0 rounded-lg border-0 bg-transparent pl-8 pr-9 text-[13.5px] text-slate-900 outline-none placeholder:text-slate-400 sm:h-11 sm:rounded-xl sm:pl-10 sm:pr-10 sm:text-[14.5px]"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 sm:right-2 sm:h-7 sm:w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </label>
              <button
                type="button"
                onClick={() => setShowAdvanced((value) => !value)}
                aria-expanded={showAdvanced}
                aria-label="Filters"
                className={`inline-flex h-9 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border-0 px-2.5 text-[13.5px] font-semibold transition sm:h-11 sm:rounded-xl sm:px-4 ${
                  showAdvanced ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <Filter className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Filters</span>
                {activeFilterCount ? (
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${showAdvanced ? "bg-white text-[#02665e]" : "bg-[#02665e] text-white"}`}>
                    {activeFilterCount}
                  </span>
                ) : null}
                {showAdvanced ? <ChevronUp className="hidden h-4 w-4 sm:block" aria-hidden /> : <ChevronDown className="hidden h-4 w-4 sm:block" aria-hidden />}
              </button>
            </div>

            {/* Live counts from the listing, not fixed numbers */}
            <p className="m-0 mt-3 text-[11.5px] text-white/55 sm:mt-4 sm:text-[12.5px]">
              {agentsLoading ? (
                "Loading verified operators"
              ) : (
                <>
                  {catalogStats.operators} verified operator{catalogStats.operators === 1 ? "" : "s"} · {catalogStats.packages} package{catalogStats.packages === 1 ? "" : "s"}
                  {/* The fee note is long; phones get the short line only */}
                  <span className="hidden sm:inline"> · Prices per person, NoLSAF fee included</span>
                </>
              )}
            </p>
          </div>

        {showAdvanced ? (
            <div className="mx-auto mt-4 max-w-3xl space-y-3 rounded-2xl bg-white/[0.06] p-3 text-left ring-1 ring-white/10 sm:space-y-4 sm:p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="m-0 text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>Filters</h2>
                {activeFilterCount ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full border-0 bg-white/10 px-3 py-1 text-[12px] font-semibold text-white/85 transition hover:bg-white/20"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden /> Reset filters
                  </button>
                ) : null}
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

      {/* What is being shown, and one tap to undo any part of it */}
      {!agentsLoading && (search.trim() || activeFilterCount) ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[13.5px] text-slate-600">
            <span className="font-bold text-slate-900">{operatorCards.length}</span> of {catalogStats.operators} operator{catalogStats.operators === 1 ? "" : "s"}
          </span>
          {[
            search.trim() ? { key: "q", label: `"${search.trim()}"`, clear: () => setSearch("") } : null,
            category !== "All" ? { key: "c", label: category, clear: () => setCategory("All") } : null,
            parkOrSite !== "All" ? { key: "p", label: parkOrSite, clear: () => setParkOrSite("All") } : null,
            sortBy !== "recommended" ? { key: "s", label: SORT_LABELS[sortBy] || sortBy, clear: () => setSortBy("recommended") } : null,
          ]
            .filter((chip): chip is { key: string; label: string; clear: () => void } => Boolean(chip))
            .map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                aria-label={`Remove ${chip.label}`}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-solid border-[#02665e]/25 bg-[#02665e]/[0.06] py-1 pl-3 pr-2 text-[12.5px] font-semibold text-[#024d47] transition hover:bg-[#02665e]/[0.12]"
              >
                {chip.label}
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ))}
          <button
            type="button"
            onClick={clearAll}
            className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
          >
            Clear all
          </button>
        </div>
      ) : null}

      <div className="mt-6">
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
          (() => {
            // For each active filter: how many operators you would see without it
            const base = { q: search.trim().toLowerCase(), category, park: parkOrSite };
            const suggestions = [
              base.q ? { key: "q", label: `"${search.trim()}"`, count: countMatches({ ...base, q: "" }), undo: () => setSearch("") } : null,
              base.category !== "All" ? { key: "c", label: category, count: countMatches({ ...base, category: "All" }), undo: () => setCategory("All") } : null,
              base.park !== "All" ? { key: "p", label: parkOrSite, count: countMatches({ ...base, park: "All" }), undo: () => setParkOrSite("All") } : null,
            ]
              .filter((s): s is { key: string; label: string; count: number; undo: () => void } => Boolean(s))
              .sort((a, b) => b.count - a.count);
            return (
              <div className="mx-auto mt-2 max-w-xl rounded-3xl border border-solid border-slate-200 bg-white px-5 py-8 text-center sm:px-8">
                {isChecking ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-[14px] text-slate-500">
                    <Search className="h-4 w-4 animate-pulse text-[#02665e]" aria-hidden /> Checking verified tours
                  </div>
                ) : (
                  <>
                    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                      <Search className="h-6 w-6" aria-hidden />
                    </span>
                    <h2 className="m-0 mt-4 text-[19px] font-bold text-slate-900">No tours match all of these</h2>
                    <p className="m-0 mx-auto mt-1.5 max-w-sm text-[13.5px] leading-6 text-slate-500">
                      Nothing fits every filter at once. Remove one to see more.
                    </p>

                    {/* One tap back to results, best option first */}
                    {suggestions.length ? (
                      <div className="mt-5 space-y-2 text-left">
                        {suggestions.map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            onClick={s.undo}
                            disabled={s.count === 0}
                            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3 text-left transition hover:border-[#02665e]/40 hover:bg-[#02665e]/[0.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white"
                          >
                            <span className="inline-flex min-w-0 items-center gap-2 text-[13.5px] text-slate-700">
                              <X className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden />
                              <span className="truncate">
                                Remove <span className="font-semibold text-slate-900">{s.label}</span>
                              </span>
                            </span>
                            <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${s.count ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-400"}`}>
                              {s.count ? `${s.count} operator${s.count === 1 ? "" : "s"}` : "Still none"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={clearAll}
                      className="mt-4 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border-0 bg-transparent px-3 text-[13px] font-semibold text-[#02665e] hover:bg-[#02665e]/5"
                    >
                      Clear everything and show all {catalogStats.operators}
                    </button>
                  </>
                )}
              </div>
            );
          })()
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
