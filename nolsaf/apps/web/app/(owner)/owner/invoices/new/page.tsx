"use client";
import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Building2, User, Phone, Flag, CalendarDays, Hash } from "lucide-react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function NewInvoice() {
  const sp = useSearchParams();
  const bookingReference = String(sp?.get("booking") ?? sp?.get("bookingId") ?? "").trim();
  const router = useRouter();
  const [preview, setPreview] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeDisbursement, setAgreeDisbursement] = useState(false);

  useEffect(() => {
    if (!bookingReference) return;
    api.get(`/api/owner/bookings/${encodeURIComponent(bookingReference)}`).then(r => setPreview(r.data));
  }, [bookingReference]);

  // Guard: if invoice already exists, redirect and prevent duplicates even via direct URL.
  useEffect(() => {
    if (!bookingReference) return;
    api.get(`/api/owner/invoices/for-booking/${encodeURIComponent(bookingReference)}`).then((r) => {
      if (r.data?.exists && r.data?.invoiceReference) {
        router.replace(`/owner/invoices/${encodeURIComponent(r.data.invoiceReference)}`);
      }
    }).catch(() => {});
  }, [bookingReference, router]);

  const doCreate = async () => {
    setCreating(true);
    setErr(null);
    try {
      // Idempotent: API returns ok + invoiceId whether created or already existed.
      const r = await api.post<{ ok: boolean; invoiceReference: string; existed?: boolean }>(`/api/owner/invoices/from-booking`, { bookingReference });
      const invoiceReference = r.data?.invoiceReference;
      if (!invoiceReference) throw new Error("No invoice reference returned");
      router.push(`/owner/invoices/${encodeURIComponent(invoiceReference)}`);
    } catch (e: any) {
      const status = e?.response?.status ?? null;
      const invoiceReference = e?.response?.data?.invoiceReference ?? null;
      const msg = e?.response?.data?.error || e?.message || "Could not create invoice";
      // Back-compat: older API returned 409 with invoiceId.
      if (status === 409 && invoiceReference) { router.push(`/owner/invoices/${encodeURIComponent(invoiceReference)}`); return; }
      setErr(String(msg));
    }
    finally {
      setCreating(false);
    }
  };

  const create = () => setConsentOpen(true);

  const nights = useMemo(() => {
    if (!preview?.checkIn || !preview?.checkOut) return 0;
    const a = new Date(preview.checkIn).getTime();
    const b = new Date(preview.checkOut).getTime();
    const n = Math.ceil((b - a) / (1000 * 60 * 60 * 24));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [preview?.checkIn, preview?.checkOut]);

  const baseAmount = useMemo(() => {
    const total = Number(preview?.totalAmount ?? 0);
    const transportFare = Number(preview?.transportFare ?? 0);
    const serverBase = Number(preview?.ownerBaseAmount ?? NaN);
    const computed = Math.max(0, total - transportFare);
    const value = Number.isFinite(serverBase) ? serverBase : computed;
    return Number.isFinite(value) ? value : 0;
  }, [preview?.ownerBaseAmount, preview?.totalAmount, preview?.transportFare]);

  if (!bookingReference) {
    return (
      <div className="w-full">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Missing booking</div>
          <div className="mt-1 text-sm text-slate-600">Open this page from a booking’s “Generate Invoice” action.</div>
          <div className="mt-4">
            <Link href="/owner/bookings" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 no-underline">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to bookings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-hidden">
      <div className="rounded-[28px] border border-slate-200/70 bg-gradient-to-br from-white via-emerald-50/30 to-slate-50 p-4 sm:p-6 lg:p-8 shadow-sm ring-1 ring-black/5 nols-entrance">
        <div className="max-w-5xl mx-auto space-y-5 sm:space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 nols-entrance nols-delay-1">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-emerald-600 to-green-600 flex items-center justify-center shadow-sm">
                <FileText className="h-5 w-5 text-white" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-slate-500">Invoice</div>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 truncate">
                  Generate Invoice
                </h1>
                <p className="text-sm text-slate-600">
                  Preview invoice details before creating and sending to NoLSAF.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all active:scale-[0.98]"
              title="Back"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </button>
          </div>

          {!preview ? (
            <div className="bg-white/80 backdrop-blur border border-slate-200 rounded-3xl shadow-sm p-6 nols-entrance nols-delay-2">
              <div className="text-sm text-slate-600">Loading invoice preview…</div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-16 rounded-2xl border border-slate-200 bg-white animate-pulse" />
                ))}
              </div>
            </div>
          ) : (
            <>
              {err && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 nols-entrance">
                  {err}
                </div>
              )}
              {/* Invoice Preview Card */}
              <div className="bg-white/90 backdrop-blur border border-slate-200 rounded-3xl shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md nols-entrance nols-delay-2">
                <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold tracking-wide text-slate-600 uppercase">Invoice preview</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900 truncate">
                        {preview.property?.title ?? "Guest booking"} | Accommodation Invoice
                      </div>
                      {preview.property?.address ? (
                        <div className="text-sm text-slate-600 truncate">{preview.property.address}</div>
                      ) : null}
                    </div>
                    <span className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Preview
                    </span>
                  </div>
                </div>

                <div className="p-4 sm:p-6 space-y-4">
                  {/* Parties */}
                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <PartyCard
                      title="Sender (Owner)"
                      icon={<Building2 className="h-4 w-4 text-slate-600" aria-hidden />}
                      lines={[
                        preview.property?.owner?.name ?? "Owner",
                        preview.property?.owner?.phone ?? "",
                      ].filter(Boolean)}
                    />
                    <PartyCard
                      title="Receiver (NoLSAF)"
                      icon={<Building2 className="h-4 w-4 text-slate-600" aria-hidden />}
                      lines={["NoLSAF", "Dar es Salaam, Tanzania"]}
                    />
                  </div>

                  {/* Key details (responsive tiles) */}
                  <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 gap-3">
                    <InfoTile icon={<User className="h-4 w-4 text-slate-500" aria-hidden />} label="Client" value={preview.guestName ?? "-"} />
                    <InfoTile icon={<Phone className="h-4 w-4 text-slate-500" aria-hidden />} label="Phone" value={preview.guestPhone ?? "-"} />
                    <InfoTile icon={<Flag className="h-4 w-4 text-slate-500" aria-hidden />} label="Nationality" value={preview.nationality ?? "-"} />
                    <InfoTile icon={<Hash className="h-4 w-4 text-slate-500" aria-hidden />} label="NoLSAF Code" value={preview.code?.codeVisible ?? "-"} />
                    <InfoTile icon={<CalendarDays className="h-4 w-4 text-slate-500" aria-hidden />} label="Check-in" value={new Date(preview.checkIn).toLocaleString()} span />
                    <InfoTile icon={<CalendarDays className="h-4 w-4 text-slate-500" aria-hidden />} label="Check-out" value={new Date(preview.checkOut).toLocaleString()} span />
                    <InfoTile label="Nights" value={String(nights)} />
                    <InfoTile label="Base amount" value={`TZS ${baseAmount}`} />
                  </div>
                </div>
              </div>

              {/* Action bar */}
              <div className="rounded-3xl border border-slate-200 bg-white/90 backdrop-blur p-4 sm:p-5 shadow-sm ring-1 ring-black/5 nols-entrance nols-delay-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-sm text-slate-600">
                    When you create this invoice, it will be prepared for submission to NoLSAF.
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => router.back()}
                      className="px-4 py-3 rounded-2xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-all duration-200 active:scale-[0.98]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={create}
                      disabled={creating}
                      className="px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-green-600 text-white text-sm font-semibold shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:shadow-emerald-500/25 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 active:scale-[0.98]"
                    >
                      {creating ? "Creating…" : "Create Invoice"}
                    </button>
                  </div>
                </div>
              </div>

              <ConsentModal
                open={consentOpen}
                onClose={() => setConsentOpen(false)}
                agreeTerms={agreeTerms}
                setAgreeTerms={setAgreeTerms}
                agreeDisbursement={agreeDisbursement}
                setAgreeDisbursement={setAgreeDisbursement}
                onConfirm={async () => {
                  setConsentOpen(false);
                  await doCreate();
                }}
                confirmLoading={creating}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConsentModal({
  open,
  onClose,
  agreeTerms,
  setAgreeTerms,
  agreeDisbursement,
  setAgreeDisbursement,
  onConfirm,
  confirmLoading,
}: {
  open: boolean;
  onClose: () => void;
  agreeTerms: boolean;
  setAgreeTerms: (v: boolean) => void;
  agreeDisbursement: boolean;
  setAgreeDisbursement: (v: boolean) => void;
  onConfirm: () => void;
  confirmLoading: boolean;
}) {
  if (!open) return null;
  const termsUrl = process.env.NEXT_PUBLIC_TERMS_URL ?? "#";
  const disbursementUrl =
    process.env.NEXT_PUBLIC_DISBURSEMENT_POLICY_URL ??
    process.env.NEXT_PUBLIC_PAYOUT_POLICY_URL ??
    "#";
  const canProceed = agreeTerms && agreeDisbursement && !confirmLoading;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 z-10 animate-in zoom-in-95 duration-300 space-y-4 border border-slate-200">
        <div className="text-lg font-bold text-slate-900">Before you proceed</div>
        <p className="text-sm text-slate-600">
          Please confirm you agree to the Terms &amp; Conditions and the Disbursement Policy.
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500/20" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
            <span className="text-sm text-slate-700">
              I agree to the{" "}
              <a className="text-emerald-700 font-semibold underline underline-offset-2" href={termsUrl} target="_blank" rel="noreferrer">
                Terms &amp; Conditions
              </a>.
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500/20" checked={agreeDisbursement} onChange={(e) => setAgreeDisbursement(e.target.checked)} />
            <span className="text-sm text-slate-700">
              I agree to the{" "}
              <a className="text-emerald-700 font-semibold underline underline-offset-2" href={disbursementUrl} target="_blank" rel="noreferrer">
                Disbursement Policy
              </a>.
            </span>
          </label>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-2xl border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition-all active:scale-[0.98]">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={!canProceed} className="flex-1 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-green-600 text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed transition-all active:scale-[0.98]">
            {confirmLoading ? "Creating…" : "Agree & Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PartyCard({ title, icon, lines }: { title: string; icon: React.ReactNode; lines: string[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-50 border border-slate-200">
          {icon}
        </span>
        <div className="text-sm font-semibold text-slate-900">{title}</div>
      </div>
      <div className="mt-3 space-y-1 text-sm text-slate-700">
        {lines.map((l, i) => (
          <div key={i} className="truncate">{l}</div>
        ))}
      </div>
    </div>
  );
}

function InfoTile({ label, value, icon, span }: { label: string; value: string; icon?: React.ReactNode; span?: boolean }) {
  return (
    <div className={`${span ? "min-[420px]:col-span-2 lg:col-span-3" : ""} min-w-0 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm transition-all duration-200 hover:shadow-md hover:border-slate-300`}>
      <div className="flex items-center gap-2">
        {icon ? <span className="inline-flex">{icon}</span> : null}
        <div className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">{label}</div>
      </div>
      <div className="mt-1 text-[13px] sm:text-[14px] font-semibold text-slate-900 leading-snug break-words">{value || "—"}</div>
    </div>
  );
}
