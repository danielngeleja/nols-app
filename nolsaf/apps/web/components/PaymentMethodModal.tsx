"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ArrowLeft, X, Smartphone, Building2, CreditCard, ShieldCheck, Info } from "lucide-react";
import apiClient from "@/lib/apiClient";

const api = apiClient;

// ── Shared types ────────────────────────────────────────────────────────────────

export type SelectedPaymentMethod =
  | { method: "MNO";  provider: "Airtel" | "Mixx" | "M-Pesa" | "HaloPesa"; phoneNumber: string; providerName: string; }
  | { method: "BANK"; bankCode: string; bankName: string; accountNumber: string; merchantMobileNumber: string; otp: string; }
  | { method: "CARD"; };

interface PaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (method: SelectedPaymentMethod) => void;
  invoiceId?: number;
  amount: number;
  currency?: string;
  defaultPhone?: string;
  initialMethod?: "MNO" | "BANK" | "CARD";
}

// ── Providers ───────────────────────────────────────────────────────────────────

type MnoProvider = {
  id: "Airtel" | "Mixx" | "M-Pesa" | "HaloPesa";
  name: string;
  logo?: string;
  mark?: string;
};

const MNO_PROVIDERS: MnoProvider[] = [
  { id: "Airtel",   name: "Airtel Money", logo: "/assets/airtel_money.png" },
  { id: "M-Pesa",   name: "M-Pesa", logo: "/assets/M-pesa.png" },
  { id: "Mixx",     name: "Mixx by Yas", mark: "mixx" },
  { id: "HaloPesa", name: "HaloPesa", logo: "/assets/halopesa.png" },
];

type BankProvider = { code: string; name: string; logo: string; };

const BANK_PROVIDERS: BankProvider[] = [
  { code: "CRDB", name: "CRDB Bank", logo: "/assets/NoLSAF_CRDB.png" },
  { code: "NMB", name: "NMB Bank", logo: "/assets/NoLSAF_NMB.png" },
];

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

// ── Phone helpers ───────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+")) {
    if (cleaned.startsWith("255"))    cleaned = "+" + cleaned;
    else if (cleaned.startsWith("0")) cleaned = "+255" + cleaned.substring(1);
    else                              cleaned = "+255" + cleaned;
  }
  return cleaned;
}

function validatePhone(phone: string): boolean {
  return /^\+255\d{9}$/.test(normalizePhone(phone));
}

// ── Selection indicator ─────────────────────────────────────────────────────────

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      className={`
        flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200
        ${selected ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-white"}
      `}
    >
      {selected && <span className="w-2 h-2 rounded-full bg-white" />}
    </span>
  );
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function PaymentMethodModal({
  isOpen,
  onClose,
  onSelect,
  invoiceId: _invoiceId,
  amount,
  currency = "TZS",
  defaultPhone,
  initialMethod,
}: PaymentMethodModalProps) {
  const [activeSection, setActiveSection]         = useState<"MNO" | "BANK" | "CARD" | null>(initialMethod ?? null);
  const [selectedMnoProvider, setSelectedMnoProvider] = useState<string>("");
  const [phoneNumber, setPhoneNumber]             = useState<string>(defaultPhone || "");
  const [savedPhones, setSavedPhones]             = useState<string[]>([]);
  const [selectedBankCode, setSelectedBankCode]   = useState<string>("");
  const [bankAccountNumber, setBankAccountNumber] = useState<string>("");
  const [bankMobileNumber, setBankMobileNumber]   = useState<string>(defaultPhone || "");
  const [bankOtp, setBankOtp]                     = useState<string>("");
  const [error, setError]                         = useState<string | null>(null);
  const [mounted, setMounted]                     = useState(false);

  async function loadSavedPhones() {
    try {
      const response = await api.get("/api/account/payment-methods");
      const phones = new Set<string>();
      if (response.data?.methods) {
        response.data.methods.forEach((m: any) => {
          if (m.ref && /^\+?255\d{9}$/.test(m.ref.replace(/\D/g, ""))) phones.add(m.ref);
        });
      }
      if (response.data?.payout?.mobileMoneyNumber) phones.add(response.data.payout.mobileMoneyNumber);
      setSavedPhones(Array.from(phones));
    } catch { /* saved phones are optional */ }
  }

  useEffect(() => {
    if (isOpen && defaultPhone) {
      setPhoneNumber(defaultPhone);
      setBankMobileNumber(defaultPhone);
    }
    if (isOpen && initialMethod) setActiveSection(initialMethod);
  }, [isOpen, defaultPhone, initialMethod]);

  useEffect(() => {
    if (isOpen) loadSavedPhones();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setActiveSection(null);
      setError(null);
      setSelectedMnoProvider("");
      setSelectedBankCode("");
      setBankAccountNumber("");
      setBankMobileNumber(defaultPhone || "");
      setBankOtp("");
    }
  }, [isOpen, defaultPhone]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || !mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen, mounted]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!activeSection) { setError("Please select a payment method"); return; }

    if (activeSection === "MNO") {
      if (!selectedMnoProvider) { setError("Please select a mobile money provider"); return; }
      if (!phoneNumber.trim())   { setError("Please enter your phone number"); return; }
      const normalized = normalizePhone(phoneNumber.trim());
      if (!validatePhone(normalized)) {
        setError("Please enter a valid Tanzania phone number (e.g. +255712345678 or 0712345678)");
        return;
      }
      const prov = MNO_PROVIDERS.find((p) => p.id === selectedMnoProvider);
      onSelect({ method: "MNO", provider: selectedMnoProvider as any, phoneNumber: normalized, providerName: prov?.name ?? selectedMnoProvider });
    } else if (activeSection === "BANK") {
      if (!selectedBankCode) { setError("Please select a bank"); return; }
      if (!bankAccountNumber.trim()) { setError("Please enter your bank account number"); return; }
      if (!bankMobileNumber.trim() || !validatePhone(bankMobileNumber)) { setError("Please enter a valid Tanzania mobile number for the bank account"); return; }
      if (!bankOtp.trim()) { setError("Please enter the bank OTP"); return; }
      const bank = BANK_PROVIDERS.find((b) => b.code === selectedBankCode);
      onSelect({ method: "BANK", bankCode: selectedBankCode, bankName: bank?.name ?? selectedBankCode, accountNumber: bankAccountNumber.trim(), merchantMobileNumber: normalizePhone(bankMobileNumber.trim()), otp: bankOtp.trim() });
    } else if (activeSection === "CARD") {
      onSelect({ method: "CARD" });
    }
  };

  const submitLabel = () => {
    if (activeSection === "MNO")  return "Send payment prompt";
    if (activeSection === "BANK") return "Continue to bank";
    if (activeSection === "CARD") return "Open secure checkout";
    return "Continue";
  };

  const isSubmitDisabled =
    !activeSection ||
    (activeSection === "MNO"  && (!selectedMnoProvider || !phoneNumber.trim())) ||
    (activeSection === "BANK" && (!selectedBankCode || !bankAccountNumber.trim() || !bankMobileNumber.trim() || !bankOtp.trim()));

  const bankOtpInstruction = selectedBankCode ? BANK_OTP_INSTRUCTIONS[selectedBankCode] : null;

  if (!isOpen || !mounted) return null;

  return createPortal((
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/80 bg-white shadow-[0_28px_90px_-30px_rgba(15,23,42,0.8)]">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="z-10 flex shrink-0 items-start justify-between border-b border-slate-100 bg-white px-5 pb-3.5 pt-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS billing</p>
            <h2 className="mt-1 text-base font-bold tracking-tight text-slate-900">Complete payment</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{currency} {amount.toLocaleString("en-US")}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="border-0 bg-transparent p-1.5 text-slate-400 shadow-none outline-none transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-5 py-4">

          {activeSection && (
            <button
              type="button"
              onClick={() => { setActiveSection(null); setError(null); }}
              className="mb-1 inline-flex items-center gap-2 border-0 bg-transparent px-1 py-1.5 text-xs font-semibold text-slate-500 shadow-none outline-none transition hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Choose another payment method
            </button>
          )}

          {/* ── Card: Mobile Money ────────────────────────────────────────────── */}
          {(!activeSection || activeSection === "MNO") && (
          <MethodCard
            id="MNO"
            active={activeSection === "MNO"}
            icon={<Smartphone className="w-5 h-5" />}
            iconColor={activeSection === "MNO" ? "text-emerald-700" : "text-emerald-600"}
            iconBg={activeSection === "MNO" ? "bg-emerald-100" : "bg-emerald-50"}
            label="Mobile Money"
            description="Airtel · M-Pesa · Mixx · HaloPesa"
            onClick={() => { setActiveSection("MNO"); setError(null); }}
          >
            {/* Provider chips */}
            <div className="mb-4 grid min-w-0 grid-cols-2 gap-2">
              {MNO_PROVIDERS.map((prov) => {
                const sel = selectedMnoProvider === prov.id;
                return (
                  <button
                    key={prov.id}
                    type="button"
                    onClick={() => setSelectedMnoProvider(prov.id)}
                    className={`
                      flex min-h-11 min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-all duration-150
                      ${sel
                        ? "border-emerald-400 bg-emerald-50 text-emerald-800 shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}
                    `}
                  >
                    <span className="flex h-7 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
                      {prov.logo ? (
                        <Image src={prov.logo} alt="" width={40} height={28} className="h-6 w-9 object-contain" />
                      ) : (
                        <span className="text-[11px] font-black lowercase tracking-tight text-violet-700">{prov.mark}</span>
                      )}
                    </span>
                    <span className="min-w-0 truncate">{prov.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Phone input */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                Phone Number
              </label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="0712 345 678"
                className="box-border block w-full min-w-0 max-w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:bg-white focus:ring-2 focus:ring-emerald-400"
              />
              <p className="text-xs text-slate-400 mt-1.5">
                {selectedMnoProvider
                  ? `Number linked to your ${MNO_PROVIDERS.find(p => p.id === selectedMnoProvider)?.name} account`
                  : "Tanzania number (+255 or 07xx)"}
              </p>
              {savedPhones.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {savedPhones.slice(0, 3).map((ph, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPhoneNumber(ph)}
                      className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"
                    >
                      {ph}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </MethodCard>
          )}

          {/* ── Card: Bank Transfer ───────────────────────────────────────────── */}
          {(!activeSection || activeSection === "BANK") && (
          <MethodCard
            id="BANK"
            active={activeSection === "BANK"}
            icon={<Building2 className="w-5 h-5" />}
            iconColor={activeSection === "BANK" ? "text-amber-700" : "text-amber-600"}
            iconBg={activeSection === "BANK" ? "bg-amber-100" : "bg-amber-50"}
            label="Bank Transfer"
            description="CRDB · NMB"
            onClick={() => { setActiveSection("BANK"); setError(null); }}
          >
            <fieldset className="m-0 mb-4 min-w-0 border-0 p-0">
              <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Select bank
              </legend>
              <div className="grid min-w-0 grid-cols-2 gap-2 py-1">
                {BANK_PROVIDERS.map((bank) => {
                  const selected = selectedBankCode === bank.code;
                  return (
                    <label
                      key={bank.code}
                      className={`inline-flex min-h-10 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                        selected ? "bg-slate-50" : "hover:bg-slate-50/70"
                      }`}
                    >
                      <input
                        type="radio"
                        name="bankCode"
                        value={bank.code}
                        checked={selected}
                        onChange={() => setSelectedBankCode(bank.code)}
                        className="h-4 w-4 shrink-0 accent-emerald-600"
                      />
                      <span className="flex h-7 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white px-1">
                        <Image
                          src={bank.logo}
                          alt={`${bank.name} logo`}
                          width={48}
                          height={28}
                          className="h-6 w-11 object-contain"
                        />
                      </span>
                      <span className={`min-w-0 truncate ${selected ? "font-bold text-emerald-800" : "font-semibold text-slate-700"}`}>
                        {bank.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {bankOtpInstruction && (
              <div className="mb-4 min-w-0 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Info className="h-4 w-4 shrink-0 text-emerald-700" />
                  <p className="min-w-0 text-xs font-bold text-emerald-900">{bankOtpInstruction.title}</p>
                </div>
                <ol className="mt-2 space-y-1.5">
                  {bankOtpInstruction.steps.map((step, index) => (
                    <li key={step} className="flex min-w-0 items-start gap-2 text-xs leading-5 text-slate-600">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                        {index + 1}
                      </span>
                      <span className="min-w-0 break-words">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                Account Number <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                type="text"
                required
                aria-required="true"
                value={bankAccountNumber}
                onChange={(e) => setBankAccountNumber(e.target.value)}
                placeholder="Account selected when generating OTP"
                maxLength={25}
                className="block box-border w-full min-w-0 max-w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm tracking-wide outline-none transition-all focus:border-transparent focus:bg-white focus:ring-2 focus:ring-emerald-400"
              />
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Bank registered mobile <span className="text-red-500" aria-hidden="true">*</span>
                </span>
                <input
                  type="tel"
                  required
                  aria-required="true"
                  value={bankMobileNumber}
                  onChange={(e) => setBankMobileNumber(e.target.value)}
                  placeholder="+255 700 000 000"
                  className="block box-border w-full min-w-0 max-w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition-all focus:border-transparent focus:bg-white focus:ring-2 focus:ring-emerald-400"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Bank OTP <span className="text-red-500" aria-hidden="true">*</span>
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  aria-required="true"
                  value={bankOtp}
                  onChange={(e) => setBankOtp(e.target.value)}
                  placeholder="OTP from bank menu"
                  maxLength={50}
                  className="block box-border w-full min-w-0 max-w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition-all focus:border-transparent focus:bg-white focus:ring-2 focus:ring-emerald-400"
                />
              </label>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <p className="text-xs leading-relaxed text-slate-600">
                Use the same account and registered mobile number selected in the bank menu. The OTP comes from your bank, not from NoLSAF.
              </p>
            </div>
          </MethodCard>
          )}

          {/* ── Card: Debit / Credit Card ─────────────────────────────────────── */}
          {(!activeSection || activeSection === "CARD") && (
          <MethodCard
            id="CARD"
            active={activeSection === "CARD"}
            icon={<CreditCard className="w-5 h-5" />}
            iconColor={activeSection === "CARD" ? "text-blue-700" : "text-blue-500"}
            iconBg={activeSection === "CARD" ? "bg-blue-100" : "bg-blue-50"}
            label="Debit / Credit Card"
            description="Visa · Mastercard · Secure checkout"
            onClick={() => { setActiveSection("CARD"); setError(null); }}
          >
            <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
              <ShieldCheck className="w-9 h-9 text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-800">Secure hosted checkout</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  You&apos;ll be redirected to a secure hosted checkout page. We never see your card details.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Image src="/assets/visa_card.png" alt="Visa" width={44} height={24} className="h-5 w-11 object-contain" />
                  <Image src="/assets/Mastercard_Logo.png" alt="Mastercard" width={36} height={24} className="h-5 w-9 object-contain" />
                </div>
              </div>
            </div>
          </MethodCard>
          )}

          {/* ── Error ────────────────────────────────────────────────────────── */}
          {error && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* ── Actions ──────────────────────────────────────────────────────── */}
          {activeSection ? (
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600 shadow-none transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="inline-flex h-10 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg border-0 bg-emerald-600 px-4 text-xs font-bold text-white shadow-sm shadow-emerald-200 transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitLabel()}
            </button>
          </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  ), document.body);
}

// ── MethodCard sub-component ────────────────────────────────────────────────────

interface MethodCardProps {
  id: string;
  active: boolean;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  label: string;
  description: string;
  onClick: () => void;
  children?: React.ReactNode;
}

function MethodCard({ active, icon, iconColor, iconBg, label, description, onClick, children }: MethodCardProps) {
  if (active) {
    return <div className="min-w-0">{children}</div>;
  }

  return (
    <div
      className={`
        min-w-0 overflow-hidden rounded-lg border bg-white transition-all duration-200
        ${active
          ? "border-emerald-100 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"}
      `}
    >
      {/* Row */}
      <button
        type="button"
        onClick={onClick}
        className="flex w-full min-w-0 items-center gap-3 border-0 bg-white px-4 py-3 text-left shadow-none outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-200"
      >
        <span className={`shrink-0 rounded-lg p-2 transition-colors ${iconBg}`}>
          <span className={iconColor}>{icon}</span>
        </span>

        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold leading-tight text-slate-900">{label}</span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-400">{description}</span>
        </span>

        <RadioDot selected={false} />
      </button>
    </div>
  );
}
