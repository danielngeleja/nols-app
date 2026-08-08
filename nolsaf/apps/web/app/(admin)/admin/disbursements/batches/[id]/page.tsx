"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, BadgeCheck, CheckCircle2, Layers, Loader2, ShieldAlert } from "lucide-react";
import apiClient from "@/lib/apiClient";

type BatchItem = {
  id: number;
  externalReferenceId: string;
  amount: string;
  currency: string;
  status: string;
  riskLevel: string | null;
  riskFlags: string[] | null;
  sourceType: string;
  sourceId: number;
  payoutAccount: { accountName: string; accountNumber: string; provider: string };
};

type BatchDetail = {
  id: number;
  batchReference: string;
  status: string;
  totalAmount: string;
  currency: string;
  itemCount: number;
  batchFingerprint: string;
  createdAt: string;
  authorizedAt: string | null;
  formedBy: { name: string | null; email: string | null } | null;
  authorizedBy: { name: string | null; email: string | null } | null;
  items: BatchItem[];
};

/**
 * How this admin is allowed to release this batch. Two-person release needs
 * nothing extra; releasing your own batch needs a single-use code tied to
 * this batch, sent to the admin's registered email or phone.
 */
type ReleaseAuthority = {
  isSelfRelease: boolean;
  formedByActor: boolean;
  approvedByActorCount: number;
  twoPersonRequired: boolean;
  challengeRequired: boolean;
  blocked: boolean;
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

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  const batchId = Number(params?.id);
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [release, setRelease] = useState<ReleaseAuthority | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [releaseCode, setReleaseCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get(`/api/admin/disbursements/batches/${batchId}`);
      setBatch(response.data?.batch || null);
      setRelease(response.data?.release || null);
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not load this batch."));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { if (Number.isInteger(batchId)) void load(); }, [batchId, load]);

  // Sends the single-use code that lets this admin release a batch they
  // formed or approved into. Only reachable when the API says a challenge is
  // required, so a two-person release never sees this step.
  const sendReleaseCode = async () => {
    setSendingCode(true);
    setError("");
    setNotice("");
    try {
      const response = await apiClient.post(`/api/admin/disbursements/batches/${batchId}/release-challenge`);
      setCodeSent(true);
      setNotice(response.data?.hint || "Release code sent. Check your registered email or phone.");
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not send a release code."));
    } finally {
      setSendingCode(false);
    }
  };

  const authorize = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiClient.post(`/api/admin/disbursements/batches/${batchId}/authorize`, {
        ...(release?.challengeRequired ? { releaseCode } : {}),
      });
      // Authorization is the decision only. A background worker performs the
      // submission, so a slow batch can no longer be cut short by an HTTP
      // timeout partway through. Refresh to watch the items move.
      setNotice(
        response.data?.message ||
          "Batch authorized. Submission to AzamPay runs in the background and starts within a minute."
      );
      setReleaseCode("");
      setCodeSent(false);
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not authorize this batch."));
      // A spent or rejected code cannot be retried; make the admin fetch a
      // fresh one rather than letting them retype into a dead field.
      if (cause?.response?.data?.challengeRequired) {
        setReleaseCode("");
        setCodeSent(false);
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="grid min-h-56 place-items-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!batch) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error || "Batch not found."}</div>;
  }

  return (
    <div id="disbursement-batch-detail" className="mx-auto w-full max-w-6xl space-y-4">
      <style>{`#disbursement-batch-detail, #disbursement-batch-detail * { box-sizing: border-box; }`}</style>

      <Link href="/admin/disbursements/batches" className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-500 no-underline hover:text-emerald-700">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to batches
      </Link>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Layers className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 font-mono text-[11px] text-neutral-500">{batch.batchReference}</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">{money(batch.totalAmount, batch.currency)} · {batch.itemCount} item(s)</h1>
              <p className="mb-0 mt-1 text-xs text-neutral-500">
                Status <span className="font-bold text-neutral-700">{batch.status}</span> · Formed by {batch.formedBy?.name || batch.formedBy?.email || "n/a"}
                {batch.authorizedBy && <> · Authorized by {batch.authorizedBy.name || batch.authorizedBy.email}</>}
              </p>
            </div>
          </div>
          {batch.status === "DRAFT" && release?.blocked && (
            <span className="inline-flex max-w-sm items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              You {release.formedByActor ? "formed this batch" : "approved payouts in this batch"}. Two-person release is required here, so a different admin must authorize it.
            </span>
          )}
          {batch.status === "DRAFT" && !release?.blocked && (
            <div className="flex flex-col items-stretch gap-2 lg:items-end">
              {release?.challengeRequired && (
                <div className="rounded-xl border border-solid border-amber-200 bg-amber-50 p-3">
                  <p className="m-0 flex items-start gap-1.5 text-[11px] font-bold text-amber-800">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    You {release.formedByActor ? "formed this batch" : "approved payouts in this batch"}. Releasing your own
                    batch needs a one-time code sent to your registered email or phone.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" disabled={sendingCode || busy} onClick={() => void sendReleaseCode()} className={actionClass}>
                      {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                      {codeSent ? "Resend code" : "Send release code"}
                    </button>
                    <input
                      value={releaseCode}
                      onChange={(e) => setReleaseCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      placeholder="6-digit code"
                      className="w-32 rounded-xl border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-center font-mono text-sm tracking-[0.3em] text-neutral-800 outline-none transition focus:border-emerald-300"
                    />
                  </div>
                </div>
              )}
              <button
                type="button"
                disabled={busy || (release?.challengeRequired === true && releaseCode.length !== 6)}
                onClick={() => void authorize()}
                className={`${actionClass} !border-emerald-700 !bg-emerald-700 !text-white`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                Authorize &amp; release
              </button>
            </div>
          )}
          {batch.status === "SECURITY_REVIEW" && (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
              <ShieldAlert className="h-4 w-4" /> Fingerprint mismatch, frozen. See Security Review
            </span>
          )}
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50/70 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                <th className="px-4 py-3 font-bold">Reference</th>
                <th className="px-4 py-3 font-bold">Source</th>
                <th className="px-4 py-3 font-bold">Payout account</th>
                <th className="px-4 py-3 text-right font-bold">Amount</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 font-bold">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {batch.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-950">{item.externalReferenceId}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{item.sourceType} #{item.sourceId}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>{item.payoutAccount.accountName}</div>
                    <div className="text-slate-400">{item.payoutAccount.provider} · {item.payoutAccount.accountNumber}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-slate-950">{money(item.amount, item.currency)}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-700">{item.status}</td>
                  <td className="px-4 py-3">
                    {item.riskLevel ? (
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${riskClass(item.riskLevel)}`} title={item.riskFlags?.join(", ")}>
                        {item.riskLevel}
                      </span>
                    ) : (
                      <span className="text-[10px] text-neutral-400">n/a</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {batch.status === "DRAFT" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Authorizing recomputes this batch's fingerprint. If anything changed since formation, the batch and every item freeze to Security Review instead of submitting.</span>
        </div>
      )}
    </div>
  );
}
