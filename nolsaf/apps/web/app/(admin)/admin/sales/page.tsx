"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRightLeft,
  BadgeCheck,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileSignature,
  Inbox,
  Layers3,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type Lead = {
  id: number;
  propertyName: string;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  location: string | null;
  region: string | null;
  district: string | null;
  ward: string | null;
  proposedProduct: string;
  duplicateReviewStatus: string;
  conversionRequestedAt: string;
  salesPartner: {
    id: number;
    agentCode: string;
    status: string;
    user: { name: string | null; email: string | null };
  };
};

type PropertyHit = {
  id: number;
  title: string;
  status: string;
  city: string | null;
  regionName: string | null;
  owner: { id: number; name: string | null; email: string | null };
  salesAttributions: Array<{
    id: number;
    productType: string;
    status: string;
    salesPartner: { id: number; agentCode: string };
  }>;
};

type Attribution = {
  id: number;
  productType: string;
  status: string;
  commissionStartsAt: string | null;
  commissionEndsAt: string | null;
  property: { id: number; title: string; status: string };
  salesPartner: {
    id: number;
    agentCode: string;
    status: string;
    user: { name: string | null; email: string | null };
  };
  contract: { id: number; contractNumber: string; status: string; expiresAt: string } | null;
};

const fieldClass =
  "min-h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:border-emerald-800 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-45";
// Ghost buttons sitting on the dark sales header (same language as Sales partners).
const heroButton =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

// Attribution stages. Classes spelled out for Tailwind.
const ATTRIBUTION_STAGE: Record<string, { label: string; hint: string; text: string; dot: string; soft: string; ring: string }> = {
  VERIFIED: { label: "Verified", hint: "Ready to activate", text: "text-amber-700", dot: "bg-amber-500", soft: "bg-amber-50", ring: "ring-amber-400" },
  ACTIVE: { label: "Earning", hint: "Commission running", text: "text-emerald-700", dot: "bg-emerald-500", soft: "bg-emerald-50", ring: "ring-emerald-500" },
  REVOKED: { label: "Revoked", hint: "No longer earning", text: "text-rose-600", dot: "bg-rose-500", soft: "bg-rose-50", ring: "ring-rose-400" },
};
const stageOf = (status: string) =>
  ATTRIBUTION_STAGE[status] || { label: humanize(status), hint: "", text: "text-neutral-600", dot: "bg-neutral-400", soft: "bg-neutral-50", ring: "ring-neutral-300" };

function humanize(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function tidyName(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// "NRMS_MARKETPLACE" -> "NRMS + Marketplace"
function productLabel(value: string) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => (part === "NRMS" ? "NRMS" : humanize(part)))
    .join(" + ");
}

function day(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null;
}

function ago(value: string | null | undefined) {
  if (!value) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (mins < 60) return `${mins || 1} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function messageFor(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) return "Finance OTP verification is required. Complete it, then retry.";
  return cause?.response?.data?.error || fallback;
}

// Numbered step marker used inside the review panels.
function Step({ n, done, children }: { n: number; done?: boolean; children: React.ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-2 text-xs font-semibold text-neutral-800">
      <span className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-emerald-600 text-white" : "bg-[#0b2420] text-emerald-300"}`}>
        {done ? <CheckCircle2 className="h-3 w-3" /> : n}
      </span>
      {children}
    </p>
  );
}

export default function SalesReviewPage() {
  const [tab, setTab] = useState<"queue" | "attributions">("queue");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [attributions, setAttributions] = useState<Attribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState<Record<number, string>>({});
  const [duplicateDecision, setDuplicateDecision] = useState<Record<number, "CLEAR" | "MATCH">>({});
  const [propertyQuery, setPropertyQuery] = useState<Record<number, string>>({});
  const [propertyHits, setPropertyHits] = useState<Record<number, PropertyHit[]>>({});
  const [selectedProperty, setSelectedProperty] = useState<Record<number, PropertyHit | undefined>>({});
  const [targetPartner, setTargetPartner] = useState<Record<number, string>>({});
  const [reassignOpen, setReassignOpen] = useState<Record<number, boolean>>({});

  const stats = useMemo(() => ({
    waiting: leads.length,
    flagged: leads.filter((lead) => lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE").length,
    verified: attributions.filter((item) => item.status === "VERIFIED").length,
    active: attributions.filter((item) => item.status === "ACTIVE").length,
    revoked: attributions.filter((item) => item.status === "REVOKED").length,
  }), [attributions, leads]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [queueResponse, attributionResponse] = await Promise.all([
        apiClient.get("/api/admin/sales/leads/conversion-requests", {
          params: { q: query || undefined, pageSize: 100 },
        }),
        apiClient.get("/api/admin/sales/attributions", {
          params: { q: query || undefined, pageSize: 100 },
        }),
      ]);
      setLeads(queueResponse.data?.leads ?? []);
      setAttributions(attributionResponse.data?.attributions ?? []);
    } catch (cause: any) {
      setError(messageFor(cause, "Could not load sales review data"));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const searchProperties = async (leadId: number) => {
    const q = (propertyQuery[leadId] || "").trim();
    if (q.length < 2) {
      setError("Enter at least 2 characters or a property ID.");
      return;
    }
    setBusy(`property-${leadId}`);
    setError(null);
    try {
      const response = await apiClient.get("/api/admin/sales/properties/search", { params: { q } });
      setPropertyHits((current) => ({ ...current, [leadId]: response.data?.properties ?? [] }));
    } catch (cause: any) {
      setError(messageFor(cause, "Property search failed"));
    } finally {
      setBusy(null);
    }
  };

  const approve = async (lead: Lead) => {
    const property = selectedProperty[lead.id];
    const note = (reason[lead.id] || "").trim();
    if (!property || note.length < 5) {
      setError("Select the existing property and enter a review reason of at least 5 characters.");
      return;
    }
    if (lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" && !duplicateDecision[lead.id]) {
      setError("Resolve the duplicate warning before approval.");
      return;
    }
    setBusy(`approve-${lead.id}`);
    setError(null);
    try {
      await apiClient.post(`/api/admin/sales/leads/${lead.id}/approve-conversion`, {
        propertyId: property.id,
        reason: note,
        duplicateDecision: duplicateDecision[lead.id],
      });
      setNotice(`${lead.propertyName} was verified. Activate its attribution separately to begin earnings.`);
      await load();
      setTab("attributions");
      setStageFilter("VERIFIED");
    } catch (cause: any) {
      setError(messageFor(cause, "Conversion approval failed"));
    } finally {
      setBusy(null);
    }
  };

  const reject = async (lead: Lead) => {
    const note = (reason[lead.id] || "").trim();
    if (note.length < 5) {
      setError("Enter a return reason of at least 5 characters.");
      return;
    }
    if (lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" && !duplicateDecision[lead.id]) {
      setError("Resolve the duplicate warning before returning this request.");
      return;
    }
    setBusy(`reject-${lead.id}`);
    setError(null);
    try {
      await apiClient.post(`/api/admin/sales/leads/${lead.id}/reject-conversion`, {
        reason: note,
        returnStatus: "DOCUMENTS_PENDING",
        duplicateDecision: duplicateDecision[lead.id],
      });
      setNotice(`${lead.propertyName} was returned to the partner for more work.`);
      await load();
    } catch (cause: any) {
      setError(messageFor(cause, "Conversion return failed"));
    } finally {
      setBusy(null);
    }
  };

  const attributionAction = async (item: Attribution, action: "activate" | "revoke" | "reassign") => {
    const note = (reason[item.id] || "").trim();
    if (note.length < 5) {
      setError("Enter an action reason of at least 5 characters.");
      return;
    }
    const partnerId = Number(targetPartner[item.id]);
    if (action === "reassign" && (!Number.isInteger(partnerId) || partnerId <= 0)) {
      setError("Enter the target sales partner profile ID.");
      return;
    }
    setBusy(`${action}-${item.id}`);
    setError(null);
    try {
      await apiClient.post(`/api/admin/sales/attributions/${item.id}/${action}`, {
        reason: note,
        ...(action === "reassign" ? { salesPartnerId: partnerId } : {}),
      });
      setNotice(
        action === "activate"
          ? `${item.property.title} is now earning for ${productLabel(item.productType)}.`
          : action === "revoke"
            ? `${item.property.title} attribution was revoked.`
            : `${item.property.title} was reassigned in VERIFIED state; activate it separately.`,
      );
      setReassignOpen((current) => ({ ...current, [item.id]: false }));
      await load();
    } catch (cause: any) {
      setError(messageFor(cause, `Attribution ${action} failed`));
    } finally {
      setBusy(null);
    }
  };

  const visibleAttributions = stageFilter ? attributions.filter((item) => item.status === stageFilter) : attributions;

  // The three-step flow this page runs; each step jumps to where its work is.
  const flow = [
    { key: "queue", n: 1, icon: Inbox, label: "Review requests", value: stats.waiting, hint: stats.flagged ? `${stats.flagged} flagged as possible duplicate` : "Partner conversion requests", tone: stats.flagged ? "text-amber-700" : "text-neutral-500", onClick: () => { setTab("queue"); setStageFilter(""); }, active: tab === "queue" },
    { key: "VERIFIED", n: 2, icon: ShieldCheck, label: "Activate verified", value: stats.verified, hint: "Bound to a property, not earning yet", tone: "text-neutral-500", onClick: () => { setTab("attributions"); setStageFilter("VERIFIED"); }, active: tab === "attributions" && stageFilter === "VERIFIED" },
    { key: "ACTIVE", n: 3, icon: BadgeCheck, label: "Earning", value: stats.active, hint: "Commission running for the partner", tone: "text-neutral-500", onClick: () => { setTab("attributions"); setStageFilter("ACTIVE"); }, active: tab === "attributions" && stageFilter === "ACTIVE" },
  ];

  return (
    <div className="space-y-5 w-full min-w-0">
      {/* Sales header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
                Sales <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-white/70"><Lock className="h-3 w-3" /> Protected workflow</span>
              </p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Conversion and attribution review</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Bind partner claims to existing properties, verify ownership, then activate earning.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/sales/partners" className={heroButton}><Users className="h-3.5 w-3.5" /> Partners</Link>
              <Link href="/admin/sales/finance" className={heroButton}><Wallet className="h-3.5 w-3.5" /> Finance</Link>
              <Link href="/admin/sales/materials" className={heroButton}><BookOpen className="h-3.5 w-3.5" /> Materials</Link>
              <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 px-0`} aria-label="Refresh sales administration data" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Headline numbers */}
          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{stats.waiting}</p>
              <p className="m-0 mt-1 text-xs text-white/55">Waiting for review</p>
            </div>
            <div>
              <p className={`m-0 text-3xl font-bold tabular-nums leading-none ${stats.flagged ? "text-amber-300" : "text-white/40"}`}>{stats.flagged}</p>
              <p className="m-0 mt-1 text-xs text-white/55">Duplicate flags</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-emerald-300">{stats.active}</p>
              <p className="m-0 mt-1 text-xs text-white/55">Earning now</p>
            </div>
          </div>

          <div className="mt-5 flex gap-1" role="tablist" aria-label="Sales review views">
            {([["queue", "Review queue", Inbox, leads.length], ["attributions", "Attributions", Layers3, attributions.length]] as const).map(([key, label, Icon, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => { setTab(key); if (key === "queue") setStageFilter(""); }}
                className={`relative inline-flex h-11 items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${tab === key ? "text-white" : "text-white/50 hover:text-white/80"}`}
              >
                <Icon className="h-4 w-4" /> {label}
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${tab === key ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/60"}`}>{count}</span>
                {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Flow track: request -> verify -> earn */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {flow.map((step, idx) => {
            const Icon = step.icon;
            return (
              <button
                key={step.key}
                type="button"
                onClick={step.onClick}
                aria-pressed={step.active}
                className={`relative min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${step.active ? "border-neutral-900 bg-emerald-50/50" : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-800">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#0b2420] text-[10px] font-bold text-emerald-300">{step.n}</span>
                    {step.label}
                  </span>
                  <Icon className="h-4 w-4 text-neutral-400" />
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{step.value}</span>
                <span className={`mt-1 block truncate text-[11px] ${step.tone}`}>{step.hint}</span>
                {idx < flow.length - 1 && (
                  <ChevronRight className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white p-0.5 text-neutral-300 ring-1 ring-neutral-200 md:block" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Work area */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">
              {tab === "queue" ? "Conversion requests" : stageFilter ? `${stageOf(stageFilter).label} attributions` : "All attributions"}
            </h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">
              {loading ? "Loading…" : tab === "queue" ? `${leads.length} waiting` : `${visibleAttributions.length} of ${attributions.length}`}
            </p>
          </div>
          {tab === "attributions" && (
            <div className="flex flex-wrap items-center gap-1.5">
              {[["", "All", attributions.length], ["VERIFIED", "Verified", stats.verified], ["ACTIVE", "Earning", stats.active], ["REVOKED", "Revoked", stats.revoked]].map(([key, label, n]) => {
                const active = stageFilter === key;
                return (
                  <button
                    key={String(key) || "all"}
                    type="button"
                    onClick={() => setStageFilter(String(key))}
                    aria-pressed={active}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-medium transition-colors ${active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"}`}
                  >
                    {key ? <span className={`h-1.5 w-1.5 rounded-full ${stageOf(String(key)).dot}`} /> : null}
                    {label}
                    <span className={`tabular-nums ${active ? "text-white/70" : "text-neutral-400"}`}>{Number(n)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="relative ml-auto w-full min-w-0 sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
              placeholder="Search property, partner or contact"
              aria-label="Search sales reviews"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {loading && leads.length === 0 && attributions.length === 0 ? (
          <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sales reviews
          </div>
        ) : tab === "queue" ? (
          leads.length === 0 ? (
            <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">{query ? "No requests match this search" : "Review queue is clear"}</p>
              <p className="m-0 mt-1 text-xs text-neutral-500">
                {query ? "Try another property, partner or contact." : "New partner conversion requests will appear here."}
              </p>
              {!query && stats.verified > 0 && (
                <button type="button" onClick={() => { setTab("attributions"); setStageFilter("VERIFIED"); }} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800">
                  <ShieldCheck className="h-4 w-4" /> {stats.verified} verified waiting to activate
                </button>
              )}
            </div>
          ) : (
            <ul className="m-0 list-none space-y-3 border-0 border-t border-solid border-neutral-100 p-3 sm:p-4">
              {leads.map((lead) => {
                const flagged = lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE";
                const selected = selectedProperty[lead.id];
                const note = (reason[lead.id] || "").trim();
                const decided = !flagged || Boolean(duplicateDecision[lead.id]);
                const place = [lead.location, lead.ward, lead.district, lead.region].filter(Boolean).join(", ");
                const partnerName = tidyName(lead.salesPartner.user.name) || lead.salesPartner.user.email || "Partner";
                let stepNo = 0;
                return (
                  <li key={lead.id} className={`overflow-hidden rounded-xl border border-solid bg-white ${flagged ? "border-amber-200" : "border-neutral-200"}`}>
                    {flagged && (
                      <div className="flex items-center gap-2 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" /> Possible duplicate: decide before verifying or returning
                      </div>
                    )}
                    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.95fr)]">
                      {/* Claim */}
                      <div className="min-w-0 p-4 sm:p-5">
                        <div className="flex items-start gap-3">
                          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white"><Building2 className="h-4 w-4" /></span>
                          <div className="min-w-0 flex-1">
                            <h3 className="m-0 truncate text-base font-bold text-neutral-900">{lead.propertyName}</h3>
                            <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-400">
                              <span className="font-mono">Lead #{lead.id}</span>
                              <span>·</span>
                              <span title={new Date(lead.conversionRequestedAt).toLocaleString("en-GB")}>Requested {ago(lead.conversionRequestedAt)}</span>
                            </p>
                          </div>
                          <span className="flex-shrink-0 rounded-md border border-dashed border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-700">{productLabel(lead.proposedProduct)}</span>
                        </div>

                        <dl className="m-0 mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-solid border-neutral-100 bg-neutral-100 sm:grid-cols-2">
                          {[
                            { icon: UserRound, label: "Contact", value: lead.contactPerson || "Not supplied" },
                            { icon: lead.contactPhone ? Phone : Mail, label: lead.contactPhone ? "Phone" : "Email", value: lead.contactPhone || lead.contactEmail || "Not supplied" },
                            { icon: MapPin, label: "Location", value: place || "Not supplied" },
                            { icon: ShieldCheck, label: "Sales partner", value: `${partnerName}`, sub: lead.salesPartner.agentCode },
                          ].map((f) => {
                            const Icon = f.icon;
                            return (
                              <div key={f.label} className="flex min-w-0 items-start gap-2.5 bg-white px-3 py-2.5">
                                <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-neutral-400" />
                                <div className="min-w-0">
                                  <dt className="text-[11px] text-neutral-400">{f.label}</dt>
                                  <dd className="m-0 truncate text-sm text-neutral-800" title={f.value}>{f.value}</dd>
                                  {"sub" in f && f.sub ? <dd className="m-0 truncate font-mono text-[11px] text-neutral-500">{f.sub}</dd> : null}
                                </div>
                              </div>
                            );
                          })}
                        </dl>
                      </div>

                      {/* Decision panel */}
                      <div className="min-w-0 space-y-4 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 p-4 sm:p-5 lg:border-l lg:border-t-0">
                        {flagged && (
                          <div>
                            <Step n={++stepNo} done={decided}>Duplicate decision</Step>
                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                              {([["CLEAR", "Separate prospect"], ["MATCH", "Same property"]] as const).map(([value, label]) => {
                                const on = duplicateDecision[lead.id] === value;
                                return (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => setDuplicateDecision((current) => ({ ...current, [lead.id]: value }))}
                                    aria-pressed={on}
                                    className={`h-9 rounded-lg border border-solid px-2 text-xs font-semibold transition-colors ${on ? "border-amber-500 bg-amber-100 text-amber-900" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div>
                          <Step n={++stepNo} done={Boolean(selected)}>Bind the existing property</Step>
                          {selected ? (
                            <div className="mt-2 flex items-center gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-3 py-2">
                              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                              <span className="min-w-0 flex-1 truncate text-sm text-emerald-900"><span className="font-mono text-xs">#{selected.id}</span> {selected.title}</span>
                              <button type="button" onClick={() => setSelectedProperty((current) => ({ ...current, [lead.id]: undefined }))} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Change</button>
                            </div>
                          ) : (
                            <>
                              <div className="mt-2 flex gap-2">
                                <input
                                  value={propertyQuery[lead.id] || ""}
                                  onChange={(event) => setPropertyQuery((current) => ({ ...current, [lead.id]: event.target.value }))}
                                  onKeyDown={(event) => { if (event.key === "Enter") void searchProperties(lead.id); }}
                                  className={fieldClass}
                                  placeholder="Property ID, name, city or owner email"
                                  aria-label={`Find property for ${lead.propertyName}`}
                                />
                                <button type="button" className={`${secondaryButton} shrink-0 px-3`} onClick={() => void searchProperties(lead.id)} disabled={busy === `property-${lead.id}`} aria-label={`Search property for ${lead.propertyName}`}>
                                  {busy === `property-${lead.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                                </button>
                              </div>
                              {propertyHits[lead.id] && propertyHits[lead.id].length === 0 && (
                                <p className="m-0 mt-2 text-xs text-neutral-500">No properties found. Try the property ID or owner email.</p>
                              )}
                              {(propertyHits[lead.id] || []).length > 0 && (
                                <ul className="m-0 mt-2 max-h-48 list-none space-y-1.5 overflow-y-auto p-0 pr-1">
                                  {propertyHits[lead.id].map((property) => {
                                    const taken = property.salesAttributions.filter((a) => a.status !== "REVOKED");
                                    return (
                                      <li key={property.id}>
                                        <button
                                          type="button"
                                          onClick={() => setSelectedProperty((current) => ({ ...current, [lead.id]: property }))}
                                          className="block w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-left transition hover:border-emerald-300 hover:bg-emerald-50/40"
                                        >
                                          <span className="flex items-center gap-2">
                                            <span className="font-mono text-[11px] text-neutral-400">#{property.id}</span>
                                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">{property.title}</span>
                                            <span className="flex-shrink-0 text-[11px] text-neutral-500">{humanize(property.status)}</span>
                                          </span>
                                          <span className="mt-0.5 block truncate text-xs text-neutral-500">
                                            {[property.city || property.regionName, property.owner?.name || property.owner?.email].filter(Boolean).join(" · ") || "Location unavailable"}
                                          </span>
                                          {taken.length > 0 && (
                                            <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700">
                                              <AlertTriangle className="h-3 w-3" />
                                              Already attributed: {taken.map((item) => `${productLabel(item.productType)} to ${item.salesPartner.agentCode}`).join(", ")}
                                            </span>
                                          )}
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </>
                          )}
                        </div>

                        <div>
                          <Step n={++stepNo} done={note.length >= 5}>Reason and evidence</Step>
                          <textarea
                            value={reason[lead.id] || ""}
                            onChange={(event) => setReason((current) => ({ ...current, [lead.id]: event.target.value }))}
                            className={`${fieldClass} mt-2 min-h-20 resize-y py-2 font-[inherit]`}
                            placeholder="What you checked, and why this decision"
                            aria-label={`Review reason for ${lead.propertyName}`}
                          />
                          <p className="m-0 mt-1 text-right text-[11px] tabular-nums text-neutral-400">{note.length < 5 ? `${5 - note.length} more characters needed` : "Ready"}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" className={`${primaryButton} flex-1`} onClick={() => void approve(lead)} disabled={Boolean(busy) || !selected || note.length < 5 || !decided}>
                            {busy === `approve-${lead.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify conversion
                          </button>
                          <button type="button" className={secondaryButton} onClick={() => void reject(lead)} disabled={Boolean(busy) || note.length < 5 || !decided}>
                            {busy === `reject-${lead.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Return to partner
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : visibleAttributions.length === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
              <Layers3 className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">{stageFilter ? `No ${stageOf(stageFilter).label.toLowerCase()} attributions` : "No attributions yet"}</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">Verified property bindings will appear here.</p>
          </div>
        ) : (
          <ul className="m-0 list-none space-y-3 border-0 border-t border-solid border-neutral-100 p-3 sm:p-4">
            {visibleAttributions.map((item) => {
              const stage = stageOf(item.status);
              const partnerName = tidyName(item.salesPartner.user.name) || item.salesPartner.user.email || "Partner";
              const start = item.commissionStartsAt ? new Date(item.commissionStartsAt).getTime() : null;
              const end = item.commissionEndsAt ? new Date(item.commissionEndsAt).getTime() : null;
              const progress = start && end && end > start ? Math.min(Math.max(((Date.now() - start) / (end - start)) * 100, 0), 100) : 0;
              const daysLeft = end ? Math.max(Math.ceil((end - Date.now()) / 86400000), 0) : null;
              const note = (reason[item.id] || "").trim();
              const reassigning = Boolean(reassignOpen[item.id]);
              return (
                <li key={item.id} className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                  <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
                    <div className="min-w-0 p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white ring-2 ring-offset-2 ${stage.ring}`}><Building2 className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <h3 className="m-0 truncate text-base font-bold text-neutral-900">{item.property.title}</h3>
                          <p className="m-0 mt-0.5 text-xs text-neutral-400"><span className="font-mono">Property #{item.property.id}</span> · Attribution #{item.id}</p>
                        </div>
                        <span className="flex-shrink-0 rounded-md border border-dashed border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-700">{productLabel(item.productType)}</span>
                      </div>

                      <div className={`mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${stage.soft} ${stage.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${stage.dot}`} />
                        <span className="font-semibold">{stage.label}</span>
                        {stage.hint && <span className="opacity-80">· {stage.hint}</span>}
                      </div>

                      <dl className="m-0 mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-solid border-neutral-100 bg-neutral-100 sm:grid-cols-2">
                        <div className="min-w-0 bg-white px-3 py-2.5">
                          <dt className="text-[11px] text-neutral-400">Sales partner</dt>
                          <dd className="m-0 truncate text-sm text-neutral-800">{partnerName}</dd>
                          <dd className="m-0 font-mono text-[11px] text-neutral-500">{item.salesPartner.agentCode} · profile #{item.salesPartner.id}</dd>
                        </div>
                        <div className="min-w-0 bg-white px-3 py-2.5">
                          <dt className="flex items-center gap-1 text-[11px] text-neutral-400"><FileSignature className="h-3 w-3" /> Contract</dt>
                          <dd className="m-0 truncate text-sm text-neutral-800">{item.contract?.contractNumber || "Not bound"}</dd>
                          <dd className="m-0 text-[11px] text-neutral-500">{item.contract ? `${humanize(item.contract.status)} · expires ${day(item.contract.expiresAt)}` : " "}</dd>
                        </div>
                      </dl>

                      {/* Earning window */}
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[11px] text-neutral-500">
                          <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> {day(item.commissionStartsAt) || "Not started"}</span>
                          <span>{item.status === "ACTIVE" && daysLeft != null ? `${daysLeft} days left` : "Earning window"}</span>
                          <span>{day(item.commissionEndsAt) || "No end date"}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                          <div className={`h-full rounded-full ${item.status === "ACTIVE" ? "bg-emerald-500" : "bg-neutral-300"}`} style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="min-w-0 space-y-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 p-4 sm:p-5 lg:border-l lg:border-t-0">
                      {item.status === "REVOKED" && !reassigning ? (
                        <p className="m-0 text-xs text-neutral-500">This attribution is revoked. You can still reassign the property to another partner.</p>
                      ) : null}
                      <div>
                        <label className="text-xs font-semibold text-neutral-800" htmlFor={`reason-${item.id}`}>Action reason</label>
                        <input
                          id={`reason-${item.id}`}
                          value={reason[item.id] || ""}
                          onChange={(event) => setReason((current) => ({ ...current, [item.id]: event.target.value }))}
                          className={`${fieldClass} mt-1.5`}
                          placeholder="Required for every action"
                        />
                      </div>

                      {reassigning && (
                        <div className="rounded-lg border border-solid border-neutral-200 bg-white p-3">
                          <label className="text-xs font-semibold text-neutral-800" htmlFor={`partner-${item.id}`}>Move to sales partner profile ID</label>
                          <input
                            id={`partner-${item.id}`}
                            value={targetPartner[item.id] || ""}
                            onChange={(event) => setTargetPartner((current) => ({ ...current, [item.id]: event.target.value }))}
                            className={`${fieldClass} mt-1.5`}
                            inputMode="numeric"
                            placeholder="e.g. 12"
                          />
                          <p className="m-0 mt-1.5 text-[11px] text-neutral-500">It returns to Verified and must be activated again.</p>
                          <div className="mt-2 flex gap-2">
                            <button type="button" className={`${primaryButton} flex-1`} onClick={() => void attributionAction(item, "reassign")} disabled={Boolean(busy) || note.length < 5 || !targetPartner[item.id]}>
                              {busy === `reassign-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />} Confirm reassign
                            </button>
                            <button type="button" className={secondaryButton} onClick={() => setReassignOpen((current) => ({ ...current, [item.id]: false }))}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {!reassigning && (
                        <div className="flex flex-wrap gap-2">
                          {item.status === "VERIFIED" && (
                            <button type="button" className={`${primaryButton} flex-1`} onClick={() => void attributionAction(item, "activate")} disabled={Boolean(busy) || note.length < 5}>
                              {busy === `activate-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Activate earning
                            </button>
                          )}
                          {item.status !== "REVOKED" && (
                            <button type="button" className={`${secondaryButton} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700`} onClick={() => void attributionAction(item, "revoke")} disabled={Boolean(busy) || note.length < 5}>
                              {busy === `revoke-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Revoke
                            </button>
                          )}
                          <button type="button" className={secondaryButton} onClick={() => setReassignOpen((current) => ({ ...current, [item.id]: true }))} disabled={Boolean(busy)}>
                            <ArrowRightLeft className="h-4 w-4" /> Reassign
                          </button>
                        </div>
                      )}

                      <p className="m-0 flex items-center gap-1.5 text-[11px] text-neutral-400">
                        <Lock className="h-3 w-3" /> Finance OTP is required for activation, revocation and reassignment.
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
