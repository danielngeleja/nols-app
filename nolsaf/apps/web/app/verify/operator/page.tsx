"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, CalendarCheck, Loader2, Lock, MapPin, ShieldCheck } from "lucide-react";

type Certificate = {
  issuer: string;
  operator: { id: number; companyName: string; location: string };
  verification: { status: "VERIFIED"; verifiedAt: string; method: string; note: string };
};

type State =
  | { status: "loading" }
  | { status: "valid"; certificate: Certificate }
  | { status: "invalid"; reason: string };

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function certificateId(operatorId: number) {
  return `NOLS-TO-${String(operatorId).padStart(6, "0")}`;
}

export default function OperatorVerificationPage() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const token = (new URLSearchParams(window.location.search).get("t") || "").trim();
    if (!token) {
      setState({ status: "invalid", reason: "No tour operator verification token was provided." });
      return;
    }

    let alive = true;
    fetch(`/api/public/agents/verification?t=${encodeURIComponent(token)}`, { credentials: "same-origin" })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!alive) return;
        if (data?.ok && data?.valid && data?.certificate) {
          setState({ status: "valid", certificate: data.certificate as Certificate });
        } else {
          setState({ status: "invalid", reason: "This tour operator certificate is not currently active or could not be verified." });
        }
      })
      .catch(() => {
        if (alive) setState({ status: "invalid", reason: "We could not reach the verification service. Please try again." });
      });

    return () => { alive = false; };
  }, []);

  return (
    <main className="min-h-screen bg-[#efe7d7] px-4 py-6 text-slate-950 sm:py-10" style={{ fontFamily: '"Trebuchet MS", "Lucida Sans Unicode", "Lucida Grande", Arial, sans-serif' }}>
      <section className="mx-auto max-w-md overflow-hidden rounded-[28px] border border-[#e6dbc4] bg-[#faf6ed] shadow-[0_28px_90px_-42px_rgba(2,102,94,0.55)]">
        {state.status === "loading" ? (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-[#02665e]" aria-hidden />
            <span className="text-sm font-semibold">Verifying tour operator certificate</span>
          </div>
        ) : state.status === "invalid" ? (
          <div className="p-6">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-rose-600" /><p className="text-sm font-black text-rose-800">Certificate could not be verified</p></div>
              <p className="mt-2 text-sm leading-6 text-rose-700">{state.reason}</p>
            </div>
          </div>
        ) : (
          <CertificateView certificate={state.certificate} />
        )}
      </section>
      <div className="mx-auto mt-5 flex max-w-xl items-center justify-center gap-2 text-center text-[11px] text-slate-400">
        <Lock className="h-3 w-3" aria-hidden />
        <span>Verification by NoLS Africa Co Ltd. No login is required to view this certificate.</span>
      </div>
    </main>
  );
}

function CertificateView({ certificate }: { certificate: Certificate }) {
  const { operator, verification } = certificate;
  const id = certificateId(operator.id);
  return (
    <div className="px-5 py-8 text-center sm:px-8 sm:py-10">
      <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#0e7e70] to-[#023f39] text-white shadow-lg ring-8 ring-[#dcece6]">
        <ShieldCheck className="h-10 w-10" aria-hidden />
      </span>
      <div className="mx-auto mt-6 h-px max-w-md bg-gradient-to-r from-transparent via-[#02665e]/35 to-transparent" />
      <p className="mt-6 text-[12px] font-black uppercase tracking-[0.28em] text-[#02665e]">Certificate of Verification</p>
      <h1 className="mt-2 break-words text-3xl font-black leading-tight tracking-tight text-slate-900">{operator.companyName}</h1>
      {operator.location ? <div className="mt-3 flex items-center justify-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.1em] text-slate-500"><MapPin className="h-4 w-4 text-slate-400" /><span>{operator.location}</span></div> : null}

      <div className="mx-auto mt-7 grid max-w-md grid-cols-2 overflow-hidden rounded-3xl border border-[#d6e8e1] bg-[#eef6f2]">
        <InfoTile icon={<BadgeCheck className="h-5 w-5" />} label="Status" value="Verified" accent />
        <InfoTile icon={<CalendarCheck className="h-5 w-5" />} label="Verified on" value={formatDate(verification.verifiedAt)} className="border-l border-[#dcece6]" />
      </div>

      <div className="mx-auto mt-6 max-w-md rounded-2xl border border-[#ece2cd] bg-white/70 px-5 py-4 text-left">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Verification scope</p>
        <p className="mt-1.5 text-sm font-bold text-slate-800">{verification.method}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">{verification.note}</p>
      </div>

      <div className="mx-auto mt-6 flex max-w-md items-center justify-between gap-4 rounded-2xl border border-[#d8e9e4] bg-[#f1f8f5] px-4 py-3.5 text-left">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#02665e]/60">Verified &amp; issued by</p>
          <p className="mt-1 text-sm font-black text-slate-900">{certificate.issuer}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#02665e]/60">Live reference</p>
          <p className="mt-1 font-mono text-sm font-black text-[#02665e]">{id}</p>
        </div>
      </div>

      <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-2 rounded-2xl border border-[#ece2cd] bg-white/70 px-6 py-5">
        <Barcode value={id} />
        <span className="font-mono text-[12px] tracking-[0.4em] text-slate-400">{id.split("").join(" ")}</span>
      </div>
    </div>
  );
}

function InfoTile({ icon, label, value, accent, className = "" }: { icon: React.ReactNode; label: string; value: string; accent?: boolean; className?: string }) {
  return <div className={`flex flex-col items-center px-2 py-5 text-center ${className}`}><span className="grid h-10 w-10 place-items-center rounded-full border border-[#d9eae3] bg-white text-[#02665e]">{icon}</span><p className="mt-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#7c8a86]">{label}</p><p className={`mt-1.5 text-sm font-black leading-snug ${accent ? "text-[#02665e]" : "text-slate-900"}`}>{value}</p></div>;
}

function Barcode({ value }: { value: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (let i = 0; i < 46; i += 1) {
    const code = value.charCodeAt(i % value.length) + i * 7;
    const w = 1 + (code % 4);
    const gap = 1 + ((code >> 2) % 3);
    bars.push({ x, w });
    x += w + gap;
  }
  const height = 52;
  return (
    <svg viewBox={`0 0 ${x} ${height}`} className="h-12 w-full max-w-[240px]" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Barcode ${value}`}>
      {bars.map((bar, index) => (
        <rect key={index} x={bar.x} y={0} width={bar.w} height={height} fill="#0f172a" />
      ))}
    </svg>
  );
}
