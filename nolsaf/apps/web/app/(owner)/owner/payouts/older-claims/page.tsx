"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, Check, Loader2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { formatEat, formatTzs } from "@/components/owner-payouts/shared";

/**
 * Claims from the previous invoice flow (submit invoice, then Requested,
 * Verified, Approved, Disbursed). Only claims that are NOT part of the new
 * payout flow are shown (scope=legacy), so nothing appears in two places.
 */

type LegacyInvoice = {
  id: number;
  invoiceReference?: string | null;
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  netPayable: number | string;
  bookingReference?: string | null;
  booking?: { property?: { title: string } };
};

const STEPS = ["Submitted", "Verified", "Approved", "Disbursed"] as const;

function stepOf(status: string): number {
  switch (status.toUpperCase()) {
    case "DRAFT":
      return -1;
    case "REQUESTED":
      return 0;
    case "VERIFIED":
      return 1;
    case "APPROVED":
    case "PROCESSING":
      return 2;
    default:
      return 3;
  }
}

export default function OlderClaimsPage() {
  const [items, setItems] = useState<LegacyInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get<{ items: LegacyInvoice[] }>("/api/owner/revenue/invoices", {
        params: { status: "DRAFT,REQUESTED,VERIFIED,APPROVED,PROCESSING", scope: "legacy", take: 200 },
      })
      .then((res) => setItems((res.data?.items ?? []).filter((i) => String(i.invoiceNumber || "").startsWith("OINV-"))))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-solid border-slate-200 bg-slate-50 px-5 py-4">
        <Archive className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
        <p className="m-0 text-sm leading-6 text-slate-600">
          These claims were started before the new payout flow. They finish the previous way: you submit the invoice, then our team
          verifies, approves and disburses it. New stays never appear here; they are under{" "}
          <Link href="/owner/payouts/in-progress" className="font-semibold text-[#02665e]">In progress</Link>.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center px-5 py-10 text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading older claims...
          </div>
        ) : items.length === 0 ? (
          <p className="m-0 px-5 py-10 text-center text-sm text-slate-500">No older claims are open. Finished ones are in History.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-slate-100 p-0">
            {items.map((inv) => {
              const step = stepOf(inv.status);
              const href = `/owner/invoices/${encodeURIComponent(inv.invoiceReference ?? String(inv.id))}`;
              return (
                <li key={inv.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{inv.booking?.property?.title || "Your property"}</span>
                      <span className="text-xs text-slate-500">
                        {inv.invoiceNumber} · {formatEat(inv.issuedAt, false)}
                      </span>
                    </div>
                    {step < 0 ? (
                      <p className="m-0 text-xs text-amber-800">Not submitted yet. Open the invoice to submit it.</p>
                    ) : (
                      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-[11px]">
                        {STEPS.map((s, i) => (
                          <li key={s} className="flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                                i < step ? "text-emerald-700" : i === step ? "bg-slate-800 text-white" : "text-slate-400"
                              }`}
                            >
                              {i < step && <Check className="h-3 w-3" aria-hidden />}
                              {s}
                            </span>
                            {i < STEPS.length - 1 && <span className="text-slate-300" aria-hidden>›</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <span className="text-sm font-bold tabular-nums text-slate-900">{formatTzs(inv.netPayable)}</span>
                    <Link href={href} className="inline-flex h-8 items-center rounded-lg border border-solid border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 no-underline hover:bg-slate-50 hover:no-underline">
                      {step < 0 ? "Submit invoice" : "Open"}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
