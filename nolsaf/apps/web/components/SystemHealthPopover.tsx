"use client";

import { Fragment, useCallback, useEffect, useState, type ElementType } from "react";
import { Popover, Transition } from "@headlessui/react";
import {
  ChevronUp,
  Database,
  HeartPulse,
  RefreshCw,
  Server,
  Wifi,
} from "lucide-react";

type HealthState = "checking" | "healthy" | "unavailable";
type HealthSamples = {
  connection: boolean[];
  api: boolean[];
  database: boolean[];
};

const SAMPLE_LIMIT = 10;

type SystemHealthPopoverProps = {
  variant?: "light" | "dark";
  className?: string;
};

function appendSample(samples: boolean[], value: boolean) {
  return [...samples, value].slice(-SAMPLE_LIMIT);
}

function healthPercent(samples: boolean[]) {
  if (!samples.length) return null;
  return Math.round((samples.filter(Boolean).length / samples.length) * 100);
}

function ServiceRow({
  Icon,
  label,
  status,
  percent,
}: {
  Icon: ElementType;
  label: string;
  status: HealthState;
  percent: number | null;
}) {
  const traceTone = status === "checking"
    ? "stroke-amber-400"
    : status === "unavailable" || (percent != null && percent < 80)
      ? "stroke-rose-500"
      : percent != null && percent < 100
        ? "stroke-amber-400"
        : "stroke-emerald-500";
  const textTone = status === "checking"
    ? "text-amber-700"
    : status === "unavailable" || (percent != null && percent < 80)
      ? "text-rose-700"
      : percent != null && percent < 100
        ? "text-amber-700"
        : "text-emerald-700";

  return (
    <div className="flex items-center gap-2.5 py-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-xs font-semibold text-slate-700">{label}</span>
          <span className={`shrink-0 text-[11px] font-extrabold tabular-nums ${textTone}`}>
            {percent == null ? "Checking" : `${percent}%`}
          </span>
        </div>
        <div
          className="mt-1 h-3"
          role="progressbar"
          aria-label={`${label} recent health`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          aria-valuetext={percent == null ? "Checking" : `${percent} percent`}
        >
          <svg viewBox="0 0 320 12" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
            <path
              d="M1 6 H72 L80 6 L85 2 L91 10 L97 4 L104 6 H210 L218 6 L223 2.5 L229 9.5 L235 4 L242 6 H319"
              fill="none"
              className="stroke-slate-200"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength="100"
            />
            <path
              d="M1 6 H72 L80 6 L85 2 L91 10 L97 4 L104 6 H210 L218 6 L223 2.5 L229 9.5 L235 4 L242 6 H319"
              fill="none"
              className={`${traceTone} transition-all duration-500 ${status === "healthy" ? "animate-[pulse_2s_ease-in-out_infinite]" : status === "checking" ? "animate-pulse" : ""}`}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength="100"
              strokeDasharray={`${percent ?? 0} 100`}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

function latencyDescription(latencyMs: number | null, health: HealthState) {
  if (health !== "healthy" || latencyMs == null) return "No response";
  if (latencyMs <= 300) return "Fast";
  if (latencyMs <= 800) return "Stable";
  return "Slow";
}

export default function SystemHealthPopover({
  variant = "light",
  className = "",
}: SystemHealthPopoverProps) {
  const [health, setHealth] = useState<HealthState>("checking");
  const [api, setApi] = useState<HealthState>("checking");
  const [database, setDatabase] = useState<HealthState>("checking");
  const [online, setOnline] = useState(true);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [samples, setSamples] = useState<HealthSamples>({
    connection: [],
    api: [],
    database: [],
  });

  const recordSample = useCallback((connectionReady: boolean, apiReady: boolean, databaseReady: boolean) => {
    setSamples((current) => ({
      connection: appendSample(current.connection, connectionReady),
      api: appendSample(current.api, apiReady),
      database: appendSample(current.database, databaseReady),
    }));
  }, []);

  const checkHealth = useCallback(async (signal?: AbortSignal, manual = false) => {
    const browserOnline = typeof navigator === "undefined" || navigator.onLine;
    setOnline(browserOnline);
    if (manual) setRefreshing(true);

    if (!browserOnline) {
      setHealth("unavailable");
      setApi("unavailable");
      setDatabase("unavailable");
      setLatencyMs(null);
      setLastCheckedAt(new Date());
      setRefreshing(false);
      recordSample(false, false, false);
      return;
    }

    const startedAt = performance.now();
    try {
      const response = await fetch("/api/ready", {
        cache: "no-store",
        credentials: "include",
        signal,
      });
      const payload = await response.json().catch(() => null);
      const apiReady = response.ok && payload?.status === "ready";
      const databaseReady = apiReady && payload?.checks?.database === "ok";

      setHealth(apiReady && databaseReady ? "healthy" : "unavailable");
      setApi("healthy");
      setDatabase(databaseReady ? "healthy" : "unavailable");
      setLatencyMs(Math.max(1, Math.round(performance.now() - startedAt)));
      setLastCheckedAt(new Date());
      recordSample(true, true, databaseReady);
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        setHealth("unavailable");
        setApi("unavailable");
        setDatabase("unavailable");
        setLatencyMs(null);
        setLastCheckedAt(new Date());
        recordSample(true, false, false);
      }
    } finally {
      setRefreshing(false);
    }
  }, [recordSample]);

  useEffect(() => {
    const controller = new AbortController();
    void checkHealth(controller.signal);
    const interval = window.setInterval(() => void checkHealth(), 60_000);
    const onOnline = () => {
      setHealth("checking");
      setApi("checking");
      setDatabase("checking");
      setOnline(true);
      void checkHealth();
    };
    const onOffline = () => {
      setOnline(false);
      setHealth("unavailable");
      setApi("unavailable");
      setDatabase("unavailable");
      setLatencyMs(null);
      setLastCheckedAt(new Date());
      recordSample(false, false, false);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [checkHealth, recordSample]);

  const performanceDegraded = health === "healthy" && latencyMs != null && latencyMs > 800;
  const statusLabel =
    health === "healthy"
      ? performanceDegraded ? "Systems slow" : "Systems ok"
      : health === "checking"
        ? "Checking"
        : "Connection issue";
  const statusDot =
    health === "healthy"
      ? performanceDegraded
        ? "bg-amber-400"
        : variant === "dark" ? "bg-emerald-400" : "bg-emerald-500"
      : health === "checking"
        ? "bg-amber-400 animate-pulse"
        : "bg-rose-500";
  const heartTone =
    health === "healthy"
      ? performanceDegraded
        ? "text-amber-500"
        : variant === "dark" ? "text-emerald-400" : "text-emerald-600"
      : "text-transparent";
  const buttonTone =
    variant === "dark"
      ? "text-white/60 hover:bg-white/[0.07] hover:text-white focus-visible:ring-emerald-300/35"
      : "text-neutral-500 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:ring-emerald-500/25";
  const checkedTime = lastCheckedAt?.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const latencyLabel = latencyDescription(latencyMs, health);
  const latencyTextTone =
    health !== "healthy"
      ? "text-rose-700"
      : performanceDegraded
        ? "text-amber-700"
        : "text-emerald-700";
  const connectionPercent = healthPercent(samples.connection);
  const apiPercent = healthPercent(samples.api);
  const databasePercent = healthPercent(samples.database);
  const sampleCount = samples.connection.length;
  const latencyScore =
    health === "healthy" && latencyMs != null
      ? Math.max(8, Math.min(100, Math.round(106 - latencyMs / 12)))
      : 0;
  const gaugeTone =
    health !== "healthy"
      ? "#f43f5e"
      : latencyMs != null && latencyMs > 800
        ? "#f59e0b"
        : "#10b981";

  return (
    <Popover className={`relative inline-flex ${className}`}>
      {({ open }) => (
        <>
          <Popover.Button
            type="button"
            className={`group inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-1.5 py-1 font-bold outline-none transition-colors focus-visible:ring-2 ${buttonTone}`}
            aria-label={`${statusLabel}. Open system health details.`}
            title="View system health"
          >
            <span className="relative flex h-4 w-4 items-center justify-center" aria-hidden>
              <span className={`absolute h-2 w-2 rounded-full ${statusDot}`} />
              <HeartPulse className={`relative h-3.5 w-3.5 ${heartTone}`} />
            </span>
            <span>{statusLabel}</span>
            <ChevronUp
              className={`h-3 w-3 opacity-45 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          </Popover.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-150"
            enterFrom="opacity-0 translate-y-2 scale-[0.98]"
            enterTo="opacity-100 translate-y-0 scale-100"
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100 translate-y-0 scale-100"
            leaveTo="opacity-0 translate-y-2 scale-[0.98]"
          >
            <Popover.Panel className="absolute bottom-full left-1/2 z-[100] mb-3 w-[min(21rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white text-left text-slate-800 shadow-[0_24px_60px_-20px_rgba(15,23,42,0.38)]">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
                <div>
                  <p className="m-0 text-sm font-extrabold text-slate-900">System health</p>
                  <p className="mb-0 mt-1 text-[11px] font-medium text-slate-500">
                    Recent health from up to {SAMPLE_LIMIT} live checks
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void checkHealth(undefined, true)}
                  disabled={refreshing}
                  className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
                  aria-label="Refresh system health"
                  title="Refresh system health"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
                </button>
              </div>

              <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 bg-slate-50/80 px-4 py-4">
                <div className="relative h-[5.25rem] w-[7.5rem]" aria-label={`API response: ${latencyMs == null ? "unavailable" : `${latencyMs} milliseconds`}`}>
                  <svg viewBox="0 0 120 72" className="h-full w-full" role="img" aria-hidden>
                    <path d="M 12 62 A 48 48 0 0 1 108 62" fill="none" stroke="#e2e8f0" strokeWidth="9" strokeLinecap="round" pathLength="100" />
                    <path
                      d="M 12 62 A 48 48 0 0 1 108 62"
                      fill="none"
                      stroke={gaugeTone}
                      strokeWidth="9"
                      strokeLinecap="round"
                      pathLength="100"
                      strokeDasharray={`${latencyScore} 100`}
                      className="transition-all duration-500"
                    />
                  </svg>
                  <div className="absolute inset-x-0 bottom-0 text-center">
                    <span className="block text-xl font-black leading-none tabular-nums text-slate-900">
                      {latencyMs == null ? "—" : latencyMs}
                    </span>
                    <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">
                      {latencyMs == null ? "response" : "ms response"}
                    </span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">API response</p>
                  <p className={`mb-0 mt-1 text-base font-extrabold ${latencyTextTone}`}>
                    {latencyLabel}
                  </p>
                  <p className="mb-0 mt-1 text-[11px] font-medium leading-4 text-slate-500">
                    Includes the server and database readiness check.
                  </p>
                </div>
              </div>

              <div className="px-4 pt-3">
                <div className="flex items-center justify-between gap-3 pb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  <span>Recent availability</span>
                  <span className="normal-case tracking-normal">Last {sampleCount || 0} / {SAMPLE_LIMIT} checks</span>
                </div>
                <div className="divide-y divide-slate-100">
                  <ServiceRow Icon={Wifi} label="Your connection" status={online ? "healthy" : "unavailable"} percent={connectionPercent} />
                  <ServiceRow Icon={Server} label="NoLSAF API" status={api} percent={apiPercent} />
                  <ServiceRow Icon={Database} label="Database" status={database} percent={databasePercent} />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-[10px] font-semibold text-slate-500">
                <span>{health === "healthy" ? performanceDegraded ? "Services available · response is slow" : "All monitored services are ready" : "Some services need attention"}</span>
                <span className="shrink-0 tabular-nums">{checkedTime ? `Checked ${checkedTime}` : "Checking now"}</span>
              </div>
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
}
