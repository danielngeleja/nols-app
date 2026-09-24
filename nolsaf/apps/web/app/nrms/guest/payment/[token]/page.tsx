"use client";

import { use, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Landmark,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";

type Channel = "MNO" | "BANK";

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("en-TZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

export default function GuestPaymentRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>("MNO");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [mnoProvider, setMnoProvider] = useState("Mpesa");
  const [bankCode, setBankCode] = useState("CRDB");
  const [accountNumber, setAccountNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [clientRequestId, setClientRequestId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get(
        `/api/public/nrms/guest/payment-requests/${encodeURIComponent(token)}`,
      );
      setData(response.data.paymentRequest);
      setError(null);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "This payment request is unavailable.");
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setClientRequestId(crypto.randomUUID()); }, []);
  useEffect(() => {
    const waiting = data?.status === "PROCESSING" ||
      ["PROCESSING", "STATUS_UNKNOWN", "INITIATION_PENDING"].includes(data?.payment?.status);
    if (!waiting) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [data?.status, data?.payment?.status, load]);
  useEffect(() => {
    const offered = data?.checkout?.channels as Channel[] | undefined;
    if (offered?.length && !offered.includes(channel)) setChannel(offered[0]);
  }, [channel, data?.checkout?.channels]);

  const startPayment = async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const payload = channel === "MNO"
        ? { channel, clientRequestId, phoneNumber, mnoProvider }
        : { channel, clientRequestId, phoneNumber, bankCode, accountNumber, otp };
      const response = await apiClient.post(
        `/api/public/nrms/guest/payment-requests/${encodeURIComponent(token)}/checkout`,
        payload,
      );
      setNotice(response.data.message || "Payment submitted. Awaiting confirmation.");
      await load();
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.error ||
        "The payment could not be started. No charge has been confirmed.",
      );
      setClientRequestId(crypto.randomUUID());
    } finally {
      setSubmitting(false);
    }
  };

  if (!data && !error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#edf0ed]">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />
          Opening secure checkout
        </div>
      </main>
    );
  }

  const dueAt = data?.dueAt ? new Date(data.dueAt) : null;
  const dueLabel = dueAt && !Number.isNaN(dueAt.getTime())
    ? dueAt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Contact property";
  const settled = data?.status === "SETTLED" || data?.payment?.status === "SUCCEEDED";
  const processing = data?.status === "PROCESSING" ||
    ["PROCESSING", "STATUS_UNKNOWN", "INITIATION_PENDING"].includes(data?.payment?.status);
  const offered: Channel[] = data?.checkout?.channels || [];
  const checkoutAvailable = Boolean(data?.checkout?.available && offered.length);
  const canSubmit = Boolean(
    clientRequestId &&
    checkoutAvailable &&
    offered.includes(channel) &&
    phoneNumber.trim().length >= 9 &&
    (channel === "MNO" || (accountNumber.trim() && otp.trim())),
  );

  return (
    <main className="min-h-screen bg-[#edf0ed] px-4 py-5 sm:py-9">
      <div className="mx-auto max-w-[620px]">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-600 transition hover:text-emerald-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <section className="overflow-hidden rounded-[22px] border border-black/[0.06] bg-white shadow-[0_22px_60px_rgba(15,35,29,0.12)]">
          <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-7">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <LockKeyhole className="h-4 w-4" />
              </span>
              <div>
                <p className="m-0 text-[9px] font-bold uppercase tracking-[0.19em] text-emerald-700">NRMS</p>
                <p className="m-0 text-sm font-bold text-slate-950">Secure property checkout</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" /> Protected
            </span>
          </header>

          {error && !data ? (
            <div className="px-6 py-10 text-center text-sm text-red-700">{error}</div>
          ) : data && (
            <div className="p-4 sm:p-6">
              <PaymentSummary
                property={data.property}
                guest={data.guest}
                amount={formatMoney(data.amount, data.currency)}
                dueLabel={dueLabel}
                status={settled ? "Confirmed" : processing ? "Processing" : "Deposit due"}
              />

              {settled ? (
                <div className="mt-5 flex gap-3 border border-emerald-200 bg-emerald-50 px-4 py-4">
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-700" />
                  <div>
                    <h1 className="m-0 text-base font-bold text-emerald-950">Reservation confirmed</h1>
                    <p className="mb-0 mt-1 text-xs leading-5 text-emerald-800">
                      The provider confirmed your deposit and NRMS recorded it.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {!checkoutAvailable && <PendingActivation message={data.checkout?.message} />}
                  <div className="mt-6">
                  <div>
                    <div>
                      <p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700">{checkoutAvailable ? "Payment method" : "Checkout preview"}</p>
                      <h1 className="mb-0 mt-1 text-lg font-bold text-slate-950">{checkoutAvailable ? "Choose how to pay" : "See how guests will pay"}</h1>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MethodButton
                      active={channel === "MNO"}
                      disabled={(checkoutAvailable && !offered.includes("MNO")) || processing}
                      icon={<Smartphone />}
                      label="Mobile money"
                      onClick={() => setChannel("MNO")}
                    />
                    <MethodButton
                      active={channel === "BANK"}
                      disabled={(checkoutAvailable && !offered.includes("BANK")) || processing}
                      icon={<Landmark />}
                      label="Bank"
                      onClick={() => setChannel("BANK")}
                    />
                  </div>

                  {processing ? (
                    <div className="mt-4 flex items-center gap-3 border border-amber-200 bg-amber-50 px-4 py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-amber-700" />
                      <div>
                        <p className="m-0 text-sm font-bold text-amber-950">Waiting for confirmation</p>
                        <p className="mb-0 mt-0.5 text-xs text-amber-800">Keep this page open. We will update it automatically.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <div className="rounded-xl border border-slate-200 bg-[#f8faf9] p-3 sm:p-4">
                        {channel === "MNO" ? (
                        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <Field label="Network">
                            <select value={mnoProvider} onChange={(event) => setMnoProvider(event.target.value)} className={inputClass}>
                              <option value="Mpesa">M-Pesa</option>
                              <option value="Tigo">Mixx by Yas</option>
                              <option value="Airtel">Airtel Money</option>
                              <option value="Halopesa">HaloPesa</option>
                              <option value="Azampesa">AzamPesa</option>
                            </select>
                          </Field>
                          <Field label="Phone number">
                            <input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} inputMode="tel" placeholder="0712 345 678" className={inputClass} />
                          </Field>
                        </div>
                        ) : (
                        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <Field label="Bank">
                            <select value={bankCode} onChange={(event) => setBankCode(event.target.value)} className={inputClass}>
                              <option value="CRDB">CRDB Bank</option>
                              <option value="NMB">NMB Bank</option>
                            </select>
                          </Field>
                          <Field label="Account number">
                            <input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} placeholder="Account number" className={inputClass} />
                          </Field>
                          <Field label="Bank mobile number">
                            <input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} inputMode="tel" placeholder="0712 345 678" className={inputClass} />
                          </Field>
                          <Field label="One-time code">
                            <input value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="OTP" className={inputClass} />
                          </Field>
                        </div>
                        )}
                      </div>

                      {checkoutAvailable ? (
                        <button
                          type="button"
                          disabled={!canSubmit || submitting}
                          onClick={() => void startPayment()}
                          className="mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-5 text-sm font-bold text-white shadow-[0_8px_22px_rgba(4,120,87,0.2)] outline-none transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                        >
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                          {submitting ? "Starting payment…" : `Pay ${formatMoney(data.amount, data.currency)}`}
                          {!submitting && <ArrowRight className="h-4 w-4" />}
                        </button>
                      ) : (
                        <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-3 text-[11px] font-semibold text-slate-500">
                          <LockKeyhole className="h-3.5 w-3.5" /> Payment unlocks after merchant activation
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                </>
              )}

              {notice && <div className="mt-4 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div>}
              {error && <div className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

              <div className="mt-5 flex items-start gap-2.5 border-t border-slate-100 pt-4">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <p className="m-0 text-[11px] leading-5 text-slate-500">
                  Paid directly to <strong className="font-semibold text-slate-700">{data.property}</strong>. NoLSAF and NRMS never hold these funds.
                </p>
              </div>
            </div>
          )}
        </section>

        <footer className="flex items-center justify-center gap-2 py-5 text-[10px] font-medium text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
          Secured by NRMS <span className="text-slate-300">•</span> Powered by NoLSAF
        </footer>
      </div>
    </main>
  );
}

function PaymentSummary({ property, guest, amount, dueLabel, status }: { property: string; guest: string; amount: string; dueLabel: string; status: string }) {
  return (
    <div className="relative isolate overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#092f2c_0%,#075847_100%)] px-5 py-5 text-white shadow-[0_18px_38px_rgba(4,66,55,0.22)] sm:px-6 sm:py-6">
      <span className="pointer-events-none absolute -right-16 -top-20 -z-10 h-56 w-56 rounded-full border border-white/10 bg-white/[0.035]" />
      <span className="pointer-events-none absolute -bottom-24 left-1/3 -z-10 h-48 w-48 rotate-12 bg-black/[0.06]" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="m-0 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-200">Paying directly to</p>
          <p className="mb-0 mt-1 text-sm font-bold text-white">{property}</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-100">{status}</span>
      </div>
      <div className="mt-7">
        <p className="m-0 text-[10px] font-medium text-emerald-100/70">Deposit for {guest}</p>
        <p className="mb-0 mt-1 text-4xl font-bold tracking-[-0.045em] sm:text-[42px]">{amount}</p>
      </div>
      <div className="mt-7 flex items-center justify-between border-t border-white/10 pt-4 text-[10px] text-emerald-100/80">
        <span>NRMS direct reservation</span>
        <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{dueLabel}</span>
      </div>
    </div>
  );
}

function PendingActivation({ message }: { message?: string | null }) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="flex gap-3 px-4 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200">
          <Landmark className="h-5 w-5" />
        </span>
        <div>
          <h1 className="m-0 text-sm font-bold text-slate-950">Property checkout is being connected</h1>
          <p className="mb-0 mt-1 text-xs leading-5 text-slate-600">
            {message || "This property is completing its secure merchant activation."}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-3 text-[10px] font-semibold text-slate-500">
        <LockKeyhole className="h-3.5 w-3.5 text-emerald-700" /> Preview only. No payment will be sent.
        <span className="ml-auto rounded-full bg-amber-50 px-2 py-1 text-amber-700">Setup pending</span>
      </div>
    </div>
  );
}

function MethodButton({ active, disabled, icon, label, onClick }: { active: boolean; disabled: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold outline-none transition ${active ? "border-[#073d35] bg-[#073d35] text-white shadow-[0_6px_16px_rgba(7,61,53,0.18)]" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800"} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}
    </button>
  );
}

const inputClass = "!box-border !h-12 !min-w-0 !max-w-full w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-0 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 max-w-full">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}
