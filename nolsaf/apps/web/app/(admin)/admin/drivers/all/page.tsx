"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import {
  Search,
  Truck,
  ShieldOff,
  Ban,
  WifiOff,
  Star,
  Route,
  Calendar,
  Eye,
  X,
  Activity,
  Award,
  Trophy,
  UserPlus,
  BarChart3,
  Bell,
  CheckCircle2,
  XCircle,
  UserX,
  Clock,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import { adminRefOrId, useAdminHref } from "@/lib/adminRecordRefs";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;

function authify() {}

type DriverRow = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  region: string | null;
  operationArea: string | null;
  vehicleType: string | null;
  plateNumber: string | null;
  isVipDriver: boolean;
  suspendedAt: string | null;
  isDisabled: boolean;
  available: boolean | null;
  isAvailable: boolean | null;
  rating: number | null;
  kycStatus: string | null;
  performance?: {
    totalTrips: number;
    completedTrips: number;
    canceledTrips: number;
    avgRating: number | null;
    lastTripAt: string | null;
  };
};

type DriversResponse = {
  total: number;
  page: number;
  pageSize: number;
  items: DriverRow[];
};

type DriverStatsData = {
  driver: { id: number; name: string; email: string } | null;
  date: string;
  todaysRides: number;
  earnings: number;
  rating: number;
};

type DriverReferralsData = {
  driver: { id: number; name: string; email: string; region?: string | null; district?: string | null } | null;
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  activeReferrals: number;
  totalCredits: number;
  pendingCredits: number;
  referrals: Array<{ id: string; name: string; email: string; status: string; joinedAt?: string; creditsEarned?: number; spend?: number }>;
};

type DriverBonusesData = {
  driver: { id: number; name: string; email: string } | null;
  total: number;
  page: number;
  pageSize: number;
  items: Array<{ id: string; date: string; amount: number; status?: string; period?: string; reason?: string | null }>;
};

type DriverSortKey = "driver" | "status" | "kyc" | "vehicle" | "area" | "trips" | "rating" | "joined";

function statusLabel(d: DriverRow) {
  if (d.isDisabled) return "Disabled";
  if (d.suspendedAt) return "Suspended";
  const isAvail = (d.available ?? d.isAvailable ?? true) === true;
  if (!isAvail) return "Unavailable";
  return "Active";
}

function StatusIcon({ driver }: { driver: DriverRow }) {
  const label = statusLabel(driver);

  if (label === "Disabled") {
    return (
      <span className="inline-flex items-center" title={label} aria-label={label}>
        <ShieldOff className="h-4 w-4 text-gray-600" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  if (label === "Suspended") {
    return (
      <span className="inline-flex items-center" title={label} aria-label={label}>
        <Ban className="h-4 w-4 text-amber-600" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  if (label === "Unavailable") {
    return (
      <span className="inline-flex items-center" title={label} aria-label={label}>
        <WifiOff className="h-4 w-4 text-slate-600" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center" title={label} aria-label={label}>
      <Truck className="h-4 w-4 text-emerald-600" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function formatDateShort(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] || "?";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (first + second).toUpperCase();
}

export default function AdminAllDriversPage() {
  const recordHref = useAdminHref();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DriverRow[]>([]);
  const [total, setTotal] = useState(0);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "SUSPENDED" | "DISABLED" | "UNAVAILABLE">("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [sortBy, setSortBy] = useState<DriverSortKey>("joined");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewDriver, setOverviewDriver] = useState<DriverRow | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewStats, setOverviewStats] = useState<DriverStatsData | null>(null);
  const [overviewReferrals, setOverviewReferrals] = useState<DriverReferralsData | null>(null);
  const [overviewBonuses, setOverviewBonuses] = useState<DriverBonusesData | null>(null);
  const [kycLoading, setKycLoading] = useState<Record<number, boolean>>({});

  // Revoke modal state
  const [revokeTarget, setRevokeTarget] = useState<DriverRow | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokePolicyAgreed, setRevokePolicyAgreed] = useState(false);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // Unrevoke modal state
  const [unrevokeTarget, setUnrevokeTarget] = useState<DriverRow | null>(null);
  const [unrevokeReason, setUnrevokeReason] = useState("");
  const [unrevokePolicyAgreed, setUnrevokePolicyAgreed] = useState(false);
  const [unrevokeSubmitting, setUnrevokeSubmitting] = useState(false);
  const [unrevokeError, setUnrevokeError] = useState<string | null>(null);

  // Reject modal state
  const [rejectTarget, setRejectTarget] = useState<DriverRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  function openRevokeModal(driver: DriverRow) {
    setRevokeTarget(driver);
    setRevokeReason("");
    setRevokePolicyAgreed(false);
    setRevokeError(null);
  }

  function openRejectModal(driver: DriverRow) {
    setRejectTarget(driver);
    setRejectReason("");
    setRejectError(null);
  }

  function openUnrevokeModal(driver: DriverRow) {
    setUnrevokeTarget(driver);
    setUnrevokeReason("");
    setUnrevokePolicyAgreed(false);
    setUnrevokeError(null);
  }

  async function submitRevoke() {
    if (!revokeTarget || !revokeReason || !revokePolicyAgreed) return;
    setRevokeSubmitting(true);
    setRevokeError(null);
    try {
      await api.patch(`/api/admin/drivers/${revokeTarget.id}/kyc`, { action: 'revoke', reason: revokeReason });
      setItems(prev => prev.map(d =>
        d.id === revokeTarget.id ? { ...d, kycStatus: 'REJECTED_KYC' } : d
      ));
      setRevokeTarget(null);
    } catch (e: any) {
      setRevokeError(e?.response?.data?.message || e?.message || 'Failed to revoke driver access');
    } finally {
      setRevokeSubmitting(false);
    }
  }

  async function submitReject() {
    if (!rejectTarget) return;
    setRejectSubmitting(true);
    setRejectError(null);
    try {
      await api.patch(`/api/admin/drivers/${rejectTarget.id}/kyc`, {
        action: 'reject',
        reason: rejectReason.trim() || undefined,
      });
      setItems(prev => prev.map(d =>
        d.id === rejectTarget.id ? { ...d, kycStatus: 'REJECTED_KYC' } : d
      ));
      setRejectTarget(null);
    } catch (e: any) {
      setRejectError(e?.response?.data?.message || e?.message || 'Failed to reject driver');
    } finally {
      setRejectSubmitting(false);
    }
  }

  async function submitUnrevoke() {
    if (!unrevokeTarget || !unrevokeReason || !unrevokePolicyAgreed) return;
    setUnrevokeSubmitting(true);
    setUnrevokeError(null);
    try {
      await api.patch(`/api/admin/drivers/${unrevokeTarget.id}/kyc`, {
        action: 'unrevoke',
        reason: unrevokeReason,
      });
      setItems(prev => prev.map(d =>
        d.id === unrevokeTarget.id
          ? { ...d, suspendedAt: null, kycStatus: 'APPROVED_KYC' }
          : d
      ));
      setUnrevokeTarget(null);
    } catch (e: any) {
      setUnrevokeError(e?.response?.data?.message || e?.message || 'Failed to lift driver suspension');
    } finally {
      setUnrevokeSubmitting(false);
    }
  }

  async function approveDriver(driverId: number) {
    setKycLoading(prev => ({ ...prev, [driverId]: true }));
    try {
      await api.patch(`/api/admin/drivers/${driverId}/kyc`, { action: 'approve' });
      setItems(prev => prev.map(d =>
        d.id === driverId ? { ...d, kycStatus: 'APPROVED_KYC' } : d
      ));
    } catch (e: any) {
      alert(e?.response?.data?.message || e?.message || 'Failed to approve driver');
    } finally {
      setKycLoading(prev => ({ ...prev, [driverId]: false }));
    }
  }

  useEffect(() => {
    authify();
  }, []);

  useEffect(() => {
    if (!overviewOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverviewOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [overviewOpen]);

  async function openOverview(driver: DriverRow) {
    setOverviewDriver(driver);
    setOverviewOpen(true);
    setOverviewLoading(true);
    setOverviewError(null);
    setOverviewStats(null);
    setOverviewReferrals(null);
    setOverviewBonuses(null);

    try {
      const today = new Date().toISOString().split("T")[0];
      const [statsR, referralsR, bonusesR] = await Promise.allSettled([
        api.get<DriverStatsData>(`/api/admin/drivers/${driver.id}/stats`, { params: { date: today } }),
        api.get<DriverReferralsData>(`/api/admin/drivers/${driver.id}/referrals`),
        api.get<DriverBonusesData>(`/api/admin/drivers/${driver.id}/bonuses`, { params: { page: 1, pageSize: 5 } }),
      ]);

      if (statsR.status === "fulfilled") setOverviewStats(statsR.value.data);
      if (referralsR.status === "fulfilled") setOverviewReferrals(referralsR.value.data);
      if (bonusesR.status === "fulfilled") setOverviewBonuses(bonusesR.value.data);

      if (statsR.status === "rejected" && referralsR.status === "rejected" && bonusesR.status === "rejected") {
        setOverviewError("Failed to load driver overview");
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Failed to load driver overview";
      setOverviewError(String(msg));
    } finally {
      setOverviewLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.get<DriversResponse>("/api/admin/drivers", {
          params: {
            page: 1,
            pageSize: 100,
            q: q || undefined,
            status: status || undefined,
          },
        });
        if (cancelled) return;
        setItems(r.data?.items ?? []);
        setTotal(r.data?.total ?? 0);
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.response?.data?.error || e?.message || "Failed to load drivers";
        setError(String(msg));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [q, status]);

  useEffect(() => {
    setPage(1);
  }, [q, status, sortBy, sortDir]);

  const sortedRows = useMemo(() => {
    const next = [...items];
    const readValue = (d: DriverRow): string | number => {
      switch (sortBy) {
        case "driver":
          return `${d.name || ""} ${d.email || ""}`.toLowerCase();
        case "status":
          return statusLabel(d).toLowerCase();
        case "kyc":
          return String(d.suspendedAt ? "REVOKED" : (d.kycStatus || "")).toLowerCase();
        case "vehicle":
          return `${d.vehicleType || ""} ${d.plateNumber || ""}`.toLowerCase();
        case "area":
          return `${d.region || ""} ${d.operationArea || ""}`.toLowerCase();
        case "trips":
          return Number(d.performance?.totalTrips ?? 0);
        case "rating":
          return Number(d.performance?.avgRating ?? d.rating ?? -1);
        case "joined":
          return new Date(d.createdAt || "").getTime() || 0;
        default:
          return "";
      }
    };

    next.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return next;
  }, [items, sortBy, sortDir]);

  const rows = sortedRows;
  const totalFiltered = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedRows = rows.slice(startIndex, startIndex + pageSize);

  function handleSort(field: DriverSortKey) {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "joined" || field === "trips" || field === "rating" ? "desc" : "asc");
  }

  function renderSortIcon(field: DriverSortKey) {
    if (sortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-blue-600" />
      : <ChevronDown className="h-3.5 w-3.5 text-blue-600" />;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center mb-3">
            <Truck className="h-6 w-6 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">All Drivers</h1>
          <p className="text-sm text-gray-500 mt-1">Manage platform drivers: performance, status, and details</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden />
            <input
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
              placeholder="Search drivers by name, email, phone…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Status</label>
            <select
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value as any);
              }}
              className="border border-gray-300 rounded-lg text-sm px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="UNAVAILABLE">Unavailable</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="DISABLED">Disabled</option>
              <option value="PENDING_KYC">⏳ Pending Approval</option>
              <option value="APPROVED_KYC">✅ Approved</option>
              <option value="REJECTED_KYC">❌ Rejected</option>
            </select>
          </div>

          <div className="text-xs text-gray-500 whitespace-nowrap">{loading ? "Loading…" : `${total.toLocaleString()} total`}</div>
        </div>

        {error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : loading ? (
          <div className="p-6 text-sm text-gray-600">Loading drivers…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">No drivers found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">
                    <button type="button" onClick={() => handleSort("driver")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                      Driver {renderSortIcon("driver")}
                    </button>
                  </th>
                  <th className="text-left font-semibold px-4 py-3">
                    <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                      Status {renderSortIcon("status")}
                    </button>
                  </th>
                  <th className="text-left font-semibold px-4 py-3">
                    <button type="button" onClick={() => handleSort("kyc")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                      KYC {renderSortIcon("kyc")}
                    </button>
                  </th>
                  <th className="text-left font-semibold px-4 py-3">
                    <button type="button" onClick={() => handleSort("vehicle")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                      Vehicle {renderSortIcon("vehicle")}
                    </button>
                  </th>
                  <th className="text-left font-semibold px-4 py-3">
                    <button type="button" onClick={() => handleSort("area")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                      Area {renderSortIcon("area")}
                    </button>
                  </th>
                  <th className="text-left font-semibold px-4 py-3">
                    <button type="button" onClick={() => handleSort("trips")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                      Trips {renderSortIcon("trips")}
                    </button>
                  </th>
                  <th className="text-left font-semibold px-4 py-3">
                    <button type="button" onClick={() => handleSort("rating")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                      Rating {renderSortIcon("rating")}
                    </button>
                  </th>
                  <th className="text-left font-semibold px-4 py-3">
                    <button type="button" onClick={() => handleSort("joined")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                      Joined {renderSortIcon("joined")}
                    </button>
                  </th>
                  <th className="text-left font-semibold px-4 py-3">Activities</th>
                  <th className="text-right font-semibold px-4 py-3">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pagedRows.map((d) => {
                  const trips = d.performance?.totalTrips ?? 0;
                  const completed = d.performance?.completedTrips ?? 0;
                  const canceled = d.performance?.canceledTrips ?? 0;
                  const avg = d.performance?.avgRating ?? d.rating;

                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 truncate max-w-[280px]" title={d.name}>
                          {d.name}
                          {d.isVipDriver ? <span className="ml-2 text-xs font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">VIP</span> : null}
                        </div>
                        <div className="text-xs text-gray-500 truncate max-w-[320px]" title={d.email}>{d.email || "—"}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[320px]" title={d.phone || ""}>{d.phone || "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusIcon driver={d} />
                          <span className="text-xs text-gray-700">{statusLabel(d)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {d.suspendedAt && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-800 border border-red-200">
                            <ShieldX className="w-3 h-3" />Revoked
                          </span>
                        )}
                        {!d.suspendedAt && d.kycStatus === 'PENDING_KYC' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3 h-3" />Pending
                          </span>
                        )}
                        {!d.suspendedAt && d.kycStatus === 'APPROVED_KYC' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <ShieldCheck className="w-3 h-3" />Approved
                          </span>
                        )}
                        {!d.suspendedAt && d.kycStatus === 'REJECTED_KYC' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                            <ShieldX className="w-3 h-3" />Rejected
                          </span>
                        )}
                        {!d.kycStatus && (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900 truncate max-w-[200px]" title={d.vehicleType || ""}>{d.vehicleType || "—"}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[200px]" title={d.plateNumber || ""}>{d.plateNumber || ""}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900 truncate max-w-[220px]" title={d.region || ""}>{d.region || "—"}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[220px]" title={d.operationArea || ""}>{d.operationArea || ""}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-gray-900">
                          <Route className="h-4 w-4 text-gray-400" aria-hidden />
                          <span className="tabular-nums">{trips}</span>
                        </div>
                        <div className="text-xs text-gray-500 tabular-nums">{completed} completed · {canceled} canceled</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Star className="h-4 w-4 text-amber-500" aria-hidden />
                          <span className="tabular-nums text-gray-900">{avg != null ? Number(avg).toFixed(1) : "—"}</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          Last trip: {formatDateShort(d.performance?.lastTripAt || null)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-gray-900">
                          <Calendar className="h-4 w-4 text-gray-400" aria-hidden />
                          <span className="tabular-nums">{formatDateShort(d.createdAt)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/drivers/activities?driverId=${adminRefOrId("driver", d.id)}`}
                            className="inline-flex items-center text-gray-600 hover:text-emerald-700 no-underline"
                            title="Activities"
                            aria-label="Open activities"
                          >
                            <Activity className="h-4 w-4" aria-hidden />
                          </Link>
                          <Link
                            href={`/admin/drivers/stats?driverId=${adminRefOrId("driver", d.id)}`}
                            className="inline-flex items-center text-gray-600 hover:text-green-700 no-underline"
                            title="Stats"
                            aria-label="Open stats"
                          >
                            <BarChart3 className="h-4 w-4" aria-hidden />
                          </Link>
                          <Link
                            href={`/admin/drivers/referrals?driverId=${adminRefOrId("driver", d.id)}`}
                            className="inline-flex items-center text-gray-600 hover:text-blue-700 no-underline"
                            title="Referrals"
                            aria-label="Open referrals"
                          >
                            <UserPlus className="h-4 w-4" aria-hidden />
                          </Link>
                          <Link
                            href={`/admin/drivers/bonuses?driverId=${adminRefOrId("driver", d.id)}`}
                            className="inline-flex items-center text-gray-600 hover:text-amber-700 no-underline"
                            title="Bonuses"
                            aria-label="Open bonuses"
                          >
                            <Award className="h-4 w-4" aria-hidden />
                          </Link>
                          <Link
                            href={`/admin/drivers/levels?driverId=${adminRefOrId("driver", d.id)}`}
                            className="inline-flex items-center text-gray-600 hover:text-violet-700 no-underline"
                            title="Levels"
                            aria-label="Open levels"
                          >
                            <Trophy className="h-4 w-4" aria-hidden />
                          </Link>
                          <Link
                            href={`/admin/drivers/trips?driverId=${adminRefOrId("driver", d.id)}`}
                            className="inline-flex items-center text-gray-600 hover:text-sky-700 no-underline"
                            title="Trips"
                            aria-label="Open trips"
                          >
                            <Route className="h-4 w-4" aria-hidden />
                          </Link>
                          <Link
                            href={`/admin/drivers/reminders?driverId=${adminRefOrId("driver", d.id)}`}
                            className="inline-flex items-center text-gray-600 hover:text-rose-700 no-underline"
                            title="Reminders"
                            aria-label="Open reminders"
                          >
                            <Bell className="h-4 w-4" aria-hidden />
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openOverview(d)}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 border border-gray-200"
                            aria-label="Open quick driver overview"
                            title="Quick overview"
                          >
                            <Activity className="h-4 w-4" aria-hidden />
                            <span className="sr-only">Overview</span>
                          </button>
                          <Link
                            href={recordHref("driver", d.id)}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-blue-600 hover:text-blue-800 hover:bg-blue-50 border border-gray-200 no-underline"
                            title="View driver details"
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                            <span className="sr-only">Details</span>
                          </Link>
                          {/* KYC approve / reject / revoke actions */}
                          {(d.kycStatus === 'PENDING_KYC' || (d.kycStatus === 'REJECTED_KYC' && !d.suspendedAt)) && (
                            <>
                              <button
                                type="button"
                                disabled={kycLoading[d.id]}
                                onClick={() => approveDriver(d.id)}
                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 transition-colors"
                                title="Approve driver"
                              >
                                {kycLoading[d.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                <span className="sr-only">Approve</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openRejectModal(d)}
                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors"
                                title="Reject driver"
                              >
                                <XCircle className="w-4 h-4" />
                                <span className="sr-only">Reject</span>
                              </button>
                            </>
                          )}
                          {d.kycStatus === 'APPROVED_KYC' && !d.suspendedAt && (
                            <button
                              type="button"
                              onClick={() => openRevokeModal(d)}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-600 bg-slate-50 hover:bg-red-50 hover:text-red-700 border border-slate-200 hover:border-red-200 transition-colors"
                              title="Revoke driver access"
                            >
                              <UserX className="w-4 h-4" />
                              <span className="sr-only">Revoke</span>
                            </button>
                          )}
                          {d.suspendedAt && (
                            <button
                              type="button"
                              onClick={() => openUnrevokeModal(d)}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                              title="Lift driver suspension"
                            >
                              <CheckCircle2 className="w-4 h-4" aria-hidden />
                              <span className="sr-only">Lift driver suspension</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                Showing {totalFiltered === 0 ? 0 : startIndex + 1}-{Math.min(startIndex + pageSize, totalFiltered)} of {totalFiltered}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Previous
                </button>
                <span className="text-xs font-semibold text-gray-600">Page {safePage} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Revoke confirmation modal ─────────────────────────────────── */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" onClick={() => setRevokeTarget(null)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Revoke driver access"
            className="relative my-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 bg-red-50 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                <ShieldX className="w-5 h-5 text-red-700" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-red-900">Revoke Driver Access</h2>
                <p className="text-xs text-red-700 mt-0.5 truncate">{revokeTarget.name} — {revokeTarget.email}</p>
              </div>
              <button onClick={() => setRevokeTarget(null)} className="p-1 rounded-lg hover:bg-red-100 text-red-600 transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Warning */}
              <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 leading-relaxed">
                  This will immediately remove the driver's access to the NoLSAF driver portal. The driver will be notified by SMS and email.
                </p>
              </div>

              {/* Reason dropdown */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Reason for revocation <span className="text-red-500">*</span>
                </label>
                <select
                  value={revokeReason}
                  onChange={e => setRevokeReason(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none bg-white"
                >
                  <option value="">— Select a reason —</option>
                  <option value="Policy violation">Policy violation</option>
                  <option value="Fraudulent documents">Fraudulent documents</option>
                  <option value="Unacceptable conduct">Unacceptable conduct</option>
                  <option value="Extended inactivity">Extended inactivity</option>
                  <option value="Account security concern">Account security concern</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Policy checkbox */}
              <label className="flex items-start gap-2.5 cursor-pointer p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <input
                  type="checkbox"
                  checked={revokePolicyAgreed}
                  onChange={e => setRevokePolicyAgreed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-red-600 focus:ring-red-500 flex-shrink-0 cursor-pointer"
                />
                <span className="text-xs text-slate-600 leading-relaxed">
                  I confirm that I have reviewed this driver's record, that revocation is warranted, and that I take full responsibility for this action.
                </span>
              </label>

              {revokeError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{revokeError}</p>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-200 px-5 py-4">
              <div className="flex gap-3">
              <button
                disabled={revokeSubmitting || !revokeReason || !revokePolicyAgreed}
                onClick={submitRevoke}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-700 text-white transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {revokeSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldX className="w-4 h-4" />}
                Confirm Revocation
              </button>
              <button
                onClick={() => setRevokeTarget(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Unrevoke confirmation modal ───────────────────────────────── */}
      {unrevokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" onClick={() => setUnrevokeTarget(null)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Lift driver suspension"
            className="relative my-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] flex flex-col"
          >
            <div className="px-5 py-4 border-b border-slate-200 bg-emerald-50 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-700" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-emerald-900">Lift Driver Suspension</h2>
                <p className="text-xs text-emerald-700 mt-0.5 truncate">{unrevokeTarget.name} — {unrevokeTarget.email}</p>
              </div>
              <button onClick={() => setUnrevokeTarget(null)} className="p-1 rounded-lg hover:bg-emerald-100 text-emerald-700 transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="flex items-start gap-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <AlertTriangle className="w-4 h-4 text-emerald-700 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-700 leading-relaxed">
                  You are about to unsuspend this driver and restore access to the NoLSAF driver portal. The driver will receive a dedicated unsuspension SMS and email.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Reason for unsuspend <span className="text-red-500">*</span>
                </label>
                <select
                  value={unrevokeReason}
                  onChange={e => setUnrevokeReason(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none bg-white"
                >
                  <option value="">— Select a reason —</option>
                  <option value="Appeal reviewed and approved">Appeal reviewed and approved</option>
                  <option value="Issue resolved">Issue resolved</option>
                  <option value="Documents verified and cleared">Documents verified and cleared</option>
                  <option value="Administrative correction">Administrative correction</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <input
                  type="checkbox"
                  checked={unrevokePolicyAgreed}
                  onChange={e => setUnrevokePolicyAgreed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 flex-shrink-0 cursor-pointer"
                />
                <span className="text-xs text-slate-600 leading-relaxed">
                  I confirm that I have reviewed this suspension case, that restoring access is justified, and that I take responsibility for this unsuspend action.
                </span>
              </label>

              {unrevokeError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{unrevokeError}</p>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-200 px-5 py-4">
              <div className="flex gap-3">
                <button
                  disabled={unrevokeSubmitting || !unrevokeReason || !unrevokePolicyAgreed}
                  onClick={submitUnrevoke}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {unrevokeSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm Unsuspend
                </button>
                <button
                  onClick={() => setUnrevokeTarget(null)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject confirmation modal ─────────────────────────────────── */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" onClick={() => setRejectTarget(null)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Reject driver"
            className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 bg-red-50 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                <XCircle className="w-5 h-5 text-red-700" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-red-900">Reject Driver Application</h2>
                <p className="text-xs text-red-700 mt-0.5 truncate">{rejectTarget.name} — {rejectTarget.email}</p>
              </div>
              <button onClick={() => setRejectTarget(null)} className="p-1 rounded-lg hover:bg-red-100 text-red-600 transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Rejection reason <span className="text-slate-400 font-normal">(sent to driver)</span>
                </label>
                <textarea
                  rows={3}
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="e.g. Driving licence image is blurry or unreadable"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none resize-none bg-white"
                />
              </div>

              {rejectError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{rejectError}</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-200 flex gap-3">
              <button
                disabled={rejectSubmitting}
                onClick={submitReject}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-700 text-white transition-all shadow-sm disabled:opacity-50"
              >
                {rejectSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Confirm Rejection
              </button>
              <button
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {overviewOpen && overviewDriver ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={() => setOverviewOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Driver overview"
            className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col"
          >
            <div className="px-5 sm:px-6 py-4 sm:py-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex items-start gap-4">
                  <div className="h-12 w-12 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold tracking-wide flex-shrink-0">
                    {initials(overviewDriver.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold text-slate-900 truncate" title={overviewDriver.name}>
                        {overviewDriver.name}
                      </h2>
                      {overviewDriver.isVipDriver ? (
                        <span className="text-[11px] font-semibold text-violet-700 bg-violet-100/70 px-2 py-0.5 rounded-full">
                          VIP
                        </span>
                      ) : null}
                      <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                        {statusLabel(overviewDriver)}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600 truncate" title={overviewDriver.email}>
                      {overviewDriver.email || "—"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        <Route className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                        Trips: <span className="font-semibold text-slate-700">{overviewDriver.performance?.totalTrips ?? 0}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                        Last trip: <span className="font-semibold text-slate-700">{formatDateShort(overviewDriver.performance?.lastTripAt || null)}</span>
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setOverviewOpen(false)}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1 space-y-6">
              {overviewError ? <div className="text-sm text-red-600">{overviewError}</div> : null}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 p-4 bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-500">Today’s rides</div>
                    <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <Route className="h-4 w-4 text-emerald-700" aria-hidden />
                    </div>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
                    {overviewStats ? overviewStats.todaysRides : overviewLoading ? "…" : "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-500">Today’s earnings</div>
                    <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <BarChart3 className="h-4 w-4 text-blue-700" aria-hidden />
                    </div>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
                    {overviewStats ? overviewStats.earnings.toLocaleString() : overviewLoading ? "…" : "—"}
                    {overviewStats ? <span className="ml-1 text-xs font-semibold text-slate-500">TZS</span> : null}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-500">Rating</div>
                    <div className="h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center">
                      <Star className="h-4 w-4 text-amber-700" aria-hidden />
                    </div>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
                    {overviewStats ? overviewStats.rating.toFixed(1) : overviewLoading ? "…" : overviewDriver.rating != null ? Number(overviewDriver.rating).toFixed(1) : "—"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 font-semibold text-slate-900">
                      <UserPlus className="h-4 w-4 text-slate-500" aria-hidden />
                      Referrals
                    </div>
                    <Link
                      href={`/admin/drivers/referrals?driverId=${adminRefOrId("driver", overviewDriver.id)}`}
                      className="text-xs font-semibold text-blue-700 hover:text-blue-800 no-underline"
                    >
                      Open
                    </Link>
                  </div>
                  <div className="p-4">
                    {overviewReferrals ? (
                      <div className="space-y-2">
                        <div className="text-sm text-slate-700">
                          <span className="font-semibold">{overviewReferrals.totalReferrals}</span> total ·{" "}
                          <span className="font-semibold">{overviewReferrals.activeReferrals}</span> active ·{" "}
                          <span className="font-semibold">{overviewReferrals.totalCredits.toLocaleString()}</span> credits
                        </div>
                        {overviewReferrals.referralLink ? (
                          <div className="text-xs text-slate-500 break-all">
                            Link:{" "}
                            <a className="text-blue-700 hover:text-blue-800" href={overviewReferrals.referralLink} target="_blank" rel="noreferrer">
                              {overviewReferrals.referralLink}
                            </a>
                          </div>
                        ) : null}
                        {overviewReferrals.referrals?.length ? (
                          <div className="text-xs text-slate-600">
                            Recent: {overviewReferrals.referrals.slice(0, 3).map((r) => r.name).filter(Boolean).join(", ")}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500">No referrals found.</div>
                        )}
                      </div>
                    ) : overviewLoading ? (
                      <div className="text-sm text-slate-600">Loading referrals…</div>
                    ) : (
                      <div className="text-sm text-slate-600">Referrals unavailable.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 font-semibold text-slate-900">
                      <Trophy className="h-4 w-4 text-slate-500" aria-hidden />
                      Bonuses
                    </div>
                    <Link
                      href={`/admin/drivers/bonuses?driverId=${adminRefOrId("driver", overviewDriver.id)}`}
                      className="text-xs font-semibold text-blue-700 hover:text-blue-800 no-underline"
                    >
                      Open
                    </Link>
                  </div>
                  <div className="p-4">
                    {overviewBonuses ? (
                      <div className="space-y-3">
                        <div className="text-sm text-slate-700">
                          <span className="font-semibold">{overviewBonuses.total}</span> total bonuses
                        </div>
                        {overviewBonuses.items?.length ? (
                          <div className="space-y-2">
                            {overviewBonuses.items.slice(0, 5).map((b) => (
                              <div key={b.id} className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-slate-800 truncate" title={b.reason || ""}>
                                    {b.reason || b.period || "Bonus"}
                                  </div>
                                  <div className="text-[11px] text-slate-500 tabular-nums">{formatDateShort(b.date)}</div>
                                </div>
                                <div className="text-xs font-semibold text-slate-900 tabular-nums">{Number(b.amount || 0).toLocaleString()}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500">No bonus history found.</div>
                        )}
                      </div>
                    ) : overviewLoading ? (
                      <div className="text-sm text-slate-600">Loading bonuses…</div>
                    ) : (
                      <div className="text-sm text-slate-600">Bonuses unavailable.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <div className="font-semibold text-slate-900">Quick links</div>
                </div>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Link href={`/admin/drivers/activities?driverId=${adminRefOrId("driver", overviewDriver.id)}`} className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl no-underline inline-flex items-center justify-center">Activities</Link>
                  <Link href={`/admin/drivers/stats?driverId=${adminRefOrId("driver", overviewDriver.id)}`} className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl no-underline inline-flex items-center justify-center">Stats</Link>
                  <Link href={`/admin/drivers/referrals?driverId=${adminRefOrId("driver", overviewDriver.id)}`} className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl no-underline inline-flex items-center justify-center">Referrals</Link>
                  <Link href={`/admin/drivers/bonuses?driverId=${adminRefOrId("driver", overviewDriver.id)}`} className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl no-underline inline-flex items-center justify-center">Bonuses</Link>
                  <Link href={`/admin/drivers/levels?driverId=${adminRefOrId("driver", overviewDriver.id)}`} className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl no-underline inline-flex items-center justify-center">Levels</Link>
                  <Link href={`/admin/drivers/trips?driverId=${adminRefOrId("driver", overviewDriver.id)}`} className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl no-underline inline-flex items-center justify-center">Trips</Link>
                  <Link href={`/admin/drivers/reminders?driverId=${adminRefOrId("driver", overviewDriver.id)}`} className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl no-underline inline-flex items-center justify-center">Reminders</Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
