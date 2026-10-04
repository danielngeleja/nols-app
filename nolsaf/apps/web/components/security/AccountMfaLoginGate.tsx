"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, KeyRound, LifeBuoy, Loader2, RotateCcw, ShieldCheck } from "lucide-react";

export type AccountMfaStart = { mfaRequired: true; challengeId: string; method: "TOTP" };

/*
 * Second step of an account sign-in: authenticator code or backup code.
 *
 * Preflight is disabled in this project, so every button declares border-0 and
 * its own background. Without that the browser draws grey boxes with dark
 * outlines, which is what this screen used to look like.
 *
 * The six boxes are a display over one real input. A single field keeps
 * paste, iOS/Android one-time-code autofill and password managers working,
 * which six separate inputs routinely break.
 */

const TOTP_PERIOD = 30;
const CODE_LENGTH = 6;

/** Seconds left in the current authenticator window, aligned to the clock like the app itself. */
function useTotpCountdown(active: boolean) {
  const [left, setLeft] = useState(TOTP_PERIOD);
  useEffect(() => {
    if (!active) return;
    const tick = () => setLeft(TOTP_PERIOD - (Math.floor(Date.now() / 1000) % TOTP_PERIOD));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return left;
}

export default function AccountMfaLoginGate({ initial, onVerified, onCancel }: {
  initial: AccountMfaStart;
  onVerified: (data: { token: string; user: { id: number; role: string } }) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [focused, setFocused] = useState(true);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef("");
  const secondsLeft = useTotpCountdown(!backup);

  const submit = useCallback(async (value: string) => {
    if (busy || expired) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    submittedRef.current = trimmed;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: initial.challengeId, code: trimmed, useBackupCode: backup }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok || !data?.token || !data?.user?.role) {
        setError(data?.message || "That code did not work. Check it and try again.");
        setShake((n) => n + 1);
        if ([401, 403, 429, 503].includes(response.status) || data?.code === "MFA_REPLAY") setExpired(true);
        else {
          setCode("");
          requestAnimationFrame(() => inputRef.current?.focus());
        }
        return;
      }
      await onVerified(data);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }, [backup, busy, expired, initial.challengeId, onVerified]);

  // Six digits in: verify straight away, the way banking apps do. Guarded so a
  // failed code is not resubmitted on the next render.
  useEffect(() => {
    if (backup || code.length !== CODE_LENGTH || busy || expired) return;
    if (submittedRef.current === code) return;
    void submit(code);
  }, [backup, busy, code, expired, submit]);

  const switchMode = () => {
    setBackup((b) => !b);
    setCode("");
    setError("");
    submittedRef.current = "";
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const ringProgress = secondsLeft / TOTP_PERIOD;
  const ringUrgent = secondsLeft <= 5;
  const digits = code.padEnd(CODE_LENGTH, " ").slice(0, CODE_LENGTH).split("");
  const activeIndex = Math.min(code.length, CODE_LENGTH - 1);

  const [showRecovery, setShowRecovery] = useState(false);
  const circumference = 2 * Math.PI * 8;

  return (
    <section
      className="relative mx-auto box-border w-full max-w-sm overflow-hidden rounded-2xl border border-solid border-[#02665e]/15 bg-white shadow-[0_24px_50px_-28px_rgba(2,102,94,0.55),0_2px_6px_-2px_rgba(15,23,42,0.06)]"
      aria-labelledby="account-mfa-title"
    >
      {/* Surface: a brand wash from the top, a soft emerald glow behind the timer,
          and a faint dot grid that fades out before the digits, so the card reads
          as a secure NoLSAF surface rather than a plain white box. */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#02665e] via-emerald-500 to-teal-400" aria-hidden />
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 70% at 0% 0%, rgba(2,102,94,0.10) 0%, rgba(2,102,94,0) 55%), radial-gradient(60% 45% at 100% 0%, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0) 70%), linear-gradient(180deg, #f3faf9 0%, #ffffff 58%)",
        }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-[0.35]"
        style={{
          backgroundImage: "radial-gradient(rgba(2,102,94,0.22) 0.8px, transparent 0.8px)",
          backgroundSize: "14px 14px",
          WebkitMaskImage: "linear-gradient(180deg, #000 0%, transparent 100%)",
          maskImage: "linear-gradient(180deg, #000 0%, transparent 100%)",
        }}
        aria-hidden
      />
      <style>{`@keyframes mfa-shake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(3px)}30%,50%,70%{transform:translateX(-5px)}40%,60%{transform:translateX(5px)}}`}</style>

      <form
        className="relative p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(code);
        }}
      >
        {/* ── Header: one row. Icon, title, and the live code timer on the right. ── */}
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#037a70] to-[#014d47] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_18px_-8px_rgba(2,102,94,0.8)]">
            {backup ? <KeyRound className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="account-mfa-title" className="truncate text-[16px] font-bold leading-tight text-slate-900">
              {backup ? "Backup code" : "Verify it is you"}
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] leading-tight text-slate-500">
              {backup ? "Each code works once" : "Code from your authenticator app"}
            </p>
          </div>
          {!backup && !expired && (
            <span
              title={`The app shows a new code in ${secondsLeft} seconds`}
              className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold tabular-nums shadow-[0_4px_12px_-6px_rgba(2,102,94,0.5)] ${
                ringUrgent ? "text-rose-600" : "text-slate-600"
              }`}
            >
              <svg viewBox="0 0 20 20" className="absolute inset-0 h-9 w-9 -rotate-90" aria-hidden>
                <circle cx="10" cy="10" r="8" fill="none" stroke="#d7ebe8" strokeWidth="2" />
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke={ringUrgent ? "#e11d48" : "#02665e"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={`${circumference}`}
                  strokeDashoffset={`${circumference * (1 - ringProgress)}`}
                  style={{ transition: "stroke-dashoffset 1s linear" }}
                />
              </svg>
              {secondsLeft}
            </span>
          )}
        </div>

        {/* ── Code ── */}
        <div
          key={shake}
          style={shake ? { animation: "mfa-shake 0.45s cubic-bezier(.36,.07,.19,.97) both" } : undefined}
          className="relative mt-4"
          onClick={() => inputRef.current?.focus()}
        >
          {!backup ? (
            <>
              <div className="flex items-center justify-between gap-1.5" aria-hidden>
                {digits.map((digit, i) => {
                  const filled = digit.trim() !== "";
                  const isActive = !busy && !expired && i === activeIndex && code.length < CODE_LENGTH;
                  return (
                    <span key={i} className="contents">
                      {i === 3 && <span className="h-0.5 w-2 flex-shrink-0 rounded bg-[#02665e]/25" />}
                      <span
                        className={`flex h-12 min-w-0 flex-1 items-center justify-center rounded-xl border-2 border-solid text-[21px] font-bold tabular-nums transition ${
                          busy
                            ? "border-[#02665e]/30 bg-[#02665e]/[0.04] text-[#02665e]"
                            : error
                              ? "border-rose-300 bg-rose-50 text-rose-700"
                              : isActive && focused
                                ? "border-[#02665e] bg-white text-slate-900 shadow-[0_0_0_4px_rgba(2,102,94,0.14)]"
                                : filled
                                  ? "border-[#02665e]/35 bg-white text-[#014d47] shadow-[0_2px_6px_-3px_rgba(2,102,94,0.35)]"
                                  : "border-[#02665e]/10 bg-white/80 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)]"
                        }`}
                      >
                        {filled ? digit : isActive && focused ? <span className="h-5 w-0.5 animate-pulse rounded bg-[#02665e]" /> : null}
                      </span>
                    </span>
                  );
                })}
              </div>
              <input
                ref={inputRef}
                id="account-mfa-code"
                name="code"
                aria-label="6-digit authenticator code"
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
                type="text"
                pattern="[0-9]{6}"
                maxLength={CODE_LENGTH}
                value={code}
                disabled={busy || expired}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(e) => {
                  setError("");
                  setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
                }}
                className="absolute inset-0 h-full w-full cursor-text border-0 bg-transparent text-transparent caret-transparent opacity-0 outline-none"
              />
            </>
          ) : (
            <div className="flex gap-2">
              <input
                ref={inputRef}
                id="account-mfa-code"
                name="code"
                aria-label="Backup code"
                autoFocus
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                type="text"
                maxLength={128}
                placeholder="XXXX-XXXX"
                value={code}
                disabled={busy || expired}
                onChange={(e) => {
                  setError("");
                  setCode(e.target.value.toUpperCase());
                }}
                className={`box-border h-12 min-w-0 flex-1 rounded-xl border-2 border-solid bg-white/80 px-3 text-center font-mono text-[16px] font-semibold tracking-[0.18em] text-slate-900 outline-none transition placeholder:text-slate-300 focus:bg-white ${
                  error ? "border-rose-300 bg-rose-50" : "border-[#02665e]/15 focus:border-[#02665e] focus:shadow-[0_0_0_4px_rgba(2,102,94,0.14)]"
                }`}
              />
              <button
                type="submit"
                disabled={busy || expired || !code.trim()}
                aria-label="Verify backup code"
                className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border-0 bg-gradient-to-br from-[#037a70] to-[#014d47] text-white transition hover:bg-[#015750] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
              </button>
            </div>
          )}
        </div>

        {/* ── One status line: verifying, the error, or a quiet hint ── */}
        <div className="mt-3 flex min-h-[20px] items-center justify-center text-center" aria-live="polite">
          {busy ? (
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#02665e]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Verifying
            </p>
          ) : error ? (
            <p role="alert" className="flex items-center gap-1.5 text-[12.5px] font-medium text-rose-700">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </p>
          ) : !backup && ringUrgent ? (
            <p className="text-[12.5px] font-medium text-rose-600">Code about to change, use the next one</p>
          ) : !backup ? (
            <p className="text-[12.5px] text-slate-500">Signs you in as soon as all 6 digits are in</p>
          ) : null}
        </div>

        {expired && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-slate-900 text-[14px] font-semibold text-white transition hover:bg-slate-800"
          >
            <RotateCcw className="h-4 w-4" />
            Start sign-in again
          </button>
        )}

        {/* ── Links row ── */}
        <div className={`-mx-5 mt-4 flex items-center justify-between${showRecovery ? "" : " -mb-5"} gap-2 border-0 border-t border-solid border-[#02665e]/10 bg-[#02665e]/[0.03] px-5 py-3`}>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] font-medium text-slate-500 transition hover:text-slate-800 disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || expired}
              onClick={switchMode}
              className="border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] transition hover:underline disabled:opacity-50"
            >
              {backup ? "Use app code" : "Use backup code"}
            </button>
            <span className="h-3 w-px bg-[#02665e]/15" aria-hidden />
            <button
              type="button"
              onClick={() => setShowRecovery((s) => !s)}
              aria-expanded={showRecovery}
              className="border-0 bg-transparent p-0 text-[12.5px] font-medium text-slate-500 transition hover:text-slate-800"
            >
              Lost access?
            </button>
          </div>
        </div>

        {showRecovery && (
          <p className="-mx-5 -mb-5 mt-0 flex items-start gap-2 border-0 border-t border-solid border-[#02665e]/10 bg-[#02665e]/[0.05] px-5 py-2.5 text-[12px] leading-snug text-slate-600">
            <LifeBuoy className="mt-px h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" />
            Lost your phone and backup codes? Contact NoLSAF support to recover your account.
          </p>
        )}
      </form>
    </section>
  );
}
