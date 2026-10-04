"use client";

// Operator payout destination editor. Same verify-then-confirm flow owners use
// (AzamPay resolves the account holder, the operator confirms the name, only
// then is it saved), with its own step-by-step layout. Owner and driver
// profiles keep using the shared SecurePayoutPreferenceCard unchanged.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
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

const BANKS = [
  { value: "CRDB", label: "CRDB Bank" },
  { value: "NBC", label: "NBC Bank" },
  { value: "NMB", label: "NMB Bank" },
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

/**
 * One phone field with the network picker built in: [logo ▾ | +255 | number].
 * The picker is a real listbox (arrows, Enter, Escape, outside click), each
 * option showing the network's logo and the prefixes it owns.
 */
function WalletField({
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
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const selected = PROVIDERS.find((p) => p.value === provider) || null;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    const at = PROVIDERS.findIndex((p) => p.value === provider);
    setCursor(at >= 0 ? at : 0);
    setOpen(true);
  };

  const pick = (value: string) => {
    onProvider(value);
    setOpen(false);
    numberRef.current?.focus();
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setCursor((c) => (c + 1) % PROVIDERS.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((c) => (c - 1 + PROVIDERS.length) % PROVIDERS.length); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(PROVIDERS[cursor].value); }
    else if (event.key === "Tab") setOpen(false);
  };

  const prefixesOf = (value: string) => {
    const list = (TZ_MOBILE_PREFIXES as Record<string, readonly string[]>)[value];
    return list?.length ? list.map((p) => `0${p}`).join(", ") : "Any network number";
  };

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex h-12 min-w-0 items-stretch overflow-hidden rounded-xl border border-solid bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)] ${
          warn ? "border-amber-400" : open ? "border-[#02665e]" : "border-slate-300 hover:border-slate-400 focus-within:border-[#02665e]"
        }`}
      >
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={onKey}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={selected ? `Network: ${selected.label}. Change network` : "Choose network"}
          style={{ fontFamily: "inherit" }}
          className={`flex flex-shrink-0 cursor-pointer items-center gap-2 border-0 border-r border-solid border-slate-200 px-3 transition-colors disabled:cursor-not-allowed ${open ? "bg-[#02665e]/5" : "bg-slate-50 hover:bg-slate-100"}`}
        >
          <span className={`whitespace-nowrap text-[13px] font-semibold ${selected ? "text-slate-800" : "text-slate-400"}`}>
            {selected ? selected.label : "Network"}
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <span className="inline-flex flex-shrink-0 items-center pl-3.5 text-[15px] font-bold text-slate-400" aria-hidden>+255</span>
        <input
          ref={numberRef}
          type="tel"
          inputMode="numeric"
          value={subscriber}
          onChange={(e) => onNumber(e.target.value)}
          placeholder="7XX XXX XXX"
          maxLength={12}
          autoComplete="tel-national"
          disabled={disabled}
          aria-label="Wallet number after +255"
          aria-describedby="operator-wallet-check"
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 font-mono text-[16px] font-bold tracking-[0.08em] text-slate-900 placeholder:font-sans placeholder:text-[14px] placeholder:font-medium placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:ring-0"
        />
        {subscriber.length === 9 ? (
          <span className="inline-flex items-center pr-3.5 text-emerald-600"><CheckCircle2 className="h-4 w-4" aria-hidden /></span>
        ) : null}
      </div>

      {open ? (
        <ul
          role="listbox"
          aria-label="Mobile money network"
          className="absolute left-0 top-[calc(100%+6px)] z-30 m-0 w-full max-w-sm list-none overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white p-1.5 shadow-[0_24px_48px_-20px_rgba(15,23,42,0.35)]"
        >
          {PROVIDERS.map((p, index) => {
            const isSelected = p.value === provider;
            const isDetected = p.value === detected;
            return (
              <li
                key={p.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setCursor(index)}
                onMouseDown={(e) => { e.preventDefault(); pick(p.value); }}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors ${cursor === index ? "bg-slate-100" : ""}`}
              >
                <span className="relative grid h-9 w-12 flex-shrink-0 place-items-center rounded-lg border border-solid border-slate-200 bg-white">
                  <span className="relative h-6 w-9">
                    <Image src={p.logo} alt="" fill sizes="36px" className="object-contain" />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`text-[13.5px] font-bold ${isSelected ? "text-[#02665e]" : "text-slate-900"}`}>{p.label}</span>
                    {isDetected ? <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Matches number</span> : null}
                  </span>
                  <span className="block truncate text-[11.5px] text-slate-400">{prefixesOf(p.value)}</span>
                </span>
                {isSelected ? <Check className="h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
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
  const [form, setForm] = useState<PayoutPreferenceValue>(saved);
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

  // Step the operator is on: 1 choose method, 2 fill details, 3 verify.
  const step = !method ? 1 : !detailsOk ? 2 : 3;

  const patch = (next: Partial<PayoutPreferenceValue>) => {
    setError(null);
    setSuccess(null);
    setPreview(null);
    setForm((current) => ({ ...current, ...next }));
  };

  const choose = (next: "BANK" | "MOBILE_MONEY") =>
    patch(
      next === "BANK"
        ? { payoutPreferred: "BANK", mobileMoneyProvider: "", mobileMoneyNumber: "" }
        : { payoutPreferred: "MOBILE_MONEY", bankName: "", bankAccountName: "", bankAccountNumber: "", bankBranch: "" }
    );

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
    setForm({ ...saved, ...(clean(saved.payoutPreferred).toUpperCase() === "BANK" ? { bankAccountNumber: "" } : { mobileMoneyNumber: "" }) });
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

  const fieldClass =
    "block h-11 w-full min-w-0 rounded-xl border border-solid border-slate-300 bg-white px-3.5 text-[14px] text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-slate-400 focus:border-[#02665e] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(2,102,94,0.14)] disabled:bg-slate-50";
  const labelClass = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500";

  return (
    <div id="operator-payout" className="min-w-0">
      <style>{"#operator-payout, #operator-payout * { box-sizing: border-box; }"}</style>

      {!editing && isPayoutDestinationComplete(form) ? (
        /* ── Saved destination ── */
        <div className="flex flex-col gap-4 rounded-2xl border border-solid border-emerald-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-[#02665e] text-white">
              {method === "BANK" ? <Building2 className="h-5 w-5" aria-hidden /> : <Smartphone className="h-5 w-5" aria-hidden />}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                Verified payout destination
              </div>
              <div className="mt-0.5 truncate text-[15px] font-bold text-slate-900">
                {method === "BANK"
                  ? `${clean(form.bankName)} · ${mask(form.bankAccountNumber)}`
                  : `${PROVIDER_LABEL[canonicalProvider(form.mobileMoneyProvider)] || clean(form.mobileMoneyProvider)} · ${mask(form.mobileMoneyNumber)}`}
              </div>
              <div className="truncate text-[12px] text-slate-500">
                {method === "BANK" ? `${clean(form.bankAccountName)} · paid manually by NoLSAF finance` : "Paid automatically to this wallet"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={beginChange}
            style={{ fontFamily: "inherit" }}
            className="inline-flex h-9 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 transition-colors hover:border-[#02665e] hover:text-[#02665e]"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Change
          </button>
        </div>
      ) : (
        /* ── Editor ── */
        <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-0 border-b border-solid border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <h3 className="m-0 text-[15px] font-bold text-slate-900">Where should NoLSAF pay you?</h3>
              <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">AzamPay checks the registered name before anything is saved.</p>
            </div>
            <ol className="m-0 flex list-none items-center gap-1.5 p-0" aria-label={`Step ${step} of 3`}>
              {["Method", "Details", "Verify"].map((label, index) => {
                const n = index + 1;
                const done = step > n;
                const current = step === n;
                return (
                  <li key={label} className="flex items-center gap-1.5">
                    {index > 0 ? <span className={`h-px w-4 ${done || current ? "bg-[#02665e]/50" : "bg-slate-200"}`} aria-hidden /> : null}
                    <span
                      className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-bold ${
                        done ? "bg-[#02665e]/10 text-[#02665e]" : current ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-400"
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

          <div className="space-y-5 p-4 sm:p-5">
            {/* Step 1: method */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {[
                { key: "MOBILE_MONEY" as const, icon: Smartphone, title: "Mobile money", text: "Paid automatically to your wallet", badge: "Recommended", badgeCls: "bg-emerald-100 text-emerald-800" },
                { key: "BANK" as const, icon: Building2, title: "Bank account", text: "Name check only, paid manually by finance", badge: "Slower", badgeCls: "bg-slate-100 text-slate-500" },
              ].map((option) => {
                const on = method === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => choose(option.key)}
                    disabled={saving}
                    aria-pressed={on}
                    style={{ fontFamily: "inherit" }}
                    className={`relative flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-2xl border-2 border-solid p-3.5 text-left transition-colors disabled:cursor-not-allowed ${
                      on ? "border-[#02665e] bg-[#02665e]/5" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ${on ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"}`}>
                      <option.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`text-[14px] font-bold ${on ? "text-[#02665e]" : "text-slate-900"}`}>{option.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${option.badgeCls}`}>{option.badge}</span>
                      </span>
                      <span className="block truncate text-[12px] text-slate-500">{option.text}</span>
                    </span>
                    <span className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border-2 border-solid ${on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white text-transparent"}`} aria-hidden>
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Step 2: details */}
            {method === "MOBILE_MONEY" ? (
              <div className="min-w-0 max-w-2xl">
                <span className={labelClass}>Mobile money wallet</span>
                <WalletField
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
                  className={`m-0 mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug ${
                    networkCheck?.kind === "match" ? "text-emerald-700" : networkCheck ? "text-amber-800" : "text-slate-500"
                  }`}
                >
                  {networkCheck?.kind === "match" ? <CheckCircle2 className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden /> : networkCheck ? <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden /> : null}
                  {networkCheck?.text || "Type the number registered to your wallet. We pick the network from it."}
                </p>
              </div>
            ) : method === "BANK" ? (
              <div className="space-y-4">
                <p className="m-0 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" aria-hidden />
                  We verify the account holder name only. Bank payouts are sent manually by NoLSAF finance, so they take longer than mobile money.
                </p>
                <div>
                  <span className={labelClass}>Bank</span>
                  <div className="grid grid-cols-3 gap-2">
                    {BANKS.map((b) => {
                      const on = clean(form.bankName).toUpperCase().replace(/[^A-Z]/g, "").startsWith(b.value);
                      return (
                        <button
                          key={b.value}
                          type="button"
                          onClick={() => patch({ bankName: b.value })}
                          disabled={saving}
                          aria-pressed={on}
                          style={{ fontFamily: "inherit" }}
                          className={`flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border-2 border-solid text-[13px] font-bold transition-colors ${
                            on ? "border-[#02665e] bg-[#02665e]/5 text-[#02665e]" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          {on ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                          {b.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="min-w-0">
                    <span className={labelClass}>Account holder name</span>
                    <input className={fieldClass} value={form.bankAccountName || ""} onChange={(e) => patch({ bankAccountName: e.target.value })} maxLength={160} autoComplete="name" disabled={saving} placeholder="As registered with the bank" />
                  </label>
                  <label className="min-w-0">
                    <span className={labelClass}>Account number</span>
                    <input className={`${fieldClass} font-mono tracking-[0.06em]`} value={form.bankAccountNumber || ""} onChange={(e) => patch({ bankAccountNumber: e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 40) })} autoComplete="off" spellCheck={false} disabled={saving} />
                  </label>
                  <label className="min-w-0 sm:col-span-2">
                    <span className={labelClass}>Branch <span className="normal-case tracking-normal text-slate-400">(optional)</span></span>
                    <input className={fieldClass} value={form.bankBranch || ""} onChange={(e) => patch({ bankBranch: e.target.value })} maxLength={100} autoComplete="off" disabled={saving} />
                  </label>
                </div>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="m-0 flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                {error}
              </p>
            ) : success ? (
              <p className="m-0 flex items-center gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-emerald-800">
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
                  className="inline-flex h-10 cursor-pointer items-center rounded-full border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 transition-colors hover:border-slate-400 disabled:opacity-50"
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                onClick={requestVerify}
                disabled={saving || !detailsOk || !changed}
                style={{ fontFamily: "inherit" }}
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition-colors hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {saving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                {saving ? "Checking with AzamPay..." : method === "BANK" ? "Verify account name" : "Verify wallet"}
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
