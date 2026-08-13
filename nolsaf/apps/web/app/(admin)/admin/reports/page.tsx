"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Printer } from "lucide-react";

import Chart from "@/components/Chart";
import DatePickerField from "@/components/DatePickerField";
import NoLSAFReportsFrame, { NoLSAFReportTitle } from "@/components/admin/reports/NoLSAFReportsFrame";
import { fetchAccountSession } from "@/lib/accountSession";
import {
  adminReportPrintStyles,
  buildAdminReportFooter,
  buildAdminReportHeader,
  openAdminReportPrintWindow,
  renderAndPrintAdminReport,
} from "@/lib/adminReportPrint";
import { escapeAttr, escapeHtml } from "@/utils/html";

type Series = { labels: string[]; data: number[] };

type InvoiceStatusCounts = Record<string, number>;

type InvoiceRow = {
  id: number;
  invoiceNumber?: string | null;
  receiptNumber?: string | null;
  status?: string | null;
  issuedAt?: string | null;
  total?: number | null;
  netPayable?: number | null;
  booking?: {
    id?: number | null;
    property?: {
      id?: number | null;
      title?: string | null;
    } | null;
  } | null;
};

type DriverRevenueRow = {
  id?: number | null;
  commissionAmount?: number | null;
};

type TourRow = {
  id: number;
  bookingCode?: string | null;
  operatorName?: string | null;
  tourTitle?: string | null;
  destination?: string | null;
  numberOfPeople?: number | null;
  grossAmount?: number | null;
  commissionAmount?: number | null;
  currency?: string | null;
  status?: string | null;
  createdAt?: string | null;
};

type MeResponse = {
  fullName?: string;
  name?: string;
  email?: string;
  role?: string;
};

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseIsoDateOnly(iso: string): Date {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(iso || ""));
  if (!m) return new Date(NaN);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return new Date(NaN);
  return new Date(Date.UTC(y, mo - 1, d));
}

function addDaysUtc(dateUtc: Date, days: number): Date {
  return new Date(dateUtc.getTime() + days * 864e5);
}

const MAX_REPORT_DAYS_INCLUSIVE = 366;

function clampRangeToMax(fromIso: string, toIso: string) {
  const fromD = parseIsoDateOnly(fromIso);
  const toD = parseIsoDateOnly(toIso);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    return { from: fromIso, to: toIso, clamped: false, maxTo: null as string | null };
  }

  let from = fromD;
  let to = toD;
  if (to.getTime() < from.getTime()) {
    const tmp = from;
    from = to;
    to = tmp;
  }

  const maxToDate = addDaysUtc(from, MAX_REPORT_DAYS_INCLUSIVE - 1);
  const clamped = to.getTime() > maxToDate.getTime();
  if (clamped) to = maxToDate;

  return {
    from: formatDate(from),
    to: formatDate(to),
    clamped,
    maxTo: formatDate(maxToDate),
  };
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addMonthsUtc(dateUtc: Date, months: number) {
  const y = dateUtc.getUTCFullYear();
  const m = dateUtc.getUTCMonth();
  const d = dateUtc.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1));
  const daysInTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, daysInTargetMonth));
  return target;
}

function firstOfYearUtc(dateUtc = startOfTodayUtc()) {
  return new Date(Date.UTC(dateUtc.getUTCFullYear(), 0, 1));
}

type QuickRangeKey = "today" | "7d" | "30d" | "3m" | "6m" | "ytd" | "12m";

function getQuickRange(key: QuickRangeKey) {
  const end = startOfTodayUtc();
  let start = end;

  if (key === "today") start = end;
  if (key === "7d") start = addDaysUtc(end, -6);
  if (key === "30d") start = addDaysUtc(end, -29);
  if (key === "3m") start = addMonthsUtc(end, -3);
  if (key === "6m") start = addMonthsUtc(end, -6);
  if (key === "12m") start = addMonthsUtc(end, -12);
  if (key === "ytd") start = firstOfYearUtc(end);

  const clamped = clampRangeToMax(formatDate(start), formatDate(end));
  return { from: clamped.from, to: clamped.to };
}

async function safeJson(response: Response) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 160)}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`Expected JSON but got ${contentType}: ${text.substring(0, 160)}`);
  }
  return response.json();
}

function fmtDateTime(isoOrDate: string | Date) {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sum(nums: unknown[]): number {
  return nums.reduce((acc: number, v) => acc + (Number(v) || 0), 0);
}

function fmtMoneyTZS(n: number) {
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

// Tours are USD-denominated; show 2 decimals to match foreign-currency money.
function fmtMoneyUSD(n: number) {
  try {
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

function calcCommissionPct(total: unknown, netPayable: unknown): number | null {
  const t = Number(total);
  const net = Number(netPayable);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (!Number.isFinite(net) || net < 0) return null;
  const comm = t - net;
  if (!Number.isFinite(comm) || comm < 0) return null;
  return (comm / t) * 100;
}

function calcCommissionAmount(total: unknown, netPayable: unknown): number | null {
  const t = Number(total);
  const net = Number(netPayable);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (!Number.isFinite(net) || net < 0) return null;
  const comm = t - net;
  if (!Number.isFinite(comm) || comm < 0) return null;
  return comm;
}

function fmtPct(p: number | null, decimals = 1) {
  if (p === null) return "—";
  const n = Math.max(0, Math.min(100, p));
  const f = decimals <= 0 ? String(Math.round(n)) : n.toFixed(decimals);
  return `${f}%`;
}

export default function AdminReportsPage() {
  const today = new Date();
  const [from, setFrom] = useState(() => formatDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(() => formatDate(today));

  const clampInfo = useMemo(() => clampRangeToMax(from, to), [from, to]);

  const applyRange = useCallback((nextFrom: string, nextTo: string) => {
    const clamped = clampRangeToMax(nextFrom, nextTo);
    setFrom(clamped.from);
    setTo(clamped.to);
  }, []);

  const [me, setMe] = useState<MeResponse | null>(null);

  const [revenueSeries, setRevenueSeries] = useState<Series>({ labels: [], data: [] });
  const [activePropsSeries, setActivePropsSeries] = useState<Series>({ labels: [], data: [] });
  const [revenueByType, setRevenueByType] = useState<Series>({ labels: [], data: [] });
  const [invoiceStatusCounts, setInvoiceStatusCounts] = useState<InvoiceStatusCounts>({});
  const [invoiceItems, setInvoiceItems] = useState<InvoiceRow[]>([]);

  const [ownerCommissionTotal, setOwnerCommissionTotal] = useState<number | null>(null);
  const [driverCommissionTotal, setDriverCommissionTotal] = useState<number | null>(null);
  const [tourCommissionTotal, setTourCommissionTotal] = useState<number | null>(null);
  const [tourCommissionCurrency, setTourCommissionCurrency] = useState<string>("USD");
  const [tourRows, setTourRows] = useState<TourRow[]>([]);
  const [subscriptionRevenueTotal, setSubscriptionRevenueTotal] = useState<number | null>(null);
  const [totalsLoading, setTotalsLoading] = useState(false);

  const [loading, setLoading] = useState(false);

  const [revCanvas, setRevCanvas] = useState<HTMLCanvasElement | null>(null);
  const [statusCanvas, setStatusCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchAccountSession();
        if (!r.ok) return;
        setMe((r.data || null) as MeResponse | null);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      setLoading(true);
      try {
        const qs = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&region=${encodeURIComponent("ALL")}`;

        const r1 = await fetch(`/admin/stats/revenue-series${qs}`, { credentials: "include", signal });
        const rev = (await safeJson(r1)) as Series;
        setRevenueSeries(rev || { labels: [], data: [] });

        const r2 = await fetch(`/admin/stats/active-properties-series${qs}`, { credentials: "include", signal });
        const ap = (await safeJson(r2)) as Series;
        setActivePropsSeries(ap || { labels: [], data: [] });

        const r3 = await fetch(`/admin/stats/revenue-by-type${qs}`, { credentials: "include", signal });
        const rbt = (await safeJson(r3)) as Series;
        setRevenueByType(rbt || { labels: [], data: [] });

        const r4 = await fetch(`/admin/stats/invoice-status?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
          credentials: "include",
          signal,
        });
        const invs = (await safeJson(r4)) as InvoiceStatusCounts;
        setInvoiceStatusCounts(invs || {});

        const r5 = await fetch(
          `/api/admin/revenue/invoices?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=1&pageSize=200&sortBy=issuedAt&sortDir=desc`,
          { credentials: "include", signal }
        );
        const invList = (await safeJson(r5)) as any;
        const items = Array.isArray(invList?.items) ? (invList.items as InvoiceRow[]) : [];
        setInvoiceItems(items);

        setTotalsLoading(true);

        const fetchOwnerCommission = async () => {
          let page = 1;
          const pageSize = 500;
          let totalComm = 0;
          let safety = 0;
          while (true) {
            const rr = await fetch(
              `/api/admin/revenue/invoices?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=${page}&pageSize=${pageSize}&sortBy=issuedAt&sortDir=desc`,
              { credentials: "include", signal }
            );
            const data = (await safeJson(rr)) as any;
            const rows = Array.isArray(data?.items) ? (data.items as InvoiceRow[]) : [];
            for (const inv of rows) {
              const comm = calcCommissionAmount(inv?.total, inv?.netPayable);
              if (comm !== null) totalComm += comm;
            }

            const reportedTotal = Number(data?.total ?? 0);
            const hasMoreByCount = Number.isFinite(reportedTotal) && reportedTotal > 0 ? page * pageSize < reportedTotal : rows.length === pageSize;
            if (!hasMoreByCount) break;

            page += 1;
            safety += 1;
            if (safety > 40) break;
          }
          return totalComm;
        };

        const fetchDriverCommission = async () => {
          let page = 1;
          const pageSize = 200;
          let totalComm = 0;
          let safety = 0;
          while (true) {
            const rr = await fetch(
              `/api/admin/drivers/revenues?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}&page=${page}&pageSize=${pageSize}`,
              { credentials: "include", signal }
            );
            const data = (await safeJson(rr)) as any;
            const rows = Array.isArray(data?.items) ? (data.items as DriverRevenueRow[]) : [];
            for (const row of rows) {
              totalComm += Number(row?.commissionAmount) || 0;
            }

            const reportedTotal = Number(data?.total ?? 0);
            const hasMoreByCount = Number.isFinite(reportedTotal) && reportedTotal > 0 ? page * pageSize < reportedTotal : rows.length === pageSize;
            if (!hasMoreByCount) break;

            page += 1;
            safety += 1;
            if (safety > 40) break;
          }
          return totalComm;
        };

        // Tour commission: the overview endpoint returns ALL tour revenue
        // records (no server-side date filter / pagination), so we fetch once
        // and filter client-side by createdAt within [from, to]. We recognise
        // commission for customer-paid tours only (the API derives DRAFT when
        // the customer has not paid yet), consistent with the backend overview.
        const fetchTourCommission = async (): Promise<{ total: number; rows: TourRow[]; currency: string }> => {
          const rr = await fetch(`/api/admin/tour-revenue/overview`, { credentials: "include", signal });
          const data = (await safeJson(rr)) as any;
          const rows: any[] = Array.isArray(data?.revenues) ? data.revenues : [];
          const rangeStart = new Date(`${from}T00:00:00.000Z`).getTime();
          const rangeEndExclusive = new Date(`${to}T00:00:00.000Z`).getTime() + 864e5;
          let totalComm = 0;
          let currency = String(data?.agentCommissionCurrency || "").trim() || "USD";
          const inRange: TourRow[] = [];
          for (const row of rows) {
            if (String(row?.status || "").toUpperCase() === "DRAFT") continue;
            const ts = row?.createdAt ? new Date(row.createdAt).getTime() : NaN;
            if (!Number.isFinite(ts) || ts < rangeStart || ts >= rangeEndExclusive) continue;
            totalComm += Number(row?.commissionAmount) || 0;
            if (row?.currency) currency = String(row.currency);
            inRange.push({
              id: Number(row?.id),
              bookingCode: row?.bookingCode ?? null,
              operatorName: row?.operatorName ?? null,
              tourTitle: row?.tourTitle ?? null,
              destination: row?.destination ?? null,
              numberOfPeople: row?.numberOfPeople ?? null,
              grossAmount: row?.grossAmount ?? null,
              commissionAmount: row?.commissionAmount ?? null,
              currency: row?.currency ?? null,
              status: row?.status ?? null,
              createdAt: row?.createdAt ?? null,
            });
          }
          return { total: totalComm, rows: inRange, currency };
        };

        const fetchSubscriptionRevenue = async (): Promise<number | null> => {
          const rangeFrom = `${from}T00:00:00.000Z`;
          const rangeTo = `${to}T23:59:59.999Z`;
          const rr = await fetch(
            `/api/admin/finance/overview?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
            { credentials: "include", signal }
          );
          const data = (await safeJson(rr)) as any;
          const streams = Array.isArray(data?.streams) ? data.streams : [];
          const subscription = streams.find((stream: any) => String(stream?.key) === "subscriptions");
          if (!subscription) return null;
          const amount = Number(subscription?.nolsafRevenue);
          return Number.isFinite(amount) ? amount : null;
        };

        const [ownerComm, driverComm, tourResult, subscriptionRevenue] = await Promise.all([
          fetchOwnerCommission().catch(() => null),
          fetchDriverCommission().catch(() => null),
          fetchTourCommission().catch(() => null),
          fetchSubscriptionRevenue().catch(() => null),
        ]);

        setOwnerCommissionTotal(ownerComm);
        setDriverCommissionTotal(driverComm);
        setTourCommissionTotal(tourResult ? tourResult.total : null);
        setTourRows(tourResult ? tourResult.rows : []);
        if (tourResult?.currency) setTourCommissionCurrency(tourResult.currency);
        setSubscriptionRevenueTotal(subscriptionRevenue);
      } catch (err: any) {
        if (String(err?.name) === "AbortError") return;
        console.error("Failed to load admin reports", err);
        setRevenueSeries({ labels: [], data: [] });
        setActivePropsSeries({ labels: [], data: [] });
        setRevenueByType({ labels: [], data: [] });
        setInvoiceStatusCounts({});
        setInvoiceItems([]);
        setOwnerCommissionTotal(null);
        setDriverCommissionTotal(null);
        setTourCommissionTotal(null);
        setTourRows([]);
        setSubscriptionRevenueTotal(null);
      } finally {
        setLoading(false);
        setTotalsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [from, to]);

  const printedByName = (me?.fullName || me?.name || "Admin").toString();
  const printedByEmail = (me?.email || "").toString();

  const totalRevenue = useMemo(() => sum(revenueSeries.data || []), [revenueSeries.data]);
  const totalActive = useMemo(() => {
    const arr = activePropsSeries.data || [];
    return arr.length ? Number(arr[arr.length - 1]) || 0 : 0;
  }, [activePropsSeries.data]);

  const invoicesTotal = useMemo(() => sum(Object.values(invoiceStatusCounts || {})), [invoiceStatusCounts]);

  // TZS subtotal: owner plus driver commission (plus subscriptions when enforced).
  // Tour commission is USD and is reported separately, never summed in here.
  const totalNoLSAFRevenue = useMemo(() => {
    const owner = ownerCommissionTotal ?? 0;
    const driver = driverCommissionTotal ?? 0;
    const subs = subscriptionRevenueTotal ?? 0;
    if (ownerCommissionTotal === null && driverCommissionTotal === null && subscriptionRevenueTotal === null)
      return null;
    return owner + driver + subs;
  }, [driverCommissionTotal, ownerCommissionTotal, subscriptionRevenueTotal]);

  const chartPalette = useMemo(() => ["#02665e", "#f59e0b", "#4f46e5"] as const, []);

  const revenueChartData = useMemo(() => {
    const labels = (revenueSeries.labels || []).map((x) => String(x ?? ""));
    const revenue = (revenueSeries.data || []).map((x) => Number(x) || 0);

    const windowSize = 7;
    const avg = revenue.map((_, idx) => {
      const start = Math.max(0, idx - (windowSize - 1));
      const slice = revenue.slice(start, idx + 1);
      const total = slice.reduce((acc, v) => acc + (Number(v) || 0), 0);
      return slice.length ? total / slice.length : 0;
    });

    let fill: any = "rgba(2,102,94,0.18)";
    try {
      const ctx = revCanvas?.getContext?.("2d") ?? null;
      if (ctx && revCanvas) {
        const h = Math.max(1, Number(revCanvas.height) || 220);
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(2,102,94,0.28)");
        g.addColorStop(1, "rgba(2,102,94,0.00)");
        fill = g;
      }
    } catch {
      // ignore
    }

    return {
      labels,
      datasets: [
        {
          label: "Revenue",
          data: revenue,
          backgroundColor: fill,
          borderColor: "#02665e",
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 0,
        },
        {
          label: "Trend",
          data: avg,
          backgroundColor: "transparent",
          borderColor: "#f59e0b",
          borderWidth: 2,
          tension: 0.35,
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 0,
        },
      ],
    };
  }, [revCanvas, revenueSeries]);

  const invoiceStatusChartData = useMemo(() => {
    const entries = Object.entries(invoiceStatusCounts || {})
      .filter(([, v]) => Number(v) > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));

    const labels = entries.map(([k]) => k);
    const data = entries.map(([, v]) => Number(v) || 0);
    const colors = labels.map((_, idx) => chartPalette[idx % chartPalette.length]);

    return {
      labels,
      datasets: [
        {
          label: "Invoice status",
          data,
          backgroundColor: colors,
          borderColor: "#ffffff",
          borderWidth: 2,
        },
      ],
    };
  }, [invoiceStatusCounts, chartPalette]);

  const revenueByTypeBreakdown = useMemo(() => {
    const labels = Array.isArray(revenueByType?.labels) ? revenueByType.labels : [];
    const data = Array.isArray(revenueByType?.data) ? revenueByType.data : [];

    const items = labels
      .map((label, idx) => ({
        label: String(label ?? "").trim() || "Other",
        value: Number(data[idx]) || 0,
      }))
      .filter((x) => x.value > 0);

    items.sort((a, b) => b.value - a.value);

    const palette = [
      { key: /hotel/i, color: "#02665e", soft: "rgba(2,102,94,0.20)" },
      { key: /lodge/i, color: "#0f172a", soft: "rgba(15,23,42,0.18)" },
      { key: /apartment/i, color: "#4f46e5", soft: "rgba(79,70,229,0.20)" },
      { key: /villa/i, color: "#f59e0b", soft: "rgba(245,158,11,0.24)" },
    ];

    const fallback = ["#02665e", "#0f172a", "#4f46e5", "#f59e0b"];

    function colorFor(label: string, idx: number) {
      const hit = palette.find((p) => p.key.test(label));
      if (hit) return { color: hit.color, soft: hit.soft };
      const c = fallback[idx % fallback.length];
      if (c === "#0f172a") return { color: c, soft: "rgba(15,23,42,0.18)" };
      if (c === "#4f46e5") return { color: c, soft: "rgba(79,70,229,0.20)" };
      if (c === "#f59e0b") return { color: c, soft: "rgba(245,158,11,0.24)" };
      return { color: c, soft: "rgba(2,102,94,0.20)" };
    }

    const total = items.reduce((acc, it) => acc + (Number(it.value) || 0), 0);
    const withColors = items.map((it, idx) => ({
      ...it,
      ...colorFor(it.label, idx),
      pct: total > 0 ? (it.value / total) * 100 : 0,
    }));

    return { items: withColors, total };
  }, [revenueByType]);

  // Classify the gross TZS payment by source. The property invoice portion is
  // exactly the "gross booking value by property type" total (same paid-invoice
  // filter), so transport is the remainder of the TZS revenue series. Tour is
  // USD and is reported on its own, never folded into the TZS figure.
  const grossPaymentBreakdown = useMemo(() => {
    const propertyTzs = Math.round(Number(revenueByTypeBreakdown.total) || 0);
    const tzsTotal = Math.round(Number(totalRevenue) || 0);
    const transportTzs = Math.max(0, tzsTotal - propertyTzs);
    const tourUsd = (tourRows || []).reduce((acc, t) => acc + (Number(t.grossAmount) || 0), 0);
    return { propertyTzs, transportTzs, tzsTotal, tourUsd };
  }, [revenueByTypeBreakdown.total, totalRevenue, tourRows]);

  async function printReport(mode: "full" | "revenueOnly" = "full") {
    const printWindow = openAdminReportPrintWindow();
    if (!printWindow) {
      alert("Unable to open the report preview. Please allow popups and try again.");
      return;
    }
    const now = new Date();
    const reportId = now.toISOString();
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const reportFilename = `NoLSAF-RPT-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}_${from}_${to}`;

    // Seal the report server side, then encode the public verification URL as a
    // QR. Anyone can scan it to confirm the report is genuine without logging in.
    let reportRef = `RPT-${from.replace(/-/g, "")}-${to.replace(/-/g, "")}-${reportId.slice(11, 19).replace(/:/g, "")}`;
    let qrDataUrl: string | null = null;
    try {
      const sealRes = await fetch("/api/reports/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "REVENUE",
          title: "NoLSAF Revenue Report",
          ref: reportRef,
          from,
          to,
          figures: [
            { label: "Gross payment (TZS)", value: `TZS ${fmtMoneyTZS(Math.round(totalRevenue))}` },
            { label: "Property invoices (TZS)", value: `TZS ${fmtMoneyTZS(grossPaymentBreakdown.propertyTzs)}` },
            { label: "Transport (TZS)", value: `TZS ${fmtMoneyTZS(grossPaymentBreakdown.transportTzs)}` },
            { label: "Owner commission (TZS)", value: ownerCommissionTotal === null ? "n/a" : `TZS ${fmtMoneyTZS(Math.round(ownerCommissionTotal))}` },
            { label: "Driver commission (TZS)", value: driverCommissionTotal === null ? "n/a" : `TZS ${fmtMoneyTZS(Math.round(driverCommissionTotal))}` },
            { label: `Tour commission (${tourCommissionCurrency})`, value: tourCommissionTotal === null ? "n/a" : `${tourCommissionCurrency} ${fmtMoneyUSD(tourCommissionTotal)}` },
            { label: "Total NoLSAF (TZS)", value: totalNoLSAFRevenue === null ? "n/a" : `TZS ${fmtMoneyTZS(Math.round(totalNoLSAFRevenue))}` },
            { label: "Active properties", value: String(totalActive) },
            { label: "Invoices (all statuses)", value: String(invoicesTotal) },
          ],
        }),
      });
      const sealJson: any = await safeJson(sealRes);
      if (sealJson?.token) {
        reportRef = String(sealJson.ref || reportRef);
        const verifyUrl = new URL("/verify", window.location.origin);
        verifyUrl.searchParams.set("t", String(sealJson.token));
        const QR: any = await import("qrcode");
        const toDataURL: any = QR?.toDataURL ?? QR?.default?.toDataURL;
        if (typeof toDataURL === "function") {
          qrDataUrl = await toDataURL(verifyUrl.toString(), { margin: 1, width: 320, errorCorrectionLevel: "M" });
        }
      }
    } catch {
      qrDataUrl = null;
    }

    const logoUrl = new URL("/assets/NoLS2025-04.png", window.location.origin).toString();

    // CODE128 barcode of the report reference for the header band.
    let reportIdBarcode: string | null = null;
    try {
      const mod: any = await import("jsbarcode");
      const JsBarcode: any = mod?.default ?? mod;
      const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(svgNode, reportRef, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        width: 1.1,
        height: 30,
        background: "#ffffff",
        lineColor: "#0b1220",
      });
      const serialized = new XMLSerializer().serializeToString(svgNode);
      reportIdBarcode = `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(serialized)))}`;
    } catch {
      reportIdBarcode = null;
    }

    const revImg = revCanvas ? revCanvas.toDataURL("image/png") : null;
    const statusImg = statusCanvas ? statusCanvas.toDataURL("image/png") : null;
    const typeItems = revenueByTypeBreakdown.items || [];
    const typeTotal = revenueByTypeBreakdown.total || 0;

    const typeSegs = typeItems
      .map((it) => {
        const pct = Math.max(0, Math.min(100, it.pct || 0));
        return `<span class="typeSeg" style="width:${pct}%; background:${escapeAttr(it.color)}"></span>`;
      })
      .join("");

    const typeLegend = typeItems
      .slice(0, 10)
      .map((it) => {
        const pctText = typeTotal > 0 ? `${Math.round(it.pct)}%` : "0%";
        return `<div class="typeItem"><span class="dot" style="background:${escapeAttr(it.color)}"></span><div class="name">${escapeHtml(it.label)}</div><div class="pct">${escapeHtml(pctText)}</div><div class="val">TZS ${escapeHtml(fmtMoneyTZS(Number(it.value) || 0))}</div></div>`;
      })
      .join("");

    const invRows = Object.entries(invoiceStatusCounts || {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => {
        return `<tr><td>${escapeHtml(k)}</td><td style="text-align:right; font-weight:700;">${escapeHtml(String(v ?? 0))}</td></tr>`;
      })
      .join("\n");

    const ownerCommText = ownerCommissionTotal === null ? "—" : `TZS ${fmtMoneyTZS(Math.round(ownerCommissionTotal))}`;
    const driverCommText = driverCommissionTotal === null ? "—" : `TZS ${fmtMoneyTZS(Math.round(driverCommissionTotal))}`;
    const tourCommText = tourCommissionTotal === null ? "—" : `${tourCommissionCurrency} ${fmtMoneyUSD(tourCommissionTotal)}`;
    const subsText = subscriptionRevenueTotal === null ? "â€”" : `TZS ${fmtMoneyTZS(Math.round(subscriptionRevenueTotal))}`;
    const totalText = totalNoLSAFRevenue === null ? "—" : `TZS ${fmtMoneyTZS(Math.round(totalNoLSAFRevenue))}`;

    const revenueSourcesSection = `
    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">01</span><div><h2>NoLSAF revenue sources</h2><p>Platform earnings separated from customer payment volume.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Source</th><th style="text-align:right;text-transform:none;">NoLSAF revenue</th></tr></thead>
        <tbody>
          <tr><td style="border-left:3px solid #10b981;background:#effbf6">Owner commission from property bookings</td><td class="num" style="color:#047857">${escapeHtml(ownerCommText)}</td></tr>
          <tr><td style="border-left:3px solid #0ea5e9;background:#eff8ff">Driver commission from transport trips</td><td class="num" style="color:#0369a1">${escapeHtml(driverCommText)}</td></tr>
          <tr><td style="border-left:3px solid #8b5cf6;background:#f5f3ff">NRMS subscription revenue</td><td class="num" style="color:#6d28d9">${escapeHtml(subsText)}</td></tr>
          <tr><td style="border-left:3px solid #073c35;background:#eef5f3"><strong>Total NoLSAF revenue in TZS</strong></td><td class="num" style="color:#073c35"><strong>${escapeHtml(totalText)}</strong></td></tr>
          <tr><td style="border-left:3px solid #f59e0b;background:#fffbeb">Tour commission reported separately</td><td class="num" style="color:#a16207">${escapeHtml(tourCommText)}</td></tr>
        </tbody>
      </table></div>
      <div class="reportNote">The TZS total combines owner commission, driver commission, and verified or reconciled NRMS subscription revenue. Tour commission settles in ${escapeHtml(tourCommissionCurrency)} and remains separate, so unlike currencies are never summed.</div>
    </section>`;

    const detailRows = (invoiceItems || [])
      .slice(0, 60)
      .map((inv) => {
        const propTitle = inv?.booking?.property?.title || "—";
        const issued = inv?.issuedAt ? fmtDateTime(inv.issuedAt) : "—";
        const total = `TZS ${fmtMoneyTZS(Number(inv?.total || 0))}`;
        const net = `TZS ${fmtMoneyTZS(Number(inv?.netPayable || 0))}`;
        const commPct = fmtPct(calcCommissionPct(inv?.total, inv?.netPayable), 1);
        const commAmtRaw = calcCommissionAmount(inv?.total, inv?.netPayable);
        const commAmt = commAmtRaw === null ? "—" : `TZS ${fmtMoneyTZS(commAmtRaw)}`;
        const invNo = inv?.invoiceNumber || `#${inv?.id}`;
        const status = inv?.status || "—";

        return `\n<tr>\n  <td>${escapeHtml(String(invNo))}</td>\n  <td>${escapeHtml(String(status))}</td>\n  <td>${escapeHtml(String(issued))}</td>\n  <td>${escapeHtml(String(propTitle))}</td>\n  <td style=\"text-align:right;\">${escapeHtml(String(total))}</td>\n  <td style=\"text-align:right;\">${escapeHtml(String(net))}</td>\n  <td style=\"text-align:right; color: var(--brand); font-weight:400;\">${escapeHtml(String(commAmt))}</td>\n  <td style=\"text-align:right; font-weight:400;\">${escapeHtml(String(commPct))}</td>\n</tr>`;
      })
      .join("\n");

    // Tour activities (details): the description of tour activities undertaken.
    const tourDetailRows = (tourRows || [])
      .slice(0, 60)
      .map((t) => {
        const code = t?.bookingCode || `#${t?.id}`;
        const operator = t?.operatorName || "—";
        const activity = [t?.tourTitle || "—", t?.destination ? `· ${t.destination}` : ""].join(" ").trim();
        const travelers = t?.numberOfPeople === null || t?.numberOfPeople === undefined ? "—" : String(t.numberOfPeople);
        const cur = t?.currency || tourCommissionCurrency;
        const gross = t?.grossAmount === null || t?.grossAmount === undefined ? "—" : `${cur} ${fmtMoneyUSD(Number(t.grossAmount) || 0)}`;
        const comm = t?.commissionAmount === null || t?.commissionAmount === undefined ? "—" : `${cur} ${fmtMoneyUSD(Number(t.commissionAmount) || 0)}`;
        const status = t?.status || "—";
        const created = t?.createdAt ? fmtDateTime(t.createdAt) : "—";
        return `\n<tr>\n  <td>${escapeHtml(String(code))}</td>\n  <td>${escapeHtml(String(operator))}</td>\n  <td>${escapeHtml(String(activity))}</td>\n  <td style=\"text-align:right;\">${escapeHtml(String(travelers))}</td>\n  <td style=\"text-align:right;\">${escapeHtml(String(gross))}</td>\n  <td style=\"text-align:right; color: #b45309; font-weight:400;\">${escapeHtml(String(comm))}</td>\n  <td>${escapeHtml(String(status))}</td>\n  <td>${escapeHtml(String(created))}</td>\n</tr>`;
      })
      .join("\n");

    const tourDetailSection = `
    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">05</span><div><h2>Tour activity register</h2><p>Booked activities, operators, values, commission, and recorded status.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr>
          <th>Booking</th><th>Operator</th><th>Activity</th>
          <th style="text-align:right;">Travelers</th><th style="text-align:right;">Gross</th>
          <th style="text-align:right;">Commission</th><th>Status</th><th>Created</th>
        </tr></thead>
        <tbody>${tourRows && tourRows.length ? tourDetailRows : `<tr><td colspan="8" class="emptyState">No tour activities were recorded in this period.</td></tr>`}</tbody>
      </table></div>
    </section>`;

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(reportFilename)}</title>
  <style>
    :root { --ink:#0b1220; --muted:#5b6472; --line:#e5e7eb; --brand:#02665e; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color:var(--ink); background:#fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 22px; }
    .sheet { border: 1px solid var(--line); border-radius: 16px; padding: 14px; }

    .company { display:flex; align-items:center; justify-content:space-between; gap:14px; border:1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
    .company-left { display:flex; align-items:center; gap:12px; min-width:0; }
    .logo { width: 46px; height: 46px; object-fit: contain; }
    .co-name { font-weight: 900; letter-spacing: -0.02em; }
    .co-meta { margin-top: 2px; font-size: 11px; color: var(--muted); line-height: 1.35; }
    .co-meta span { white-space: nowrap; }

    .title { margin-top: 12px; display:flex; justify-content:space-between; align-items:flex-end; gap: 12px; }
    h1 { margin:0; font-size: 18px; letter-spacing: -0.02em; }
    .sub { margin-top: 4px; color: var(--muted); font-size: 11px; }

    .meta { margin-top: 12px; display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .card { border:1px solid var(--line); border-radius: 14px; padding: 10px 12px; }
    .kv { display:grid; grid-template-columns: 120px 1fr; gap: 6px 10px; font-size: 11px; }
    .k { color: var(--muted); }
    .v { font-weight: 700; }

    .kpis { margin-top: 10px; display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .kpi { border:1px solid var(--line); border-radius: 14px; padding: 10px 12px; }
    .kpi .t { color: var(--muted); font-size: 10px; }
    .kpi .n { margin-top: 2px; font-size: 15px; font-weight: 900; }

    .section { margin-top: 14px; }
    .section h2 { margin: 0 0 8px; font-size: 12px; letter-spacing: -0.01em; }

    .charts { display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .chartTitle { margin: 0 0 6px; font-size: 11px; font-weight: 900; letter-spacing: -0.01em; }

    .chart { border:1px solid var(--line); border-radius: 14px; padding: 10px 12px; }
    .chart img { width: 100%; height: auto; display:block; border-radius: 10px; border: 1px solid rgba(229,231,235,0.8); }

    .typeLine { margin-top: 2px; height: 14px; border-radius: 999px; background: #f8fafc; border: 1px solid rgba(229,231,235,0.9); overflow:hidden; display:flex; }
    .typeSeg { height: 100%; display:block; }
    .typeLegend { margin-top: 10px; display:grid; grid-template-columns: 1fr; gap: 6px; }
    .typeItem { display:grid; grid-template-columns: 14px 1fr auto auto; gap: 8px; align-items:center; font-size: 10px; }
    .typeItem .dot { width: 10px; height: 10px; border-radius: 3px; display:inline-block; }
    .typeItem .name { color: var(--ink); font-weight: 700; min-width: 0; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
    .typeItem .pct { color: var(--muted); font-weight: 700; }
    .typeItem .val { color: var(--ink); font-weight: 900; text-align:right; white-space: nowrap; }

    table { width:100%; border-collapse: collapse; border:1px solid var(--line); border-radius: 14px; overflow:hidden; }
    thead th { font-size: 10px; text-align:left; color: var(--muted); background:#f8fafc; padding: 9px 10px; border-bottom:1px solid var(--line); }
    tbody td { font-size: 11px; padding: 8px 10px; border-bottom: 1px solid rgba(229,231,235,0.8); }
    tbody tr:last-child td { border-bottom: none; }

    .details td, .details th { font-size: 10px; padding: 7px 8px; }
    .details td:nth-child(4) { max-width: 240px; }
    .details td:nth-child(1), .details td:nth-child(4) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .idbar { height: 26px; width: auto; max-width: 190px; margin-top: 5px; display:inline-block; }
    .idbarRef { margin-top: 2px; font-size: 8px; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); }

    .footer { margin-top: 18px; padding-top: 12px; border-top: 2px solid var(--line); break-inside: avoid; page-break-inside: avoid; }
    .auditLine { font-size: 11px; color: var(--muted); margin-bottom: 12px; }
    .auditLine strong { color: var(--ink); }

    .footRow { display:flex; gap: 22px; align-items:stretch; }

    .refBox { flex-shrink: 0; display:flex; flex-direction:column; align-items:center; gap: 6px; border:1px solid var(--line); border-radius: 12px; padding: 10px 12px; background:#fff; align-self:flex-start; }
    .refBox img { width: 126px; height: 126px; display:block; }
    .refLabel { font-size: 9px; font-weight: 900; letter-spacing: 0.02em; color: var(--ink); }

    .compliance { flex: 1; min-width: 0; font-size: 9.5px; color: var(--muted); line-height: 1.55; }
    .compliance .cTitle { font-weight: 900; color: var(--ink); letter-spacing: 0.14em; text-transform: uppercase; font-size: 8.5px; margin-bottom: 4px; }

    .sealWrap { width: 210px; flex-shrink: 0; border-left: 1px solid var(--line); padding-left: 22px; display:flex; flex-direction:column; }
    .sigGap { flex: 1; min-height: 48px; }
    .sig { border-top: 1px solid #111827; padding-top: 6px; font-size: 11px; font-weight: 700; color: var(--ink); text-align:center; }
    .sigMeta { margin-top: 4px; font-size: 9px; color: var(--muted); text-align:center; line-height: 1.4; }

    @media print {
      @page { size: A4; margin: 12mm; }
      .page { padding: 0; }
      .sheet { border-radius: 14px; padding: 12px; }
    }
    ${adminReportPrintStyles(mode === "full" ? "landscape" : "portrait")}
  </style>
</head>
<body>
  <div class="reportPage">
    <main class="reportDocument">
    ${buildAdminReportHeader({
      logoUrl,
      eyebrow: mode === "revenueOnly" ? "NoLSAF finance control" : "NoLSAF management reporting",
      title: mode === "revenueOnly" ? "Revenue summary" : "Finance and operations report",
      description: mode === "revenueOnly" ? "A focused statement of NoLSAF platform earnings and supporting payment volume." : "A consolidated view of platform revenue, invoices, transport, properties, and tour activity.",
      reportId,
      reportRef,
      barcodeDataUrl: reportIdBarcode,
      from,
      to,
      generatedAt: fmtDateTime(reportId),
      preparedBy: printedByEmail ? `${printedByName} · ${printedByEmail}` : printedByName,
      classification: "Finance and management use",
    })}

    <div class="metricGrid">
      <div class="metricCard metricCardGood"><span class="metricLabel">Gross payment volume</span><strong>TZS ${escapeHtml(fmtMoneyTZS(totalRevenue))}</strong><small>Property invoices TZS ${escapeHtml(fmtMoneyTZS(grossPaymentBreakdown.propertyTzs))}. Transport TZS ${escapeHtml(fmtMoneyTZS(grossPaymentBreakdown.transportTzs))}. This is turnover, not NoLSAF revenue.</small></div>
      <div class="metricCard"><span class="metricLabel">Active properties</span><strong>${escapeHtml(String(totalActive))}</strong><small>Latest active property count available for this report.</small></div>
      <div class="metricCard"><span class="metricLabel">Invoices recorded</span><strong>${escapeHtml(String(invoicesTotal))}</strong><small>All invoice statuses inside the selected reporting period.</small></div>
    </div>

    ${revenueSourcesSection}

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">02</span><div><h2>Performance summary</h2><p>Revenue movement, invoice position, and property type contribution.</p></div></div>
      <div class="panelGrid">
        <div class="reportPanel">
          <div class="panelTitle">Revenue trend</div><div class="panelBody">
          ${revImg ? `<img class="chartImage" src="${escapeAttr(revImg)}" alt="Revenue chart" />` : `<div class="emptyState">Revenue chart is not available.</div>`}</div>
        </div>
        <div class="reportPanel">
          <div class="panelTitle">Invoices by status</div><div class="panelBody">
          ${statusImg ? `<img class="chartImage" src="${escapeAttr(statusImg)}" alt="Invoice status chart" />` : `<div class="emptyState">Invoice chart is not available.</div>`}</div>
        </div>
        <div class="reportPanel">
          <div class="panelTitle">Gross booking value by property type</div><div class="panelBody">
          <div class="typeLine">${typeSegs || ""}</div>
          <div class="typeLegend">
            ${typeLegend || `<div class="emptyState">No booking value data was recorded in this period.</div>`}
          </div></div>
        </div>
      </div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">03</span><div><h2>Invoice status control</h2><p>Count of invoices at each recorded workflow state.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Status</th><th style="text-align:right;">Count</th></tr></thead>
        <tbody>
          ${invRows || `<tr><td colspan="2" class="emptyState">No invoice data was recorded in this period.</td></tr>`}
        </tbody>
      </table></div>
    </section>

    ${
      mode === "revenueOnly"
        ? ""
        : `
    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">04</span><div><h2>Invoice revenue register</h2><p>Invoice value, partner net payable, and NoLSAF commission for reconciliation.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Status</th>
            <th>Issued</th>
            <th>Property</th>
            <th style="text-align:right;">Total</th>
            <th style="text-align:right;">Net</th>
            <th style="text-align:right; color: var(--brand); font-weight: 400;">NoLSAF (TZS)</th>
            <th style="text-align:right;">NoLSAF %</th>
          </tr>
        </thead>
        <tbody>
          ${detailRows || `<tr><td colspan="8" class="emptyState">No invoice rows were recorded in this period.</td></tr>`}
        </tbody>
      </table></div>
      <div class="reportNote">This print register includes up to 60 invoice rows. Use the system export when the complete machine readable register is required.</div>
    </section>
    ${tourDetailSection}`
    }

    ${buildAdminReportFooter({
      reportRef,
      qrDataUrl,
      purpose: "Scan the QR code to confirm the sealed figures on the public NoLSAF verification page.",
      signatureLabel: "Finance authorization",
    })}
    </main>
  </div>
</body>
</html>`;

    await renderAndPrintAdminReport(printWindow, html);
  }

  return (
    <NoLSAFReportsFrame
      actions={
        <>
            <button
              type="button"
              onClick={() => printReport("full")}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-700 transition hover:border-emerald-200 hover:text-emerald-700"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Full report
            </button>

            <button
              type="button"
              onClick={() => printReport("revenueOnly")}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-emerald-800"
              title="Print only NoLSAF revenue sources"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Revenue summary
            </button>
        </>
      }
    >
      <NoLSAFReportTitle
        icon="revenue"
        eyebrow="Financial performance"
        title="Revenue and commission report"
        text="NoLSAF revenue, customer payment volume, property invoices, transport, tours, and commission controls."
      />

        {clampInfo.clamped ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <div className="font-bold">Range limited</div>
              <div className="break-words text-amber-800/80">Max range is {MAX_REPORT_DAYS_INCLUSIVE} days.</div>
            </div>
          </div>
        ) : null}

        <section className="grid min-w-0 gap-4 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm lg:grid-cols-[minmax(0,360px)_1px_minmax(0,1fr)] lg:items-end" aria-label="Revenue report controls">
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Reporting period</div>
            <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-1 text-[9px] font-semibold text-neutral-500">From</div>
                <DatePickerField label="From date" value={from} max={to} onChangeAction={(nextIso) => applyRange(nextIso, to)} widthClassName="w-full" size="sm" twoMonths={false} allowPast />
              </div>
              <div className="min-w-0">
                <div className="mb-1 text-[9px] font-semibold text-neutral-500">To</div>
                <DatePickerField label="To date" value={to} min={from} max={clampInfo.maxTo ?? undefined} onChangeAction={(nextIso) => applyRange(from, nextIso)} widthClassName="w-full" size="sm" twoMonths={false} allowPast />
              </div>
            </div>
          </div>

          <div className="hidden self-stretch bg-neutral-200 lg:block" aria-hidden />

          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Quick range</div>
            <div className="mt-2 max-w-full overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="grid w-max min-w-full grid-flow-col auto-cols-[minmax(88px,1fr)] items-center gap-1.5 p-0.5" aria-label="Quick report periods">
              {(
                [
                  { key: "today" as const, label: "Today", hint: "Today" },
                  { key: "7d" as const, label: "7 days", hint: "Last 7 days" },
                  { key: "30d" as const, label: "30 days", hint: "Last 30 days" },
                  { key: "3m" as const, label: "3 months", hint: "Last 3 months" },
                  { key: "6m" as const, label: "6 months", hint: "Last 6 months" },
                  { key: "ytd" as const, label: "YTD", hint: "Year to date" },
                  { key: "12m" as const, label: "12 months", hint: "Last 12 months" },
                ] as const
              ).map((p) => {
                const r = getQuickRange(p.key);
                const active = from === r.from && to === r.to;
                return (
                  <RangePill
                    key={p.key}
                    label={p.label}
                    hint={p.hint}
                    active={active}
                    onClick={() => applyRange(r.from, r.to)}
                  />
                );
              })}

              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex min-h-[116px] min-w-0 flex-col rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Gross payment volume</div>
            <div className="mt-2 text-lg font-bold tabular-nums text-neutral-950">TZS {fmtMoneyTZS(totalRevenue)}</div>
            <div className="mt-2 space-y-0.5 text-[10px] text-neutral-500">
              <div className="flex items-center justify-between gap-2">
                <span>Property invoices</span>
                <span className="font-semibold text-neutral-800">TZS {fmtMoneyTZS(grossPaymentBreakdown.propertyTzs)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Transport</span>
                <span className="font-semibold text-neutral-800">TZS {fmtMoneyTZS(grossPaymentBreakdown.transportTzs)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Tour (separate)</span>
                <span className="font-semibold text-amber-700">{tourCommissionCurrency} {fmtMoneyUSD(grossPaymentBreakdown.tourUsd)}</span>
              </div>
            </div>
            <div className="mt-1.5 text-[9px] text-neutral-400">Customer payment turnover, not NoLSAF revenue.</div>
          </div>
          <div className="flex min-h-[116px] min-w-0 flex-col rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Active properties</div>
            <div className="mt-2 text-lg font-bold tabular-nums text-neutral-950">{String(totalActive)}</div>
            <div className="mt-auto pt-1.5 text-[10px] text-neutral-500">Latest active platform supply.</div>
          </div>
          <div className="flex min-h-[116px] min-w-0 flex-col rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Invoices recorded</div>
            <div className="mt-2 text-lg font-bold tabular-nums text-neutral-950">{String(invoicesTotal)}</div>
            <div className="mt-auto pt-1.5 text-[10px] text-neutral-500">Every invoice workflow state in range.</div>
          </div>
        </div>

        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-neutral-950">NoLSAF revenue sources</div>
              <div className="text-[10px] text-neutral-500">Owner commission, driver commission, verified NRMS subscriptions, tour commission, and total platform earnings.</div>
            </div>
            {totalsLoading ? <div className="text-xs text-slate-500">Calculating…</div> : null}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
              <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-700">Owner commission</div>
              <div className="mt-2 text-base font-bold text-emerald-700">
                {ownerCommissionTotal === null ? "—" : `TZS ${fmtMoneyTZS(Math.round(ownerCommissionTotal))}`}
              </div>
            </div>
            <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3">
              <div className="text-[9px] font-bold uppercase tracking-wide text-sky-700">Driver commission</div>
              <div className="mt-2 text-base font-bold text-sky-800">
                {driverCommissionTotal === null ? "—" : `TZS ${fmtMoneyTZS(Math.round(driverCommissionTotal))}`}
              </div>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-3">
              <div className="text-[9px] font-bold uppercase tracking-wide text-violet-700">NRMS subscriptions</div>
              <div className="mt-2 text-base font-bold text-violet-800">
                {subscriptionRevenueTotal === null ? "No verified revenue" : `TZS ${fmtMoneyTZS(Math.round(subscriptionRevenueTotal))}`}
              </div>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
              <div className="text-[9px] font-bold uppercase tracking-wide text-amber-700">Tour commission ({tourCommissionCurrency})</div>
              <div className="mt-2 text-base font-bold text-amber-800">
                {tourCommissionTotal === null ? "—" : `${tourCommissionCurrency} ${fmtMoneyUSD(tourCommissionTotal)}`}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-700">Total NoLSAF revenue</div>
              <div className="mt-2 text-base font-bold text-emerald-950">
                {totalNoLSAFRevenue === null ? "—" : `TZS ${fmtMoneyTZS(Math.round(totalNoLSAFRevenue))}`}
              </div>
              <div className="mt-1 text-[10px] font-bold text-amber-700">
                {tourCommissionTotal ? `+ ${tourCommissionCurrency} ${fmtMoneyUSD(tourCommissionTotal)} tour` : null}
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-[10px] leading-4 text-blue-900">
            Owner commission, driver commission, and verified or manually reconciled NRMS subscriptions are included in the <span className="font-semibold">TZS</span> total. Tour commission settles in <span className="font-semibold">{tourCommissionCurrency}</span> and remains separate.
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-neutral-950">Visual summary</div>
              <div className="text-xs text-slate-400">Revenue trend · Invoice status · Breakdown by property type.</div>
            </div>
            {loading ? <div className="text-xs text-slate-500">Loading…</div> : null}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
              <div className="mb-2 text-xs font-bold text-neutral-800">Revenue trend</div>
              <Chart
                type="line"
                data={revenueChartData as any}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: "bottom",
                      labels: { boxWidth: 10, boxHeight: 10 },
                    },
                  },
                  scales: {
                    x: { grid: { display: false }, ticks: { display: false } },
                    y: { grid: { display: false }, ticks: { display: false } },
                  },
                } as any}
                height={190}
                onCanvas={setRevCanvas}
              />
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
              <div className="mb-2 text-xs font-bold text-neutral-800">Invoices by status</div>
              <Chart
                type="doughnut"
                data={invoiceStatusChartData as any}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: "bottom",
                      labels: { boxWidth: 10, boxHeight: 10 },
                    },
                  },
                  cutout: "62%",
                } as any}
                height={190}
                onCanvas={setStatusCanvas}
              />
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
              <div className="text-xs font-bold text-neutral-800">Gross booking value by property type</div>
              <div className="mt-1 text-xs text-slate-500">Total paid invoice value (turnover), not NoLSAF commission.</div>

              {revenueByTypeBreakdown.items.length ? (
                <>
                  <div
                    className="mt-3 flex h-2 overflow-hidden rounded-full bg-neutral-200"
                    aria-label="Gross booking value by property type breakdown"
                  >
                    {revenueByTypeBreakdown.items.map((it) => (
                      <div
                        key={it.label}
                        style={{ width: `${Math.max(0, Math.min(100, it.pct))}%`, backgroundColor: it.color }}
                        title={`${it.label}: ${Math.round(it.pct)}%`}
                      />
                    ))}
                  </div>

                  <div className="mt-3 space-y-2">
                    {revenueByTypeBreakdown.items.slice(0, 10).map((it) => (
                      <div key={it.label} className="flex items-center gap-2 text-[10px]">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: it.color }} aria-hidden />
                        <div className="min-w-0 flex-1 truncate font-semibold text-neutral-700">{it.label}</div>
                        <div className="text-slate-500 font-semibold whitespace-nowrap">{Math.round(it.pct)}%</div>
                        <div className="whitespace-nowrap font-bold text-neutral-950">TZS {fmtMoneyTZS(Number(it.value) || 0)}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="mt-3 text-sm text-slate-500">No booking value data for this range.</div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-bold text-neutral-950">Invoice status summary</div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                    <th className="text-left py-2.5 pr-2">Status</th>
                    <th className="text-right py-2.5 pl-2">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(invoiceStatusCounts || {}).length ? (
                    Object.entries(invoiceStatusCounts)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([k, v]) => (
                        <tr key={k} className="border-b border-neutral-100 last:border-b-0">
                          <td className="py-2.5 pr-2 text-xs text-neutral-600">{k}</td>
                          <td className="py-2.5 pl-2 text-right text-xs font-bold text-neutral-950">{String(v ?? 0)}</td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="py-4 text-sm text-slate-500">
                        No invoice data for this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-bold text-neutral-950">Invoice register</div>
              <div className="text-xs text-slate-500">Up to 200 loaded · prints up to 60</div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                    <th className="text-left py-2.5 pr-2">Invoice</th>
                    <th className="text-left py-2.5 px-2">Status</th>
                    <th className="text-left py-2.5 px-2">Issued</th>
                    <th className="text-left py-2.5 px-2">Property</th>
                    <th className="text-right py-2.5 px-2">Total</th>
                    <th className="text-right py-2.5 pl-2">Net</th>
                    <th className="text-right font-bold py-2.5 pl-2 text-emerald-400">NoLSAF (TZS)</th>
                    <th className="text-right py-2.5 pl-2">NoLSAF %</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceItems.length ? (
                    invoiceItems.slice(0, 60).map((inv) => (
                      <tr key={inv.id} className="border-b border-neutral-100 text-xs last:border-b-0 hover:bg-neutral-50/70">
                        <td className="whitespace-nowrap py-2.5 pr-2 font-bold text-neutral-950">
                          {inv.invoiceNumber || `#${inv.id}`}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-neutral-600">{inv.status || "—"}</td>
                        <td className="py-2.5 px-2 text-slate-400 whitespace-nowrap">
                          {inv.issuedAt ? fmtDateTime(inv.issuedAt) : "—"}
                        </td>
                        <td className="max-w-[320px] truncate px-2 py-2.5 text-neutral-700">
                          {inv.booking?.property?.title || "—"}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-200 whitespace-nowrap">
                          TZS {fmtMoneyTZS(Number(inv.total || 0))}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pl-2 text-right font-semibold text-neutral-950">
                          TZS {fmtMoneyTZS(Number(inv.netPayable || 0))}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pl-2 text-right font-semibold text-emerald-700">
                          {(() => {
                            const amt = calcCommissionAmount(inv.total, inv.netPayable);
                            return amt === null ? "—" : `TZS ${fmtMoneyTZS(amt)}`;
                          })()}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pl-2 text-right text-neutral-600">
                          {fmtPct(calcCommissionPct(inv.total, inv.netPayable), 1)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-4 text-sm text-slate-500">
                        No invoice rows for this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-bold text-neutral-950">Tour activity register</div>
              <div className="text-xs text-slate-500">Customer-paid tours in range · prints up to 60</div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                    <th className="text-left py-2.5 pr-2">Booking</th>
                    <th className="text-left py-2.5 px-2">Operator</th>
                    <th className="text-left py-2.5 px-2">Activity (tour · destination)</th>
                    <th className="text-right py-2.5 px-2">Travelers</th>
                    <th className="text-right py-2.5 px-2">Gross</th>
                    <th className="px-2 py-2.5 text-right font-bold text-amber-700">Commission</th>
                    <th className="text-left py-2.5 px-2">Status</th>
                    <th className="text-left py-2.5 pl-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {tourRows.length ? (
                    tourRows.slice(0, 60).map((t) => {
                      const cur = t.currency || tourCommissionCurrency;
                      return (
                        <tr key={`tour-${t.id}`} className="border-b border-neutral-100 text-xs last:border-b-0 hover:bg-neutral-50/70">
                          <td className="whitespace-nowrap py-2.5 pr-2 font-bold text-neutral-950">{t.bookingCode || `#${t.id}`}</td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-neutral-700">{t.operatorName || "—"}</td>
                          <td className="max-w-[360px] truncate px-2 py-2.5 text-neutral-700">
                            {t.tourTitle || "—"}
                            {t.destination ? <span className="text-slate-500"> · {t.destination}</span> : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right text-neutral-600">
                            {t.numberOfPeople ?? "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right text-neutral-800">
                            {t.grossAmount === null || t.grossAmount === undefined ? "—" : `${cur} ${fmtMoneyUSD(Number(t.grossAmount) || 0)}`}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right font-semibold text-amber-700">
                            {t.commissionAmount === null || t.commissionAmount === undefined ? "—" : `${cur} ${fmtMoneyUSD(Number(t.commissionAmount) || 0)}`}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-neutral-600">{t.status || "—"}</td>
                          <td className="py-2.5 pl-2 text-slate-400 whitespace-nowrap">{t.createdAt ? fmtDateTime(t.createdAt) : "—"}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-4 text-sm text-slate-500">
                        No tour activities for this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
    </NoLSAFReportsFrame>
  );
}

function RangePill({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hint}
      className={
        "group relative h-9 w-full snap-start overflow-hidden rounded-md border px-3 text-[10px] font-bold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 " +
        (active ? "border-emerald-800 bg-gradient-to-b from-emerald-700 to-emerald-800 text-white shadow-emerald-900/15" : "border-neutral-200 bg-gradient-to-b from-white to-neutral-50 text-neutral-600 hover:border-emerald-300 hover:text-emerald-800")
      }
    >
      <span className="relative z-10">{label}</span>
      <span className={`absolute inset-x-2 bottom-0 h-0.5 transition ${active ? "bg-emerald-300" : "bg-transparent group-hover:bg-emerald-300"}`} aria-hidden />

    </button>
  );
}
