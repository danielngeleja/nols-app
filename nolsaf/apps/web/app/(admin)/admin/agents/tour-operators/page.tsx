"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, ChevronDown, ChevronsUpDown, ChevronUp, Eye, Filter, Info, RefreshCw, Search, ShieldCheck, ShieldOff } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import TableRow from "@/components/TableRow";

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

export default function AdminAgentsTourOperatorsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OperatorRow[]>([]);
  const [applicationRows, setApplicationRows] = useState<ApplicationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [accountFilter, setAccountFilter] = useState<"" | "ACTIVE" | "PENDING" | "HIRED" | "REJECTED" | "SUSPENDED">("");
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

      const hiredTotal = Number(hiredRes?.data?.total ?? 0);
      const pendingTotal = Number(pendingRes?.data?.total ?? 0) + Number(reviewingRes?.data?.total ?? 0) + Number(shortlistedRes?.data?.total ?? 0);
      const rejectedTotal = Number(rejectedRes?.data?.total ?? 0);

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
          const p = r?.data ?? {};
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

  const statusCounts = useMemo(() => {
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
    if (sortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-[#02665e]" />
      : <ChevronDown className="h-3.5 w-3.5 text-[#02665e]" />;
  };

  const showingApplications = accountFilter === "PENDING" || accountFilter === "REJECTED";

  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="box-border w-full min-w-0 max-w-full overflow-x-hidden space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 lg:px-6 xl:px-8">
      <section
        className="relative w-full min-w-0 max-w-full overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)" }}
      >
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 900 220"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="860" cy="45" r="200" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none" />
          <circle cx="860" cy="45" r="155" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
          <circle cx="820" cy="15" r="115" stroke="white" strokeOpacity="0.045" strokeWidth="1" fill="none" />
          <circle cx="28" cy="208" r="130" stroke="white" strokeOpacity="0.04" strokeWidth="1" fill="none" />
          {[44, 88, 132, 176].map((y) => (
            <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="rgba(255,255,255,0.030)" strokeWidth="1" />
          ))}
          <polyline
            points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78"
            fill="none"
            stroke="white"
            strokeOpacity="0.16"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polygon
            points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78 900,220 0,220"
            fill="white"
            fillOpacity="0.026"
          />
          {([[720, 90], [560, 108], [880, 78], [240, 145]] as [number, number][]).map(([px, py]) => (
            <circle key={`${px}-${py}`} cx={px} cy={py} r="3" fill="white" fillOpacity="0.22" />
          ))}
          <radialGradient id="tourOperatorHeaderGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(10,92,130,0.45)" />
            <stop offset="100%" stopColor="rgba(10,92,130,0)" />
          </radialGradient>
          <ellipse cx="450" cy="110" rx="300" ry="140" fill="url(#tourOperatorHeaderGlow)" />
        </svg>

        <button
          type="button"
          onClick={() => void load()}
          className="absolute right-4 top-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-all duration-150 hover:bg-white/15 focus:outline-none"
          style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)" }}
          title="Refresh tour operators"
          aria-label="Refresh tour operators"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>

        <div className="relative z-10 flex flex-col items-center px-4 py-10 text-center sm:px-6 sm:py-14 md:items-start md:px-8 md:text-left lg:px-10">
          <div
            className="mb-5 inline-flex items-center justify-center rounded-full"
            style={{
              width: 64,
              height: 64,
              background: "rgba(255,255,255,0.10)",
              border: "1.5px solid rgba(255,255,255,0.18)",
              boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)",
            }}
          >
            <Building2 className="h-7 w-7" style={{ color: "rgba(255,255,255,0.92)" }} aria-hidden />
          </div>

          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}
          >
            Tour Operator
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: "rgba(255,255,255,0.60)" }}>
            Hired, pending and approved tour operators managed as a company workflow.
          </p>

          <div className="mt-4 flex w-full flex-wrap items-center justify-center gap-2 md:justify-start">
            <div className="relative group/tooltip inline-flex">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all duration-150 focus:outline-none"
                style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.70)" }}
                aria-label="Tour operator workflow info"
                onClick={(e) => {
                  e.preventDefault();
                  try {
                    (e.currentTarget as HTMLButtonElement).focus();
                  } catch {
                    // ignore
                  }
                }}
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
                <span>Operator workflow</span>
              </button>
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 z-50 mb-2 w-72 max-w-[calc(100vw-1rem)] whitespace-normal break-words rounded-xl px-3 py-2.5 text-left text-xs opacity-0 shadow-2xl transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
                style={{ background: "#0b2a38", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.85)" }}
              >
                <div className="font-semibold mb-1" style={{ color: "#fff" }}>Tour operator workflow</div>
                <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                  Review active operators and applicant stages from the same operational list.
                </div>
              </div>
            </div>

            <Link
              href="/admin/agents"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium text-white no-underline transition-all duration-150 hover:bg-white/15"
              style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)" }}
            >
              Open Agents Module
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      <section
        className="w-full min-w-0 max-w-full overflow-hidden rounded-xl"
        style={{ background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)" }}
      >
        <div className="p-3 sm:p-4 lg:p-6">
        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="w-full min-w-0 max-w-full">
            <div className="relative w-full min-w-0 max-w-full">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 sm:left-3 sm:h-5 sm:w-5" style={{ color: "rgba(255,255,255,0.40)" }} />
            <input
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
              placeholder="Search name, email, or phone"
              className="box-border w-full min-w-0 max-w-full rounded-lg py-2 pl-9 pr-10 text-xs outline-none transition-all sm:py-2.5 sm:pl-10 sm:text-sm"
              style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.13)", color: "rgba(255,255,255,0.90)" }}
            />
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5 sm:gap-2">
            {[
              { label: "All", value: "" },
              { label: "Active", value: "ACTIVE" },
              { label: "Pending", value: "PENDING" },
              { label: "Hired", value: "HIRED" },
              { label: "Rejected", value: "REJECTED" },
              { label: "Suspended", value: "SUSPENDED" },
            ].map((s) => {
              const isActive = accountFilter === s.value;
              type PillColors = { activeBg: string; activeBorder: string; activeText: string; inactiveBg: string; inactiveBorder: string; badgeBg: string; badgeText: string };
              const colorMap: Record<string, PillColors> = {
                "": { activeBg: "rgba(255,255,255,0.18)", activeBorder: "rgba(255,255,255,0.38)", activeText: "#ffffff", inactiveBg: "rgba(255,255,255,0.06)", inactiveBorder: "rgba(255,255,255,0.12)", badgeBg: "rgba(255,255,255,0.15)", badgeText: "#e2e8f0" },
                ACTIVE: { activeBg: "rgba(16,185,129,0.25)", activeBorder: "rgba(16,185,129,0.55)", activeText: "#6ee7b7", inactiveBg: "rgba(16,185,129,0.08)", inactiveBorder: "rgba(16,185,129,0.20)", badgeBg: "rgba(16,185,129,0.20)", badgeText: "#6ee7b7" },
                PENDING: { activeBg: "rgba(245,158,11,0.25)", activeBorder: "rgba(245,158,11,0.55)", activeText: "#fcd34d", inactiveBg: "rgba(245,158,11,0.08)", inactiveBorder: "rgba(245,158,11,0.20)", badgeBg: "rgba(245,158,11,0.20)", badgeText: "#fcd34d" },
                HIRED: { activeBg: "rgba(20,184,166,0.25)", activeBorder: "rgba(20,184,166,0.55)", activeText: "#5eead4", inactiveBg: "rgba(20,184,166,0.08)", inactiveBorder: "rgba(20,184,166,0.20)", badgeBg: "rgba(20,184,166,0.20)", badgeText: "#5eead4" },
                REJECTED: { activeBg: "rgba(239,68,68,0.25)", activeBorder: "rgba(239,68,68,0.55)", activeText: "#fca5a5", inactiveBg: "rgba(239,68,68,0.08)", inactiveBorder: "rgba(239,68,68,0.20)", badgeBg: "rgba(239,68,68,0.20)", badgeText: "#fca5a5" },
                SUSPENDED: { activeBg: "rgba(99,102,241,0.25)", activeBorder: "rgba(99,102,241,0.55)", activeText: "#c4b5fd", inactiveBg: "rgba(99,102,241,0.08)", inactiveBorder: "rgba(99,102,241,0.20)", badgeBg: "rgba(99,102,241,0.20)", badgeText: "#c4b5fd" },
              };
              const colors = colorMap[s.value] ?? colorMap[""];
              const btnStyle = isActive
                ? { background: colors.activeBg, border: `1.5px solid ${colors.activeBorder}`, color: colors.activeText }
                : { background: colors.inactiveBg, border: `1.5px solid ${colors.inactiveBorder}`, color: "rgba(255,255,255,0.65)" };
              const badgeStyle = { background: colors.badgeBg, color: colors.badgeText };
              const count = (statusCounts as any)[s.value] ?? 0;
              return (
              <button
                key={s.value || "all"}
                type="button"
                  onClick={() => {
                    setPage(1);
                    setAccountFilter(s.value as "" | "ACTIVE" | "PENDING" | "HIRED" | "REJECTED" | "SUSPENDED");
                  }}
                  className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs transition-all duration-200 sm:px-2.5 sm:py-1.5 sm:gap-1.5"
                  style={btnStyle}
              >
                  <span className="whitespace-nowrap">{s.label}</span>
                  <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] sm:px-2 sm:text-xs" style={badgeStyle}>{count}</span>
              </button>
              );
            })}

          <button
            type="button"
            onClick={() => setShowAdvancedFilters((v) => !v)}
              className="flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-xs transition-all sm:px-2.5 sm:py-1.5"
              style={showAdvancedFilters ? { background: "rgba(2,102,94,0.30)", border: "1.5px solid rgba(2,102,94,0.65)", color: "#5eead4" } : { background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.75)" }}
          >
              <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Advanced Filters
          </button>
        </div>
        </div>

        {showAdvancedFilters ? (
          <div className="mt-4 space-y-3 pt-3 sm:space-y-4 sm:pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
              <label className="min-w-0">
                <span className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Region or District</span>
              <input
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                placeholder="Filter by location"
                  className="box-border w-full rounded-lg px-3 py-2 text-xs outline-none transition-all sm:text-sm"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.13)", color: "rgba(255,255,255,0.85)" }}
              />
            </label>
              <label className="min-w-0">
                <span className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Hired From</span>
                <DatePickerField
                  label="Hired From"
                  value={hiredFrom}
                  onChangeAction={setHiredFrom}
                  max={hiredTo || undefined}
                  widthClassName="w-full"
                  size="sm"
                />
            </label>
              <label className="min-w-0">
                <span className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Hired To</span>
                <DatePickerField
                  label="Hired To"
                  value={hiredTo}
                  onChangeAction={setHiredTo}
                  min={hiredFrom || undefined}
                  widthClassName="w-full"
                  size="sm"
                />
            </label>
            </div>
          </div>
        ) : null}
        </div>
      </section>

      <section className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4 lg:p-6">

        {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[1050px] w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="w-[88px] whitespace-nowrap px-4 py-3">S/N</th>
                <th className="w-[220px] whitespace-nowrap px-4 py-3">
                  <button type="button" onClick={() => handleSort("company")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                    Company {renderSortIcon("company")}
                  </button>
                </th>
                <th className="w-[220px] whitespace-nowrap px-4 py-3">
                  <button type="button" onClick={() => handleSort("contact")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                    Contact {renderSortIcon("contact")}
                  </button>
                </th>
                <th className="whitespace-nowrap px-4 py-3">
                  <button type="button" onClick={() => handleSort("location")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                    Location {renderSortIcon("location")}
                  </button>
                </th>
                <th className="w-[130px] whitespace-nowrap px-4 py-3">
                  <button type="button" onClick={() => handleSort("hiredAt")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                    Hired At {renderSortIcon("hiredAt")}
                  </button>
                </th>
                <th className="whitespace-nowrap px-4 py-3">
                  <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                    Status {renderSortIcon("status")}
                  </button>
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <TableRow hover={false}>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading tour operator records...</td>
                </TableRow>
              ) : (showingApplications ? sortedApplicationRows.length === 0 : sortedRows.length === 0) ? (
                <TableRow hover={false}>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {showingApplications
                      ? "No applications found for this filter."
                      : "No hired tour operators found for this filter."}
                  </td>
                </TableRow>
              ) : showingApplications ? (
                sortedApplicationRows.map((r, index) => (
                  <TableRow key={`app-${r.id}`}>
                    <td className="px-4 py-3 text-slate-700">{String(index + 1).padStart(2, "0")}</td>
                    <td className="w-[220px] px-4 py-3 text-slate-700">Application Stage</td>
                    <td className="w-[220px] px-4 py-3">
                      <div className="text-slate-700">{r.email || "-"}</div>
                      <div className="text-xs text-slate-500">{r.phone || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">-</td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="whitespace-nowrap">{fmtDate(r.submittedAt)}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{fmtTime(r.submittedAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        String(r.status).toUpperCase() === "REJECTED"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}>
                        {String(r.status).toUpperCase() === "REJECTED" ? "Rejected" : "Pending"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/admin/careers/applications/${r.id}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#02665e]/25 text-[#02665e] no-underline hover:bg-[#02665e]/10"
                        title="View application"
                        aria-label="View application"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </td>
                  </TableRow>
                ))
              ) : (
                sortedRows.map((r, index) => (
                  <TableRow key={r.id}>
                    <td className="px-4 py-3 text-slate-700">{String(index + 1).padStart(2, "0")}</td>
                    <td className="w-[220px] px-4 py-3 text-slate-700">{r.user?.fullName || r.user?.name || "Company profile pending"}</td>
                    <td className="w-[220px] px-4 py-3">
                      <div className="text-slate-700">{r.user?.email || "-"}</div>
                      <div className="text-xs text-slate-500">{r.user?.phone || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{[r.user?.region, r.user?.district].filter(Boolean).join(", ") || "-"}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="whitespace-nowrap">{fmtDate(r.createdAt)}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{fmtTime(r.createdAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      {String(r.status).toUpperCase() === "SUSPENDED" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                          <ShieldOff className="h-3.5 w-3.5" />
                          Suspended
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/admin/agents/${r.id}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#02665e]/25 text-[#02665e] no-underline hover:bg-[#02665e]/10"
                        title="View tour operator details"
                        aria-label="View tour operator details"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </td>
                  </TableRow>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="flex min-w-[860px] items-center justify-between text-sm">
            <div className="text-slate-500 whitespace-nowrap">
              Page {page} of {pages} · Total hired: {hiredCount} · Pending applications: {pendingCount} · Rejected applications: {rejectedCount} · Showing: {showingApplications ? filteredApplicationRows.length : filteredRows.length}
            </div>
            <div className="flex items-center gap-2 pl-4">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
