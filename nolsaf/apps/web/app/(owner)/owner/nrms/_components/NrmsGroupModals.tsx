"use client";
// Group reservations: the shared surface for working a travelling party as one
// unit. Lives here rather than on the reservations page so the sidebar section
// owns it and the reservations table only has to hand over a selection.
//
// Naming note: this is NOT the Owner workspace "Group Stays" (/owner/group-stays),
// which is the NoLSAF-brokered marketplace product. These are NRMS reservations
// tied together by the front desk.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, ArrowRight, BedDouble, Check, CheckCircle2, CreditCard, Loader2, LogIn, LogOut, Users, X } from "lucide-react";
import ModalFrame from "./NrmsModalFrame";
import NrmsGroupRoomsModal from "./NrmsGroupRoomsModal";

export type GroupPickReservation = {
  id: number;
  status: string;
  guestProfile: { fullName: string } | null;
  allocations?: Array<{ roomUnitCode: string | null; roomTypeName: string | null }> | null;
};

export type ReservationGroup = {
  id: number;
  reference: string;
  name: string;
  notes: string | null;
  status: string;
  billingMode: "INDIVIDUAL" | "SPLIT" | "MASTER";
  sourceBlock: {
    id: number;
    reference: string;
    masterFolioReference: string | null;
    masterFolioStatus: string | null;
  } | null;
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

const GROUP_STATUS_CLS: Record<string, string> = {
  ACTIVE: "bg-blue-50 text-blue-700",
  PARTIALLY_CHECKED_IN: "bg-amber-50 text-amber-700",
  CHECKED_IN: "bg-emerald-50 text-emerald-700",
  PARTIALLY_CHECKED_OUT: "bg-amber-50 text-amber-700",
  CHECKED_OUT: "bg-neutral-100 text-neutral-600",
  CANCELLED: "bg-red-50 text-red-600",
};

const inputCls =
  "h-11 w-full min-w-0 max-w-full box-border rounded-xl border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

// Shared column template for the member table. Header and body rows must use
// the same string or the columns drift apart. Room and stay dates collapse into
// the guest cell below sm, so the row keeps 3 columns on a phone and 5 on a desk.
const groupRowCls =
  "grid grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-3 px-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.15fr)_auto_28px]";

function fmtDate(v: string): string {
  return new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function CreateReservationGroupModal({
  propertyId,
  reservationIds,
  reservations,
  onClose,
  onSaved,
}: {
  propertyId: number;
  reservationIds: number[];
  reservations: GroupPickReservation[];
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
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div className="min-w-0">
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
          <textarea className="box-border min-h-24 w-full min-w-0 max-w-full resize-y rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Tour leader, arrival transport, shared preferences…" />
        </label>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Members</p>
          <div>
            {reservations.map((reservation) => (
              <div key={reservation.id} className="min-w-0 rounded-lg bg-white px-3 py-2 text-xs">
                <p className="truncate font-bold text-neutral-900" title={reservation.guestProfile?.fullName ?? "Guest"}>{reservation.guestProfile?.fullName ?? "Guest"}</p>
                <p className="mt-0.5 truncate text-neutral-500">{reservation.allocations?.map((allocation) => allocation.roomUnitCode || allocation.roomTypeName).filter(Boolean).join(", ") || "Room not assigned"} · {reservation.status.replace(/_/g, " ")}</p>
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

function AdvisoryCheckbox({
  tone,
  checked,
  onChange,
  title,
  detail,
}: {
  tone: "amber" | "emerald";
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  detail: string;
}) {
  const t = tone === "amber"
    ? {
        card: checked ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white hover:border-amber-200",
        icon: "bg-amber-100 text-amber-700",
        track: checked ? "bg-amber-600" : "bg-neutral-300",
        title: "text-amber-950",
        detail: "text-neutral-500",
      }
    : {
        card: checked ? "border-emerald-300 bg-emerald-50" : "border-neutral-200 bg-white hover:border-emerald-200",
        icon: "bg-emerald-100 text-emerald-700",
        track: checked ? "bg-emerald-700" : "bg-neutral-300",
        title: "text-emerald-950",
        detail: "text-neutral-500",
      };
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-solid px-3.5 py-3 transition ${t.card}`}>
      <span className="flex min-w-0 items-center gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.icon}`}>
          {tone === "amber" ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0">
          <span className={`block text-xs font-bold leading-4 ${t.title}`}>{title}</span>
          <span className={`mt-0.5 block text-[10px] leading-4 ${t.detail}`}>{detail}</span>
        </span>
      </span>
      <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${t.track}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-500/30 peer-focus-visible:ring-offset-2 ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
      </span>
    </label>
  );
}

type GroupPreviewMember = {
  reservation: ReservationGroup["members"][number];
  eligible: boolean;
  blockers: Array<{ code: string; message: string }>;
  requiredChargeIds: number[];
};

const INDIVIDUAL_FOLIO_BLOCKERS = new Set([
  "GUEST_BALANCE_DUE",
  "GUEST_CREDIT_REMAINS",
  "FOLIO_NOT_SETTLED",
  "CHARGES_NOT_VERIFIED",
  "UNCLASSIFIED_OUTLET_PAYMENTS",
]);

function needsIndividualFolioAction(member: GroupPreviewMember): boolean {
  return member.blockers.some((blocker) => INDIVIDUAL_FOLIO_BLOCKERS.has(blocker.code));
}

function individualFolioActionLabel(member: GroupPreviewMember): string {
  return member.blockers.some((blocker) => blocker.code === "GUEST_BALANCE_DUE" || blocker.code === "FOLIO_NOT_SETTLED")
    ? "Clear payment"
    : "Review folio";
}

export function ReservationGroupModal({ groupId, onClose, onChanged }: { groupId: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const [group, setGroup] = useState<ReservationGroup | null>(null);
  const [accessRole, setAccessRole] = useState("OWNER");
  const [action, setAction] = useState<"CHECK_IN" | "CHECK_OUT">("CHECK_IN");
  const [preview, setPreview] = useState<GroupPreviewMember[] | null>(null);
  const [verifyCharges, setVerifyCharges] = useState(false);
  const [overrideRoomReadiness, setOverrideRoomReadiness] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [confirmExecution, setConfirmExecution] = useState(false);
  const [confirmUngroup, setConfirmUngroup] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [terminalAction, setTerminalAction] = useState<"cancel" | "no-show" | null>(null);
  const [terminalReason, setTerminalReason] = useState("");

  const loadGroup = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<any>(`/api/owner/nrms/reservations/groups/${groupId}`);
      const loadedGroup = response.data?.group ?? null;
      setGroup(loadedGroup);
      setAccessRole(response.data?.accessRole ?? "OWNER");
      if (loadedGroup && ["CHECKED_IN", "PARTIALLY_CHECKED_OUT"].includes(loadedGroup.status)) {
        setAction("CHECK_OUT");
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load reservation group");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { void loadGroup(); }, [loadGroup]);
  useEffect(() => { setPreview(null); setResultMessage(null); setConfirmExecution(false); }, [action, verifyCharges, overrideRoomReadiness]);

  // Detaching never touches the reservation itself, so this is the safe undo
  // for a member picked by mistake: the stay carries on and is worked alone.
  const removeMember = async (reservationId: number) => {
    setBusy(true);
    setError(null);
    setResultMessage(null);
    try {
      const response = await apiClient.delete<any>(`/api/owner/nrms/reservations/groups/${groupId}/members/${reservationId}`);
      setPreview(null);
      await onChanged();
      if (response.data?.groupDeleted) { onClose(); return; }
      await loadGroup();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to remove that reservation from the group");
    } finally {
      setBusy(false);
    }
  };

  const ungroup = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.delete<any>(`/api/owner/nrms/reservations/groups/${groupId}`);
      await onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to ungroup these reservations");
      setBusy(false);
    }
  };

  const review = async () => {
    setBusy(true);
    setError(null);
    setResultMessage(null);
    setConfirmExecution(false);
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
      setConfirmExecution(false);
      setPreview(null);
      await loadGroup();
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to run the group operation");
    } finally {
      setBusy(false);
    }
  };

  const executeTerminalAction = async () => {
    if (!terminalAction || terminalReason.trim().length < 2) return setError("Enter a clear reason before continuing");
    setBusy(true);
    setError(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/reservations/groups/${groupId}/${terminalAction}`, { reason: terminalReason.trim() });
      setGroup(response.data?.group ?? null);
      setTerminalAction(null);
      setTerminalReason("");
      setPreview(null);
      setResultMessage(`${response.data?.affectedCount ?? 0} reservations ${terminalAction === "cancel" ? "cancelled" : "marked no-show"}.`);
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to update the whole group");
    } finally {
      setBusy(false);
    }
  };

  const eligibleCount = preview?.filter((member) => member.eligible).length ?? 0;
  const blockedPreviewMembers = preview?.filter((member) => !member.eligible) ?? [];
  const blockedPreviewCount = blockedPreviewMembers.length;
  const agencyBilled = group ? group.billingMode === "SPLIT" || group.billingMode === "MASTER" : false;
  const billingLabel = group?.billingMode === "MASTER"
    ? "Agency pays rooms and extras"
    : group?.billingMode === "SPLIT"
      ? "Agency pays rooms"
      : "Guests settle individually";
  const preArrivalGroup = group?.members.length ? group.members.every((member) => ["DRAFT", "HELD", "CONFIRMED"].includes(member.status)) : false;
  const confirmedGroup = group?.members.length ? group.members.every((member) => member.status === "CONFIRMED") : false;
  const canCancelGroup = accessRole === "OWNER" || accessRole === "MANAGER";
  return (
    <ModalFrame title={group?.name || "Reservation group"} onClose={onClose} extraWide>
      {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div> : !group ? <p className="py-10 text-center text-sm text-neutral-500">Group not found.</p> : (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                  <Users className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="m-0 truncate font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{group.reference}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="m-0 text-sm font-bold text-neutral-950">{group.memberCount} {group.memberCount === 1 ? "reservation" : "reservations"}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${GROUP_STATUS_CLS[group.status] ?? "bg-neutral-100 text-neutral-600"}`}>{group.status.replace(/_/g, " ")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${agencyBilled ? "bg-blue-50 text-blue-700" : "bg-neutral-100 text-neutral-600"}`}>{billingLabel}</span>
                  </div>
                  {group.notes && <p className="mb-0 mt-1 truncate text-[10px] text-neutral-500">{group.notes}</p>}
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-1 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-1">
                <button type="button" onClick={() => setAction("CHECK_IN")} aria-pressed={action === "CHECK_IN"} className={`inline-flex min-h-10 cursor-pointer appearance-none items-center justify-center gap-2 rounded-lg border-0 px-3 text-xs font-bold transition-all ${action === "CHECK_IN" ? "bg-emerald-700 text-white shadow-sm" : "bg-transparent text-neutral-500 hover:bg-white hover:text-neutral-800"}`}><LogIn className="h-3.5 w-3.5" />Check in</button>
                <button type="button" onClick={() => setAction("CHECK_OUT")} aria-pressed={action === "CHECK_OUT"} className={`inline-flex min-h-10 cursor-pointer appearance-none items-center justify-center gap-2 rounded-lg border-0 px-3 text-xs font-bold transition-all ${action === "CHECK_OUT" ? "bg-emerald-700 text-white shadow-sm" : "bg-transparent text-neutral-500 hover:bg-white hover:text-neutral-800"}`}><LogOut className="h-3.5 w-3.5" />Check out</button>
              </div>
            </div>
          </section>

          {/* Check-in refuses any stay without a room number, so the party is
              offered one screen to set them all rather than twenty visits. */}
          {(() => {
            const missing = group.members.filter(
              (member) => ["CONFIRMED"].includes(member.status) && (member.rooms.length === 0 || member.rooms.some((room) => !room.roomUnitCode)),
            ).length;
            return (
              <div className={`flex flex-col gap-3 rounded-2xl border border-solid p-4 sm:flex-row sm:items-center sm:justify-between ${missing > 0 ? "border-amber-200 bg-amber-50/80" : "border-emerald-100 bg-emerald-50/50"}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ${missing > 0 ? "text-amber-700 ring-1 ring-amber-200" : "text-emerald-700 ring-1 ring-emerald-100"}`}>
                    {missing > 0 ? <BedDouble className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className={`m-0 text-xs font-bold ${missing > 0 ? "text-amber-950" : "text-emerald-950"}`}>
                      {missing > 0 ? `${missing} ${missing === 1 ? "guest needs" : "guests need"} a room` : "Room assignments complete"}
                    </p>
                    <p className={`mb-0 mt-0.5 text-[10px] leading-4 ${missing > 0 ? "text-amber-800" : "text-emerald-800/75"}`}>
                      {missing > 0 ? "Assign every room before starting group check-in." : `All ${group.memberCount} ${group.memberCount === 1 ? "reservation has" : "reservations have"} an assigned room.`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRooms(true)}
                  disabled={busy}
                  className={`inline-flex min-h-10 w-full cursor-pointer appearance-none items-center justify-center gap-2 rounded-xl border border-solid px-3.5 text-xs font-bold shadow-sm transition disabled:opacity-50 sm:w-auto ${missing > 0 ? "border-amber-700 bg-amber-700 text-white hover:bg-amber-800" : "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100"}`}
                >
                  <BedDouble className="h-3.5 w-3.5" /> {missing > 0 ? "Assign rooms" : "Manage rooms"}
                </button>
              </div>
            );
          })()}

          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200">
            <div className={`${groupRowCls} border-0 border-b border-solid border-neutral-200 bg-neutral-50 py-2.5 text-[10px] font-bold uppercase tracking-wide text-neutral-400`}>
              <span>Guest</span>
              <span className="hidden sm:block">Room</span>
              <span className="hidden sm:block">Stay dates</span>
              <span className="text-right">Status</span>
              <span className="sr-only">Remove</span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {group.members.map((member) => {
                const inspected = preview?.find((item) => item.reservation.id === member.id);
                const rooms = member.rooms.map((room) => room.roomUnitCode || room.roomTypeName).filter(Boolean).join(", ") || "Not assigned";
                const stay = `${fmtDate(member.checkIn)} to ${fmtDate(member.checkOut)}`;
                return (
                  <div key={member.id} className="border-0 border-b border-solid border-neutral-100 last:border-b-0">
                    <div className={`${groupRowCls} py-2.5`}>
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-neutral-900" title={member.guestProfile?.fullName ?? "Guest"}>{member.guestProfile?.fullName ?? "Guest"}</p>
                        <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400 sm:hidden">{rooms} · {stay}</p>
                      </div>
                      <p className="m-0 hidden truncate text-xs text-neutral-600 sm:block" title={rooms}>{rooms}</p>
                      <p className="m-0 hidden truncate text-xs tabular-nums text-neutral-500 sm:block">{stay}</p>
                      <span className="text-right">
                        <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${inspected ? inspected.eligible ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700" : STATUS_CLS[member.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                          {inspected ? inspected.eligible ? "Ready" : "Blocked" : member.status.replace(/_/g, " ")}
                        </span>
                      </span>
                      {agencyBilled ? (
                        <span className="h-7 w-7" title="Agency-billed reservations stay linked to their master folio" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => void removeMember(member.id)}
                          disabled={busy}
                          aria-label={`Remove ${member.guestProfile?.fullName ?? "this guest"} from the group`}
                          title="Remove from group. The stay itself is not changed."
                          className="inline-flex h-7 w-7 cursor-pointer appearance-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-neutral-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {inspected && !inspected.eligible && (
                      <div className="flex flex-col gap-2 px-4 pb-3 sm:flex-row sm:items-end sm:justify-between sm:pl-4">
                        <div className="space-y-0.5">
                          {inspected.blockers.map((blocker) => <p key={blocker.code} className="m-0 text-[11px] font-medium leading-4 text-red-700">{blocker.message}</p>)}
                        </div>
                        {action === "CHECK_OUT" && needsIndividualFolioAction(inspected) && (
                          <Link
                            href={`/owner/nrms/reservations?reservationId=${member.id}`}
                            className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-solid border-red-200 bg-white px-3 text-[11px] font-bold text-red-700 no-underline transition hover:border-red-300 hover:bg-red-50 hover:text-red-800 hover:no-underline sm:self-auto"
                          >
                            <CreditCard className="h-3.5 w-3.5" /> {individualFolioActionLabel(inspected)} <ArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {action === "CHECK_IN" && (
              <AdvisoryCheckbox
                tone="amber"
                checked={overrideRoomReadiness}
                onChange={setOverrideRoomReadiness}
                title="Override housekeeping readiness"
                detail="Use only after staff physically confirm every blocked room."
              />
            )}
            {action === "CHECK_OUT" && (
              <AdvisoryCheckbox
                tone="emerald"
                checked={verifyCharges}
                onChange={setVerifyCharges}
                title="I verified every active extra charge"
                detail="Required before group checkout can close charged folios."
              />
            )}
          </div>
          {resultMessage && <p className="m-0 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{resultMessage}</p>}
          {error && <p className="m-0 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {confirmExecution && preview && (
            <section className={`rounded-2xl border border-solid p-4 shadow-sm ${action === "CHECK_OUT" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`} aria-label={`Confirm group ${action === "CHECK_OUT" ? "checkout" : "check-in"}`}>
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ${action === "CHECK_OUT" ? "text-amber-700 ring-amber-200" : "text-emerald-700 ring-emerald-200"}`}>
                  {action === "CHECK_OUT" ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`m-0 text-sm font-bold ${action === "CHECK_OUT" ? "text-amber-950" : "text-emerald-950"}`}>
                    Are you sure you want to {action === "CHECK_OUT" ? "check out" : "check in"} this group?
                  </p>
                  <p className={`mb-0 mt-1 text-xs leading-5 ${action === "CHECK_OUT" ? "text-amber-900" : "text-emerald-900"}`}>
                    {action === "CHECK_OUT"
                      ? eligibleCount > 0
                        ? `${eligibleCount} ready ${eligibleCount === 1 ? "reservation" : "reservations"} in ${group.name} will be checked out. ${blockedPreviewCount ? `${blockedPreviewCount} blocked ${blockedPreviewCount === 1 ? "stay keeps" : "stays keep"} the current status until the issue is cleared.` : "Guest folios will close, departure will be recorded, and rooms will move into the departure workflow."}`
                        : `No reservation in ${group.name} is ready for checkout. Clear the issues below and review readiness again.`
                      : `${eligibleCount} ready ${eligibleCount === 1 ? "reservation" : "reservations"} in ${group.name} will be checked in and their assigned rooms will become occupied.`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold">
                    <span className="rounded-full border border-white/80 bg-white px-2.5 py-1 text-neutral-700">{eligibleCount} ready</span>
                    {blockedPreviewCount > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">{blockedPreviewCount} blocked and unchanged</span>}
                    <span className="rounded-full border border-white/80 bg-white px-2.5 py-1 text-neutral-700">{billingLabel}</span>
                  </div>
                  {blockedPreviewCount > 0 && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-solid border-amber-200 bg-white/90">
                      <div className="border-0 border-b border-solid border-amber-100 px-3 py-2">
                        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-800">Not included in this action</p>
                      </div>
                      <div className="max-h-52 divide-y divide-amber-100 overflow-y-auto">
                        {blockedPreviewMembers.map((member) => {
                          const folioAction = action === "CHECK_OUT" && needsIndividualFolioAction(member);
                          return (
                            <div key={member.reservation.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="m-0 truncate text-xs font-bold text-neutral-900">{member.reservation.guestProfile?.fullName ?? "Guest"}</p>
                                <p className="m-0 mt-0.5 text-[10px] leading-4 text-red-700">{member.blockers.map((blocker) => blocker.message).join(" ")}</p>
                              </div>
                              {folioAction && (
                                <Link
                                  href={`/owner/nrms/reservations?reservationId=${member.reservation.id}`}
                                  className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-solid border-red-200 bg-white px-3 text-[11px] font-bold text-red-700 no-underline transition hover:border-red-300 hover:bg-red-50 hover:text-red-800 hover:no-underline sm:self-auto"
                                >
                                  <CreditCard className="h-3.5 w-3.5" /> {individualFolioActionLabel(member)} <ArrowRight className="h-3 w-3" />
                                </Link>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    {eligibleCount > 0 && (
                      <button type="button" onClick={() => void execute()} disabled={busy} className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border-0 px-4 text-xs font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${action === "CHECK_OUT" ? "bg-amber-700 hover:bg-amber-800" : "bg-emerald-700 hover:bg-emerald-800"}`}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Yes, {action === "CHECK_OUT" ? `check out ${eligibleCount} ready` : "check in group"}
                      </button>
                    )}
                    <button type="button" onClick={() => setConfirmExecution(false)} disabled={busy} className={`min-h-10 cursor-pointer rounded-xl border border-solid bg-white px-4 text-xs font-bold transition disabled:opacity-50 ${action === "CHECK_OUT" ? "border-amber-300 text-amber-900 hover:bg-amber-100" : "border-emerald-300 text-emerald-900 hover:bg-emerald-100"}`}>Not yet</button>
                  </div>
                </div>
              </div>
            </section>
          )}
          {terminalAction && (
            <div className="rounded-xl border border-solid border-red-200 bg-red-50 p-4">
              <p className="m-0 text-sm font-bold text-red-950">{terminalAction === "cancel" ? "Cancel this entire group?" : "Mark the entire group no-show?"}</p>
              <p className="m-0 mt-1 text-xs leading-5 text-red-800">All {group.memberCount} reservations will release their rooms. Agency room charges will be reversed on the master folio; any resulting credit must then be refunded.</p>
              <textarea value={terminalReason} onChange={(e) => { setTerminalReason(e.target.value); setError(null); }} rows={2} maxLength={300} autoFocus placeholder={terminalAction === "cancel" ? "Cancellation reason" : "No-show reason"} className="mt-3 box-border w-full resize-y rounded-lg border border-solid border-red-200 bg-white px-3 py-2 text-xs outline-none focus:border-red-500" />
              <div className="mt-3 flex gap-2"><button type="button" onClick={() => void executeTerminalAction()} disabled={busy} className="cursor-pointer rounded-lg border-0 bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Confirm {terminalAction === "cancel" ? "group cancellation" : "no-show"}</button><button type="button" onClick={() => { setTerminalAction(null); setTerminalReason(""); }} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-800">Keep group</button></div>
            </div>
          )}
          {confirmUngroup && (
            <div className="rounded-xl border border-solid border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><AlertTriangle className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold text-amber-950">Are you sure you want to ungroup this?</p>
                  <p className="m-0 mt-1 text-xs leading-5 text-amber-900">
                    {group.name} will no longer exist as a group. All {group.memberCount} reservations are kept exactly as they are, with the same rooms, dates, folios and payments. Each one is then checked in and out on its own.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void ungroup()} disabled={busy} className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-amber-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-amber-800 disabled:opacity-50">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Yes, ungroup</button>
                    <button type="button" onClick={() => setConfirmUngroup(false)} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50">No, keep the group</button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3 rounded-2xl border border-solid border-neutral-200 bg-neutral-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {preArrivalGroup && canCancelGroup && <button type="button" onClick={() => { setTerminalAction("cancel"); setTerminalReason(""); }} disabled={busy || terminalAction !== null} className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-solid border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">Cancel group</button>}
              {confirmedGroup && <button type="button" onClick={() => { setTerminalAction("no-show"); setTerminalReason(""); }} disabled={busy || terminalAction !== null} className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-solid border-amber-200 bg-white px-3 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50">Mark no-show</button>}
              {agencyBilled ? (
                <span className="self-center text-xs font-semibold text-neutral-500">Agency billing is locked to {group.sourceBlock?.reference ?? "the source block"}</span>
              ) : confirmUngroup ? (
                <span className="self-center text-xs font-semibold text-neutral-400">Confirm above to ungroup</span>
              ) : (
                <button type="button" onClick={() => setConfirmUngroup(true)} disabled={busy} className="inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-xl border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 sm:w-auto">Ungroup</button>
              )}
            </div>
            <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
              <button type="button" onClick={() => void review()} disabled={busy} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-solid border-neutral-300 bg-white px-4 text-xs font-bold text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />}Review readiness</button>
              <button type="button" onClick={() => setConfirmExecution(true)} disabled={busy || !preview || confirmExecution} className="inline-flex min-h-11 cursor-pointer appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"><Check className="h-3.5 w-3.5" />Review {action === "CHECK_IN" ? "check-in" : "checkout"}{preview ? ` (${eligibleCount} ready)` : ""}</button>
            </div>
          </div>

          {showRooms && (
            <NrmsGroupRoomsModal
              groupId={groupId}
              onClose={() => setShowRooms(false)}
              onChanged={async () => {
                // Room numbers change what readiness says, so the preview is
                // dropped rather than left showing a stale blocker.
                setPreview(null);
                await loadGroup();
                await onChanged();
              }}
            />
          )}
        </div>
      )}
    </ModalFrame>
  );
}
