"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BadgeCheck, FileWarning, Loader2, LockKeyhole, ShieldAlert } from "lucide-react";

/**
 * Public check behind the QR code on a NoLSAF payslip. Shows NoLSAF's own
 * figures for the slip so whoever holds the printout can compare them.
 * API: GET /api/public/payslips/verify (apps/api/src/routes/public.payslips.ts).
 */

type VerifiedPayslip = {
  issuer: string;
  payslipNumber: string;
  periodMonth: string;
  employeeName: string;
  employeeNo: string | null;
  jobTitle: string | null;
  gross: number;
  totalDeductions: number;
  net: number;
  currency: string;
  paidOn: string | null;
};

type ViewState =
  | { status: "loading" }
  | { status: "invalid"; title: string; message: string; draft?: boolean }
  | { status: "valid"; payslip: VerifiedPayslip };

const money = (currency: string, amount: number) => `${currency} ${Math.round(Number(amount) || 0).toLocaleString("en-US")}`;
const monthName = (periodMonth: string) => new Date(`${periodMonth}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const eatDay = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })}` : "Not recorded");

export default function VerifyPayslipPage() {
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    const token = (new URLSearchParams(window.location.search).get("t") || "").trim();
    if (!token) {
      setState({ status: "invalid", title: "Payslip not verified", message: "This link has no verification code. Scan the QR code on the payslip again." });
      return;
    }
    let alive = true;
    fetch(`/api/public/payslips/verify?t=${encodeURIComponent(token)}`, { credentials: "omit", cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!alive) return;
        if (payload?.ok && payload?.valid && payload?.payslip) {
          setState({ status: "valid", payslip: payload.payslip as VerifiedPayslip });
        } else if (payload?.reason === "NOT_ISSUED") {
          setState({ status: "invalid", draft: true, title: "Payslip not issued", message: "This payslip belongs to a pay run that has not been paid, so it is not proof of income." });
        } else {
          setState({ status: "invalid", title: "Payslip not verified", message: "NoLSAF did not issue a payslip matching this code, or the code was altered." });
        }
      })
      .catch(() => {
        if (alive) setState({ status: "invalid", title: "Could not check right now", message: "The verification service is unavailable. Please try again in a moment." });
      });
    return () => { alive = false; };
  }, []);

  return (
    <main className="min-h-screen bg-[#f4f6f5] px-4 py-8 sm:px-6 sm:py-12" style={{ fontFamily: '"Trebuchet MS", Trebuchet, Arial, sans-serif' }}>
      <section className="mx-auto box-border w-full max-w-lg overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-[0_24px_70px_-35px_rgba(2,102,94,0.45)]">
        <header className="flex items-center gap-3 border-0 border-b border-solid border-neutral-100 px-6 py-5">
          <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
            <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" />
          </span>
          <div>
            <p className="m-0 text-sm font-bold text-neutral-900">NoLS Africa Co Ltd</p>
            <p className="m-0 mt-0.5 text-xs text-neutral-500">Payslip verification</p>
          </div>
        </header>

        {state.status === "loading" ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-neutral-500">
            <Loader2 className="h-6 w-6 animate-spin text-[#02665e]" aria-hidden />
            <p className="m-0 text-sm font-semibold">Checking the payslip</p>
          </div>
        ) : state.status === "invalid" ? (
          <div className="px-6 py-12 text-center">
            <span className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${state.draft ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"}`}>
              {state.draft ? <FileWarning className="h-7 w-7" aria-hidden /> : <ShieldAlert className="h-7 w-7" aria-hidden />}
            </span>
            <h1 className="m-0 mt-4 text-xl font-bold text-neutral-900">{state.title}</h1>
            <p className="mx-auto m-0 mt-2 max-w-sm text-sm leading-6 text-neutral-500">{state.message}</p>
          </div>
        ) : (
          <Verified payslip={state.payslip} />
        )}
      </section>

      <p className="mx-auto mt-4 flex max-w-lg items-center justify-center gap-2 text-center text-xs text-neutral-400">
        <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
        Figures come straight from NoLSAF payroll, not from the printout.
      </p>
    </main>
  );
}

function Verified({ payslip: p }: { payslip: VerifiedPayslip }) {
  return (
    <div>
      <div className="flex items-center gap-3 bg-emerald-50 px-6 py-4">
        <BadgeCheck className="h-8 w-8 shrink-0 text-emerald-700" aria-hidden />
        <div>
          <h1 className="m-0 text-lg font-bold text-emerald-950">Genuine NoLSAF payslip</h1>
          <p className="m-0 mt-0.5 text-xs text-emerald-800">Compare these figures with the payslip you were given. They must match.</p>
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="rounded-2xl bg-[#0b2420] px-5 py-5 text-white">
          <p className="m-0 text-xs font-semibold text-emerald-200/80">Net pay, {monthName(p.periodMonth)}</p>
          <p className="m-0 mt-1.5 text-3xl font-bold tabular-nums">{money(p.currency, p.net)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 border-0 border-t border-solid border-white/10 pt-3 text-xs">
            <div><p className="m-0 text-white/50">Gross pay</p><p className="m-0 mt-0.5 font-semibold tabular-nums">{money(p.currency, p.gross)}</p></div>
            <div><p className="m-0 text-white/50">Deductions</p><p className="m-0 mt-0.5 font-semibold tabular-nums">{money(p.currency, p.totalDeductions)}</p></div>
          </div>
        </div>

        <dl className="m-0 mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
          <Row label="Employee" value={p.employeeName} />
          <Row label="Employee no." value={p.employeeNo || "Not recorded"} mono />
          <Row label="Position" value={p.jobTitle || "Not recorded"} />
          <Row label="Paid on" value={eatDay(p.paidOn)} />
          <Row label="Payslip" value={p.payslipNumber} mono wide />
        </dl>

        <p className="m-0 mt-6 rounded-xl bg-neutral-50 px-4 py-3 text-xs leading-5 text-neutral-500">
          The employee name is shortened for privacy. Tax and social security numbers are never shown here. For anything else, contact NoLSAF directly.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false, wide = false }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-[11px] font-semibold text-neutral-400">{label}</dt>
      <dd className={`m-0 mt-1 break-words text-sm font-semibold text-neutral-800 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
