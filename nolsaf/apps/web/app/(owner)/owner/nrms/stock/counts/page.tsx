"use client";

// Counts & variance (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 3): start a
// blind count, see every count's state, and the loss report across counts.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, ClipboardList, Download, EyeOff, Loader2, Play, Scale, Settings2, TrendingDown } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { useNrms } from "../../_components/NrmsProvider";
import ModalFrame from "../../_components/NrmsModalFrame";
import { useStockOverview, type StockOverview } from "../../_components/StockGoodsPanel";
import { STOCK_CATEGORY_LABELS, apiError, categoryTone, formatMoney, formatStockQuantity } from "../../_components/stockFormat";
import { EmptyState, Pill, SectionCard, cardClass, checkboxClass, fieldClass, labelClass, primaryButton, quietButton, smallFieldClass } from "../items/_components/ui";
import { formatDay, formatWhen } from "../operations/_components/shared";
import { COUNT_STATUS, SCOPE_LABELS } from "./_components/countShared";
import StockPageHeader, { type StockTile } from "../_components/StockPageHeader";

type Tab = "counts" | "variance" | "settings";

type CountRow = {
  id: number;
  countNumber: string;
  scope: string;
  blind: boolean;
  status: string;
  locationName: string;
  lineCount: number;
  countedLines: number;
  recountLines: number;
  startedAt: string;
  startedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  varianceCost: number | null;
  varianceSales: number | null;
};


export default function StockCountsPage() {
  const { selectedPropertyId } = useNrms();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: overview, loading, error } = useStockOverview(selectedPropertyId);
  const [counts, setCounts] = useState<CountRow[] | null>(null);
  const [perms, setPerms] = useState({ canCount: false, canApprove: false });
  const [countsError, setCountsError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [variance, setVariance] = useState<VarianceData | null>(null);

  const requested = searchParams.get("tab");
  const tab: Tab = requested === "variance" || requested === "settings" ? requested : "counts";
  const setTab = (next: Tab) => router.replace(next === "counts" ? "/owner/nrms/stock/counts" : `/owner/nrms/stock/counts?tab=${next}`);

  const loadCounts = useCallback(async () => {
    if (!selectedPropertyId) return;
    try {
      const res = await apiClient.get<{ canCount: boolean; canApprove: boolean; counts: CountRow[] }>(`/api/nrms/stock/property/${selectedPropertyId}/counts`);
      setCounts(res.data.counts);
      setPerms({ canCount: res.data.canCount, canApprove: res.data.canApprove });
    } catch (cause) {
      setCountsError(apiError(cause, "Unable to load counts"));
    }
  }, [selectedPropertyId]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);

  useEffect(() => {
    if (!selectedPropertyId) return;
    apiClient.get<VarianceData>(`/api/nrms/stock/property/${selectedPropertyId}/variance`).then((res) => setVariance(res.data)).catch(() => setVariance(null));
  }, [selectedPropertyId]);

  const open = (counts ?? []).filter((row) => ["IN_PROGRESS", "SUBMITTED", "RECOUNT"].includes(row.status));
  const lastFull = (counts ?? []).find((row) => row.status === "APPROVED" && row.scope === "FULL");
  const currency = overview?.currency ?? "TZS";
  const waitingReview = open.filter((row) => row.status !== "IN_PROGRESS").length;
  const lost = variance?.showMoney && variance.totals.varianceSales != null ? Math.min(0, variance.totals.varianceSales) : null;
  const short = variance?.totals.goodsShort ?? null;
  const daysSinceFull = lastFull?.approvedAt ? Math.floor((Date.now() - new Date(lastFull.approvedAt).getTime()) / 86_400_000) : null;
  const tiles: StockTile[] = [
    { icon: ClipboardList, label: "Open counts", value: String(open.length), note: waitingReview ? `${waitingReview} waiting for review` : open.length ? "Being counted now" : "No count running", tone: waitingReview ? "amber" : open.length ? "brand" : "calm" },
    { icon: TrendingDown, label: "Lost at selling price", value: lost != null ? formatMoney(-lost, currency) : "-", note: lost != null ? (lost < 0 ? "Last 30 days of approved counts" : "Nothing lost in 30 days") : "Owner and manager only", tone: lost != null && lost < 0 ? "red" : lost != null ? "calm" : "neutral" },
    { icon: Scale, label: "Goods short", value: short != null ? String(short) : "-", note: short ? "Goods below the book, 30 days" : "Nothing short in 30 days", tone: short ? "amber" : "calm" },
    { icon: CalendarCheck, label: "Last full count", value: lastFull ? formatDay(lastFull.approvedAt) : "Never", note: daysSinceFull == null ? "Count every shelf once to start" : daysSinceFull > 7 ? `${daysSinceFull} days ago: time for another` : "Within the last week", tone: daysSinceFull == null || daysSinceFull > 7 ? "amber" : "calm" },
  ];

  const tabs: Array<{ key: Tab; label: string; icon: typeof Scale; count?: number; alert?: boolean; visible: boolean }> = [
    { key: "counts", label: "Counts", icon: ClipboardList, count: waitingReview, alert: true, visible: true },
    { key: "variance", label: "Variance", icon: TrendingDown, visible: true },
    { key: "settings", label: "Count settings", icon: Settings2, visible: perms.canApprove },
  ];

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <StockPageHeader
        icon={Scale}
        title="Counts & variance"
        subtitle="Count the shelf without seeing the book, then see what should have been there."
        actions={perms.canCount && overview ? <button type="button" onClick={() => setStarting(true)} className={`${primaryButton} !h-10 px-4`}><Play className="h-4 w-4" />Start a count</button> : undefined}
        tiles={tiles}
        tabs={tabs.filter((row) => row.visible)}
        activeTab={tab}
        onTab={setTab}
        ariaLabel="Counts"
      />

      {(error || countsError) && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error || countsError}</div>}

      {loading && !overview ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : overview && selectedPropertyId ? (
        tab === "counts" ? (
          <CountsList counts={counts} canCount={perms.canCount} currency={currency} onStart={() => setStarting(true)} />
        ) : tab === "variance" ? (
          <VarianceTab propertyId={selectedPropertyId} overview={overview} />
        ) : (
          <CountSettings propertyId={selectedPropertyId} overview={overview} />
        )
      ) : null}

      {starting && overview && selectedPropertyId && (
        <StartCountModal propertyId={selectedPropertyId} overview={overview} canApprove={perms.canApprove} onClose={() => setStarting(false)} onStarted={(countId) => router.push(`/owner/nrms/stock/counts/${countId}`)} />
      )}
    </div>
  );
}

function CountsList({ counts, canCount, currency, onStart }: { counts: CountRow[] | null; canCount: boolean; currency: string; onStart: () => void }) {
  if (!counts) return <div className={`${cardClass} flex min-h-[20vh] items-center justify-center text-neutral-300`}><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (counts.length === 0) {
    return <div className={cardClass}><EmptyState icon={Scale} title="No counts yet" body="Start with a spot count of the spirits and beer at the bar: it takes ten minutes and gives the first real number. A full count of every shelf once a week is the habit to build." action={canCount ? <button type="button" onClick={onStart} className={primaryButton}><Play className="h-4 w-4" />Start a count</button> : undefined} /></div>;
  }
  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2.5">Count</th>
              <th className="px-2 py-2.5">Where</th>
              <th className="px-2 py-2.5">Progress</th>
              <th className="px-2 py-2.5 text-right">Variance at cost</th>
              <th className="px-2 py-2.5 text-right">At selling price</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((row) => {
              const state = COUNT_STATUS[row.status] ?? { label: row.status, tone: "muted" as const };
              const share = row.lineCount ? row.countedLines / row.lineCount : 0;
              return (
                <tr key={row.id} className="border-0 border-t border-solid border-neutral-100 transition hover:bg-neutral-50/70">
                  <td className="px-4 py-3">
                    <Link href={`/owner/nrms/stock/counts/${row.id}`} className="text-[15px] font-bold text-neutral-900 no-underline hover:text-brand hover:underline">{row.countNumber}</Link>
                    <p className="m-0 mt-0.5 flex items-center gap-1.5 text-[13px] text-neutral-500">{SCOPE_LABELS[row.scope] ?? row.scope}{row.blind && <EyeOff className="h-3.5 w-3.5" aria-label="Blind" />} · {formatWhen(row.startedAt)}{row.startedBy ? ` · ${row.startedBy}` : ""}</p>
                  </td>
                  <td className="px-2 py-3 text-sm text-neutral-700">{row.locationName}</td>
                  <td className="px-2 py-3">
                    <p className="m-0 text-sm tabular-nums text-neutral-700">{row.countedLines} of {row.lineCount}</p>
                    <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-brand" style={{ width: `${share * 100}%` }} /></div>
                  </td>
                  <td className={`px-2 py-3 text-right text-sm font-bold tabular-nums ${(row.varianceCost ?? 0) < 0 ? "text-red-700" : "text-neutral-800"}`}>{row.varianceCost != null ? formatMoney(row.varianceCost, currency) : "-"}</td>
                  <td className={`px-2 py-3 text-right text-sm font-bold tabular-nums ${(row.varianceSales ?? 0) < 0 ? "text-red-700" : "text-neutral-800"}`}>{row.varianceSales != null ? formatMoney(row.varianceSales, currency) : "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={state.tone}>{state.label}</Pill>
                      {row.status === "APPROVED" && <Link href={`/owner/nrms/stock/counts/${row.id}/report`} className="text-[13px] font-bold text-brand no-underline hover:underline">Report</Link>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StartCountModal({ propertyId, overview, canApprove, onClose, onStarted }: { propertyId: number; overview: StockOverview; canApprove: boolean; onClose: () => void; onStarted: (countId: number) => void }) {
  const [locationId, setLocationId] = useState<number | "">(overview.locations.length === 1 ? overview.locations[0].id : "");
  const [scope, setScope] = useState<"FULL" | "SPOT" | "HANDOVER">("SPOT");
  const [blind, setBlind] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goodsHere = useMemo(() => overview.items.filter((good) => good.status === "ACTIVE" && good.balances.some((row) => row.locationId === locationId)), [overview.items, locationId]);
  const byCategory = useMemo(() => {
    const map = new Map<string, typeof goodsHere>();
    for (const good of goodsHere) map.set(good.category, [...(map.get(good.category) ?? []), good]);
    return [...map.entries()];
  }, [goodsHere]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ countId: number }>(`/api/nrms/stock/property/${propertyId}/counts`, {
        locationId,
        scope,
        stockItemIds: scope === "SPOT" ? [...picked] : undefined,
        blind,
        note: note.trim() || null,
      });
      onStarted(res.data.countId);
    } catch (cause) {
      setError(apiError(cause, "Could not start the count"));
    } finally {
      setBusy(false);
    }
  };

  const valid = Boolean(locationId) && (scope !== "SPOT" || picked.size > 0);

  return (
    <ModalFrame
      title="Start a count"
      subtitle="Count what is physically there. The book stays hidden until a manager reviews."
      icon={<Play className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
          <button type="button" disabled={!valid || busy} onClick={() => void start()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Start counting</button>
        </div>
      )}
    >
      <div className="space-y-4">
        <label className={labelClass}>
          Where
          <select value={locationId} onChange={(event) => { setLocationId(event.target.value ? Number(event.target.value) : ""); setPicked(new Set()); }} className={fieldClass}>
            <option value="">Choose a location</option>
            {overview.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <div>
          <p className={`${labelClass} m-0`}>What to count</p>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
            {([
              ["SPOT", "Spot count", "A chosen list, like all spirits. Ten minutes."],
              ["FULL", "Full count", "Every good held here. Weekly or monthly."],
              ["HANDOVER", "Handover count", "The owner's short high-value list, at shift change."],
            ] as const).map(([value, title, hint]) => (
              <button key={value} type="button" onClick={() => setScope(value)} className={`rounded-xl border border-solid p-3 text-left [font-family:inherit] ${scope === value ? "border-brand bg-brand/5" : "border-neutral-300 bg-white hover:border-brand/40"}`}>
                <span className="block text-sm font-bold text-neutral-900">{title}</span>
                <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>
              </button>
            ))}
          </div>
        </div>
        {scope === "SPOT" && locationId && (
          <div>
            <div className="flex items-center justify-between">
              <p className={`${labelClass} m-0`}>Goods ({picked.size} chosen)</p>
              <button type="button" onClick={() => setPicked(picked.size === goodsHere.length ? new Set() : new Set(goodsHere.map((good) => good.id)))} className={quietButton}>{picked.size === goodsHere.length ? "Clear" : "Select all"}</button>
            </div>
            {goodsHere.length === 0 ? <p className="m-0 mt-2 text-sm text-neutral-500">Nothing is stocked here yet.</p> : (
              <div className="mt-2 max-h-[300px] space-y-3 overflow-y-auto rounded-xl border border-solid border-neutral-200 p-3">
                {byCategory.map(([category, goods]) => (
                  <div key={category}>
                    <div className="flex items-center justify-between">
                      <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">{STOCK_CATEGORY_LABELS[category] ?? category}</p>
                      <button type="button" onClick={() => setPicked((current) => { const next = new Set(current); const all = goods.every((good) => next.has(good.id)); goods.forEach((good) => (all ? next.delete(good.id) : next.add(good.id))); return next; })} className="border-0 bg-transparent p-0 text-xs font-bold text-brand [font-family:inherit] hover:underline">All {STOCK_CATEGORY_LABELS[category]?.toLowerCase() ?? ""}</button>
                    </div>
                    <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                      {goods.map((good) => (
                        <label key={good.id} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
                          <input type="checkbox" checked={picked.has(good.id)} onChange={() => setPicked((current) => { const next = new Set(current); if (next.has(good.id)) next.delete(good.id); else next.add(good.id); return next; })} className={checkboxClass} />
                          <span className="truncate">{good.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {canApprove && (
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" checked={blind} onChange={(event) => setBlind(event.target.checked)} className={`${checkboxClass} mt-0.5`} />
            <span>
              <span className="block text-sm font-bold text-neutral-900">Blind count (recommended)</span>
              <span className="block text-xs text-neutral-500">The person counting never sees what the book expects, so they cannot count to match it.</span>
            </span>
          </label>
        )}
        <label className={labelClass}>
          Note (optional)
          <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="Weekly bar count, after Saturday service" className={fieldClass} />
        </label>
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

// ====================================================================== variance

type VarianceRow = { locationId: number; locationName: string; stockItemId: number; name: string; category: string; baseUnit: string; counts: number; countsShort: number; varianceQuantity: number; varianceCost: number | null; varianceSales: number | null };
type VarianceData = {
  from: string;
  to: string;
  showMoney: boolean;
  approvedCounts: number;
  totals: { varianceCost: number | null; varianceSales: number | null; goodsShort: number };
  byLocation: Array<{ locationId: number; name: string; lines: number; varianceCost: number | null; varianceSales: number | null }>;
  rows: VarianceRow[];
};

function isoDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function VarianceTab({ propertyId, overview }: { propertyId: number; overview: StockOverview }) {
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [locationId, setLocationId] = useState<number | "">("");
  const [data, setData] = useState<VarianceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<VarianceData>(`/api/nrms/stock/property/${propertyId}/variance`, { params: { from, to, locationId: locationId || undefined } });
      setData(res.data);
    } catch (cause) {
      setError(apiError(cause, "Unable to load the variance report"));
    } finally {
      setLoading(false);
    }
  }, [propertyId, from, to, locationId]);
  useEffect(() => { void load(); }, [load]);

  const currency = overview.currency;
  const exportCsv = () => {
    if (!data) return;
    const header = ["Location", "Good", "Category", "Counts", "Counts short", "Variance quantity", "Unit", "Variance at cost", "Variance at selling price"];
    const lines = data.rows.map((row) => [row.locationName, row.name, STOCK_CATEGORY_LABELS[row.category] ?? row.category, row.counts, row.countsShort, row.varianceQuantity, row.baseUnit, row.varianceCost ?? "", row.varianceSales ?? ""]);
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `stock-variance-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">From</p>
          <div className="mt-1"><DatePickerField label="Variance from" value={from} max={to || undefined} allowPast twoMonths={false} size="sm" widthClassName="!w-full" onChangeAction={(next) => setFrom(next.slice(0, 10))} /></div>
        </div>
        <div className="w-40">
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">To</p>
          <div className="mt-1"><DatePickerField label="Variance to" value={to} min={from || undefined} allowPast twoMonths={false} size="sm" widthClassName="!w-full" onChangeAction={(next) => setTo(next.slice(0, 10))} /></div>
        </div>
        <label className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">Where
          <select value={locationId} onChange={(event) => setLocationId(event.target.value ? Number(event.target.value) : "")} className={`${smallFieldClass} mt-1 block`}>
            <option value="">All locations</option>
            {overview.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={!data?.rows.length} onClick={exportCsv} className={`${quietButton} ml-auto h-9`}><Download className="h-4 w-4" />Export CSV</button>
      </div>
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!data ? (
        <div className={`${cardClass} flex min-h-[20vh] items-center justify-center text-neutral-300`}><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className={`grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] ${loading ? "opacity-60" : ""}`}>
          <SectionCard icon={TrendingDown} tone="red" title="Where stock went missing" subtitle={`${data.approvedCounts} approved ${data.approvedCounts === 1 ? "count" : "counts"} between ${formatDay(data.from)} and ${formatDay(data.to)}, worst first`} bodyClass="p-0">
            {data.rows.length === 0 ? (
              <p className="m-0 px-4 py-10 text-center text-sm text-neutral-500">No approved counts in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left">
                  <thead>
                    <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
                      <th className="px-4 py-2">Good</th>
                      <th className="px-2 py-2 text-right">Short in</th>
                      <th className="px-2 py-2 text-right">Quantity</th>
                      <th className="px-2 py-2 text-right">At cost</th>
                      <th className="px-4 py-2 text-right">At selling price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={`${row.locationId}-${row.stockItemId}`} className="border-0 border-t border-solid border-neutral-100">
                        <td className="px-4 py-2.5">
                          <p className="m-0 text-sm font-bold text-neutral-900">{row.name}</p>
                          <p className="m-0 text-xs text-neutral-500">{row.locationName} · {STOCK_CATEGORY_LABELS[row.category] ?? row.category}</p>
                        </td>
                        <td className="px-2 py-2.5 text-right text-sm tabular-nums">{row.countsShort} of {row.counts}</td>
                        <td className={`px-2 py-2.5 text-right text-sm font-bold tabular-nums ${row.varianceQuantity < 0 ? "text-red-700" : row.varianceQuantity > 0 ? "text-emerald-700" : "text-neutral-500"}`}>{row.varianceQuantity > 0 ? "+" : ""}{formatStockQuantity(row.varianceQuantity, row.baseUnit)}</td>
                        <td className="px-2 py-2.5 text-right text-sm tabular-nums">{row.varianceCost != null ? formatMoney(row.varianceCost, currency) : "-"}</td>
                        <td className={`px-4 py-2.5 text-right text-sm font-bold tabular-nums ${(row.varianceSales ?? 0) < 0 ? "text-red-700" : "text-neutral-800"}`}>{row.varianceSales != null ? formatMoney(row.varianceSales, currency) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          <div className="space-y-4">
            <SectionCard icon={Scale} title="Totals" subtitle="Negative means stock is missing">
              <div className="space-y-2 text-sm">
                <p className="m-0 flex justify-between"><span className="text-neutral-600">At cost</span><strong className={`tabular-nums ${(data.totals.varianceCost ?? 0) < 0 ? "text-red-700" : ""}`}>{data.totals.varianceCost != null ? formatMoney(data.totals.varianceCost, currency) : "-"}</strong></p>
                <p className="m-0 flex justify-between"><span className="text-neutral-600">At selling price</span><strong className={`tabular-nums ${(data.totals.varianceSales ?? 0) < 0 ? "text-red-700" : ""}`}>{data.totals.varianceSales != null ? formatMoney(data.totals.varianceSales, currency) : "-"}</strong></p>
                <p className="m-0 flex justify-between"><span className="text-neutral-600">Goods short</span><strong className="tabular-nums">{data.totals.goodsShort}</strong></p>
              </div>
            </SectionCard>
            <SectionCard icon={ClipboardList} title="By location">
              <ul className="m-0 list-none space-y-2 p-0">
                {data.byLocation.map((row) => (
                  <li key={row.locationId} className="flex items-center justify-between text-sm">
                    <span className="font-bold text-neutral-800">{row.name}</span>
                    <span className={`tabular-nums ${(row.varianceSales ?? row.varianceCost ?? 0) < 0 ? "font-bold text-red-700" : "text-neutral-600"}`}>{row.varianceSales != null ? formatMoney(row.varianceSales, currency) : row.varianceCost != null ? formatMoney(row.varianceCost, currency) : `${row.lines} goods`}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}

// ====================================================================== settings

function CountSettings({ propertyId, overview }: { propertyId: number; overview: StockOverview }) {
  const [data, setData] = useState<{ tolerances: Record<string, number>; defaults: Record<string, number>; handoverCountItems: Record<string, number[]>; canEdit: boolean } | null>(null);
  const [tolerances, setTolerances] = useState<Record<string, string>>({});
  const [handover, setHandover] = useState<Record<string, Set<number>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoverLocation, setHandoverLocation] = useState<number | "">(overview.locations.find((row) => row.outletType === "BAR")?.id ?? overview.locations[0]?.id ?? "");

  useEffect(() => {
    apiClient.get<NonNullable<typeof data>>(`/api/nrms/stock/property/${propertyId}/count-settings`).then((res) => {
      setData(res.data);
      setTolerances(Object.fromEntries(Object.entries(res.data.tolerances).map(([key, value]) => [key, String(value)])));
      setHandover(Object.fromEntries(Object.entries(res.data.handoverCountItems ?? {}).map(([key, ids]) => [key, new Set(ids)])));
    }).catch((cause) => setError(apiError(cause, "Unable to load count settings")));
  }, [propertyId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.put(`/api/nrms/stock/property/${propertyId}/count-settings`, {
        varianceTolerances: Object.fromEntries(Object.entries(tolerances).map(([key, value]) => [key, Number(value) || 0])),
        handoverCountItems: Object.fromEntries(Object.entries(handover).map(([key, ids]) => [key, [...ids]])),
      });
      setMessage("Saved.");
    } catch (cause) {
      setError(apiError(cause, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className={`${cardClass} flex min-h-[20vh] items-center justify-center text-neutral-300`}>{error ? <p className="text-sm text-red-700">{error}</p> : <Loader2 className="h-6 w-6 animate-spin" />}</div>;
  const goodsHere = overview.items.filter((good) => good.status === "ACTIVE" && good.balances.some((row) => row.locationId === handoverLocation));
  const chosen = handover[String(handoverLocation)] ?? new Set<number>();

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard icon={Scale} title="Normal loss per category" subtitle="Variance within this share of expected needs no explanation" bodyClass="p-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {[["Category", "pl-4"], ["Allowed loss", "text-right"], ["Standard", "pr-4 text-right"]].map(([label, extra]) => (
                <th key={label} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 ${extra}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(data.tolerances).map((category, index) => {
              const tone = categoryTone(category);
              const current = Number(tolerances[category]);
              const standard = data.defaults[category];
              const changed = standard != null && current !== standard;
              return (
                <tr key={category} className={index % 2 ? "bg-neutral-50/60" : "bg-white"}>
                  <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2 pl-4">
                    <span className="inline-flex items-center gap-2 font-bold text-neutral-800"><span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />{STOCK_CATEGORY_LABELS[category] ?? category}</span>
                  </td>
                  <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2 text-right">
                    <span className="relative inline-block">
                      <input inputMode="decimal" disabled={!data.canEdit} value={tolerances[category] ?? ""} onChange={(event) => setTolerances((current) => ({ ...current, [category]: event.target.value.replace(/[^\d.]/g, "") }))} aria-label={`Allowed loss for ${STOCK_CATEGORY_LABELS[category] ?? category}`} className={`${smallFieldClass} h-8 w-20 pr-7 text-right font-bold tabular-nums ${changed ? "border-brand" : ""}`} />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">%</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-3 py-2 pr-4 text-right text-[13px] text-neutral-500">
                    {standard != null ? `${standard}%` : "-"}
                    {changed && data.canEdit && <button type="button" onClick={() => setTolerances((current) => ({ ...current, [category]: String(standard) }))} className="ml-2 border-0 bg-transparent p-0 text-xs font-bold text-brand [font-family:inherit] hover:underline">Reset</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="m-0 px-4 py-3 text-xs text-neutral-500">Whole goods never forgive a whole missing bottle: 1% of 48 beers rounds down to zero.</p>
      </SectionCard>

      <SectionCard icon={ClipboardList} title="Handover count list" subtitle="What the incoming bar attendant counts before taking over" bodyClass="p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3">
          <label className={`${labelClass} min-w-[220px] flex-1`}>
            Location
            <select value={handoverLocation} onChange={(event) => setHandoverLocation(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
              {overview.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chosen.size ? "bg-brand/10 text-brand" : "bg-neutral-100 text-neutral-500"}`}>{chosen.size} on the list</span>
        </div>
        {goodsHere.length === 0 ? (
          <div className="flex items-start gap-3 px-4 py-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400"><ClipboardList className="h-4 w-4" /></span>
            <p className="m-0 text-sm text-neutral-500">No goods are stocked at this location yet. Once a delivery or transfer puts goods here, pick the few worth counting at every handover.</p>
          </div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0">
                <tr>
                  {[["", "w-10 pl-4"], ["Good", ""], ["Category", ""], ["On the shelf", "pr-4 text-right"]].map(([label, extra]) => (
                    <th key={label || "pick"} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 ${extra}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {goodsHere.map((good, index) => {
                  const on = chosen.has(good.id);
                  const balance = good.balances.find((row) => row.locationId === handoverLocation);
                  const toggle = () => setHandover((current) => { const next = new Set(current[String(handoverLocation)] ?? []); if (next.has(good.id)) next.delete(good.id); else next.add(good.id); return { ...current, [String(handoverLocation)]: next }; });
                  return (
                    <tr key={good.id} onClick={data.canEdit ? toggle : undefined} className={`${data.canEdit ? "cursor-pointer" : ""} ${on ? "bg-brand/[0.06]" : index % 2 ? "bg-neutral-50/60" : "bg-white"} hover:bg-brand/[0.04]`}>
                      <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2 pl-4"><input type="checkbox" disabled={!data.canEdit} checked={on} onChange={toggle} onClick={(event) => event.stopPropagation()} className={checkboxClass} aria-label={`Count ${good.name} at handover`} /></td>
                      <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2 font-bold text-neutral-900">{good.name}</td>
                      <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-3 py-2 text-[13px] text-neutral-600">{STOCK_CATEGORY_LABELS[good.category] ?? good.category}</td>
                      <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-3 py-2 pr-4 text-right tabular-nums text-neutral-700">{balance ? formatStockQuantity(balance.quantity, good.baseUnit) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="m-0 border-0 border-t border-solid border-neutral-100 px-4 py-3 text-xs text-neutral-500">Keep it short, five to ten goods: spirits, premium beer, wine. A long list slows every shift change.</p>
      </SectionCard>

      <div className="xl:col-span-2">
        {!data.canEdit && <p className="m-0 text-sm text-neutral-600">Only the owner can change these.</p>}
        {error && <p className="m-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message && <p className="m-0 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {data.canEdit && <div className="mt-3 flex justify-end"><button type="button" disabled={busy} onClick={() => void save()} className={`${primaryButton} !h-10 px-5`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save count settings</button></div>}
      </div>
    </div>
  );
}
