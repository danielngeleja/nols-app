"use client";

import { useEffect, useState } from "react";
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
  queuedCount: number;
  recoveryDeduction?: number;
};

const RESEND_AFTER_MS = 60_000;
const ENDS_REQUEST = ["CHANGED", "EXPIRED", "ALREADY_USED", "TOO_MANY_ATTEMPTS", "OTP_LOCKED", "NOT_FOUND", "SENDING_PAUSED", "DAILY_LIMIT", "LIMIT_UNAVAILABLE"];

function apiError(err: any, fallback: string): string {
  return err?.response?.data?.error || fallback;
}

function confirmationText(res: ConfirmResult): string {
  const recovered = Number(res.recoveryDeduction ?? 0);
  const recoveredNote = recovered > 0 ? ` ${formatTzs(recovered)} is planned to settle an earlier refund.` : "";
  if (res.total <= 0) return `Your withdrawal request was received. The ready amount is being applied to an earlier refund.${recoveredNote}`;
  return `Your withdrawal request for ${formatTzs(res.total)} to ${res.destination} was received. ${res.queuedCount} payout(s) are being prepared. Delivery is not yet confirmed.${recoveredNote}`;
}

export default function WithdrawPanel({
  readyTotal,
  readyCount,
  recoveryDue,
  dailyLimit,
  dailyRemaining,
  dailyResetAt,
  onDone,
}: {
  readyTotal: number;
  readyCount: number;
  recoveryDue: number;
  dailyLimit: number;
  dailyRemaining: number;
  dailyResetAt: string | null;
  onDone: () => void;
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState("");
  const [codeFocused, setCodeFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportLocked, setSupportLocked] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [amount, setAmount] = useState("");

  const maxToday = Math.max(0, Math.floor(Math.min(dailyRemaining, readyTotal - recoveryDue)));
  useEffect(() => {
    setAmount((previous) => previous === "" ? (maxToday > 0 ? String(maxToday) : "") :
      Number(previous) > maxToday ? (maxToday > 0 ? String(maxToday) : "") : previous);
  }, [maxToday]);
  const chosenAmount = Number(amount);
  const validAmount = Number.isSafeInteger(chosenAmount) && chosenAmount > 0 && chosenAmount <= maxToday;

  const requestCode = async () => {
    if (!validAmount) {
      setError(`Enter a whole TZS amount from 1 to ${formatTzs(maxToday)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setSupportLocked(false);
    setDone(null);
    try {
      const res = await apiClient.post<Challenge>("/api/owner/payouts/withdraw/challenge", { amount: chosenAmount });
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
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border border-solid border-emerald-200 bg-white px-3 py-2.5 text-xs text-slate-600">
            <div className="flex justify-between gap-3"><span>Ready balance</span><strong className="tabular-nums text-slate-900">{formatTzs(readyTotal)}</strong></div>
            <div className="mt-1 flex justify-between gap-3"><span>Remaining today</span><strong className="tabular-nums text-slate-900">{formatTzs(dailyRemaining)}</strong></div>
            <p className="m-0 mt-1 text-[11px] text-slate-500">Daily limit {formatTzs(dailyLimit)}{dailyResetAt ? ` · resets ${formatEat(dailyResetAt)}` : ""}</p>
          </div>
          <label htmlFor="withdrawal-amount" className="text-xs font-semibold text-slate-700">Amount to withdraw (TZS)</label>
          <div className="flex gap-2">
            <input
              id="withdrawal-amount" type="number" min={1} max={maxToday} step={1} inputMode="numeric"
              value={amount} onChange={(event) => setAmount(event.target.value)}
              disabled={busy || maxToday <= 0}
              aria-describedby="withdrawal-amount-hint"
              className="h-11 min-w-0 flex-1 rounded-xl border border-solid border-slate-300 bg-white px-3 text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-[#02665e] disabled:bg-slate-100"
            />
            <button type="button" onClick={() => setAmount(String(maxToday))} disabled={busy || maxToday <= 0}
              className="h-11 rounded-xl border border-solid border-emerald-300 bg-white px-3 text-xs font-semibold text-[#02665e] disabled:opacity-50">Max today</button>
          </div>
          <p id="withdrawal-amount-hint" className="m-0 text-xs text-slate-500">
            {maxToday > 0 ? "Any amount up to today's limit. The rest stays in your ready balance." :
              recoveryDue >= readyTotal && readyTotal > 0 ? "Your ready balance is being held against an earlier refund." : "Your daily withdrawal limit is used. The balance stays ready."}
          </p>
          <button
            type="button"
            onClick={requestCode}
            disabled={busy || readyCount === 0 || !validAmount}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LockKeyhole className="h-4 w-4" aria-hidden />}
            {busy ? "Sending code..." : `Withdraw ${formatTzs(validAmount ? chosenAmount : 0)}`}
          </button>
          {readyCount > 0 && <span className="text-center text-xs text-slate-500">The amount is taken from ready stays in order · one confirmation code</span>}
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
                Withdraw <strong className="text-slate-900">{formatTzs(challenge.total)}</strong> from {challenge.count} {challenge.count === 1 ? "stay" : "stays"} to{" "}
                <strong className="text-slate-900">{challenge.destination}</strong>
                {Number(challenge.recoveryDeduction ?? 0) > 0 && (
                  <> ({formatTzs(challenge.grossTotal)} ready, less {formatTzs(challenge.recoveryDeduction)} for an earlier refund)</>
                )}
                .
              </p>
              <p id="withdrawal-code-hint" className="m-0 mt-1 text-xs text-slate-500">
                Code sent by {challenge.channel === "SMS" ? "SMS" : "email"} to {challenge.sentTo}. It expires at {formatEat(challenge.expiresAt)}.
                Never share it. NoLSAF staff will never ask for it.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <label htmlFor="withdrawal-code" className="mb-2 block text-xs font-semibold text-slate-700">Enter the 6-digit code</label>
            <div className="relative w-full max-w-[18rem]">
              <div className="grid grid-cols-6 gap-1.5" aria-hidden>
                {Array.from({ length: 6 }, (_, index) => {
                  const digit = code[index];
                  const isCurrent = codeFocused && code.length < 6 && index === code.length;
                  return (
                    <span key={index} className={`grid h-11 min-w-0 place-items-center rounded-lg border border-solid bg-white font-mono text-lg font-bold tabular-nums transition-colors ${digit ? "border-[#02665e]/40 text-[#02665e]" : isCurrent ? "border-[#02665e] ring-2 ring-[#02665e]/15 text-slate-400" : "border-slate-300 text-slate-300"}`}>
                      {digit || "·"}
                    </span>
                  );
                })}
              </div>
              <input
                id="withdrawal-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                onPaste={(event) => {
                  event.preventDefault();
                  setCode(event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6));
                }}
                onFocus={() => setCodeFocused(true)}
                onBlur={() => setCodeFocused(false)}
                aria-label="6-digit withdrawal code"
                aria-describedby="withdrawal-code-hint"
                autoFocus
                className="absolute inset-0 h-full w-full cursor-text border-0 bg-transparent p-0 text-transparent caret-transparent outline-none selection:bg-transparent"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
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
