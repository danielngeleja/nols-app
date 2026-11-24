"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock3, CreditCard, KeyRound, Loader2, RefreshCw, Shield, ShieldCheck, User } from "lucide-react";
import api from "@/lib/apiClient";
import TablePagination from "@/components/TablePagination";

const filters = [
  { key: "all", label: "All activity" },
  { key: "payout", label: "Payout details" },
  { key: "security", label: "Security" },
  { key: "sign-in", label: "Sign-ins" },
  { key: "profile", label: "Profile" },
] as const;
type Category = typeof filters[number]["key"];
const icons = { payout: CreditCard, security: KeyRound, "sign-in": Clock3, profile: User };
type Event = {
  id: string; category: keyof typeof icons; label: string; detail: string | null; actor: string;
  tone: "failed" | "change" | "neutral"; createdAt: string; ip: string | null; device: string | null;
};
const bands = {
  CLEAN: { label: "No flagged signals", badge: "bg-teal-50 text-teal-800", bar: "bg-[#39796d]" },
  WATCH: { label: "Watch", badge: "bg-amber-50 text-amber-900", bar: "bg-amber-600" },
  ACTION: { label: "Review needed", badge: "bg-rose-50 text-rose-800", bar: "bg-rose-600" },
  NO_DATA: { label: "No recent records", badge: "bg-slate-100 text-slate-700", bar: "bg-slate-300" },
};
type Signal = {
  key: string; label: string; value: string; severity: Exclude<keyof typeof bands, "NO_DATA">;
  reason: string; rule: string; deduction: number;
};
type Behaviour = { days: number; score: number | null; band: keyof typeof bands; signals: Signal[] };
type Activity = {
  items: Event[]; twoFactorEnabled: boolean;
  pagination?: { page: number; pageSize: number; total: number };
  destination: { type: string; provider: string; ending: string | null; changedAt: string | null } | null;
  behaviour?: Behaviour;
};
const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam",
});
const eat = (value: string) => `${dateTime.format(new Date(value))} EAT`;

function BehaviourScore({ behaviour }: { behaviour: Behaviour }) {
  const { band, days, score, signals } = behaviour;
  const tone = bands[band];
  return (
    <section aria-labelledby="owner-behaviour-score" className="overflow-hidden rounded-md border border-solid border-[#dce8e3] bg-white">
      <div className="bg-[#f4f8f6] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 id="owner-behaviour-score" className="m-0 text-sm font-semibold text-slate-950">Behaviour score</h4>
            <p className="m-0 mt-0.5 text-xs text-slate-600">Last {days} days</p>
          </div>
          <span className={`rounded-sm px-2 py-1 text-xs font-semibold ${tone.badge}`}>{tone.label}</span>
        </div>
        {score != null ? (
          <>
            <div className="mt-2 flex items-baseline gap-1.5">
              <strong className="text-3xl font-semibold leading-none tracking-tight text-slate-950 tabular-nums">{score}</strong>
              <span className="text-xs text-slate-600">/ 100</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${score}%` }} />
            </div>
          </>
        ) : <p className="m-0 mt-2 text-[13px] text-slate-700">A score appears once account activity is recorded in this window.</p>}
      </div>
      <details className="group border-0 border-t border-solid border-[#dce8e3]">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-4 text-[13px] font-semibold text-[#28645a] [&::-webkit-details-marker]:hidden">
          Score breakdown <ChevronDown className="size-4 shrink-0 group-open:rotate-180" aria-hidden />
        </summary>
        <div className="px-4 pb-3">
          <p className="m-0 mb-2 text-xs leading-5 text-slate-600">The score starts at 100. Flagged signals deduct points. Any signal at its review threshold sets the status to Review needed.</p>
          <ul className="m-0 grid list-none gap-2 p-0 lg:grid-cols-2">
            {signals.map((signal) => (
              <li key={signal.key} className="min-w-0 rounded-sm border border-solid border-slate-200 p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-1.5">
                  <span className="text-[13px] font-semibold text-slate-900">{signal.label}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold tabular-nums ${bands[signal.severity].badge}`}>
                    {signal.value}{score != null && signal.deduction > 0 ? ` · −${signal.deduction} pts` : ""}
                  </span>
                </div>
                <p className="m-0 mt-1 text-xs leading-5 text-slate-600">{signal.reason}</p>
                <p className="m-0 mt-0.5 text-xs font-medium text-slate-700">{signal.rule}</p>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}

export default function OwnerAccountActivity({ ownerId, initialCategory }: { ownerId: number; initialCategory?: string | null }) {
  const [category, setCategory] = useState<Category>(() => filters.find((filter) => filter.key === initialCategory)?.key ?? "all");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const timelineTitle = useRef<HTMLHeadingElement>(null);
  const focusOnPageChange = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void api.get<Activity>(`/api/admin/owners/${ownerId}/account-activity`, {
      signal: controller.signal,
      params: { category, page },
    }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setActivity(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [ownerId, category, page, attempt]);

  useEffect(() => {
    if (loading || error || !focusOnPageChange.current) return;
    focusOnPageChange.current = false;
    timelineTitle.current?.focus({ preventScroll: true });
    timelineTitle.current?.scrollIntoView({ block: "start" });
  }, [loading, error]);

  function refresh(nextCategory = category) {
    focusOnPageChange.current = false;
    setActivity((current) => current ? { ...current, items: [], pagination: undefined } : null);
    setLoading(true);
    setCategory(nextCategory);
    setPage(1);
    setAttempt((value) => value + 1);
  }

  const destination = activity?.destination;
  return (
    <section aria-labelledby="owner-account-activity-title" className="min-w-0 rounded-lg border border-solid border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
        <h3 id="owner-account-activity-title" className="m-0 flex items-center gap-2.5 text-base font-semibold text-slate-950"><span className="grid size-8 place-items-center rounded-md bg-[#eaf4f0] text-[#28645a]"><Shield className="size-4" aria-hidden /></span>Account activity</h3>
        <button type="button" onClick={() => refresh()} disabled={loading} aria-label="Refresh account activity"
          className="grid size-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 hover:text-[#02665e] disabled:opacity-50">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </header>
      {activity ? (
        <div className="grid items-start gap-3 p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {activity.behaviour ? <BehaviourScore behaviour={activity.behaviour} /> : null}
          <dl className="m-0 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-1">
          <div className="min-w-0 rounded-md border border-solid border-slate-200 px-3 py-2.5">
            <dt className="flex items-center gap-1.5 font-medium text-slate-600"><CreditCard className="size-3.5 shrink-0 text-[#39796d]" aria-hidden />Verified payout destination</dt>
            <dd className="m-0 mt-1 break-words font-semibold text-slate-900">
              {destination ? [destination.provider || destination.type, destination.ending ? `ending in ${destination.ending}` : null].filter(Boolean).join(" · ") : "No verified destination on file"}
            </dd>
            {destination?.changedAt ? <dd className="m-0 mt-1 text-slate-600">Last recorded update {eat(destination.changedAt)}</dd> : null}
          </div>
          <div className="rounded-md border border-solid border-slate-200 px-3 py-2.5">
            <dt className="flex items-center gap-1.5 font-medium text-slate-600"><ShieldCheck className="size-3.5 shrink-0 text-[#39796d]" aria-hidden />Two-step verification</dt>
            <dd className={`m-0 mt-1 font-semibold ${activity.twoFactorEnabled ? "text-emerald-800" : "text-amber-800"}`}>{activity.twoFactorEnabled ? "Enabled" : "Off"}</dd>
          </div>
          </dl>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-0 border-t border-solid border-slate-100 px-4 py-3">
        <h4 ref={timelineTitle} tabIndex={-1} className="m-0 scroll-mt-24 text-sm font-semibold text-slate-950">Activity timeline</h4>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter owner account activity">
        {filters.map(({ key, label }) => (
          <button type="button" key={key} aria-pressed={category === key} onClick={() => { if (key !== category) refresh(key); }}
            className={`min-h-8 cursor-pointer rounded-md border border-solid px-2.5 text-xs font-semibold ${category === key ? "border-[#b8d9d1] bg-[#eaf4f0] text-[#215b50]" : "border-slate-200 bg-white text-slate-600 hover:border-[#b8d9d1]"}`}>
            {label}
          </button>
        ))}
        </div>
      </div>
      {activity?.items.length ? (
        <ol className="m-0 list-none divide-y divide-slate-100 border-0 border-t border-solid border-slate-100 px-4">
          {activity.items.map((event) => {
            const Icon = icons[event.category];
            const context = [event.actor, event.device, event.ip?.replace(/^::ffff:(?=\d+\.)/i, "")].filter(Boolean).join(" · ");
            return (
              <li key={event.id} className="flex min-w-0 items-start gap-2.5 py-2.5">
                <span className={`grid size-7 shrink-0 place-items-center rounded-md ${event.tone === "failed" ? "bg-red-50 text-red-700" : event.tone === "change" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="m-0 text-[13px] font-semibold text-slate-900">{event.label}</p>
                    <time dateTime={event.createdAt} className="text-xs text-slate-600">{eat(event.createdAt)}</time>
                  </div>
                  {event.detail ? <p className="m-0 mt-0.5 break-words text-xs text-slate-700">{event.detail}</p> : null}
                  <p className="m-0 mt-0.5 break-words text-xs text-slate-500">{context}</p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : !loading && !error ? <p className="m-0 px-4 pb-4 text-sm text-slate-600">No recorded events in this view.</p> : null}
      {loading ? <p role="status" className="m-0 flex items-center gap-2 px-4 pb-4 text-xs text-slate-600"><Loader2 className="size-4 animate-spin" aria-hidden />Loading activity</p> : null}
      {error ? <p role="alert" className="m-0 px-4 pb-4 text-xs text-red-700">Could not load account activity. <button type="button" onClick={() => setAttempt((value) => value + 1)} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-red-800 underline">Try again</button></p> : null}
      {activity?.pagination && activity.pagination.total > 0 ? (
        <nav aria-label="Activity timeline pagination">
          <TablePagination {...activity.pagination} disabled={loading || error} onPageChange={(next) => {
            focusOnPageChange.current = true;
            setLoading(true);
            setPage(next);
          }} />
        </nav>
      ) : null}
    </section>
  );
}
