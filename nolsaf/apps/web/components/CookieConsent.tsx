"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Check, Cookie, LockKeyhole, Megaphone, SlidersHorizontal, type LucideIcon } from "lucide-react";

const STORAGE_KEY = "nolsaf_cookie_consent";

type ConsentState = "accepted" | "declined";
type OptionalCookiePreferences = {
  analytics: boolean;
  marketing: boolean;
};

// Preflight is off in this app: borders need border-solid, buttons need an explicit background.
const outlineButton =
  "min-h-10 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2";
const primaryButton =
  "min-h-10 cursor-pointer rounded-md border-0 bg-[#02665e] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#014e47] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  // Move focus into the dialog so keyboard and screen reader users land on the choice.
  useEffect(() => {
    if (visible) dialogRef.current?.focus();
  }, [visible, managing]);

  const save = (consent: ConsentState, preferences: OptionalCookiePreferences) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ consent, ...preferences, at: Date.now() })
      );
    } catch {
      // Storage can be blocked by the browser; still respect the choice for this view.
    }
    // Lets the source tracker save or drop the visit's source at once.
    try { window.dispatchEvent(new CustomEvent("nolsaf-consent-changed")); } catch { /* old browsers */ }
    setVisible(false);
    setManaging(false);
  };

  const acceptAll = () => save("accepted", { analytics: true, marketing: true });
  const useEssentialOnly = () => save("declined", { analytics: false, marketing: false });
  const savePreferences = () =>
    save(analytics || marketing ? "accepted" : "declined", { analytics, marketing });

  if (!visible) return null;

  const allowedCount = Number(analytics) + Number(marketing);

  return (
    <div
      className="fixed inset-0 z-[99999] grid place-items-center bg-[#002b27]/60 p-4 backdrop-blur-sm"
      style={{ boxSizing: "border-box" }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-consent-title"
        aria-describedby="cookie-consent-body"
        className="max-h-[calc(100vh-2rem)] w-full max-w-[380px] overflow-y-auto rounded-lg border border-solid border-slate-200 bg-white/95 shadow-[0_28px_80px_-20px_rgba(0,20,18,0.7)] outline-none ring-1 ring-black/5 backdrop-blur-xl [&_*]:box-border"
      >
        {!managing ? (
          <div>
            <div className="p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e] text-white">
                  <Cookie className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-[11px] font-semibold text-[#02756b]">
                    NoLSAF privacy
                  </p>
                  <h2
                    id="cookie-consent-title"
                    className="m-0 mt-0.5 text-[17px] font-semibold tracking-tight text-slate-950"
                  >
                    Your privacy, your choice
                  </h2>
                </div>
              </div>

              <p id="cookie-consent-body" className="m-0 mt-3.5 text-[13px] leading-5 text-slate-600">
                Essential cookies keep NoLSAF secure. Optional cookies help us improve your experience
                when you allow them.
              </p>

              {/* What is in play, at a glance: one always on, two that wait for a yes. */}
              <ul className="m-0 mt-3.5 grid list-none grid-cols-3 gap-1.5 p-0">
                {[
                  { label: "Essential", state: "Always on", Icon: LockKeyhole, on: true },
                  { label: "Analytics", state: "Your call", Icon: BarChart3, on: false },
                  { label: "Marketing", state: "Your call", Icon: Megaphone, on: false },
                ].map(({ label, state, Icon, on }) => (
                  <li
                    key={label}
                    className={`rounded-md border border-solid px-2 py-2 ${on ? "border-[#02665e]/20 bg-[#e1f4ef]/70" : "border-slate-200 bg-slate-50"}`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${on ? "text-[#02665e]" : "text-slate-400"}`} aria-hidden="true" />
                    <p className="m-0 mt-1 text-[12px] font-semibold text-slate-900">{label}</p>
                    <p className={`m-0 text-[11px] ${on ? "text-[#02665e]" : "text-slate-500"}`}>{state}</p>
                  </li>
                ))}
              </ul>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={useEssentialOnly} className={outlineButton}>
                  Essential only
                </button>
                <button type="button" onClick={acceptAll} className={primaryButton}>
                  Accept all
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/80 px-5 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[12px] font-medium">
                <Link
                  href="/cookies-policy"
                  className="text-slate-600 no-underline hover:text-[#02665e] hover:underline"
                >
                  Cookie Policy
                </Link>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <Link
                  href="/privacy"
                  className="text-slate-600 no-underline hover:text-[#02665e] hover:underline"
                >
                  Privacy Policy
                </Link>
              </div>
              <button
                type="button"
                onClick={() => setManaging(true)}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold text-[#02665e] transition-colors hover:bg-[#e1f4ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Manage choices
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2.5 border-0 border-b border-solid border-slate-200 bg-slate-50/90 px-4 py-3">
              <button
                type="button"
                onClick={() => setManaging(false)}
                aria-label="Back to cookie notice"
                className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[11px] font-semibold text-[#02756b]">
                  NoLSAF privacy
                </p>
                <h2 id="cookie-consent-title" className="m-0 text-[15px] font-semibold text-slate-950">
                  Cookie preferences
                </h2>
              </div>
              <span className="shrink-0 rounded-md bg-white px-2 py-1 text-[11px] font-semibold tabular-nums text-slate-600 ring-1 ring-slate-200">
                {allowedCount} of 2 allowed
              </span>
            </div>

            <div className="p-4">
              <p id="cookie-consent-body" className="m-0 text-[12.5px] leading-5 text-slate-600">
                Essential cookies are always on. Choose the optional categories you allow.
              </p>

              <div className="mt-3 space-y-2">
                <ConsentRow
                  label="Essential"
                  description="Authentication, security, and core functions."
                  Icon={LockKeyhole}
                  checked
                  disabled
                  onChange={() => {}}
                />
                <ConsentRow
                  label="Analytics"
                  description="Helps us understand usage and improve NoLSAF."
                  Icon={BarChart3}
                  checked={analytics}
                  onChange={setAnalytics}
                />
                <ConsentRow
                  label="Marketing"
                  description="Measures campaigns and relevant promotions."
                  Icon={Megaphone}
                  checked={marketing}
                  onChange={setMarketing}
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={useEssentialOnly} className={outlineButton}>
                  Essential only
                </button>
                <button type="button" onClick={savePreferences} className={`${primaryButton} inline-flex items-center justify-center gap-1.5`}>
                  <Check className="h-4 w-4" aria-hidden="true" />
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
  Icon,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  Icon: LucideIcon;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-md border border-solid px-3 py-2.5 transition-colors ${
        checked && !disabled ? "border-[#02665e]/30 bg-[#e1f4ef]/50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${checked ? "bg-white text-[#02665e]" : "bg-white text-slate-400"} ring-1 ring-slate-200`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-900">{label}</span>
          {disabled && (
            <span className="rounded bg-[#e1f4ef] px-1.5 py-0.5 text-[10px] font-semibold text-[#02665e]">
              Required
            </span>
          )}
        </div>
        <p className="m-0 mt-0.5 text-[11.5px] leading-4 text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={`${label} cookies`}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full border-0 p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2 ${
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
