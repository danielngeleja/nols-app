"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { BadgeCheck, Check, ChevronLeft, Clock, Copy, Printer, XCircle } from "lucide-react";

// House document typography and palette (shared with the payout receipt and
// verification pages). A voucher is a pass, not a receipt: it carries only what
// the meetup needs, plus whether it can be used right now.
const DOC_FONT = '"Trebuchet MS", Trebuchet, Arial, sans-serif';
const C = {
  brand: "#02665e",
  brandDeep: "#024d47",
  ink: "#0f2e2b",
  text: "#1e3a38",
  muted: "#5a9990",
  label: "#8aaca9",
  faint: "#9ab8b6",
  line: "#edf4f3",
  tint: "#f3f9f8",
  divider: "#d0e8e5",
  cardLine: "#e2eae9",
  page: "#fafafa",
};

const PRINT_STYLES = `
#voucher-root, #voucher-root * { box-sizing: border-box; }
@media print {
  @page { size: A6 portrait; margin: 6mm; }
  body * { visibility: hidden !important; }
  #voucher-card, #voucher-card * { visibility: visible !important; }
  #voucher-card { position: absolute; left: 0; top: 0; width: 100% !important; max-width: 100% !important; margin: 0 !important; box-shadow: none !important; break-inside: avoid; }
  #voucher-card, #voucher-card * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

type VoucherStatus = "VALID" | "USED" | "EXPIRED" | "UNPAID" | "CANCELLED";

type Voucher = {
  title?: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelerCount?: number;
  guestName?: string | null;
  voucherStatus?: VoucherStatus;
  voucherIdentity?: { voucherNumber?: string } | null;
};

const STATUS: Record<VoucherStatus, { label: string; note: string; bg: string; fg: string; ring: string; icon: typeof BadgeCheck; scannable: boolean }> = {
  VALID: { label: "Valid", note: "Show this at the meetup with a photo ID.", bg: "#e7f5f2", fg: C.brand, ring: "#bfe2dc", icon: BadgeCheck, scannable: true },
  USED: { label: "Used", note: "Your meetup has been validated. This voucher has done its job.", bg: "#eef2f4", fg: "#52606d", ring: "#d6dde3", icon: Check, scannable: false },
  EXPIRED: { label: "Expired", note: "The travel dates on this voucher have passed.", bg: "#fdecec", fg: "#b42318", ring: "#f6c9c5", icon: Clock, scannable: false },
  UNPAID: { label: "Awaiting payment", note: "This voucher becomes valid once your payment is confirmed.", bg: "#fdf4e3", fg: "#a15c07", ring: "#f3d9a4", icon: Clock, scannable: false },
  CANCELLED: { label: "Cancelled", note: "This trip was cancelled. The voucher can no longer be used.", bg: "#fdecec", fg: "#b42318", ring: "#f6c9c5", icon: XCircle, scannable: false },
};

function fmtDate(value: string | null | undefined): string | null {
  return value ? new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : null;
}

/** QR (primary, scans from any phone screen) and a slim CODE128 for laser scanners. */
function useCodes(value: string): { qr: string | null; bars: string | null } {
  const [codes, setCodes] = useState<{ qr: string | null; bars: string | null }>({ qr: null, bars: null });
  useEffect(() => {
    let alive = true;
    if (!value) {
      setCodes({ qr: null, bars: null });
      return;
    }
    let bars: string | null = null;
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, value, { format: "CODE128", displayValue: false, margin: 0, width: 3, height: 80, background: "#ffffff", lineColor: C.ink });
      bars = canvas.toDataURL("image/png");
    } catch {}
    QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 0, width: 480, color: { dark: C.ink, light: "#ffffff" } })
      .then((qr: string) => { if (alive) setCodes({ qr, bars }); })
      .catch(() => { if (alive) setCodes({ qr: null, bars }); });
    return () => {
      alive = false;
    };
  }, [value]);
  return codes;
}

export default function PackageVoucherPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiClient.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}/voucher`);
        if (!alive) return;
        setVoucher(res.data || null);
      } catch (err: any) {
        if (alive) setError(err?.response?.data?.error || "We could not load this voucher.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const voucherNumber = String(voucher?.voucherIdentity?.voucherNumber || "").trim();
  const { qr, bars } = useCodes(voucherNumber);
  const status = STATUS[voucher?.voucherStatus ?? "VALID"] ?? STATUS.VALID;
  const StatusIcon = status.icon;
  const travellers = Math.max(1, Number(voucher?.travelerCount || 1));
  const startText = fmtDate(voucher?.startDate);
  const endText = fmtDate(voucher?.endDate);
  const days = voucher?.startDate && voucher?.endDate
    ? Math.round((new Date(voucher.endDate).setHours(0, 0, 0, 0) - new Date(voucher.startDate).setHours(0, 0, 0, 0)) / 86_400_000) + 1
    : null;
  const dateLine = startText
    ? [endText && endText !== startText ? `${startText} to ${endText}` : startText, days && days > 1 ? `${days} days` : null].filter(Boolean).join(" · ")
    : "Date to be confirmed";

  const copyCode = async () => {
    if (!voucherNumber || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(voucherNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div id="voucher-root" className="w-full min-w-0" style={{ fontFamily: DOC_FONT }}>
      <style>{PRINT_STYLES}</style>

      {/* ── Nav (screen only) ── */}
      <div className="flex items-center justify-between gap-3 border-0 border-b border-solid py-3" style={{ borderColor: C.line }}>
        <Link
          href={`/account/tour-packages/${encodeURIComponent(id)}`}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 no-underline transition-colors hover:text-[#02665e]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Back to trip
        </Link>
        {voucher ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyCode}
              disabled={!voucherNumber}
              style={{ fontFamily: DOC_FONT, borderColor: C.divider, color: C.brandDeep }}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-solid bg-white px-3 text-[13px] font-semibold transition-colors hover:bg-[#f7fbfa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              <span className="hidden sm:inline">{copied ? "Copied" : "Copy code"}</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              style={{ fontFamily: DOC_FONT, background: `linear-gradient(135deg, ${C.brandDeep}, ${C.brand})` }}
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border-0 px-4 text-[13px] font-semibold text-white"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print
            </button>
          </div>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-[400px] py-8">
        {loading ? (
          <div className="h-[36rem] rounded-[28px] bg-white" style={{ border: `1px solid ${C.cardLine}` }} aria-busy="true">
            <span role="status" className="sr-only">Loading voucher</span>
          </div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : voucher ? (
          <>
            <div
              id="voucher-card"
              className="relative overflow-hidden rounded-[28px] bg-white"
              style={{ border: `1px solid ${C.cardLine}`, boxShadow: "0 2px 8px rgba(2,102,94,0.06),0 24px 56px -12px rgba(2,102,94,0.18)" }}
            >
              {/* ══ Issued top: logo lockup and status stamp on a light brand tint ══ */}
              <div className="px-6 pb-6 pt-5" style={{ background: C.tint }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/assets/NoLS2025-04.png" alt="" className="h-9 w-9 rounded-xl bg-white object-contain p-1" style={{ border: `1px solid ${C.divider}` }} />
                    <div className="leading-none">
                      <div className="text-[15px] font-black tracking-tight" style={{ color: C.brandDeep }}>NoLSAF</div>
                      <div className="mt-1 text-[8.5px] font-bold uppercase tracking-[0.22em]" style={{ color: C.muted }}>Tour voucher</div>
                    </div>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em]"
                    style={{ background: status.bg, color: status.fg, border: `1px solid ${status.ring}` }}
                  >
                    <StatusIcon className="h-3 w-3" aria-hidden />
                    {status.label}
                  </span>
                </div>

                <h1 className="m-0 mt-6 break-words text-center text-[24px] font-black leading-tight tracking-tight" style={{ color: C.ink }}>
                  {voucher.title || "Tour package"}
                </h1>
                <p className="m-0 mt-1.5 text-center text-[12.5px] font-semibold" style={{ color: C.muted }}>{dateLine}</p>
                {voucher.destination ? <p className="m-0 mt-0.5 text-center text-[11.5px]" style={{ color: C.label }}>{voucher.destination}, Tanzania</p> : null}

                <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-2xl bg-white" style={{ border: `1px solid ${C.line}` }}>
                  <div className="px-4 py-3.5 text-center">
                    <p className="m-0 text-[8.5px] font-bold uppercase tracking-[0.22em]" style={{ color: C.label }}>Admit</p>
                    <p className="m-0 mt-1 text-[34px] font-black leading-none tabular-nums" style={{ color: C.brand }}>{travellers}</p>
                    <p className="m-0 mt-1 text-[10.5px] font-semibold" style={{ color: C.muted }}>{travellers === 1 ? "traveller" : "travellers"}</p>
                  </div>
                  <div className="flex flex-col items-center justify-center border-0 border-l border-solid px-4 py-3.5 text-center" style={{ borderColor: C.line }}>
                    <p className="m-0 text-[8.5px] font-bold uppercase tracking-[0.22em]" style={{ color: C.label }}>Lead traveller</p>
                    <p className="m-0 mt-1.5 break-words text-[13.5px] font-bold leading-snug" style={{ color: C.ink }}>{voucher.guestName || "Not recorded"}</p>
                  </div>
                </div>
              </div>

              {/* ══ Perforation: dashed tear line with a bite out of each edge ══ */}
              <div className="relative bg-white" aria-hidden>
                <div className="mx-6 border-0 border-t-2 border-dashed" style={{ borderColor: C.divider }} />
                <span className="absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full" style={{ left: -13, background: C.page, border: `1px solid ${C.cardLine}` }} />
                <span className="absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full" style={{ right: -13, background: C.page, border: `1px solid ${C.cardLine}` }} />
              </div>

              {/* ══ Stub: the code to scan ══ */}
              <div className="flex flex-col items-center px-6 pb-6 pt-6">
                {voucherNumber && (voucher.voucherStatus ?? "VALID") !== "UNPAID" && voucher.voucherStatus !== "CANCELLED" ? (
                  <div className="relative">
                    <div className="rounded-2xl bg-white p-3" style={{ border: `1px solid ${C.divider}`, opacity: status.scannable ? 1 : 0.25 }}>
                      {qr ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qr} alt={`Voucher QR code ${voucherNumber}`} className="block h-44 w-44" />
                      ) : (
                        <div className="flex h-44 w-44 items-center justify-center text-[10px]" style={{ color: C.faint }}>Preparing code...</div>
                      )}
                    </div>
                    {!status.scannable ? (
                      <span
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-black uppercase tracking-[0.18em]"
                        style={{ color: status.fg, border: `2px solid ${status.fg}`, background: "rgba(255,255,255,0.85)" }}
                      >
                        {status.label}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex h-44 w-full items-center justify-center rounded-2xl border border-dashed px-6 text-center text-[11.5px] leading-relaxed" style={{ borderColor: C.divider, color: C.muted }}>
                    {voucherNumber ? status.note : "Your code appears once the voucher is issued."}
                  </div>
                )}

                {voucherNumber ? (
                  <p className="m-0 mt-3 break-all text-center font-mono text-[11px] font-bold tracking-[0.14em]" style={{ color: C.text }}>{voucherNumber}</p>
                ) : null}

                {bars && status.scannable ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={bars} alt="" aria-hidden className="mt-3 block h-8 w-full opacity-80" />
                ) : null}
              </div>
            </div>

            {/* Unpaid and cancelled vouchers already explain themselves inside the card. */}
            {voucher.voucherStatus !== "UNPAID" && voucher.voucherStatus !== "CANCELLED" ? (
              <p className="m-0 mt-4 text-center text-[11px] leading-relaxed" style={{ color: status.scannable ? C.faint : status.fg }}>
                {status.note}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
