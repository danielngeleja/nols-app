"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Layers, Loader2, PlusCircle, RefreshCw, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";

type BatchListItem = {
  id: number;
  batchReference: string;
  status: string;
  totalAmount: string;
  currency: string;
  itemCount: number;
  createdAt: string;
  authorizedAt: string | null;
  formedBy: { id: number; name: string | null; email: string | null } | null;
  authorizedBy: { id: number; name: string | null; email: string | null } | null;
  _count: { items: number };
};

const actionClass =
  "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40";

function money(value: string, currency: string) {
  if (currency === "MIXED") return `${currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function statusClass(status: string) {
  if (status === "AUTHORIZED" || status === "PROCESSING") return "border-sky-100 bg-sky-50 text-sky-700";
  if (status === "SECURITY_REVIEW") return "border-red-100 bg-red-50 text-red-700";
  if (status === "COMPLETED") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  // ABANDONED is a closed empty shell, not live work: keep it visually quiet.
  if (status === "ABANDONED") return "border-neutral-200 bg-neutral-100 text-neutral-500";
  return "border-amber-100 bg-amber-50 text-amber-700"; // DRAFT
}

function actorLabel(actor: { name: string | null; email: string | null } | null) {
  if (!actor) return "n/a";
  return actor.name || actor.email || "Unknown";
}

function errorMessage(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) {
    return "Finance OTP verification is required. Complete it in the verification panel, then retry.";
  }
  return cause?.response?.data?.error || fallback;
}

export default function DisbursementBatchesPage() {
  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [abandonedCount, setAbandonedCount] = useState(0);
  // Closed shells are hidden by default so they never compete with live
  // batches for the 100 rows the API returns.
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forming, setForming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/admin/disbursements/batches", {
        params: showAbandoned ? { status: "ABANDONED" } : undefined,
      });
      setBatches(response.data?.batches || []);
      setAbandonedCount(response.data?.abandonedCount || 0);
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not load batches."));
    } finally {
      setLoading(false);
    }
  }, [showAbandoned]);

  useEffect(() => { void load(); }, [load]);

  const formBatch = async () => {
    setForming(true);
    setError("");
    setNotice("");
    // A new batch is live work, so never leave the operator staring at the
    // closed-shell view after forming one.
    setShowAbandoned(false);
    try {
      const response = await apiClient.post("/api/admin/disbursements/batches");
      // One batch per currency: currencies are never mixed, because a mixed
      // total is a meaningless figure to ask a human to authorize.
      const formed: Array<{ batchReference: string; itemCount: number; currency: string }> = response.data?.batches || [];
      const excluded = response.data?.excluded || [];
      const deferred = response.data?.deferred || [];

      const tail =
        (excluded.length ? ` ${excluded.length} item(s) were held back to security review.` : "") +
        (deferred.length ? ` ${deferred.length} item(s) did not fit the batch limits and wait for the next one.` : "");

      if (formed.length) {
        setNotice(
          `Formed ${formed.map((b) => `${b.batchReference} (${b.itemCount} item(s), ${b.currency})`).join(", ")}.` + tail
        );
      } else if (excluded.length || deferred.length) {
        setNotice(`No batch formed.${tail}`);
      } else {
        setNotice("No APPROVED disbursements are waiting to be batched right now.");
      }
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not form a batch."));
    } finally {
      setForming(false);
    }
  };

  return (
    <div id="disbursement-batches" className="mx-auto w-full max-w-7xl space-y-4">
      <style>{`#disbursement-batches, #disbursement-batches * { box-sizing: border-box; }`}</style>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm">
              <Layers className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Batch security architecture</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Batches</h1>
              <p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-neutral-500 sm:text-sm">
                Approved payouts are re-verified, fingerprinted and grouped here automatically. Authorizing a batch is the one action that submits
                money to AzamPay.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" disabled={forming} onClick={() => void formBatch()} className={`${actionClass} !border-emerald-700 !bg-emerald-700 !text-white`}>
              {forming ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
              Form batch from approved
            </button>
            <button type="button" onClick={() => void load()} disabled={loading} className={`${actionClass} h-10 w-10 shrink-0 px-0`} aria-label="Refresh batches" title="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </div>
      )}

      {(abandonedCount > 0 || showAbandoned) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5">
          <p className="m-0 text-xs text-neutral-500">
            {showAbandoned
              ? "Showing closed batches. These were frozen at authorization and every payout in them has since been cleared and re-queued."
              : `${abandonedCount} closed batch(es) hidden. Nothing is pending in them, every payout was cleared and re-queued.`}
          </p>
          <button type="button" onClick={() => setShowAbandoned((previous) => !previous)} disabled={loading} className={actionClass}>
            {showAbandoned ? "Back to active batches" : "Show closed"}
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        {loading ? (
          <div className="grid min-h-56 place-items-center text-neutral-400">
            <div className="text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <p className="mb-0 mt-2 text-xs">Loading batches</p>
            </div>
          </div>
        ) : batches.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <p className="mb-0 mt-3 text-sm font-bold text-neutral-800">{showAbandoned ? "No closed batches" : "No batches yet"}</p>
              <p className="mb-0 mt-1 text-xs text-neutral-500">
                {showAbandoned ? "No frozen batch has been fully cleared out." : "Form one from any APPROVED, unbatched disbursements."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50/70 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                  <th className="px-4 py-3 font-bold">Reference</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 text-right font-bold">Items</th>
                  <th className="px-4 py-3 text-right font-bold">Total</th>
                  <th className="px-4 py-3 font-bold">Formed by</th>
                  <th className="px-4 py-3 font-bold">Authorized by</th>
                  <th className="px-4 py-3 font-bold">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {batches.map((batch) => (
                  <tr key={batch.id} className="align-top transition hover:bg-emerald-50/30">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-neutral-950">{batch.batchReference}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(batch.status)}`}>{batch.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-600">{batch._count.items}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-950">{money(batch.totalAmount, batch.currency)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{actorLabel(batch.formedBy)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{actorLabel(batch.authorizedBy)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{new Date(batch.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/disbursements/batches/${batch.id}`} className={`${actionClass} no-underline`}>
                        Open <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
