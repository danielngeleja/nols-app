"use client";

/**
 * "List it for the owner" on a lead (docs/SALES_ASSISTED_LISTING.md).
 *
 * Shown only to partners NoLSAF has given the right. The partner enters the
 * owner's name and phone; NoLSAF creates the owner's account, tells the owner
 * by SMS, and the partner then fills in the normal listing steps. Nothing here
 * sets a password or payout detail for the owner: those stay with the owner.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock3, Loader2, MessageSquare, PauseCircle, Send, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type AssistedListingSummary = {
  granted: boolean;
  paused: boolean;
  hasVerifiedVisit: boolean;
  listingStatus: Listing["status"] | null;
  returnReasons: string | null;
};

type Listing = {
  status: "DRAFTING" | "SUBMITTED" | "RETURNED" | "APPROVED" | "PAUSED_OBJECTION" | "CANCELLED";
  editable: boolean;
  ownerAccount: "CREATED" | "ATTACHED_EXISTING";
  ownerName: string | null;
  ownerPhone: string;
  propertyTitle: string | null;
  noticeSentAt: string | null;
  liveNoticeSentAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  returnedAt: string | null;
  returnReasons: { reasons?: string[]; note?: string | null } | null;
  cancelReason: string | null;
};

type LongStayAccess = {
  granted: boolean;
  paused: boolean;
  pauseReason: string | null;
  homeTypeAllowed: boolean;
  request: { ref: string; status: "PENDING" | "APPROVED" | "DECLINED" | "WITHDRAWN"; reason: string; createdAt: string; decidedAt: string | null; decisionNote: string | null } | null;
};

type State = {
  gate: { granted: boolean; paused: boolean; pauseReason: string | null; refusal: string | null };
  hasVerifiedVisit: boolean;
  leadOpen: boolean;
  openDrafts: number;
  maxOpenDrafts: number;
  prefill: { ownerName: string; ownerPhone: string; ownerEmail: string };
  listing: Listing | null;
  /** Null until the long-stay request table exists, or before a listing starts. */
  longStay?: LongStayAccess | null;
};

const STATUS_TEXT: Record<Listing["status"], { label: string; tone: string }> = {
  DRAFTING: { label: "Listing in progress", tone: "bg-sky-50 text-sky-800" },
  SUBMITTED: { label: "With NoLSAF for review", tone: "bg-amber-50 text-amber-800" },
  RETURNED: { label: "Returned for changes", tone: "bg-orange-50 text-orange-800" },
  APPROVED: { label: "Live on NoLSAF", tone: "bg-green-50 text-green-800" },
  PAUSED_OBJECTION: { label: "Paused: owner query", tone: "bg-red-50 text-red-700" },
  CANCELLED: { label: "Cancelled", tone: "bg-slate-100 text-slate-600" },
};

function eat(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

/**
 * Long stay for this owner (docs/LONG_STAY_RENTALS.md section 15). The
 * partner asks; NoLSAF switches long stay on for the owner. While the request
 * waits the monthly terms can be written; submitting needs the approval.
 */
function LongStayRequestPanel({ leadRef, access, editable, onChanged }: { leadRef: string; access: LongStayAccess; editable: boolean; onChanged: () => Promise<void> | void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = access.request;
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/sales/leads/${leadRef}/assisted-listing/long-stay-request`, { reason });
      setReason("");
      await onChanged();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not send the request.");
    } finally {
      setBusy(false);
    }
  };

  const shell = "m-0 flex items-start gap-2 rounded-lg border border-solid px-4 py-3 text-sm";
  if (access.paused) {
    return <p className={`${shell} border-amber-200 bg-amber-50 text-amber-900`}><PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />Long stay is paused for this owner{access.pauseReason ? `: ${access.pauseReason}` : ""}. Contact NoLSAF.</p>;
  }
  if (access.granted) {
    return <p className={`${shell} border-emerald-200 bg-emerald-50 text-emerald-900`}><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Long stay is on for this owner. Choose Monthly in the listing steps and add the terms.</p>;
  }
  if (request?.status === "PENDING") {
    return (
      <p className={`${shell} border-sky-200 bg-sky-50 text-sky-900`}>
        <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Long stay requested {eat(request.createdAt)}. NoLSAF is reviewing it. You can already write the monthly terms; submit once it is approved.</span>
      </p>
    );
  }
  if (!editable) return null;
  if (!access.homeTypeAllowed) {
    return <p className="m-0 text-xs text-slate-500">Long stay is for houses, apartments, condos, villas, townhouses and bungalows. Set the property type in the listing steps to offer it.</p>;
  }
  return (
    <div className="rounded-lg border border-solid border-slate-200 px-4 py-3">
      <p className="m-0 text-sm font-bold text-slate-800">Does the owner want monthly tenants?</p>
      {request?.status === "DECLINED" ? (
        <p className="mb-0 mt-1 text-xs text-red-700">NoLSAF did not switch long stay on{request.decisionNote ? `: ${request.decisionNote}` : "."} You can ask again with more detail.</p>
      ) : (
        <p className="mb-0 mt-1 text-xs text-slate-500">Ask NoLSAF to switch on long stay for this owner. NoLSAF texts the owner when it is on.</p>
      )}
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Owner wants 12-month tenants for the 2-bedroom apartment"
        className="mt-2 w-full rounded-lg border border-solid border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400"
      />
      {error ? <p className="mb-0 mt-1 text-xs text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={busy || reason.trim().length < 10}
        onClick={send}
        className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-md border-0 bg-[#073c35] px-3 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Request long stay
      </button>
    </div>
  );
}

export default function AssistedListingCard({ leadRef, onChanged, onState }: { leadRef: string; onChanged?: () => void; onState?: (summary: AssistedListingSummary | null) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ownerName: "", ownerPhone: "", ownerEmail: "" });
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get(`/api/sales/leads/${leadRef}/assisted-listing`);
      setState(response.data);
      const data = response.data as State;
      const reasons = data.listing?.returnReasons;
      onState?.({
        granted: Boolean(data.gate?.granted),
        paused: Boolean(data.gate?.paused),
        hasVerifiedVisit: Boolean(data.hasVerifiedVisit),
        listingStatus: data.listing?.status ?? null,
        returnReasons: reasons ? [...(reasons.reasons ?? []), reasons.note].filter(Boolean).join(". ") || null : null,
      });
      setForm((current) => current.ownerName || current.ownerPhone ? current : response.data.prefill);
    } catch {
      setState(null);
      onState?.(null);
    }
  }, [leadRef, onState]);

  useEffect(() => { void load(); }, [load]);

  // Invisible to partners without the right: there is nothing they can do with it.
  if (!state || !state.gate.granted) return null;

  const listing = state.listing;
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/sales/leads/${leadRef}/assisted-listing`, {
        ownerName: form.ownerName,
        ownerPhone: form.ownerPhone,
        ownerEmail: form.ownerEmail || null,
      });
      setConfirmed(false);
      await load();
      onChanged?.();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not start the listing.");
    } finally {
      setBusy(false);
    }
  };

  const blocker = state.gate.refusal
    || (!state.leadOpen ? "This lead is closed." : null)
    || (state.openDrafts >= state.maxOpenDrafts ? `You have ${state.openDrafts} listings in progress. Submit some before starting another.` : null);

  return (
    <section id="assisted-listing" className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
      <style>{`#assisted-listing, #assisted-listing * { box-sizing: border-box; }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
            <Building2 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="m-0 text-sm font-black text-slate-900">List it for the owner</h2>
            <p className="mb-0 mt-1 text-[10px] text-slate-400">For owners who agreed but have no time to list. The owner only gets SMS updates.</p>
          </div>
        </div>
        {listing ? (
          <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-[10px] font-black uppercase tracking-wide ${STATUS_TEXT[listing.status].tone}`}>
            {STATUS_TEXT[listing.status].label}
          </span>
        ) : null}
      </div>

      <div className="px-5 py-4">
        {error ? (
          <p className="mb-3 mt-0 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {listing ? (
          <div className="space-y-3">
            <dl className="m-0 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Owner</dt>
                <dd className="m-0 mt-1 text-sm font-bold text-slate-800">{listing.ownerName || "Owner"}</dd>
                <dd className="m-0 text-xs text-slate-500">{listing.ownerPhone}{listing.ownerAccount === "ATTACHED_EXISTING" ? ", existing owner account" : ""}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Owner told by SMS</dt>
                <dd className="m-0 mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-800">
                  {listing.noticeSentAt ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock3 className="h-4 w-4 text-amber-600" />}
                  {listing.noticeSentAt ? eat(listing.noticeSentAt) : "Not sent yet"}
                </dd>
                {listing.liveNoticeSentAt ? <dd className="m-0 text-xs text-slate-500">Live SMS {eat(listing.liveNoticeSentAt)}</dd> : null}
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Property</dt>
                <dd className="m-0 mt-1 text-sm font-bold text-slate-800">{listing.propertyTitle || "Untitled"}</dd>
                {listing.submittedAt ? <dd className="m-0 text-xs text-slate-500">Submitted {eat(listing.submittedAt)}</dd> : null}
              </div>
            </dl>

            {listing.status === "RETURNED" && listing.returnReasons ? (
              <p className="m-0 flex items-start gap-2 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-900">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  NoLSAF asked for changes: {[...(listing.returnReasons.reasons ?? []), listing.returnReasons.note].filter(Boolean).join(". ")}
                </span>
              </p>
            ) : null}
            {listing.status === "PAUSED_OBJECTION" ? (
              <p className="m-0 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
                The owner said they were not expecting this listing. NoLSAF will call them and then cancel or resume it.
              </p>
            ) : null}
            {listing.status === "CANCELLED" && listing.cancelReason ? (
              <p className="m-0 text-sm text-slate-600">Cancelled: {listing.cancelReason}</p>
            ) : null}

            {state.longStay && listing.status !== "CANCELLED" ? (
              <LongStayRequestPanel leadRef={leadRef} access={state.longStay} editable={listing.editable} onChanged={load} />
            ) : null}

            {listing.editable ? (
              state.gate.paused ? (
                <p className="m-0 text-sm text-amber-800">{state.gate.refusal}</p>
              ) : (
                <Link
                  href={`/sales/leads/${leadRef}/listing`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#073c35] px-4 text-sm font-bold text-white no-underline transition hover:opacity-90 hover:no-underline"
                >
                  {listing.status === "RETURNED" ? "Fix and resubmit" : "Continue the listing steps"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )
            ) : null}
          </div>
        ) : blocker ? (
          <p className="m-0 flex items-start gap-2 text-sm text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            {blocker}
          </p>
        ) : (
          <div id="assisted-listing-start" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold text-slate-600">Owner's full name</span>
                <input
                  id="assisted-owner-name"
                  value={form.ownerName}
                  onChange={(event) => setForm({ ...form, ownerName: event.target.value })}
                  maxLength={160}
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold text-slate-600">Owner's mobile number</span>
                <input
                  value={form.ownerPhone}
                  onChange={(event) => setForm({ ...form, ownerPhone: event.target.value })}
                  inputMode="tel"
                  placeholder="0712 345 678"
                  maxLength={40}
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold text-slate-600">Owner's email (optional)</span>
                <input
                  value={form.ownerEmail}
                  onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })}
                  type="email"
                  maxLength={190}
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
            </div>
            {!state.hasVerifiedVisit ? (
              <p className="m-0 flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                No on-site visit recorded. You can still list it; a check-in at the property helps NoLSAF approve it faster.
              </p>
            ) : null}
            <label className="flex items-start gap-2 text-xs leading-5 text-slate-600">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
              <span>
                The owner agreed with me in person that I list this property for them. I understand NoLSAF will text them now, the owner sets their own payout details, and I cannot change the listing after I submit it.
              </span>
            </label>
            {(() => {
              const missing = form.ownerName.trim().length < 3 ? "Add the owner's full name"
                : form.ownerPhone.trim().length < 9 ? "Add the owner's mobile number"
                : !confirmed ? "Tick the box to confirm the owner agreed"
                : null;
              return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  type="button"
                  disabled={busy || Boolean(missing)}
                  onClick={start}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border-0 bg-[#073c35] px-4 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {busy ? "Starting" : "Start listing"}
                </button>
                <span className="text-xs text-slate-500">{missing ?? "NoLSAF texts the owner as soon as you start."}</span>
              </div>;
            })()}
          </div>
        )}
      </div>
    </section>
  );
}
