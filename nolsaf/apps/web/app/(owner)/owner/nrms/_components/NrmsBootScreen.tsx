"use client";

// The workspace entrance. Opening NRMS used to show a bare grey spinner, which
// read as "stuck" rather than "opening". This holds the door for a beat with
// the brand mark, draws a ring while the real request is in flight, and names
// what is actually happening instead of selling a slogan back to staff who
// already work here.
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

// Long enough to read the property name, short enough to survive being seen
// ten times a shift. If the data lands sooner we still hold; if it lands later
// the ring simply rests at full and the status line waits with it.
const MIN_HOLD_MS = 2400;
const MAX_HOLD_MS = 8000;
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
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const handedOff = useRef(false);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 900),
      setTimeout(() => setStep(2), 1800),
      setTimeout(() => setHeld(true), MIN_HOLD_MS),
      // Failsafe: a request that never settles must not leave staff staring at
      // a locked door. Past this point the screen stands down and whatever the
      // shell renders next (spinner, error notice) takes over.
      setTimeout(() => {
        if (handedOff.current) return;
        handedOff.current = true;
        setLeaving(true);
        setTimeout(() => onDoneRef.current(), EXIT_MS);
      }, MAX_HOLD_MS),
    ];
    return () => timers.forEach(clearTimeout);
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

  const status =
    step === 0
      ? "Verifying your access"
      : step === 1
      ? propertyTitle
        ? `Loading ${propertyTitle}`
        : "Loading your property"
      : ready
      ? "Front desk ready"
      : "Almost there";

  return (
    // A neutral page canvas sits behind the panel, matching the inset margin
    // the sidebar and header use elsewhere in this shell (mx-3 mt-3, rounded
    // corners). Full-bleed hard corners were the actual complaint: on a wide
    // monitor a flat rectangle with square corners reads as unfinished next
    // to every other surface in the app, which is all rounded floating cards.
    <div className="fixed inset-0 z-50 bg-neutral-100 p-3" role="status" aria-live="polite" aria-label="Opening the NRMS workspace">
      <style>{`
        .nrms-boot { transition: opacity ${EXIT_MS}ms cubic-bezier(.22,1,.36,1), transform ${EXIT_MS}ms cubic-bezier(.22,1,.36,1); }
        .nrms-boot-leaving { opacity: 0; transform: scale(0.99); }
        .nrms-boot-halo { animation: nrms-boot-halo 4.5s cubic-bezier(.4,0,.2,1) infinite; }
        @keyframes nrms-boot-halo { 0% { transform: scale(.78); opacity: 0; } 35% { opacity: .45; } 100% { transform: scale(1.35); opacity: 0; } }
        .nrms-boot-ring { stroke-dasharray: 251.33; stroke-dashoffset: 251.33; animation: nrms-boot-ring 2s cubic-bezier(.4,0,.2,1) .25s forwards; }
        @keyframes nrms-boot-ring { to { stroke-dashoffset: 0; } }
        .nrms-boot-mark { opacity: 0; transform: scale(.94); animation: nrms-boot-mark .7s cubic-bezier(.22,1,.36,1) .06s forwards; }
        @keyframes nrms-boot-mark { to { opacity: 1; transform: none; } }
        .nrms-boot-in { opacity: 0; transform: translateY(5px); animation: nrms-boot-in .62s cubic-bezier(.22,1,.36,1) forwards; }
        .nrms-boot-d1 { animation-delay: .20s; }
        .nrms-boot-d2 { animation-delay: .34s; }
        .nrms-boot-d3 { animation-delay: .48s; }
        @keyframes nrms-boot-in { to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .nrms-boot-halo { animation: none; }
          .nrms-boot-ring { animation-duration: .01ms; stroke-dashoffset: 0; }
          .nrms-boot-mark, .nrms-boot-in { animation-duration: .01ms; animation-delay: 0s; opacity: 1; transform: none; }
        }
      `}</style>

      <div className={`nrms-boot relative flex h-full w-full items-center justify-center overflow-hidden rounded-[28px] ${leaving ? "nrms-boot-leaving" : ""}`} style={{ background: "linear-gradient(160deg, #0c3a32 0%, #082f2a 45%, #06231f 100%)" }}>
        {/* No glow or sheen: a fine, static dot grid reads as a considered
            surface (blueprint/operations texture) rather than a light effect,
            and a quiet bottom vignette grounds the panel instead of lighting it. */}
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 100%, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0) 62%)" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" />

        <div className="relative flex flex-col items-center px-6 text-center">
          {/* The ring has to clear the logo tile's corners, not just its edges: a
              44px square has a 62px diagonal, so the circle sits at 80px across
              to keep an even margin the whole way round. */}
          <div className="nrms-boot-mark relative mb-7 flex h-[6.5rem] w-[6.5rem] items-center justify-center">
            <span aria-hidden className="nrms-boot-halo absolute h-[6.5rem] w-[6.5rem] rounded-full border border-white/20" />
            <svg viewBox="0 0 104 104" className="absolute inset-0 h-[6.5rem] w-[6.5rem]" aria-hidden>
              <circle cx="52" cy="52" r="40" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" />
              <circle className="nrms-boot-ring" cx="52" cy="52" r="40" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" transform="rotate(-90 52 52)" />
            </svg>
            <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[13px] bg-white shadow-[0_6px_18px_rgba(0,0,0,0.22)]">
              <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={44} height={44} className="h-10 w-10 scale-[1.9] object-contain" priority />
            </span>
          </div>

          <p className="nrms-boot-in nrms-boot-d1 m-0 text-[11px] font-bold tracking-[0.18em] text-emerald-100/40">NoLSAF NRMS</p>
          <p className="nrms-boot-in nrms-boot-d2 m-0 mt-2 max-w-[22ch] text-[15px] font-bold tracking-[-0.01em] text-white">
            {propertyTitle || "NRMS Workspace"}
          </p>
          {/* Re-keying replays the fade on every step, but only the first line
              waits its turn in the opening stagger. */}
          <p key={status} className={`nrms-boot-in ${step === 0 ? "nrms-boot-d3" : ""} mb-0 mt-2 text-xs text-emerald-100/50`}>{status}</p>
        </div>
      </div>
    </div>
  );
}
