"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Clock3, LockKeyhole, ReceiptText, ShieldCheck, WalletCards } from "lucide-react";
import ModalFrame from "./NrmsModalFrame";
import { useNrmsAccessRole } from "./NrmsAccessRole";

export type NrmsBillingBlock = {
  status: string;
  title: string;
  detail: string;
  action: "PAY" | "STATUS" | "SUPPORT";
  outstanding: number;
  limit: number;
  currency: string;
};

export default function NrmsBillingBlockModal({
  block,
  title,
  subtitle,
  reassurance,
  onClose,
}: {
  block: NrmsBillingBlock;
  title: string;
  subtitle: string;
  reassurance: string;
  onClose: () => void;
}) {
  const { accessRole } = useNrmsAccessRole();
  const canManageBilling = accessRole === "OWNER";
  const tone = block.status === "PAYMENT_REQUIRED"
    ? { chip: "bg-red-50 text-red-600 ring-red-100", icon: "bg-red-50 text-red-600", progress: "from-red-500 to-rose-400", Icon: AlertTriangle }
    : block.status === "PAYMENT_PENDING"
      ? { chip: "bg-amber-50 text-amber-700 ring-amber-100", icon: "bg-amber-50 text-amber-600", progress: "from-amber-400 to-orange-400", Icon: Clock3 }
      : { chip: "bg-neutral-100 text-neutral-600 ring-neutral-200", icon: "bg-neutral-100 text-neutral-600", progress: "from-neutral-500 to-neutral-400", Icon: LockKeyhole };
  const chipLabel = block.status === "PAYMENT_REQUIRED" ? "Payment required" : block.status === "PAYMENT_PENDING" ? "Payment pending" : "Account closed";
  const amount = (value: number) => `${block.currency} ${Math.round(value).toLocaleString()}`;
  const usagePercentage = block.limit > 0 ? Math.min(100, Math.max(4, (block.outstanding / block.limit) * 100)) : 0;
  const actionHref = block.action === "PAY"
    ? "/owner/nrms/billing?pay=1#statements"
    : block.action === "STATUS"
      ? "/owner/nrms/billing#statements"
      : "/owner/nrms/help";
  const actionLabel = block.action === "PAY" ? "Pay balance" : block.action === "STATUS" ? "Check payment status" : "Contact support";

  return (
    <ModalFrame title={title} subtitle={subtitle} icon={<WalletCards className="h-5 w-5" />} elevated onClose={onClose}>
      <div role="alert">
        <div className="flex items-start gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone.icon}`}><tone.Icon className="h-4 w-4" /></span>
          <div className="min-w-0 pt-0.5">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ring-1 ring-inset ${tone.chip}`}>{chipLabel}</span>
            <h4 className="mb-0 mt-2.5 text-base font-semibold tracking-tight text-neutral-950">{block.title}</h4>
            <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">{block.detail}</p>
          </div>
        </div>

        <div className="relative mt-5 overflow-hidden rounded-2xl bg-[#10251f] px-4 py-4 text-white shadow-[0_18px_42px_-28px_rgba(6,38,31,0.9)]">
          <span className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-emerald-400/10 blur-2xl" aria-hidden="true" />
          <div className="relative flex items-end justify-between gap-4">
            <div>
              <p className="m-0 text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-100/55">Outstanding balance</p>
              <p className="mb-0 mt-1.5 text-[26px] font-medium leading-none tracking-tight tabular-nums">{amount(block.outstanding)}</p>
            </div>
            {block.limit > 0 && <div className="shrink-0 text-right"><p className="m-0 text-[9px] uppercase tracking-[0.12em] text-emerald-100/45">Account limit</p><p className="mb-0 mt-1 text-xs font-medium text-emerald-50/80 tabular-nums">{amount(block.limit)}</p></div>}
          </div>
          {block.limit > 0 && <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full bg-gradient-to-r ${tone.progress} transition-[width] duration-500`} style={{ width: `${usagePercentage}%` }} /></div>}
          <div className="relative mt-3 flex items-center justify-between gap-3 text-[10px] text-emerald-100/50"><span>NRMS room-night usage</span>{block.limit > 0 && <span className="tabular-nums">{Math.round((block.outstanding / block.limit) * 100)}% of limit</span>}</div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-neutral-50 px-3.5 py-3 ring-1 ring-inset ring-neutral-100">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="m-0 text-xs font-medium text-neutral-800">{canManageBilling ? "Your current operation stays open" : "Property owner action required"}</p>
            <p className="mb-0 mt-1 text-[11px] leading-[1.1rem] text-neutral-500">
              {canManageBilling ? reassurance : `Only the property owner can pay or authorize this balance. ${reassurance}`}
            </p>
          </div>
        </div>

        {canManageBilling ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <Link href={actionHref} className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-semibold text-white no-underline shadow-sm transition hover:-translate-y-px hover:bg-emerald-800 hover:shadow-md">
              <WalletCards className="h-4 w-4" />{actionLabel}<ArrowRight className="h-3.5 w-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/owner/nrms/billing#statements" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-medium text-neutral-600 no-underline transition hover:bg-neutral-50 hover:text-neutral-900">
              <ReceiptText className="h-4 w-4" />View statement
            </Link>
          </div>
        ) : (
          <button type="button" onClick={onClose} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 hover:text-neutral-950">
            Close
          </button>
        )}
      </div>
    </ModalFrame>
  );
}
