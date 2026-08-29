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
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import PaymentChannelSelector, { type PaymentChannel } from "@/components/PaymentChannelSelector";

const PAYMENT_WAIT_SECONDS = 4 * 60;
const POLL_INTERVAL_MS = 3000;

const PROVIDERS = [
  { id: "Mpesa", name: "M-Pesa", icon: "/assets/M-pesa.png" },
  { id: "Tigo", name: "Mixx by Yas", icon: "/assets/mix by yas.png" },
  { id: "Airtel", name: "Airtel Money", icon: "/assets/airtel_money.png" },
  { id: "Halopesa", name: "HaloPesa", icon: "/assets/halopesa.png" },
] as const;
type MnoProvider = (typeof PROVIDERS)[number]["id"];

const BANKS = [
  { code: "CRDB", name: "CRDB Bank", logo: "/assets/NoLSAF_CRDB.png" },
  { code: "NMB", name: "NMB Bank", logo: "/assets/NoLSAF_NMB.png" },
] as const;
type BankCode = (typeof BANKS)[number]["code"];

const BANK_OTP_INSTRUCTIONS: Record<BankCode, { title: string; steps: string[] }> = {
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
    steps: ["Dial *150*66#.", "Choose 8 More, then 5 Register Sarafu.", "Choose 1 Select Account No. to generate the OTP."],
  },
};

type Channel = PaymentChannel;
type Status = "idle" | "pending" | "success" | "timeout";

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

function capTzPhone(v: string) {
  return v.replace(/[^\d+]/g, "").slice(0, 13);
}

// Smart Tanzanian mobile-money helpers: normalize, validate, and detect the
// network from the dialing prefix so we can auto-select the provider as the
// customer types.
const PREFIX_PROVIDER: Record<string, MnoProvider> = {
  "074": "Mpesa", "075": "Mpesa", "076": "Mpesa",
  "065": "Tigo", "067": "Tigo", "071": "Tigo", "077": "Tigo",
  "068": "Airtel", "069": "Airtel", "078": "Airtel",
  "062": "Halopesa",
};
function normalizeTz(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("255")) d = "0" + d.slice(3);
  else if (d.length === 9 && (d[0] === "7" || d[0] === "6")) d = "0" + d;
  return d;
}
function detectProvider(input: string): MnoProvider | null {
  const d = normalizeTz(input);
  return d.length >= 3 ? PREFIX_PROVIDER[d.slice(0, 3)] ?? null : null;
}
function isValidTzMobile(input: string): boolean {
  return /^0[67]\d{8}$/.test(normalizeTz(input));
}
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

function PageShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-screen bg-slate-50 pt-20">
      <div className={`mx-auto px-4 py-6 ${wide ? "max-w-5xl" : "max-w-2xl"}`}>{children}</div>
    </main>
  );
}

export default function GroupStayDepositPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);

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
      const res = await apiClient.get(`/api/customer/group-stays/${id}/deposit-status`);
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
    if (!Number.isFinite(id)) {
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
      await apiClient.post(`/api/customer/group-stays/${id}/deposit/initiate-mno`, {
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
      await apiClient.post(`/api/customer/group-stays/${id}/deposit/initiate-bank`, {
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
      const res = await apiClient.post(`/api/customer/group-stays/${id}/deposit/initiate-card`, { client: "web" });
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
  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading deposit…
        </div>
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{loadError}</div>
        <Link href="/account/group-stays" className="mt-4 inline-flex items-center gap-2 text-emerald-700">
          <ArrowLeft className="h-4 w-4" /> Back to my group stays
        </Link>
      </PageShell>
    );
  }

  const notPayable =
    !deposit?.depositPaid && String(deposit?.status || "").toUpperCase() !== "AWAITING_DEPOSIT";

  if (status === "success") {
    return (
      <PageShell>
        <div className="rounded-3xl border border-emerald-100 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold text-slate-900">Deposit confirmed</h1>
          <p className="mt-2 text-sm text-slate-600">
            Thanks! Your booking is now confirmed. Our team will be in touch with the next steps.
          </p>
          <div className="mt-5 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-500">Deposit paid</span>
            <span className="font-bold text-emerald-700">{fmtMoney(depositAmount)}</span>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <Link
              href={`/account/group-stays/${id}/receipt`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700 no-underline hover:bg-slate-50"
            >
              <Eye className="h-4 w-4" /> View receipt
            </Link>
            <Link
              href="/account/group-stays"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white no-underline hover:bg-emerald-700"
            >
              View my group stays
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  if (notPayable) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          This request does not currently require a deposit payment.
        </div>
        <Link href="/account/group-stays" className="mt-4 inline-flex items-center gap-2 text-emerald-700">
          <ArrowLeft className="h-4 w-4" /> Back to my group stays
        </Link>
      </PageShell>
    );
  }

  if (status === "pending") {
    return (
      <PageShell>
        <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-emerald-600" />
            <div>
              <div className="text-base font-bold text-slate-900">
                {channel === "BANK" ? "Confirm in your bank" : channel === "CARD" ? "Verifying card payment" : "Check your phone"}
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                {channel === "BANK"
                  ? "We are confirming the bank checkout using the OTP you generated."
                  : channel === "CARD"
                    ? "We are checking the card payment result."
                    : "Approve the mobile money prompt to complete payment."}
              </p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-emerald-50 py-4">
            <Clock className="h-4 w-4 text-emerald-600" />
            <span className="text-2xl font-extrabold tabular-nums text-emerald-700">{fmtCountdown(remaining)}</span>
            <span className="text-xs text-slate-500">time left</span>
          </div>
        </div>
      </PageShell>
    );
  }

  // idle / timeout — the payment form
  const bankInstruction = bankCode ? BANK_OTP_INSTRUCTIONS[bankCode] : null;
  const detected = channel === "MNO" ? phoneState.detected : null;
  const detectedName = detected ? PROVIDERS.find((p) => p.id === detected)?.name : null;

  return (
    <PageShell>
      <div className="mb-4">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Pay deposit</h1>
      <p className="mt-1 text-sm text-slate-500">Pay the deposit below to confirm this booking.</p>

      {status === "timeout" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Payment confirmation took too long. You can try again below.
        </div>
      )}

      {/* Amount summary */}
      <div className="mt-4 min-w-0 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.07)]">
        <div className="relative overflow-hidden bg-gradient-to-br from-[#02665e] to-[#014b45] px-5 py-5 text-white">
          <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/[0.06]" />
          <div className="absolute -bottom-14 right-16 h-28 w-28 rounded-full bg-emerald-300/[0.06]" />
          <div className="relative flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/15">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-extrabold tracking-tight">Group stay deposit</div>
              <div className="mt-0.5 truncate text-sm text-white/75">Pay now to confirm your group stay</div>
            </div>
          </div>
        </div>

        <div className="p-5">
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Deposit due now</div>
                <div className="mt-1 text-xs text-slate-500">Required to secure your booking</div>
              </div>
              <div className="shrink-0 text-right text-xl font-black tracking-tight text-emerald-700 sm:text-2xl">
                {fmtMoney(depositAmount)}
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-[#02665e]" style={{ width: `${depositSharePercent}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-semibold">
              <span className="text-emerald-700">
                Deposit to secure
              </span>
              <span className="text-slate-400">Due now</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 divide-x divide-slate-100 rounded-2xl border border-slate-100 bg-slate-50/70 py-3">
            <div className="min-w-0 px-3 sm:px-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total cost</div>
              <div className="mt-1 truncate text-sm font-extrabold text-slate-800">{fmtMoney(totalAmount)}</div>
            </div>
            <div className="min-w-0 px-3 sm:px-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Stay balance</div>
              <div className="mt-1 truncate text-sm font-extrabold text-slate-600">{fmtMoney(remainingBalance)}</div>
            </div>
          </div>

          {msUntilDue != null && (
            <div className={"mt-3 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold " + (msUntilDue < 3 * 60 * 60 * 1000 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700")}>
              <Clock className="h-3.5 w-3.5" />
              {fmtDue(msUntilDue)}
            </div>
          )}
        </div>
      </div>

      {/* Channel + fields */}
      <div className="mt-4 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex min-h-7 items-center">
          {channel ? (
            <button
              type="button"
              onClick={() => {
                setChannel(null);
                setError(null);
              }}
              className="group flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-slate-700"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              Change payment method
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#02665e]" />
              <span className="text-sm font-bold uppercase tracking-wide text-slate-700">Choose how to pay</span>
            </div>
          )}
        </div>
        <div className="mt-3">
          <PaymentChannelSelector
            value={channel}
            onChange={(nextChannel) => {
              setChannel(nextChannel);
              setError(null);
            }}
          />
        </div>

        {channel === "MNO" && (
          <div className="mt-4 min-w-0 space-y-3">
            <div className="grid min-w-0 grid-cols-2 gap-2">
              {PROVIDERS.map((p) => {
                const active = provider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    className={"flex min-w-0 items-center gap-2 rounded-xl border-2 px-2.5 py-2.5 text-left text-sm font-semibold transition-colors " + (active ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
                  >
                    <span className="relative h-8 w-11 shrink-0 overflow-hidden rounded-md bg-white">
                      <Image src={p.icon} alt={`${p.name} logo`} fill sizes="44px" className="object-contain p-0.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                  </button>
                );
              })}
            </div>
            <label className="block min-w-0 max-w-full">
              <span className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Mobile money number</span>
                {detectedName && <span className="text-xs font-semibold text-emerald-600">Detected: {detectedName}</span>}
              </span>
              <div className="relative mt-1 min-w-0 max-w-full overflow-hidden">
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
                  className={
                    "box-border block w-full min-w-0 max-w-full rounded-md border px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 " +
                    (phoneState.complete && !phoneValid
                      ? "border-rose-300 focus:ring-rose-200"
                      : phoneValid
                        ? "border-emerald-300 focus:ring-emerald-200"
                        : "border-slate-200 focus:ring-emerald-200")
                  }
                />
                {phoneValid && <CheckCircle2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />}
              </div>
              {phoneState.complete && !phoneValid && (
                <span className="mt-1 block text-xs text-rose-600">Enter a valid Tanzanian mobile number.</span>
              )}
            </label>
          </div>
        )}

        {channel === "BANK" && (
          <div className="mt-4 min-w-0 max-w-full space-y-3 overflow-hidden">
            <div className="grid min-w-0 max-w-full grid-cols-2 gap-2">
              {BANKS.map((b) => {
                const active = bankCode === b.code;
                return (
                  <button
                    key={b.code}
                    type="button"
                    onClick={() => setBankCode(b.code)}
                    className={"flex min-w-0 items-center gap-2 rounded-xl border-2 px-2.5 py-2.5 text-left transition-colors " + (active ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50")}
                  >
                    <span className="relative h-9 w-12 shrink-0 overflow-hidden rounded-md bg-white">
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
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                <div className="text-xs font-bold text-emerald-800">{bankInstruction.title}</div>
                {bankInstruction.steps.map((step, i) => (
                  <div key={step} className="mt-1 text-xs text-slate-600">
                    {i + 1}. {step}
                  </div>
                ))}
              </div>
            )}
            <label className="block min-w-0 max-w-full">
              <span className="text-sm font-medium text-slate-700">Bank account number <span className="text-rose-500">*</span></span>
              <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} inputMode="numeric" placeholder="Account number selected for OTP" className="mt-1 box-border block w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" />
            </label>
            <label className="block min-w-0 max-w-full">
              <span className="text-sm font-medium text-slate-700">Bank registered mobile number <span className="text-rose-500">*</span></span>
              <input value={bankMobile} onChange={(e) => setBankMobile(capTzPhone(e.target.value))} inputMode="tel" placeholder="07XXXXXXXX or +255 7XXXXXXXX" className="mt-1 box-border block w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" />
            </label>
            <label className="block min-w-0 max-w-full">
              <span className="text-sm font-medium text-slate-700">Bank OTP <span className="text-rose-500">*</span></span>
              <input value={bankOtp} onChange={(e) => setBankOtp(e.target.value)} inputMode="numeric" placeholder="Enter OTP from bank menu" className="mt-1 box-border block w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" />
            </label>
          </div>
        )}

        {channel === "CARD" && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-bold text-slate-800">Card checkout</div>
            <div className="text-xs text-slate-500">Opens a secure hosted checkout (Visa / Mastercard).</div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        Payments are processed securely.
      </div>

      {channel && (
        <button
          type="button"
          onClick={onPay}
          disabled={payDisabled}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : channel === "BANK" ? <Landmark className="h-5 w-5" /> : channel === "CARD" ? <CreditCard className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          Pay {fmtMoney(depositAmount)}
        </button>
      )}
    </PageShell>
  );
}
