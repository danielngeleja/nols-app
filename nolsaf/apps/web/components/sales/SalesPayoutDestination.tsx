"use client";

// Self-service payout destination for sales partners. It reuses the platform's
// secure payout flow (/api/account/payouts): an AzamPay Name Lookup shows the
// real account holder before anything is saved, and a short-lived challenge
// token is required to confirm. The API then sets the verified default payout
// account that disbursements pay into and syncs the sales withdrawal profile.
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Pencil, ShieldCheck, Smartphone } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Current = { name: string | null; method: string | null; accountMasked: string | null } | null | undefined;

type Preview = {
  challengeToken: string;
  expiresAt: string;
  destination: { provider: string; accountName: string; accountNumber: string };
};

/** AzamPay's disbursement rails. Sales payouts are paid to mobile money. */
const PROVIDERS = [
  { value: "vodacom", label: "M-Pesa" },
  { value: "yas", label: "Mixx by Yas" },
  { value: "airtel", label: "Airtel Money" },
  { value: "halotel", label: "HaloPesa" },
  { value: "azampesa", label: "AzamPesa" },
] as const;

const providerLabel = (value: string) => PROVIDERS.find((p) => p.value === value)?.label ?? value;

/** 0754 123 456, 754123456, +255 754 123 456 and 255754123456 all become 255754123456. */
function toWalletNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("255") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[67]\d{8}$/.test(local) ? `255${local}` : null;
}

function apiError(cause: any, fallback: string): string {
  const data = cause?.response?.data;
  if (data?.code === "PAYOUT_PROVIDER_NOT_CONFIGURED") return "Payout verification is not available yet. Your current destination is unchanged.";
  if (data?.code === "PAYOUT_CONTACT_COOLDOWN") {
    const until = data?.cooldownUntil ? new Date(data.cooldownUntil).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
    return `For your security, payout changes are paused after a phone or email change${until ? ` until ${until}` : ""}.`;
  }
  return String(data?.error || data?.message || fallback);
}

export default function SalesPayoutDestination({ current, loading, onSaved }: { current: Current; loading: boolean; onSaved: () => void }) {
  const ready = Boolean(current?.name && current?.method && current?.accountMasked);
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [provider, setProvider] = useState<string>("vodacom");
  const [number, setNumber] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  // The lookup confirmation expires server-side after a few minutes; show it.
  useEffect(() => {
    if (mode !== "confirm" || !preview) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(preview.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [mode, preview]);

  const wallet = toWalletNumber(number);

  const lookup = async () => {
    setError("");
    setSaved("");
    if (!wallet) {
      setError("Enter a Tanzanian mobile number, for example 0754 123 456.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiClient.post("/api/account/payouts/verify", {
        payoutPreferred: "MOBILE_MONEY",
        mobileMoneyProvider: provider,
        mobileMoneyNumber: wallet,
      });
      const data = response.data?.data;
      if (!data?.challengeToken || !data?.destination?.accountName) throw new Error("The account holder could not be confirmed.");
      setPreview(data);
      setMode("confirm");
    } catch (cause: any) {
      setError(apiError(cause, "We could not verify this number. Check the provider and number, then try again."));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setError("");
    setBusy(true);
    try {
      await apiClient.put("/api/account/payouts", { challengeToken: preview.challengeToken });
      setSaved(`Payouts will go to ${preview.destination.accountName}.`);
      setMode("view");
      setPreview(null);
      setNumber("");
      onSaved();
    } catch (cause: any) {
      if (cause?.response?.status === 410) {
        setMode("edit");
        setPreview(null);
        setError("The confirmation expired. Look the number up again.");
      } else {
        setError(apiError(cause, "Could not save this destination. Your current destination is unchanged."));
      }
    } finally {
      setBusy(false);
    }
  };

  const input = "block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Smartphone className="h-4 w-4 text-emerald-700" aria-hidden />
          Payout destination
        </p>
        {!loading && mode === "view" ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {ready ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
            {ready ? "Verified" : "Not set"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 space-y-2" aria-busy="true">
          <div className="h-5 w-44 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-4 w-64 max-w-full animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : mode === "view" ? (
        <>
          {ready ? (
            <div className="mt-4 flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm font-semibold text-slate-900">{current!.name}</p>
                <p className="m-0 mt-0.5 text-xs text-slate-500">{current!.method} · ending {String(current!.accountMasked).replace(/\*/g, "").slice(-4)}</p>
              </div>
              <button
                type="button"
                onClick={() => { setMode("edit"); setError(""); setSaved(""); }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:text-emerald-800"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Change
              </button>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-slate-400 shadow-sm">
                  <Smartphone className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-medium text-slate-800">No destination yet</p>
                  <p className="m-0 mt-0.5 text-xs text-slate-500">Add the M-Pesa, Mixx, Airtel, HaloPesa or AzamPesa number your earnings go to.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setMode("edit"); setError(""); }}
                className="inline-flex min-h-9 items-center rounded-lg bg-[#087f68] px-3.5 text-sm font-semibold text-white transition hover:bg-[#066b59]"
              >
                Add destination
              </button>
            </div>
          )}
          {saved ? <p className="m-0 mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{saved}</p> : null}
        </>
      ) : mode === "edit" ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => { event.preventDefault(); void lookup(); }}
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <label className="block text-xs font-medium text-slate-600">
              Mobile money
              <select value={provider} onChange={(event) => setProvider(event.target.value)} className={`${input} mt-1.5`}>
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Wallet number
              <input
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="0754 123 456"
                className={`${input} mt-1.5`}
              />
            </label>
          </div>
          <p className="m-0 text-xs text-slate-500">We look the number up with the provider and show you the registered name before anything is saved.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy || !number.trim()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#087f68] px-4 text-sm font-semibold text-white transition hover:bg-[#066b59] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy ? "Looking up" : "Look up name"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("view"); setError(""); }}
              className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : preview ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="m-0 text-xs font-medium text-emerald-800">Registered to</p>
          <p className="m-0 mt-0.5 text-lg font-bold tracking-tight text-slate-900">{preview.destination.accountName}</p>
          <p className="m-0 mt-0.5 text-sm text-slate-600">
            {providerLabel(preview.destination.provider)} · ending {String(preview.destination.accountNumber).replace(/\*/g, "").slice(-4)}
          </p>
          <p className="m-0 mt-3 text-xs text-slate-600">
            Is this you? Earnings are paid to this account from your next payout request.
            {secondsLeft > 0 ? <span className="text-slate-400"> Confirm within {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}.</span> : null}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || secondsLeft === 0}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#087f68] px-4 text-sm font-semibold text-white transition hover:bg-[#066b59] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              {busy ? "Saving" : "Yes, save this destination"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("edit"); setPreview(null); }}
              className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-white"
            >
              Not me, change it
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="m-0 mt-3 flex items-start gap-1.5 text-xs text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <p className="m-0 mt-3 text-xs text-slate-400">Each payout request keeps a copy of the destination it was made with.</p>
    </div>
  );
}
