"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeDollarSign,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  ListFilter,
  Loader2,
  Search,
  ShieldCheck,
  Timer,
  Trophy,
  UserCheck,
  UserMinus,
  X,
} from "lucide-react";
import TableRow from "@/components/TableRow";
import { useSocket } from "@/hooks/useSocket";
import { useAdminHref } from "@/lib/adminRecordRefs";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;
function authify() {}

type ScheduledTripRow = {
  id: number;
  tripCode: string;
  passenger: { id: number; name: string | null; email: string | null; phone: string | null } | null;
  driver: { id: number; name: string | null; email: string | null; phone: string | null } | null;
  pickup: string;
  dropoff: string;
  scheduledAt: string;
  vehicleType: string | null;
  amount: number;
  currency: string;
  status: string;
  paymentStatus: string;
  stage: string;
  claimWindowHours: number;
  claimOpensAt: string;
  canClaimNow: boolean;
  claimCount: number;
  claimLimit: number;
  claimsRemaining: number;
  createdAt: string;
  notes?: string | null;
};

type ScheduledTripClaim = {
  id: number;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  driver: {
    id: number;
    name: string | null;
    email: string | null;
    phone: string | null;
    isVipDriver: boolean | null;
  };
  reviewer: { id: number; name: string | null; email: string | null } | null;
  recommendation?: { recommended: boolean; score: number; reasons?: string[] } | null;
};

type ScheduledTripDetailsResponse = {
  booking: {
    id: number;
    tripCode: string;
    scheduledAt: string;
    vehicleType: string | null;
    amount: number;
    currency: string;
    status: string;
    paymentStatus: string;
    pickup: { address: string | null; ward: string | null; district: string | null; region: string | null };
    dropoff: { address: string | null; ward: string | null; district: string | null; region: string | null };
    passenger: { id: number; name: string | null; email: string | null; phone: string | null } | null;
    driver: { id: number; name: string | null; email: string | null; phone: string | null } | null;
    property: { id: number; title: string | null; regionName: string | null; district: string | null; ward: string | null } | null;
    createdAt: string;
  };
  assignmentAudit: {
    assignedAt: string;
    assignedBy: { id: number; name: string | null; email: string | null } | null;
    kind?: string | null;
    reason: string | null;
    claimId: number | null;
    driverId: number | null;
  } | null;
  assignmentAudits: Array<{
    assignedAt: string;
    assignedBy: { id: number; name: string | null; email: string | null } | null;
    kind?: string | null;
    reason: string | null;
    claimId: number | null;
    driverId: number | null;
  }>;
  claims: ScheduledTripClaim[];
};

function formatDateTime(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms)) return "";
  const clamped = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

type ClaimStatusVariant = "assigned" | "open" | "waiting" | "expired" | "unknown";

function claimTimingLabel(row: ScheduledTripRow): { text: string; variant: ClaimStatusVariant } {
  const now = Date.now();
  const opensAt = new Date(row.claimOpensAt).getTime();
  const scheduledAt = new Date(row.scheduledAt).getTime();
  if (!Number.isFinite(opensAt) || !Number.isFinite(scheduledAt)) return { text: "Unknown", variant: "unknown" };
  if (row.driver != null) return { text: "Assigned", variant: "assigned" };
  if (now < opensAt) return { text: `Opens in ${formatDuration(opensAt - now)}`, variant: "waiting" };
  if (now >= opensAt && now <= scheduledAt) return { text: "Claims open", variant: "open" };
  return { text: "Expired", variant: "expired" };
}

const CLAIM_STATUS_STYLES: Record<ClaimStatusVariant, string> = {
  assigned: "bg-green-100 text-green-800",
  open: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
  waiting: "bg-slate-100 text-slate-700",
  expired: "bg-rose-100 text-rose-800",
  unknown: "bg-gray-100 text-gray-500",
};

function compactPreviewText(input: string, headWords = 2) {
  const text = (input ?? "").trim();
  if (!text) return "";

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= headWords + 1) return text;

  const head = words.slice(0, headWords).join(" ");

  // Prefer a human-readable last word (skip trailing airport/city codes like "(DAR)").
  let tailIndex = words.length - 1;
  while (tailIndex > 0 && /^\([A-Z0-9]{2,6}\)$/.test(words[tailIndex])) {
    tailIndex -= 1;
  }
  const tail = words[tailIndex];

  if (!tail || head === tail) return head;
  return `${head}…${tail}`;
}

function compactLocation(loc: { address: string | null; ward: string | null; district: string | null; region: string | null }) {
  if (loc.address) return loc.address;
  const parts = [loc.ward, loc.district, loc.region].filter(Boolean);
  return parts.length ? parts.join(", ") : "N/A";
}

export default function AdminScheduledTripsPage() {
  const recordHref = useAdminHref();
  const [stage, setStage] = useState<"waiting" | "claim_open" | "assigned" | "in_progress" | "completed" | "all" | "driver_left">("waiting");
  const [vehicleType, setVehicleType] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [vehicleFilterOpen, setVehicleFilterOpen] = useState(false);
  const [list, setList] = useState<ScheduledTripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailsById, setDetailsById] = useState<Record<number, ScheduledTripDetailsResponse | undefined>>({});
  const [detailsLoadingId, setDetailsLoadingId] = useState<number | null>(null);
  const [awardBusyClaimId, setAwardBusyClaimId] = useState<number | null>(null);
  const [reassignBusyClaimId, setReassignBusyClaimId] = useState<number | null>(null);
  const [unassignBusyBookingId, setUnassignBusyBookingId] = useState<number | null>(null);
  const [driverDeletedBanner, setDriverDeletedBanner] = useState<{ driverName: string; tripCount: number } | null>(null);

  // Debounce search input → search (500 ms)
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 500);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const { socket } = useSocket();

  // Reason modal (unassign)
  const [reasonMounted, setReasonMounted] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonBookingId, setReasonBookingId] = useState<number | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [reasonSelectedPick, setReasonSelectedPick] = useState<string | null>(null);
  const reasonTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Award / reassign modal (replaces window.prompt)
  const [actionModalMounted, setActionModalMounted] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionModalKind, setActionModalKind] = useState<"award" | "reassign" | null>(null);
  const [actionModalBookingId, setActionModalBookingId] = useState<number | null>(null);
  const [actionModalClaimId, setActionModalClaimId] = useState<number | null>(null);
  const [actionModalText, setActionModalText] = useState("");
  const [actionModalError, setActionModalError] = useState<string | null>(null);
  const [actionModalPick, setActionModalPick] = useState<string | null>(null);
  const actionModalTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [sort, setSort] = useState<{ key: "trip" | "when" | "route" | "vehicle" | "claims" | "amount" | "status"; dir: "asc" | "desc" }>(
    { key: "when", dir: "asc" }
  );

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const toggleSort = useCallback(
    (key: "trip" | "when" | "route" | "vehicle" | "claims" | "amount" | "status") => {
      setSort((prev) => {
        if (prev.key === key) {
          return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
        }
        return { key, dir: "asc" };
      });
    },
    []
  );

  const SortIcon = useCallback(
    ({ columnKey }: { columnKey: "trip" | "when" | "route" | "vehicle" | "claims" | "amount" | "status" }) => {
      if (sort.key !== columnKey) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" aria-hidden />;
      return sort.dir === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5 text-gray-600" aria-hidden />
      ) : (
        <ArrowDown className="h-3.5 w-3.5 text-gray-600" aria-hidden />
      );
    },
    [sort.dir, sort.key]
  );

  const sortedList = useMemo(() => {
    const dirMul = sort.dir === "asc" ? 1 : -1;
    const safeStr = (v: unknown) => (v == null ? "" : String(v)).toLowerCase();
    const safeNum = (v: unknown) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const safeTime = (v: unknown) => {
      const t = new Date(String(v ?? "")).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    const cmp = (a: ScheduledTripRow, b: ScheduledTripRow) => {
      switch (sort.key) {
        case "trip": {
          const av = safeStr(a.tripCode || a.id);
          const bv = safeStr(b.tripCode || b.id);
          return av.localeCompare(bv) * dirMul;
        }
        case "when":
          return (safeTime(a.scheduledAt) - safeTime(b.scheduledAt)) * dirMul;
        case "route": {
          const av = safeStr(`${a.pickup} ${a.dropoff}`);
          const bv = safeStr(`${b.pickup} ${b.dropoff}`);
          return av.localeCompare(bv) * dirMul;
        }
        case "vehicle": {
          const av = safeStr(a.vehicleType);
          const bv = safeStr(b.vehicleType);
          return av.localeCompare(bv) * dirMul;
        }
        case "claims": {
          const av = safeNum(a.claimCount);
          const bv = safeNum(b.claimCount);
          if (av !== bv) return (av - bv) * dirMul;
          return (safeNum(a.claimLimit) - safeNum(b.claimLimit)) * dirMul;
        }
        case "amount":
          return (safeNum(a.amount) - safeNum(b.amount)) * dirMul;
        case "status": {
          const ORDER: ClaimStatusVariant[] = ["open", "waiting", "assigned", "expired", "unknown"];
          const ai = ORDER.indexOf(claimTimingLabel(a).variant);
          const bi = ORDER.indexOf(claimTimingLabel(b).variant);
          return (ai - bi) * dirMul;
        }
        default:
          return 0;
      }
    };

    return [...list].sort((a, b) => {
      const r = cmp(a, b);
      return r !== 0 ? r : a.id - b.id;
    });
  }, [list, sort.dir, sort.key]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize,
        stage,
        paymentStatus: "PAID",
      };
      if (vehicleType) params.vehicleType = vehicleType;
      if (search) params.q = search;

      const r = await api.get<{ items: ScheduledTripRow[]; total: number }>("/api/admin/drivers/trips/scheduled", { params });
      setList(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);

      // If expanded item no longer exists (e.g., assigned), close it.
      if (expandedId != null && !(r.data?.items ?? []).some((x) => x.id === expandedId)) {
        setExpandedId(null);
      }
    } catch (err) {
      console.error("Failed to load scheduled trips", err);
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [expandedId, page, pageSize, search, stage, vehicleType]);

  // Listen for real-time driver account deletions
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { driverName?: string; unassignedTripIds?: number[] }) => {
      const count = payload?.unassignedTripIds?.length ?? 0;
      if (count > 0) {
        setDriverDeletedBanner({ driverName: payload.driverName ?? 'A driver', tripCount: count });
        load();
      }
    };
    socket.on('driver:account:deleted', handler);
    return () => { socket.off('driver:account:deleted', handler); };
  }, [socket, load]);

  // Keep dependency list accurate after switching to stage.

  const loadDetails = useCallback(async (id: number) => {
    setDetailsLoadingId(id);
    try {
      const r = await api.get<ScheduledTripDetailsResponse>(`/api/admin/drivers/trips/scheduled/${id}`);
      setDetailsById((prev) => ({ ...prev, [id]: r.data }));
    } catch (err) {
      console.error("Failed to load scheduled trip details", err);
      setDetailsById((prev) => ({ ...prev, [id]: undefined }));
    } finally {
      setDetailsLoadingId(null);
    }
  }, []);

  const openActionModal = useCallback((kind: "award" | "reassign", bookingId: number, claimId: number) => {
    setActionModalKind(kind);
    setActionModalBookingId(bookingId);
    setActionModalClaimId(claimId);
    setActionModalText("");
    setActionModalError(null);
    setActionModalPick(null);
    setActionModalMounted(true);
    requestAnimationFrame(() => {
      setActionModalOpen(true);
      window.setTimeout(() => actionModalTextareaRef.current?.focus(), 0);
    });
  }, []);

  const closeActionModal = useCallback(() => {
    setActionModalOpen(false);
    window.setTimeout(() => {
      setActionModalMounted(false);
      setActionModalKind(null);
      setActionModalBookingId(null);
      setActionModalClaimId(null);
      setActionModalText("");
      setActionModalError(null);
      setActionModalPick(null);
    }, 200);
  }, []);

  const submitActionModal = useCallback(async () => {
    if (!actionModalBookingId || !actionModalClaimId || !actionModalKind) return;
    const reason = actionModalText.trim();
    if (!reason) {
      setActionModalError("Reason is required");
      return;
    }
    if (actionModalKind === "award") {
      setAwardBusyClaimId(actionModalClaimId);
    } else {
      setReassignBusyClaimId(actionModalClaimId);
    }
    try {
      const endpoint = actionModalKind === "award"
        ? `/api/admin/drivers/trips/scheduled/${actionModalBookingId}/award`
        : `/api/admin/drivers/trips/scheduled/${actionModalBookingId}/reassign`;
      await api.post(endpoint, { claimId: actionModalClaimId, reason });
      closeActionModal();
      await Promise.all([load(), loadDetails(actionModalBookingId)]);
    } catch (err: any) {
      const msg = err?.response?.data?.error || (actionModalKind === "award" ? "Failed to award claim" : "Failed to reassign");
      setActionModalError(msg);
    } finally {
      setAwardBusyClaimId(null);
      setReassignBusyClaimId(null);
    }
  }, [actionModalBookingId, actionModalClaimId, actionModalKind, actionModalText, closeActionModal, load, loadDetails]);

  const award = useCallback(
    (bookingId: number, claimId: number) => openActionModal("award", bookingId, claimId),
    [openActionModal]
  );

  const reassign = useCallback(
    (bookingId: number, claimId: number) => openActionModal("reassign", bookingId, claimId),
    [openActionModal]
  );

  const awardQuickPicks = useMemo(() => [
    "Best claim score",
    "VIP driver",
    "Requested by customer",
    "Strong on-time record",
    "Nearest available",
    "Other",
  ], []);

  const reassignQuickPicks = useMemo(() => [
    "Driver unavailable",
    "Better qualified driver",
    "Customer requested change",
    "Vehicle upgrade needed",
    "Driver location change",
    "Other",
  ], []);

  const unassignQuickPicks = useMemo(
    () => [
      "Driver unavailable",
      "Vehicle issue",
      "Customer requested change",
      "Wrong assignment",
      "Duplicate booking",
      "Other",
    ],
    []
  );

  const openUnassignModal = useCallback((bookingId: number) => {
    setReasonBookingId(bookingId);
    setReasonText("");
    setReasonError(null);
    setReasonSelectedPick(null);
    setReasonMounted(true);
    requestAnimationFrame(() => {
      setReasonOpen(true);
      window.setTimeout(() => reasonTextareaRef.current?.focus(), 0);
    });
  }, []);

  const closeUnassignModal = useCallback(() => {
    setReasonOpen(false);
    window.setTimeout(() => {
      setReasonMounted(false);
      setReasonBookingId(null);
      setReasonText("");
      setReasonError(null);
      setReasonSelectedPick(null);
    }, 200);
  }, []);

  const applyUnassignPick = useCallback((pick: string) => {
    setReasonSelectedPick(pick);
    if (pick === "Other") {
      setReasonText("");
    } else {
      setReasonText(pick);
    }
    if (reasonError) setReasonError(null);
    window.setTimeout(() => reasonTextareaRef.current?.focus(), 0);
  }, [reasonError]);

  const submitUnassign = useCallback(async () => {
    if (!reasonBookingId) return;
    const reason = reasonText.trim();
    if (!reason) {
      setReasonError("Reason is required");
      return;
    }

    setUnassignBusyBookingId(reasonBookingId);
    try {
      await api.post(`/api/admin/drivers/trips/scheduled/${reasonBookingId}/unassign`, { reason });
      closeUnassignModal();
      await Promise.all([load(), loadDetails(reasonBookingId)]);
    } catch (err: any) {
      console.error("Failed to unassign driver", err);
      setReasonError(err?.response?.data?.error || "Failed to unassign");
    } finally {
      setUnassignBusyBookingId(null);
    }
  }, [closeUnassignModal, load, loadDetails, reasonBookingId, reasonText]);

  useEffect(() => {
    authify();
    load();
  }, [load]);

  const stageBg = useMemo(() => {
    switch (stage) {
      case "waiting":
        return "bg-gradient-to-b from-amber-50 via-white to-white";
      case "claim_open":
        return "bg-gradient-to-b from-emerald-50 via-white to-white";
      case "assigned":
        return "bg-gradient-to-b from-sky-50 via-white to-white";
      case "in_progress":
        return "bg-gradient-to-b from-indigo-50 via-white to-white";
      case "completed":
        return "bg-gradient-to-b from-teal-50 via-white to-white";
      case "driver_left":
        return "bg-gradient-to-b from-orange-50 via-white to-white";
      case "all":
      default:
        return "bg-gradient-to-b from-gray-50 via-white to-white";
    }
  }, [stage]);

  const stagePanelBg = useMemo(() => {
    switch (stage) {
      case "waiting":
        return "bg-gradient-to-br from-amber-50/70 to-white";
      case "claim_open":
        return "bg-gradient-to-br from-emerald-50/70 to-white";
      case "assigned":
        return "bg-gradient-to-br from-sky-50/70 to-white";
      case "in_progress":
        return "bg-gradient-to-br from-indigo-50/70 to-white";
      case "completed":
        return "bg-gradient-to-br from-teal-50/70 to-white";
      case "driver_left":
        return "bg-gradient-to-br from-orange-50/70 to-white";
      case "all":
      default:
        return "bg-gradient-to-br from-gray-50/70 to-white";
    }
  }, [stage]);

  const vehicles = useMemo(() => ["", "BODA", "BAJAJI", "CAR", "XL", "PREMIUM"], []);
  const stages = useMemo(
    () => [
      { value: "waiting", label: "Waiting", Icon: Clock },
      { value: "claim_open", label: "Claim open", Icon: Timer },
      { value: "assigned", label: "Assigned", Icon: UserCheck },
      { value: "in_progress", label: "In progress", Icon: Calendar },
      { value: "completed", label: "Completed", Icon: CheckCircle2 },
      { value: "driver_left", label: "Driver left", Icon: UserMinus },
      { value: "all", label: "All", Icon: ListFilter },
    ],
    []
  );

  return (
    <div className={`min-h-screen ${stageBg}`}>
      <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Driver-deleted real-time alert banner */}
      {driverDeletedBanner && (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-orange-200 overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-orange-400 via-orange-500 to-orange-400" />
          <div className="flex items-start gap-4 px-5 py-4">
            <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-orange-100 bg-orange-50">
              <AlertTriangle className="h-5 w-5 text-orange-500" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                {driverDeletedBanner.driverName} deleted their account
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {driverDeletedBanner.tripCount} trip{driverDeletedBanner.tripCount !== 1 ? 's' : ''} returned to pool and need immediate reassignment.
                {' '}
                <button
                  onClick={() => { setStage('driver_left'); setDriverDeletedBanner(null); }}
                  className="font-semibold text-orange-600 hover:text-orange-800 underline transition-colors">
                  View now →
                </button>
              </p>
            </div>
            <button
              onClick={() => setDriverDeletedBanner(null)}
              aria-label="Dismiss"
              className="flex-shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-b from-white to-gray-50/40 p-6 shadow-sm ring-1 ring-gray-100">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center mb-4">
            <Calendar className="h-8 w-8 text-emerald-700" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Scheduled Trips</h1>
          <p className="text-sm text-gray-500 mt-1">Review claims and award a driver for paid scheduled transport bookings.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-gray-100 min-w-0">
        <div className="w-full max-w-5xl mx-auto min-w-0 space-y-3">
          {/* Stage filter (radio buttons styled like the other buttons) */}
          <fieldset className="w-full border-0 p-0 m-0 min-w-0">
            <legend className="sr-only">Stage</legend>
            <div className={`max-w-full rounded-2xl p-3 ring-1 ring-gray-200 ${stagePanelBg}`}>
              <div className="flex flex-wrap items-center justify-center gap-3 min-w-0 max-w-full">
                {stages.map((s) => {
                  const id = `stage-${s.value}`;
                  const active = stage === (s.value as any);
                  const Icon = (s as any).Icon as any;
                  return (
                    <label
                      key={s.value}
                      htmlFor={id}
                      className={
                        "relative cursor-pointer select-none inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm ring-1 focus-within:ring-2 focus-within:ring-emerald-200 focus-within:ring-offset-2 focus-within:ring-offset-gray-50 " +
                        (active
                          ? "bg-emerald-700 text-white ring-emerald-700"
                          : "bg-gray-50 text-gray-700 ring-gray-200 hover:bg-white")
                      }
                    >
                      <input
                        id={id}
                        type="radio"
                        name="scheduled-trip-stage"
                        value={s.value}
                        checked={stage === (s.value as any)}
                        onChange={() => {
                          setStage(s.value as any);
                          setPage(1);
                        }}
                        className="sr-only"
                      />
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <Icon className="h-4 w-4" aria-hidden />
                        <span>{s.label}</span>
                      </span>
                    </label>
                  );
                })}

                {/* Vehicle filter (chip-style, inside the stage row) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setVehicleFilterOpen((v) => !v)}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold shadow-sm ring-1 ring-gray-200 bg-gray-50 text-gray-700 hover:bg-white"
                    aria-haspopup="menu"
                    aria-expanded={vehicleFilterOpen}
                    title={vehicleType ? `Vehicle: ${vehicleType}` : "All vehicles"}
                  >
                    <ListFilter className="h-4 w-4" aria-hidden />
                    <span className="sm:hidden whitespace-nowrap">{vehicleType ? vehicleType : "All"}</span>
                    <span className="hidden sm:inline whitespace-nowrap">{vehicleType ? vehicleType : "All vehicles"}</span>
                  </button>

                  {vehicleFilterOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setVehicleFilterOpen(false)} />
                      <div
                        role="menu"
                        className="absolute z-50 mt-2 w-56 right-0 rounded-xl bg-white shadow-lg ring-1 ring-gray-200 overflow-hidden"
                      >
                        <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">
                          Vehicle type
                        </div>
                        <div className="p-1">
                          {vehicles.map((v) => {
                            const label = v ? v : "All vehicles";
                            const active = vehicleType === v;
                            return (
                              <button
                                key={v || "ALL"}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setVehicleType(v);
                                  setPage(1);
                                  setVehicleFilterOpen(false);
                                }}
                                className={
                                  "w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors " +
                                  (active ? "bg-emerald-50 text-emerald-800" : "text-gray-700 hover:bg-gray-50")
                                }
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </fieldset>

          {/* Search box */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by trip code, passenger, address…"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-9 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100 transition-colors"
              aria-label="Search trips"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="text-xs text-gray-500">Showing paid trips only (paymentStatus=PAID). Waiting trips are those whose claim window has not opened yet.</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("trip")}
                    className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 shadow-none appearance-none hover:text-gray-900 focus-visible:outline-none focus-visible:underline"
                    aria-label="Sort by trip"
                  >
                    Trip
                    <SortIcon columnKey="trip" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("when")}
                    className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 shadow-none appearance-none hover:text-gray-900 focus-visible:outline-none focus-visible:underline"
                    aria-label="Sort by time"
                  >
                    When
                    <SortIcon columnKey="when" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("route")}
                    className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 shadow-none appearance-none hover:text-gray-900 focus-visible:outline-none focus-visible:underline"
                    aria-label="Sort by route"
                  >
                    Route
                    <SortIcon columnKey="route" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("vehicle")}
                    className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 shadow-none appearance-none hover:text-gray-900 focus-visible:outline-none focus-visible:underline"
                    aria-label="Sort by vehicle"
                  >
                    Vehicle
                    <SortIcon columnKey="vehicle" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("claims")}
                    className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 shadow-none appearance-none hover:text-gray-900 focus-visible:outline-none focus-visible:underline"
                    aria-label="Sort by claims"
                  >
                    Claims
                    <SortIcon columnKey="claims" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort("status")}
                    className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 shadow-none appearance-none hover:text-gray-900 focus-visible:outline-none focus-visible:underline whitespace-nowrap"
                    aria-label="Sort by claim status"
                  >
                    Claim Status
                    <SortIcon columnKey="status" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("amount")}
                    className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 shadow-none appearance-none hover:text-gray-900 focus-visible:outline-none focus-visible:underline"
                    aria-label="Sort by amount"
                  >
                    Amount
                    <SortIcon columnKey="amount" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <TableRow hover={false}>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                    Loading...
                  </td>
                </TableRow>
              ) : list.length === 0 ? (
                <TableRow hover={false}>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-500">
                    No scheduled trips found.
                  </td>
                </TableRow>
              ) : (
                sortedList.map((row) => {
                  const expanded = expandedId === row.id;
                  const details = detailsById[row.id];
                  const detailsLoading = detailsLoadingId === row.id;

                  return (
                    <Fragment key={row.id}>
                      <TableRow className={expanded ? "bg-emerald-50/30" : ""}>
                        <td className="px-4 py-3">
                          <div className="text-sm font-semibold text-gray-900">{row.tripCode}</div>
                          <div className="text-xs text-gray-500 inline-flex flex-wrap items-center gap-x-1">
                            <span>#{row.id}</span>
                            <span aria-hidden>•</span>
                            {row.paymentStatus === "PAID" ? (
                              <span
                                className="inline-flex items-center gap-1"
                                title="Paid"
                                aria-label="Paid"
                              >
                                <BadgeDollarSign className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
                                <span className="sr-only">Paid</span>
                              </span>
                            ) : (
                              <span>{row.paymentStatus}</span>
                            )}
                            <span aria-hidden>•</span>
                            <span>{row.status}</span>
                          </div>
                          {row.notes?.includes('[DRIVER_DELETED]') && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700">
                              <UserMinus className="h-3 w-3" aria-hidden />
                              Driver left
                            </span>
                          )}
                          <div className="text-xs text-gray-500">
                            Passenger: {row.passenger?.name || row.passenger?.email || "N/A"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDateTime(row.scheduledAt)}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-700 truncate max-w-[340px]">
                            {compactPreviewText(row.pickup, 2)}
                          </div>
                          <div className="text-xs text-gray-500 truncate max-w-[340px]">
                            → {compactPreviewText(row.dropoff, 2)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{row.vehicleType || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-900 font-medium">{row.claimCount}/{row.claimLimit}</div>
                          <div className="text-xs text-gray-500">{row.claimsRemaining} remaining</div>
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const s = claimTimingLabel(row);
                            return (
                              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${CLAIM_STATUS_STYLES[s.variant]}`}>
                                {s.text}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{row.amount.toLocaleString()} {row.currency}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={async () => {
                              if (expanded) {
                                setExpandedId(null);
                                return;
                              }
                              setExpandedId(row.id);
                              if (!detailsById[row.id]) {
                                await loadDetails(row.id);
                              }
                            }}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-white text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
                            title={expanded ? "Hide details" : "View details"}
                            aria-label={expanded ? "Hide details" : "View details"}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </TableRow>

                      {expanded && (
                        <TableRow hover={false} key={`${row.id}-details`}>
                          <td colSpan={8} className="px-4 py-5 bg-gray-50/40">
                            {detailsLoading ? (
                              <div className="text-sm text-gray-500">Loading details...</div>
                            ) : !details ? (
                              <div className="text-sm text-gray-500">No details.</div>
                            ) : (
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
                                    <div className="text-xs text-gray-500">Pickup</div>
                                    <div className="text-sm text-gray-900 font-medium">{compactLocation(details.booking.pickup)}</div>
                                  </div>
                                  <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
                                    <div className="text-xs text-gray-500">Drop-off</div>
                                    <div className="text-sm text-gray-900 font-medium">{compactLocation(details.booking.dropoff)}</div>
                                    {details.booking.property?.title ? (
                                      <div className="text-xs text-gray-500 mt-1">
                                        Property: {details.booking.property.title}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
                                    <div className="text-xs text-gray-500">Assigned Driver</div>
                                    <div className="text-sm text-gray-900 font-medium">
                                      {details.booking.driver?.name || details.booking.driver?.email || "Not assigned"}
                                    </div>

                                    {details.booking.driver?.id ? (
                                      <div className="mt-3 grid grid-cols-2 gap-2">
                                        <button
                                          type="button"
                                          disabled={unassignBusyBookingId === details.booking.id}
                                          onClick={() => openUnassignModal(details.booking.id)}
                                          className="inline-flex items-center justify-center h-10 w-full rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                          aria-label="Unassign"
                                          title={unassignBusyBookingId === details.booking.id ? "Unassigning..." : "Unassign"}
                                        >
                                          <UserMinus className="h-5 w-5" aria-hidden />
                                        </button>

                                        <Link
                                          href={recordHref("driver", details.booking.driver.id)}
                                          className="inline-flex items-center justify-center h-10 w-full rounded-lg bg-white text-emerald-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50 hover:text-emerald-800"
                                          title="View driver assignment audit"
                                          aria-label="View driver assignment audit"
                                        >
                                          <Eye className="h-5 w-5" aria-hidden />
                                        </Link>
                                      </div>
                                    ) : null}
                                    {details.assignmentAudit && details.booking.driver ? (
                                      <div className="mt-2 space-y-1 text-xs text-gray-500">
                                        <div>Assigned: {formatDateTime(details.assignmentAudit.assignedAt)}</div>
                                        <div>
                                          By: {details.assignmentAudit.assignedBy?.name || details.assignmentAudit.assignedBy?.email || "Unknown"}
                                        </div>
                                        <div className="line-clamp-3">Reason: {details.assignmentAudit.reason || "—"}</div>
                                      </div>
                                    ) : null}

                                    {/** action buttons now shown in two columns above **/}
                                  </div>
                                </div>

                                <details className="rounded-xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
                                  <summary className="cursor-pointer select-none px-4 py-3 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-900">
                                    View full assignment audit
                                  </summary>
                                  <div className="p-4">
                                    {(details.assignmentAudits?.length ?? 0) === 0 ? (
                                      <div className="text-sm text-gray-500">No assignment audit entries yet.</div>
                                    ) : (
                                      <div className="space-y-2">
                                        {details.assignmentAudits.map((a, idx) => (
                                          <div key={`${a.assignedAt}-${idx}`} className="rounded-lg border border-gray-200 bg-white p-3">
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                                              <div className="text-sm font-semibold text-gray-900">
                                                {String(a.kind ?? "ASSIGN").toUpperCase() === "UNASSIGN"
                                                  ? "Unassigned"
                                                  : a.driverId
                                                    ? `Assigned driver #${a.driverId}`
                                                    : "Assigned"}
                                              </div>
                                              <div className="text-xs text-gray-500">{formatDateTime(a.assignedAt)}</div>
                                            </div>
                                            <div className="text-xs text-gray-500 mt-1">
                                              By: {a.assignedBy?.name || a.assignedBy?.email || "Unknown"}
                                              {a.claimId ? ` • Claim #${a.claimId}` : ""}
                                            </div>
                                            <div className="text-xs text-gray-700 mt-1">Reason: {a.reason || "—"}</div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </details>

                                <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
                                  <div className="px-4 py-3 bg-gray-50 flex items-center justify-between border-b border-gray-100">
                                    <div className="text-sm font-semibold text-gray-900">Claims</div>
                                    <div className="text-xs text-gray-500">Select one claim to award the booking.</div>
                                  </div>
                                  {details.claims.length === 0 ? (
                                    <div className="px-4 py-6 text-sm text-gray-500">No claims yet.</div>
                                  ) : (
                                    <div className="divide-y divide-gray-100">
                                      {details.claims.map((c) => {
                                        const canAward =
                                          details.booking.driver == null &&
                                          c.status === "PENDING" &&
                                          (awardBusyClaimId == null || awardBusyClaimId === c.id);

                                        const bookingStatus = String(details.booking.status ?? "").toUpperCase();
                                        const canReassign =
                                          details.booking.driver != null &&
                                          c.driver?.id != null &&
                                          c.driver.id !== details.booking.driver.id &&
                                          !["IN_PROGRESS", "COMPLETED", "CANCELED", "CANCELLED"].includes(bookingStatus) &&
                                          (reassignBusyClaimId == null || reassignBusyClaimId === c.id);

                                        return (
                                          <div key={c.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                            <div>
                                              <div className="flex items-center gap-2">
                                                <div className="text-sm font-medium text-gray-900">
                                                  {c.driver?.name || c.driver?.email || `Driver #${c.driver?.id}`}
                                                </div>
                                                {c.recommendation?.recommended ? (
                                                  <span
                                                    className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800"
                                                    title={
                                                      (c.recommendation?.reasons ?? []).length
                                                        ? `Recommended: ${(c.recommendation?.reasons ?? []).join(" • ")}`
                                                        : "Recommended"
                                                    }
                                                  >
                                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
                                                    Recommended
                                                  </span>
                                                ) : null}
                                                {c.driver?.isVipDriver ? (
                                                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">
                                                    <Trophy className="h-3 w-3" /> VIP
                                                  </span>
                                                ) : null}
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{c.status}</span>
                                              </div>
                                              <div className="text-xs text-gray-500">
                                                {c.driver?.phone ? `Phone: ${c.driver.phone}` : ""}{c.driver?.phone && c.driver?.email ? " • " : ""}{c.driver?.email ? `Email: ${c.driver.email}` : ""}
                                              </div>
                                              <div className="text-xs text-gray-500">Submitted: {formatDateTime(c.createdAt)}</div>
                                              {c.reviewedAt ? (
                                                <div className="text-xs text-gray-500 flex items-center gap-1">
                                                  <ShieldCheck className="h-3 w-3" /> Reviewed: {formatDateTime(c.reviewedAt)}
                                                </div>
                                              ) : null}
                                            </div>

                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                disabled={!canAward || awardBusyClaimId === c.id}
                                                onClick={() => award(details.booking.id, c.id)}
                                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                                                  details.booking.driver != null
                                                    ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"
                                                    : c.status !== "PENDING"
                                                    ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"
                                                    : "border-emerald-700 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                                                }`}
                                              >
                                                {awardBusyClaimId === c.id ? "Awarding..." : "Award"}
                                              </button>

                                              <button
                                                type="button"
                                                disabled={!canReassign || reassignBusyClaimId === c.id}
                                                onClick={() => reassign(details.booking.id, c.id)}
                                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                                                  details.booking.driver == null
                                                    ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"
                                                    : !canReassign
                                                    ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"
                                                    : "border-amber-700 text-amber-800 bg-amber-50 hover:bg-amber-100"
                                                }`}
                                              >
                                                {reassignBusyClaimId === c.id ? "Reassigning..." : "Reassign"}
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
          <div className="text-xs text-gray-500">
            Page {page} of {pages} • {total.toLocaleString()} total
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg bg-white text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="px-3 py-1.5 rounded-lg bg-white text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      </div>

      {/* Award / Reassign Modal (replaces window.prompt) */}
      {actionModalMounted && (
        <div className={`fixed inset-0 z-50 ${actionModalOpen ? "" : "pointer-events-none"}`}>
          <div
            className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${actionModalOpen ? "opacity-100" : "opacity-0"}`}
            onClick={closeActionModal}
          />
          <div className="relative h-full w-full flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
            <div
              className={`relative w-full max-w-lg my-3 sm:my-0 max-h-[92vh] overflow-hidden rounded-2xl sm:rounded-3xl border border-white/30 shadow-2xl flex flex-col bg-gradient-to-b from-surface via-white to-emerald-50 transition-all duration-200 ease-out ${
                actionModalOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.98] translate-y-2"
              }`}
              role="dialog"
              aria-modal="true"
              aria-label={actionModalKind === "award" ? "Award driver" : "Reassign driver"}
            >
              <div className="relative overflow-hidden border-b border-white/40">
                <div className={`absolute inset-0 ${actionModalKind === "award" ? "bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-500" : "bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-500"}`} />
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_20%,white,transparent_40%),radial-gradient(circle_at_80%_10%,white,transparent_35%)]" />
                <div className="relative px-4 pt-5 pb-6 sm:px-6 sm:pt-6 sm:pb-6 flex items-start justify-between gap-3 text-white">
                  <div className="min-w-0 flex-1">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <div className="min-w-0 text-base sm:text-lg font-semibold leading-snug truncate">
                        {actionModalKind === "award" ? "Award Driver" : "Reassign Driver"}
                      </div>
                      {actionModalBookingId ? (
                        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-white/15 border border-white/25 backdrop-blur text-xs text-white">
                          <span className="text-white/90">Trip</span>
                          <span className="select-text">{`#${actionModalBookingId}`}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 text-xs text-white/85">Select a quick reason or type your own (required).</div>
                  </div>
                  <button
                    type="button"
                    onClick={closeActionModal}
                    className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-xl bg-white/15 border border-white/25 text-white hover:bg-white/20 transition"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-6 flex-1 overflow-y-auto">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <label className="block text-xs font-medium text-gray-600">Reason</label>
                      <button
                        type="button"
                        onClick={() => { setActionModalText(""); setActionModalPick(null); if (actionModalError) setActionModalError(null); window.setTimeout(() => actionModalTextareaRef.current?.focus(), 0); }}
                        className="text-xs font-medium text-gray-600 hover:text-gray-900"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="mb-3">
                      <div className="text-[11px] font-medium tracking-wide uppercase text-gray-500 mb-2">Quick pick</div>
                      <div className="flex flex-wrap gap-2">
                        {(actionModalKind === "award" ? awardQuickPicks : reassignQuickPicks).map((pick) => (
                          <button
                            key={pick}
                            type="button"
                            onClick={() => {
                              setActionModalPick(pick);
                              setActionModalText(pick === "Other" ? "" : pick);
                              if (actionModalError) setActionModalError(null);
                              window.setTimeout(() => actionModalTextareaRef.current?.focus(), 0);
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                              actionModalPick === pick
                                ? actionModalKind === "award"
                                  ? "border-emerald-700 bg-emerald-700 text-white"
                                  : "border-blue-700 bg-blue-700 text-white"
                                : "border-gray-200 bg-white/80 text-gray-700 hover:bg-white hover:border-gray-300"
                            }`}
                          >
                            {pick}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      ref={actionModalTextareaRef}
                      value={actionModalText}
                      onChange={(e) => {
                        setActionModalText(e.target.value);
                        if (actionModalPick) setActionModalPick(null);
                        if (actionModalError) setActionModalError(null);
                      }}
                      placeholder={actionModalKind === "award" ? "Why are you awarding this driver?" : "Why are you reassigning this trip?"}
                      rows={4}
                      className={`block w-full box-border px-3 py-2 rounded-xl border bg-white/80 outline-none text-sm leading-relaxed text-gray-900 shadow-inner resize-none focus:ring-2 ${
                        actionModalKind === "award" ? "focus:ring-emerald-600 focus:border-emerald-600" : "focus:ring-blue-600 focus:border-blue-600"
                      } ${actionModalError ? "border-red-300" : "border-gray-300"}`}
                    />
                    {actionModalError ? <div className="mt-2 text-xs text-red-600">{actionModalError}</div> : null}
                  </div>
                </div>
              </div>

              <div className="px-4 py-4 sm:px-6 sm:py-5 border-t border-gray-200/60 bg-white/60 backdrop-blur flex items-center justify-end">
                <button
                  type="button"
                  onClick={submitActionModal}
                  disabled={!actionModalText.trim()}
                  className={`inline-flex items-center gap-2 px-5 h-11 rounded-2xl text-white text-sm font-semibold transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                    actionModalKind === "award"
                      ? "bg-emerald-700 hover:bg-emerald-800 border border-emerald-700"
                      : "bg-blue-700 hover:bg-blue-800 border border-blue-700"
                  }`}
                >
                  {(actionModalKind === "award" ? awardBusyClaimId === actionModalClaimId : reassignBusyClaimId === actionModalClaimId)
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <UserCheck className="h-4 w-4" />}
                  {actionModalKind === "award" ? "Award Driver" : "Reassign Driver"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unassign Reason Modal (avoid browser prompt "localhost says") */}
      {reasonMounted && (
        <div className={`fixed inset-0 z-50 ${reasonOpen ? "" : "pointer-events-none"}`}>
          <div
            className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${reasonOpen ? "opacity-100" : "opacity-0"}`}
            onClick={closeUnassignModal}
          />
          <div className="relative h-full w-full flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
            <div
              className={`relative w-full max-w-lg my-3 sm:my-0 max-h-[92vh] overflow-hidden rounded-2xl sm:rounded-3xl border border-white/30 shadow-2xl flex flex-col bg-gradient-to-b from-surface via-white to-red-50 transition-all duration-200 ease-out ${
                reasonOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.98] translate-y-2"
              }`}
              role="dialog"
              aria-modal="true"
              aria-label="Unassign driver"
            >
              <div className="relative overflow-hidden border-b border-white/40">
                <div className="absolute inset-0 bg-gradient-to-r from-red-700 via-red-600 to-rose-500" />
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_20%,white,transparent_40%),radial-gradient(circle_at_80%_10%,white,transparent_35%),radial-gradient(circle_at_40%_90%,white,transparent_35%)]" />
                <div className="relative px-4 pt-5 pb-6 sm:px-6 sm:pt-6 sm:pb-6 flex items-start justify-between gap-3 text-white">
                  <div className="min-w-0 flex-1">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <div className="min-w-0 text-base sm:text-lg font-semibold leading-snug truncate">Unassign Driver</div>
                      {reasonBookingId ? (
                        <div className="inline-flex max-w-[60vw] sm:max-w-none items-center gap-2 px-2 py-1 rounded-full bg-white/15 border border-white/25 backdrop-blur text-xs text-white">
                          <span className="text-white/90">Trip</span>
                          <span className="select-text break-all" title={`#${reasonBookingId}`}>{`#${reasonBookingId}`}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 text-xs text-white/85">Provide a clear reason (required).</div>
                  </div>
                  <button
                    type="button"
                    onClick={closeUnassignModal}
                    className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-xl bg-white/15 border border-white/25 text-white hover:bg-white/20 transition"
                    aria-label="Close"
                    title="Close"
                  >
                    <X className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-6 flex-1 overflow-y-auto">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <label className="block text-xs font-medium text-gray-600">Reason</label>
                      <button
                        type="button"
                        onClick={() => {
                          setReasonText("");
                          setReasonSelectedPick(null);
                          if (reasonError) setReasonError(null);
                          window.setTimeout(() => reasonTextareaRef.current?.focus(), 0);
                        }}
                        className="text-xs font-medium text-gray-600 hover:text-gray-900"
                        disabled={unassignBusyBookingId === reasonBookingId}
                      >
                        Clear
                      </button>
                    </div>

                    <div className="mb-3">
                      <div className="text-[11px] font-medium tracking-wide uppercase text-gray-500 mb-2">Quick pick</div>
                      <div className="flex flex-wrap gap-2">
                        {unassignQuickPicks.map((pick) => (
                          <button
                            key={pick}
                            type="button"
                            onClick={() => applyUnassignPick(pick)}
                            disabled={unassignBusyBookingId === reasonBookingId}
                            title={pick}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition disabled:opacity-50 ${
                              reasonSelectedPick === pick
                                ? "border-red-700 bg-red-700 text-white"
                                : "border-gray-200 bg-white/80 text-gray-700 hover:bg-white hover:border-gray-300"
                            }`}
                          >
                            {pick}
                          </button>
                        ))}
                      </div>
                    </div>

                    <textarea
                      ref={reasonTextareaRef}
                      value={reasonText}
                      onChange={(e) => {
                        setReasonText(e.target.value);
                        if (reasonSelectedPick) setReasonSelectedPick(null);
                        if (reasonError) setReasonError(null);
                      }}
                      placeholder="Why are you unassigning this driver?"
                      rows={4}
                      className={`block w-full max-w-full box-border px-3 py-2 rounded-xl border bg-white/80 outline-none text-sm leading-relaxed text-gray-900 shadow-inner resize-none focus:ring-2 focus:ring-red-600 focus:border-red-600 ${
                        reasonError ? "border-red-300" : "border-gray-300"
                      }`}
                    />
                    {reasonError ? <div className="mt-2 text-xs text-red-600">{reasonError}</div> : null}
                  </div>
                </div>
              </div>

              <div className="px-4 py-4 sm:px-6 sm:py-5 border-t border-gray-200/60 bg-white/60 backdrop-blur flex items-center justify-end">
                {(() => {
                  const busy = unassignBusyBookingId === reasonBookingId;
                  const ready = Boolean(reasonText.trim()) && Boolean(reasonBookingId) && !busy;
                  const tooltip = !reasonBookingId
                    ? "No trip selected"
                    : !reasonText.trim()
                      ? "Enter a reason"
                      : busy
                        ? "Unassigning..."
                        : "Unassign";
                  return (
                    <button
                      type="button"
                      onClick={submitUnassign}
                      disabled={!ready}
                      aria-label="Unassign driver"
                      title={tooltip}
                      className="inline-flex items-center justify-center h-11 w-11 rounded-2xl text-white transition shadow-sm bg-red-700 hover:bg-red-800 border border-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserMinus className="h-5 w-5" />}
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
