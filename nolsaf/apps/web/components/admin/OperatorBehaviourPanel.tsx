"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Banknote, CheckCircle2, ChevronLeft, ChevronRight, Clock, KeyRound, LogIn,
  Map as MapIcon, RefreshCw, ShieldAlert, ShieldCheck, UserCog, Wallet,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type Severity = "CLEAN" | "WATCH" | "ACTION";
type Category = "SIGN_IN" | "SECURITY" | "PAYOUT_DETAILS" | "PAYOUTS" | "TRIPS" | "PROFILE" | "ADMIN" | "OTHER";

type ActivityResponse = {
  window: { from: string; to: string };
  band: Severity;
  restricted: boolean;
  engagement: {
    joinedAt: string; lastSignInAt: string | null; lastSeenAt: string | null; signIns: number; failedSignIns: number;
    devices: number; networks: number; activeSessions: number; supportSessions: number;
  };
  signals: { key: string; label: string; value: string; detail: string; threshold: string; severity: Severity }[];
  payoutDestinations: {
    id: number; type: string; provider: string; accountName: string; accountNumberMasked: string;
    isVerified: boolean; isDefault: boolean; isActive: boolean; addedAt: string; verifiedAt: string | null; changedAt: string | null;
  }[];
  timeline: {
    at: string; category: Category; label: string; detail: string | null; tone: "good" | "warn" | "bad" | "neutral";
    actor: "OPERATOR" | "ADMIN" | "SYSTEM" | "TRAVELLER"; actorName: string | null; device: string | null; ip: string | null;
  }[];
  timelineTruncated: boolean;
};

const WINDOWS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
  { days: 3650, label: "All time" },
];

const CATEGORIES: { key: Category | "ALL"; label: string; Icon: typeof Activity }[] = [
  { key: "ALL", label: "All activity", Icon: Activity },
  { key: "SIGN_IN", label: "Sign-ins", Icon: LogIn },
  { key: "SECURITY", label: "Security", Icon: KeyRound },
  { key: "PAYOUT_DETAILS", label: "Payout details", Icon: Wallet },
  { key: "PAYOUTS", label: "Payout claims", Icon: Banknote },
  { key: "TRIPS", label: "Trips", Icon: MapIcon },
  { key: "PROFILE", label: "Profile and packages", Icon: UserCog },
  { key: "ADMIN", label: "Admin actions", Icon: ShieldCheck },
];

const BAND: Record<Severity, { label: string; box: string; dot: string; blurb: string }> = {
  CLEAN: { label: "Clean", box: "bg-emerald-50 text-emerald-900 ring-emerald-200", dot: "bg-emerald-500", blurb: "No signal crossed its watch threshold in this window." },
  WATCH: { label: "Watch", box: "bg-amber-50 text-amber-900 ring-amber-200", dot: "bg-amber-500", blurb: "At least one signal crossed its watch threshold. Worth a look, not a suspension." },
  ACTION: { label: "Action needed", box: "bg-red-50 text-red-900 ring-red-200", dot: "bg-red-500", blurb: "A signal crossed its action threshold, or the operator is already restricted." },
};

const SIGNAL_TONE: Record<Severity, { box: string; chip: string; label: string }> = {
  ACTION: { box: "bg-red-50 ring-red-200", chip: "bg-red-100 text-red-800", label: "Action" },
  WATCH: { box: "bg-amber-50 ring-amber-200", chip: "bg-amber-100 text-amber-900", label: "Watch" },
  CLEAN: { box: "bg-white ring-neutral-200", chip: "bg-emerald-100 text-emerald-800", label: "Clean" },
};

const TONE_DOT: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-red-50 text-red-700",
  neutral: "bg-neutral-100 text-neutral-500",
};

const CATEGORY_ICON: Record<Category, typeof Activity> = {
  SIGN_IN: LogIn, SECURITY: KeyRound, PAYOUT_DETAILS: Wallet, PAYOUTS: Banknote, TRIPS: MapIcon, PROFILE: UserCog, ADMIN: ShieldCheck, OTHER: Activity,
};

const ACTOR_LABEL: Record<string, string> = { OPERATOR: "Operator", ADMIN: "Admin", SYSTEM: "NoLSAF", TRAVELLER: "Traveller" };
const CATEGORY_LABEL: Record<Category, string> = {
  SIGN_IN: "Sign-in", SECURITY: "Security", PAYOUT_DETAILS: "Payout details", PAYOUTS: "Payout claim",
  TRIPS: "Trip", PROFILE: "Profile", ADMIN: "Admin", OTHER: "Other",
};

function eventIcon(e: { tone: string; category: Category }) {
  return e.tone === "bad" ? ShieldAlert : e.tone === "warn" ? AlertTriangle : e.tone === "good" ? CheckCircle2 : CATEGORY_ICON[e.category];
}

function destinationTags(d: { isActive: boolean; isDefault: boolean; isVerified: boolean }) {
  return (
    <>
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${d.isActive ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100 text-neutral-500"}`}>{d.isActive ? (d.isDefault ? "Active, default" : "Active") : "Switched off"}</span>
      {!d.isVerified ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Not verified</span> : null}
    </>
  );
}
const PAGE_SIZE = 30;
const EAT = "Africa/Dar_es_Salaam";

function eatDay(isoValue: string) {
  return new Date(isoValue).toLocaleDateString("en-GB", { timeZone: EAT, weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function eatTime(isoValue: string) {
  return `${new Date(isoValue).toLocaleTimeString("en-GB", { timeZone: EAT, hour: "2-digit", minute: "2-digit" })} EAT`;
}
function eatStamp(isoValue: string | null) {
  return isoValue ? `${eatDay(isoValue)}, ${eatTime(isoValue)}` : "Never";
}
function ago(isoValue: string | null) {
  if (!isoValue) return "Never";
  const days = Math.floor((Date.now() - new Date(isoValue).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

export default function OperatorBehaviourPanel({ agentId }: { agentId: number }) {
  const [days, setDays] = useState(365);
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | "ALL">("ALL");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiClient.get<ActivityResponse>(`/api/admin/agents/${agentId}/behaviour`, { params: { days } });
      setData(r.data);
      setPage(1);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not load this operator's behaviour.");
    } finally {
      setLoading(false);
    }
  }, [agentId, days]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { ALL: data?.timeline.length ?? 0 };
    for (const e of data?.timeline ?? []) out[e.category] = (out[e.category] ?? 0) + 1;
    return out;
  }, [data]);

  const filtered = useMemo(
    () => (data?.timeline ?? []).filter((e) => category === "ALL" || e.category === category),
    [data, category],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  // 1 … 4 5 6 … 14: first, last, and the pages either side of this one.
  const pageItems: Array<number | "gap"> = [];
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - current) <= 1) pageItems.push(n);
    else if (pageItems[pageItems.length - 1] !== "gap") pageItems.push("gap");
  }
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Window */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Window</span>
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            onClick={() => setDays(w.days)}
            className={`h-8 cursor-pointer rounded-lg border border-solid px-3 text-xs font-semibold ${days === w.days ? "border-[#02665e] bg-[#02665e] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}
          >
            {w.label}
          </button>
        ))}
        <button type="button" onClick={() => void load()} className="ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden /> Refresh
        </button>
      </div>

      {error ? (
        <p className="m-0 rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-200">{error}</p>
      ) : !data ? (
        <div className="rounded-lg border border-solid border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">Loading behaviour...</div>
      ) : (
        <>
          {/* Band */}
          <section className={`flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 ring-1 ${BAND[data.band].box}`}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${BAND[data.band].dot}`} aria-hidden />
            <strong className="text-sm">{BAND[data.band].label}</strong>
            <span className="min-w-0 flex-1 text-xs">{data.restricted ? "This operator is suspended or disabled." : BAND[data.band].blurb}</span>
            <span className="text-[11px] opacity-80">{eatDay(data.window.from)} to {eatDay(data.window.to)}</span>
          </section>

          {/* Engagement */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Last sign-in", value: ago(data.engagement.lastSignInAt), sub: eatStamp(data.engagement.lastSignInAt) },
              { label: "Last seen", value: ago(data.engagement.lastSeenAt), sub: `${data.engagement.activeSessions} active session(s)` },
              { label: "Sign-ins", value: String(data.engagement.signIns), sub: `${data.engagement.failedSignIns} failed`, warn: data.engagement.failedSignIns >= 5 },
              { label: "Devices", value: String(data.engagement.devices), sub: `${data.engagement.networks} network address(es) · ${data.engagement.supportSessions} support session(s)` },
            ].map((m) => (
              <div key={m.label} className={`min-w-0 rounded-lg border border-solid bg-white p-4 ${m.warn ? "border-amber-200" : "border-neutral-200"}`}>
                <p className="m-0 text-[11px] font-semibold text-neutral-500">{m.label}</p>
                <p className="m-0 mt-1 truncate text-lg font-black tracking-tight text-neutral-950">{m.value}</p>
                <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400">{m.sub}</p>
              </div>
            ))}
          </section>

          {/* Signals */}
          <section className="rounded-lg border border-solid border-neutral-200 bg-white p-4">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Signals</p>
            <p className="m-0 mt-0.5 text-xs text-neutral-500">Each signal shows the threshold behind its grade, so you can see why before acting.</p>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {data.signals.map((s) => (
                <div key={s.key} className={`min-w-0 rounded-md p-3 ring-1 ${SIGNAL_TONE[s.severity].box}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-neutral-800">{s.label}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${SIGNAL_TONE[s.severity].chip}`}>{SIGNAL_TONE[s.severity].label}</span>
                  </div>
                  <p className="m-0 mt-1 text-base font-bold tabular-nums text-neutral-950">{s.value}</p>
                  <p className="m-0 mt-0.5 text-[11px] text-neutral-500">{s.detail}</p>
                  <p className="m-0 mt-1 text-[10px] text-neutral-400">{s.threshold}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Payout destinations */}
          <section className="rounded-lg border border-solid border-neutral-200 bg-white">
            <div className="flex items-center gap-2 px-4 pb-2 pt-4">
              <Wallet className="h-4 w-4 text-neutral-400" aria-hidden />
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Payout destinations</p>
            </div>
            {data.payoutDestinations.length === 0 ? (
              <p className="m-0 px-4 pb-4 text-xs text-neutral-500">No payout destination has been added.</p>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[720px] border-collapse text-[13px]">
                    <thead>
                      <tr className="bg-neutral-50">
                        {["Destination", "Status", "Added", "Name verified", "Last changed"].map((h) => (
                          <th key={h} className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-4 py-2.5 text-left text-[11px] font-semibold text-neutral-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.payoutDestinations.map((d) => (
                        <tr key={d.id} className="border-0 border-b border-solid border-neutral-100 last:border-b-0 hover:bg-neutral-50/70">
                          <td className="px-4 py-3 align-top">
                            <div className="font-semibold text-neutral-900">{d.accountName}</div>
                            <div className="font-mono text-[11px] text-neutral-500">{d.provider} {d.accountNumberMasked}</div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex flex-wrap gap-1">{destinationTags(d)}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-top text-neutral-700">{eatStamp(d.addedAt)}</td>
                          <td className="whitespace-nowrap px-4 py-3 align-top text-neutral-700">{d.verifiedAt ? eatStamp(d.verifiedAt) : "-"}</td>
                          <td className={`whitespace-nowrap px-4 py-3 align-top ${d.changedAt ? "font-semibold text-red-700" : "text-neutral-400"}`}>{d.changedAt ? eatStamp(d.changedAt) : "Never changed"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="m-0 list-none p-0 md:hidden">
                  {data.payoutDestinations.map((d) => (
                    <li key={d.id} className="border-0 border-t border-solid border-neutral-100 px-4 py-3">
                      <div className="text-sm font-semibold text-neutral-900">{d.accountName}</div>
                      <div className="font-mono text-[11px] text-neutral-500">{d.provider} {d.accountNumberMasked}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">{destinationTags(d)}</div>
                      <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                        {[
                          { k: "Added", v: eatStamp(d.addedAt), red: false },
                          { k: "Name verified", v: d.verifiedAt ? eatStamp(d.verifiedAt) : "-", red: false },
                          { k: "Last changed", v: d.changedAt ? eatStamp(d.changedAt) : "Never changed", red: Boolean(d.changedAt) },
                        ].map((pair) => (
                          <div key={pair.k} className="min-w-0">
                            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400">{pair.k}</dt>
                            <dd className={`m-0 mt-0.5 text-[12px] ${pair.red ? "font-semibold text-red-700" : "text-neutral-700"}`}>{pair.v}</dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Timeline */}
          <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
            <div className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-neutral-100 px-2" role="tablist">
              {CATEGORIES.map((c) => {
                const active = category === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => { setCategory(c.key); setPage(1); }}
                    className={`-mb-px inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-solid bg-transparent px-3 py-3 text-xs font-bold ${active ? "border-emerald-700 text-emerald-800" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
                  >
                    <c.Icon className="h-3.5 w-3.5" aria-hidden />
                    {c.label}
                    <span className="rounded-full bg-neutral-100 px-1.5 text-[10px] tabular-nums text-neutral-500">{counts[c.key] ?? 0}</span>
                  </button>
                );
              })}
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <Clock className="h-6 w-6 text-neutral-300" aria-hidden />
                <p className="m-0 mt-2 text-sm font-semibold text-neutral-700">Nothing recorded</p>
                <p className="m-0 mt-1 text-xs text-neutral-500">No activity of this kind in the selected window.</p>
              </div>
            ) : (
              <div>
                {/* Desktop and tablet: one event per row, aligned columns */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[820px] border-collapse text-[13px]">
                    <thead>
                      <tr className="bg-neutral-50">
                        {["When", "Event", "Area", "By", "Device", "Network address"].map((h) => (
                          <th key={h} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-4 py-2.5 text-left text-[11px] font-semibold text-neutral-500 ${h === "Event" ? "w-[38%]" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e, i) => {
                        const Icon = eventIcon(e);
                        return (
                          <tr key={`${e.at}-${i}`} className="border-0 border-b border-solid border-neutral-100 last:border-b-0 hover:bg-neutral-50/70">
                            <td className="whitespace-nowrap px-4 py-3 align-top">
                              <div className="font-semibold tabular-nums text-neutral-800">{eatTime(e.at)}</div>
                              <div className="text-[11px] text-neutral-400">{eatDay(e.at)}</div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="flex items-start gap-2.5">
                                <span className={`mt-px grid h-7 w-7 shrink-0 place-items-center rounded ${TONE_DOT[e.tone]}`}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                                <div className="min-w-0">
                                  <div className={`font-semibold ${e.tone === "bad" ? "text-red-800" : "text-neutral-900"}`}>{e.label}</div>
                                  {e.detail ? <div className="mt-0.5 break-words text-[12px] text-neutral-500">{e.detail}</div> : null}
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 align-top text-neutral-600">{CATEGORY_LABEL[e.category]}</td>
                            <td className="px-4 py-3 align-top">
                              <span className="inline-flex whitespace-nowrap rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-700">{ACTOR_LABEL[e.actor]}</span>
                              {e.actorName ? <div className="mt-0.5 text-[11px] text-neutral-400">{e.actorName}</div> : null}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 align-top text-neutral-600">{e.device || <span className="text-neutral-300">-</span>}</td>
                            <td className="whitespace-nowrap px-4 py-3 align-top font-mono text-[12px] text-neutral-600">{e.ip || <span className="font-sans text-neutral-300">-</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Phones: the same columns as labelled pairs */}
                <ul className="m-0 list-none p-0 md:hidden">
                  {rows.map((e, i) => {
                    const Icon = eventIcon(e);
                    return (
                      <li key={`${e.at}-${i}`} className="border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0">
                        <div className="flex items-start gap-2.5">
                          <span className={`mt-px grid h-7 w-7 shrink-0 place-items-center rounded ${TONE_DOT[e.tone]}`}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                          <div className="min-w-0">
                            <div className={`text-sm font-semibold ${e.tone === "bad" ? "text-red-800" : "text-neutral-900"}`}>{e.label}</div>
                            {e.detail ? <div className="mt-0.5 break-words text-[12px] text-neutral-500">{e.detail}</div> : null}
                          </div>
                        </div>
                        <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                          {[
                            { k: "When", v: `${eatDay(e.at)}, ${eatTime(e.at)}` },
                            { k: "By", v: e.actorName ? `${ACTOR_LABEL[e.actor]}: ${e.actorName}` : ACTOR_LABEL[e.actor] },
                            { k: "Device", v: e.device || "-" },
                            { k: "Network address", v: e.ip || "-" },
                          ].map((pair) => (
                            <div key={pair.k} className="min-w-0">
                              <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400">{pair.k}</dt>
                              <dd className="m-0 mt-0.5 break-words text-[12px] text-neutral-700">{pair.v}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    );
                  })}
                </ul>

                <nav aria-label="Activity pages" className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-2.5">
                  <p className="m-0 text-xs text-neutral-500">
                    Showing <strong className="tabular-nums text-neutral-900">{(current - 1) * PAGE_SIZE + 1}-{Math.min(current * PAGE_SIZE, filtered.length)}</strong> of{" "}
                    <strong className="tabular-nums text-neutral-900">{filtered.length}</strong>
                    {data.timelineTruncated ? <span className="text-neutral-400"> (latest 1,500 kept; narrow the window for older events)</span> : null}
                  </p>
                  {pageCount > 1 ? (
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)} className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                      {pageItems.map((item, index) =>
                        item === "gap" ? (
                          <span key={`gap-${index}`} className="px-1 text-xs text-neutral-400" aria-hidden>…</span>
                        ) : (
                          <button
                            key={item}
                            type="button"
                            onClick={() => setPage(item)}
                            aria-current={item === current ? "page" : undefined}
                            className={`h-8 min-w-8 cursor-pointer rounded-md border border-solid px-2 text-xs font-bold tabular-nums ${item === current ? "border-[#02665e] bg-[#02665e] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}
                          >
                            {item}
                          </button>
                        ),
                      )}
                      <button type="button" aria-label="Next page" disabled={current === pageCount} onClick={() => setPage(current + 1)} className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" aria-hidden /></button>
                    </div>
                  ) : null}
                </nav>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
