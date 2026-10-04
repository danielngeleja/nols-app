"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronLeft,
  Check,
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
import PremiumLoader from "@/components/PremiumLoader";
import { tzNetworkForNumber, type TzMobileNetwork } from "@/lib/tzMobileNetworks";

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
  /** Guest confirmed their number was ported to the chosen wallet's network */
  const [portedNumberConfirmed, setPortedNumberConfirmed] = useState(false);

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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white via-[#02665e]/[0.04] to-white px-4">
        <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-500">
          {/* The shape of the real payment card, so nothing jumps when it arrives */}
          <div className="box-border overflow-hidden rounded-2xl border border-solid border-[#02665e]/15 bg-white shadow-lg">
            <div className="flex items-center gap-4 border-0 border-b border-solid border-slate-100 p-5">
              <span className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#02665e]/10">
                <span className="absolute inset-0 animate-ping rounded-2xl bg-[#02665e]/10" aria-hidden />
                <span className="relative">
                  <PremiumLoader size="sm" label="" ariaLabel="Loading payment details" />
                </span>
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[17px] font-bold leading-tight text-slate-950">Preparing your payment</p>
                <p className="m-0 mt-1 text-[13.5px] leading-5 text-slate-500">Securing your booking session</p>
              </div>
            </div>

            {/* Indeterminate rail: the same one pixel rail the live card uses */}
            <div className="h-1 w-full overflow-hidden bg-slate-100" role="presentation">
              <div className="h-full w-1/4 animate-shimmer rounded-full bg-[#02665e]/70" />
            </div>

            <div className="space-y-3 p-5">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 flex-shrink-0 animate-pulse rounded-xl bg-slate-200" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200 [animation-delay:100ms]" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-slate-200/70 [animation-delay:150ms]" />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="h-14 animate-pulse rounded-xl bg-slate-100 [animation-delay:200ms]" />
                <div className="h-14 animate-pulse rounded-xl bg-slate-100 [animation-delay:250ms]" />
                <div className="h-14 animate-pulse rounded-xl bg-slate-100 [animation-delay:300ms]" />
              </div>
              <div className="h-11 w-full animate-pulse rounded-xl bg-slate-200 [animation-delay:400ms]" />
            </div>
          </div>

          <p className="m-0 mt-4 flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-slate-500">
            <ShieldCheck className="h-4 w-4 text-[#02665e]" aria-hidden />
            Encrypted connection
          </p>
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
              <div className="box-border overflow-hidden rounded-2xl border border-solid border-[#02665e]/25 bg-white shadow-lg animate-in fade-in slide-in-from-top-4">
                <div className="p-6 text-center lg:p-8">
                  <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#02665e]/10">
                    <CheckCircle2 className="h-9 w-9 text-[#02665e]" aria-hidden />
                  </span>
                  <h2 className="m-0 mt-4 text-[24px] font-bold leading-tight text-slate-950 lg:text-[28px]">
                    Payment successful
                  </h2>
                  <p className="m-0 mx-auto mt-2 max-w-md text-[14.5px] leading-6 text-slate-600">
                    Your booking is confirmed{invoice?.property?.title ? ` at ${invoice.property.title}` : ""}. Keep the
                    booking code for check in.
                  </p>

                  {invoice?.booking?.bookingCode ? (
                    <div className="mx-auto mt-5 box-border flex max-w-sm flex-col items-center rounded-xl border border-solid border-[#02665e]/25 bg-[#02665e]/5 px-5 py-4">
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#02665e]">Booking code</span>
                      <span className="mt-1 font-mono text-[22px] font-black tracking-[0.08em] text-slate-950">
                        {invoice.booking.bookingCode}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* What was paid, in the same panel as the waiting card */}
                <div className="box-border grid divide-y divide-solid divide-slate-200 border-0 border-t border-solid border-slate-100 bg-slate-50/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                  <div className="px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Invoice</div>
                    <div className="mt-1 truncate text-[14px] font-semibold text-slate-900">
                      {invoice?.invoiceNumber || `#${invoice?.id}`}
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Amount paid</div>
                    <div className="mt-1 text-[16px] font-bold tabular-nums text-[#02665e]">
                      {invoice?.totalAmount.toLocaleString()} {invoice?.currency}
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Stay</div>
                    <div className="mt-1 truncate text-[14px] font-semibold text-slate-900">
                      {invoice?.booking?.nights
                        ? `${invoice.booking.nights} ${invoice.booking.nights === 1 ? "night" : "nights"}`
                        : "Confirmed"}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 p-5 sm:grid-cols-2 lg:p-6">
                  <Link
                    href="/account/bookings"
                    className="box-border inline-flex items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 py-3 text-[14.5px] font-semibold text-white no-underline shadow-md transition hover:bg-[#014e47] hover:no-underline"
                  >
                    <ReceiptText className="h-5 w-5" aria-hidden />
                    My bookings
                  </Link>
                  {invoice && (
                    <Link
                      href={`/account/bookings?receiptBookingId=${invoice.booking.id}`}
                      className="box-border inline-flex items-center justify-center gap-2 rounded-xl border border-solid border-[#02665e]/30 bg-white px-5 py-3 text-[14.5px] font-semibold text-[#02665e] no-underline transition hover:bg-[#02665e]/5 hover:no-underline"
                    >
                      View receipt
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* ── Pending ── */}
            {paymentStatus === "pending" && (() => {
              // Three steps, worded for the channel the guest actually used.
              const steps =
                paymentChannel === "MNO"
                  ? ["Request sent to your phone", "Approve the prompt", "Booking confirmed"]
                  : paymentChannel === "BANK"
                  ? ["Bank checkout opened", "Bank confirming the OTP", "Booking confirmed"]
                  : ["Card details submitted", "Your bank is verifying", "Booking confirmed"];
              const elapsedPct = Math.max(
                0,
                Math.min(100, ((PAYMENT_WAIT_SECONDS - remainingSeconds) / PAYMENT_WAIT_SECONDS) * 100)
              );
              const running = remainingSeconds > 0;

              return (
              <div className="box-border overflow-hidden rounded-2xl border border-solid border-[#02665e]/20 bg-white shadow-lg animate-in fade-in slide-in-from-top-4">
                {/* Header: what is happening, and how long is left */}
                <div className="flex flex-col gap-4 border-0 border-b border-solid border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between lg:p-6">
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#02665e]/10">
                      <span className="absolute inset-0 animate-ping rounded-2xl bg-[#02665e]/10" aria-hidden />
                      <span className="relative">
                        <LogoSpinner size="sm" ariaLabel="Processing" />
                      </span>
                    </span>
                    <div className="min-w-0">
                      <h2 className="m-0 text-[20px] font-bold leading-tight text-slate-950 sm:text-[22px]">
                        {paymentChannel === "CARD"
                          ? "Verifying your card payment"
                          : paymentChannel === "BANK"
                          ? "Confirming your bank payment"
                          : "Waiting for your approval"}
                      </h2>
                      <p className="m-0 mt-1 text-[14px] leading-5 text-slate-600">
                        {paymentChannel === "MNO"
                          ? "We sent a payment request to your phone. Approve the prompt to confirm this booking."
                          : paymentChannel === "BANK"
                          ? "We are confirming the bank checkout using the OTP you generated."
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

                {/* How far through the waiting window we are */}
                <div className="h-1 w-full bg-slate-100" role="presentation">
                  <div
                    className="h-full bg-[#02665e] transition-all duration-1000 ease-linear"
                    style={{ width: `${elapsedPct}%` }}
                  />
                </div>

                <div className="p-5 lg:p-6">
                  {/* Where the payment has reached */}
                  <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
                    {steps.map((label, index) => {
                      const done = index === 0;
                      const active = index === 1;
                      return (
                        <li
                          key={label}
                          className={`box-border flex items-center gap-2.5 rounded-xl border border-solid px-3 py-2.5 ${
                            active
                              ? "border-[#02665e]/30 bg-[#02665e]/5"
                              : done
                              ? "border-slate-200 bg-white"
                              : "border-slate-200 bg-slate-50"
                          }`}
                        >
                          <span
                            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                              done
                                ? "bg-[#02665e] text-white"
                                : active
                                ? "bg-[#02665e]/15 text-[#02665e]"
                                : "bg-slate-200 text-slate-500"
                            }`}
                          >
                            {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                          </span>
                          <span className={`min-w-0 text-[13px] font-semibold leading-tight ${active ? "text-[#02665e]" : done ? "text-slate-700" : "text-slate-500"}`}>
                            {label}
                          </span>
                          {active ? (
                            <span className="ml-auto flex-shrink-0">
                              <span className="block h-2 w-2 animate-pulse rounded-full bg-[#02665e]" aria-hidden />
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>

                  {/* What is being paid */}
                  <div className="mt-4 box-border grid divide-y divide-solid divide-slate-200 rounded-xl border border-solid border-slate-200 bg-slate-50/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                    <div className="px-4 py-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Invoice</div>
                      <div className="mt-1 truncate text-[14px] font-semibold text-slate-900">
                        {invoice?.invoiceNumber || `#${invoice?.id}`}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Amount</div>
                      <div className="mt-1 text-[16px] font-bold tabular-nums text-slate-950">
                        {invoice?.totalAmount.toLocaleString()} {invoice?.currency}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                        {paymentChannel === "MNO" ? "Phone" : paymentChannel === "BANK" ? "Bank" : "Method"}
                      </div>
                      <div className="mt-1 truncate text-[14px] font-semibold text-slate-900">
                        {paymentChannel === "MNO"
                          ? (phoneNumber || invoice?.booking.guestPhone || "-")
                          : paymentChannel === "BANK"
                          ? (BANK_PROVIDERS.find((b) => b.code === selectedBankCode)?.name || selectedBankCode || "-")
                          : "Visa / Mastercard"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                      <ShieldCheck className="h-4 w-4 text-[#02665e]" aria-hidden />
                      Keep this page open until it finishes.
                    </span>
                    {paymentRef && (
                      <span>
                        Reference <span className="font-mono text-slate-700">{paymentRef}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
              );
            })()}

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
                {/* Header: step title, or a way back once a method is chosen */}
                <div className="flex min-h-[40px] items-center justify-between gap-3 px-1">
                  {paymentChannel ? (
                    <button
                      type="button"
                      onClick={() => { setPaymentChannel(null); setError(null); }}
                      className="group inline-flex items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-[13.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#02665e]"
                    >
                      <ChevronLeft className="h-4 w-4 transition-transform duration-150 group-hover:-translate-x-0.5" />
                      Change payment method
                    </button>
                  ) : (
                    <div className="min-w-0">
                      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-[#02665e]">Payment</p>
                      <h2 className="m-0 text-[20px] font-bold leading-tight text-slate-900">How would you like to pay?</h2>
                    </div>
                  )}
                  <span className="inline-flex flex-none items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                    Secure
                  </span>
                </div>

                {/* Global error / cooldown display */}
                {error && !isPaymentCooldownMessage(error) && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-inset ring-rose-200" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-rose-500" />
                    <p className="m-0 text-[13.5px] font-medium text-rose-700">{error}</p>
                  </div>
                )}

                {paymentCooldownSeconds > 0 && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-inset ring-amber-200">
                    <Clock3 className="h-4 w-4 flex-none text-amber-600" />
                    <p className="m-0 text-[13.5px] font-medium text-amber-800">
                      Too many attempts. Try again in {formatCountdown(paymentCooldownSeconds)}.
                    </p>
                  </div>
                )}

                {/* Method selector */}
                <div className="space-y-2.5" role="radiogroup" aria-label="Payment method">
                  {([
                    {
                      channel: "MNO" as const,
                      title: "Mobile money",
                      hint: "Pay from your mobile wallet",
                      Icon: Smartphone,
                      logos: [
                        { src: "/assets/M-pesa.png", alt: "M-Pesa" },
                        { src: "/assets/airtel_money.png", alt: "Airtel Money" },
                        { src: "/assets/mix%20by%20yas.png", alt: "Mixx by Yas" },
                        { src: "/assets/halopesa.png", alt: "HaloPesa" },
                      ],
                      enabled: true,
                      reason: "",
                    },
                    {
                      channel: "BANK" as const,
                      title: "Bank account",
                      hint: "Pay from your bank with SIM banking OTP",
                      Icon: Building2,
                      logos: [
                        { src: "/assets/NoLSAF_CRDB.png", alt: "CRDB Bank" },
                        { src: "/assets/NoLSAF_NMB.png", alt: "NMB Bank" },
                      ],
                      enabled: true,
                      reason: "",
                    },
                    {
                      channel: "CARD" as const,
                      title: "Debit or credit card",
                      hint: "Secure hosted checkout",
                      Icon: CreditCard,
                      logos: [
                        { src: "/assets/visa_card.png", alt: "Visa" },
                        { src: "/assets/Mastercard_Logo.png", alt: "Mastercard" },
                      ],
                      enabled: isProviderEnabled("CARD"),
                      reason: providerDisabledReason("CARD"),
                    },
                  ])
                    .filter((m) => !paymentChannel || paymentChannel === m.channel)
                    .map((m) => {
                      const on = paymentChannel === m.channel;
                      return (
                        <button
                          key={m.channel}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={!m.enabled}
                          aria-disabled={!m.enabled}
                          title={m.enabled ? undefined : m.reason}
                          onClick={() => m.enabled && toggleChannel(m.channel)}
                          className={`group box-border flex w-full items-center gap-3.5 rounded-xl border border-solid px-4 py-3.5 text-left transition-all sm:gap-4 sm:px-5 ${
                            !m.enabled
                              ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                              : on
                                ? "border-[#02665e] bg-[#02665e]/[0.04] shadow-[0_10px_24px_-18px_rgba(2,102,94,0.7)]"
                                : "border-slate-200 bg-white hover:-translate-y-px hover:border-[#02665e]/40 hover:shadow-[0_10px_24px_-20px_rgba(15,23,42,0.4)]"
                          }`}
                        >
                          <span
                            className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl transition-colors ${
                              on ? "bg-[#02665e] text-white" : "bg-[#02665e]/10 text-[#02665e] group-hover:bg-[#02665e]/15"
                            }`}
                          >
                            <m.Icon className="h-5 w-5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-[15px] font-semibold ${on ? "text-[#02665e]" : "text-slate-900"}`}>{m.title}</span>
                            <span className="mt-0.5 block truncate text-[12.5px] text-slate-500">{m.enabled ? m.hint : m.reason}</span>
                            {/* Provider logos, so people recognise their own wallet or bank */}
                            <span className="mt-2 flex flex-wrap items-center gap-1.5">
                              {m.logos.map((logo) => (
                                <span
                                  key={logo.alt}
                                  title={logo.alt}
                                  className="box-border flex h-7 w-11 items-center justify-center rounded-md border border-solid border-slate-200 bg-white p-1"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={logo.src} alt={logo.alt} className="max-h-full max-w-full object-contain" />
                                </span>
                              ))}
                            </span>
                          </span>
                          <span
                            aria-hidden
                            className={`box-border flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 border-solid transition-colors ${
                              on ? "border-[#02665e]" : "border-slate-300 group-hover:border-[#02665e]/50"
                            }`}
                          >
                            {on && <span className="h-2.5 w-2.5 rounded-full bg-[#02665e]" />}
                          </span>
                        </button>
                      );
                    })}
                </div>

                {/* ── Form panel — appears below when a channel is selected ── */}
                {paymentChannel && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-5 lg:p-6 space-y-4">

                      {/* ── MNO form ── */}
                      {paymentChannel === "MNO" && (
                        <>
                          <div>
                            <p className="m-0 mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">Choose your wallet</p>
                            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Mobile money wallet">
                              {PAYMENT_METHODS.map((method) => {
                                const enabled = isProviderEnabled(method.id);
                                const on = enabled && selectedMethod?.id === method.id;
                                // Customers know Tigo Pesa by its new brand name
                                const label = method.id === "Tigo" ? "Mixx by Yas" : method.name;
                                return (
                                  <button
                                    key={method.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={on}
                                    disabled={!enabled}
                                    aria-disabled={!enabled}
                                    onClick={() => {
                                      if (!enabled) return;
                                      setSelectedMethod(method);
                                      setPortedNumberConfirmed(false);
                                    }}
                                    title={enabled ? undefined : providerDisabledReason(method.id)}
                                    className={`group box-border flex w-full items-center gap-3 rounded-xl border border-solid px-3 py-2.5 text-left transition-all ${
                                      !enabled
                                        ? "cursor-not-allowed border-dashed border-slate-200 bg-slate-50"
                                        : on
                                          ? "border-[#02665e] bg-[#02665e]/[0.05] shadow-[0_8px_20px_-16px_rgba(2,102,94,0.8)]"
                                          : "border-slate-200 bg-white hover:border-[#02665e]/40"
                                    }`}
                                  >
                                    <span
                                      className={`relative box-border block h-11 w-14 flex-none overflow-hidden rounded-lg border border-solid bg-white ${
                                        on ? "border-[#02665e]/30" : "border-slate-200"
                                      } ${enabled ? "" : "opacity-50 grayscale"}`}
                                    >
                                      {method.icon ? (
                                        // Inset box keeps the logo whole and centred (padding on a fill image would crop it)
                                        <span className="absolute inset-1.5 block">
                                          <Image
                                            src={method.icon}
                                            alt=""
                                            fill
                                            sizes="48px"
                                            className={`object-contain object-center ${method.id === "Azampesa" ? "mix-blend-multiply" : ""}`}
                                          />
                                        </span>
                                      ) : (
                                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[#02665e]">{label}</span>
                                      )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className={`block truncate text-[14px] font-semibold ${!enabled ? "text-slate-400" : on ? "text-[#02665e]" : "text-slate-900"}`}>
                                        {label}
                                      </span>
                                      {enabled ? (
                                        <span className="block truncate text-[12px] text-slate-500">{on ? "Selected" : "Tap to pay with this"}</span>
                                      ) : (
                                        <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-slate-200/70 px-1.5 py-px text-[10.5px] font-semibold text-slate-500">
                                          <Clock3 className="h-3 w-3" aria-hidden />
                                          Unavailable now
                                        </span>
                                      )}
                                    </span>
                                    {enabled && (
                                      <span
                                        aria-hidden
                                        className={`box-border flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 border-solid transition-colors ${
                                          on ? "border-[#02665e]" : "border-slate-300 group-hover:border-[#02665e]/50"
                                        }`}
                                      >
                                        {on && <span className="h-2.5 w-2.5 rounded-full bg-[#02665e]" />}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {(() => {
                            const wallet = selectedMethod && isProviderEnabled(selectedMethod.id) ? selectedMethod : null;
                            const walletName = wallet ? (wallet.id === "Tigo" ? "Mixx by Yas" : wallet.name) : "";
                            const digits = phoneNumber.replace(/\D/g, "");
                            // Same rule the payment handler enforces, so the button only wakes up for a full number
                            const phoneValid = /^(\+255|255|0)?[0-9]{9}$/.test(phoneNumber.replace(/\s+/g, ""));
                            const localDigits = digits.startsWith("255") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
                            const phoneStarted = phoneNumber.trim().length > 0;
                            const retry = paymentStatus === "failed" || paymentStatus === "timeout";

                            // Network check: the number's prefix must belong to the chosen wallet's network.
                            // AzamPesa works across networks, so it is never checked.
                            const WALLET_NETWORK: Partial<Record<string, TzMobileNetwork>> = {
                              Airtel: "airtel",
                              Mpesa: "vodacom",
                              Tigo: "yas",
                              Halopesa: "halotel",
                            };
                            const NETWORK_WALLET: Record<TzMobileNetwork, { id: string; label: string; network: string }> = {
                              airtel: { id: "Airtel", label: "Airtel Money", network: "Airtel" },
                              vodacom: { id: "Mpesa", label: "M-Pesa", network: "Vodacom" },
                              yas: { id: "Tigo", label: "Mixx by Yas", network: "Yas" },
                              halotel: { id: "Halopesa", label: "HaloPesa", network: "Halotel" },
                            };
                            const expected = wallet ? WALLET_NETWORK[wallet.id] : undefined;
                            const actual = localDigits.length >= 2 ? tzNetworkForNumber(phoneNumber) : null;
                            const unknownPrefix = Boolean(expected) && localDigits.length >= 2 && !actual;
                            const mismatch = Boolean(expected && actual && actual !== expected);
                            const suggestion = mismatch && actual ? NETWORK_WALLET[actual] : null;
                            const suggestionWallet = suggestion ? PAYMENT_METHODS.find((m) => m.id === suggestion.id) : undefined;
                            const suggestionEnabled = Boolean(suggestionWallet && isProviderEnabled(suggestionWallet.id));
                            const networkBlocked = (mismatch || unknownPrefix) && !portedNumberConfirmed;

                            const blocked = isDisabled || !wallet || !phoneValid || networkBlocked;
                            const nextStep = !wallet
                              ? "Choose a wallet above"
                              : !phoneValid
                                ? phoneStarted
                                  ? `Finish the number (${Math.min(localDigits.length, 9)}/9 digits)`
                                  : "Enter your phone number"
                                : networkBlocked
                                  ? "Check the wallet and number match"
                                : retry
                                  ? "We'll send the request again"
                                  : `Approve the request on your ${walletName} phone`;
                            return (
                              <>
                                <label className="block min-w-0">
                                  <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                                    {wallet ? `${walletName} number` : "Phone number"}
                                    <span className="ml-0.5 text-rose-500">*</span>
                                  </span>
                                  <span className="relative block">
                                    <Smartphone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                                    <input
                                      type="tel"
                                      inputMode="tel"
                                      autoComplete="tel"
                                      value={phoneNumber}
                                      onChange={(e) => {
                                        setPhoneNumber(e.target.value.replace(/[^\d+\s]/g, ""));
                                        setError(null);
                                        setPortedNumberConfirmed(false);
                                      }}
                                      maxLength={16}
                                      aria-invalid={phoneStarted && !phoneValid}
                                      placeholder="+255 7XX XXX XXX"
                                      className={`box-border h-12 w-full min-w-0 rounded-xl border border-solid bg-white pl-10 pr-16 text-[15px] font-medium tracking-wide text-slate-900 outline-none transition placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:border-[#02665e] focus:ring-4 focus:ring-[#02665e]/10 ${
                                        networkBlocked
                                          ? "border-amber-400"
                                          : phoneValid
                                            ? "border-emerald-300"
                                            : phoneStarted && localDigits.length > 9
                                              ? "border-rose-300"
                                              : "border-slate-300 hover:border-slate-400"
                                      }`}
                                    />
                                    {/* The chosen wallet's logo sits inside the field as a reminder */}
                                    {wallet?.icon && (
                                      <span className="pointer-events-none absolute right-2 top-1/2 box-border block h-8 w-11 -translate-y-1/2 overflow-hidden rounded-md border border-solid border-slate-200 bg-white">
                                        <span className="absolute inset-1 block">
                                          <Image src={wallet.icon} alt="" fill sizes="36px" className="object-contain" />
                                        </span>
                                      </span>
                                    )}
                                  </span>
                                  <span className="mt-1.5 block text-[12px] text-slate-500">
                                    {!wallet
                                      ? "Choose a wallet first, then enter its number."
                                      : phoneValid
                                        ? `A payment request will be sent to this ${walletName} number.`
                                        : phoneStarted
                                          ? localDigits.length > 9
                                            ? "That number is too long. Use 07XX XXX XXX or +255 7XX XXX XXX."
                                            : `Keep going: ${Math.min(localDigits.length, 9)} of 9 digits after the 0 or +255.`
                                          : `Use the number registered to your ${walletName} account.`}
                                  </span>
                                </label>

                                {/* Wrong network for the chosen wallet */}
                                {(mismatch || unknownPrefix) && (
                                  <div
                                    role="alert"
                                    className={`rounded-xl px-3.5 py-3 ring-1 ring-inset ${
                                      portedNumberConfirmed ? "bg-slate-50 ring-slate-200" : "bg-amber-50 ring-amber-200"
                                    }`}
                                  >
                                    <p className="m-0 flex items-start gap-2 text-[13px] font-semibold text-amber-900">
                                      <AlertCircle className="mt-px h-4 w-4 flex-none text-amber-600" aria-hidden />
                                      {mismatch && suggestion
                                        ? `This looks like a ${suggestion.network} number, not ${walletName}.`
                                        : `0${localDigits.slice(0, 2)} isn't a ${walletName} prefix.`}
                                    </p>
                                    <p className="m-0 mt-1 pl-6 text-[12.5px] text-amber-800">
                                      A payment request to the wrong network will fail. Pick the wallet that matches this number, or check the number.
                                    </p>
                                    <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6">
                                      {suggestion && suggestionWallet && suggestionEnabled && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSelectedMethod(suggestionWallet);
                                            setPortedNumberConfirmed(false);
                                          }}
                                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 text-[13px] font-semibold text-white hover:bg-[#014e47]"
                                        >
                                          Switch to {suggestion.label}
                                        </button>
                                      )}
                                      {suggestion && !suggestionEnabled && (
                                        <span className="text-[12px] text-amber-800">{suggestion.label} is unavailable right now.</span>
                                      )}
                                      <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-700">
                                        <input
                                          type="checkbox"
                                          checked={portedNumberConfirmed}
                                          onChange={(e) => setPortedNumberConfirmed(e.target.checked)}
                                          className="h-4 w-4 accent-[#02665e]"
                                        />
                                        My number moved to {walletName}, continue
                                      </label>
                                    </div>
                                  </div>
                                )}

                                <button
                                  type="button"
                                  onClick={handleMnoPayment}
                                  disabled={blocked}
                                  className="group flex h-14 w-full items-center justify-between gap-3 rounded-xl border-0 bg-[#02665e] px-5 text-white shadow-[0_12px_28px_-14px_rgba(2,102,94,0.8)] transition-colors hover:bg-[#014e47] active:bg-[#013a35] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                                >
                                  {submitting ? (
                                    <span className="flex w-full items-center justify-center gap-2 text-[15px] font-semibold">
                                      <LogoSpinner size="sm" ariaLabel="Loading" className="text-white/90" />
                                      Sending payment request
                                    </span>
                                  ) : paymentCooldownSeconds > 0 ? (
                                    <span className="flex w-full items-center justify-center gap-2 text-[15px] font-semibold">
                                      <Clock3 className="h-5 w-5" />
                                      Try again in {formatCountdown(paymentCooldownSeconds)}
                                    </span>
                                  ) : (
                                    <>
                                      <span className="min-w-0 text-left">
                                        <span className="flex items-center gap-2 text-[15px] font-bold leading-tight">
                                          {retry ? <RefreshCw className="h-4 w-4" /> : null}
                                          {retry ? "Send request again" : "Pay now"}
                                        </span>
                                        <span className="block truncate text-[12px] opacity-80">{nextStep}</span>
                                      </span>
                                      <span className="flex flex-none items-center gap-2">
                                        <span className="text-[16px] font-extrabold tabular-nums">
                                          {invoice?.totalAmount.toLocaleString()} {invoice?.currency}
                                        </span>
                                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 transition-transform group-enabled:group-hover:translate-x-0.5">
                                          <ChevronLeft className="h-4 w-4 rotate-180" aria-hidden />
                                        </span>
                                      </span>
                                    </>
                                  )}
                                </button>
                              </>
                            );
                          })()}
                        </>
                      )}

                      {/* ── Bank form ── */}
                      {paymentChannel === "BANK" && (
                        (() => {
                          const bank = BANK_PROVIDERS.find((b) => b.code === selectedBankCode && isProviderEnabled(`BANK_${b.code}`)) || null;
                          const retry = paymentStatus === "failed" || paymentStatus === "timeout";
                          const blocked = isDisabled || !bankReady || !isProviderEnabled(`BANK_${selectedBankCode}`);
                          const input =
                            "box-border h-12 w-full min-w-0 rounded-xl border border-solid border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#02665e] focus:ring-4 focus:ring-[#02665e]/10";
                          const stepHead = (n: number, title: string, done: boolean, hint?: string) => (
                            <div className="flex items-start gap-2.5">
                              <span
                                className={`mt-px flex h-6 w-6 flex-none items-center justify-center rounded-full text-[12px] font-bold ${
                                  done ? "bg-[#02665e] text-white" : "bg-[#02665e]/10 text-[#02665e]"
                                }`}
                              >
                                {done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : n}
                              </span>
                              <div className="min-w-0">
                                <p className="m-0 text-[14.5px] font-semibold text-slate-900">{title}</p>
                                {hint && <p className="m-0 text-[12.5px] text-slate-500">{hint}</p>}
                              </div>
                            </div>
                          );
                          const nextStep = !bank
                            ? "Choose your bank"
                            : !bankAccountNumber.trim()
                              ? "Enter your account number"
                              : !bankMobileNumber.trim()
                                ? "Enter your SIM banking number"
                                : !bankOtp.trim()
                                  ? "Enter the OTP from your bank"
                                  : retry
                                    ? "We'll try the payment again"
                                    : `Pays from your ${bank.name} account`;

                          return (
                            <div className="space-y-5">
                              {/* 1. Bank */}
                              <div className="space-y-2.5">
                                {stepHead(1, "Choose your bank", Boolean(bank))}
                                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Bank">
                                  {BANK_PROVIDERS.map((b) => {
                                    const enabled = isProviderEnabled(`BANK_${b.code}`);
                                    const on = enabled && selectedBankCode === b.code;
                                    return (
                                      <button
                                        key={b.code}
                                        type="button"
                                        role="radio"
                                        aria-checked={on}
                                        disabled={!enabled}
                                        aria-disabled={!enabled}
                                        title={enabled ? undefined : providerDisabledReason(`BANK_${b.code}`)}
                                        onClick={() => enabled && setSelectedBankCode(b.code)}
                                        className={`group box-border flex w-full items-center gap-3 rounded-xl border border-solid px-3 py-2.5 text-left transition-all ${
                                          !enabled
                                            ? "cursor-not-allowed border-dashed border-slate-200 bg-slate-50"
                                            : on
                                              ? "border-[#02665e] bg-[#02665e]/[0.05] shadow-[0_8px_20px_-16px_rgba(2,102,94,0.8)]"
                                              : "border-slate-200 bg-white hover:border-[#02665e]/40"
                                        }`}
                                      >
                                        <span className={`relative box-border block h-11 w-14 flex-none overflow-hidden rounded-lg border border-solid border-slate-200 bg-white ${enabled ? "" : "opacity-50 grayscale"}`}>
                                          <span className="absolute inset-1.5 block">
                                            <Image src={b.logo} alt="" fill sizes="48px" className="object-contain" />
                                          </span>
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className={`block truncate text-[14px] font-semibold ${!enabled ? "text-slate-400" : on ? "text-[#02665e]" : "text-slate-900"}`}>{b.name}</span>
                                          {enabled ? (
                                            <span className="block truncate text-[12px] text-slate-500">SIM banking OTP</span>
                                          ) : (
                                            <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-slate-200/70 px-1.5 py-px text-[10.5px] font-semibold text-slate-500">
                                              <Clock3 className="h-3 w-3" aria-hidden />
                                              Unavailable now
                                            </span>
                                          )}
                                        </span>
                                        {enabled && (
                                          <span
                                            aria-hidden
                                            className={`box-border flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 border-solid ${
                                              on ? "border-[#02665e]" : "border-slate-300 group-hover:border-[#02665e]/50"
                                            }`}
                                          >
                                            {on && <span className="h-2.5 w-2.5 rounded-full bg-[#02665e]" />}
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* 2. Get the OTP on the phone */}
                              <div className={`space-y-2.5 ${bank ? "" : "opacity-50"}`}>
                                {stepHead(2, "Get your OTP", Boolean(bankOtp.trim()), bank ? "On the phone registered for SIM banking" : "Choose your bank first")}
                                {bank && bankInstruction && (
                                  <ol className="m-0 list-none space-y-2 rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200">
                                    {bankInstruction.steps.map((s, i) => {
                                      // Show USSD codes like *150*03# as a copyable-looking chip
                                      const parts = s.split(/(\*[\d*]+#)/g);
                                      return (
                                        <li key={s} className="flex gap-2.5 text-[13px] leading-snug text-slate-700">
                                          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md bg-white text-[11px] font-bold text-[#02665e] ring-1 ring-inset ring-slate-200">
                                            {i + 1}
                                          </span>
                                          <span className="min-w-0">
                                            {parts.map((p, j) =>
                                              /^\*[\d*]+#$/.test(p) ? (
                                                <a
                                                  key={j}
                                                  href={`tel:${encodeURIComponent(p)}`}
                                                  className="mx-0.5 inline-block rounded-md bg-[#02665e] px-1.5 py-px font-mono text-[12.5px] font-bold text-white no-underline"
                                                  title="Tap to dial on your phone"
                                                >
                                                  {p}
                                                </a>
                                              ) : (
                                                <span key={j}>{p}</span>
                                              )
                                            )}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ol>
                                )}
                              </div>

                              {/* 3. Details */}
                              <div className={`space-y-3 ${bank ? "" : "opacity-50"}`}>
                                {stepHead(3, "Enter the details", Boolean(bankReady), "Use the same account and number you used for the OTP")}
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <label className="block min-w-0">
                                    <span className="mb-1 block text-[12.5px] font-semibold text-slate-600">
                                      Account number<span className="ml-0.5 text-rose-500">*</span>
                                    </span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={bankAccountNumber}
                                      onChange={(e) => setBankAccountNumber(e.target.value)}
                                      placeholder="e.g. 0152XXXXXXXX"
                                      maxLength={30}
                                      disabled={!bank}
                                      className={`${input} font-mono tracking-wide disabled:cursor-not-allowed disabled:bg-slate-50`}
                                    />
                                  </label>
                                  <label className="block min-w-0">
                                    <span className="mb-1 block text-[12.5px] font-semibold text-slate-600">
                                      SIM banking number<span className="ml-0.5 text-rose-500">*</span>
                                    </span>
                                    <span className="relative block">
                                      <Smartphone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                                      <input
                                        type="tel"
                                        inputMode="tel"
                                        value={bankMobileNumber}
                                        onChange={(e) => setBankMobileNumber(e.target.value)}
                                        placeholder="+255 7XX XXX XXX"
                                        maxLength={15}
                                        disabled={!bank}
                                        className={`${input} pl-10 disabled:cursor-not-allowed disabled:bg-slate-50`}
                                      />
                                    </span>
                                  </label>
                                </div>
                                <label className="block min-w-0">
                                  <span className="mb-1 flex items-center justify-between text-[12.5px] font-semibold text-slate-600">
                                    <span>
                                      OTP from your bank<span className="ml-0.5 text-rose-500">*</span>
                                    </span>
                                    <span className="font-normal text-slate-400">Not sent by NoLSAF</span>
                                  </span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    value={bankOtp}
                                    onChange={(e) => setBankOtp(e.target.value)}
                                    placeholder="• • • • • •"
                                    maxLength={50}
                                    disabled={!bank}
                                    className={`${input} text-center font-mono text-[18px] tracking-[0.4em] placeholder:tracking-[0.3em] disabled:cursor-not-allowed disabled:bg-slate-50`}
                                  />
                                </label>
                              </div>

                              <button
                                type="button"
                                onClick={handleBankPayment}
                                disabled={blocked}
                                className="group flex h-14 w-full items-center justify-between gap-3 rounded-xl border-0 bg-[#02665e] px-5 text-white shadow-[0_12px_28px_-14px_rgba(2,102,94,0.8)] transition-colors hover:bg-[#014e47] active:bg-[#013a35] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                              >
                                {submitting ? (
                                  <span className="flex w-full items-center justify-center gap-2 text-[15px] font-semibold">
                                    <LogoSpinner size="sm" ariaLabel="Loading" className="text-white/90" />
                                    Processing bank payment
                                  </span>
                                ) : (
                                  <>
                                    <span className="min-w-0 text-left">
                                      <span className="flex items-center gap-2 text-[15px] font-bold leading-tight">
                                        {retry ? <RefreshCw className="h-4 w-4" /> : null}
                                        {retry ? "Try again" : "Pay now"}
                                      </span>
                                      <span className="block truncate text-[12px] opacity-80">{nextStep}</span>
                                    </span>
                                    <span className="flex flex-none items-center gap-2">
                                      <span className="text-[16px] font-extrabold tabular-nums">
                                        {invoice?.totalAmount.toLocaleString()} {invoice?.currency}
                                      </span>
                                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
                                        <ChevronLeft className="h-4 w-4 rotate-180" aria-hidden />
                                      </span>
                                    </span>
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })()
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

          {/* Sidebar: booking summary, matching the confirm page's price card */}
          <div className="lg:col-span-1">
            {invoice ? (
              (() => {
                const titleCase = (s: string) =>
                  s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
                const cur = invoice.currency;
                const money = (n: number) => `${n.toLocaleString()} ${cur}`;
                const nights = invoice.booking.nights;
                const rooms = invoice.booking.roomsQty && invoice.booking.roomsQty > 1 ? invoice.booking.roomsQty : 1;
                const pb = invoice.priceBreakdown;
                const accommodation = pb?.accommodationSubtotal ?? invoice.property.basePrice * nights;
                const tax = pb?.taxAmount ?? 0;
                const transport = pb?.transportFare ?? 0;
                const discount = pb?.discount ?? 0;
                const day = (iso: string) =>
                  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                const year = new Date(invoice.booking.checkOut).getFullYear();

                return (
                  <div className="box-border overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(2,40,36,0.35)] lg:sticky lg:top-24">
                    {/* Photo header */}
                    <div
                      className="relative h-36 overflow-hidden"
                      style={{ background: "linear-gradient(135deg, #013d38 0%, #02665e 70%, #037a70 100%)" }}
                    >
                      {invoice.property.primaryImage && (
                        <Image
                          src={invoice.property.primaryImage}
                          alt=""
                          fill
                          sizes="(max-width: 1024px) 100vw, 384px"
                          className="object-cover"
                          priority
                        />
                      )}
                      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#011a18]/90 via-[#011a18]/35 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 px-5 pb-3.5 text-white">
                        <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.14em] text-emerald-200">Your booking</p>
                        <p className="m-0 mt-0.5 truncate text-[18px] font-bold leading-tight">{titleCase(invoice.property.title)}</p>
                        {invoice.property.type && (
                          <p className="m-0 mt-0.5 text-[12px] capitalize text-white/75">
                            {String(invoice.property.type).toLowerCase().replace(/_/g, " ")}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Stay strip */}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-0 border-b border-solid border-slate-100 px-5 py-3">
                      <div className="min-w-0">
                        <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Check-in</p>
                        <p className="m-0 truncate text-[13.5px] font-semibold text-slate-900">{day(invoice.booking.checkIn)}</p>
                      </div>
                      <span className="whitespace-nowrap rounded-full bg-[#02665e]/10 px-2.5 py-0.5 text-[11.5px] font-bold text-[#02665e]">
                        {nights} night{nights !== 1 ? "s" : ""}
                      </span>
                      <div className="min-w-0 text-right">
                        <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Check-out</p>
                        <p className="m-0 truncate text-[13.5px] font-semibold text-slate-900">
                          {day(invoice.booking.checkOut)}
                          <span className="font-normal text-slate-400"> {year}</span>
                        </p>
                      </div>
                    </div>

                    {/* Guest + room */}
                    <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2.5 border-0 border-b border-solid border-slate-100 px-5 py-3 text-[13px]">
                      {invoice.booking.guestName && (
                        <div className="min-w-0">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Guest</dt>
                          <dd className="m-0 truncate font-semibold text-slate-900">{invoice.booking.guestName}</dd>
                        </div>
                      )}
                      {invoice.booking.guestPhone && (
                        <div className="min-w-0">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Phone</dt>
                          <dd className="m-0 truncate font-mono text-[12.5px] font-semibold text-slate-900">{invoice.booking.guestPhone}</dd>
                        </div>
                      )}
                      {invoice.booking.roomCode && (
                        <div className="col-span-2 min-w-0">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Room</dt>
                          <dd className="m-0 truncate font-semibold text-slate-900">
                            {invoice.booking.roomCode}
                            {rooms > 1 ? ` × ${rooms}` : ""}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {/* Breakdown: only lines that carry an amount */}
                    <div className="px-5 py-4">
                      <dl className="m-0 space-y-2.5 text-[13.5px]">
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-slate-600">
                            Stay
                            <span className="block text-[12px] text-slate-400">
                              {nights} night{nights !== 1 ? "s" : ""}
                              {rooms > 1 ? ` × ${rooms} rooms` : ""}
                            </span>
                          </dt>
                          <dd className="m-0 font-semibold tabular-nums text-slate-900">{money(accommodation)}</dd>
                        </div>
                        {transport > 0 && (
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-slate-600">Transport</dt>
                            <dd className="m-0 font-semibold tabular-nums text-slate-900">{money(transport)}</dd>
                          </div>
                        )}
                        {tax > 0 && (
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-slate-600">Tax{pb?.taxPercent ? ` (${pb.taxPercent}%)` : ""}</dt>
                            <dd className="m-0 font-semibold tabular-nums text-slate-900">{money(tax)}</dd>
                          </div>
                        )}
                        {discount > 0 && (
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-emerald-700">Discount</dt>
                            <dd className="m-0 font-semibold tabular-nums text-emerald-700">−{money(discount)}</dd>
                          </div>
                        )}
                      </dl>

                      <div className="mt-4 rounded-xl bg-[#02665e]/[0.06] px-4 py-3 ring-1 ring-inset ring-[#02665e]/15">
                        <div className="flex items-end justify-between gap-3">
                          <div>
                            <p className="m-0 text-[13px] font-bold text-slate-900">Total to pay</p>
                            <p className="m-0 text-[11.5px] text-slate-500">{tax > 0 ? "Tax included" : `${nights} night${nights !== 1 ? "s" : ""} stay`}</p>
                          </div>
                          <span className="text-right text-[24px] font-extrabold leading-none tracking-tight tabular-nums text-[#02665e]">
                            {invoice.totalAmount.toLocaleString()}
                            <span className="ml-1 text-[13px] font-bold">{cur}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Policies that apply to this booking */}
                    <nav aria-label="Booking policies" className="border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-3 py-2">
                      <div className="px-2 pb-1.5 pt-1.5">
                        <p className="m-0 text-[13px] font-semibold text-slate-900">Your booking is covered by these policies</p>
                        <p className="m-0 mt-0.5 text-[11.5px] leading-snug text-slate-500">
                          By paying, you agree to the terms below. Please read them before you continue.
                        </p>
                      </div>
                      <ul className="m-0 list-none p-0">
                        {[
                          { href: "/cancellation-policy", label: "Cancellation policy", hint: "When you can cancel and what you get back", Icon: ReceiptText },
                          { href: "/help/refunds", label: "Refunds", hint: "How and when refunds are paid", Icon: RefreshCw },
                          { href: "/terms", label: "Booking terms", hint: "The terms this payment is made under", Icon: ShieldCheck },
                        ].map(({ href, label, hint, Icon }) => (
                          <li key={href}>
                            <Link
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group flex items-center gap-3 rounded-lg px-2 py-2 no-underline transition-colors hover:bg-white"
                            >
                              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
                                <Icon className="h-4 w-4" aria-hidden />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-semibold text-slate-900 group-hover:text-[#02665e]">{label}</span>
                                <span className="block truncate text-[11.5px] text-slate-500">{hint}</span>
                              </span>
                              <ChevronLeft className="h-4 w-4 flex-none rotate-180 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  </div>
                );
              })()
            ) : null}
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
