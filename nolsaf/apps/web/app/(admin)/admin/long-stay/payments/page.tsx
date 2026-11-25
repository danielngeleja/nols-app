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
type Totals = { currency: string; collected: number; held: number; toRelease: number; releasedToLandlords: number; refundsDue: number; nolsafKeeps: number; cardFees: number; balancesConfirmed: number; remainingUnderLeases: number; awaiting: number; collectedByStage?: { held: number; toRelease: number; settled: number; refund: number } };
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

      {/* Money flow: where every shilling or dollar the tenants paid is right now */}
      <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-5 py-3">
          <div>
            <h2 className="m-0 text-[15px] font-bold text-neutral-900">Money flow</h2>
            <p className="m-0 text-[12px] text-neutral-500">From the tenant&apos;s card, through NoLSAF, to the landlord</p>
          </div>
          {totals.length > 1 ? (
            <div className="inline-flex rounded-md bg-neutral-100 p-0.5" role="tablist" aria-label="Currency">
              {totals.map((x) => (
                <button key={x.currency} type="button" role="tab" aria-selected={t?.currency === x.currency} onClick={() => setCurrency(x.currency)}
                  className={`h-7 cursor-pointer rounded border-0 px-3 text-[12.5px] font-semibold [font-family:inherit] ${t?.currency === x.currency ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500"}`}>{x.currency}</button>
              ))}
            </div>
          ) : t ? <span className="rounded bg-neutral-100 px-2 py-1 text-[12px] font-semibold text-neutral-600">{t.currency}</span> : null}
        </header>
        {!data ? (
          <div className="grid min-h-28 place-items-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : !t ? (
          <p className="m-0 px-5 py-8 text-center text-[13px] text-neutral-500">No long-stay payments yet. They appear here once a tenant is asked to pay.</p>
        ) : (() => {
          const cur = t.currency;
          const collected = t.collected || 0;
          const pct = (v: number) => (collected > 0 ? Math.round((v / collected) * 100) : 0);
          // Where the collected money sits now; the four parts always add up to what was collected.
          const by = t.collectedByStage ?? { held: t.held, toRelease: 0, settled: 0, refund: t.refundsDue };
          const parts = [
            { key: "held", label: "Held until move-in", value: by.held, color: "#f59e0b" },
            { key: "release", label: "Waiting to be released", value: by.toRelease, color: "#8b5cf6" },
            { key: "settled", label: "Settled (landlord paid, NoLSAF share kept)", value: by.settled, color: "#059669" },
            { key: "refund", label: "To refund", value: by.refund, color: "#e11d48" },
          ].filter((p) => p.value > 0);
          const steps = [
            { label: "Waiting for tenants", value: t.awaiting, hint: "Lease signed, card not paid", Icon: Clock3, tone: "sky" },
            { label: "Collected by card", value: t.collected, hint: "First month + tenant fee", Icon: CreditCard, tone: "ink" },
            { label: "Held by NoLSAF", value: t.held, hint: "Until move-in is confirmed", Icon: Wallet, tone: "amber" },
            { label: "Ready to release", value: t.toRelease, hint: "Approve on Tenancies", Icon: HandCoins, tone: "violet" },
            { label: "Paid to landlords", value: t.releasedToLandlords, hint: "First month less commission", Icon: CheckCircle2, tone: "green" },
          ] as const;
          const toneCls: Record<string, { icon: string; num: string }> = {
            sky: { icon: "bg-sky-50 text-sky-700", num: "text-sky-800" },
            ink: { icon: "bg-neutral-100 text-neutral-700", num: "text-neutral-900" },
            amber: { icon: "bg-amber-50 text-amber-700", num: "text-amber-700" },
            violet: { icon: "bg-violet-50 text-violet-700", num: "text-violet-700" },
            green: { icon: "bg-emerald-50 text-emerald-700", num: "text-emerald-700" },
          };
          return (
            <>
              {/* Where the collected money is now */}
              <div className="px-5 pb-1 pt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="m-0 text-[12px] font-semibold text-neutral-600">Where the collected {money(collected, cur)} is now</p>
                  {collected > 0 ? <p className="m-0 text-[11.5px] text-neutral-400">{pct(by.settled)}% settled</p> : null}
                </div>
                <div className="mt-2 flex h-2.5 overflow-hidden rounded bg-neutral-100" aria-hidden>
                  {parts.map((p) => <span key={p.key} style={{ width: `${pct(p.value)}%`, background: p.color }} />)}
                </div>
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[11.5px] text-neutral-600">
                  {parts.length ? parts.map((p) => (
                    <li key={p.key} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.label} <b className="tabular-nums text-neutral-900">{pct(p.value)}%</b></li>
                  )) : <li className="text-neutral-400">Nothing collected yet</li>}
                </ul>
              </div>

              {/* The stages, left to right */}
              <ol className="m-0 grid list-none gap-3 p-5 pt-4 sm:grid-cols-2 lg:grid-cols-5">
                {steps.map((s, i) => {
                  const c = toneCls[s.tone];
                  const empty = !s.value;
                  return (
                    <li key={s.label} className={`relative min-w-0 rounded-md border border-solid p-3.5 ${empty ? "border-neutral-100 bg-neutral-50/60" : "border-neutral-200 bg-white"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`grid h-8 w-8 place-items-center rounded-md ${empty ? "bg-neutral-100 text-neutral-400" : c.icon}`}><s.Icon className="h-4 w-4" /></span>
                        <span className="text-[10.5px] font-semibold tabular-nums text-neutral-400">{i + 1} / 5</span>
                      </div>
                      <p className="m-0 mt-2.5 text-[12px] font-semibold text-neutral-600">{s.label}</p>
                      <p className={`m-0 mt-0.5 whitespace-nowrap text-[18px] font-bold leading-tight tabular-nums ${empty ? "text-neutral-300" : c.num}`}>{money(s.value, cur)}</p>
                      <p className="m-0 mt-1 text-[11px] leading-4 text-neutral-400">{s.hint}</p>
                    </li>
                  );
                })}
              </ol>

              {/* NoLSAF's side and what is still to come */}
              <dl className="m-0 grid border-0 border-t border-solid border-neutral-100 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "NoLSAF keeps", value: t.nolsafKeeps, hint: "Fees and commission, less card cost", cls: "text-[#02665e]" },
                  { label: "Card fees", value: t.cardFees, hint: "Paid to the card gateway", cls: "text-neutral-800" },
                  { label: "Refunds owed", value: t.refundsDue, hint: "To send back to tenants", cls: "text-rose-700" },
                  { label: "Still to come under leases", value: t.remainingUnderLeases, hint: "Paid to landlords directly, later", cls: "text-neutral-800" },
                ].map((m, i) => (
                  <div key={m.label} className={`min-w-0 px-5 py-3 ${i ? "border-0 border-t border-solid border-neutral-100 sm:border-t-0 sm:border-l" : ""}`}>
                    <dt className="text-[12px] font-semibold text-neutral-600">{m.label}</dt>
                    <dd className={`m-0 mt-0.5 whitespace-nowrap text-[16px] font-bold tabular-nums ${m.value ? m.cls : "text-neutral-300"}`}>{money(m.value, cur)}</dd>
                    <p className="m-0 text-[11px] text-neutral-400">{m.hint}</p>
                  </div>
                ))}
              </dl>
            </>
          );
        })()}
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
        <PaymentsTable rows={data.items} onOpen={setOpen} />
      )}

      {open ? <PaymentDrawer row={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

type SortKey = "home" | "paid" | "paidAt" | "payout" | "keeps" | "balance" | "remaining" | "risk";

/** Rows and columns, like Tour Revenue: sortable headers, one tenancy per row, click to open. */
function PaymentsTable({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "paidAt", dir: -1 });
  const value = (r: Row, k: SortKey): number | string => {
    switch (k) {
      case "home": return soften(r.home).toLowerCase();
      case "paid": return r.booking.paid ?? r.booking.expected ?? 0;
      case "paidAt": return r.booking.paidAt || r.booking.dueAt || "";
      case "payout": return r.split.landlordPayout;
      case "keeps": return r.split.nolsafKeeps;
      case "balance": return r.balance.expected;
      case "remaining": return r.remaining.amount;
      case "risk": return r.risk.score;
    }
  };
  const sorted = [...rows].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "home" ? 1 : -1 }));
  const cols: Array<[SortKey | null, string, "left" | "right"]> = [
    ["home", "Tenancy", "left"],
    ["paid", "Card payment", "right"],
    ["paidAt", "Paid", "left"],
    [null, "Stage", "left"],
    ["payout", "Landlord payout", "right"],
    ["keeps", "NoLSAF", "right"],
    ["balance", "Balance at move-in", "right"],
    ["remaining", "Still to pay", "right"],
    ["risk", "Risk", "left"],
  ];
  return (
    <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-0 border-b border-solid border-neutral-100 bg-neutral-50/60">
              {cols.map(([key, label, align]) => (
                <th key={label} className={`px-3 py-2.5 first:pl-5 ${align === "right" ? "text-right" : ""}`}>
                  {key ? (
                    <button type="button" onClick={() => onSort(key)} className={`inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-wide [font-family:inherit] ${sort.key === key ? "text-neutral-800" : "text-neutral-400 hover:text-neutral-700"}`}>
                      {label}<span aria-hidden>{sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
                    </button>
                  ) : <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{label}</span>}
                </th>
              ))}
              <th className="px-3 py-2.5 pr-5"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const c = r.currency;
              const paid = !["AWAITING", "OVERDUE", "LAPSED"].includes(r.stage);
              return (
                <tr key={r.ref} onClick={() => onOpen(r)} className="cursor-pointer border-0 border-b border-solid border-neutral-100 transition last:border-b-0 hover:bg-emerald-50/40">
                  <td className="px-3 py-3 pl-5">
                    <div className="max-w-[220px] truncate font-semibold text-neutral-900">{soften(r.home) || "Long-stay home"}</div>
                    <div className="max-w-[220px] truncate text-[11px] text-neutral-500">{soften(r.tenant.name) || "Tenant"} · {r.term.months} mo · in {day(r.term.moveIn)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    <div className={`font-semibold ${paid ? "text-neutral-900" : "text-neutral-400"}`}>{money(r.booking.paid ?? r.booking.expected, c)}</div>
                    <div className="text-[10.5px] text-neutral-400">fee {money(r.split.tenantFee, c)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {paid ? (
                      <>
                        <div className="text-neutral-800">{r.booking.paidAt ? when(r.booking.paidAt).replace(/ \d{4},/, ",") : "Paid"}</div>
                        <div className="text-[10.5px] text-neutral-400">{r.booking.gateway || "Card"}</div>
                      </>
                    ) : (
                      <div className={r.stage === "OVERDUE" ? "font-semibold text-rose-700" : "text-sky-700"}>{r.booking.dueAt ? `Due ${when(r.booking.dueAt).replace(/ \d{4},/, ",")}` : "Not paid"}</div>
                    )}
                  </td>
                  <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded px-2 py-0.5 text-[10.5px] font-bold ${STAGE[r.stage].cls}`}>{STAGE[r.stage].label}</span></td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    <div className={`font-semibold ${r.stage === "RELEASED" ? "text-emerald-700" : "text-neutral-900"}`}>{money(r.split.landlordPayout, c)}</div>
                    <div className="text-[10.5px] text-neutral-400">{r.split.payoutReleasedAt ? `sent ${day(r.split.payoutReleasedAt)}` : `less ${money(r.split.landlordCommission, c)}`}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    <div className="font-semibold text-violet-700">{money(r.split.nolsafKeeps, c)}</div>
                    <div className="text-[10.5px] text-neutral-400">card {money(r.split.cardFee, c)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    <div className="text-neutral-900">{money(r.balance.expected, c)}</div>
                    <div className={`text-[10.5px] ${BALANCE[r.balance.state].cls}`}>{BALANCE[r.balance.state].label}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    <div className={r.remaining.months ? "text-neutral-900" : "text-neutral-400"}>{r.remaining.months ? money(r.remaining.amount, c) : "Nothing"}</div>
                    <div className="text-[10.5px] text-neutral-400">{r.remaining.months ? `${r.remaining.months} mo from ${day(r.remaining.firstDueOn)}` : "Fully prepaid"}</div>
                  </td>
                  <td className="px-3 py-3"><RiskBadge risk={r.risk} /></td>
                  <td className="px-3 py-3 pr-5 text-right">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition hover:bg-emerald-50 hover:text-emerald-700" aria-hidden><ArrowUpRight className="h-4 w-4" /></span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 border-0 border-t border-solid border-neutral-100 px-5 py-2.5 text-[11px] text-neutral-500">{rows.length} {rows.length === 1 ? "payment" : "payments"} · click a row for the full breakdown and history</p>
    </section>
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#071b17]/60 p-3 backdrop-blur-[2px] sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="Payment details">
      <div className="flex max-h-[min(92dvh,56rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="relative overflow-hidden bg-[#0b2420] px-5 py-4 text-white sm:px-6">
          <div className="pointer-events-none absolute inset-0 opacity-[0.3]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "18px 18px" }} aria-hidden />
          <div className="relative flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">Long-stay payment</p>
              <h2 className="m-0 mt-1 truncate text-[20px] font-bold tracking-tight">{soften(r.home) || "Long-stay home"}</h2>
              <p className="m-0 mt-0.5 text-[12.5px] text-white/65">{r.area ? `${soften(r.area)} · ` : ""}{money(r.term.monthlyRent, c)} a month · {r.term.months} months · {soften(r.tenant.name) || "Tenant"}</p>
            </div>
            <div className="flex flex-none items-center gap-1.5">
              <span className={`rounded-md px-2 py-1 text-[11.5px] font-semibold ${STAGE[r.stage].cls}`}>{STAGE[r.stage].label}</span>
              <RiskInline level={r.risk.level} />
              <button type="button" onClick={onClose} aria-label="Close" className="ml-1 grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-solid border-white/20 bg-white/5 text-white hover:bg-white/15"><X className="h-4 w-4" /></button>
            </div>
          </div>
          {/* The four numbers that matter, at a glance */}
          <dl className="relative m-0 mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Tenant paid", value: money(r.booking.paid, c), sub: r.booking.paidAt ? when(r.booking.paidAt) : "Not paid yet" },
              { label: "Landlord payout", value: money(r.split.landlordPayout, c), sub: r.split.payoutReleasedAt ? `Sent ${day(r.split.payoutReleasedAt)}` : STAGE[r.stage].label },
              { label: "NoLSAF keeps", value: money(r.split.nolsafKeeps, c), sub: "After the card fee", brand: true },
              { label: "Still to pay", value: r.remaining.months ? money(r.remaining.amount, c) : "Nothing", sub: r.remaining.months ? `${r.remaining.months} months, to the landlord` : "Fully prepaid" },
            ].map((m) => (
              <div key={m.label} className="min-w-0 rounded-md bg-white/[0.05] px-3 py-2.5 ring-1 ring-inset ring-white/10">
                <dt className="truncate text-[11px] font-semibold text-white/55">{m.label}</dt>
                <dd className={`m-0 mt-0.5 truncate text-[17px] font-bold tabular-nums ${m.brand ? "text-emerald-300" : "text-white"}`}>{m.value}</dd>
                <p className="m-0 truncate text-[11px] text-white/40">{m.sub}</p>
              </div>
            ))}
          </dl>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
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

          </div>
          <div className="min-w-0 space-y-4">
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

          {/* People */}
          <Block icon={<ArrowUpRight className="h-4 w-4" />} title="People">
            <Line label="Tenant" value={`${soften(r.tenant.name) || "-"}${r.tenant.phone ? ` · ${r.tenant.phone}` : ""}`} />
            <Line label="Landlord" value={`${soften(r.landlord.name) || "-"}${r.landlord.phone ? ` · ${r.landlord.phone}` : ""}`} />
          </Block>
          </div>
          </div>

          <div className="mt-4">
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
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-slate-200 bg-white px-5 py-3">
          <span className="font-mono text-[11px] text-slate-400">{r.ref}</span>
          <Link href={`/admin/long-stay/tenancies?view=all&ref=${encodeURIComponent(r.ref)}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline hover:bg-[#014e47]">
            Open the tenancy<ArrowUpRight className="h-4 w-4" />
          </Link>
        </footer>
      </div>
    </div>
  );
}

function RiskInline({ level }: { level: Row["risk"]["level"] }) {
  const cls = level === "HIGH" ? "bg-rose-100 text-rose-800" : level === "MEDIUM" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800";
  return <span className={`rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${cls}`}>{level === "LOW" ? "Low risk" : level === "HIGH" ? "High risk" : "Medium risk"}</span>;
}

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-solid border-slate-200 bg-white p-3.5">
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
