"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Printer, Calendar, FileText, Map as MapIcon, Wallet, Radar, Activity, Star, LifeBuoy } from "lucide-react";
import AdminRecordGate from "@/components/admin/AdminRecordGate";
import { useAdminHref } from "@/lib/adminRecordRefs";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import { escapeHtml } from "@/utils/html";
import {
  adminReportPrintStyles,
  buildAdminReportFooter,
  buildAdminReportHeader,
  openAdminReportPrintWindow,
  renderAndPrintAdminReport,
  updateAdminReportPrintWindowStatus,
} from "@/lib/adminReportPrint";

const api = apiClient;
const DEFAULT_CURRENCY = "TZS";
/** Printed registers stay readable; the on-screen statement holds the full list. */
const PRINT_ROW_LIMIT = 80;

type Statement = {
  generatedAt: string;
  generatedBy: { id: number | null; name: string | null; email: string | null };
  period: { from: string | null; to: string | null };
  coverage: { from: string | null; to: string | null };
  operator: {
    id: number; userId: number; companyName: string | null; contactName: string | null;
    email: string | null; phone: string | null; status: string; storedLevel: string;
    areas: string[]; languages: string[]; specializations: string[]; yearsOfExperience: number | null;
    joinedAt: string | null; suspendedAt: string | null; suspensionReason: string | null; restoredAt: string | null;
    accountDisabled: boolean;
  };
  contract: {
    contractId: string; version: string; status: string; effectiveDate: string | null;
    nolsafSignedAt: string | null; agentSignedAt: string | null; agentSignerName: string | null;
  } | null;
  documents: { id: number; type: string; status: string; reason: string | null; uploadedAt: string | null; reviewedAt: string | null }[];
  tier: {
    live: string; stored: string; completedTours: number; noLSAFRevenue: number;
    overallRating: number | null; totalReviews: number;
    next: { level: string; requirements: { tours: number; revenue: number; rating: number; reviews: number }; met: { tours: boolean; revenue: boolean; rating: boolean; reviews: boolean } } | null;
  };
  packagesApproved: { profileApproved: boolean; underReview: boolean; approvedAt: string | null };
  packages: {
    key: string; name: string | null; destination: string | null; category: string | null;
    state: "LIVE" | "LIVE_WITH_CHANGES" | "NOT_APPROVED" | "PAUSED" | "REMOVED";
    currency: string; pricePerPerson: number; problems: string[]; removedAt: string | null;
  }[];
  sales: { bookingCount: number; paidCount: number; travellers: number; gross: number; commission: number; operatorNet: number; startedWithoutPayment: number };
  bookings: {
    id: number; bookingCode: string; title: string; destination: string | null; startDate: string | null; endDate: string | null;
    travellers: number; status: string; paymentStatus: string; payoutStatus: string; currency: string;
    gross: number; commission: number; operatorNet: number; paymentRef: string | null; paidAt: string | null;
    pickupValidated: boolean; travellerConfirmed: boolean; createdAt: string | null;
  }[];
  payouts: { count: number; advancePaid: number; advancePaidCount: number; balancePaid: number; balancePaidCount: number; inFlight: number; inFlightCount: number; rejectedCount: number };
  payoutRegister: { id: number; bookingCode: string | null; tranche: "ADVANCE" | "BALANCE"; status: string; provider: string | null; reference: string | null; currency: string; amount: number; raisedAt: string | null; updatedAt: string | null; reason: string | null }[];
  recovery: { outstanding: number; pendingCount: number; recovered: number; refundedToTravellers: number };
  recoveryRegister: { id: number; bookingCode: string | null; status: string; currency: string; amount: number; offsetApplied: number; outstanding: number; raisedAt: string | null }[];
  cases: { id: number; bookingCode: string | null; type: string; status: string; severity: string; title: string; resolution: string | null; resolutionAmount: number | null; openedAt: string | null; closedAt: string | null }[];
  behaviour: {
    bookings: number; paidBookings: number; tripsStarted: number; pickupValidated: number; pickupValidatedRate: number | null;
    completed: number; travellerConfirmed: number; autoCompleted: number; travellerConfirmedRate: number | null;
    cancelledAfterPayment: number; cancellationRate: number | null; cases: number; openCases: number; casesPer100Paid: number | null;
    payoutClaimsRejected: number; medianHoursToConfirm: number | null; medianHoursToFinish: number | null;
    reviews: number; averageRating: number | null;
  };
  reviews: { bookingCode: string | null; score: number; punctuality: number; customerCare: number; communication: number; comment: string | null; createdAt: string | null }[];
  adminActions: { id: string; action: string; details: any; createdAt: string | null; adminName: string | null }[];
};

/** The slice of GET /admin/agents/:id/behaviour the printed statement uses. */
type ActivityForPrint = {
  band: "CLEAN" | "WATCH" | "ACTION";
  restricted: boolean;
  engagement: { signIns: number; failedSignIns: number; devices: number; supportSessions: number };
  signals: { label: string; value: string; detail: string; threshold: string; severity: "CLEAN" | "WATCH" | "ACTION" }[];
  payoutDestinations: { accountName: string; provider: string; accountNumberMasked: string; isActive: boolean; isDefault: boolean; isVerified: boolean; addedAt: string; verifiedAt: string | null; changedAt: string | null }[];
  timeline: { at: string; category: string; label: string; detail: string | null; device: string | null; ip: string | null }[];
};

/** What a package's state means to a traveller. */
const PACKAGE_STATE_LABEL: Record<Statement["packages"][number]["state"], string> = {
  LIVE: "Live",
  LIVE_WITH_CHANGES: "Live, changes waiting",
  NOT_APPROVED: "Not approved yet",
  PAUSED: "Paused",
  REMOVED: "Removed",
};

function money(n: any, currency: string = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(n || 0));
}
function amount(n: any) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}
function day(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}
function stamp(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${day(iso)} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}
function pretty(code: string | null | undefined) {
  if (!code) return "-";
  return code.replace(/_/g, " ").toLowerCase().replace(/^\S/, (c) => c.toUpperCase());
}
function rate(value: number | null, suffix = "%") {
  return value === null ? "No data" : `${value}${suffix}`;
}
function hours(value: number | null) {
  if (value === null) return "No data";
  return value < 48 ? `${value} h` : `${Math.round((value / 24) * 10) / 10} days`;
}
function detailText(details: any): string {
  if (details === null || details === undefined) return "";
  if (typeof details === "string") return details;
  try { return JSON.stringify(details); } catch { return ""; }
}

// Reference: OP-<operator id>-<from YYMMDD>-<to YYMMDD>-<HHMM EAT>-<nonce>,
// the same construction as the owner statement (OS-...), so every NoLSAF
// statement reference reads the same way.
function referenceTimeKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}${part("minute")}`;
}
function referenceNonce(length = 4): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}
function referenceDateKey(iso: string | null | undefined, fallback: Date): string {
  const d = iso ? new Date(iso) : fallback;
  const parts = new Intl.DateTimeFormat("en-GB", { year: "2-digit", month: "2-digit", day: "2-digit", timeZone: "Africa/Dar_es_Salaam" }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}${part("month")}${part("day")}`;
}
function buildStatementReference(agentId: number, coverage: { from: string | null; to: string | null }, generatedAt: Date): string {
  return `OP-${String(agentId).padStart(4, "0")}-${referenceDateKey(coverage.from, generatedAt)}-${referenceDateKey(coverage.to, generatedAt)}-${referenceTimeKey(generatedAt)}-${referenceNonce()}`;
}

export default function OperatorStatementPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  return (
    <AdminRecordGate kind="agent" param={routeParams?.id} backHref="/admin/agents">
      {(agentId) => <OperatorStatement agentId={agentId} />}
    </AdminRecordGate>
  );
}

function OperatorStatement({ agentId }: { agentId: number }) {
  const recordHref = useAdminHref();
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const r = await api.get<Statement>(`/api/admin/agents/${agentId}/statement`, { params });
      setData(r.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not load this statement.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [agentId, from, to]);

  useEffect(() => { void load(); }, [load]);

  const periodLabel = useMemo(() => {
    if (!data) return "";
    const f = data.period.from ? day(data.period.from) : null;
    const t = data.period.to ? day(data.period.to) : null;
    if (!f && !t) return "All activity to date";
    if (f && t) return `${f} to ${t}`;
    return f ? `From ${f}` : `Up to ${t}`;
  }, [data]);

  const operatorLabel = data?.operator.companyName || data?.operator.contactName || data?.operator.email || `Operator #${agentId}`;
  const referencePattern = useMemo(() => {
    if (!data) return "OP-....-......-......-....-....";
    const now = new Date();
    return `OP-${String(agentId).padStart(4, "0")}-${referenceDateKey(data.coverage.from, now)}-${referenceDateKey(data.coverage.to, now)}-HHMM-XXXX`;
  }, [data, agentId]);

  async function printStatement() {
    if (!data) return;
    const printWindow = openAdminReportPrintWindow();
    if (!printWindow) {
      setError("Unable to open the report preview. Please allow popups and try again.");
      return;
    }
    setPrinting(true);
    try {
      const b = data.behaviour;
      const generatedAt = new Date();
      let reportRef = buildStatementReference(agentId, data.coverage, generatedAt);
      let qrDataUrl: string | null = null;
      try {
        updateAdminReportPrintWindowStatus(printWindow, "seal");
        const sealRes = await fetch("/api/reports/seal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            kind: "OPERATOR_STATEMENT",
            title: `Tour operator statement - ${operatorLabel}`,
            ref: reportRef,
            from: day(data.coverage.from),
            to: day(data.coverage.to),
            figures: [
              { label: "Operator", value: operatorLabel },
              { label: "Operator ID", value: String(data.operator.id) },
              { label: "Tier", value: data.tier.live },
              { label: "Gross tour sales (TZS)", value: amount(data.sales.gross) },
              { label: "NoLSAF commission (TZS)", value: amount(data.sales.commission) },
              { label: "Operator net (TZS)", value: amount(data.sales.operatorNet) },
              { label: "Advances paid (TZS)", value: amount(data.payouts.advancePaid) },
              { label: "Balances paid (TZS)", value: amount(data.payouts.balancePaid) },
              { label: "Recovery outstanding (TZS)", value: amount(data.recovery.outstanding) },
              { label: "Bookings in period", value: String(data.sales.bookingCount) },
              { label: "Pickup checked", value: rate(b.pickupValidatedRate) },
              { label: "Traveller-confirmed completions", value: rate(b.travellerConfirmedRate) },
              { label: "Cancellation rate after payment", value: rate(b.cancellationRate) },
              { label: "Cases in period", value: String(b.cases) },
              { label: "Average rating in period", value: b.averageRating === null ? "No reviews" : String(b.averageRating) },
            ],
          }),
        });
        const sealJson: any = await sealRes.json().catch(() => null);
        if (sealJson?.token) {
          updateAdminReportPrintWindowStatus(printWindow, "verify");
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

      const fileSlug = operatorLabel.replace(/[^a-z0-9]+/gi, "").slice(0, 40) || `Operator${agentId}`;
      updateAdminReportPrintWindowStatus(printWindow, "preview");
      const logoUrl = new URL("/assets/NoLS2025-04.png", window.location.origin).toString();

      let barcodeDataUrl: string | null = null;
      try {
        const mod: any = await import("jsbarcode");
        const JsBarcode: any = mod?.default ?? mod;
        const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        JsBarcode(svgNode, reportRef, { format: "CODE128", displayValue: false, margin: 0, width: 1.1, height: 30, background: "#ffffff", lineColor: "#0b1220" });
        barcodeDataUrl = `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svgNode))))}`;
      } catch {
        barcodeDataUrl = null;
      }

      const e = (v: unknown) => escapeHtml(String(v ?? ""));
      const empty = (cols: number, text: string) => `<tr><td colspan="${cols}" class="emptyState">${e(text)}</td></tr>`;
      const op = data.operator;

      // Account behaviour over the same window: signals, payout destination
      // history and the security trail. A failure here prints a note, not nothing.
      let activity: ActivityForPrint | null = null;
      try {
        const params: Record<string, string> = {};
        if (data.coverage.from) params.from = data.coverage.from.slice(0, 10);
        if (data.coverage.to) params.to = data.coverage.to.slice(0, 10);
        activity = (await api.get<ActivityForPrint>(`/api/admin/agents/${agentId}/behaviour`, { params })).data;
      } catch {
        activity = null;
      }
      const securityEvents = (activity?.timeline ?? []).filter((ev) => ["SIGN_IN", "SECURITY", "PAYOUT_DETAILS"].includes(ev.category));
      const bandLabel = activity ? ({ CLEAN: "Clean", WATCH: "Watch", ACTION: "Action needed" } as const)[activity.band] : "Not available";
      const signalRows = activity?.signals.length
        ? activity.signals.map((s) => `<tr><td>${e(s.label)}</td><td>${e(s.value)}</td><td>${e(s.severity === "ACTION" ? "Action" : s.severity === "WATCH" ? "Watch" : "Clean")}</td><td class="muted">${e(s.detail)}<br />${e(s.threshold)}</td></tr>`).join("")
        : empty(4, "Account behaviour could not be loaded when this statement was printed.");
      const destinationRows = activity?.payoutDestinations.length
        ? activity.payoutDestinations.map((d) => `<tr><td>${e(d.accountName)}<br /><span class="muted">${e(`${d.provider} ${d.accountNumberMasked}`)}</span></td><td>${e(d.isActive ? (d.isDefault ? "Active, default" : "Active") : "Switched off")}${d.isVerified ? "" : `<br /><span class="muted">Not name-verified</span>`}</td><td>${e(stamp(d.addedAt))}</td><td>${e(d.verifiedAt ? stamp(d.verifiedAt) : "-")}</td><td>${e(d.changedAt ? stamp(d.changedAt) : "Never changed")}</td></tr>`).join("")
        : empty(5, "No payout destination has been added.");
      const securityRows = securityEvents.length
        ? securityEvents.slice(0, PRINT_ROW_LIMIT).map((ev) => `<tr><td>${e(stamp(ev.at))}</td><td>${e(ev.label)}${ev.detail ? `<br /><span class="muted">${e(ev.detail.slice(0, 140))}</span>` : ""}</td><td>${e(ev.device || "-")}</td><td>${e(ev.ip || "-")}</td></tr>`).join("")
        : empty(4, "No sign-in, security or payout detail event was recorded in this period.");

      const documentRows = data.documents.length
        ? data.documents.slice(0, PRINT_ROW_LIMIT).map((d) => `
            <tr><td>${e(pretty(d.type))}</td><td>${e(pretty(d.status))}</td><td>${e(day(d.uploadedAt))}</td><td class="muted">${e(d.reason || "-")}</td></tr>`).join("")
        : empty(4, "No document has been uploaded by this operator.");

      const next = data.tier.next;
      const tierRows = `
        <tr><td>Current tier</td><td>${e(data.tier.live)}${data.tier.stored !== data.tier.live ? `<br /><span class="muted">Stored on the record as ${e(data.tier.stored)}</span>` : ""}</td><td>Completed tours (lifetime)</td><td>${e(data.tier.completedTours)}</td></tr>
        <tr><td>NoLSAF revenue (lifetime, TZS)</td><td>${e(amount(data.tier.noLSAFRevenue))}</td><td>Rating (lifetime)</td><td>${e(data.tier.overallRating === null ? "No reviews" : `${data.tier.overallRating} from ${data.tier.totalReviews} review(s)`)}</td></tr>
        <tr><td>Next tier</td><td colspan="3">${next
          ? e(`${next.level}: needs ${next.requirements.tours} tours (${next.met.tours ? "met" : "not met"}), TZS ${amount(next.requirements.revenue)} revenue (${next.met.revenue ? "met" : "not met"}), rating ${next.requirements.rating} (${next.met.rating ? "met" : "not met"}), ${next.requirements.reviews} reviews (${next.met.reviews ? "met" : "not met"}).`)
          : "Highest tier reached."}</td></tr>`;

      const packageRows = data.packages.length
        ? data.packages.slice(0, PRINT_ROW_LIMIT).map((p) => `
            <tr><td>${e(p.name || "Untitled package")}${p.problems.length ? `<br /><span class="muted">${e(p.problems.join(", "))}</span>` : ""}</td><td>${e(p.destination || "-")}</td><td>${e(pretty(p.category))}</td><td>${e(PACKAGE_STATE_LABEL[p.state])}${p.removedAt ? `<br /><span class="muted">${e(day(p.removedAt))}</span>` : ""}</td><td class="num">${e(p.pricePerPerson ? `${p.currency} ${amount(p.pricePerPerson)}` : "No price")}</td></tr>`).join("")
        : empty(6, "This operator has no tour package on record.");

      const bookingRows = data.bookings.length
        ? data.bookings.slice(0, PRINT_ROW_LIMIT).map((bk) => `
            <tr>
              <td>${e(bk.bookingCode)}<br /><span class="muted">${e(bk.title)}</span></td>
              <td>${e(day(bk.startDate))}${bk.endDate ? `<br /><span class="muted">to ${e(day(bk.endDate))}</span>` : ""}</td>
              <td class="num">${e(bk.travellers)}</td>
              <td>${e(pretty(bk.status))}<br /><span class="muted">${e(bk.pickupValidated ? "Pickup checked" : "Pickup not checked")}${bk.status === "COMPLETED" ? ` · ${bk.travellerConfirmed ? "Traveller confirmed" : "Completed by time"}` : ""}</span></td>
              <td class="num">${e(amount(bk.gross))}</td>
              <td class="num">${e(amount(bk.commission))}</td>
              <td class="num">${e(amount(bk.operatorNet))}</td>
              <td>${e(pretty(bk.payoutStatus))}</td>
            </tr>`).join("")
        : empty(8, "No tour booking was made in this period.");

      const payoutRows = data.payoutRegister.length
        ? data.payoutRegister.slice(0, PRINT_ROW_LIMIT).map((p) => `
            <tr>
              <td>${e(p.bookingCode || "-")}</td>
              <td>${e(p.tranche === "ADVANCE" ? "Advance" : "Balance")}</td>
              <td>${e(pretty(p.status))}${p.reason ? `<br /><span class="muted">${e(p.reason.slice(0, 120))}</span>` : ""}</td>
              <td class="num">${e(p.currency)} ${e(amount(p.amount))}</td>
              <td>${e(p.reference || "-")}${p.provider ? `<br /><span class="muted">${e(p.provider)}</span>` : ""}</td>
              <td>${e(day(p.raisedAt))}</td>
            </tr>`).join("")
        : empty(6, "No payout has been claimed by this operator in this period.");

      const recoveryRows = data.recoveryRegister.length
        ? data.recoveryRegister.slice(0, PRINT_ROW_LIMIT).map((r) => `
            <tr><td>${e(r.bookingCode || "-")}</td><td>${e(pretty(r.status))}</td><td class="num">${e(r.currency)} ${e(amount(r.amount))}</td><td class="num">${e(amount(r.offsetApplied))}</td><td class="num">${e(amount(r.outstanding))}</td><td>${e(day(r.raisedAt))}</td></tr>`).join("")
        : empty(6, "This operator has never owed NoLSAF a recovery.");

      const caseRows = data.cases.length
        ? data.cases.slice(0, PRINT_ROW_LIMIT).map((c) => `
            <tr>
              <td>${e(c.bookingCode || "-")}</td>
              <td>${e(pretty(c.type))}<br /><span class="muted">${e(c.title)}</span></td>
              <td>${e(pretty(c.severity))}</td>
              <td>${e(pretty(c.status))}</td>
              <td>${e(day(c.openedAt))}${c.closedAt ? `<br /><span class="muted">Closed ${e(day(c.closedAt))}</span>` : ""}</td>
              <td class="muted">${e((c.resolution || "-").slice(0, 140))}${c.resolutionAmount !== null ? `<br />TZS ${e(amount(c.resolutionAmount))}` : ""}</td>
            </tr>`).join("")
        : empty(6, "No case was raised on this operator's bookings in this period.");

      const behaviourRows = `
        <tr><td>Pickup checked with the traveller's code</td><td>${e(rate(b.pickupValidatedRate))}</td><td class="muted">${e(`${b.pickupValidated} of ${b.tripsStarted} trip(s) that started.`)}</td></tr>
        <tr><td>Completion confirmed by the traveller</td><td>${e(rate(b.travellerConfirmedRate))}</td><td class="muted">${e(`${b.travellerConfirmed} confirmed, ${b.autoCompleted} completed automatically after the quiet period.`)}</td></tr>
        <tr><td>Cancelled after payment</td><td>${e(rate(b.cancellationRate))}</td><td class="muted">${e(`${b.cancelledAfterPayment} of ${b.paidBookings} paid booking(s).`)}</td></tr>
        <tr><td>Cases per 100 paid bookings</td><td>${e(b.casesPer100Paid === null ? "No data" : String(b.casesPer100Paid))}</td><td class="muted">${e(`${b.cases} case(s), ${b.openCases} still open.`)}</td></tr>
        <tr><td>Payout claims rejected</td><td>${e(b.payoutClaimsRejected)}</td><td class="muted">Claims NoLSAF refused in this period.</td></tr>
        <tr><td>Time to confirm a paid booking</td><td>${e(hours(b.medianHoursToConfirm))}</td><td class="muted">Median, from payment to the operator confirming.</td></tr>
        <tr><td>Time to mark a trip finished</td><td>${e(hours(b.medianHoursToFinish))}</td><td class="muted">Median, from the trip's last day.</td></tr>
        <tr><td>Traveller rating</td><td>${e(b.averageRating === null ? "No reviews" : `${b.averageRating} / 5`)}</td><td class="muted">${e(`${b.reviews} review(s) in this period. Average of punctuality, care and communication.`)}</td></tr>`;

      const reviewRows = data.reviews.length
        ? data.reviews.slice(0, PRINT_ROW_LIMIT).map((r) => `
            <tr><td>${e(day(r.createdAt))}</td><td>${e(r.bookingCode || "-")}</td><td class="num">${e(r.score)}</td><td class="muted">${e(`P ${r.punctuality} · C ${r.customerCare} · Com ${r.communication}`)}</td><td class="muted">${e((r.comment || "-").slice(0, 160))}</td></tr>`).join("")
        : empty(5, "No traveller review was left in this period.");

      const actionRows = data.adminActions.length
        ? data.adminActions.slice(0, PRINT_ROW_LIMIT).map((a) => `
            <tr><td>${e(stamp(a.createdAt))}</td><td>${e(pretty(a.action))}</td><td>${e(a.adminName || "Unknown")}</td><td class="muted">${e(detailText(a.details).slice(0, 180) || "-")}</td></tr>`).join("")
        : empty(4, "No administrative action was recorded against this operator in this period.");

      const contract = data.contract;
      const preparedBy = data.generatedBy.email
        ? `${data.generatedBy.name || "Administrator"} · ${data.generatedBy.email}`
        : (data.generatedBy.name || "NoLSAF Administration");
      const standing = op.accountDisabled ? "Disabled" : op.suspendedAt && op.status === "SUSPENDED" ? "Suspended" : pretty(op.status);

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${e(`${fileSlug}-${reportRef}`)}</title>
  <style>${adminReportPrintStyles("portrait")}</style>
</head>
<body>
  <div class="reportPage">
    <main class="reportDocument">
    ${buildAdminReportHeader({
      logoUrl,
      eyebrow: "NoLSAF tour operator record",
      title: "Tour operator statement",
      description: `A complete record of ${operatorLabel} on NoLSAF: agreement, tier, packages, tour sales, payouts, recoveries, cases, delivery behaviour and every administrative action.`,
      reportId: generatedAt.toISOString(),
      reportRef,
      barcodeDataUrl,
      from: day(data.coverage.from),
      to: day(data.coverage.to),
      generatedAt: stamp(generatedAt.toISOString()),
      preparedBy,
      classification: "Operator account, tier review and dispute handling",
    })}

    <div class="metricGrid">
      <div class="metricCard metricCardGood"><span class="metricLabel">Gross tour sales</span><strong>TZS ${e(amount(data.sales.gross))}</strong><small>${e(`${data.sales.paidCount} paid of ${data.sales.bookingCount} booking(s), ${data.sales.travellers} traveller(s).`)}</small></div>
      <div class="metricCard"><span class="metricLabel">NoLSAF commission</span><strong>TZS ${e(amount(data.sales.commission))}</strong><small>Retained by NoLSAF from paid bookings.</small></div>
      <div class="metricCard"><span class="metricLabel">Operator net</span><strong>TZS ${e(amount(data.sales.operatorNet))}</strong><small>Owed to the operator on paid bookings, before advances.</small></div>
      <div class="metricCard"><span class="metricLabel">Paid to operator</span><strong>TZS ${e(amount(data.payouts.advancePaid + data.payouts.balancePaid))}</strong><small>${e(`Advances TZS ${amount(data.payouts.advancePaid)}, balances TZS ${amount(data.payouts.balancePaid)}. ${data.payouts.inFlightCount} claim(s) in progress, ${data.payouts.rejectedCount} rejected.`)}</small></div>
      <div class="metricCard${data.recovery.outstanding > 0 ? " metricCardWarn" : ""}"><span class="metricLabel">Owed to NoLSAF</span><strong>TZS ${e(amount(data.recovery.outstanding))}</strong><small>${e(`${data.recovery.pendingCount} open recovery(ies). Lifetime, not limited to the period.`)}</small></div>
      <div class="metricCard${op.status === "ACTIVE" && !op.accountDisabled ? " metricCardGood" : " metricCardWarn"}"><span class="metricLabel">Standing</span><strong>${e(standing)} · ${e(data.tier.live)}</strong><small>${e(op.suspendedAt ? `Suspended ${day(op.suspendedAt)}${op.restoredAt ? `, restored ${day(op.restoredAt)}` : ""}.` : "No suspension recorded.")} Joined ${e(day(op.joinedAt))}.</small></div>
    </div>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">01</span><div><h2>Operator identity</h2><p>Who this statement concerns and how they are recorded on NoLSAF.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Field</th><th>Recorded value</th><th>Field</th><th>Recorded value</th></tr></thead>
        <tbody>
          <tr><td>Company</td><td>${e(op.companyName || "Not set")}</td><td>Operator ID</td><td>${e(op.id)}</td></tr>
          <tr><td>Contact</td><td>${e(op.contactName || "Not set")}</td><td>Email</td><td>${e(op.email || "Not provided")}</td></tr>
          <tr><td>Phone</td><td>${e(op.phone || "Not provided")}</td><td>Experience</td><td>${e(op.yearsOfExperience !== null ? `${op.yearsOfExperience} year(s)` : "Not stated")}</td></tr>
          <tr><td>Areas</td><td>${e(op.areas.join(", ") || "-")}</td><td>Languages</td><td>${e(op.languages.join(", ") || "-")}</td></tr>
          <tr><td>Status</td><td>${e(standing)}${op.suspensionReason ? `<br /><span class="muted">${e(op.suspensionReason.slice(0, 160))}</span>` : ""}</td><td>Statement period</td><td>${e(periodLabel)}</td></tr>
        </tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">02</span><div><h2>Agreement and documents</h2><p>The partnership agreement and the documents NoLSAF reviewed.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Agreement</th><th>Status</th><th>NoLSAF signed</th><th>Operator signed</th></tr></thead>
        <tbody>${contract
          ? `<tr><td>${e(contract.contractId)}<br /><span class="muted">Version ${e(contract.version)}, effective ${e(day(contract.effectiveDate))}</span></td><td>${e(pretty(contract.status))}</td><td>${e(day(contract.nolsafSignedAt))}</td><td>${e(day(contract.agentSignedAt))}${contract.agentSignerName ? `<br /><span class="muted">${e(contract.agentSignerName)}</span>` : ""}</td></tr>`
          : empty(4, "No partnership agreement is on record.")}</tbody>
      </table></div>
      <div class="tableWrap" style="margin-top:8px"><table class="details">
        <thead><tr><th>Document</th><th>Status</th><th>Uploaded</th><th>Note</th></tr></thead>
        <tbody>${documentRows}</tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">03</span><div><h2>Tier and standing</h2><p>The operator's level, computed live from tours, NoLSAF revenue and traveller ratings.</p></div></div>
      <div class="tableWrap"><table><tbody>${tierRows}</tbody></table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">04</span><div><h2>Tour packages</h2><p>Every package, with the state travellers actually see. ${e(data.packagesApproved.profileApproved
        ? `Profile approved ${day(data.packagesApproved.approvedAt)}.${data.packagesApproved.underReview ? " New changes are under review; the approved version stays on sale meanwhile." : ""}`
        : "The profile is not approved, so no package is on sale.")}</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>Package</th><th>Destination</th><th>Category</th><th>On NoLSAF</th><th style="text-align:right;">Price per person</th></tr></thead>
        <tbody>${packageRows}</tbody>
      </table></div>
      <div class="reportNote">Live means travellers can book the approved version now. Live, changes waiting means the operator edited it since approval; travellers still see the approved version until the next review.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">05</span><div><h2>Tour booking register</h2><p>Gross value, NoLSAF commission and operator net for each booking made in the period. Amounts in TZS.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>Booking</th><th>Trip dates</th><th style="text-align:right;">Pax</th><th>Status</th><th style="text-align:right;">Gross</th><th style="text-align:right;">Commission</th><th style="text-align:right;">Operator net</th><th>Payout</th></tr></thead>
        <tbody>${bookingRows}</tbody>
      </table></div>
      <div class="reportNote">Summary totals count paid bookings only. Bookings at any other payment state appear here but are not treated as earned.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">06</span><div><h2>Payout register</h2><p>Advances before the trip and balances after it, with the references needed to trace each one.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>Booking</th><th>Part</th><th>Status</th><th style="text-align:right;">Amount</th><th>Reference</th><th>Claimed</th></tr></thead>
        <tbody>${payoutRows}</tbody>
      </table></div>
      <div class="reportNote">A payout appears here when it was claimed or updated inside the period, or when it belongs to a booking the period covers.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">07</span><div><h2>Cancellations, cases and recoveries</h2><p>What went wrong on this operator's trips, and money the operator owes NoLSAF after refunds.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>Booking</th><th>Case</th><th>Severity</th><th>Status</th><th>Opened</th><th>Resolution</th></tr></thead>
        <tbody>${caseRows}</tbody>
      </table></div>
      <div class="tableWrap" style="margin-top:8px"><table class="details">
        <thead><tr><th>Booking</th><th>Recovery</th><th style="text-align:right;">Amount</th><th style="text-align:right;">Deducted so far</th><th style="text-align:right;">Outstanding</th><th>Raised</th></tr></thead>
        <tbody>${recoveryRows}</tbody>
      </table></div>
      <div class="reportNote">Recoveries are listed for the whole relationship. They are settled from the operator's next balance payouts, oldest first. Refunded to travellers in the period: TZS ${e(amount(data.recovery.refundedToTravellers))}.</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">08</span><div><h2>Delivery behaviour</h2><p>Whether this operator delivers what they sell, from their own trip records in the period.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Signal</th><th>Result</th><th>Basis</th></tr></thead>
        <tbody>${behaviourRows}</tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">09</span><div><h2>Account security and payout details</h2><p>How the account was used and protected: overall band ${e(bandLabel)}${activity?.restricted ? " (operator restricted)" : ""}.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Signal</th><th>Value</th><th>Grade</th><th>Basis and threshold</th></tr></thead>
        <tbody>${signalRows}</tbody>
      </table></div>
      <div class="tableWrap" style="margin-top:8px"><table class="details">
        <thead><tr><th>Payout destination</th><th>Status</th><th>Added</th><th>Name verified</th><th>Last changed</th></tr></thead>
        <tbody>${destinationRows}</tbody>
      </table></div>
      <div class="tableWrap" style="margin-top:8px"><table class="details">
        <thead><tr><th>When</th><th>Event</th><th>Device</th><th>Network address</th></tr></thead>
        <tbody>${securityRows}</tbody>
      </table></div>
      <div class="reportNote">${e(activity ? `${activity.engagement.signIns} sign-in(s) and ${activity.engagement.failedSignIns} failed attempt(s) from ${activity.engagement.devices} device(s) in this period. ${activity.engagement.supportSessions} admin support session(s). Destination numbers are masked to their last four digits.` : "")}</div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">10</span><div><h2>Traveller reviews</h2><p>Ratings left by travellers in the period.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>Date</th><th>Booking</th><th style="text-align:right;">Score</th><th>Breakdown</th><th>Comment</th></tr></thead>
        <tbody>${reviewRows}</tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">11</span><div><h2>Administrative actions</h2><p>Every recorded action a NoLSAF administrator took on this operator, including support sessions.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>When</th><th>Action</th><th>Administrator</th><th>Detail</th></tr></thead>
        <tbody>${actionRows}</tbody>
      </table></div>
      <div class="reportNote">Each register prints up to ${e(PRINT_ROW_LIMIT)} rows. Where a section is longer, the on-screen statement holds the complete list.</div>
    </section>

    ${buildAdminReportFooter({
      reportRef,
      qrDataUrl,
      purpose: "Scan the QR code to confirm the sealed figures on the public NoLSAF verification page.",
      signatureLabel: "Operator account authorization",
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

  const b = data?.behaviour;
  const s = data?.sales;
  const paidOut = data ? data.payouts.advancePaid + data.payouts.balancePaid : 0;
  const suspended = data ? data.operator.status === "SUSPENDED" || data.operator.accountDisabled : false;

  /** Quick periods, in EAT calendar terms. Custom dates stay on the pickers. */
  const presets = useMemo(() => {
    const today = new Date();
    const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(d);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const quarterAgo = new Date(today.getTime() - 90 * 86_400_000);
    const yearStart = new Date(today.getFullYear(), 0, 1);
    return [
      { key: "all", label: "All time", from: "", to: "" },
      { key: "month", label: "This month", from: ymd(monthStart), to: "" },
      { key: "90", label: "Last 90 days", from: ymd(quarterAgo), to: "" },
      { key: "year", label: "This year", from: ymd(yearStart), to: "" },
    ];
  }, []);
  const activePreset = presets.find((p) => p.from === from && p.to === to)?.key ?? "custom";

  const [register, setRegister] = useState<"bookings" | "payouts" | "cases" | "recoveries" | "reviews" | "packages" | "admin">("bookings");
  const [registerPage, setRegisterPage] = useState(1);
  const REGISTER_PAGE_SIZE = 12;

  return (
    <div className="min-w-0 space-y-4">
      {/* Identity band, in the same language as the operator record */}
      <section className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_0%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
        <div className="relative flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <Link href={recordHref("agent", agentId)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/45 no-underline transition hover:text-emerald-300">
              <ArrowLeft className="h-3 w-3" aria-hidden /> Operator record
            </Link>
            <p className="m-0 mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/80">Tour operator statement</p>
            <h1 className="m-0 mt-1 break-words text-xl font-bold tracking-tight text-white sm:text-2xl">{data ? operatorLabel : "Loading statement"}</h1>
            {data ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-white/60">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white">{data.tier.live}</span>
                {suspended ? (
                  <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-300">Suspended</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden /> Active</span>
                )}
                <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden /> {day(data.coverage.from)} to {day(data.coverage.to)}</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void printStatement()}
            disabled={!data || printing}
            className="inline-flex h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-emerald-300 px-5 text-sm font-bold text-[#0b2420] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Printer className="h-4 w-4" aria-hidden />
            {printing ? "Preparing..." : "Print statement"}
          </button>
        </div>

        {/* Period: quick presets, then exact dates */}
        <div className="relative flex min-w-0 flex-wrap items-center gap-2 border-0 border-t border-solid border-white/10 px-4 py-3 sm:px-6">
          <div className="flex w-full gap-1 overflow-x-auto sm:w-auto" role="group" aria-label="Statement period">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => { setFrom(p.from); setTo(p.to); }}
                className={`h-8 shrink-0 cursor-pointer rounded-lg border-0 px-3 text-xs font-semibold transition ${activePreset === p.key ? "bg-white text-[#0b2420]" : "bg-white/[0.06] text-white/70 hover:bg-white/10 hover:text-white"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:ml-auto">
            <DateChip label={from ? day(from) : "Start of record"} active={activePreset === "custom" && Boolean(from)} open={fromOpen} onToggle={() => { setFromOpen((v) => !v); setToOpen(false); }}>
              <DatePicker selected={from || undefined} onSelectAction={(v) => setFrom(Array.isArray(v) ? (v[0] || "") : ((v as string) || ""))} onCloseAction={() => setFromOpen(false)} />
            </DateChip>
            <span className="text-xs text-white/40">to</span>
            <DateChip label={to ? day(to) : "Today"} active={activePreset === "custom" && Boolean(to)} open={toOpen} onToggle={() => { setToOpen((v) => !v); setFromOpen(false); }}>
              <DatePicker selected={to || undefined} onSelectAction={(v) => setTo(Array.isArray(v) ? (v[0] || "") : ((v as string) || ""))} onCloseAction={() => setToOpen(false)} />
            </DateChip>
          </div>
        </div>
      </section>

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-neutral-100" />)}</div>
      ) : error || !data || !b || !s ? (
        <div className="rounded-lg border border-solid border-neutral-200 bg-white p-10 text-center">
          <FileText className="mx-auto mb-3 h-10 w-10 text-neutral-300" aria-hidden />
          <p className="m-0 text-sm text-neutral-600">{error ?? "No statement available."}</p>
          <button type="button" onClick={() => void load()} className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Try again</button>
        </div>
      ) : (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {s.startedWithoutPayment > 0 ? (
            <div role="status" className="flex items-start gap-3 rounded-lg bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              <p className="m-0 text-sm text-amber-900">
                <strong>{s.startedWithoutPayment} trip{s.startedWithoutPayment === 1 ? "" : "s"} ran with no payment recorded.</strong>{" "}
                A real trip cannot start before payment, so these are test bookings or a payment recorded outside NoLSAF. They are not counted as sales.
              </p>
            </div>
          ) : null}

          {/* Money, joined cells */}
          <section aria-label="Money" className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Gross tour sales", value: money(s.gross), sub: `${s.paidCount} paid of ${s.bookingCount} bookings`, tone: "text-neutral-950" },
              { label: "NoLSAF commission", value: money(s.commission), sub: s.gross > 0 ? `${Math.round((s.commission / s.gross) * 1000) / 10}% of sales` : "Retained by NoLSAF", tone: "text-neutral-950" },
              { label: "Operator net", value: money(s.operatorNet), sub: `${s.travellers} traveller${s.travellers === 1 ? "" : "s"}`, tone: "text-emerald-700" },
              { label: "Paid to operator", value: money(paidOut), sub: `${money(data.payouts.advancePaid)} advances`, tone: "text-neutral-950" },
              { label: "Owed to NoLSAF", value: money(data.recovery.outstanding), sub: `${data.recovery.pendingCount} open recover${data.recovery.pendingCount === 1 ? "y" : "ies"}`, tone: data.recovery.outstanding > 0 ? "text-amber-600" : "text-neutral-400" },
              { label: "Traveller rating", value: b.averageRating === null ? "None yet" : `${b.averageRating} / 5`, sub: `${b.reviews} in period · ${data.tier.totalReviews} lifetime`, tone: b.averageRating !== null && b.averageRating < 3.8 ? "text-amber-600" : "text-neutral-950" },
            ].map((m) => (
              <div key={m.label} className="min-w-0 bg-white px-4 py-3">
                <p className="m-0 text-[11px] font-semibold text-neutral-500">{m.label}</p>
                <p className={`m-0 mt-1 break-words text-lg font-black tabular-nums tracking-tight ${m.tone}`}>{m.value}</p>
                <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400">{m.sub}</p>
              </div>
            ))}
          </section>

          {/* Delivery behaviour */}
          <section className="rounded-lg border border-solid border-neutral-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 inline-flex items-center gap-2 text-sm font-bold text-neutral-900"><Activity className="h-4 w-4 text-neutral-400" aria-hidden /> Delivery behaviour</h2>
              <span className="text-[11px] text-neutral-400">From this operator&apos;s own trips in the period</span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <RateCard label="Pickup checked" value={b.pickupValidatedRate} good="high" sub={`${b.pickupValidated} of ${b.tripsStarted} trips that started`} />
              <RateCard label="Traveller confirmed the trip" value={b.travellerConfirmedRate} good="high" sub={`${b.autoCompleted} completed by time instead`} />
              <RateCard label="Cancelled after payment" value={b.cancellationRate} good="low" sub={`${b.cancelledAfterPayment} of ${b.paidBookings} paid bookings`} />
              <StatCard label="Cases" value={String(b.cases)} sub={b.casesPer100Paid === null ? `${b.openCases} open` : `${b.casesPer100Paid} per 100 paid · ${b.openCases} open`} warn={b.openCases > 0} />
              <StatCard label="Time to confirm a booking" value={hours(b.medianHoursToConfirm)} sub="Median, from payment" />
              <StatCard label="Time to mark a trip finished" value={hours(b.medianHoursToFinish)} sub="Median, from the last day" />
              <StatCard label="Payout claims rejected" value={String(b.payoutClaimsRejected)} sub="In this period" warn={b.payoutClaimsRejected > 0} />
              <StatCard label="Tier" value={data.tier.live} sub={data.tier.next ? `Next: ${data.tier.next.level}` : "Top tier reached"} />
            </div>
          </section>

          {/* Registers */}
          <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
            <nav className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-neutral-100 px-2" aria-label="Statement registers">
              {([
                { key: "bookings", label: "Bookings", Icon: FileText, count: data.bookings.length },
                { key: "payouts", label: "Payouts", Icon: Wallet, count: data.payoutRegister.length },
                { key: "cases", label: "Cases", Icon: LifeBuoy, count: data.cases.length },
                { key: "recoveries", label: "Recoveries", Icon: AlertTriangle, count: data.recoveryRegister.length },
                { key: "reviews", label: "Reviews", Icon: Star, count: data.reviews.length },
                { key: "packages", label: "Packages", Icon: MapIcon, count: data.packages.length },
                { key: "admin", label: "Admin actions", Icon: Radar, count: data.adminActions.length },
              ] as const).map((t) => {
                const active = register === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => { setRegister(t.key); setRegisterPage(1); }}
                    className={`-mb-px inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-solid bg-transparent px-3 py-3 text-xs font-bold ${active ? "border-emerald-700 text-emerald-800" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
                  >
                    <t.Icon className="h-3.5 w-3.5" aria-hidden />
                    {t.label}
                    <span className="rounded-full bg-neutral-100 px-1.5 text-[10px] tabular-nums text-neutral-500">{t.count}</span>
                  </button>
                );
              })}
            </nav>

            {(() => {
              const tag = (label: string) => <span key={label} className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold ${chipTone(label)}`}>{label}</span>;
              const code = (value: string | null) => <span className="whitespace-nowrap font-mono text-[12px] font-semibold text-neutral-900">{value || "-"}</span>;
              const muted = (value: string | null | undefined) => <span className="text-neutral-500">{value || "-"}</span>;
              const two = (top: React.ReactNode, bottom: string | null | undefined) => (
                <div className="min-w-0">
                  <div>{top}</div>
                  {bottom ? <div className="mt-0.5 truncate text-[11px] text-neutral-400">{bottom}</div> : null}
                </div>
              );
              const amountCell = (value: string, sub?: string) => (
                <div className="whitespace-nowrap text-right">
                  <div className="font-semibold tabular-nums text-neutral-900">{value}</div>
                  {sub ? <div className="text-[11px] tabular-nums text-neutral-400">{sub}</div> : null}
                </div>
              );
              const range = (a: string | null, b: string | null) => (a ? `${day(a)}${b && b.slice(0, 10) !== a.slice(0, 10) ? ` to ${day(b)}` : ""}` : "-");

              const table: RegisterTable =
                register === "bookings" ? {
                  columns: [
                    { label: "Booking", width: "w-[24%]" }, { label: "Trip dates" }, { label: "Pax", align: "right" },
                    { label: "Status" }, { label: "Gross", align: "right" }, { label: "Operator net", align: "right" }, { label: "Payout" },
                  ],
                  rows: data.bookings.map((bk) => ({
                    key: `b${bk.id}`,
                    cells: [
                      two(code(bk.bookingCode), bk.title),
                      <span key="d" className="whitespace-nowrap text-neutral-700">{range(bk.startDate, bk.endDate)}</span>,
                      <span key="p" className="tabular-nums text-neutral-700">{bk.travellers}</span>,
                      <div key="s" className="flex flex-wrap gap-1">{[pretty(bk.status), bk.pickupValidated ? "Pickup checked" : "", bk.status === "COMPLETED" ? (bk.travellerConfirmed ? "Traveller confirmed" : "Completed by time") : ""].filter(Boolean).map(tag)}</div>,
                      amountCell(money(bk.gross, bk.currency)),
                      amountCell(money(bk.operatorNet, bk.currency), `Commission ${money(bk.commission, bk.currency)}`),
                      tag(pretty(bk.payoutStatus)),
                    ],
                  })),
                } :
                register === "payouts" ? {
                  columns: [{ label: "Booking" }, { label: "Part" }, { label: "Status" }, { label: "Amount", align: "right" }, { label: "Reference" }, { label: "Claimed" }],
                  rows: data.payoutRegister.map((p) => ({
                    key: `p${p.id}`,
                    cells: [
                      code(p.bookingCode),
                      <span key="t" className="text-neutral-700">{p.tranche === "ADVANCE" ? "Advance" : "Balance"}</span>,
                      two(tag(pretty(p.status)), p.reason),
                      amountCell(money(p.amount, p.currency)),
                      two(<span className="break-all font-mono text-[11px] text-neutral-700">{p.reference || "-"}</span>, p.provider),
                      <span key="c" className="whitespace-nowrap text-neutral-700">{day(p.raisedAt)}</span>,
                    ],
                  })),
                } :
                register === "cases" ? {
                  columns: [{ label: "Booking" }, { label: "Case", width: "w-[30%]" }, { label: "Severity" }, { label: "Status" }, { label: "Opened" }, { label: "Closed" }, { label: "Resolution", align: "right" }],
                  rows: data.cases.map((c) => ({
                    key: `c${c.id}`,
                    cells: [
                      code(c.bookingCode),
                      two(<span className="font-semibold text-neutral-900">{c.title}</span>, [pretty(c.type), c.resolution].filter((x) => x && x !== "-").join(" · ")),
                      tag(pretty(c.severity)),
                      tag(pretty(c.status)),
                      <span key="o" className="whitespace-nowrap text-neutral-700">{day(c.openedAt)}</span>,
                      <span key="x" className="whitespace-nowrap text-neutral-700">{c.closedAt ? day(c.closedAt) : "Open"}</span>,
                      c.resolutionAmount !== null ? amountCell(money(c.resolutionAmount)) : muted(null),
                    ],
                  })),
                } :
                register === "recoveries" ? {
                  columns: [{ label: "Booking" }, { label: "Status" }, { label: "Amount", align: "right" }, { label: "Deducted", align: "right" }, { label: "Outstanding", align: "right" }, { label: "Raised" }],
                  rows: data.recoveryRegister.map((r) => ({
                    key: `r${r.id}`,
                    cells: [
                      code(r.bookingCode), tag(pretty(r.status)),
                      amountCell(money(r.amount, r.currency)), amountCell(money(r.offsetApplied, r.currency)), amountCell(money(r.outstanding, r.currency)),
                      <span key="d" className="whitespace-nowrap text-neutral-700">{day(r.raisedAt)}</span>,
                    ],
                  })),
                } :
                register === "reviews" ? {
                  columns: [{ label: "Date" }, { label: "Booking" }, { label: "Score", align: "right" }, { label: "Punctuality", align: "right" }, { label: "Care", align: "right" }, { label: "Communication", align: "right" }, { label: "Comment", width: "w-[32%]" }],
                  rows: data.reviews.map((r, i) => ({
                    key: `v${i}`,
                    cells: [
                      <span key="d" className="whitespace-nowrap text-neutral-700">{day(r.createdAt)}</span>, code(r.bookingCode),
                      <span key="s" className="font-semibold tabular-nums text-neutral-900">{r.score}</span>,
                      <span key="p" className="tabular-nums">{r.punctuality}</span>, <span key="c" className="tabular-nums">{r.customerCare}</span>, <span key="m" className="tabular-nums">{r.communication}</span>,
                      <span key="t" className="text-neutral-600">{r.comment || "-"}</span>,
                    ],
                  })),
                } :
                register === "packages" ? {
                  columns: [{ label: "Package", width: "w-[30%]" }, { label: "Destination" }, { label: "Category" }, { label: "On NoLSAF" }, { label: "Price per person", align: "right" }, { label: "Needs fixing" }],
                  rows: data.packages.map((p) => ({
                    key: `k${p.key}`,
                    cells: [
                      <span key="n" className={`font-semibold ${p.name ? "text-neutral-900" : "italic text-neutral-400"}`}>{p.name || "Untitled package"}</span>,
                      muted(p.destination), muted(pretty(p.category)),
                      two(tag(PACKAGE_STATE_LABEL[p.state]), p.removedAt ? `Removed ${day(p.removedAt)}` : null),
                      p.pricePerPerson ? amountCell(money(p.pricePerPerson, p.currency)) : <span key="np" className="whitespace-nowrap text-amber-700">No price</span>,
                      p.problems.length
                        ? <div key="pr" className="flex flex-wrap gap-1">{p.problems.map((x) => <span key={x} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">{x}</span>)}</div>
                        : <span key="ok" className="text-neutral-300">-</span>,
                    ],
                  })),
                } : {
                  columns: [{ label: "When" }, { label: "Action" }, { label: "Administrator" }, { label: "Detail", width: "w-[40%]" }],
                  rows: data.adminActions.map((a) => ({
                    key: a.id,
                    cells: [
                      <span key="w" className="whitespace-nowrap text-neutral-700">{stamp(a.createdAt)}</span>,
                      <span key="a" className="font-semibold text-neutral-900">{pretty(a.action)}</span>,
                      muted(a.adminName || "Unknown"),
                      <span key="t" className="break-words text-[12px] text-neutral-500">{detailText(a.details).slice(0, 200) || "-"}</span>,
                    ],
                  })),
                };

              if (!table.rows.length) {
                return <p className="m-0 px-5 py-10 text-center text-sm text-neutral-500">Nothing recorded here for this period.</p>;
              }
              const pageCount = Math.max(1, Math.ceil(table.rows.length / REGISTER_PAGE_SIZE));
              const pageNow = Math.min(registerPage, pageCount);
              const firstRow = (pageNow - 1) * REGISTER_PAGE_SIZE;
              const shown = table.rows.slice(firstRow, firstRow + REGISTER_PAGE_SIZE);
              // 1 … 4 5 6 … 14: first, last, and the pages either side of this one.
              const pageItems: Array<number | "gap"> = [];
              for (let n = 1; n <= pageCount; n++) {
                if (n === 1 || n === pageCount || Math.abs(n - pageNow) <= 1) pageItems.push(n);
                else if (pageItems[pageItems.length - 1] !== "gap") pageItems.push("gap");
              }
              return (
                <>
                  {/* Desktop and tablet: one row per record, aligned columns */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[760px] border-collapse text-[13px]">
                      <thead>
                        <tr className="bg-neutral-50">
                          {table.columns.map((col) => (
                            <th key={col.label} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-4 py-2.5 text-[11px] font-semibold text-neutral-500 ${col.align === "right" ? "text-right" : "text-left"} ${col.width ?? ""}`}>{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((row) => (
                          <tr key={row.key} className="border-0 border-b border-solid border-neutral-100 last:border-b-0 hover:bg-neutral-50/70">
                            {row.cells.map((cell, i) => (
                              <td key={i} className={`px-4 py-3 align-top ${table.columns[i]?.align === "right" ? "text-right" : "text-left"}`}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Phones: the same columns as labelled pairs */}
                  <ul className="m-0 list-none p-0 md:hidden">
                    {shown.map((row) => (
                      <li key={row.key} className="border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0">
                        <div className="text-sm">{row.cells[0]}</div>
                        <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                          {row.cells.slice(1).map((cell, i) => (
                            <div key={i} className="min-w-0">
                              <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400">{table.columns[i + 1]?.label}</dt>
                              <dd className="m-0 mt-0.5 min-w-0 text-[12px] [&_.text-right]:text-left">{cell}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>

                  <nav aria-label="Register pages" className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-2.5 sm:px-5">
                    <p className="m-0 text-xs text-neutral-500">
                      Showing <strong className="tabular-nums text-neutral-900">{firstRow + 1}-{firstRow + shown.length}</strong> of{" "}
                      <strong className="tabular-nums text-neutral-900">{table.rows.length}</strong>
                    </p>
                    {pageCount > 1 ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Previous page"
                          disabled={pageNow === 1}
                          onClick={() => setRegisterPage(pageNow - 1)}
                          className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden />
                        </button>
                        {pageItems.map((item, index) =>
                          item === "gap" ? (
                            <span key={`gap-${index}`} className="px-1 text-xs text-neutral-400" aria-hidden>…</span>
                          ) : (
                            <button
                              key={item}
                              type="button"
                              onClick={() => setRegisterPage(item)}
                              aria-current={item === pageNow ? "page" : undefined}
                              className={`h-8 min-w-8 cursor-pointer rounded-md border border-solid px-2 text-xs font-bold tabular-nums ${item === pageNow ? "border-[#02665e] bg-[#02665e] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}
                            >
                              {item}
                            </button>
                          ),
                        )}
                        <button
                          type="button"
                          aria-label="Next page"
                          disabled={pageNow === pageCount}
                          onClick={() => setRegisterPage(pageNow + 1)}
                          className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    ) : null}
                  </nav>
                </>
              );
            })()}
          </section>

          <p className="m-0 px-1 text-[11px] leading-relaxed text-neutral-500">
            Printing seals the figures, stamps your name and the time, and gives the copy a reference like{" "}
            <span className="font-mono font-semibold text-neutral-700">{referencePattern}</span> with a verification code. Sales, cases,
            behaviour and reviews follow the period; tier and money owed to NoLSAF cover the whole relationship. The printed copy also
            includes the account security and payout details section.
          </p>
        </div>
      )}
    </div>
  );
}

type RegisterTable = { columns: { label: string; align?: "right"; width?: string }[]; rows: { key: string; cells: React.ReactNode[] }[] };

function chipTone(label: string): string {
  const l = label.toLowerCase();
  if (/^not |waiting|paused|off sale/.test(l)) return "bg-amber-50 text-amber-800";
  if (/^removed$/.test(l)) return "bg-neutral-100 text-neutral-500";
  if (/(completed|paid|disbursed|approved|recovered|closed|confirmed|checked|live|published|active)/.test(l) && !/by time/.test(l)) return "bg-emerald-50 text-emerald-800";
  if (/(cancel|refund|reject|failed|high|critical|escalated)/.test(l)) return "bg-red-50 text-red-700";
  if (/(pending|open|claimed|verified|in progress|by time|medium|draft|review)/.test(l)) return "bg-amber-50 text-amber-800";
  return "bg-neutral-100 text-neutral-600";
}

function DateChip({ label, active, open, onToggle, children }: { label: string; active: boolean; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-0 px-2.5 text-xs font-semibold transition ${active ? "bg-white text-[#0b2420]" : "bg-white/[0.06] text-white/70 hover:bg-white/10 hover:text-white"}`}
      >
        <Calendar className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">{children}</div>
        </>
      ) : null}
    </div>
  );
}

function RateCard({ label, value, sub, good }: { label: string; value: number | null; sub: string; good: "high" | "low" }) {
  const v = value ?? 0;
  const ok = value === null ? null : good === "high" ? v >= 70 : v <= 15;
  const bar = value === null ? "bg-neutral-200" : ok ? "bg-emerald-500" : "bg-amber-500";
  return (
    <div className="min-w-0 rounded-md bg-neutral-50 p-3.5 ring-1 ring-neutral-100">
      <p className="m-0 text-[11px] font-semibold text-neutral-500">{label}</p>
      <p className={`m-0 mt-1 text-xl font-black tabular-nums tracking-tight ${value === null ? "text-neutral-300" : ok ? "text-neutral-950" : "text-amber-700"}`}>{value === null ? "No data" : `${value}%`}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200">
        <span className={`block h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
      </div>
      <p className="m-0 mt-1.5 truncate text-[11px] text-neutral-400">{sub}</p>
    </div>
  );
}

function StatCard({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`min-w-0 rounded-md p-3.5 ring-1 ${warn ? "bg-amber-50 ring-amber-100" : "bg-neutral-50 ring-neutral-100"}`}>
      <p className="m-0 text-[11px] font-semibold text-neutral-500">{label}</p>
      <p className={`m-0 mt-1 break-words text-xl font-black tabular-nums tracking-tight ${value === "No data" ? "text-neutral-300" : warn ? "text-amber-700" : "text-neutral-950"}`}>{value}</p>
      <p className="m-0 mt-1.5 truncate text-[11px] text-neutral-400">{sub}</p>
    </div>
  );
}
