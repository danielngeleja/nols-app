"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, Landmark, Loader2, Send, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";

type Payout = {
  id: number;
  referenceNumber: string;
  requestedAmount: number;
  approvedAmount: number | null;
  deductionAmount: number;
  netPaidAmount: number | null;
  currency: string;
  status: string;
  payoutMethod: string;
  payoutName: string;
  payoutAccount: string | null;
  requestedAt: string;
  paidAt: string | null;
  rejectionReason: string | null;
  paymentReference: string | null;
  receiptUrl: string | null;
  _count: { items: number };
};

type Summary = { available: number; currency: string };
type SalesMe = { payout: { name: string | null; method: string | null; accountMasked: string | null } };

const MIN_PAYOUT_AMOUNT = 50_000;

function money(value: number, currency = "TZS") {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default function SalesPayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [summary, setSummary] = useState<Summary>({ available: 0, currency: "TZS" });
  const [me, setMe] = useState<SalesMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelReason, setCancelReason] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [payoutResponse, summaryResponse, meResponse] = await Promise.all([
        apiClient.get("/api/sales/payouts", { params: { pageSize: 100 } }),
        apiClient.get("/api/sales/earnings/summary"),
        apiClient.get("/api/sales/me"),
      ]);
      setPayouts(payoutResponse.data?.payouts || []);
      setSummary(summaryResponse.data?.summary || { available: 0, currency: "TZS" });
      setMe(meResponse.data || null);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load payouts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const requestPayout = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiClient.post("/api/sales/payouts", {});
      setNotice(`Payout ${response.data?.payout?.referenceNumber || ""} submitted for finance review.`);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not request payout.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (payout: Payout) => {
    const reason = (cancelReason[payout.id] || "").trim();
    if (reason.length < 5) {
      setError("Enter a cancellation reason of at least 5 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/sales/payouts/${payout.id}/cancel`, { reason });
      setNotice(`${payout.referenceNumber} cancelled; its earnings are available again.`);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not cancel payout.");
    } finally {
      setBusy(false);
    }
  };

  const destinationReady = Boolean(me?.payout?.name && me?.payout?.method && me?.payout?.accountMasked);
  const minimumReached = summary.available >= MIN_PAYOUT_AMOUNT;
  const canRequest = !loading && !busy && destinationReady && minimumReached;

  return (
    <SalesShell>
      <style jsx global>{`#sales-payouts, #sales-payouts * { box-sizing: border-box; }`}</style>
      <div id="sales-payouts">
        <section className="relative overflow-hidden rounded-[26px] border border-emerald-100 bg-white shadow-[0_20px_55px_-42px_rgba(3,73,61,0.55)]">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-emerald-100/60 blur-3xl" />
          <div className="relative flex items-start gap-4 px-5 py-6 sm:px-7 sm:py-7">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#087f68] text-white shadow-[0_14px_30px_-18px_rgba(8,127,104,0.9)]">
              <Wallet className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">
                Sales workspace
              </p>
              <h1 className="mb-0 mt-1.5 text-[clamp(1.45rem,2.5vw,2rem)] font-black leading-tight tracking-[-0.035em] text-slate-950">
                Payouts
              </h1>
              <p className="mb-0 mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Request available earnings and follow each finance review through to settlement.
              </p>
            </div>
          </div>

          <div className="relative grid gap-px border-t border-slate-200 bg-slate-200 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="bg-white/95 px-5 py-5 sm:px-7 sm:py-6">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                <CircleDollarSign className="h-4 w-4 text-emerald-700" />
                Available to withdraw
              </div>

              {loading ? (
                <div className="mt-4 h-9 w-48 animate-pulse rounded-lg bg-slate-100" />
              ) : (
                <p className="mb-0 mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950">
                  {money(summary.available, summary.currency)}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="m-0 text-xs font-semibold text-slate-600">
                    Minimum {money(MIN_PAYOUT_AMOUNT, summary.currency)} per request
                  </p>
                  {!loading && !minimumReached ? (
                    <p className="mb-0 mt-1 text-[11px] text-slate-400">
                      {money(Math.max(0, MIN_PAYOUT_AMOUNT - summary.available), summary.currency)} more needed
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={!canRequest}
                  onClick={() => void requestPayout()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#073c35] px-4 text-sm font-bold text-white shadow-[0_12px_24px_-16px_rgba(7,60,53,0.9)] transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {busy ? "Submitting" : "Request payout"}
                </button>
              </div>
            </div>

            <div className="bg-white/95 px-5 py-5 sm:px-7 sm:py-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  <Landmark className="h-4 w-4 text-emerald-700" />
                  Payout destination
                </div>
                {!loading ? (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                    destinationReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}>
                    {destinationReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                    {destinationReady ? "Ready" : "Action required"}
                  </span>
                ) : null}
              </div>

              {loading ? (
                <div className="mt-4 space-y-2">
                  <div className="h-5 w-44 animate-pulse rounded-lg bg-slate-100" />
                  <div className="h-4 w-64 max-w-full animate-pulse rounded-lg bg-slate-100" />
                </div>
              ) : destinationReady ? (
                <div className="mt-4 flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <CheckCircle2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-black text-slate-900">{me!.payout.name}</p>
                    <p className="mb-0 mt-1 text-xs text-slate-500">
                      {me!.payout.method} ending {me!.payout.accountMasked}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/70 p-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-amber-700 shadow-sm">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="m-0 text-sm font-bold text-amber-900">Destination details are incomplete</p>
                    <p className="mb-0 mt-1 text-xs leading-5 text-amber-800/80">
                      Ask an administrator to add your payout name, method and account before requesting.
                    </p>
                  </div>
                </div>
              )}

              <p className="mb-0 mt-3 text-[11px] text-slate-400">
                Your saved destination is securely snapshotted when a request is submitted.
              </p>
            </div>
          </div>
        </section>

        {!loading && error ? <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        {!loading && notice ? <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p> : null}

        <section className="mt-5 overflow-hidden border border-slate-200 bg-white">
          {loading ? (
            <div className="divide-y divide-slate-100" role="status" aria-label="Loading payouts">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-4 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="h-4 w-36 rounded-full bg-slate-200 animate-pulse" />
                    <div className="h-6 w-20 rounded-full bg-slate-100 animate-pulse" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="h-3 rounded-full bg-slate-100 animate-pulse" />
                    <div className="h-3 rounded-full bg-slate-100 animate-pulse" />
                    <div className="h-3 rounded-full bg-slate-100 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : payouts.length === 0 ? <div className="p-10 text-center"><p className="text-sm font-medium text-gray-900">No payout requests</p><p className="mt-1 text-sm text-gray-500">Approved available earnings can be requested here.</p></div> : (
            <div className="divide-y divide-gray-100">
              {payouts.map((payout) => (
                <article key={payout.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="font-semibold text-gray-900">{payout.referenceNumber}</p><p className="mt-1 text-xs text-gray-500">{new Date(payout.requestedAt).toLocaleString()} · {payout._count.items} earnings</p></div>
                    <span className={`rounded-full px-2.5 py-1 text-xs ${statusTone(payout.status)}`}>{payout.status}</span>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div><p className="text-xs text-gray-500">Requested</p><p className="mt-1 font-medium text-gray-900">{money(payout.requestedAmount, payout.currency)}</p></div>
                    <div><p className="text-xs text-gray-500">Net paid</p><p className="mt-1 font-medium text-gray-900">{payout.netPaidAmount == null ? "Pending" : money(payout.netPaidAmount, payout.currency)}</p></div>
                    <div><p className="text-xs text-gray-500">Destination</p><p className="mt-1 font-medium text-gray-900">{payout.payoutMethod} · {payout.payoutAccount || "masked"}</p></div>
                  </div>
                  {payout.rejectionReason ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{payout.rejectionReason}</p> : null}
                  {payout.status === "REQUESTED" ? (
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <input value={cancelReason[payout.id] || ""} onChange={(event) => setCancelReason({ ...cancelReason, [payout.id]: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Reason to cancel this unreviewed request" />
                      <button type="button" disabled={busy} onClick={() => void cancel(payout)} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-45">Cancel request</button>
                    </div>
                  ) : null}
                  {payout.receiptUrl ? <a href={payout.receiptUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">Download receipt</a> : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </SalesShell>
  );
}
