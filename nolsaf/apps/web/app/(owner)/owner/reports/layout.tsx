"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart2, ArrowUpRight } from "lucide-react";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/owner/reports/overview",  label: "Overview",   dot: "bg-indigo-500",  pill: "bg-indigo-600",  ring: "focus-visible:ring-indigo-300" },
    { href: "/owner/reports/revenue",   label: "Revenue",    dot: "bg-emerald-500", pill: "bg-emerald-600", ring: "focus-visible:ring-emerald-300" },
    { href: "/owner/reports/bookings",  label: "Bookings",   dot: "bg-violet-500",  pill: "bg-violet-600",  ring: "focus-visible:ring-violet-300" },
    { href: "/owner/reports/stays",     label: "Stays",      dot: "bg-amber-500",   pill: "bg-amber-500",   ring: "focus-visible:ring-amber-300" },
    { href: "/owner/reports/occupancy", label: "Occupancy",  dot: "bg-sky-500",     pill: "bg-sky-600",     ring: "focus-visible:ring-sky-300" },
    { href: "/owner/reports/customers", label: "Customers",  dot: "bg-rose-500",    pill: "bg-rose-600",    ring: "focus-visible:ring-rose-300" },
  ];

  return (
    <div className="box-border min-w-0 max-w-full space-y-5 px-3 pb-10">

      {/* ── Hero ── */}
      <div className="relative overflow-hidden rounded-2xl shadow-lg shadow-[#02665e]/10">
        {/* Teal gradient bg */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#02665e] via-[#034e47] to-[#023a35]" />
        {/* Cross-hatch pattern */}
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)', backgroundSize: '18px 18px' }} />
        {/* Floating orbs */}
        <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-white/[0.04] pointer-events-none" />
        <div className="absolute -bottom-12 -left-6 w-36 h-36 rounded-full bg-white/[0.03] pointer-events-none" />
        <div className="absolute top-8 right-1/3 w-14 h-14 rounded-full bg-white/[0.03] pointer-events-none animate-pulse" />
        {/* Watermark */}
        <div className="pointer-events-none select-none absolute right-0 bottom-0 text-[72px] font-black text-white/[0.04] leading-none tracking-tighter pr-4 pb-1" aria-hidden>REPORTS</div>

        <div className="relative px-5 pt-6 pb-6 sm:px-7 sm:pt-7 sm:pb-7 lg:px-10 lg:pt-8 lg:pb-8">
          {/* Top row: badge left / Revenue link right */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-xl bg-white/10 animate-pulse" />
                <div className="relative flex items-center justify-center h-10 w-10 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20">
                  <BarChart2 className="h-5 w-5 text-white" aria-hidden />
                </div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm px-3 py-1 text-xs font-bold text-white/80">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 flex-shrink-0 animate-pulse" />
                Analytics
              </div>
            </div>
            <Link
              href="/owner/revenue"
              className="no-underline inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white/80 hover:bg-white/20 hover:text-white active:scale-[0.97] transition-all duration-150 text-xs font-bold"
              aria-label="Open revenue pages"
              title="Revenue"
            >
              Revenue
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>

          {/* Title */}
          <div className="mt-5">
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-none drop-shadow-sm">Reports</h1>
            <p className="mt-2 text-sm text-white/50 max-w-md">Overview of reports and analytics</p>
          </div>

          <div className="mt-6 h-px bg-gradient-to-r from-white/20 via-white/10 to-transparent" />

          {/* Tabs */}
          <div className="mt-5 grid grid-cols-3 sm:grid-cols-6 gap-2">
            {tabs.map((t) => {
              const active = pathname === t.href || pathname?.startsWith(`${t.href}/`);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    `no-underline inline-flex items-center justify-center gap-2 h-9 px-3 rounded-xl text-xs font-bold border transition-all duration-150 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${t.ring} ` +
                    (active
                      ? "bg-white border-transparent text-[#02665e] shadow-md"
                      : "bg-white/10 border-white/15 text-white/70 hover:bg-white/20 hover:text-white backdrop-blur-sm")
                  }
                >
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${active ? t.dot : "bg-white/50"}`} aria-hidden />
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="w-full">{children}</div>
    </div>
  );
}
