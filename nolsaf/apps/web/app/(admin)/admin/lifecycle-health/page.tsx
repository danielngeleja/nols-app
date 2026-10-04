"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import api from "@/lib/apiClient";

type ServiceType = "PROPERTY" | "GROUP_STAY" | "TOUR";
type LifecycleIssue = { code: string; severity: "WARNING" | "ERROR"; message: string };
type Lifecycle = {
  bookingStage: string;
  paymentStage: string;
  receiptStage: string;
  responsibilityStage: string;
  caseStage: string;
  requiredAction: string;
  requiredActionLabel: string;
  consistency: { status: "CONSISTENT" | "REVIEW_REQUIRED"; issues: LifecycleIssue[] };
};
type Row = {
  id: string;
  serviceType: ServiceType;
  bookingId: number;
  bookingCode: string;
  title: string;
  customer: string | null;
  createdAt: string;
  detailHref: string;
  lifecycle: Lifecycle;
  source: Record<string, unknown>;
};
type Payload = {
  observationMode: boolean;
  generatedAt: string;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: {
    observedOnPage: number;
    consistentOnPage: number;
    reviewRequiredOnPage: number;
    byService: { property: number; groupStay: number; tour: number };
  };
  items: Row[];
};
type Health = "ALL" | "CONSISTENT" | "REVIEW_REQUIRED";

const EMPTY: Payload = {
  observationMode: true,
  generatedAt: "",
  total: 0,
  page: 1,
  pageSize: 25,
  pageCount: 1,
  summary: { observedOnPage: 0, consistentOnPage: 0, reviewRequiredOnPage: 0, byService: { property: 0, groupStay: 0, tour: 0 } },
  items: [],
};

const SERVICES: Array<{ key: ServiceType; label: string; plural: string; hint: string; icon: typeof BedDouble; text: string; bar: string; soft: string; countKey: keyof Payload["summary"]["byService"] }> = [
  { key: "PROPERTY", label: "Property", plural: "Property stays", hint: "Single-property bookings", icon: BedDouble, text: "text-sky-700", bar: "bg-sky-500", soft: "bg-sky-50/70", countKey: "property" },
  { key: "GROUP_STAY", label: "Group stay", plural: "Group stays", hint: "Multi-room group bookings", icon: Users, text: "text-indigo-700", bar: "bg-indigo-500", soft: "bg-indigo-50/70", countKey: "groupStay" },
  { key: "TOUR", label: "Tour package", plural: "Tours", hint: "Operator tour bookings", icon: Compass, text: "text-amber-700", bar: "bg-amber-400", soft: "bg-amber-50/70", countKey: "tour" },
];
const serviceMeta = (s: ServiceType) => SERVICES.find((x) => x.key === s)!;

const STEP_LABELS: Array<[keyof Lifecycle, string]> = [
  ["bookingStage", "Booking"],
  ["paymentStage", "Payment"],
  ["receiptStage", "Receipt"],
  ["responsibilityStage", "Responsibility"],
  ["caseStage", "Case"],
];

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";

const humanize = (value: string) => String(value || "").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return eat(value);
  return String(value);
}

function eat(iso: string) {
  return `${new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

function eatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

/**
 * How each stage reads at a glance. Values mirror the stage types in
 * apps/api/src/lib/serviceLifecycle.ts; anything new falls back to "waiting".
 */
const STAGE_TONES: Record<string, "done" | "waiting" | "problem" | "idle"> = {
  // booking
  CONFIRMED: "done", IN_SERVICE: "done", COMPLETED: "done",
  DRAFT: "waiting", AWAITING_REVIEW: "waiting", AWAITING_PAYMENT: "waiting",
  CANCELLED: "problem", DECLINED: "problem", EXPIRED: "problem",
  // payment
  PAID: "done", REFUNDED: "done",
  UNPAID: "waiting", PENDING: "waiting", PARTIALLY_PAID: "waiting", REFUND_PENDING: "waiting",
  // receipt
  AVAILABLE: "done", VOIDED: "problem", NOT_AVAILABLE: "idle",
  // responsibility
  ASSIGNED: "done", DELIVERED: "done", ACKNOWLEDGED: "done", NOT_ASSIGNED: "idle", NOT_TRACKED: "idle",
  // case
  NONE: "idle", NOT_LOADED: "idle", SUBMITTED: "waiting", REVIEWING: "waiting", APPROVED: "waiting", REJECTED: "problem", RESOLVED: "done",
};

function stageTone(value: string): "done" | "waiting" | "problem" | "idle" {
  const v = String(value || "").toUpperCase();
  return v ? STAGE_TONES[v] ?? "waiting" : "idle";
}

const TONE_DOT: Record<ReturnType<typeof stageTone>, string> = {
  done: "bg-emerald-500",
  waiting: "bg-amber-400",
  problem: "bg-rose-500",
  idle: "bg-neutral-300",
};

function LifecycleStrip({ lifecycle }: { lifecycle: Lifecycle }) {
  return (
    <ol className="m-0 grid list-none grid-cols-5 overflow-hidden rounded-lg p-0 ring-1 ring-inset ring-neutral-200">
      {STEP_LABELS.map(([key, label], i) => {
        const value = String(lifecycle[key] ?? "");
        const tone = stageTone(value);
        return (
          <li key={key} className={`min-w-0 bg-white px-2.5 py-2 ${i ? "border-0 border-l border-solid border-neutral-200" : ""}`} title={`${label}: ${humanize(value) || "Not recorded"}`}>
            <span className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
              <span className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">{label}</span>
            </span>
            <span className={`mt-1 block truncate text-xs font-semibold ${tone === "idle" ? "text-neutral-400" : tone === "problem" ? "text-rose-700" : "text-neutral-800"}`}>{humanize(value) || "Not recorded"}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function LifecycleHealthPage() {
  const [data, setData] = useState<Payload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [service, setService] = useState<ServiceType | "ALL">("ALL");
  const [health, setHealth] = useState<Health>("ALL");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<Payload>("/api/admin/lifecycle-health", { params: { service, q: appliedQuery || undefined, page, pageSize: 25 } });
      setData(response.data);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.message || "Unable to load lifecycle health");
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, page, service]);

  useEffect(() => { void load(); }, [load]);

  // Search applies after a short pause, so typing does not fire a request per key.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (query.trim() === appliedQuery) return;
      setPage(1);
      setAppliedQuery(query.trim());
    }, 350);
    return () => window.clearTimeout(id);
  }, [query, appliedQuery]);

  const visibleItems = useMemo(() => data.items.filter((item) => health === "ALL" || item.lifecycle.consistency.status === health), [data.items, health]);
  const observed = data.summary.observedOnPage || data.items.length;
  const consistentShare = observed ? Math.round((data.summary.consistentOnPage / observed) * 100) : 0;
  const byServiceTotal = data.summary.byService.property + data.summary.byService.groupStay + data.summary.byService.tour;

  const facts = [
    { label: "Bookings observed", value: loading && !data.total ? "..." : data.total.toLocaleString(), detail: service === "ALL" ? "one row per booking" : serviceMeta(service).plural, tone: "text-white" },
    { label: "Consistent", value: loading && !observed ? "..." : `${consistentShare}%`, detail: `${data.summary.consistentOnPage} of ${observed} on this page agree`, tone: consistentShare === 100 ? "text-emerald-300" : "text-white" },
    { label: "Review required", value: loading && !observed ? "..." : String(data.summary.reviewRequiredOnPage), detail: data.summary.reviewRequiredOnPage ? "records that contradict each other" : "no contradictions on this page", tone: data.summary.reviewRequiredOnPage ? "text-amber-300" : "text-white" },
    { label: "Checked", value: data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) : "...", detail: data.generatedAt ? `${eatDate(data.generatedAt)}, EAT · read only` : "read only", tone: "text-white" },
  ];

  const pickService = (key: ServiceType) => {
    setService((current) => (current === key ? "ALL" : key));
    setHealth("ALL");
    setPage(1);
    setExpanded(null);
  };

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Operations observation</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Lifecycle health</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Reads each booking&apos;s payment, receipt, responsibility and case records and flags any that disagree. Nothing here changes a booking.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/70"><ShieldCheck className="h-3.5 w-3.5" /> Read only</span>
              <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
              </div>
            ))}
          </dl>
          {observed > 0 && (
            <div className="mt-4 flex h-1.5 w-full overflow-hidden rounded-full bg-white/10" title={`${consistentShare}% consistent on this page`}>
              <span className="bg-emerald-400" style={{ width: `${(data.summary.consistentOnPage / observed) * 100}%` }} />
              <span className="bg-amber-400" style={{ width: `${(data.summary.reviewRequiredOnPage / observed) * 100}%` }} />
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Services, doubling as the filter */}
      <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SERVICES.map((s) => {
            const Icon = s.icon;
            const n = data.summary.byService[s.countKey];
            const share = byServiceTotal ? Math.round((n / byServiceTotal) * 100) : 0;
            const selected = service === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => pickService(s.key)}
                aria-pressed={selected}
                className={`min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${selected ? `border-neutral-900 ${s.soft}` : "border-transparent bg-neutral-50 ring-1 ring-inset ring-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${s.text}`}><Icon className="h-3.5 w-3.5" /> {s.plural}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{share}%</span>
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{loading && !byServiceTotal ? "..." : n.toLocaleString()}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{s.hint}</span>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <span className={`block h-full rounded-full ${s.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Records */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{service === "ALL" ? "All bookings" : serviceMeta(service).plural}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading..." : `${visibleItems.length} shown${health !== "ALL" ? ` of ${data.items.length} on this page` : ""}${appliedQuery ? ` matching "${appliedQuery}"` : ""}`}</p>
          </div>
          <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" role="group" aria-label="Health">
            {([["ALL", "All"], ["REVIEW_REQUIRED", `Review required${data.summary.reviewRequiredOnPage ? ` (${data.summary.reviewRequiredOnPage})` : ""}`], ["CONSISTENT", "Consistent"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setHealth(key)} aria-pressed={health === key} className={`inline-flex h-8 items-center rounded-md border-0 px-2.5 text-xs font-semibold transition-colors ${health === key ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-300" : "bg-transparent text-neutral-500 hover:text-neutral-900"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full min-w-0 sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setAppliedQuery(query.trim()); } }}
              placeholder="Booking code, traveller or service"
              aria-label="Search lifecycle records"
              className="box-border h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white pl-9 pr-9 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {health !== "ALL" && <p className="m-0 border-0 border-b border-solid border-neutral-200 bg-neutral-50 px-4 py-2 text-[11px] text-neutral-500 sm:px-5">The health filter applies to the {data.items.length} records loaded on this page.</p>}

        {loading && data.items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading lifecycle records</div>
        ) : visibleItems.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-5 sm:px-5">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${health === "REVIEW_REQUIRED" ? "bg-emerald-50 text-emerald-700" : "bg-[#0b2420] text-emerald-300"}`}>{health === "REVIEW_REQUIRED" ? <CheckCircle2 className="h-5 w-5" /> : <Activity className="h-5 w-5" />}</span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-neutral-900">{health === "REVIEW_REQUIRED" ? "Nothing needs review on this page" : "No lifecycle records match"}</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">{health === "REVIEW_REQUIRED" ? "Every booking's records agree with each other." : "Change the service, health or search."}</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] table-fixed border-collapse text-left text-sm">
              <thead>
                <tr className="text-[11px] text-neutral-400">
                  <th className="w-[16%] px-4 py-2.5 font-semibold sm:px-5">Booking</th>
                  <th className="w-[17%] px-3 py-2.5 font-semibold">Service and traveller</th>
                  <th className="w-[47%] px-3 py-2.5 font-semibold">Lifecycle</th>
                  <th className="w-[13%] px-3 py-2.5 font-semibold">Health</th>
                  <th className="w-[7%] px-4 py-2.5 sm:px-5" />
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const open = expanded === item.id;
                  const meta = serviceMeta(item.serviceType);
                  const Icon = meta.icon;
                  const review = item.lifecycle.consistency.status === "REVIEW_REQUIRED";
                  return (
                    <Fragment key={item.id}>
                      <tr onClick={() => setExpanded(open ? null : item.id)} className={`cursor-pointer border-0 border-t border-solid border-neutral-200 align-top transition-colors ${open ? "bg-neutral-50" : "hover:bg-neutral-50/80"}`}>
                        <td className="px-4 py-3 sm:px-5">
                          <div className="truncate font-mono text-[13px] font-semibold text-neutral-900">{item.bookingCode}</div>
                          <div className="mt-0.5 text-[11px] text-neutral-400">{eatDate(item.createdAt)}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${meta.soft} ${meta.text}`}><Icon className="h-3.5 w-3.5" /></span>
                            <span className="truncate font-semibold text-neutral-900" title={item.title}>{item.title}</span>
                          </div>
                          <div className="mt-0.5 truncate pl-[30px] text-xs text-neutral-400" title={item.customer || ""}>{item.customer || "Traveller not recorded"}</div>
                        </td>
                        <td className="px-3 py-3"><LifecycleStrip lifecycle={item.lifecycle} /></td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${review ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
                            {review ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                            {review ? "Review" : "Consistent"}
                          </span>
                          {review && <div className="mt-1 text-[11px] text-amber-800">{item.lifecycle.consistency.issues.length} {item.lifecycle.consistency.issues.length === 1 ? "issue" : "issues"}</div>}
                          {!review && item.lifecycle.requiredAction && item.lifecycle.requiredAction !== "NONE" && <div className="mt-1 truncate text-[11px] text-neutral-500" title={item.lifecycle.requiredActionLabel}>{item.lifecycle.requiredActionLabel}</div>}
                        </td>
                        <td className="px-4 py-3 text-right sm:px-5">
                          <button type="button" onClick={(event) => { event.stopPropagation(); setExpanded(open ? null : item.id); }} aria-expanded={open} aria-label={`Inspect ${item.bookingCode}`} className="inline-grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900">
                            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-0 border-t border-solid border-neutral-200 bg-neutral-50">
                          <td colSpan={5} className="px-4 py-4 sm:px-5">
                            <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_auto]">
                              <div className="rounded-lg bg-white p-3 ring-1 ring-inset ring-neutral-200">
                                <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Next step</p>
                                <p className="m-0 mt-1.5 text-sm font-semibold text-neutral-900">{item.lifecycle.requiredActionLabel || "Nothing to do"}</p>
                              </div>
                              <div className={`rounded-lg p-3 ring-1 ring-inset ${review ? "bg-amber-50/60 ring-amber-200" : "bg-white ring-neutral-200"}`}>
                                <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Why it is {review ? "flagged" : "consistent"}</p>
                                {item.lifecycle.consistency.issues.length ? (
                                  <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                                    {item.lifecycle.consistency.issues.map((issue) => (
                                      <li key={issue.code} className={`flex gap-2 text-xs ${issue.severity === "ERROR" ? "text-rose-800" : "text-amber-900"}`}>
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {issue.message}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="m-0 mt-1.5 text-xs text-emerald-800">The booking, payment, receipt, responsibility and case records agree.</p>
                                )}
                              </div>
                              <Link href={item.detailHref} className="inline-flex h-10 items-center justify-center gap-1.5 self-start rounded-lg border-0 bg-[#0b2420] px-4 text-xs font-semibold text-white no-underline hover:bg-[#12342f] hover:no-underline">
                                Open booking <ChevronRight className="h-4 w-4" />
                              </Link>
                            </div>
                            <details className="mt-3 rounded-lg bg-white ring-1 ring-inset ring-neutral-200">
                              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                Observed source fields ({Object.keys(item.source).length}) <ChevronDown className="h-4 w-4" />
                              </summary>
                              <dl className="m-0 grid gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-4">
                                {Object.entries(item.source).map(([key, value]) => (
                                  <div key={key} className="min-w-0 bg-white px-3 py-2">
                                    <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">{humanize(key)}</dt>
                                    <dd className="m-0 mt-0.5 break-words text-xs font-semibold text-neutral-800">{displayValue(value)}</dd>
                                  </div>
                                ))}
                              </dl>
                            </details>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <span className="text-xs text-neutral-500">Page <span className="font-semibold tabular-nums text-neutral-900">{data.page}</span> of <span className="font-semibold tabular-nums text-neutral-900">{data.pageCount}</span> · {data.total.toLocaleString()} matching bookings</span>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={loading || page <= 1} className="inline-flex h-8 items-center gap-1 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
            <button type="button" onClick={() => setPage((value) => Math.min(data.pageCount, value + 1))} disabled={loading || page >= data.pageCount} className="inline-flex h-8 items-center gap-1 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Next <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </section>

      <p className="m-0 flex items-center gap-3 text-[11px] text-neutral-500">
        {([["done", "Settled"], ["waiting", "In progress"], ["problem", "Stopped"], ["idle", "Not started or not applicable"]] as const).map(([tone, label]) => (
          <span key={tone} className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} /> {label}</span>
        ))}
      </p>
    </div>
  );
}
