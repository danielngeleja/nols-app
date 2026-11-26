"use client";

/**
 * My region: for Regional leads only (docs/SALES_REGIONS.md; the server checks
 * on every request). The region's target and progress, its teams and
 * partners, and what is waiting for NoLSAF, which the lead can recommend but
 * never approve. Partners are shown by agent code; no database ids.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MapPinned, ThumbsUp } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import RegionVisitRequests from "@/components/sales/RegionVisitRequests";

type Dashboard = {
  region: { code: string; name: string; overridePercent: number; leadSince: string | null };
  month: string;
  target: { target: number; setByAdmin: boolean; confirmed: number };
  summary: { partners: number; teams: number; earnedThisMonth: number; yourOverride: number; inspections: { passed: number; failed: number }; ownerObjections: number };
  teams: Array<{ name: string; lead: string; label: "STRONG" | "STEADY" | "NEEDS_SUPPORT" | "AT_RISK"; members: number; reasons: string[]; points: number }>;
  partners: Array<{ code: string; name: string; status: string; paused: boolean; isLead: boolean; points: number; confirmed: number; visits: number; denials: number; earned: number }>;
  waiting: {
    longStayRequests: Array<{ ref: string; partner: string; reason: string; createdAt: string; recommended: boolean }>;
    firstPayouts: Array<{ ref: string; partner: string; amount: number; currency: string; requestedAt: string; recommended: boolean }>;
  };
};

const NF = new Intl.NumberFormat("en-US");
const tzs = (v: number) => `TZS ${NF.format(Math.round(v || 0))}`;
const th = "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const HEALTH: Record<string, { label: string; tone: string }> = {
  STRONG: { label: "Strong", tone: "bg-emerald-50 text-emerald-800" },
  STEADY: { label: "Steady", tone: "bg-slate-100 text-slate-700" },
  NEEDS_SUPPORT: { label: "Needs support", tone: "bg-amber-50 text-amber-800" },
  AT_RISK: { label: "At risk", tone: "bg-rose-50 text-rose-700" },
};

function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
function eatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" });
}

export default function SalesRegionPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: d } = await apiClient.get<Dashboard>("/api/sales/region");
      setData(d);
      setError("");
    } catch (e: any) {
      setError(e?.response?.status === 404 ? "My region is for Regional leads." : e?.response?.data?.error || "Could not load your region.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const recommend = async (type: "LONG_STAY_REQUEST" | "SALES_PAYOUT", ref: string) => {
    setBusy(ref);
    setNotice("");
    try {
      await apiClient.post("/api/sales/region/recommendations", { type, ref });
      setNotice("Recommendation sent. NoLSAF still makes the decision.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not send the recommendation.");
    } finally {
      setBusy("");
    }
  };

  const progress = data && data.target.target ? Math.min(100, Math.round((data.target.confirmed / data.target.target) * 100)) : 0;
  const waitingCount = (data?.waiting.longStayRequests.length ?? 0) + (data?.waiting.firstPayouts.length ?? 0);

  return (
    <SalesShell>
      <div id="sales-region" className="w-full min-w-0">
        <style>{`#sales-region, #sales-region * { box-sizing: border-box; }`}</style>
        <SalesPageHeader icon={MapPinned} title={data?.region.name || "My region"} description="Your region's teams and partners, its target, and what is waiting for NoLSAF. You coach and recommend; NoLSAF approves." />

        {error && <p className="m-0 mt-4 flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        {notice && <p className="m-0 mt-4 flex items-start gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}

        {loading ? (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-solid border-slate-200 bg-white p-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
        ) : data ? (
          <>
            <section className="mt-5 grid gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-white px-4 py-3.5">
                <p className="m-0 text-xs text-slate-500">{monthName(data.month)} target</p>
                <p className="m-0 mt-1 text-xl font-bold tabular-nums text-slate-900">{data.target.confirmed} <span className="text-sm font-medium text-slate-400">of {data.target.target} homes</span></p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-[#02665e]" style={{ width: `${progress}%` }} /></div>
              </div>
              <div className="bg-white px-4 py-3.5">
                <p className="m-0 text-xs text-slate-500">People</p>
                <p className="m-0 mt-1 text-xl font-bold tabular-nums text-slate-900">{data.summary.partners} <span className="text-sm font-medium text-slate-400">partners · {data.summary.teams} teams</span></p>
              </div>
              <div className="bg-white px-4 py-3.5">
                <p className="m-0 text-xs text-slate-500">Quality this month</p>
                <p className="m-0 mt-1 text-sm text-slate-700">
                  Inspections <span className="font-semibold text-emerald-700">{data.summary.inspections.passed} passed</span>, <span className="font-semibold text-slate-900">{data.summary.inspections.failed} failed</span>
                </p>
                <p className={`m-0 text-sm ${data.summary.ownerObjections ? "font-semibold text-rose-700" : "text-slate-500"}`}>{data.summary.ownerObjections} owner {data.summary.ownerObjections === 1 ? "query" : "queries"}</p>
              </div>
              <div className="bg-white px-4 py-3.5">
                <p className="m-0 text-xs text-slate-500">Region earned this month</p>
                <p className="m-0 mt-1 text-xl font-bold tabular-nums text-slate-900">{tzs(data.summary.earnedThisMonth)}</p>
                <p className="m-0 text-xs text-slate-500">Your override ({data.region.overridePercent}%): <span className="font-semibold text-emerald-700">{tzs(data.summary.yourOverride)}</span></p>
              </div>
            </section>

            {waitingCount > 0 && (
              <section className="mt-5 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
                <div className="border-0 border-b border-solid border-slate-100 px-4 py-3">
                  <h2 className="m-0 text-sm font-bold text-slate-900">Waiting for NoLSAF</h2>
                  <p className="m-0 mt-0.5 text-xs text-slate-500">Recommend what you know is right. NoLSAF sees your recommendation and decides.</p>
                </div>
                <ul className="m-0 list-none p-0">
                  {data.waiting.longStayRequests.map((r) => (
                    <WaitingRow key={r.ref} title={`Long stay for ${r.partner}'s owner`} detail={`"${r.reason}" · ${eatDay(r.createdAt)}`} recommended={r.recommended} busy={busy === r.ref} onRecommend={() => void recommend("LONG_STAY_REQUEST", r.ref)} />
                  ))}
                  {data.waiting.firstPayouts.map((p) => (
                    <WaitingRow key={p.ref} title={`${p.partner}'s first withdrawal`} detail={`${p.currency} ${NF.format(p.amount)} · ${eatDay(p.requestedAt)}`} recommended={p.recommended} busy={busy === p.ref} onRecommend={() => void recommend("SALES_PAYOUT", p.ref)} />
                  ))}
                </ul>
              </section>
            )}

            <RegionVisitRequests />

            <section className="mt-5 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
              <h2 className="m-0 border-0 border-b border-solid border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">Teams</h2>
              {data.teams.length === 0 ? <p className="m-0 px-4 py-6 text-sm text-slate-500">No teams in your region yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50"><tr><th className={th}>Team</th><th className={th}>Lead</th><th className={th}>Health</th><th className={`${th} text-right`}>Members</th><th className={`${th} text-right`}>Points</th><th className={th}>Why</th></tr></thead>
                    <tbody>
                      {data.teams.map((t) => (
                        <tr key={t.name} className="border-0 border-t border-solid border-slate-100">
                          <td className="px-3 py-2.5 font-semibold text-slate-900">{t.name}</td>
                          <td className="px-3 py-2.5 text-slate-700">{t.lead}</td>
                          <td className="px-3 py-2.5"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${HEALTH[t.label].tone}`}>{HEALTH[t.label].label}</span></td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{t.members}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{t.points}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-500">{t.reasons[0] ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mt-5 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
              <h2 className="m-0 border-0 border-b border-solid border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">Partners</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50"><tr><th className={th}>Partner</th><th className={`${th} text-right`}>Points</th><th className={`${th} text-right`}>Homes confirmed</th><th className={`${th} text-right`}>Visits</th><th className={`${th} text-right`}>Owner denials</th><th className={`${th} text-right`}>Earned</th></tr></thead>
                  <tbody>
                    {data.partners.map((p) => (
                      <tr key={p.code} className="border-0 border-t border-solid border-slate-100">
                        <td className="px-3 py-2.5">
                          <p className="m-0 font-semibold text-slate-900">{p.name}{p.isLead && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">You</span>}</p>
                          <p className="m-0 font-mono text-[11px] text-slate-500">{p.code}{p.status !== "ACTIVE" ? ` · ${p.status.toLowerCase()}` : ""}{p.paused ? " · withdrawals paused" : ""}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.points}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.confirmed}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.visits}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${p.denials ? "font-semibold text-rose-700" : ""}`}>{p.denials}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{tzs(p.earned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </SalesShell>
  );
}

function WaitingRow({ title, detail, recommended, busy, onRecommend }: { title: string; detail: string; recommended: boolean; busy: boolean; onRecommend: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 px-4 py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold text-slate-900">{title}</p>
        <p className="m-0 truncate text-xs text-slate-500">{detail}</p>
      </div>
      {recommended ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Recommended</span>
      ) : (
        <button type="button" disabled={busy} onClick={onRecommend} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" />} Recommend
        </button>
      )}
    </li>
  );
}
