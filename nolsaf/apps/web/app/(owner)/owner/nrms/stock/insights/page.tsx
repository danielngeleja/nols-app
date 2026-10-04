"use client";

// Stock insights (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 6): the owner
// digest, profit per menu item, supplier prices and performance, wastage, dead
// stock and valuation. Owner and manager only; every report is read-only.

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BellRing, CheckCircle2, Coins, Loader2, PackageX, Scale, Tags, Trash, TrendingUp, Truck, Warehouse } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { useNrms } from "../../_components/NrmsProvider";
import { apiError } from "../../_components/stockFormat";
import { SectionCard, cardClass, primaryButton, radioClass } from "../items/_components/ui";
import StockPageHeader from "../_components/StockPageHeader";
import { DeadStockTab, MenuProfitTab, PriceWatchTab, SuppliersTab, ValuationTab, WastageTab } from "./_components/InsightTabs";

type Tab = "digest" | "menu" | "prices" | "suppliers" | "wastage" | "dead" | "valuation";
type DigestLine = { kind: string; text: string; tone: "bad" | "warn" | "info" };
type Digest = { headline: string; lines: DigestLine[]; days: number; frequency: string; lastSentAt: string | null };
type InsightSettings = { digestFrequency: "OFF" | "DAILY" | "WEEKLY"; digestLastSentAt: string | null; deadStockDays: number; canEdit: boolean };

const TABS: Array<[Tab, string, typeof TrendingUp]> = [
  ["digest", "Digest", BellRing],
  ["menu", "Menu profit", Coins],
  ["prices", "Price watch", Tags],
  ["suppliers", "Suppliers", Truck],
  ["wastage", "Wastage", Trash],
  ["dead", "Dead stock", PackageX],
  ["valuation", "Valuation", Warehouse],
];

/** Tabs that read a date range. */
const RANGED: Tab[] = ["menu", "prices", "suppliers", "wastage"];

function eatDay(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

export default function StockInsightsPage() {
  const { selectedPropertyId } = useNrms();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab") as Tab | null;
  const tab: Tab = TABS.some(([key]) => key === requested) ? requested! : "digest";
  const setTab = (next: Tab) => router.replace(`/owner/nrms/stock/insights?tab=${next}`);
  const [from, setFrom] = useState(eatDay(-29));
  const [to, setTo] = useState(eatDay());
  // Reports reload when their range changes; nothing else invalidates them here.
  const refreshKey = 0;

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <StockPageHeader
        icon={TrendingUp}
        title="Stock insights"
        subtitle="What each menu item earns, which suppliers raise prices or deliver short, and what is wasted or sitting unsold."
        actions={RANGED.includes(tab) ? (
          <div className="flex items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-neutral-50 px-2.5 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Range</span>
            <div className="w-[140px]"><DatePickerField label="From" value={from} allowPast twoMonths={false} size="sm" widthClassName="!w-full" max={to} onChangeAction={(next) => setFrom(next.slice(0, 10))} /></div>
            <span className="text-sm text-neutral-400">to</span>
            <div className="w-[140px]"><DatePickerField label="To" value={to} allowPast twoMonths={false} size="sm" widthClassName="!w-full" max={eatDay()} onChangeAction={(next) => setTo(next.slice(0, 10))} /></div>
          </div>
        ) : undefined}
        tabs={TABS.map(([key, label, icon]) => ({ key, label, icon }))}
        activeTab={tab}
        onTab={setTab}
        ariaLabel="Stock insights"
      />

      {selectedPropertyId && (
        <>
          {tab === "digest" && <DigestTab propertyId={selectedPropertyId} />}
          {tab === "menu" && <MenuProfitTab propertyId={selectedPropertyId} range={{ from, to }} refreshKey={refreshKey} />}
          {tab === "prices" && <PriceWatchTab propertyId={selectedPropertyId} range={{ from, to }} refreshKey={refreshKey} />}
          {tab === "suppliers" && <SuppliersTab propertyId={selectedPropertyId} range={{ from, to }} refreshKey={refreshKey} />}
          {tab === "wastage" && <WastageTab propertyId={selectedPropertyId} range={{ from, to }} refreshKey={refreshKey} />}
          {tab === "dead" && <DeadStockTab propertyId={selectedPropertyId} refreshKey={refreshKey} />}
          {tab === "valuation" && <ValuationTab propertyId={selectedPropertyId} refreshKey={refreshKey} />}
        </>
      )}
    </div>
  );
}

const TONE: Record<DigestLine["tone"], { dot: string; icon: typeof AlertTriangle }> = {
  bad: { dot: "bg-red-50 text-red-700", icon: AlertTriangle },
  warn: { dot: "bg-amber-50 text-amber-700", icon: AlertTriangle },
  info: { dot: "bg-sky-50 text-sky-700", icon: Scale },
};

function DigestTab({ propertyId }: { propertyId: number }) {
  const [days, setDays] = useState(7);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [settings, setSettings] = useState<InsightSettings | null>(null);
  const [frequency, setFrequency] = useState<InsightSettings["digestFrequency"]>("OFF");
  const [deadDays, setDeadDays] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [digestRes, settingsRes] = await Promise.all([
        apiClient.get<Digest>(`/api/nrms/stock/property/${propertyId}/insights/digest`, { params: { days } }),
        apiClient.get<InsightSettings>(`/api/nrms/stock/property/${propertyId}/insights/settings`),
      ]);
      setDigest(digestRes.data);
      setSettings(settingsRes.data);
      setFrequency(settingsRes.data.digestFrequency);
      setDeadDays(String(settingsRes.data.deadStockDays));
      setError(null);
    } catch (cause) {
      setError(apiError(cause, "Unable to build the digest"));
    }
  }, [propertyId, days]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setSaved(false);
    try {
      await apiClient.put(`/api/nrms/stock/property/${propertyId}/insights/settings`, { digestFrequency: frequency, deadStockDays: Math.min(365, Math.max(7, Number(deadDays) || 30)) });
      setSaved(true);
      await load();
    } catch (cause) {
      setError(apiError(cause, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  if (error && !digest) return <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!digest || !settings) return <div className={`${cardClass} flex min-h-[24vh] items-center justify-center text-neutral-300`}><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <SectionCard
        icon={BellRing}
        title="Stock digest"
        subtitle={`Last ${digest.days} ${digest.days === 1 ? "day" : "days"}, in the same words the owner digest uses`}
        action={(
          <div className="flex gap-1">
            {[1, 7, 30].map((value) => (
              <button key={value} type="button" onClick={() => setDays(value)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] ${days === value ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{value === 1 ? "Today" : `${value} days`}</button>
            ))}
          </div>
        )}
        bodyClass="p-0"
      >
        <div className={`flex items-center gap-3 border-0 border-b border-solid px-4 py-3 ${digest.lines.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          {digest.lines.length ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />}
          <p className="m-0 text-sm font-bold">{digest.headline}</p>
        </div>
        {digest.lines.length === 0 ? (
          <p className="m-0 px-4 py-8 text-center text-sm text-neutral-500">No count losses, price jumps, large write-offs, low goods without an order, or overdue bills in this period.</p>
        ) : digest.lines.map((line, index) => {
          const tone = TONE[line.tone];
          return (
            <div key={index} className="flex items-start gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0">
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone.dot}`}><tone.icon className="h-3.5 w-3.5" /></span>
              <p className="m-0 text-[15px] leading-snug text-neutral-800">{line.text}</p>
            </div>
          );
        })}
      </SectionCard>

      <SectionCard icon={BellRing} title="Send me the digest" subtitle="To your NoLSAF inbox, after 07:00 EAT">
        <div className="space-y-3">
          <div className="space-y-2">
            {([["OFF", "Off", "Check this page when you want"], ["DAILY", "Every morning", "Yesterday's stock news, before the day starts"], ["WEEKLY", "Every week", "One summary of the last seven days"]] as const).map(([value, label, hint]) => {
              const on = frequency === value;
              return (
                <label key={value} className={`flex items-center gap-3 rounded-xl border border-solid px-3.5 py-3 transition ${settings.canEdit ? "cursor-pointer" : "cursor-default"} ${on ? "border-brand bg-brand/[0.05]" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                  <input type="radio" name="digest-frequency" checked={on} disabled={!settings.canEdit} onChange={() => setFrequency(value)} className={radioClass} />
                  <span className="min-w-0">
                    <span className={`block text-sm font-bold ${on ? "text-brand" : "text-neutral-900"}`}>{label}</span>
                    <span className="block text-xs text-neutral-500">{hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <label className="block pt-2 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">
            Dead stock after (days)
            <input inputMode="numeric" value={deadDays} disabled={!settings.canEdit} onChange={(event) => setDeadDays(event.target.value.replace(/[^\d]/g, "").slice(0, 3))} className="mt-1.5 box-border h-10 w-full rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm font-normal normal-case tracking-normal text-neutral-800 outline-none [font-family:inherit] focus:border-brand" />
          </label>
          {settings.digestLastSentAt && <p className="m-0 text-xs text-neutral-500">Last sent {new Date(settings.digestLastSentAt).toLocaleString(undefined, { timeZone: "Africa/Dar_es_Salaam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} EAT</p>}
          {settings.canEdit ? (
            <div className="flex items-center justify-end gap-3">
              {saved && <span className="text-sm font-bold text-emerald-700">Saved</span>}
              <button type="button" disabled={busy} onClick={() => void save()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
            </div>
          ) : <p className="m-0 text-xs text-neutral-500">Only the owner can change this.</p>}
          <p className="m-0 text-xs text-neutral-500">SMS and WhatsApp delivery will follow once the message templates are approved.</p>
        </div>
      </SectionCard>
    </div>
  );
}
