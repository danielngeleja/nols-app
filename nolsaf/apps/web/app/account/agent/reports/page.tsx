"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Clock,
  DollarSign,
  Package,
  Printer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import LogoSpinner from "@/components/LogoSpinner";
import TableScroller from "@/components/TableScroller";
import { buildPdfDocument } from "@/lib/pdfReportTemplate";
import {
  Bar,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

const api = apiClient;

// Local mirrors of the NRMS report primitives (DataTable),
// so the operator report reads as part of the same reporting system.
function ReportEmpty({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="px-4 py-8">
      <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-lg border border-solid border-dashed border-neutral-300 px-6 py-12 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-md bg-neutral-100 text-neutral-400">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <p className="m-0 mt-1 text-sm font-bold text-neutral-800">{title}</p>
        <p className="m-0 text-xs text-neutral-500">{text}</p>
      </div>
    </div>
  );
}

const RANGE_PRESETS: Array<{ label: string; days?: number; months?: number }> = [
  { label: "7 days", days: 6 },
  { label: "14 days", days: 13 },
  { label: "1 month", months: 1 },
  { label: "6 months", months: 6 },
  { label: "12 months", months: 12 },
];

type RevenueItem = {
  source?: "TOUR_BOOKING";
  id: string | number;
  invoiceNumber?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
  payoutStatus?: string | null;
  payoutRequestedAt?: string | null;
  payoutApprovedAt?: string | null;
  payoutPaidAt?: string | null;
  title: string;
  tripType: string;
  status: string;
  isCompleted: boolean;
  budget: number;
  commissionPercent: number;
  commissionAmount: number;
  agentEarning: number;
  currency: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  client: string;
  nationality?: string | null;
};

type MeData = {
  fullName?: string | null;
  name?: string | null;
  email?: string | null;
  address?: string | null;
  region?: string | null;
  district?: string | null;
};

function fmtMoney(n: number, currency = "USD") {
  return `${currency} ${Math.round(Number(n || 0)).toLocaleString()}`;
}

function toDateOnlyInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseDateSafe(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type InvoiceWorkflowStage = "NEW" | "CLAIMED" | "VERIFIED" | "APPROVED" | "DISBURSED" | "REJECTED";

const INVOICE_STAGE_ORDER: InvoiceWorkflowStage[] = ["NEW", "CLAIMED", "VERIFIED", "APPROVED", "DISBURSED", "REJECTED"];

function normalizedInvoiceStage(item: RevenueItem): InvoiceWorkflowStage {
  const payment = String(item.paymentStatus || "").toUpperCase();
  const payout = String(item.payoutStatus || "").toUpperCase();
  const invoice = String(item.invoiceStatus || "").toUpperCase();

  if (payment === "REJECTED" || payout === "REJECTED" || invoice === "REJECTED") return "REJECTED";
  if (item.payoutPaidAt || payment === "DISBURSED" || payout === "DISBURSED" || payout === "PAID") return "DISBURSED";
  if (item.payoutApprovedAt || payment === "APPROVED" || payout === "APPROVED" || invoice === "APPROVED") return "APPROVED";
  // VERIFIED is an explicit admin action on a submitted claim. A customer
  // payment of PAID does NOT verify the payout — the record stays NEW until
  // the operator sends a claim, then CLAIMED until NoLSAF verifies it.
  if (payout === "VERIFIED" || invoice === "VERIFIED" || payment === "VERIFIED") return "VERIFIED";
  if (item.payoutRequestedAt || !!item.invoiceNumber || !!item.invoiceStatus || payout === "CLAIMED" || payout === "REQUESTED") return "CLAIMED";
  return "NEW";
}

export default function AgentReportsPage() {
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get("print") === "1";
  const autoPrintFired = useRef(false);

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<RevenueItem[]>([]);
  const [me, setMe] = useState<MeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);
  const urlFrom = searchParams.get("from");
  const urlTo = searchParams.get("to");
  const [from, setFrom] = useState<string>(urlFrom || toDateOnlyInput(monthStart));
  const [to, setTo] = useState<string>(urlTo || toDateOnlyInput(today));

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [revenuesRes, meRes] = await Promise.all([
          api.get("/api/agent/revenues"),
          api.get("/api/account/me").catch(() => null),
        ]);
        const data = (revenuesRes as any)?.data;
        const meData = (meRes as any)?.data?.data ?? (meRes as any)?.data ?? null;
        if (!mounted) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setMe(meData);
      } catch {
        if (!mounted) return;
        setError("Could not load report data.");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const fromD = parseDateSafe(from);
    const toD = parseDateSafe(to);
    if (!fromD || !toD) return items;

    const fromStart = new Date(fromD.getFullYear(), fromD.getMonth(), fromD.getDate(), 0, 0, 0, 0).getTime();
    const toEnd = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate(), 23, 59, 59, 999).getTime();

    return items.filter((item) => {
      const d = parseDateSafe(item.completedAt || item.createdAt || item.dateFrom || item.dateTo);
      if (!d) return false;
      const t = d.getTime();
      return t >= fromStart && t <= toEnd;
    });
  }, [items, from, to]);

  const kpis = useMemo(() => {
    const paid = filteredItems.filter((i) => i.isCompleted);
    const pending = filteredItems.filter((i) => !i.isCompleted);

    const paidEarnings = paid.reduce((s, i) => s + Number(i.agentEarning || 0), 0);
    const pendingEarnings = pending.reduce((s, i) => s + Number(i.agentEarning || 0), 0);
    const avgPerTrip = filteredItems.length > 0 ? paidEarnings / filteredItems.length : 0;

    return {
      totalTrips: filteredItems.length,
      paidTrips: paid.length,
      pendingTrips: pending.length,
      paidEarnings,
      pendingEarnings,
      avgPerTrip,
    };
  }, [filteredItems]);

  const trend = useMemo(() => {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const fromD = parseDateSafe(from) || new Date();
    const toD = parseDateSafe(to) || new Date();

    const start = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    const end = new Date(toD.getFullYear(), toD.getMonth(), 1);

    const buckets: Array<{ key: string; label: string; paid: number; pending: number }> = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      buckets.push({
        key,
        label: `${monthNames[cursor.getMonth()]} ${cursor.getFullYear()}`,
        paid: 0,
        pending: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    if (buckets.length === 0) {
      const d = new Date();
      buckets.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
        paid: 0,
        pending: 0,
      });
    }

    const byKey = new Map(buckets.map((b) => [b.key, b]));

    for (const item of filteredItems) {
      const d = parseDateSafe(item.completedAt || item.createdAt || item.dateFrom || item.dateTo);
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = byKey.get(key);
      if (!bucket) continue;
      if (item.isCompleted) bucket.paid += Number(item.agentEarning || 0);
      else bucket.pending += Number(item.agentEarning || 0);
    }

    const maxY = Math.max(1, ...buckets.map((b) => Math.max(b.paid, b.pending)));

    const pointsFor = (field: "paid" | "pending") =>
      buckets
        .map((b, i) => {
          const x = (i / Math.max(1, buckets.length - 1)) * 100;
          const y = 100 - (b[field] / maxY) * 100;
          return `${x},${Number.isFinite(y) ? y : 100}`;
        })
        .join(" ");

    return {
      buckets,
      paidPoints: pointsFor("paid"),
      pendingPoints: pointsFor("pending"),
    };
  }, [filteredItems, from, to]);

  const rows = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const da = parseDateSafe(a.completedAt || a.createdAt || a.dateFrom || a.dateTo)?.getTime() || 0;
      const db = parseDateSafe(b.completedAt || b.createdAt || b.dateFrom || b.dateTo)?.getTime() || 0;
      return db - da;
    });
  }, [filteredItems]);

  const reportCurrency = useMemo(() => {
    const scope = filteredItems.length > 0 ? filteredItems : items;
    if (scope.some((i) => i.source === "TOUR_BOOKING")) return "USD";
    const first = scope.find((i) => typeof i.currency === "string" && i.currency.trim().length > 0);
    return first?.currency || "USD";
  }, [filteredItems, items]);

  const trendSeries = useMemo(() => {
    const totals = trend.buckets.map((b) => b.paid + b.pending);
    return trend.buckets.map((b, idx) => {
      const start = Math.max(0, idx - 1);
      const end = Math.min(totals.length - 1, idx + 1);
      const window = totals.slice(start, end + 1);
      const moving = window.length ? window.reduce((s, n) => s + n, 0) / window.length : 0;
      return {
        label: b.label,
        revenue: totals[idx],
        trend: Math.round(moving),
      };
    });
  }, [trend.buckets]);

  const statusData = useMemo(() => {
    const map = new Map<InvoiceWorkflowStage, number>(INVOICE_STAGE_ORDER.map((k) => [k, 0]));
    for (const item of filteredItems) {
      const stage = normalizedInvoiceStage(item);
      map.set(stage, (map.get(stage) || 0) + 1);
    }
    return INVOICE_STAGE_ORDER.map((name) => ({ name, value: map.get(name) || 0 }));
  }, [filteredItems]);

  const typeData = useMemo(() => {
    const baseTypes = ["SAFARI", "BEACH", "CULTURAL", "MOUNTAIN", "OTHER"];
    const map = new Map<string, number>(baseTypes.map((k) => [k, 0]));
    for (const item of filteredItems) {
      const key = String(item.tripType || "OTHER").trim().toUpperCase() || "OTHER";
      map.set(key, (map.get(key) || 0) + Number(item.agentEarning || 0));
    }
    const total = Array.from(map.values()).reduce((s, n) => s + n, 0);
    const rows = Array.from(map.entries())
      .map(([name, value]) => ({
        name,
        value,
        pct: total > 0 ? Math.round((value / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    return { rows, total };
  }, [filteredItems]);

  const statusColors = ["#64748b", "#4f46e5", "#f59e0b", "#06b6d4", "#16a34a", "#ef4444"];

  const printReport = async () => {
    const generatedAt = new Date();
    const operatorName = String(me?.fullName || me?.name || "Operator");
    const operatorEmail = String(me?.email || "-");
    const operatorAddress = String(
      me?.address || [me?.district, me?.region].filter(Boolean).join(", ") || "Address not provided"
    );
    let reportId = `AGT-${generatedAt.getFullYear()}${String(generatedAt.getMonth() + 1).padStart(2, "0")}${String(generatedAt.getDate()).padStart(2, "0")}-${String(Date.now()).slice(-6)}`;

    // Seal the report server side, then encode the public verification URL as a
    // QR so anyone can confirm it is genuine without logging in.
    const totalCommission = rows.reduce((s, it) => s + (Number(it.commissionAmount) || 0), 0);
    const totalBudget = rows.reduce((s, it) => s + (Number(it.budget) || 0), 0);
    const sealFigures = [
      { label: "Operations", value: String(rows.length) },
      { label: `Total budget (${reportCurrency})`, value: fmtMoney(totalBudget, reportCurrency) },
      { label: `Total commission (${reportCurrency})`, value: fmtMoney(totalCommission, reportCurrency) },
      { label: `Total earning (${reportCurrency})`, value: fmtMoney(typeData.total, reportCurrency) },
      ...typeData.rows.map((r) => ({ label: `Earning: ${r.name}`, value: fmtMoney(r.value, reportCurrency) })),
    ];
    let qrUrl = "";
    try {
      const sealRes = await fetch("/api/reports/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "OPERATOR",
          title: "Operator Earnings Report",
          ref: reportId,
          from,
          to,
          figures: sealFigures,
        }),
      });
      const sealJson: any = await sealRes.json();
      if (sealJson?.token) {
        reportId = String(sealJson.ref || reportId);
        const verifyUrl = `${window.location.origin}/verify?t=${encodeURIComponent(String(sealJson.token))}`;
        const QR: any = await import("qrcode");
        const toDataURL: any = QR?.toDataURL ?? QR?.default?.toDataURL;
        if (typeof toDataURL === "function") {
          qrUrl = await toDataURL(verifyUrl, { margin: 1, width: 200, errorCorrectionLevel: "M" });
        }
      }
    } catch {
      qrUrl = "";
    }

    let barcodeUrl = "";
    try {
      const JsBarcode: any = await import("jsbarcode");
      const render: any = JsBarcode?.default ?? JsBarcode;
      if (typeof render === "function") {
        const canvas = document.createElement("canvas");
        render(canvas, reportId, { format: "CODE128", width: 1.5, height: 36, displayValue: false, margin: 0 });
        barcodeUrl = canvas.toDataURL("image/png");
      }
    } catch {
      barcodeUrl = "";
    }

    const fmtPct = (value: number) => `${Math.round(Number(value || 0))}%`;

    const reportStatusData = statusData.filter((entry) => Number(entry.value || 0) > 0);
    const statusTotal = reportStatusData.reduce((sum, entry) => sum + Number(entry.value || 0), 0) || 1;



    const tableRows = rows
      .map((item) => {
        const dateTxt =
          parseDateSafe(item.completedAt || item.createdAt || item.dateFrom || item.dateTo)?.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }) || "-";

        return `
          <tr>
            <td>${escapeHtml(String(item.title || "-"))}</td>
            <td>${escapeHtml(String(item.client || "-") + (item.nationality ? ` • ${String(item.nationality)}` : ""))}</td>
            <td>${escapeHtml(String(item.tripType || "-"))}</td>
            <td>${escapeHtml(normalizedInvoiceStage(item))}</td>
            <td>${escapeHtml(fmtMoney(item.budget, item.source === "TOUR_BOOKING" ? "USD" : (item.currency || reportCurrency)))}</td>
            <td>${escapeHtml(`${item.commissionPercent}% (${fmtMoney(item.commissionAmount, item.source === "TOUR_BOOKING" ? "USD" : (item.currency || reportCurrency))})`)}</td>
            <td>${escapeHtml(fmtMoney(item.agentEarning, item.source === "TOUR_BOOKING" ? "USD" : (item.currency || reportCurrency)))}</td>
            <td>${escapeHtml(dateTxt)}</td>
          </tr>
        `;
      })
      .join("\n");

    const stageCounts = reportStatusData
      .map(
        (entry, index) => `
          <div class="pdf-bar-row">
            <div class="pdf-bar-head">
              <i style="background:${statusColors[index % statusColors.length]}"></i>
              <span>${escapeHtml(String(entry.name || "Unknown"))}</span>
              <b>${escapeHtml(fmtPct((Number(entry.value || 0) / statusTotal) * 100))}</b>
              <strong>${escapeHtml(String(entry.value ?? 0))}</strong>
            </div>
            <div class="pdf-bar-track"><i style="width:${Math.max(0, Math.round((Number(entry.value || 0) / statusTotal) * 100))}%; background:${statusColors[index % statusColors.length]}"></i></div>
          </div>
        `
      )
      .join("");

    const typeRows = typeData.rows
      .map(
        (row, index) => `
          <div class="pdf-bar-row">
            <div class="pdf-bar-head">
              <i style="background:${statusColors[index % statusColors.length]}"></i>
              <span>${escapeHtml(String(row.name || "OTHER"))}</span>
              <b>${escapeHtml(String(row.pct || 0))}%</b>
              <strong>${escapeHtml(fmtMoney(row.value, reportCurrency))}</strong>
            </div>
            <div class="pdf-bar-track"><i style="width:${Math.max(0, row.pct || 0)}%; background:${statusColors[index % statusColors.length]}"></i></div>
          </div>
        `
      )
      .join("");

    const rangeLabel = `${escapeHtml(from)} to ${escapeHtml(to)}`;
    const generatedLabel = escapeHtml(
      generatedAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    );

    // Built on the shared NoLSAF report template, the same one NRMS prints with:
    // A4 cover with barcode, metric tiles, numbered sections, and a
    // certification page carrying the verification QR.
    const body = `
      <header class="pdf-cover">
        <div class="pdf-cover-top">
          <div class="pdf-mark">
            <span class="pdf-logo">N</span>
            <div class="pdf-mark-copy">
              <p class="pdf-kicker">NoLSAF operator earnings</p>
              <h1>Operator earnings report</h1>
              <p class="pdf-property">${escapeHtml(operatorName)}</p>
              ${barcodeUrl ? `<div class="pdf-header-barcode">
                <div class="pdf-barcode-heading">
                  <span class="pdf-barcode-label">Report reference</span>
                  <span class="pdf-report-number">${escapeHtml(reportId)}</span>
                </div>
                <img class="pdf-barcode" src="${escapeHtml(barcodeUrl)}" alt="Report reference barcode" />
              </div>` : ""}
            </div>
          </div>
          <div class="pdf-report-meta">
            <div><span>Report period</span><strong>${rangeLabel}</strong></div>
            <div><span>Generated</span><strong>${generatedLabel}</strong></div>
            <div><span>Currency</span><strong>${escapeHtml(reportCurrency)}</strong></div>
            <div><span>Operator</span><strong>${escapeHtml(operatorEmail)}</strong></div>
            <div><span>Operations</span><strong>${rows.length}</strong></div>
            <div><span>Classification</span><strong>Operator use</strong></div>
          </div>
        </div>
        <div class="pdf-scope">
          <div><span>Based at</span><strong>${escapeHtml(operatorAddress)}</strong></div>
          <div><span>Earnings basis</span><strong>Completed trips and payout claims</strong></div>
          <div><span>Report kind</span><strong>Operator earnings</strong></div>
        </div>
      </header>

      <div class="pdf-summary">
        <div class="pdf-metric"><p>Trips in range</p><strong>${escapeHtml(String(kpis.totalTrips))}</strong><small>Assigned trips inside the period</small></div>
        <div class="pdf-metric pdf-metric-green"><p>Paid earnings</p><strong>${escapeHtml(fmtMoney(kpis.paidEarnings, reportCurrency))}</strong><small>Disbursed for completed trips</small></div>
        <div class="pdf-metric pdf-metric-amber"><p>Pending earnings</p><strong>${escapeHtml(fmtMoney(kpis.pendingEarnings, reportCurrency))}</strong><small>Claimed or approved, not yet paid</small></div>
        <div class="pdf-metric"><p>Avg paid per trip</p><strong>${escapeHtml(fmtMoney(kpis.avgPerTrip, reportCurrency))}</strong><small>Paid earnings over trips in range</small></div>
      </div>

      <section class="pdf-section">
        <div class="pdf-section-title">
          <span>01</span>
          <div><h2>Earnings composition</h2><p>Where the period's earnings came from, and where its invoices currently sit.</p></div>
        </div>
        <div class="pdf-grid-2">
          <div class="pdf-panel">
            <h3>Revenue by tourism type</h3>
            ${typeRows || '<div class="pdf-empty">No earnings recorded in this period.</div>'}
          </div>
          <div class="pdf-panel">
            <h3>Invoices by status</h3>
            ${stageCounts || '<div class="pdf-empty">No invoices in this period.</div>'}
          </div>
        </div>
      </section>

      <section class="pdf-section">
        <div class="pdf-section-title">
          <span>02</span>
          <div><h2>Operations detail</h2><p>Every assigned trip in the period, with its invoice stage and your earning.</p></div>
        </div>
        <div class="pdf-table-wrap">
          <table class="pdf-table">
            <colgroup>
              <col style="width:19%" /><col style="width:14%" /><col style="width:10%" /><col style="width:11%" />
              <col style="width:12%" /><col style="width:14%" /><col style="width:11%" /><col style="width:9%" />
            </colgroup>
            <thead>
              <tr>
                <th>Operation</th><th>Client</th><th>Type</th><th>Status</th>
                <th>Budget</th><th>Commission</th><th>Earning</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || '<tr><td class="pdf-empty" colspan="8">No operations found in this range.</td></tr>'}
            </tbody>
          </table>
        </div>
        <p class="pdf-note">Figures reflect the data held at the moment this report was generated. Corrections must be made through the originating booking or payout record, not this document.</p>
      </section>

      <section class="pdf-certification">
        <div class="pdf-certification-head">
          <p>Verification</p>
          <h2>Report certification</h2>
        </div>
        <div class="pdf-certification-body">
          <div class="pdf-disclaimer-row">
            <div class="pdf-disclaimer">
              <h3>About this document</h3>
              This is a system-generated operator earnings report produced by NoLSAF. It is sealed at generation and
              can be verified independently by scanning the code alongside, which resolves to a NoLSAF verification
              page showing the figures as issued. Any copy whose figures differ from the verification page has been
              altered and should not be relied upon.
            </div>
            ${qrUrl ? `<div class="pdf-verification-card">
              <img class="pdf-qr" src="${escapeHtml(qrUrl)}" alt="Scan to verify this report" />
              <strong>Scan to verify</strong>
              <p>Confirms this report against NoLSAF records.</p>
              <p class="pdf-verification-ref">${escapeHtml(reportId)}</p>
            </div>` : ""}
          </div>

          <div class="pdf-cert-grid">
            <div class="pdf-cert-card"><span>Report reference</span><strong>${escapeHtml(reportId)}</strong></div>
            <div class="pdf-cert-card"><span>Report period</span><strong>${rangeLabel}</strong></div>
            <div class="pdf-cert-card"><span>Generated</span><strong>${generatedLabel}</strong></div>
            <div class="pdf-cert-card"><span>Operations covered</span><strong>${rows.length}</strong></div>
          </div>

          <h2 class="pdf-signature-title">Signatures</h2>
          <p class="pdf-signature-note">Signed copies are retained by each party.</p>
          <div class="pdf-signatures">
            <div class="pdf-signature">
              <h3>Tour operator</h3>
              <div class="pdf-signature-line"></div>
              <p class="pdf-signature-label">Signature and date</p>
              <div class="pdf-signature-line"></div>
              <p class="pdf-signature-label">${escapeHtml(operatorName)}</p>
            </div>
            <div class="pdf-signature">
              <h3>NoLSAF</h3>
              <div class="pdf-signature-line"></div>
              <p class="pdf-signature-label">Signature and date</p>
              <div class="pdf-signature-line"></div>
              <p class="pdf-signature-label">Authorised representative</p>
            </div>
          </div>

          <div class="pdf-footer">
            <span>${escapeHtml(reportId)}</span>
            <span>NoLSAF operator earnings report</span>
            <span>Generated ${generatedLabel}</span>
          </div>
        </div>
      </section>
    `;

    const html = buildPdfDocument({
      title: `Operator earnings report ${reportId}`,
      rootId: "agent-print-root",
      rootClass: "agent-pdf",
      bodyHtml: body,
    });

    const w = window.open("", "_blank");
    if (!w) {
      window.alert("Unable to open print preview. Please allow popups for this site.");
      return;
    }

    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 300);
  };

  useEffect(() => {
    if (autoPrint && !loading && !error && !autoPrintFired.current) {
      autoPrintFired.current = true;
      setTimeout(() => void printReport(), 400);
    }
  }, [autoPrint, loading, error]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LogoSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full pb-10">
      <Link
        href="/account/agent"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 no-underline transition hover:text-emerald-700 print:hidden"
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to dashboard
      </Link>

      {(() => {
        // The period in words, and which preset (if any) it equals.
        const dayMs = 86_400_000;
        const fromDate = new Date(`${from}T00:00:00`);
        const toDate = new Date(`${to}T00:00:00`);
        const spanDays = Number.isFinite(fromDate.getTime()) && Number.isFinite(toDate.getTime())
          ? Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / dayMs) + 1)
          : 0;
        const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        const presetRange = (preset: (typeof RANGE_PRESETS)[number]) => {
          const now = new Date();
          const start = new Date(now);
          if (preset.days) start.setDate(start.getDate() - preset.days);
          if (preset.months) start.setMonth(start.getMonth() - preset.months);
          return { from: toDateOnlyInput(start), to: toDateOnlyInput(now) };
        };
        const kpiTiles = [
          { label: "Trips in range", value: String(kpis.totalTrips), note: "Assigned trips in the period", icon: Package, tone: "text-neutral-900" },
          { label: "Paid to you", value: fmtMoney(kpis.paidEarnings, reportCurrency), note: "Disbursed for completed trips", icon: DollarSign, tone: "text-emerald-700" },
          { label: "Pending", value: fmtMoney(kpis.pendingEarnings, reportCurrency), note: "Claimed or approved, not yet paid", icon: Clock, tone: "text-amber-700" },
          { label: "Average per trip", value: fmtMoney(kpis.avgPerTrip, reportCurrency), note: "Paid to you, divided by trips", icon: TrendingUp, tone: "text-sky-700" },
        ];
        return (
          <header className="mb-4 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
            {/* Title and the one action */}
            <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                  <BarChart3 className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h1 className="m-0 text-[18px] font-bold tracking-tight text-neutral-900 sm:text-xl">My reports</h1>
                  <p className="m-0 mt-1 text-[13px] leading-5 text-neutral-500">
                    {spanDays
                      ? <>Your trips and earnings from <strong className="font-semibold text-neutral-700">{fmtDay(fromDate)}</strong> to <strong className="font-semibold text-neutral-700">{fmtDay(toDate)}</strong>, {spanDays} day{spanDays === 1 ? "" : "s"}.</>
                      : "Your trips and earnings for the period you choose."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={printReport}
                className="inline-flex h-10 shrink-0 cursor-pointer appearance-none items-center gap-2 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white transition hover:bg-emerald-800 print:hidden"
              >
                <Printer className="h-4 w-4" aria-hidden />
                Print report
              </button>
            </div>

            {/* Period: quick ranges as one segmented control, exact dates beside it */}
            <div className="flex flex-col gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-5 py-3 lg:flex-row lg:items-center lg:justify-between print:hidden">
              <div className="flex min-w-0 items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                <div role="group" aria-label="Quick ranges" className="inline-flex min-w-0 overflow-x-auto rounded-md border border-solid border-neutral-300 bg-white [scrollbar-width:none]">
                  {RANGE_PRESETS.map((preset, i) => {
                    const range = presetRange(preset);
                    const on = range.from === from && range.to === to;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        aria-pressed={on}
                        onClick={() => { setFrom(range.from); setTo(range.to); }}
                        className={`h-9 shrink-0 cursor-pointer appearance-none border-0 px-3 text-[12.5px] font-medium transition ${i ? "border-l border-solid border-neutral-300" : ""} ${
                          on ? "bg-emerald-700 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-[150px]">
                  <DatePickerField label="Report start date" value={from} max={to} onChangeAction={setFrom} widthClassName="!w-full" size="sm" twoMonths={false} allowPast />
                </div>
                <span className="text-[12.5px] text-neutral-400">to</span>
                <div className="w-[150px]">
                  <DatePickerField label="Report end date" value={to} min={from} onChangeAction={setTo} widthClassName="!w-full" size="sm" twoMonths={false} allowPast />
                </div>
              </div>
            </div>

            {/* The four numbers, joined, so they read as one summary */}
            <dl aria-label="Report summary" className="m-0 grid grid-cols-2 border-0 border-t border-solid border-neutral-200 lg:grid-cols-4">
              {kpiTiles.map((tile, i) => (
                <div
                  key={tile.label}
                  className={`min-w-0 px-5 py-3.5 ${i % 2 ? "border-0 border-l border-solid border-neutral-100" : ""} ${i >= 2 ? "border-0 border-t border-solid border-neutral-100 lg:border-t-0" : ""} ${i ? "lg:border-0 lg:border-l lg:border-solid lg:border-neutral-100" : ""}`}
                >
                  <dt className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-500">
                    <tile.icon className={`h-3.5 w-3.5 ${tile.tone}`} aria-hidden />
                    {tile.label}
                  </dt>
                  <dd className={`m-0 mt-1 truncate text-[22px] font-bold leading-tight tabular-nums tracking-tight ${tile.tone}`}>{tile.value}</dd>
                  <dd className="m-0 mt-0.5 truncate text-[11.5px] text-neutral-400">{tile.note}</dd>
                </div>
              ))}
            </dl>
          </header>
        );
      })()}

      {error ? (
        <div role="alert" className="mb-4 rounded-lg border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}


      {(() => {
        // Chart data: paid and pending per month, a smoothed total, and the
        // stage and type breakdowns in readable words.
        const series = trend.buckets.map((b, idx) => ({ label: b.label, paid: b.paid, pending: b.pending, trend: trendSeries[idx]?.trend ?? 0 }));
        const paidTotal = series.reduce((s, b) => s + b.paid, 0);
        const pendingTotal = series.reduce((s, b) => s + b.pending, 0);
        const hasEarnings = paidTotal + pendingTotal > 0;
        const stageTotal = statusData.reduce((s, d) => s + d.value, 0);
        const sentence = (value: string) => {
          const t = value.replaceAll("_", " ").toLowerCase();
          return t.charAt(0).toUpperCase() + t.slice(1);
        };
        const axisMoney = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));
        const tipStyle = { borderRadius: 6, border: "1px solid #e5e5e5", fontSize: 12, boxShadow: "0 8px 24px -12px rgba(15,23,42,0.25)" };
        const EmptyChart = ({ text }: { text: string }) => (
          <div className="absolute inset-0 grid place-items-center">
            <p className="m-0 rounded-md border border-dashed border-neutral-300 bg-white/90 px-3 py-2 text-[12.5px] text-neutral-500">{text}</p>
          </div>
        );

        return (
          <section aria-label="Visual summary" className="mb-4 grid min-w-0 gap-3 xl:grid-cols-3">
            {/* Earnings over time: what was paid and what is still pending, month by month */}
            <section className="min-w-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white xl:col-span-2">
              <header className="flex flex-wrap items-start justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="m-0 text-[14px] font-semibold text-neutral-900">Earnings over time</h3>
                  <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Your share per month, paid and still pending, with the 3-month trend.</p>
                </div>
                <dl className="m-0 flex shrink-0 items-start gap-4">
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11.5px] text-neutral-500"><span className="h-2 w-2 rounded-sm bg-emerald-600" aria-hidden />Paid</dt>
                    <dd className="m-0 text-[14px] font-bold tabular-nums text-neutral-900">{fmtMoney(paidTotal, reportCurrency)}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11.5px] text-neutral-500"><span className="h-2 w-2 rounded-sm bg-amber-400" aria-hidden />Pending</dt>
                    <dd className="m-0 text-[14px] font-bold tabular-nums text-neutral-900">{fmtMoney(pendingTotal, reportCurrency)}</dd>
                  </div>
                  <div className="hidden sm:block">
                    <dt className="flex items-center gap-1.5 text-[11.5px] text-neutral-500"><span className="h-0.5 w-3 bg-neutral-500" aria-hidden />Trend</dt>
                    <dd className="m-0 text-[12px] text-neutral-500">3-month average</dd>
                  </div>
                </dl>
              </header>
              <div className="relative h-72 min-w-0 px-2 pb-2 pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series} margin={{ left: 4, right: 12, top: 4, bottom: 0 }} barCategoryGap="28%">
                    <CartesianGrid stroke="#f1f1f1" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#737373" }} tickLine={false} axisLine={{ stroke: "#e5e5e5" }} />
                    <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: "#a3a3a3" }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip
                      cursor={{ fill: "rgba(2,102,94,0.05)" }}
                      formatter={(value: any, name: any) => [fmtMoney(Number(value || 0), reportCurrency), name]}
                      contentStyle={tipStyle}
                    />
                    <Bar dataKey="paid" name="Paid" stackId="earn" fill="#059669" maxBarSize={44} />
                    <Bar dataKey="pending" name="Pending" stackId="earn" fill="#fbbf24" radius={[3, 3, 0, 0]} maxBarSize={44} />
                    <Line type="monotone" dataKey="trend" name="Trend" stroke="#525252" strokeWidth={1.75} strokeDasharray="4 3" dot={false} activeDot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
                {!hasEarnings ? <EmptyChart text="No earnings in this period yet" /> : null}
              </div>
            </section>

            {/* Payout stages: a donut with the count in the middle and a counted legend */}
            <section className="min-w-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
              <header className="border-0 border-b border-solid border-neutral-100 px-4 py-3">
                <h3 className="m-0 text-[14px] font-semibold text-neutral-900">Payout stages</h3>
                <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Where each trip&apos;s payout is right now.</p>
              </header>
              <div className="grid min-w-0 grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-3 p-4">
                <div className="relative h-[9.5rem] w-[9.5rem]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stageTotal ? statusData.filter((d) => d.value > 0) : [{ name: "None", value: 1 }]}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={stageTotal ? 2 : 0}
                        stroke="none"
                        isAnimationActive={Boolean(stageTotal)}
                      >
                        {stageTotal
                          ? statusData.filter((d) => d.value > 0).map((entry) => (
                              <Cell key={entry.name} fill={statusColors[statusData.findIndex((d) => d.name === entry.name) % statusColors.length]} />
                            ))
                          : <Cell fill="#f1f5f9" />}
                      </Pie>
                      {stageTotal ? <Tooltip formatter={(value: any, name: any) => [`${value} trip${Number(value) === 1 ? "" : "s"}`, sentence(String(name))]} contentStyle={tipStyle} /> : null}
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                    <div>
                      <p className="m-0 text-[22px] font-bold leading-none tabular-nums text-neutral-900">{stageTotal}</p>
                      <p className="m-0 mt-1 text-[11px] text-neutral-500">trip{stageTotal === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                </div>
                <ul className="m-0 min-w-0 list-none space-y-1.5 p-0">
                  {statusData.map((d, idx) => (
                    <li key={d.name} className={`flex items-center justify-between gap-2 text-[12.5px] ${d.value ? "text-neutral-700" : "text-neutral-400"}`}>
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.value ? statusColors[idx % statusColors.length] : "#e5e5e5" }} aria-hidden />
                        <span className="truncate">{sentence(d.name)}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{d.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* By trip type: one bar per type, empty types muted */}
            <section className="min-w-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white xl:col-span-3">
              <header className="flex flex-wrap items-start justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="m-0 text-[14px] font-semibold text-neutral-900">By trip type</h3>
                  <p className="m-0 mt-0.5 text-[12px] text-neutral-500">How much each kind of trip earned you in the period.</p>
                </div>
                <span className="text-[12px] text-neutral-500">Total <strong className="font-semibold tabular-nums text-neutral-900">{fmtMoney(typeData.total, reportCurrency)}</strong></span>
              </header>
              <div className="grid gap-x-8 gap-y-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
                {typeData.rows.map((row, idx) => {
                  const color = ["#047857", "#0284c7", "#d97706", "#7c3aed", "#64748b"][idx % 5];
                  return (
                    <div key={row.name} className={`min-w-0 ${row.value ? "" : "opacity-50"}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12.5px] font-medium text-neutral-700">{sentence(row.name)}</span>
                        <span className="shrink-0 text-[12px] font-semibold tabular-nums text-neutral-500">{row.pct}%</span>
                      </div>
                      <p className="m-0 mt-0.5 text-[15px] font-bold tabular-nums text-neutral-900">{fmtMoney(row.value, reportCurrency)}</p>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                        <div className="h-full rounded-full" style={{ width: `${row.pct === 0 ? 0 : Math.max(3, row.pct)}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </section>
        );
      })()}

      <section className="min-w-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
          <header className="border-0 border-b border-solid border-neutral-100 px-4 py-3">
            <h3 className="m-0 text-[14px] font-semibold text-neutral-900">Operations details</h3>
            <p className="m-0 mt-0.5 text-[12px] leading-4 text-neutral-500">Every assigned trip in the period, with its invoice stage and your earning.</p>
          </header>

          {rows.length === 0 ? (
            <ReportEmpty icon={BarChart3} title="No report rows in this range" text="Try extending your date range." />
          ) : (
            <TableScroller label="operations details table">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-neutral-50/90 [&>tr>th]:shadow-[inset_0_-1px_0_0_#e5e5e5]">
                  <tr className="text-left text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                    <th className="px-4 py-3 whitespace-nowrap">Operation</th>
                    <th className="px-4 py-3 whitespace-nowrap">Status</th>
                    <th className="px-4 py-3 whitespace-nowrap">Budget</th>
                    <th className="px-4 py-3 whitespace-nowrap">Commission</th>
                    <th className="px-4 py-3 whitespace-nowrap">Earning</th>
                    <th className="px-4 py-3 whitespace-nowrap">Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white [&>tr>td]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>tr:last-child>td]:shadow-none">
                  {rows.map((item) => {
                    const rowCurrency = item.source === "TOUR_BOOKING" ? "USD" : (item.currency || reportCurrency);
                    return (
                    <tr key={item.id} className="align-top transition hover:bg-emerald-50/35">
                      <td className="px-4 py-3 min-w-[240px]">
                        <div className="font-semibold text-neutral-900">{item.title}</div>
                        <div className="text-xs text-neutral-500">{item.client}{item.nationality ? ` • ${item.nationality}` : ""}</div>
                        <div className="text-[11px] text-neutral-400">{item.tripType}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                          {(() => {
                            const stage = normalizedInvoiceStage(item);
                            const stageTone =
                              stage === "DISBURSED"
                                ? "bg-emerald-50 text-emerald-700"
                                : stage === "APPROVED"
                                  ? "bg-cyan-50 text-cyan-700"
                                  : stage === "VERIFIED"
                                    ? "bg-amber-50 text-amber-700"
                                    : stage === "CLAIMED"
                                      ? "bg-indigo-50 text-indigo-700"
                                      : stage === "REJECTED"
                                        ? "bg-red-50 text-red-700"
                                        : "bg-neutral-100 text-neutral-700";
                            return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase ${stageTone}`}>{stage}</span>;
                          })()}
                        </td>
                      <td className="px-4 py-3 whitespace-nowrap font-semibold text-neutral-800">{fmtMoney(item.budget, rowCurrency)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-semibold text-neutral-700">{item.commissionPercent}%</div>
                        <div className="text-xs text-neutral-400">{fmtMoney(item.commissionAmount, rowCurrency)}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-bold text-[#02665e]">{fmtMoney(item.agentEarning, rowCurrency)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-500">
                        <div className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {parseDateSafe(item.completedAt || item.createdAt || item.dateFrom || item.dateTo)?.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          }) || "-"}
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </TableScroller>
          )}
      </section>
    </div>
  );
}
