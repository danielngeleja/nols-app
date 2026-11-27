"use client";

/**
 * A consent tick that is always visible. The plain browser checkbox can be
 * hidden by the app's global styles, so this draws its own box.
 */
import { Check } from "lucide-react";

export default function ConsentCheck({ checked, onChange, children }: { checked: boolean; onChange: (next: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-lg border border-solid p-3 text-left transition ${checked ? "border-[#02665e] bg-[#02665e]/[0.05]" : "border-slate-300 bg-white hover:border-[#02665e]/50"}`}
    >
      <span
        aria-hidden
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[5px] border-2 border-solid transition ${checked ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-400 bg-white"}`}
      >
        {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
      </span>
      <span className="text-[13px] leading-5 text-slate-700">{children}</span>
    </button>
  );
}
