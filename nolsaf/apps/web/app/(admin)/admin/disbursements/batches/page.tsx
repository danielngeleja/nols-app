"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Layers, Loader2, PlusCircle, RefreshCw, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useAdminHref } from "@/lib/adminRecordRefs";

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
  /** MANUAL: formed and released by admins. AUTO: formed and authorized by the system under the daily limit. */
  mode?: "MANUAL" | "AUTO";
};

function money(value: string, currency: string) {
  if (currency === "MIXED") return `${currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
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
  const recordHref = useAdminHref();
  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [abandonedCount, setAbandonedCount] = useState(0);
  // Closed shells are hidden by default so they never compete with live
  // batches for the 100 rows the API returns.
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forming, setForming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("");

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

  const STAGE: Record<string, { label: string; hint: string; tone: string; dot: string }> = {
    DRAFT: { label: "Needs authorization", hint: "Formed, waiting for a finance approver", tone: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
    AUTHORIZED: { label: "Sending", hint: "Released to AzamPay", tone: "bg-sky-50 text-sky-800 ring-sky-200", dot: "bg-sky-500" },
    PROCESSING: { label: "Provider settling", hint: "AzamPay is paying out", tone: "bg-sky-50 text-sky-800 ring-sky-200", dot: "bg-sky-500" },
    COMPLETED: { label: "Completed", hint: "Every payout settled", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500" },
    SECURITY_REVIEW: { label: "Security review", hint: "Frozen by an integrity check", tone: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-500" },
    ABANDONED: { label: "Closed", hint: "Cleared and re-queued", tone: "bg-neutral-100 text-neutral-600 ring-neutral-200", dot: "bg-neutral-400" },
  };
  const stageOf = (status: string) => STAGE[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), hint: "", tone: "bg-neutral-100 text-neutral-600 ring-neutral-200", dot: "bg-neutral-400" };
  const eat = (iso: string) => `${new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} EAT`;

  const count = (statuses: string[]) => batches.filter((b) => statuses.includes(b.status));
  const sumOf = (list: BatchListItem[]) => {
    const byCurrency = new Map<string, number>();
    for (const b of list) byCurrency.set(b.currency, (byCurrency.get(b.currency) ?? 0) + Number(b.totalAmount || 0));
    return [...byCurrency.entries()].map(([currency, value]) => money(String(value), currency)).join(" + ") || "Nothing";
  };
  const waiting = count(["DRAFT"]);
  const sending = count(["AUTHORIZED", "PROCESSING"]);
  const review = count(["SECURITY_REVIEW"]);
  const done = count(["COMPLETED"]);

  const tabs = [
    { key: "", label: "All active", items: batches },
    { key: "DRAFT", label: "Needs authorization", items: waiting },
    { key: "SENDING", label: "Sending", items: sending },
    { key: "SECURITY_REVIEW", label: "Security review", items: review },
    { key: "COMPLETED", label: "Completed", items: done },
  ];
  const shown = showAbandoned ? batches : (tabs.find((t) => t.key === tab)?.items ?? batches);

  return (
    <div id="disbursement-batches" className="w-full min-w-0 space-y-4">
      <style>{`#disbursement-batches, #disbursement-batches * { box-sizing: border-box; }`}</style>

      {/* Dark band: what a batch is, live totals, and the one action */}
      <section className="overflow-hidden rounded-xl bg-[#012a26] text-white">
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-[#5eead4] ring-1 ring-inset ring-white/10"><Layers className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0">
              <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#5eead4]">Disbursement batches</p>
              <h1 className="m-0 mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">Batches</h1>
              <p className="m-0 mt-0.5 text-xs text-white/60 sm:text-sm">Approved payouts are re-checked and grouped here. Authorizing a batch is the only step that sends money to AzamPay.</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh batches" title="Refresh" className="grid h-10 w-10 place-items-center rounded-lg border border-solid border-white/15 bg-transparent text-white/80 hover:bg-white/[0.06] disabled:opacity-40">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
            <button type="button" disabled={forming} onClick={() => void formBatch()} className="inline-flex h-10 items-center gap-1.5 rounded-lg border-0 bg-[#5eead4] px-4 text-xs font-bold text-[#012a26] hover:bg-[#8ff3e1] disabled:opacity-60">
              {forming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlusCircle className="h-4 w-4" aria-hidden />} Form batch from approved
            </button>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-2 border-0 border-t border-solid border-white/10 lg:grid-cols-4">
          {[
            { label: "Needs authorization", items: waiting, tone: waiting.length ? "text-amber-300" : "text-white" },
            { label: "Sending now", items: sending, tone: "text-white" },
            { label: "Security review", items: review, tone: review.length ? "text-rose-300" : "text-white" },
            { label: "Completed", items: done, tone: "text-[#5eead4]" },
          ].map((stat, index) => (
            <div key={stat.label} className={`px-5 py-3.5 sm:px-6 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10" : ""} ${index >= 2 ? "border-0 border-t border-solid border-white/10 lg:border-t-0" : ""} ${index === 2 ? "lg:border-l" : ""}`}>
              <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/50">{stat.label}</dt>
              <dd className={`m-0 mt-0.5 text-lg font-extrabold tabular-nums ${stat.tone}`}>{loading ? "…" : stat.items.length}</dd>
              <p className="m-0 truncate text-[11px] text-white/50">{loading ? "" : stat.items.length ? sumOf(stat.items) : "None right now"}</p>
            </div>
          ))}
        </dl>
      </section>

      {error && <div className="rounded-lg border border-solid border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}
      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{notice}
        </div>
      )}

      {/* How a batch moves */}
      <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
        {[
          { n: 1, title: "Form", body: "Approved payouts are re-verified, fingerprinted and grouped, one batch per currency." },
          { n: 2, title: "Authorize", body: "A finance approver checks the total and releases it with their one-time code." },
          { n: 3, title: "Provider pays", body: "AzamPay sends each payout. Results come back and the batch completes." },
        ].map((step) => (
          <li key={step.n} className="flex items-start gap-3 rounded-xl border border-solid border-neutral-200 bg-white p-3.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#012a26] text-xs font-bold text-[#5eead4]">{step.n}</span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-neutral-900">{step.title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-neutral-500">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>

      <section className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 sm:px-4">
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {showAbandoned ? (
              <span className="-mb-px inline-flex h-11 items-center border-0 border-b-2 border-solid border-neutral-700 px-3 text-sm font-semibold text-neutral-800">Closed batches</span>
            ) : (
              tabs.map((item) => {
                const active = tab === item.key;
                return (
                  <button key={item.key || "all"} type="button" role="tab" aria-selected={active} onClick={() => setTab(item.key)}
                    className={`-mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-semibold ${active ? "border-[#02665e] text-[#02665e]" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
                    {item.label}
                    <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${active ? "bg-[#02665e] text-white" : "bg-neutral-100 text-neutral-500"}`}>{item.items.length}</span>
                  </button>
                );
              })
            )}
          </div>
          {(abandonedCount > 0 || showAbandoned) && (
            <button type="button" onClick={() => setShowAbandoned((previous) => !previous)} disabled={loading} className="border-0 bg-transparent p-0 text-xs font-bold text-[#02665e] hover:underline disabled:opacity-40">
              {showAbandoned ? "Back to active batches" : `Show ${abandonedCount} closed`}
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg bg-neutral-50" />)}</div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#012a26] text-[#5eead4]"><ShieldCheck className="h-5 w-5" aria-hidden /></span>
            <p className="m-0 mt-3 text-sm font-bold text-neutral-900">{showAbandoned ? "No closed batches" : tab ? "Nothing here right now" : "No batches yet"}</p>
            <p className="m-0 mt-1 max-w-md text-xs leading-5 text-neutral-500">
              {showAbandoned ? "No frozen batch has been fully cleared out." : "When payouts are approved in the Queue, form a batch to group them for authorization."}
            </p>
            {!showAbandoned && !tab && (
              <button type="button" disabled={forming} onClick={() => void formBatch()} className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-4 text-xs font-bold text-white hover:bg-[#014d47] disabled:opacity-60">
                {forming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlusCircle className="h-4 w-4" aria-hidden />} Form batch from approved
              </button>
            )}
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {shown.map((batch) => {
              const stage = stageOf(batch.status);
              return (
                <li key={batch.id} className="border-0 border-t border-solid border-neutral-100 first:border-t-0">
                  <Link href={recordHref("disbursement-batch", batch.id)} className="group flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3.5 no-underline transition hover:bg-neutral-50 hover:no-underline sm:px-5">
                    <span className="flex min-w-0 flex-1 items-center gap-3" style={{ minWidth: 220 }}>
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stage.dot}`} aria-hidden />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold text-neutral-950">{batch.batchReference}</span>
                          {batch.mode === "AUTO" && <span className="rounded bg-[#02665e]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#02665e]" title="Formed and authorized by the system under the daily automatic payout limit">Automatic</span>}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-neutral-500">Formed {eat(batch.createdAt)} by {batch.mode === "AUTO" ? "System" : actorLabel(batch.formedBy)}</span>
                      </span>
                    </span>
                    <span className="w-44 shrink-0">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${stage.tone}`}>{stage.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                        {batch.status === "DRAFT" ? stage.hint : batch.mode === "AUTO" ? (batch.authorizedAt ? "Authorized by System" : "Waiting for daily limit") : batch.authorizedBy ? `Authorized by ${actorLabel(batch.authorizedBy)}` : stage.hint}
                      </span>
                    </span>
                    <span className="w-20 shrink-0 text-right">
                      <span className="block text-sm font-bold tabular-nums text-neutral-900">{batch._count.items}</span>
                      <span className="block text-[11px] text-neutral-400">payout{batch._count.items === 1 ? "" : "s"}</span>
                    </span>
                    <span className="w-40 shrink-0 text-right">
                      <span className="block text-sm font-extrabold tabular-nums text-neutral-950">{money(batch.totalAmount, batch.currency)}</span>
                      <span className="block text-[11px] text-neutral-400">total</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
