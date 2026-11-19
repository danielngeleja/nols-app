"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";

/**
 * Live finance unlock state for admin pages.
 * Reads the server grant on load, follows FinanceGrantPanel's
 * "finance-grant-granted" event, and lapses on its own when the time is up.
 */
export function useFinanceGrant(onGranted?: () => void) {
  const [until, setUntil] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    apiClient
      .get("/admin/2fa/otp/grant")
      .then((r) => {
        const value = Number(r.data?.data?.until ?? r.data?.until);
        if (alive && Number.isFinite(value) && value > Date.now()) setUntil(value);
      })
      .catch(() => {
        /* Not a finance operator, or offline: stay locked. */
      });
    const handle = (e: Event) => {
      const value = Number((e as CustomEvent<{ until?: number }>).detail?.until);
      setUntil(Number.isFinite(value) ? value : Date.now() + 15 * 60 * 1000);
      onGranted?.();
    };
    window.addEventListener("finance-grant-granted", handle);
    const tick = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => {
      alive = false;
      window.removeEventListener("finance-grant-granted", handle);
      window.clearInterval(tick);
    };
    // onGranted is read at event time; re-subscribing on every render is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlocked = until !== null && until > clock;
  const untilLabel = until
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit" }).format(new Date(until))
    : "";
  const request = () => window.dispatchEvent(new CustomEvent("finance-grant-required"));
  return { unlocked, untilLabel, request };
}
