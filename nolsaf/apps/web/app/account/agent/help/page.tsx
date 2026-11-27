"use client";

// In-workspace help for the tour-agent portal, the analogue of
// /owner/nrms/help. The footer used to link to /help?ctx=agent, which navigated
// out to the public help page and dropped the operator out of the workspace.
//
// The reference tables below are transcribed from the resolvers that actually
// classify records, not written from memory: bucketForStatus in the bookings
// page, normalizedInvoiceStage/trackerStage in revenues, and the requiredAction
// ladder in the cancellations page. Payout timing follows
// api/src/lib/tourPayoutPolicy.ts. Change a resolver, change the table.
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronDown,
  FileText,
  HelpCircle,
  Mail,
  MessageCircle,
  MessagesSquare,
  Phone,
  ShieldCheck,
  TrendingUp,
  Wallet2,
  type LucideIcon,
} from "lucide-react";
import TableScroller from "@/components/TableScroller";

const MODULES: Array<{ icon: LucideIcon; title: string; description: string; href: string }> = [
  { icon: CalendarDays, title: "Bookings", description: "Trips grouped as New, Confirmed, In progress and Completed.", href: "/account/agent/bookings" },
  { icon: MessagesSquare, title: "Cancellation cases", description: "Traveller requests that need your response, evidence or awareness.", href: "/account/agent/cancellations" },
  { icon: TrendingUp, title: "Revenues and payouts", description: "Your share per trip, advances, balances and every claim's stage.", href: "/account/agent/revenues" },
  { icon: BarChart3, title: "Reports", description: "Activity across any date range, ready to print.", href: "/account/agent/reports" },
  { icon: FileText, title: "Profile and documents", description: "Your public profile, packages, documents and partnership agreement.", href: "/account/agent/profile" },
  { icon: ShieldCheck, title: "Security", description: "Password, two-step verification, passkeys and sign-in history.", href: "/account/agent/security" },
];

// Precedence matters: the first matching rule wins, top to bottom.
const BOOKING_STAGES = [
  { stage: "Completed", tone: "bg-emerald-50 text-emerald-800 border-emerald-200", trigger: "Checklist locked, or a completion time recorded", statuses: "COMPLETE*, DONE*, CLOSED*", note: "Checked first, so a locked checklist completes a trip whatever its status says." },
  { stage: "Cancelled", tone: "bg-red-50 text-red-700 border-red-200", trigger: "Status shows a cancellation, rejection or refund", statuses: "CANCEL*, REJECT*, REFUND*", note: "Not a stage tab. These trips leave the four working queues." },
  { stage: "In progress", tone: "bg-amber-50 text-amber-800 border-amber-200", trigger: "Pickup has been validated", statuses: "PROGRESS*, ONGOING*, ACTIVE*", note: "A validated pickup wins over the status, so a trip in the field reads as running." },
  { stage: "Confirmed", tone: "bg-sky-50 text-sky-800 border-sky-200", trigger: "Payment settled or the booking accepted", statuses: "PAID, CONFIRM*, ACCEPT*", note: "Confirmed trips feed the today and this-week counters above the queue." },
  { stage: "New", tone: "bg-neutral-100 text-neutral-700 border-neutral-200", trigger: "Nothing above matched; the trip awaits review", statuses: "NEW*, PENDING*, ASSIGN*, PENDING_PAYMENT, empty", note: "The default stage, and where the sidebar opens with no stage chosen." },
];

const PAYOUT_STAGES = [
  { stage: "New", tone: "border-neutral-300 bg-white text-neutral-700", meaning: "Money you can claim, with no claim opened yet.", next: "You submit a claim." },
  { stage: "Claimed", tone: "border-indigo-300 bg-indigo-50 text-indigo-800", meaning: "You asked to be paid; an invoice number is issued.", next: "NoLSAF checks it against the trip." },
  { stage: "Verified", tone: "border-amber-300 bg-amber-50 text-amber-800", meaning: "NoLSAF confirmed the claim matches the record.", next: "NoLSAF approves it for payment." },
  { stage: "Approved", tone: "border-cyan-300 bg-cyan-50 text-cyan-800", meaning: "Cleared for payment.", next: "Money is sent to your payout account." },
  { stage: "Disbursed", tone: "border-emerald-300 bg-emerald-50 text-emerald-800", meaning: "Paid. The invoice is closed.", next: "Nothing more to do." },
];

const CASE_ACTIONS = [
  { status: "Awaiting receipt", action: "Open the case and confirm you received it.", tone: "bg-amber-50 text-amber-800", urgent: true },
  { status: "Open / eligible", action: "Open it and acknowledge the traveller's request.", tone: "bg-amber-50 text-amber-800", urgent: true },
  { status: "Under review", action: "Send any evidence NoLSAF asks for, otherwise follow the review.", tone: "bg-sky-50 text-sky-800", urgent: false },
  { status: "Escalated", action: "Follow the NoLSAF review and send evidence if asked.", tone: "bg-sky-50 text-sky-800", urgent: false },
  { status: "Acknowledged", action: "Watch the case for the next instruction.", tone: "bg-neutral-100 text-neutral-700", urgent: false },
  { status: "Approved", action: "Stop the affected services and wait for the refund to be settled.", tone: "bg-cyan-50 text-cyan-800", urgent: true },
  { status: "Reconciliation required", action: "Check the booking record; NoLSAF settles the difference.", tone: "bg-red-50 text-red-700", urgent: true },
  { status: "Resolved / closed", action: "Nothing for you to do.", tone: "bg-emerald-50 text-emerald-800", urgent: false },
];

const FAQS = [
  { q: "Why can I not see a booking I expect?", a: "A trip sits in exactly one stage. A trip you confirmed leaves New, and a locked checklist moves it straight to Completed whatever its status says. Check the other stages under Bookings before assuming it is missing." },
  { q: "The traveller paid. Why is nothing paid to me yet?", a: "A traveller's payment does not open a payout claim. Before the trip you can claim an advance from 7 days before departure; after the trip you claim the balance. Each claim then moves through Claimed, Verified, Approved and Disbursed." },
  { q: "Why can I not claim an advance?", a: "Advances need Silver level or above, a verified payout account and no unpaid recovery. They open 7 days before departure, never in the first 24 hours after the traveller paid, and pause while a case is open on the trip." },
  { q: "My trip shows In progress but I have not started.", a: "A validated pickup wins over the status. If pickup was validated on the booking, the trip reads as running even when the status still says confirmed." },
  { q: "What does a cancellation case need from me?", a: "Every case states its required action. Cases marked red need reconciliation: the booking record and the case outcome disagree, and NoLSAF settles it." },
  { q: "How is my operator level decided?", a: "From tours delivered, the commission they earned NoLSAF and your rating together. Your dashboard shows the single most useful step toward the next level." },
];

const SECTIONS = [
  { id: "workspace", label: "Workspace" },
  { id: "payouts", label: "Getting paid" },
  { id: "bookings", label: "Booking stages" },
  { id: "cases", label: "Cases" },
  { id: "questions", label: "Questions" },
  { id: "support", label: "Support" },
];

const card = "rounded-lg border border-solid border-neutral-200 bg-white";

function SectionHeading({ id, icon: Icon, title, description, href, hrefLabel }: { id: string; icon: LucideIcon; title: string; description: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id={id} className="m-0 scroll-mt-24 text-[16px] font-semibold text-neutral-900">{title}</h2>
          <p className="m-0 mt-0.5 text-[13px] leading-5 text-neutral-500">{description}</p>
        </div>
      </div>
      {href ? (
        <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700 no-underline hover:underline">
          {hrefLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-4 py-2.5 text-left text-[12px] font-medium text-neutral-500">{children}</th>;
}

export default function AgentHelpPage() {
  return (
    <div className="min-w-0 max-w-full space-y-8 pb-10">
      <header className="overflow-hidden rounded-lg bg-[#012a26] text-white">
        <div className="flex items-start gap-4 px-5 pb-5 pt-6 sm:px-8">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-white/[0.08] text-[#5eead4] ring-1 ring-inset ring-white/10">
            <BookOpen className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[12.5px] font-medium text-[#5eead4]">Help and guide</p>
            <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight sm:text-[28px]">How your workspace works</h1>
            <p className="m-0 mt-1.5 max-w-2xl text-sm leading-6 text-white/65">
              What every stage, status and payout step means, how you get paid, and how to reach a person when something does not match.
            </p>
          </div>
        </div>
        <nav aria-label="Guide sections" className="flex gap-1 overflow-x-auto px-4 pb-3 sm:px-6">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex h-9 shrink-0 items-center rounded-md px-3 text-[13px] font-medium text-white/70 no-underline transition hover:bg-white/[0.08] hover:text-white">
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      {/* Workspace */}
      <section>
        <SectionHeading id="workspace" icon={HelpCircle} title="What is in your workspace" description="Each area and what it is for." />
        <div className={`${card} grid overflow-hidden sm:grid-cols-2 xl:grid-cols-3`}>
          {MODULES.map(({ icon: Icon, title, description, href }, i) => (
            <Link
              key={title}
              href={href}
              className={`group flex min-w-0 items-start gap-3 p-4 no-underline transition hover:bg-emerald-50/50 hover:no-underline ${i ? "border-0 border-t border-solid border-neutral-100" : ""} sm:[&:nth-child(2)]:border-t-0 xl:[&:nth-child(3)]:border-t-0`}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-solid border-neutral-200 bg-white text-emerald-700">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[14px] font-semibold text-neutral-900">
                  {title}
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-5 text-neutral-500">{description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Payouts */}
      <section>
        <SectionHeading
          id="payouts"
          icon={Wallet2}
          title="How you get paid"
          description="Your share is your full package price. The NoLSAF commission is added on top and paid by the traveller."
          href="/account/agent/revenues"
          hrefLabel="Go to revenues"
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <div className={`${card} p-4`}>
            <p className="m-0 text-[12px] font-medium text-emerald-700">Before the trip</p>
            <p className="m-0 mt-0.5 text-[15px] font-semibold text-neutral-900">Advance, up to 70%</p>
            <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[13px] leading-5 text-neutral-600">
              <li>Opens 7 days before departure, never in the first 24 hours after the traveller paid.</li>
              <li>Up to 30% with no paperwork, or up to 70% with supplier receipts.</li>
              <li>Inside the last 96 hours, up to 70% with no receipts.</li>
              <li>Needs Silver level or above, a verified payout account and no unpaid recovery.</li>
            </ul>
          </div>
          <div className={`${card} p-4`}>
            <p className="m-0 text-[12px] font-medium text-emerald-700">After the trip</p>
            <p className="m-0 mt-0.5 text-[15px] font-semibold text-neutral-900">Balance, the rest of your share</p>
            <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[13px] leading-5 text-neutral-600">
              <li>Your share minus every advance already paid.</li>
              <li>Claim it once the traveller confirms the trip, or automatically 48 hours after the later of finishing the timetable and the trip&apos;s last day.</li>
              <li>Paid within 24 hours to 3 days of the claim, to your verified payout account.</li>
              <li>An open case on the trip pauses new payments until it is settled.</li>
            </ul>
          </div>
        </div>

        {/* Every claim, advance or balance, takes the same path. */}
        <div className={`${card} mt-3 p-4`}>
          <p className="m-0 text-[13px] font-semibold text-neutral-900">Every claim moves through five steps</p>
          <ol className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-5">
            {PAYOUT_STAGES.map((row, i) => (
              <li key={row.stage} className="relative min-w-0">
                <div className={`rounded-md border border-solid px-3 py-2.5 ${row.tone}`}>
                  <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold">
                    <span className="text-[11px] tabular-nums opacity-60">{i + 1}</span>
                    {row.stage}
                  </p>
                  <p className="m-0 mt-1 text-[12px] leading-5 text-neutral-700">{row.meaning}</p>
                </div>
                <p className="m-0 mt-1 px-1 text-[11.5px] leading-4 text-neutral-500">Next: {row.next}</p>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-3 border-0 border-t border-solid border-neutral-100 pt-3 text-[12.5px] text-neutral-600">
            <span className="font-semibold text-red-700">Rejected</span> can happen at any step, with a reason. Fix what it names, then claim again. The full rules are in the{" "}
            <Link href="/tour-operator-disbursement-policy" className="font-medium text-emerald-700 no-underline hover:underline">Disbursement Policy</Link>.
          </p>
        </div>
      </section>

      {/* Bookings */}
      <section>
        <SectionHeading
          id="bookings"
          icon={CalendarDays}
          title="How a booking is placed in a stage"
          description="Rules are checked top to bottom; the first one that matches wins."
          href="/account/agent/bookings"
          hrefLabel="Go to bookings"
        />
        <div className={`${card} overflow-hidden`}>
          <TableScroller label="booking stage reference">
            <table className="w-full min-w-[48rem] border-collapse text-left">
              <thead className="bg-neutral-50">
                <tr>
                  <Th>Order and stage</Th>
                  <Th>What puts a trip here</Th>
                  <Th>Matching statuses</Th>
                  <Th>Worth knowing</Th>
                </tr>
              </thead>
              <tbody>
                {BOOKING_STAGES.map((row, index) => (
                  <tr key={row.stage} className="[&>td]:border-0 [&>td]:border-b [&>td]:border-solid [&>td]:border-neutral-100 last:[&>td]:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 align-top">
                      <span className="inline-flex items-center gap-2">
                        <span className="grid h-5 w-5 place-items-center rounded bg-neutral-100 text-[11px] font-semibold tabular-nums text-neutral-500">{index + 1}</span>
                        <span className={`inline-flex rounded border border-solid px-2 py-0.5 text-[12px] font-semibold ${row.tone}`}>{row.stage}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-[13px] font-medium text-neutral-800">{row.trigger}</td>
                    <td className="px-4 py-3 align-top">
                      <code className="rounded bg-neutral-50 px-1.5 py-0.5 font-mono text-[11.5px] text-neutral-600">{row.statuses}</code>
                    </td>
                    <td className="px-4 py-3 align-top text-[12.5px] leading-5 text-neutral-500">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </div>
      </section>

      {/* Cases */}
      <section>
        <SectionHeading
          id="cases"
          icon={MessagesSquare}
          title="What each case asks of you"
          description="The action every cancellation case status expects. Marked ones need you now."
          href="/account/agent/cancellations"
          hrefLabel="Go to cases"
        />
        <ul className={`${card} m-0 grid list-none overflow-hidden p-0 md:grid-cols-2`}>
          {CASE_ACTIONS.map((row, i) => (
            <li
              key={row.status}
              className={`flex items-start gap-3 px-4 py-3 ${i ? "border-0 border-t border-solid border-neutral-100" : ""} md:[&:nth-child(2)]:border-t-0 ${i % 2 ? "md:border-l md:border-solid md:border-neutral-100" : ""}`}
            >
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${row.urgent ? "bg-amber-500" : "bg-neutral-300"}`} aria-hidden />
              <div className="min-w-0">
                <span className={`inline-flex rounded px-1.5 py-0.5 text-[12px] font-semibold ${row.tone}`}>{row.status}</span>
                <p className="m-0 mt-1 text-[13px] leading-5 text-neutral-600">{row.action}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Questions */}
      <section>
        <SectionHeading id="questions" icon={HelpCircle} title="When something does not look right" description="The questions operators ask most, and why it happens." />
        <div className={`${card} divide-y divide-solid divide-neutral-100 overflow-hidden`}>
          {FAQS.map(({ q, a }) => (
            <details key={q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[14px] font-medium text-neutral-900 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400 transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="m-0 px-4 pb-4 text-[13px] leading-6 text-neutral-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Support */}
      <section>
        <SectionHeading id="support" icon={Phone} title="Talk to a person" description="For anything this guide does not answer." />
        <div className={`${card} grid overflow-hidden sm:grid-cols-3`}>
          {[
            { href: "https://wa.me/255736766726", external: true, Icon: MessageCircle, title: "WhatsApp", body: "Fastest way to reach us" },
            { href: `tel:${process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255736766726"}`, external: false, Icon: Phone, title: "Call us", body: process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255 736 766 726" },
            { href: `mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@nolsaf.com"}`, external: false, Icon: Mail, title: "Email us", body: "Replies within 24 hours" },
          ].map(({ href, external, Icon, title, body }, i) => (
            <a
              key={title}
              href={href}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className={`group flex items-center gap-3 p-4 no-underline transition hover:bg-emerald-50/50 hover:no-underline ${i ? "border-0 border-t border-solid border-neutral-100 sm:border-l sm:border-t-0" : ""}`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-700 group-hover:text-white">
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-neutral-900">{title}</span>
                <span className="block text-[12.5px] text-neutral-500">{body}</span>
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
