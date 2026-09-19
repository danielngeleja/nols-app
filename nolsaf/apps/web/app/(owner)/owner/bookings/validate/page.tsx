"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, FileCheck2, X } from "lucide-react";
import Support from "@/components/Support";
import apiClient from "@/lib/apiClient";
import { useRouter } from "next/navigation";

const api = apiClient;

type Preview = {
  bookingId: number;
  property: { id: number; title: string; type: string };
  personal: { fullName: string; phone: string; nationality: string; sex: string; ageGroup: string };
  booking: {
    roomType: string;
    rooms: number;
    nights: number;
    checkIn: string;
    checkOut: string;
    status: string;
    totalAmount: string;
    transportFare?: string;
    ownerBaseAmount?: string;
    includeTransport?: boolean;
  };
} | null;

type Eligibility =
  | { canValidate: true; status: "IN_WINDOW"; reason?: undefined }
  | { canValidate: false; status: "BEFORE_CHECKIN" | "AFTER_CHECKOUT" | "INVALID_DATES" | "CODE_NOT_ACTIVE"; reason: string };

export default function CheckinValidation() {
  // Support contact — fetch from public settings endpoint if available, otherwise use env fallbacks.
  const [supportEmail, setSupportEmail] = useState<string>(process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@nolsaf.com");
  const [supportPhone, setSupportPhone] = useState<string>(process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "+255 736 766 726");

  const [code, setCode] = useState("");
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [searching, setSearching] = useState(false);
  const [contactSuggest, setContactSuggest] = useState(false);
  const searchingRef = useRef<number | null>(null);
  const contactRef = useRef<number | null>(null);
  const [attempting, setAttempting] = useState(false);
  const router = useRouter();

  const [lastValidated, setLastValidated] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const lockedMs = lockedUntil ? Math.max(0, lockedUntil - nowMs) : 0;
  const isLocked = lockedMs > 0;
  const lockSeconds = Math.ceil(lockedMs / 1000);
  const lockMinutesPart = Math.floor(lockSeconds / 60);
  const lockSecondsPart = lockSeconds % 60;
  const lockCountdown = isLocked ? `${lockMinutesPart}:${String(lockSecondsPart).padStart(2, "0")}` : null;

  // The NRMS front desk sends a receptionist here because the code is the only
  // way a marketplace stay can be checked in. `booking` says which arrival they
  // left to validate, `return` is the NRMS screen to hand them back to once it
  // is done, so the trip out of NRMS closes itself. Read from the URL directly
  // rather than useSearchParams, which would force a Suspense boundary around
  // this whole client page.
  const [handoff, setHandoff] = useState<{ bookingId: number | null; guestName: string | null; returnTo: string | null }>({
    bookingId: null,
    guestName: null,
    returnTo: null,
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bookingId = Number(params.get("booking"));
    const returnTo = params.get("return");
    let guestName: string | null = null;
    try {
      const stored = JSON.parse(window.sessionStorage.getItem("nolsaf:front-desk-handoff") || "null");
      if (stored?.bookingId === bookingId && typeof stored?.guestName === "string") {
        guestName = stored.guestName.trim().slice(0, 160) || null;
      }
    } catch {
      guestName = null;
    }
    setHandoff({
      bookingId: Number.isInteger(bookingId) && bookingId > 0 ? bookingId : null,
      guestName,
      // Only an in-app path, never an absolute URL an open redirect could ride.
      returnTo: returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : null,
    });
  }, []);

  useEffect(() => {
    if (!lockedUntil) return;
    const t = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(t);
  }, [lockedUntil]);

  useEffect(() => {
    if (lockedUntil && lockedUntil <= nowMs) {
      setLockedUntil(null);
      setRemainingAttempts(null);
    }
  }, [lockedUntil, nowMs]);

  const validate = useCallback(async (incomingCode?: string) => {
    const codeToUse = (incomingCode ?? code)?.trim();
    if (!codeToUse) return;
    // avoid re-validating the same code repeatedly
    if (codeToUse === lastValidated) return;

    if (lockedUntil && lockedUntil > Date.now()) {
      setResultMsg(null);
      return;
    }

    // reset helpers
    setLoading(true);
    setSearching(false);
    setContactSuggest(false);
    setResultMsg(null);
    setPreview(null);
    setEligibility(null);
    setRemainingAttempts(null);
    setAttempting(true);

    // clear any existing timers
    if (searchingRef.current) {
      window.clearTimeout(searchingRef.current);
      searchingRef.current = null;
    }
    if (contactRef.current) {
      window.clearTimeout(contactRef.current);
      contactRef.current = null;
    }

    // show a gentle "Still searching..." indicator after 10s
    searchingRef.current = window.setTimeout(() => {
      setSearching(true);
    }, 10000);
    // escalate to contact suggestion after 20s
    contactRef.current = window.setTimeout(() => {
      setContactSuggest(true);
    }, 20000);

    try {
      const r = await api.post<{ details: Preview; eligibility?: Eligibility }>("/api/owner/bookings/validate", { code: codeToUse });
      setPreview(r.data?.details ?? null);
      setEligibility((r.data as any)?.eligibility ?? null);
      setRemainingAttempts(null);
      setLockedUntil(null);
      setLastValidated(codeToUse);
      if (!r.data?.details) setResultMsg("No details returned");
    } catch (e: any) {
      // network errors (no response) vs application errors
      if (!e?.response) {
        setResultMsg("Network error: could not reach server. Check your internet connection or contact the NoLSAF team for assistance.");
      } else {
        const status = Number(e?.response?.status);
        const data = e?.response?.data ?? {};

        if (status === 429) {
          const until = typeof data?.lockedUntil === "number" ? data.lockedUntil : null;
          setLockedUntil(until);
          setRemainingAttempts(0);
          if (until) setNowMs(Date.now());
          // Keep UI clean during lockout: show only countdown banner.
          setResultMsg(null);
        } else {
          const ra = typeof data?.remainingAttempts === "number" ? data.remainingAttempts : null;
          if (ra !== null) setRemainingAttempts(ra);
          setResultMsg(data?.error ?? "Invalid code");
        }
      }
    } finally {
      setLoading(false);
      setSearching(false);
      setAttempting(false);
      // clear timers
      if (searchingRef.current) {
        window.clearTimeout(searchingRef.current);
        searchingRef.current = null;
      }
      if (contactRef.current) {
        window.clearTimeout(contactRef.current);
        contactRef.current = null;
      }
      setContactSuggest(false);
    }
  }, [code, lastValidated, lockedUntil]);

  // legacy direct confirm removed; use handleConfirmWithConsent (modal flow) for confirmations.

  // Confirmation modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeDisbursement, setAgreeDisbursement] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // QR scan modal
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanActive, setScanActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  async function handleConfirmWithConsent() {
    if (!preview) return;
    if (!agreeTerms || !agreeDisbursement) return setResultMsg("Please accept the Terms & Conditions and the Disbursement Policy to continue.");
    setConfirmLoading(true);
    setResultMsg(null);
    try {
      const payload = {
        bookingId: preview.bookingId,
        consent: {
          accepted: true,
          method: 'checkbox',
          termsVersion: process.env.NEXT_PUBLIC_TERMS_VERSION ?? 'v1',
          disbursementVersion: process.env.NEXT_PUBLIC_DISBURSEMENT_POLICY_VERSION ?? 'v1'
        },
        clientSnapshot: {
          fullName: preview.personal.fullName,
          phone: preview.personal.phone,
          property: preview.property.title,
          roomType: preview.booking.roomType,
          nights: preview.booking.nights,
          amountPaid: preview.booking.ownerBaseAmount ?? preview.booking.totalAmount,
          bookingCode: (preview as any).booking?.code ?? null,
          nationality: preview.personal.nationality
        }
      };
      await api.post('/api/owner/bookings/confirm-checkin', payload);
      setConfirmOpen(false);

      // notify sidebar (and any listeners) to refresh checked-in counts immediately
      window.dispatchEvent(new Event("nols:checkedin-changed"));
      // Back to whoever sent us here: the NRMS front desk when the arrival was
      // started there, otherwise the checked-in list as before.
      window.sessionStorage.removeItem("nolsaf:front-desk-handoff");
      router.push(handoff.returnTo ?? '/owner/bookings/checked-in');
    } catch (err: any) {
      setResultMsg(err?.response?.data?.error ?? 'Could not confirm check-in');
    } finally {
      setConfirmLoading(false);
    }
  }

  const stopScanner = useCallback(() => {
    setScanActive(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      try { videoRef.current.srcObject = null; } catch {}
    }
  }, []);

  const normalizeScanValue = (rawVal: string) => {
    const v = String(rawVal || "").trim();
    // If the QR encodes JSON, send it as-is (API will parse bookingId).
    if (v.startsWith("{") && v.includes("bookingId")) return v;
    // If it looks like a URL, try to extract a plausible code token.
    // Otherwise pass through (server validation will reject invalid input).
    try {
      const u = new URL(v);
      const qp = u.searchParams.get("code") || u.searchParams.get("bookingCode") || u.searchParams.get("checkinCode");
      if (qp) return String(qp).trim();
    } catch {}
    return v;
  };

  const startScanner = useCallback(async () => {
    setScanError(null);
    if (!scanOpen) return;
    if (!videoRef.current) return;

    // Prefer built-in BarcodeDetector when available (no extra deps).
    const DetectorCtor = (globalThis as any).BarcodeDetector;
    if (!DetectorCtor) {
      setScanError("QR scanning is not supported on this browser. Please type the code manually.");
      return;
    }

    try {
      const supported: string[] = await DetectorCtor.getSupportedFormats?.();
      if (Array.isArray(supported) && supported.length && !supported.includes("qr_code")) {
        setScanError("QR scanning is not supported on this device. Please type the code manually.");
        return;
      }
    } catch {
      // ignore
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const detector = new DetectorCtor({ formats: ["qr_code"] });
      setScanActive(true);

      const loop = async () => {
        if (!videoRef.current || !scanOpen) return;
        try {
          const results = await detector.detect(videoRef.current);
          if (Array.isArray(results) && results[0]?.rawValue) {
            const normalized = normalizeScanValue(String(results[0].rawValue));
            setCode(normalized);
            setScanOpen(false);
            stopScanner();
            validate(normalized);
            return;
          }
        } catch {
          // ignore frame errors
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e: any) {
      setScanError(e?.message || "Could not access the camera. Please allow camera access and try again.");
      stopScanner();
    }
  }, [scanOpen, stopScanner, validate]);

  // Auto-validate only when a full code is present (debounced)
  useEffect(() => {
    // clear any pending debounce
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current as number);
      debounceRef.current = null;
    }

    const trimmed = code?.trim();
    if (!trimmed) {
      // nothing typed — stop showing checking
      setAttempting(false);
      return;
    }

    if (isLocked) {
      setAttempting(false);
      return;
    }

    // Only validate once the full code is entered to avoid consuming attempts on partial typing.
    // Receipt QR scan payloads are JSON and can be validated immediately.
    const isQrPayload = trimmed.startsWith("{") && trimmed.includes("bookingId");
    if (!isQrPayload && trimmed.length !== 8) {
      setAttempting(false);
      return;
    }

    // schedule validation and mark that the owner initiated an attempt
    setAttempting(true);
    debounceRef.current = window.setTimeout(() => {
      validate(trimmed);
    }, 450);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current as number);
    };
  }, [code, isLocked, validate]);

  // cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current as number);
      if (searchingRef.current) window.clearTimeout(searchingRef.current as number);
      if (contactRef.current) window.clearTimeout(contactRef.current as number);
      stopScanner();
    };
  }, [stopScanner]);

  // start/stop scanner when modal toggles
  useEffect(() => {
    if (scanOpen) startScanner();
    else stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanOpen]);

  // Fetch public support contact (admin-editable) on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Use same-origin path to leverage Next.js rewrites and avoid CORS
        const r = await fetch('/api/public/support');
        if (!mounted) return;
        if (r.ok) {
          const j = await r.json();
          if (j?.supportEmail) setSupportEmail(j.supportEmail);
          if (j?.supportPhone) setSupportPhone(j.supportPhone);
        }
      } catch (err) {
        // silently ignore — fall back to env defaults
        console.debug('Could not fetch public support contact', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Connectivity indicator (for premium clients): reflects whether the API is reachable.
  useEffect(() => {
    let mounted = true;
    let timer: number | null = null;
    const ping = async () => {
      try {
        const r = await fetch('/api/health', { method: 'GET', credentials: 'include' });
        if (!mounted) return;
        setIsConnected(r.ok);
      } catch {
        if (!mounted) return;
        setIsConnected(false);
      }
    };

    ping();
    timer = window.setInterval(ping, 15000);

    return () => {
      mounted = false;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  const formatDateTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const formatTZS = (value: string | number) => {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    if (!Number.isFinite(n)) return `TZS ${value}`;
    return new Intl.NumberFormat('en-TZ', {
      style: 'currency',
      currency: 'TZS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  };

  return (
    <div className="w-full box-border overflow-hidden">

      {/* ── Hero Banner ── */}
      <div className="w-full relative overflow-hidden nols-entrance">
        {/* Teal gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#02665e] via-[#034e47] to-[#023a35]" />
        {/* Animated cross-hatch pattern */}
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)', backgroundSize: '18px 18px' }} />
        {/* Floating orbs */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/[0.04] pointer-events-none" />
        <div className="absolute -bottom-12 -left-6 w-36 h-36 rounded-full bg-white/[0.03] pointer-events-none" />
        <div className="absolute top-6 right-1/4 w-16 h-16 rounded-full bg-white/[0.03] pointer-events-none animate-pulse" />

        <div className="relative flex flex-col items-center text-center px-4 pt-8 pb-7 gap-4">
          {/* Animated icon ring */}
          <div className="relative">
            <div className="absolute -inset-2 rounded-2xl border border-white/20 animate-[ping_3s_ease-in-out_infinite]" />
            <div className="absolute -inset-1 rounded-xl bg-white/10 animate-pulse" />
            <div className="relative h-14 w-14 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-lg">
              <FileCheck2 className="h-7 w-7 text-white drop-shadow" aria-hidden />
            </div>
          </div>

          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white drop-shadow-sm">Check-in Validation</h1>
            <p className="mt-1.5 text-sm text-white/60 max-w-[280px] mx-auto leading-relaxed">
              Scan the receipt QR or enter the booking code to validate a guest check-in.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 backdrop-blur-sm px-3 py-1 text-[11px] font-semibold text-white/80">
              Owner tool
            </span>
            <span className="inline-flex items-center rounded-full border border-emerald-300/30 bg-emerald-400/15 backdrop-blur-sm px-3 py-1 text-[11px] font-semibold text-emerald-200">
              Secure
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold border backdrop-blur-sm ${
                isConnected
                  ? "border-emerald-300/30 bg-emerald-400/20 text-emerald-200"
                  : isConnected === false
                    ? "border-white/15 bg-white/10 text-white/50"
                    : "border-white/10 bg-white/5 text-white/40"
              }`}
              aria-live="polite"
              title={isConnected ? "API reachable" : isConnected === false ? "API not reachable" : "Checking API"}
            >
              <span className={`relative flex h-2 w-2 flex-shrink-0`}>
                {isConnected && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${
                  isConnected ? "bg-emerald-300" : isConnected === false ? "bg-white/40" : "bg-white/30 animate-pulse"
                }`} />
              </span>
              {isConnected ? "Online" : isConnected === false ? "Offline" : "Connecting…"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main content — no extra px, public-container already provides padding ── */}
      <div className="w-full box-border py-4 nols-entrance nols-delay-1" style={{maxWidth:'100%',overflowX:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr',gap:'1rem',width:'100%',maxWidth:'100%',boxSizing:'border-box'}}
             className="lg:grid-cols-2 lg:gap-6 lg:items-start">

          {/* ── Validate Card ── */}
          <div className="w-full overflow-hidden bg-white rounded-2xl border border-slate-200">

            {/* Card header strip */}
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-bold text-slate-900">Validate guest</p>
                <p className="text-xs text-slate-500 mt-0.5">Paste code, type it, or scan QR</p>
              </div>
            </div>

            <div className="p-4 space-y-4">

              {/* Front desk handoff: which arrival NRMS sent them here for. */}
              {handoff.bookingId ? (
                <div className="border-0 border-l-2 border-solid border-emerald-600 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS front desk</p>
                  <p className="m-0 mt-1 text-base font-bold">Check in {handoff.guestName || "guest"}</p>
                  <p className="m-0 mt-1 text-xs leading-relaxed text-emerald-800">
                    Ask the guest for their booking code, then enter it below to confirm check-in. You will return to the front desk when the code is accepted.
                  </p>
                  {preview && preview.bookingId !== handoff.bookingId ? (
                    <p className="m-0 mt-2 text-xs font-semibold text-amber-800">
                      This code belongs to {preview.personal.fullName}{handoff.guestName ? `, not ${handoff.guestName}` : ""}. Confirm that you have the correct guest before continuing.
                    </p>
                  ) : null}
                  {handoff.returnTo ? (
                    <a href={handoff.returnTo} className="mt-2 inline-block text-xs font-bold text-emerald-800 underline">
                      Back to front desk
                    </a>
                  ) : null}
                </div>
              ) : null}

              {/* Code input */}
              <div className="space-y-2">
                <label htmlFor="checkin-input" className="block text-sm font-semibold text-slate-800">
                  Check-in Code
                </label>
                <div className="flex items-stretch gap-2">
                  <input
                    id="checkin-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onPaste={(e) => {
                      if (isLocked) return;
                      const pasted = e.clipboardData?.getData("text") ?? "";
                      if (pasted) {
                        const normalized = normalizeScanValue(pasted);
                        setCode(normalized);
                        const t = String(normalized || "").trim();
                        const isQrPayload = t.startsWith("{") && t.includes("bookingId");
                        if (isQrPayload || t.length === 8) {
                          validate(normalized);
                        }
                      }
                    }}
                    disabled={isLocked}
                    className="flex-1 min-w-0 px-4 py-3 text-base font-mono tracking-widest uppercase border border-slate-200 rounded-xl bg-white text-center outline-none placeholder:text-slate-300 placeholder:tracking-normal focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed transition-all"
                    placeholder="XXXXXXXX"
                    autoFocus
                    maxLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => { setScanOpen(true); setScanError(null); }}
                    disabled={isLocked}
                    className="shrink-0 h-12 w-12 flex items-center justify-center rounded-xl bg-[#02665e] text-white hover:bg-[#024d47] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    aria-label="Scan QR code"
                    title="Scan QR code"
                  >
                    <Camera className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                <p className="text-xs text-slate-500">QR scan requires Chrome or Edge on mobile.</p>
              </div>

              {/* Lock countdown */}
              {isLocked && lockCountdown ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status" aria-live="polite">
                  Too many invalid attempts. Try again in <strong className="font-semibold">{lockCountdown}</strong>.
                </div>
              ) : null}

              {/* Remaining attempts */}
              {!isLocked && typeof remainingAttempts === "number" ? (
                <div className="text-xs text-slate-500" aria-live="polite">
                  Attempts remaining: <span className="font-semibold text-slate-700">{remainingAttempts}</span>
                </div>
              ) : null}

              {/* Loading */}
              {loading && (
                <div className="flex items-center gap-2.5 py-1">
                  <div className="flex gap-1">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.3s]" />
                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.15s]" />
                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-bounce" />
                  </div>
                  <span className="text-sm text-slate-600">{searching ? "Still searching…" : attempting ? "Checking…" : "Validating…"}</span>
                </div>
              )}

              {/* Long wait */}
              {contactSuggest && !loading && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  This is taking unusually long. If it still does not return a result, please contact support below.
                </div>
              )}

              {/* Error message */}
              {resultMsg && !preview && !isLocked && (
                <div className="w-full" role="alert" aria-live="polite">
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <div className="flex items-start gap-2">
                      <span className="inline-flex h-2 w-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                      <p className="text-sm text-red-700">
                        {resultMsg.includes("Network error")
                          ? "Check your internet connection or contact the NoLSAF team for assistance."
                          : resultMsg}
                      </p>
                    </div>

                    {resultMsg.includes("Network error") && (
                      <div className="mt-3 pt-3 border-t border-red-200">
                        <p className="text-xs font-medium text-red-600 mb-2">Get Help:</p>
                        <div className="flex flex-col gap-2">
                          <a
                            href={`mailto:${supportEmail}`}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-200 bg-white text-sm text-red-700 hover:bg-red-50 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            {supportEmail}
                          </a>
                          <a
                            href={`tel:${supportPhone.replace(/\s+/g, "")}`}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-200 bg-white text-sm text-red-700 hover:bg-red-50 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            {supportPhone}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {contactSuggest && (
                <div className="space-y-3">
                  <Support compact />
                  <button
                    onClick={() => validate(code)}
                    disabled={isLocked}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors"
                  >
                    Retry Validation
                  </button>
                </div>
              )}
            </div>
          </div>

            {/* Result / Preview (shown only after a successful validation) */}
            {preview ? (
              <div style={{width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box',overflowX:'hidden'}}>
                <div className="space-y-3" style={{width:'100%',maxWidth:'100%',boxSizing:'border-box'}}>

                  {/* ── Guest hero card ── */}
                  <div style={{width:'100%',maxWidth:'100%',boxSizing:'border-box',overflow:'hidden',borderRadius:'1rem',border:'1px solid rgba(2,102,94,0.3)'}}>
                    <div className="relative bg-[#02665e]" style={{padding:'1rem'}}>
                      <div className="pointer-events-none absolute inset-0 opacity-[0.06]"
                        style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
                      <div className="relative" style={{display:'flex',alignItems:'center',gap:'0.75rem',width:'100%',minWidth:0}}>
                        <div style={{height:'3rem',width:'3rem',borderRadius:'0.75rem',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <span style={{fontSize:'1.125rem',fontWeight:900,color:'white',userSelect:'none'}}>
                            {preview.personal.fullName.trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                          </span>
                        </div>
                        <div style={{flex:1,minWidth:0,overflow:'hidden'}}>
                          <div style={{fontSize:'0.625rem',fontWeight:600,color:'rgba(255,255,255,0.5)',textTransform:'uppercase',letterSpacing:'0.1em'}}>Validated guest</div>
                          <div style={{fontSize:'1rem',fontWeight:800,color:'white',lineHeight:1.2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{preview.personal.fullName}</div>
                          <div style={{fontSize:'0.75rem',color:'rgba(255,255,255,0.65)',marginTop:'2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{preview.property.title} · {preview.property.type}</div>
                        </div>
                        <span style={{flexShrink:0,maxWidth:'5rem',display:'inline-flex',alignItems:'center',borderRadius:'9999px',padding:'0.25rem 0.625rem',fontSize:'0.625rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',border:'1px solid',background: preview.booking.status === 'CHECKED_IN' ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.15)', borderColor: preview.booking.status === 'CHECKED_IN' ? 'rgba(110,231,183,0.4)' : 'rgba(255,255,255,0.25)', color: preview.booking.status === 'CHECKED_IN' ? 'rgb(209,250,229)' : 'white', overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                          {preview.booking.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                    <div style={{background:'#024d47',padding:'0.625rem 1rem',display:'flex',alignItems:'center',gap:'1.25rem'}}>
                      <div>
                        <div style={{fontSize:'0.5625rem',fontWeight:600,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Booking ID</div>
                        <div style={{fontSize:'0.875rem',fontWeight:700,color:'white'}}>#{preview.bookingId}</div>
                      </div>
                      <div style={{height:'1.25rem',width:'1px',background:'rgba(255,255,255,0.15)'}} />
                      <div>
                        <div style={{fontSize:'0.5625rem',fontWeight:600,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Property ID</div>
                        <div style={{fontSize:'0.875rem',fontWeight:700,color:'white'}}>#{preview.property.id}</div>
                      </div>
                    </div>
                  </div>

                  {/* ── Details card ── */}
                  <div style={{width:'100%',maxWidth:'100%',boxSizing:'border-box',overflow:'hidden',borderRadius:'1rem',border:'1px solid #e2e8f0',background:'white'}}>
                    <div style={{padding:'1rem 1rem 0.75rem'}}>
                      <div style={{fontSize:'0.625rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',color:'#94a3b8',marginBottom:'0.75rem'}}>Personal Details</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem',width:'100%',boxSizing:'border-box'}}>
                        <div style={{gridColumn:'1 / -1'}}><DataRow label="Full Name" value={preview.personal.fullName} /></div>
                        <DataRow label="Phone"       value={preview.personal.phone} />
                        <DataRow label="Nationality" value={preview.personal.nationality} />
                        <DataRow label="Sex"         value={preview.personal.sex} />
                        <DataRow label="Age Group"   value={preview.personal.ageGroup} />
                      </div>
                    </div>
                    <div style={{margin:'0 1rem',height:'1px',background:'#f1f5f9'}} />
                    <div style={{padding:'0.75rem 1rem'}}>
                      <div style={{fontSize:'0.625rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',color:'#94a3b8',marginBottom:'0.75rem'}}>Booking Details</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem',width:'100%',boxSizing:'border-box'}}>
                        <div style={{gridColumn:'1 / -1'}}><DataRow label="Room Type" value={preview.booking.roomType} /></div>
                        <DataRow label="Rooms"  value={String(preview.booking.rooms)} />
                        <DataRow label="Nights" value={String(preview.booking.nights)} />
                        <div style={{gridColumn:'1 / -1'}}><DataRow label="Amount" value={formatTZS(preview.booking.ownerBaseAmount ?? preview.booking.totalAmount)} highlight /></div>
                      </div>
                    </div>
                    <div style={{margin:'0 1rem',height:'1px',background:'#f1f5f9'}} />
                    <div style={{padding:'0.75rem 1rem 1rem',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem',width:'100%',boxSizing:'border-box'}}>
                      <div style={{borderRadius:'0.75rem',background:'#f0fdf4',border:'1px solid #d1fae5',padding:'0.625rem 0.75rem',boxSizing:'border-box',overflow:'hidden'}}>
                        <div style={{fontSize:'0.5625rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',color:'#059669',marginBottom:'0.25rem'}}>Check-in</div>
                        <div style={{fontSize:'0.75rem',fontWeight:700,color:'#064e3b',lineHeight:1.3}}>{formatDateTime(preview.booking.checkIn)}</div>
                      </div>
                      <div style={{borderRadius:'0.75rem',background:'#f0f9ff',border:'1px solid #bae6fd',padding:'0.625rem 0.75rem',boxSizing:'border-box',overflow:'hidden'}}>
                        <div style={{fontSize:'0.5625rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',color:'#0284c7',marginBottom:'0.25rem'}}>Check-out</div>
                        <div style={{fontSize:'0.75rem',fontWeight:700,color:'#0c4a6e',lineHeight:1.3}}>{formatDateTime(preview.booking.checkOut)}</div>
                      </div>
                    </div>
                  </div>

                  {/* ── Action card ── */}
                  <div style={{position:'relative',width:'100%',maxWidth:'100%',boxSizing:'border-box',borderRadius:'1rem',border:'1px solid #e2e8f0',background:'white',padding:'1rem'}}>
                    <button
                      onClick={() => { setPreview(null); setCode(""); setResultMsg(null); setEligibility(null); }}
                      style={{position:'absolute',top:'0.75rem',right:'0.75rem',height:'2rem',width:'2rem',display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'0.625rem',border:'1px solid #fca5a5',background:'#fef2f2',color:'#ef4444',cursor:'pointer'}}
                      aria-label="Clear result"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                    {!eligibility?.canValidate && eligibility?.reason ? (
                      <div style={{marginBottom:'0.75rem',paddingRight:'2rem',borderRadius:'0.75rem',border:'1px solid #fde68a',background:'#fffbeb',padding:'0.625rem 0.75rem',fontSize:'0.875rem',color:'#92400e',boxSizing:'border-box'}}>
                        {eligibility.reason}
                      </div>
                    ) : null}
                    <button
                      onClick={() => { setConfirmOpen(true); setAgreeTerms(false); setAgreeDisbursement(false); }}
                      disabled={loading || (eligibility ? !eligibility.canValidate : false)}
                      style={{width:'100%',padding:'0.75rem 1rem',borderRadius:'0.75rem',background:'#02665e',color:'white',fontSize:'0.875rem',fontWeight:700,border:'none',cursor:'pointer',boxSizing:'border-box',opacity: (loading || (eligibility ? !eligibility.canValidate : false)) ? 0.5 : 1}}
                    >
                      ✓ Confirm Check-in
                    </button>
                    <p style={{marginTop:'0.625rem',fontSize:'0.6875rem',color:'#94a3b8',textAlign:'center'}}>
                      Marks code as <strong style={{color:'#64748b'}}>USED</strong> · moves guest to <strong style={{color:'#64748b'}}>Checked-In</strong>
                    </p>
                  </div>

                </div>
              </div>
            ) : null}
          </div>{/* end grid */}
        </div>{/* end py-4 */}

        {/* QR Scan Modal */}
        {scanOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setScanOpen(false)}
            />
            <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-5 sm:p-6 z-10 animate-in zoom-in-95 duration-300 space-y-4 border border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-slate-900">Scan Receipt QR</div>
                  <div className="text-xs text-slate-500">Point your camera at the QR code on the guest’s receipt</div>
                </div>
                <button
                  type="button"
                  onClick={() => setScanOpen(false)}
                  className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                  aria-label="Close scanner"
                  title="Close"
                >
                  <X className="h-4 w-4 text-slate-700" aria-hidden />
                </button>
              </div>

              {scanError && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {scanError}
                </div>
              )}

              <div className="rounded-2xl overflow-hidden border border-slate-200 bg-black/5">
                <div className="relative aspect-video bg-black">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-6 rounded-2xl border-2 border-white/70 shadow-[0_0_0_2000px_rgba(0,0,0,0.15)]" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{scanActive ? "Scanning…" : "Camera stopped"}</span>
                <button
                  type="button"
                  onClick={() => { stopScanner(); startScanner(); }}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-xs font-semibold"
                >
                  Restart
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation modal with backdrop blur */}
        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div 
              className="absolute inset-0 bg-black/50 backdrop-blur-sm" 
              onClick={() => setConfirmOpen(false)}
            />
            <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 z-10 animate-in zoom-in-95 duration-300 space-y-4">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                  <FileCheck2 className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Confirm Check-in</h3>
              </div>
              
              <p className="text-sm text-slate-600 leading-relaxed">
                You are about to confirm check-in for <strong className="font-semibold text-slate-800">{preview?.personal.fullName}</strong> at <strong className="font-semibold text-slate-800">{preview?.property.title}</strong>. By confirming, this guest will be moved to Checked-In and this action will be recorded.
              </p>

              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={agreeTerms} 
                    onChange={(e) => setAgreeTerms(e.target.checked)} 
                    className="mt-0.5 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-colors"
                  />
                  <span className="text-sm text-slate-700 group-hover:text-slate-900 transition-colors">
                    I have read and agree to the{' '}
                    <a 
                      className="text-emerald-600 hover:text-emerald-700 font-medium underline underline-offset-2" 
                      href={process.env.NEXT_PUBLIC_TERMS_URL ?? '#'} 
                      target="_blank" 
                      rel="noreferrer"
                    >
                      Terms &amp; Conditions
                    </a>.
                  </span>
                </label>
                <label className="mt-3 flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={agreeDisbursement}
                    onChange={(e) => setAgreeDisbursement(e.target.checked)}
                    className="mt-0.5 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-colors"
                  />
                  <span className="text-sm text-slate-700 group-hover:text-slate-900 transition-colors">
                    I have read and agree to the{" "}
                    <a
                      className="text-emerald-600 hover:text-emerald-700 font-medium underline underline-offset-2"
                      href={(process.env.NEXT_PUBLIC_DISBURSEMENT_POLICY_URL ?? process.env.NEXT_PUBLIC_PAYOUT_POLICY_URL ?? "#")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Disbursement Policy
                    </a>.
                  </span>
                </label>
              </div>

              {resultMsg && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 animate-in fade-in duration-200">
                  {resultMsg}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button 
                  className="flex-1 px-4 py-2.5 rounded-xl border-2 border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50 hover:border-slate-300 transition-all duration-200" 
                  onClick={() => setConfirmOpen(false)} 
                  disabled={confirmLoading}
                >
                  Cancel
                </button>
                <button 
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 text-white font-semibold shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]" 
                  onClick={handleConfirmWithConsent} 
                  disabled={confirmLoading || !agreeTerms || !agreeDisbursement}
                >
                  {confirmLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Confirming...
                    </span>
                  ) : (
                    'Confirm Check-in'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

function DataRow({ label, value, highlight, span }: { label: string; value: string; highlight?: boolean; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
      <div className={`mt-0.5 text-[13px] font-semibold leading-snug break-words ${highlight ? 'text-[#02665e]' : 'text-slate-900'}`}>
        {value || '—'}
      </div>
    </div>
  );
}

