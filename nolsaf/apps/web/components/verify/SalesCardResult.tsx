"use client";

/**
 * The live answer for a sales partner card. Built to be hard to fake with a
 * screenshot: the clock ticks every second and the "Live check" mark pulses,
 * so an owner looking at a real check sees it moving.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, PhoneCall, ShieldCheck, Star, XCircle } from "lucide-react";

type Result = {
  ok: boolean;
  error?: string;
  card?: {
    valid: boolean;
    validity: string;
    message: string;
    name: string;
    photoUrl: string;
    agentCode: string;
    cardNumber: string;
    region: string | null;
    territory: string | null;
    teamLead?: boolean;
    issuedAt: string;
    expiresAt: string;
    checkedAt: string;
  };
};

const SUPPORT_PHONE = "+255 736 766 726";

function eatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="font-mono tabular-nums">
      {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT
    </span>
  );
}

export default function SalesCardResult({ endpoint }: { endpoint: string }) {
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as Result | null;
        if (mounted) setResult(data ?? { ok: false, error: "The check could not be completed." });
      })
      .catch(() => mounted && setResult({ ok: false, error: "The check could not be completed. Check your connection." }));
    return () => {
      mounted = false;
    };
  }, [endpoint]);

  if (!result) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-[#02665e]" /> Checking with NoLSAF
      </div>
    );
  }

  const card = result.card;
  if (!result.ok || !card) {
    return (
      <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 p-5">
        <p className="m-0 flex items-center gap-2 text-lg font-bold text-rose-800"><XCircle className="h-6 w-6" /> Not verified</p>
        <p className="m-0 mt-2 text-sm text-rose-900">{result.error || "This card could not be found."}</p>
        <p className="m-0 mt-3 text-sm text-rose-900">If someone gave you this card, please tell NoLSAF on <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, "")}`} className="font-semibold text-rose-900">{SUPPORT_PHONE}</a>.</p>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-xl border border-solid ${card.valid ? "border-emerald-300" : "border-rose-300"} bg-white`}>
      <style>{`@keyframes salesCardPulse{0%,100%{opacity:1}50%{opacity:.35}}.sales-card-live{animation:salesCardPulse 1.4s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.sales-card-live{animation:none}}`}</style>
      <div className={`flex items-center justify-between gap-3 px-5 py-4 ${card.valid ? "bg-emerald-600" : "bg-rose-600"} text-white`}>
        <p className="m-0 flex items-center gap-2 text-lg font-bold">
          {card.valid ? <ShieldCheck className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
          {card.valid ? "Verified NoLSAF representative" : "Not valid"}
        </p>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold">
          <span className="sales-card-live inline-block h-2 w-2 rounded-full bg-white" aria-hidden /> Live check
        </span>
      </div>

      <div className="flex flex-col gap-5 p-5 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.photoUrl} alt={`Photo of ${card.name}`} className="h-48 w-40 shrink-0 self-center rounded-2xl object-cover ring-2 ring-white sm:self-start" />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-bold text-slate-900">{card.name}</h1>
          <p className="m-0 mt-0.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-[#02665e]">
            Authorised sales representative
            {card.teamLead ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#f5c451] px-2 py-0.5 text-[12px] font-bold text-[#4a3205]">
                <Star className="h-3 w-3" aria-hidden /> Team lead
              </span>
            ) : null}
          </p>
          <p className={`m-0 mt-3 text-sm ${card.valid ? "text-slate-700" : "font-semibold text-rose-700"}`}>{card.message}</p>
          <dl className="m-0 mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-[12px] text-slate-500">ID number</dt><dd className="m-0 font-mono text-slate-900">{card.agentCode}</dd></div>
            <div><dt className="text-[12px] text-slate-500">Card</dt><dd className="m-0 font-mono text-slate-900">{card.cardNumber}</dd></div>
            <div><dt className="text-[12px] text-slate-500">Area</dt><dd className="m-0 text-slate-900">{[card.territory, card.region].filter(Boolean).join(", ") || "Tanzania"}</dd></div>
            <div><dt className="text-[12px] text-slate-500">Valid until</dt><dd className="m-0 text-slate-900">{eatDate(card.expiresAt)}</dd></div>
          </dl>
        </div>
      </div>

      <div className="space-y-2 border-0 border-t border-solid border-slate-100 bg-slate-50 px-5 py-4 text-[13px] text-slate-600">
        <p className="m-0">Checked now: <LiveClock /></p>
        <p className="m-0">Make sure the face in this photo is the person in front of you. A NoLSAF representative never asks you for cash or payment.</p>
        <p className="m-0 flex items-center gap-1.5">
          <PhoneCall className="h-3.5 w-3.5" /> Unsure? Call NoLSAF on <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, "")}`} className="font-semibold text-[#02665e] no-underline">{SUPPORT_PHONE}</a>
        </p>
      </div>
    </div>
  );
}

export function VerifyShell({ children }: { children: React.ReactNode }) {
  return (
    <main id="sales-verify" className="min-h-screen bg-slate-50 px-4 py-8">
      <style>{`#sales-verify, #sales-verify * { box-sizing: border-box; }`}</style>
      <div className="mx-auto w-full max-w-xl">
        <Link href="/" className="mb-5 inline-flex items-center gap-2 no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/NoLS2025-04.png" alt="" className="h-8 w-8 rounded-lg object-contain" />
          <span className="text-base font-extrabold text-slate-900">NoLSAF</span>
          <span className="text-sm text-slate-500">Representative verification</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
