"use client";
// Agent booking requests (request-to-book queue). The hotel approves or declines
// pending holds before they expire. Instant-confirm bookings never appear here.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { ArrowRight, BedDouble, CheckCircle2, Clock, Inbox, Loader2, Users, X, XCircle } from "lucide-react";
import { useNrms } from "../../_components/NrmsProvider";
import { useNrmsAccessRole } from "../../_components/NrmsAccessRole";

type IncidentalCover = { billing: string | null; scope: string | null; categories: string[]; capAmount: number | null; capBasis: string | null; headline: string; detail: string };
type Request = {
  id: number; reference?: string; status: string; agency: { legalName: string; reference: string } | null; bookingMode: string | null;
  roomType: string | null; checkIn: string; checkOut: string; adults: number; children: number; rooms: number;
  currency: string; total: number; holdExpiresAt: string | null; decidedAt: string | null; decisionReason: string | null;
  notes: string | null; createdAt: string;
  commercial: { folioStatus: string | null; invoiceStatus: string | null; invoiceDueAt: string | null; invoiceSentAt: string | null; agencyMarkedPaid: boolean };
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
  const { accessRole } = useNrmsAccessRole();
  const canOpenFinancialFollowUp = accessRole === "OWNER";
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectFor, setRejectFor] = useState<Request | null>(null);
  const [view, setView] = useState<"ALL" | "ACTION" | "UNPAID" | "PAID" | "CLOSED">("ALL");

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

  const rows = requests ?? [];
  const confirmed = rows.filter((r) => r.status === "CONFIRMED");
  const counts = {
    pending: pending.length,
    verify: confirmed.filter((r) => paymentState(r).key === "DECLARED").length,
    overdue: confirmed.filter((r) => paymentState(r).key === "OVERDUE").length,
    travellers: confirmed.filter((r) => r.manifest.status === "SUBMITTED").length,
  };
  const needsAction = (r: Request) => r.status === "CONFIRMED" && nextStep(r, canOpenFinancialFollowUp).primary;
  const filtered = decided.filter((r) => {
    if (view === "ACTION") return needsAction(r);
    if (view === "UNPAID") return r.status === "CONFIRMED" && !["PAID"].includes(paymentState(r).key);
    if (view === "PAID") return r.status === "CONFIRMED" && paymentState(r).key === "PAID";
    if (view === "CLOSED") return r.status !== "CONFIRMED";
    return true;
  });
  const views: Array<[typeof view, string, number]> = [
    ["ALL", "All", decided.length],
    ["ACTION", "Needs action", decided.filter(needsAction).length],
    ["UNPAID", "Awaiting payment", confirmed.filter((r) => paymentState(r).key !== "PAID").length],
    ["PAID", "Paid", confirmed.filter((r) => paymentState(r).key === "PAID").length],
    ["CLOSED", "Declined or expired", decided.filter((r) => r.status !== "CONFIRMED").length],
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header: what needs the desk, at a glance */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex items-start gap-3.5 px-5 pb-4 pt-5 sm:px-6">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Inbox className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Front desk · Agents</p>
            <h1 className="m-0 mt-0.5 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Agent bookings</h1>
            <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-neutral-500">Decide on request-to-book holds before they expire, then invoice, collect and check the travellers of every confirmed agency stay.</p>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-neutral-100 bg-neutral-100 lg:grid-cols-4">
          <HeaderStat label="Awaiting your decision" value={counts.pending} note={counts.pending ? "Holds expire if not answered" : "No holds waiting"} tone={counts.pending ? "text-amber-700" : "text-neutral-950"} />
          <HeaderStat label="Payments to verify" value={counts.verify} note={counts.verify ? "Agency says it has paid" : "Nothing declared"} tone={counts.verify ? "text-amber-700" : "text-neutral-950"} />
          <HeaderStat label="Overdue invoices" value={counts.overdue} note={counts.overdue ? "Past their pay-by date" : "None overdue"} tone={counts.overdue ? "text-red-600" : "text-neutral-950"} />
          <HeaderStat label="Travellers to review" value={counts.travellers} note={counts.travellers ? "Manifests submitted" : "None waiting"} tone={counts.travellers ? "text-blue-700" : "text-neutral-950"} />
        </dl>
      </section>

      {notice && <div role="status" className="rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {requests === null ? (
        <div className="flex items-center gap-2 rounded-2xl border border-solid border-neutral-200 bg-white p-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading agent bookings…</div>
      ) : (
        <>
          {/* Pending holds: only when there is something to decide */}
          {pending.length > 0 && (
            <section>
              <h2 className="m-0 mb-2.5 flex items-center gap-2 text-sm font-bold text-neutral-900">Waiting for your decision <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{pending.length}</span></h2>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {pending.map((r) => {
                  const left = timeLeft(r.holdExpiresAt);
                  const busy = busyId === r.id;
                  return (
                    <li key={r.id} className="rounded-2xl border border-solid border-amber-200 bg-white p-4 shadow-sm sm:p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-full text-xs font-bold ring-1 ${avatarTone(r.agency?.reference ?? r.agency?.legalName)}`}>{initials(r.agency?.legalName)}</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-bold text-neutral-900">{r.agency?.legalName ?? "Agent"}</span>
                              {left && <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${left.urgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}><Clock className="h-3.5 w-3.5" /> Hold {left.text}</span>}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
                              <span className="inline-flex items-center gap-1.5 font-semibold text-neutral-800"><BedDouble className="h-4 w-4 text-neutral-400" /> {r.rooms} × {r.roomType ?? "room"}</span>
                              <span>{fmt(r.checkIn)} to {fmt(r.checkOut)} · {nights(r.checkIn, r.checkOut)} nights</span>
                              <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-neutral-400" /> {r.adults + r.children} travellers</span>
                            </div>
                            {r.notes && <p className="m-0 mt-1.5 text-sm text-neutral-500">{r.notes}</p>}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
                          <div className="text-right">
                            <span className="block text-lg font-extrabold tabular-nums text-neutral-900">{r.currency} {money(r.total)}</span>
                            <span className="block text-xs text-neutral-400">stay value</span>
                          </div>
                          <button type="button" onClick={() => setRejectFor(r)} disabled={busy} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3.5 text-sm font-semibold text-neutral-700 transition hover:border-red-200 hover:text-red-600 disabled:opacity-50"><XCircle className="h-4 w-4" /> Decline</button>
                          <button type="button" onClick={() => void decide(r.id, "approve")} disabled={busy} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Confirmed and decided bookings */}
          <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="m-0 text-base font-bold text-neutral-900">Bookings</h2>
                <p className="m-0 mt-0.5 text-sm text-neutral-500">{pending.length === 0 ? "No holds waiting for a decision. " : ""}Confirmed agency stays and past decisions.</p>
              </div>
              <div role="tablist" aria-label="Filter bookings" className="flex flex-wrap gap-1.5">
                {views.map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={view === value}
                    onClick={() => setView(value)}
                    className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-semibold transition ${view === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
                  >
                    {label}
                    <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${view === value ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-500"}`}>{count}</span>
                  </button>
                ))}
              </div>
            </div>

            {decided.length === 0 ? (
              <p className="m-0 px-5 py-10 text-center text-sm text-neutral-500">No agent bookings yet. Confirmed and decided requests will appear here.</p>
            ) : filtered.length === 0 ? (
              <p className="m-0 px-5 py-10 text-center text-sm text-neutral-500">Nothing in this view.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500">
                      <th className="border-0 border-b border-solid border-neutral-200 px-5 py-3">Agency</th>
                      <th className="border-0 border-b border-solid border-neutral-200 px-4 py-3">Stay</th>
                      <th className="border-0 border-b border-solid border-neutral-200 px-4 py-3">Travellers</th>
                      <th className="border-0 border-b border-solid border-neutral-200 px-4 py-3">Payment</th>
                      <th className="border-0 border-b border-solid border-neutral-200 px-4 py-3 text-right">Total</th>
                      <th className="border-0 border-b border-solid border-neutral-200 px-5 py-3 text-right">Next step</th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child_td]:border-b-0">
                    {filtered.map((r) => {
                      const decision = DECIDED[r.status] ?? { cls: "bg-neutral-100 text-neutral-600", label: r.status, Icon: Clock };
                      const DecisionIcon = decision.Icon;
                      const pay = paymentState(r);
                      const step = nextStep(r, canOpenFinancialFollowUp);
                      const href = `/owner/nrms/agents/requests/${encodeURIComponent(r.reference ?? String(r.id))}/guests`;
                      const cell = "border-0 border-b border-solid border-neutral-200 align-middle";
                      return (
                        <tr key={r.id} className="transition hover:bg-neutral-50/70">
                          <td className={`${cell} px-5 py-4`}>
                            <div className="flex min-w-0 items-center gap-3">
                              <span className={`grid h-10 w-10 flex-none place-items-center rounded-full text-xs font-bold ring-1 ${avatarTone(r.agency?.reference ?? r.agency?.legalName)}`}>{initials(r.agency?.legalName)}</span>
                              <div className="min-w-0">
                                <p className="m-0 flex min-w-0 items-center gap-2">
                                  <span className="max-w-[15rem] truncate font-bold text-neutral-900">{r.agency?.legalName ?? "Agent"}</span>
                                  {/* Approved is the normal state; only an exception earns a pill. */}
                                  {r.status !== "CONFIRMED" && <span className={`inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${decision.cls}`}><DecisionIcon className="h-3 w-3" /> {decision.label}</span>}
                                </p>
                                <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">
                                  {r.agency?.reference && <span className="font-mono">{r.agency.reference}</span>}
                                  {r.agency?.reference && " · "}
                                  {r.status === "CONFIRMED" ? `Booked ${fmt(r.createdAt)}` : r.decidedAt ? `Decided ${fmt(r.decidedAt)}` : `Requested ${fmt(r.createdAt)}`}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className={`${cell} px-4 py-4`}>
                            <p className="m-0 flex items-center gap-1.5 font-semibold text-neutral-800"><BedDouble className="h-4 w-4 text-neutral-400" /> {r.rooms} × {r.roomType ?? "room"}</p>
                            <p className="m-0 mt-1 text-xs text-neutral-500">{fmt(r.checkIn)} to {fmt(r.checkOut)} · {nights(r.checkIn, r.checkOut)} nights</p>
                          </td>
                          <td className={`${cell} px-4 py-4`}>
                            {r.status === "CONFIRMED" ? <>
                              <p className="m-0 flex items-center gap-2 font-semibold text-neutral-800"><Users className="h-4 w-4 text-neutral-400" /> {r.manifest.guestsAdded} of {r.manifest.requiredGuests}</p>
                              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${MANIFEST_TONE[r.manifest.status] ?? "bg-neutral-100 text-neutral-600"}`}>{MANIFEST_LABEL[r.manifest.status] ?? "Not started"}</span>
                            </> : <p className="m-0 text-xs text-neutral-500">{r.decisionReason || `${r.adults + r.children} travellers`}</p>}
                          </td>
                          <td className={`${cell} px-4 py-4`}>
                            {r.status === "CONFIRMED" ? <>
                              <p className={`m-0 font-bold ${pay.cls}`}>{pay.label}</p>
                              {pay.detail && <p className="m-0 mt-0.5 text-xs text-neutral-500">{pay.detail}</p>}
                            </> : <span className="text-xs text-neutral-400">Not applicable</span>}
                          </td>
                          <td className={`${cell} px-4 py-4 text-right`}>
                            <p className="m-0 font-extrabold tabular-nums text-neutral-900">{r.currency} {money(r.total)}</p>
                            <p className="m-0 mt-0.5 text-xs text-neutral-400">stay value</p>
                          </td>
                          <td className={`${cell} px-5 py-4 text-right`}>
                            {step.label && canOpenFinancialFollowUp && r.status === "CONFIRMED" ? (
                              <Link href={href} className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-xs font-bold no-underline transition ${step.primary ? "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800" : "border border-solid border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`}>
                                {step.label} <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            ) : (
                              <span className="text-xs font-semibold text-neutral-400">{r.status === "CONFIRMED" ? "Owner follow-up" : "Decision completed"}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {rejectFor && <RejectModal request={rejectFor} onClose={() => setRejectFor(null)} onConfirm={(reason) => { setRejectFor(null); void decide(rejectFor.id, "reject", reason); }} />}
    </div>
  );
}

const MANIFEST_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "Agency adding guests",
  SUBMITTED: "Ready to review",
  CHANGES_REQUESTED: "Corrections requested",
  VERIFIED: "Verified",
};
const MANIFEST_TONE: Record<string, string> = {
  IN_PROGRESS: "bg-neutral-100 text-neutral-600",
  SUBMITTED: "bg-blue-50 text-blue-700",
  CHANGES_REQUESTED: "bg-amber-50 text-amber-800",
  VERIFIED: "bg-emerald-50 text-emerald-700",
};

/** Days from today to a stored calendar date, without a timezone shifting the day. */
function daysFromToday(value: string): number {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return 0;
  const now = new Date();
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
}

/** Where the agency's money stands on a confirmed booking. */
function paymentState(r: Request): { key: "PAID" | "DECLARED" | "OVERDUE" | "SENT" | "DRAFT" | "NONE"; label: string; detail: string | null; cls: string } {
  const c = r.commercial;
  if (c.folioStatus === "SETTLED" || c.folioStatus === "CREDIT") return { key: "PAID", label: "Paid", detail: "Receipted", cls: "text-emerald-700" };
  if (c.agencyMarkedPaid) return { key: "DECLARED", label: "Agency says paid", detail: "Verify, then record", cls: "text-amber-700" };
  if (c.invoiceSentAt && c.invoiceDueAt) {
    const days = daysFromToday(c.invoiceDueAt);
    if (days < 0) return { key: "OVERDUE", label: "Overdue", detail: `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}, due ${fmt(c.invoiceDueAt)}`, cls: "text-red-600" };
    return { key: "SENT", label: "Invoice sent", detail: days === 0 ? "Due today" : `Due ${fmt(c.invoiceDueAt)}`, cls: "text-neutral-800" };
  }
  if (c.invoiceStatus) return { key: "DRAFT", label: "Invoice draft", detail: "Not sent yet", cls: "text-amber-700" };
  return { key: "NONE", label: "Not invoiced", detail: "No invoice issued", cls: "text-neutral-500" };
}

/** The one thing to do next on a booking, as the row's button. */
function nextStep(r: Request, canFollowUp: boolean): { label: string | null; primary: boolean } {
  if (r.status !== "CONFIRMED" || !canFollowUp) return { label: null, primary: false };
  const pay = paymentState(r).key;
  if (pay === "DECLARED") return { label: "Verify payment", primary: true };
  if (pay === "NONE") return { label: "Issue invoice", primary: true };
  if (pay === "DRAFT") return { label: "Send invoice", primary: true };
  if (r.manifest.status === "SUBMITTED") return { label: "Review travellers", primary: true };
  if (pay === "OVERDUE") return { label: "Follow up", primary: false };
  return { label: "Open booking", primary: false };
}

// A soft, stable colour per agency so repeat agencies are recognisable down
// the list without every row carrying the same heavy black tile.
const AVATAR_TONES = [
  "bg-emerald-50 text-emerald-800 ring-emerald-200",
  "bg-sky-50 text-sky-800 ring-sky-200",
  "bg-violet-50 text-violet-800 ring-violet-200",
  "bg-amber-50 text-amber-800 ring-amber-200",
  "bg-rose-50 text-rose-800 ring-rose-200",
  "bg-teal-50 text-teal-800 ring-teal-200",
];

function avatarTone(key?: string | null): string {
  const text = String(key ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

function HeaderStat({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return (
    <div className="min-w-0 bg-white px-5 py-3.5 sm:px-6">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{label}</dt>
      <dd className={`m-0 mt-1 text-2xl font-bold tabular-nums tracking-tight ${tone}`}>{value}</dd>
      <p className="m-0 mt-0.5 truncate text-xs text-neutral-400">{note}</p>
    </div>
  );
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
