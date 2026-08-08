"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, HeartPulse, ShieldCheck } from "lucide-react";

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

  const checkedTime = lastCheckedAt?.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusLabel =
    health === "healthy" ? "Systems operational" : health === "checking" ? "Checking systems" : "Service check unavailable";
  const statusTitle =
    health === "healthy"
      ? `NoLSAF and database checks passed${checkedTime ? ` · checked ${checkedTime}` : ""}`
      : health === "checking"
        ? "Checking NoLSAF platform readiness"
        : `NoLSAF readiness could not be confirmed${checkedTime ? ` · checked ${checkedTime}` : ""}`;
  const dotTone = health === "healthy" ? "bg-emerald-500" : health === "checking" ? "bg-amber-400" : "bg-rose-500";
  const statusTone = health === "healthy" ? "text-emerald-700" : health === "checking" ? "text-amber-700" : "text-rose-700";

  return (
    <div className="public-container py-3">
      <footer
        aria-label="Owner workspace resources"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_24px_-22px_rgba(15,23,42,0.5)]"
      >
        <div className="grid gap-3 px-4 py-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="m-0 text-xs font-bold text-slate-800">Owner workspace</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-[10px] text-slate-400">© {year} NoLSAF · v0.1.0</p>
            </div>
          </div>

          <nav aria-label="Owner policies" className="min-w-0 lg:px-3">
            <ul className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-0.5 p-0 lg:justify-center">
              {OWNER_POLICIES.map((policy) => (
                <li key={policy.href}>
                  <Link
                    href={policy.href}
                    className="inline-flex min-h-7 items-center rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 no-underline transition-colors hover:bg-slate-50 hover:text-[#02665e] hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20"
                  >
                    {policy.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/owner/docs"
                  className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 no-underline transition-colors hover:bg-slate-50 hover:text-[#02665e] hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20"
                >
                  <BookOpen className="h-3 w-3" aria-hidden />
                  Docs
                </Link>
              </li>
            </ul>
          </nav>

          <div
            role="status"
            aria-live="polite"
            aria-label={`${statusLabel}. ${statusTitle}`}
            title={statusTitle}
            className={`inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold ${statusTone}`}
          >
            <span className="relative flex h-4 w-4 items-center justify-center" aria-hidden>
              <span className={`absolute h-2 w-2 rounded-full ${dotTone} ${health === "checking" ? "animate-pulse" : ""}`} />
              <HeartPulse className={`relative h-3.5 w-3.5 ${health === "healthy" ? "text-emerald-600" : "text-transparent"}`} />
            </span>
            {statusLabel}
          </div>
        </div>
      </footer>
    </div>
  );
}
