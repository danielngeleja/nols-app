"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import SecurePayoutPreferenceCard, { type PayoutPreferenceValue } from "@/components/SecurePayoutPreferenceCard";
import s from "./event-workspace.module.css";

/** Reuses NoLSAF's verified, one-time-confirmation payout destination flow.
 * Saving a destination never approves a refund or initiates a transfer. */
export default function EventRefundAccount() {
  const [value, setValue] = useState<PayoutPreferenceValue>({}),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    challengeToken: string;
    expiresAt: string;
    destination: {
      accountName: string;
      accountNumber: string;
      provider: string;
    };
  } | null>(null);
  useEffect(() => {
    let active = true;
    void apiClient.get("/api/account/me").then(r => {
      const user = r.data?.data ?? r.data;
      if (active) setValue({
        ...user?.payout,
        ...Object.fromEntries(["payoutPreferred", "bankName", "bankAccountName", "bankAccountNumber", "bankBranch", "mobileMoneyProvider", "mobileMoneyNumber"].filter(k => user?.[k] != null).map(k => [k, user[k]]))
      });
    }).catch(() => {
      if (active) setError("Your refund destination could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);
  const verify = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setPreview(null);
    try {
      const body = value.payoutPreferred === "BANK" ? {
        payoutPreferred: "BANK",
        bankName: value.bankName,
        bankAccountName: value.bankAccountName,
        bankAccountNumber: value.bankAccountNumber,
        bankBranch: value.bankBranch || ""
      } : {
        payoutPreferred: "MOBILE_MONEY",
        mobileMoneyProvider: value.mobileMoneyProvider,
        mobileMoneyNumber: value.mobileMoneyNumber
      };
      const r = await apiClient.post("/api/account/payouts/verify", body),
        verification = r.data?.data;
      if (!verification?.challengeToken || !verification?.destination?.accountName) throw new Error("The provider did not verify the destination.");
      setPreview(verification);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Could not verify the refund destination.");
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.put("/api/account/payouts", {
        challengeToken: preview.challengeToken
      });
      setPreview(null);
      setSuccess("Destination verified and saved. No money was transferred; refund review and account security checks still apply.");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not save the verified destination. Verify it again if the confirmation expired.");
    } finally {
      setBusy(false);
    }
  };
  return <details className={s.claimForm}><summary>Your verified refund destination</summary><p className={s.help}>Security-deposit and approved cancellation refunds use your verified NoLSAF payout destination. Destination changes remain subject to the existing security waiting period and finance release checks.</p>{loading ? <p className={s.help}>Loading your account…</p> : <SecurePayoutPreferenceCard value={value} onChange={patch => {
      setValue(old => ({
        ...old,
        ...patch
      }));
      setPreview(null);
      setError(null);
      setSuccess(null);
    }} onSave={() => void verify()} disabled={busy} saving={busy} saveError={error} saveSuccess={success} />}{preview && <section className={s.panel}><h3>Confirm the provider-verified account</h3><p><strong>{preview.destination.accountName}</strong><br />{preview.destination.provider} · ending {preview.destination.accountNumber.slice(-4)}</p><p className={s.help}>Check that this account belongs to you before saving.</p><div className={s.bookingActions}><button className={s.primary} disabled={busy} onClick={() => void confirm()}>Confirm and save destination</button><button className={s.secondary} disabled={busy} onClick={() => setPreview(null)}>Cancel</button></div></section>}</details>;
}
