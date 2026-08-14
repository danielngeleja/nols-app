"use client";
// Desk side of the rooming list. The agency filled a link; this is where the
// front office reads what came back, accepts or sends names back, and turns the
// accepted ones into real stays.
//
// Confirming runs the same pickup the desk uses when it names a guest by hand,
// one row at a time, so a name that cannot be picked up says why and leaves the
// rest of the party booked.
import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, Check, Copy, Link2, Loader2, Mail, RotateCcw, Send, ShieldOff, Upload, UserCheck, X } from "lucide-react";
import ModalFrame from "./NrmsModalFrame";
import type { GroupBlockRoom } from "./NrmsGroupBlockModals";

type RoomingRow = {
  id: number;
  blockRoomId: number | null;
  roomTypeName: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  adults: number;
  children: number;
  sharingWith: string | null;
  notes: string | null;
  status: string;
  rejectionReason: string | null;
  reservationId: number | null;
};

type RoomingList = {
  id: number;
  blockId: number;
  publicToken: string;
  status: string;
  expiresAt: string;
  expired: boolean;
  sentAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  submitterName: string | null;
  submitterEmail: string | null;
  deskNotes: string | null;
  instructions: string | null;
  rows: RoomingRow[];
  counts: { total: number; pending: number; accepted: number; rejected: number; confirmed: number };
};

const STATUS_CLS: Record<string, string> = {
  DRAFT: "bg-neutral-100 text-neutral-600",
  SENT: "bg-blue-50 text-blue-700",
  SUBMITTED: "bg-amber-50 text-amber-700",
  RETURNED: "bg-amber-50 text-amber-700",
  CONFIRMED: "bg-emerald-50 text-emerald-700",
  REVOKED: "bg-red-50 text-red-600",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Not sent",
  SENT: "Waiting on the agency",
  SUBMITTED: "Names received",
  RETURNED: "Sent back for fixing",
  CONFIRMED: "Confirmed",
  REVOKED: "Revoked",
};

const ROW_CLS: Record<string, string> = {
  PENDING: "bg-neutral-100 text-neutral-600",
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-600",
};

const inputCls =
  "box-border h-10 w-full min-w-0 max-w-full rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

const textareaCls =
  "box-border min-h-20 w-full min-w-0 max-w-full resize-y rounded-xl border border-solid border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

function fmtDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function publicLink(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/nrms/rooming-list/${token}`;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

export default function NrmsRoomingListModal({
  blockId,
  blockRooms,
  onClose,
  onChanged,
}: {
  blockId: number;
  blockRooms: GroupBlockRoom[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [list, setList] = useState<RoomingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [copied, setCopied] = useState(false);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [deskNotes, setDeskNotes] = useState("");
  const [failures, setFailures] = useState<Array<{ rowId: number; fullName: string; error: string }>>([]);
  const [roomChoice, setRoomChoice] = useState<Record<number, number | "">>({});
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);

  const applyList = useCallback((next: RoomingList | null) => {
    setList(next);
    setRoomChoice(Object.fromEntries((next?.rows ?? []).map((row) => [row.id, row.blockRoomId ?? ""])));
  }, []);

  const load = useCallback(async () => {
    const response = await apiClient.get<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}`);
    applyList(response.data?.roomingList ?? null);
  }, [applyList, blockId]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}`)
      .then((response) => { if (!cancelled) applyList(response.data?.roomingList ?? null); })
      .catch((e: any) => { if (!cancelled) setError(e?.response?.data?.error || "Failed to load the rooming list"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applyList, blockId]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e: any) {
      setError(e?.response?.data?.error || "That did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const createLink = () => run(async () => {
    await apiClient.post<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}`, {
      instructions: instructions.trim() || null,
    });
    await load();
  });

  const regenerate = () => run(async () => {
    await apiClient.post<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}`, {});
    await load();
  });

  const emailLink = () => run(async () => {
    const response = await apiClient.post<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}/send`, {});
    setDeliveryNotice(`Rooming-list link sent to ${response.data?.sentToEmail}.`);
    await load();
  });

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error("CSV_EMPTY");
      const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
      const indexOf = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
      const nameIndex = indexOf("fullname", "guestname", "name");
      if (nameIndex < 0) throw new Error("CSV_NAME_HEADER");
      const field = (cells: string[], ...names: string[]) => { const index = indexOf(...names); return index >= 0 ? cells[index]?.trim() || null : null; };
      const rows = lines.slice(1).map(parseCsvLine).filter((cells) => cells[nameIndex]?.trim()).map((cells) => ({
        fullName: cells[nameIndex].trim(),
        phone: field(cells, "phone", "phonenumber"),
        email: field(cells, "email", "emailaddress"),
        nationality: field(cells, "nationality"),
        adults: Number(field(cells, "adults") || 1),
        children: Number(field(cells, "children") || 0),
        roomType: field(cells, "roomtype", "room"),
        sharingWith: field(cells, "sharingwith"),
        notes: field(cells, "notes", "note"),
      }));
      if (!rows.length) throw new Error("CSV_EMPTY");
      await run(async () => {
        const response = await apiClient.post<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}/import`, { rows });
        setDeliveryNotice(`${response.data?.importedCount ?? rows.length} guest names imported for review.`);
        await load();
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CSV_NAME_HEADER") setError("The CSV needs a Full Name column");
      else if (error instanceof Error && error.message === "CSV_EMPTY") setError("The CSV has no guest rows to import");
      else setError("The CSV could not be read");
    }
  };

  const revoke = () => run(async () => {
    await apiClient.post<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}/revoke`, {});
    await load();
  });

  // The room choice is held here until the desk accepts the row. Writing it on
  // every select change would accept names by accident, which is the one thing
  // this screen must never do quietly.
  const accept = (rowId: number) => run(async () => {
    const choice = roomChoice[rowId];
    await apiClient.post<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}/rows/${rowId}/accept`, {
      blockRoomId: choice === "" || choice === undefined ? null : choice,
    });
    await load();
  });

  const reject = (rowId: number) => run(async () => {
    await apiClient.post<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}/rows/${rowId}/reject`, { rejectionReason: rejectionReason.trim() });
    setRejectingId(null);
    setRejectionReason("");
    await load();
  });

  const sendBack = () => run(async () => {
    await apiClient.post<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}/return`, { deskNotes: deskNotes.trim() });
    setReturning(false);
    setDeskNotes("");
    await load();
  });

  const confirmAccepted = () => run(async () => {
    setFailures([]);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/rooming-lists/blocks/${blockId}/confirm`, {});
      setFailures(response.data?.failed ?? []);
    } catch (e: any) {
      const failed = e?.response?.data?.failed;
      if (Array.isArray(failed) && failed.length) setFailures(failed);
      else throw e;
    }
    await load();
    await onChanged();
  });

  const copyLink = async () => {
    if (!list) return;
    try {
      await navigator.clipboard.writeText(publicLink(list.publicToken));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const live = list ? !["REVOKED", "CONFIRMED"].includes(list.status) : false;

  return (
    <ModalFrame
      title="Rooming list"
      subtitle="Collect the guest names from the agency, then confirm them into stays"
      onClose={onClose}
      extraWide
      elevated
    >
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
      ) : !list ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 p-4">
            <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <p className="m-0 text-sm font-bold text-emerald-950">Send the agency one link instead of taking names by phone</p>
              <p className="m-0 mt-1 text-xs leading-5 text-emerald-800">
                They fill in who is staying, you check the names here and confirm them. Nothing they type books a room on its own.
              </p>
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Instructions for the agency <span className="font-normal text-neutral-400">(optional)</span></span>
            <textarea
              className={textareaCls}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Names exactly as in the passport, one line per room, flight numbers if you have them"
            />
          </label>
          {error && <p className="m-0 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end">
            <button type="button" onClick={createLink} disabled={busy} className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Create the link
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${STATUS_CLS[list.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                {STATUS_LABEL[list.status] ?? list.status}
              </span>
              <span className="text-[11px] font-semibold text-neutral-500">
                {list.expired ? "Link expired" : `Link works until ${fmtDate(list.expiresAt)}`}
              </span>
            </div>

            {live && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-[11px] text-neutral-600">{publicLink(list.publicToken)}</code>
                <button type="button" onClick={() => void copyLink()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}

            {list.submitterName && (
              <p className="m-0 mt-3 text-xs text-neutral-500">
                Sent by <span className="font-bold text-neutral-800">{list.submitterName}</span>
                {list.submitterEmail ? ` (${list.submitterEmail})` : ""}
                {list.submittedAt ? ` on ${fmtDate(list.submittedAt)}` : ""}
              </p>
            )}
            {deliveryNotice && <p className="m-0 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">{deliveryNotice}</p>}
          </div>

          {list.rows.length === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-10 text-center text-sm text-neutral-500">
              The agency has not sent any names yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-solid border-neutral-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                      <th className="px-4 py-2.5">Guest</th>
                      <th className="px-4 py-2.5">Room</th>
                      <th className="px-4 py-2.5 text-center">Party</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((row) => (
                      <tr key={row.id} className="border-0 border-b border-solid border-neutral-100 last:border-b-0 align-top">
                        <td className="max-w-64 px-4 py-3">
                          <span className="block truncate font-bold text-neutral-900">{row.fullName}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{[row.phone, row.email, row.nationality].filter(Boolean).join(" · ") || "No contact details"}</span>
                          {row.sharingWith && <span className="mt-0.5 block truncate text-[11px] text-neutral-400">Sharing with {row.sharingWith}</span>}
                          {row.notes && <span className="mt-0.5 block truncate text-[11px] text-neutral-400">{row.notes}</span>}
                          {row.status === "REJECTED" && row.rejectionReason && (
                            <span className="mt-1 block text-[11px] font-semibold text-red-600">Sent back: {row.rejectionReason}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {row.reservationId ? (
                            <span className="text-xs text-neutral-600">{row.roomTypeName ?? "Room"}</span>
                          ) : (
                            <select
                              aria-label={`Room type for ${row.fullName}`}
                              className="box-border h-9 w-40 min-w-0 cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-2 text-xs"
                              value={roomChoice[row.id] ?? ""}
                              disabled={busy || row.status === "ACCEPTED"}
                              onChange={(event) => setRoomChoice((current) => ({ ...current, [row.id]: event.target.value ? Number(event.target.value) : "" }))}
                            >
                              <option value="">Not chosen</option>
                              {blockRooms.map((line) => (
                                <option key={line.id} value={line.id}>{line.roomTypeName ?? "Room"} ({line.held} left)</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-center tabular-nums text-neutral-600">
                          {row.adults}{row.children > 0 ? ` + ${row.children}` : ""}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${ROW_CLS[row.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                            {row.reservationId ? "Booked" : row.status === "PENDING" ? "Waiting" : row.status === "ACCEPTED" ? "Accepted" : "Sent back"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {!row.reservationId && live && (
                            rejectingId === row.id ? (
                              <div className="flex flex-col items-end gap-2">
                                <input
                                  className={`${inputCls} h-9 w-56 text-xs`}
                                  value={rejectionReason}
                                  onChange={(event) => setRejectionReason(event.target.value)}
                                  placeholder="What should the agency fix?"
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => reject(row.id)} disabled={busy || rejectionReason.trim().length < 2} className="cursor-pointer appearance-none rounded-lg border-0 bg-amber-700 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-amber-800 disabled:opacity-50">Send back</button>
                                  <button type="button" onClick={() => { setRejectingId(null); setRejectionReason(""); }} className="cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-neutral-600 transition hover:bg-neutral-50">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="inline-flex gap-2">
                                {row.status !== "ACCEPTED" && (
                                  <button type="button" onClick={() => accept(row.id)} disabled={busy} className="inline-flex cursor-pointer appearance-none items-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                                    <Check className="h-3 w-3" /> Accept
                                  </button>
                                )}
                                {row.status !== "REJECTED" && (
                                  <button type="button" onClick={() => { setRejectingId(row.id); setRejectionReason(""); }} disabled={busy} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-neutral-600 transition hover:border-amber-300 hover:text-amber-800 disabled:opacity-50">
                                    <X className="h-3 w-3" /> Send back
                                  </button>
                                )}
                              </div>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {failures.length > 0 && (
            <div className="rounded-xl border border-solid border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold text-amber-950">{failures.length} {failures.length === 1 ? "name was" : "names were"} not confirmed</p>
                  <ul className="m-0 mt-1.5 list-disc pl-4 text-xs leading-5 text-amber-900">
                    {failures.map((failure) => <li key={failure.rowId}><span className="font-bold">{failure.fullName}</span>: {failure.error}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {returning && (
            <div className="rounded-xl border border-solid border-amber-300 bg-amber-50 p-4">
              <p className="m-0 text-sm font-bold text-amber-950">Send the list back to the agency</p>
              <p className="m-0 mt-1 text-xs leading-5 text-amber-900">They see this note when they open the link and can fix the names in place.</p>
              <textarea
                className={`${textareaCls} mt-3`}
                value={deskNotes}
                onChange={(event) => setDeskNotes(event.target.value)}
                placeholder="Two names are missing passports, and the twin room needs a second guest."
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={sendBack} disabled={busy || deskNotes.trim().length < 2} className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-amber-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-amber-800 disabled:opacity-50">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send it back
                </button>
                <button type="button" onClick={() => setReturning(false)} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50">Cancel</button>
              </div>
            </div>
          )}

          {error && <p className="m-0 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          {live && !returning && (
            <div className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-neutral-50/70 shadow-sm">
              <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">List progress</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {list.counts.accepted} accepted
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {list.counts.pending} waiting
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-neutral-700 ring-1 ring-inset ring-neutral-200">
                    <Check className="h-3 w-3 text-emerald-600" />
                    {list.counts.confirmed} booked
                  </span>
                </div>

                {list.counts.accepted > list.counts.confirmed && (
                  <button type="button" onClick={confirmAccepted} disabled={busy} className="inline-flex h-10 shrink-0 cursor-pointer appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 hover:shadow disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                    Confirm accepted names
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-0 border-t border-solid border-neutral-200 bg-white px-3 py-2">
                <span className="mr-1 hidden text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400 sm:inline">Link tools</span>
                <button type="button" onClick={emailLink} disabled={busy} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
                  <Mail className="h-3.5 w-3.5" /> Email link
                </button>
                <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold text-neutral-600 transition hover:bg-neutral-100 ${busy ? "pointer-events-none opacity-50" : ""}`}>
                  <Upload className="h-3.5 w-3.5" /> Import CSV
                  <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void importCsv(file); }} />
                </label>
                {list.rows.length > 0 && (
                  <button type="button" onClick={() => { setReturning(true); setDeskNotes(list.deskNotes ?? ""); }} disabled={busy} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2.5 text-[11px] font-bold text-neutral-600 transition hover:bg-amber-50 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-50">
                    <Send className="h-3.5 w-3.5" /> Send back
                  </button>
                )}
                <span className="mx-0.5 hidden h-4 w-px bg-neutral-200 sm:block" aria-hidden="true" />
                <button type="button" onClick={regenerate} disabled={busy} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2.5 text-[11px] font-bold text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50">
                  <RotateCcw className="h-3.5 w-3.5" /> New link
                </button>
                <button type="button" onClick={revoke} disabled={busy} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2.5 text-[11px] font-bold text-neutral-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                  <ShieldOff className="h-3.5 w-3.5" /> Revoke
                </button>
              </div>
            </div>
          )}

          {list.status === "REVOKED" && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 pt-4">
              <span className="mr-auto text-[11px] font-semibold text-neutral-500">This link no longer opens. The names collected are kept.</span>
              <button type="button" onClick={regenerate} disabled={busy} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50">
                <RotateCcw className="h-3.5 w-3.5" /> Issue a new link
              </button>
            </div>
          )}
        </div>
      )}
    </ModalFrame>
  );
}
