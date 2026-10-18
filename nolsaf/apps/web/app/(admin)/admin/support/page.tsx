"use client";

// Admin Support desk: every queue where someone waits on a person, the contact
// channels customers are shown, a playbook for the common cases with links to
// where each one is handled, and a way to escalate to engineering.
// Data: GET /api/admin/support/overview (read-only).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Ban,
  Bot,
  ChevronDown,
  Copy,
  Check,
  Headphones,
  KeyRound,
  LifeBuoy,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  Route,
  Search,
  Send,
  Users,
  Wrench,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type QueueKey = "twiga_waiting" | "twiga_active" | "cancellations" | "tour_cases" | "guest_codes" | "group_requests";
type Overview = {
  queues: Array<{ key: QueueKey; count: number; oldestAt: string | null }>;
  contact: { email: string | null; phone: string | null };
  handoffs: Array<{ reason: string | null; at: string | null; language: string | null; signedIn: boolean }>;
  generatedAt: string;
};

const QUEUES: Record<QueueKey, { label: string; who: string; href: string; Icon: typeof Bot; waiting: boolean }> = {
  twiga_waiting: { label: "Twiga hand-offs", who: "Visitors who asked Twiga for a person", href: "/admin/agents/ai", Icon: Bot, waiting: true },
  twiga_active: { label: "Chats with an agent", who: "Conversations an admin is answering", href: "/admin/agents/ai", Icon: Headphones, waiting: false },
  cancellations: { label: "Cancellation requests", who: "Travellers waiting on a decision", href: "/admin/cancellations", Icon: Ban, waiting: true },
  tour_cases: { label: "Tour cases", who: "Open tour cancellations and disputes", href: "/admin/action-center", Icon: Route, waiting: true },
  guest_codes: { label: "Check-in code requests", who: "Guests who could not get their code", href: "/admin/bookings/code-requests", Icon: KeyRound, waiting: true },
  group_requests: { label: "Group stay requests", who: "New group requests not picked up", href: "/admin/group-stays/requests", Icon: Users, waiting: true },
};

type Guide = { topic: string; q: string; steps: string[]; href: string; cta: string };
const PLAYBOOK: Guide[] = [
  {
    topic: "Bookings",
    q: "A guest cannot find or use their check-in code",
    steps: [
      "Open Check-in code requests. Requests that need review or where the guest was unreachable are listed first.",
      "Confirm the booking is paid and not cancelled before resending anything.",
      "If the code was voided by a cancellation, the guest needs a new booking, not a new code.",
    ],
    href: "/admin/bookings/code-requests",
    cta: "Code requests",
  },
  {
    topic: "Cancellations",
    q: "A traveller wants to cancel and get a refund",
    steps: [
      "Open the request in Cancellations and read the claim and the booking's payment record.",
      "Move it to Reviewing first; the owner is told the request is under review.",
      "Approving cancels the booking and voids the check-in code. Mark it Refunded only once the provider's refund evidence is stored.",
    ],
    href: "/admin/cancellations",
    cta: "Cancellations",
  },
  {
    topic: "Payments",
    q: "A customer paid but the booking still shows unpaid",
    steps: [
      "Open Payments and look at payments to match: money received with no booking attached.",
      "Match it using the amount, phone number and time of payment.",
      "Never confirm a booking by hand without a matching payment event.",
    ],
    href: "/admin/payments",
    cta: "Payments",
  },
  {
    topic: "Payouts",
    q: "An owner or operator asks where their payout is",
    steps: [
      "Open Disbursements and search for the recipient.",
      "Payouts move from batched to authorized to processing. One held in security review needs a second look before it is released.",
      "If the payout account is missing or wrong, the partner must fix it from their own account; support cannot change it for them.",
    ],
    href: "/admin/disbursements",
    cta: "Disbursements",
  },
  {
    topic: "Listings",
    q: "An owner asks why their listing is not live",
    steps: [
      "Open Approvals and find the listing. Waiting listings show how long they have waited.",
      "Review photos, location and prices; a rejection should say exactly what to fix.",
      "After approval the listing appears publicly; tell the owner when it is live.",
    ],
    href: "/admin/properties/previews",
    cta: "Approvals",
  },
  {
    topic: "Partners",
    q: "See exactly what an owner or operator sees",
    steps: [
      "Open their record (Owners or Tour Operators) and start a support session.",
      "Give a real reason of at least 10 characters; it is written to the audit log.",
      "During the session you cannot change their password, contact details or payout account.",
    ],
    href: "/admin/owners",
    cta: "Owners",
  },
  {
    topic: "Tours",
    q: "A tour traveller reports a problem with an operator",
    steps: [
      "Open the tour case from the Action Center; operator responsibility starts only after the booking is paid.",
      "Assign the case to yourself, deliver it to the operator, and record what they answer.",
      "Refunds come first; any amount owed back by the operator is recovered from later payouts.",
    ],
    href: "/admin/action-center",
    cta: "Action Center",
  },
  {
    topic: "Accounts",
    q: "Find a traveller and their stays",
    steps: [
      "Travellers lists everyone with a paid stay, what they spent, and their current or next stay.",
      "Search by name, email or phone, then open the traveller for their full account.",
    ],
    href: "/admin/users/bookings",
    cta: "Travellers",
  },
  {
    topic: "Audit",
    q: "Find out who changed something and when",
    steps: [
      "The Audit log records every admin action with the admin, the target and the time in EAT.",
      "Filter by action or by the person affected, then export if you need to share it.",
    ],
    href: "/admin/management/audit-log",
    cta: "Audit log",
  },
  {
    topic: "Technical",
    q: "Pages are failing or slow for customers",
    steps: [
      "Technical impact shows which routes are failing right now and closes alerts once they recover.",
      "If a failure keeps repeating, escalate to engineering with the time, the page and what the customer saw.",
    ],
    href: "/admin/impact-center",
    cta: "Technical impact",
  },
  {
    topic: "NRMS",
    q: "A hotel on NRMS needs help",
    steps: [
      "Start from the NRMS support snapshot for the property.",
      "Billing, OTA connections and reconciliation each have their own NRMS page for the fix.",
    ],
    href: "/admin/nrms/support",
    cta: "NRMS support",
  },
];

const EAT = "Africa/Dar_es_Salaam";
function ago(iso: string | null) {
  if (!iso) return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
const ageHours = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : 0);

export default function SupportDeskPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await apiClient.get<Overview>("/api/admin/support/overview");
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Unable to load the support desk");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const waiting = useMemo(() => (data?.queues ?? []).filter((q) => QUEUES[q.key]?.waiting), [data]);
  const waitingTotal = waiting.reduce((n, q) => n + q.count, 0);
  const oldest = useMemo(() => {
    const dated = waiting.filter((q) => q.count > 0 && q.oldestAt).sort((a, b) => new Date(a.oldestAt!).getTime() - new Date(b.oldestAt!).getTime());
    return dated[0] ?? null;
  }, [waiting]);

  const guides = useMemo(() => {
    const t = find.trim().toLowerCase();
    if (!t) return PLAYBOOK.map((g, i) => ({ g, i }));
    return PLAYBOOK.map((g, i) => ({ g, i })).filter(({ g }) => `${g.topic} ${g.q} ${g.steps.join(" ")}`.toLowerCase().includes(t));
  }, [find]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard blocked; the value is visible to copy by hand
    }
  };

  const escalateHref = useMemo(() => {
    const to = "support@nolsaf.com";
    const when = new Date().toLocaleString("en-GB", { timeZone: EAT }) + " EAT";
    const body = `${details.trim() || "What happened:"}\n\nReported from the admin console at ${when}.`;
    return `mailto:${to}?subject=${encodeURIComponent(`[Escalation] ${subject.trim() || "Support issue"}`)}&body=${encodeURIComponent(body)}`;
  }, [subject, details]);

  const phoneDigits = data?.contact.phone?.replace(/[^\d]/g, "") || "";

  return (
    <div id="support-desk" className="w-full min-w-0 space-y-4">
      <style>{`#support-desk, #support-desk * { box-sizing: border-box; }`}</style>

      {/* Header band */}
      <section className="relative overflow-hidden rounded-2xl border border-solid border-emerald-950/60 bg-[#0b2420] px-5 py-5 text-white sm:px-6">
        <div className="pointer-events-none absolute inset-0" aria-hidden style={{ background: "radial-gradient(680px circle at 6% -30%, rgba(52,211,153,0.16), transparent 60%)" }} />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200/70">
              <LifeBuoy className="h-3.5 w-3.5" aria-hidden /> Support desk
            </p>
            <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight">Who is waiting on us</h1>
            <p className="m-0 mt-1.5 max-w-2xl text-sm leading-6 text-emerald-50/75">
              {loading && !data
                ? "Reading the support queues…"
                : waitingTotal === 0
                  ? "Nobody is waiting on a person right now."
                  : `${waitingTotal} ${waitingTotal === 1 ? "person is" : "people are"} waiting on a person.`}
              {oldest ? <span className={ageHours(oldest.oldestAt) > 24 ? "font-semibold text-rose-200" : "text-amber-200"}> The longest wait is {QUEUES[oldest.key].label.toLowerCase()}, {ago(oldest.oldestAt)}.</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.generatedAt ? <span className="hidden text-[11px] text-emerald-100/50 sm:inline">Updated {new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: EAT })} EAT</span> : null}
            <button type="button" onClick={() => void load()} aria-label="Refresh" title="Refresh" className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-solid border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.12]">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="cursor-pointer rounded-lg border border-solid border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700">Retry</button>
        </div>
      ) : null}

      {/* Queues */}
      <section aria-label="Support queues" className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
        {(data?.queues ?? (Object.keys(QUEUES) as QueueKey[]).map((key) => ({ key, count: 0, oldestAt: null }))).map((q) => {
          const meta = QUEUES[q.key];
          if (!meta) return null;
          const hours = ageHours(q.oldestAt);
          const tone = !meta.waiting || q.count === 0 ? "calm" : hours > 24 ? "late" : "warm";
          return (
            <Link key={q.key} href={meta.href} className="group flex flex-col rounded-2xl border border-solid border-neutral-200 bg-white p-4 no-underline transition hover:border-neutral-300 hover:shadow-sm hover:no-underline">
              <span className="flex items-center justify-between gap-2">
                <span className={`grid h-9 w-9 place-items-center rounded-xl ${tone === "late" ? "bg-rose-50 text-rose-600" : tone === "warm" ? "bg-amber-50 text-amber-700" : "bg-[#02665e]/10 text-[#02665e]"}`}>
                  <meta.Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <ArrowRight className="h-4 w-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-600" aria-hidden />
              </span>
              <span className="mt-3 text-2xl font-bold tabular-nums leading-none text-neutral-950">{loading && !data ? "…" : q.count}</span>
              <span className="mt-1.5 text-[13px] font-semibold text-neutral-900">{meta.label}</span>
              <span className="mt-0.5 text-xs text-neutral-500">{meta.who}</span>
              <span className={`mt-3 text-[11px] font-semibold ${tone === "late" ? "text-rose-600" : tone === "warm" ? "text-amber-700" : "text-neutral-400"}`}>
                {q.count === 0 ? "Clear" : q.oldestAt ? `Oldest ${meta.waiting ? "waiting" : "open"} ${ago(q.oldestAt)}` : "Open"}
              </span>
            </Link>
          );
        })}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Playbook */}
        <section className="rounded-2xl border border-solid border-neutral-200 bg-white" aria-label="Support playbook">
          <div className="flex flex-wrap items-end justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4">
            <div>
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Playbook</p>
              <p className="m-0 mt-1 text-sm text-neutral-600">What to do for the cases support sees most, and where to do it.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
              <input value={find} onChange={(e) => { setFind(e.target.value); setOpen(null); }} placeholder="Find a case" aria-label="Search the playbook" className="h-9 w-full rounded-lg border border-solid border-neutral-200 pl-9 pr-3 text-[13px] outline-none focus:border-[#02665e]/50" />
            </div>
          </div>
          <ul className="m-0 list-none divide-y divide-neutral-100 p-0">
            {guides.map(({ g, i }) => {
              const isOpen = open === i || (find.trim() !== "" && guides.length === 1);
              return (
                <li key={i}>
                  <button type="button" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-3.5 text-left hover:bg-neutral-50">
                    <span className="w-24 shrink-0 text-[11px] font-semibold text-[#02665e]">{g.topic}</span>
                    <span className="min-w-0 flex-1 text-[13px] font-semibold text-neutral-900">{g.q}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {isOpen ? (
                    <div className="px-5 pb-4 sm:pl-[8.25rem]">
                      <ol className="m-0 list-none space-y-2 p-0">
                        {g.steps.map((s, k) => (
                          <li key={k} className="flex gap-2.5 text-[13px] leading-relaxed text-neutral-700">
                            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#02665e]/10 text-[11px] font-bold text-[#02665e]">{k + 1}</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ol>
                      <Link href={g.href} className="mt-3 inline-flex h-8 items-center gap-1 rounded-lg bg-[#02665e] px-3 text-xs font-semibold text-white no-underline hover:bg-[#01544d] hover:no-underline">
                        Open {g.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </div>
                  ) : null}
                </li>
              );
            })}
            {!guides.length ? <li className="px-5 py-6 text-sm text-neutral-500">No playbook entry matches. Escalate it if it is new.</li> : null}
          </ul>
        </section>

        <div className="space-y-4">
          {/* Twiga hand-offs */}
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5" aria-label="Waiting for a person">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Asked Twiga for a person</p>
              <Link href="/admin/agents/ai" className="text-xs font-semibold text-[#02665e] no-underline hover:underline">Open Twiga</Link>
            </div>
            {data && data.handoffs.length ? (
              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                {data.handoffs.map((h, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-xl bg-neutral-50 px-3 py-2.5">
                    <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-neutral-900">{h.reason || "Asked to speak to someone"}</span>
                      <span className="block text-[11px] text-neutral-500">{h.signedIn ? "Signed-in customer" : "Visitor"}{h.language ? ` · ${h.language.toUpperCase()}` : ""}</span>
                    </span>
                    <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${ageHours(h.at) > 24 ? "text-rose-600" : "text-amber-700"}`}>{ago(h.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-3 text-sm text-neutral-500">Nobody is waiting. Twiga is handling every conversation.</p>
            )}
          </section>

          {/* Channels customers see */}
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5" aria-label="Contact channels">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Channels customers see</p>
              <Link href="/admin/management/settings" className="text-xs font-semibold text-[#02665e] no-underline hover:underline">Edit in Settings</Link>
            </div>
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {[
                { Icon: Mail, label: "Email", value: data?.contact.email ?? null, href: data?.contact.email ? `mailto:${data.contact.email}` : null },
                { Icon: Phone, label: "Phone and WhatsApp", value: data?.contact.phone ?? null, href: phoneDigits ? `https://wa.me/${phoneDigits}` : null },
                { Icon: Bot, label: "Twiga chat", value: "On every public page", href: null },
              ].map((ch) => (
                <li key={ch.label} className="flex items-center gap-3 rounded-xl border border-solid border-neutral-100 px-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><ch.Icon className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-neutral-500">{ch.label}</span>
                    {ch.href ? (
                      <a href={ch.href} target={ch.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="block truncate text-[13px] font-semibold text-neutral-900 no-underline hover:text-[#02665e]">{ch.value}</a>
                    ) : (
                      <span className={`block truncate text-[13px] font-semibold ${ch.value ? "text-neutral-900" : "text-amber-700"}`}>{ch.value || "Not set in Settings"}</span>
                    )}
                  </span>
                  {ch.value && ch.label !== "Twiga chat" ? (
                    <button type="button" onClick={() => void copy(ch.value!)} aria-label={`Copy ${ch.label.toLowerCase()}`} title="Copy" className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                      {copied === ch.value ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          {/* Escalate to engineering */}
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5" aria-label="Escalate to engineering">
            <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500"><Wrench className="h-3.5 w-3.5" aria-hidden /> Escalate to engineering</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">For bugs and outages the playbook cannot fix. Opens your email app with the time already filled in.</p>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short title, e.g. Payment page fails on mobile" aria-label="Escalation title" className="mt-3 h-9 w-full rounded-lg border border-solid border-neutral-200 px-3 text-[13px] outline-none focus:border-[#02665e]/50" />
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={4} placeholder="What the customer saw, which page, and how to repeat it" aria-label="Escalation details" className="mt-2 w-full resize-y rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] outline-none focus:border-[#02665e]/50" />
            <a href={escalateHref} className={`mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-semibold no-underline hover:no-underline ${subject.trim() ? "bg-[#02665e] text-white hover:bg-[#01544d]" : "pointer-events-none bg-neutral-100 text-neutral-400"}`} aria-disabled={!subject.trim()}>
              <Send className="h-4 w-4" aria-hidden /> Write the escalation email
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
