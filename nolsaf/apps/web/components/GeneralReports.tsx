"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Download, FileImage, FileSpreadsheet, Printer, RefreshCw } from "lucide-react";
import Chart from "@/components/Chart";
import { REGIONS } from "@/lib/tzRegions";
import { escapeAttr, escapeHtml } from "@/utils/html";

/**
 * Admin home reports. Figures come from /admin/stats/*:
 * - Revenue is guest money received (booking invoices the guest has paid, by
 *   paid date, in EAT days) plus paid transport. Owner claims are not added on
 *   top, so a booking is counted once.
 * - Payouts use money stages, so guest payments are never shown as payouts.
 */

type Timeframe = "24h" | "7d" | "30d" | "12m";
type Series = { labels: string[]; data: number[] };
type StageTotal = { stage: string; label: string; count: number; total: number; netPayable: number; commission: number };

const TIMEFRAMES: Array<{ key: Timeframe; label: string; long: string; days: number }> = [
  { key: "24h", label: "24h", long: "Last 24 hours", days: 1 },
  { key: "7d", label: "7 days", long: "Last 7 days", days: 7 },
  { key: "30d", label: "30 days", long: "Last 30 days", days: 30 },
  { key: "12m", label: "12 months", long: "Last 12 months", days: 365 },
];

/** Money stage colours, matching the Invoices page and the printed report. */
const STAGE_COLORS: Record<string, string> = {
  AWAITING_GUEST: "#a3a3a3",
  GUEST_PAID: "#0ea5e9",
  IN_REVIEW: "#f59e0b",
  DISBURSING: "#8b5cf6",
  ON_HOLD: "#f97316",
  FAILED: "#fb7185",
  DISBURSED: "#10b981",
  REJECTED: "#be123c",
  OTHER: "#d4d4d4",
};
const BAR_PALETTE = ["#02665e", "#0ea5e9", "#f59e0b", "#8b5cf6", "#10b981", "#f97316", "#64748b", "#ec4899"];

const AXIS_STYLE = {
  grid: { color: "rgba(0,0,0,0.05)" },
  ticks: { font: { size: 11 }, color: "#a3a3a3" },
  border: { display: false },
};
const TOOLTIP_STYLE = { backgroundColor: "#0b2420", titleColor: "#a7f3d0", bodyColor: "#ffffff", padding: 10, cornerRadius: 8 };

const menuItemClass =
  "flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-100";
const fieldClass =
  "box-border h-9 min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs text-neutral-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}
function tzs(n: number) {
  return `TSh ${Math.round(n).toLocaleString("en-US")}`;
}
function humanize(label: string) {
  const v = String(label || "").replaceAll("_", " ").toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : "";
}
/** "2026-10-01" as "1 Oct". The labels are already EAT calendar days. */
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
function rangeFor(tf: Timeframe) {
  const days = TIMEFRAMES.find((t) => t.key === tf)?.days ?? 7;
  return { from: new Date(Date.now() - days * 86_400_000).toISOString(), to: new Date().toISOString() };
}

/**
 * Whole-number y axis that never shows "1, 1, 1, 0": with all-zero data the
 * axis runs 0 to 1, and fractional ticks are not drawn.
 */
function yAxis(format: (v: number) => string, data: number[]) {
  const allZero = !data.some((v) => Number(v) > 0);
  return { ...AXIS_STYLE, beginAtZero: true, ...(allZero ? { suggestedMax: 1 } : {}), ticks: { ...AXIS_STYLE.ticks, precision: 0, callback: (v: any) => format(Number(v)) } };
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ key: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`h-8 rounded-md border-0 px-2.5 text-xs font-semibold transition ${value === o.key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, subtitle, children, aside }: { title: string; subtitle: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-sm font-bold text-neutral-900">{title}</p>
          <p className="m-0 mt-0.5 text-xs text-neutral-500">{subtitle}</p>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

export default function GeneralReports() {
  const [activeTab, setActiveTab] = useState<"financial" | "payouts">("financial");
  const [region, setRegion] = useState("ALL");
  const [timeframe, setTimeframe] = useState<Timeframe>("7d");
  const [groupBy, setGroupBy] = useState<"propertyType" | "region">("propertyType");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  const revenueCanvas = useRef<HTMLCanvasElement | null>(null);
  const breakdownCanvas = useRef<HTMLCanvasElement | null>(null);
  const propertiesCanvas = useRef<HTMLCanvasElement | null>(null);
  const stagesCanvas = useRef<HTMLCanvasElement | null>(null);

  const [revenueSeries, setRevenueSeries] = useState<Series>({ labels: [], data: [] });
  const [propertiesSeries, setPropertiesSeries] = useState<Series>({ labels: [], data: [] });
  const [revenueBreakdown, setRevenueBreakdown] = useState<Series>({ labels: [], data: [] });
  const [propertiesBreakdown, setPropertiesBreakdown] = useState<Series>({ labels: [], data: [] });
  const [stageTotals, setStageTotals] = useState<StageTotal[]>([]);

  // Property region ids are the numeric region codes (property.regionId).
  const regionOptions = [{ id: "ALL", name: "All regions" }, ...REGIONS.map((r) => ({ id: r.code ?? r.id, name: r.name }))];
  const regionName = regionOptions.find((r) => r.id === region)?.name ?? region;
  const timeframeLong = TIMEFRAMES.find((t) => t.key === timeframe)?.long ?? "";

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportMenuRef.current && e.target instanceof Node && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [exportMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    const { from, to } = rangeFor(timeframe);
    const qs = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&region=${encodeURIComponent(region)}`;
    const getJson = async (url: string) => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Could not load ${url.split("?")[0].split("/").pop()} (${res.status})`);
      return res.json();
    };
    setLoading(true);
    setError(null);
    Promise.all([
      getJson(`/admin/stats/revenue-series${qs}`),
      getJson(`/admin/stats/active-properties-series${qs}`),
      getJson(`/admin/stats/revenue-by-type${qs}&groupBy=${groupBy}`),
      getJson(`/admin/stats/active-properties-breakdown?groupBy=${groupBy}&region=${encodeURIComponent(region)}`),
      getJson(`/admin/stats/invoice-stages?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    ])
      .then(([rev, props, revBreak, propsBreak, stages]) => {
        if (cancelled) return;
        setRevenueSeries(rev ?? { labels: [], data: [] });
        setPropertiesSeries(props ?? { labels: [], data: [] });
        setRevenueBreakdown(revBreak ?? { labels: [], data: [] });
        setPropertiesBreakdown(propsBreak ?? { labels: [], data: [] });
        setStageTotals(Array.isArray(stages?.totals) ? stages.totals : []);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || "Could not load the report data.");
        setRevenueSeries({ labels: [], data: [] });
        setPropertiesSeries({ labels: [], data: [] });
        setRevenueBreakdown({ labels: [], data: [] });
        setPropertiesBreakdown({ labels: [], data: [] });
        setStageTotals([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [region, timeframe, groupBy]);

  // ── Derived figures ────────────────────────────────────────────────────
  const revenueTotal = revenueSeries.data.reduce((s, v) => s + Number(v || 0), 0);
  const bestDay = revenueSeries.data.reduce((best, v, i) => (Number(v) > best.value ? { value: Number(v), label: revenueSeries.labels[i] } : best), { value: 0, label: "" });
  const propertiesNow = propertiesSeries.data.length ? propertiesSeries.data[propertiesSeries.data.length - 1] : 0;
  const propertiesStart = propertiesSeries.data.length ? propertiesSeries.data[0] : 0;

  // Bars and the properties line share one label list, matched by name. The
  // two endpoints return their groups in different orders, so pairing by
  // position would put a hotel's revenue next to a lodge's property count.
  const breakdown = useMemo(() => {
    const revenue = new Map(revenueBreakdown.labels.map((l, i) => [l, Number(revenueBreakdown.data[i] || 0)]));
    const properties = new Map(propertiesBreakdown.labels.map((l, i) => [l, Number(propertiesBreakdown.data[i] || 0)]));
    const labels = [...new Set([...revenue.keys(), ...properties.keys()])].sort(
      (a, b) => (revenue.get(b) ?? 0) - (revenue.get(a) ?? 0) || (properties.get(b) ?? 0) - (properties.get(a) ?? 0),
    );
    return { labels, revenue: labels.map((l) => revenue.get(l) ?? 0), properties: labels.map((l) => properties.get(l) ?? 0) };
  }, [revenueBreakdown, propertiesBreakdown]);

  const stageByKey = new Map(stageTotals.map((s) => [s.stage, s]));
  const stagesPresent = stageTotals.filter((s) => s.count > 0);
  const invoicesIssued = stageTotals.reduce((s, t) => s + t.count, 0);
  const pick = (...keys: string[]) => ({
    count: keys.reduce((s, k) => s + (stageByKey.get(k)?.count ?? 0), 0),
    net: keys.reduce((s, k) => s + (stageByKey.get(k)?.netPayable ?? 0), 0),
  });
  const disbursed = pick("DISBURSED");
  const owed = pick("GUEST_PAID", "IN_REVIEW", "DISBURSING", "ON_HOLD", "FAILED");
  const blocked = pick("ON_HOLD", "FAILED");

  // ── Chart configs ──────────────────────────────────────────────────────
  const revenueChart = {
    labels: revenueSeries.labels.map(dayLabel),
    datasets: [{
      label: "Guest money received (TZS)",
      data: revenueSeries.data,
      borderColor: "#02665e",
      backgroundColor: "rgba(2,102,94,0.10)",
      fill: true,
      tension: 0.35,
      pointRadius: revenueSeries.labels.length > 40 ? 0 : 3,
      pointHoverRadius: 5,
      pointBackgroundColor: "#02665e",
      borderWidth: 2,
    }],
  } as any;
  const revenueOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: { legend: { display: false }, tooltip: { ...TOOLTIP_STYLE, callbacks: { label: (c: any) => ` ${tzs(Number(c.raw || 0))}` } } },
    scales: { x: { ...AXIS_STYLE, ticks: { ...AXIS_STYLE.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: yAxis(fmtK, revenueSeries.data) },
  };

  const breakdownChart = {
    labels: breakdown.labels.map(humanize),
    datasets: [
      {
        label: "Revenue (TZS)",
        data: breakdown.revenue,
        backgroundColor: breakdown.labels.map((_, i) => BAR_PALETTE[i % BAR_PALETTE.length]),
        borderRadius: 6,
        yAxisID: "y",
        order: 2,
      },
      {
        label: "Live properties",
        data: breakdown.properties,
        type: "line" as any,
        borderColor: "#0b2420",
        backgroundColor: "#0b2420",
        borderWidth: 2,
        pointRadius: 4,
        tension: 0.3,
        yAxisID: "y1",
        order: 1,
      },
    ],
  } as any;
  const breakdownOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: { legend: { position: "bottom" as const, labels: { font: { size: 11 }, color: "#737373", boxWidth: 10, padding: 12 } }, tooltip: TOOLTIP_STYLE },
    scales: {
      x: { ...AXIS_STYLE, ticks: { ...AXIS_STYLE.ticks, maxRotation: 0, autoSkip: true } },
      y: yAxis(fmtK, breakdown.revenue),
      y1: { ...yAxis((v) => String(v), breakdown.properties), position: "right" as const, grid: { drawOnChartArea: false } },
    },
  };

  const propertiesChart = {
    labels: propertiesSeries.labels.map(dayLabel),
    datasets: [{
      label: "Live properties",
      data: propertiesSeries.data,
      borderColor: "#0ea5e9",
      backgroundColor: "rgba(14,165,233,0.10)",
      fill: true,
      stepped: true,
      pointRadius: 0,
      borderWidth: 2,
    }],
  } as any;
  const propertiesOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: { legend: { display: false }, tooltip: TOOLTIP_STYLE },
    scales: { x: { ...AXIS_STYLE, ticks: { ...AXIS_STYLE.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: yAxis((v) => String(v), propertiesSeries.data) },
  };

  const stagesChart = {
    labels: stagesPresent.map((s) => s.label),
    datasets: [{ data: stagesPresent.map((s) => s.count), backgroundColor: stagesPresent.map((s) => STAGE_COLORS[s.stage] ?? "#a3a3a3"), borderWidth: 0, hoverOffset: 6 }],
  } as any;

  // ── Export ─────────────────────────────────────────────────────────────
  const fileStem = `nolsaf-reports-${region === "ALL" ? "all-regions" : regionName.replace(/\s+/g, "-").toLowerCase()}-${timeframe}`;

  function exportCsv() {
    const rows: string[][] = [["section", "label", "revenue_tzs", "live_properties", "invoices", "net_payable_tzs"]];
    revenueSeries.labels.forEach((day, i) => rows.push(["Guest money by day", day, String(revenueSeries.data[i] ?? 0), String(propertiesSeries.data[i] ?? ""), "", ""]));
    breakdown.labels.forEach((l, i) => rows.push([groupBy === "region" ? "By region" : "By property type", humanize(l), String(breakdown.revenue[i]), String(breakdown.properties[i]), "", ""]));
    stageTotals.forEach((s) => rows.push(["Payout invoices by money stage", s.label, "", "", String(s.count), String(Math.round(s.netPayable))]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileStem}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  }

  function chartImages() {
    return [
      { c: revenueCanvas.current, title: "Guest money received" },
      { c: breakdownCanvas.current, title: groupBy === "region" ? "Revenue by region" : "Revenue by property type" },
      { c: propertiesCanvas.current, title: "Live properties" },
      { c: stagesCanvas.current, title: "Payout invoices by money stage" },
    ].map(({ c, title }) => ({ title, url: c ? c.toDataURL("image/png") : null }));
  }

  function exportPngs() {
    chartImages().forEach(({ title, url }) => {
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileStem}-${title.toLowerCase().replace(/\s+/g, "-")}.png`;
      a.click();
    });
    setExportMenuOpen(false);
  }

  function exportPrint() {
    setExportMenuOpen(false);
    const w = window.open("", "_blank");
    if (!w) {
      setError("The print window could not open. Please allow popups for this site.");
      return;
    }
    const sections = chartImages()
      .map(({ title, url }) => `<h2>${escapeHtml(title)}</h2>${url ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(title)}"/>` : "<p>Chart not available.</p>"}`)
      .join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(fileStem)}</title><style>body{font-family:"Trebuchet MS",Arial,sans-serif;color:#171717;margin:24px}h1{font-size:18px;margin:0}p.meta{color:#737373;font-size:12px;margin:4px 0 16px}h2{font-size:13px;margin:18px 0 6px}img{max-width:100%;border:1px solid #e5e5e5;border-radius:6px}</style></head><body><h1>Platform reports</h1><p class="meta">${escapeHtml(timeframeLong)} · ${escapeHtml(regionName)}</p>${sections}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  }

  return (
    <section id="general-reports-page" className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><BarChart3 className="h-4 w-4" /></span>
        <div className="mr-auto min-w-0">
          <h2 className="m-0 text-sm font-bold text-neutral-900">Platform reports</h2>
          <p className="m-0 text-xs text-neutral-500">{timeframeLong} · {regionName} · days in EAT</p>
        </div>
        <select value={region} onChange={(e) => setRegion(e.target.value)} className={fieldClass} aria-label="Region">
          {regionOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <Segmented label="Period" value={timeframe} onChange={setTimeframe} options={TIMEFRAMES.map((t) => ({ key: t.key, label: t.label }))} />
        <div className="relative" ref={exportMenuRef}>
          <button
            type="button"
            onClick={() => setExportMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          {exportMenuOpen && (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-solid border-neutral-200 bg-white p-1 shadow-lg">
              <button type="button" role="menuitem" onClick={() => exportCsv()} className={menuItemClass}>
                <FileSpreadsheet className="h-3.5 w-3.5 text-neutral-500" /> Spreadsheet (CSV)
              </button>
              <button type="button" role="menuitem" onClick={() => exportPngs()} className={menuItemClass}>
                <FileImage className="h-3.5 w-3.5 text-neutral-500" /> Chart images (PNG)
              </button>
              <button type="button" role="menuitem" onClick={() => exportPrint()} className={menuItemClass}>
                <Printer className="h-3.5 w-3.5 text-neutral-500" /> Print or save PDF
              </button>
            </div>
          )}
        </div>
        {loading && <RefreshCw className="h-4 w-4 animate-spin text-neutral-400" aria-label="Loading" />}
      </div>

      {/* Tabs */}
      <div className="flex gap-5 border-0 border-b border-solid border-neutral-200 px-4 sm:px-5" role="tablist">
        {([["financial", "Revenue and properties"], ["payouts", "Payout invoices"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
            className={`-mb-px border-0 border-b-2 border-solid bg-transparent px-0 py-2.5 text-sm font-semibold transition-colors ${activeTab === key ? "border-[#02665e] text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800 sm:mx-5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="space-y-4 p-4 sm:p-5">
        {activeTab === "financial" ? (
          <>
            <dl className="m-0 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-3">
              {[
                { label: "Guest money received", value: loading ? "..." : tzs(revenueTotal), detail: `${timeframeLong}, bookings and transport` },
                { label: "Best day", value: loading ? "..." : bestDay.value ? tzs(bestDay.value) : "None yet", detail: bestDay.label ? dayLabel(bestDay.label) : "No payments in this period" },
                { label: "Live properties", value: loading ? "..." : propertiesNow.toLocaleString(), detail: propertiesNow - propertiesStart > 0 ? `+${propertiesNow - propertiesStart} in this period` : "No new listings in this period" },
              ].map((f) => (
                <div key={f.label} className="min-w-0 bg-white px-4 py-3">
                  <dt className="text-[11px] text-neutral-500">{f.label}</dt>
                  <dd className="m-0 mt-0.5 truncate text-lg font-bold tabular-nums text-neutral-900">{f.value}</dd>
                  <dd className="m-0 truncate text-[11px] text-neutral-400">{f.detail}</dd>
                </div>
              ))}
            </dl>

            <Panel title="Guest money received" subtitle={`${timeframeLong}, by the day the guest paid`} aside={<span className="rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[11px] font-semibold text-[#02665e]">TZS</span>}>
              <div style={{ height: 240 }}>
                <Chart type="line" height={240} data={revenueChart} options={revenueOptions as any} onCanvas={(c) => { revenueCanvas.current = c; }} />
              </div>
            </Panel>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel
                title={groupBy === "region" ? "Revenue by region" : "Revenue by property type"}
                subtitle="Bars: guest money · line: live properties"
                aside={<Segmented label="Group by" value={groupBy} onChange={setGroupBy} options={[{ key: "propertyType", label: "Type" }, { key: "region", label: "Region" }]} />}
              >
                <div style={{ height: 260 }}>
                  {breakdown.labels.length ? (
                    <Chart type="bar" height={260} data={breakdownChart} options={breakdownOptions as any} onCanvas={(c) => { breakdownCanvas.current = c; }} />
                  ) : (
                    <p className="m-0 grid h-full place-items-center text-xs text-neutral-400">{loading ? "Loading..." : "No revenue or live properties to show."}</p>
                  )}
                </div>
              </Panel>
              <Panel title="Live properties" subtitle="Approved listings, counted from their listing date">
                <div style={{ height: 260 }}>
                  <Chart type="line" height={260} data={propertiesChart} options={propertiesOptions as any} onCanvas={(c) => { propertiesCanvas.current = c; }} />
                </div>
              </Panel>
            </div>
          </>
        ) : (
          <>
            <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200 lg:grid-cols-4">
              {[
                { label: "Invoices issued", value: loading ? "..." : invoicesIssued.toLocaleString(), detail: timeframeLong, tone: "text-neutral-900" },
                { label: "Disbursed to payees", value: loading ? "..." : tzs(disbursed.net), detail: `${disbursed.count} confirmed delivered`, tone: "text-emerald-700" },
                { label: "Owed to payees", value: loading ? "..." : tzs(owed.net), detail: `${owed.count} paid in, not yet delivered`, tone: owed.count ? "text-amber-700" : "text-neutral-900" },
                { label: "On hold or failed", value: loading ? "..." : blocked.count.toLocaleString(), detail: blocked.count ? tzs(blocked.net) : "Nothing blocked", tone: blocked.count ? "text-rose-700" : "text-neutral-900" },
              ].map((f) => (
                <div key={f.label} className="min-w-0 bg-white px-4 py-3">
                  <dt className="text-[11px] text-neutral-500">{f.label}</dt>
                  <dd className={`m-0 mt-0.5 truncate text-lg font-bold tabular-nums ${f.tone}`}>{f.value}</dd>
                  <dd className="m-0 truncate text-[11px] text-neutral-400">{f.detail}</dd>
                </div>
              ))}
            </dl>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="Invoices by money stage" subtitle={`Issued in the ${timeframeLong.toLowerCase()}`}>
                <div style={{ height: 260 }}>
                  {stagesPresent.length ? (
                    <Chart
                      type="doughnut"
                      height={260}
                      data={stagesChart}
                      options={{ responsive: true, maintainAspectRatio: false, cutout: "64%", plugins: { legend: { position: "right", labels: { font: { size: 11 }, color: "#525252", boxWidth: 10, padding: 10 } }, tooltip: TOOLTIP_STYLE } } as any}
                      onCanvas={(c) => { stagesCanvas.current = c; }}
                    />
                  ) : (
                    <p className="m-0 grid h-full place-items-center text-xs text-neutral-400">{loading ? "Loading..." : "No invoices issued in this period."}</p>
                  )}
                </div>
              </Panel>
              <Panel title="Net payable by stage" subtitle="What each stage is worth to payees, TZS">
                <ul className="m-0 list-none p-0">
                  {stageTotals.length ? stageTotals.map((s) => {
                    const max = Math.max(1, ...stageTotals.map((t) => t.netPayable));
                    return (
                      <li key={s.stage} className="border-0 border-t border-solid border-neutral-100 py-2 first:border-t-0">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="inline-flex min-w-0 items-center gap-2 text-neutral-700">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STAGE_COLORS[s.stage] ?? "#a3a3a3" }} />
                            <span className="truncate">{s.label}</span>
                            <span className="tabular-nums text-neutral-400">{s.count}</span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums text-neutral-900">{tzs(s.netPayable)}</span>
                        </div>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-neutral-100">
                          <span className="block h-full rounded-full" style={{ width: `${s.netPayable > 0 ? Math.max((s.netPayable / max) * 100, 2) : 0}%`, background: STAGE_COLORS[s.stage] ?? "#a3a3a3" }} />
                        </span>
                      </li>
                    );
                  }) : <li className="py-8 text-center text-xs text-neutral-400">{loading ? "Loading..." : "No invoices issued in this period."}</li>}
                </ul>
              </Panel>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
