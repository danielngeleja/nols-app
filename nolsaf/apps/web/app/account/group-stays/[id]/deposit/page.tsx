"use client";

// Web group-stay deposit payment — parity with the mobile GroupStayDepositPaymentScreen.
// Channels: Mobile money (Mpesa/Tigo/Airtel/Halopesa), Bank (CRDB/NMB OTP), Card.
// Uses the existing /api/customer/group-stays/:id/deposit-* endpoints. Cookie auth.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Smartphone,
  Landmark,
  CreditCard,
  ShieldCheck,
  Clock,
  CheckCircle2,
  MapPin,
  Eye,
  ArrowLeft,
  Loader2,
  Lock,
  AlertCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { type PaymentChannel } from "@/components/PaymentChannelSelector";
import {
  BANK_OTP_INSTRUCTIONS,
  capTzPhone,
  detectTzProvider,
  isValidTzMobile,
  normalizeTz,
  TZ_CHECKOUT_BANKS,
  TZ_MNO_PROVIDERS,
  type TzBankCode,
  type TzMnoProvider,
} from "@/lib/tzMobileMoney";

const PAYMENT_WAIT_SECONDS = 4 * 60;
const POLL_INTERVAL_MS = 3000;

const PROVIDERS = TZ_MNO_PROVIDERS;
type MnoProvider = TzMnoProvider;
const BANKS = TZ_CHECKOUT_BANKS;
type BankCode = TzBankCode;

type Channel = PaymentChannel;
type Status = "idle" | "pending" | "success" | "timeout" | "failed";

type DepositStatus = {
  ok: boolean;
  status: string;
  totalAmount?: number | null;
  ownerAmount?: number | null;
  commissionPercent?: number | null;
  currency?: string | null;
  depositAmount?: number | null;
  depositPaid?: boolean | null;
  depositDueAt?: string | null;
};

// Network detection from the dialling prefix lives in lib/tzMobileMoney so the
// provider is auto-selected as the customer types, the same on every page.
const detectProvider = detectTzProvider;
function fmtCountdown(total: number) {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtDue(ms: number) {
  if (ms <= 0) return "Offer expired";
  const mins = Math.ceil(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `Expires in ${h}h ${m}m` : `Expires in ${m}m`;
}

/** Fills the account container like the other /account pages; border-box is scoped here (preflight is off). */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main id="gs-deposit" className="w-full pb-12 pt-2">
      <style>{`#gs-deposit, #gs-deposit * { box-sizing: border-box; }`}</style>
      {children}
    </main>
  );
}

/** A payment brand logo in a small white tile, as on the tour payment page. */
function BrandMark({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-white p-1 shadow-sm ring-1 ring-black/5" title={alt}>
      <span className="relative block h-6 w-8">
        <Image src={src} alt={alt} fill sizes="32px" loading="eager" className="object-contain" />
      </span>
    </span>
  );
}

const METHODS = [
  {
    id: "MNO" as const,
    label: "Mobile Money",
    hint: "Approve on your phone",
    Icon: Smartphone,
    active: "border-red-300 bg-red-50 shadow-lg shadow-red-100",
    wrap: "bg-red-50 group-hover:bg-red-100",
    icon: "text-red-600",
    dot: "border-red-500 bg-red-500",
    logos: PROVIDERS.map((p) => ({ src: p.icon, alt: p.name })),
    logosOnMobile: false,
  },
  {
    id: "BANK" as const,
    label: "Bank Transfer",
    hint: "OTP checkout",
    Icon: Landmark,
    active: "border-green-300 bg-green-50 shadow-lg shadow-green-100",
    wrap: "bg-green-50 group-hover:bg-green-100",
    icon: "text-green-700",
    dot: "border-green-600 bg-green-600",
    logos: BANKS.map((b) => ({ src: b.logo, alt: b.name })),
    logosOnMobile: true,
  },
  {
    id: "CARD" as const,
    label: "Debit / Credit Card",
    hint: "Secure checkout, any bank",
    Icon: CreditCard,
    active: "border-violet-300 bg-violet-50 shadow-lg shadow-violet-100",
    wrap: "bg-violet-50 group-hover:bg-violet-100",
    icon: "text-violet-700",
    dot: "border-violet-600 bg-violet-600",
    logos: [
      { src: "/assets/visa_card.png", alt: "Visa" },
      { src: "/assets/Mastercard_Logo.png", alt: "Mastercard" },
    ],
    logosOnMobile: true,
  },
];

const INPUT =
  "mt-1 block w-full min-w-0 rounded-xl border border-solid border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-[border-color,box-shadow] focus:border-[#02665e] focus:outline-none focus:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]";

export default function GroupStayDepositPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || "");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<DepositStatus | null>(null);

  const [channel, setChannel] = useState<Channel | null>(null);
  const [provider, setProvider] = useState<MnoProvider | null>(null);
  const phoneRef = useRef("");
  const [phoneState, setPhoneState] = useState<{ hasValue: boolean; complete: boolean; valid: boolean; detected: MnoProvider | null }>({
    hasValue: false,
    complete: false,
    valid: false,
    detected: null,
  });
  const [bankCode, setBankCode] = useState<BankCode | "">("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankMobile, setBankMobile] = useState("");
  const [bankOtp, setBankOtp] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardFailMessage, setCardFailMessage] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(PAYMENT_WAIT_SECONDS);
  const [now, setNow] = useState(() => Date.now());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    pollRef.current = null;
    tickRef.current = null;
  }, []);

  const fetchStatus = useCallback(async (): Promise<DepositStatus | null> => {
    try {
      const res = await apiClient.get(`/api/customer/group-stays/${encodeURIComponent(id)}/deposit-status`);
      return res.data as DepositStatus;
    } catch {
      return null;
    }
  }, [id]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const d = await fetchStatus();
    if (!d || !d.ok) {
      setLoadError("Could not load this booking's deposit.");
    } else {
      setDeposit(d);
      if (d.depositPaid) setStatus("success");
    }
    setLoading(false);
  }, [fetchStatus]);

  useEffect(() => {
    if (!id) {
      setLoadError("Invalid booking.");
      setLoading(false);
      return;
    }
    load();
    return () => stopPolling();
  }, [id, load, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    setStatus("pending");
    setRemaining(PAYMENT_WAIT_SECONDS);
    startRef.current = Date.now();

    tickRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
      const left = PAYMENT_WAIT_SECONDS - elapsed;
      setRemaining(left);
      if (left <= 0) {
        stopPolling();
        setStatus("timeout");
      }
    }, 1000);

    pollRef.current = setInterval(async () => {
      const d = await fetchStatus();
      if (d?.depositPaid) {
        stopPolling();
        setDeposit(d);
        setStatus("success");
      }
    }, POLL_INTERVAL_MS);
  }, [fetchStatus, stopPolling]);

  // Card checkout returns here with ?cardReturn=success|pending|failed (see the
  // Coral /postback handler). Read it once the deposit has loaded, then drop it
  // from the URL so a refresh does not replay it.
  const cardReturnHandled = useRef(false);
  useEffect(() => {
    if (!deposit || cardReturnHandled.current || typeof window === "undefined") return;
    cardReturnHandled.current = true;
    const qs = new URLSearchParams(window.location.search);
    const cardReturn = qs.get("cardReturn");
    if (!cardReturn) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (deposit.depositPaid) return; // already shown as success
    setChannel("CARD");
    if (cardReturn === "success" || cardReturn === "pending") {
      // The bank said yes; wait for our record of it before showing success
      startPolling();
    } else if (cardReturn === "failed") {
      setCardFailMessage(qs.get("message"));
      setStatus("failed");
    }
  }, [deposit, startPolling]);

  // Live "expires in" clock for the deposit window.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const depositAmount = Math.round(Number(deposit?.depositAmount || 0));
  const totalAmount = Number(deposit?.totalAmount || 0);
  const currency = deposit?.currency || "TZS";
  const commissionPercent = deposit?.commissionPercent ?? null;
  const remainingBalance = Number(deposit?.ownerAmount ?? Math.max(0, totalAmount - depositAmount));
  const depositSharePercent = Math.min(100, Math.max(0, totalAmount > 0 ? (depositAmount / totalAmount) * 100 : 0));
  const msUntilDue = deposit?.depositDueAt ? new Date(deposit.depositDueAt).getTime() - now : null;
  const fmtMoney = (v: number) => `${currency} ${Math.round(v).toLocaleString()}`;

  const errMsg = (e: any, fallback: string) =>
    e?.response?.data?.message || e?.response?.data?.error || e?.message || fallback;

  async function payMobileMoney() {
    const phone = phoneRef.current.trim();
    if (!provider || !phone) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/api/customer/group-stays/${encodeURIComponent(id)}/deposit/initiate-mno`, {
        phoneNumber: phone,
        provider,
      });
      startPolling();
    } catch (e: any) {
      setError(errMsg(e, "Payment could not be initiated. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function payBank() {
    if (!bankCode || !bankAccount.trim() || !bankMobile.trim() || !bankOtp.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/api/customer/group-stays/${encodeURIComponent(id)}/deposit/initiate-bank`, {
        bankCode,
        accountNumber: bankAccount.trim(),
        merchantMobileNumber: bankMobile.trim(),
        otp: bankOtp.trim(),
      });
      startPolling();
    } catch (e: any) {
      setError(errMsg(e, "Bank checkout could not be started. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function payCard() {
    setSubmitting(true);
    setError(null);
    try {
      // client:"web" keeps the post-payment redirect on this page. Without it the
      // server assumes the native app and returns to nolsaf://.
      const res = await apiClient.post(`/api/customer/group-stays/${encodeURIComponent(id)}/deposit/initiate-card`, { client: "web" });
      const checkoutUrl = res.data?.checkoutUrl;
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
        return;
      }
      setError("Card payment is not available yet. Use mobile money or bank.");
    } catch (e: any) {
      setError(errMsg(e, "Card checkout could not be started. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const phoneValid = phoneState.valid;
  const bankReady = !!bankCode && !!bankAccount.trim() && !!bankMobile.trim() && !!bankOtp.trim();
  const payDisabled =
    submitting || !channel || (channel === "BANK" ? !bankReady : channel === "CARD" ? false : !provider || !phoneValid);
  const onPay = channel === "BANK" ? payBank : channel === "CARD" ? payCard : payMobileMoney;

  // ── Render states ──────────────────────────────────────────────────────
  const backToList = (
    <Link
      href="/account/group-stays"
      className="mt-4 inline-flex h-10 items-center gap-2 rounded-full border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-800 no-underline transition-colors hover:border-[#02665e] hover:text-[#02665e]"
    >
      <ArrowLeft className="h-4 w-4" /> Back to my group stays
    </Link>
  );

  if (loading) {
    return (
      <PageShell>
        <div aria-busy="true" aria-label="Loading deposit" className="grid gap-6 lg:grid-cols-[1fr_360px] lg:gap-10">
          <div className="space-y-3">
            <div className="h-8 w-44 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-4 w-72 max-w-full animate-pulse rounded bg-slate-200/70" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
            ))}
          </div>
          <div className="h-80 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
        </div>
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell>
        <div className="flex items-start gap-3 rounded-2xl border border-solid border-rose-200 bg-white p-5">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-50 ring-1 ring-rose-100">
            <AlertCircle className="h-5 w-5 text-rose-600" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-base font-bold text-slate-900">Deposit not available</h1>
            <p className="m-0 mt-1 text-sm text-slate-600">{loadError}</p>
          </div>
        </div>
        {backToList}
      </PageShell>
    );
  }

  const notPayable =
    !deposit?.depositPaid && String(deposit?.status || "").toUpperCase() !== "AWAITING_DEPOSIT";
  const dueSoon = msUntilDue != null && msUntilDue < 3 * 60 * 60 * 1000;
  const sharePct = Math.round(depositSharePercent);

  // Right column (top on phones): what is being paid and what is left
  const summaryCard = (
    <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_28px_-20px_rgba(15,23,42,0.3)]">
      {/* Plain white head, no colour band: the icon tile carries the brand */}
      <div className="flex items-center gap-3 border-0 border-b border-solid border-slate-200 px-5 py-4">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/[0.08] text-[#02665e] ring-1 ring-[#02665e]/15">
          <MapPin className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Deposit summary</div>
          <h2 className="m-0 mt-0.5 text-[17px] font-bold leading-snug text-slate-950">Group stay deposit</h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">Paying this secures your rooms.</p>
        </div>
      </div>
      <div className="px-5 py-4">
        {/* The figure that matters, first */}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 leading-tight">
            <span className="block text-[12.5px] font-semibold text-slate-500">Deposit due now</span>
            <span className="mt-1 block text-[26px] font-black leading-none tabular-nums text-[#02665e]">{fmtMoney(depositAmount)}</span>
          </div>
          {totalAmount > 0 ? (
            <span className="flex-shrink-0 rounded-full bg-[#02665e]/[0.08] px-2.5 py-1 text-[11.5px] font-bold tabular-nums text-[#02665e]">
              {sharePct}% of total
            </span>
          ) : null}
        </div>

        {totalAmount > 0 ? (
          <>
            {/* Progress line: today's deposit against the whole stay */}
            <div
              className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label={`Deposit is ${sharePct}% of the group stay total`}
            >
              <span className="h-full rounded-full bg-[#02665e]" style={{ width: `${Math.max(4, depositSharePercent)}%` }} />
              <span className="h-full flex-1 rounded-full bg-slate-200" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[#02665e]" aria-hidden /> Pay now
                </span>
                <span className="mt-0.5 block truncate text-[13.5px] font-bold tabular-nums text-slate-900">{fmtMoney(depositAmount)}</span>
              </div>
              <div className="min-w-0 text-right">
                <span className="flex items-center justify-end gap-1.5 text-[11.5px] text-slate-500">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-slate-300" aria-hidden /> Balance later
                </span>
                <span className="mt-0.5 block truncate text-[13.5px] font-bold tabular-nums text-slate-900">{fmtMoney(remainingBalance)}</span>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-0 border-t border-dashed border-slate-200 pt-3 text-sm">
              <span className="text-slate-500">Group stay total</span>
              <span className="font-semibold tabular-nums text-slate-900">{fmtMoney(totalAmount)}</span>
            </div>
          </>
        ) : null}

        {msUntilDue != null && !deposit?.depositPaid ? (
          <div
            className={`mt-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold ${
              dueSoon ? "bg-rose-50 text-rose-700" : "bg-[#02665e]/[0.06] text-[#02665e]"
            }`}
          >
            <Clock className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            {fmtDue(msUntilDue)}
          </div>
        ) : null}
      </div>
    </div>
  );

  const layout = (left: React.ReactNode) => (
    <div className="lg:grid lg:grid-cols-[1fr_360px] lg:items-start lg:gap-10 xl:gap-14">
      <div className="min-w-0 space-y-5">
        <div className="lg:hidden">{summaryCard}</div>
        {left}
      </div>
      <aside className="hidden lg:block">{summaryCard}</aside>
    </div>
  );

  const header = (title: string, subtitle: string, showBack: boolean) => (
    <div className="mb-5 flex items-start gap-3">
      {showBack ? (
        <button
          type="button"
          aria-label="Back"
          onClick={() => router.back()}
          className="-ml-1 mt-0.5 inline-flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-[24px] font-bold leading-tight text-slate-950 sm:text-[28px]">{title}</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      <span className="mt-1 hidden flex-shrink-0 items-center gap-1.5 rounded-full bg-[#02665e]/10 px-3 py-1 text-[11px] font-bold text-[#02665e] sm:inline-flex">
        <Lock className="h-3 w-3" aria-hidden /> Secure payment
      </span>
    </div>
  );

  if (status === "success") {
    return (
      <PageShell>
        {header("Deposit confirmed", "Your group stay is secured.", false)}
        {layout(
          <div className="rounded-2xl border border-solid border-emerald-200 bg-white p-5 shadow-sm lg:p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-100">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </span>
              <div className="min-w-0">
                <h2 className="m-0 text-xl font-bold leading-tight text-slate-950">Thank you, your deposit is in</h2>
                <p className="m-0 mt-1.5 text-sm leading-6 text-slate-600">
                  Your booking is confirmed. The NoLSAF team will be in touch with the next steps before your stay.
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-slate-200">
              <span className="text-slate-500">Deposit paid</span>
              <span className="font-bold tabular-nums text-emerald-700">{fmtMoney(depositAmount)}</span>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Link
                href={`/account/group-stays/${encodeURIComponent(id)}/receipt`}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-solid border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 no-underline transition-colors hover:border-[#02665e] hover:text-[#02665e]"
              >
                <Eye className="h-4 w-4" /> View receipt
              </Link>
              <Link
                href="/account/group-stays"
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#02665e] px-5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
              >
                View my group stays
              </Link>
            </div>
          </div>,
        )}
      </PageShell>
    );
  }

  if (notPayable) {
    return (
      <PageShell>
        <div className="flex items-start gap-3 rounded-2xl border border-solid border-slate-200 bg-white p-5">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100">
            <ShieldCheck className="h-5 w-5 text-slate-500" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-base font-bold text-slate-900">No deposit needed right now</h1>
            <p className="m-0 mt-1 text-sm text-slate-600">This request does not currently require a deposit payment.</p>
          </div>
        </div>
        {backToList}
      </PageShell>
    );
  }

  const methodName = METHODS.find((m) => m.id === channel)?.label;

  if (status === "pending") {
    const steps =
      channel === "MNO"
        ? ["Request sent to your phone", "Approve the prompt", "Stay confirmed"]
        : channel === "BANK"
          ? ["Bank checkout opened", "Bank confirming the OTP", "Stay confirmed"]
          : ["Card details submitted", "Your bank is verifying", "Stay confirmed"];
    const elapsedPct = Math.max(0, Math.min(100, ((PAYMENT_WAIT_SECONDS - remaining) / PAYMENT_WAIT_SECONDS) * 100));
    const providerName = PROVIDERS.find((p) => p.id === provider)?.name;
    return (
      <PageShell>
        {header("Pay deposit", "Finishing your payment.", false)}
        {layout(
          <div className="overflow-hidden rounded-2xl border border-solid border-[#02665e]/20 bg-white shadow-lg">
            <div className="flex flex-col gap-4 border-0 border-b border-solid border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between lg:p-6">
              <div className="flex min-w-0 items-center gap-4">
                <span className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#02665e]/10">
                  <span className="absolute inset-0 animate-ping rounded-2xl bg-[#02665e]/10" aria-hidden />
                  <Loader2 className="relative h-6 w-6 animate-spin text-[#02665e]" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="m-0 text-[20px] font-bold leading-tight text-slate-950 sm:text-[22px]">
                    {channel === "CARD" ? "Verifying your card payment" : channel === "BANK" ? "Confirming your bank payment" : "Waiting for your approval"}
                  </h2>
                  <p className="m-0 mt-1 text-[14px] leading-5 text-slate-600">
                    {channel === "MNO"
                      ? `We sent a payment request to your phone. Approve it on ${providerName || "your wallet"} to confirm this stay.`
                      : channel === "BANK"
                        ? `We are confirming the ${BANKS.find((b) => b.code === bankCode)?.name || "bank"} checkout using the OTP you generated.`
                        : "Your bank is checking the card. This usually takes a few seconds."}
                  </p>
                </div>
              </div>
              <div className="flex-shrink-0 rounded-xl bg-slate-50 px-4 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  <Clock className="h-3.5 w-3.5" aria-hidden /> Time left
                </div>
                <div className="mt-0.5 font-mono text-[26px] font-black leading-none tabular-nums text-slate-950">{fmtCountdown(remaining)}</div>
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
                      className={`flex items-center gap-2.5 rounded-xl border border-solid px-3 py-2.5 ${
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
              <div className="mt-4 grid grid-cols-1 overflow-hidden rounded-xl border border-solid border-slate-200 bg-slate-50/70 sm:grid-cols-2">
                <div className="px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Amount</div>
                  <div className="mt-1 text-[16px] font-bold tabular-nums text-slate-950">{fmtMoney(depositAmount)}</div>
                </div>
                <div className="border-0 border-t border-solid border-slate-200 px-4 py-3 sm:border-l sm:border-t-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    {channel === "MNO" ? "Phone" : channel === "BANK" ? "Bank" : "Method"}
                  </div>
                  <div className="mt-1 truncate text-[14px] font-semibold text-slate-900">
                    {channel === "MNO"
                      ? phoneRef.current || "-"
                      : channel === "BANK"
                        ? BANKS.find((b) => b.code === bankCode)?.name || "-"
                        : "Visa / Mastercard"}
                  </div>
                </div>
              </div>
              <div className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-600">
                <ShieldCheck className="h-4 w-4 text-[#02665e]" aria-hidden />
                Keep this page open until it finishes.
              </div>
            </div>
          </div>,
        )}
      </PageShell>
    );
  }

  // idle / timeout: the payment form
  const bankInstruction = bankCode ? BANK_OTP_INSTRUCTIONS[bankCode] : null;
  const detected = channel === "MNO" ? phoneState.detected : null;
  const detectedName = detected ? PROVIDERS.find((p) => p.id === detected)?.name : null;

  return (
    <PageShell>
      {header("Pay deposit", "Pay the deposit to confirm your group stay.", true)}
      {layout(
        <>
          {status === "timeout" && (
            <div className="rounded-2xl border border-solid border-amber-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <Clock className="h-5 w-5 text-amber-700" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="m-0 text-lg font-bold leading-tight text-amber-950">Payment not confirmed yet</h2>
                  <p className="m-0 mt-1.5 text-sm leading-6 text-amber-800">
                    {channel === "CARD"
                      ? "We have not received the card result yet. If you were charged, it will show here shortly; otherwise try again below."
                      : "Your group stay is still reserved. If you did not approve the prompt, send a new payment request below."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {status === "failed" && (
            <div className="rounded-2xl border border-solid border-rose-200 bg-white p-5 shadow-sm lg:p-6">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-rose-50 ring-1 ring-rose-100">
                  <AlertCircle className="h-5 w-5 text-rose-700" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-lg font-bold leading-tight text-slate-950 sm:text-xl">Card payment not completed</h2>
                  <p className="m-0 mt-1.5 text-sm leading-6 text-slate-600">
                    The bank did not approve this payment. Your group stay is still reserved, so try the card again or pay with mobile money or bank.
                  </p>
                  {cardFailMessage ? (
                    <p className="m-0 mt-2 inline-flex rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-500 ring-1 ring-slate-200">
                      {`Bank response: ${cardFailMessage}`}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex min-h-7 items-center gap-2 px-1">
              {channel ? (
                <button
                  type="button"
                  onClick={() => {
                    setChannel(null);
                    setError(null);
                  }}
                  className="group flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
                >
                  <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                  Change payment method
                </button>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 text-[#02665e]" />
                  <h3 className="m-0 text-sm font-bold text-slate-800">Choose how to pay</h3>
                </>
              )}
            </div>

            {/* Method cards: the chosen one stays, the others step aside */}
            <div className="space-y-2.5">
              {METHODS.filter((m) => !channel || channel === m.id).map((m) => {
                const on = channel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setChannel(on ? null : m.id);
                      setError(null);
                    }}
                    className={`group flex w-full cursor-pointer items-center gap-4 rounded-2xl border-2 border-solid px-4 py-4 text-left transition-all duration-200 sm:px-5 ${
                      on ? m.active : "border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:shadow-md"
                    }`}
                  >
                    <span className={`flex-shrink-0 rounded-xl p-2.5 transition-colors ${m.wrap}`}>
                      <m.Icon className={`h-5 w-5 ${m.icon}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold text-slate-900">{m.label}</span>
                      <span className="mt-0.5 block text-xs font-medium text-slate-500">{m.hint}</span>
                    </span>
                    <span className={`flex-shrink-0 items-center gap-1.5 ${m.logosOnMobile ? "flex" : "hidden sm:flex"}`}>
                      {m.logos.map((l) => (
                        <BrandMark key={l.alt} src={l.src} alt={l.alt} />
                      ))}
                    </span>
                    <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 border-solid transition-all ${on ? m.dot : "border-slate-300"}`}>
                      {on ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Form panel for the chosen method, with the pay action at its foot */}
            {channel && (
              <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
                <div className="space-y-4 px-5 pb-5 pt-4">
                  {channel === "MNO" && (
                    <>
                      <div>
                        <div className="text-sm font-semibold text-slate-800">Your network</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {PROVIDERS.map((p) => {
                            const active = provider === p.id;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setProvider(p.id)}
                                className={`flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-solid px-2 py-2.5 text-center text-[12.5px] font-semibold transition-colors ${
                                  active ? "border-[#02665e] bg-[#02665e]/[0.06] text-[#02665e]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                }`}
                              >
                                <span className="relative h-8 w-11 overflow-hidden rounded-md bg-white">
                                  <Image src={p.icon} alt={`${p.name} logo`} fill sizes="44px" className="object-contain p-0.5" />
                                </span>
                                <span className="w-full truncate">{p.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <label className="block min-w-0">
                        <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
                          <span>Mobile money number</span>
                          {detectedName && <span className="text-xs font-semibold text-[#02665e]">Detected: {detectedName}</span>}
                        </span>
                        <span className="relative block">
                          <input
                            defaultValue={phoneRef.current}
                            onChange={(e) => {
                              const v = capTzPhone(e.target.value);
                              if (v !== e.target.value) e.target.value = v;
                              phoneRef.current = v;
                              const det = detectProvider(v);
                              if (det) setProvider(det);
                              const next = {
                                hasValue: v.length > 0,
                                complete: normalizeTz(v).length >= 10,
                                valid: isValidTzMobile(v),
                                detected: det,
                              };
                              setPhoneState((current) =>
                                current.hasValue === next.hasValue && current.complete === next.complete && current.valid === next.valid && current.detected === next.detected
                                  ? current
                                  : next
                              );
                            }}
                            inputMode="tel"
                            placeholder="07XXXXXXXX or +255 7XXXXXXXX"
                            className={`${INPUT} pr-10 ${phoneState.complete && !phoneValid ? "!border-rose-400" : phoneValid ? "!border-emerald-400" : ""}`}
                          />
                          {phoneValid && <CheckCircle2 className="absolute right-3 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 text-emerald-600" />}
                        </span>
                        {phoneState.complete && !phoneValid ? (
                          <span className="mt-1 block text-xs text-rose-600">Enter a valid Tanzanian mobile number.</span>
                        ) : (
                          <span className="mt-1 block text-xs text-slate-400">You will get a prompt on this phone to approve.</span>
                        )}
                      </label>
                    </>
                  )}

                  {channel === "BANK" && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {BANKS.map((b) => {
                          const active = bankCode === b.code;
                          return (
                            <button
                              key={b.code}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setBankCode(b.code)}
                              className={`flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border-2 border-solid px-3 py-2.5 text-left transition-colors ${
                                active ? "border-[#02665e] bg-[#02665e]/[0.06]" : "border-slate-200 bg-white hover:border-slate-300"
                              }`}
                            >
                              <span className="relative h-9 w-12 flex-shrink-0 overflow-hidden rounded-md bg-white">
                                <Image src={b.logo} alt={`${b.name} logo`} fill sizes="48px" className="object-contain p-0.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-slate-800">{b.name}</span>
                                <span className="block truncate text-xs text-slate-500">OTP checkout</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {bankInstruction && (
                        <div className="rounded-xl bg-[#02665e]/[0.05] p-3.5 ring-1 ring-[#02665e]/15">
                          <div className="text-xs font-bold text-[#02665e]">{bankInstruction.title}</div>
                          <ol className="m-0 mt-1.5 list-none space-y-1 p-0">
                            {bankInstruction.steps.map((step, i) => (
                              <li key={step} className="flex gap-2 text-xs text-slate-600">
                                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-[9px] font-bold text-white">{i + 1}</span>
                                {step}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      <label className="block min-w-0">
                        <span className="text-sm font-semibold text-slate-800">Bank account number <span className="text-rose-500">*</span></span>
                        <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} inputMode="numeric" placeholder="Account number selected for OTP" className={INPUT} />
                      </label>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block min-w-0">
                          <span className="text-sm font-semibold text-slate-800">Registered mobile <span className="text-rose-500">*</span></span>
                          <input value={bankMobile} onChange={(e) => setBankMobile(capTzPhone(e.target.value))} inputMode="tel" placeholder="07XXXXXXXX" className={INPUT} />
                        </label>
                        <label className="block min-w-0">
                          <span className="text-sm font-semibold text-slate-800">Bank OTP <span className="text-rose-500">*</span></span>
                          <input value={bankOtp} onChange={(e) => setBankOtp(e.target.value)} inputMode="numeric" placeholder="From the bank menu" className={INPUT} />
                        </label>
                      </div>
                    </>
                  )}

                  {channel === "CARD" && (
                    <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                      <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-600" aria-hidden />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800">Hosted card checkout</div>
                        <div className="mt-0.5 text-xs leading-5 text-slate-500">
                          You will enter your card on a secure checkout page, then come straight back here.
                        </div>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-medium text-rose-700">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                      {error}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onPay}
                    disabled={payDisabled}
                    className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : channel === "BANK" ? (
                      <Landmark className="h-5 w-5" />
                    ) : channel === "CARD" ? (
                      <CreditCard className="h-5 w-5" />
                    ) : (
                      <Smartphone className="h-5 w-5" />
                    )}
                    Pay {fmtMoney(depositAmount)}
                    {methodName ? <span className="sr-only"> with {methodName}</span> : null}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5 px-1 text-xs text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-[#02665e]" />
              Payments are processed securely.
            </div>
          </div>
        </>,
      )}
    </PageShell>
  );
}
