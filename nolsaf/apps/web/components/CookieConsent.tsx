"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Cookie, SlidersHorizontal } from "lucide-react";

const STORAGE_KEY = "nolsaf_cookie_consent";

type ConsentState = "accepted" | "declined";
type OptionalCookiePreferences = {
  analytics: boolean;
  marketing: boolean;
};

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const save = (consent: ConsentState, preferences: OptionalCookiePreferences) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ consent, ...preferences, at: Date.now() })
      );
    } catch {
      // Storage can be blocked by the browser; still respect the choice for this view.
    }
    setVisible(false);
    setManaging(false);
  };

  const acceptAll = () => save("accepted", { analytics: true, marketing: true });
  const useEssentialOnly = () => save("declined", { analytics: false, marketing: false });
  const savePreferences = () =>
    save(analytics || marketing ? "accepted" : "declined", { analytics, marketing });

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[99999] grid place-items-center bg-[#002b27]/60 p-4 backdrop-blur-sm"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-consent-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-[380px] overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 shadow-[0_28px_80px_-20px_rgba(0,20,18,0.7)] ring-1 ring-black/10 backdrop-blur-xl"
      >
        {!managing ? (
          <div className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e1f4ef]/90 text-[#02665e]">
                <Cookie className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-[0.12em] text-[#02756b]">
                  NoLSAF privacy
                </p>
                <h2
                  id="cookie-consent-title"
                  className="mt-0.5 text-base font-bold tracking-tight text-slate-950"
                >
                  Your privacy, your choice
                </h2>
              </div>
            </div>

            <p className="mt-3 text-[13px] leading-5 text-slate-600">
              Essential cookies keep NoLSAF secure. Optional cookies help us improve your experience
              when you allow them.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] font-semibold">
              <Link
                href="/cookies-policy"
                className="text-[#02665e] underline decoration-[#9bd3ca] underline-offset-4 hover:text-[#014e47]"
              >
                Cookie Policy
              </Link>
              <span aria-hidden="true" className="text-slate-300">
                •
              </span>
              <Link
                href="/privacy"
                className="text-[#02665e] underline decoration-[#9bd3ca] underline-offset-4 hover:text-[#014e47]"
              >
                Privacy Policy
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={useEssentialOnly}
                className="min-h-10 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-800 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2"
              >
                Essential only
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="min-h-10 rounded-xl bg-[#02665e] px-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#014e47] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2"
              >
                Accept all
              </button>
            </div>

            <button
              type="button"
              onClick={() => setManaging(true)}
              className="mt-2 flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-transparent text-[11px] font-bold text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]"
            >
              <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
              Manage choices
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2.5 border-b border-slate-200 bg-slate-50/90 px-4 py-3.5">
              <button
                type="button"
                onClick={() => setManaging(false)}
                aria-label="Back to cookie notice"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <div>
                <p className="text-[9px] font-bold tracking-[0.11em] text-[#02756b]">
                  NoLSAF privacy
                </p>
                <h2 id="cookie-consent-title" className="text-sm font-bold text-slate-950">
                  Cookie preferences
                </h2>
              </div>
            </div>

            <div className="p-4">
              <p className="text-xs leading-5 text-slate-600">
                Essential cookies are always on. Choose the optional categories you allow.
              </p>

              <div className="mt-3 space-y-2">
                <ConsentRow
                  label="Essential"
                  description="Authentication, security, and core functions."
                  checked
                  disabled
                  onChange={() => {}}
                />
                <ConsentRow
                  label="Analytics"
                  description="Helps us understand usage and improve NoLSAF."
                  checked={analytics}
                  onChange={setAnalytics}
                />
                <ConsentRow
                  label="Marketing"
                  description="Measures campaigns and relevant promotions."
                  checked={marketing}
                  onChange={setMarketing}
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={useEssentialOnly}
                  className="min-h-10 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-800 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2"
                >
                  Essential only
                </button>
                <button
                  type="button"
                  onClick={savePreferences}
                  className="min-h-10 rounded-xl bg-[#02665e] px-2.5 text-xs font-bold text-white transition-colors hover:bg-[#014e47] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2"
                >
                  Save choices
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ConsentRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-900">{label}</span>
          {disabled && (
            <span className="rounded-full bg-[#e1f4ef] px-2 py-0.5 text-[10px] font-bold text-[#02665e]">
              Required
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={`${label} cookies`}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2 ${
          checked ? "bg-[#02665e]" : "bg-slate-300"
        } ${disabled ? "cursor-not-allowed opacity-65" : "cursor-pointer"}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
