"use client";

// Tour companies roster. Filters run on the server (tier, area and language are
// filtered across the whole roster before paging). Each row opens the operator
// record at /admin/agents/[ref], which owns documents, suspension, notes and money.

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ChevronRight, ExternalLink, Loader2, RefreshCw, Search, Star, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useAdminHref } from "@/lib/adminRecordRefs";

const api = apiClient;

function unwrapApiData<T = any>(axiosData: any): T {
  // admin.agents endpoints respond as { ok: true, data: ... }
  return axiosData && typeof axiosData === "object" && "data" in axiosData ? (axiosData.data as T) : (axiosData as T);
}

function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

function initials(name: string | null | undefined) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "")).toUpperCase();
}

// "DANIEL NGELEJA" -> "Daniel Ngeleja"; mixed case is left as typed.
function tidyName(value: string | null | undefined) {
  const v = String(value || "").trim();
  if (!v || /[a-z]/.test(v)) return v;
  return v.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
}

type Agent = {
  id: number;
  status: string;
  areasOfOperation: string[] | null;
  languages: string[] | string | null;
  specializations: string[] | null;
  isAvailable: boolean;
  maxActiveRequests: number;
  currentActiveRequests: number;
  level?: string;
  completedTours?: number;
  noLSAFRevenue?: number;
  overallRating?: number | null;
  totalReviews?: number;
  nextLevel?: { level: string; progress: { overall: number } } | null;
  user: { id: number; name: string | null; fullName?: string | null; email: string | null; phone: string | null };
};

// Same tier colours as the tour operators register and the ladder editor.
const TIERS: Record<string, { label: string; hex: string; pill: string; dot: string }> = {
  BRONZE: { label: "Bronze", hex: "#e0a26f", pill: "bg-orange-50 text-orange-700", dot: "bg-orange-500" },
  SILVER: { label: "Silver", hex: "#94a3b8", pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  GOLD: { label: "Gold", hex: "#fbbf24", pill: "bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  PLATINUM: { label: "Platinum", hex: "#818cf8", pill: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-500" },
};
const tierOf = (level?: string | null) => TIERS[String(level || "BRONZE").toUpperCase()] ?? TIERS.BRONZE;

const STATUS: Record<string, { label: string; pill: string }> = {
  ACTIVE: { label: "Active", pill: "bg-emerald-50 text-emerald-700" },
  INACTIVE: { label: "Inactive", pill: "bg-neutral-100 text-neutral-600" },
  SUSPENDED: { label: "Suspended", pill: "bg-rose-50 text-rose-700" },
};

type SortKey = "company" | "tier" | "performance" | "status";

export default function AdminAgentsPage() {
  const router = useRouter();
  const recordHref = useAdminHref();
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [status, setStatus] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [areasOfOperation, setAreasOfOperation] = useState<string>("");
  const [languages, setLanguages] = useState<string>("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Client-side sort of the current page. null = API order (newest first).
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (searchParams) {
      setStatus(searchParams.get("status") || "");
      setLevel(searchParams.get("level") || "");
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedQ(q), 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, pageSize };
      if (status.trim()) params.status = sanitizeInput(status);
      if (level.trim()) params.level = sanitizeInput(level);
      if (areasOfOperation.trim()) params.areasOfOperation = sanitizeInput(areasOfOperation);
      if (languages.trim()) params.languages = sanitizeInput(languages);
      if (debouncedQ.trim()) params.q = sanitizeInput(debouncedQ);
      const response = await api.get("/api/admin/agents", { params });
      const payload = unwrapApiData<{ items: Agent[]; total: number }>(response.data);
      setAgents(payload?.items || []);
      setTotal(payload?.total || 0);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to load tour companies");
    } finally {
      setLoading(false);
    }
  }, [page, status, level, areasOfOperation, languages, debouncedQ]);

  useEffect(() => { void load(); }, [load]);

  // A filter change always starts from page 1; otherwise page 3 of a narrower result can be empty.
  useEffect(() => { setPage(1); }, [status, level, areasOfOperation, languages, debouncedQ]);

  // Roster totals for the header cards, independent of the filters below.
  const [rosterCounts, setRosterCounts] = useState({ loaded: false, all: 0, ACTIVE: 0, INACTIVE: 0, SUSPENDED: 0, available: 0 });
  const loadRosterCounts = useCallback(async () => {
    try {
      const count = (params: Record<string, string>) =>
        api.get("/api/admin/agents", { params: { page: 1, pageSize: 1, ...params } }).then((r) => Number(unwrapApiData<any>(r.data)?.total || 0));
      const [all, active, inactive, suspended, available] = await Promise.all([
        count({}),
        count({ status: "ACTIVE" }),
        count({ status: "INACTIVE" }),
        count({ status: "SUSPENDED" }),
        count({ status: "ACTIVE", available: "true" }),
      ]);
      setRosterCounts({ loaded: true, all, ACTIVE: active, INACTIVE: inactive, SUSPENDED: suspended, available });
    } catch {
      setRosterCounts((c) => ({ ...c, loaded: true }));
    }
  }, []);
  useEffect(() => { void loadRosterCounts(); }, [loadRosterCounts]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "company" || key === "status" ? "asc" : "desc"); }
  };
  const TIER_RANK: Record<string, number> = { BRONZE: 0, SILVER: 1, GOLD: 2, PLATINUM: 3 };
  const sortedAgents = (() => {
    if (!sortKey) return agents;
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (a: Agent): number | string => {
      switch (sortKey) {
        case "company": return (a.user?.fullName || a.user?.name || a.user?.email || "").toLowerCase();
        case "tier": return (TIER_RANK[(a.level || "BRONZE").toUpperCase()] ?? 0) * 100 + Number(a.nextLevel?.progress?.overall || 0);
        case "performance": return a.completedTours ?? 0;
        case "status": return (a.status || "").toLowerCase();
      }
    };
    return [...agents].sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));
  })();
  const sortMark = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtering = Boolean(debouncedQ || status || level || areasOfOperation || languages);

  return (
    <div id="tour-companies" className="w-full min-w-0 space-y-4">
      <style>{`#tour-companies, #tour-companies * { box-sizing: border-box; }`}</style>
      {/* Header: the roster at a glance; each status card filters the list */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.18)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Company operations</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tour companies</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Every hired tour company: status, tier, workload and documents. New companies join through hiring.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/management/careers?tab=applications" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Hire via applications
              </Link>
              <button type="button" onClick={() => { void load(); void loadRosterCounts(); }} aria-label="Refresh tour companies" title="Refresh" className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-solid border-white/15 bg-white/[0.06] text-white/85 transition-colors hover:bg-white/[0.12]">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {([
              ["", "All companies", rosterCounts.all, "Hired through applications", "bg-white/60"],
              ["ACTIVE", "Active", rosterCounts.ACTIVE, `${rosterCounts.available} taking new work`, "bg-emerald-400"],
              ["INACTIVE", "Inactive", rosterCounts.INACTIVE, "Not assigned work", "bg-white/30"],
              ["SUSPENDED", "Suspended", rosterCounts.SUSPENDED, rosterCounts.SUSPENDED ? "Review before restoring" : "No one suspended", "bg-rose-400"],
            ] as const).map(([value, label, count, note, dot]) => {
              const on = status === value;
              return (
                <button
                  key={value || "all"}
                  type="button"
                  onClick={() => setStatus(value)}
                  aria-pressed={on}
                  className={`min-w-0 cursor-pointer rounded-xl border border-solid p-3 text-left transition ${on ? "border-white/50 bg-white/[0.12]" : value === "SUSPENDED" && count ? "border-rose-300/30 bg-rose-400/[0.06] hover:bg-rose-400/[0.1]" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"}`}
                >
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
                    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden /> {label}
                  </span>
                  <span className={`mt-2 block text-2xl font-bold tabular-nums leading-none ${count ? "text-white" : "text-white/30"}`}>{rosterCounts.loaded ? count : "..."}</span>
                  <span className="mt-1 block truncate text-[11px] text-white/45">{note}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Filter bar */}
      <section className="min-w-0 rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-col gap-3 p-4 sm:px-5 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              type="text"
              placeholder="Company name, email or phone"
              value={q}
              onChange={(e) => { if (e.target.value.length <= 200) setQ(e.target.value); }}
              aria-label="Search tour companies"
              maxLength={200}
              className="block h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-neutral-400 hover:bg-neutral-100">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* Tier as chips in the tier colours used across the agents module */}
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by operator tier">
            {([
              ["", "Any tier", "bg-neutral-300"],
              ["BRONZE", "Bronze", "bg-orange-500"],
              ["SILVER", "Silver", "bg-slate-400"],
              ["GOLD", "Gold", "bg-amber-400"],
              ["PLATINUM", "Platinum", "bg-indigo-500"],
            ] as const).map(([value, label, dot]) => (
              <button
                key={value || "any"}
                type="button"
                onClick={() => setLevel(value)}
                aria-pressed={level === value}
                className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-solid px-2.5 text-xs font-semibold transition ${level === value ? "border-[#0b2420] bg-[#0b2420] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
              >
                <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:px-5">
          <label className="flex min-w-0 items-center gap-2">
            <span className="w-24 shrink-0 text-[11px] font-semibold text-neutral-500">Operates in</span>
            <input
              type="text"
              placeholder="Arusha, Serengeti, Zanzibar"
              value={areasOfOperation}
              onChange={(e) => { if (e.target.value.length <= 100) setAreasOfOperation(e.target.value); }}
              maxLength={100}
              className="block h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="flex min-w-0 items-center gap-2">
            <span className="w-24 shrink-0 text-[11px] font-semibold text-neutral-500">Speaks</span>
            <input
              type="text"
              placeholder="English, Swahili, French"
              value={languages}
              onChange={(e) => { if (e.target.value.length <= 50) setLanguages(e.target.value); }}
              maxLength={50}
              className="block h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <p className="m-0 flex items-center justify-end gap-3 text-xs text-neutral-500">
            <span>{loading ? "Searching" : <><span className="font-bold tabular-nums text-neutral-900">{total}</span> {total === 1 ? "company" : "companies"}</>}</span>
            {status || level || areasOfOperation || languages || q ? (
              <button
                type="button"
                onClick={() => { setStatus(""); setLevel(""); setAreasOfOperation(""); setLanguages(""); setQ(""); }}
                className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
              >
                Clear all
              </button>
            ) : null}
          </p>
        </div>
      </section>

      {/* Roster */}
      <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
        {loading && agents.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin text-[#02665e]" aria-hidden /> Loading tour companies
          </div>
        ) : error ? (
          <div className="px-6 py-14 text-center">
            <AlertCircle className="mx-auto h-7 w-7 text-rose-600" aria-hidden />
            <p className="m-0 mt-2 text-sm font-semibold text-rose-800">Could not load tour companies</p>
            <p className="m-0 mt-1 text-xs text-rose-600">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-4 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
            </button>
          </div>
        ) : agents.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="m-0 text-sm font-semibold text-neutral-800">{filtering ? "No tour company matches these filters" : "No tour companies yet"}</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">{filtering ? "Try a broader search or clear the filters." : "Companies appear here once an application is marked hired."}</p>
          </div>
        ) : (
          <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-0 border-b border-solid border-neutral-100">
                  {([
                    ["company", "Company"],
                    ["tier", "Tier"],
                    ["performance", "Track record"],
                  ] as const).map(([key, label]) => (
                    <th key={key} className="px-3 py-3 first:pl-5">
                      <button type="button" onClick={() => toggleSort(key)} className="cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400 hover:text-neutral-700">{label}{sortMark(key)}</button>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Operates in</th>
                  <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Speaks</th>
                  <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Load</th>
                  <th className="px-3 py-3">
                    <button type="button" onClick={() => toggleSort("status")} className="cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400 hover:text-neutral-700">Status{sortMark("status")}</button>
                  </th>
                  <th className="px-3 py-3 pr-5"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {sortedAgents.map((agent) => {
                  const name = tidyName(agent.user?.fullName || agent.user?.name) || agent.user?.email || "Unnamed company";
                  const tier = tierOf(agent.level);
                  const next = agent.nextLevel ? tierOf(agent.nextLevel.level) : null;
                  const st = STATUS[String(agent.status).toUpperCase()] ?? { label: agent.status, pill: "bg-neutral-100 text-neutral-600" };
                  const areas = list(agent.areasOfOperation);
                  const langs = list(agent.languages);
                  const max = Math.max(0, Number(agent.maxActiveRequests || 0));
                  const cur = Math.max(0, Number(agent.currentActiveRequests || 0));
                  const loadPct = max ? Math.min(100, Math.round((cur / max) * 100)) : 0;
                  const href = recordHref("agent", agent.id);
                  const suspended = String(agent.status).toUpperCase() === "SUSPENDED";
                  return (
                    <tr
                      key={agent.id}
                      onClick={() => router.push(href)}
                      className="cursor-pointer border-0 border-b border-solid border-neutral-100 transition hover:bg-emerald-50/40"
                    >
                      <td className="px-3 py-3 pl-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold ${suspended ? "bg-neutral-100 text-neutral-400" : "bg-[#0b2420] text-emerald-200"}`}
                            style={suspended ? undefined : { boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${tier.hex}` }}
                            aria-hidden
                          >
                            {initials(name)}
                          </span>
                          <span className="min-w-0">
                            <Link href={href} onClick={(e) => e.stopPropagation()} className="block max-w-[220px] truncate text-[13px] font-semibold text-neutral-900 no-underline hover:text-emerald-800 hover:underline">{name}</Link>
                            <span className="block max-w-[220px] truncate text-[11px] text-neutral-500">{[agent.user?.email, agent.user?.phone].filter(Boolean).join(" · ") || "No contact on file"}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tier.pill}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tier.dot}`} aria-hidden /> {tier.label}
                        </span>
                        {next ? <span className="mt-1 block text-[11px] tabular-nums text-neutral-400">{Math.round(agent.nextLevel!.progress.overall)}% to {next.label}</span> : <span className="mt-1 block text-[11px] text-neutral-400">Top tier</span>}
                      </td>
                      <td className="px-3 py-3">
                        {agent.completedTours || agent.totalReviews ? (
                          <>
                            <span className="flex items-center gap-2 font-semibold text-neutral-800">
                              <span className="tabular-nums">{agent.completedTours ?? 0} {agent.completedTours === 1 ? "tour" : "tours"}</span>
                              {agent.overallRating != null ? <span className="inline-flex items-center gap-0.5 tabular-nums text-amber-600"><Star className="h-3 w-3 fill-current" aria-hidden />{agent.overallRating.toFixed(1)}</span> : null}
                            </span>
                            <span className="block text-[11px] tabular-nums text-neutral-400">${Math.round(agent.noLSAFRevenue ?? 0).toLocaleString()} commission</span>
                          </>
                        ) : (
                          <span className="text-neutral-400">No tours yet</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {areas.length ? (
                          <span className="block max-w-[180px] truncate text-neutral-700" title={areas.join(", ")}>
                            {areas.slice(0, 2).join(", ")}{areas.length > 2 ? <span className="text-neutral-400"> +{areas.length - 2}</span> : null}
                          </span>
                        ) : <span className="text-neutral-400">Not set</span>}
                      </td>
                      <td className="px-3 py-3">
                        {langs.length ? (
                          <span className="block max-w-[160px] truncate text-neutral-700" title={langs.join(", ")}>
                            {langs.slice(0, 2).join(", ")}{langs.length > 2 ? <span className="text-neutral-400"> +{langs.length - 2}</span> : null}
                          </span>
                        ) : <span className="text-neutral-400">Not set</span>}
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center justify-between gap-2 text-[11px] tabular-nums text-neutral-500"><span>{cur}/{max}</span><span>{loadPct}%</span></span>
                        <span className="mt-1 block h-1.5 w-24 overflow-hidden rounded-full bg-neutral-100">
                          <span className={`block h-full rounded-full ${loadPct >= 100 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${loadPct}%` }} />
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${st.pill}`}>{st.label}</span>
                        {!suspended ? <span className={`mt-1 block text-[11px] ${agent.isAvailable ? "text-emerald-600" : "text-neutral-400"}`}>{agent.isAvailable ? "Taking work" : "Not taking work"}</span> : null}
                      </td>
                      <td className="px-3 py-3 pr-5 text-right">
                        <ChevronRight className="ml-auto h-4 w-4 text-neutral-300" aria-hidden />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > pageSize ? (
          <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 px-5 py-3 text-xs text-neutral-500">
            <span>Showing <span className="font-bold text-neutral-800">{(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)}</span> of <span className="font-bold text-neutral-800">{total}</span></span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(Math.max(1, page - 1))} aria-disabled={page <= 1} className="h-8 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 hover:bg-neutral-50 aria-disabled:pointer-events-none aria-disabled:opacity-40">Prev</button>
              <span className="tabular-nums">Page {page} of {pages}</span>
              <button type="button" onClick={() => setPage(Math.min(pages, page + 1))} aria-disabled={page >= pages} className="h-8 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 hover:bg-neutral-50 aria-disabled:pointer-events-none aria-disabled:opacity-40">Next</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
