"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Smartphone,
  Clock3,
  RefreshCw,
  Lock,
  Loader2,
  MapPin,
  Building2,
  CreditCard,
  Ticket,
  ArrowRight,
  Home,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────
const PAYMENT_WAIT_SECONDS = 4 * 60;
const PAYMENT_POLL_MAX_ATTEMPTS = 45;
const PAYMENT_POLL_FAST_DELAY_MS = 3000;
const PAYMENT_POLL_SLOW_DELAY_MS = 10000;
const PAYMENT_RETRY_LIMIT = 3;
const PAYMENT_RETRY_WINDOW_SECONDS = 5 * 60;
const CARD_VERIFICATION_FAILED_MESSAGE =
  "Card verification failed. No payment was taken. Please try again or choose another payment method.";

type MnoMethod = "Airtel" | "Tigo" | "Mpesa" | "Halopesa";

type PaymentMethod = {
  id: MnoMethod;
  name: string;
  icon: string;
  description: string;
};

const PAYMENT_METHODS: PaymentMethod[] = [
  { id: "Airtel",   name: "Airtel Money", icon: "/assets/airtel_money.png",   description: "Pay with Airtel Money" },
  { id: "Mpesa",    name: "MPesa",       icon: "/assets/M-pesa.png",         description: "Pay with Mpesa" },
  { id: "Tigo",     name: "Tigo",  icon: "/assets/mix%20by%20yas.png", description: "Pay with Tigo" },
  { id: "Halopesa", name: "HaloPesa",     icon: "/assets/halopesa.png",       description: "Pay with HaloPesa" },
];

const BANK_PROVIDERS = [
  {
    code: "CRDB",
    name: "CRDB Bank",
    logo: "/assets/NoLSAF_CRDB.png",
    activeClass: "border-[#0f8b3d] bg-[#f0fff5] text-[#07502a] shadow-sm ring-2 ring-[#0f8b3d]/15",
    dotClass: "border-[#0f8b3d] bg-[#0f8b3d]",
  },
  {
    code: "NMB",
    name: "NMB Bank",
    logo: "/assets/NoLSAF_NMB.png",
    activeClass: "border-[#0069b4] bg-[#eff8ff] text-[#00477a] shadow-sm ring-2 ring-[#0069b4]/15",
    dotClass: "border-[#0069b4] bg-[#0069b4]",
  },
] as const;

const BANK_OTP_INSTRUCTIONS: Record<string, { title: string; steps: string[] }> = {
  CRDB: {
    title: "Generate CRDB OTP",
    steps: [
      "Dial *150*03# and enter your SIM Banking PIN.",
      "Choose 7 Other services, then 5 AzamPay.",
      "Select Link AzamPay Account to generate the OTP.",
    ],
  },
  NMB: {
    title: "Generate NMB OTP",
    steps: [
      "Dial *150*66#.",
      "Choose 8 More, then 5 Register Sarafu.",
      "Choose 1 Select Account No. to generate the OTP.",
    ],
  },
};

function formatCountdown(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmt(n: number, currency = "TZS"): string {
  return `${currency} ${Number(n).toLocaleString("en-US")}`;
}

/** A payment brand logo in a small white tile, as on the stay page's payment methods. */
function BrandMark({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-white p-1 shadow-sm ring-1 ring-black/5" title={alt}>
      <span className="relative block h-6 w-8">
        {/* Above the fold on the method list, so load eagerly (Next flagged these as LCP) */}
        <Image src={src} alt={alt} fill sizes="32px" loading="eager" className="object-contain" />
      </span>
    </span>
  );
}

function isPaymentCooldownMessage(msg: string | null): boolean {
  return !!msg && msg.toLowerCase().includes("wait");
}

function paymentApiMessage(payload: any, fallback: string): string {
  if (payload?.error === "payment_access_expired") {
    return "This draft payment link has expired. Please create a new booking to continue.";
  }
  return payload?.message || payload?.error || fallback;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TourPaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tourBookingId = Number(searchParams?.get("tourBookingId") || 0);
  const accessToken   = searchParams?.get("accessToken") || "";

  const [booking, setBooking]   = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // MNO state
  const [selectedMethod, setSelectedMethod] = useState<MnoMethod | null>(null);
  const [phoneNumber, setPhoneNumber]       = useState("");

  // Bank state
  const [selectedBankCode, setSelectedBankCode]   = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankMobileNumber, setBankMobileNumber] = useState("");
  const [bankOtp, setBankOtp] = useState("");

  // Payment channel accordion (null = all collapsed)
  const [paymentChannel, setPaymentChannel] = useState<"MNO" | "BANK" | "CARD" | null>(null);

  const [submitting, setSubmitting]                         = useState(false);
  const [paymentStatus, setPaymentStatus]                   = useState<"idle" | "pending" | "success" | "failed" | "timeout">("idle");
  const [_paymentRef, setPaymentRef]                        = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds]             = useState(PAYMENT_WAIT_SECONDS);
  const [paymentCooldownSeconds, setPaymentCooldownSeconds] = useState(0);
  const [retryCount, setRetryCount]                         = useState(0);
  const [retryWindowStart, setRetryWindowStart]             = useState<number | null>(null);

  const pollingIntervalRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load booking ──────────────────────────────────────────────────────────
  const fetchBooking = useCallback(
    async (id: number, token: string) => {
      try {
        const url = new URL(`/api/public/tour-bookings/${id}/payment-status`, window.location.origin);
        url.searchParams.set("accessToken", token);
        const res  = await fetch(url.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(paymentApiMessage(data, "Failed to load booking"));
        setBooking(data.booking);
        if (data.booking?.paymentStatus === "PAID") {
          setPaymentStatus("success");
        }
        // Pre-fill phone from booking
        if (data.booking?.guestPhone && !phoneNumber) {
          setPhoneNumber(data.booking.guestPhone.replace("+255", "0"));
        }
      } catch (err: any) {
        setError(err?.message || "Failed to load booking information.");
      } finally {
        setLoading(false);
      }
    },
    [phoneNumber]
  );

  // Initial load + card return detection
  useEffect(() => {
    if (!tourBookingId || !accessToken) {
      setError("Missing booking information.");
      setLoading(false);
      return;
    }

    const cardReturn = searchParams?.get("cardReturn");
    const cardRef    = searchParams?.get("ref");

    if (cardReturn && cardRef) {
      if (cardReturn === "success") {
        setPaymentStatus("success");
        setPaymentChannel("CARD");
      } else if (cardReturn === "pending") {
        setPaymentRef(cardRef);
        setSubmitting(true);
        setPaymentStatus("pending");
        setPaymentChannel("CARD");
        // Poll will start after booking loads (startPolling reads booking state)
      } else if (cardReturn === "failed") {
        setPaymentRef(cardRef);
        setSubmitting(false);
        setPaymentStatus("failed");
        setPaymentChannel("CARD");
        setError(CARD_VERIFICATION_FAILED_MESSAGE);
      }
    }

    fetchBooking(tourBookingId, accessToken);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourBookingId, accessToken]);

  // After booking loads, kick off card-return polling if pending
  useEffect(() => {
    if (!booking) return;
    const cardReturn = searchParams?.get("cardReturn");
    const cardRef    = searchParams?.get("ref");
    if (cardReturn === "pending" && cardRef && paymentStatus === "pending") {
      startPolling();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking]);

  // ── Countdown timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (paymentStatus !== "pending") {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      return;
    }
    setRemainingSeconds(PAYMENT_WAIT_SECONDS);
    const startedAt = Date.now();
    countdownIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const next = PAYMENT_WAIT_SECONDS - elapsed;
      setRemainingSeconds(Math.max(0, next));
      if (next <= 0) {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        setPaymentStatus((cur) => (cur === "pending" ? "timeout" : cur));
        setSubmitting(false);
      }
    }, 1000);
    return () => { if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current); };
  }, [paymentStatus]);

  // ── Cooldown timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (paymentCooldownSeconds <= 0) return;
    const t = setInterval(() => {
      setPaymentCooldownSeconds((c) => {
        if (c <= 1) {
          setError((msg) => (isPaymentCooldownMessage(msg) ? null : msg));
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [paymentCooldownSeconds]);

  // ── Poll booking status ───────────────────────────────────────────────────
  function startPolling() {
    if (pollingIntervalRef.current) { clearTimeout(pollingIntervalRef.current); pollingIntervalRef.current = null; }

    let attempts = 0;

    const pollBooking = async (): Promise<boolean> => {
      const url = new URL(`/api/public/tour-bookings/${tourBookingId}/payment-status`, window.location.origin);
      url.searchParams.set("accessToken", accessToken);
      const res  = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error("Poll failed");
      const data = await res.json();
      setBooking(data.booking);
      if (data.booking?.paymentStatus === "PAID") {
        if (pollingIntervalRef.current) { clearTimeout(pollingIntervalRef.current); pollingIntervalRef.current = null; }
        setPaymentStatus("success");
        setSubmitting(false);
        return true;
      }
      return false;
    };

    const scheduleNext = () => {
      if (attempts >= PAYMENT_POLL_MAX_ATTEMPTS) return;
      const delay = attempts < 20 ? PAYMENT_POLL_FAST_DELAY_MS : PAYMENT_POLL_SLOW_DELAY_MS;
      pollingIntervalRef.current = setTimeout(runPoll, delay);
    };

    const runPoll = async () => {
      attempts++;
      try {
        const done = await pollBooking();
        if (!done) scheduleNext();
      } catch {
        scheduleNext();
      }
    };

    void pollBooking().catch(() => {});
    scheduleNext();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current)   clearTimeout(pollingIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  // ── Accordion toggle ──────────────────────────────────────────────────────
  function toggleChannel(channel: "MNO" | "BANK" | "CARD") {
    setPaymentChannel((prev) => (prev === channel ? null : channel));
    setError(null);
  }

  // ── MNO payment ───────────────────────────────────────────────────────────
  async function handleMnoPayment() {
    if (paymentCooldownSeconds > 0) return;
    if (!selectedMethod || !phoneNumber.trim() || !booking) {
      setError("Please select a payment method and enter your phone number.");
      return;
    }

    const now = Date.now();
    if (retryWindowStart && now - retryWindowStart < PAYMENT_RETRY_WINDOW_SECONDS * 1000) {
      if (retryCount >= PAYMENT_RETRY_LIMIT) {
        const waitSec = Math.ceil((PAYMENT_RETRY_WINDOW_SECONDS * 1000 - (now - retryWindowStart)) / 1000);
        setError(`Too many attempts. Please wait ${Math.ceil(waitSec / 60)} minute(s) before retrying.`);
        return;
      }
    } else {
      setRetryWindowStart(now);
      setRetryCount(0);
    }

    setError(null);
    setSubmitting(true);
    setPaymentStatus("idle");

    try {
      const res = await fetch(`/api/public/tour-bookings/${tourBookingId}/initiate-payment`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ phoneNumber: phoneNumber.trim(), provider: selectedMethod, accessToken }),
      });

      const result = await res.json();

      if (!res.ok) {
        const retryAfterHeader = Number(res.headers.get("Retry-After") || 0);
        const retryAfterSec    = Number(result.retryAfterSeconds || retryAfterHeader || 0);
        if (res.status === 429 && retryAfterSec > 0) {
          setPaymentCooldownSeconds(retryAfterSec);
          setError(null);
          setSubmitting(false);
          setPaymentStatus("failed");
          return;
        }
        throw new Error(paymentApiMessage(result, "Payment initiation failed."));
      }

      // MNO is a USSD push to the phone — the handset is the payment surface.
      // We deliberately ignore any checkoutUrl the API might return; redirecting
      // here would yank the user off the "check your phone" prompt and break the
      // push flow. The status poll + webhook are the source of truth.
      setRetryCount((c) => c + 1);
      const ref = result.paymentRef || result.transactionId;
      setPaymentRef(ref);
      setPaymentStatus("pending");
      startPolling();
    } catch (err: any) {
      setError(err?.message || "Payment failed. Please try again.");
      setSubmitting(false);
      setPaymentStatus("failed");
    }
  }

  // ── Bank payment ──────────────────────────────────────────────────────────
  async function handleBankPayment() {
    if (!booking || !selectedBankCode) {
      setError("Please select a bank.");
      return;
    }
    const cleanedBankMobile = bankMobileNumber.replace(/\s+/g, "");
    const phoneRegex = /^(\+255|255|0)?[0-9]{9}$/;
    if (!bankAccountNumber.trim()) {
      setError("Please enter the bank account number selected while generating the OTP.");
      return;
    }
    if (!phoneRegex.test(cleanedBankMobile)) {
      setError("Please enter the mobile number registered with your bank account.");
      return;
    }
    if (!bankOtp.trim()) {
      setError("Please enter the OTP generated from your bank menu.");
      return;
    }

    setError(null);
    setSubmitting(true);
    setPaymentStatus("idle");

    try {
      const res = await fetch(`/api/public/tour-bookings/${tourBookingId}/initiate-bank-payment`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({
          bankCode:      selectedBankCode,
          accountNumber: bankAccountNumber.trim(),
          merchantMobileNumber: cleanedBankMobile,
          otp:           bankOtp.trim(),
          accessToken,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        const retryAfterHeader = Number(res.headers.get("Retry-After") || 0);
        const retryAfterSec    = Number(result.retryAfterSeconds || retryAfterHeader || 0);
        if (res.status === 429 && retryAfterSec > 0) {
          setPaymentCooldownSeconds(retryAfterSec);
          setError(null);
          setSubmitting(false);
          setPaymentStatus("failed");
          return;
        }
        throw new Error(paymentApiMessage(result, "Bank payment initiation failed."));
      }

      const ref = result.paymentRef || result.transactionId;
      setPaymentRef(ref);
      setPaymentStatus("pending");
      startPolling();
    } catch (err: any) {
      setError(err?.message || "Bank payment failed. Please try again.");
      setSubmitting(false);
      setPaymentStatus("failed");
    }
  }

  // ── Card payment ──────
  async function handleCardPayment() {
    if (!booking) return;

    setError(null);
    setSubmitting(true);
    setPaymentStatus("idle");

    try {
      const res = await fetch(`/api/public/tour-bookings/${tourBookingId}/initiate-card-payment`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ accessToken }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(paymentApiMessage(result, "Card payment initiation failed."));
      }

      if (result.checkoutUrl) {
        // Browser navigates to hosted checkout; callback returns with ?cardReturn=
        window.location.href = result.checkoutUrl;
        return; // keep submitting=true — page is navigating away
      }

      throw new Error("No checkout URL returned from payment provider");
    } catch (err: any) {
      setError(err?.message || "Card payment failed. Please try again.");
      setSubmitting(false);
      setPaymentStatus("failed");
    }
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (paymentStatus === "success" || booking?.paymentStatus === "PAID") {
    const paidAmount = Number(booking?.amountDue ?? booking?.grossAmount ?? 0);
    const paidCurrency = booking?.currency || "TZS";
    const tripHref = tourBookingId ? `/account/tour-packages/${encodeURIComponent(String(tourBookingId))}` : "/account/tour-packages";
    return (
      <div className="min-h-screen bg-[#f5faf9]">
        <div className="sticky top-0 z-30 border-0 border-b border-solid border-gray-100 bg-white/95 shadow-sm backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4">
            <p className="m-0 text-sm font-bold text-gray-900">Payment confirmed</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
              <CheckCircle2 className="h-3 w-3" aria-hidden /> PAID
            </span>
          </div>
        </div>

        <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
          {/* Same success panel as a stay payment: what happened, the code, what was paid, what next */}
          <div className="box-border overflow-hidden rounded-2xl border border-solid border-[#02665e]/25 bg-white shadow-lg">
            <div className="p-6 text-center lg:p-8">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#02665e]/10">
                <CheckCircle2 className="h-9 w-9 text-[#02665e]" aria-hidden />
              </span>
              <h1 className="m-0 mt-4 text-[24px] font-bold leading-tight text-slate-950 lg:text-[28px]">Payment successful</h1>
              <p className="m-0 mx-auto mt-2 max-w-md text-[14.5px] leading-6 text-slate-600">
                Your tour{booking?.title ? ` "${booking.title}"` : ""} is confirmed
                {(booking?.operatorSnapshot as any)?.companyName ? ` with ${(booking.operatorSnapshot as any).companyName}` : ""}. Your voucher and day-by-day plan are in your account.
              </p>
              {booking?.bookingCode ? (
                <div className="mx-auto mt-5 box-border flex max-w-sm flex-col items-center rounded-xl border border-solid border-[#02665e]/25 bg-[#02665e]/5 px-5 py-4">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#02665e]">Booking code</span>
                  <span className="mt-1 font-mono text-[22px] font-black tracking-[0.08em] text-slate-950">{booking.bookingCode}</span>
                </div>
              ) : null}
            </div>

            {/* What was paid */}
            <div className="box-border grid grid-cols-1 border-0 border-t border-solid border-slate-100 bg-slate-50/70 sm:grid-cols-3">
              <div className="px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Amount paid</div>
                <div className="mt-1 text-[16px] font-bold tabular-nums text-[#02665e]">{fmt(paidAmount, paidCurrency)}</div>
              </div>
              <div className="border-0 border-t border-solid border-slate-200 px-4 py-3 sm:border-l sm:border-t-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Travellers</div>
                <div className="mt-1 text-[14px] font-semibold text-slate-900">{booking?.travelerCount || 1}</div>
              </div>
              <div className="border-0 border-t border-solid border-slate-200 px-4 py-3 sm:border-l sm:border-t-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Destination</div>
                <div className="mt-1 truncate text-[14px] font-semibold text-slate-900">{booking?.destination || "Confirmed"}</div>
              </div>
            </div>

            {/* What next */}
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:p-6">
              <Link
                href={tripHref}
                className="box-border inline-flex items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 py-3 text-[14.5px] font-semibold text-white no-underline shadow-md transition hover:bg-[#014e47]"
              >
                <Ticket className="h-5 w-5" aria-hidden />
                My trip and voucher
              </Link>
              <Link
                href="/account/tour-packages"
                className="box-border inline-flex items-center justify-center gap-2 rounded-xl border border-solid border-[#02665e]/30 bg-white px-5 py-3 text-[14.5px] font-semibold text-[#02665e] no-underline transition hover:bg-[#02665e]/5"
              >
                All my tours
              </Link>
            </div>
          </div>

          {/* The tour is paid, so leaving this page costs nothing: suggest a stay near where the trip goes */}
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                <Building2 className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[14px] font-bold text-gray-900">Need a place to stay?</p>
                <p className="m-0 mt-0.5 text-[12.5px] leading-relaxed text-gray-500">
                  {booking?.destination
                    ? `Verified hotels and lodges near ${booking.destination}, for before or after your tour.`
                    : "Verified hotels and lodges for before or after your tour."}
                </p>
              </div>
            </div>
            <Link
              href={booking?.destination ? `/public/properties?q=${encodeURIComponent(String(booking.destination))}` : "/public/properties"}
              className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border border-solid border-[#02665e]/30 bg-white px-4 text-[13px] font-semibold text-[#02665e] no-underline transition-colors hover:bg-[#02665e]/5"
            >
              Browse stays
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <div className="mt-6 text-center">
            <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-500 no-underline hover:text-gray-800">
              <Home className="h-3.5 w-3.5" aria-hidden />
              Return to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading / error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#02665e]" />
      </div>
    );
  }

  if (!booking && error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
        <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
        <p className="text-red-600 text-center mb-4 text-sm">{error}</p>
        <button onClick={() => router.back()} className="text-[#02665e] text-sm underline">Go back</button>
      </div>
    );
  }

  const operatorName = (booking?.operatorSnapshot as any)?.companyName || "Tour Operator";
  const amount       = Number(booking?.amountDue ?? booking?.grossAmount ?? 0);
  const currency     = booking?.currency || "TZS";
  const isTZS        = currency === "TZS";

  const bookingSummaryCard = booking ? (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-solid border-[#02665e]/10">
      <div
        className="px-5 pt-5 pb-4"
        style={{ background: "linear-gradient(135deg, #02665e 0%, #028570 55%, #3ab8af 100%)" }}
      >
        <span className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm text-white/90 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mb-3">
          Booking Summary
        </span>
        {booking.title && (
          <h2 className="text-xl font-extrabold text-white leading-snug">{booking.title}</h2>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          {booking.destination && (
            <span className="flex items-center gap-1 text-white/85 text-xs bg-white/15 px-2.5 py-1 rounded-full">
              <MapPin className="w-3 h-3 flex-shrink-0" />{booking.destination}
            </span>
          )}
          {booking.bookingCode && (
            <span className="text-white/85 text-xs bg-white/15 px-2.5 py-1 rounded-full font-mono">
              {booking.bookingCode}
            </span>
          )}
        </div>
      </div>
      <div className="bg-white px-5 py-4 space-y-2">
        {(() => {
          const fee = Number(booking.commissionAmount || 0);
          const pax = Math.max(1, Number(booking.travelerCount) || 1);
          const tourPart = Math.max(0, amount - fee);
          return (
            <>
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-gray-500">
                  Tour <span className="text-gray-400">· {pax} traveller{pax === 1 ? "" : "s"}</span>
                </span>
                <span className="font-medium tabular-nums text-gray-900">{fmt(tourPart, currency)}</span>
              </div>
              {fee > 0 ? (
                <div className="flex justify-between gap-3 text-sm">
                  <span className="text-gray-500">NoLSAF service fee</span>
                  <span className="font-medium tabular-nums text-gray-900">{fmt(fee, currency)}</span>
                </div>
              ) : null}
            </>
          );
        })()}
        <div className="flex items-end justify-between border-0 border-t border-dashed border-gray-200 pt-3">
          <div className="leading-tight">
            <span className="block text-sm font-semibold text-gray-800">Total due</span>
            <span className="block text-[11px] text-gray-400">Nothing added at checkout</span>
          </div>
          <span className="text-2xl font-black tabular-nums text-[#02665e]">{fmt(amount, currency)}</span>
        </div>
      </div>
    </div>
  ) : null;

  const isDisabled = submitting || paymentCooldownSeconds > 0;
  const bankInstruction = selectedBankCode ? BANK_OTP_INSTRUCTIONS[selectedBankCode] : null;
  const bankReady = Boolean(selectedBankCode && bankAccountNumber.trim() && bankMobileNumber.trim() && bankOtp.trim());

  return (
    <div className="min-h-screen bg-[#f5faf9] overflow-x-hidden">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-0 border-b border-solid border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          {paymentStatus === "idle" || paymentStatus === "failed" ? (
            <button
              type="button"
              aria-label="Back"
              onClick={() => router.back()}
              className="-ml-2 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent transition-colors hover:bg-gray-100 active:bg-gray-200"
            >
              <ChevronLeft className="w-5 h-5 text-gray-700" />
            </button>
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 leading-tight truncate">Secure Payment</p>
            <p className="text-xs text-gray-400 truncate">{operatorName}</p>
          </div>
          <span className="flex-shrink-0 text-[10px] font-bold text-[#02665e] bg-[#02665e]/10 px-2.5 py-1 rounded-full tracking-wide">
            STEP 2 OF 2
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-10 xl:gap-14 lg:items-start">

          {/* LEFT: Payment content */}
          <div className="space-y-5 min-w-0 overflow-hidden">
            <div className="lg:hidden">{bookingSummaryCard}</div>

            {/* ── Pending: what is happening, how long is left, and where the payment has reached ── */}
            {paymentStatus === "pending" && (() => {
              const steps =
                paymentChannel === "MNO"
                  ? ["Request sent to your phone", "Approve the prompt", "Tour confirmed"]
                  : paymentChannel === "BANK"
                  ? ["Bank checkout opened", "Bank confirming the OTP", "Tour confirmed"]
                  : ["Card details submitted", "Your bank is verifying", "Tour confirmed"];
              const elapsedPct = Math.max(0, Math.min(100, ((PAYMENT_WAIT_SECONDS - remainingSeconds) / PAYMENT_WAIT_SECONDS) * 100));
              const running = remainingSeconds > 0;
              return (
                <div className="box-border overflow-hidden rounded-2xl border border-solid border-[#02665e]/20 bg-white shadow-lg">
                  <div className="flex flex-col gap-4 border-0 border-b border-solid border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between lg:p-6">
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#02665e]/10">
                        <span className="absolute inset-0 animate-ping rounded-2xl bg-[#02665e]/10" aria-hidden />
                        <Loader2 className="relative h-6 w-6 animate-spin text-[#02665e]" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <h2 className="m-0 text-[20px] font-bold leading-tight text-slate-950 sm:text-[22px]">
                          {paymentChannel === "CARD" ? "Verifying your card payment" : paymentChannel === "BANK" ? "Confirming your bank payment" : "Waiting for your approval"}
                        </h2>
                        <p className="m-0 mt-1 text-[14px] leading-5 text-slate-600">
                          {paymentChannel === "MNO"
                            ? `We sent a payment request to your phone. Approve it on ${selectedMethod ? PAYMENT_METHODS.find((m) => m.id === selectedMethod)?.name || selectedMethod : "your wallet"} to confirm this tour.`
                            : paymentChannel === "BANK"
                            ? `We are confirming the ${BANK_PROVIDERS.find((b) => b.code === selectedBankCode)?.name || "bank"} checkout using the OTP you generated.`
                            : "Your bank is checking the card. This usually takes a few seconds."}
                        </p>
                      </div>
                    </div>
                    <div className="flex-shrink-0 rounded-xl bg-slate-50 px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden />
                        Time left
                      </div>
                      <div className={`mt-0.5 font-mono text-[26px] font-black leading-none tabular-nums ${running ? "text-slate-950" : "text-amber-700"}`}>
                        {formatCountdown(remainingSeconds)}
                      </div>
                    </div>
                  </div>

                  <div className="h-1 w-full bg-slate-100" role="presentation">
                    <div className="h-full bg-[#02665e] transition-all duration-1000 ease-linear" style={{ width: `${elapsedPct}%` }} />
                  </div>

                  <div className="p-5 lg:p-6">
                    <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
                      {steps.map((label, index) => {
                        const done = index === 0;
                        const active = index === 1;
                        return (
                          <li
                            key={label}
                            className={`box-border flex items-center gap-2.5 rounded-xl border border-solid px-3 py-2.5 ${
                              active ? "border-[#02665e]/30 bg-[#02665e]/5" : done ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"
                            }`}
                          >
                            <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-[#02665e] text-white" : active ? "bg-[#02665e]/15 text-[#02665e]" : "bg-slate-200 text-slate-500"}`}>
                              {done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                            </span>
                            <span className={`min-w-0 text-[13px] font-semibold leading-tight ${active ? "text-[#02665e]" : done ? "text-slate-700" : "text-slate-500"}`}>{label}</span>
                            {active ? <span className="ml-auto block h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-[#02665e]" aria-hidden /> : null}
                          </li>
                        );
                      })}
                    </ol>

                    <div className="mt-4 box-border grid grid-cols-1 overflow-hidden rounded-xl border border-solid border-slate-200 bg-slate-50/70 sm:grid-cols-3">
                      <div className="px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Booking</div>
                        <div className="mt-1 truncate font-mono text-[13.5px] font-semibold text-slate-900">{booking?.bookingCode || `#${tourBookingId}`}</div>
                      </div>
                      <div className="border-0 border-t border-solid border-slate-200 px-4 py-3 sm:border-l sm:border-t-0">
                        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Amount</div>
                        <div className="mt-1 text-[16px] font-bold tabular-nums text-slate-950">{fmt(amount, currency)}</div>
                      </div>
                      <div className="border-0 border-t border-solid border-slate-200 px-4 py-3 sm:border-l sm:border-t-0">
                        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                          {paymentChannel === "MNO" ? "Phone" : paymentChannel === "BANK" ? "Bank" : "Method"}
                        </div>
                        <div className="mt-1 truncate text-[14px] font-semibold text-slate-900">
                          {paymentChannel === "MNO"
                            ? phoneNumber || booking?.guestPhone || "-"
                            : paymentChannel === "BANK"
                            ? BANK_PROVIDERS.find((b) => b.code === selectedBankCode)?.name || selectedBankCode || "-"
                            : "Visa / Mastercard"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-slate-500">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                        <ShieldCheck className="h-4 w-4 text-[#02665e]" aria-hidden />
                        Keep this page open until it finishes.
                      </span>
                      {_paymentRef ? (
                        <span>Reference <span className="font-mono text-slate-700">{_paymentRef}</span></span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Timeout ── */}
            {paymentStatus === "timeout" && (
              <div className="rounded-2xl border border-solid border-amber-200 bg-white p-5 shadow-lg lg:p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
                    <Clock3 className="h-5 w-5 text-amber-700" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 className="m-0 text-xl font-bold leading-tight text-amber-950 sm:text-2xl">Payment not confirmed yet</h2>
                    <p className="m-0 mt-2 text-sm leading-6 text-amber-800">
                      Your tour booking is still saved. If you did not approve the prompt, send a new payment request below. You do not need to fill the form again.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Failed ── */}
            {paymentStatus === "failed" && (
              <div className="rounded-2xl border border-solid border-rose-200 bg-white p-5 shadow-lg shadow-rose-950/5 lg:p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-rose-50 ring-1 ring-rose-100">
                    <AlertCircle className="h-5 w-5 text-rose-700" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="m-0 text-xl font-bold leading-tight text-slate-950 sm:text-2xl">
                      {paymentChannel === "CARD" ? "Card payment not completed" : "Payment request failed"}
                    </h2>
                    <p className="m-0 mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      {paymentChannel === "CARD"
                        ? isTZS
                          ? "Your tour booking is still saved and unpaid. Try the card again, or choose mobile money or bank transfer."
                          : "Your tour booking is still saved and unpaid. You can try the card again below."
                        : "Your tour booking is saved. Check the details below and try again."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && paymentStatus !== "pending" && (
              <div className="rounded-xl bg-red-50 border border-solid border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Cooldown */}
            {paymentCooldownSeconds > 0 && paymentStatus !== "pending" && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-2 text-sm text-amber-700">
                <Clock3 className="w-4 h-4 flex-shrink-0" />
                Too many attempts — retry in {paymentCooldownSeconds}s
              </div>
            )}

            {/* Payment method selection */}
            {paymentStatus !== "pending" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1 min-h-[28px]">
                  {paymentChannel ? (
                    <button
                      type="button"
                      onClick={() => { setPaymentChannel(null); setError(null); }}
                      className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-700 transition-colors group"
                    >
                      <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-150" />
                      <span>Change payment method</span>
                    </button>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-[#02665e]" />
                      <h3 className="text-sm font-bold text-gray-800 tracking-wide uppercase">
                        Choose How to Pay
                      </h3>
                    </>
                  )}
                </div>

                {/* USD-only notice */}
                {!isTZS && !paymentChannel && (
                  <div className="flex items-start gap-3 rounded-2xl border border-solid border-sky-100 bg-sky-50/70 px-4 py-3">
                    <span className="mt-0.5 inline-flex h-7 min-w-[2.5rem] flex-shrink-0 items-center justify-center rounded-lg bg-white px-1.5 text-[11px] font-black tracking-wide text-sky-700 ring-1 ring-sky-100">USD</span>
                    <p className="m-0 text-[12.5px] leading-relaxed text-slate-600">
                      <span className="font-semibold text-slate-900">Priced in US dollars, paid by card.</span> Any Visa or Mastercard works, and your bank converts the amount for you.
                    </p>
                  </div>
                )}

                {/* ── Method selector: 3 standalone cards ── */}
                <div className="space-y-2.5">

                  {/* Mobile Money — TZS only */}
                  {isTZS && (!paymentChannel || paymentChannel === "MNO") && (
                    <button
                      type="button"
                      onClick={() => toggleChannel("MNO")}
                      className={`group w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 border-solid text-left cursor-pointer transition-all duration-200 ${
                        paymentChannel === "MNO"
                          ? "border-red-300 bg-red-50 shadow-lg shadow-red-100"
                          : "border-slate-100 bg-white shadow-sm hover:border-slate-200 hover:shadow-md"
                      }`}
                    >
                      <div className={`p-2.5 rounded-xl flex-shrink-0 transition-colors ${
                        paymentChannel === "MNO" ? "bg-red-100" : "bg-red-50 group-hover:bg-red-100"
                      }`}>
                        <Smartphone className={`w-5 h-5 transition-colors ${paymentChannel === "MNO" ? "text-red-600" : "text-red-500"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`font-bold text-[15px] transition-colors ${paymentChannel === "MNO" ? "text-red-900" : "text-gray-900"}`}>
                          Mobile Money
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 font-medium">Approve on your phone</div>
                      </div>
                      <span className="hidden flex-shrink-0 items-center gap-1.5 sm:flex">
                        {PAYMENT_METHODS.map((m) => <BrandMark key={m.id} src={m.icon} alt={m.name} />)}
                      </span>
                      <div className={`w-5 h-5 rounded-full border-2 border-solid flex items-center justify-center flex-shrink-0 transition-all ${
                        paymentChannel === "MNO" ? "border-red-500 bg-red-500" : "border-gray-300"
                      }`}>
                        {paymentChannel === "MNO" && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </button>
                  )}

                  {/* Bank Transfer — TZS only */}
                  {isTZS && (!paymentChannel || paymentChannel === "BANK") && (
                    <button
                      type="button"
                      onClick={() => toggleChannel("BANK")}
                      className={`group w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 border-solid text-left cursor-pointer transition-all duration-200 ${
                        paymentChannel === "BANK"
                          ? "border-green-300 bg-green-50 shadow-lg shadow-green-100"
                          : "border-slate-100 bg-white shadow-sm hover:border-slate-200 hover:shadow-md"
                      }`}
                    >
                      <div className={`p-2.5 rounded-xl flex-shrink-0 transition-colors ${
                        paymentChannel === "BANK" ? "bg-green-100" : "bg-green-50 group-hover:bg-green-100"
                      }`}>
                        <Building2 className={`w-5 h-5 transition-colors ${paymentChannel === "BANK" ? "text-green-700" : "text-green-600"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`font-bold text-[15px] transition-colors ${paymentChannel === "BANK" ? "text-green-900" : "text-gray-900"}`}>
                          Bank Transfer
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 font-medium">OTP checkout</div>
                      </div>
                      <span className="flex flex-shrink-0 items-center gap-1.5">
                        {BANK_PROVIDERS.map((b) => <BrandMark key={b.code} src={b.logo} alt={b.name} />)}
                      </span>
                      <div className={`w-5 h-5 rounded-full border-2 border-solid flex items-center justify-center flex-shrink-0 transition-all ${
                        paymentChannel === "BANK" ? "border-green-600 bg-green-600" : "border-gray-300"
                      }`}>
                        {paymentChannel === "BANK" && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </button>
                  )}

                  {/* Debit / Credit Card */}
                  {(!paymentChannel || paymentChannel === "CARD") && (
                    <button
                      type="button"
                      onClick={() => toggleChannel("CARD")}
                      className={`group w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 border-solid text-left cursor-pointer transition-all duration-200 ${
                        paymentChannel === "CARD"
                          ? "border-violet-300 bg-violet-50 shadow-lg shadow-violet-100"
                          : "border-slate-100 bg-white shadow-sm hover:border-slate-200 hover:shadow-md"
                      }`}
                    >
                      <div className={`p-2.5 rounded-xl flex-shrink-0 transition-colors ${
                        paymentChannel === "CARD" ? "bg-violet-100" : "bg-violet-50 group-hover:bg-violet-100"
                      }`}>
                        <CreditCard className={`w-5 h-5 transition-colors ${paymentChannel === "CARD" ? "text-violet-700" : "text-violet-600"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`font-bold text-[15px] transition-colors ${paymentChannel === "CARD" ? "text-violet-900" : "text-gray-900"}`}>
                          Debit / Credit Card
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 font-medium">Secure checkout, any bank</div>
                      </div>
                      <span className="flex flex-shrink-0 items-center gap-1.5">
                        <BrandMark src="/assets/visa_card.png" alt="Visa" />
                        <BrandMark src="/assets/Mastercard_Logo.png" alt="Mastercard" />
                      </span>
                      <div className={`w-5 h-5 rounded-full border-2 border-solid flex items-center justify-center flex-shrink-0 transition-all ${
                        paymentChannel === "CARD" ? "border-violet-600 bg-violet-600" : "border-gray-300"
                      }`}>
                        {paymentChannel === "CARD" && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </button>
                  )}

                </div>

                {/* ── Form panel — appears below when a channel is selected ── */}
                {paymentChannel && (
                  <div className="bg-white rounded-2xl border border-solid border-gray-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-5 pb-5 pt-4 space-y-4">

                      {/* ── MNO form ── */}
                      {paymentChannel === "MNO" && (
                        <>
                          {/* Provider grid */}
                          <div className="grid grid-cols-2 gap-3">
                            {PAYMENT_METHODS.map((method) => (
                              <button
                                key={method.id}
                                type="button"
                                onClick={() => setSelectedMethod(method.id)}
                                className={`group relative p-3.5 rounded-lg border-2 transition-all duration-300 ${
                                  selectedMethod === method.id
                                    ? "border-[#02665e] bg-gradient-to-br from-[#02665e]/10 to-blue-50/50 shadow-md ring-2 ring-[#02665e]/20"
                                    : "border-slate-200 hover:border-[#02665e]/50 hover:shadow-md bg-white"
                                }`}
                              >
                                <div className="flex flex-col items-center text-center gap-2">
                                  <div className="relative h-14 w-20 flex-shrink-0">
                                    <Image
                                      src={method.icon}
                                      alt={method.name}
                                      fill
                                      sizes="80px"
                                      className="object-contain"
                                    />
                                  </div>
                                  <div className="w-full">
                                    <div className={`font-bold text-sm ${
                                      selectedMethod === method.id ? "text-[#02665e]" : "text-slate-900"
                                    }`}>
                                      {method.name}
                                    </div>
                                  </div>
                                  {selectedMethod === method.id && (
                                    <div className="absolute top-1.5 right-1.5">
                                      <div className="w-5 h-5 rounded-full bg-[#02665e] flex items-center justify-center shadow-md">
                                        <CheckCircle2 className="w-3 h-3 text-white" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>

                          {/* Phone input */}
                          <div className="flex w-full justify-center overflow-hidden">
                            <div className="w-full max-w-[min(280px,calc(100vw-2rem))] min-w-0">
                              <label className="mb-2 flex items-center justify-center gap-1.5 text-center text-sm font-semibold text-slate-700">
                                <Smartphone className="w-4 h-4 text-[#02665e]" />
                                Mobile Money Number
                              </label>
                              <div className="relative">
                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500 select-none">+255</span>
                                <div className="absolute left-[3.75rem] top-1/2 -translate-y-1/2 h-5 w-px bg-slate-300" />
                                <input
                                  type="tel"
                                  inputMode="numeric"
                                  value={phoneNumber}
                                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ""))}
                                  placeholder="7XXXXXXXX"
                                  autoComplete="tel"
                                  maxLength={12}
                                  className="block w-full min-w-0 box-border border border-slate-200 bg-slate-50 rounded-xl pl-[4.5rem] pr-4 py-3 text-sm font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#02665e]/25 focus:border-[#02665e] transition-all duration-200 shadow-sm"
                                />
                              </div>
                              <p className="mt-1.5 text-center text-xs text-slate-500">Enter the number linked to your mobile wallet</p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={handleMnoPayment}
                            disabled={isDisabled || !selectedMethod || !phoneNumber.trim()}
                            className="w-full py-4 rounded-2xl text-white font-semibold text-base disabled:opacity-60 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2"
                            style={{
                              background: (submitting || paymentCooldownSeconds > 0)
                                ? "#606363"
                                : "linear-gradient(135deg, #02665e, #4ecdc4)",
                            }}
                          >
                            {submitting ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Initiating Payment...
                              </>
                            ) : paymentCooldownSeconds > 0 ? (
                              <>
                                <Clock3 className="w-4 h-4" />
                                Retry in {paymentCooldownSeconds}s
                              </>
                            ) : paymentStatus === "failed" || paymentStatus === "timeout" ? (
                              <>
                                <RefreshCw className="w-4 h-4" />
                                Try Again
                              </>
                            ) : (
                              `Pay ${fmt(amount, currency)}`
                            )}
                          </button>
                        </>
                      )}

                      {/* ── Bank form ── */}
                      {paymentChannel === "BANK" && (
                        <>
                          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e] text-white">
                                <Building2 className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-950">Bank OTP checkout</div>
                                <p className="mt-1 text-xs leading-5 text-slate-600">
                                  Generate the OTP from your bank SIM menu first, then enter the same account number, registered mobile number, and OTP below.
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="min-w-0 max-w-full overflow-hidden">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                              Select Bank <span className="text-red-500">*</span>
                            </label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {BANK_PROVIDERS.map((bank) => {
                                const active = selectedBankCode === bank.code;
                                return (
                                  <button
                                    key={bank.code}
                                    type="button"
                                    onClick={() => setSelectedBankCode(bank.code)}
                                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                                      active
                                        ? bank.activeClass
                                        : "border-slate-200 bg-white text-slate-800 hover:border-emerald-200 hover:bg-emerald-50/40"
                                    }`}
                                  >
                                    <span className="relative flex h-11 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg">
                                      <Image src={bank.logo} alt={`${bank.name} logo`} fill sizes="56px" className="object-contain" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-sm font-bold">{bank.name}</span>
                                      <span className="mt-0.5 block text-xs text-slate-500">{bank.code} SIM banking OTP</span>
                                    </span>
                                    <span className={`h-4 w-4 rounded-full border-2 ${active ? bank.dotClass : "border-slate-300"}`} />
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {bankInstruction && (
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                              <div className="text-sm font-bold text-emerald-950">{bankInstruction.title}</div>
                              <p className="mt-1 text-xs leading-5 text-emerald-800">
                                Complete these steps on your phone before pressing the payment button.
                              </p>
                              <ol className="mt-3 space-y-2 text-xs leading-5 text-emerald-900">
                                {bankInstruction.steps.map((step, index) => (
                                  <li key={step} className="flex gap-2">
                                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-[#02665e] ring-1 ring-emerald-100">
                                      {index + 1}
                                    </span>
                                    <span>{step}</span>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          )}

                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                              Account Number <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={bankAccountNumber}
                              onChange={(e) => setBankAccountNumber(e.target.value)}
                              placeholder="Account number selected for OTP"
                              maxLength={30}
                              className="block box-border w-full max-w-full min-w-0 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/25 focus:border-[#02665e] bg-slate-50 focus:bg-white text-sm text-gray-900 font-mono tracking-wide transition-all"
                            />
                            <p className="mt-1.5 max-w-full break-words text-xs leading-5 text-slate-500">Use the same account you selected while generating the OTP.</p>
                          </div>

                          <div className="min-w-0 max-w-full overflow-hidden">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                              Bank Registered Mobile Number <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="tel"
                              value={bankMobileNumber}
                              onChange={(e) => setBankMobileNumber(e.target.value)}
                              placeholder="+255 XXX XXX XXX"
                              maxLength={15}
                              className="block box-border w-full max-w-full min-w-0 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/25 focus:border-[#02665e] bg-slate-50 focus:bg-white text-sm text-gray-900 transition-all"
                            />
                            <p className="mt-1.5 max-w-full break-words text-xs leading-5 text-slate-500">This is the number registered for SIM banking on that bank account.</p>
                          </div>

                          <div className="min-w-0 max-w-full overflow-hidden">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                              Bank OTP <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={bankOtp}
                              onChange={(e) => setBankOtp(e.target.value)}
                              placeholder="Enter OTP from bank menu"
                              maxLength={50}
                              className="block box-border w-full max-w-full min-w-0 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/25 focus:border-[#02665e] bg-slate-50 focus:bg-white text-sm text-gray-900 font-mono tracking-wide transition-all"
                            />
                            <p className="mt-1.5 max-w-full break-words text-xs leading-5 text-slate-500">The OTP comes from the bank menu, not from NoLSAF.</p>
                          </div>

                          <button
                            type="button"
                            onClick={handleBankPayment}
                            disabled={isDisabled || !bankReady}
                            className="w-full py-4 rounded-2xl text-white font-semibold text-base disabled:opacity-60 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2"
                            style={{ background: submitting ? "#606363" : "linear-gradient(135deg, #02665e, #4ecdc4)" }}
                          >
                            {submitting ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Initiating Bank Payment...
                              </>
                            ) : paymentStatus === "failed" || paymentStatus === "timeout" ? (
                              <>
                                <RefreshCw className="w-4 h-4" />
                                Try Again
                              </>
                            ) : (
                              <>
                                <Building2 className="w-4 h-4" />
                                Pay via Bank Transfer {fmt(amount, currency)}
                              </>
                            )}
                          </button>
                        </>
                      )}

                      {/* ── Card form ── */}
                      {paymentChannel === "CARD" && (
                        <>
                          <div className="flex items-start gap-3 p-3.5 bg-violet-50 rounded-xl border border-violet-100">
                            <ShieldCheck className="w-4 h-4 text-violet-600 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-gray-600 leading-relaxed">
                              You will be redirected to a secure hosted card checkout page. After completing payment you will return here automatically.
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={handleCardPayment}
                            disabled={isDisabled}
                            className="w-full py-4 rounded-2xl text-white font-semibold text-base disabled:opacity-60 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2"
                            style={{ background: submitting ? "#606363" : "linear-gradient(135deg, #6d28d9, #7c3aed)" }}
                          >
                            {submitting ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Redirecting to checkout...
                              </>
                            ) : (
                              <>
                                <CreditCard className="w-4 h-4" />
                                {paymentStatus === "failed" || paymentStatus === "timeout"
                                  ? `Try Card Again ${fmt(amount, currency)}`
                                  : `Pay with Card ${fmt(amount, currency)}`}
                              </>
                            )}
                          </button>
                        </>
                      )}

                    </div>
                  </div>
                )}

                {/* Security badge */}
                <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 pt-1">
                  <Lock className="w-3.5 h-3.5" />
                  <span>256-bit SSL encrypted. Your payment is fully secure.</span>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Sidebar (desktop only) */}
          <div className="hidden lg:block lg:sticky lg:top-20">
            {bookingSummaryCard}
          </div>

        </div>
      </div>
    </div>
  );
}
