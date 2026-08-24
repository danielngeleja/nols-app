"use client";
// Agent booking requests (request-to-book queue). The hotel approves or declines
// pending holds before they expire. Instant-confirm bookings never appear here.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { BedDouble, CheckCircle2, Clock, Inbox, Loader2, Users, X, XCircle } from "lucide-react";
import { useNrms } from "../../_components/NrmsProvider";

type IncidentalCover = { billing: string | null; scope: string | null; categories: string[]; capAmount: number | null; capBasis: string | null; headline: string; detail: string };
type Request = {
  id: number; status: string; agency: { legalName: string; reference: string } | null; bookingMode: string | null;
  roomType: string | null; checkIn: string; checkOut: string; adults: number; children: number; rooms: number;
  currency: string; total: number; holdExpiresAt: string | null; decidedAt: string | null; decisionReason: string | null;
  notes: string | null; createdAt: string;
  manifest: { status: string; incidentalBilling: "AGENCY" | "INDIVIDUAL_GUEST" | null; incidentalCover: IncidentalCover; guestsAdded: number; requiredGuests: number; documentsUploaded: number; reviewNote: string | null };
};

const money = (n: number) => Math.round(n).toLocaleString();
const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const nights = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

const DECIDED: Record<string, { cls: string; label: string; Icon: any }> = {
  CONFIRMED: { cls: "bg-emerald-50 text-emerald-700", label: "Approved", Icon: CheckCircle2 },
  DECLINED: { cls: "bg-red-50 text-red-600", label: "Declined", Icon: XCircle },
  EXPIRED: { cls: "bg-neutral-100 text-neutral-500", label: "Expired", Icon: XCircle },
  CANCELLED: { cls: "bg-neutral-100 text-neutral-500", label: "Cancelled", Icon: XCircle },
};

function initials(name?: string | null) {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (w.length ? (w[0]![0]! + (w[1]?.[0] ?? "")) : "AG").toUpperCase();
}

function timeLeft(iso: string | null): { text: string; urgent: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { text: "expired", urgent: true };
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return { text: h >= 1 ? `${h}h ${m}m left` : `${m}m left`, urgent: ms < 3 * 3600000 };
}

export default function AgentRequestsPage() {
  const { selectedPropertyId } = useNrms();
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectFor, setRejectFor] = useState<Request | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setError(null);
    try {
      const res = await apiClient.get<any>(`/api/owner/nrms/agents/property/${selectedPropertyId}/requests`);
      setRequests(res.data?.requests ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load booking requests");
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

  const pending = useMemo(() => (requests ?? []).filter((r) => r.status === "PENDING"), [requests]);
  const decided = useMemo(() => (requests ?? []).filter((r) => r.status !== "PENDING"), [requests]);

  const decide = useCallback(async (id: number, action: "approve" | "reject", reason?: string) => {
    setBusyId(id); setError(null); setNotice(null);
    try {
      await apiClient.post(`/api/owner/nrms/agents/requests/${id}/${action}`, action === "reject" ? { reason } : {});
      setNotice(action === "approve" ? "Booking approved. The agent has been notified." : "Request declined. The agent has been notified.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "The action could not be completed");
    } finally {
      setBusyId(null);
    }
  }, [load]);

  if (!selectedPropertyId) {
    return <div className="rounded-xl border border-solid border-neutral-200 bg-white p-6 text-sm text-neutral-600">Select a property to see its agent booking requests.</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="m-0 flex items-center gap-2 text-lg font-bold text-neutral-900"><Inbox className="h-5 w-5 text-emerald-600" /> Agent requests</h1>
        <p className="m-0 mt-1 text-[13px] text-neutral-500">Approve or decline request-to-book holds before they expire. Instant-confirm bookings do not need review.</p>
      </div>

      {notice && <div className="rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{notice}</div>}
      {error && <div className="rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}

      {requests === null ? (
        <div className="flex items-center gap-2 rounded-2xl border border-solid border-neutral-200 bg-white p-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <>
          {/* Pending queue */}
          <section>
            <h2 className="m-0 mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-neutral-500">Pending {pending.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">{pending.length}</span>}</h2>
            {pending.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-solid border-neutral-200 bg-white p-8 text-center text-[13px] text-neutral-500">No pending requests. You are all caught up.</div>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {pending.map((r) => {
                  const left = timeLeft(r.holdExpiresAt);
                  const busy = busyId === r.id;
                  return (
                    <li key={r.id} className="rounded-2xl border border-solid border-amber-200 bg-amber-50/30 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-neutral-900 text-[12px] font-bold text-white">{initials(r.agency?.legalName)}</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[15px] font-bold text-neutral-900">{r.agency?.legalName ?? "Agent"}</span>
                              {r.agency?.reference && <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-500">{r.agency.reference}</span>}
                              {left && <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${left.urgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}><Clock className="h-3 w-3" /> {left.text}</span>}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-neutral-600">
                              <span className="inline-flex items-center gap-1 font-semibold text-neutral-800"><BedDouble className="h-3.5 w-3.5" /> {r.rooms} × {r.roomType ?? "room"}</span>
                              <span>{fmt(r.checkIn)} to {fmt(r.checkOut)} · {nights(r.checkIn, r.checkOut)} night(s)</span>
                              <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {r.adults} adult(s){r.children ? `, ${r.children} child(ren)` : ""}</span>
                            </div>
                            {r.notes && <p className="m-0 mt-1 text-[12px] text-neutral-500">{r.notes}</p>}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-3">
                          <div className="text-right">
                            <span className="block text-[16px] font-extrabold text-neutral-900">{r.currency} {money(r.total)}</span>
                            <span className="block text-[10px] text-neutral-400">total</span>
                          </div>
                          <button type="button" onClick={() => void decide(r.id, "approve")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve</button>
                          <button type="button" onClick={() => setRejectFor(r)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-[13px] font-semibold text-neutral-600 transition hover:border-red-200 hover:text-red-600 disabled:opacity-50"><XCircle className="h-4 w-4" /> Decline</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Confirmed and decided booking activity */}
          {decided.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-0 border-b border-solid border-neutral-200 px-4 py-3.5 sm:px-5">
                <div><h2 className="m-0 text-sm font-extrabold text-neutral-900">Booking activity</h2><p className="m-0 mt-0.5 text-[12px] text-neutral-500">Confirmed agent stays and recent booking decisions.</p></div>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-bold text-neutral-600">{decided.length}</span>
              </div>
              {/* The table columns need ~1140px. Below that the row falls back
                  to labelled cards, and at table width the wrapper scrolls
                  rather than clipping against the card's overflow-hidden. */}
              <div className="overflow-x-auto">
              <div className="min-w-0 xl:min-w-[1140px]">
              <div className="hidden grid-cols-[minmax(190px,1.25fr)_minmax(210px,1.45fr)_minmax(150px,0.9fr)_minmax(190px,1.15fr)_135px_minmax(145px,auto)] gap-4 border-0 border-b border-solid border-neutral-200 bg-neutral-50 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500 xl:grid">
                <span>Agency</span><span>Stay</span><span>Occupancy</span><span>Guest readiness</span><span className="text-right">Booking total</span><span className="text-right">Action</span>
              </div>
              <ul className="m-0 list-none divide-y divide-neutral-100 p-0">
                {decided.map((r) => {
                  const s = DECIDED[r.status] ?? { cls: "bg-neutral-100 text-neutral-600", label: r.status, Icon: Clock };
                  const Icon = s.Icon;
                  const manifestLabel = r.manifest.status === "SUBMITTED" ? "Review required" : r.manifest.status === "VERIFIED" ? "Verified" : r.manifest.status === "CHANGES_REQUESTED" ? "Corrections requested" : r.manifest.status === "IN_PROGRESS" ? "Agent adding guests" : "Not started";
                  const actionLabel = r.manifest.status === "SUBMITTED" ? "Review manifest" : r.manifest.status === "VERIFIED" ? "View booking" : r.manifest.status === "CHANGES_REQUESTED" ? "View corrections" : "Open booking & invoice";
                  return (
                    <li key={r.id} className="grid grid-cols-1 gap-4 px-4 py-4 transition hover:bg-neutral-50/70 sm:grid-cols-2 sm:px-5 lg:grid-cols-3 xl:grid-cols-[minmax(190px,1.25fr)_minmax(210px,1.45fr)_minmax(150px,0.9fr)_minmax(190px,1.15fr)_135px_minmax(145px,auto)] xl:items-center">
                      <ActivityCell label="Agency">
                        <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-neutral-900 text-[11px] font-extrabold text-white">{initials(r.agency?.legalName)}</span><div className="min-w-0"><p className="m-0 truncate text-[13px] font-extrabold text-neutral-900">{r.agency?.legalName ?? "Agent"}</p><span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}><Icon className="h-3 w-3" /> {s.label}</span></div></div>
                      </ActivityCell>
                      <ActivityCell label="Stay">
                        <p className="m-0 flex items-center gap-1.5 text-[13px] font-bold text-neutral-800"><BedDouble className="h-4 w-4 text-neutral-400" /> {r.rooms} × {r.roomType ?? "room"}</p><p className="m-0 mt-1 text-[11px] leading-4 text-neutral-500">{fmt(r.checkIn)} → {fmt(r.checkOut)} · {nights(r.checkIn, r.checkOut)} night{nights(r.checkIn, r.checkOut) === 1 ? "" : "s"}</p>
                      </ActivityCell>
                      <ActivityCell label="Occupancy">
                        <p className="m-0 flex items-center gap-1.5 text-[13px] font-bold text-neutral-800"><Users className="h-4 w-4 text-neutral-400" /> {r.adults + r.children} travellers</p><p className="m-0 mt-1 text-[11px] text-neutral-500">{r.adults} adult{r.adults === 1 ? "" : "s"}{r.children ? ` · ${r.children} child${r.children === 1 ? "" : "ren"}` : ""}</p>
                      </ActivityCell>
                      <ActivityCell label="Guest readiness">
                        {r.status === "CONFIRMED" ? <><div className="flex flex-wrap items-center gap-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.manifest.status === "VERIFIED" ? "bg-emerald-50 text-emerald-700" : r.manifest.status === "SUBMITTED" ? "bg-blue-50 text-blue-700" : r.manifest.status === "CHANGES_REQUESTED" ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>{manifestLabel}</span><span className="text-[11px] font-bold text-neutral-700">{r.manifest.guestsAdded}/{r.manifest.requiredGuests}</span></div><p className="m-0 mt-1 text-[11px] text-neutral-500" title={r.manifest.incidentalCover?.detail ?? ""}>Extras: {r.manifest.incidentalCover?.headline ?? "not declared"}</p></> : <p className="m-0 text-[12px] text-neutral-500">{r.decisionReason || "No guest manifest required"}</p>}
                      </ActivityCell>
                      <ActivityCell label="Booking total" className="xl:text-right"><p className="m-0 text-[14px] font-extrabold text-neutral-900">{r.currency} {money(r.total)}</p><span className="text-[10px] text-neutral-400">total stay value</span></ActivityCell>
                      <ActivityCell label="Action" className="xl:text-right">
                        {r.status === "CONFIRMED" ? <Link href={`/owner/nrms/agents/requests/${r.id}/guests`} className={`inline-flex min-h-9 items-center justify-center rounded-lg border border-solid px-3 py-1.5 text-[11px] font-bold no-underline transition ${r.manifest.status === "SUBMITTED" ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"}`}>{actionLabel}</Link> : <span className="text-[11px] font-semibold text-neutral-400">Decision completed</span>}
                      </ActivityCell>
                    </li>
                  );
                })}
              </ul>
              </div>
              </div>
            </section>
          )}
        </>
      )}

      {rejectFor && <RejectModal request={rejectFor} onClose={() => setRejectFor(null)} onConfirm={(reason) => { setRejectFor(null); void decide(rejectFor.id, "reject", reason); }} />}
    </div>
  );
}

function ActivityCell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`min-w-0 ${className}`}><span className="mb-1.5 block text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400 xl:hidden">{label}</span>{children}</div>;
}

function RejectModal({ request, onClose, onConfirm }: { request: Request; onClose: () => void; onConfirm: (reason?: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-md rounded-2xl border border-solid border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-0 border-b border-solid border-neutral-100 px-5 py-3">
          <h2 className="m-0 text-[15px] font-bold text-neutral-900">Decline request</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border-0 bg-transparent p-1 text-neutral-400 hover:text-neutral-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <p className="m-0 text-[13px] text-neutral-500">Decline {request.agency?.legalName ?? "this agent"}&apos;s request for {request.rooms} × {request.roomType ?? "room"}. The rooms are released back to sale and the agent is notified.</p>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-neutral-700">Reason (optional)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. No availability for those dates" className="resize-none rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
          </label>
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-[13px] font-semibold text-neutral-600 hover:border-neutral-300">Cancel</button>
            <button type="button" onClick={() => onConfirm(reason.trim() || undefined)} className="rounded-lg border border-solid border-red-600 bg-red-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-red-700">Decline request</button>
          </div>
        </div>
      </div>
    </div>
  );
}
