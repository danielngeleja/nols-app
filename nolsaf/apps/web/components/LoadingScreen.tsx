"use client";

import { useEffect, useState, type CSSProperties } from "react";
import BrandMark from "@/components/BrandMark";
import { hasClientNavigated } from "@/components/RouteProgress";

const delay = (ms: number) => ({ "--nls-load-delay": `${ms}ms` }) as CSSProperties;

/**
 * First load: branded splash where the mark draws itself.
 * Page change: a quiet in-page state (the top RouteProgress bar carries the motion).
 * Everything fades in after 300ms so fast loads never flash, and the slow-network
 * hint is pure CSS so it still appears when JavaScript hasn't arrived yet.
 */
export default function LoadingScreen({ label = "Getting things ready…" }: { label?: string }) {
  const [inline] = useState(hasClientNavigated);
  const [offline, setOffline] = useState(false);

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

  const status = offline ? "You're offline. We'll continue when you're back online." : label;

  if (inline) {
    return (
      <div role="status" aria-live="polite" className="flex min-h-[60vh] w-full items-center justify-center">
        <div className="nls-load-appear flex flex-col items-center" style={delay(400)}>
          <BrandMark size={36} className="nls-load-breathe" />
          <p className="m-0 mt-3 text-xs font-medium text-slate-500">{status}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white px-4">
      <div role="status" aria-live="polite" className="relative flex flex-col items-center text-center">
        <div className="nls-load-appear" style={delay(300)}>
          <BrandMark size={64} draw />
        </div>

        <p className="nls-load-appear m-0 mt-5 text-2xl font-bold tracking-tight text-slate-900" style={delay(1300)}>
          NoLSAF
        </p>
        <p className="nls-load-appear m-0 mt-1 text-sm font-medium text-[#02665e]" style={delay(1500)}>
          Quality Stay for Every Wallet
        </p>

        <div className="nls-load-appear mt-6" style={delay(1700)}>
          <div className="nls-load-track" />
        </div>
        <p className="nls-load-appear m-0 mt-3 text-xs font-medium text-slate-500" style={delay(1700)}>
          {status}
        </p>

        <div className="nls-load-appear absolute left-1/2 top-full mt-4 flex w-72 -translate-x-1/2 flex-col items-center" style={delay(6000)}>
          <p className="m-0 text-xs text-slate-500">Still loading. Your connection seems slow.</p>
          {/* A plain link reloads the page even before JavaScript has loaded. */}
          <a
            href=""
            className="mt-2 inline-flex min-h-[40px] items-center rounded-full border border-solid border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 no-underline hover:border-[#02665e] hover:text-[#02665e]"
          >
            Retry
          </a>
        </div>
      </div>
    </div>
  );
}
