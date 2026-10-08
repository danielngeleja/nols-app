"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, Check, ChevronLeft, ChevronRight, Clock3, KeyRound, Loader2, PhoneOff, RefreshCw, Send, ShieldAlert, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

/**
 * Guest code requests: owners asking NoLSAF to get a guest's check-in code
 * back to the guest. Most are delivered automatically; this queue holds the
 * ones a person must handle (contacts overlap, guest unreachable) and the
 * history of every request. The code itself is never shown here.
 */

type Tab = "OPEN" | "SENT" | "RESOLVED" | "REJECTED" | "ALL";
type RequestRow = {
  id: number;
  status: "SENT" | "NEEDS_REVIEW" | "UNREACHABLE" | "RESOLVED" | "REJECTED";
  channel: string | null;
  destinationMasked: string | null;
  reason: string | null;
  resolution: string | null;
  adminNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  booking: {
    reference: string;
    status: string;
    codeStatus: string | null;
    awaitingCheckIn: boolean;
    guestName: string | null;
    guestPhoneMasked: string | null;
    hasAccount: boolean;
    checkIn: string;
    checkOut: string;
    propertyTitle: string | null;
  };
  owner: { name: string; phoneMasked: string | null } | null;
};
type Counts = { open: number; needsReview: number; unreachable: number; sentToday: number };

const TZ = "Africa/Dar_es_Salaam";
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const fmtWhen = (iso: string) => `${new Date(iso).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })} EAT`;

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "OPEN", label: "To handle" },
  { key: "SENT", label: "Sent automatically" },
  { key: "RESOLVED", label: "Resent by admin" },
  { key: "REJECTED", label: "Closed" },
  { key: "ALL", label: "All" },
];

const STATUS: Record<RequestRow["status"], { label: string; cls: string; Icon: typeof Check }> = {
  NEEDS_REVIEW: { label: "Needs checking", cls: "bg-amber-50 text-amber-800 ring-amber-200", Icon: ShieldAlert },
  UNREACHABLE: { label: "Guest unreachable", cls: "bg-rose-50 text-rose-700 ring-rose-200", Icon: PhoneOff },
  SENT: { label: "Sent automatically", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", Icon: Check },
  RESOLVED: { label: "Resent by admin", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", Icon: Check },
  REJECTED: { label: "Closed", cls: "bg-slate-100 text-slate-700 ring-slate-200", Icon: X },
};

export default function GuestCodeRequestsPage() {
  const [tab, setTab] = useState<Tab>("OPEN");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>({ open: 0, needsReview: 0, unreachable: 0, sentToday: 0 });
  const [migrationPending, setMigrationPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<{ id: number; mode: "resend" | "reject" } | null>(null);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pageSize = 25;

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await apiClient.get("/api/admin/guest-code-requests", { params: { status: tab, page, pageSize } });
      setRows(r.data?.requests ?? []);
      setTotal(r.data?.total ?? 0);
      setCounts(r.data?.counts ?? { open: 0, needsReview: 0, unreachable: 0, sentToday: 0 });
      setMigrationPending(Boolean(r.data?.migrationPending));
    } catch (e: any) {
      setRows([]);
      setError(e?.response?.data?.error || "Could not load guest code requests.");
    }
  }, [tab, page]);

  useEffect(() => { void load(); }, [load]);

  const startAction = (id: number, mode: "resend" | "reject") => {
    setActing({ id, mode });
    setPhone("");
    setNote("");
    setError(null);
    setNotice(null);
  };

  const submit = async () => {
    if (!acting) return;
    setBusy(true);
    setError(null);
    try {
      if (acting.mode === "resend") {
        const r = await apiClient.post(`/api/admin/guest-code-requests/${acting.id}/resend`, { phone: phone.trim() || undefined, note: note.trim() || undefined });
        setNotice(`Code resent to the guest${r.data?.destinationMasked ? ` (${r.data.destinationMasked})` : ""}. The owner was notified.`);
      } else {
        await apiClient.post(`/api/admin/guest-code-requests/${acting.id}/reject`, { note: note.trim() });
        setNotice("Request closed. The owner sees your note.");
      }
      setActing(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <style>{`:where(#admin-guest-codes, #admin-guest-codes *) { box-sizing: border-box; }`}</style>
      <div id="admin-guest-codes" className="space-y-5">
        <header className="overflow-hidden rounded-3xl bg-[#012a26] text-white">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-5 pt-5 sm:px-7">
            <div className="flex items-start gap-3.5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#5eead4] text-[#012a26]"><KeyRound className="h-5 w-5" aria-hidden /></span>
              <div>
                <Link href="/admin/bookings" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5eead4]/80 no-underline hover:text-[#5eead4]">Bookings</Link>
                <h1 className="m-0 mt-0.5 text-2xl font-bold tracking-tight text-white">Guest code requests</h1>
                <p className="m-0 mt-1 max-w-xl text-sm text-white/60">Owners ask NoLSAF to get a guest&apos;s check-in code back to the guest. Handle the ones the system could not send on its own.</p>
              </div>
            </div>
            <button type="button" onClick={() => void load()} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
              <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
            </button>
          </div>
          <div className="grid grid-cols-1 gap-px border-0 border-t border-solid border-white/10 bg-white/10 sm:grid-cols-3">
            {[
              { label: "Needs checking", value: counts.needsReview, hint: "Owner and guest contacts overlap", tone: counts.needsReview ? "text-amber-300" : "text-white/50" },
              { label: "Guest unreachable", value: counts.unreachable, hint: "No phone or account worked", tone: counts.unreachable ? "text-rose-300" : "text-white/50" },
              { label: "Sent automatically", value: counts.sentToday, hint: "In the last 24 hours", tone: "text-[#5eead4]" },
            ].map((tile) => (
              <div key={tile.label} className="bg-[#012a26] px-5 py-4 sm:px-7">
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">{tile.label}</p>
                <p className={`m-0 mt-1.5 text-3xl font-extrabold tabular-nums ${tile.tone}`}>{tile.value}</p>
                <p className="m-0 mt-1 text-[11px] text-white/45">{tile.hint}</p>
              </div>
            ))}
          </div>
        </header>

        {migrationPending && (
          <p className="m-0 flex items-start gap-2 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            The guest code request table is not set up on this database yet (migration 20261010090000 pending). Owners can still send codes; requests start appearing here once it is applied.
          </p>
        )}
        {notice && <p role="status" className="m-0 rounded-2xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</p>}
        {error && !acting && <p role="alert" className="m-0 rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

        <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
          <nav className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-slate-200 px-3" aria-label="Request status">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setTab(t.key); setPage(1); }}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex h-12 items-center gap-2 whitespace-nowrap border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-semibold transition ${active ? "border-[#02665e] text-[#02665e]" : "border-transparent text-slate-500 hover:text-slate-800"}`}
                >
                  {t.label}
                  {t.key === "OPEN" && counts.open > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-[18px] text-white">{counts.open}</span>}
                </button>
              );
            })}
          </nav>

          {rows === null ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-slate-50" />)}</div>
          ) : rows.length === 0 ? (
            <div className="grid min-h-48 place-items-center p-8 text-center">
              <div>
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Check className="h-5 w-5" aria-hidden /></span>
                <p className="m-0 mt-3 text-sm font-bold text-slate-800">{tab === "OPEN" ? "Nothing to handle" : "No requests here"}</p>
                <p className="m-0 mt-1 text-xs text-slate-500">{tab === "OPEN" ? "Every guest code request was sent or closed." : "Try another tab."}</p>
              </div>
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {rows.map((row) => {
                const st = STATUS[row.status];
                const open = row.status === "NEEDS_REVIEW" || row.status === "UNREACHABLE";
                const isActing = acting?.id === row.id;
                return (
                  <li key={row.id} className="border-0 border-b border-solid border-slate-100 px-4 py-4 last:border-b-0 sm:px-5">
                    <div className="flex flex-wrap items-start gap-4">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#012a26] text-xs font-bold text-[#5eead4]">
                        {(row.booking.guestName || "G").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="m-0 text-sm font-bold text-slate-900">{row.booking.guestName || "Guest"}</p>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${st.cls}`}><st.Icon className="h-3 w-3" aria-hidden />{st.label}</span>
                          {!row.booking.awaitingCheckIn && open && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Booking {row.booking.status.toLowerCase().replace(/_/g, " ")}</span>}
                        </div>
                        <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" aria-hidden />{row.booking.propertyTitle || "Property"}</span>
                          <span aria-hidden>·</span>
                          <span>{fmtDay(row.booking.checkIn)} to {fmtDay(row.booking.checkOut)}</span>
                          <span aria-hidden>·</span>
                          <Link href={`/admin/bookings/${encodeURIComponent(row.booking.reference)}`} className="font-mono text-[11px] text-[#02665e] no-underline hover:underline">{row.booking.reference}</Link>
                        </p>
                        <dl className="m-0 mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                          <div className="flex gap-1.5"><dt className="text-slate-400">Asked by</dt><dd className="m-0 font-semibold text-slate-700">{row.owner?.name ?? "Owner"}{row.owner?.phoneMasked ? ` (${row.owner.phoneMasked})` : ""}</dd></div>
                          <div className="flex gap-1.5"><dt className="text-slate-400">Guest phone</dt><dd className="m-0 font-semibold text-slate-700">{row.booking.guestPhoneMasked ?? "None on booking"}{row.booking.hasAccount ? " · has account" : ""}</dd></div>
                          <div className="flex gap-1.5"><dt className="text-slate-400">Asked</dt><dd className="m-0 font-semibold text-slate-700">{fmtWhen(row.createdAt)}</dd></div>
                        </dl>
                        {row.reason && <p className="m-0 mt-2 flex items-start gap-1.5 text-xs text-amber-800"><Clock3 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{row.reason}</p>}
                        {(row.status === "SENT" || row.status === "RESOLVED") && row.channel && (
                          <p className="m-0 mt-2 text-xs text-emerald-700">Delivered by {row.channel === "SMS" ? "SMS" : "NoLSAF inbox"}{row.destinationMasked ? ` (${row.destinationMasked})` : ""}{row.resolvedBy ? ` · by ${row.resolvedBy}` : ""}{row.resolution === "CONTACT_UPDATED" ? " · guest phone corrected" : ""}</p>
                        )}
                        {row.adminNote && <p className="m-0 mt-1.5 text-xs text-slate-600">Note: {row.adminNote}{row.status === "REJECTED" && row.resolvedBy ? ` (${row.resolvedBy})` : ""}</p>}
                      </div>
                      {open && !isActing && (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button type="button" onClick={() => startAction(row.id, "resend")} disabled={!row.booking.awaitingCheckIn} title={row.booking.awaitingCheckIn ? undefined : "The booking is no longer awaiting check-in"} className="inline-flex h-9 items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-3.5 text-xs font-bold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
                            <Send className="h-3.5 w-3.5" aria-hidden /> Resend code
                          </button>
                          <button type="button" onClick={() => startAction(row.id, "reject")} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-solid border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
                            Close request
                          </button>
                        </div>
                      )}
                    </div>

                    {isActing && (
                      <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200 sm:ml-[60px]">
                        {acting.mode === "resend" ? (
                          <>
                            <p className="m-0 text-sm font-bold text-slate-900">Resend the code to the guest</p>
                            <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
                              Confirm who the guest is first{row.status === "NEEDS_REVIEW" ? ": their contact matches the owner's, so check it is really the guest" : ""}. If the phone on the booking is wrong, enter the right one; it replaces the booking phone and the change is recorded.
                            </p>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                                Correct guest phone (optional)
                                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 7XX XXX XXX" inputMode="tel" className="mt-1.5 box-border h-10 w-full rounded-xl border border-solid border-slate-300 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-[#02665e]" />
                              </label>
                              <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                                Note (optional)
                                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="How you confirmed the guest" maxLength={500} className="mt-1.5 box-border h-10 w-full rounded-xl border border-solid border-slate-300 bg-white px-3 text-sm normal-case tracking-normal text-slate-900 outline-none focus:border-[#02665e]" />
                              </label>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="m-0 text-sm font-bold text-slate-900">Close without sending</p>
                            <p className="m-0 mt-1 text-xs text-slate-500">The owner sees this note, so say why.</p>
                            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="The guest confirmed they still have the code" className="mt-3 box-border w-full resize-none rounded-xl border border-solid border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#02665e]" />
                          </>
                        )}
                        {error && <p role="alert" className="m-0 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">{error}</p>}
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <button type="button" onClick={() => setActing(null)} disabled={busy} className="inline-flex h-9 items-center rounded-xl border border-solid border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
                          <button
                            type="button"
                            onClick={() => void submit()}
                            disabled={busy || (acting.mode === "reject" && note.trim().length < 3)}
                            className={`inline-flex h-9 items-center gap-1.5 rounded-xl border-0 px-3.5 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 ${acting.mode === "resend" ? "bg-[#02665e] hover:bg-[#014d47]" : "bg-slate-800 hover:bg-slate-900"}`}
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : acting.mode === "resend" ? <Send className="h-3.5 w-3.5" /> : null}
                            {acting.mode === "resend" ? "Send code to guest" : "Close request"}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {total > pageSize && (
            <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <span>Page {page} of {totalPages} · {total} requests</span>
              <span className="flex gap-1">
                <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-slate-300 bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-slate-300 bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
