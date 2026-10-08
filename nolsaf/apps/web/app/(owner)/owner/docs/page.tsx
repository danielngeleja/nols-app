"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BedDouble,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  CreditCard,
  DoorOpen,
  FileText,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";

/**
 * Owner guide: the handbook for running a property on NoLSAF. Support answers
 * single questions; this page explains each job end to end, the statuses an
 * owner sees, and the rules behind them. Every guide links to the page where
 * the job is done.
 */

type ChapterKey = "start" | "desk" | "rooms" | "money" | "account";
type Guide = {
  id: string;
  chapter: ChapterKey;
  title: string;
  summary: string;
  minutes: number;
  steps: string[];
  tip?: string;
  href: string;
  cta: string;
};

const CHAPTERS: { key: ChapterKey; label: string; blurb: string; Icon: typeof BookOpen }[] = [
  { key: "start", label: "Getting started", blurb: "List a property and get it live", Icon: Sparkles },
  { key: "desk", label: "Front desk", blurb: "Arrivals, codes and departures", Icon: DoorOpen },
  { key: "rooms", label: "Rooms and availability", blurb: "Floors, blocks and the calendar", Icon: LayoutGrid },
  { key: "money", label: "Money", blurb: "Payouts, fees and receipts", Icon: Wallet },
  { key: "account", label: "Account and safety", blurb: "Payout account and policies", Icon: ShieldCheck },
];

const GUIDES: Guide[] = [
  // Getting started
  {
    id: "add-property",
    chapter: "start",
    title: "Add a new property",
    summary: "Create the listing, add rooms and photos, and send it for review.",
    minutes: 6,
    steps: [
      "Open Add a property from the New button or the sidebar",
      "Fill in the basics: name, type, location and a short description",
      "Add each room type with its price, beds, amenities and how many rooms you have",
      "Set how many floors the building has and which floor each room type is on",
      "Upload clear photos: the outside, every room type and the bathroom",
      "Submit for review. You can save a draft and come back at any time",
    ],
    tip: "Good photos and complete room details are the most common reason a listing is approved on the first review.",
    href: "/owner/properties/add",
    cta: "Add a property",
  },
  {
    id: "approval",
    chapter: "start",
    title: "How approval works",
    summary: "What happens after you submit, and what each listing status means.",
    minutes: 3,
    steps: [
      "Draft: saved by you, not yet sent. Only you can see it",
      "Awaiting approval: sent to NoLSAF. The team checks details, photos and location, usually within 1 to 2 business days",
      "Approved: live on NoLSAF and open for bookings",
      "Needs changes: the team explains what to fix. Edit it and submit again",
    ],
    tip: "You are notified at every step, so there is no need to keep checking.",
    href: "/owner/properties/pending",
    cta: "Awaiting approval",
  },
  {
    id: "payout-account-first",
    chapter: "start",
    title: "Set up where you get paid",
    summary: "Add the mobile money or bank account your payouts go to, before your first guest.",
    minutes: 3,
    steps: [
      "Open My Payouts, then Payout account",
      "Add your mobile money number or bank account in your own name",
      "Wait for it to be verified. Payouts are only ever sent to a verified account",
    ],
    href: "/owner/payouts/account",
    cta: "Payout account",
  },
  // Front desk
  {
    id: "check-in",
    chapter: "desk",
    title: "Check a guest in",
    summary: "Confirm the guest with their booking code, the way that releases your payout.",
    minutes: 2,
    steps: [
      "Open Check in a guest",
      "Type the guest's 8 character code, or scan the QR on their receipt",
      "Read the arrival pass: compare the name and phone with the person in front of you",
      "Tick the NoLSAF Disbursement Policy",
      "Press Confirm check-in. The guest moves to Guests in house",
    ],
    tip: "After 3 wrong codes in a row, entry pauses for 5 minutes. 0 and O, 1 and I, 5 and S are easy to mix up.",
    href: "/owner/bookings/validate",
    cta: "Check in a guest",
  },
  {
    id: "lost-code",
    chapter: "desk",
    title: "When a guest lost their code",
    summary: "NoLSAF sends the code to the guest's own phone. You never see it.",
    minutes: 2,
    steps: [
      "On Check in a guest, tap Guest lost their code?",
      "Pick the arriving guest from the list",
      "Press Send code to guest. It goes by SMS to the phone on the booking",
      "Ask the guest to read the code to you, then check them in as usual",
    ],
    tip: "If the guest's phone matches yours, or no phone works, the request goes to the NoLSAF team, who confirm the guest and tell you the outcome.",
    href: "/owner/bookings/validate",
    cta: "Open check-in",
  },
  {
    id: "late-arrival",
    chapter: "desk",
    title: "Late arrivals",
    summary: "A guest who misses the first night can still check in.",
    minutes: 1,
    steps: [
      "A code works from the check-in day up to and including the check-out day, in Tanzania time",
      "Check the guest in on the day they arrive. Nothing extra is needed",
      "The room stays held for them for the whole booking, including the missed night",
      "After the check-out day the code no longer works",
    ],
    href: "/owner/bookings?tab=waiting",
    cta: "Awaiting arrivals",
  },
  {
    id: "nrms-room",
    chapter: "desk",
    title: "Properties that run NRMS",
    summary: "Each booked room needs a room number before check-in.",
    minutes: 2,
    steps: [
      "Check in a guest shows Assign a room first when a room number is missing",
      "Tap Assign the room. It opens the guest's stay in NRMS with the room picker",
      "Choose the room, return to the pass and tap I assigned it",
      "Confirm check-in. The code is only used once check-in succeeds",
    ],
    href: "/owner/nrms",
    cta: "Open NRMS",
  },
  {
    id: "check-out",
    chapter: "desk",
    title: "Check a guest out",
    summary: "Close the stay once the guest has left.",
    minutes: 1,
    steps: [
      "Open Departures. Guests appear as their check-out time gets close",
      "Confirm check-out after the guest has left and rate the stay",
      "Past stays move to Check-out history",
    ],
    tip: "If your property runs NRMS, check the guest out in NRMS so the folio is settled there.",
    href: "/owner/bookings/check-out",
    cta: "Open Departures",
  },
  // Rooms
  {
    id: "availability",
    chapter: "rooms",
    title: "Read the room availability board",
    summary: "Every room by floor, with who is in it and what is free.",
    minutes: 3,
    steps: [
      "Open Room availability and pick a property",
      "Choose the dates at the top. The board shows each floor and each room",
      "Colours show the room type; the pill on each room shows free, booked or blocked",
      "The calendar below lists NoLSAF bookings, NRMS stays and outside bookings by day",
    ],
    href: "/owner/properties/availability",
    cta: "Room availability",
  },
  {
    id: "block-room",
    chapter: "rooms",
    title: "Block a room booked outside NoLSAF",
    summary: "Stop double bookings from walk-ins, Airbnb or Booking.com.",
    minutes: 2,
    steps: [
      "On the rooms by floor board, tap the room",
      "Press Block this room",
      "Add the guest name, dates and where the booking came from",
      "Save. The room stops selling on NoLSAF for those nights",
    ],
    href: "/owner/properties/availability",
    cta: "Block a room",
  },
  {
    id: "floor-plan",
    chapter: "rooms",
    title: "Keep the floor plan right",
    summary: "The plan is built from your room types and floors.",
    minutes: 2,
    steps: [
      "Edit the property to change rooms or the floor each room type is on",
      "Open the floor plan from Room availability",
      "Press Rebuild plan. Bookings and blocks are kept; only room positions change",
    ],
    href: "/owner/properties/availability",
    cta: "Open a floor plan",
  },
  // Money
  {
    id: "payouts",
    chapter: "money",
    title: "How you get paid",
    summary: "From check-in to money in your account, step by step.",
    minutes: 4,
    steps: [
      "Check the guest in with their code. This starts the payout for that stay",
      "The payout unlocks once the check-in and the guest's payment are both confirmed",
      "When it shows Ready, tap Withdraw on My Payouts and enter the one-time code sent to your phone",
      "Sending: NoLSAF pays your verified payout account",
      "Paid: the receipt is under History, with a code anyone can scan to verify it",
    ],
    tip: "Forgot to withdraw? You get a reminder, and an unclaimed payout is sent to your verified account for you after 14 days.",
    href: "/owner/payouts",
    cta: "My Payouts",
  },
  {
    id: "auto-or-review",
    chapter: "money",
    title: "Automatic or reviewed payouts",
    summary: "Why most payouts go straight through and some wait for a person.",
    minutes: 2,
    steps: [
      "Your first payout is checked by the NoLSAF team once",
      "After that, payouts within the daily limit are sent automatically",
      "Anything unusual, or a payout while an earlier refund is being recovered, goes to a short review and shows Under review",
    ],
    href: "/owner/payouts/in-progress",
    cta: "Payouts in progress",
  },
  {
    id: "fees",
    chapter: "money",
    title: "The NoLSAF fee",
    summary: "Your room rate is your payout. The fee is added on top for the guest.",
    minutes: 1,
    steps: [
      "You set the room rate in your listing",
      "NoLSAF adds its fee on top of that rate in the price the guest pays",
      "Your payout is your full room rate. Transport, when booked, is not part of it",
    ],
    href: "/owner/reports/revenue",
    cta: "Revenue reports",
  },
  {
    id: "holds",
    chapter: "money",
    title: "Holds, refunds and recoveries",
    summary: "What pauses a payout, and what happens after a refund.",
    minutes: 2,
    steps: [
      "On hold means something needs checking first, such as a cancellation or a refund. The reason is shown on the payout",
      "It moves on by itself once the check clears",
      "If a stay is refunded after you were paid, your share comes off your next payouts, never from your account directly",
      "Each receipt shows any amount deducted",
    ],
    href: "/owner/payouts",
    cta: "My Payouts",
  },
  {
    id: "older-claims",
    chapter: "money",
    title: "Older invoice claims",
    summary: "Stays from before the new payout flow are claimed with an invoice.",
    minutes: 2,
    steps: [
      "Open My Payouts, Older claims",
      "Create the invoice for the stay and send it to NoLSAF",
      "It moves through Verified, Approved and Paid. Download the invoice or receipt as a PDF at any time",
    ],
    href: "/owner/payouts/older-claims",
    cta: "Older claims",
  },
  // Account
  {
    id: "payout-account",
    chapter: "account",
    title: "Change your payout account",
    summary: "Safely move payouts to a different number or bank.",
    minutes: 2,
    steps: [
      "Open My Payouts, Payout account and add the new account",
      "It must be verified before money can go to it",
      "For your safety, payouts can pause briefly after a change",
    ],
    href: "/owner/payouts/account",
    cta: "Payout account",
  },
  {
    id: "policies",
    chapter: "account",
    title: "Policies you agree to",
    summary: "The rules behind payouts, cancellations and verification.",
    minutes: 3,
    steps: [
      "The Disbursement Policy covers payout timing, holds, recoveries and limits. You agree to it at each check-in",
      "The Cancellation Policy covers what happens when a guest cancels",
      "The Verification Policy covers how NoLSAF confirms owners and properties",
    ],
    href: "/owner/property-owner-disbursement-policy",
    cta: "Read the policy",
  },
];

const BOOKING_STATUSES = [
  { label: "Awaiting arrival", dot: "bg-amber-500", body: "Paid and confirmed. The guest has not checked in yet." },
  { label: "Checked in", dot: "bg-emerald-500", body: "Confirmed with the guest's code. The guest is in house." },
  { label: "Checked out", dot: "bg-slate-500", body: "The stay is closed." },
  { label: "Cancelled", dot: "bg-rose-500", body: "The booking was cancelled and cannot be checked in." },
];

const PAYOUT_STATUSES = [
  { label: "Unlocking", body: "Waiting for the stay to unlock." },
  { label: "Waiting", body: "Waiting on the guest payment, the guest check-in alert or your payout account." },
  { label: "Ready", body: "Tap Withdraw." },
  { label: "Sending", body: "Withdrawn and on its way to your account." },
  { label: "Under review", body: "With the NoLSAF payments team for a quick check." },
  { label: "On hold", body: "Paused while something is checked. The reason is shown." },
  { label: "Paid", body: "Sent. Your receipt is ready." },
  { label: "Settled", body: "Used in full to cover an earlier refund. Nothing was sent." },
];

const RULES = [
  { Icon: Clock3, title: "Tanzania time", body: "Every date and time is East Africa Time (EAT)." },
  { Icon: KeyRound, title: "Codes have a window", body: "A booking code works from the check-in day to the check-out day." },
  { Icon: ShieldCheck, title: "3 tries, then a pause", body: "Three wrong codes pause entry for 5 minutes." },
  { Icon: Wallet, title: "Check-in starts the payout", body: "No confirmed check-in, no payout for that stay." },
  { Icon: CreditCard, title: "Verified accounts only", body: "Money only goes to a payout account in your name that is verified." },
  { Icon: FileText, title: "You never see guest codes", body: "Resent codes go only to the guest's booking phone." },
];

const GLOSSARY = [
  { term: "Booking code", body: "The 8 character code the guest receives after paying. It proves they are the guest." },
  { term: "Arrival pass", body: "What you see after entering a code: who the guest is and whether check-in is open today." },
  { term: "NRMS", body: "NoLSAF's property management system for front desk, rooms, folios and outlets." },
  { term: "Block", body: "A room marked taken for an outside booking, so NoLSAF does not sell it." },
  { term: "One-time code", body: "The SMS code that confirms a withdrawal is really from you." },
  { term: "Folio", body: "The guest's bill in NRMS: room, extras and payments." },
];

export default function OwnerDocsPage() {
  const [query, setQuery] = useState("");
  const [chapter, setChapter] = useState<ChapterKey | "all">("all");
  const [open, setOpen] = useState<string | null>("check-in");

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      GUIDES.filter((guide) => (chapter === "all" || guide.chapter === chapter) &&
        (!q || `${guide.title} ${guide.summary} ${guide.steps.join(" ")} ${guide.tip ?? ""}`.toLowerCase().includes(q))),
    [chapter, q],
  );
  const glossary = GLOSSARY.filter((g) => !q || `${g.term} ${g.body}`.toLowerCase().includes(q));
  const totalMinutes = GUIDES.reduce((sum, guide) => sum + guide.minutes, 0);

  return (
    <div id="owner-guide" className="w-full min-w-0 space-y-6 px-3 pb-12 sm:px-5 lg:px-6">
      <style>{`:where(#owner-guide, #owner-guide *) { box-sizing: border-box; }`}</style>

      {/* Header band */}
      <header className="overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div className="grid gap-6 px-5 pb-6 pt-6 sm:px-8 sm:pt-7 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#5eead4]">
              <BookOpen className="h-3.5 w-3.5" aria-hidden /> Owner guide
            </p>
            <h1 className="m-0 mt-2 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[34px]">Run your property on NoLSAF</h1>
            <p className="m-0 mt-2 max-w-xl text-sm leading-6 text-white/60">
              Step by step guides for every job, from listing a property to checking guests in and getting paid. {GUIDES.length} guides, about {totalMinutes} minutes in all.
            </p>
            <label className="relative mt-5 block max-w-xl">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the guide: lost code, withdraw, block a room"
                aria-label="Search the owner guide"
                className="h-12 w-full rounded-2xl border border-solid border-white/15 bg-white/[0.07] pl-11 pr-11 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#5eead4]/60 focus:bg-white/[0.1]"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border-0 bg-white/10 text-white/70 hover:bg-white/20">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
          </div>

          {/* The owner journey */}
          <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0">
            {[
              { n: 1, label: "List your property", href: "/owner/properties/add", Icon: Building2 },
              { n: 2, label: "Get approved", href: "/owner/properties/pending", Icon: Check },
              { n: 3, label: "Check guests in", href: "/owner/bookings/validate", Icon: DoorOpen },
              { n: 4, label: "Get paid", href: "/owner/payouts", Icon: Wallet },
            ].map((step) => (
              <li key={step.n}>
                <Link href={step.href} className="group flex h-full items-center gap-3 rounded-2xl bg-white/[0.05] px-3.5 py-3 no-underline ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.1]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#5eead4] text-[#012a26]"><step.Icon className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45">Step {step.n}</span>
                    <span className="block truncate text-sm font-semibold text-white">{step.label}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:items-start">
        {/* Chapters */}
        <nav aria-label="Guide chapters" className="lg:sticky lg:top-24">
          <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0 lg:flex-col lg:gap-1 lg:overflow-visible">
            {[{ key: "all" as const, label: "All guides", blurb: `${GUIDES.length} guides`, Icon: BookOpen }, ...CHAPTERS].map((c) => {
              const active = chapter === c.key;
              const count = c.key === "all" ? GUIDES.length : GUIDES.filter((g) => g.chapter === c.key).length;
              return (
                <li key={c.key} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setChapter(c.key)}
                    aria-pressed={active}
                    className={`flex w-full items-center gap-3 rounded-xl border border-solid px-3 py-2.5 text-left transition ${active ? "border-[#02665e]/30 bg-emerald-50 text-[#02665e]" : "border-transparent bg-transparent text-slate-600 hover:bg-white hover:text-slate-900"}`}
                  >
                    <c.Icon className={`h-4 w-4 shrink-0 ${active ? "text-[#02665e]" : "text-slate-400"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-nowrap text-sm font-semibold">{c.label}</span>
                      <span className="hidden truncate text-[11px] text-slate-400 lg:block">{c.blurb}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 text-[11px] font-bold tabular-nums ${active ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {/* Guides */}
          <section aria-label="Guides" className="space-y-2.5">
            {matches.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center">
                <p className="m-0 text-sm font-bold text-slate-900">No guide matches &ldquo;{query}&rdquo;</p>
                <p className="m-0 mt-1 text-xs text-slate-500">Try another word, or ask the NoLSAF team.</p>
                <Link href="/owner/support" className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#02665e] px-4 text-xs font-bold text-white no-underline hover:bg-[#014d47]">
                  <LifeBuoy className="h-3.5 w-3.5" aria-hidden /> Get help
                </Link>
              </div>
            ) : (
              matches.map((guide) => {
                const expanded = open === guide.id || Boolean(q);
                const chapterMeta = CHAPTERS.find((c) => c.key === guide.chapter)!;
                return (
                  <article key={guide.id} className={`overflow-hidden rounded-2xl border border-solid bg-white transition ${expanded ? "border-[#02665e]/30 shadow-[0_14px_35px_-28px_rgba(1,42,38,0.6)]" : "border-slate-200"}`}>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded && !q ? null : guide.id)}
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-4 border-0 bg-transparent px-4 py-4 text-left sm:px-5"
                    >
                      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${expanded ? "bg-[#012a26] text-[#5eead4]" : "bg-slate-100 text-slate-600"}`}>
                        <chapterMeta.Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-bold text-slate-900">{guide.title}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{guide.summary}</span>
                      </span>
                      <span className="hidden shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-400 sm:inline-flex"><Clock3 className="h-3 w-3" aria-hidden />{guide.minutes} min</span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                    {expanded && (
                      <div className="border-0 border-t border-solid border-slate-100 px-4 pb-5 pt-4 sm:px-5 sm:pl-[84px]">
                        <ol className="m-0 list-none space-y-2.5 p-0">
                          {guide.steps.map((step, index) => (
                            <li key={index} className="flex gap-3">
                              <span className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-50 text-[11px] font-bold text-[#02665e] ring-1 ring-inset ring-emerald-200">{index + 1}</span>
                              <span className="text-sm leading-6 text-slate-700">{step}</span>
                            </li>
                          ))}
                        </ol>
                        {guide.tip && (
                          <p className="m-0 mt-4 flex items-start gap-2 rounded-xl bg-amber-50/70 px-3.5 py-2.5 text-xs leading-5 text-amber-900 ring-1 ring-inset ring-amber-200">
                            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                            {guide.tip}
                          </p>
                        )}
                        <Link href={guide.href} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-[#012a26] px-4 text-sm font-bold text-white no-underline transition hover:bg-[#033a34]">
                          {guide.cta} <ArrowRight className="h-4 w-4 text-[#5eead4]" aria-hidden />
                        </Link>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </section>

          {/* Rules to remember */}
          {!q && (
            <section aria-label="Rules to remember" className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
              <h2 className="m-0 text-base font-bold text-slate-900">Rules to remember</h2>
              <p className="m-0 mt-0.5 text-xs text-slate-500">The few things that explain most questions.</p>
              <ul className="m-0 mt-4 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {RULES.map((rule) => (
                  <li key={rule.title} className="flex gap-3 rounded-xl bg-slate-50 px-3.5 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-[#02665e] ring-1 ring-inset ring-slate-200"><rule.Icon className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{rule.title}</span>
                      <span className="block text-xs leading-5 text-slate-500">{rule.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Statuses */}
          {!q && (
            <section aria-label="Statuses at a glance" className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
                <h2 className="m-0 flex items-center gap-2 text-base font-bold text-slate-900"><BedDouble className="h-4 w-4 text-[#02665e]" aria-hidden /> Booking statuses</h2>
                <ul className="m-0 mt-3 list-none space-y-2 p-0">
                  {BOOKING_STATUSES.map((s) => (
                    <li key={s.label} className="flex items-start gap-3 rounded-xl px-1 py-1.5">
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">{s.label}</span>
                        <span className="block text-xs leading-5 text-slate-500">{s.body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
                <h2 className="m-0 flex items-center gap-2 text-base font-bold text-slate-900"><Wallet className="h-4 w-4 text-[#02665e]" aria-hidden /> Payout statuses</h2>
                <ol className="m-0 mt-3 list-none space-y-0 p-0">
                  {PAYOUT_STATUSES.map((s, index) => (
                    <li key={s.label} className="relative flex items-start gap-3 pb-3 last:pb-0">
                      {index < PAYOUT_STATUSES.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-18px)] w-px bg-slate-200" aria-hidden />}
                      <span className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#012a26] text-[10.5px] font-bold text-[#5eead4]">{index + 1}</span>
                      <span className="min-w-0 pt-0.5">
                        <span className="block text-sm font-semibold text-slate-900">{s.label}</span>
                        <span className="block text-xs leading-5 text-slate-500">{s.body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          )}

          {/* Glossary */}
          {glossary.length > 0 && (
            <section aria-label="Words you will see" className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
              <h2 className="m-0 text-base font-bold text-slate-900">Words you will see</h2>
              <dl className="m-0 mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {glossary.map((g) => (
                  <div key={g.term} className="rounded-xl bg-slate-50 px-3.5 py-3">
                    <dt className="text-sm font-semibold text-slate-900">{g.term}</dt>
                    <dd className="m-0 mt-0.5 text-xs leading-5 text-slate-500">{g.body}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* Still stuck */}
          <section className="flex flex-col gap-4 rounded-2xl bg-[#012a26] p-5 text-white sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#5eead4] text-[#012a26]"><LifeBuoy className="h-5 w-5" aria-hidden /></span>
              <div>
                <p className="m-0 text-base font-bold text-white">Still stuck?</p>
                <p className="m-0 mt-0.5 text-xs leading-5 text-white/60">Answers to common questions, plus phone, WhatsApp and email. The team is available every day.</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link href="/owner/support" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#5eead4] px-4 text-sm font-bold text-[#012a26] no-underline hover:bg-[#8ff3e1]">
                Help and support <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/owner/notifications" className="inline-flex h-10 items-center gap-2 rounded-xl border border-solid border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white no-underline hover:bg-white/[0.12]">
                <CalendarDays className="h-4 w-4" aria-hidden /> Notifications
              </Link>
            </div>
          </section>

          <p className="m-0 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
            <Clock3 className="h-3 w-3" aria-hidden /> Times and dates across NoLSAF are East Africa Time (EAT).
          </p>
        </div>
      </div>
    </div>
  );
}
