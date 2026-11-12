"use client";

// Agency Desk overview for a hand-picked partner: what to do next, what the
// desk has earned, booking links (stay or tour) with copy, WhatsApp and QR,
// and the stays and tours credited to the partner.
//
// The server answers 404 to anyone without the capability; this page then shows
// a plain "not available" message and nothing else. Nothing here is public.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, BedDouble, CheckCircle2, Clock, Compass, Copy, Handshake, Link2, Loader2, MessageCircle, Plus, QrCode,
  Users, Wallet, X, XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { codeLabel, statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import AgencyTabs from "@/components/sales/AgencyTabs";
import TourPicker, { type TourOption } from "@/components/sales/TourPicker";
import InfoTip from "@/components/sales/InfoTip";

type Status = {
  status: "ACTIVE" | "PENDING_ACCEPTANCE";
  stayRate: number;
  maxActiveLinks: number;
  liveLinks: number;
  acceptedAt: string | null;
  addendum?: string;
  termsHash?: string;
};
type AgencyLink = {
  reference: string;
  label: string;
  kind?: "STAY" | "TOUR";
  property: { title: string; slug: string | null } | null;
  tour?: { title: string } | null;
  clientName: string | null;
  clientPhone: string | null;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  status: "LIVE" | "EXPIRED" | "REVOKED" | "USED_UP";
  url: string | null;
};
type CreditedBooking = {
  creditedAt: string;
  status: string;
  blockedReason: string | null;
  link: { reference: string; label: string } | null;
  booking: { property: string | null; checkIn: string; checkOut: string; status: string; guest: string | null; guestPhone: string | null } | null;
  commission: { status: string; amount: number; currency: string; reason: string | null } | null;
};
type CreditedTour = {
  creditedAt: string;
  status: string;
  blockedReason: string | null;
  tour: { title: string; destination: string | null; startDate: string | null; travelers: number; status: string; paid: boolean; total: number; currency: string; guest: string | null } | null;
  commission: { status: string; amount: number; reason: string | null } | null;
};
type GroupRow = {
  reference: string;
  status: string;
  client: { name: string };
  destination: string | null;
  headcount: number | null;
  linkExpiresAt: string | null;
  createdAt?: string | null;
  shortlistStatus: string;
  booking: { status: string; paid: boolean; checkedIn: boolean; bids: number } | null;
};
type ClientRow = { reference: string; name: string; status: string; protectedUntil: string | null; protectionActive: boolean };
type NextStep = { key: string; tone: "amber" | "sky" | "rose"; title: string; detail: string; href?: string; action?: string };

const card = "min-w-0 rounded-lg border border-solid border-slate-300 bg-white";
const input = "mt-1.5 block min-h-10 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";
const primary = "inline-flex h-10 items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const ghost = "inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-[#02665e]/50 hover:bg-slate-50 disabled:opacity-50";
const field = "block min-w-0 text-xs font-medium text-slate-600";
const tipLabel = "flex items-center gap-1";
const DAY = 86_400_000;

const day = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "-";
const money = (value: number, currency = "TZS") => `${currency === "TZS" ? "TSh" : currency} ${Math.round(Number(value || 0)).toLocaleString("en-US")}`;
const daysLeft = (value: string | null | undefined) => (value ? Math.ceil((new Date(value).getTime() - Date.now()) / DAY) : null);

/** One colour per figure, so each tile reads as its own measure. Text stays in normal ink. */
const FIGURE_TONE = {
  blue: { line: "#2a78d6", chip: "bg-[#2a78d6]/10 text-[#2a78d6]" },
  orange: { line: "#eb6834", chip: "bg-[#eb6834]/10 text-[#d1531f]" },
  violet: { line: "#6250d6", chip: "bg-[#6250d6]/10 text-[#6250d6]" },
  amber: { line: "#eda100", chip: "bg-[#eda100]/15 text-[#a86f00]" },
} as const;
type FigureTone = keyof typeof FIGURE_TONE;

const TREND_DAYS = 30;

/** Running total per day for the last TREND_DAYS days, from dated events. */
function dailyRunning(events: Array<{ at: string | null | undefined; value: number }>): number[] {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const start = today.getTime() - (TREND_DAYS - 1) * DAY;
  const out = new Array<number>(TREND_DAYS).fill(0);
  let before = 0;
  for (const e of events) {
    if (!e.at) continue;
    const t = new Date(e.at).getTime();
    if (!Number.isFinite(t) || t > today.getTime()) continue;
    if (t < start - DAY) { before += e.value; continue; }
    const i = Math.min(TREND_DAYS - 1, Math.max(0, Math.floor((t - (start - DAY)) / DAY)));
    out[i] += e.value;
  }
  let run = before;
  return out.map((v) => (run += v));
}

/** A small single-series line with a hover readout. Flat at zero until there is data. */
function Sparkline({ values, color, format, label }: { values: number[]; color: string; format: (v: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 100;
  const H = 28;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : 0);
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 6);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const i = hover ?? values.length - 1;
  const when = new Date(Date.now() - (values.length - 1 - i) * DAY);
  const pick = (clientX: number, el: Element) => {
    const b = el.getBoundingClientRect();
    setHover(Math.max(0, Math.min(values.length - 1, Math.round(((clientX - b.left) / b.width) * (values.length - 1)))));
  };
  return (
    <div className="relative mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-7 w-full touch-none" role="img"
        aria-label={`${label}, last ${values.length} days: ${format(values[values.length - 1] ?? 0)} now`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerDown={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}>
        <line x1="0" x2={W} y1={H - 1} y2={H - 1} stroke="#e2e8f0" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={`${line} L${W} ${H - 1} L0 ${H - 1} Z`} fill={color} opacity="0.1" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hover != null ? <line x1={x(i)} x2={x(i)} y1="0" y2={H - 1} stroke="#94a3b8" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <span className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style={{ left: `${x(i)}%`, top: `${(y(values[i] ?? 0) / H) * 100}%`, background: color }} aria-hidden />
      {hover != null ? (
        <span className="pointer-events-none absolute -top-6 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-solid border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-800 shadow-sm"
          style={{ left: `${Math.min(85, Math.max(15, x(i)))}%` }}>
          {when.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" })} · {format(values[i] ?? 0)}
        </span>
      ) : null}
    </div>
  );
}

function Figure({ icon: Icon, label, value, note, tip, tone, trend, meter, children }: {
  icon: typeof Wallet; label: string; value: ReactNode; note?: string; tip?: ReactNode; tone: FigureTone;
  trend?: { values: number[]; format: (v: number) => string }; meter?: { used: number; limit: number }; children?: ReactNode;
}) {
  const t = FIGURE_TONE[tone];
  return (
    <div className="flex min-w-0 flex-col bg-white p-4">
      <p className="m-0 flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-slate-500">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${t.chip}`}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
        <span className="min-w-0 truncate">{label}</span>
        {tip ? <InfoTip label={label}>{tip}</InfoTip> : null}
      </p>
      <p className="m-0 mt-2 truncate text-[22px] font-bold tracking-tight tabular-nums text-slate-900">{value}</p>
      {note ? <p className="m-0 mt-0.5 truncate text-[12px] text-slate-500">{note}</p> : null}
      {children}
      <div className="mt-auto">
        {trend ? <Sparkline values={trend.values} color={t.line} format={trend.format} label={label} /> : null}
        {meter ? (
          <div className="mt-3" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={meter.limit} aria-valuenow={meter.used}>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (meter.used / Math.max(1, meter.limit)) * 100)}%`, background: t.line }} />
            </div>
            <p className="m-0 mt-1 text-[11px] text-slate-500">{Math.max(0, meter.limit - meter.used)} left before the limit</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold text-slate-900">{children}</h2>
      {action}
    </div>
  );
}

/** What the partner should do now, worked out from their own groups, links and clients. */
function nextSteps(groups: GroupRow[], links: AgencyLink[], clients: ClientRow[]): NextStep[] {
  const out: NextStep[] = [];
  for (const g of groups) {
    const href = `/sales/agency/groups/${g.reference}`;
    const where = [g.client.name, g.destination].filter(Boolean).join(", ");
    if (g.status === "AWAITING_CLIENT") {
      const left = daysLeft(g.linkExpiresAt);
      out.push({ key: `g-${g.reference}`, tone: left != null && left <= 1 ? "rose" : "amber", title: "Waiting for your client to confirm", detail: `${where}. ${left != null && left <= 1 ? "The link expires within a day: resend it." : "Remind them to open the SMS link."}`, href, action: "Open" });
    } else if (g.status === "CONFIRMED" && g.booking && !g.booking.paid && !["CANCELED", "CANCELLED", "EXPIRED"].includes(String(g.booking.status).toUpperCase())) {
      if (g.shortlistStatus === "NONE" && g.booking.bids > 0) out.push({ key: `g-${g.reference}`, tone: "amber", title: `${g.booking.bids} offer${g.booking.bids === 1 ? "" : "s"} to shortlist`, detail: `${where}. Pick up to three for your client to choose from.`, href, action: "Shortlist" });
      else if (g.shortlistStatus === "NONE") out.push({ key: `g-${g.reference}`, tone: "sky", title: "No offers yet", detail: `${where}. Invite listed owners to bid.`, href, action: "Invite" });
      else if (g.shortlistStatus === "PUBLISHED") out.push({ key: `g-${g.reference}`, tone: "sky", title: "Your client is choosing", detail: `${where}. Follow up so they pick and pay before the dates fill.`, href, action: "Open" });
    }
  }
  for (const l of links) {
    if (l.status !== "LIVE") continue;
    const left = daysLeft(l.expiresAt);
    if (left != null && left <= 3) out.push({ key: `l-${l.reference}`, tone: "amber", title: `Link "${l.label}" expires ${left <= 0 ? "today" : `in ${left} day${left === 1 ? "" : "s"}`}`, detail: "Make a new one if the client still needs it." });
  }
  for (const c of clients) {
    if (c.status !== "ACTIVE" || !c.protectionActive) continue;
    const left = daysLeft(c.protectedUntil);
    if (left != null && left <= 14) out.push({ key: `c-${c.reference}`, tone: "amber", title: `${c.name}: protection ends in ${left} day${left === 1 ? "" : "s"}`, detail: "Log a call or meeting to keep the client yours.", href: "/sales/agency/clients", action: "Log contact" });
  }
  const order = { rose: 0, amber: 1, sky: 2 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 6);
}

export default function SalesAgencyPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [links, setLinks] = useState<AgencyLink[]>([]);
  const [bookings, setBookings] = useState<CreditedBooking[]>([]);
  const [tours, setTours] = useState<CreditedTour[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acceptName, setAcceptName] = useState("");
  const [creating, setCreating] = useState(false);
  const [linkKind, setLinkKind] = useState<"STAY" | "TOUR">("STAY");
  const [pickedTour, setPickedTour] = useState<TourOption | null>(null);
  const [travelers, setTravelers] = useState("");
  const [form, setForm] = useState({ label: "", propertyUrl: "", clientName: "", clientPhone: "", expiresInDays: "30", maxUses: "" });
  const [linkFilter, setLinkFilter] = useState<"LIVE" | "ALL">("LIVE");
  const [credited, setCredited] = useState<"STAYS" | "TOURS">("STAYS");
  const [qr, setQr] = useState<{ reference: string; dataUrl: string } | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await apiClient.get("/api/sales/agency/status");
      setStatus(res.data);
      if (res.data?.status === "ACTIVE") {
        const [l, b, t, g, c] = await Promise.allSettled([
          apiClient.get("/api/sales/agency/links"),
          apiClient.get("/api/sales/agency/bookings"),
          apiClient.get("/api/sales/agency/tour-bookings"),
          apiClient.get("/api/sales/agency/groups"),
          apiClient.get("/api/sales/agency/clients"),
        ]);
        // Links and credited stays are the core of the page; the rest are extras that never blank it.
        if (l.status === "rejected" || b.status === "rejected") throw l.status === "rejected" ? l.reason : (b as PromiseRejectedResult).reason;
        setLinks(l.value.data?.items || []);
        setBookings(b.value.data?.items || []);
        setTours(t.status === "fulfilled" ? t.value.data?.items || [] : []);
        setGroups(g.status === "fulfilled" ? g.value.data?.items || [] : []);
        setClients(c.status === "fulfilled" ? c.value.data?.items || [] : []);
      }
    } catch (cause: any) {
      if (cause?.response?.status === 404 || cause?.response?.status === 403) setUnavailable(true);
      else setError(cause?.response?.data?.error || "Could not load the Agency Desk.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const steps = useMemo(() => nextSteps(groups, links, clients), [groups, links, clients]);
  const earnings = useMemo(() => {
    const live = (s: string) => !["REVERSED", "CANCELLED"].includes(s);
    const stays = bookings.reduce((sum, b) => sum + (b.commission && live(b.commission.status) ? b.commission.amount : 0), 0);
    const tourSum = tours.reduce((sum, t) => sum + (t.commission && live(t.commission.status) ? t.commission.amount : 0), 0);
    return { stays, tours: tourSum };
  }, [bookings, tours]);
  const inProgress = (g: GroupRow) => g.status === "AWAITING_CLIENT" || (g.status === "CONFIRMED" && !g.booking?.checkedIn && !["CANCELED", "CANCELLED", "EXPIRED"].includes(String(g.booking?.status || "").toUpperCase()));
  const groupsInProgress = groups.filter(inProgress).length;
  // Last 30 days as running totals, from dates the page already has.
  const trends = useMemo(() => {
    const live = (s: string) => !["REVERSED", "CANCELLED"].includes(s);
    return {
      earnings: dailyRunning([
        ...bookings.map((b) => ({ at: b.creditedAt, value: b.commission && live(b.commission.status) ? b.commission.amount : 0 })),
        ...tours.map((t) => ({ at: t.creditedAt, value: t.commission && live(t.commission.status) ? t.commission.amount : 0 })),
      ]),
      credited: dailyRunning([
        ...bookings.filter((b) => b.status === "ACTIVE").map((b) => ({ at: b.creditedAt, value: 1 })),
        ...tours.filter((t) => t.status === "ACTIVE").map((t) => ({ at: t.creditedAt, value: 1 })),
      ]),
      groups: dailyRunning(groups.filter((g) => g.status === "AWAITING_CLIENT" || g.status === "CONFIRMED").filter((g) => {
        const b = String(g.booking?.status || "").toUpperCase();
        return !g.booking?.checkedIn && !["CANCELED", "CANCELLED", "EXPIRED"].includes(b);
      }).map((g) => ({ at: g.createdAt, value: 1 }))),
    };
  }, [bookings, tours, groups]);
  const shownLinks = links.filter((l) => linkFilter === "ALL" || l.status === "LIVE");
  // Counted from the list itself so creating or closing a link updates it at once.
  const liveCount = links.filter((l) => l.status === "LIVE").length;

  // Stays and tours shaped the same way, so phones and desktop render one list.
  const creditedRows = useMemo(() => {
    const blocked = statusTone("REVERSED");
    if (credited === "STAYS") {
      return bookings.map((b, i) => ({
        key: `s-${b.creditedAt}-${i}`,
        title: b.booking?.property || "-",
        sub: b.link ? `via ${b.link.label}` : null,
        who: [b.booking?.guest, b.booking?.guestPhone].filter(Boolean).join(" · ") || null,
        when: b.booking ? `${day(b.booking.checkIn)} to ${day(b.booking.checkOut)}` : null,
        badge: b.status === "ACTIVE" ? "Credited" : codeLabel(b.status),
        badgeTone: b.status === "ACTIVE" ? statusTone("ACTIVE") : blocked,
        note: [b.blockedReason, b.commission?.reason].filter(Boolean).join(" ") || null,
        earning: b.commission ? money(b.commission.amount, b.commission.currency) : null,
        earningStatus: b.commission ? codeLabel(b.commission.status) : "",
        earningTone: b.commission ? statusTone(b.commission.status) : "",
        pending: b.status === "ACTIVE" ? "After payment and the stay" : "-",
      }));
    }
    return tours.map((t, i) => ({
      key: `t-${t.creditedAt}-${i}`,
      title: t.tour?.title || "-",
      sub: t.tour?.destination || null,
      who: t.tour ? `${t.tour.guest || "Guest"}, ${t.tour.travelers} ${t.tour.travelers === 1 ? "person" : "people"}` : null,
      when: t.tour?.startDate ? day(t.tour.startDate) : null,
      badge: t.status !== "ACTIVE" ? codeLabel(t.status) : t.tour?.paid ? codeLabel(t.tour.status) : "Waiting for payment",
      badgeTone: t.status !== "ACTIVE" ? blocked : t.tour?.paid ? statusTone("ACTIVE") : statusTone("PENDING"),
      note: [t.blockedReason, t.commission?.reason].filter(Boolean).join(" ") || null,
      earning: t.commission ? money(t.commission.amount) : null,
      earningStatus: t.commission ? codeLabel(t.commission.status) : "",
      earningTone: t.commission ? statusTone(t.commission.status) : "",
      pending: t.status === "ACTIVE" ? "After the tour is completed" : "-",
    }));
  }, [credited, bookings, tours]);

  const accept = async () => {
    if (!status?.termsHash) return;
    setBusy("accept");
    setError("");
    try {
      await apiClient.post("/api/sales/agency/addendum/accept", { acceptedName: acceptName.trim(), termsHash: status.termsHash });
      setNotice("Addendum accepted. Your Agency Desk is open.");
      setLoading(true);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not accept the addendum.");
    } finally {
      setBusy("");
    }
  };

  const resetForm = () => {
    setForm({ label: "", propertyUrl: "", clientName: "", clientPhone: "", expiresInDays: "30", maxUses: "" });
    setPickedTour(null);
    setTravelers("");
  };

  const createLink = async () => {
    if (linkKind === "TOUR" && !pickedTour) return setError("Choose a tour first.");
    if (linkKind === "STAY" && form.label.trim().length < 2) return setError("Give the link a label you will recognise.");
    setBusy("create");
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = { expiresInDays: Math.min(90, Math.max(1, Number(form.expiresInDays) || 30)) };
      if (form.label.trim()) body.label = form.label.trim();
      if (form.clientName.trim()) body.clientName = form.clientName.trim();
      if (form.clientPhone.trim()) body.clientPhone = form.clientPhone.trim();
      if (form.maxUses.trim()) body.maxUses = Math.max(1, Number(form.maxUses));
      let res;
      if (linkKind === "TOUR") {
        body.tourKey = pickedTour!.key;
        if (travelers.trim()) body.travelers = Number(travelers);
        res = await apiClient.post("/api/sales/agency/tour-links", body);
      } else {
        if (form.propertyUrl.trim()) body.propertyUrl = form.propertyUrl.trim();
        res = await apiClient.post("/api/sales/agency/links", body);
      }
      setLinks((prev) => [res.data.link, ...prev]);
      resetForm();
      setCreating(false);
      setLinkFilter("LIVE");
      setNotice("Link created. Copy it, share it on WhatsApp or show the QR code. Your client books and pays NoLSAF directly.");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not create the link.");
    } finally {
      setBusy("");
    }
  };

  const closeLink = async (reference: string) => {
    setBusy(`close-${reference}`);
    setError("");
    try {
      await apiClient.post(`/api/sales/agency/links/${encodeURIComponent(reference)}/revoke`, {});
      setLinks((prev) => prev.map((l) => (l.reference === reference ? { ...l, status: "REVOKED", url: null } : l)));
      setClosing(null);
      if (qr?.reference === reference) setQr(null);
      setNotice("Link closed. It no longer credits new bookings; bookings already credited keep their credit.");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not close the link.");
    } finally {
      setBusy("");
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied.");
    } catch {
      setError("Copy failed. Open the QR code or share on WhatsApp instead.");
    }
  };

  const shareWhatsApp = (l: AgencyLink) => {
    if (!l.url) return;
    const what = l.kind === "TOUR" ? `the ${l.tour?.title || "tour"}` : l.property?.title ? `${l.property.title}` : "your stay";
    const text = `Book ${what} on NoLSAF here: ${l.url}\nYou pay NoLSAF directly on the NoLSAF payment page.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const toggleQr = async (l: AgencyLink) => {
    if (!l.url) return;
    if (qr?.reference === l.reference) return setQr(null);
    try {
      const QR: any = await import("qrcode");
      const dataUrl: string = await (QR.default ?? QR).toDataURL(l.url, { margin: 1, width: 220, color: { dark: "#0b2420" } });
      setQr({ reference: l.reference, dataUrl });
    } catch {
      setError("Could not draw the QR code. Copy the link instead.");
    }
  };

  return (
    <SalesShell>
      <div id="sales-agency" className="space-y-4">
        <style>{`#sales-agency, #sales-agency * { box-sizing: border-box; }`}</style>
        <SalesPageHeader
          icon={Handshake}
          title="Agency Desk"
          description="Bring guests, groups and tours to NoLSAF. Your clients always book and pay NoLSAF directly, and you earn on completed, paid stays and tours."
          actions={status?.status === "ACTIVE" && !unavailable ? (
            <button type="button" className={`${primary} w-full justify-center sm:w-auto`} onClick={() => { setCreating((v) => !v); setError(""); }}>
              {creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{creating ? "Close" : "New booking link"}
            </button>
          ) : null}
        />

        {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p> : null}
        {notice ? <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{notice}</p> : null}

        {loading ? (
          <div className="grid min-h-[40vh] place-items-center text-[#02665e]"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : unavailable ? (
          <article className={`${card} p-5 text-sm text-slate-600`}>The Agency Desk is not available on your account.</article>
        ) : status?.status === "PENDING_ACCEPTANCE" ? (
          <article className={`${card} p-5`}>
            <p className="m-0 text-[15px] font-semibold text-slate-900">Read and accept the agency addendum</p>
            <p className="m-0 mt-1 text-[13px] text-slate-500">NoLSAF selected you for the Agency Desk. It opens once you accept these terms.</p>
            <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-4 font-sans text-sm leading-6 text-slate-700">{status.addendum}</pre>
            <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void accept(); }}>
              <label className="block flex-1 text-xs font-medium text-slate-600">
                Type your full name to accept
                <input value={acceptName} onChange={(e) => setAcceptName(e.target.value)} className={input} autoComplete="name" />
              </label>
              <button type="submit" disabled={busy === "accept" || acceptName.trim().length < 3} className={primary}>
                {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}I accept
              </button>
            </form>
          </article>
        ) : status ? (
          <>
            <AgencyTabs />

            {/* New link: inline, opened from the header button */}
            {creating ? (
              <article className={card}>
                <SectionTitle
                  action={
                    <div className="inline-flex rounded-md bg-slate-100 p-1" role="group" aria-label="Link type">
                      {(["STAY", "TOUR"] as const).map((k) => (
                        <button key={k} type="button" onClick={() => setLinkKind(k)} aria-pressed={linkKind === k}
                          className={`inline-flex h-8 items-center gap-1.5 rounded border-0 px-3 text-xs font-semibold ${linkKind === k ? "bg-white text-slate-900 shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-800"}`}>
                          {k === "STAY" ? <><BedDouble className="h-3.5 w-3.5" />Stay</> : <><Compass className="h-3.5 w-3.5" />Tour</>}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <Link2 className="h-4 w-4 text-[#02665e]" aria-hidden />New booking link
                </SectionTitle>
                <div className="border-0 border-t border-solid border-slate-200 p-4">
                  {linkKind === "TOUR" ? (
                    <div className="mb-4">
                      <TourPicker selected={pickedTour} onPick={setPickedTour} />
                    </div>
                  ) : null}
                  <form className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void createLink(); }}>
                    <label className={field}>Label{linkKind === "TOUR" ? " (optional)" : ""}
                      <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={linkKind === "TOUR" ? "Uses the tour name" : "Church conference, Mwanza"} className={input} />
                    </label>
                    {linkKind === "STAY" ? (
                      <div className={`${field} lg:col-span-2`}>
                        <span className={tipLabel}>Property page link (optional)
                          <InfoTip label="Pinning a property">Paste a NoLSAF property page link to send your client straight to it. Leave it empty and the link credits a booking at any property. Your own properties are never credited to you.</InfoTip>
                        </span>
                        <input value={form.propertyUrl} onChange={(e) => setForm({ ...form, propertyUrl: e.target.value })} aria-label="Property page link" placeholder="Leave empty to let the client choose" className={input} />
                      </div>
                    ) : (
                      <label className={`${field} lg:col-span-2`}>Travellers (optional)
                        <input value={travelers} onChange={(e) => setTravelers(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" placeholder={pickedTour ? `${pickedTour.minPax} to ${pickedTour.maxPax}` : "Number of people"} className={input} />
                      </label>
                    )}
                    <label className={field}>Client name (optional)<input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className={input} /></label>
                    <label className={field}>Client phone (optional)<input value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} inputMode="tel" placeholder="0712 345 678" className={input} /></label>
                    <div className="grid min-w-0 grid-cols-2 gap-3">
                      <div className={field}>
                        <span className={tipLabel}>Valid for (days)<InfoTip label="Link validity">After this many days the link stops crediting bookings. Make a new one if your client needs more time.</InfoTip></span>
                        <input value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value.replace(/\D/g, "").slice(0, 2) })} aria-label="Valid for (days)" inputMode="numeric" className={input} />
                      </div>
                      <div className={field}>
                        <span className={tipLabel}>Max bookings<InfoTip label="Max bookings">The link closes itself after this many bookings. Leave empty for no limit while it is valid.</InfoTip></span>
                        <input value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, "").slice(0, 3) })} aria-label="Max bookings" inputMode="numeric" placeholder="No limit" className={input} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-200 pt-3 sm:col-span-2 lg:col-span-3">
                      <button type="submit" disabled={busy === "create" || (linkKind === "TOUR" ? !pickedTour : form.label.trim().length < 2)} className={primary}>
                        {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" />}Create link
                      </button>
                      <span className="flex items-center gap-1 text-[12px] text-slate-500">
                        {liveCount} of {status.maxActiveLinks} live links used
                        <InfoTip label="How links credit you">A booking is credited when your client books through the link. One credit per booking, and a booking by you or your own account is never credited. Never collect money from a client.</InfoTip>
                      </span>
                    </div>
                  </form>
                </div>
              </article>
            ) : null}

            {/* Key figures */}
            <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-slate-300 bg-slate-200 lg:grid-cols-4" aria-label="Agency figures">
              <Figure icon={Wallet} tone="blue" label="Agency earnings" value={money(earnings.stays + earnings.tours)} note={`Stay rate ${status.stayRate}%`}
                trend={{ values: trends.earnings, format: (v) => money(v) }}
                tip="Stays earn after checkout, tours after the tour is completed, then a short checking window before you can withdraw. Refunded or cancelled bookings are reversed. The line follows the booking date over the last 30 days.">
                <Link href="/sales/earnings" className="mt-1 inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-[#02665e] no-underline hover:underline">See earnings <ArrowRight className="h-3 w-3" /></Link>
              </Figure>
              <Figure icon={CheckCircle2} tone="orange" label="Credited" value={bookings.filter((b) => b.status === "ACTIVE").length + tours.filter((t) => t.status === "ACTIVE").length} note={`${bookings.filter((b) => b.status === "ACTIVE").length} stays · ${tours.filter((t) => t.status === "ACTIVE").length} tours`}
                trend={{ values: trends.credited, format: (v) => `${Math.round(v)} credited` }}
                tip="Bookings your links brought in. Blocked or voided credits are not counted. The line is the running total over the last 30 days." />
              <Figure icon={Users} tone="violet" label="Groups in progress" value={groupsInProgress} note={`${clients.filter((c) => c.status === "ACTIVE").length} clients in your book`}
                trend={{ values: trends.groups, format: (v) => `${Math.round(v)} open` }} />
              <Figure icon={Link2} tone="amber" label="Live links" value={<>{liveCount} <span className="text-[14px] font-semibold text-slate-400">/ {status.maxActiveLinks}</span></>}
                note={liveCount >= status.maxActiveLinks ? "Limit reached: close an old link" : "Stay and tour links"}
                meter={{ used: liveCount, limit: status.maxActiveLinks }}
                tip="NoLSAF sets how many links you can have live at once. Close links you no longer use to make room." />
            </section>

            {/* Next steps */}
            <article className={card}>
              <SectionTitle><Clock className="h-4 w-4 text-[#02665e]" aria-hidden />Next steps</SectionTitle>
              {steps.length ? (
                <ul className="m-0 list-none border-0 border-t border-solid border-slate-200 p-0">
                  {steps.map((s) => {
                    const dot = s.tone === "rose" ? "bg-rose-500" : s.tone === "amber" ? "bg-amber-500" : "bg-sky-500";
                    return (
                      <li key={s.key} className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-200 px-4 py-3 first:border-t-0">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-[13px] font-semibold text-slate-900">{s.title}</p>
                          <p className="m-0 mt-0.5 text-[12px] text-slate-500">{s.detail}</p>
                        </div>
                        {s.href ? (
                          <Link href={s.href} className={`${ghost} no-underline hover:no-underline`}>{s.action || "Open"} <ArrowRight className="h-3.5 w-3.5" /></Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="m-0 flex items-center gap-2 border-0 border-t border-solid border-slate-200 px-4 py-3 text-[13px] text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden />You are up to date. Make a link or start a group stay to bring in your next client.</p>
              )}
            </article>

            {/* Links */}
            <article className={`${card} overflow-hidden`}>
              <SectionTitle
                action={
                  <div className="inline-flex rounded-md bg-slate-100 p-1" role="group" aria-label="Which links">
                    {(["LIVE", "ALL"] as const).map((f) => (
                      <button key={f} type="button" onClick={() => setLinkFilter(f)} aria-pressed={linkFilter === f}
                        className={`h-7 rounded border-0 px-3 text-xs font-semibold ${linkFilter === f ? "bg-white text-slate-900 shadow-sm" : "bg-transparent text-slate-500"}`}>
                        {f === "LIVE" ? `Live ${links.filter((l) => l.status === "LIVE").length}` : `All ${links.length}`}
                      </button>
                    ))}
                  </div>
                }
              >
                <Link2 className="h-4 w-4 text-[#02665e]" aria-hidden />Booking links
              </SectionTitle>
              {shownLinks.length ? (
                <ul className="m-0 list-none border-0 border-t border-solid border-slate-200 p-0">
                  {shownLinks.map((l) => {
                    const left = daysLeft(l.expiresAt);
                    const target = l.kind === "TOUR" ? (l.tour?.title || "Tour") : (l.property?.title || "Any property");
                    return (
                      <li key={l.reference} className="border-0 border-t border-solid border-slate-200 px-4 py-3 first:border-t-0">
                        <div className="flex flex-wrap items-start gap-3">
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${l.kind === "TOUR" ? "bg-violet-50 text-violet-700" : "bg-[#02665e]/10 text-[#02665e]"}`}>
                            {l.kind === "TOUR" ? <Compass className="h-4 w-4" /> : <BedDouble className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="m-0 flex flex-wrap items-center gap-2 text-[14px] font-semibold text-slate-900 [overflow-wrap:anywhere]">
                              {l.label}
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusTone(l.status === "LIVE" ? "ACTIVE" : l.status === "USED_UP" ? "PENDING" : "REVERSED")}`}>{codeLabel(l.status)}</span>
                            </p>
                            <p className="m-0 mt-0.5 text-[12px] text-slate-500 [overflow-wrap:anywhere]">
                              {target}
                              {l.clientName || l.clientPhone ? ` · for ${[l.clientName, l.clientPhone].filter(Boolean).join(", ")}` : ""}
                              {` · ${l.useCount}${l.maxUses ? ` of ${l.maxUses}` : ""} booking${l.useCount === 1 && !l.maxUses ? "" : "s"}`}
                              {l.status === "LIVE" ? ` · ${left != null && left <= 3 ? `expires ${left <= 0 ? "today" : `in ${left} day${left === 1 ? "" : "s"}`}` : `until ${day(l.expiresAt)}`}` : ""}
                            </p>
                          </div>
                          {l.status === "LIVE" ? (
                            <div className="flex flex-wrap gap-1.5">
                              {l.url ? (
                                <>
                                  <button type="button" className={ghost} onClick={() => void copy(l.url!)}><Copy className="h-3.5 w-3.5" />Copy</button>
                                  <button type="button" className={ghost} onClick={() => shareWhatsApp(l)}><MessageCircle className="h-3.5 w-3.5" />WhatsApp</button>
                                  <button type="button" className={ghost} aria-pressed={qr?.reference === l.reference} onClick={() => void toggleQr(l)}><QrCode className="h-3.5 w-3.5" />QR</button>
                                </>
                              ) : <span className="text-[12px] text-slate-500">Make a new link to share</span>}
                              {closing === l.reference ? (
                                <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 text-[12px] text-rose-800">
                                  Close this link?
                                  <button type="button" className="h-7 rounded border-0 bg-rose-600 px-2 text-xs font-semibold text-white disabled:opacity-60" disabled={busy === `close-${l.reference}`} onClick={() => void closeLink(l.reference)}>
                                    {busy === `close-${l.reference}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Close"}
                                  </button>
                                  <button type="button" className="h-7 rounded border-0 bg-transparent px-1.5 text-xs font-semibold text-rose-800" onClick={() => setClosing(null)}>Keep</button>
                                </span>
                              ) : (
                                <button type="button" className={`${ghost} text-rose-700`} onClick={() => setClosing(l.reference)}><XCircle className="h-3.5 w-3.5" />Close</button>
                              )}
                            </div>
                          ) : null}
                        </div>
                        {qr?.reference === l.reference ? (
                          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-md bg-slate-50 p-3 sm:ml-12">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={qr.dataUrl} alt={`QR code for ${l.label}`} width={140} height={140} className="rounded bg-white p-1" />
                            <p className="m-0 max-w-xs text-[12px] text-slate-600">Let your client scan this with their phone camera. It opens the NoLSAF booking page; they pay NoLSAF directly.</p>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="border-0 border-t border-solid border-slate-200 px-4 py-8 text-center">
                  <p className="m-0 text-sm font-semibold text-slate-800">{links.length ? "No live links" : "Make your first booking link"}</p>
                  <p className="m-0 mt-1 text-[13px] text-slate-500">A link credits the bookings your client makes through it. Pin it to a property or a tour, or leave it open.</p>
                  <button type="button" className={`${primary} mt-3`} onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New booking link</button>
                </div>
              )}
            </article>

            {/* Credited */}
            <article className={`${card} overflow-hidden`}>
              <SectionTitle
                action={
                  <div className="inline-flex rounded-md bg-slate-100 p-1" role="group" aria-label="Credited">
                    {(["STAYS", "TOURS"] as const).map((k) => (
                      <button key={k} type="button" onClick={() => setCredited(k)} aria-pressed={credited === k}
                        className={`h-7 rounded border-0 px-3 text-xs font-semibold ${credited === k ? "bg-white text-slate-900 shadow-sm" : "bg-transparent text-slate-500"}`}>
                        {k === "STAYS" ? `Stays ${bookings.length}` : `Tours ${tours.length}`}
                      </button>
                    ))}
                  </div>
                }
              >
                <CheckCircle2 className="h-4 w-4 text-[#02665e]" aria-hidden />Credited to you
                <InfoTip label="Credited to you">Each booking made through your links. An earning appears once the stay or tour is paid and completed. Blocked means NoLSAF could not credit it, for example a booking on your own property.</InfoTip>
              </SectionTitle>
              {creditedRows.length ? (
                <>
                  {/* Phones: one row per booking */}
                  <ul className="m-0 list-none border-0 border-t border-solid border-slate-200 p-0 md:hidden">
                    {creditedRows.map((row) => (
                      <li key={row.key} className="border-0 border-t border-solid border-slate-200 px-4 py-3 first:border-t-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="m-0 min-w-0 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{row.title}</p>
                          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${row.badgeTone}`}>{row.badge}</span>
                        </div>
                        <p className="m-0 mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">{[row.sub, row.who, row.when].filter(Boolean).join(" · ")}</p>
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs">
                          <span className="text-slate-500">Your earning</span>
                          {row.earning ? (
                            <span className="flex items-center gap-1.5">
                              <span className="font-semibold tabular-nums text-slate-900">{row.earning}</span>
                              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${row.earningTone}`}>{row.earningStatus}</span>
                            </span>
                          ) : <span className="text-slate-500">{row.pending}</span>}
                        </div>
                        {row.note ? <p className="m-0 mt-1.5 text-xs text-slate-500 [overflow-wrap:anywhere]">{row.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                  {/* Wider screens: fixed-column table */}
                  <table className="hidden w-full table-fixed border-collapse border-0 border-t border-solid border-slate-200 text-left text-sm md:table">
                    <colgroup><col className="w-[28%]" /><col className="w-[20%]" /><col className="w-[17%]" /><col className="w-[15%]" /><col /></colgroup>
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">{credited === "STAYS" ? "Property" : "Tour"}</th>
                        <th className="px-3 py-2.5 font-medium">Guest</th>
                        <th className="px-3 py-2.5 font-medium">{credited === "STAYS" ? "Stay" : "Date"}</th>
                        <th className="px-3 py-2.5 font-medium">Where it stands</th>
                        <th className="px-4 py-2.5 text-right font-medium">Earning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditedRows.map((row) => (
                        <tr key={row.key} className="border-0 border-t border-solid border-slate-200 align-top">
                          <td className="px-4 py-3">
                            <span className="block truncate font-medium text-slate-900" title={row.title}>{row.title}</span>
                            {row.sub ? <span className="block truncate text-xs text-slate-500" title={row.sub}>{row.sub}</span> : null}
                          </td>
                          <td className="px-3 py-3 text-slate-600 [overflow-wrap:anywhere]">{row.who || "-"}</td>
                          <td className="px-3 py-3 text-slate-600">{row.when || "-"}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-block max-w-full truncate rounded-md px-2 py-0.5 text-xs font-semibold ${row.badgeTone}`}>{row.badge}</span>
                            {row.note ? <p className="m-0 mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">{row.note}</p> : null}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.earning ? (
                              <>
                                <span className="block font-semibold tabular-nums text-slate-900">{row.earning}</span>
                                <span className={`mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${row.earningTone}`}>{row.earningStatus}</span>
                              </>
                            ) : <span className="text-xs text-slate-500">{row.pending}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="m-0 border-0 border-t border-solid border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  {credited === "STAYS" ? "No stays credited yet. Bookings made through your stay links appear here." : "No tours credited yet. Make a tour link, or recommend a tour from a group stay."}
                </p>
              )}
            </article>
          </>
        ) : null}
      </div>
    </SalesShell>
  );
}
