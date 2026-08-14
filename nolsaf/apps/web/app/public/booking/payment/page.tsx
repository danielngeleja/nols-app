"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  CreditCard,
  Smartphone,
  Clock3,
  RefreshCw,
  ReceiptText,
  Building2,
} from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";

const PAYMENT_WAIT_SECONDS = 4 * 60;
const PAYMENT_RETRY_WINDOW_SECONDS = 5 * 60;
const PAYMENT_RETRY_LIMIT = 3;
const PAYMENT_POLL_MAX_ATTEMPTS = 45;
const PAYMENT_POLL_FAST_DELAY_MS = 3000;
const PAYMENT_POLL_SLOW_DELAY_MS = 10000;
const CARD_VERIFICATION_FAILED_MESSAGE =
  "Card verification failed. No payment was taken. Please try again or choose another payment method.";

type PaymentMethod = {
  id: "Airtel" | "Tigo" | "Mpesa" | "Halopesa" | "Azampesa";
  name: string;
  icon: string | null;
  description: string;
};

const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "Airtel",
    name: "Airtel Money",
    icon: "/assets/airtel_money.png",
    description: "Pay with Airtel Money",
  },
  {
    id: "Mpesa",
    name: "Mpesa",
    icon: "/assets/M-pesa.png",
    description: "Pay with Mpesa",
  },
  {
    id: "Tigo",
    name: "Tigo",
    icon: "/assets/mix by yas.png",
    description: "Pay with Tigo",
  },
  {
    id: "Halopesa",
    name: "HaloPesa",
    icon: "/assets/halopesa.png",
    description: "Pay with HaloPesa",
  },
  {
    id: "Azampesa",
    name: "AzamPesa",
    icon: "/assets/azam-pesa-logo-png.png",
    description: "Pay with AzamPesa",
  },
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
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function toDisplayMessage(value: unknown, fallback: string) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
    if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  }

  return fallback;
}

function formatPaymentError(message?: unknown, retryAfterSeconds?: number) {
  const plainMessage = toDisplayMessage(message, "Failed to initiate payment. Please try again.");
  const normalized = plainMessage.trim().toLowerCase();
  if (normalized === "rate_limited" || normalized?.includes("too many payment requests")) {
    if (retryAfterSeconds && retryAfterSeconds > 0) {
      return `Too many payment requests. Try again in ${formatCountdown(retryAfterSeconds)}.`;
    }
    return "Too many payment requests. Please wait before trying again.";
  }

  if (normalized === "unauthorized" || normalized === "forbidden") {
    return "Payment service is not available yet. Please try again later.";
  }

  return plainMessage;
}

function isPaymentCooldownMessage(message: string | null) {
  return message?.toLowerCase().includes("too many payment requests") ?? false;
}

function getPaymentAttemptKey(invoiceId: number, phone: string) {
  return `nolsaf:payment-attempts:${invoiceId}:${phone}`;
}

function registerPaymentAttempt(invoiceId: number, phone: string) {
  if (typeof window === "undefined") return 0;

  const now = Date.now();
  const windowMs = PAYMENT_RETRY_WINDOW_SECONDS * 1000;
  const key = getPaymentAttemptKey(invoiceId, phone);

  try {
    const raw = window.localStorage.getItem(key);
    const current = raw ? JSON.parse(raw) as { startedAt: number; count: number } : null;
    const expired = !current || now - current.startedAt >= windowMs;

    if (expired) {
      window.localStorage.setItem(key, JSON.stringify({ startedAt: now, count: 1 }));
      return 0;
    }

    if (current.count >= PAYMENT_RETRY_LIMIT) {
      return Math.ceil((current.startedAt + windowMs - now) / 1000);
    }

    window.localStorage.setItem(key, JSON.stringify({ ...current, count: current.count + 1 }));
    return 0;
  } catch {
    return 0;
  }
}

type InvoiceData = {
  id: number;
  invoiceNumber: string;
  paymentRef: string;
  status: string;
  totalAmount: number;
  currency: string;
  booking: {
    id: number;
    bookingCode: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    guestName: string | null;
    guestPhone: string | null;
    roomCode: string | null;
    roomsQty?: number;
    includeTransport?: boolean;
    totalAmount: number;
  };
  property: {
    id: number;
    title: string;
    type: string;
    slug?: string;
    primaryImage: string | null;
    basePrice: number;
  };
  draftAvailability?: {
    available: boolean;
    status: "AVAILABLE" | "UNAVAILABLE" | "PROPERTY_UNAVAILABLE";
    reason: "AVAILABLE" | "BOOKED" | "BLOCKED" | "FULL" | "PROPERTY_UNAVAILABLE";
    message: string;
    checkedAt: string;
    requestedRooms: number;
    availableRooms: number;
    bookedRooms: number;
    blockedRooms: number;
    selectedRoomType: string | null;
  } | null;
  priceBreakdown: {
    accommodationSubtotal: number;
    taxPercent: number;
    taxAmount: number;
    discount: number;
    transportFare: number;
    commission: number;
    subtotal: number;
    total: number;
  };
};

export default function PaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);

  // Admin-controlled payment method availability (provider -> { isEnabled, reason }).
  // Missing entries default to enabled, matching the API's opt-out gate.
  const [paymentGates, setPaymentGates] = useState<Record<string, { isEnabled: boolean; reason: string | null }> | null>(null);
  const [paymentGateLoadFailed, setPaymentGateLoadFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/service-availability/payment-methods`, { cache: "no-store" });
        if (!res.ok) throw new Error("payment_gate_unavailable");
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error("invalid_payment_gate_response");
        if (mounted) {
          const map: Record<string, { isEnabled: boolean; reason: string | null }> = {};
          for (const pm of list) map[pm.provider] = { isEnabled: !!pm.isEnabled, reason: pm.reason ?? null };
          setPaymentGates(map);
          setPaymentGateLoadFailed(false);
        }
      } catch {
        if (mounted) setPaymentGateLoadFailed(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  const isProviderEnabled = (provider: string) => paymentGates !== null && (paymentGates[provider]?.isEnabled ?? true);
  const providerDisabledReason = (provider: string) =>
    paymentGates?.[provider]?.reason ||
    (paymentGateLoadFailed ? "Availability could not be verified. Refresh and try again." : "Checking availability…");

  // MNO state
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  // Bank state
  const [selectedBankCode, setSelectedBankCode] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankMobileNumber, setBankMobileNumber] = useState("");
  const [bankOtp, setBankOtp] = useState("");

  // Payment channel accordion (null = all collapsed)
  const [paymentChannel, setPaymentChannel] = useState<"MNO" | "BANK" | "CARD" | null>(null);

  useEffect(() => {
    if (!paymentGates) return;
    if (selectedMethod && !isProviderEnabled(selectedMethod.id)) setSelectedMethod(null);
    if (selectedBankCode && !isProviderEnabled(`BANK_${selectedBankCode}`)) setSelectedBankCode("");
    if (paymentChannel === "CARD" && !isProviderEnabled("CARD")) setPaymentChannel(null);
  }, [paymentGates, paymentChannel, selectedBankCode, selectedMethod]);

  const [paymentStatus, setPaymentStatus] = useState<"idle" | "pending" | "success" | "failed" | "timeout">("idle");
  const [authRequired, setAuthRequired] = useState(false);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(PAYMENT_WAIT_SECONDS);
  const [paymentCooldownSeconds, setPaymentCooldownSeconds] = useState(0);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const paymentReturnQuery = searchParams?.toString();
  const paymentReturnPath = `/public/booking/payment${paymentReturnQuery ? `?${paymentReturnQuery}` : ""}`;
  const loginHref = `/account/login?next=${encodeURIComponent(paymentReturnPath)}`;
  const registerHref = `/account/register?mode=register&role=traveller&next=${encodeURIComponent(paymentReturnPath)}`;

  const fetchInvoice = useCallback(
    async (invoiceId: number, accessToken: string) => {
      try {
        const url = new URL(`/api/public/invoices/${invoiceId}`, window.location.origin);
        url.searchParams.set("accessToken", accessToken);
        const response = await fetch(url.toString());

        if (!response.ok) {
          throw new Error("Failed to fetch invoice");
        }

        const data = await response.json();

        if (!data || !data.property || !data.property.id) {
          throw new Error("Invoice data is incomplete. Property information is missing.");
        }

        setInvoice(data);

        if (data.status === "PAID") {
          setPaymentStatus("success");
        }
      } catch (err: any) {
        setError(toDisplayMessage(err, "Failed to load invoice"));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Initial load + card return detection
  useEffect(() => {
    const invoiceIdParam = searchParams?.get("invoiceId");
    const accessToken    = searchParams?.get("accessToken");
    const cardReturn     = searchParams?.get("cardReturn");
    const cardRef        = searchParams?.get("ref");

    if (!invoiceIdParam) {
      setError("Missing invoice ID");
      setLoading(false);
      return;
    }

    if (!accessToken) {
      setError("Missing invoice access token");
      setLoading(false);
      return;
    }

    const invoiceIdNum = Number(invoiceIdParam);

    // Card return detection — AzamPay redirected back from hosted page
    if (cardReturn && cardRef) {
      if (cardReturn === "success") {
        setPaymentStatus("success");
        setPaymentChannel("CARD");
      } else if (cardReturn === "pending") {
        setPaymentRef(cardRef);
        setSubmitting(true);
        setPaymentStatus("pending");
        setPaymentChannel("CARD");
        startPolling(cardRef, invoiceIdNum);
      } else if (cardReturn === "failed") {
        setPaymentRef(cardRef);
        setSubmitting(false);
        setPaymentStatus("failed");
        setPaymentChannel("CARD");
        setError(CARD_VERIFICATION_FAILED_MESSAGE);
      }
    }

    fetchInvoice(invoiceIdNum, accessToken);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, fetchInvoice]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearTimeout(pollingIntervalRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Countdown timer for pending state
  useEffect(() => {
    if (paymentStatus !== "pending") {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      return;
    }

    setRemainingSeconds(PAYMENT_WAIT_SECONDS);
    const startedAt = Date.now();
    countdownIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const nextRemaining = PAYMENT_WAIT_SECONDS - elapsed;
      setRemainingSeconds(Math.max(0, nextRemaining));
      if (nextRemaining <= 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        setPaymentStatus((current) => (current === "pending" ? "timeout" : current));
        setSubmitting(false);
      }
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [paymentStatus]);

  // Cooldown timer (MNO rate-limit)
  useEffect(() => {
    if (paymentCooldownSeconds <= 0) return;

    const cooldownTimer = setInterval(() => {
      setPaymentCooldownSeconds((current) => {
        if (current <= 1) {
          setError((message) => (isPaymentCooldownMessage(message) ? null : message));
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(cooldownTimer);
  }, [paymentCooldownSeconds]);

  // ── Polling ──────────────────────────────────────────────────────────────────
  function startPolling(ref: string, overrideInvoiceId?: number) {
    if (pollingIntervalRef.current) {
      clearTimeout(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Allow overrideInvoiceId for card-return scenarios where invoice state hasn't loaded yet
    const invoiceId   = overrideInvoiceId ?? invoice?.id;
    const accessToken = searchParams?.get("accessToken");
    if (!invoiceId || !accessToken) return;

    const pollInvoice = async () => {
      const url = new URL(`/api/public/invoices/${invoiceId}`, window.location.origin);
      url.searchParams.set("accessToken", accessToken);
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to check invoice status");
      }
      const data = await response.json();
      setInvoice(data);

      if (data.status === "PAID") {
        if (pollingIntervalRef.current) {
          clearTimeout(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setPaymentStatus("success");
        setSubmitting(false);
        setError(null);
        return true;
      }

      return false;
    };

    void pollInvoice().catch((err) => {
      console.error("Initial payment polling error:", err);
    });

    let attempts = 0;
    const scheduleNextPoll = () => {
      if (attempts >= PAYMENT_POLL_MAX_ATTEMPTS) {
        pollingIntervalRef.current = null;
        return;
      }
      const delay = attempts < 20 ? PAYMENT_POLL_FAST_DELAY_MS : PAYMENT_POLL_SLOW_DELAY_MS;
      pollingIntervalRef.current = setTimeout(runPoll, delay);
    };

    const runPoll = async () => {
      attempts++;

      try {
        const completed = await pollInvoice();
        if (completed) {
          return;
        }
      } catch (err) {
        console.error("Payment polling error:", err, ref);
      }

      scheduleNextPoll();
    };

    scheduleNextPoll();
  }

  // ── Payment handlers ─────────────────────────────────────────────────────────

  async function handleMnoPayment() {
    if (paymentCooldownSeconds > 0) {
      setError(null);
      return;
    }

    if (!selectedMethod || !phoneNumber.trim() || !invoice) {
      setError("Please select a mobile network and enter your phone number");
      return;
    }
    if (!isProviderEnabled(selectedMethod.id)) {
      setError(providerDisabledReason(selectedMethod.id));
      return;
    }

    const phoneRegex = /^(\+255|255|0)?[0-9]{9}$/;
    const cleanedPhone = phoneNumber.replace(/\s+/g, "");
    if (!phoneRegex.test(cleanedPhone)) {
      setError("Please enter a valid phone number (e.g., +255 XXX XXX XXX)");
      return;
    }

    const localRetryAfter = registerPaymentAttempt(invoice.id, cleanedPhone);
    if (localRetryAfter > 0) {
      setPaymentCooldownSeconds(localRetryAfter);
      setPaymentStatus("failed");
      setError(null);
      return;
    }

    setError(null);
    setAuthRequired(false);
    setSubmitting(true);
    setPaymentStatus("pending");
    setRemainingSeconds(PAYMENT_WAIT_SECONDS);

    try {
      const response = await fetch(`/api/payments/azampay/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice.id,
          phoneNumber: cleanedPhone,
          provider: selectedMethod.id,
          accessToken: searchParams?.get("accessToken") || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setAuthRequired(true);
          setError(null);
          setSubmitting(false);
          setPaymentStatus("failed");
          return;
        }
        const retryAfterHeader = Number(response.headers.get("Retry-After"));
        const retryAfterSeconds = Number(result.retryAfterSeconds || retryAfterHeader || 0);
        const message = formatPaymentError(result.message ?? result.error, retryAfterSeconds);
        if (response.status === 429 && retryAfterSeconds > 0) {
          setPaymentCooldownSeconds(retryAfterSeconds);
          setError(null);
          setSubmitting(false);
          setPaymentStatus("failed");
          return;
        }
        throw new Error(message);
      }

      // MNO is a USSD push to the phone — the handset is the payment surface.
      // We deliberately ignore any checkoutUrl the API might return; redirecting
      // here would yank the user off the "check your phone" prompt and break the
      // push flow. The status poll + webhook are the source of truth.
      const ref = result.paymentRef || result.transactionId || invoice.paymentRef;
      setPaymentCooldownSeconds(0);
      setPaymentRef(ref);
      startPolling(ref);
    } catch (err: any) {
      setError(formatPaymentError(err));
      setSubmitting(false);
      setPaymentStatus("failed");
    }
  }

  async function handleBankPayment() {
    if (!invoice || !selectedBankCode) {
      setError("Please select a bank");
      return;
    }
    if (!isProviderEnabled(`BANK_${selectedBankCode}`)) {
      setError(providerDisabledReason(`BANK_${selectedBankCode}`));
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
    setAuthRequired(false);
    setSubmitting(true);
    setPaymentStatus("pending");
    setRemainingSeconds(PAYMENT_WAIT_SECONDS);

    try {
      const response = await fetch(`/api/payments/azampay/bank/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId:     invoice.id,
          bankCode:      selectedBankCode,
          accountNumber: bankAccountNumber.trim(),
          merchantMobileNumber: cleanedBankMobile,
          otp:           bankOtp.trim(),
          accessToken:   searchParams?.get("accessToken") || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setAuthRequired(true);
          setError(null);
          setSubmitting(false);
          setPaymentStatus("failed");
          return;
        }
        throw new Error(formatPaymentError(result.message ?? result.error));
      }

      const ref = result.paymentRef || result.transactionId;
      setPaymentRef(ref);
      setPaymentCooldownSeconds(0);
      startPolling(ref);
    } catch (err: any) {
      setError(formatPaymentError(err));
      setSubmitting(false);
      setPaymentStatus("failed");
    }
  }

  async function handleCardPayment() {
    if (!invoice) return;
    if (!isProviderEnabled("CARD")) {
      setError(providerDisabledReason("CARD"));
      return;
    }

    setError(null);
    setAuthRequired(false);
    setSubmitting(true);
    setPaymentStatus("pending");

    try {
      const response = await fetch(`/api/payments/coralcommerce/card/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId:   invoice.id,
          idempotencyKey: `coral-card-${invoice.id}-${Date.now()}`,
          accessToken: searchParams?.get("accessToken") || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setAuthRequired(true);
          setError(null);
          setSubmitting(false);
          setPaymentStatus("failed");
          return;
        }
        throw new Error(formatPaymentError(result.message ?? result.error));
      }

      if (result.checkoutUrl) {
        // Browser navigates to hosted checkout; callback returns with ?cardReturn=
        window.location.href = result.checkoutUrl;
        return; // keep submitting=true — page is navigating away
      }

      throw new Error("No checkout URL returned from payment provider");
    } catch (err: any) {
      setError(formatPaymentError(err));
      setSubmitting(false);
      setPaymentStatus("failed");
    }
  }

  // ── Accordion toggle ─────────────────────────────────────────────────────────
  function toggleChannel(channel: "MNO" | "BANK" | "CARD") {
    if (invoice?.draftAvailability && !invoice.draftAvailability.available) return;
    setPaymentChannel((prev) => (prev === channel ? null : channel));
    setError(null);
  }

  const draftUnavailable = Boolean(invoice?.draftAvailability && !invoice.draftAvailability.available);
  const reselectHref = invoice?.property?.slug
    ? `/public/properties/${encodeURIComponent(invoice.property.slug)}`
    : "/public/properties";
  const isDisabled = submitting || paymentCooldownSeconds > 0 || authRequired || draftUnavailable;
  const bankInstruction = selectedBankCode ? BANK_OTP_INSTRUCTIONS[selectedBankCode] : null;
  const bankReady = Boolean(selectedBankCode && bankAccountNumber.trim() && bankMobileNumber.trim() && bankOtp.trim());

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 px-4">
        <div className="w-full max-w-sm animate-in fade-in zoom-in-95 duration-500">
          {/* Spinner with concentric pulsing halos for visual energy */}
          <div className="relative mx-auto w-24 h-24 mb-6">
            <span className="absolute inset-0 rounded-full bg-blue-400/20 animate-ping" />
            <span className="absolute inset-2 rounded-full bg-blue-400/25 animate-pulse" />
            <span className="absolute inset-0 flex items-center justify-center">
              <LogoSpinner size="lg" ariaLabel="Loading" />
            </span>
          </div>

          {/* Title with sequential bouncing dots so the eye stays engaged */}
          <div className="text-center mb-6">
            <p className="text-slate-800 font-semibold text-lg inline-flex items-baseline justify-center gap-1.5">
              <span>Loading payment details</span>
              <span className="inline-flex items-baseline gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:300ms]" />
              </span>
            </p>
            <p className="text-slate-500 text-sm mt-2">Securing your booking session</p>
          </div>

          {/* Shimmer skeleton previewing the payment card that's about to appear */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5 space-y-3 overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-slate-200 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 rounded bg-slate-200 animate-pulse [animation-delay:100ms]" />
                <div className="h-2.5 w-1/2 rounded bg-slate-200/70 animate-pulse [animation-delay:150ms]" />
              </div>
            </div>
            <div className="border-t border-slate-100 my-1" />
            <div className="h-3 w-3/4 rounded bg-slate-200 animate-pulse [animation-delay:200ms]" />
            <div className="h-3 w-2/5 rounded bg-slate-200 animate-pulse [animation-delay:300ms]" />
            <div className="h-11 w-full rounded-xl bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-pulse [animation-delay:400ms] mt-4 bg-[length:200%_100%]" />
          </div>

          {/* Reassurance strip — subtle, professional */}
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-400">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
            </svg>
            <span>Encrypted connection</span>
          </div>
        </div>
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 p-6">
        <div className="max-w-md w-full bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border-2 border-red-200/60 p-8 text-center animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Error</h2>
          <p className="text-slate-600 mb-6 leading-relaxed">{error}</p>
          <Link
            href="/public/properties"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-gradient-to-r from-[#02665e] to-[#014e47] text-white font-semibold hover:from-[#014e47] hover:to-[#02665e] transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95"
          >
            Browse Properties
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 shadow-sm sticky top-0 z-10">
        <div className="public-container py-4">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 hover:bg-[#02665e] text-slate-600 hover:text-white transition-all duration-200 group shadow-sm hover:shadow-md"
            aria-label="Go back"
          >
            <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform duration-200" />
          </button>
        </div>
      </div>

      <div className="public-container py-8 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">

            {/* ── Success ── */}
            {paymentStatus === "success" && (
              <div className="bg-white border-2 border-emerald-200 rounded-2xl p-6 lg:p-8 shadow-lg animate-in fade-in slide-in-from-top-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-10 h-10 text-green-500" />
                </div>
                <h2 className="text-center text-2xl lg:text-3xl font-bold text-green-900 mb-3">
                  Payment Successful
                </h2>
                <p className="text-center text-green-700 font-medium">
                  Your booking is confirmed. Your booking code is ready in your account.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <Link
                    href="/account/bookings"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#02665e] px-5 py-3 font-semibold text-white no-underline shadow-md transition hover:bg-[#014e47] hover:no-underline"
                  >
                    <ReceiptText className="h-5 w-5" />
                    My Bookings
                  </Link>
                  {invoice && (
                    <Link
                      href={`/account/bookings?receiptBookingId=${invoice.booking.id}`}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 font-semibold text-emerald-800 no-underline transition hover:bg-emerald-100 hover:no-underline"
                    >
                      View Receipt
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* ── Pending ── */}
            {paymentStatus === "pending" && (
              <div className="bg-white border-2 border-blue-200 rounded-2xl p-6 lg:p-8 shadow-lg animate-in fade-in slide-in-from-top-4">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="mt-1 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
                      <LogoSpinner size="sm" ariaLabel="Processing" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-blue-950">
                        {paymentChannel === "CARD" ? "Verifying Card Payment" : "Waiting for Payment"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-blue-800">
                        {paymentChannel === "MNO"
                          ? "We sent a payment request to your phone. Keep this page open and approve the prompt on your mobile money account."
                          : paymentChannel === "BANK"
                          ? "We are confirming the bank checkout using the OTP you generated. Keep this page open while we verify the payment."
                          : "Please wait while we verify your card payment. Do not close this page."}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
                      <Clock3 className="h-4 w-4" />
                      Time left
                    </div>
                    <div className="mt-1 font-mono text-2xl font-black text-blue-950">
                      {formatCountdown(remainingSeconds)}
                    </div>
                  </div>
                </div>
                <div className="mt-6 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 sm:grid-cols-3">
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">Invoice</div>
                    <div className="mt-1 font-semibold text-slate-900">{invoice?.invoiceNumber || `#${invoice?.id}`}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">Amount</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {invoice?.totalAmount.toLocaleString()} {invoice?.currency}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">
                      {paymentChannel === "MNO" ? "Phone" : paymentChannel === "BANK" ? "Bank" : "Method"}
                    </div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {paymentChannel === "MNO"
                        ? (phoneNumber || invoice?.booking.guestPhone || "-")
                        : paymentChannel === "BANK"
                        ? (BANK_PROVIDERS.find((b) => b.code === selectedBankCode)?.name || selectedBankCode || "-")
                        : "Visa / Mastercard"}
                    </div>
                  </div>
                </div>
                {paymentRef && (
                  <p className="mt-4 text-xs text-slate-500">
                    Payment reference: <span className="font-mono">{paymentRef}</span>
                  </p>
                )}
              </div>
            )}

            {/* ── Timeout ── */}
            {paymentStatus === "timeout" && (
              <div className="bg-white border-2 border-amber-200 rounded-2xl p-6 lg:p-8 shadow-lg animate-in fade-in slide-in-from-top-4">
                <div className="flex items-start gap-4">
                  <div className="mt-1 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
                    <Clock3 className="h-6 w-6 text-amber-700" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-amber-950">Payment Not Confirmed Yet</h2>
                    <p className="mt-2 text-sm leading-6 text-amber-800">
                      Your booking details are still here. You do not need to choose the room again. If you did not approve the payment prompt, try sending a new payment request.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Failed ── */}
            {paymentStatus === "failed" && !authRequired && (
              <div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-lg shadow-rose-950/5 animate-in fade-in slide-in-from-top-4 lg:p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-rose-50 ring-1 ring-rose-100">
                    <AlertCircle className="h-5 w-5 text-rose-700" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-bold leading-tight text-slate-950 sm:text-2xl">
                      {paymentChannel === "CARD" ? "Card Payment Not Completed" : "Payment Request Failed"}
                    </h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      {paymentChannel === "CARD"
                        ? "Your booking is still saved and unpaid. You can try card again, or choose mobile money or bank transfer."
                        : "Your booking details are saved. Please review the details below and try again."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Payment method selection (shown when idle / failed / timeout) ── */}
            {(paymentStatus === "idle" || paymentStatus === "failed" || paymentStatus === "timeout") && draftUnavailable && (
              <div className="rounded-2xl border-2 border-rose-200 bg-white p-6 shadow-lg shadow-rose-950/5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-rose-50 ring-1 ring-rose-100">
                      <AlertCircle className="h-6 w-6 text-rose-700" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-slate-950">Selected room is no longer available</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {invoice?.draftAvailability?.message || "Please select another room or choose a different property before paying."}
                      </p>
                      <div className="mt-3 text-xs font-semibold text-rose-700">
                        Available now: {invoice?.draftAvailability?.availableRooms ?? 0} of {invoice?.draftAvailability?.requestedRooms ?? 1} requested
                      </div>
                    </div>
                  </div>
                  <Link
                    href={reselectHref}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-rose-700"
                  >
                    Select another room
                    <ChevronLeft className="h-4 w-4 rotate-180" />
                  </Link>
                </div>
              </div>
            )}

            {(paymentStatus === "idle" || paymentStatus === "failed" || paymentStatus === "timeout") && !draftUnavailable && (
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
                      <h2 className="text-sm font-bold text-slate-700 tracking-wide uppercase">
                        Choose How to Pay
                      </h2>
                    </>
                  )}
                </div>

                {/* Global error / cooldown display */}
                {error && !isPaymentCooldownMessage(error) && (
                  <div className="bg-red-50/80 border-2 border-red-200 rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm font-medium text-red-700">{error}</p>
                  </div>
                )}

                {paymentCooldownSeconds > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
                    <Clock3 className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <p className="text-sm font-medium text-amber-700">
                      Too many attempts — try again in {formatCountdown(paymentCooldownSeconds)}
                    </p>
                  </div>
                )}

                {/* ── Method selector: 3 standalone cards ── */}
                <div className="space-y-2.5">

                  {/* Mobile Money */}
                  {(!paymentChannel || paymentChannel === "MNO") && (
                    <button
                      type="button"
                      onClick={() => toggleChannel("MNO")}
                      className={`group w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all duration-200 ${
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
                        <div className={`font-bold text-[15px] transition-colors ${paymentChannel === "MNO" ? "text-red-900" : "text-slate-900"}`}>
                          Mobile Money
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 font-medium">Airtel · Mpesa · Tigo · HaloPesa</div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        paymentChannel === "MNO" ? "border-red-500 bg-red-500" : "border-slate-300"
                      }`}>
                        {paymentChannel === "MNO" && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </button>
                  )}

                  {/* Bank Transfer */}
                  {(!paymentChannel || paymentChannel === "BANK") && (
                    <button
                      type="button"
                      onClick={() => toggleChannel("BANK")}
                      className={`group w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all duration-200 ${
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
                        <div className={`font-bold text-[15px] transition-colors ${paymentChannel === "BANK" ? "text-green-900" : "text-slate-900"}`}>
                          Bank Transfer
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 font-medium">CRDB · NMB OTP checkout</div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        paymentChannel === "BANK" ? "border-green-600 bg-green-600" : "border-slate-300"
                      }`}>
                        {paymentChannel === "BANK" && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </button>
                  )}

                  {/* Debit / Credit Card */}
                  {(!paymentChannel || paymentChannel === "CARD") && (
                    <button
                      type="button"
                      disabled={!isProviderEnabled("CARD")}
                      aria-disabled={!isProviderEnabled("CARD")}
                      title={isProviderEnabled("CARD") ? undefined : providerDisabledReason("CARD")}
                      onClick={() => isProviderEnabled("CARD") && toggleChannel("CARD")}
                      className={`group w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all duration-200 ${
                        !isProviderEnabled("CARD")
                          ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed grayscale"
                          : paymentChannel === "CARD"
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
                        <div className={`font-bold text-[15px] transition-colors ${paymentChannel === "CARD" ? "text-violet-900" : "text-slate-900"}`}>
                          Debit / Credit Card
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 font-medium">
                          {isProviderEnabled("CARD") ? "Visa · Mastercard · Secure checkout" : providerDisabledReason("CARD")}
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        paymentChannel === "CARD" ? "border-violet-600 bg-violet-600" : "border-slate-300"
                      }`}>
                        {paymentChannel === "CARD" && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </button>
                  )}

                </div>

                {/* ── Form panel — appears below when a channel is selected ── */}
                {paymentChannel && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-5 lg:p-6 space-y-4">

                      {/* ── MNO form ── */}
                      {paymentChannel === "MNO" && (
                        <>
                          <div className="grid grid-cols-2 gap-3 lg:gap-4">
                            {PAYMENT_METHODS.map((method) => {
                              const enabled = isProviderEnabled(method.id);
                              return (
                                <button
                                  key={method.id}
                                  type="button"
                                  disabled={!enabled}
                                  aria-disabled={!enabled}
                                  onClick={() => enabled && setSelectedMethod(method)}
                                  title={enabled ? undefined : providerDisabledReason(method.id)}
                                  className={`group relative p-3.5 lg:p-4 rounded-lg border-2 transition-all duration-300 ${
                                    !enabled
                                      ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed grayscale"
                                      : selectedMethod?.id === method.id
                                        ? "border-[#02665e] bg-gradient-to-br from-[#02665e]/10 to-blue-50/50 shadow-md ring-2 ring-[#02665e]/20"
                                        : "border-slate-200 hover:border-[#02665e]/50 hover:shadow-md bg-white"
                                  }`}
                                >
                                  <div className="flex flex-col items-center text-center gap-2">
                                    <div className="relative h-16 w-24 flex-shrink-0">
                                      {method.icon ? (
                                        <Image
                                          src={method.icon}
                                          alt={method.name}
                                          fill
                                          sizes="96px"
                                          className={`object-contain ${method.id === "Azampesa" ? "mix-blend-multiply drop-shadow-none" : ""}`}
                                        />
                                      ) : (
                                        <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#02665e]/10 text-sm font-bold text-[#02665e]">
                                          AzamPesa
                                        </span>
                                      )}
                                    </div>
                                    <div className="w-full">
                                      <div className={`font-bold text-sm lg:text-base mb-0.5 ${
                                        selectedMethod?.id === method.id ? "text-[#02665e]" : "text-slate-900"
                                      }`}>
                                        {method.name}
                                      </div>
                                      <div className="text-xs text-slate-600">
                                        {enabled ? method.description : providerDisabledReason(method.id)}
                                      </div>
                                    </div>
                                    {selectedMethod?.id === method.id && enabled && (
                                      <div className="absolute top-1.5 right-1.5">
                                        <div className="w-5 h-5 rounded-full bg-[#02665e] flex items-center justify-center shadow-md">
                                          <CheckCircle2 className="w-3 h-3 text-white" />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          <div className="min-w-0">
                            <label className="flex w-full text-sm font-semibold text-slate-700 mb-3 items-center gap-2">
                              <Smartphone className="w-4 h-4 text-[#02665e] flex-shrink-0" />
                              <span>Phone Number <span className="text-red-500">*</span></span>
                            </label>
                            <input
                              type="tel"
                              value={phoneNumber}
                              onChange={(e) => setPhoneNumber(e.target.value)}
                              placeholder="+255 XXX XXX XXX"
                              className="w-full min-w-0 px-4 py-3.5 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all duration-200 text-slate-900 font-medium bg-white shadow-sm hover:shadow-md box-border"
                            />
                            {selectedMethod && (
                              <p className="text-xs text-slate-500 mt-2 ml-1">
                                Enter the number linked to your {selectedMethod.name} account
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={handleMnoPayment}
                            disabled={isDisabled || !selectedMethod || !phoneNumber.trim() || !isProviderEnabled(selectedMethod.id)}
                            className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-[#02665e] to-[#014e47] text-white font-semibold hover:from-[#014e47] hover:to-[#02665e] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
                          >
                            {submitting ? (
                              <>
                                <LogoSpinner size="sm" ariaLabel="Loading" className="text-white/90" />
                                <span>Initiating payment...</span>
                              </>
                            ) : paymentCooldownSeconds > 0 ? (
                              <>
                                <Clock3 className="w-5 h-5" />
                                <span>Try again in {formatCountdown(paymentCooldownSeconds)}</span>
                              </>
                            ) : (
                              <>
                                {paymentStatus === "failed" || paymentStatus === "timeout"
                                  ? <RefreshCw className="w-5 h-5" />
                                  : <Smartphone className="w-5 h-5" />
                                }
                                <span>
                                  {paymentStatus === "failed" || paymentStatus === "timeout"
                                    ? "Send payment request again"
                                    : "Continue to Mobile Payment"}{" "}
                                  {invoice?.totalAmount.toLocaleString()} {invoice?.currency}
                                </span>
                              </>
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
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                              Select Bank <span className="text-red-500">*</span>
                            </label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {BANK_PROVIDERS.map((bank) => {
                                const active = selectedBankCode === bank.code;
                                const enabled = isProviderEnabled(`BANK_${bank.code}`);
                                return (
                                  <button
                                    key={bank.code}
                                    type="button"
                                    disabled={!enabled}
                                    aria-disabled={!enabled}
                                    title={enabled ? undefined : providerDisabledReason(`BANK_${bank.code}`)}
                                    onClick={() => enabled && setSelectedBankCode(bank.code)}
                                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                                      !enabled
                                        ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed grayscale"
                                        : active
                                          ? bank.activeClass
                                          : "border-slate-200 bg-white text-slate-800 hover:border-emerald-200 hover:bg-emerald-50/40"
                                    }`}
                                  >
                                    <span className="relative flex h-11 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg">
                                      <Image src={bank.logo} alt={`${bank.name} logo`} fill sizes="56px" className="object-contain" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-sm font-bold">{bank.name}</span>
                                      <span className="mt-0.5 block text-xs text-slate-500">
                                        {enabled ? `${bank.code} SIM banking OTP` : providerDisabledReason(`BANK_${bank.code}`)}
                                      </span>
                                    </span>
                                    <span className={`h-4 w-4 rounded-full border-2 ${active && enabled ? bank.dotClass : "border-slate-300"}`} />
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
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                              Account Number <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={bankAccountNumber}
                              onChange={(e) => setBankAccountNumber(e.target.value)}
                              placeholder="Account number selected for OTP"
                              maxLength={30}
                              className="block box-border w-full max-w-full min-w-0 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all bg-slate-50 focus:bg-white text-slate-900 text-sm font-mono tracking-wide"
                            />
                            <p className="mt-1.5 max-w-full break-words text-xs leading-5 text-slate-500">Use the same account you selected while generating the OTP.</p>
                          </div>

                          <div className="min-w-0 max-w-full overflow-hidden">
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                              Bank Registered Mobile Number <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="tel"
                              value={bankMobileNumber}
                              onChange={(e) => setBankMobileNumber(e.target.value)}
                              placeholder="+255 XXX XXX XXX"
                              maxLength={15}
                              className="block box-border w-full max-w-full min-w-0 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all bg-slate-50 focus:bg-white text-slate-900 text-sm"
                            />
                            <p className="mt-1.5 max-w-full break-words text-xs leading-5 text-slate-500">This is the number registered for SIM banking on that bank account.</p>
                          </div>

                          <div className="min-w-0 max-w-full overflow-hidden">
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                              Bank OTP <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={bankOtp}
                              onChange={(e) => setBankOtp(e.target.value)}
                              placeholder="Enter OTP from bank menu"
                              maxLength={50}
                              className="block box-border w-full max-w-full min-w-0 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all bg-slate-50 focus:bg-white text-slate-900 text-sm font-mono tracking-wide"
                            />
                            <p className="mt-1.5 max-w-full break-words text-xs leading-5 text-slate-500">The OTP comes from the bank menu, not from NoLSAF.</p>
                          </div>

                          <button
                            type="button"
                            onClick={handleBankPayment}
                            disabled={isDisabled || !bankReady || !isProviderEnabled(`BANK_${selectedBankCode}`)}
                            className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-[#02665e] to-[#014e47] text-white font-semibold hover:from-[#014e47] hover:to-[#02665e] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
                          >
                            {submitting ? (
                              <>
                                <LogoSpinner size="sm" ariaLabel="Loading" className="text-white/90" />
                                <span>Initiating bank payment...</span>
                              </>
                            ) : (
                              <>
                                {paymentStatus === "failed" || paymentStatus === "timeout"
                                  ? <RefreshCw className="w-5 h-5" />
                                  : <Building2 className="w-5 h-5" />
                                }
                                <span>
                                  {paymentStatus === "failed" || paymentStatus === "timeout"
                                    ? "Try bank payment again"
                                    : "Continue to Bank Transfer"}{" "}
                                  {invoice?.totalAmount.toLocaleString()} {invoice?.currency}
                                </span>
                              </>
                            )}
                          </button>
                        </>
                      )}

                      {/* ── Card form ── */}
                      {paymentChannel === "CARD" && (
                        <>
                          <div className="flex items-start gap-3 p-4 bg-violet-50 rounded-xl border border-violet-100">
                            <ShieldCheck className="w-5 h-5 text-violet-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <div className="font-semibold text-slate-900 text-sm mb-1">Secure Hosted Checkout</div>
                              <div className="text-xs text-slate-600 leading-relaxed">
                                You will be redirected to a secure hosted card checkout page. After completing payment you will be brought back here automatically.
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={handleCardPayment}
                            disabled={isDisabled || !isProviderEnabled("CARD")}
                            className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-violet-600 to-violet-700 text-white font-semibold hover:from-violet-700 hover:to-violet-800 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
                          >
                            {submitting ? (
                              <>
                                <LogoSpinner size="sm" ariaLabel="Loading" className="text-white/90" />
                                <span>Redirecting to checkout...</span>
                              </>
                            ) : (
                              <>
                                <CreditCard className="w-5 h-5" />
                                <span>
                                  {paymentStatus === "failed" || paymentStatus === "timeout"
                                    ? "Try Card Payment Again"
                                    : "Continue to Card Payment"}{" "}
                                  {invoice?.totalAmount.toLocaleString()} {invoice?.currency}
                                </span>
                              </>
                            )}
                          </button>
                        </>
                      )}

                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar - Booking Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/60 p-6 lg:p-8 sticky top-8 transition-all duration-300 hover:shadow-xl">
              <h2 className="text-xl lg:text-2xl font-bold text-slate-900 mb-6 lg:mb-8">
                Booking Summary
              </h2>

              {invoice && (
                <div className="space-y-5">
                  {invoice.property.primaryImage && (
                    <div className="relative w-full h-40 lg:h-48 rounded-xl overflow-hidden shadow-md ring-2 ring-slate-100">
                      <Image
                        src={invoice.property.primaryImage}
                        alt={invoice.property.title}
                        fill
                        sizes="(max-width: 1024px) 100vw, 384px"
                        className="object-cover"
                        loading="eager"
                        priority
                      />
                    </div>
                  )}

                  {/* Property */}
                  <div className="pb-4 border-b border-slate-200/60">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Property</div>
                    <div className="text-lg font-bold text-slate-900 leading-tight">
                      {invoice.property.title}
                    </div>
                    {invoice.property.type && (
                      <div className="text-sm text-slate-600 mt-1">
                        {invoice.property.type}
                      </div>
                    )}
                  </div>

                  {/* Guest Information */}
                  {(invoice.booking.guestName || invoice.booking.guestPhone) && (
                    <div className="pb-4 border-b border-slate-200/60">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Guest Information</div>
                      {invoice.booking.guestName && (
                        <div className="mb-2">
                          <div className="text-xs text-slate-500 mb-1">Name</div>
                          <div className="text-sm font-semibold text-slate-900">
                            {invoice.booking.guestName}
                          </div>
                        </div>
                      )}
                      {invoice.booking.guestPhone && (
                        <div>
                          <div className="text-xs text-slate-500 mb-1">Phone</div>
                          <div className="text-sm font-semibold text-slate-900">
                            {invoice.booking.guestPhone}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Check-in & Check-out */}
                  <div className="pb-4 border-b border-slate-200/60">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Dates</div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Check-in</div>
                        <div className="text-sm font-semibold text-slate-900">
                          {new Date(invoice.booking.checkIn).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Check-out</div>
                        <div className="text-sm font-semibold text-slate-900">
                          {new Date(invoice.booking.checkOut).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-200/60">
                      <div className="text-xs text-slate-500 mb-1">Duration</div>
                      <div className="text-sm font-semibold text-slate-900">
                        {invoice.booking.nights} night{invoice.booking.nights !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>

                  {/* Room Type */}
                  {invoice.booking.roomCode && (
                    <div className="pb-4 border-b border-slate-200/60">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Room</div>
                      <div className="text-sm font-semibold text-slate-900">
                        {invoice.booking.roomCode}
                      </div>
                    </div>
                  )}

                  {/* Price Breakdown */}
                  <div className="pb-4 border-b border-slate-200/60">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Price Breakdown</div>
                    <div className="space-y-2.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">
                          Accommodation ({invoice.booking.nights} night{invoice.booking.nights !== 1 ? "s" : ""}
                          {invoice.booking.roomsQty && invoice.booking.roomsQty > 1 ? ` × ${invoice.booking.roomsQty} rooms` : ""})
                        </span>
                        <span className="font-semibold text-slate-900">
                          {invoice.priceBreakdown?.accommodationSubtotal.toLocaleString() || (invoice.property.basePrice * invoice.booking.nights).toLocaleString()} {invoice.currency}
                        </span>
                      </div>

                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">
                          Tax {invoice.priceBreakdown?.taxPercent && invoice.priceBreakdown.taxPercent > 0 ? `(${invoice.priceBreakdown.taxPercent}%)` : ""}
                        </span>
                        <span className={`font-semibold ${invoice.priceBreakdown?.taxAmount && invoice.priceBreakdown.taxAmount > 0 ? "text-slate-900" : "text-slate-400"}`}>
                          {invoice.priceBreakdown?.taxAmount ? invoice.priceBreakdown.taxAmount.toLocaleString() : "0"} {invoice.currency}
                        </span>
                      </div>

                      {(invoice.booking.includeTransport || (invoice.priceBreakdown?.transportFare && invoice.priceBreakdown.transportFare > 0)) && (
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Transportation</span>
                          <span className="font-semibold text-slate-900">
                            {invoice.priceBreakdown?.transportFare ? invoice.priceBreakdown.transportFare.toLocaleString() : "0"} {invoice.currency}
                          </span>
                        </div>
                      )}

                      {invoice.priceBreakdown?.subtotal !== undefined && (
                        <div className="flex justify-between text-sm pt-2 border-t border-slate-200/60">
                          <span className="font-medium text-slate-700">Subtotal</span>
                          <span className="font-semibold text-slate-900">
                            {invoice.priceBreakdown.subtotal.toLocaleString()} {invoice.currency}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between text-sm">
                        <span className={`font-medium ${invoice.priceBreakdown?.discount && invoice.priceBreakdown.discount > 0 ? "text-green-600" : "text-slate-400"}`}>
                          Discount
                        </span>
                        <span className={`font-semibold ${invoice.priceBreakdown?.discount && invoice.priceBreakdown.discount > 0 ? "text-green-600" : "text-slate-400"}`}>
                          {invoice.priceBreakdown?.discount && invoice.priceBreakdown.discount > 0 ? "-" : ""}{invoice.priceBreakdown?.discount ? invoice.priceBreakdown.discount.toLocaleString() : "0"} {invoice.currency}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Total */}
                  <div className="pt-2 pb-4 border-b border-slate-200/60">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-bold text-slate-900">Total</span>
                      <span className="text-2xl font-bold text-[#02665e]">
                        {invoice.totalAmount.toLocaleString()} {invoice.currency}
                      </span>
                    </div>
                  </div>

                  {/* Secure Payment */}
                  <div className="pt-4">
                    <div className="flex items-start gap-3 p-4 bg-gradient-to-br from-slate-50 to-blue-50/50 rounded-xl border border-slate-200/60">
                      <ShieldCheck className="w-5 h-5 text-[#02665e] flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold text-slate-900 mb-1 text-sm">
                          Secure Payment
                        </div>
                        <div className="text-xs text-slate-600 leading-relaxed">
                          Your payment is processed securely through our payment partners.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Auth Required Modal */}
      {authRequired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-emerald-100 bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.24)] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-[#02665e] ring-1 ring-emerald-100">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold leading-tight text-slate-950">
                  Sign in to continue payment
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Your booking is still reserved. You will return here after sign in.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Link
                href={loginHref}
                className="inline-flex items-center justify-center rounded-2xl bg-[#02665e] px-4 py-3 text-sm font-semibold text-white no-underline shadow-md transition hover:bg-[#014e47] hover:no-underline"
                style={{ textDecoration: "none" }}
              >
                Sign in
              </Link>
              <Link
                href={registerHref}
                className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 no-underline transition hover:bg-emerald-100 hover:no-underline"
                style={{ textDecoration: "none" }}
              >
                Create account
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
