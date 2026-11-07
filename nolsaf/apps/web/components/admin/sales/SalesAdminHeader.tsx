"use client";

/**
 * Shared header for admin Sales pages: a compact dark band with the page
 * title, a small key-figures panel, refresh, and the page's tabs. Navigation
 * between Sales pages lives in the admin sidebar, not here.
 */
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Lock, RefreshCw } from "lucide-react";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** `title` carries the exact figure when `value` is shortened (e.g. "TZS 1.25B"). */
export type HeaderMetric = { label: string; value: ReactNode; title?: string; sub?: ReactNode; tone?: "default" | "good" | "warn" | "muted" };
export type HeaderTab<K extends string> = { key: K; label: string; Icon: Icon; count?: number };

const TONE: Record<NonNullable<HeaderMetric["tone"]>, string> = {
  default: "text-white",
  good: "text-emerald-300",
  warn: "text-amber-300",
  muted: "text-white/45",
};

export default function SalesAdminHeader<K extends string>({
  title,
  description,
  badge,
  metrics,
  onRefresh,
  loading,
  refreshLabel = "Refresh",
  tabs,
  activeTab,
  onTab,
}: {
  title: string;
  description: string;
  badge?: string;
  metrics: HeaderMetric[];
  onRefresh?: () => void;
  loading?: boolean;
  refreshLabel?: string;
  tabs?: Array<HeaderTab<K>>;
  activeTab?: K;
  onTab?: (key: K) => void;
}) {
  return (
    <header className="rounded-lg border border-solid border-[#12342f] bg-[#0b2420] text-white">
      <div className="flex flex-col gap-4 px-5 pt-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">
            Sales
            {badge && (
              <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-white/70">
                <Lock className="h-3 w-3" /> {badge}
              </span>
            )}
          </p>
          <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white">{title}</h1>
          <p className="m-0 mt-0.5 max-w-2xl text-[13px] text-white/60">{description}</p>
        </div>

        <div className="flex w-full min-w-0 items-stretch gap-2 md:w-auto">
          {metrics.length > 0 && (
            <dl className="m-0 flex min-w-0 flex-1 items-stretch overflow-hidden rounded-md border border-solid border-white/15 bg-white/[0.04] md:flex-none">
              {metrics.map((m, i) => (
                <div key={m.label} className={`min-w-0 flex-1 px-4 py-2 md:min-w-[88px] md:max-w-[220px] md:flex-none ${i ? "border-0 border-l border-solid border-white/10" : ""}`}>
                  <dt className="truncate text-[11px] text-white/55">{m.label}</dt>
                  <dd className={`m-0 truncate text-lg font-bold tabular-nums leading-tight ${TONE[m.tone ?? "default"]}`} title={m.title}>{m.value}</dd>
                  {m.sub ? <dd className="m-0 truncate text-[11px] text-white/45">{m.sub}</dd> : null}
                </div>
              ))}
            </dl>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="grid w-10 shrink-0 place-items-center rounded-md border border-solid border-white/15 bg-white/[0.04] text-white/80 [font-family:inherit] hover:bg-white/10 hover:text-white disabled:opacity-60"
              aria-label={refreshLabel}
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {tabs && tabs.length > 0 ? (
        <div className="mt-3 flex gap-1 overflow-x-auto border-0 border-t border-solid border-white/10 px-3" role="tablist" aria-label={`${title} views`}>
          {tabs.map(({ key, label, Icon, count }) => {
            const on = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onTab?.(key)}
                className={`relative inline-flex h-10 shrink-0 items-center gap-2 border-0 bg-transparent px-3 text-[13px] font-semibold [font-family:inherit] transition-colors ${on ? "text-white" : "text-white/50 hover:text-white/80"}`}
              >
                <Icon className="h-4 w-4" /> {label}
                {typeof count === "number" && (
                  <span className={`rounded px-1.5 text-[11px] tabular-nums ${on ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/60"}`}>{count}</span>
                )}
                {on && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-emerald-400" aria-hidden />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="h-4" />
      )}
    </header>
  );
}
