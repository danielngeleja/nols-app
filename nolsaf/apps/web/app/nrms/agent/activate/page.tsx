"use client";
// Public landing for the one-time agent invite link (/nrms/agent/activate?t=...).
// The invited agent sets their own password and is signed straight into the portal.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { CheckCircle2, Handshake, Loader2, Lock } from "lucide-react";

function ActivateInner() {
  const router = useRouter();
  const token = useSearchParams().get("t") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = token.length > 10 && password.length >= 15 && password.length <= 200 && password === confirm;

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      await apiClient.post("/api/public/nrms/agent/activate", { token, password });
      setDone(true);
      setTimeout(() => router.replace("/agent-portal"), 1200);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Your account could not be activated");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-solid border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm"><Handshake className="h-5 w-5" /></span>
          <div>
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">NoLSAF Travel Agent</p>
            <h1 className="m-0 text-[18px] font-extrabold text-neutral-900">Activate your account</h1>
          </div>
        </div>

        {done ? (
          <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50 p-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <p className="m-0 text-[14px] font-bold text-emerald-800">Account activated</p>
            <p className="m-0 text-[12px] text-emerald-700">Taking you to your portal…</p>
          </div>
        ) : !token ? (
          <p className="mt-6 rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-3 text-[13px] text-red-700">This invite link is missing its token. Please open the link from your invitation email.</p>
        ) : (
          <>
            <p className="m-0 mt-4 text-[13px] text-neutral-500">Set a password to activate your travel-agent account. You will use it to sign in from now on.</p>
            {error && <div className="mt-3 rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-neutral-700">Password
                <input type="password" autoComplete="new-password" minLength={15} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 15 characters" className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-neutral-700">Confirm password
                <input type="password" autoComplete="new-password" minLength={15} maxLength={200} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
              {confirm && password !== confirm && <p className="m-0 text-[11px] text-red-600">Passwords do not match.</p>}
              <button type="button" onClick={() => void submit()} disabled={!valid || saving} className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-3.5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Activate and sign in
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AgentActivatePage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-neutral-100"><Loader2 className="h-5 w-5 animate-spin text-neutral-400" /></div>}>
      <ActivateInner />
    </Suspense>
  );
}
