"use client";

// Public report verification page (no login required).
//
// A printed report carries a QR that opens this page with a signed token. We
// submit the token to the public verify endpoint, which checks the signature
// server side and returns the sealed snapshot. This lets an outside party such
// as a tax authority confirm a document is a genuine NoLSAF report and that the
// printed figures match what NoLSAF recorded, without any account or login.

import { useEffect, useState } from "react";
import Image from "next/image";
import { BadgeCheck, ShieldAlert, Loader2, Lock } from "lucide-react";

const BRAND = "#02665e";

type Figure = { label: string; value: string };
type VerifiedReport = {
  issuer: string;
  kind: string;
  title: string;
  ref: string;
  from: string;
  to: string;
  generatedAt: string;
  generatedBy: string;
  role: string;
  figures: Figure[];
};

type State =
  | { status: "loading" }
  | { status: "valid"; report: VerifiedReport }
  | { status: "invalid"; reason: string };

function roleLabel(role: string): string {
  switch (String(role || "").toUpperCase()) {
    case "ADMIN":
      return "NoLSAF Administration";
    case "OWNER":
      return "Property Owner";
    case "AGENT":
      return "Tour Operator";
    case "DRIVER":
      return "Driver";
    default:
      return "NoLSAF User";
  }
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VerifyReportPage() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = (params.get("t") || params.get("token") || "").trim();
    if (!token) {
      setState({ status: "invalid", reason: "No verification token was provided in the link." });
      return;
    }

    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/public/reports/verify?token=${encodeURIComponent(token)}`, {
          credentials: "same-origin",
        });
        const j = await r.json();
        if (!alive) return;
        if (j?.ok && j?.valid && j?.report) {
          setState({ status: "valid", report: j.report as VerifiedReport });
        } else {
          setState({
            status: "invalid",
            reason: "This report could not be verified. The link may be altered, incomplete, or not issued by NoLSAF.",
          });
        }
      } catch {
        if (!alive) return;
        setState({ status: "invalid", reason: "We could not reach the verification service. Please try again." });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#f5f8f7]">
      {/* Brand hero with dot grid + slash motif */}
      <div
        className="relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${BRAND} 0%, #035a52 45%, #013d38 100%)` }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{ backgroundImage: "radial-gradient(#ffffff 1.1px, transparent 1.1px)", backgroundSize: "18px 18px" }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "repeating-linear-gradient(135deg, #ffffff 0, #ffffff 2px, transparent 2px, transparent 16px)",
          }}
          aria-hidden
        />
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-40 w-40 rounded-full bg-emerald-300/10 blur-3xl" aria-hidden />

        <div className="relative mx-auto max-w-xl px-5 pb-28 pt-10 sm:pt-12">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
              <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={30} height={30} className="h-7 w-7 object-contain" />
            </span>
            <div>
              <div className="text-sm font-black tracking-tight text-white">NoLS Africa Co Ltd</div>
              <div className="text-xs font-medium text-white/70">Official report verification</div>
            </div>
          </div>
        </div>
      </div>

      {/* Card overlapping the hero */}
      <div className="mx-auto -mt-20 max-w-xl px-5 pb-12">
        <div className="overflow-hidden rounded-[26px] border border-white/70 bg-white shadow-[0_28px_80px_-34px_rgba(2,102,94,0.55)] ring-1 ring-slate-900/[0.03]">
          {state.status === "loading" ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin text-[#02665e]" aria-hidden />
              <span className="text-sm font-semibold">Verifying this report</span>
            </div>
          ) : state.status === "invalid" ? (
            <InvalidView reason={state.reason} />
          ) : (
            <ValidView report={state.report} />
          )}
        </div>

        <div className="mt-5 flex items-center justify-center gap-2 text-center text-[11px] text-slate-400">
          <Lock className="h-3 w-3" aria-hidden />
          <span>Verification by NoLS Africa Co Ltd. No login is required to view this page.</span>
        </div>
      </div>
    </div>
  );
}

function InvalidView({ reason }: { reason: string }) {
  return (
    <div>
      <div className="relative overflow-hidden bg-gradient-to-br from-rose-600 to-rose-700 px-6 py-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{ backgroundImage: "radial-gradient(#ffffff 1.1px, transparent 1.1px)", backgroundSize: "18px 18px" }}
          aria-hidden
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-white ring-1 ring-white/30">
            <ShieldAlert className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <div className="text-lg font-black text-white">Not verified</div>
            <div className="text-xs text-white/80">This document could not be confirmed as genuine.</div>
          </div>
        </div>
      </div>
      <div className="px-6 py-6 text-sm leading-6 text-slate-600">{reason}</div>
    </div>
  );
}

function ValidView({ report }: { report: VerifiedReport }) {
  return (
    <div>
      {/* Status banner */}
      <div
        className="relative overflow-hidden px-6 py-6"
        style={{ background: `linear-gradient(135deg, ${BRAND}, #024f49)` }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{ backgroundImage: "radial-gradient(#ffffff 1.1px, transparent 1.1px)", backgroundSize: "16px 16px" }}
          aria-hidden
        />
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative flex items-center gap-3.5">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-white ring-1 ring-white/30">
            <BadgeCheck className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <div className="text-lg font-black tracking-tight text-white">Genuine report</div>
            <div className="text-xs text-white/80">Generated on the {report.issuer} platform.</div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="text-xl font-black tracking-tight text-slate-900">{report.title}</div>

        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Row label="Reference" value={report.ref} mono />
          <Row label="Date range" value={`${report.from} to ${report.to}`} />
          <Row label="Generated" value={fmtDateTime(report.generatedAt)} />
          <Row label="Generated by" value={`${report.generatedBy} · ${roleLabel(report.role)}`} />
        </dl>

        {report.figures.length ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: BRAND }} aria-hidden />
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Sealed figures</span>
            </div>
            <div>
              {report.figures.map((f, i) => {
                const isTotal = /\btotal\b/i.test(f.label);
                return (
                  <div
                    key={i}
                    className={
                      "flex items-center justify-between gap-3 px-4 py-2.5 text-sm " +
                      (i % 2 ? "bg-slate-50/40 " : "") +
                      (isTotal ? "border-t border-slate-200" : "")
                    }
                  >
                    <span className={isTotal ? "font-bold text-slate-900" : "text-slate-600"}>{f.label}</span>
                    <span
                      className={"tabular-nums " + (isTotal ? "font-black" : "font-bold text-slate-900")}
                      style={isTotal ? { color: BRAND } : undefined}
                    >
                      {f.value}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Dotted brand divider */}
        <div
          className="my-6 h-px w-full"
          style={{ backgroundImage: `radial-gradient(${BRAND} 1px, transparent 1px)`, backgroundSize: "8px 1px", opacity: 0.35 }}
          aria-hidden
        />

        <p className="text-xs leading-5 text-slate-500">
          Compare these sealed figures with the printed copy. Any difference means the print was altered. Personal details
          are omitted, and this page grants no account access.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className={"mt-1 text-sm font-semibold text-slate-900 break-words " + (mono ? "font-mono text-[13px]" : "")}>
        {value || "n/a"}
      </dd>
    </div>
  );
}
