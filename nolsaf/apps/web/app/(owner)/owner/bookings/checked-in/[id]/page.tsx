"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Clock, CheckCircle, Calendar, User, Phone,
  DollarSign, FileText, Building2, Lock, MapPin, Hash,
  Globe, Users, Sparkles,
} from "lucide-react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function BookingDetail() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const [b, setB] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [invMeta, setInvMeta] = useState<{
    exists: boolean; invoiceId: number | null; status?: string | null;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.get(`/api/owner/bookings/${idParam}`),
      api.get(`/api/owner/invoices/for-booking/${idParam}`),
    ])
      .then(([br, ir]) => {
        if (!mounted) return;
        setB(br.data);
        setInvMeta({
          exists: Boolean(ir.data?.exists),
          invoiceId: ir.data?.invoiceId ? Number(ir.data.invoiceId) : null,
          status: ir.data?.status ?? null,
        });
        setLoading(false);
      })
      .catch((err: any) => {
        if (!mounted) return;
        console.warn("Failed to load booking or invoice meta", err);
        setLoading(false);
      });

    return () => { mounted = false; };
  }, [idParam]);

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-8 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-5 w-32 bg-slate-200 rounded-full" />
          <div className="h-40 bg-slate-200 rounded-3xl" />
          <div className="grid md:grid-cols-2 gap-6">
            <div className="h-64 bg-slate-200 rounded-3xl" />
            <div className="h-64 bg-slate-200 rounded-3xl" />
          </div>
          <div className="h-16 bg-slate-200 rounded-2xl" />
        </div>
      </div>
    );
  }

  /* ── Not found ── */
  if (!b) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-rose-50 border border-rose-100 flex items-center justify-center">
            <span className="text-4xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Booking Not Found</h2>
          <p className="text-sm text-slate-500 mb-8 leading-relaxed">
            This booking doesn&apos;t exist or you don&apos;t have access to it.
          </p>
          <Link
            href="/owner/bookings"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-600 text-white font-semibold shadow-lg shadow-teal-500/25 hover:shadow-teal-500/40 hover:-translate-y-0.5 transition-all duration-200 no-underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Bookings
          </Link>
        </div>
      </div>
    );
  }

  const isCheckedIn = b.status === "CHECKED_IN";
  const _isWaiting = !isCheckedIn && (b.status === "NEW" || b.status === "CONFIRMED");
  const bookingCode = b.code?.codeVisible ?? "-";
  const formatDate = (date: string | Date) =>
    new Date(date).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  const formatCurrency = (amount: number) =>
    `TZS ${Number(amount).toLocaleString("en-TZ")}`;

  const baseAmount = (() => {
    const oba = Number(b?.ownerBaseAmount ?? 0);
    if (Number.isFinite(oba) && oba > 0) return oba;
    const total = Number(b?.totalAmount ?? 0);
    const transport = Number(b?.transportFare ?? 0);
    if (!Number.isFinite(total) || !Number.isFinite(transport)) return 0;
    return Math.max(0, total - transport);
  })();

  const heroGradient = "from-[#02665e] via-[#034e47] to-[#023a35]";
  const heroShadow = "shadow-[#02665e]/20";

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Back link ── */}
        <Link
          href="/owner/bookings"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[#02665e] transition-colors duration-150 no-underline group"
        >
          <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center group-hover:border-[#02665e]/30 group-hover:shadow-md transition-all duration-200">
            <ArrowLeft className="h-3.5 w-3.5" />
          </span>
          Back to Bookings
        </Link>

        {/* ── Hero banner ── */}
        <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${heroGradient} shadow-xl ${heroShadow}`}>
          {/* Cross-hatch pattern */}
          <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)', backgroundSize: '18px 18px' }} />
          {/* Decorative circles */}
          <div className="absolute -top-12 -right-12 w-52 h-52 rounded-full bg-white/[0.04] pointer-events-none" />
          <div className="absolute -bottom-16 -left-8 w-48 h-48 rounded-full bg-white/[0.03] pointer-events-none" />

          <div className="relative px-6 sm:px-8 pt-6 sm:pt-7 pb-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center flex-shrink-0">
                  {isCheckedIn
                    ? <CheckCircle className="h-6 w-6 text-white" />
                    : <Clock className="h-6 w-6 text-white" />}
                </div>
                <div>
                  <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-0.5">Booking #{b.id}</p>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                    {isCheckedIn ? "Checked In" : "Awaiting Check-in"}
                  </h1>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold tracking-widest uppercase bg-white/15 border border-white/20 text-white backdrop-blur-sm">
                <span className={`h-1.5 w-1.5 rounded-full ${isCheckedIn ? 'bg-emerald-300 animate-pulse' : 'bg-amber-300'}`} />
                {b.status?.replace("_", " ")}
              </span>
            </div>
          </div>

          {/* Quick stat strip */}
          <div className="relative px-6 sm:px-8 pb-6 grid grid-cols-3 gap-2.5">
            {[
              { label: "Check-in", value: formatDate(b.checkIn).split(",")[0] },
              { label: "Check-out", value: formatDate(b.checkOut).split(",")[0] },
              { label: "Revenue", value: baseAmount > 0 ? `TZS ${Number(baseAmount).toLocaleString("en-TZ")}` : "—" },
            ].map((s) => (
              <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/10 text-center">
                <p className="text-[9px] font-bold text-white/50 uppercase tracking-wider">{s.label}</p>
                <p className="text-sm font-bold text-white mt-0.5 truncate">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Detail cards ── */}
        <div className="grid gap-5 md:grid-cols-2">
          {/* Personal Details */}
          <div className="relative rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />
            <div className="relative bg-white/90">
              <div className="px-5 pt-4 pb-3 flex items-center gap-2.5 border-b border-slate-100">
                <div className="h-8 w-8 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                  <User className="h-4 w-4 text-[#02665e]" />
                </div>
                <h2 className="text-sm font-bold text-slate-800">Personal Details</h2>
              </div>
              <div className="px-5 py-4 space-y-0.5">
                <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Full Name" value={b.guestName ?? b.user?.name ?? "—"} />
                <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={b.guestPhone ?? b.user?.phone ?? "—"} mono />
                <InfoRow icon={<Globe className="h-3.5 w-3.5" />} label="Nationality" value={b.nationality ?? "—"} />
                <InfoRow icon={<Users className="h-3.5 w-3.5" />} label="Sex" value={b.sex ?? "—"} />
                <InfoRow icon={<Sparkles className="h-3.5 w-3.5" />} label="Age Group" value={b.ageGroup ?? "—"} />
              </div>
            </div>
          </div>

          {/* Booking Details */}
          <div className="relative rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />
            <div className="relative bg-white/90">
              <div className="px-5 pt-4 pb-3 flex items-center gap-2.5 border-b border-slate-100">
                <div className="h-8 w-8 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                  <Calendar className="h-4 w-4 text-[#02665e]" />
                </div>
                <h2 className="text-sm font-bold text-slate-800">Booking Details</h2>
              </div>
              <div className="px-5 py-4 space-y-0.5">
                <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Property" value={`${b.property?.title ?? "—"}  ·  ${b.property?.type ?? "—"}`} />
                <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Check-in" value={formatDate(b.checkIn)} />
                <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Check-out" value={formatDate(b.checkOut)} />
                <InfoRow icon={<DollarSign className="h-3.5 w-3.5" />} label="Base Amount" value={baseAmount > 0 ? formatCurrency(baseAmount) : "—"} highlight />
                <InfoRow icon={<Hash className="h-3.5 w-3.5" />} label="NoLSAF Code" value={bookingCode} mono />
              </div>
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-[#02665e]" />
            </div>
            <h2 className="text-sm font-bold text-slate-800">Actions</h2>
          </div>
          <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
            {/* Left – invoice actions */}
            <div className="flex items-center gap-2.5">
            {isCheckedIn && (
              invMeta?.exists ? (
                <>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 text-slate-400 cursor-not-allowed font-semibold text-[13px] border border-slate-200"
                    title="Invoice already generated"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    Invoice Generated
                  </button>
                  {invMeta.invoiceId && (
                    <Link
                      href={`/owner/invoices/${invMeta.invoiceId}`}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#02665e] text-white hover:bg-[#034e47] transition-colors duration-150 font-semibold text-[13px] shadow-sm no-underline"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View Invoice
                    </Link>
                  )}
                </>
              ) : (
                <Link
                  href={`/owner/invoices/new?booking=${encodeURIComponent(b.bookingReference)}`}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#02665e] text-white font-semibold text-[13px] shadow-sm hover:bg-[#034e47] transition-colors duration-150 no-underline"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Generate Invoice
                </Link>
              )
            )}
            </div>
            {/* Right – back */}
            <Link
              href="/owner/bookings"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors duration-150 font-semibold text-[13px] no-underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to List
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── InfoRow sub-component ── */
function InfoRow({
  icon, label, value, mono, highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100/80 last:border-0">
      <span className="flex-shrink-0 w-6 h-6 rounded-md bg-[#02665e]/8 flex items-center justify-center text-[#02665e]">
        {icon}
      </span>
      <span className="text-[11px] text-slate-400 font-medium w-24 flex-shrink-0">{label}</span>
      <span className={`text-sm flex-1 break-words ${
        highlight ? "font-bold text-[#02665e]" : "font-semibold text-slate-700"
      } ${mono ? "font-mono tracking-wide text-xs" : ""}`.trim()}>
        {value}
      </span>
    </div>
  );
}
