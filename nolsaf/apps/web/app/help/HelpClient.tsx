"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Car,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Home,
  LifeBuoy,
  Mail,
  MessageCircle,
  Search,
  Shield,
  Users,
  X,
} from "lucide-react";
import LayoutFrame from "@/components/LayoutFrame";
import { HelpFooter, HelpHeader } from "./HelpChrome";

const DEFAULT_FAQS = [
  // Booking Category
  {
    question: "How do I book a property?",
    answer: "Browse available properties on our platform, select your dates, and complete the booking process. You'll receive a confirmation email with all the details.",
    category: "Booking"
  },
  {
    question: "Can I cancel my booking?",
    answer: "Cancellation policies vary by property. Check the property's cancellation policy before booking. You can view your bookings and cancellation options in your account.",
    category: "Booking"
  },
  {
    question: "How far in advance can I book?",
    answer: "You can book properties up to 12 months in advance. Some properties may have different availability windows, which will be shown during the booking process.",
    category: "Booking"
  },
  {
    question: "Can I modify my booking dates?",
    answer: "Yes, you can modify your booking dates through your account dashboard, subject to availability and the property's modification policy. Changes may incur additional fees or refunds based on the property's terms.",
    category: "Booking"
  },
  {
    question: "What happens if the property is not as described?",
    answer: "If you encounter any issues with the property not matching its description, contact our support team immediately. We'll investigate and work with the property owner to resolve the issue, which may include a refund or alternative accommodation.",
    category: "Booking"
  },
  {
    question: "Do I need to pay a security deposit?",
    answer: "Some properties require a security deposit, which will be clearly stated during the booking process. Deposits are typically refunded within 7-14 business days after check-out, provided there's no damage or policy violations.",
    category: "Booking"
  },
  {
    question: "Can I book for multiple guests?",
    answer: "Yes, you can specify the number of guests during booking. Make sure to select the correct number as some properties charge per guest or have maximum occupancy limits.",
    category: "Booking"
  },
  {
    question: "What is the check-in and check-out process?",
    answer: "Check-in and check-out times vary by property and are displayed on the property listing. You'll receive detailed instructions via email after booking. Most properties offer flexible check-in options, and early check-in or late check-out may be available upon request.",
    category: "Booking"
  },
  // Payment Category
  {
    question: "What payment methods are accepted?",
    answer: "We accept various payment methods including M-Pesa, Airtel Money, Mixx by Yas, HaloPesa, and VISA cards. Payment options may vary by property.",
    category: "Payment"
  },
  {
    question: "When is payment charged?",
    answer: "Payment is typically charged at the time of booking confirmation. Some properties may require a partial payment upfront with the remainder due closer to your check-in date. You'll see the payment schedule before confirming your booking.",
    category: "Payment"
  },
  {
    question: "Are there any booking fees?",
    answer: "Our platform charges a small service fee that is clearly displayed before you complete your booking. This fee helps us maintain the platform, provide customer support, and ensure secure transactions.",
    category: "Payment"
  },
  {
    question: "How do I get a refund?",
    answer: "Refunds are processed according to the property's cancellation policy. If you're eligible for a refund, it will be processed to your original payment method within 5-10 business days. Contact support if you have questions about your refund status.",
    category: "Payment"
  },
  {
    question: "Can I pay in installments?",
    answer: "Some properties offer installment payment options. Look for properties with 'Pay in Installments' badge or contact the property owner directly to discuss payment arrangements.",
    category: "Payment"
  },
  {
    question: "What currency are prices displayed in?",
    answer: "Prices are displayed in Tanzanian Shillings (TZS) by default. You can view prices in other currencies using the currency selector, though the final charge will be in TZS based on current exchange rates.",
    category: "Payment"
  },
  {
    question: "Is my payment information secure?",
    answer: "Yes, we use industry-standard encryption and secure payment processing. Your payment information is never stored on our servers. All transactions are processed through secure, PCI-compliant payment gateways.",
    category: "Payment"
  },
  // Property Owner Category
  {
    question: "How do I list my property?",
    answer: "Sign up as a property owner, complete your profile, and add your property details. Our team will review and approve your listing. You can start by clicking 'List Your Property' in the navigation menu.",
    category: "Property Owner"
  },
  {
    question: "What information do I need to list my property?",
    answer: "You'll need property photos, a detailed description, amenities list, pricing, availability calendar, house rules, and contact information. Our onboarding process will guide you through all required information.",
    category: "Property Owner"
  },
  {
    question: "How much does it cost to list my property?",
    answer: "Listing your property is free. We only charge a commission on successful bookings. The commission rate varies based on your property type and is clearly outlined in our owner agreement.",
    category: "Property Owner"
  },
  {
    question: "How do I set my property pricing?",
    answer: "You can set base pricing, seasonal rates, weekend rates, and special offers through your owner dashboard. We provide pricing recommendations based on market data to help you optimize your rates.",
    category: "Property Owner"
  },
  {
    question: "How do I manage bookings and reservations?",
    answer: "All bookings appear in your owner dashboard where you can view guest details, manage check-ins, communicate with guests, and update availability. You'll receive email notifications for new bookings.",
    category: "Property Owner"
  },
  {
    question: "When do I receive payment for bookings?",
    answer: "From 28 October 2026 a stay's payout is ready as soon as you validate the guest's check-in code and NoLSAF has confirmed the guest's payment. You then withdraw it from My Payouts in your owner workspace and confirm with a one-time code.",
    category: "Property Owner"
  },
  {
    question: "Can I block dates when my property is unavailable?",
    answer: "Yes, you can block dates, set minimum stay requirements, and manage your availability calendar directly from your owner dashboard. Changes sync immediately across the platform.",
    category: "Property Owner"
  },
  {
    question: "What if a guest damages my property?",
    answer: "We recommend requiring a security deposit for your property. If damage occurs, document it with photos and contact our support team. We'll help mediate the situation and process any claims through the security deposit.",
    category: "Property Owner"
  },
  {
    question: "How can I improve my property's visibility?",
    answer: "High-quality photos, detailed descriptions, competitive pricing, quick response times, and positive reviews all help improve your property's visibility. We also offer featured listing options for increased exposure.",
    category: "Property Owner"
  },
  // Driver Category
  {
    question: "How do I become a driver?",
    answer: "Register as a driver on our platform, complete your profile with required documents (license, vehicle registration, insurance), and wait for approval. Our team will verify your credentials before activation.",
    category: "Driver"
  },
  {
    question: "What documents do I need to become a driver?",
    answer: "You'll need a valid driver's license, vehicle registration documents, insurance certificate, and a recent photo. All documents must be current and valid. We may request additional verification documents.",
    category: "Driver"
  },
  {
    question: "How do I get ride requests?",
    answer: "Once approved, you'll receive ride requests through the driver app. You can accept or decline requests based on your availability. Being online and in high-demand areas increases your chances of receiving requests.",
    category: "Driver"
  },
  {
    question: "How are driver earnings calculated?",
    answer: "Earnings are based on distance, time, and base fare rates. You keep a percentage of each ride, with the exact breakdown shown in your driver dashboard. Weekly payouts are processed automatically.",
    category: "Driver"
  },
  {
    question: "Can I set my own rates?",
    answer: "Base rates are set by the platform, but you can earn bonuses during peak hours and special promotions. Premium drivers with excellent ratings may qualify for higher earning tiers.",
    category: "Driver"
  },
  {
    question: "What if I have an issue with a passenger?",
    answer: "Contact our support team immediately if you encounter any issues. We have a 24/7 support line for drivers. Document any incidents and report them through the driver app for quick resolution.",
    category: "Driver"
  },
  {
    question: "How do I update my vehicle information?",
    answer: "You can update your vehicle information, documents, and profile details through your driver dashboard. Changes to critical information like vehicle registration may require re-verification.",
    category: "Driver"
  },
  // Support Category
  {
    question: "How do I contact support?",
    answer: "You can reach our support team via email at info@nolsaf.com, use the contact form on this page, or access live chat through your account dashboard. We typically respond within 24 hours, with urgent matters addressed sooner.",
    category: "Support"
  },
  {
    question: "What happens if I have an issue during my stay?",
    answer: "Contact the property owner directly through the platform messaging system first. If the issue isn't resolved, reach out to our support team for assistance. We're available 24/7 to help resolve any problems.",
    category: "Support"
  },
  {
    question: "How do I report a problem with a property?",
    answer: "Use the 'Report Issue' button in your booking details or contact support directly. Provide photos and details of the problem. Our team will investigate and work with the property owner to resolve it.",
    category: "Support"
  },
  {
    question: "Can I leave a review after my stay?",
    answer: "Yes, you'll receive an email invitation to leave a review after your check-out date. Reviews help other guests make informed decisions and help property owners improve their services.",
    category: "Support"
  },
  {
    question: "What is your response time for support inquiries?",
    answer: "We aim to respond to all inquiries within 24 hours. Urgent matters related to active bookings are prioritized and typically receive a response within 2-4 hours during business hours.",
    category: "Support"
  },
  {
    question: "How do I update my account information?",
    answer: "You can update your profile, contact information, payment methods, and preferences through your account settings. Changes to email or phone number may require verification.",
    category: "Support"
  },
  {
    question: "What if I forgot my password?",
    answer: "Click 'Forgot Password' on the login page and enter your email address. You'll receive a password reset link via email. If you don't receive it, check your spam folder or contact support.",
    category: "Support"
  },
  // Security Category
  {
    question: "Is my personal information secure?",
    answer: "Yes, we take data security seriously. We use industry-standard encryption, secure servers, and follow best practices for data protection. Your personal information is never shared with third parties without your consent.",
    category: "Security"
  },
  {
    question: "How do you verify property owners and drivers?",
    answer: "We verify all property owners and drivers through document verification, identity checks, and background screening where applicable. Only verified users can list properties or provide services on our platform.",
    category: "Security"
  },
  {
    question: "What should I do if I suspect fraud?",
    answer: "Report any suspicious activity immediately to our support team at info@nolsaf.com. Include as much detail as possible. We take fraud seriously and will investigate all reports promptly.",
    category: "Security"
  },
  {
    question: "Are my credit card details stored?",
    answer: "No, we never store your full credit card details. Payment information is securely processed through PCI-compliant payment gateways. Only the last four digits are stored for transaction reference.",
    category: "Security"
  },
  {
    question: "How do I know if a property listing is legitimate?",
    answer: "All properties go through our verification process. Look for verified badges, read reviews from previous guests, and check the property owner's profile. If something seems suspicious, report it to our support team.",
    category: "Security"
  },
  {
    question: "What privacy protections do you have?",
    answer: "We comply with data protection regulations and have strict privacy policies. Your data is only used to provide our services and improve your experience. You can review our full privacy policy in your account settings.",
    category: "Security"
  }
];

const HELP_CATEGORIES = [
  {
    title: "Getting Started",
    icon: BookOpen,
    gradient: "from-emerald-500 to-teal-600",
    bg: "bg-emerald-50/60 border-emerald-100/80",
    pill: "bg-emerald-100 text-emerald-700",
    accent: "#059669",
    links: [
      { href: "/help/getting-started", label: "How to Book" },
      { href: "/help/account-setup", label: "Account Setup" },
      { href: "/public/properties", label: "Browse Properties" },
    ],
  },
  {
    title: "Payments & Billing",
    icon: CreditCard,
    gradient: "from-sky-500 to-blue-600",
    bg: "bg-sky-50/60 border-sky-100/80",
    pill: "bg-sky-100 text-sky-700",
    accent: "#0284c7",
    links: [
      { href: "/help/payments", label: "Payment Methods" },
      { href: "/help/refunds", label: "Refunds & Cancellations" },
      { href: "/help/pricing", label: "Pricing Information" },
    ],
  },
  {
    title: "For Property Owners",
    icon: Home,
    gradient: "from-amber-500 to-orange-500",
    bg: "bg-amber-50/60 border-amber-100/80",
    pill: "bg-amber-100 text-amber-700",
    accent: "#d97706",
    links: [
      { href: "/account/onboard/owner", label: "List Your Property" },
      { href: "/help/owner-guide", label: "Owner Guide" },
      { href: "/help/payouts", label: "Payouts & Earnings" },
    ],
  },
  {
    title: "For Drivers",
    icon: Car,
    gradient: "from-indigo-500 to-violet-600",
    bg: "bg-indigo-50/60 border-indigo-100/80",
    pill: "bg-indigo-100 text-indigo-700",
    accent: "#6366f1",
    links: [
      { href: "/account/onboard/driver", label: "Become a Driver" },
      { href: "/help/driver-tools", label: "Driver Tools" },
      { href: "/help/driver-earnings", label: "Earnings & Payments" },
    ],
  },
  {
    title: "For Agents",
    icon: Users,
    gradient: "from-[#02665e] to-[#4dd9ac]",
    bg: "bg-teal-50/60 border-teal-100/80",
    pill: "bg-teal-100 text-teal-700",
    accent: "#02665e",
    links: [
      { href: "/help/become-agent", label: "Become an Agent" },
      { href: "/help/event-manager", label: "Event Manager" },
      { href: "/help/nolsaf-stand", label: "NoLSAF Stand" },
    ],
  },
  {
    title: "Safety & Security",
    icon: Shield,
    gradient: "from-rose-500 to-pink-600",
    bg: "bg-rose-50/60 border-rose-100/80",
    pill: "bg-rose-100 text-rose-700",
    accent: "#e11d48",
    links: [
      { href: "/help/getting-started#safety", label: "Safety Guidelines" },
      { href: "/help/account-setup#security", label: "Account Security" },
      { href: "/help/refunds#disputes", label: "Dispute Resolution" },
    ],
  },
];

export default function HelpCenterPage() {
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [sending, _setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [showAllFAQs, setShowAllFAQs] = useState(false);
  const [isAgentContext, setIsAgentContext] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const queryCtx = new URLSearchParams(window.location.search).get("ctx")?.toLowerCase() || "";
    const stored = (sessionStorage.getItem("navigationContext") || "").toLowerCase();
    const next = queryCtx === "agent" || stored === "agent";
    if (next) {
      sessionStorage.setItem("navigationContext", "agent");
      setIsAgentContext(true);
    }
  }, []);

  const withHelpCtx = (href: string) => {
    if (!isAgentContext) return href;
    if (!href.startsWith("/help")) return href;
    return `${href}${href.includes("?") ? "&" : "?"}ctx=agent`;
  };

  const categories = ["All", ...Array.from(new Set(DEFAULT_FAQS.map(f => f.category)))];
  const filteredFAQs = selectedCategory === "All" 
    ? DEFAULT_FAQS 
    : DEFAULT_FAQS.filter(f => f.category === selectedCategory);
  
  const displayedFAQs = showAllFAQs ? filteredFAQs : filteredFAQs.slice(0, 10);
  const hasMoreFAQs = filteredFAQs.length > 10;

  async function submitContact(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setSent(null);
    if (!contactEmail || !contactMessage) {
      setError('Please provide your email and a message.');
      return;
    }
    
    // Use mailto as the primary method since there's no public contact API
    const subject = encodeURIComponent(`Help Center Inquiry${contactName ? ` from ${contactName}` : ''}`);
    const body = encodeURIComponent(`${contactMessage}\n\n---\nFrom: ${contactEmail}${contactName ? ` (${contactName})` : ''}`);
    window.location.href = `mailto:info@nolsaf.com?subject=${subject}&body=${body}`;
    
    setSent('Opening your email client. Please send the message to contact our support team.');
    setContactName('');
    setContactEmail('');
    setContactMessage('');
  }

  const q = query.trim().toLowerCase();
  const guideHits = q
    ? HELP_CATEGORIES.flatMap((cat) => cat.links.map((link) => ({ ...link, group: cat.title, Icon: cat.icon }))).filter((g) => `${g.label} ${g.group}`.toLowerCase().includes(q))
    : [];
  const faqHits = q ? DEFAULT_FAQS.filter((f) => `${f.question} ${f.answer} ${f.category}`.toLowerCase().includes(q)) : [];

  const faqRow = (f: (typeof DEFAULT_FAQS)[number]) => {
    const isOpen = openFaq === f.question;
    return (
      <li key={f.question} className="border-0 border-t border-solid border-slate-100 first:border-t-0">
        <button
          type="button"
          onClick={() => setOpenFaq(isOpen ? null : f.question)}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-4 border-0 bg-transparent px-5 py-3.5 text-left hover:bg-slate-50/70"
        >
          <span className={`text-sm font-semibold leading-snug ${isOpen ? "text-[#02665e]" : "text-slate-900"}`}>{f.question}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180 text-[#02665e]" : ""}`} aria-hidden />
        </button>
        {isOpen && <p className="m-0 px-5 pb-4 text-sm leading-6 text-slate-600">{f.answer}</p>}
      </li>
    );
  };

  return (
    <>
      <HelpHeader />
      <div className="min-h-screen bg-[#f6f8f7]">
        <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" />
        <div className="public-container space-y-6 py-6 sm:py-8">

          {/* Hero: one clear column, search first, roles underneath */}
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#010f0e] via-[#011a18] to-[#022820] px-6 py-8 text-white sm:px-10 sm:py-10">
            <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full opacity-20 blur-3xl" style={{ background: "radial-gradient(circle, #4dd9ac 0%, transparent 65%)" }} />
            <div className="relative" style={{ maxWidth: 720 }}>
              <p className="m-0 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#4dd9ac]">
                <LifeBuoy className="h-3.5 w-3.5" aria-hidden /> Help Center
              </p>
              <h1 className="m-0 mt-3 text-3xl font-black tracking-tight sm:text-4xl">How can we help you?</h1>
              <p className="m-0 mt-2 text-sm text-slate-300">Search the guides and questions, or start from your role.</p>

              <label htmlFor="help-search" className="sr-only">Search help</label>
              <div className="mt-5 flex h-12 items-center gap-3 rounded-2xl bg-white px-4">
                <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <input
                  id="help-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search refunds, payouts, check-in..."
                  autoComplete="off"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border-0 bg-slate-100 text-slate-500 hover:text-slate-800"><X className="h-3.5 w-3.5" aria-hidden /></button>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {[
                  { href: "/help/getting-started", Icon: BookOpen, label: "Guests" },
                  { href: "/help/owner-guide", Icon: Home, label: "Property owners" },
                  { href: "/help/driver-tools", Icon: Car, label: "Drivers" },
                  { href: "/help/become-agent", Icon: Users, label: "Agents" },
                ].map((role) => (
                  <Link
                    key={role.href}
                    href={withHelpCtx(role.href)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-solid border-white/15 bg-white/[0.06] px-3.5 text-xs font-semibold text-white no-underline transition hover:border-[#4dd9ac]/50 hover:bg-white/[0.1]"
                  >
                    <role.Icon className="h-3.5 w-3.5 text-[#4dd9ac]" aria-hidden />
                    {role.label}
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <main className="min-w-0 space-y-6">
              {q ? (
                /* Search results */
                <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-4">
                    <p className="m-0 text-sm text-slate-600"><strong className="text-slate-900">{guideHits.length + faqHits.length}</strong> result{guideHits.length + faqHits.length === 1 ? "" : "s"} for &ldquo;{query.trim()}&rdquo;</p>
                    <button type="button" onClick={() => setQuery("")} className="border-0 bg-transparent p-0 text-xs font-bold text-[#02665e]">Clear</button>
                  </div>
                  {guideHits.length > 0 && (
                    <div className="px-5 py-4">
                      <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Guides</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {guideHits.map((g) => (
                          <Link key={g.href + g.label} href={withHelpCtx(g.href)} className="group flex items-center gap-3 rounded-xl border border-solid border-slate-200 px-3 py-2.5 no-underline hover:border-[#02665e]/40">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#012a26] text-[#5eead4]"><g.Icon className="h-4 w-4" aria-hidden /></span>
                            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900">{g.label}</span><span className="block truncate text-[11px] text-slate-500">{g.group}</span></span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-[#02665e]" aria-hidden />
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  {faqHits.length > 0 && (
                    <div className="border-0 border-t border-solid border-slate-100">
                      <p className="m-0 px-5 pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Questions</p>
                      <ul className="m-0 list-none p-0">{faqHits.map(faqRow)}</ul>
                    </div>
                  )}
                  {guideHits.length + faqHits.length === 0 && (
                    <div className="px-6 py-10 text-center">
                      <p className="m-0 text-sm font-bold text-slate-900">Nothing matches that yet</p>
                      <p className="m-0 mt-1 text-xs text-slate-500">Try another word, or send us a message and we will answer you directly.</p>
                    </div>
                  )}
                </section>
              ) : (
                <>
                  {/* Guides by role */}
                  <section>
                    <h2 className="m-0 mb-3 text-base font-bold text-slate-900">Guides by topic</h2>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {HELP_CATEGORIES.map((cat) => {
                        const Icon = cat.icon;
                        return (
                          <div key={cat.title} className="rounded-2xl border border-solid border-slate-200 bg-white p-4">
                            <div className="flex items-center gap-2.5">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#012a26] text-[#5eead4]"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                              <h3 className="m-0 text-sm font-bold text-slate-900">{cat.title}</h3>
                            </div>
                            <ul className="m-0 mt-3 list-none space-y-0.5 p-0">
                              {cat.links.map((link) => (
                                <li key={link.href + link.label}>
                                  <Link
                                    href={withHelpCtx(link.href)}
                                    onClick={() => { if (isAgentContext && typeof window !== "undefined") sessionStorage.setItem("navigationContext", "agent"); }}
                                    className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-slate-600 no-underline hover:bg-slate-50 hover:text-[#02665e]"
                                  >
                                    <span className="truncate">{link.label}</span>
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-[#02665e]" aria-hidden />
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* FAQ */}
                  <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
                    <div className="px-5 pt-4">
                      <h2 className="m-0 text-base font-bold text-slate-900">Frequently asked questions</h2>
                    </div>
                    <div className="mt-2 flex gap-1 overflow-x-auto border-0 border-b border-solid border-slate-100 px-3" role="tablist">
                      {categories.map((cat) => {
                        const active = selectedCategory === cat;
                        return (
                          <button key={cat} type="button" role="tab" aria-selected={active}
                            onClick={() => { setSelectedCategory(cat); setShowAllFAQs(false); setOpenFaq(null); }}
                            className={`-mb-px h-10 shrink-0 whitespace-nowrap border-0 border-b-2 border-solid bg-transparent px-3 text-[13px] font-semibold ${active ? "border-[#02665e] text-[#02665e]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                    <ul className="m-0 list-none p-0">{displayedFAQs.map(faqRow)}</ul>
                    {hasMoreFAQs && (
                      <div className="border-0 border-t border-solid border-slate-100 px-5 py-3">
                        <button type="button" onClick={() => { setShowAllFAQs(!showAllFAQs); setOpenFaq(null); }} className="border-0 bg-transparent p-0 text-sm font-bold text-[#02665e]">
                          {showAllFAQs ? "Show fewer" : `Show ${filteredFAQs.length - 10} more`}
                        </button>
                      </div>
                    )}
                  </section>
                </>
              )}
            </main>

            {/* Contact */}
            <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
              <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
                <div className="flex items-center gap-3 px-5 pt-5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#012a26] text-[#5eead4]"><MessageCircle className="h-[18px] w-[18px]" aria-hidden /></span>
                  <div>
                    <p className="m-0 text-sm font-bold text-slate-900">Still need help?</p>
                    <p className="m-0 text-xs text-slate-500">We usually reply within 24 hours.</p>
                  </div>
                </div>
                <form onSubmit={submitContact} className="space-y-3 p-5">
                  <input id="contact-name" type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Your name (optional)" aria-label="Your name"
                    className="box-border h-10 w-full rounded-xl border border-solid border-slate-200 bg-white px-3.5 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                  <input id="contact-email" type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Your email" aria-label="Your email"
                    className="box-border h-10 w-full rounded-xl border border-solid border-slate-200 bg-white px-3.5 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                  <textarea id="contact-message" required value={contactMessage} onChange={(e) => setContactMessage(e.target.value)} rows={4} placeholder="Tell us what you need" aria-label="Message"
                    className="box-border w-full resize-none rounded-xl border border-solid border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                  <button type="submit" disabled={sending} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border-0 bg-[#02665e] text-sm font-bold text-white hover:bg-[#014d47] disabled:opacity-50">
                    Send message <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                  {sent && <p className="m-0 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs leading-5 text-emerald-800">{sent}</p>}
                  {error && <p className="m-0 rounded-xl bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700">{error}</p>}
                </form>
                <a href="mailto:info@nolsaf.com" className="flex items-center gap-3 border-0 border-t border-solid border-slate-100 px-5 py-3.5 no-underline hover:bg-slate-50">
                  <Mail className="h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
                  <span className="text-sm font-bold text-[#02665e]">info@nolsaf.com</span>
                </a>
              </section>

              <section className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
                <p className="m-0 mb-2 text-sm font-bold text-slate-900">Popular guides</p>
                <ul className="m-0 list-none space-y-0.5 p-0">
                  {[
                    { href: "/help/getting-started", label: "Make your first booking" },
                    { href: "/help/payments", label: "Accepted payment methods" },
                    { href: "/help/refunds", label: "Cancellations and refunds" },
                    { href: "/help/owner-guide", label: "Property owner guide" },
                    { href: "/help/become-agent", label: "Become a NoLSAF agent" },
                    { href: "/help/nolsaf-stand", label: "Register a safari stand" },
                  ].map(({ href, label }) => (
                    <li key={href}>
                      <Link href={withHelpCtx(href)} className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-slate-600 no-underline hover:bg-slate-50 hover:text-[#02665e]">
                        <span className="truncate">{label}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-[#02665e]" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </div>
      </div>
      <HelpFooter />
    </>
  );
}
