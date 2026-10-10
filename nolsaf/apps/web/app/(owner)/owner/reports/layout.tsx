"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, BedDouble, CalendarCheck, LayoutDashboard, PieChart, TrendingUp, Users } from "lucide-react";

const TABS = [
  { href: "/owner/reports/overview", label: "Overview", Icon: LayoutDashboard, sub: "Revenue, bookings and nights at a glance." },
  { href: "/owner/reports/revenue", label: "Revenue", Icon: TrendingUp, sub: "What your stays earned, before and after commission." },
  { href: "/owner/reports/bookings", label: "Bookings", Icon: CalendarCheck, sub: "How many bookings came in, and how they ended." },
  { href: "/owner/reports/stays", label: "Stays", Icon: BedDouble, sub: "Nights stayed by your guests." },
  { href: "/owner/reports/occupancy", label: "Occupancy", Icon: PieChart, sub: "How full your properties were." },
  { href: "/owner/reports/customers", label: "Customers", Icon: Users, sub: "Who books with you." },
];

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const current = TABS.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`)) ?? TABS[0];

  return (
    <div id="owner-reports" className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <style>{`#owner-reports, #owner-reports * { box-sizing: border-box; }`}</style>

      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)", WebkitMaskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative px-5 pt-6 sm:px-8 sm:pt-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Property owner</p>
              <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">Reports</h1>
              <p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">{current.sub}</p>
            </div>
            <Link
              href="/owner/payouts"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 self-start rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white no-underline transition hover:bg-white/10 sm:self-auto"
            >
              My Payouts <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <nav className="-mx-1 mt-6 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Report sections">
            {TABS.map((t) => {
              const on = t.href === current.href;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={on ? "page" : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 border-0 border-b-2 border-solid px-3 pb-3 pt-1 text-sm font-semibold no-underline transition-colors hover:no-underline ${
                    on ? "border-[#5eead4] text-white" : "border-transparent text-white/55 hover:text-white"
                  }`}
                >
                  <t.Icon className="h-4 w-4" aria-hidden />
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="w-full min-w-0">{children}</div>
    </div>
  );
}
