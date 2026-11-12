"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/sales/agency", label: "Links and bookings" },
  { href: "/sales/agency/clients", label: "Clients" },
  { href: "/sales/agency/groups", label: "Group stays" },
];

/** Underline tabs across the Agency Desk pages. */
export default function AgencyTabs() {
  const pathname = usePathname() || "";
  return (
    <nav aria-label="Agency Desk" className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-slate-200">
      {TABS.map((tab) => {
        const on = tab.href === "/sales/agency" ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative shrink-0 px-3 py-2.5 text-sm font-semibold no-underline hover:no-underline ${on ? "text-[#02665e]" : "text-slate-500 hover:text-slate-800"}`}
          >
            {tab.label}
            {on ? <span className="absolute inset-x-2 -bottom-px h-0.5 bg-[#02665e]" aria-hidden /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
