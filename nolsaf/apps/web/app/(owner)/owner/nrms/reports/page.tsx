"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { buildReportWorkbook, renderReportCharts, type WorkbookIdentity, type WorkbookInput } from "@/lib/nrmsReportWorkbook";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Banknote,
  BarChart3,
  BedDouble,
  BookOpenCheck,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  FileSearch,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  Printer,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  ShoppingBasket,
  Store,
  TrendingUp,
  Users,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type ReportKey = "manager" | "revenue" | "payments" | "balances" | "occupancy" | "outlets" | "audit";
type RangePreset = "today" | "month" | "90d" | "year";
type IconType = ComponentType<{ className?: string }>;
type PdfSectionKey = "operations" | "reconciliation" | "channels" | "occupancy" | "balances" | "outlets" | "payments" | "audit" | "nightAudit" | "cashiers" | "ledger" | "tax" | "nbs" | "assurance" | "certification";
type PdfPackKey = "current" | "full" | "executive" | "finance" | "operations" | "custom";
type PdfPackSelection = { key: PdfPackKey; label: string; sections: PdfSectionKey[] };
// "download" rasterises through html2pdf; "print" hands the same markup to the browser's PDF writer.
type PdfOutputMode = "download" | "print";

type CurrencyReport = {
  currency: string;
  summary: {
    roomRevenue: number;
    folioExtras: number;
    outletPaidRevenue: number;
    totalRevenue: number;
    folioPayments: number;
    outletPayments: number;
    totalCollected: number;
    amountDue: number;
  };
  collectionTiming: {
    currentStayCollections: number;
    currentOutletCollections: number;
    currentPeriodCollections: number;
    priorStayCollections: number;
    advanceDeposits: number;
    unclassifiedCollections: number;
    totalCollected: number;
    revenueToCollectionDifference: number;
    currentPeriodCollectionGap: number;
  };
  departments: Array<{ department: string; transactions: number; amount: number }>;
  paymentMethods: Array<{ method: string; transactions: number; amount: number }>;
};

type ReservationSourceRow = {
  source: string;
  currency: string;
  reservations: number;
  reservationShare: number;
  roomNights: number;
  roomRevenue: number;
  revenueShare: number;
  folioCollected: number;
  averageReservationValue: number;
  cancellations: number;
  noShows: number;
};

type GuestBalance = {
  reservationId: number;
  receiptNumber: string | null;
  guest: string;
  phone: string | null;
  room: string;
  status: string;
  checkIn: string;
  checkOut: string;
  currency: string;
  roomAmount: number;
  folioExtras: number;
  outletPaid: number;
  totalSpend: number;
  folioPaid: number;
  totalCollected: number;
  amountDue: number;
  settlementStatus: "PAID" | "PARTIAL" | "UNPAID";
};

type PaymentRow = {
  id: string;
  type: string;
  occurredAt: string;
  reservationId: number;
  referenceNumber: string | null;
  guest: string;
  room: string;
  method: string;
  reference: string | null;
  currency: string;
  amount: number;
  recordedBy: string;
  voidedAt: string | null;
  voidReason: string | null;
};

type OutletRow = {
  id: number;
  orderNumber: string;
  outlet: string;
  outletType: string;
  guest: string;
  room: string;
  reservationId: number;
  status: string;
  settlementMode: string;
  settlementMethod: string | null;
  items: string;
  itemCount: number;
  currency: string;
  total: number;
  orderedAt: string;
  servedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  voidReason: string | null;
};

type AuditRow = {
  id: number;
  type: string;
  occurredAt: string;
  reservationId: number;
  referenceNumber: string | null;
  guest: string;
  room: string;
  actor: string;
  reason: string | null;
  details: Record<string, unknown> | null;
};

type PdfIdentity = {
  reportNumber: string;
  generatedAt: string;
  generatedBy: string;
  generatedByRole: string;
  barcodeDataUrl: string;
  qrDataUrl: string;
  verificationMode: "SEALED" | "REFERENCE";
};

type ReportsResponse = {
  property: { id: number; title: string };
  range: { from: string; to: string; days: number };
  generatedAt: string;
  control: {
    status: "BALANCED" | "REVIEW" | "FAILED";
    financialChecks: Array<{ key: string; currency: string; label: string; difference: number; passed: boolean }>;
    warnings: Array<{ key: string; label: string; count: number }>;
    basis: {
      roomRevenue: "STAY_NIGHT_ALLOCATION";
      folioExtras: "POSTED_AT";
      outletRevenue: "SETTLED_AT";
      collections: "RECORDED_AT";
      channelProduction: "ARRIVAL_DATE";
      timeZone: string;
    };
    recordCounts: {
      reservations: number;
      stayRevenueReservations: number;
      folioCharges: number;
      payments: number;
      outletOrders: number;
      auditEvents: number;
      expenses: number;
    };
  };
  manager: {
    arrivals: number;
    departures: number;
    inHouse: number;
    cancellations: number;
    noShows: number;
    openOrders: number;
    rooms: { total: number; active: number; occupiedNow: number; availableNow: number; outOfService: number };
  };
  currencies: CurrencyReport[];
  reservationSources: ReservationSourceRow[];
  guestBalances: GuestBalance[];
  occupancy: {
    currency: string;
    rangeDays: number;
    activeRooms: number;
    blockedRoomNights: number;
    roomNightsAvailable: number;
    roomNightsSold: number;
    occupancyRate: number;
    roomRevenue: number;
    adr: number;
    revPar: number;
    byRoomType: Array<{ roomTypeId: number; roomType: string; units: number; roomNightsAvailable: number; roomNightsSold: number; occupancyRate: number }>;
  };
  payments: { rows: PaymentRow[]; cashVarianceAvailable: boolean };
  outlets: { rows: OutletRow[] };
  audit: { rows: AuditRow[] };
  expenses: { rows: ExpenseReportRow[] };
  profitLoss: ProfitLossRow[];
  staffPerformance: StaffPerformanceRow[];
};

type ExpenseReportRow = { id: number; category: string; description: string; amount: number; currency: string; paymentMethod: string | null; incurredAt: string; recordedBy: string; voidedAt: string | null };
type ProfitLossRow = { currency: string; totalRevenue: number; totalExpenses: number; netProfit: number; expensesByCategory: Array<{ category: string; amount: number }> };
type StaffPerformanceRow = { staffId: number; name: string; role: string; currency: string; orders: number; sales: number; tips: number };

type FinanceControlResponse = {
  range: { from: string; to: string };
  businessDate: string;
  month: string;
  businessDay: { status: string; closedAt?: string | null; audits: Array<{ id: number; reportNumber: string; status: string; startedAt: string; completedAt: string | null }> };
  nightAudits: Array<{ id: number; reportNumber: string; status: string; startedAt: string; completedAt: string | null; businessDay: { businessDate: string } }>;
  blockers: Array<{ code: string; count: number; message: string }>;
  shifts: Array<{ id: number; cashierName: string; currency: string; status: string; openingFloat: number; liveExpectedCash: number; expectedCash: number; declaredCash: number | null; variance: number | null; closeNote: string | null; openedAt: string; closedAt: string | null }>;
  ledger: {
    balanced: boolean;
    accounts: Array<{ accountCode: string; accountName: string; accountType: string; currency: string; debit: number; credit: number; balance: number }>;
    transactions: Array<{ id: number; transactionNumber: string; description: string; sourceType: string; currency: string; occurredAt: string; entries: Array<{ id: number; accountCode: string; accountName: string; debit: number; credit: number }> }>;
  };
  tax: { total: number; note: string; rows: Array<{ transactionNumber: string; occurredAt: string; description: string; currency: string; tax: number }> };
  nbs: { month: string; reportingDays: number; bedsAvailable: number; bedNightsAvailable: number; bedNightsOccupied: number; domesticBedNights: number; internationalBedNights: number; roomNightsOccupied: number; bedOccupancyRate: number; missingNationalityBedNights: number; methodology: string };
};

const REPORTS: Array<{ key: ReportKey; label: string; description: string; icon: IconType }> = [
  { key: "manager", label: "Daily manager", description: "One view of today’s operation", icon: ClipboardCheck },
  { key: "revenue", label: "Revenue", description: "Rooms, folios and outlets", icon: TrendingUp },
  { key: "payments", label: "Payments & cashiers", description: "Collections and accountability", icon: WalletCards },
  { key: "balances", label: "Guest balances", description: "Folio settlement control", icon: ReceiptText },
  { key: "occupancy", label: "Occupancy", description: "ADR, RevPAR and room use", icon: BedDouble },
  { key: "outlets", label: "Outlet sales", description: "Restaurant and bar history", icon: ShoppingBasket },
  { key: "audit", label: "Audit & voids", description: "Who changed what and when", icon: ShieldCheck },
];

const PDF_SECTION_OPTIONS: Array<{ key: PdfSectionKey; label: string; description: string; icon: IconType; required?: boolean }> = [
  { key: "operations", label: "Operations at a glance", description: "Arrivals, departures, in-house guests and open orders", icon: ClipboardCheck },
  { key: "reconciliation", label: "Financial reconciliation", description: "Revenue, collections, timing and departments", icon: TrendingUp },
  { key: "channels", label: "Reservation source mix", description: "NoLSAF, OTAs, direct, phone and walk-in production", icon: BarChart3 },
  { key: "occupancy", label: "Room and occupancy", description: "Available nights, sold nights, ADR and RevPAR basis", icon: BedDouble },
  { key: "balances", label: "Guest folio balances", description: "Charges, collections and outstanding guest balances", icon: ReceiptText },
  { key: "outlets", label: "Outlet sales", description: "Restaurant, bar and service order settlement", icon: Store },
  { key: "payments", label: "Payment register", description: "Payment method, operator, reference and status", icon: WalletCards },
  { key: "audit", label: "Audit and exceptions", description: "Voids, corrections, reasons and responsible users", icon: History },
  { key: "nightAudit", label: "Night Audit and business close", description: "Closing status, blockers and immutable audit references", icon: CalendarCheck2 },
  { key: "cashiers", label: "Cashier shift variance", description: "Expected cash, declared cash, overages and shortages", icon: WalletCards },
  { key: "ledger", label: "Accounting ledger", description: "Balanced journal transactions and account totals", icon: BookOpenCheck },
  { key: "tax", label: "Tax register", description: "Separately captured tax payable and its transaction basis", icon: ReceiptText },
  { key: "nbs", label: "NBS accommodation statistics", description: "Beds, bed-nights, occupancy and visitor origin", icon: BedDouble },
  { key: "assurance", label: "Control assurance", description: "Automated reconciliation and data-quality checks", icon: ShieldCheck, required: true },
  { key: "certification", label: "Certification and sign-off", description: "Disclaimer, verification QR and authorization signatures", icon: BookOpenCheck, required: true },
];

const PDF_PACKS: Array<PdfPackSelection & { description: string }> = [
  { key: "full", label: "Full property pack", description: "Complete management, finance, operations and audit record", sections: PDF_SECTION_OPTIONS.map((section) => section.key) },
  { key: "executive", label: "Executive pack", description: "Headline operation, performance, channels and controls", sections: ["operations", "reconciliation", "channels", "occupancy", "assurance", "certification"] },
  { key: "finance", label: "Finance and control pack", description: "Revenue, cashiers, ledgers, tax, Night Audit and assurance", sections: ["reconciliation", "balances", "payments", "cashiers", "ledger", "tax", "nightAudit", "audit", "assurance", "certification"] },
  { key: "operations", label: "Operations pack", description: "Front desk, rooms, channels and outlet performance", sections: ["operations", "channels", "occupancy", "outlets", "assurance", "certification"] },
];

const REQUIRED_PDF_SECTIONS: PdfSectionKey[] = ["assurance", "certification"];

const CURRENT_REPORT_PDF_SECTIONS: Record<ReportKey, PdfSectionKey[]> = {
  manager: ["operations", "reconciliation", "assurance", "certification"],
  revenue: ["reconciliation", "channels", "assurance", "certification"],
  payments: ["payments", "assurance", "certification"],
  balances: ["balances", "assurance", "certification"],
  occupancy: ["occupancy", "assurance", "certification"],
  outlets: ["outlets", "assurance", "certification"],
  audit: ["audit", "assurance", "certification"],
};

const LABELS: Record<string, string> = {
  ROOMS: "Rooms",
  RESTAURANT: "Restaurant",
  BAR: "Bar",
  LAUNDRY: "Laundry",
  MINIBAR: "Minibar",
  ROOM_SERVICE: "Room service",
  TRANSPORT: "Transport",
  DAMAGE: "Damage",
  OTHER: "Other",
  CASH: "Cash",
  MOBILE_MONEY: "Mobile money",
  BANK: "Bank transfer",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  OUTLET_PAYMENT: "Paid at outlet",
  ROOM_FOLIO: "Room folio",
  POSTED_TO_FOLIO: "Posted to folio",
  SETTLED: "Settled",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  CANCELLED: "Cancelled",
  VOIDED: "Voided",
  PAYMENT_RECORDED: "Payment recorded",
  PAYMENT_VOIDED: "Payment voided",
  CHARGE_POSTED: "Charge posted",
  CHARGE_VOIDED: "Charge voided",
  CHECKED_IN: "Checked in",
  CHECKED_OUT: "Checked out",
  ROOM_ASSIGNED: "Room assigned",
  ROOM_MOVED: "Room moved",
  EDITED: "Reservation edited",
  CREATED: "Reservation created",
  NO_SHOW: "No-show",
  NOLSAF: "NoLSAF",
  WALK_IN: "Walk-in",
  PHONE: "Phone",
  DIRECT: "Direct",
  AIRBNB: "Airbnb",
  BOOKING_COM: "Booking.com",
  EXPEDIA: "Expedia",
};

function localDateKey(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialRange() {
  const today = new Date();
  return { from: localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: localDateKey(today) };
}

function label(value: string): string {
  return LABELS[value] ?? value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function sourceRowClass(source: string): string {
  const classes: Record<string, string> = {
    NOLSAF: "pdf-source-nolsaf",
    BOOKING_COM: "pdf-source-booking",
    AIRBNB: "pdf-source-airbnb",
    EXPEDIA: "pdf-source-expedia",
    WALK_IN: "pdf-source-walkin",
    DIRECT: "pdf-source-direct",
    PHONE: "pdf-source-phone",
    OTHER: "pdf-source-other",
  };
  return classes[source.toUpperCase()] ?? "pdf-source-other";
}

function outletPdfRowClass(outletType: string): string {
  if (outletType.toUpperCase() === "BAR") return "pdf-outlet-bar";
  if (outletType.toUpperCase() === "RESTAURANT") return "pdf-outlet-restaurant";
  return "pdf-outlet-service";
}

function outletUiRowClass(outletType: string): string {
  if (outletType.toUpperCase() === "BAR") return "[&>td:first-child]:border-l-4 [&>td:first-child]:border-l-violet-500 [&>td:first-child]:bg-violet-50 [&>td:first-child]:text-violet-900";
  if (outletType.toUpperCase() === "RESTAURANT") return "[&>td:first-child]:border-l-4 [&>td:first-child]:border-l-orange-500 [&>td:first-child]:bg-orange-50 [&>td:first-child]:text-orange-900";
  return "[&>td:first-child]:border-l-4 [&>td:first-child]:border-l-sky-500 [&>td:first-child]:bg-sky-50 [&>td:first-child]:text-sky-900";
}

function moneyFormatter(currency: string) {
  try {
    return new Intl.NumberFormat("en-TZ", { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    return new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 });
  }
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }).format(new Date(value));
}

function dateTime(value: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Dar_es_Salaam",
  }).format(new Date(value));
  return `${formatted} EAT`;
}

function reportTimeKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Dar_es_Salaam",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}${part("minute")}`;
}

function reportNonce(length = 4): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function buildReportNumber(data: ReportsResponse, generatedAt: Date): string {
  const property = String(data.property.id).padStart(3, "0").slice(-3);
  const from = data.range.from.replaceAll("-", "").slice(2);
  const to = data.range.to.replaceAll("-", "").slice(2);
  return `NRMS-R${property}-${from}-${to}-${reportTimeKey(generatedAt)}-${reportNonce()}`;
}

function PdfEmptyRow({ columns, text }: { columns: number; text: string }) {
  return <tr><td colSpan={columns} className="pdf-empty">{text}</td></tr>;
}

function PdfSection({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="pdf-section">
      <div className="pdf-section-title">
        <span>{number}</span>
        <div><h2>{title}</h2><p>{description}</p></div>
      </div>
      {children}
    </section>
  );
}

function PdfMetric({ label: metricLabel, value, detail, tone = "dark" }: { label: string; value: string; detail: string; tone?: "dark" | "green" | "amber" }) {
  return <div className={`pdf-metric pdf-metric-${tone}`}><p>{metricLabel}</p><strong>{value}</strong><small>{detail}</small></div>;
}

function ConsolidatedPdfReport({ data, finance, currencyReport, identity, money, selection }: { data: ReportsResponse; finance: FinanceControlResponse; currencyReport: CurrencyReport; identity: PdfIdentity; money: (value: number) => string; selection: PdfPackSelection }) {
  const { summary } = currencyReport;
  const timing = currencyReport.collectionTiming;
  const balances = data.guestBalances.filter((row) => row.currency === currencyReport.currency);
  const payments = data.payments.rows.filter((row) => row.currency === currencyReport.currency);
  const outlets = data.outlets.rows.filter((row) => row.currency === currencyReport.currency);
  const reservationSources = data.reservationSources.filter((row) => row.currency === currencyReport.currency);
  const outstandingGuests = balances.filter((row) => row.amountDue > 0.005);
  const rangeStart = shortDate(`${data.range.from}T00:00:00+03:00`);
  const rangeEnd = shortDate(`${data.range.to}T23:59:59+03:00`);
  const generated = dateTime(identity.generatedAt);
  const occupancyMoney = moneyFormatter(data.occupancy.currency).format;
  const currencyChecks = data.control.financialChecks.filter((check) => check.currency === currencyReport.currency);
  const cashierShifts = finance.shifts.filter((shift) => shift.currency === currencyReport.currency);
  const ledgerAccounts = finance.ledger.accounts.filter((account) => account.currency === currencyReport.currency);
  const ledgerTransactions = finance.ledger.transactions.filter((transaction) => transaction.currency === currencyReport.currency);
  const taxRows = finance.tax.rows.filter((row) => row.currency === currencyReport.currency);
  const controlTone = data.control.status === "BALANCED" ? "balanced" : data.control.status === "REVIEW" ? "review" : "failed";
  const selectedSections = new Set(selection.sections);
  const orderedSections = PDF_SECTION_OPTIONS.filter((section) => selectedSections.has(section.key));
  const hasSection = (section: PdfSectionKey) => selectedSections.has(section);
  const sectionNumber = (section: PdfSectionKey) => String(orderedSections.findIndex((item) => item.key === section) + 1).padStart(2, "0");

  return (
    <article className="nrms-pdf" aria-label="NRMS consolidated property report">
      <style>{`
        .nrms-pdf { box-sizing: border-box; width: 718px; background: #fff; color: #171717; font-family: "Trebuchet MS", Arial, sans-serif; font-size: 10.5px; line-height: 1.5; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .nrms-pdf * { box-sizing: border-box; }
        .nrms-pdf h1, .nrms-pdf h2, .nrms-pdf p { margin: 0; }
        .pdf-cover { overflow: hidden; border: 1px solid #d6dfdc; border-radius: 7px; background: #fff; }
        .pdf-cover-top { display: grid; grid-template-columns: minmax(0, 1fr) 252px; align-items: start; gap: 28px; padding: 20px 24px 17px; background: linear-gradient(180deg, #ffffff 0%, #fafcfb 100%); color: #17201e; }
        .pdf-mark { display: flex; align-items: flex-start; gap: 12px; }
        .pdf-logo { display: grid; width: 40px; height: 40px; flex: none; place-items: center; border-radius: 6px; background: #073c35; color: #fff; font-size: 16px; font-weight: 900; }
        .pdf-mark-copy { min-width: 0; flex: 1; }
        .pdf-kicker { color: #00785a; font-size: 8px; font-weight: 800; letter-spacing: 1.7px; text-transform: uppercase; }
        .pdf-cover h1 { margin-top: 4px; font-size: 24px; line-height: 1.12; letter-spacing: -.5px; }
        .pdf-property { margin-top: 5px !important; color: #59635f; font-size: 11px; }
        .pdf-report-meta { min-width: 0; border-left: 1px solid #dce3e0; padding-left: 18px; }
        .pdf-report-meta div { display: flex; justify-content: space-between; gap: 14px; padding: 3px 0; }
        .pdf-report-meta span { color: #596662; font-size: 7.8px; font-weight: 800; letter-spacing: .7px; text-transform: uppercase; }
        .pdf-report-meta strong { color: #111816; font-size: 8.8px; font-weight: 800; text-align: right; }
        .pdf-header-barcode { width: 310px; max-width: 100%; margin-top: 13px; padding-top: 9px; border-top: 1px solid #e0e6e4; }
        .pdf-barcode-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .pdf-barcode-label { color: #51716a; font-size: 7px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; }
        .pdf-barcode { display: block; width: 310px; max-width: 100%; height: 32px; margin-top: 5px; object-fit: fill; object-position: left center; background: #fff; }
        .pdf-report-number { color: #073c35; font-family: Consolas, "Courier New", monospace; font-size: 8px; font-weight: 800; letter-spacing: .35px; white-space: nowrap; }
        .pdf-scope { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; background: #f5faf8; }
        .pdf-scope div { padding: 12px 18px; border-right: 1px solid #dfeae6; }
        .pdf-scope div:last-child { border-right: 0; }
        .pdf-scope span, .pdf-metric p { display: block; color: #56625e; font-size: 8px; font-weight: 800; letter-spacing: .7px; text-transform: uppercase; }
        .pdf-scope strong { display: block; margin-top: 3px; font-size: 11px; }
        .pdf-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
        .pdf-metric { min-height: 82px; padding: 13px 14px; border: 1px solid #e2e6e5; border-radius: 6px; background: #fafafa; page-break-inside: avoid; }
        .pdf-metric strong { display: block; margin-top: 7px; font-size: 17px; line-height: 1; letter-spacing: -.3px; }
        .pdf-metric small { display: block; margin-top: 8px; color: #545d5a; font-size: 8.5px; }
        .pdf-metric-green { border-color: #bcebd9; background: #ecfbf5; color: #006b4f; }
        .pdf-metric-amber { border-color: #f3dfa5; background: #fffae9; color: #8a4b00; }
        .pdf-section { margin-top: 18px; page-break-inside: auto; }
        .pdf-section-title { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 9px; padding-bottom: 8px; border-bottom: 2px solid #073c35; page-break-after: avoid; }
        .pdf-section-title > span { display: grid; width: 24px; height: 24px; flex: none; place-items: center; border-radius: 5px; background: #073c35; color: #fff; font-size: 9px; font-weight: 800; }
        .pdf-section-title h2 { font-size: 13px; line-height: 1.2; }
        .pdf-section-title p { margin-top: 2px; color: #505a57; font-size: 8.7px; }
        .pdf-operations { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
        .pdf-operation { padding: 10px 7px; border-radius: 5px; background: #f5f6f6; text-align: center; page-break-inside: avoid; }
        .pdf-operation strong { display: block; font-size: 16px; }
        .pdf-operation span { color: #555f5c; font-size: 7.5px; font-weight: 800; letter-spacing: .45px; text-transform: uppercase; }
        .pdf-grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; align-items: start; break-inside: avoid; page-break-inside: avoid; }
        .pdf-panel { overflow: hidden; border: 1px solid #e4e7e6; border-radius: 6px; page-break-inside: avoid; }
        .pdf-panel h3 { margin: 0; padding: 9px 11px; background: #f5f7f6; font-size: 10px; }
        .pdf-list-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 8px 11px; border-top: 1px solid #edf0ef; }
        .pdf-list-row:first-of-type { border-top: 0; }
        .pdf-list-row span { color: #555; }
        .pdf-list-row strong { text-align: right; }
        .pdf-list-row small { display: block; color: #68716e; font-size: 7.5px; }
        .pdf-table-wrap { overflow: hidden; border: 1px solid #e4e7e6; border-radius: 5px; }
        .pdf-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .pdf-table thead { display: table-header-group; }
        .pdf-table th { padding: 7px 8px; background: #f0f3f2; color: #485652; font-size: 7.4px; font-weight: 800; letter-spacing: .55px; text-align: left; text-transform: uppercase; }
        .pdf-table td { overflow-wrap: anywhere; padding: 7px 8px; border-top: 1px solid #e4e9e7; color: #202624; vertical-align: top; font-size: 8.5px; }
        .pdf-table tr { page-break-inside: avoid; }
        .pdf-table .num { text-align: right; font-weight: 700; }
        .pdf-table .muted { color: #59635f; }
        .pdf-source-row td:first-child { border-left: 3px solid transparent; }
        .pdf-source-nolsaf td:first-child { background: #eaf8f3; border-left-color: #00785a; color: #00664c; }
        .pdf-source-booking td:first-child { background: #edf4ff; border-left-color: #003580; color: #003580; }
        .pdf-source-airbnb td:first-child { background: #fff0f1; border-left-color: #ff5a5f; color: #c9363b; }
        .pdf-source-expedia td:first-child { background: #fff8dc; border-left-color: #f2c94c; color: #243b64; }
        .pdf-source-walkin td:first-child { background: #eef9f4; border-left-color: #288a68; color: #176249; }
        .pdf-source-direct td:first-child { background: #f3f1fb; border-left-color: #6756a5; color: #55448f; }
        .pdf-source-phone td:first-child { background: #fff4e8; border-left-color: #d98126; color: #9b5413; }
        .pdf-source-other td:first-child { background: #f4f5f5; border-left-color: #777f7c; color: #4d5552; }
        .pdf-outlet-row td:first-child { border-left: 3px solid transparent; }
        .pdf-outlet-bar td:first-child { border-left-color: #7653b8; background: #f4f0ff; color: #55378f; }
        .pdf-outlet-restaurant td:first-child { border-left-color: #dc762c; background: #fff2e8; color: #974414; }
        .pdf-outlet-service td:first-child { border-left-color: #2d7ea8; background: #edf7ff; color: #1e6084; }
        .pdf-outlet-legend { display: flex; gap: 14px; margin-bottom: 7px; color: #4f5a56; font-size: 7.5px; font-weight: 700; }
        .pdf-outlet-legend span { display: flex; align-items: center; gap: 5px; }
        .pdf-outlet-legend i { display: block; width: 11px; height: 7px; border-radius: 2px; }
        .pdf-empty { padding: 16px !important; color: #888; text-align: center; }
        .pdf-status { display: inline-block; border-radius: 999px; padding: 2px 6px; background: #eaf8f3; color: #00785a; font-size: 7px; font-weight: 800; text-transform: uppercase; }
        .pdf-status-warn { background: #fff3cd; color: #8a4b00; }
        .pdf-status-danger { background: #ffe7e7; color: #ad1f1f; }
        .pdf-note { margin-top: 14px; padding: 11px 13px; border-left: 3px solid #32d29a; border-radius: 0 4px 4px 0; background: #f1f8f6; color: #50605c; font-size: 8.3px; page-break-inside: avoid; }
        .pdf-control-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 9px; padding: 10px 12px; border: 1px solid #dce4e1; border-radius: 5px; background: #f7faf9; page-break-inside: avoid; }
        .pdf-control-head strong { display: block; font-size: 10px; }
        .pdf-control-head p { margin-top: 2px; color: #56615d; font-size: 8px; }
        .pdf-control-state { border-radius: 4px; padding: 4px 8px; font-size: 7.5px; font-weight: 900; letter-spacing: .55px; text-transform: uppercase; }
        .pdf-control-state-balanced { background: #dff7ed; color: #006b4f; }
        .pdf-control-state-review { background: #fff0c2; color: #8a4b00; }
        .pdf-control-state-failed { background: #ffe2e2; color: #a61b1b; }
        .pdf-control-check { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; padding: 8px 11px; border-top: 1px solid #edf0ef; align-items: center; }
        .pdf-control-check:first-of-type { border-top: 0; }
        .pdf-control-check span { color: #4e5855; }
        .pdf-control-check b { font-size: 7px; text-transform: uppercase; }
        .pdf-control-check .pass { color: #00785a; }
        .pdf-control-check .fail { color: #b42318; }
        .pdf-warning-list { margin: 0; padding: 8px 11px 8px 24px; color: #77500a; font-size: 8px; }
        .pdf-warning-list li + li { margin-top: 4px; }
        .pdf-certification { display: flex; min-height: 930px; flex-direction: column; page-break-before: always; }
        .pdf-certification-head { padding: 18px 0 12px; border-bottom: 2px solid #073c35; background: #fff; color: #17201e; break-inside: avoid; page-break-inside: avoid; page-break-after: avoid; }
        .pdf-certification-head p { color: #00785a; font-size: 8px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; }
        .pdf-certification-head h2 { margin-top: 5px; font-size: 21px; }
        .pdf-certification-body { padding: 22px 24px; }
        .pdf-disclaimer-row { display: grid; grid-template-columns: minmax(0, 1fr) 148px; gap: 12px; align-items: stretch; }
        .pdf-disclaimer { padding: 14px 16px; border: 1px solid #e4dfc4; border-radius: 6px; background: #fffbed; color: #5f5739; font-size: 8.8px; line-height: 1.6; }
        .pdf-disclaimer h3 { margin: 0 0 5px; color: #574a17; font-size: 10px; }
        .pdf-verification-card { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 11px; border: 1px solid #dce5e2; border-radius: 6px; background: #fff; text-align: center; }
        .pdf-qr { display: block; width: 84px; height: 84px; padding: 3px; border: 1px solid #d7e2de; border-radius: 4px; background: #fff; }
        .pdf-verification-card strong { margin-top: 7px; color: #073c35; font-size: 8px; text-transform: uppercase; }
        .pdf-verification-card p { margin-top: 3px; color: #6f7c78; font-size: 7px; line-height: 1.35; }
        .pdf-verification-ref { margin-top: 5px !important; overflow-wrap: anywhere; color: #49605a !important; font-family: Consolas, "Courier New", monospace; font-size: 6.5px !important; font-weight: 700; }
        .pdf-cert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
        .pdf-cert-card { padding: 13px 14px; border: 1px solid #e1e6e4; border-radius: 6px; background: #fafbfb; }
        .pdf-cert-card span { display: block; color: #75807d; font-size: 7px; font-weight: 800; letter-spacing: .65px; text-transform: uppercase; }
        .pdf-cert-card strong { display: block; margin-top: 4px; color: #16211e; font-size: 9.5px; }
        .pdf-signature-title { margin-top: 24px; font-size: 12px; }
        .pdf-signature-note { margin-top: 3px !important; color: #777; font-size: 8px; }
        .pdf-signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 17px; }
        .pdf-signature { min-height: 178px; padding: 13px; border: 1px solid #dfe4e2; border-radius: 6px; page-break-inside: avoid; }
        .pdf-signature h3 { margin: 0; color: #073c35; font-size: 10px; }
        .pdf-signature-line { height: 29px; margin-top: 15px; border-bottom: 1px solid #8d9693; }
        .pdf-signature-label { margin-top: 3px !important; color: #8b9290; font-size: 7px; }
        .pdf-footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 18px; padding-top: 10px; border-top: 1px solid #dfe4e2; color: #56615d; font-size: 7.5px; }
      `}</style>

      <header className="pdf-cover">
        <div className="pdf-cover-top">
          <div className="pdf-mark">
            <span className="pdf-logo">N</span>
            <div className="pdf-mark-copy">
              <p className="pdf-kicker">NRMS management control</p><h1>Property performance report</h1><p className="pdf-property">{data.property.title}</p>
              <div className="pdf-header-barcode"><div className="pdf-barcode-heading"><span className="pdf-barcode-label">Report reference</span><span className="pdf-report-number">{identity.reportNumber}</span></div><Image className="pdf-barcode" src={identity.barcodeDataUrl} alt="Report reference barcode" width={310} height={32} unoptimized /></div>
            </div>
          </div>
          <div className="pdf-report-meta">
            <div><span>Report period</span><strong>{rangeStart} to {rangeEnd}</strong></div>
            <div><span>Generated</span><strong>{generated}</strong></div>
            <div><span>Currency</span><strong>{currencyReport.currency}</strong></div>
            <div><span>Property ID</span><strong>NRMS {data.property.id}</strong></div>
            <div><span>Report pack</span><strong>{selection.label}</strong></div>
            <div><span>Classification</span><strong>Management use</strong></div>
          </div>
        </div>
        <div className="pdf-scope">
          <div><span>Reporting days</span><strong>{data.range.days} days</strong></div>
          <div><span>Revenue sources</span><strong>Rooms, folios, outlets, channels</strong></div>
          <div><span>Control basis</span><strong>Stay-night revenue and recorded transactions</strong></div>
        </div>
      </header>

      <div className="pdf-summary">
        <PdfMetric label="Total revenue" value={money(summary.totalRevenue)} detail="Rooms, folio extras and outlet-paid sales" tone="green" />
        <PdfMetric label="Total collected" value={money(summary.totalCollected)} detail="Guest folio and outlet collections" tone="green" />
        <PdfMetric label="Amount due" value={money(summary.amountDue)} detail={`${outstandingGuests.length} unsettled guest ${outstandingGuests.length === 1 ? "folio" : "folios"}`} tone={summary.amountDue > 0.005 ? "amber" : "green"} />
        <PdfMetric label="Occupancy" value={`${data.occupancy.occupancyRate.toFixed(1)}%`} detail={`${data.occupancy.roomNightsSold} of ${data.occupancy.roomNightsAvailable} available room nights`} />
        <PdfMetric label="Average daily rate" value={occupancyMoney(data.occupancy.adr)} detail={`Room revenue per occupied room night in ${data.occupancy.currency}`} />
        <PdfMetric label="RevPAR" value={occupancyMoney(data.occupancy.revPar)} detail={`Room revenue per available room night in ${data.occupancy.currency}`} />
      </div>

      {hasSection("operations") && <PdfSection number={sectionNumber("operations")} title="Operations at a glance" description="Front desk and outlet position for management review.">
        <div className="pdf-operations">
          {[["Arrivals", data.manager.arrivals], ["Departures", data.manager.departures], ["In house", data.manager.inHouse], ["Open orders", data.manager.openOrders], ["Cancellations", data.manager.cancellations], ["No-shows", data.manager.noShows]].map(([name, value]) => <div className="pdf-operation" key={name}><strong>{value}</strong><span>{name}</span></div>)}
        </div>
      </PdfSection>}

      {hasSection("reconciliation") && <PdfSection number={sectionNumber("reconciliation")} title="Financial source reconciliation" description="A single view of where revenue was earned and where money was collected.">
        <div className="pdf-grid-2">
          <div className="pdf-panel"><h3>Revenue recognized</h3>
            <div className="pdf-list-row"><span>Room stays<small>Stay value allocated to occupied nights in this period</small></span><strong>{money(summary.roomRevenue)}</strong></div>
            <div className="pdf-list-row"><span>Folio extras<small>Guest services charged to rooms</small></span><strong>{money(summary.folioExtras)}</strong></div>
            <div className="pdf-list-row"><span>Paid at outlet<small>Restaurant and bar settled directly</small></span><strong>{money(summary.outletPaidRevenue)}</strong></div>
            <div className="pdf-list-row"><span><b>Total operating revenue</b></span><strong>{money(summary.totalRevenue)}</strong></div>
          </div>
          <div className="pdf-panel"><h3>Collections recorded</h3>
            <div className="pdf-list-row"><span>Current-period stays<small>Folio payments for arrivals in this report period</small></span><strong>{money(timing.currentStayCollections)}</strong></div>
            <div className="pdf-list-row"><span>Current outlet sales<small>Restaurant and bar sales settled in this period</small></span><strong>{money(timing.currentOutletCollections)}</strong></div>
            <div className="pdf-list-row"><span>Older balances settled<small>Payments for stays that arrived before this period</small></span><strong>{money(timing.priorStayCollections)}</strong></div>
            <div className="pdf-list-row"><span>Advance deposits<small>Payments for stays arriving after this period</small></span><strong>{money(timing.advanceDeposits)}</strong></div>
            {timing.unclassifiedCollections > 0 && <div className="pdf-list-row"><span>Unclassified timing<small>Payment timing could not be assigned</small></span><strong>{money(timing.unclassifiedCollections)}</strong></div>}
            <div className="pdf-list-row"><span><b>Total collections</b></span><strong>{money(summary.totalCollected)}</strong></div>
          </div>
        </div>
        <div className="pdf-note"><b>Revenue-to-cash bridge.</b> Period revenue is {money(summary.totalRevenue)} and cash collected is {money(summary.totalCollected)}. Collections are {timing.revenueToCollectionDifference >= 0 ? `${money(timing.revenueToCollectionDifference)} above` : `${money(Math.abs(timing.revenueToCollectionDifference))} below`} recognized revenue because cash can settle older stays or fund future stays. This is a timing explanation, not additional revenue.</div>
        <div className="pdf-grid-2" style={{ marginTop: 10 }}>
          <div className="pdf-panel"><h3>Revenue by department</h3>{currencyReport.departments.length ? currencyReport.departments.map((row) => <div className="pdf-list-row" key={row.department}><span>{label(row.department)}<small>{row.transactions} transactions</small></span><strong>{money(row.amount)}</strong></div>) : <div className="pdf-list-row"><span>No revenue recorded</span><strong>0</strong></div>}</div>
          <div className="pdf-panel"><h3>Collections by payment method</h3>{currencyReport.paymentMethods.length ? currencyReport.paymentMethods.map((row) => <div className="pdf-list-row" key={row.method}><span>{label(row.method)}<small>{row.transactions} transactions</small></span><strong>{money(row.amount)}</strong></div>) : <div className="pdf-list-row"><span>No collections recorded</span><strong>0</strong></div>}</div>
        </div>
      </PdfSection>}

      {hasSection("channels") && <PdfSection number={sectionNumber("channels")} title="Reservation source and platform mix" description="Active stays arriving in the period, attributed to the channel that supplied each reservation.">
        <div className="pdf-table-wrap"><table className="pdf-table"><thead><tr><th style={{ width: "18%" }}>Platform / source</th><th>Reservations</th><th>Reservation share</th><th>Room nights</th><th style={{ textAlign: "right" }}>Booked stay value</th><th>Value share</th><th style={{ textAlign: "right" }}>Folio collected</th><th>Cancelled</th><th>No-show</th></tr></thead><tbody>
          {reservationSources.map((row) => <tr className={`pdf-source-row ${sourceRowClass(row.source)}`} key={`${row.source}-${row.currency}`}><td><b>{label(row.source)}</b></td><td>{row.reservations}</td><td>{row.reservationShare.toFixed(1)}%</td><td>{row.roomNights}</td><td className="num">{money(row.roomRevenue)}</td><td>{row.revenueShare.toFixed(1)}%</td><td className="num">{money(row.folioCollected)}</td><td>{row.cancellations}</td><td>{row.noShows}</td></tr>)}
          {!reservationSources.length && <PdfEmptyRow columns={9} text="No reservation-source records were available for this period." />}
        </tbody></table></div>
        <div className="pdf-note"><b>Channel ratio basis.</b> Reservation and revenue shares use confirmed, checked-in and checked-out stays whose arrival date falls inside the selected report period. Cancellation and no-show columns use the date on which those events were recorded.</div>
      </PdfSection>}

      {hasSection("occupancy") && <PdfSection number={sectionNumber("occupancy")} title="Room and occupancy performance" description="Capacity, room-night use and performance by configured room type.">
        <div className="pdf-table-wrap"><table className="pdf-table"><thead><tr><th style={{ width: "32%" }}>Room type</th><th>Units</th><th>Available nights</th><th>Sold nights</th><th style={{ textAlign: "right" }}>Occupancy</th></tr></thead><tbody>
          {data.occupancy.byRoomType.map((row) => <tr key={row.roomTypeId}><td><b>{row.roomType}</b></td><td>{row.units}</td><td>{row.roomNightsAvailable}</td><td>{row.roomNightsSold}</td><td className="num">{row.occupancyRate.toFixed(1)}%</td></tr>)}
          {!data.occupancy.byRoomType.length && <PdfEmptyRow columns={5} text="No room-type performance is available for this period." />}
        </tbody></table></div>
      </PdfSection>}

      {hasSection("balances") && <PdfSection number={sectionNumber("balances")} title="Guest folio balances" description="Every reservation balance in the selected currency, including outlet-paid spend.">
        <div className="pdf-table-wrap"><table className="pdf-table"><thead><tr><th style={{ width: "22%" }}>Guest / room</th><th style={{ width: "15%" }}>Stay</th><th>Room</th><th>Extras</th><th>Outlet paid</th><th>Total spend</th><th>Collected</th><th>Due</th><th>Status</th></tr></thead><tbody>
          {balances.map((row) => <tr key={row.reservationId}><td><b>{row.guest}</b><br /><span className="muted">{row.room} · #{row.reservationId}</span></td><td>{shortDate(row.checkIn)}<br /><span className="muted">to {shortDate(row.checkOut)}</span></td><td className="num">{money(row.roomAmount)}</td><td className="num">{money(row.folioExtras)}</td><td className="num">{money(row.outletPaid)}</td><td className="num">{money(row.totalSpend)}</td><td className="num">{money(row.totalCollected)}</td><td className="num">{money(row.amountDue)}</td><td><span className={`pdf-status ${row.settlementStatus === "UNPAID" ? "pdf-status-danger" : row.settlementStatus === "PARTIAL" ? "pdf-status-warn" : ""}`}>{label(row.settlementStatus)}</span></td></tr>)}
          {!balances.length && <PdfEmptyRow columns={9} text="No guest folios were recorded in this period." />}
        </tbody></table></div>
      </PdfSection>}

      {hasSection("outlets") && <PdfSection number={sectionNumber("outlets")} title="Outlet sales and settlement" description="Restaurant, bar and service orders linked to the selected report period.">
        <div className="pdf-outlet-legend"><span><i style={{ background: "#7653b8" }} />Bar</span><span><i style={{ background: "#dc762c" }} />Restaurant</span><span><i style={{ background: "#2d7ea8" }} />Other services</span></div>
        <div className="pdf-table-wrap"><table className="pdf-table"><thead><tr><th style={{ width: "17%" }}>Order</th><th style={{ width: "15%" }}>Outlet</th><th style={{ width: "15%" }}>Guest / room</th><th style={{ width: "21%" }}>Items</th><th>Settlement</th><th>Completed</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th></tr></thead><tbody>
          {outlets.map((row) => <tr className={`pdf-outlet-row ${outletPdfRowClass(row.outletType)}`} key={row.id}><td><b>{row.orderNumber}</b></td><td>{row.outlet}<br /><span className="muted">{label(row.outletType)}</span></td><td>{row.guest}<br /><span className="muted">{row.room}</span></td><td>{row.items}</td><td>{label(row.settlementMode)}{row.settlementMode === "OUTLET_PAYMENT" && <><br /><span className="muted">{label(row.settlementMethod || "UNCLASSIFIED")}</span></>}</td><td>{row.completedAt ? dateTime(row.completedAt) : "Not completed"}</td><td className="num">{money(row.total)}</td><td><span className={`pdf-status ${row.status === "VOIDED" || row.status === "CANCELLED" ? "pdf-status-danger" : row.status !== "SETTLED" && row.status !== "POSTED_TO_FOLIO" ? "pdf-status-warn" : ""}`}>{label(row.status)}</span></td></tr>)}
          {!outlets.length && <PdfEmptyRow columns={8} text="No outlet orders were recorded in this period." />}
        </tbody></table></div>
      </PdfSection>}

      {hasSection("payments") && <PdfSection number={sectionNumber("payments")} title="Payment register" description="All guest and outlet payment records used in the collection total.">
        <div className="pdf-table-wrap"><table className="pdf-table"><thead><tr><th style={{ width: "15%" }}>Date and time</th><th style={{ width: "17%" }}>Guest / room</th><th>Source</th><th>Method</th><th>Reference</th><th>Recorded by</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th></tr></thead><tbody>
          {payments.map((row) => <tr key={`${row.type}-${row.id}`}><td>{dateTime(row.occurredAt)}</td><td><b>{row.guest}</b><br /><span className="muted">{row.room}</span></td><td>{label(row.type)}</td><td>{label(row.method)}</td><td>{row.reference || row.referenceNumber || "Not recorded"}</td><td>{row.recordedBy}</td><td className="num">{money(row.amount)}</td><td><span className={`pdf-status ${row.voidedAt ? "pdf-status-danger" : ""}`}>{row.voidedAt ? "Voided" : "Recorded"}</span></td></tr>)}
          {!payments.length && <PdfEmptyRow columns={8} text="No payment records were recorded in this period." />}
        </tbody></table></div>
      </PdfSection>}

      {hasSection("audit") && <PdfSection number={sectionNumber("audit")} title="Audit and exception history" description="Recorded operational changes, voids and accountability events.">
        <div className="pdf-table-wrap"><table className="pdf-table"><thead><tr><th style={{ width: "16%" }}>Date and time</th><th style={{ width: "16%" }}>Action</th><th style={{ width: "17%" }}>Guest / room</th><th>Reference</th><th>Performed by</th><th style={{ width: "23%" }}>Reason</th></tr></thead><tbody>
          {data.audit.rows.map((row) => <tr key={row.id}><td>{dateTime(row.occurredAt)}</td><td><span className={`pdf-status ${row.type.includes("VOID") || row.type === "CANCELLED" ? "pdf-status-danger" : ""}`}>{label(row.type)}</span></td><td><b>{row.guest}</b><br /><span className="muted">{row.room}</span></td><td>{row.referenceNumber || `Reservation #${row.reservationId}`}</td><td>{row.actor}</td><td>{row.reason || "Not recorded"}</td></tr>)}
          {!data.audit.rows.length && <PdfEmptyRow columns={6} text="No auditable events were recorded in this period." />}
        </tbody></table></div>
      </PdfSection>}

      {hasSection("nightAudit") && <PdfSection number={sectionNumber("nightAudit")} title="Night Audit and business-date closing" description={`Control position for business date ${finance.businessDate}.`}>
        <div className="pdf-control-head"><div><strong>{finance.businessDay.status === "CLOSED" ? "Business date closed" : "Business date remains open"}</strong><p>{finance.blockers.length ? `${finance.blockers.length} blocking control ${finance.blockers.length === 1 ? "item" : "items"}` : "All recorded closing blockers cleared"} · Ledger {finance.ledger.balanced ? "balanced" : "not balanced"}</p></div><span className={`pdf-control-state ${finance.businessDay.status === "CLOSED" ? "pdf-control-state-balanced" : "pdf-control-state-review"}`}>{finance.businessDay.status.replaceAll("_", " ")}</span></div>
        {finance.blockers.length > 0 && <div className="pdf-panel" style={{ marginTop: 9 }}><h3>Unresolved closing blockers</h3>{finance.blockers.map((blocker) => <div className="pdf-list-row" key={blocker.code}><span>{blocker.message}</span><strong>{blocker.count}</strong></div>)}</div>}
        <div className="pdf-table-wrap" style={{ marginTop: 9 }}><table className="pdf-table"><thead><tr><th>Business date</th><th>Audit reference</th><th>Status</th><th>Started</th><th>Completed</th></tr></thead><tbody>{finance.nightAudits.map((audit) => <tr key={audit.id}><td>{String(audit.businessDay.businessDate).slice(0, 10)}</td><td><b>{audit.reportNumber}</b></td><td><span className={`pdf-status ${audit.status !== "CLOSED" ? "pdf-status-warn" : ""}`}>{audit.status}</span></td><td>{dateTime(audit.startedAt)}</td><td>{audit.completedAt ? dateTime(audit.completedAt) : "Not completed"}</td></tr>)}{!finance.nightAudits.length && <PdfEmptyRow columns={5} text="No Night Audit run was recorded in this report period." />}</tbody></table></div>
      </PdfSection>}

      {hasSection("cashiers") && <PdfSection number={sectionNumber("cashiers")} title="Cashier shift variance" description="Expected cash compared with the physical cash declared at shift close.">
        <div className="pdf-table-wrap"><table className="pdf-table"><thead><tr><th>Cashier</th><th>Opened</th><th>Closed</th><th style={{ textAlign: "right" }}>Opening float</th><th style={{ textAlign: "right" }}>Expected</th><th style={{ textAlign: "right" }}>Declared</th><th style={{ textAlign: "right" }}>Variance</th><th>Explanation</th></tr></thead><tbody>{cashierShifts.map((shift) => <tr key={shift.id}><td><b>{shift.cashierName}</b><br /><span className="muted">{shift.status}</span></td><td>{dateTime(shift.openedAt)}</td><td>{shift.closedAt ? dateTime(shift.closedAt) : "Open"}</td><td className="num">{money(shift.openingFloat)}</td><td className="num">{money(shift.status === "OPEN" ? shift.liveExpectedCash : shift.expectedCash)}</td><td className="num">{shift.declaredCash == null ? "Pending" : money(shift.declaredCash)}</td><td className="num"><b>{shift.variance == null ? "Pending" : money(shift.variance)}</b></td><td>{shift.closeNote || (shift.status === "CLOSED" ? "Matched" : "Shift not closed")}</td></tr>)}{!cashierShifts.length && <PdfEmptyRow columns={8} text="No cashier shifts were recorded in this report period and currency." />}</tbody></table></div>
      </PdfSection>}

      {hasSection("ledger") && <PdfSection number={sectionNumber("ledger")} title="Accounting ledger" description="Immutable double-entry transactions generated by closed business dates.">
        <div className="pdf-grid-2"><div className="pdf-panel"><h3>Account control totals</h3>{ledgerAccounts.map((account) => <div className="pdf-list-row" key={`${account.accountCode}-${account.currency}`}><span>{account.accountCode} · {account.accountName}<small>{account.accountType}</small></span><strong>{money(Math.abs(account.balance))}</strong></div>)}{!ledgerAccounts.length && <div className="pdf-list-row"><span>No account entries posted</span><strong>0</strong></div>}</div><div className="pdf-panel"><h3>Journal integrity</h3><div className="pdf-list-row"><span>Transactions in period</span><strong>{ledgerTransactions.length}</strong></div><div className="pdf-list-row"><span>Double-entry status</span><strong>{finance.ledger.balanced ? "Balanced" : "Review"}</strong></div><div className="pdf-list-row"><span>Reporting currency</span><strong>{currencyReport.currency}</strong></div></div></div>
        <div className="pdf-table-wrap" style={{ marginTop: 9 }}><table className="pdf-table"><thead><tr><th>Transaction</th><th>Date</th><th>Source</th><th>Description</th><th>Accounts</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th></tr></thead><tbody>{ledgerTransactions.map((transaction) => <tr key={transaction.id}><td><b>{transaction.transactionNumber}</b></td><td>{dateTime(transaction.occurredAt)}</td><td>{label(transaction.sourceType)}</td><td>{transaction.description}</td><td>{transaction.entries.map((entry) => `${entry.accountCode} ${entry.accountName}`).join("; ")}</td><td className="num">{money(transaction.entries.reduce((sum, entry) => sum + Number(entry.debit), 0))}</td><td className="num">{money(transaction.entries.reduce((sum, entry) => sum + Number(entry.credit), 0))}</td></tr>)}{!ledgerTransactions.length && <PdfEmptyRow columns={7} text="No Night Audit ledger transactions were posted in this period." />}</tbody></table></div>
      </PdfSection>}

      {hasSection("tax") && <PdfSection number={sectionNumber("tax")} title="Tax register" description="Tax separately captured in the NRMS accounting ledger for this report period.">
        <div className="pdf-summary" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}><PdfMetric label="Tax payable captured" value={money(taxRows.reduce((sum, row) => sum + row.tax, 0))} detail={`Account 2200 · ${taxRows.length} tax ${taxRows.length === 1 ? "entry" : "entries"}`} tone="green" /><PdfMetric label="Tax data quality" value={taxRows.length ? "Captured" : "No separated tax"} detail="Only explicitly separated reservation tax is reported" tone={taxRows.length ? "green" : "amber"} /></div>
        <div className="pdf-table-wrap"><table className="pdf-table"><thead><tr><th>Transaction</th><th>Date and time</th><th>Tax basis</th><th style={{ textAlign: "right" }}>Tax payable</th></tr></thead><tbody>{taxRows.map((row) => <tr key={row.transactionNumber}><td><b>{row.transactionNumber}</b></td><td>{dateTime(row.occurredAt)}</td><td>{row.description}</td><td className="num"><b>{money(row.tax)}</b></td></tr>)}{!taxRows.length && <PdfEmptyRow columns={4} text="No separately captured tax was posted in this period." />}</tbody></table></div>
        <div className="pdf-note"><b>Tax scope.</b> {finance.tax.note}</div>
      </PdfSection>}

      {hasSection("nbs") && <PdfSection number={sectionNumber("nbs")} title="NBS monthly accommodation statistics" description={`Aggregate accommodation indicators for ${finance.nbs.month}; no guest-identifying details are included.`}>
        <div className="pdf-operations">{[["Physical beds", finance.nbs.bedsAvailable], ["Reporting days", finance.nbs.reportingDays], ["Bed-nights available", finance.nbs.bedNightsAvailable], ["Bed-nights occupied", finance.nbs.bedNightsOccupied], ["Domestic bed-nights", finance.nbs.domesticBedNights], ["International bed-nights", finance.nbs.internationalBedNights]].map(([name, value]) => <div className="pdf-operation" key={name}><strong>{value}</strong><span>{name}</span></div>)}</div>
        <div className="pdf-grid-2" style={{ marginTop: 9 }}><div className="pdf-panel"><h3>Occupancy calculation</h3><div className="pdf-list-row"><span>Occupied room-nights</span><strong>{finance.nbs.roomNightsOccupied}</strong></div><div className="pdf-list-row"><span>Bed occupancy rate</span><strong>{finance.nbs.bedOccupancyRate.toFixed(1)}%</strong></div></div><div className="pdf-panel"><h3>Submission readiness</h3><div className="pdf-list-row"><span>Bed-nights missing nationality</span><strong>{finance.nbs.missingNationalityBedNights}</strong></div><div className="pdf-list-row"><span>Data status</span><strong>{finance.nbs.missingNationalityBedNights ? "Complete missing nationality" : "Ready for review"}</strong></div></div></div>
        <div className="pdf-note"><b>Method.</b> {finance.nbs.methodology}</div>
      </PdfSection>}

      {hasSection("assurance") && <PdfSection number={sectionNumber("assurance")} title="Report control assurance" description="Automated reconciliation, accounting basis and source-record completeness checks.">
        <div className="pdf-control-head">
          <div><strong>{data.control.status === "BALANCED" ? "Automated controls balanced" : data.control.status === "REVIEW" ? "Management review required" : "Automated control failure"}</strong><p>{currencyChecks.filter((check) => check.passed).length} of {currencyChecks.length} financial checks passed · {data.control.warnings.length} data-quality {data.control.warnings.length === 1 ? "warning" : "warnings"}</p></div>
          <span className={`pdf-control-state pdf-control-state-${controlTone}`}>{data.control.status}</span>
        </div>
        <div className="pdf-grid-2">
          <div className="pdf-panel"><h3>Financial reconciliation</h3>{currencyChecks.map((check) => <div className="pdf-control-check" key={`${check.currency}-${check.key}`}><span>{check.label}</span><small>{check.difference === 0 ? "No difference" : money(Math.abs(check.difference))}</small><b className={check.passed ? "pass" : "fail"}>{check.passed ? "Passed" : "Failed"}</b></div>)}</div>
          <div className="pdf-panel"><h3>Recognition and control basis</h3><div className="pdf-list-row"><span>Room revenue<small>Proportional stay value by occupied night</small></span><strong>Stay-night</strong></div><div className="pdf-list-row"><span>Folio extras / outlets<small>Posting time / settlement time</small></span><strong>Recorded event</strong></div><div className="pdf-list-row"><span>Collections / channels<small>Receipt time / arrival date</small></span><strong>EAT</strong></div></div>
        </div>
        <div className="pdf-grid-2" style={{ marginTop: 10 }}>
          <div className="pdf-panel"><h3>Source records included</h3><div className="pdf-list-row"><span>Reservations / revenue stays</span><strong>{data.control.recordCounts.reservations} / {data.control.recordCounts.stayRevenueReservations}</strong></div><div className="pdf-list-row"><span>Folio charges / payments</span><strong>{data.control.recordCounts.folioCharges} / {data.control.recordCounts.payments}</strong></div><div className="pdf-list-row"><span>Outlet orders / audit events</span><strong>{data.control.recordCounts.outletOrders} / {data.control.recordCounts.auditEvents}</strong></div></div>
          <div className="pdf-panel"><h3>Data-quality review</h3>{data.control.warnings.length ? <ul className="pdf-warning-list">{data.control.warnings.map((warning) => <li key={warning.key}>{warning.label}: <b>{warning.count}</b></li>)}</ul> : <div className="pdf-list-row"><span>No completeness exceptions detected</span><strong>Clear</strong></div>}</div>
        </div>
      </PdfSection>}

      {(hasSection("reconciliation") || hasSection("channels") || hasSection("occupancy") || hasSection("balances") || hasSection("outlets") || hasSection("payments")) && <div className="pdf-note"><b>Revenue control note.</b> Room revenue is allocated proportionally to occupied nights inside the report period. Folio extras use posting time and paid-at-outlet revenue uses settlement time. Channel production remains arrival-date based. Orders posted to a room folio appear in folio extras and are not counted again as outlet-paid revenue.</div>}

      {hasSection("certification") && <section className="pdf-certification">
        <header className="pdf-certification-head"><p>{sectionNumber("certification")} · NRMS report control</p><h2>Certification, disclaimer and sign-off</h2></header>
        <div className="pdf-certification-body">
          <div className="pdf-disclaimer-row">
            <div className="pdf-disclaimer"><h3>Important disclaimer</h3>This is an operational management report, not a tax invoice, audited financial statement or statutory filing. Its accuracy depends on the transactions recorded in NRMS by authorized users. Corrections must be made in the originating transaction, then the report generated again.</div>
            <aside className="pdf-verification-card"><Image className="pdf-qr" src={identity.qrDataUrl} alt="Report verification QR code" width={84} height={84} unoptimized /><strong>{identity.verificationMode === "SEALED" ? "Verify report" : "Reference QR"}</strong><p>{identity.verificationMode === "SEALED" ? "Scan to confirm the signed report snapshot." : "Scan to read the report identity."}</p><p className="pdf-verification-ref">{identity.reportNumber}</p></aside>
          </div>

          <div className="pdf-cert-grid">
            <div className="pdf-cert-card"><span>Report number</span><strong>{identity.reportNumber}</strong></div>
            <div className="pdf-cert-card"><span>Verification status</span><strong>{identity.verificationMode === "SEALED" ? "Digitally sealed and QR-verifiable" : "Reference identity only"}</strong></div>
            <div className="pdf-cert-card"><span>Generated by</span><strong>{identity.generatedBy} · {identity.generatedByRole}</strong></div>
            <div className="pdf-cert-card"><span>Generated at</span><strong>{generated}</strong></div>
          </div>

          <h2 className="pdf-signature-title">Optional authorization signatures</h2>
          <p className="pdf-signature-note">Complete these fields only when internal policy, audit, banking or an external authority requires manual sign-off.</p>
          <div className="pdf-signatures">
            {["Prepared by", "Reviewed by", "Property authorization"].map((title) => <div className="pdf-signature" key={title}><h3>{title}</h3><div className="pdf-signature-line" /><p className="pdf-signature-label">Full name and title</p><div className="pdf-signature-line" /><p className="pdf-signature-label">Signature</p><div className="pdf-signature-line" /><p className="pdf-signature-label">Date and official stamp, if required</p></div>)}
          </div>
        </div>
        <footer className="pdf-footer" style={{ marginTop: "auto" }}><span>Generated from NRMS recorded property operations. Keep with supporting source documents.</span><strong>{data.property.title} · {identity.reportNumber}</strong></footer>
      </section>}
    </article>
  );
}

export default function NrmsReportsPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [activeReport, setActiveReport] = useState<ReportKey>("manager");
  const [activePreset, setActivePreset] = useState<RangePreset | null>("month");
  const [draftRange, setDraftRange] = useState(initialRange);
  const [range, setRange] = useState(initialRange);
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [financeData, setFinanceData] = useState<FinanceControlResponse | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfIdentity, setPdfIdentity] = useState<PdfIdentity | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [activePdfSelection, setActivePdfSelection] = useState<PdfPackSelection | null>(null);
  // Browser print renders the same markup as vector text instead of a bitmap. When set, the report
  // is portalled to document.body so the print stylesheet can isolate it from the rest of the page.
  const [printMode, setPrintMode] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const pdfRef = useRef<HTMLDivElement | null>(null);

  const loadReports = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const [response, financeResponse] = await Promise.all([
        apiClient.get<ReportsResponse>(`/api/owner/nrms/reports/property/${selectedPropertyId}`, { params: range }),
        apiClient.get<FinanceControlResponse>(`/api/owner/nrms/finance/property/${selectedPropertyId}`, { params: { businessDate: range.to, from: range.from, to: range.to, month: range.to.slice(0, 7) } }),
      ]);
      setData(response.data);
      setFinanceData(financeResponse.data);
      setSelectedCurrency((current) => response.data.currencies.some((item) => item.currency === current) ? current : response.data.currencies[0]?.currency ?? selectedProperty?.currency ?? "");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Failed to generate reports");
      setData(null);
      setFinanceData(null);
    } finally {
      setLoading(false);
    }
  }, [range, selectedProperty?.currency, selectedPropertyId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const currencyReport = useMemo(() => data?.currencies.find((item) => item.currency === selectedCurrency) ?? data?.currencies[0] ?? null, [data, selectedCurrency]);
  const currency = currencyReport?.currency ?? selectedCurrency;
  const formatMoney = useMemo(() => moneyFormatter(currency), [currency]);
  const money = useCallback((value: number) => formatMoney.format(value), [formatMoney]);

  const filteredBalances = useMemo(() => (data?.guestBalances ?? []).filter((row) => row.currency === currency), [currency, data]);
  const filteredPayments = useMemo(() => (data?.payments.rows ?? []).filter((row) => row.currency === currency), [currency, data]);
  const filteredOutlets = useMemo(() => (data?.outlets.rows ?? []).filter((row) => row.currency === currency), [currency, data]);

  const applyPreset = (preset: RangePreset) => {
    const today = new Date();
    const from = preset === "today"
      ? today
      : preset === "month"
        ? new Date(today.getFullYear(), today.getMonth(), 1)
        : preset === "year"
          ? new Date(today.getFullYear(), 0, 1)
          : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 89);
    const next = { from: localDateKey(from), to: localDateKey(today) };
    setActivePreset(preset);
    setDraftRange(next);
    setRange(next);
  };

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Exports carry the same sealed reference as the PDF so a spreadsheet can be tied back to the
   * document it came from. If sealing is unavailable the export still proceeds, marked REFERENCE.
   */
  const buildExportIdentity = async (): Promise<WorkbookIdentity> => {
    const generatedAt = new Date();
    const fallback: WorkbookIdentity = {
      reportNumber: data ? buildReportNumber(data, generatedAt) : "NRMS-R",
      generatedAt: generatedAt.toISOString(),
      generatedBy: "Authenticated NRMS user",
      generatedByRole: "PROPERTY USER",
      verificationMode: "REFERENCE",
    };
    if (!data || !currencyReport) return fallback;
    try {
      const response = await fetch("/api/reports/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "NRMS_PROPERTY",
          title: "NRMS Property Performance Report",
          ref: fallback.reportNumber,
          from: data.range.from,
          to: data.range.to,
          figures: [
            { label: "Property", value: data.property.title },
            { label: "Currency", value: currencyReport.currency },
            { label: "Total revenue", value: money(currencyReport.summary.totalRevenue) },
            { label: "Total collected", value: money(currencyReport.summary.totalCollected) },
            { label: "Amount due", value: money(currencyReport.summary.amountDue) },
            { label: "Occupancy", value: `${data.occupancy.occupancyRate.toFixed(1)}%` },
          ],
        }),
      });
      if (!response.ok) return fallback;
      const sealed = await response.json() as { ref?: string; generatedAt?: string; generatedBy?: string; role?: string; token?: string };
      if (!sealed.token) return fallback;
      return {
        reportNumber: String(sealed.ref || fallback.reportNumber),
        generatedAt: String(sealed.generatedAt || fallback.generatedAt),
        generatedBy: String(sealed.generatedBy || fallback.generatedBy),
        generatedByRole: String(sealed.role || fallback.generatedByRole),
        verificationMode: "SEALED",
      };
    } catch {
      return fallback;
    }
  };

  const workbookInput = (identity: WorkbookIdentity): WorkbookInput | null => {
    if (!data || !financeData || !currencyReport) return null;
    return { data, finance: financeData, currencyReport, identity, label };
  };

  const exportWorkbook = async () => {
    if (!data || !financeData || !currencyReport || exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const identity = await buildExportIdentity();
      const input = workbookInput(identity);
      if (!input) throw new Error("The report data is not ready yet.");
      const charts = await renderReportCharts(input);
      const blob = await buildReportWorkbook(input, charts);
      const propertyName = data.property.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "property";
      saveBlob(blob, `NRMS-${propertyName}-${data.range.from}-to-${data.range.to}-${identity.reportNumber}.xlsx`);
    } catch (workbookError) {
      console.error("NRMS workbook export failed", workbookError);
      setExportError(workbookError instanceof Error ? workbookError.message : "The Excel export could not be created.");
    } finally {
      setExportBusy(false);
    }
  };

  const generatePdf = async (selection: PdfPackSelection, mode: PdfOutputMode = "download") => {
    if (!data || !financeData || !currencyReport || pdfBusy) return;
    setPrintDialogOpen(false);
    setActivePdfSelection(selection);
    setPrintMode(mode === "print");
    setPdfBusy(true);
    setPdfError(null);
    try {
      const generatedAt = new Date();
      let reportNumber = buildReportNumber(data, generatedAt);
      let sealedGeneratedAt = generatedAt.toISOString();
      let generatedBy = "Authenticated NRMS user";
      let generatedByRole = "PROPERTY USER";
      let verificationToken: string | null = null;

      try {
        const sealResponse = await fetch("/api/reports/seal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            kind: "NRMS_PROPERTY",
            title: "NRMS Property Performance Report",
            ref: reportNumber,
            from: data.range.from,
            to: data.range.to,
            figures: [
              { label: "Property", value: data.property.title },
              { label: "Currency", value: currencyReport.currency },
              { label: "Total revenue", value: money(currencyReport.summary.totalRevenue) },
              { label: "Total collected", value: money(currencyReport.summary.totalCollected) },
              { label: "Current-period collections", value: money(currencyReport.collectionTiming.currentPeriodCollections) },
              { label: "Prior-stay collections", value: money(currencyReport.collectionTiming.priorStayCollections) },
              { label: "Advance deposits", value: money(currencyReport.collectionTiming.advanceDeposits) },
              { label: "Amount due", value: money(currencyReport.summary.amountDue) },
              { label: "Occupancy", value: `${data.occupancy.occupancyRate.toFixed(1)}%` },
              { label: "Guest folios", value: String(data.guestBalances.filter((row) => row.currency === currencyReport.currency).length) },
              { label: "Outlet orders", value: String(data.outlets.rows.filter((row) => row.currency === currencyReport.currency).length) },
              { label: "Active reservation channels", value: String(data.reservationSources.filter((row) => row.currency === currencyReport.currency && row.reservations > 0).length) },
              { label: "Channel-attributed reservations", value: String(data.reservationSources.filter((row) => row.currency === currencyReport.currency).reduce((sum, row) => sum + row.reservations, 0)) },
              { label: "Automated control status", value: data.control.status },
              { label: "Financial checks passed", value: `${data.control.financialChecks.filter((check) => check.currency === currencyReport.currency && check.passed).length}/${data.control.financialChecks.filter((check) => check.currency === currencyReport.currency).length}` },
              { label: "Data-quality warnings", value: String(data.control.warnings.length) },
              { label: "Room revenue basis", value: "Stay-night allocation" },
              { label: "Report pack", value: selection.label },
              { label: "Included sections", value: String(selection.sections.length) },
              { label: "Business-date status", value: financeData.businessDay.status },
              { label: "Ledger balanced", value: financeData.ledger.balanced ? "Yes" : "No" },
              { label: "Tax entries", value: String(financeData.tax.rows.filter((row) => row.currency === currencyReport.currency).length) },
              { label: "Cashier shifts", value: String(financeData.shifts.filter((shift) => shift.currency === currencyReport.currency).length) },
            ],
          }),
        });
        if (!sealResponse.ok) throw new Error("Report sealing was not available.");
        const sealed = await sealResponse.json() as { token?: string; ref?: string; generatedAt?: string; generatedBy?: string; role?: string };
        if (!sealed.token) throw new Error("The report seal was not returned.");
        verificationToken = sealed.token;
        reportNumber = String(sealed.ref || reportNumber);
        sealedGeneratedAt = String(sealed.generatedAt || sealedGeneratedAt);
        generatedBy = String(sealed.generatedBy || generatedBy);
        generatedByRole = String(sealed.role || generatedByRole);
      } catch (sealError) {
        console.warn("NRMS report sealing unavailable; using reference QR", sealError);
      }

      const verificationPayload = verificationToken
        ? `${window.location.origin}/verify?t=${encodeURIComponent(verificationToken)}`
        : `NRMS|REPORT|${reportNumber}|PROPERTY:${data.property.id}|${data.range.from}|${data.range.to}|${currencyReport.currency}|PACK:${selection.key}`;
      const [qrModule, barcodeModule] = await Promise.all([import("qrcode"), import("jsbarcode")]);
      const toDataUrl = qrModule.toDataURL ?? qrModule.default?.toDataURL;
      const renderBarcode = barcodeModule.default;
      if (typeof toDataUrl !== "function" || typeof renderBarcode !== "function") throw new Error("The report code generators could not be loaded.");

      const qrDataUrl = await toDataUrl(verificationPayload, { margin: 1, width: 220, errorCorrectionLevel: "M", color: { dark: "#073c35", light: "#ffffff" } });
      const barcodeCanvas = document.createElement("canvas");
      renderBarcode(barcodeCanvas, reportNumber, { format: "CODE128", width: 1.35, height: 42, displayValue: false, margin: 0, background: "#ffffff", lineColor: "#073c35" });
      const barcodeDataUrl = barcodeCanvas.toDataURL("image/png");
      const identity: PdfIdentity = {
        reportNumber,
        generatedAt: sealedGeneratedAt,
        generatedBy,
        generatedByRole,
        barcodeDataUrl,
        qrDataUrl,
        verificationMode: verificationToken ? "SEALED" : "REFERENCE",
      };
      setPdfIdentity(identity);

      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!pdfRef.current) throw new Error("The printable report could not be prepared.");
      await Promise.all(Array.from(pdfRef.current.querySelectorAll("img")).map((image) => image.complete ? Promise.resolve() : image.decode()));

      if (mode === "print") {
        // Hand the live DOM to the browser's own PDF writer. Text stays as font outlines, so the
        // output is resolution-independent and searchable, at a fraction of the rasterised size.
        document.body.classList.add("nrms-printing");
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            window.removeEventListener("afterprint", finish);
            window.clearTimeout(fallback);
            resolve();
          };
          // Most browsers block on print() and then fire afterprint, but neither is guaranteed,
          // so the timeout makes sure the print class is always cleaned up.
          const fallback = window.setTimeout(finish, 60_000);
          window.addEventListener("afterprint", finish);
          window.print();
        });
        document.body.classList.remove("nrms-printing");
        return;
      }

      const html2pdfModule = await import("html2pdf.js");
      const html2pdf = html2pdfModule && (html2pdfModule.default || html2pdfModule);
      if (!html2pdf) throw new Error("The PDF generator could not be loaded.");
      const propertyName = data.property.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "property";
      // html2pdf rasterises the whole report into one canvas before slicing it into pages, so the
      // usable scale is bounded by the browser canvas limits (32767px per side, ~268Mpx of area)
      // rather than by row count. Measuring the rendered element keeps ordinary reports at full
      // sharpness and only steps down when a report is genuinely long enough to need it.
      const pdfWidthPx = pdfRef.current.scrollWidth || 718;
      const pdfHeightPx = pdfRef.current.scrollHeight || 1;
      const scaleBySide = 32000 / pdfHeightPx;
      const scaleByArea = Math.sqrt(240_000_000 / (pdfWidthPx * pdfHeightPx));
      // No lower floor: these are hard browser limits, not preferences. Exceeding them yields a
      // failed or blank canvas, which is worse than a long report rendering at a reduced scale.
      const canvasScale = Math.min(2.75, scaleBySide, scaleByArea);
      const pdfOptions = {
        filename: `NRMS-${propertyName}-${selection.key}-${reportNumber}.pdf`,
        margin: [8, 10, 10, 10] as [number, number, number, number],
        // PNG is lossless. JPEG's chroma subsampling and DCT ringing are what smeared the small
        // text; on a flat, mostly-white document PNG also compresses better than high-quality JPEG.
        image: { type: "png" as const, quality: 1 },
        html2canvas: { scale: canvasScale, useCORS: true, logging: false, backgroundColor: "#ffffff", windowWidth: pdfWidthPx, imageTimeout: 0, removeContainer: true },
        jsPDF: { unit: "mm" as const, format: "a4", orientation: "portrait" as const, compress: true },
        pagebreak: { mode: ["css", "legacy"], avoid: [".pdf-metric", ".pdf-panel", ".pdf-grid-2", ".pdf-section-title", ".pdf-certification-head", "tr"] },
      };
      const pdfWorker = html2pdf().from(pdfRef.current).set(pdfOptions).toPdf();
      const pdfDocument = await pdfWorker.get("pdf");
      pdfDocument.setProperties({
        title: `${data.property.title} - ${selection.label}`,
        subject: `NRMS ${selection.label.toLowerCase()} for ${data.range.from} to ${data.range.to}`,
        author: identity.generatedBy,
        keywords: `NRMS,hotel,property report,${identity.reportNumber},${currencyReport.currency}`,
        creator: "NRMS Property Reporting Centre",
      });
      pdfDocument.setCreationDate(new Date(identity.generatedAt));
      const pageCount = pdfDocument.internal.getNumberOfPages();
      const pageWidth = pdfDocument.internal.pageSize.getWidth();
      const pageHeight = pdfDocument.internal.pageSize.getHeight();
      for (let page = 1; page <= pageCount; page += 1) {
        pdfDocument.setPage(page);
        pdfDocument.setDrawColor(214, 222, 219);
        pdfDocument.setLineWidth(0.2);
        pdfDocument.line(10, pageHeight - 6.5, pageWidth - 10, pageHeight - 6.5);
        pdfDocument.setFont("helvetica", "normal");
        pdfDocument.setFontSize(7);
        pdfDocument.setTextColor(93, 105, 101);
        pdfDocument.text(reportNumber, 10, pageHeight - 3.5);
        pdfDocument.text(`Page ${page} of ${pageCount}`, pageWidth - 10, pageHeight - 3.5, { align: "right" });
      }
      await pdfWorker.save();
    } catch (pdfGenerationError) {
      console.error("NRMS PDF generation failed", pdfGenerationError);
      setPdfError(pdfGenerationError instanceof Error ? pdfGenerationError.message : "Unable to generate the PDF report. Please try again.");
    } finally {
      document.body.classList.remove("nrms-printing");
      setPdfIdentity(null);
      setActivePdfSelection(null);
      setPrintMode(false);
      setPdfBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4 pb-10 print:max-w-none">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-neutral-200 bg-white px-4 py-4 shadow-sm sm:px-5 print:border-0 print:shadow-none">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#073c35] text-white"><FileText className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS reports</p>
            <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">Property reporting centre</h1>
            <p className="mb-0 mt-1 text-xs text-neutral-500">Operational, financial and audit reports for {selectedProperty?.title ?? "the selected property"}.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button type="button" onClick={() => void exportWorkbook()} disabled={!data || !financeData || loading || exportBusy} title="Multi-sheet Excel workbook arranged on USALI lines, with STR performance statistics and charts" className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-700 transition hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-40">{exportBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}{exportBusy ? "Building" : "Export Excel"}</button>
          <button type="button" onClick={() => setPrintDialogOpen(true)} disabled={!data || loading || pdfBusy} className="inline-flex h-9 min-w-[116px] items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-700 transition hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-40">{pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}{pdfBusy ? "Preparing PDF" : "Print / PDF"}</button>
        </div>
      </header>

      {pdfError && <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"><AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1">{pdfError}</span><button type="button" onClick={() => setPdfError(null)} aria-label="Dismiss PDF error" className="inline-flex h-7 w-7 items-center justify-center rounded-lg border-0 bg-red-100 text-red-800"><X className="h-3.5 w-3.5" /></button></div>}

      {exportError && <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"><AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1">{exportError}</span><button type="button" onClick={() => setExportError(null)} aria-label="Dismiss export error" className="inline-flex h-7 w-7 items-center justify-center rounded-lg border-0 bg-red-100 text-red-800"><X className="h-3.5 w-3.5" /></button></div>}

      {/* Mounted only while a print is in flight, so the existing plain Ctrl+P behaviour of this
          page and its `print:` utility classes are left completely untouched. */}
      {printMode && <style>{`
        /* The report body is 718px, which is exactly the printable width of A4 at 96dpi with 10mm
           side margins, so the print layout maps 1:1 with no browser scaling. */
        @page { size: A4 portrait; margin: 8mm 10mm 10mm 10mm; }
        @media print {
          body.nrms-printing > *:not(#nrms-print-root) { display: none !important; }
          body.nrms-printing #nrms-print-root { display: block !important; }
          body.nrms-printing { background: #fff !important; }
          #nrms-print-root .pdf-metric,
          #nrms-print-root .pdf-panel,
          #nrms-print-root .pdf-grid-2,
          #nrms-print-root .pdf-section-title,
          #nrms-print-root .pdf-certification-head,
          #nrms-print-root tr { break-inside: avoid; page-break-inside: avoid; }
          #nrms-print-root thead { display: table-header-group; }
        }
        /* Keeps the report off the screen in the moment between mounting it and the dialog opening. */
        #nrms-print-root { display: none; }
      `}</style>}

      {pdfIdentity && activePdfSelection && data && financeData && currencyReport && (() => {
        const reportNode = <div ref={pdfRef}><ConsolidatedPdfReport data={data} finance={financeData} currencyReport={currencyReport} identity={pdfIdentity} money={money} selection={activePdfSelection} /></div>;
        // Printing needs the report as a direct child of body so the stylesheet above can hide its
        // siblings; the download path keeps rendering it offscreen exactly as before.
        return printMode && typeof document !== "undefined"
          ? createPortal(<div id="nrms-print-root">{reportNode}</div>, document.body)
          : <div className="pointer-events-none fixed left-[-12000px] top-0 z-[-1]" aria-hidden="true">{reportNode}</div>;
      })()}

      <PrintPackDialog open={printDialogOpen} busy={pdfBusy} currentReport={activeReport} onClose={() => setPrintDialogOpen(false)} onGenerate={(selection, mode) => void generatePdf(selection, mode)} />

      <section className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm print:hidden" aria-label="Report controls">
        <div className="mx-auto flex w-max min-w-max items-center justify-center gap-2">
          <ReportSelector value={activeReport} onChange={setActiveReport} />

          <span className="h-7 w-px shrink-0 bg-neutral-200" aria-hidden />

          <div className="inline-flex h-10 shrink-0 items-center gap-0.5 rounded-xl bg-neutral-100 p-1" aria-label="Quick report periods">
            {([[
              "today", "Today",
            ], ["month", "This month"], ["90d", "90 days"], ["year", "This year"]] as Array<[RangePreset, string]>).map(([key, text]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                aria-pressed={activePreset === key}
                className={`h-8 rounded-lg border-0 px-2 text-[10px] font-bold transition ${activePreset === key ? "bg-emerald-100 text-emerald-900 shadow-sm" : "bg-transparent text-neutral-500 hover:bg-white hover:text-neutral-900"}`}
              >
                {text}
              </button>
            ))}
          </div>

          <span className="hidden h-7 w-px bg-neutral-200 xl:block" aria-hidden />

          <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50/70 p-1">
            <div className="flex h-10 items-center gap-1">
              <span className="pl-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">From</span>
              <div className="w-[138px]">
                <DatePickerField
                  label="Report start date"
                  value={draftRange.from}
                  max={draftRange.to}
                  onChangeAction={(next) => {
                    setActivePreset(null);
                    setDraftRange((current) => ({ ...current, from: next }));
                  }}
                  widthClassName="!w-full"
                  size="sm"
                  twoMonths={false}
                  allowPast
                />
              </div>
            </div>
            <span className="hidden h-6 w-px bg-neutral-200 sm:block" aria-hidden />
            <div className="flex h-10 items-center gap-1">
              <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">To</span>
              <div className="w-[138px]">
                <DatePickerField
                  label="Report end date"
                  value={draftRange.to}
                  min={draftRange.from}
                  onChangeAction={(next) => {
                    setActivePreset(null);
                    setDraftRange((current) => ({ ...current, to: next }));
                  }}
                  widthClassName="!w-full"
                  size="sm"
                  twoMonths={false}
                  allowPast
                />
              </div>
            </div>
          </div>

          <button type="button" onClick={() => setRange(draftRange)} disabled={!draftRange.from || !draftRange.to || draftRange.from > draftRange.to || loading} className="inline-flex h-10 items-center gap-2 rounded-xl border-0 bg-[#073c35] px-3.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:bg-neutral-300 disabled:shadow-none"><CalendarCheck2 className="h-4 w-4" />Run report</button>

          {data && data.currencies.length > 1 && <label className="inline-flex"><span className="sr-only">Currency</span><select value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)} className="box-border h-10 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10">{data.currencies.map((item) => <option key={item.currency}>{item.currency}</option>)}</select></label>}

          <button type="button" onClick={() => void loadReports()} disabled={loading} aria-label="Refresh reports" title="Refresh report data" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </section>

      {error && <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1">{error}</span><button type="button" onClick={() => void loadReports()} className="rounded-lg border-0 bg-red-100 px-3 py-1.5 text-xs font-bold text-red-800">Try again</button></div>}

      <section className="min-w-0 print:block">
        <div className="min-w-0">
          {loading && !data ? <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-neutral-200 bg-white text-sm text-neutral-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Generating property reports…</div> : data && currencyReport ? (
            <div className="space-y-4">
              <div className="hidden items-center justify-between border-b border-neutral-200 pb-3 print:flex"><div><strong className="text-base">{REPORTS.find((report) => report.key === activeReport)?.label}</strong><p className="m-0 text-xs text-neutral-500">{data.property.title} · {data.range.from} to {data.range.to}</p></div><span className="text-xs font-bold text-neutral-500">{currency}</span></div>
              {activeReport === "manager" && <ManagerReport data={data} currencyReport={currencyReport} money={money} />}
              {activeReport === "revenue" && <RevenueReport data={data} currencyReport={currencyReport} money={money} />}
              {activeReport === "payments" && <PaymentsReport data={data} rows={filteredPayments} currencyReport={currencyReport} money={money} />}
              {activeReport === "balances" && <BalancesReport rows={filteredBalances} currencyReport={currencyReport} money={money} />}
              {activeReport === "occupancy" && <OccupancyReport data={data} />}
              {activeReport === "outlets" && <OutletReport rows={filteredOutlets} money={money} />}
              {activeReport === "audit" && <AuditReport rows={data.audit.rows} />}
              <p className="m-0 px-1 text-[10px] leading-4 text-neutral-400 print:hidden">Report period: {shortDate(`${data.range.from}T00:00:00+03:00`)} to {shortDate(`${data.range.to}T00:00:00+03:00`)}. Saved transactions are read-only here; corrections must be made through their original folio, payment or outlet record.</p>
            </div>
          ) : !error ? <EmptyReport title="No report data" text="There are no reportable NRMS records for this period." /> : null}
        </div>
      </section>
    </main>
  );
}

function PrintPackDialog({ open, busy, currentReport, onClose, onGenerate }: { open: boolean; busy: boolean; currentReport: ReportKey; onClose: () => void; onGenerate: (selection: PdfPackSelection, mode: PdfOutputMode) => void }) {
  const fullPack = PDF_PACKS[0];
  const [packKey, setPackKey] = useState<PdfPackKey>(fullPack.key);
  const [sections, setSections] = useState<PdfSectionKey[]>(fullPack.sections);
  const currentReportDefinition = REPORTS.find((report) => report.key === currentReport) ?? REPORTS[0];
  const currentPack: PdfPackSelection & { description: string } = { key: "current", label: `${currentReportDefinition.label} report`, description: "Print the report currently open, with required control pages", sections: CURRENT_REPORT_PDF_SECTIONS[currentReport] };
  const availablePacks = [currentPack, ...PDF_PACKS];
  const effectiveSections = packKey === "current" ? currentPack.sections : sections;

  const choosePack = (pack: PdfPackSelection) => {
    setPackKey(pack.key);
    setSections([...pack.sections]);
  };

  const toggleSection = (section: PdfSectionKey) => {
    if (REQUIRED_PDF_SECTIONS.includes(section)) return;
    setPackKey("custom");
    setSections(effectiveSections.includes(section) ? effectiveSections.filter((item) => item !== section) : [...effectiveSections, section]);
  };

  const selectedPack = availablePacks.find((pack) => pack.key === packKey);
  const selection: PdfPackSelection = {
    key: packKey,
    label: selectedPack?.label ?? "Custom report pack",
    sections: PDF_SECTION_OPTIONS.map((section) => section.key).filter((section) => effectiveSections.includes(section) || REQUIRED_PDF_SECTIONS.includes(section)),
  };
  const optionalCount = selection.sections.filter((section) => !REQUIRED_PDF_SECTIONS.includes(section)).length;

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} className="relative z-[10000]">
      <DialogBackdrop className="fixed inset-0 bg-neutral-950/45 backdrop-blur-[2px]" />
      <div className="fixed inset-0 overflow-y-auto p-3 sm:p-5">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel className="w-full max-w-[900px] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_30px_90px_-30px_rgba(15,23,42,0.65)]">
            <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#073c35] text-white"><Printer className="h-4 w-4" /></span>
                <div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS report pack</p><DialogTitle className="mb-0 mt-1 text-base font-bold text-neutral-950">Choose what the PDF should contain</DialogTitle><p className="mb-0 mt-1 text-[11px] text-neutral-500">Start with a prepared pack or select the sections required for this recipient.</p></div>
              </div>
              <button type="button" onClick={onClose} disabled={busy} aria-label="Close print options" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"><X className="h-4 w-4" /></button>
            </header>

            <div className="grid max-h-[70vh] overflow-y-auto lg:grid-cols-[0.8fr_1.2fr]">
              <section className="border-b border-neutral-200 bg-neutral-50/70 p-4 lg:border-b-0 lg:border-r">
                <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Prepared packs</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  {availablePacks.map((pack) => {
                    const selected = pack.key === packKey;
                    return <button key={pack.key} type="button" onClick={() => choosePack(pack)} aria-pressed={selected} className={`w-full rounded-lg border p-3 text-left transition ${selected ? "border-emerald-600 bg-emerald-50 shadow-sm" : "border-neutral-200 bg-white hover:border-emerald-200"}`}><span className="flex items-center justify-between gap-3"><strong className={`text-xs ${selected ? "text-emerald-900" : "text-neutral-900"}`}>{pack.label}</strong>{selected && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-white"><Check className="h-3 w-3" /></span>}</span><span className="mt-1 block text-[10px] leading-4 text-neutral-500">{pack.description}</span><span className="mt-2 block text-[9px] font-bold uppercase tracking-wide text-neutral-400">{pack.sections.length} sections</span></button>;
                  })}
                </div>
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[10px] leading-4 text-blue-900"><strong>Live control sources:</strong> these packs now include reservations, folios, payments, rooms, outlets, cashier shifts, closed accounting journals, tax entries, Night Audit runs and monthly NBS statistics. Immigration remains a separate restricted workflow.</div>
              </section>

              <section className="p-4">
                <div className="flex items-end justify-between gap-3"><div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Included sections</p><p className="mb-0 mt-1 text-[11px] text-neutral-500">Selecting or removing a section creates a custom pack.</p></div><span className="shrink-0 rounded-md bg-neutral-100 px-2 py-1 text-[9px] font-bold text-neutral-600">{optionalCount} selected + 2 controls</span></div>
                <div className="mt-3 rounded-lg border border-neutral-200">
                  <div className="flex items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-white"><FileText className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><p className="m-0 text-[11px] font-bold text-neutral-900">Report identity and executive metrics</p><p className="mb-0 mt-0.5 text-[9px] text-neutral-500">Property, period, barcode, headline KPIs and report reference</p></div><span className="text-[8px] font-bold uppercase tracking-wide text-emerald-700">Required</span></div>
                  {PDF_SECTION_OPTIONS.map((section) => {
                    const selected = effectiveSections.includes(section.key) || section.required;
                    const Icon = section.icon;
                    return <button key={section.key} type="button" onClick={() => toggleSection(section.key)} disabled={section.required} aria-pressed={selected} className="flex w-full items-center gap-3 border-0 border-b border-neutral-100 bg-white px-3 py-2.5 text-left last:border-b-0 hover:bg-neutral-50 disabled:cursor-default disabled:hover:bg-white"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${selected ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-400"}`}><Icon className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><p className={`m-0 text-[11px] font-bold ${selected ? "text-neutral-900" : "text-neutral-400"}`}>{section.label}</p><p className="mb-0 mt-0.5 text-[9px] text-neutral-500">{section.description}</p></div>{section.required ? <span className="text-[8px] font-bold uppercase tracking-wide text-emerald-700">Required</span> : <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-300 bg-white text-transparent"}`}><Check className="h-3 w-3" /></span>}</button>;
                  })}
                </div>
              </section>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-white px-5 py-3.5"><div><p className="m-0 text-[11px] font-bold text-neutral-900">{selection.label}</p><p className="mb-0 mt-0.5 text-[9px] text-neutral-500">Identity, assurance and certification cannot be removed from a verified NRMS PDF.</p></div><div className="flex items-center gap-2"><button type="button" onClick={onClose} disabled={busy} className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">Cancel</button><button type="button" onClick={() => onGenerate(selection, "print")} disabled={busy} title="Uses the browser's own PDF writer. Sharpest text and smallest file, but the filename and page footer come from the browser." className="inline-flex h-9 min-w-[132px] items-center justify-center gap-2 rounded-lg border border-[#073c35] bg-white px-4 text-[10px] font-bold text-[#073c35] hover:bg-emerald-50 disabled:border-neutral-200 disabled:text-neutral-400">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}Print as PDF</button><button type="button" onClick={() => onGenerate(selection, "download")} disabled={busy} title="Downloads a ready-named PDF with the report number and page footer on every page." className="inline-flex h-9 min-w-[132px] items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-4 text-[10px] font-bold text-white hover:bg-emerald-800 disabled:bg-neutral-300">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{busy ? "Preparing" : "Download PDF"}</button></div></footer>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}

function ReportSelector({ value, onChange }: { value: ReportKey; onChange: (report: ReportKey) => void }) {
  const [open, setOpen] = useState(false);
  const selected = REPORTS.find((report) => report.key === value) ?? REPORTS[0];
  const SelectedIcon = selected.icon;

  return (
    <div className="w-[200px] shrink-0 print:hidden">
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className="flex h-10 w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-2.5 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/15">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <SelectedIcon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-bold text-neutral-900">{selected.label}</span>
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-neutral-400">
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
      </button>

      <Dialog open={open} onClose={setOpen} className="relative z-[10000]">
        <DialogBackdrop className="fixed inset-0 bg-neutral-950/35 backdrop-blur-[2px]" />
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
          <DialogPanel className="w-full max-w-[540px] overflow-hidden rounded-2xl border border-white/60 bg-white shadow-[0_30px_90px_-30px_rgba(15,23,42,0.55)]">
            <header className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#073c35] text-white"><FileText className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="m-0 text-sm font-bold text-neutral-950">Choose a report</DialogTitle>
                <p className="mb-0 mt-0.5 text-[10px] text-neutral-500">Select the operational view you want to review.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close report chooser" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"><X className="h-4 w-4" /></button>
            </header>

            <div className="grid max-h-[min(520px,70vh)] gap-2 overflow-y-auto p-3 sm:grid-cols-2">
          {REPORTS.map((report) => {
            const Icon = report.icon;
            const isSelected = report.key === value;
            return (
                  <button
                    key={report.key}
                    type="button"
                    onClick={() => {
                      onChange(report.key);
                      setOpen(false);
                    }}
                    className={`flex min-h-[68px] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${isSelected ? "border-emerald-200 bg-emerald-50" : "border-neutral-200 bg-white hover:border-emerald-200 hover:bg-neutral-50"}`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isSelected ? "bg-emerald-200/70 text-emerald-900" : "bg-neutral-100 text-neutral-500"}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs font-bold ${isSelected ? "text-emerald-900" : "text-neutral-800"}`}>{report.label}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-neutral-400">{report.description}</span>
                    </span>
                    {isSelected && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white"><Check className="h-3.5 w-3.5" /></span>}
                  </button>
            );
          })}
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}

function ManagerReport({ data, currencyReport, money }: { data: ReportsResponse; currencyReport: CurrencyReport; money: (value: number) => string }) {
  const manager = data.manager;
  const summary = currencyReport.summary;
  const dueGuests = data.guestBalances.filter((row) => row.currency === currencyReport.currency && row.amountDue > 0.005).length;
  return <>
    <ReportTitle icon={ClipboardCheck} eyebrow="Management control" title="Daily manager report" text="The essential operational and financial position for the selected period." />
    <section className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6"><Metric label="Arrivals" value={manager.arrivals} icon={CalendarDays} /><Metric label="Departures" value={manager.departures} icon={ArrowUpRight} /><Metric label="In house now" value={manager.inHouse} icon={Users} tone="emerald" /><Metric label="Open orders" value={manager.openOrders} icon={Clock3} tone={manager.openOrders ? "amber" : "neutral"} /><Metric label="Cancellations" value={manager.cancellations} icon={XCircle} tone={manager.cancellations ? "red" : "neutral"} /><Metric label="No-shows" value={manager.noShows} icon={AlertCircle} tone={manager.noShows ? "red" : "neutral"} /></section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MoneyMetric label="Total hotel revenue" value={money(summary.totalRevenue)} note="Rooms, folio extras and outlet-paid sales" icon={TrendingUp} tone="emerald" /><MoneyMetric label="Total collected" value={money(summary.totalCollected)} note="Front desk and outlet collections" icon={WalletCards} tone="blue" /><MoneyMetric label="Outstanding folios" value={money(summary.amountDue)} note={`${dueGuests} guest ${dueGuests === 1 ? "balance" : "balances"} require attention`} icon={ReceiptText} tone={summary.amountDue > 0 ? "amber" : "emerald"} /><MoneyMetric label="Outlet-paid revenue" value={money(summary.outletPaidRevenue)} note="Collected directly by restaurant and bar" icon={Store} tone="violet" /></section>
    <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]"><Panel title="Room position" description="Current physical room availability"><div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-neutral-200 sm:grid-cols-5"><SmallStat label="All rooms" value={manager.rooms.total} /><SmallStat label="Operational" value={manager.rooms.active} /><SmallStat label="Occupied" value={manager.rooms.occupiedNow} /><SmallStat label="Available" value={manager.rooms.availableNow} good /><SmallStat label="Out of service" value={manager.rooms.outOfService} warning={manager.rooms.outOfService > 0} /></div></Panel><Panel title="Management attention" description="Items that should be reviewed before closing the day"><div className="space-y-2"><AttentionRow ok={data.control.status === "BALANCED"} text={data.control.status === "BALANCED" ? "Automated report reconciliation is balanced." : `${data.control.warnings.length} report data-quality items require review.`} /><AttentionRow ok={summary.amountDue <= 0.005} text={summary.amountDue > 0 ? `${dueGuests} folios still have an outstanding balance.` : "All report-period folios are settled."} /><AttentionRow ok={manager.openOrders === 0} text={manager.openOrders ? `${manager.openOrders} outlet orders are still open.` : "No restaurant or bar orders are waiting."} /><AttentionRow ok={manager.rooms.outOfService === 0} text={manager.rooms.outOfService ? `${manager.rooms.outOfService} rooms are unavailable for sale.` : "All configured rooms are operational."} /></div></Panel></section>
  </>;
}

function RevenueReport({ data, currencyReport, money }: { data: ReportsResponse; currencyReport: CurrencyReport; money: (value: number) => string }) {
  const { summary, departments } = currencyReport;
  const timing = currencyReport.collectionTiming;
  const sources = data.reservationSources.filter((row) => row.currency === currencyReport.currency);
  return <>
    <ReportTitle icon={TrendingUp} eyebrow="Financial performance" title="Revenue report" text="Recognized room, guest-service and outlet revenue with reservation-channel contribution." />
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MoneyMetric label="Room revenue" value={money(summary.roomRevenue)} note="Stay value allocated to occupied nights in this period" icon={BedDouble} tone="blue" /><MoneyMetric label="Folio extras" value={money(summary.folioExtras)} note="Non-voided charges posted to guest folios" icon={ReceiptText} tone="violet" /><MoneyMetric label="Paid at outlet" value={money(summary.outletPaidRevenue)} note="Settled separately at restaurant or bar" icon={Store} tone="emerald" /><MoneyMetric label="Total revenue" value={money(summary.totalRevenue)} note="Combined hotel operating revenue" icon={BarChart3} tone="emerald" /></section>
    <Panel title="Revenue and collection timing" description="Explains exactly why money collected can be higher or lower than revenue recognized in the same report period.">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MoneyMetric label="Collected for this period" value={money(timing.currentPeriodCollections)} note="Current-arrival folios plus outlet sales" icon={WalletCards} tone="emerald" /><MoneyMetric label="Older balances paid" value={money(timing.priorStayCollections)} note="Cash received now for earlier-arrival stays" icon={History} tone="blue" /><MoneyMetric label="Advance deposits" value={money(timing.advanceDeposits)} note="Cash received for stays arriving later" icon={CalendarCheck2} tone="violet" /><MoneyMetric label="Collections versus revenue" value={`${timing.revenueToCollectionDifference >= 0 ? "+" : "−"}${money(Math.abs(timing.revenueToCollectionDifference))}`} note={timing.revenueToCollectionDifference >= 0 ? "Collections are ahead because of timing" : "Some period revenue remains uncollected"} icon={ArrowUpDown} tone="amber" /></section>
      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-[11px] leading-5 text-blue-900"><strong>Plain explanation:</strong> total revenue is what the hotel earned in this report period. Total collected is all money received in this period, including older folios and future-stay deposits. The difference is timing, not extra revenue.</div>
    </Panel>
    <Panel title="Reservation source and platform mix" description="Compare NoLSAF, online travel agencies and direct reservation channels for active stays arriving in this period.">
      <DataTable headers={["Platform / source", "Reservations", "Reservation mix", "Room nights", "Average value", "Booked stay value", "Value mix", "Folio collected", "Exceptions"]}>
        {sources.map((row) => <tr key={`${row.source}-${row.currency}`}><Cell strong>{label(row.source)}</Cell><Cell>{row.reservations}</Cell><Cell><div className="flex min-w-[120px] items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, row.reservationShare)}%` }} /></div><span className="w-11 text-right text-[10px] font-bold text-neutral-500">{row.reservationShare.toFixed(1)}%</span></div></Cell><Cell>{row.roomNights}</Cell><Cell align="right">{money(row.averageReservationValue)}</Cell><Cell align="right" strong>{money(row.roomRevenue)}</Cell><Cell>{row.revenueShare.toFixed(1)}%</Cell><Cell align="right">{money(row.folioCollected)}</Cell><Cell><span className={`whitespace-nowrap text-[10px] font-semibold ${row.cancellations || row.noShows ? "text-amber-700" : "text-neutral-400"}`}>{row.cancellations} cancelled · {row.noShows} no-show</span></Cell></tr>)}
      </DataTable>
      {!sources.length && <TableEmpty text="No reservation-source records are available for this period." />}
    </Panel>
    <Panel title="Revenue by department" description="The operational source and value of recognized revenue"><DataTable headers={["Department", "Transactions", "Share", "Amount"]}>{departments.map((row) => { const share = summary.totalRevenue > 0 ? row.amount / summary.totalRevenue * 100 : 0; return <tr key={row.department}><Cell strong>{label(row.department)}</Cell><Cell>{row.transactions}</Cell><Cell><div className="flex min-w-[130px] items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, share)}%` }} /></div><span className="w-9 text-right text-[10px] font-bold text-neutral-500">{share.toFixed(0)}%</span></div></Cell><Cell align="right" strong>{money(row.amount)}</Cell></tr>; })}</DataTable>{departments.length === 0 && <TableEmpty text="No recognized revenue in this period." />}</Panel>
    <InfoNote>Operating room revenue is allocated to occupied nights inside the report period. Platform production remains based on confirmed, checked-in and checked-out reservations whose arrival date falls in the period; folio extras use posting time and paid-at-outlet revenue uses settlement time.</InfoNote>
  </>;
}

type PaymentSortKey = "occurredAt" | "guest" | "method" | "recordedBy" | "reference" | "amount" | "status";

function PaymentsReport({ data, rows, currencyReport, money }: { data: ReportsResponse; rows: PaymentRow[]; currencyReport: CurrencyReport; money: (value: number) => string }) {
  const [sortKey, setSortKey] = useState<PaymentSortKey>("occurredAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const methods = currencyReport.paymentMethods;

  const sortedRows = useMemo(() => {
    return [...rows].sort((left, right) => {
      let comparison = 0;
      if (sortKey === "occurredAt") comparison = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
      else if (sortKey === "amount") comparison = left.amount - right.amount;
      else if (sortKey === "reference") comparison = String(left.reference || left.referenceNumber || "").localeCompare(String(right.reference || right.referenceNumber || ""), undefined, { sensitivity: "base" });
      else if (sortKey === "status") comparison = (left.voidedAt ? "VOIDED" : "SETTLED").localeCompare(right.voidedAt ? "VOIDED" : "SETTLED");
      else comparison = left[sortKey].localeCompare(right[sortKey], undefined, { sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [rows, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [pageSize, rows, sortDirection, sortKey]);

  const changeSort = (nextKey: PaymentSortKey) => {
    if (nextKey === sortKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "occurredAt" || nextKey === "amount" ? "desc" : "asc");
    }
  };

  const header = (text: string, key: PaymentSortKey) => (
    <SortableHeader label={text} active={sortKey === key} direction={sortDirection} onClick={() => changeSort(key)} />
  );

  return (
    <>
      <ReportTitle icon={WalletCards} eyebrow="Collection control" title="Payments and cashier report" text="Every recorded collection with its method, operator, guest and source." />
      <section className="grid gap-3 sm:grid-cols-3">
        <MoneyMetric label="Front desk / folio" value={money(currencyReport.summary.folioPayments)} note="Payments recorded against guest folios" icon={Banknote} tone="blue" />
        <MoneyMetric label="Collected at outlets" value={money(currencyReport.summary.outletPayments)} note="Restaurant and bar direct settlement" icon={Store} tone="violet" />
        <MoneyMetric label="Total collections" value={money(currencyReport.summary.totalCollected)} note={`${rows.filter((row) => !row.voidedAt).length} active collection records`} icon={CheckCircle2} tone="emerald" />
      </section>
      <Panel title="Collections by payment method" description="Recorded money grouped by settlement method">
        <DataTable headers={["Method", "Transactions", "Amount"]}>{methods.map((row) => <tr key={row.method}><Cell strong>{label(row.method)}</Cell><Cell>{row.transactions}</Cell><Cell align="right" strong>{money(row.amount)}</Cell></tr>)}</DataTable>
        {methods.length === 0 && <TableEmpty text="No payments were recorded in this period." />}
      </Panel>
      {!data.payments.cashVarianceAvailable && <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p className="m-0"><strong>Cash variance is not calculated yet.</strong> NRMS can report recorded cash, but expected-versus-counted cash requires a cashier shift-closing record. No variance is guessed.</p></div>}
      <Panel title="Payment history" description="Select any column heading to sort. Newest collections appear first by default.">
        <DataTable headers={[
          header("Date and time", "occurredAt"),
          header("Guest / room", "guest"),
          header("Method", "method"),
          header("Recorded by", "recordedBy"),
          header("Reference", "reference"),
          header("Amount", "amount"),
          header("Status", "status"),
        ]}>
          {pageRows.map((row) => (
            <tr key={row.id}>
              <Cell><span className="whitespace-nowrap">{dateTime(row.occurredAt)}</span></Cell>
              <Cell><Link href={`/owner/nrms/reservations/${row.reservationId}`} className="font-bold text-neutral-900 no-underline hover:text-emerald-700">{row.guest}</Link><span className="mt-0.5 block text-[10px] text-neutral-400">{row.room}</span></Cell>
              <Cell strong>{label(row.method)}</Cell>
              <Cell>{row.recordedBy}</Cell>
              <Cell>{row.reference || row.referenceNumber || "Not recorded"}</Cell>
              <Cell align="right" strong>{money(row.amount)}</Cell>
              <Cell><StatusBadge value={row.voidedAt ? "VOIDED" : "SETTLED"} /></Cell>
            </tr>
          ))}
        </DataTable>
        {rows.length === 0 ? <TableEmpty text="No collection history for this period." /> : (
          <TablePagination page={currentPage} pageSize={pageSize} totalItems={sortedRows.length} totalPages={totalPages} itemLabel="payments" onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </Panel>
    </>
  );
}

type BalanceSortKey = "guest" | "checkIn" | "roomAmount" | "folioExtras" | "outletPaid" | "totalSpend" | "totalCollected" | "amountDue" | "settlementStatus";
type SortDirection = "asc" | "desc";

function BalancesReport({ rows, currencyReport, money }: { rows: GuestBalance[]; currencyReport: CurrencyReport; money: (value: number) => string }) {
  const [sortKey, setSortKey] = useState<BalanceSortKey>("amountDue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const unpaid = rows.filter((row) => row.amountDue > 0.005);

  const sortedRows = useMemo(() => {
    const settlementOrder = { UNPAID: 0, PARTIAL: 1, PAID: 2 };
    return [...rows].sort((left, right) => {
      let comparison = 0;
      if (sortKey === "guest") comparison = left.guest.localeCompare(right.guest, undefined, { sensitivity: "base" });
      else if (sortKey === "checkIn") comparison = new Date(left.checkIn).getTime() - new Date(right.checkIn).getTime();
      else if (sortKey === "settlementStatus") comparison = settlementOrder[left.settlementStatus] - settlementOrder[right.settlementStatus];
      else comparison = left[sortKey] - right[sortKey];
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [rows, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [pageSize, rows, sortDirection, sortKey]);

  const changeSort = (nextKey: BalanceSortKey) => {
    if (nextKey === sortKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "guest" || nextKey === "checkIn" || nextKey === "settlementStatus" ? "asc" : "desc");
    }
  };

  const header = (text: string, key: BalanceSortKey) => (
    <SortableHeader label={text} active={sortKey === key} direction={sortDirection} onClick={() => changeSort(key)} />
  );

  return (
    <>
      <ReportTitle icon={ReceiptText} eyebrow="Checkout control" title="Guest balances and folios" text="Room charges, outlet activity, collections and the amount still required from each guest." />
      <section className="grid gap-3 sm:grid-cols-3">
        <MoneyMetric label="Total guest spend" value={money(rows.reduce((sum, row) => sum + row.totalSpend, 0))} note="Includes separately settled outlet orders" icon={BookOpenCheck} tone="violet" />
        <MoneyMetric label="Total collected" value={money(rows.reduce((sum, row) => sum + row.totalCollected, 0))} note="Folio payments plus outlet collections" icon={WalletCards} tone="emerald" />
        <MoneyMetric label="Amount still due" value={money(currencyReport.summary.amountDue)} note={`${unpaid.length} ${unpaid.length === 1 ? "folio requires" : "folios require"} settlement`} icon={AlertCircle} tone={unpaid.length ? "amber" : "emerald"} />
      </section>
      <Panel title="Guest folio register" description="Select any column heading to sort. Outstanding balances appear first by default.">
        <DataTable headers={[
          header("Guest / room", "guest"),
          header("Stay", "checkIn"),
          header("Room", "roomAmount"),
          header("Folio extras", "folioExtras"),
          header("Outlet paid", "outletPaid"),
          header("Total spend", "totalSpend"),
          header("Collected", "totalCollected"),
          header("Amount due", "amountDue"),
          header("Status", "settlementStatus"),
        ]}>
          {pageRows.map((row) => (
            <tr key={row.reservationId}>
              <Cell><Link href={`/owner/nrms/reservations/${row.reservationId}`} className="font-bold text-neutral-900 no-underline hover:text-emerald-700">{row.guest}</Link><span className="mt-0.5 block text-[10px] text-neutral-400">{row.receiptNumber || `Reservation #${row.reservationId}`}</span></Cell>
              <Cell><span className="whitespace-nowrap">{shortDate(row.checkIn)}</span><span className="block whitespace-nowrap text-[10px] text-neutral-400">to {shortDate(row.checkOut)}</span></Cell>
              <Cell align="right">{money(row.roomAmount)}</Cell>
              <Cell align="right">{money(row.folioExtras)}</Cell>
              <Cell align="right">{money(row.outletPaid)}</Cell>
              <Cell align="right" strong>{money(row.totalSpend)}</Cell>
              <Cell align="right" className="text-emerald-700">{money(row.totalCollected)}</Cell>
              <Cell align="right" strong className={row.amountDue > 0 ? "text-red-700" : "text-neutral-900"}>{row.amountDue > 0 ? money(row.amountDue) : "None"}</Cell>
              <Cell><SettlementBadge value={row.settlementStatus} /></Cell>
            </tr>
          ))}
        </DataTable>
        {rows.length === 0 ? <TableEmpty text="No guest folios match this period." /> : (
          <TablePagination
            page={currentPage}
            pageSize={pageSize}
            totalItems={sortedRows.length}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </Panel>
    </>
  );
}

function OccupancyReport({ data }: { data: ReportsResponse }) {
  const occupancy = data.occupancy;
  const occupancyMoney = moneyFormatter(occupancy.currency).format;
  return <><ReportTitle icon={BedDouble} eyebrow="Room performance" title="Occupancy report" text="Room-night utilisation and core hotel performance metrics for the selected period." /><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MoneyMetric label="Occupancy" value={`${occupancy.occupancyRate.toFixed(1)}%`} note={`${occupancy.roomNightsSold} of ${occupancy.roomNightsAvailable} available room-nights sold`} icon={BedDouble} tone="emerald" /><MoneyMetric label="Average daily rate" value={occupancyMoney(occupancy.adr)} note="Room revenue divided by room-nights sold" icon={Banknote} tone="blue" /><MoneyMetric label="RevPAR" value={occupancyMoney(occupancy.revPar)} note="Room revenue divided by available room-nights" icon={BarChart3} tone="violet" /><MoneyMetric label="Operational blocks" value={String(occupancy.blockedRoomNights)} note="Room-nights removed from sale" icon={CalendarDays} tone={occupancy.blockedRoomNights ? "amber" : "emerald"} /></section><Panel title="Performance by room type" description={`${occupancy.rangeDays} report days across ${occupancy.activeRooms} operational rooms`}><DataTable headers={["Room type", "Rooms", "Available nights", "Sold nights", "Occupancy"]}>{occupancy.byRoomType.map((row) => <tr key={row.roomTypeId}><Cell strong>{row.roomType}</Cell><Cell>{row.units}</Cell><Cell>{row.roomNightsAvailable}</Cell><Cell>{row.roomNightsSold}</Cell><Cell><div className="flex min-w-[150px] items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, row.occupancyRate)}%` }} /></div><strong className="w-12 text-right text-xs">{row.occupancyRate.toFixed(1)}%</strong></div></Cell></tr>)}</DataTable>{occupancy.byRoomType.length === 0 && <TableEmpty text="Configure room types and room units to calculate occupancy." />}</Panel><InfoNote>Occupancy uses active room units, confirmed stays and operational room blocks. ADR and RevPAR use the property room currency, {occupancy.currency}. Cancelled, expired and no-show reservations are excluded.</InfoNote></>;
}

type OutletSortKey = "orderNumber" | "outlet" | "guest" | "itemCount" | "settlementMode" | "orderedAt" | "completedAt" | "total" | "status";

function OutletReport({ rows, money }: { rows: OutletRow[]; money: (value: number) => string }) {
  const [sortKey, setSortKey] = useState<OutletSortKey>("orderedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const completed = rows.filter((row) => ["SETTLED", "POSTED_TO_FOLIO"].includes(row.status));
  const open = rows.filter((row) => ["CONFIRMED", "PREPARING"].includes(row.status));
  const outletPaid = completed.filter((row) => row.settlementMode === "OUTLET_PAYMENT").reduce((sum, row) => sum + row.total, 0);
  const folioPosted = completed.filter((row) => row.settlementMode === "ROOM_FOLIO").reduce((sum, row) => sum + row.total, 0);

  const sortedRows = useMemo(() => {
    return [...rows].sort((left, right) => {
      let comparison = 0;
      if (["orderNumber", "outlet", "guest", "settlementMode", "status"].includes(sortKey)) {
        comparison = String(left[sortKey as "orderNumber" | "outlet" | "guest" | "settlementMode" | "status"]).localeCompare(String(right[sortKey as "orderNumber" | "outlet" | "guest" | "settlementMode" | "status"]), undefined, { sensitivity: "base" });
      } else if (sortKey === "orderedAt") comparison = new Date(left.orderedAt).getTime() - new Date(right.orderedAt).getTime();
      else if (sortKey === "completedAt") comparison = (left.completedAt ? new Date(left.completedAt).getTime() : 0) - (right.completedAt ? new Date(right.completedAt).getTime() : 0);
      else comparison = left[sortKey as "itemCount" | "total"] - right[sortKey as "itemCount" | "total"];
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [rows, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [pageSize, rows, sortDirection, sortKey]);

  const changeSort = (nextKey: OutletSortKey) => {
    if (nextKey === sortKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(nextKey);
      setSortDirection(["orderNumber", "outlet", "guest", "settlementMode", "status"].includes(nextKey) ? "asc" : "desc");
    }
  };

  const header = (text: string, key: OutletSortKey) => (
    <SortableHeader label={text} active={sortKey === key} direction={sortDirection} onClick={() => changeSort(key)} />
  );

  return (
    <>
      <ReportTitle icon={ShoppingBasket} eyebrow="Restaurant and bar" title="Outlet sales and order history" text="Every order, settlement path, guest, item and operating timestamp in one register." />
      <section className="grid gap-3 sm:grid-cols-3">
        <MoneyMetric label="Paid at outlets" value={money(outletPaid)} note="Collected and recognized at the outlet" icon={Store} tone="emerald" />
        <MoneyMetric label="Posted to folios" value={money(folioPosted)} note="Collected through the guest folio" icon={ReceiptText} tone="blue" />
        <MoneyMetric label="Open orders" value={String(open.length)} note="Confirmed or currently preparing" icon={Clock3} tone={open.length ? "amber" : "emerald"} />
      </section>
      <Panel title="Order register" description="Select any column heading to sort. Newest orders appear first by default.">
        <div className="mb-3 flex flex-wrap items-center gap-4 border-b border-neutral-100 pb-3 text-[10px] font-semibold text-neutral-600" aria-label="Outlet row color legend"><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-3.5 rounded-sm bg-violet-500" />Bar</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-3.5 rounded-sm bg-orange-500" />Restaurant</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-3.5 rounded-sm bg-sky-500" />Other services</span></div>
        <DataTable headers={[
          header("Order", "orderNumber"),
          header("Outlet", "outlet"),
          header("Guest / room", "guest"),
          header("Items", "itemCount"),
          header("Settlement", "settlementMode"),
          header("Ordered", "orderedAt"),
          header("Completed", "completedAt"),
          header("Amount", "total"),
          header("Status", "status"),
        ]}>
          {pageRows.map((row) => (
            <tr key={row.id} className={outletUiRowClass(row.outletType)}>
              <Cell><strong className="whitespace-nowrap">{row.orderNumber}</strong><span className="mt-0.5 block text-[10px] text-neutral-500">{row.createdBy}</span></Cell>
              <Cell strong>{row.outlet}<span className="mt-0.5 block text-[10px] font-normal text-neutral-400">{label(row.outletType)}</span></Cell>
              <Cell><Link href={`/owner/nrms/reservations/${row.reservationId}`} className="font-bold text-neutral-900 no-underline hover:text-emerald-700">{row.guest}</Link><span className="mt-0.5 block text-[10px] text-neutral-400">{row.room}</span></Cell>
              <Cell><span className="block max-w-[260px] text-xs leading-5">{row.items || "No item details"}</span></Cell>
              <Cell><span className="whitespace-nowrap">{label(row.settlementMode)}</span>{row.settlementMode === "OUTLET_PAYMENT" && <span className="mt-0.5 block whitespace-nowrap text-[10px] text-neutral-400">{label(row.settlementMethod || "UNCLASSIFIED")}</span>}</Cell>
              <Cell><span className="whitespace-nowrap">{dateTime(row.orderedAt)}</span></Cell>
              <Cell>{row.completedAt ? <span className="whitespace-nowrap">{dateTime(row.completedAt)}</span> : "Not completed"}</Cell>
              <Cell align="right" strong>{money(row.total)}</Cell>
              <Cell><StatusBadge value={row.status} /></Cell>
            </tr>
          ))}
        </DataTable>
        {rows.length === 0 ? <TableEmpty text="No outlet orders match this period." /> : (
          <TablePagination
            page={currentPage}
            pageSize={pageSize}
            totalItems={sortedRows.length}
            totalPages={totalPages}
            itemLabel="orders"
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </Panel>
    </>
  );
}

type AuditSortKey = "occurredAt" | "type" | "guest" | "reference" | "actor" | "reason";

function AuditReport({ rows }: { rows: AuditRow[] }) {
  const [sortKey, setSortKey] = useState<AuditSortKey>("occurredAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const corrections = rows.filter((row) => row.type.includes("VOID") || row.type === "EDITED" || row.type === "ROOM_MOVED");

  const sortedRows = useMemo(() => {
    return [...rows].sort((left, right) => {
      let comparison = 0;
      if (sortKey === "occurredAt") comparison = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
      else if (sortKey === "reference") comparison = String(left.referenceNumber || left.reservationId).localeCompare(String(right.referenceNumber || right.reservationId), undefined, { sensitivity: "base", numeric: true });
      else if (sortKey === "reason") comparison = String(left.reason || "").localeCompare(String(right.reason || ""), undefined, { sensitivity: "base" });
      else comparison = left[sortKey].localeCompare(right[sortKey], undefined, { sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [rows, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [pageSize, rows, sortDirection, sortKey]);

  const changeSort = (nextKey: AuditSortKey) => {
    if (nextKey === sortKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "occurredAt" ? "desc" : "asc");
    }
  };

  const header = (text: string, key: AuditSortKey) => (
    <SortableHeader label={text} active={sortKey === key} direction={sortDirection} onClick={() => changeSort(key)} />
  );

  return (
    <>
      <ReportTitle icon={ShieldCheck} eyebrow="Immutable history" title="Audit, voids and adjustments" text="Operational changes are shown with the responsible user, timestamp, reservation and recorded reason." />
      <section className="grid gap-3 sm:grid-cols-3">
        <MoneyMetric label="Audit events" value={String(rows.length)} note="Events recorded during this period" icon={History} tone="blue" />
        <MoneyMetric label="Corrections and voids" value={String(corrections.length)} note="Voids, edits and room movements" icon={FileSearch} tone={corrections.length ? "amber" : "emerald"} />
        <MoneyMetric label="Traceability" value="Recorded" note="Original transactions remain in history" icon={ShieldCheck} tone="emerald" />
      </section>
      <Panel title="Audit event history" description="Select any column heading to sort. Newest activity appears first by default.">
        <DataTable headers={[
          header("Date and time", "occurredAt"),
          header("Action", "type"),
          header("Guest / room", "guest"),
          header("Reference", "reference"),
          header("Performed by", "actor"),
          header("Reason", "reason"),
        ]}>
          {pageRows.map((row) => (
            <tr key={row.id}>
              <Cell><span className="whitespace-nowrap">{dateTime(row.occurredAt)}</span></Cell>
              <Cell><StatusBadge value={row.type} /></Cell>
              <Cell><Link href={`/owner/nrms/reservations/${row.reservationId}`} className="font-bold text-neutral-900 no-underline hover:text-emerald-700">{row.guest}</Link><span className="mt-0.5 block text-[10px] text-neutral-400">{row.room}</span></Cell>
              <Cell>{row.referenceNumber || `Reservation #${row.reservationId}`}</Cell>
              <Cell strong>{row.actor}</Cell>
              <Cell>{row.reason || "Not recorded"}</Cell>
            </tr>
          ))}
        </DataTable>
        {rows.length === 0 ? <TableEmpty text="No auditable events were recorded in this period." /> : (
          <TablePagination page={currentPage} pageSize={pageSize} totalItems={sortedRows.length} totalPages={totalPages} itemLabel="events" onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </Panel>
    </>
  );
}

function ReportTitle({ icon: Icon, eyebrow, title, text }: { icon: IconType; eyebrow: string; title: string; text: string }) {
  return <header className="flex items-start gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 shadow-sm"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white"><Icon className="h-4 w-4" /></span><div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-700">{eyebrow}</p><h2 className="mb-0 mt-0.5 text-base font-bold text-neutral-950">{title}</h2><p className="mb-0 mt-0.5 text-[11px] leading-4 text-neutral-500">{text}</p></div></header>;
}

function Metric({ label: text, value, icon: Icon, tone = "neutral" }: { label: string; value: string | number; icon: IconType; tone?: "neutral" | "emerald" | "amber" | "red" }) {
  const colors = { neutral: "bg-neutral-100 text-neutral-600", emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700" };
  return <article className="flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colors[tone]}`}><Icon className="h-3.5 w-3.5" /></span><div className="min-w-0"><p className="m-0 truncate text-[10px] font-semibold text-neutral-500">{text}</p><p className="mb-0 mt-0.5 text-lg font-bold tabular-nums text-neutral-950">{value}</p></div></article>;
}

function MoneyMetric({ label: text, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: IconType; tone: "emerald" | "blue" | "violet" | "amber" }) {
  const colors = { emerald: "bg-emerald-50 text-emerald-700", blue: "bg-blue-50 text-blue-700", violet: "bg-violet-50 text-violet-700", amber: "bg-amber-50 text-amber-700" };
  return <article className="flex min-h-[116px] min-w-0 flex-col rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm"><div className="flex items-start justify-between gap-2"><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">{text}</p><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colors[tone]}`}><Icon className="h-3.5 w-3.5" /></span></div><p className="mb-0 mt-2 truncate text-lg font-bold tabular-nums tracking-tight text-neutral-950">{value}</p><p className="mb-0 mt-auto pt-1.5 text-[10px] leading-4 text-neutral-500">{note}</p></article>;
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"><header className="border-b border-neutral-100 px-4 py-3"><h3 className="m-0 text-sm font-bold text-neutral-950">{title}</h3><p className="mb-0 mt-0.5 text-[10px] leading-4 text-neutral-500">{description}</p></header><div className="min-w-0 p-3 sm:p-4">{children}</div></section>;
}

function DataTable({ headers, children }: { headers: React.ReactNode[]; children: React.ReactNode }) {
  return <div className="min-w-0 overflow-x-auto"><table className="w-full min-w-max border-separate border-spacing-0 text-left"><thead><tr>{headers.map((header, index) => <th key={index} className="border-b border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400 first:rounded-l-lg last:rounded-r-lg">{header}</th>)}</tr></thead><tbody className="text-xs text-neutral-600">{children}</tbody></table></div>;
}

function SortableHeader({ label: text, active, direction, onClick }: { label: string; active: boolean; direction: SortDirection; onClick: () => void }) {
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${text}${active ? `, currently ${direction === "asc" ? "ascending" : "descending"}` : ""}`}
      className={`-mx-1 inline-flex items-center gap-1 rounded-md border-0 bg-transparent px-1 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] transition ${active ? "text-emerald-700" : "text-neutral-400 hover:text-neutral-700"}`}
    >
      <span>{text}</span>
      <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-45"}`} />
    </button>
  );
}

function TablePagination({ page, pageSize, totalItems, totalPages, itemLabel = "folios", onPageChange, onPageSizeChange }: { page: number; pageSize: number; totalItems: number; totalPages: number; itemLabel?: string; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void }) {
  const first = totalItems ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, totalItems);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3">
      <p className="m-0 text-[10px] text-neutral-500">Showing <strong className="text-neutral-800">{first}–{last}</strong> of <strong className="text-neutral-800">{totalItems}</strong> {itemLabel}</p>
      <div className="flex items-center gap-2">
        <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 text-[9px] font-bold uppercase tracking-wide text-neutral-400">
          Rows
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="border-0 bg-transparent p-0 text-[10px] font-bold text-neutral-700 outline-none">
            {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <span className="min-w-[70px] text-center text-[10px] font-semibold text-neutral-500">Page {page} of {totalPages}</span>
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Next page" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

function Cell({ children, strong = false, align = "left", className = "" }: { children: React.ReactNode; strong?: boolean; align?: "left" | "right"; className?: string }) {
  return <td className={`border-b border-neutral-100 px-3 py-3 align-middle ${align === "right" ? "text-right tabular-nums" : "text-left"} ${strong ? "font-bold text-neutral-900" : ""} ${className}`}>{children}</td>;
}

function SmallStat({ label: text, value, good = false, warning = false }: { label: string; value: number; good?: boolean; warning?: boolean }) {
  return <div className={`bg-white px-3 py-3 ${good ? "text-emerald-700" : warning ? "text-amber-700" : "text-neutral-900"}`}><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">{text}</p><p className="mb-0 mt-1 text-lg font-bold tabular-nums">{value}</p></div>;
}

function AttentionRow({ ok, text }: { ok: boolean; text: string }) {
  return <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}<span>{text}</span></div>;
}

function StatusBadge({ value }: { value: string }) {
  const danger = value.includes("VOID") || value === "CANCELLED" || value === "PAYMENT_VOIDED" || value === "CHARGE_VOIDED";
  const warning = ["CONFIRMED", "PREPARING", "EDITED", "ROOM_MOVED"].includes(value);
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${danger ? "bg-red-50 text-red-700" : warning ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{label(value)}</span>;
}

function SettlementBadge({ value }: { value: GuestBalance["settlementStatus"] }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold ${value === "PAID" ? "bg-emerald-50 text-emerald-700" : value === "PARTIAL" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{value === "PAID" ? "Paid in full" : value === "PARTIAL" ? "Part paid" : "Unpaid"}</span>;
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-900"><FileSearch className="mt-0.5 h-4 w-4 shrink-0" /><p className="m-0">{children}</p></div>;
}

function TableEmpty({ text }: { text: string }) {
  return <div className="py-10 text-center text-xs text-neutral-400">{text}</div>;
}

function EmptyReport({ title, text }: { title: string; text: string }) {
  return <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-20 text-center"><FileText className="mx-auto h-8 w-8 text-neutral-300" /><h3 className="mb-0 mt-3 text-base font-bold text-neutral-800">{title}</h3><p className="mb-0 mt-1 text-xs text-neutral-500">{text}</p></div>;
}
