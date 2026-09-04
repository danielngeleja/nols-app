"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer, Calendar, FileText, Building2, Wallet, Radar, Handshake } from "lucide-react";
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
/** Printed registers stay readable; the machine-readable export is elsewhere. */
const PRINT_ROW_LIMIT = 80;

type Money = number;

type Statement = {
  generatedAt: string;
  generatedBy: { id: number | null; name: string | null; email: string | null };
  /** What was asked for. Either end may be open. */
  period: { from: string | null; to: string | null };
  /** What the document actually spans, open ends resolved. */
  coverage: { from: string | null; to: string | null };
  owner: {
    id: number; name: string | null; email: string; phone: string | null;
    kycStatus: string | null; suspendedAt: string | null; createdAt: string;
  };
  capabilities: {
    nrms: { active: boolean; activatedAt: string | null; activeProperties: number; totalProperties: number };
    payments: { active: boolean; activatedAt: string | null; stage: string | null; merchantName: string | null; providerName: string | null };
  } | null;
  partners: {
    merchants: { id: number; name: string | null; status: string; propertyCount: number }[];
    merchantCount: number;
    hiddenDraftCount: number;
    hiddenDraftProperties: number;
    agents: { id: number; name: string | null; status: string; propertyCount: number }[];
    agentCount: number;
    activeAgentCount: number;
  } | null;
  properties: {
    id: number; title: string; status: string; type: string;
    regionName: string | null; district: string | null; nrmsActivatedAt: string | null;
  }[];
  bookings: { invoiceCount: number; paidCount: number; gross: Money; commission: Money; net: Money };
  invoices: {
    id: number; invoiceNumber: string | null; receiptNumber: string | null; status: string;
    total: Money; commissionAmount: Money; netPayable: Money;
    issuedAt: string | null; paidAt: string | null;
    paymentMethod: string | null; paymentRef: string | null;
    bookingId: number | null; propertyTitle: string | null;
  }[];
  payouts: {
    count: number; paidCount: number; paidAmount: Money;
    inFlightCount: number; inFlightAmount: Money;
    failedCount: number; failedAmount: Money;
    recoveryCount: number; recoveryAmount: Money;
    securityHoldCount: number; securityHoldAmount: Money;
  };
  disbursements: {
    id: number; invoiceId: number; status: string; amount: Money; currency: string;
    provider: string; bankName: string; operator: string | null;
    externalReferenceId: string; pgReferenceId: string | null; fspReferenceId: string | null;
    batchReference: string | null;
    raisedAt: string | null; approvedAt: string | null; submittedAt: string | null;
    paidAt: string | null; failedAt: string | null;
    riskLevel: string | null;
    reason: string | null;
    destination: {
      type: string; provider: string; accountName: string;
      accountNumberMasked: string | null; isVerified: boolean;
    } | null;
    events: { eventType: string; status: string | null; message: string | null; at: string | null }[];
  }[];
  nrmsBilling: {
    collected: Money; paymentsCount: number;
    billed: Money; statementsCount: number;
    outstanding: Money; outstandingCount: number;
    unbilledUsage: Money; accountsCount: number;
    currency: string;
  } | null;
  adminActions: { id: number; action: string; details: any; createdAt: string | null; adminName: string | null }[];
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

/** `pretty(null)` is "-", which is truthy, so a `||` fallback after it never
 *  fires. KYC has to say what a missing value means, not print a dash. */
function kycLabel(status: string | null | undefined, lower = false) {
  if (!status) return lower ? "not submitted" : "Not submitted";
  const text = pretty(status);
  return lower ? text.toLowerCase() : text;
}

// ── Report reference ────────────────────────────────────────────────────────
// Same construction the NRMS property reports use, so every NoLSAF report
// reference reads the same way and can be served from the same conventions:
//
//   OS-0013-260101-260904-2211-K7M2
//   │  │    │      │      │    └ crypto nonce, unambiguous alphabet
//   │  │    │      │      └ generation time, Africa/Dar_es_Salaam, 24h
//   │  │    │      └ coverage end   (YYMMDD)
//   │  │    └ coverage start (YYMMDD)
//   │  └ owner id, zero padded
//   └ owner statement
//
// The nonce is what makes it serve: two prints of the same owner and window
// get different references, so a sealed copy identifies one exact document.

/** Generation time in Tanzanian local time, so a reference reads correctly for
 *  the people filing it rather than in UTC. */
function referenceTimeKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Dar_es_Salaam",
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

/** YYMMDD in Tanzanian local time. */
function referenceDateKey(iso: string | null | undefined, fallback: Date): string {
  const d = iso ? new Date(iso) : fallback;
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Dar_es_Salaam",
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}${part("month")}${part("day")}`;
}

function buildStatementReference(ownerId: number, coverage: { from: string | null; to: string | null }, generatedAt: Date): string {
  const owner = String(ownerId).padStart(4, "0");
  const from = referenceDateKey(coverage.from, generatedAt);
  const to = referenceDateKey(coverage.to, generatedAt);
  return `OS-${owner}-${from}-${to}-${referenceTimeKey(generatedAt)}-${referenceNonce()}`;
}

/** Admin audit `details` is Json: it may already be a string, or an object. */
function detailText(details: any): string {
  if (details === null || details === undefined) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return "";
  }
}

export default function OwnerStatementPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const ownerId = Number(idParam);

  const [data, setData] = useState<Statement | null>(null);
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
      const r = await api.get<Statement>(`/api/admin/owners/${ownerId}/statement`, { params });
      setData(r.data);
    } catch (err: any) {
      console.error("Failed to load owner statement", err);
      setError(err?.response?.data?.error || "Could not load this statement.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ownerId, from, to]);

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

  const ownerLabel = data?.owner.name?.trim() || data?.owner.email || `Owner #${ownerId}`;

  /** Shape of the reference a print will mint, shown so an administrator knows
   *  what to expect on the paper. The real one carries a fresh nonce. */
  const referencePattern = useMemo(() => {
    if (!data) return "OS-....-......-......-....-....";
    const now = new Date();
    return `OS-${String(ownerId).padStart(4, "0")}-${referenceDateKey(data.coverage.from, now)}-${referenceDateKey(data.coverage.to, now)}-HHMM-XXXX`;
  }, [data, ownerId]);

  /** Builds the sealed, branded document and sends it to the printer. Follows
   *  the same shape as the management reports so every NoLSAF report prints
   *  the same way. */
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
      const nrms = data.nrmsBilling;
      const cur = nrms?.currency || DEFAULT_CURRENCY;

      // Minted per print, not per page load: this reference identifies one
      // exact printed copy, which is what makes it usable for serving.
      const generatedAt = new Date();

      // Seal the figures server side, then encode the public verification URL
      // as a QR so anyone can confirm the document without logging in.
      let reportRef = buildStatementReference(ownerId, data.coverage, generatedAt);
      let qrDataUrl: string | null = null;
      try {
        const sealRes = await fetch("/api/reports/seal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            kind: "OWNER_STATEMENT",
            title: `Owner statement - ${ownerLabel}`,
            ref: reportRef,
            from: day(data.coverage.from),
            to: day(data.coverage.to),
            figures: [
              { label: "Owner", value: ownerLabel },
              { label: "Owner ID", value: String(data.owner.id) },
              { label: "Gross bookings (TZS)", value: amount(data.bookings.gross) },
              { label: "NoLSAF commission (TZS)", value: amount(data.bookings.commission) },
              { label: "Owner net (TZS)", value: amount(data.bookings.net) },
              { label: "Paid out (TZS)", value: amount(data.payouts.paidAmount) },
              { label: `NRMS collected (${cur})`, value: amount(nrms?.collected ?? 0) },
              { label: `NRMS outstanding (${cur})`, value: amount(nrms?.outstanding ?? 0) },
              { label: "Invoices in period", value: String(data.bookings.invoiceCount) },
              { label: "Payouts recorded", value: String(data.payouts.count) },
              { label: "Payouts failed (TZS)", value: amount(data.payouts.failedAmount) },
              { label: "Payouts in progress (TZS)", value: amount(data.payouts.inFlightAmount) },
              { label: "Properties", value: String(data.properties.length) },
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

      // The print window's document title becomes the saved PDF filename, so
      // it leads with the owner rather than a prefix every statement shares.
      const ownerFileSlug =
        ownerLabel.replace(/[^a-z0-9]+/gi, "").slice(0, 40) || `Owner${ownerId}`;

      const logoUrl = new URL("/assets/NoLS2025-04.png", window.location.origin).toString();

      // CODE128 barcode of the reference for the header band.
      let barcodeDataUrl: string | null = null;
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
        barcodeDataUrl = `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svgNode))))}`;
      } catch {
        barcodeDataUrl = null;
      }

      const empty = (cols: number, text: string) =>
        `<tr><td colspan="${cols}" class="emptyState">${escapeHtml(text)}</td></tr>`;

      const propertyRows = data.properties.length
        ? data.properties.slice(0, PRINT_ROW_LIMIT).map((p) => `
            <tr>
              <td>${escapeHtml(String(p.id))}</td>
              <td>${escapeHtml(p.title)}</td>
              <td>${escapeHtml(pretty(p.type))}</td>
              <td>${escapeHtml([p.district, p.regionName].filter(Boolean).join(", ") || "-")}</td>
              <td>${escapeHtml(pretty(p.status))}</td>
              <td>${escapeHtml(p.nrmsActivatedAt ? day(p.nrmsActivatedAt) : "Not on NRMS")}</td>
            </tr>`).join("")
        : empty(6, "This owner has no properties on record.");

      const invoiceRows = data.invoices.length
        ? data.invoices.slice(0, PRINT_ROW_LIMIT).map((inv) => `
            <tr>
              <td>${escapeHtml(inv.invoiceNumber || `#${inv.id}`)}</td>
              <td>${escapeHtml(inv.propertyTitle || "-")}</td>
              <td>${escapeHtml(day(inv.issuedAt))}</td>
              <td>${escapeHtml(pretty(inv.status))}</td>
              <td class="num">${escapeHtml(amount(inv.total))}</td>
              <td class="num">${escapeHtml(amount(inv.commissionAmount))}</td>
              <td class="num">${escapeHtml(amount(inv.netPayable))}</td>
              <td>${escapeHtml(inv.paidAt ? day(inv.paidAt) : "-")}</td>
            </tr>`).join("")
        : empty(8, "No booking invoice was recorded in this period.");

      const payoutRows = data.disbursements.length
        ? data.disbursements.slice(0, PRINT_ROW_LIMIT).map((d) => {
            const destination = d.destination
              ? `${d.destination.accountName} · ${d.destination.provider} ${d.destination.accountNumberMasked ?? ""}`.trim()
              : "Destination account not recorded";
            const settled = d.paidAt
              ? day(d.paidAt)
              : d.failedAt
                ? `Failed ${day(d.failedAt)}`
                : d.submittedAt
                  ? `Submitted ${day(d.submittedAt)}`
                  : d.raisedAt
                    ? `Raised ${day(d.raisedAt)}`
                    : "-";
            // Why the money is not where the owner expects it: the recorded
            // reason if there is one, otherwise the provider's last word.
            const lastEvent = d.events[0];
            const note = d.reason
              || (lastEvent?.message ? `${pretty(lastEvent.eventType)}: ${lastEvent.message}` : "")
              || (d.status === "PAID" ? "" : "No provider message recorded");
            return `
            <tr>
              <td>#${escapeHtml(String(d.invoiceId))}</td>
              <td>${escapeHtml(pretty(d.status))}${d.riskLevel && d.riskLevel !== "LOW" ? `<br /><span class="muted">Risk ${escapeHtml(pretty(d.riskLevel))}</span>` : ""}</td>
              <td class="num">${escapeHtml(amount(d.amount))}</td>
              <td>${escapeHtml(destination)}${d.destination && !d.destination.isVerified ? `<br /><span class="muted">Not name-verified</span>` : ""}</td>
              <td>${escapeHtml(d.externalReferenceId)}${d.batchReference ? `<br /><span class="muted">Batch ${escapeHtml(d.batchReference)}</span>` : ""}</td>
              <td>${escapeHtml(d.pgReferenceId || d.fspReferenceId || "-")}</td>
              <td>${escapeHtml(settled)}${note ? `<br /><span class="muted">${escapeHtml(note.slice(0, 120))}</span>` : ""}</td>
            </tr>`;
          }).join("")
        : empty(7, "No payout has been raised against this owner's invoices.");

      const partnerRows = data.partners && (data.partners.merchantCount > 0 || data.partners.agentCount > 0)
        ? [
            ...data.partners.merchants.map((m) => `
              <tr>
                <td>Operating company</td>
                <td>${escapeHtml(m.name ?? "Not named yet")}</td>
                <td>${escapeHtml(pretty(m.status))}</td>
                <td class="num">${escapeHtml(String(m.propertyCount))}</td>
              </tr>`),
            ...data.partners.agents.map((a) => `
              <tr>
                <td>Travel agency</td>
                <td>${escapeHtml(a.name ?? "Not named yet")}</td>
                <td>${escapeHtml(pretty(a.status))}</td>
                <td class="num">${escapeHtml(String(a.propertyCount))}</td>
              </tr>`),
          ].join("")
        : empty(4, "No operating company or travel agency is linked to this owner.");

      const actionRows = data.adminActions.length
        ? data.adminActions.slice(0, PRINT_ROW_LIMIT).map((a) => `
            <tr>
              <td>${escapeHtml(stamp(a.createdAt))}</td>
              <td>${escapeHtml(pretty(a.action))}</td>
              <td>${escapeHtml(a.adminName || "Unknown")}</td>
              <td class="muted">${escapeHtml(detailText(a.details).slice(0, 180) || "-")}</td>
            </tr>`).join("")
        : empty(4, "No administrative action was recorded against this owner in this period.");

      const nrmsPanel = nrms && nrms.accountsCount > 0
        ? `
          <div class="metricGrid">
            <div class="metricCard metricCardGood"><span class="metricLabel">NRMS collected</span><strong>${escapeHtml(cur)} ${escapeHtml(amount(nrms.collected))}</strong><small>Paid to NoLSAF for the management system across ${escapeHtml(String(nrms.accountsCount))} property account(s). No partner split applies.</small></div>
            <div class="metricCard"><span class="metricLabel">Billed to date</span><strong>${escapeHtml(cur)} ${escapeHtml(amount(nrms.billed))}</strong><small>${escapeHtml(String(nrms.statementsCount))} statement(s) closed and issued.</small></div>
            <div class="metricCard${nrms.outstanding > 0 ? " metricCardWarn" : ""}"><span class="metricLabel">Awaiting collection</span><strong>${escapeHtml(cur)} ${escapeHtml(amount(nrms.outstanding))}</strong><small>${escapeHtml(String(nrms.outstandingCount))} statement(s) still payable. Usage not yet closed into a statement: ${escapeHtml(cur)} ${escapeHtml(amount(nrms.unbilledUsage))}.</small></div>
          </div>
          <div class="reportNote">NRMS billing is reported for the whole relationship, not the selected period. Statements close on their own cycle, so restricting them to a date range would misstate the balance.</div>`
        : `<div class="tableWrap"><table><tbody><tr><td class="emptyState">This owner has no NRMS billing account. No property of theirs has run on the management system.</td></tr></tbody></table></div>`;

      const cap = data.capabilities;
      const capabilityRows = cap
        ? `
          <tr>
            <td>NRMS management system</td>
            <td>${escapeHtml(cap.nrms.active ? "Active" : "Not activated")}</td>
            <td>${escapeHtml(cap.nrms.active ? (cap.nrms.activatedAt ? day(cap.nrms.activatedAt) : "Date not recorded") : "-")}</td>
            <td>${escapeHtml(`${cap.nrms.activeProperties} of ${cap.nrms.totalProperties} properties`)}</td>
          </tr>
          <tr>
            <td>Payment collection</td>
            <td>${escapeHtml(cap.payments.active ? "Active" : cap.payments.stage ? `In setup: ${pretty(cap.payments.stage)}` : "No payment method")}</td>
            <td>${escapeHtml(cap.payments.active ? (cap.payments.activatedAt ? day(cap.payments.activatedAt) : "Date not recorded") : "-")}</td>
            <td>${escapeHtml([cap.payments.merchantName, cap.payments.providerName].filter(Boolean).join(" / ") || "No operating company recorded")}</td>
          </tr>`
        : empty(4, "Capability information was not available when this statement was produced.");

      const preparedBy = data.generatedBy.email
        ? `${data.generatedBy.name || "Administrator"} · ${data.generatedBy.email}`
        : (data.generatedBy.name || "NoLSAF Administration");

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(`${ownerFileSlug}-${reportRef}`)}</title>
  <style>
    ${adminReportPrintStyles("portrait")}
  </style>
</head>
<body>
  <div class="reportPage">
    <main class="reportDocument">
    ${buildAdminReportHeader({
      logoUrl,
      eyebrow: "NoLSAF owner account record",
      title: "Owner statement",
      description: `A complete record of ${ownerLabel} on the NoLSAF platform: properties, booking revenue, commission, payouts and every administrative action taken on the account.`,
      reportId: generatedAt.toISOString(),
      reportRef,
      barcodeDataUrl,
      from: day(data.coverage.from),
      to: day(data.coverage.to),
      generatedAt: stamp(generatedAt.toISOString()),
      preparedBy,
      classification: "Owner account and dispute handling",
    })}

    <div class="metricGrid">
      <div class="metricCard metricCardGood"><span class="metricLabel">Gross booking value</span><strong>TZS ${escapeHtml(amount(data.bookings.gross))}</strong><small>Across ${escapeHtml(String(data.bookings.paidCount))} paid invoice(s) of ${escapeHtml(String(data.bookings.invoiceCount))} recorded. This is turnover, not the owner's earnings.</small></div>
      <div class="metricCard"><span class="metricLabel">NoLSAF commission</span><strong>TZS ${escapeHtml(amount(data.bookings.commission))}</strong><small>Retained by NoLSAF from the gross booking value above.</small></div>
      <div class="metricCard"><span class="metricLabel">Owner net earnings</span><strong>TZS ${escapeHtml(amount(data.bookings.net))}</strong><small>Amount owed to the owner after commission on paid invoices.</small></div>
      <div class="metricCard${data.payouts.failedCount > 0 ? " metricCardWarn" : ""}"><span class="metricLabel">Paid out to owner</span><strong>TZS ${escapeHtml(amount(data.payouts.paidAmount))}</strong><small>${escapeHtml(String(data.payouts.paidCount))} of ${escapeHtml(String(data.payouts.count))} payout(s) delivered. ${escapeHtml(String(data.payouts.inFlightCount))} in progress, ${escapeHtml(String(data.payouts.failedCount))} failed, ${escapeHtml(String(data.payouts.securityHoldCount))} held for review, ${escapeHtml(String(data.payouts.recoveryCount))} in recovery.</small></div>
      <div class="metricCard"><span class="metricLabel">Properties on record</span><strong>${escapeHtml(String(data.properties.length))}</strong><small>All properties registered under this owner, whatever their approval status.</small></div>
      <div class="metricCard${data.owner.suspendedAt ? " metricCardWarn" : " metricCardGood"}"><span class="metricLabel">Account standing</span><strong>${escapeHtml(data.owner.suspendedAt ? "Suspended" : "Active")}</strong><small>${escapeHtml(data.owner.suspendedAt ? `Suspended on ${day(data.owner.suspendedAt)}.` : "No suspension recorded.")} KYC ${escapeHtml(kycLabel(data.owner.kycStatus, true))}. Joined ${escapeHtml(day(data.owner.createdAt))}.</small></div>
    </div>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">01</span><div><h2>Owner identity</h2><p>Who this statement concerns and how they are recorded on the platform.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Field</th><th>Recorded value</th><th>Field</th><th>Recorded value</th></tr></thead>
        <tbody>
          <tr><td>Name</td><td>${escapeHtml(data.owner.name?.trim() || "Name not set")}</td><td>Owner ID</td><td>${escapeHtml(String(data.owner.id))}</td></tr>
          <tr><td>Email</td><td>${escapeHtml(data.owner.email)}</td><td>Phone</td><td>${escapeHtml(data.owner.phone || "Not provided")}</td></tr>
          <tr><td>Joined</td><td>${escapeHtml(day(data.owner.createdAt))}</td><td>KYC status</td><td>${escapeHtml(kycLabel(data.owner.kycStatus))}</td></tr>
          <tr><td>Account status</td><td>${escapeHtml(data.owner.suspendedAt ? `Suspended on ${day(data.owner.suspendedAt)}` : "Active")}</td><td>Statement period</td><td>${escapeHtml(periodLabel)}</td></tr>
        </tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">02</span><div><h2>Platform capabilities</h2><p>What this owner has switched on, and since when.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Capability</th><th>State</th><th>Active since</th><th>Detail</th></tr></thead>
        <tbody>${capabilityRows}</tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">03</span><div><h2>Property register</h2><p>Every property registered under this owner.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>ID</th><th>Property</th><th>Type</th><th>Location</th><th>Status</th><th>NRMS since</th></tr></thead>
        <tbody>${propertyRows}</tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">04</span><div><h2>Booking invoice register</h2><p>Gross value, NoLSAF commission and owner net for each invoice in the period. Amounts in TZS.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead>
          <tr>
            <th>Invoice</th><th>Property</th><th>Issued</th><th>Status</th>
            <th style="text-align:right;">Gross</th><th style="text-align:right;">Commission</th><th style="text-align:right;">Owner net</th><th>Paid</th>
          </tr>
        </thead>
        <tbody>${invoiceRows}</tbody>
      </table></div>
      <div class="reportNote">Summary totals count invoices at status PAID only. Invoices at any other status appear in this register but are not treated as earned.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">05</span><div><h2>Payout register</h2><p>Money actually sent to this owner, with the references needed to trace a payment externally. Amounts in TZS.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead>
          <tr>
            <th>Invoice</th><th>Status</th><th style="text-align:right;">Amount</th><th>Destination account</th>
            <th>NoLSAF reference</th><th>Provider reference</th><th>Settled</th>
          </tr>
        </thead>
        <tbody>${payoutRows}</tbody>
      </table></div>
      <div class="reportNote">The NoLSAF reference is the identifier sent to the payment provider when the payout was submitted. Quote it when tracing a payment the owner states did not arrive. Destination account numbers are masked to their last four digits. A payout appears here when it was raised, settled or failed inside the statement period, or when it belongs to an invoice the period covers, so a payment settled against an older invoice is not lost.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">06</span><div><h2>NRMS billing</h2><p>What this owner has paid NoLSAF for the property management system.</p></div></div>
      ${nrmsPanel}
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">07</span><div><h2>Business partners</h2><p>The companies operating these properties and the agencies selling their rooms.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Relationship</th><th>Name</th><th>Status</th><th style="text-align:right;">Properties</th></tr></thead>
        <tbody>${partnerRows}</tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">08</span><div><h2>Administrative actions</h2><p>Every recorded action a NoLSAF administrator took on this account.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>When</th><th>Action</th><th>Administrator</th><th>Detail</th></tr></thead>
        <tbody>${actionRows}</tbody>
      </table></div>
      <div class="reportNote">This register prints up to ${escapeHtml(String(PRINT_ROW_LIMIT))} rows per section. Where a section is longer, the on-screen statement holds the complete list.</div>
    </section>

    ${buildAdminReportFooter({
      reportRef,
      qrDataUrl,
      purpose: "Scan the QR code to confirm the sealed figures on the public NoLSAF verification page.",
      signatureLabel: "Owner account authorization",
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
      {/* ── Page head, matching the admin report pages ── */}
      <header className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-neutral-200 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#073c35] text-white">
            <FileText className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NoLSAF owner account record</p>
            <h1 className="mb-0 mt-1 truncate text-xl font-bold tracking-tight text-neutral-950">
              Owner statement{data ? ` · ${ownerLabel}` : ""}
            </h1>
            <p className="mb-0 mt-1 text-xs text-neutral-500">
              {data ? periodLabel : "Properties, booking revenue, commission, payouts and account history."}
            </p>
          </div>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          <Link
            href={`/admin/owners/${ownerId}`}
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

      {/* ── Period ── */}
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
          {/* ── What the printed document will contain ── */}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric tone="good" label="Gross booking value" value={money(data.bookings.gross)} note={`${data.bookings.paidCount} paid of ${data.bookings.invoiceCount} invoices`} />
            <Metric label="NoLSAF commission" value={money(data.bookings.commission)} note="Retained by NoLSAF" />
            <Metric label="Owner net earnings" value={money(data.bookings.net)} note="Owed to the owner" />
            <Metric
              tone={data.payouts.failedCount > 0 || data.payouts.securityHoldCount > 0 || data.payouts.recoveryCount > 0 ? "warn" : undefined}
              label="Paid out to owner"
              value={money(data.payouts.paidAmount)}
              note={[
                `${data.payouts.paidCount} of ${data.payouts.count} delivered`,
                data.payouts.inFlightCount ? `${data.payouts.inFlightCount} in progress` : null,
                data.payouts.failedCount ? `${data.payouts.failedCount} failed` : null,
                data.payouts.securityHoldCount ? `${data.payouts.securityHoldCount} held for review` : null,
                data.payouts.recoveryCount ? `${data.payouts.recoveryCount} in recovery` : null,
              ].filter(Boolean).join(", ")}
            />
            <Metric
              label="NRMS collected"
              value={money(data.nrmsBilling?.collected ?? 0, data.nrmsBilling?.currency)}
              note={data.nrmsBilling && data.nrmsBilling.accountsCount > 0
                ? `${data.nrmsBilling.statementsCount} statements, ${money(data.nrmsBilling.outstanding, data.nrmsBilling.currency)} outstanding`
                : "No NRMS billing account"}
            />
            <Metric
              tone={data.owner.suspendedAt ? "bad" : "good"}
              label="Account standing"
              value={data.owner.suspendedAt ? "Suspended" : "Active"}
              note={`${data.owner.suspendedAt ? `Suspended on ${day(data.owner.suspendedAt)}` : "No suspension recorded"}. KYC ${kycLabel(data.owner.kycStatus, true)}, joined ${day(data.owner.createdAt)}`}
            />
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <Preview icon={<Building2 className="h-4 w-4" />} title="Property register" count={data.properties.length} empty="No properties on record.">
              {data.properties.slice(0, 6).map((p) => (
                <PreviewRow key={p.id} left={p.title} right={pretty(p.status)} />
              ))}
            </Preview>
            <Preview icon={<FileText className="h-4 w-4" />} title="Booking invoices" count={data.invoices.length} empty="No invoices in this period.">
              {data.invoices.slice(0, 6).map((inv) => (
                <PreviewRow key={inv.id} left={inv.invoiceNumber || `#${inv.id}`} sub={inv.propertyTitle || undefined} right={money(inv.total)} />
              ))}
            </Preview>
            <Preview icon={<Wallet className="h-4 w-4" />} title="Payouts" count={data.disbursements.length} empty="No payout raised against this owner.">
              {data.disbursements.slice(0, 6).map((d) => (
                <PreviewRow
                  key={d.id}
                  left={d.externalReferenceId}
                  sub={`${pretty(d.status)}${d.destination ? ` to ${d.destination.provider} ${d.destination.accountNumberMasked ?? ""}` : ""}`}
                  right={money(d.amount, d.currency)}
                  mono
                />
              ))}
            </Preview>
            <Preview icon={<Handshake className="h-4 w-4" />} title="Business partners" count={(data.partners?.merchantCount ?? 0) + (data.partners?.agentCount ?? 0)} empty="No partners linked.">
              {(data.partners?.merchants ?? []).slice(0, 3).map((m) => (
                <PreviewRow key={`m-${m.id}`} left={m.name ?? "Not named yet"} sub="Operating company" right={pretty(m.status)} />
              ))}
              {(data.partners?.agents ?? []).slice(0, 3).map((a) => (
                <PreviewRow key={`a-${a.id}`} left={a.name ?? "Not named yet"} sub="Travel agency" right={pretty(a.status)} />
              ))}
            </Preview>
            <Preview icon={<Radar className="h-4 w-4" />} title="Administrative actions" count={data.adminActions.length} empty="No administrative action recorded.">
              {data.adminActions.slice(0, 6).map((a) => (
                <PreviewRow key={a.id} left={pretty(a.action)} sub={a.adminName || "Unknown"} right={day(a.createdAt)} />
              ))}
            </Preview>
            <div className="min-w-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">About this statement</div>
              <p className="mt-2 text-xs leading-relaxed text-neutral-600">
                Printing seals the figures and stamps the document with your name, the time, and a reference of the form{" "}
                <span className="font-mono font-semibold text-neutral-800">{referencePattern}</span>. A fresh reference is minted
                for each printed copy, so a sealed document identifies one exact print rather than the report in general. The
                printed copy carries a scannable verification code so the owner can confirm it is genuine without logging in.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-neutral-600">
                Booking figures cover the selected period. NRMS billing is reported for the whole relationship, because
                statements close on their own cycle.
              </p>
            </div>
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
  const valueInk =
    tone === "good" ? "text-emerald-900" :
    tone === "warn" ? "text-amber-900" :
    tone === "bad" ? "text-red-900" :
    "text-neutral-950";
  return (
    <div className={`min-w-0 rounded-2xl p-4 shadow-sm ring-1 ${skin}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">{label}</div>
      <div className={`mt-1.5 break-words text-base font-bold sm:text-lg ${valueInk}`}>{value}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-neutral-500">{note}</div>
    </div>
  );
}

function Preview({
  icon, title, count, empty, children,
}: {
  icon: React.ReactNode; title: string; count: number; empty: string; children: React.ReactNode;
}) {
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

function PreviewRow({ left, sub, right, mono }: { left: string; sub?: string; right: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 [&+&]:shadow-[inset_0_1px_0_0_#f3f4f6]">
      <div className="min-w-0">
        <div className={`truncate text-xs font-semibold text-neutral-800 ${mono ? "font-mono" : ""}`}>{left}</div>
        {sub ? <div className="truncate text-[11px] text-neutral-500">{sub}</div> : null}
      </div>
      <div className="shrink-0 text-xs font-semibold tabular-nums text-neutral-700">{right}</div>
    </div>
  );
}
