"use client";

// Operator payout destination editor. Same verify-then-confirm flow owners use
// (AzamPay resolves the account holder, the operator confirms the name, only
// then is it saved), with its own step-by-step layout. Owner and driver
// profiles keep using the shared SecurePayoutPreferenceCard unchanged.
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  LockKeyhole,
  Pencil,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { TZ_MOBILE_PREFIXES } from "@/lib/tzMobileNetworks";
import type { PayoutPreferenceValue } from "@/components/SecurePayoutPreferenceCard";

type Verification = {
  challengeToken: string;
  expiresAt: string;
  destination: { type: "BANK" | "MOBILE_MONEY"; provider: string; accountNumber: string; accountName: string };
  draft: PayoutPreferenceValue;
};

const PAYOUT_KEYS: Array<keyof PayoutPreferenceValue> = [
  "payoutPreferred",
  "bankName",
  "bankAccountName",
  "bankAccountNumber",
  "bankBranch",
  "mobileMoneyProvider",
  "mobileMoneyNumber",
];

const PROVIDERS = [
  { value: "vodacom", label: "M-Pesa", logo: "/assets/M-pesa.png" },
  { value: "airtel", label: "Airtel Money", logo: "/assets/airtel_money.png" },
  { value: "yas", label: "Mixx by Yas", logo: "/assets/mix%20by%20yas.png" },
  { value: "halotel", label: "HaloPesa", logo: "/assets/halopesa.png" },
  { value: "azampesa", label: "AzamPesa", logo: "/assets/azam-pesa-logo-png.png" },
] as const;

const PROVIDER_LABEL: Record<string, string> = {
  azampesa: "AzamPesa",
  airtel: "Airtel Money",
  tigo: "Mixx by Yas",
  yas: "Mixx by Yas",
  mpesa: "M-Pesa",
  vodacom: "M-Pesa",
  halopesa: "HaloPesa",
  halotel: "HaloPesa",
};

const clean = (value: unknown) => String(value ?? "").trim();

function canonicalProvider(value: unknown): string {
  const key = clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["tigo", "mixx", "mixxbyyas", "yas"].includes(key)) return "yas";
  if (["mpesa", "vodacom"].includes(key)) return "vodacom";
  if (["halopesa", "halotel"].includes(key)) return "halotel";
  if (["airtel", "airtelmoney"].includes(key)) return "airtel";
  if (key === "azampesa") return "azampesa";
  return key;
}

/** The 9 digits after 0 / 255 / +255. */
function subscriberDigits(value: unknown): string {
  let digits = clean(value).replace(/\D/g, "");
  if (digits.startsWith("255")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 9);
}

function networkForPrefix(subscriber: string): string | null {
  if (subscriber.length < 2) return null;
  const prefix = subscriber.slice(0, 2);
  const hit = (Object.entries(TZ_MOBILE_PREFIXES) as Array<[string, readonly string[]]>).find(([, list]) => list.includes(prefix));
  return hit ? hit[0] : null;
}

function mask(value: unknown): string {
  const raw = clean(value);
  return raw ? `•••• ${raw.slice(-4)}` : "Not set";
}

/** "712345678" as "712 345 678", grouped the way people read phone numbers. */
function groupNumber(subscriber: string): string {
  return [subscriber.slice(0, 3), subscriber.slice(3, 6), subscriber.slice(6, 9)].filter(Boolean).join(" ");
}

/**
 * The wallet picker: the five payout networks as logo tiles (the number picks
 * one automatically, a tap overrides it), then one large number field.
 */
function WalletPicker({
  provider,
  detected,
  subscriber,
  disabled,
  warn,
  onProvider,
  onNumber,
}: {
  provider: string;
  detected: string | null;
  subscriber: string;
  disabled: boolean;
  warn: boolean;
  onProvider: (value: string) => void;
  onNumber: (raw: string) => void;
}) {
  const selected = PROVIDERS.find((p) => p.value === provider) || null;
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <p className="m-0 mb-2 flex items-center gap-2 text-[12.5px] font-medium text-slate-700">
          <span className="grid h-5 w-5 place-items-center rounded bg-[#02665e] text-[11px] font-bold text-white">1</span>
          Your network
        </p>
        {/* One slim joined bar: logo and name side by side, the chosen network
            underlined in brand green. Scrolls sideways on narrow phones. */}
        <div
          role="radiogroup"
          aria-label="Mobile money network"
          className="flex min-w-0 overflow-x-auto rounded-md border border-solid border-slate-200 bg-white [scrollbar-width:none]"
        >
          {PROVIDERS.map((p, index) => {
            const on = p.value === provider;
            const isDetected = p.value === detected && !on;
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onProvider(p.value)}
                title={isDetected ? `${p.label} matches your number` : p.label}
                style={{ fontFamily: "inherit" }}
                className={`relative flex h-11 min-w-[7.5rem] flex-1 cursor-pointer items-center justify-center gap-2 border-0 px-3 transition disabled:cursor-not-allowed ${
                  index ? "border-l border-solid border-slate-200" : ""
                } ${on ? "bg-[#02665e]/[0.06]" : "bg-white hover:bg-slate-50"}`}
              >
                <span className={`relative h-5 w-8 shrink-0 transition ${on ? "" : "opacity-80 grayscale-[35%]"}`}>
                  <Image src={p.logo} alt="" fill sizes="32px" className="object-contain" />
                </span>
                <span className={`truncate text-[12.5px] ${on ? "font-semibold text-[#02665e]" : "font-medium text-slate-600"}`}>{p.label}</span>
                {isDetected ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-label="Matches your number" /> : null}
                {on ? <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[#02665e]" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="m-0 mb-2 flex items-center gap-2 text-[12.5px] font-medium text-slate-700">
          <span className="grid h-5 w-5 place-items-center rounded bg-[#02665e] text-[11px] font-bold text-white">2</span>
          Wallet number
        </p>
        {/* Compact field: the chosen network sits beside +255, and a thin line
            under the number fills as the nine digits go in. */}
        <label
          className={`relative flex h-11 w-full max-w-[22rem] min-w-0 items-center overflow-hidden rounded-md border border-solid bg-white transition-[border-color,box-shadow] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.12)] ${
            warn ? "border-amber-400" : "border-slate-300 hover:border-slate-400 focus-within:border-[#02665e]"
          }`}
        >
          <span className="flex h-full shrink-0 items-center gap-1.5 border-0 border-r border-solid border-slate-200 bg-slate-50 pl-2.5 pr-3 text-[13.5px] font-semibold text-slate-600">
            {selected ? (
              <span className="relative h-4 w-6 shrink-0">
                <Image src={selected.logo} alt="" fill sizes="24px" className="object-contain" />
              </span>
            ) : null}
            +255
          </span>
          <input
            type="tel"
            inputMode="numeric"
            value={groupNumber(subscriber)}
            onChange={(e) => onNumber(e.target.value)}
            placeholder="712 345 678"
            maxLength={13}
            autoComplete="tel-national"
            disabled={disabled}
            aria-label="Wallet number after +255"
            aria-describedby="operator-wallet-check"
            className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-[16px] font-semibold tabular-nums tracking-[0.04em] text-slate-900 placeholder:font-normal placeholder:text-slate-300 focus:outline-none focus:ring-0"
          />
          {subscriber.length === 9 ? (
            <CheckCircle2 className="mr-3 h-[18px] w-[18px] shrink-0 text-emerald-600" aria-label="Complete number" />
          ) : null}
          <span className="absolute inset-x-0 bottom-0 h-[2px] bg-slate-100" aria-hidden>
            <span
              className={`block h-full transition-[width] duration-200 ${subscriber.length === 9 ? "bg-emerald-500" : "bg-[#02665e]/60"}`}
              style={{ width: `${(subscriber.length / 9) * 100}%` }}
            />
          </span>
        </label>
      </div>
    </div>
  );
}

/** A live preview of the wallet being added: what AzamPay will be asked to confirm. */
function WalletPreviewCard({ provider, subscriber }: { provider: string; subscriber: string }) {
  const network = PROVIDERS.find((p) => p.value === provider) || null;
  const complete = subscriber.length === 9 && Boolean(network);
  const digits = subscriber.padEnd(9, "•");
  return (
    <div className="min-w-0 space-y-3">
      <div className="relative overflow-hidden rounded-lg bg-[#023d38] p-4 text-white">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/[0.06]" aria-hidden />
        <div className="relative flex items-start justify-between gap-3">
          <span className="text-[11.5px] font-medium text-white/60">Payout wallet</span>
          {network ? (
            <span className="relative grid h-8 w-12 place-items-center rounded bg-white">
              <span className="relative h-5 w-9">
                <Image src={network.logo} alt={network.label} fill sizes="36px" className="object-contain" />
              </span>
            </span>
          ) : (
            <span className="grid h-8 w-12 place-items-center rounded border border-dashed border-white/25 text-[10px] text-white/40">Network</span>
          )}
        </div>
        <p className="relative m-0 mt-5 font-mono text-[19px] font-semibold tracking-[0.08em]">
          +255 {digits.slice(0, 3)} {digits.slice(3, 6)} {digits.slice(6, 9)}
        </p>
        <div className="relative mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[10.5px] text-white/50">Account holder</p>
            <p className="m-0 mt-0.5 truncate text-[13px] font-medium text-white/80">{complete ? "Confirmed by AzamPay next" : "Shown after the check"}</p>
          </div>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${complete ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/50"}`}>
            {complete ? "Ready to verify" : network ? "Enter number" : "Pick network"}
          </span>
        </div>
      </div>
      <ul className="m-0 list-none space-y-1.5 p-0 text-[12px] leading-5 text-slate-600">
        <li className="flex items-start gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />Paid automatically once a claim is approved</li>
        <li className="flex items-start gap-1.5"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />Stored encrypted; only the last 4 digits are shown</li>
        <li className="flex items-start gap-1.5"><Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />Bank accounts are not supported yet</li>
      </ul>
    </div>
  );
}

export function isPayoutDestinationComplete(value: PayoutPreferenceValue | null | undefined): boolean {
  if (!value) return false;
  const preferred = clean(value.payoutPreferred).toUpperCase();
  if (preferred === "BANK") return Boolean(clean(value.bankName) && clean(value.bankAccountName) && clean(value.bankAccountNumber));
  if (preferred === "MOBILE_MONEY") return Boolean(clean(value.mobileMoneyProvider) && clean(value.mobileMoneyNumber));
  return false;
}

/**
 * Whether NoLSAF can actually send money here today. The payout ledger only
 * pays mobile money through AzamPay; bank payouts are not enabled yet
 * (Disbursement Policy 5.4), so a bank destination is saved but not payable.
 */
export function isPayoutDestinationPayable(value: PayoutPreferenceValue | null | undefined): boolean {
  return isPayoutDestinationComplete(value) && clean(value?.payoutPreferred).toUpperCase() === "MOBILE_MONEY";
}

export default function OperatorPayoutDestination({
  saved,
  onSaved,
  onCancel,
}: {
  saved: PayoutPreferenceValue;
  onSaved: (next: PayoutPreferenceValue) => void;
  onCancel?: () => void;
}) {
  const savedComplete = isPayoutDestinationComplete(saved);
  const [editing, setEditing] = useState(!savedComplete);
  // Payouts go to mobile money only (Disbursement Policy 5.4), so the editor
  // always starts on a wallet; there is no method to choose.
  const [form, setForm] = useState<PayoutPreferenceValue>(() =>
    savedComplete ? saved : { ...saved, payoutPreferred: "MOBILE_MONEY", bankName: "", bankAccountName: "", bankAccountNumber: "", bankBranch: "" }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<Verification | null>(null);
  // The 2-digit prefix that was typed when the operator picked a network by
  // hand. That manual choice (a ported number, AzamPesa) wins until the prefix
  // changes; otherwise the network always follows the number.
  const manualPickPrefix = useRef<string | null>(null);

  const method = clean(form.payoutPreferred).toUpperCase() as "BANK" | "MOBILE_MONEY" | "";
  const detailsOk = isPayoutDestinationComplete(form);
  const changed = useMemo(() => PAYOUT_KEYS.some((key) => clean(form[key]) !== clean(saved[key])), [form, saved]);
  const subscriber = subscriberDigits(form.mobileMoneyNumber);
  const provider = canonicalProvider(form.mobileMoneyProvider);
  const detected = networkForPrefix(subscriber);
  const networkCheck: { kind: "match" | "mismatch" | "unknown"; text: string } | null =
    method !== "MOBILE_MONEY" || subscriber.length < 3 || provider === "azampesa"
      ? null
      : !detected
        ? { kind: "unknown", text: `Prefix 0${subscriber.slice(0, 2)} is not on a supported payout network. Check the number.` }
        : provider && detected !== provider
          ? { kind: "mismatch", text: `0${subscriber.slice(0, 2)} usually belongs to ${PROVIDER_LABEL[detected]}, not ${PROVIDER_LABEL[provider] || provider}. If the number was ported, AzamPay will confirm it.` }
          : { kind: "match", text: `0${subscriber.slice(0, 2)} matches ${PROVIDER_LABEL[detected]}.` };

  // Step the operator is on: 1 enter the wallet, 2 confirm the registered name.
  const step = !detailsOk ? 1 : 2;

  const patch = (next: Partial<PayoutPreferenceValue>) => {
    setError(null);
    setSuccess(null);
    setPreview(null);
    setForm((current) => ({ ...current, ...next }));
  };

  const setWallet = (raw: string) => {
    const digits = subscriberDigits(raw);
    const guess = networkForPrefix(digits);
    const prefix = digits.slice(0, 2);
    const manualHolds = manualPickPrefix.current !== null && manualPickPrefix.current === prefix;
    if (!manualHolds) manualPickPrefix.current = null;
    patch({
      mobileMoneyNumber: digits ? `255${digits}` : "",
      ...(guess && !manualHolds && guess !== provider ? { mobileMoneyProvider: guess } : {}),
    });
  };

  const pickProvider = (value: string) => {
    manualPickPrefix.current = subscriber.slice(0, 2);
    patch({ mobileMoneyProvider: value });
  };

  const beginChange = () => {
    // A saved destination identifier is never put back into an editable field:
    // changing it means re-entering it deliberately.
    // A saved bank account cannot be paid, so changing always moves to a wallet.
    const wasBank = clean(saved.payoutPreferred).toUpperCase() === "BANK";
    setForm({
      ...saved,
      payoutPreferred: "MOBILE_MONEY",
      mobileMoneyProvider: wasBank ? "" : saved.mobileMoneyProvider,
      mobileMoneyNumber: "",
      bankName: "",
      bankAccountName: "",
      bankAccountNumber: "",
      bankBranch: "",
    });
    setError(null);
    setSuccess(null);
    setEditing(true);
  };

  const cancel = () => {
    setForm(saved);
    setError(null);
    setPreview(null);
    if (savedComplete) setEditing(false);
    onCancel?.();
  };

  const buildDraft = (): PayoutPreferenceValue =>
    method === "BANK"
      ? { payoutPreferred: "BANK", bankName: clean(form.bankName), bankAccountName: clean(form.bankAccountName), bankAccountNumber: clean(form.bankAccountNumber), bankBranch: clean(form.bankBranch) }
      : { payoutPreferred: "MOBILE_MONEY", mobileMoneyProvider: clean(form.mobileMoneyProvider), mobileMoneyNumber: clean(form.mobileMoneyNumber) };

  const requestVerify = async () => {
    setError(null);
    setSuccess(null);
    setPreview(null);
    if (!detailsOk) return setError("Complete the destination before verifying.");
    if (!changed) return setSuccess("This payout destination is already saved.");
    setSaving(true);
    try {
      const draft = buildDraft();
      const response = await apiClient.post("/api/account/payouts/verify", draft);
      const verification = (response as any)?.data?.data;
      if (!verification?.challengeToken || !verification?.destination?.accountName) {
        throw new Error("AzamPay did not return a valid account holder confirmation.");
      }
      setPreview({ ...verification, draft });
    } catch (err: any) {
      const data = err?.response?.data;
      setError(
        String(data?.code || "") === "PAYOUT_PROVIDER_NOT_CONFIGURED"
          ? "Payout verification is not configured. Your previous payout destination remains unchanged."
          : String(data?.error || data?.message || err?.message || "Payout verification failed. Your previous payout destination remains unchanged.")
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmSave = async () => {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.put("/api/account/payouts", { challengeToken: preview.challengeToken });
      const verified = (response as any)?.data?.data?.payoutAccount;
      const isBank = preview.destination.type === "BANK";
      const next: PayoutPreferenceValue = isBank
        ? { ...preview.draft, bankAccountName: clean(verified?.accountName || preview.destination.accountName), mobileMoneyProvider: "", mobileMoneyNumber: "" }
        : { ...preview.draft, bankName: "", bankAccountName: "", bankAccountNumber: "", bankBranch: "" };
      setForm(next);
      setPreview(null);
      setEditing(false);
      setSuccess(isBank ? "Bank account holder verified and saved. Bank payouts are processed manually." : "Payout destination verified and saved.");
      onSaved(next);
    } catch (err: any) {
      const data = err?.response?.data;
      if (String(data?.code || "") === "PAYOUT_VERIFICATION_EXPIRED") {
        setPreview(null);
        setError("This verification has expired or was already used. Verify the destination again.");
      } else {
        setError(String(data?.error || data?.message || "The verified destination could not be saved. Your previous destination remains unchanged."));
      }
    } finally {
      setSaving(false);
    }
  };


  return (
    <div id="operator-payout" className="min-w-0">
      <style>{"#operator-payout, #operator-payout * { box-sizing: border-box; }"}</style>

      {!editing && isPayoutDestinationComplete(form) ? (
        /* ── Saved destination ── */
        <div className={`flex flex-col gap-4 rounded-lg border border-solid bg-white p-4 sm:flex-row sm:items-center sm:justify-between ${method === "BANK" ? "border-amber-300" : "border-emerald-200"}`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-md bg-[#02665e] text-white">
              {method === "BANK" ? <Building2 className="h-5 w-5" aria-hidden /> : <Smartphone className="h-5 w-5" aria-hidden />}
            </span>
            <div className="min-w-0">
              <div className={`flex items-center gap-1.5 text-[12px] font-semibold ${method === "BANK" ? "text-amber-800" : "text-emerald-700"}`}>
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                {method === "BANK" ? "Saved, but cannot be paid" : "Verified payout destination"}
              </div>
              <div className="mt-0.5 truncate text-[15px] font-bold text-slate-900">
                {method === "BANK"
                  ? `${clean(form.bankName)} · ${mask(form.bankAccountNumber)}`
                  : `${PROVIDER_LABEL[canonicalProvider(form.mobileMoneyProvider)] || clean(form.mobileMoneyProvider)} · ${mask(form.mobileMoneyNumber)}`}
              </div>
              <div className="truncate text-[12px] text-slate-500">
                {method === "BANK" ? `${clean(form.bankAccountName)}` : "Paid automatically to this wallet"}
              </div>
              {method === "BANK" ? (
                <div className="mt-1 flex items-start gap-1.5 text-[12px] font-semibold text-amber-800">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                  Bank accounts cannot receive payouts yet. Change to mobile money to be paid.
                </div>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={beginChange}
            style={{ fontFamily: "inherit" }}
            className={`inline-flex h-9 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-solid px-3.5 text-[13px] font-semibold transition-colors ${method === "BANK" ? "border-[#02665e] bg-[#02665e] text-white hover:bg-[#014d47]" : "border-slate-300 bg-white text-slate-700 hover:border-[#02665e] hover:text-[#02665e]"}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {method === "BANK" ? "Add mobile money" : "Change"}
          </button>
        </div>
      ) : (
        /* ── Editor ── */
        <div className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                <Smartphone className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="m-0 text-[15px] font-semibold text-slate-900">Where should NoLSAF pay you?</h3>
                <p className="m-0 mt-0.5 text-[12.5px] leading-5 text-slate-500">Payouts go to a mobile money wallet. AzamPay checks the registered name before anything is saved.</p>
              </div>
            </div>
            <ol className="m-0 flex list-none items-center gap-1.5 p-0" aria-label={`Step ${step} of 2`}>
              {["Wallet number", "Confirm name"].map((label, index) => {
                const n = index + 1;
                const done = step > n;
                const current = step === n;
                return (
                  <li key={label} className="flex items-center gap-1.5">
                    {index > 0 ? <span className={`h-px w-4 ${done || current ? "bg-[#02665e]/50" : "bg-slate-200"}`} aria-hidden /> : null}
                    <span
                      className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11.5px] font-semibold ${
                        done ? "bg-emerald-50 text-emerald-800" : current ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {done ? <Check className="h-3 w-3" aria-hidden /> : <span className="tabular-nums">{n}</span>}
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
              <div className="min-w-0">
                <WalletPicker
                  provider={provider}
                  detected={detected}
                  subscriber={subscriber}
                  disabled={saving}
                  warn={networkCheck?.kind === "mismatch" || networkCheck?.kind === "unknown"}
                  onProvider={pickProvider}
                  onNumber={setWallet}
                />
                <p
                  id="operator-wallet-check"
                  aria-live="polite"
                  className={`m-0 mt-2 flex items-start gap-1.5 text-[12px] leading-snug ${
                    networkCheck?.kind === "match" ? "text-emerald-700" : networkCheck ? "text-amber-800" : "text-slate-500"
                  }`}
                >
                  {networkCheck?.kind === "match" ? <CheckCircle2 className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden /> : networkCheck ? <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden /> : null}
                  {networkCheck?.text || "Type your number and we pick the network. Tap a network if your number was moved from another one."}
                </p>
              </div>
              <WalletPreviewCard provider={provider} subscriber={subscriber} />
            </div>

            {error ? (
              <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                {error}
              </p>
            ) : success ? (
              <p className="m-0 flex items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-emerald-800">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden />
                {success}
              </p>
            ) : null}
          </div>

          {/* Step 3: verify */}
          <div className="flex flex-col gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />Name matched by AzamPay</span>
              <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />Encrypted and masked</span>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {savedComplete || onCancel ? (
                <button
                  type="button"
                  onClick={cancel}
                  disabled={saving}
                  style={{ fontFamily: "inherit" }}
                  className="inline-flex h-10 cursor-pointer items-center rounded-md border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 transition-colors hover:border-slate-400 disabled:opacity-50"
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                onClick={requestVerify}
                disabled={saving || !detailsOk || !changed}
                style={{ fontFamily: "inherit" }}
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {saving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                {saving ? "Checking with AzamPay..." : "Verify wallet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="operator-payout-confirm-title"
              className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
              onClick={(event) => { if (event.target === event.currentTarget && !saving) setPreview(null); }}
            >
              <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" aria-hidden />
              <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white shadow-2xl" style={{ boxSizing: "border-box" }}>
                <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-5">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                      <ShieldCheck className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 id="operator-payout-confirm-title" className="m-0 text-[16px] font-bold text-slate-900">Is this you?</h2>
                      <p className="m-0 mt-0.5 text-[12.5px] leading-5 text-slate-500">AzamPay found this registered name. Save only if it is yours.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    disabled={saving}
                    className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    aria-label="Close confirmation"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3 px-5 pb-5 pt-3">
                  <div className="rounded-2xl bg-[#02665e] px-4 py-4 text-white">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-white/70">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Registered account holder
                    </div>
                    <div className="mt-1.5 break-words text-[20px] font-bold leading-tight">{preview.destination.accountName}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[12.5px] text-white/75">
                      <span>{preview.destination.type === "BANK" ? "Bank account" : PROVIDER_LABEL[preview.destination.provider.toLowerCase()] || preview.destination.provider}</span>
                      <span aria-hidden>·</span>
                      <span className="font-mono">{preview.destination.accountNumber}</span>
                    </div>
                  </div>
                  {preview.destination.type === "BANK" ? (
                    <p className="m-0 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] leading-5 text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                      Bank payouts are sent manually by NoLSAF finance, not automatically.
                    </p>
                  ) : null}
                  <p className="m-0 flex items-start gap-2 text-[12px] leading-5 text-slate-500">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    This check expires at {new Date(preview.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Nothing changes until you save.
                  </p>
                </div>

                <div className="flex flex-col-reverse gap-2 border-0 border-t border-solid border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    disabled={saving}
                    className="h-10 cursor-pointer rounded-full border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    Not me, go back
                  </button>
                  <button
                    type="button"
                    onClick={confirmSave}
                    disabled={saving}
                    className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                    {saving ? "Saving..." : "Yes, save destination"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
