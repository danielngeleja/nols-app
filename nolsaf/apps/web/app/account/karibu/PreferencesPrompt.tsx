"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, SlidersHorizontal, X } from "lucide-react";
import api from "@/lib/apiClient";

const DISMISS_KEY = "karibu.preferencesPrompt.dismissed";

/**
 * A quiet invitation on an upcoming paid stay: shown only while the guest has
 * saved no preferences and has not dismissed it. It never mentions a gift, so
 * nothing is promised (docs/KARIBU_BY_NOLSAF.md section 14).
 */
export default function PreferencesPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try { if (window.localStorage.getItem(DISMISS_KEY)) return; } catch {}
    let live = true;
    api.get<{ available: boolean; preferences: { updatedAt: string | null } }>("/api/customer/karibu/preferences")
      .then((r) => { if (live && r.data.available && !r.data.preferences.updatedAt) setShow(true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try { window.localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch {}
  };

  return (
    <section className="relative rounded-2xl border border-solid border-slate-200 bg-white px-5 py-4 shadow-sm">
      <button type="button" onClick={dismiss} aria-label="Not now" title="Not now" className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg border-0 bg-transparent text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
      <div className="flex items-start gap-3 pr-6">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><SlidersHorizontal className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-bold text-slate-900">How do you like to be welcomed?</p>
          <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">Drinks you enjoy and any dietary needs. Optional, and you choose whether the property sees them.</p>
          <Link href="/account/karibu#preferences" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 no-underline hover:underline">Add your preferences <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </div>
    </section>
  );
}
