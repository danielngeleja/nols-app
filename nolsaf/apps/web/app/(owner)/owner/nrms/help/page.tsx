"use client";

// The NRMS guide, driven by the property's live state rather than static copy:
// a setup checklist that ticks itself off, module cards that link into the
// workspace with today's numbers, one search box over every answer, the
// reader's own role called out, and support links that carry the property so
// nobody has to explain which hotel they mean.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowRight, BadgeCheck, BarChart3, BedDouble, CalendarDays, Check, CheckCircle2, ChevronDown,
  ClipboardList, DoorOpen, FileText, Headset, Loader2, LogIn, LogOut, Mail, MessageCircle, Package, Phone,
  QrCode, ReceiptText, RefreshCw, Search, ShieldCheck, Store, Users, UsersRound, WalletCards, X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type GuideState = {
  property: { id: number; title: string; currency: string | null; nightAuditCloseTime: string; menuPublic: boolean };
  role: string;
  setup: {
    roomTypes: number; roomUnits: number; activeStaff: number | null; pendingInvites: number | null; outlets: number;
    menuItems: number; orderPoints: number; reservations: number; closedBusinessDays: number; fiscalMode: string | null;
  };
  today: { arrivals: number; departures: number; inHouse: number };
  generatedAt: string;
};

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner", MANAGER: "Manager", SALES_EXECUTIVE: "Sales executive", FRONT_DESK: "Front desk",
  RESTAURANT: "Restaurant", BAR: "Bar", OUTLET_SUPERVISOR: "Outlet supervisor", STOREKEEPER: "Storekeeper",
};

const ROLES: Array<{ key: string; scope: string }> = [
  { key: "OWNER", scope: "Full access to every part of the workspace, including billing and staff." },
  { key: "MANAGER", scope: "Same operational reach as the owner: outlets, staff, housekeeping, finance and front desk." },
  { key: "SALES_EXECUTIVE", scope: "Inquiries, group business and agencies, with their own sales performance." },
  { key: "FRONT_DESK", scope: "Reservations, check-in, check-out, cashier shifts and the Night Audit. Can view outlet orders but not place them." },
  { key: "RESTAURANT", scope: "Orders for restaurant outlets." },
  { key: "BAR", scope: "Orders for bar outlets." },
  { key: "OUTLET_SUPERVISOR", scope: "Orders and menu management for one assigned outlet." },
  { key: "STOREKEEPER", scope: "Stock, receiving, transfers, counts and purchasing." },
];

type GuideStep = { title: string; text: string };
type GuideSection = { id: string; title: string; subtitle: string; icon: typeof ClipboardList; tone: string; href?: { label: string; to: string }[]; steps: GuideStep[] };

const SECTIONS: GuideSection[] = [
  {
    id: "reservations", title: "Running a reservation", subtitle: "From creating a stay to settling and checking out.", icon: ClipboardList, tone: "bg-blue-600",
    href: [{ label: "Reservations", to: "/owner/nrms/reservations" }, { label: "Room calendar", to: "/owner/nrms/calendar" }],
    steps: [
      { title: "Create the reservation", text: "Pick a source (walk-in, phone, direct or OTA), attach a guest, and choose room types and dates. It starts as Held or Confirmed." },
      { title: "Confirm and assign rooms", text: "Held reservations move to Confirmed once availability is re-checked. Every room needs a specific unit before check-in." },
      { title: "Check the guest in", text: "Blocked if the assigned room isn't clean or inspected, though front desk can override when needed." },
      { title: "Move rooms anytime", text: "Reassign a stay to a different unit without losing its history." },
      { title: "Settle and check out", text: "Any unpaid balance, unclassified outlet payment or unverified charge must be cleared first." },
      { title: "Cancel or mark no-show", text: "Releases the rooms and never bills. Available from Draft, Held or Confirmed." },
    ],
  },
  {
    id: "outlets", title: "Restaurant, bar and QR ordering", subtitle: "Set up outlets and menus, then let guests order by scanning a code.", icon: QrCode, tone: "bg-violet-600",
    href: [{ label: "Outlets and menus", to: "/owner/nrms/outlets" }, { label: "QR order points", to: "/owner/nrms/qr-codes" }, { label: "Live orders", to: "/owner/nrms/orders" }],
    steps: [
      { title: "Create an outlet", text: "Add a restaurant or bar as owner or manager, with its own currency if it differs from the property's." },
      { title: "Add your menu", text: "Set item names, prices, categories and stock status. Outlet supervisors can maintain it too." },
      { title: "Generate QR order points", text: "One per room in bulk, or standalone points for shared areas, each with a rotatable code and a printable sheet." },
      { title: "Guests scan and order", text: "They see the live menu and pay at the counter, or charge the room if checked in and the name matches." },
      { title: "Turn on auto-accept if you want", text: "Orders confirm automatically instead of waiting for staff to accept each one." },
    ],
  },
  {
    id: "finance", title: "Closing the day", subtitle: "Cashier shifts, Night Audit and the ledger.", icon: WalletCards, tone: "bg-emerald-700",
    href: [{ label: "Night Audit", to: "/owner/nrms/finance?view=audit" }, { label: "Cashier variance", to: "/owner/nrms/finance?view=cashiers" }, { label: "Reports", to: "/owner/nrms/reports" }],
    steps: [
      { title: "Each cashier opens a shift", text: "The business date is set by the server clock and the Night Audit cutoff, never typed in." },
      { title: "Close the shift with a physical count", text: "Expected cash is frozen at close. Any overage or shortage needs a written explanation." },
      { title: "Managers sign off shifts", text: "Sign-off confirms the sales are authentic. It is recorded and cannot be undone." },
      { title: "Run Night Audit after the cutoff", text: "Every blocker must clear. Closing posts a balanced ledger, locks the date and opens the next one." },
      { title: "Export the reports", text: "Reports builds sealed PDF packs and an Excel workbook for the owner, accountant or auditor." },
    ],
  },
  {
    id: "billing", title: "How PAYG billing works", subtitle: "Pay only for external room-nights, tracked in a clear ledger.", icon: ReceiptText, tone: "bg-teal-700",
    href: [{ label: "NRMS billing", to: "/owner/nrms/billing" }],
    steps: [], // filled from the live usage policy
  },
];

function buildBillingSteps(trialDays: number | undefined, currency: string | undefined, roomNightPrice: string | number | undefined): GuideStep[] {
  const hasTrial = typeof trialDays === "number" && trialDays > 0;
  const price = currency && roomNightPrice != null ? `${currency} ${Number(roomNightPrice).toLocaleString()} per external room-night${hasTrial ? " after the trial" : ""}` : "the rate shown when you activate";
  return [
    { title: hasTrial ? "Trial starts on activation" : "Usage policy starts on activation", text: hasTrial ? `Your ${trialDays}-day trial begins the moment you activate NRMS on this property.` : "PAYG terms begin when you activate NRMS on this property." },
    { title: "Usage is tracked nightly", text: "Only external room-nights are metered. NoLSAF bookings carry no NRMS fee." },
    { title: "A statement opens when due", text: `When charges reach the statement threshold, a payable statement is issued, charged at ${price}.` },
    { title: "Pay by mobile money, bank or card", text: "Settle the statement from NRMS billing, and operations continue." },
  ];
}

function buildFaqs(trialDays: number | undefined) {
  const hasTrial = typeof trialDays === "number" && trialDays > 0;
  return [
    { q: "Does NRMS charge anything for NoLSAF bookings?", a: "No. NRMS usage fees apply only to external room-nights you record. Your marketplace commission is unaffected." },
    { q: hasTrial ? `What happens after the ${trialDays}-day trial?` : "How does NRMS PAYG billing work?", a: "Usage is tracked and billed under your active PAYG policy. Pay statements as they're issued, from NRMS billing." },
    { q: "Can I lose NRMS access?", a: "Yes, if the property's Marketplace approval is withdrawn, or the account is frozen for unpaid usage past the limit. Both are reversible once resolved." },
    { q: "Where do I see what I owe?", a: "Open NRMS billing from the Finance section. Every statement, token and payment is listed there." },
    { q: "Why can't I check a guest in?", a: "Usually the assigned room isn't marked clean or inspected yet. Update it in Housekeeping, or front desk can override." },
    { q: "Why won't Night Audit close?", a: "Open the review. Each blocker names what's wrong, such as an open cashier shift or an unclassified outlet payment, and links to the fix." },
    { q: "Do I need TRA fiscal receipts?", a: "Only if the business is VAT-registered. It's switched on from the Tax register in Finance and is off by default." },
    { q: "How do I invite staff?", a: "From Staff and roles, by email. The person needs a NoLSAF account under that email and must accept the invite before the role applies." },
  ];
}

const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255736766726";
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@nolsaf.com";

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark className="rounded bg-amber-100 px-0.5 text-inherit">{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}

function SectionHead({ icon: Icon, tone, title, subtitle, right }: { icon: typeof ClipboardList; tone: string; title: string; subtitle: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${tone}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-base font-bold text-neutral-950 sm:text-lg">{title}</h2>
        <p className="m-0 mt-0.5 text-xs text-neutral-500 sm:text-sm">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

export default function NrmsHelpPage() {
  const { usagePolicy, selectedPropertyId, selectedProperty } = useNrms();
  const [state, setState] = useState<GuideState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ reservations: true });
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<GuideState>(`/api/owner/nrms/guide/property/${selectedPropertyId}`);
      setState(response.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load the live status for this property.");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);
  useEffect(() => { void load(); }, [load]);

  const role = state?.role ?? selectedProperty?.nrmsAccessRole ?? "OWNER";
  const managerView = role === "OWNER" || role === "MANAGER";
  const billingSteps = buildBillingSteps(usagePolicy?.trialDays, usagePolicy?.currency, usagePolicy?.roomNightPrice);
  const faqs = buildFaqs(usagePolicy?.trialDays);
  const sections = SECTIONS.map((section) => (section.id === "billing" ? { ...section, steps: billingSteps } : section)).filter((section) => section.id !== "billing" || role === "OWNER");
  const s = state?.setup;

  // Setup checklist. Each item is true or false from the live counts, and
  // links straight to where it gets done. Staff roles only see it read-only.
  const checklist = useMemo(() => {
    if (!s || !state) return [];
    return [
      { key: "currency", title: "Property currency set", detail: state.property.currency ? `Trading in ${state.property.currency}` : "Needed before any cashier shift opens", done: Boolean(state.property.currency), href: "/owner/nrms/rooms", optional: false },
      { key: "rooms", title: "Rooms configured", detail: s.roomUnits ? `${s.roomTypes} room ${s.roomTypes === 1 ? "type" : "types"} · ${s.roomUnits} ${s.roomUnits === 1 ? "unit" : "units"}` : "Add room types and their units", done: s.roomTypes > 0 && s.roomUnits > 0, href: "/owner/nrms/rooms", optional: false },
      { key: "staff", title: "Staff invited", detail: s.activeStaff == null ? "Managed by the owner" : s.activeStaff ? `${s.activeStaff} active${s.pendingInvites ? ` · ${s.pendingInvites} awaiting acceptance` : ""}` : s.pendingInvites ? `${s.pendingInvites} invite${s.pendingInvites === 1 ? "" : "s"} awaiting acceptance` : "Invite front desk and outlet staff", done: (s.activeStaff ?? 0) > 0, href: "/owner/nrms/staff", optional: false },
      { key: "outlet", title: "Restaurant or bar set up", detail: s.outlets ? `${s.outlets} ${s.outlets === 1 ? "outlet" : "outlets"} · ${s.menuItems} menu ${s.menuItems === 1 ? "item" : "items"}` : "Skip if the property has no restaurant or bar", done: s.outlets > 0 && s.menuItems > 0, href: "/owner/nrms/outlets", optional: true },
      { key: "qr", title: "QR order points printed", detail: s.orderPoints ? `${s.orderPoints} active ${s.orderPoints === 1 ? "point" : "points"}` : "Let guests order from their room", done: s.orderPoints > 0, href: "/owner/nrms/qr-codes", optional: true },
      { key: "reservation", title: "First reservation recorded", detail: s.reservations ? `${s.reservations} reservations so far` : "Record a walk-in, phone or OTA stay", done: s.reservations > 0, href: "/owner/nrms/reservations", optional: false },
      { key: "audit", title: "First business day closed", detail: s.closedBusinessDays ? `${s.closedBusinessDays} days closed by Night Audit` : `Run Night Audit after the ${state.property.nightAuditCloseTime} EAT cutoff`, done: s.closedBusinessDays > 0, href: "/owner/nrms/finance?view=audit", optional: false },
      { key: "fiscal", title: "TRA fiscal receipts", detail: s.fiscalMode == null ? "Managed by the owner" : s.fiscalMode !== "OFF" ? "Switched on" : "Only for VAT-registered businesses", done: s.fiscalMode != null && s.fiscalMode !== "OFF", href: "/owner/nrms/finance?view=tax", optional: true },
    ];
  }, [s, state]);
  const required = checklist.filter((item) => !item.optional);
  const requiredDone = required.filter((item) => item.done).length;
  const nextStep = required.find((item) => !item.done) ?? null;

  const modules = [
    { icon: DoorOpen, title: "Front desk", text: "Arrivals, room assignment, check-in and checkout.", href: "/owner/nrms/reservations", stat: state ? `${state.today.arrivals} arriving · ${state.today.departures} leaving today` : null },
    { icon: CalendarDays, title: "Room calendar", text: "NoLSAF bookings, external stays and blocks together.", href: "/owner/nrms/calendar", stat: state ? `${state.today.inHouse} in house now` : null },
    { icon: Users, title: "Guests", text: "Guest details, stay history, payments and balances.", href: "/owner/nrms/guests", stat: s ? `${s.reservations} reservations recorded` : null },
    { icon: BedDouble, title: "Rooms and housekeeping", text: "Room types, units and cleaning status.", href: "/owner/nrms/housekeeping", stat: s ? `${s.roomUnits} active ${s.roomUnits === 1 ? "unit" : "units"}` : null },
    { icon: Store, title: "Restaurant and bar", text: "Outlet orders, menus and QR ordering.", href: "/owner/nrms/orders", stat: s ? `${s.outlets} ${s.outlets === 1 ? "outlet" : "outlets"} · ${s.orderPoints} QR points` : null },
    { icon: Package, title: "Stock and purchasing", text: "Stock levels, receiving, counts and suppliers.", href: "/owner/nrms/stock", stat: null },
    { icon: UsersRound, title: "Staff and roles", text: "Invite staff scoped to their role.", href: "/owner/nrms/staff", stat: s?.activeStaff != null ? `${s.activeStaff} active staff` : null },
    { icon: WalletCards, title: "Finance and Night Audit", text: "Shifts, daily close, ledger and tax.", href: "/owner/nrms/finance?view=audit", stat: s ? `${s.closedBusinessDays} days closed` : null },
    { icon: BarChart3, title: "Reports", text: "Sealed PDF packs and the Excel workbook.", href: "/owner/nrms/reports", stat: null },
  ];

  // One search across every answer on the page. A few dozen short strings, so
  // it runs on each render rather than being memoised.
  const q = query.trim();
  const results = (() => {
    if (q.length < 2) return [];
    const needle = q.toLowerCase();
    const hits: Array<{ area: string; title: string; text: string; href?: string }> = [];
    for (const section of sections) for (const step of section.steps) if (`${step.title} ${step.text}`.toLowerCase().includes(needle)) hits.push({ area: section.title, title: step.title, text: step.text, href: section.href?.[0]?.to });
    for (const item of modules) if (`${item.title} ${item.text}`.toLowerCase().includes(needle)) hits.push({ area: "Workspace", title: item.title, text: item.text, href: item.href });
    for (const item of ROLES) if (`${ROLE_LABEL[item.key]} ${item.scope}`.toLowerCase().includes(needle)) hits.push({ area: "Roles", title: ROLE_LABEL[item.key]!, text: item.scope, href: "/owner/nrms/staff" });
    for (const item of faqs) if (`${item.q} ${item.a}`.toLowerCase().includes(needle)) hits.push({ area: "Questions", title: item.q, text: item.a });
    return hits;
  })();

  const payg = selectedProperty?.nrmsPaygAccount ?? null;
  const trialDaysLeft = payg?.trialEndsAt ? Math.ceil((new Date(payg.trialEndsAt).getTime() - Date.now()) / 86_400_000) : null;
  const unpaid = Number(payg?.unpaidBalance ?? 0);
  const unpaidLimit = Number(payg?.unpaidLimit ?? 0);
  const supportText = encodeURIComponent(`Hello NoLSAF support, I need help with NRMS for ${state?.property.title ?? selectedProperty?.title ?? "my property"} (property ${selectedPropertyId ?? ""}, ${ROLE_LABEL[role] ?? role}).`);

  return (
    <div id="nrms-guide" className="mx-auto w-full max-w-6xl space-y-6 pb-10">
      <style>{`#nrms-guide, #nrms-guide * { box-sizing: border-box; } #nrms-guide [class~="border"] { border-style: solid; }`}</style>

      {/* Hero: who and where, plus the search that answers anything below. */}
      <header className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[linear-gradient(120deg,#102b3a_0%,#123f49_65%,#075e54_100%)] p-5 text-white shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200">NRMS guide</p>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-3xl">Everything about running NRMS</h1>
            <p className="mb-0 mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-200 sm:text-sm">
              <span className="font-semibold text-white">{state?.property.title ?? selectedProperty?.title ?? "Your property"}</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-emerald-100"><ShieldCheck className="h-3 w-3" />You are {ROLE_LABEL[role] ?? role}</span>
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh live status" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
        <label className="relative mt-5 flex h-12 items-center rounded-xl bg-white px-3.5 text-neutral-900 shadow-sm focus-within:ring-4 focus-within:ring-emerald-300/40">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the guide: check-in, night audit, QR, billing, staff…" aria-label="Search the guide" className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm outline-none" />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-neutral-100 text-neutral-500 hover:text-neutral-900"><X className="h-3.5 w-3.5" /></button>}
        </label>
        {!q && (
          <nav aria-label="Guide sections" className="mt-3 flex flex-wrap gap-1.5">
            {[["setup", "Setup"], ["workspace", "Workspace"], ...sections.map((section) => [section.id, section.title] as [string, string]), ["roles", "Roles"], ["faq", "Questions"], ["support", "Support"]].map(([id, text]) => (
              <a key={id} href={`#guide-${id}`} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white no-underline transition hover:bg-white/20">{text}</a>
            ))}
          </nav>
        )}
      </header>

      {error && <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" /><span className="flex-1">{error} The guide below still works.</span><button type="button" onClick={() => void load()} className="rounded-lg border-0 bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900">Try again</button></div>}

      {q ? (
        /* Search results replace the page until the box is cleared. */
        <section aria-live="polite">
          <p className="m-0 mb-3 text-sm text-neutral-600">{results.length ? <><strong className="text-neutral-900">{results.length}</strong> {results.length === 1 ? "answer" : "answers"} for “{q}”</> : q.length < 2 ? "Keep typing…" : <>No answers for “{q}”. Try another word, or <a href="#guide-support" onClick={() => setQuery("")} className="font-semibold text-emerald-700">contact support</a>.</>}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {results.map((hit, index) => (
              <article key={`${hit.area}-${hit.title}-${index}`} className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4">
                <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{hit.area}</p>
                <h3 className="m-0 mt-1 text-sm font-bold text-neutral-900"><Highlight text={hit.title} query={q} /></h3>
                <p className="m-0 mt-1 flex-1 text-xs leading-5 text-neutral-600"><Highlight text={hit.text} query={q} /></p>
                {hit.href && <Link href={hit.href} className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 no-underline hover:gap-2">Open <ArrowRight className="h-3.5 w-3.5" /></Link>}
              </article>
            ))}
          </div>
        </section>
      ) : <>
        {/* Live setup checklist */}
        <section id="guide-setup" className="scroll-mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-base font-bold text-neutral-950 sm:text-lg">{loading && !state ? "Checking your setup…" : requiredDone === required.length ? "Your property is fully set up" : `${requiredDone} of ${required.length} setup steps done`}</h2>
              <p className="m-0 mt-0.5 text-xs text-neutral-500 sm:text-sm">{nextStep ? <>Next: <strong className="text-neutral-800">{nextStep.title}</strong></> : "Optional extras are listed below if you need them."}</p>
            </div>
            {nextStep && managerView && <Link href={nextStep.href} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#073c35] px-4 text-xs font-bold text-white no-underline transition hover:bg-emerald-800">Continue setup <ArrowRight className="h-4 w-4" /></Link>}
          </div>
          <div className="mx-4 mb-4 flex h-2 gap-1 sm:mx-5" aria-hidden="true">
            {required.map((item) => <span key={item.key} className={`h-full flex-1 rounded-full ${item.done ? "bg-emerald-500" : "bg-neutral-200"}`} />)}
          </div>
          {loading && !state ? (
            <div className="flex items-center gap-2 px-5 pb-5 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" />Reading this property's setup</div>
          ) : (
            <ul className="m-0 grid list-none gap-px bg-neutral-100 p-0 sm:grid-cols-2">
              {checklist.map((item) => (
                <li key={item.key} className="flex items-center gap-3 bg-white px-4 py-3 sm:px-5">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${item.done ? "bg-emerald-600 text-white" : item.optional ? "border border-dashed border-neutral-300 text-neutral-300" : "border border-neutral-300 text-neutral-300"}`}>{item.done ? <Check className="h-4 w-4" /> : null}</span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-neutral-900">{item.title}{item.optional && <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Optional</span>}</p>
                    <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{item.detail}</p>
                  </div>
                  {!item.done && managerView && <Link href={item.href} className="shrink-0 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 no-underline transition hover:border-emerald-300 hover:bg-emerald-50">Set up</Link>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Today strip */}
        {state && (
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: LogIn, label: "Arriving today", value: state.today.arrivals, href: "/owner/nrms/reservations", tone: "bg-sky-50 text-sky-700" },
              { icon: LogOut, label: "Leaving today", value: state.today.departures, href: "/owner/nrms/reservations", tone: "bg-amber-50 text-amber-700" },
              { icon: BedDouble, label: "In house now", value: state.today.inHouse, href: "/owner/nrms/calendar", tone: "bg-emerald-50 text-emerald-700" },
            ].map(({ icon: Icon, label: text, value, href, tone }) => (
              <Link key={text} href={href} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 no-underline transition hover:border-emerald-300">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1"><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-slate-500">{text}</p><p className="m-0 mt-0.5 text-lg font-bold tabular-nums text-slate-950">{value}</p></div>
                <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-600" />
              </Link>
            ))}
          </section>
        )}

        {/* Workspace modules, each a live link */}
        <section id="guide-workspace" className="scroll-mt-4">
          <SectionHead icon={CheckCircle2} tone="bg-[#02665e]" title="Your workspace" subtitle="Every part of running the property. Click any card to open it." />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map(({ icon: Icon, title, text, href, stat }) => (
              <Link key={title} href={href} className="group flex flex-col rounded-xl border border-neutral-200 bg-white p-4 no-underline transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_14px_30px_-24px_rgba(15,23,42,0.5)]">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="m-0 text-sm font-bold text-neutral-900">{title}</h3>
                    <p className="m-0 mt-0.5 text-xs leading-5 text-neutral-500">{text}</p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-600" />
                </div>
                {stat && <p className="m-0 mt-3 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-[11px] font-semibold tabular-nums text-neutral-700">{stat}</p>}
              </Link>
            ))}
          </div>
        </section>

        {/* How-to guides as collapsible sections */}
        {sections.map((section) => {
          const isOpen = Boolean(open[section.id]);
          return (
            <section key={section.id} id={`guide-${section.id}`} className="scroll-mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen((current) => ({ ...current, [section.id]: !isOpen }))} className="flex w-full items-center gap-3 border-0 bg-transparent p-4 text-left sm:p-5">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${section.tone}`}><section.icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-base font-bold text-neutral-950">{section.title}</span><span className="mt-0.5 block text-xs text-neutral-500 sm:text-sm">{section.subtitle} · {section.steps.length} steps</span></span>
                <ChevronDown className={`h-5 w-5 shrink-0 text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && <>
                <ol className="m-0 list-none p-0">
                  {section.steps.map((step, index) => (
                    <li key={step.title} className="flex items-start gap-3.5 px-4 py-3.5 shadow-[inset_0_1px_0_0_#f1f1f1] sm:px-5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold tabular-nums text-white">{index + 1}</span>
                      <div className="min-w-0"><p className="m-0 text-sm font-semibold text-neutral-900">{step.title}</p><p className="m-0 mt-0.5 text-xs leading-5 text-neutral-500">{step.text}</p></div>
                    </li>
                  ))}
                </ol>
                {section.id === "billing" && payg && (
                  <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 sm:px-5">
                    <div className="rounded-xl bg-neutral-50 p-3.5"><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Account status</p><p className="m-0 mt-1 text-sm font-bold text-neutral-900">{payg.status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</p><p className="m-0 mt-0.5 text-xs text-neutral-500">{trialDaysLeft != null && trialDaysLeft > 0 ? `Trial ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}` : "Trial finished"}</p></div>
                    <div className="rounded-xl bg-neutral-50 p-3.5"><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Unpaid usage</p><p className={`m-0 mt-1 text-sm font-bold tabular-nums ${unpaidLimit > 0 && unpaid / unpaidLimit > 0.8 ? "text-amber-700" : "text-neutral-900"}`}>{usagePolicy?.currency ?? ""} {unpaid.toLocaleString()}</p>{unpaidLimit > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200"><div className={`h-full rounded-full ${unpaid / unpaidLimit > 0.8 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (unpaid / unpaidLimit) * 100)}%` }} /></div>}<p className="m-0 mt-1 text-[11px] text-neutral-500">Limit {usagePolicy?.currency ?? ""} {unpaidLimit.toLocaleString()} before access pauses</p></div>
                  </div>
                )}
                {section.href && <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">{section.href.map((link) => <Link key={link.to} href={link.to} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 no-underline transition hover:border-emerald-300 hover:bg-emerald-50">{link.label} <ArrowRight className="h-3.5 w-3.5" /></Link>)}</div>}
              </>}
            </section>
          );
        })}

        {/* Roles, with the reader's own role called out */}
        <section id="guide-roles" className="scroll-mt-4">
          <SectionHead icon={ShieldCheck} tone="bg-rose-600" title="Roles and permissions" subtitle="What each role can see and do once invited." right={managerView ? <Link href="/owner/nrms/staff" className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 no-underline">Manage staff <ArrowRight className="h-3.5 w-3.5" /></Link> : undefined} />
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((item) => {
              const mine = item.key === role;
              return (
                <div key={item.key} className={`flex items-start gap-3 rounded-xl border p-3.5 ${mine ? "border-emerald-300 bg-emerald-50" : "border-neutral-200 bg-white"}`}>
                  <span className={`mt-0.5 inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${mine ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-700"}`}>{ROLE_LABEL[item.key]}</span>
                  <p className="m-0 text-xs leading-5 text-neutral-600">{item.scope}{mine && <strong className="mt-0.5 block text-emerald-800">This is your role.</strong>}</p>
                </div>
              );
            })}
          </div>
          <p className="m-0 mt-3 text-xs leading-5 text-neutral-500">Invite by email. The person needs a NoLSAF account under that email and must accept before the role applies. Outlet roles also need an outlet chosen. Revoking access needs a reason and is recorded.</p>
        </section>

        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <BadgeCheck className="h-5 w-5 shrink-0 text-amber-600" />
          <div><p className="m-0 text-sm font-semibold text-amber-900">NRMS stays tied to your Marketplace listing</p><p className="m-0 mt-1 text-xs leading-5 text-amber-800">It opens while the property is approved, and pauses if approval is withdrawn or usage goes unpaid past the limit. Both are reversible once resolved.</p></div>
        </div>

        {/* FAQ accordion */}
        <section id="guide-faq" className="scroll-mt-4">
          <SectionHead icon={FileText} tone="bg-neutral-700" title="Frequently asked" subtitle="The questions owners and staff ask most." />
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            {faqs.map((item, index) => {
              const isOpen = openFaq === index;
              return (
                <div key={item.q} className={index ? "shadow-[inset_0_1px_0_0_#f1f1f1]" : ""}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpenFaq(isOpen ? null : index)} className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3.5 text-left sm:px-5">
                    <span className="min-w-0 flex-1 text-sm font-semibold text-neutral-900">{item.q}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && <p className="m-0 px-4 pb-4 text-xs leading-5 text-neutral-600 sm:px-5">{item.a}</p>}
                </div>
              );
            })}
          </div>
        </section>
      </>}

      {/* Support, pre-filled with the property so nobody has to explain it */}
      <section id="guide-support" className="scroll-mt-4 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <SectionHead icon={Headset} tone="bg-[#02b4f5]" title="Still need a hand?" subtitle="Reach a real person. Your property and role are included automatically." />
        <div className="grid gap-3 sm:grid-cols-3">
          <a href={`https://wa.me/${SUPPORT_PHONE.replace(/[^\d]/g, "")}?text=${supportText}`} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 no-underline transition hover:border-emerald-300">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 transition group-hover:bg-emerald-600"><MessageCircle className="h-4 w-4 text-emerald-600 group-hover:text-white" /></span>
            <span><span className="block text-xs font-bold text-neutral-900">WhatsApp</span><span className="block text-[11px] text-neutral-500">Fastest way to reach us</span></span>
          </a>
          <a href={`tel:${SUPPORT_PHONE}`} className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 no-underline transition hover:border-sky-300">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 transition group-hover:bg-sky-500"><Phone className="h-4 w-4 text-sky-600 group-hover:text-white" /></span>
            <span><span className="block text-xs font-bold text-neutral-900">Call us</span><span className="block text-[11px] text-neutral-500">{process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255 736 766 726"}</span></span>
          </a>
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`NRMS help: ${state?.property.title ?? selectedProperty?.title ?? "property"}`)}&body=${supportText}`} className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 no-underline transition hover:border-neutral-300">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 transition group-hover:bg-neutral-700"><Mail className="h-4 w-4 text-neutral-600 group-hover:text-white" /></span>
            <span><span className="block text-xs font-bold text-neutral-900">Email us</span><span className="block text-[11px] text-neutral-500">Replies within 24 hours</span></span>
          </a>
        </div>
      </section>
    </div>
  );
}
