"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, KeyRound, Loader2, RotateCw, ShieldCheck, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Stage = "locked" | "sending" | "code-sent" | "verifying" | "granted";

type FinanceGrantPanelProps = {
  /** Render the visible access control in its contextual page area. */
  showTrigger?: boolean;
  /** The global modal listener is mounted once in the admin shell. */
  listenForRequired?: boolean;
};

function errorMessage(error: any): string {
  return error?.response?.data?.error || error?.message || "Something went wrong. Please try again.";
}

/** Seconds before "Send another code" is allowed, so a double tap cannot burn the OTP rate limit. */
const RESEND_COOLDOWN_S = 30;

function clockTime(date: Date | null): string | null {
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
}

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function FinanceGrantPanel({ showTrigger = true, listenForRequired = true }: FinanceGrantPanelProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("locked");
  const [code, setCode] = useState<string[]>(Array.from({ length: 6 }, () => ""));
  const [expiresAtDate, setExpiresAtDate] = useState<Date | null>(null);
  const [grantedUntilDate, setGrantedUntilDate] = useState<Date | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const expiresAt = clockTime(expiresAtDate);
  const grantedUntil = clockTime(grantedUntilDate);

  // One ticking clock drives the code expiry, resend cooldown and grant countdown.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const codeSecondsLeft = expiresAtDate ? (expiresAtDate.getTime() - now) / 1000 : null;
  const codeExpired = codeSecondsLeft !== null && codeSecondsLeft <= 0;
  const resendIn = sentAt ? Math.max(0, RESEND_COOLDOWN_S - Math.floor((now - sentAt) / 1000)) : 0;
  const grantSecondsLeft = grantedUntilDate ? (grantedUntilDate.getTime() - now) / 1000 : null;
  const grantProgress = grantSecondsLeft !== null ? Math.max(0, Math.min(1, grantSecondsLeft / (15 * 60))) : 0;

  useEffect(() => {
    if (!listenForRequired) return;
    const handleRequired = () => {
      setOpen(true);
      setStage(current => current === "granted" ? "locked" : current);
      setError("This action needs the finance verification grant.");
    };
    window.addEventListener("finance-grant-required", handleRequired);
    return () => window.removeEventListener("finance-grant-required", handleRequired);
  }, [listenForRequired]);

  useEffect(() => {
    if (stage === "code-sent") otpRefs.current[0]?.focus();
  }, [stage]);

  const sendCode = async () => {
    setStage("sending");
    setCode(Array.from({ length: 6 }, () => ""));
    setError(null);
    try {
      const response = await apiClient.post("/admin/2fa/otp/send", { purpose: "FINANCE_VIEW" });
      const sentExpiresAt = response.data?.data?.expiresAt ?? response.data?.expiresAt;
      setExpiresAtDate(sentExpiresAt ? new Date(sentExpiresAt) : null);
      setSentAt(Date.now());
      setStage("code-sent");
    } catch (cause: any) {
      setStage("locked");
      setError(errorMessage(cause));
    }
  };

  const verifyCode = async (codeOverride?: string) => {
    const codeValue = codeOverride ?? code.join("");
    if (!/^\d{6}$/.test(codeValue)) {
      setError("Enter the six-digit code.");
      return;
    }
    setStage("verifying");
    setError(null);
    try {
      const response = await apiClient.post("/admin/2fa/otp/verify", { code: codeValue, purpose: "FINANCE_VIEW" });
      const until = response.data?.data?.until ?? response.data?.until;
      setGrantedUntilDate(until ? new Date(until) : new Date(Date.now() + 15 * 60 * 1000));
      setCode(Array.from({ length: 6 }, () => ""));
      setStage("granted");
      window.dispatchEvent(new CustomEvent("finance-grant-granted"));
    } catch (cause: any) {
      setStage("code-sent");
      setError(errorMessage(cause));
      // Clear the wrong code and put the cursor back at the start, ready to retype.
      setCode(Array.from({ length: 6 }, () => ""));
      window.setTimeout(() => otpRefs.current[0]?.focus(), 30);
    }
  };

  return (
    <>
      {showTrigger && (
        <div className="mx-auto min-w-0 max-w-6xl px-4 pt-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-800 shadow-sm sm:px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-700">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Finance access</p>
                <p className="m-0 mt-0.5 truncate text-xs font-medium text-slate-500 sm:text-sm">
                  {stage === "granted" ? `Unlocked until ${grantedUntil || "15 minutes from now"}.` : "OTP required for protected NRMS actions."}
                </p>
              </div>
            </div>
            <button type="button" onClick={() => { setOpen(true); setError(null); }} className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">
              <span className="hidden sm:inline">{stage === "granted" ? "Re-verify access" : "Unlock finance actions"}</span>
              <span className="sm:hidden">{stage === "granted" ? "Re-verify" : "Unlock"}</span>
            </button>
          </div>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/50 px-3 py-3 backdrop-blur-[2px] sm:grid sm:place-items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="finance-grant-title"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
        >
          <div className="relative mx-auto box-border w-full max-w-[420px] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl bg-white shadow-[0_24px_64px_-16px_rgba(2,40,36,0.45)] ring-1 ring-slate-900/5 sm:max-h-[calc(100dvh-2rem)]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
              aria-label="Close finance verification"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>

            <div className="px-5 pb-5 pt-6 sm:px-6">
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                  stage === "granted" ? "bg-emerald-600 text-white" : "bg-[#02665e]/[0.08] text-[#02665e]"
                }`}
                aria-hidden
              >
                {stage === "granted" ? <Check className="h-5 w-5" strokeWidth={2.5} /> : <ShieldCheck className="h-5 w-5" />}
              </span>

              <h2 id="finance-grant-title" className="m-0 mt-4 text-[18px] font-bold tracking-tight text-slate-950">
                {stage === "granted" ? "Finance actions unlocked" : stage === "code-sent" || stage === "verifying" ? "Enter your code" : "Unlock finance actions"}
              </h2>
              <p className="m-0 mt-1 text-[13px] leading-5 text-slate-500">
                {stage === "granted"
                  ? "Retry the action that asked for verification."
                  : stage === "code-sent" || stage === "verifying"
                    ? "We sent a 6-digit code to your admin contact."
                    : "Verify with a one-time code. Access lasts 15 minutes."}
              </p>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-[12.5px] font-medium leading-snug text-rose-800 ring-1 ring-inset ring-rose-200" role="alert">
                  <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-rose-500" aria-hidden />
                  <span className="min-w-0">{error}</span>
                </div>
              )}

              {stage === "granted" ? (
                <div className="mt-5">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium text-slate-600">Time remaining</span>
                    <span className="font-mono font-bold tabular-nums text-emerald-700" aria-live="off">
                      {grantSecondsLeft !== null ? mmss(grantSecondsLeft) : "15:00"}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-label="Finance access time remaining"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(grantProgress * 100)}
                  >
                    <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-1000 ease-linear" style={{ width: `${grantProgress * 100}%` }} />
                  </div>
                  <p className="m-0 mt-2 text-[12px] text-slate-500">Unlocked until {grantedUntil || "15 minutes from now"}.</p>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl border-0 bg-[#02665e] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#014e47] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#02665e]/25"
                  >
                    Done
                  </button>
                </div>
              ) : stage === "code-sent" || stage === "verifying" ? (
                <div className="mt-5">
                  <label className="sr-only" htmlFor="finance-otp-code">Verification code</label>
                  <div className="grid grid-cols-6 gap-2" role="group" aria-label="Six-digit verification code">
                    {Array.from({ length: 6 }, (_, index) => {
                      const filled = Boolean(code[index]);
                      return (
                        <input
                          key={index}
                          ref={(element) => { otpRefs.current[index] = element; }}
                          id={index === 0 ? "finance-otp-code" : undefined}
                          aria-label={`Digit ${index + 1} of 6`}
                          aria-invalid={error ? true : undefined}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete={index === 0 ? "one-time-code" : "off"}
                          maxLength={1}
                          value={code[index] ?? ""}
                          disabled={stage === "verifying" || codeExpired}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => {
                            const digits = event.target.value.replace(/\D/g, "");
                            // Autofill can drop the whole code into the first box.
                            if (digits.length > 1) {
                              const next = Array.from({ length: 6 }, (_, i) => digits[i] ?? "");
                              setCode(next);
                              otpRefs.current[Math.min(digits.length, 6) - 1]?.focus();
                              if (/^\d{6}$/.test(next.join(""))) void verifyCode(next.join(""));
                              return;
                            }
                            const next = [...code];
                            next[index] = digits.slice(-1);
                            setCode(next);
                            if (error) setError(null);
                            if (digits && index < 5) otpRefs.current[index + 1]?.focus();
                            const full = next.join("");
                            if (/^\d{6}$/.test(full)) void verifyCode(full);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Backspace" && !code[index] && index > 0) otpRefs.current[index - 1]?.focus();
                            if (event.key === "ArrowLeft" && index > 0) otpRefs.current[index - 1]?.focus();
                            if (event.key === "ArrowRight" && index < 5) otpRefs.current[index + 1]?.focus();
                          }}
                          onPaste={(event) => {
                            event.preventDefault();
                            const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                            if (!pasted) return;
                            const next = Array.from({ length: 6 }, () => "");
                            pasted.split("").forEach((digit, digitIndex) => { next[digitIndex] = digit; });
                            setCode(next);
                            otpRefs.current[Math.min(pasted.length, 6) - 1]?.focus();
                            const full = next.join("");
                            if (/^\d{6}$/.test(full)) void verifyCode(full);
                          }}
                          className={`box-border h-12 w-full min-w-0 rounded-xl border border-solid text-center font-mono text-[20px] font-bold text-slate-950 caret-[#02665e] outline-none transition focus:border-[#02665e] focus:bg-white focus:shadow-[0_0_0_4px_rgba(2,102,94,0.12)] disabled:opacity-50 ${
                            error
                              ? "border-rose-300 bg-rose-50/40"
                              : filled
                                ? "border-[#02665e]/40 bg-[#02665e]/[0.04]"
                                : "border-slate-200 bg-slate-50"
                          }`}
                        />
                      );
                    })}
                  </div>

                  <div className="mt-3 flex min-h-[28px] items-center justify-between gap-3 text-[12.5px]" aria-live="polite">
                    {stage === "verifying" ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#02665e]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Verifying
                      </span>
                    ) : codeExpired ? (
                      <span className="font-semibold text-rose-700">Code expired</span>
                    ) : (
                      <span className="text-slate-500">
                        {codeSecondsLeft !== null ? (
                          <>Expires in <span className="font-mono font-semibold tabular-nums text-slate-700">{mmss(codeSecondsLeft)}</span></>
                        ) : (
                          `Expires ${expiresAt ? `at ${expiresAt}` : "soon"}`
                        )}
                      </span>
                    )}

                    {stage !== "verifying" && (
                      <button
                        type="button"
                        onClick={sendCode}
                        disabled={resendIn > 0 && !codeExpired}
                        className="inline-flex min-h-[28px] items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 font-semibold text-[#02665e] transition hover:bg-[#02665e]/[0.06] disabled:cursor-default disabled:bg-transparent disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
                      >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden />
                        {resendIn > 0 && !codeExpired ? `Resend in ${resendIn}s` : "Resend code"}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-5">
                  <ul className="m-0 list-none space-y-2 p-0 text-[12.5px] text-slate-600">
                    <li className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600" aria-hidden>1</span>
                      Get a code on your admin contact
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600" aria-hidden>2</span>
                      Enter it to unlock for 15 minutes
                    </li>
                  </ul>
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={stage === "sending"}
                    aria-busy={stage === "sending" || undefined}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#014e47] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#02665e]/25 disabled:cursor-wait disabled:opacity-60"
                  >
                    {stage === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
                    {stage === "sending" ? "Sending code" : "Send code"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
