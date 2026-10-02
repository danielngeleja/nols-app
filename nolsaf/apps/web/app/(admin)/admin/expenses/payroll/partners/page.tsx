"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BadgePercent, ChevronLeft, ChevronRight, Handshake, Info } from "lucide-react";
import { LockedCard, compactTzs, eatTodayIso, monthLabel, tzs, useFinanceData } from "../../_shared";
import { CommandCanvas, eyebrow, ghostButton, panel } from "@/components/admin/commandUi";

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
  const maxEarned = Math.max(1, ...items.map((pp) => pp.earned));
  const status: Record<string, string> = {
    ACTIVE: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
    PENDING: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
    SUSPENDED: "bg-rose-400/10 text-rose-300 ring-rose-400/25",
    TERMINATED: "bg-white/[0.04] text-slate-400 ring-white/10",
  };
  const amount = (v: number, tone = "text-white") => (v ? <span className={`font-semibold tabular-nums ${tone}`}>{tzs(v)}</span> : <span className="text-slate-600">None</span>);

  return (
    <div className="w-full min-w-0">
    <CommandCanvas>
      {/* Command bar */}
      <div className="flex flex-wrap items-center gap-3 px-1 pt-1">
        <div className="mr-auto min-w-0">
          <p className={eyebrow}><Handshake className="h-3.5 w-3.5" /> Commissioned · Sales partners</p>
          <p className="m-0 mt-1 max-w-2xl text-sm text-slate-400">The people who sell NoLSAF on commission. Paid per sale through Sales payouts, never through a pay run.</p>
        </div>
        <div className="inline-flex items-center rounded-md border border-solid border-[#284540] bg-[#182c28] p-0.5">
          <button type="button" onClick={() => setMonth((mm) => shiftMonth(mm, -1))} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded border-0 bg-transparent text-slate-400 hover:bg-white/[0.05] hover:text-white"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[7.5rem] text-center text-xs font-semibold text-slate-100">{monthLabel(month)}</span>
          <button type="button" onClick={() => setMonth((mm) => shiftMonth(mm, 1))} disabled={month >= thisMonth} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded border-0 bg-transparent text-slate-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <Link href="/admin/sales/finance" className={ghostButton}>Sales payouts <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        <Link href="/admin/sales/partners" className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-emerald-400 px-3.5 text-xs font-semibold text-[#06201b] no-underline hover:bg-emerald-300 hover:no-underline">Manage partners <ArrowUpRight className="h-3.5 w-3.5" /></Link>
      </div>

      {/* Totals */}
      <section className={`${panel} overflow-hidden`}>
        <dl className="m-0 grid grid-cols-2 gap-px bg-[#284540] lg:grid-cols-4">
          {[
            { label: "Active partners", value: t ? String(t.active) : "...", detail: t ? `${t.partners} on record` : "", color: "#34d399" },
            { label: "Commission earned", value: t ? tzs(t.earned) : "...", detail: "a cost of earning revenue", color: "#f87171" },
            { label: "Paid out", value: t ? tzs(t.paid) : "...", detail: t && t.withheld ? `after ${compactTzs(t.withheld)} withholding tax` : "net to partners", color: "#38bdf8" },
            { label: "Owed now", value: t ? tzs(t.owed) : "...", detail: t && t.pending ? `${compactTzs(t.pending)} still validating` : "approved, not paid yet", color: "#fbbf24" },
          ].map((f) => (
            <div key={f.label} className="min-w-0 bg-[#182c28] px-5 py-4">
              <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8fb5ad]"><span className="h-2 w-2" style={{ background: f.color }} />{f.label}</dt>
              <dd className="m-0 mt-2 truncate text-xl font-semibold tabular-nums text-white">{f.value}</dd>
              <dd className="m-0 mt-0.5 truncate text-[11px] text-slate-500">{f.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 flex items-start gap-2 border-0 border-t border-solid border-[#284540] px-5 py-3 text-xs leading-relaxed text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
          Commission earned in {monthLabel(month)} is already in the month&apos;s costs as &quot;Sales partner commissions&quot;, so it counts in the margin and the revenue coverage once. Partners never appear on a pay run.
        </p>
      </section>

      {/* Partners */}
      <section className={`${panel} overflow-hidden`}>
        <div className="px-5 py-4">
          <p className={eyebrow}>Commission by partner</p>
          <p className="m-0 mt-1 text-xs text-slate-500">Earned and paid in {monthLabel(month)}. Owed and validating are their balances today.</p>
        </div>
        {error ? (
          <p className="m-0 border-0 border-t border-solid border-[#284540] px-5 py-8 text-center text-sm text-rose-300">{error}</p>
        ) : !items.length ? (
          <div className="grid place-items-center border-0 border-t border-solid border-[#284540] px-5 py-12 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-emerald-400/10 text-emerald-300"><BadgePercent className="h-5 w-5" /></span>
            <p className="m-0 mt-3 text-sm font-semibold text-white">{loading ? "Loading partners..." : "No sales partners yet"}</p>
            <p className="m-0 mt-1 text-xs text-slate-500">Partners are onboarded and contracted under Sales.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-0 border-t border-solid border-[#284540] text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-5 py-3 font-semibold">Partner</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Earned this month</th>
                  <th className="px-3 py-3 text-right font-semibold">Paid out</th>
                  <th className="px-3 py-3 text-right font-semibold">Owed now</th>
                  <th className="px-5 py-3 text-right font-semibold">Validating</th>
                </tr>
              </thead>
              <tbody>
                {items.map((pp) => (
                  <tr key={pp.id} className="border-0 border-t border-solid border-[#284540] transition-colors hover:bg-white/[0.02]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#20403a] text-[11px] font-bold text-emerald-200">{initials(pp.name)}</span>
                        <div className="min-w-0">
                          <p className="m-0 truncate font-semibold text-slate-100">{pp.name}</p>
                          <p className="m-0 truncate text-[11px] text-slate-500">{[pp.agentCode, titleCase(pp.level), pp.region].filter(Boolean).join(" · ")}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${status[pp.status] ?? status.TERMINATED}`}>{titleCase(pp.status)}</span></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <span className="block h-1.5 w-24 shrink-0 bg-[#13241f]"><span className="block h-full bg-rose-400" style={{ width: `${(pp.earned / maxEarned) * 100}%` }} /></span>
                        {amount(pp.earned)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {amount(pp.paid, "text-slate-200")}
                      {pp.withheld ? <span className="block text-[10px] text-slate-500">WHT {tzs(pp.withheld)}</span> : null}
                    </td>
                    <td className="px-3 py-3 text-right">{amount(pp.owed, "text-amber-300")}</td>
                    <td className="px-5 py-3 text-right">{amount(pp.pending, "text-slate-300")}</td>
                  </tr>
                ))}
              </tbody>
              {t ? (
                <tfoot>
                  <tr className="border-0 border-t border-solid border-[#2f524b] bg-[#13241f] text-sm">
                    <td className="px-5 py-3 font-semibold text-white" colSpan={2}>All partners</td>
                    <td className="px-3 py-3 font-semibold tabular-nums text-white">{tzs(t.earned)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-white">{tzs(t.paid)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-amber-300">{tzs(t.owed)}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-300">{tzs(t.pending)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </section>
    </CommandCanvas>
    </div>
  );
}
