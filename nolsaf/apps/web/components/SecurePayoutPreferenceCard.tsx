"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { TZ_MOBILE_PREFIXES } from "@/lib/tzMobileNetworks";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  LockKeyhole,
  Pencil,
  Phone,
  ShieldCheck,
  User,
} from "lucide-react";

export type PayoutPreferenceValue = {
  payoutPreferred?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankBranch?: string | null;
  mobileMoneyProvider?: string | null;
  mobileMoneyNumber?: string | null;
};

type Props = {
  value: PayoutPreferenceValue;
  onChange: (patch: Partial<PayoutPreferenceValue>) => void;
  onSave?: () => void;
  disabled?: boolean;
  saving?: boolean;
  saveDisabled?: boolean;
  saveError?: string | null;
  saveSuccess?: string | null;
  className?: string;
  /**
   * False where bank payouts cannot actually be paid (AzamPay has not enabled
   * bank rails): the bank option is shown as not available instead of a
   * selectable "lookup only" choice that reads like a working payout method.
   */
  bankPayoutsAvailable?: boolean;
};

const inputClass =
  "box-border h-10 w-full min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

const payoutProviders = [
  { value: "azampesa", label: "AzamPesa", supported: true, logo: "/assets/azam-pesa-logo-png.png" },
  { value: "airtel", label: "Airtel Money", supported: true, logo: "/assets/airtel_money.png" },
  { value: "yas", label: "Mixx by Yas", supported: true, logo: "/assets/mix%20by%20yas.png" },
  { value: "vodacom", label: "M-Pesa", supported: true, logo: "/assets/M-pesa.png" },
  { value: "halotel", label: "HaloPesa", supported: true, logo: "/assets/halopesa.png" },
] as const;

type PayoutProviderValue = (typeof payoutProviders)[number]["value"];

// Shared TCRA prefix map (advisory: numbers can be ported), also used at checkout.
const tanzaniaMobilePrefixes: Partial<Record<PayoutProviderValue, readonly string[]>> = TZ_MOBILE_PREFIXES;

type WalletPrefixCheck = {
  kind: "match" | "mismatch";
  message: string;
};

function canonicalPayoutProvider(value: unknown): string {
  const key = clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["tigo", "mixx", "mixxbyyas", "yas"].includes(key)) return "yas";
  if (["mpesa", "vodacom"].includes(key)) return "vodacom";
  if (["halopesa", "halotel"].includes(key)) return "halotel";
  if (["airtel", "airtelmoney"].includes(key)) return "airtel";
  if (key === "azampesa") return "azampesa";
  return key;
}

const payoutBanks = [
  { value: "CRDB", label: "CRDB Bank" },
  { value: "NBC", label: "NBC Bank" },
  { value: "NMB", label: "NMB Bank" },
] as const;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeBankCode(value: unknown): string {
  const normalized = clean(value).toUpperCase().replace(/[^A-Z]/g, "");
  return payoutBanks.find((bank) => normalized === bank.value || normalized === `${bank.value}BANK`)?.value ?? "";
}

function maskDestination(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "Not configured";
  const visible = raw.slice(-4);
  return `${"•".repeat(Math.max(4, Math.min(8, raw.length - visible.length)))} ${visible}`;
}

function tanzaniaWalletSubscriberDigits(value: unknown): string {
  let digits = clean(value).replace(/\D/g, "");
  if (digits.startsWith("255")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 9);
}

function toTanzaniaWalletNumber(value: unknown): string {
  const subscriber = tanzaniaWalletSubscriberDigits(value);
  return subscriber ? `255${subscriber}` : "";
}

function walletPrefixCheck(providerValue: unknown, subscriber: string): WalletPrefixCheck | null {
  if (subscriber.length < 3) return null;

  const selectedProvider = canonicalPayoutProvider(providerValue) as PayoutProviderValue;
  if (selectedProvider === "azampesa") return null;

  const prefix = subscriber.slice(0, 2);
  const detectedProvider = (Object.entries(tanzaniaMobilePrefixes) as Array<[PayoutProviderValue, readonly string[]]>).find(
    ([, prefixes]) => prefixes.includes(prefix)
  )?.[0];
  const selectedLabel = payoutProviders.find((provider) => provider.value === selectedProvider)?.label ?? "selected provider";
  const localPrefix = `0${prefix}`;

  if (!detectedProvider) {
    return {
      kind: "mismatch",
      message: `Prefix ${localPrefix} is not assigned to one of the enabled payout networks. Check the provider and number.`,
    };
  }

  const detectedLabel = payoutProviders.find((provider) => provider.value === detectedProvider)?.label ?? detectedProvider;
  if (detectedProvider !== selectedProvider) {
    return {
      kind: "mismatch",
      message: `Prefix ${localPrefix} normally belongs to ${detectedLabel}, not ${selectedLabel}. Change the provider or check the number. If it was ported, AzamPay verification will confirm it.`,
    };
  }

  return {
    kind: "match",
    message: `Prefix ${localPrefix} matches ${selectedLabel}. AzamPay will confirm the registered wallet before saving.`,
  };
}

export default function SecurePayoutPreferenceCard({
  value,
  onChange,
  onSave,
  disabled = false,
  saving = false,
  saveDisabled = false,
  saveError,
  saveSuccess,
  className = "",
  bankPayoutsAvailable = true,
}: Props) {
  const preferred = clean(value.payoutPreferred).toUpperCase();
  const walletSubscriber = tanzaniaWalletSubscriberDigits(value.mobileMoneyNumber);
  const walletNetworkCheck = walletPrefixCheck(value.mobileMoneyProvider, walletSubscriber);
  const configured = useMemo(() => {
    if (preferred === "BANK") {
      return Boolean(clean(value.bankName) && clean(value.bankAccountName) && clean(value.bankAccountNumber));
    }
    if (preferred === "MOBILE_MONEY") {
      return Boolean(clean(value.mobileMoneyProvider) && clean(value.mobileMoneyNumber));
    }
    return false;
  }, [preferred, value]);
  const [editing, setEditing] = useState(!configured);
  const savedProvider = payoutProviders.find((provider) => provider.value === canonicalPayoutProvider(value.mobileMoneyProvider));

  useEffect(() => {
    if (saveSuccess) setEditing(false);
  }, [saveSuccess]);

  const choose = (method: "BANK" | "MOBILE_MONEY") => {
    if (disabled) return;
    setEditing(true);
    if (method === "BANK") {
      onChange({ payoutPreferred: method, mobileMoneyProvider: "", mobileMoneyNumber: "" });
    } else {
      onChange({
        payoutPreferred: method,
        bankName: "",
        bankAccountName: "",
        bankAccountNumber: "",
        bankBranch: "",
      });
    }
  };

  // Changing a working payout account is never pushed: it is a quiet link,
  // confirmed first (a new account waits 72 hours before it is paid), and the
  // form can always be left with the saved account restored exactly.
  const [confirmingChange, setConfirmingChange] = useState(false);
  const [savedBeforeChange, setSavedBeforeChange] = useState<PayoutPreferenceValue | null>(null);

  const beginChange = () => {
    if (disabled) return;
    setSavedBeforeChange({ ...value });
    setConfirmingChange(false);
    setEditing(true);
    // A destination identifier is never revealed into an editable control.
    // The account holder must deliberately re-enter it before saving.
    onChange(preferred === "BANK" ? { bankAccountNumber: "" } : { mobileMoneyNumber: "" });
  };

  useEffect(() => {
    if (saveSuccess) setSavedBeforeChange(null);
  }, [saveSuccess]);

  const keepCurrent = () => {
    if (savedBeforeChange) onChange(savedBeforeChange);
    setSavedBeforeChange(null);
    setConfirmingChange(false);
    setEditing(false);
  };

  return (
    <section className={`box-border min-w-0 overflow-visible rounded-2xl border border-solid border-slate-300 bg-white ${className}`}>
      <div className="box-border flex min-w-0 flex-col gap-2 border-0 border-b border-solid border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="m-0 text-[15px] font-semibold text-slate-900">Payout destination</h2>
          <p className="m-0 mt-0.5 text-[13px] text-slate-500">Where your verified earnings are paid.</p>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500">
          <LockKeyhole className="h-3.5 w-3.5 text-[#02665e]" aria-hidden /> Protected by AzamPay
        </span>
      </div>

      <div className="box-border min-w-0 space-y-4 p-5">
        {!editing && configured ? (
          <div className="space-y-3">
          <div className="flex flex-col gap-4 rounded-xl border border-solid border-slate-300 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-slate-300 bg-white">
                {preferred === "BANK" || !savedProvider
                  ? <Building2 className="h-5 w-5 text-[#02665e]" aria-hidden />
                  : <ProviderLogo label={savedProvider.label} logo={savedProvider.logo} />}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 truncate text-sm font-semibold text-slate-900">
                    {preferred === "BANK" ? payoutBanks.find((b) => b.value === normalizeBankCode(value.bankName))?.label || value.bankName || "Bank account" : savedProvider?.label || value.mobileMoneyProvider || "Mobile money"}
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" aria-hidden />Active
                  </span>
                </div>
                <p className="m-0 mt-1 truncate text-[13px] text-slate-500">
                  {preferred === "BANK"
                    ? [value.bankAccountName, `Account ${maskDestination(value.bankAccountNumber)}`, value.bankBranch].filter(Boolean).join(" · ")
                    : `Wallet ${maskDestination(value.mobileMoneyNumber)} · TZS`}
                </p>
              </div>
            </div>
            {!confirmingChange && (
              <button
                type="button"
                onClick={() => setConfirmingChange(true)}
                disabled={disabled}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-xs font-medium text-slate-500 underline-offset-4 transition-colors hover:text-[#02665e] hover:underline disabled:cursor-not-allowed disabled:opacity-50 sm:self-center"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Use a different account
              </button>
            )}
          </div>
          {confirmingChange && (
            <div className="flex flex-col gap-3 rounded-xl border border-solid border-amber-200 bg-amber-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-[13px] leading-5 text-amber-900">
                Your current account keeps working until you save a new one. A new account is checked with the provider, and payouts to it
                start 72 hours after you save it.
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingChange(false)}
                  className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-solid border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Keep this account
                </button>
                <button
                  type="button"
                  onClick={beginChange}
                  className="inline-flex h-9 cursor-pointer items-center rounded-lg border-0 bg-[#02665e] px-3.5 text-xs font-semibold text-white hover:bg-[#014d47]"
                >
                  Continue
                </button>
              </div>
            </div>
          )}
          </div>
        ) : (
          <>
            <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
              <MethodButton
                active={preferred === "BANK" && bankPayoutsAvailable}
                disabled={disabled || !bankPayoutsAvailable}
                icon={<Building2 className="h-5 w-5" />}
                label={bankPayoutsAvailable ? "Bank account" : "Bank account · not available yet"}
                hint={
                  bankPayoutsAvailable
                    ? "Verify and save bank details for supported non-automated payout workflows."
                    : "Bank payouts are not available yet. All payouts go to mobile money."
                }
                onClick={() => choose("BANK")}
              />
              <MethodButton
                active={preferred === "MOBILE_MONEY"}
                disabled={disabled}
                icon={<Phone className="h-5 w-5" />}
                label="Mobile money"
                hint="Receive earnings in your verified mobile wallet."
                onClick={() => choose("MOBILE_MONEY")}
              />
            </div>

            {preferred === "BANK" && bankPayoutsAvailable && (
              <div className="grid min-w-0 gap-3 rounded-xl border border-solid border-slate-300 p-4 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-lg border border-solid border-amber-200 bg-amber-50/80 px-3.5 py-3 text-amber-950 shadow-[inset_3px_0_0_#f59e0b] sm:col-span-2 sm:px-4">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700 ring-1 ring-amber-200">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="m-0 text-xs font-semibold text-amber-950">Bank verification only</p>
                      <span className="rounded-full border border-amber-300 bg-white/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-amber-700">
                        Lookup only
                      </span>
                    </div>
                    <p className="mb-0 mt-1 text-[11px] leading-5 text-amber-800">
                      We can verify and save the account holder’s name. For automated payouts, choose mobile money.
                    </p>
                  </div>
                </div>
                <Field icon={<Building2 />} label="Bank name">
                  <div className="relative min-w-0">
                    <select
                      className={`${inputClass} appearance-none pr-10`}
                      value={normalizeBankCode(value.bankName)}
                      onChange={(event) => onChange({ bankName: event.target.value })}
                      disabled={disabled}
                      aria-label="Bank name"
                    >
                      <option value="" disabled>Select bank</option>
                      {payoutBanks.map((bank) => (
                        <option key={bank.value} value={bank.value}>{bank.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
                  </div>
                </Field>
                <Field icon={<User />} label="Account holder name">
                  <input className={inputClass} value={value.bankAccountName || ""} onChange={(event) => onChange({ bankAccountName: event.target.value })} maxLength={160} autoComplete="name" disabled={disabled} />
                </Field>
                <Field icon={<CreditCard />} label="Account number">
                  <input className={inputClass} value={value.bankAccountNumber || ""} onChange={(event) => onChange({ bankAccountNumber: event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 40) })} maxLength={40} autoComplete="off" spellCheck={false} disabled={disabled} />
                </Field>
                <Field icon={<Building2 />} label="Branch (optional)">
                  <input className={inputClass} value={value.bankBranch || ""} onChange={(event) => onChange({ bankBranch: event.target.value })} maxLength={100} autoComplete="off" disabled={disabled} />
                </Field>
              </div>
            )}

            {preferred === "MOBILE_MONEY" && (
              <div className="grid min-w-0 gap-3 rounded-xl border border-solid border-slate-300 p-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-700">
                    <Phone className="h-4 w-4 text-[#02665e]" />Mobile money provider
                  </div>
                  <ProviderPicker
                    value={clean(value.mobileMoneyProvider).toLowerCase()}
                    disabled={disabled}
                    onChange={(provider) => onChange({ mobileMoneyProvider: provider })}
                  />
                </div>
                <Field icon={<CreditCard />} label="Registered wallet number">
                  <div className={`flex h-10 min-w-0 overflow-hidden rounded-md border bg-white transition focus-within:ring-2 has-[:disabled]:bg-slate-100 ${
                    walletNetworkCheck?.kind === "mismatch"
                      ? "border-rose-400 focus-within:border-rose-500 focus-within:ring-rose-500/10"
                      : "border-slate-300 focus-within:border-[#02665e] focus-within:ring-[#02665e]/10"
                  }`}>
                    <span className="inline-flex shrink-0 items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-600" aria-hidden>
                      +255
                    </span>
                    <input
                      className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:text-slate-500"
                      type="tel"
                      inputMode="numeric"
                      aria-label="Registered wallet number after country code plus 255"
                      aria-invalid={walletNetworkCheck?.kind === "mismatch"}
                      aria-describedby="wallet-provider-check"
                      value={walletSubscriber}
                      onChange={(event) => onChange({ mobileMoneyNumber: toTanzaniaWalletNumber(event.target.value) })}
                      placeholder="7XX XXX XXX"
                      minLength={9}
                      maxLength={9}
                      autoComplete="tel-national"
                      disabled={disabled}
                    />
                  </div>
                </Field>
                <div
                  id="wallet-provider-check"
                  aria-live="polite"
                  className={`flex items-start gap-1.5 text-[10px] leading-4 sm:col-span-2 ${
                    walletNetworkCheck?.kind === "mismatch"
                      ? "font-medium text-rose-700"
                      : walletNetworkCheck?.kind === "match"
                        ? "font-medium text-emerald-700"
                        : "text-slate-500"
                  }`}
                >
                  {walletNetworkCheck?.kind === "mismatch" ? (
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : walletNetworkCheck?.kind === "match" ? (
                    <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : (
                    <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
                  )}
                  <span>
                    {walletNetworkCheck?.message ?? "Enter the wallet number to check it against the selected provider."}
                  </span>
                </div>
              </div>
            )}

            {!preferred && (
              <div className="flex items-start gap-2 rounded-lg border border-solid border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Select the destination that should receive your earnings.
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
          <SecurityPoint icon={<BadgeCheck />} text="Name matched by AzamPay" />
          <SecurityPoint icon={<LockKeyhole />} text="Encrypted and masked" />
          <SecurityPoint icon={<ShieldCheck />} text="Risk-reviewed before payouts" />
        </div>

        {onSave && (editing || !configured || saveError || saveSuccess) && (
          <div className="flex flex-col gap-3 border-0 border-t border-solid border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs leading-5">
              {saveError ? (
                <span className="text-rose-700">{saveError}</span>
              ) : saveSuccess ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{saveSuccess}</span>
              ) : (
                <span className="text-slate-500">
                  {preferred === "BANK"
                    ? "Verify the bank account holder for profile use; this does not enable automated bank payout."
                    : "Complete the destination, then verify its registered name."}
                </span>
              )}
            </div>
            {savedBeforeChange && (
              <button
                type="button"
                onClick={keepCurrent}
                disabled={saving}
                className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-solid border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Keep current account
              </button>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={disabled || saving || saveDisabled}
              className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#01564f] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              {saving
                ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />Verifying...</>
                : <><ShieldCheck className="h-3.5 w-3.5" />{preferred === "BANK" ? "Verify bank name" : "Verify destination"}</>}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function MethodButton({ active, disabled, icon, label, hint, onClick }: { active: boolean; disabled: boolean; icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} className={`box-border min-h-[64px] min-w-0 cursor-pointer rounded-xl border border-solid px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-[#02665e] bg-[#02665e]/[0.035]" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <span className="flex min-w-0 items-center gap-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md [&>svg]:h-4 [&>svg]:w-4 ${active ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-600"}`}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-2 text-sm font-semibold ${active ? "text-[#02665e]" : "text-slate-800"}`}>{label}{active && <CheckCircle2 className="h-4 w-4 shrink-0" />}</span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-500">{hint}</span>
        </span>
      </span>
    </button>
  );
}

function ProviderPicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (provider: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canonicalValue = canonicalPayoutProvider(value);
  const selected = payoutProviders.find((provider) => provider.value === canonicalValue);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative min-w-0 ${open ? "z-30" : ""}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-md border bg-white px-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/15 disabled:cursor-not-allowed disabled:bg-slate-100 ${
          open ? "border-[#02665e] ring-2 ring-[#02665e]/10" : "border-slate-300 hover:border-slate-400"
        }`}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-7 w-16 shrink-0 items-center justify-center overflow-hidden"><ProviderLogo label={selected.label} logo={selected.logo} /></span>
            <span className="truncate text-sm font-medium text-slate-700">{selected.label}</span>
          </span>
        ) : (
          <span className="text-sm font-medium text-slate-500">Select provider</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div role="listbox" aria-label="Mobile money providers" className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-[0_14px_36px_rgba(15,23,42,0.16)]">
          {payoutProviders.map((provider) => {
            const isSelected = canonicalValue === provider.value;
            const unavailable = !provider.supported;
            return (
              <button
                key={provider.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={unavailable}
                onClick={() => {
                  if (unavailable) return;
                  onChange(provider.value);
                  setOpen(false);
                }}
                className={`flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#02665e]/25 ${
                  unavailable
                    ? "cursor-not-allowed bg-slate-50 text-slate-400"
                    : isSelected
                      ? "bg-[#02665e]/[0.08] text-[#02665e]"
                      : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className={`flex h-8 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/80 ${unavailable ? "grayscale opacity-55" : ""}`}>
                  <ProviderLogo label={provider.label} logo={provider.logo} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{provider.label}</span>
                  {unavailable && <span className="block text-[10px] text-slate-400">Unavailable for AzamPay payouts</span>}
                </span>
                {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProviderLogo({ label, logo }: { label: string; logo: string }) {
  return <Image src={logo} alt={`${label} logo`} width={88} height={28} unoptimized className="h-6 w-auto max-w-[60px] object-contain" />;
}

function Field({ icon, label, children }: { icon: React.ReactElement<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-700">
        <span className="text-[#02665e] [&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}
      </span>
      {children}
    </label>
  );
}

function SecurityPoint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <span className="flex min-w-0 items-center gap-1.5"><span className="shrink-0 text-[#02665e] [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span><span>{text}</span></span>;
}
