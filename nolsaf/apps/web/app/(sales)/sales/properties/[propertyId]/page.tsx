"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity as ActivityIcon,
  ArrowLeft,
  ArrowRightLeft,
  BadgeCheck,
  Ban,
  Building2,
  CalendarClock,
  ChevronRight,
  FileSignature,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  Receipt,
  Send,
  ShieldCheck,
  TrendingUp,
  Undo2,
  UserRound,
  Wallet,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Attribution = {
  id: number;
  productType: string;
  status: string;
  attributedAt: string;
  verifiedAt: string | null;
  commissionStartsAt: string | null;
  commissionEndsAt: string | null;
  reassignedAt: string | null;
  revokedAt: string | null;
  lead: {
    id: number;
    propertyName: string;
    contactPerson: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    convertedAt: string | null;
  } | null;
  contract: {
    id: number;
    contractNumber: string;
    status: string;
    startsAt: string;
    expiresAt: string;
  } | null;
};

type OnboardingStage = {
  key: string;
  label: string;
  state: "DONE" | "CURRENT" | "UPCOMING" | "BLOCKED";
  at: string | null;
  hint: string | null;
};

type Onboarding = {
  stages: OnboardingStage[];
  completed: number;
  total: number;
  current: string | null;
  blocked: boolean;
};

type PropertyDetail = {
  id: number;
  title: string;
  status: string;
  type: string;
  city: string | null;
  district: string | null;
  regionName: string | null;
  country: string | null;
  totalBedrooms: number | null;
  nrmsActivatedAt: string | null;
  createdAt: string;
  salesAttributions: Attribution[];
};

type Earning = {
  id: number;
  type: string;
  status: string;
  sourceKey: string;
  grossAmount: string | number;
  eligibleNetRevenue: string | number;
  commissionRate: string | number;
  commissionAmount: string | number;
  currency: string;
  earnedAt: string;
};

type Activity = {
  id: string | number;
  source: "ATTRIBUTION" | "LEAD";
  action?: string;
  type?: string;
  description?: string;
  createdAt: string;
};

const PRODUCT_LABELS: Record<string, { name: string; hint: string }> = {
  NRMS: { name: "NRMS", hint: "Hotel management system" },
  MARKETPLACE: { name: "Marketplace", hint: "Bookings on NoLSAF" },
};

/** Plain words, an icon and a tone for every event code the API records. */
const TONE = {
  earning: "bg-emerald-600 text-white",
  success: "bg-emerald-50 text-emerald-700",
  nolsaf: "bg-[#0b2420] text-emerald-300",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  neutral: "bg-slate-100 text-slate-600",
};
const ACTIVITY_META: Record<string, { label: string; Icon: LucideIcon; tone: string }> = {
  SALES_ATTRIBUTION_ACTIVATE: { label: "Earning activated", Icon: Zap, tone: TONE.earning },
  SALES_ATTRIBUTION_REVOKE: { label: "Earning stopped", Icon: Ban, tone: TONE.danger },
  SALES_ATTRIBUTION_REASSIGN: { label: "Attribution moved", Icon: ArrowRightLeft, tone: TONE.warning },
  SALES_LEAD_CONVERSION_APPROVE: { label: "Conversion approved", Icon: BadgeCheck, tone: TONE.success },
  SALES_LEAD_CONVERSION_REJECT: { label: "Conversion returned", Icon: Undo2, tone: TONE.warning },
  ADMIN_COMMENT: { label: "Note from NoLSAF", Icon: ShieldCheck, tone: TONE.nolsaf },
  STATUS_CHANGED: { label: "Status updated", Icon: ActivityIcon, tone: TONE.warning },
  CALL: { label: "Call logged", Icon: Phone, tone: TONE.neutral },
  EMAIL: { label: "Email sent", Icon: Mail, tone: TONE.neutral },
  MEETING: { label: "Meeting held", Icon: UserRound, tone: TONE.neutral },
  FOLLOW_UP: { label: "Follow-up planned", Icon: CalendarClock, tone: TONE.neutral },
  DOCUMENT_RECEIVED: { label: "Documents received", Icon: FileText, tone: TONE.success },
  PROPOSAL_SENT: { label: "Proposal sent", Icon: Send, tone: TONE.neutral },
  NOTE: { label: "Note", Icon: MessageSquare, tone: TONE.neutral },
};

function activityMeta(code: string) {
  return ACTIVITY_META[code] ?? { label: titleCase(code) || "Activity", Icon: MessageSquare, tone: TONE.neutral };
}

/** "Today", "Yesterday", or the date, for grouping the timeline by day. */
function dayLabel(value: string) {
  const d = new Date(value);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** Notes are typed quickly; start them with a capital and end with a full stop. */
function sentence(text: string) {
  const t = text.trim().replace(/\.\s+([a-z])/g, (_, c: string) => `. ${c.toUpperCase()}`);
  if (!t) return t;
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

function titleCase(value: string | null | undefined) {
  return String(value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not set";
}

function money(value: string | number, currency = "TZS") {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** "DAR ES SALAAM, UBUNGO, DAR-ES-SALAAM" reads as "Ubungo, Dar es Salaam". */
function placeLine(p: PropertyDetail) {
  const seen = new Set<string>();
  const parts = [p.district, p.city, p.regionName]
    .map((part) => titleCase(String(part || "").replace(/-/g, " ")).replace(/\bEs\b/g, "es"))
    .filter((part) => {
      const key = part.toLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return parts.join(", ") || "Location not recorded";
}

/** Internal record numbers are not the partner's business; describe them instead. */
function cleanDescription(text: string) {
  return text
    .replace(/\s+and bound to property #\d+/i, "")
    .replace(/\bproperty #\d+/gi, "this property")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function earningWindow(item: Attribution) {
  if (!item.commissionStartsAt || !item.commissionEndsAt) return null;
  const start = new Date(item.commissionStartsAt).getTime();
  const end = new Date(item.commissionEndsAt).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const pct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86_400_000));
  return { pct, daysLeft, started: now >= start, ended: now >= end };
}

export default function SalesPropertyDetailPage() {
  const params = useParams<{ propertyId: string }>();
  const propertyId = Number(params.propertyId);
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [totals, setTotals] = useState({ commissionAmount: 0, eligibleNetRevenue: 0, commissionCount: 0, currency: "TZS" });
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activityFilter, setActivityFilter] = useState<"ALL" | "ATTRIBUTION" | "LEAD">("ALL");
  const [activityExpanded, setActivityExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(propertyId) || propertyId <= 0) {
      setError("Invalid property.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [detailResponse, earningsResponse, activityResponse] = await Promise.all([
        apiClient.get(`/api/sales/properties/${propertyId}`),
        apiClient.get(`/api/sales/properties/${propertyId}/earnings`, { params: { pageSize: 50 } }),
        apiClient.get(`/api/sales/properties/${propertyId}/activity`),
      ]);
      setProperty(detailResponse.data?.property || null);
      setTotals(detailResponse.data?.totals || {});
      setOnboarding(detailResponse.data?.onboarding || null);
      setEarnings(earningsResponse.data?.earnings || []);
      setActivity(activityResponse.data?.activity || []);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load this attributed property.");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const card = "rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]";

  return (
    <SalesShell>
      <style jsx global>{`#sales-property-detail, #sales-property-detail * { box-sizing: border-box; }`}</style>
      <div id="sales-property-detail" className="space-y-5">
        {error ? <p className="m-0 rounded-xl border border-solid border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        {loading ? (
          <div className="space-y-5" aria-busy="true">
            <div className="h-[120px] animate-pulse rounded-[26px] bg-slate-100" />
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-[96px] animate-pulse rounded-2xl bg-slate-100" />)}
            </div>
            <div className="h-[220px] animate-pulse rounded-2xl bg-slate-100" />
          </div>
        ) : property ? (
          <>
            <SalesPageHeader
              icon={Building2}
              eyebrow={`Attributed property · ${titleCase(property.status)}`}
              title={property.title}
              description={placeLine(property)}
              actions={
                <Link
                  href="/sales/properties"
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-solid border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Portfolio
                </Link>
              }
            />

            {/* Earnings at a glance */}
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Earnings summary">
              {[
                { Icon: Wallet, label: "Your earnings", value: money(totals.commissionAmount, totals.currency), accent: true },
                { Icon: TrendingUp, label: "Eligible NoLSAF revenue", value: money(totals.eligibleNetRevenue, totals.currency) },
                { Icon: Receipt, label: "Earning events", value: String(totals.commissionCount ?? 0) },
              ].map(({ Icon, label, value, accent }) => (
                <div key={label} className={`${card} flex items-center gap-4 p-4`}>
                  <span className={`grid h-11 w-11 flex-none place-items-center rounded-xl ${accent ? "bg-[#087f68] text-white" : "bg-emerald-50 text-emerald-700"}`}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-xs font-semibold text-slate-500">{label}</p>
                    <p className="m-0 mt-0.5 truncate text-xl font-black tabular-nums tracking-tight text-slate-950">{value}</p>
                  </div>
                </div>
              ))}
            </section>

            {/* Onboarding: from approved conversion to the first commission */}
            {onboarding && onboarding.stages.length ? (() => {
              const done = onboarding.current === null;
              const currentStage = onboarding.stages.find((s) => s.state === "BLOCKED") ?? onboarding.stages.find((s) => s.state === "CURRENT") ?? null;
              return (
                <section className={`${card} p-5`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="m-0 text-base font-bold text-slate-950">{done ? "Fully onboarded" : "Road to earning"}</h2>
                    <span className="text-xs text-slate-500">{onboarding.completed} of {onboarding.total} steps done</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${onboarding.blocked ? "bg-red-500" : "bg-[#087f68]"}`}
                      style={{ width: `${(onboarding.completed / Math.max(1, onboarding.total)) * 100}%` }}
                    />
                  </div>

                  {currentStage?.hint ? (
                    <div className={`mt-4 flex items-start gap-3 rounded-xl px-4 py-3 ${currentStage.state === "BLOCKED" ? "bg-red-50" : "bg-emerald-50/70"}`}>
                      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${currentStage.state === "BLOCKED" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {currentStage.state === "BLOCKED" ? <Ban className="h-3.5 w-3.5" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
                      </span>
                      <div className="min-w-0">
                        <p className={`m-0 text-sm font-semibold ${currentStage.state === "BLOCKED" ? "text-red-800" : "text-emerald-900"}`}>
                          {currentStage.state === "BLOCKED" ? "Blocked: " : "Next: "}{currentStage.label}
                        </p>
                        <p className="m-0 mt-0.5 text-sm text-slate-600">{currentStage.hint}</p>
                      </div>
                    </div>
                  ) : null}

                  <ol className="m-0 mt-4 grid list-none gap-x-6 gap-y-3 p-0 sm:grid-cols-2">
                    {onboarding.stages.map((stage, index) => (
                      <li key={stage.key} className="flex items-center gap-3">
                        <span
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                            stage.state === "DONE"
                              ? "bg-[#087f68] text-white"
                              : stage.state === "BLOCKED"
                                ? "bg-red-100 text-red-700"
                                : stage.state === "CURRENT"
                                  ? "border-2 border-solid border-[#087f68] bg-white text-[#087f68]"
                                  : "border border-solid border-slate-200 bg-white text-slate-400"
                          }`}
                          aria-hidden
                        >
                          {stage.state === "DONE" ? <BadgeCheck className="h-4 w-4" /> : stage.state === "BLOCKED" ? <Ban className="h-3.5 w-3.5" /> : index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className={`m-0 truncate text-sm ${stage.state === "UPCOMING" ? "text-slate-500" : "font-semibold text-slate-900"}`}>{stage.label}</p>
                          <p className="m-0 text-xs text-slate-500">
                            {stage.state === "DONE"
                              ? stage.at ? shortDate(stage.at) : "Done"
                              : stage.state === "CURRENT"
                                ? "In progress"
                                : stage.state === "BLOCKED"
                                  ? "Needs attention"
                                  : "Not yet"}
                          </p>
                        </div>
                        <span className="sr-only">{stage.state.toLowerCase()}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })() : null}

            {/* Products this partner earns on */}
            <section className={`${card} p-5`}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="m-0 text-base font-bold text-slate-950">What you earn on</h2>
                <span className="text-xs text-slate-500">
                  {property.salesAttributions.length} {property.salesAttributions.length === 1 ? "product" : "products"}
                </span>
              </div>

              {property.salesAttributions.length === 0 ? (
                <p className="m-0 mt-3 text-sm text-slate-500">No product is attributed to you on this property yet.</p>
              ) : (
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {property.salesAttributions.map((item) => {
                    const product = PRODUCT_LABELS[item.productType] ?? { name: titleCase(item.productType), hint: "" };
                    const span = earningWindow(item);
                    return (
                      <article key={item.id} className="rounded-2xl border border-solid border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="m-0 text-[15px] font-bold text-slate-950">{product.name}</p>
                            {product.hint ? <p className="m-0 mt-0.5 text-xs text-slate-500">{product.hint}</p> : null}
                          </div>
                          <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-bold ${statusTone(item.status)}`}>{titleCase(item.status)}</span>
                        </div>

                        {span ? (
                          <div className="mt-4">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-700">Earning window</span>
                              <span className={span.ended ? "font-semibold text-slate-500" : "font-bold text-emerald-700"}>
                                {span.ended ? "Ended" : !span.started ? "Not started" : `${span.daysLeft} ${span.daysLeft === 1 ? "day" : "days"} left`}
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-[#087f68]" style={{ width: `${span.pct}%` }} />
                            </div>
                            <div className="mt-1.5 flex justify-between text-[11.5px] text-slate-500">
                              <span>{shortDate(item.commissionStartsAt)}</span>
                              <span>{shortDate(item.commissionEndsAt)}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="m-0 mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Earning has not been activated yet.</p>
                        )}

                        <dl className="m-0 mt-4 grid grid-cols-2 gap-3 border-0 border-t border-solid border-slate-100 pt-3.5">
                          <div className="flex min-w-0 items-start gap-2">
                            <BadgeCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-600" aria-hidden />
                            <div className="min-w-0">
                              <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Verified</dt>
                              <dd className="m-0 mt-0.5 text-sm font-semibold text-slate-800">{shortDate(item.verifiedAt)}</dd>
                            </div>
                          </div>
                          <div className="flex min-w-0 items-start gap-2">
                            <FileSignature className="mt-0.5 h-4 w-4 flex-none text-slate-400" aria-hidden />
                            <div className="min-w-0">
                              <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Agreement</dt>
                              <dd className="m-0 mt-0.5 truncate text-sm font-semibold text-slate-800">{item.contract?.contractNumber || "Not bound"}</dd>
                            </div>
                          </div>
                        </dl>

                        {item.lead ? (
                          <Link
                            href={`/sales/leads/${item.lead.id}`}
                            className="group mt-4 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm no-underline transition hover:bg-emerald-50"
                          >
                            <span className="min-w-0 truncate text-slate-600">
                              From your lead <span className="font-semibold text-slate-900">{titleCase(item.lead.propertyName)}</span>
                              {item.lead.contactPerson ? <span className="text-slate-500"> · {item.lead.contactPerson}</span> : null}
                            </span>
                            <ChevronRight className="h-4 w-4 flex-none text-slate-400 transition group-hover:text-emerald-700" aria-hidden />
                          </Link>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Earnings ledger */}
            <section className={`${card} overflow-hidden`}>
              <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
                <h2 className="m-0 text-base font-bold text-slate-950">Earnings</h2>
                {earnings.length > 0 ? <span className="text-xs text-slate-500">{earnings.length} recorded</span> : null}
              </div>
              {earnings.length === 0 ? (
                <div className="flex items-center gap-3 px-5 pb-5 pt-3">
                  <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-slate-50 text-slate-400">
                    <Receipt className="h-5 w-5" aria-hidden />
                  </span>
                  <p className="m-0 text-sm text-slate-500">
                    Nothing earned yet. Earnings appear here as soon as this property brings in NoLSAF revenue during your earning window.
                  </p>
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Date</th>
                        <th className="px-4 py-3">Stream</th>
                        <th className="px-4 py-3 text-right">Eligible revenue</th>
                        <th className="px-4 py-3 text-right">Rate</th>
                        <th className="px-4 py-3 text-right">You earn</th>
                        <th className="px-5 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earnings.map((item) => (
                        <tr key={item.id} className="border-0 border-t border-solid border-slate-100">
                          <td className="whitespace-nowrap px-5 py-3 text-slate-700">{shortDate(item.earnedAt)}</td>
                          <td className="px-4 py-3 text-slate-700">{titleCase(item.type)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700">{money(item.eligibleNetRevenue, item.currency)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700">{Number(item.commissionRate)}%</td>
                          <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-950">{money(item.commissionAmount, item.currency)}</td>
                          <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusTone(item.status)}`}>{titleCase(item.status)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Timeline: grouped by day, newest first, with a meaning for every event */}
            {(() => {
              const visibleAll = activity.filter((item) => activityFilter === "ALL" || item.source === activityFilter);
              const LIMIT = 6;
              const visible = activityExpanded ? visibleAll : visibleAll.slice(0, LIMIT);
              const groups: Array<{ day: string; items: Activity[] }> = [];
              for (const item of visible) {
                const day = dayLabel(item.createdAt);
                const last = groups[groups.length - 1];
                if (last && last.day === day) last.items.push(item);
                else groups.push({ day, items: [item] });
              }
              const counts = {
                ALL: activity.length,
                ATTRIBUTION: activity.filter((a) => a.source === "ATTRIBUTION").length,
                LEAD: activity.filter((a) => a.source === "LEAD").length,
              };
              return (
                <section className={`${card} p-5`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="m-0 text-base font-bold text-slate-950">Activity</h2>
                    {activity.length > 0 && counts.ATTRIBUTION > 0 && counts.LEAD > 0 ? (
                      <div className="inline-flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Filter activity">
                        {([
                          ["ALL", "All"],
                          ["ATTRIBUTION", "Earning"],
                          ["LEAD", "Your lead"],
                        ] as const).map(([key, text]) => (
                          <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={activityFilter === key}
                            onClick={() => { setActivityFilter(key); setActivityExpanded(false); }}
                            className={`rounded-lg border-0 px-3 py-1.5 text-xs font-bold transition [font-family:inherit] ${
                              activityFilter === key ? "bg-white text-slate-900 shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-800"
                            }`}
                          >
                            {text} <span className="font-semibold text-slate-400">{counts[key]}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {visibleAll.length === 0 ? (
                    <p className="m-0 mt-3 text-sm text-slate-500">No activity recorded yet.</p>
                  ) : (
                    <div className="mt-4 space-y-5">
                      {groups.map((group) => (
                        <div key={group.day}>
                          <p className="m-0 mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{group.day}</p>
                          <ol className="m-0 list-none p-0">
                            {group.items.map((item, index) => {
                              const code = String(item.action || item.type || "");
                              const meta = activityMeta(code);
                              const Icon = meta.Icon;
                              const last = index === group.items.length - 1;
                              return (
                                <li key={`${item.source}-${item.id}`} className="relative flex gap-3.5 pb-4 last:pb-0">
                                  {!last && <span className="absolute left-[17px] top-10 h-[calc(100%-36px)] w-px bg-slate-200" aria-hidden />}
                                  <span className={`relative grid h-9 w-9 flex-none place-items-center rounded-full ${meta.tone}`} aria-hidden>
                                    <Icon className="h-4 w-4" />
                                  </span>
                                  <div className="min-w-0 flex-1 pt-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                      <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                                        {meta.label}
                                        <span className="rounded-md bg-slate-100 px-1.5 py-px text-[10.5px] font-semibold text-slate-500">
                                          {item.source === "ATTRIBUTION" ? "Earning" : "Your lead"}
                                        </span>
                                      </p>
                                      <span className="text-xs tabular-nums text-slate-400">
                                        {new Date(item.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                    </div>
                                    {item.description ? (
                                      <p className="m-0 mt-1 text-sm leading-relaxed text-slate-600">{sentence(cleanDescription(item.description))}</p>
                                    ) : null}
                                  </div>
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      ))}
                    </div>
                  )}

                  {visibleAll.length > LIMIT ? (
                    <button
                      type="button"
                      onClick={() => setActivityExpanded((v) => !v)}
                      aria-expanded={activityExpanded}
                      className="mt-4 inline-flex items-center gap-1 rounded-xl border border-solid border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-800 [font-family:inherit]"
                    >
                      {activityExpanded ? "Show less" : `Show all ${visibleAll.length}`}
                    </button>
                  ) : null}
                </section>
              );
            })()}
          </>
        ) : null}
      </div>
    </SalesShell>
  );
}
