"use client";

// NRMS reservations (doc 7.3, 7.4): list, create external/walk-in
// reservations, and run the stay lifecycle with payments and balances.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import TablePagination from "@/components/TablePagination";
import { AlertTriangle, ArrowUpDown, Check, ChevronDown, ChevronUp, Clock3, FileClock, Loader2, LockKeyhole, Plus, Printer, ReceiptText, Store, X } from "lucide-react";
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

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiClient.get<any>(`/api/owner/nrms/reservations/property/${selectedPropertyId}`, {
        params: {
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(sourceFilter ? { source: sourceFilter } : {}),
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
          sortBy,
          sortOrder,
        },
      });
      setReservations(r.data?.reservations ?? []);
      setTotalReservations(Number(r.data?.total ?? 0));
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
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-neutral-900">{reservation.guestProfile?.fullName ?? "Guest"}</div>
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
  onClose,
  children,
  wide,
  extraWide,
  elevated = false,
  closeOnEscape = true,
  compact = false,
}: {
  title: string;
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
        <div className={`flex shrink-0 items-center justify-between border-b border-neutral-100 ${compact ? "px-4 py-2.5" : "px-5 py-4 sm:px-6"}`}>
          <div className={compact ? "flex items-center gap-2.5" : ""}>
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS</p>
            {compact && <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />}
            <h3 className={`mb-0 font-bold tracking-tight text-neutral-950 ${compact ? "text-sm" : "mt-1 text-lg"}`}>{title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className={`flex items-center justify-center rounded-full border-0 bg-transparent text-neutral-500 shadow-none transition hover:bg-neutral-100 hover:text-neutral-900 ${compact ? "h-7 w-7" : "h-9 w-9"}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={compact ? "overflow-visible p-3" : "min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6"}>{children}</div>
      </div>
    </div>,
    document.body,
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

  useEffect(() => {
    apiClient
      .get<any>(`/api/owner/nrms/rooms/${propertyId}`)
      .then((r) => setRoomTypes(r.data?.roomTypes ?? []))
      .catch(() => setRoomTypes([]));
  }, [propertyId]);

  const type = roomTypes.find((t) => t.id === roomTypeId) || null;
  const activeUnits = type ? type.units.filter((u) => u.status === "ACTIVE") : [];
  const nights = nightsBetween(checkIn, checkOut);
  const calculatedTotal = type?.baseRate != null ? Number(type.baseRate) * nights : null;

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
    <ModalFrame title="New reservation" onClose={onClose} wide>
      <div className="space-y-5">
        <section>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">Guest details</h4>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Guest name <span className="text-red-500">*</span></span>
              <input required autoComplete="name" className={inputCls} value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Asha Kimaro" />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Phone number <span className="text-red-500">*</span></span>
              <input required type="tel" autoComplete="tel" className={inputCls} value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+255 700 000 000" />
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
        </section>

        <section className="border-t border-neutral-100 pt-5">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">Stay details</h4>
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
              <span className="mb-1.5 block font-medium text-neutral-700">Room <span className="font-normal text-neutral-400">(optional)</span></span>
              <select className={inputCls} value={roomUnitId} onChange={(e) => setRoomUnitId(e.target.value ? Number(e.target.value) : "")} disabled={!type}>
                <option value="">Assign later</option>
                {activeUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Adults</span>
              <input type="number" min={1} className={inputCls} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Total amount <span className="font-normal text-neutral-500">({type?.currency || "select a room type"})</span> <span className="text-red-500">*</span></span>
              <input
                required
                type="number"
                min={0}
                className={inputCls}
                value={total}
                onChange={(e) => {
                  setTotal(e.target.value);
                  setTotalManuallyEdited(true);
                }}
                placeholder="90000"
              />
              {type?.baseRate != null && (
                <span className="mt-1.5 block text-[11px] text-neutral-400">
                  {nights} {nights === 1 ? "night" : "nights"} × {type.currency} {Number(type.baseRate).toLocaleString()}. You can edit this total.
                </span>
              )}
            </label>
          </div>
        </section>

        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

        <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-neutral-100 bg-white/95 px-5 pb-5 pt-4 backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-6">
          <button
            type="button"
            onClick={submit}
            disabled={busy || !guestName.trim() || guestPhone.trim().length < 7 || !nationality.trim() || !checkIn || !checkOut || !roomTypeId || !total.trim()}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Saving reservation..." : "Create reservation"}
          </button>
        </div>
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
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservationId}/${action}`, body ?? {});
      await reload();
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Action failed");
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
