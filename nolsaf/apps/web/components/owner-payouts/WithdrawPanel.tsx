"use client";

import { useState } from "react";
import { Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { formatEat, formatTzs } from "./shared";

/**
 * Withdraw with a one-time code (Property Owner Disbursement Policy 5.1.3).
 * The code is requested only when the owner taps Withdraw, never sent on its
 * own, and is bound to this exact amount and payout account.
 */

type Challenge = {
  challengeRef: string;
  channel: "SMS" | "EMAIL";
  sentTo: string;
  expiresAt: string;
  total: number;
  grossTotal?: number;
  recoveryDeduction?: number;
  destination: string;
  count: number;
};

type ConfirmResult = {
  total: number;
  destination: string;
  autoCount?: number;
  manualCount?: number;
  recoveryDeduction?: number;
};

const RESEND_AFTER_MS = 60_000;
const ENDS_REQUEST = ["CHANGED", "EXPIRED", "ALREADY_USED", "TOO_MANY_ATTEMPTS", "OTP_LOCKED", "NOT_FOUND"];

function apiError(err: any, fallback: string): string {
  return err?.response?.data?.error || fallback;
}

function confirmationText(res: ConfirmResult): string {
  const auto = Number(res.autoCount ?? 0);
  const manual = Number(res.manualCount ?? 0);
  const recovered = Number(res.recoveryDeduction ?? 0);
  const recoveredNote = recovered > 0 ? ` ${formatTzs(recovered)} was used to settle an earlier refund.` : "";
  if (auto === 0 && manual === 0) return `Your ready payouts settled an earlier refund in full.${recoveredNote}`;
  const head = `${formatTzs(res.total)} to ${res.destination} confirmed.`;
  if (manual === 0) return `${head} It is being sent now and normally arrives within minutes.${recoveredNote}`;
  if (auto === 0) return `${head} Our payments team pays it, normally within 24 hours.${recoveredNote}`;
  return `${head} ${auto} payout(s) are being sent now; ${manual} go to our payments team and are normally paid within 24 hours.${recoveredNote}`;
}

export default function WithdrawPanel({
  readyTotal,
  readyCount,
  recoveryDue,
  onDone,
}: {
  readyTotal: number;
  readyCount: number;
  recoveryDue: number;
  onDone: () => void;
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportLocked, setSupportLocked] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const sendable = Math.max(0, readyTotal - Math.min(recoveryDue, readyTotal));

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    setSupportLocked(false);
    setDone(null);
    try {
      const res = await apiClient.post<Challenge>("/api/owner/payouts/withdraw/challenge", {});
      setChallenge(res.data);
      setSentAt(Date.now());
      setCode("");
      // Re-render once the resend wait is over.
      setTimeout(() => setTick((t) => t + 1), RESEND_AFTER_MS);
    } catch (err: any) {
      setError(apiError(err, "Your withdrawal code could not be sent. Try again."));
      setSupportLocked(err?.response?.data?.code === "OTP_LOCKED");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!challenge) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<ConfirmResult>("/api/owner/payouts/withdraw/confirm", {
        challengeRef: challenge.challengeRef,
        code,
      });
      setChallenge(null);
      setCode("");
      setDone(confirmationText(res.data));
      onDone();
    } catch (err: any) {
      const remaining = err?.response?.data?.attemptsRemaining;
      const base = apiError(err, "That code could not be confirmed. Try again.");
      setError(Number.isInteger(remaining) ? `${base} ${remaining} attempt${remaining === 1 ? "" : "s"} left before withdrawals are locked.` : base);
      setSupportLocked(err?.response?.data?.code === "OTP_LOCKED");
      if (ENDS_REQUEST.includes(err?.response?.data?.code)) {
        setChallenge(null);
        setCode("");
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {!challenge && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={requestCode}
            disabled={busy || readyCount === 0}
            className="inline-flex h-11 items-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LockKeyhole className="h-4 w-4" aria-hidden />}
            {busy ? "Sending code..." : readyCount === 0 ? "Nothing to withdraw yet" : `Withdraw ${formatTzs(sendable)}`}
          </button>
          {readyCount > 0 && <span className="text-xs text-slate-500">We send a one-time code to confirm it is you.</span>}
        </div>
      )}

      {challenge && (
        <div className="rounded-xl border border-solid border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 text-sm text-slate-700">
              <p className="m-0">
                Withdraw <strong className="text-slate-900">{formatTzs(challenge.total)}</strong> to{" "}
                <strong className="text-slate-900">{challenge.destination}</strong>
                {Number(challenge.recoveryDeduction ?? 0) > 0 && (
                  <> ({formatTzs(challenge.grossTotal)} ready, less {formatTzs(challenge.recoveryDeduction)} for an earlier refund)</>
                )}
                .
              </p>
              <p className="m-0 mt-1 text-xs text-slate-500">
                Code sent by {challenge.channel === "SMS" ? "SMS" : "email"} to {challenge.sentTo}. It expires at {formatEat(challenge.expiresAt)}.
                Never share it. NoLSAF staff will never ask for it.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label="Withdrawal code"
              placeholder="000000"
              className="box-border h-11 w-36 rounded-xl border border-solid border-slate-300 bg-white px-3 text-center text-lg tracking-[0.35em] text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
            />
            <button
              type="button"
              onClick={confirm}
              disabled={busy || code.length !== 6}
              className="inline-flex h-11 items-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Confirm withdrawal
            </button>
            <button
              type="button"
              onClick={requestCode}
              disabled={busy || Date.now() - sentAt < RESEND_AFTER_MS}
              className="inline-flex h-11 items-center rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Resend code
            </button>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setCode("");
                setError(null);
              }}
              className="inline-flex h-11 items-center rounded-xl border-0 bg-transparent px-2 text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <p className="m-0 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          {done}
        </p>
      )}
      {error && (
        <p className="m-0 text-sm text-rose-700" role="alert">
          {error}{supportLocked && <> <a href="/owner/support" className="font-semibold underline">Contact NoLSAF support</a>.</>}
        </p>
      )}
    </div>
  );
}
