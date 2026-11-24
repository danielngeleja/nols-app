"use client";

/**
 * Admin moderation of a long-stay home (docs/LONG_STAY_RENTALS.md sections 3
 * and 13). Everything the admin needs before approving, in one place:
 *   1. Readiness: landlord switch, monthly terms, on-site inspection, living rules.
 *   2. Monthly terms and the money at the minimum term (server's calculator).
 *   3. Living rules and the lease a tenant would sign (printable sample).
 *   4. The Sales Partner's on-site inspection: who went, where the phone stood
 *      against the listing pin, the photos taken there, the checklist and the
 *      partner's note, with the pass / fail / redo decision.
 * Renders nothing for nightly listings.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, BadgeCheck, CalendarRange, CheckCircle2, CigaretteOff, ClipboardCheck, Clock3,
  FileText, History, Loader2, MoonStar, Phone, ShieldAlert, ShieldCheck, Tag, UserRoundCheck, Users, Wallet,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import DocumentViewer from "@/components/admin/DocumentViewer";
import InspectionReportReview, { type InspectionCheck, type InspectionPoint, type InspectionReport } from "./InspectionReportReview";
import { LEASE_PDF_FLOW, leaseDocumentHtml } from "@/lib/leaseDocument";

type Terms = {
  monthlyRent: number;
  currency: string;
  minTermMonths: number;
  maxTermMonths: number | null;
  upfrontMonths: number;
  furnished: "FURNISHED" | "SEMI" | "UNFURNISHED";
  utilities: Record<string, "INCLUDED" | "TENANT">;
  securityDepositMonths: number;
  noticePeriodDays: number;
  balanceMethods: string[];
  residencyRules: { petsAllowed: boolean; maxOccupants: number } | null;
  availableFrom: string;
};
type Quote = { tenantFee: number; landlordCommission: number; bookingAmount: number; balanceDue: number; landlordPayout: number };
type Inspection = {
  ref: string;
  status: "REQUESTED" | "ASSIGNED" | "SUBMITTED" | "PASSED" | "FAILED" | "CANCELLED";
  reason: string;
  partner: { code: string; name: string | null; phone: string | null } | null;
  assignedBy: string | null;
  assignedAt: string | null;
  dueBy: string | null;
  overdue: boolean;
  report: InspectionReport | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  validUntil: string | null;
  current: boolean;
  feeAmount: number | null;
  createdAt: string;
};
type HistoryRow = { ref: string; status: string; reason: string; partnerCode: string | null; reviewedAt: string | null; validUntil: string | null; createdAt: string };
type OnboardedBy = {
  code: string;
  name: string | null;
  phone: string | null;
  region: string | null;
  partnerStatus: string;
  source: "ASSISTED_LISTING" | "ATTRIBUTION";
  status: string;
  productType: string | null;
  since: string;
  verified: boolean;
};
type Candidate = {
  code: string;
  name: string | null;
  region: string | null;
  territory: string | null;
  level: string;
  match: "AREA" | "REGION" | "OTHER";
  openVisits: number;
  doneInspections: number;
  assigned: boolean;
};
type RawRules ={ smokingPolicy: string | null; overnightGuests: string | null; overnightNights: number | null; quietHours: string | null; other: string | null } | null;
type Data = {
  rentalMode: string;
  terms: Terms | null;
  inspectionRequiredForApproval?: boolean;
  quote?: Quote | null;
  landlord?: { granted: boolean; paused: boolean; pauseReason: string | null };
  pin?: InspectionPoint | null;
  checklist?: InspectionCheck[];
  inspection?: Inspection | null;
  history?: HistoryRow[];
  onboardedBy?: OnboardedBy[];
  candidates?: Candidate[];
  livingRules?: string[];
  rawRules?: RawRules;
};

const UTILITY_LABEL: Record<string, string> = { water: "Water", electricity: "Electricity", internet: "Internet", security: "Security", serviceCharge: "Service charge" };
const FURNISHED_LABEL = { FURNISHED: "Furnished", SEMI: "Semi-furnished", UNFURNISHED: "Unfurnished" } as const;
const REASON_TEXT: Record<string, string> = { FIRST: "First inspection", YEARLY: "Yearly check", AFTER_DISPUTE: "After an upheld complaint", RELISTED: "Relisted home" };
const STATUS_TEXT: Record<string, { label: string; tone: string }> = {
  REQUESTED: { label: "No partner yet", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  ASSIGNED: { label: "Visit booked", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
  SUBMITTED: { label: "Report to review", tone: "bg-violet-50 text-violet-800 ring-violet-200" },
  PASSED: { label: "Passed", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  FAILED: { label: "Failed", tone: "bg-red-50 text-red-700 ring-red-200" },
  CANCELLED: { label: "Cancelled", tone: "bg-slate-100 text-slate-600 ring-slate-200" },
};

const money = (value: number, currency: string) => `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: currency === "TZS" ? 0 : 2 })}`;
const eat = (iso: string | null | undefined) =>
  iso ? `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "";
const day = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "SP";

/** The long-stay steps that count toward the review progress bar. */
export type ReviewCheck = { label: string; ok: boolean };

function longStayChecks(data: Data | null): ReviewCheck[] {
  if (!data || data.rentalMode !== "LONG_STAY") return [];
  return [
    { label: "Landlord switched on for long stays", ok: Boolean(data.landlord?.granted && !data.landlord?.paused) },
    { label: "Monthly terms saved", ok: Boolean(data.terms) },
    ...(data.inspectionRequiredForApproval !== false ? [
      { label: "Sales Partner assigned to inspect", ok: Boolean(data.inspection?.partner) },
      { label: "On-site report received", ok: Boolean(data.inspection?.report?.submittedAt) },
      { label: "Inspection passed and current", ok: Boolean(data.inspection?.current) },
    ] : []),
    { label: "Living rules set", ok: (data.livingRules?.length ?? 0) > 0 },
  ];
}

export default function LongStayReview({ propertyId, expectLongStay, onMode, onChecks }: {
  propertyId: number;
  /** The list says this is a long stay: show the review's skeleton while it loads. */
  expectLongStay?: boolean;
  onMode?: (rentalMode: string | null) => void;
  /** Long-stay steps for the review progress bar (empty for nightly homes). */
  onChecks?: (checks: ReviewCheck[]) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState("");
  const [leaseOpen, setLeaseOpen] = useState(false);
  const checksKey = JSON.stringify(longStayChecks(data));
  useEffect(() => {
    onChecks?.(JSON.parse(checksKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checksKey]);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const response = await apiClient.get<Data>(`/api/admin/long-stay/properties/${propertyId}`);
      setData(response.data);
      onMode?.(response.data.rentalMode);
    } catch (error: any) {
      setData(null);
      setLoadError(error?.response?.data?.error || "");
      onMode?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);
  useEffect(() => { void load(); }, [load]);

  if (!data && !loadError && expectLongStay) return <LongStayReviewSkeleton />;
  if (!data || data.rentalMode !== "LONG_STAY") {
    return loadError ? (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-solid border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
        <span>Could not load the long-stay review: {loadError}</span>
        <button type="button" onClick={() => void load()} className="cursor-pointer rounded-md border border-solid border-red-300 bg-white px-2.5 py-1 text-[12.5px] font-semibold text-red-700 hover:bg-red-50 [font-family:inherit]">Try again</button>
      </div>
    ) : null;
  }

  const t = data.terms;
  const landlordOk = Boolean(data.landlord?.granted && !data.landlord?.paused);
  const inspection = data.inspection ?? null;
  const inspectionRequired = data.inspectionRequiredForApproval !== false;
  const rulesCount = data.livingRules?.length ?? 0;
  const checks: Array<{ ok: boolean; label: string; detail: string }> = [
    {
      ok: landlordOk,
      label: "Landlord switched on",
      detail: data.landlord?.paused ? `Paused${data.landlord.pauseReason ? `: ${data.landlord.pauseReason}` : ""}` : data.landlord?.granted ? "Long stays allowed" : "Not switched on",
    },
    { ok: Boolean(t), label: "Monthly terms", detail: t ? `${money(t.monthlyRent, t.currency)} a month` : "Not saved yet" },
    {
      ok: Boolean(inspection?.current),
      label: "On-site inspection",
      detail: inspection?.current ? `Passed, valid to ${day(inspection.validUntil)}` : inspection ? STATUS_TEXT[inspection.status]?.label || inspection.status : "Not opened",
    },
    { ok: rulesCount > 0, label: "Living rules", detail: rulesCount ? `${rulesCount} set` : "Only the standard lease rules" },
  ];
  const blockers = checks.slice(0, inspectionRequired ? 3 : 2).filter((c) => !c.ok);

  return (
    <div id="ls-review" className="mb-5 space-y-4">
      <style>{`#ls-review, #ls-review * { box-sizing: border-box; }`}</style>

      {/* 1. Readiness */}
      <section className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><CalendarRange className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[11px] font-semibold text-slate-500">Long-stay review</p>
            <h2 className="m-0 text-[17px] font-bold text-slate-900">{blockers.length ? "Not ready to approve" : "Ready to approve"}</h2>
            <p className="m-0 mt-0.5 text-[13px] text-slate-500">
              {blockers.length
                ? `Waiting on: ${blockers.map((b) => b.label.toLowerCase()).join(", ")}. The server refuses approval until these are done.`
                : inspection?.current
                  ? "The landlord is switched on, the terms are complete and the inspection is current."
                  : "The listing can be approved while the site visit is pending."}
            </p>
          </div>
          {t ? <span className="text-[12px] text-slate-500">Available from {day(t.availableFrom)}</span> : null}
        </div>
        <div className="grid border-0 border-t border-solid border-slate-100 sm:grid-cols-2 lg:grid-cols-4">
          {checks.map((c, i) => (
            <div key={c.label} className={`flex items-start gap-2.5 px-5 py-3 ${i ? "border-0 border-t border-solid border-slate-100 sm:border-t-0 sm:border-l" : ""}`}>
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : i === 2 && !inspectionRequired ? <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${i === 3 ? "text-slate-400" : "text-amber-600"}`} />}
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-slate-800">{c.label}</span>
                <span className="block truncate text-[12px] text-slate-500">{c.detail}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 2 + 3. Terms, money, living rules, lease */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card icon={<Wallet className="h-4 w-4" />} title="Monthly terms" aside={t ? `${t.minTermMonths} months minimum` : undefined}>
          {!t ? (
            <p className="m-0 px-5 py-4 text-sm text-slate-600">The landlord has not saved monthly terms yet.</p>
          ) : (
            <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
              <dl className="m-0 space-y-2 bg-white px-5 py-4 text-[13px]">
                <Row label="Monthly rent" value={money(t.monthlyRent, t.currency)} strong />
                <Row label="Term" value={`${t.minTermMonths}${t.maxTermMonths ? ` to ${t.maxTermMonths}` : "+"} months`} />
                <Row label="Paid up front" value={`${t.upfrontMonths} ${t.upfrontMonths === 1 ? "month" : "months"}`} />
                <Row label="Deposit (to landlord)" value={t.securityDepositMonths ? `${t.securityDepositMonths} ${t.securityDepositMonths === 1 ? "month" : "months"}` : "None"} />
                <Row label="Notice" value={`${t.noticePeriodDays} days`} />
                <Row label="Furnishing" value={FURNISHED_LABEL[t.furnished]} />
                <Row label="Balance paid by" value={t.balanceMethods.map((m) => (m === "BANK" ? "Bank" : "Mobile money")).join(", ")} />
                {t.residencyRules ? <Row label="Occupants, pets" value={`Up to ${t.residencyRules.maxOccupants}, pets ${t.residencyRules.petsAllowed ? "allowed" : "not allowed"}`} /> : null}
                <Row label="Bills included" value={Object.entries(t.utilities).filter(([, v]) => v === "INCLUDED").map(([k]) => UTILITY_LABEL[k] || k).join(", ") || "None"} />
              </dl>
              {data.quote ? (
                <dl className="m-0 space-y-2 bg-slate-50/60 px-5 py-4 text-[13px]">
                  <p className="m-0 text-[11px] font-semibold text-slate-400">At {t.minTermMonths} months, today&apos;s rates</p>
                  <Row label="Tenant pays NoLSAF (card)" value={money(data.quote.bookingAmount, t.currency)} />
                  <Row label="Tenant pays landlord at move-in" value={money(data.quote.balanceDue, t.currency)} />
                  <Row label="Tenant fee" value={money(data.quote.tenantFee, t.currency)} muted />
                  <Row label="Landlord commission" value={money(data.quote.landlordCommission, t.currency)} muted />
                  <div className="border-0 border-t border-solid border-slate-200 pt-2">
                    <Row label="Released to landlord" value={money(data.quote.landlordPayout, t.currency)} strong />
                  </div>
                </dl>
              ) : null}
            </div>
          )}
        </Card>

        <Card
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Living rules and lease"
          aside={
            <button type="button" onClick={() => setLeaseOpen(true)} disabled={!t}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-[12.5px] font-semibold text-slate-700 hover:border-[#02665e] hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-50 [font-family:inherit]">
              <FileText className="h-3.5 w-3.5" />Read the lease
            </button>
          }
        >
          <ul className="m-0 list-none p-0">
            <RuleRow Icon={CigaretteOff} label="Smoking" value={{ outside: "Outside only", none: "Not at all", allowed: "Allowed" }[data.rawRules?.smokingPolicy || ""] || null} />
            <RuleRow Icon={Users} label="Overnight visitors" value={{ allowed: "Welcome", limited: `Up to ${data.rawRules?.overnightNights || 7} nights a month`, none: "Not allowed" }[data.rawRules?.overnightGuests || ""] || null} />
            <RuleRow Icon={MoonStar} label="Quiet hours" value={data.rawRules?.quietHours || null} optional />
            <RuleRow Icon={Tag} label="Anything else" value={data.rawRules?.other?.trim() || null} optional />
          </ul>
          <p className="m-0 border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-5 py-3 text-[12px] leading-5 text-slate-500">
            Every lease also bars subletting and nightly re-letting, needs 24 hours&apos; notice for visits, splits repairs and needs the landlord&apos;s OK for changes.
          </p>
        </Card>
      </div>

      {/* 4. On-site inspection */}
      <InspectionSection propertyId={propertyId} data={data} onChanged={load} />

      {leaseOpen ? <AdminLeasePreview propertyId={propertyId} onClose={() => setLeaseOpen(false)} /> : null}
    </div>
  );
}

/** Same shape as the loaded review (readiness strip, two cards, inspection), so nothing jumps. */
function LongStayReviewSkeleton() {
  const bar = "block animate-pulse rounded-md bg-slate-200/80";
  return (
    <div className="mb-5 space-y-4" aria-busy="true">
      <span className="sr-only">Loading the long-stay review</span>
      <section className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-5 py-4">
          <span className={`${bar} h-10 w-10 rounded-lg`} />
          <div className="flex-1 space-y-2"><span className={`${bar} h-3 w-24`} /><span className={`${bar} h-4 w-48`} /><span className={`${bar} h-3 w-3/4`} /></div>
        </div>
        <div className="grid gap-4 border-0 border-t border-solid border-slate-100 px-5 py-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-2.5"><span className={`${bar} h-4 w-4 rounded-full`} /><div className="flex-1 space-y-1.5"><span className={`${bar} h-3 w-24`} /><span className={`${bar} h-3 w-32`} /></div></div>)}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {[0, 1].map((i) => (
          <section key={i} className="space-y-3 rounded-xl border border-solid border-slate-200 bg-white p-5">
            <span className={`${bar} h-4 w-36`} />
            {[0, 1, 2, 3, 4].map((j) => <div key={j} className="flex justify-between gap-4"><span className={`${bar} h-3 w-28`} /><span className={`${bar} h-3 w-20`} /></div>)}
          </section>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-5 py-3.5"><span className={`${bar} h-9 w-9 rounded-lg`} /><div className="flex-1 space-y-2"><span className={`${bar} h-4 w-40`} /><span className={`${bar} h-3 w-72 max-w-full`} /></div></div>
        <div className="grid gap-3 bg-slate-50/70 p-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="space-y-2.5 rounded-lg border border-solid border-slate-200 bg-white p-4"><span className={`${bar} h-3 w-20`} /><div className="flex gap-3"><span className={`${bar} h-10 w-10 rounded-full`} /><div className="flex-1 space-y-1.5"><span className={`${bar} h-4 w-32`} /><span className={`${bar} h-3 w-24`} /></div></div></div>)}
        </div>
      </section>
    </div>
  );
}

function Card({ icon, title, aside, children }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-5 py-3">
        <h3 className="m-0 flex items-center gap-2 text-[14px] font-bold text-slate-900"><span className="text-[#02665e]">{icon}</span>{title}</h3>
        {typeof aside === "string" ? <span className="text-[12px] text-slate-500">{aside}</span> : aside}
      </header>
      {children}
    </section>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`m-0 text-right ${strong ? "font-bold text-slate-900" : muted ? "text-slate-500" : "text-slate-800"}`}>{value}</dd>
    </div>
  );
}

function RuleRow({ Icon, label, value, optional }: { Icon: typeof Users; label: string; value: string | null; optional?: boolean }) {
  return (
    <li className="flex items-center gap-3 border-0 border-b border-solid border-slate-100 px-5 py-2.5 last:border-b-0">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${value ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-400"}`}><Icon className="h-4 w-4" /></span>
      <span className="w-36 shrink-0 text-[13px] text-slate-500">{label}</span>
      <span className={`min-w-0 flex-1 text-right text-[13px] ${value ? "font-semibold text-slate-800" : "italic text-slate-400"}`}>{value || (optional ? "None" : "Not set")}</span>
    </li>
  );
}

function AdminLeasePreview({ propertyId, onClose }: { propertyId: number; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    apiClient.get<{ text: string; version: string }>(`/api/admin/long-stay/properties/${propertyId}/lease-preview`)
      .then((r) => { if (active) { setText(r.data.text); setVersion(r.data.version); } })
      .catch((e) => { if (active) setError(e?.response?.data?.error || "Could not build the lease."); });
    return () => { active = false; };
  }, [propertyId]);
  const html = useMemo(() => (text ? leaseDocumentHtml({ text, version, reference: "SAMPLE", sample: true }) : ""), [text, version]);
  return (
    <DocumentViewer open title="The lease a tenant would sign" subtitle={version ? `Sample · version ${version}` : "Sample"} html={html}
      loading={!text && !error} error={error || null} filename="NoLSAF lease sample.pdf" pdfFormat="a4" pdfFlow={LEASE_PDF_FLOW} onClose={onClose} />
  );
}

function InspectionSection({ propertyId, data, onChanged }: { propertyId: number; data: Data; onChanged: () => void }) {
  const item = data.inspection ?? null;
  const checklist = data.checklist ?? [];
  const [partnerCode, setPartnerCode] = useState(item?.partner?.code ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setPartnerCode(item?.partner?.code ?? ""); }, [item?.ref, item?.status, item?.partner?.code]);

  const run = async (key: string, url: string, body: unknown) => {
    setBusy(key);
    setError("");
    try {
      await apiClient.post(url, body);
      onChanged();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 [font-family:inherit]";
  const status = item ? STATUS_TEXT[item.status] : null;
  const r = item?.report ?? null;
  const canReview = item?.status === "SUBMITTED" && Boolean(r);

  return (
    <section className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
      <header className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><ClipboardCheck className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[15px] font-bold text-slate-900">On-site inspection</h3>
          <p className="m-0 text-[12.5px] text-slate-500">
            {item ? `${REASON_TEXT[item.reason] || item.reason} · ` : ""}
            {data.inspectionRequiredForApproval === false ? "Approval can proceed while the visit is pending. Reservations open after a current pass." : "A current inspection is required for approval and reservations."}
          </p>
        </div>
        {status ? <span className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset ${status.tone}`}>{item?.status === "PASSED" && !item.current ? "Expired" : status.label}</span> : null}
      </header>

      {!item ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
          <p className="m-0 text-sm text-slate-600">Open an inspection to assign a partner for the site visit.</p>
          <button type="button" disabled={busy !== null} onClick={() => run("open", `/api/admin/long-stay/properties/${propertyId}/inspection`, {})} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
            {busy === "open" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}Open an inspection
          </button>
        </div>
      ) : (
        <>
          {/* Inspector, onboarding and the visit timeline, as cards */}
          <div className="grid gap-3 bg-slate-50/70 p-4 lg:grid-cols-3">
            <MiniCard title="Inspector" icon={<UserRoundCheck className="h-3.5 w-3.5" />}>
              {item.partner ? (
                <PartnerLine name={item.partner.name || "Partner"} code={item.partner.code} phone={item.partner.phone} tone="brand"
                  note={item.overdue ? <span className="font-semibold text-red-700">Visit overdue</span> : item.status === "ASSIGNED" ? `Visit by ${eat(item.dueBy)}` : null} />
              ) : (
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-dashed border-amber-300 text-amber-600"><UserRoundCheck className="h-4 w-4" /></span>
                  <div>
                    <p className="m-0 text-[14px] font-bold text-slate-900">Not assigned yet</p>
                    <p className="m-0 mt-0.5 text-[12.5px] leading-5 text-slate-500">Choose a partner to send an invitation to their Sales inbox. They have 5 days to visit and submit a report.</p>
                  </div>
                </div>
              )}
            </MiniCard>

            <MiniCard title="Brought to NoLSAF by" icon={<BadgeCheck className="h-3.5 w-3.5" />}>
              {(data.onboardedBy?.length ?? 0) === 0 ? (
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500"><Users className="h-4 w-4" /></span>
                  <div>
                    <p className="m-0 text-[14px] font-bold text-slate-900">The owner, directly</p>
                    <p className="m-0 mt-0.5 text-[12.5px] leading-5 text-slate-500">No Sales Partner onboarded this home, so any active partner may inspect it.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.onboardedBy!.map((p) => (
                    <PartnerLine key={p.code} name={p.name || "Partner"} code={p.code} phone={p.phone} tone="muted"
                      badge={p.source === "ASSISTED_LISTING" ? "Listed it for the owner" : `Sales attribution${p.verified ? ", verified" : ""}`}
                      note={`Since ${day(p.since)}${p.region ? ` · ${p.region}` : ""}${p.partnerStatus !== "ACTIVE" ? ` · ${p.partnerStatus.toLowerCase()}` : ""}`} />
                  ))}
                  <p className="m-0 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11.5px] leading-5 text-amber-900">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Cannot inspect this home: a partner never checks a home they brought in.
                  </p>
                </div>
              )}
            </MiniCard>

            <MiniCard title="Visit timeline" icon={<Clock3 className="h-3.5 w-3.5" />}>
              <ol className="m-0 list-none space-y-2.5 p-0">
                <TimelineStep done label="Requested" at={eat(item.createdAt) || REASON_TEXT[item.reason] || ""} />
                <TimelineStep done={Boolean(item.assignedAt)} label="Partner assigned" at={item.assignedAt ? `${eat(item.assignedAt)}${item.assignedBy ? ` by ${item.assignedBy}` : ""}` : "Choose an inspector below"} />
                <TimelineStep done={Boolean(r?.capturedAt)} label={item.status === "ASSIGNED" && item.reviewedAt ? "Return visit requested" : "Visited the home"} at={r?.capturedAt ? eat(r.capturedAt) : item.dueBy ? `Due ${eat(item.dueBy)}` : "Waiting for assignment"} warn={item.overdue} />
                <TimelineStep done={Boolean(r?.submittedAt)} label="Report submitted" at={r?.submittedAt ? eat(r.submittedAt) : "Waiting for the partner’s report"} />
                <TimelineStep done={item.status === "PASSED" || item.status === "FAILED"} label="NoLSAF decision" at={item.status === "PASSED" || item.status === "FAILED" ? eat(item.reviewedAt) : r?.submittedAt ? "Ready for review" : "Waiting for a report"} last />
              </ol>
            </MiniCard>
          </div>

          {(item.status === "REQUESTED" || item.status === "ASSIGNED") ? (
            <div className="border-0 border-t border-solid border-slate-100 px-5 py-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="m-0 text-[13.5px] font-bold text-slate-900">{item.partner ? "Give the visit to another partner" : "Choose who inspects"}</p>
                <span className="text-[12px] text-slate-500">Active partners, closest to the home first, then the least busy</span>
              </div>
              {(data.candidates?.length ?? 0) ? (
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Sales Partner">
                  {data.candidates!.map((c) => {
                    const on = partnerCode === c.code;
                    return (
                      <button key={c.code} type="button" role="radio" aria-checked={on} disabled={c.assigned} onClick={() => setPartnerCode(c.code)}
                        className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border border-solid p-3 text-left transition [font-family:inherit] disabled:cursor-default ${on ? "border-[#02665e] bg-[#02665e]/[0.05] ring-1 ring-[#02665e]" : "border-slate-200 bg-white hover:border-slate-300"} ${c.assigned ? "opacity-70" : ""}`}>
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold ${on ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-600"}`}>{initials(c.name || c.code)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-slate-900">{c.name || "Partner"}</span>
                            {c.assigned ? <span className="shrink-0 text-[11px] font-semibold text-sky-700">Assigned</span> : on ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#02665e]" /> : null}
                          </span>
                          <span className="block font-mono text-[11.5px] text-slate-500">{c.code}</span>
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            <span className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${c.match === "OTHER" ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-800"}`}>
                              {c.match === "AREA" ? "Works this area" : c.match === "REGION" ? "Same region" : c.region || "Other region"}
                            </span>
                            <span className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${c.openVisits >= 3 ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{c.openVisits} open {c.openVisits === 1 ? "visit" : "visits"}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-px text-[10.5px] font-semibold text-slate-600">{c.doneInspections} done</span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="m-0 rounded-md bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">No other active Sales Partner is available. Enter a code below.</p>
              )}
              <div className="mt-3 flex flex-wrap items-end gap-2 border-0 border-t border-dashed border-slate-200 pt-3">
                <label className="block text-[12px] font-semibold text-slate-600">Or enter a partner code
                  <input value={partnerCode} onChange={(e) => setPartnerCode(e.target.value.toUpperCase())} placeholder="NSA-DAR-0042" maxLength={30}
                    className="mt-1 block h-9 w-52 rounded-md border border-solid border-slate-300 bg-white px-2.5 font-mono text-sm outline-none focus:border-[#02665e]" />
                </label>
                <button type="button" disabled={partnerCode.trim().length < 3 || busy !== null || partnerCode === item.partner?.code}
                  onClick={() => run("assign", `/api/admin/long-stay/inspections/${encodeURIComponent(item.ref)}/assign`, { partnerCode: partnerCode.trim() })}
                  className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
                  {busy === "assign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
                  {item.partner ? "Reassign and notify" : "Invite partner"}
                </button>
                <span className="text-[12px] text-slate-500">The invitation appears in Sales Notifications and the partner’s inspection queue in Leads.</span>
              </div>
            </div>
          ) : null}

          {r && (
            <InspectionReportReview key={r.submittedAt ?? item.ref} inspectionRef={item.ref} report={r} checklist={checklist} pin={data.pin ?? null}
              busy={busy !== null} error={error} onDecision={canReview ? (decision, note) => run(decision, `/api/admin/long-stay/inspections/${encodeURIComponent(item.ref)}/review`, { decision, note }) : undefined} />
          )}

          {!canReview && item.reviewedAt ? (
            <div className="flex flex-wrap items-start gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-5 py-3.5 text-[12.5px] text-slate-600">
              {item.status === "PASSED" ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : item.status === "FAILED" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
              <span className="min-w-0 flex-1">
                <b className="text-slate-800">NoLSAF decision</b>{item.reviewedBy ? ` by ${item.reviewedBy}` : ""} · {eat(item.reviewedAt)}
                {item.reviewNote ? <span className="block text-slate-700">{item.reviewNote}</span> : null}
              </span>
              <span className="text-right">
                {item.validUntil ? <span className="block">Valid to {day(item.validUntil)}</span> : null}
                {item.feeAmount ? <span className="block">Partner fee TZS {item.feeAmount.toLocaleString("en-US")}</span> : null}
              </span>
            </div>
          ) : null}
        </>
      )}

      {(data.history?.length ?? 0) > 0 ? (
        <div className="border-0 border-t border-solid border-slate-100 px-5 py-3.5">
          <p className="m-0 mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-slate-700"><History className="h-3.5 w-3.5" />Earlier inspections</p>
          <ul className="m-0 list-none space-y-1 p-0">
            {data.history!.map((h) => (
              <li key={h.ref} className="flex flex-wrap items-center gap-x-3 text-[12.5px] text-slate-600">
                <span className={`rounded px-1.5 py-px text-[11px] font-semibold ring-1 ring-inset ${STATUS_TEXT[h.status]?.tone || "bg-slate-100 text-slate-600 ring-slate-200"}`}>{STATUS_TEXT[h.status]?.label || h.status}</span>
                <span>{REASON_TEXT[h.reason] || h.reason}</span>
                {h.partnerCode ? <span className="font-mono text-slate-500">{h.partnerCode}</span> : null}
                <span className="text-slate-400">{h.reviewedAt ? `decided ${day(h.reviewedAt)}` : `opened ${day(h.createdAt)}`}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error && !canReview ? <p role="alert" className="m-0 border-0 border-t border-solid border-red-100 bg-red-50 px-5 py-2.5 text-[12.5px] text-red-700">{error}</p> : null}
    </section>
  );
}

function MiniCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-solid border-slate-200 bg-white p-4">
      <p className="m-0 mb-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500"><span className="text-[#02665e]">{icon}</span>{title}</p>
      {children}
    </div>
  );
}

function PartnerLine({ name, code, phone, tone, badge, note }: { name: string; code: string; phone: string | null; tone: "brand" | "muted"; badge?: string; note?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-bold ${tone === "brand" ? "bg-[#02665e] text-white" : "bg-slate-200 text-slate-700"}`}>{initials(name || code)}</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[14px] font-bold text-slate-900">{name}</p>
        <p className="m-0 flex flex-wrap items-center gap-x-2.5 text-[12px] text-slate-500">
          <span className="font-mono">{code}</span>
          {phone ? <a href={`tel:${phone}`} className="inline-flex items-center gap-1 text-[#02665e] no-underline"><Phone className="h-3 w-3" />{phone}</a> : null}
        </p>
        {badge ? <span className="mt-1.5 inline-block rounded bg-slate-100 px-1.5 py-px text-[10.5px] font-semibold text-slate-600">{badge}</span> : null}
        {note ? <p className="m-0 mt-1 text-[12px] text-slate-500">{note}</p> : null}
      </div>
    </div>
  );
}

function TimelineStep({ done, label, at, warn, last }: { done: boolean; label: string; at: string; warn?: boolean; last?: boolean }) {
  return (
    <li className="relative flex items-start gap-2.5">
      {!last ? <span className={`absolute left-[7px] top-4 h-[calc(100%+2px)] w-px ${done ? "bg-[#02665e]/40" : "bg-slate-200"}`} aria-hidden /> : null}
      <span className={`relative mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${done ? "bg-[#02665e] text-white" : warn ? "border-2 border-solid border-red-400 bg-white" : "border-2 border-solid border-slate-300 bg-white"}`}>
        {done ? <CheckCircle2 className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className={`block text-[12.5px] font-semibold ${done ? "text-slate-800" : "text-slate-500"}`}>{label}</span>
        <span className={`block truncate text-[11.5px] ${warn ? "font-semibold text-red-700" : "text-slate-500"}`}>{warn ? `${at} (overdue)` : at}</span>
      </span>
    </li>
  );
}
