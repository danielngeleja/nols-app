"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AdminRecordGate from "@/components/admin/AdminRecordGate";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Check, CheckCircle2, Layers, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
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
  mode?: "MANUAL" | "AUTO";
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

const STATUS_META: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Awaiting release", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  AUTHORIZED: { label: "Released", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  PROCESSING: { label: "Sending", tone: "border-sky-200 bg-sky-50 text-sky-800" },
  COMPLETED: { label: "Completed", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  SECURITY_REVIEW: { label: "Security review", tone: "border-red-200 bg-red-50 text-red-700" },
  ABANDONED: { label: "Closed", tone: "border-neutral-200 bg-neutral-50 text-neutral-600" },
};

const LIFECYCLE = [
  { key: "DRAFT", label: "Formed" },
  { key: "AUTHORIZED", label: "Released" },
  { key: "PROCESSING", label: "Sending" },
  { key: "COMPLETED", label: "Completed" },
];

const RISK_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** Admin times are shown in Tanzania time, whatever the browser's zone. */
function eat(value: string) {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value))} EAT`;
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function highestRisk(items: BatchItem[]) {
  return items.reduce<string | null>((top, item) => {
    if (!item.riskLevel) return top;
    return !top || RISK_ORDER.indexOf(item.riskLevel) > RISK_ORDER.indexOf(top) ? item.riskLevel : top;
  }, null);
}

function destinationSummary(items: BatchItem[]) {
  const providers = [...new Set(items.map((item) => item.payoutAccount.provider).filter(Boolean))];
  if (!providers.length) return "None";
  return providers.length <= 2 ? providers.join(", ") : `${providers.length} providers`;
}

function Lifecycle({ status }: { status: string }) {
  if (status === "SECURITY_REVIEW" || status === "ABANDONED") return null;
  const current = LIFECYCLE.findIndex((step) => step.key === status);
  return (
    <ol className="m-0 mt-5 grid list-none grid-cols-4 gap-2 p-0">
      {LIFECYCLE.map((step, index) => {
        const reached = index <= current;
        return (
          <li key={step.key} className="min-w-0">
            <div className={`h-1 rounded-full ${reached ? "bg-emerald-600" : "bg-neutral-200"}`} />
            <p className={`m-0 mt-1.5 truncate text-[11px] font-bold ${index === current ? "text-emerald-800" : reached ? "text-neutral-600" : "text-neutral-400"}`}>
              {step.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 bg-white px-3 py-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">{label}</dt>
      <dd className="m-0 mt-0.5 truncate text-sm font-semibold text-neutral-900" title={value}>{value}</dd>
      {sub && <dd className="m-0 truncate text-[11px] text-neutral-500">{sub}</dd>}
    </div>
  );
}

function StepDot({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${done ? "bg-emerald-600 text-white" : "border border-solid border-neutral-300 bg-white text-neutral-500"}`}>
      {done ? <Check className="h-3 w-3" /> : n}
    </span>
  );
}

const NOTE_TONES = {
  emerald: "text-emerald-800 [&_svg]:text-emerald-700",
  amber: "text-amber-800 [&_svg]:text-amber-700",
  red: "text-red-700 [&_svg]:text-red-600",
  neutral: "text-neutral-700 [&_svg]:text-neutral-500",
};

function PanelNote({ icon, tone, title, children }: { icon: ReactNode; tone: keyof typeof NOTE_TONES; title: string; children: ReactNode }) {
  return (
    <div className={NOTE_TONES[tone]}>
      <p className="m-0 flex items-center gap-2 text-sm font-bold">{icon}{title}</p>
      <p className="mb-0 mt-1.5 text-xs leading-5 text-neutral-600">{children}</p>
    </div>
  );
}

function errorMessage(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) {
    return "Finance OTP verification is required. Complete it in the verification panel, then retry.";
  }
  return cause?.response?.data?.error || fallback;
}

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <AdminRecordGate kind="disbursement-batch" param={params?.id} backHref="/admin/disbursements/batches">
      {(batchId) => <BatchDetail batchId={batchId} />}
    </AdminRecordGate>
  );
}

function BatchDetail({ batchId }: { batchId: number }) {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [release, setRelease] = useState<ReleaseAuthority | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [releaseCode, setReleaseCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeHint, setCodeHint] = useState("");
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // One tick a second only while a code is live, for the expiry and resend timers.
  useEffect(() => {
    if (!codeSent) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [codeSent]);
  const secondsLeft = codeExpiresAt ? Math.max(0, Math.ceil((codeExpiresAt - now) / 1000)) : 0;
  // The API refuses a resend inside 30 seconds; count it down instead of letting the click fail.
  const resendIn = codeSentAt ? Math.max(0, 30 - Math.floor((now - codeSentAt) / 1000)) : 0;

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

  const resetCode = () => {
    setReleaseCode("");
    setCodeSent(false);
    setCodeSentAt(null);
    setCodeExpiresAt(null);
  };

  // Sends the single-use code that lets this admin release a batch they
  // formed or approved into. Only reachable when the API says a challenge is
  // required, so a two-person release never sees this step.
  const sendReleaseCode = async () => {
    setSendingCode(true);
    setError("");
    setNotice("");
    try {
      const response = await apiClient.post(`/api/admin/disbursements/batches/${batchId}/release-challenge`);
      const sentAt = Date.now();
      const expires = Date.parse(response.data?.expiresAt);
      setCodeSent(true);
      setCodeSentAt(sentAt);
      setNow(sentAt);
      setCodeExpiresAt(Number.isFinite(expires) ? expires : sentAt + 10 * 60 * 1000);
      setCodeHint(response.data?.hint || "Sent to the email or phone on your admin account.");
      setReleaseCode("");
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
      resetCode();
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not authorize this batch."));
      // A spent or rejected code cannot be retried; make the admin fetch a
      // fresh one rather than letting them retype into a dead field.
      if (cause?.response?.data?.challengeRequired) resetCode();
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

      <section className="grid gap-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Summary: what this batch is and where it stands. */}
        <div className="min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Layers className="h-4 w-4" /></span>
            <span className="font-mono text-xs text-neutral-500">{batch.batchReference}</span>
            <span className={`rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${STATUS_META[batch.status]?.tone || "border-neutral-200 bg-neutral-50 text-neutral-600"}`}>
              {STATUS_META[batch.status]?.label || batch.status}
            </span>
            <span className="rounded-full border border-solid border-neutral-200 bg-white px-2 py-0.5 text-[10px] font-bold text-neutral-500">
              {batch.mode === "AUTO" ? "Automatic" : "Manual"}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="m-0 whitespace-nowrap text-3xl font-bold tracking-tight text-neutral-950">{money(batch.totalAmount, batch.currency)}</h1>
            <span className="whitespace-nowrap text-sm font-semibold text-neutral-500">
              {batch.itemCount} {batch.itemCount === 1 ? "payout" : "payouts"}
            </span>
          </div>
          {/* itemCount and totalAmount are frozen at formation; items is the
              live relation. Once payouts are cleared out of a frozen batch
              the two disagree, so say so rather than showing a headline
              figure above an empty table. */}
          {batch.items.length !== batch.itemCount && (
            <p className="mb-0 mt-1 text-xs text-neutral-500">
              {batch.itemCount - batch.items.length} of these were cleared out and re-queued. The total is what the batch held when it was formed.
            </p>
          )}

          <Lifecycle status={batch.status} />

          <dl className="m-0 mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-100 bg-neutral-100 sm:grid-cols-4">
            <Fact label="Formed by" value={batch.mode === "AUTO" ? "System" : batch.formedBy?.name || batch.formedBy?.email || "Unknown"} sub={eat(batch.createdAt)} />
            <Fact
              label="Authorized"
              value={batch.authorizedBy ? batch.authorizedBy.name || batch.authorizedBy.email || "Admin" : "Not yet"}
              sub={batch.authorizedAt ? eat(batch.authorizedAt) : undefined}
            />
            <Fact label="Destinations" value={destinationSummary(batch.items)} />
            <Fact label="Highest risk" value={highestRisk(batch.items) || "None flagged"} />
          </dl>
        </div>

        {/* Action: the one thing this admin can do next. */}
        <aside className="border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 p-5 sm:p-6 lg:border-l lg:border-t-0">
          {batch.status === "DRAFT" && batch.mode === "AUTO" && (
            <PanelNote icon={<BadgeCheck className="h-4 w-4" />} tone="emerald" title="Released by the system">
              The system authorizes this batch when today&apos;s automatic payout limit allows. Admins do not release it.
            </PanelNote>
          )}
          {batch.status === "DRAFT" && batch.mode !== "AUTO" && release?.blocked && (
            <PanelNote icon={<ShieldAlert className="h-4 w-4" />} tone="amber" title="Another admin must release this">
              You {release.formedByActor ? "formed this batch" : "approved payouts in it"}, and two-person release is on. Ask a different finance admin to authorize it.
            </PanelNote>
          )}
          {batch.status === "DRAFT" && batch.mode !== "AUTO" && !release?.blocked && (
            <div className="flex h-full flex-col">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">Release this batch</p>
              {release?.challengeRequired ? (
                <>
                  <p className="mb-0 mt-1.5 text-xs leading-5 text-neutral-500">
                    You {release.formedByActor ? "formed this batch" : "approved payouts in it"}, so releasing it needs a one-time code.
                  </p>
                  <ol className="m-0 mt-4 list-none space-y-3 p-0">
                    <li className="flex gap-2.5">
                      <StepDot n={1} done={codeSent} />
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-xs font-bold text-neutral-800">Get a code</p>
                        {codeSent && codeExpiresAt ? (
                          <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">
                            {codeHint} {secondsLeft > 0 ? <>Expires in <span className="font-mono font-bold text-neutral-700">{clock(secondsLeft)}</span>.</> : <span className="font-bold text-red-600">Expired, send a new one.</span>}
                          </p>
                        ) : (
                          <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Sent to the email or phone on your admin account.</p>
                        )}
                        <button
                          type="button"
                          disabled={sendingCode || busy || resendIn > 0}
                          onClick={() => void sendReleaseCode()}
                          className={`${actionClass} mt-2 border-solid`}
                        >
                          {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                          {!codeSent ? "Send code" : resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                        </button>
                      </div>
                    </li>
                    <li className="flex gap-2.5">
                      <StepDot n={2} done={releaseCode.length === 6} />
                      <div className="min-w-0 flex-1">
                        <label htmlFor="batch-release-code" className="m-0 block text-xs font-bold text-neutral-800">Enter the code</label>
                        <input
                          id="batch-release-code"
                          value={releaseCode}
                          onChange={(e) => setReleaseCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          onKeyDown={(e) => { if (e.key === "Enter" && releaseCode.length === 6 && !busy) void authorize(); }}
                          disabled={!codeSent || busy}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="000000"
                          className="mt-2 w-full rounded-xl border border-solid border-neutral-200 bg-white px-3 py-2 text-center font-mono text-lg tracking-[0.4em] text-neutral-900 outline-none transition placeholder:text-neutral-300 focus:border-emerald-400 disabled:bg-neutral-100 disabled:text-neutral-400"
                        />
                      </div>
                    </li>
                  </ol>
                </>
              ) : (
                <p className="mb-0 mt-1.5 text-xs leading-5 text-neutral-500">
                  Another admin formed this batch, so you can release it directly.
                </p>
              )}
              <button
                type="button"
                disabled={busy || (release?.challengeRequired === true && (releaseCode.length !== 6 || secondsLeft <= 0))}
                onClick={() => void authorize()}
                className={`${actionClass} mt-4 w-full border-solid !border-emerald-700 !bg-emerald-700 !text-white !min-h-10 !text-sm`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                Release {money(batch.totalAmount, batch.currency)}
              </button>
              <p className="mb-0 mt-2 text-[11px] leading-4 text-neutral-400">
                Payout accounts are re-checked first. If anything changed since the batch was formed, it freezes to Security Review instead of sending.
              </p>
            </div>
          )}
          {batch.status === "AUTHORIZED" && (
            <PanelNote icon={<BadgeCheck className="h-4 w-4" />} tone="emerald" title="Queued for sending">
              Released. Sending to AzamPay starts within a minute; refresh to watch each payout move.
            </PanelNote>
          )}
          {batch.status === "PROCESSING" && (
            <PanelNote icon={<Loader2 className="h-4 w-4 animate-spin" />} tone="emerald" title="Sending to AzamPay">
              Each payout settles when AzamPay confirms it. Results show in the table below.
            </PanelNote>
          )}
          {batch.status === "COMPLETED" && (
            <PanelNote icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" title="Finished">
              Every payout in this batch reached a final result. Check the table for any that failed.
            </PanelNote>
          )}
          {batch.status === "SECURITY_REVIEW" && (
            <PanelNote icon={<ShieldAlert className="h-4 w-4" />} tone="red" title="Frozen for security review">
              A payout account changed after this batch was formed, so nothing was sent.{" "}
              <Link href="/admin/disbursements/security-review" className="font-bold text-red-700">Open Security Review</Link>
            </PanelNote>
          )}
          {batch.status === "ABANDONED" && (
            <PanelNote icon={<ShieldCheck className="h-4 w-4" />} tone="neutral" title="Closed">
              Every payout this batch held was cleared and re-queued into a new batch, so nothing here is pending.
            </PanelNote>
          )}
        </aside>
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
    </div>
  );
}
