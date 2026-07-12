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

const STREAM_META: Record<StreamKey, { icon: any; tone: string; href: string | null }> = {
  accommodation: { icon: Building2, tone: "text-emerald-300", href: "/admin/revenue" },
  tours: { icon: MapIcon, tone: "text-sky-300", href: "/admin/agents/tour-revenue" },
  transport: { icon: Car, tone: "text-amber-300", href: "/admin/drivers/invoices" },
  groupStay: { icon: Users, tone: "text-violet-300", href: "/admin/group-stays/revenue" },
  subscriptions: { icon: CreditCard, tone: "text-slate-300", href: null },
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
  const maxRev = useMemo(
    () => Math.max(1, ...(data?.streams || []).map((s) => s.nolsafRevenue)),
    [data?.streams],
  );

  return (
    <div className="box-border w-full max-w-full min-w-0 overflow-x-clip bg-[#070B1C] text-slate-100">
      <div className="relative mx-auto box-border w-full max-w-full min-w-0 space-y-4 overflow-x-clip px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 lg:px-6 xl:px-8">
        {/* Header */}
        <div
          className="relative w-full max-w-full overflow-hidden rounded-2xl shadow-2xl"
          style={{
            background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)",
            boxShadow: "0 22px 55px -20px rgba(2,102,94,0.45)",
          }}
        >
          <div className="relative z-10 flex flex-col items-center px-5 py-8 text-center sm:px-8 sm:py-10">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/10 shadow-[0_0_0_7px_rgba(255,255,255,0.05)]">
              <Wallet className="h-6 w-6 text-white/90" aria-hidden />
            </div>
            <div className="flex items-center gap-2 text-xs text-white/65">
              <span>Finance overview</span>
              {data && (
                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-white/75">
                  {data.range.allTime ? "All time" : "Filtered range"}
                </span>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              NoLSAF Revenue across all streams
            </h1>
            <p className="mt-2 max-w-4xl text-sm text-white/65 sm:text-base">
              GMV and NoLSAF revenue rolled up across accommodation, tours, transport, group stay and
              subscriptions. Read only. Each stream stays managed on its own page.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            Couldn’t load finance overview: {error}
          </div>
        )}

        {/* Hero KPIs */}
        <div className="grid w-full max-w-full grid-cols-12 gap-4">
          <HeroCard
            className="col-span-12 sm:col-span-6 xl:col-span-3"
            label="NoLSAF revenue"
            sublabel="Realized platform take"
            icon={TrendingUp}
            tone="bg-[#123c36] border-[#24584f]"
            currency={data?.baseCurrency || "TZS"}
            value={totals ? totals.nolsafRevenue : null}
            loading={loading}
          />
          <HeroCard
            className="col-span-12 sm:col-span-6 xl:col-span-3"
            label="Total GMV"
            sublabel="Gross value transacted"
            icon={Wallet}
            tone="bg-[#17384b] border-[#28536a]"
            currency={data?.baseCurrency || "TZS"}
            value={totals ? totals.gmv : null}
            loading={loading}
          />
          <HeroCard
            className="col-span-12 sm:col-span-6 xl:col-span-3"
            label="Paid to partners"
            sublabel="Owners, operators, drivers"
            icon={HandCoins}
            tone="bg-[#2d3151] border-[#454b70]"
            currency={data?.baseCurrency || "TZS"}
            value={totals ? totals.partnerNet : null}
            loading={loading}
          />
          <HeroCard
            className="col-span-12 sm:col-span-6 xl:col-span-3"
            label="Pending revenue"
            sublabel={totals ? `${totals.pendingCount} in pipeline` : "In pipeline"}
            icon={Hourglass}
            tone="bg-[#3a342e] border-[#554a40]"
            currency={data?.baseCurrency || "TZS"}
            value={totals ? totals.pendingRevenue : null}
            loading={loading}
          />
        </div>

        {/* Per-stream breakdown */}
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-white/10">
            <div className="text-sm font-semibold">Revenue by stream</div>
            <div className="text-xs text-slate-400">NoLSAF take per source (realized)</div>
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
                {(data?.streams || []).map((s) => {
                  const meta = STREAM_META[s.key];
                  const Icon = meta.icon;
                  const share = totals && totals.nolsafRevenue > 0 ? s.nolsafRevenue / totals.nolsafRevenue : 0;
                  const barPct = Math.round((s.nolsafRevenue / maxRev) * 100);
                  const inner = (
                    <div className="flex items-center gap-4 rounded-2xl px-4 py-3 hover:bg-white/5 transition-colors">
                      <div className={"shrink-0 rounded-xl bg-white/5 border border-white/10 p-2.5 " + meta.tone}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{s.label}</span>
                            {meta.href && <ExternalLink className="h-3.5 w-3.5 text-slate-500" />}
                          </div>
                          <span className="text-sm font-bold tabular-nums text-white">{fmt(s.nolsafRevenue)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-white/70 to-white/30"
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-slate-400">
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>GMV {fmt(s.gmv)}</span>
                            <span>{s.realizedCount} transactions</span>
                            {s.pendingRevenue > 0 ? <span>{fmt(s.pendingRevenue)} pending</span> : null}
                          </span>
                          <span className="tabular-nums">{Math.round(share * 100)}% of revenue</span>
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
  tone,
  currency,
  value,
  loading,
}: {
  className?: string;
  label: string;
  sublabel: string;
  icon: any;
  tone: string;
  currency: string;
  value: number | null;
  loading: boolean;
}) {
  return (
    <div
      className={
        "rounded-3xl border " +
        tone +
        " p-4 sm:p-5 " +
        (className ?? "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold text-slate-100 sm:text-sm">{label}</div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] sm:h-9 sm:w-9">
          <Icon className="h-4 w-4 text-slate-200 sm:h-[18px] sm:w-[18px]" />
        </div>
      </div>
      <div className="mt-3 flex min-h-7 items-baseline gap-1.5 whitespace-nowrap sm:mt-4 sm:gap-2">
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
      <div className="mt-1.5 text-[11px] text-slate-400 sm:mt-2 sm:text-xs">{sublabel}</div>
    </div>
  );
}
