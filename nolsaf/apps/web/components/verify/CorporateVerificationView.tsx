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
          className="checkpoint-grid relative mx-auto mt-6 min-h-[390px] max-w-3xl overflow-hidden rounded-xl border border-solid border-emerald-200/10 bg-[#061916] shadow-[0_30px_90px_rgba(0,0,0,.28)] sm:min-h-[440px]"
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
              <div className="relative flex h-32 w-32 items-center justify-center">
                <span className="scanner-pulse absolute inset-0 rounded-full border border-solid border-emerald-300/15" />
                <span className="scanner-pulse absolute inset-5 rounded-full border border-dashed border-emerald-300/20 [animation-delay:300ms]" />
                <ScanSearch className="h-11 w-11 text-emerald-300/70" strokeWidth={1.4} />
              </div>
              <p className="m-0 mt-4 text-sm font-bold text-white/75">Checkpoint is empty</p>
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
              <p className="m-0 mt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-200/45">
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

              <div className="mt-7 flex items-center gap-2" aria-label="Scan progress">
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

        <section className="mx-auto mt-4 max-w-3xl" aria-label="Checkpoint controls">
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
              className="mt-3 grid gap-2.5 sm:grid-cols-[170px_minmax(0,1fr)_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void startScan();
              }}
            >
              <div className="relative">
                <label htmlFor="channel-lookup-type" className="sr-only">Channel type</label>
                <select
                  id="channel-lookup-type"
                  value={channelLookupType}
                  onChange={(event) => {
                    setChannelLookupType(event.target.value);
                    setChannelError(null);
                  }}
                  className="h-12 w-full rounded-md border border-solid border-white/10 bg-white/[0.06] px-3.5 pr-9 text-sm font-bold text-white outline-none focus:border-emerald-300/50 focus:ring-4 focus:ring-emerald-300/10"
                >
                  {data.channelTypes.map((type) => (
                    <option key={type} value={type} className="text-neutral-900">
                      {CHANNEL_TYPE_LABELS[type] || type}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-100/40" />
              </div>

              <div>
                <label htmlFor="channel-query" className="sr-only">Exact channel to verify</label>
                <input
                  id="channel-query"
                  value={channelQuery}
                  onChange={(event) => {
                    setChannelQuery(event.target.value);
                    setChannelError(null);
                  }}
                  type={channelLookupType === "EMAIL" ? "email" : channelLookupType === "PHONE" ? "tel" : "text"}
                  inputMode={channelLookupType === "PHONE" ? "tel" : undefined}
                  autoComplete="off"
                  maxLength={500}
                  placeholder={
                    channelLookupType === "EMAIL"
                      ? "Paste the exact email address"
                      : channelLookupType === "PHONE"
                        ? "Enter the complete phone number"
                        : channelLookupType === "WEBSITE"
                          ? "Paste the website or domain"
                          : "Paste the exact channel you received"
                  }
                  className="h-12 w-full rounded-md border border-solid border-white/10 bg-white/[0.06] px-3.5 text-sm font-bold text-white outline-none placeholder:text-emerald-100/30 focus:border-emerald-300/50 focus:ring-4 focus:ring-emerald-300/10"
                />
              </div>

              <button
                type="submit"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border-0 bg-emerald-300 px-5 text-sm font-extrabold text-[#052b26] transition hover:bg-emerald-200 focus:outline-none focus:ring-4 focus:ring-emerald-300/20"
              >
                <ScanLine className="h-4 w-4" /> Verify channel
              </button>
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
    <article className="public-credential credential-enter relative mx-auto max-w-xl overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white text-[#073b34] shadow-[0_28px_70px_rgba(0,0,0,.4)]">
      <div className="relative z-10 flex items-center justify-between gap-4 border-0 border-b border-solid border-emerald-950/10 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={26} height={26} className="h-6 w-6 flex-shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="m-0 truncate text-base font-bold tracking-[-0.015em]">NoLSAF Verify</p>
            <p className="m-0 mt-1 text-[10px] font-bold uppercase tracking-[0.13em] text-[#52716b]">
              {TYPE_DETAILS[type].shortLabel} · live public record
            </p>
          </div>
        </div>
        <div className="verified-stamp flex flex-shrink-0 items-center gap-2">
          <span className={`flex h-8 w-8 items-center justify-center rounded-md text-white ${matchFound ? "bg-emerald-700" : "bg-amber-600"}`}>
            {matchFound ? <Check className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          </span>
          <div className="hidden text-left sm:block">
            <p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-[#52716b]">Verification result</p>
            <p className={`m-0 mt-0.5 text-xs font-bold ${matchFound ? "text-[#073b34]" : "text-amber-800"}`}>
              {matchFound ? "Match confirmed" : "No published match"}
            </p>
          </div>
        </div>
      </div>

      <CompanyLegitimacy identity={identity} />

      {type === "identity" && identity && <IdentityCredential identity={identity} />}
      {type === "records" && <RecordsCredential records={records} />}
      {type === "channels" && <ChannelsCredential channels={channels} />}

      <div className="relative z-10 flex items-center justify-between gap-5 border-0 border-t border-solid border-emerald-950/10 bg-white px-5 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 text-xs font-bold text-[#073b34]">
            <ShieldCheck className="h-4 w-4 flex-shrink-0 text-emerald-700" /> Checked against the live published source
          </p>
          <p className="m-0 mt-1 text-[10px] leading-4 text-[#52716b]">
            Scan the QR on the credential to reopen the current record.
          </p>
        </div>
        <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] text-[#6a837e]">
          {TYPE_DETAILS[type].code} / Live verification
        </span>
      </div>
    </article>
  );
}

function ChannelNoMatchResult({ submittedChannel }: { submittedChannel: string }) {
  return (
    <article className="public-credential credential-enter mx-auto max-w-xl overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white text-[#073b34] shadow-[0_28px_70px_rgba(0,0,0,.4)]">
      <div className="flex items-center justify-between gap-4 border-0 border-b border-solid border-amber-900/10 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={26} height={26} className="h-6 w-6 flex-shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="m-0 text-base font-bold">NoLSAF Verify</p>
            <p className="m-0 mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#52716b]">Official channel check</p>
          </div>
        </div>
        <span className="inline-flex flex-shrink-0 items-center gap-2 text-xs font-bold text-amber-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-600 text-white">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <span className="hidden sm:inline">Not found</span>
        </span>
      </div>

      <div className="px-5 py-6 sm:px-6">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">No published match</p>
        <p className="m-0 mt-2 break-all text-lg font-bold">{submittedChannel}</p>
        <p className="m-0 mt-3 max-w-md text-xs leading-5 text-[#52716b]">
          This detail is not listed as an official NoLSAF channel. Check the spelling; if it is correct, stop and use a known official contact route.
        </p>
      </div>

      <div className="flex items-center gap-2 border-0 border-t border-solid border-neutral-200 px-5 py-3 text-[10px] font-bold text-[#52716b] sm:px-6">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" /> Checked against current published channels
      </div>
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
  if (!identity) return null;

  const facts = [
    ["Legal entity", identity.legalEntity],
    ["Registration number", identity.registrationNumber],
    ["Incorporated in", identity.jurisdiction],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));

  if (!facts.length) return null;

  return (
    <dl
      className={`relative z-10 m-0 grid gap-px border-0 border-b border-solid border-emerald-950/10 bg-neutral-200 ${
        facts.length >= 3 ? "sm:grid-cols-3" : facts.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1"
      }`}
    >
      {facts.map(([label, value]) => (
        <div key={label} className="min-w-0 bg-neutral-50 px-5 py-3 sm:px-6">
          <dt className="m-0 text-[9px] font-bold uppercase tracking-[0.11em] text-[#52716b]">{label}</dt>
          <dd className="m-0 mt-1 truncate text-sm font-bold text-[#073b34]">{value}</dd>
        </div>
      ))}
    </dl>
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
  const facts = [
    ["Record type", "Company identity"],
    ["Official domain", identity.website?.value || null],
    ["Last reviewed", formatDate(identity.lastReviewed)],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));

  return (
    <div className="relative z-10 grid gap-5 p-5 sm:grid-cols-[112px_minmax(0,1fr)] sm:p-6">
      <CredentialQr label="Entity record" />
      <dl className="m-0 grid content-center grid-cols-2 gap-x-6 gap-y-4">
        {facts.map(([label, value], index) => (
          <div key={label} className={`min-w-0 ${index === 0 && facts.length > 2 ? "col-span-2" : ""}`}>
            <dt className="m-0 text-[10px] font-bold uppercase tracking-[0.11em] text-[#52716b]">{label}</dt>
            <dd className={`m-0 mt-1 truncate font-extrabold tracking-[-0.01em] ${index === 0 && facts.length > 2 ? "text-base" : "text-sm"}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RecordsCredential({ records }: { records: VerificationRecord[] }) {
  return (
    <div className="relative z-10 grid gap-5 p-5 sm:grid-cols-[112px_minmax(0,1fr)] sm:p-6">
      <CredentialQr label={`${records.length} ${records.length === 1 ? "record" : "records"}`} />
      <div className="divide-y divide-emerald-950/10">
        {records.map((record) => (
          <div key={record.key} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1">
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-sm font-bold">{record.displayName}</p>
              <p className="m-0 mt-1 truncate text-[10px] font-bold uppercase tracking-[0.09em] text-[#52716b]">
                {record.authorityName || record.jurisdiction || record.registrationNumber || "Published record"}
              </p>
            </div>
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${isRecordActive(record) ? "bg-emerald-600" : "bg-amber-500"}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelsCredential({ channels }: { channels: Channel[] }) {
  if (!channels.length) return null;

  return (
    <div className="relative z-10 grid gap-5 p-5 sm:grid-cols-[112px_minmax(0,1fr)] sm:p-6">
      <CredentialQr label="Official channel" />
      <div className="divide-y divide-emerald-950/10">
        {channels.map((channel) => {
          const Icon = CHANNEL_ICONS[String(channel.channelType || "").toUpperCase()] || Link2;
          return (
            <div key={`${channel.channelType}-${channel.value}`} className="flex min-w-0 items-center gap-3 py-3 first:pt-1 last:pb-1">
              <Icon className="h-5 w-5 flex-shrink-0 text-emerald-700" />
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.11em] text-[#52716b]">{channel.label}</p>
                <p className="m-0 mt-1 truncate text-base font-bold">{channel.value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CredentialQr({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-md border border-solid border-neutral-200 bg-neutral-50 px-2 py-3">
      <span className="flex h-[78px] w-[78px] items-center justify-center bg-white p-1 ring-1 ring-neutral-200">
        {/* eslint-disable-next-line @next/next/no-img-element -- the API returns a sharp verification SVG. */}
        <img
          src="/api/public/verify/qr.svg"
          alt="QR code that opens the live NoLSAF verification page"
          width={70}
          height={70}
          className="h-[70px] w-[70px]"
        />
      </span>
      <span className="mt-3 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#52716b]">{label}</span>
    </div>
  );
}
