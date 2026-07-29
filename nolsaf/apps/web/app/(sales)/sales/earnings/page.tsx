"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Eye,
  Info,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Summary = {
  pending: number;
  available: number;
  paid: number;
  reversed: number;
  totalEarned: number;
  eligibleNetRevenue: number;
  thisMonth: number;
  currency: string;
  count: number;
  byStream: Record<string, number>;
};

type Earning = {
  id: number;
  type: string;
  status: string;
  sourceKey: string;
  grossAmount: number;
  taxAmount: number;
  processingFeeAmount: number;
  refundAmount: number;
  discountAmount: number;
  eligibleNetRevenue: number;
  commissionRate: number;
  commissionAmount: number;
  currency: string;
  description: string | null;
  earnedAt: string;
  eligibleAt: string | null;
  property: { id: number; title: string } | null;
};

const statuses = ["ALL", "VALIDATING", "ELIGIBLE", "APPROVED", "AVAILABLE", "PAID", "REVERSED"] as const;
const pageSize = 25;

function money(value: number, currency = "TZS") {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function shortDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "Not set";
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export default function SalesEarningsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof statuses)[number]>("ALL");
  const [type, setType] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryResponse, listResponse] = await Promise.all([
        apiClient.get("/api/sales/earnings/summary"),
        apiClient.get("/api/sales/earnings", {
          params: {
            page,
            pageSize,
            ...(status !== "ALL" ? { status } : {}),
            ...(type ? { type } : {}),
          },
        }),
      ]);
      setSummary(summaryResponse.data?.summary || null);
      setEarnings(listResponse.data?.earnings || []);
      setTotal(Number(listResponse.data?.total || 0));
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load earnings.");
    } finally {
      setLoading(false);
    }
  }, [page, status, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const summaryCards = summary
    ? [
        { label: "This month", value: summary.thisMonth, note: "Current period", Icon: CalendarDays, icon: "bg-sky-50 text-sky-700 ring-sky-100" },
        { label: "Pending review", value: summary.pending, note: "Under validation", Icon: Clock3, icon: "bg-amber-50 text-amber-700 ring-amber-100" },
        { label: "Available", value: summary.available, note: "Ready to request", Icon: CircleDollarSign, icon: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
        { label: "Paid", value: summary.paid, note: "Settled earnings", Icon: BadgeCheck, icon: "bg-teal-50 text-teal-700 ring-teal-100" },
        { label: "Total recorded", value: summary.totalEarned, note: `${summary.count.toLocaleString()} ledger entries`, Icon: ReceiptText, icon: "bg-violet-50 text-violet-700 ring-violet-100" },
      ]
    : [];

  return (
    <SalesShell>
      <div id="sales-earnings">
        <SalesPageHeader
          icon={WalletCards}
          title="Earnings ledger"
          description="Every earning is traceable to collected NoLSAF revenue, its source and the agreement rate applied at that time."
        />

        {error ? (
          <p className="mb-0 mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <section className="mt-5 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5" aria-label="Earnings summary">
          {summary ? (
            summaryCards.map(({ label, value, note, Icon, icon }) => (
              <article
                key={label}
                className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.45)] sm:rounded-2xl sm:p-4"
              >
                <div className="flex items-start justify-between gap-2 sm:gap-3">
                  <div className="min-w-0">
                    <p className="m-0 min-h-6 text-[9px] font-black uppercase leading-3 tracking-[0.08em] text-slate-400 sm:min-h-0 sm:truncate sm:text-[10px] sm:leading-normal sm:tracking-[0.1em]">{label}</p>
                    <p className="mb-0 mt-1.5 truncate text-base font-black tracking-[-0.03em] text-slate-950 sm:mt-2 sm:text-lg">
                      {money(value, summary.currency)}
                    </p>
                  </div>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 sm:h-9 sm:w-9 sm:rounded-xl ${icon}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="mb-0 mt-2.5 line-clamp-2 border-t border-slate-100 pt-2 text-[9px] font-medium leading-3.5 text-slate-500 sm:mt-3 sm:truncate sm:pt-2.5 sm:text-[10px] sm:leading-normal">{note}</p>
              </article>
            ))
          ) : (
            Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="animate-pulse rounded-xl border border-slate-200 bg-white p-3 sm:rounded-2xl sm:p-4">
                <span className="block h-3 w-24 rounded bg-slate-100" />
                <span className="mt-3 block h-6 w-36 max-w-full rounded bg-slate-200" />
                <span className="mt-4 block h-3 w-28 rounded bg-slate-100" />
              </div>
            ))
          )}
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_14px_35px_-32px_rgba(15,23,42,0.45)]">
          <div className="grid items-center gap-2.5 md:grid-cols-[200px_180px_minmax(0,1fr)]">
            <label>
              <span className="sr-only">Earning stream</span>
              <select
                value={type}
                onChange={(event) => { setPage(1); setExpanded(null); setType(event.target.value); }}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              >
                <option value="">All earning streams</option>
                <option value="NRMS_USAGE">NRMS usage</option>
                <option value="MARKETPLACE_BOOKING">Marketplace booking</option>
                <option value="PERFORMANCE_BONUS">Performance bonus</option>
                <option value="MANUAL_ADJUSTMENT">Manual adjustment</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Earning status</span>
              <select
                value={status}
                onChange={(event) => { setPage(1); setExpanded(null); setStatus(event.target.value as (typeof statuses)[number]); }}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              >
                {statuses.map((item) => (
                  <option key={item} value={item}>{item === "ALL" ? "All statuses" : formatLabel(item)}</option>
                ))}
              </select>
            </label>
            <div className="flex min-h-11 items-center gap-2 rounded-xl bg-amber-50/70 px-3 text-[11px] leading-5 text-amber-900 md:justify-self-end">
              <Info className="h-4 w-4 shrink-0 text-amber-700" />
              Only AVAILABLE earnings can be requested for payout.
            </div>
          </div>
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.5)]" aria-label="Earnings ledger records">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="m-0 text-sm font-black text-slate-900">Ledger records</h2>
              <p className="mb-0 mt-1 text-[11px] text-slate-400">
                {loading ? "Loading traceable earnings" : `${total.toLocaleString()} earning record${total === 1 ? "" : "s"}`}
              </p>
            </div>
            {!loading && total > 0 ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                Page {page} of {totalPages}
              </span>
            ) : null}
          </div>

          {loading ? (
            <>
              <div className="space-y-3 bg-slate-50/60 p-3 md:hidden" role="status" aria-label="Loading earnings">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <span className="block h-4 w-3/4 rounded bg-slate-200" />
                        <span className="block h-3 w-2/5 rounded bg-slate-100" />
                      </div>
                      <span className="h-6 w-20 rounded-full bg-slate-100" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {Array.from({ length: 4 }).map((__, itemIndex) => (
                        <span key={itemIndex} className="h-10 rounded-xl bg-slate-100" />
                      ))}
                    </div>
                    <span className="mt-4 block h-10 rounded-xl bg-slate-100" />
                  </div>
                ))}
              </div>
              <div className="hidden divide-y divide-slate-100 md:block" role="status" aria-label="Loading earnings table">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="grid animate-pulse grid-cols-[minmax(220px,1.4fr)_110px_150px_70px_150px_110px_44px] gap-4 px-5 py-4">
                    <span className="h-4 rounded bg-slate-200" />
                    <span className="h-4 rounded bg-slate-100" />
                    <span className="h-4 rounded bg-slate-100" />
                    <span className="h-4 rounded bg-slate-100" />
                    <span className="h-4 rounded bg-slate-200" />
                    <span className="h-5 rounded-full bg-slate-100" />
                    <span className="h-8 w-8 rounded-lg bg-slate-100" />
                  </div>
                ))}
              </div>
            </>
          ) : earnings.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <ReceiptText className="h-6 w-6" />
                </span>
                <p className="mb-0 mt-4 text-sm font-black text-slate-800">No earning records found</p>
                <p className="mb-0 mt-1 text-xs text-slate-500">Collected revenue from active attributions will appear here.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3 bg-slate-50/60 p-3 md:hidden">
                {earnings.map((item) => {
                  const open = expanded === item.id;
                  const deductions = item.taxAmount + item.processingFeeAmount + item.refundAmount + item.discountAmount;
                  return (
                    <article
                      key={item.id}
                      className={`overflow-hidden rounded-2xl border bg-white shadow-[0_16px_36px_-30px_rgba(15,23,42,0.45)] transition ${
                        open ? "border-emerald-300 ring-2 ring-emerald-100" : "border-slate-200"
                      }`}
                    >
                      <div className={`h-1 ${open ? "bg-emerald-600" : "bg-slate-200"}`} aria-hidden />
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-black text-slate-950">
                              {item.property?.title || "Programme earning"}
                            </p>
                            <p className="mb-0 mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                              {formatLabel(item.type)}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wide ${statusTone(item.status)}`}>
                            {formatLabel(item.status)}
                          </span>
                        </div>

                        <dl className="mb-0 mt-4 grid grid-cols-2 gap-2">
                          {[
                            ["Earned", shortDate(item.earnedAt)],
                            ["Eligible revenue", money(item.eligibleNetRevenue, item.currency)],
                            ["Partner rate", `${item.commissionRate}%`],
                            ["Your commission", money(item.commissionAmount, item.currency)],
                          ].map(([label, value], index) => (
                            <div
                              key={label}
                              className={`rounded-xl px-3 py-2.5 ${
                                index === 3 ? "bg-emerald-50 ring-1 ring-emerald-100" : "bg-slate-50"
                              }`}
                            >
                              <dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
                              <dd className={`m-0 mt-1 break-words text-[11px] leading-4 ${index === 3 ? "font-black text-emerald-900" : "font-bold text-slate-800"}`}>
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>

                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : item.id)}
                          aria-expanded={open}
                          aria-controls={`mobile-earning-calculation-${item.id}`}
                          className={`mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-xs font-black transition ${
                            open
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-800"
                          }`}
                        >
                          <Eye className="h-4 w-4" />
                          {open ? "Hide calculation" : "View calculation"}
                        </button>
                      </div>

                      {open ? (
                        <div id={`mobile-earning-calculation-${item.id}`} className="border-t border-emerald-100 bg-emerald-50/35 p-4">
                          <div className="flex items-center gap-2">
                            <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-emerald-700 shadow-sm">
                              <CircleDollarSign className="h-4 w-4" />
                            </span>
                            <div>
                              <p className="m-0 text-xs font-black text-slate-900">Commission calculation</p>
                              <p className="mb-0 mt-0.5 break-all text-[9px] text-slate-400">Reference {item.sourceKey}</p>
                            </div>
                          </div>
                          <dl className="mb-0 mt-3 space-y-2 text-[11px]">
                            {[
                              ["Gross NoLSAF revenue", money(item.grossAmount, item.currency)],
                              ["Tax", `- ${money(item.taxAmount, item.currency)}`],
                              ["Processing fees", `- ${money(item.processingFeeAmount, item.currency)}`],
                              ["Refunds and discounts", `- ${money(item.refundAmount + item.discountAmount, item.currency)}`],
                              ["Total deductions", money(deductions, item.currency)],
                            ].map(([label, value]) => (
                              <div key={label} className="flex items-center justify-between gap-3">
                                <dt className="text-slate-500">{label}</dt>
                                <dd className="m-0 shrink-0 font-bold text-slate-700">{value}</dd>
                              </div>
                            ))}
                            <div className="flex items-center justify-between gap-3 border-t border-emerald-100 pt-2">
                              <dt className="font-bold text-slate-700">Eligible revenue</dt>
                              <dd className="m-0 shrink-0 font-black text-slate-950">{money(item.eligibleNetRevenue, item.currency)}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-700 px-3 py-2.5 text-white">
                              <dt className="font-bold">Partner share ({item.commissionRate}%)</dt>
                              <dd className="m-0 shrink-0 font-black">{money(item.commissionAmount, item.currency)}</dd>
                            </div>
                          </dl>
                          <p className="mb-0 mt-3 text-[10px] text-slate-500">
                            Validation ends {shortDate(item.eligibleAt)}
                          </p>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1050px] border-collapse text-left">
                <thead className="bg-slate-50/80">
                  <tr className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                    <th className="px-5 py-3">Earning source</th>
                    <th className="px-4 py-3">Earned</th>
                    <th className="px-4 py-3 text-right">Eligible revenue</th>
                    <th className="px-4 py-3 text-right">Rate</th>
                    <th className="px-4 py-3 text-right">Commission</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="w-16 px-4 py-3 text-center">View</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {earnings.map((item) => {
                    const open = expanded === item.id;
                    const deductions = item.taxAmount + item.processingFeeAmount + item.refundAmount + item.discountAmount;
                    return (
                      <Fragment key={item.id}>
                        <tr className={`text-sm transition ${open ? "bg-emerald-50/35" : "hover:bg-emerald-50/25"}`}>
                          <td className="px-5 py-4">
                            <p className="m-0 max-w-sm truncate font-bold text-slate-900">{item.property?.title || "Programme earning"}</p>
                            <p className="mb-0 mt-1 text-[11px] text-slate-400">{formatLabel(item.type)}</p>
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-xs font-medium text-slate-600">{shortDate(item.earnedAt)}</td>
                          <td className="whitespace-nowrap px-4 py-4 text-right text-xs font-semibold text-slate-700">
                            {money(item.eligibleNetRevenue, item.currency)}
                          </td>
                          <td className="px-4 py-4 text-right text-xs font-bold text-slate-700">{item.commissionRate}%</td>
                          <td className="whitespace-nowrap px-4 py-4 text-right text-xs font-black text-slate-950">
                            {money(item.commissionAmount, item.currency)}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone(item.status)}`}>
                              {formatLabel(item.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => setExpanded(open ? null : item.id)}
                              aria-expanded={open}
                              aria-label={`${open ? "Hide" : "View"} calculation for earning ${item.id}`}
                              className={`inline-grid h-9 w-9 place-items-center rounded-lg border bg-white transition ${
                                open
                                  ? "border-emerald-300 text-emerald-800"
                                  : "border-slate-200 text-slate-500 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                              }`}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>

                        {open ? (
                          <tr className="bg-slate-50/70">
                            <td colSpan={7} className="p-0">
                              <div className="grid gap-5 border-t border-emerald-100 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <CircleDollarSign className="h-4 w-4 text-emerald-700" />
                                    <h3 className="m-0 text-sm font-black text-slate-900">Commission calculation</h3>
                                  </div>
                                  <dl className="mb-0 mt-4 grid max-w-2xl gap-2.5 text-xs">
                                    {[
                                      ["Gross NoLSAF revenue", money(item.grossAmount, item.currency)],
                                      ["Tax", `- ${money(item.taxAmount, item.currency)}`],
                                      ["Processing fees", `- ${money(item.processingFeeAmount, item.currency)}`],
                                      ["Refunds and discounts", `- ${money(item.refundAmount + item.discountAmount, item.currency)}`],
                                    ].map(([label, value]) => (
                                      <div key={label} className="flex items-center justify-between gap-4">
                                        <dt className="text-slate-500">{label}</dt>
                                        <dd className="m-0 font-bold text-slate-800">{value}</dd>
                                      </div>
                                    ))}
                                    <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-2.5">
                                      <dt className="font-bold text-slate-700">Eligible net revenue</dt>
                                      <dd className="m-0 font-black text-slate-950">{money(item.eligibleNetRevenue, item.currency)}</dd>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 rounded-lg bg-emerald-50 px-3 py-2">
                                      <dt className="font-bold text-emerald-800">Partner share ({item.commissionRate}%)</dt>
                                      <dd className="m-0 font-black text-emerald-900">{money(item.commissionAmount, item.currency)}</dd>
                                    </div>
                                  </dl>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-white p-4">
                                  <p className="m-0 text-[10px] font-black uppercase tracking-wide text-slate-400">Record details</p>
                                  <dl className="mb-0 mt-3 space-y-3 text-xs">
                                    <div>
                                      <dt className="text-slate-400">Source reference</dt>
                                      <dd className="m-0 mt-1 break-all font-bold text-slate-700">{item.sourceKey}</dd>
                                    </div>
                                    <div>
                                      <dt className="text-slate-400">Total deductions</dt>
                                      <dd className="m-0 mt-1 font-bold text-slate-700">{money(deductions, item.currency)}</dd>
                                    </div>
                                    <div>
                                      <dt className="text-slate-400">Validation ends</dt>
                                      <dd className="m-0 mt-1 font-bold text-slate-700">{shortDate(item.eligibleAt)}</dd>
                                    </div>
                                    {item.description ? (
                                      <div>
                                        <dt className="text-slate-400">Description</dt>
                                        <dd className="m-0 mt-1 leading-5 text-slate-600">{item.description}</dd>
                                      </div>
                                    ) : null}
                                  </dl>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}

          {!loading && earnings.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3">
              <p className="m-0 text-[11px] text-slate-500">
                Showing {(page - 1) * pageSize + 1}&ndash;{Math.min(page * pageSize, total)} of {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => { setExpanded(null); setPage((value) => Math.max(1, value - 1)); }}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-300 hover:text-emerald-800 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-14 text-center text-xs font-bold text-slate-600">{page} / {totalPages}</span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => { setExpanded(null); setPage((value) => Math.min(totalPages, value + 1)); }}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-300 hover:text-emerald-800 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </SalesShell>
  );
}
