"use client";

// Property owners directory, in the admin Sales page language: dark header band
// with headline numbers, a lifecycle track that filters, a cards/list directory,
// and a quiet owner record for the quick view.

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  PauseCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import TablePagination from "@/components/TablePagination";
import { adminRefOrId, useAdminHref } from "@/lib/adminRecordRefs";

type Owner = {
  id: number;
  name: string;
  email: string;
  propertiesCount?: number;
  region?: string | null;
  district?: string | null;
  status?: string;
  suspendedAt?: string | null;
  kycStatus?: string | null;
  _count?: { properties?: number };
};

const api = apiClient;
const pageSize = 20;

// Ghost buttons sitting on the dark header, as on the Sales pages.
const heroButton =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

// Owner lifecycle: one definition drives the track, the cards and the list.
const STAGES = [
  { key: "ACTIVE", label: "Active", hint: "Approved and able to host", icon: BadgeCheck, text: "text-emerald-700", dot: "bg-emerald-500", ring: "ring-emerald-500", bar: "bg-emerald-500", soft: "bg-emerald-50" },
  { key: "PENDING", label: "Pending", hint: "Waiting on KYC or review", icon: Clock3, text: "text-amber-700", dot: "bg-amber-500", ring: "ring-amber-400", bar: "bg-amber-400", soft: "bg-amber-50" },
  { key: "SUSPENDED", label: "Suspended", hint: "Access paused or closed", icon: PauseCircle, text: "text-rose-600", dot: "bg-rose-500", ring: "ring-rose-400", bar: "bg-rose-400", soft: "bg-rose-50" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

function computeOwnerStatus(input: { status?: string | null; suspendedAt?: string | null; kycStatus?: string | null }) {
  if (input.status && String(input.status).trim()) return String(input.status);
  if (input.suspendedAt) return "SUSPENDED";
  if (input.kycStatus) return String(input.kycStatus);
  return "ACTIVE";
}

/** Which lifecycle stage a raw status belongs to. */
function stageKeyOf(status?: string | null): StageKey {
  const s = String(status || "").toLowerCase();
  if (/suspend|close|cancel|reject|block|deleted/.test(s)) return "SUSPENDED";
  if (/pending|new|review|submitted|requires/.test(s)) return "PENDING";
  return "ACTIVE";
}
const stageOf = (status?: string | null) => STAGES.find((s) => s.key === stageKeyOf(status))!;

function humanize(value?: string | null) {
  const text = String(value || "").replace(/[_]+/g, " ").trim().toLowerCase().replace(/\bkyc\b/g, "KYC");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** Names and places typed in capitals ("DAR-ES-SALAAM") read as Title Case. */
function tidy(value?: string | null) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text
    .toLowerCase()
    .replace(/^dar[\s-]+es[\s-]+salaam$/, "dar es salaam")
    .replace(/(^|[\s-])([a-z])/g, (match, sep, ch, offset, whole) => (whole === "dar es salaam" && ch === "e" && offset === 3 ? match : sep + ch.toUpperCase()));
}

function initials(name: string) {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.charAt(0) || "") + (parts[1]?.charAt(0) || "")).toUpperCase() || "?";
}

function isDeletedAccount(o: Owner) {
  return /@nolsaf\.invalid$/i.test(o.email) || /^deleted owner$/i.test(o.name.trim());
}

function normalizeOwner(raw: any): Owner {
  const propertiesCount = raw?.propertiesCount ?? raw?._count?.properties ?? raw?._propertyCount ?? 0;
  const suspendedAt = raw?.suspendedAt ?? null;
  const kycStatus = raw?.kycStatus ?? null;
  const name = String(raw?.name ?? "").trim();
  return {
    id: Number(raw?.id),
    name: name && name !== "—" ? name : "",
    email: String(raw?.email ?? "").trim(),
    propertiesCount: Number(propertiesCount) || 0,
    region: raw?.region ?? null,
    district: raw?.district ?? null,
    suspendedAt,
    kycStatus,
    _count: raw?._count,
    status: computeOwnerStatus({ status: raw?.status ?? null, suspendedAt, kycStatus }),
  };
}

function displayName(o: Owner) {
  if (isDeletedAccount(o)) return "Deleted account";
  return tidy(o.name) || o.email || "Unnamed owner";
}

export default function OwnersPage() {
  const recordHref = useAdminHref();
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Owner | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordNotice, setRecordNotice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<StageKey | "">("");
  const [sort, setSort] = useState<"name:asc" | "properties:desc" | "region:asc" | "status:asc">("name:asc");
  const [view, setView] = useState<"cards" | "list">("list");

  // Remember the preferred directory view for this admin.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("admin.owners.view");
      if (saved === "cards" || saved === "list") setView(saved);
    } catch {}
  }, []);
  const changeView = (next: "cards" | "list") => {
    setView(next);
    try { window.localStorage.setItem("admin.owners.view", next); } catch {}
  };

  const loadOwners = async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch(`/api/admin/owners?page=1&limit=50`, { credentials: "include" });
      if (!res.ok) throw new Error(`Could not load owners (HTTP ${res.status}).`);
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) throw new Error("Your admin session may have expired. Please sign in again.");
      const json = await res.json();
      const list = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : [];
      setOwners(list.map(normalizeOwner));
    } catch (err: any) {
      setListError(err?.message ?? "Failed to load owners.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOwners();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [selected]);

  const all = useMemo(() => owners ?? [], [owners]);
  const counts = useMemo(() => {
    const out: Record<StageKey, number> = { ACTIVE: 0, PENDING: 0, SUSPENDED: 0 };
    for (const o of all) out[stageKeyOf(o.status)] += 1;
    return out;
  }, [all]);
  const totalProperties = useMemo(() => all.reduce((sum, o) => sum + (o.propertiesCount || 0), 0), [all]);
  const regionCount = useMemo(() => new Set(all.map((o) => tidy(o.region)).filter(Boolean)).size, [all]);
  const activeShare = all.length ? Math.round((counts.ACTIVE / all.length) * 100) : 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter((o) => {
      if (stage && stageKeyOf(o.status) !== stage) return false;
      if (!q) return true;
      return [o.name, o.email, o.region, o.district, String(o.id)].some((v) => String(v || "").toLowerCase().includes(q));
    });
    const [by, dir] = sort.split(":") as [string, "asc" | "desc"];
    const valueOf = (o: Owner): string | number =>
      by === "properties" ? o.propertiesCount || 0 : by === "region" ? String(o.region || "~").toLowerCase() : by === "status" ? stageKeyOf(o.status) : displayName(o).toLowerCase();
    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [all, query, stage, sort]);

  useEffect(() => {
    setPage(1);
  }, [query, stage, sort]);

  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const exportCsv = () => {
    const header = ["ID", "Name", "Email", "Properties", "Region", "District", "Status", "KYC"];
    const lines = filtered.map((o) => [o.id, displayName(o), o.email, o.propertiesCount ?? 0, tidy(o.region), tidy(o.district), humanize(o.status), humanize(o.kycStatus)]);
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `nolsaf-owners-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openOwner = (o: Owner) => {
    setSelected(o);
    setRecordError(null);
    setRecordNotice(null);
  };

  const refreshOwner = async () => {
    if (!selected) return;
    setActionLoading(true);
    setRecordError(null);
    try {
      const res = await api.get(`/api/admin/owners/${selected.id}`);
      if (res.data) {
        const ownerData = res.data.owner || res.data;
        const normalized = normalizeOwner({ ...selected, ...ownerData });
        // Keep region and district from the list if the detail endpoint omits them.
        setSelected({ ...normalized, region: normalized.region ?? selected.region ?? null, district: normalized.district ?? selected.district ?? null });
        setRecordNotice("Owner data refreshed.");
      }
    } catch (err: any) {
      setRecordError(err?.response?.data?.error || "Failed to refresh owner data.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="box-border w-full min-w-0 space-y-5">
      {/* Header: dark brand band with headline numbers */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Supply</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Property owners</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Everyone who lists properties on NoLSAF, with their status, location and listings.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={exportCsv} disabled={loading || filtered.length === 0} className={heroButton}>
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
              <button type="button" onClick={() => void loadOwners()} disabled={loading} className={`${heroButton} w-9 px-0`} aria-label="Refresh owners" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {[
              { label: "Owners", value: owners ? all.length.toLocaleString() : "...", detail: owners ? `${counts.SUSPENDED} suspended` : "" },
              { label: "Properties held", value: owners ? totalProperties.toLocaleString() : "...", detail: owners ? `${all.filter((o) => (o.propertiesCount || 0) > 0).length} owners with listings` : "" },
              { label: "Active", value: owners ? `${activeShare}%` : "...", detail: owners ? `${counts.ACTIVE} of ${all.length} owners` : "", tone: "text-emerald-300" },
              { label: "Regions", value: owners ? String(regionCount) : "...", detail: owners ? "Where owners are based" : "" },
            ].map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone || "text-white"}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail || " "}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {listError && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800" role="alert">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{listError}</span>
          <button type="button" onClick={() => void loadOwners()} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Retry</button>
        </div>
      )}

      {/* Lifecycle track */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {STAGES.map((s) => {
            const Icon = s.icon;
            const n = counts[s.key];
            const share = all.length ? Math.round((n / all.length) * 100) : 0;
            const active = stage === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStage((current) => (current === s.key ? "" : s.key))}
                aria-pressed={active}
                className={`min-w-0 cursor-pointer rounded-xl border border-solid p-3.5 text-left transition-all ${active ? `border-neutral-900 ${s.soft}` : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${s.text}`}><Icon className="h-3.5 w-3.5" /> {s.label}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{share}%</span>
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{owners ? n.toLocaleString() : "..."}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{s.hint}</span>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <span className={`block h-full rounded-full ${s.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Directory */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{stage ? `${STAGES.find((s) => s.key === stage)?.label} owners` : "All owners"}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading && !owners ? "Loading" : `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "result" : "results"}`}</p>
          </div>
          {stage && (
            <button type="button" onClick={() => setStage("")} className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
              <X className="h-3 w-3" /> Show all
            </button>
          )}
          <div className="ml-auto flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
            <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="box-border h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                placeholder="Search name, email, region or ID"
                aria-label="Search owners"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              aria-label="Sort owners"
              className="box-border h-9 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-sm text-neutral-700 outline-none focus:border-emerald-500"
            >
              <option value="name:asc">Name A to Z</option>
              <option value="properties:desc">Most properties</option>
              <option value="region:asc">Region</option>
              <option value="status:asc">By stage</option>
            </select>
            <div className="hidden rounded-lg bg-neutral-100 p-0.5 md:inline-flex" role="group" aria-label="Directory layout">
              {([["cards", LayoutGrid, "Cards"], ["list", List, "List"]] as const).map(([key, Icon, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => changeView(key)}
                  aria-pressed={view === key}
                  title={label}
                  className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border-0 transition-colors ${view === key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-400 hover:text-neutral-700"}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && !owners ? (
          <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading owners
          </div>
        ) : filtered.length === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
              <Building2 className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No matching owners</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">{query || stage ? "Try another stage or search." : "Owners appear here once they register to list a property."}</p>
          </div>
        ) : (
          <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
            {view === "list" ? (
              <div className="hidden overflow-x-auto border-0 border-t border-solid border-neutral-100 md:block">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="text-[11px] font-semibold text-neutral-400">
                      <th className="px-4 py-2.5 font-semibold sm:pl-5">Owner</th>
                      <th className="px-4 py-2.5 font-semibold">Stage</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Properties</th>
                      <th className="px-4 py-2.5 font-semibold">Location</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 sm:pr-5"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((o) => {
                      const s = stageOf(o.status);
                      const deleted = isDeletedAccount(o);
                      const name = displayName(o);
                      const place = [tidy(o.district), tidy(o.region)].filter(Boolean).join(", ");
                      return (
                        <tr key={o.id} onClick={() => openOwner(o)} className="cursor-pointer border-0 border-t border-solid border-neutral-100 transition-colors hover:bg-neutral-50/70">
                          <td className="px-4 py-3 sm:pl-5">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ring-offset-2 ${deleted ? "bg-neutral-200 text-neutral-500 ring-neutral-300" : `bg-neutral-900 text-white ${s.ring}`}`}>{deleted ? "?" : initials(name)}</span>
                              <div className="min-w-0">
                                <div className={`max-w-[18rem] truncate font-medium ${deleted ? "text-neutral-400" : "text-neutral-900"}`}>{name}</div>
                                <div className="max-w-[18rem] truncate text-xs text-neutral-400">{deleted ? `Owner #${o.id}` : o.email || "No email"}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${s.text}`}><span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}</span>
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums ${(o.propertiesCount || 0) > 0 ? "font-semibold text-neutral-900" : "text-neutral-400"}`}>{o.propertiesCount ?? 0}</td>
                          <td className={`px-4 py-3 ${place ? "text-neutral-700" : "text-neutral-400"}`}>{place || "Not set"}</td>
                          <td className="px-4 py-3 text-xs text-neutral-500">{humanize(o.status) || "Not set"}</td>
                          <td className="px-4 py-3 text-right sm:pr-5"><ChevronRight className="ml-auto h-4 w-4 text-neutral-300" aria-hidden /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Cards: always on phones, and on desktop when the Cards layout is chosen */}
            <div className={`grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3 2xl:grid-cols-4 ${view === "list" ? "md:hidden" : ""}`}>
              {paged.map((o) => {
                const s = stageOf(o.status);
                const deleted = isDeletedAccount(o);
                const name = displayName(o);
                const place = [tidy(o.district), tidy(o.region)].filter(Boolean).join(", ");
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => openOwner(o)}
                    className="group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white p-0 text-left transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_12px_28px_-18px_rgba(11,36,32,0.45)]"
                  >
                    <span className="flex items-start gap-3 px-4 pt-4">
                      <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-2 ring-offset-2 ${deleted ? "bg-neutral-200 text-neutral-500 ring-neutral-300" : `bg-neutral-900 text-white ${s.ring}`}`}>{deleted ? "?" : initials(name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-semibold ${deleted ? "text-neutral-400" : "text-neutral-900"}`}>{name}</span>
                        <span className="block truncate text-xs text-neutral-400">{deleted ? `Owner #${o.id}` : o.email || "No email"}</span>
                      </span>
                      <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-500" aria-hidden />
                    </span>
                    <span className="mt-3 flex items-center gap-1.5 px-4 text-xs text-neutral-500">
                      <MapPin className="h-3.5 w-3.5 text-neutral-400" /> {place || "Location not set"}
                    </span>
                    <span className={`mt-3 flex items-center gap-1.5 px-4 py-2 text-xs ${s.soft} ${s.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      <span className="font-semibold">{s.label}</span>
                      <span className="truncate opacity-80">· {humanize(o.status) || s.hint}</span>
                    </span>
                    <span className="grid grid-cols-3 gap-px bg-neutral-100">
                      {[
                        ["Properties", String(o.propertiesCount ?? 0)],
                        ["KYC", humanize(o.kycStatus) || "Not set"],
                        ["Owner", `#${o.id}`],
                      ].map(([label, value]) => (
                        <span key={label} className="min-w-0 bg-white px-3 py-2.5">
                          <span className="block text-[10px] text-neutral-400">{label}</span>
                          <span className="block truncate text-sm font-semibold tabular-nums text-neutral-900">{value}</span>
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>

            <TablePagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
          </div>
        )}
      </section>

      {/* Owner record */}
      {selected && (() => {
        const s = stageOf(selected.status);
        const deleted = isDeletedAccount(selected);
        return (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-neutral-950/45 p-3 backdrop-blur-sm sm:p-6" onMouseDown={() => setSelected(null)}>
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="owner-record-title"
              className="max-h-[calc(100dvh-24px)] w-full max-w-2xl overflow-y-auto rounded-xl border border-solid border-neutral-200 bg-white shadow-2xl"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-0 border-b border-solid border-neutral-200 bg-white px-5 py-4">
                <div className="min-w-0">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Property owner</p>
                  <h2 id="owner-record-title" className="mb-0 mt-1 truncate text-lg font-bold text-neutral-950">{displayName(selected)}</h2>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900" aria-label="Close owner record">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-5 p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-emerald-700">OWNER #{selected.id}</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-[10px] font-bold ${s.soft} ${s.text} border-transparent`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
                    </span>
                    {selected.kycStatus ? <span className="rounded-full border border-solid border-sky-100 bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700">KYC {humanize(selected.kycStatus)}</span> : null}
                    {deleted ? <span className="rounded-full border border-solid border-neutral-200 bg-neutral-100 px-2.5 py-1 text-[10px] font-bold text-neutral-600">Deleted account</span> : null}
                  </div>
                  <p className="mb-0 mt-2 break-all text-sm font-semibold text-neutral-800">{deleted ? "Email removed with the account" : selected.email || "No email"}</p>
                </div>

                <dl className="grid grid-cols-2 border-0 border-y border-solid border-neutral-200 md:grid-cols-4">
                  {[
                    ["Properties", String(selected.propertiesCount ?? 0)],
                    ["Region", tidy(selected.region) || "Not set"],
                    ["District", tidy(selected.district) || "Not set"],
                    ["Status", humanize(selected.status) || "Not set"],
                  ].map(([label, value], index) => (
                    <div key={label} className={`min-w-0 px-3 py-3 ${index % 2 ? "border-0 border-l border-solid border-neutral-200" : ""} md:border-0 md:border-l md:border-solid md:border-neutral-200 ${index === 0 ? "md:border-l-0" : ""}`}>
                      <dt className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">{label}</dt>
                      <dd className="mb-0 mt-1 truncate text-xs font-semibold text-neutral-700">{value}</dd>
                    </div>
                  ))}
                </dl>

                {selected.suspendedAt ? (
                  <p className="m-0 rounded-lg bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                    Suspended on {new Date(selected.suspendedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })}.
                  </p>
                ) : null}

                {recordNotice ? <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /> {recordNotice}</p> : null}
                {recordError ? <p className="m-0 rounded-lg bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{recordError}</p> : null}

                <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-neutral-200 pt-4">
                  <Link href={recordHref("owner", selected.id)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-3.5 text-xs font-bold text-white no-underline shadow-sm transition hover:bg-emerald-800 hover:no-underline">
                    <ExternalLink className="h-4 w-4" /> Open full owner page
                  </Link>
                  <Link href={`/admin/properties/previews?ownerId=${adminRefOrId("owner", selected.id)}`} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-700 no-underline shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 hover:no-underline">
                    <Building2 className="h-4 w-4" /> View properties
                  </Link>
                  <button type="button" onClick={() => void refreshOwner()} disabled={actionLoading} className="ml-auto inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-xs font-semibold text-neutral-500 transition hover:text-neutral-900 disabled:opacity-50">
                    <RefreshCw className={`h-3.5 w-3.5 ${actionLoading ? "animate-spin" : ""}`} /> Refresh
                  </button>
                </div>
              </div>
            </section>
          </div>
        );
      })()}
    </div>
  );
}
