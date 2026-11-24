"use client";

/**
 * Long-stay tenancies for admins (docs/LONG_STAY_RENTALS.md, milestone 7):
 * landlord payouts to approve, problems to decide, refunds owed, move-ins.
 * Every action is checked and audited on the server; TZS payouts continue in
 * Disbursements, USD payouts are paid by bank and recorded here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminNotificationTarget from "@/components/longStay/AdminNotificationTarget";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CalendarDays, CalendarX2, HandCoins, History, Home, Inbox, KeyRound, List, Loader2, Phone, Undo2, Users, Wallet, X } from "lucide-react";
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
const STAY_LABEL: Record<string, string> = { OFFERED: "Awaiting landlord", ACCEPTED: "Lease to sign", AWAITING_PAYMENT: "Awaiting payment", RESERVED: "Reserved", MOVE_IN: "Moving in", ACTIVE: "Active", ENDING: "Ending", ENDED: "Ended", CANCELLED: "Cancelled", DISPUTED: "Problem reported", OVERDUE: "Overdue" };
const EVENT_TITLE: Record<string, string> = { RESERVATION_REQUESTED: "Reservation requested", ACCEPTED: "Landlord confirmed", LEASE_ACCEPTED: "Lease signed", AWAITING_PAYMENT: "Both signatures received", RESERVED: "Card payment received", MOVE_IN: "Move-in opened", ACTIVE: "Move-in confirmed", PAYOUT_PAID: "Payout sent", PAYOUT_RECORDED: "Bank payout recorded" };

function PayoutStatus({ status }: { status: string }) {
  const tone = status === "REVIEW" || status === "REFUND_DUE" ? "bg-amber-50 text-amber-900"
    : status === "RELEASED" ? "bg-emerald-50 text-emerald-800" : status === "NONE" ? "bg-slate-100 text-slate-700" : "bg-sky-50 text-sky-900";
  return <span className={`inline-flex w-fit rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>{PAYOUT_LABEL[status] ?? status}</span>;
}

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
  const params = useSearchParams();
  const requestedView = params?.get("view");
  const initialView = TABS.find((tab) => tab.key === requestedView)?.key ?? "payouts";
  const target = params?.get("ref");
  const claim = initialView === "claims" ? params?.get("claim") : null;
  return <TenancyQueue key={`${initialView}:${target ?? ""}:${claim ?? ""}`} initialView={initialView} target={target} claim={claim} />;
}

function TenancyQueue({ initialView, target, claim }: { initialView: View; target: string | null | undefined; claim: string | null | undefined }) {
  const [view, setView] = useState<View>(initialView);
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<View, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Claims have their own list; the tenancy call still refreshes the counts.
      const response = await apiClient.get<{ items: Item[]; counts: Partial<Record<View, number>> }>("/api/admin/long-stay/tenancies", { params: { view: view === "claims" ? "payouts" : view, ref: target } });
      setCounts(response.data.counts ?? {});
      setItems(view === "claims" ? [] : response.data.items);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load tenancies.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [view, target]);
  useEffect(() => { setItems(null); setSelected(null); void load(); }, [load]);
  const refreshCase = () => {
    window.dispatchEvent(new Event("nols:admin-long-stay-queue-change"));
    return load();
  };
  const refreshSelected = async (ref: string) => {
    await Promise.all([
      refreshCase(),
      apiClient.get<{ items: Item[] }>("/api/admin/long-stay/tenancies", { params: { view: "all", ref } })
        .then(({ data }) => setSelected((current) => current?.ref === ref ? data.items[0] ?? null : current))
        .catch(() => setSelected((current) => current?.ref === ref ? null : current)),
    ]);
  };

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
        tabs={target || claim ? undefined : TABS.map((t) => ({ ...t, count: t.key === "all" ? undefined : counts[t.key] }))}
        activeTab={view}
        onTab={setView}
      />
      {(target || claim) && <AdminNotificationTarget href={`/admin/long-stay/tenancies?view=${view}`}>{claim ? "Claim from Notifications" : "Tenancy from Notifications"}</AdminNotificationTarget>}
      {error ? <p className="m-0 mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 space-y-3">
        {view === "claims" ? <ClaimsList target={claim} /> : items === null ? (
          <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-10 text-center">
            <Inbox className="mx-auto h-7 w-7 text-slate-300" />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-700">{target ? "Tenancy unavailable" : EMPTY[view].title}</p>
            {!target && <p className="m-0 mt-0.5 text-[13px] text-slate-500">{EMPTY[view].text}</p>}
          </div>
        ) : target ? (
          <TenancyCard item={items[0]} onChanged={refreshCase} />
        ) : <TenancyRows items={items} onOpen={setSelected} />}
      </div>
      {selected && <TenancyDialog item={selected} onClose={() => setSelected(null)} onChanged={() => refreshSelected(selected.ref)} />}
    </div>
  );
}

function TenancyRows({ items, onOpen }: { items: Item[]; onOpen: (item: Item) => void }) {
  return (
    <section aria-label="Tenancy queue" className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <h2 className="m-0 text-base font-bold text-slate-950">Tenancy queue</h2>
        <span className="text-xs font-semibold tabular-nums text-slate-600">{items.length} shown</span>
      </div>
      <div className="hidden grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,.85fr)_minmax(0,1fr)_5rem] gap-4 bg-[#f1f6f4] px-5 py-2.5 text-xs font-semibold text-[#215b50] lg:grid" aria-hidden>
        <span>Property</span><span>Tenant</span><span>Move-in</span><span>Payout</span><span>Details</span>
      </div>
      <ul className="m-0 list-none divide-y divide-slate-100 p-0">
        {items.map((item) => (
          <li key={item.ref} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,.85fr)_minmax(0,1fr)_5rem]">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e8f3ef] text-[#02665e]"><Home className="size-4" aria-hidden /></span>
              <div className="min-w-0">
                <p className="m-0 break-words text-sm font-bold text-slate-950">{item.home || "Long stay"}</p>
                <p className="m-0 mt-0.5 text-xs text-slate-600">{STAY_LABEL[item.status] ?? item.status}</p>
              </div>
            </div>
            <p className="m-0 hidden break-words text-sm text-slate-700 lg:block">{item.tenant.name || "—"}</p>
            <p className="m-0 text-xs text-slate-600 lg:text-sm"><span className="lg:hidden">Move-in · </span>{day(item.moveInDate)}</p>
            <div className="col-start-2 row-start-1 lg:col-start-auto lg:row-start-auto"><PayoutStatus status={item.payoutStatus} /></div>
            <button type="button" onClick={() => onOpen(item)} aria-haspopup="dialog" aria-label={`View tenancy for ${item.home || "long stay"}`} className="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-[#cde2d8] bg-white px-2.5 text-xs font-semibold text-[#215b50] hover:bg-[#edf6f2] focus-visible:outline-2 focus-visible:outline-[#02665e]">
              View <ArrowUpRight className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TenancyDialog({ item, onClose, onChanged }: { item: Item; onClose: () => void; onChanged: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} onClose={onClose} aria-label={`Tenancy for ${item.home || "long stay"}`}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[min(68rem,calc(100%-1.5rem))] max-w-none overflow-y-auto rounded-xl border-0 bg-white p-0 shadow-2xl backdrop:bg-[#071b17]/65">
      <TenancyCard item={item} onChanged={onChanged} onClose={() => dialog.current?.close()} />
    </dialog>
  );
}

type TenancyEvent = { actorRole: string; type: string; toStatus?: string | null; createdAt: string; data?: { reason?: string; note?: string } | null };

function TenancyCard({ item, onChanged, onClose }: { item: Item; onChanged: () => Promise<void>; onClose?: () => void }) {
  const [mode, setMode] = useState<"manual" | "resolve" | "history" | "claim" | null>(null);
  const [claimKind, setClaimKind] = useState("UNUSED_RENT");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimReason, setClaimReason] = useState("");
  const [reference, setReference] = useState("");
  const [to, setTo] = useState("ACTIVE");
  const [payout, setPayout] = useState("READY");
  const [note, setNote] = useState("");
  const [reinspect, setReinspect] = useState(false);
  const [events, setEvents] = useState<TenancyEvent[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const call = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiClient.post(`/api/admin/long-stay/tenancies/${encodeURIComponent(item.ref)}/${path}`, body);
      setMessage({ tone: "ok", text: response.data?.next || done });
      setMode(null);
      await onChanged();
    } catch (requestError: any) {
      setMessage({ tone: "error", text: requestError?.response?.data?.error || "Could not save." });
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async () => {
    setHistoryError(false);
    setEvents(null);
    try {
      const response = await apiClient.get<{ events: TenancyEvent[] }>(`/api/admin/long-stay/tenancies/${encodeURIComponent(item.ref)}/events`);
      setEvents(response.data.events);
    } catch {
      setHistoryError(true);
    }
  };
  const openHistory = () => {
    if (mode === "history") { setMode(null); return; }
    setMode("history");
    void loadHistory();
  };

  const payable = ["READY", "REVIEW"].includes(item.payoutStatus) || item.payoutStatus === "APPROVED";
  const btn = "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold disabled:opacity-50 [font-family:inherit]";
  const outline = `${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

  return (
    <article className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
      <header className="relative isolate overflow-hidden bg-[#0b2420] px-4 py-5 text-white sm:px-5">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.20),transparent_65%)]" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white/10 text-emerald-200"><Home className="size-4" aria-hidden /></span>
            <div className="min-w-0">
              <h2 className="m-0 break-words text-xl font-bold tracking-tight text-white sm:text-2xl">{item.home || "Long stay"}</h2>
              <p className="m-0 mt-1 font-mono text-xs text-white/75 [overflow-wrap:anywhere]">{item.ref}</p>
            </div>
          </div>
          {onClose && <button type="button" onClick={onClose} aria-label="Close tenancy" className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md border border-solid border-white/20 bg-white/5 text-white hover:bg-white/15"><X className="size-4" aria-hidden /></button>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white">{STAY_LABEL[item.status] ?? item.status}</span>
          <PayoutStatus status={item.payoutStatus} />
        </div>
      </header>
      <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <section className="min-w-0 rounded-lg border border-solid border-slate-200 p-3.5">
          <h3 className="m-0 flex items-center gap-2 text-sm font-bold text-slate-950"><Users className="size-4 text-[#02665e]" aria-hidden />People and move-in</h3>
          <dl className="m-0 mt-3 grid grid-cols-2 gap-3">
            <Fact label="Landlord" value={item.landlord.name || "—"} phone={item.landlord.phone} />
            <Fact label="Tenant" value={item.tenant.name || "—"} phone={item.tenant.phone} />
            <Fact label="Move-in" value={day(item.moveInDate)} sub={item.termMonths ? `${item.termMonths} ${item.termMonths === 1 ? "month" : "months"}` : null} />
            {item.moveInConfirmedBy && <Fact label="Confirmed by" value={item.moveInConfirmedBy === "BOTH" ? "Both parties" : item.moveInConfirmedBy === "ADMIN" ? "NoLSAF" : "One party after 72 hours"} />}
          </dl>
        </section>
        <section className="min-w-0 rounded-lg border border-solid border-[#d9e7e2] bg-[#f5f9f7] p-3.5">
          <h3 className="m-0 flex items-center gap-2 text-sm font-bold text-slate-950"><Wallet className="size-4 text-[#02665e]" aria-hidden />Payment breakdown</h3>
          <dl className="m-0 mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Paid to NoLSAF" value={money(item.paidAmount, item.currency)} />
            <Fact label="Rent due at move-in" value={money(item.balanceDue, item.currency)} />
            <Fact label="Landlord payout" value={money(item.landlordPayout, item.currency)} strong sub={item.payoutReleasedAt ? `Sent ${day(item.payoutReleasedAt)}` : null} />
            {item.landlordBalanceAmount != null && <Fact label="Landlord confirmed" value={money(item.landlordBalanceAmount, item.currency)} warn={item.balanceMismatch && item.landlordBalanceAmount !== item.balanceDue} />}
            {item.tenantBalanceAmount != null && <Fact label="Tenant confirmed" value={money(item.tenantBalanceAmount, item.currency)} warn={item.balanceMismatch && item.tenantBalanceAmount !== item.balanceDue} />}
          </dl>
          {item.balanceMismatch && <p role="status" className="m-0 mt-3 flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs font-semibold text-amber-900"><AlertTriangle className="size-4 shrink-0" aria-hidden />The reported balance differs from the lease. Check with both parties before paying.</p>}
        </section>
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
        <section aria-label="Tenancy activity" className="mx-4 mb-4 overflow-hidden rounded-lg border border-solid border-slate-200 sm:mx-5">
          <h3 className="m-0 flex items-center gap-2 bg-[#f1f6f4] px-3.5 py-3 text-sm font-bold text-slate-950"><History className="size-4 text-[#02665e]" aria-hidden />Tenancy activity</h3>
          {historyError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3">
              <p role="alert" className="m-0 text-sm text-rose-800">Could not load tenancy activity.</p>
              <button type="button" onClick={() => void loadHistory()} className={outline}>Retry</button>
            </div>
          ) : events === null ? (
            <p role="status" className="m-0 flex items-center gap-2 p-3.5 text-sm text-slate-700"><Loader2 className="size-4 animate-spin" aria-hidden />Loading activity</p>
          ) : events.length === 0 ? (
            <p className="m-0 p-3.5 text-sm text-slate-600">No activity recorded.</p>
          ) : (
            <ol className="m-0 max-h-[min(24rem,50dvh)] list-none divide-y divide-slate-100 overflow-auto p-0">
              {events.map((event, index) => {
                const statusTitle = event.type.startsWith("STATUS_") && event.toStatus ? EVENT_TITLE[event.toStatus] ?? STAY_LABEL[event.toStatus] : undefined;
                const title = EVENT_TITLE[event.type] ?? statusTitle ?? event.type.replace(/_/g, " ").toLowerCase();
                const actor = event.actorRole === "SYSTEM" ? "NoLSAF system" : event.actorRole === "ADMIN" ? "NoLSAF admin" : event.actorRole.toLowerCase();
                return (
                  <li key={`${event.createdAt}:${index}`} className="grid gap-x-3 gap-y-1 px-3.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold text-slate-900 first-letter:uppercase">{title} <span className="ml-1 text-xs font-medium capitalize text-slate-600">· {actor}</span></p>
                      {(event.data?.reason || event.data?.note) && <p className="m-0 mt-1 break-words text-xs text-slate-600">{event.data.reason || event.data.note}</p>}
                    </div>
                    <time dateTime={event.createdAt} className="flex items-center gap-1.5 text-xs tabular-nums text-slate-600"><CalendarDays className="size-3.5 shrink-0 text-[#02665e]" aria-hidden />{new Date(event.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT</time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
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
        <button type="button" onClick={openHistory} aria-expanded={mode === "history"} className={`${outline} sm:ml-auto`}><History className="size-4 text-[#02665e]" aria-hidden />{mode === "history" ? "Hide activity" : "View activity"}</button>
        {item.payoutStatus === "APPROVED" ? <Link href="/admin/disbursements" className="text-[13px] font-semibold text-[#02665e] no-underline hover:underline">Open Disbursements</Link> : null}
      </div>
      {message ? <p className={`m-0 px-4 pb-3 text-xs ${message.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
    </article>
  );
}

function Fact({ label, value, sub, phone, warn, strong }: { label: string; value: string; sub?: string | null; phone?: string | null; warn?: boolean; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className={`m-0 mt-0.5 break-words tabular-nums ${warn ? "text-sm font-semibold text-amber-900" : strong ? "text-base font-bold text-[#215b50]" : "text-sm font-semibold text-slate-900"}`}>{value}</dd>
      {sub && <dd className="m-0 mt-0.5 text-xs text-slate-600">{sub}</dd>}
      {phone && <dd className="m-0 mt-0.5"><a href={`tel:${phone}`} className="inline-flex items-center gap-1 break-all text-xs font-medium text-[#02665e] no-underline hover:underline"><Phone className="size-3 shrink-0" aria-hidden />{phone}</a></dd>}
    </div>
  );
}

type ClaimRow = { id: number; kind: string; amount: number; recoveredAmount: number; currency: string; status: string; reason: string; dueAt: string; escalatedAt: string | null; closedAt: string | null; tenancyRef: string; home: string | null };

/** Claims under the lease: open, being recovered, or recovered and owed to the tenant. */
function ClaimsList({ target }: { target?: string | null }) {
  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  const [acting, setActing] = useState<{ id: number; outcome: string } | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get<{ items: ClaimRow[] }>("/api/admin/long-stay/claims", { params: { scope: "open", id: target } });
      setRows(response.data.items);
    } catch {
      setRows([]);
    }
  }, [target]);
  useEffect(() => { void load(); }, [load]);

  const close = async () => {
    if (!acting) return;
    setMessage("");
    try {
      await apiClient.post(`/api/admin/long-stay/claims/${acting.id}/close`, { outcome: acting.outcome, note: note.trim() });
      setActing(null);
      setNote("");
      window.dispatchEvent(new Event("nols:admin-long-stay-queue-change"));
      void load();
    } catch (requestError: any) {
      setMessage(requestError?.response?.data?.error || "Could not save.");
    }
  };

  if (rows === null) return <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!rows.length) return (
    <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-10 text-center">
      <Inbox className="mx-auto h-7 w-7 text-slate-300" />
      <p className="m-0 mt-2 text-sm font-semibold text-slate-700">{target ? "Claim unavailable" : "No open claims"}</p>
      {!target && <p className="m-0 mt-0.5 text-[13px] text-slate-500">Open one from a tenancy when a landlord owes the tenant money under the lease.</p>}
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
                  {c.closedAt ? `Closed ${day(c.closedAt)}` : c.status === "OPEN" ? `Due ${day(c.dueAt)}` : c.status === "RECOVERING" ? `Past due, ${money(c.recoveredAmount, c.currency)} recovered` : "Recovered: pay it to the tenant"}
                </span>
              </p>
            </div>
            {!c.closedAt && <div className="flex flex-wrap gap-2">
              {c.status === "RECOVERED" ? (
                <button type="button" onClick={() => setActing({ id: c.id, outcome: "PAID_TO_TENANT" })} className={`${btn} border-0 bg-[#02665e] text-white`}>Paid to tenant</button>
              ) : (
                <>
                  {c.recoveredAmount === 0 ? <button type="button" onClick={() => setActing({ id: c.id, outcome: "SETTLED" })} className={`${btn} border border-solid border-slate-300 bg-white text-slate-700`}>Landlord paid</button> : null}
                  <button type="button" onClick={() => setActing({ id: c.id, outcome: "WAIVED" })} className={`${btn} border border-solid border-slate-300 bg-white text-slate-700`}>Waive</button>
                </>
              )}
            </div>}
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
