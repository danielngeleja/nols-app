"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BedDouble,
  CalendarX2,
  Clock,
  Globe2,
  Loader2,
  Lock,
  Mail,
  Phone,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import Support from "@/components/Support";
import apiClient from "@/lib/apiClient";
import { useRouter } from "next/navigation";

const api = apiClient;
const BOOKING_TIME_ZONE = "Africa/Dar_es_Salaam";

type Preview = {
  bookingId: number;
  bookingReference: string;
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
  const [codeFocused, setCodeFocused] = useState(true);
  // When the pass was loaded; places "today" on the stay timeline.
  const [viewedAt, setViewedAt] = useState(0);
  const debounceRef = useRef<number | null>(null);

  const lockedMs = lockedUntil ? Math.max(0, lockedUntil - nowMs) : 0;
  const isLocked = lockedMs > 0;
  const lockSeconds = Math.ceil(lockedMs / 1000);
  const lockMinutesPart = Math.floor(lockSeconds / 60);
  const lockSecondsPart = lockSeconds % 60;
  const lockCountdown = isLocked ? `${lockMinutesPart}:${String(lockSecondsPart).padStart(2, "0")}` : null;

  // NRMS passes an opaque reference; the authenticated API resolves it to the
  // arrival context so names survive refreshes without entering the URL.
  const [handoff, setHandoff] = useState<{
    reference: string | null;
    guestName: string | null;
    propertyName: string | null;
    checkIn: string | null;
    returnTo: string | null;
  }>({
    reference: null,
    guestName: null,
    propertyName: null,
    checkIn: null,
    returnTo: null,
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = String(params.get("handoff") || "").trim() || null;
    const returnTo = params.get("return");
    const safeReturnTo = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : null;
    setHandoff({
      reference,
      guestName: null,
      propertyName: null,
      checkIn: null,
      returnTo: safeReturnTo,
    });
    if (!reference) return;

    let active = true;
    api.get<{ reference: string; guestName: string; propertyName: string; checkIn: string }>(
      `/api/owner/bookings/handoff/${encodeURIComponent(reference)}`,
    ).then(({ data }) => {
      if (!active) return;
      setHandoff({
        reference: data.reference,
        guestName: data.guestName,
        propertyName: data.propertyName,
        checkIn: data.checkIn,
        returnTo: safeReturnTo,
      });
    }).catch(() => {
      if (active) setResultMsg("The front desk arrival could not be loaded. Return to NRMS and open it again.");
    });
    return () => { active = false; };
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
      setViewedAt(Date.now());
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

  // Confirm state: the Disbursement Policy is agreed on the arrival pass itself.
  const [agreeDisbursement, setAgreeDisbursement] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [roomNeeded, setRoomNeeded] = useState<{ href: string } | null>(null);

  // QR scan modal
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanActive, setScanActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  async function handleConfirmWithConsent() {
    if (!preview) return;
    if (!agreeDisbursement) return setResultMsg("Agree to the Disbursement Policy to continue.");
    setConfirmLoading(true);
    setResultMsg(null);
    setRoomNeeded(null);
    try {
      const payload = {
        bookingId: preview.bookingId,
        code,
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
          nationality: preview.personal.nationality
        }
      };
      await api.post('/api/owner/bookings/confirm-checkin', payload);

      // notify sidebar (and any listeners) to refresh checked-in counts immediately
      window.dispatchEvent(new Event("nols:checkedin-changed"));
      // Back to whoever sent us here: the NRMS front desk when the arrival was
      // started there, otherwise the checked-in list as before.
      // The opaque reference lets Guests in house show a one-time success banner.
      router.push(handoff.returnTo ?? `/owner/bookings/checked-in?checkedIn=${encodeURIComponent(preview.bookingReference)}`);
    } catch (err: any) {
      const data = err?.response?.data ?? {};
      if (data.code === "ROOM_ASSIGNMENT_REQUIRED") {
        // NRMS properties need a physical room before arrival is committed.
        // Send the owner straight to the reservation instead of a dead end.
        setRoomNeeded({
          href: handoff.returnTo
            ?? (data.reservationReference ? `/owner/nrms/reservations?reservation=${encodeURIComponent(data.reservationReference)}` : "/owner/nrms/reservations"),
        });
        setResultMsg(null);
      } else {
        setResultMsg(data.error ?? 'Could not confirm check-in');
      }
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
    // Only a code-bearing QR is check-in proof. Receipt QR booking IDs are not.
    if (v.startsWith("{")) {
      try {
        const parsed = JSON.parse(v);
        const presented = String(parsed?.checkinCode || parsed?.bookingCode || parsed?.code || "").trim();
        return /^[A-Z0-9]{8}$/i.test(presented) ? presented : "";
      } catch { return ""; }
    }
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
            if (!normalized) {
              setScanError("This receipt QR does not contain the guest's check-in code. Ask the guest to present it.");
              stopScanner();
              return;
            }
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

  const formatStayDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        timeZone: BOOKING_TIME_ZONE,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
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

  const canConfirm = !loading && (eligibility ? eligibility.canValidate : true);
  const clearResult = () => { setPreview(null); setCode(""); setResultMsg(null); setEligibility(null); setLastValidated(null); setAgreeDisbursement(false); setRoomNeeded(null); };
  const initials = preview
    ? preview.personal.fullName.trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : "";
  const isQrCode = code.trim().startsWith("{");
  const cells = Array.from({ length: 8 }, (_, i) => (isQrCode ? "" : code.toUpperCase()[i] ?? ""));
  const activeCell = isQrCode ? -1 : Math.min(code.length, 7);

  // One verdict for the whole pass, so the owner reads the answer before the details.
  const verdict = (() => {
    if (!preview) return null;
    if (preview.booking.status === "CHECKED_IN") return { tone: "done", Icon: UserCheck, title: "Already checked in", body: "This guest's arrival is already recorded." };
    switch (eligibility?.status) {
      case "BEFORE_CHECKIN": return { tone: "wait", Icon: Clock, title: "Too early", body: eligibility.reason };
      case "AFTER_CHECKOUT": return { tone: "stop", Icon: CalendarX2, title: "Stay has ended", body: eligibility.reason };
      case "CODE_NOT_ACTIVE": return { tone: "stop", Icon: ShieldAlert, title: "Code not active", body: eligibility.reason };
      case "INVALID_DATES": return { tone: "wait", Icon: AlertTriangle, title: "Dates need review", body: eligibility.reason };
      default: return { tone: "go", Icon: ShieldCheck, title: "Ready to check in", body: "The code matches this booking and today is inside the stay." };
    }
  })();
  // Each verdict carries its own material: a lit gradient stub, a matching
  // rubber stamp on the pass, and a tinted timeline.
  const toneStyle = {
    go: {
      stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#0f8a7e_0%,#02665e_42%,#013c37_100%)]",
      ring: "bg-white/10 text-[#5eead4] ring-1 ring-inset ring-white/20",
      label: "text-[#9fd8cc]",
      stamp: "VERIFIED",
      ink: "text-[#02665e] border-[#02665e]",
      wash: "from-emerald-50/70",
      bar: "bg-[#02665e]",
      today: "text-[#02665e]",
      note: "",
    },
    done: {
      stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#0b4b44_0%,#012a26_55%,#00140f_100%)]",
      ring: "bg-white/10 text-[#5eead4] ring-1 ring-inset ring-white/15",
      label: "text-[#9fd8cc]",
      stamp: "CHECKED IN",
      ink: "text-[#012a26] border-[#012a26]",
      wash: "from-slate-50",
      bar: "bg-[#012a26]",
      today: "text-slate-700",
      note: "bg-slate-50 text-slate-600 ring-slate-200",
    },
    wait: {
      stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#d97706_0%,#92400e_45%,#451a03_100%)]",
      ring: "bg-white/10 text-amber-200 ring-1 ring-inset ring-amber-200/25",
      label: "text-amber-200/90",
      stamp: "TOO EARLY",
      ink: "text-amber-700 border-amber-600",
      wash: "from-amber-50/80",
      bar: "bg-[repeating-linear-gradient(135deg,#f59e0b_0_6px,#fbbf24_6px_12px)]",
      today: "text-amber-700",
      note: "bg-amber-50 text-amber-900 ring-amber-200",
    },
    stop: {
      stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#c0262d_0%,#8a1c22_40%,#3d0a0e_100%)]",
      ring: "bg-white/10 text-rose-100 ring-1 ring-inset ring-rose-200/25",
      label: "text-rose-200/90",
      stamp: "STAY ENDED",
      ink: "text-rose-700 border-rose-600",
      wash: "from-rose-50/80",
      bar: "bg-[repeating-linear-gradient(135deg,#e11d48_0_6px,#f43f5e_6px_12px)]",
      today: "text-rose-700",
      note: "bg-rose-50 text-rose-900 ring-rose-200",
    },
  } as const;
  const tone = verdict ? toneStyle[verdict.tone as keyof typeof toneStyle] : toneStyle.go;

  // Where today sits on the stay, from 0 (check-in) to 1 (check-out).
  const stayStart = preview ? new Date(preview.booking.checkIn).getTime() : 0;
  const stayEnd = preview ? new Date(preview.booking.checkOut).getTime() : 0;
  const todayPos = preview && viewedAt && stayEnd > stayStart ? (viewedAt - stayStart) / (stayEnd - stayStart) : null;
  const DAY = 86_400_000;
  const daysAfter = preview && viewedAt ? Math.floor((viewedAt - stayEnd) / DAY) : 0;
  const daysBefore = preview && viewedAt ? Math.ceil((stayStart - viewedAt) / DAY) : 0;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const todayLabel =
    todayPos === null
      ? null
      : todayPos < 0
        ? daysBefore > 0 ? `Today, ${plural(daysBefore, "day")} before check-in` : "Today, before check-in"
        : todayPos > 1
          ? daysAfter > 0 ? `Today, ${plural(daysAfter, "day")} after check-out` : "Today, after check-out"
          : "Today, inside the stay";
  // A short, large figure for the stub: how far off the stay is.
  const stubFigure =
    todayPos === null ? null : todayPos > 1 && daysAfter > 0 ? { n: daysAfter, unit: daysAfter === 1 ? "day since check-out" : "days since check-out" }
      : todayPos < 0 && daysBefore > 0 ? { n: daysBefore, unit: daysBefore === 1 ? "day to check-in" : "days to check-in" }
        : null;
  const titleCase = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

  return (
    <div id="checkin-validate" className="w-full min-w-0 space-y-5 pb-12">
      <style>{`
        #checkin-validate, #checkin-validate * { box-sizing: border-box; }
        @keyframes cv-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        @keyframes cv-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        #checkin-validate .cv-caret { animation: cv-blink 1s step-end infinite; }
        #checkin-validate .cv-rise { animation: cv-rise .35s cubic-bezier(.2,.7,.2,1) both; }
      `}</style>

      {/* ── Console: the code is entered inside the band itself ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 75% 40%, #000 0%, transparent 70%)", WebkitMaskImage: "radial-gradient(ellipse at 75% 40%, #000 0%, transparent 70%)" }}
          aria-hidden
        />
        <div className="relative grid gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Front desk</p>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isConnected ? "bg-[#5eead4]/10 text-[#5eead4]" : isConnected === false ? "bg-amber-300/10 text-amber-200" : "bg-white/5 text-white/50"
                }`}
                aria-live="polite"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-[#5eead4]" : isConnected === false ? "bg-amber-300" : "animate-pulse bg-white/40"}`} />
                {isConnected ? "Online" : isConnected === false ? "Offline" : "Connecting"}
              </span>
            </div>
            <h1 className="m-0 mt-2 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[34px]">
              Welcome the guest in.
            </h1>
            <p className="m-0 mt-2 max-w-md text-sm leading-relaxed text-white/60">
              Ask the guest to present their 8 character check-in code. A QR can be used only if it contains that code. You will see an arrival pass before confirming.
            </p>

            {handoff.reference ? (
              <div className="mt-5 flex max-w-md items-start gap-3 rounded-2xl border border-solid border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9fd8cc]">NRMS front desk arrival</p>
                  <p className="m-0 mt-0.5 truncate text-sm font-semibold text-white">
                    {handoff.guestName ? `Check in ${handoff.guestName}` : "Loading guest details..."}
                  </p>
                  {handoff.propertyName ? (
                    <p className="m-0 text-xs text-white/50">
                      {handoff.propertyName}{handoff.checkIn ? ` · ${formatStayDate(handoff.checkIn)}` : ""}
                    </p>
                  ) : null}
                </div>
                {handoff.returnTo ? (
                  <a href={handoff.returnTo} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-white/70 no-underline hover:text-white">
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Front desk
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Code cells over a single real input */}
          <div className="min-w-0">
            <label htmlFor="checkin-input" className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Booking code
            </label>
            <div className="flex items-stretch gap-2.5">
              <div className="relative min-w-0 flex-1">
                <div className="grid grid-cols-8 gap-1.5 sm:gap-2" aria-hidden>
                  {cells.map((ch, i) => {
                    const isActive = codeFocused && !isLocked && i === activeCell && !(code.length >= 8);
                    return (
                      <span
                        key={i}
                        className={`relative grid h-14 place-items-center rounded-xl border border-solid font-mono text-2xl font-bold transition-colors sm:h-16 sm:w-12 sm:text-[28px] ${
                          isLocked
                            ? "border-white/5 bg-white/[0.02] text-white/20"
                            : ch
                              ? "border-[#5eead4]/40 bg-[#5eead4]/[0.08] text-white"
                              : isActive
                                ? "border-[#5eead4] bg-white/[0.06] text-white"
                                : "border-white/10 bg-white/[0.04] text-white/20"
                        } ${i === 3 ? "mr-1 sm:mr-2" : ""}`}
                      >
                        {ch || (isActive ? <span className="cv-caret h-7 w-0.5 rounded bg-[#5eead4]" /> : <span className="h-1 w-1 rounded-full bg-white/20" />)}
                      </span>
                    );
                  })}
                </div>
                <input
                  id="checkin-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\s+/g, ""))}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  onPaste={(e) => {
                    if (isLocked) return;
                    const pasted = e.clipboardData?.getData("text") ?? "";
                    if (pasted) {
                      e.preventDefault();
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
                  className="absolute inset-0 h-full w-full cursor-text rounded-xl border-0 bg-transparent p-0 text-transparent caret-transparent outline-none selection:bg-transparent"
                  autoFocus
                  maxLength={isQrCode ? undefined : 8}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-describedby="checkin-hint"
                />
              </div>
              <button
                type="button"
                onClick={() => { setScanOpen(true); setScanError(null); }}
                disabled={isLocked}
                className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-solid border-[#5eead4]/40 bg-[#5eead4] text-[#012a26] transition hover:bg-[#8ff3e1] disabled:cursor-not-allowed disabled:opacity-40 sm:h-16 sm:w-16"
                aria-label="Scan receipt QR"
                title="Scan receipt QR"
              >
                <ScanLine className="h-6 w-6" aria-hidden />
              </button>
            </div>
            <div id="checkin-hint" className="mt-2.5 flex min-h-[20px] items-center justify-between gap-3 text-[11px] text-white/45">
              {isLocked && lockCountdown ? (
                <span className="font-semibold text-amber-200" role="status" aria-live="polite">
                  Too many invalid attempts. Try again in <span className="tabular-nums">{lockCountdown}</span>.
                </span>
              ) : loading ? (
                <span className="inline-flex items-center gap-1.5 text-[#9fd8cc]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {searching ? "Still searching..." : attempting ? "Checking the code..." : "Validating..."}
                </span>
              ) : isQrCode ? (
                <span className="text-[#9fd8cc]">Receipt QR read. Checking it now.</span>
              ) : (
                <span>QR scanning works in Chrome or Edge on mobile.</span>
              )}
              {!isLocked && typeof remainingAttempts === "number" ? (
                <span className="shrink-0" aria-live="polite">
                  <span className="font-semibold text-white">{remainingAttempts}</span> attempts left
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {/* ── Problems reaching or reading the code ── */}
      {contactSuggest && !loading && (
        <div className="rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This is taking unusually long. If it still does not return a result, please contact support below.
        </div>
      )}

      {resultMsg && !preview && !isLocked && (() => {
        const offline = resultMsg.includes("Network error");
        const shown = isQrCode ? "QR" : code.trim().toUpperCase();
        const retry = () => {
          setResultMsg(null);
          setCode("");
          window.setTimeout(() => document.getElementById("checkin-input")?.focus(), 0);
        };
        return (
          <article
            className="cv-rise relative flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_30px_70px_-42px_rgba(61,10,14,0.55)] ring-1 ring-slate-200 md:flex-row"
            role="alert"
            aria-live="polite"
          >
            {/* Stub */}
            <div
              className={`relative isolate flex flex-col justify-between gap-6 overflow-hidden p-6 text-white md:w-[300px] md:shrink-0 ${
                offline
                  ? "bg-[radial-gradient(130%_90%_at_0%_0%,#475569_0%,#1e293b_45%,#0b1120_100%)]"
                  : "bg-[radial-gradient(130%_90%_at_0%_0%,#c0262d_0%,#8a1c22_40%,#3d0a0e_100%)]"
              }`}
            >
              <div
                className="pointer-events-none absolute inset-0 -z-10 opacity-[0.09]"
                style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "14px 14px" }}
                aria-hidden
              />
              <span className="pointer-events-none absolute -left-16 -top-16 -z-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
              {offline ? (
                <WifiOff className="pointer-events-none absolute -bottom-8 -right-8 -z-10 h-44 w-44 rotate-[-12deg] text-white/[0.07]" strokeWidth={1.25} aria-hidden />
              ) : (
                <ShieldAlert className="pointer-events-none absolute -bottom-8 -right-8 -z-10 h-44 w-44 rotate-[-12deg] text-white/[0.07]" strokeWidth={1.25} aria-hidden />
              )}

              <div>
                <p className={`m-0 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] ${offline ? "text-slate-300" : "text-rose-200/90"}`}>
                  <span className="h-px w-5 bg-current opacity-60" aria-hidden />
                  Arrival pass
                </p>
                <span className="mt-5 grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/20 backdrop-blur-sm">
                  {offline ? <WifiOff className="h-7 w-7" aria-hidden /> : <ShieldAlert className="h-7 w-7" aria-hidden />}
                </span>
                <h2 className="m-0 mt-5 text-[26px] font-bold leading-[1.1] tracking-tight text-white drop-shadow-sm">
                  {offline ? "Could not reach NoLSAF" : "No booking found"}
                </h2>
                <p className="m-0 mt-3 text-[13px] leading-relaxed text-white/75">
                  {offline ? "The code was not checked. Nothing was used up." : "Nothing was confirmed and no guest was checked in."}
                </p>
              </div>

              {shown ? (
                <div className="rounded-xl bg-black/20 px-3 py-2.5 ring-1 ring-inset ring-white/10">
                  <p className={`m-0 text-[9px] font-semibold uppercase tracking-[0.18em] ${offline ? "text-slate-300" : "text-rose-200/90"}`}>Code entered</p>
                  <p className={`m-0 mt-1 font-mono text-lg font-bold tracking-[0.3em] text-white/90 ${offline ? "" : "line-through decoration-rose-300/80 decoration-2"}`}>{shown}</p>
                </div>
              ) : null}
            </div>

            {/* Perforation */}
            <div className="relative hidden w-0 md:block" aria-hidden>
              <span className="absolute -left-3.5 -top-3.5 z-10 h-7 w-7 rounded-full bg-[#f4f5f4] shadow-[inset_0_-1px_0_rgba(15,23,42,0.08)]" />
              <span className="absolute -bottom-3.5 -left-3.5 z-10 h-7 w-7 rounded-full bg-[#f4f5f4] shadow-[inset_0_1px_0_rgba(15,23,42,0.08)]" />
              <span className="absolute inset-y-5 left-0 border-0 border-l-2 border-dashed border-slate-200" />
            </div>

            {/* Body */}
            <div className={`relative min-w-0 flex-1 bg-gradient-to-br ${offline ? "from-slate-50" : "from-rose-50/80"} via-white to-white p-6`}>
              <div
                className={`pointer-events-none absolute right-6 top-5 hidden rotate-[-9deg] select-none rounded-lg border-[3px] border-double px-3 py-1.5 text-center opacity-80 mix-blend-multiply sm:block ${
                  offline ? "border-slate-500 text-slate-600" : "border-rose-600 text-rose-700"
                }`}
                aria-hidden
              >
                <p className="m-0 text-[15px] font-black uppercase leading-none tracking-[0.18em]">{offline ? "OFFLINE" : "NOT FOUND"}</p>
                <p className="m-0 mt-1 text-[8px] font-bold uppercase tracking-[0.3em] opacity-80">NoLSAF front desk</p>
              </div>

              <div className="sm:pr-44">
                <p className="m-0 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  {offline ? "Check your connection and try again" : "We could not match this code"}
                </p>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  {offline ? "Your device could not reach the NoLSAF servers." : `${resultMsg.replace(/\.\s*$/, "")}. Check it with the guest before trying again.`}
                </p>
              </div>

              {offline ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <a href={`mailto:${supportEmail}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-semibold text-slate-700 no-underline ring-1 ring-slate-200 hover:bg-slate-50">
                    <Mail className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {supportEmail}
                  </a>
                  <a href={`tel:${supportPhone.replace(/\s+/g, "")}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-semibold text-slate-700 no-underline ring-1 ring-slate-200 hover:bg-slate-50">
                    <Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {supportPhone}
                  </a>
                </div>
              ) : (
                <ul className="m-0 mt-5 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
                  {[
                    { title: "Look-alike characters", body: "0 and O, 1 and I, 5 and S are easy to mix up." },
                    { title: "Another property", body: "The code only works at the property it was booked for." },
                    { title: "Old or cancelled booking", body: "Ask the guest to open their latest booking receipt." },
                  ].map((tip) => (
                    <li key={tip.title} className="rounded-2xl bg-white/80 p-3.5 ring-1 ring-slate-200/80">
                      <p className="m-0 text-xs font-semibold text-slate-800">{tip.title}</p>
                      <p className="m-0 mt-1 text-[11px] leading-relaxed text-slate-500">{tip.body}</p>
                    </li>
                  ))}
                </ul>
              )}

              {typeof remainingAttempts === "number" && !offline ? (
                <p className="m-0 mt-4 inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-800 ring-1 ring-inset ring-rose-200">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  {remainingAttempts === 1 ? "1 attempt left" : `${remainingAttempts} attempts left`} before a short lockout
                </p>
              ) : null}

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={offline ? () => validate(code) : retry}
                  className="group inline-flex h-12 flex-1 items-center justify-between gap-2 rounded-xl border border-solid border-[#012a26] bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white shadow-[0_14px_30px_-18px_rgba(1,42,38,0.9)] transition hover:bg-[#02665e]"
                >
                  {offline ? "Try again" : "Enter the code again"}
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5eead4] text-[#012a26] transition group-hover:translate-x-0.5">
                    <RotateCcw className="h-4 w-4" aria-hidden />
                  </span>
                </button>
                {!offline && (
                  <button
                    type="button"
                    onClick={() => { setResultMsg(null); setScanOpen(true); setScanError(null); }}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-solid border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <ScanLine className="h-4 w-4" aria-hidden />
                    Scan the receipt QR
                  </button>
                )}
              </div>
            </div>
          </article>
        );
      })()}

      {contactSuggest && (
        <div className="space-y-3">
          <Support compact />
          <button
            type="button"
            onClick={() => validate(code)}
            disabled={isLocked}
            className="h-10 w-full rounded-xl border border-solid border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Retry validation
          </button>
        </div>
      )}

      {/* ── Arrival pass ── */}
      {preview && verdict ? (
        <article key={preview.bookingReference} className="cv-rise relative flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_30px_70px_-42px_rgba(1,42,38,0.6)] ring-1 ring-slate-200 md:flex-row">
          {/* Stub: the verdict */}
          <div className={`relative isolate flex flex-col justify-between gap-6 overflow-hidden p-6 text-white md:w-[300px] md:shrink-0 ${tone.stub}`}>
            <div
              className="pointer-events-none absolute inset-0 -z-10 opacity-[0.09]"
              style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "14px 14px" }}
              aria-hidden
            />
            <span className="pointer-events-none absolute -left-16 -top-16 -z-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
            <verdict.Icon className="pointer-events-none absolute -bottom-8 -right-8 -z-10 h-44 w-44 rotate-[-12deg] text-white/[0.07]" strokeWidth={1.25} aria-hidden />

            <div>
              <p className={`m-0 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] ${tone.label}`}>
                <span className="h-px w-5 bg-current opacity-60" aria-hidden />
                Arrival pass
              </p>
              <span className={`mt-5 grid h-14 w-14 place-items-center rounded-2xl shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm ${tone.ring}`}>
                <verdict.Icon className="h-7 w-7" aria-hidden />
              </span>
              <h2 className="m-0 mt-5 text-[26px] font-bold leading-[1.1] tracking-tight text-white drop-shadow-sm">{verdict.title}</h2>
              {stubFigure ? (
                <p className="m-0 mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-bold tabular-nums leading-none text-white">{stubFigure.n}</span>
                  <span className={`text-xs font-semibold ${tone.label}`}>{stubFigure.unit}</span>
                </p>
              ) : null}
              <p className="m-0 mt-3 text-[13px] leading-relaxed text-white/75">{verdict.body}</p>
            </div>
            <div className="rounded-xl bg-black/15 px-3 py-2.5 ring-1 ring-inset ring-white/10">
              <p className={`m-0 text-[9px] font-semibold uppercase tracking-[0.18em] ${tone.label}`}>Reference</p>
              <p className="m-0 mt-1 break-all font-mono text-[11px] text-white/90">{preview.bookingReference}</p>
            </div>
          </div>

          {/* Perforation */}
          <div className="relative hidden w-0 md:block" aria-hidden>
            <span className="absolute -left-3.5 -top-3.5 z-10 h-7 w-7 rounded-full bg-[#f4f5f4] shadow-[inset_0_-1px_0_rgba(15,23,42,0.08)]" />
            <span className="absolute -bottom-3.5 -left-3.5 z-10 h-7 w-7 rounded-full bg-[#f4f5f4] shadow-[inset_0_1px_0_rgba(15,23,42,0.08)]" />
            <span className="absolute inset-y-5 left-0 border-0 border-l-2 border-dashed border-slate-200" />
          </div>

          {/* Body: who, when, how much */}
          <div className={`relative min-w-0 flex-1 bg-gradient-to-br ${tone.wash} via-white to-white p-6`}>
            {/* Rubber stamp */}
            <div
              className={`pointer-events-none absolute right-6 top-5 hidden rotate-[-9deg] select-none rounded-lg border-[3px] border-double px-3 py-1.5 text-center opacity-80 mix-blend-multiply sm:block ${tone.ink}`}
              aria-hidden
            >
              <p className="m-0 text-[15px] font-black uppercase leading-none tracking-[0.18em]">{tone.stamp}</p>
              <p className="m-0 mt-1 text-[8px] font-bold uppercase tracking-[0.3em] opacity-80">NoLSAF front desk</p>
            </div>

            <div className="flex min-w-0 items-center gap-3.5 sm:pr-44">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 text-lg font-bold text-white shadow-[0_10px_24px_-14px_rgba(15,23,42,0.9)] select-none">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="m-0 truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{preview.personal.fullName}</p>
                <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-sm text-slate-500">
                  <BedDouble className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  {preview.property.title} · {titleCase(preview.property.type)}
                </p>
              </div>
            </div>

            {/* Guest facts and the amount */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {[
                { Icon: Phone, value: preview.personal.phone },
                { Icon: Globe2, value: preview.personal.nationality },
                { Icon: UserRound, value: [preview.personal.sex, preview.personal.ageGroup].filter((v) => v && v !== "-").join(" · ") },
              ]
                .filter((c) => c.value && c.value !== "-")
                .map((c) => (
                  <span key={c.value} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                    <c.Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    {c.value}
                  </span>
                ))}
              <span className="ml-auto text-right">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Your amount</span>
                <span className="block text-lg font-bold tabular-nums text-[#02665e]">{formatTZS(preview.booking.ownerBaseAmount ?? preview.booking.totalAmount)}</span>
              </span>
            </div>

            {/* Stay timeline */}
            <div className="mt-5 rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200/80 backdrop-blur-sm">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Check-in</p>
                  <p className="m-0 mt-0.5 text-sm font-bold text-slate-900">{formatStayDate(preview.booking.checkIn)}</p>
                </div>
                <p className="m-0 hidden pb-0.5 text-xs font-semibold text-slate-500 sm:block">
                  {plural(preview.booking.nights, "night")} · {plural(preview.booking.rooms, "room")}
                  {preview.booking.roomType && preview.booking.roomType !== "-" ? ` · ${preview.booking.roomType}` : ""}
                </p>
                <div className="text-right">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Check-out</p>
                  <p className="m-0 mt-0.5 text-sm font-bold text-slate-900">{formatStayDate(preview.booking.checkOut)}</p>
                </div>
              </div>
              <div className="relative mt-4 h-2.5 rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`}
                  style={{ width: `${Math.round(Math.max(0, Math.min(1, todayPos ?? 0)) * 100)}%` }}
                />
                {todayPos !== null && (
                  <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${Math.max(0, Math.min(1, todayPos)) * 100}%` }}>
                    {(verdict.tone === "stop" || verdict.tone === "wait") && (
                      <span className={`absolute inset-0 -m-1.5 animate-ping rounded-full opacity-30 ${verdict.tone === "stop" ? "bg-rose-500" : "bg-amber-500"}`} />
                    )}
                    <span className="relative block h-5 w-5 rounded-full border-[3px] border-solid border-white bg-slate-900 shadow-md" />
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3">
                {todayLabel ? <p className={`m-0 text-[11px] font-semibold ${tone.today}`}>{todayLabel}</p> : <span />}
                <p className="m-0 text-[11px] font-semibold text-slate-500 sm:hidden">{plural(preview.booking.nights, "night")}</p>
              </div>
            </div>

            {/* Actions: the Disbursement Policy is agreed right here, then one tap confirms. */}
            {canConfirm && verdict.tone === "go" ? (
              <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl bg-white/80 px-4 py-3 ring-1 ring-inset ring-slate-200 transition hover:ring-[#02665e]/40">
                <input
                  type="checkbox"
                  checked={agreeDisbursement}
                  onChange={(e) => setAgreeDisbursement(e.target.checked)}
                  className="h-5 w-5 shrink-0 cursor-pointer accent-[#02665e]"
                />
                <span className="text-sm text-slate-700">
                  I agree to the NoLSAF{" "}
                  <a
                    href={process.env.NEXT_PUBLIC_DISBURSEMENT_POLICY_URL ?? "/owner/property-owner-disbursement-policy"}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="font-semibold text-[#02665e] underline underline-offset-2"
                  >
                    Disbursement Policy
                  </a>
                </span>
              </label>
            ) : null}

            {roomNeeded && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
                <span className="flex items-center gap-2">
                  <BedDouble className="h-4 w-4 shrink-0" aria-hidden />
                  Assign a specific room in NRMS before checking this guest in. The code was not used.
                </span>
                <a href={roomNeeded.href} className="inline-flex items-center gap-1 font-semibold text-amber-900 underline underline-offset-2">
                  Assign the room <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
            )}
            {resultMsg && (
              <div className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-800 ring-1 ring-inset ring-rose-200" role="alert">{resultMsg}</div>
            )}

            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-stretch">
              <button
                type="button"
                onClick={clearResult}
                disabled={confirmLoading}
                className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border border-solid border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden />
                New code
              </button>
              {canConfirm && verdict.tone === "go" ? (
                <button
                  type="button"
                  onClick={handleConfirmWithConsent}
                  disabled={!agreeDisbursement || confirmLoading}
                  className="group inline-flex h-12 flex-1 items-center justify-between gap-2 rounded-xl border border-solid border-[#012a26] bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white shadow-[0_14px_30px_-18px_rgba(1,42,38,0.9)] transition hover:bg-[#02665e] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
                >
                  {confirmLoading ? "Confirming..." : `Confirm check-in for ${preview.personal.fullName.split(/\s+/)[0]}`}
                  <span className={`grid h-8 w-8 place-items-center rounded-lg transition group-hover:translate-x-0.5 ${agreeDisbursement ? "bg-[#5eead4] text-[#012a26]" : "bg-slate-200 text-slate-400"}`}>
                    {confirmLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                  </span>
                </button>
              ) : (
                <div className={`flex flex-1 items-center gap-2.5 rounded-xl px-4 py-2.5 text-xs ring-1 ring-inset ${tone.note || "bg-slate-50 text-slate-600 ring-slate-200"}`}>
                  <Lock className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                  <span>
                    <span className="font-semibold">Check-in is locked for this code.</span>{" "}
                    {verdict.tone === "stop"
                      ? "If the guest is with you now, contact the NoLSAF team before letting them in."
                      : verdict.tone === "wait"
                        ? "It can be confirmed once the stay begins."
                        : "Nothing more to do here."}
                  </span>
                </div>
              )}
            </div>
          </div>
        </article>
      ) : !resultMsg ? (
        /* Placeholder pass: shows what is coming, in the same shape */
        <div className="flex flex-col overflow-hidden rounded-3xl border-2 border-dashed border-slate-200 md:flex-row">
          <div className="flex flex-col justify-center gap-3 p-6 md:w-[280px] md:shrink-0 md:border-0 md:border-r-2 md:border-dashed md:border-slate-200">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <ScanLine className="h-6 w-6" aria-hidden />
            </span>
            <p className="m-0 text-base font-bold text-slate-700">Arrival pass</p>
            <p className="m-0 text-xs leading-relaxed text-slate-500">Appears as soon as a code is read. Nothing is confirmed until you press Confirm.</p>
          </div>
          <ol className="m-0 grid flex-1 list-none grid-cols-1 gap-4 p-6 sm:grid-cols-3">
            {[
              { Icon: ScanLine, title: "Read the code", body: "Type the 8 characters the guest presents, or scan a code-bearing QR." },
              { Icon: UserCheck, title: "Match the guest", body: "Compare the name and phone with the person in front of you." },
              { Icon: ShieldCheck, title: "Confirm", body: "The arrival is recorded against the booking." },
            ].map((s, i) => (
              <li key={s.title} className="rounded-2xl bg-white p-4 ring-1 ring-slate-100">
                <div className="flex items-center justify-between">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#02665e]/[0.08] text-[#02665e]">
                    <s.Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-300">0{i + 1}</span>
                </div>
                <p className="m-0 mt-3 text-sm font-semibold text-slate-800">{s.title}</p>
                <p className="m-0 mt-1 text-xs leading-relaxed text-slate-500">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

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
                  <div className="text-xs text-slate-500">Point your camera at a guest QR that contains the check-in code</div>
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
                <span>{scanActive ? "Scanning..." : "Camera stopped"}</span>
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

    </div>
  );
}

