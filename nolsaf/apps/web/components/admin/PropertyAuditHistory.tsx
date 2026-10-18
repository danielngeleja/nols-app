"use client";

// Property activity as review rounds. A round is every edit made since the previous
// decision, closed by the admin decision that ended it (approve, reject, suspend,
// restore). Edits after the last decision form the open round on top, which is what
// an admin re-reviewing the listing needs first: what changed, by whom, and whether a
// decision is waiting. Each round's edits merge into one before → after list.

import { useMemo, useState } from "react";
import { ChevronDown, FileText, MapPin, Pencil, ShieldCheck, ShieldX } from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";
import type { AuditHistoryItem } from "@/lib/types/property";

type FieldChange = { field: string; from: unknown; to: unknown };
type Round = {
  n: number;
  edits: AuditHistoryItem[];
  decision: AuditHistoryItem | null;
  startedAt: string | null;
  merged: Array<FieldChange & { by: string }>;
  pinMoves: number;
  emptySaves: number;
  editors: string[];
};

const DECISIONS = new Set(["PROPERTY_APPROVE", "PROPERTY_REJECT", "PROPERTY_SUSPEND", "PROPERTY_UNSUSPEND"]);
const DECISION_META: Record<string, { label: string; tone: string; dot: string; icon: typeof ShieldCheck }> = {
  PROPERTY_APPROVE: { label: "Approved", tone: "text-emerald-700", dot: "bg-emerald-500", icon: ShieldCheck },
  PROPERTY_UNSUSPEND: { label: "Restored", tone: "text-emerald-700", dot: "bg-emerald-500", icon: ShieldCheck },
  PROPERTY_REJECT: { label: "Returned to owner", tone: "text-rose-700", dot: "bg-rose-500", icon: ShieldX },
  PROPERTY_SUSPEND: { label: "Suspended", tone: "text-rose-700", dot: "bg-rose-500", icon: ShieldX },
};
const EDIT_LABELS: Record<string, string> = {
  PROPERTY_UPDATE: "Edited",
  PROPERTY_COORDINATES_UPDATE: "Map pin moved",
  PROPERTY_IMAGE_MODERATE: "Photos reviewed",
};

const humanize = (v: string) => String(v || "").toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const eatDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "");
const eatDateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";

function show(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? `${value.length} ${value.length === 1 ? "item" : "items"}` : "None";
  try { return JSON.stringify(value); } catch { return "Changed"; }
}

function fieldsOf(e: AuditHistoryItem): FieldChange[] {
  return Array.isArray(e.changes) ? e.changes.filter((c: any) => c && typeof c.field === "string" && c.field !== "Status") : [];
}

function actorOf(e: AuditHistoryItem) {
  const name = e.actor?.name || e.actor?.email || (e.actorId ? "An admin" : "Unknown");
  const role = String(e.actorRole || "").toUpperCase();
  return { name, role: role === "OWNER" ? "Owner" : role ? humanize(role) : "Admin" };
}

function statusPill(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED") return "bg-emerald-50 text-emerald-700";
  if (s === "REJECTED" || s === "SUSPENDED") return "bg-rose-50 text-rose-700";
  if (s === "PENDING" || s === "NEEDS_FIXES") return "bg-amber-50 text-amber-700";
  return "bg-neutral-100 text-neutral-600";
}

function buildRounds(events: AuditHistoryItem[]): Round[] {
  const asc = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const rounds: Round[] = [];
  let edits: AuditHistoryItem[] = [];
  const close = (decision: AuditHistoryItem | null) => {
    if (!decision && edits.length === 0) return;
    const merged = new Map<string, FieldChange & { by: string }>();
    for (const e of edits) {
      for (const f of fieldsOf(e)) {
        const prev = merged.get(f.field);
        merged.set(f.field, { field: f.field, from: prev ? prev.from : f.from, to: f.to, by: actorOf(e).name });
      }
    }
    rounds.push({
      n: rounds.length + 1,
      edits,
      decision,
      startedAt: edits[0]?.createdAt ?? decision?.createdAt ?? null,
      merged: [...merged.values()].filter((f) => show(f.from) !== show(f.to)),
      pinMoves: edits.filter((e) => e.action === "PROPERTY_COORDINATES_UPDATE").length,
      emptySaves: edits.filter((e) => e.action !== "PROPERTY_COORDINATES_UPDATE" && fieldsOf(e).length === 0).length,
      editors: [...new Set(edits.map((e) => actorOf(e).name))],
    });
    edits = [];
  };
  for (const e of asc) {
    if (DECISIONS.has(e.action)) close(e);
    else edits.push(e);
  }
  close(null); // edits after the last decision: the open round
  return rounds.reverse();
}

function FieldDiff({ fields }: { fields: Array<FieldChange & { by?: string }> }) {
  return (
    <dl className="m-0">
      {fields.map((f) => (
        <div key={f.field} className="grid gap-1 border-0 border-t border-solid border-neutral-100 px-4 py-2 text-xs first:border-t-0 sm:grid-cols-[150px_minmax(0,1fr)]">
          <dt className="font-semibold text-neutral-800">{f.field}</dt>
          <dd className="m-0 min-w-0 break-words text-neutral-600">
            <span className="text-neutral-400 line-through decoration-neutral-300">{show(f.from)}</span>
            <span className="px-1.5 text-neutral-400" aria-hidden>→</span>
            <span className="font-medium text-neutral-900">{show(f.to)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function PropertyAuditHistory({
  events,
  loading,
  currentStatus,
}: {
  events: AuditHistoryItem[];
  loading: boolean;
  currentStatus: string;
}) {
  const rounds = useMemo(() => buildRounds(events), [events]);
  const [openRound, setOpenRound] = useState<number | null>(null);
  const [showLog, setShowLog] = useState<number | null>(null);

  const status = String(currentStatus || "").toUpperCase();
  const waiting = status === "PENDING" || status === "NEEDS_FIXES";
  const open = rounds[0] && !rounds[0].decision ? rounds[0] : null;
  const closed = open ? rounds.slice(1) : rounds;

  // What the open round means, in one line.
  const openHeadline = !open
    ? null
    : waiting
      ? "Waiting for your decision"
      : status === "APPROVED"
        ? "Edited after approval, still live"
        : `Edited while ${humanize(status).toLowerCase()}`;

  const EditLog = ({ round }: { round: Round }) => (
    <ul className="m-0 list-none border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-2">
      {[...round.edits].reverse().map((e, i) => {
        const who = actorOf(e);
        const fields = fieldsOf(e);
        const Icon = e.action === "PROPERTY_COORDINATES_UPDATE" ? MapPin : Pencil;
        const before = typeof e.beforeJson?.status === "string" ? e.beforeJson.status : null;
        const after = typeof e.afterJson?.status === "string" ? e.afterJson.status : null;
        return (
          <li key={String(e.id ?? i)} className="flex items-start gap-2.5 py-1.5 text-[11px]">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
            <span className="min-w-0">
              <span className="font-semibold text-neutral-800">{EDIT_LABELS[e.action] || humanize(e.action)}</span>
              <span className="text-neutral-500"> · {who.name} ({who.role}) · {eatDateTime(e.createdAt)}</span>
              {before && after && before !== after ? <span className="text-amber-700"> · {humanize(before)} → {humanize(after)}</span> : null}
              <span className="block text-neutral-400">{fields.length ? fields.map((f) => f.field).join(", ") : e.action === "PROPERTY_COORDINATES_UPDATE" ? "Location coordinates" : "No field change"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );

  const roundSummary = (r: Round) =>
    [
      r.merged.length ? `${r.merged.length} ${r.merged.length === 1 ? "field" : "fields"} changed` : null,
      r.pinMoves ? (r.pinMoves === 1 ? "pin moved" : `pin moved ${r.pinMoves} times`) : null,
      r.n === 1 && r.edits.length === 0 ? "first submission" : null,
      r.edits.length && !r.merged.length && !r.pinMoves ? `${r.edits.length} ${r.edits.length === 1 ? "save" : "saves"}, no field change` : null,
    ].filter(Boolean).join(" · ") || "No edits before this decision";

  return (
    <section aria-labelledby="property-activity-heading" className="mx-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Property record</p>
          <h2 id="property-activity-heading" className="m-0 mt-0.5 text-lg font-bold tracking-tight text-neutral-950">Review history</h2>
        </div>
        <p className="m-0 flex items-center gap-2 text-[11px] text-neutral-500">
          {rounds.length ? <span>{rounds.length} {rounds.length === 1 ? "round" : "rounds"}</span> : null}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusPill(status)}`}>Now {humanize(status || "unknown").toLowerCase()}</span>
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-14 text-sm text-neutral-500"><LogoSpinner size="sm" ariaLabel="Loading activity" /> Loading history</div>
      ) : rounds.length === 0 ? (
        <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
          <FileText className="mx-auto h-8 w-8 text-neutral-300" aria-hidden />
          <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No history yet</p>
          <p className="m-0 mt-1 text-xs text-neutral-500">Reviews and edits will appear here as rounds.</p>
        </div>
      ) : (
        <div className="px-5 pb-5 sm:px-6">
          {/* Open round: edits since the last decision */}
          {open ? (
            <div className={`overflow-hidden rounded-xl border-2 border-solid ${waiting ? "border-amber-300" : "border-neutral-200"} bg-white`}>
              <div className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${waiting ? "bg-amber-50/70" : "bg-neutral-50"}`}>
                <div className="min-w-0">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    Round {open.n}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] normal-case tracking-normal ${waiting ? "bg-amber-400 text-amber-950" : "bg-neutral-200 text-neutral-700"}`}>Open since {eatDate(open.startedAt)}</span>
                  </p>
                  <p className={`m-0 mt-1 text-sm font-bold ${waiting ? "text-amber-950" : "text-neutral-900"}`}>{openHeadline}</p>
                  <p className="m-0 mt-0.5 text-xs text-neutral-600">
                    {open.editors.length ? `${open.editors.join(", ")}: ` : ""}{roundSummary(open)}
                  </p>
                </div>
                <button type="button" onClick={() => setShowLog(showLog === open.n ? null : open.n)} className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] font-semibold text-neutral-500 hover:text-neutral-900">
                  {showLog === open.n ? "Hide each edit" : `Each edit (${open.edits.length})`}
                </button>
              </div>
              {open.merged.length ? <FieldDiff fields={open.merged} /> : (
                <p className="m-0 border-0 border-t border-solid border-neutral-100 px-4 py-3 text-xs text-neutral-500">
                  {open.pinMoves ? "Only the map pin moved." : "Saved without changing any field."}
                </p>
              )}
              {showLog === open.n ? <EditLog round={open} /> : null}
            </div>
          ) : (
            <p className="m-0 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span><span className="font-semibold">No edits since the last decision.</span> The listing is exactly as it was {DECISION_META[closed[0]?.decision?.action || ""]?.label.toLowerCase() || "decided"}.</span>
            </p>
          )}

          {/* Closed rounds: a timeline of decisions */}
          {closed.length ? (
            <ol className="relative m-0 mt-5 list-none p-0 pl-6">
              <span className="absolute bottom-3 left-[7px] top-2 w-px bg-neutral-200" aria-hidden />
              {closed.map((r) => {
                const meta = DECISION_META[r.decision?.action || ""] ?? { label: "Decision", tone: "text-neutral-700", dot: "bg-neutral-400", icon: ShieldCheck };
                const who = r.decision ? actorOf(r.decision) : null;
                const reason = r.decision?.afterJson?.reason;
                const expanded = openRound === r.n;
                return (
                  <li key={r.n} className="relative pb-4 last:pb-0">
                    <span className={`absolute -left-6 top-1 h-3.5 w-3.5 rounded-full ring-4 ring-white ${meta.dot}`} aria-hidden />
                    <button
                      type="button"
                      onClick={() => setOpenRound(expanded ? null : r.n)}
                      aria-expanded={expanded}
                      className="flex w-full cursor-pointer items-start justify-between gap-3 border-0 bg-transparent p-0 text-left"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-x-2 text-sm">
                          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-400">Round {r.n}</span>
                          <span className={`font-bold ${meta.tone}`}>{meta.label}</span>
                          <span className="text-xs text-neutral-500">{eatDate(r.decision?.createdAt)}{who ? ` by ${who.name}` : ""}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-neutral-500">{roundSummary(r)}</span>
                        {reason ? <span className="mt-1 block text-xs text-neutral-800">“{show(reason)}”</span> : null}
                      </span>
                      {r.merged.length || r.edits.length ? <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-neutral-400 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden /> : null}
                    </button>
                    {expanded && (r.merged.length || r.edits.length) ? (
                      <div className="mt-2 overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                        {r.merged.length ? <FieldDiff fields={r.merged} /> : null}
                        {r.edits.length ? <EditLog round={r} /> : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      )}
    </section>
  );
}
