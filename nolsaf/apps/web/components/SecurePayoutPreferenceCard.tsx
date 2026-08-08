"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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
};

const inputClass =
  "box-border h-10 w-full min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

const payoutProviders = [
  { value: "azampesa", label: "AzamPesa", supported: true, logo: null },
  { value: "airtel", label: "Airtel Money", supported: true, logo: "/assets/airtel_money.png" },
  { value: "tigo", label: "Mixx by Yas", supported: true, logo: "/assets/mix%20by%20yas.png" },
  { value: "mpesa", label: "M-Pesa", supported: false, logo: "/assets/M-pesa.png" },
  { value: "halopesa", label: "HaloPesa", supported: false, logo: "/assets/halopesa.png" },
] as const;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function maskDestination(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "Not configured";
  const visible = raw.slice(-4);
  return `${"•".repeat(Math.max(4, Math.min(8, raw.length - visible.length)))} ${visible}`;
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
}: Props) {
  const preferred = clean(value.payoutPreferred).toUpperCase();
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

  const beginChange = () => {
    if (disabled) return;
    setEditing(true);
    // A destination identifier is never revealed into an editable control.
    // The account holder must deliberately re-enter it before saving.
    onChange(preferred === "BANK" ? { bankAccountNumber: "" } : { mobileMoneyNumber: "" });
  };

  return (
    <section className={`box-border min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="box-border flex min-w-0 flex-col gap-2.5 border-b border-slate-200 bg-slate-50/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-[#02665e]">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-semibold text-slate-800">Secure payout destination</h2>
              <p className="mb-0 mt-0.5 text-xs leading-5 text-slate-500">Choose where verified earnings are deposited.</p>
            </div>
          </div>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-emerald-700">
          <LockKeyhole className="h-3 w-3" aria-hidden /> AzamPay protected
        </span>
      </div>

      <div className="box-border min-w-0 space-y-3 p-4 sm:px-5 sm:py-4">
        {!editing && configured ? (
          <div className="overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50/30">
            <div className="flex flex-col gap-3 border-b border-emerald-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e] text-white">
                  {preferred === "BANK" ? <Building2 className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">Current payout method</p>
                  <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-800">
                    {preferred === "BANK" ? value.bankAccountName || "Bank account" : value.mobileMoneyProvider || "Mobile money"}
                  </p>
                </div>
              </div>
              <button type="button" onClick={beginChange} disabled={disabled} className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-white px-3 text-xs font-medium text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                <Pencil className="h-3.5 w-3.5" /> Change destination
              </button>
            </div>
            <dl className="m-0 grid gap-px bg-slate-200/70 sm:grid-cols-2 lg:grid-cols-4">
              {preferred === "BANK" ? (
                <>
                  <Summary label="Bank" value={value.bankName} />
                  <Summary label="Account holder" value={value.bankAccountName} />
                  <Summary label="Account number" value={maskDestination(value.bankAccountNumber)} />
                  <Summary label="Branch" value={value.bankBranch || "Not provided"} />
                </>
              ) : (
                <>
                  <Summary label="Method" value="Mobile money" />
                  <Summary label="Provider" value={value.mobileMoneyProvider} />
                  <Summary label="Wallet number" value={maskDestination(value.mobileMoneyNumber)} />
                  <Summary label="Currency" value="TZS" />
                </>
              )}
            </dl>
          </div>
        ) : (
          <>
            <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
              <MethodButton
                active={preferred === "BANK"}
                disabled={disabled}
                icon={<Building2 className="h-5 w-5" />}
                label="Bank account"
                hint="Receive earnings in your verified bank account."
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

            {preferred === "BANK" && (
              <div className="grid min-w-0 gap-3 rounded-md border border-slate-200 bg-slate-50/40 p-3.5 sm:grid-cols-2 sm:p-4">
                <Field icon={<Building2 />} label="Bank name">
                  <input className={inputClass} value={value.bankName || ""} onChange={(event) => onChange({ bankName: event.target.value })} maxLength={100} autoComplete="organization" disabled={disabled} />
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
              <div className="grid min-w-0 gap-3 rounded-md border border-slate-200 bg-slate-50/40 p-3.5 sm:grid-cols-2 sm:p-4">
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
                  <input className={inputClass} type="tel" inputMode="numeric" value={value.mobileMoneyNumber || ""} onChange={(event) => onChange({ mobileMoneyNumber: event.target.value.replace(/\D/g, "").slice(0, 15) })} minLength={9} maxLength={15} autoComplete="off" disabled={disabled} />
                </Field>
              </div>
            )}

            {!preferred && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Select the destination that should receive your earnings.
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-slate-200 bg-slate-50/70 px-3 py-2.5 text-[11px] leading-4 text-slate-600">
          <SecurityPoint icon={<BadgeCheck />} text="Name matched by AzamPay" />
          <SecurityPoint icon={<LockKeyhole />} text="Details encrypted and masked" />
          <SecurityPoint icon={<ShieldCheck />} text="Destination risk-reviewed" />
        </div>

        {onSave && (
          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs leading-5">
              {saveError ? (
                <span className="text-rose-700">{saveError}</span>
              ) : saveSuccess ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{saveSuccess}</span>
              ) : (
                <span className="text-slate-500">Complete the destination, then verify its registered name.</span>
              )}
            </div>
            <button
              type="button"
              onClick={onSave}
              disabled={disabled || saving || saveDisabled}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-[#02665e] px-4 text-xs font-medium text-white transition hover:bg-[#01564f] disabled:cursor-not-allowed disabled:border disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500"
            >
              {saving
                ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />Verifying...</>
                : <><ShieldCheck className="h-3.5 w-3.5" />Verify destination</>}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function MethodButton({ active, disabled, icon, label, hint, onClick }: { active: boolean; disabled: boolean; icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} className={`box-border min-h-[64px] min-w-0 rounded-md border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-[#02665e] bg-[#02665e]/[0.035]" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
      <span className="flex min-w-0 items-center gap-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md [&>svg]:h-4 [&>svg]:w-4 ${active ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-600"}`}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-2 text-sm font-semibold ${active ? "text-[#02665e]" : "text-slate-800"}`}>{label}{active && <CheckCircle2 className="h-4 w-4 shrink-0" />}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{hint}</span>
        </span>
      </span>
    </button>
  );
}

function ProviderPicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (provider: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = payoutProviders.find((provider) => provider.value === value);

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
    <div ref={rootRef} className="min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-3 text-left transition hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/10 disabled:cursor-not-allowed disabled:bg-slate-100"
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-7 w-20 shrink-0 items-center justify-start overflow-hidden"><ProviderLogo label={selected.label} logo={selected.logo} /></span>
            <span className="truncate text-sm font-medium text-slate-700">{selected.label}</span>
          </span>
        ) : (
          <span className="text-sm font-medium text-slate-500">Select provider</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div role="listbox" aria-label="Mobile money providers" className="mt-1 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {payoutProviders.map((provider) => {
            const isSelected = value === provider.value;
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
                className={`flex min-h-12 w-full min-w-0 items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 ${
                  unavailable
                    ? "cursor-not-allowed bg-slate-50 text-slate-400"
                    : isSelected
                      ? "bg-[#02665e]/[0.05] text-[#02665e]"
                      : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className={`flex h-7 w-20 shrink-0 items-center justify-start overflow-hidden ${unavailable ? "grayscale opacity-55" : ""}`}>
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

function ProviderLogo({ label, logo }: { label: string; logo: string | null }) {
  if (logo) {
    return <Image src={logo} alt="" width={104} height={34} unoptimized className="h-7 w-auto max-w-[92px] object-contain" />;
  }

  // The repository does not yet contain an approved AzamPesa artwork file.
  // This compact SVG wordmark avoids fetching a remote asset in a sensitive form.
  return (
    <svg viewBox="0 0 116 30" className="h-7 w-[104px]" role="img" aria-label={label}>
      <rect x="0.75" y="0.75" width="28.5" height="28.5" rx="5" fill="#02665e" />
      <path d="M8 21.5 14.7 8h2.8L24 21.5h-3.7l-1.2-2.8h-6.4l-1.2 2.8H8Zm6-5.8h3.9L16 11.2l-2 4.5Z" fill="white" />
      <text x="35" y="19.5" fill="#02665e" fontSize="14" fontWeight="700" fontFamily="Arial, sans-serif">AzamPesa</text>
    </svg>
  );
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

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0 bg-white/90 px-4 py-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</dt><dd className="m-0 mt-1 truncate text-sm font-semibold text-slate-800">{value || "Not provided"}</dd></div>;
}

function SecurityPoint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <span className="flex min-w-0 items-center gap-1.5"><span className="shrink-0 text-[#02665e] [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span><span>{text}</span></span>;
}
