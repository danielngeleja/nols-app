"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, KeyRound, Loader2, LockKeyhole, RotateCw, ShieldCheck, X } from "lucide-react";
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
  // How long this code was valid for, so the bar can drain from full.
  const codeLifetime = expiresAtDate && sentAt ? Math.max(1, (expiresAtDate.getTime() - sentAt) / 1000) : null;
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
      const untilDate = until ? new Date(until) : new Date(Date.now() + 15 * 60 * 1000);
      setGrantedUntilDate(untilDate);
      setCode(Array.from({ length: 6 }, () => ""));
      setStage("granted");
      window.dispatchEvent(new CustomEvent("finance-grant-granted", { detail: { until: untilDate.getTime() } }));
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
                  {stage === "granted" ? `Unlocked until ${grantedUntil || "15 minutes from now"}.` : "OTP required for protected finance actions."}
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
          <div className="relative mx-auto box-border w-full max-w-[440px] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-lg bg-white shadow-[0_24px_64px_-16px_rgba(2,40,36,0.45)] ring-1 ring-slate-900/5 sm:max-h-[calc(100dvh-2rem)]">
            {/* Vault band: the countdown ring, the step tracker and the title */}
            <div className="relative overflow-hidden bg-[#0b2420] px-5 pb-5 pt-5 text-white sm:px-7">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_0%,rgba(16,185,129,0.18)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-3 top-3 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/50 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/40"
                aria-label="Close finance verification"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>

              <div className="relative flex items-center gap-4">
                {(() => {
                  // One ring for every stage: empty while locked, draining with the code, then the access window.
                  const r = 26;
                  const circumference = 2 * Math.PI * r;
                  const codeFraction = codeLifetime && codeSecondsLeft !== null ? Math.max(0, Math.min(1, codeSecondsLeft / codeLifetime)) : 0;
                  const fraction = stage === "granted" ? grantProgress : stage === "code-sent" || stage === "verifying" ? (codeExpired ? 1 : codeFraction) : 0;
                  const stroke = stage === "granted" ? "#6ee7b7" : codeExpired ? "#fb7185" : (codeSecondsLeft ?? 999) <= 60 && stage !== "locked" && stage !== "sending" ? "#fbbf24" : "#6ee7b7";
                  return (
                    <span className="relative grid h-16 w-16 shrink-0 place-items-center" aria-hidden>
                      <svg viewBox="0 0 64 64" className="absolute inset-0 h-16 w-16 -rotate-90">
                        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
                        <circle
                          cx="32" cy="32" r={r} fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round"
                          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)}
                          style={{ transition: "stroke-dashoffset 1s linear, stroke 0.3s" }}
                        />
                      </svg>
                      {stage === "granted" ? (
                        <Check className="h-6 w-6 text-emerald-300" strokeWidth={2.5} />
                      ) : stage === "sending" || stage === "verifying" ? (
                        <Loader2 className="h-5 w-5 animate-spin text-emerald-200" />
                      ) : stage === "code-sent" && codeSecondsLeft !== null ? (
                        <span className={`font-mono text-[12px] font-bold tabular-nums ${codeExpired ? "text-rose-300" : (codeSecondsLeft ?? 0) <= 60 ? "text-amber-200" : "text-white"}`}>{codeExpired ? "0:00" : mmss(codeSecondsLeft)}</span>
                      ) : (
                        <LockKeyhole className="h-5 w-5 text-emerald-200" />
                      )}
                    </span>
                  );
                })()}
                <div className="min-w-0 pr-6">
                  <p className="m-0 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/80">
                    <KeyRound className="h-3 w-3" aria-hidden /> Finance verification
                  </p>
                  <h2 id="finance-grant-title" className="m-0 mt-1 text-[19px] font-bold tracking-tight text-white">
                    {stage === "granted" ? "Finance actions unlocked" : stage === "code-sent" || stage === "verifying" ? "Enter your code" : "Unlock finance actions"}
                  </h2>
                  <p className="m-0 mt-0.5 text-[12px] leading-5 text-white/60">
                    {stage === "granted"
                      ? "Retry the action that asked for verification."
                      : stage === "code-sent" || stage === "verifying"
                        ? "We sent a 6-digit code to your admin contact."
                        : "A one-time code unlocks finance actions for 15 minutes."}
                  </p>
                </div>
              </div>

              {/* Step tracker: send, enter, unlocked */}
              <ol className="relative m-0 mt-5 grid list-none grid-cols-3 gap-1.5 p-0">
                {[
                  { label: "Send", done: stage !== "locked" && stage !== "sending", current: stage === "locked" || stage === "sending" },
                  { label: "Enter", done: stage === "granted", current: stage === "code-sent" || stage === "verifying" },
                  { label: "Unlocked", done: stage === "granted", current: false },
                ].map((step, index) => (
                  <li key={step.label} className="min-w-0">
                    <span className={`block h-1 rounded-full transition-colors ${step.done ? "bg-emerald-300" : step.current ? "bg-white/50" : "bg-white/10"}`} />
                    <span className={`mt-1.5 flex items-center gap-1 text-[10px] font-semibold ${step.done ? "text-emerald-200" : step.current ? "text-white" : "text-white/35"}`}>
                      {step.done ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : <span className="tabular-nums">{index + 1}</span>}
                      {step.label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="px-5 pb-6 pt-5 sm:px-7">
              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2.5 text-[12.5px] font-medium leading-snug text-rose-800 ring-1 ring-inset ring-rose-200" role="alert">
                  <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-rose-500" aria-hidden />
                  <span className="min-w-0">{error}</span>
                </div>
              )}

              {stage === "granted" ? (
                <div>
                  <div
                    className="flex items-center justify-between gap-3 rounded-md bg-emerald-50 px-4 py-3 ring-1 ring-inset ring-emerald-100"
                    role="progressbar"
                    aria-label="Finance access time remaining"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(grantProgress * 100)}
                  >
                    <div className="min-w-0">
                      <p className="m-0 text-[11px] font-semibold text-emerald-800/70">Access open until</p>
                      <p className="m-0 mt-0.5 text-[15px] font-bold text-emerald-900">{grantedUntil || "15 minutes from now"}</p>
                    </div>
                    <div className="text-right">
                      <p className="m-0 text-[11px] font-semibold text-emerald-800/70">Time left</p>
                      <p className="m-0 mt-0.5 font-mono text-[15px] font-bold tabular-nums text-emerald-900" aria-live="off">{grantSecondsLeft !== null ? mmss(grantSecondsLeft) : "15:00"}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="mt-4 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-md border-0 bg-[#02665e] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#014e47] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#02665e]/25"
                  >
                    Done
                  </button>
                </div>
              ) : stage === "code-sent" || stage === "verifying" ? (
                <div>
                  <label className="sr-only" htmlFor="finance-otp-code">Verification code</label>
                  <div className="flex items-center gap-2" role="group" aria-label="Six-digit verification code">
                    {Array.from({ length: 6 }, (_, index) => {
                      const filled = Boolean(code[index]);
                      return (
                        <Fragment key={index}>
                        {index === 3 ? <span className="h-0.5 w-2.5 shrink-0 rounded-full bg-slate-300" aria-hidden /> : null}
                        <input
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
                          className={`box-border h-12 w-full min-w-0 flex-1 rounded-md border-[1.5px] border-solid text-center font-mono text-[20px] font-bold text-slate-950 caret-[#02665e] outline-none transition focus:border-[#02665e] focus:bg-white focus:shadow-[0_0_0_4px_rgba(2,102,94,0.14)] disabled:opacity-50 ${
                            error
                              ? "border-rose-300 bg-rose-50/50"
                              : filled
                                ? "border-[#02665e] bg-[#02665e]/[0.05] text-[#02665e]"
                                : "border-slate-200 bg-slate-50/60"
                          }`}
                        />
                        </Fragment>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex min-h-[28px] items-center justify-between gap-3 text-[12px]" aria-live="polite">
                    {codeExpired ? (
                      <span className="font-semibold text-rose-700">Code expired. Send a new one.</span>
                    ) : (
                      <span className="text-slate-500">
                        {codeSecondsLeft !== null ? (
                          <>Expires in <span className="font-mono font-semibold tabular-nums text-slate-700">{mmss(codeSecondsLeft)}</span>{expiresAt ? ` · at ${expiresAt}` : ""}</>
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
                        className="inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-[12px] font-semibold text-[#02665e] transition hover:bg-[#02665e]/[0.06] disabled:cursor-default disabled:bg-transparent disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
                      >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden />
                        {resendIn > 0 && !codeExpired ? <>Resend in <span className="tabular-nums">{resendIn}s</span></> : "Send a new code"}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void verifyCode()}
                    disabled={stage === "verifying" || codeExpired || code.join("").length < 6}
                    aria-busy={stage === "verifying" || undefined}
                    className="mt-4 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#014e47] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#02665e]/25 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {stage === "verifying" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                    {stage === "verifying" ? "Verifying" : "Verify and unlock"}
                  </button>
                </div>
              ) : (
                <div>
                  <p className="m-0 text-[12.5px] leading-5 text-slate-600">
                    We will send a one-time code to your admin contact. Enter it here and protected finance actions open for 15 minutes, then lock again on their own.
                  </p>
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={stage === "sending"}
                    aria-busy={stage === "sending" || undefined}
                    className="mt-4 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#014e47] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#02665e]/25 disabled:cursor-wait disabled:opacity-60"
                  >
                    {stage === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
                    {stage === "sending" ? "Sending code" : "Send code"}
                  </button>
                </div>
              )}
            </div>

            {stage !== "granted" && (
              <div className="flex items-start gap-2.5 border-0 border-t border-solid border-slate-100 bg-slate-50/80 px-5 py-3.5 text-[11.5px] leading-snug text-slate-500 sm:px-7">
                <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
                <span>Codes work once and expire quickly. Never share yours with anyone, NoLSAF staff included.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
