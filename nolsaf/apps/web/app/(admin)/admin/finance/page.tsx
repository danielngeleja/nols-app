"use client";

// "Mother of all revenue" — a single, READ-ONLY view that rolls up every
// NoLSAF revenue stream (accommodation, tours, transport, group stay,
// subscriptions) into one set of KPIs. It does not collect or mutate anything;
// each stream is still owned by its own page. Source: GET /api/admin/finance/overview.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  TrendingUp,
  HandCoins,
  Hourglass,
  Building2,
  Map as MapIcon,
  Car,
  Users,
  CreditCard,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type StreamKey = "accommodation" | "tours" | "transport" | "groupStay" | "subscriptions";

type StreamSummary = {
  key: StreamKey;
  label: string;
  gmv: number;
  nolsafRevenue: number;
  partnerNet: number;
  realizedCount: number;
  pendingRevenue: number;
  pendingCount: number;
  note?: string;
};

type Overview = {
  ok: boolean;
  baseCurrency: string;
  range: { from: string | null; to: string | null; allTime: boolean };
  totals: {
    gmv: number;
    nolsafRevenue: number;
    partnerNet: number;
    realizedCount: number;
    pendingRevenue: number;
    pendingCount: number;
  };
  streams: StreamSummary[];
  generatedAt: string;
};

const STREAM_META: Record<StreamKey, { icon: any; tone: string; accent: string; bar: string; href: string | null }> = {
  accommodation: { icon: Building2, tone: "text-emerald-300", accent: "16,185,129", bar: "#34d399", href: "/admin/revenue" },
  tours: { icon: MapIcon, tone: "text-sky-300", accent: "56,189,248", bar: "#38bdf8", href: "/admin/agents/tour-revenue" },
  transport: { icon: Car, tone: "text-amber-300", accent: "251,191,36", bar: "#fbbf24", href: "/admin/drivers/invoices" },
  groupStay: { icon: Users, tone: "text-violet-300", accent: "167,139,250", bar: "#a78bfa", href: "/admin/group-stays/revenue" },
  subscriptions: { icon: CreditCard, tone: "text-teal-300", accent: "45,212,191", bar: "#2dd4bf", href: "/admin/nrms/billing" },
};

export default function AdminFinancePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get("/api/admin/finance/overview");
        if (!cancelled) setData(res.data as Overview);
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.error || e?.message || "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fmt = useMemo(() => {
    const cur = data?.baseCurrency || "TZS";
    const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
    return (v: number) => `${cur} ${nf.format(Math.round(v || 0))}`;
  }, [data?.baseCurrency]);

  const loading = data === null && !error;
  const totals = data?.totals;
  const takeRate = totals && totals.gmv > 0 ? (totals.nolsafRevenue / totals.gmv) * 100 : null;
  const sortedStreams = useMemo(
    () => [...(data?.streams || [])].sort((a, b) => b.nolsafRevenue - a.nolsafRevenue),
    [data?.streams],
  );
  const maxRev = useMemo(() => Math.max(1, ...sortedStreams.map((s) => s.nolsafRevenue)), [sortedStreams]);

  return (
    <div className="box-border w-full max-w-full min-w-0 overflow-x-clip bg-[#070B1C] text-slate-100">
      <div className="relative mx-auto box-border w-full max-w-full min-w-0 space-y-4 overflow-x-clip px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 lg:px-6 xl:px-8">
        {/* Header */}
        <div
          className="relative w-full max-w-full overflow-hidden rounded-[28px] shadow-2xl"
          style={{
            background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)",
            boxShadow: "0 22px 55px -20px rgba(2,102,94,0.45)",
          }}
        >
          <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)", backgroundSize: "26px 26px" }} aria-hidden />
          <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-emerald-300/10 blur-3xl" aria-hidden />

          <div className="relative z-10 flex flex-col items-center px-5 py-9 text-center sm:px-8 sm:py-12">
            <div className="relative mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-[0_0_0_8px_rgba(255,255,255,0.05)] backdrop-blur-sm">
              <span className="absolute inset-0 rounded-2xl bg-white/10 blur-md" aria-hidden />
              <Wallet className="relative h-7 w-7 text-white" aria-hidden />
            </div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
              <span>Finance overview</span>
              {data && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_6px_2px_rgba(110,231,183,0.5)]" />
                  {data.range.allTime ? "All time" : "Filtered range"}
                </span>
              )}
            </div>
            <h1 className="mt-3 text-[28px] font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
              NoLSAF Revenue <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-sky-200 bg-clip-text text-transparent">across all streams</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
              GMV and NoLSAF revenue rolled up across accommodation, tours, transport, group stay and subscriptions.
              Read only. Each stream stays managed on its own page.
            </p>
            {takeRate !== null && (
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-xs font-bold text-white/80 backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                {takeRate.toFixed(1)}% blended take rate across GMV
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            Couldn't load finance overview: {error}
          </div>
        )}

        {/* Hero KPIs */}
        <div className="grid w-full max-w-full grid-cols-12 gap-4">
          <HeroCard
            className="col-span-12 sm:col-span-6 xl:col-span-3"
            label="NoLSAF revenue"
            sublabel="Realized platform take"
            icon={TrendingUp}
            glow="rgba(52,211,153,0.16)"
            border="border-emerald-400/20"
            iconTone="text-emerald-300"
            currency={data?.baseCurrency || "TZS"}
            value={totals ? totals.nolsafRevenue : null}
            loading={loading}
            badge={takeRate !== null ? `${takeRate.toFixed(1)}% of GMV` : undefined}
          />
          <HeroCard
            className="col-span-12 sm:col-span-6 xl:col-span-3"
            label="Total GMV"
            sublabel="Gross value transacted"
            icon={Wallet}
            glow="rgba(56,189,248,0.16)"
            border="border-sky-400/20"
            iconTone="text-sky-300"
            currency={data?.baseCurrency || "TZS"}
            value={totals ? totals.gmv : null}
            loading={loading}
          />
          <HeroCard
            className="col-span-12 sm:col-span-6 xl:col-span-3"
            label="Paid to partners"
            sublabel="Owners, operators, drivers"
            icon={HandCoins}
            glow="rgba(167,139,250,0.16)"
            border="border-violet-400/20"
            iconTone="text-violet-300"
            currency={data?.baseCurrency || "TZS"}
            value={totals ? totals.partnerNet : null}
            loading={loading}
          />
          <HeroCard
            className="col-span-12 sm:col-span-6 xl:col-span-3"
            label="Pending revenue"
            sublabel={totals ? `${totals.pendingCount} in pipeline` : "In pipeline"}
            icon={Hourglass}
            glow="rgba(251,191,36,0.16)"
            border="border-amber-400/20"
            iconTone="text-amber-300"
            currency={data?.baseCurrency || "TZS"}
            value={totals ? totals.pendingRevenue : null}
            loading={loading}
          />
        </div>

        {/* Per-stream breakdown */}
        <section className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
          <div className="flex items-center justify-between border-b border-white/10 p-5 sm:p-6">
            <div>
              <div className="text-sm font-semibold text-white">Revenue by stream</div>
              <div className="text-xs text-slate-400">Ranked by NoLSAF take (realized)</div>
            </div>
            {!loading && sortedStreams.length > 0 && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{sortedStreams.length} streams</span>
            )}
          </div>

          <div className="p-3 sm:p-4">
            {loading ? (
              <ul className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
                ))}
              </ul>
            ) : (
              <ul className="space-y-2">
                {sortedStreams.map((s, index) => {
                  const meta = STREAM_META[s.key];
                  const Icon = meta.icon;
                  const share = totals && totals.nolsafRevenue > 0 ? s.nolsafRevenue / totals.nolsafRevenue : 0;
                  const barPct = Math.round((s.nolsafRevenue / maxRev) * 100);
                  const inner = (
                    <div className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-transparent px-4 py-3.5 transition-colors hover:border-white/10 hover:bg-white/[0.05]">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[11px] font-black text-slate-400">{index + 1}</span>
                      <div
                        className={`relative shrink-0 rounded-xl border border-white/10 p-2.5 ${meta.tone}`}
                        style={{ background: `radial-gradient(circle at 30% 30%, rgba(${meta.accent},0.22), rgba(255,255,255,0.04))` }}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{s.label}</span>
                            {meta.href && <ExternalLink className="h-3.5 w-3.5 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />}
                          </div>
                          <span className="text-sm font-bold tabular-nums text-white">{fmt(s.nolsafRevenue)}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${barPct}%`, background: `linear-gradient(90deg, ${meta.bar}, rgba(255,255,255,0.35))` }}
                          />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-slate-400">
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>GMV {fmt(s.gmv)}</span>
                            <span>{s.realizedCount} transactions</span>
                            {s.pendingRevenue > 0 ? <span>{fmt(s.pendingRevenue)} pending</span> : null}
                          </span>
                          <span className="font-bold tabular-nums" style={{ color: meta.bar }}>{Math.round(share * 100)}% of revenue</span>
                        </div>
                        {s.note && <div className="mt-1 text-[11px] text-slate-500">{s.note}</div>}
                      </div>
                    </div>
                  );
                  return (
                    <li key={s.key}>
                      {meta.href ? (
                        <Link href={meta.href} className="block no-underline">
                          {inner}
                        </Link>
                      ) : (
                        inner
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {data && (
          <p className="mt-4 text-[11px] text-slate-500">
            Money of record: {data.baseCurrency}. Generated {new Date(data.generatedAt).toLocaleString()}.
          </p>
        )}
      </div>
    </div>
  );
}

const HERO_NF = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function HeroCard({
  className,
  label,
  sublabel,
  icon: Icon,
  glow,
  border,
  iconTone,
  currency,
  value,
  loading,
  badge,
}: {
  className?: string;
  label: string;
  sublabel: string;
  icon: any;
  glow: string;
  border: string;
  iconTone: string;
  currency: string;
  value: number | null;
  loading: boolean;
  badge?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl border ${border} bg-white/[0.04] p-4 transition-transform duration-200 hover:-translate-y-0.5 sm:p-5 ${className ?? ""}`}
    >
      <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full blur-2xl" style={{ background: glow }} aria-hidden />
      <div className="relative flex items-start justify-between gap-3">
        <div className="text-xs font-bold text-slate-200 sm:text-sm">{label}</div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06]">
          <Icon className={`h-[18px] w-[18px] ${iconTone}`} />
        </div>
      </div>
      <div className="relative mt-3 flex min-h-7 items-baseline gap-1.5 whitespace-nowrap sm:mt-4 sm:gap-2">
        {loading ? (
          <span className="inline-block h-7 w-32 rounded bg-white/10 animate-pulse" />
        ) : (
          <>
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{currency}</span>
            <span className="text-xl font-extrabold tabular-nums tracking-tight text-white leading-none sm:text-2xl">
              {value === null ? "0" : HERO_NF.format(Math.round(value))}
            </span>
          </>
        )}
      </div>
      <div className="relative mt-1.5 flex items-center justify-between gap-2 sm:mt-2">
        <span className="text-[11px] text-slate-400 sm:text-xs">{sublabel}</span>
        {badge && !loading && <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-slate-300">{badge}</span>}
      </div>
    </div>
  );
}
