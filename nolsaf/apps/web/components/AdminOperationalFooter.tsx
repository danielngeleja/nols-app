"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, Headphones, HeartPulse, ScrollText } from "lucide-react";

type HealthState = "checking" | "healthy" | "unavailable";
type ImpactSummary = {
  activeClients: number;
  impactedClients: number;
  healthyClients: number;
  attentionRequired: boolean;
};

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";

function getEnvironmentLabel() {
  const configured = process.env.NEXT_PUBLIC_APP_ENV?.trim();
  if (configured) return configured;
  if (typeof window === "undefined") return "Production";

  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return "Local";
  if (hostname.includes("staging") || hostname.includes("preview")) return "Staging";
  return "Production";
}

const quickLinks = [
  { href: "/admin/support", label: "Support", Icon: Headphones },
  { href: "/admin/management/audit-log", label: "Audit log", Icon: ScrollText },
] as const;

export default function AdminOperationalFooter() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [environment, setEnvironment] = useState("Production");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [impact, setImpact] = useState<ImpactSummary | null>(null);
  const [impactUnavailable, setImpactUnavailable] = useState(false);

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setHealth("unavailable");
      setLatencyMs(null);
      setLastCheckedAt(new Date());
      return;
    }

    const startedAt = performance.now();
    try {
      // Readiness verifies both the API process and database connectivity.
      const response = await fetch("/api/ready", {
        cache: "no-store",
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error(`Readiness check failed: ${response.status}`);
      const payload = await response.json().catch(() => null);
      const ready = payload?.status === "ready" && payload?.checks?.database === "ok";
      setHealth(ready ? "healthy" : "unavailable");
      setLatencyMs(Math.max(1, Math.round(performance.now() - startedAt)));
      setLastCheckedAt(new Date());
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        setHealth("unavailable");
        setLatencyMs(null);
        setLastCheckedAt(new Date());
      }
    }
  }, []);

  const checkImpact = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/observability/impact-summary", {
        cache: "no-store",
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error(`Impact check failed: ${response.status}`);
      const payload = await response.json();
      setImpact({
        activeClients: Number(payload?.activeClients ?? 0),
        impactedClients: Number(payload?.impactedClients ?? 0),
        healthyClients: Number(payload?.healthyClients ?? 0),
        attentionRequired: Boolean(payload?.attentionRequired),
      });
      setImpactUnavailable(false);
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") setImpactUnavailable(true);
    }
  }, []);

  useEffect(() => {
    setEnvironment(getEnvironmentLabel());
    const controller = new AbortController();
    void checkHealth(controller.signal);
    void checkImpact(controller.signal);

    const healthInterval = window.setInterval(() => void checkHealth(), 60_000);
    const impactInterval = window.setInterval(() => void checkImpact(), 30_000);
    const onOnline = () => {
      setHealth("checking");
      void checkHealth();
      void checkImpact();
    };
    const onOffline = () => setHealth("unavailable");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      controller.abort();
      window.clearInterval(healthInterval);
      window.clearInterval(impactInterval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [checkHealth, checkImpact]);

  const statusLabel = health === "healthy"
    ? "System ready"
    : health === "checking"
      ? "Checking systems"
      : "Connection issue";

  const statusTone = health === "healthy"
    ? "bg-emerald-500"
    : health === "checking"
      ? "bg-amber-400"
      : "bg-rose-500";

  const checkedTime = lastCheckedAt?.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const statusTitle = health === "healthy"
    ? `API and database ready${latencyMs != null ? ` · ${latencyMs} ms` : ""}${checkedTime ? ` · checked ${checkedTime}` : ""}`
    : health === "checking"
      ? "Checking API and database readiness"
      : `API or database is unavailable${checkedTime ? ` · checked ${checkedTime}` : ""}`;

  const impactLabel = impactUnavailable
    ? "Impact unavailable"
    : !impact
      ? "Checking impact"
      : impact.attentionRequired
        ? impact.activeClients > 0
          ? `${impact.impactedClients} / ${impact.activeClients} impacted`
          : `${impact.impactedClients} client${impact.impactedClients === 1 ? "" : "s"} impacted`
        : impact.activeClients > 0
          ? `${impact.healthyClients} / ${impact.activeClients} healthy`
          : "No active impact";
  const impactTitle = impactUnavailable
    ? "Could not load client impact data"
    : !impact
      ? "Checking authenticated client impact"
      : impact.attentionRequired
        ? `${impact.impactedClients} authenticated client${impact.impactedClients === 1 ? " is" : "s are"} currently impacted. Review required.`
        : impact.activeClients > 0
          ? `${impact.healthyClients} of ${impact.activeClients} active authenticated clients have no open impact.`
          : "No authenticated clients are currently active and no open impact requires attention.";

  return (
    <footer
      aria-label="Admin workspace status and resources"
      className="relative z-10 mx-3 mb-3 mt-2 shrink-0 rounded-2xl border border-white/10 bg-[#0b1424] px-3.5 py-2 shadow-[0_10px_24px_rgba(8,20,36,0.16)] sm:px-5"
    >
      <div className="flex min-h-9 items-center justify-between gap-3">
        <Link
          href="/admin/observability"
          className="group inline-flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-300 no-underline transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/30"
          title={`${statusTitle} · Open observability`}
          aria-label={`${statusLabel}. ${statusTitle}. Open observability.`}
        >
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
            <span className={`absolute h-2 w-2 rounded-full ${statusTone}`} />
            <HeartPulse className={`relative h-3.5 w-3.5 ${health === "healthy" ? "text-emerald-300" : "text-transparent"}`} />
          </span>
          <span className="truncate">{statusLabel}</span>
          {health === "healthy" && latencyMs != null && (
            <span className="hidden font-medium tabular-nums text-slate-400 lg:inline">· {latencyMs} ms</span>
          )}
        </Link>

        <nav aria-label="Admin footer shortcuts" className="hidden items-center gap-1 sm:flex">
          {quickLinks.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 no-underline transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/30"
            >
              <Icon className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-px" aria-hidden />
              {label}
            </Link>
          ))}
          <Link
            href="/admin/observability"
            title={impactTitle}
            aria-label={`${impactLabel}. ${impactTitle}`}
            className={`group inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 ${
              impact?.attentionRequired
                ? "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-400/30 hover:bg-red-500/20 focus-visible:ring-red-400/40"
                : "text-slate-400 hover:bg-white/[0.07] hover:text-emerald-300 focus-visible:ring-emerald-400/30"
            }`}
          >
            <span className="relative flex h-4 w-4 items-center justify-center" aria-hidden>
              <Activity className={`relative h-3.5 w-3.5 ${impact?.attentionRequired ? "text-rose-600" : ""}`} />
            </span>
            {impactLabel}
          </Link>
        </nav>

        <div className="flex shrink-0 items-center gap-2 text-[11px] font-semibold text-slate-400">
          <span className="hidden rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 capitalize md:inline-flex">
            {environment}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 tabular-nums">
            v{VERSION}
          </span>
        </div>
      </div>

      <nav aria-label="Admin mobile footer shortcuts" className="mt-1 grid grid-cols-3 gap-1 border-t border-white/10 pt-1 sm:hidden">
        {quickLinks.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-400 no-underline transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </Link>
        ))}
        <Link
          href="/admin/observability"
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold no-underline transition-colors ${
            impact?.attentionRequired ? "bg-red-500/15 text-red-300" : "text-slate-400 hover:bg-white/[0.07] hover:text-emerald-300"
          }`}
          aria-label={`${impactLabel}. ${impactTitle}`}
          title={impactTitle}
        >
          <Activity className="h-3.5 w-3.5" aria-hidden />
          {impact?.attentionRequired ? `${impact.impactedClients} impacted` : "Impact"}
        </Link>
      </nav>
    </footer>
  );
}
