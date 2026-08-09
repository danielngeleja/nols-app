"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BadgeCheck, Loader2, LockKeyhole, ShieldAlert } from "lucide-react";

type VerifiedReceipt = {
  issuer: string;
  documentType: string;
  receiptNumber: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  provider: string;
  providerReference: string;
  nolsafReference: string;
  maskedDestination: string;
  propertyName: string;
  settledAt: string;
  issuedAt: string;
  timeZone: string;
  verificationId: string;
  disclaimer: string;
};

type ViewState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "valid"; receipt: VerifiedReceipt };

function formatSettlement(value: string, timeZone: string): string {
  const dateTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

  return `${dateTime} EAT`;
}

export default function VerifyPayoutReceiptPage() {
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = (params.get("t") || params.get("token") || "").trim();
    if (!token) {
      setState({ status: "invalid", message: "No receipt verification token was provided." });
      return;
    }

    let alive = true;
    fetch(`/api/public/owner-payout-receipts/verify?token=${encodeURIComponent(token)}`, {
      credentials: "omit",
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((payload) => {
        if (!alive) return;
        if (payload?.ok && payload?.valid && payload?.receipt) {
          setState({ status: "valid", receipt: payload.receipt as VerifiedReceipt });
        } else {
          setState({ status: "invalid", message: "This receipt was not issued by NoLSAF or its verification link was altered." });
        }
      })
      .catch(() => {
        if (alive) setState({ status: "invalid", message: "The verification service is currently unavailable. Please try again." });
      });
    return () => { alive = false; };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6" style={{ fontFamily: '"Trebuchet MS", Trebuchet, Arial, sans-serif' }}>
      <section className="mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_-35px_rgba(2,102,94,0.45)]">
        <header className="relative overflow-hidden bg-[#02665e] px-6 py-6 text-white">
          <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "radial-gradient(#fff 1px,transparent 1px)", backgroundSize: "16px 16px" }} />
          <div className="relative flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-white">
              <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={28} height={28} />
            </span>
            <div>
              <p className="m-0 text-sm font-bold">NoLS Africa Co Ltd</p>
              <p className="mb-0 mt-0.5 text-xs text-white/70">Payout receipt verification</p>
            </div>
          </div>
        </header>

        {state.status === "loading" ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-[#02665e]" aria-hidden />
            <p className="m-0 text-sm font-semibold">Checking the receipt signature</p>
          </div>
        ) : state.status === "invalid" ? (
          <div className="px-6 py-10 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-rose-600" aria-hidden />
            <h1 className="mb-0 mt-4 text-xl font-bold text-slate-900">Receipt not verified</h1>
            <p className="mx-auto mb-0 mt-2 max-w-sm text-sm leading-6 text-slate-500">{state.message}</p>
          </div>
        ) : (
          <VerifiedView receipt={state.receipt} />
        )}
      </section>

      <p className="mx-auto mt-4 flex max-w-xl items-center justify-center gap-2 text-center text-xs text-slate-400">
        <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
        Verified using a server-signed, tamper-evident receipt snapshot.
      </p>
    </main>
  );
}

function VerifiedView({ receipt }: { receipt: VerifiedReceipt }) {
  return (
    <div>
      <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50 px-6 py-4">
        <BadgeCheck className="h-8 w-8 text-emerald-700" aria-hidden />
        <div>
          <h1 className="m-0 text-lg font-bold text-emerald-950">Genuine NoLSAF receipt</h1>
          <p className="mb-0 mt-0.5 text-xs text-emerald-700">The signed settlement facts match this verification link.</p>
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="rounded-2xl bg-slate-950 px-5 py-5 text-white">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Net amount disbursed</p>
          <p className="mb-0 mt-2 text-3xl font-semibold tabular-nums">{receipt.currency} {Number(receipt.amount).toLocaleString("en-US")}</p>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <Row label="Receipt" value={receipt.receiptNumber} mono />
          <Row label="Invoice" value={receipt.invoiceNumber} mono />
          <Row label="Property" value={receipt.propertyName} />
          <Row label="Settled" value={formatSettlement(receipt.settledAt, receipt.timeZone)} />
          <Row label="Provider" value={receipt.provider} />
          <Row label="Destination" value={receipt.maskedDestination} mono />
          <Row label="Provider reference" value={receipt.providerReference} mono />
          <Row label="NoLSAF reference" value={receipt.nolsafReference} mono />
          <Row label="Verification ID" value={receipt.verificationId} mono />
        </dl>

        <p className="mb-0 mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          {receipt.disclaimer}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">{label}</dt>
      <dd className={`mb-0 mt-1 break-words text-sm font-semibold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
