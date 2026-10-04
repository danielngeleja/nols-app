import Link from "next/link";
import { ArrowRight, CalendarDays, FolderOpen, ShieldCheck, TrendingUp } from "lucide-react";
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
    tone: "from-emerald-500 to-emerald-700",
  },
  {
    href: "/admin/management/reports/bookings",
    title: "Booking operations",
    description: "Owner property bookings, group stays, and tour activity with status and detailed registers.",
    meta: "Operations report",
    icon: CalendarDays,
    tone: "from-blue-500 to-blue-700",
  },
] as const;

const controls = [
  { title: "Read only", text: "Live screens never change a figure." },
  { title: "Currencies apart", text: "TZS and USD are never summed together." },
  { title: "Verifiable prints", text: "Printed reports carry a verification reference." },
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

      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <NoLSAFReportPanel
          icon={<FolderOpen aria-hidden />}
          title="Report directory"
          description="Open the report that owns the figures you need to review or export."
          right={<span className="rounded-full border border-solid border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm">{reportLanes.length} reports</span>}
        >
          <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
            {reportLanes.map((report) => {
              const Icon = report.icon;
              return (
                <Link
                  key={report.href}
                  href={report.href}
                  className="group box-border flex min-h-[96px] min-w-0 items-center gap-3.5 rounded-xl border border-solid border-neutral-200 bg-white p-3.5 no-underline transition hover:border-emerald-200 hover:bg-emerald-50/50"
                >
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${report.tone}`}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{report.meta}</span>
                    <span className="mt-0.5 block text-[15px] font-bold text-neutral-950">{report.title}</span>
                    <span className="mt-1 block text-[12px] leading-4 text-neutral-500">{report.description}</span>
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-400 transition group-hover:border-emerald-200 group-hover:text-emerald-700">
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              );
            })}
          </div>
        </NoLSAFReportPanel>

        <NoLSAFReportPanel icon={<ShieldCheck aria-hidden />} title="Reporting controls" description="The same operating rules used by the NRMS report centre.">
          <ul className="m-0 list-none space-y-2 p-0">
            {controls.map((item) => (
              <li key={item.title} className="flex items-start gap-2.5 rounded-xl bg-neutral-50 px-3 py-2.5 ring-1 ring-inset ring-neutral-200/70">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-bold text-neutral-800">{item.title}</span>
                  <span className="block text-[11.5px] leading-4 text-neutral-500">{item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </NoLSAFReportPanel>
      </div>
    </NoLSAFReportsFrame>
  );
}
