"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BarChart3, Building2, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ClipboardList, Clock, Filter, Mail, MapPin, Phone, RefreshCw, Search, ShieldCheck, ShieldOff, Users, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";

const api = apiClient;

type OperatorRow = {
  id: number;
  status: string;
  user: {
    name?: string | null;
    fullName?: string | null;
    email?: string | null;
    phone?: string | null;
    region?: string | null;
    district?: string | null;
  };
  areasOfOperation?: string[] | null;
  specializations?: string[] | null;
  createdAt: string;
};

type ApplicationRow = {
  id: number;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  status: string;
  submittedAt?: string | null;
};

type TableSortKey = "company" | "contact" | "location" | "hiredAt" | "status";

function authify() {}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

type AccountFilter = "" | "ACTIVE" | "PENDING" | "HIRED" | "REJECTED" | "SUSPENDED";

const STATUS_TABS: Array<{ value: AccountFilter; label: string; hint: string; dot: string }> = [
  { value: "", label: "All operators", hint: "Every operator account", dot: "bg-neutral-400" },
  { value: "ACTIVE", label: "Active", hint: "Live and taking tours", dot: "bg-emerald-500" },
  { value: "PENDING", label: "Pending", hint: "Applications in review", dot: "bg-amber-500" },
  { value: "HIRED", label: "Hired", hint: "Applications approved", dot: "bg-teal-500" },
  { value: "REJECTED", label: "Rejected", hint: "Applications declined", dot: "bg-red-500" },
  { value: "SUSPENDED", label: "Suspended", hint: "Accounts on hold", dot: "bg-violet-500" },
];

function titleCase(value: string) {
  const v = value.replace(/_/g, " ").toLowerCase();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function Initials({ name, muted = false }: { name: string; muted?: boolean }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
  return (
    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${muted ? "bg-neutral-100 text-neutral-400" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"}`} aria-hidden>
      {letters}
    </span>
  );
}

function ContactCell({ email, phone }: { email?: string | null; phone?: string | null }) {
  if (!email && !phone) return <span className="text-neutral-400">No contact</span>;
  return (
    <span className="block min-w-0 space-y-0.5">
      {email ? (
        <a href={`mailto:${email}`} className="flex min-w-0 items-center gap-1.5 text-neutral-700 no-underline hover:text-emerald-700">
          <Mail className="h-3 w-3 shrink-0 text-neutral-400" aria-hidden /> <span className="truncate">{email}</span>
        </a>
      ) : null}
      {phone ? (
        <a href={`tel:${phone}`} className="flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500 no-underline hover:text-emerald-700">
          <Phone className="h-3 w-3 shrink-0 text-neutral-400" aria-hidden /> <span className="truncate">{phone}</span>
        </a>
      ) : null}
    </span>
  );
}

function DateCell({ iso }: { iso?: string | null }) {
  if (!iso) return <span className="text-neutral-400">Not recorded</span>;
  return (
    <span className="block">
      <span className="block whitespace-nowrap font-semibold text-neutral-700">{fmtDate(iso)}</span>
      <span className="block text-[11px] text-neutral-400">{fmtTime(iso)}</span>
    </span>
  );
}

export default function AdminAgentsTourOperatorsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OperatorRow[]>([]);
  const [applicationRows, setApplicationRows] = useState<ApplicationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [regionFilter, setRegionFilter] = useState("");
  const [hiredFrom, setHiredFrom] = useState("");
  const [hiredTo, setHiredTo] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [hiredCount, setHiredCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [suspendedCount, setSuspendedCount] = useState(0);
  const [sortBy, setSortBy] = useState<TableSortKey>("hiredAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      authify();
      const res = await api.get("/api/admin/agents", {
        params: {
          q: q.trim() || undefined,
          page,
          pageSize,
        },
      });

      const [activeRes, suspendedRes, hiredRes, pendingRes, reviewingRes, shortlistedRes, rejectedRes] = await Promise.all([
        api.get("/api/admin/agents", { params: { status: "ACTIVE", page: 1, pageSize: 1 } }),
        api.get("/api/admin/agents", { params: { status: "SUSPENDED", page: 1, pageSize: 1 } }),
        api.get("/api/admin/careers/applications", { params: { status: "HIRED", page: 1, pageSize: 1, search: q.trim() || undefined } }),
        api.get("/api/admin/careers/applications", { params: { status: "PENDING", page: 1, pageSize: 1, search: q.trim() || undefined } }),
        api.get("/api/admin/careers/applications", { params: { status: "REVIEWING", page: 1, pageSize: 1, search: q.trim() || undefined } }),
        api.get("/api/admin/careers/applications", { params: { status: "SHORTLISTED", page: 1, pageSize: 1, search: q.trim() || undefined } }),
        api.get("/api/admin/careers/applications", { params: { status: "REJECTED", page: 1, pageSize: 1, search: q.trim() || undefined } }),
      ]);

      const payload = res?.data?.data ?? res?.data ?? {};
      const items = Array.isArray(payload.items) ? (payload.items as OperatorRow[]) : [];
      setRows(items);
      setTotal(Number(payload.total ?? 0));

      const activePayload = activeRes?.data?.data ?? activeRes?.data ?? {};
      const suspendedPayload = suspendedRes?.data?.data ?? suspendedRes?.data ?? {};
      setActiveCount(Number(activePayload.total ?? 0));
      setSuspendedCount(Number(suspendedPayload.total ?? 0));

      const hiredPayload = hiredRes?.data?.data ?? hiredRes?.data ?? {};
      const pendingPayload = pendingRes?.data?.data ?? pendingRes?.data ?? {};
      const reviewingPayload = reviewingRes?.data?.data ?? reviewingRes?.data ?? {};
      const shortlistedPayload = shortlistedRes?.data?.data ?? shortlistedRes?.data ?? {};
      const rejectedPayload = rejectedRes?.data?.data ?? rejectedRes?.data ?? {};
      const hiredTotal = Number(hiredPayload.total ?? 0);
      const pendingTotal = Number(pendingPayload.total ?? 0) + Number(reviewingPayload.total ?? 0) + Number(shortlistedPayload.total ?? 0);
      const rejectedTotal = Number(rejectedPayload.total ?? 0);

      setHiredCount(hiredTotal);
      setPendingCount(pendingTotal);
      setRejectedCount(rejectedTotal);

      if (accountFilter === "PENDING" || accountFilter === "REJECTED") {
        const statuses = accountFilter === "PENDING" ? ["PENDING", "REVIEWING", "SHORTLISTED"] : ["REJECTED"];
        const appReqs = await Promise.all(
          statuses.map((status) =>
            api.get("/api/admin/careers/applications", {
              params: { status, page: 1, pageSize: 200, search: q.trim() || undefined },
            }),
          ),
        );

        const merged = appReqs.flatMap((r) => {
          const p = r?.data?.data ?? r?.data ?? {};
          return Array.isArray(p.applications) ? (p.applications as ApplicationRow[]) : [];
        });
        setApplicationRows(merged);
      } else {
        setApplicationRows([]);
      }
    } catch (e: any) {
      setRows([]);
      setApplicationRows([]);
      setTotal(0);
      setError(e?.response?.data?.error || e?.message || "Failed to load hired tour operators");
    } finally {
      setLoading(false);
    }
  }, [page, q, accountFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Search waits for a pause in typing before it asks the API
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (qInput !== q) {
        setPage(1);
        setQ(qInput);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [qInput, q]);

  const statusCounts = useMemo<Record<AccountFilter, number>>(() => {
    return {
      "": total,
      ACTIVE: activeCount,
      PENDING: pendingCount,
      HIRED: hiredCount,
      REJECTED: rejectedCount,
      SUSPENDED: suspendedCount,
    };
  }, [total, activeCount, pendingCount, hiredCount, rejectedCount, suspendedCount]);

  const filteredRows = useMemo(() => {
    let next = rows;

    if (accountFilter === "ACTIVE" || accountFilter === "SUSPENDED") {
      next = next.filter((r) => String(r.status).toUpperCase() === accountFilter);
    }

    if (regionFilter.trim()) {
      const needle = regionFilter.trim().toLowerCase();
      next = next.filter((r) => {
        const bag = `${r.user?.region || ""} ${r.user?.district || ""}`.toLowerCase();
        return bag.includes(needle);
      });
    }

    if (hiredFrom) {
      const from = new Date(`${hiredFrom}T00:00:00`);
      next = next.filter((r) => {
        const d = new Date(r.createdAt);
        return !Number.isNaN(d.getTime()) && d >= from;
      });
    }

    if (hiredTo) {
      const to = new Date(`${hiredTo}T23:59:59`);
      next = next.filter((r) => {
        const d = new Date(r.createdAt);
        return !Number.isNaN(d.getTime()) && d <= to;
      });
    }

    return next;
  }, [rows, accountFilter, regionFilter, hiredFrom, hiredTo]);

  const filteredApplicationRows = useMemo(() => {
    let next = applicationRows;
    if (hiredFrom) {
      const from = new Date(`${hiredFrom}T00:00:00`);
      next = next.filter((r) => {
        const d = new Date(r.submittedAt || "");
        return !Number.isNaN(d.getTime()) && d >= from;
      });
    }
    if (hiredTo) {
      const to = new Date(`${hiredTo}T23:59:59`);
      next = next.filter((r) => {
        const d = new Date(r.submittedAt || "");
        return !Number.isNaN(d.getTime()) && d <= to;
      });
    }
    return next;
  }, [applicationRows, hiredFrom, hiredTo]);

  const sortedRows = useMemo(() => {
    const next = [...filteredRows];
    const readValue = (r: OperatorRow): string | number => {
      switch (sortBy) {
        case "company":
          return String(r.user?.fullName || r.user?.name || "").toLowerCase();
        case "contact":
          return `${String(r.user?.email || "").toLowerCase()} ${String(r.user?.phone || "").toLowerCase()}`;
        case "location":
          return `${String(r.user?.region || "").toLowerCase()} ${String(r.user?.district || "").toLowerCase()}`;
        case "hiredAt":
          return new Date(r.createdAt || "").getTime() || 0;
        case "status":
          return String(r.status || "").toLowerCase();
        default:
          return "";
      }
    };

    next.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return next;
  }, [filteredRows, sortBy, sortDir]);

  const sortedApplicationRows = useMemo(() => {
    const next = [...filteredApplicationRows];
    const readValue = (r: ApplicationRow): string | number => {
      switch (sortBy) {
        case "company":
          return String(r.fullName || "").toLowerCase();
        case "contact":
          return `${String(r.email || "").toLowerCase()} ${String(r.phone || "").toLowerCase()}`;
        case "location":
          return "";
        case "hiredAt":
          return new Date(r.submittedAt || "").getTime() || 0;
        case "status":
          return String(r.status || "").toLowerCase();
        default:
          return "";
      }
    };

    next.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return next;
  }, [filteredApplicationRows, sortBy, sortDir]);

  const handleSort = (field: TableSortKey) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "hiredAt" ? "desc" : "asc");
  };

  const renderSortIcon = (field: TableSortKey) => {
    if (sortBy !== field) return <ChevronsUpDown className="h-3 w-3 text-neutral-300" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 text-emerald-700" />
      : <ChevronDown className="h-3 w-3 text-emerald-700" />;
  };

  const showingApplications = accountFilter === "PENDING" || accountFilter === "REJECTED";

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const shownCount = showingApplications ? filteredApplicationRows.length : filteredRows.length;
  const firstShown = shownCount ? (page - 1) * pageSize + 1 : 0;
  const lastShown = (page - 1) * pageSize + shownCount;
  const activeChips = [
    regionFilter.trim() ? { key: "region", label: `Location: ${regionFilter.trim()}`, clear: () => setRegionFilter("") } : null,
    hiredFrom ? { key: "from", label: `From ${fmtDate(hiredFrom)}`, clear: () => setHiredFrom("") } : null,
    hiredTo ? { key: "to", label: `To ${fmtDate(hiredTo)}`, clear: () => setHiredTo("") } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  const selectFilter = (value: AccountFilter) => {
    setPage(1);
    setAccountFilter(value);
  };

  const sortHeader = (field: TableSortKey, label: string) => (
    <button
      type="button"
      onClick={() => handleSort(field)}
      className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400 hover:text-neutral-700"
    >
      {label} {renderSortIcon(field)}
    </button>
  );

  return (
    <div id="tour-operators" className="w-full min-w-0 space-y-4">
      {/* Preflight is disabled in this project; scope border-box so w-full pieces don't overflow */}
      <style>{`#tour-operators, #tour-operators * { box-sizing: border-box; }`}</style>

      {/* Workspace header */}
      <section className="relative overflow-hidden rounded-2xl border border-solid border-slate-800 bg-[linear-gradient(120deg,#102b3a_0%,#123f49_65%,#075e54_100%)] p-4 shadow-sm sm:p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-solid border-white/[0.06]" aria-hidden="true" />
        <div className="relative flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-solid border-emerald-100 bg-white text-emerald-700 shadow-sm">
                <Building2 className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Agents module</p>
                <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tour Operators</h1>
                <p className="m-0 mt-1 text-xs leading-5 text-emerald-100/80 sm:text-sm">
                  Active operator companies and the applications on their way in, in one list.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              suppressHydrationWarning
              title="Refresh tour operators"
              aria-label="Refresh tour operators"
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-solid border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-wait"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
          <nav aria-label="Related workspaces" className="flex flex-wrap gap-2 border-0 border-t border-solid border-white/15 pt-4">
            {[
              { href: "/admin/agents", label: "Agents module", Icon: Users },
              { href: "/admin/agents/tour-bookings", label: "Tour bookings", Icon: ClipboardList },
              { href: "/admin/agents/tour-experience", label: "Tour experience", Icon: BarChart3 },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href} className="inline-flex items-center gap-2 rounded-lg border border-solid border-white/15 bg-white/[0.07] px-3 py-2 text-xs font-bold text-emerald-50 no-underline transition hover:bg-white/15">
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* Status strip: every count is also the filter for it */}
      <section
        aria-label="Filter by status"
        className="grid min-w-0 grid-cols-2 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-0 [&>*]:border-b [&>*]:border-r [&>*]:border-solid [&>*]:border-neutral-100"
      >
        {STATUS_TABS.map((s) => {
          const on = accountFilter === s.value;
          const count = statusCounts[s.value] ?? 0;
          return (
            <button
              key={s.value || "all"}
              type="button"
              aria-pressed={on}
              onClick={() => selectFilter(s.value)}
              className={`relative flex min-w-0 cursor-pointer flex-col items-start gap-1 bg-transparent p-3.5 text-left transition sm:p-4 ${on ? "bg-emerald-50/70" : "hover:bg-neutral-50"}`}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden /> {s.label}
              </span>
              <span className={`text-xl font-black leading-none tabular-nums ${on ? "text-emerald-800" : "text-neutral-950"}`}>{count}</span>
              <span className="text-[11px] leading-snug text-neutral-500">{s.hint}</span>
              {on ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-700" aria-hidden /> : null}
            </button>
          );
        })}
      </section>

      {/* Nudge when applications are waiting */}
      {pendingCount > 0 && accountFilter !== "PENDING" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-solid border-amber-200 bg-amber-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="m-0 flex items-center gap-2.5 text-sm text-amber-900">
            <Clock className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <span>
              <span className="font-bold">{pendingCount} {pendingCount === 1 ? "application is" : "applications are"} waiting for review.</span>{" "}
              <span className="text-amber-800/80">Pending, reviewing and shortlisted combined.</span>
            </span>
          </p>
          <button
            type="button"
            onClick={() => selectFilter("PENDING")}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 self-start rounded-lg border border-solid border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100 sm:self-auto"
          >
            Review now <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* Register */}
      <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <div className="flex flex-col gap-2.5 border-0 border-b border-solid border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search company, email or phone"
              aria-label="Search tour operators"
              className="block min-h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white py-1.5 pl-9 pr-9 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            {qInput ? (
              <button
                type="button"
                onClick={() => setQInput("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setShowAdvancedFilters((v) => !v)}
            aria-expanded={showAdvancedFilters}
            className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid px-3 text-xs font-bold transition ${showAdvancedFilters || activeChips.length ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
            Filters{activeChips.length ? ` (${activeChips.length})` : ""}
          </button>
        </div>

        {showAdvancedFilters ? (
          <div className="grid grid-cols-1 gap-3 border-0 border-b border-solid border-neutral-100 bg-neutral-50/60 px-4 py-3 sm:grid-cols-3 sm:px-5">
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-bold text-neutral-500">Region or district</span>
              <input
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                placeholder="Arusha, Moshi, Serengeti"
                className="block min-h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-bold text-neutral-500">Joined or applied from</span>
              <DatePickerField label="From" value={hiredFrom} onChangeAction={setHiredFrom} max={hiredTo || undefined} widthClassName="w-full" size="sm" />
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-bold text-neutral-500">Joined or applied to</span>
              <DatePickerField label="To" value={hiredTo} onChangeAction={setHiredTo} min={hiredFrom || undefined} widthClassName="w-full" size="sm" />
            </label>
          </div>
        ) : null}

        {activeChips.length ? (
          <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-2.5 sm:px-5">
            {activeChips.map((chip) => (
              <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-solid border-emerald-200 bg-emerald-50 py-0.5 pl-2.5 pr-1 text-[11px] font-bold text-emerald-800">
                {chip.label}
                <button type="button" onClick={chip.clear} aria-label={`Remove ${chip.label}`} className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-emerald-700 hover:bg-emerald-100">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => { setRegionFilter(""); setHiredFrom(""); setHiredTo(""); }}
              className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
            >
              Clear all
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="m-4 flex items-start gap-2.5 rounded-xl border border-solid border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700 sm:mx-5" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{error}</span>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-left">
            <caption className="sr-only">{showingApplications ? "Tour operator applications" : "Tour operators"}</caption>
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[22%]" />
              <col className="w-[17%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead>
              <tr className="border-0 border-b border-solid border-neutral-100">
                <th className="px-4 py-2.5 sm:px-5">{sortHeader("company", showingApplications ? "Applicant" : "Company")}</th>
                <th className="px-3 py-2.5">{sortHeader("contact", "Contact")}</th>
                <th className="px-3 py-2.5">{sortHeader("location", "Location")}</th>
                <th className="px-3 py-2.5">{sortHeader("hiredAt", showingApplications ? "Applied" : "Joined")}</th>
                <th className="px-3 py-2.5">{sortHeader("status", "Status")}</th>
                <th className="px-3 py-2.5"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-0 border-b border-solid border-neutral-50">
                    <td className="px-4 py-3.5 sm:px-5" colSpan={6}>
                      <div className="flex items-center gap-3">
                        <span className="h-9 w-9 animate-pulse rounded-full bg-neutral-100" />
                        <span className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
                        <span className="ml-auto h-3 w-1/5 animate-pulse rounded bg-neutral-100" />
                      </div>
                    </td>
                  </tr>
                ))
              ) : (showingApplications ? sortedApplicationRows.length === 0 : sortedRows.length === 0) ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <p className="m-0 text-sm font-bold text-neutral-700">{showingApplications ? "No applications here" : "No operators match"}</p>
                    <p className="m-0 mt-1 text-xs text-neutral-400">
                      {q || activeChips.length ? "Try a different search or clear the filters." : "Nothing in this status yet."}
                    </p>
                  </td>
                </tr>
              ) : showingApplications ? (
                sortedApplicationRows.map((r, index) => {
                  const rejected = String(r.status).toUpperCase() === "REJECTED";
                  return (
                    <tr key={`app-${r.id}`} className={`border-0 border-b border-solid border-neutral-50 text-xs transition hover:bg-emerald-50/70 ${index % 2 === 1 ? "bg-emerald-50/30" : "bg-white"}`}>
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <Initials name={r.fullName || r.email || "Applicant"} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-neutral-900">{r.fullName || "Unnamed applicant"}</span>
                            <span className="block truncate text-[11px] text-neutral-400">Application #{r.id}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3"><ContactCell email={r.email} phone={r.phone} /></td>
                      <td className="px-3 py-3 text-neutral-400">Shared after hiring</td>
                      <td className="px-3 py-3"><DateCell iso={r.submittedAt} /></td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${rejected ? "border-red-100 bg-red-50 text-red-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>
                          {rejected ? "Rejected" : titleCase(String(r.status || "Pending"))}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link href={`/admin/management/careers?tab=applications&applicationId=${encodeURIComponent(String(r.id))}`} title="Open application" aria-label="Open application" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 no-underline transition hover:bg-emerald-50 hover:text-emerald-700">
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              ) : (
                sortedRows.map((r, index) => {
                  const suspended = String(r.status).toUpperCase() === "SUSPENDED";
                  const name = r.user?.fullName || r.user?.name || "";
                  const tags = [...(r.specializations ?? []), ...(r.areasOfOperation ?? [])].filter(Boolean);
                  return (
                    <tr key={r.id} className={`border-0 border-b border-solid border-neutral-50 text-xs transition hover:bg-emerald-50/70 ${index % 2 === 1 ? "bg-emerald-50/30" : "bg-white"}`}>
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <Initials name={name || "Operator"} muted={suspended} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-neutral-900">{name || "Company profile pending"}</span>
                            {tags.length ? (
                              <span className="mt-1 flex min-w-0 gap-1">
                                {tags.slice(0, 2).map((tag) => (
                                  <span key={tag} className="truncate rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600">{tag}</span>
                                ))}
                                {tags.length > 2 ? <span className="shrink-0 text-[10px] font-semibold text-neutral-400">+{tags.length - 2}</span> : null}
                              </span>
                            ) : (
                              <span className="block text-[11px] text-neutral-400">Operator #{r.id}</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3"><ContactCell email={r.user?.email} phone={r.user?.phone} /></td>
                      <td className="px-3 py-3">
                        {r.user?.region || r.user?.district ? (
                          <span className="flex min-w-0 items-center gap-1.5 text-neutral-700">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
                            <span className="truncate">{[r.user?.district, r.user?.region].filter(Boolean).join(", ")}</span>
                          </span>
                        ) : (
                          <span className="text-neutral-400">Not set</span>
                        )}
                      </td>
                      <td className="px-3 py-3"><DateCell iso={r.createdAt} /></td>
                      <td className="px-3 py-3">
                        {suspended ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-solid border-red-100 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700"><ShieldOff className="h-3 w-3" aria-hidden /> Suspended</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-solid border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><ShieldCheck className="h-3 w-3" aria-hidden /> Active</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link href={`/admin/agents/${r.id}`} title="Open operator" aria-label="Open operator" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 no-underline transition hover:bg-emerald-50 hover:text-emerald-700">
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span className="text-neutral-500">
            {shownCount ? <>Showing <span className="font-bold text-neutral-800">{firstShown} to {lastShown}</span>{showingApplications ? "" : <> of <span className="font-bold text-neutral-800">{total}</span></>}</> : "Nothing to show"}
          </span>
          {!showingApplications && pages > 1 ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                suppressHydrationWarning
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Prev
              </button>
              <span className="tabular-nums text-neutral-500">Page {page} of {pages}</span>
              <button
                type="button"
                suppressHydrationWarning
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
