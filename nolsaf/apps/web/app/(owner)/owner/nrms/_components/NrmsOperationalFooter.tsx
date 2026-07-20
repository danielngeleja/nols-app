"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, Headphones, HeartPulse } from "lucide-react";

type HealthState = "checking" | "healthy" | "unavailable";

export default function NrmsOperationalFooter() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setHealth("unavailable");
      setLastCheckedAt(new Date());
      return;
    }
    try {
      const response = await fetch("/api/ready", { cache: "no-store", credentials: "include", signal });
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
    const onOnline = () => { setHealth("checking"); void checkHealth(); };
    const onOffline = () => setHealth("unavailable");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [checkHealth]);

  const statusLabel = health === "healthy" ? "Systems ok" : health === "checking" ? "Checking" : "Connection issue";
  const statusDot = health === "healthy" ? "bg-emerald-500" : health === "checking" ? "bg-amber-400" : "bg-rose-500";
  const checkedTime = lastCheckedAt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const statusTitle = health === "healthy"
    ? `NoLSAF systems are operating normally${checkedTime ? ` · checked ${checkedTime}` : ""}`
    : health === "checking"
      ? "Checking system status"
      : `We're having trouble reaching NoLSAF${checkedTime ? ` · checked ${checkedTime}` : ""}`;

  return (
    <footer
      aria-label="NRMS workspace resources"
      className="mx-3 mb-3 mt-2 shrink-0 rounded-2xl border border-neutral-200 bg-white px-3.5 py-2 shadow-sm sm:px-5"
    >
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-neutral-500">
        <Link
          href="/owner/property-owner-disbursement-policy"
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 no-underline transition-colors hover:text-neutral-900 hover:no-underline"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Policies
        </Link>

        <span
          title={statusTitle}
          aria-label={`${statusLabel}. ${statusTitle}`}
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1"
        >
          <span className="relative flex h-4 w-4 items-center justify-center" aria-hidden>
            <span className={`absolute h-2 w-2 rounded-full ${statusDot}`} />
            <HeartPulse className={`relative h-3.5 w-3.5 ${health === "healthy" ? "text-emerald-600" : "text-transparent"}`} />
          </span>
          {statusLabel}
        </span>

        <Link
          href="/owner/nrms/help"
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 no-underline transition-colors hover:text-neutral-900 hover:no-underline"
        >
          <Headphones className="h-3.5 w-3.5" aria-hidden />
          Help
        </Link>
      </div>
    </footer>
  );
}
