"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, MailCheck } from "lucide-react";

type VerifyState =
  | { status: "checking"; message: string; redirectPath?: string }
  | { status: "success"; message: string; redirectPath: string }
  | { status: "error"; message: string; redirectPath?: string };

export default function EmailVerifyClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const failedMessage = searchParams.get("message") || "";
  const failedStatus = searchParams.get("status") || "";
  const [state, setState] = useState<VerifyState>({
    status: "checking",
    message: "Verifying your email address...",
  });

  const icon = useMemo(() => {
    if (state.status === "success") return <CheckCircle2 className="h-7 w-7 text-emerald-700" aria-hidden />;
    if (state.status === "error") return <AlertCircle className="h-7 w-7 text-rose-700" aria-hidden />;
    return <Loader2 className="h-7 w-7 animate-spin text-[#02665e]" aria-hidden />;
  }, [state.status]);

  useEffect(() => {
    if (failedStatus === "failed") {
      setState({
        status: "error",
        message: failedMessage || "This verification link could not be completed.",
      });
      return;
    }

    if (!token) {
      setState({
        status: "error",
        message: "This verification link is missing its token. Please request a new email verification link.",
      });
      return;
    }

    let cancelled = false;

    // Guard against a hung/slow request so the page can't spin forever.
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 20000);

    async function verifyEmail() {
      try {
        const response = await fetch(`/api/public/email/verify?token=${encodeURIComponent(token)}&format=json`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));

        if (cancelled) return;

        if (!response.ok || !data?.ok) {
          setState({
            status: "error",
            message: data?.error || "This verification link is invalid or has expired.",
          });
          return;
        }

        const redirectPath = typeof data.redirectPath === "string" ? data.redirectPath : "/account/security?email_verified=1";
        setState({
          status: "success",
          message: "Email verified successfully. Taking you back to your account...",
          redirectPath,
        });

        window.setTimeout(() => {
          router.replace(redirectPath);
        }, 1200);
      } catch (err) {
        if (!cancelled) {
          const timedOut = err instanceof DOMException && err.name === "AbortError";
          setState({
            status: "error",
            message: timedOut
              ? "Verifying your email is taking longer than expected. Please try the link again in a moment."
              : "We could not verify your email right now. Please check your connection and try again.",
          });
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void verifyEmail();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [failedMessage, failedStatus, router, token]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 flex items-center justify-center">
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
        <div className="bg-[#02665e] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
              <MailCheck className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-bold text-white/70">NoLSAF account</p>
              <h1 className="text-xl font-extrabold tracking-tight">Email verification</h1>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-start gap-4">
            <span
              className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
                state.status === "success" ? "bg-emerald-50" : state.status === "error" ? "bg-rose-50" : "bg-teal-50"
              }`}
            >
              {icon}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold text-slate-950">
                {state.status === "success" ? "Verification complete" : state.status === "error" ? "Verification failed" : "Checking link"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{state.message}</p>
            </div>
          </div>

          <div className="mt-6">
            {state.status === "success" ? (
              <Link
                href={state.redirectPath}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-[#02665e] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#014d47]"
              >
                Continue
              </Link>
            ) : state.status === "error" ? (
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
              >
                Back to sign in
              </Link>
            ) : (
              <div className="h-11 rounded-2xl bg-slate-100" aria-hidden />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
