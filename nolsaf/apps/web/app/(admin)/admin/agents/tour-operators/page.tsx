"use client";

// Tour operators register. The header is a tier ladder (Bronze to Platinum,
// computed live by the API from tours, commission and rating) whose steps filter
// the register; under it an intake pipeline walks applications through hiring to
// active accounts, with rejected and suspended as exits. Applications come from
// /api/admin/careers/applications, operators from /api/admin/agents.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BarChart3, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ClipboardList, Filter, Inbox, Mail, MapPin, Phone, RefreshCw, Search, ShieldCheck, ShieldOff, Star, UserCheck, Users, X, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { useAdminHref } from "@/lib/adminRecordRefs";

const api = apiClient;

type TierKey = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

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
  level?: string | null;
  completedTours?: number | null;
  noLSAFRevenue?: number | null;
  overallRating?: number | null;
  totalReviews?: number | null;
  nextLevel?: {
    level: TierKey;
    requirements: { tours: number; revenue: number; rating: number; reviews: number };
    met: { tours: boolean; revenue: boolean; rating: boolean; reviews: boolean };
    progress: { overall: number };
  } | null;
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

type TableSortKey = "company" | "contact" | "location" | "tier" | "record" | "hiredAt" | "status";
type AccountFilter = "" | "ACTIVE" | "PENDING" | "HIRED" | "REJECTED" | "SUSPENDED";

const LADDER_SIZE = 100;

// Same tier colours as the ladder editor in management settings; hex for the dark band.
const TIERS: Array<{ key: TierKey; label: string; hex: string; pill: string; dot: string }> = [
  { key: "BRONZE", label: "Bronze", hex: "#e0a26f", pill: "border-orange-100 bg-orange-50 text-orange-700", dot: "bg-orange-500" },
  { key: "SILVER", label: "Silver", hex: "#cbd5e1", pill: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
  { key: "GOLD", label: "Gold", hex: "#fbbf24", pill: "border-amber-100 bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  { key: "PLATINUM", label: "Platinum", hex: "#a5b4fc", pill: "border-indigo-100 bg-indigo-50 text-indigo-700", dot: "bg-indigo-500" },
];
const tierOf = (level?: string | null) => TIERS.find((t) => t.key === String(level || "").toUpperCase()) ?? TIERS[0];
const tierIndex = (level?: string | null) => Math.max(0, TIERS.findIndex((t) => t.key === String(level || "").toUpperCase()));

// Position on the Bronze to Platinum track, 0 to 100: the tier's milestone plus
// the API's overall progress toward the next one.
function trackPosition(r: OperatorRow) {
  const idx = tierIndex(r.level);
  const step = 100 / (TIERS.length - 1);
  if (idx >= TIERS.length - 1) return 100;
  return idx * step + (Math.min(100, Number(r.nextLevel?.progress?.overall || 0)) / 100) * step;
}

// What still stands between an operator and the next tier, in plain words.
function missingFor(r: OperatorRow) {
  const n = r.nextLevel;
  if (!n) return [];
  const out: string[] = [];
  if (!n.met.tours) out.push(`${Number(r.completedTours || 0)} of ${n.requirements.tours} tours`);
  if (!n.met.revenue) out.push(`$${Math.round(Number(r.noLSAFRevenue || 0)).toLocaleString()} of $${n.requirements.revenue.toLocaleString()}`);
  if (!n.met.reviews) out.push(`${Number(r.totalReviews || 0)} of ${n.requirements.reviews} reviews`);
  else if (!n.met.rating) out.push(`rating ${Number(r.overallRating || 0).toFixed(1)} of ${n.requirements.rating}`);
  return out;
}

const heroButton =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

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

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function titleCase(value: string) {
  const v = value.replace(/_/g, " ").toLowerCase();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

const nameOf = (r: OperatorRow) => r.user?.fullName || r.user?.name || "";
const lettersOf = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";

function Initials({ name, muted = false, tier }: { name: string; muted?: boolean; tier?: (typeof TIERS)[number] }) {
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${muted ? "bg-neutral-100 text-neutral-400" : "bg-[#0b2420] text-emerald-200"}`}
      style={tier && !muted ? { boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${tier.hex}` } : undefined}
      aria-hidden
    >
      {lettersOf(name)}
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

// Contour lines behind the header: a quiet nod to the land these operators sell.
function Contours() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 800 300">
      {Array.from({ length: 9 }).map((_, i) => (
        <path
          key={i}
          d={`M -20 ${250 - i * 22} C 140 ${215 - i * 26}, 260 ${300 - i * 20}, 420 ${236 - i * 24} S 700 ${170 - i * 18}, 840 ${206 - i * 25}`}
          fill="none"
          stroke="white"
          strokeOpacity={0.035 + (i % 3) * 0.012}
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

export default function AdminAgentsTourOperatorsPage() {
  const recordHref = useAdminHref();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OperatorRow[]>([]);
  const [ladderRows, setLadderRows] = useState<OperatorRow[]>([]);
  const [applicationRows, setApplicationRows] = useState<ApplicationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("");
  const [tierFilter, setTierFilter] = useState<TierKey | "">("");
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
      // The API applies the tier filter after paging, so a tier view reads one wide page.
      const res = await api.get("/api/admin/agents", {
        params: tierFilter
          ? { q: q.trim() || undefined, page: 1, pageSize: LADDER_SIZE, level: tierFilter }
          : { q: q.trim() || undefined, page, pageSize },
      });

      const search = q.trim() || undefined;
      const [ladderRes, activeRes, suspendedRes, hiredRes, pendingRes, reviewingRes, shortlistedRes, rejectedRes] = await Promise.all([
        api.get("/api/admin/agents", { params: { page: 1, pageSize: LADDER_SIZE } }),
        api.get("/api/admin/agents", { params: { status: "ACTIVE", page: 1, pageSize: 1 } }),
        api.get("/api/admin/agents", { params: { status: "SUSPENDED", page: 1, pageSize: 1 } }),
        api.get("/api/admin/careers/applications", { params: { status: "HIRED", page: 1, pageSize: 1, search } }),
        api.get("/api/admin/careers/applications", { params: { status: "PENDING", page: 1, pageSize: 1, search } }),
        api.get("/api/admin/careers/applications", { params: { status: "REVIEWING", page: 1, pageSize: 1, search } }),
        api.get("/api/admin/careers/applications", { params: { status: "SHORTLISTED", page: 1, pageSize: 1, search } }),
        api.get("/api/admin/careers/applications", { params: { status: "REJECTED", page: 1, pageSize: 1, search } }),
      ]);

      const body = (r: any) => r?.data?.data ?? r?.data ?? {};
      const payload = body(res);
      setRows(Array.isArray(payload.items) ? (payload.items as OperatorRow[]) : []);
      setTotal(Number(payload.total ?? 0));
      const ladderPayload = body(ladderRes);
      setLadderRows(Array.isArray(ladderPayload.items) ? (ladderPayload.items as OperatorRow[]) : []);

      setActiveCount(Number(body(activeRes).total ?? 0));
      setSuspendedCount(Number(body(suspendedRes).total ?? 0));
      setHiredCount(Number(body(hiredRes).total ?? 0));
      setPendingCount(Number(body(pendingRes).total ?? 0) + Number(body(reviewingRes).total ?? 0) + Number(body(shortlistedRes).total ?? 0));
      setRejectedCount(Number(body(rejectedRes).total ?? 0));

      if (accountFilter === "PENDING" || accountFilter === "REJECTED") {
        const statuses = accountFilter === "PENDING" ? ["PENDING", "REVIEWING", "SHORTLISTED"] : ["REJECTED"];
        const appReqs = await Promise.all(
          statuses.map((status) => api.get("/api/admin/careers/applications", { params: { status, page: 1, pageSize: 200, search } })),
        );
        setApplicationRows(appReqs.flatMap((r) => {
          const p = body(r);
          return Array.isArray(p.applications) ? (p.applications as ApplicationRow[]) : [];
        }));
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
  }, [page, q, accountFilter, tierFilter]);

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

  // Ladder and season numbers, from one wide read of every operator.
  const ladder = useMemo(() => {
    const byTier = new Map<TierKey, OperatorRow[]>(TIERS.map((t) => [t.key, []]));
    let tours = 0;
    let commission = 0;
    let ratingSum = 0;
    let reviews = 0;
    for (const r of ladderRows) {
      byTier.get(tierOf(r.level).key)!.push(r);
      tours += Number(r.completedTours || 0);
      commission += Number(r.noLSAFRevenue || 0);
      if (r.overallRating != null && r.totalReviews) {
        ratingSum += Number(r.overallRating) * Number(r.totalReviews);
        reviews += Number(r.totalReviews);
      }
    }
    // Operators sitting within a few points of each other share one pile on the track.
    const placed = ladderRows.map((r) => ({ r, pos: trackPosition(r) })).sort((a, b) => a.pos - b.pos);
    const piles: Array<{ pos: number; members: OperatorRow[] }> = [];
    for (const p of placed) {
      const last = piles[piles.length - 1];
      if (last && p.pos - last.pos < 4) last.members.push(p.r);
      else piles.push({ pos: p.pos, members: [p.r] });
    }
    // Closest to promotion: highest overall progress among those with a next tier.
    const closest = ladderRows
      .filter((r) => r.nextLevel)
      .sort((a, b) => Number(b.nextLevel!.progress.overall) - Number(a.nextLevel!.progress.overall) || Number(b.noLSAFRevenue || 0) - Number(a.noLSAFRevenue || 0))[0] ?? null;
    return { byTier, piles, closest, tours, commission, rating: reviews ? ratingSum / reviews : null, reviews };
  }, [ladderRows]);
  const [focus, setFocus] = useState<OperatorRow | null>(null);

  const filteredRows = useMemo(() => {
    let next = rows;

    if (accountFilter === "ACTIVE" || accountFilter === "SUSPENDED") {
      next = next.filter((r) => String(r.status).toUpperCase() === accountFilter);
    }

    if (regionFilter.trim()) {
      const needle = regionFilter.trim().toLowerCase();
      next = next.filter((r) => `${r.user?.region || ""} ${r.user?.district || ""}`.toLowerCase().includes(needle));
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
          return nameOf(r).toLowerCase();
        case "contact":
          return `${String(r.user?.email || "").toLowerCase()} ${String(r.user?.phone || "").toLowerCase()}`;
        case "location":
          return `${String(r.user?.region || "").toLowerCase()} ${String(r.user?.district || "").toLowerCase()}`;
        case "tier":
          return trackPosition(r);
        case "record":
          return Number(r.completedTours || 0);
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
    setSortDir(field === "hiredAt" || field === "record" || field === "tier" ? "desc" : "asc");
  };

  const renderSortIcon = (field: TableSortKey) => {
    if (sortBy !== field) return <ChevronsUpDown className="h-3 w-3 text-neutral-300" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 text-emerald-700" />
      : <ChevronDown className="h-3 w-3 text-emerald-700" />;
  };

  const showingApplications = accountFilter === "PENDING" || accountFilter === "REJECTED";

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const paged = !showingApplications && !tierFilter;
  const shownCount = showingApplications ? filteredApplicationRows.length : filteredRows.length;
  const firstShown = shownCount ? (paged ? (page - 1) * pageSize + 1 : 1) : 0;
  const lastShown = paged ? (page - 1) * pageSize + shownCount : shownCount;
  const activeChips = [
    tierFilter ? { key: "tier", label: `Tier: ${tierOf(tierFilter).label}`, clear: () => setTierFilter("") } : null,
    regionFilter.trim() ? { key: "region", label: `Location: ${regionFilter.trim()}`, clear: () => setRegionFilter("") } : null,
    hiredFrom ? { key: "from", label: `From ${fmtDate(hiredFrom)}`, clear: () => setHiredFrom("") } : null,
    hiredTo ? { key: "to", label: `To ${fmtDate(hiredTo)}`, clear: () => setHiredTo("") } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  // Applications carry no tier, so the two filters never stack.
  const selectFilter = (value: AccountFilter) => {
    setPage(1);
    setAccountFilter(value);
    if (value === "PENDING" || value === "REJECTED") setTierFilter("");
  };
  const selectTier = (tier: TierKey) => {
    setPage(1);
    setTierFilter((cur) => (cur === tier ? "" : tier));
    if (showingApplications) setAccountFilter("");
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

  const pipeline: Array<{ key: AccountFilter; label: string; value: number; hint: string; icon: typeof Users; warn?: boolean }> = [
    { key: "PENDING", label: "In review", value: pendingCount, hint: pendingCount ? "Pending, reviewing and shortlisted" : "Nothing waiting", icon: Inbox, warn: pendingCount > 0 },
    { key: "HIRED", label: "Hired", value: hiredCount, hint: "Applications approved", icon: UserCheck },
    { key: "ACTIVE", label: "Active", value: activeCount, hint: "Live and taking tours", icon: ShieldCheck },
  ];
  const exits: Array<{ key: AccountFilter; label: string; value: number; icon: typeof Users }> = [
    { key: "REJECTED", label: "Rejected", value: rejectedCount, icon: XCircle },
    { key: "SUSPENDED", label: "Suspended", value: suspendedCount, icon: ShieldOff },
  ];
  const spotlight = focus ?? ladder.closest;
  const spotlightNext = spotlight?.nextLevel ? tierOf(spotlight.nextLevel.level) : null;

  return (
    <div id="tour-operators" className="w-full min-w-0 space-y-4">
      {/* Preflight is disabled in this project; scope border-box so w-full pieces don't overflow */}
      <style>{`#tour-operators, #tour-operators * { box-sizing: border-box; }`}</style>

      {/* Header: the promotion track */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <Contours />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Agents module</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tour operators</h1>
              <p className="m-0 mt-1 max-w-xl text-sm text-white/60">Who is climbing, and who is close to the next tier.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/agents" className={heroButton}><Users className="h-3.5 w-3.5" /> Agents module</Link>
              <Link href="/admin/agents/tour-bookings" className={heroButton}><ClipboardList className="h-3.5 w-3.5" /> Tour bookings</Link>
              <Link href="/admin/agents/tour-experience" className={heroButton}><BarChart3 className="h-3.5 w-3.5" /> Tour experience</Link>
              <button type="button" onClick={() => void load()} aria-disabled={loading} title="Refresh tour operators" aria-label="Refresh tour operators" className={`${heroButton} w-9 px-0`}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          {/* Track: operators sit where their progress puts them */}
          <div className="mt-8 px-3 sm:px-4">
            <div className="relative h-10" onMouseLeave={() => setFocus(null)}>
              {ladder.piles.map((pile) => {
                const shown = pile.members.slice(0, 5);
                return (
                  <span
                    key={`${pile.pos}-${pile.members[0].id}`}
                    className="absolute top-0 flex -space-x-2 transition-all duration-700"
                    style={{ left: `${pile.pos}%`, transform: `translateX(-${pile.pos}%)` }}
                  >
                    {shown.map((m) => {
                      const tier = tierOf(m.level);
                      const on = focus?.id === m.id || (!focus && ladder.closest?.id === m.id);
                      return (
                        <Link
                          key={m.id}
                          href={recordHref("agent", m.id)}
                          onMouseEnter={() => setFocus(m)}
                          onFocus={() => setFocus(m)}
                          aria-label={`${nameOf(m) || "Operator"}, ${tier.label}`}
                          className={`relative grid h-8 w-8 place-items-center rounded-full bg-[#0b2420] text-[10px] font-bold text-white/90 no-underline transition-transform hover:z-10 hover:-translate-y-1 ${on ? "z-10 -translate-y-1" : ""}`}
                          style={{ boxShadow: `0 0 0 ${on ? 2.5 : 1.5}px ${tier.hex}` }}
                        >
                          {lettersOf(nameOf(m) || m.user?.email || "")}
                        </Link>
                      );
                    })}
                    {pile.members.length > shown.length ? (
                      <span className="relative grid h-8 min-w-8 place-items-center rounded-full bg-[#163a34] px-1.5 text-[10px] font-bold text-white/70 ring-1 ring-white/15">+{pile.members.length - shown.length}</span>
                    ) : null}
                  </span>
                );
              })}
            </div>

            {/* Rail with a milestone per tier; each milestone filters the register */}
            <div className="relative mt-3 h-1.5 rounded-full bg-white/10">
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                style={{ width: `${Math.max(...ladder.piles.map((p) => p.pos), 0)}%`, background: `linear-gradient(90deg, ${TIERS.map((t) => t.hex).join(", ")})`, opacity: 0.55 }}
                aria-hidden
              />
            </div>
            <div className="relative mt-[-0.6rem] h-16" role="group" aria-label="Filter by operator tier">
              {TIERS.map((tier, i) => {
                const pos = (i / (TIERS.length - 1)) * 100;
                const count = ladder.byTier.get(tier.key)!.length;
                const on = tierFilter === tier.key;
                return (
                  <button
                    key={tier.key}
                    type="button"
                    onClick={() => selectTier(tier.key)}
                    aria-pressed={on}
                    className={`absolute top-0 flex cursor-pointer flex-col border-0 bg-transparent p-0 ${i === 0 ? "items-start" : i === TIERS.length - 1 ? "items-end" : "items-center"}`}
                    style={{ left: `${pos}%`, transform: `translateX(-${pos}%)` }}
                  >
                    <span className="block h-[0.85rem] w-[0.85rem] rounded-full border-2 border-solid bg-[#0b2420]" style={{ borderColor: tier.hex, background: count ? tier.hex : "#0b2420" }} aria-hidden />
                    <span className={`mt-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${on ? "bg-white/10" : "hover:bg-white/[0.06]"}`} style={{ color: tier.hex }}>{tier.label}</span>
                    <span className={`mt-0.5 px-1.5 text-[11px] tabular-nums ${count ? "text-white/75" : "text-white/35"}`}>
                      {loading && !ladderRows.length ? "..." : `${count} ${count === 1 ? "operator" : "operators"}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Spotlight on the hovered operator, else whoever is closest to promotion */}
          <div className="mt-2 flex flex-col gap-3 border-0 border-t border-solid border-white/10 pt-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="m-0 min-w-0 text-xs text-white/60">
              {!spotlight ? (
                loading ? "Reading the track" : "No operators on the track yet."
              ) : !spotlight.nextLevel ? (
                <><span className="font-semibold text-white">{nameOf(spotlight) || "Operator"}</span> has reached Platinum, the top tier.</>
              ) : (
                <>
                  <span className="text-white/45">{focus ? tierOf(spotlight.level).label : `Closest to ${spotlightNext?.label}`}:</span>{" "}
                  <span className="font-semibold text-white">{nameOf(spotlight) || "Operator"}</span>
                  <span className="mx-1.5 tabular-nums font-semibold" style={{ color: spotlightNext?.hex }}>{Math.round(spotlight.nextLevel.progress.overall)}% to {spotlightNext?.label}</span>
                  {missingFor(spotlight).length ? <span className="text-white/50">needs {missingFor(spotlight).join(", ")}</span> : null}
                </>
              )}
            </p>
            <p className="m-0 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50">
              <span><span className="font-semibold tabular-nums text-white">{ladder.tours.toLocaleString()}</span> tours completed</span>
              <span><span className="font-semibold tabular-nums text-emerald-300">{usd(ladder.commission)}</span> NoLSAF commission</span>
              <span>
                {ladder.rating != null
                  ? <><span className="font-semibold tabular-nums text-white">{ladder.rating.toFixed(1)}</span> rating from {ladder.reviews} reviews</>
                  : "No ratings yet"}
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* Intake pipeline: applications in, accounts live, exits on the side */}
      <section aria-label="Filter by stage" className="rounded-2xl border border-solid border-neutral-200 bg-white p-2">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_13rem]">
          {pipeline.map((step, idx) => {
            const Icon = step.icon;
            const on = accountFilter === step.key;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => selectFilter(on ? "" : step.key)}
                aria-pressed={on}
                className={`relative min-w-0 cursor-pointer rounded-xl border border-solid p-3.5 text-left transition-all ${on ? "border-neutral-900 bg-emerald-50/50" : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-800">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#0b2420] text-[10px] font-bold text-emerald-300">{idx + 1}</span>
                    {step.label}
                  </span>
                  <Icon className={`h-4 w-4 ${step.warn ? "text-amber-500" : "text-neutral-400"}`} />
                </span>
                <span className={`mt-2 block text-2xl font-bold tabular-nums leading-none ${step.warn ? "text-amber-600" : "text-neutral-900"}`}>{step.value}</span>
                <span className={`mt-1 block truncate text-[11px] ${step.warn ? "font-semibold text-amber-700" : "text-neutral-500"}`}>{step.hint}</span>
                {idx < pipeline.length - 1 && (
                  <ChevronRight className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white p-0.5 text-neutral-300 ring-1 ring-neutral-200 lg:block" aria-hidden />
                )}
              </button>
            );
          })}
          <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-1 lg:border-0 lg:border-l lg:border-dashed lg:border-neutral-200 lg:pl-2">
            {exits.map((exit) => {
              const Icon = exit.icon;
              const on = accountFilter === exit.key;
              return (
                <button
                  key={exit.key}
                  type="button"
                  onClick={() => selectFilter(on ? "" : exit.key)}
                  aria-pressed={on}
                  className={`flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border border-solid px-3 py-2 text-left transition-all ${on ? "border-neutral-900 bg-rose-50/50" : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${exit.value ? "text-rose-500" : "text-neutral-300"}`} />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-700">{exit.label}</span>
                  <span className="text-sm font-bold tabular-nums text-neutral-900">{exit.value}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Register */}
      <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-col gap-2.5 border-0 border-b border-solid border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <p className="m-0 shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
            {showingApplications ? (accountFilter === "PENDING" ? "Applications in review" : "Rejected applications") : tierFilter ? `${tierOf(tierFilter).label} operators` : accountFilter ? `${titleCase(accountFilter)} operators` : "All operators"}
          </p>
          <div className="relative min-w-0 flex-1 sm:ml-3">
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
              onClick={() => { setTierFilter(""); setRegionFilter(""); setHiredFrom(""); setHiredTo(""); }}
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
          <table className="w-full min-w-[1000px] table-fixed border-collapse text-left">
            <caption className="sr-only">{showingApplications ? "Tour operator applications" : "Tour operators"}</caption>
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[19%]" />
              <col className="w-[14%]" />
              <col className="w-[10%]" />
              <col className="w-[13%]" />
              <col className="w-[9%]" />
              <col className="w-[8%]" />
              <col className="w-[3%]" />
            </colgroup>
            <thead>
              <tr className="border-0 border-b border-solid border-neutral-100">
                <th className="px-4 py-2.5 sm:px-5">{sortHeader("company", showingApplications ? "Applicant" : "Company")}</th>
                <th className="px-3 py-2.5">{sortHeader("contact", "Contact")}</th>
                <th className="px-3 py-2.5">{sortHeader("location", "Location")}</th>
                <th className="px-3 py-2.5">{sortHeader("tier", "Tier")}</th>
                <th className="px-3 py-2.5">{sortHeader("record", "Track record")}</th>
                <th className="px-3 py-2.5">{sortHeader("hiredAt", showingApplications ? "Applied" : "Joined")}</th>
                <th className="px-3 py-2.5">{sortHeader("status", "Status")}</th>
                <th className="px-3 py-2.5"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-0 border-b border-solid border-neutral-50">
                    <td className="px-4 py-3.5 sm:px-5" colSpan={8}>
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
                  <td colSpan={8} className="px-5 py-14 text-center">
                    <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
                      {showingApplications ? <Inbox className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                    </span>
                    <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">{showingApplications ? "No applications here" : "No operators match"}</p>
                    <p className="m-0 mt-1 text-xs text-neutral-500">
                      {q || activeChips.length ? "Try a different search or clear the filters." : "Nothing in this stage yet."}
                    </p>
                  </td>
                </tr>
              ) : showingApplications ? (
                sortedApplicationRows.map((r) => {
                  const rejected = String(r.status).toUpperCase() === "REJECTED";
                  return (
                    <tr key={`app-${r.id}`} className="border-0 border-b border-solid border-neutral-100 text-xs transition hover:bg-emerald-50/40">
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <Initials name={r.fullName || r.email || "Applicant"} muted={rejected} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-neutral-900">{r.fullName || "Unnamed applicant"}</span>
                            <span className="block truncate text-[11px] text-neutral-400">Application</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3"><ContactCell email={r.email} phone={r.phone} /></td>
                      <td className="px-3 py-3 text-neutral-400">Shared after hiring</td>
                      <td className="px-3 py-3 text-neutral-400">None</td>
                      <td className="px-3 py-3 text-neutral-400">Not hired yet</td>
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
                sortedRows.map((r) => {
                  const suspended = String(r.status).toUpperCase() === "SUSPENDED";
                  const name = nameOf(r);
                  const tier = tierOf(r.level);
                  const tags = [...(r.specializations ?? []), ...(r.areasOfOperation ?? [])].filter(Boolean);
                  const tours = Number(r.completedTours || 0);
                  return (
                    <tr key={r.id} className="border-0 border-b border-solid border-neutral-100 text-xs transition hover:bg-emerald-50/40">
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <Initials name={name || "Operator"} muted={suspended} tier={tier} />
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
                              <span className="block text-[11px] text-neutral-400">No specialities listed</span>
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
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tier.pill}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tier.dot}`} aria-hidden /> {tier.label}
                        </span>
                        {r.nextLevel ? (
                          <span className="mt-1 block text-[11px] tabular-nums text-neutral-400">{Math.round(r.nextLevel.progress.overall)}% to {tierOf(r.nextLevel.level).label}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        {tours || r.totalReviews ? (
                          <span className="block">
                            <span className="flex items-center gap-2 font-semibold text-neutral-800">
                              <span className="tabular-nums">{tours} {tours === 1 ? "tour" : "tours"}</span>
                              {r.overallRating != null ? (
                                <span className="inline-flex items-center gap-0.5 tabular-nums text-amber-600"><Star className="h-3 w-3 fill-current" aria-hidden />{Number(r.overallRating).toFixed(1)}</span>
                              ) : null}
                            </span>
                            <span className="block text-[11px] tabular-nums text-neutral-400">{usd(Number(r.noLSAFRevenue || 0))} commission</span>
                          </span>
                        ) : (
                          <span className="text-neutral-400">No tours yet</span>
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
                        <Link href={recordHref("agent", r.id)} title="Open operator" aria-label="Open operator" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 no-underline transition hover:bg-emerald-50 hover:text-emerald-700">
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
            {shownCount ? <>Showing <span className="font-bold text-neutral-800">{firstShown} to {lastShown}</span>{paged ? <> of <span className="font-bold text-neutral-800">{total}</span></> : ""}</> : "Nothing to show"}
          </span>
          {paged && pages > 1 ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 transition hover:bg-neutral-50 aria-disabled:pointer-events-none aria-disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Prev
              </button>
              <span className="tabular-nums text-neutral-500">Page {page} of {pages}</span>
              <button
                type="button"
                aria-disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 transition hover:bg-neutral-50 aria-disabled:pointer-events-none aria-disabled:opacity-40"
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
