"use client";

/**
 * Long-stay tenancies for admins (docs/LONG_STAY_RENTALS.md, milestone 7):
 * landlord payouts to approve, problems to decide, refunds owed, move-ins.
 * Every action is checked and audited on the server; TZS payouts continue in
 * Disbursements, USD payouts are paid by bank and recorded here.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarX2, HandCoins, History, Home, Inbox, KeyRound, List, Loader2, Phone, Undo2, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";

type View = "payouts" | "disputes" | "refunds" | "movein" | "ending" | "claims" | "all";
type Item = {
  ref: string;
  status: string;
  payoutStatus: string;
  home: string | null;
  landlord: { name: string | null; phone: string | null };
  tenant: { name: string | null; phone: string | null };
  currency: string;
  moveInDate: string | null;
  termMonths: number | null;
  paidAmount: number | null;
  balanceDue: number | null;
  landlordBalanceAmount: number | null;
  tenantBalanceAmount: number | null;
  balanceMismatch: boolean;
  moveInConfirmedBy: string | null;
  landlordPayout: number;
  payoutReleasedAt: string | null;
  disputedAt: string | null;
};

const TABS: Array<{ key: View; label: string; Icon: typeof Wallet }> = [
  { key: "payouts", label: "Payouts", Icon: Wallet },
  { key: "disputes", label: "Problems", Icon: AlertTriangle },
  { key: "refunds", label: "Refunds owed", Icon: Undo2 },
  { key: "movein", label: "Moving in", Icon: KeyRound },
  { key: "ending", label: "Ending", Icon: CalendarX2 },
  { key: "claims", label: "Claims", Icon: HandCoins },
  { key: "all", label: "All", Icon: List },
];
const PAYOUT_LABEL: Record<string, string> = { NONE: "Not paid", HELD: "Held", READY: "Ready to approve", REVIEW: "Needs review", APPROVED: "In Disbursements", RELEASED: "Sent", REFUND_DUE: "Refund owed", REFUNDED: "Refunded" };

function money(value: number | null | undefined, currency: string) {
  return value == null ? "-" : `${currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: currency === "TZS" ? 0 : 2 })}`;
}
function day(iso: string | null) {
  return iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-";
}

const EMPTY: Record<View, { title: string; text: string }> = {
  payouts: { title: "No payouts waiting", text: "A landlord's first month shows here once the tenant has moved in." },
  disputes: { title: "No problems reported", text: "When a tenant or landlord reports a problem, the money is held here for your decision." },
  refunds: { title: "No refunds owed", text: "Cancelled bookings that owe the tenant money show here until you pay them back." },
  movein: { title: "Nobody moving in", text: "Paid bookings waiting for move-in day and both confirmations." },
  ending: { title: "No stays ending", text: "Stays with notice given or past their end date show here." },
  claims: { title: "No open claims", text: "Money a landlord owes a tenant under the lease." },
  all: { title: "No long stays yet", text: "Every reservation and tenancy shows here once tenants reserve." },
};

export default function LongStayTenanciesPage() {
  const [view, setView] = useState<View>("payouts");
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<View, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Claims have their own list; the tenancy call still refreshes the counts.
      const response = await apiClient.get<{ items: Item[]; counts: Partial<Record<View, number>> }>(`/api/admin/long-stay/tenancies?view=${view === "claims" ? "payouts" : view}`);
      setCounts(response.data.counts ?? {});
      setItems(view === "claims" ? [] : response.data.items);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load tenancies.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [view]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  const attention = (counts.payouts ?? 0) + (counts.disputes ?? 0) + (counts.refunds ?? 0);
  return (
    <div id="ls-tenancies" className="w-full">
      <style>{`#ls-tenancies, #ls-tenancies * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<View>
        kicker="Long stays"
        title="Long-stay tenancies"
        description="Approve landlord payouts after move-in, decide reported problems, refund money owed to tenants, and follow every stay to its end."
        metrics={[
          { label: "Needs you", value: counts.payouts == null ? "-" : attention, tone: attention ? "warn" : "good" },
          { label: "Payouts", value: counts.payouts ?? "-", tone: counts.payouts ? "warn" : "muted" },
          { label: "Problems", value: counts.disputes ?? "-", tone: counts.disputes ? "warn" : "muted" },
          { label: "Refunds owed", value: counts.refunds ?? "-", tone: counts.refunds ? "warn" : "muted" },
          { label: "Moving in", value: counts.movein ?? "-", tone: "default" },
        ]}
        onRefresh={load}
        loading={loading}
        tabs={TABS.map((t) => ({ ...t, count: t.key === "all" ? undefined : counts[t.key] }))}
        activeTab={view}
        onTab={setView}
      />
      {error ? <p className="m-0 mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 space-y-3">
        {view === "claims" ? <ClaimsList /> : items === null ? (
          <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-10 text-center">
            <Inbox className="mx-auto h-7 w-7 text-slate-300" />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-700">{EMPTY[view].title}</p>
            <p className="m-0 mt-0.5 text-[13px] text-slate-500">{EMPTY[view].text}</p>
          </div>
        ) : items.map((item) => <TenancyCard key={item.ref} item={item} onChanged={load} />)}
      </div>
    </div>
  );
}

function TenancyCard({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [mode, setMode] = useState<"manual" | "resolve" | "history" | "claim" | null>(null);
  const [claimKind, setClaimKind] = useState("UNUSED_RENT");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimReason, setClaimReason] = useState("");
  const [reference, setReference] = useState("");
  const [to, setTo] = useState("ACTIVE");
  const [payout, setPayout] = useState("READY");
  const [note, setNote] = useState("");
  const [reinspect, setReinspect] = useState(false);
  const [events, setEvents] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const call = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiClient.post(`/api/admin/long-stay/tenancies/${encodeURIComponent(item.ref)}/${path}`, body);
      setMessage({ tone: "ok", text: response.data?.next || done });
      setMode(null);
      onChanged();
    } catch (requestError: any) {
      setMessage({ tone: "error", text: requestError?.response?.data?.error || "Could not save." });
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async () => {
    setMode(mode === "history" ? null : "history");
    if (events) return;
    try {
      const response = await apiClient.get(`/api/admin/long-stay/tenancies/${encodeURIComponent(item.ref)}/events`);
      setEvents(response.data.events);
    } catch {
      setEvents([]);
    }
  };

  const payable = ["READY", "REVIEW"].includes(item.payoutStatus) || item.payoutStatus === "APPROVED";
  const btn = "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold disabled:opacity-50 [font-family:inherit]";
  const outline = `${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

  return (
    <article className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><Home className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
            {item.home || "Long stay"}
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{item.status.replace(/_/g, " ").toLowerCase()}</span>
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${item.payoutStatus === "REVIEW" || item.payoutStatus === "REFUND_DUE" ? "bg-amber-50 text-amber-800" : item.payoutStatus === "RELEASED" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-800"}`}>{PAYOUT_LABEL[item.payoutStatus] ?? item.payoutStatus}</span>
          </p>
          <p className="m-0 mt-0.5 font-mono text-[11px] text-slate-400">{item.ref}</p>
          <dl className="m-0 mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <Fact label="Landlord" value={item.landlord.name || "-"} sub={item.landlord.phone} />
            <Fact label="Tenant" value={item.tenant.name || "-"} sub={item.tenant.phone} />
            <Fact label="Move-in" value={day(item.moveInDate)} sub={item.termMonths ? `${item.termMonths} months` : null} />
            <Fact label="Paid to NoLSAF" value={money(item.paidAmount, item.currency)} />
            <Fact label="Lease balance" value={money(item.balanceDue, item.currency)} />
            <Fact label="Landlord says" value={money(item.landlordBalanceAmount, item.currency)} warn={item.balanceMismatch && item.landlordBalanceAmount !== item.balanceDue} />
            <Fact label="Tenant says" value={money(item.tenantBalanceAmount, item.currency)} warn={item.balanceMismatch && item.tenantBalanceAmount !== item.balanceDue} />
            <Fact label="Landlord payout" value={money(item.landlordPayout, item.currency)} strong />
          </dl>
          {item.balanceMismatch ? <p className="m-0 mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />A confirmed balance does not match the lease. Call both sides before paying.</p> : null}
          {item.moveInConfirmedBy && item.moveInConfirmedBy !== "BOTH" ? <p className="m-0 mt-1 text-xs text-slate-500">Move-in confirmed by {item.moveInConfirmedBy === "ADMIN" ? "an admin" : "one side after 72 hours"}.</p> : null}
        </div>
      </div>

      {mode === "manual" ? (
        <div className="border-0 border-t border-solid border-slate-100 p-4">
          <label htmlFor={`ref-${item.ref}`} className="block text-xs font-semibold text-slate-700">Bank transfer reference for {money(item.landlordPayout, item.currency)}</label>
          <input id={`ref-${item.ref}`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 px-2.5 text-sm outline-none focus:border-[#02665e]" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || reference.trim().length < 4} onClick={() => call("payout/manual", { reference: reference.trim() }, "Payout recorded.")} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>Record payout</button>
            <button type="button" onClick={() => setMode(null)} className={outline}>Cancel</button>
          </div>
        </div>
      ) : mode === "resolve" ? (
        <div className="grid gap-2 border-0 border-t border-solid border-slate-100 p-4 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-700">Tenancy goes to
            <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2 text-sm font-normal">
              <option value="ACTIVE">Let (move-in stands)</option>
              <option value="MOVE_IN">Back to move-in confirmations</option>
              <option value="RESERVED">Back to reserved</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="ENDED">Ended</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">First month
            <select value={payout} onChange={(e) => setPayout(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2 text-sm font-normal">
              <option value="READY">Pay the landlord</option>
              <option value="REVIEW">Keep holding for review</option>
              <option value="REFUND_DUE">Refund the tenant</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">Decision note (kept on record)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1 min-h-16 w-full resize-y rounded-md border border-solid border-slate-300 px-2.5 py-2 text-sm font-normal outline-none focus:border-[#02665e] [font-family:inherit]" />
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={reinspect} onChange={(e) => setReinspect(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#02665e]" />
            End this home’s current inspection and request another visit. New reservations pause until the home passes again.
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy || note.trim().length < 10} onClick={() => call("resolve", { to, payout, note: note.trim(), reinspect }, "Decision saved.")} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>Save decision</button>
            <button type="button" onClick={() => setMode(null)} className={outline}>Cancel</button>
          </div>
        </div>
      ) : mode === "claim" ? (
        <div className="grid gap-2 border-0 border-t border-solid border-slate-100 p-4 sm:grid-cols-[1fr_1fr]">
          <label className="block text-xs font-semibold text-slate-700">What the landlord owes the tenant
            <select value={claimKind} onChange={(e) => setClaimKind(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2 text-sm font-normal">
              <option value="UNUSED_RENT">Unused prepaid months</option>
              <option value="BALANCE_RETURN">Balance to give back</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">Amount ({item.currency})
            <input value={claimAmount} onChange={(e) => setClaimAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 px-2.5 text-sm font-normal outline-none focus:border-[#02665e]" />
          </label>
          <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">Why (both sides see this)
            <textarea value={claimReason} onChange={(e) => setClaimReason(e.target.value)} maxLength={500} className="mt-1 min-h-16 w-full resize-y rounded-md border border-solid border-slate-300 px-2.5 py-2 text-sm font-normal outline-none focus:border-[#02665e] [font-family:inherit]" />
          </label>
          <p className="m-0 text-[12px] text-slate-500 sm:col-span-2">The landlord gets 14 days to pay the tenant directly. After that their long stays pause and it is taken from their next long-stay payout.</p>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy || !(Number(claimAmount) > 0) || claimReason.trim().length < 10} onClick={() => call("claims", { kind: claimKind, amount: Number(claimAmount), reason: claimReason.trim() }, "Claim opened.")} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>Open claim</button>
            <button type="button" onClick={() => setMode(null)} className={outline}>Cancel</button>
          </div>
        </div>
      ) : mode === "history" ? (
        <ol className="m-0 max-h-64 list-none space-y-1 overflow-auto border-0 border-t border-solid border-slate-100 p-4 text-xs text-slate-600">
          {events === null ? <li><Loader2 className="h-4 w-4 animate-spin" /></li> : events.map((e, i) => (
            <li key={i}><span className="text-slate-400">{new Date(e.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })}</span> · <b>{e.actorRole.toLowerCase()}</b> · {String(e.type).replace(/_/g, " ").toLowerCase()}{e.data?.reason ? `: ${e.data.reason}` : e.data?.note ? `: ${e.data.note}` : ""}</li>
          ))}
        </ol>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-100 px-4 py-2.5">
        {payable && item.currency === "TZS" ? (
          <button type="button" disabled={busy} onClick={() => call("payout/approve", {}, "Sent to Disbursements.")} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
            <Wallet className="h-4 w-4" />{item.payoutStatus === "APPROVED" ? "Request again" : "Approve payout"}
          </button>
        ) : null}
        {["READY", "REVIEW"].includes(item.payoutStatus) ? <button type="button" onClick={() => setMode("manual")} className={outline}>Record bank payout</button> : null}
        {item.status === "DISPUTED" || item.status === "MOVE_IN" || item.payoutStatus === "REVIEW" ? <button type="button" onClick={() => setMode("resolve")} className={outline}>Decide</button> : null}
        {["ACTIVE", "ENDING", "ENDED", "OVERDUE", "DISPUTED"].includes(item.status) && item.moveInConfirmedBy ? <button type="button" onClick={() => setMode("claim")} className={outline}>Open claim</button> : null}
        <button type="button" onClick={openHistory} className={`${btn} ml-auto border-0 bg-transparent text-slate-500 hover:text-slate-800`}><History className="h-4 w-4" />History</button>
        {item.payoutStatus === "APPROVED" ? <Link href="/admin/disbursements" className="text-[13px] font-semibold text-[#02665e] no-underline hover:underline">Open Disbursements</Link> : null}
      </div>
      {message ? <p className={`m-0 px-4 pb-3 text-xs ${message.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
    </article>
  );
}

function Fact({ label, value, sub, warn, strong }: { label: string; value: string; sub?: string | null; warn?: boolean; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className={`m-0 truncate ${warn ? "font-semibold text-amber-700" : strong ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>{value}</dd>
      {sub ? <dd className="m-0 flex items-center gap-1 truncate text-[11px] text-slate-500"><Phone className="h-3 w-3" />{sub}</dd> : null}
    </div>
  );
}

type ClaimRow = { id: number; kind: string; amount: number; recoveredAmount: number; currency: string; status: string; reason: string; dueAt: string; escalatedAt: string | null; closedAt: string | null; tenancyRef: string; home: string | null };

/** Claims under the lease: open, being recovered, or recovered and owed to the tenant. */
function ClaimsList() {
  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  const [acting, setActing] = useState<{ id: number; outcome: string } | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get<{ items: ClaimRow[] }>("/api/admin/long-stay/claims?scope=open");
      setRows(response.data.items);
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const close = async () => {
    if (!acting) return;
    setMessage("");
    try {
      await apiClient.post(`/api/admin/long-stay/claims/${acting.id}/close`, { outcome: acting.outcome, note: note.trim() });
      setActing(null);
      setNote("");
      void load();
    } catch (requestError: any) {
      setMessage(requestError?.response?.data?.error || "Could not save.");
    }
  };

  if (rows === null) return <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!rows.length) return (
    <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-10 text-center">
      <Inbox className="mx-auto h-7 w-7 text-slate-300" />
      <p className="m-0 mt-2 text-sm font-semibold text-slate-700">No open claims</p>
      <p className="m-0 mt-0.5 text-[13px] text-slate-500">Open one from a tenancy when a landlord owes the tenant money under the lease.</p>
    </div>
  );
  const btn = "inline-flex h-8 cursor-pointer items-center justify-center rounded-md px-3 text-[13px] font-semibold [font-family:inherit]";
  return (
    <div className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      {rows.map((c) => (
        <div key={c.id} className="border-0 border-t border-solid border-slate-100 px-4 py-3 first:border-t-0">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-bold text-slate-900">{money(c.amount, c.currency)} <span className="font-normal text-slate-500">owed to the tenant, {c.home || "long stay"}</span></p>
              <p className="m-0 mt-0.5 text-xs text-slate-600">{c.reason}</p>
              <p className="m-0 mt-0.5 font-mono text-[11px] text-slate-400">{c.tenancyRef}</p>
              <p className="m-0 mt-1 text-xs">
                <span className={`rounded-md px-1.5 py-0.5 font-semibold ${c.status === "RECOVERING" ? "bg-red-50 text-red-700" : c.status === "RECOVERED" ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"}`}>
                  {c.status === "OPEN" ? `Due ${day(c.dueAt)}` : c.status === "RECOVERING" ? `Past due, ${money(c.recoveredAmount, c.currency)} recovered` : "Recovered: pay it to the tenant"}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {c.status === "RECOVERED" ? (
                <button type="button" onClick={() => setActing({ id: c.id, outcome: "PAID_TO_TENANT" })} className={`${btn} border-0 bg-[#02665e] text-white`}>Paid to tenant</button>
              ) : (
                <>
                  {c.recoveredAmount === 0 ? <button type="button" onClick={() => setActing({ id: c.id, outcome: "SETTLED" })} className={`${btn} border border-solid border-slate-300 bg-white text-slate-700`}>Landlord paid</button> : null}
                  <button type="button" onClick={() => setActing({ id: c.id, outcome: "WAIVED" })} className={`${btn} border border-solid border-slate-300 bg-white text-slate-700`}>Waive</button>
                </>
              )}
            </div>
          </div>
          {acting?.id === c.id ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the record (reference, reason)" maxLength={500} className="h-8 min-w-0 flex-1 rounded-md border border-solid border-slate-300 px-2.5 text-sm outline-none focus:border-[#02665e]" />
              <button type="button" disabled={note.trim().length < 5} onClick={close} className={`${btn} border-0 bg-[#02665e] text-white disabled:opacity-50`}>Save</button>
              <button type="button" onClick={() => setActing(null)} className={`${btn} border border-solid border-slate-300 bg-white text-slate-700`}>Cancel</button>
            </div>
          ) : null}
          {acting?.id === c.id && message ? <p className="m-0 mt-1 text-xs text-red-700">{message}</p> : null}
        </div>
      ))}
    </div>
  );
}
