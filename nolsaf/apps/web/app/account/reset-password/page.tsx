"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowBigUp, ArrowRight, Check, CheckCircle2, Clock, Eye, EyeOff, KeyRound, Link2Off, Loader2, Lock, LockKeyhole, Mail, MailCheck, ShieldCheck, Smartphone, Sparkles, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { validatePasswordAgainstPolicy } from "@/lib/passwordPolicy";
import { useServerPasswordPolicy } from "@/hooks/useServerPasswordPolicy";

// The token is kept here for the life of the tab once it is taken out of the
// address bar, so a reload still works but the link does not sit in history.
const TOKEN_KEY = "nolsaf.passwordSetupToken";

type LinkCheck =
  | { state: "checking" }
  | { state: "valid"; firstPassword: boolean; login: string | null; name: string | null; expiresAt: string | null; contacts: Contacts | null }
  | { state: "invalid"; reason: "missing" | "invalid" | "expired" | "unavailable" };

/** Masked sign-in details. emailState PENDING: a sales partner gave it and the owner has not proved it yet. */
type Contacts = { phone: string | null; email: string | null; emailState: "VERIFIED" | "UNVERIFIED" | "PENDING" | null };

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
  const [capsLock, setCapsLock] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const checked = useRef(false);

  const { policy: passwordPolicy, policyReady, policyStatus, retryPolicy } = useServerPasswordPolicy();
  const validation = validatePasswordAgainstPolicy(password, passwordPolicy);

  const trackCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"));
  };

  // A random password from the browser's secure generator, checked against the
  // policy, shown once so the person can save it before continuing.
  const suggestPassword = () => {
    const length = Math.min(passwordPolicy.maxLength, Math.max(16, passwordPolicy.minLength));
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = securePassword(length);
      if (validatePasswordAgainstPolicy(candidate, passwordPolicy).valid) {
        setPassword(candidate);
        setConfirm(candidate);
        setShowPassword(true);
        setSuggested(true);
        setError(null);
        setReasons([]);
        return;
      }
    }
  };

  // Never leave a revealed password on screen: hide it when the tab is left.
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") setShowPassword(false); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

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
            contacts: data.contacts && typeof data.contacts === "object" ? data.contacts : null,
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
              {/* Who this is for and how long the link lasts, on the brand band */}
              <div className="bg-[#0b2420] px-6 pb-5 pt-6 text-white">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/10 text-emerald-300">
                    {firstPassword ? <KeyRound className="h-5 w-5" aria-hidden /> : <LockKeyhole className="h-5 w-5" aria-hidden />}
                  </span>
                  <div className="min-w-0">
                    <h1 className="m-0 truncate text-[18px] font-semibold leading-tight text-white">
                      {link.name && firstPassword ? `Welcome, ${link.name}` : title}
                    </h1>
                    <p className="m-0 mt-0.5 text-[13px] text-white/65">
                      {firstPassword ? "Create the password only you will know." : "It replaces the old one and signs out other devices."}
                    </p>
                  </div>
                </div>
                {/* Your sign-in details, masked */}
                <div className="mt-4 overflow-hidden rounded-md bg-white/[0.06] text-[12.5px]">
                  {link.contacts?.phone || (!link.contacts && link.login) ? (
                    <div className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-white/60"><Smartphone className="h-3.5 w-3.5" aria-hidden />Phone</span>
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-white">
                        <span className="truncate font-mono tracking-tight">{link.contacts?.phone || link.login}</span>
                        {link.contacts?.phone ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-label="Confirmed" /> : null}
                      </span>
                    </div>
                  ) : null}
                  {link.contacts?.email ? (
                    <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-white/10 px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-white/60"><Mail className="h-3.5 w-3.5" aria-hidden />Email</span>
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-white">
                        <span className="truncate font-mono tracking-tight">{link.contacts.email}</span>
                        {link.contacts.emailState === "VERIFIED"
                          ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-label="Confirmed" />
                          : <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-200">To confirm</span>}
                      </span>
                    </div>
                  ) : null}
                </div>
                {link.expiresAt && <div className="mt-2.5 flex text-[12px]"><ExpiryChip expiresAt={link.expiresAt} /></div>}
              </div>

              {link.contacts?.emailState === "PENDING" && link.contacts.email ? (
                <PendingEmailStep
                  token={token}
                  maskedEmail={link.contacts.email}
                  onDone={(state) => setLink((current) => (current.state === "valid" && current.contacts
                    ? { ...current, contacts: state === "VERIFIED" ? { ...current.contacts, emailState: "VERIFIED" } : { ...current.contacts, email: null, emailState: null } }
                    : current))}
                />
              ) : null}

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
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="new-password" className="block text-sm font-medium text-slate-800">
                      {firstPassword ? "Password" : "New password"}
                    </label>
                    {policyReady && (
                      <button
                        type="button"
                        onClick={suggestPassword}
                        disabled={loading}
                        className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        Suggest a strong one
                      </button>
                    )}
                  </div>
                  <div className="relative mt-1.5">
                    <input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setSuggested(false); }}
                      onKeyUp={trackCapsLock}
                      onKeyDown={trackCapsLock}
                      autoComplete="new-password"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus
                      maxLength={passwordPolicy.maxLength}
                      disabled={!policyReady || loading}
                      aria-describedby="password-strength"
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

                  {capsLock && (
                    <p className="m-0 mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                      <ArrowBigUp className="h-3.5 w-3.5" aria-hidden /> Caps Lock is on
                    </p>
                  )}

                  {suggested && (
                    <p className="m-0 mt-2 flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      Save this password in your phone or password manager before you continue. NoLSAF cannot show it again.
                    </p>
                  )}

                  {policyReady && (
                    <>
                      <StrengthMeter password={password} requirementsMet={validation.requirements.filter((r) => r.pass).length} requirementsTotal={validation.requirements.length} minLength={passwordPolicy.minLength} />
                      <ul className="mb-0 mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
                        {validation.requirements.map((req) => (
                          <li
                            key={req.id}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors ${req.pass ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}
                          >
                            {req.pass ? <Check className="h-3 w-3" aria-hidden /> : <span className="h-1 w-1 rounded-full bg-slate-400" aria-hidden />}
                            {req.label}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-800">
                    Type it again
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="confirm-password"
                      type={showPassword ? "text" : "password"}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      onKeyUp={trackCapsLock}
                      autoComplete="new-password"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={passwordPolicy.maxLength}
                      disabled={!policyReady || loading}
                      aria-invalid={Boolean(confirm) && password !== confirm}
                      className={`w-full rounded-md border border-solid bg-white px-3 py-2.5 pr-10 text-sm text-slate-900 outline-none transition focus:ring-2 disabled:bg-slate-50 ${
                        confirm && password !== confirm
                          ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                          : confirm
                            ? "border-emerald-300 focus:border-[#02665e] focus:ring-[#02665e]/15"
                            : "border-slate-300 focus:border-[#02665e] focus:ring-[#02665e]/15"
                      }`}
                    />
                    {confirm ? (
                      <span className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${password === confirm ? "text-emerald-600" : "text-rose-500"}`} aria-hidden>
                        {password === confirm ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                      </span>
                    ) : null}
                  </div>
                  {confirm && password !== confirm && (
                    <p className="mb-0 mt-1.5 text-xs text-rose-700">Not the same yet</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !policyReady || !validation.valid || password !== confirm}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LockKeyhole className="h-4 w-4" aria-hidden />}
                  {loading ? "Saving…" : firstPassword ? "Create password" : "Save new password"}
                </button>

                <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-x-4 gap-y-1 p-0 text-[11.5px] text-slate-500">
                  <li className="inline-flex items-center gap-1"><Lock className="h-3 w-3 text-[#02665e]" aria-hidden /> Encrypted connection</li>
                  <li className="inline-flex items-center gap-1"><Link2Off className="h-3 w-3 text-[#02665e]" aria-hidden /> Link works once</li>
                  <li className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3 text-[#02665e]" aria-hidden /> Only you know it</li>
                </ul>
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

/**
 * The email a sales partner gave for this owner. It becomes the owner's login
 * only after they enter the code sent to it; "Not my email" drops it.
 */
function PendingEmailStep({ token, maskedEmail, onDone }: { token: string; maskedEmail: string; onDone: (state: "VERIFIED" | "REMOVED") => void }) {
  const [stage, setStage] = useState<"ask" | "code" | "verified">("ask");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"" | "send" | "verify" | "reject">("");
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const call = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/auth/reset-password/email/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });
    const data = await res.json().catch(() => null);
    return { res, data };
  };
  const messageFor = (status: number, message: string | undefined) =>
    status === 429 ? "Too many tries. Wait a few minutes."
      : message === "invalid_code" ? "That code is not right. Check the email and try again."
      : message === "code_expired" ? "That code has expired. Send a new one."
      : message === "too_many_attempts" ? "Too many wrong codes. Send a new one."
      : message === "email_taken" ? "This email is already used by another NoLSAF account. Add a different one later in your profile."
      : "Something went wrong. Try again.";

  const send = async () => {
    setBusy("send");
    setError("");
    try {
      const { res, data } = await call("send", {});
      if (res.ok) { setStage("code"); setResendIn(60); setCode(""); }
      else setError(messageFor(res.status, data?.message));
    } catch { setError("No connection. Try again."); } finally { setBusy(""); }
  };
  const verify = async () => {
    if (code.length !== 6) { setError("Enter the 6-digit code."); return; }
    setBusy("verify");
    setError("");
    try {
      const { res, data } = await call("verify", { code });
      if (res.ok) { setStage("verified"); onDone("VERIFIED"); }
      else setError(messageFor(res.status, data?.message));
    } catch { setError("No connection. Try again."); } finally { setBusy(""); }
  };
  const reject = async () => {
    setBusy("reject");
    setError("");
    try {
      const { res } = await call("reject", {});
      if (res.ok) onDone("REMOVED");
      else setError("Could not remove it. Try again.");
    } catch { setError("No connection. Try again."); } finally { setBusy(""); }
  };

  if (stage === "verified") {
    return (
      <div className="flex items-center gap-2.5 border-0 border-b border-solid border-slate-100 bg-emerald-50 px-6 py-3 text-[13px] text-emerald-900">
        <MailCheck className="h-4 w-4 shrink-0" aria-hidden /> Email confirmed. You can sign in with it too.
      </div>
    );
  }

  return (
    <div className="border-0 border-b border-solid border-slate-100 px-6 py-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600"><Mail className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13.5px] font-semibold text-slate-900">Confirm your email</p>
          <p className="m-0 mt-0.5 text-[12.5px] leading-5 text-slate-500">
            {stage === "code" ? <>We sent a 6-digit code to <span className="font-mono text-slate-700">{maskedEmail}</span>.</> : <>Is <span className="font-mono text-slate-700">{maskedEmail}</span> yours? Confirm it to sign in and recover your account with it.</>}
          </p>
        </div>
      </div>

      {stage === "ask" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
          <button type="button" onClick={send} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-[#02665e]/30 bg-[#02665e]/[0.06] px-3 text-[12.5px] font-semibold text-[#02665e] hover:bg-[#02665e]/10 disabled:opacity-60">
            {busy === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Mail className="h-3.5 w-3.5" aria-hidden />} Send me a code
          </button>
          <button type="button" onClick={reject} disabled={Boolean(busy)} className="border-0 bg-transparent p-0 text-[12.5px] font-semibold text-slate-500 hover:text-rose-700 hover:underline disabled:opacity-60">
            {busy === "reject" ? "Removing…" : "Not my email"}
          </button>
        </div>
      ) : (
        <div className="mt-3 pl-12">
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void verify(); } }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label="6-digit code"
              className="h-9 w-32 rounded-md border border-solid border-slate-300 px-3 text-center font-mono text-[15px] tracking-[0.3em] text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
            />
            <button type="button" onClick={verify} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[#014e47] disabled:opacity-60">
              {busy === "verify" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Confirm
            </button>
          </div>
          <p className="m-0 mt-2 text-[12px] text-slate-500">
            {resendIn > 0 ? `Send again in ${resendIn}s` : (
              <button type="button" onClick={send} disabled={Boolean(busy)} className="border-0 bg-transparent p-0 text-[12px] font-semibold text-[#02665e] hover:underline">Send a new code</button>
            )}
            <span className="mx-1.5 text-slate-300">·</span>
            <button type="button" onClick={reject} disabled={Boolean(busy)} className="border-0 bg-transparent p-0 text-[12px] font-semibold text-slate-500 hover:text-rose-700 hover:underline">Not my email</button>
          </p>
        </div>
      )}
      {error ? <p role="alert" className="m-0 mt-2 pl-12 text-[12.5px] text-rose-700">{error}</p> : null}
      <p className="m-0 mt-2 pl-12 text-[11.5px] text-slate-400">Optional now. You can also do it later in your profile.</p>
    </div>
  );
}

/** Lookalike characters (0/O, 1/l/I) are left out so it can be typed from a note. */
const PASSWORD_ALPHABET = {
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lower: "abcdefghijkmnpqrstuvwxyz",
  digit: "23456789",
  symbol: "!@#$%*-_+=?",
};

/** Uniform random integer in [0, n) from the secure generator (rejection sampling, no bias). */
function randomIndex(n: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

function securePassword(length: number): string {
  const all = Object.values(PASSWORD_ALPHABET).join("");
  const pick = (set: string) => set[randomIndex(set.length)];
  // One of each kind, then random fill, then a Fisher-Yates shuffle.
  const chars = [pick(PASSWORD_ALPHABET.upper), pick(PASSWORD_ALPHABET.lower), pick(PASSWORD_ALPHABET.digit), pick(PASSWORD_ALPHABET.symbol)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Live "expires in" so the person knows how long the link lasts. */
function ExpiryChip({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const left = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(left)) return null;
  const mins = Math.max(0, Math.floor(left / 60_000));
  const text = mins >= 1440 ? `${Math.floor(mins / 1440)} d ${Math.floor((mins % 1440) / 60)} h` : mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  const soon = mins < 60;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 ${soon ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-white/85"}`}
      title={`Works until ${formatExpiry(expiresAt) ?? ""}`}
    >
      <Clock className={`h-3.5 w-3.5 ${soon ? "text-amber-300" : "text-white/55"}`} aria-hidden />
      Link expires in {text}
    </span>
  );
}

/** Four bars: requirements met first, then length past the minimum. */
function StrengthMeter({ password, requirementsMet, requirementsTotal, minLength }: { password: string; requirementsMet: number; requirementsTotal: number; minLength: number }) {
  if (!password) return null;
  const allMet = requirementsTotal > 0 && requirementsMet === requirementsTotal;
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  let level = 1;
  if (allMet) level = 2;
  if (allMet && (password.length >= minLength + 4 || variety >= 4)) level = 3;
  if (allMet && password.length >= Math.max(14, minLength + 6) && variety >= 3) level = 4;
  const meta = [
    { label: "Too weak", bar: "bg-rose-500", text: "text-rose-700" },
    { label: "Okay", bar: "bg-amber-500", text: "text-amber-700" },
    { label: "Good", bar: "bg-emerald-500", text: "text-emerald-700" },
    { label: "Strong", bar: "bg-[#02665e]", text: "text-[#02665e]" },
  ][level - 1];
  return (
    <div id="password-strength" className="mt-2.5 flex items-center gap-3" aria-live="polite">
      <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`h-1.5 rounded-full transition-colors ${n <= level ? meta.bar : "bg-slate-200"}`} />
        ))}
      </div>
      <span className={`w-16 shrink-0 text-right text-[11.5px] font-semibold ${meta.text}`}>{meta.label}</span>
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
