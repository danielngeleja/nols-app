"use client";

// NRMS reservations (doc 7.3, 7.4): list, create external/walk-in
// reservations, and run the stay lifecycle with payments and balances.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import TablePagination from "@/components/TablePagination";
import { AlertTriangle, ArrowRight, ArrowUpDown, BedDouble, CalendarDays, CalendarPlus, Check, ChevronDown, ChevronUp, CircleDollarSign, Clock3, FileClock, Globe2, History, Loader2, LockKeyhole, Mail, Minus, Phone, Plus, Printer, ReceiptText, Search, ShieldCheck, Store, UserRound, Users, WalletCards } from "lucide-react";
import { NRMS_CHARGE_CATEGORIES, NRMS_CHARGE_CATEGORY_LABELS } from "@nolsaf/shared";
import { useNrms } from "../_components/NrmsProvider";
import ModalFrame from "../_components/NrmsModalFrame";

type Allocation = {
  id: number;
  roomTypeId: number;
  roomTypeName?: string;
  roomUnitId: number | null;
  roomUnitCode: string | null;
  status: string;
};

type Payment = {
  id: number;
  amount: number | null;
  currency: string;
  method: string;
  reference: string | null;
  voidedAt: string | null;
  createdAt: string;
};

type Charge = {
  id: number;
  category: string;
  description: string | null;
  amount: number | null;
  currency: string;
  voidedAt: string | null;
  voidReason?: string | null;
  createdAt: string;
  outletOrder?: {
    id: number;
    orderNumber: string;
    status: string;
    settlementMode: string;
    outlet: { id: number; name: string; type: string };
    items: Array<{ id: number; name: string; quantity: number; lineTotal: number | null }>;
  } | null;
};

type OutletOrder = {
  id: number;
  orderNumber: string;
  status: string;
  settlementMode: string;
  settlementMethod: string | null;
  currency: string;
  total: number | null;
  note: string | null;
  confirmedAt: string | null;
  servedAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  outlet: { id: number; name: string; type: string };
  settledBy: { fullName: string | null; name: string | null; email: string } | null;
  items: Array<{ id: number; name: string; quantity: number; lineTotal: number | null }>;
};

type Reservation = {
  id: number;
  bookingId: number | null;
  source: string;
  status: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  currency: string;
  totalAmount: number | null;
  amountPaid: number | null;
  chargesTotal: number | null;
  transferredToMaster: number;
  balance: number | null;
  agencySettlement: {
    billingMode: string;
    masterFolioReference: string;
    status: string;
    settled: boolean;
    settledAt: string | null;
    methods: string[];
  } | null;
  cancelReason: string | null;
  guestProfile: { id: number; fullName: string; phone: string | null; email: string | null; nationality: string | null } | null;
  marketplaceBooking: {
    id: number;
    status: string;
    guestName: string | null;
    guestPhone: string | null;
    guestEmail: string | null;
    nationality: string | null;
    sex: string | null;
    ageGroup: string | null;
    roomsQty: number;
    totalAmount: number | null;
    paymentStatus: string | null;
    paymentMethod: string | null;
  } | null;
  allocations?: Allocation[];
  payments?: Payment[];
  charges?: Charge[];
  outletOrders?: OutletOrder[];
  group: { id: number; reference: string; name: string; status: string } | null;
};

type GuestSearchResult = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  reservationCount: number;
  lastStay: { checkIn: string; checkOut: string; status: string } | null;
};

type GuestHistory = GuestSearchResult & {
  notes?: string | null;
  createdAt?: string | null;
  reservations: Array<{ id: number; bookingId: number | null; commercialManaged?: boolean; status: string; source: string; checkIn: string; checkOut: string; currency: string; totalAmount: number | null; amountPaid?: number | null; chargesTotal?: number; transferredToMaster?: number; balance?: number | null }>;
};

type RoomType = {
  id: number;
  name: string;
  baseRate: number | null;
  currency: string;
  units: Array<{ id: number; code: string; status: string }>;
};
type CreateDefaults = { checkIn?: string; roomTypeId?: number; roomUnitId?: number };
type SortField = "guest" | "phone" | "nationality" | "checkIn" | "source" | "adults" | "amountPaid" | "balance" | "status";
type SortOrder = "asc" | "desc";

const STATUS_CLS: Record<string, string> = {
  HELD: "bg-amber-50 text-amber-700",
  CONFIRMED: "bg-blue-50 text-blue-700",
  CHECKED_IN: "bg-emerald-50 text-emerald-700",
  CHECKED_OUT: "bg-neutral-100 text-neutral-600",
  CANCELLED: "bg-red-50 text-red-600",
  NO_SHOW: "bg-red-50 text-red-600",
  DRAFT: "bg-neutral-100 text-neutral-500",
  EXPIRED: "bg-neutral-100 text-neutral-500",
};

const MANUAL_CHARGE_CATEGORIES = NRMS_CHARGE_CATEGORIES.filter(
  (category) => category !== "RESTAURANT" && category !== "BAR",
);

const SOURCES = ["NOLSAF", "WALK_IN", "PHONE", "DIRECT", "AIRBNB", "BOOKING_COM", "EXPEDIA", "OTHER"];
const SOURCE_LABEL: Record<string, string> = {
  NOLSAF: "NoLSAF",
  WALK_IN: "Walk-in",
  PHONE: "Phone",
  DIRECT: "Direct link",
  AIRBNB: "Airbnb",
  BOOKING_COM: "Booking.com",
  EXPEDIA: "Expedia",
  OTHER: "Other",
};
const SOURCE_STYLE: Record<string, { row: string; badge: string; dot: string }> = {
  NOLSAF: {
    row: "bg-emerald-50/55 hover:bg-emerald-100/70",
    badge: "border-emerald-200 bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-600",
  },
  WALK_IN: {
    row: "bg-emerald-50/55 hover:bg-emerald-100/70",
    badge: "border-emerald-200 bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-500",
  },
  PHONE: {
    row: "bg-sky-50/60 hover:bg-sky-100/75",
    badge: "border-sky-200 bg-sky-100 text-sky-800",
    dot: "bg-sky-500",
  },
  DIRECT: {
    row: "bg-teal-50/60 hover:bg-teal-100/75",
    badge: "border-teal-200 bg-teal-100 text-teal-800",
    dot: "bg-teal-500",
  },
  AIRBNB: {
    row: "bg-rose-50/55 hover:bg-rose-100/70",
    badge: "border-rose-200 bg-rose-100 text-rose-800",
    dot: "bg-rose-500",
  },
  BOOKING_COM: {
    row: "bg-blue-50/60 hover:bg-blue-100/75",
    badge: "border-blue-200 bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
  },
  EXPEDIA: {
    row: "bg-amber-50/65 hover:bg-amber-100/80",
    badge: "border-amber-200 bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
  },
  OTHER: {
    row: "bg-violet-50/55 hover:bg-violet-100/70",
    badge: "border-violet-200 bg-violet-100 text-violet-800",
    dot: "bg-violet-500",
  },
};
const DEFAULT_SOURCE_STYLE = {
  row: "bg-neutral-50/40 hover:bg-neutral-100/70",
  badge: "border-neutral-200 bg-neutral-100 text-neutral-700",
  dot: "bg-neutral-400",
};
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile money",
  BANK: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};
const PAGE_SIZE = 10;

const inputCls =
  "h-11 w-full min-w-0 max-w-full box-border rounded-xl border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

function fmtDate(v: string): string {
  return new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fmtChargeTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Timestamp unavailable";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "--";
  return `${part("day")}/${part("month")}/${part("year")} · ${part("hour")}:${part("minute")}:${part("second")} EAT`;
}

function money(v: number | null, currency: string): string {
  return v == null ? "-" : `${currency} ${v.toLocaleString()}`;
}

function paymentMethodSummary(payments: Payment[] | undefined): { label: string; title: string } {
  const methods = [...new Set((payments ?? []).filter((payment) => !payment.voidedAt).map((payment) => PAYMENT_METHOD_LABEL[payment.method] ?? payment.method.replace(/_/g, " ").toLowerCase()))];
  if (methods.length === 0) return { label: "Not recorded", title: "No payment method recorded" };
  if (methods.length === 1) return { label: methods[0], title: methods[0] };
  return { label: "Mixed", title: methods.join(" + ") };
}

function reservationPaymentMethod(reservation: Reservation): { label: string; title: string; agency: boolean } {
  const guest = paymentMethodSummary(reservation.payments);
  const agency = reservation.agencySettlement;
  if (!agency) return { ...guest, agency: false };

  const agencyMethods = agency.methods.map((method) => PAYMENT_METHOD_LABEL[method] ?? method.replace(/_/g, " ").toLowerCase());
  const agencyMethod = agencyMethods.length === 0 ? "Master folio" : agencyMethods.length === 1 ? agencyMethods[0] : "Mixed";
  const state = agency.settled ? "settled" : "still due";
  if (guest.label === "Not recorded") {
    return {
      label: `Agency · ${agencyMethod}`,
      title: `${agency.masterFolioReference} · Agency bill ${state}${agencyMethods.length > 1 ? ` · ${agencyMethods.join(" + ")}` : ""}`,
      agency: true,
    };
  }
  return {
    label: "Guest + agency",
    title: `Guest: ${guest.title} · Agency: ${agencyMethod} (${agency.masterFolioReference}, ${state})`,
    agency: true,
  };
}

function staffLabel(user: OutletOrder["settledBy"]): string {
  return user?.fullName || user?.name || user?.email || "Staff member not recorded";
}

function chargeNeedsManualVerification(charge: Charge): boolean {
  return !(
    charge.outletOrder?.status === "POSTED_TO_FOLIO" &&
    charge.outletOrder?.settlementMode === "ROOM_FOLIO"
  );
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T00:00:00`).getTime();
  const end = new Date(`${checkOut}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
}

export default function NrmsReservationsPage() {
  const { selectedPropertyId } = useNrms();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [totalReservations, setTotalReservations] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("checkIn");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<CreateDefaults>({});
  const [selectedReservationId, setSelectedReservationId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const [reservationResponse] = await Promise.all([
        apiClient.get<any>(`/api/owner/nrms/reservations/property/${selectedPropertyId}`, {
          params: {
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(sourceFilter ? { source: sourceFilter } : {}),
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
            sortBy,
            sortOrder,
          },
        }),
      ]);
      setReservations(reservationResponse.data?.reservations ?? []);
      setTotalReservations(Number(reservationResponse.data?.total ?? 0));
      setSelectedIds((current) => current.filter((id) => (reservationResponse.data?.reservations ?? []).some((reservation: Reservation) => reservation.id === id)));
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load reservations");
    } finally {
      setLoading(false);
    }
  }, [page, selectedPropertyId, sortBy, sortOrder, sourceFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);


  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [selectedPropertyId]);

  const changeSort = (field: SortField) => {
    if (field === sortBy) setSortOrder((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortOrder(field === "checkIn" ? "desc" : "asc");
    }
    setPage(1);
  };

  const openReservation = (reservationId: number) => {
    setSelectedReservationId(reservationId);
    const url = new URL(window.location.href);
    url.searchParams.set("reservationId", String(reservationId));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const closeReservation = () => {
    setSelectedReservationId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("reservationId");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedReservationId = Number(params.get("reservationId"));
    if (Number.isInteger(requestedReservationId) && requestedReservationId > 0) {
      setSelectedReservationId(requestedReservationId);
    }

    if (params.get("create") !== "1") return;

    const roomTypeId = Number(params.get("roomTypeId"));
    const roomUnitId = Number(params.get("roomUnitId"));
    setCreateDefaults({
      checkIn: params.get("checkIn") || undefined,
      roomTypeId: Number.isInteger(roomTypeId) && roomTypeId > 0 ? roomTypeId : undefined,
      roomUnitId: Number.isInteger(roomUnitId) && roomUnitId > 0 ? roomUnitId : undefined,
    });
    setShowCreate(true);
    params.delete("create");
    params.delete("checkIn");
    params.delete("roomTypeId");
    params.delete("roomUnitId");
    const remainingQuery = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ""}`);
  }, []);

  if (!selectedPropertyId) {
    return <p className="text-sm text-neutral-500 py-10 text-center">Add a property first to manage reservations.</p>;
  }

  return (
    <div className="pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {Object.keys(STATUS_CLS).map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            aria-label="Filter by reservation source"
          >
            <option value="">All sources</option>
            {SOURCES.map((source) => <option key={source} value={source}>{SOURCE_LABEL[source] ?? source}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateDefaults({});
            setShowCreate(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-3 py-2"
        >
          <Plus className="w-4 h-4" /> New reservation
        </button>
      </div>

      {selectedIds.length > 0 && (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Users className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-bold text-emerald-950">{selectedIds.length} selected</p>
              <p className="m-0 mt-0.5 text-xs text-emerald-800">
                {selectedIds.length < 2 ? "Select at least two stays to work them as one party." : "Carry them over to Group reservations to create a group or add to an existing one."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSelectedIds([])} className="cursor-pointer rounded-lg border border-solid border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-100">Clear</button>
            <Link
              href={`/owner/nrms/groups?select=${selectedIds.join(",")}`}
              aria-disabled={selectedIds.length < 2}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold text-white no-underline transition ${selectedIds.length < 2 ? "pointer-events-none bg-emerald-700/40" : "bg-emerald-700 hover:bg-emerald-800"}`}
            >
              Continue to Group reservations <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-neutral-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      ) : reservations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white py-14 text-center">
          <p className="text-sm font-semibold text-neutral-700">No reservations found</p>
          <p className="mt-1 text-xs text-neutral-400">Record a walk-in, phone or external reservation to begin.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-30px_rgba(15,23,42,0.4)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-4 py-3" aria-label="Reservation source color legend">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Source colours</span>
            {SOURCES.map((source) => {
              const style = SOURCE_STYLE[source] ?? DEFAULT_SOURCE_STYLE;
              const active = sourceFilter === source;
              return (
                <button
                  key={source}
                  type="button"
                  onClick={() => {
                    setSourceFilter(active ? "" : source);
                    setPage(1);
                  }}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${style.badge} ${active ? "ring-2 ring-neutral-900/15 ring-offset-1" : "opacity-80 hover:opacity-100"}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                  {SOURCE_LABEL[source] ?? source}
                </button>
              );
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                  <th className="w-11 px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      aria-label="Select all ungrouped reservations on this page"
                      checked={reservations.some((reservation) => !reservation.group && reservation.bookingId == null) && reservations.filter((reservation) => !reservation.group && reservation.bookingId == null).every((reservation) => selectedIds.includes(reservation.id))}
                      onChange={(event) => setSelectedIds(event.target.checked ? reservations.filter((reservation) => !reservation.group && reservation.bookingId == null).map((reservation) => reservation.id) : [])}
                      className="h-4 w-4 accent-emerald-700"
                    />
                  </th>
                  <SortableHeader label="Guest" field="guest" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <SortableHeader label="Phone" field="phone" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <SortableHeader label="Nationality" field="nationality" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <SortableHeader label="Stay" field="checkIn" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <SortableHeader label="Source" field="source" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <th className="px-4 py-3">Room</th>
                  <SortableHeader label="Guests" field="adults" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} align="center" />
                  <SortableHeader label="Paid" field="amountPaid" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} align="right" />
                  <th className="px-4 py-3 text-center">Payment method</th>
                  <SortableHeader label="Amount due" field="balance" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} align="right" />
                  <SortableHeader label="Status" field="status" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} align="center" />
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {reservations.map((reservation) => {
                  const rooms = (reservation.allocations ?? [])
                    .map((allocation) => allocation.roomUnitCode ?? allocation.roomTypeName)
                    .filter(Boolean)
                    .join(", ");
                  const nights = nightsBetween(reservation.checkIn.slice(0, 10), reservation.checkOut.slice(0, 10));
                  const paymentMethod = reservationPaymentMethod(reservation);
                  const sourceStyle = SOURCE_STYLE[reservation.source] ?? DEFAULT_SOURCE_STYLE;
                  const isMarketplace = reservation.bookingId != null;
                  const agencySettlement = reservation.agencySettlement;
                  const agencyBillDue = Boolean(agencySettlement && !agencySettlement.settled);
                  const effectivePaid = Number(reservation.amountPaid ?? 0) + (agencySettlement?.settled ? Number(reservation.transferredToMaster ?? 0) : 0);
                  return (
                    <tr key={reservation.id} className={`transition-colors ${sourceStyle.row}`}>
                      <td className="px-3 py-3.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select ${reservation.guestProfile?.fullName ?? "reservation"}`}
                          checked={selectedIds.includes(reservation.id)}
                          disabled={Boolean(reservation.group) || isMarketplace}
                          title={reservation.group ? `Already in ${reservation.group.name}` : isMarketplace ? "NoLSAF bookings cannot be added to NRMS groups" : "Select for a group"}
                          onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, reservation.id] : current.filter((id) => id !== reservation.id))}
                          className="h-4 w-4 accent-emerald-700 disabled:cursor-not-allowed disabled:opacity-35"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-neutral-900">{reservation.guestProfile?.fullName ?? "Guest"}</div>
                        {reservation.group && <Link href="/owner/nrms/groups" className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-emerald-700 no-underline hover:underline">{reservation.group.name}</Link>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium text-neutral-600">
                        {reservation.guestProfile?.phone ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-neutral-600">
                        {reservation.guestProfile?.nationality ?? "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-neutral-800">{fmtDate(reservation.checkIn)} to {fmtDate(reservation.checkOut)}</div>
                        <div className="mt-0.5 text-xs text-neutral-400">{nights} {nights === 1 ? "night" : "nights"}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${sourceStyle.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${sourceStyle.dot}`} />
                          {SOURCE_LABEL[reservation.source] ?? reservation.source}
                        </span>
                      </td>
                      <td className="max-w-44 px-4 py-3.5">
                        <span className="block truncate font-medium text-neutral-700" title={rooms || "Unassigned"}>{rooms || "Unassigned"}</span>
                      </td>
                      <td className="px-4 py-3.5 text-center text-neutral-600">
                        {isMarketplace ? <>{reservation.marketplaceBooking?.roomsQty ?? 1}<span className="ml-1 text-xs text-neutral-400">room(s)</span></> : <>{reservation.adults + reservation.children}<span className="ml-1 text-xs text-neutral-400">total</span></>}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3.5 text-right font-semibold ${effectivePaid > 0 ? "text-emerald-700" : agencyBillDue ? "text-amber-700" : "text-neutral-400"}`}>
                        {isMarketplace ? "NoLSAF managed" : (
                          <>
                            <span className="block">{money(effectivePaid, reservation.currency)}</span>
                            {agencySettlement && (
                              <span className={`mt-0.5 block text-[9px] font-bold uppercase tracking-wide ${agencySettlement.settled ? "text-emerald-600" : "text-amber-600"}`}>
                                {agencySettlement.settled ? "Paid by agency" : "Agency payment pending"}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-center">
                        <span
                          title={paymentMethod.title}
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${paymentMethod.label === "Not recorded" ? "bg-neutral-100 text-neutral-400" : agencyBillDue ? "bg-amber-50 text-amber-700" : paymentMethod.agency ? "bg-teal-50 text-teal-700" : "bg-emerald-50 text-emerald-700"}`}
                        >
                          {isMarketplace ? (PAYMENT_METHOD_LABEL[reservation.marketplaceBooking?.paymentMethod ?? ""] ?? "NoLSAF") : paymentMethod.label}
                        </span>
                      </td>
                      <td
                        title={agencySettlement ? `${agencySettlement.masterFolioReference} · ${agencySettlement.settled ? "settled" : "payment outstanding"}` : undefined}
                        className={`whitespace-nowrap px-4 py-3.5 text-right font-semibold ${reservation.balance != null && reservation.balance > 0 || agencyBillDue ? "text-amber-700" : "text-emerald-700"}`}
                      >
                        {isMarketplace ? "NoLSAF managed" : reservation.balance != null && reservation.balance > 0 ? money(reservation.balance, reservation.currency) : agencyBillDue ? "Agency bill due" : "Paid in full"}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${STATUS_CLS[reservation.status] ?? "bg-neutral-100 text-neutral-500"}`}>
                          {reservation.status.replace(/_/g, " ").toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => openReservation(reservation.id)}
                          className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} pageSize={PAGE_SIZE} total={totalReservations} onPageChange={setPage} />
        </div>
      )}

      {showCreate && (
        <CreateReservationModal
          propertyId={selectedPropertyId}
          initialCheckIn={createDefaults.checkIn}
          initialRoomTypeId={createDefaults.roomTypeId}
          initialRoomUnitId={createDefaults.roomUnitId}
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            if (page === 1) await load();
            else setPage(1);
          }}
        />
      )}
      {selectedReservationId && (
        <ReservationDetailModal
          reservationId={selectedReservationId}
          onClose={closeReservation}
          onChanged={load}
        />
      )}
    </div>
  );
}

function SortableHeader({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
  align = "left",
}: {
  label: string;
  field: SortField;
  sortBy: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  align?: "left" | "center" | "right";
}) {
  const active = sortBy === field;
  const alignment = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <th
      className={`px-4 py-3 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`}
      aria-sort={active ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex w-full appearance-none items-center gap-1.5 ${alignment} !m-0 !border-0 !bg-transparent !p-0 !shadow-none !outline-none transition hover:text-emerald-700 focus-visible:text-emerald-700`}
      >
        <span>{label}</span>
        {active ? (
          sortOrder === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-neutral-300" />
        )}
      </button>
    </th>
  );
}

type BillingBlock = {
  status: string;
  title: string;
  detail: string;
  action: "PAY" | "STATUS" | "SUPPORT";
  outstanding: number;
  limit: number;
  currency: string;
};

/**
 * Shown in place of the plain error toast when the API refuses a new external
 * stay on billing grounds. The three blocking states need different copy and a
 * different destination, so the server sends both and this only renders them.
 */
function NrmsBillingBlockCard({ block }: { block: BillingBlock }) {
  const tone = block.status === "PAYMENT_REQUIRED"
    ? { border: "border-red-200", bg: "bg-red-50", chipBg: "bg-red-100", text: "text-red-700", Icon: AlertTriangle }
    : block.status === "PAYMENT_PENDING"
      ? { border: "border-amber-200", bg: "bg-amber-50", chipBg: "bg-amber-100", text: "text-amber-700", Icon: Clock3 }
      : { border: "border-neutral-200", bg: "bg-neutral-50", chipBg: "bg-neutral-100", text: "text-neutral-700", Icon: LockKeyhole };
  const chipLabel = block.status === "PAYMENT_REQUIRED" ? "Payment required" : block.status === "PAYMENT_PENDING" ? "Payment pending" : "Account closed";
  const amount = (value: number) => `${block.currency} ${Math.round(value).toLocaleString()}`;
  const overLimit = block.limit > 0 && block.outstanding > block.limit;
  const actionHref = block.action === "SUPPORT" ? "/owner/nrms/help" : "/owner/nrms/billing";
  const actionLabel = block.action === "PAY" ? `Pay ${amount(block.outstanding)} now` : block.action === "STATUS" ? "Check payment status" : "Contact support";
  return (
    <div role="alert" className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className={`border-b ${tone.border} ${tone.bg} px-4 py-3.5`}>
        <span className={`inline-flex items-center gap-1.5 rounded-full ${tone.chipBg} px-2.5 py-1 text-[11px] font-semibold ${tone.text}`}>
          <tone.Icon className="h-3.5 w-3.5" />{chipLabel}
        </span>
        <p className="mb-0 mt-2.5 text-sm font-semibold text-neutral-900">{block.title}</p>
        <p className="mb-0 mt-1 text-[13px] leading-relaxed text-neutral-600">{block.detail}</p>
      </div>
      <div className="px-4 py-3.5">
        {block.action === "PAY" && (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="mb-0 text-[11px] text-neutral-500">Outstanding balance</p>
                <p className="mb-0 mt-0.5 text-2xl font-semibold text-neutral-900">{amount(block.outstanding)}</p>
              </div>
              {block.limit > 0 && <p className="mb-0 text-[11px] text-neutral-500">Limit {amount(block.limit)}</p>}
            </div>
            {block.limit > 0 && (
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div className={`h-1.5 rounded-full ${overLimit ? "bg-red-600" : "bg-amber-500"}`} style={{ width: `${Math.min(100, (block.outstanding / block.limit) * 100)}%` }} />
              </div>
            )}
          </>
        )}
        <div className="mt-3.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p className="mb-0 text-xs font-semibold text-emerald-800">Still working normally</p>
          <p className="mb-0 mt-1 text-[11px] leading-relaxed text-emerald-700">Check-ins, checkouts, folio postings, outlet orders and every existing reservation are unaffected. Only opening a new external stay is paused.</p>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <a href={actionHref} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 text-[13px] font-semibold text-white no-underline">
            <WalletCards className="h-4 w-4" />{actionLabel}
          </a>
          <a href="/owner/nrms/billing" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 text-[13px] font-semibold text-neutral-700 no-underline">
            <ReceiptText className="h-4 w-4" />View statement
          </a>
        </div>
      </div>
    </div>
  );
}

function ReturningGuestMatches({
  guests,
  align = "left",
  loading = false,
  error = null,
  query = "",
  onSelect,
}: {
  guests: GuestSearchResult[];
  align?: "left" | "right";
  loading?: boolean;
  error?: string | null;
  query?: string;
  onSelect: (guest: GuestSearchResult) => void;
}) {
  // While a query is in flight the previous query's rows are stale, so they are
  // replaced by placeholders rather than left on screen looking like results.
  const showRows = !loading && !error && guests.length > 0;
  return (
    <span className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-20 mt-1 block w-[min(36rem,calc(100vw-3rem))] overflow-hidden rounded-md border border-neutral-300 bg-white shadow-[0_14px_35px_-18px_rgba(15,23,42,0.28)]`}>
      <span className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-800">Returning guests</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
          {loading ? <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Checking</> : error ? "Unavailable" : `${guests.length} match${guests.length === 1 ? "" : "es"}`}
        </span>
      </span>
      {loading && (
        <span className="block px-4 py-4" role="status" aria-live="polite">
          <span className="block h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <span className="block h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-emerald-200 via-emerald-500 to-emerald-200" />
          </span>
          <span className="mt-2 block text-[11px] text-neutral-500">Checking saved guest records…</span>
        </span>
      )}
      {!loading && error && <span className="block px-4 py-4 text-xs text-red-700">{error}</span>}
      {!loading && !error && guests.length === 0 && (
        <span className="block px-4 py-4 text-xs text-neutral-500">
          No returning guest matches {query ? <b className="font-semibold text-neutral-700">{query}</b> : "that search"}. Keep typing to register a new guest.
        </span>
      )}
      {showRows && <span className="hidden border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500 sm:grid sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] sm:gap-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_auto]">
        <span>Guest</span>
        <span>Phone</span>
        <span>Nationality</span>
        <span className="hidden lg:block">Email</span>
        <span className="text-right">Stays</span>
      </span>}
      {showRows && guests.map((guest, index) => (
        <button key={guest.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(guest)} className={`grid w-full cursor-pointer appearance-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 border-b px-4 py-3 text-left transition last:border-b-0 focus-visible:outline-none sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_auto] ${index % 3 === 0 ? "border-sky-100 bg-sky-50/75 hover:bg-sky-100 focus-visible:bg-sky-100" : index % 3 === 1 ? "border-amber-100 bg-amber-50/75 hover:bg-amber-100 focus-visible:bg-amber-100" : "border-violet-100 bg-violet-50/70 hover:bg-violet-100 focus-visible:bg-violet-100"}`}>
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-neutral-900">{guest.fullName}</span>
            <span className="block truncate text-[10px] text-neutral-400 sm:hidden">{guest.phone || "No contact recorded"}</span>
            <span className="hidden truncate font-mono text-[10px] text-neutral-400 sm:block">G-{String(guest.id).padStart(4, "0")}</span>
          </span>
          <span className="hidden min-w-0 truncate text-[11px] text-neutral-600 sm:block">{guest.phone || "Not recorded"}</span>
          <span className="hidden min-w-0 truncate text-[11px] text-neutral-600 sm:block">{guest.nationality || "Not recorded"}</span>
          <span className="hidden min-w-0 truncate text-[11px] text-neutral-600 lg:block">{guest.email || "Not recorded"}</span>
          <span className="shrink-0 text-right text-[10px] font-bold text-neutral-500">{guest.reservationCount} stay{guest.reservationCount === 1 ? "" : "s"}</span>
        </button>
      ))}
      <span className="block border-t border-neutral-200 bg-white px-4 py-2.5 text-[10px] font-medium text-neutral-500">Select a guest to review the full profile</span>
    </span>
  );
}

function CreateReservationModal({
  propertyId,
  initialCheckIn,
  initialRoomTypeId,
  initialRoomUnitId,
  onClose,
  onSaved,
}: {
  propertyId: number;
  initialCheckIn?: string;
  initialRoomTypeId?: number;
  initialRoomUnitId?: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const todayKey = localDateKey();
  const defaultCheckIn = initialCheckIn && initialCheckIn >= todayKey ? initialCheckIn : todayKey;
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [nationality, setNationality] = useState("");
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
  const [guestMatches, setGuestMatches] = useState<GuestSearchResult[]>([]);
  const [guestHistory, setGuestHistory] = useState<GuestHistory | null>(null);
  const [searchingGuests, setSearchingGuests] = useState(false);
  const [guestSearchError, setGuestSearchError] = useState<string | null>(null);
  const [billingBlock, setBillingBlock] = useState<BillingBlock | null>(null);
  const [showGuestMatches, setShowGuestMatches] = useState(false);
  const [guestSearchField, setGuestSearchField] = useState<"name" | "phone" | null>(null);
  const [source, setSource] = useState("WALK_IN");
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(() => shiftDate(defaultCheckIn, 1));
  const [roomTypeId, setRoomTypeId] = useState<number | "">(() => initialRoomTypeId ?? "");
  const [roomUnitId, setRoomUnitId] = useState<number | "">(() => initialRoomUnitId ?? "");
  const [adults, setAdults] = useState(1);
  const [total, setTotal] = useState<string>("");
  const [totalManuallyEdited, setTotalManuallyEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unitAvailability, setUnitAvailability] = useState<Record<number, boolean>>({});
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [previewGuest, setPreviewGuest] = useState<GuestSearchResult | null>(null);
  const [previewDetail, setPreviewDetail] = useState<GuestHistory | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    apiClient
      .get<any>(`/api/owner/nrms/rooms/${propertyId}`)
      .then((r) => setRoomTypes(r.data?.roomTypes ?? []))
      .catch(() => setRoomTypes([]));
  }, [propertyId]);

  useEffect(() => {
    const query = guestSearchField === "phone" ? guestPhone.trim() : guestSearchField === "name" ? guestName.trim() : "";
    const minimumLength = guestSearchField === "phone" ? 3 : 2;
    if (selectedGuestId || !guestSearchField || query.length < minimumLength) {
      setGuestMatches([]);
      setSearchingGuests(false);
      setGuestSearchError(null);
      return;
    }
    let cancelled = false;
    // Enter the loading state on the keystroke, not when the debounce fires.
    // Setting it inside the timer left the first 250ms with no feedback at all,
    // which reads as a dead input on anything slower than a local connection.
    setSearchingGuests(true);
    setGuestSearchError(null);
    setShowGuestMatches(true);
    const timer = window.setTimeout(() => {
      apiClient
        .get<any>(`/api/owner/nrms/guests/${propertyId}`, { params: { q: query, pageSize: 6 } })
        .then((response) => {
          if (cancelled) return;
          setGuestMatches(response.data?.guests ?? []);
          setShowGuestMatches(true);
        })
        .catch(() => {
          if (cancelled) return;
          setGuestMatches([]);
          setGuestSearchError("Guest search is unavailable right now. You can still type the name to create a new guest.");
        })
        .finally(() => {
          if (!cancelled) setSearchingGuests(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [guestName, guestPhone, guestSearchField, propertyId, selectedGuestId]);

  const openGuestPreview = async (guest: GuestSearchResult) => {
    setShowGuestMatches(false);
    setPreviewGuest(guest);
    setPreviewDetail(null);
    setPreviewLoading(true);
    try {
      const response = await apiClient.get<any>(`/api/owner/nrms/guests/${propertyId}/${guest.id}`);
      setPreviewDetail(response.data?.guest ?? { ...guest, reservations: [] });
    } catch {
      setPreviewDetail({ ...guest, reservations: [] });
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmPreviewGuest = () => {
    if (!previewGuest) return;
    const detail = previewDetail;
    setSelectedGuestId(previewGuest.id);
    setGuestName(detail?.fullName ?? previewGuest.fullName);
    setGuestPhone(detail?.phone ?? previewGuest.phone ?? "");
    setNationality(detail?.nationality ?? previewGuest.nationality ?? "");
    setGuestMatches([]);
    setShowGuestMatches(false);
    setGuestSearchField(null);
    setGuestHistory(detail ?? { ...previewGuest, reservations: [] });
    setPreviewGuest(null);
    setPreviewDetail(null);
  };

  const clearReturningGuest = () => {
    setSelectedGuestId(null);
    setGuestHistory(null);
  };

  const type = roomTypes.find((t) => t.id === roomTypeId) || null;
  const activeUnits = type ? type.units.filter((u) => u.status === "ACTIVE") : [];
  const nights = nightsBetween(checkIn, checkOut);
  const calculatedTotal = type?.baseRate != null ? Number(type.baseRate) * nights : null;
  const previewStats = useMemo(() => {
    const rows = previewDetail?.reservations ?? [];
    const spend = rows.reduce((sum, row) => sum + (row.totalAmount ?? 0) + (row.chargesTotal ?? 0), 0);
    const paid = rows.reduce((sum, row) => sum + (row.amountPaid ?? 0), 0);
    const balance = rows.reduce((sum, row) => sum + Math.max(0, row.balance ?? ((row.totalAmount ?? 0) + (row.chargesTotal ?? 0) - (row.amountPaid ?? 0) - (row.transferredToMaster ?? 0))), 0);
    return { rows, spend, paid, balance, currency: rows[0]?.currency || "TZS", stays: rows.length };
  }, [previewDetail]);

  useEffect(() => {
    if (!roomTypeId || !checkIn || !checkOut || checkOut <= checkIn) {
      setUnitAvailability({});
      return;
    }
    let cancelled = false;
    setLoadingAvailability(true);
    apiClient
      .get<any>(`/api/owner/nrms/rooms/${propertyId}/availability`, { params: { roomTypeId, checkIn, checkOut } })
      .then((r) => {
        if (cancelled) return;
        const map: Record<number, boolean> = {};
        for (const unit of r.data?.units ?? []) map[unit.id] = unit.available;
        setUnitAvailability(map);
      })
      .catch(() => {
        if (!cancelled) setUnitAvailability({});
      })
      .finally(() => {
        if (!cancelled) setLoadingAvailability(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, roomTypeId, checkIn, checkOut]);

  useEffect(() => {
    if (roomUnitId !== "" && unitAvailability[roomUnitId] === false) setRoomUnitId("");
  }, [roomUnitId, unitAvailability]);

  useEffect(() => {
    if (totalManuallyEdited) return;
    setTotal(calculatedTotal != null ? String(calculatedTotal) : "");
  }, [calculatedTotal, totalManuallyEdited]);

  const changeCheckIn = (nextCheckIn: string) => {
    setCheckIn(nextCheckIn);
    if (!checkOut || new Date(`${checkOut}T00:00:00`).getTime() <= new Date(`${nextCheckIn}T00:00:00`).getTime()) {
      setCheckOut(shiftDate(nextCheckIn, 1));
    }
  };

  const submit = async () => {
    if (!guestName.trim()) {
      setError("Guest name is required");
      return;
    }
    if (guestPhone.trim().length < 7) {
      setError("Enter a valid guest phone number");
      return;
    }
    if (!nationality.trim()) {
      setError("Guest nationality is required");
      return;
    }
    if (!checkIn || !checkOut) {
      setError("Check-in and check-out dates are required");
      return;
    }
    if (checkIn < localDateKey()) {
      setError("Past check-in dates are not allowed");
      return;
    }
    if (new Date(`${checkOut}T00:00:00`).getTime() <= new Date(`${checkIn}T00:00:00`).getTime()) {
      setError("Check-out must be after check-in");
      return;
    }
    if (!roomTypeId) {
      setError("Select a room type");
      return;
    }
    if (!total.trim() || !Number.isFinite(Number(total)) || Number(total) < 0) {
      setError("Enter the total reservation amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/property/${propertyId}`, {
        source,
        status: "CONFIRMED",
        checkIn,
        checkOut,
        adults,
        guest: {
          ...(selectedGuestId ? { guestProfileId: selectedGuestId } : {}),
          fullName: guestName.trim(),
          phone: guestPhone.trim(),
          nationality: nationality.trim(),
        },
        rooms: [{ roomTypeId: Number(roomTypeId), roomUnitId: roomUnitId === "" ? null : Number(roomUnitId) }],
        totalAmount: Number(total),
      });
      await onSaved();
    } catch (e: any) {
      const billing = e?.response?.status === 402 ? e?.response?.data?.billing : null;
      if (billing) { setBillingBlock(billing as BillingBlock); setError(null); }
      else setError(e?.response?.data?.error || "Failed to create reservation");
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="New reservation"
      subtitle="Add a guest stay and assign a room"
      icon={<CalendarPlus className="h-5 w-5" />}
      onClose={onClose}
      extraWide
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
              <Clock3 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.1em] text-neutral-400">Stay summary</p>
              <p className="mb-0 mt-0.5 truncate text-sm text-neutral-600">{nights} {nights === 1 ? "night" : "nights"}{type ? ` · ${type.name}` : " · Room not selected"}</p>
              <p className="mb-0 mt-0.5 text-lg font-semibold text-neutral-950">{total.trim() ? `${type?.currency || "TZS"} ${Number(total).toLocaleString()}` : "Total pending"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !guestName.trim() || guestPhone.trim().length < 7 || !nationality.trim() || !checkIn || !checkOut || !roomTypeId || !total.trim()}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-52"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Saving reservation..." : "Create reservation"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <section className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><UserRound className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h4 className="m-0 text-sm font-semibold text-neutral-900">Guest details</h4>
                <p className="mb-0 mt-0.5 text-xs text-neutral-500">Identity and primary contact information</p>
              </div>
            </div>
            <span className="text-[11px] text-neutral-400"><span className="text-red-500">*</span> Required fields</span>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="relative block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Guest name <span className="text-red-500">*</span></span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  required
                  autoComplete="off"
                  className={`${inputCls} pl-9 pr-3`}
                  value={guestName}
                  onFocus={() => {
                    if (guestSearchField !== "name") setGuestMatches([]);
                    setGuestSearchField("name");
                    if (guestName.trim().length >= 2) setShowGuestMatches(true);
                  }}
                  onBlur={() => setShowGuestMatches(false)}
                  onChange={(e) => {
                    clearReturningGuest();
                    setGuestSearchField("name");
                    setGuestName(e.target.value);
                  }}
                  placeholder="Search returning guest or enter a new name"
                />
              </span>
              {showGuestMatches && guestSearchField === "name" && !selectedGuestId && guestName.trim().length >= 2 && <ReturningGuestMatches guests={guestMatches} loading={searchingGuests} error={guestSearchError} query={guestName.trim()} onSelect={(guest) => void openGuestPreview(guest)} />}
            </label>
            <label className="relative block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Phone number <span className="text-red-500">*</span></span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  required
                  type="tel"
                  autoComplete="off"
                  className={`${inputCls} pl-9 pr-3`}
                  value={guestPhone}
                  onFocus={() => {
                    if (guestSearchField !== "phone") setGuestMatches([]);
                    setGuestSearchField("phone");
                    if (guestPhone.trim().length >= 3) setShowGuestMatches(true);
                  }}
                  onBlur={() => setShowGuestMatches(false)}
                  onChange={(e) => {
                    clearReturningGuest();
                    setGuestSearchField("phone");
                    setGuestPhone(e.target.value);
                  }}
                  placeholder="Search by phone or enter a new number"
                />
              </span>
              {showGuestMatches && guestSearchField === "phone" && !selectedGuestId && guestPhone.trim().length >= 3 && <ReturningGuestMatches guests={guestMatches} align="right" loading={searchingGuests} error={guestSearchError} query={guestPhone.trim()} onSelect={(guest) => void openGuestPreview(guest)} />}
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Nationality <span className="text-red-500">*</span></span>
              <input required autoComplete="country-name" className={inputCls} value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Tanzanian" />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Booking source</span>
              <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedGuestId && guestHistory && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <History className="mt-0.5 h-4 w-4 text-emerald-700" />
                  <div>
                    <p className="text-xs font-bold text-emerald-950">Returning guest profile selected</p>
                    <p className="mt-0.5 text-[11px] text-emerald-800">{guestHistory.reservations.length} previous reservation{guestHistory.reservations.length === 1 ? "" : "s"} at this property.</p>
                  </div>
                </div>
                <button type="button" onClick={clearReturningGuest} className="inline-flex shrink-0 cursor-pointer appearance-none items-center rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-900">Use a new guest</button>
              </div>
              {guestHistory.reservations.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {guestHistory.reservations.slice(0, 3).map((stay) => (
                    <div key={stay.id} className="rounded-lg border border-white bg-white/80 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{stay.status.replace(/_/g, " ")}</p>
                      <p className="mt-1 text-xs font-semibold text-neutral-800">{fmtDate(stay.checkIn)} to {fmtDate(stay.checkOut)}</p>
                      <p className="mt-0.5 text-[10px] text-neutral-500">{SOURCE_LABEL[stay.source] ?? stay.source}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 sm:p-5">
          <div className="mb-4 flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><CalendarDays className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h4 className="m-0 text-sm font-semibold text-neutral-900">Stay details</h4>
              <p className="mb-0 mt-0.5 text-xs text-neutral-500">Dates, room assignment and agreed pricing</p>
            </div>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Check-in <span className="text-red-500">*</span></span>
              <DatePickerField
                label="Check-in date"
                value={checkIn}
                onChangeAction={changeCheckIn}
                allowPast={false}
                twoMonths={false}
                widthClassName="w-full"
              />
            </div>
            <div className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Check-out <span className="text-red-500">*</span></span>
              <DatePickerField
                label="Check-out date"
                value={checkOut}
                onChangeAction={setCheckOut}
                min={checkIn ? shiftDate(checkIn, 1) : undefined}
                allowPast={false}
                twoMonths={false}
                widthClassName="w-full"
              />
            </div>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Room type <span className="text-red-500">*</span></span>
              <select
                className={inputCls}
                value={roomTypeId}
                onChange={(e) => {
                  setRoomTypeId(e.target.value ? Number(e.target.value) : "");
                  setRoomUnitId("");
                  setTotalManuallyEdited(false);
                }}
              >
                <option value="">Select room type</option>
                {roomTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">
                Room <span className="font-normal text-neutral-400">(optional{loadingAvailability ? ", checking availability..." : ""})</span>
              </span>
              <select className={inputCls} value={roomUnitId} onChange={(e) => setRoomUnitId(e.target.value ? Number(e.target.value) : "")} disabled={!type}>
                <option value="">Assign later</option>
                {activeUnits.map((u) => {
                  const occupied = unitAvailability[u.id] === false;
                  return (
                    <option key={u.id} value={u.id} disabled={occupied}>
                      {u.code}{occupied ? " (occupied)" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Adults</span>
              <div className="flex h-11 items-center justify-between rounded-xl border border-neutral-300 bg-white px-1.5">
                <button type="button" aria-label="Fewer adults" onClick={() => setAdults(Math.max(1, adults - 1))} disabled={adults <= 1} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                <span className="min-w-8 text-center text-sm font-bold text-neutral-900">{adults}</span>
                <button type="button" aria-label="More adults" onClick={() => setAdults(adults + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200"><Plus className="h-4 w-4" /></button>
              </div>
            </div>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Total amount <span className="text-red-500">*</span></span>
              <span className="flex h-11 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 transition focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15">
                <span className="shrink-0 text-sm font-bold text-neutral-500">{type?.currency || "TZS"}</span>
                <input
                  required
                  type="text"
                  inputMode="numeric"
                  className="h-full w-full min-w-0 border-0 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                  value={total}
                  onChange={(e) => {
                    setTotal(e.target.value.replace(/[^\d.]/g, ""));
                    setTotalManuallyEdited(true);
                  }}
                  placeholder="90,000"
                />
              </span>
              {type?.baseRate != null && (
                <span className="mt-1.5 block text-[11px] text-neutral-400">
                  {nights} {nights === 1 ? "night" : "nights"} × {type.currency} {Number(type.baseRate).toLocaleString()}. You can edit this total.
                </span>
              )}
            </label>
          </div>
        </section>

        {billingBlock && (
          <ModalFrame
            title="External stay paused"
            subtitle="The reservation was not created"
            icon={<WalletCards className="h-5 w-5" />}
            elevated
            onClose={() => setBillingBlock(null)}
          >
            <NrmsBillingBlockCard block={billingBlock} />
          </ModalFrame>
        )}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

        {previewGuest && (
          <ModalFrame
            title="Guest profile"
            subtitle="Review the guest identity and stay relationship before continuing"
            icon={<UserRound className="h-5 w-5" />}
            onClose={() => { setPreviewGuest(null); setPreviewDetail(null); }}
            elevated
            wide
            footer={
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2 text-xs text-neutral-500">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  <span>Using this profile keeps the new stay attached to the guest&apos;s existing history.</span>
                </div>
                <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
                  <button type="button" onClick={() => { setPreviewGuest(null); setPreviewDetail(null); }} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 text-sm font-bold text-neutral-700 transition hover:bg-neutral-50">Cancel</button>
                  <button type="button" onClick={confirmPreviewGuest} disabled={previewLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-6 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"><Check className="h-4 w-4" />Use this guest</button>
                </div>
              </div>
            }
          >
            {previewLoading ? (
              <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-neutral-400"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /><span className="text-xs">Loading guest relationship…</span></div>
            ) : (
              <div className="space-y-5">
                <section className="overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white">
                  <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-xl font-black text-white shadow-sm">
                        {(previewDetail?.fullName ?? previewGuest.fullName).split(/\s+/).slice(0, 2).map((name) => name[0]).join("").toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700"><History className="h-3 w-3" />Returning guest</span>
                        <h4 className="m-0 truncate text-xl font-black tracking-tight text-neutral-950 sm:text-2xl">{previewDetail?.fullName ?? previewGuest.fullName}</h4>
                        <p className="mb-0 mt-1 text-xs text-neutral-500">{previewDetail?.createdAt ? `Guest relationship since ${fmtDate(previewDetail.createdAt)}` : "Existing property guest profile"}</p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-emerald-100 bg-white/90 px-3 py-2 text-left sm:text-right">
                      <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Profile status</p>
                      <p className="mb-0 mt-1 flex items-center gap-1.5 text-xs font-bold text-emerald-700 sm:justify-end"><Check className="h-3.5 w-3.5" />Recognised guest</p>
                    </div>
                  </div>
                  <div className="grid border-t border-emerald-100 bg-white/70 sm:grid-cols-3">
                    <div className="flex items-center gap-3 border-b border-emerald-100 px-5 py-4 sm:border-b-0 sm:border-r"><BedDouble className="h-5 w-5 text-emerald-700" /><div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Recorded stays</p><p className="mb-0 mt-1 text-base font-black text-neutral-950">{previewStats.stays}</p></div></div>
                    <div className="flex items-center gap-3 border-b border-emerald-100 px-5 py-4 sm:border-b-0 sm:border-r"><CircleDollarSign className="h-5 w-5 text-emerald-700" /><div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Lifetime value</p><p className="mb-0 mt-1 text-base font-black text-neutral-950">{previewStats.currency} {previewStats.spend.toLocaleString()}</p></div></div>
                    <div className="flex items-center gap-3 px-5 py-4"><WalletCards className={`h-5 w-5 ${previewStats.balance > 0 ? "text-amber-600" : "text-emerald-700"}`} /><div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Open balance</p><p className={`mb-0 mt-1 text-base font-black ${previewStats.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{previewStats.currency} {Math.max(0, previewStats.balance).toLocaleString()}</p></div></div>
                  </div>
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between gap-3"><h4 className="m-0 text-xs font-bold uppercase tracking-[0.13em] text-neutral-500">Guest details</h4><span className="text-[10px] text-neutral-400">Property record</span></div>
                  <div className="grid overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 sm:grid-cols-3">
                    <div className="flex min-w-0 items-start gap-3 border-b border-neutral-200 p-4 sm:border-b-0 sm:border-r"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Phone</p><p className="mb-0 mt-1 truncate text-sm font-bold text-neutral-900">{previewDetail?.phone || previewGuest.phone || "Not recorded"}</p></div></div>
                    <div className="flex min-w-0 items-start gap-3 border-b border-neutral-200 p-4 sm:border-b-0 sm:border-r"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Email</p><p className="mb-0 mt-1 truncate text-sm font-bold text-neutral-900" title={previewDetail?.email || previewGuest.email || "Not recorded"}>{previewDetail?.email || previewGuest.email || "Not recorded"}</p></div></div>
                    <div className="flex min-w-0 items-start gap-3 p-4"><Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Nationality</p><p className="mb-0 mt-1 truncate text-sm font-bold text-neutral-900">{previewDetail?.nationality || previewGuest.nationality || "Not recorded"}</p></div></div>
                  </div>
                </section>

                {previewDetail?.notes && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950"><p className="m-0 font-bold">Front-desk note</p><p className="mb-0 mt-1 leading-5 text-amber-900">{previewDetail.notes}</p></div>}

                <section>
                  <div className="mb-2 flex items-end justify-between gap-3"><div><h4 className="m-0 text-xs font-bold uppercase tracking-[0.13em] text-neutral-500">Stay records</h4><p className="mb-0 mt-1 text-[11px] text-neutral-400">Most recent property reservations</p></div><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold text-neutral-600">{previewStats.rows.length} total</span></div>
                  {previewStats.rows.length ? (
                    <div className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
                      {previewStats.rows.slice(0, 8).map((row) => {
                        const rowBalance = Math.max(0, row.balance ?? ((row.totalAmount ?? 0) + (row.chargesTotal ?? 0) - (row.amountPaid ?? 0) - (row.transferredToMaster ?? 0)));
                        return (
                        <div key={row.id} className="grid gap-3 px-4 py-3.5 transition hover:bg-neutral-50 sm:grid-cols-[1fr_auto] sm:items-center">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500"><BedDouble className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2"><p className="m-0 text-xs font-bold text-neutral-900">{fmtDate(row.checkIn)} to {fmtDate(row.checkOut)}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${STATUS_CLS[row.status] ?? "bg-neutral-100 text-neutral-600"}`}>{row.status.replace(/_/g, " ")}</span></div>
                              <p className="mb-0 mt-1 text-[10px] text-neutral-500">{SOURCE_LABEL[row.source] ?? row.source}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-5 text-right sm:min-w-52">
                            <div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Stay total</p><p className="mb-0 mt-1 text-xs font-black text-neutral-900">{row.currency} {(row.totalAmount ?? 0).toLocaleString()}</p></div>
                            <div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">{row.commercialManaged ? "Payment" : rowBalance > 0 ? "Balance" : "Payment"}</p><p className={`mb-0 mt-1 text-xs font-black ${row.commercialManaged ? "text-emerald-700" : rowBalance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{row.commercialManaged ? "NoLSAF managed" : rowBalance > 0 ? `${row.currency} ${rowBalance.toLocaleString()}` : "Settled"}</p></div>
                          </div>
                        </div>
                      )})}
                    </div>
                  ) : (
                    <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center"><BedDouble className="mb-2 h-5 w-5 text-neutral-300" /><p className="m-0 text-xs font-bold text-neutral-600">No stay records yet</p><p className="mb-0 mt-1 text-[10px] text-neutral-400">This guest has no reservations recorded at this property.</p></div>
                  )}
                </section>
              </div>
            )}
          </ModalFrame>
        )}
      </div>
    </ModalFrame>
  );
}

function ReservationDetailModal({
  reservationId,
  onClose,
  onChanged,
}: {
  reservationId: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { selectedPropertyId } = useNrms();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomNotReady, setRoomNotReady] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payAmountManuallyEdited, setPayAmountManuallyEdited] = useState(false);
  const [payMethod, setPayMethod] = useState("CASH");
  const [chargeCategory, setChargeCategory] = useState<string>("LAUNDRY");
  const [chargeDescription, setChargeDescription] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [voidingCharge, setVoidingCharge] = useState<Charge | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [verifiedChargeIds, setVerifiedChargeIds] = useState<number[]>([]);
  const [tenderCorrections, setTenderCorrections] = useState<Record<number, string>>({});

  const reload = useCallback(async () => {
    const r = await apiClient.get<any>(`/api/owner/nrms/reservations/${reservationId}`);
    setReservation(r.data?.reservation ?? null);
  }, [reservationId]);

  useEffect(() => {
    reload().catch((e: any) => setError(e?.response?.data?.error || "Failed to load reservation"));
  }, [reload]);

  useEffect(() => {
    if (payAmountManuallyEdited) return;
    const balance = reservation?.balance;
    setPayAmount(balance != null && balance > 0 ? String(balance) : "");
  }, [payAmountManuallyEdited, reservation?.balance]);

  useEffect(() => {
    const activeIds = new Set((reservation?.charges ?? [])
      .filter((charge) => !charge.voidedAt && chargeNeedsManualVerification(charge))
      .map((charge) => charge.id));
    setVerifiedChargeIds((current) => current.filter((id) => activeIds.has(id)));
  }, [reservation]);

  const runAction = async (action: string, body?: Record<string, unknown>) => {
    setBusyAction(action);
    setError(null);
    setRoomNotReady(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservationId}/${action}`, body ?? {});
      await reload();
      await onChanged();
    } catch (e: any) {
      if (action === "check-in" && e?.response?.data?.code === "ROOM_NOT_READY") {
        setRoomNotReady(e?.response?.data?.error || "The assigned room has not been cleaned yet.");
      } else {
        setError(e?.response?.data?.error || "Action failed");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const recordPayment = async () => {
    if (!payAmount) return;
    setBusyAction("payments");
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservationId}/payments`, {
        amount: Number(payAmount),
        method: payMethod,
      });
      setPayAmount("");
      setPayAmountManuallyEdited(false);
      await reload();
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to record payment");
    } finally {
      setBusyAction(null);
    }
  };

  const classifyOutletTender = async (orderId: number) => {
    const method = tenderCorrections[orderId];
    if (!selectedPropertyId || !method) return;
    setBusyAction(`classify-tender-${orderId}`);
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/outlet-orders/${orderId}/classify`, { method });
      await reload();
      await onChanged();
      setTenderCorrections((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to classify the outlet payment method");
    } finally {
      setBusyAction(null);
    }
  };

  const postCharge = async () => {
    if (!chargeAmount) return;
    setBusyAction("charges");
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservationId}/charges`, {
        category: chargeCategory,
        description: chargeDescription.trim() || undefined,
        amount: Number(chargeAmount),
      });
      setChargeDescription("");
      setChargeAmount("");
      await reload();
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to post charge");
    } finally {
      setBusyAction(null);
    }
  };

  const openVoidCharge = (charge: Charge) => {
    setVoidReason("");
    setVoidError(null);
    setVoidingCharge(charge);
  };

  const closeVoidCharge = () => {
    if (busyAction === "void-charge") return;
    setVoidingCharge(null);
    setVoidReason("");
    setVoidError(null);
  };

  const submitVoidCharge = async () => {
    if (!voidingCharge || !voidReason.trim()) return;
    setBusyAction("void-charge");
    setVoidError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservationId}/charges/${voidingCharge.id}/void`, {
        reason: voidReason.trim(),
      });
      await reload();
      await onChanged();
      setVoidingCharge(null);
      setVoidReason("");
    } catch (e: any) {
      setVoidError(e?.response?.data?.error || "Failed to record the charge void");
    } finally {
      setBusyAction(null);
    }
  };

  const r = reservation;
  const isMarketplace = r?.bookingId != null;
  const paymentLocked = r?.balance != null && r.balance <= 0;
  const activeCharges = (r?.charges ?? []).filter((charge) => !charge.voidedAt);
  const chargesRequiringVerification = activeCharges.filter(chargeNeedsManualVerification);
  const outletVerifiedChargeCount = activeCharges.length - chargesRequiringVerification.length;
  const outletPaidOrders = (r?.outletOrders ?? []).filter((order) => order.settlementMode === "OUTLET_PAYMENT");
  const unclassifiedOutletPayments = outletPaidOrders.filter(
    (order) => order.status === "SETTLED" && !order.voidedAt && !order.settlementMethod,
  );
  const outletTenderTotals = outletPaidOrders
    .filter((order) => order.status === "SETTLED" && !order.voidedAt && order.settlementMethod)
    .reduce<Record<string, number>>((totals, order) => {
      const method = order.settlementMethod as string;
      totals[method] = (totals[method] ?? 0) + (order.total ?? 0);
      return totals;
    }, {});
  const settledAtOutletTotal = outletPaidOrders
    .filter((order) => order.status === "SETTLED" && !order.voidedAt)
    .reduce((sum, order) => sum + (order.total ?? 0), 0);
  const folioTotal = (r?.totalAmount ?? 0) + (r?.chargesTotal ?? 0);
  const totalGuestSpend = folioTotal + settledAtOutletTotal;
  const totalCollected = (r?.amountPaid ?? 0) + settledAtOutletTotal;
  const folioBalanceBlocked = r?.status === "CHECKED_IN" && (r.balance == null || Math.abs(r.balance) > 0.005);
  const chargesNeedVerification = r?.status === "CHECKED_IN" && chargesRequiringVerification.some((charge) => !verifiedChargeIds.includes(charge.id));
  const outletReconciliationBlocked = r?.status === "CHECKED_IN" && unclassifiedOutletPayments.length > 0;
  const checkoutBlocked = folioBalanceBlocked || chargesNeedVerification || outletReconciliationBlocked;
  const canPostCharges = r != null && !isMarketplace && ["CONFIRMED", "CHECKED_IN"].includes(r.status);
  const canPrintInvoice = r != null && !isMarketplace && ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(r.status);
  const actions: Array<{ key: string; label: string; show: boolean; disabled?: boolean }> = r
    && !isMarketplace
    ? [
        { key: "confirm", label: "Confirm", show: ["DRAFT", "HELD"].includes(r.status) },
        { key: "check-in", label: "Check in", show: r.status === "CONFIRMED" },
        { key: "check-out", label: folioBalanceBlocked ? "Settle balance first" : outletReconciliationBlocked ? "Classify outlet payments" : chargesNeedVerification ? "Verify every charge" : "Check out", show: r.status === "CHECKED_IN", disabled: checkoutBlocked },
        { key: "no-show", label: "No show", show: r.status === "CONFIRMED" },
        { key: "cancel", label: "Cancel", show: ["DRAFT", "HELD", "CONFIRMED"].includes(r.status) },
      ]
    : [];

  return (
    <>
    <ModalFrame title="Reservation" onClose={onClose} closeOnEscape={!voidingCharge} extraWide>
      {!r ? (
        <div className="flex justify-center py-10 text-neutral-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <section className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2">
              <div className="min-w-0">
                <div className="truncate font-bold text-neutral-900">{r.guestProfile?.fullName ?? "Guest"}</div>
                <div className="mt-0.5 text-[11px] text-neutral-500">
                  {fmtDate(r.checkIn)} to {fmtDate(r.checkOut)} · {SOURCE_LABEL[r.source] ?? r.source} · {r.adults} adult{r.adults === 1 ? "" : "s"}
                </div>
              </div>
              {r.allocations && r.allocations.length > 0 && (
                <div className="border-l border-neutral-200 pl-5">
                  <div className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">Room</div>
                  <div className="mt-0.5 text-xs font-semibold text-neutral-700">{r.allocations.filter((a) => a.status === "ACTIVE").map((a) => a.roomUnitCode ?? `Any ${a.roomTypeName ?? "room"}`).join(", ") || "None active"}</div>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canPrintInvoice && (
                <button
                  type="button"
                  onClick={() => window.open(`/api/owner/nrms/reservations/${r.id}/invoice.pdf`, "_blank", "noopener")}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print invoice
                </button>
              )}
              <span className={`text-[11px] font-medium rounded-full px-2.5 py-1 ${STATUS_CLS[r.status] ?? "bg-neutral-100 text-neutral-500"}`}>
                {r.status.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>
          </section>

          {isMarketplace && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div className="min-w-0">
                  <p className="m-0 text-xs font-bold">Connected NoLSAF marketplace booking #{r.marketplaceBooking?.id ?? r.bookingId}</p>
                  <p className="mb-0 mt-1 text-[11px] leading-5 text-emerald-800">Guest identity, dates and room allocation are synchronized into NRMS. Payment and stay-status changes remain managed by NoLSAF to prevent duplicate records.</p>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-emerald-900">
                    <span><strong>Phone:</strong> {r.guestProfile?.phone ?? "Not provided"}</span>
                    <span><strong>Email:</strong> {r.guestProfile?.email ?? "Not provided"}</span>
                    <span><strong>Nationality:</strong> {r.guestProfile?.nationality ?? "Not provided"}</span>
                    <span><strong>Sex:</strong> {r.marketplaceBooking?.sex ?? "Not provided"}</span>
                    <span><strong>Age group:</strong> {r.marketplaceBooking?.ageGroup ?? "Not provided"}</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 sm:grid-cols-3">
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">{isMarketplace ? "Booking value" : "Room"}</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{money(isMarketplace ? r.marketplaceBooking?.totalAmount ?? null : r.totalAmount, r.currency)}</p>
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">{isMarketplace ? "Payment record" : "Folio extras"}</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{isMarketplace ? (r.marketplaceBooking?.paymentStatus?.replace(/_/g, " ").toLowerCase() ?? "NoLSAF managed") : money(r.chargesTotal ?? 0, r.currency)}</p>
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">{isMarketplace ? "NRMS folio" : "Outlet paid"}</p>
              <p className={`mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums ${unclassifiedOutletPayments.length > 0 ? "text-amber-700" : "text-emerald-700"}`}>{isMarketplace ? "Read only" : money(settledAtOutletTotal, r.currency)}</p>
              {unclassifiedOutletPayments.length > 0 && <p className="mb-0 mt-0.5 text-[9px] font-semibold text-amber-700">Payment method missing</p>}
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">{isMarketplace ? "Rooms booked" : "Total spend"}</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{isMarketplace ? (r.marketplaceBooking?.roomsQty ?? 1) : money(totalGuestSpend, r.currency)}</p>
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">{isMarketplace ? "Payment method" : "Total collected"}</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-emerald-700">{isMarketplace ? (PAYMENT_METHOD_LABEL[r.marketplaceBooking?.paymentMethod ?? ""] ?? "NoLSAF managed") : money(totalCollected, r.currency)}</p>
            </div>
            <div className={`min-w-0 px-3 py-3 ${r.balance != null && r.balance > 0 && !isMarketplace ? "bg-amber-50" : "bg-emerald-50"}`}>
              <p className={`m-0 text-[9px] font-bold uppercase tracking-[0.08em] ${r.balance != null && r.balance > 0 && !isMarketplace ? "text-amber-700" : "text-emerald-700"}`}>{isMarketplace ? "Commercial owner" : "Amount due"}</p>
              <p className={`mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums ${r.balance != null && r.balance > 0 && !isMarketplace ? "text-amber-900" : "text-emerald-900"}`}>{isMarketplace ? "NoLSAF" : r.balance != null && r.balance > 0 ? money(r.balance, r.currency) : "Paid in full"}</p>
            </div>
          </section>

          {(canPostCharges || (r.charges && r.charges.length > 0) || outletPaidOrders.length > 0) && (
            <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <header className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white"><ReceiptText className="h-4 w-4" /></span>
                  <div className="min-w-0"><h3 className="m-0 text-xs font-bold text-neutral-900">Guest charges and outlet orders</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-500">Review every transaction linked to this stay before checkout.</p></div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {r.status === "CHECKED_IN" && unclassifiedOutletPayments.length > 0 && <span className="shrink-0 rounded-md bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">{unclassifiedOutletPayments.length} outlet payment {unclassifiedOutletPayments.length === 1 ? "method" : "methods"} required</span>}
                  {r.status === "CHECKED_IN" && chargesRequiringVerification.length > 0 && <span className={`shrink-0 rounded-md px-2.5 py-1 text-[10px] font-bold ${chargesNeedVerification ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{verifiedChargeIds.length} of {chargesRequiringVerification.length} manual charges verified</span>}
                  {r.status === "CHECKED_IN" && outletVerifiedChargeCount > 0 && <span className="shrink-0 rounded-md bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800">{outletVerifiedChargeCount} outlet {outletVerifiedChargeCount === 1 ? "charge" : "charges"} verified by workflow</span>}
                </div>
              </header>
              <div className="space-y-4 p-3">
              {outletPaidOrders.length > 0 && (
                <section className="space-y-2">
                  <div className="flex flex-wrap items-end justify-between gap-3 px-0.5">
                    <div>
                      <h4 className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">Outlet settlement register</h4>
                      <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Payment method, staff member and settlement time for every outlet order linked to this guest.</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {Object.entries(outletTenderTotals).map(([method, total]) => (
                        <span key={method} className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[9px] font-semibold text-neutral-600">
                          {PAYMENT_METHOD_LABEL[method] ?? method.replaceAll("_", " ")} <strong className="ml-1 tabular-nums text-neutral-900">{money(total, r.currency)}</strong>
                        </span>
                      ))}
                      {unclassifiedOutletPayments.length > 0 && <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-800">{unclassifiedOutletPayments.length} method required</span>}
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                    <div className="hidden grid-cols-[minmax(13rem,1.2fr)_minmax(12rem,1.1fr)_minmax(10rem,.8fr)_minmax(13rem,1fr)_8rem] gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:grid">
                      <span>Outlet and order</span><span>Items ordered</span><span>Settlement</span><span>Recorded</span><span className="text-right">Amount</span>
                    </div>
                  {outletPaidOrders.map((order) => {
                    const settled = order.status === "SETTLED" && !order.voidedAt;
                    const inactive = ["CANCELLED", "VOIDED"].includes(order.status) || Boolean(order.voidedAt);
                    const missingTender = settled && !order.settlementMethod;
                    const statusLabel = missingTender ? "Payment method required" : settled ? "Settlement recorded" : order.status === "PREPARING" ? "Preparing" : order.status === "CONFIRMED" ? "Awaiting service" : order.status.replaceAll("_", " ").toLowerCase();
                    const recordedAt = order.settledAt || order.confirmedAt || order.createdAt;
                    return (
                      <div key={`outlet-${order.id}`} className={`grid min-w-0 gap-3 border-b border-neutral-200 px-3 py-3 last:border-b-0 lg:grid-cols-[minmax(13rem,1.2fr)_minmax(12rem,1.1fr)_minmax(10rem,.8fr)_minmax(13rem,1fr)_8rem] lg:items-center ${inactive ? "bg-neutral-50 opacity-60" : missingTender ? "bg-amber-50/70" : settled ? "bg-emerald-50/40" : "bg-amber-50/60"}`}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${missingTender ? "bg-amber-100 text-amber-800" : settled ? "bg-emerald-100 text-emerald-800" : inactive ? "bg-neutral-200 text-neutral-500" : "bg-amber-100 text-amber-800"}`}><Store className="h-4 w-4" /></span>
                          <div className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Outlet and order</span><strong className={`block truncate text-xs ${inactive ? "text-neutral-400 line-through" : "text-neutral-800"}`}>{order.outlet.name}</strong><span className="mt-0.5 block truncate text-[10px] font-semibold text-neutral-500">{order.orderNumber}</span></div>
                        </div>
                        <div className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Items ordered</span><span className="mt-0.5 block text-[10px] leading-4 text-neutral-600">{order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}</span></div>
                        <div className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Settlement</span><div className="mt-1 flex flex-wrap gap-1 lg:mt-0"><span className={`rounded-md px-2 py-0.5 text-[9px] font-bold ${missingTender ? "bg-amber-200 text-amber-900" : settled ? "bg-emerald-100 text-emerald-800" : inactive ? "bg-neutral-200 text-neutral-500" : "bg-amber-100 text-amber-800"}`}>{statusLabel}</span>{settled && order.settlementMethod && <span className="rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-[9px] font-bold text-emerald-800">{PAYMENT_METHOD_LABEL[order.settlementMethod] ?? order.settlementMethod.replaceAll("_", " ")}</span>}</div><span className={`mt-1 block text-[9px] leading-4 ${missingTender ? "text-amber-800" : settled ? "text-emerald-700" : "text-amber-700"}`}>{missingTender ? "Method needed for reconciliation" : settled ? "Included in guest spend" : "Awaiting outlet completion"}</span></div>
                        <div className="min-w-0 text-[10px] text-neutral-500"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Recorded</span><time dateTime={recordedAt} title={`Recorded as ${new Date(recordedAt).toISOString()}`} className="mt-1 flex items-center gap-1 tabular-nums lg:mt-0"><Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />{fmtChargeTimestamp(recordedAt)}</time>{settled && <span className="mt-1 block truncate">By <strong className="font-semibold text-neutral-700">{staffLabel(order.settledBy)}</strong></span>}</div>
                        <div className="min-w-0 lg:text-right"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Amount</span><strong className={`mt-0.5 block whitespace-nowrap text-xs tabular-nums ${inactive ? "text-neutral-400 line-through" : settled ? "text-emerald-800" : "text-neutral-800"}`}>{money(order.total, order.currency)}</strong><span className="mt-0.5 block text-[9px] text-neutral-400">Outlet total</span></div>
                        {missingTender && (
                          <div className="grid gap-2 border-t border-amber-200 pt-2 sm:grid-cols-[minmax(0,1fr)_auto] lg:col-span-5">
                            <select value={tenderCorrections[order.id] ?? ""} onChange={(event) => setTenderCorrections((current) => ({ ...current, [order.id]: event.target.value }))} className="h-9 min-w-0 rounded-lg border border-amber-300 bg-white px-2.5 text-[10px] font-semibold text-neutral-700 outline-none focus:border-emerald-500" aria-label={`Payment method for ${order.orderNumber}`}>
                              <option value="">Select the payment method received</option>
                              <option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option>
                            </select>
                            <button type="button" onClick={() => void classifyOutletTender(order.id)} disabled={!tenderCorrections[order.id] || busyAction === `classify-tender-${order.id}`} className="h-9 rounded-lg border-0 bg-neutral-900 px-3 text-[10px] font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400">
                              {busyAction === `classify-tender-${order.id}` ? "Saving..." : "Save payment method"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </section>
              )}
              {r.charges && r.charges.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-end justify-between gap-3 px-0.5">
                    <div><h4 className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">Room folio charges</h4><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Outlet-posted charges are verified by their completed workflow. Only manual entries require front-desk confirmation.</p></div>
                    <div className="shrink-0 text-right"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400">Charges total</span><strong className="mt-0.5 block text-xs tabular-nums text-neutral-800">{money(r.chargesTotal ?? 0, r.currency)}</strong></div>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                    <div className="hidden min-w-0 grid-cols-[3rem_minmax(8rem,1fr)_minmax(13rem,1.4fr)_9.5rem_7rem_3.5rem] items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-neutral-400 md:grid">
                      <span>Control</span><span>Charge</span><span>Source or reference</span><span>Posted</span><span className="text-right">Amount</span><span className="text-right">Action</span>
                    </div>
                    <div className="divide-y divide-neutral-200">
                      {r.charges.map((c) => {
                        const checked = verifiedChargeIds.includes(c.id);
                        const needsManualVerification = !c.voidedAt && chargeNeedsManualVerification(c);
                        const workflowVerified = !c.voidedAt && !needsManualVerification;
                        const categoryLabel = NRMS_CHARGE_CATEGORY_LABELS[c.category as keyof typeof NRMS_CHARGE_CATEGORY_LABELS] ?? c.category.replace(/_/g, " ").toLowerCase();
                        return (
                          <div key={c.id} className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 md:grid-cols-[3rem_minmax(8rem,1fr)_minmax(13rem,1.4fr)_9.5rem_7rem_3.5rem] md:gap-3 ${c.voidedAt ? "bg-neutral-50 opacity-60" : checked || workflowVerified ? "bg-emerald-50/50" : "bg-white"}`}>
                            <div className="row-span-3 flex items-center md:row-auto">
                              {r.status === "CHECKED_IN" && needsManualVerification ? (
                                <label className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border ${checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white text-transparent hover:border-emerald-400"}`}>
                                  <input type="checkbox" checked={checked} onChange={(event) => setVerifiedChargeIds((current) => event.target.checked ? [...current, c.id] : current.filter((id) => id !== c.id))} aria-label={`Verify charge ${c.description || c.category}`} className="sr-only" />
                                  <Check className="h-3.5 w-3.5" />
                                </label>
                              ) : workflowVerified ? <span title="Verified by completed outlet workflow" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-emerald-100 text-emerald-700"><Check className="h-3.5 w-3.5" /></span> : <span className="text-[10px] font-bold text-neutral-400">—</span>}
                            </div>
                            <div className={`min-w-0 md:col-auto ${c.voidedAt ? "line-through" : ""}`}>
                              <span className="block truncate text-xs font-bold text-neutral-800">{categoryLabel}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-neutral-500">{c.description || "No description"}</span>
                            </div>
                            <div className="col-start-2 min-w-0 md:col-auto">
                              {c.outletOrder ? <><span className="block truncate text-[10px] font-bold text-neutral-700">{c.outletOrder.orderNumber} · {c.outletOrder.outlet.name}</span><span className="mt-0.5 block truncate text-[10px] text-neutral-400">{c.outletOrder.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}</span></> : <><span className="block text-[10px] font-bold text-neutral-600">Manual entry</span><span className="mt-0.5 block text-[10px] text-neutral-400">Front desk adjustment</span></>}
                            </div>
                            <time dateTime={c.createdAt} title={`Recorded as ${new Date(c.createdAt).toISOString()}`} className="col-start-2 flex items-center gap-1 whitespace-nowrap text-[10px] tabular-nums text-neutral-400 md:col-auto">
                              <Clock3 className="h-3 w-3" aria-hidden="true" />{fmtChargeTimestamp(c.createdAt)}
                            </time>
                            <span className={`col-start-3 row-start-1 whitespace-nowrap text-right text-xs font-bold tabular-nums md:col-auto md:row-auto ${c.voidedAt ? "line-through text-neutral-400" : "text-neutral-800"}`}>{money(c.amount, c.currency)}</span>
                            <div className="col-start-3 row-start-3 text-right md:col-auto md:row-auto">
                              {!c.voidedAt ? <button type="button" onClick={() => openVoidCharge(c)} disabled={busyAction != null} className="rounded-md border border-red-200 bg-white px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button> : <span className="text-[9px] font-bold uppercase text-red-500" title={c.voidReason || undefined}>Voided</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}
              {canPostCharges && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3">
                  <div>
                    <p className="m-0 text-xs font-bold text-neutral-900">Add a manual extra charge</p>
                    <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">Record a service or item that increased the guest&apos;s bill but was not already posted through a restaurant or bar order.</p>
                  </div>
                  <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 xl:col-span-3">
                      Charge category
                      <select
                        className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
                        value={chargeCategory}
                        onChange={(e) => setChargeCategory(e.target.value)}
                        disabled={busyAction === "charges"}
                      >
                        {MANUAL_CHARGE_CATEGORIES.map((category) => (
                          <option key={category} value={category}>{NRMS_CHARGE_CATEGORY_LABELS[category]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 xl:col-span-4">
                      What was provided?
                      <input type="text" maxLength={300} disabled={busyAction === "charges"} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400" value={chargeDescription} onChange={(e) => setChargeDescription(e.target.value)} placeholder="Example: Laundry service" />
                    </label>
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 xl:col-span-3">
                      Amount to add ({r.currency})
                      <input type="number" min={1} disabled={busyAction === "charges"} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} placeholder="0" />
                    </label>
                    <button type="button" onClick={postCharge} disabled={busyAction === "charges" || !chargeAmount} className="box-border inline-flex !h-10 w-full items-center justify-center rounded-lg border-0 bg-emerald-700 px-3 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 sm:col-span-2 xl:col-span-2">{busyAction === "charges" ? "Posting..." : "Add to folio"}</button>
                  </div>
                  <p className="mb-0 mt-2 text-[10px] leading-4 text-neutral-500">Restaurant and bar charges are posted automatically from Outlet Operations and cannot be entered manually here.</p>
                </div>
              )}
              </div>
            </section>
          )}

          {!isMarketplace && !["CANCELLED", "EXPIRED", "NO_SHOW"].includes(r.status) && (
            <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
              <header className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-emerald-100 bg-gradient-to-r from-emerald-50/90 to-white px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100">
                    <WalletCards className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-xs font-bold text-neutral-950">Record guest payment</p>
                    <p className="mb-0 mt-0.5 text-[10px] leading-4 text-neutral-500">Post money already received directly to this guest folio.</p>
                  </div>
                </div>
                <span className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[10px] font-bold text-emerald-800">
                  Outstanding&nbsp; {money(r.balance, r.currency)}
                </span>
              </header>
              {paymentLocked ? (
                <div className="m-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs font-semibold text-emerald-800">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700"><LockKeyhole className="h-3.5 w-3.5" /></span>
                  This folio is fully paid. Additional payment entry is locked.
                </div>
              ) : (
                <div className="p-4">
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500 sm:col-span-2 xl:col-span-5">
                      <span className="flex items-center justify-between gap-2"><span>Amount received</span><span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-600">{r.currency}</span></span>
                      <input type="number" inputMode="decimal" min={1} max={r.balance ?? undefined} disabled={busyAction === "payments"} className="mt-1.5 box-border !h-11 w-full min-w-0 appearance-none rounded-xl border border-neutral-200 bg-white px-3.5 py-0 text-base font-bold normal-case tracking-normal text-neutral-950 outline-none placeholder:text-xs placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={payAmount} onChange={(e) => { setPayAmount(e.target.value); setPayAmountManuallyEdited(true); }} placeholder="Enter amount" />
                    </label>
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500 xl:col-span-3">
                      Payment method
                      <span className="mt-1.5 block">
                        <select className="box-border !h-11 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3.5 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} disabled={busyAction === "payments"}>
                          <option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="BANK">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other method</option>
                        </select>
                      </span>
                    </label>
                    <button type="button" onClick={recordPayment} disabled={busyAction === "payments" || !payAmount} className="box-border inline-flex !h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none sm:col-span-2 xl:col-span-4">
                      {busyAction === "payments" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Recording payment...</> : <><CircleDollarSign className="h-4 w-4" />Confirm received payment</>}
                    </button>
                  </div>
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-neutral-50 px-3 py-2.5 text-[10px] leading-4 text-neutral-500">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span>The amount cannot exceed {money(r.balance, r.currency)}. Confirm the actual payment method before recording.</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {r.payments && r.payments.length > 0 && (
            <div className="text-xs text-neutral-500 space-y-1">
              {r.payments.map((p) => (
                <div key={p.id} className={`flex justify-between ${p.voidedAt ? "line-through text-neutral-300" : ""}`}>
                  <span>
                    {new Date(p.createdAt).toLocaleDateString()} · {p.method.replace(/_/g, " ").toLowerCase()}
                  </span>
                  <span>{money(p.amount, p.currency)}</span>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {roomNotReady && r.status === "CONFIRMED" && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
              <p className="m-0">{roomNotReady}</p>
              <button
                type="button"
                onClick={() => runAction("check-in", { overrideRoomReadiness: true })}
                disabled={busyAction != null}
                className="mt-2 inline-flex appearance-none items-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
              >
                Check in anyway
              </button>
            </div>
          )}

          {checkoutBlocked && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong>Checkout blocked.</strong>
                {folioBalanceBlocked && <p className="m-0 mt-1">Record the full outstanding payment or resolve the guest credit.</p>}
                {chargesNeedVerification && <p className="m-0 mt-1">Verify the {chargesRequiringVerification.length} manual room-folio {chargesRequiringVerification.length === 1 ? "charge" : "charges"} listed above. Charges posted through the completed outlet workflow are already verified.</p>}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {actions.filter((a) => a.show).map((a) => (
              <button
                type="button"
                key={a.key}
                onClick={() => runAction(a.key, a.key === "check-out" ? { verifiedChargeIds } : undefined)}
                disabled={busyAction != null || a.disabled}
                className={`rounded-lg text-xs font-semibold px-3 py-2 disabled:opacity-60 ${
                  a.key === "cancel" || a.key === "no-show"
                    ? "border border-red-200 text-red-600 hover:bg-red-50"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                }`}
              >
                {busyAction === a.key ? "Working..." : a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </ModalFrame>
    {voidingCharge && (
      <ModalFrame title="Void extra charge" onClose={closeVoidCharge} elevated compact>
        <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3">
          <div className="min-w-0 space-y-2">
            <div className="rounded-xl border border-red-100 bg-red-50/70 p-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <p className="truncate text-xs font-bold text-neutral-900">Charge being voided</p>
              </div>
              <p className="mt-2 truncate text-[11px] font-medium text-neutral-600">
                {NRMS_CHARGE_CATEGORY_LABELS[voidingCharge.category as keyof typeof NRMS_CHARGE_CATEGORY_LABELS] ?? voidingCharge.category.replace(/_/g, " ").toLowerCase()}
                {voidingCharge.description ? ` · ${voidingCharge.description}` : ""}
              </p>
              <p className="mt-1 text-sm font-extrabold text-neutral-900">{money(voidingCharge.amount, voidingCharge.currency)}</p>
              <p className="mt-0.5 text-[9px] tabular-nums leading-3 text-neutral-500">Posted {fmtChargeTimestamp(voidingCharge.createdAt)}</p>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[10px] leading-4 text-amber-900">
              <FileClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p>
                <span className="font-bold">Permanently recorded.</span> The original charge stays in audit history with your account, reason, and timestamp.
              </p>
            </div>
          </div>

          <div className="flex w-full min-w-0 max-w-full flex-col overflow-hidden">
            <label className="block w-full min-w-0 max-w-full text-xs">
              <span className="mb-1 block font-bold text-neutral-800">
                Reason for voiding <span className="text-red-500">*</span>
              </span>
              <textarea
                autoFocus
                required
                rows={3}
                maxLength={300}
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
                disabled={busyAction === "void-charge"}
                placeholder="Example: Charge entered twice"
                className="block w-full min-w-0 max-w-full box-border resize-none rounded-xl border border-neutral-300 bg-white px-2.5 py-2 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-red-400 focus:ring-2 focus:ring-red-500/10 disabled:bg-neutral-100"
              />
              <span className="mt-0.5 block text-right text-[9px] tabular-nums text-neutral-400">{voidReason.length}/300</span>
            </label>

            {voidError && <p role="alert" className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] text-red-700">{voidError}</p>}

            <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={closeVoidCharge}
                disabled={busyAction === "void-charge"}
                className="min-h-9 rounded-lg border border-neutral-300 bg-white px-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Keep charge
              </button>
              <button
                type="button"
                onClick={submitVoidCharge}
                disabled={busyAction === "void-charge" || !voidReason.trim()}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busyAction === "void-charge" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {busyAction === "void-charge" ? "Recording..." : "Record void"}
              </button>
            </div>
          </div>
        </div>
      </ModalFrame>
    )}
    </>
  );
}
