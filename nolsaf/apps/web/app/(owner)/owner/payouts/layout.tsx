"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, Clock, LayoutDashboard, Receipt, Wallet } from "lucide-react";

/**
 * Owner Payouts workspace. One place for the owner's money, in one
 * vocabulary (Unlocking, Ready, On hold, Paid...). The previous invoice-based
 * claims live only under "Older claims", so the two flows never share a screen.
 */

const TABS = [
  { href: "/owner/payouts", label: "Overview", Icon: LayoutDashboard, exact: true },
  { href: "/owner/payouts/in-progress", label: "In progress", Icon: Clock },
  { href: "/owner/payouts/history", label: "History", Icon: Receipt },
  { href: "/owner/payouts/account", label: "Payout account", Icon: Wallet },
  { href: "/owner/payouts/older-claims", label: "Older claims", Icon: Archive },
];

const SUBTITLES: Record<string, string> = {
  "/owner/payouts": "What you can withdraw now, and what is on its way.",
  "/owner/payouts/in-progress": "Every stay from check-in to payment, step by step.",
  "/owner/payouts/history": "Payouts that are finished, with statements and receipts.",
  "/owner/payouts/account": "Where your payouts are sent, and how that account is protected.",
  "/owner/payouts/older-claims": "Claims made before the new payout flow, handled the previous way.",
};

export default function OwnerPayoutsLayout({ children }: { children: ReactNode }) {
  const path = usePathname() || "/owner/payouts";
  const active = (tab: (typeof TABS)[number]) => (tab.exact ? path === tab.href : path.startsWith(tab.href));
  const current = TABS.find(active) ?? TABS[0];

  return (
    <div id="owner-payouts" className="w-full min-w-0 max-w-none space-y-5 px-3 pb-12 sm:px-5 lg:px-6 xl:px-8">
      <style>{`#owner-payouts, #owner-payouts * { box-sizing: border-box; }`}</style>

      <header className="overflow-hidden rounded-2xl bg-[#012a26] text-white">
        <div className="px-5 pb-0 pt-5 sm:px-7 sm:pt-6">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9fd8cc]">Property owner</p>
          <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-white sm:text-[28px]">Payouts</h1>
          <p className="m-0 mt-1.5 max-w-2xl text-sm text-white/65">{SUBTITLES[current.href]}</p>

          <nav className="-mx-1 mt-5 flex gap-1 overflow-x-auto" aria-label="Payouts sections">
            {TABS.map((tab) => {
              const on = active(tab);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={on ? "page" : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 border-0 border-b-2 border-solid px-3 pb-3 pt-1 text-sm font-semibold no-underline transition-colors hover:no-underline ${
                    on ? "border-[#5eead4] text-white" : "border-transparent text-white/55 hover:text-white"
                  } ${tab.href.endsWith("older-claims") ? "ml-auto" : ""}`}
                >
                  <tab.Icon className="h-4 w-4" aria-hidden />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {children}
    </div>
  );
}
