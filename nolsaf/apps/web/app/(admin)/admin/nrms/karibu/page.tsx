"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ArrowLeft,
  BedDouble,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Coffee,
  Gift,
  HandCoins,
  Loader2,
  Power,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import api from "@/lib/apiClient";
import TablePagination from "@/components/TablePagination";

type Settings = { enabled: boolean; budgetPercent: number; contributionFloor: number; perStayCap: number; monthlyCap: number; propertyMonthlyCap: number; holdoutPercent: number };
type GiftRow = {
  id: number; status: string; payableStatus: string; partnerPrice: number; issuedAt: string; servedAt: string | null; paidAt: string | null; paymentReference: string | null;
  guestFeedback: { received: boolean; rating: number | null; note: string | null; at: string } | null;
  bookingReference: string; guestName: string | null; bookingStatus: string | null; stay: { checkIn: string; checkOut: string } | null;
  property: { id: number; title: string; city: string | null }; drink: string;
};
type Overview = {
  settings: Settings; recent: GiftRow[]; payable: { amount: number; count: number }; refundRisk: { amount: number; count: number };
  metrics: { totalProperties: number; ordered: number; served: number; participating: number; ready: number; monthCommitted: number; monthGifts: number };
};
type PropertyRow = { id: number; title: string; city: string | null; enabled: boolean; agreedAt: string | null; optionCount: number };
type Option = { id: number; menuItemId: number; partnerPrice: string; enabled: boolean; name?: string; outletName?: string; menuPrice?: string; liked?: boolean; conflict?: string | null };
type GuestPrefs = { drinkLikes: string[]; dietaryTags: string[]; dietaryNote: string | null; birthdayInStay: boolean; hasPreferences: boolean };
type MenuItem = { id: number; name: string; category?: string | null; price: string; inStock: boolean; pilotEligible: boolean; skipReason?: string | null; looksLikeDrink?: boolean };
type PropertyDetail = { config: { enabled: boolean; agreedAt: string | null }; options: Option[]; acceptedCategories?: string[]; outlets: Array<{ id: number; name: string; menuItems: MenuItem[] }> };
type Arrival = { reference: string; guestName: string | null; checkIn: string; checkOut: string; property: { title: string; city: string | null }; gift: string | null };
type Preview = {
  eligible: boolean; reason: string | null; booking: { reference: string; property: string; guestName: string | null; checkIn: string; checkOut: string } | null;
  commission: number | null; feeEstimate: number | null; attributedCost: number | null; contribution: number; budget: number; monthRemaining: number | null; options: Option[]; guest?: GuestPrefs | null;
};
type Tab = "welcome" | "gifts" | "properties" | "controls";
type GiftView = "serving" | "due" | "paid" | "all";
type PropertyFilter = "all" | "ready" | "needs_drinks" | "off";
type Paged<T> = { rows: T[]; total: number; page: number; loading: boolean };

const PAGE_SIZE = 20;
const ARRIVALS_PAGE_SIZE = 10;
const fieldClass = "min-h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 disabled:bg-neutral-50";
const actionClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 shadow-sm no-underline transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const primaryClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const heroButton = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";
const cardClass = "rounded-2xl border border-solid border-neutral-200 bg-white";
const headCell = "px-4 py-2.5 text-[11px] font-semibold text-neutral-400";

const REASONS: Record<string, string> = {
  PROGRAM_DISABLED: "The pilot is switched off. Turn it on in Pilot controls.",
  PROPERTY_NOT_ENROLLED: "This property has not joined the pilot.",
  NOT_FIRST_STAY: "This guest has already stayed with NoLSAF. The welcome is for a first stay only.",
  BOOKING_NOT_FOUND: "No booking matches this reference.",
  CHECK_IN_REQUIRED: "The guest must be checked in first.",
  PAID_COMMISSION_REQUIRED: "The booking has no paid commission yet.",
  BUDGET_TOO_LOW: "This booking does not leave enough net contribution for a gift.",
  NO_APPROVED_DRINKS: "This property has no approved drinks yet.",
  NO_AVAILABLE_DRINKS: "The approved drinks are out of stock or unavailable at the outlet.",
  NO_AFFORDABLE_OPTION: "No approved drink fits this booking's gift budget.",
  MONTHLY_CAP_REACHED: "This month's spending limit has been reached.",
  PILOT_HOLDOUT: "This guest is in the measurement group that does not receive a gift.",
  ALREADY_ISSUED: "A gift has already been issued for this booking.",
  ACCOUNT_LINKED_INDIVIDUAL_ONLY: "The pilot covers one-room bookings made from a guest account.",
  NRMS_PROPERTY_REQUIRED: "This booking is not at an active NRMS property.",
  TZS_ONLY: "The pilot supports TZS properties only.",
};

const DRINK_LABEL: Record<string, string> = { TEA_COFFEE: "tea or coffee", FRESH_JUICE: "fresh juice", SOFT_DRINK: "soft drinks", WATER: "water", MOCKTAIL: "mocktails" };
const DIETARY_LABEL: Record<string, string> = { NO_SUGAR: "No sugar", LACTOSE_FREE: "Lactose-free", NUT_ALLERGY: "Nut allergy", VEGETARIAN: "Vegetarian" };

const GIFT_VIEWS: Array<{ key: GiftView; label: string }> = [
  { key: "serving", label: "Awaiting service" },
  { key: "due", label: "Repayment due" },
  { key: "paid", label: "Repaid" },
  { key: "all", label: "All gifts" },
];

const PROPERTY_FILTERS: Array<{ key: PropertyFilter; label: string; hint: string; text: string; bar: string }> = [
  { key: "all", label: "All NRMS", hint: "Approved NRMS properties", text: "text-neutral-700", bar: "bg-neutral-400" },
  { key: "ready", label: "Ready", hint: "Enrolled with approved drinks", text: "text-emerald-700", bar: "bg-emerald-500" },
  { key: "needs_drinks", label: "Needs drinks", hint: "Enrolled, no drink approved", text: "text-amber-700", bar: "bg-amber-400" },
  { key: "off", label: "Not enrolled", hint: "Not taking part yet", text: "text-neutral-500", bar: "bg-neutral-300" },
];

const money = (value: number | string | null | undefined) => `TZS ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const day = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Dar_es_Salaam" }) : "Not set");
const fullDay = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "Not yet");
const nights = (from: string, to: string) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));
// "HOLLAND HOTEL" reads as "Holland Hotel"; mixed-case names are left alone.
const tidy = (value: string | null | undefined) => {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
};
const initials =(name: string | null | undefined) => (String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "G");

function failureText(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) {
    window.dispatchEvent(new CustomEvent("finance-grant-required"));
    return "Verify finance access, then retry this action.";
  }
  return cause?.response?.data?.error || fallback;
}

function giftState(gift: GiftRow) {
  if (gift.status === "VOIDED") return { label: "Voided", dot: "bg-neutral-300", text: "text-neutral-500" };
  if (gift.status === "ORDERED") return { label: "Awaiting service", dot: "bg-sky-500", text: "text-sky-700" };
  if (gift.payableStatus === "PAID") return { label: "Repaid", dot: "bg-emerald-500", text: "text-emerald-700" };
  if (gift.payableStatus === "DUE") return { label: "Repayment due", dot: "bg-amber-500", text: "text-amber-700" };
  return { label: "Served", dot: "bg-emerald-500", text: "text-emerald-700" };
}

function propertyState(property: PropertyRow) {
  if (property.enabled && property.optionCount > 0) return { label: "Ready", dot: "bg-emerald-500", text: "text-emerald-700" };
  if (property.enabled) return { label: "Needs drinks", dot: "bg-amber-500", text: "text-amber-700" };
  if (property.agreedAt) return { label: "Paused", dot: "bg-neutral-400", text: "text-neutral-600" };
  return { label: "Not enrolled", dot: "bg-neutral-300", text: "text-neutral-500" };
}

function StateLabel({ state }: { state: { label: string; dot: string; text: string } }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${state.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} aria-hidden /> {state.label}
    </span>
  );
}

function Empty({ icon: Icon, title, text, action }: { icon: typeof Gift; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300"><Icon className="h-5 w-5" /></span>
      <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">{title}</p>
      <p className="mx-auto mb-0 mt-1 max-w-sm text-xs leading-5 text-neutral-500">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
      {value && (
        <button type="button" onClick={() => onChange("")} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Drawn checkbox: the browser one disappears without Tailwind preflight. */
function Tick({ checked, onChange, children }: { checked: boolean; onChange: (next: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className={`flex w-full items-start gap-3 rounded-lg border border-solid px-3 py-2.5 text-left text-xs leading-5 transition ${checked ? "border-emerald-300 bg-emerald-50/70 text-emerald-950" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"}`}>
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-solid ${checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white"}`}>
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}

// Inline so no layout style can cancel it: dims and blurs the page behind every popup.
const BACKDROP = { backgroundColor: "rgba(2, 12, 10, 0.58)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" } as const;

/** Centred dialog for one record, mounted on <body> so it always sits above the admin layout. */
function Drawer({ open, onClose, labelId, eyebrow, title, subtitle, error, children, footer }: { open: boolean; onClose: () => void; labelId: string; eyebrow: string; title: string; subtitle?: ReactNode; error?: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] box-border flex items-center justify-center p-3 sm:p-6 [&_*]:box-border" style={BACKDROP} onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby={labelId} onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[calc(100dvh-24px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-48px)]">
        <header className="flex items-start justify-between gap-4 border-0 border-b border-solid border-neutral-200 px-5 py-4">
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">{eyebrow}</p>
            <h2 id={labelId} className="m-0 mt-1 truncate text-lg font-bold text-neutral-950">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-neutral-500">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900" aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        {error && <p role="alert" className="m-0 border-0 border-b border-solid border-rose-200 bg-rose-50/70 px-5 py-2.5 text-xs font-semibold text-rose-800">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

export default function KaribuAdminPage() {
  const [tab, setTab] = useState<Tab>("welcome");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [arrivals, setArrivals] = useState<Paged<Arrival>>({ rows: [], total: 0, page: 1, loading: false });
  const [arrivalQuery, setArrivalQuery] = useState("");
  const [lookup, setLookup] = useState("");

  const [gifts, setGifts] = useState<Paged<GiftRow> & { counts: Record<string, number> }>({ rows: [], total: 0, page: 1, loading: false, counts: {} });
  const [giftView, setGiftView] = useState<GiftView>("serving");

  const [properties, setProperties] = useState<Paged<PropertyRow> & { counts: Record<string, number> }>({ rows: [], total: 0, page: 1, loading: false, counts: {} });
  const [propertyFilter, setPropertyFilter] = useState<PropertyFilter>("all");
  const [propertyQuery, setPropertyQuery] = useState("");

  const [openProperty, setOpenProperty] = useState<PropertyRow | null>(null);
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [agreementConfirmed, setAgreementConfirmed] = useState(false);
  const [changeNote, setChangeNote] = useState("");

  const [welcomeRef, setWelcomeRef] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [otherCost, setOtherCost] = useState("0");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [payGift, setPayGift] = useState<GiftRow | null>(null);
  const [payReference, setPayReference] = useState("");
  const [controlsNote, setControlsNote] = useState("");

  // Remember the last workspace tab for this admin.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("admin.karibu.tab");
      if (saved === "welcome" || saved === "gifts" || saved === "properties" || saved === "controls") setTab(saved);
    } catch {}
  }, []);
  const changeTab = (next: Tab) => {
    setTab(next);
    setError("");
    try { window.localStorage.setItem("admin.karibu.tab", next); } catch {}
  };

  const loadOverview = useCallback(async () => {
    const data = (await api.get<Overview>("/api/admin/karibu/overview")).data;
    setOverview(data);
    setSettings(data.settings);
  }, []);

  const loadArrivals = useCallback(async (page: number, q: string) => {
    setArrivals((s) => ({ ...s, loading: true }));
    try {
      const data = (await api.get("/api/admin/karibu/arrivals", { params: { page, pageSize: ARRIVALS_PAGE_SIZE, q: q.trim() || undefined } })).data;
      setArrivals({ rows: data.arrivals || [], total: Number(data.total || 0), page, loading: false });
    } catch (cause) {
      setArrivals((s) => ({ ...s, loading: false }));
      setError(failureText(cause, "Checked-in guests could not be loaded."));
    }
  }, []);

  const loadGifts = useCallback(async (page: number, view: GiftView) => {
    setGifts((s) => ({ ...s, loading: true }));
    try {
      const data = (await api.get("/api/admin/karibu/gestures", { params: { page, pageSize: PAGE_SIZE, view } })).data;
      setGifts({ rows: data.gestures || [], total: Number(data.total || 0), page, loading: false, counts: data.counts || {} });
    } catch (cause) {
      setGifts((s) => ({ ...s, loading: false }));
      setError(failureText(cause, "Gifts could not be loaded."));
    }
  }, []);

  const loadProperties = useCallback(async (page: number, filter: PropertyFilter, q: string) => {
    setProperties((s) => ({ ...s, loading: true }));
    try {
      const data = (await api.get("/api/admin/karibu/properties", { params: { page, pageSize: PAGE_SIZE, filter, q: q.trim() || undefined } })).data;
      setProperties({ rows: data.properties || [], total: Number(data.total || 0), page, loading: false, counts: data.counts || {} });
    } catch (cause) {
      setProperties((s) => ({ ...s, loading: false }));
      setError(failureText(cause, "Properties could not be loaded."));
    }
  }, []);

  useEffect(() => {
    void loadOverview().catch((cause) => setError(failureText(cause, "Karibu could not be loaded. Try refreshing."))).finally(() => setBooting(false));
  }, [loadOverview]);

  // Lists load for the open tab only; searches wait for typing to pause.
  useEffect(() => {
    if (tab !== "welcome") return;
    const t = window.setTimeout(() => void loadArrivals(1, arrivalQuery), arrivalQuery ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [tab, arrivalQuery, loadArrivals]);
  useEffect(() => { if (tab === "gifts") void loadGifts(1, giftView); }, [tab, giftView, loadGifts]);
  useEffect(() => {
    if (tab !== "properties") return;
    const t = window.setTimeout(() => void loadProperties(1, propertyFilter, propertyQuery), propertyQuery ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [tab, propertyFilter, propertyQuery, loadProperties]);

  const refreshAll = async () => {
    setBusy("refresh");
    setError("");
    try {
      await loadOverview();
      if (tab === "welcome") await loadArrivals(arrivals.page, arrivalQuery);
      if (tab === "gifts") await loadGifts(gifts.page, giftView);
      if (tab === "properties") await loadProperties(properties.page, propertyFilter, propertyQuery);
    } catch (cause) {
      setError(failureText(cause, "Karibu could not be refreshed."));
    } finally {
      setBusy("");
    }
  };

  async function run(key: string, action: () => Promise<void>, fallback: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try { await action(); } catch (cause) { setError(failureText(cause, fallback)); } finally { setBusy(""); }
  }

  /* Property drawer */
  const loadDetail = useCallback(async (id: number) => {
    const data = (await api.get<PropertyDetail>(`/api/admin/karibu/properties/${id}`)).data;
    setDetail(data);
    setPrices(Object.fromEntries(data.outlets.flatMap((outlet) => outlet.menuItems.map((item) => [item.id, String(data.options.find((o) => o.menuItemId === item.id)?.partnerPrice ?? item.price)]))));
  }, []);
  const closeProperty = useCallback(() => setOpenProperty(null), []);
  const openPropertyDrawer = (property: PropertyRow) => {
    setOpenProperty(property);
    setDetail(null);
    setAgreementConfirmed(false);
    setChangeNote("");
    void loadDetail(property.id).catch((cause) => setError(failureText(cause, "Property details could not be loaded.")));
  };
  const noteReady = changeNote.trim().length >= 5;
  // Refresh the drawer, the list and the header after a change; the drawer row is rebuilt from the fresh detail.
  const afterPropertyChange = async (property: PropertyRow) => {
    const [, data] = await Promise.all([
      loadOverview(),
      api.get<PropertyDetail>(`/api/admin/karibu/properties/${property.id}`).then((r) => r.data),
      loadProperties(properties.page, propertyFilter, propertyQuery),
    ]);
    setDetail(data);
    setOpenProperty({ ...property, enabled: data.config.enabled, agreedAt: data.config.agreedAt, optionCount: data.options.filter((o) => o.enabled).length });
  };
  const saveParticipation = (enabled: boolean) => {
    const property = openProperty;
    if (!property) return;
    if (!noteReady) return setError("Add a change note of at least five characters.");
    if (enabled && !agreementConfirmed) return setError("Confirm the property's agreement before enrolling it.");
    void run("participation", async () => {
      await api.put(`/api/admin/karibu/properties/${property.id}`, { enabled, agreementConfirmed, reason: changeNote.trim() });
      await afterPropertyChange(property);
      setAgreementConfirmed(false);
      setNotice(enabled ? `${tidy(property.title)} is enrolled in Karibu.` : `${tidy(property.title)} is paused.`);
    }, "Participation could not be saved.");
  };
  const saveDrink = (item: MenuItem, enable: boolean) => {
    const property = openProperty;
    if (!property) return;
    if (!noteReady) return setError("Add a change note of at least five characters.");
    const price = Number(prices[item.id]);
    if (!Number.isFinite(price) || price <= 0 || price > Number(item.price)) return setError("The agreed price must be above zero and no higher than the menu price.");
    void run(`drink-${item.id}`, async () => {
      await api.put(`/api/admin/karibu/properties/${property.id}/options/${item.id}`, { enabled: enable, partnerPrice: price, reason: changeNote.trim() });
      await afterPropertyChange(property);
      setNotice(enable ? `${item.name} approved at ${money(price)}.` : `${item.name} removed from the pilot.`);
    }, "The drink could not be saved.");
  };

  /* Welcome drawer */
  const checkBooking = useCallback(async (reference: string, cost: string) => {
    setPreviewLoading(true);
    setError("");
    try {
      const data = (await api.get<Preview>(`/api/admin/karibu/bookings/${encodeURIComponent(reference)}/preview`, { params: { additionalCost: Number(cost) || 0 } })).data;
      setPreview(data);
      // Liked drinks come first from the server; never preselect one that clashes with the guest's needs.
      setSelectedOption(data.options.find((o) => !o.conflict)?.id ?? null);
      setConfirmed(false);
    } catch (cause) {
      setPreview(null);
      setError(failureText(cause, "This booking could not be checked."));
    } finally {
      setPreviewLoading(false);
    }
  }, []);
  const closeWelcome = useCallback(() => { setWelcomeRef(null); setPreview(null); }, []);
  const openWelcome = (reference: string) => {
    const ref = reference.trim();
    if (!/^bk_[A-Za-z0-9_-]{6,}$/.test(ref)) return setError("Paste a booking reference that starts with bk_.");
    setWelcomeRef(ref);
    setPreview(null);
    setOtherCost("0");
    void checkBooking(ref, "0");
  };
  const issueGift = () => {
    if (!welcomeRef || !preview?.eligible || !selectedOption || !confirmed) return;
    const cost = Number(otherCost);
    if (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000) return setError("Other booking costs must be between 0 and 1,000,000 TZS.");
    void run("issue", async () => {
      await api.post(`/api/admin/karibu/bookings/${encodeURIComponent(welcomeRef)}/issue`, { optionId: selectedOption, additionalCost: cost, costsReviewed: true });
      closeWelcome();
      await Promise.all([loadOverview(), loadArrivals(arrivals.page, arrivalQuery)]);
      setNotice("Gift order sent to the outlet. The guest is not charged for it.");
    }, "The gift could not be issued.");
  };

  /* Repayment */
  const recordPayment = () => {
    if (!payGift || payReference.trim().length < 5) return setError("Enter the transfer reference (at least five characters).");
    void run("pay", async () => {
      await api.post(`/api/admin/karibu/gestures/${payGift.id}/record-payment`, { reference: payReference.trim() });
      setPayGift(null);
      setPayReference("");
      await Promise.all([loadOverview(), loadGifts(gifts.page, giftView)]);
      setNotice("Repayment recorded.");
    }, "The repayment could not be recorded.");
  };

  /* Controls */
  const saveControls = () => {
    if (!settings) return;
    if (controlsNote.trim().length < 5) return setError("Add a reason of at least five characters.");
    void run("controls", async () => {
      await api.put("/api/admin/karibu/settings", { ...settings, reason: controlsNote.trim() });
      await loadOverview();
      setControlsNote("");
      setNotice("Pilot controls saved.");
    }, "Pilot controls could not be saved.");
  };

  if (booting) {
    return <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm font-semibold text-neutral-600"><Loader2 className="h-5 w-5 animate-spin text-emerald-700" /> Loading Karibu</div>;
  }
  if (!overview || !settings) {
    return (
      <div className={`${cardClass} mx-auto mt-10 max-w-lg`}>
        <Empty icon={Gift} title="Karibu is unavailable" text={error || "The workspace could not be loaded."} action={<button type="button" className={primaryClass} onClick={() => { setBooting(true); void loadOverview().catch((c) => setError(failureText(c, "Still unavailable."))).finally(() => setBooting(false)); }}>Try again</button>} />
      </div>
    );
  }

  const m = overview.metrics;
  const usedPercent = settings.monthlyCap ? Math.min(100, Math.round((m.monthCommitted / settings.monthlyCap) * 100)) : 0;
  const setup = [
    { done: overview.settings.enabled, label: "Pilot switched on", hint: "Open pilot controls", go: () => changeTab("controls") },
    { done: m.participating > 0, label: "A property enrolled", hint: "Choose a property", go: () => { setPropertyFilter("off"); changeTab("properties"); } },
    { done: m.ready > 0, label: "Drinks approved", hint: "Agree drink prices", go: () => { setPropertyFilter("needs_drinks"); changeTab("properties"); } },
  ];
  const setupDone = setup.every((s) => s.done);
  const selectedDrink = preview?.options.find((o) => o.id === selectedOption);

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header band */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Link href="/admin/nrms" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80 no-underline hover:text-emerald-200">
                <ArrowLeft className="h-3 w-3" /> NRMS · Guest experience
              </Link>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Karibu NoLSAF</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">A first-stay welcome, served by the property and paid for by NoLSAF.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${overview.settings.enabled ? "bg-emerald-400/15 text-emerald-200" : "bg-white/[0.06] text-white/70"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${overview.settings.enabled ? "bg-emerald-400" : "bg-white/40"}`} aria-hidden />
                {overview.settings.enabled ? "Pilot live" : "Pilot off"}
              </span>
              <button type="button" className={heroButton} onClick={() => window.dispatchEvent(new CustomEvent("finance-grant-required"))}><ShieldCheck className="h-3.5 w-3.5" /> Finance access</button>
              <button type="button" onClick={() => void refreshAll()} disabled={busy === "refresh"} className={`${heroButton} w-9 px-0`} aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Headline numbers */}
          <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap sm:items-end">
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{m.served.toLocaleString()}</p>
              <p className="m-0 mt-1 text-xs text-white/55">Welcomes served · {m.ordered} awaiting</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-amber-300">{money(overview.payable.amount)}</p>
              <p className="m-0 mt-1 text-xs text-white/55">Due to properties · {overview.payable.count} {overview.payable.count === 1 ? "gift" : "gifts"}</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-emerald-300">{m.ready}<span className="text-lg text-white/40"> / {m.totalProperties}</span></p>
              <p className="m-0 mt-1 text-xs text-white/55">NRMS properties ready</p>
            </div>
            <div className="min-w-[180px]">
              <p className="m-0 text-xs text-white/55">This month · {m.monthGifts} {m.monthGifts === 1 ? "gift" : "gifts"}</p>
              <p className="m-0 mt-1 text-sm font-semibold tabular-nums text-white">{money(m.monthCommitted)} <span className="font-normal text-white/45">of {money(settings.monthlyCap)}</span></p>
              <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-white/10"><span className={`block h-full rounded-full ${usedPercent >= 90 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${usedPercent}%` }} /></span>
            </div>
          </div>

          <div className="mt-5 flex gap-1 overflow-x-auto" role="tablist" aria-label="Karibu workspace">
            {([["welcome", "Welcome guests", Sparkles], ["gifts", "Gifts & repayments", ReceiptText], ["properties", "Properties", Building2], ["controls", "Pilot controls", Settings2]] as const).map(([key, label, Icon]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => changeTab(key)} className={`relative inline-flex h-11 shrink-0 items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${tab === key ? "text-white" : "text-white/50 hover:text-white/80"}`}>
                <Icon className="h-4 w-4" /> {label}
                {key === "gifts" && overview.payable.count > 0 && <span className="rounded-full bg-amber-400/20 px-1.5 text-[10px] font-bold tabular-nums text-amber-200">{overview.payable.count}</span>}
                {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Setup track: shown only while something is still missing */}
      {!setupDone && (
        <section className={`${cardClass} p-2`} aria-label="Pilot setup">
          <div className="grid gap-2 sm:grid-cols-3">
            {setup.map((step, i) => (
              <button key={step.label} type="button" onClick={step.go} className={`group flex min-w-0 items-center gap-3 rounded-xl border border-solid border-transparent p-3 text-left transition ${step.done ? "bg-emerald-50/60" : "bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${step.done ? "bg-emerald-600 text-white" : "bg-[#0b2420] text-emerald-300"}`}>
                  {step.done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-semibold ${step.done ? "text-emerald-800" : "text-neutral-900"}`}>{step.label}</span>
                  <span className="block truncate text-[11px] text-neutral-500">{step.done ? "Done" : step.hint}</span>
                </span>
                {!step.done && <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5" aria-hidden />}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* WELCOME */}
      {tab === "welcome" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className={`${cardClass} min-w-0`}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-bold text-neutral-900">Checked in now</h2>
                <p className="m-0 text-xs tabular-nums text-neutral-400">{arrivals.loading ? "Loading" : `${arrivals.total.toLocaleString()} ${arrivals.total === 1 ? "guest" : "guests"} at enrolled properties`}</p>
              </div>
              <div className="ml-auto flex w-full sm:w-auto"><SearchBox value={arrivalQuery} onChange={setArrivalQuery} placeholder="Search guest or property" /></div>
            </div>
            {arrivals.loading && arrivals.rows.length === 0 ? <LoadingRows /> : arrivals.rows.length === 0 ? (
              <Empty icon={BedDouble} title={arrivalQuery ? "No matching guests" : "No guests checked in"} text={m.participating ? "Guests appear here once they are checked in at an enrolled property." : "Enrol a property first. Its checked-in guests will appear here."} />
            ) : (
              <div className={`transition-opacity ${arrivals.loading ? "opacity-60" : ""}`}>
                <ul className="m-0 list-none border-0 border-t border-solid border-neutral-100 p-0">
                  {arrivals.rows.map((a) => (
                    <li key={a.reference} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3 last:border-b-0 sm:px-5 md:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_auto]">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">{initials(a.guestName)}</span>
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-neutral-900">{a.guestName || "Guest"}</p>
                        <p className="m-0 truncate text-xs text-neutral-400 md:hidden">{tidy(a.property.title)}</p>
                        <p className="m-0 hidden truncate font-mono text-[11px] text-neutral-400 md:block">{a.reference}</p>
                      </div>
                      <div className="hidden min-w-0 md:block">
                        <p className="m-0 truncate text-sm text-neutral-800">{tidy(a.property.title)}</p>
                        <p className="m-0 truncate text-xs text-neutral-400">{a.property.city || "NRMS property"}</p>
                      </div>
                      <div className="hidden text-sm tabular-nums text-neutral-700 md:block">
                        {day(a.checkIn)} to {day(a.checkOut)}
                        <span className="block text-xs text-neutral-400">{nights(a.checkIn, a.checkOut)} {nights(a.checkIn, a.checkOut) === 1 ? "night" : "nights"}</span>
                      </div>
                      <div className="justify-self-end">
                        {a.gift ? (
                          <StateLabel state={a.gift === "ORDERED" ? { label: "Gift ordered", dot: "bg-sky-500", text: "text-sky-700" } : { label: "Welcomed", dot: "bg-emerald-500", text: "text-emerald-700" }} />
                        ) : (
                          <button type="button" onClick={() => openWelcome(a.reference)} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-3 text-xs font-bold text-white transition hover:bg-emerald-800">
                            <Gift className="h-3.5 w-3.5" /> Welcome
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <TablePagination page={arrivals.page} pageSize={ARRIVALS_PAGE_SIZE} total={arrivals.total} onPageChange={(p) => void loadArrivals(p, arrivalQuery)} />
              </div>
            )}
          </section>

          <aside className="min-w-0 space-y-5">
            <section className={`${cardClass} p-4 sm:p-5`}>
              <h2 className="m-0 text-sm font-bold text-neutral-900">Find a booking</h2>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">Paste the reference from the booking page.</p>
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); openWelcome(lookup); }}>
                <input value={lookup} onChange={(e) => setLookup(e.target.value)} className={`${fieldClass} font-mono`} placeholder="bk_..." aria-label="Booking reference" spellCheck={false} />
                <button type="submit" className={`${actionClass} shrink-0 px-3`} aria-label="Check booking"><Search className="h-4 w-4" /></button>
              </form>
            </section>

            <section className={`${cardClass} p-4 sm:p-5`}>
              <h2 className="m-0 text-sm font-bold text-neutral-900">How a welcome works</h2>
              <ol className="m-0 mt-3 list-none space-y-3 p-0">
                {[
                  ["Check", "NoLSAF confirms a first stay and works out the gift budget from the booking's commission."],
                  ["Choose", "Ask the guest which approved drink they would like."],
                  ["Serve", "The outlet receives an NRMS order and serves it free to the guest."],
                  ["Repay", "Finance repays the property the agreed price after service."],
                ].map(([title, text], i) => (
                  <li key={title} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#0b2420] text-[11px] font-bold text-emerald-300">{i + 1}</span>
                    <span className="min-w-0 text-xs leading-5 text-neutral-600"><b className="font-semibold text-neutral-900">{title}.</b> {text}</span>
                  </li>
                ))}
              </ol>
            </section>

            {overview.recent.length > 0 && (
              <section className={cardClass}>
                <div className="flex items-center justify-between px-4 py-3 sm:px-5">
                  <h2 className="m-0 text-sm font-bold text-neutral-900">Latest gifts</h2>
                  <button type="button" onClick={() => changeTab("gifts")} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">View all</button>
                </div>
                <ul className="m-0 list-none border-0 border-t border-solid border-neutral-100 p-0">
                  {overview.recent.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-2.5 last:border-b-0 sm:px-5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-neutral-900">{g.guestName || "Guest"}</span>
                        <span className="block truncate text-[11px] text-neutral-400">{g.drink} · {tidy(g.property.title)}</span>
                      </span>
                      <StateLabel state={giftState(g)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}

      {/* GIFTS */}
      {tab === "gifts" && (
        <section className={cardClass}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 flex-wrap gap-1 rounded-lg bg-neutral-100 p-0.5" role="group" aria-label="Gift status">
              {GIFT_VIEWS.map((v) => (
                <button key={v.key} type="button" aria-pressed={giftView === v.key} onClick={() => setGiftView(v.key)} className={`inline-flex h-8 items-center gap-1.5 rounded-md border-0 px-3 text-xs font-semibold transition-colors ${giftView === v.key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>
                  {v.label}
                  <span className={`tabular-nums ${v.key === "due" && (gifts.counts.due ?? 0) > 0 ? "text-amber-600" : "text-neutral-400"}`}>{(gifts.counts[v.key] ?? 0).toLocaleString()}</span>
                </button>
              ))}
            </div>
            {giftView === "due" && <p className="m-0 text-xs text-neutral-500 sm:ml-auto">Record a repayment only after the transfer is made outside NoLSAF.</p>}
          </div>
          {gifts.loading && gifts.rows.length === 0 ? <LoadingRows /> : gifts.rows.length === 0 ? (
            <Empty icon={giftView === "due" ? Wallet : Gift} title={giftView === "due" ? "Nothing to repay" : "No gifts here"} text={giftView === "due" ? "Served gifts owed to properties will appear here." : "Gifts appear here once a guest is welcomed."} />
          ) : (
            <div className={`transition-opacity ${gifts.loading ? "opacity-60" : ""}`}>
              <div className="overflow-x-auto border-0 border-t border-solid border-neutral-100">
                <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      <th className={`${headCell} sm:pl-5`}>Guest</th>
                      <th className={headCell}>Property</th>
                      <th className={headCell}>Drink</th>
                      <th className={`${headCell} text-right`}>Agreed price</th>
                      <th className={headCell}>Issued</th>
                      <th className={headCell}>Status</th>
                      <th className={`${headCell} text-right sm:pr-5`}><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {gifts.rows.map((g) => (
                      <tr key={g.id} className="border-0 border-t border-solid border-neutral-100 transition-colors hover:bg-neutral-50/70">
                        <td className="px-4 py-3 sm:pl-5">
                          <p className="m-0 max-w-[14rem] truncate font-medium text-neutral-900">{g.guestName || "Guest"}</p>
                          <Link href={`/admin/bookings/${encodeURIComponent(g.bookingReference)}`} className="font-mono text-[11px] text-emerald-700 no-underline hover:underline">{g.bookingReference}</Link>
                        </td>
                        <td className="px-4 py-3">
                          <p className="m-0 max-w-[14rem] truncate text-neutral-800">{tidy(g.property.title)}</p>
                          <p className="m-0 text-xs text-neutral-400">{g.property.city || "NRMS property"}</p>
                        </td>
                        <td className="px-4 py-3 text-neutral-700">{g.drink}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">{money(g.partnerPrice)}</td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-500">{fullDay(g.issuedAt)}</td>
                        <td className="px-4 py-3">
                          <StateLabel state={giftState(g)} />
                          {g.bookingStatus === "CANCELED" && <span className="mt-0.5 block text-[11px] text-rose-600">Booking cancelled</span>}
                          {g.guestFeedback && <span className={`mt-1 block max-w-52 text-[11px] ${g.guestFeedback.received ? "text-emerald-700" : "font-bold text-rose-700"}`}>
                            {g.guestFeedback.received ? `Guest confirmed · ${g.guestFeedback.rating}/5` : "Guest reports not received"}
                            {g.guestFeedback.note && <span className="mt-0.5 block whitespace-normal font-normal text-neutral-500">{g.guestFeedback.note}</span>}
                          </span>}
                        </td>
                        <td className="px-4 py-3 text-right sm:pr-5">
                          {g.payableStatus === "DUE" && g.status === "SERVED" ? (
                            <button type="button" onClick={() => { setPayGift(g); setPayReference(""); }} className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800">
                              <HandCoins className="h-3.5 w-3.5" /> Record transfer
                            </button>
                          ) : g.paymentReference ? (
                            <span className="font-mono text-[11px] text-neutral-400" title={`Repaid ${fullDay(g.paidAt)}`}>{g.paymentReference}</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination page={gifts.page} pageSize={PAGE_SIZE} total={gifts.total} onPageChange={(p) => void loadGifts(p, giftView)} />
            </div>
          )}
          {overview.refundRisk.count > 0 && (
            <p className="m-0 rounded-b-2xl border-0 border-t border-solid border-amber-100 bg-amber-50/70 px-5 py-3 text-xs text-amber-900">
              {overview.refundRisk.count} served {overview.refundRisk.count === 1 ? "gift belongs" : "gifts belong"} to a cancelled or refunded booking ({money(overview.refundRisk.amount)}). A served gift stays a NoLSAF cost and is never charged to the guest.
            </p>
          )}
        </section>
      )}

      {/* PROPERTIES */}
      {tab === "properties" && (
        <>
          <section className={`${cardClass} p-2`}>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {PROPERTY_FILTERS.map((f) => {
                const n = properties.counts[f.key] ?? 0;
                const all = properties.counts.all ?? 0;
                const share = all > 0 ? Math.round((n / all) * 100) : 0;
                const selected = propertyFilter === f.key;
                return (
                  <button key={f.key} type="button" aria-pressed={selected} onClick={() => setPropertyFilter(f.key)} className={`min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${selected ? "border-neutral-900 bg-white" : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}>
                    <span className={`block text-xs font-semibold ${f.text}`}>{f.label}</span>
                    <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{n.toLocaleString()}</span>
                    <span className="mt-1 block truncate text-[11px] text-neutral-500">{f.hint}</span>
                    <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70"><span className={`block h-full rounded-full ${f.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} /></span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={cardClass}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-bold text-neutral-900">{propertyFilter === "all" ? "All NRMS properties" : PROPERTY_FILTERS.find((f) => f.key === propertyFilter)?.label}</h2>
                <p className="m-0 text-xs tabular-nums text-neutral-400">{properties.loading ? "Loading" : `${properties.total.toLocaleString()} ${properties.total === 1 ? "result" : "results"}`}</p>
              </div>
              <div className="ml-auto flex w-full sm:w-auto"><SearchBox value={propertyQuery} onChange={setPropertyQuery} placeholder="Search property or city" /></div>
            </div>
            {properties.loading && properties.rows.length === 0 ? <LoadingRows /> : properties.rows.length === 0 ? (
              <Empty icon={Building2} title="No matching properties" text={propertyQuery || propertyFilter !== "all" ? "Try another filter or search." : "Approved NRMS properties will appear here."} />
            ) : (
              <div className={`transition-opacity ${properties.loading ? "opacity-60" : ""}`}>
                <div className="overflow-x-auto border-0 border-t border-solid border-neutral-100">
                  <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead>
                      <tr>
                        <th className={`${headCell} sm:pl-5`}>Property</th>
                        <th className={headCell}>Status</th>
                        <th className={`${headCell} text-right`}>Approved drinks</th>
                        <th className={headCell}>Agreement</th>
                        <th className={`${headCell} sm:pr-5`}><span className="sr-only">Open</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {properties.rows.map((p) => (
                        <tr key={p.id} onClick={() => openPropertyDrawer(p)} className="cursor-pointer border-0 border-t border-solid border-neutral-100 transition-colors hover:bg-neutral-50/70">
                          <td className="px-4 py-3 sm:pl-5">
                            <p className="m-0 max-w-[22rem] truncate font-medium text-neutral-900">{tidy(p.title)}</p>
                            <p className="m-0 text-xs text-neutral-400">{p.city || "City not set"}</p>
                          </td>
                          <td className="px-4 py-3"><StateLabel state={propertyState(p)} /></td>
                          <td className="px-4 py-3 text-right tabular-nums text-neutral-800">{p.optionCount}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-500">{p.agreedAt ? fullDay(p.agreedAt) : "Not recorded"}</td>
                          <td className="px-4 py-3 text-right sm:pr-5"><ChevronRight className="ml-auto h-4 w-4 text-neutral-300" aria-hidden /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePagination page={properties.page} pageSize={PAGE_SIZE} total={properties.total} onPageChange={(p) => void loadProperties(p, propertyFilter, propertyQuery)} />
              </div>
            )}
          </section>
        </>
      )}

      {/* CONTROLS */}
      {tab === "controls" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className={`${cardClass} overflow-hidden`}>
            <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${settings.enabled ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-500"}`}><Power className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h2 className="m-0 text-sm font-bold text-neutral-900">Karibu NoLSAF pilot</h2>
                  <p className="m-0 text-xs text-neutral-500">{settings.enabled ? "New welcomes can be issued at ready properties." : "No new welcomes can be issued while this is off."}</p>
                </div>
              </div>
              <button type="button" role="switch" aria-checked={settings.enabled} aria-label="Pilot on or off" onClick={() => setSettings({ ...settings, enabled: !settings.enabled })} className={`relative h-6 w-11 shrink-0 rounded-full border-0 transition-colors ${settings.enabled ? "bg-emerald-600" : "bg-neutral-300"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${settings.enabled ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>

            {([
              ["Each stay", "How much of one booking's net contribution can fund a gift.", [["budgetPercent", "Share of net contribution", "%", 1, 35], ["contributionFloor", "Minimum net contribution", "TZS", 0, 1_000_000], ["perStayCap", "Most per stay", "TZS", 0, 100_000]]],
              ["Each month", "New gifts stop once a limit is reached.", [["monthlyCap", "All properties", "TZS", 0, 100_000_000], ["propertyMonthlyCap", "One property", "TZS", 0, 100_000_000]]],
              ["Measurement", "A share of eligible first-stay guests gets no gift, so the effect can be measured.", [["holdoutPercent", "Holdout group", "%", 0, 50]]],
            ] as const).map(([title, hint, fields]) => (
              <div key={title} className="border-0 border-t border-solid border-neutral-100 px-4 py-4 sm:px-5">
                <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">{title}</h3>
                <p className="m-0 mt-0.5 text-xs text-neutral-400">{hint}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {fields.map(([key, label, unit, min, max]) => (
                    <label key={key} className="block text-[11px] font-bold text-neutral-600">
                      {label}
                      <span className="relative mt-1.5 block">
                        <input className={`${fieldClass} pr-12 tabular-nums`} type="number" min={min} max={max} value={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400">{unit}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div className="flex flex-col gap-3 border-0 border-t border-solid border-neutral-200 bg-neutral-50/70 px-4 py-4 sm:flex-row sm:items-end sm:px-5">
              <label className="block flex-1 text-[11px] font-bold text-neutral-600">
                Reason for this change
                <input className={`${fieldClass} mt-1.5`} value={controlsNote} onChange={(e) => setControlsNote(e.target.value)} maxLength={300} placeholder="Recorded in the audit log" />
              </label>
              <button type="button" className={primaryClass} disabled={busy === "controls" || controlsNote.trim().length < 5} onClick={saveControls}>
                {busy === "controls" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save controls
              </button>
            </div>
          </section>

          <aside className={`${cardClass} h-fit p-4 sm:p-5`}>
            <h2 className="m-0 text-sm font-bold text-neutral-900">How the limits work</h2>
            <ul className="m-0 mt-3 list-none space-y-3 p-0 text-xs leading-5 text-neutral-600">
              <li><b className="font-semibold text-neutral-900">Gift budget.</b> A share of NoLSAF's net contribution on the booking, never more than the per-stay limit.</li>
              <li><b className="font-semibold text-neutral-900">Monthly limits.</b> Count every gift issued this month, including gifts still awaiting service.</li>
              <li><b className="font-semibold text-neutral-900">Changes.</b> Apply to new gifts only. Gifts already issued keep their agreed price.</li>
              <li><b className="font-semibold text-neutral-900">Checked twice.</b> Every limit is checked again at the moment a gift is issued.</li>
            </ul>
          </aside>
        </div>
      )}

      {/* Property drawer */}
      <Drawer
        open={!!openProperty}
        onClose={closeProperty}
        labelId="karibu-property-title"
        eyebrow="Karibu property"
        error={error}
        title={tidy(openProperty?.title) || "Property"}
        subtitle={openProperty && <span className="inline-flex items-center gap-2">{openProperty.city || "NRMS property"} <span className="text-neutral-300">·</span> <StateLabel state={propertyState(openProperty)} /></span>}
        footer={
          <label className="block text-[11px] font-bold text-neutral-600">
            Change note <span className="font-medium text-neutral-400">(required for every change, kept in the audit log)</span>
            <input className={`${fieldClass} mt-1.5`} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={300} placeholder="Why is this property or price changing?" />
          </label>
        }
      >
        {!detail ? (
          <div className="grid min-h-60 place-items-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Participation</h3>
              <dl className="m-0 mt-2 grid grid-cols-2 border-0 border-y border-solid border-neutral-200">
                <div className="px-3 py-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Status</dt><dd className="m-0 mt-1 text-sm font-semibold text-neutral-800">{detail.config.enabled ? "Enrolled" : "Not enrolled"}</dd></div>
                <div className="border-0 border-l border-solid border-neutral-200 px-3 py-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Agreement recorded</dt><dd className="m-0 mt-1 text-sm font-semibold text-neutral-800">{fullDay(detail.config.agreedAt)}</dd></div>
              </dl>
              {!detail.config.enabled && (
                <div className="mt-3">
                  <Tick checked={agreementConfirmed} onChange={setAgreementConfirmed}>
                    I confirmed with the property team that they will serve approved drinks at the agreed prices, and that NoLSAF repays them after service.
                  </Tick>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {detail.config.enabled ? (
                  <button type="button" className={actionClass} disabled={!!busy || !noteReady} onClick={() => saveParticipation(false)}>{busy === "participation" && <Loader2 className="h-4 w-4 animate-spin" />} Pause participation</button>
                ) : (
                  <button type="button" className={primaryClass} disabled={!!busy || !agreementConfirmed || !noteReady} onClick={() => saveParticipation(true)}>{busy === "participation" && <Loader2 className="h-4 w-4 animate-spin" />} Enrol property</button>
                )}
                {!noteReady && <span className="self-center text-xs text-neutral-400">Add a change note at the bottom first.</span>}
              </div>
            </section>

            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Drinks the property serves</h3>
                <span className="text-xs text-neutral-400">Nonalcoholic drinks from TZS outlets</span>
              </div>
              {!detail.config.agreedAt && <p className="m-0 mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">Enrol the property first. Drink prices can be agreed after that.</p>}
              {detail.outlets.length === 0 ? (
                <p className="m-0 mt-3 text-sm text-neutral-500">No active TZS outlet. Add a nonalcoholic drink to the property's NRMS menu first.</p>
              ) : detail.outlets.map((outlet) => {
                const items = outlet.menuItems.filter((item) => item.pilotEligible);
                // Drink-like items that were skipped come first: those are the ones the property can fix with a category change.
                const skippedDrinks = outlet.menuItems.filter((item) => !item.pilotEligible && item.looksLikeDrink);
                const otherSkipped = outlet.menuItems.filter((item) => !item.pilotEligible && !item.looksLikeDrink).length;
                return (
                  <div key={outlet.id} className="mt-3">
                    <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-neutral-700"><Coffee className="h-3.5 w-3.5 text-neutral-400" /> {outlet.name}</p>
                    {items.length === 0 && skippedDrinks.length === 0 && <p className="m-0 mt-1 text-xs text-neutral-400">No drinks on this outlet's menu{otherSkipped ? ` (${otherSkipped} other ${otherSkipped === 1 ? "item" : "items"}, not drinks)` : ""}.</p>}
                    {skippedDrinks.length > 0 && (
                      <div className="mt-2 rounded-xl border border-solid border-amber-200 bg-amber-50/50">
                        <p className="m-0 border-0 border-b border-solid border-amber-200 px-3 py-2 text-xs font-semibold text-amber-900">
                          {skippedDrinks.length} {skippedDrinks.length === 1 ? "drink cannot" : "drinks cannot"} be offered yet
                          <span className="block font-normal text-amber-800">Ask the property to move {skippedDrinks.length === 1 ? "it" : "them"} to one of: {(detail.acceptedCategories ?? []).join(", ")}.</span>
                        </p>
                        <ul className="m-0 list-none p-0">
                          {skippedDrinks.map((item) => (
                            <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-0 border-b border-solid border-amber-100 px-3 py-2 last:border-b-0">
                              <span className="text-sm font-medium text-neutral-800">{item.name}</span>
                              <span className="text-xs text-amber-800">{item.skipReason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {items.length === 0 ? null : (
                      <ul className="m-0 mt-2 list-none rounded-xl border border-solid border-neutral-200 p-0">
                        {items.map((item) => {
                          const option = detail.options.find((o) => o.menuItemId === item.id);
                          const approved = !!option?.enabled;
                          return (
                            <li key={item.id} className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-100 px-3 py-3 last:border-b-0">
                              <div className="min-w-0 flex-1">
                                <p className="m-0 flex items-center gap-2 truncate text-sm font-semibold text-neutral-900">
                                  {item.name}
                                  {approved && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Approved</span>}
                                </p>
                                <p className="m-0 mt-0.5 text-xs text-neutral-500">Menu {money(item.price)} · {item.inStock ? "In stock" : <span className="text-amber-700">Out of stock</span>}</p>
                              </div>
                              <label className="relative w-32 shrink-0">
                                <span className="sr-only">Agreed price for {item.name}</span>
                                <input className={`${fieldClass} pr-11 tabular-nums`} inputMode="decimal" type="number" min="1" max={Number(item.price)} value={prices[item.id] ?? ""} onChange={(e) => setPrices({ ...prices, [item.id]: e.target.value })} disabled={!detail.config.agreedAt} />
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-neutral-400">TZS</span>
                              </label>
                              <div className="flex shrink-0 gap-1.5">
                                {approved && (
                                  <button type="button" className={`${actionClass} min-h-9 px-3 text-xs`} disabled={!!busy || !detail.config.agreedAt || !noteReady} onClick={() => saveDrink(item, true)}>Save</button>
                                )}
                                <button type="button" className={`${approved ? actionClass : primaryClass} min-h-9 px-3 text-xs`} disabled={!!busy || !detail.config.agreedAt || !noteReady} onClick={() => saveDrink(item, !approved)}>
                                  {busy === `drink-${item.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{approved ? "Remove" : "Approve"}
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </section>
          </div>
        )}
      </Drawer>

      {/* Welcome drawer */}
      <Drawer
        open={!!welcomeRef}
        onClose={closeWelcome}
        labelId="karibu-welcome-title"
        eyebrow="Welcome a guest"
        error={error}
        title={preview?.booking?.guestName || "Guest"}
        subtitle={preview?.booking ? <span>{tidy(preview.booking.property)} · {day(preview.booking.checkIn)} to {day(preview.booking.checkOut)} · <span className="font-mono">{preview.booking.reference}</span></span> : <span className="font-mono">{welcomeRef}</span>}
        footer={preview?.eligible ? (
          <div className="space-y-3">
            <Tick checked={confirmed} onChange={setConfirmed}>I checked the booking's other costs, and this is the drink the guest asked for.</Tick>
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 text-xs text-neutral-500">NoLSAF repays <b className="font-semibold text-neutral-900">{money(selectedDrink?.partnerPrice)}</b> after service.</p>
              <button type="button" className={primaryClass} disabled={busy === "issue" || !selectedOption || !confirmed} onClick={issueGift}>
                {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />} Send to outlet
              </button>
            </div>
          </div>
        ) : undefined}
      >
        {previewLoading && !preview ? (
          <div className="grid min-h-60 place-items-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !preview ? (
          <p className="m-0 text-sm text-neutral-500">This booking could not be checked.</p>
        ) : (
          <div className={`space-y-6 transition-opacity ${previewLoading ? "opacity-60" : ""}`}>
            <div className={`flex items-start gap-3 rounded-xl border border-solid px-4 py-3 ${preview.eligible ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
              {preview.eligible ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <Gift className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
              <div>
                <p className={`m-0 text-sm font-semibold ${preview.eligible ? "text-emerald-900" : "text-amber-900"}`}>{preview.eligible ? "Eligible for a first-stay welcome" : "No welcome for this booking"}</p>
                {!preview.eligible && <p className="m-0 mt-0.5 text-xs text-amber-800">{REASONS[preview.reason || ""] || preview.reason || "This booking does not qualify."}</p>}
              </div>
            </div>

            {preview.commission != null && (
              <section>
                <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Gift budget</h3>
                <dl className="m-0 mt-2 overflow-hidden rounded-xl border border-solid border-neutral-200 text-sm">
                  {([
                    ["Paid commission", preview.commission, false],
                    ["Payment fee estimate", preview.feeEstimate, true],
                    ["Other attributed costs", preview.attributedCost, true],
                  ] as const).map(([label, value, minus]) => (
                    <div key={label} className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-3 py-2.5">
                      <dt className="text-neutral-600">{label}</dt>
                      <dd className="m-0 tabular-nums text-neutral-800">{minus ? "minus " : ""}{money(value)}</dd>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-3 py-2.5">
                    <dt className="font-semibold text-neutral-900">Net contribution</dt>
                    <dd className="m-0 font-semibold tabular-nums text-neutral-900">{money(preview.contribution)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 bg-[#0b2420] px-3 py-3 text-white">
                    <dt className="font-semibold">Most this gift can cost</dt>
                    <dd className="m-0 text-base font-bold tabular-nums text-emerald-300">{money(preview.budget)}</dd>
                  </div>
                </dl>
                {preview.monthRemaining != null && <p className="m-0 mt-2 text-xs text-neutral-500">{money(preview.monthRemaining)} left in this month's limits.</p>}
                <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (welcomeRef) void checkBooking(welcomeRef, otherCost); }}>
                  <label className="block flex-1 text-[11px] font-bold text-neutral-600">
                    Other costs on this booking (TZS)
                    <input className={`${fieldClass} mt-1.5 tabular-nums`} type="number" min="0" max="1000000" value={otherCost} onChange={(e) => { setOtherCost(e.target.value); setConfirmed(false); }} />
                  </label>
                  <button type="submit" className={`${actionClass} shrink-0`} disabled={previewLoading}>{previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recalculate</button>
                </form>
              </section>
            )}

            {preview.eligible && (
              <section>
                {preview.guest?.hasPreferences && (
                  <div className="mb-4 rounded-xl border border-solid border-neutral-200 p-3">
                    <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-neutral-500">What this guest told us</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {preview.guest.birthdayInStay && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800"><Sparkles className="h-3 w-3" /> Birthday during this stay</span>}
                      {preview.guest.drinkLikes.map((d) => <span key={d} className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">Likes {DRINK_LABEL[d] ?? d}</span>)}
                      {preview.guest.dietaryTags.map((t) => <span key={t} className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-800">{DIETARY_LABEL[t] ?? t}</span>)}
                    </div>
                    {preview.guest.dietaryNote && <p className="m-0 mt-2 text-xs text-neutral-600">Note: {preview.guest.dietaryNote}</p>}
                  </div>
                )}
                <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Guest's choice</h3>
                <p className="m-0 mt-0.5 text-xs text-neutral-500">Ask which drink they would like. Only drinks within the budget are shown{preview.guest?.hasPreferences ? "; drinks they like come first" : ""}.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Approved drinks">
                  {preview.options.map((o) => {
                    const on = selectedOption === o.id;
                    const blocked = !!o.conflict;
                    return (
                      <button key={o.id} type="button" role="radio" aria-checked={on} disabled={blocked} title={o.conflict ?? undefined} onClick={() => { setSelectedOption(o.id); setConfirmed(false); }} className={`flex items-center justify-between gap-3 rounded-xl border border-solid p-3 text-left transition ${blocked ? "cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-70" : on ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-neutral-200 bg-white hover:border-emerald-200"}`}>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-neutral-900">{o.name}{o.liked && !blocked && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">Likes</span>}</span>
                          <span className={`block truncate text-xs ${blocked ? "font-semibold text-rose-700" : "text-neutral-500"}`}>{blocked ? o.conflict : o.outletName}</span>
                        </span>
                        <span className="shrink-0 text-xs font-bold tabular-nums text-emerald-800">{money(o.partnerPrice)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </Drawer>

      {/* Record repayment */}
      {payGift && createPortal(
        <div role="presentation" className="fixed inset-0 z-[1001] box-border flex items-center justify-center p-4 [&_*]:box-border" style={BACKDROP} onMouseDown={(e) => { if (e.target === e.currentTarget) setPayGift(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="karibu-pay-title" className="w-full max-w-md overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white shadow-2xl">
            <div className="border-0 border-b border-solid border-neutral-200 px-5 py-4">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Property repayment</p>
              <h2 id="karibu-pay-title" className="m-0 mt-1 text-lg font-bold text-neutral-950">{money(payGift.partnerPrice)} to {tidy(payGift.property.title)}</h2>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">{payGift.drink} for {payGift.guestName || "the guest"} · <span className="font-mono">{payGift.bookingReference}</span></p>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">Make the transfer first. Saving here records its reference only; it does not move money.</p>
              {error && <p role="alert" className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{error}</p>}
              <label className="block text-[11px] font-bold text-neutral-600">
                Transfer reference
                <input autoFocus className={`${fieldClass} mt-1.5 font-mono`} value={payReference} onChange={(e) => setPayReference(e.target.value)} maxLength={120} placeholder="Bank or mobile money reference" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <button type="button" className={actionClass} onClick={() => setPayGift(null)}>Cancel</button>
              <button type="button" className={primaryClass} disabled={busy === "pay" || payReference.trim().length < 5} onClick={recordPayment}>{busy === "pay" && <Loader2 className="h-4 w-4 animate-spin" />} Record repayment</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
