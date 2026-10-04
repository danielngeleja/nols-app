"use client";

import { useState } from "react";
import { AlertTriangle, KeyRound, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import BackupCodesPanel from "@/components/security/BackupCodesPanel";

/*
 * "Generate new backup codes" for someone whose authenticator is already on.
 *
 * The server replaces every old code and requires a current authenticator
 * code first, so a signed-in session on its own cannot mint a way back in.
 * The new codes are shown once in BackupCodesPanel.
 *
 * Preflight is disabled: every button declares border-0 or border-solid and
 * its own background.
 */
export default function RegenerateBackupCodes({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);

  const close = () => {
    setOpen(false);
    setCode("");
    setError(null);
  };

  const generate = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => null);
      const data = body?.data ?? body;
      if (!res.ok || !Array.isArray(data?.backupCodes)) {
        setError(body?.error || body?.message || "That code did not work. Try the next one from your app.");
        setCode("");
        return;
      }
      setCodes(data.backupCodes);
      close();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (codes.length) {
    return <BackupCodesPanel codes={codes} onDone={() => setCodes([])} />;
  }

  return (
    <div
      className="relative box-border w-full overflow-hidden rounded-2xl border border-solid border-[#02665e]/15 bg-white"
      style={{
        background:
          "radial-gradient(120% 140% at 0% 0%, rgba(2,102,94,0.08) 0%, rgba(2,102,94,0) 45%), linear-gradient(90deg, #f4faf9 0%, #ffffff 55%)",
      }}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
        {/* Identity */}
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <span className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#037a70] to-[#014d47] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_18px_-10px_rgba(2,102,94,0.9)]">
            <KeyRound className="h-5 w-5" />
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-2 ring-white">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            </span>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14.5px] font-bold leading-tight text-slate-900">Backup codes</p>
              <span className="rounded-full bg-[#02665e]/10 px-2 py-0.5 text-[10.5px] font-semibold leading-none text-[#02665e]">
                One-time use
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-snug text-slate-500">Your way back in if you lose your phone.</p>
          </div>
        </div>

        {/* A glimpse of what a code set looks like, so the row explains itself */}
        {!open && (
          <div className="hidden items-center gap-1.5 lg:flex" aria-hidden>
            {["••••-••••", "••••-••••", "••••-••••"].map((mask, i) => (
              <span
                key={i}
                className="rounded-md border border-solid border-slate-200 bg-white px-2 py-1 font-mono text-[11px] tracking-wider text-slate-400"
                style={{ opacity: 1 - i * 0.25 }}
              >
                {mask}
              </span>
            ))}
            <span className="pl-1 text-[11px] font-semibold text-slate-400">+7</span>
          </div>
        )}

        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-4 text-[13px] font-semibold text-white shadow-[0_8px_18px_-10px_rgba(2,102,94,0.9)] transition hover:bg-[#014d47]"
          >
            <RefreshCw className="h-4 w-4" />
            Generate new codes
          </button>
        )}
      </div>

      {/* Confirm step: inline, attached to the card rather than a second box */}
      {open && (
        <form
          className="border-0 border-t border-solid border-[#02665e]/10 bg-white/70 px-4 py-4 sm:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-800">Confirm with your authenticator app</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                Your current codes stop working as soon as new ones are made.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setError(null);
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                placeholder="000000"
                aria-label="Current 6-digit authenticator code"
                className={`box-border h-10 w-[128px] rounded-xl border-2 border-solid bg-white px-3 text-center font-mono text-[16px] font-bold tracking-[0.32em] text-slate-900 outline-none transition placeholder:text-slate-300 ${
                  error ? "border-rose-300" : "border-slate-200 focus:border-[#02665e] focus:shadow-[0_0_0_4px_rgba(2,102,94,0.12)]"
                }`}
              />
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-4 text-[13px] font-semibold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {busy ? "Generating" : "Generate"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={close}
                aria-label="Cancel"
                title="Cancel"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-solid border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-[12px] font-medium text-rose-700">{error}</p>}
        </form>
      )}
    </div>
  );
}
