"use client";

/**
 * The live answer for a sales partner card. Built to be hard to fake with a
 * screenshot: a short scan runs first, the clock ticks every second and the
 * "Live check" mark pulses, so an owner looking at a real check sees it moving.
 * A card that is not valid carries a diagonal watermark and a grey photo.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, PhoneCall, ScanFace, ShieldCheck, Star, XCircle } from "lucide-react";

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
/** The scan always shows for at least this long, so a check never just "pops". */
const SCAN_MS = 1600;
/** Lifts the card off the dark band it overlaps. */
const CARD_SHADOW = "shadow-[0_18px_40px_-22px_rgba(2,36,32,0.55)]";
const ID_FONT = { fontFamily: '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", Arial, sans-serif' };

const WATERMARK: Record<string, string> = {
  REVOKED: "CANCELLED",
  REPLACED: "REPLACED",
  EXPIRED: "EXPIRED",
  PARTNER_INACTIVE: "NOT ACTIVE",
  NO_CONTRACT: "NOT VALID",
  PHOTO_REVIEW: "IN REVIEW",
  PHOTO_REJECTED: "NOT APPROVED",
};

const SCAN_STEPS = ["Reading the card", "Checking with NoLSAF", "Confirming it is live"];

function eatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

/** "Dar es Salaam, Dar es Salaam" reads as a typo: keep each place once. */
function areaText(territory: string | null, region: string | null) {
  const seen = new Set<string>();
  const parts = [territory, region].filter((part): part is string => Boolean(part && part.trim())).filter((part) => {
    const key = part.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return parts.join(", ") || "Tanzania";
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="font-mono tabular-nums text-slate-900">
      {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT
    </span>
  );
}

function Scanning() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((value) => Math.min(value + 1, SCAN_STEPS.length - 1)), SCAN_MS / SCAN_STEPS.length);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className={`overflow-hidden rounded-lg border border-solid border-slate-200 bg-white ${CARD_SHADOW}`} role="status" aria-live="polite" style={ID_FONT}>
      <div className="flex items-center justify-between gap-3 bg-[#0b2420] px-5 py-3.5 text-white">
        <p className="m-0 flex items-center gap-2 text-[15px] font-bold"><ScanFace className="h-5 w-5 text-emerald-300" aria-hidden /> Verifying card</p>
        <span className="text-[12px] text-white/60">Secure check</span>
      </div>
      <div className="flex flex-col items-center gap-5 p-6 sm:flex-row sm:items-start">
        <div className="sales-scan-frame relative h-48 w-40 shrink-0 overflow-hidden rounded-lg bg-slate-100">
          <span className="absolute inset-3 rounded-md border-2 border-dashed border-slate-300" aria-hidden />
          <span className="sales-scan-line absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-emerald-400/40 to-transparent" aria-hidden />
          <ScanFace className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 text-slate-300" aria-hidden />
        </div>
        <div className="w-full min-w-0 flex-1 space-y-3 pt-1">
          <div className="sales-scan-bar h-5 w-3/4 rounded bg-slate-100" />
          <div className="sales-scan-bar h-3.5 w-1/2 rounded bg-slate-100" />
          <ol className="m-0 mt-4 list-none space-y-2 p-0">
            {SCAN_STEPS.map((label, index) => (
              <li key={label} className={`flex items-center gap-2 text-[13px] ${index <= step ? "text-slate-800" : "text-slate-400"}`}>
                {index < step ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                ) : index === step ? (
                  <span className="sales-scan-dot inline-block h-4 w-4 rounded-full border-2 border-solid border-emerald-500 border-t-transparent" aria-hidden />
                ) : (
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-solid border-slate-200" aria-hidden />
                )}
                {label}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

export default function SalesCardResult({ endpoint }: { endpoint: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [scanDone, setScanDone] = useState(false);

  useEffect(() => {
    let mounted = true;
    setScanDone(false);
    const timer = setTimeout(() => mounted && setScanDone(true), SCAN_MS);
    fetch(endpoint, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as Result | null;
        if (mounted) setResult(data ?? { ok: false, error: "The check could not be completed." });
      })
      .catch(() => mounted && setResult({ ok: false, error: "The check could not be completed. Check your connection." }));
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [endpoint]);

  const styles = (
    <style>{`
      @keyframes salesCardPulse{0%,100%{opacity:1}50%{opacity:.35}}
      @keyframes salesScanLine{0%{top:-2.5rem}100%{top:100%}}
      @keyframes salesScanShimmer{0%,100%{opacity:1}50%{opacity:.45}}
      @keyframes salesScanSpin{to{transform:rotate(360deg)}}
      @keyframes salesReveal{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .sales-card-live{animation:salesCardPulse 1.4s ease-in-out infinite}
      .sales-scan-line{animation:salesScanLine 1.1s ease-in-out infinite}
      .sales-scan-bar{animation:salesScanShimmer 1.1s ease-in-out infinite}
      .sales-scan-dot{animation:salesScanSpin .8s linear infinite}
      .sales-reveal{animation:salesReveal .35s ease-out both}
      @media (prefers-reduced-motion: reduce){.sales-card-live,.sales-scan-line,.sales-scan-bar,.sales-scan-dot,.sales-reveal{animation:none}}
    `}</style>
  );

  if (!result || !scanDone) {
    return <>{styles}<Scanning /></>;
  }

  const card = result.card;
  if (!result.ok || !card) {
    return (
      <div className={`sales-reveal overflow-hidden rounded-lg border border-solid border-rose-200 bg-white ${CARD_SHADOW}`} style={ID_FONT}>
        {styles}
        <div className="flex items-center gap-2 bg-rose-600 px-5 py-3.5 text-white">
          <XCircle className="h-5 w-5" aria-hidden />
          <p className="m-0 text-[16px] font-bold">Not verified</p>
        </div>
        <div className="space-y-2 p-5 text-[14px] text-slate-700">
          <p className="m-0">{result.error || "This card could not be found."}</p>
          <p className="m-0">If someone gave you this card, please tell NoLSAF on <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, "")}`} className="font-semibold text-[#02665e] no-underline">{SUPPORT_PHONE}</a>.</p>
        </div>
      </div>
    );
  }

  const watermark = card.valid ? null : WATERMARK[card.validity] || "NOT VALID";

  return (
    <div className={`sales-reveal overflow-hidden rounded-lg border border-solid bg-white ${CARD_SHADOW} ${card.valid ? "border-emerald-200" : "border-rose-200"}`} style={ID_FONT}>
      {styles}
      <div className={`flex items-center justify-between gap-3 px-5 py-3.5 text-white ${card.valid ? "bg-emerald-600" : "bg-rose-600"}`}>
        <p className="m-0 flex min-w-0 items-center gap-2 text-[16px] font-bold sm:text-[17px]">
          {card.valid ? <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden /> : <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />}
          <span className="truncate">{card.valid ? "Verified NoLSAF representative" : "Not valid"}</span>
        </p>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold">
          <span className="sales-card-live inline-block h-2 w-2 rounded-full bg-white" aria-hidden /> Live check
        </span>
      </div>

      {/* The ID itself */}
      <div className="relative overflow-hidden">
        {watermark ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 -rotate-[18deg] select-none whitespace-nowrap rounded-md border-4 border-solid border-rose-600/25 px-5 py-1 text-[44px] font-black tracking-[0.18em] text-rose-600/20 sm:text-[60px]"
          >
            {watermark}
          </span>
        ) : null}
        <div className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-start sm:p-6">
          <div className={`shrink-0 rounded-lg border border-solid p-1 ${card.valid ? "border-emerald-200" : "border-slate-200"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.photoUrl}
              alt={`Photo of ${card.name}`}
              className={`block h-48 w-40 rounded-md object-cover ${card.valid ? "" : "grayscale"}`}
            />
          </div>
          <div className="w-full min-w-0 flex-1 text-center sm:text-left">
            <h1 className="m-0 text-[24px] font-bold leading-tight text-slate-900">{card.name}</h1>
            <p className="m-0 mt-1 flex flex-wrap items-center justify-center gap-2 text-[14px] font-semibold sm:justify-start">
              {card.valid ? <span className="text-[#02665e]">Authorised sales representative</span> : <span className="text-rose-700">Not authorised to act for NoLSAF</span>}
              {card.teamLead ? (
                <span className="inline-flex items-center gap-1 rounded bg-[#f5c451] px-2 py-0.5 text-[12px] font-bold text-[#4a3205]">
                  <Star className="h-3 w-3" aria-hidden /> Team lead
                </span>
              ) : null}
            </p>
            <p className={`m-0 mt-3 rounded-md px-3 py-2 text-[13px] leading-relaxed ${card.valid ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 font-semibold text-rose-800"}`}>{card.message}</p>
            <dl className="m-0 mt-4 grid grid-cols-2 overflow-hidden rounded-md border border-solid border-slate-200 text-left text-[13px]">
              {[
                { k: "ID number", v: card.agentCode, mono: true },
                { k: "Card", v: card.cardNumber, mono: true },
                { k: "Area", v: areaText(card.territory, card.region) },
                { k: "Valid until", v: eatDate(card.expiresAt) },
              ].map((cell, index) => (
                <div
                  key={cell.k}
                  className={`min-w-0 border-0 border-solid border-slate-200 px-3 py-2.5 ${index % 2 === 1 ? "border-l" : ""} ${index >= 2 ? "border-t" : ""}`}
                >
                  <dt className="text-[11px] text-slate-500">{cell.k}</dt>
                  <dd className={`m-0 mt-0.5 break-words font-semibold text-slate-900 ${cell.mono ? "font-mono text-[12.5px]" : ""}`}>{cell.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      <ul className="m-0 list-none border-0 border-t border-solid border-slate-200 bg-slate-50 p-0 text-[13px] text-slate-600">
        <li className="flex items-center gap-2.5 px-5 py-2.5">
          <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden /> Checked now <span className="ml-auto"><LiveClock /></span>
        </li>
        <li className="flex items-start gap-2.5 border-0 border-t border-solid border-slate-200 px-5 py-2.5">
          <ScanFace className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <span>Make sure the face in this photo is the person in front of you.</span>
        </li>
      </ul>
    </div>
  );
}

/**
 * The page around a check: a white brand bar, a dark band the result sits on,
 * and a short trust strip below. Owners land here from a QR scan, so the frame
 * has to say "this is NoLSAF" before the card even loads.
 */
export function VerifyShell({ children, footer, title = "Is this person really from NoLSAF?" }: { children: React.ReactNode; footer?: React.ReactNode; title?: string }) {
  return (
    <main id="sales-verify" className="flex min-h-screen flex-col bg-slate-100" style={ID_FONT}>
      <style>{`#sales-verify, #sales-verify * { box-sizing: border-box; }`}</style>

      <header className="border-0 border-b border-solid border-slate-200 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/NoLS2025-04.png" alt="" className="h-7 w-7 shrink-0 object-contain" />
            <span className="text-[15px] font-bold text-slate-900">NoLSAF</span>
            <span className="hidden h-4 w-px bg-slate-200 sm:block" aria-hidden />
            <span className="hidden truncate text-[13px] text-slate-500 sm:block">Representative verification</span>
          </Link>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Official check
          </span>
        </div>
      </header>

      <div className="bg-[#0b2420]">
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 text-white">
          <p className="m-0 text-[18px] font-bold sm:text-[20px]">{title}</p>
          <p className="m-0 mt-1 text-[13px] text-white/65">NoLSAF answers live from its own records. A screenshot cannot show a moving clock.</p>
        </div>
      </div>

      <div className="mx-auto -mt-20 w-full max-w-2xl flex-1 px-4 pb-8">
        {children}
        {footer ? <div className="mt-4 text-center text-[13px] text-slate-600">{footer}</div> : null}

        <ul className="m-0 mt-6 grid list-none gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-200 p-0 text-[12px] text-slate-600 sm:grid-cols-3">
          {[
            { Icon: ShieldCheck, title: "Checked live", text: "Every scan asks NoLSAF directly." },
            { Icon: AlertTriangle, title: "Never pay them", text: "Payments only go through NoLSAF." },
            { Icon: PhoneCall, title: "Report a fake", text: SUPPORT_PHONE, href: `tel:${SUPPORT_PHONE.replace(/\s/g, "")}` },
          ].map(({ Icon, title: itemTitle, text, href }) => (
            <li key={itemTitle} className="flex items-start gap-2.5 bg-white px-4 py-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">{itemTitle}</span>
                {href ? <a href={href} className="font-semibold text-[#02665e] no-underline">{text}</a> : <span className="block">{text}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-4 text-center text-[11px] text-slate-400">© {new Date().getFullYear()} NoLSAF. This page is never cached and is not indexed.</p>
      </div>
    </main>
  );
}
