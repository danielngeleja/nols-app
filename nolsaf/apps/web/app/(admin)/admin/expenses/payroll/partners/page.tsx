"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BadgePercent, ChevronLeft, ChevronRight, Handshake, Info } from "lucide-react";
import { LockedCard, compactTzs, eatTodayIso, monthLabel, tzs, useFinanceData } from "../../_shared";

/**
 * The commissioned sales team, beside the salaried staff. Read-only: partners
 * earn commission per revenue event and are paid through Sales payouts, never
 * through a pay run. Their earned commission is already a cost of earning
 * revenue in the margin and the coverage, so nothing here adds to the costs.
 */

type Partner = {
  id: number;
  agentCode: string;
  name: string;
  phone: string | null;
  status: string;
  level: string;
  region: string | null;
  payTo: string | null;
  earned: number;
  paid: number;
  withheld: number;
  owed: number;
  pending: number;
};
type Data = {
  periodMonth: string;
  items: Partner[];
  totals: { partners: number; active: number; earned: number; paid: number; withheld: number; owed: number; pending: number };
};

const STATUS: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PENDING: "bg-amber-50 text-amber-700 ring-amber-200",
  SUSPENDED: "bg-rose-50 text-rose-700 ring-rose-200",
  TERMINATED: "bg-neutral-100 text-neutral-500 ring-neutral-200",
};
const titleCase = (v: string) => v.toLowerCase().replace(/_/g, " ").replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function SalesPartnersPage() {
  const thisMonth = eatTodayIso().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { data, loading, error, locked } = useFinanceData<Data>(`/api/admin/finance/payroll/partners?month=${month}`);

  if (locked) return <LockedCard what="Sales partners" />;

  const t = data?.totals;
  const items = data?.items ?? [];
  const facts = [
    { label: "Active partners", value: t ? String(t.active) : "...", detail: t ? `${t.partners} on record` : "" },
    { label: "Commission earned", value: t ? compactTzs(t.earned) : "...", detail: "cost of earning revenue" },
    { label: "Paid out", value: t ? compactTzs(t.paid) : "...", detail: t && t.withheld ? `after ${compactTzs(t.withheld)} withholding tax` : "net to partners" },
    { label: "Owed now", value: t ? compactTzs(t.owed) : "...", detail: t && t.pending ? `${compactTzs(t.pending)} still validating` : "approved, not paid yet" },
  ];

  return (
    <div className="w-full min-w-0 space-y-5">
      <section className="overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-4 px-5 py-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[11px] font-semibold text-[#02665e]"><Handshake className="h-3.5 w-3.5" /> Sales team</span>
            <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight text-neutral-900">Sales partners</h1>
            <p className="m-0 mt-1 max-w-xl text-sm text-neutral-500">The people who sell NoLSAF on commission. They work beside the staff but are paid per sale through Sales payouts, not through pay runs.</p>
          </div>
          <div className="inline-flex items-center rounded-full border border-solid border-neutral-200 bg-white p-0.5">
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-full border-0 bg-transparent text-neutral-500 hover:bg-neutral-100"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[8.5rem] text-center text-xs font-bold text-neutral-900">{monthLabel(month)}</span>
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-full border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 lg:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0 bg-white px-5 py-3.5 sm:px-6">
              <dt className="text-[11px] font-semibold text-neutral-400">{f.label}</dt>
              <dd className="m-0 mt-1 truncate text-lg font-bold tabular-nums text-neutral-900">{f.value}</dd>
              <dd className="m-0 truncate text-[11px] text-neutral-500">{f.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex items-start gap-3 rounded-2xl border border-solid border-sky-200 bg-sky-50/70 px-4 py-3 text-xs leading-relaxed text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <p className="m-0">
          Commission earned in {monthLabel(month)} is already counted in the month&apos;s costs as &quot;Sales partner commissions&quot;, so it shows in the margin and the revenue coverage. Nothing here is added again, and partners never appear on a pay run.
        </p>
      </div>

      <section className="overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div>
            <p className="m-0 text-sm font-bold text-neutral-900">Commission by partner</p>
            <p className="m-0 mt-0.5 text-xs text-neutral-500">Earned and paid in {monthLabel(month)}. Owed and validating are their balances today.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/sales/finance" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-solid border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-700 no-underline hover:bg-neutral-50 hover:no-underline">Sales payouts <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            <Link href="/admin/sales/partners" className="inline-flex h-9 items-center gap-1.5 rounded-full border-0 bg-[#0b2420] px-3.5 text-xs font-bold text-white no-underline hover:bg-[#12342f] hover:no-underline">Manage partners <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
        </div>

        {error ? (
          <p className="m-0 border-0 border-t border-solid border-neutral-100 px-6 py-8 text-center text-sm text-rose-700">{error}</p>
        ) : !items.length ? (
          <div className="grid place-items-center border-0 border-t border-solid border-neutral-100 px-6 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#02665e]/10 text-[#02665e]"><BadgePercent className="h-6 w-6" /></span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-900">{loading ? "Loading partners..." : "No sales partners yet"}</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">Partners are onboarded and contracted under Sales.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border-0 border-t border-solid border-neutral-100">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold text-neutral-400">
                  <th className="px-5 py-2.5 font-semibold sm:px-6">Partner</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Earned</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Paid out</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Owed now</th>
                  <th className="px-5 py-2.5 text-right font-semibold sm:px-6">Validating</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-0 border-t border-solid border-neutral-100 hover:bg-neutral-50/70">
                    <td className="px-5 py-3 sm:px-6">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#02665e]/10 text-xs font-bold text-[#02665e]">{initials(p.name)}</span>
                        <div className="min-w-0">
                          <p className="m-0 truncate font-semibold text-neutral-900">{p.name}</p>
                          <p className="m-0 truncate text-[11px] text-neutral-500">{[p.agentCode, titleCase(p.level), p.region].filter(Boolean).join(", ")}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS[p.status] ?? STATUS.TERMINATED}`}>{titleCase(p.status)}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-neutral-900">{p.earned ? tzs(p.earned) : <span className="text-neutral-300">0</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-700">
                      {p.paid ? tzs(p.paid) : <span className="text-neutral-300">0</span>}
                      {p.withheld ? <span className="block text-[10px] text-neutral-400">WHT {tzs(p.withheld)}</span> : null}
                    </td>
                    <td className={`px-3 py-3 text-right font-semibold tabular-nums ${p.owed > 0 ? "text-amber-700" : "text-neutral-300"}`}>{p.owed ? tzs(p.owed) : "0"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-500 sm:px-6">{p.pending ? tzs(p.pending) : <span className="text-neutral-300">0</span>}</td>
                  </tr>
                ))}
              </tbody>
              {t ? (
                <tfoot>
                  <tr className="border-0 border-t border-solid border-neutral-200 bg-neutral-50 text-sm font-bold text-neutral-900">
                    <td className="px-5 py-3 sm:px-6" colSpan={2}>All partners</td>
                    <td className="px-3 py-3 text-right tabular-nums">{tzs(t.earned)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{tzs(t.paid)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{tzs(t.owed)}</td>
                    <td className="px-5 py-3 text-right tabular-nums sm:px-6">{tzs(t.pending)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
