"use client";

/**
 * Channels (docs/CHANNEL_ATTRIBUTION.md): which marketing channel brought each
 * stay, tour and long stay, how many paid, the money collected and NoLSAF's
 * take. Behind the finance code like All Revenue, because it shows revenue.
 */
import { useCallback, useEffect, useState } from "react";
import { Globe, KeyRound, Link2, Loader2, Lock, Megaphone, QrCode, RefreshCw, Search, Share2, UserRound, HelpCircle, Repeat } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Period = "7" | "30" | "90" | "365";
type Row = {
  channel: string;
  created: number;
  paid: number;
  collectedTzs: number;
  nolsafTakeTzs: number;
  partnerCostTzs: number;
  byStream: Record<"stays" | "tours" | "longStays", { created: number; paid: number }>;
  topSources: Array<{ source: string; paid: number }>;
};
type Report = {
  from: string;
  to: string;
  channels: Row[];
  total: { created: number; paid: number; collectedTzs: number; nolsafTakeTzs: number };
  migrationNeeded: boolean;
  truncated: boolean;
};

const META: Record<string, { label: string; hint: string; Icon: typeof Search }> = {
  SEARCH: { label: "Search", hint: "Google and other search engines", Icon: Search },
  SOCIAL: { label: "Social", hint: "Facebook, Instagram, WhatsApp, TikTok", Icon: Share2 },
  CAMPAIGN: { label: "Campaigns", hint: "Links with utm tags or Google ads", Icon: Megaphone },
  QR: { label: "QR codes", hint: "Certificates, sales cards, printed codes", Icon: QrCode },
  PARTNER_LINK: { label: "Partner links", hint: "Agency Desk links, server-verified", Icon: Link2 },
  REFERRAL: { label: "Other websites", hint: "Links from other sites", Icon: Globe },
  DIRECT: { label: "Direct", hint: "Typed address, bookmarks, apps", Icon: Repeat },
  NOT_RECORDED: { label: "Not recorded", hint: "No marketing consent, app, or older", Icon: HelpCircle },
};
const NF = new Intl.NumberFormat("en-US");
const tzs = (v: number) => `TZS ${NF.format(Math.round(v || 0))}`;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "-");

/** One colour per channel on the dark band; "Not recorded" stays a quiet track. */
const SWATCH: Record<string, string> = {
  SEARCH: "bg-sky-400",
  SOCIAL: "bg-violet-400",
  CAMPAIGN: "bg-amber-400",
  QR: "bg-emerald-400",
  PARTNER_LINK: "bg-teal-300",
  REFERRAL: "bg-rose-300",
  DIRECT: "bg-slate-300",
  NOT_RECORDED: "bg-white/15",
};
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "7", label: "7d" },
  { key: "30", label: "30d" },
  { key: "90", label: "90d" },
  { key: "365", label: "12m" },
];

function compactTzs(v: number) {
  const x = Math.round(v || 0);
  if (x >= 1_000_000_000) return `${(x / 1_000_000_000).toFixed(x >= 10_000_000_000 ? 0 : 1)}B`;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(x >= 10_000_000 ? 0 : 1)}M`;
  if (x >= 10_000) return `${Math.round(x / 1_000)}K`;
  return NF.format(x);
}

function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * The page's dark band: the period's result in one line, then where the
 * bookings came from as a single mix bar, then how much of it is tracked.
 */
function ChannelsHero({ data, period, onPeriod, loading, onRefresh, known }: {
  data: Report | null; period: Period; onPeriod: (p: Period) => void; loading: boolean; onRefresh: () => void; known: number;
}) {
  const total = data?.total.created ?? 0;
  const mix = (data?.channels ?? []).filter((r) => r.created > 0).sort((a, b) => (a.channel === "NOT_RECORDED" ? 1 : b.channel === "NOT_RECORDED" ? -1 : b.created - a.created));
  const coverage = total ? Math.round((known / total) * 100) : 0;
  const conversion = total ? Math.round(((data?.total.paid ?? 0) / total) * 100) : 0;

  return (
    <header className="rounded-lg border border-solid border-[#12342f] bg-[#0b2420] px-4 pb-4 pt-4 text-white sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-semibold text-emerald-300/80">Growth</p>
          <h1 className="m-0 mt-0.5 text-xl font-bold tracking-tight">Channels</h1>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Period" className="flex rounded-md border border-solid border-white/15 bg-white/[0.04] p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={period === p.key}
                onClick={() => onPeriod(p.key)}
                className={`h-7 cursor-pointer rounded border-0 px-2.5 text-xs font-semibold [font-family:inherit] transition-colors ${period === p.key ? "bg-emerald-400 text-[#06201b]" : "bg-transparent text-white/55 hover:text-white"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh" className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-white/15 bg-white/[0.04] text-white/70 hover:text-white disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,12rem)] lg:items-end">
        {/* The result */}
        <div className="min-w-0">
          <p className="m-0 text-[11px] text-white/50">NoLSAF take{data ? ` · ${fmtDay(data.from)} to ${fmtDay(data.to)}` : ""}</p>
          <p className="m-0 mt-1 flex items-baseline gap-1.5 leading-none" title={data ? tzs(data.total.nolsafTakeTzs) : undefined}>
            <span className="text-[34px] font-bold tabular-nums tracking-tight">{data ? compactTzs(data.total.nolsafTakeTzs) : "-"}</span>
            <span className="text-sm font-medium text-white/40">TZS</span>
          </p>
          <p className="m-0 mt-2 text-xs text-white/55">
            <span className="font-semibold text-white">{NF.format(data?.total.paid ?? 0)}</span> paid of {NF.format(total)} {total === 1 ? "booking" : "bookings"}
            {total ? <> · <span className="font-semibold text-white">{conversion}%</span> convert</> : null}
          </p>
        </div>

        {/* Where they came from */}
        <div className="min-w-0">
          <p className="m-0 text-[11px] text-white/50">Where bookings came from</p>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
            {mix.map((r) => (
              <div key={r.channel} className={`${SWATCH[r.channel] ?? "bg-white/30"} border-0 border-r border-solid border-[#0b2420] last:border-r-0`} style={{ width: `${(r.created / total) * 100}%` }} title={`${META[r.channel]?.label ?? r.channel}: ${r.created}`} />
            ))}
          </div>
          <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-xs">
            {mix.length === 0 ? (
              <li className="text-white/40">No bookings in this period yet</li>
            ) : mix.map((r) => (
              <li key={r.channel} className={`flex items-center gap-1.5 ${r.channel === "NOT_RECORDED" ? "text-white/40" : "text-white/75"}`}>
                <span className={`h-2 w-2 rounded-sm ${SWATCH[r.channel] ?? "bg-white/30"}`} aria-hidden />
                {META[r.channel]?.label ?? r.channel}
                <span className="font-semibold tabular-nums text-white">{Math.round((r.created / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>

        {/* How much is tracked */}
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(#34d399 ${coverage * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
            aria-hidden
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0b2420] text-[11px] font-bold tabular-nums">{data ? `${coverage}%` : "-"}</span>
          </span>
          <div className="min-w-0">
            <p className="m-0 text-xs font-semibold">Source known</p>
            <p className="m-0 mt-0.5 text-[11px] leading-4 text-white/45">
              {!data ? "" : coverage >= 60 ? "Enough to compare channels" : "Grows as visitors allow marketing cookies"}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

function eatDay(offsetDays: number) {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(d);
}

export default function ChannelsPage() {
  const [period, setPeriod] = useState<Period>("30");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError("");
    try {
      const { data: report } = await apiClient.get<Report>("/api/admin/finance/channels", { params: { from: eatDay(Number(p) - 1), to: eatDay(0) } });
      setData(report);
      setLocked(false);
    } catch (e: any) {
      if (e?.response?.status === 403 && e?.response?.data?.require2fa) {
        setData(null);
        setLocked(true);
      } else setError(e?.response?.data?.error || "Could not load the channels report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(period); }, [load, period]);
  useEffect(() => {
    const onGranted = () => { void load(period); };
    window.addEventListener("finance-grant-granted", onGranted);
    return () => window.removeEventListener("finance-grant-granted", onGranted);
  }, [load, period]);

  const rows = (data?.channels ?? []).filter((r) => r.created > 0 || r.channel !== "NOT_RECORDED").sort((a, b) => b.nolsafTakeTzs - a.nolsafTakeTzs || b.created - a.created);
  const known = data ? data.total.created - (data.channels.find((r) => r.channel === "NOT_RECORDED")?.created ?? 0) : 0;
  const best = rows.filter((r) => r.channel !== "NOT_RECORDED" && r.paid > 0)[0];

  return (
    <div id="admin-channels" className="w-full min-w-0">
      <style>{`#admin-channels, #admin-channels * { box-sizing: border-box; }`}</style>
      <ChannelsHero data={data} period={period} onPeriod={setPeriod} loading={loading} onRefresh={() => void load(period)} known={known} />

      {locked ? (
        <section className="mt-3 grid place-items-center rounded-lg border border-solid border-slate-200 bg-white px-4 py-12 text-center">
          <Lock className="h-6 w-6 text-[#02665e]" aria-hidden />
          <p className="m-0 mt-2 text-sm font-semibold text-slate-900">Revenue by channel is protected</p>
          <p className="m-0 mt-1 text-xs text-slate-500">Verify with your finance code. Access lasts 15 minutes.</p>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("finance-grant-required"))} className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47]">
            <KeyRound className="h-4 w-4" aria-hidden /> Verify to view
          </button>
        </section>
      ) : (
        <>
          {data?.migrationNeeded && <p className="m-0 mt-3 rounded-md border border-solid border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Source tracking needs a database update before new bookings are recorded. Partner links already show.</p>}
          {data?.truncated && <p className="m-0 mt-3 rounded-md border border-solid border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Very busy period: only the first 20,000 records of each kind are counted. Choose a shorter range for exact figures.</p>}
          {best && <p className="m-0 mt-3 text-sm text-slate-700"><span className="font-semibold text-slate-900">{META[best.channel]?.label}</span> earned the most in this period: {tzs(best.nolsafTakeTzs)} from {best.paid} paid {best.paid === 1 ? "booking" : "bookings"}.</p>}

          <section aria-busy={loading} className="mt-3 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            {loading && !data ? (
              <p role="status" className="m-0 flex min-h-32 items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="size-4 animate-spin" aria-hidden />Loading channels</p>
            ) : error ? (
              <p role="alert" className="m-0 px-4 py-6 text-sm text-red-700">{error}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-0 border-b border-solid border-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2.5 pl-5">Channel</th>
                      <th className="px-3 py-2.5 text-right">Bookings</th>
                      <th className="px-3 py-2.5 text-right">Paid</th>
                      <th className="px-3 py-2.5 text-right">Conversion</th>
                      <th className="px-3 py-2.5 text-right">Collected</th>
                      <th className="px-3 py-2.5 text-right">NoLSAF take</th>
                      <th className="px-3 py-2.5 text-right">Partner cost</th>
                      <th className="px-3 py-2.5 pr-5">Top sources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const meta = META[r.channel] ?? { label: r.channel, hint: "", Icon: UserRound };
                      const quiet = r.created === 0;
                      return (
                        <tr key={r.channel} className={`border-0 border-b border-solid border-slate-100 ${quiet ? "text-slate-400" : "text-slate-800"}`}>
                          <td className="px-3 py-3 pl-5">
                            <div className="flex items-center gap-2.5">
                              <span className={`grid size-7 shrink-0 place-items-center rounded-md ${quiet ? "bg-slate-50 text-slate-300" : "bg-[#edf6f2] text-[#02665e]"}`}><meta.Icon className="size-3.5" aria-hidden /></span>
                              <div className="min-w-0">
                                <p className="m-0 font-semibold">{meta.label}</p>
                                <p className="m-0 truncate text-[11px] text-slate-400">{meta.hint}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums" title={`Stays ${r.byStream.stays.created}, tours ${r.byStream.tours.created}, long stays ${r.byStream.longStays.created}`}>{NF.format(r.created)}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{NF.format(r.paid)}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{pct(r.paid, r.created)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{r.paid ? tzs(r.collectedTzs) : "-"}</td>
                          <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${r.nolsafTakeTzs ? "text-emerald-700" : ""}`}>{r.paid ? tzs(r.nolsafTakeTzs) : "-"}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{r.partnerCostTzs ? tzs(r.partnerCostTzs) : "-"}</td>
                          <td className="px-3 py-3 pr-5 text-[11px] text-slate-500">{r.topSources.length ? r.topSources.map((s) => `${s.source} (${s.paid})`).join(", ") : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="m-0 mt-2 text-[11px] leading-4 text-slate-500">
            Credit goes to the visitor&apos;s first visit in the 30 days before booking, recorded only when they allow marketing cookies. Partner links are always counted from their own server records. Advertising spend is not in NoLSAF yet, so only partner cost is shown.
          </p>
        </>
      )}
    </div>
  );
}
