"use client";

/**
 * Admin: the partner's whole file, opened inside the partner record. Read only:
 * leads, field visits, attributed properties, the commission ledger,
 * withdrawals and the history of every action on the partner. Decisions stay in
 * the sections that own them (Conversion review, Finance), linked from here.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, Footprints, ListChecks, Loader2, Search, Send } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type PartnerFileData = {
  account: {
    taxIdNumber: string | null; payoutName: string | null; levelUpdatedAt: string | null; registeredAt: string | null;
    emailVerified: boolean; phoneVerified: boolean; hasPhoto: boolean;
  };
  leads: Array<{
    ref: string; propertyName: string; status: string; product: string; area: string; contact: string | null; createdAt: string; updatedAt: string;
    nextFollowUpAt: string | null; protectedUntil: string | null; possibleDuplicate: boolean; conversionRequestedAt: string | null; convertedAt: string | null;
    lostReason: string | null; activities: number; visits: number;
  }>;
  properties: Array<{
    ref: string; title: string; area: string; listingStatus: string | null; product: string; status: string; attributedAt: string; verifiedAt: string | null;
    earningFrom: string | null; earningUntil: string | null; disputeReason: string | null; revokedAt: string | null; earned: number;
  }>;
  earnings: {
    totals: Array<{ type: string; status: string; amount: number; count: number }>;
    rows: Array<{
      ref: string; type: string; status: string; amount: number; basis: number | null; rate: number | null; currency: string; property: string | null;
      description: string | null; earnedAt: string; eligibleAt: string | null; paidAt: string | null; reversalReason: string | null;
    }>;
  };
  withdrawals: Array<{
    reference: string; status: string; lane: string | null; requested: number | null; approved: number | null; deduction: number | null; withholdingTax: number | null;
    netPaid: number | null; currency: string; destination: string; requestedAt: string; approvedAt: string | null; paidAt: string | null; rejectedAt: string | null;
    rejectionReason: string | null; paymentReference: string | null;
  }>;
  visits: Array<{
    lead: { ref: string; propertyName: string } | null; status: string; metWith: string; note: string | null; capturedAt: string; distanceMeters: number | null;
    accuracyMeters: number | null; flags: Array<{ code?: string; message?: string } | string>; reviewedAt: string | null; reviewNote: string | null;
  }>;
  history: Array<{ action: string; by: string; reason: string | null; at: string }>;
};

export type FileSection = "leads" | "properties" | "earnings" | "withdrawals" | "visits" | "history";

/** Loads the file once per partner, refreshed when the record reloads. */
export function usePartnerFile(partnerId: number | null, reloadKey: unknown) {
  const [data, setData] = useState<PartnerFileData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!partnerId) return;
    setError("");
    try {
      const res = await apiClient.get(`/api/admin/sales/partners/${partnerId}/file`);
      setData(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load the partner file.");
    }
  }, [partnerId]);
  useEffect(() => {
    setData(null);
  }, [partnerId]);
  useEffect(() => {
    void load();
  }, [load, reloadKey]);
  return { data, error };
}

const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-neutral-500";
const td = "px-3 py-2.5 align-top text-[13px] text-neutral-700";
const humanize = (v: string | null | undefined) => {
  const t = String(v || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "-";
};
const day = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "-";
const dayTime = (v: string | null | undefined) =>
  v ? `${new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "-";
const money = (v: number | null | undefined, c = "TZS") => (v == null ? "-" : `${c === "TZS" ? "TSh" : c} ${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800", CONVERTED: "bg-emerald-50 text-emerald-800", PAID: "bg-emerald-50 text-emerald-800", AVAILABLE: "bg-emerald-50 text-emerald-800", VERIFIED: "bg-emerald-50 text-emerald-800",
  PENDING: "bg-amber-50 text-amber-800", VALIDATING: "bg-amber-50 text-amber-800", ELIGIBLE: "bg-amber-50 text-amber-800", UNDER_REVIEW: "bg-amber-50 text-amber-800", REQUESTED: "bg-amber-50 text-amber-800", FLAGGED: "bg-amber-50 text-amber-800",
  REVERSED: "bg-rose-50 text-rose-700", REJECTED: "bg-rose-50 text-rose-700", DISPUTED: "bg-rose-50 text-rose-700", LOST: "bg-rose-50 text-rose-700", FAILED: "bg-rose-50 text-rose-700", REVOKED: "bg-rose-50 text-rose-700",
};
const Pill = ({ value }: { value: string }) => (
  <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold ${TONE[String(value).toUpperCase()] || "bg-neutral-100 text-neutral-600"}`}>{humanize(value)}</span>
);
const Empty = ({ text }: { text: string }) => <p className="m-0 px-4 py-8 text-center text-sm text-neutral-500">{text}</p>;

/** Where the partner stands, so an empty section can say why it is empty. */
export type FileContext = { status: string; liveAgreement: boolean; joinedAt: string | null };

type Tile = { label: string; value: string | number; sub?: string; tone?: "warn" | "bad" | "good"; onClick?: () => void; active?: boolean };

/** One row of figures at the top of a section. Tiles with onClick filter the list below. */
function StatStrip({ tiles }: { tiles: Tile[] }) {
  const tone = (t?: Tile["tone"]) => (t === "bad" ? "text-rose-700" : t === "warn" ? "text-amber-700" : t === "good" ? "text-emerald-700" : "text-neutral-900");
  return (
    <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 lg:grid-cols-4">
      {tiles.map((t) => {
        const body = (
          <>
            <p className="m-0 text-[12px] text-neutral-500">{t.label}</p>
            <p className={`m-0 mt-0.5 text-xl font-bold tabular-nums ${tone(t.tone)}`}>{t.value}</p>
            {t.sub ? <p className="m-0 truncate text-[11px] text-neutral-500">{t.sub}</p> : null}
          </>
        );
        return t.onClick ? (
          <button key={t.label} type="button" onClick={t.onClick} aria-pressed={t.active}
            className={`border-0 px-4 py-3 text-left ${t.active ? "bg-emerald-50/60 ring-1 ring-inset ring-emerald-200" : "bg-white hover:bg-neutral-50"}`}>
            {body}
          </button>
        ) : (
          <div key={t.label} className="bg-white px-4 py-3">{body}</div>
        );
      })}
    </section>
  );
}

/** An empty section that explains itself instead of just saying "nothing". */
function ContextEmpty({ icon: Icon, title, lines }: { icon: typeof Loader2; title: string; lines: string[] }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-neutral-100 text-neutral-400"><Icon className="h-5 w-5" /></span>
      <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">{title}</p>
      {lines.map((line) => <p key={line} className="m-0 mt-1 max-w-md text-[13px] text-neutral-500">{line}</p>)}
    </div>
  );
}

/** Why a partner has no activity yet, in one line. */
function standingLine(ctx: FileContext): string {
  if (ctx.status === "PENDING") return "The partner is still pending: they cannot work until their agreement is countersigned.";
  if (ctx.status === "SUSPENDED") return "The partner is suspended, so their sales workspace is closed.";
  if (ctx.status === "TERMINATED") return "The partner is terminated.";
  if (!ctx.liveAgreement) return "There is no agreement in force, so the partner cannot work.";
  const days = ctx.joinedAt ? Math.max(0, Math.floor((Date.now() - new Date(ctx.joinedAt).getTime()) / 86_400_000)) : null;
  return days != null ? `Active for ${days} day${days === 1 ? "" : "s"} with nothing recorded here yet.` : "Active, with nothing recorded here yet.";
}

const OPEN_STAGES = ["NEW", "CONTACTED", "MEETING_SCHEDULED", "PROPOSAL_SENT", "DOCUMENTS_PENDING", "TRIAL_STARTED", "CONVERSION_REQUESTED"];
const STAGE_ORDER = [...OPEN_STAGES, "CONVERTED", "LOST", "CANCELLED"];
type LeadFilter = "ALL" | "OPEN" | "OVERDUE" | "EXPIRING" | "ATTENTION" | string;

function LeadsSection({ leads, ctx }: { leads: PartnerFileData["leads"]; ctx: FileContext }) {
  const [filter, setFilter] = useState<LeadFilter>("ALL");
  const [q, setQ] = useState("");
  const now = Date.now();
  const soon = now + 14 * 86_400_000;
  const isOpen = (l: PartnerFileData["leads"][number]) => OPEN_STAGES.includes(l.status);
  const overdue = (l: PartnerFileData["leads"][number]) => isOpen(l) && !!l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() < now;
  const expiring = (l: PartnerFileData["leads"][number]) => isOpen(l) && !!l.protectedUntil && new Date(l.protectedUntil).getTime() < soon && new Date(l.protectedUntil).getTime() > now;
  const attention = (l: PartnerFileData["leads"][number]) => l.possibleDuplicate || (!!l.conversionRequestedAt && !l.convertedAt && l.status !== "LOST");

  const open = leads.filter(isOpen);
  const converted = leads.filter((l) => l.status === "CONVERTED").length;
  const closed = leads.filter((l) => ["CONVERTED", "LOST"].includes(l.status)).length;
  const counts = {
    overdue: leads.filter(overdue).length,
    expiring: leads.filter(expiring).length,
    attention: leads.filter(attention).length,
  };
  const byStage = STAGE_ORDER.map((s) => ({ stage: s, n: leads.filter((l) => l.status === s).length })).filter((s) => s.n > 0);

  const toggle = (f: LeadFilter) => setFilter((cur) => (cur === f ? "ALL" : f));
  const needle = q.trim().toLowerCase();
  const shown = leads.filter((l) => {
    if (filter === "OPEN" && !isOpen(l)) return false;
    if (filter === "OVERDUE" && !overdue(l)) return false;
    if (filter === "EXPIRING" && !expiring(l)) return false;
    if (filter === "ATTENTION" && !attention(l)) return false;
    if (STAGE_ORDER.includes(filter) && l.status !== filter) return false;
    if (needle && !`${l.propertyName} ${l.area} ${l.contact || ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  if (!leads.length) {
    return (
      <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        <ContextEmpty
          icon={ListChecks}
          title="No property leads registered"
          lines={[standingLine(ctx), "Leads appear here as soon as the partner registers a property in their workspace, with stage, follow-ups and protection."]}
        />
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <StatStrip
        tiles={[
          { label: "Open pipeline", value: open.length, sub: `${leads.length} leads in total`, onClick: () => toggle("OPEN"), active: filter === "OPEN" },
          { label: "Converted", value: converted, sub: closed ? `${Math.round((converted / closed) * 100)}% of closed leads` : "None closed yet", tone: converted ? "good" : undefined },
          { label: "Follow-ups overdue", value: counts.overdue, sub: "Next follow-up date passed", tone: counts.overdue ? "warn" : undefined, onClick: () => toggle("OVERDUE"), active: filter === "OVERDUE" },
          { label: "Needs a decision", value: counts.attention, sub: `${counts.expiring} protection ending in 14 days`, tone: counts.attention ? "bad" : undefined, onClick: () => toggle("ATTENTION"), active: filter === "ATTENTION" },
        ]}
      />

      {counts.attention ? (
        <p className="m-0 flex flex-wrap items-center gap-2 rounded-md border border-solid border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {counts.attention} lead{counts.attention === 1 ? " is" : "s are"} waiting on NoLSAF: a conversion request or a possible duplicate.
          <Link href="/admin/sales" className="font-semibold text-amber-900 underline">Decide in Conversion review</Link>
        </p>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-neutral-100 bg-neutral-50 px-4 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="group" aria-label="Filter by stage">
            <button type="button" onClick={() => setFilter("ALL")} className={`h-7 rounded-full border border-solid px-2.5 text-[12px] font-semibold ${filter === "ALL" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>All {leads.length}</button>
            {byStage.map((s) => (
              <button key={s.stage} type="button" onClick={() => toggle(s.stage)}
                className={`h-7 rounded-full border border-solid px-2.5 text-[12px] font-semibold ${filter === s.stage ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>
                {humanize(s.stage)} {s.n}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search property, area, contact" aria-label="Search leads"
              className="h-8 w-full rounded-md border border-solid border-neutral-200 bg-white pl-8 pr-2 text-[13px] outline-none focus:border-emerald-400" />
          </div>
        </div>
        {shown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse">
              <thead className="bg-white"><tr>{["Property", "Stage", "Product", "Area", "Contact", "Activity", "Next follow-up", "Protected until", "Updated"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.ref} className="border-0 border-t border-solid border-neutral-100">
                    <td className={td}>
                      <span className="font-semibold text-neutral-900">{l.propertyName}</span>
                      {l.possibleDuplicate ? <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">Possible duplicate</span> : null}
                      {l.lostReason ? <p className="m-0 mt-0.5 text-[11px] text-neutral-500">Lost: {l.lostReason}</p> : null}
                    </td>
                    <td className={td}><Pill value={l.status} />{l.conversionRequestedAt && !l.convertedAt ? <p className="m-0 mt-0.5 text-[11px] text-amber-800">Conversion asked {day(l.conversionRequestedAt)}</p> : null}</td>
                    <td className={td}>{humanize(l.product)}</td>
                    <td className={td}>{l.area || "-"}</td>
                    <td className={td}>{l.contact || "-"}</td>
                    <td className={td}>{l.activities} notes · {l.visits} visits</td>
                    <td className={`${td} ${overdue(l) ? "font-semibold text-amber-700" : ""}`}>{day(l.nextFollowUpAt)}{overdue(l) ? <span className="block text-[11px] font-normal">Overdue</span> : null}</td>
                    <td className={`${td} ${expiring(l) ? "font-semibold text-amber-700" : ""}`}>{day(l.protectedUntil)}{expiring(l) ? <span className="block text-[11px] font-normal">Ending soon</span> : null}</td>
                    <td className={td}>{day(l.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No leads match this filter." />
        )}
      </section>
    </div>
  );
}

function Frame({ title, note, link, children }: { title: string; note?: string; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 bg-neutral-50 px-4 py-2">
        <p className="m-0 text-[12px] font-semibold text-neutral-700">{title}{note ? <span className="ml-2 font-normal text-neutral-500">{note}</span> : null}</p>
        {link ? (
          <Link href={link.href} className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-800 no-underline hover:underline">
            {link.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

/** Account facts that complete the Overview tab. */
export function PartnerAccountFacts({ data }: { data: PartnerFileData | null }) {
  if (!data) return null;
  const a = data.account;
  const rows: Array<[string, string]> = [
    ["NoLSAF account since", day(a.registeredAt)],
    ["Phone verified", a.phoneVerified ? "Yes" : "No"],
    ["Email verified", a.emailVerified ? "Yes" : "No"],
    ["Profile photo", a.hasPhoto ? "Added" : "Missing"],
    ["TRA TIN", a.taxIdNumber || "Not provided"],
    ["Payout account name", a.payoutName || "Not added"],
    ["Level last changed", day(a.levelUpdatedAt)],
    ["Leads / visits", `${data.leads.length} / ${data.visits.length}`],
  ];
  return (
    <section className="grid gap-x-6 rounded-lg border border-solid border-neutral-200 px-4 py-1 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-0 border-b border-solid border-neutral-100 py-2.5">
          <span className="text-[12px] text-neutral-500">{label}</span>
          <span className="truncate text-right text-[13px] font-semibold text-neutral-800">{value}</span>
        </div>
      ))}
    </section>
  );
}

export default function PartnerFileSection({ section, data, error, ctx }: { section: FileSection; data: PartnerFileData | null; error: string; ctx: FileContext }) {
  if (error) return <p className="m-0 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</p>;
  if (!data) return <div className="grid min-h-48 place-items-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  if (section === "leads") return <LeadsSection leads={data.leads} ctx={ctx} />;

  if (section === "visits") {
    if (!data.visits.length) {
      return (
        <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
          <ContextEmpty icon={Footprints} title="No field visits recorded" lines={[standingLine(ctx), "Each visit is captured on site with a photo and GPS, then checked against the property's location. Flagged visits come here for review."]} />
        </section>
      );
    }
    const flagged = data.visits.filter((v) => v.status === "FLAGGED" && !v.reviewedAt).length;
    const verified = data.visits.filter((v) => v.status === "VERIFIED").length;
    const distances = data.visits.map((v) => v.distanceMeters).filter((d): d is number => d != null).sort((x, y) => x - y);
    const median = distances.length ? distances[Math.floor(distances.length / 2)] : null;
    const lastVisit = data.visits[0]?.capturedAt ?? null;
    return (
      <div className="space-y-4">
      <StatStrip
        tiles={[
          { label: "Visits recorded", value: data.visits.length, sub: `Last ${day(lastVisit)}` },
          { label: "Verified on site", value: verified, sub: `${data.visits.length ? Math.round((verified / data.visits.length) * 100) : 0}% of visits`, tone: verified ? "good" : undefined },
          { label: "Flagged, waiting", value: flagged, sub: "Need an admin review", tone: flagged ? "bad" : undefined },
          { label: "Typical distance", value: median != null ? `${median} m` : "-", sub: "From the property, median" },
        ]}
      />
      <Frame title="Field visits" note={`${data.visits.length} recorded`} link={{ href: "/admin/sales", label: "Review flagged visits" }}>
        {data.visits.length ? (
          <table className="w-full min-w-[900px] border-collapse">
            <thead className="bg-white"><tr>{["When", "Property", "Result", "Met with", "Distance", "Warnings", "Review"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.visits.map((v, i) => (
                <tr key={`${v.capturedAt}-${i}`} className="border-0 border-t border-solid border-neutral-100">
                  <td className={td}>{dayTime(v.capturedAt)}</td>
                  <td className={td}>{v.lead?.propertyName || "-"}{v.note ? <p className="m-0 mt-0.5 text-[11px] text-neutral-500">{v.note}</p> : null}</td>
                  <td className={td}><Pill value={v.status} /></td>
                  <td className={td}>{humanize(v.metWith)}</td>
                  <td className={td}>{v.distanceMeters != null ? `${v.distanceMeters} m` : "-"}{v.accuracyMeters != null ? <span className="text-[11px] text-neutral-500"> (±{v.accuracyMeters} m)</span> : null}</td>
                  <td className={td}>{v.flags.length ? v.flags.map((f) => (typeof f === "string" ? humanize(f) : f.message || humanize(f.code))).join(", ") : "-"}</td>
                  <td className={td}>{v.reviewedAt ? `${day(v.reviewedAt)}${v.reviewNote ? `: ${v.reviewNote}` : ""}` : v.status === "FLAGGED" ? "Waiting" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="No field visits recorded." />}
      </Frame>
      </div>
    );
  }

  if (section === "properties") {
    if (!data.properties.length) {
      return (
        <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
          <ContextEmpty icon={Building2} title="No properties attributed" lines={[standingLine(ctx), "A property is attributed when NoLSAF converts one of the partner's leads; from then on it earns them NRMS and marketplace commission."]} />
        </section>
      );
    }
    const active = data.properties.filter((p) => p.status === "ACTIVE").length;
    const pending = data.properties.filter((p) => p.status === "PENDING").length;
    const disputed = data.properties.filter((p) => p.status === "DISPUTED").length;
    const earnedAll = data.properties.reduce((s, p) => s + p.earned, 0);
    const top = [...data.properties].sort((x, y) => y.earned - x.earned)[0];
    return (
      <div className="space-y-4">
      <StatStrip
        tiles={[
          { label: "Earning now", value: active, sub: `${data.properties.length} attributions in total`, tone: active ? "good" : undefined },
          { label: "Waiting to start", value: pending, sub: "Not yet verified" },
          { label: "Disputed", value: disputed, sub: "Owner said no", tone: disputed ? "bad" : undefined },
          { label: "Earned from properties", value: money(earnedAll), sub: top && top.earned ? `Best: ${top.title}` : "Lifetime" },
        ]}
      />
      <Frame title="Attributed properties" note={`${data.properties.length} on file`} link={{ href: "/admin/sales", label: "Conversion review" }}>
        {data.properties.length ? (
          <table className="w-full min-w-[1000px] border-collapse">
            <thead className="bg-white"><tr>{["Property", "Product", "Attribution", "Listing", "Attributed", "Earning window", "Earned"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.properties.map((p) => (
                <tr key={`${p.ref}-${p.product}`} className="border-0 border-t border-solid border-neutral-100">
                  <td className={td}><span className="font-semibold text-neutral-900">{p.title}</span><p className="m-0 mt-0.5 text-[11px] text-neutral-500">{p.area || "-"}</p></td>
                  <td className={td}>{humanize(p.product)}</td>
                  <td className={td}><Pill value={p.status} />{p.disputeReason ? <p className="m-0 mt-0.5 text-[11px] text-rose-700">{p.disputeReason}</p> : null}</td>
                  <td className={td}>{humanize(p.listingStatus)}</td>
                  <td className={td}>{day(p.attributedAt)}{p.verifiedAt ? <p className="m-0 mt-0.5 text-[11px] text-neutral-500">Verified {day(p.verifiedAt)}</p> : null}</td>
                  <td className={td}>{p.earningFrom ? `${day(p.earningFrom)} to ${p.earningUntil ? day(p.earningUntil) : "open"}` : "Not started"}</td>
                  <td className={`${td} font-semibold tabular-nums`}>{money(p.earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="No properties attributed yet." />}
      </Frame>
      </div>
    );
  }

  if (section === "earnings") {
    const byType = new Map<string, { live: number; reversed: number; paid: number; count: number }>();
    for (const t of data.earnings.totals) {
      const e = byType.get(t.type) ?? { live: 0, reversed: 0, paid: 0, count: 0 };
      if (["REVERSED", "CANCELLED"].includes(t.status)) e.reversed += t.amount;
      else e.live += t.amount;
      if (t.status === "PAID") e.paid += t.amount;
      e.count += t.count;
      byType.set(t.type, e);
    }
    return (
      <div className="space-y-4">
        <section className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-2 xl:grid-cols-4">
          {[...byType.entries()].map(([type, e]) => (
            <div key={type} className="bg-white px-4 py-3">
              <p className="m-0 text-[12px] text-neutral-500">{humanize(type)}</p>
              <p className="m-0 mt-0.5 text-lg font-bold tabular-nums text-neutral-900">{money(e.live)}</p>
              <p className="m-0 text-[11px] text-neutral-500">{e.count} entries · paid {money(e.paid)}{e.reversed ? ` · reversed ${money(e.reversed)}` : ""}</p>
            </div>
          ))}
          {!byType.size ? <div className="bg-white px-4 py-3 text-sm text-neutral-500">No commission yet.</div> : null}
        </section>
        <Frame title="Commission ledger" note={`latest ${data.earnings.rows.length}`} link={{ href: "/admin/sales/finance", label: "Finance" }}>
          {data.earnings.rows.length ? (
            <table className="w-full min-w-[1000px] border-collapse">
              <thead className="bg-white"><tr>{["Earned", "Stream", "Property", "Basis", "Rate", "Commission", "Status", "Eligible / paid"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.earnings.rows.map((r) => (
                  <tr key={r.ref} className="border-0 border-t border-solid border-neutral-100">
                    <td className={td}>{day(r.earnedAt)}</td>
                    <td className={td}>{humanize(r.type)}</td>
                    <td className={td}>{r.property || r.description || "-"}</td>
                    <td className={`${td} tabular-nums`}>{money(r.basis, r.currency)}</td>
                    <td className={`${td} tabular-nums`}>{r.rate != null ? `${r.rate}%` : "-"}</td>
                    <td className={`${td} font-semibold tabular-nums`}>{money(r.amount, r.currency)}</td>
                    <td className={td}><Pill value={r.status} />{r.reversalReason ? <p className="m-0 mt-0.5 text-[11px] text-rose-700">{r.reversalReason}</p> : null}</td>
                    <td className={td}>{r.paidAt ? `Paid ${day(r.paidAt)}` : r.eligibleAt ? `From ${day(r.eligibleAt)}` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty text="No commission entries yet." />}
        </Frame>
      </div>
    );
  }

  if (section === "withdrawals") {
    if (!data.withdrawals.length) {
      return (
        <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
          <ContextEmpty icon={Send} title="No withdrawals requested" lines={[standingLine(ctx), "The partner can withdraw available commission with a code sent to their phone. Requests that need a person go to Finance."]} />
        </section>
      );
    }
    const paidRows = data.withdrawals.filter((w) => w.status === "PAID");
    const inFlight = data.withdrawals.filter((w) => ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING"].includes(w.status));
    const rejected = data.withdrawals.filter((w) => ["REJECTED", "FAILED"].includes(w.status)).length;
    type Row = PartnerFileData["withdrawals"][number];
    const sum = (rows: Row[], pick: (w: Row) => number | null) => rows.reduce((s, w) => s + (pick(w) || 0), 0);
    return (
      <div className="space-y-4">
      <StatStrip
        tiles={[
          { label: "Paid out", value: money(sum(paidRows, (w) => w.netPaid)), sub: `${paidRows.length} payment${paidRows.length === 1 ? "" : "s"}`, tone: paidRows.length ? "good" : undefined },
          { label: "In progress", value: money(sum(inFlight, (w) => w.requested)), sub: `${inFlight.length} request${inFlight.length === 1 ? "" : "s"}`, tone: inFlight.length ? "warn" : undefined },
          { label: "Tax withheld", value: money(sum(paidRows, (w) => w.withholdingTax)), sub: "Remitted to TRA" },
          { label: "Rejected or failed", value: rejected, sub: "Released back to available", tone: rejected ? "bad" : undefined },
        ]}
      />
      <Frame title="Withdrawals" note={`${data.withdrawals.length} on file`} link={{ href: "/admin/sales/finance", label: "Finance" }}>
        {data.withdrawals.length ? (
          <table className="w-full min-w-[1100px] border-collapse">
            <thead className="bg-white"><tr>{["Reference", "Requested", "Status", "Amount asked", "Approved", "Tax withheld", "Net paid", "Destination", "Paid / rejected"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.withdrawals.map((w) => (
                <tr key={w.reference} className="border-0 border-t border-solid border-neutral-100">
                  <td className={`${td} font-mono text-[12px]`}>{w.reference}</td>
                  <td className={td}>{day(w.requestedAt)}</td>
                  <td className={td}><Pill value={w.status} />{w.lane ? <p className="m-0 mt-0.5 text-[11px] text-neutral-500">{humanize(w.lane)} lane</p> : null}</td>
                  <td className={`${td} tabular-nums`}>{money(w.requested, w.currency)}</td>
                  <td className={`${td} tabular-nums`}>{money(w.approved, w.currency)}{w.deduction ? <p className="m-0 mt-0.5 text-[11px] text-neutral-500">less {money(w.deduction, w.currency)}</p> : null}</td>
                  <td className={`${td} tabular-nums`}>{money(w.withholdingTax, w.currency)}</td>
                  <td className={`${td} font-semibold tabular-nums`}>{money(w.netPaid, w.currency)}</td>
                  <td className={td}>{w.destination}</td>
                  <td className={td}>
                    {w.paidAt ? `Paid ${day(w.paidAt)}${w.paymentReference ? ` · ${w.paymentReference}` : ""}` : w.rejectedAt ? `Rejected ${day(w.rejectedAt)}` : "-"}
                    {w.rejectionReason ? <p className="m-0 mt-0.5 text-[11px] text-rose-700">{w.rejectionReason}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="No withdrawals yet." />}
      </Frame>
      </div>
    );
  }

  return (
    <Frame title="History" note="every recorded action on this partner, newest first">
      {data.history.length ? (
        <table className="w-full min-w-[760px] border-collapse">
          <thead className="bg-white"><tr>{["When", "What", "By", "Reason"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {data.history.map((h, i) => (
              <tr key={`${h.at}-${i}`} className="border-0 border-t border-solid border-neutral-100">
                <td className={td}>{dayTime(h.at)}</td>
                <td className={td}>{humanize(h.action.replace(/^SALES_/, ""))}</td>
                <td className={td}>{h.by}</td>
                <td className={td}>{h.reason || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty text="Nothing recorded yet." />}
    </Frame>
  );
}
