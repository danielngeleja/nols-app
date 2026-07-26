"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, WalletCards } from "lucide-react";
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

function money(value: number, currency = "TZS") {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function shortDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not set";
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
  const pageSize = 25;

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

  useEffect(() => { void load(); }, [load]);

  return (
    <SalesShell>
      <style jsx global>{`#sales-earnings, #sales-earnings * { box-sizing: border-box; }`}</style>
      <div id="sales-earnings">
        <SalesPageHeader
          icon={WalletCards}
          title="Earnings ledger"
          description="Every earning is traceable to collected NoLSAF revenue, its source and the agreement rate applied at that time."
        />

        {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        {summary ? (
          <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["This month", summary.thisMonth],
              ["Pending review", summary.pending],
              ["Available", summary.available],
              ["Paid", summary.paid],
              ["All recorded earnings", summary.totalEarned],
            ].map(([label, value]) => (
              <div key={String(label)} className="border border-slate-200 bg-white p-4 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.11em] text-slate-400">{label}</p>
                <p className="mb-0 mt-2 text-lg font-black tracking-tight text-slate-950">{money(Number(value), summary.currency)}</p>
              </div>
            ))}
          </section>
        ) : null}

        <section className="mt-5 border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <select value={type} onChange={(event) => { setPage(1); setType(event.target.value); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">All streams</option>
              <option value="NRMS_USAGE">NRMS usage</option>
              <option value="MARKETPLACE_BOOKING">Marketplace booking</option>
              <option value="PERFORMANCE_BONUS">Performance bonus</option>
              <option value="MANUAL_ADJUSTMENT">Manual adjustment</option>
            </select>
            <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as (typeof statuses)[number]); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {statuses.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
            <p className="m-0 self-center text-xs text-gray-500 sm:ml-auto">VALIDATING and ELIGIBLE amounts are not withdrawable.</p>
          </div>
        </section>

        <section className="mt-5 overflow-hidden border border-slate-200 bg-white">
          {loading ? <div className="p-10 text-center text-sm text-gray-500">Loading earnings...</div> : earnings.length === 0 ? (
            <div className="p-10 text-center"><p className="text-sm font-medium text-gray-900">No earning records found</p><p className="mt-1 text-sm text-gray-500">Collected revenue from active attributions will appear here.</p></div>
          ) : (
            <div className="divide-y divide-gray-100">
              {earnings.map((item) => {
                const open = expanded === item.id;
                const deductions = item.taxAmount + item.processingFeeAmount + item.refundAmount + item.discountAmount;
                return (
                  <article key={item.id}>
                    <button type="button" onClick={() => setExpanded(open ? null : item.id)} className="grid w-full gap-3 border-0 bg-white p-4 text-left hover:bg-gray-50 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_auto] md:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{item.property?.title || "Programme earning"}</p>
                        <p className="mt-1 text-xs text-gray-500">{item.type.replaceAll("_", " ")} · {shortDate(item.earnedAt)}</p>
                      </div>
                      <div><p className="text-[10px] uppercase text-gray-400">Eligible revenue</p><p className="mt-1 text-sm text-gray-700">{money(item.eligibleNetRevenue, item.currency)}</p></div>
                      <div><p className="text-[10px] uppercase text-gray-400">Rate</p><p className="mt-1 text-sm text-gray-700">{item.commissionRate}%</p></div>
                      <div><p className="text-[10px] uppercase text-gray-400">Earning</p><p className="mt-1 text-sm font-semibold text-gray-900">{money(item.commissionAmount, item.currency)}</p></div>
                      <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${statusTone(item.status)}`}>{item.status}</span>{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
                    </button>
                    {open ? (
                      <div className="border-t border-gray-100 bg-gray-50 px-4 py-5">
                        <h3 className="text-sm font-semibold text-gray-900">Calculation</h3>
                        <div className="mt-3 grid gap-2 text-sm sm:max-w-2xl">
                          <div className="flex justify-between gap-4"><span className="text-gray-600">Gross NoLSAF revenue</span><b>{money(item.grossAmount, item.currency)}</b></div>
                          <div className="flex justify-between gap-4"><span className="text-gray-600">Tax</span><b>- {money(item.taxAmount, item.currency)}</b></div>
                          <div className="flex justify-between gap-4"><span className="text-gray-600">Processing fees</span><b>- {money(item.processingFeeAmount, item.currency)}</b></div>
                          <div className="flex justify-between gap-4"><span className="text-gray-600">Refunds and discounts</span><b>- {money(item.refundAmount + item.discountAmount, item.currency)}</b></div>
                          <div className="flex justify-between gap-4 border-t border-gray-200 pt-2"><span className="text-gray-700">Eligible net revenue</span><b>{money(item.eligibleNetRevenue, item.currency)}</b></div>
                          <div className="flex justify-between gap-4"><span className="text-gray-700">Partner share ({item.commissionRate}%)</span><b className="text-brand">{money(item.commissionAmount, item.currency)}</b></div>
                        </div>
                        <p className="mb-0 mt-3 text-xs text-gray-500">
                          Source {item.sourceKey} · total deductions {money(deductions, item.currency)}
                          {item.eligibleAt ? ` · validation ends ${shortDate(item.eligibleAt)}` : ""}
                        </p>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-600">{total.toLocaleString()} earnings</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>
            <button type="button" disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </SalesShell>
  );
}
