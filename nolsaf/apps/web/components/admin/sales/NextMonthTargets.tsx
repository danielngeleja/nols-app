"use client";

/**
 * Admin: next month's targets for every active partner, drafted by the system
 * (3-month average + 20%) and approved in one click. Edit any number first,
 * or untick a partner to leave them out.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Search, Sparkles, Target } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Row = {
  partnerId: number;
  name: string;
  agentCode: string;
  region: string | null;
  team: string | null;
  history: number[];
  suggested: number;
  current: { target: number; setBy: string } | null;
};
type Data = { month: string; basedOn: string[]; partners: Row[] };

const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-neutral-500";

function monthName(key: string, style: "short" | "long" = "short") {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: style, ...(style === "long" ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export default function NextMonthTargets() {
  const [data, setData] = useState<Data | null>(null);
  const [values, setValues] = useState<Record<number, string>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/api/admin/sales/targets/next-month");
      setData(data);
      setValues(Object.fromEntries((data.partners as Row[]).map((p) => [p.partnerId, String(p.current?.setBy === "ADMIN" ? p.current.target : p.suggested)])));
      // Already set by an admin: left out unless ticked again.
      setSkip(new Set((data.partners as Row[]).filter((p) => p.current?.setBy === "ADMIN").map((p) => p.partnerId)));
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load next month's targets.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.partners ?? []).filter((p) => !q || [p.name, p.agentCode, p.region, p.team].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [data, query]);
  const chosen = (data?.partners ?? []).filter((p) => !skip.has(p.partnerId));
  const edited = chosen.filter((p) => Number(values[p.partnerId]) !== p.suggested).length;
  const eatDay = new Date(Date.now() + 3 * 3_600_000).getUTCDate();

  const approve = async () => {
    const items = chosen.map((p) => ({ partnerId: p.partnerId, target: Number(values[p.partnerId]) }));
    const bad = items.find((i) => !Number.isInteger(i.target) || i.target < 1 || i.target > 50);
    if (bad) return setError("Every target must be a whole number from 1 to 50.");
    if (!items.length) return setError("Tick at least one partner.");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data: out } = await apiClient.post("/api/admin/sales/targets/next-month", { items });
      setNotice(`${out.count} target${out.count === 1 ? "" : "s"} set for ${monthName(out.month, "long")}. Each partner has been told.`);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not approve the targets.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="m-0 flex items-center gap-1.5 text-sm font-bold text-neutral-900">
            <Target className="h-4 w-4" /> {data ? `${monthName(data.month, "long")} targets` : "Next month's targets"}
            {eatDay >= 25 ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">Ready to approve</span> : null}
          </h2>
          <p className="m-0 mt-0.5 text-xs text-neutral-500">
            Drafted from {data ? data.basedOn.map((m) => monthName(m)).reverse().join(", ") : "the last 3 months"}: average + 20%. Best approved after the 25th, when this month is nearly done.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a partner" aria-label="Find a partner" className="h-9 w-48 rounded-md border border-solid border-neutral-200 pl-7 pr-2 text-[13px] outline-none focus:border-emerald-400" />
          </label>
          <button type="button" onClick={() => void approve()} disabled={busy || loading || !chosen.length}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-3 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve {chosen.length} target{chosen.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
      {edited ? <p className="m-0 border-0 border-b border-solid border-neutral-100 bg-amber-50 px-4 py-2 text-[12px] text-amber-900">{edited} target{edited === 1 ? " differs" : "s differ"} from the suggestion. The audit log records each change.</p> : null}
      {error ? <p className="m-0 flex items-start gap-2 border-0 border-b border-solid border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
      {notice ? <p className="m-0 flex items-start gap-2 border-0 border-b border-solid border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

      {loading && !data ? (
        <div className="flex items-center gap-2 p-5 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
      ) : !rows.length ? (
        <p className="m-0 p-8 text-center text-sm text-neutral-500">{data?.partners.length ? "No partner matches that search." : "No active partners yet."}</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="sticky top-0 bg-neutral-50">
              <tr>
                <th className={`${th} w-10 pl-4`}><span className="sr-only">Include</span></th>
                <th className={th}>Partner</th>
                <th className={th}>Team</th>
                <th className={`${th} text-right`}>Last 3 months</th>
                <th className={`${th} text-right`}>Already set</th>
                <th className={`${th} pr-4 text-right`}>{data ? monthName(data.month) : "Next"} target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const on = !skip.has(p.partnerId);
                const v = values[p.partnerId] ?? "";
                const changed = Number(v) !== p.suggested;
                return (
                  <tr key={p.partnerId} className={`border-0 border-t border-solid border-neutral-100 ${on ? "" : "opacity-50"}`}>
                    <td className="py-2.5 pl-4 pr-2">
                      <input type="checkbox" checked={on} aria-label={`Include ${p.name}`} onChange={() => setSkip((prev) => { const next = new Set(prev); if (next.has(p.partnerId)) next.delete(p.partnerId); else next.add(p.partnerId); return next; })} />
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="m-0 text-[13px] font-semibold text-neutral-900">{p.name}</p>
                      <p className="m-0 text-[11px] text-neutral-500"><span className="font-mono">{p.agentCode}</span>{p.region ? ` · ${p.region}` : ""}</p>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-neutral-600">{p.team || "–"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] text-neutral-700">{[...p.history].reverse().join(" · ")}</td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-neutral-500">{p.current ? `${p.current.target} (${p.current.setBy === "ADMIN" ? "NoLSAF" : p.current.setBy === "TEAM_LEAD" ? "lead" : "default"})` : "–"}</td>
                    <td className="py-2.5 pl-3 pr-4 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {!changed ? <Sparkles className="h-3.5 w-3.5 text-emerald-600" aria-label="Suggested" /> : <button type="button" onClick={() => setValues((prev) => ({ ...prev, [p.partnerId]: String(p.suggested) }))} className="border-0 bg-transparent p-0 text-[11px] font-semibold text-emerald-700 hover:underline">use {p.suggested}</button>}
                        <input value={v} disabled={!on} inputMode="numeric" aria-label={`Target for ${p.name}`}
                          onChange={(e) => setValues((prev) => ({ ...prev, [p.partnerId]: e.target.value.replace(/\D/g, "").slice(0, 2) }))}
                          className={`h-8 w-14 rounded-md border border-solid px-2 text-right text-[13px] font-semibold tabular-nums outline-none focus:border-emerald-500 ${changed ? "border-amber-300 bg-amber-50" : "border-neutral-200"}`} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
