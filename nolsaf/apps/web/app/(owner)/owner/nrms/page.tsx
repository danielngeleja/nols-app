"use client";

// NRMS front desk (doc 7.4): today at a glance with one-tap check-in and
// check-out for external stays. Marketplace bookings keep their existing
// code-verified flow on the bookings page.
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BarChart3,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useNrms } from "./_components/NrmsProvider";

type Reservation = {
  id: number;
  status: string;
  source: string;
  checkIn: string;
  checkOut: string;
  currency: string;
  roomRate?: number | null;
  depositAmount?: number | null;
  totalAmount?: number | null;
  chargesTotal?: number | null;
  openOutletOrderCount?: number;
  amountPaid?: number | null;
  checkedInAt?: string | null;
  adults?: number;
  children?: number;
  balance: number | null;
  guestProfile: { fullName: string; phone?: string | null; nationality?: string | null } | null;
  allocations?: Array<{
    id: number;
    roomTypeId: number;
    roomTypeName?: string;
    roomUnitId: number | null;
    roomUnitCode: string | null;
    status: string;
  }>;
  payments?: Array<{
    id: number;
    amount: number | null;
    currency: string;
    method: string;
    reference?: string | null;
    note?: string | null;
    voidedAt?: string | null;
    createdAt: string;
  }>;
  charges?: Array<{
    id: number;
    category: string;
    description?: string | null;
    amount: number | null;
    currency: string;
    voidedAt?: string | null;
    outletOrder?: {
      orderNumber: string;
      outlet: { name: string };
      items: Array<{ id: number; name: string; quantity: number }>;
    } | null;
  }>;
};

type RoomTotals = {
  roomUnits: number;
  sellableUnits: number;
};

type RoomTypeOption = {
  id: number;
  name: string;
  units: Array<{ id: number; code: string; status: string }>;
};

type AttentionItem = {
  id: number;
  guest: string;
  room: string;
  checkOut: string;
  source: string;
  issues: Array<{ code: "ROOM" | "OVERDUE" | "BALANCE"; label: string }>;
};

const SOURCE_LABELS: Record<string, string> = {
  WALK_IN: "Walk-in",
  PHONE: "Phone",
  DIRECT: "Direct",
  AIRBNB: "Airbnb",
  BOOKING_COM: "Booking.com",
  EXPEDIA: "Expedia",
  OTHER: "Other",
};

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function roomsLabel(r: Reservation): string {
  const active = (r.allocations ?? []).filter((a) => a.status === "ACTIVE");
  const label = active.map((a) => a.roomUnitCode ?? a.roomTypeName).filter(Boolean).join(", ");
  return label || "Room not assigned";
}

function hasAssignedRoom(r: Reservation): boolean {
  return (r.allocations ?? []).some((allocation) => allocation.status === "ACTIVE" && Boolean(allocation.roomUnitCode));
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replaceAll("_", " ").toLowerCase();
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function shortDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function paymentMethodLabel(method: string): string {
  return method.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "G";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function hasOutstandingBalance(reservation: Reservation): boolean {
  return reservation.balance != null && reservation.balance > 0;
}

export default function NrmsFrontDeskPage() {
  const { selectedPropertyId } = useNrms();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [roomTotals, setRoomTotals] = useState<RoomTotals | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<{ reservation: Reservation; action: "check-in" | "check-out" } | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 14);
      const to = new Date();
      to.setDate(to.getDate() + 2);
      const [reservationResponse, roomsResponse] = await Promise.all([
        apiClient.get<any>(`/api/owner/nrms/reservations/property/${selectedPropertyId}`, {
          params: { from: from.toISOString(), to: to.toISOString(), limit: 200 },
        }),
        apiClient.get<any>(`/api/owner/nrms/rooms/${selectedPropertyId}`),
      ]);
      setReservations(reservationResponse.data?.reservations ?? []);
      setRoomTotals(roomsResponse.data?.totals ?? null);
      setRoomTypes(roomsResponse.data?.roomTypes ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load front desk");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = useMemo(() => new Date(), []);
  const arrivals = useMemo(
    () => reservations.filter((r) => r.status === "CONFIRMED" && sameDay(new Date(r.checkIn), today)),
    [reservations, today],
  );
  const departures = useMemo(
    () => reservations.filter((r) => r.status === "CHECKED_IN" && new Date(r.checkOut).getTime() <= new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime()),
    [reservations, today],
  );
  const inHouse = useMemo(() => reservations.filter((r) => r.status === "CHECKED_IN"), [reservations]);
  const totalRooms = roomTotals?.sellableUnits ?? roomTotals?.roomUnits ?? 0;
  const stayingRooms = Math.min(totalRooms, Math.max(0, inHouse.length - departures.length));
  const turnoverRooms = Math.min(departures.length, Math.max(0, totalRooms - stayingRooms));
  const arrivingRooms = Math.min(arrivals.length, Math.max(0, totalRooms - stayingRooms - turnoverRooms));
  const freeRooms = Math.max(0, totalRooms - stayingRooms - turnoverRooms - arrivingRooms);
  const tonightOccupied = Math.min(totalRooms, stayingRooms + arrivingRooms);
  const occupancyPercent = totalRooms > 0 ? Math.round((tonightOccupied / totalRooms) * 100) : 0;
  const attentionItems = useMemo(() => {
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const active = new Map<number, Reservation>();
    [...arrivals, ...inHouse].forEach((reservation) => active.set(reservation.id, reservation));

    return [...active.values()].flatMap<AttentionItem>((reservation) => {
      const guest = reservation.guestProfile?.fullName ?? "Guest";
      const issues: AttentionItem["issues"] = [];
      if (!hasAssignedRoom(reservation)) issues.push({ code: "ROOM", label: "Room assignment required" });
      if (new Date(reservation.checkOut).getTime() < startOfToday && reservation.status === "CHECKED_IN") {
        const overdueDays = Math.max(1, Math.floor((startOfToday - new Date(reservation.checkOut).getTime()) / 86_400_000));
        issues.push({ code: "OVERDUE", label: `${overdueDays} ${overdueDays === 1 ? "day" : "days"} past check-out` });
      }
      if (hasOutstandingBalance(reservation)) issues.push({ code: "BALANCE", label: `${reservation.currency} ${reservation.balance!.toLocaleString()} outstanding` });
      return issues.length > 0 ? [{ id: reservation.id, guest, room: roomsLabel(reservation), checkOut: reservation.checkOut, source: sourceLabel(reservation.source), issues }] : [];
    });
  }, [arrivals, inHouse, today]);

  const act = async (id: number, action: "check-in" | "check-out", verifiedChargeIds: number[] = []) => {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${id}/${action}`, action === "check-out" ? { verifiedChargeIds } : {});
      await load();
      setPendingAction(null);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const assignRoom = async (reservationId: number, allocationId: number, roomUnitId: number): Promise<boolean> => {
    setBusyId(reservationId);
    setError(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/reservations/${reservationId}/move-room`, {
        allocationId,
        roomUnitId,
        reason: "Assigned during front desk check-in review",
      });
      const updated: Reservation | undefined = response.data?.reservation;
      if (!updated) throw new Error("Room assignment did not return the updated reservation");
      setReservations((current) => current.map((reservation) => reservation.id === updated.id ? updated : reservation));
      setPendingAction((current) => current?.reservation.id === updated.id ? { ...current, reservation: updated } : current);
      return true;
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Room assignment failed");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  if (!selectedPropertyId) {
    return <p className="py-10 text-center text-sm text-neutral-500">Add a property first to use the front desk.</p>;
  }

  return (
    <div className="space-y-5 pb-10">
      <section className="relative min-h-[160px] overflow-hidden rounded-3xl bg-[#0d2f29] text-white shadow-[0_20px_45px_-34px_rgba(6,78,59,0.72)] sm:min-h-[170px]">
        <Image
          src="/images/nrms/front-desk-hero.png"
          alt="Hotel receptionist welcoming a guest at the front desk"
          fill
          priority
          sizes="(max-width: 768px) 100vw, 90vw"
          className="object-cover object-[68%_center] sm:object-center"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,39,34,0.72)_0%,rgba(7,39,34,0.35)_45%,rgba(7,39,34,0.04)_78%)]" aria-hidden="true" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(5,25,22,0.72)_0%,transparent_72%)]" aria-hidden="true" />

        <div className="relative flex min-h-[160px] items-end justify-end p-3 sm:min-h-[170px] sm:p-4">
          <div className="max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-1.5 shadow-lg shadow-black/10 backdrop-blur-md">
            <div className="flex w-max gap-1.5">
              <Link
                href="/owner/nrms/reservations?create=1"
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3.5 text-xs font-bold text-emerald-950 no-underline shadow-sm transition hover:bg-emerald-300 hover:text-emerald-950 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#12352f]"
              >
                <Plus className="h-4 w-4" />
                New reservation
              </Link>
              <Link
                href="/owner/nrms/calendar"
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 text-xs font-semibold text-white no-underline transition hover:bg-white/10 hover:text-white hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <CalendarDays className="h-4 w-4" />
                Room calendar
              </Link>
              <Link
                href="/owner/nrms/analytics"
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 text-xs font-semibold text-white no-underline transition hover:bg-white/10 hover:text-white hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <BarChart3 className="h-4 w-4" />
                Revenue &amp; analytics
              </Link>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-neutral-200 bg-white text-neutral-400">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          <span className="text-sm">Preparing today&apos;s front desk...</span>
        </div>
      ) : (
        <>
          <OccupancyOverview
            totalRooms={totalRooms}
            occupiedRooms={tonightOccupied}
            occupancyPercent={occupancyPercent}
            stayingRooms={stayingRooms}
            arrivingRooms={arrivingRooms}
            turnoverRooms={turnoverRooms}
            freeRooms={freeRooms}
            onRefresh={() => void load()}
          />

          <section aria-label="Today at a glance" className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-[0_14px_35px_-32px_rgba(15,23,42,0.45)]">
            <div className="grid min-w-[34rem] grid-cols-4 divide-x divide-neutral-100">
              <CompactStat label="Arrivals" value={arrivals.length} helper="expected" tone="emerald" />
              <CompactStat label="Departures" value={departures.length} helper="due today" tone="blue" />
              <CompactStat label="In house" value={inHouse.length} helper="staying now" tone="neutral" />
              <CompactStat label="Attention" value={attentionItems.length} helper="to resolve" tone="red" />
            </div>
          </section>

          <OperationList
            title="Arriving today"
            count={arrivals.length}
            countLabel="expected"
            icon={<ArrowDownToLine className="h-4 w-4" />}
            tone="emerald"
            emptyTitle="No arrivals expected today"
            emptyActionHref="/owner/nrms/reservations?create=1"
            emptyActionLabel="Add reservation"
          >
            {arrivals.map((reservation) => (
              <OperationRow
                key={reservation.id}
                reservation={reservation}
                actionLabel="Check in"
                actionTone="emerald"
                busy={busyId === reservation.id}
                onAction={() => {
                  setError(null);
                  setPendingAction({ reservation, action: "check-in" });
                }}
                detail={`${sourceLabel(reservation.source)} · check-in today`}
              />
            ))}
          </OperationList>

          <OperationList
            title="Checking out"
            count={departures.length}
            countLabel="due today"
            icon={<ArrowUpFromLine className="h-4 w-4" />}
            tone="blue"
            emptyTitle="No check-outs due today"
            emptyActionHref="/owner/nrms/reservations"
            emptyActionLabel="View reservations"
          >
            {departures.map((reservation) => (
              <OperationRow
                key={reservation.id}
                reservation={reservation}
                actionLabel="Check out"
                actionTone="dark"
                busy={busyId === reservation.id}
                onAction={() => {
                  setError(null);
                  setPendingAction({ reservation, action: "check-out" });
                }}
                detail={`Due ${shortDate(reservation.checkOut)}`}
                overdue={new Date(reservation.checkOut).getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()}
              />
            ))}
          </OperationList>

          {attentionItems.length > 0 && <AttentionPanel items={attentionItems} />}
        </>
      )}

      {pendingAction && (
        <StayActionModal
          reservation={pendingAction.reservation}
          action={pendingAction.action}
          roomTypes={roomTypes}
          busy={busyId === pendingAction.reservation.id}
          error={error}
          onClose={() => {
            if (busyId == null) setPendingAction(null);
          }}
          onConfirm={(verifiedChargeIds) => void act(pendingAction.reservation.id, pendingAction.action, verifiedChargeIds)}
          onAssignRoom={(allocationId, roomUnitId) => assignRoom(pendingAction.reservation.id, allocationId, roomUnitId)}
        />
      )}
    </div>
  );
}

function StayActionModal({
  reservation,
  action,
  roomTypes,
  busy,
  error,
  onClose,
  onConfirm,
  onAssignRoom,
}: {
  reservation: Reservation;
  action: "check-in" | "check-out";
  roomTypes: RoomTypeOption[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (verifiedChargeIds: number[]) => void;
  onAssignRoom: (allocationId: number, roomUnitId: number) => Promise<boolean>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [verifiedChargeIds, setVerifiedChargeIds] = useState<number[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | "">("");
  const isCheckIn = action === "check-in";
  const guestName = reservation.guestProfile?.fullName ?? "Guest";
  const room = roomsLabel(reservation);
  const balance = reservation.balance ?? 0;
  const paid = reservation.amountPaid ?? 0;
  const roomTotal = reservation.totalAmount ?? 0;
  const extraCharges = reservation.chargesTotal ?? 0;
  const total = roomTotal + extraCharges;
  const nights = Math.max(1, Math.round((new Date(reservation.checkOut).getTime() - new Date(reservation.checkIn).getTime()) / 86_400_000));
  const guests = (reservation.adults ?? 0) + (reservation.children ?? 0);
  const activePayments = (reservation.payments ?? []).filter((payment) => !payment.voidedAt && payment.amount != null);
  const checkedInTime = reservation.checkedInAt ? new Date(reservation.checkedInAt).getTime() : Number.NaN;
  const paidByCheckIn = Number.isFinite(checkedInTime)
    ? activePayments.reduce((sum, payment) => sum + (new Date(payment.createdAt).getTime() <= checkedInTime ? payment.amount ?? 0 : 0), 0)
    : 0;
  const paidAfterCheckIn = Math.max(0, paid - paidByCheckIn);
  const recentPayments = [...activePayments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);
  const openOutletOrderCount = reservation.openOutletOrderCount ?? 0;
  const hasOpenOutletOrders = !isCheckIn && openOutletOrderCount > 0;
  const folioUnsettled = !isCheckIn && Math.abs(balance) > 0.005;
  const activeCharges = (reservation.charges ?? []).filter((charge) => !charge.voidedAt);
  const chargesUnverified = !isCheckIn && activeCharges.some((charge) => !verifiedChargeIds.includes(charge.id));
  const checkoutBlocked = folioUnsettled || hasOpenOutletOrders || chargesUnverified;
  const noRoomAssigned = !hasAssignedRoom(reservation);
  const unassignedAllocation = (reservation.allocations ?? []).find((allocation) => allocation.status === "ACTIVE" && allocation.roomUnitId == null);
  const eligibleRooms = unassignedAllocation
    ? roomTypes.find((roomType) => roomType.id === unassignedAllocation.roomTypeId)?.units.filter((unit) => unit.status === "ACTIVE") ?? []
    : [];
  const actionLabel = isCheckIn ? "Confirm check-in" : "Confirm check-out";

  const handleAssignRoom = async () => {
    if (!unassignedAllocation || selectedRoomId === "") return;
    const assigned = await onAssignRoom(unassignedAllocation.id, Number(selectedRoomId));
    if (assigned) {
      setSelectedRoomId("");
      setAcknowledged(false);
    }
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-neutral-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="stay-action-title" className="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl border border-neutral-200 bg-white shadow-2xl sm:max-w-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-5 py-5 sm:px-7">
          <div>
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">NRMS · {isCheckIn ? "Check-in review" : "Check-out review"}</p>
            <h2 id="stay-action-title" className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">Reservation #{reservation.id}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close review" className="flex h-9 w-9 appearance-none items-center justify-center rounded-full border-0 bg-neutral-100 p-0 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">{initials(guestName)}</span>
            <div className="min-w-0 flex-1">
              <h3 className="m-0 truncate text-base font-bold text-neutral-950">{guestName}</h3>
              <p className="mb-0 mt-1 text-xs text-neutral-500">
                {sourceLabel(reservation.source)}{reservation.adults ? ` · ${reservation.adults} ${reservation.adults === 1 ? "adult" : "adults"}` : ""}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${isCheckIn ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}>
              {isCheckIn ? "Confirmed" : "In house"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 sm:grid-cols-4">
            <ModalFact label="Room" value={noRoomAssigned && room !== "Room not assigned" ? `${room} · unit unassigned` : room} warning={noRoomAssigned} />
            <ModalFact label="Stay" value={`${nights} ${nights === 1 ? "night" : "nights"}${guests ? ` · ${guests} ${guests === 1 ? "guest" : "guests"}` : ""}`} />
            <ModalFact label="Check-in" value={shortDate(reservation.checkIn)} />
            <ModalFact label="Check-out" value={shortDate(reservation.checkOut)} />
          </div>

          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white" aria-label="Guest account summary">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><WalletCards className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <h3 className="m-0 text-sm font-bold text-neutral-900">Guest account</h3>
                  <p className="mb-0 mt-0.5 text-[10px] text-neutral-500">Stay charges and recorded payments</p>
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide ${Math.abs(balance) <= 0.005 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                {Math.abs(balance) <= 0.005 ? "Settled" : "Action required"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-px bg-neutral-200">
              <AccountAmount label="Room stay" value={roomTotal} currency={reservation.currency} />
              <AccountAmount label="Extra services" value={extraCharges} currency={reservation.currency} />
              <AccountAmount label="Total bill" value={total} currency={reservation.currency} strong />
            </div>

            <div className="grid grid-cols-2 gap-px border-t border-neutral-200 bg-neutral-200 sm:grid-cols-4">
              <AccountAmount label="Paid by check-in" value={paidByCheckIn} currency={reservation.currency} positive />
              <AccountAmount label="Paid after check-in" value={paidAfterCheckIn} currency={reservation.currency} positive />
              <AccountAmount label="Total paid" value={paid} currency={reservation.currency} positive strong />
              <AccountAmount
                label={balance < -0.005 ? "Guest credit" : "Balance"}
                value={balance}
                currency={reservation.currency}
                warning={Math.abs(balance) > 0.005}
                zeroLabel="Paid in full"
                strong
              />
            </div>

            {(reservation.depositAmount ?? 0) > 0 && (
              <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-2 text-[10px] text-neutral-500">
                Required deposit: <strong className="text-neutral-700">{reservation.currency} {(reservation.depositAmount ?? 0).toLocaleString()}</strong>
              </div>
            )}

            {recentPayments.length > 0 && (
              <div className="border-t border-neutral-100 px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Latest recorded payments</p>
                  {activePayments.length > recentPayments.length && <span className="text-[10px] text-neutral-400">+{activePayments.length - recentPayments.length} more</span>}
                </div>
                <div className="space-y-1.5">
                  {recentPayments.map((payment) => (
                    <div key={payment.id} className="flex min-w-0 items-center gap-3 rounded-lg bg-neutral-50 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-[11px] font-semibold text-neutral-800">
                          {paymentMethodLabel(payment.method)}{payment.reference ? ` · ${payment.reference}` : ""}
                        </p>
                        <p className="mb-0 mt-0.5 text-[9px] text-neutral-400">{shortDateTime(payment.createdAt)}</p>
                      </div>
                      <strong className="shrink-0 text-xs tabular-nums text-emerald-700">{payment.currency} {(payment.amount ?? 0).toLocaleString()}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {!isCheckIn && activeCharges.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white" aria-label="Extra charge verification">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
                <div><h3 className="m-0 text-sm font-bold text-neutral-900">Verify room-folio charges</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-500">Only charges added to the room folio require confirmation. Outlet-paid orders are already settled.</p></div>
                <span className={`shrink-0 text-[10px] font-bold ${chargesUnverified ? "text-amber-700" : "text-emerald-700"}`}>{verifiedChargeIds.length}/{activeCharges.length}</span>
              </div>
              <div className="divide-y divide-neutral-100">
                {activeCharges.map((charge) => {
                  const checked = verifiedChargeIds.includes(charge.id);
                  return <label key={charge.id} className={`flex min-w-0 cursor-pointer items-start gap-3 px-4 py-3 transition ${checked ? "bg-emerald-50/50" : "bg-white hover:bg-neutral-50"}`}>
                    <input type="checkbox" checked={checked} onChange={(event) => setVerifiedChargeIds((current) => event.target.checked ? [...current, charge.id] : current.filter((id) => id !== charge.id))} className="box-border mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-emerald-700 focus:ring-emerald-600" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-neutral-800">{charge.description || charge.category.replaceAll("_", " ").toLowerCase()}</span>{charge.outletOrder && <span className="mt-0.5 block truncate text-[10px] text-neutral-400">{charge.outletOrder.orderNumber} · {charge.outletOrder.outlet.name} · {charge.outletOrder.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}</span>}</span>
                    <strong className="shrink-0 text-xs tabular-nums text-neutral-900">{charge.currency} {(charge.amount ?? 0).toLocaleString()}</strong>
                  </label>;
                })}
              </div>
            </section>
          )}

          {isCheckIn && noRoomAssigned && (
            <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                <div>
                  <p className="m-0 text-sm font-bold text-red-900">Assign a room before check-in</p>
                  <p className="mb-0 mt-1 text-xs leading-5 text-red-700">
                    Select an active {unassignedAllocation?.roomTypeName ?? "room"} unit. Availability is verified when you assign it.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedRoomId}
                  onChange={(event) => setSelectedRoomId(event.target.value ? Number(event.target.value) : "")}
                  disabled={busy || eligibleRooms.length === 0}
                  aria-label="Select room to assign"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-red-200 bg-white px-3 text-sm font-semibold text-neutral-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 disabled:bg-neutral-100 disabled:text-neutral-400"
                >
                  <option value="">{eligibleRooms.length > 0 ? "Select an available room" : "No active rooms configured"}</option>
                  {eligibleRooms.map((unit) => <option key={unit.id} value={unit.id}>{unit.code}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => void handleAssignRoom()}
                  disabled={busy || selectedRoomId === ""}
                  className="inline-flex min-h-11 appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BedDouble className="h-4 w-4" />}
                  {busy ? "Assigning..." : "Assign room"}
                </button>
              </div>
            </div>
          )}

          {(checkoutBlocked || (noRoomAssigned && !isCheckIn)) && (
            <div className={`rounded-xl border px-4 py-3 text-xs leading-5 ${checkoutBlocked ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              {noRoomAssigned && !isCheckIn && <p className="m-0 font-bold">This stay does not have a room unit assigned.</p>}
              {folioUnsettled && (
                <div className={noRoomAssigned ? "mt-1" : ""}>
                  <p className="m-0 font-bold">Checkout blocked. The guest folio is not settled.</p>
                  <p className="mb-0 mt-1">
                    {balance > 0
                      ? <>Collect and record the remaining <strong>{reservation.currency} {balance.toLocaleString()}</strong> before checkout.</>
                      : <>Resolve the guest credit of <strong>{reservation.currency} {Math.abs(balance).toLocaleString()}</strong> before checkout.</>}
                  </p>
                </div>
              )}
              {hasOpenOutletOrders && (
                <div className={noRoomAssigned || folioUnsettled ? "mt-2 border-t border-red-200 pt-2" : ""}>
                  <p className="m-0 font-bold">Checkout blocked. Outlet service is still in progress.</p>
                  <p className="mb-0 mt-1">
                    Complete or cancel {openOutletOrderCount} open restaurant/bar {openOutletOrderCount === 1 ? "order" : "orders"} before checkout.
                  </p>
                </div>
              )}
              {chargesUnverified && (
                <div className={noRoomAssigned || folioUnsettled || hasOpenOutletOrders ? "mt-2 border-t border-red-200 pt-2" : ""}>
                  <p className="m-0 font-bold">Checkout blocked. Some room-folio charges are unchecked.</p>
                  <p className="mb-0 mt-1">Review and check the {activeCharges.length} room-folio {activeCharges.length === 1 ? "charge" : "charges"} listed above. Settled outlet-paid orders do not require verification.</p>
                </div>
              )}
            </div>
          )}

          <label className={`group flex items-center gap-4 rounded-xl border-2 px-4 py-3.5 transition ${checkoutBlocked ? "cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-60" : acknowledged ? "cursor-pointer border-emerald-500 bg-emerald-50" : "cursor-pointer border-neutral-300 bg-white hover:border-emerald-300 hover:bg-emerald-50/30"}`}>
            <input
              type="checkbox"
              role="switch"
              aria-label="Confirm guest and reservation verification"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={checkoutBlocked}
              className="peer sr-only"
            />
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-bold ${acknowledged ? "text-emerald-900" : "text-neutral-900"}`}>
                {acknowledged ? "Verification confirmed" : "Confirm verification"}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-neutral-600">
                {isCheckIn
                  ? "I verified the guest, room assignment, stay dates, and payment status."
                  : "I reviewed the room, restaurant, bar, and all other folio charges and confirmed the balance is fully settled."}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1.5">
              <span className={`text-[9px] font-bold uppercase tracking-wide ${acknowledged ? "text-emerald-700" : "text-neutral-400"}`}>
                {acknowledged ? "Verified" : "Required"}
              </span>
              <span className={`relative block h-6 w-11 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 peer-focus-visible:ring-offset-2 ${acknowledged ? "bg-emerald-600" : "bg-neutral-300 group-hover:bg-neutral-400"}`} aria-hidden="true">
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${acknowledged ? "translate-x-[1.375rem]" : "translate-x-0.5"}`} />
              </span>
            </span>
          </label>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 bg-neutral-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <Link href={hasOpenOutletOrders ? "/owner/nrms/orders" : `/owner/nrms/reservations?reservationId=${reservation.id}`} className="inline-flex min-h-10 items-center justify-center rounded-lg px-3 text-xs font-bold text-neutral-600 no-underline hover:bg-white hover:text-neutral-900 hover:no-underline">
            {hasOpenOutletOrders ? "Open restaurant & bar orders" : folioUnsettled ? "Open reservation and settle folio" : chargesUnverified ? "Open full reservation to verify charges" : "Open full reservation"}
          </Link>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 flex-1 appearance-none rounded-lg border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 sm:flex-none">
              Not now
            </button>
            <button
              type="button"
              onClick={() => onConfirm(verifiedChargeIds)}
              disabled={busy || !acknowledged || checkoutBlocked || (isCheckIn && noRoomAssigned)}
              className={`inline-flex min-h-10 flex-1 appearance-none items-center justify-center gap-2 rounded-lg border-0 px-4 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none ${isCheckIn ? "bg-emerald-700 hover:bg-emerald-800" : "bg-neutral-900 hover:bg-neutral-800"}`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {busy ? "Processing..." : hasOpenOutletOrders ? "Complete orders first" : folioUnsettled ? "Settle folio first" : chargesUnverified ? "Verify charges first" : actionLabel}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ModalFact({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="bg-white px-4 py-3.5">
      <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`mb-0 mt-1 truncate text-sm font-bold ${warning ? "text-red-700" : "text-neutral-800"}`}>{value}</p>
    </div>
  );
}

function AccountAmount({ label, value, currency, positive = false, warning = false, zeroLabel, strong = false }: { label: string; value: number; currency: string; positive?: boolean; warning?: boolean; zeroLabel?: string; strong?: boolean }) {
  const valueClass = warning ? "text-amber-700" : positive ? "text-emerald-700" : "text-neutral-950";
  return (
    <div className="min-w-0 bg-white px-3 py-3 text-center">
      <p className="m-0 text-[10px] font-medium text-neutral-400">{label}</p>
      <p className={`mb-0 mt-1 truncate tabular-nums ${strong ? "text-sm font-bold" : "text-xs font-semibold"} ${valueClass}`}>
        {zeroLabel && Math.abs(value) <= 0.005 ? zeroLabel : `${currency} ${Math.abs(value).toLocaleString()}`}
      </p>
    </div>
  );
}

function OccupancyOverview({
  totalRooms,
  occupiedRooms,
  occupancyPercent,
  stayingRooms,
  arrivingRooms,
  turnoverRooms,
  freeRooms,
  onRefresh,
}: {
  totalRooms: number;
  occupiedRooms: number;
  occupancyPercent: number;
  stayingRooms: number;
  arrivingRooms: number;
  turnoverRooms: number;
  freeRooms: number;
  onRefresh: () => void;
}) {
  const segments = [
    { label: "staying on", value: stayingRooms, color: "bg-emerald-600" },
    { label: "arriving", value: arrivingRooms, color: "bg-blue-400" },
    { label: "turning over", value: turnoverRooms, color: "bg-amber-400" },
    { label: "free", value: freeRooms, color: "bg-neutral-200" },
  ];

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_14px_35px_-32px_rgba(15,23,42,0.45)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <BedDouble className="h-5 w-5" />
          </span>
          <div>
            <h2 className="m-0 text-sm font-bold text-neutral-950">Tonight&apos;s occupancy</h2>
            <p className="mb-0 mt-0.5 text-xs text-neutral-400">Projected after today&apos;s arrivals and departures</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p className="m-0 text-sm font-bold tabular-nums text-neutral-950">
            {occupiedRooms} of {totalRooms} rooms <span className="text-neutral-400">·</span> {occupancyPercent}%
          </p>
          <button type="button" onClick={onRefresh} aria-label="Refresh front desk" className="flex h-8 w-8 appearance-none items-center justify-center rounded-lg border-0 bg-transparent p-0 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-5 flex h-2.5 w-full gap-1.5 overflow-hidden rounded-full" aria-label={`${occupancyPercent}% occupied tonight`}>
        {totalRooms > 0 ? segments.map((segment) => (
          segment.value > 0 && (
            <span
              key={segment.label}
              className={`h-full min-w-1 rounded-full ${segment.color}`}
              style={{ width: `${(segment.value / totalRooms) * 100}%` }}
              title={`${segment.value} ${segment.label}`}
            />
          )
        )) : <span className="h-full w-full rounded-full bg-neutral-200" />}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-2 text-xs text-neutral-500">
            <span className={`h-2.5 w-2.5 rounded-sm ${segment.color}`} aria-hidden="true" />
            <strong className="font-bold text-neutral-700">{segment.value}</strong> {segment.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function CompactStat({ label, value, helper, tone }: { label: string; value: number; helper: string; tone: "emerald" | "blue" | "neutral" | "red" }) {
  const valueClass = {
    emerald: "text-emerald-700",
    blue: "text-blue-700",
    neutral: "text-neutral-950",
    red: "text-red-700",
  }[tone];
  const backgroundClass = tone === "red" && value > 0 ? "bg-red-50/45" : "bg-white";

  return (
    <article className={`min-w-0 px-5 py-4 transition hover:bg-neutral-50 ${backgroundClass}`}>
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-400">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <p className={`m-0 text-2xl font-bold leading-none tabular-nums ${valueClass}`}>{value}</p>
        <span className="truncate text-[11px] font-medium text-neutral-400">{helper}</span>
      </div>
    </article>
  );
}

function OperationList({
  title,
  count,
  countLabel,
  icon,
  tone,
  emptyTitle,
  emptyActionHref,
  emptyActionLabel,
  children,
}: {
  title: string;
  count: number;
  countLabel: string;
  icon: ReactNode;
  tone: "emerald" | "blue";
  emptyTitle: string;
  emptyActionHref: string;
  emptyActionLabel: string;
  children: ReactNode;
}) {
  const colors = tone === "emerald"
    ? {
        header: "border-emerald-100 bg-emerald-50/55",
        icon: "border-emerald-100 bg-white text-emerald-700",
        eyebrow: "text-emerald-700",
        count: "text-emerald-700",
        action: "text-emerald-700 hover:text-emerald-800",
        queueLabel: "Arrival queue",
      }
    : {
        header: "border-blue-100 bg-blue-50/55",
        icon: "border-blue-100 bg-white text-blue-700",
        eyebrow: "text-blue-700",
        count: "text-blue-700",
        action: "text-blue-700 hover:text-blue-800",
        queueLabel: "Departure queue",
      };
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_14px_35px_-32px_rgba(15,23,42,0.45)]">
      <div className={`flex items-center justify-between gap-4 border-b px-5 py-4 ${colors.header}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm ${colors.icon}`}>{icon}</span>
          <div className="min-w-0">
            <p className={`m-0 text-[9px] font-bold uppercase tracking-[0.14em] ${colors.eyebrow}`}>{colors.queueLabel}</p>
            <h2 className="mb-0 mt-0.5 truncate text-sm font-bold text-neutral-950">{title}</h2>
          </div>
        </div>
        <div className="shrink-0 border-l border-neutral-200/70 pl-4 text-right">
          <strong className={`block text-xl font-bold leading-none tabular-nums ${colors.count}`}>{count}</strong>
          <span className="mt-1 block text-[10px] font-medium text-neutral-500">{countLabel}</span>
        </div>
      </div>
      {!hasItems ? (
        <div className="flex items-center gap-3 px-5 py-6">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-neutral-800">{emptyTitle}</p>
          </div>
          <Link href={emptyActionHref} className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold no-underline hover:no-underline ${colors.action}`}>
            {emptyActionLabel} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <ul role="list" className="m-0 list-none divide-y divide-neutral-100 p-0">{children}</ul>
      )}
    </article>
  );
}

function OperationRow({
  reservation,
  detail,
  actionLabel,
  actionTone,
  busy,
  onAction,
  overdue = false,
}: {
  reservation: Reservation;
  detail: string;
  actionLabel: string;
  actionTone: "emerald" | "dark";
  busy: boolean;
  onAction: () => void;
  overdue?: boolean;
}) {
  const guestName = reservation.guestProfile?.fullName ?? "Guest";
  const room = roomsLabel(reservation);
  const roomUnassigned = !hasAssignedRoom(reservation);
  const buttonClassName = actionTone === "emerald"
    ? "bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-600"
    : "bg-neutral-900 text-white hover:bg-neutral-800 focus-visible:ring-neutral-700";

  return (
    <li className="m-0 list-none px-5 py-4 transition hover:bg-neutral-50/70">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold text-neutral-600">
          {initials(guestName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="m-0 truncate text-sm font-bold text-neutral-950">{guestName}</p>
            {overdue && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">Overdue</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
            <span className={`font-medium ${roomUnassigned ? "text-red-700" : "text-neutral-600"}`}>
              {roomUnassigned && room !== "Room not assigned" ? `${room} · unit unassigned` : room}
            </span>
            <span aria-hidden="true">·</span>
            <span>{detail}</span>
            <span aria-hidden="true">·</span>
            {hasOutstandingBalance(reservation) ? (
              <span className="font-semibold text-red-700">{reservation.currency} {reservation.balance!.toLocaleString()} due</span>
            ) : (
              <span className="font-medium text-emerald-700">paid in full</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          className={`inline-flex min-h-9 shrink-0 appearance-none items-center justify-center gap-1.5 rounded-lg border-0 px-3.5 text-xs font-bold transition disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${buttonClassName}`}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? "Working..." : actionLabel}
        </button>
      </div>
    </li>
  );
}

function AttentionPanel({ items }: { items: AttentionItem[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-[0_12px_28px_-26px_rgba(120,53,15,0.45)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/70 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700"><CircleAlert className="h-4 w-4" /></span>
          <div><h2 className="m-0 text-sm font-bold text-neutral-950">Front desk attention</h2><p className="mb-0 mt-0.5 text-[10px] text-neutral-500">Resolve these stay controls before the business day closes.</p></div>
        </div>
        <span className="rounded-md border border-amber-200 bg-white px-2.5 py-1 text-[10px] font-bold text-amber-800">{items.length} {items.length === 1 ? "reservation" : "reservations"}</span>
      </div>
      <ul className="m-0 grid list-none gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className="min-w-0 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-900 text-[10px] font-bold text-white">{initials(item.guest)}</span>
              <div className="min-w-0 flex-1"><p className="m-0 truncate text-[13px] font-bold text-neutral-900">{item.guest}</p><p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-500">{item.room} · check-out {shortDate(item.checkOut)} · {item.source}</p></div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">{item.issues.map((issue) => <span key={issue.code} className={`rounded-md border px-2 py-1 text-[10px] font-bold ${issue.code === "OVERDUE" ? "border-red-200 bg-red-50 text-red-700" : issue.code === "BALANCE" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-violet-200 bg-violet-50 text-violet-700"}`}>{issue.label}</span>)}</div>
            <Link href={`/owner/nrms/reservations?reservationId=${item.id}`} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 text-[11px] font-bold text-neutral-700 no-underline transition hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-950 hover:no-underline">Review reservation <ArrowRight className="h-3 w-3" /></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
