"use client";

import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Clock3, Landmark, Loader2, LockKeyhole, ShieldCheck, Smartphone, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import {
  AZAMPESA_PROVIDER,
  BANK_OTP_INSTRUCTIONS,
  capTzPhone,
  detectTzProvider,
  isValidTzMobile,
  normalizeTz,
  TZ_CHECKOUT_BANKS,
  TZ_MNO_PROVIDERS,
  type TzBankCode,
} from "@/lib/tzMobileMoney";

type Channel = "MNO" | "BANK";

// Same networks as the group stay deposit, plus AzamPesa which this checkout accepts.
const MNO_CHOICES = [...TZ_MNO_PROVIDERS, AZAMPESA_PROVIDER];
type MnoChoice = (typeof MNO_CHOICES)[number]["id"];
const providerName = (id: string) => MNO_CHOICES.find((choice) => choice.id === id)?.name ?? id;

const inputClass = "box-border h-11 w-full min-w-0 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10";

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-TZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

export default function MasterFolioPaymentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const searchParams = useSearchParams();
  const preview = searchParams.get("preview") === "1";
  const previewQuery = preview ? "?preview=1" : "";
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // Why a link cannot be used, and the agency's own Pro Forma to start over from.
  const [dead, setDead] = useState<{ code: string | null; proFormaUrl: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>("MNO");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [mnoProvider, setMnoProvider] = useState<MnoChoice | "">("");
  // Set when the number's prefix overrode a network the payer had picked.
  const [networkSwitch, setNetworkSwitch] = useState<{ from: string; to: string } | null>(null);
  const [bankCode, setBankCode] = useState<TzBankCode | "">("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankMobile, setBankMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [clientRequestId, setClientRequestId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [testStage, setTestStage] = useState<"IDLE" | "PROCESSING" | "SUCCEEDED">("IDLE");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get("/api/public/nrms/master-folio-payments/" + encodeURIComponent(token) + previewQuery);
      setData(response.data.paymentLink);
      setError(null);
      setDead(null);
    } catch (requestError: any) {
      const body = requestError?.response?.data;
      setError(body?.error || "This payment link is unavailable.");
      setDead({ code: body?.code ?? null, proFormaUrl: body?.proFormaUrl ?? null });
    }
  }, [previewQuery, token]);

  useEffect(() => { setClientRequestId(crypto.randomUUID()); void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const waiting = data?.status === "PROCESSING"
      || ["PROCESSING", "STATUS_UNKNOWN", "INITIATION_PENDING"].includes(data?.payment?.status);
    if (!waiting) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [data?.status, data?.payment?.status, load]);
  useEffect(() => {
    const offered = data?.checkout?.channels as Channel[] | undefined;
    if (offered?.length && !offered.includes(channel)) setChannel(offered[0]);
  }, [channel, data?.checkout?.channels]);

  const remaining = useMemo(() => Math.max(0, new Date(data?.expiresAt || 0).getTime() - now), [data?.expiresAt, now]);
  const remainingLabel = `${Math.floor(remaining / 3_600_000)}:${String(Math.floor((remaining % 3_600_000) / 60_000)).padStart(2, "0")}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}`;
  const testMode = Boolean(data?.checkout?.testMode);
  const settled = testStage === "SUCCEEDED" || data?.status === "PAID" || data?.payment?.status === "SUCCEEDED";
  const processing = testStage === "PROCESSING" || data?.status === "PROCESSING"
    || ["PROCESSING", "STATUS_UNKNOWN", "INITIATION_PENDING"].includes(data?.payment?.status);
  const offered: Channel[] = data?.checkout?.channels || [];
  const checkoutAvailable = Boolean(data?.checkout?.available && offered.length && remaining > 0);
  const phoneValid = isValidTzMobile(phoneNumber);
  const phoneComplete = normalizeTz(phoneNumber).length >= 10;
  const bankMobileValid = isValidTzMobile(bankMobile);
  const detected = detectTzProvider(phoneNumber);
  const canSubmit = Boolean(
    clientRequestId && checkoutAvailable && offered.includes(channel)
      && (channel === "MNO"
        ? phoneValid && mnoProvider
        : bankCode && accountNumber.trim() && bankMobileValid && otp.trim()),
  );

  // Typing a number picks its network. If the payer had chosen a different
  // one, switch anyway and say so, since the prompt can only reach the SIM's
  // own wallet.
  const changePhone = (value: string) => {
    const next = capTzPhone(value);
    setPhoneNumber(next);
    const network = detectTzProvider(next);
    // AzamPesa is a wallet on any network's number, so a prefix never overrides it.
    if (!network || network === mnoProvider || mnoProvider === "Azampesa") return;
    setNetworkSwitch(mnoProvider ? { from: providerName(mnoProvider), to: providerName(network) } : null);
    setMnoProvider(network);
  };

  const startPayment = async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const payload = channel === "MNO"
        ? { channel, clientRequestId, phoneNumber, mnoProvider }
        : { channel, clientRequestId, phoneNumber: bankMobile, bankCode, accountNumber: accountNumber.trim(), otp: otp.trim() };
      const response = await apiClient.post("/api/public/nrms/master-folio-payments/" + encodeURIComponent(token) + "/checkout" + previewQuery, payload);
      setNotice(response.data.message || "Payment submitted. Awaiting confirmation.");
      if (response.data?.payment?.testMode) {
        setTestStage("PROCESSING");
        window.setTimeout(() => { setTestStage("SUCCEEDED"); setNotice(null); }, 1400);
        return;
      }
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "The payment could not be started. No charge has been confirmed.");
      setClientRequestId(crypto.randomUUID());
    } finally {
      setSubmitting(false);
    }
  };

  if (!data && !error) {
    return <main className="flex min-h-screen items-center justify-center bg-[#edf0ed]"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></main>;
  }

  return (
    <main className="min-h-screen bg-[#edf0ed] px-4 py-7 sm:py-10">
      <div className="mx-auto max-w-[640px]">
        <section className="overflow-hidden rounded-[22px] border border-black/[0.06] bg-white shadow-[0_22px_60px_rgba(15,35,29,0.12)]">
          <header className="flex items-center justify-between border-0 border-b border-solid border-slate-100 px-5 py-4 sm:px-7">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><LockKeyhole className="h-4 w-4" /></span>
              <div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.19em] text-emerald-700">NRMS</p><p className="m-0 text-sm font-bold text-slate-950">Secure group checkout</p></div>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${testMode ? "bg-amber-100 text-amber-800" : "text-slate-500"}`}><ShieldCheck className={`h-3.5 w-3.5 ${testMode ? "text-amber-700" : "text-emerald-700"}`} /> {testMode ? "TEST MODE" : "Protected"}</span>
          </header>

          {error && !data ? (
            <div className="px-6 py-10 text-center sm:px-10">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700"><Clock3 className="h-5 w-5" /></span>
              <h1 className="m-0 mt-4 text-lg font-bold text-slate-950">This payment link can't be used</h1>
              <p className="m-0 mt-1.5 text-sm leading-6 text-slate-600">{error}</p>
              {dead?.proFormaUrl ? (
                <>
                  <p className="m-0 mt-4 text-sm leading-6 text-slate-600">You can start a new payment yourself from your Pro Forma. The amount is worked out again from your account, so it is always up to date.</p>
                  <a href={dead.proFormaUrl} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white no-underline shadow-sm transition-colors hover:bg-emerald-800">
                    <LockKeyhole className="h-4 w-4" /> Open your Pro Forma to pay
                  </a>
                </>
              ) : (
                <p className="m-0 mt-4 text-sm leading-6 text-slate-500">Ask the property to send you a new payment link or an updated Pro Forma.</p>
              )}
            </div>
          ) : data && (
            <div className="p-5 sm:p-7">
              {testMode && <div className="mb-4 rounded-xl border border-solid border-amber-300 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900"><b>Checkout preview:</b> use test details to verify every step. No prompt will be sent, no money will move, and NRMS will not mark this invoice paid.</div>}
              <div className="rounded-2xl bg-[linear-gradient(115deg,#064e3b_0%,#047857_100%)] p-5 text-white">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200">Agency master folio</p>
                <h1 className="mb-0 mt-2 text-xl font-bold">{data.group}</h1>
                <p className="m-0 mt-1 text-xs text-emerald-100">{data.property} · {data.folioReference}</p>
                <p className="mb-0 mt-5 text-3xl font-bold tabular-nums">{money(data.amount, data.currency)}</p>
                {!settled && <p className="m-0 mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold"><Clock3 className="h-3.5 w-3.5" /> Link expires in {remainingLabel}</p>}
              </div>

              {settled ? (
                <div className="mt-5 flex items-start gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" />
                  <div><p className="m-0 text-sm font-bold text-emerald-950">{testMode ? "Test checkout completed" : "Payment confirmed"}</p><p className="m-0 mt-1 text-xs text-emerald-800">{testMode ? "The complete checkout journey works. This was a simulation: no payment was sent or recorded." : "AzamPay confirmed the payment and NRMS recorded it on the agency account."}</p></div>
                </div>
              ) : (
                <>
                  {!checkoutAvailable && !processing && (
                    <div className="mt-5 rounded-xl border border-solid border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                      {remaining <= 0
                        ? <>This payment link has expired. {data.proFormaUrl ? <a href={data.proFormaUrl} className="font-bold text-amber-950 underline">Open your Pro Forma to start a new payment.</a> : "Ask the property for a new one."}</>
                        : data.checkout?.message || "Online payment is not available for this property yet."}
                    </div>
                  )}
                  <div className="mt-6">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Payment method</p>
                    <h2 className="mb-0 mt-1 text-lg font-bold text-slate-950">Choose how to pay</h2>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <MethodButton active={channel === "MNO"} disabled={(checkoutAvailable && !offered.includes("MNO")) || processing} icon={<Smartphone />} label="Mobile money" onClick={() => setChannel("MNO")} />
                      <MethodButton active={channel === "BANK"} disabled={(checkoutAvailable && !offered.includes("BANK")) || processing} icon={<Landmark />} label="Bank" onClick={() => setChannel("BANK")} />
                    </div>
                  </div>

                  {processing ? (
                    <div className="mt-4 flex items-center gap-3 rounded-xl border border-solid border-amber-200 bg-amber-50 p-4">
                      <Loader2 className="h-5 w-5 animate-spin text-amber-700" />
                      <div><p className="m-0 text-sm font-bold text-amber-950">{testMode ? "Simulating confirmation" : "Waiting for confirmation"}</p><p className="m-0 mt-1 text-xs text-amber-800">{testMode ? "Testing the provider-pending step. No external request was sent." : "Keep this page open. It will update automatically."}</p></div>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4 rounded-xl border border-solid border-slate-200 bg-[#f8faf9] p-4">
                      {channel === "MNO" ? (
                        <>
                          {networkSwitch && (
                            <div role="status" className="flex items-start gap-2.5 rounded-lg border border-solid border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
                              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                              <span className="min-w-0 flex-1">This number is on <strong>{networkSwitch.to}</strong>, so we switched the network from {networkSwitch.from}. The payment prompt can only reach the wallet on this SIM.</span>
                              <button type="button" aria-label="Dismiss" onClick={() => setNetworkSwitch(null)} className="cursor-pointer border-0 bg-transparent p-0 text-amber-600 hover:text-amber-900"><X className="h-4 w-4" /></button>
                            </div>
                          )}
                          {(() => {
                            const mismatch = Boolean(mnoProvider && detected && detected !== mnoProvider && mnoProvider !== "Azampesa");
                            return (
                              <Field label="Your network">
                                <select
                                  value={mnoProvider}
                                  onChange={(event) => { setMnoProvider(event.target.value as MnoChoice); setNetworkSwitch(null); }}
                                  className={`${inputClass} cursor-pointer ${mismatch ? "!border-amber-400 bg-amber-50" : ""}`}
                                >
                                  <option value="" disabled>Select your network</option>
                                  {MNO_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                                </select>
                                {mismatch && <span className="text-xs font-semibold text-amber-700">This number looks like {providerName(detected!)}. The prompt will only reach the wallet on this SIM.</span>}
                              </Field>
                            );
                          })()}
                          <label className="block min-w-0">
                            <span className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700">
                              <span>Mobile money number</span>
                              {detected && <span className="font-semibold text-emerald-700">Detected: {providerName(detected)}</span>}
                            </span>
                            <span className="relative mt-1.5 block">
                              <input
                                value={phoneNumber}
                                onChange={(event) => changePhone(event.target.value)}
                                inputMode="tel"
                                autoComplete="tel"
                                placeholder="07XXXXXXXX or +255 7XXXXXXXX"
                                className={`${inputClass} pr-10 ${phoneComplete && !phoneValid ? "!border-rose-400" : phoneValid ? "!border-emerald-500" : ""}`}
                              />
                              {phoneValid && <CheckCircle2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />}
                            </span>
                            <span className={`mt-1.5 block text-xs ${phoneComplete && !phoneValid ? "text-rose-600" : "text-slate-500"}`}>
                              {phoneComplete && !phoneValid ? "Enter a valid Tanzanian mobile number." : "You will get a prompt on this phone to approve with your PIN."}
                            </span>
                          </label>
                        </>
                      ) : (
                        <>
                          <div>
                            <p className="m-0 text-xs font-bold text-slate-700">Your bank</p>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              {TZ_CHECKOUT_BANKS.map((bank) => {
                                const active = bankCode === bank.code;
                                return (
                                  <button
                                    key={bank.code}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setBankCode(bank.code)}
                                    className={`flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border-2 border-solid px-3 py-2.5 text-left transition-colors ${active ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                                  >
                                    <span className="relative h-9 w-12 shrink-0 overflow-hidden rounded-md bg-white">
                                      <Image src={bank.logo} alt="" fill sizes="48px" className="object-contain p-0.5" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-bold text-slate-800">{bank.name}</span>
                                      <span className="block truncate text-xs text-slate-500">OTP checkout</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {bankCode ? (
                            <>
                              <div className="rounded-xl bg-emerald-50/70 p-3.5 ring-1 ring-emerald-200">
                                <p className="m-0 text-xs font-bold text-emerald-800">Step 1 · {BANK_OTP_INSTRUCTIONS[bankCode].title}</p>
                                <ol className="m-0 mt-2 list-none space-y-1.5 p-0">
                                  {BANK_OTP_INSTRUCTIONS[bankCode].steps.map((step, index) => (
                                    <li key={step} className="flex gap-2 text-xs leading-5 text-slate-700">
                                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-[9px] font-bold text-white">{index + 1}</span>
                                      {step}
                                    </li>
                                  ))}
                                </ol>
                              </div>
                              <p className="m-0 text-xs font-bold text-slate-700">Step 2 · Enter the account details and the OTP</p>
                              <Field label="Bank account number"><input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} inputMode="numeric" placeholder="The account you selected for the OTP" className={inputClass} /></Field>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Mobile number registered with the bank">
                                  <input value={bankMobile} onChange={(event) => setBankMobile(capTzPhone(event.target.value))} inputMode="tel" placeholder="07XXXXXXXX" className={`${inputClass} ${normalizeTz(bankMobile).length >= 10 && !bankMobileValid ? "!border-rose-400" : ""}`} />
                                </Field>
                                <Field label="Bank OTP"><input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\s/g, ""))} inputMode="numeric" autoComplete="one-time-code" placeholder="From the bank menu" className={inputClass} /></Field>
                              </div>
                            </>
                          ) : (
                            <p className="m-0 text-xs text-slate-500">Choose your bank to see how to get the one-time code (OTP).</p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {notice && <p className="m-0 mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{notice}</p>}
                  {error && <p className="m-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
                  {!processing && !settled && <button type="button" disabled={!canSubmit || submitting} onClick={() => void startPayment()} className="mt-5 inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{testMode ? "Run payment test" : "Pay securely"}</button>}
                </>
              )}
            </div>
          )}
        </section>
        <p className="m-0 mt-4 text-center text-[11px] leading-5 text-slate-500">{testMode ? "Test mode never contacts a bank or mobile-money provider and never records a payment." : "This private link only authorizes the displayed amount and expires after three hours. NoLSAF never asks for your mobile-money PIN."}</p>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-xs font-bold text-slate-700">{label}{children}</label>;
}

function MethodButton({ active, disabled, icon, label, onClick }: { active: boolean; disabled: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-solid px-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4 ${active ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}>{icon}{label}</button>;
}
