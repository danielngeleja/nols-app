"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Send, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

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

  return (
    <SalesShell>
      <style jsx global>{`#sales-payouts, #sales-payouts * { box-sizing: border-box; }`}</style>
      <div id="sales-payouts">
        <SalesPageHeader
          icon={Wallet}
          title="Payouts"
          description="Request approved, available earnings and follow every finance review through to settlement."
          actions={<button type="button" disabled={busy || summary.available <= 0 || !destinationReady} onClick={() => void requestPayout()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#087f68] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Request all available
          </button>}
        />

        {!loading && error ? <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        {!loading && notice ? <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p> : null}

        <section className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="border border-slate-200 bg-white p-5 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.11em] text-slate-400">Available to withdraw</p>
            {loading ? <div className="mt-3 h-7 w-44 rounded-full bg-slate-200 animate-pulse" /> : <p className="mb-0 mt-2 text-2xl font-black tracking-tight text-slate-950">{money(summary.available, summary.currency)}</p>}
            <p className="mb-0 mt-2 text-xs text-slate-500">Minimum TSh 50,000 per request.</p>
          </div>
          <div className="border border-slate-200 bg-white p-5 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.11em] text-slate-400">Saved destination</p>
            {loading ? (
              <div className="mt-3 space-y-2">
                <div className="h-4 w-40 rounded-full bg-slate-200 animate-pulse" />
                <div className="h-3 w-56 max-w-full rounded-full bg-slate-100 animate-pulse" />
              </div>
            ) : destinationReady ? (
              <>
                <p className="mb-0 mt-2 font-bold text-slate-900">{me!.payout.name}</p>
                <p className="mb-0 mt-1 text-sm text-slate-600">{me!.payout.method} ending {me!.payout.accountMasked}</p>
              </>
            ) : (
              <p className="mb-0 mt-2 text-sm font-bold text-amber-700">Payout destination is incomplete. Ask an administrator to complete it before requesting.</p>
            )}
            <p className="mb-0 mt-2 text-xs text-slate-500">The destination is snapshotted when each request is submitted.</p>
          </div>
        </section>

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
