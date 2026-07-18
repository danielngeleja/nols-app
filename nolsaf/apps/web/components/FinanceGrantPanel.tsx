"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, X } from "lucide-react";
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

export default function FinanceGrantPanel({ showTrigger = true, listenForRequired = true }: FinanceGrantPanelProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("locked");
  const [code, setCode] = useState<string[]>(Array.from({ length: 6 }, () => ""));
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [grantedUntil, setGrantedUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!listenForRequired) return;
    const handleRequired = () => {
      setOpen(true);
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
      setExpiresAt(sentExpiresAt ? new Date(sentExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null);
      setStage("code-sent");
    } catch (cause: any) {
      setStage("locked");
      setError(errorMessage(cause));
    }
  };

  const verifyCode = async () => {
    const codeValue = code.join("");
    if (!/^\d{6}$/.test(codeValue)) {
      setError("Enter the six-digit code.");
      return;
    }
    setStage("verifying");
    setError(null);
    try {
      const response = await apiClient.post("/admin/2fa/otp/verify", { code: codeValue, purpose: "FINANCE_VIEW" });
      const until = response.data?.data?.until ?? response.data?.until;
      setGrantedUntil(until ? new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null);
      setCode(Array.from({ length: 6 }, () => ""));
      setStage("granted");
    } catch (cause: any) {
      setStage("code-sent");
      setError(errorMessage(cause));
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
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/45 px-3 py-3 sm:grid sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="finance-grant-title">
          <div className="mx-auto w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl border border-emerald-100 bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Admin security</p>
                <h2 id="finance-grant-title" className="mt-1 text-base font-bold text-slate-950 sm:text-lg">Unlock finance actions</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">A six-digit code will be sent to your configured admin contact. The grant lasts 15 minutes.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close finance verification"><X className="h-4 w-4" /></button>
            </div>

            {error && <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}

            {stage === "granted" ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4" /> Finance actions are unlocked.</div>
                <p className="mb-0 mt-1 text-xs">Close this dialog and retry the action that requested verification.</p>
              </div>
            ) : stage === "code-sent" || stage === "verifying" ? (
              <div className="mt-4 space-y-2.5">
                <label className="block text-xs font-bold text-slate-700" htmlFor="finance-otp-code">Verification code</label>
                <div className="flex w-full max-w-full justify-center gap-1.5 overflow-hidden" aria-label="Six-digit verification code">
                  {Array.from({ length: 6 }, (_, index) => (
                    <input
                      key={index}
                      ref={(element) => { otpRefs.current[index] = element; }}
                      id={index === 0 ? "finance-otp-code" : undefined}
                      aria-label={`Digit ${index + 1} of 6`}
                      inputMode="numeric"
                      autoComplete={index === 0 ? "one-time-code" : "off"}
                      maxLength={1}
                      value={code[index] ?? ""}
                      onChange={(event) => {
                        const digit = event.target.value.replace(/\D/g, "").slice(-1);
                        const next = [...code];
                        next[index] = digit;
                        setCode(next);
                        if (digit && index < 5) otpRefs.current[index + 1]?.focus();
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
                      }}
                      className="h-10 w-9 shrink-0 rounded-lg border border-slate-200 bg-white text-center text-base font-bold text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 sm:h-11 sm:w-10 sm:text-lg"
                    />
                  ))}
                </div>
                <p className="text-xs text-slate-500">Enter the code before it expires{expiresAt ? ` at ${expiresAt}` : ""}.</p>
                <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                  <button type="button" onClick={sendCode} disabled={stage === "verifying"} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-auto">Send another code</button>
                  <button type="button" onClick={verifyCode} disabled={stage === "verifying" || code.some((digit) => !digit)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 sm:w-auto">{stage === "verifying" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Verify and unlock</button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={sendCode} disabled={stage === "sending"} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 sm:w-auto">{stage === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send OTP</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
