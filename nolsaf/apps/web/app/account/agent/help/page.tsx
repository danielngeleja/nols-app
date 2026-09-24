"use client";

// In-workspace help for the tour-agent portal, the analogue of
// /owner/nrms/help. The footer used to link to /help?ctx=agent, which navigated
// out to the public help page and dropped the operator out of the workspace.
//
// The reference tables below are transcribed from the resolvers that actually
// classify records, not written from memory: bucketForStatus in the bookings
// page, normalizedInvoiceStage/trackerStage in revenues, and the requiredAction
// ladder in the cancellations page. Change a resolver, change the table.
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  FileText,
  Headset,
  Mail,
  MessageCircle,
  MessagesSquare,
  Phone,
  Sparkles,
  TrendingUp,
  Wallet2,
  type LucideIcon,
} from "lucide-react";
import TableScroller from "@/components/TableScroller";

const MODULES: Array<{ icon: LucideIcon; title: string; description: string; href: string }> = [
  { icon: CalendarDays, title: "Bookings by stage", description: "Trips grouped as New, Confirmed, In Progress and Completed.", href: "/account/agent/bookings" },
  { icon: MessagesSquare, title: "Cancellation cases", description: "Traveller cancellation requests needing your response, evidence or awareness.", href: "/account/agent/cancellations" },
  { icon: TrendingUp, title: "Revenues and payouts", description: "Earnings per trip, payout claims and the commission retained by the platform.", href: "/account/agent/revenues" },
  { icon: BarChart3, title: "Reports", description: "Operational reporting across any date range, ready to print.", href: "/account/agent/reports" },
  { icon: FileText, title: "Profile and documents", description: "Your public operator profile, KYC documents and partnership contract.", href: "/account/agent/profile" },
];

// Precedence matters: the first matching rule wins, top to bottom.
const BOOKING_STAGES = [
  {
    stage: "Completed",
    tone: "bg-emerald-50 text-emerald-700",
    trigger: "Checklist locked, or a completion timestamp exists",
    statuses: "COMPLETE*, DONE*, CLOSED*",
    note: "Evaluated first, so a locked checklist completes a trip whatever its status label says.",
  },
  {
    stage: "Cancelled",
    tone: "bg-red-50 text-red-700",
    trigger: "Status carries a cancellation, rejection or refund",
    statuses: "CANCEL*, REJECT*, REFUND*",
    note: "Not shown as a stage tab. These trips leave the four working queues.",
  },
  {
    stage: "In Progress",
    tone: "bg-amber-50 text-amber-700",
    trigger: "Pickup has been validated",
    statuses: "PROGRESS*, ONGOING*, ACTIVE*",
    note: "A validated pickup wins over the status label, so a trip in the field reads as running.",
  },
  {
    stage: "Confirmed",
    tone: "bg-blue-50 text-blue-700",
    trigger: "Payment settled or the booking accepted",
    statuses: "PAID, CONFIRM*, ACCEPT*",
    note: "Confirmed trips carry the today / this-week counters above the queue.",
  },
  {
    stage: "New",
    tone: "bg-neutral-100 text-neutral-700",
    trigger: "Nothing above matched and the trip is awaiting review",
    statuses: "NEW*, PENDING*, ASSIGN*, PENDING_PAYMENT, empty",
    note: "The default stage, and where the sidebar lands you with no stage in the URL.",
  },
];

const PAYOUT_STAGES = [
  {
    stage: "New",
    tone: "bg-neutral-100 text-neutral-700",
    meaning: "Completed trip with no claim opened yet.",
    advance: "You submit a claim from the claim initiator.",
  },
  {
    stage: "Claimed",
    tone: "bg-indigo-50 text-indigo-700",
    meaning: "A claim exists: an invoice number was issued or a payout was requested.",
    advance: "NoLSAF verifies the claim against the trip record.",
  },
  {
    stage: "Verified",
    tone: "bg-amber-50 text-amber-700",
    meaning: "An explicit NoLSAF action confirming the claim matches the record.",
    advance: "NoLSAF approves the payout for disbursement.",
  },
  {
    stage: "Approved",
    tone: "bg-cyan-50 text-cyan-700",
    meaning: "Cleared for payment, with an approval timestamp on the record.",
    advance: "Funds are sent to your payout destination.",
  },
  {
    stage: "Disbursed",
    tone: "bg-emerald-50 text-emerald-700",
    meaning: "Paid, with a payment timestamp. The invoice is closed.",
    advance: "Terminal state.",
  },
  {
    stage: "Rejected",
    tone: "bg-red-50 text-red-700",
    meaning: "Declined at any point in the chain, with a stated reason.",
    advance: "Correct the underlying record, then claim again.",
  },
];

const CASE_ACTIONS = [
  { status: "Awaiting receipt", action: "Open the case and acknowledge receipt from NoLSAF", tone: "bg-amber-50 text-amber-700" },
  { status: "Open / Eligible", action: "Open and acknowledge the traveller request", tone: "bg-amber-50 text-amber-700" },
  { status: "Acknowledged", action: "Monitor the shared case for the next instruction", tone: "bg-neutral-100 text-neutral-700" },
  { status: "Under review", action: "Submit requested evidence, or monitor the review", tone: "bg-blue-50 text-blue-700" },
  { status: "Escalated", action: "Monitor the NoLSAF review, provide evidence if asked", tone: "bg-blue-50 text-blue-700" },
  { status: "Approved", action: "Stop affected operations and await refund reconciliation", tone: "bg-cyan-50 text-cyan-700" },
  { status: "Reconciliation required", action: "Verify the booking record and await NoLSAF reconciliation", tone: "bg-red-50 text-red-700" },
  { status: "Resolved / Closed", action: "No operator action required", tone: "bg-emerald-50 text-emerald-700" },
];

const FAQS = [
  { q: "Why can I not see a booking I expect?", a: "Stages are exclusive: a trip appears in exactly one. A trip you confirmed leaves New, and a locked checklist moves it straight to Completed regardless of its status label. Check the other stages under My bookings before assuming it is missing." },
  { q: "Why does a paid trip still show as New in revenues?", a: "A traveller paying does not open a payout claim. The record stays New until you submit one, then Claimed until NoLSAF verifies it. Customer payment status and payout status are separate chains." },
  { q: "My trip shows In Progress but I have not started.", a: "Pickup validation takes precedence over the status label. If pickup was validated against the booking, the trip reads as running even where the status still says confirmed." },
  { q: "What does a cancellation case need from me?", a: "Every row states its required action explicitly. Rows tinted red need reconciliation: the booking record and the case outcome disagree, and NoLSAF has to settle it." },
  { q: "How is my operator level decided?", a: "From tours delivered, revenue and rating together. Your dashboard surfaces the single most actionable gap toward the next level rather than all of them at once." },
];

function SectionHeading({
  icon: Icon,
  tone,
  eyebrow,
  title,
  description,
}: {
  icon: LucideIcon;
  tone: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4 text-white" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="m-0 text-[9px] font-bold uppercase tracking-[0.18em] text-neutral-400">{eyebrow}</p>
        <h2 className="m-0 mt-0.5 text-base font-bold text-neutral-900">{title}</h2>
        <p className="m-0 mt-0.5 text-xs text-neutral-500">{description}</p>
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={`whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 ${className}`}>
      {children}
    </th>
  );
}

export default function AgentHelpPage() {
  return (
    <div className="min-w-0 max-w-full pb-10">
      <header className="mb-6 overflow-hidden rounded-2xl border border-solid border-emerald-100 bg-[#f7fbf9] px-5 py-6 sm:px-8 sm:py-7">
        <p className="m-0 text-[10px] font-extrabold uppercase tracking-[0.28em] text-emerald-700">Operator guide</p>
        <h1 className="m-0 mt-1.5 text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          How the operator workspace works
        </h1>
        <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
          The rules behind every stage, status and payout state in this workspace, plus how to reach a person when
          something does not match what you see.
        </p>
      </header>

      <section className="mb-8">
        <SectionHeading
          icon={Sparkles}
          tone="bg-[#02665e]"
          eyebrow="Modules"
          title="What is in the workspace"
          description="One place for every part of running your trips."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {MODULES.map(({ icon: Icon, title, description, href }) => (
            <Link
              key={title}
              href={href}
              className="group min-w-0 rounded-xl border border-solid border-neutral-200 bg-white p-4 no-underline transition hover:border-emerald-200 hover:no-underline"
            >
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="mt-3 flex items-center gap-1 text-sm font-bold text-neutral-900">
                {title}
                <ArrowRight className="h-3 w-3 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
              </span>
              <span className="mt-1.5 block text-xs leading-5 text-neutral-500">{description}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionHeading
          icon={CalendarDays}
          tone="bg-blue-600"
          eyebrow="Reference"
          title="How a booking is placed into a stage"
          description="Rules are evaluated top to bottom, and the first match wins."
        />
        <div className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
          <TableScroller label="booking stage reference">
            <table className="w-full min-w-[52rem] border-collapse text-left">
              <thead className="bg-neutral-50/90 [&>tr>th]:shadow-[inset_0_-1px_0_0_#e5e5e5]">
                <tr>
                  <Th>Stage</Th>
                  <Th>What puts a trip here</Th>
                  <Th>Matching statuses</Th>
                  <Th>Worth knowing</Th>
                </tr>
              </thead>
              <tbody className="[&>tr>td]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>tr:last-child>td]:shadow-none">
                {BOOKING_STAGES.map((row, index) => (
                  <tr key={row.stage} className="transition hover:bg-emerald-50/35">
                    <td className="whitespace-nowrap px-4 py-3.5 align-top">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-4 shrink-0 text-[10px] font-bold tabular-nums text-neutral-300">{index + 1}</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${row.tone}`}>
                          {row.stage}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5 align-top text-xs font-semibold text-neutral-800">{row.trigger}</td>
                    <td className="px-4 py-3.5 align-top">
                      <code className="rounded bg-neutral-50 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600">{row.statuses}</code>
                    </td>
                    <td className="px-4 py-3.5 align-top text-xs leading-5 text-neutral-500">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </div>
        <Link href="/account/agent/bookings" className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 no-underline transition hover:gap-2.5 hover:no-underline">
          Go to my bookings <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </section>

      <section className="mb-8">
        <SectionHeading
          icon={Wallet2}
          tone="bg-emerald-700"
          eyebrow="State machine"
          title="How a payout moves from trip to bank"
          description="Each state and the single event that advances it."
        />
        <div className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
          <TableScroller label="payout state reference">
            <table className="w-full min-w-[46rem] border-collapse text-left">
              <thead className="bg-neutral-50/90 [&>tr>th]:shadow-[inset_0_-1px_0_0_#e5e5e5]">
                <tr>
                  <Th>State</Th>
                  <Th>What it means</Th>
                  <Th>What advances it</Th>
                </tr>
              </thead>
              <tbody className="[&>tr>td]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>tr:last-child>td]:shadow-none">
                {PAYOUT_STAGES.map((row) => (
                  <tr key={row.stage} className="transition hover:bg-emerald-50/35">
                    <td className="whitespace-nowrap px-4 py-3.5 align-top">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${row.tone}`}>
                        {row.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 align-top text-xs font-semibold text-neutral-800">{row.meaning}</td>
                    <td className="px-4 py-3.5 align-top text-xs leading-5 text-neutral-500">{row.advance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/account/agent/revenues" className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 no-underline transition hover:gap-2.5 hover:no-underline">
            Go to my revenues <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <p className="m-0 inline-flex items-center gap-1.5 text-[11px] text-neutral-400">
            <Activity className="h-3.5 w-3.5" aria-hidden />
            A claim is only possible once the trip reaches Completed.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <SectionHeading
          icon={MessagesSquare}
          tone="bg-neutral-700"
          eyebrow="Reference"
          title="What each cancellation case asks of you"
          description="The required action stated on every row, by case status."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {CASE_ACTIONS.map((row) => (
            <div key={row.status} className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white p-4">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${row.tone}`}>
                {row.status}
              </span>
              <p className="m-0 mt-2.5 text-xs leading-5 text-neutral-600">{row.action}</p>
            </div>
          ))}
        </div>
        <Link href="/account/agent/cancellations" className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 no-underline transition hover:gap-2.5 hover:no-underline">
          Go to cancellation cases <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </section>

      <section className="mb-8">
        <SectionHeading
          icon={FileText}
          tone="bg-neutral-700"
          eyebrow="Troubleshooting"
          title="When the workspace does not show what you expect"
          description="The mismatches operators hit most, and why they happen."
        />
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {FAQS.map(({ q, a }) => (
            <div key={q} className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white p-4">
              <p className="m-0 flex items-start gap-2 text-sm font-semibold text-neutral-900">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                {q}
              </p>
              <p className="m-0 mt-1.5 text-xs leading-5 text-neutral-500">{a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5 sm:p-6">
        <SectionHeading
          icon={Headset}
          tone="bg-[#02b4f5]"
          eyebrow="Support"
          title="Still need a hand?"
          description="Reach a real person for anything this guide did not cover."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <a href="https://wa.me/255736766726" target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 rounded-xl border border-solid border-neutral-200 bg-white p-4 no-underline transition hover:border-emerald-300 hover:no-underline">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 transition group-hover:bg-emerald-600">
              <MessageCircle className="h-4 w-4 text-emerald-600 transition group-hover:text-white" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold text-neutral-900">WhatsApp</span>
              <span className="block text-[11px] text-neutral-500">Fastest way to reach us</span>
            </span>
          </a>
          <a href={`tel:${process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255736766726"}`} className="group flex items-center gap-3 rounded-xl border border-solid border-neutral-200 bg-white p-4 no-underline transition hover:border-[#02b4f5]/40 hover:no-underline">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#02b4f5]/10 transition group-hover:bg-[#02b4f5]">
              <Phone className="h-4 w-4 text-[#02b4f5] transition group-hover:text-white" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold text-neutral-900">Call us</span>
              <span className="block text-[11px] text-neutral-500">{process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255 736 766 726"}</span>
            </span>
          </a>
          <a href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@nolsaf.com"}`} className="group flex items-center gap-3 rounded-xl border border-solid border-neutral-200 bg-white p-4 no-underline transition hover:border-neutral-300 hover:no-underline">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100 transition group-hover:bg-neutral-700">
              <Mail className="h-4 w-4 text-neutral-600 transition group-hover:text-white" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold text-neutral-900">Email us</span>
              <span className="block text-[11px] text-neutral-500">Replies within 24 hours</span>
            </span>
          </a>
        </div>
      </section>
    </div>
  );
}
