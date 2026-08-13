"use client";
// Giving a whole party its room numbers in one screen.
//
// A rooming list confirms into stays that carry a room type but no room number,
// and check-in refuses a stay without one. Before this screen existed a party of
// twenty had to be opened twenty times, one reservation at a time, before the
// bus could be checked in.
import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, BedDouble, Check, Loader2, Sparkles, Wand2 } from "lucide-react";
import ModalFrame from "./NrmsModalFrame";

type RoomOption = { roomUnitId: number; code: string; housekeepingStatus: string; free: boolean };

type AssignmentRow = {
  allocationId: number;
  reservationId: number;
  guestName: string;
  roomTypeId: number;
  roomTypeName: string | null;
  roomUnitId: number | null;
  roomUnitCode: string | null;
  housekeepingStatus: string | null;
  options: RoomOption[];
};

type Failure = { allocationId: number; guestName: string; error: string };

/** Housekeeping states a room can be handed over in without an override. */
const READY = ["CLEAN", "INSPECTED"];

export default function NrmsGroupRoomsModal({
  groupId,
  onClose,
  onChanged,
}: {
  groupId: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  // Choices the desk has made but not saved yet, keyed by allocation.
  const [picked, setPicked] = useState<Record<number, number | "">>({});

  const load = useCallback(async () => {
    const response = await apiClient.get<any>(`/api/owner/nrms/reservations/groups/${groupId}/rooms`);
    const next: AssignmentRow[] = response.data?.rows ?? [];
    setRows(next);
    setPicked(Object.fromEntries(next.map((row) => [row.allocationId, row.roomUnitId ?? ""])));
    return next;
  }, [groupId]);

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((e: any) => { if (!cancelled) setError(e?.response?.data?.error || "Failed to load the rooms for this group"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  const unassigned = useMemo(() => rows.filter((row) => row.roomUnitId == null).length, [rows]);
  // A room already picked elsewhere on this screen is not offered twice.
  const claimed = useMemo(() => {
    const counts = new Map<number, number>();
    for (const value of Object.values(picked)) {
      if (value === "") continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }, [picked]);
  const pendingChanges = useMemo(
    () => rows.filter((row) => picked[row.allocationId] !== "" && picked[row.allocationId] !== (row.roomUnitId ?? "")),
    [picked, rows],
  );
  const doubleBooked = useMemo(() => Array.from(claimed.values()).some((count) => count > 1), [claimed]);

  const run = async (body: Record<string, unknown>, successNote: (assigned: number) => string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setFailures([]);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/reservations/groups/${groupId}/rooms`, body);
      setFailures(response.data?.failed ?? []);
      await load();
      await onChanged();
      const assigned = response.data?.assignedCount ?? 0;
      if (assigned > 0) setNotice(successNote(assigned));
      else if (!(response.data?.failed ?? []).length) setNotice("Nothing needed changing.");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to assign rooms for this group");
    } finally {
      setBusy(false);
    }
  };

  const autoAssign = () => run(
    { autoAssignRemaining: true },
    (assigned) => `${assigned} ${assigned === 1 ? "room" : "rooms"} assigned automatically.`,
  );

  const saveChoices = () => run(
    { assignments: pendingChanges.map((row) => ({ allocationId: row.allocationId, roomUnitId: Number(picked[row.allocationId]) })) },
    (assigned) => `${assigned} ${assigned === 1 ? "room" : "rooms"} saved.`,
  );

  return (
    <ModalFrame
      title="Assign rooms"
      subtitle="Give the whole party its room numbers before check-in"
      onClose={onClose}
      extraWide
      elevated
    >
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
      ) : rows.length === 0 ? (
        <p className="m-0 py-10 text-center text-sm text-neutral-500">
          No stay in this group is waiting for a room. Rooms can only be set before a guest checks in.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-4">
            <p className="m-0 inline-flex items-center gap-2 text-xs font-bold text-neutral-700">
              <BedDouble className="h-4 w-4 text-emerald-700" />
              {unassigned === 0 ? "Every guest has a room" : `${unassigned} of ${rows.length} still without a room`}
            </p>
            {unassigned > 0 && (
              <button
                type="button"
                onClick={autoAssign}
                disabled={busy}
                className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Fill the rest automatically
              </button>
            )}
          </div>

          {notice && (
            <p className="m-0 inline-flex w-full items-center gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              <Check className="h-4 w-4 shrink-0" /> {notice}
            </p>
          )}
          {error && <p className="m-0 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {failures.length > 0 && (
            <div className="rounded-xl border border-solid border-amber-300 bg-amber-50 p-4">
              <p className="m-0 inline-flex items-center gap-2 text-sm font-bold text-amber-950">
                <AlertTriangle className="h-4 w-4" /> {failures.length} {failures.length === 1 ? "guest" : "guests"} could not be given a room
              </p>
              <ul className="m-0 mt-1.5 list-disc pl-5 text-xs leading-5 text-amber-900">
                {failures.map((failure) => (
                  <li key={failure.allocationId}><span className="font-bold">{failure.guestName}</span>: {failure.error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="px-4 py-2.5">Guest</th>
                    <th className="px-4 py-2.5">Room type</th>
                    <th className="px-4 py-2.5">Room</th>
                    <th className="px-4 py-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const choice = picked[row.allocationId] ?? "";
                    const clash = choice !== "" && (claimed.get(choice) ?? 0) > 1;
                    const changed = choice !== "" && choice !== (row.roomUnitId ?? "");
                    return (
                      <tr key={row.allocationId} className="border-0 border-b border-solid border-neutral-100 last:border-b-0">
                        <td className="max-w-56 px-4 py-2.5">
                          <span className="block truncate font-semibold text-neutral-900">{row.guestName}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-neutral-600">{row.roomTypeName ?? "Room"}</td>
                        <td className="px-4 py-2.5">
                          <select
                            aria-label={`Room for ${row.guestName}`}
                            className={`box-border h-9 w-44 min-w-0 cursor-pointer rounded-lg border border-solid bg-white px-2 text-xs ${clash ? "border-red-400" : changed ? "border-emerald-400" : "border-neutral-300"}`}
                            value={choice}
                            disabled={busy}
                            onChange={(event) => setPicked((current) => ({ ...current, [row.allocationId]: event.target.value ? Number(event.target.value) : "" }))}
                          >
                            <option value="">Not assigned</option>
                            {row.options.map((option) => (
                              <option key={option.roomUnitId} value={option.roomUnitId} disabled={!option.free && option.roomUnitId !== row.roomUnitId}>
                                {option.code}
                                {!option.free && option.roomUnitId !== row.roomUnitId ? " (taken)" : READY.includes(option.housekeepingStatus) ? "" : " (not ready)"}
                              </option>
                            ))}
                          </select>
                          {clash && <span className="mt-1 block text-[11px] font-semibold text-red-600">Two guests cannot share this room</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          {row.roomUnitId == null ? (
                            <span className="inline-block rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">No room</span>
                          ) : READY.includes(row.housekeepingStatus ?? "") ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                              <Sparkles className="h-3 w-3" /> Ready
                            </span>
                          ) : (
                            <span className="inline-block rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold text-neutral-600">
                              {(row.housekeepingStatus ?? "").replace(/_/g, " ").toLowerCase() || "assigned"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 pt-4">
            <span className="mr-auto text-[11px] font-semibold text-neutral-500">
              {pendingChanges.length > 0 ? `${pendingChanges.length} unsaved ${pendingChanges.length === 1 ? "change" : "changes"}` : "Rooms are up to date"}
            </span>
            <button type="button" onClick={onClose} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-3.5 py-2 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50">
              Close
            </button>
            <button
              type="button"
              onClick={saveChoices}
              disabled={busy || pendingChanges.length === 0 || doubleBooked}
              className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save room numbers
            </button>
          </div>
        </div>
      )}
    </ModalFrame>
  );
}
