"use client";
// Group reservations: the shared surface for working a travelling party as one
// unit. Lives here rather than on the reservations page so the sidebar section
// owns it and the reservations table only has to hand over a selection.
//
// Naming note: this is NOT the Owner workspace "Group Stays" (/owner/group-stays),
// which is the NoLSAF-brokered marketplace product. These are NRMS reservations
// tied together by the front desk.
import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, BedDouble, Check, Loader2, Users, X } from "lucide-react";
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
          <div className="grid gap-2 sm:grid-cols-2">
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
        card: checked ? "border-amber-400 bg-amber-100/70" : "border-amber-200 bg-amber-50 hover:border-amber-300",
        box: "border-amber-400 checked:border-amber-600 checked:bg-amber-600 focus-visible:ring-amber-500/40",
        title: "text-amber-950",
        detail: "text-amber-800",
      }
    : {
        card: checked ? "border-emerald-400 bg-emerald-100/70" : "border-emerald-200 bg-emerald-50 hover:border-emerald-300",
        box: "border-emerald-500 checked:border-emerald-700 checked:bg-emerald-700 focus-visible:ring-emerald-500/40",
        title: "text-emerald-950",
        detail: "text-emerald-800",
      };
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border border-solid p-3.5 transition ${t.card}`}>
      <span className="relative mt-px inline-flex h-5 w-5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className={`peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-solid bg-white shadow-sm outline-none transition focus-visible:ring-2 ${t.box}`}
        />
        <Check className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 stroke-[3] text-white opacity-0 transition-opacity peer-checked:opacity-100" />
      </span>
      <span className="min-w-0">
        <span className={`block text-xs font-bold leading-5 ${t.title}`}>{title}</span>
        <span className={`mt-0.5 block text-xs leading-5 ${t.detail}`}>{detail}</span>
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

export function ReservationGroupModal({ groupId, onClose, onChanged }: { groupId: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const [group, setGroup] = useState<ReservationGroup | null>(null);
  const [action, setAction] = useState<"CHECK_IN" | "CHECK_OUT">("CHECK_IN");
  const [preview, setPreview] = useState<GroupPreviewMember[] | null>(null);
  const [verifyCharges, setVerifyCharges] = useState(false);
  const [overrideRoomReadiness, setOverrideRoomReadiness] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [confirmUngroup, setConfirmUngroup] = useState(false);
  const [showRooms, setShowRooms] = useState(false);

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
          <div className="grid items-center gap-3 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">{group.reference}</p>
              <p className="m-0 mt-1 text-sm font-bold text-neutral-900">{group.memberCount} reservations · {group.status.replace(/_/g, " ")}</p>
              {group.notes && <p className="m-0 mt-1 text-xs text-neutral-500">{group.notes}</p>}
            </div>
            <div className="flex shrink-0 gap-1 rounded-lg border border-solid border-neutral-200 bg-white p-1">
              <button type="button" onClick={() => setAction("CHECK_IN")} className={`cursor-pointer appearance-none rounded-md border-0 px-3 py-2 text-xs font-bold transition ${action === "CHECK_IN" ? "bg-emerald-700 text-white" : "bg-transparent text-neutral-500 hover:bg-neutral-100"}`}>Group check-in</button>
              <button type="button" onClick={() => setAction("CHECK_OUT")} className={`cursor-pointer appearance-none rounded-md border-0 px-3 py-2 text-xs font-bold transition ${action === "CHECK_OUT" ? "bg-emerald-700 text-white" : "bg-transparent text-neutral-500 hover:bg-neutral-100"}`}>Group checkout</button>
            </div>
          </div>

          {/* Check-in refuses any stay without a room number, so the party is
              offered one screen to set them all rather than twenty visits. */}
          {(() => {
            const missing = group.members.filter(
              (member) => ["CONFIRMED"].includes(member.status) && (member.rooms.length === 0 || member.rooms.some((room) => !room.roomUnitCode)),
            ).length;
            return (
              <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid p-4 ${missing > 0 ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-neutral-50"}`}>
                <p className={`m-0 inline-flex items-center gap-2 text-xs font-bold ${missing > 0 ? "text-amber-950" : "text-neutral-700"}`}>
                  <BedDouble className={`h-4 w-4 ${missing > 0 ? "text-amber-700" : "text-emerald-700"}`} />
                  {missing > 0
                    ? `${missing} ${missing === 1 ? "guest has" : "guests have"} no room yet, so check-in will refuse ${missing === 1 ? "them" : "them"}`
                    : "Every guest in this group has a room"}
                </p>
                <button
                  type="button"
                  onClick={() => setShowRooms(true)}
                  disabled={busy}
                  className={`inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 px-3.5 py-2 text-xs font-bold text-white transition disabled:opacity-50 ${missing > 0 ? "bg-amber-700 hover:bg-amber-800" : "bg-emerald-700 hover:bg-emerald-800"}`}
                >
                  <BedDouble className="h-3.5 w-3.5" /> Assign rooms
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
                    </div>
                    {inspected && !inspected.eligible && (
                      <div className="space-y-0.5 px-4 pb-2.5 sm:pl-4">
                        {inspected.blockers.map((blocker) => <p key={blocker.code} className="m-0 text-[11px] font-medium leading-4 text-red-700">{blocker.message}</p>)}
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
          <div className="flex flex-wrap items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 pt-4">
            {confirmUngroup ? (
              <span className="mr-auto text-xs font-semibold text-neutral-400">Confirm above to ungroup</span>
            ) : (
              <button type="button" onClick={() => setConfirmUngroup(true)} disabled={busy} className="mr-auto cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-600 transition hover:border-red-200 hover:text-red-700 disabled:opacity-50">Ungroup</button>
            )}
            <button type="button" onClick={() => void review()} disabled={busy} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-solid border-neutral-300 bg-white px-4 py-2.5 text-sm font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Review readiness</button>
            <button type="button" onClick={() => void execute()} disabled={busy || !preview || eligibleCount === 0} className="cursor-pointer appearance-none rounded-lg border-0 bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-40">Confirm {action === "CHECK_IN" ? "group check-in" : "group checkout"}{preview ? ` (${eligibleCount})` : ""}</button>
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
