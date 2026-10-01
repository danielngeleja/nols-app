"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BedDouble,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";

type BookingRow = {
  id: number;
  /** Opaque id for the booking URL. */
  reference?: string;
  status: string;
  checkIn: string;
  checkOut: string;
  guestName?: string | null;
  guestPhone?: string | null;
  roomCode?: string | null;
  totalAmount?: number | string | null;
  createdAt?: string;
  property?: { id: number; title?: string; regionName?: string | null; city?: string | null };
  code?: { code: string | null; status: string | null } | null;
  invoice?: { id: number; status: string | null; total: number | string | null; paidAt: string | null } | null;
  payment?: { amount: number | string | null; method: string | null; paidAt: string | null } | null;
  user?: { id: number; name: string | null; email: string | null; phone: string | null } | null;
  draftExpiresAt?: string | null;
  draftExpiryStatus?: "ACTIVE" | "EXPIRED" | null;
};

type PropertyOption = { id: number; title: string; regionName?: string | null; district?: string | null };
type SortKey = "newest" | "oldest" | "checkInAsc" | "checkInDesc";

const PAGE_SIZE = 25;

/** Booking lifecycle. The filter keys are the API's; CHECKED_IN on the API also returns PENDING_CHECKIN. */
const STAGES: Array<{ key: string; label: string; hint: string; icon: typeof Clock; text: string; bar: string; soft: string; pill: string; counts: string[] }> = [
  { key: "DRAFT", label: "Awaiting payment", hint: "Invoice created, not paid", icon: Clock, text: "text-amber-700", bar: "bg-amber-400", soft: "bg-amber-50/70", pill: "bg-amber-50 text-amber-800 ring-amber-200", counts: ["DRAFT"] },
  { key: "CONFIRMED", label: "Confirmed", hint: "Paid, guest yet to arrive", icon: CalendarCheck, text: "text-emerald-700", bar: "bg-emerald-500", soft: "bg-emerald-50/70", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", counts: ["CONFIRMED"] },
  { key: "CHECKED_IN", label: "In house", hint: "Checked in or arriving now", icon: LogIn, text: "text-sky-700", bar: "bg-sky-500", soft: "bg-sky-50/70", pill: "bg-sky-50 text-sky-700 ring-sky-200", counts: ["CHECKED_IN", "PENDING_CHECKIN"] },
  { key: "CHECKED_OUT", label: "Checked out", hint: "Stay completed", icon: LogOut, text: "text-violet-700", bar: "bg-violet-500", soft: "bg-violet-50/70", pill: "bg-violet-50 text-violet-700 ring-violet-200", counts: ["CHECKED_OUT"] },
  { key: "CANCELED", label: "Cancelled", hint: "Called off", icon: XCircle, text: "text-rose-700", bar: "bg-rose-500", soft: "bg-rose-50/70", pill: "bg-rose-50 text-rose-700 ring-rose-200", counts: ["CANCELED"] },
];

const STATUS_LABEL: Record<string, string> = {
  NEW: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PENDING_CHECKIN: "Checking in",
  CHECKED_IN: "In house",
  CHECKED_OUT: "Checked out",
  CANCELED: "Cancelled",
};

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";
const fieldClass =
  "box-border h-9 min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

function stageForStatus(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "NEW") return STAGES[0];
  if (s === "PENDING_CHECKIN") return STAGES[2];
  return STAGES.find((st) => st.key === s) ?? null;
}

function eatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Africa/Dar_es_Salaam" });
}

function eatYear(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function todayEat() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" });
}

function nightsBetween(a: string, b: string) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : 0;
}

function tzs(value: number | string | null | undefined) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return null;
  return `TSh ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function hoursLeft(iso: string) {
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  return h <= 0 ? "expired" : h < 24 ? `${h} h left to pay` : `${Math.round(h / 24)} days left to pay`;
}

export default function BookingsManagementPage() {
  const [items, setItems] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [propertyId, setPropertyId] = useState("all");
  const [propertyOptions, setPropertyOptions] = useState<PropertyOption[]>([]);
  const [propertyOptionsLoading, setPropertyOptionsLoading] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [stayingToday, setStayingToday] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Search runs on the server across every booking, after a short pause.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (propertyId !== "all") params.set("propertyId", propertyId);
        if (status) params.set("status", status);
        if (search) params.set("q", search);
        const r = await fetch(`/api/admin/bookings?${params.toString()}`, { credentials: "include" });
        if (!r.ok) throw new Error(`Could not load bookings (${r.status}).`);
        const j = await r.json();
        if (!mounted) return;
        setItems(j.items ?? []);
        setTotal(j.total ?? 0);
      } catch (e: any) {
        console.error("bookings fetch", e);
        if (mounted) {
          setError(e?.message ?? "Failed to load bookings");
          setItems([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [page, propertyId, status, search, reloadKey]);

  // Platform-wide numbers for the header and the lifecycle cards.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Only real stays count as "staying today": confirmed or in house, not
        // unpaid drafts or cancellations that happen to overlap the date.
        const todayTotal = (st: string) =>
          fetch(`/api/admin/bookings?date=${todayEat()}&status=${st}&page=1&pageSize=1`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => (j && typeof j.total === "number" ? j.total : null));
        const [c, confirmedToday, inHouseToday] = await Promise.all([
          fetch("/api/admin/bookings/counts", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
          todayTotal("CONFIRMED"),
          todayTotal("CHECKED_IN"),
        ]);
        if (!mounted) return;
        if (c && typeof c === "object") setCounts(c);
        if (confirmedToday != null || inHouseToday != null) setStayingToday((confirmedToday ?? 0) + (inHouseToday ?? 0));
      } catch {
        // header numbers are informational; the list still works without them
      }
    })();
    return () => { mounted = false; };
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        setPropertyOptionsLoading(true);
        const r = await fetch(`/api/admin/properties/booked?status=APPROVED&page=1&pageSize=5000`, { credentials: "include", signal: controller.signal });
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        const opts = Array.isArray(j?.items) ? j.items : [];
        setPropertyOptions(
          opts
            .map((p: any) => ({ id: Number(p.id), title: String(p.title ?? `Property #${p.id}`), regionName: p.regionName ?? null, district: p.district ?? null }))
            .filter((p: PropertyOption) => Number.isFinite(p.id)),
        );
      } catch {
        setPropertyOptions([]);
      } finally {
        setPropertyOptionsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const sorted = useMemo(() => {
    const copy = [...items];
    const t = (v: string) => (Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0);
    copy.sort((a, b) => {
      if (sortKey === "oldest") return a.id - b.id;
      if (sortKey === "checkInAsc") return t(a.checkIn) - t(b.checkIn);
      if (sortKey === "checkInDesc") return t(b.checkIn) - t(a.checkIn);
      return b.id - a.id;
    });
    return copy;
  }, [items, sortKey]);

  const countOf = (keys: string[]) => keys.reduce((sum, k) => sum + Number(counts?.[k] ?? 0), 0);
  const allCount = counts ? STAGES.reduce((sum, st) => sum + countOf(st.counts), 0) : null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersOn = Boolean(status || search || propertyId !== "all");
  const activeStage = status ? STAGES.find((s) => s.key === status) : null;
  const propertyName = propertyId !== "all" ? propertyOptions.find((p) => String(p.id) === propertyId)?.title : null;

  const facts = [
    { label: "Bookings", value: allCount != null ? allCount.toLocaleString() : "...", detail: "paid, in progress, completed or cancelled", tone: "text-white" },
    { label: "Staying today", value: stayingToday != null ? stayingToday.toLocaleString() : "...", detail: `confirmed or in house on ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Dar_es_Salaam" })}`, tone: stayingToday ? "text-emerald-300" : "text-white" },
    { label: "Upcoming", value: counts ? countOf(["CONFIRMED"]).toLocaleString() : "...", detail: "confirmed, guest yet to arrive", tone: "text-white" },
    { label: "Awaiting payment", value: counts ? countOf(["DRAFT"]).toLocaleString() : "...", detail: "invoice created, not yet paid", tone: countOf(["DRAFT"]) ? "text-amber-300" : "text-white" },
  ];

  const pickStatus = (key: string) => {
    setStatus((current) => (current === key ? null : key));
    setPage(1);
  };

  const clearFilters = () => {
    setStatus(null);
    setSearchInput("");
    setSearch("");
    setPropertyId("all");
    setSortKey("newest");
    setPage(1);
  };

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Stays</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Bookings</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Every property booking on the platform, from unpaid drafts to completed stays. Open one for payments, check-in code and the full timeline.</p>
            </div>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Lifecycle, doubling as the status filter */}
      <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          {STAGES.map((stage) => {
            const Icon = stage.icon;
            const n = countOf(stage.counts);
            const share = allCount ? Math.round((n / allCount) * 100) : 0;
            const selected = status === stage.key;
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => pickStatus(stage.key)}
                aria-pressed={selected}
                className={`min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${selected ? `border-neutral-900 ${stage.soft}` : "border-transparent bg-neutral-50 ring-1 ring-inset ring-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${stage.text}`}><Icon className="h-3.5 w-3.5" /> {stage.label}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{share}%</span>
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{counts ? n.toLocaleString() : "..."}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{stage.hint}</span>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <span className={`block h-full rounded-full ${stage.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Directory */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-sm font-bold text-neutral-900">{activeStage ? activeStage.label : "All bookings"}{propertyName ? ` at ${propertyName}` : ""}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading..." : `${total.toLocaleString()} ${total === 1 ? "booking" : "bookings"}${search ? ` matching "${search}"` : ""}`}</p>
          </div>
          {filtersOn && (
            <button type="button" onClick={clearFilters} className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
              <X className="h-3 w-3" /> Clear filters
            </button>
          )}
          <div className="ml-auto flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
            <div className="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Guest, email, property or check-in code" aria-label="Search bookings" className={`${fieldClass} w-full pl-9 pr-9`} />
              {searchInput && (
                <button type="button" onClick={() => setSearchInput("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setPage(1); }} aria-label="Property" className={`${fieldClass} w-full sm:w-56`}>
              <option value="all">All properties</option>
              {propertyOptionsLoading && <option value="__loading" disabled>Loading properties...</option>}
              {propertyOptions.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.title}{p.district || p.regionName ? `, ${[p.district, p.regionName].filter(Boolean).join(", ")}` : ""}
                </option>
              ))}
            </select>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort this page" title="Sorts the bookings on this page" className={`${fieldClass} w-full sm:w-44`}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="checkInAsc">Check-in, soonest</option>
              <option value="checkInDesc">Check-in, latest</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
            <thead>
              <tr className="text-[11px] text-neutral-400">
                <th className="px-4 py-2.5 font-semibold sm:px-5">Booking</th>
                <th className="px-3 py-2.5 font-semibold">Property</th>
                <th className="px-3 py-2.5 font-semibold">Guest</th>
                <th className="px-3 py-2.5 font-semibold">Stay</th>
                <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 sm:px-5" />
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-0 border-t border-solid border-neutral-200">
                    <td colSpan={7} className="px-5 py-4"><div className="h-3 w-3/4 animate-pulse rounded-full bg-neutral-200/80" /></td>
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr className="border-0 border-t border-solid border-neutral-200">
                  <td colSpan={7} className="px-5 py-8">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><BedDouble className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-sm font-semibold text-neutral-900">{filtersOn ? "No bookings match" : "No bookings yet"}</p>
                        <p className="m-0 mt-0.5 text-xs text-neutral-500">{filtersOn ? "Try another search or clear the filters." : "Bookings appear here once travellers start reserving stays."}</p>
                      </div>
                      {filtersOn && <button type="button" onClick={clearFilters} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Clear filters</button>}
                    </div>
                  </td>
                </tr>
              ) : (
                sorted.map((b) => {
                  const stage = stageForStatus(b.status);
                  const nights = nightsBetween(b.checkIn, b.checkOut);
                  const amount = tzs(b.totalAmount ?? b.invoice?.total ?? null);
                  const paid = Boolean(b.payment?.paidAt || b.invoice?.paidAt || ["PAID", "CUSTOMER_PAID"].includes(String(b.invoice?.status || "").toUpperCase()));
                  const place = [b.property?.city, b.property?.regionName].filter(Boolean).join(", ");
                  const guest = b.guestName || b.user?.name || "Guest not named";
                  return (
                    <tr key={b.id} className="border-0 border-t border-solid border-neutral-200 align-top transition-colors hover:bg-neutral-50/80">
                      <td className="px-4 py-3 sm:px-5">
                        <Link href={`/admin/management/bookings/${b.reference ?? b.id}`} className="font-semibold tabular-nums text-neutral-900 no-underline hover:text-emerald-700">#{b.id}</Link>
                        {b.code?.code && <div className="mt-0.5 font-mono text-[11px] text-neutral-500">{b.code.code}</div>}
                        {b.roomCode && <div className="text-[11px] text-neutral-400">Room {b.roomCode}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="max-w-[230px] truncate font-semibold text-neutral-900" title={b.property?.title}>{b.property?.title || "Property removed"}</div>
                        {place && <div className="max-w-[230px] truncate text-xs text-neutral-400">{place}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="max-w-[200px] truncate text-neutral-800">{guest}</div>
                        {(b.user?.email || b.guestPhone) && <div className="max-w-[200px] truncate text-xs text-neutral-400">{b.user?.email || b.guestPhone}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <div className="text-neutral-800"><span className="font-semibold">{eatDay(b.checkIn)}</span> <span className="text-neutral-400">to</span> <span className="font-semibold">{eatDay(b.checkOut)}</span></div>
                        <div className="text-xs text-neutral-400">{nights} {nights === 1 ? "night" : "nights"} · {eatYear(b.checkIn)}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <div className="font-semibold tabular-nums text-neutral-900">{amount ?? "Not set"}</div>
                        <div className={`inline-flex items-center gap-1 text-[11px] ${paid ? "text-emerald-700" : "text-neutral-400"}`}>
                          <CircleDollarSign className="h-3 w-3" /> {paid ? `Paid${b.payment?.method ? ` · ${b.payment.method}` : ""}` : "Not paid"}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${stage?.pill ?? "bg-neutral-100 text-neutral-600 ring-neutral-200"}`}>
                          {stage ? <stage.icon className="h-3 w-3" /> : null}
                          {STATUS_LABEL[String(b.status).toUpperCase()] ?? b.status}
                        </span>
                        {String(b.status).toUpperCase() === "NEW" && b.draftExpiresAt && (
                          <div className={`mt-1 text-[11px] ${b.draftExpiryStatus === "EXPIRED" ? "font-semibold text-rose-600" : "text-amber-700"}`}>{b.draftExpiryStatus === "EXPIRED" ? "Payment window expired" : hoursLeft(b.draftExpiresAt)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right sm:px-5">
                        <Link href={`/admin/management/bookings/${b.reference ?? b.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 no-underline transition-colors hover:bg-neutral-50 hover:no-underline">
                          Open <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <span className="text-xs text-neutral-500">
            {total === 0 ? "No bookings" : <>Showing <span className="font-semibold tabular-nums text-neutral-900">{(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)}</span> of <span className="font-semibold tabular-nums text-neutral-900">{total.toLocaleString()}</span></>}
          </span>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs tabular-nums text-neutral-500">Page <span className="font-semibold text-neutral-900">{page}</span> of <span className="font-semibold text-neutral-900">{totalPages}</span></span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages || loading} aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
