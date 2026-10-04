"use client";

import Link from "next/link";
import { ArrowRight, Clock3, CreditCard, ReceiptText, ShieldCheck, WalletCards } from "lucide-react";
import type { NrmsProperty, NrmsUsagePolicy } from "./NrmsProvider";

type BillingAccount = NonNullable<NrmsProperty["nrmsPaygAccount"]>;

function amount(currency: string, value: number) {
  return `${currency} ${Math.max(0, Math.round(value)).toLocaleString()}`;
}

function presentation(account: BillingAccount) {
  const status = String(account.status ?? "").toUpperCase();
  if (status === "PAYMENT_REQUIRED") return { label: "Payment required", title: "Your NRMS balance needs attention", tone: "danger" as const, action: "Pay now", href: "/owner/nrms/billing?pay=1#statements" };
  if (status === "PAYMENT_PENDING") return { label: "Payment processing", title: "Your payment is being confirmed", tone: "pending" as const, action: "View status", href: "/owner/nrms/billing#statements" };
  if (status === "CLOSED") return { label: "Account closed", title: "Your NRMS account needs support", tone: "danger" as const, action: "View account", href: "/owner/nrms/billing#statements" };
  return { label: "Usage balance", title: "Stay comfortably ahead of your NRMS limit", tone: "warning" as const, action: "Review billing", href: "/owner/nrms/billing#statements" };
}

export default function NrmsBillingAttention({
  property,
  policy,
  variant,
}: {
  property: NrmsProperty | null;
  policy: NrmsUsagePolicy;
  variant: "indicator" | "dashboard";
}) {
  const account = property?.nrmsPaygAccount;
  if (!account) return null;

  const balance = Number(account.unpaidBalance ?? 0);
  const limit = Number(account.unpaidLimit ?? 0);
  const ratio = limit > 0 ? balance / limit : 0;
  const status = String(account.status ?? "").toUpperCase();
  const urgent = ["PAYMENT_REQUIRED", "PAYMENT_PENDING", "CLOSED"].includes(status);
  const approaching = status === "WARNING" || ratio >= 0.8;
  const currency = policy?.currency || property?.currency || "TZS";
  const view = presentation(account);

  if (variant === "indicator") {
    if (balance <= 0 && !urgent) return null;
    const urgentTone = view.tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
      : view.tone === "pending"
        ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
        : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100";
    return (
      <Link href={view.href} title={`${view.label}: ${amount(currency, balance)}`} className={`group inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-2.5 text-xs no-underline transition ${urgentTone}`}>
        <span className="relative grid h-7 w-7 place-items-center rounded-lg bg-white/80 shadow-sm"><WalletCards className="h-3.5 w-3.5" />{urgent && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />}</span>
        <span className="hidden min-w-0 xl:block"><span className="block text-[9px] leading-none opacity-70">{view.label}</span><span className="mt-1 block font-semibold leading-none tabular-nums">{amount(currency, balance)}</span></span>
        <ArrowRight className="hidden h-3.5 w-3.5 opacity-50 transition-transform group-hover:translate-x-0.5 xl:block" />
      </Link>
    );
  }

  if (!urgent && !approaching) return null;

  const danger = view.tone === "danger";
  const pending = view.tone === "pending";
  const accent = danger ? "from-red-500 to-rose-500" : pending ? "from-amber-400 to-orange-400" : "from-amber-400 to-yellow-400";
  const iconTone = danger ? "bg-red-50 text-red-600 ring-red-100" : "bg-amber-50 text-amber-600 ring-amber-100";
  const progress = Math.min(100, Math.max(4, ratio * 100));

  return (
    <section className="relative mb-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.5)]" aria-label="NRMS billing attention">
      <span className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${accent}`} aria-hidden="true" />
      <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(15rem,.75fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ${iconTone}`}>{pending ? <Clock3 className="h-[18px] w-[18px]" /> : <CreditCard className="h-[18px] w-[18px]" />}</span>
          <div className="min-w-0">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${danger ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>{view.label}</span>
            <h2 className="mb-0 mt-1.5 text-[15px] font-semibold tracking-tight text-neutral-900">{view.title}</h2>
            <p className="mb-0 mt-1 max-w-xl text-xs leading-5 text-neutral-500">{pending ? "No second payment is needed. We will restore access automatically after confirmation." : danger ? "Normal hotel operations continue, but new billable actions pause until this balance is cleared." : "Review the balance now to prevent new reservations and partnership activations from being interrupted."}</p>
          </div>
        </div>

        <div className="rounded-xl bg-neutral-50 px-3.5 py-3 ring-1 ring-neutral-100">
          <div className="flex items-end justify-between gap-3">
            <div><p className="m-0 text-[10px] text-neutral-400">Outstanding</p><p className="mb-0 mt-0.5 text-lg font-semibold tracking-tight text-neutral-900 tabular-nums">{amount(currency, balance)}</p></div>
            {limit > 0 && <p className="m-0 text-[10px] text-neutral-400">Limit {amount(currency, limit)}</p>}
          </div>
          {limit > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200"><div className={`h-full rounded-full bg-gradient-to-r ${accent} transition-[width] duration-500`} style={{ width: `${progress}%` }} /></div>}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Link href={view.href} className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-white no-underline shadow-sm transition ${danger ? "bg-red-600 hover:bg-red-700" : "bg-emerald-700 hover:bg-emerald-800"}`}><WalletCards className="h-4 w-4" />{view.action}</Link>
          <Link href="/owner/nrms/billing#statements" title="View statement" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 no-underline transition hover:bg-neutral-50 hover:text-neutral-800"><ReceiptText className="h-4 w-4" /></Link>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-neutral-100 bg-emerald-50/50 px-4 py-2 text-[10px] text-emerald-700 sm:px-5"><ShieldCheck className="h-3.5 w-3.5 shrink-0" /><span>Existing stays, check-ins, checkouts, folios and outlet activity continue normally.</span></div>
    </section>
  );
}
