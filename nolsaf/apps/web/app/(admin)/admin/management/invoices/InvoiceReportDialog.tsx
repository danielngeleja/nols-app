"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Loader2, Printer, ShieldCheck, X } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";
import { escapeHtml } from "@/utils/html";
import {
  adminReportPrintStyles,
  buildAdminReportFooter,
  buildAdminReportHeader,
  buildAdminReportWatermark,
  openAdminReportPrintWindow,
  renderAndPrintAdminReport,
  updateAdminReportPrintWindowStatus,
} from "@/lib/adminReportPrint";

/**
 * "Print report" for the invoices page. The admin picks what the report covers
 * (money stages, date range, payee type, region, property type, payee), the rows
 * come from the finance-grant gated /api/admin/invoices/report, the figures
 * are sealed through /api/reports/seal (which records the export), and the
 * shared admin report template is printed. A seal failure stops the print.
 */

type Stage = { key: string; label: string; short: string; dot: string; hint: string };
type Options = { regions: string[]; propertyTypes: string[]; payees: Array<{ id: number; name: string | null; email: string | null; role: string }> };
type ReportRow = {
  id: number;
  invoiceNumber: string | null;
  receiptNumber: string | null;
  status: string;
  stage: string;
  manualSettlement: boolean;
  disbursement: { status: string; paidAt: string | null; provider: string | null } | null;
  total: number;
  commission: number | null;
  netPayable: number | null;
  issuedAt: string;
  paidAt: string | null;
  paymentMethod: string | null;
  payee: { name: string | null; email: string | null; role: string | null };
  property: { title: string | null; type: string | null; region: string | null; district: string | null } | null;
};
type ReportTotals = { stage: string; label: string; count: number; total: number; netPayable: number; commission: number };
type ReportResponse = { generatedAt: string; matched: number; truncated: boolean; scanLimited?: boolean; totals: ReportTotals[]; rows: ReportRow[] };

/**
 * Money stages, matching lib/invoiceMoneyStage.ts on the API. Invoice status
 * alone mixes "the guest paid NoLSAF" with "NoLSAF paid the owner"; the stage
 * keeps them apart by reading the disbursement records.
 */
const STAGES: Stage[] = [
  { key: "AWAITING_GUEST", label: "Awaiting guest payment", short: "Awaiting guest", dot: "bg-neutral-400", hint: "The guest has not paid yet." },
  { key: "GUEST_PAID", label: "Guest paid, not disbursed", short: "Guest paid", dot: "bg-sky-500", hint: "Money received by NoLSAF, not yet sent to the payee." },
  { key: "IN_REVIEW", label: "Payout claim in review", short: "Claim in review", dot: "bg-amber-400", hint: "Requested, verified or approved, not yet sent." },
  { key: "DISBURSING", label: "Disbursement in progress", short: "Disbursing", dot: "bg-violet-500", hint: "Transfer submitted, waiting for the provider." },
  { key: "ON_HOLD", label: "Payout on hold", short: "On hold", dot: "bg-orange-500", hint: "Held for security review or a mismatch." },
  { key: "FAILED", label: "Disbursement failed", short: "Failed", dot: "bg-rose-400", hint: "The transfer failed and must be sent again." },
  { key: "DISBURSED", label: "Disbursed to payee", short: "Disbursed", dot: "bg-emerald-500", hint: "Money confirmed delivered to the payee." },
  { key: "REJECTED", label: "Rejected", short: "Rejected", dot: "bg-rose-600", hint: "Not payable." },
  { key: "OTHER", label: "Draft or other", short: "Draft", dot: "bg-neutral-300", hint: "Draft claims and unusual states." },
];
const stageOf = (key: string) => STAGES.find((s) => s.key === key);

/** Stages laid out in the order money moves. */
const STAGE_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: "Guest side", keys: ["AWAITING_GUEST", "GUEST_PAID"] },
  { label: "Payout in motion", keys: ["IN_REVIEW", "DISBURSING", "ON_HOLD", "FAILED"] },
  { label: "Closed", keys: ["DISBURSED", "REJECTED", "OTHER"] },
];

/** One-tap scopes for the questions finance asks most. */
const STAGE_SCOPES: Array<{ label: string; caption: string; keys: string[] }> = [
  { label: "All invoices", caption: "Every stage", keys: [] },
  { label: "Owed to payees", caption: "Paid in, not yet out", keys: ["GUEST_PAID", "IN_REVIEW", "DISBURSING", "ON_HOLD", "FAILED"] },
  { label: "Disbursed", caption: "Confirmed sent", keys: ["DISBURSED"] },
  { label: "Needs attention", caption: "On hold or failed", keys: ["ON_HOLD", "FAILED"] },
];

/** The page's status filter, translated to the closest money stage. */
function stageFromStatus(status: string | null | undefined): string | null {
  const s = String(status || "").toUpperCase();
  if (["REQUESTED", "VERIFIED", "APPROVED"].includes(s)) return "IN_REVIEW";
  if (s === "REJECTED") return "REJECTED";
  if (s === "PENDING") return "AWAITING_GUEST";
  return null;
}

type Preset = { key: string; label: string; range: () => [string, string] };

function eatToday(): Date {
  // Calendar date in Dar es Salaam, as a UTC midnight Date for arithmetic.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${parts}T00:00:00Z`);
}
const iso = (date: Date) => date.toISOString().slice(0, 10);

const PRESETS: Preset[] = [
  { key: "all", label: "All time", range: () => ["", ""] },
  { key: "month", label: "This month", range: () => { const t = eatToday(); return [iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))), iso(t)]; } },
  { key: "last-month", label: "Last month", range: () => { const t = eatToday(); return [iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1))), iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)))]; } },
  { key: "30d", label: "Last 30 days", range: () => { const t = eatToday(); return [iso(new Date(t.getTime() - 29 * 86_400_000)), iso(t)]; } },
  { key: "quarter", label: "This quarter", range: () => { const t = eatToday(); return [iso(new Date(Date.UTC(t.getUTCFullYear(), Math.floor(t.getUTCMonth() / 3) * 3, 1))), iso(t)]; } },
  { key: "year", label: "This year", range: () => { const t = eatToday(); return [iso(new Date(Date.UTC(t.getUTCFullYear(), 0, 1))), iso(t)]; } },
];

const fieldClass =
  "box-border h-10 w-full min-w-0 cursor-pointer rounded-xl border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
const sectionLabel = "m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400";

const amount = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const humanize = (s: string | null | undefined) => {
  const v = String(s || "").replaceAll("_", " ").toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : "";
};
const eatDay = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "-";
const eatStamp = (value: string) =>
  `${new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
const humanDay = (day: string) => (day ? new Date(`${day}T00:00:00+03:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "");

export default function InvoiceReportDialog({ open, initialStatus, onClose }: { open: boolean; initialStatus?: string | null; onClose: () => void }) {
  const [statuses, setStatuses] = useState<string[]>([]);
  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dateField, setDateField] = useState<"issued" | "paid">("issued");
  const [payeeRole, setPayeeRole] = useState<"" | "OWNER" | "DRIVER">("");
  const [region, setRegion] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [options, setOptions] = useState<Options | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGrant, setNeedsGrant] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customStages, setCustomStages] = useState(false);

  // Fresh choices each time it opens, seeded from the page's status filter.
  useEffect(() => {
    if (!open) return;
    const seeded = STAGES.some((s) => s.key === initialStatus) ? String(initialStatus) : stageFromStatus(initialStatus);
    setStatuses(seeded ? [seeded] : []);
    setCustomStages(Boolean(seeded));
    const [f, t] = PRESETS.find((p) => p.key === "month")!.range();
    setPreset("month");
    setFrom(f);
    setTo(t);
    setError(null);
    setNeedsGrant(false);
    setPickerOpen(false);
  }, [open, initialStatus]);

  // Filter choices load once; kept apart so their arrival does not reset the form.
  useEffect(() => {
    if (!open || options) return;
    fetch("/api/admin/invoices/report/options", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setOptions(j); })
      .catch(() => undefined);
  }, [open, options]);

  useEffect(() => {
    const onGranted = () => { setNeedsGrant(false); setError(null); };
    window.addEventListener("finance-grant-granted", onGranted);
    return () => window.removeEventListener("finance-grant-granted", onGranted);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const payees = useMemo(
    () => (options?.payees ?? []).filter((p) => !payeeRole || p.role === payeeRole),
    [options, payeeRole],
  );

  // The scope the current selection matches, or null while picking stages by hand.
  const activeScope = customStages
    ? null
    : STAGE_SCOPES.find((scope) => scope.keys.length === statuses.length && scope.keys.every((k) => statuses.includes(k)))?.label ?? null;
  const scopeSummary = !statuses.length
    ? "Every invoice, whatever its stage."
    : STAGES.filter((s) => statuses.includes(s.key)).map((s) => s.short).join(", ");

  const toggleStatus = (key: string) =>
    setStatuses((current) => (current.includes(key) ? current.filter((s) => s !== key) : [...current, key]));

  const pickPreset = (key: string) => {
    const match = PRESETS.find((p) => p.key === key);
    if (!match) return;
    const [f, t] = match.range();
    setPreset(key);
    setFrom(f);
    setTo(t);
  };

  const scopeLines = useMemo(() => {
    const payee = options?.payees.find((p) => String(p.id) === payeeId);
    return [
      { label: "Money stage", value: !statuses.length || statuses.length === STAGES.length ? "All stages" : STAGES.filter((s) => statuses.includes(s.key)).map((s) => s.label).join(", ") },
      { label: dateField === "paid" ? "Paid between" : "Issued between", value: from || to ? `${from ? humanDay(from) : "the start"} and ${to ? humanDay(to) : "today"}` : "All dates" },
      { label: "Payees", value: payee ? payee.name || payee.email || "Selected payee" : payeeRole === "OWNER" ? "Property owners" : payeeRole === "DRIVER" ? "Drivers" : "Owners and drivers" },
      { label: "Region", value: region || "All regions" },
      { label: "Property type", value: propertyType ? humanize(propertyType) : "All types" },
    ];
  }, [statuses, dateField, from, to, payeeId, payeeRole, region, propertyType, options]);

  const datesInvalid = Boolean(from && to && from > to);
  const rangeDays = from ? Math.round((new Date(`${to || iso(eatToday())}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1 : 0;

  // The on-screen summary: one short value per tile. The printed report keeps
  // the full wording from scopeLines.
  const coverTiles = (() => {
    const payee = options?.payees.find((p) => String(p.id) === payeeId);
    const everyStage = !statuses.length || statuses.length === STAGES.length;
    const picked = STAGES.filter((s) => statuses.includes(s.key));
    return [
      {
        label: "Money stage",
        value: everyStage ? "All invoices" : activeScope ?? (picked.length === 1 ? picked[0].short : `${picked.length} stages`),
        detail: everyStage ? "Every stage" : picked.map((s) => s.short).join(", "),
      },
      {
        label: "Period",
        value: from || to ? `${from ? humanDay(from) : "First record"} to ${to ? humanDay(to) : "Today"}` : "All dates",
        detail: `${dateField === "paid" ? "By paid date" : "By issue date"}${rangeDays ? ` · ${rangeDays} ${rangeDays === 1 ? "day" : "days"}` : ""}`,
      },
      {
        label: "Payees",
        value: payee ? payee.name || payee.email || "Selected payee" : payeeRole === "OWNER" ? "Owners" : payeeRole === "DRIVER" ? "Drivers" : "Owners and drivers",
        detail: payee ? payee.email || (payee.role === "DRIVER" ? "Driver" : "Owner") : "Everyone",
      },
      {
        label: "Location",
        value: region || "All regions",
        detail: propertyType ? humanize(propertyType) : "All property types",
      },
    ];
  })();

  const print = useCallback(async () => {
    if (datesInvalid) return;
    setError(null);
    // Opened inside the click so the popup blocker allows it.
    const printWindow = openAdminReportPrintWindow();
    if (!printWindow) {
      setError("The report preview could not open. Please allow popups for this site and try again.");
      return;
    }
    setBusy(true);
    const fail = (message: string) => {
      try { printWindow.close(); } catch { /* already closed */ }
      setError(message);
    };
    try {
      const params = new URLSearchParams();
      if (statuses.length) params.set("stages", statuses.join(","));
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("dateField", dateField);
      if (payeeRole) params.set("payeeRole", payeeRole);
      if (region) params.set("region", region);
      if (propertyType) params.set("propertyType", propertyType);
      if (payeeId) params.set("payeeId", payeeId);

      const res = await fetch(`/api/admin/invoices/report?${params.toString()}`, { credentials: "include", cache: "no-store" });
      if (res.status === 403) {
        const body = await res.json().catch(() => null);
        if (body?.require2fa) {
          setNeedsGrant(true);
          window.dispatchEvent(new CustomEvent("finance-grant-required"));
          fail("This report carries payout detail. Verify finance access, then press Print report again.");
          return;
        }
      }
      if (!res.ok) {
        fail("The report data could not be loaded. Please try again.");
        return;
      }
      const data: ReportResponse = await res.json();

      const sum = (key: "count" | "total" | "netPayable" | "commission") => data.totals.reduce((acc, t) => acc + Number(t[key] || 0), 0);
      const stageNet = (...keys: string[]) => data.totals.filter((t) => keys.includes(t.stage)).reduce((acc, t) => acc + t.netPayable, 0);
      const generatedAt = new Date();
      const fromLabel = from ? humanDay(from) : "First record";
      const toLabel = to ? humanDay(to) : humanDay(iso(eatToday()));

      // Seal first: no recorded export, no print.
      updateAdminReportPrintWindowStatus(printWindow, "seal");
      let reportRef = `INV-RPT-${generatedAt.toISOString().slice(0, 10).replaceAll("-", "")}-${String(generatedAt.getTime()).slice(-6)}`;
      const sealRes = await fetch("/api/reports/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "INVOICE_REPORT",
          title: "Payout invoice report",
          ref: reportRef,
          from: fromLabel,
          to: toLabel,
          figures: [
            ...scopeLines.map((line) => ({ label: line.label, value: line.value })),
            { label: "Invoices", value: String(data.matched) },
            { label: "Gross total (TZS)", value: amount(sum("total")) },
            { label: "Commission (TZS)", value: amount(sum("commission")) },
            { label: "Net payable (TZS)", value: amount(sum("netPayable")) },
            { label: "Disbursed to payees (TZS)", value: amount(stageNet("DISBURSED")) },
            { label: "Guest paid, not disbursed (TZS)", value: amount(stageNet("GUEST_PAID")) },
            { label: "Claims and transfers in progress (TZS)", value: amount(stageNet("IN_REVIEW", "DISBURSING", "ON_HOLD", "FAILED")) },
          ],
        }),
      });
      const seal: any = await sealRes.json().catch(() => null);
      if (!sealRes.ok || !seal?.token) {
        fail(seal?.error || "This report was not printed because the export could not be recorded. Please try again.");
        return;
      }
      reportRef = String(seal.ref || reportRef);

      updateAdminReportPrintWindowStatus(printWindow, "verify");
      let qrDataUrl: string | null = null;
      try {
        const verifyUrl = new URL("/verify", window.location.origin);
        verifyUrl.searchParams.set("t", String(seal.token));
        const QR: any = await import("qrcode");
        const toDataURL: any = QR?.toDataURL ?? QR?.default?.toDataURL;
        if (typeof toDataURL === "function") qrDataUrl = await toDataURL(verifyUrl.toString(), { margin: 1, width: 320, errorCorrectionLevel: "M" });
      } catch {
        qrDataUrl = null;
      }
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

      updateAdminReportPrintWindowStatus(printWindow, "preview");
      const html = buildReportHtml({
        data,
        scopeLines,
        reportRef,
        qrDataUrl,
        barcodeDataUrl,
        fromLabel,
        toLabel,
        dateField,
        generatedAt,
        printedBy: String(seal.generatedBy || "Administrator"),
        role: String(seal.role || "ADMIN"),
      });
      await renderAndPrintAdminReport(printWindow, html);
      onClose();
    } catch {
      fail("The report could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [datesInvalid, statuses, from, to, dateField, payeeRole, region, propertyType, payeeId, scopeLines, onClose]);

  return (
    <>
      <FinanceGrantPanel showTrigger={false} listenForRequired />
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Print invoice report" onClick={() => !busy && onClose()}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-start gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><Printer className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-bold text-neutral-900">Print invoice report</p>
                <p className="m-0 mt-0.5 text-xs text-neutral-500">Choose what the report covers. Every print is sealed with a verification code and recorded under your name.</p>
              </div>
              <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div>
                <p className={sectionLabel}>What to include</p>
                <div className="mt-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-5" role="radiogroup" aria-label="What to include">
                  {[...STAGE_SCOPES, { label: "Custom", caption: "Pick stages", keys: null as string[] | null }].map((scope) => {
                    const on = scope.keys === null ? activeScope === null : activeScope === scope.label;
                    return (
                      <button
                        key={scope.label}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          if (scope.keys === null) setCustomStages(true);
                          else { setCustomStages(false); setStatuses([...scope.keys]); }
                        }}
                        className={`min-w-0 border-0 px-3 py-2.5 text-left transition-colors ${on ? "bg-[#0b2420] text-white" : "bg-white text-neutral-900 hover:bg-neutral-50"}`}
                      >
                        <span className="block truncate text-xs font-semibold">{scope.label}</span>
                        <span className={`mt-0.5 block truncate text-[11px] ${on ? "text-white/60" : "text-neutral-400"}`}>{scope.caption}</span>
                      </button>
                    );
                  })}
                </div>

                {activeScope === null && (
                  <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
                    {STAGE_GROUPS.map((group) => (
                      <div key={group.label} className="min-w-0">
                        <p className="m-0 mb-1 text-[11px] font-semibold text-neutral-400">{group.label}</p>
                        {group.keys.map((key) => {
                          const s = stageOf(key);
                          if (!s) return null;
                          const on = statuses.includes(key);
                          return (
                            <label key={key} title={s.hint} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-neutral-800">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleStatus(key)}
                                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#02665e]"
                              />
                              <span className="truncate">{s.short}</span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}

                <p className="m-0 mt-2 text-[11px] text-neutral-500">{scopeSummary}</p>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={sectionLabel}>Date range</p>
                  <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" role="tablist" aria-label="Date basis">
                    {(["issued", "paid"] as const).map((key) => (
                      <button key={key} type="button" role="tab" aria-selected={dateField === key} onClick={() => setDateField(key)} className={`h-7 rounded-md border-0 px-2.5 text-xs font-semibold ${dateField === key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>
                        {key === "issued" ? "By issue date" : "By paid date"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button key={p.key} type="button" onClick={() => pickPreset(p.key)} className={`h-7 rounded-md border border-solid px-2.5 text-xs font-medium ${preset === p.key ? "border-[#02665e] bg-[#02665e]/10 text-[#02665e]" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="relative mt-2.5">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    aria-haspopup="dialog"
                    className="flex h-11 w-full items-center gap-3 rounded-xl border border-solid border-neutral-300 bg-white px-3 text-left transition-colors hover:border-neutral-400 hover:bg-neutral-50"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><CalendarDays className="h-4 w-4" /></span>
                    <span className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <span className="min-w-0">
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">From</span>
                        <span className={`block truncate text-sm font-semibold ${from ? "text-neutral-900" : "text-neutral-400"}`}>{from ? humanDay(from) : "First record"}</span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-neutral-300" />
                      <span className="min-w-0">
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">To</span>
                        <span className={`block truncate text-sm font-semibold ${to ? "text-neutral-900" : "text-neutral-400"}`}>{to ? humanDay(to) : "Today"}</span>
                      </span>
                    </span>
                    {rangeDays ? <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral-600">{rangeDays} {rangeDays === 1 ? "day" : "days"}</span> : null}
                  </button>
                  {pickerOpen && (
                    <>
                      <div className="fixed inset-0 z-[80]" onClick={() => setPickerOpen(false)} />
                      <div className="fixed left-1/2 top-1/2 z-[81] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
                        <p className="m-0 px-4 pt-3 text-xs text-neutral-500">{from && !to ? "Now pick the end date" : "Pick the start date, then the end date"}</p>
                        <DatePicker
                          selected={from && to ? [from, to] : from || undefined}
                          allowRange
                          allowPast
                          resetRangeAnchor
                          maxDate={iso(eatToday())}
                          onSelectAction={(picked) => {
                            setPreset("");
                            if (Array.isArray(picked)) {
                              setFrom(picked[0] || "");
                              setTo(picked[picked.length - 1] || "");
                            } else {
                              setFrom(picked || "");
                              setTo("");
                            }
                          }}
                          onCloseAction={() => setPickerOpen(false)}
                        />
                      </div>
                    </>
                  )}
                </div>
                {datesInvalid && <p className="m-0 mt-1.5 text-xs font-semibold text-rose-600">The start date is after the end date.</p>}
                {dateField === "paid" && <p className="m-0 mt-1.5 text-[11px] text-neutral-400">By paid date only includes invoices that have been paid.</p>}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <p className={sectionLabel}>Payees</p>
                  <div className="mt-2 inline-flex rounded-lg bg-neutral-100 p-0.5">
                    {([["", "Owners and drivers"], ["OWNER", "Owners"], ["DRIVER", "Drivers"]] as const).map(([key, label]) => (
                      <button key={key || "all"} type="button" onClick={() => { setPayeeRole(key); setPayeeId(""); }} className={`h-7 rounded-md border-0 px-3 text-xs font-semibold ${payeeRole === key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block min-w-0">
                  <span className={sectionLabel}>Region</span>
                  <select value={region} onChange={(e) => setRegion(e.target.value)} className={`${fieldClass} mt-2`}>
                    <option value="">All regions</option>
                    {(options?.regions ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className={sectionLabel}>Property type</span>
                  <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className={`${fieldClass} mt-2`}>
                    <option value="">All types</option>
                    {(options?.propertyTypes ?? []).map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
                  </select>
                </label>
                <label className="block min-w-0 sm:col-span-2">
                  <span className={sectionLabel}>{payeeRole === "DRIVER" ? "Driver" : payeeRole === "OWNER" ? "Owner" : "Owner or driver"}</span>
                  <select value={payeeId} onChange={(e) => setPayeeId(e.target.value)} className={`${fieldClass} mt-2`}>
                    <option value="">Everyone</option>
                    {payees.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.name || p.email || "Unnamed"}{p.email && p.name ? ` (${p.email})` : ""}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div>
                <p className={sectionLabel}>This report will cover</p>
                <dl className="m-0 mt-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-4">
                  {coverTiles.map((tile) => (
                    <div key={tile.label} className="min-w-0 bg-white px-3 py-2.5">
                      <dt className="text-[11px] text-neutral-400">{tile.label}</dt>
                      <dd className="m-0 mt-0.5 truncate text-sm font-semibold text-neutral-900" title={tile.value}>{tile.value}</dd>
                      <dd className="m-0 mt-0.5 truncate text-[11px] text-neutral-500" title={tile.detail}>{tile.detail}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">
                  {needsGrant ? <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-5 py-3">
              <span className="text-[11px] text-neutral-400">A4 landscape, amounts in TZS, times in EAT</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">
                  Cancel
                </button>
                <button type="button" onClick={() => void print()} disabled={busy || datesInvalid} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3.5 text-xs font-semibold text-white hover:bg-[#12342f] disabled:opacity-50">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                  {busy ? "Preparing" : "Print report"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One colour per money stage on the printed badges, matching the dots in the
 * dialog, so a register page can be scanned by colour.
 */
const STAGE_BADGE_STYLES = `
  .status { white-space: nowrap; }
  .stageAWAITING_GUEST { background: #f1f3f2; color: #4f5a57; }
  .stageGUEST_PAID { background: #e6f1fb; color: #145a8c; }
  .stageIN_REVIEW { background: #fff4d9; color: #8a5a00; }
  .stageDISBURSING { background: #f0eafc; color: #5b34a8; }
  .stageON_HOLD { background: #ffeddc; color: #a2470a; }
  .stageFAILED { background: #fde8ea; color: #a8202f; }
  .stageDISBURSED { background: #e3f6ee; color: #006b4f; }
  .stageREJECTED { background: #f6e3e6; color: #7d1a2a; }
  .stageOTHER { background: #f1f3f2; color: #6b7472; }
`;

/** What happened to the money on this invoice, in words. */
function moneyMovement(row: ReportRow) {
  const muted = (text: string) => `<br/><span class="muted">${escapeHtml(text)}</span>`;
  switch (row.stage) {
    case "DISBURSED": {
      const when = row.disbursement?.paidAt || row.paidAt;
      const how = row.manualSettlement ? "Recorded manually" : row.disbursement?.provider || "Provider confirmed";
      return `Disbursed${when ? ` ${escapeHtml(eatDay(when))}` : ""}${muted(how)}`;
    }
    case "GUEST_PAID":
      return `Guest paid${row.paidAt ? ` ${escapeHtml(eatDay(row.paidAt))}` : ""}${muted(row.paymentMethod ? `${row.paymentMethod}, not disbursed` : "Not disbursed")}`;
    case "DISBURSING":
      return `Transfer in progress${muted(row.disbursement ? humanize(row.disbursement.status) : "Awaiting provider")}`;
    case "ON_HOLD":
      return `Payout held${muted(row.disbursement ? humanize(row.disbursement.status) : "Under review")}`;
    case "FAILED":
      return `Transfer failed${muted("Must be sent again")}`;
    case "IN_REVIEW":
      return `Claim ${escapeHtml(humanize(row.status).toLowerCase())}${muted("Not yet sent")}`;
    case "AWAITING_GUEST":
      return '<span class="muted">Guest not paid</span>';
    default:
      return `<span class="muted">${escapeHtml(humanize(row.status) || "None")}</span>`;
  }
}

function buildReportHtml(input: {
  data: ReportResponse;
  scopeLines: Array<{ label: string; value: string }>;
  reportRef: string;
  qrDataUrl: string | null;
  barcodeDataUrl: string | null;
  fromLabel: string;
  toLabel: string;
  dateField: "issued" | "paid";
  generatedAt: Date;
  printedBy: string;
  role: string;
}) {
  const { data, reportRef } = input;
  const totals = data.totals;
  const sum = (key: "count" | "total" | "netPayable" | "commission") => totals.reduce((acc, t) => acc + Number(t[key] || 0), 0);
  const pick = (...keys: string[]) => {
    const list = totals.filter((t) => keys.includes(t.stage));
    return { count: list.reduce((acc, t) => acc + t.count, 0), net: list.reduce((acc, t) => acc + t.netPayable, 0) };
  };
  const disbursed = pick("DISBURSED");
  const held = pick("GUEST_PAID");
  const moving = pick("IN_REVIEW", "DISBURSING");
  const blocked = pick("ON_HOLD", "FAILED");
  const unpaid = pick("AWAITING_GUEST");
  const manualCount = data.rows.filter((row) => row.manualSettlement).length;
  const stampAt = eatStamp(input.generatedAt.toISOString());
  const empty = (cols: number, text: string) => `<tr><td colspan="${cols}" class="emptyState">${escapeHtml(text)}</td></tr>`;

  const rank = (status: string) => {
    const index = STAGES.findIndex((s) => s.key === status);
    return index < 0 ? STAGES.length : index;
  };
  const statusRows = [...totals]
    .sort((a, b) => rank(a.stage) - rank(b.stage))
    .map((t) => `<tr><td><strong>${escapeHtml(t.label)}</strong><br/><span class="muted">${escapeHtml(stageOf(t.stage)?.hint ?? "")}</span></td><td class="num">${t.count.toLocaleString()}</td><td class="num">${amount(t.total)}</td><td class="num">${amount(t.commission)}</td><td class="num">${amount(t.netPayable)}</td><td class="num">${sum("count") ? ((t.count / sum("count")) * 100).toFixed(1) : "0.0"}%</td></tr>`)
    .join("");

  // Breakdown by region and by property type, from the printed rows.
  const group = (key: (row: ReportRow) => string) => {
    const map = new Map<string, { count: number; net: number; gross: number }>();
    data.rows.forEach((row) => {
      const k = key(row);
      const entry = map.get(k) ?? { count: 0, net: 0, gross: 0 };
      entry.count += 1;
      entry.net += Number(row.netPayable ?? 0);
      entry.gross += Number(row.total ?? 0);
      map.set(k, entry);
    });
    return [...map.entries()].sort((a, b) => b[1].net - a[1].net);
  };
  const breakdownRows = (entries: Array<[string, { count: number; net: number; gross: number }]>) =>
    entries.length
      ? entries.slice(0, 15).map(([label, v]) => `<tr><td>${escapeHtml(label)}</td><td class="num">${v.count.toLocaleString()}</td><td class="num">${amount(v.gross)}</td><td class="num">${amount(v.net)}</td></tr>`).join("")
      : empty(4, "No invoices in this report.");
  const byRegion = group((row) => row.property?.region || (row.payee.role === "DRIVER" ? "Transport (no property)" : "Region not set"));
  const byType = group((row) => (row.property?.type ? humanize(row.property.type) : row.payee.role === "DRIVER" ? "Transport" : "Type not set"));

  const registerRows = data.rows.length
    ? data.rows
        .map((row) => {
          const place = [row.property?.district, row.property?.region].filter(Boolean).join(", ");
          return `<tr>
            <td><strong>${escapeHtml(row.invoiceNumber || "No number")}</strong>${row.receiptNumber ? `<br/><span class="muted">${escapeHtml(row.receiptNumber)}</span>` : ""}</td>
            <td>${escapeHtml(row.payee.name || row.payee.email || "Unnamed")}<br/><span class="muted">${escapeHtml(row.payee.role === "DRIVER" ? "Driver" : "Owner")}</span></td>
            <td>${escapeHtml(row.property?.title || (row.payee.role === "DRIVER" ? "Transport trip" : "Not linked"))}<br/><span class="muted">${escapeHtml([row.property?.type ? humanize(row.property.type) : "", place].filter(Boolean).join(" · "))}</span></td>
            <td>${escapeHtml(eatDay(row.issuedAt))}</td>
            <td><span class="status stage${escapeHtml(row.stage)}">${escapeHtml(stageOf(row.stage)?.short ?? humanize(row.status))}</span><br/><span class="muted">Status: ${escapeHtml(humanize(row.status))}</span></td>
            <td class="num">${amount(row.total)}</td>
            <td class="num">${amount(row.commission)}</td>
            <td class="num">${amount(row.netPayable)}</td>
            <td>${moneyMovement(row)}</td>
          </tr>`;
        })
        .join("")
    : empty(9, "No invoices match the selected filters.");

  const scopeTable = input.scopeLines.map((line) => `<tr><td>${escapeHtml(line.label)}</td><td><strong>${escapeHtml(line.value)}</strong></td></tr>`).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(`Invoice-report-${reportRef}`)}</title>
  <style>${adminReportPrintStyles("landscape")}${STAGE_BADGE_STYLES}</style>
</head>
<body>
  <div class="reportPage">
    ${buildAdminReportWatermark({ printedBy: input.printedBy, role: input.role, reportRef, printedAt: stampAt, classification: "NoLSAF confidential" })}
    <main class="reportDocument">
    ${buildAdminReportHeader({
      logoUrl: new URL("/assets/NoLS2025-04.png", window.location.origin).toString(),
      eyebrow: "Payouts",
      title: "Payout invoice report",
      description: "Payout invoices raised by property owners and drivers for the scope below, with gross value, NoLSAF commission and the net amount owed or paid.",
      reportId: input.generatedAt.toISOString(),
      reportRef,
      barcodeDataUrl: input.barcodeDataUrl,
      from: input.fromLabel,
      to: input.toLabel,
      generatedAt: stampAt,
      preparedBy: input.printedBy,
      classification: "Finance and payouts",
    })}

    <div class="metricGrid">
      <div class="metricCard"><span class="metricLabel">Invoices in report</span><strong>${data.matched.toLocaleString()}</strong><small>Matching the scope below, ${input.dateField === "paid" ? "by paid date" : "by issue date"}.</small></div>
      <div class="metricCard"><span class="metricLabel">Gross value</span><strong>TZS ${amount(sum("total"))}</strong><small>Total booking value behind these invoices.</small></div>
      <div class="metricCard"><span class="metricLabel">NoLSAF commission</span><strong>TZS ${amount(sum("commission"))}</strong><small>Retained by NoLSAF across these invoices.</small></div>
      <div class="metricCard metricCardGood"><span class="metricLabel">Disbursed to payees</span><strong>TZS ${amount(disbursed.net)}</strong><small>${disbursed.count.toLocaleString()} invoice(s) with the transfer confirmed delivered${manualCount ? `, ${manualCount.toLocaleString()} recorded manually` : ""}.</small></div>
      <div class="metricCard${held.count ? " metricCardWarn" : ""}"><span class="metricLabel">Guest paid, not disbursed</span><strong>TZS ${amount(held.net)}</strong><small>${held.count.toLocaleString()} invoice(s) where NoLSAF holds the guest's money and owes the payee.</small></div>
      <div class="metricCard${blocked.count ? " metricCardWarn" : ""}"><span class="metricLabel">Payouts moving</span><strong>TZS ${amount(moving.net)}</strong><small>${moving.count.toLocaleString()} in claim review or disbursing. ${blocked.count ? `${blocked.count.toLocaleString()} on hold or failed (TZS ${amount(blocked.net)}).` : "None on hold or failed."} ${unpaid.count ? `${unpaid.count.toLocaleString()} still await guest payment.` : ""}</small></div>
    </div>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">01</span><div><h2>Report scope</h2><p>The filters chosen when this report was printed.</p></div></div>
      <div class="tableWrap"><table><thead><tr><th style="width:28%;">Filter</th><th>Applied</th></tr></thead><tbody>${scopeTable}</tbody></table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">02</span><div><h2>By money stage</h2><p>Guest money received is kept apart from money sent to payees: Disbursed only counts transfers confirmed by the provider or recorded as settled payout claims. Amounts in TZS.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th style="width:34%;">Money stage</th><th style="text-align:right;">Invoices</th><th style="text-align:right;">Gross</th><th style="text-align:right;">Commission</th><th style="text-align:right;">Net payable</th><th style="text-align:right;">Share</th></tr></thead>
        <tbody>${statusRows || empty(6, "No invoices in this report.")}
          <tr><td><strong>Total</strong></td><td class="num">${sum("count").toLocaleString()}</td><td class="num">${amount(sum("total"))}</td><td class="num">${amount(sum("commission"))}</td><td class="num">${amount(sum("netPayable"))}</td><td class="num">100%</td></tr>
        </tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">03</span><div><h2>By region and property type</h2><p>Largest net payable first, top 15 of each. Amounts in TZS.</p></div></div>
      <div class="panelGrid panelGridTwo">
        <div class="tableWrap"><table><thead><tr><th>Region</th><th style="text-align:right;">Invoices</th><th style="text-align:right;">Gross</th><th style="text-align:right;">Net</th></tr></thead><tbody>${breakdownRows(byRegion)}</tbody></table></div>
        <div class="tableWrap"><table><thead><tr><th>Property type</th><th style="text-align:right;">Invoices</th><th style="text-align:right;">Gross</th><th style="text-align:right;">Net</th></tr></thead><tbody>${breakdownRows(byType)}</tbody></table></div>
      </div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">04</span><div><h2>Invoice register</h2><p>Every invoice in scope, oldest first. Amounts in TZS, dates in EAT.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr>
          <th style="width:11%;">Invoice</th><th style="width:13%;">Payee</th><th style="width:19%;">Property</th><th style="width:8%;">Issued</th><th style="width:9%;">Stage</th>
          <th style="width:9%;text-align:right;">Gross</th><th style="width:9%;text-align:right;">Commission</th><th style="width:10%;text-align:right;">Net</th><th style="width:12%;">Money movement</th>
        </tr></thead>
        <tbody>${registerRows}</tbody>
      </table></div>
      ${data.truncated ? `<div class="reportNote">The register lists the first ${data.rows.length.toLocaleString()} of ${data.matched.toLocaleString()} invoices. The totals above cover all ${data.matched.toLocaleString()}; the region and property type breakdown covers the listed rows. Narrow the date range to print the full register.</div>` : ""}
    </section>

    ${buildAdminReportFooter({
      reportRef,
      qrDataUrl: input.qrDataUrl,
      purpose: "Scan the QR code to confirm the sealed figures on the public NoLSAF verification page.",
      signatureLabel: "Finance authorization",
    })}
    </main>
  </div>
</body>
</html>`;
}
