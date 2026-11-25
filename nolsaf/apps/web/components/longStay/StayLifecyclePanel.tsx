"use client";

/**
 * After the booking (docs/LONG_STAY_RENTALS.md sections 6.4 to 6.6,
 * milestone 8): cancel a reserved booking, give notice, confirm move-out,
 * renew, and money owed under the lease. The server works out every amount.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarX2, CheckCircle2, HandCoins, Loader2, LogOut, RefreshCcw, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";

type Side = "TENANT" | "LANDLORD";
type Claim = { id: number; kind: string; amount: number; recoveredAmount: number; currency: string; status: string; reason: string; dueAt: string; closedAt: string | null };
export type LifecycleView = {
  ref: string;
  status: string;
  endDate?: string | null;
  notice?: { givenBy: string; givenAt: string } | null;
  cancellation?: { by: string; refundToTenant: number; landlordPayout: number; nolsafKeeps: number } | null;
  claims?: Claim[];
  money: { currency: string } | null;
};
type Terms = { by: string; daysToMoveIn: number; refundToTenant: number; landlordPayout: number; nolsafKeeps: number };

const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:opacity-50 [font-family:inherit]";
const outline = `${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const primary = `${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`;

function money(value: number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: currency === "TZS" ? 0 : 2 })}`;
}
function day(iso: string | null | undefined) {
  return iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}
function addDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export default function StayLifecyclePanel({ side, view, base, onChanged }: { side: Side; view: LifecycleView; base: string; onChanged: () => Promise<void> | void }) {
  const router = useRouter();
  const ref = encodeURIComponent(view.ref);
  const currency = view.money?.currency ?? "TZS";
  const [mode, setMode] = useState<"cancel" | "notice" | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [reason, setReason] = useState("");
  const [leaveOn, setLeaveOn] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const post = async (key: string, path: string, body: unknown = {}) => {
    setBusy(key);
    setError("");
    try {
      const response = await apiClient.post(`${base}/tenancies/${ref}/${path}`, body);
      await onChanged();
      setMode(null);
      return response.data;
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const openCancel = async () => {
    setMode("cancel");
    setTerms(null);
    try {
      const response = await apiClient.get(`${base}/tenancies/${ref}/cancel-terms`);
      setTerms(response.data.terms);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load what cancelling would mean.");
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const endPassed = Boolean(view.endDate && view.endDate <= today);
  const daysToEnd = view.endDate ? Math.round((Date.parse(`${view.endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
  const claims = view.claims ?? [];

  return (
    <div className="space-y-3">
      {/* A cancelled paid booking: what happened to the money */}
      {view.status === "CANCELLED" && view.cancellation ? (
        <div className="rounded-md bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700">
          <p className="m-0 flex items-center gap-2 font-semibold text-slate-900"><XCircle className="h-4 w-4 text-slate-400" />Cancelled by the {view.cancellation.by === "LANDLORD" ? "landlord" : "tenant"}</p>
          <p className="m-0 mt-1">
            {view.cancellation.refundToTenant > 0 ? `${money(view.cancellation.refundToTenant, currency)} goes back to the tenant. ` : ""}
            {view.cancellation.landlordPayout > 0 ? `${money(view.cancellation.landlordPayout, currency)} goes to the landlord. ` : ""}
            NoLSAF handles the money and will be in touch.
          </p>
        </div>
      ) : null}

      {/* End of stay */}
      {(view.status === "ENDING" || view.status === "OVERDUE") && view.endDate ? (
        <p className="m-0 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
          <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" />
          {view.status === "OVERDUE" ? `The lease ended on ${day(view.endDate)} and move-out is not confirmed.` : `Notice given by the ${view.notice?.givenBy === "LANDLORD" ? "landlord" : "tenant"}: the stay ends on ${day(view.endDate)}.`}
          {" "}Unused prepaid months are refunded by the landlord within 14 days of move-out.
        </p>
      ) : null}

      {/* Money owed under the lease */}
      {claims.length ? (
        <div className="rounded-md border border-solid border-slate-200">
          <p className="m-0 flex items-center gap-2 border-0 border-b border-solid border-slate-100 px-3 py-2 text-[13px] font-semibold text-slate-900"><HandCoins className="h-4 w-4 text-[#02665e]" />Money owed under the lease</p>
          <ul className="m-0 list-none p-0">
            {claims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-100 px-3 py-2.5 text-[13px] first:border-t-0">
                <span className="min-w-0 flex-1">
                  <b>{money(c.amount, c.currency)}</b> from the landlord to the tenant
                  <span className="block text-[12px] text-slate-500">{c.reason}</span>
                  <span className="block text-[12px] text-slate-400">
                    {c.status === "OPEN" ? `Due by ${day(c.dueAt)}` : c.status === "RECOVERING" ? `Past due; NoLSAF is taking it from the landlord's payouts (${money(c.recoveredAmount, c.currency)} so far)` : c.status === "RECOVERED" ? (c.closedAt ? "Recovered and paid to the tenant" : "Recovered by NoLSAF, being paid to the tenant") : c.status === "SETTLED" ? "Paid" : "Closed by NoLSAF"}
                  </span>
                </span>
                {side === "TENANT" && c.status === "OPEN" && c.recoveredAmount === 0 ? (
                  <button type="button" disabled={busy === `claim-${c.id}`} onClick={() => post(`claim-${c.id}`, `claims/${c.id}/received`)} className={outline}>
                    <CheckCircle2 className="h-4 w-4" />I received it
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Actions */}
      {mode === "cancel" ? (
        <div className="rounded-md border border-solid border-red-200 bg-red-50/40 p-3 text-[13px]">
          {terms ? (
            <p className="m-0 text-slate-800">
              {side === "LANDLORD"
                ? `If you cancel, the tenant gets ${money(terms.refundToTenant, currency)} back in full and you receive nothing. Repeated cancellations pause your long stays.`
                : terms.refundToTenant > 0
                  ? `Move-in is ${terms.daysToMoveIn} days away. You get the first month back (${money(terms.refundToTenant, currency)}); the service fee is not refunded.`
                  : `Move-in is ${terms.daysToMoveIn} days away, which is 14 days or less. The first month goes to the landlord (less 5%) and nothing is refunded.`}
            </p>
          ) : <p className="m-0 flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Working out the money</p>}
          <label htmlFor="cancel-reason" className="mt-2 block text-xs font-semibold text-slate-700">Why are you cancelling?</label>
          <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-red-400" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={!terms || reason.trim().length < 5 || busy === "cancel"} onClick={() => post("cancel", "cancel-booking", { reason: reason.trim() })} className={`${btn} border-0 bg-red-600 text-white hover:bg-red-700`}>Cancel the booking</button>
            <button type="button" onClick={() => setMode(null)} className={outline}>Keep it</button>
          </div>
        </div>
      ) : mode === "notice" ? (
        <div className="rounded-md border border-solid border-slate-200 p-3 text-[13px]">
          <DatePickerField label={side === "TENANT" ? "The day you will leave" : "The day the tenant must leave"} value={leaveOn} min={addDays(30)} max={view.endDate ?? undefined} size="sm" widthClassName="w-full" onChangeAction={(iso) => setLeaveOn(String(iso).slice(0, 10))} />
          <p className="m-0 mt-1 text-[12px] text-slate-500">The lease's notice period applies. {side === "TENANT" ? "The landlord keeps rent up to that day and refunds unused prepaid months." : "You must refund all unused prepaid months within 14 days of move-out."}</p>
          {side === "LANDLORD" ? (
            <>
              <label htmlFor="notice-reason" className="mt-2 block text-xs font-semibold text-slate-700">Lawful ground for ending early</label>
              <textarea id="notice-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="mt-1 min-h-16 w-full resize-y rounded-md border border-solid border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
            </>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={!leaveOn || busy === "notice" || (side === "LANDLORD" && reason.trim().length < 10)} onClick={() => post("notice", "notice", { leaveOn, reason: reason.trim() || null })} className={primary}>Give notice</button>
            <button type="button" onClick={() => setMode(null)} className={outline}>Back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {view.status === "RESERVED" ? <button type="button" onClick={openCancel} className={`${btn} border-0 bg-transparent px-0 text-red-700 hover:underline`}><XCircle className="h-4 w-4" />Cancel the booking</button> : null}
          {view.status === "ACTIVE" ? <button type="button" onClick={() => { setMode("notice"); setReason(""); }} className={outline}><CalendarX2 className="h-4 w-4" />Give notice</button> : null}
          {side === "TENANT" && view.status === "ACTIVE" && daysToEnd != null && daysToEnd <= 60 ? (
            <button type="button" disabled={busy === "renew"} onClick={async () => { const data = await post("renew", "renew"); if (data?.ref) router.push(`/account/bookings/long-stays/${encodeURIComponent(data.ref)}`); }} className={primary}>
              {busy === "renew" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}Renew my stay
            </button>
          ) : null}
          {side === "LANDLORD" && ["ACTIVE", "ENDING", "OVERDUE"].includes(view.status) && endPassed ? (
            <button type="button" disabled={busy === "moveout"} onClick={() => post("moveout", "move-out")} className={primary}><LogOut className="h-4 w-4" />Confirm the tenant moved out</button>
          ) : null}
        </div>
      )}
      {error ? <p className="m-0 text-[13px] text-red-700">{error}</p> : null}
    </div>
  );
}
