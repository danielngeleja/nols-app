"use client";

// The count sheet (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 3). For the
// counter: goods by category, entered in packs or loose units, saved as you
// go and queued on the phone when the store room has no signal. For the
// manager, once submitted: expected against counted, recount or approve.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, CloudOff, EyeOff, FileBarChart, Loader2, RotateCcw, Send, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../../../_components/NrmsProvider";
import { STOCK_CATEGORY_LABELS, apiError, categoryTone, formatMoney, formatStockQuantity, unitShort } from "../../../_components/stockFormat";
import { Pill, cardClass, checkboxClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";
import { formatWhen } from "../../operations/_components/shared";
import { COUNT_STATUS, SCOPE_LABELS } from "../_components/countShared";

type Pack = { id: number; name: string; baseQuantity: number };
type Line = {
  id: number;
  stockItemId: number;
  name: string;
  category: string;
  baseUnit: string;
  countStyle: string;
  packUnits: Pack[];
  countedQuantity: number | null;
  countedAt: string | null;
  countedBy: string | null;
  recountRequested: boolean;
  note: string | null;
  expectedQuantity: number | null;
  varianceQuantity: number | null;
  varianceCost: number | null;
  varianceSales: number | null;
  tolerancePercent: number;
  withinTolerance: boolean | null;
};
type CountData = {
  count: {
    id: number;
    countNumber: string;
    scope: string;
    blind: boolean;
    status: string;
    locationName: string;
    note: string | null;
    startedAt: string;
    startedBy: string | null;
    submittedAt: string | null;
    submittedBy: string | null;
    approvedAt: string | null;
    approvedBy: string | null;
    decisionNote: string | null;
    varianceCost: number | null;
    varianceSales: number | null;
  };
  canCount: boolean;
  canApprove: boolean;
  showMoney: boolean;
  lines: Line[];
};
type Draft = { amount: string; packUnitId: number | "units" };
type Pending = Record<number, { countedQuantity: number | null; countedAt: string }>;

/** How a counter naturally counts this good: bottles of spirits, kilos of meat, loose beers. */
function defaultPack(line: Line): number | "units" {
  if (line.countStyle === "PARTIAL" && line.packUnits.length) return line.packUnits[0].id;
  return "units";
}

function draftFromBase(line: Line, base: number | null, packUnitId: number | "units"): Draft {
  if (base == null) return { amount: "", packUnitId };
  const pack = line.packUnits.find((row) => row.id === packUnitId);
  const value = pack ? base / pack.baseQuantity : base;
  return { amount: String(Math.round(value * 1000) / 1000), packUnitId };
}

function baseFromDraft(line: Line, draft: Draft): number | null {
  if (draft.amount.trim() === "") return null;
  const value = Number(draft.amount);
  if (!Number.isFinite(value) || value < 0) return null;
  const pack = line.packUnits.find((row) => row.id === draft.packUnitId);
  return Math.round((pack ? value * pack.baseQuantity : value) * 1000) / 1000;
}

export default function CountSheetPage() {
  const params = useParams<{ countId: string }>();
  const countId = Number(params.countId);
  const router = useRouter();
  const { selectedProperty } = useNrms();
  const currency = selectedProperty?.currency ?? "TZS";
  const [data, setData] = useState<CountData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [pending, setPending] = useState<Pending>({});
  const [syncState, setSyncState] = useState<"idle" | "saving" | "offline">("idle");
  const [busy, setBusy] = useState(false);
  const [recountPick, setRecountPick] = useState<Set<number>>(new Set());
  const [decisionNote, setDecisionNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const queueKey = `nolsaf:nrms-count-queue:${countId}`;
  const flushTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<CountData>(`/api/nrms/stock/counts/${countId}`);
      setData(res.data);
      let queued: Pending = {};
      try { queued = JSON.parse(window.localStorage.getItem(queueKey) || "{}"); } catch { queued = {}; }
      setPending(queued);
      setDrafts(Object.fromEntries(res.data.lines.map((line) => {
        const value = queued[line.id]?.countedQuantity !== undefined ? queued[line.id].countedQuantity : line.countedQuantity;
        return [line.id, draftFromBase(line, value, defaultPack(line))];
      })));
    } catch (cause) {
      setError(apiError(cause, "Unable to load the count"));
    }
  }, [countId, queueKey]);
  useEffect(() => { void load(); }, [load]);

  const persistQueue = (next: Pending) => {
    try { window.localStorage.setItem(queueKey, JSON.stringify(next)); } catch { /* storage full or blocked: the in-memory queue still retries */ }
  };

  const flush = useCallback(async (queue: Pending) => {
    const entries = Object.entries(queue);
    if (entries.length === 0) { setSyncState("idle"); return true; }
    setSyncState("saving");
    try {
      await apiClient.patch(`/api/nrms/stock/counts/${countId}/lines`, { lines: entries.map(([lineId, value]) => ({ lineId: Number(lineId), countedQuantity: value.countedQuantity, countedAt: value.countedAt })) });
      setPending((current) => {
        const next = { ...current };
        for (const [lineId, value] of entries) if (next[Number(lineId)]?.countedAt === value.countedAt) delete next[Number(lineId)];
        persistQueue(next);
        return next;
      });
      setSyncState("idle");
      return true;
    } catch (cause: any) {
      if (!cause?.response) { setSyncState("offline"); return false; }
      setSyncState("idle");
      setError(apiError(cause, "Could not save the count"));
      return false;
    }
  }, [countId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Replay whatever the phone kept while it had no signal.
    const retry = () => { void flush(pending); };
    window.addEventListener("online", retry);
    const timer = window.setInterval(() => { if (Object.keys(pending).length) retry(); }, 20_000);
    return () => { window.removeEventListener("online", retry); window.clearInterval(timer); };
  }, [flush, pending]);

  const commit = (line: Line, draft: Draft) => {
    const base = baseFromDraft(line, draft);
    const next = { ...pending, [line.id]: { countedQuantity: base, countedAt: new Date().toISOString() } };
    setPending(next);
    persistQueue(next);
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => { void flush(next); }, 600);
  };

  const status = data?.count.status ?? "";
  const counting = Boolean(data?.canCount) && (status === "IN_PROGRESS" || status === "RECOUNT");
  const reviewing = Boolean(data?.canApprove) && status === "SUBMITTED";
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const editable = (line: Line) => counting && (status === "IN_PROGRESS" || line.recountRequested);

  const countedCount = lines.filter((line) => {
    const value = pending[line.id] !== undefined ? pending[line.id].countedQuantity : line.countedQuantity;
    return value != null;
  }).length;
  const groups = useMemo(() => {
    const map = new Map<string, Line[]>();
    for (const line of lines) map.set(line.category, [...(map.get(line.category) ?? []), line]);
    return [...map.entries()];
  }, [lines]);

  const act = async (path: string, body: object, done: string) => {
    setBusy(true);
    setError(null);
    try {
      if (path === "submit") {
        const saved = await flush(pending);
        if (!saved) throw new Error("Some counts are still waiting for signal. Submit again once the phone is back online.");
      }
      const res = await apiClient.post<{ selfApproved?: boolean }>(`/api/nrms/stock/counts/${countId}/${path}`, body);
      if (path === "submit") { try { window.localStorage.removeItem(queueKey); } catch { /* ignore */ } }
      setNotice(res.data.selfApproved ? `${done} You also counted part of it; the record shows the same person on both.` : done);
      setRecountPick(new Set());
      await load();
    } catch (cause: any) {
      setError(cause?.response ? apiError(cause, "The action failed") : cause?.message || "The action failed");
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return <div className="flex min-h-[40vh] items-center justify-center text-neutral-300">{error ? <p className="text-sm text-red-700">{error}</p> : <Loader2 className="h-6 w-6 animate-spin" />}</div>;
  }

  const state = COUNT_STATUS[status] ?? { label: status, tone: "muted" as const };
  const outside = lines.filter((line) => line.withinTolerance === false).length;
  const pendingCount = Object.keys(pending).length;

  return (
    <div className="w-full min-w-0 space-y-4 pb-28">
      <Link href="/owner/nrms/stock/counts" className="inline-flex items-center gap-1.5 text-sm font-bold text-neutral-600 no-underline hover:text-brand"><ArrowLeft className="h-4 w-4" />All counts</Link>

      <section className={`${cardClass} px-4 py-4 sm:px-6`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-neutral-950">{data.count.locationName}<span className="text-base font-semibold text-neutral-400">{data.count.countNumber}</span></h1>
            <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
              {SCOPE_LABELS[data.count.scope] ?? data.count.scope}
              {data.count.blind && <span className="inline-flex items-center gap-1"><EyeOff className="h-3.5 w-3.5" />Blind</span>}
              · started {formatWhen(data.count.startedAt)}{data.count.startedBy ? ` by ${data.count.startedBy}` : ""}
            </p>
          </div>
          <Pill tone={state.tone}>{state.label}</Pill>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-sm"><span className="font-bold text-neutral-800">{countedCount} of {lines.length} counted</span>
            {syncState === "saving" && <span className="inline-flex items-center gap-1 text-neutral-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving</span>}
            {syncState === "offline" && <span className="inline-flex items-center gap-1 font-bold text-amber-700"><CloudOff className="h-4 w-4" />No signal: {pendingCount} saved on this phone</span>}
            {syncState === "idle" && counting && pendingCount === 0 && countedCount > 0 && <span className="inline-flex items-center gap-1 text-brand"><CheckCircle2 className="h-4 w-4" />Saved</span>}
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${lines.length ? (countedCount / lines.length) * 100 : 0}%` }} /></div>
        </div>
        {status === "RECOUNT" && <p className="m-0 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">A manager asked for {lines.filter((line) => line.recountRequested).length} goods to be counted again{data.count.decisionNote ? `: ${data.count.decisionNote}` : "."}</p>}
        {data.count.blind && counting && <p className="m-0 mt-3 text-sm text-neutral-500">Count what is physically there, including open bottles. The book stays hidden until a manager reviews.</p>}
      </section>

      {notice && <div className="flex items-center gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />{notice}</div>}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {(reviewing || status === "APPROVED") ? (
        <ReviewTable lines={lines} currency={currency} showMoney={data.showMoney} reviewing={reviewing} picked={recountPick} onPick={setRecountPick} />
      ) : (
        groups.map(([category, rows]) => {
          const tone = categoryTone(category);
          return (
            <section key={category} className={`overflow-hidden rounded-2xl border border-solid bg-white shadow-card ${tone.border}`}>
              <header className={`flex items-center gap-2 border-0 border-b border-solid px-4 py-2.5 ${tone.border}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                <h2 className={`m-0 text-[15px] font-bold ${tone.text}`}>{STOCK_CATEGORY_LABELS[category] ?? category}</h2>
                <span className="text-sm text-neutral-400">{rows.length}</span>
              </header>
              {rows.map((line) => {
                const draft = drafts[line.id] ?? { amount: "", packUnitId: defaultPack(line) };
                const canEdit = editable(line);
                const base = baseFromDraft(line, draft);
                return (
                  <div key={line.id} className={`flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0 ${line.recountRequested ? "bg-amber-50/60" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[15px] font-bold text-neutral-900">{line.name}</p>
                      <p className="m-0 mt-0.5 text-[13px] text-neutral-500">
                        {line.countStyle === "PARTIAL" && line.packUnits.length ? `Open ones in tenths: 2.3 ${line.packUnits[0].name.toLowerCase()}s` : `Count in ${unitShort(line.baseUnit)}${line.baseUnit === "G" || line.baseUnit === "ML" ? "" : "s"}`}
                        {line.expectedQuantity != null && !data.count.blind ? ` · book says ${formatStockQuantity(line.expectedQuantity, line.baseUnit)}` : ""}
                        {line.recountRequested ? " · count again" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        inputMode="decimal"
                        aria-label={`Counted ${line.name}`}
                        disabled={!canEdit}
                        value={draft.amount}
                        onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...draft, amount: event.target.value.replace(/[^\d.]/g, "") } }))}
                        onBlur={() => canEdit && commit(line, drafts[line.id] ?? draft)}
                        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                        placeholder="0"
                        className={`${smallFieldClass} h-11 w-24 text-center text-lg font-bold tabular-nums disabled:bg-neutral-50`}
                      />
                      <select
                        aria-label="Unit"
                        disabled={!canEdit}
                        value={draft.packUnitId}
                        onChange={(event) => {
                          const packUnitId = event.target.value === "units" ? "units" : Number(event.target.value);
                          const next = draftFromBase(line, base, packUnitId);
                          setDrafts((current) => ({ ...current, [line.id]: next }));
                        }}
                        className={`${smallFieldClass} h-11 w-28 text-sm`}
                      >
                        {line.packUnits.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
                        <option value="units">{line.baseUnit === "G" ? "grams" : line.baseUnit === "ML" ? "ml" : `${unitShort(line.baseUnit)}s`}</option>
                      </select>
                    </div>
                    {base != null && draft.packUnitId !== "units" && <p className="m-0 w-full text-right text-xs text-neutral-500">= {formatStockQuantity(base, line.baseUnit)}</p>}
                  </div>
                );
              })}
            </section>
          );
        })
      )}

      {status === "SUBMITTED" && !data.canApprove && <p className={`${cardClass} m-0 px-4 py-4 text-sm text-neutral-600`}>Submitted {formatWhen(data.count.submittedAt)}. A manager reviews it next.</p>}

      {status === "APPROVED" && (
        <div className={`${cardClass} flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6`}>
          <div>
            <p className="m-0 text-[15px] font-bold text-neutral-900">Approved {formatWhen(data.count.approvedAt)}{data.count.approvedBy ? ` by ${data.count.approvedBy}` : ""}</p>
            {data.showMoney && <p className="m-0 mt-0.5 text-sm text-neutral-600">Variance {data.count.varianceCost != null ? formatMoney(data.count.varianceCost, currency) : "-"} at cost{data.count.varianceSales != null ? `, ${formatMoney(data.count.varianceSales, currency)} at selling price` : ""}</p>}
            {data.count.decisionNote && <p className="m-0 mt-1 text-sm text-neutral-600">{data.count.decisionNote}</p>}
          </div>
          <Link href={`/owner/nrms/stock/counts/${countId}/report`} className={`${primaryButton} no-underline hover:no-underline`}><FileBarChart className="h-4 w-4" />Variance report</Link>
        </div>
      )}

      {(counting || reviewing) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-0 border-t border-solid border-neutral-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-2">
            {counting && (
              <>
                <button type="button" disabled={busy} onClick={() => { if (window.confirm("Cancel this count? What was counted is kept on record but posts nothing.")) void act("cancel", {}, "Count cancelled.").then(() => router.push("/owner/nrms/stock/counts")); }} className={quietButton}><XCircle className="h-4 w-4" />Cancel count</button>
                <button type="button" disabled={busy || countedCount < lines.length} onClick={() => void act("submit", {}, "Submitted for review.")} className={`${primaryButton} !h-11 px-5 text-base`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{countedCount < lines.length ? `${lines.length - countedCount} left to count` : "Submit count"}</button>
              </>
            )}
            {reviewing && (
              <>
                {outside > 0 && <span className="mr-auto inline-flex items-center gap-1.5 text-sm font-bold text-amber-800"><AlertTriangle className="h-4 w-4" />{outside} outside normal loss: say what you found</span>}
                <input value={decisionNote} onChange={(event) => setDecisionNote(event.target.value.slice(0, 500))} placeholder={outside ? "What you found (required)" : "Note (optional)"} className={`${smallFieldClass} min-w-[220px] flex-1`} />
                <button type="button" disabled={busy || recountPick.size === 0} onClick={() => void act("recount", { lineIds: [...recountPick], note: decisionNote.trim() || null }, "Sent back for a recount.")} className={quietButton}><RotateCcw className="h-4 w-4" />Recount {recountPick.size || ""}</button>
                <button type="button" disabled={busy || (outside > 0 && !decisionNote.trim())} onClick={() => void act("approve", { decisionNote: decisionNote.trim() || null }, "Approved. The book now matches the shelf.")} className={`${primaryButton} !h-10 px-4`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewTable({ lines, currency, showMoney, reviewing, picked, onPick }: { lines: Line[]; currency: string; showMoney: boolean; reviewing: boolean; picked: Set<number>; onPick: (next: Set<number>) => void }) {
  const sorted = [...lines].sort((a, b) => (a.varianceSales ?? a.varianceCost ?? a.varianceQuantity ?? 0) - (b.varianceSales ?? b.varianceCost ?? b.varianceQuantity ?? 0));
  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
              {reviewing && <th className="w-10 px-4 py-2.5" />}
              <th className="px-4 py-2.5">Good</th>
              <th className="px-2 py-2.5 text-right">Book</th>
              <th className="px-2 py-2.5 text-right">Counted</th>
              <th className="px-2 py-2.5 text-right">Variance</th>
              {showMoney && <th className="px-2 py-2.5 text-right">At cost</th>}
              {showMoney && <th className="px-2 py-2.5 text-right">At selling price</th>}
              <th className="px-4 py-2.5">Normal loss</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((line) => {
              const variance = line.varianceQuantity ?? 0;
              return (
                <tr key={line.id} className="border-0 border-t border-solid border-neutral-100">
                  {reviewing && <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Recount ${line.name}`} checked={picked.has(line.id)} onChange={() => { const next = new Set(picked); if (next.has(line.id)) next.delete(line.id); else next.add(line.id); onPick(next); }} className={checkboxClass} /></td>}
                  <td className="px-4 py-2.5">
                    <p className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-900"><span className={`h-2 w-2 rounded-full ${categoryTone(line.category).dot}`} />{line.name}</p>
                    {line.countedBy && <p className="m-0 text-xs text-neutral-500">Counted by {line.countedBy}{line.countedAt ? ` · ${formatWhen(line.countedAt)}` : ""}</p>}
                  </td>
                  <td className="px-2 py-2.5 text-right text-sm tabular-nums">{line.expectedQuantity != null ? formatStockQuantity(line.expectedQuantity, line.baseUnit) : "-"}</td>
                  <td className="px-2 py-2.5 text-right text-sm tabular-nums">{line.countedQuantity != null ? formatStockQuantity(line.countedQuantity, line.baseUnit) : "-"}</td>
                  <td className={`px-2 py-2.5 text-right text-sm font-bold tabular-nums ${variance < 0 ? "text-red-700" : variance > 0 ? "text-emerald-700" : "text-neutral-500"}`}>{variance > 0 ? "+" : ""}{formatStockQuantity(variance, line.baseUnit)}</td>
                  {showMoney && <td className="px-2 py-2.5 text-right text-sm tabular-nums">{line.varianceCost != null ? formatMoney(line.varianceCost, currency) : "-"}</td>}
                  {showMoney && <td className={`px-2 py-2.5 text-right text-sm font-bold tabular-nums ${(line.varianceSales ?? 0) < 0 ? "text-red-700" : ""}`}>{line.varianceSales != null ? formatMoney(line.varianceSales, currency) : "-"}</td>}
                  <td className="px-4 py-2.5">{line.withinTolerance == null ? <span className="text-neutral-400">-</span> : line.withinTolerance ? <Pill tone="ok">Within {line.tolerancePercent}%</Pill> : <Pill tone="out">Outside {line.tolerancePercent}%</Pill>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
