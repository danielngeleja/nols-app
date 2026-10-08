"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, LifeBuoy, RefreshCw } from "lucide-react";

type HealthState = "checking" | "healthy" | "unavailable";

const OWNER_POLICIES = [
  { href: "/owner/terms", label: "Terms" },
  { href: "/owner/privacy", label: "Privacy" },
  { href: "/owner/cookies-policy", label: "Cookies" },
  { href: "/owner/verification-policy", label: "Verification" },
  { href: "/owner/cancellation-policy", label: "Cancellation" },
  { href: "/owner/property-owner-disbursement-policy", label: "Owner disbursements" },
] as const;

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  return parts.length === 2 ? parts.pop()?.split(";").shift() || null : null;
}

export default function OwnerFooter() {
  const year = new Date().getFullYear();
  const [health, setHealth] = useState<HealthState>("checking");
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    const role = getCookie("role");
    sessionStorage.setItem("navigationContext", role?.toLowerCase() || "owner");
  }, []);

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    if (!navigator.onLine) {
      setHealth("unavailable");
      setLastCheckedAt(new Date());
      return;
    }

    try {
      const response = await fetch("/api/ready", {
        cache: "no-store",
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error(`Readiness check failed: ${response.status}`);
      const payload = await response.json().catch(() => null);
      const ready = payload?.status === "ready" && payload?.checks?.database === "ok";
      setHealth(ready ? "healthy" : "unavailable");
      setLastCheckedAt(new Date());
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        setHealth("unavailable");
        setLastCheckedAt(new Date());
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkHealth(controller.signal);
    const interval = window.setInterval(() => void checkHealth(), 60_000);
    const onOnline = () => {
      setHealth("checking");
      void checkHealth();
    };
    const onOffline = () => {
      setHealth("unavailable");
      setLastCheckedAt(new Date());
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [checkHealth]);

  const checkedTime = lastCheckedAt?.toLocaleTimeString("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Plain words for the owner: is NoLSAF reachable right now?
  const status = {
    healthy: { label: "All systems running", dot: "bg-emerald-500", text: "text-emerald-700", ring: "ring-emerald-200", bg: "bg-emerald-50" },
    checking: { label: "Checking connection", dot: "bg-amber-400", text: "text-amber-700", ring: "ring-amber-200", bg: "bg-amber-50" },
    unavailable: { label: "Can't reach NoLSAF", dot: "bg-rose-500", text: "text-rose-700", ring: "ring-rose-200", bg: "bg-rose-50" },
  }[health];
  const statusTitle =
    health === "healthy"
      ? `NoLSAF and its database answered${checkedTime ? ` at ${checkedTime} EAT` : ""}`
      : health === "checking"
        ? "Checking that NoLSAF is reachable"
        : `NoLSAF did not answer${checkedTime ? ` at ${checkedTime} EAT` : ""}. Check your internet, then retry.`;
  const retry = () => {
    setHealth("checking");
    void checkHealth();
  };

  return (
    <div className="public-container py-3">
      <footer
        aria-label="Owner workspace resources"
        className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_8px_24px_-22px_rgba(15,23,42,0.5)]"
      >
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-6 lg:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={28} height={28} sizes="28px" className="h-7 w-7 shrink-0" />
            <div className="min-w-0 leading-tight">
              <p className="m-0 text-xs font-bold text-slate-900">Owner workspace</p>
              <p className="m-0 mt-0.5 whitespace-nowrap text-[10.5px] text-slate-400">© {year} NoLSAF · v0.1.0</p>
            </div>
          </div>

          <nav aria-label="Owner policies" className="min-w-0 flex-1 lg:border-0 lg:border-l lg:border-solid lg:border-slate-200 lg:pl-5">
            <ul className="m-0 flex list-none flex-wrap items-center gap-x-0.5 gap-y-0.5 p-0">
              {OWNER_POLICIES.map((policy) => (
                <li key={policy.href}>
                  <Link
                    href={policy.href}
                    className="inline-flex min-h-7 items-center rounded-lg px-2 py-1 text-[11.5px] font-medium text-slate-600 no-underline transition-colors hover:bg-slate-50 hover:text-[#02665e] hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20"
                  >
                    {policy.label}
                  </Link>
                </li>
              ))}
              <li className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" aria-hidden />
              <li>
                <Link
                  href="/owner/docs"
                  className="inline-flex min-h-7 items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[#02665e] no-underline transition-colors hover:bg-emerald-50 hover:text-[#014d47] hover:no-underline"
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden />
                  Docs
                </Link>
              </li>
              <li>
                <Link
                  href="/owner/support"
                  className="inline-flex min-h-7 items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[#02665e] no-underline transition-colors hover:bg-emerald-50 hover:text-[#014d47] hover:no-underline"
                >
                  <LifeBuoy className="h-3.5 w-3.5" aria-hidden />
                  Help
                </Link>
              </li>
            </ul>
          </nav>

          <div className="flex w-fit shrink-0 items-center gap-1.5">
            <div
              role="status"
              aria-live="polite"
              aria-label={`${status.label}. ${statusTitle}`}
              title={statusTitle}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11.5px] font-semibold ring-1 ring-inset ${status.bg} ${status.ring} ${status.text}`}
            >
              <span className="relative flex h-2 w-2" aria-hidden>
                {health === "healthy" && <span className={`absolute inline-flex h-full w-full rounded-full opacity-40 ${status.dot}`} />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${status.dot}`} />
              </span>
              {status.label}
              {checkedTime && health !== "checking" ? <span className="font-normal text-slate-400">· {checkedTime}</span> : null}
            </div>
            {health === "unavailable" && (
              <button
                type="button"
                onClick={retry}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-solid border-slate-200 bg-white px-3 text-[11.5px] font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Retry
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
