"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, KeyRound, Loader2, ShieldCheck, UserCheck, Wallet, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SecurePayoutPreferenceCard from "@/components/SecurePayoutPreferenceCard";
import { formatEat, useNow } from "./shared";

/**
 * The owner's payout account, moved here from Profile so it sits with the
 * money. Same verification as before: the provider confirms the account holder
 * name (POST /api/account/payouts/verify), the owner confirms, and only then is
 * it saved (PUT /api/account/payouts). Bank payouts are shown as not available
 * because AzamPay bank rails are not enabled.
 */

type Verification = {
  challengeToken: string;
  expiresAt: string;
  destination: { type: "BANK" | "MOBILE_MONEY"; provider: string; accountName: string; accountNumber: string; currency: string };
  draft: Record<string, string>;
};

type PayoutAccountRow = {
  id: number;
  type: string;
  provider: string;
  accountNumber: string;
  accountName: string;
  isVerified: boolean;
  isActive: boolean;
  isDefault: boolean;
  verifiedAt: string | null;
  lastVerifiedAt?: string | null;
  destinationChangedAt: string | null;
  createdAt: string;
};

const PAYOUT_KEYS = ["payoutPreferred", "bankName", "bankAccountName", "bankAccountNumber", "bankBranch", "mobileMoneyProvider", "mobileMoneyNumber"] as const;

const PROVIDER_NAMES: Record<string, string> = {
  azampesa: "AzamPesa", airtel: "Airtel Money", tigo: "Mixx by Yas", yas: "Mixx by Yas",
  mpesa: "M-Pesa", vodacom: "M-Pesa", halopesa: "HaloPesa", halotel: "HaloPesa",
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function maskedWallet(value: string): string {
  const lastFour = value.replace(/\D/g, "").slice(-4);
  return lastFour ? `•••• ${lastFour}` : "Number unavailable";
}

export default function OwnerPayoutAccountManager() {
  const [saved, setSaved] = useState<Record<string, any>>({});
  const [form, setForm] = useState<Record<string, any>>({});
  const [accounts, setAccounts] = useState<PayoutAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<Verification | null>(null);
  const [securityWaitingHours, setSecurityWaitingHours] = useState(72);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const now = useNow();

  const load = useCallback(async () => {
    try {
      const [me, rows] = await Promise.all([
        apiClient.get("/api/account/me"),
        apiClient.get<{ accounts: PayoutAccountRow[]; securityWaitingHours?: number }>("/api/owner/payouts/accounts").catch(() => ({ data: { accounts: [] } })),
      ]);
      const user = (me as any)?.data?.data ?? (me as any)?.data ?? {};
      const payout = user?.payout && typeof user.payout === "object" ? user.payout : {};
      const values: Record<string, any> = {};
      for (const key of PAYOUT_KEYS) values[key] = clean(user[key] || payout[key]) || null;
      setSaved(values);
      setForm(values);
      setAccounts((rows as any)?.data?.accounts ?? []);
      const waitingHours = Number((rows as any)?.data?.securityWaitingHours);
      if (Number.isFinite(waitingHours) && waitingHours >= 24 && waitingHours <= 336) setSecurityWaitingHours(waitingHours);
    } catch {
      setError("Your payout account could not be loaded. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const preferred = clean(form.payoutPreferred).toUpperCase();
  const detailsOk =
    preferred === "MOBILE_MONEY" ? Boolean(clean(form.mobileMoneyProvider) && clean(form.mobileMoneyNumber)) : false;
  const changed = PAYOUT_KEYS.some((key) => clean(form[key]) !== clean(saved[key]));

  const active = useMemo(() => {
    const usable = accounts.filter((a) => a.isActive && a.isVerified && a.type === "MOBILE_MONEY");
    return usable.find((a) => a.isDefault) ?? usable[0];
  }, [accounts]);
  const history = useMemo(() => accounts
    .filter((account) => !account.isActive && account.isVerified)
    .sort((a, b) => new Date(b.destinationChangedAt ?? b.createdAt).getTime() - new Date(a.destinationChangedAt ?? a.createdAt).getTime()),
  [accounts]);
  const changedAt = active ? new Date(active.destinationChangedAt ?? active.createdAt) : null;
  const usableFrom = changedAt ? new Date(changedAt.getTime() + securityWaitingHours * 60 * 60 * 1000) : null;
  const inWaitingPeriod = Boolean(usableFrom && usableFrom.getTime() > now);
  const savedIsBank = clean(saved.payoutPreferred).toUpperCase() === "BANK";

  const verify = async () => {
    setError(null);
    setSuccess(null);
    setPreview(null);
    if (!detailsOk) {
      setError("Choose your mobile money provider and enter the wallet number.");
      return;
    }
    if (!changed) {
      setSuccess("This payout account is already saved.");
      return;
    }
    setBusy(true);
    try {
      const draft = {
        payoutPreferred: "MOBILE_MONEY",
        mobileMoneyProvider: clean(form.mobileMoneyProvider),
        mobileMoneyNumber: clean(form.mobileMoneyNumber),
      };
      const response = await apiClient.post("/api/account/payouts/verify", draft);
      const verification = (response as any)?.data?.data;
      if (!verification?.challengeToken || !verification?.destination?.accountName) {
        throw new Error("The provider did not confirm an account holder name.");
      }
      setPreview({ ...verification, draft });
    } catch (err: any) {
      const data = err?.response?.data;
      setError(
        data?.code === "PAYOUT_PROVIDER_NOT_CONFIGURED"
          ? "Payout verification is not available right now. Your current payout account is unchanged."
          : String(data?.error || data?.message || err?.message || "The account could not be verified. Your current payout account is unchanged.")
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.put("/api/account/payouts", { challengeToken: preview.challengeToken });
      setPreview(null);
      setSuccess("Payout account verified and saved. A security wait applies before it can be used for eligible payouts. Saving it did not approve or send a payout.");
      await load();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.code === "PAYOUT_VERIFICATION_EXPIRED") {
        setPreview(null);
        setError("This confirmation expired or was already used. Verify the account again.");
      } else {
        setError(String(data?.error || data?.message || "The account could not be saved. Your current payout account is unchanged."));
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[20vh] items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading your payout account...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        {savedIsBank && (
          <p className="m-0 flex items-start gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Your saved account is a bank account, which cannot receive payouts yet. Add a mobile money account so your payouts can be sent.
          </p>
        )}
        <SecurePayoutPreferenceCard
          value={form}
          bankPayoutsAvailable={false}
          securityWaitingHours={securityWaitingHours}
          disabled={busy}
          saving={busy}
          saveDisabled={!detailsOk || !changed}
          saveError={error}
          saveSuccess={success}
          onSave={verify}
          onChange={(patch) => {
            setError(null);
            setSuccess(null);
            setPreview(null);
            setForm((current) => ({ ...current, ...patch }));
          }}
        />
      </div>

      <aside className="space-y-4">
        <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-4">
            <h2 className="m-0 text-sm font-bold text-slate-900">Account status</h2>
            {active && (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${inWaitingPeriod ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                {inWaitingPeriod ? "Waiting" : "Ready"}
              </span>
            )}
          </div>
          {active ? (
            <div className="p-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f5f1] text-[#02665e]"><Wallet className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0">
                  <p className="m-0 break-words text-base font-bold text-slate-900">{PROVIDER_NAMES[active.provider.toLowerCase()] ?? active.provider}</p>
                  <p className="m-0 mt-0.5 text-xs font-medium text-slate-500">{maskedWallet(active.accountNumber)}</p>
                </div>
              </div>
              <dl className="m-0 mt-4 grid grid-cols-2 gap-3 border-0 border-t border-solid border-slate-100 pt-4">
                <div className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Account holder</dt>
                  <dd className="m-0 mt-1 break-words text-xs font-semibold text-slate-800">{active.accountName}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Last verified</dt>
                  <dd className="m-0 mt-1 text-xs font-semibold text-slate-800">{formatEat(active.lastVerifiedAt ?? active.verifiedAt ?? active.createdAt, false)}</dd>
                </div>
              </dl>
              {inWaitingPeriod && (
                <p className="m-0 mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden /> Available {formatEat(usableFrom)}
                </p>
              )}
            </div>
          ) : (
            <div className="p-5"><p className="m-0 text-sm font-semibold text-slate-800">No verified wallet</p><p className="m-0 mt-1 text-xs text-slate-500">Add one to receive payouts.</p></div>
          )}
          <Link href={active ? "/owner/payouts#withdraw" : "/owner/payouts"} className={`flex items-center justify-between gap-2 border-0 border-t border-solid px-5 py-3 text-xs font-semibold no-underline hover:no-underline ${active ? "border-[#02665e] bg-[#02665e] text-white hover:bg-[#014d47]" : "border-slate-100 bg-slate-50 text-[#02665e] hover:bg-slate-100"}`}>
            {active ? "Go to Withdraw" : "View payouts"} <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </Link>
        </section>

        <section className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
          <h2 className="m-0 text-sm font-bold text-slate-900">Previous payout accounts</h2>
          {history.length > 0 ? (
            <ul className="m-0 mt-3 list-none divide-y divide-slate-100 p-0">
              {history.slice(0, showAllHistory ? undefined : 3).map((account) => (
                <li key={account.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="m-0 break-words text-xs font-semibold text-slate-800">
                      {PROVIDER_NAMES[account.provider.toLowerCase()] ?? account.provider} {maskedWallet(account.accountNumber)}
                    </p>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Replaced</span>
                  </div>
                  <p className="m-0 mt-1 break-words text-[11px] text-slate-500">{account.accountName} · Saved {formatEat(account.destinationChangedAt ?? account.createdAt, false)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-2 text-xs leading-5 text-slate-500">When you replace this account, the previous destination will appear here with its number masked.</p>
          )}
          {history.length > 3 && (
            <button type="button" onClick={() => setShowAllHistory((current) => !current)} className="mt-3 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-[#02665e] hover:underline">
              {showAllHistory ? "Show fewer" : `Show all ${history.length} accounts`}
            </button>
          )}
        </section>

        <section className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
          <h2 className="m-0 text-sm font-bold text-slate-900">How your account is protected</h2>
          <ul className="m-0 mt-3 list-none space-y-3 p-0 text-[13px] leading-5 text-slate-600">
            <li className="flex gap-2.5"><UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />The provider confirms the account holder name before it is saved, and again before every payout.</li>
            <li className="flex gap-2.5"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />A new or changed account has a {securityWaitingHours}-hour security wait before eligible payouts.</li>
            <li className="flex gap-2.5"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />Every withdrawal is confirmed with a one-time code sent to you.</li>
            <li className="flex gap-2.5"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />Withdrawals pause for 72 hours after your phone or email changes.</li>
          </ul>
        </section>
      </aside>

      {preview &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payout-account-confirm-title"
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            onClick={(event) => {
              if (event.target === event.currentTarget && !busy) setPreview(null);
            }}
          >
            <div className="absolute inset-0 bg-slate-950/55" aria-hidden />
            <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-0 border-b border-solid border-slate-200 px-5 py-4">
                <div>
                  <h2 id="payout-account-confirm-title" className="m-0 text-base font-bold text-slate-900">Confirm account holder</h2>
                  <p className="m-0 mt-1 text-xs text-slate-500">The provider matched this account. Check it before saving.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  disabled={busy}
                  className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 p-5">
                <div className="rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3">
                  <p className="m-0 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> Verified account holder
                  </p>
                  <p className="m-0 mt-1.5 break-words text-lg font-bold text-slate-900">{preview.destination.accountName}</p>
                </div>
                <dl className="m-0 divide-y divide-slate-100 rounded-xl border border-solid border-slate-200 text-sm">
                  <div className="flex justify-between gap-3 px-4 py-2.5">
                    <dt className="text-slate-500">Provider</dt>
                    <dd className="m-0 font-medium text-slate-800">
                      {PROVIDER_NAMES[preview.destination.provider.toLowerCase()] ?? preview.destination.provider}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 px-4 py-2.5">
                    <dt className="text-slate-500">Wallet</dt>
                    <dd className="m-0 font-mono font-medium text-slate-800">{preview.destination.accountNumber}</dd>
                  </div>
                </dl>
                <p className="m-0 text-xs text-slate-500">
                  A {securityWaitingHours}-hour security wait applies after saving. Each payout still needs to qualify and be approved. This confirmation expires at {formatEat(preview.expiresAt)}.
                </p>
              </div>
              <div className="flex flex-col-reverse gap-2 border-0 border-t border-solid border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  disabled={busy}
                  className="h-10 rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                  Confirm and save
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
