"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import PublicFooter from "@/components/PublicFooter";
import PublicHeader from "@/components/PublicHeader";
import {
  AtSign,
  Check,
  ChevronDown,
  Database,
  Fingerprint,
  Globe,
  Link2,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Radio,
  RotateCcw,
  ScanLine,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

type VerificationRecord = {
  key: string;
  category: string;
  displayName: string;
  authorityName: string | null;
  authorityDomain: string | null;
  jurisdiction: string | null;
  registrationNumber: string | null;
  publicSummary: string | null;
  status: string;
  externalVerificationUrl: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  lastCheckedAt: string | null;
};

type Channel = {
  channelType: string;
  label: string;
  value: string;
  href: string | null;
  notes: string | null;
  confirmedAt?: string | null;
};

type Payload = {
  records: VerificationRecord[];
  channelTypes: string[];
  primaryWebsite: Channel | null;
  verifyUrl: string;
  generatedAt: string;
  disclaimer: string;
};

/**
 * Tailwind preflight is disabled in this app, so the global box model is
 * content-box and padding adds to an element's width. The ready state opts back
 * into border-box inside its own style block; the loading and unavailable
 * states need the same rule or their padded containers overflow the viewport.
 */
const BOX_SIZING_RESET = `#verify-page, #verify-page * { box-sizing: border-box; }`;

type VerificationType = "identity" | "records" | "channels";
type ScanPhase = "idle" | "ready" | "scanning" | "verified";

const TYPE_DETAILS: Record<
  VerificationType,
  { label: string; shortLabel: string; code: string; icon: typeof Fingerprint }
> = {
  identity: { label: "NoLSAF company identity", shortLabel: "Company identity", code: "ID", icon: Fingerprint },
  records: { label: "Registration & authority records", shortLabel: "Authority records", code: "RC", icon: Database },
  channels: { label: "Official contact or channel", shortLabel: "Official channels", code: "CH", icon: Radio },
};

const CHANNEL_ICONS: Record<string, typeof Globe> = {
  WEBSITE: Globe,
  DOMAIN: Globe,
  EMAIL: Mail,
  PHONE: Phone,
  WHATSAPP: MessageCircle,
  SOCIAL: AtSign,
  APP: Smartphone,
  ADDRESS: MapPin,
};

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  EMAIL: "Email address",
  PHONE: "Phone number",
  WEBSITE: "Website or domain",
  SOCIAL: "Social media account",
  ADDRESS: "Office address",
};

const SOCIAL_HOSTS = /(instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com|youtube\.com|threads\.net)/i;

/**
 * Guess what kind of channel someone pasted, so they do not have to pick a type first.
 * Returns null when it is not clear; the visitor can always choose a type by hand.
 */
function detectChannelType(raw: string, available: string[]): string | null {
  const value = raw.trim();
  if (!value) return null;
  const pick = (type: string) => (available.includes(type) ? type : null);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return pick("EMAIL");
  if (/^@[\w.]{2,}$/.test(value) || SOCIAL_HOSTS.test(value)) return pick("SOCIAL");
  if (/^\+?[\d\s\-().]{7,}$/.test(value) && (value.match(/\d/g)?.length ?? 0) >= 7) return pick("PHONE");
  if (/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(value)) return pick("WEBSITE");
  return null;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isRecordActive(record: VerificationRecord): boolean {
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return false;
  return ["ACTIVE", "VERIFIED"].includes(String(record.status || "").toUpperCase());
}

export default function CorporateVerificationView() {
  const [state, setState] = useState<{ status: "loading" | "ready" | "unavailable"; data?: Payload }>({
    status: "loading",
  });
  const [selectedType, setSelectedType] = useState<VerificationType | "">("");
  const [verifiedType, setVerifiedType] = useState<VerificationType | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [scanStep, setScanStep] = useState(0);
  const [channelLookupType, setChannelLookupType] = useState("");
  const [channelQuery, setChannelQuery] = useState("");
  /** True once the visitor picks a type by hand; stops auto-detection from overriding them. */
  const [channelTypeLocked, setChannelTypeLocked] = useState(false);
  const [channelMatch, setChannelMatch] = useState<Channel | null>(null);
  const [channelOutcome, setChannelOutcome] = useState<"matched" | "not_found" | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/public/verify", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("unavailable");
        const payload = await response.json();
        // A failed read reaches us as an empty list with `degraded` set. On an
        // anti-impersonation page an empty list would read as "NoLSAF claims
        // nothing", so show the unavailable state instead of a false negative.
        if (payload?.data?.degraded) throw new Error("unavailable");
        if (alive) setState({ status: "ready", data: payload?.data });
      } catch {
        if (alive) setState({ status: "unavailable" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const data = state.data;
  const identity = useMemo(() => {
    if (!data) return null;
    const identityRecord = data.records.find((record) => record.category === "IDENTITY");
    const registrationRecord =
      data.records.find((record) => record.category === "REGISTRATION" && record.registrationNumber) ||
      data.records.find((record) => record.registrationNumber);
    const reviewDates = data.records
      .map((record) => record.lastCheckedAt || record.issuedAt)
      .filter(Boolean)
      .map((value) => new Date(String(value)).getTime())
      .filter(Number.isFinite);

    return {
      legalEntity: identityRecord?.displayName || registrationRecord?.displayName || null,
      jurisdiction: registrationRecord?.jurisdiction || identityRecord?.jurisdiction || null,
      registrationNumber: registrationRecord?.registrationNumber || null,
      website: data.primaryWebsite || null,
      lastReviewed: reviewDates.length ? new Date(Math.max(...reviewDates)).toISOString() : null,
    };
  }, [data]);

  function clearTimers() {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }

  function selectVerification(value: VerificationType | "") {
    clearTimers();
    requestIdRef.current += 1;
    setSelectedType(value);
    setVerifiedType(null);
    setScanStep(0);
    setChannelLookupType(value === "channels" ? data?.channelTypes?.[0] || "EMAIL" : "");
    setChannelTypeLocked(false);
    setChannelQuery("");
    setChannelMatch(null);
    setChannelOutcome(null);
    setChannelError(null);
    setScanPhase(value ? "ready" : "idle");
  }

  async function startScan() {
    if (!selectedType || scanPhase === "scanning") return;
    if (selectedType === "channels" && (!channelLookupType || !channelQuery.trim())) {
      setChannelError("Choose a channel type and enter the exact detail you received.");
      return;
    }

    clearTimers();
    const requestId = ++requestIdRef.current;
    setVerifiedType(null);
    setScanStep(0);
    setChannelMatch(null);
    setChannelOutcome(null);
    setChannelError(null);
    setScanPhase("scanning");

    timersRef.current = [
      window.setTimeout(() => setScanStep(1), 420),
      window.setTimeout(() => setScanStep(2), 980),
      window.setTimeout(() => setScanStep(3), 1480),
    ];

    if (selectedType !== "channels") {
      timersRef.current.push(window.setTimeout(() => {
        setVerifiedType(selectedType);
        setScanPhase("verified");
      }, 1900));
      return;
    }

    const startedAt = Date.now();
    try {
      const response = await fetch("/api/public/verify/channel", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ channelType: channelLookupType, value: channelQuery.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Channel verification failed.");

      const remaining = Math.max(0, 1900 - (Date.now() - startedAt));
      await new Promise((resolve) => window.setTimeout(resolve, remaining));
      if (requestIdRef.current !== requestId) return;

      const matched = Boolean(payload?.data?.matched && payload?.data?.channel);
      setChannelMatch(matched ? payload.data.channel : null);
      setChannelOutcome(matched ? "matched" : "not_found");
      setVerifiedType("channels");
      setScanPhase("verified");
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setChannelError(error instanceof Error ? error.message : "Channel verification failed.");
      setScanPhase("ready");
    }
  }

  function resetScanner() {
    clearTimers();
    requestIdRef.current += 1;
    setSelectedType("");
    setVerifiedType(null);
    setScanStep(0);
    setChannelLookupType("");
    setChannelQuery("");
    setChannelMatch(null);
    setChannelOutcome(null);
    setChannelError(null);
    setScanPhase("idle");
    window.setTimeout(() => document.getElementById("checkpoint-type")?.focus(), 0);
  }

  if (state.status === "loading") {
    return (
      <div id="verify-page" className="flex min-h-screen items-center justify-center bg-[#041f1c]">
        <style>{BOX_SIZING_RESET}</style>
        <div className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-300" />
          <p className="m-0 mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-100/50">
            Opening checkpoint
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "unavailable" || !data) {
    return (
      <div id="verify-page" className="min-h-screen bg-[#041f1c] text-white">
        <style>{BOX_SIZING_RESET}</style>
        <PublicHeader />
        <main className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-28 text-center">
          <ShieldAlert className="h-10 w-10 text-amber-300" />
          <h1 className="m-0 mt-5 text-xl font-bold">Checkpoint unavailable</h1>
          <p className="m-0 mt-2 text-sm leading-6 text-emerald-50/55">
            Do not act on a message claiming to be from NoLSAF until this checkpoint is available.
          </p>
        </main>
        <PublicFooter />
      </div>
    );
  }

  const authorityRecords = data.records.filter((record) => record.category !== "IDENTITY");
  const availableTypes = (Object.keys(TYPE_DETAILS) as VerificationType[]).filter((type) => {
    if (type === "records") return authorityRecords.length > 0;
    if (type === "channels") return data.channelTypes.length > 0;
    return Boolean(identity?.legalEntity || identity?.registrationNumber || identity?.jurisdiction);
  });
  const ActiveIcon = selectedType ? TYPE_DETAILS[selectedType].icon : ScanSearch;

  return (
    <div id="verify-page" className="min-h-screen bg-neutral-50 text-neutral-950">
      <style>{`
        #verify-page, #verify-page * { box-sizing: border-box; }
        #verify-page select { -webkit-appearance: none; -moz-appearance: none; appearance: none; background-image: none; }
        #verify-page select::-ms-expand { display: none; }
        #verify-page .checkpoint-grid {
          background-image: linear-gradient(rgba(110,231,183,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(110,231,183,.035) 1px, transparent 1px);
          background-size: 34px 34px;
          animation: checkpoint-grid 18s linear infinite;
        }
        #verify-page .scanner-beam { animation: scanner-beam 1.25s ease-in-out infinite; }
        #verify-page .scanner-pulse { animation: scanner-pulse 2.4s ease-in-out infinite; }
        #verify-page .document-ready { animation: document-ready 3s ease-in-out infinite; }
        #verify-page .credential-enter { animation: credential-enter .55s cubic-bezier(.16,1,.3,1) both; }
        #verify-page .verified-stamp { animation: verified-stamp .55s .22s cubic-bezier(.16,1,.3,1) both; }
        #verify-page .checkpoint-surface, #verify-page .checkpoint-surface * {
          font-family: "Trebuchet MS", Arial, sans-serif;
        }
        @keyframes checkpoint-grid { to { background-position: 34px 34px; } }
        @keyframes scanner-beam {
          0% { top: 8%; opacity: 0; }
          12%, 88% { opacity: 1; }
          100% { top: 88%; opacity: 0; }
        }
        @keyframes scanner-pulse { 0%,100% { opacity: .35; transform: scale(.96); } 50% { opacity: .8; transform: scale(1.04); } }
        @keyframes document-ready { 0%,100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-7px) rotate(1deg); } }
        @keyframes credential-enter { from { opacity: 0; transform: perspective(900px) rotateX(8deg) translateY(22px) scale(.97); } to { opacity: 1; transform: none; } }
        @keyframes verified-stamp { from { opacity: 0; transform: scale(1.6) rotate(-12deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
        @media (prefers-reduced-motion: reduce) {
          #verify-page .checkpoint-grid, #verify-page .scanner-beam, #verify-page .scanner-pulse, #verify-page .document-ready, #verify-page .credential-enter, #verify-page .verified-stamp { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
        }
      `}</style>

      <PublicHeader />

      <main className="public-container pb-12 pt-4 sm:pb-16 sm:pt-6">
        <div className="checkpoint-surface relative isolate overflow-hidden rounded-2xl bg-[#041f1c] px-4 pb-14 pt-6 text-white shadow-sm ring-1 ring-black/5 sm:px-7 sm:pb-16 sm:pt-9 lg:px-10">
          <div className="pointer-events-none absolute left-1/2 top-20 -z-10 h-[620px] w-[920px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(52,211,153,0.09)_0%,rgba(4,31,28,0)_68%)]" />

        <div className="mx-auto flex max-w-3xl justify-center text-center">
          <div>
            <div className="text-center">
              <p className="m-0 text-sm font-extrabold tracking-tight">Welcome to NoLSAF Verify</p>
              <p className="m-0 mt-0.5 text-[10px] font-medium text-emerald-100/55">
                Check an identity, record or official channel
              </p>
            </div>
          </div>
        </div>

        <section className="mx-auto mt-6 max-w-3xl text-center sm:mt-8" aria-labelledby="checkpoint-title">
          <p className="m-0 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300/70">
            <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.8)]" />
            Official company registration
          </p>
          <h1 id="checkpoint-title" className="m-0 mt-2 text-2xl font-bold tracking-[-0.035em] sm:text-3xl">
            Verify NoLSAF’s registered company identity
          </h1>
        </section>

        <section
          className={`checkpoint-grid relative mx-auto mt-6 max-w-2xl overflow-hidden rounded-xl border border-solid border-emerald-200/10 bg-[#061916] shadow-[0_30px_90px_rgba(0,0,0,.28)] transition-[min-height] duration-500 ${scanPhase === "idle" ? "min-h-[230px] sm:min-h-[260px]" : scanPhase === "verified" ? "min-h-[390px] sm:min-h-[440px]" : "min-h-[320px] sm:min-h-[340px]"}`}
          aria-live="polite"
        >
          <CornerBrackets />
          <div className="absolute left-5 top-4 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-200/35">
            <ScanLine className="h-3.5 w-3.5" /> NLSF / secure visual match
          </div>
          <div className="absolute right-5 top-4 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-200/35">
            {selectedType ? `Mode ${TYPE_DETAILS[selectedType].code}` : "Awaiting input"}
          </div>

          {scanPhase === "idle" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <div className="relative mt-4 flex h-24 w-24 items-center justify-center">
                <span className="scanner-pulse absolute inset-0 rounded-full border border-solid border-emerald-300/15" />
                <span className="scanner-pulse absolute inset-4 rounded-full border border-dashed border-emerald-300/20 [animation-delay:300ms]" />
                <ScanSearch className="h-9 w-9 text-emerald-300/70" strokeWidth={1.4} />
              </div>
              <p className="m-0 mt-3 text-sm font-bold text-white/75">Checkpoint is empty</p>
              <p className="m-0 mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-100/30">
                Select a verification type below
              </p>
            </div>
          )}

          {scanPhase === "ready" && selectedType && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
              <div className="document-ready relative flex h-48 w-72 max-w-full flex-col overflow-hidden rounded-lg border border-solid border-white/15 bg-[#eef5ef] p-5 text-[#073b34] shadow-[0_28px_55px_rgba(0,0,0,.35)] sm:h-52 sm:w-80">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Image src="/assets/NoLS2025-04.png" alt="" width={28} height={28} className="h-7 w-7 object-contain" />
                    <div>
                      <p className="m-0 text-[11px] font-extrabold">NoLSAF</p>
                      <p className="m-0 font-mono text-[7px] uppercase tracking-[0.16em] text-emerald-800/55">Verification item</p>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] font-bold text-emerald-800/50">{TYPE_DETAILS[selectedType].code}</span>
                </div>
                <div className="flex flex-1 items-center gap-4">
                  <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-[#d7e7dd] text-emerald-800">
                    <ActiveIcon className="h-8 w-8" strokeWidth={1.5} />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-[8px] font-bold uppercase tracking-[0.14em] text-emerald-900/45">Selected record</p>
                    <p className="m-0 mt-1 text-base font-extrabold leading-5">{TYPE_DETAILS[selectedType].shortLabel}</p>
                    <div className="mt-3 h-1.5 w-28 rounded-full bg-emerald-900/10" />
                    <div className="mt-1.5 h-1.5 w-20 rounded-full bg-emerald-900/10" />
                  </div>
                </div>
                <p className="m-0 overflow-hidden whitespace-nowrap font-mono text-[8px] tracking-[0.14em] text-emerald-950/30">
                  NLSAF&lt;&lt;PUBLIC&lt;CHECK&lt;{TYPE_DETAILS[selectedType].code}&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
                </p>
              </div>
              <p className="m-0 mt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-200/45">
                Item positioned · ready to inspect
              </p>
            </div>
          )}

          {scanPhase === "scanning" && selectedType && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
              <div className="relative flex h-48 w-72 max-w-full flex-col overflow-hidden rounded-lg border border-solid border-emerald-300/25 bg-[#dfece3] p-5 text-[#073b34] shadow-[0_0_60px_rgba(52,211,153,.12)] sm:h-52 sm:w-80">
                <div className="scanner-beam absolute left-0 right-0 z-20 h-px bg-emerald-300 shadow-[0_0_6px_2px_rgba(110,231,183,.9),0_0_28px_8px_rgba(52,211,153,.35)]" />
                <div className="flex items-start justify-between opacity-65">
                  <Image src="/assets/NoLS2025-04.png" alt="" width={28} height={28} className="h-7 w-7 object-contain" />
                  <Fingerprint className="h-6 w-6 text-emerald-800/50" />
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <ActiveIcon className="h-16 w-16 text-emerald-900/25" strokeWidth={1.1} />
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {[0, 1, 2, 3].map((line) => (
                    <span key={line} className="h-1 rounded-full bg-emerald-900/10" />
                  ))}
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2" aria-label="Scan progress">
                {[0, 1, 2].map((step) => (
                  <span
                    key={step}
                    className={`h-1.5 rounded-full transition-all duration-500 ${scanStep > step ? "w-8 bg-emerald-300" : "w-3 bg-white/10"}`}
                  />
                ))}
              </div>
              <p className="m-0 mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-200/55">
                {scanStep === 0 && "Reading public record"}
                {scanStep === 1 && "Matching approved source"}
                {scanStep === 2 && "Checking current status"}
                {scanStep >= 3 && "Sealing result"}
              </p>
            </div>
          )}

          {scanPhase === "verified" && verifiedType && (
            <div className="absolute inset-0 overflow-y-auto p-5 pt-12 sm:p-8 sm:pt-12">
              <VerificationCredential
                type={verifiedType}
                identity={identity}
                records={authorityRecords}
                channels={channelMatch ? [channelMatch] : []}
                channelOutcome={channelOutcome}
                submittedChannel={channelQuery}
              />
            </div>
          )}
        </section>

        <section className="mx-auto mt-4 max-w-2xl" aria-label="Checkpoint controls">
          <div
            className={`grid gap-3 ${
              scanPhase === "ready" && selectedType === "channels" ? "" : "sm:grid-cols-[minmax(0,1fr)_auto]"
            }`}
          >
            <div className="relative">
              <ActiveIcon className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-emerald-300/70" />
              <select
                id="checkpoint-type"
                value={selectedType}
                disabled={scanPhase === "scanning"}
                onChange={(event) => selectVerification(event.target.value as VerificationType | "")}
                className="h-12 w-full rounded-md border border-solid border-white/10 bg-white/[0.06] py-0 pl-11 pr-11 text-sm font-bold text-white outline-none transition hover:bg-white/[0.09] focus:border-emerald-300/50 focus:ring-4 focus:ring-emerald-300/10 disabled:cursor-wait disabled:opacity-50"
              >
                <option value="" className="text-neutral-900">Choose what enters the checkpoint</option>
                {availableTypes.map((type) => (
                  <option key={type} value={type} className="text-neutral-900">
                    {TYPE_DETAILS[type].label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-100/40" />
            </div>

            {scanPhase === "ready" && selectedType !== "channels" && (
              <button
                type="button"
                onClick={startScan}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border-0 bg-emerald-300 px-5 text-sm font-extrabold text-[#052b26] shadow-[0_12px_30px_rgba(52,211,153,.16)] transition hover:bg-emerald-200 focus:outline-none focus:ring-4 focus:ring-emerald-300/20"
              >
                <ScanLine className="h-4 w-4" /> Run verification
              </button>
            )}
            {scanPhase === "scanning" && (
              <button type="button" disabled className="inline-flex h-12 cursor-wait items-center justify-center gap-2 rounded-md border-0 bg-white/10 px-5 text-sm font-bold text-emerald-100/50">
                <Loader2 className="h-4 w-4 animate-spin" /> Verifying
              </button>
            )}
            {scanPhase === "verified" && (
              <button
                type="button"
                onClick={resetScanner}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-solid border-white/10 bg-white/[0.06] px-5 text-sm font-bold text-white transition hover:bg-white/[0.1]"
              >
                <RotateCcw className="h-4 w-4" /> New verification
              </button>
            )}
          </div>

          {scanPhase === "ready" && selectedType === "channels" && (
            <form
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void startScan();
              }}
            >
              {(() => {
                const DetectedIcon = CHANNEL_ICONS[channelLookupType] || Link2;
                const detected = channelQuery.trim() ? detectChannelType(channelQuery, data.channelTypes) : null;
                return (
                  <>
                    <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="relative">
                        <label htmlFor="channel-query" className="sr-only">Contact detail to verify</label>
                        {/* Icon follows what was typed, so the visitor sees how it will be checked */}
                        <DetectedIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-300/80" aria-hidden />
                        <input
                          id="channel-query"
                          value={channelQuery}
                          onChange={(event) => {
                            const next = event.target.value;
                            setChannelQuery(next);
                            setChannelError(null);
                            if (!channelTypeLocked) {
                              const guess = detectChannelType(next, data.channelTypes);
                              if (guess) setChannelLookupType(guess);
                            }
                          }}
                          type="text"
                          inputMode={channelLookupType === "PHONE" ? "tel" : channelLookupType === "EMAIL" ? "email" : "text"}
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          maxLength={500}
                          placeholder="Paste the email, phone, website or account you received"
                          aria-describedby="channel-type-hint"
                          className="box-border h-12 w-full rounded-md border border-solid border-white/10 bg-white/[0.06] pl-11 pr-3.5 text-sm font-bold text-white outline-none placeholder:font-medium placeholder:text-emerald-100/35 focus:border-emerald-300/50 focus:ring-4 focus:ring-emerald-300/10"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!channelQuery.trim()}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-md border-0 bg-emerald-300 px-5 text-sm font-extrabold text-[#052b26] transition hover:bg-emerald-200 focus:outline-none focus:ring-4 focus:ring-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ScanLine className="h-4 w-4" aria-hidden /> Verify
                      </button>
                    </div>

                    {/* Type chips: the detected one is highlighted; tapping another corrects it */}
                    <div id="channel-type-hint" className="mt-2.5 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Check as">
                      <span className="mr-1 text-[11.5px] font-medium text-emerald-100/45">
                        {detected && !channelTypeLocked ? "Detected:" : "Check as:"}
                      </span>
                      {data.channelTypes.map((type) => {
                        const TypeIcon = CHANNEL_ICONS[type] || Link2;
                        const on = channelLookupType === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => {
                              setChannelLookupType(type);
                              setChannelTypeLocked(true);
                              setChannelError(null);
                            }}
                            className={`inline-flex h-7 items-center gap-1.5 rounded-md border border-solid px-2.5 text-[12px] font-semibold transition ${
                              on
                                ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-200"
                                : "border-white/10 bg-transparent text-emerald-100/55 hover:border-white/20 hover:text-emerald-100/85"
                            }`}
                          >
                            <TypeIcon className="h-3.5 w-3.5" aria-hidden />
                            {(CHANNEL_TYPE_LABELS[type] || type).replace(/ address$| number$| or domain$| media account$/i, "")}
                          </button>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </form>
          )}

          {channelError && selectedType === "channels" && scanPhase === "ready" && (
            <p className="m-0 mt-2 text-xs font-semibold text-amber-300" role="alert">{channelError}</p>
          )}
        </section>

          <p className="mx-auto mb-0 mt-5 flex max-w-3xl items-center justify-center gap-2 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-100/30">
            <ShieldCheck className="h-3.5 w-3.5" /> Live view of published records · no submitted data is stored
          </p>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

function CornerBrackets() {
  return (
    <>
      <span className="pointer-events-none absolute left-4 top-4 z-30 h-7 w-7 border-0 border-l border-t border-solid border-emerald-300/35" />
      <span className="pointer-events-none absolute right-4 top-4 z-30 h-7 w-7 border-0 border-r border-t border-solid border-emerald-300/35" />
      <span className="pointer-events-none absolute bottom-4 left-4 z-30 h-7 w-7 border-0 border-b border-l border-solid border-emerald-300/35" />
      <span className="pointer-events-none absolute bottom-4 right-4 z-30 h-7 w-7 border-0 border-b border-r border-solid border-emerald-300/35" />
    </>
  );
}

function VerificationCredential({
  type,
  identity,
  records,
  channels,
  channelOutcome,
  submittedChannel,
}: {
  type: VerificationType;
  identity: {
    legalEntity: string | null;
    jurisdiction: string | null;
    registrationNumber: string | null;
    website: Channel | null;
    lastReviewed: string | null;
  } | null;
  records: VerificationRecord[];
  channels: Channel[];
  channelOutcome: "matched" | "not_found" | null;
  submittedChannel: string;
}) {
  if (type === "channels" && channelOutcome === "not_found") {
    return <ChannelNoMatchResult submittedChannel={submittedChannel} />;
  }

  const matchFound = type !== "channels" || channelOutcome === "matched";

  return (
    <article className="public-credential credential-enter relative mx-auto flex w-full max-w-[540px] flex-col overflow-hidden rounded-[10px] bg-white text-[#073b34] shadow-[0_28px_70px_rgba(0,0,0,.45)] ring-1 ring-black/5 sm:min-h-[340px]">
      {/* Header band: brand, record type and the result seal */}
      <header
        className="relative flex items-center justify-between gap-4 px-5 py-3.5 text-white sm:px-6"
        style={{ background: "linear-gradient(135deg, #013d38 0%, #02665e 60%, #037a70 100%)" }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)", backgroundSize: "14px 14px", WebkitMaskImage: "linear-gradient(90deg, transparent, #000)", maskImage: "linear-gradient(90deg, transparent, #000)" }} />
        <div className="relative flex min-w-0 items-center gap-3">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={30} height={30} className="h-7 w-7 flex-shrink-0 object-contain brightness-0 invert" />
          <div className="min-w-0">
            <p className="m-0 truncate text-[16px] font-bold leading-tight tracking-tight">NoLSAF Verify</p>
            <p className="m-0 mt-0.5 truncate text-[12px] text-white/70">{TYPE_DETAILS[type].shortLabel}</p>
          </div>
        </div>
        <span
          className={`verified-stamp relative inline-flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-bold ${
            matchFound ? "bg-white text-[#02665e]" : "bg-amber-400 text-amber-950"
          }`}
        >
          {matchFound ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : <ShieldAlert className="h-4 w-4" aria-hidden />}
          {matchFound ? "Verified" : "No match"}
        </span>
      </header>

      <CompanyLegitimacy identity={identity} />

      {type === "identity" && identity && <IdentityCredential identity={identity} />}
      {type === "records" && <RecordsCredential records={records} />}
      {type === "channels" && <ChannelsCredential channels={channels} />}

      <footer className="flex items-center justify-between gap-4 bg-[#f1f8f6] px-5 py-2.5 sm:px-6">
        <p className="m-0 flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-[#073b34]">
          <ShieldCheck className="h-4 w-4 flex-shrink-0 text-emerald-700" aria-hidden />
          <span className="truncate">Checked just now against the live public record</span>
        </p>
        <span className="flex-shrink-0 rounded-[4px] bg-white px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-[#52716b] ring-1 ring-inset ring-emerald-900/10">
          {TYPE_DETAILS[type].code}
        </span>
      </footer>
    </article>
  );
}
function ChannelNoMatchResult({ submittedChannel }: { submittedChannel: string }) {
  const kind = detectChannelType(submittedChannel, ["EMAIL", "PHONE", "WEBSITE", "SOCIAL"]);
  const ChannelIcon = (kind && CHANNEL_ICONS[kind]) || Link2;
  const steps = [
    { title: "Do not reply or pay", body: "Ignore requests for money, codes or passwords." },
    { title: "Check the spelling", body: "One changed letter is enough to fake us." },
    { title: "Report it", body: "Forward it so we can warn others." },
  ];

  return (
    <article className="public-credential credential-enter relative mx-auto flex w-full max-w-[540px] flex-col overflow-hidden rounded-[10px] bg-white text-[#073b34] shadow-[0_28px_70px_rgba(0,0,0,.45)] ring-1 ring-black/5">
      {/* Header band matches the verified card, with an amber warning edge */}
      <header
        className="relative flex items-center justify-between gap-4 px-5 py-3.5 text-white sm:px-6"
        style={{ background: "linear-gradient(135deg, #07090c 0%, #1a130a 60%, #2a1c08 100%)" }}
      >
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-amber-400" />
        <div className="relative flex min-w-0 items-center gap-3">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={30} height={30} className="h-7 w-7 flex-shrink-0 object-contain brightness-0 invert" />
          <div className="min-w-0">
            <p className="m-0 truncate text-[16px] font-bold leading-tight tracking-tight">NoLSAF Verify</p>
            <p className="m-0 mt-0.5 truncate text-[12px] text-white/65">Official channel check</p>
          </div>
        </div>
        <span className="verified-stamp relative inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-amber-400 px-2.5 py-1 text-[12px] font-bold text-amber-950">
          <ShieldAlert className="h-4 w-4" aria-hidden /> Not official
        </span>
      </header>

      <div className="px-5 pb-4 pt-5 sm:px-6">
        <p className="m-0 text-[15px] font-bold leading-snug">This is not a NoLSAF channel</p>

        {/* The exact value that was checked, so the visitor can compare letter by letter */}
        <div className="mt-3 box-border flex items-center gap-3 rounded-md border border-solid border-amber-300 bg-amber-50 px-3.5 py-2.5">
          <ChannelIcon className="h-4 w-4 flex-shrink-0 text-amber-700" aria-hidden />
          <span className="min-w-0 flex-1 break-all font-mono text-[14px] font-semibold text-amber-950">{submittedChannel}</span>
          <span className="flex-shrink-0 rounded-[4px] bg-white px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-amber-800 ring-1 ring-inset ring-amber-200">
            No match
          </span>
        </div>

        {/* What to do now: three short, numbered actions */}
        <ol className="m-0 mt-4 grid list-none gap-2 p-0 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="box-border flex gap-2.5 rounded-md border border-solid border-neutral-200 px-3 py-2.5 sm:block">
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[4px] bg-[#073b34] text-[11px] font-bold text-white">
                {index + 1}
              </span>
              <span className="block min-w-0 sm:mt-2">
                <span className="block text-[12.5px] font-bold leading-tight">{step.title}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-[#52716b]">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-[#f1f8f6] px-5 py-2.5 sm:px-6">
        <p className="m-0 flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-[#073b34]">
          <ShieldCheck className="h-4 w-4 flex-shrink-0 text-emerald-700" aria-hidden />
          <span>Checked just now against published channels</span>
        </p>
        <a
          href={`mailto:support@nolsaf.com?subject=${encodeURIComponent("Suspicious channel report")}`}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-[#02665e] px-3 py-1.5 text-[12px] font-bold text-white no-underline transition hover:bg-[#014e47] hover:no-underline"
        >
          <Mail className="h-3.5 w-3.5" aria-hidden /> Report to NoLSAF
        </a>
      </footer>
    </article>
  );
}

function CompanyLegitimacy({
  identity,
}: {
  identity: {
    legalEntity: string | null;
    jurisdiction: string | null;
    registrationNumber: string | null;
    website: Channel | null;
    lastReviewed: string | null;
  } | null;
}) {
  if (!identity || (!identity.legalEntity && !identity.registrationNumber && !identity.jurisdiction)) return null;

  return (
    <section className="relative grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-5 px-5 py-5 sm:px-6">
      <div className="min-w-0">
      {/* Contact chip, as on a payment or ID card */}
      <span
        aria-hidden
        className="mb-3 block h-7 w-10 rounded-[5px] ring-1 ring-inset ring-amber-900/20"
        style={{
          background:
            "linear-gradient(90deg, transparent 32%, rgba(120,80,20,0.28) 32%, rgba(120,80,20,0.28) 35%, transparent 35%, transparent 65%, rgba(120,80,20,0.28) 65%, rgba(120,80,20,0.28) 68%, transparent 68%), linear-gradient(0deg, transparent 45%, rgba(120,80,20,0.28) 45%, rgba(120,80,20,0.28) 55%, transparent 55%), linear-gradient(135deg, #f6dc8f 0%, #d9ae4f 50%, #f3d58a 100%)",
        }}
      />
      <p className="m-0 text-[11.5px] font-semibold text-emerald-700">Registered legal entity</p>
      {/* The full name, never truncated: it is the fact people are checking */}
      {identity.legalEntity && (
        <p className="m-0 mt-1 break-words text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-[#073b34] sm:text-[22px]">
          {identity.legalEntity}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {identity.registrationNumber && (
          <span className="inline-flex items-baseline gap-2 text-[12px] text-[#52716b]">
            Reg. no.
            <span className="font-mono text-[15px] font-bold tracking-[0.18em] text-[#073b34]">{identity.registrationNumber}</span>
          </span>
        )}
        {identity.jurisdiction && (
          <span className="inline-flex items-center gap-1 rounded-md bg-[#f1f8f6] px-2 py-0.5 text-[12px] text-[#52716b] ring-1 ring-inset ring-emerald-900/10">
            <MapPin className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
            <span className="font-semibold text-[#073b34]">{identity.jurisdiction}</span>
          </span>
        )}
      </div>
      </div>
      <CredentialQr label="Scan to recheck" />
    </section>
  );
}

function IdentityCredential({
  identity,
}: {
  identity: {
    legalEntity: string | null;
    jurisdiction: string | null;
    registrationNumber: string | null;
    website: Channel | null;
    lastReviewed: string | null;
  };
}) {
  // The header already says "Company identity", so only extra facts earn a row here.
  const facts = [
    ["Official domain", identity.website?.value || null],
    ["Last reviewed", formatDate(identity.lastReviewed)],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));

  if (!facts.length) return null;

  return (
    <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-emerald-950/[0.08] bg-emerald-950/[0.06]">
      {facts.map(([label, value], index) => (
        <div key={label} className={`min-w-0 bg-white px-5 py-3 sm:px-6 ${facts.length === 1 && index === 0 ? "col-span-2" : ""}`}>
          <dt className="m-0 text-[11.5px] text-[#6a837e]">{label}</dt>
          <dd className="m-0 mt-0.5 truncate text-[14px] font-bold text-[#073b34]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecordsCredential({ records }: { records: VerificationRecord[] }) {
  return (
    <div className="border-0 border-t border-solid border-emerald-950/[0.08] px-5 py-4 sm:px-6">
      <ul className="m-0 grid list-none gap-2 p-0">
        {records.map((record) => {
          const active = isRecordActive(record);
          return (
            <li key={record.key} className="flex items-center gap-3 rounded-xl bg-[#f7fbfa] px-3 py-2.5 ring-1 ring-inset ring-emerald-900/[0.07]">
              <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${active ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {active ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : <ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[14px] font-bold text-[#073b34]">{record.displayName}</p>
                <p className="m-0 mt-0.5 truncate text-[12px] text-[#6a837e]">
                  {record.authorityName || record.jurisdiction || record.registrationNumber || "Published record"}
                </p>
              </div>
              <span className={`flex-shrink-0 text-[11.5px] font-semibold ${active ? "text-emerald-700" : "text-amber-700"}`}>{active ? "Active" : "Check"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChannelsCredential({ channels }: { channels: Channel[] }) {
  if (!channels.length) return null;

  return (
    <div className="border-0 border-t border-solid border-emerald-950/[0.08] px-5 py-4 sm:px-6">
      <ul className="m-0 grid list-none gap-2 p-0">
        {channels.map((channel) => {
          const Icon = CHANNEL_ICONS[String(channel.channelType || "").toUpperCase()] || Link2;
          return (
            <li key={`${channel.channelType}-${channel.value}`} className="flex min-w-0 items-center gap-3 rounded-xl bg-[#f7fbfa] px-3 py-2.5 ring-1 ring-inset ring-emerald-900/[0.07]">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[12px] text-[#6a837e]">{channel.label}</p>
                <p className="m-0 mt-0.5 truncate text-[15px] font-bold text-[#073b34]">{channel.value}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CredentialQr({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="flex h-[88px] w-[88px] items-center justify-center rounded-md bg-white p-1.5 ring-1 ring-inset ring-emerald-900/15">
        {/* eslint-disable-next-line @next/next/no-img-element -- the API returns a sharp verification SVG. */}
        <img
          src="/api/public/verify/qr.svg"
          alt="QR code that opens the live NoLSAF verification page"
          width={80}
          height={80}
          className="h-20 w-20"
        />
      </span>
      <span className="mt-1.5 text-center text-[10.5px] font-semibold text-[#52716b]">{label}</span>
    </div>
  );
}