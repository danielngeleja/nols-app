"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Lock, MapPin, ShieldCheck } from "lucide-react";

type Certificate = {
  issuer: string;
  property: {
    id: number;
    title: string;
    type: string;
    location: string;
  };
  verification: {
    status: "VERIFIED";
    verifiedAt: string | null;
    verifiedBy: string;
    verifiedByRole: string;
    method: string;
    note: string;
    checklist: string[];
    lastRefreshedAt: string | null;
  };
};

type State =
  | { status: "loading" }
  | { status: "valid"; certificate: Certificate }
  | { status: "invalid"; reason: string };

const BRAND = "#02665e";
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function verificationEndpoint(token: string) {
  const path = `/api/public/properties/verification?token=${encodeURIComponent(token)}`;
  return API_BASE ? `${API_BASE}${path}` : path;
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function PropertyVerificationPage() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = (params.get("t") || params.get("token") || "").trim();
    if (!token) {
      setState({ status: "invalid", reason: "No property verification token was provided." });
      return;
    }

    let alive = true;
    fetch(verificationEndpoint(token), { credentials: "omit" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (data?.ok && data?.valid && data?.certificate) {
          setState({ status: "valid", certificate: data.certificate as Certificate });
        } else {
          setState({
            status: "invalid",
            reason: "This property certificate could not be verified. The link may be altered, expired, or the property is no longer publicly approved.",
          });
        }
      })
      .catch(() => {
        if (!alive) return;
        setState({ status: "invalid", reason: "We could not reach the verification service. Please try again." });
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#efe7d7] px-4 py-6 text-slate-950 sm:py-10" style={{ fontFamily: '"Trebuchet MS", "Lucida Sans Unicode", "Lucida Grande", Arial, sans-serif' }}>
      <section className="mx-auto max-w-md overflow-hidden rounded-[28px] border border-[#e6dbc4] bg-[#faf6ed] shadow-[0_28px_90px_-42px_rgba(2,102,94,0.55)]">
        {state.status === "loading" ? (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-[#02665e]" aria-hidden />
            <span className="text-sm font-semibold">Verifying property certificate</span>
          </div>
        ) : state.status === "invalid" ? (
          <InvalidView reason={state.reason} />
        ) : (
          <ValidView certificate={state.certificate} />
        )}
      </section>
      <div className="mx-auto mt-5 flex max-w-xl items-center justify-center gap-2 text-center text-[11px] text-slate-400">
        <Lock className="h-3 w-3" aria-hidden />
        <span>Verification by NoLS Africa Co Ltd. No login is required to view this page.</span>
      </div>
    </main>
  );
}

function InvalidView({ reason }: { reason: string }) {
  return (
    <div className="p-6">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-rose-600" />
          <p className="text-sm font-black text-rose-800">Property could not be verified</p>
        </div>
        <p className="mt-2 text-sm leading-6 text-rose-700">{reason}</p>
      </div>
    </div>
  );
}

function ValidView({ certificate }: { certificate: Certificate }) {
  const { property, verification } = certificate;
  const certId = `NLS-P-${property.id}`;
  return (
    <div className="px-6 py-8 text-center sm:px-8 sm:py-10">
      <div
        className="mx-auto grid h-[76px] w-[76px] place-items-center rounded-full text-white shadow-[0_20px_44px_-22px_rgba(2,102,94,0.95)]"
        style={{ background: `linear-gradient(155deg, #0b7568, ${BRAND} 55%, #023f39)` }}
      >
        <ShieldCheck className="h-8 w-8" />
      </div>

      <p className="mt-5 text-[12px] font-black uppercase tracking-[0.28em] text-[#02665e]">Certificate of Verification</p>
      <h2 className="mt-2 break-words text-4xl font-black leading-tight tracking-tight text-slate-900">{property.title}</h2>

      <div className="mt-3 flex items-center justify-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.1em] text-slate-500">
        <MapPin className="h-4 w-4 flex-shrink-0 text-slate-400" />
        <span>{property.location || "Location not listed"}</span>
      </div>

      <dl className="mx-auto mt-7 max-w-md rounded-3xl bg-white px-6 shadow-[0_26px_60px_-40px_rgba(15,23,42,0.45)]">
        <Row label="Status" value="Verified" accent />
        <Row label="Checked on" value={formatDate(verification.verifiedAt)} />
        <Row label="Checked by" value={verification.verifiedBy || "NoLSAF Admin"} last />
      </dl>

      <div className="mx-auto mt-6 flex max-w-md items-end justify-between gap-4 text-left">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Issued by</p>
          <p className="mt-1 text-base font-black text-slate-900">{certificate.issuer}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Certificate ID</p>
          <p className="mt-1 font-mono text-base font-black text-slate-900">{certId}</p>
        </div>
      </div>

      <div className="mx-auto mt-6 max-w-md border-t border-dashed border-[#d3c8ae]" />

      <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-2 rounded-2xl bg-white px-6 py-5 shadow-[0_26px_60px_-40px_rgba(15,23,42,0.45)]">
        <Barcode value={certId} />
        <span className="font-mono text-[12px] tracking-[0.4em] text-slate-400">{certId.split("").join(" ")}</span>
      </div>
    </div>
  );
}

function Row({ label, value, accent, last }: { label: string; value: string; accent?: boolean; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-4 text-left ${last ? "" : "border-b border-slate-100"}`}>
      <dt className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</dt>
      <dd className={`text-lg font-black ${accent ? "text-[#02665e]" : "text-slate-900"}`}>{value || "Not available"}</dd>
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
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#0f172a" />
      ))}
    </svg>
  );
}
