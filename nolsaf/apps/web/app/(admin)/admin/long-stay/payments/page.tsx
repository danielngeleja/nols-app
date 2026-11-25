"use client";

/**
 * Long-stay payments (docs/LONG_STAY_RENTALS.md sections 4 and 5). One
 * ledger for every booking payment: what the tenant owed and paid, when and
 * how, how NoLSAF split it, the balance paid to the landlord at move-in,
 * what remains under the lease, and a risk check with its reasons. Opening a
 * row shows the card attempts and money events behind it. Read-only: the
 * actions (approve payout, refunds, decisions) stay on Tenancies.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, CreditCard, Gauge, HandCoins, Landmark, List, Loader2,
  Search, ShieldAlert, Undo2, Wallet, X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";

type View = "all" | "awaiting" | "held" | "release" | "released" | "refunds" | "risk";
type Flag = { code: string; level: "HIGH" | "MEDIUM"; text: string };
type Row = {
  ref: string;
  status: string;
  stage: "AWAITING" | "OVERDUE" | "HELD" | "TO_RELEASE" | "RELEASED" | "REFUND_DUE" | "REFUNDED" | "LAPSED";
  payoutStatus: string;
  currency: string;
  home: string | null;
  area: string;
  tenant: { name: string | null; phone: string | null };
  landlord: { name: string | null; phone: string | null };
  term: { months: number; prepaidMonths: number; moveIn: string | null; end: string | null; monthlyRent: number };
  booking: { expected: number | null; paid: number | null; paidAt: string | null; dueAt: string | null; method: string | null; gateway: string | null; reference: string | null; firstMonth: number; tenantFee: number };
  split: { tenantFee: number; landlordCommission: number; cardFee: number; cardFeePercent: number; landlordPayout: number; payoutDeduction: number; payoutReleasedAt: string | null; nolsafKeeps: number; refund: { amount: number; done: boolean } | null };
  balance: { expected: number; state: "NOT_DUE" | "AWAITING" | "CONFIRMED" | "ONE_SIDE" | "MISMATCH" | "NONE"; landlord: { amount: number | null; method: string | null; at: string | null } | null; tenant: { amount: number | null; method: string | null; at: string | null } | null };
  remaining: { months: number; amount: number; firstDueOn: string | null; paidTo: string | null };
  totals: { leaseRent: number; collectedByNolsaf: number; paidToLandlordAtMoveIn: number };
  risk: { level: "HIGH" | "MEDIUM" | "LOW"; score: number; flags: Flag[] };
};
type Totals = { currency: string; collected: number; held: number; toRelease: number; releasedToLandlords: number; refundsDue: number; nolsafKeeps: number; cardFees: number; balancesConfirmed: number; remainingUnderLeases: number; awaiting: number };
type Data = { counts: Record<View, number>; totals: Totals[]; items: Row[] };

const TABS: Array<{ key: View; label: string; Icon: typeof Wallet }> = [
  { key: "all", label: "All payments", Icon: List },
  { key: "risk", label: "Risk", Icon: ShieldAlert },
  { key: "awaiting", label: "Awaiting payment", Icon: Clock3 },
  { key: "held", label: "Held", Icon: Wallet },
  { key: "release", label: "To release", Icon: HandCoins },
  { key: "released", label: "Paid out", Icon: CheckCircle2 },
  { key: "refunds", label: "Refunds", Icon: Undo2 },
];
const STAGE: Record<Row["stage"], { label: string; cls: string }> = {
  AWAITING: { label: "Awaiting payment", cls: "bg-sky-50 text-sky-800" },
  OVERDUE: { label: "Payment late", cls: "bg-rose-50 text-rose-700" },
  HELD: { label: "Held by NoLSAF", cls: "bg-amber-50 text-amber-800" },
  TO_RELEASE: { label: "To release", cls: "bg-violet-50 text-violet-800" },
  RELEASED: { label: "Paid out", cls: "bg-emerald-50 text-emerald-800" },
  REFUND_DUE: { label: "Refund owed", cls: "bg-rose-50 text-rose-700" },
  REFUNDED: { label: "Refunded", cls: "bg-slate-100 text-slate-600" },
  LAPSED: { label: "Lapsed", cls: "bg-slate-100 text-slate-500" },
};
const BALANCE: Record<Row["balance"]["state"], { label: string; cls: string }> = {
  NOT_DUE: { label: "Due at move-in", cls: "text-slate-500" },
  AWAITING: { label: "Waiting for confirmations", cls: "text-amber-700" },
  ONE_SIDE: { label: "One side confirmed", cls: "text-amber-700" },
  CONFIRMED: { label: "Confirmed by both", cls: "text-emerald-700" },
  MISMATCH: { label: "Amounts disagree", cls: "font-semibold text-rose-700" },
  NONE: { label: "No balance", cls: "text-slate-400" },
};
const EVENT_LABEL: Record<string, string> = {
  RESERVED: "Card payment received, home reserved",
  PAYMENT_AFTER_CLOSE: "Payment arrived after the lease closed",
  ACTIVE: "Move-in confirmed",
  PAYOUT_PAID: "Payout sent to the landlord",
  PAYOUT_RECORDED: "Bank payout recorded",
  CANCELLED: "Cancelled",
  RESOLVED: "Admin decision",
  CLAIM_OPENED: "Claim opened",
};

const money = (v: number | null | undefined, c: string) => (v == null ? "-" : `${c} ${Number(v).toLocaleString("en-US", { maximumFractionDigits: c === "TZS" ? 0 : 2 })}`);
const when = (iso: string | null | undefined) => (iso ? `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "-");
const day = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-");
const soften = (s: string | null | undefined) => {
  const v = String(s || "").trim();
  return v && v === v.toUpperCase() ? v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bNolsaf\b/g, "NoLSAF") : v;
};
const methodLabel = (m: string | null | undefined) => (m === "BANK" ? "Bank transfer" : m === "MOBILE_MONEY" || m === "MOBILE" ? "Mobile money" : m || "-");

export default function LongStayPaymentsPage() {
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<Data>("/api/admin/long-stay/payments", { params: { view, q: query || undefined } });
      setData(response.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not load long-stay payments.");
    } finally {
      setLoading(false);
    }
  }, [view, query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = window.setTimeout(() => setQuery(q.trim()), 300); return () => window.clearTimeout(id); }, [q]);

  const [currency, setCurrency] = useState<string | null>(null);
  const totals = data?.totals ?? [];
  const t = totals.find((x) => x.currency === currency) ?? totals[0] ?? null;
  const filters = TABS.filter((tab) => tab.key === "all" || (data?.counts[tab.key] ?? 0) > 0 || tab.key === view);

  return (
    <div id="ls-payments" className="w-full space-y-4">
      <style>{`#ls-payments, #ls-payments * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<View>
        kicker="Long stays"
        title="Payments"
        description="Follow every long-stay payment from the tenant's card to the landlord, with what NoLSAF keeps, what is owed back and what is still to come."
        metrics={[]}
        onRefresh={load}
        loading={loading}
      />

      {/* Money flow: from the tenant's card to the landlord, left to right */}
      <section className="rounded-lg border border-solid border-slate-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
          <h2 className="m-0 text-[15px] font-bold text-slate-900">Money flow</h2>
          {totals.length > 1 ? (
            <div className="inline-flex rounded-md bg-slate-100 p-0.5" role="tablist" aria-label="Currency">
              {totals.map((x) => (
                <button key={x.currency} type="button" role="tab" aria-selected={t?.currency === x.currency} onClick={() => setCurrency(x.currency)}
                  className={`h-7 cursor-pointer rounded border-0 px-3 text-[12.5px] font-semibold [font-family:inherit] ${t?.currency === x.currency ? "bg-white text-slate-900 shadow-sm" : "bg-transparent text-slate-500"}`}>{x.currency}</button>
              ))}
            </div>
          ) : t ? <span className="text-[12.5px] font-semibold text-slate-500">{t.currency}</span> : null}
        </header>
        {!data ? (
          <div className="grid min-h-28 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : !t ? (
          <p className="m-0 px-4 py-8 text-center text-[13px] text-slate-500">No long-stay payments yet. They appear here once a tenant is asked to pay.</p>
        ) : (
          <>
            <ol className="m-0 grid list-none gap-px bg-slate-100 p-0 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "Waiting for tenants", hint: "Signed, not paid yet", value: t.awaiting, cls: "text-sky-700", Icon: Clock3 },
                { label: "Collected by card", hint: "First month + tenant fee", value: t.collected, cls: "text-slate-900", Icon: CreditCard },
                { label: "Held by NoLSAF", hint: "Until move-in is confirmed", value: t.held, cls: "text-amber-700", Icon: Wallet },
                { label: "Ready to release", hint: "Approve on Tenancies", value: t.toRelease, cls: "text-violet-700", Icon: HandCoins },
                { label: "Paid to landlords", hint: "First month less commission", value: t.releasedToLandlords, cls: "text-emerald-700", Icon: CheckCircle2 },
              ].map((s, i, arr) => (
                <li key={s.label} className="relative bg-white px-4 py-3.5">
                  <p className="m-0 flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500"><s.Icon className="h-3.5 w-3.5" />{s.label}</p>
                  <p className={`m-0 mt-1 text-[19px] font-bold tabular-nums leading-tight ${s.value ? s.cls : "text-slate-300"}`}>{money(s.value, t.currency)}</p>
                  <p className="m-0 mt-0.5 text-[11.5px] text-slate-400">{s.hint}</p>
                  {i < arr.length - 1 ? <span className="absolute right-[-9px] top-1/2 z-[1] hidden h-[18px] w-[18px] -translate-y-1/2 place-items-center rounded-full border border-solid border-slate-200 bg-white text-[11px] text-slate-400 lg:grid" aria-hidden>›</span> : null}
                </li>
              ))}
            </ol>
            <div className="grid gap-px border-0 border-t border-solid border-slate-100 bg-slate-100 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "NoLSAF keeps", hint: "Fees and commission, less card cost", value: t.nolsafKeeps, cls: "text-[#02665e]" },
                { label: "Card fees", hint: "Paid to the card gateway", value: t.cardFees, cls: "text-slate-700" },
                { label: "Refunds owed", hint: "Money to send back to tenants", value: t.refundsDue, cls: "text-rose-700" },
                { label: "Still to come under leases", hint: "Paid to landlords directly, later", value: t.remainingUnderLeases, cls: "text-slate-700" },
              ].map((s) => (
                <div key={s.label} className="flex items-baseline justify-between gap-3 bg-slate-50/70 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-slate-700">{s.label}</span>
                    <span className="block text-[11px] text-slate-400">{s.hint}</span>
                  </span>
                  <span className={`text-[15px] font-bold tabular-nums ${s.value ? s.cls : "text-slate-300"}`}>{money(s.value, t.currency)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Filters: only the ones with something in them, plus search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
          {filters.map((tab) => {
            const on = view === tab.key;
            const count = data?.counts[tab.key] ?? 0;
            const danger = tab.key === "risk" || tab.key === "refunds";
            return (
              <button key={tab.key} type="button" role="tab" aria-selected={on} onClick={() => setView(tab.key)}
                className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-solid px-3 text-[12.5px] font-semibold [font-family:inherit] ${on ? "border-[#02665e] bg-[#02665e] text-white" : danger && count ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                <tab.Icon className="h-3.5 w-3.5" />{tab.label}
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <label className="relative ml-auto block w-full max-w-xs">
          <span className="sr-only">Search payments</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Home, tenant, landlord, reference"
            className="h-9 w-full rounded-md border border-solid border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#02665e]" />
        </label>
      </div>
      {error ? <p className="m-0 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p> : null}

      {/* Ledger: one card per payment, read left to right */}
      {data === null ? null : data.items.length === 0 ? (
        <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-12 text-center">
          <CreditCard className="mx-auto h-7 w-7 text-slate-300" />
          <p className="m-0 mt-2 text-sm font-semibold text-slate-700">{query ? "No payment matches your search" : "Nothing here"}</p>
          <p className="m-0 mt-0.5 text-[13px] text-slate-500">Payments appear once a lease is signed and the tenant is asked to pay.</p>
        </div>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {data.items.map((r) => <PaymentCard key={r.ref} row={r} onOpen={() => setOpen(r)} />)}
        </ul>
      )}

      {open ? <PaymentDrawer row={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** A payment's journey as four steps: owed, paid, held, paid out (or refunded). */
function PaymentCard({ row: r, onOpen }: { row: Row; onOpen: () => void }) {
  const c = r.currency;
  const paid = !["AWAITING", "OVERDUE", "LAPSED"].includes(r.stage);
  const refund = r.stage === "REFUND_DUE" || r.stage === "REFUNDED";
  const steps = [
    { label: "Owed", value: money(r.booking.expected, c), sub: r.booking.dueAt && !paid ? `Due ${when(r.booking.dueAt)}` : `${r.term.months} months`, done: true },
    { label: "Paid by card", value: paid ? money(r.booking.paid, c) : "Not yet", sub: paid ? (r.booking.paidAt ? when(r.booking.paidAt) : "Paid") : r.stage === "OVERDUE" ? "Late" : "Waiting", done: paid, bad: r.stage === "OVERDUE" },
    { label: refund ? "Refund" : "Held by NoLSAF", value: refund ? money(r.split.refund?.amount ?? r.booking.paid, c) : paid ? money(r.booking.firstMonth, c) : "-", sub: refund ? (r.stage === "REFUNDED" ? "Refunded" : "Owed to tenant") : paid ? "First month" : "", done: paid && !refund, bad: r.stage === "REFUND_DUE" },
    { label: "Landlord payout", value: money(r.split.landlordPayout, c), sub: r.split.payoutReleasedAt ? `Sent ${day(r.split.payoutReleasedAt)}` : r.stage === "TO_RELEASE" ? "Ready to approve" : "After move-in", done: r.stage === "RELEASED" },
  ];
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="grid w-full cursor-pointer gap-3 rounded-lg border border-solid border-slate-200 bg-white p-3.5 text-left hover:border-slate-300 hover:shadow-sm [font-family:inherit] lg:grid-cols-[minmax(0,230px)_minmax(0,1fr)_minmax(0,190px)] lg:items-center">
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-bold text-slate-900">{soften(r.home) || "Long-stay home"}</span>
          <span className="block truncate text-[12px] text-slate-500">{soften(r.tenant.name) || "Tenant"} · moves in {day(r.term.moveIn)}</span>
          <span className={`mt-1.5 inline-block rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${STAGE[r.stage].cls}`}>{STAGE[r.stage].label}</span>
        </span>
        <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.label} className={`min-w-0 rounded-md px-2.5 py-2 ${s.bad ? "bg-rose-50" : s.done ? "bg-emerald-50/70" : "bg-slate-50"}`}>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <span className={`grid h-4 w-4 flex-none place-items-center rounded-full text-[9px] font-bold ${s.bad ? "bg-rose-500 text-white" : s.done ? "bg-[#02665e] text-white" : "bg-slate-200 text-slate-500"}`}>{i + 1}</span>
                <span className="truncate">{s.label}</span>
              </span>
              <span className={`mt-1 block truncate text-[13px] font-bold tabular-nums ${s.bad ? "text-rose-700" : s.done ? "text-slate-900" : "text-slate-400"}`}>{s.value}</span>
              <span className="block truncate text-[11px] text-slate-500">{s.sub}</span>
            </li>
          ))}
        </ol>
        <span className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
          <span className="text-right">
            <span className="block text-[11px] text-slate-500">Balance at move-in</span>
            <span className="block text-[13px] font-semibold tabular-nums text-slate-900">{money(r.balance.expected, c)}</span>
            <span className={`block text-[11px] ${BALANCE[r.balance.state].cls}`}>{BALANCE[r.balance.state].label}</span>
          </span>
          <RiskBadge risk={r.risk} />
        </span>
      </button>
    </li>
  );
}

function RiskBadge({ risk }: { risk: Row["risk"] }) {
  const cls = risk.level === "HIGH" ? "bg-rose-50 text-rose-700 ring-rose-200" : risk.level === "MEDIUM" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return (
    <div>
      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-semibold ring-1 ring-inset ${cls}`}>
        <Gauge className="h-3.5 w-3.5" />{risk.level === "LOW" ? "Low" : risk.level === "HIGH" ? "High" : "Medium"}
      </span>
      {risk.flags[0] ? <p className="m-0 mt-1 max-w-[200px] truncate text-[11.5px] text-slate-500" title={risk.flags.map((f) => f.text).join(" · ")}>{risk.flags[0].text}{risk.flags.length > 1 ? ` +${risk.flags.length - 1}` : ""}</p> : null}
    </div>
  );
}

type Events = { reference: string | null; gateway: Array<{ eventId: string; status: string; rawStatus: string | null; amount: number; currency: string; channel: string | null; at: string }>; money: Array<{ type: string; actor: string; toStatus: string | null; at: string; amount: number | null; note: string | null }> };

function PaymentDrawer({ row: r, onClose }: { row: Row; onClose: () => void }) {
  const [events, setEvents] = useState<Events | null>(null);
  const [eventsError, setEventsError] = useState(false);
  useEffect(() => {
    let active = true;
    apiClient.get<Events>(`/api/admin/long-stay/payments/${encodeURIComponent(r.ref)}/events`)
      .then((res) => { if (active) setEvents(res.data); })
      .catch(() => { if (active) setEventsError(true); });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { active = false; window.removeEventListener("keydown", onKey); };
  }, [r.ref, onClose]);

  const c = r.currency;
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={onClose} role="dialog" aria-modal="true" aria-label="Payment details">
      <aside className="flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start gap-3 border-0 border-b border-solid border-slate-200 bg-[#0b2420] px-5 py-4 text-white">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[11.5px] font-semibold text-emerald-100/70">Long-stay payment</p>
            <h2 className="m-0 mt-0.5 truncate text-[18px] font-bold">{soften(r.home) || "Long-stay home"}</h2>
            <p className="m-0 mt-0.5 text-[12.5px] text-white/70">{r.area ? `${r.area} · ` : ""}{money(r.term.monthlyRent, c)} a month · {r.term.months} months</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={`rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${STAGE[r.stage].cls}`}>{STAGE[r.stage].label}</span>
              <RiskInline level={r.risk.level} />
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-md border border-solid border-white/20 bg-white/5 text-white hover:bg-white/15"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* Risk */}
          {r.risk.flags.length ? (
            <section className={`rounded-lg border border-solid p-3.5 ${r.risk.level === "HIGH" ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60"}`}>
              <p className="m-0 flex items-center gap-1.5 text-[13px] font-bold text-slate-900"><ShieldAlert className="h-4 w-4" />Risk assessment · score {r.risk.score}/100</p>
              <ul className="m-0 mt-2 list-none space-y-1 p-0">
                {r.risk.flags.map((f) => (
                  <li key={f.code} className={`flex items-start gap-1.5 text-[12.5px] ${f.level === "HIGH" ? "font-semibold text-rose-800" : "text-amber-900"}`}>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />{f.text}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="m-0 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800"><CheckCircle2 className="h-4 w-4" />No risk signs on this payment.</p>
          )}

          {/* Card payment */}
          <Block icon={<CreditCard className="h-4 w-4" />} title="Card payment to NoLSAF">
            <Line label="Owed (first month + tenant fee)" value={money(r.booking.expected, c)} />
            <Line label="Paid" value={money(r.booking.paid, c)} strong warn={r.booking.paid != null && r.booking.expected != null && r.booking.paid !== r.booking.expected} />
            <Line label="Paid on" value={r.booking.paidAt ? when(r.booking.paidAt) : r.booking.dueAt ? `Not yet, due ${when(r.booking.dueAt)}` : "Not paid"} />
            <Line label="Paid via" value={r.booking.gateway || "-"} />
            <Line label="Payment reference" value={r.booking.reference || "-"} mono />
          </Block>

          {/* Where the money went */}
          <Block icon={<Wallet className="h-4 w-4" />} title="Where the money went">
            <Line label="First month" value={money(r.booking.firstMonth, c)} />
            <Line label="Tenant fee (NoLSAF)" value={money(r.split.tenantFee, c)} sub />
            <Line label="Landlord commission (NoLSAF)" value={`- ${money(r.split.landlordCommission, c)}`} sub />
            {r.split.payoutDeduction ? <Line label="Recovered for claims" value={`- ${money(r.split.payoutDeduction, c)}`} sub /> : null}
            <Line label="Landlord payout" value={money(r.split.landlordPayout, c)} strong />
            <Line label="Payout status" value={r.split.payoutReleasedAt ? `Sent ${when(r.split.payoutReleasedAt)}` : STAGE[r.stage].label} />
            <div className="my-1 border-0 border-t border-dashed border-slate-200" />
            <Line label={`Card fee (about ${r.split.cardFeePercent}%)`} value={`- ${money(r.split.cardFee, c)}`} sub />
            <Line label="NoLSAF keeps" value={money(r.split.nolsafKeeps, c)} brand />
            {r.split.refund ? <Line label={r.split.refund.done ? "Refunded to the tenant" : "Refund owed to the tenant"} value={money(r.split.refund.amount, c)} warn={!r.split.refund.done} /> : null}
          </Block>

          {/* Balance at move-in */}
          <Block icon={<Landmark className="h-4 w-4" />} title="Balance paid to the landlord at move-in">
            <Line label="Lease balance" value={money(r.balance.expected, c)} />
            <Line label="Landlord says received" value={r.balance.landlord ? `${money(r.balance.landlord.amount, c)} · ${methodLabel(r.balance.landlord.method)}` : "Not confirmed"} warn={r.balance.state === "MISMATCH" && r.balance.landlord?.amount !== r.balance.expected} />
            {r.balance.landlord?.at ? <Line label="" value={when(r.balance.landlord.at)} sub /> : null}
            <Line label="Tenant says paid" value={r.balance.tenant ? `${money(r.balance.tenant.amount, c)} · ${methodLabel(r.balance.tenant.method)}` : "Not confirmed"} warn={r.balance.state === "MISMATCH" && r.balance.tenant?.amount !== r.balance.expected} />
            {r.balance.tenant?.at ? <Line label="" value={when(r.balance.tenant.at)} sub /> : null}
            <p className={`m-0 mt-1 text-[12.5px] ${BALANCE[r.balance.state].cls}`}>{BALANCE[r.balance.state].label}</p>
          </Block>

          {/* Lease totals and what remains */}
          <Block icon={<HandCoins className="h-4 w-4" />} title="The whole lease">
            <Line label={`Rent for the lease (${r.term.months} months)`} value={money(r.totals.leaseRent, c)} />
            <Line label="Through NoLSAF (first month)" value={money(r.booking.firstMonth, c)} sub />
            <Line label={`To the landlord at move-in (${Math.max(0, r.term.prepaidMonths - 1)} months)`} value={money(r.balance.expected, c)} sub />
            <Line label={`Still to pay (${r.remaining.months} months)`} value={r.remaining.months ? money(r.remaining.amount, c) : "Nothing, fully prepaid"} strong />
            {r.remaining.months ? <p className="m-0 mt-1 text-[12px] text-slate-500">From {day(r.remaining.firstDueOn)}: {r.remaining.paidTo}.</p> : null}
          </Block>

          {/* History */}
          <Block icon={<Clock3 className="h-4 w-4" />} title="Payment history">
            {eventsError ? (
              <p className="m-0 text-[12.5px] text-rose-700">Could not load the history.</p>
            ) : events === null ? (
              <p className="m-0 flex items-center gap-2 text-[12.5px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading</p>
            ) : (
              <>
                <p className="m-0 mb-1.5 text-[11.5px] font-semibold text-slate-500">Card gateway</p>
                {events.gateway.length === 0 ? <p className="m-0 text-[12.5px] text-slate-500">No card attempts recorded.</p> : (
                  <ul className="m-0 list-none space-y-1.5 p-0">
                    {events.gateway.map((e, i) => (
                      <li key={`${e.eventId}-${i}`} className="flex items-center gap-2 text-[12.5px]">
                        <span className={`inline-block w-16 flex-none rounded px-1.5 py-px text-center text-[11px] font-semibold ${e.status === "SUCCESS" ? "bg-emerald-50 text-emerald-800" : e.status === "FAILED" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{e.status.toLowerCase()}</span>
                        <span className="tabular-nums text-slate-800">{money(e.amount, e.currency)}</span>
                        <span className="font-mono text-[11px] text-slate-400">{e.eventId}</span>
                        <span className="ml-auto text-[11.5px] text-slate-500">{when(e.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="m-0 mb-1.5 mt-3 text-[11.5px] font-semibold text-slate-500">Tenancy money events</p>
                {events.money.length === 0 ? <p className="m-0 text-[12.5px] text-slate-500">None yet.</p> : (
                  <ol className="m-0 list-none space-y-1.5 p-0">
                    {events.money.map((e, i) => {
                      const label = EVENT_LABEL[e.type] ?? (e.toStatus && EVENT_LABEL[e.toStatus]) ?? e.type.replace(/_/g, " ").toLowerCase();
                      const isMoney = Boolean(EVENT_LABEL[e.type] || (e.toStatus && EVENT_LABEL[e.toStatus]) || e.amount != null);
                      return (
                        <li key={`${e.at}-${i}`} className={`flex items-start gap-2 text-[12.5px] ${isMoney ? "" : "opacity-60"}`}>
                          <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${isMoney ? "bg-[#02665e]" : "bg-slate-300"}`} />
                          <span className="min-w-0 flex-1">
                            <span className="text-slate-800 first-letter:uppercase">{label}</span>
                            {e.amount != null ? <span className="ml-1 font-semibold tabular-nums">{money(Number(e.amount), c)}</span> : null}
                            <span className="text-slate-400"> · {e.actor === "SYSTEM" ? "NoLSAF system" : e.actor.toLowerCase()}</span>
                            {e.note ? <span className="block text-[11.5px] text-slate-500">{e.note}</span> : null}
                          </span>
                          <span className="flex-none text-[11.5px] text-slate-500">{when(e.at)}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </>
            )}
          </Block>

          {/* People */}
          <Block icon={<ArrowUpRight className="h-4 w-4" />} title="People">
            <Line label="Tenant" value={`${soften(r.tenant.name) || "-"}${r.tenant.phone ? ` · ${r.tenant.phone}` : ""}`} />
            <Line label="Landlord" value={`${soften(r.landlord.name) || "-"}${r.landlord.phone ? ` · ${r.landlord.phone}` : ""}`} />
          </Block>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-slate-200 px-5 py-3">
          <span className="font-mono text-[11px] text-slate-400">{r.ref}</span>
          <Link href={`/admin/long-stay/tenancies?view=all&ref=${encodeURIComponent(r.ref)}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline hover:bg-[#014e47]">
            Open the tenancy<ArrowUpRight className="h-4 w-4" />
          </Link>
        </footer>
      </aside>
    </div>
  );
}

function RiskInline({ level }: { level: Row["risk"]["level"] }) {
  const cls = level === "HIGH" ? "bg-rose-100 text-rose-800" : level === "MEDIUM" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800";
  return <span className={`rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${cls}`}>{level === "LOW" ? "Low risk" : level === "HIGH" ? "High risk" : "Medium risk"}</span>;
}

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-solid border-slate-200 p-3.5">
      <p className="m-0 mb-2.5 flex items-center gap-1.5 text-[13px] font-bold text-slate-900"><span className="text-[#02665e]">{icon}</span>{title}</p>
      <dl className="m-0 space-y-1.5">{children}</dl>
    </section>
  );
}

function Line({ label, value, strong, brand, warn, sub, mono }: { label: string; value: string; strong?: boolean; brand?: boolean; warn?: boolean; sub?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <dt className={sub ? "pl-3 text-[12px] text-slate-500" : "text-slate-600"}>{label}</dt>
      <dd className={`m-0 text-right tabular-nums ${mono ? "font-mono text-[11.5px] text-slate-600" : warn ? "font-semibold text-rose-700" : strong ? "font-bold text-slate-900" : brand ? "font-bold text-[#02665e]" : sub ? "text-[12px] text-slate-500" : "text-slate-800"}`}>{value}</dd>
    </div>
  );
}
