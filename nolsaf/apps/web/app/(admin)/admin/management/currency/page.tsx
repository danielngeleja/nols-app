"use client";

// Display currency rates, in the admin Sales page language: dark header band
// with headline numbers, a quiet money-of-record note, a ruled rate list, a
// sticky save bar while edits are pending, and a ruled change history.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Coins, Lock, RefreshCw, RotateCcw, Unlock, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

const api = apiClient;

interface CurrencyMeta {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

interface FxState {
  base: string;
  tzsPerUnit: Record<string, number>;
  locked: Record<string, boolean>;
  updatedAt: string | null;
  source: "fallback" | "manual" | "auto";
  stale: boolean;
  bounds: Record<string, { min: number; max: number }>;
  currencies: CurrencyMeta[];
}

interface FxAuditEntry {
  id: string;
  actorId: number | null;
  actorRole: string | null;
  actor: { id: number; email?: string | null; name?: string | null; role?: string | null } | null;
  ip: string | null;
  createdAt: string;
  before: { tzsPerUnit?: Record<string, number>; locked?: Record<string, boolean>; source?: string } | null;
  after: { tzsPerUnit?: Record<string, number>; locked?: Record<string, boolean>; source?: string } | null;
}

const SOURCE: Record<FxState["source"], { label: string; text: string }> = {
  manual: { label: "Manual", text: "text-emerald-300" },
  auto: { label: "Automated", text: "text-sky-300" },
  fallback: { label: "Built-in fallback", text: "text-amber-300" },
};

// Ghost buttons sitting on the dark header, as on the Sales pages.
const heroButton =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";

function eat(value?: string | null) {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  return `${d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

function ago(value?: string | null) {
  if (!value) return "Never";
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (Number.isNaN(minutes)) return "Never";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30.4);
  return months < 12 ? `${months} month${months === 1 ? "" : "s"} ago` : `${Math.floor(days / 365)} year${days >= 730 ? "s" : ""} ago`;
}

function initials(name: string) {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.charAt(0) || "") + (parts[1]?.charAt(0) || "")).toUpperCase() || "?";
}

function fmtRate(n: number | undefined | null) {
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return "none";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function CurrencyRatesPage() {
  const [fx, setFx] = useState<FxState | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  // Pristine snapshots so we can highlight exactly what the admin has changed.
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [originalLocked, setOriginalLocked] = useState<Record<string, boolean>>({});
  const [audit, setAudit] = useState<FxAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get<FxState>("/api/admin/fx");
      const data = r.data;
      setFx(data);
      const nextDraft: Record<string, string> = {};
      for (const c of data.currencies) {
        if (c.code === data.base) continue;
        nextDraft[c.code] = String(data.tzsPerUnit?.[c.code] ?? "");
      }
      setDraft(nextDraft);
      setOriginal({ ...nextDraft });
      setLocked({ ...(data.locked || {}) });
      setOriginalLocked({ ...(data.locked || {}) });
    } catch {
      setError("Failed to load currency rates.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const r = await api.get<FxAuditEntry[]>("/api/admin/fx/audit", {
        headers: { "Cache-Control": "no-cache" },
        params: { _t: Date.now() },
      });
      setAudit(Array.isArray(r.data) ? r.data : []);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAudit(); }, [loadAudit]);

  const base = fx?.base || "TZS";
  const editable = useMemo(() => (fx?.currencies || []).filter((c) => c.code !== base), [fx, base]);

  const isDirty = (code: string) =>
    (draft[code] ?? "") !== (original[code] ?? "") || !!locked[code] !== !!originalLocked[code];

  const dirtyCount = useMemo(
    () => editable.filter((c) => isDirty(c.code)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editable, draft, original, locked, originalLocked]
  );
  const pinnedCount = editable.filter((c) => locked[c.code]).length;

  const resetChanges = () => {
    setDraft({ ...original });
    setLocked({ ...originalLocked });
  };

  const save = async () => {
    if (!fx) return;
    const tzsPerUnit: Record<string, number> = {};
    const errs: string[] = [];
    for (const c of editable) {
      const raw = (draft[c.code] ?? "").trim();
      if (raw === "") continue; // unspecified: keep current
      const n = Number(raw);
      const b = fx.bounds[c.code];
      if (!Number.isFinite(n) || n <= 0) {
        errs.push(`${c.code}: enter a positive number`);
        continue;
      }
      if (b && (n < b.min || n > b.max)) {
        errs.push(`${c.code}: must be between ${b.min.toLocaleString()} and ${b.max.toLocaleString()} TZS`);
        continue;
      }
      tzsPerUnit[c.code] = n;
    }
    if (errs.length) {
      setError(errs[0] + (errs.length > 1 ? ` (+${errs.length - 1} more)` : ""));
      return;
    }
    if (Object.keys(tzsPerUnit).length === 0) {
      setError("No changes to save.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.put("/api/admin/fx", { tzsPerUnit, locked });
      const rejected = (r.data as any)?.rejected as { code: string; reason: string }[] | undefined;
      if (rejected && rejected.length > 0) {
        setError(`Some rates were rejected: ${rejected.map((x) => `${x.code} (${x.reason})`).join(", ")}`);
      } else {
        setNotice("Display rates saved. The change is recorded in the history below with your account and time.");
      }
      await load();
      await loadAudit();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to save currency rates.");
    } finally {
      setSaving(false);
    }
  };

  const source = SOURCE[fx?.source || "fallback"] || SOURCE.fallback;

  return (
    <div className="box-border w-full min-w-0 space-y-5 pb-24">
      {/* Header: dark brand band with headline numbers */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Platform</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Currency rates</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Display-currency rates for prices shown to users. Every change is audited.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { void load(); void loadAudit(); }} disabled={loading} className={`${heroButton} w-9 px-0`} aria-label="Refresh rates" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Fact strip: same rhythm for every cell, label, value, detail */}
          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {[
              { label: "Money of record", value: base, detail: "Fixed at 1.00", tone: "text-white" },
              {
                label: "Display currencies",
                value: loading ? "..." : String(editable.length),
                detail: loading ? "" : pinnedCount === 0 ? "None pinned" : pinnedCount === editable.length ? "All pinned" : `${pinnedCount} pinned`,
                tone: "text-white",
              },
              {
                label: "Rate source",
                value: fx ? source.label : "...",
                detail: fx?.stale ? "Stale, review rates" : fx ? "Up to date" : "",
                tone: source.text,
                warn: Boolean(fx?.stale),
              },
              {
                label: "Last updated",
                value: fx?.updatedAt ? new Date(fx.updatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : fx ? "Never" : "...",
                detail: fx?.updatedAt
                  ? `${ago(fx.updatedAt)} · ${new Date(fx.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`
                  : "",
                tone: "text-white",
              },
            ].map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "pl-4 sm:pl-5" : ""} ${index > 0 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""} ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 lg:border-l" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className={`m-0 mt-1 flex items-center gap-1 truncate text-xs ${fact.warn ? "font-semibold text-amber-300" : "text-white/50"}`}>
                  {fact.warn ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
                  {fact.detail || " "}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800" role="alert">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Money of record */}
      <p className="m-0 border-0 border-l-2 border-solid border-emerald-600 px-3 py-1 text-[13px] leading-6 text-neutral-600">
        <b className="text-neutral-900">{base} is the money of record.</b> These rates only change how prices are <b className="text-neutral-900">displayed</b>.
        They never change what anyone is charged, what drivers and owners are paid, or any invoice total. Everything settles in {base}.
      </p>

      {/* Rates */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">Display rates</h2>
            <p className="m-0 text-xs text-neutral-400">How many {base} equal 1 unit of each currency.</p>
          </div>
          {dirtyCount > 0 ? (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-solid border-amber-100 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
            </span>
          ) : null}
        </div>

        {/* Base anchor */}
        <div className="flex items-center gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-4 py-3 sm:px-5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0b2420] text-[11px] font-bold text-emerald-300">{base}</span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold text-neutral-900">{base} base currency</p>
            <p className="m-0 text-xs text-neutral-500">Fixed at 1. Every display currency is priced against it.</p>
          </div>
          <span className="font-mono text-sm font-bold text-neutral-700">1.00</span>
        </div>

        {loading && !fx ? (
          <div className="border-0 border-t border-solid border-neutral-100 py-12 text-center text-sm text-neutral-500">Loading rates</div>
        ) : (
          <ul className="m-0 list-none p-0">
            {editable.map((c) => {
              const b = fx?.bounds?.[c.code];
              const val = draft[c.code] ?? "";
              const n = Number(val);
              const valid = val === "" || (Number.isFinite(n) && n > 0 && (!b || (n >= b.min && n <= b.max)));
              const isLocked = !!locked[c.code];
              const dirty = isDirty(c.code);
              const saved = Number(original[c.code]);
              const delta = dirty && valid && val !== "" && Number.isFinite(saved) && saved > 0 && n !== saved ? ((n - saved) / saved) * 100 : null;
              return (
                <li
                  key={c.code}
                  className={`grid grid-cols-1 items-center gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] ${dirty ? "bg-amber-50/40" : ""}`}
                >
                  {/* Currency */}
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">
                      {c.code.slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 flex items-center gap-2 text-sm font-semibold text-neutral-900">
                        {c.code} <span className="font-normal text-neutral-400">{c.symbol}</span>
                        {dirty ? <span className="rounded-full border border-solid border-amber-100 bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-700">Edited</span> : null}
                      </p>
                      <p className="m-0 truncate text-xs text-neutral-400">{c.name}</p>
                    </div>
                  </div>

                  {/* Rate input */}
                  <div className="min-w-0">
                    <div
                      className={`flex overflow-hidden rounded-lg border border-solid bg-white transition focus-within:ring-2 ${
                        valid ? "border-neutral-200 focus-within:border-emerald-400 focus-within:ring-emerald-100" : "border-rose-300 focus-within:ring-rose-100"
                      }`}
                    >
                      <span className="flex shrink-0 items-center border-0 border-r border-solid border-neutral-100 bg-neutral-50 px-2.5 text-[11px] font-semibold text-neutral-500">1 {c.code} =</span>
                      <input
                        type="number"
                        min={b?.min}
                        max={b?.max}
                        step="0.01"
                        inputMode="decimal"
                        value={val}
                        onChange={(e) => setDraft((p) => ({ ...p, [c.code]: e.target.value }))}
                        aria-label={`${base} per 1 ${c.code}`}
                        className="box-border h-10 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-semibold tabular-nums text-neutral-900 outline-none placeholder:text-neutral-300"
                        placeholder={String(fx?.tzsPerUnit?.[c.code] ?? "")}
                      />
                      <span className="flex shrink-0 items-center border-0 border-l border-solid border-neutral-100 px-2.5 text-[11px] font-bold text-emerald-700">{base}</span>
                    </div>
                    <p className={`m-0 mt-1 text-[11px] ${valid ? "text-neutral-400" : "font-semibold text-rose-600"}`}>
                      {!valid
                        ? `Must be between ${b?.min.toLocaleString()} and ${b?.max.toLocaleString()} ${base}`
                        : b
                          ? `Allowed ${b.min.toLocaleString()} to ${b.max.toLocaleString()} ${base}`
                          : "No range set"}
                    </p>
                  </div>

                  {/* What it means */}
                  <div className="min-w-0 text-xs text-neutral-500">
                    {val !== "" && valid && Number.isFinite(n) && n > 0 ? (
                      <>
                        <p className="m-0">10,000 {base} shows as <b className="tabular-nums text-neutral-800">{(10000 / n).toLocaleString(undefined, { maximumFractionDigits: c.decimals })} {c.code}</b></p>
                        {delta !== null ? (
                          <p className={`m-0 mt-0.5 font-semibold tabular-nums ${delta > 0 ? "text-emerald-700" : "text-rose-600"}`}>
                            {delta > 0 ? "+" : ""}{delta.toFixed(2)}% vs saved {fmtRate(saved)}
                          </p>
                        ) : (
                          <p className="m-0 mt-0.5 text-neutral-400">Saved rate</p>
                        )}
                      </>
                    ) : (
                      <p className="m-0 text-neutral-400">Enter a rate to preview</p>
                    )}
                  </div>

                  {/* Pin */}
                  <button
                    type="button"
                    onClick={() => setLocked((p) => ({ ...p, [c.code]: !p[c.code] }))}
                    aria-pressed={isLocked}
                    title={isLocked ? "Pinned: an automated feed will not change this rate" : "Not pinned: an automated feed may update this rate"}
                    className={`inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid px-3 text-xs font-semibold transition lg:justify-self-end ${
                      isLocked ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-800"
                    }`}
                  >
                    {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                    {isLocked ? "Pinned" : "Pin"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Change history */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">Change history</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{audit.length ? `${audit.length} recorded ${audit.length === 1 ? "change" : "changes"}` : "Every rate change, with who and when"}</p>
          </div>
          <button type="button" onClick={() => void loadAudit()} className="ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {audit.length === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-12 text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
              <Coins className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No changes recorded yet</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">Saving a rate starts the history.</p>
          </div>
        ) : (
          <ol className="m-0 max-h-[520px] list-none overflow-y-auto border-0 border-t border-solid border-neutral-100 p-0">
            {audit.map((row, idx) => {
              const actorName = row.actor?.name || row.actor?.email || row.actorRole || "Admin";
              const beforeR = row.before?.tzsPerUnit || {};
              const afterR = row.after?.tzsPerUnit || {};
              const codes = Array.from(new Set([...Object.keys(beforeR), ...Object.keys(afterR)]));
              const changed = codes.filter((k) => k !== base && String(beforeR[k] ?? "") !== String(afterR[k] ?? ""));
              const beforeL = row.before?.locked || {};
              const afterL = row.after?.locked || {};
              const pinChanges = Array.from(new Set([...Object.keys(beforeL), ...Object.keys(afterL)])).filter((k) => !!beforeL[k] !== !!afterL[k]);
              return (
                <li key={row.id} className="grid grid-cols-1 gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0 sm:px-5 md:grid-cols-[11rem_minmax(0,1fr)_14rem] md:items-start">
                  <div className="min-w-0">
                    <p className="m-0 flex items-center gap-2 text-xs font-semibold text-neutral-800">
                      {ago(row.createdAt)}
                      {idx === 0 ? <span className="rounded-full border border-solid border-emerald-100 bg-emerald-50 px-1.5 py-px text-[10px] font-bold text-emerald-700">Latest</span> : null}
                    </p>
                    <p className="m-0 mt-0.5 text-[10.5px] tabular-nums text-neutral-400">{eat(row.createdAt)}</p>
                  </div>

                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {changed.map((k) => {
                      const from = Number(beforeR[k]);
                      const to = Number(afterR[k]);
                      const pct = Number.isFinite(from) && from > 0 && Number.isFinite(to) ? ((to - from) / from) * 100 : null;
                      return (
                        <span key={k} className="inline-flex items-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-600">
                          <b className="text-neutral-900">{k}</b>
                          <span className="tabular-nums text-neutral-400 line-through">{fmtRate(beforeR[k])}</span>
                          <span className="text-neutral-400">to</span>
                          <b className="tabular-nums text-neutral-900">{fmtRate(afterR[k])}</b>
                          {pct !== null ? <span className={`font-semibold tabular-nums ${pct >= 0 ? "text-emerald-700" : "text-rose-600"}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</span> : null}
                        </span>
                      );
                    })}
                    {pinChanges.map((k) => (
                      <span key={`pin-${k}`} className="inline-flex items-center gap-1 rounded-md border border-solid border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600">
                        {afterL[k] ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        {k} {afterL[k] ? "pinned" : "unpinned"}
                      </span>
                    ))}
                    {changed.length === 0 && pinChanges.length === 0 ? <span className="text-[11px] text-neutral-400">No rate values changed</span> : null}
                  </div>

                  <div className="flex min-w-0 items-center gap-2 md:justify-end">
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white">{initials(actorName)}</span>
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-[11px] font-semibold text-neutral-700">{actorName}</span>
                      <span className="block truncate text-[10px] text-neutral-400">{[row.actorId ? `#${row.actorId}` : "", row.ip || ""].filter(Boolean).join(" · ") || "Admin"}</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Save bar while edits are pending */}
      {dirtyCount > 0 ? (
        <div className="sticky bottom-4 z-20">
          <div className="flex flex-col gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 shadow-[0_12px_28px_-16px_rgba(11,36,32,0.45)] sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-amber-900">
              <b>{dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}.</b> Saving updates displayed prices straight away and is recorded in the history.
            </p>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={resetChanges} disabled={saving} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-amber-200 bg-white px-3.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60">
                <RotateCcw className="h-4 w-4" /> Reset
              </button>
              <button type="button" onClick={() => void save()} disabled={saving || loading} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60">
                <CheckCircle2 className="h-4 w-4" /> {saving ? "Saving" : `Save ${dirtyCount === 1 ? "change" : "changes"}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
