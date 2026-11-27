"use client";

/**
 * Sales regions and regional leads (docs/SALES_REGIONS.md): each region's
 * lead, override, partners, teams and this month's target against confirmed
 * homes; set the lead, the override (finance code) and the target; map
 * partners and teams that have no region yet.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, MapPinned, UserPlus, Users, Wand2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";

type Region = {
  code: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  overridePercent: number;
  lead: { code: string; name: string } | null;
  leadSince: string | null;
  partners: number;
  teams: number;
  month: string;
  target: number;
  targetSetByAdmin: boolean;
  confirmed: number;
};
type Payload = {
  month: string;
  regions: Region[];
  unassigned: { partners: Array<{ code: string; name: string; region: string | null; status: string }>; teams: Array<{ name: string; region: string | null; leadCode: string | null }> };
};
type View = "regions" | "unassigned";

/** Region, lead, people, target, chevron: the same grid for the header and every row. */
const ROW_GRID = "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_1.25rem] gap-5";

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "RL";
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}

const field = "h-9 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-[#02665e]";
const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-50";
const ghost = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";

export default function SalesRegionsPage() {
  const [view, setView] = useState<View>("regions");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await apiClient.get<Payload>("/api/admin/sales/regions");
      setData(payload);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not load regions.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const autoAssign = async () => {
    setBusy(true);
    try {
      const { data: r } = await apiClient.post("/api/admin/sales/regions/auto-assign");
      setNotice(`Matched ${r.partnersAssigned} partners and ${r.teamsAssigned} teams. ${r.partnersLeft + r.teamsLeft} still need a region.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not auto-assign.");
    } finally {
      setBusy(false);
    }
  };

  const assign = async (kind: "PARTNER" | "TEAM", code: string, region: string) => {
    try {
      await apiClient.post("/api/admin/sales/regions/assign", { kind, code, region });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not assign.");
    }
  };

  const regions = data?.regions ?? [];
  const unassigned = (data?.unassigned.partners.length ?? 0) + (data?.unassigned.teams.length ?? 0);
  const led = regions.filter((r) => r.lead).length;

  return (
    <div id="admin-sales-regions" className="w-full min-w-0">
      <style>{`#admin-sales-regions, #admin-sales-regions * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<View>
        title="Regions"
        description="Regional leads, their pay, and how each region tracks against its monthly target."
        metrics={[
          { label: "Regions led", value: data ? `${led} of ${regions.length}` : "-" },
          { label: "Without a region", value: data ? unassigned : "-", tone: unassigned ? "warn" : "default" },
        ]}
        onRefresh={() => void load()}
        loading={loading}
        tabs={[
          { key: "regions", label: "Regions", Icon: MapPinned },
          { key: "unassigned", label: "Without a region", Icon: Users, count: unassigned || undefined },
        ]}
        activeTab={view}
        onTab={setView}
      />
      {notice && <p role="status" className="m-0 mt-3 flex items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><CheckCircle2 className="size-4" aria-hidden />{notice}</p>}
      {error && <p role="alert" className="m-0 mt-3 rounded-md border border-solid border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading && !data ? (
        <p className="m-0 mt-3 flex min-h-32 items-center justify-center gap-2 rounded-lg border border-solid border-slate-200 bg-white text-sm text-slate-600"><Loader2 className="size-4 animate-spin" aria-hidden />Loading regions</p>
      ) : view === "regions" ? (
        <section className="mt-3 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
          <div className={`${ROW_GRID} border-0 border-b border-solid border-slate-100 bg-slate-50/70 px-5 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 max-lg:hidden`}>
            <span>Region</span><span>Regional lead</span><span>People</span><span>{data ? monthLabel(data.month) : "This month"}</span><span />
          </div>
          <ul className="m-0 list-none p-0">
            {regions.map((r) => {
              const progress = r.target ? Math.min(100, Math.round((r.confirmed / r.target) * 100)) : 0;
              const expanded = open === r.code;
              const empty = r.partners === 0 && r.teams === 0;
              return (
                <li key={r.code} className="border-0 border-b border-solid border-slate-100 last:border-b-0">
                  <button type="button" onClick={() => setOpen(expanded ? null : r.code)} aria-expanded={expanded} className={`${ROW_GRID} w-full cursor-pointer items-center border-0 px-5 py-3 text-left transition-colors max-lg:grid-cols-[minmax(0,1fr)_auto] ${expanded ? "bg-slate-50" : "bg-transparent hover:bg-slate-50"}`}>
                    {/* Region */}
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`grid h-9 w-11 shrink-0 place-items-center rounded-md font-mono text-[11px] font-bold tracking-wide ${empty ? "bg-slate-100 text-slate-400" : "bg-[#0b2420] text-emerald-300"}`}>{r.code}</span>
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-slate-900">{r.name}</p>
                        {r.status === "PAUSED" ? <p className="m-0 text-[11px] font-semibold text-amber-700">Paused</p> : <p className="m-0 text-[11px] text-slate-400">{r.overridePercent > 0 ? `${r.overridePercent}% override` : "No override set"}</p>}
                      </div>
                    </div>

                    {/* Lead */}
                    <div className="flex min-w-0 items-center gap-2 max-lg:hidden">
                      {r.lead ? (
                        <>
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-800">{initialsOf(r.lead.name)}</span>
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm text-slate-800">{r.lead.name}</p>
                            <p className="m-0 font-mono text-[11px] text-slate-400">{r.lead.code}</p>
                          </div>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><UserPlus className="h-3.5 w-3.5" aria-hidden /> Not appointed</span>
                      )}
                    </div>

                    {/* People */}
                    <p className="m-0 text-xs text-slate-500 max-lg:hidden">
                      {empty ? <span className="text-slate-400">No one assigned</span> : <><span className="font-semibold tabular-nums text-slate-900">{r.partners}</span> partners <span className="text-slate-300">·</span> <span className="font-semibold tabular-nums text-slate-900">{r.teams}</span> teams</>}
                    </p>

                    {/* Target */}
                    <div className="min-w-0 max-lg:hidden">
                      {r.target > 0 ? (
                        <>
                          <p className="m-0 flex items-baseline justify-between gap-2 text-xs">
                            <span className="tabular-nums text-slate-500"><span className="font-semibold text-slate-900">{r.confirmed}</span> / {r.target} homes</span>
                            <span className={`font-semibold tabular-nums ${progress >= 100 ? "text-emerald-700" : "text-slate-400"}`}>{progress}%</span>
                          </p>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${progress >= 100 ? "bg-emerald-500" : "bg-[#02665e]"}`} style={{ width: `${progress}%` }} /></div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">No target yet</span>
                      )}
                    </div>

                    <ChevronDown className={`h-4 w-4 justify-self-end text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {expanded && <RegionEditor region={r} onSaved={(message) => { setNotice(message); void load(); }} onError={setError} />}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="mt-3 rounded-lg border border-solid border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-slate-600">Match partners and teams by the region they typed. Anything unclear stays here for you to choose.</p>
            <button type="button" onClick={() => void autoAssign()} disabled={busy} className={btn}>{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wand2 className="size-4" aria-hidden />}Auto-assign</button>
          </div>
          {[
            ...(data?.unassigned.teams ?? []).filter((t) => t.leadCode).map((t) => ({ kind: "TEAM" as const, code: t.leadCode!, title: `Team: ${t.name}`, typed: t.region })),
            ...(data?.unassigned.partners ?? []).map((p) => ({ kind: "PARTNER" as const, code: p.code, title: `${p.name} (${p.code})`, typed: p.region })),
          ].map((item) => (
            <div key={`${item.kind}-${item.code}`} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 pt-3">
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="m-0 text-xs text-slate-500">Typed region: {item.typed || "none"}</p>
              </div>
              <select defaultValue="" onChange={(e) => e.target.value && void assign(item.kind, item.code, e.target.value)} className={`${field} max-w-[16rem]`} aria-label={`Region for ${item.title}`}>
                <option value="" disabled>Choose a region</option>
                {regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
            </div>
          ))}
          {unassigned === 0 && <p className="m-0 mt-4 text-sm text-slate-500">Every partner and team has a region.</p>}
        </section>
      )}
    </div>
  );
}

function RegionEditor({ region: r, onSaved, onError }: { region: Region; onSaved: (message: string) => void; onError: (message: string) => void }) {
  const [leadCode, setLeadCode] = useState(r.lead?.code ?? "");
  const [percent, setPercent] = useState(String(r.overridePercent));
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState(r.targetSetByAdmin ? String(r.target) : "");
  const [busy, setBusy] = useState("");

  const run = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await fn();
      onSaved(message);
    } catch (e: any) {
      if (e?.response?.status === 403 && e?.response?.data?.require2fa) {
        window.dispatchEvent(new CustomEvent("finance-grant-required"));
        onError("Verify with your finance code, then save the override again.");
      } else onError(e?.response?.data?.error || "Could not save.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="grid gap-4 border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-5 py-4 md:grid-cols-3">
      <div>
        <label className="text-xs font-semibold text-slate-700" htmlFor={`lead-${r.code}`}>Regional lead</label>
        <input id={`lead-${r.code}`} value={leadCode} onChange={(e) => setLeadCode(e.target.value.toUpperCase())} placeholder="NSA-DAR-0042" className={`${field} mt-1 font-mono`} />
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={Boolean(busy) || !leadCode.trim()} onClick={() => void run("lead", () => apiClient.patch(`/api/admin/sales/regions/${r.code}`, { leadCode: leadCode.trim() }), "Regional lead saved. They were told.")} className={btn}>Save lead</button>
          {r.lead && <button type="button" disabled={Boolean(busy)} onClick={() => void run("lead", () => apiClient.patch(`/api/admin/sales/regions/${r.code}`, { leadCode: null }), "Regional lead removed.")} className={ghost}>Remove</button>}
        </div>
        <p className="m-0 mt-1.5 text-[11px] text-slate-500">An active partner with a current contract, leading one region only.</p>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-700" htmlFor={`pct-${r.code}`}>Override on partners&apos; commission (%)</label>
        <input id={`pct-${r.code}`} type="number" min={0} max={20} step={0.5} value={percent} onChange={(e) => setPercent(e.target.value)} className={`${field} mt-1`} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change" maxLength={300} className={`${field} mt-2`} />
        <button type="button" disabled={Boolean(busy) || reason.trim().length < 5} onClick={() => void run("pct", () => apiClient.put(`/api/admin/sales/regions/${r.code}/override`, { percent: Number(percent), reason }), "Override saved.")} className={`${btn} mt-2`}>Save override</button>
        <p className="m-0 mt-1.5 text-[11px] text-slate-500">Paid to the lead on each region partner&apos;s earnings, never their own. Needs the finance code.</p>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-700" htmlFor={`tgt-${r.code}`}>Target for {r.month} (homes)</label>
        <input id={`tgt-${r.code}`} type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={`${r.target} from partners' targets`} className={`${field} mt-1`} />
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={Boolean(busy) || !Number(target)} onClick={() => void run("tgt", () => apiClient.put(`/api/admin/sales/regions/${r.code}/target`, { month: r.month, target: Number(target) }), "Target saved.")} className={btn}>Save target</button>
          {r.targetSetByAdmin && <button type="button" disabled={Boolean(busy)} onClick={() => void run("tgt", () => apiClient.put(`/api/admin/sales/regions/${r.code}/target`, { month: r.month, target: null }), "Target back to partners' total.")} className={ghost}>Use partners&apos; total</button>}
        </div>
        <p className="m-0 mt-1.5 text-[11px] text-slate-500">Leave empty to use the sum of the partners&apos; own targets.</p>
      </div>
    </div>
  );
}
