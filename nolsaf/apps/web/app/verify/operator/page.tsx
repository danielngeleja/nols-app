"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Copy, Loader2, Lock, MapPin, ShieldAlert, ShieldCheck } from "lucide-react";

type Certificate = {
  issuer: string;
  /** Signed reference, e.g. NLS-TO-7K3Q-9XMD-F. Never a row id. */
  reference: string;
  /** When the server re-checked this certificate: it is live, not a printed claim. */
  checkedAt?: string;
  /** What NoLSAF approved, by kind only. */
  checks?: string[];
  /** The operator's own NoLSAF page, to compare with whoever is selling the tour. */
  profilePath?: string | null;
  operator: { companyName: string; location: string };
  verification: { status: "VERIFIED"; verifiedAt: string; method: string; note: string };
};

type State =
  | { status: "loading" }
  | { status: "valid"; certificate: Certificate }
  | { status: "invalid"; reason: string };

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function formatTime(value: string | undefined) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
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
      <section className="mx-auto max-w-md overflow-hidden rounded-lg border border-solid border-[#e6dbc4] bg-[#faf6ed] shadow-[0_28px_90px_-42px_rgba(2,102,94,0.45)]">
        {state.status === "loading" ? (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-[#02665e]" aria-hidden />
            <span className="text-sm font-semibold">Verifying tour operator certificate</span>
          </div>
        ) : state.status === "invalid" ? (
          <div className="p-6">
            <div className="rounded-md border border-solid border-rose-200 bg-rose-50 px-4 py-3">
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

/** "ARUSHA-TANZANIA" → "Arusha, Tanzania"; "DAR ES SALAAM" → "Dar es Salaam". */
function placeCase(value: string) {
  const small = new Set(["es", "wa", "ya", "na", "la"]);
  return value
    .split(/\s*[-,]\s*/)
    .filter(Boolean)
    .map((part) => part
      .toLocaleLowerCase("en")
      .split(/\s+/)
      .map((word, i) => (i > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(" "))
    .join(", ");
}

function CertificateView({ certificate }: { certificate: Certificate }) {
  const { operator, verification } = certificate;
  const id = certificate.reference;
  const [copied, setCopied] = useState(false);
  const checks = certificate.checks?.length ? certificate.checks : [verification.method];
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Verified since", value: formatDate(verification.verifiedAt) },
    { label: "Issued by", value: certificate.issuer },
    {
      label: "Reference",
      value: (
        <span className="inline-flex items-center gap-2">
          <span className="font-mono tracking-wide text-[#02665e]">{id}</span>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy reference"
            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-solid border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[#02665e]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </span>
      ),
    },
  ];
  return (
    <div>
      {/* Header */}
      <div className="px-6 pb-5 pt-7 text-center sm:px-8">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-[#02665e] text-white">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </span>
        <p className="m-0 mt-4 text-[12px] font-semibold text-[#02665e]">Certificate of verification</p>
        <h1 className="m-0 mt-1 break-words text-[26px] font-bold leading-tight tracking-tight text-slate-900">{operator.companyName}</h1>
        {operator.location ? (
          <p className="m-0 mt-2 flex items-center justify-center gap-1.5 text-[13px] text-slate-500">
            <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden />{placeCase(operator.location)}
          </p>
        ) : null}
      </div>

      {/* Live answer first: this page is a check run now, not a printed claim */}
      <div className="flex items-center gap-3 border-0 border-y border-solid border-[#cfe5dd] bg-[#02665e] px-6 py-3 text-white sm:px-8">
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300" />
        </span>
        <div className="min-w-0 flex-1 text-left leading-tight">
          <p className="m-0 text-[14px] font-semibold">Verified and active on NoLSAF</p>
          <p className="m-0 mt-0.5 text-[11.5px] text-white/75">Live check, {formatTime(certificate.checkedAt)} today</p>
        </div>
        <ShieldCheck className="h-5 w-5 flex-shrink-0 text-white/80" aria-hidden />
      </div>

      <div className="bg-white">
        {/* What NoLSAF checked */}
        <div className="px-6 pb-4 pt-5 text-left sm:px-8">
          <p className="m-0 text-[12px] font-semibold text-slate-500">What NoLSAF checked</p>
          <ul className="m-0 mt-2.5 list-none space-y-2 p-0">
            {checks.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[14px] text-slate-800">
                <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/10">
                  <Check className="h-2.5 w-2.5 text-[#02665e]" strokeWidth={3.2} aria-hidden />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Record */}
        <dl className="m-0 border-0 border-t border-solid border-slate-100 px-6 sm:px-8">
          {rows.map((row, i) => (
            <div
              key={row.label}
              className={`flex items-center justify-between gap-3 py-3 text-left ${i > 0 ? "border-0 border-t border-solid border-slate-100" : ""}`}
            >
              <dt className="text-[12px] text-slate-500">{row.label}</dt>
              <dd className="m-0 min-w-0 break-words text-right text-[13.5px] font-semibold text-slate-900">{row.value}</dd>
            </div>
          ))}
        </dl>

        {/* Before you pay */}
        <div className="border-0 border-t border-solid border-slate-100 px-6 py-4 text-left sm:px-8">
          <div className="flex items-start gap-2.5 rounded-md border border-solid border-amber-200 bg-amber-50 px-3 py-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" aria-hidden />
            <p className="m-0 text-[12.5px] leading-5 text-amber-900">
              Book and pay through NoLSAF to keep your payment protected. If someone shows you this certificate and asks you to pay them directly, check that their offer appears on the operator&apos;s NoLSAF page first.
            </p>
          </div>
          {certificate.profilePath ? (
            <Link
              href={certificate.profilePath}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#02665e] text-[14px] font-semibold text-white no-underline hover:bg-[#014e47]"
            >
              View {operator.companyName} on NoLSAF
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      {/* Barcode */}
      <div className="flex flex-col items-center gap-1.5 border-0 border-t border-dashed border-[#e6dbc4] px-6 py-5">
        <Barcode value={id} />
        <span className="font-mono text-[11px] tracking-[0.3em] text-slate-400">{id}</span>
      </div>
    </div>
  );
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
