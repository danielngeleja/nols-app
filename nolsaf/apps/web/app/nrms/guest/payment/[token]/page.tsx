"use client";

import { use, useEffect, useState } from "react";
import { ArrowLeft, Building2, Check, CheckCircle2, Clock3, Copy, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import NrmsPoweredByFooter from "@/components/nrms/NrmsPoweredByFooter";

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export default function GuestPaymentRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    apiClient
      .get(`/api/public/nrms/guest/payment-requests/${encodeURIComponent(token)}`)
      .then((response) => setData(response.data.paymentRequest))
      .catch((requestError) => setError(requestError?.response?.data?.error || "This payment request is unavailable."));
  }, [token]);

  const copyInstruction = async (value: string, index: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((current) => current === index ? null : current), 1800);
    } catch {
      setCopiedIndex(null);
    }
  };

  if (!data && !error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100">
        <div className="flex items-center gap-3 text-sm font-semibold text-neutral-500">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />
          Loading secure payment instructions
        </div>
      </main>
    );
  }

  const instructions = Array.isArray(data?.instructions) ? data.instructions : [];
  const requestKind = String(data?.kind || "PAYMENT").replaceAll("_", " ").toLowerCase();
  const dueAt = data?.dueAt ? new Date(data.dueAt) : null;
  const dueLabel = dueAt && !Number.isNaN(dueAt.getTime())
    ? dueAt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Contact the hotel";

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 sm:py-10">
      <div className="mx-auto mb-3 max-w-xl">
        <button type="button" onClick={() => router.back()} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-600 shadow-sm transition hover:border-amber-300 hover:text-amber-800" aria-label="Back to reservation">
          <ArrowLeft className="h-3.5 w-3.5" />Back to reservation
        </button>
      </div>
      <section className="mx-auto max-w-xl overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <header className="border-b border-neutral-100 px-5 py-5 sm:px-6">
          <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-emerald-800 text-white">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.17em] text-emerald-700">Hotel direct payment</p>
              <h1 className="mb-0 mt-1 truncate text-xl font-bold tracking-tight text-neutral-950">{data?.property || "Payment request"}</h1>
            </div>
            {data?.status === "SETTLED" && (
              <span className="hidden items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-800 sm:inline-flex">
                <CheckCircle2 className="h-3 w-3" />Settled
              </span>
            )}
          </div>
        </header>

        {error ? (
          <div className="p-5 sm:p-6">
            <div className="border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">{error}</div>
          </div>
        ) : (
          <div className="p-5 sm:p-6">
            <p className="m-0 text-sm leading-6 text-neutral-600">
              Hello <strong className="font-semibold text-neutral-900">{data.guest}</strong>. Review the amount and use one of the property&apos;s instructions below.
            </p>

            <div className="relative isolate mt-5 overflow-hidden rounded-xl border border-[#9b7422]/70 bg-[linear-gradient(135deg,#f7e8b0_0%,#d8ad49_48%,#b77e16_100%)] p-5 text-[#2b2009] shadow-[0_18px_38px_rgba(120,82,14,0.24)] sm:p-6">
              <div className="pointer-events-none absolute -right-16 -top-24 -z-10 h-64 w-64 rounded-full border border-[#5f430a]/15 bg-white/10" aria-hidden="true" />
              <div className="pointer-events-none absolute -bottom-24 -left-16 -z-10 h-52 w-52 rounded-full border border-[#5f430a]/10 bg-[#fff6cf]/10" aria-hidden="true" />
              <div className="pointer-events-none absolute inset-0 -z-10 opacity-50 [background-image:linear-gradient(115deg,transparent_0%,transparent_43%,rgba(255,255,255,0.38)_43%,rgba(255,255,255,0.08)_63%,transparent_63%)]" aria-hidden="true" />

              <div className="flex items-start justify-between gap-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-black/15 bg-[#211b0e]/90 text-[#f7dda0] shadow-sm">
                  <CreditCard className="h-4 w-4" />
                </span>
                <div className="text-right">
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[0.18em] text-[#3b2b0b]/65">NRMS payment request</p>
                  <p className="mb-0 mt-1 inline-flex rounded-sm bg-[#211b0e]/90 px-2 py-1 text-[8px] font-bold uppercase tracking-[0.12em] text-[#f7dda0]">{String(data.status || "PENDING").replaceAll("_", " ")}</p>
                </div>
              </div>

              <div className="mt-7">
                <p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-[#3b2b0b]/60">Amount requested</p>
                <p className="mb-0 mt-1 text-3xl font-bold tracking-[-0.03em] text-[#211806] sm:text-4xl">{formatMoney(data.amount, data.currency)}</p>
                <p className="mb-0 mt-1.5 text-[11px] text-[#3b2b0b]/75"><span className="capitalize">{requestKind}</span> for your stay</p>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-5 border-t border-[#3b2b0b]/20 pt-4">
                <div>
                  <p className="m-0 text-[8px] font-bold uppercase tracking-[0.14em] text-[#3b2b0b]/50">Reference</p>
                  <p className="mb-0 mt-1 break-all font-mono text-[10px] font-bold tracking-wide text-[#211806]/90">{data.receiptNumber || "Your stay"}</p>
                </div>
                <div className="text-right">
                  <p className="m-0 text-[8px] font-bold uppercase tracking-[0.14em] text-[#3b2b0b]/50">Complete by</p>
                  <p className="mb-0 mt-1 inline-flex items-center justify-end gap-1 text-[10px] font-bold text-[#211806]"><Clock3 className="h-3 w-3 text-[#5d430e]" />{dueLabel}</p>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3.5">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div>
                  <p className="m-0 text-sm font-bold text-emerald-950">Pay the property directly</p>
                  <p className="mb-0 mt-1 text-xs leading-5 text-emerald-900/70">NoLSAF and NRMS do not collect or hold this money.</p>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-700">Payment methods</p>
                  <h2 className="mb-0 mt-1 text-base font-bold text-neutral-950">Hotel instructions</h2>
                </div>
                <span className="text-[9px] text-neutral-400">{instructions.length || 0} available</span>
              </div>

              <div className="mt-3 space-y-2.5">
                {instructions.length ? instructions.map((item: any, index: number) => {
                  const label = String(item?.label || item?.name || "Payment option");
                  const value = typeof item?.value === "string" ? item.value : String(item?.value ?? "");
                  return (
                    <article key={`${label}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3.5 py-3.5 transition hover:border-emerald-200 hover:bg-emerald-50/30">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-bold text-neutral-500">{String(index + 1).padStart(2, "0")}</span>
                      <div className="min-w-0">
                        <p className="m-0 text-xs font-bold text-neutral-900">{label}</p>
                        <p className="mb-0 mt-1 break-all font-mono text-sm text-neutral-600">{value}</p>
                      </div>
                      {value && (
                        <button type="button" onClick={() => void copyInstruction(value, index)} className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 text-[9px] font-bold text-neutral-600 transition hover:border-emerald-300 hover:bg-white hover:text-emerald-700" aria-label={`Copy ${label}`}>
                          {copiedIndex === index ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          <span className="hidden sm:inline">{copiedIndex === index ? "Copied" : "Copy"}</span>
                        </button>
                      )}
                    </article>
                  );
                }) : (
                  <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5 text-sm leading-6 text-neutral-500">
                    The hotel has not published digital payment instructions. Contact the property and confirm its details before paying.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex items-start gap-3 border-t border-neutral-200 pt-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <p className="m-0 text-[11px] leading-5 text-neutral-500">Confirm the property name and requested amount before paying. Keep the payment receipt until the hotel records your deposit.</p>
            </div>

            {data.status === "SETTLED" && (
              <div className="mt-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />The hotel marked this payment request as settled.
              </div>
            )}
          </div>
        )}
      </section>
      <NrmsPoweredByFooter className="max-w-xl px-0 sm:px-0" />
    </main>
  );
}
