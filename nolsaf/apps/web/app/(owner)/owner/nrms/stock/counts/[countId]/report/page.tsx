"use client";

// The variance report for one approved count (docs/NRMS_STOCK_AND_PURCHASING.md
// section 7.4): per good, where the stock should be and where it went, in the
// plain sentence an owner reads first.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRightLeft, Download, Loader2, TrendingDown, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../../../../_components/NrmsProvider";
import { STOCK_CATEGORY_LABELS, apiError, categoryTone, formatMoney, formatStockQuantity } from "../../../../_components/stockFormat";
import { Pill, SectionCard, cardClass, quietButton } from "../../../items/_components/ui";
import { formatDay, formatWhen } from "../../../operations/_components/shared";

type Breakdown = { opening: number; received: number; transferredIn: number; transferredOut: number; sold: number; writtenOff: number; expected: number };
type Row = {
  stockItemId: number;
  name: string;
  category: string;
  baseUnit: string;
  since: string | null;
  previousCount: string | null;
  breakdown: Breakdown;
  expected: number;
  counted: number;
  variance: number;
  stockFell: number;
  breakdownMatches: boolean;
  varianceCost: number | null;
  varianceSales: number | null;
  tolerancePercent: number;
  withinTolerance: boolean;
  note: string | null;
  trend: Array<{ countNumber: string; at: string; variance: number; varianceCost: number | null }>;
};
type Report = {
  count: { id: number; countNumber: string; status: string; locationName: string; blind: boolean; scope: string; approvedAt: string | null; decisionNote: string | null };
  window: { from: string; to: string };
  showMoney: boolean;
  totals: { varianceCost: number | null; varianceSales: number | null; outsideTolerance: number; lines: number };
  rows: Row[];
  staff: Array<{ name: string; shifts: number; from: string; to: string | null }>;
  shortTransfers: Array<{ transferNumber: string; from: string; to: string; name: string; baseUnit: string; sent: number; received: number }>;
};

export default function CountReportPage() {
  const params = useParams<{ countId: string }>();
  const { selectedProperty } = useNrms();
  const currency = selectedProperty?.currency ?? "TZS";
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<Report>(`/api/nrms/stock/counts/${params.countId}/report`).then((res) => setReport(res.data)).catch((cause) => setError(apiError(cause, "Unable to load the report")));
  }, [params.countId]);

  if (!report) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-300">{error ? <p className="text-sm text-red-700">{error}</p> : <Loader2 className="h-6 w-6 animate-spin" />}</div>;

  const qty = (value: number, unit: string) => formatStockQuantity(value, unit);
  const exportCsv = () => {
    const header = ["Good", "Category", "Since", "Opening", "Received", "Transferred in", "Transferred out", "Sold", "Written off", "Expected", "Counted", "Variance", "Stock fell by", "Unit", "At cost", "At selling price", "Within normal loss"];
    const lines = report.rows.map((row) => [row.name, STOCK_CATEGORY_LABELS[row.category] ?? row.category, row.since ? formatDay(row.since) : "Start", row.breakdown.opening, row.breakdown.received, row.breakdown.transferredIn, row.breakdown.transferredOut, row.breakdown.sold, row.breakdown.writtenOff, row.expected, row.counted, row.variance, row.stockFell, row.baseUnit, row.varianceCost ?? "", row.varianceSales ?? "", row.withinTolerance ? "Yes" : "No"]);
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.count.countNumber}-variance.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <Link href={`/owner/nrms/stock/counts/${report.count.id}`} className="inline-flex items-center gap-1.5 text-sm font-bold text-neutral-600 no-underline hover:text-brand"><ArrowLeft className="h-4 w-4" />Back to the count</Link>

      <section className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700"><TrendingDown className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h1 className="m-0 text-2xl font-bold tracking-tight text-neutral-950">Variance report · {report.count.locationName}</h1>
              <p className="m-0 mt-1 text-sm text-neutral-500">{report.count.countNumber} · {formatDay(report.window.from)} to {formatDay(report.window.to)}{report.count.blind ? " · blind count" : " · open count"}</p>
              {report.count.decisionNote && <p className="m-0 mt-1 text-sm text-neutral-700">Manager&apos;s note: {report.count.decisionNote}</p>}
            </div>
          </div>
          <button type="button" onClick={exportCsv} className={`${quietButton} h-9`}><Download className="h-4 w-4" />Export CSV</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-px border-0 border-t border-solid border-neutral-100 bg-neutral-100 lg:grid-cols-4">
          {[
            { label: "Lost at selling price", value: report.totals.varianceSales != null ? formatMoney(report.totals.varianceSales, currency) : "-", warn: (report.totals.varianceSales ?? 0) < 0 },
            { label: "Lost at cost", value: report.totals.varianceCost != null ? formatMoney(report.totals.varianceCost, currency) : "-", warn: (report.totals.varianceCost ?? 0) < 0 },
            { label: "Outside normal loss", value: `${report.totals.outsideTolerance} of ${report.totals.lines}`, warn: report.totals.outsideTolerance > 0 },
            { label: "Approved", value: report.count.approvedAt ? formatDay(report.count.approvedAt) : "Waiting", warn: false },
          ].map((stat) => (
            <div key={stat.label} className="bg-white px-4 py-3.5 sm:px-6">
              <p className={`m-0 truncate text-xl font-bold tabular-nums ${stat.warn ? "text-red-700" : "text-neutral-950"}`}>{stat.value}</p>
              <p className="m-0 text-[13px] text-neutral-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="space-y-3">
        {report.rows.map((row) => {
          const tone = categoryTone(row.category);
          const shortBy = row.stockFell - row.breakdown.sold - row.breakdown.writtenOff;
          const maxTrend = Math.max(1, ...row.trend.map((point) => Math.abs(point.variance)), Math.abs(row.variance));
          return (
            <section key={row.stockItemId} className={`${cardClass} overflow-hidden ${row.withinTolerance ? "" : "border-red-200"}`}>
              <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <p className="m-0 flex items-center gap-2 text-[15px] font-bold text-neutral-900"><span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />{row.name}</p>
                  <p className={`m-0 mt-1 text-[15px] ${row.variance < 0 ? "font-bold text-red-700" : "text-neutral-700"}`}>
                    Sold {qty(row.breakdown.sold, row.baseUnit)}, stock fell by {qty(row.stockFell, row.baseUnit)}.
                    {row.variance < 0 ? ` ${qty(Math.abs(shortBy > 0 ? shortBy : -row.variance), row.baseUnit)} unexplained.` : row.variance > 0 ? ` ${qty(row.variance, row.baseUnit)} more on the shelf than the book.` : " Everything is accounted for."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {row.varianceSales != null && <span className={`text-lg font-bold tabular-nums ${row.varianceSales < 0 ? "text-red-700" : "text-neutral-800"}`}>{formatMoney(row.varianceSales, currency)}</span>}
                  {row.varianceCost != null && <span className="text-sm tabular-nums text-neutral-500">{formatMoney(row.varianceCost, currency)} at cost</span>}
                  {row.withinTolerance ? <Pill tone="ok">Within {row.tolerancePercent}%</Pill> : <Pill tone="out">Outside {row.tolerancePercent}%</Pill>}
                </div>
              </header>
              <div className="grid gap-4 border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  {[
                    [row.previousCount ? `Counted on ${row.previousCount}` : "Start", row.breakdown.opening, ""],
                    ["Received", row.breakdown.received, "+"],
                    ["Transferred in", row.breakdown.transferredIn, "+"],
                    ["Transferred out", row.breakdown.transferredOut, "-"],
                    ["Sold", row.breakdown.sold, "-"],
                    ["Written off", row.breakdown.writtenOff, "-"],
                    ["Book says", row.expected, "="],
                    ["Counted", row.counted, ""],
                  ].map(([label, value, sign]) => (
                    <div key={String(label)} className="flex justify-between gap-2 border-0 border-b border-dashed border-neutral-100 py-1">
                      <span className="truncate text-neutral-500">{sign ? `${sign} ` : ""}{label}</span>
                      <span className="font-semibold tabular-nums text-neutral-900">{qty(Number(value), row.baseUnit)}</span>
                    </div>
                  ))}
                  {!row.breakdownMatches && <p className="col-span-full m-0 mt-1 text-xs text-amber-800">Some entries were dated around the count, so the lines above do not add up exactly to the book figure.</p>}
                </div>
                <div>
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">Last {row.trend.length + 1} counts</p>
                  <div className="mt-2 flex h-16 items-center gap-1.5">
                    {[...row.trend, { countNumber: report.count.countNumber, at: report.window.to, variance: row.variance, varianceCost: row.varianceCost }].map((point) => (
                      <div key={point.countNumber} className="flex h-full flex-1 flex-col justify-center" title={`${point.countNumber}: ${qty(point.variance, row.baseUnit)}`}>
                        <div className="flex h-1/2 items-end">{point.variance > 0 && <div className="w-full rounded-t bg-emerald-400" style={{ height: `${(point.variance / maxTrend) * 100}%` }} />}</div>
                        <div className="h-px bg-neutral-300" />
                        <div className="flex h-1/2 items-start">{point.variance < 0 && <div className={`w-full rounded-b ${point.countNumber === report.count.countNumber ? "bg-red-600" : "bg-red-300"}`} style={{ height: `${(Math.abs(point.variance) / maxTrend) * 100}%` }} />}</div>
                      </div>
                    ))}
                  </div>
                  <p className="m-0 mt-1 text-xs text-neutral-500">{row.trend.filter((point) => point.variance < 0).length > 2 ? "Short again and again: a pattern, not an accident." : row.trend.length === 0 ? "First count of this good here." : "Red below the line is missing stock."}</p>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Users} title="Who worked here in this period" subtitle="Shifts of staff assigned to this outlet. Context for a conversation, not a verdict.">
          {report.staff.length === 0 ? <p className="m-0 text-sm text-neutral-500">No outlet shifts recorded in this period.</p> : (
            <ul className="m-0 list-none space-y-2 p-0">
              {report.staff.map((person) => (
                <li key={person.name} className="flex items-center justify-between text-sm">
                  <span className="font-bold text-neutral-800">{person.name}</span>
                  <span className="text-neutral-500">{person.shifts} {person.shifts === 1 ? "shift" : "shifts"} · {formatWhen(person.from)}{person.to ? ` to ${formatWhen(person.to)}` : " to now"}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard icon={ArrowRightLeft} tone="amber" title="Transfers that arrived short" subtitle="Lost between two locations in this period">
          {report.shortTransfers.length === 0 ? <p className="m-0 text-sm text-neutral-500">Every transfer arrived in full.</p> : (
            <ul className="m-0 list-none space-y-2 p-0">
              {report.shortTransfers.map((row) => (
                <li key={`${row.transferNumber}-${row.name}`} className="text-sm">
                  <span className="font-bold text-neutral-800">{row.name}</span>
                  <span className="text-neutral-600"> · sent {qty(row.sent, row.baseUnit)}, arrived {qty(row.received, row.baseUnit)} · {row.from} to {row.to} ({row.transferNumber})</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
