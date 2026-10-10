"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Receipt } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { STAGES, formatEat, formatTzs, stayDates, useOwnerPayouts, type PayoutStage } from "@/components/owner-payouts/shared";

/**
 * Finished payouts only: paid, settled against a refund, or cancelled. Stays
 * from the new flow and claims from the previous invoice flow are listed
 * together because both are finished money; previous-flow rows carry an
 * "Older claim" tag so they are never mistaken for the new process.
 */

type LegacyInvoice = {
  id: number;
  invoiceReference?: string | null;
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  paidAt?: string | null;
  netPayable: number | string;
  receiptNumber?: string | null;
  booking?: { property?: { title: string } };
};

type Row = {
  key: string;
  stage: PayoutStage;
  title: string;
  detail: string;
  amount: number;
  date: string;
  older: boolean;
  href: string | null;
  hrefLabel: string;
};

const FINISHED: PayoutStage[] = ["PAID", "SETTLED", "CANCELLED"];

export default function PayoutsHistoryPage() {
  const { payouts, loading: payoutsLoading } = useOwnerPayouts();
  const [legacy, setLegacy] = useState<LegacyInvoice[]>([]);
  const [legacyLoading, setLegacyLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | PayoutStage>("all");

  useEffect(() => {
    apiClient
      .get<{ items: LegacyInvoice[] }>("/api/owner/revenue/invoices", { params: { status: "PAID,REJECTED", scope: "legacy", take: 200 } })
      .then((res) => setLegacy((res.data?.items ?? []).filter((i) => String(i.invoiceNumber || "").startsWith("OINV-"))))
      .catch(() => setLegacy([]))
      .finally(() => setLegacyLoading(false));
  }, []);

  const rows = useMemo<Row[]>(() => {
    const fromNew: Row[] = payouts
      .filter((p) => FINISHED.includes(p.stage))
      .map((p) => ({
        key: `n-${p.bookingReference}`,
        stage: p.stage,
        title: p.propertyTitle || "Your property",
        detail: `${p.guestName ? `${p.guestName}, ` : ""}${stayDates(p.checkIn, p.checkOut)}`,
        amount: Number(p.amount) || 0,
        date: p.paidAt ?? p.releasedAt ?? p.releaseAt,
        older: false,
        href: p.stage === "CANCELLED" ? null : `/owner/invoices/${encodeURIComponent(p.invoiceReference)}`,
        hrefLabel: "Statement",
      }));
    const fromLegacy: Row[] = legacy.map((inv) => {
      const paid = String(inv.status).toUpperCase() === "PAID";
      return {
        key: `o-${inv.id}`,
        stage: paid ? "PAID" : "CANCELLED",
        title: inv.booking?.property?.title || "Your property",
        detail: inv.invoiceNumber,
        amount: Number(inv.netPayable) || 0,
        date: inv.paidAt ?? inv.issuedAt,
        older: true,
        href: paid ? `/owner/revenue/receipts/${inv.id}` : null,
        hrefLabel: "Receipt",
      };
    });
    return [...fromNew, ...fromLegacy].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [payouts, legacy]);

  const visible = filter === "all" ? rows : rows.filter((r) => r.stage === filter);
  const paidTotal = rows.filter((r) => r.stage === "PAID").reduce((t, r) => t + r.amount, 0);

  if (payoutsLoading || legacyLoading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading your history...
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
      <div className="flex flex-col gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        {/* One row of short filters; scrolls sideways on narrow screens instead of wrapping. */}
        <div className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["all", "All"],
              ["PAID", "Paid"],
              ["SETTLED", "Settled"],
              ["CANCELLED", "Cancelled"],
            ] as const
          ).map(([key, label]) => {
            const on = filter === key;
            const count = key === "all" ? rows.length : rows.filter((r) => r.stage === key).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={on}
                title={key === "SETTLED" ? "Settled against a refund" : undefined}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-solid px-3 text-xs font-semibold transition-colors ${
                  on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
                <span className={`tabular-nums ${on ? "text-white/80" : "text-slate-400"}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <span className="text-xs text-slate-500 sm:ml-auto sm:shrink-0">
          <span className="font-semibold tabular-nums text-slate-700">{formatTzs(paidTotal)}</span> paid in total
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="m-0 px-5 py-10 text-center text-sm text-slate-500">Finished payouts will be listed here.</p>
      ) : (
        <>
        {/* Table from md up: one row per payout, aligned columns. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[130px]" />
              <col />
              <col className="w-[28%]" />
              <col className="w-[120px]" />
              <col className="w-[150px]" />
              <col className="w-[110px]" />
            </colgroup>
            <thead>
              <tr className="border-0 border-b border-solid border-slate-200 bg-slate-50/70 text-left">
                {["Status", "Property", "Details", "Date", "Amount", ""].map((head, i) => (
                  <th
                    key={head || "action"}
                    scope="col"
                    className={`px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 ${i === 4 ? "text-right" : "text-left"}`}
                  >
                    {head || <span className="sr-only">Document</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const meta = STAGES[r.stage];
                return (
                  <tr key={r.key} className="border-0 border-b border-solid border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3 align-middle">
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                        {r.stage === "SETTLED" ? "Settled" : meta.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 align-middle">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-semibold text-slate-900">{r.title}</span>
                        {r.older && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Older claim</span>}
                      </div>
                    </td>
                    <td className="truncate px-5 py-3 align-middle font-mono text-xs text-slate-500">{r.detail}</td>
                    <td className="whitespace-nowrap px-5 py-3 align-middle text-slate-600">{formatEat(r.date, false)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right align-middle font-bold tabular-nums text-slate-900">{formatTzs(r.amount)}</td>
                    <td className="px-5 py-3 text-right align-middle">
                      {r.href ? (
                        <Link href={r.href} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-[#02665e] no-underline hover:underline">
                          <Receipt className="h-3.5 w-3.5" aria-hidden /> {r.hrefLabel}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-300" aria-hidden>None</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Phones: a two-column card per payout, the table would not fit. */}
        <ul className="m-0 list-none divide-y divide-slate-100 p-0 md:hidden">
          {visible.map((r) => {
            const meta = STAGES[r.stage];
            return (
              <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3.5">
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                      {r.stage === "SETTLED" ? "Settled" : meta.label}
                    </span>
                    {r.older && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Older</span>}
                  </div>
                  <p className="m-0 truncate text-sm font-semibold text-slate-900">{r.title}</p>
                  <p className="m-0 truncate font-mono text-[11px] text-slate-500">{r.detail}</p>
                  <p className="m-0 text-[11px] text-slate-500">{formatEat(r.date, false)}</p>
                </div>
                <div className="flex flex-col items-end justify-between gap-2">
                  <span className="whitespace-nowrap text-sm font-bold tabular-nums text-slate-900">{formatTzs(r.amount)}</span>
                  {r.href && (
                    <Link
                      href={r.href}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-solid border-[#02665e]/20 bg-[#02665e]/[0.06] px-2.5 text-xs font-semibold text-[#02665e] no-underline hover:no-underline"
                    >
                      <Receipt className="h-3.5 w-3.5" aria-hidden /> {r.hrefLabel}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </section>
  );
}
