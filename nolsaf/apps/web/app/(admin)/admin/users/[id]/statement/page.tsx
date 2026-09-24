"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer, Calendar, FileText, Clock, Users, Wallet, Activity } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import { escapeHtml } from "@/utils/html";
import {
  adminReportPrintStyles,
  buildAdminReportFooter,
  buildAdminReportHeader,
  openAdminReportPrintWindow,
  renderAndPrintAdminReport,
} from "@/lib/adminReportPrint";

const api = apiClient;

const DEFAULT_CURRENCY = "TZS";
/** Printed registers stay readable; the full list lives on screen. */
const PRINT_ROW_LIMIT = 80;

/** One colour per service, so a row's stream is readable at a glance in a long
 *  mixed register. These encode category, not state: green, amber and red stay
 *  reserved for "good", "watch" and "bad" everywhere else in the document. */
const SERVICE_TONES: Record<string, { dot: string; chip: string; rail: string; print: string }> = {
  stays: {
    dot: "bg-blue-500",
    chip: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    rail: "shadow-[inset_3px_0_0_0_#3b82f6]",
    print: "#1d4ed8",
  },
  tours: {
    dot: "bg-violet-500",
    chip: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
    rail: "shadow-[inset_3px_0_0_0_#8b5cf6]",
    print: "#6d28d9",
  },
  transport: {
    dot: "bg-orange-500",
    chip: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
    rail: "shadow-[inset_3px_0_0_0_#f97316]",
    print: "#c2410c",
  },
  groups: {
    dot: "bg-teal-500",
    chip: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
    rail: "shadow-[inset_3px_0_0_0_#14b8a6]",
    print: "#0f766e",
  },
};

const FALLBACK_TONE = {
  dot: "bg-neutral-400",
  chip: "bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200",
  rail: "shadow-[inset_3px_0_0_0_#a3a3a3]",
  print: "#525252",
};

function serviceTone(key: string) {
  return SERVICE_TONES[key] ?? FALLBACK_TONE;
}

type Money = number;

type UserRole = {
  source: "ACCOUNT" | "NRMS_STAFF" | "SALES_PARTNER" | "TRAVEL_AGENCY" | "TOUR_OPERATOR" | "PROPERTY_OWNER" | "MERCHANT_ADMIN";
  code: string;
  label: string;
  scope: string | null;
  status: string;
  active: boolean;
  /** True when the role sits alongside the account role rather than replacing it. */
  additive: boolean;
  since: string | null;
  detail: string | null;
};

type Statement = {
  generatedAt: string;
  generatedBy: { id: number | null; name: string | null; email: string | null };
  period: { from: string | null; to: string | null };
  coverage: { from: string | null; to: string | null };
  customer: {
    id: number; name: string | null; email: string | null; phone: string | null; role: string;
    createdAt: string; suspendedAt: string | null; isDisabled: boolean | null;
    emailVerifiedAt: string | null; phoneVerifiedAt: string | null;
    referralCode: string | null; referredBy: number | null;
  };
  roles: { accountRole: string; roles: UserRole[]; activeCount: number; additiveCount: number; hasAdditionalRoles: boolean; badges: string[] } | null;
  services: {
    key: string; label: string;
    records: number; paidRecords: number; paidAmount: Money; canceled: number; currency: string;
  }[];
  totals: { records: number; paidRecords: number; paidAmount: Money; canceled: number; currency: string };
  usage: {
    firstSeenAt: string | null; lastSeenAt: string | null;
    sessions: number; activeSessions: number;
    engagedMinutes: number; activeDays: number; relationshipDays: number;
    basis: string;
  };
  /** Money owed back, and whether it actually reached the customer. */
  refunds: {
    requested: number;
    approvedAmount: Money;
    refundedAmount: Money;
    refundedCount: number;
    outstandingAmount: Money;
    outstandingCount: number;
    entries: {
      id: number; bookingCode: string; status: string; amount: Money;
      provider: string | null; reference: string | null;
      requestedAt: string | null; approvedAt: string | null; refundedAt: string | null;
      policyRule: string | null; policyRefundPercent: number | null;
    }[];
  };
  entries: {
    key: string; service: string; reference: string; description: string;
    status: string; amount: Money; currency: string;
    createdAt: string | null; paidAt: string | null;
  }[];
};

/** Shape returned by GET /admin/users/:id/behaviour. Fetched alongside the
 *  statement rather than recomputed, so the printed document and the
 *  Behaviour tab can never report different numbers for the same customer. */
type Behaviour = {
  payments: {
    attempts: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    channels: {
      key: string; label: string; attempts: number; succeeded: number; failed: number;
      pending: number; share: number; attemptShare: number;
    }[];
    providers: { provider: string; attempts: number; succeeded: number }[];
    coverage: string;
  };
  funnel: {
    byProduct: { key: string; label: string; created: number; paid: number; canceled: number; abandoned: number }[];
    totals: { created: number; paid: number; canceled: number; abandoned: number };
    plannedNeverBooked: number;
  };
  conduct: {
    band: string;
    accountSuspended: boolean;
    signals: { key: string; label: string; value: string; detail: string; threshold: string; severity: string }[];
    restrictions: any[];
  };
  preferences: {
    topDestinations: { name: string; records: number }[];
    savedProperties: number;
    tripEstimates: number;
    reviewsWritten: number;
    averageRating: number | null;
  };
  engagement: {
    totalLogins: number; recentLogins: number; activeSessions: number;
    lastLoginAt: string | null; lastActivityAt: string | null;
  };
  sharing: { referralCode: string | null; referredBy: any };
};

function money(n: any, currency: string = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(n || 0));
}

/** Bare number for print tables, where the currency sits in the column head. */
function amount(n: any) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

function day(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function stamp(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function pretty(code: string | null | undefined) {
  if (!code) return "-";
  return code.replace(/_/g, " ").toLowerCase().replace(/^\S/, (c) => c.toUpperCase());
}

/** Minutes into something a person reads without doing arithmetic. */
function duration(minutes: number) {
  if (!minutes || minutes < 1) return "Under a minute";
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours < 1) return `${mins} min`;
  if (hours < 48) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}

// ── Report reference ────────────────────────────────────────────────────────
// Same construction as the NRMS property reports and the owner statement, so
// every NoLSAF report reference reads the same way:
//
//   CS-0035-260101-260904-2211-K7M2
//   │  │    │      │      │    └ crypto nonce, unambiguous alphabet
//   │  │    │      │      └ generation time, Africa/Dar_es_Salaam, 24h
//   │  │    │      └ coverage end   (YYMMDD)
//   │  │    └ coverage start (YYMMDD)
//   │  └ customer id, zero padded
//   └ customer statement

function referenceTimeKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}${part("minute")}`;
}

/** Excludes I, O, 0 and 1 so a reference read off paper cannot be mistyped. */
function referenceNonce(length = 4): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function referenceDateKey(iso: string | null | undefined, fallback: Date): string {
  const d = iso ? new Date(iso) : fallback;
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "2-digit", month: "2-digit", day: "2-digit", timeZone: "Africa/Dar_es_Salaam",
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}${part("month")}${part("day")}`;
}

function buildStatementReference(customerId: number, coverage: { from: string | null; to: string | null }, generatedAt: Date): string {
  return `CS-${String(customerId).padStart(4, "0")}-${referenceDateKey(coverage.from, generatedAt)}-${referenceDateKey(coverage.to, generatedAt)}-${referenceTimeKey(generatedAt)}-${referenceNonce()}`;
}

export default function CustomerStatementPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const customerId = Number(idParam);

  const [data, setData] = useState<Statement | null>(null);
  const [behaviour, setBehaviour] = useState<Behaviour | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {};
      if (from) params.from = from;
      if (to) params.to = to;
      // Behaviour is scoped by the same period and fetched in parallel. It is
      // optional: if it fails the statement still prints, minus that section.
      const [r, b] = await Promise.all([
        api.get<Statement>(`/api/admin/users/${customerId}/statement`, { params }),
        api.get<Behaviour>(`/api/admin/users/${customerId}/behaviour`, { params }).catch(() => null),
      ]);
      setData(r.data);
      setBehaviour(b?.data ?? null);
    } catch (err: any) {
      console.error("Failed to load customer statement", err);
      setError(err?.response?.data?.error || "Could not load this statement.");
      setData(null);
      setBehaviour(null);
    } finally {
      setLoading(false);
    }
  }, [customerId, from, to]);

  useEffect(() => { void load(); }, [load]);

  const periodLabel = useMemo(() => {
    if (!data) return "";
    const f = data.period.from ? day(data.period.from) : null;
    const t = data.period.to ? day(data.period.to) : null;
    if (!f && !t) return "All activity to date";
    if (f && t) return `${f} to ${t}`;
    if (f) return `From ${f}`;
    return `Up to ${t}`;
  }, [data]);

  const customerLabel = data?.customer.name?.trim() || data?.customer.email || `Customer #${customerId}`;

  // Derived once and shared by the screen tiles and the printed document, so
  // the two can never round differently.
  const topChannel = behaviour?.payments.channels[0] ?? null;
  const cancelRate = behaviour && behaviour.funnel.totals.created > 0
    ? Math.round((behaviour.funnel.totals.canceled / behaviour.funnel.totals.created) * 100)
    : null;
  const abandonRate = behaviour && behaviour.funnel.totals.created > 0
    ? Math.round((behaviour.funnel.totals.abandoned / behaviour.funnel.totals.created) * 100)
    : null;

  const referencePattern = useMemo(() => {
    if (!data) return "CS-....-......-......-....-....";
    const now = new Date();
    return `CS-${String(customerId).padStart(4, "0")}-${referenceDateKey(data.coverage.from, now)}-${referenceDateKey(data.coverage.to, now)}-HHMM-XXXX`;
  }, [data, customerId]);

  async function printStatement() {
    if (!data) return;
    // Opened synchronously inside the click so the popup blocker allows it.
    const printWindow = openAdminReportPrintWindow();
    if (!printWindow) {
      setError("Unable to open the report preview. Please allow popups and try again.");
      return;
    }
    setPrinting(true);
    try {
      const generatedAt = new Date();
      let reportRef = buildStatementReference(customerId, data.coverage, generatedAt);
      let qrDataUrl: string | null = null;

      try {
        const sealRes = await fetch("/api/reports/seal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            kind: "CUSTOMER_STATEMENT",
            title: `Customer statement - ${customerLabel}`,
            ref: reportRef,
            from: day(data.coverage.from),
            to: day(data.coverage.to),
            figures: [
              { label: "Customer", value: customerLabel },
              { label: "Customer ID", value: String(data.customer.id) },
              { label: "Total paid (TZS)", value: amount(data.totals.paidAmount) },
              { label: "Paid records", value: String(data.totals.paidRecords) },
              { label: "Records created", value: String(data.totals.records) },
              { label: "Records canceled", value: String(data.totals.canceled) },
              { label: "Sign-ins recorded", value: String(data.usage.sessions) },
              { label: "Time on platform", value: duration(data.usage.engagedMinutes) },
              { label: "Active days", value: String(data.usage.activeDays) },
              { label: "Refunded (TZS)", value: amount(data.refunds.refundedAmount) },
              { label: "Refund owed (TZS)", value: amount(data.refunds.outstandingAmount) },
              { label: "Roles held", value: String(data.roles?.roles.length ?? 0) },
            ],
          }),
        });
        const sealJson: any = await sealRes.json().catch(() => null);
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

      // The print window's title becomes the saved PDF filename, so it leads
      // with the customer rather than a prefix every statement shares.
      const fileSlug = customerLabel.replace(/[^a-z0-9]+/gi, "").slice(0, 40) || `Customer${customerId}`;
      const logoUrl = new URL("/assets/NoLS2025-04.png", window.location.origin).toString();

      let barcodeDataUrl: string | null = null;
      try {
        const mod: any = await import("jsbarcode");
        const JsBarcode: any = mod?.default ?? mod;
        const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        JsBarcode(svgNode, reportRef, {
          format: "CODE128", displayValue: false, margin: 0,
          width: 1.1, height: 30, background: "#ffffff", lineColor: "#0b1220",
        });
        barcodeDataUrl = `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svgNode))))}`;
      } catch {
        barcodeDataUrl = null;
      }

      const empty = (cols: number, text: string) =>
        `<tr><td colspan="${cols}" class="emptyState">${escapeHtml(text)}</td></tr>`;

      const roleRows = data.roles && data.roles.roles.length
        ? data.roles.roles.map((r) => `
            <tr>
              <td>${escapeHtml(r.label)}</td>
              <td>${escapeHtml(r.source === "ACCOUNT" ? "Account role" : r.additive ? "Held in addition" : "Defines the account")}</td>
              <td>${escapeHtml(r.scope || "-")}</td>
              <td>${escapeHtml(pretty(r.status))}${r.active ? "" : `<br /><span class="muted">Not currently in use</span>`}</td>
              <td>${escapeHtml(r.since ? day(r.since) : "-")}</td>
              <td class="muted">${escapeHtml(r.detail || "-")}</td>
            </tr>`).join("")
        : empty(6, "No role information was available when this statement was produced.");

      const serviceRows = data.services.length
        ? data.services.map((s) => `
            <tr>
              <td style="border-left:3px solid ${serviceTone(s.key).print};"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${serviceTone(s.key).print};margin-right:5px;"></span>${escapeHtml(s.label)}</td>
              <td class="num">${escapeHtml(String(s.records))}</td>
              <td class="num">${escapeHtml(String(s.paidRecords))}</td>
              <td class="num">${escapeHtml(String(s.canceled))}</td>
              <td>${escapeHtml(s.currency)}</td>
              <td class="num">${escapeHtml(amount(s.paidAmount))}</td>
            </tr>`).join("")
        : empty(6, "No service records in this period.");

      const entryRows = data.entries.length
        ? data.entries.slice(0, PRINT_ROW_LIMIT).map((e) => `
            <tr>
              <td style="border-left:3px solid ${serviceTone(e.key).print};">${escapeHtml(e.reference)}</td>
              <td><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${serviceTone(e.key).print};margin-right:5px;"></span>${escapeHtml(e.service)}</td>
              <td>${escapeHtml(e.description)}</td>
              <td>${escapeHtml(day(e.createdAt))}</td>
              <td>${escapeHtml(pretty(e.status))}</td>
              <td>${escapeHtml(e.currency)}</td>
              <td class="num">${escapeHtml(amount(e.amount))}</td>
            </tr>`).join("")
        : empty(7, "No booking of any kind was recorded in this period.");

      // ── Behaviour ──
      // Sourced from the behaviour endpoint so these figures match the
      // Behaviour tab exactly rather than being recomputed here.
      const channelRows = behaviour?.payments.channels.length
        ? behaviour.payments.channels.map((c) => `
            <tr>
              <td>${escapeHtml(c.label)}</td>
              <td class="num">${escapeHtml(String(c.attempts))}</td>
              <td class="num">${escapeHtml(String(c.succeeded))}</td>
              <td class="num">${escapeHtml(String(c.failed))}</td>
              <td class="num">${escapeHtml(String(c.pending))}</td>
              <td class="num">${escapeHtml(String(c.share))}%</td>
            </tr>`).join("")
        : empty(6, "No payment attempt was recorded for this customer.");

      const funnelRows = behaviour?.funnel.byProduct.length
        ? behaviour.funnel.byProduct.map((f) => `
            <tr>
              <td style="border-left:3px solid ${serviceTone(f.key).print};"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${serviceTone(f.key).print};margin-right:5px;"></span>${escapeHtml(f.label)}</td>
              <td class="num">${escapeHtml(String(f.created))}</td>
              <td class="num">${escapeHtml(String(f.paid))}</td>
              <td class="num">${escapeHtml(String(f.canceled))}</td>
              <td class="num">${escapeHtml(String(f.abandoned))}</td>
              <td class="num">${escapeHtml(f.created > 0 ? `${Math.round((f.canceled / f.created) * 100)}%` : "-")}</td>
            </tr>`).join("")
        : empty(6, "No booking activity to analyse in this period.");

      const signalRows = behaviour?.conduct.signals.length
        ? behaviour.conduct.signals.map((sig) => `
            <tr>
              <td>${escapeHtml(sig.label)}</td>
              <td><span class="status" style="background:${sig.severity === "ACTION" ? "#fdeaea" : sig.severity === "WATCH" ? "#fff6e5" : "#eaf8f3"};color:${sig.severity === "ACTION" ? "#a11212" : sig.severity === "WATCH" ? "#8a4b00" : "#006b4f"};">${escapeHtml(pretty(sig.severity))}</span></td>
              <td>${escapeHtml(sig.value)}</td>
              <td class="muted">${escapeHtml(sig.detail)}</td>
              <td class="muted">${escapeHtml(sig.threshold)}</td>
            </tr>`).join("")
        : empty(5, "No conduct signal was recorded for this customer.");

      const destinationRows = behaviour?.preferences.topDestinations.length
        ? behaviour.preferences.topDestinations.slice(0, 8).map((d) => `
            <tr><td>${escapeHtml(d.name)}</td><td class="num">${escapeHtml(String(d.records))}</td></tr>`).join("")
        : empty(2, "No destination preference recorded.");

      const behaviourSections = behaviour ? `
    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">07</span><div><h2>Payment behaviour</h2><p>How this customer pays, and how reliably those payments complete.</p></div></div>
      <div class="metricGrid">
        <div class="metricCard"><span class="metricLabel">Preferred payment method</span><strong>${escapeHtml(topChannel ? topChannel.label : "None recorded")}</strong><small>${escapeHtml(topChannel ? `${topChannel.share}% of successful payments, ${topChannel.attemptShare}% of all attempts.` : "No payment attempt has been recorded against this account.")}</small></div>
        <div class="metricCard${behaviour.payments.successRate !== null && behaviour.payments.successRate < 60 ? " metricCardWarn" : ""}"><span class="metricLabel">Payment success rate</span><strong>${escapeHtml(behaviour.payments.successRate === null ? "n/a" : `${behaviour.payments.successRate}%`)}</strong><small>${escapeHtml(String(behaviour.payments.succeeded))} succeeded and ${escapeHtml(String(behaviour.payments.failed))} failed of ${escapeHtml(String(behaviour.payments.attempts))} attempt(s).</small></div>
        <div class="metricCard"><span class="metricLabel">Methods used</span><strong>${escapeHtml(String(behaviour.payments.channels.length))}</strong><small>${escapeHtml(behaviour.payments.channels.map((c) => c.label).join(", ") || "None")}.</small></div>
      </div>
      <div class="tableWrap"><table>
        <thead><tr><th>Method</th><th style="text-align:right;">Attempts</th><th style="text-align:right;">Succeeded</th><th style="text-align:right;">Failed</th><th style="text-align:right;">Unresolved</th><th style="text-align:right;">Share of paid</th></tr></thead>
        <tbody>${channelRows}</tbody>
      </table></div>
      <div class="reportNote">${escapeHtml(behaviour.payments.coverage)} Unresolved means a payment was started and never confirmed or rejected; counting those as failures would overstate rejection.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">08</span><div><h2>Cancellation and completion behaviour</h2><p>What this customer does after creating a booking.</p></div></div>
      <div class="metricGrid">
        <div class="metricCard${cancelRate !== null && cancelRate >= 30 ? " metricCardWarn" : ""}"><span class="metricLabel">Cancellation rate</span><strong>${escapeHtml(cancelRate === null ? "n/a" : `${cancelRate}%`)}</strong><small>${escapeHtml(String(behaviour.funnel.totals.canceled))} canceled of ${escapeHtml(String(behaviour.funnel.totals.created))} created.</small></div>
        <div class="metricCard${abandonRate !== null && abandonRate >= 50 ? " metricCardWarn" : ""}"><span class="metricLabel">Payment abandonment</span><strong>${escapeHtml(abandonRate === null ? "n/a" : `${abandonRate}%`)}</strong><small>${escapeHtml(String(behaviour.funnel.totals.abandoned))} created but never paid and never canceled.</small></div>
        <div class="metricCard metricCardGood"><span class="metricLabel">Completed</span><strong>${escapeHtml(String(behaviour.funnel.totals.paid))}</strong><small>Reached a paid state, of ${escapeHtml(String(behaviour.funnel.totals.created))} created. ${escapeHtml(String(behaviour.funnel.plannedNeverBooked))} trip estimate(s) never became a booking.</small></div>
      </div>
      <div class="tableWrap"><table>
        <thead><tr><th>Service</th><th style="text-align:right;">Created</th><th style="text-align:right;">Paid</th><th style="text-align:right;">Canceled</th><th style="text-align:right;">Abandoned</th><th style="text-align:right;">Cancel rate</th></tr></thead>
        <tbody>${funnelRows}</tbody>
      </table></div>
      <div class="reportNote">Cancellation behaviour is reported per service because it rarely sits evenly: a customer may complete every stay and abandon every transport request. A single blended rate would hide that.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">09</span><div><h2>Conduct signals</h2><p>Recorded observations against published thresholds. Overall band: ${escapeHtml(pretty(behaviour.conduct.band))}.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>Signal</th><th>Severity</th><th>Value</th><th>Detail</th><th>Threshold</th></tr></thead>
        <tbody>${signalRows}</tbody>
      </table></div>
      <div class="reportNote">Every signal is stated with the threshold it is measured against, so a reader can see why it was graded that way rather than taking the grade on trust. ${escapeHtml(behaviour.conduct.restrictions.length > 0 ? `${behaviour.conduct.restrictions.length} restriction case(s) are on record.` : "No restriction case is on record.")}</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">10</span><div><h2>Preferences and engagement</h2><p>Where this customer books and how they interact with the platform.</p></div></div>
      <div class="panelGrid panelGridTwo">
        <div class="reportPanel">
          <div class="panelTitle">Most booked destinations</div>
          <div class="panelBody"><table><thead><tr><th>Destination</th><th style="text-align:right;">Records</th></tr></thead><tbody>${destinationRows}</tbody></table></div>
        </div>
        <div class="reportPanel">
          <div class="panelTitle">Engagement</div>
          <div class="panelBody"><table><tbody>
            <tr><td>Sign-ins recorded</td><td class="num">${escapeHtml(String(behaviour.engagement.totalLogins))}</td></tr>
            <tr><td>Recent sign-ins</td><td class="num">${escapeHtml(String(behaviour.engagement.recentLogins))}</td></tr>
            <tr><td>Saved properties</td><td class="num">${escapeHtml(String(behaviour.preferences.savedProperties))}</td></tr>
            <tr><td>Trip estimates run</td><td class="num">${escapeHtml(String(behaviour.preferences.tripEstimates))}</td></tr>
            <tr><td>Reviews written</td><td class="num">${escapeHtml(String(behaviour.preferences.reviewsWritten))}</td></tr>
            <tr><td>Average rating given</td><td class="num">${escapeHtml(behaviour.preferences.averageRating === null ? "-" : String(behaviour.preferences.averageRating))}</td></tr>
          </tbody></table></div>
        </div>
      </div>
    </section>` : `
    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">07</span><div><h2>Behaviour</h2><p>Payment, cancellation and conduct behaviour.</p></div></div>
      <div class="tableWrap"><table><tbody><tr><td class="emptyState">Behaviour analysis was not available when this statement was produced. The rest of this document is unaffected.</td></tr></tbody></table></div>
    </section>`;

      const refundRows = data.refunds.entries.length
        ? data.refunds.entries.slice(0, PRINT_ROW_LIMIT).map((r) => `
            <tr>
              <td>${escapeHtml(r.bookingCode || `#${r.id}`)}</td>
              <td>${escapeHtml(pretty(r.status))}</td>
              <td class="num">${escapeHtml(amount(r.amount))}</td>
              <td>${escapeHtml(r.policyRefundPercent !== null ? `${r.policyRefundPercent}%` : "-")}${r.policyRule ? `<br /><span class="muted">${escapeHtml(pretty(r.policyRule))}</span>` : ""}</td>
              <td>${escapeHtml(r.reference || "-")}${r.provider ? `<br /><span class="muted">${escapeHtml(r.provider)}</span>` : ""}</td>
              <td>${escapeHtml(day(r.requestedAt))}</td>
              <td>${escapeHtml(r.refundedAt ? day(r.refundedAt) : r.approvedAt ? "Approved, not sent" : "-")}</td>
            </tr>`).join("")
        : empty(7, "This customer has requested no refund in this period.");

      const preparedBy = data.generatedBy.email
        ? `${data.generatedBy.name || "Administrator"} · ${data.generatedBy.email}`
        : (data.generatedBy.name || "NoLSAF Administration");

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(`${fileSlug}-${reportRef}`)}</title>
  <style>
    ${adminReportPrintStyles("portrait")}
  </style>
</head>
<body>
  <div class="reportPage">
    <main class="reportDocument">
    ${buildAdminReportHeader({
      logoUrl,
      eyebrow: "NoLSAF customer account record",
      title: "Customer statement",
      description: `A complete record of ${customerLabel} on the NoLSAF platform: every role held, how the account has been used, and everything booked and paid for across accommodation, tours, transport and group stays.`,
      reportId: generatedAt.toISOString(),
      reportRef,
      barcodeDataUrl,
      from: day(data.coverage.from),
      to: day(data.coverage.to),
      generatedAt: stamp(generatedAt.toISOString()),
      preparedBy,
      classification: "Customer account and dispute handling",
    })}

    <div class="metricGrid">
      <div class="metricCard metricCardGood"><span class="metricLabel">Total paid</span><strong>TZS ${escapeHtml(amount(data.totals.paidAmount))}</strong><small>Across ${escapeHtml(String(data.totals.paidRecords))} paid record(s) of ${escapeHtml(String(data.totals.records))} created. Covers services priced in TZS.</small></div>
      <div class="metricCard"><span class="metricLabel">Services used</span><strong>${escapeHtml(String(data.services.filter(s => s.records > 0).length))}</strong><small>${escapeHtml(data.services.filter(s => s.records > 0).map(s => s.label).join(", ") || "No service used in this period")}.</small></div>
      <div class="metricCard${data.totals.canceled > 0 ? " metricCardWarn" : ""}"><span class="metricLabel">Canceled or refunded</span><strong>${escapeHtml(String(data.totals.canceled))}</strong><small>Records that did not complete, of ${escapeHtml(String(data.totals.records))} created in this period.</small></div>
      <div class="metricCard"><span class="metricLabel">Time on platform</span><strong>${escapeHtml(duration(data.usage.engagedMinutes))}</strong><small>Across ${escapeHtml(String(data.usage.sessions))} sign-in(s) on ${escapeHtml(String(data.usage.activeDays))} separate day(s).</small></div>
      <div class="metricCard"><span class="metricLabel">Relationship length</span><strong>${escapeHtml(String(data.usage.relationshipDays))} days</strong><small>First recorded activity ${escapeHtml(day(data.usage.firstSeenAt))}, most recent ${escapeHtml(day(data.usage.lastSeenAt))}.</small></div>
      <div class="metricCard${data.customer.suspendedAt || data.customer.isDisabled ? " metricCardWarn" : " metricCardGood"}"><span class="metricLabel">Account standing</span><strong>${escapeHtml(data.customer.suspendedAt ? "Suspended" : data.customer.isDisabled ? "Disabled" : "Active")}</strong><small>${escapeHtml(data.customer.suspendedAt ? `Suspended on ${day(data.customer.suspendedAt)}.` : "No suspension recorded.")} Joined ${escapeHtml(day(data.customer.createdAt))}.</small></div>
    </div>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">01</span><div><h2>Customer identity</h2><p>Who this statement concerns and how the account is verified.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Field</th><th>Recorded value</th><th>Field</th><th>Recorded value</th></tr></thead>
        <tbody>
          <tr><td>Name</td><td>${escapeHtml(data.customer.name?.trim() || "Name not set")}</td><td>Customer ID</td><td>${escapeHtml(String(data.customer.id))}</td></tr>
          <tr><td>Email</td><td>${escapeHtml(data.customer.email || "Not provided")}</td><td>Email verified</td><td>${escapeHtml(data.customer.emailVerifiedAt ? day(data.customer.emailVerifiedAt) : "Not verified")}</td></tr>
          <tr><td>Phone</td><td>${escapeHtml(data.customer.phone || "Not provided")}</td><td>Phone verified</td><td>${escapeHtml(data.customer.phoneVerifiedAt ? day(data.customer.phoneVerifiedAt) : "Not verified")}</td></tr>
          <tr><td>Joined</td><td>${escapeHtml(day(data.customer.createdAt))}</td><td>Account role</td><td>${escapeHtml(pretty(data.customer.role))}</td></tr>
          <tr><td>Account status</td><td>${escapeHtml(data.customer.suspendedAt ? `Suspended on ${day(data.customer.suspendedAt)}` : data.customer.isDisabled ? "Disabled" : "Active")}</td><td>Statement period</td><td>${escapeHtml(periodLabel)}</td></tr>
        </tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">02</span><div><h2>Roles held</h2><p>Every capability this account carries. The account role is one column and is not the whole picture.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Role</th><th>Kind</th><th>Where it applies</th><th>Status</th><th>Since</th><th>Detail</th></tr></thead>
        <tbody>${roleRows}</tbody>
      </table></div>
      <div class="reportNote">A role is listed whether or not it is currently in use: a staff invitation that was never accepted still explains why the account appears in a property's staff list. "Held in addition" means the role sits alongside the account role, which is how a traveller can also tend a bar. "Defines the account" means holding it changed the account role itself, so it is not a second hat worn at the same time.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">03</span><div><h2>Service usage and spend</h2><p>What this customer has bought from NoLSAF, by service.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Service</th><th style="text-align:right;">Created</th><th style="text-align:right;">Paid</th><th style="text-align:right;">Canceled</th><th>Currency</th><th style="text-align:right;">Amount paid</th></tr></thead>
        <tbody>${serviceRows}</tbody>
      </table></div>
      <div class="reportNote">${data.services.map((s) => `<span style="display:inline-block;margin-right:12px;"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${serviceTone(s.key).print};margin-right:4px;"></span>${escapeHtml(s.label)}</span>`).join("")}<br />The headline total covers services priced in TZS. A service priced in another currency is listed in this table with its own currency and is deliberately not folded into the total, because summing across currencies would misstate it.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">04</span><div><h2>Platform usage</h2><p>How much this account has actually been used.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Measure</th><th>Value</th><th>Measure</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Sign-ins recorded</td><td>${escapeHtml(String(data.usage.sessions))}</td><td>Sessions still active</td><td>${escapeHtml(String(data.usage.activeSessions))}</td></tr>
          <tr><td>Time on platform</td><td>${escapeHtml(duration(data.usage.engagedMinutes))}</td><td>Separate active days</td><td>${escapeHtml(String(data.usage.activeDays))}</td></tr>
          <tr><td>First recorded activity</td><td>${escapeHtml(stamp(data.usage.firstSeenAt))}</td><td>Most recent activity</td><td>${escapeHtml(stamp(data.usage.lastSeenAt))}</td></tr>
        </tbody>
      </table></div>
      <div class="reportNote">${escapeHtml(data.usage.basis)}</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">05</span><div><h2>Booking register</h2><p>Every record this customer created in the period, across all services.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>Reference</th><th>Service</th><th>Description</th><th>Created</th><th>Status</th><th>Currency</th><th style="text-align:right;">Amount</th></tr></thead>
        <tbody>${entryRows}</tbody>
      </table></div>
      <div class="reportNote">This register prints up to ${escapeHtml(String(PRINT_ROW_LIMIT))} rows. Where there are more, the on-screen statement holds the complete list. Amounts are the recorded value of the record, whatever its status: a canceled record still shows what it was worth.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">06</span><div><h2>Refunds</h2><p>Money owed back to this customer, and whether it reached them.</p></div></div>
      <div class="metricGrid">
        <div class="metricCard metricCardGood"><span class="metricLabel">Refunded</span><strong>TZS ${escapeHtml(amount(data.refunds.refundedAmount))}</strong><small>${escapeHtml(String(data.refunds.refundedCount))} refund(s) confirmed as paid back.</small></div>
        <div class="metricCard"><span class="metricLabel">Approved</span><strong>TZS ${escapeHtml(amount(data.refunds.approvedAmount))}</strong><small>Agreed under the cancellation policy, whether or not it has yet been sent.</small></div>
        <div class="metricCard${data.refunds.outstandingCount > 0 ? " metricCardWarn" : ""}"><span class="metricLabel">Approved but not sent</span><strong>TZS ${escapeHtml(amount(data.refunds.outstandingAmount))}</strong><small>${escapeHtml(String(data.refunds.outstandingCount))} refund(s) approved and not yet marked as refunded.</small></div>
      </div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>Booking</th><th>Status</th><th style="text-align:right;">Amount</th><th>Policy</th><th>Provider reference</th><th>Requested</th><th>Refunded</th></tr></thead>
        <tbody>${refundRows}</tbody>
      </table></div>
      <div class="reportNote">Approved is what was agreed under the cancellation policy; refunded is what actually left NoLSAF. They are reported separately because the gap between them is the exact figure a customer disputing a refund is calling about. Quote the provider reference when tracing a refund the customer says never arrived.</div>
    </section>

    ${behaviourSections}

    ${buildAdminReportFooter({
      reportRef,
      qrDataUrl,
      purpose: "Scan the QR code to confirm the sealed figures on the public NoLSAF verification page.",
      signatureLabel: "Customer account authorization",
    })}
    </main>
  </div>
</body>
</html>`;

      await renderAndPrintAdminReport(printWindow, html);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="min-h-screen min-w-0 overflow-x-clip">
    <div className="mx-auto box-border w-full min-w-0 max-w-6xl px-3 py-4 sm:px-5 sm:py-6">
      <header className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-neutral-200 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#073c35] text-white">
            <FileText className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NoLSAF customer account record</p>
            <h1 className="mb-0 mt-1 truncate text-xl font-bold tracking-tight text-neutral-950">
              Customer statement{data ? ` · ${customerLabel}` : ""}
            </h1>
            <p className="mb-0 mt-1 text-xs text-neutral-500">
              {data ? periodLabel : "Roles, platform usage, and everything booked and paid for."}
            </p>
          </div>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          <Link
            href={`/admin/users/${customerId}`}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-sm font-medium text-neutral-700 no-underline ring-1 ring-neutral-200 transition hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <button
            type="button"
            onClick={() => void printStatement()}
            disabled={!data || printing}
            className="inline-flex h-10 items-center gap-2 rounded-xl border-0 bg-[#073c35] px-4 text-sm font-semibold text-white transition hover:bg-[#0a5148] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            {printing ? "Preparing..." : "Print statement"}
          </button>
        </div>
      </header>

      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-neutral-200">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Period</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => { setFromOpen(v => !v); setToOpen(false); }}
            className="inline-flex items-center gap-2 rounded-lg border-2 border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50"
          >
            <Calendar className="h-4 w-4 text-neutral-400" />
            {from ? day(from) : "Start of record"}
          </button>
          {fromOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFromOpen(false)} />
              <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
                <DatePicker
                  selected={from || undefined}
                  onSelectAction={(s) => setFrom(Array.isArray(s) ? (s[0] || "") : ((s as string) || ""))}
                  onCloseAction={() => setFromOpen(false)}
                />
              </div>
            </>
          ) : null}
        </div>
        <span className="text-xs text-neutral-400">to</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => { setToOpen(v => !v); setFromOpen(false); }}
            className="inline-flex items-center gap-2 rounded-lg border-2 border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50"
          >
            <Calendar className="h-4 w-4 text-neutral-400" />
            {to ? day(to) : "Today"}
          </button>
          {toOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setToOpen(false)} />
              <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
                <DatePicker
                  selected={to || undefined}
                  onSelectAction={(s) => setTo(Array.isArray(s) ? (s[0] || "") : ((s as string) || ""))}
                  onCloseAction={() => setToOpen(false)}
                />
              </div>
            </>
          ) : null}
        </div>
        {from || to ? (
          <button
            type="button"
            onClick={() => { setFrom(""); setTo(""); }}
            className="rounded-lg border-0 bg-transparent px-2 py-1.5 text-sm text-neutral-500 transition hover:text-neutral-800"
          >
            Clear
          </button>
        ) : null}
        {data ? (
          <span className="w-full text-[11px] font-medium text-neutral-500 sm:ml-auto sm:w-auto">
            Covers {day(data.coverage.from)} to {day(data.coverage.to)}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-2xl bg-white p-12 text-center shadow-sm ring-1 ring-neutral-200">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-solid border-neutral-300 border-t-[#073c35]" />
        </div>
      ) : error || !data ? (
        <div className="rounded-2xl bg-white p-12 text-center shadow-sm ring-1 ring-neutral-200">
          <FileText className="mx-auto mb-3 h-12 w-12 text-neutral-300" />
          <p className="text-sm text-neutral-600">{error ?? "No statement available."}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric tone="good" label="Total paid" value={money(data.totals.paidAmount)} note={`${data.totals.paidRecords} paid of ${data.totals.records} records created`} />
            <Metric label="Services used" value={String(data.services.filter(s => s.records > 0).length)} note={data.services.filter(s => s.records > 0).map(s => s.label).join(", ") || "None in this period"} />
            <Metric tone={data.totals.canceled > 0 ? "warn" : undefined} label="Canceled or refunded" value={String(data.totals.canceled)} note={`Of ${data.totals.records} records created`} />
            <Metric label="Time on platform" value={duration(data.usage.engagedMinutes)} note={`${data.usage.sessions} sign-ins on ${data.usage.activeDays} separate days`} />
            <Metric label="Relationship length" value={`${data.usage.relationshipDays} days`} note={`First seen ${day(data.usage.firstSeenAt)}, last ${day(data.usage.lastSeenAt)}`} />
            <Metric
              tone={data.customer.suspendedAt || data.customer.isDisabled ? "bad" : "good"}
              label="Account standing"
              value={data.customer.suspendedAt ? "Suspended" : data.customer.isDisabled ? "Disabled" : "Active"}
              note={`${data.customer.suspendedAt ? `Suspended on ${day(data.customer.suspendedAt)}` : "No suspension recorded"}, joined ${day(data.customer.createdAt)}`}
            />
            <Metric
              tone={data.refunds.outstandingCount > 0 ? "warn" : undefined}
              label="Refunded"
              value={money(data.refunds.refundedAmount)}
              note={data.refunds.outstandingCount > 0
                ? `${money(data.refunds.outstandingAmount)} approved and not yet sent`
                : `${data.refunds.refundedCount} refund(s), nothing outstanding`}
            />
            {/* Behaviour tiles. Absent rather than zeroed when the behaviour
                endpoint did not answer, so a gap never reads as a clean record. */}
            {behaviour ? (
              <>
                <Metric
                  label="Preferred payment method"
                  value={topChannel ? topChannel.label : "None recorded"}
                  note={topChannel
                    ? `${topChannel.share}% of successful payments, ${topChannel.attemptShare}% of attempts`
                    : "No payment attempt recorded"}
                />
                <Metric
                  tone={behaviour.payments.successRate !== null && behaviour.payments.successRate < 60 ? "warn" : undefined}
                  label="Payment success rate"
                  value={behaviour.payments.successRate === null ? "n/a" : `${behaviour.payments.successRate}%`}
                  note={`${behaviour.payments.succeeded} succeeded, ${behaviour.payments.failed} failed of ${behaviour.payments.attempts} attempts`}
                />
                <Metric
                  tone={cancelRate !== null && cancelRate >= 30 ? "warn" : undefined}
                  label="Cancellation rate"
                  value={cancelRate === null ? "n/a" : `${cancelRate}%`}
                  note={`${behaviour.funnel.totals.canceled} canceled of ${behaviour.funnel.totals.created} created`}
                />
                <Metric
                  tone={abandonRate !== null && abandonRate >= 50 ? "warn" : undefined}
                  label="Payment abandonment"
                  value={abandonRate === null ? "n/a" : `${abandonRate}%`}
                  note={`${behaviour.funnel.totals.abandoned} created but never paid and never canceled`}
                />
                <Metric
                  tone={behaviour.conduct.band === "ACTION" ? "bad" : behaviour.conduct.band === "WATCH" ? "warn" : "good"}
                  label="Conduct band"
                  value={pretty(behaviour.conduct.band)}
                  note={`${behaviour.conduct.signals.filter((sg) => sg.severity !== "CLEAN").length} signal(s) above threshold, ${behaviour.conduct.restrictions.length} restriction case(s)`}
                />
              </>
            ) : null}
          </div>

          {/* Key for the service colours used on every row below and on the
              printed registers. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-neutral-200">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Services</span>
            {data.services.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-neutral-700">
                <span className={`h-2 w-2 rounded-sm ${serviceTone(s.key).dot}`} aria-hidden />
                {s.label}
                <span className="font-normal text-neutral-400">{s.records}</span>
              </span>
            ))}
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel icon={<Users className="h-4 w-4" />} title="Roles held" count={data.roles?.roles.length ?? 0} empty="No role information available.">
              {(data.roles?.roles ?? []).map((r, i) => (
                <Line
                  key={`${r.source}-${r.code}-${i}`}
                  left={r.label}
                  sub={[
                    r.source === "ACCOUNT" ? "Account role" : r.additive ? "Held in addition" : "Defines the account",
                    r.scope,
                    r.detail,
                  ].filter(Boolean).join(" · ") || undefined}
                  right={r.active ? "Active" : pretty(r.status)}
                  tone={r.active ? "good" : "muted"}
                />
              ))}
            </Panel>

            <Panel icon={<Wallet className="h-4 w-4" />} title="Spend by service" count={data.services.filter(s => s.records > 0).length} empty="No service used in this period.">
              {data.services.filter(s => s.records > 0).map((s) => (
                <Line
                  key={s.key}
                  service={s.key}
                  left={s.label}
                  sub={`${s.records} created, ${s.paidRecords} paid, ${s.canceled} canceled`}
                  right={money(s.paidAmount, s.currency)}
                />
              ))}
            </Panel>

            <Panel icon={<Clock className="h-4 w-4" />} title="Platform usage" count={data.usage.sessions} empty="No sign-in recorded.">
              <Line left="Time on platform" sub={data.usage.basis} right={duration(data.usage.engagedMinutes)} />
              <Line left="Sign-ins" sub={`${data.usage.activeSessions} sessions still active`} right={String(data.usage.sessions)} />
              <Line left="Active days" sub={`Over ${data.usage.relationshipDays} days of relationship`} right={String(data.usage.activeDays)} />
            </Panel>

            <Panel
              icon={<Wallet className="h-4 w-4" />}
              title="Refunds"
              count={data.refunds.entries.length}
              empty="No refund requested in this period."
            >
              {data.refunds.entries.slice(0, 6).map((r) => (
                <Line
                  key={r.id}
                  left={r.bookingCode || `#${r.id}`}
                  sub={[
                    pretty(r.status),
                    r.refundedAt ? `refunded ${day(r.refundedAt)}` : r.approvedAt ? "approved, not sent" : "not approved",
                    r.reference || null,
                  ].filter(Boolean).join(" · ")}
                  right={money(r.amount)}
                  tone={r.refundedAt ? "good" : undefined}
                />
              ))}
            </Panel>

            <Panel
              icon={<Wallet className="h-4 w-4" />}
              title="Payment methods used"
              count={behaviour?.payments.channels.length ?? 0}
              empty={behaviour ? "No payment attempt recorded." : "Behaviour analysis unavailable."}
            >
              {(behaviour?.payments.channels ?? []).map((c) => (
                <Line
                  key={c.key}
                  left={c.label}
                  sub={`${c.attempts} attempts, ${c.succeeded} succeeded, ${c.failed} failed${c.pending ? `, ${c.pending} unresolved` : ""}`}
                  right={`${c.share}%`}
                />
              ))}
            </Panel>

            <Panel
              icon={<Activity className="h-4 w-4" />}
              title="Cancellation by service"
              count={behaviour?.funnel.byProduct.length ?? 0}
              empty={behaviour ? "No booking activity to analyse." : "Behaviour analysis unavailable."}
            >
              {(behaviour?.funnel.byProduct ?? []).map((f) => (
                <Line
                  key={f.key}
                  service={f.key}
                  left={f.label}
                  sub={`${f.created} created, ${f.paid} paid, ${f.abandoned} abandoned`}
                  right={f.created > 0 ? `${Math.round((f.canceled / f.created) * 100)}%` : "-"}
                  tone={f.created > 0 && f.canceled / f.created >= 0.3 ? undefined : "muted"}
                />
              ))}
            </Panel>

            <Panel
              icon={<Activity className="h-4 w-4" />}
              title="Conduct signals"
              count={behaviour?.conduct.signals.length ?? 0}
              empty={behaviour ? "No conduct signal recorded." : "Behaviour analysis unavailable."}
            >
              {(behaviour?.conduct.signals ?? []).map((sg) => (
                <Line
                  key={sg.key}
                  left={sg.label}
                  sub={sg.detail}
                  right={`${sg.value} · ${pretty(sg.severity)}`}
                  tone={sg.severity === "CLEAN" ? "muted" : undefined}
                />
              ))}
            </Panel>

            <Panel icon={<Activity className="h-4 w-4" />} title="Booking register" count={data.entries.length} empty="No booking of any kind in this period.">
              {data.entries.slice(0, 6).map((e) => (
                <Line
                  key={`${e.key}-${e.reference}`}
                  service={e.key}
                  left={e.reference}
                  sub={`${e.service} · ${e.description}`}
                  right={money(e.amount, e.currency)}
                  mono
                />
              ))}
            </Panel>
          </div>

          <div className="min-w-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">About this statement</div>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              Printing seals the figures and stamps the document with your name, the time, and a reference of the form{" "}
              <span className="font-mono font-semibold text-neutral-800">{referencePattern}</span>. A fresh reference is minted
              for each printed copy, so a sealed document identifies one exact print. The printed copy carries a scannable
              verification code so the customer can confirm it is genuine without logging in.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              {data.usage.basis}
            </p>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "warn" | "bad" }) {
  const skin =
    tone === "good" ? "bg-emerald-50 ring-emerald-200" :
    tone === "warn" ? "bg-amber-50 ring-amber-200" :
    tone === "bad" ? "bg-red-50 ring-red-200" :
    "bg-white ring-neutral-200";
  const ink =
    tone === "good" ? "text-emerald-900" :
    tone === "warn" ? "text-amber-900" :
    tone === "bad" ? "text-red-900" :
    "text-neutral-950";
  return (
    <div className={`min-w-0 rounded-2xl p-4 shadow-sm ring-1 ${skin}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">{label}</div>
      <div className={`mt-1.5 break-words text-base font-bold sm:text-lg ${ink}`}>{value}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-neutral-500">{note}</div>
    </div>
  );
}

function Panel({
  icon, title, count, empty, children,
}: { icon: React.ReactNode; title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 shadow-[inset_0_-1px_0_0_#e5e7eb]">
        <span className="inline-flex items-center gap-2 text-xs font-bold text-neutral-800">
          <span className="text-neutral-400">{icon}</span>
          {title}
        </span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral-600">{count}</span>
      </div>
      <div className="px-4 py-2">
        {count === 0 ? <p className="m-0 py-3 text-xs text-neutral-500">{empty}</p> : children}
        {count > 6 ? (
          <p className="m-0 py-2 text-[11px] text-neutral-400">and {count - 6} more, all included in the printed statement</p>
        ) : null}
      </div>
    </div>
  );
}

function Line({
  left, sub, right, mono, tone, service,
}: {
  left: string; sub?: string; right: string; mono?: boolean;
  tone?: "good" | "muted";
  /** Service key. When set, the row carries that service's category colour. */
  service?: string;
}) {
  const rightInk =
    tone === "good" ? "text-emerald-700" :
    tone === "muted" ? "text-neutral-400" :
    "text-neutral-700";
  const category = service ? serviceTone(service) : null;
  return (
    <div className={`flex items-start justify-between gap-3 py-1.5 [&+&]:shadow-[inset_0_1px_0_0_#f3f4f6] ${category ? `pl-2.5 ${category.rail}` : ""}`}>
      <div className="min-w-0">
        <div className={`flex items-center gap-1.5 truncate text-xs font-semibold text-neutral-800 ${mono ? "font-mono" : ""}`}>
          {category ? <span className={`h-1.5 w-1.5 shrink-0 rounded-sm ${category.dot}`} aria-hidden /> : null}
          <span className="truncate">{left}</span>
        </div>
        {sub ? <div className="text-[11px] leading-relaxed text-neutral-500 line-clamp-2">{sub}</div> : null}
      </div>
      <div className={`shrink-0 text-xs font-semibold tabular-nums ${rightInk}`}>{right}</div>
    </div>
  );
}
