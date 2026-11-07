"use client";

/**
 * Lead pipeline: where every prospect stands, what needs attention today, and
 * the full list. Counts come from /api/sales/leads/pulse, which uses the same
 * rules as the list filters, so a number and the list it opens always agree.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Moon,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
  UsersRound,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { codeLabel, statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Lead = {
  ref: string;
  propertyName: string;
  contactPerson: string | null;
  location: string | null;
  proposedProduct: string;
  status: string;
  duplicateReviewStatus: string;
  nextFollowUpAt: string | null;
  protectionExpiresAt: string | null;
  updatedAt: string;
  _count: { activities: number };
};

type Focus = "OVERDUE" | "TODAY" | "PROTECTION" | "NONE" | "STALE";
type Pulse = {
  total: number;
  open: number;
  byStage: Record<string, number>;
  focus: Record<Focus, number>;
  conversion90d: { converted: number; closed: number; percent: number | null };
  rules: { staleAfterDays: number; protectionWarningDays: number; protectionDays: number };
  next: Array<{ ref: string; propertyName: string; location: string | null; status: string; reason: "OVERDUE" | "PROTECTION" | "STALE"; at: string | null }>;
};

const OPEN_STAGES = ["NEW", "CONTACTED", "MEETING_SCHEDULED", "PROPOSAL_SENT", "DOCUMENTS_PENDING", "TRIAL_STARTED", "CONVERSION_REQUESTED"];
const CLOSED_STAGES = ["CONVERTED", "LOST", "CANCELLED"];
const STAGE_SHORT: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  MEETING_SCHEDULED: "Meeting",
  PROPOSAL_SENT: "Proposal",
  DOCUMENTS_PENDING: "Documents",
  TRIAL_STARTED: "Trial",
  CONVERSION_REQUESTED: "Conversion asked",
};
const FOCUS: Array<{ key: Focus; label: string; Icon: typeof AlarmClock; tone: string }> = [
  { key: "OVERDUE", label: "Overdue follow-ups", Icon: AlarmClock, tone: "text-rose-700" },
  { key: "TODAY", label: "Due today", Icon: CalendarCheck, tone: "text-[#02665e]" },
  { key: "PROTECTION", label: "Protection ending", Icon: ShieldAlert, tone: "text-amber-700" },
  { key: "NONE", label: "No follow-up set", Icon: CalendarX2, tone: "text-slate-700" },
  { key: "STALE", label: "Gone quiet", Icon: Moon, tone: "text-slate-700" },
];
const pageSize = 25;
const card = "rounded-lg border border-solid border-slate-200 bg-white";
const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500";
const DAY = 86_400_000;

function eatDate(value: string | null) {
  if (!value) return "–";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Dar_es_Salaam" });
}

/** Whole EAT calendar days from today to the date (negative = past). */
function eatDayDiff(value: string, now: number) {
  const day = (t: number) => Math.floor((t + 3 * 3_600_000) / DAY);
  return day(new Date(value).getTime()) - day(now);
}

function FollowUp({ lead, now }: { lead: Lead; now: number | null }) {
  if (CLOSED_STAGES.includes(lead.status)) return <span className="text-slate-400">Closed</span>;
  if (!lead.nextFollowUpAt) return <span className="font-medium text-slate-500">Not set</span>;
  if (now === null) return <span>{eatDate(lead.nextFollowUpAt)}</span>;
  const d = eatDayDiff(lead.nextFollowUpAt, now);
  if (d < 0) return <span className="font-semibold text-rose-700">{-d} day{d === -1 ? "" : "s"} overdue</span>;
  if (d === 0) return <span className="font-semibold text-[#02665e]">Today</span>;
  if (d === 1) return <span className="text-slate-700">Tomorrow</span>;
  return <span className="text-slate-700">{eatDate(lead.nextFollowUpAt)} <span className="text-slate-400">· in {d} days</span></span>;
}

function Protection({ lead, now, warnDays }: { lead: Lead; now: number | null; warnDays: number }) {
  if (CLOSED_STAGES.includes(lead.status) || !lead.protectionExpiresAt || now === null) return <span className="text-slate-400">–</span>;
  const left = Math.ceil((new Date(lead.protectionExpiresAt).getTime() - now) / DAY);
  if (left <= 0) return <span className="font-semibold text-rose-700">Expired</span>;
  return <span className={left <= warnDays ? "font-semibold text-amber-700" : "text-slate-600"}>{left} day{left === 1 ? "" : "s"} left</span>;
}

function quiet(updatedAt: string, now: number | null) {
  if (now === null) return "";
  const days = Math.floor((now - new Date(updatedAt).getTime()) / DAY);
  return days <= 0 ? "Updated today" : days === 1 ? "Updated yesterday" : `Updated ${days} days ago`;
}

export default function SalesLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState("");
  const [focus, setFocus] = useState<Focus | "">("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState<number | null>(null);

  const loadPulse = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/sales/leads/pulse");
      setPulse(data);
    } catch {
      // The list still works without the pulse.
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await apiClient.get("/api/sales/leads", {
        params: { page, pageSize, ...(stage ? { status: stage } : {}), ...(focus ? { followUp: focus } : {}), ...(search ? { q: search } : {}) },
      });
      setLeads(data?.leads || []);
      setTotal(Number(data?.total || 0));
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load leads.");
    } finally {
      setLoading(false);
    }
  }, [page, stage, focus, search]);

  useEffect(() => { void loadPulse(); }, [loadPulse]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = Boolean(stage || focus || search);
  const clear = () => { setStage(""); setFocus(""); setQuery(""); setSearch(""); setPage(1); };
  const pickStage = (next: string) => { setStage((cur) => (cur === next ? "" : next)); setPage(1); };
  const pickFocus = (next: Focus) => { setFocus((cur) => (cur === next ? "" : next)); setPage(1); };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const peak = useMemo(() => Math.max(1, ...OPEN_STAGES.map((k) => pulse?.byStage[k] ?? 0)), [pulse]);
  const attention = pulse ? pulse.focus.OVERDUE + pulse.focus.PROTECTION : 0;
  const warnDays = pulse?.rules.protectionWarningDays ?? 7;

  const reasonText = (item: Pulse["next"][number]) => {
    if (item.reason === "OVERDUE" && item.at && now !== null) {
      const d = -eatDayDiff(item.at, now);
      return { text: `Follow-up ${d} day${d === 1 ? "" : "s"} overdue`, tone: "text-rose-700" };
    }
    if (item.reason === "PROTECTION" && item.at && now !== null) {
      const left = Math.max(0, Math.ceil((new Date(item.at).getTime() - now) / DAY));
      return { text: `Protection ends in ${left} day${left === 1 ? "" : "s"}. Log progress to keep it`, tone: "text-amber-700" };
    }
    return { text: `No update for ${pulse?.rules.staleAfterDays ?? 14}+ days`, tone: "text-slate-600" };
  };

  return (
    <SalesShell>
      <style jsx global>{`#sales-leads-page, #sales-leads-page * { box-sizing: border-box; }`}</style>
      <div id="sales-leads-page" className="w-full min-w-0 space-y-4">
        <SalesPageHeader
          icon={UsersRound}
          title="Lead pipeline"
          description="Every prospect, where it stands and what needs you today. A lead stays yours while you keep logging progress on it."
          actions={
            <Link href="/sales/leads/new" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014d47] hover:text-white sm:w-auto">
              <Plus className="h-4 w-4" aria-hidden /> Register lead
            </Link>
          }
        />

        {/* Pipeline by stage: one joined strip, each cell filters the list */}
        <section className={`${card} overflow-hidden`} aria-label="Pipeline by stage">
          <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-2.5">
            <h2 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><Target className="h-4 w-4 text-[#02665e]" aria-hidden /> Pipeline</h2>
            <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-500">
              <span><span className="font-semibold tabular-nums text-slate-900">{pulse?.open ?? "–"}</span> open</span>
              <span><span className="font-semibold tabular-nums text-emerald-700">{pulse?.byStage.CONVERTED ?? 0}</span> converted</span>
              <span><span className="font-semibold tabular-nums text-slate-700">{(pulse?.byStage.LOST ?? 0) + (pulse?.byStage.CANCELLED ?? 0)}</span> lost</span>
              <span title="Converted out of leads closed in the last 90 days">
                Win rate {pulse?.conversion90d.percent !== null && pulse?.conversion90d.percent !== undefined ? <span className="font-semibold tabular-nums text-slate-900">{pulse.conversion90d.percent}%</span> : <span className="text-slate-400">too early</span>}
              </span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[700px] grid-cols-7 gap-px bg-slate-100">
              {OPEN_STAGES.map((key) => {
                const count = pulse?.byStage[key] ?? 0;
                const active = stage === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pickStage(key)}
                    aria-pressed={active}
                    className={`min-w-0 border-0 px-3 py-3 text-left transition-colors ${active ? "bg-slate-900 text-white" : "bg-white text-slate-900 hover:bg-slate-50"}`}
                  >
                    <span className={`block truncate text-[11px] font-medium ${active ? "text-white/70" : "text-slate-500"}`}>{STAGE_SHORT[key]}</span>
                    <span className="mt-0.5 block text-lg font-bold tabular-nums leading-tight">{pulse ? count : "–"}</span>
                    <span className={`mt-1.5 block h-1 overflow-hidden rounded-full ${active ? "bg-white/20" : "bg-slate-100"}`}>
                      <span className={`block h-full rounded-full ${active ? "bg-white" : "bg-[#02665e]"}`} style={{ width: `${(count / peak) * 100}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Attention and the worklist */}
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <article className={`${card} min-w-0 overflow-hidden`}>
            <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-2.5">
              <h2 className="m-0 text-sm font-semibold text-slate-900">Needs attention</h2>
              {attention ? <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">{attention} urgent</span> : <span className="text-[11px] text-slate-400">Tap one to filter the list</span>}
            </div>
            <ul className="m-0 list-none p-0">
              {FOCUS.map(({ key, label, Icon, tone }) => {
                const count = pulse?.focus[key] ?? 0;
                const active = focus === key;
                return (
                  <li key={key} className="border-0 border-t border-solid border-slate-100 first:border-t-0">
                    <button
                      type="button"
                      onClick={() => pickFocus(key)}
                      aria-pressed={active}
                      className={`flex w-full items-center gap-3 border-0 px-4 py-2.5 text-left ${active ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : count ? tone : "text-slate-300"}`} aria-hidden />
                      <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? "font-semibold" : count ? "font-medium text-slate-800" : "text-slate-400"}`}>{label}</span>
                      <span className={`text-[13px] font-bold tabular-nums ${active ? "text-white" : count ? tone : "text-slate-300"}`}>{pulse ? count : "–"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </article>

          <article className={`${card} min-w-0 overflow-hidden`}>
            <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-2.5">
              <h2 className="m-0 text-sm font-semibold text-slate-900">Do next</h2>
              <span className="text-[11px] text-slate-400">Most urgent first</span>
            </div>
            {!pulse ? (
              <div className="space-y-2 p-4" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="block h-8 animate-pulse rounded bg-slate-100" />)}</div>
            ) : pulse.next.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <CalendarCheck className="mx-auto h-6 w-6 text-emerald-600" aria-hidden />
                <p className="m-0 mt-2 text-[13px] font-medium text-slate-800">{pulse.open ? "You are on top of every lead" : "No open leads yet"}</p>
                <p className="m-0 mt-0.5 text-[12px] text-slate-500">{pulse.open ? "Nothing overdue, quiet or about to lose protection." : "Register your first prospect to start the pipeline."}</p>
              </div>
            ) : (
              <ul className="m-0 list-none p-0">
                {pulse.next.map((item) => {
                  const r = reasonText(item);
                  return (
                    <li key={item.ref} className="border-0 border-t border-solid border-slate-100 first:border-t-0">
                      <Link href={`/sales/leads/${item.ref}`} className="group flex items-center gap-3 px-4 py-2.5 no-underline hover:bg-slate-50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-slate-900 group-hover:text-[#02665e]">{item.propertyName}</span>
                          <span className={`block truncate text-[12px] ${r.tone}`}>{r.text}</span>
                        </span>
                        <span className={`hidden shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold sm:inline-flex ${statusTone(item.status)}`}>{STAGE_SHORT[item.status] || codeLabel(item.status)}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-[#02665e]" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </section>

        {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p> : null}

        {/* The list */}
        <section className={`${card} overflow-hidden`} aria-label="Leads">
          <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="m-0 text-sm font-semibold text-slate-900">Leads</h2>
              <span className="text-[12px] tabular-nums text-slate-500">{loading ? "Loading" : `${total.toLocaleString("en-US")} ${filtered ? "matching" : "in total"}`}</span>
              {stage ? <button type="button" onClick={() => pickStage(stage)} className="inline-flex h-6 items-center gap-1 rounded-md border-0 bg-slate-100 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-200">{codeLabel(stage)} <X className="h-3 w-3" aria-hidden /></button> : null}
              {focus ? <button type="button" onClick={() => pickFocus(focus)} className="inline-flex h-6 items-center gap-1 rounded-md border-0 bg-slate-100 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-200">{FOCUS.find((f) => f.key === focus)?.label} <X className="h-3 w-3" aria-hidden /></button> : null}
              {search ? <button type="button" onClick={() => { setQuery(""); setSearch(""); setPage(1); }} className="inline-flex h-6 items-center gap-1 rounded-md border-0 bg-slate-100 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-200">&ldquo;{search}&rdquo; <X className="h-3 w-3" aria-hidden /></button> : null}
              {[stage, focus, search].filter(Boolean).length > 1 ? <button type="button" onClick={clear} className="border-0 bg-transparent p-0 text-[11px] font-semibold text-[#02665e] hover:underline">Clear all</button> : null}
            </div>
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(query.trim()); }}>
              <label className="relative">
                <span className="sr-only">Find a lead</span>
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Property, contact, phone or place" className="h-8 w-56 max-w-[60vw] rounded-md border border-solid border-slate-200 bg-white pl-7 pr-2 text-[12px] outline-none focus:border-[#02665e]" />
              </label>
              <button type="button" onClick={() => { void loadPulse(); void loadList(); }} disabled={loading} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </form>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className={`${th} pl-4`}>Property</th>
                  <th className={th}>Product</th>
                  <th className={th}>Stage</th>
                  <th className={th}>Next follow-up</th>
                  <th className={th}>Protection</th>
                  <th className={th}>Activity</th>
                  <th className={`${th} pr-4`}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && !leads.length ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-0 border-t border-solid border-slate-100" aria-hidden>
                      {[56, 26, 22, 30, 22, 26, 10].map((w, j) => (
                        <td key={j} className={`py-3.5 ${j === 0 ? "pl-4 pr-3" : "px-3"}`}><span className="block h-3.5 animate-pulse rounded bg-slate-100" style={{ width: `${w * 2}px` }} /></td>
                      ))}
                    </tr>
                  ))
                ) : leads.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <UsersRound className="mx-auto h-6 w-6 text-slate-300" aria-hidden />
                      <p className="m-0 mt-2 text-sm font-medium text-slate-800">{filtered ? "No lead matches this view" : "No leads yet"}</p>
                      <p className="m-0 mt-1 text-[13px] text-slate-500">{filtered ? "Clear a filter to see more." : "Register a prospect to start your pipeline."}</p>
                      {filtered ? <button type="button" onClick={clear} className="mt-3 inline-flex h-8 items-center rounded-md border border-solid border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">Clear filters</button> : null}
                    </td>
                  </tr>
                ) : (
                  leads.map((lead) => (
                    <tr key={lead.ref} className="border-0 border-t border-solid border-slate-100 align-top hover:bg-slate-50/60">
                      <td className="py-3 pl-4 pr-3">
                        <Link href={`/sales/leads/${lead.ref}`} className="block max-w-[18rem] truncate text-[13px] font-semibold text-slate-900 no-underline hover:text-[#02665e] hover:underline">{lead.propertyName}</Link>
                        <p className="m-0 max-w-[18rem] truncate text-[11px] text-slate-500">{[lead.location, lead.contactPerson].filter(Boolean).join(" · ") || "No location recorded"}</p>
                        {lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" ? <span className="mt-1 inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Duplicate check</span> : null}
                      </td>
                      <td className="px-3 py-3 text-[12px] text-slate-600">{codeLabel(lead.proposedProduct)}</td>
                      <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${statusTone(lead.status)}`}>{STAGE_SHORT[lead.status] || codeLabel(lead.status)}</span></td>
                      <td className="whitespace-nowrap px-3 py-3 text-[12px]"><FollowUp lead={lead} now={now} /></td>
                      <td className="whitespace-nowrap px-3 py-3 text-[12px]"><Protection lead={lead} now={now} warnDays={warnDays} /></td>
                      <td className="whitespace-nowrap px-3 py-3 text-[12px] text-slate-600">
                        <span className="tabular-nums">{lead._count.activities}</span> logged
                        <span className="block text-[11px] text-slate-400">{quiet(lead.updatedAt, now)}</span>
                      </td>
                      <td className="py-3 pl-3 pr-4 text-right">
                        <Link href={`/sales/leads/${lead.ref}`} aria-label={`Open ${lead.propertyName}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-solid border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 no-underline hover:bg-slate-50">
                          Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {total > pageSize ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 px-4 py-2.5">
              <p className="m-0 text-[12px] text-slate-500">{(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total.toLocaleString("en-US")}</p>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((v) => Math.max(1, v - 1))} aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                <span className="min-w-12 text-center text-[12px] font-semibold tabular-nums text-slate-600">{page} / {totalPages}</span>
                <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((v) => Math.min(totalPages, v + 1))} aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" aria-hidden /></button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </SalesShell>
  );
}
