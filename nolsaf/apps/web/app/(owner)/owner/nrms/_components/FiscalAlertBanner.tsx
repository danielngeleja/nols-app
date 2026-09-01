"use client";

// Property-wide alert for fiscal receipts that are not reaching TRA.
//
// It lives in the NRMS shell rather than on the tax register because an owner
// whose fiscalisation broke on Monday morning will not be sitting on the tax
// register when it happens. Credentials that expire unnoticed for three days are a
// worse outcome than not offering the feature, which is what the escalation
// ladder in docs/NRMS_FISCAL_RECEIPTS.md section 7.4 exists to prevent.
//
// It never blocks anything. Guests keep paying whatever TRA is doing.

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "./NrmsProvider";

type Health = { escalatedAt: string | null; pending: number; failed: number; deadLettered: number } | null;

export default function FiscalAlertBanner() {
  const { selectedPropertyId } = useNrms();
  const [health, setHealth] = useState<Health>(null);
  const [dismissedFor, setDismissedFor] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedPropertyId) return;
    let cancelled = false;
    // One read per property selection, not a poll. The delivery worker runs on
    // its own clock and this is a nudge, not a live dashboard.
    void apiClient
      .get<{ fiscal: { status: string; mode: string; health: Health } }>(`/api/owner/nrms/fiscal/property/${selectedPropertyId}`)
      .then((res) => {
        if (cancelled) return;
        const fiscal = res.data.fiscal;
        setHealth(fiscal.status === "ACTIVE" && fiscal.mode !== "OFF" ? fiscal.health : null);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });
    return () => { cancelled = true; };
  }, [selectedPropertyId]);

  if (!selectedPropertyId || dismissedFor === selectedPropertyId) return null;
  if (!health?.escalatedAt) return null;

  const backlog = health.pending + health.failed + health.deadLettered;
  if (backlog === 0) return null;

  const since = new Date(health.escalatedAt);
  const hours = Math.max(1, Math.round((Date.now() - since.getTime()) / 3_600_000));

  return (
    <div className="flex flex-wrap items-start gap-2 border-b border-solid border-red-200 bg-red-50 px-3 py-2.5 sm:px-5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
      <p className="m-0 min-w-0 flex-1 text-xs leading-5 text-red-900">
        <span className="font-bold">TRA receipts are not being sent.</span>{" "}
        {backlog} receipt{backlog === 1 ? "" : "s"} {backlog === 1 ? "has" : "have"} been waiting for about {hours} hour{hours === 1 ? "" : "s"}. Guests can still pay and nothing is blocked.{" "}
        <Link href="/owner/nrms/finance?view=tax" className="font-bold text-red-900 underline">Check your TRA setup</Link>
      </p>
      {/* Dismissable per property per page load only. It comes straight back on
          the next navigation while the connection is still failing, which is the
          point: this is not a notice an owner should be able to silence. */}
      <button
        type="button"
        onClick={() => setDismissedFor(selectedPropertyId)}
        className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold text-red-800 hover:bg-red-100"
      >
        Hide
      </button>
    </div>
  );
}
