"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";

type FlaggedItem = {
  id: number;
  externalReferenceId: string;
  amount: string;
  currency: string;
  sourceType: string;
  sourceId: number;
  riskLevel: string | null;
  riskFlags: string[] | null;
  securityReviewReason: string | null;
  updatedAt: string;
  payoutAccount: { accountName: string; accountNumber: string; provider: string };
};

const actionClass =
  "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40";

function money(value: string, currency: string) {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function riskClass(level: string | null) {
  if (level === "HIGH" || level === "CRITICAL") return "border-red-100 bg-red-50 text-red-700";
  if (level === "MEDIUM") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-neutral-200 bg-neutral-100 text-neutral-500";
}

function errorMessage(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) {
    return "Finance OTP verification is required. Complete it in the verification panel, then retry.";
  }
  return cause?.response?.data?.error || fallback;
}

export default function SecurityReviewPage() {
  const [items, setItems] = useState<FlaggedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/admin/disbursements/security-review");
      setItems(response.data?.disbursements || []);
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not load security review items."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Clearing a hold is the one action that puts a flagged payout back into the
  // money pipeline, so the reason is recorded with it and cannot be skipped.
  // The API rejects a note under 10 characters, and rejects the clear outright
  // when the caller is the admin who approved the payout.
  const clear = async (id: number) => {
    const note = (notes[id] || "").trim();
    if (note.length < 10) {
      setError(`Write what you confirmed out of band before clearing disbursement #${id} (at least 10 characters).`);
      return;
    }
    setBusy(String(id));
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/disbursements/${id}/security-review/clear`, { note });
      setNotice(`Disbursement #${id} cleared and returned to APPROVED for the next batch.`);
      setNotes((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, `Could not clear disbursement #${id}.`));
    } finally {
      setBusy("");
    }
  };

  return (
    <div id="disbursement-security-review" className="mx-auto w-full max-w-6xl space-y-4">
      <style>{`#disbursement-security-review, #disbursement-security-review * { box-sizing: border-box; }`}</style>

      <section className="relative overflow-hidden rounded-2xl border border-red-100 bg-[linear-gradient(135deg,#ffffff_0%,#fdf5f4_58%,#fbeceb_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(153,17,17,0.25)] sm:p-6">
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-red-100 bg-white text-red-700 shadow-sm"><ShieldAlert className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-red-700">Fraud controls</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Security Review</h1>
              <p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-neutral-500 sm:text-sm">
                Payouts held back from batching. Clearing an item returns it to APPROVED for the next batch, so confirm the flagged reason no longer
                applies before you do.
              </p>
            </div>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className={`${actionClass} h-10 w-10 shrink-0 px-0`} aria-label="Refresh" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="relative mt-4 grid gap-2 sm:grid-cols-3">
          {[
            { title: "Failed re-verification", detail: "AzamPay Name Lookup no longer matches the locked account." },
            { title: "Fingerprint mismatch", detail: "A financial field changed after approval." },
            { title: "High / critical risk", detail: "Risk score too high to batch automatically." },
          ].map((reason) => (
            <div key={reason.title} className="rounded-xl border border-red-100 bg-white/70 p-3">
              <p className="m-0 text-[11px] font-bold text-red-800">{reason.title}</p>
              <p className="mb-0 mt-0.5 text-[11px] leading-4 text-neutral-500">{reason.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        {loading ? (
          <div className="grid min-h-56 place-items-center text-neutral-400">
            <div className="text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <p className="mb-0 mt-2 text-xs">Loading</p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><ShieldCheck className="h-5 w-5" /></span>
              <p className="mb-0 mt-3 text-sm font-bold text-neutral-800">Nothing flagged</p>
              <p className="mb-0 mt-1 text-xs text-neutral-500">Every approved payout is clean and either batched or waiting to be.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50/70 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                  <th className="px-4 py-3 font-bold">Reference</th>
                  <th className="px-4 py-3 font-bold">Source</th>
                  <th className="px-4 py-3 font-bold">Payout account</th>
                  <th className="px-4 py-3 text-right font-bold">Amount</th>
                  <th className="px-4 py-3 font-bold">Risk</th>
                  <th className="px-4 py-3 font-bold">Reason</th>
                  <th className="px-4 py-3 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3 font-mono text-xs text-neutral-950">{item.externalReferenceId}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{item.sourceType} #{item.sourceId}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{item.payoutAccount.accountName}</div>
                      <div className="text-slate-400">{item.payoutAccount.provider} · {item.payoutAccount.accountNumber}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-950">{money(item.amount, item.currency)}</td>
                    <td className="px-4 py-3">
                      {item.riskLevel ? (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${riskClass(item.riskLevel)}`}>{item.riskLevel}</span>
                      ) : (
                        <span className="text-[10px] text-neutral-400">n/a</span>
                      )}
                    </td>
                    <td className="max-w-[260px] px-4 py-3 text-xs text-neutral-600">{item.securityReviewReason || "n/a"}</td>
                    <td className="px-4 py-3">
                      <div className="flex w-[220px] flex-col gap-2">
                        <textarea
                          value={notes[item.id] || ""}
                          onChange={(e) => setNotes((previous) => ({ ...previous, [item.id]: e.target.value }))}
                          rows={2}
                          maxLength={300}
                          placeholder="What did you confirm, and how?"
                          className="w-full rounded-xl border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-700 outline-none transition focus:border-emerald-300"
                        />
                        <button
                          type="button"
                          disabled={!!busy || (notes[item.id] || "").trim().length < 10}
                          onClick={() => void clear(item.id)}
                          className={actionClass}
                        >
                          {busy === String(item.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                          Clear
                        </button>
                      </div>
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
