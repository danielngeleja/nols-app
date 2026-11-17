"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Check, CheckCircle2, Clock, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { validatePasswordAgainstPolicy } from "@/lib/passwordPolicy";
import { useServerPasswordPolicy } from "@/hooks/useServerPasswordPolicy";

// The token is kept here for the life of the tab once it is taken out of the
// address bar, so a reload still works but the link does not sit in history.
const TOKEN_KEY = "nolsaf.passwordSetupToken";

type LinkCheck =
  | { state: "checking" }
  | { state: "valid"; firstPassword: boolean; login: string | null; name: string | null; expiresAt: string | null }
  | { state: "invalid"; reason: "missing" | "invalid" | "expired" | "unavailable" };

function safeNext(raw: string): string {
  const v = String(raw || "").trim();
  if (!v || !v.startsWith("/") || v.startsWith("//")) return "";
  return v;
}

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)} EAT`;
}

function readStoredToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function storeToken(value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(TOKEN_KEY, value);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the page still works for this load */
  }
}

export default function ResetPasswordPage() {
  const search = useSearchParams();
  const router = useRouter();
  const urlToken = search?.get("token") ?? "";
  // Links sent before ids were removed from the address still carry one.
  const legacyId = search?.get("id") ?? "";
  const reason = search?.get("reason") ?? "";
  const next = safeNext(search?.get("next") ?? "");
  const isOnboarding = reason === "onboarding";

  const [token, setToken] = useState(urlToken);
  const [link, setLink] = useState<LinkCheck>({ state: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [done, setDone] = useState<"saved" | "already_set" | null>(null);
  const checked = useRef(false);

  const { policy: passwordPolicy, policyReady, policyStatus, retryPolicy } = useServerPasswordPolicy();
  const validation = validatePasswordAgainstPolicy(password, passwordPolicy);

  // Check the link once, before the user types anything.
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const effective = urlToken || readStoredToken();
    setToken(effective);
    if (urlToken) {
      storeToken(urlToken);
      // Take the token out of the address bar and history.
      const keep = new URLSearchParams();
      if (reason) keep.set("reason", reason);
      if (next) keep.set("next", next);
      if (legacyId) keep.set("id", legacyId);
      const qs = keep.toString();
      window.history.replaceState(null, "", `/account/reset-password${qs ? `?${qs}` : ""}`);
    }
    if (!effective) {
      setLink({ state: "invalid", reason: "missing" });
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/auth/reset-password/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: effective }),
        });
        if (res.status === 429) {
          setLink({ state: "invalid", reason: "unavailable" });
          return;
        }
        const data = await res.json().catch(() => null);
        if (data?.valid) {
          setLink({
            state: "valid",
            firstPassword: Boolean(data.firstPassword),
            login: data.login ?? null,
            name: data.name ?? null,
            expiresAt: data.expiresAt ?? null,
          });
        } else {
          const r = data?.reason;
          setLink({ state: "invalid", reason: r === "expired" || r === "missing" || r === "unavailable" ? r : "invalid" });
          if (r === "expired" || r === "invalid") storeToken(null);
        }
      } catch {
        setLink({ state: "invalid", reason: "unavailable" });
      }
    })();
  }, [urlToken, reason, next, legacyId]);

  const firstPassword = link.state === "valid" ? link.firstPassword : isOnboarding;
  const operatorSetup = isOnboarding && next.startsWith("/account/agent");
  const title = firstPassword ? (operatorSetup ? "Set up your operator account" : "Create your password") : "Choose a new password";
  const subtitle = firstPassword
    ? "Create the password you will use to sign in. Only you will know it."
    : "Your new password replaces the old one and signs you out on other devices.";
  const loginHref = `/account/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setReasons([]);
    if (!token) return setError("This link is missing its code. Open the link from your email again.");
    if (!policyReady) return setError("Password requirements are still loading.");
    if (!validation.valid) {
      setReasons(validation.reasons);
      return setError("The password does not meet every requirement yet.");
    }
    if (password !== confirm) return setError("The two passwords do not match.");

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyId ? { token, userId: legacyId, password } : { token, password }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        storeToken(null);
        setPassword("");
        setConfirm("");
        setDone("saved");
        return;
      }
      if (res.status === 429) return setError("Too many attempts. Wait a few minutes and try again.");
      const message = data?.message;
      if ((message === "weak_password" || message === "password_reused") && Array.isArray(data?.reasons)) {
        setReasons(data.reasons);
        setError(message === "password_reused" ? "Choose a password you have not used before." : "The password does not meet every requirement yet.");
      } else if (message === "password_already_set") {
        storeToken(null);
        setDone("already_set");
      } else if (message === "token expired") {
        storeToken(null);
        setLink({ state: "invalid", reason: "expired" });
      } else if (message === "invalid token") {
        storeToken(null);
        setLink({ state: "invalid", reason: "invalid" });
      } else {
        setError("The password could not be saved. Try again.");
      }
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:py-16" style={{ boxSizing: "border-box" }}>
      <div className="mx-auto w-full max-w-[440px] [&_*]:box-border">
        <div className="mb-5 flex items-center justify-center gap-2 text-sm font-semibold text-[#02665e]">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <span>NoLSAF secure account setup</span>
        </div>

        <div className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-sm">
          {link.state === "checking" && (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#02665e]" aria-hidden />
              <p className="text-sm text-slate-600">Checking your link…</p>
            </div>
          )}

          {link.state === "invalid" && <InvalidLink reason={link.reason} isOnboarding={isOnboarding} loginHref={loginHref} />}

          {link.state === "valid" && done && (
            <div className="px-6 py-8">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="h-6 w-6" aria-hidden />
              </div>
              <h1 className="mt-4 text-lg font-semibold text-slate-900">
                {done === "already_set" ? "Your password is already set" : firstPassword ? "Your account is ready" : "Password changed"}
              </h1>
              <p className="mt-1.5 text-sm leading-6 text-slate-600">
                {done === "already_set"
                  ? "This link was already used to create a password. Sign in with it, or use Forgot password on the sign-in page."
                  : firstPassword
                    ? operatorSetup
                      ? "Sign in with your new password to open your operator workspace."
                      : "Sign in with your new password to continue."
                    : "Sign in with your new password. Other devices were signed out."}
              </p>
              {link.login && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-solid border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                  <span className="text-slate-500">Sign in as</span>
                  <span className="truncate font-medium text-slate-900">{link.login}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => router.push(loginHref)}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#014e47]"
              >
                Go to sign in
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}

          {link.state === "valid" && !done && (
            <>
              <div className="border-b border-solid border-x-0 border-t-0 border-slate-100 px-6 pb-5 pt-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#02665e]/10 text-[#02665e]">
                  {firstPassword ? <KeyRound className="h-5 w-5" aria-hidden /> : <LockKeyhole className="h-5 w-5" aria-hidden />}
                </div>
                <h1 className="mt-4 text-lg font-semibold text-slate-900">
                  {link.name && firstPassword ? `Welcome, ${link.name}` : title}
                </h1>
                <p className="mt-1 text-sm leading-6 text-slate-600">{link.name && firstPassword ? `${title}. ${subtitle}` : subtitle}</p>

                <dl className="mt-4 grid gap-2 text-sm">
                  {link.login && (
                    <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                      <dt className="text-slate-500">Account</dt>
                      <dd className="m-0 truncate font-medium text-slate-900">{link.login}</dd>
                    </div>
                  )}
                  {formatExpiry(link.expiresAt) && (
                    <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                      <dt className="inline-flex items-center gap-1.5 text-slate-500">
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        Link works until
                      </dt>
                      <dd className="m-0 font-medium text-slate-900">{formatExpiry(link.expiresAt)}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <form onSubmit={onSubmit} className="space-y-4 px-6 py-5" noValidate>
                {policyStatus !== "ready" && (
                  <div className="rounded-md border border-solid border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                    {policyStatus === "loading" ? "Loading password requirements…" : "Password requirements could not be loaded."}
                    {policyStatus === "error" && (
                      <button type="button" onClick={retryPolicy} className="ml-2 border-0 bg-transparent p-0 font-semibold text-amber-900 underline">
                        Retry
                      </button>
                    )}
                  </div>
                )}

                {error && (
                  <div role="alert" className="flex items-start gap-2 rounded-md border border-solid border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="m-0">{error}</p>
                      {reasons.length > 0 && (
                        <ul className="mb-0 mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
                          {reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {/* Hidden username field so password managers save the right login. */}
                {link.login && <input type="text" name="username" autoComplete="username" value={link.login} readOnly hidden />}

                <div>
                  <label htmlFor="new-password" className="block text-sm font-medium text-slate-800">
                    {firstPassword ? "Password" : "New password"}
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      autoFocus
                      maxLength={passwordPolicy.maxLength}
                      disabled={!policyReady || loading}
                      className="w-full rounded-md border border-solid border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-900 outline-none transition focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15 disabled:bg-slate-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 border-0 bg-transparent p-1 text-slate-400 hover:text-slate-700"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {policyReady && (
                    <ul className="mb-0 mt-3 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
                      {validation.requirements.map((req) => (
                        <li key={req.id} className={`flex items-center gap-1.5 text-xs ${req.pass ? "text-emerald-700" : "text-slate-500"}`}>
                          <span
                            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full ${req.pass ? "bg-emerald-100" : "bg-slate-100"}`}
                            aria-hidden
                          >
                            {req.pass ? <Check className="h-3 w-3" /> : <span className="h-1 w-1 rounded-full bg-slate-400" />}
                          </span>
                          {req.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-800">
                    Type it again
                  </label>
                  <input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    maxLength={passwordPolicy.maxLength}
                    disabled={!policyReady || loading}
                    className="mt-1.5 w-full rounded-md border border-solid border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15 disabled:bg-slate-50"
                  />
                  {confirm && (
                    <p className={`mb-0 mt-1.5 flex items-center gap-1 text-xs ${password === confirm ? "text-emerald-700" : "text-red-700"}`}>
                      {password === confirm ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                      {password === confirm ? "Passwords match" : "Passwords do not match yet"}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !policyReady || !validation.valid || password !== confirm}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {loading ? "Saving…" : firstPassword ? "Create password" : "Save new password"}
                </button>
              </form>
            </>
          )}
        </div>

        <SafetyNote />
      </div>
    </main>
  );
}

function InvalidLink({
  reason,
  isOnboarding,
  loginHref,
}: {
  reason: "missing" | "invalid" | "expired" | "unavailable";
  isOnboarding: boolean;
  loginHref: string;
}) {
  const copy = {
    expired: {
      title: "This link has expired",
      body: isOnboarding
        ? "Setup links work for a limited time. Ask the NoLSAF partnerships team to send you a new one."
        : "Reset links work for a limited time. Request a new one below.",
    },
    invalid: {
      title: "This link no longer works",
      body: "It was already used, or a newer link replaced it. If you already created your password, sign in with it.",
    },
    missing: {
      title: "This link is incomplete",
      body: "Open the link straight from your email. Some email apps cut long links when they are copied.",
    },
    unavailable: {
      title: "We could not check this link",
      body: "Wait a minute and reload this page. If it keeps happening, contact NoLSAF support.",
    },
  }[reason];

  return (
    <div className="px-6 py-8">
      <div className="flex h-11 w-11 items-center justify-center rounded-md bg-amber-50 text-amber-700">
        {reason === "expired" ? <Clock className="h-5 w-5" aria-hidden /> : <AlertCircle className="h-5 w-5" aria-hidden />}
      </div>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">{copy.title}</h1>
      <p className="mt-1.5 text-sm leading-6 text-slate-600">{copy.body}</p>
      <div className="mt-5 grid gap-2">
        {isOnboarding ? (
          <a
            href="mailto:partners@nolsaf.com?subject=New%20password%20setup%20link"
            className="inline-flex w-full items-center justify-center rounded-md bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-[#014e47]"
          >
            Ask for a new link
          </a>
        ) : (
          <Link
            href="/account/forgot-password"
            className="inline-flex w-full items-center justify-center rounded-md bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-[#014e47]"
          >
            Request a new link
          </Link>
        )}
        <Link
          href={loginHref}
          className="inline-flex w-full items-center justify-center rounded-md border border-solid border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50"
        >
          Go to sign in
        </Link>
      </div>
    </div>
  );
}

function SafetyNote() {
  return (
    <p className="mx-auto mt-5 max-w-[380px] text-center text-xs leading-5 text-slate-500">
      NoLSAF will never ask for your password by email, phone or WhatsApp. Only use links that open on nolsaf.com.
    </p>
  );
}
