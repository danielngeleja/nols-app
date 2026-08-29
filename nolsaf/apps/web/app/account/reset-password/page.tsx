"use client";
import React, { useEffect, useState } from "react";
import { Eye, EyeOff, Lock, AlertCircle, CheckCircle2, ArrowLeft, Check } from 'lucide-react';
import { useRouter, useSearchParams } from "next/navigation";
import { validatePasswordAgainstPolicy } from "@/lib/passwordPolicy";
import { useServerPasswordPolicy } from "@/hooks/useServerPasswordPolicy";

export default function ResetPasswordPage() {
  const search = useSearchParams();
  const router = useRouter();
  const token = search?.get("token") ?? "";
  const id = search?.get("id") ?? "";
  const _method = search?.get("method") ?? "email";
  const nextRaw = search?.get("next") ?? "";
  const reason = search?.get("reason") ?? "";
  const usernameRaw = search?.get("username") ?? "";
  const isOnboarding = reason === "onboarding";

  const next = (() => {
    const v = String(nextRaw || "").trim();
    if (!v) return "";
    if (!v.startsWith("/")) return "";
    if (v.startsWith("//")) return "";
    return v;
  })();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const { policy: passwordPolicy, policyReady, policyStatus, retryPolicy } = useServerPasswordPolicy();
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const clientValidation = validatePasswordAgainstPolicy(password, passwordPolicy);
  const clientReasons = clientValidation.reasons;
  const strengthScore = clientValidation.requirements.filter((requirement) => requirement.pass).length;
  const strengthMaximum = clientValidation.requirements.length;
  const strengthLabel = clientValidation.valid ? "Strong" : strengthScore >= Math.max(1, strengthMaximum - 2) ? "Needs improvement" : "Weak";

  useEffect(() => {
    if (!token || !id) {
      setError("Reset link missing token or id. Please request a new password reset link.");
    }
  }, [token, id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setReasons([]);
    if (!token || !id) return setError("Missing token or id.");
    if (!policyReady) return setError("Password requirements are unavailable. Reload them before continuing.");
    if (!clientValidation.valid) {
      setReasons(clientValidation.reasons);
      return setError("Password does not meet all requirements.");
    }
    if (password !== confirm) return setError("Passwords do not match.");

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, userId: id, password }),
      });
      const data = await res.json();
      if (res.ok && data && data.ok) {
        setSuccess(true);
      } else {
        if (data && (data.message === "weak_password" || data.message === "password_reused") && Array.isArray(data.reasons)) {
          setReasons(data.reasons);
        } else if (data && data.message === "password_already_set") {
          setError("__password_already_set__");
        } else if (data && data.message) {
          setError(String(data.message));
        } else {
          setError("Failed to reset password. Try again.");
        }
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-start sm:items-center justify-center bg-gradient-to-br from-slate-100 to-white py-8 px-4">
      <div className="w-full flex items-center justify-center">
      <div className="w-full max-w-[460px]">
        <div className="rounded-[28px] bg-gradient-to-b from-slate-700/30 via-slate-800/20 to-transparent p-px shadow-2xl">
        <div style={{ colorScheme: 'dark' }} className="flex flex-col rounded-[28px] overflow-hidden bg-slate-950 ring-1 ring-white/10 box-border">
        {/* Header */}
        <div className="h-1 bg-[#02665e]" />
        
        <div className="px-6 py-5 border-b border-slate-800">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push(next || "/account/login")}
              className="w-10 h-10 rounded-xl border border-slate-800 bg-slate-900/30 flex items-center justify-center hover:bg-slate-900/50 transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-5 h-5 text-slate-200" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-[#02665e]" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-50">Reset Password</h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Enter a new password for your account
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 min-w-0 overflow-hidden">
          {error === "__password_already_set__" ? (
            <div className="p-5 bg-sky-500/10 border border-sky-500/20 rounded-xl min-w-0">
              <div className="flex items-start gap-3 mb-4">
                <CheckCircle2 className="w-5 h-5 text-sky-300 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-sky-100 mb-1">Password already set</h3>
                  <p className="text-xs text-sky-200">
                    Your password has already been created. You can log in directly using your credentials.
                  </p>
                  {usernameRaw && (
                    <p className="mt-2 text-xs text-sky-200">
                      Username: <span className="font-semibold text-sky-100">{usernameRaw}</span>
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => router.push("/account/login")}
                className="w-full px-4 py-2.5 bg-[#02665e] hover:bg-[#014e47] text-white text-sm font-medium rounded-lg transition-colors"
              >
                Go to Login
              </button>
            </div>
          ) : error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2.5 text-sm text-red-200">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span className="flex-1 min-w-0 break-words">{error}</span>
            </div>
          )}

          {reasons.length > 0 && (
            <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-200 min-w-0">
              <div className="font-semibold mb-1.5">Password requirements:</div>
              <ul className="pl-5 list-disc space-y-0.5">
                {reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {policyStatus !== "ready" && (
            <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
              {policyStatus === "loading" ? "Loading password requirements…" : "Password requirements could not be loaded."}
              {policyStatus === "error" && (
                <button type="button" onClick={retryPolicy} className="ml-2 border-0 bg-transparent p-0 font-semibold text-amber-100 underline">
                  Retry
                </button>
              )}
            </div>
          )}

          {success ? (
            <div className="min-w-0">
              <div className="p-5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl min-w-0">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-emerald-100 mb-1">
                      {isOnboarding ? "Welcome aboard! 🎉" : "Password set successfully!"}
                    </h3>
                    <p className="text-sm text-emerald-200">
                      {isOnboarding
                        ? "Your account is ready. You can now log in and start your journey with NoLSAF."
                        : "Your new password has been saved."}
                    </p>
                  </div>
                </div>

                {isOnboarding && (
                  <div className="mb-4 p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-sm text-slate-300 space-y-1.5">
                    <p className="font-semibold text-slate-200 mb-2">Your login credentials:</p>
                    {usernameRaw && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-xs w-20 flex-shrink-0">Username</span>
                        <span className="font-medium text-slate-100 break-all">{usernameRaw}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs w-20 flex-shrink-0">Password</span>
                      <span className="text-slate-400 text-xs">The password you just created</span>
                    </div>
                  </div>
                )}

                {isOnboarding && (
                  <p className="text-xs text-emerald-300 mb-4 italic">
                    Good luck in your new role — we&apos;re excited to have you on the team!
                  </p>
                )}

                <button
                  onClick={() => router.push("/account/login")}
                  className="w-full px-4 py-2.5 bg-[#02665e] hover:bg-[#014e47] text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
                >
                  Go to Login
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4 min-w-0">
              <div className="space-y-2 min-w-0">
                <label className="block text-sm font-semibold text-slate-200">New password</label>
                <div className="relative min-w-0">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full max-w-full px-3 pr-10 py-2.5 text-sm bg-slate-950 text-slate-100 border-2 border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all shadow-sm hover:shadow-md placeholder:text-slate-500 box-border"
                    placeholder="New password"
                    autoComplete="new-password"
                    maxLength={passwordPolicy.maxLength}
                    disabled={!policyReady}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors focus:outline-none border-none bg-transparent p-0"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Strength meter */}
                {password && policyReady && (
                  <div className="mt-3 p-3 bg-slate-900/60 rounded-xl border border-slate-800 min-w-0">
                    <div className="flex gap-1 mb-2 min-w-0">
                      {clientValidation.requirements.map((requirement, i) => (
                        <div 
                          key={requirement.id}
                          className={`h-2 flex-1 min-w-0 rounded transition-all ${
                            i < strengthScore 
                              ? !clientValidation.valid && strengthScore <= Math.max(2, strengthMaximum / 2)
                                ? 'bg-red-400' 
                                : !clientValidation.valid
                                ? 'bg-amber-400' 
                                : 'bg-emerald-600'
                              : 'bg-slate-800'
                          }`} 
                        />
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs min-w-0">
                      <span className={`font-medium flex-shrink-0 ${
                        strengthScore <= 2 ? 'text-red-400' : 
                        strengthScore === 3 ? 'text-amber-400' : 
                        'text-emerald-400'
                      }`}>
                        {strengthLabel} {password ? `(${strengthScore}/${strengthMaximum})` : ''}
                      </span>
                      {clientReasons.length > 0 && (
                        <span className="text-slate-500 flex-shrink-0 ml-2">
                          {clientReasons.length} requirement{clientReasons.length > 1 ? 's' : ''} remaining
                        </span>
                      )}
                    </div>
                    {clientReasons.length > 0 && (
                      <ul className="mt-2 pl-4 text-xs text-slate-400 list-disc space-y-0.5 min-w-0">
                        {clientReasons.slice(0, 3).map((r, i) => (
                          <li key={i} className="break-words">{r}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2 min-w-0">
                <label className="block text-sm font-semibold text-slate-200">Confirm password</label>
                <div className="relative min-w-0">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full max-w-full px-3 pr-10 py-2.5 text-sm bg-slate-950 text-slate-100 border-2 border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all shadow-sm hover:shadow-md placeholder:text-slate-500 box-border"
                    placeholder="Confirm password"
                    autoComplete="new-password"
                    maxLength={passwordPolicy.maxLength}
                    disabled={!policyReady}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors focus:outline-none border-none bg-transparent p-0"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirm && password !== confirm && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Passwords do not match
                  </p>
                )}
                {confirm && password === confirm && clientValidation.valid && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Passwords match
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 min-w-0 gap-3">
                <button
                  type="submit"
                  disabled={loading || !policyReady || !token || !id || !clientValidation.valid || password !== confirm}
                  className="flex-1 min-w-0 px-6 py-2.5 bg-[#02665e] hover:bg-[#014e47] text-white text-sm font-medium rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:hover:shadow-md box-border"
                >
                  {loading ? (
                    <span className="flex items-center gap-1.5 justify-center">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                      <span className="truncate">Resetting...</span>
                    </span>
                  ) : (
                    <span className="truncate">Reset password</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/account/register')}
                  className="flex-shrink-0 text-sm text-slate-400 hover:text-[#02665e] transition-colors flex items-center gap-1.5 whitespace-nowrap"
                >
                  <ArrowLeft className="w-4 h-4 flex-shrink-0" />
                  <span>Back to sign in</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      </div>
      </div>
      </div>
    </main>
  );
}
