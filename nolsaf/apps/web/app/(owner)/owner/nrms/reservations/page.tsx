"use client";

// NRMS reservations (doc 7.3, 7.4): list, create external/walk-in
// reservations, and run the stay lifecycle with payments and balances.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import TablePagination from "@/components/TablePagination";
import { AlertTriangle, ArrowUpDown, BedDouble, CalendarDays, CalendarPlus, Check, ChevronDown, ChevronUp, CircleDollarSign, Clock3, FileClock, Globe2, History, Loader2, LockKeyhole, Mail, Minus, Phone, Plus, Printer, ReceiptText, Search, ShieldCheck, Store, UserRound, Users, WalletCards, X } from "lucide-react";
import { NRMS_CHARGE_CATEGORIES, NRMS_CHARGE_CATEGORY_LABELS } from "@nolsaf/shared";
import { useNrms } from "../_components/NrmsProvider";

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
  balance: number | null;
  cancelReason: string | null;
  guestProfile: { id: number; fullName: string; phone: string | null; nationality: string | null } | null;
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
  reservations: Array<{ id: number; status: string; source: string; checkIn: string; checkOut: string; currency: string; totalAmount: number | null; amountPaid?: number | null }>;
};

type ReservationGroup = {
  id: number;
  reference: string;
  name: string;
  notes: string | null;
  status: string;
  memberCount: number;
  members: Array<{
    id: number;
    status: string;
    checkIn: string;
    checkOut: string;
    guestProfile: { id: number; fullName: string; phone: string | null } | null;
    rooms: Array<{ roomUnitCode: string | null; roomTypeName: string | null }>;
  }>;
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

const SOURCES = ["WALK_IN", "PHONE", "DIRECT", "AIRBNB", "BOOKING_COM", "EXPEDIA", "OTHER"];
const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in",
  PHONE: "Phone",
  DIRECT: "Direct link",
  AIRBNB: "Airbnb",
  BOOKING_COM: "Booking.com",
  EXPEDIA: "Expedia",
  OTHER: "Other",
};
const SOURCE_STYLE: Record<string, { row: string; badge: string; dot: string }> = {
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
  const [groups, setGroups] = useState<ReservationGroup[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const [reservationResponse, groupResponse] = await Promise.all([
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
        apiClient.get<any>(`/api/owner/nrms/reservations/property/${selectedPropertyId}/groups`),
      ]);
      setReservations(reservationResponse.data?.reservations ?? []);
      setTotalReservations(Number(reservationResponse.data?.total ?? 0));
      setGroups(groupResponse.data?.groups ?? []);
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
    setSelectedGroupId(null);
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

      {(selectedIds.length > 0 || groups.length > 0) && (
        <section className="mb-4 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Users className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-neutral-900">Group operations</p>
                <p className="text-xs text-neutral-500">Coordinate party arrivals and departures while each room keeps its own checks.</p>
              </div>
            </div>
            {selectedIds.length >= 2 && (
              <button type="button" onClick={() => setShowCreateGroup(true)} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-bold text-white hover:bg-neutral-800">
                <Plus className="h-3.5 w-3.5" /> Create group from {selectedIds.length}
              </button>
            )}
          </div>
          {groups.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {groups.map((group) => (
                <button key={group.id} type="button" onClick={() => setSelectedGroupId(group.id)} className="min-w-[210px] rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-left transition hover:border-emerald-300 hover:bg-emerald-50">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-bold text-neutral-900">{group.name}</span>
                    <span className="shrink-0 text-[10px] font-bold text-emerald-700">{group.memberCount} rooms</span>
                  </span>
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-neutral-400">{group.reference} · {group.status.replace(/_/g, " ")}</span>
                </button>
              ))}
            </div>
          )}
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
                      checked={reservations.some((reservation) => !reservation.group) && reservations.filter((reservation) => !reservation.group).every((reservation) => selectedIds.includes(reservation.id))}
                      onChange={(event) => setSelectedIds(event.target.checked ? reservations.filter((reservation) => !reservation.group).map((reservation) => reservation.id) : [])}
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
                  const paymentMethod = paymentMethodSummary(reservation.payments);
                  const sourceStyle = SOURCE_STYLE[reservation.source] ?? DEFAULT_SOURCE_STYLE;
                  return (
                    <tr key={reservation.id} className={`transition-colors ${sourceStyle.row}`}>
                      <td className="px-3 py-3.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select ${reservation.guestProfile?.fullName ?? "reservation"}`}
                          checked={selectedIds.includes(reservation.id)}
                          disabled={Boolean(reservation.group)}
                          title={reservation.group ? `Already in ${reservation.group.name}` : "Select for a group"}
                          onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, reservation.id] : current.filter((id) => id !== reservation.id))}
                          className="h-4 w-4 accent-emerald-700 disabled:cursor-not-allowed disabled:opacity-35"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-neutral-900">{reservation.guestProfile?.fullName ?? "Guest"}</div>
                        {reservation.group && <button type="button" onClick={() => setSelectedGroupId(reservation.group!.id)} className="mt-1 cursor-pointer appearance-none border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-wide text-emerald-700 hover:underline">{reservation.group.name}</button>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium text-neutral-600">
                        {reservation.guestProfile?.phone ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-neutral-600">
                        {reservation.guestProfile?.nationality ?? "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-neutral-800">{fmtDate(reservation.checkIn)} – {fmtDate(reservation.checkOut)}</div>
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
                        {reservation.adults + reservation.children}<span className="ml-1 text-xs text-neutral-400">total</span>
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3.5 text-right font-semibold ${reservation.amountPaid != null && reservation.amountPaid > 0 ? "text-emerald-700" : "text-neutral-400"}`}>
                        {money(reservation.amountPaid, reservation.currency)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-center">
                        <span
                          title={paymentMethod.title}
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${paymentMethod.label === "Not recorded" ? "bg-neutral-100 text-neutral-400" : "bg-emerald-50 text-emerald-700"}`}
                        >
                          {paymentMethod.label}
                        </span>
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3.5 text-right font-semibold ${reservation.balance != null && reservation.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                        {reservation.balance != null && reservation.balance > 0 ? money(reservation.balance, reservation.currency) : "Paid in full"}
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
      {showCreateGroup && (
        <CreateReservationGroupModal
          propertyId={selectedPropertyId}
          reservationIds={selectedIds}
          reservations={reservations.filter((reservation) => selectedIds.includes(reservation.id))}
          onClose={() => setShowCreateGroup(false)}
          onSaved={async (groupId) => {
            setShowCreateGroup(false);
            setSelectedIds([]);
            await load();
            setSelectedGroupId(groupId);
          }}
        />
      )}
      {selectedGroupId && (
        <ReservationGroupModal
          groupId={selectedGroupId}
          onClose={() => setSelectedGroupId(null)}
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

function ModalFrame({
  title,
  subtitle,
  icon,
  footer,
  onClose,
  children,
  wide,
  extraWide,
  elevated = false,
  closeOnEscape = true,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  extraWide?: boolean;
  elevated?: boolean;
  closeOnEscape?: boolean;
  compact?: boolean;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeOnEscape, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={`fixed inset-0 ${elevated ? "z-[1100]" : "z-[1000]"} flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6`}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-neutral-950/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex w-full min-w-0 flex-col rounded-2xl border border-white/70 bg-white shadow-2xl ${compact ? "max-w-2xl overflow-hidden" : `max-h-[calc(100dvh-1.5rem)] overflow-hidden sm:max-h-[calc(100dvh-3rem)] ${extraWide ? "max-w-[980px]" : wide ? "max-w-2xl" : "max-w-md"}`}`}
      >
        <div className={`flex shrink-0 items-center justify-between gap-3 border-b border-neutral-100 ${compact ? "px-4 py-2.5" : "px-5 py-4 sm:px-6"}`}>
          {compact ? (
            <div className="flex items-center gap-2.5">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS</p>
              <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
              <h3 className="mb-0 text-sm font-bold tracking-tight text-neutral-950">{title}</h3>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              {icon && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white">{icon}</span>}
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS</p>
                <h3 className="mb-0 mt-0.5 text-lg font-bold tracking-tight text-neutral-950">{title}</h3>
                {subtitle && <p className="mb-0 mt-0.5 text-xs text-neutral-500">{subtitle}</p>}
              </div>
            </div>
          )}
          <button type="button" onClick={onClose} aria-label="Close dialog" className={`flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-neutral-500 shadow-none transition hover:bg-neutral-100 hover:text-neutral-900 ${compact ? "h-7 w-7" : "h-9 w-9"}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={compact ? "overflow-visible p-3" : "min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6"}>{children}</div>
        {footer && <div className="shrink-0 border-t border-neutral-100 bg-white px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function ReturningGuestMatches({
  guests,
  align = "left",
  onSelect,
}: {
  guests: GuestSearchResult[];
  align?: "left" | "right";
  onSelect: (guest: GuestSearchResult) => void;
}) {
  return (
    <span className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-20 mt-1 block w-[min(36rem,calc(100vw-3rem))] overflow-hidden rounded-md border border-neutral-300 bg-white shadow-[0_14px_35px_-18px_rgba(15,23,42,0.28)]`}>
      <span className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-800">Returning guests</span>
        <span className="rounded-sm border border-neutral-200 bg-neutral-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-600">{guests.length} match{guests.length === 1 ? "" : "es"}</span>
      </span>
      <span className="hidden border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500 sm:grid sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] sm:gap-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_auto]">
        <span>Guest</span>
        <span>Phone</span>
        <span>Nationality</span>
        <span className="hidden lg:block">Email</span>
        <span className="text-right">Stays</span>
      </span>
      {guests.map((guest, index) => (
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
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchingGuests(true);
      apiClient
        .get<any>(`/api/owner/nrms/guests/${propertyId}`, { params: { q: query, pageSize: 6 } })
        .then((response) => {
          if (cancelled) return;
          setGuestMatches(response.data?.guests ?? []);
          setShowGuestMatches(true);
        })
        .catch(() => {
          if (!cancelled) setGuestMatches([]);
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
    const spend = rows.reduce((sum, row) => sum + (row.totalAmount ?? 0), 0);
    const paid = rows.reduce((sum, row) => sum + (row.amountPaid ?? 0), 0);
    return { rows, spend, paid, balance: spend - paid, currency: rows[0]?.currency || "TZS", stays: rows.length };
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
      setError(e?.response?.data?.error || "Failed to create reservation");
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="New reservation"
      subtitle="Add a guest stay and assign a room"
      icon={<CalendarPlus className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-xs text-neutral-500">{nights} {nights === 1 ? "night" : "nights"}{type ? ` · ${type.name}` : ""}</p>
            <p className="mb-0 mt-0.5 text-base font-bold text-neutral-950">{total.trim() ? `${type?.currency || "TZS"} ${Number(total).toLocaleString()}` : "Total pending"}</p>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !guestName.trim() || guestPhone.trim().length < 7 || !nationality.trim() || !checkIn || !checkOut || !roomTypeId || !total.trim()}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Saving reservation..." : "Create reservation"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <section>
          <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500"><UserRound className="h-3.5 w-3.5" />Guest details</h4>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="relative block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Guest name <span className="text-red-500">*</span></span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  required
                  autoComplete="off"
                  className={`${inputCls} pl-9 pr-9`}
                  value={guestName}
                  onFocus={() => {
                    if (guestSearchField !== "name") setGuestMatches([]);
                    setGuestSearchField("name");
                    if (guestName.trim().length >= 2) setShowGuestMatches(true);
                  }}
                  onChange={(e) => {
                    clearReturningGuest();
                    setGuestSearchField("name");
                    setGuestName(e.target.value);
                  }}
                  placeholder="Search returning guest or enter a new name"
                />
                {searchingGuests && guestSearchField === "name" && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-600" />}
              </span>
              {showGuestMatches && guestSearchField === "name" && guestMatches.length > 0 && <ReturningGuestMatches guests={guestMatches} onSelect={(guest) => void openGuestPreview(guest)} />}
            </label>
            <label className="relative block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Phone number <span className="text-red-500">*</span></span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  required
                  type="tel"
                  autoComplete="off"
                  className={`${inputCls} pl-9 pr-9`}
                  value={guestPhone}
                  onFocus={() => {
                    if (guestSearchField !== "phone") setGuestMatches([]);
                    setGuestSearchField("phone");
                    if (guestPhone.trim().length >= 3) setShowGuestMatches(true);
                  }}
                  onChange={(e) => {
                    clearReturningGuest();
                    setGuestSearchField("phone");
                    setGuestPhone(e.target.value);
                  }}
                  placeholder="Search by phone or enter a new number"
                />
                {searchingGuests && guestSearchField === "phone" && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-600" />}
              </span>
              {showGuestMatches && guestSearchField === "phone" && guestMatches.length > 0 && <ReturningGuestMatches guests={guestMatches} align="right" onSelect={(guest) => void openGuestPreview(guest)} />}
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
                      <p className="mt-1 text-xs font-semibold text-neutral-800">{fmtDate(stay.checkIn)} – {fmtDate(stay.checkOut)}</p>
                      <p className="mt-0.5 text-[10px] text-neutral-500">{SOURCE_LABEL[stay.source] ?? stay.source}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="border-t border-neutral-100 pt-5">
          <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500"><CalendarDays className="h-3.5 w-3.5" />Stay details</h4>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
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
                        const rowBalance = Math.max(0, (row.totalAmount ?? 0) - (row.amountPaid ?? 0));
                        return (
                        <div key={row.id} className="grid gap-3 px-4 py-3.5 transition hover:bg-neutral-50 sm:grid-cols-[1fr_auto] sm:items-center">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500"><BedDouble className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2"><p className="m-0 text-xs font-bold text-neutral-900">{fmtDate(row.checkIn)} – {fmtDate(row.checkOut)}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${STATUS_CLS[row.status] ?? "bg-neutral-100 text-neutral-600"}`}>{row.status.replace(/_/g, " ")}</span></div>
                              <p className="mb-0 mt-1 text-[10px] text-neutral-500">{SOURCE_LABEL[row.source] ?? row.source}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-5 text-right sm:min-w-52">
                            <div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Stay total</p><p className="mb-0 mt-1 text-xs font-black text-neutral-900">{row.currency} {(row.totalAmount ?? 0).toLocaleString()}</p></div>
                            <div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">{rowBalance > 0 ? "Balance" : "Payment"}</p><p className={`mb-0 mt-1 text-xs font-black ${rowBalance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{rowBalance > 0 ? `${row.currency} ${rowBalance.toLocaleString()}` : "Settled"}</p></div>
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

function CreateReservationGroupModal({
  propertyId,
  reservationIds,
  reservations,
  onClose,
  onSaved,
}: {
  propertyId: number;
  reservationIds: number[];
  reservations: Reservation[];
  onClose: () => void;
  onSaved: (groupId: number) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (name.trim().length < 2) return setError("Enter a clear group name");
    setBusy(true);
    setError(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/reservations/property/${propertyId}/groups`, {
        name: name.trim(),
        notes: notes.trim() || null,
        reservationIds,
      });
      await onSaved(Number(response.data?.group?.id));
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to create reservation group");
      setBusy(false);
    }
  };

  return (
    <ModalFrame title="Create reservation group" onClose={onClose} wide>
      <div className="space-y-5">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 text-emerald-700" />
            <div>
              <p className="text-sm font-bold text-emerald-950">{reservationIds.length} reservations selected</p>
              <p className="mt-1 text-xs leading-5 text-emerald-800">The group coordinates arrival and departure. Each reservation keeps its own room, folio, payment checks and audit history.</p>
            </div>
          </div>
        </div>
        <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-neutral-700">Group name</span>
          <input className={inputCls} value={name} onChange={(event) => setName(event.target.value)} placeholder="Kilimanjaro delegation" autoFocus />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-neutral-700">Front-desk note <span className="font-normal text-neutral-400">(optional)</span></span>
          <textarea className="min-h-24 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Tour leader, arrival transport, shared preferences…" />
        </label>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Members</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {reservations.map((reservation) => (
              <div key={reservation.id} className="rounded-lg bg-white px-3 py-2 text-xs">
                <p className="font-bold text-neutral-900">{reservation.guestProfile?.fullName ?? "Guest"}</p>
                <p className="mt-0.5 text-neutral-500">{reservation.allocations?.map((allocation) => allocation.roomUnitCode || allocation.roomTypeName).filter(Boolean).join(", ") || "Room not assigned"} · {reservation.status.replace(/_/g, " ")}</p>
              </div>
            ))}
          </div>
        </div>
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="cursor-pointer appearance-none rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-bold text-neutral-600 transition hover:bg-neutral-50">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy || name.trim().length < 2} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create group
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}

type GroupPreviewMember = {
  reservation: ReservationGroup["members"][number];
  eligible: boolean;
  blockers: Array<{ code: string; message: string }>;
  requiredChargeIds: number[];
};

function ReservationGroupModal({ groupId, onClose, onChanged }: { groupId: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const [group, setGroup] = useState<ReservationGroup | null>(null);
  const [action, setAction] = useState<"CHECK_IN" | "CHECK_OUT">("CHECK_IN");
  const [preview, setPreview] = useState<GroupPreviewMember[] | null>(null);
  const [verifyCharges, setVerifyCharges] = useState(false);
  const [overrideRoomReadiness, setOverrideRoomReadiness] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const loadGroup = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<any>(`/api/owner/nrms/reservations/groups/${groupId}`);
      setGroup(response.data?.group ?? null);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load reservation group");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { void loadGroup(); }, [loadGroup]);
  useEffect(() => { setPreview(null); setResultMessage(null); }, [action, verifyCharges, overrideRoomReadiness]);

  const review = async () => {
    setBusy(true);
    setError(null);
    setResultMessage(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/reservations/groups/${groupId}/preview`, {
        action,
        verifyCharges,
        overrideRoomReadiness,
      });
      setPreview(response.data?.members ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to review group readiness");
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = action === "CHECK_IN" ? "check-in" : "check-out";
      const response = await apiClient.post<any>(`/api/owner/nrms/reservations/groups/${groupId}/${path}`, { verifyCharges, overrideRoomReadiness });
      const changed = Number(response.data?.changedCount ?? 0);
      const blocked = Number(response.data?.blockedCount ?? 0);
      setResultMessage(`${changed} reservation${changed === 1 ? "" : "s"} updated${blocked ? `; ${blocked} remained blocked` : ""}.`);
      setPreview(null);
      await loadGroup();
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to run the group operation");
    } finally {
      setBusy(false);
    }
  };

  const eligibleCount = preview?.filter((member) => member.eligible).length ?? 0;
  return (
    <ModalFrame title={group?.name || "Reservation group"} onClose={onClose} extraWide>
      {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div> : !group ? <p className="py-10 text-center text-sm text-neutral-500">Group not found.</p> : (
        <div className="space-y-5">
          <div className="grid gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">{group.reference}</p>
              <p className="mt-1 text-sm font-bold text-neutral-900">{group.memberCount} reservations · {group.status.replace(/_/g, " ")}</p>
              {group.notes && <p className="mt-1 text-xs text-neutral-500">{group.notes}</p>}
            </div>
            <div className="flex rounded-lg border border-neutral-200 bg-white p-1">
              <button type="button" onClick={() => setAction("CHECK_IN")} className={`rounded-md px-3 py-2 text-xs font-bold ${action === "CHECK_IN" ? "bg-emerald-700 text-white" : "text-neutral-500"}`}>Group check-in</button>
              <button type="button" onClick={() => setAction("CHECK_OUT")} className={`rounded-md px-3 py-2 text-xs font-bold ${action === "CHECK_OUT" ? "bg-emerald-700 text-white" : "text-neutral-500"}`}>Group checkout</button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-neutral-200">
            <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-neutral-400"><span>Guest and room</span><span>Status</span></div>
            <div className="divide-y divide-neutral-100">
              {group.members.map((member) => {
                const inspected = preview?.find((item) => item.reservation.id === member.id);
                return (
                  <div key={member.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-neutral-900">{member.guestProfile?.fullName ?? "Guest"}</p>
                      <p className="mt-0.5 text-xs text-neutral-500">{member.rooms.map((room) => room.roomUnitCode || room.roomTypeName).filter(Boolean).join(", ") || "Room not assigned"} · {fmtDate(member.checkIn)} – {fmtDate(member.checkOut)}</p>
                      {inspected && !inspected.eligible && <div className="mt-2 space-y-1">{inspected.blockers.map((blocker) => <p key={blocker.code} className="text-[11px] font-medium text-red-700">{blocker.message}</p>)}</div>}
                    </div>
                    <span className={`h-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${inspected ? inspected.eligible ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700" : STATUS_CLS[member.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                      {inspected ? inspected.eligible ? "Ready" : "Blocked" : member.status.replace(/_/g, " ")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {action === "CHECK_IN" && <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><input type="checkbox" checked={overrideRoomReadiness} onChange={(event) => setOverrideRoomReadiness(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-700" /><span><strong>Override housekeeping readiness</strong><br />Use only after staff physically confirm every blocked room.</span></label>}
            {action === "CHECK_OUT" && <label className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><input type="checkbox" checked={verifyCharges} onChange={(event) => setVerifyCharges(event.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-700" /><span><strong>I verified every active extra charge</strong><br />Required before group checkout can close charged folios.</span></label>}
          </div>
          {resultMessage && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{resultMessage}</p>}
          {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
            <button type="button" onClick={() => void review()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-bold text-neutral-700 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Review readiness</button>
            <button type="button" onClick={() => void execute()} disabled={busy || !preview || eligibleCount === 0} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Confirm {action === "CHECK_IN" ? "group check-in" : "group checkout"}{preview ? ` (${eligibleCount})` : ""}</button>
          </div>
        </div>
      )}
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
  const canPostCharges = r != null && ["CONFIRMED", "CHECKED_IN"].includes(r.status);
  const canPrintInvoice = r != null && ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(r.status);
  const actions: Array<{ key: string; label: string; show: boolean; disabled?: boolean }> = r
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
    <ModalFrame title={r ? `Reservation #${r.id}` : "Reservation"} onClose={onClose} closeOnEscape={!voidingCharge} extraWide>
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

          <section className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 sm:grid-cols-3">
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Room</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{money(r.totalAmount, r.currency)}</p>
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Folio extras</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{money(r.chargesTotal ?? 0, r.currency)}</p>
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Outlet paid</p>
              <p className={`mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums ${unclassifiedOutletPayments.length > 0 ? "text-amber-700" : "text-emerald-700"}`}>{money(settledAtOutletTotal, r.currency)}</p>
              {unclassifiedOutletPayments.length > 0 && <p className="mb-0 mt-0.5 text-[9px] font-semibold text-amber-700">Payment method missing</p>}
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Total spend</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{money(totalGuestSpend, r.currency)}</p>
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Total collected</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-emerald-700">{money(totalCollected, r.currency)}</p>
            </div>
            <div className={`min-w-0 px-3 py-3 ${r.balance != null && r.balance > 0 ? "bg-amber-50" : "bg-emerald-50"}`}>
              <p className={`m-0 text-[9px] font-bold uppercase tracking-[0.08em] ${r.balance != null && r.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>Amount due</p>
              <p className={`mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums ${r.balance != null && r.balance > 0 ? "text-amber-900" : "text-emerald-900"}`}>{r.balance != null && r.balance > 0 ? money(r.balance, r.currency) : "Paid in full"}</p>
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

          {!["CANCELLED", "EXPIRED", "NO_SHOW"].includes(r.status) && (
            <section className="rounded-xl border border-neutral-200 bg-white p-3">
              <div>
                <p className="m-0 text-xs font-bold text-neutral-900">Record a guest payment</p>
                <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">Enter only money actually received from the guest. Recording it reduces the outstanding folio balance.</p>
              </div>
              {paymentLocked ? (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  <LockKeyhole className="h-3.5 w-3.5" />
                  The folio is fully paid. Additional payment entry is locked.
                </div>
              ) : (
                <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
                  <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 sm:col-span-2 xl:col-span-6">
                    Amount received ({r.currency})
                    <input type="number" min={1} max={r.balance ?? undefined} disabled={busyAction === "payments"} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400" value={payAmount} onChange={(e) => { setPayAmount(e.target.value); setPayAmountManuallyEdited(true); }} placeholder={`Outstanding: ${money(r.balance, r.currency)}`} />
                  </label>
                  <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 xl:col-span-3">
                    How was it paid?
                    <select className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} disabled={busyAction === "payments"}>
                      <option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="BANK">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other method</option>
                    </select>
                  </label>
                  <button type="button" onClick={recordPayment} disabled={busyAction === "payments" || !payAmount} className="box-border inline-flex !h-10 w-full items-center justify-center rounded-lg border-0 bg-neutral-900 px-3 text-xs font-bold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 sm:col-span-2 xl:col-span-3">{busyAction === "payments" ? "Recording..." : "Record received payment"}</button>
                </div>
              )}
              {!paymentLocked && <p className="mb-0 mt-2 text-[10px] leading-4 text-neutral-500">The amount cannot exceed the current outstanding balance. Choose the method the guest actually used.</p>}
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
