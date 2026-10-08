"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BedDouble,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock,
  FileText,
  LogIn,
  Mail,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";

/**
 * Owner help and support. Answers describe the app as it works today: the
 * check-in pass, departures, NRMS, Room availability with the floor plan, and
 * the My Payouts flow. Contact details come from the admin-editable public
 * support settings, with the same fallbacks the rest of the app uses.
 */

type Topic = "frontdesk" | "payouts" | "properties" | "availability" | "account";

type Faq = { topic: Topic; q: string; a: string; steps?: string[]; href?: string; linkLabel?: string };

const TOPICS: { key: Topic; label: string; Icon: typeof LogIn; blurb: string; href: string; cta: string }[] = [
  { key: "frontdesk", label: "Front desk", Icon: LogIn, blurb: "Check guests in with their booking code, follow who is in house and confirm departures.", href: "/owner/bookings/validate", cta: "Check in a guest" },
  { key: "payouts", label: "My Payouts", Icon: Wallet, blurb: "When money unlocks, how to withdraw with a one-time code, and where receipts live.", href: "/owner/payouts", cta: "Open My Payouts" },
  { key: "availability", label: "Room availability", Icon: CalendarDays, blurb: "See rooms by floor, block rooms booked outside NoLSAF and keep NRMS in sync.", href: "/owner/properties/availability", cta: "Open Room availability" },
  { key: "properties", label: "Properties", Icon: Building2, blurb: "Add a property, get it approved, and keep rooms, prices and the floor plan right.", href: "/owner/properties/approved", cta: "My properties" },
  { key: "account", label: "Account and safety", Icon: ShieldCheck, blurb: "Your payout account, policies you agree to, and what to send us when you need help.", href: "/owner/payouts/account", cta: "Payout account" },
];

const FAQS: Faq[] = [
  // Front desk
  {
    topic: "frontdesk",
    q: "How do I check a guest in?",
    a: "Open Check in a guest and enter the guest's 8 character booking code, or scan the QR on their receipt. An arrival pass shows whether the code can be used today.",
    steps: [
      "Ask the guest for their booking code or receipt QR",
      "Check the name and phone on the pass against the person in front of you",
      "Tick the NoLSAF Disbursement Policy",
      "Press Confirm check-in",
    ],
    href: "/owner/bookings/validate",
    linkLabel: "Check in a guest",
  },
  {
    topic: "frontdesk",
    q: "Why does the pass say check-in is locked?",
    a: "A code works only inside its stay dates, counted in East Africa Time. Too early means the stay has not started. Stay has ended means the check-out date has passed. Code not active means it was already used. If the guest is with you and the dates look wrong, contact NoLSAF before letting them in.",
  },
  {
    topic: "frontdesk",
    q: "I typed the wrong code a few times and now I am locked out",
    a: "After several wrong codes the page pauses entry for a short time to protect guests' bookings. A countdown shows when you can try again. Check the code with the guest: 0 and O, 1 and I, 5 and S are easy to mix up.",
  },
  {
    topic: "frontdesk",
    q: "How do I check a guest out?",
    a: "Guests appear under Departures 7 hours before their check-out time, or once they are past it. Confirm the check-out after the guest has left and rate the stay. If your property uses NRMS, check the guest out in NRMS instead.",
    href: "/owner/bookings/check-out",
    linkLabel: "Open Departures",
  },
  {
    topic: "frontdesk",
    q: "Check-in asks me to assign a room first",
    a: "Properties that run NRMS need a specific room for every booked room before the guest is checked in. The code is not used when this happens. Open the reservation in NRMS, assign the room, then confirm check-in again.",
  },
  // Payouts
  {
    topic: "payouts",
    q: "When do I get paid for a stay?",
    a: "From 28 October 2026 a stay's payout is ready as soon as you validate the guest's check-in code and NoLSAF has confirmed the guest's payment. When it shows Ready, tap Withdraw and confirm with the one-time code.",
    steps: [
      "Check-in: validate the guest's code at arrival",
      "Ready: tap Withdraw on My Payouts",
      "Enter the one-time code sent to you",
      "Sending: NoLSAF pays your verified payout account",
      "Paid: the receipt appears under History",
    ],
    href: "/owner/payouts/in-progress",
    linkLabel: "Payouts in progress",
  },
  {
    topic: "payouts",
    q: "Where does the one-time code come from?",
    a: "When you tap Withdraw, NoLSAF sends a code by SMS to your registered phone, and by email if the SMS cannot be delivered. The code confirms that you, and only you, asked for the money.",
  },
  {
    topic: "payouts",
    q: "Is every payout sent automatically?",
    a: "Your first payout is reviewed by the NoLSAF team. After that, payouts within the daily limit are sent automatically. Anything unusual goes to a short review first and shows as Under review.",
  },
  {
    topic: "payouts",
    q: "Why is a payout On hold?",
    a: "A stay is held when something needs checking first, such as a cancellation, a dispute or a payout account change. The reason is shown on the payout. It moves on by itself once the check is cleared.",
  },
  {
    topic: "payouts",
    q: "What happens if a stay is refunded after I was paid?",
    a: "Your share of that refund is taken from your next payouts, never from your bank or wallet directly. Each receipt shows any amount deducted, so the numbers always add up.",
  },
  {
    topic: "payouts",
    q: "I forgot to withdraw. Do I lose the money?",
    a: "No. You get a reminder, and if a payout stays unclaimed for 14 days NoLSAF sends it to your verified payout account for you.",
  },
  {
    topic: "payouts",
    q: "Where are my older invoice claims?",
    a: "Stays checked in before the new payout flow are claimed with an invoice. Find them under My Payouts, Older claims. They move through Create invoice, Send to NoLSAF, Verified, Approved and Paid.",
    href: "/owner/payouts/older-claims",
    linkLabel: "Older claims",
  },
  // Availability
  {
    topic: "availability",
    q: "How do I block a room booked outside NoLSAF?",
    a: "Open Room availability, choose the property, then tap the room on the rooms by floor board and press Block this room. Add the guest, dates and source, such as walk-in, Airbnb or Booking.com. The room stops selling on NoLSAF for those nights.",
    href: "/owner/properties/availability",
    linkLabel: "Open Room availability",
  },
  {
    topic: "availability",
    q: "Why do some NRMS stays still hold rooms?",
    a: "An NRMS stay holds its rooms until it is checked out, cancelled or marked no-show in NRMS. The calendar flags stays that are past their departure day or never arrived, so you can tidy them in NRMS.",
  },
  {
    topic: "availability",
    q: "How is the floor plan made?",
    a: "NoLSAF builds it from your room types and the floors you set for each one. After you add rooms or change floors, open the floor plan and press Rebuild plan. Bookings and blocks are kept; only room positions change.",
  },
  // Properties
  {
    topic: "properties",
    q: "How do I add a property and get it approved?",
    a: "Use Add a property, fill in the details, rooms, prices and photos, then submit it. It waits under Awaiting approval while the NoLSAF team reviews it, usually within 1 to 2 business days. You can save a draft at any time.",
    href: "/owner/properties/add",
    linkLabel: "Add a property",
  },
  {
    topic: "properties",
    q: "How do I change prices, rooms or amenities?",
    a: "Open My properties and press Edit on the property. Changes to rooms or floors also update your floor plan after you rebuild it.",
    href: "/owner/properties/approved",
    linkLabel: "My properties",
  },
  // Account
  {
    topic: "account",
    q: "How do I add or change my payout account?",
    a: "Open My Payouts, Payout account. A new account must be verified before money can be sent to it, and changing it can put payouts on hold briefly for your safety.",
    href: "/owner/payouts/account",
    linkLabel: "Payout account",
  },
  {
    topic: "account",
    q: "Which policies apply to my payouts?",
    a: "The NoLSAF Property Owner Disbursement Policy explains timing, holds, recoveries and limits. You agree to it each time you confirm a check-in.",
    href: "/owner/property-owner-disbursement-policy",
    linkLabel: "Read the policy",
  },
];

const shell = "w-full min-w-0 space-y-6 px-3 pb-12 sm:px-5 lg:px-6";

export default function OwnerSupportPage() {
  const [email, setEmail] = useState(process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@nolsaf.com");
  const [phone, setPhone] = useState(process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255 736 766 726");
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<Topic | "all">("all");
  const [open, setOpen] = useState<string | null>(FAQS[0].q);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/support")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        if (j.supportEmail) setEmail(j.supportEmail);
        if (j.supportPhone) setPhone(j.supportPhone);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const phoneDigits = phone.replace(/[^\d+]/g, "");
  const whatsapp = `https://wa.me/${phoneDigits.replace(/^\+/, "")}`;

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      FAQS.filter((f) => (topic === "all" || f.topic === topic))
        .filter((f) => !q || [f.q, f.a, ...(f.steps ?? [])].some((s) => s.toLowerCase().includes(q))),
    [q, topic],
  );

  return (
    <div id="owner-support" className={shell}>
      <style>{`:where(#owner-support, #owner-support *, #owner-support *::before, #owner-support *::after) { box-sizing: border-box; border-width: 0; border-style: solid; border-color: #e2e8f0; }`}</style>

      {/* ── Header band with search ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)", WebkitMaskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative grid gap-6 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-end">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Help and support</p>
            <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">How can we help?</h1>
            <p className="m-0 mt-2 max-w-xl text-sm leading-relaxed text-white/65">
              Answers for running your property on NoLSAF: checking guests in and out, getting paid, and keeping rooms available. The team is reachable any time.
            </p>
          </div>
          <label className="relative block">
            <span className="sr-only">Search help</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#012a26]/50" aria-hidden />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setTopic("all"); }}
              placeholder="Search, for example withdraw, locked, block a room"
              className="h-12 w-full rounded-2xl border-0 bg-white pl-11 pr-10 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-4 focus:ring-[#5eead4]/40"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </label>
        </div>

        {/* Contact, one tap */}
        <div className="relative grid grid-cols-1 gap-px border-0 border-t border-white/10 bg-white/10 sm:grid-cols-4">
          {[
            { href: `tel:${phoneDigits}`, Icon: Phone, label: "Call us", value: phone },
            { href: whatsapp, Icon: MessageCircle, label: "WhatsApp", value: "Chat with the team", external: true },
            { href: `mailto:${email}`, Icon: Mail, label: "Email", value: email },
          ].map((c) => (
            <a
              key={c.label}
              href={c.href}
              target={c.external ? "_blank" : undefined}
              rel={c.external ? "noreferrer" : undefined}
              className="group flex items-center gap-3 bg-[#012a26] px-5 py-4 text-white no-underline transition hover:bg-[#02362f] sm:px-6"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#5eead4]/10 text-[#5eead4]">
                <c.Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">{c.label}</span>
                <span className="block truncate text-sm font-semibold">{c.value}</span>
              </span>
            </a>
          ))}
          <div className="flex items-center gap-3 bg-[#012a26] px-5 py-4 sm:px-6">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-white/70">
              <Clock className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">Hours</span>
              <span className="block text-sm font-semibold">Every day, 24 hours</span>
            </span>
          </div>
        </div>
      </header>

      {/* ── Topics ── */}
      {!q ? (
        <section>
          <p className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Browse by topic</p>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-5">
            {TOPICS.map((t) => {
              const count = FAQS.filter((f) => f.topic === t.key).length;
              const on = topic === t.key;
              return (
                <li key={t.key}>
                  <div
                    className={`flex h-full flex-col rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition ${
                      on ? "border-[#02665e] ring-2 ring-[#02665e]/15" : "border-slate-300/80 hover:border-[#02665e]/40"
                    }`}
                  >
                    <button type="button" onClick={() => { setTopic(on ? "all" : t.key); setOpen(null); }} className="flex flex-1 appearance-none flex-col items-start border-0 bg-transparent p-0 text-left">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#012a26] text-[#5eead4]">
                        <t.Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="mt-3 text-sm font-bold text-slate-900">{t.label}</span>
                      <span className="mt-1 text-xs leading-relaxed text-slate-500">{t.blurb}</span>
                      <span className="mt-2 text-[11px] font-semibold text-[#02665e]">{count} answers</span>
                    </button>
                    <Link href={t.href} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 no-underline hover:text-[#02665e]">
                      {t.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* ── Answers ── */}
        <section className="overflow-hidden rounded-3xl border border-slate-300/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-26px_rgba(15,23,42,0.4)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-slate-200 px-5 py-4">
            <div>
              <p className="m-0 text-sm font-bold text-slate-900">
                {q ? `Results for "${query.trim()}"` : topic === "all" ? "Common questions" : TOPICS.find((t) => t.key === topic)?.label}
              </p>
              <p className="m-0 mt-0.5 text-xs text-slate-500">{results.length} {results.length === 1 ? "answer" : "answers"}</p>
            </div>
            {topic !== "all" || q ? (
              <button type="button" onClick={() => { setTopic("all"); setQuery(""); }} className="h-8 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Show all questions
              </button>
            ) : null}
          </div>

          {results.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="m-0 text-sm font-semibold text-slate-800">No answer matches that yet</p>
              <p className="m-0 mt-1 text-xs text-slate-500">Try another word, or message the team on WhatsApp. They reply any time of day.</p>
              <a href={whatsapp} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-[#012a26] px-4 text-sm font-bold text-white no-underline hover:bg-[#02665e]">
                <MessageCircle className="h-4 w-4 text-[#5eead4]" aria-hidden /> Ask on WhatsApp
              </a>
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {results.map((f) => {
                const isOpen = open === f.q || Boolean(q);
                const t = TOPICS.find((x) => x.key === f.topic)!;
                return (
                  <li key={f.q} className="border-0 border-b border-slate-200 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen && !q ? null : f.q)}
                      aria-expanded={isOpen}
                      className="flex w-full appearance-none items-center gap-3 border-0 bg-transparent px-5 py-4 text-left transition hover:bg-slate-50"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                        <t.Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-slate-900">{f.q}</span>
                        <span className="block text-[11px] text-slate-500">{t.label}</span>
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                    {isOpen ? (
                      <div className="px-5 pb-5 pl-[68px]">
                        <p className="m-0 text-sm leading-relaxed text-slate-700">{f.a}</p>
                        {f.steps?.length ? (
                          <ol className="m-0 mt-3 list-none space-y-2 p-0">
                            {f.steps.map((s, i) => (
                              <li key={s} className="flex items-start gap-3 text-sm text-slate-700">
                                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#02665e]/10 text-[11px] font-bold text-[#02665e]">{i + 1}</span>
                                <span className="pt-0.5">{s}</span>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                        {f.href ? (
                          <Link href={f.href} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#012a26] px-3.5 text-xs font-bold text-white no-underline hover:bg-[#02665e]">
                            {f.linkLabel ?? "Open"} <ArrowRight className="h-3.5 w-3.5 text-[#5eead4]" aria-hidden />
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Side: still stuck, guides, policies ── */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <section className="rounded-3xl bg-[#012a26] p-5 text-white">
            <p className="m-0 text-sm font-bold">Still stuck?</p>
            <p className="m-0 mt-1 text-xs leading-relaxed text-white/65">Send these with your message and the team can help on the first reply:</p>
            <ul className="m-0 mt-3 list-none space-y-2 p-0 text-xs text-white/80">
              {[
                "The booking reference (starts with bk_) or the guest's name",
                "Which property it is about",
                "What you expected, and what happened instead",
                "A screenshot of the screen, if you can",
              ].map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5eead4]" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
            <div className="mt-4 grid gap-2">
              <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-between rounded-xl bg-[#5eead4] pl-4 pr-1.5 text-sm font-bold text-[#012a26] no-underline hover:bg-[#8ff3e1]">
                Message on WhatsApp
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#012a26] text-[#5eead4]"><MessageCircle className="h-3.5 w-3.5" aria-hidden /></span>
              </a>
              <a href={`mailto:${email}`} className="inline-flex h-10 items-center justify-between rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white no-underline hover:bg-white/10">
                Email the team <Mail className="h-4 w-4 text-white/60" aria-hidden />
              </a>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-300/80 bg-white p-5">
            <p className="m-0 text-sm font-bold text-slate-900">Guides and policies</p>
            <ul className="m-0 mt-3 list-none space-y-1 p-0">
              {[
                { href: "/owner/docs", label: "Owner guides", Icon: BedDouble },
                { href: "/owner/property-owner-disbursement-policy", label: "Property Owner Disbursement Policy", Icon: Wallet },
                { href: "/terms", label: "Terms and Conditions", Icon: FileText },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm text-slate-700 no-underline transition hover:bg-slate-50 hover:text-[#02665e]">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <l.Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      <span className="truncate">{l.label}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
