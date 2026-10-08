"use client";

// NRMS front desk (doc 7.4): today at a glance with one-tap check-in and
// check-out for external stays. Marketplace bookings keep their existing
// code-verified flow on the bookings page.
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  ArrowUpRight,
  BarChart3,
  BedDouble,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useNrms } from "./_components/NrmsProvider";
import { useNrmsAccessRole } from "./_components/NrmsAccessRole";
import SalesHome from "./_components/SalesHome";
import NrmsFrozenNotice from "./_components/NrmsFrozenNotice";
import NrmsCheckoutPolicyNotice from "./_components/NrmsCheckoutPolicyNotice";
import { roomReadiness, roomAssignmentRequirement } from "@/lib/nrmsRoomReadiness";
import NrmsRoomAssignmentPicker from "./_components/NrmsRoomAssignmentPicker";
import { tallyRoomLabels } from "@/lib/roomLabels";

type Reservation = {
  id: number;
  /** Opaque rs_ reference used in page URLs instead of the row id. */
  reference?: string;
  status: string;
  source: string;
  bookingId?: number | null;
  marketplaceBooking?: { id: number; reference: string; status?: string | null; checkInCodeStatus?: string | null } | null;
  checkIn: string;
  checkOut: string;
  currency: string;
  roomRate?: number | null;
  depositAmount?: number | null;
  totalAmount?: number | null;
  chargesTotal?: number | null;
  openOutletOrderCount?: number;
  amountPaid?: number | null;
  effectivePaid?: number;
  transferredToMaster?: number;
  agencySettlement?: { settled: boolean } | null;
  checkedInAt?: string | null;
  earlyCheckInApproved?: boolean;
  earlyCheckInResolution?: {
    resolution: "APPROVE_EARLY_CHECKIN";
    reason: string | null;
    operationalArrival: string | null;
    createdAt: string;
  } | null;
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
    roomUnitFloor?: number | null;
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
  units: Array<{ id: number; code: string; floor?: number | null; status: string; housekeepingStatus?: string | null }>;
};

type AttentionItem = {
  id: number;
  reference?: string;
  guest: string;
  room: string;
  checkOut: string;
  source: string;
  issues: Array<{ code: "ROOM" | "OVERDUE" | "EARLY_CHECKIN" | "BALANCE"; label: string }>;
};

const SOURCE_LABELS: Record<string, string> = {
  NOLSAF: "NoLSAF marketplace",
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
  return tallyRoomLabels(active.map((a) => a.roomUnitCode
    ? `${a.roomUnitCode}${a.roomUnitFloor == null ? "" : ` · ${a.roomUnitFloor === 0 ? "Floor G" : `Floor ${a.roomUnitFloor}`}`}`
    : a.roomTypeName), "Room not assigned");
}

/** Reservation page link by opaque reference, never the numeric id. */
function reservationHref(r: { reference?: string }): string {
  return r.reference ? `/owner/nrms/reservations?reservation=${encodeURIComponent(r.reference)}` : "/owner/nrms/reservations";
}

function hasAssignedRoom(r: Reservation): boolean {
  return roomReadiness(r).ready;
}

/**
 * A marketplace stay cannot be checked in from NRMS. The guest's single-use
 * code is the only proof of arrival, it is what releases the owner's payout,
 * and the API refuses this reservation with MARKETPLACE_BOOKING. So the row
 * hands the receptionist over to the marketplace validation page and brings
 * them back here once the code is accepted, rather than offering a button that
 * can only fail.
 */
function marketplaceCheckInHref(r: Reservation): string | null {
  const handoffReference = r.marketplaceBooking?.reference ?? null;
  if (!handoffReference) return null;
  return `/owner/bookings/validate?handoff=${encodeURIComponent(handoffReference)}&return=${encodeURIComponent("/owner/nrms")}`;
}

/** Why a marketplace arrival may not be checkable in yet, for the row detail. */
function marketplaceCodeNote(r: Reservation): string | null {
  switch (String(r.marketplaceBooking?.checkInCodeStatus ?? "")) {
    case "USED":
      return "code already used";
    case "VOID":
      return "code voided, contact support";
    case "ACTIVE":
      return "code required";
    default:
      return null;
  }
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replaceAll("_", " ").toLowerCase();
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

/**
 * The NRMS home is not one screen.
 *
 * A receptionist opening NRMS needs arrivals, departures and tonight's rooms.
 * A sales executive holds none of those duties: they cannot check a guest in,
 * and occupancy is not the number they are measured on. Sending them to the
 * front desk made the product look like it had no idea what they do, so the
 * role decides which home is composed.
 *
 * The role comes from the layout (NrmsAccessRole), which resolves it from the
 * server side membership. This chooses a screen, never a permission: whichever
 * home renders, its requests are still made as the signed-in account and the
 * API still decides what comes back.
 */
export default function NrmsHomePage() {
  const { accessRole } = useNrmsAccessRole();
  if (accessRole === "SALES_EXECUTIVE") return <SalesHome />;
  return <NrmsFrontDeskPage />;
}

function NrmsFrontDeskPage() {
  const router = useRouter();
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [roomTotals, setRoomTotals] = useState<RoomTotals | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([]);
  const [propertyTotalFloors, setPropertyTotalFloors] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<{ reservation: Reservation; action: "check-in" | "check-out" } | null>(null);
  const [roomNotReady, setRoomNotReady] = useState<string | null>(null);
  const [auditBehindDate, setAuditBehindDate] = useState<string | null>(null);
  // Early departure is decided on the hotel's business day, which only moves on
  // when the night audit closes. The browser cannot see that day, so when the
  // server says a departure declaration is needed, the modal must show it.
  const [departureDeclarationNeeded, setDepartureDeclarationNeeded] = useState(false);
  useEffect(() => {
    setDepartureDeclarationNeeded(false);
  }, [pendingAction?.reservation.id, pendingAction?.action]);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 14);
      const to = new Date();
      to.setDate(to.getDate() + 2);
      const [reservationResponse, inHouseResponse, roomsResponse] = await Promise.all([
        apiClient.get<any>(`/api/owner/nrms/reservations/property/${selectedPropertyId}`, {
          params: { from: from.toISOString(), to: to.toISOString(), limit: 200 },
        }),
        // In-house is an operational state, not a date-window report. Always
        // load every checked-in stay so an old or future-dated anomaly cannot
        // disappear from the front desk counters and attention queue.
        apiClient.get<any>(`/api/owner/nrms/reservations/property/${selectedPropertyId}`, {
          params: { status: "CHECKED_IN", limit: 200 },
        }),
        apiClient.get<any>(`/api/owner/nrms/rooms/${selectedPropertyId}`),
      ]);
      const merged = new Map<number, Reservation>();
      for (const reservation of [
        ...(reservationResponse.data?.reservations ?? []),
        ...(inHouseResponse.data?.reservations ?? []),
      ]) merged.set(reservation.id, reservation);
      setReservations([...merged.values()]);
      setRoomTotals(roomsResponse.data?.totals ?? null);
      setRoomTypes(roomsResponse.data?.roomTypes ?? []);
      setPropertyTotalFloors(roomsResponse.data?.property?.totalFloors ?? null);
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
  const checkedInRecords = useMemo(() => reservations.filter((r) => r.status === "CHECKED_IN"), [reservations]);
  // A future arrival carrying CHECKED_IN is corrupt operational state, not a
  // guest occupying a room tonight. Keep it visible to Attention below, but do
  // not let it inflate the in-house or occupancy figures.
  const inHouse = useMemo(
    () => checkedInRecords.filter((r) => r.checkIn.slice(0, 10) <= localDateKey(today) || r.earlyCheckInApproved),
    [checkedInRecords, today],
  );
  const departures = useMemo(
    () => inHouse.filter((r) => new Date(r.checkOut).getTime() <= new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime()),
    [inHouse, today],
  );
  const totalRooms = roomTotals?.sellableUnits ?? roomTotals?.roomUnits ?? 0;
  const stayingRooms = Math.min(totalRooms, Math.max(0, inHouse.length - departures.length));
  const turnoverRooms = Math.min(departures.length, Math.max(0, totalRooms - stayingRooms));
  const arrivingRooms = Math.min(arrivals.length, Math.max(0, totalRooms - stayingRooms - turnoverRooms));
  const freeRooms = Math.max(0, totalRooms - stayingRooms - turnoverRooms - arrivingRooms);
  const tonightOccupied = Math.min(totalRooms, stayingRooms + arrivingRooms);
  const occupancyPercent = totalRooms > 0 ? Math.round((tonightOccupied / totalRooms) * 100) : 0;
  const isPropertyFrozen = Boolean(error?.includes("temporarily frozen by an administrator"));
  const attentionItems = useMemo(() => {
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const active = new Map<number, Reservation>();
    [...arrivals, ...checkedInRecords].forEach((reservation) => active.set(reservation.id, reservation));

    return [...active.values()].flatMap<AttentionItem>((reservation) => {
      const guest = reservation.guestProfile?.fullName ?? "Guest";
      const issues: AttentionItem["issues"] = [];
      if (!hasAssignedRoom(reservation)) issues.push({ code: "ROOM", label: roomReadiness(reservation).missingAllocation ? "Room allocation missing" : `Room assignment required (${roomReadiness(reservation).assigned}/${roomReadiness(reservation).total})` });
      if (reservation.status === "CHECKED_IN" && reservation.checkIn.slice(0, 10) > localDateKey(today) && !reservation.earlyCheckInApproved) {
        issues.push({ code: "EARLY_CHECKIN", label: `Checked in before ${shortDate(reservation.checkIn)} arrival` });
      }
      if (new Date(reservation.checkOut).getTime() < startOfToday && reservation.status === "CHECKED_IN") {
        const overdueDays = Math.max(1, Math.floor((startOfToday - new Date(reservation.checkOut).getTime()) / 86_400_000));
        issues.push({ code: "OVERDUE", label: `${overdueDays} ${overdueDays === 1 ? "day" : "days"} past check-out` });
      }
      if (hasOutstandingBalance(reservation)) issues.push({ code: "BALANCE", label: `${reservation.currency} ${reservation.balance!.toLocaleString()} outstanding` });
      return issues.length > 0 ? [{ id: reservation.id, reference: reservation.reference, guest,room: roomsLabel(reservation), checkOut: reservation.checkOut, source: sourceLabel(reservation.source), issues }] : [];
    });
  }, [arrivals, checkedInRecords, today]);

  const act = async (
    id: number,
    action: "check-in" | "check-out",
    verifiedChargeIds: number[] = [],
    overrideRoomReadiness = false,
    checkoutDeclaration?: { roomVacantConfirmed: boolean; earlyDepartureReason?: string },
  ) => {
    setBusyId(id);
    setError(null);
    setRoomNotReady(null);
    try {
      const response = await apiClient.post(
        `/api/owner/nrms/reservations/${id}/${action}`,
        action === "check-out" ? { verifiedChargeIds, ...checkoutDeclaration } : overrideRoomReadiness ? { overrideRoomReadiness: true } : {},
      );
      const billing = (response.data as { billing?: { businessDate?: string; businessDayBehind?: boolean } } | undefined)?.billing;
      setAuditBehindDate(action === "check-out" && billing?.businessDayBehind && billing.businessDate ? billing.businessDate : null);
      await load();
      setPendingAction(null);
    } catch (e: any) {
      const code = e?.response?.data?.code;
      const handoffHref = action === "check-in" && code === "MARKETPLACE_BOOKING"
        ? marketplaceCheckInHref(reservations.find((reservation) => reservation.id === id) ?? pendingAction?.reservation ?? ({} as Reservation))
        : null;
      if (handoffHref) {
        // Marketplace stays are checked in with the guest's code, so send the
        // receptionist there instead of leaving them on an error they cannot fix.
        setPendingAction(null);
        setRoomNotReady(null);
        router.push(handoffHref);
      } else if (action === "check-in" && code === "ROOM_NOT_READY") {
        setRoomNotReady(e?.response?.data?.error || "The assigned room has not been cleaned yet.");
      } else if (action === "check-out" && (code === "ROOM_VACANCY_CONFIRMATION_REQUIRED" || code === "EARLY_DEPARTURE_REASON_REQUIRED")) {
        setDepartureDeclarationNeeded(true);
        setError("NRMS records this as an early departure. Tick the room-vacant box and add a reason in the Early departure section above, then confirm check-out again.");
      } else {
        setError(e?.response?.data?.error || "Action failed");
      }
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

        <div className="relative flex min-h-[160px] flex-col justify-between gap-3 p-3 sm:min-h-[170px] sm:p-4 lg:flex-row lg:items-end">
          {isPropertyFrozen || (error && !loading) ? <span aria-hidden /> : (
            <TonightPanel
              loading={loading}
              totalRooms={totalRooms}
              occupiedRooms={tonightOccupied}
              occupancyPercent={occupancyPercent}
              stayingRooms={stayingRooms}
              arrivingRooms={arrivingRooms}
              turnoverRooms={turnoverRooms}
              freeRooms={freeRooms}
              arrivals={arrivals.length}
              departures={departures.length}
              inHouse={inHouse.length}
              attention={attentionItems.length}
              onRefresh={() => void load()}
            />
          )}
          <div className="max-w-full self-end overflow-x-auto rounded-2xl border border-solid border-white/10 bg-black/25 p-1.5 shadow-lg shadow-black/10 backdrop-blur-md">
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

      {error && isPropertyFrozen ? (
        <NrmsFrozenNotice propertyTitle={selectedProperty?.title} loading={loading} onRefresh={() => void load()} />
      ) : error ? (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {auditBehindDate && (
        <div role="status" className="flex items-start gap-2 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <span className="min-w-0 flex-1">Checkout recorded on today&apos;s date. The business day is still open at {shortDate(auditBehindDate)}, so its postings land there until Night Audit catches up. <Link href="/owner/nrms/finance?view=audit" className="font-semibold text-amber-900 underline">Open Night Audit</Link></span>
          <button type="button" onClick={() => setAuditBehindDate(null)} aria-label="Dismiss" className="cursor-pointer border-0 bg-transparent p-0 text-amber-700"><X className="h-4 w-4" /></button>
        </div>
      )}

      {loading ? (
        <FrontDeskSkeleton />
      ) : isPropertyFrozen ? null : (
        <>
          <OperationList
            id="fd-arrivals"
            title="Arriving today"
            count={arrivals.length}
            countLabel="expected"
            icon={<ArrowDownToLine className="h-[18px] w-[18px]" />}
            tone="emerald"
            emptyTitle="No arrivals expected today"
            emptyHint="Confirmed stays starting today appear here."
            emptyActionHref="/owner/nrms/reservations?create=1"
            emptyActionLabel="Add reservation"
          >
            {arrivals.map((reservation) => {
              const roomReady = hasAssignedRoom(reservation);
              const marketplaceHref = roomReady ? marketplaceCheckInHref(reservation) : null;
              const codeNote = marketplaceCodeNote(reservation);
              return (
                <OperationRow
                  key={reservation.id}
                  reservation={reservation}
                  actionLabel={!roomReady ? "Prepare room" : marketplaceHref ? "Check in with code" : "Check in"}
                  actionTone="emerald"
                  actionHref={marketplaceHref}
                  busy={busyId === reservation.id}
                  onAction={() => {
                    setError(null);
                    setPendingAction({ reservation, action: "check-in" });
                  }}
                  detail={!roomReady ? "Room assignment required" : codeNote ? codeNote.charAt(0).toUpperCase() + codeNote.slice(1) : "Arrives today"}
                />
              );
            })}
          </OperationList>

          <OperationList
            id="fd-departures"
            title="Checking out"
            count={departures.length}
            countLabel="in queue"
            icon={<ArrowUpFromLine className="h-[18px] w-[18px]" />}
            tone="blue"
            emptyHint="Guests due to leave today appear here."
            overdueCount={departures.filter((reservation) => new Date(reservation.checkOut).getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()).length}
            showStatusColumn
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
                detail={`Due out ${shortDate(reservation.checkOut)}`}
                overdue={new Date(reservation.checkOut).getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()}
                showStatus
              />
            ))}
          </OperationList>

          {attentionItems.length > 0 && <AttentionPanel items={attentionItems} />}
        </>
      )}

      {pendingAction && (
        <StayActionModal
          propertyId={selectedPropertyId}
          reservation={pendingAction.reservation}
          action={pendingAction.action}
          roomTypes={roomTypes}
          totalFloors={propertyTotalFloors}
          busy={busyId === pendingAction.reservation.id}
          error={error}
          roomNotReady={roomNotReady}
          requireDepartureDeclaration={departureDeclarationNeeded}
          onOverrideCheckIn={() => void act(pendingAction.reservation.id, "check-in", [], true)}
          onClose={() => {
            if (busyId == null) {
              setPendingAction(null);
              setRoomNotReady(null);
            }
          }}
          onOpenDestination={(href) => {
            setPendingAction(null);
            setRoomNotReady(null);
            router.push(href);
          }}
          onConfirm={(verifiedChargeIds, checkoutDeclaration) => void act(pendingAction.reservation.id, pendingAction.action, verifiedChargeIds, false, checkoutDeclaration)}
          onAssignRoom={(allocationId, roomUnitId) => assignRoom(pendingAction.reservation.id, allocationId, roomUnitId)}
        />
      )}
    </div>
  );
}

function StayActionModal({
  propertyId,
  reservation,
  action,
  roomTypes,
  totalFloors,
  busy,
  error,
  roomNotReady,
  requireDepartureDeclaration = false,
  onOverrideCheckIn,
  onClose,
  onOpenDestination,
  onConfirm,
  onAssignRoom,
}: {
  propertyId: number;
  reservation: Reservation;
  action: "check-in" | "check-out";
  roomTypes: RoomTypeOption[];
  totalFloors: number | null;
  busy: boolean;
  error: string | null;
  roomNotReady: string | null;
  /** Set when the server reported that this checkout is an early departure. */
  requireDepartureDeclaration?: boolean;
  onOverrideCheckIn: () => void;
  onClose: () => void;
  onOpenDestination: (href: string) => void;
  onConfirm: (verifiedChargeIds: number[], checkoutDeclaration?: { roomVacantConfirmed: boolean; earlyDepartureReason?: string }) => void;
  onAssignRoom: (allocationId: number, roomUnitId: number) => Promise<boolean>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [verifiedChargeIds, setVerifiedChargeIds] = useState<number[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | "">("");
  const [availableRoomIds, setAvailableRoomIds] = useState<Set<number> | null>(null);
  const [roomAvailabilityLoading, setRoomAvailabilityLoading] = useState(false);
  const [roomAvailabilityError, setRoomAvailabilityError] = useState<string | null>(null);
  const [roomVacantConfirmed, setRoomVacantConfirmed] = useState(false);
  const [earlyDepartureReason, setEarlyDepartureReason] = useState("");
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
    : paid;
  const paidPercent = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : paid > 0 ? 100 : 0;
  const settled = Math.abs(balance) <= 0.005;
  const longDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", weekday: "short", day: "numeric", month: "short" });
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
  const unassignedAllocation = (reservation.allocations ?? []).find((allocation) => allocation.status === "ACTIVE" && (allocation.roomUnitId == null || !allocation.roomUnitCode));
  const categoryRooms = unassignedAllocation ? roomTypes.find((roomType) => roomType.id === unassignedAllocation.roomTypeId)?.units.filter((unit) => unit.status === "ACTIVE") ?? [] : [];
  const eligibleRooms = categoryRooms.filter((unit) => availableRoomIds?.has(unit.id));
  const assignmentRequirement = roomAssignmentRequirement(reservation);
  const assignmentPaymentReady = assignmentRequirement.ready;
  const actionLabel = isCheckIn ? "Confirm check-in" : "Confirm check-out";
  const marketplaceHref = isCheckIn ? marketplaceCheckInHref(reservation) : null;
  const earlyDeparture = !isCheckIn && (reservation.checkOut.slice(0, 10) > localDateKey() || requireDepartureDeclaration);
  const departureDeclarationReady = isCheckIn || !earlyDeparture || (roomVacantConfirmed && earlyDepartureReason.trim().length >= 2);

  const handleAssignRoom = async () => {
    if (!unassignedAllocation || selectedRoomId === "") return;
    const assigned = await onAssignRoom(unassignedAllocation.id, Number(selectedRoomId));
    if (assigned) {
      setSelectedRoomId("");
      setAcknowledged(false);
    }
  };

  useEffect(() => {
    if (!isCheckIn || !unassignedAllocation || !assignmentPaymentReady) {
      setAvailableRoomIds(null);
      setRoomAvailabilityError(null);
      return;
    }
    let cancelled = false;
    setRoomAvailabilityLoading(true);
    setRoomAvailabilityError(null);
    apiClient.get<any>(`/api/owner/nrms/rooms/${propertyId}/availability`, {
      params: {
        roomTypeId: unassignedAllocation.roomTypeId,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        allocationId: unassignedAllocation.id,
      },
    }).then((response) => {
      if (cancelled) return;
      setAvailableRoomIds(new Set<number>((response.data?.units ?? []).filter((unit: any) => unit.available).map((unit: any) => Number(unit.id))));
    }).catch((cause: any) => {
      if (!cancelled) setRoomAvailabilityError(cause?.response?.data?.error || "Could not check live room availability");
    }).finally(() => {
      if (!cancelled) setRoomAvailabilityLoading(false);
    });
    return () => { cancelled = true; };
  }, [assignmentPaymentReady, isCheckIn, propertyId, reservation.checkIn, reservation.checkOut, unassignedAllocation]);

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
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="stay-action-title" className="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-3xl">
        {/* Header band: who, and the four facts of the stay */}
        <div className="bg-[#012a26] px-5 pb-5 pt-5 text-white sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[#5eead4]">{isCheckIn ? "Check-in review" : "Check-out review"}</p>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close review" className="-mr-1 -mt-1 grid h-9 w-9 place-items-center rounded-full border border-solid border-white/15 bg-white/[0.06] text-white/70 transition hover:bg-white/[0.12] hover:text-white disabled:opacity-50">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3.5">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#5eead4] text-base font-extrabold text-[#012a26]">{initials(guestName)}</span>
            <div className="min-w-0 flex-1">
              <h2 id="stay-action-title" className="m-0 truncate text-xl font-bold tracking-[-0.01em] text-white">
                {isCheckIn ? `Check in ${guestName}` : `Check out ${guestName}`}
              </h2>
              <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/60">
                <span>{sourceLabel(reservation.source)}</span>
                {reservation.adults ? <><span aria-hidden>·</span><span>{reservation.adults} {reservation.adults === 1 ? "adult" : "adults"}{reservation.children ? `, ${reservation.children} ${reservation.children === 1 ? "child" : "children"}` : ""}</span></> : null}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isCheckIn ? "bg-sky-400/15 text-sky-200" : "bg-[#5eead4]/15 text-[#5eead4]"}`}>{isCheckIn ? "Confirmed" : "In house"}</span>
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ModalFact label="Room" value={noRoomAssigned && room !== "Room not assigned" ? `${room} · no room yet` : room} warning={noRoomAssigned} />
            <ModalFact label="Stay" value={`${nights} ${nights === 1 ? "night" : "nights"}${guests ? ` · ${guests} ${guests === 1 ? "guest" : "guests"}` : ""}`} />
            <ModalFact label="Arrives" value={longDate(reservation.checkIn)} />
            <ModalFact label="Leaves" value={longDate(reservation.checkOut)} />
          </div>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
          {/* Guest account: the verdict first, then how it adds up */}
          <section aria-label="Guest account summary" className="overflow-hidden rounded-2xl border border-solid border-slate-200">
            <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${settled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {settled ? <CheckCircle2 className="h-5 w-5" /> : <WalletCards className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-xs font-semibold text-slate-500">{settled ? "Guest account" : balance < 0 ? "Guest credit" : "Still to collect"}</p>
                <p className={`m-0 mt-0.5 text-xl font-extrabold tracking-[-0.01em] tabular-nums ${settled ? "text-emerald-700" : "text-amber-700"}`}>
                  {settled ? "Paid in full" : `${reservation.currency} ${Math.abs(balance).toLocaleString()}`}
                </p>
              </div>
              <div className="text-right">
                <p className="m-0 text-xs text-slate-500">Paid</p>
                <p className="m-0 mt-0.5 text-sm font-bold tabular-nums text-slate-900">{reservation.currency} {paid.toLocaleString()} <span className="font-medium text-slate-400">of {total.toLocaleString()}</span></p>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${paidPercent}% paid`}>
                <div className={`h-full rounded-full ${settled ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${paidPercent}%` }} />
              </div>
            </div>

            <dl className="m-0 grid grid-cols-2 border-0 border-t border-solid border-slate-100 sm:grid-cols-4">
              <AccountAmount label="Room stay" value={roomTotal} currency={reservation.currency} />
              <AccountAmount label="Extra services" value={extraCharges} currency={reservation.currency} />
              {isCheckIn ? (
                <AccountAmount label="Paid so far" value={paid} currency={reservation.currency} positive />
              ) : (
                <AccountAmount label="Paid by check-in" value={paidByCheckIn} currency={reservation.currency} positive />
              )}
              {isCheckIn ? (
                <AccountAmount label="Total bill" value={total} currency={reservation.currency} strong />
              ) : (
                <AccountAmount label="Paid during stay" value={paidAfterCheckIn} currency={reservation.currency} positive />
              )}
            </dl>

            {(reservation.depositAmount ?? 0) > 0 && (
              <p className="m-0 border-0 border-t border-solid border-slate-100 bg-slate-50 px-5 py-2 text-[11px] text-slate-500">
                Required deposit: <strong className="text-slate-700">{reservation.currency} {(reservation.depositAmount ?? 0).toLocaleString()}</strong>
              </p>
            )}

            {recentPayments.length > 0 && (
              <div className="border-0 border-t border-solid border-slate-100 px-4 py-3 sm:px-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Payments</p>
                  {activePayments.length > recentPayments.length && <span className="text-[11px] text-slate-400">+{activePayments.length - recentPayments.length} more</span>}
                </div>
                <ul className="m-0 list-none space-y-1.5 p-0">
                  {recentPayments.map((payment) => (
                    <li key={payment.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-emerald-700 ring-1 ring-inset ring-slate-200"><WalletCards className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-xs font-semibold text-slate-800">{paymentMethodLabel(payment.method)}{payment.reference ? ` · ${payment.reference}` : ""}</p>
                        <p className="m-0 mt-0.5 text-[11px] text-slate-400">{shortDateTime(payment.createdAt)}</p>
                      </div>
                      <strong className="shrink-0 text-sm tabular-nums text-emerald-700">{payment.currency} {(payment.amount ?? 0).toLocaleString()}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {!isCheckIn && activeCharges.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white" aria-label="Extra charge verification">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
                <div><h3 className="m-0 text-sm font-bold text-neutral-900">Verify room-folio charges</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-500">Only charges added to the room folio require confirmation. Outlet-paid orders are already settled.</p></div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-[11px] font-bold ${chargesUnverified ? "text-amber-700" : "text-emerald-700"}`}>{verifiedChargeIds.length}/{activeCharges.length}</span>
                  <button
                    type="button"
                    onClick={() => setVerifiedChargeIds(chargesUnverified ? activeCharges.map((charge) => charge.id) : [])}
                    className="min-h-8 appearance-none rounded-lg border border-neutral-200 bg-white px-2.5 text-[11px] font-bold text-neutral-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                  >
                    {chargesUnverified ? "Select all" : "Clear all"}
                  </button>
                </div>
              </div>
              <div className="space-y-2 p-3">
                {activeCharges.map((charge) => {
                  const checked = verifiedChargeIds.includes(charge.id);
                  return <label key={charge.id} className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition ${checked ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"}`}>
                    <input type="checkbox" checked={checked} onChange={(event) => setVerifiedChargeIds((current) => event.target.checked ? [...current, charge.id] : current.filter((id) => id !== charge.id))} className="peer sr-only" />
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] transition peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 peer-focus-visible:ring-offset-2"
                      style={{
                        border: checked ? "1px solid #047857" : "1px solid #cbd5e1",
                        backgroundColor: checked ? "#047857" : "#f8fafc",
                        color: "#ffffff",
                        boxShadow: "none",
                      }}
                    >
                      {checked && <Check className="h-4 w-4 stroke-[3]" />}
                    </span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-neutral-800">{charge.description || charge.category.replaceAll("_", " ").toLowerCase()}</span>{charge.outletOrder && <span className="mt-0.5 block truncate text-[10px] text-neutral-400">{charge.outletOrder.orderNumber} · {charge.outletOrder.outlet.name} · {charge.outletOrder.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}</span>}</span>
                    <strong className="shrink-0 text-xs tabular-nums text-neutral-900">{charge.currency} {(charge.amount ?? 0).toLocaleString()}</strong>
                  </label>;
                })}
              </div>
            </section>
          )}

          {isCheckIn && noRoomAssigned && unassignedAllocation && assignmentPaymentReady && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <div>
                  <p className="m-0 text-sm font-bold text-neutral-900">Assign a room before check-in</p>
                  <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">
                    The guest keeps the paid room category; the front desk selects only the physical room number.
                  </p>
                </div>
              </div>
              <NrmsRoomAssignmentPicker roomTypeName={unassignedAllocation?.roomTypeName ?? "Room type unavailable"} units={eligibleRooms} totalFloors={totalFloors} selectedUnitId={selectedRoomId} onSelect={setSelectedRoomId} loading={roomAvailabilityLoading} disabled={busy} />
              {roomAvailabilityError && <p className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{roomAvailabilityError}</p>}
              <div className="flex justify-end">
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

          {isCheckIn && noRoomAssigned && !assignmentPaymentReady && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="m-0 text-xs font-bold">Room assignment is waiting for payment</p><p className="mb-0 mt-1 text-xs leading-5 text-amber-800">{assignmentRequirement.message}</p></div>
            </div>
          )}

          {isCheckIn && noRoomAssigned && (!unassignedAllocation || !assignmentPaymentReady) && <button type="button" onClick={() => onOpenDestination(reservationHref(reservation))} className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold">{unassignedAllocation ? "Review payment and assignment" : "Review missing room allocation"}</button>}

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

          {!isCheckIn && earlyDeparture && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-xs font-bold text-neutral-900">Early departure</p>
                  <p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-600">
                    {reservation.checkOut.slice(0, 10) > localDateKey()
                      ? `This stay was planned until ${shortDate(reservation.checkOut)}. Future calendar dates will be released and NRMS will retain the original schedule for audit.`
                      : `This stay was planned until ${shortDate(reservation.checkOut)} and the guest is leaving before that date in Tanzania time, so NRMS records this checkout as early.`}
                  </p>
                  <textarea value={earlyDepartureReason} onChange={(event) => setEarlyDepartureReason(event.target.value)} rows={2} maxLength={300} placeholder="Reason for leaving early" className="mt-2 box-border w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-neutral-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10" />
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] leading-4 text-neutral-700"><input type="checkbox" checked={roomVacantConfirmed} onChange={(event) => setRoomVacantConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-700" /><span><strong className="font-semibold text-neutral-900">The guest has physically left and the room is vacant.</strong> This declaration is stored with the departure record.</span></label>
                </div>
              </div>
            </section>
          )}

          {!isCheckIn && earlyDeparture && <NrmsCheckoutPolicyNotice />}

          <label className={`flex items-center gap-4 rounded-2xl px-4 py-3.5 ring-inset transition ${checkoutBlocked ? "cursor-not-allowed bg-slate-50 opacity-60 ring-1 ring-slate-200" : acknowledged ? "cursor-pointer bg-emerald-50 ring-2 ring-emerald-500" : "cursor-pointer bg-white ring-1 ring-slate-300 hover:ring-emerald-400"}`}>
            <input
              type="checkbox"
              role="switch"
              aria-label="Confirm guest and reservation verification"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={checkoutBlocked}
              className="peer sr-only"
            />
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 border-solid transition peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 peer-focus-visible:ring-offset-2 ${acknowledged ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-400 bg-white text-transparent"}`} aria-hidden>
              <Check className="h-4 w-4" strokeWidth={3.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-bold ${acknowledged ? "text-emerald-900" : "text-slate-900"}`}>
                {isCheckIn ? "I checked the guest and the stay" : "I checked the bill and the room"}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                {isCheckIn
                  ? "Identity, room, dates and payment match this reservation."
                  : "Room, restaurant, bar and other charges are reviewed and the balance is settled."}
              </span>
            </span>
          </label>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {isCheckIn && roomNotReady && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="m-0">{roomNotReady}</p>
              <button
                type="button"
                onClick={onOverrideCheckIn}
                disabled={busy}
                className="mt-2 inline-flex min-h-9 appearance-none items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
              >
                Check in anyway
              </button>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-0 border-t border-solid border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button type="button" onClick={() => onOpenDestination(hasOpenOutletOrders ? "/owner/nrms/orders" : reservationHref(reservation))} disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border-0 bg-transparent px-3 text-xs font-bold text-[#02665e] transition hover:bg-emerald-50 disabled:opacity-50">
            {hasOpenOutletOrders ? "Open restaurant & bar orders" : folioUnsettled ? "Open reservation and settle folio" : chargesUnverified ? "Open full reservation to verify charges" : "Open full reservation"}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-11 flex-1 rounded-xl border border-solid border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 sm:flex-none">
              Not now
            </button>
            {marketplaceHref ? (
            <button
              type="button"
              onClick={() => onOpenDestination(marketplaceHref)}
              disabled={busy || !acknowledged || noRoomAssigned}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 text-sm font-bold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 sm:flex-none"
            >
              Check in with code
              <ArrowUpRight className="h-4 w-4" />
            </button>
            ) : (
            <button
              type="button"
              onClick={() => onConfirm(verifiedChargeIds, !earlyDeparture ? undefined : { roomVacantConfirmed, earlyDepartureReason: earlyDepartureReason.trim() })}
              disabled={busy || !acknowledged || !departureDeclarationReady || checkoutBlocked || (isCheckIn && noRoomAssigned)}
              className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border-0 px-5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 sm:flex-none ${isCheckIn ? "bg-[#02665e] hover:bg-[#014d47]" : "bg-[#012a26] hover:bg-[#033a34]"}`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {busy ? "Processing..." : hasOpenOutletOrders ? "Complete orders first" : folioUnsettled ? "Settle folio first" : chargesUnverified ? "Verify charges first" : isCheckIn ? actionLabel : "Yes, check out guest"}
            </button>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ModalFact({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.06] px-3 py-2.5 ring-1 ring-inset ring-white/10">
      <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/45">{label}</p>
      <p className={`m-0 mt-1 truncate text-sm font-bold ${warning ? "text-rose-300" : "text-white"}`} title={value}>{value}</p>
    </div>
  );
}

function AccountAmount({ label, value, currency, positive = false, warning = false, zeroLabel, strong = false }: { label: string; value: number; currency: string; positive?: boolean; warning?: boolean; zeroLabel?: string; strong?: boolean }) {
  const valueClass = warning ? "text-amber-700" : positive ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="min-w-0 border-0 border-l border-solid border-slate-100 px-4 py-3 first:border-l-0 sm:px-5">
      <dt className="m-0 text-[11px] font-medium text-slate-500">{label}</dt>
      <dd className={`m-0 mt-1 truncate tabular-nums ${strong ? "text-sm font-extrabold" : "text-sm font-semibold"} ${valueClass}`}>
        {zeroLabel && Math.abs(value) <= 0.005 ? zeroLabel : `${currency} ${Math.abs(value).toLocaleString()}`}
      </dd>
    </div>
  );
}

const FD_TIME_ZONE = "Africa/Dar_es_Salaam";

function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000));
}

/** Calm loading shapes in the page's own layout: steady panels, one soft sweep. */
function FrontDeskSkeleton() {
  return (
    <div aria-busy="true" aria-label="Preparing today's front desk" className="space-y-5">
      <style>{`
        @keyframes fd-sweep { 0% { background-position: -480px 0 } 100% { background-position: 480px 0 } }
        .fd-l { background: linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 40%, #f1f5f9 80%); background-size: 960px 100%; animation: fd-sweep 1.4s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .fd-l { animation: none; } }
      `}</style>
      {[0, 1].map((card) => (
        <div key={card} className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="fd-l h-10 w-10 rounded-xl" />
            <div className="space-y-2">
              <div className="fd-l h-3.5 w-32 rounded-full" />
              <div className="fd-l h-2.5 w-52 rounded-full" />
            </div>
          </div>
          {[0, 1].map((row) => (
            <div key={row} className="flex items-center gap-3 border-0 border-t border-solid border-slate-100 px-5 py-4">
              <div className="fd-l h-10 w-10 rounded-full" />
              <div className="fd-l h-3 w-40 rounded-full" />
              <div className="fd-l ml-auto h-10 w-28 rounded-xl" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Tonight board. Three readings of the same night:
 * - a ring for how full the hotel will be,
 * - the movement that gets it there (in house, leaving, arriving, tonight),
 * - every sellable room as one square, so 1 of 81 looks like 1 of 81.
 * Counts only; the queues below hold the names.
 */
const TONIGHT_TONES = {
  staying: { label: "Staying on", fill: "#5eead4", dot: "bg-[#5eead4]" },
  arriving: { label: "Arriving", fill: "#38bdf8", dot: "bg-sky-400" },
  turnover: { label: "Turning over", fill: "#fbbf24", dot: "bg-amber-400" },
  free: { label: "Free", fill: "rgba(255,255,255,0.12)", dot: "bg-white/[0.14]" },
} as const;

function OccupancyRing({ segments, total, percent, size = 148, stroke = 14 }: { segments: { key: keyof typeof TONIGHT_TONES; value: number }[]; total: number; percent: number; size?: number; stroke?: number }) {
  const compact = size < 120;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Small gaps between coloured arcs read as separate segments.
  const gap = 3;
  let offset = 0;
  const arcs = total > 0
    ? segments.filter((segment) => segment.key !== "free" && segment.value > 0).map((segment) => {
        const length = Math.max(2, (segment.value / total) * circumference - gap);
        const arc = { key: segment.key, length, offset };
        offset += length + gap;
        return arc;
      })
    : [];
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={TONIGHT_TONES.free.fill} strokeWidth={stroke} />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={TONIGHT_TONES[arc.key].fill}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc.length} ${circumference}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className={`m-0 font-extrabold leading-none tracking-[-0.03em] tabular-nums text-white ${compact ? "text-[22px]" : "text-[34px]"}`}>
            {percent}<span className={compact ? "text-xs text-white/50" : "text-lg text-white/50"}>%</span>
          </p>
          <p className={`m-0 font-semibold text-white/55 ${compact ? "mt-0.5 text-[9.5px]" : "mt-1 text-[11px]"}`}>full tonight</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Tonight, sized to sit on the dark side of the front desk banner: the ring
 * for how full the hotel will be and the movement that gets it there. The
 * queues below hold the names.
 */
function TonightPanel({
  loading,
  totalRooms,
  occupiedRooms,
  occupancyPercent,
  stayingRooms,
  arrivingRooms,
  turnoverRooms,
  freeRooms,
  arrivals,
  departures,
  inHouse,
  attention,
  onRefresh,
}: {
  loading: boolean;
  totalRooms: number;
  occupiedRooms: number;
  occupancyPercent: number;
  stayingRooms: number;
  arrivingRooms: number;
  turnoverRooms: number;
  freeRooms: number;
  arrivals: number;
  departures: number;
  inHouse: number;
  attention: number;
  onRefresh: () => void;
}) {
  const dateLabel = new Date().toLocaleDateString("en-GB", { timeZone: FD_TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
  const shell = "w-full max-w-[540px] rounded-2xl bg-black/30 p-3.5 ring-1 ring-inset ring-white/10 backdrop-blur-md sm:p-4";

  if (loading) {
    return (
      <div className={shell} aria-busy="true" aria-label="Loading tonight">
        <div className="h-3 w-36 rounded-full bg-white/10" />
        <div className="mt-3 flex items-center gap-4">
          <div className="h-[92px] w-[92px] shrink-0 rounded-full border-[9px] border-solid border-white/10" />
          <div className="grid flex-1 grid-cols-4 gap-1.5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl bg-white/[0.06]" />)}</div>
        </div>
      </div>
    );
  }

  const segments = [
    { key: "staying" as const, value: stayingRooms },
    { key: "arriving" as const, value: arrivingRooms },
    { key: "turnover" as const, value: turnoverRooms },
    { key: "free" as const, value: freeRooms },
  ];
  const flow: { label: string; value: string; href?: string; tone: string; last?: boolean }[] = [
    { label: "In house", value: String(inHouse), tone: "text-white" },
    { label: "Leaving", value: departures > 0 ? `\u2212${departures}` : "0", href: "#fd-departures", tone: departures > 0 ? "text-amber-300" : "text-white/35" },
    { label: "Arriving", value: arrivals > 0 ? `+${arrivals}` : "0", href: "#fd-arrivals", tone: arrivals > 0 ? "text-sky-300" : "text-white/35" },
    { label: `Tonight of ${totalRooms}`, value: String(occupiedRooms), tone: "text-[#5eead4]", last: true },
  ];

  return (
    <section aria-label="Tonight at a glance" className={shell}>
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 flex min-w-0 items-baseline gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#5eead4]">Tonight</span>
          <span className="truncate text-[11px] text-white/55">{dateLabel} · EAT</span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {attention > 0 ? (
            <a href="#fd-attention" className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-400/15 px-2.5 text-[11px] font-bold text-amber-200 no-underline ring-1 ring-inset ring-amber-300/40 transition hover:bg-amber-400/25">
              <CircleAlert className="h-3 w-3" aria-hidden />
              {attention} to resolve
            </a>
          ) : (
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-[#5eead4]/10 px-2.5 text-[11px] font-bold text-[#5eead4] ring-1 ring-inset ring-[#5eead4]/30">
              <Check className="h-3 w-3" aria-hidden />
              All clear
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh front desk"
            className="grid h-7 w-7 place-items-center rounded-full border border-solid border-white/15 bg-white/[0.06] text-white/70 transition hover:bg-white/[0.14] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <OccupancyRing segments={segments} total={totalRooms} percent={occupancyPercent} size={92} stroke={9} />
        <div className="min-w-0 flex-1">
          <ol className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
            {flow.map((step) => {
              const body = (
                <>
                  <span className={`block text-lg font-extrabold leading-none tabular-nums ${step.tone}`}>{step.value}</span>
                  <span className="mt-1 block truncate text-[10px] font-medium text-white/55">{step.label}</span>
                </>
              );
              const skin = `block rounded-xl px-2.5 py-2 no-underline transition ${step.last ? "bg-[#5eead4]/10 ring-1 ring-inset ring-[#5eead4]/35" : "bg-white/[0.05] ring-1 ring-inset ring-white/10"}`;
              return (
                <li key={step.label} className="min-w-0">
                  {step.href ? <a href={step.href} className={`${skin} hover:bg-white/[0.1]`}>{body}</a> : <div className={skin}>{body}</div>}
                </li>
              );
            })}
          </ol>
          <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
            {segments.map((segment) => (
              <li key={segment.key} className="flex items-center gap-1.5 text-[10.5px] text-white/60">
                <span className={`h-2 w-2 shrink-0 rounded-full ${TONIGHT_TONES[segment.key].dot}`} aria-hidden />
                <strong className="font-bold tabular-nums text-white">{segment.value}</strong>
                {TONIGHT_TONES[segment.key].label.toLowerCase()}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Queue row layout, shared by the header strip and every row so the two can
 * never drift apart. The grid starts at `xl` so the Action column always fits
 * beside the workspace sidebar on a laptop.
 */
const QUEUE_GRID_WITH_STATUS =
  "xl:grid-cols-[minmax(11rem,1.4fr)_minmax(7rem,0.8fr)_minmax(8rem,0.9fr)_minmax(6rem,0.6fr)_minmax(6.5rem,0.7fr)_8.5rem]";
const QUEUE_GRID =
  "xl:grid-cols-[minmax(11rem,1.4fr)_minmax(7rem,0.85fr)_minmax(8rem,1fr)_minmax(6.5rem,0.75fr)_8.5rem]";

function OperationList({
  id,
  title,
  count,
  countLabel,
  icon,
  tone,
  emptyTitle,
  emptyHint,
  emptyActionHref,
  emptyActionLabel,
  overdueCount = 0,
  showStatusColumn = false,
  children,
}: {
  id: string;
  title: string;
  count: number;
  countLabel: string;
  icon: ReactNode;
  tone: "emerald" | "blue";
  emptyTitle: string;
  emptyHint: string;
  emptyActionHref: string;
  emptyActionLabel: string;
  overdueCount?: number;
  showStatusColumn?: boolean;
  children: ReactNode;
}) {
  const iconSkin = tone === "emerald" ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-sky-50 text-sky-700 ring-sky-100";
  const helper = tone === "emerald"
    ? "Prepare rooms and welcome today's expected guests."
    : overdueCount > 0 ? "Start with overdue stays, then today's check-outs." : "Settle the bill and release the room.";
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
  const [collapsed, setCollapsed] = useState(false);
  const desktopGrid = showStatusColumn ? QUEUE_GRID_WITH_STATUS : QUEUE_GRID;

  return (
    <section id={id} className="min-w-0 scroll-mt-24 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_14px_35px_-32px_rgba(15,23,42,0.45)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${iconSkin}`}>{icon}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-base font-bold tracking-[-0.01em] text-slate-900">{title}</h2>
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#012a26] px-2 text-xs font-bold tabular-nums text-white" aria-label={`${count} ${countLabel}`}>{count}</span>
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-inset ring-rose-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden />
                  {overdueCount} overdue
                </span>
              )}
            </div>
            <p className="m-0 mt-0.5 hidden text-xs text-slate-500 sm:block">{helper}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-solid border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
      </div>

      {!collapsed && (!hasItems ? (
        <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-100 px-4 py-5 sm:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-inset ring-slate-200">
            <CheckCircle2 className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold text-slate-800">{emptyTitle}</p>
            <p className="m-0 mt-0.5 text-xs text-slate-500">{emptyHint}</p>
          </div>
          <Link href={emptyActionHref} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-[#02665e] no-underline transition hover:bg-emerald-50 hover:no-underline">
            {emptyActionLabel} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="min-w-0">
          <div className={`hidden items-center gap-4 border-0 border-t border-solid border-slate-100 bg-slate-50 px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500 sm:px-5 xl:grid ${desktopGrid}`}>
            <span>Guest</span>
            <span>Room</span>
            <span>Stay</span>
            {showStatusColumn && <span>Status</span>}
            <span>Account</span>
            <span className="text-right">Action</span>
          </div>
          <ul role="list" className="m-0 list-none p-0">{children}</ul>
        </div>
      ))}
    </section>
  );
}

function OperationRow({
  reservation,
  detail,
  actionLabel,
  actionTone,
  actionHref = null,
  busy,
  onAction,
  overdue = false,
  showStatus = false,
}: {
  reservation: Reservation;
  detail: string;
  actionLabel: string;
  actionTone: "emerald" | "dark";
  /** When set the action leaves NRMS for this page instead of acting here. */
  actionHref?: string | null;
  busy: boolean;
  onAction: () => void;
  overdue?: boolean;
  showStatus?: boolean;
}) {
  const guestName = reservation.guestProfile?.fullName ?? "Guest";
  const room = roomsLabel(reservation);
  const roomUnassigned = !hasAssignedRoom(reservation);
  const nights = nightsBetween(reservation.checkIn, reservation.checkOut);
  const desktopGrid = showStatus ? QUEUE_GRID_WITH_STATUS : QUEUE_GRID;
  const buttonSkin = actionTone === "emerald"
    ? "bg-[#02665e] text-white hover:bg-[#014d47] focus-visible:ring-[#02665e]"
    : "bg-[#012a26] text-white hover:bg-[#033a34] focus-visible:ring-[#012a26]";
  const actionClass = `col-start-2 row-start-1 inline-flex h-10 w-[8.5rem] shrink-0 items-center justify-center gap-1.5 self-center rounded-xl px-3 text-xs font-bold no-underline transition hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 xl:col-auto xl:row-auto xl:justify-self-end ${buttonSkin}`;

  return (
    <li className={`m-0 list-none border-0 border-t border-solid px-4 py-3.5 transition-colors sm:px-5 ${overdue ? "border-rose-100 bg-rose-50/40 hover:bg-rose-50/70" : "border-slate-100 hover:bg-slate-50/80"}`}>
      <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 xl:items-center ${desktopGrid}`}>
        <div className="col-start-1 flex min-w-0 items-center gap-3 xl:col-auto">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold ${overdue ? "bg-rose-600 text-white" : "bg-[#012a26] text-[#5eead4]"}`}>
            {initials(guestName)}
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-bold text-slate-900" title={guestName}>{guestName}</p>
            <p className="m-0 mt-0.5 truncate text-[11px] font-medium text-slate-500">{sourceLabel(reservation.source)}</p>
          </div>
        </div>

        {/* Below xl the data cells share one wrapping line under the guest. */}
        <div className="col-start-1 flex min-w-0 flex-wrap items-center gap-2 pl-[52px] xl:contents">
          <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 justify-self-start rounded-lg px-2.5 py-1 text-xs font-semibold ${roomUnassigned ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200" : "bg-slate-100 text-slate-800"}`}>
            <BedDouble className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="truncate">{roomUnassigned && room !== "Room not assigned" ? `${room} · no room yet` : room}</span>
          </span>

          <div className="min-w-0">
            <p className={`m-0 truncate text-xs font-semibold ${overdue ? "text-rose-700" : "text-slate-800"}`}>{detail}</p>
            <p className="m-0 mt-0.5 hidden truncate text-[11px] text-slate-500 xl:block">
              {nights} {nights === 1 ? "night" : "nights"} · {shortDate(reservation.checkIn)} to {shortDate(reservation.checkOut)}
            </p>
          </div>

          {showStatus && (
            <span className={`inline-flex shrink-0 items-center gap-1.5 justify-self-start rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${overdue ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-sky-50 text-sky-700 ring-sky-200"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${overdue ? "bg-rose-500" : "bg-sky-500"}`} aria-hidden />
              {overdue ? "Overdue" : "Due today"}
            </span>
          )}

          {hasOutstandingBalance(reservation) ? (
            <span className="inline-flex shrink-0 justify-self-start rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold tabular-nums text-amber-800 ring-1 ring-inset ring-amber-200">
              {reservation.currency} {reservation.balance!.toLocaleString()} due
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 justify-self-start rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <Check className="h-3 w-3" aria-hidden />
              Paid in full
            </span>
          )}
        </div>

        {actionHref ? (
          <Link href={actionHref} className={actionClass}>
            <span className="truncate">{actionLabel}</span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
          </Link>
        ) : (
          <button type="button" onClick={onAction} disabled={busy} className={`${actionClass} border-0 disabled:pointer-events-none disabled:opacity-60`}>
            {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
            <span className="truncate">{busy ? "Working..." : actionLabel}</span>
            {busy ? null : <ArrowRight className="h-3.5 w-3.5 shrink-0" />}
          </button>
        )}
      </div>
    </li>
  );
}

const ATTENTION_GRID = "lg:grid-cols-[minmax(11rem,1.35fr)_minmax(7rem,0.8fr)_minmax(8rem,0.9fr)_minmax(10rem,1.2fr)_7rem]";

function issueSkin(code: string) {
  if (code === "OVERDUE" || code === "EARLY_CHECKIN") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (code === "BALANCE") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-violet-50 text-violet-700 ring-violet-200";
}

function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const tally = [
    { label: "overdue", count: items.filter((item) => item.issues.some((issue) => issue.code === "OVERDUE")).length, code: "OVERDUE" },
    { label: "early check-in", count: items.filter((item) => item.issues.some((issue) => issue.code === "EARLY_CHECKIN")).length, code: "EARLY_CHECKIN" },
    { label: "balance", count: items.filter((item) => item.issues.some((issue) => issue.code === "BALANCE")).length, code: "BALANCE" },
    { label: "room", count: items.filter((item) => item.issues.some((issue) => issue.code === "ROOM")).length, code: "ROOM" },
  ].filter((entry) => entry.count > 0);

  return (
    <section id="fd-attention" className="scroll-mt-24 overflow-hidden rounded-2xl border border-solid border-amber-200 bg-white shadow-[0_14px_35px_-32px_rgba(146,64,14,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
            <CircleAlert className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-base font-bold tracking-[-0.01em] text-slate-900">Needs attention</h2>
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-500 px-2 text-xs font-bold tabular-nums text-white">{items.length}</span>
              {tally.map((entry) => (
                <span key={entry.code} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${issueSkin(entry.code)}`}>
                  {entry.count} {entry.label}
                </span>
              ))}
            </div>
            <p className="m-0 mt-0.5 hidden text-xs text-slate-500 sm:block">Clear these before the business day closes.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} front desk attention`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-solid border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
      </div>
      {!collapsed && (
        <>
          <div className={`hidden items-center gap-4 border-0 border-t border-solid border-slate-100 bg-slate-50 px-5 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500 lg:grid ${ATTENTION_GRID}`}>
            <span>Guest</span>
            <span>Room</span>
            <span>Stay</span>
            <span>Issues</span>
            <span className="text-right">Action</span>
          </div>
          <ul role="list" className="m-0 list-none p-0">
            {items.map((item) => (
              <li key={item.id} className="m-0 list-none border-0 border-t border-solid border-slate-100 px-4 py-3.5 transition-colors hover:bg-slate-50/80 sm:px-5">
                <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 lg:items-center ${ATTENTION_GRID}`}>
                  <div className="col-start-1 flex min-w-0 items-center gap-3 lg:col-auto">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">{initials(item.guest)}</span>
                    <p className="m-0 min-w-0 truncate text-sm font-bold text-slate-900">{item.guest}</p>
                  </div>
                  <div className="col-start-1 flex min-w-0 flex-wrap items-center gap-2 pl-[52px] lg:contents">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 justify-self-start rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">
                      <BedDouble className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                      <span className="truncate">{item.room}</span>
                    </span>
                    <p className="m-0 min-w-0 truncate text-xs text-slate-500">Out {shortDate(item.checkOut)} · {item.source}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {item.issues.map((issue) => (
                        <span key={issue.code} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${issueSkin(issue.code)}`}>{issue.label}</span>
                      ))}
                    </div>
                  </div>
                  <Link
                    href={reservationHref(item)}
                    className="col-start-2 row-start-1 inline-flex h-9 shrink-0 items-center justify-center gap-1.5 self-center rounded-xl border border-solid border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 no-underline transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 hover:no-underline lg:col-auto lg:row-auto lg:justify-self-end"
                  >
                    Review <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
