"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Set once the user has moved between pages client-side. LoadingScreen reads it
// to tell a first load (branded splash) from a page change (in-page state).
declare global {
  interface Window {
    __nolsafNavigated?: boolean;
  }
}

export function hasClientNavigated(): boolean {
  return typeof window !== "undefined" && window.__nolsafNavigated === true;
}

function isInternalNavigation(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!anchor || anchor.hasAttribute("download")) return false;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return false;

  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return false;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  // Same page (or only the hash changed): nothing will load.
  return url.pathname !== window.location.pathname || url.search !== window.location.search;
}

/** Thin brand bar across the top while the next page loads. */
export default function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<number[]>([]);
  const firstRoute = useRef(true);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!isInternalNavigation(event)) return;
      window.__nolsafNavigated = true;
      clearTimers();
      setVisible(true);
      setWidth(12);
      // Creep toward 90% so long loads still look alive; the route change finishes it.
      [[200, 35], [700, 60], [1600, 78], [3500, 90]].forEach(([delay, w]) => {
        timers.current.push(window.setTimeout(() => setWidth(w), delay));
      });
      // Safety net if the navigation never completes (cancelled, error page, etc.).
      timers.current.push(window.setTimeout(() => setVisible(false), 12000));
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    window.__nolsafNavigated = true;
    clearTimers();
    setWidth(100);
    timers.current.push(window.setTimeout(() => setVisible(false), 250));
    timers.current.push(window.setTimeout(() => setWidth(0), 600));
  }, [pathname, searchParams]);

  return (
    <div
      className="nls-route-bar"
      style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
      aria-hidden
    />
  );
}
