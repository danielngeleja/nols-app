"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  Layers3,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Wallet,
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
  "min-h-10 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-700 bg-emerald-700 px-4 text-sm font-bold text-white shadow-sm transition hover:border-emerald-800 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not started";
}

function messageFor(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) return "Finance OTP verification is required. Complete it, then retry.";
  return cause?.response?.data?.error || fallback;
}

function statusTone(status: string) {
  if (status === "ACTIVE") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (status === "VERIFIED") return "border-amber-100 bg-amber-50 text-amber-700";
  if (status === "REVOKED") return "border-red-100 bg-red-50 text-red-700";
  return "border-neutral-200 bg-neutral-100 text-neutral-600";
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "emerald",
}: {
  icon: typeof Building2;
  label: string;
  value: number;
  detail: string;
  tone?: "emerald" | "amber" | "blue" | "slate";
}) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    blue: "border-sky-100 bg-sky-50 text-sky-700",
    slate: "border-neutral-200 bg-neutral-100 text-neutral-600",
  };
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p>
          <p className="mb-0 mt-1 text-2xl font-black tabular-nums text-neutral-950">{value}</p>
        </div>
        <span className={`grid h-9 w-9 place-items-center rounded-xl border ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mb-0 mt-2 text-[11px] text-neutral-500">{detail}</p>
    </div>
  );
}

export default function SalesReviewPage() {
  const [tab, setTab] = useState<"queue" | "attributions">("queue");
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
  const stats = useMemo(() => ({
    waiting: leads.length,
    flagged: leads.filter((lead) => lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE").length,
    verified: attributions.filter((item) => item.status === "VERIFIED").length,
    active: attributions.filter((item) => item.status === "ACTIVE").length,
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
          ? `${item.property.title} is now earning for ${item.productType}.`
          : action === "revoke"
            ? `${item.property.title} attribution was revoked.`
            : `${item.property.title} was reassigned in VERIFIED state; activate it separately.`,
      );
      await load();
    } catch (cause: any) {
      setError(messageFor(cause, `Attribution ${action} failed`));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div id="sales-review" className="mx-auto min-w-0 max-w-7xl space-y-4 px-4 py-5 sm:space-y-5 sm:py-6">
      <style>{`#sales-review, #sales-review * { box-sizing: border-box; }`}</style>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">SALES</div>
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Sales administration</p>
                <span className="rounded-full border border-emerald-100 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm">Protected workflow</span>
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Conversion and attribution review</h1>
              <p className="mb-0 mt-1 max-w-3xl text-xs leading-5 text-neutral-500 sm:text-sm">
                Bind claims to existing properties, verify ownership, then explicitly activate earning eligibility.
              </p>
            </div>
          </div>
          <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            <Link href="/admin/sales/partners" className={`${secondaryButton} no-underline`}><UserRound className="h-4 w-4" /> Partners</Link>
            <Link href="/admin/sales/finance" className={`${secondaryButton} no-underline`}><Wallet className="h-4 w-4" /> Finance</Link>
            <Link href="/admin/sales/materials" className={`${secondaryButton} no-underline`}><FileText className="h-4 w-4" /> Materials</Link>
            <button
              type="button"
              className={`${secondaryButton} h-10 w-10 shrink-0 px-0`}
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh sales administration data"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={Clock3} label="Waiting review" value={stats.waiting} detail="Conversion requests in queue" tone="blue" />
        <SummaryCard icon={AlertTriangle} label="Duplicate flags" value={stats.flagged} detail="Require an explicit decision" tone={stats.flagged ? "amber" : "slate"} />
        <SummaryCard icon={ShieldCheck} label="Verified" value={stats.verified} detail="Ready for activation" tone="amber" />
        <SummaryCard icon={Layers3} label="Active earning" value={stats.active} detail="Attributions earning now" tone="emerald" />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] sm:flex-row sm:items-center">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
          <button type="button" onClick={() => setTab("queue")} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border-0 px-3 text-xs font-bold transition ${tab === "queue" ? "bg-white text-emerald-800 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>
            Review queue <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">{leads.length}</span>
          </button>
          <button type="button" onClick={() => setTab("attributions")} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border-0 px-3 text-xs font-bold transition ${tab === "attributions" ? "bg-white text-emerald-800 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>
            Attributions <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">{attributions.length}</span>
          </button>
        </div>
        <div className="relative min-w-0 flex-1 sm:ml-auto sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className={`${fieldClass} min-h-9 pl-9 text-xs`} placeholder="Search property, partner or contact" aria-label="Search sales reviews" />
        </div>
      </div>

      {loading ? (
        <div className="grid min-h-72 place-items-center rounded-2xl border border-neutral-200 bg-white text-neutral-400">
          <div className="text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /><p className="mb-0 mt-2 text-xs">Loading sales reviews</p></div>
        </div>
      ) : tab === "queue" ? (
        <section className="space-y-4">
          {leads.length === 0 && (
            <div className="grid min-h-72 place-items-center rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
                <h2 className="mb-0 mt-3 text-sm font-bold text-neutral-800">Review queue is clear</h2>
                <p className="mb-0 mt-1 text-xs text-neutral-500">New partner conversion requests will appear here.</p>
              </div>
            </div>
          )}
          {leads.map((lead) => {
            const flagged = lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE";
            const selected = selectedProperty[lead.id];
            return (
              <article key={lead.id} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] transition hover:border-emerald-100">
                <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700"><Building2 className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <h2 className="m-0 truncate text-base font-bold text-neutral-950">{lead.propertyName}</h2>
                        <p className="m-0 mt-0.5 text-[11px] text-neutral-400">Lead #{lead.id} / requested {dateTime(lead.conversionRequestedAt)}</p>
                      </div>
                      <span className="rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">{lead.proposedProduct.replaceAll("_", " + ")}</span>
                      {flagged && <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Possible duplicate</span>}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <div className="flex items-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2.5"><UserRound className="h-4 w-4 shrink-0 text-neutral-400" /><div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Contact</p><p className="m-0 truncate text-xs font-semibold text-neutral-700">{lead.contactPerson || "Not supplied"}</p></div></div>
                      <div className="flex items-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2.5">{lead.contactPhone ? <Phone className="h-4 w-4 shrink-0 text-neutral-400" /> : <Mail className="h-4 w-4 shrink-0 text-neutral-400" />}<div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Contact detail</p><p className="m-0 truncate text-xs font-semibold text-neutral-700">{lead.contactPhone || lead.contactEmail || "Not supplied"}</p></div></div>
                      <div className="flex items-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2.5"><MapPin className="h-4 w-4 shrink-0 text-neutral-400" /><div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Location</p><p className="m-0 truncate text-xs font-semibold text-neutral-700">{[lead.location, lead.ward, lead.district, lead.region].filter(Boolean).join(", ") || "Not supplied"}</p></div></div>
                      <div className="flex items-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2.5"><ShieldCheck className="h-4 w-4 shrink-0 text-neutral-400" /><div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Sales partner</p><p className="m-0 truncate text-xs font-semibold text-neutral-700">{lead.salesPartner.agentCode} / {lead.salesPartner.user.name || lead.salesPartner.user.email}</p></div></div>
                    </div>
                    {flagged && (
                      <label className="mt-3 block rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs font-bold text-amber-900">
                        Duplicate review decision
                        <select
                          value={duplicateDecision[lead.id] || ""}
                          onChange={(event) => setDuplicateDecision((current) => ({ ...current, [lead.id]: event.target.value as "CLEAR" | "MATCH" }))}
                          className={`${fieldClass} mt-1.5 border-amber-200 bg-white`}
                        >
                          <option value="">Choose a decision</option>
                          <option value="CLEAR">Reviewed - separate prospect</option>
                          <option value="MATCH">Reviewed - matches this property</option>
                        </select>
                      </label>
                    )}
                  </div>

                  <div className="min-w-0 rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Property binding</p>
                        <p className="mb-0 mt-0.5 text-xs text-neutral-500">Find the existing record before verification.</p>
                      </div>
                      <span className="rounded-full border border-neutral-200 bg-white px-2 py-1 text-[10px] font-bold text-neutral-500">Required</span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={propertyQuery[lead.id] || ""}
                        onChange={(event) => setPropertyQuery((current) => ({ ...current, [lead.id]: event.target.value }))}
                        className={fieldClass}
                        placeholder="ID, property, city or owner email"
                        aria-label={`Find property for ${lead.propertyName}`}
                      />
                      <button type="button" className={`${secondaryButton} shrink-0 px-3`} onClick={() => void searchProperties(lead.id)} disabled={busy === `property-${lead.id}`} aria-label={`Search property for ${lead.propertyName}`}>
                        {busy === `property-${lead.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      </button>
                    </div>
                    {(propertyHits[lead.id] || []).length > 0 && (
                      <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                        {propertyHits[lead.id].map((property) => (
                          <button
                            type="button"
                            key={property.id}
                            onClick={() => setSelectedProperty((current) => ({ ...current, [lead.id]: property }))}
                            className={`block w-full rounded-xl border p-3 text-left text-xs transition ${
                              selected?.id === property.id ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100" : "border-neutral-200 bg-white hover:border-emerald-200"
                            }`}
                          >
                            <span className="font-black text-slate-900">#{property.id} {property.title}</span>
                            <span className="mt-1 block text-slate-500">{property.city || property.regionName || "Location unavailable"} · {property.status}</span>
                            {property.salesAttributions.length > 0 && (
                              <span className="mt-1 block font-bold text-amber-700">
                                Existing: {property.salesAttributions.map((item) => `${item.productType} → ${item.salesPartner.agentCode} (${item.status})`).join(", ")}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    {selected && (
                      <div className="mt-2 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 className="h-4 w-4 shrink-0" /> Selected #{selected.id} {selected.title}
                      </div>
                    )}
                    <textarea
                      value={reason[lead.id] || ""}
                      onChange={(event) => setReason((current) => ({ ...current, [lead.id]: event.target.value }))}
                      className={`${fieldClass} mt-3 min-h-20 py-2`}
                      placeholder="Review reason and evidence"
                      aria-label={`Review reason for ${lead.propertyName}`}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={primaryButton} onClick={() => void approve(lead)} disabled={Boolean(busy)}>
                        {busy === `approve-${lead.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify conversion
                      </button>
                      <button type="button" className={secondaryButton} onClick={() => void reject(lead)} disabled={Boolean(busy)}>
                        {busy === `reject-${lead.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Return
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="space-y-3">
          {attributions.length === 0 && (
            <div className="grid min-h-72 place-items-center rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-neutral-100 text-neutral-500"><Layers3 className="h-5 w-5" /></span>
                <h2 className="mb-0 mt-3 text-sm font-bold text-neutral-800">No attributions yet</h2>
                <p className="mb-0 mt-1 text-xs text-neutral-500">Verified property bindings will appear here.</p>
              </div>
            </div>
          )}
          {attributions.map((item) => (
            <article key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] transition hover:border-emerald-100">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700"><Building2 className="h-4 w-4" /></span>
                    <div className="min-w-0"><h2 className="m-0 truncate text-sm font-bold text-neutral-950">#{item.property.id} {item.property.title}</h2><p className="m-0 mt-0.5 text-[11px] text-neutral-400">Attribution #{item.id}</p></div>
                    <span className="rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">{item.productType}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone(item.status)}`}>{item.status}</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-neutral-600 sm:grid-cols-2">
                    <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2"><span className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400">Partner</span><b className="font-semibold">{item.salesPartner.agentCode}</b> / {item.salesPartner.user.name || item.salesPartner.user.email}</div>
                    <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2"><span className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400">Contract</span>{item.contract?.contractNumber || "Not bound"}</div>
                    <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2"><span className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400">Earning starts</span>{dateTime(item.commissionStartsAt)}</div>
                    <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2"><span className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400">Earning ends</span>{dateTime(item.commissionEndsAt)}</div>
                  </div>
                </div>
                <div className="grid min-w-0 gap-2 rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 sm:grid-cols-2 xl:w-[620px] xl:grid-cols-[minmax(0,1fr)_170px_auto]">
                  <input
                    value={reason[item.id] || ""}
                    onChange={(event) => setReason((current) => ({ ...current, [item.id]: event.target.value }))}
                    className={fieldClass}
                    placeholder="Required action reason"
                    aria-label={`Action reason for ${item.property.title}`}
                  />
                  <input
                    value={targetPartner[item.id] || ""}
                    onChange={(event) => setTargetPartner((current) => ({ ...current, [item.id]: event.target.value }))}
                    className={fieldClass}
                    inputMode="numeric"
                    placeholder="Target partner ID"
                    aria-label={`Target partner for ${item.property.title}`}
                  />
                  <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1">
                    {item.status === "VERIFIED" && (
                      <button type="button" className={primaryButton} onClick={() => void attributionAction(item, "activate")} disabled={Boolean(busy)}>
                        {busy === `activate-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Activate
                      </button>
                    )}
                    {item.status !== "REVOKED" && (
                      <button type="button" className={secondaryButton} onClick={() => void attributionAction(item, "revoke")} disabled={Boolean(busy)}>
                        <XCircle className="h-4 w-4" /> Revoke
                      </button>
                    )}
                    <button type="button" className={secondaryButton} onClick={() => void attributionAction(item, "reassign")} disabled={Boolean(busy)}>
                      {busy === `reassign-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />} Reassign
                    </button>
                  </div>
                </div>
              </div>
              <p className="mb-0 mt-3 text-[10px] font-medium text-neutral-400">Finance OTP is required for activation, revocation and reassignment.</p>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
