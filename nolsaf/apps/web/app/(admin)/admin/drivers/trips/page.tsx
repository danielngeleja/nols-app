"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Calendar,
  Search,
  X,
  Truck,
  MapPin,
  Clock,
  BarChart3,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  UserCheck,
  Navigation,
  CheckCircle2,
  Route,
  Flag,
  HelpCircle,
  UserPlus,
  UserMinus,
  Ban,
  RotateCw,
  Loader2,
  Eye,
  FileText,
  Printer,
  Download,
} from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import Chart from "@/components/Chart";
import type { ChartData } from "chart.js";
import TableRow from "@/components/TableRow";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;
function authify() {}

type TripRow = {
  id: number;
  tripCode: string;
  driver: { id: number; name: string; email: string; phone: string | null } | null;
  pickup: string;
  dropoff: string;
  scheduledAt: string;
  amount: number;
  vehicleType?: string | null;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  invoiceId?: number | null;
  status: string;
  createdAt: string;
};

type DriverOption = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
};

type TripDetailsResponse = {
  trip: {
    id: number;
    tripCode: string;
    status: string;
    scheduledAt: string;
    pickupTime: string | null;
    dropoffTime: string | null;
    pickup: string;
    dropoff: string;
    vehicleType: string | null;
    amount: number;
    currency: string;
    paymentStatus: string | null;
    paymentMethod: string | null;
    paymentRef: string | null;
    notes: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    user: { id: number; name: string; email: string; phone: string | null } | null;
    driver: { id: number; name: string; email: string; phone: string | null } | null;
    payout:
      | {
          id: number;
          status: "PENDING" | "APPROVED" | "PAID" | string;
          currency: string;
          grossAmount: number | null;
          commissionPercent: number | null;
          commissionAmount: number | null;
          netPaid: number | null;
          approvedAt: string | null;
          paidAt: string | null;
          paymentMethod: string | null;
          paymentRef: string | null;
          createdAt: string | null;
          updatedAt: string | null;
        }
      | null;
  };
  assignmentAudits: Array<{
    id: number;
    action: string;
    actorId: number | null;
    createdAt: string | null;
    reason: string | null;
  }>;
};

type CommissionAckPayload = {
  error: "commission_ack_required";
  message?: string;
  currency: string;
  grossAmount: number;
  commissionPercent: number;
  commissionAmount: number;
  netPaid: number;
};

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pillClasses(kind: "neutral" | "blue" | "green" | "amber") {
  switch (kind) {
    case "blue":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "green":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "amber":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-gray-50 text-gray-700 border-gray-200";
  }
}

function titleCaseIfAllCaps(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  // Only title-case strings that are mostly uppercase (common for location segments)
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters && letters === letters.toUpperCase()) {
    return s
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return s;
}

function abbreviateLocation(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  const cleaned = raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned
    .split(/\s*-\s*|\s*,\s*/g)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const first = titleCaseIfAllCaps(parts[0]);
    const last = parts[parts.length - 1];
    const lastOut = last && last === last.toUpperCase() ? last : titleCaseIfAllCaps(last);
    if (!lastOut || first.toLowerCase() === lastOut.toLowerCase()) return first;
    return `${first}....${lastOut}`;
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return titleCaseIfAllCaps(cleaned);

  const lower = words.map((w) => w.toLowerCase());
  const airportIdx = lower.lastIndexOf("airport");
  if (airportIdx > 0) {
    let idx = airportIdx - 1;
    const ignore = new Set(["international", "intl"]);
    while (idx > 0 && ignore.has(lower[idx])) idx -= 1;
    const head = titleCaseIfAllCaps(`${words[0]} ${words[idx]}`);
    return `${head}....${words[airportIdx]}`;
  }

  const head = titleCaseIfAllCaps(words.slice(0, 2).join(" "));
  const tail = words[words.length - 1];
  return `${head}....${tail}`;
}

function formatRequestedDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const AUTO_DISPATCH_WARN_MS = 5 * 60 * 1000;
const AUTO_DISPATCH_TAKEOVER_MS = 10 * 60 * 1000;
const AUTO_DISPATCH_LOOKAHEAD_MS = 20 * 60 * 1000;

type DriverStepState = "upcoming" | "current" | "completed";
type DriverProgress =
  | { kind: "progress"; current: number }
  | { kind: "canceled" }
  | { kind: "completed" }
  | { kind: "unknown"; label: string };

function toDriverProgress(statusRaw: string, hasDriver: boolean): DriverProgress {
  const status = String(statusRaw ?? "").toUpperCase().trim();
  if (!hasDriver && status === "PENDING") return { kind: "progress", current: -1 };
  if (status === "CANCELED" || status === "CANCELLED") return { kind: "canceled" };
  if (status === "COMPLETED") return { kind: "completed" };

  // Prefer driver-step style statuses where available.
  if (status === "ASSIGNED") return { kind: "progress", current: 0 };
  if (status === "ACCEPTED" || status === "CONFIRMED") return { kind: "progress", current: 1 };
  if (status === "ARRIVED_PICKUP") return { kind: "progress", current: 2 };
  if (status === "PICKED_UP") return { kind: "progress", current: 3 };
  if (status === "IN_TRANSIT" || status === "IN_PROGRESS") return { kind: "progress", current: 3 };
  if (status === "ARRIVED_DESTINATION" || status === "DROPPED_OFF" || status === "DROPOFF") return { kind: "progress", current: 4 };

  if (status === "PENDING") return { kind: "progress", current: hasDriver ? 0 : -1 };
  return { kind: "unknown", label: status || "UNKNOWN" };
}

function StatusStepIcons({ status, hasDriver }: { status: string; hasDriver: boolean }) {
  const steps = [
    { label: "Assigned", Icon: UserCheck },
    { label: "On the way to pickup", Icon: Navigation },
    { label: "Pickup confirmed", Icon: CheckCircle2 },
    { label: "En route to destination", Icon: Route },
    { label: "Drop off", Icon: Flag },
  ] as const;

  const progress = toDriverProgress(status, hasDriver);

  if (progress.kind === "canceled") {
    return (
      <div className="inline-flex items-center" title="Cancelled">
        <Ban className="h-4 w-4 text-red-600" />
      </div>
    );
  }

  if (progress.kind === "completed") {
    return (
      <div className="inline-flex items-center" title="Completed">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      </div>
    );
  }

  if (progress.kind === "unknown") {
    return (
      <div className="inline-flex items-center" title={progress.label}>
        <HelpCircle className="h-4 w-4 text-gray-500" />
      </div>
    );
  }

  const current = progress.current;
  return (
    <div className="inline-flex items-center gap-1.5" aria-label="Trip progress">
      {!hasDriver ? (
        <span title="Unassigned" className="inline-flex items-center">
          <HelpCircle className="h-4 w-4 text-gray-400" />
        </span>
      ) : null}
      {steps.map((s, idx) => {
        let state: DriverStepState = "upcoming";
        if (current >= 0 && idx < current) state = "completed";
        else if (idx === current) state = "current";

        const cls =
          state === "completed"
            ? "text-emerald-600"
            : state === "current"
              ? "text-blue-700"
              : "text-gray-300";

        const Icon = s.Icon;
        return (
          <span key={s.label} title={s.label} className="inline-flex items-center">
            <Icon className={`h-4 w-4 ${cls}`} />
          </span>
        );
      })}
    </div>
  );
}

type TripStats = {
  date: string;
  count: number;
  completed: number;
  amount: number;
};

type TripStatsResponse = {
  stats: TripStats[];
  period: string;
  startDate: string;
  endDate: string;
};

export default function AdminDriversTripsPage() {
  const [status, setStatus] = useState<string>("");
  const [assignment, setAssignment] = useState<"all" | "assigned" | "unassigned">("all");
  const [date, setDate] = useState<string | string[]>("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [kpiCounts, setKpiCounts] = useState<{ total: number; inProgress: number; completed: number; pending: number } | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  type SortKey = "tripCode" | "driver" | "pickup" | "dropoff" | "vehicleType" | "createdAt" | "amount" | "status";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const pageSize = 30;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pickerAnim, setPickerAnim] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const nowMs = Date.now();

  const getEscalation = useCallback(
    (trip: TripRow) => {
      const status = String(trip?.status ?? "").toUpperCase().trim();
      const isTakeover = status === "PENDING_ADMIN_ASSIGNMENT";
      const hasDriver = Boolean(trip?.driver);

      const createdMs = trip?.createdAt ? new Date(trip.createdAt).getTime() : NaN;
      const scheduledMs = trip?.scheduledAt ? new Date(trip.scheduledAt).getTime() : NaN;
      const ageMs = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : null;
      const withinLookahead =
        Number.isFinite(scheduledMs) && scheduledMs <= nowMs + AUTO_DISPATCH_LOOKAHEAD_MS;
      const paid = String(trip?.paymentStatus ?? "").toUpperCase().trim() === "PAID";

      const warnWindow =
        !isTakeover &&
        !hasDriver &&
        paid &&
        withinLookahead &&
        typeof ageMs === "number" &&
        ageMs >= AUTO_DISPATCH_WARN_MS &&
        ageMs < AUTO_DISPATCH_TAKEOVER_MS;

      const overdue =
        !isTakeover &&
        !hasDriver &&
        paid &&
        withinLookahead &&
        typeof ageMs === "number" &&
        ageMs >= AUTO_DISPATCH_TAKEOVER_MS;

      return { isTakeover, warnWindow, overdue };
    },
    [nowMs]
  );
  
  // Histogram state
  const [histogramPeriod, setHistogramPeriod] = useState<string>("30d");
  const [histogramData, setHistogramData] = useState<TripStatsResponse | null>(null);
  const [histogramLoading, setHistogramLoading] = useState(false);

  // Assign modal
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTrip, setAssignTrip] = useState<TripRow | null>(null);
  const [driverQuery, setDriverQuery] = useState("");
  const [driverResults, setDriverResults] = useState<DriverOption[]>([]);
  const [driverLoading, setDriverLoading] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<DriverOption | null>(null);
  const [assignReason, setAssignReason] = useState("");
  const [assignMounted, setAssignMounted] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSelectedPick, setAssignSelectedPick] = useState<string | null>(null);
  const assignReasonRef = useRef<HTMLTextAreaElement | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Trip Details drawer
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsMounted, setDetailsMounted] = useState(false);
  const [detailsTripId, setDetailsTripId] = useState<number | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsData, setDetailsData] = useState<TripDetailsResponse | null>(null);

  // Driver payout receipt modal
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<TripDetailsResponse | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  // Payout acknowledgement modal
  const [commissionMounted, setCommissionMounted] = useState(false);
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [commissionPayload, setCommissionPayload] = useState<CommissionAckPayload | null>(null);
  const [commissionAck, setCommissionAck] = useState(false);
  const [commissionBusy, setCommissionBusy] = useState(false);
  const [commissionError, setCommissionError] = useState<string | null>(null);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [payoutBusy, setPayoutBusy] = useState(false);

  // Reason modal (unassign/cancel)
  const [reasonMounted, setReasonMounted] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonKind, setReasonKind] = useState<"unassign" | "cancel">("unassign");
  const [reasonTrip, setReasonTrip] = useState<TripRow | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [reasonSelectedPick, setReasonSelectedPick] = useState<string | null>(null);
  const reasonTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const reasonQuickPicks = useMemo(() => {
    return reasonKind === "cancel"
      ? [
          "Customer canceled",
          "No drivers available",
          "Incorrect booking details",
          "Payment issue",
          "Duplicate booking",
          "Safety concern",
          "Other",
        ]
      : [
          "Driver unavailable",
          "Vehicle issue",
          "Customer requested change",
          "Wrong assignment",
          "Duplicate booking",
          "Other",
        ];
  }, [reasonKind]);

  const applyReasonPick = (pick: string) => {
    setReasonSelectedPick(pick);
    if (pick === "Other") {
      setReasonText("");
    } else {
      setReasonText(reasonKind === "cancel" ? `${pick} - ` : pick);
    }
    if (reasonError) setReasonError(null);
    window.setTimeout(() => reasonTextareaRef.current?.focus(), 0);
  };

  useEffect(() => {
    (async () => {
      try {
        const [rTotal, rInProgress, rCompleted, rPending] = await Promise.allSettled([
          api.get<{ total: number }>("/api/admin/drivers/trips", { params: { page: 1, pageSize: 1 } }),
          api.get<{ total: number }>("/api/admin/drivers/trips", { params: { page: 1, pageSize: 1, status: "IN_PROGRESS" } }),
          api.get<{ total: number }>("/api/admin/drivers/trips", { params: { page: 1, pageSize: 1, status: "COMPLETED" } }),
          api.get<{ total: number }>("/api/admin/drivers/trips", { params: { page: 1, pageSize: 1, status: "PENDING_ASSIGNMENT" } }),
        ]);
        setKpiCounts({
          total: rTotal.status === "fulfilled" ? (rTotal.value.data?.total ?? 0) : 0,
          inProgress: rInProgress.status === "fulfilled" ? (rInProgress.value.data?.total ?? 0) : 0,
          completed: rCompleted.status === "fulfilled" ? (rCompleted.value.data?.total ?? 0) : 0,
          pending: rPending.status === "fulfilled" ? (rPending.value.data?.total ?? 0) : 0,
        });
      } catch {
        // best-effort
      } finally {
        setKpisLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize,
      };
      if (status) params.status = status;
      if (assignment) params.assignment = assignment;
      if (date) {
        if (Array.isArray(date)) {
          params.start = date[0];
          params.end = date[1];
        } else {
          params.date = date;
        }
      }
      if (q) params.q = q;

      const r = await api.get<{ items: TripRow[]; total: number }>("/api/admin/drivers/trips", { params });
      setList(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);
    } catch (err) {
      console.error("Failed to load trips", err);
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [assignment, date, page, pageSize, q, status]);

  const loadHistogram = useCallback(async () => {
    setHistogramLoading(true);
    try {
      const r = await api.get<TripStatsResponse>("/api/admin/drivers/trips/stats", {
        params: { period: histogramPeriod },
      });
      setHistogramData(r.data);
    } catch (err) {
      console.error("Failed to load trip statistics", err);
      setHistogramData(null);
    } finally {
      setHistogramLoading(false);
    }
  }, [histogramPeriod]);

  useEffect(() => {
    authify();
    load();
  }, [load]);

  useEffect(() => {
    authify();
    loadHistogram();
  }, [loadHistogram]);

  const fetchDrivers = useCallback(async (term: string) => {
    setDriverLoading(true);
    try {
      const url = assignTrip?.id
        ? `/api/admin/drivers/trips/${assignTrip.id}/eligible-drivers`
        : "/api/admin/drivers";
      const r = await api.get<{ items: any[] }>(url, {
        params: { q: term, page: 1, pageSize: 10 },
      });
      const items = Array.isArray(r.data?.items) ? r.data.items : [];
      const mapped: DriverOption[] = items
        .map((d: any) => ({
          id: Number(d.id),
          name: String(d.name || ""),
          email: String(d.email || ""),
          phone: d.phone ?? null,
        }))
        .filter((d: DriverOption) => Number.isFinite(d.id) && d.id > 0);
      setDriverResults(mapped);
    } catch (err) {
      console.error("Failed to load drivers", err);
      setDriverResults([]);
    } finally {
      setDriverLoading(false);
    }
  }, [assignTrip?.id]);

  useEffect(() => {
    if (!assignOpen) return;
    const t = setTimeout(() => {
      void fetchDrivers(driverQuery.trim());
    }, 250);
    return () => clearTimeout(t);
  }, [assignOpen, driverQuery, fetchDrivers]);

  const assignQuickPicks = useMemo(
    () => [
      "Closest driver",
      "Driver already nearby",
      "Customer requested this driver",
      "Replacement driver",
      "Best availability",
      "Other",
    ],
    []
  );

  const applyAssignPick = (pick: string) => {
    setAssignSelectedPick(pick);
    setAssignReason(pick === "Other" ? "" : pick);
    if (assignError) setAssignError(null);
    window.setTimeout(() => assignReasonRef.current?.focus(), 0);
  };

  const openAssign = (trip: TripRow) => {
    setAssignTrip(trip);
    setAssignMounted(true);
    requestAnimationFrame(() => {
      setAssignOpen(true);
      window.setTimeout(() => assignReasonRef.current?.focus(), 0);
    });
    setDriverQuery("");
    setDriverResults([]);
    setSelectedDriver(null);
    setAssignReason("");
    setAssignSelectedPick(null);
    setAssignError(null);
  };

  const closeAssign = () => {
    setAssignOpen(false);
    window.setTimeout(() => {
      setAssignMounted(false);
      setAssignTrip(null);
      setDriverQuery("");
      setDriverResults([]);
      setSelectedDriver(null);
      setAssignReason("");
      setAssignSelectedPick(null);
      setAssignError(null);
    }, 200);
  };

  const submitAssign = async () => {
    if (!assignTrip) return;
    if (!selectedDriver) {
      setAssignError("Select a driver");
      return;
    }
    const reason = assignReason.trim();
    if (!reason) {
      setAssignError("Reason is required");
      return;
    }
    setActionBusy(true);
    try {
      await api.post(`/api/admin/drivers/trips/${assignTrip.id}/assign`, {
        driverId: selectedDriver.id,
        reason,
      });
      closeAssign();
      await load();
      if (detailsMounted && detailsTripId === assignTrip.id) {
        await refreshDetails();
      }
    } catch (err: any) {
      console.error("Assign failed", err);
      setAssignError(err?.response?.data?.error || "Failed to assign");
    } finally {
      setActionBusy(false);
    }
  };

  const openDetails = async (trip: TripRow) => {
    setDetailsTripId(trip.id);
    setDetailsMounted(true);
    requestAnimationFrame(() => setDetailsOpen(true));
  };

  const closeDetails = () => {
    setDetailsOpen(false);
    setCommissionOpen(false);
    window.setTimeout(() => {
      setDetailsMounted(false);
      setDetailsTripId(null);
      setDetailsData(null);
      setCommissionMounted(false);
      setCommissionPayload(null);
      setCommissionAck(false);
      setCommissionError(null);
      setPayoutError(null);
      setPayoutBusy(false);
    }, 220);
  };

  const handoffDetailsToAssign = (trip: TripRow) => {
    closeDetails();
    window.setTimeout(() => {
      openAssign(trip);
    }, 220);
  };

  const openCommissionModal = (payload: CommissionAckPayload) => {
    setCommissionPayload(payload);
    setCommissionAck(false);
    setCommissionError(null);
    setCommissionMounted(true);
    requestAnimationFrame(() => setCommissionOpen(true));
  };

  const closeCommissionModal = () => {
    setCommissionOpen(false);
    window.setTimeout(() => {
      setCommissionMounted(false);
      setCommissionPayload(null);
      setCommissionAck(false);
      setCommissionError(null);
    }, 200);
  };

  // Payout used to also accept "pay" here (manual "mark paid"); that action
  // was retired — trips are paid exclusively through the AzamPay
  // Disbursement queue once approved. See the "Send via AzamPay disbursement
  // instead" link shown below when a trip's payout is APPROVED.
  const submitPayoutAction = async (action: "approve", acknowledgeCommission: boolean) => {
    if (!detailsMounted || !detailsTripId) return;
    setPayoutError(null);
    setPayoutBusy(true);
    try {
      await api.post(`/api/admin/drivers/trips/${detailsTripId}/payout/approve`, {
        acknowledgeCommission,
      });
      await refreshDetails();
      await load();
      return { ok: true } as const;
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.error === "commission_ack_required") {
        const payload: CommissionAckPayload = {
          error: "commission_ack_required",
          message: typeof data?.message === "string" ? data.message : undefined,
          currency: String(data?.currency || detailsData?.trip?.currency || "TZS"),
          grossAmount: Number(data?.grossAmount ?? 0),
          commissionPercent: Number(data?.commissionPercent ?? 10),
          commissionAmount: Number(data?.commissionAmount ?? 0),
          netPaid: Number(data?.netPaid ?? 0),
        };
        openCommissionModal(payload);
        return { ok: false, needsAck: true } as const;
      }
      const msg = String(data?.error || data?.message || err?.message || "Failed");
      setPayoutError(msg);
      return { ok: false, needsAck: false } as const;
    } finally {
      setPayoutBusy(false);
    }
  };

  const refreshDetails = useCallback(async () => {
    if (!detailsMounted || !detailsTripId) return;
    setDetailsLoading(true);
    try {
      const r = await api.get<TripDetailsResponse>(`/api/admin/drivers/trips/${detailsTripId}`);
      setDetailsData(r.data);
    } catch (err) {
      console.error("Failed to load trip details", err);
      setDetailsData(null);
    } finally {
      setDetailsLoading(false);
    }
  }, [detailsMounted, detailsTripId]);

  useEffect(() => {
    void refreshDetails();
  }, [refreshDetails]);

  const openReceipt = async (trip: TripRow) => {
    setReceiptOpen(true);
    setReceiptLoading(true);
    setReceiptData(null);
    try {
      const r = await api.get<TripDetailsResponse>(`/api/admin/drivers/trips/${trip.id}`);
      setReceiptData(r.data);
    } catch {
      // show error state
    } finally {
      setReceiptLoading(false);
    }
  };

  const printReceipt = () => {
    const el = document.getElementById("nolsaf-driver-receipt");
    if (!el) return;
    const w = window.open("", "", "width=720,height=960");
    if (!w) return;
    w.document.write(
      `<!DOCTYPE html><html><head><title>Driver Payout Receipt</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:24px;color:#111;background:#fff}
        .receipt-root{max-width:560px;margin:0 auto}
      </style>
      </head><body><div class="receipt-root">${el.innerHTML}</div></body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  const openReasonModal = (kind: "unassign" | "cancel", trip: TripRow) => {
    setReasonKind(kind);
    setReasonTrip(trip);
    setReasonText("");
    setReasonError(null);
    setReasonSelectedPick(null);
    setReasonMounted(true);
    requestAnimationFrame(() => {
      setReasonOpen(true);
      window.setTimeout(() => reasonTextareaRef.current?.focus(), 0);
    });
  };

  const closeReasonModal = () => {
    setReasonOpen(false);
    window.setTimeout(() => {
      setReasonMounted(false);
      setReasonTrip(null);
      setReasonText("");
      setReasonError(null);
      setReasonSelectedPick(null);
    }, 200);
  };

  const submitReasonModal = async () => {
    if (!reasonTrip) return;
    const reason = reasonText.trim();
    if (!reason) {
      setReasonError("Reason is required");
      return;
    }
    if (reasonKind === "cancel") {
      const minLen = 40;
      if (reason.length < minLen) {
        setReasonError(`Please provide a detailed cancel reason (min ${minLen} characters).`);
        return;
      }
    }
    setActionBusy(true);
    try {
      const endpoint = reasonKind === "unassign" ? "unassign" : "cancel";
      await api.post(`/api/admin/drivers/trips/${reasonTrip.id}/${endpoint}`, { reason });
      closeReasonModal();
      await load();
      if (detailsMounted && detailsTripId === reasonTrip.id) {
        await refreshDetails();
      }
    } catch (err: any) {
      console.error(`${reasonKind} failed`, err);
      setReasonError(err?.response?.data?.error || `Failed to ${reasonKind}`);
    } finally {
      setActionBusy(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Prepare histogram chart data
  const histogramChartData = useMemo<ChartData<"bar">>(() => {
    if (!histogramData || histogramData.stats.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const labels = histogramData.stats.map((s) => {
      const d = new Date(s.date);
      return histogramPeriod === "year" 
        ? d.toLocaleDateString("en-US", { month: "short" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });
    
    return {
      labels,
      datasets: [
        {
          label: "Total Trips",
          data: histogramData.stats.map((s) => s.count),
          backgroundColor: "rgba(59, 130, 246, 0.6)",
          borderColor: "rgba(59, 130, 246, 1)",
          borderWidth: 1,
        },
        {
          label: "Completed",
          data: histogramData.stats.map((s) => s.completed),
          backgroundColor: "rgba(16, 185, 129, 0.6)",
          borderColor: "rgba(16, 185, 129, 1)",
          borderWidth: 1,
        },
      ],
    };
  }, [histogramData, histogramPeriod]);

  const toggleSort = (key: SortKey) => {
    setSortKey((prev) => {
      if (prev !== key) {
        setSortDir("asc");
        return key;
      }
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return prev;
    });
  };

  const sortedList = useMemo(() => {
    if (!sortKey) return list;
    const dir = sortDir === "asc" ? 1 : -1;
    const copy = [...list];
    const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

    copy.sort((a, b) => {
      switch (sortKey) {
        case "tripCode":
          return dir * cmpStr(String(a.tripCode ?? ""), String(b.tripCode ?? ""));
        case "driver": {
          const aHas = Boolean(a.driver?.name);
          const bHas = Boolean(b.driver?.name);
          if (aHas !== bHas) return dir * (aHas ? -1 : 1);
          return dir * cmpStr(String(a.driver?.name ?? ""), String(b.driver?.name ?? ""));
        }
        case "pickup":
          return dir * cmpStr(String(a.pickup ?? ""), String(b.pickup ?? ""));
        case "dropoff":
          return dir * cmpStr(String(a.dropoff ?? ""), String(b.dropoff ?? ""));
        case "vehicleType":
          return dir * cmpStr(String(a.vehicleType ?? ""), String(b.vehicleType ?? ""));
        case "createdAt": {
          const aDate = a.createdAt ?? a.scheduledAt;
          const bDate = b.createdAt ?? b.scheduledAt;
          return dir * (new Date(aDate).getTime() - new Date(bDate).getTime());
        }
        case "amount":
          return dir * ((a.amount ?? 0) - (b.amount ?? 0));
        case "status":
          return dir * cmpStr(String(a.status ?? ""), String(b.status ?? ""));
        default:
          return 0;
      }
    });
    return copy;
  }, [list, sortKey, sortDir]);

  const SortIcon = ({ active }: { active: boolean }) => {
    if (!active) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-gray-700" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-gray-700" />
    );
  };

  const SortableTh = ({ label, k, align = "left" }: { label: string; k: SortKey; align?: "left" | "right" }) => {
    const active = sortKey === k;
    return (
      <th
        className={`px-6 py-3 ${align === "right" ? "text-right" : "text-left"} text-xs font-medium text-gray-500 uppercase tracking-wider select-none`}
        scope="col"
      >
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1.5 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white !bg-transparent !border-0 !shadow-none !p-0 !m-0 !rounded-none ${
            align === "right" ? "justify-end w-full" : ""
          }`}
          aria-label={`Sort by ${label}`}
          title={`Sort by ${label}`}
        >
          <span>{label}</span>
          <SortIcon active={active} />
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Premium Header */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)",
          boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)",
        }}
      >
        {/* Route sparkline SVG */}
        <svg aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none select-none" viewBox="0 0 900 220" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <circle cx="860" cy="-20" r="130" fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth="1.2" />
          <circle cx="860" cy="-20" r="195" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          <circle cx="40" cy="240" r="110" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <line x1="0" y1="55" x2="900" y2="55" stroke="rgba(255,255,255,0.045)" strokeWidth="0.8" />
          <line x1="0" y1="110" x2="900" y2="110" stroke="rgba(255,255,255,0.045)" strokeWidth="0.8" />
          <line x1="0" y1="165" x2="900" y2="165" stroke="rgba(255,255,255,0.03)" strokeWidth="0.8" />
          <path d="M 0 185 Q 80 190 120 170 Q 200 145 260 150 Q 340 158 400 130 Q 480 95 540 110 Q 620 130 680 90 Q 740 55 800 70 Q 850 80 900 60" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" strokeDasharray="8 5" />
          <polyline points="0,170 80,155 160,140 240,145 320,120 400,105 480,118 560,92 640,75 720,88 800,60 900,48" fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          <polygon points="0,170 80,155 160,140 240,145 320,120 400,105 480,118 560,92 640,75 720,88 800,60 900,48 900,220 0,220" fill="rgba(255,255,255,0.04)" />
          <polyline points="0,190 100,178 200,168 300,175 400,155 500,142 600,150 700,128 800,115 900,100" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.4" strokeDasharray="5 4" strokeLinejoin="round" />
          <circle cx="320" cy="120" r="4.5" fill="rgba(125,211,252,0.70)" />
          <circle cx="320" cy="120" r="9" fill="rgba(125,211,252,0.15)" />
          <circle cx="560" cy="92" r="4.5" fill="rgba(110,231,183,0.70)" />
          <circle cx="560" cy="92" r="9" fill="rgba(110,231,183,0.15)" />
          <circle cx="800" cy="60" r="4.5" fill="rgba(165,180,252,0.70)" />
          <circle cx="800" cy="60" r="9" fill="rgba(165,180,252,0.15)" />
          <ellipse cx="450" cy="110" rx="260" ry="70" fill="url(#tripsGlow)" />
          <defs>
            <radialGradient id="tripsGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(2,102,94,0.18)" />
              <stop offset="100%" stopColor="rgba(2,102,94,0)" />
            </radialGradient>
          </defs>
        </svg>

        <div className="relative z-10 px-6 pt-8 pb-7 sm:px-8 sm:pt-10">
          {/* Icon + title */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 46, height: 46, background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)" }}>
              <Route className="h-5 w-5" style={{ color: "rgba(255,255,255,0.92)" }} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.40)" }}>Driver Trips</h1>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.58)" }}>Direct-accept &amp; dispatch trips · scheduled-claim trips are in Scheduled Trips</p>
            </div>
          </div>

          {/* KPI chips */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Total Trips",       value: kpiCounts?.total,      bg: "rgba(56,189,248,0.18)",  border: "rgba(56,189,248,0.32)",  color: "#7dd3fc" },
              { label: "In Progress",       value: kpiCounts?.inProgress, bg: "rgba(16,185,129,0.18)",  border: "rgba(16,185,129,0.32)",  color: "#6ee7b7" },
              { label: "Completed",         value: kpiCounts?.completed,  bg: "rgba(20,184,166,0.18)",  border: "rgba(20,184,166,0.32)",  color: "#5eead4" },
              { label: "Pending Assignment", value: kpiCounts?.pending,    bg: "rgba(245,158,11,0.18)",  border: "rgba(245,158,11,0.32)",  color: "#fcd34d" },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl px-4 py-3" style={{ background: kpi.bg, border: `1px solid ${kpi.border}`, backdropFilter: "blur(8px)" }}>
                {kpisLoading || kpi.value === undefined ? (
                  <div className="animate-pulse rounded-lg h-10 w-full" style={{ background: "rgba(255,255,255,0.12)" }} />
                ) : (
                  <>
                    <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.55)" }}>{kpi.label}</div>
                    <div className="text-2xl font-black tabular-nums" style={{ color: kpi.color, textShadow: `0 0 18px ${kpi.color}55` }}>{(kpi.value as number).toLocaleString()}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="rounded-xl overflow-hidden" style={{ background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
        <div className="px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-5">
          <div className="flex flex-col gap-4 w-full box-border">

            {/* Search + Date row */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
              <div className="relative w-full sm:flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none z-10" style={{ color: 'rgba(255,255,255,0.38)' }} />
                <input
                  ref={searchRef}
                  type="text"
                  className="w-full box-border pl-10 pr-10 py-2.5 rounded-lg outline-none text-sm transition-all"
                  placeholder="Search trips..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setPage(1); load(); } }}
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', color: 'rgba(255,255,255,0.90)', width: '100%', maxWidth: '100%' }}
                />
                {q && (
                  <button type="button" onClick={() => { setQ(""); setPage(1); load(); }} className="absolute right-3 top-1/2 -translate-y-1/2 z-10 transition-colors" aria-label="Clear search" style={{ color: 'rgba(255,255,255,0.40)' }}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Date Picker */}
              <div className="relative w-full sm:w-auto sm:flex-shrink-0">
                <button
                  type="button"
                  onClick={() => { setPickerAnim(true); setTimeout(() => setPickerAnim(false), 350); setPickerOpen((v) => !v); }}
                  className="w-full box-border px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 transition-all"
                  style={pickerAnim ? { background: 'rgba(2,102,94,0.30)', border: '1.5px solid rgba(2,102,94,0.65)', color: '#5eead4' } : { background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.75)' }}
                >
                  <Calendar className="h-4 w-4" />
                  <span>Date</span>
                </button>
                {pickerOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                    <div className="fixed z-50 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                      <DatePicker selected={date || undefined} onSelectAction={(s) => { setDate(s as string | string[]); setPage(1); }} onCloseAction={() => setPickerOpen(false)} />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Assignment pills + status select */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center w-full">
              <div className="flex gap-2 items-center flex-wrap">
                {([
                  { label: "All",        value: "all"        as const, bg: "rgba(255,255,255,0.18)", border: "rgba(255,255,255,0.38)", color: "#ffffff",  inBg: "rgba(255,255,255,0.06)", inBorder: "rgba(255,255,255,0.13)" },
                  { label: "Assigned",   value: "assigned"   as const, bg: "rgba(16,185,129,0.25)",  border: "rgba(16,185,129,0.55)",  color: "#6ee7b7", inBg: "rgba(16,185,129,0.08)",  inBorder: "rgba(16,185,129,0.20)" },
                  { label: "Unassigned", value: "unassigned" as const, bg: "rgba(245,158,11,0.25)",  border: "rgba(245,158,11,0.55)",  color: "#fcd34d", inBg: "rgba(245,158,11,0.08)",  inBorder: "rgba(245,158,11,0.20)" },
                ] as const).map((s) => {
                  const isActive = assignment === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => { setAssignment(s.value); setPage(1); setTimeout(() => load(), 0); }}
                      className="px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap flex-shrink-0"
                      style={isActive ? { background: s.bg, border: `1.5px solid ${s.border}`, color: s.color } : { background: s.inBg, border: `1.5px solid ${s.inBorder}`, color: 'rgba(255,255,255,0.65)' }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>

              <div className="w-full sm:w-auto sm:ml-auto sm:min-w-[220px]">
                <label className="sr-only" htmlFor="tripStatus">Trip status</label>
                <select
                  id="tripStatus"
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); setPage(1); setTimeout(() => load(), 0); }}
                  className="w-full box-border px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', color: 'rgba(255,255,255,0.85)' }}
                >
                  <option value="" style={{ background: '#0d2320' }}>All statuses</option>
                  <option value="PENDING" style={{ background: '#0d2320' }}>Pending</option>
                  <option value="PENDING_ASSIGNMENT" style={{ background: '#0d2320' }}>Pending Assignment</option>
                  <option value="PENDING_ADMIN_ASSIGNMENT" style={{ background: '#0d2320' }}>Needs Takeover (Admin)</option>
                  <option value="CONFIRMED" style={{ background: '#0d2320' }}>Confirmed</option>
                  <option value="IN_PROGRESS" style={{ background: '#0d2320' }}>In Progress</option>
                  <option value="COMPLETED" style={{ background: '#0d2320' }}>Completed</option>
                  <option value="CANCELED" style={{ background: '#0d2320' }}>Canceled</option>
                </select>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-brand-600"></div>
            <p className="mt-3 text-sm text-gray-500">Loading trips...</p>
          </div>
        ) : list.length === 0 ? (
          <>
            <div className="px-6 py-12 text-center">
              <Truck className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No trips found.</p>
              <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query.</p>
            </div>

            {/* Trip Statistics Histogram */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-blue-300 hover:-translate-y-1 group">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 group-hover:text-blue-600 transition-colors duration-300">
                    <BarChart3 className="h-5 w-5 text-blue-600 group-hover:scale-110 transition-transform duration-300" />
                    Trip Statistics
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Visualize trip data over time</p>
                </div>
                
                {/* Period Filter */}
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: "7 Days", value: "7d" },
                    { label: "30 Days", value: "30d" },
                    { label: "This Month", value: "month" },
                    { label: "This Year", value: "year" },
                  ].map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setHistogramPeriod(p.value)}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all duration-300 whitespace-nowrap ${
                        histogramPeriod === p.value
                          ? "bg-blue-50 border-blue-300 text-blue-700 scale-105 shadow-md"
                          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:scale-105 hover:shadow-sm"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {histogramLoading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
                </div>
              ) : histogramData && histogramData.stats.length > 0 ? (
                <div className="h-64 w-full transform transition-all duration-500 group-hover:scale-[1.02]">
                  <Chart
                    type="bar"
                    data={histogramChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: true,
                          position: "top",
                          labels: {
                            padding: 15,
                            font: {
                              size: 12,
                            },
                            usePointStyle: true,
                          },
                        },
                        tooltip: {
                          callbacks: {
                            label: (context: any) => {
                              const label = context.dataset.label || "";
                              const value = context.parsed.y || 0;
                              const index = context.dataIndex;
                              const amount = histogramData.stats[index]?.amount || 0;
                              if (label === "Total Trips") {
                                return `${label}: ${value} trips (${amount.toLocaleString()} TZS)`;
                              }
                              return `${label}: ${value} trips`;
                            },
                          },
                        },
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            stepSize: 1,
                            font: {
                              size: 11,
                            },
                          },
                          grid: {
                            color: "rgba(0, 0, 0, 0.1)",
                          },
                          title: {
                            display: true,
                            text: "Number of Trips",
                            font: {
                              size: 12,
                            },
                          },
                        },
                        x: {
                          grid: {
                            display: false,
                          },
                          ticks: {
                            font: {
                              size: 11,
                            },
                            maxRotation: 45,
                            minRotation: 45,
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="h-64 w-full flex flex-col justify-end p-4">
                  {/* Skeleton Histogram */}
                  <div className="relative h-full w-full">
                    {/* Y-axis skeleton */}
                    <div className="absolute left-0 top-0 bottom-8 w-8 flex flex-col justify-between">
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                    </div>

                    {/* Chart area skeleton */}
                    <div className="ml-10 h-full relative">
                      {/* Grid lines */}
                      <div className="absolute inset-0 flex flex-col justify-between">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className="h-px bg-gray-200"></div>
                        ))}
                      </div>

                      {/* Skeleton bars */}
                      <div className="absolute bottom-0 left-0 right-0 h-full flex items-end justify-between gap-2 px-2">
                        {[...Array(7)].map((_, i) => {
                          const height = Math.random() * 60 + 20; // Random height between 20% and 80%
                          return (
                            <div
                              key={i}
                              className="flex-1 flex flex-col items-center justify-end gap-1"
                            >
                              <div
                                className="w-full bg-gray-200 rounded-t animate-pulse"
                                style={{ height: `${height}%` }}
                              ></div>
                              <div className="h-3 w-12 bg-gray-200 rounded animate-pulse"></div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <SortableTh label="Trip Code" k="tripCode" />
                    <SortableTh label="Driver" k="driver" />
                    <SortableTh label="Pickup" k="pickup" />
                    <SortableTh label="Dropoff" k="dropoff" />
                    <SortableTh label="Type" k="vehicleType" />
                    <SortableTh label="Requested" k="createdAt" />
                    <SortableTh label="Amount" k="amount" />
                    <SortableTh label="Status" k="status" />
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedList.map((trip) => (
                    <TableRow key={trip.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{trip.tripCode}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(() => {
                            const esc = getEscalation(trip);
                            if (esc.isTakeover) {
                              return (
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${pillClasses("amber")}`}
                                  title="10+ minutes unassigned: admin takeover required"
                                >
                                  Admin takeover
                                </span>
                              );
                            }
                            if (esc.warnWindow) {
                              return (
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${pillClasses("amber")}`}
                                  title="5+ minutes unassigned: admin prepare"
                                >
                                  5m warning
                                </span>
                              );
                            }
                            if (esc.overdue) {
                              return (
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${pillClasses("amber")}`}
                                  title="10+ minutes unassigned: pending escalation"
                                >
                                  Overdue
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trip.driver ? (
                          <div>
                            <div className="font-medium">{trip.driver.name}</div>
                            <div className="text-xs text-gray-500">{trip.driver.email}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Unassigned</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-gray-400" />
                          <span className="max-w-xs truncate" title={trip.pickup}>
                            {abbreviateLocation(trip.pickup)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-gray-400" />
                          <span className="max-w-xs truncate" title={trip.dropoff}>
                            {abbreviateLocation(trip.dropoff)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-gray-400" />
                          <span className="truncate">{trip.vehicleType || "—"}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-gray-400" />
                          <span>{formatRequestedDateTime(trip.createdAt ?? trip.scheduledAt)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <span>{trip.amount.toLocaleString()}</span>
                          <button
                            type="button"
                            onClick={() => openReceipt(trip)}
                            title="View driver payout receipt"
                            className="text-indigo-600 hover:text-indigo-900 transition"
                            aria-label="View driver payout receipt"
                          >
                            <FileText className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusStepIcons status={trip.status} hasDriver={Boolean(trip.driver)} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-2">
                          {!trip.driver && trip.status !== "CANCELED" && trip.status !== "COMPLETED" && (
                            <button
                              type="button"
                              onClick={() => openAssign(trip)}
                              disabled={actionBusy}
                                  className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 hover:border-brand-300 disabled:opacity-50"
                              aria-label="Assign driver"
                              title="Assign driver"
                            >
                              <UserPlus className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openDetails(trip)}
                                className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300"
                            aria-label="View details"
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {trip.driver && trip.status !== "IN_PROGRESS" && trip.status !== "CANCELED" && trip.status !== "COMPLETED" && (
                            <button
                              type="button"
                              onClick={() => openReasonModal("unassign", trip)}
                              disabled={actionBusy}
                                  className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:border-amber-300 disabled:opacity-50"
                              aria-label="Unassign driver"
                              title="Unassign driver"
                            >
                              <UserMinus className="h-4 w-4" />
                            </button>
                          )}
                          {trip.status !== "CANCELED" && trip.status !== "COMPLETED" && (
                            <button
                              type="button"
                              onClick={() => openReasonModal("cancel", trip)}
                              disabled={actionBusy}
                                  className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-300 disabled:opacity-50"
                              aria-label="Cancel trip"
                              title="Cancel trip"
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3 p-4">
              {sortedList.map((trip) => (
                <div key={trip.id} className="border rounded-lg p-4 bg-white shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-semibold text-gray-900 flex items-center gap-2">
                        <span className="truncate">{trip.tripCode}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(() => {
                          const esc = getEscalation(trip);
                          if (esc.isTakeover) {
                            return (
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${pillClasses("amber")}`}
                                title="10+ minutes unassigned: admin takeover required"
                              >
                                Admin takeover
                              </span>
                            );
                          }
                          if (esc.warnWindow) {
                            return (
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${pillClasses("amber")}`}
                                title="5+ minutes unassigned: admin prepare"
                              >
                                5m warning
                              </span>
                            );
                          }
                          if (esc.overdue) {
                            return (
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${pillClasses("amber")}`}
                                title="10+ minutes unassigned: pending escalation"
                              >
                                Overdue
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-sm text-gray-900">
                        <Truck className="h-4 w-4 text-gray-400" />
                        <span className="truncate">{trip.vehicleType || "—"}</span>
                      </div>
                      <div className="mt-1">
                        <StatusStepIcons status={trip.status} hasDriver={Boolean(trip.driver)} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!trip.driver && trip.status !== "CANCELED" && trip.status !== "COMPLETED" && (
                        <button
                          type="button"
                          onClick={() => openAssign(trip)}
                          disabled={actionBusy}
                          className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 hover:border-brand-300 disabled:opacity-50"
                          aria-label="Assign driver"
                        >
                          <UserPlus className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openDetails(trip)}
                        className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300"
                        aria-label="View details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {trip.driver && trip.status !== "IN_PROGRESS" && trip.status !== "CANCELED" && trip.status !== "COMPLETED" && (
                        <button
                          type="button"
                          onClick={() => openReasonModal("unassign", trip)}
                          disabled={actionBusy}
                          className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:border-amber-300 disabled:opacity-50"
                          aria-label="Unassign driver"
                        >
                          <UserMinus className="h-4 w-4" />
                        </button>
                      )}
                      {trip.status !== "CANCELED" && trip.status !== "COMPLETED" && (
                        <button
                          type="button"
                          onClick={() => openReasonModal("cancel", trip)}
                          disabled={actionBusy}
                          className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-300 disabled:opacity-50"
                          aria-label="Cancel trip"
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  {trip.driver && (
                    <div className="mb-3 pb-3 border-b border-gray-200">
                      <div className="flex items-center gap-2 text-sm">
                        <Truck className="h-4 w-4 text-gray-400" />
                        <div>
                          <div className="font-medium text-gray-900">{trip.driver.name}</div>
                          <div className="text-xs text-gray-500">{trip.driver.email}</div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                      <div>
                        <div className="text-xs text-gray-500">Pickup</div>
                        <div className="text-gray-900" title={trip.pickup}>{abbreviateLocation(trip.pickup)}</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                      <div>
                        <div className="text-xs text-gray-500">Dropoff</div>
                        <div className="text-gray-900" title={trip.dropoff}>{abbreviateLocation(trip.dropoff)}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-600">{formatRequestedDateTime(trip.createdAt ?? trip.scheduledAt)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{trip.amount.toLocaleString()}</span>
                        <button
                          type="button"
                          onClick={() => openReceipt(trip)}
                          title="View driver payout receipt"
                          className="text-indigo-600 hover:text-indigo-900 transition"
                          aria-label="View driver payout receipt"
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-sm text-gray-500 text-center sm:text-left">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} trips
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page === pages}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Assign Driver Modal */}
      {assignMounted && (
        <div className={`fixed inset-0 z-[90] ${assignOpen ? "" : "pointer-events-none"}`}>
          <div
            className={`absolute inset-0 bg-black/60 backdrop-blur-[3px] transition-opacity duration-200 ${assignOpen ? "opacity-100" : "opacity-0"}`}
            onClick={closeAssign}
          />
          <div className="absolute inset-0 overflow-y-auto px-3 py-4 sm:p-6">
            <div
              className={`relative mx-auto my-0 w-full max-w-[44rem] flex flex-col rounded-[2rem] overflow-hidden shadow-[0_28px_90px_rgba(0,0,0,0.55)] border border-white/10 transition-all duration-200 ease-out ${
                assignOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.97] translate-y-3"
              }`}
              style={{ minHeight: "min(40rem, calc(100svh - 2rem))", maxHeight: "calc(100svh - 2rem)" }}
              role="dialog"
              aria-modal="true"
              aria-label="Assign driver"
            >
              <div className="relative bg-slate-950 flex-shrink-0 overflow-hidden">
                <div className="absolute inset-0 bg-[linear-gradient(135deg,#091a34_0%,#0b3157_38%,#02665e_100%)]" />
                <div className="pointer-events-none absolute -top-24 left-[-4rem] h-56 w-56 rounded-full bg-sky-300/20 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-20 right-[-2rem] h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl" />
                <div className="pointer-events-none absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_14%_22%,white,transparent_30%),radial-gradient(circle_at_82%_18%,white,transparent_24%),radial-gradient(circle_at_55%_100%,white,transparent_34%)]" />
                <div className="relative px-5 py-4 sm:px-6 sm:py-5 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/45 mb-1.5">Assign Driver</div>
                    <div className="text-lg sm:text-[1.45rem] font-black tracking-tight text-white break-all leading-tight" title={assignTrip?.tripCode || ""}>{assignTrip?.tripCode || "—"}</div>
                    <div className="mt-2 inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white/80 backdrop-blur-sm">
                      Choose the best driver and leave a clear assignment reason
                    </div>
                  </div>
                  <button type="button" onClick={closeAssign}
                    className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-2xl bg-white/10 border border-white/15 text-white/70 hover:bg-white/20 hover:text-white transition"
                    aria-label="Close">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
                <div className="p-4 sm:p-5 space-y-3.5 pb-[calc(env(safe-area-inset-bottom)+7rem)] sm:pb-5">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="bg-white rounded-[1.7rem] border border-slate-200/80 shadow-[0_1px_0_rgba(15,23,42,0.04),0_16px_40px_rgba(15,23,42,0.08)] overflow-hidden">
                      <div className="px-4 pt-4 pb-3 border-b border-slate-100/80 bg-slate-50/70">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 mb-2.5">Search Driver</div>
                        <div className="relative">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <input
                            value={driverQuery}
                            onChange={(e) => { setDriverQuery(e.target.value); if (assignError) setAssignError(null); }}
                            placeholder="Name or email"
                            className="w-full box-border pl-11 pr-10 py-2.5 rounded-2xl border border-slate-200 bg-white outline-none text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-colors"
                          />
                          {driverLoading && (
                            <div className="absolute right-4 top-1/2 -translate-y-1/2">
                              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="max-h-[18rem] overflow-y-auto bg-white">
                        {driverResults.length === 0 && !driverLoading ? (
                          <div className="px-6 py-10 text-center">
                            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                              <Search className="h-4 w-4" />
                            </div>
                            <div className="text-sm font-semibold text-slate-400">No drivers found</div>
                          </div>
                        ) : (
                          driverResults.map((d) => {
                            const active = selectedDriver?.id === d.id;
                            return (
                              <button key={d.id} type="button"
                                onClick={() => { setSelectedDriver(d); if (assignError) setAssignError(null); }}
                                className={`w-full text-left px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 transition-colors ${active ? "bg-[#02665e]/8" : "hover:bg-slate-50"}`}
                              >
                                <div className="min-w-0 flex items-center gap-3">
                                  <div className={`h-10 w-10 rounded-2xl flex items-center justify-center text-xs font-black ${active ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"}`}>
                                    {(d.name || `D${d.id}`).slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-[13px] font-black text-slate-900 truncate">{d.name || `Driver #${d.id}`}</div>
                                    <div className="text-[11px] font-medium text-slate-500 break-words">{d.email}</div>
                                    {d.phone ? <div className="text-[11px] text-slate-400">{d.phone}</div> : null}
                                  </div>
                                </div>
                                <div className={`flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${active ? "border-[#02665e] bg-[#02665e]" : "border-slate-300 bg-white"}`} aria-hidden="true">
                                  {active ? <CheckCircle2 className="h-3.5 w-3.5 text-white" /> : null}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="bg-white rounded-[1.7rem] border border-slate-200/80 shadow-sm overflow-hidden">
                      <div className="px-4 pt-4 flex items-center justify-between">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Reason</div>
                        <button type="button" disabled={actionBusy}
                          onClick={() => { setAssignReason(""); setAssignSelectedPick(null); if (assignError) setAssignError(null); window.setTimeout(() => assignReasonRef.current?.focus(), 0); }}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-700 transition disabled:opacity-40">
                          Clear
                        </button>
                      </div>
                      <div className="px-4 pt-3 pb-2 grid grid-cols-2 gap-2">
                        {assignQuickPicks.map((pick) => (
                          <button key={pick} type="button" onClick={() => applyAssignPick(pick)} disabled={actionBusy} title={pick}
                            className={`min-h-[2.75rem] px-3 py-2 rounded-[1.25rem] text-[11px] leading-4 font-black border transition disabled:opacity-50 ${
                              assignSelectedPick === pick
                                ? "border-[#02665e] bg-[#02665e] text-white shadow-sm shadow-[#02665e]/20"
                                : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"
                            }`}>
                            {pick}
                          </button>
                        ))}
                      </div>
                      <div className="px-4 pt-2 pb-4">
                        <textarea
                          ref={assignReasonRef}
                          value={assignReason}
                          onChange={(e) => { setAssignReason(e.target.value); if (assignSelectedPick) setAssignSelectedPick(null); if (assignError) setAssignError(null); }}
                          placeholder="Why assign this driver?"
                          rows={5}
                          className={`block w-full box-border px-4 py-3 rounded-[1.25rem] border bg-slate-50 outline-none text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 resize-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-colors ${assignError ? "border-red-300" : "border-slate-200"}`}
                        />
                        {assignError ? <div className="mt-2 text-xs font-semibold text-red-600">{assignError}</div> : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-slate-200/80 bg-white/95 px-4 py-4 backdrop-blur-sm sm:px-6">
                {(() => {
                  const ready = Boolean(selectedDriver) && Boolean(assignReason.trim()) && !actionBusy;
                  const tooltip = !selectedDriver ? "Select a driver first" : !assignReason.trim() ? "Enter a reason" : actionBusy ? "Processing…" : "Assign driver";
                  return (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs font-medium text-slate-500">
                        {selectedDriver ? (
                          <span>Assigning <span className="font-black text-slate-900">{selectedDriver.name || `Driver #${selectedDriver.id}`}</span></span>
                        ) : (
                          <span>Select a driver and add a reason to continue</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <button
                          type="button"
                          onClick={closeAssign}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                      <button
                        type="button"
                        onClick={submitAssign}
                        disabled={!ready}
                        aria-label="Assign driver"
                        title={tooltip}
                        className="min-w-[13rem] px-5 py-3 rounded-2xl bg-[#02665e] hover:bg-[#027a70] active:scale-[0.985] text-white font-black text-xs tracking-[0.08em] shadow-md shadow-[#02665e]/30 transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
                      >
                        {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                        {actionBusy ? "Assigning…" : "Assign Driver"}
                      </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trip Details Drawer */}
      {detailsMounted && (
        <div className={`fixed inset-0 z-[90] ${detailsOpen ? "" : "pointer-events-none"}`}>
          <div
            className={`absolute inset-0 bg-slate-950/70 backdrop-blur-[4px] transition-opacity duration-200 ${detailsOpen ? "opacity-100" : "opacity-0"}`}
            onClick={closeDetails}
          />
          <div className="absolute inset-0 overflow-y-auto px-3 py-4 sm:p-6">
            <div
              className={`relative mx-auto my-0 w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-[0_28px_90px_rgba(2,6,23,0.55)] flex flex-col transition-all duration-200 ease-out ${
                detailsOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.98] translate-y-3"
              }`}
              style={{ minHeight: "min(44rem, calc(100svh - 2rem))", maxHeight: "calc(100svh - 2rem)" }}
            >
              <div className="relative shrink-0 overflow-hidden bg-slate-950">
                <div className="absolute inset-0 bg-[linear-gradient(135deg,#163b8c_0%,#0a5670_45%,#02665e_100%)]" />
                <div className="absolute -top-24 left-[-5rem] h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl" />
                <div className="absolute -bottom-24 right-[-3rem] h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl" />
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_15%_20%,white,transparent_32%),radial-gradient(circle_at_80%_18%,white,transparent_24%),radial-gradient(circle_at_50%_100%,white,transparent_35%)]" />
                <div className="relative px-5 py-4 sm:px-6 sm:py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/50">Trip Details</p>
                      <h2 className="mt-1.5 text-base sm:text-[1.35rem] lg:text-[1.5rem] font-black tracking-[-0.02em] text-white break-all leading-[1.08]">
                        {detailsData?.trip?.tripCode || "—"}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {detailsData?.trip?.status && (
                          <span className="inline-flex items-center rounded-full border border-white/20 bg-white/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white backdrop-blur-sm">
                            {detailsData.trip.status.replaceAll("_", " ")}
                          </span>
                        )}
                        <span className="text-[11px] font-medium text-white/70">
                          {detailsData?.trip?.createdAt
                            ? new Date(detailsData.trip.createdAt).toLocaleString()
                            : detailsData?.trip?.scheduledAt
                              ? new Date(detailsData.trip.scheduledAt).toLocaleString()
                              : ""}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={closeDetails}
                      className="h-10 w-10 shrink-0 rounded-2xl border border-white/15 bg-white/10 text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4 mx-auto" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
              {detailsLoading ? (
                <div className="py-16 text-center text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-3 text-slate-400" />
                  Loading details...
                </div>
              ) : !detailsData ? (
                <div className="py-16 text-center text-sm text-slate-500">Failed to load trip details.</div>
              ) : (
                <div className="p-4 sm:p-6 space-y-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] sm:pb-6">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-[1.6rem] border border-slate-200/80 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04),0_16px_40px_rgba(15,23,42,0.08)]">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Route</div>
                      <div className="mt-3 space-y-3">
                        <div className="grid grid-cols-[auto_1fr] gap-3 items-start">
                          <div className="mt-1.5 flex flex-col items-center">
                            <span className="h-3.5 w-3.5 rounded-full border-[3px] border-emerald-200 bg-[#02665e]" />
                            <span className="mt-1 h-12 w-px bg-gradient-to-b from-[#02665e] via-slate-300 to-rose-300" />
                            <span className="mt-1 h-3.5 w-3.5 rounded-full border-[3px] border-rose-200 bg-rose-500" />
                          </div>
                          <div className="space-y-4">
                            <div>
                              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Pickup</div>
                              <div className="mt-1 text-[13px] font-semibold leading-5 text-slate-900 break-words">{detailsData.trip.pickup}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Dropoff</div>
                              <div className="mt-1 text-[13px] font-semibold leading-5 text-slate-900 break-words">{detailsData.trip.dropoff}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-[1.4rem] border border-slate-200/80 bg-white p-4 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Vehicle</div>
                        <div className="mt-2.5 text-xl font-black tracking-tight text-slate-950">{detailsData.trip.vehicleType || "—"}</div>
                      </div>
                      <div className="rounded-[1.4rem] border border-slate-200/80 bg-white p-4 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Amount</div>
                        <div className="mt-2.5 text-xl font-black tracking-tight text-slate-950">
                          {detailsData.trip.currency} {Number(detailsData.trip.amount || 0).toLocaleString()}
                        </div>
                      </div>
                      <div className="rounded-[1.4rem] border border-slate-200/80 bg-white p-4 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Payment</div>
                        <div className="mt-2.5 text-base font-black text-slate-950">{detailsData.trip.paymentStatus || "—"}</div>
                        {detailsData.trip.paymentRef && (
                          <div className="mt-1 text-[11px] font-medium text-slate-500 break-all">Ref: {detailsData.trip.paymentRef}</div>
                        )}
                      </div>
                      <div className="rounded-[1.4rem] border border-slate-200/80 bg-white p-4 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Times</div>
                        <div className="mt-2.5 space-y-1 text-[13px] font-semibold text-slate-900">
                          <div><span className="text-slate-400">In: </span>{detailsData.trip.pickupTime ? new Date(detailsData.trip.pickupTime).toLocaleTimeString() : "—"}</div>
                          <div><span className="text-slate-400">Out: </span>{detailsData.trip.dropoffTime ? new Date(detailsData.trip.dropoffTime).toLocaleTimeString() : "—"}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-[1.5rem] border border-slate-200/80 bg-white p-4 shadow-sm">
                      <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Passenger</div>
                      <div className="mt-3 text-lg font-black text-slate-950">
                        {detailsData.trip.user?.name || "—"}
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-500 break-words">{detailsData.trip.user?.email || ""}</div>
                      {detailsData.trip.user?.phone && (
                        <div className="mt-1 text-sm font-medium text-slate-500">{detailsData.trip.user.phone}</div>
                      )}
                    </div>
                    <div className="rounded-[1.5rem] border border-slate-200/80 bg-white p-4 shadow-sm">
                      <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Driver</div>
                      <div className="mt-3 text-lg font-black text-slate-950">
                        {detailsData.trip.driver?.name || "Unassigned"}
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-500 break-words">{detailsData.trip.driver?.email || ""}</div>
                      {detailsData.trip.driver?.phone && (
                        <div className="mt-1 text-sm font-medium text-slate-500">{detailsData.trip.driver.phone}</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[1.6rem] border border-slate-200/80 bg-white p-4 shadow-sm">
                    {(() => {
                      const trip = detailsData.trip;
                      const tripStatus = String(trip.status ?? "").toUpperCase();
                      const eligible = tripStatus === "COMPLETED" || tripStatus === "FINISHED";

                      const rawPayoutStatus = trip.payout?.status ? String(trip.payout.status).toUpperCase() : "";
                      const payoutStatus = rawPayoutStatus || (eligible ? "PENDING" : "—");

                      const gross = Number(trip.amount ?? 0);
                      const commissionPercent = Number(trip.payout?.commissionPercent ?? 10);
                      const commissionAmount =
                        trip.payout?.commissionAmount != null
                          ? Number(trip.payout.commissionAmount)
                          : round2((gross * commissionPercent) / 100);
                      const netPaid =
                        trip.payout?.netPaid != null ? Number(trip.payout.netPaid) : round2(gross - commissionAmount);

                      const pillKind =
                        payoutStatus === "PAID"
                          ? "green"
                          : payoutStatus === "APPROVED"
                            ? "blue"
                            : payoutStatus === "PENDING"
                              ? "neutral"
                              : "amber";

                      const hasDriver = Boolean(trip.driver);
                      const canApprove = eligible && hasDriver && payoutStatus !== "PAID" && payoutStatus !== "APPROVED";
                      const busy = payoutBusy || commissionBusy || actionBusy;

                      return (
                        <>
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Driver Payout</div>
                            <span className={`px-3 py-1 text-[11px] font-black rounded-full border ${pillClasses(pillKind)}`}>
                              {payoutStatus}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Gross</div>
                              <div className="mt-2 text-lg font-black text-slate-950">
                                {trip.currency} {Number.isFinite(gross) ? gross.toLocaleString() : "0"}
                              </div>
                            </div>
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Commission</div>
                              <div className="mt-2 text-lg font-black text-slate-950">
                                {commissionPercent}% ({Number.isFinite(commissionAmount) ? commissionAmount.toLocaleString() : "0"})
                              </div>
                            </div>
                            <div className="rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
                              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700/70">Net To Driver</div>
                              <div className="mt-2 text-lg font-black text-emerald-700">
                                {trip.currency} {Number.isFinite(netPaid) ? netPaid.toLocaleString() : "0"}
                              </div>
                            </div>
                          </div>

                          {payoutError ? <div className="mt-3 text-sm font-semibold text-red-600">{payoutError}</div> : null}

                          {eligible ? (
                            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                              <button
                                type="button"
                                disabled={!canApprove || busy}
                                onClick={() => void submitPayoutAction("approve", false)}
                                className="inline-flex items-center justify-center rounded-2xl border border-[#02665e]/20 bg-[#02665e]/8 px-4 py-3 text-sm font-black text-[#02665e] transition hover:bg-[#02665e]/12 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Approve
                              </button>
                            </div>
                          ) : null}

                          {payoutStatus === "APPROVED" && trip.payout?.id ? (
                            <div className="mt-3 text-xs font-semibold text-emerald-700">
                              <Link
                                href={`/admin/disbursements?sourceType=DRIVER_TRIP&sourceId=${trip.payout.id}`}
                                className="underline underline-offset-2"
                              >
                                Send via AzamPay disbursement instead
                              </Link>
                            </div>
                          ) : null}

                          {!eligible && (
                            <div className="mt-4 text-xs font-medium text-slate-400">
                              Payout actions available once trip is completed.
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div className="rounded-[1.6rem] border border-slate-200/80 bg-white shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                      Assignment History
                    </div>
                    {detailsData.assignmentAudits.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-slate-400">No assignment history.</div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {detailsData.assignmentAudits.map((a) => (
                          <div key={a.id} className="px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-black text-slate-900">{a.action}</div>
                              <div className="text-[11px] font-medium text-slate-400">
                                {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}
                              </div>
                            </div>
                            {(a.reason || a.actorId) && (
                              <div className="mt-1 text-xs font-medium text-slate-500">
                                {a.reason ? `Reason: ${a.reason}` : ""}
                                {a.actorId ? `  •  By: ${a.actorId}` : ""}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

              <div className="shrink-0 border-t border-slate-200/80 bg-white/95 px-4 py-4 backdrop-blur-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={refreshDetails}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100"
                    aria-label="Refresh"
                    title="Refresh"
                  >
                    <RotateCw className="h-4 w-4" />
                    Refresh
                  </button>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                {detailsData?.trip && !detailsData.trip.driver && detailsData.trip.status !== "CANCELED" && detailsData.trip.status !== "COMPLETED" && (
                  <button
                    type="button"
                    onClick={() => {
                      const row: TripRow = {
                        id: detailsData.trip.id,
                        tripCode: detailsData.trip.tripCode,
                        driver: null,
                        pickup: detailsData.trip.pickup,
                        dropoff: detailsData.trip.dropoff,
                        scheduledAt: detailsData.trip.scheduledAt,
                        amount: detailsData.trip.amount,
                        status: detailsData.trip.status,
                        createdAt: detailsData.trip.createdAt || "",
                      };
                      handoffDetailsToAssign(row);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#02665e] px-4 py-3 text-sm font-black text-white shadow-md shadow-[#02665e]/25 transition hover:bg-[#027a70]"
                    aria-label="Assign driver"
                    title="Assign driver"
                  >
                    <UserPlus className="h-4 w-4" />
                    Assign Driver
                  </button>
                )}
                {detailsData?.trip && detailsData.trip.driver && detailsData.trip.status !== "IN_PROGRESS" && detailsData.trip.status !== "CANCELED" && detailsData.trip.status !== "COMPLETED" && (
                  <button
                    type="button"
                    onClick={async () => {
                      const row: TripRow = {
                        id: detailsData.trip.id,
                        tripCode: detailsData.trip.tripCode,
                        driver: detailsData.trip.driver,
                        pickup: detailsData.trip.pickup,
                        dropoff: detailsData.trip.dropoff,
                        scheduledAt: detailsData.trip.scheduledAt,
                        amount: detailsData.trip.amount,
                        status: detailsData.trip.status,
                        createdAt: detailsData.trip.createdAt || "",
                      };
                      openReasonModal("unassign", row);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800 transition hover:bg-amber-100"
                    aria-label="Unassign driver"
                    title="Unassign driver"
                  >
                    <UserMinus className="h-4 w-4" />
                    Unassign
                  </button>
                )}
                {detailsData?.trip && detailsData.trip.status !== "CANCELED" && detailsData.trip.status !== "COMPLETED" && (
                  <button
                    type="button"
                    onClick={async () => {
                      const row: TripRow = {
                        id: detailsData.trip.id,
                        tripCode: detailsData.trip.tripCode,
                        driver: detailsData.trip.driver,
                        pickup: detailsData.trip.pickup,
                        dropoff: detailsData.trip.dropoff,
                        scheduledAt: detailsData.trip.scheduledAt,
                        amount: detailsData.trip.amount,
                        status: detailsData.trip.status,
                        createdAt: detailsData.trip.createdAt || "",
                      };
                      openReasonModal("cancel", row);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-600 bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700"
                    aria-label="Cancel trip"
                    title="Cancel trip"
                  >
                    <Ban className="h-4 w-4" />
                    Cancel Trip
                  </button>
                )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reason Modal */}
      {reasonMounted && (
        <div className={`fixed inset-0 z-[90] ${reasonOpen ? "" : "pointer-events-none"}`}>
          <div
            className={`absolute inset-0 bg-slate-950/70 backdrop-blur-[4px] transition-opacity duration-200 ${reasonOpen ? "opacity-100" : "opacity-0"}`}
            onClick={closeReasonModal}
          />
          <div className="absolute inset-0 overflow-y-auto px-3 py-4 sm:p-6">
            <div
              className={`relative mx-auto my-0 w-full max-w-2xl flex flex-col overflow-hidden rounded-[2rem] border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.55)] bg-white transition-all duration-200 ease-out ${
                reasonOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.98] translate-y-3"
              }`}
              style={{ minHeight: "min(34rem, calc(100svh - 2rem))", maxHeight: "calc(100svh - 2rem)" }}
              role="dialog"
              aria-modal="true"
              aria-label={reasonKind === "cancel" ? "Cancel trip" : "Unassign trip"}
            >
              <div className="relative shrink-0 overflow-hidden bg-slate-950">
                <div className={`absolute inset-0 ${reasonKind === "cancel" ? "bg-[linear-gradient(135deg,#4c0519_0%,#991b1b_38%,#dc2626_100%)]" : "bg-[linear-gradient(135deg,#091a34_0%,#0b3157_38%,#02665e_100%)]"}`} />
                <div className="pointer-events-none absolute -top-24 left-[-4rem] h-56 w-56 rounded-full bg-white/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-20 right-[-2rem] h-56 w-56 rounded-full bg-white/10 blur-3xl" />
                <div className="pointer-events-none absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_14%_22%,white,transparent_30%),radial-gradient(circle_at_82%_18%,white,transparent_24%),radial-gradient(circle_at_55%_100%,white,transparent_34%)]" />
                <div className="relative px-5 py-4 sm:px-6 sm:py-5 flex items-start justify-between gap-4 text-white">
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/45 mb-1.5">
                      {reasonKind === "cancel" ? "Cancel Trip" : "Unassign Driver"}
                    </div>
                    <div className="text-lg sm:text-[1.45rem] font-black tracking-tight text-white break-all leading-tight">
                      {reasonTrip?.tripCode || "—"}
                    </div>
                    <div className="mt-2 inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white/80 backdrop-blur-sm">
                      {reasonKind === "cancel" ? "Document the cancellation clearly" : "Explain why this assignment is changing"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeReasonModal}
                    className="h-10 w-10 shrink-0 rounded-2xl bg-white/10 border border-white/15 text-white/80 hover:bg-white/20 transition"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
                <div className="p-4 sm:p-5 space-y-3.5 pb-[calc(env(safe-area-inset-bottom)+7rem)] sm:pb-5">
                  <div className="bg-white rounded-[1.7rem] border border-slate-200/80 shadow-sm overflow-hidden">
                    <div className="px-4 pt-4 flex items-center justify-between">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Reason</div>
                      <button
                        type="button"
                        onClick={() => {
                          setReasonText("");
                          if (reasonError) setReasonError(null);
                          setReasonSelectedPick(null);
                          window.setTimeout(() => reasonTextareaRef.current?.focus(), 0);
                        }}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-700 transition"
                        disabled={actionBusy}
                      >
                        Clear
                      </button>
                    </div>

                    <div className="px-4 pt-3 pb-2 grid grid-cols-2 gap-2">
                      {reasonQuickPicks.map((pick) => (
                        <button
                          key={pick}
                          type="button"
                          onClick={() => applyReasonPick(pick)}
                          disabled={actionBusy}
                          title={pick}
                          className={`min-h-[2.75rem] px-3 py-2 rounded-[1.25rem] text-[11px] leading-4 font-black border transition disabled:opacity-50 ${
                            reasonSelectedPick === pick
                              ? reasonKind === "cancel"
                                ? "border-red-600 bg-red-600 text-white shadow-sm shadow-red-600/20"
                                : "border-[#02665e] bg-[#02665e] text-white shadow-sm shadow-[#02665e]/20"
                              : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"
                          }`}
                        >
                          {pick}
                        </button>
                      ))}
                    </div>

                    <div className="px-4 pt-2 pb-4">
                      <textarea
                        ref={reasonTextareaRef}
                        value={reasonText}
                        onChange={(e) => {
                          setReasonText(e.target.value);
                          if (reasonSelectedPick) setReasonSelectedPick(null);
                          if (reasonError) setReasonError(null);
                        }}
                        placeholder={
                          reasonKind === "cancel"
                            ? "Explain clearly why you are canceling this trip. Include what happened and the next step."
                            : "Why are you unassigning this driver?"
                        }
                        rows={4}
                        className={`block w-full max-w-full box-border px-4 py-3 rounded-[1.25rem] border bg-slate-50 outline-none text-sm font-semibold leading-6 text-slate-900 placeholder:font-normal placeholder:text-slate-400 resize-none min-h-[8.5rem] focus:ring-2 ${
                          reasonKind === "cancel" ? "focus:ring-red-500/20 focus:border-red-500" : "focus:ring-[#02665e]/20 focus:border-[#02665e]"
                        } ${reasonError ? "border-red-300" : "border-slate-200"}`}
                      />
                      {reasonKind === "cancel" ? (
                        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                          <span>Minimum 40 characters required for cancel.</span>
                          <span>{reasonText.trim().length}/40</span>
                        </div>
                      ) : null}
                      {reasonError ? <div className="mt-2 text-xs font-semibold text-red-600">{reasonError}</div> : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-slate-200/80 bg-white/95 px-4 py-4 backdrop-blur-sm sm:px-6">
                {(() => {
                  const trimmed = reasonText.trim();
                  const minCancelLen = 40;
                  const canSubmit =
                    !actionBusy &&
                    (reasonKind === "cancel" ? trimmed.length >= minCancelLen : trimmed.length > 0);
                  const submitTitle =
                    reasonKind === "cancel"
                      ? canSubmit
                        ? "Cancel trip"
                        : `Provide at least ${minCancelLen} characters to cancel`
                      : canSubmit
                        ? "Unassign"
                        : "Reason is required";

                  return (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs font-medium text-slate-500">
                        {reasonKind === "cancel"
                          ? "Provide a clear audit trail for this cancellation"
                          : "Explain the reassignment so the audit history stays useful"}
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <button
                          type="button"
                          onClick={closeReasonModal}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={submitReasonModal}
                          disabled={!canSubmit}
                          aria-label={reasonKind === "cancel" ? "Cancel trip" : "Unassign driver"}
                          title={submitTitle}
                          className={`min-w-[13rem] px-5 py-3 rounded-2xl text-white font-black text-xs tracking-[0.08em] shadow-md transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2 ${
                            reasonKind === "cancel"
                              ? "bg-red-600 hover:bg-red-700 shadow-red-600/25"
                              : "bg-[#02665e] hover:bg-[#027a70] shadow-[#02665e]/30"
                          }`}
                        >
                          {actionBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : reasonKind === "cancel" ? (
                            <Ban className="h-3.5 w-3.5" />
                          ) : (
                            <UserMinus className="h-3.5 w-3.5" />
                          )}
                          {reasonKind === "cancel" ? "Cancel Trip" : "Unassign Driver"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Driver Payout Receipt Modal */}
      {receiptOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={() => setReceiptOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Toolbar header – document viewer style */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={printReceipt}
                  disabled={receiptLoading || !receiptData}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={printReceipt}
                  disabled={receiptLoading || !receiptData}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="h-3.5 w-3.5" />
                  Save
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center">
                <span className="text-xs font-medium text-gray-500 tracking-wide hidden sm:block">
                  Driver Payout Receipt · Page 1 of 1
                </span>
              </div>
              <button
                type="button"
                onClick={() => setReceiptOpen(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 transition shrink-0"
                aria-label="Close receipt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Document area */}
            <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 p-4 sm:p-6">
              {receiptLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
                </div>
              ) : receiptData ? (
                <div
                  id="nolsaf-driver-receipt"
                  className="bg-white rounded-xl shadow-sm max-w-lg mx-auto p-6 space-y-5"
                >
                  {/* Receipt brand header */}
                  <div className="text-center border-b border-gray-100 pb-5">
                    <div
                      className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
                      style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #02665e 100%)" }}
                    >
                      <FileText className="h-6 w-6 text-white" />
                    </div>
                    <h1 className="text-lg font-bold text-gray-900 tracking-tight">NoLSAF</h1>
                    <p className="text-xs text-gray-500 mt-0.5">Official Driver Payout Receipt</p>
                    <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                      <span className="text-xs font-mono bg-gray-100 px-2.5 py-1 rounded text-gray-600 border border-gray-200">
                        {receiptData.trip.tripCode}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                          receiptData.trip.payout?.status === "PAID"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : receiptData.trip.payout?.status === "APPROVED"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {receiptData.trip.payout?.status ?? "PENDING"}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2">
                      {receiptData.trip.payout?.paidAt
                        ? `Paid: ${new Date(receiptData.trip.payout.paidAt).toLocaleString()}`
                        : receiptData.trip.payout?.approvedAt
                        ? `Approved: ${new Date(receiptData.trip.payout.approvedAt).toLocaleString()}`
                        : `Trip Date: ${new Date(receiptData.trip.scheduledAt).toLocaleString()}`}
                    </p>
                  </div>

                  {/* Driver & Route */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Driver</p>
                      <p className="text-sm font-semibold text-gray-900">{receiptData.trip.driver?.name ?? "—"}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{receiptData.trip.driver?.email ?? "—"}</p>
                      <p className="text-xs text-gray-500">{receiptData.trip.driver?.phone ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Route</p>
                      <p className="text-xs text-gray-700">
                        <span className="font-medium text-gray-500">From </span>
                        {receiptData.trip.pickup}
                      </p>
                      <p className="text-xs text-gray-700 mt-1">
                        <span className="font-medium text-gray-500">To </span>
                        {receiptData.trip.dropoff}
                      </p>
                      {receiptData.trip.vehicleType && (
                        <p className="text-xs text-gray-400 mt-1">{receiptData.trip.vehicleType}</p>
                      )}
                    </div>
                  </div>

                  {/* Payout breakdown */}
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Payout Breakdown</p>
                    </div>
                    <div className="divide-y divide-gray-100">
                      <div className="px-4 py-3 flex items-center justify-between">
                        <span className="text-xs text-gray-600">Gross Amount</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {receiptData.trip.payout?.currency ?? "TZS"}{" "}
                          {Number(receiptData.trip.payout?.grossAmount ?? receiptData.trip.amount ?? 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="px-4 py-3 flex items-center justify-between">
                        <span className="text-xs text-gray-600">
                          Commission ({Number(receiptData.trip.payout?.commissionPercent ?? 0)}%)
                        </span>
                        <span className="text-sm font-semibold text-red-600">
                          − {receiptData.trip.payout?.currency ?? "TZS"}{" "}
                          {Number(receiptData.trip.payout?.commissionAmount ?? 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="px-4 py-3 flex items-center justify-between bg-emerald-50">
                        <span className="text-xs font-bold text-emerald-800">Net To Driver</span>
                        <span className="text-sm font-bold text-emerald-700">
                          {receiptData.trip.payout?.currency ?? "TZS"}{" "}
                          {Number(receiptData.trip.payout?.netPaid ?? 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Payment info */}
                  {(receiptData.trip.payout?.paymentMethod || receiptData.trip.paymentMethod) && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Method</p>
                        <p className="text-sm font-semibold text-gray-800 mt-0.5">
                          {receiptData.trip.payout?.paymentMethod ?? receiptData.trip.paymentMethod ?? "—"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Reference</p>
                        <p
                          className="text-sm font-semibold text-gray-800 mt-0.5 truncate"
                          title={receiptData.trip.payout?.paymentRef ?? receiptData.trip.paymentRef ?? "—"}
                        >
                          {receiptData.trip.payout?.paymentRef ?? receiptData.trip.paymentRef ?? "—"}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Footer note */}
                  <div className="border-t border-gray-100 pt-4 text-center">
                    <p className="text-[10px] text-gray-400">
                      Generated {new Date().toLocaleString()} · NoLSAF Admin Portal
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      For internal administrative use only.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl p-10 text-center max-w-lg mx-auto">
                  <p className="text-sm text-gray-500">Failed to load receipt data. Please try again.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Commission Acknowledgement Modal */}
      {commissionMounted && commissionPayload && (
        <div className={`fixed inset-0 z-[60] ${commissionOpen ? "" : "pointer-events-none"}`}>
          <div
            className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${commissionOpen ? "opacity-100" : "opacity-0"}`}
            onClick={() => {
              if (commissionBusy) return;
              closeCommissionModal();
            }}
          />
          <div className="relative h-full w-full flex items-center justify-center p-3 sm:p-6">
            <div
              className={`relative w-full max-w-lg overflow-hidden rounded-2xl sm:rounded-3xl border border-white/30 shadow-2xl bg-gradient-to-b from-surface via-white to-brand-50 transition-all duration-200 ease-out ${
                commissionOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.98] translate-y-2"
              }`}
              role="dialog"
              aria-modal="true"
              aria-label="Commission acknowledgement"
            >
              <div className="relative overflow-hidden border-b border-white/40">
                <div className="absolute inset-0 bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500" />
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_20%,white,transparent_40%),radial-gradient(circle_at_80%_10%,white,transparent_35%),radial-gradient(circle_at_40%_90%,white,transparent_35%)]" />
                <div className="relative px-4 py-4 sm:px-6 sm:pt-6 sm:pb-5 flex items-start justify-between gap-3 text-white">
                  <div className="min-w-0 pr-2">
                    <div className="text-sm sm:text-lg font-semibold leading-snug break-words">Commission acknowledgement required</div>
                    <div className="mt-1 text-xs text-white/85 break-words">
                      {commissionPayload.message ||
                        "Before approving or paying this driver payout, you must acknowledge the NoLSAF commission deduction."}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (commissionBusy) return;
                      closeCommissionModal();
                    }}
                    className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-xl bg-white/15 border border-white/25 text-white hover:bg-white/20 transition disabled:opacity-60"
                    aria-label="Close"
                    title={commissionBusy ? "Processing..." : "Close"}
                    disabled={commissionBusy}
                  >
                    <X className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-6 space-y-4">
                <div className="rounded-2xl border border-gray-200/60 bg-white/80 p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] font-medium tracking-wide uppercase text-gray-500">Gross</div>
                      <div className="text-sm font-semibold text-gray-900">
                        {commissionPayload.currency} {Number(commissionPayload.grossAmount || 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium tracking-wide uppercase text-gray-500">Commission</div>
                      <div className="text-sm font-semibold text-gray-900">
                        {Number(commissionPayload.commissionPercent || 0)}% ({commissionPayload.currency}{" "}
                        {Number(commissionPayload.commissionAmount || 0).toLocaleString()})
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[11px] font-medium tracking-wide uppercase text-gray-500">Net To Driver</div>
                      <div className="text-sm font-semibold text-gray-900">
                        {commissionPayload.currency} {Number(commissionPayload.netPaid || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-gray-200/60 bg-white/70 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={commissionAck}
                    onChange={(e) => {
                      setCommissionAck(e.target.checked);
                      if (commissionError) setCommissionError(null);
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    disabled={commissionBusy}
                  />
                  <div className="text-sm text-gray-800">
                    I acknowledge the NoLSAF commission deduction ({Number(commissionPayload.commissionPercent || 0)}%) before approving.
                  </div>
                </label>

                {commissionError ? <div className="text-xs text-red-600">{commissionError}</div> : null}
              </div>

              <div className="px-4 py-4 sm:px-6 sm:py-5 border-t border-gray-200/60 bg-white/60 backdrop-blur flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (commissionBusy) return;
                    closeCommissionModal();
                  }}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-gray-300/80 text-gray-700 bg-white/80 hover:bg-white transition disabled:opacity-50"
                  disabled={commissionBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!commissionAck) {
                      setCommissionError("Please acknowledge the commission deduction to continue.");
                      return;
                    }
                    setCommissionBusy(true);
                    setCommissionError(null);
                    try {
                      const r = await submitPayoutAction("approve", true);
                      if (r && (r as any).ok) {
                        closeCommissionModal();
                      } else if (r && (r as any).needsAck) {
                        // still requires ack (unexpected), keep modal open
                      } else {
                        setCommissionError("Failed to update payout.");
                      }
                    } finally {
                      setCommissionBusy(false);
                    }
                  }}
                  disabled={commissionBusy || !commissionAck}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-brand-600 text-white bg-brand-600 hover:bg-brand-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {commissionBusy ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </span>
                  ) : (
                    "Approve payout"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

