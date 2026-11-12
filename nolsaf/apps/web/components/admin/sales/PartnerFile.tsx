"use client";

/**
 * Admin: the partner's whole file, opened inside the partner record. Read only:
 * leads, field visits, attributed properties, the commission ledger,
 * withdrawals and the history of every action on the partner. Decisions stay in
 * the sections that own them (Conversion review, Finance), linked from here.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Building2, ChevronsUpDown, Footprints, ListChecks, Loader2, Search, Send } from "lucide-react";
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
          <LeadTable leads={shown} overdue={overdue} expiring={expiring} />
        ) : (
          <Empty text="No leads match this filter." />
        )}
      </section>
    </div>
  );
}

type Lead = PartnerFileData["leads"][number];
type LeadSortKey = "property" | "stage" | "activity" | "followUp" | "protection" | "updated";

/** "UBUNGO, DAR-ES-SALAAM" -> "Ubungo, Dar es Salaam". Mixed-case text is left alone. */
function readable(value: string | null | undefined): string {
  const v = String(value || "").trim();
  if (!v || v !== v.toUpperCase() || !/[A-Z]/.test(v)) return v;
  const small = new Set(["es", "wa", "ya", "na", "la", "of", "and"]);
  return v
    .toLowerCase()
    .replace(/-/g, " ")
    .split(/(\s+|,\s*)/)
    .map((part, i) => (/^\s|,/.test(part) || (i > 0 && small.has(part)) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/** "in 3 days", "2 days overdue", "today". */
function relative(v: string | null | undefined): string | null {
  if (!v) return null;
  const days = Math.round((new Date(v).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

/** "Overdue today", "1 day overdue", "4 days overdue". */
function overdueText(v: string): string {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(v).setHours(0, 0, 0, 0)) / 86_400_000);
  return days <= 0 ? "Overdue today" : `${days} day${days === 1 ? "" : "s"} overdue`;
}

const STAGE_TONE: Record<string, { dot: string; pill: string }> = {
  NEW: { dot: "bg-sky-500", pill: "bg-sky-50 text-sky-800 ring-sky-200" },
  CONTACTED: { dot: "bg-indigo-500", pill: "bg-indigo-50 text-indigo-800 ring-indigo-200" },
  MEETING_SCHEDULED: { dot: "bg-indigo-500", pill: "bg-indigo-50 text-indigo-800 ring-indigo-200" },
  PROPOSAL_SENT: { dot: "bg-violet-500", pill: "bg-violet-50 text-violet-800 ring-violet-200" },
  DOCUMENTS_PENDING: { dot: "bg-violet-500", pill: "bg-violet-50 text-violet-800 ring-violet-200" },
  TRIAL_STARTED: { dot: "bg-teal-500", pill: "bg-teal-50 text-teal-800 ring-teal-200" },
  CONVERSION_REQUESTED: { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-800 ring-amber-200" },
  CONVERTED: { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  LOST: { dot: "bg-rose-500", pill: "bg-rose-50 text-rose-700 ring-rose-200" },
  CANCELLED: { dot: "bg-neutral-400", pill: "bg-neutral-100 text-neutral-600 ring-neutral-200" },
};

function StagePill({ value }: { value: string }) {
  const t = STAGE_TONE[String(value).toUpperCase()] || STAGE_TONE.CANCELLED;
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${t.pill}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} aria-hidden />
      <span className="truncate">{humanize(value)}</span>
    </span>
  );
}

function LeadTable({ leads, overdue, expiring }: { leads: Lead[]; overdue: (l: Lead) => boolean; expiring: (l: Lead) => boolean }) {
  const [sort, setSort] = useState<{ key: LeadSortKey; dir: "asc" | "desc" }>({ key: "updated", dir: "desc" });

  const time = (v: string | null | undefined) => (v ? new Date(v).getTime() : null);
  const value = (l: Lead, key: LeadSortKey): string | number | null => {
    switch (key) {
      case "property": return l.propertyName.toLowerCase();
      case "stage": { const i = STAGE_ORDER.indexOf(l.status); return i < 0 ? 99 : i; }
      case "activity": return l.activities + l.visits;
      case "followUp": return time(l.nextFollowUpAt);
      case "protection": return time(l.protectedUntil);
      default: return time(l.updatedAt);
    }
  };
  const rows = [...leads].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // empty dates always last
    if (y == null) return -1;
    const c = x < y ? -1 : x > y ? 1 : 0;
    return sort.dir === "asc" ? c : -c;
  });
  const by = (key: LeadSortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "updated" || key === "activity" ? "desc" : "asc" }));

  const Head = ({ k, label, className = "" }: { k: LeadSortKey; label: string; className?: string }) => {
    const active = sort.key === k;
    const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={`${th} ${className}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => by(k)}
          className={`group inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 text-[11px] font-semibold ${active ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}>
          {label}
          <Icon className={`h-3 w-3 ${active ? "text-emerald-700" : "text-neutral-300 group-hover:text-neutral-500"}`} aria-hidden />
        </button>
      </th>
    );
  };

  const contactParts = (c: string | null) => {
    const [name, phone] = String(c || "").split(" · ");
    const looksPhone = (s: string) => /^\+?[\d\s-]{7,}$/.test(s.trim());
    if (!phone && looksPhone(name || "")) return { name: null, phone: name.trim() };
    return { name: name ? readable(name) : null, phone: phone ? phone.trim() : null };
  };

  const FollowUp = ({ l }: { l: Lead }) => {
    if (!l.nextFollowUpAt) return <span className="text-neutral-400">Not set</span>;
    const late = overdue(l);
    return (
      <span className={late ? "font-semibold text-amber-700" : "text-neutral-800"}>
        {late ? overdueText(l.nextFollowUpAt) : relative(l.nextFollowUpAt)}
        <span className="block text-[11px] font-normal text-neutral-500">{day(l.nextFollowUpAt)}</span>
      </span>
    );
  };

  const Protection = ({ l }: { l: Lead }) => {
    if (!l.protectedUntil) return <span className="text-neutral-400">-</span>;
    const ending = expiring(l);
    const lapsed = new Date(l.protectedUntil).getTime() < Date.now();
    return (
      <span className={ending ? "font-semibold text-amber-700" : lapsed ? "text-rose-700" : "text-neutral-800"}>
        {day(l.protectedUntil)}
        <span className="block text-[11px] font-normal text-neutral-500">{lapsed ? "Lapsed" : ending ? "Ending soon" : relative(l.protectedUntil)}</span>
      </span>
    );
  };

  return (
    <>
      {/* Wide screens: fixed columns, nothing scrolls sideways */}
      <table className="hidden w-full table-fixed border-collapse lg:table">
        <colgroup>
          <col className="w-[27%]" /><col className="w-[15%]" /><col className="w-[19%]" /><col className="w-[9%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[9%]" />
        </colgroup>
        <thead className="border-0 border-b border-solid border-neutral-200 bg-white">
          <tr>
            <Head k="property" label="Property" className="pl-4" />
            <Head k="stage" label="Stage" />
            <th className={th}>Contact</th>
            <Head k="activity" label="Activity" />
            <Head k="followUp" label="Next follow-up" />
            <Head k="protection" label="Protected until" />
            <Head k="updated" label="Updated" className="pr-4" />
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const c = contactParts(l.contact);
            return (
              <tr key={l.ref} className="border-0 border-t border-solid border-neutral-100 transition-colors first:border-t-0 hover:bg-emerald-50/40">
                <td className={`${td} pl-4`}>
                  <span className="block truncate font-semibold text-neutral-900" title={readable(l.propertyName)}>{readable(l.propertyName)}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500">
                    <span className="truncate" title={readable(l.area)}>{readable(l.area) || "No area"}</span>
                    <span className="shrink-0 rounded bg-neutral-100 px-1 py-px text-[10px] font-semibold text-neutral-600">{humanize(l.product)}</span>
                  </span>
                  {l.possibleDuplicate ? <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Possible duplicate</span> : null}
                  {l.lostReason ? <span className="mt-1 block truncate text-[11px] text-rose-700" title={l.lostReason}>Lost: {l.lostReason}</span> : null}
                </td>
                <td className={td}>
                  <StagePill value={l.status} />
                  {l.conversionRequestedAt && !l.convertedAt ? <span className="mt-1 block text-[11px] text-amber-800">Asked {day(l.conversionRequestedAt)}</span> : null}
                </td>
                <td className={td}>
                  {c.name ? <span className="block truncate text-neutral-900" title={c.name}>{c.name}</span> : null}
                  {c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="block truncate text-[12px] tabular-nums text-emerald-800 no-underline hover:underline">{c.phone}</a> : null}
                  {!c.name && !c.phone ? <span className="text-neutral-400">-</span> : null}
                </td>
                <td className={td}>
                  <span className="flex flex-col gap-0.5 text-[12px] tabular-nums">
                    <span title="Notes logged" className={l.activities ? "text-neutral-800" : "text-neutral-400"}><ListChecks className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />{l.activities}</span>
                    <span title="Field visits" className={l.visits ? "text-neutral-800" : "text-neutral-400"}><Footprints className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />{l.visits}</span>
                  </span>
                </td>
                <td className={td}><FollowUp l={l} /></td>
                <td className={td}><Protection l={l} /></td>
                <td className={`${td} pr-4 text-neutral-600`}>
                  {relative(l.updatedAt)}
                  <span className="block text-[11px] text-neutral-400">{day(l.updatedAt)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Smaller screens: one row per lead, sorted the same way */}
      <div className="lg:hidden">
        <div className="flex items-center gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-2 text-[12px] text-neutral-500">
          Sort by
          <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(":"); setSort({ key: key as LeadSortKey, dir: dir as "asc" | "desc" }); }}
            className="h-7 rounded-md border border-solid border-neutral-200 bg-white px-2 text-[12px] text-neutral-800">
            <option value="updated:desc">Recently updated</option>
            <option value="followUp:asc">Next follow-up</option>
            <option value="protection:asc">Protection ending</option>
            <option value="stage:asc">Stage</option>
            <option value="property:asc">Property A to Z</option>
            <option value="activity:desc">Most activity</option>
          </select>
        </div>
        <ul className="m-0 list-none p-0">
          {rows.map((l) => {
            const c = contactParts(l.contact);
            return (
              <li key={l.ref} className="border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0 hover:bg-emerald-50/40">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-[13px] font-semibold text-neutral-900 [overflow-wrap:anywhere]">{readable(l.propertyName)}</span>
                  <StagePill value={l.status} />
                </div>
                <p className="m-0 mt-0.5 text-[12px] text-neutral-500 [overflow-wrap:anywhere]">{[readable(l.area), humanize(l.product), c.name, c.phone].filter(Boolean).join(" · ")}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                  <span><span className="text-neutral-500">Follow-up </span><FollowUp l={l} /></span>
                  <span className="text-neutral-500">{l.activities} notes · {l.visits} visits</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

type Attributed = PartnerFileData["properties"][number];
type PropSortKey = "property" | "product" | "status" | "attributed" | "window" | "earned";

/** A clickable column header with the sort state shown as an arrow. */
function SortHead<K extends string>({ k, label, sort, onSort, className = "", align = "left" }: {
  k: K; label: string; sort: { key: K; dir: "asc" | "desc" }; onSort: (k: K) => void; className?: string; align?: "left" | "right";
}) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`${th} ${align === "right" ? "text-right" : ""} ${className}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)}
        className={`group inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 text-[11px] font-semibold ${active ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}>
        {label}
        <Icon className={`h-3 w-3 ${active ? "text-emerald-700" : "text-neutral-300 group-hover:text-neutral-500"}`} aria-hidden />
      </button>
    </th>
  );
}

const productLabel = (v: string) => (String(v).toUpperCase() === "NRMS" ? "NRMS" : humanize(v));

const ATTR_TONE: Record<string, { dot: string; pill: string }> = {
  ACTIVE: { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  PENDING: { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-800 ring-amber-200" },
  DISPUTED: { dot: "bg-rose-500", pill: "bg-rose-50 text-rose-700 ring-rose-200" },
  REVOKED: { dot: "bg-neutral-400", pill: "bg-neutral-100 text-neutral-600 ring-neutral-200" },
  EXPIRED: { dot: "bg-neutral-400", pill: "bg-neutral-100 text-neutral-600 ring-neutral-200" },
};

function AttrPill({ value }: { value: string }) {
  const t = ATTR_TONE[String(value).toUpperCase()] || ATTR_TONE.EXPIRED;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${t.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />{humanize(value)}
    </span>
  );
}

/** How far through the earning window the property is, as a bar and a line. */
function EarningWindow({ p }: { p: Attributed }) {
  if (!p.earningFrom) return <span className="text-neutral-400">Not started</span>;
  const start = new Date(p.earningFrom).getTime();
  const end = p.earningUntil ? new Date(p.earningUntil).getTime() : null;
  const now = Date.now();
  const notYet = now < start;
  const pct = end && end > start ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)) : 0;
  const daysLeft = end ? Math.ceil((end - now) / 86_400_000) : null;
  const ended = daysLeft != null && daysLeft <= 0;
  const status = notYet ? `Starts ${day(p.earningFrom)}` : ended ? "Window ended" : daysLeft != null ? `${daysLeft} days left` : "Open ended";
  return (
    <span className="block min-w-0">
      <span className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className={`font-medium ${ended ? "text-neutral-500" : notYet ? "text-amber-700" : daysLeft != null && daysLeft <= 30 ? "text-amber-700" : "text-neutral-800"}`}>{status}</span>
      </span>
      {end ? (
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
          <span className={`block h-full rounded-full ${ended ? "bg-neutral-300" : "bg-emerald-500"}`} style={{ width: `${notYet ? 0 : pct}%` }} />
        </span>
      ) : null}
      <span className="mt-1 block truncate text-[11px] text-neutral-500">{day(p.earningFrom)} to {p.earningUntil ? day(p.earningUntil) : "open"}</span>
    </span>
  );
}

function PropertyTable({ properties }: { properties: Attributed[] }) {
  const [sort, setSort] = useState<{ key: PropSortKey; dir: "asc" | "desc" }>({ key: "attributed", dir: "desc" });
  const time = (v: string | null | undefined) => (v ? new Date(v).getTime() : null);
  const STATUS_ORDER = ["ACTIVE", "PENDING", "DISPUTED", "REVOKED", "EXPIRED"];
  const value = (p: Attributed, key: PropSortKey): string | number | null => {
    switch (key) {
      case "property": return p.title.toLowerCase();
      case "product": return productLabel(p.product);
      case "status": { const i = STATUS_ORDER.indexOf(String(p.status).toUpperCase()); return i < 0 ? 99 : i; }
      case "window": return time(p.earningUntil);
      case "earned": return p.earned;
      default: return time(p.attributedAt);
    }
  };
  const rows = [...properties].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = x < y ? -1 : x > y ? 1 : 0;
    return sort.dir === "asc" ? c : -c;
  });
  const onSort = (key: PropSortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "earned" || key === "attributed" ? "desc" : "asc" }));
  // The same property can be attributed for more than one product; mark the repeats.
  const titleCount = new Map<string, number>();
  properties.forEach((p) => titleCount.set(p.ref, (titleCount.get(p.ref) || 0) + 1));

  return (
    <>
      <table className="hidden w-full table-fixed border-collapse lg:table">
        <colgroup><col className="w-[27%]" /><col className="w-[11%]" /><col className="w-[13%]" /><col className="w-[14%]" /><col className="w-[21%]" /><col className="w-[14%]" /></colgroup>
        <thead className="border-0 border-b border-solid border-neutral-200 bg-white">
          <tr>
            <SortHead k="property" label="Property" sort={sort} onSort={onSort} className="pl-4" />
            <SortHead k="product" label="Product" sort={sort} onSort={onSort} />
            <SortHead k="status" label="Attribution" sort={sort} onSort={onSort} />
            <SortHead k="attributed" label="Attributed" sort={sort} onSort={onSort} />
            <SortHead k="window" label="Earning window" sort={sort} onSort={onSort} />
            <SortHead k="earned" label="Earned" sort={sort} onSort={onSort} align="right" className="pr-4" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.ref}-${p.product}`} className="border-0 border-t border-solid border-neutral-100 transition-colors first:border-t-0 hover:bg-emerald-50/40">
              <td className={`${td} pl-4`}>
                <span className="block truncate font-semibold text-neutral-900" title={readable(p.title)}>{readable(p.title)}</span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500">
                  <span className="truncate">{readable(p.area) || "No area"}</span>
                  {p.listingStatus ? (
                    <span className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold ${String(p.listingStatus).toUpperCase() === "APPROVED" ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100 text-neutral-600"}`}>
                      Listing {humanize(p.listingStatus).toLowerCase()}
                    </span>
                  ) : null}
                </span>
                {(titleCount.get(p.ref) || 0) > 1 ? <span className="mt-1 block text-[11px] text-neutral-400">Also attributed for another product</span> : null}
              </td>
              <td className={td}>
                <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${String(p.product).toUpperCase() === "NRMS" ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-violet-50 text-violet-800 ring-violet-200"}`}>{productLabel(p.product)}</span>
              </td>
              <td className={td}>
                <AttrPill value={p.status} />
                {p.disputeReason ? <span className="mt-1 block truncate text-[11px] text-rose-700" title={p.disputeReason}>{p.disputeReason}</span> : null}
                {p.revokedAt ? <span className="mt-1 block text-[11px] text-neutral-500">Revoked {day(p.revokedAt)}</span> : null}
              </td>
              <td className={td}>
                <span className="text-neutral-800">{day(p.attributedAt)}</span>
                <span className={`mt-0.5 block text-[11px] ${p.verifiedAt ? "text-emerald-700" : "text-amber-700"}`}>{p.verifiedAt ? `Verified ${day(p.verifiedAt)}` : "Not verified yet"}</span>
              </td>
              <td className={td}><EarningWindow p={p} /></td>
              <td className={`${td} pr-4 text-right`}>
                <span className={`font-semibold tabular-nums ${p.earned ? "text-neutral-900" : "text-neutral-400"}`}>{money(p.earned)}</span>
                {!p.earned && p.status === "ACTIVE" ? <span className="block text-[11px] text-neutral-400">No paid stays yet</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="lg:hidden">
        <div className="flex items-center gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-2 text-[12px] text-neutral-500">
          Sort by
          <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(":"); setSort({ key: key as PropSortKey, dir: dir as "asc" | "desc" }); }}
            className="h-7 rounded-md border border-solid border-neutral-200 bg-white px-2 text-[12px] text-neutral-800">
            <option value="attributed:desc">Recently attributed</option>
            <option value="earned:desc">Most earned</option>
            <option value="window:asc">Window ending soonest</option>
            <option value="status:asc">Attribution status</option>
            <option value="property:asc">Property A to Z</option>
          </select>
        </div>
        <ul className="m-0 list-none p-0">
          {rows.map((p) => (
            <li key={`${p.ref}-${p.product}`} className="border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0 hover:bg-emerald-50/40">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[13px] font-semibold text-neutral-900 [overflow-wrap:anywhere]">{readable(p.title)}</span>
                <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${p.earned ? "text-neutral-900" : "text-neutral-400"}`}>{money(p.earned)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                <AttrPill value={p.status} />
                <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-semibold text-neutral-700">{productLabel(p.product)}</span>
                <span>{readable(p.area)}</span>
              </div>
              <div className="mt-2"><EarningWindow p={p} /></div>
            </li>
          ))}
        </ul>
      </div>
    </>
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
        {data.properties.length ? <PropertyTable properties={data.properties} /> : <Empty text="No properties attributed yet." />}
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
