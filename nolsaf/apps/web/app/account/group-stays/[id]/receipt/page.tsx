"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, CreditCard, MapPin, Printer } from "lucide-react";
import JsBarcode from "jsbarcode";
import apiClient from "@/lib/apiClient";
import LogoSpinner from "@/components/LogoSpinner";

type Receipt = {
  bookingId: number;
  receiptNumber: string;
  guestName: string;
  guestEmail: string | null;
  propertyName: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  bookingTotal: number;
  depositPaid: number;
  remainingBalance: number;
  currency: string;
  paymentMethod: string;
  paymentRef: string | null;
  paidAt: string;
};

const money = (currency: string, amount: number) => `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
const date = (value: string, withTime = false) => new Date(value).toLocaleString("en-GB", withTime
  ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
  : { day: "2-digit", month: "short", year: "numeric" });

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex items-start justify-between gap-4 py-1.5 text-xs"><span className="text-slate-500">{label}</span><span className={`max-w-[65%] break-words text-right font-semibold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</span></div>;
}

export default function GroupStayReceiptPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || "");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return setError("Invalid booking.");
    apiClient.get(`/api/customer/group-stays/${encodeURIComponent(id)}/deposit-receipt-data`)
      .then((res) => setReceipt(res.data.receipt))
      .catch((err) => setError(err?.response?.data?.message || "Receipt could not be loaded."));
  }, [id]);

  useEffect(() => {
    if (!receipt) return setBarcodeDataUrl(null);
    try {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(svg, receipt.receiptNumber, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        width: 1.35,
        height: 42,
        background: "#ffffff",
        lineColor: "#123a37",
      });
      const serialized = new XMLSerializer().serializeToString(svg);
      const encoded = window.btoa(unescape(encodeURIComponent(serialized)));
      setBarcodeDataUrl(`data:image/svg+xml;base64,${encoded}`);
    } catch {
      setBarcodeDataUrl(null);
    }
  }, [receipt]);

  if (!receipt && !error) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><div className="text-center"><LogoSpinner size="md" ariaLabel="Loading receipt" /><p className="mt-3 text-sm text-slate-500">Loading receipt...</p></div></main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-12 pt-24 print:bg-white print:p-0">
      <div className="mx-auto max-w-[470px]">
        <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
          <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />Back</button>
          {receipt && <button onClick={() => window.print()} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50" title="Print receipt"><Printer className="h-4 w-4" /></button>}
        </div>

        {error || !receipt ? <div className="rounded-2xl border border-rose-200 bg-white p-6 text-center text-sm text-rose-700">{error}</div> : (
          <article className="overflow-hidden rounded-[28px] border border-emerald-100 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.10)] print:rounded-none print:border-0 print:shadow-none">
            <header className="bg-[#f3fbf9] px-6 py-6">
              <div className="flex items-start justify-between gap-4">
                <div><div className="text-xs font-black uppercase tracking-[0.18em] text-[#02665e]">NoLSAF</div><h1 className="mt-2 text-[28px] font-black tracking-tight text-[#123a37]">Payment Receipt</h1><p className="mt-1 text-xs text-slate-500">Group stay deposit</p></div>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Paid</span>
              </div>
              <div className="mt-5 rounded-2xl bg-[#02665e] p-5 text-white">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/65">Deposit paid</div>
                <div className="mt-1 text-3xl font-black tracking-tight">{money(receipt.currency, receipt.depositPaid)}</div>
                <div className="mt-2 text-xs text-white/70">Paid {date(receipt.paidAt, true)}</div>
              </div>
            </header>

            <div className="space-y-5 p-6">
              <section><div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Payment summary</div><div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase text-slate-400">Booking total</div><div className="mt-1 text-sm font-extrabold text-slate-800">{money(receipt.currency, receipt.bookingTotal)}</div></div><div className="rounded-xl bg-amber-50 p-3"><div className="text-[10px] uppercase text-amber-600">Stay balance</div><div className="mt-1 text-sm font-extrabold text-amber-800">{money(receipt.currency, receipt.remainingBalance)}</div></div></div></section>

              <section className="rounded-2xl border border-slate-100 p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-[#02665e]"><CreditCard className="h-4 w-4" />Payment details</div><DetailRow label="Receipt number" value={receipt.receiptNumber} mono /><DetailRow label="Method" value={receipt.paymentMethod.replace(/_/g, " ")} /><DetailRow label="Transaction reference" value={receipt.paymentRef || "—"} mono /></section>

              <section className="rounded-2xl border border-slate-100 p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-[#02665e]"><MapPin className="h-4 w-4" />Accommodation</div><DetailRow label="Property" value={receipt.propertyName} /><DetailRow label="Location" value={receipt.destination || "—"} /><div className="my-2 h-px bg-slate-100" /><div className="mb-1 flex items-center gap-2 text-xs font-bold text-[#02665e]"><CalendarDays className="h-4 w-4" />Stay dates</div><DetailRow label="Check-in" value={date(receipt.checkIn)} /><DetailRow label="Check-out" value={date(receipt.checkOut)} /></section>

              <section className="rounded-2xl bg-slate-50 p-4"><DetailRow label="Guest" value={receipt.guestName} />{receipt.guestEmail && <DetailRow label="Email" value={receipt.guestEmail} />}<DetailRow label="Booking reference" value={`#${receipt.bookingId}`} /></section>

              {barcodeDataUrl && (
                <section className="border-t border-dashed border-slate-200 pt-5 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={barcodeDataUrl} alt={`Barcode for ${receipt.receiptNumber}`} className="mx-auto h-[42px] max-w-full" />
                  <div className="mt-2 font-mono text-[10px] font-bold tracking-[0.08em] text-[#123a37]">{receipt.receiptNumber}</div>
                  <div className="mt-1 text-[9px] uppercase tracking-[0.14em] text-slate-400">Receipt reference barcode</div>
                </section>
              )}
              <p className="text-center text-[10px] leading-4 text-slate-400">This receipt confirms the deposit payment. The remaining balance is payable according to your booking arrangement.</p>
            </div>
          </article>
        )}
      </div>
    </main>
  );
}
