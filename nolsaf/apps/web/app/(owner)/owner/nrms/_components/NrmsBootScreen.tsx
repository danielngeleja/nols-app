"use client";

// The workspace entrance. The NoLSAF mark draws itself on a loop, the same
// motion as the site-wide loader, with only the property name beneath it.
// Earlier versions narrated timed steps ("Verifying your access", "Almost
// there") that changed on a clock rather than on real progress; they are gone.
// The screen stays silent unless something is actually wrong: offline, or
// slow enough that a Retry is worth offering.
import { useEffect, useRef, useState } from "react";
import { BRAND_MARK_FRAME, BRAND_MARK_LETTER } from "@/components/BrandMark";

// Long enough for the frame and the N to finish drawing once, so the mark is
// never cut off half traced. Fast loads leave after this; slow ones wait.
const MIN_HOLD_MS = 1600;
// Past this the screen offers Retry. Past MAX_HOLD it stands down so a request
// that never settles cannot lock staff out; whatever the shell renders next
// (spinner, error notice) takes over.
const SLOW_MS = 6000;
const MAX_HOLD_MS = 15000;
const EXIT_MS = 420;

export default function NrmsBootScreen({
  ready,
  propertyTitle,
  onDone,
}: {
  ready: boolean;
  propertyTitle?: string | null;
  onDone: () => void;
}) {
  const [held, setHeld] = useState(false);
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const handedOff = useRef(false);

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const timers = [
      setTimeout(() => setHeld(true), MIN_HOLD_MS),
      setTimeout(() => setSlow(true), SLOW_MS),
      setTimeout(() => {
        if (handedOff.current) return;
        handedOff.current = true;
        setLeaving(true);
        setTimeout(() => onDoneRef.current(), EXIT_MS);
      }, MAX_HOLD_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Hand off only once both the data and the minimum hold are satisfied, then
  // fade out so the workspace appears behind the screen rather than replacing
  // it in a single frame. The guard is a ref, not `leaving` state: putting
  // `leaving` in the deps made the effect re-run the moment it was set, and
  // React's cleanup cancelled the very timer that ends the screen, leaving an
  // invisible overlay parked over an unrendered workspace.
  useEffect(() => {
    if (!ready || !held || handedOff.current) return;
    handedOff.current = true;
    setLeaving(true);
    const timer = setTimeout(onDone, EXIT_MS);
    return () => clearTimeout(timer);
  }, [ready, held, onDone]);

  const notice = offline ? "You're offline. NRMS opens when you're back online." : slow ? "Still loading. Your connection seems slow." : null;

  return (
    // Inset, rounded panel on the neutral canvas, matching the shell's
    // floating sidebar and header rather than a hard full-bleed rectangle.
    <div className="fixed inset-0 z-50 bg-neutral-100 p-3" role="status" aria-live="polite" aria-label={`Opening ${propertyTitle || "the NRMS workspace"}`}>
      <style>{`
        .nrms-boot { transition: opacity ${EXIT_MS}ms cubic-bezier(.22,1,.36,1), transform ${EXIT_MS}ms cubic-bezier(.22,1,.36,1); }
        .nrms-boot-leaving { opacity: 0; transform: scale(0.99); }
        .nrms-boot-frame, .nrms-boot-letter { stroke-dasharray: 1; stroke-dashoffset: 1; animation: nrms-boot-frame 3s cubic-bezier(.65,0,.35,1) infinite; }
        .nrms-boot-letter { animation-name: nrms-boot-letter; }
        @keyframes nrms-boot-frame { 0% { stroke-dashoffset: 1; } 35%, 70% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -1; } }
        @keyframes nrms-boot-letter { 0%, 15% { stroke-dashoffset: 1; } 50%, 70% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -1; } }
        .nrms-boot-in { opacity: 0; animation: nrms-boot-in .5s ease-out .3s forwards; }
        @keyframes nrms-boot-in { to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .nrms-boot-frame, .nrms-boot-letter { animation: none; stroke-dashoffset: 0; }
          .nrms-boot-in { animation-duration: .01ms; animation-delay: 0s; }
        }
      `}</style>

      <div className={`nrms-boot relative flex h-full w-full items-center justify-center rounded-[28px] bg-white shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] ${leaving ? "nrms-boot-leaving" : ""}`}>
        <div className="flex flex-col items-center px-6 text-center">
          <svg width={60} height={68} viewBox="-10 0 770 870" fill="none" stroke="#02665e" strokeLinecap="round" aria-hidden>
            <path className="nrms-boot-frame" d={BRAND_MARK_FRAME} strokeWidth={86} pathLength={1} />
            <path className="nrms-boot-letter" d={BRAND_MARK_LETTER} strokeWidth={84} pathLength={1} />
          </svg>
          <p className="nrms-boot-in m-0 mt-5 max-w-[24ch] text-[15px] font-bold tracking-[-0.01em] text-neutral-900">{propertyTitle || "NRMS"}</p>

          {notice && (
            <div className="nrms-boot-in mt-6 flex flex-col items-center">
              <p className="m-0 text-xs text-neutral-500">{notice}</p>
              {!offline && (
                // A plain link reloads even if the client bundle is what stalled.
                <a href="" className="mt-2.5 inline-flex min-h-9 items-center rounded-full border border-solid border-neutral-300 bg-white px-4 text-xs font-semibold text-neutral-700 no-underline transition hover:border-[#02665e] hover:text-[#02665e]">
                  Retry
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
