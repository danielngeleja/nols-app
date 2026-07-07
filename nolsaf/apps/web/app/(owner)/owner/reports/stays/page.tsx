"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import ReportsFilter, { ReportsFilters } from "@/components/ReportsFilter";
import { Download, Printer, ShieldCheck, AlertTriangle } from "lucide-react";
import { escapeHtml } from "@/utils/html";

// Use same-origin requests to leverage Next.js rewrites and avoid CORS
const api = apiClient;

type OwnerHeader = {
  id: number;
  fullName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
};

type PropertyHeader = {
  id: number;
  title: string;
  regionName: string | null;
  district: string | null;
  ward: string | null;
  street: string | null;
  apartment: string | null;
  city: string | null;
  zip: string | null;
  country: string | null;
};

type StaysReport = {
  generatedAt: string;
  header: {
    from: string;
    to: string;
    groupBy: "day" | "week" | "month";
    owner: OwnerHeader | null;
    property: PropertyHeader | null;
  };
  stats: {
    nolsafBookings: number;
    externalReservations: number;
    groupStaysReceived: number;
    auctionClaimsSubmitted: number;
    auctionClaimsAccepted: number;
    revenueTzs: number;
    nightsBooked: number;
    nightsBlocked: number;
    groupStayNights: number;
  };
  series: Array<{ key: string; nolsaf: number; external: number; groupStays: number; revenueTzs: number }>;
  bookings: Array<{
    id: number;
    propertyId: number;
    checkIn: string;
    checkOut: string;
    status: string;
    totalAmount: string;
    ownerBaseAmount?: string;
    roomsQty: number;
    roomCode: string | null;
    guestName: string | null;
    guestPhone: string | null;
    nationality: string | null;
    sex: string | null;
    createdAt: string;
    property: PropertyHeader;
  }>;
  external: Array<{
    id: number;
    propertyId: number;
    startDate: string;
    endDate: string;
    roomCode: string | null;
    source: string | null;
    guestName?: string | null;
    guestPhone?: string | null;
    nationality?: string | null;
    amountPaid?: string | number | null;
    calculatedAmount?: string | number | null;
    currency?: string | null;
    bedsBlocked: number | null;
    createdAt: string;
    property: PropertyHeader;
  }>;
  groupStays: Array<{
    id: number;
    groupType: string;
    accommodationType: string;
    headcount: number;
    roomsNeeded: number;
    toRegion: string;
    toDistrict: string | null;
    toWard: string | null;
    toLocation: string | null;
    checkIn: string | null;
    checkOut: string | null;
    useDates: boolean;
    status: string;
    totalAmount: string | null;
    currency: string;
    isOpenForClaims: boolean;
    openedForClaimsAt: string | null;
    confirmedPropertyId: number | null;
    createdAt: string;
    confirmedProperty: PropertyHeader | null;
  }>;
  auctionClaims: Array<{
    id: number;
    groupBookingId: number;
    ownerId: number;
    propertyId: number;
    offeredPricePerNight: string;
    discountPercent: string | null;
    totalAmount: string;
    currency: string;
    status: string;
    reviewedAt: string | null;
    createdAt: string;
    updatedAt: string;
    property: PropertyHeader;
    groupBooking: {
      id: number;
      groupType: string;
      accommodationType: string;
      headcount: number;
      roomsNeeded: number;
      toRegion: string;
      toDistrict: string | null;
      toLocation: string | null;
      checkIn: string | null;
      checkOut: string | null;
      useDates: boolean;
      status: string;
      totalAmount: string | null;
      currency: string;
      isOpenForClaims: boolean;
      openedForClaimsAt: string | null;
      createdAt: string;
    };
  }>;
};

function fmtMoneyTZS(v: number) {
  const n = Number.isFinite(v) ? v : 0;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function buildPropertyAddress(p: PropertyHeader | null) {
  if (!p) return "All properties";
  const parts = [p.street, p.ward, p.district, p.city, p.regionName, p.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

function csvEscape(cell: unknown) {
  const s = String(cell ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function StaysReportPage() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<ReportsFilters | null>(null);
  const [data, setData] = useState<StaysReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const autoPrintDoneRef = useRef(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!filters) return;
    let mounted = true;
    setLoading(true);
    setError(null);

    api
      .get("/api/owner/reports/stays", { params: filters })
      .then((r) => {
        if (!mounted) return;
        setData(r.data);
      })
      .catch((e: any) => {
        if (!mounted) return;
        setData(null);
        setError(e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? "Failed to load stays report");
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [filters]);

  const ownerDisplay = useMemo(() => {
    const o = data?.header?.owner;
    if (!o) return "—";
    return (o.fullName || o.name || "Owner").toString();
  }, [data]);

  const propertyDisplay = useMemo(() => {
    const p = data?.header?.property;
    return p?.title || "All properties";
  }, [data]);

  const canExport = !!data && !loading;
  const canUseReportActions = isMounted && canExport;
  const shouldAutoPrint = searchParams.get("print") === "1";

  // Auction participation: surface the discounted stay total and how much the
  // owner will actually collect at check-in from ACCEPTED offers. The claim's
  // totalAmount is the owner's discounted payout (guest pays this directly at
  // the property; NoLSAF's commission was already paid as the online deposit).
  const auctionSummary = useMemo(() => {
    const claims = data?.auctionClaims ?? [];
    const accepted = claims.filter((c) => String(c.status || "").toUpperCase() === "ACCEPTED");
    const acceptedTotal = accepted.reduce((s, c) => s + Number(c.totalAmount || 0), 0);
    const currency = claims[0]?.currency || "TZS";
    return { acceptedCount: accepted.length, acceptedTotal, currency };
  }, [data]);

  useEffect(() => {
    if (!shouldAutoPrint || !canUseReportActions || autoPrintDoneRef.current) return;
    autoPrintDoneRef.current = true;
    const timer = window.setTimeout(() => {
      void printReport();
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoPrint, canUseReportActions, data?.generatedAt]);

  function exportCsv() {
    if (!data) return;

    const owner = data.header.owner;
    const property = data.header.property;

    const meta = {
      propertyTitle: property?.title ?? "All properties",
      propertyAddress: buildPropertyAddress(property),
      ownerName: owner ? (owner.fullName || owner.name || "").toString() : "",
      ownerEmail: owner?.email ?? "",
      ownerPhone: owner?.phone ?? "",
      rangeFrom: fmtDate(data.header.from),
      rangeTo: fmtDate(data.header.to),
      generatedAt: fmtDateTime(data.generatedAt),
    };

    const header = [
      "source",
      "property",
      "property_address",
      "owner_name",
      "owner_email",
      "owner_phone",
      "check_in",
      "check_out",
      "room_code",
      "status",
      "guest_name",
      "guest_phone",
      "nationality",
      "gender",
      "amount_paid_tzs",
      "external_source",
      "beds_blocked",
      "created_at",
      "group_stay_id",
      "group_type",
      "headcount",
      "rooms_needed",
      "auction_claim_id",
      "auction_claim_status",
      "offered_price_per_night_tzs",
      "discount_percent",
    ];

    const rows: unknown[][] = [header];

    for (const b of data.bookings || []) {
      rows.push([
        "NoLSAF",
        b.property?.title ?? meta.propertyTitle,
        buildPropertyAddress(b.property ?? property),
        meta.ownerName,
        meta.ownerEmail,
        meta.ownerPhone,
        fmtDate(b.checkIn),
        fmtDate(b.checkOut),
        b.roomCode ?? "",
        b.status ?? "",
        b.guestName ?? "",
        b.guestPhone ?? "",
        b.nationality ?? "",
        b.sex ?? "",
        String(b.ownerBaseAmount ?? b.totalAmount ?? ""),
        "",
        "",
        fmtDateTime(b.createdAt),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
    }

    for (const x of data.external || []) {
      rows.push([
        "External",
        x.property?.title ?? meta.propertyTitle,
        buildPropertyAddress(x.property ?? property),
        meta.ownerName,
        meta.ownerEmail,
        meta.ownerPhone,
        fmtDate(x.startDate),
        fmtDate(x.endDate),
        x.roomCode ?? "",
        "EXTERNAL",
        x.guestName ?? "",
        x.guestPhone ?? "",
        x.nationality ?? "",
        "",
        x.amountPaid ?? x.calculatedAmount ?? "",
        x.source ?? "",
        x.bedsBlocked ?? "",
        fmtDateTime(x.createdAt),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
    }

    for (const g of data.groupStays || []) {
      const p = g.confirmedProperty || property;
      rows.push([
        "GroupStay",
        p?.title ?? meta.propertyTitle,
        buildPropertyAddress(p ?? property),
        meta.ownerName,
        meta.ownerEmail,
        meta.ownerPhone,
        g.checkIn ? fmtDate(g.checkIn) : "",
        g.checkOut ? fmtDate(g.checkOut) : "",
        "",
        g.status ?? "",
        "",
        "",
        "",
        "",
        String(g.totalAmount ?? ""),
        "",
        "",
        fmtDateTime(g.createdAt),
        String(g.id),
        g.groupType ?? "",
        String(g.headcount ?? ""),
        String(g.roomsNeeded ?? ""),
        "",
        "",
        "",
        "",
      ]);
    }

    for (const c of data.auctionClaims || []) {
      rows.push([
        "AuctionClaim",
        c.property?.title ?? meta.propertyTitle,
        buildPropertyAddress(c.property ?? property),
        meta.ownerName,
        meta.ownerEmail,
        meta.ownerPhone,
        c.groupBooking?.checkIn ? fmtDate(c.groupBooking.checkIn) : "",
        c.groupBooking?.checkOut ? fmtDate(c.groupBooking.checkOut) : "",
        "",
        c.status ?? "",
        "",
        "",
        "",
        "",
        String(c.totalAmount ?? ""),
        "",
        "",
        fmtDateTime(c.createdAt),
        String(c.groupBookingId),
        c.groupBooking?.groupType ?? "",
        String(c.groupBooking?.headcount ?? ""),
        String(c.groupBooking?.roomsNeeded ?? ""),
        String(c.id),
        c.status ?? "",
        String(c.offeredPricePerNight ?? ""),
        String(c.discountPercent ?? ""),
      ]);
    }

    const safeProp = (propertyDisplay || "report").replace(/[^a-z0-9\-_]+/gi, "-");
    downloadCsv(`stays-report-${safeProp}-${data.header.from.slice(0, 10)}_to_${data.header.to.slice(0, 10)}.csv`, rows);
  }

  async function printReport() {
    if (!data) return;

    const owner = data.header.owner;
    const property = data.header.property;

    const ownerName = owner ? (owner.fullName || owner.name || "Owner").toString() : "Owner";
    const propertyTitle = property?.title ?? "All properties";
    const address = buildPropertyAddress(property);

    // Seal the report server side, then encode the public verification URL as a
    // QR so anyone can confirm it is genuine without logging in.
    let qrDataUrl: string | null = null;
    try {
      const refDigits = (s: string) => String(s || "").replace(/[^0-9]/g, "").slice(0, 8);
      const sealRes = await fetch("/api/reports/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "OWNER",
          title: "Property Stays Report",
          ref: `OWN-${refDigits(data.header.from)}-${refDigits(data.header.to)}`,
          from: String(data.header.from).slice(0, 10),
          to: String(data.header.to).slice(0, 10),
          figures: [
            { label: "Property", value: propertyTitle },
            { label: "View", value: data.header.groupBy },
            { label: "Revenue (TZS)", value: `TZS ${fmtMoneyTZS(Number(data.stats?.revenueTzs) || 0)}` },
            { label: "NoLSAF bookings", value: String(data.stats?.nolsafBookings ?? 0) },
            { label: "External reservations", value: String(data.stats?.externalReservations ?? 0) },
            { label: "Group stays received", value: String(data.stats?.groupStaysReceived ?? 0) },
            { label: "Auction claims submitted", value: String(data.stats?.auctionClaimsSubmitted ?? 0) },
            { label: "Auction claims accepted", value: String(data.stats?.auctionClaimsAccepted ?? 0) },
            { label: "Nights booked", value: String(data.stats?.nightsBooked ?? 0) },
            { label: "Nights blocked", value: String(data.stats?.nightsBlocked ?? 0) },
            { label: "Group stay nights", value: String(data.stats?.groupStayNights ?? 0) },
          ],
        }),
      });
      const sealJson: any = await sealRes.json();
      if (sealJson?.token) {
        const verifyUrl = `${window.location.origin}/verify?t=${encodeURIComponent(String(sealJson.token))}`;
        const QR: any = await import("qrcode");
        const toDataURL: any = QR?.toDataURL ?? QR?.default?.toDataURL;
        if (typeof toDataURL === "function") {
          qrDataUrl = await toDataURL(verifyUrl, { margin: 1, width: 180, errorCorrectionLevel: "M" });
        }
      }
    } catch {
      qrDataUrl = null;
    }

    // Embed the NoLSAF logo as a base64 data URL so the print popup can render it
    let logoDataUrl: string | null = null;
    try {
      const logoRes = await fetch("/assets/NoLS2025-04.png");
      if (logoRes.ok) {
        const blob = await logoRes.blob();
        logoDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      logoDataUrl = null;
    }

    const maxSeries = Math.max(1, ...((data.series || []).map((s) => Math.max(s.nolsaf + s.external + (s.groupStays || 0), 1)) || [1]));

    const rowsBookings = (data.bookings || [])
      .map((b) => {
        return `
<tr>
  <td>${escapeHtml(b.guestName || "Guest")}</td>
  <td>${escapeHtml(fmtDate(b.checkIn))}</td>
  <td>${escapeHtml(fmtDate(b.checkOut))}</td>
  <td>${escapeHtml(b.nationality || "—")}</td>
  <td>${escapeHtml(b.sex || "—")}</td>
  <td style="text-align:right;">TZS ${escapeHtml(fmtMoneyTZS(Number(b.ownerBaseAmount || b.totalAmount || 0)))}</td>
  <td>${escapeHtml(b.status || "—")}</td>
</tr>`;
      })
      .join("\n");

    const rowsExternal = (data.external || [])
      .map((x) => {
        return `
<tr>
  <td>${escapeHtml(x.source || "External")}</td>
  <td>${escapeHtml(x.guestName || "Guest")}</td>
  <td>${escapeHtml(x.nationality || "—")}</td>
  <td>${escapeHtml(fmtDate(x.startDate))}</td>
  <td>${escapeHtml(fmtDate(x.endDate))}</td>
  <td>${escapeHtml(x.roomCode || "—")}</td>
  <td style="text-align:right;">${escapeHtml(x.amountPaid != null ? `TZS ${fmtMoneyTZS(Number(x.amountPaid))}` : "")}</td>
  <td style="text-align:right;">${escapeHtml(String(x.bedsBlocked ?? "1"))}</td>
</tr>`;
      })
      .join("\n");

    const rowsGroupStays = (data.groupStays || [])
      .map((g) => {
        const dest = [g.toRegion, g.toDistrict, g.toLocation].filter(Boolean).join(" • ") || "—";
        return `
<tr>
  <td>${escapeHtml(String(g.groupType || "—"))}</td>
  <td>${escapeHtml(dest)}</td>
  <td>${escapeHtml(g.checkIn ? fmtDate(g.checkIn) : "—")}</td>
  <td>${escapeHtml(g.checkOut ? fmtDate(g.checkOut) : "—")}</td>
  <td style="text-align:right;">${escapeHtml(String(g.headcount ?? "—"))}</td>
  <td>${escapeHtml(String(g.status || "—"))}</td>
</tr>`;
      })
      .join("\n");

    const rowsAuctionClaims = (data.auctionClaims || [])
      .map((c) => {
        const cur = c.currency || "TZS";
        return `
<tr>
  <td>#${escapeHtml(String(c.groupBookingId))}</td>
  <td>${escapeHtml(String(c.property?.title || "—"))}</td>
  <td style="text-align:right;">${escapeHtml(cur)} ${escapeHtml(fmtMoneyTZS(Number(c.offeredPricePerNight || 0)))}</td>
  <td style="text-align:right;">${escapeHtml(c.discountPercent ? String(c.discountPercent) + '%' : '—')}</td>
  <td style="text-align:right;">${escapeHtml(cur)} ${escapeHtml(fmtMoneyTZS(Number(c.totalAmount || 0)))}</td>
  <td>${escapeHtml(String(c.status || "—"))}</td>
  <td>${escapeHtml(fmtDateTime(c.createdAt))}</td>
</tr>`;
      })
      .join("\n");

    // Accepted offers: total the owner collects directly at check-in.
    const acceptedClaims = (data.auctionClaims || []).filter(
      (c) => String(c.status || "").toUpperCase() === "ACCEPTED"
    );
    const acceptedCollectTotal = acceptedClaims.reduce((s, c) => s + Number(c.totalAmount || 0), 0);
    const acceptedCurrency = (data.auctionClaims || [])[0]?.currency || "TZS";
    const rowsAuctionFooter = acceptedClaims.length
      ? `
<tr>
  <td colspan="4" style="text-align:right;font-weight:700;">You collect at check-in (${escapeHtml(String(acceptedClaims.length))} accepted)</td>
  <td style="text-align:right;font-weight:800;color:var(--brand);">${escapeHtml(acceptedCurrency)} ${escapeHtml(fmtMoneyTZS(acceptedCollectTotal))}</td>
  <td colspan="2"></td>
</tr>`
      : "";

    const seriesHtml = (data.series || [])
      .map((s) => {
        const total = Math.max(0, Number(s.nolsaf || 0) + Number(s.external || 0) + Number(s.groupStays || 0));
        const pct = Math.min(100, Math.round((total / maxSeries) * 100));
        const nPct = total ? Math.round((Number(s.nolsaf || 0) / total) * pct) : 0;
        const ePct = total ? Math.round((Number(s.external || 0) / total) * pct) : 0;
        const gPct = Math.max(0, pct - nPct - ePct);

        return `
<div class="series-row">
  <div class="series-key">${escapeHtml(s.key)}</div>
  <div class="series-bar">
    <div class="seg nolsaf" style="width:${nPct}%"></div>
    <div class="seg ext" style="width:${ePct}%"></div>
    <div class="seg group" style="width:${gPct}%"></div>
  </div>
  <div class="series-val">${escapeHtml(String(total))}</div>
</div>`;
      })
      .join("\n");

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(data.generatedAt)}</title>
  <style>
    /* ── Variables ─────────────────────────────────────────── */
    :root {
      --ink: #0b1220;
      --muted: #64748b;
      --faint: #94a3b8;
      --line: #e2e8f0;
      --surface: #f8fafc;
      --brand: #02665e;
      --brand-light: rgba(2,102,94,0.08);
      --brand-mid: rgba(2,102,94,0.18);
      --ext: #d97706;
      --group: #4f46e5;
      --accent: #02665e;
    }

    /* ── Reset ─────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: var(--ink);
      background: #fff;
      font-size: 12px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Page wrapper ──────────────────────────────────────── */
    .page { padding: 0; }

    /* ── Diagonal watermark ────────────────────────────────── */
    .watermark {
      position: fixed; inset: 0; pointer-events: none;
      opacity: 0.04; display: flex; align-items: center; justify-content: center;
    }
    .watermark span {
      transform: rotate(-28deg); font-size: 88px; font-weight: 900;
      letter-spacing: 2px; color: #0b1220; white-space: nowrap;
    }

    /* ══════════════════════════════════════════════════════════
       HEADER — premium brand band
    ══════════════════════════════════════════════════════════ */
    .doc-header {
      position: relative;
      overflow: hidden;
      background:
        radial-gradient(circle at 16px 16px, rgba(255,255,255,0.34) 0 1.4px, transparent 1.6px),
        radial-gradient(circle at 48px 38px, rgba(255,255,255,0.20) 0 1.2px, transparent 1.5px),
        linear-gradient(135deg, #02665e 0%, #04786d 52%, #01534d 100%);
      background-size: 32px 32px, 44px 44px, auto;
      padding: 16px 20px 15px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-radius: 10px 10px 0 0;
      box-shadow: inset 0 -1px 0 rgba(255,255,255,0.16);
    }
    .doc-header::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(255,255,255,0.12), transparent 34%, rgba(2,180,245,0.14) 100%),
        radial-gradient(circle at 78% 50%, rgba(255,255,255,0.18), transparent 32%);
      pointer-events: none;
    }
    .doc-header .brand-mark {
      position: relative; z-index: 1;
      display: flex; align-items: center; gap: 10px;
    }
    .doc-header .brand-icon {
      width: 40px; height: 40px; border-radius: 9px;
      background: rgba(255,255,255,0.94);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; overflow: hidden; padding: 3px;
      border: 1px solid rgba(255,255,255,0.70);
      box-shadow: 0 10px 24px rgba(1,41,38,0.18);
    }
    .doc-header .brand-icon img { width: 100%; height: 100%; object-fit: contain; }
    .doc-header .brand-icon svg { width: 20px; height: 20px; fill: #fff; }
    .doc-header .brand-name {
      font-size: 15px; font-weight: 800; letter-spacing: 0.04em;
      color: #fff; line-height: 1.1;
    }
    .doc-header .brand-tagline {
      font-size: 9.5px; color: rgba(255,255,255,0.76); letter-spacing: 0.06em;
      text-transform: uppercase; margin-top: 1px;
    }
    .doc-header .doc-type {
      position: relative; z-index: 1;
      display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
      padding: 5px 0;
    }
    .doc-header .doc-type-label {
      font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
      color: rgba(255,255,255,0.66); font-weight: 700;
    }
    .doc-header .doc-type-name {
      font-size: 13px; font-weight: 800; color: #fff; letter-spacing: 0.01em;
    }

    /* ── Accent rule below header ──────────────────────────── */
    .header-rule { display: none; }

    /* ── Document title block ──────────────────────────────── */
    .title-block {
      padding: 16px 20px 14px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .title-block .left { min-width: 0; flex: 1; }
    .title-block .doc-label {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--brand);
      padding: 3px 8px; border: 1px solid var(--brand-mid);
      border-radius: 4px; background: var(--brand-light);
      margin-bottom: 8px;
    }
    .title-block h1 {
      font-size: 22px; font-weight: 800; letter-spacing: -0.03em;
      color: var(--ink); line-height: 1.15;
    }
    .title-block .doc-sub {
      margin-top: 5px; font-size: 11px; color: var(--muted);
    }
    .title-block .doc-sub strong { color: var(--ink); font-weight: 600; }

    .title-block .right {
      flex-shrink: 0; text-align: right; font-size: 11px; color: var(--muted);
      padding-top: 2px;
    }
    .title-block .right .owner-name {
      font-size: 13px; font-weight: 700; color: var(--ink);
      line-height: 1.2; margin-bottom: 3px;
    }
    .title-block .right .owner-detail {
      line-height: 1.65; color: var(--muted);
    }

    /* ── Meta block ────────────────────────────────────────── */
    .meta-body { padding: 12px 20px; border-bottom: 1px solid var(--line); }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .card {
      border: 1px solid var(--line); border-radius: 6px;
      padding: 10px 13px;
      border-left: 3px solid var(--brand);
      background: var(--surface);
    }
    .kv { display: grid; grid-template-columns: 120px 1fr; gap: 5px 8px; font-size: 11px; }
    .k { color: var(--muted); }
    .v { font-weight: 600; color: var(--ink); }

    /* ── KPI strip ─────────────────────────────────────────── */
    .kpis-body { padding: 12px 20px; border-bottom: 1px solid var(--line); }
    .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
    .kpi {
      border: 1px solid var(--line); border-radius: 6px;
      padding: 9px 10px;
      border-top: 3px solid var(--brand);
      background: #fff;
    }
    .kpi.revenue { border-top-color: #0891b2; }
    .kpi.nights  { border-top-color: #7c3aed; }
    .kpi.blocked { border-top-color: var(--muted); }
    .kpi .t { color: var(--faint); font-size: 9.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; line-height: 1.2; }
    .kpi .n { margin-top: 4px; font-size: 17px; font-weight: 800; color: var(--ink); letter-spacing: -0.02em; }

    /* ── Section headings ──────────────────────────────────── */
    .content-body { padding: 0 20px 16px; }
    .section { margin-top: 16px; }
    .section-head {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 8px;
    }
    .section-head .sh-label {
      font-size: 9px; font-weight: 800; letter-spacing: 0.13em;
      text-transform: uppercase; color: var(--brand);
      white-space: nowrap;
    }
    .section-head .sh-rule {
      flex: 1; height: 1px; background: var(--line);
    }
    .section-head .sh-count {
      font-size: 9px; color: var(--faint); font-weight: 600;
    }

    /* ── Activity chart ────────────────────────────────────── */
    .series {
      border: 1px solid var(--line); border-radius: 6px;
      padding: 10px 13px; background: var(--surface);
    }
    .series-row {
      display: grid; grid-template-columns: 96px 1fr 36px;
      gap: 8px; align-items: center;
      padding: 5px 0;
      border-bottom: 1px solid rgba(226,232,240,0.7);
    }
    .series-row:last-child { border-bottom: none; }
    .series-key { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .series-val { font-size: 11px; font-weight: 800; text-align: right; color: var(--ink); }
    .series-bar { height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden; display: flex; }
    .seg { height: 100%; }
    .seg.nolsaf { background: var(--brand); }
    .seg.ext     { background: var(--ext); }
    .seg.group   { background: var(--group); }
    .legend {
      display: flex; gap: 14px; align-items: center;
      margin-top: 8px; padding-top: 8px;
      border-top: 1px solid var(--line);
      font-size: 10px; color: var(--muted);
    }
    .legend-dot {
      width: 8px; height: 8px; border-radius: 2px;
      display: inline-block; margin-right: 4px; vertical-align: middle;
    }

    /* ── Tables ────────────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead th {
      text-align: left; color: var(--faint);
      background: var(--surface);
      padding: 7px 9px;
      border-bottom: 2px solid var(--line);
      font-size: 9.5px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    tbody td { padding: 7px 9px; border-bottom: 1px solid rgba(226,232,240,0.6); vertical-align: top; }
    tbody tr:nth-child(even) td { background: #fafbfc; }
    tbody tr:last-child td { border-bottom: none; }
    .tbl-wrap {
      border: 1px solid var(--line); border-radius: 6px; overflow: hidden;
    }

    /* ── Footer ────────────────────────────────────────────── */
    .doc-footer {
      margin-top: 20px; padding: 14px 20px 16px;
      border-top: 1px solid var(--line);
      display: flex; justify-content: space-between;
      align-items: flex-end; gap: 20px;
    }
    .doc-footer .footer-left { font-size: 10px; color: var(--muted); line-height: 1.55; }
    .doc-footer .footer-left .report-id { font-family: monospace; font-size: 9.5px; color: var(--faint); }
    .doc-footer .footer-left .legal { margin-top: 4px; font-size: 9.5px; color: var(--faint); max-width: 340px; }
    .doc-footer .footer-right { display: flex; align-items: flex-end; gap: 20px; flex-shrink: 0; }
    .qr img { width: 86px; height: 86px; border-radius: 6px; border: 1px solid var(--line); background: #fff; display: block; }
    .qr-note { font-size: 9px; color: var(--faint); margin-top: 3px; text-align: center; max-width: 86px; line-height: 1.25; }
    .sig-block { text-align: center; }
    .sig-line { border-top: 1px solid #0b1220; width: 180px; padding-top: 5px; font-size: 10px; color: var(--muted); }
    .sig-name { font-size: 10px; font-weight: 600; color: var(--ink); }

    /* ── Power strip at very bottom ────────────────────────── */
    .doc-power {
      background: var(--brand); height: 3px;
    }

    /* ── Print ─────────────────────────────────────────────── */
    @media print {
      @page { size: A4; margin: 12.7mm; }
      .doc-header, .header-rule, .doc-power { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .kpi, .card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <!-- diagonal watermark -->
  <div class="watermark"><span>NoLSAF</span></div>

  <!-- ══ BRAND HEADER BAR ══════════════════════════════════ -->
  <div class="doc-header">
    <div class="brand-mark">
      <div class="brand-icon">
        ${logoDataUrl
          ? `<img src="${logoDataUrl}" alt="NoLSAF" />`
          : `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M3 3h3l8 10.5V3h3v14h-3L6 6.5V17H3z" fill="#fff"/></svg>`
        }
      </div>
      <div>
        <div class="brand-name">NoLSAF</div>
        <div class="brand-tagline">Property Management Platform</div>
      </div>
    </div>
    <div class="doc-type">
      <div class="doc-type-label">Official Document</div>
      <div class="doc-type-name">Operational Report</div>
    </div>
  </div>
  <div class="header-rule"></div>

  <!-- ══ DOCUMENT TITLE ════════════════════════════════════ -->
  <div class="title-block">
    <div class="left">
      <div class="doc-label">Stays Report &nbsp;·&nbsp; ${escapeHtml(data.header.groupBy.charAt(0).toUpperCase() + data.header.groupBy.slice(1))} view</div>
      <h1>${escapeHtml(propertyTitle)}</h1>
      <div class="doc-sub">
        <strong>Period:</strong> ${escapeHtml(fmtDate(data.header.from))} — ${escapeHtml(fmtDate(data.header.to))}
        &nbsp;&nbsp;·&nbsp;&nbsp;
        Generated ${escapeHtml(fmtDateTime(data.generatedAt))}
      </div>
    </div>
    <div class="right">
      <div class="owner-name">${escapeHtml(ownerName)}</div>
      <div class="owner-detail">
        ${escapeHtml(owner?.email || "")}<br/>
        ${escapeHtml(owner?.phone || "")}
      </div>
    </div>
  </div>

  <!-- ══ META CARDS ════════════════════════════════════════ -->
  <div class="meta-body">
    <div class="meta">
      <div class="card">
        <div class="kv">
          <div class="k">Property</div><div class="v">${escapeHtml(propertyTitle)}</div>
          <div class="k">Address</div><div class="v">${escapeHtml(address)}</div>
          <div class="k">Group by</div><div class="v">${escapeHtml(data.header.groupBy.charAt(0).toUpperCase() + data.header.groupBy.slice(1))}</div>
        </div>
      </div>
      <div class="card">
        <div class="kv">
          <div class="k">Printed by</div><div class="v">${escapeHtml(ownerName)}</div>
          <div class="k">Printed at</div><div class="v">${escapeHtml(fmtDateTime(new Date().toISOString()))}</div>
          <div class="k">Certified by</div><div class="v">NoLSAF Platform</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ══ KPI STRIP ═════════════════════════════════════════ -->
  <div class="kpis-body">
    <div class="kpis">
      <div class="kpi"><div class="t">NoLSAF Bookings</div><div class="n">${escapeHtml(String(data.stats.nolsafBookings || 0))}</div></div>
      <div class="kpi"><div class="t">External Reservations</div><div class="n">${escapeHtml(String(data.stats.externalReservations || 0))}</div></div>
      <div class="kpi"><div class="t">Group Stays</div><div class="n">${escapeHtml(String(data.stats.groupStaysReceived || 0))}</div></div>
      <div class="kpi revenue"><div class="t">Revenue (TZS)</div><div class="n">${escapeHtml(fmtMoneyTZS(Number(data.stats.revenueTzs || 0)))}</div></div>
      <div class="kpi nights"><div class="t">Nights Booked</div><div class="n">${escapeHtml(String(data.stats.nightsBooked || 0))}</div></div>
      <div class="kpi blocked"><div class="t">Nights Blocked</div><div class="n">${escapeHtml(String(data.stats.nightsBlocked || 0))}</div></div>
    </div>
  </div>

  <!-- ══ CONTENT SECTIONS ═══════════════════════════════════ -->
  <div class="content-body">

    <!-- Activity Mix -->
    <div class="section">
      <div class="section-head">
        <span class="sh-label">Activity Mix &mdash; by ${escapeHtml(data.header.groupBy)}</span>
        <div class="sh-rule"></div>
        <span class="sh-count">${escapeHtml(String((data.series || []).length))} periods</span>
      </div>
      <div class="series">
        ${seriesHtml || '<div style="color:var(--muted);font-size:11px;padding:4px 0;">No chart data in this range.</div>'}
        <div class="legend">
          <span><span class="legend-dot" style="background:var(--brand);"></span>NoLSAF</span>
          <span><span class="legend-dot" style="background:var(--ext);"></span>External</span>
          <span><span class="legend-dot" style="background:var(--group);"></span>Group stays</span>
        </div>
      </div>
    </div>

    <!-- NoLSAF Bookings -->
    <div class="section">
      <div class="section-head">
        <span class="sh-label">NoLSAF Bookings</span>
        <div class="sh-rule"></div>
        <span class="sh-count">${escapeHtml(String((data.bookings || []).length))}</span>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Guest</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Nationality</th>
              <th>Gender</th>
              <th style="text-align:right;">Amount (TZS)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rowsBookings || '<tr><td colspan="7" style="color:var(--faint);font-style:italic;">No NoLSAF bookings in this range.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- External Reservations -->
    <div class="section">
      <div class="section-head">
        <span class="sh-label">External Reservations</span>
        <div class="sh-rule"></div>
        <span class="sh-count">${escapeHtml(String((data.external || []).length))}</span>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Guest</th>
              <th>Nationality</th>
              <th>Start</th>
              <th>End</th>
              <th>Room</th>
              <th style="text-align:right;">Paid</th>
              <th style="text-align:right;">Beds</th>
            </tr>
          </thead>
          <tbody>
            ${rowsExternal || '<tr><td colspan="8" style="color:var(--faint);font-style:italic;">No external reservations in this range.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Group Stays -->
    <div class="section">
      <div class="section-head">
        <span class="sh-label">Group Stays Received</span>
        <div class="sh-rule"></div>
        <span class="sh-count">${escapeHtml(String((data.groupStays || []).length))}</span>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Destination</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th style="text-align:right;">Headcount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rowsGroupStays || '<tr><td colspan="6" style="color:var(--faint);font-style:italic;">No group stays in this range.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Auction Claims -->
    <div class="section">
      <div class="section-head">
        <span class="sh-label">Auction Participation</span>
        <div class="sh-rule"></div>
        <span class="sh-count">${escapeHtml(String((data.auctionClaims || []).length))}</span>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Group Stay</th>
              <th>Property</th>
              <th style="text-align:right;">Offer / Night</th>
              <th style="text-align:right;">Discount</th>
              <th style="text-align:right;">Stay Total (after discount)</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${rowsAuctionClaims || '<tr><td colspan="7" style="color:var(--faint);font-style:italic;">No auction claims in this range.</td></tr>'}
          </tbody>
          ${rowsAuctionFooter ? `<tfoot>${rowsAuctionFooter}</tfoot>` : ""}
        </table>
      </div>
    </div>

  </div><!-- /content-body -->

  <!-- ══ FOOTER ════════════════════════════════════════════ -->
  <div class="doc-footer">
    <div class="footer-left">
      <div>Prepared for operational use and compliance purposes.</div>
      <div class="report-id">Report ID: ${escapeHtml(data.generatedAt)}</div>
      <div class="legal">This document is generated automatically by the NoLSAF Property Management Platform. All figures reflect data recorded in the system at time of generation. This report may be used for management, tax, or compliance filings.</div>
    </div>
    <div class="footer-right">
      ${qrDataUrl ? `
      <div style="text-align:center;">
        <div class="qr"><img src="${qrDataUrl}" alt="Verify report" /></div>
        <div class="qr-note">Scan to verify<br/>this report online</div>
      </div>` : ""}
      <div class="sig-block">
        <div class="sig-line">Authorised Signature</div>
        <div class="sig-name" style="margin-top:4px;">${escapeHtml(ownerName)}</div>
        <div style="font-size:9px;color:var(--faint);margin-top:1px;">Property Owner</div>
      </div>
    </div>
  </div>

  <!-- green power stripe at bottom -->
  <div class="doc-power"></div>

</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) {
      alert("Unable to open print window — please allow popups");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 400);
  }

  const kpis = data?.stats;

  return (
    <div className="space-y-5">
      <ReportsFilter onChangeAction={setFilters} exportHref={null} />

      <div className="relative rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Cross-hatch bg */}
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />
        <div className="relative bg-white/95 px-5 py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#02665e]/10 border border-[#02665e]/20 px-3 py-1 text-xs font-bold text-[#02665e]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Operational Export
          </div>
          <h2 className="mt-2.5 text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            {propertyDisplay}
            {data && (
              <span className="ml-2 align-middle inline-flex items-center rounded-full bg-[#02665e]/8 px-2.5 py-0.5 text-xs font-bold text-[#02665e]">
                {data.stats.nolsafBookings + data.stats.externalReservations} entries
              </span>
            )}
          </h2>
          <p className="text-sm text-slate-400 mt-1">Day / week / month reporting with CSV export and print-ready layout.</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            disabled={!canUseReportActions}
            onClick={exportCsv}
            className={
              "inline-flex items-center justify-center h-9 px-4 rounded-xl border shadow-sm text-sm font-semibold transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20 " +
              (canUseReportActions ? "bg-white border-[#02665e]/20 text-[#02665e] hover:bg-[#02665e]/5 hover:border-[#02665e]/30" : "bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed")
            }
          >
            <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden />
            Export CSV
          </button>
          <button
            type="button"
            disabled={!canUseReportActions}
            onClick={printReport}
            className={
              "inline-flex items-center justify-center h-9 px-4 rounded-xl bg-[#02665e] text-white shadow-sm shadow-[#02665e]/20 hover:bg-[#034e47] transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 " +
              (!canUseReportActions ? "opacity-40 cursor-not-allowed" : "")
            }
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" aria-hidden />
            Print Report
          </button>
        </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <div className="font-semibold">Couldn’t load report</div>
            <div className="text-amber-800/90 break-words">{error}</div>
          </div>
        </div>
      ) : null}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-3">
        <Kpi title="NoLSAF bookings" value={kpis ? String(kpis.nolsafBookings) : "—"} loading={loading} borderColor="bg-emerald-600" />
        <Kpi title="External reservations" value={kpis ? String(kpis.externalReservations) : "—"} loading={loading} borderColor="bg-amber-500" />
        <Kpi title="Group stays" value={kpis ? String(kpis.groupStaysReceived) : "—"} sub={kpis ? `${kpis.groupStayNights} nights` : undefined} loading={loading} accent="text-indigo-700" borderColor="bg-indigo-500" />
        <Kpi title="Revenue" value={kpis ? fmtMoneyTZS(kpis.revenueTzs) : "—"} sub="TZS" loading={loading} accent="text-emerald-700" borderColor="bg-emerald-500" />
        <Kpi title="Nights booked" value={kpis ? String(kpis.nightsBooked) : "—"} loading={loading} borderColor="bg-sky-500" />
        <Kpi title="Nights blocked" value={kpis ? String(kpis.nightsBlocked) : "—"} loading={loading} borderColor="bg-slate-400" />
        <Kpi title="Auction claims" value={kpis ? String(kpis.auctionClaimsSubmitted) : "—"} sub={kpis ? `${kpis.auctionClaimsAccepted} accepted` : undefined} loading={loading} borderColor="bg-violet-500" />
      </div>

      {/* Quick visualization */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">Booking sources</div>
            <div className="text-xs text-gray-400 mt-0.5">NoLSAF bookings vs external blocks vs group stays</div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <LegendDot label="NoLSAF" className="bg-emerald-600" />
            <LegendDot label="External" className="bg-amber-500" />
            <LegendDot label="Group stays" className="bg-indigo-500" />
          </div>
        </div>
        <div className="px-5 py-4">
          <SourcesBar
            nolsaf={Number(kpis?.nolsafBookings ?? 0)}
            external={Number(kpis?.externalReservations ?? 0)}
            groupStays={Number(kpis?.groupStaysReceived ?? 0)}
          />
        </div>
        <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-gray-100 border-l-2 border-l-violet-400 bg-gray-50/60 px-3 py-2.5">
            <div className="font-semibold text-gray-800">Auction participation</div>
            <div className="mt-1 text-gray-500">
              <span className="font-medium text-gray-700">{loading ? "…" : String(kpis?.auctionClaimsSubmitted ?? 0)}</span> submitted
              &nbsp;·&nbsp;
              <span className="font-medium text-emerald-700">{loading ? "…" : String(kpis?.auctionClaimsAccepted ?? 0)}</span> accepted
            </div>
          </div>
          <div className="rounded-lg border border-gray-100 border-l-2 border-l-sky-400 bg-gray-50/60 px-3 py-2.5">
            <div className="font-semibold text-gray-800">Group stay nights</div>
            <div className="mt-1 text-gray-500"><span className="font-medium text-gray-700">{loading ? "…" : String(kpis?.groupStayNights ?? 0)}</span> nights overlapping this period</div>
          </div>
          <div className="rounded-lg border border-gray-100 border-l-2 border-l-amber-400 bg-gray-50/60 px-3 py-2.5">
            <div className="font-semibold text-gray-800">Revenue (TZS)</div>
            <div className="mt-1 text-gray-500">Total earned: <span className="font-medium text-emerald-700">{loading ? "…" : fmtMoneyTZS(kpis?.revenueTzs ?? 0)}</span></div>
          </div>
        </div>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-emerald-500" />
            <div>
              <div className="text-sm font-semibold text-gray-900">NoLSAF bookings</div>
              <div className="text-xs text-gray-400 mt-0.5">Bookings overlapping the selected range</div>
            </div>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="min-w-[720px] w-full text-sm">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50/70 border-b border-gray-100">
                  <th className="text-left py-2.5 px-3">Guest</th>
                  <th className="text-left py-2.5 px-3">Check-in</th>
                  <th className="text-left py-2.5 px-3">Check-out</th>
                  <th className="text-left py-2.5 px-3">Nationality</th>
                  <th className="text-left py-2.5 px-3">Gender</th>
                  <th className="text-right py-2.5 px-3">Amount</th>
                  <th className="text-left py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.bookings?.length ? (
                  data.bookings.map((b) => (
                    <tr key={b.id} className="border-b last:border-b-0 hover:bg-gray-50/60 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-gray-900">{b.guestName || "Guest"}</td>
                      <td className="py-2.5 px-3 text-gray-600">{fmtDate(b.checkIn)}</td>
                      <td className="py-2.5 px-3 text-gray-600">{fmtDate(b.checkOut)}</td>
                      <td className="py-2.5 px-3 text-gray-600">{b.nationality || "—"}</td>
                      <td className="py-2.5 px-3 text-gray-600">{b.sex || "—"}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">TZS {fmtMoneyTZS(Number(b.ownerBaseAmount || b.totalAmount || 0))}</td>
                      <td className="py-2.5 px-3 text-gray-600">{b.status || "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-6 px-3 text-sm text-gray-400 italic" colSpan={7}>
                      {loading ? "Loading…" : "No NoLSAF bookings in this range."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-amber-500" />
            <div>
              <div className="text-sm font-semibold text-gray-900">External reservations</div>
              <div className="text-xs text-gray-400 mt-0.5">Manual blocks representing outside bookings</div>
            </div>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50/70 border-b border-gray-100">
                  <th className="text-left py-2.5 px-3">Source</th>
                  <th className="text-left py-2.5 px-3">Guest</th>
                  <th className="text-left py-2.5 px-3">Nationality</th>
                  <th className="text-left py-2.5 px-3">Start</th>
                  <th className="text-left py-2.5 px-3">End</th>
                  <th className="text-left py-2.5 px-3">Room</th>
                  <th className="text-right py-2.5 px-3">Paid</th>
                  <th className="text-right py-2.5 px-3">Beds</th>
                </tr>
              </thead>
              <tbody>
                {data?.external?.length ? (
                  data.external.map((x) => (
                    <tr key={x.id} className="border-b last:border-b-0 hover:bg-gray-50/60 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-gray-900">{x.source || "External"}</td>
                      <td className="py-2.5 px-3 text-gray-700">{x.guestName || "—"}</td>
                      <td className="py-2.5 px-3 text-gray-600">{x.nationality || "—"}</td>
                      <td className="py-2.5 px-3 text-gray-600">{fmtDate(x.startDate)}</td>
                      <td className="py-2.5 px-3 text-gray-600">{fmtDate(x.endDate)}</td>
                      <td className="py-2.5 px-3 text-gray-600">{x.roomCode || "—"}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">{x.amountPaid != null ? `TZS ${fmtMoneyTZS(Number(x.amountPaid))}` : "—"}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-amber-700">{String(x.bedsBlocked ?? 1)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-6 px-3 text-sm text-gray-400 italic" colSpan={8}>
                      {loading ? "Loading…" : "No external reservations in this range."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Group stays + auction section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-indigo-500" />
            <div>
              <div className="text-sm font-semibold text-gray-900">Group stays received</div>
              <div className="text-xs text-gray-400 mt-0.5">Group bookings assigned to you, by stay dates in this range</div>
            </div>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="min-w-[820px] w-full text-sm">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50/70 border-b border-gray-100">
                  <th className="text-left py-2.5 px-3">Type</th>
                  <th className="text-left py-2.5 px-3">Destination</th>
                  <th className="text-left py-2.5 px-3">Check-in</th>
                  <th className="text-left py-2.5 px-3">Check-out</th>
                  <th className="text-right py-2.5 px-3">Headcount</th>
                  <th className="text-left py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.groupStays?.length ? (
                  data.groupStays.map((g) => (
                    <tr key={g.id} className="border-b last:border-b-0 hover:bg-gray-50/60 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-gray-900">{g.groupType || "—"}</td>
                      <td className="py-2.5 px-3 text-gray-600">{[g.toRegion, g.toDistrict, g.toLocation].filter(Boolean).join(" • ") || "—"}</td>
                      <td className="py-2.5 px-3 text-gray-600">{g.checkIn ? fmtDate(g.checkIn) : "—"}</td>
                      <td className="py-2.5 px-3 text-gray-600">{g.checkOut ? fmtDate(g.checkOut) : "—"}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-900">{String(g.headcount ?? "—")}</td>
                      <td className="py-2.5 px-3 text-gray-600">{g.status || "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-6 px-3 text-sm text-gray-400 italic" colSpan={6}>
                      {loading ? "Loading…" : "No group stays with check-in/check-out dates in this range. Accepted offers appear here once their stay dates fall inside the selected period — widen the date range to include the stay dates."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-violet-500" />
            <div>
              <div className="text-sm font-semibold text-gray-900">Auction participation</div>
              <div className="text-xs text-gray-400 mt-0.5">Your competitive offers on open group stays</div>
            </div>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="min-w-[960px] w-full text-sm">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50/70 border-b border-gray-100">
                  <th className="text-left py-2.5 px-3">Group stay</th>
                  <th className="text-left py-2.5 px-3">Property</th>
                  <th className="text-right py-2.5 px-3">Offer / night</th>
                  <th className="text-right py-2.5 px-3">Discount</th>
                  <th className="text-right py-2.5 px-3">Stay total (after discount)</th>
                  <th className="text-left py-2.5 px-3">Status</th>
                  <th className="text-left py-2.5 px-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {data?.auctionClaims?.length ? (
                  data.auctionClaims.map((c) => {
                    const accepted = String(c.status || "").toUpperCase() === "ACCEPTED";
                    return (
                      <tr key={c.id} className="border-b last:border-b-0 hover:bg-gray-50/60 transition-colors">
                        <td className="py-2.5 px-3 font-medium text-gray-900">#{c.groupBookingId}</td>
                        <td className="py-2.5 px-3 text-gray-600">{c.property?.title || "—"}</td>
                        <td className="py-2.5 px-3 text-right font-semibold text-indigo-700">{c.currency || "TZS"} {fmtMoneyTZS(Number(c.offeredPricePerNight || 0))}</td>
                        <td className="py-2.5 px-3 text-right text-gray-600">{c.discountPercent ? `${String(c.discountPercent)}%` : "—"}</td>
                        <td className={"py-2.5 px-3 text-right font-semibold " + (accepted ? "text-emerald-700" : "text-gray-700")}>{c.currency || "TZS"} {fmtMoneyTZS(Number(c.totalAmount || 0))}</td>
                        <td className="py-2.5 px-3 text-gray-600">{c.status || "—"}</td>
                        <td className="py-2.5 px-3 text-gray-500 text-xs">{fmtDateTime(c.createdAt)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="py-6 px-3 text-sm text-gray-400 italic" colSpan={7}>
                      {loading ? "Loading…" : "No auction claims created in this range."}
                    </td>
                  </tr>
                )}
              </tbody>
              {auctionSummary.acceptedCount > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-emerald-50/40">
                    <td className="py-3 px-3 text-xs font-semibold text-gray-700" colSpan={4}>
                      You collect at check-in
                      <span className="ml-1.5 font-normal text-gray-400">
                        ({auctionSummary.acceptedCount} accepted {auctionSummary.acceptedCount === 1 ? "offer" : "offers"})
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-sm font-extrabold text-emerald-700">
                      {auctionSummary.currency} {fmtMoneyTZS(auctionSummary.acceptedTotal)}
                    </td>
                    <td className="py-3 px-3" colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {auctionSummary.acceptedCount > 0 && (
            <div className="px-5 pb-4 -mt-1">
              <p className="text-[11px] text-gray-400">
                Stay total is the owner&apos;s discounted payout. The guest pays it directly to you at the property — NoLSAF&apos;s commission was already collected as the online deposit.
              </p>
            </div>
          )}
        </div>
      </div>

      {data?.generatedAt ? (
        <div className="text-xs text-gray-500">Generated at: {fmtDateTime(data.generatedAt)} • Printed by: {ownerDisplay}</div>
      ) : null}
    </div>
  );
}

function Kpi({ title, value, sub, loading, accent }: { title: string; value: string; sub?: string; loading: boolean; accent?: string; borderColor?: string }) {
  return (
    <div className="relative rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />
      <div className="relative bg-white/95 p-4 flex flex-col justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">{title}</div>
        {loading ? (
          <div className="mt-2 space-y-1.5">
            <div className="h-6 w-3/4 rounded-md bg-slate-100 animate-pulse" />
            {sub !== undefined && <div className="h-3.5 w-1/2 rounded-md bg-slate-100 animate-pulse" />}
          </div>
        ) : (
          <div>
            <div className={("mt-1.5 text-lg font-extrabold tracking-tight leading-none " + (accent || "text-slate-900"))}>{value}</div>
            {sub ? <div className="mt-1 text-xs text-slate-400 font-medium">{sub}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function LegendDot({ label, className }: { label: string; className: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={"h-2.5 w-2.5 rounded-sm " + className} aria-hidden />
      <span className="text-gray-600">{label}</span>
    </span>
  );
}

function SourcesBar({ nolsaf, external, groupStays }: { nolsaf: number; external: number; groupStays: number }) {
  const total = Math.max(1, nolsaf + external + groupStays);
  const nPct = Math.round((nolsaf / total) * 100);
  const ePct = Math.round((external / total) * 100);
  const gPct = Math.max(0, 100 - nPct - ePct);

  return (
    <div className="w-full">
      <div className="h-4 w-full rounded-full bg-gray-100 overflow-hidden flex gap-[2px]">
        {nPct > 0 && <div className="h-full bg-emerald-600 rounded-l-full transition-all duration-500" style={{ width: `${nPct}%` }} />}
        {ePct > 0 && <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${ePct}%` }} />}
        {gPct > 0 && <div className="h-full bg-indigo-500 rounded-r-full transition-all duration-500" style={{ width: `${gPct}%` }} />}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-600 inline-block" /><span className="font-semibold text-gray-700">{nolsaf}</span> NoLSAF <span className="text-gray-400">({nPct}%)</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-500 inline-block" /><span className="font-semibold text-gray-700">{external}</span> External <span className="text-gray-400">({ePct}%)</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-indigo-500 inline-block" /><span className="font-semibold text-gray-700">{groupStays}</span> Group stays <span className="text-gray-400">({gPct}%)</span></span>
      </div>
    </div>
  );
}
