"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText, Download, Loader2, User, Building2, Phone, Mail, MapPin } from "lucide-react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function OwnerRevenueInvoiceView() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;

  const [loading, setLoading] = useState(true);
  const [inv, setInv] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    if (!idParam) {
      setInv(null);
      setErr("Missing invoice id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr(null);
    setInv(null);

    api
      .get(`/api/owner/revenue/invoices/${idParam}`)
      .then((r) => {
        if (!mounted) return;
        setInv(r.data);
      })
      .catch((e: any) => {
        if (!mounted) return;
        const status = Number(e?.response?.status ?? 0);
        if (status === 404) {
          setErr("Invoice not found (or you don’t have access to it).");
        } else {
          setErr(String(e?.response?.data?.error || e?.message || "Failed to load invoice"));
        }
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [idParam]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="relative mb-6">
          <span className="absolute inset-0 rounded-full bg-slate-400/20 animate-ping" />
          <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Invoice</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">Loading invoice details…</p>
      </div>
    );
  }

  if (err && !inv) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-red-50 border border-red-200 mx-auto">
          <FileText className="h-6 w-6 text-red-400" aria-hidden />
        </div>
        <h1 className="text-2xl font-black text-slate-900">Unable to open invoice</h1>
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{err}</p>
        <Link
          href="/owner/revenue"
          className="no-underline inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm mx-auto"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Revenue
        </Link>
      </div>
    );
  }

  const invoiceNumber = String(inv?.invoiceNumber ?? "—");
  const status = String(inv?.status ?? "—");
  const issuedAt = inv?.issuedAt
    ? new Date(inv.issuedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "—";
  const paidAt = inv?.paidAt
    ? new Date(inv.paidAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;
  const propertyTitle = inv?.booking?.property?.title ?? "Property";
  const guestName = inv?.booking?.user?.fullName ?? inv?.booking?.user?.name ?? "—";
  const phone = inv?.booking?.user?.phone ?? "—";
  const codeVisible = inv?.booking?.code?.codeVisible ?? inv?.booking?.code?.code ?? "—";
  const total = inv?.netPayable ?? inv?.total ?? 0;

  // Sender (owner) info
  const senderName = inv?.owner?.fullName ?? inv?.owner?.name ?? inv?.senderName ?? guestName;
  const senderPhone = inv?.owner?.phone ?? inv?.senderPhone ?? phone;
  const senderCity = inv?.owner?.city ?? inv?.senderCity ?? inv?.booking?.property?.city ?? "";
  const senderAddress = [senderCity, "Tanzania"].filter(Boolean).join(", ");

  const formattedTotal = (() => {
    const n = Number(total);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("en-TZ", {
      style: "currency",
      currency: "TZS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  })();

  const statusColors: Record<string, string> = {
    PAID: "bg-emerald-50 border-emerald-200 text-emerald-700",
    REQUESTED: "bg-amber-50 border-amber-200 text-amber-700",
    REJECTED: "bg-red-50 border-red-200 text-red-700",
    DRAFT: "bg-slate-50 border-slate-200 text-slate-600",
    PENDING: "bg-blue-50 border-blue-200 text-blue-700",
  };
  const statusStyle = statusColors[status.toUpperCase()] ?? "bg-slate-50 border-slate-200 text-slate-600";

  return (
    <div className="space-y-5 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">

      {/* ── Hero ── */}
      <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
        {/* Teal header band */}
        <div className="relative bg-gradient-to-r from-[#02665e] to-[#034e47] px-5 sm:px-6 lg:px-8 py-4 sm:py-5">
          {/* Dot pattern */}
          <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle, #fff 1.5px, transparent 1.5px)', backgroundSize: '18px 18px' }} />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <FileText className="h-4.5 w-4.5 text-white" aria-hidden />
              </div>
              <div>
                <div className="text-white/60 text-[10px] font-bold uppercase tracking-widest">Invoice</div>
                <div className="text-white text-sm font-bold">{invoiceNumber}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <a
                href={`/api/owner/revenue/invoices/${idParam}/download`}
                download
                className="no-underline inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 hover:text-white active:scale-[0.97] transition-all"
                aria-label="Download invoice"
                title="Download"
              >
                <Download className="h-4 w-4" aria-hidden />
              </a>
              <Link
                href="/owner/revenue"
                className="no-underline inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 hover:text-white active:scale-[0.97] transition-all"
                aria-label="Back to Revenue"
                title="Back"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>

        {/* White body */}
        <div className="bg-white px-5 sm:px-6 lg:px-8 py-5 sm:py-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">{invoiceNumber}</h1>
              <p className="mt-0.5 text-sm text-slate-500 truncate">{propertyTitle}</p>
            </div>
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest flex-shrink-0 ${statusStyle}`}>
              {status}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-[#02665e]/5 border border-[#02665e]/10 px-3.5 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Amount</div>
              <div className="mt-1 text-lg font-extrabold text-[#02665e]">{formattedTotal}</div>
            </div>
            {inv?.createdAt && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Issued</div>
                <div className="mt-1 text-sm font-bold text-slate-800">{new Date(inv.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
              </div>
            )}
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-3 col-span-2 sm:col-span-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Property</div>
              <div className="mt-1 text-sm font-bold text-slate-800 truncate">{propertyTitle}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Invoice Details ── */}
      <div className="relative rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Cross-hatch background */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />

        {/* Sender / Receiver */}
        <div className="relative grid grid-cols-1 sm:grid-cols-2 bg-white/80">
          <div className="p-5 sm:p-6 sm:border-r border-b sm:border-b-0 border-slate-100/80">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#02665e]/60">From</span>
            </div>
            <div className="font-bold text-slate-900 text-base leading-snug">{senderName}</div>
            {senderPhone && senderPhone !== "—" ? (
              <div className="text-[13px] text-slate-500 mt-1.5 flex items-center gap-1.5"><Phone className="h-3 w-3 text-slate-400 flex-shrink-0" aria-hidden />{senderPhone}</div>
            ) : null}
            {senderCity ? (
              <div className="text-[13px] text-slate-500 mt-1 flex items-center gap-1.5"><MapPin className="h-3 w-3 text-slate-400 flex-shrink-0" aria-hidden />{senderAddress}</div>
            ) : null}
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                <Building2 className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#02665e]/60">To</span>
            </div>
            <div className="font-bold text-slate-900 text-base leading-snug">{inv?.receiverName || "NoLS Africa Co LTD"}</div>
            <a href={`mailto:${inv?.receiverEmail || "payments@nolsaf.com"}`} className="no-underline text-[13px] text-slate-500 hover:text-[#02665e] mt-1.5 flex items-center gap-1.5">
              <Mail className="h-3 w-3 text-slate-400 flex-shrink-0" aria-hidden />
              {inv?.receiverEmail || "payments@nolsaf.com"}
            </a>
            <div className="text-[13px] text-slate-500 mt-1 flex items-center gap-1.5"><MapPin className="h-3 w-3 text-slate-400 flex-shrink-0" aria-hidden />{inv?.receiverAddress || "Dar es Salaam, Tanzania"}</div>
          </div>
        </div>

        {/* Perforated tear line */}
        <div className="relative h-5 bg-white/40 flex items-center">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 h-5 w-5 rounded-full bg-slate-100 border border-slate-200" />
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-5 w-5 rounded-full bg-slate-100 border border-slate-200" />
          <div className="w-full border-t-2 border-dashed border-slate-200/80" />
        </div>

        {/* Booking rows */}
        <div className="relative bg-white/60 divide-y divide-slate-100/60">
          <InfoRow label="Property" value={propertyTitle} />
          <InfoRow label="NoLSAF Code" value={codeVisible} mono />
          <InfoRow label="Issued" value={issuedAt} />
          {paidAt ? <InfoRow label="Disbursed" value={paidAt} /> : null}
        </div>

        {/* Payout total footer */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#02665e] via-[#034e47] to-[#023a35]" />
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)', backgroundSize: '16px 16px' }} />
          <div className="relative px-5 sm:px-6 py-5 sm:py-6 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Owner Payout</div>
              <div className="text-[11px] text-white/40 mt-0.5">Amount to be released</div>
            </div>
            <div className="text-right">
              <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">{formattedTotal}</div>
              <span className={`mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${status.toUpperCase() === 'PAID' ? 'bg-emerald-400/20 text-emerald-200' : 'bg-white/15 text-white/70'}`}>{status.toUpperCase() === "PAID" ? "DISBURSED" : status}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Paid notice ── */}
      {status.toUpperCase() === "PAID" ? (
        <div className="relative overflow-hidden rounded-2xl bg-emerald-950 border border-emerald-900 p-5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70 mb-1">Disbursement Confirmed</div>
          <div className="text-sm font-bold text-emerald-300">This invoice has been disbursed. You can view the receipt from your Disbursed list.</div>
        </div>
      ) : null}

    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-5 sm:px-6 py-3.5 flex items-center justify-between gap-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex-shrink-0">{label}</div>
      <div className={`text-sm text-right text-slate-800 ${mono ? "font-mono font-bold tracking-widest" : "font-medium"}`}>{value}</div>
    </div>
  );
}
