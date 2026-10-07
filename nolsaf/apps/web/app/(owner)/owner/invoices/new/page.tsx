"use client";
import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BedDouble, Loader2, Check } from "lucide-react";
import { ClaimSteps } from "@/components/owner-payouts/ClaimSteps";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;
const TZ = "Africa/Dar_es_Salaam";

const fmtDay = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short", year: "numeric" }) : "";
const fmtTzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;

export default function NewInvoice() {
  const sp = useSearchParams();
  const bookingReference = String(sp?.get("booking") ?? sp?.get("bookingId") ?? "").trim();
  const router = useRouter();
  const [preview, setPreview] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [agreeDisbursement, setAgreeDisbursement] = useState(false);

  useEffect(() => {
    if (!bookingReference) return;
    api.get(`/api/owner/bookings/${encodeURIComponent(bookingReference)}`)
      .then((r) => setPreview(r.data))
      .catch(() => setErr("This booking could not be loaded."));
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
    if (!agreeDisbursement) return;
    setCreating(true);
    setErr(null);
    try {
      // Idempotent: API returns ok + invoiceReference whether created or already existed.
      const r = await api.post<{ ok: boolean; invoiceReference: string; existed?: boolean }>(`/api/owner/invoices/from-booking`, { bookingReference });
      const invoiceReference = r.data?.invoiceReference;
      if (!invoiceReference) throw new Error("No invoice reference returned");
      router.push(`/owner/invoices/${encodeURIComponent(invoiceReference)}`);
    } catch (e: any) {
      const data = e?.response?.data ?? {};
      // Stays on the new payout flow are claimed with Withdraw, not an invoice.
      if (data.code === "USE_WITHDRAW") { router.push("/owner/payouts"); return; }
      // Back-compat: older API returned 409 with the existing invoice.
      if (e?.response?.status === 409 && data.invoiceReference) { router.push(`/owner/invoices/${encodeURIComponent(data.invoiceReference)}`); return; }
      setErr(String(data.error || e?.message || "Could not create the invoice"));
    } finally {
      setCreating(false);
    }
  };

  const nights = useMemo(() => {
    if (!preview?.checkIn || !preview?.checkOut) return 0;
    const n = Math.round((new Date(preview.checkOut).getTime() - new Date(preview.checkIn).getTime()) / 86_400_000);
    return Number.isFinite(n) ? Math.max(1, n) : 0;
  }, [preview?.checkIn, preview?.checkOut]);

  const baseAmount = useMemo(() => {
    const total = Number(preview?.totalAmount ?? 0);
    const transportFare = Number(preview?.transportFare ?? 0);
    const serverBase = Number(preview?.ownerBaseAmount ?? NaN);
    const value = Number.isFinite(serverBase) ? serverBase : Math.max(0, total - transportFare);
    return Number.isFinite(value) ? value : 0;
  }, [preview?.ownerBaseAmount, preview?.totalAmount, preview?.transportFare]);

  const shell = "w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6";
  const styles = `
    #owner-invoice-new, #owner-invoice-new * { box-sizing: border-box; }
    @keyframes oi-shimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
    #owner-invoice-new .oi-sk { background: linear-gradient(90deg, #eef2f1 0%, #f8faf9 40%, #eef2f1 80%); background-size: 800px 100%; animation: oi-shimmer 1.3s linear infinite; }
  `;

  if (!bookingReference) {
    return (
      <div id="owner-invoice-new" className={shell}>
        <style>{styles}</style>
        <div className="rounded-2xl border border-solid border-slate-300/80 bg-white p-7">
          <p className="m-0 text-lg font-bold text-slate-900">No booking selected</p>
          <p className="m-0 mt-1 text-sm text-slate-500">Open this page from a checked-in stay to create its invoice.</p>
          <Link href="/owner/bookings/checked-in" className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Guests in house
          </Link>
        </div>
      </div>
    );
  }

  const guestName: string = preview?.guestName ?? preview?.user?.name ?? "Guest";

  return (
    <div id="owner-invoice-new" className={shell}>
      <style>{styles}</style>

      {/* ── Header band with the claim steps ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div className="relative px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Claim your payout</p>
              <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">Create the invoice</h1>
              <p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">
                Check the stay below, then create the invoice. You send it to NoLSAF on the next screen.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 self-start rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white transition hover:bg-white/10 sm:self-auto"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </button>
          </div>
          <ClaimSteps current={0} className="mt-6" />
        </div>
      </header>

      {err ? <div className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{err}</div> : null}

      {!preview ? (
        <div className="space-y-3 rounded-2xl border border-solid border-slate-300/80 bg-white p-6">
          <div className="oi-sk h-5 w-56 rounded-full" />
          <div className="oi-sk h-24 rounded-xl" />
          <div className="oi-sk h-14 rounded-xl" />
        </div>
      ) : (
        <article className="overflow-hidden rounded-3xl bg-white shadow-[0_30px_70px_-42px_rgba(1,42,38,0.6)] ring-1 ring-slate-200">
          {/* Document head */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-0 border-b border-solid border-slate-200 px-6 py-5">
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Accommodation invoice · Preview</p>
              <p className="m-0 mt-1 flex items-center gap-2 truncate text-xl font-bold tracking-tight text-slate-900">
                <BedDouble className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                {preview.property?.title ?? "Your property"}
              </p>
              {preview.property?.address ? <p className="m-0 mt-0.5 truncate text-sm text-slate-500">{preview.property.address}</p> : null}
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">Not created yet</span>
          </div>

          {/* From / To */}
          <div className="grid grid-cols-1 border-0 border-b border-solid border-slate-200 sm:grid-cols-2">
            <div className="px-6 py-4">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">From</p>
              <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{preview.property?.owner?.name ?? "You"}</p>
              {preview.property?.owner?.phone ? <p className="m-0 text-xs text-slate-500">{preview.property.owner.phone}</p> : null}
            </div>
            <div className="border-0 border-t border-solid border-slate-200 px-6 py-4 sm:border-l sm:border-t-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">To</p>
              <p className="m-0 mt-1 text-sm font-semibold text-slate-900">NoLSAF</p>
              <p className="m-0 text-xs text-slate-500">Dar es Salaam, Tanzania</p>
            </div>
          </div>

          {/* The one line this invoice claims */}
          <div className="px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold text-slate-900">Accommodation for {guestName}</p>
                <p className="m-0 mt-1 text-xs text-slate-500">
                  {fmtDay(preview.checkIn)} to {fmtDay(preview.checkOut)} · {nights} {nights === 1 ? "night" : "nights"}
                </p>
                <p className="m-0 mt-1 text-xs text-slate-500">
                  {[preview.guestPhone, preview.nationality].filter(Boolean).join(" · ")}
                  {preview.bookingReference ? <span className="ml-1 font-mono text-[11px] text-slate-400">{preview.bookingReference}</span> : null}
                </p>
              </div>
              <div className="text-right">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Your amount</p>
                <p className="m-0 mt-0.5 text-2xl font-bold tabular-nums text-[#02665e]">{fmtTzs(baseAmount)}</p>
              </div>
            </div>

            {/* Agreement and action, same pattern as the check-in pass */}
            <label
              className={`mt-5 flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-inset transition ${
                agreeDisbursement ? "bg-[#02665e]/[0.06] ring-2 ring-[#02665e]" : "bg-white ring-1 ring-slate-300 hover:ring-[#02665e]/60"
              }`}
            >
              <input type="checkbox" checked={agreeDisbursement} onChange={(e) => setAgreeDisbursement(e.target.checked)} className="peer sr-only" />
              <span
                aria-hidden
                className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md border-2 border-solid transition peer-focus-visible:ring-2 peer-focus-visible:ring-[#02665e]/40 peer-focus-visible:ring-offset-2 ${
                  agreeDisbursement ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-400 bg-white text-transparent"
                }`}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
              </span>
              <span className="text-sm text-slate-700">
                I agree to the NoLSAF{" "}
                <a
                  href={process.env.NEXT_PUBLIC_DISBURSEMENT_POLICY_URL ?? "/owner/property-owner-disbursement-policy"}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-[#02665e] underline underline-offset-2"
                >
                  Disbursement Policy
                </a>
              </span>
            </label>

            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => router.back()}
                disabled={creating}
                className="inline-flex h-12 items-center justify-center rounded-xl border border-solid border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doCreate}
                disabled={!agreeDisbursement || creating}
                className="group inline-flex h-12 flex-1 items-center justify-between gap-2 rounded-xl border border-solid border-[#012a26] bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white shadow-[0_14px_30px_-18px_rgba(1,42,38,0.9)] transition hover:bg-[#02665e] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
              >
                {creating ? "Creating..." : "Create the invoice"}
                <span className={`grid h-8 w-8 place-items-center rounded-lg transition group-hover:translate-x-0.5 ${agreeDisbursement ? "bg-[#5eead4] text-[#012a26]" : "bg-slate-200 text-slate-400"}`}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                </span>
              </button>
            </div>
          </div>
        </article>
      )}
    </div>
  );
}
