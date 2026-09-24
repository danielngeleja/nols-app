"use client";

// Compact footer for the tour-agent workspace, mirroring NrmsOperationalFooter.
// The workspace is an operational surface, so it gets a status bar rather than
// the marketing footer: the sidebar already carries the account navigation the
// big footer duplicated. AgentFooter is still used on /about, /careers and
// /help, where the full link set belongs.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Headphones, HeartPulse } from "lucide-react";

type HealthState = "checking" | "healthy" | "unavailable";

// These open in LegalModal, which the account layout already mounts on agent
// routes. Linking to /terms and friends dropped the operator out of the
// workspace and onto the public marketing chrome, losing the rail and header.
// "contract" is the operator's own partnership agreement, which belongs here
// alongside the policies it is governed by.
const POLICY_DOCS: Array<{ type: "terms" | "privacy" | "cookies" | "contract"; label: string }> = [
  { type: "contract", label: "Contract" },
  { type: "terms", label: "Terms" },
  { type: "privacy", label: "Privacy" },
  { type: "cookies", label: "Cookies" },
];

export default function AgentOperationalFooter() {
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
    const onOnline = () => {
      setHealth("checking");
      void checkHealth();
    };
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
  const statusDot = health === "healthy" ? "bg-emerald-400" : health === "checking" ? "bg-amber-300" : "bg-red-400";
  const checkedTime = lastCheckedAt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const statusTitle =
    health === "healthy"
      ? `NoLSAF systems are operating normally${checkedTime ? ` · checked ${checkedTime}` : ""}`
      : health === "checking"
        ? "Checking system status"
        : `We're having trouble reaching NoLSAF${checkedTime ? ` · checked ${checkedTime}` : ""}`;

  const linkClass =
    "inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-white/60 no-underline transition-colors hover:bg-white/[0.07] hover:text-white hover:no-underline";

  return (
    <footer
      aria-label="Agent workspace resources"
      className="mb-3 mt-2 shrink-0 rounded-2xl border border-solid border-white/10 bg-[#252d2c] px-3.5 py-2 text-white sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-bold text-white/60">
        <nav aria-label="Policies and agreements" className="flex items-center gap-1">
          {POLICY_DOCS.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("open-legal", { detail: { type } }))}
              className={`${linkClass} cursor-pointer appearance-none border-0 bg-transparent font-bold`}
            >
              {label}
            </button>
          ))}
        </nav>

        <span title={statusTitle} aria-label={`${statusLabel}. ${statusTitle}`} className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1">
          <span className="relative flex h-4 w-4 items-center justify-center" aria-hidden>
            <span className={`absolute h-2 w-2 rounded-full ${statusDot}`} />
            <HeartPulse className={`relative h-3.5 w-3.5 ${health === "healthy" ? "text-emerald-400" : "text-transparent"}`} />
          </span>
          {statusLabel}
        </span>

        <Link href="/account/agent/help" className={linkClass}>
          <Headphones className="h-3.5 w-3.5" aria-hidden />
          Help
        </Link>
      </div>
    </footer>
  );
}
