"use client";

import { useState } from "react";
import { Check, Copy, Download, KeyRound, ShieldAlert } from "lucide-react";

/*
 * Shows backup codes the one time the server returns them.
 *
 * The API only ever sends plain codes at the moment 2FA is turned on or the
 * codes are regenerated; it stores hashes. Before this panel existed every
 * setup screen wrote them to the browser console, so nobody had a way back in
 * after losing their phone.
 *
 * The panel stays until the person confirms they saved the codes.
 */
export default function BackupCodesPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!codes.length) return null;

  const text = [
    "NoLSAF backup codes",
    `Created ${new Date().toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} (EAT)`,
    "Each code works once. Keep them somewhere safe and private.",
    "",
    ...codes,
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setSaved(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the download still works.
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "nolsaf-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <div className="box-border w-full overflow-hidden rounded-2xl border border-solid border-amber-200 bg-amber-50/60">
      <div className="flex items-start gap-3 border-0 border-b border-solid border-amber-200/70 px-4 py-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-400 text-amber-950">
          <ShieldAlert className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-amber-950">Save your backup codes now</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-amber-900/80">
            If you lose your phone, each code signs you in once. You will not see these codes again.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 bg-white p-3 sm:gap-2 sm:p-4">
        {codes.map((code, i) => (
          <div
            key={code}
            className="flex items-center gap-2 rounded-lg border border-solid border-slate-200 bg-slate-50 px-2.5 py-2"
          >
            <span className="w-4 text-right text-[10.5px] font-semibold tabular-nums text-slate-400">{i + 1}</span>
            <span className="select-all font-mono text-[13.5px] font-semibold tracking-wider text-slate-900">{code}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-amber-200/70 px-4 py-3">
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 transition hover:border-slate-300"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={download}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 transition hover:border-slate-300"
        >
          <Download className="h-4 w-4" />
          Download
        </button>
        {/* A real switch rather than the browser checkbox, which barely shows
            on the amber footer. Copy and Download flip it on by themselves. */}
        <button
          type="button"
          role="switch"
          aria-checked={saved}
          onClick={() => setSaved((s) => !s)}
          className={`ml-auto inline-flex h-9 items-center gap-2.5 rounded-full border border-solid py-1 pl-1 pr-3.5 text-[12.5px] font-semibold transition ${
            saved
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-white text-slate-600 hover:border-amber-300"
          }`}
        >
          <span
            className={`relative flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-200 ${
              saved ? "bg-emerald-500" : "bg-slate-200"
            }`}
          >
            <span
              className={`absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-[0_2px_6px_rgba(15,23,42,0.25)] transition-transform duration-200 ${
                saved ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            >
              {saved && <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={3} />}
            </span>
          </span>
          {saved ? "Saved" : "I saved them"}
        </button>
        <button
          type="button"
          disabled={!saved}
          onClick={onDone}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3.5 text-[12.5px] font-semibold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          <KeyRound className="h-4 w-4" />
          Done
        </button>
      </div>
    </div>
  );
}
