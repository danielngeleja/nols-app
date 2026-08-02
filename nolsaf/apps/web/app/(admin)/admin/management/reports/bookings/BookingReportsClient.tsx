"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, FileText, Printer, RefreshCw, Users } from "lucide-react";

import Chart from "@/components/Chart";
import DatePickerField from "@/components/DatePickerField";
import NoLSAFReportsFrame, { NoLSAFReportTitle } from "@/components/admin/reports/NoLSAFReportsFrame";
import {
  adminReportPrintStyles,
  buildAdminReportFooter,
  buildAdminReportHeader,
  openAdminReportPrintWindow,
  renderAndPrintAdminReport,
} from "@/lib/adminReportPrint";
import { escapeAttr, escapeHtml } from "@/utils/html";

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDaysUtc(dateUtc: Date, days: number): Date {
  return new Date(dateUtc.getTime() + days * 864e5);
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

function fmtDateOnly(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

type TotalsState = {
  single: {
    total: number | null;
    byStatus: Record<string, number | null>;
  };
  groupStays: {
    total: number | null;
    byStatus: Record<string, number | null>;
  };
  tourBookings: {
    total: number | null;
    byStatus: Record<string, number | null>;
  };
};

function pctOf(total: number, count: number) {
  if (!total) return 0;
  const v = Math.round((count / total) * 100);
  return Math.max(0, Math.min(100, v));
}

function PercentBarRow({
  label,
  pct,
  colorClassName,
}: {
  label: string;
  pct: number;
  colorClassName: string;
}) {
  const clip = "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)";

  return (
    <div className="flex items-center gap-3">
      <div className="w-[130px] text-[11px] font-semibold text-gray-700 truncate" title={label}>
        {label}
      </div>

      <div className="flex-1">
        <div className="h-10 bg-gray-100 rounded-sm overflow-hidden">
          {pct > 0 ? (
            <div
              className={"h-full flex items-center justify-end " + colorClassName}
              style={{ width: `${pct}%`, minWidth: "76px" }}
            >
              <div
                className="h-full flex items-center px-3 text-white font-extrabold tracking-tight border-l-2 border-white/80"
                style={{ clipPath: clip }}
              >
                {pct}%
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center px-2">
              <div
                className="h-8 px-3 bg-white border border-gray-200 text-gray-700 text-sm font-extrabold flex items-center"
                style={{ clipPath: clip }}
              >
                0%
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtInt(n: number | null) {
  if (n === null) return "—";
  const v = Math.round(n);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtAmount(v: unknown) {
  const n = numOrNull(v);
  if (n === null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function normalizeCount(v: number | null | undefined) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
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
      title={hint}
      aria-label={hint}
      className={
        "group relative h-9 w-full snap-start overflow-hidden rounded-md border px-3 text-[10px] font-bold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 " +
        (active ? "border-emerald-800 bg-gradient-to-b from-emerald-700 to-emerald-800 text-white shadow-emerald-900/15" : "border-neutral-200 bg-gradient-to-b from-white to-neutral-50 text-neutral-600 hover:border-emerald-300 hover:text-emerald-800")
      }
    >
      <span className="relative z-10">{label}</span>
      <span className={`absolute inset-x-2 bottom-0 h-0.5 transition ${active ? "bg-emerald-300" : "bg-transparent group-hover:bg-emerald-300"}`} aria-hidden />

      <span
        role="tooltip"
        className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 shadow-lg opacity-0 scale-95 transition-all duration-150 ease-out group-hover:opacity-100 group-hover:scale-100 group-focus-visible:opacity-100 group-focus-visible:scale-100"
      >
        {hint}
      </span>
    </button>
  );
}

type MoreRangeKey = "3m" | "6m" | "ytd" | "12m";

async function fetchAllPages<T>(baseUrl: URL, maxItems = 20000): Promise<{ items: T[]; total: number }>
{
  const items: T[] = [];
  let page = 1;
  let total = 0;

  while (true) {
    const url = new URL(baseUrl.toString());
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", "100");

    const r = await fetch(url.toString(), { credentials: "include" });
    const j = (await safeJson(r)) as any;

    const pageItems = (Array.isArray(j?.items) ? j.items : []) as T[];
    total = Number(j?.total ?? total ?? 0);
    if (pageItems.length === 0) break;

    items.push(...pageItems);
    if (Number.isFinite(total) && total > 0 && items.length >= total) break;
    if (items.length >= maxItems) break;

    page += 1;
  }

  return { items, total: Number.isFinite(total) ? total : items.length };
}

function countByStatus(items: Array<{ status?: string | null }>) {
  const out: Record<string, number> = {};
  for (const it of items) {
    const s = String(it?.status ?? "").trim();
    if (!s) continue;
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

type OwnerBookingItem = {
  id: number;
  status: string;
  checkIn: string;
  checkOut: string;
  guestName: string | null;
  guestPhone?: string | null;
  sex?: string | null;
  nationality?: string | null;
  totalAmount: unknown;
  property?: { title?: string | null } | null;
  user?: { name?: string | null; phone?: string | null } | null;
  invoice?: { status?: string | null; total?: unknown; paidAt?: string | null } | null;
  payment?: { amount?: unknown; paidAt?: string | null } | null;
  review?: { rating?: number | null; createdAt?: string } | null;
};

type GroupStayItem = {
  id: number;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  acceptedTotalAmount?: unknown | null;
  confirmedTotalAmount?: unknown | null;
  totalAmount: unknown | null;
  currency?: string | null;
  user?: { name?: string | null; phone?: string | null } | null;
  leadPassenger?: { name?: string | null; phone?: string | null; gender?: string | null; nationality?: string | null } | null;
  confirmedProperty?: { title?: string | null } | null;
  acceptedProperty?: { title?: string | null } | null;
  acceptedAt?: string | null;
  confirmedAt?: string | null;
  createdAt?: string | null;
};

type TourBookingItem = {
  id: number;
  status: string;
  bookingCode?: string | null;
  operatorName?: string | null;
  tourTitle?: string | null;
  destination?: string | null;
  numberOfPeople?: number | null;
  grossAmount?: number | null;
  commissionAmount?: number | null;
  currency?: string | null;
  createdAt?: string | null;
};

export default function BookingReportsClient() {
  const today = new Date();
  const [from, setFrom] = useState(() => formatDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(() => formatDate(today));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<TotalsState>({
    single: { total: null, byStatus: {} },
    groupStays: { total: null, byStatus: {} },
    tourBookings: { total: null, byStatus: {} },
  });

  const [ownerItems, setOwnerItems] = useState<OwnerBookingItem[]>([]);
  const [groupItems, setGroupItems] = useState<GroupStayItem[]>([]);
  const [tourItems, setTourItems] = useState<TourBookingItem[]>([]);

  const [ownerChartCanvas, setOwnerChartCanvas] = useState<HTMLCanvasElement | null>(null);
  const [tourChartCanvas, setTourChartCanvas] = useState<HTMLCanvasElement | null>(null);

  const getMoreRange = useCallback((k: MoreRangeKey) => {
    const end = startOfTodayUtc();
    if (k === "ytd") {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { from: formatDate(start), to: formatDate(end) };
    }
    if (k === "3m") return { from: formatDate(addDaysUtc(end, -89)), to: formatDate(end) };
    if (k === "6m") return { from: formatDate(addDaysUtc(end, -179)), to: formatDate(end) };
    return { from: formatDate(addDaysUtc(end, -364)), to: formatDate(end) };
  }, []);

  const getQuickRange = useCallback((daysBackInclusive: number) => {
    const end = startOfTodayUtc();
    const start = addDaysUtc(end, -daysBackInclusive);
    return { from: formatDate(start), to: formatDate(end) };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = from;
      const end = to;

      const ownerBase = new URL("/api/admin/bookings", window.location.origin);
      ownerBase.searchParams.set("start", start);
      ownerBase.searchParams.set("end", end);

      const groupBase = new URL("/api/admin/group-stays/bookings", window.location.origin);
      groupBase.searchParams.set("start", start);
      groupBase.searchParams.set("end", end);

      // Tour bookings: the overview endpoint returns ALL records (no server-side
      // date filter / pagination), so we fetch once and filter client-side by
      // createdAt within the selected range [start, end + 1 day).
      const tourUrl = new URL("/api/admin/tour-revenue/overview", window.location.origin);

      const [ownerRes, groupRes, tourRaw] = await Promise.all([
        fetchAllPages<OwnerBookingItem>(ownerBase),
        fetchAllPages<GroupStayItem>(groupBase),
        fetch(tourUrl.toString(), { credentials: "include" }).then(safeJson) as Promise<any>,
      ]);

      const rangeStart = new Date(`${start}T00:00:00.000Z`).getTime();
      const rangeEndExclusive = new Date(`${end}T00:00:00.000Z`).getTime() + 864e5;
      const allTours: TourBookingItem[] = Array.isArray(tourRaw?.revenues) ? tourRaw.revenues : [];
      const tourItemsInRange = allTours.filter((t) => {
        // Only customer-paid tours count as bookings. DRAFT means the customer
        // has not paid yet, so it is not an active tour booking and is excluded.
        if (String(t?.status ?? "").toUpperCase() === "DRAFT") return false;
        if (!t?.createdAt) return false;
        const ts = new Date(t.createdAt).getTime();
        return Number.isFinite(ts) && ts >= rangeStart && ts < rangeEndExclusive;
      });

      setOwnerItems(ownerRes.items);
      setGroupItems(groupRes.items);
      setTourItems(tourItemsInRange);

      const ownerCounts = countByStatus(ownerRes.items);
      const groupCounts = countByStatus(groupRes.items);
      const tourCounts = countByStatus(tourItemsInRange);

      const ownerByStatus: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(ownerCounts)) ownerByStatus[k] = numOrNull(v);

      const groupByStatus: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(groupCounts)) groupByStatus[k] = numOrNull(v);

      const tourByStatus: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(tourCounts)) tourByStatus[k] = numOrNull(v);

      setTotals({
        single: { total: numOrNull(ownerRes.total ?? ownerRes.items.length), byStatus: ownerByStatus },
        groupStays: { total: numOrNull(groupRes.total ?? groupRes.items.length), byStatus: groupByStatus },
        tourBookings: { total: numOrNull(tourItemsInRange.length), byStatus: tourByStatus },
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load booking report totals");
      setTotals({
        single: { total: null, byStatus: {} },
        groupStays: { total: null, byStatus: {} },
        tourBookings: { total: null, byStatus: {} },
      });
      setOwnerItems([]);
      setGroupItems([]);
      setTourItems([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpiSingle = totals.single.total;
  const kpiGroup = totals.groupStays.total;
  const kpiTour = totals.tourBookings.total;

  const singleCheckedIn = (totals.single.byStatus["CHECKED_IN"] ?? 0) + (totals.single.byStatus["PENDING_CHECKIN"] ?? 0);

  const ownerStatusOrder = useMemo(
    () => [
      { key: "NEW", label: "New" },
      { key: "CONFIRMED", label: "Validated" },
      { key: "PENDING_CHECKIN", label: "Pending check-in" },
      { key: "CHECKED_IN", label: "Checked in" },
      { key: "CHECKED_OUT", label: "Checked out" },
      { key: "CANCELED", label: "Canceled" },
    ],
    []
  );

  const tourStatusOrder = useMemo(
    () => [
      { key: "NEW", label: "New" },
      { key: "CLAIMED", label: "Claimed" },
      { key: "VERIFIED", label: "Verified" },
      { key: "APPROVED", label: "Approved" },
      { key: "DISBURSED", label: "Disbursed" },
      { key: "REJECTED", label: "Rejected" },
    ],
    []
  );

  const rgbaRamp = useMemo(
    () =>
      (rgb: string, count: number, aMin = 0.22, aMax = 0.9) => {
        const safeCount = Math.max(1, count);
        const step = safeCount === 1 ? 0 : (aMax - aMin) / (safeCount - 1);
        return Array.from({ length: safeCount }, (_, i) => {
          const a = aMax - step * i;
          return `rgba(${rgb}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
        });
      },
    []
  );

  const ownerStatusChartData = useMemo(
    () => ({
      labels: ownerStatusOrder.map((s) => s.label),
      datasets: [
        {
          label: "Owner bookings",
          data: ownerStatusOrder.map((s) => normalizeCount(totals.single.byStatus[s.key])),
          backgroundColor: rgbaRamp("2, 102, 94", ownerStatusOrder.length, 0.18, 0.85),
          borderColor: "rgba(255, 255, 255, 0.95)",
          borderWidth: 2,
        },
      ],
    }),
    [ownerStatusOrder, rgbaRamp, totals.single.byStatus]
  );

  const groupStayBars = useMemo(() => {
    const total = normalizeCount(kpiGroup);
    const by = totals.groupStays.byStatus;

    const spec = [
      { key: "PENDING", label: "Pending", color: "bg-violet-500" },
      { key: "PROCESSING", label: "Processing", color: "bg-pink-500" },
      { key: "CONFIRMED", label: "Confirmed", color: "bg-sky-500" },
      { key: "COMPLETED", label: "Completed", color: "bg-blue-600" },
      { key: "CANCELED", label: "Canceled", color: "bg-teal-500" },
    ] as const;

    return spec.map((s) => {
      const count = normalizeCount(by[s.key] ?? 0);
      return {
        key: s.key,
        label: s.label,
        color: s.color,
        count,
        pct: pctOf(total, count),
      };
    });
  }, [kpiGroup, totals.groupStays.byStatus]);

  const tourStatusChartData = useMemo(
    () => ({
      labels: tourStatusOrder.map((s) => s.label),
      datasets: [
        {
          label: "Tour bookings",
          data: tourStatusOrder.map((s) => normalizeCount(totals.tourBookings.byStatus[s.key])),
          backgroundColor: rgbaRamp("245, 158, 11", tourStatusOrder.length, 0.22, 0.9),
          borderColor: "rgba(255, 255, 255, 0.95)",
          borderWidth: 2,
        },
      ],
    }),
    [tourStatusOrder, rgbaRamp, totals.tourBookings.byStatus]
  );

  async function printReport() {
    const printWindow = openAdminReportPrintWindow();
    if (!printWindow) {
      alert("Unable to open the report preview. Please allow popups and try again.");
      return;
    }
    const now = new Date();
    const reportId = now.toISOString();
    const pad2 = (value: number) => String(value).padStart(2, "0");
    const reportFilename = `NoLSAF-BOOKING-RPT-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}_${from}_${to}`;

    const ownerStatusImg = ownerChartCanvas ? ownerChartCanvas.toDataURL("image/png") : null;
    const tourStatusImg = tourChartCanvas ? tourChartCanvas.toDataURL("image/png") : null;

    // Seal the report server side, then encode the public verification URL as a
    // QR. Anyone can scan it to confirm the report is genuine without logging in.
    let reportRef = `BR-${from.replace(/-/g, "")}-${to.replace(/-/g, "")}-${reportId.slice(11, 19).replace(/:/g, "")}`;
    let verifyQrDataUrl: string | null = null;
    try {
      const sealRes = await fetch("/api/reports/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "BOOKINGS",
          title: "Management Booking Reports",
          ref: reportRef,
          from,
          to,
          figures: [
            { label: "Owner bookings (total)", value: fmtInt(kpiSingle) },
            ...ownerStatusOrder.map((s) => ({ label: `Owner: ${s.label}`, value: fmtInt(normalizeCount(totals.single.byStatus[s.key])) })),
            { label: "Group stays (total)", value: fmtInt(kpiGroup) },
            ...groupStayBars.map((b) => ({ label: `Group: ${b.label}`, value: fmtInt(b.count) })),
            { label: "Tour bookings (total)", value: fmtInt(kpiTour) },
            ...tourStatusOrder.map((s) => ({ label: `Tour: ${s.label}`, value: fmtInt(normalizeCount(totals.tourBookings.byStatus[s.key])) })),
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
          verifyQrDataUrl = await toDataURL(verifyUrl.toString(), {
            margin: 1,
            width: 320,
            errorCorrectionLevel: "M",
          });
        }
      }
    } catch {
      verifyQrDataUrl = null;
    }

    const fmt = (n: number | null) => fmtInt(n);

    const ownerDetailHead =
      "<thead><tr>" +
      [
        "Name",
        "Gender",
        "Nationality",
        "Amount",
        "Paid at",
        "Property Name",
        "Check-in & out",
        "Rating",
      ]
        .map((h) => `<th>${escapeHtml(h)}</th>`)
        .join("") +
      "</tr></thead>";

    const groupOverviewHead =
      "<thead><tr>" +
      [
        "Name",
        "Phone",
        "Status",
        "Stay",
        "Accepted Property",
        "Confirmed Property",
        "Currency",
      ]
        .map((h) => `<th>${escapeHtml(h)}</th>`)
        .join("") +
      "</tr></thead>";

    const groupFinanceHead =
      "<thead><tr>" +
      [
        "Name",
        "Gender",
        "Nationality",
        "Accepted Amount",
        "Confirmed Amount",
        "Created",
        "Accepted",
        "Confirmed",
      ]
        .map((h) => `<th>${escapeHtml(h)}</th>`)
        .join("") +
      "</tr></thead>";

    const tourDetailHead =
      "<thead><tr>" +
      [
        "Booking code",
        "Operator",
        "Tour",
        "Destination",
        "Travelers",
        "Gross amount",
        "Commission",
        "Currency",
        "Status",
        "Created",
      ]
        .map((h) => `<th>${escapeHtml(h)}</th>`)
        .join("") +
      "</tr></thead>";

    const ownerDetailRows = ownerItems
      .map((b) => {
        const name = b.guestName || b.user?.name || "—";
        const gender = b.sex || "—";
        const nationality = b.nationality || "—";
        const amountCandidate = b.payment?.amount ?? b.invoice?.total ?? null;
        const paidAtCandidate = b.payment?.paidAt ?? b.invoice?.paidAt ?? null;
        const paidAmount = numOrNull(amountCandidate) === null ? "—" : fmtAmount(amountCandidate);
        const paidAt = paidAtCandidate ? fmtDateTime(paidAtCandidate) : "—";
        const property = b.property?.title || "—";
        const stay = `${fmtDateOnly(b.checkIn)} → ${fmtDateOnly(b.checkOut)}`;
        const rating = b.review?.rating ?? null;
        const ratingTxt = rating === null || rating === undefined ? "—" : String(rating);
        const cells = [name, gender, nationality, paidAmount, paidAt, property, stay, ratingTxt]
          .map((v) => `<td>${escapeHtml(String(v ?? "—"))}</td>`)
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("\n");

    const groupOverviewRows = groupItems
      .map((b) => {
        const name = b.leadPassenger?.name || b.user?.name || "—";
        const phone = b.leadPassenger?.phone || b.user?.phone || "—";
        const status = b.status || "—";
        const currency = b.currency || "—";
        const acceptedProperty = b.acceptedProperty?.title || "—";
        const confirmedProperty = b.confirmedProperty?.title || "—";
        const stay = `${fmtDateOnly(b.checkIn)} → ${fmtDateOnly(b.checkOut)}`;
        const cells = [name, phone, status, stay, acceptedProperty, confirmedProperty, currency]
          .map((v) => `<td>${escapeHtml(String(v ?? "—"))}</td>`)
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("\n");

    const groupFinanceRows = groupItems
      .map((b) => {
        const name = b.leadPassenger?.name || b.user?.name || "—";
        const gender = b.leadPassenger?.gender || "—";
        const nationality = b.leadPassenger?.nationality || "—";
        const acceptedAmount = fmtAmount(b.acceptedTotalAmount ?? null);
        const confirmedAmount = fmtAmount(b.confirmedTotalAmount ?? null);
        const created = b.createdAt ? fmtDateTime(b.createdAt) : "—";
        const accepted = b.acceptedAt ? fmtDateTime(b.acceptedAt) : "—";
        const confirmed = b.confirmedAt ? fmtDateTime(b.confirmedAt) : "—";
        const cells = [
          name,
          gender,
          nationality,
          acceptedAmount,
          confirmedAmount,
          created,
          accepted,
          confirmed,
        ]
          .map((v) => `<td>${escapeHtml(String(v ?? "—"))}</td>`)
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("\n");

    const tourDetailRows = tourItems
      .map((b) => {
        const bookingCode = b.bookingCode || `#${b.id}`;
        const operator = b.operatorName || "—";
        const tour = b.tourTitle || "—";
        const destination = b.destination || "—";
        const travelers = b.numberOfPeople === null || b.numberOfPeople === undefined ? "—" : String(b.numberOfPeople);
        const gross = numOrNull(b.grossAmount) === null ? "—" : fmtAmount(b.grossAmount);
        const commission = numOrNull(b.commissionAmount) === null ? "—" : fmtAmount(b.commissionAmount);
        const currency = b.currency || "—";
        const status = b.status || "—";
        const created = b.createdAt ? fmtDateTime(b.createdAt) : "—";
        const cells = [
          bookingCode,
          operator,
          tour,
          destination,
          travelers,
          gross,
          commission,
          currency,
          status,
          created,
        ]
          .map((v) => `<td>${escapeHtml(String(v ?? "—"))}</td>`)
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("\n");

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

    const groupBarsHtml = (() => {
      const colorByKey: Record<string, string> = {
        PENDING: "#a855f7",
        PROCESSING: "#ec4899",
        CONFIRMED: "#0ea5e9",
        COMPLETED: "#2563eb",
        CANCELED: "#14b8a6",
      };
      const total = normalizeCount(kpiGroup);
      const rows = [
        { key: "PENDING", label: "Pending" },
        { key: "PROCESSING", label: "Processing" },
        { key: "CONFIRMED", label: "Confirmed" },
        { key: "COMPLETED", label: "Completed" },
        { key: "CANCELED", label: "Canceled" },
      ] as const;
      const clip = "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)";

      return rows
        .map((r) => {
          const count = normalizeCount(totals.groupStays.byStatus[r.key] ?? 0);
          const pct = pctOf(total, count);
          const color = colorByKey[r.key] ?? "#334155";

          if (pct > 0) {
            return `
              <div style="display:flex;align-items:center;gap:8px;margin-top:5px;">
                <div style="width:86px;font-size:7.5px;font-weight:700;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(
                  r.label
                )}</div>
                <div style="flex:1;">
                  <div style="height:22px;background:#f3f4f6;border-radius:4px;overflow:hidden;">
                    <div style="height:22px;width:${pct}%;min-width:42px;background:${escapeAttr(
                      color
                    )};display:flex;align-items:center;justify-content:flex-end;">
                      <div style="height:22px;display:flex;align-items:center;padding:0 7px;color:#fff;font-size:7px;font-weight:900;border-left:1px solid rgba(255,255,255,0.85);clip-path:${escapeAttr(
                        clip
                      )};">${pct}%</div>
                    </div>
                  </div>
                </div>
              </div>`;
          }

          return `
            <div style="display:flex;align-items:center;gap:8px;margin-top:5px;">
              <div style="width:86px;font-size:7.5px;font-weight:700;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(
                r.label
              )}</div>
              <div style="flex:1;">
                <div style="height:22px;background:#f3f4f6;border-radius:4px;overflow:hidden;display:flex;align-items:center;padding:0 4px;">
                  <div style="height:16px;display:flex;align-items:center;padding:0 7px;background:#fff;border:1px solid #e5e7eb;color:#334155;font-size:7px;font-weight:900;clip-path:${escapeAttr(
                    clip
                  )};">0%</div>
                </div>
              </div>
            </div>`;
        })
        .join("\n");
    })();

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
    .idbar { height: 26px; width: auto; max-width: 190px; margin-top: 5px; display:inline-block; }
    .idbarRef { margin-top: 2px; font-size: 8px; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); }
    .title { margin-top: 12px; display:flex; justify-content:space-between; align-items:flex-end; gap: 12px; }
    h1 { margin:0; font-size: 18px; letter-spacing: -0.02em; }
    .sub { margin-top: 4px; color: var(--muted); font-size: 11px; }
    .section { margin-top: 14px; }
    .section h2 { margin: 0 0 8px; font-size: 12px; letter-spacing: -0.01em; }
    .grid { display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .card { border:1px solid var(--line); border-radius: 14px; padding: 10px 12px; }
    .divider { height: 1px; background: var(--line); margin: 16px 0; }
    .chartImg { width: 100%; height: auto; border-radius: 12px; border:1px solid var(--line); background:#fff; }
    .kpiGrid { display:grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .kpiTile { border:1px solid var(--line); border-radius: 12px; padding: 8px 10px; }
    .kpiLabel { color: var(--muted); font-size: 10px; font-weight: 700; }
    .kpiValue { margin-top: 2px; font-weight: 900; color: var(--ink); font-size: 13px; }
    table { width:100%; border-collapse: collapse; border:1px solid var(--line); border-radius: 14px; overflow:hidden; }
    thead th { font-size: 10px; text-align:left; color: var(--muted); background:#f8fafc; padding: 9px 10px; border-bottom:1px solid var(--line); }
    tbody td { font-size: 11px; padding: 8px 10px; border-bottom: 1px solid rgba(229,231,235,0.8); }
    tbody tr:last-child td { border-bottom: none; }
    .verify { display:flex; gap: 18px; align-items:stretch; break-inside: avoid; page-break-inside: avoid; }
    .refBox { align-self:flex-start; display:inline-flex; flex-direction:column; align-items:center; gap: 6px; border:1px solid var(--line); border-radius: 12px; padding: 10px 12px; background:#fff; }
    .refBox img { width: 126px; height: 126px; display:block; }
    .refLabel { font-size: 10px; font-weight: 900; letter-spacing: 0.02em; color: var(--ink); }
    .verifyText { flex:1; min-width:0; border-left: 1px solid var(--line); padding-left: 18px; display:flex; flex-direction:column; justify-content:center; }
    .qrTitle { font-weight: 900; color: var(--ink); letter-spacing: 0.14em; text-transform: uppercase; font-size: 9px; }
    .qrNote { margin-top: 5px; color: var(--muted); font-size: 10px; max-width: 420px; line-height: 1.55; }
    @media print { @page { size: A4; margin: 12mm; } .page { padding: 0; } .sheet { border-radius: 14px; padding: 12px; } }
    ${adminReportPrintStyles("landscape")}
  </style>
</head>
<body>
  <div class="reportPage">
    <main class="reportDocument">
      ${buildAdminReportHeader({
        logoUrl,
        eyebrow: "NoLSAF operations control",
        title: "Booking operations report",
        description: "Owner property bookings, group stays, and tour bookings presented as separate operational registers.",
        reportId,
        reportRef,
        barcodeDataUrl: reportIdBarcode,
        from,
        to,
        generatedAt: fmtDateTime(reportId),
        classification: "Operations and management use",
      })}

      <div class="metricGrid">
        <div class="metricCard metricCardGood"><span class="metricLabel">Owner bookings</span><strong>${escapeHtml(fmt(kpiSingle))}</strong><small>Standard bookings connected to NoLSAF properties.</small></div>
        <div class="metricCard"><span class="metricLabel">Group stays</span><strong>${escapeHtml(fmt(kpiGroup))}</strong><small>Group requests and confirmed group accommodation.</small></div>
        <div class="metricCard"><span class="metricLabel">Tour bookings</span><strong>${escapeHtml(fmt(kpiTour))}</strong><small>Booked tour activities recorded for this period.</small></div>
      </div>

      ${
        ownerStatusImg || tourStatusImg || true
          ? `
      <section class="reportSection">
        <div class="sectionHead"><span class="sectionNumber">01</span><div><h2>Booking flow summary</h2><p>Operational position across owner bookings, group stays, and tours.</p></div></div>
        <div class="panelGrid">
          <div class="reportPanel">
            <div class="panelTitle">Owner bookings by status</div><div class="panelBody">
            ${ownerStatusImg ? `<img class="chartImage" src="${escapeAttr(ownerStatusImg)}" alt="Owner bookings chart" />` : `<div class="emptyState">Owner booking chart is not available.</div>`}</div>
          </div>
          <div class="reportPanel">
            <div class="panelTitle">Group stays by status</div><div class="panelBody">
            ${groupBarsHtml}</div>
          </div>
          <div class="reportPanel">
            <div class="panelTitle">Tour bookings by status</div><div class="panelBody">
            ${tourStatusImg ? `<img class="chartImage" src="${escapeAttr(tourStatusImg)}" alt="Tour bookings chart" />` : `<div class="emptyState">Tour booking chart is not available.</div>`}</div>
          </div>
        </div>
      </section>`
          : ""
      }

      <section class="reportSection">
        <div class="sectionHead"><span class="sectionNumber">02</span><div><h2>Owner booking register</h2><p>Guest, stay, property, payment, and rating details for standard property bookings.</p></div></div>
        <div class="tableWrap"><table>${ownerDetailHead}<tbody>${ownerDetailRows || `<tr><td colspan="8" class="emptyState">No owner bookings were recorded in this period.</td></tr>`}</tbody></table></div>
      </section>

      <section class="reportSection">
        <div class="sectionHead"><span class="sectionNumber">03</span><div><h2>Group stay register</h2><p>Operational placement and financial progression are separated to keep every field readable.</p></div></div>
        <div class="reportPanel"><div class="panelTitle">Stay and property placement</div><div class="tableWrap"><table>${groupOverviewHead}<tbody>${groupOverviewRows || `<tr><td colspan="7" class="emptyState">No group stays were recorded in this period.</td></tr>`}</tbody></table></div></div>
        <div class="reportPanel" style="margin-top:8px"><div class="panelTitle">Value and workflow timeline</div><div class="tableWrap"><table>${groupFinanceHead}<tbody>${groupFinanceRows || `<tr><td colspan="8" class="emptyState">No group stay finance records were recorded in this period.</td></tr>`}</tbody></table></div></div>
      </section>

      <section class="reportSection">
        <div class="sectionHead"><span class="sectionNumber">04</span><div><h2>Tour booking register</h2><p>Operator, destination, traveler, value, commission, and status detail.</p></div></div>
        <div class="tableWrap"><table>${tourDetailHead}<tbody>${tourDetailRows || `<tr><td colspan="10" class="emptyState">No tour bookings were recorded in this period.</td></tr>`}</tbody></table></div>
      </section>

      ${buildAdminReportFooter({
        reportRef,
        qrDataUrl: verifyQrDataUrl,
        purpose: "Scan the QR code to confirm the sealed booking totals on the public NoLSAF verification page.",
        signatureLabel: "Operations authorization",
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
        <button type="button" onClick={printReport} className="inline-flex h-9 items-center gap-2 rounded-lg border-0 bg-[#073c35] px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-emerald-800">
          <Printer className="h-3.5 w-3.5" aria-hidden />
          Print / PDF
        </button>
      }
    >
      <NoLSAFReportTitle
        icon="bookings"
        eyebrow="Operational performance"
        title="Booking operations report"
        text="Owner property bookings, group stays, and tour activity with status and detailed registers."
      />

              {error ? (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden />
                  <div className="min-w-0">
                    <div className="font-semibold">Couldn’t load stats</div>
                    <div className="break-words text-amber-800/90">{error}</div>
                  </div>
                </div>
              ) : null}

              {/* Controls toolbar */}
              <section className="grid min-w-0 gap-4 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm lg:grid-cols-[minmax(0,360px)_1px_minmax(0,1fr)] lg:items-end" aria-label="Booking report controls">
                <div className="min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Reporting period</div>
                  <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
                    <div className="min-w-0">
                      <div className="mb-1 text-[9px] font-semibold text-neutral-500">From</div>
                      <DatePickerField label="From date" value={from} max={to} onChangeAction={(nextIso) => setFrom(nextIso)} widthClassName="w-full" size="sm" twoMonths={false} allowPast />
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1 text-[9px] font-semibold text-neutral-500">To</div>
                      <DatePickerField label="To date" value={to} min={from} onChangeAction={(nextIso) => setTo(nextIso)} widthClassName="w-full" size="sm" twoMonths={false} allowPast />
                    </div>
                  </div>
                </div>

                <div className="hidden self-stretch bg-neutral-200 lg:block" aria-hidden />

                <div className="min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Quick range</div>
                  <div className="mt-2 flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <div className="grid w-max min-w-full grid-flow-col auto-cols-[minmax(88px,1fr)] items-center gap-1.5 p-0.5" aria-label="Quick report periods">
                      {(
                        [
                          { key: "today" as const, label: "Today", hint: "Today", days: 0 },
                          { key: "7d" as const, label: "7 days", hint: "Last 7 days", days: 6 },
                          { key: "30d" as const, label: "30 days", hint: "Last 30 days", days: 29 },
                          { key: "3m" as const, label: "3 months", hint: "Last 3 months" },
                          { key: "6m" as const, label: "6 months", hint: "Last 6 months" },
                          { key: "ytd" as const, label: "YTD", hint: "Year to date" },
                          { key: "12m" as const, label: "12 months", hint: "Last 12 months" },
                        ] as const
                      ).map((p) => {
                        const r = "days" in p ? getQuickRange(p.days) : getMoreRange(p.key);
                        const active = from === r.from && to === r.to;
                        return (
                          <RangePill
                            key={p.key}
                            label={p.label}
                            hint={p.hint}
                            active={active}
                            onClick={() => {
                              setFrom(r.from);
                              setTo(r.to);
                            }}
                          />
                        );
                      })}

                      </div>
                  </div>
                  <button type="button" onClick={() => void load()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700" title="Refresh" aria-label="Refresh">
                    <RefreshCw className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                </div>
              </section>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-xl bg-[#02665e]/10 flex items-center justify-center"><FileText className="h-3.5 w-3.5 text-[#02665e]" aria-hidden /></span>
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Owner bookings</div>
              </div>
              <div className="ml-auto text-lg font-bold tabular-nums text-neutral-950">{fmtInt(kpiSingle)}</div>
            </div>
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-xl bg-sky-50 flex items-center justify-center"><Users className="h-3.5 w-3.5 text-sky-500" aria-hidden /></span>
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Group stays</div>
              </div>
              <div className="ml-auto text-lg font-bold tabular-nums text-neutral-950">{fmtInt(kpiGroup)}</div>
            </div>
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-xl bg-amber-50 flex items-center justify-center"><ClipboardList className="h-3.5 w-3.5 text-amber-500" aria-hidden /></span>
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Tour bookings</div>
              </div>
              <div className="ml-auto text-lg font-bold tabular-nums text-neutral-950">{fmtInt(kpiTour)}</div>
            </div>
          </div>

          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-neutral-950">Visual summary</div>
                <div className="mt-0.5 text-[10px] text-neutral-500">Status breakdown across the three booking streams.</div>
              </div>
              {loading ? <div className="text-xs text-slate-400 font-medium">Loading…</div> : null}
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Owner bookings by status</div>
                <Chart
                  type="pie"
                  data={ownerStatusChartData as any}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        display: true,
                        position: "bottom",
                        labels: { color: "#4b5563", boxWidth: 10, boxHeight: 10, font: { size: 10 } },
                      },
                      tooltip: { enabled: true },
                    },
                  } as any}
                  height={190}
                  onCanvas={setOwnerChartCanvas}
                />
              </div>

              <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Group stays status</div>
                <div className="grid grid-cols-1 gap-2">
                  {groupStayBars.map((row) => (
                    <PercentBarRow key={row.key} label={row.label} pct={row.pct} colorClassName={row.color} />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Tour bookings by status</div>
                <Chart
                  type="doughnut"
                  data={tourStatusChartData as any}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "62%",
                    plugins: {
                      legend: {
                        display: true,
                        position: "bottom",
                        labels: { color: "#4b5563", boxWidth: 10, boxHeight: 10, font: { size: 10 } },
                      },
                      tooltip: { enabled: true },
                    },
                  } as any}
                  height={190}
                  onCanvas={setTourChartCanvas}
                />
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                <span className="h-7 w-7 rounded-xl bg-[#02665e]/10 flex items-center justify-center"><FileText className="h-3.5 w-3.5 text-[#02665e]" aria-hidden /></span>
                <div className="text-sm font-black text-slate-900">Owner bookings</div>
              </div>
              <div className="mt-3 space-y-1.5">
                {[
                  { label: "Total", value: fmtInt(kpiSingle), bold: true },
                  { label: "New", value: totals.single.byStatus["NEW"] ?? "—" },
                  { label: "Validated", value: totals.single.byStatus["CONFIRMED"] ?? "—" },
                  { label: "Check-in", value: String(Math.round(singleCheckedIn || 0)) },
                  { label: "Check-out", value: totals.single.byStatus["CHECKED_OUT"] ?? "—" },
                  { label: "Canceled", value: totals.single.byStatus["CANCELED"] ?? "—" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-1">
                    <span className="text-xs text-slate-500">{row.label}</span>
                    <span className={"text-sm " + (row.bold ? "font-black text-[#02665e]" : "font-semibold text-slate-800")}>{String(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                <span className="h-7 w-7 rounded-xl bg-sky-50 flex items-center justify-center"><Users className="h-3.5 w-3.5 text-sky-500" aria-hidden /></span>
                <div className="text-sm font-black text-slate-900">Group stays</div>
              </div>
              <div className="mt-3 space-y-1.5">
                {[
                  { label: "Total", value: fmtInt(kpiGroup), bold: true },
                  { label: "Pending", value: totals.groupStays.byStatus["PENDING"] ?? "—" },
                  { label: "Processing", value: totals.groupStays.byStatus["PROCESSING"] ?? "—" },
                  { label: "Confirmed", value: totals.groupStays.byStatus["CONFIRMED"] ?? "—" },
                  { label: "Completed", value: totals.groupStays.byStatus["COMPLETED"] ?? "—" },
                  { label: "Canceled", value: totals.groupStays.byStatus["CANCELED"] ?? "—" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-1">
                    <span className="text-xs text-slate-500">{row.label}</span>
                    <span className={"text-sm " + (row.bold ? "font-black text-sky-600" : "font-semibold text-slate-800")}>{String(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                <span className="h-7 w-7 rounded-xl bg-amber-50 flex items-center justify-center"><ClipboardList className="h-3.5 w-3.5 text-amber-500" aria-hidden /></span>
                <div className="text-sm font-black text-slate-900">Tour bookings</div>
              </div>
              <div className="mt-3 space-y-1.5">
                {[
                  { label: "Total", value: fmtInt(kpiTour), bold: true },
                  { label: "New", value: totals.tourBookings.byStatus["NEW"] ?? "—" },
                  { label: "Claimed", value: totals.tourBookings.byStatus["CLAIMED"] ?? "—" },
                  { label: "Verified", value: totals.tourBookings.byStatus["VERIFIED"] ?? "—" },
                  { label: "Approved", value: totals.tourBookings.byStatus["APPROVED"] ?? "—" },
                  { label: "Disbursed", value: totals.tourBookings.byStatus["DISBURSED"] ?? "—" },
                  { label: "Rejected", value: totals.tourBookings.byStatus["REJECTED"] ?? "—" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-1">
                    <span className="text-xs text-slate-500">{row.label}</span>
                    <span className={"text-sm " + (row.bold ? "font-black text-amber-600" : "font-semibold text-slate-800")}>{String(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-4 py-3 text-sm font-bold text-neutral-950">Owner booking register</div>
            <div className="overflow-x-auto px-3 pb-3">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Name</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Gender</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Nationality</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Amount</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Paid at</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Property Name</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Check-in &amp; out</th>
                    <th className="py-2.5 pr-0 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ownerItems.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-400 text-sm" colSpan={8}>
                        No records in this range.
                      </td>
                    </tr>
                  ) : (
                    ownerItems.map((b) => {
                      const name = b.guestName || b.user?.name || "—";
                      const gender = b.sex || "—";
                      const nationality = b.nationality || "—";
                      const amountCandidate = b.payment?.amount ?? b.invoice?.total ?? null;
                      const paidAtCandidate = b.payment?.paidAt ?? b.invoice?.paidAt ?? null;
                      const amount = numOrNull(amountCandidate) === null ? "—" : fmtAmount(amountCandidate);
                      const paidAt = paidAtCandidate ? fmtDateTime(paidAtCandidate) : "—";
                      const property = b.property?.title || "—";
                      const stay = `${fmtDateOnly(b.checkIn)} → ${fmtDateOnly(b.checkOut)}`;
                      const rating = b.review?.rating;
                      return (
                        <tr key={`ob-${b.id}`}>
                          <td className="py-2 pr-4 text-slate-900 font-semibold whitespace-nowrap">{name}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{gender}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{nationality}</td>
                          <td className="py-2 pr-4 text-slate-900 font-semibold whitespace-nowrap">{amount}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{paidAt}</td>
                          <td className="py-2 pr-4 text-slate-700">{property}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{stay}</td>
                          <td className="py-2 pr-0 text-slate-500 whitespace-nowrap">{rating ?? "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-4 py-3 text-sm font-bold text-neutral-950">Group stay register</div>
            <div className="overflow-x-auto px-3 pb-3">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Name</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Phone</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Gender</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Nationality</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Status</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Accepted Amount</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Confirmed Amount</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Currency</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Accepted Property</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Confirmed Property</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Check-in &amp; out</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Created</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Accepted</th>
                    <th className="py-2.5 pr-0 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Confirmed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groupItems.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-400 text-sm" colSpan={14}>
                        No records in this range.
                      </td>
                    </tr>
                  ) : (
                    groupItems.map((b) => {
                      const name = b.leadPassenger?.name || b.user?.name || "—";
                      const phone = b.leadPassenger?.phone || b.user?.phone || "—";
                      const gender = b.leadPassenger?.gender || "—";
                      const nationality = b.leadPassenger?.nationality || "—";
                      const status = b.status || "—";
                      const acceptedAmount = fmtAmount(b.acceptedTotalAmount ?? null);
                      const confirmedAmount = fmtAmount(b.confirmedTotalAmount ?? null);
                      const currency = b.currency || "—";
                      const acceptedProperty = b.acceptedProperty?.title || "—";
                      const confirmedProperty = b.confirmedProperty?.title || "—";
                      const stay = `${fmtDateOnly(b.checkIn)} → ${fmtDateOnly(b.checkOut)}`;
                      const created = b.createdAt ? fmtDateTime(b.createdAt) : "—";
                      const accepted = b.acceptedAt ? fmtDateTime(b.acceptedAt) : "—";
                      const confirmed = b.confirmedAt ? fmtDateTime(b.confirmedAt) : "—";
                      return (
                        <tr key={`gb-${b.id}`}>
                          <td className="py-2 pr-4 text-slate-900 font-semibold whitespace-nowrap">{name}</td>
                          <td className="py-2 pr-4 text-slate-700 whitespace-nowrap">{phone}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{gender}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{nationality}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{status}</td>
                          <td className="py-2 pr-4 text-slate-900 font-semibold whitespace-nowrap">{acceptedAmount}</td>
                          <td className="py-2 pr-4 text-slate-900 font-semibold whitespace-nowrap">{confirmedAmount}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{currency}</td>
                          <td className="py-2 pr-4 text-slate-700">{acceptedProperty}</td>
                          <td className="py-2 pr-4 text-slate-700">{confirmedProperty}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{stay}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{created}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{accepted}</td>
                          <td className="py-2 pr-0 text-slate-500 whitespace-nowrap">{confirmed}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-4 py-3 text-sm font-bold text-neutral-950">Tour booking register</div>
            <div className="overflow-x-auto px-3 pb-3">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Booking code</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Operator</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Tour</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Destination</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Travelers</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Gross amount</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Commission</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Currency</th>
                    <th className="py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Status</th>
                    <th className="py-2.5 pr-0 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tourItems.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-400 text-sm" colSpan={10}>
                        No records in this range.
                      </td>
                    </tr>
                  ) : (
                    tourItems.map((b) => {
                      const bookingCode = b.bookingCode || `#${b.id}`;
                      const operator = b.operatorName || "—";
                      const tour = b.tourTitle || "—";
                      const destination = b.destination || "—";
                      const travelers = b.numberOfPeople === null || b.numberOfPeople === undefined ? "—" : String(b.numberOfPeople);
                      const gross = numOrNull(b.grossAmount) === null ? "—" : fmtAmount(b.grossAmount);
                      const commission = numOrNull(b.commissionAmount) === null ? "—" : fmtAmount(b.commissionAmount);
                      const currency = b.currency || "—";
                      const status = b.status || "—";
                      const created = b.createdAt ? fmtDateTime(b.createdAt) : "—";
                      return (
                        <tr key={`tb-${b.id}`}>
                          <td className="py-2 pr-4 text-slate-900 font-semibold whitespace-nowrap">{bookingCode}</td>
                          <td className="py-2 pr-4 text-slate-700 whitespace-nowrap">{operator}</td>
                          <td className="py-2 pr-4 text-slate-700">{tour}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{destination}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{travelers}</td>
                          <td className="py-2 pr-4 text-slate-900 font-semibold whitespace-nowrap">{gross}</td>
                          <td className="py-2 pr-4 text-slate-900 font-semibold whitespace-nowrap">{commission}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{currency}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{status}</td>
                          <td className="py-2 pr-0 text-slate-500 whitespace-nowrap">{created}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {loading ? <div className="text-xs text-slate-400 font-medium text-center py-2">Loading…</div> : null}
    </NoLSAFReportsFrame>
  );
}
