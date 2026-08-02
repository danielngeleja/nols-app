import Link from "next/link";
import { ArrowRight, CalendarDays, ShieldCheck, TrendingUp } from "lucide-react";
import LivePerformancePulse from "./LivePerformancePulse";
import NoLSAFReportsFrame, { NoLSAFReportPanel, NoLSAFReportTitle } from "@/components/admin/reports/NoLSAFReportsFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const reportLanes = [
  {
    href: "/admin/management/reports/revenue",
    title: "Revenue and commission",
    description: "NoLSAF revenue, customer payment volume, property invoices, transport, tours, and commission controls.",
    meta: "Finance report",
    icon: TrendingUp,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    href: "/admin/management/reports/bookings",
    title: "Booking operations",
    description: "Owner property bookings, group stays, and tour activity with status and detailed registers.",
    meta: "Operations report",
    icon: CalendarDays,
    tone: "bg-blue-50 text-blue-700",
  },
] as const;

export default function ManagementReportsHubPage() {
  return (
    <NoLSAFReportsFrame>
      <NoLSAFReportTitle
        icon="overview"
        eyebrow="Executive overview"
        title="Company performance overview"
        text="Live NoLSAF revenue and operating activity, followed by focused finance and booking reports."
      />

      <LivePerformancePulse />

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <NoLSAFReportPanel title="Report directory" description="Open the report that owns the figures you need to review or export.">
          <div className="grid gap-2 sm:grid-cols-2">
            {reportLanes.map((report) => {
              const Icon = report.icon;
              return (
                <Link key={report.href} href={report.href} className="group flex min-h-[88px] items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 no-underline transition hover:border-emerald-200 hover:bg-neutral-50">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${report.tone}`}><Icon className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">{report.meta}</span>
                    <span className="mt-0.5 block text-xs font-bold text-neutral-950">{report.title}</span>
                    <span className="mt-1 block text-[10px] leading-4 text-neutral-500">{report.description}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
                </Link>
              );
            })}
          </div>
        </NoLSAFReportPanel>

        <NoLSAFReportPanel title="Reporting control" description="The same operating rules used by the NRMS report centre.">
          <div className="space-y-2">
            {[
              "Live screens remain read only.",
              "Currencies are reported separately.",
              "Printed reports include verification references.",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-[11px] text-emerald-900">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </NoLSAFReportPanel>
      </div>
    </NoLSAFReportsFrame>
  );
}
