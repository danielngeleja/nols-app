"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  FileSignature,
  LifeBuoy,
  ListChecks,
  Mail,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
  UserRoundCheck,
  WalletCards,
  X,
} from "lucide-react";
import SalesShell from "@/components/SalesShell";

type CategoryId = "access" | "leads" | "attribution" | "earnings" | "payouts" | "account";

type SupportCategory = {
  id: CategoryId;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
};

type SupportGuide = {
  id: string;
  category: CategoryId;
  question: string;
  answer: string;
  steps?: string[];
  href?: string;
  linkLabel?: string;
  keywords?: string[];
};

const categories: SupportCategory[] = [
  {
    id: "access",
    label: "Agreement and access",
    shortLabel: "Agreement",
    description: "Activation, status and contract records",
    icon: FileSignature,
  },
  {
    id: "leads",
    label: "Leads and pipeline",
    shortLabel: "Leads",
    description: "Registration, follow-ups and conversion",
    icon: UserRoundCheck,
  },
  {
    id: "attribution",
    label: "Properties and attribution",
    shortLabel: "Attribution",
    description: "Property links, products and disputes",
    icon: Building2,
  },
  {
    id: "earnings",
    label: "Earnings and validation",
    shortLabel: "Earnings",
    description: "Commission states, checks and reversals",
    icon: CircleDollarSign,
  },
  {
    id: "payouts",
    label: "Payouts and receipts",
    shortLabel: "Payouts",
    description: "Eligibility, finance review and settlement",
    icon: WalletCards,
  },
  {
    id: "account",
    label: "Account and communication",
    shortLabel: "Account",
    description: "Profile, notifications and learning",
    icon: Bell,
  },
];

const guides: SupportGuide[] = [
  {
    id: "activate-agreement",
    category: "access",
    question: "How does my sales agreement become active?",
    answer: "Activation has two parts: your acceptance and NoLSAF's administrative activation. Workspace access and commission earning begin only when the agreement is ACTIVE. An EXPIRING agreement continues earning while renewal is being handled.",
    steps: [
      "Open Contract and review the full agreement, rates, territory and term.",
      "Complete the confirmations and accept using your legal name.",
      "Wait for NoLSAF to activate the signed agreement.",
      "Check Notifications for the activation update and retain the executed PDF.",
    ],
    href: "/sales/contract",
    linkLabel: "Open agreement",
    keywords: ["signed", "active", "countersign", "contract", "workspace"],
  },
  {
    id: "agreement-status",
    category: "access",
    question: "What do SENT, VIEWED, SIGNED, ACTIVE and EXPIRING mean?",
    answer: "SENT means the agreement is ready, VIEWED records that it was opened, and SIGNED means your acceptance was captured. ACTIVE permits workspace earning. EXPIRING is an advance renewal warning and still permits earning. EXPIRED, SUSPENDED or TERMINATED states require administrator assistance.",
    href: "/sales/contract",
    linkLabel: "Check agreement status",
    keywords: ["expired", "suspended", "terminated", "renewal"],
  },
  {
    id: "agreement-pdf",
    category: "access",
    question: "Where can I download the executed agreement?",
    answer: "Use Download PDF on the Contract page. Keep that file for your records. The page also shows the agreement timeline and document hash so the displayed terms can be tied to the accepted version.",
    href: "/sales/contract",
    linkLabel: "Download agreement",
    keywords: ["pdf", "document", "hash", "copy", "record"],
  },
  {
    id: "register-lead",
    category: "leads",
    question: "How should I register a new lead?",
    answer: "Create one lead for the prospect and provide accurate property, contact, territory and proposed-product details. The platform compares normalized contact and property information with existing records and flags possible duplicates for review instead of silently creating competing claims.",
    steps: [
      "Search Leads first to confirm the prospect is not already in your pipeline.",
      "Choose New lead and enter the property and primary contact details.",
      "Select NRMS, Marketplace or both as the proposed product.",
      "Review any duplicate warning and avoid submitting repeated versions of the same prospect.",
    ],
    href: "/sales/leads/new",
    linkLabel: "Register a lead",
    keywords: ["duplicate", "prospect", "new property", "contact"],
  },
  {
    id: "lead-protection",
    category: "leads",
    question: "How does the 60-day lead protection window work?",
    answer: "A new claim is protected for 60 days. A real sales activity restarts that protection window from the activity date. Calls, emails, meetings, received documents and sent proposals extend protection; a note by itself does not.",
    href: "/sales/leads",
    linkLabel: "Review lead protection",
    keywords: ["claim", "expiry", "days", "extend", "ownership"],
  },
  {
    id: "lead-activity",
    category: "leads",
    question: "What activity should I record on a lead?",
    answer: "Record calls, emails, meetings, follow-ups, documents received and proposals sent with a concise factual description. Add the next follow-up date when relevant. This creates an auditable timeline and keeps the pipeline accountable.",
    href: "/sales/leads",
    linkLabel: "Open lead pipeline",
    keywords: ["call", "email", "meeting", "proposal", "follow-up", "documents"],
  },
  {
    id: "request-conversion",
    category: "leads",
    question: "When should I request lead conversion?",
    answer: "Request conversion only when the prospect is ready and the activity record contains enough evidence for verification. The lead moves to CONVERSION_REQUESTED and cannot be withdrawn by a normal status edit. An administrator reviews the property match, duplicate warning and proposed products before approving or returning it.",
    steps: [
      "Open the lead and confirm its identity, contacts and proposed product.",
      "Add the latest meaningful activity and supporting context.",
      "Select Request conversion and confirm the submission.",
      "Watch Notifications for approval or a returned request.",
    ],
    href: "/sales/leads",
    linkLabel: "Open leads",
    keywords: ["converted", "admin review", "approval", "returned"],
  },
  {
    id: "property-appears",
    category: "attribution",
    question: "When does a converted lead appear under Properties?",
    answer: "A property appears after an administrator approves the conversion and creates the relevant sales attribution. The property view is scoped to your own attribution and includes its product, status, earning period, commission history and activity trail.",
    href: "/sales/properties",
    linkLabel: "View attributed properties",
    keywords: ["conversion", "property list", "approved"],
  },
  {
    id: "attribution-products",
    category: "attribution",
    question: "Why can one property show separate NRMS and Marketplace attribution?",
    answer: "Attribution is tracked per property and product. NRMS and Marketplace can therefore have independent statuses and earning periods. Only an ACTIVE attribution for the relevant product accrues commission.",
    href: "/sales/properties",
    linkLabel: "Review attribution",
    keywords: ["NRMS", "marketplace", "product", "active", "status"],
  },
  {
    id: "attribution-incorrect",
    category: "attribution",
    question: "What should I do if an attribution is missing or incorrect?",
    answer: "Do not create another lead to work around an attribution issue. Contact Sales Support with the lead ID, property name, affected product, expected attribution and the evidence that supports the correction. This preserves the existing audit trail.",
    steps: [
      "Copy the lead ID and property name.",
      "Identify whether NRMS, Marketplace or both are affected.",
      "Describe the expected status or earning dates.",
      "Attach only relevant, non-sensitive evidence and contact support.",
    ],
    href: "/sales/properties",
    linkLabel: "Check properties first",
    keywords: ["dispute", "reassigned", "revoked", "missing", "wrong"],
  },
  {
    id: "earning-created",
    category: "earnings",
    question: "When is an earning created?",
    answer: "An earning is recorded from an eligible source such as NRMS usage, a Marketplace booking, a performance bonus or an approved manual adjustment. The source, property, eligible net revenue and contract rate are snapshotted so the calculation remains auditable.",
    href: "/sales/earnings",
    linkLabel: "Open earnings",
    keywords: ["commission", "booking", "bonus", "adjustment", "source"],
  },
  {
    id: "earning-statuses",
    category: "earnings",
    question: "What do the earning statuses mean?",
    answer: "PENDING, VALIDATING, ELIGIBLE and APPROVED form the pending balance. AVAILABLE means the earning can be requested for payout. PAID means it has settled. DISPUTED requires review, while REVERSED or CANCELLED entries no longer count as payable earnings.",
    href: "/sales/earnings",
    linkLabel: "Review earning statuses",
    keywords: ["pending", "validating", "eligible", "approved", "available", "paid"],
  },
  {
    id: "validation-window",
    category: "earnings",
    question: "Why is an approved earning not available immediately?",
    answer: "Earnings pass through a validation window before withdrawal. The standard window is 7 days for NRMS usage and 30 days for Marketplace bookings because booking cancellations, refunds and chargebacks can still affect eligible revenue.",
    href: "/sales/earnings",
    linkLabel: "Check availability dates",
    keywords: ["7 days", "30 days", "waiting", "available date"],
  },
  {
    id: "earning-calculation",
    category: "earnings",
    question: "How can I verify a commission calculation or reversal?",
    answer: "Open the earning detail and compare gross value, taxes, processing fees, refunds, discounts, eligible net revenue, the snapshotted commission rate and final commission amount. For a dispute, send support the earning ID and the exact field you believe is incorrect.",
    href: "/sales/earnings",
    linkLabel: "Inspect earnings",
    keywords: ["gross", "tax", "fee", "refund", "discount", "rate", "reversal"],
  },
  {
    id: "payout-requirements",
    category: "payouts",
    question: "What is required before I can request a payout?",
    answer: "Your sales profile must be ACTIVE, your saved destination must contain a payout name, method and account, and the request must contain AVAILABLE earnings. TZS withdrawals must total at least TSh 50,000. Different currencies must be requested separately.",
    steps: [
      "Confirm the available balance is at least TSh 50,000.",
      "Verify the masked payout destination shown on Payouts.",
      "Select Request payout to claim all currently available earnings.",
      "Keep the generated payout reference for any follow-up.",
    ],
    href: "/sales/payouts",
    linkLabel: "Open payouts",
    keywords: ["minimum", "50000", "destination", "currency", "withdraw"],
  },
  {
    id: "payout-statuses",
    category: "payouts",
    question: "What happens after a payout request is submitted?",
    answer: "The normal path is REQUESTED, UNDER_REVIEW, APPROVED, PROCESSING and PAID. The selected earnings remain locked while the request is active. REJECTED, CANCELLED or FAILED requests release eligible earnings back to AVAILABLE where applicable.",
    href: "/sales/payouts",
    linkLabel: "Track payout status",
    keywords: ["finance", "review", "processing", "failed", "rejected"],
  },
  {
    id: "cancel-payout",
    category: "payouts",
    question: "Can I cancel a payout request?",
    answer: "You can cancel only while its status is REQUESTED and finance has not started review. A reason of at least five characters is required. After cancellation, the linked earnings are released and can become claimable again.",
    href: "/sales/payouts",
    linkLabel: "Manage requests",
    keywords: ["cancel", "reason", "unreviewed", "release"],
  },
  {
    id: "payout-receipt",
    category: "payouts",
    question: "When is a payout receipt available?",
    answer: "A downloadable receipt becomes available after the payout is PAID and has a settlement reference. The receipt records the request, approved and net amounts, destination mask, payment reference, settlement date and number of included earnings.",
    href: "/sales/payouts",
    linkLabel: "Find payout receipts",
    keywords: ["pdf", "payment reference", "settled", "download"],
  },
  {
    id: "payout-destination",
    category: "account",
    question: "How do I correct my payout destination?",
    answer: "The Payouts page shows the destination saved on your sales profile. If it is incomplete or incorrect, contact an administrator before requesting. Every request snapshots the destination at submission, so changing the profile does not rewrite an existing request.",
    href: "/sales/payouts",
    linkLabel: "Check saved destination",
    keywords: ["bank", "mobile money", "account", "name", "masked"],
  },
  {
    id: "notifications",
    category: "account",
    question: "Where do I see important workspace updates?",
    answer: "Notifications contains agreement, conversion, attribution, earnings and payout events. New items stay under Unread until you mark them as read, and supported notices link directly to the relevant workspace record.",
    href: "/sales/notifications",
    linkLabel: "Open notifications",
    keywords: ["alerts", "unread", "updates", "message"],
  },
  {
    id: "materials",
    category: "account",
    question: "Where are product guides, scripts and policies?",
    answer: "Learning and materials contains published product guides, sales scripts, presentations, case studies, policies, training and FAQs. Use its category filter and search to find the latest published resource.",
    href: "/sales/materials",
    linkLabel: "Browse materials",
    keywords: ["training", "policy", "script", "presentation", "guide"],
  },
  {
    id: "support-case",
    category: "account",
    question: "What should I include when contacting Sales Support?",
    answer: "Include your agent code, the relevant lead, property, earning or payout reference, when the issue occurred, what you expected and what happened. Add a screenshot if useful, but never send passwords, one-time codes, full bank credentials or unnecessary personal data.",
    keywords: ["ticket", "case", "screenshot", "security", "agent code"],
  },
];

export default function SalesSupportPage() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryId | "all">("access");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@nolsaf.com";
  const supportPhone = process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255 736 766 726";
  const normalizedQuery = query.trim().toLowerCase();

  const filteredGuides = useMemo(() => {
    return guides.filter((guide) => {
      if (!normalizedQuery) return activeCategory === "all" || guide.category === activeCategory;
      const category = categories.find((item) => item.id === guide.category);
      const searchable = [
        guide.question,
        guide.answer,
        ...(guide.steps || []),
        ...(guide.keywords || []),
        category?.label || "",
      ].join(" ").toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [activeCategory, normalizedQuery]);

  const selectedCategory = categories.find((item) => item.id === activeCategory);

  return (
    <SalesShell>
      <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_20px_55px_-42px_rgba(3,73,61,0.55)]">
        <section className="relative overflow-hidden bg-white">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-emerald-100/60 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-5 px-5 py-5 sm:px-7">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#087f68] text-white shadow-[0_14px_30px_-18px_rgba(8,127,104,0.9)]">
                <LifeBuoy className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">
                  Sales workspace
                </p>
                <h1 className="mb-0 mt-1.5 text-[clamp(1.45rem,2.5vw,2rem)] font-black leading-tight tracking-[-0.035em] text-slate-950">
                  Sales support
                </h1>
                <p className="mb-0 mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  Clear guidance for every stage from agreement activation and lead protection to earnings and settlement.
                </p>
              </div>
            </div>
            <div className="w-full max-w-md">
              <label htmlFor="sales-support-search" className="sr-only">Search sales support</label>
              <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="sales-support-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                placeholder="Search workspace guidance"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Clear support search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              </div>
              <p className="mb-0 mt-1.5 text-right text-[10px] font-semibold text-slate-400">
                {guides.length} verified guides
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-6" aria-label="Support categories">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {categories.map((category) => {
              const Icon = category.icon;
              const isActive = activeCategory === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => { setActiveCategory(category.id); setQuery(""); }}
                  aria-pressed={isActive}
                  className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-left transition ${
                    isActive
                      ? "border-emerald-300 bg-emerald-700 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-800"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-emerald-100" : "text-slate-400"}`} />
                  <span className="truncate text-xs font-bold">{category.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="grid items-start border-t border-slate-200 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="overflow-hidden bg-white" aria-labelledby="support-guides-heading">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <h2 id="support-guides-heading" className="m-0 text-sm font-black text-slate-950">
                  {normalizedQuery ? "Search results" : selectedCategory?.label}
                </h2>
                <p className="mb-0 mt-1 text-xs text-slate-500">
                  {normalizedQuery
                    ? `${filteredGuides.length} result${filteredGuides.length === 1 ? "" : "s"} for “${query.trim()}”`
                    : selectedCategory?.description}
                </p>
              </div>
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-800"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear search
                </button>
              ) : null}
            </div>

            {filteredGuides.length ? (
              <div className="divide-y divide-slate-100">
                {filteredGuides.map((guide) => {
                  const isOpen = Boolean(expanded[guide.id]);
                  const category = categories.find((item) => item.id === guide.category)!;
                  const CategoryIcon = category.icon;
                  return (
                    <article key={guide.id} className={isOpen ? "bg-emerald-50/25" : "bg-white"}>
                      <button
                        type="button"
                        onClick={() => setExpanded((current) => ({ ...current, [guide.id]: !current[guide.id] }))}
                        className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-slate-50/80 sm:px-6"
                        aria-expanded={isOpen}
                        aria-controls={`support-answer-${guide.id}`}
                      >
                        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                          isOpen ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-500"
                        }`}>
                          <CategoryIcon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold leading-5 text-slate-900">
                            {guide.question}
                          </span>
                        </span>
                        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180 text-emerald-700" : ""}`} />
                      </button>

                      {isOpen ? (
                        <div id={`support-answer-${guide.id}`} className="px-5 pb-5 pl-16 sm:px-6 sm:pl-[76px]">
                          <p className="m-0 max-w-4xl text-sm leading-6 text-slate-600">{guide.answer}</p>
                          {guide.steps?.length ? (
                            <ol className="mb-0 mt-4 space-y-2.5 p-0">
                              {guide.steps.map((step, index) => (
                                <li key={step} className="flex items-start gap-3 text-sm leading-5 text-slate-600">
                                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-800">
                                    {index + 1}
                                  </span>
                                  <span className="pt-0.5">{step}</span>
                                </li>
                              ))}
                            </ol>
                          ) : null}
                          {guide.href ? (
                            <Link
                              href={guide.href}
                              className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-800 no-underline transition hover:bg-emerald-50"
                            >
                              {guide.linkLabel || "Open workspace page"}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
                <div>
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                    <Search className="h-5 w-5" />
                  </span>
                  <p className="mb-0 mt-4 text-sm font-black text-slate-900">No matching guidance</p>
                  <p className="mb-0 mt-1 text-xs text-slate-500">Try a broader phrase or clear the selected topic.</p>
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="mt-4 text-xs font-bold text-emerald-700"
                  >
                    Clear search
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-4 border-t border-slate-200 bg-slate-50/70 p-4 lg:border-l lg:border-t-0">
            <section className="overflow-hidden rounded-2xl border border-[#0b5f52] bg-[#073c35] text-white shadow-[0_18px_35px_-28px_rgba(3,60,53,0.9)]">
              <div className="p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-emerald-100">
                  <MessageCircle className="h-5 w-5" />
                </span>
                <h2 className="mb-0 mt-4 text-base font-black">Still need assistance?</h2>
                <p className="mb-0 mt-1.5 text-xs leading-5 text-white/70">
                  Contact Sales Support with the relevant workspace reference so the issue can be routed correctly.
                </p>

                <div className="mt-4 grid gap-2">
                  <a
                    href={`mailto:${supportEmail}?subject=Sales%20workspace%20support`}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 text-xs font-bold text-[#073c35] no-underline transition hover:bg-emerald-50"
                  >
                    <Mail className="h-4 w-4" />
                    Email support
                  </a>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={`tel:${supportPhone.replace(/[^\d+]/g, "")}`}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-bold text-white no-underline transition hover:bg-white/10"
                    >
                      <Phone className="h-4 w-4" />
                      Call
                    </a>
                    <a
                      href="https://wa.me/255736766726"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-bold text-white no-underline transition hover:bg-white/10"
                    >
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp
                    </a>
                  </div>
                </div>
              </div>
              <div className="border-t border-white/10 bg-white/5 px-5 py-3">
                <p className="m-0 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-emerald-100">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Support available 24/7
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-emerald-700" />
                <h2 className="m-0 text-sm font-black text-slate-900">Before you contact us</h2>
              </div>
              <ul className="mb-0 mt-3 space-y-2.5 p-0">
                {[
                  "Include your agent code",
                  "Add the relevant record reference",
                  "Explain expected versus actual result",
                  "Include the date and a safe screenshot",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                Never send passwords, one-time codes or full payout credentials.
              </div>
            </section>

            <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-[11px] leading-5 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              For attribution or finance reviews, avoid creating duplicate records while support investigates.
            </div>
          </aside>
        </div>
      </div>
    </SalesShell>
  );
}
