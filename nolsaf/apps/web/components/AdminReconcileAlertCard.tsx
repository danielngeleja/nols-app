"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";

type ReconcileAlert = {
  id: string;
  title: string;
  body: string;
};

/**
 * Persistent popup for NRMS payments that need reconciliation. The regular
 * admin toast disappears after seconds; a payment with no provider verdict
 * needs a card that stays on screen until an admin acts or dismisses it.
 * The urgent chime is already played by AdminNotificationListener, which also
 * dispatches the browser event this card listens to.
 */
export default function AdminReconcileAlertCard() {
  const [alerts, setAlerts] = useState<ReconcileAlert[]>([]);

  useEffect(() => {
    const onNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string | number; template?: string; title?: string; body?: string }>).detail;
      if (detail?.template !== "nrms_payment_reconcile_needed") return;
      const id = String(detail.id ?? `reconcile-${Date.now()}`);
      setAlerts((current) => {
        if (current.some((alert) => alert.id === id)) return current;
        return [...current, { id, title: detail.title || "NRMS payment needs reconciliation", body: detail.body || "" }].slice(-3);
      });
    };
    window.addEventListener("nols:admin-notification", onNotification);
    return () => window.removeEventListener("nols:admin-notification", onNotification);
  }, []);

  if (!alerts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[90] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
      {alerts.map((alert) => (
        <div key={alert.id} role="alertdialog" aria-label={alert.title} className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-[0_18px_45px_-18px_rgba(15,23,42,0.4)]">
          <div className="flex items-start justify-between gap-3 border-b border-red-100 bg-red-50 px-4 py-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              <span className="text-[13px] font-semibold text-red-900">{alert.title}</span>
            </span>
            <button
              type="button"
              aria-label="Dismiss alert"
              onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}
              className="rounded-md border-0 bg-transparent p-1 text-red-400 transition hover:text-red-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 py-3">
            <p className="mb-0 text-xs leading-relaxed text-neutral-600">{alert.body}</p>
            <Link
              href="/admin/nrms/reconciliation"
              onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}
              className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg bg-red-600 px-4 text-xs font-semibold text-white no-underline transition hover:bg-red-700"
            >
              Open reconciliation queue
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
