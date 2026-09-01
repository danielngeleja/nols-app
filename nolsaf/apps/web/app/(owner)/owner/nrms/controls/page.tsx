"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle, BarChart3, BedDouble, Check, CheckCircle2, ClipboardCheck, CloudOff, CreditCard,
  Gauge, Gift, Info, Layers3, Loader2, MessageSquareText, Plus, RefreshCw, Save, SlidersHorizontal,
  Sparkles, Star, Wrench, ChevronLeft, ChevronRight, X, Tag, Coins, Percent,
  Instagram, Phone, Mail, Clock3, Globe2, Eye, EyeOff,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import ShareBookingButton from "@/components/ShareBookingButton";
import { useNrms } from "../_components/NrmsProvider";

type Tab = "rates" | "readiness" | "service" | "guest" | "portfolio" | "growth";

/** Mirrors the workspace sidebar's Hotel controls children, in the same order. */
const CONTROL_TABS: Array<{ id: Tab; label: string; icon: typeof Gauge }> = [
  { id: "rates", label: "Rates", icon: SlidersHorizontal },
  { id: "readiness", label: "Readiness", icon: ClipboardCheck },
  { id: "service", label: "Service desk", icon: Wrench },
  { id: "guest", label: "Guest journey", icon: MessageSquareText },
  { id: "portfolio", label: "Portfolio", icon: Layers3 },
  { id: "growth", label: "Growth", icon: Gauge },
];
type GuestContact = {
  enabled: boolean; instagramUsername: string | null; whatsappPhone: string | null; receptionPhone: string | null;
  receptionEmail: string | null; contactHours: string | null; preferredLanguage: "EN" | "SW" | "EN_SW"; greeting: string | null;
};
type Dashboard = {
  ratePlans: any[]; restrictions: any[]; onboarding: any | null; serviceCases: any[]; paymentRequests: any[];
  journeys: any[]; forecast: any | null; recommendations: any[]; loyalty: any[]; reviews: any[]; portfolios: any[];
  roomTypes: any[]; roomUnits: any[]; eligibleReservations: any[]; ownerProperties: any[];
  guestContact: GuestContact;
  directConversion: { periodDays: number; events: Record<string, number>; sources: Record<string, number> };
  reviewInsights: { responses: number; overall: number | null; categories: Array<{ key: string; label: string; average: number; responses: number }>; selectedCategories: string[]; availableCategories: Array<{ key: string; label: string }> } | null;
};
type OfflineMutation = { clientMutationId: string; action: "SERVICE_CASE_CREATE" | "SERVICE_CASE_STATUS" | "ROOM_HOUSEKEEPING_STATUS"; targetId?: number; baseVersion?: number; payload: Record<string, unknown> };
type MetaConnection = { provider: "INSTAGRAM" | "WHATSAPP"; status: string; displayName: string | null; externalAccountId: string | null; phoneRegistrationComplete?: boolean | null; tokenExpiresAt: string | null; webhookSubscribedAt: string | null; lastWebhookAt: string | null; lastOutboundAt: string | null; lastError: string | null; version: number };
type MetaConnectionState = { connections: MetaConnection[]; readiness: { instagramOAuthConfigured: boolean; whatsappEmbeddedSignupConfigured: boolean; webhookConfigured: boolean; whatsappAppId: string | null; whatsappConfigId: string | null; graphVersion: string } };
type WhatsAppRegistrationDraft = { mode: "NEW"; authorizationCode: string; wabaId: string; phoneNumberId: string } | { mode: "EXISTING" };

const inputClass = "box-border min-h-10 w-full min-w-0 rounded-lg bg-white px-3 text-sm text-neutral-900 outline-none ring-1 ring-neutral-400 transition focus:ring-2 focus:ring-emerald-600 disabled:bg-neutral-100";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border-0 bg-[#075e54] px-4 text-xs font-bold text-white transition hover:bg-[#064b43] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500";
const emptyGuestContact: GuestContact = { enabled: false, instagramUsername: null, whatsappPhone: null, receptionPhone: null, receptionEmail: null, contactHours: null, preferredLanguage: "EN_SW", greeting: null };

function money(value: unknown, currency = "TZS") { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0)); }
function shortDate(value: string) { return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
function Label({ children }: { children: ReactNode }) { return <label className="grid gap-1.5 text-xs font-bold text-neutral-700">{children}</label>; }
function DateField({ label, aria, value, onChange, min }: { label: string; aria: string; value: string; onChange: (iso: string) => void; min?: string }) { return <div className="grid min-w-0 gap-1.5"><span className="text-xs font-bold text-neutral-700">{label}</span><DatePickerField label={aria} value={value} onChangeAction={onChange} min={min} size="sm" widthClassName="w-full" /></div>; }
const PAGE_SIZE = 12;
function paged<T>(items: T[], page: number, size = PAGE_SIZE) { const pages = Math.max(1, Math.ceil(items.length / size)); const current = Math.min(Math.max(1, page), pages); return { items: items.slice((current - 1) * size, current * size), pages, current, total: items.length }; }
function Pager({ current, pages, total, size = PAGE_SIZE, onPage }: { current: number; pages: number; total: number; size?: number; onPage: (page: number) => void }) {
  if (total <= size) return null;
  const from = (current - 1) * size + 1;
  const to = Math.min(total, current * size);
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-3 shadow-[inset_0_1px_0_0_#f5f5f5]">
    <p className="m-0 text-[10px] font-semibold text-neutral-500">Showing {from} to {to} of {total}</p>
    <div className="flex items-center gap-1">
      <button type="button" disabled={current <= 1} onClick={() => onPage(current - 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 text-[10px] font-bold text-neutral-600 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Prev</button>
      <span className="px-1.5 text-[10px] font-bold text-neutral-500">{current} / {pages}</span>
      <button type="button" disabled={current >= pages} onClick={() => onPage(current + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 text-[10px] font-bold text-neutral-600 disabled:cursor-not-allowed disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
  </div>;
}
function Empty({ children }: { children: ReactNode }) { return <div className="rounded-lg outline outline-1 outline-dashed outline-neutral-300 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">{children}</div>; }
function Status({ value }: { value: string }) { const positive = ["ACTIVE", "VERIFIED", "COMPLETED", "RESOLVED", "APPLIED", "SENT"].includes(value); const attention = ["BLOCKED", "FAILED", "URGENT", "OVERDUE"].includes(value); return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${positive ? "bg-emerald-50 text-emerald-700" : attention ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{value.replaceAll("_", " ")}</span>; }
type RestrictionConfirmation = { kind: "CREATE_STOP_SELL" } | { kind: "APPLY_STOP_SELL" | "REMOVE"; item: any };
function RestrictionConfirmationCard({ confirmation, busy, roomName, dates, onCancel, onConfirm }: { confirmation: RestrictionConfirmation; busy: boolean; roomName: string; dates: string; onCancel: () => void; onConfirm: () => void }) {
  const removing = confirmation.kind === "REMOVE";
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onCancel(); }}>
    <section role="alertdialog" aria-modal="true" aria-labelledby="restriction-confirmation-title" className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-neutral-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3"><span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${removing ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}><AlertTriangle className="h-4 w-4" /></span><div><h2 id="restriction-confirmation-title" className="m-0 text-base font-bold text-neutral-950">{removing ? "Remove this restriction?" : "Close sales for these dates?"}</h2><p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">{roomName} · {dates}</p></div></div>
        <button type="button" aria-label="Close confirmation" disabled={busy} onClick={onCancel} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-neutral-500 hover:bg-neutral-100"><X className="h-4 w-4" /></button>
      </header>
      <div className="px-5 py-4">
        {removing ? <><p className="m-0 text-sm leading-6 text-neutral-700">The restriction will stop affecting availability immediately. Existing bookings will not be changed.</p><p className="mb-0 mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-600">The record is archived with its change history, so this action remains traceable.</p></> : <><p className="m-0 text-sm leading-6 text-neutral-700">New bookings for the selected nights will be blocked on the property&apos;s Direct booking page and the NoLSAF marketplace, even when rooms are available.</p><ul className="mb-0 mt-3 space-y-2 pl-5 text-xs leading-5 text-neutral-600"><li>Existing confirmed bookings remain unchanged.</li><li>Booking.com, Expedia and other OTAs are not closed by this control alone; close them in each channel connection and wait for provider confirmation.</li></ul></>}
      </div>
      <footer className="flex items-center justify-end gap-2 bg-neutral-50 px-5 py-3 shadow-[inset_0_1px_0_0_#f5f5f5]">
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-10 rounded-md border border-neutral-300 bg-white px-4 text-xs font-bold text-neutral-700">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className={`inline-flex min-h-10 items-center gap-2 rounded-md border-0 px-4 text-xs font-bold text-white disabled:opacity-60 ${removing ? "bg-red-700 hover:bg-red-800" : "bg-[#075e54] hover:bg-[#064b43]"}`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{removing ? "Remove restriction" : "Confirm stop sell"}</button>
      </footer>
    </section>
  </div>;
}
/**
 * One control in the restrictions calendar, with the switches that release it.
 *
 * Releasing is the common case: a stop sell put on for a holiday gets lifted,
 * then wanted again next year. So stop sell has its own toggle, the whole rule
 * can be paused without losing what it holds, and removing it is the last
 * option rather than the only one.
 */
function RestrictionRow({ item, busy, onPatch, onApplyStopSell, onRemove }: { item: any; busy: string | null; onPatch: (body: Record<string, unknown>, note: string) => void; onApplyStopSell: () => void; onRemove: () => void }) {
  const working = busy === `restriction-${item.id}`;
  const paused = item.status === "PAUSED";
  const chip = "inline-flex min-h-8 items-center gap-1 rounded-md border border-neutral-200 bg-white px-3 text-[11px] font-semibold text-neutral-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <article className={`overflow-hidden rounded-xl border ${paused ? "border-dashed border-neutral-300 bg-neutral-50" : "border-neutral-200 bg-white"}`}>
      <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-neutral-900">{item.name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-500"><span>{item.roomType?.name || "Entire property"}</span><span className="h-1 w-1 rounded-full bg-neutral-300" /><span>{shortDate(item.startDate)} &ndash; {shortDate(item.endDate)}</span></div>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:justify-end">
          {paused && <Status value="PAUSED" />}
          {item.stopSell && <Status value="STOP_SELL" />}
          {item.minStay && <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-semibold">{item.minStay} night min</span>}
          {item.closedToArrival && <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-semibold">No arrivals</span>}
          {item.closedToDeparture && <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-semibold">No departures</span>}
        </div>
      </div>
      {item.stopSell && !paused && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Direct and NoLSAF sales are closed for these nights, even when rooms remain available.</span></div>
      )}
      <div className="flex flex-wrap items-center gap-2 bg-neutral-50/60 px-4 py-2.5 shadow-[inset_0_1px_0_0_#f5f5f5]">
        <button type="button" disabled={working} className={chip} onClick={() => item.stopSell ? onPatch({ stopSell: false, ...(!item.minStay && !item.maxStay && item.minAdvanceDays == null && item.maxAdvanceDays == null && !item.closedToArrival && !item.closedToDeparture ? { status: "PAUSED" } : {}) }, "Stop sell released. Direct and NoLSAF sales are open again.") : onApplyStopSell()}>
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {item.stopSell ? "Release stop sell" : "Apply stop sell"}
        </button>
        <button type="button" disabled={working} className={chip} onClick={() => onPatch({ status: paused ? "ACTIVE" : "PAUSED" }, paused ? "Restriction resumed." : "Restriction paused. Nothing is enforced while it is paused.")}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" disabled={working} className={`${chip} ml-auto hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700`} onClick={onRemove}>Remove</button>
      </div>
    </article>
  );
}

function RatePlanRow({ plan }: { plan: any }) {
  const pricing = plan.adjustmentType === "BASE" ? "Room base rate" : `${plan.adjustmentType.toLowerCase()} ${Number(plan.adjustment)}`;
  return <article className="flex min-h-[220px] flex-col overflow-hidden rounded-2xl bg-[#f6f8f8] ring-1 ring-inset ring-neutral-200/80">
    <div className="flex flex-1 flex-col p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-neutral-200/70"><BedDouble className="h-5 w-5" /></span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${plan.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-600"}`}><span className={`h-1.5 w-1.5 rounded-full ${plan.status === "ACTIVE" ? "bg-emerald-600" : "bg-neutral-500"}`} />{plan.status === "ACTIVE" ? "Active" : String(plan.status).replaceAll("_", " ").toLowerCase()}</span>
      </div>
      <div className="mt-4 min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 text-[15px] font-semibold leading-5 text-neutral-950">{plan.name}</h3>{plan.isDefault && <span className="rounded-md bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-emerald-700 ring-1 ring-inset ring-emerald-200">Default</span>}</div>
        <p className="mb-0 mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{plan.code}</p>
      </div>
      <dl className="mt-4 [&>*]:shadow-[inset_0_-1px_0_0_rgba(212,212,212,0.7)] [&>*:last-child]:shadow-none outline outline-1 outline-neutral-200">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3 py-2.5"><dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Applies to</dt><dd className="m-0 break-words text-right text-[11px] font-medium text-neutral-700">{plan.roomType?.name || "All room types"}</dd></div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3 py-2.5"><dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Meal plan</dt><dd className="m-0 break-words text-right text-[11px] font-medium capitalize text-neutral-700">{plan.mealPlan.replaceAll("_", " ").toLowerCase()}</dd></div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3 py-2.5"><dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Pricing</dt><dd className="m-0 break-words text-right text-[11px] font-medium capitalize text-neutral-700">{pricing}</dd></div>
      </dl>
    </div>
    <div className="bg-white/80 px-4 py-3 shadow-[inset_0_1px_0_0_rgba(212,212,212,0.8)] sm:px-5">
      {plan.seasons?.length > 0 ? <div className="space-y-2">{plan.seasons.map((season: any) => {
        const adjustment = season.adjustmentType === "PERCENT" ? `${Number(season.adjustment) > 0 ? "+" : ""}${Number(season.adjustment)}%` : `${season.adjustmentType.toLowerCase()} ${Number(season.adjustment)}`;
        return <div key={season.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><p className="m-0 truncate text-[11px] font-semibold text-neutral-800">{season.name}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-500">{shortDate(season.startDate)} &ndash; {shortDate(season.endDate)}</p></div><span className="w-fit rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800">{adjustment}</span></div>;
      })}</div> : <div className="flex items-center gap-2 text-[10px] text-neutral-500"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /><span>Base pricing applies year-round</span></div>}
    </div>
  </article>;
}

function ServiceCaseCard({ item, busy, onUpdate }: { item: any; busy: boolean; onUpdate: (status: string) => void }) {
  const actionClass = "inline-flex min-h-9 items-center justify-center rounded-md border px-3 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  return <article className="overflow-hidden rounded-2xl bg-[#f6f8f8] ring-1 ring-inset ring-neutral-200/80">
    <div className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-neutral-200/70"><Wrench className="h-5 w-5" /></span>
        <Status value={item.status} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2"><h3 className="m-0 text-[15px] font-semibold leading-5 text-neutral-950">{item.title}</h3><Status value={item.priority} /></div>
      <p className="mb-0 mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">{item.reference}</p>
      <dl className="mt-4 [&>*]:shadow-[inset_0_-1px_0_0_rgba(212,212,212,0.7)] [&>*:last-child]:shadow-none outline outline-1 outline-neutral-200">
        <div className="grid grid-cols-[82px_minmax(0,1fr)] items-start gap-3 py-2.5"><dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Category</dt><dd className="m-0 break-words text-right text-[11px] font-medium capitalize text-neutral-700">{item.category.replaceAll("_", " ").toLowerCase()}</dd></div>
        <div className="grid grid-cols-[82px_minmax(0,1fr)] items-start gap-3 py-2.5"><dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Location</dt><dd className="m-0 break-words text-right text-[11px] font-medium text-neutral-700">{item.roomUnit?.code ? `Room ${item.roomUnit.code}` : "General property"}</dd></div>
      </dl>
      {item.description && <div className="mt-3 rounded-xl bg-white px-3.5 py-3 text-[11px] leading-5 text-neutral-600 ring-1 ring-inset ring-neutral-200/70">{item.description}</div>}
    </div>
    <footer className="flex flex-wrap items-center gap-2 bg-white/80 px-4 py-3 shadow-[inset_0_1px_0_0_rgba(212,212,212,0.8)] sm:px-5">
      {item.status === "OPEN" && <button type="button" disabled={busy} onClick={() => onUpdate("ACKNOWLEDGED")} className={`${actionClass} border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50`}>Acknowledge</button>}
      {["OPEN", "ACKNOWLEDGED", "BLOCKED"].includes(item.status) && <button type="button" disabled={busy} onClick={() => onUpdate("IN_PROGRESS")} className={`${actionClass} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}>Start work</button>}
      {item.status !== "RESOLVED" && item.status !== "CANCELLED" && <button type="button" disabled={busy} onClick={() => onUpdate("RESOLVED")} className={`${actionClass} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Resolve</button>}
    </footer>
  </article>;
}

function JourneyTemplateCard({ item }: { item: any }) {
  return <article className="overflow-hidden rounded-2xl bg-[#f6f8f8] ring-1 ring-inset ring-neutral-200/80">
    <div className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-neutral-200/70"><MessageSquareText className="h-5 w-5" /></span><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${item.active ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-600"}`}><span className={`h-1.5 w-1.5 rounded-full ${item.active ? "bg-emerald-600" : "bg-neutral-500"}`} />{item.active ? "Active" : "Inactive"}</span></div>
      <h3 className="mb-0 mt-4 text-[15px] font-semibold leading-5 text-neutral-950">{item.name}</h3>
      <dl className="mt-4 [&>*]:shadow-[inset_0_-1px_0_0_rgba(212,212,212,0.7)] [&>*:last-child]:shadow-none outline outline-1 outline-neutral-200">
        <div className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-3 py-2.5"><dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Trigger</dt><dd className="m-0 break-words text-right text-[11px] font-medium capitalize text-neutral-700">{item.trigger.replaceAll("_", " ").toLowerCase()}</dd></div>
        <div className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-3 py-2.5"><dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Channel</dt><dd className="m-0 break-words text-right text-[11px] font-medium text-neutral-700">{item.channel}</dd></div>
      </dl>
    </div>
    <footer className="flex items-center gap-2 bg-white/80 px-4 py-3 text-[10px] text-neutral-500 shadow-[inset_0_1px_0_0_rgba(212,212,212,0.8)] sm:px-5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /><span>{item._count.deliveries} {item._count.deliveries === 1 ? "message" : "messages"} scheduled</span></footer>
  </article>;
}

/**
 * The action used to be a flex sibling of the whole title-plus-copy block, so
 * in a narrow column it wrapped onto its own line and sat orphaned under the
 * paragraph. It now rides on the title's line and the copy spans beneath both.
 */
function Section({ title, copy, action, children }: { title: string; copy: string; action?: ReactNode; children: ReactNode }) {
  return <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-neutral-200">
    <header className="px-5 py-4 shadow-[inset_0_-1px_0_0_#f5f5f5]">
      <div className="flex items-start justify-between gap-3">
        <h2 className="m-0 min-w-0 text-base font-bold text-neutral-950">{title}</h2>
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
      <p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-neutral-500">{copy}</p>
    </header>
    <div className="p-5">{children}</div>
  </section>;
}

function deviceId() {
  const key = "nrms-offline-device-id"; let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}
function queueKey(propertyId: number) { return `nrms-offline-queue:${propertyId}`; }
function readQueue(propertyId: number): OfflineMutation[] { try { return JSON.parse(localStorage.getItem(queueKey(propertyId)) || "[]"); } catch { return []; } }
function cacheKey(propertyId: number) { return `nrms-offline-snapshot:${propertyId}`; }

let metaSdkPromise: Promise<any> | null = null;
function loadMetaSdk(appId: string, graphVersion: string): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("Meta signup requires a browser"));
  const existing = (window as any).FB; if (existing) { existing.init({ appId, cookie: true, xfbml: false, version: graphVersion }); return Promise.resolve(existing); }
  if (metaSdkPromise) return metaSdkPromise;
  metaSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.async = true; script.defer = true; script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onload = () => { const sdk = (window as any).FB; if (!sdk) return reject(new Error("Meta SDK did not load")); sdk.init({ appId, cookie: true, xfbml: false, version: graphVersion }); resolve(sdk); };
    script.onerror = () => reject(new Error("Meta SDK could not be loaded")); document.head.appendChild(script);
  });
  return metaSdkPromise;
}
function WhatsAppRegistrationDialog({ busy, pin, confirmPin, onPin, onConfirmPin, onCancel, onConfirm }: { busy: boolean; pin: string; confirmPin: string; onPin: (value: string) => void; onConfirmPin: (value: string) => void; onCancel: () => void; onConfirm: () => void }) {
  const valid = /^\d{6}$/.test(pin) && pin === confirmPin;
  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-neutral-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onCancel(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="whatsapp-registration-title" className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-neutral-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3"><span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800"><MessageSquareText className="h-4 w-4" /></span><div><h2 id="whatsapp-registration-title" className="m-0 text-base font-bold text-neutral-950">Register this WhatsApp phone</h2><p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">Create the six-digit two-step verification PIN Meta requires before Cloud API messaging can start.</p></div></div>
        <button type="button" aria-label="Close WhatsApp registration" disabled={busy} onClick={onCancel} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-neutral-500 hover:bg-neutral-100"><X className="h-4 w-4" /></button>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); if (valid && !busy) onConfirm(); }}>
        <div className="space-y-4 px-5 py-5">
          <label className="grid gap-1.5 text-xs font-bold text-neutral-700">Six-digit PIN<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(event) => onPin(digits(event.target.value))} className={`${inputClass} font-mono tracking-[.35em]`} placeholder="••••••" /></label>
          <label className="grid gap-1.5 text-xs font-bold text-neutral-700">Confirm PIN<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirmPin} onChange={(event) => onConfirmPin(digits(event.target.value))} className={`${inputClass} font-mono tracking-[.35em]`} placeholder="••••••" /></label>
          {confirmPin.length === 6 && pin !== confirmPin && <p className="m-0 text-xs font-semibold text-red-700">The two PIN entries do not match.</p>}
          <div className="rounded-xl ring-1 ring-amber-200 bg-amber-50 px-3.5 py-3 text-[11px] leading-5 text-amber-950"><strong>Save this PIN securely.</strong> NoLSAF sends it to Meta for registration but does not store it. The hotel may need it again when changing or migrating this WhatsApp number.</div>
        </div>
        <footer className="flex items-center justify-end gap-2 bg-neutral-50 px-5 py-3 shadow-[inset_0_1px_0_0_#f5f5f5]"><button type="button" disabled={busy} onClick={onCancel} className="min-h-10 rounded-md border border-neutral-300 bg-white px-4 text-xs font-bold text-neutral-700">Cancel</button><button type="submit" disabled={!valid || busy} className="inline-flex min-h-10 items-center gap-2 rounded-md border-0 bg-[#075e54] px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Register phone</button></footer>
      </form>
    </section>
  </div>;
}

export default function NrmsControlsPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("rates"); const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [restrictionConfirmation, setRestrictionConfirmation] = useState<RestrictionConfirmation | null>(null);
  const [online, setOnline] = useState(true); const [queued, setQueued] = useState(0);
  const [rate, setRate] = useState({ code: "BAR", name: "Best available rate", roomTypeId: "", adjustmentType: "BASE", adjustment: "0", mealPlan: "ROOM_ONLY", defaultMinStay: "1", isDefault: true });
  const [restriction, setRestriction] = useState({ name: "", roomTypeId: "", startDate: "", endDate: "", minStay: "", stopSell: false, closedToArrival: false, closedToDeparture: false });
  const [season, setSeason] = useState({ ratePlanId: "", name: "", startDate: "", endDate: "", adjustmentType: "OFFSET", adjustment: "0", minStay: "" });
  const [service, setService] = useState({ title: "", category: "MAINTENANCE", priority: "NORMAL", roomUnitId: "", description: "" });
  const [journey, setJourney] = useState({ name: "", trigger: "PRE_ARRIVAL", offsetMinutes: "-1440", channel: "SMS", message: "Hello {{guest}}, we look forward to welcoming you to {{property}}." });
  const [guestContact, setGuestContact] = useState<GuestContact>(emptyGuestContact);
  const [metaConnections, setMetaConnections] = useState<MetaConnectionState | null>(null);
  const [metaConnectionStatus, setMetaConnectionStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [whatsappRegistration, setWhatsappRegistration] = useState<WhatsAppRegistrationDraft | null>(null);
  const [whatsappPin, setWhatsappPin] = useState(""); const [whatsappPinConfirmation, setWhatsappPinConfirmation] = useState("");
  const [payment, setPayment] = useState({ reservationId: "", kind: "DEPOSIT", amount: "", dueAt: "" });
  const [portfolio, setPortfolio] = useState({ name: "", propertyIds: [] as number[] });
  const [loyaltyPage, setLoyaltyPage] = useState(1); const [reviewPage, setReviewPage] = useState(1);

  useEffect(() => {
    const section = searchParams.get("section");
    if (section === "rates" || section === "readiness" || section === "service" || section === "guest" || section === "portfolio" || section === "growth") {
      setTab(section);
      setMessage(null);
      setError(null);
    }
  }, [searchParams]);

  useEffect(() => {
    const meta = searchParams.get("meta");
    if (meta === "connected") setMessage("Instagram is connected to this property. New direct messages can now enter Reception inquiries.");
    if (meta === "error") setError(`Instagram could not be connected (${searchParams.get("reason") || "connection failed"}).`);
  }, [searchParams]);

  const loadMetaConnections = useCallback(async () => {
    if (!selectedPropertyId) return;
    setMetaConnectionStatus("loading");
    try { const response = await apiClient.get<MetaConnectionState>(`/api/owner/nrms/messaging/property/${selectedPropertyId}`); setMetaConnections(response.data); setMetaConnectionStatus("ready"); }
    catch { setMetaConnections(null); setMetaConnectionStatus("unavailable"); }
  }, [selectedPropertyId]);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return; setLoading(true); setError(null);
    try { const response = await apiClient.get<Dashboard>(`/api/owner/nrms/market-readiness/${selectedPropertyId}`); setData(response.data); localStorage.setItem(cacheKey(selectedPropertyId), JSON.stringify({ savedAt: new Date().toISOString(), data: response.data })); void loadMetaConnections(); }
    catch (requestError: any) { try { const snapshot = JSON.parse(localStorage.getItem(cacheKey(selectedPropertyId)) || "null"); if (snapshot?.data) { setData(snapshot.data); setMessage(`Showing the last synced hotel snapshot from ${new Date(snapshot.savedAt).toLocaleString()}.`); } else setError(requestError?.response?.data?.error || "Hotel controls could not be loaded."); } catch { setError(requestError?.response?.data?.error || "Hotel controls could not be loaded."); } }
    finally { setLoading(false); }
  }, [loadMetaConnections, selectedPropertyId]);

  const replay = useCallback(async () => {
    if (!selectedPropertyId || !navigator.onLine) return; const mutations = readQueue(selectedPropertyId); if (!mutations.length) return;
    try { const response = await apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/offline/replay`, { deviceId: deviceId(), mutations }); const results = response.data?.results ?? []; const retry = mutations.filter((item) => !results.some((result: any) => result.clientMutationId === item.clientMutationId && result.status === "APPLIED")); localStorage.setItem(queueKey(selectedPropertyId), JSON.stringify(retry)); setQueued(retry.length); if (results.some((result: any) => result.status === "CONFLICT")) setError("An offline update conflicts with a newer server version. Review it in Service desk."); if (!retry.length) await load(); }
    catch { /* Preserve the queue until connectivity is genuinely restored. */ }
  }, [load, selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (data?.guestContact) setGuestContact(data.guestContact); }, [data?.guestContact]);
  useEffect(() => { const sync = () => { setOnline(navigator.onLine); if (selectedPropertyId) setQueued(readQueue(selectedPropertyId).length); if (navigator.onLine) void replay(); }; sync(); window.addEventListener("online", sync); window.addEventListener("offline", sync); return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); }; }, [replay, selectedPropertyId]);

  const act = async (key: string, request: () => Promise<unknown>, success: string): Promise<boolean> => { setBusy(key); setError(null); setMessage(null); try { await request(); setMessage(success); await load(); return true; } catch (requestError: any) { setError(requestError?.response?.data?.error || "The action could not be completed."); return false; } finally { setBusy(null); } };
  const normalizedRateCode = rate.code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const duplicateRatePlan = data?.ratePlans.find((plan) => plan.code === normalizedRateCode);
  const createRate = () => {
    if (duplicateRatePlan) { setError(`Rate plan code "${normalizedRateCode}" is already used by ${duplicateRatePlan.name}. Choose a different code or use the existing plan.`); return; }
    return act("rate", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/rate-plans`, { ...rate, roomTypeId: rate.roomTypeId ? Number(rate.roomTypeId) : null, adjustment: Number(rate.adjustment), defaultMinStay: Number(rate.defaultMinStay) }), "Rate plan saved.");
  };
  const createSeason = () => act("season", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/rate-plans/${season.ratePlanId}/seasons`, { name: season.name, startDate: season.startDate, endDate: season.endDate, adjustmentType: season.adjustmentType, adjustment: Number(season.adjustment), minStay: season.minStay ? Number(season.minStay) : null }), "Seasonal rate saved.");
  const saveRestriction = () => act("restriction", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/restrictions`, { ...restriction, roomTypeId: restriction.roomTypeId ? Number(restriction.roomTypeId) : null, minStay: restriction.minStay ? Number(restriction.minStay) : null }), restriction.stopSell ? "Stop sell applied to Direct and NoLSAF sales." : "Restriction saved.");
  const createRestriction = () => restriction.stopSell ? setRestrictionConfirmation({ kind: "CREATE_STOP_SELL" }) : saveRestriction();
  const confirmRestrictionAction = async () => {
    const confirmation = restrictionConfirmation; if (!confirmation) return;
    if (confirmation.kind === "CREATE_STOP_SELL") { if (await saveRestriction()) setRestrictionConfirmation(null); return; }
    const item = confirmation.item;
    const succeeded = confirmation.kind === "APPLY_STOP_SELL"
      ? await act(`restriction-${item.id}`, () => apiClient.patch(`/api/owner/nrms/market-readiness/${selectedPropertyId}/restrictions/${item.id}`, { version: item.version, stopSell: true, status: "ACTIVE" }), "Stop sell applied to Direct and NoLSAF sales.")
      : await act(`restriction-${item.id}`, () => apiClient.delete(`/api/owner/nrms/market-readiness/${selectedPropertyId}/restrictions/${item.id}`, { data: { version: item.version } }), "Restriction removed and retained in the audit history.");
    if (succeeded) setRestrictionConfirmation(null);
  };
  const createService = async () => {
    if (!selectedPropertyId || !service.title.trim()) return; const payload = { ...service, roomUnitId: service.roomUnitId ? Number(service.roomUnitId) : null };
    if (!navigator.onLine) { const queue = readQueue(selectedPropertyId); queue.push({ clientMutationId: crypto.randomUUID(), action: "SERVICE_CASE_CREATE", payload }); localStorage.setItem(queueKey(selectedPropertyId), JSON.stringify(queue)); setQueued(queue.length); setService((current) => ({ ...current, title: "", description: "" })); setMessage("Service case saved on this device and will sync when connection returns."); return; }
    await act("service", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/service-cases`, payload), "Service case opened.");
  };
  const updateCase = (item: any, status: string) => act(`case-${item.id}`, () => apiClient.patch(`/api/owner/nrms/market-readiness/${selectedPropertyId}/service-cases/${item.id}`, { version: item.version, status }), `Case ${status.toLowerCase().replaceAll("_", " ")}.`);
  const saveGuestContact = () => act("guest-contact", () => apiClient.put(`/api/owner/nrms/market-readiness/${selectedPropertyId}/guest-contact`, guestContact), guestContact.enabled ? "Guest contact channels are now live on the booking page." : "Public guest contact channels were saved but remain hidden.");
  const connectInstagram = async () => {
    if (!selectedPropertyId) return; setBusy("meta-instagram"); setError(null);
    try { const response = await apiClient.post(`/api/owner/nrms/messaging/property/${selectedPropertyId}/instagram/connect`); window.location.assign(response.data.authorizeUrl); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || "Instagram connection could not be started."); setBusy(null); }
  };
  const disconnectInstagram = () => act("meta-instagram", () => apiClient.post(`/api/owner/nrms/messaging/property/${selectedPropertyId}/INSTAGRAM/disconnect`), "Instagram was disconnected from this property.").then(() => loadMetaConnections());
  const connectWhatsApp = async () => {
    const readiness = metaConnections?.readiness; if (!selectedPropertyId || !readiness?.whatsappAppId || !readiness.whatsappConfigId) return;
    setBusy("meta-whatsapp"); setError(null); setMessage(null);
    let removeListener = () => {};
    try {
      const sdk = await loadMetaSdk(readiness.whatsappAppId, readiness.graphVersion);
      const assets = new Promise<{ wabaId: string; phoneNumberId: string }>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("WhatsApp signup timed out")), 120_000);
        const listener = (event: MessageEvent) => {
          if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
          let payload: any; try { payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
          if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
          if (payload.event === "CANCEL" || payload.event === "ERROR") { window.clearTimeout(timer); reject(new Error("WhatsApp signup was not completed")); return; }
          if (payload.event === "FINISH" && payload.data?.waba_id && payload.data?.phone_number_id) { window.clearTimeout(timer); resolve({ wabaId: String(payload.data.waba_id), phoneNumberId: String(payload.data.phone_number_id) }); }
        };
        window.addEventListener("message", listener); removeListener = () => { window.clearTimeout(timer); window.removeEventListener("message", listener); };
      });
      const code = new Promise<string>((resolve, reject) => sdk.login((response: any) => response?.authResponse?.code ? resolve(String(response.authResponse.code)) : reject(new Error("Meta did not authorize WhatsApp signup")), { config_id: readiness.whatsappConfigId, response_type: "code", override_default_response_type: true, extras: { setup: {} } }));
      const [authorizationCode, selectedAssets] = await Promise.all([code, assets]);
      setWhatsappPin(""); setWhatsappPinConfirmation("");
      setWhatsappRegistration({ mode: "NEW", authorizationCode, ...selectedAssets });
      setMessage("WhatsApp account selected. Create its six-digit registration PIN to finish the connection.");
    } catch (requestError: any) { setError(requestError?.response?.data?.error || requestError?.message || "WhatsApp connection could not be completed."); }
    finally { removeListener(); setBusy(null); }
  };
  const openWhatsAppRegistration = () => { setWhatsappPin(""); setWhatsappPinConfirmation(""); setError(null); setMessage(null); setWhatsappRegistration({ mode: "EXISTING" }); };
  const completeWhatsAppRegistration = async () => {
    const draft = whatsappRegistration; if (!draft || !selectedPropertyId || !/^\d{6}$/.test(whatsappPin) || whatsappPin !== whatsappPinConfirmation) return;
    setBusy("meta-whatsapp-register"); setError(null); setMessage(null);
    try {
      if (draft.mode === "NEW") await apiClient.post(`/api/owner/nrms/messaging/property/${selectedPropertyId}/whatsapp/connect`, { code: draft.authorizationCode, wabaId: draft.wabaId, phoneNumberId: draft.phoneNumberId, pin: whatsappPin });
      else await apiClient.post(`/api/owner/nrms/messaging/property/${selectedPropertyId}/whatsapp/register`, { pin: whatsappPin });
      setWhatsappRegistration(null); setWhatsappPin(""); setWhatsappPinConfirmation("");
      setMessage("WhatsApp Business is registered and connected to this property. Incoming messages can now enter Reception inquiries."); await loadMetaConnections();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "WhatsApp phone registration could not be completed.");
      if (draft.mode === "NEW" && requestError?.response?.data?.code === "WHATSAPP_PHONE_REGISTRATION_FAILED") setWhatsappRegistration(null);
      await loadMetaConnections();
    } finally { setBusy(null); }
  };
  const disconnectWhatsApp = () => act("meta-whatsapp", () => apiClient.post(`/api/owner/nrms/messaging/property/${selectedPropertyId}/WHATSAPP/disconnect`), "WhatsApp was disconnected from this property.").then(() => loadMetaConnections());
  const progress = useMemo(() => { const checks = data?.onboarding?.checks ?? []; return checks.length ? Math.round(checks.filter((item: any) => item.status === "VERIFIED").length / checks.length * 100) : 0; }, [data]);
  const loyaltyView = useMemo(() => paged(data?.loyalty ?? [], loyaltyPage), [data, loyaltyPage]);
  const reviewView = useMemo(() => paged(data?.reviews ?? [], reviewPage), [data, reviewPage]);
  const recoveryQueue = useMemo(() => (data?.reviews ?? []).filter((item: any) => item.needsRecovery && !item.recoveredAt), [data]);
  const publicChannelCount = [guestContact.instagramUsername, guestContact.whatsappPhone, guestContact.receptionPhone, guestContact.receptionEmail]
    .filter((value) => Boolean(value?.trim())).length;
  const toggleReviewCategory = (key: string) => {
    const current: string[] = data?.reviewInsights?.selectedCategories ?? [];
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    return act(`review-category-${key}`, () => apiClient.put(`/api/owner/nrms/market-readiness/${selectedPropertyId}/review-categories`, { categories: next }), "Review questions updated.");
  };

  if (loading && !data) return <div className="flex min-h-[50vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return <div id="nrms-controls" className="mx-auto max-w-[1500px] space-y-5 pb-10">
    <style dangerouslySetInnerHTML={{ __html: `#nrms-controls *{box-sizing:border-box}#nrms-controls input[type=checkbox]{appearance:none;-webkit-appearance:none;width:1.05rem;height:1.05rem;flex:0 0 auto;border:1.5px solid #cbd5e1;border-radius:5px;background:#fff;cursor:pointer;position:relative;vertical-align:middle;transition:border-color .15s,background-color .15s}#nrms-controls input[type=checkbox]:hover{border-color:#059669}#nrms-controls input[type=checkbox]:checked{background:#059669;border-color:#059669}#nrms-controls input[type=checkbox]:checked::after{content:"";position:absolute;left:5px;top:1.5px;width:4px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}#nrms-controls input[type=checkbox]:focus-visible{outline:2px solid #10b981;outline-offset:1px}` }} />
    {restrictionConfirmation && <RestrictionConfirmationCard
      confirmation={restrictionConfirmation}
      busy={restrictionConfirmation.kind === "CREATE_STOP_SELL" ? busy === "restriction" : busy === `restriction-${restrictionConfirmation.item.id}`}
      roomName={restrictionConfirmation.kind === "CREATE_STOP_SELL" ? (data?.roomTypes.find((room) => String(room.id) === restriction.roomTypeId)?.name || "Entire property") : (restrictionConfirmation.item.roomType?.name || "Entire property")}
      dates={restrictionConfirmation.kind === "CREATE_STOP_SELL" ? `${shortDate(restriction.startDate)} to ${shortDate(restriction.endDate)}` : `${shortDate(restrictionConfirmation.item.startDate)} to ${shortDate(restrictionConfirmation.item.endDate)}`}
      onCancel={() => setRestrictionConfirmation(null)}
      onConfirm={() => void confirmRestrictionAction()}
    />}
    {whatsappRegistration && <WhatsAppRegistrationDialog busy={busy === "meta-whatsapp-register"} pin={whatsappPin} confirmPin={whatsappPinConfirmation} onPin={setWhatsappPin} onConfirmPin={setWhatsappPinConfirmation} onCancel={() => { if (busy !== "meta-whatsapp-register") setWhatsappRegistration(null); }} onConfirm={() => void completeWhatsAppRegistration()} />}
    {/* Preflight is disabled app-wide, so `border-*` sets a width against
        border-style: none and paints nothing. Edges here are rings. */}
    <header className="relative overflow-visible rounded-2xl bg-[linear-gradient(115deg,#ffffff_0%,#ffffff_55%,#ecfdf5_100%)] shadow-[0_8px_24px_rgba(15,23,42,0.08)] ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4 px-5 py-4 sm:px-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-950 text-emerald-200 shadow-[0_6px_14px_rgba(6,78,59,0.2)] ring-1 ring-emerald-800"><Gauge className="h-5 w-5" /></span>
        <div className="min-w-[15rem] flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-700">NRMS command centre</p><span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-600 shadow-sm ring-1 ring-slate-200"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /><span className="truncate">{selectedProperty?.title || "Property workspace"}</span></span></div>
          <h1 className="mb-0 mt-1.5 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Hotel controls</h1>
          <p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-neutral-500">Manage rates, readiness, operations and direct guest conversion from one property workspace.</p>
        </div>
        {/* The status and the two buttons used to live in a bordered box nested
            inside the header, which read as a separate panel bolted on. They
            are peers of the title now, not a card within a card. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-[11px] font-bold shadow-sm ring-1 ${online ? "bg-white text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-900 ring-amber-300"}`} title={online ? "Changes save straight to the workspace" : "Changes are held on this device until the connection returns"}>
            {online ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <CloudOff className="h-4 w-4 shrink-0" />}
            {online ? (queued ? `${queued} changes waiting` : "Synced") : `${queued} saved offline`}
          </span>
          <ShareBookingButton propertyId={selectedPropertyId} propertyTitle={selectedProperty?.title} />
          <button type="button" onClick={() => void load()} className="inline-flex min-h-10 appearance-none items-center gap-2 rounded-lg border-0 bg-white px-3.5 text-xs font-bold text-neutral-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-emerald-50 hover:text-emerald-800 hover:ring-emerald-300"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
      </div>

      {/* Sections were only reachable from the workspace sidebar, so the page
          never showed which of the six you were in. */}
      <nav aria-label="Hotel controls sections" className="flex gap-1 overflow-x-auto px-3 pb-2 shadow-[inset_0_1px_0_0_#e2e8f0] sm:px-4">
        {CONTROL_TABS.map((item) => {
          const on = tab === item.id;
          return <Link
            key={item.id}
            href={`/owner/nrms/controls?section=${item.id}`}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-t-lg px-3 text-xs font-bold no-underline transition hover:no-underline ${on ? "bg-white text-emerald-800 shadow-[inset_0_-2px_0_0_#047857]" : "text-neutral-500 hover:bg-white/70 hover:text-neutral-800"}`}
          >
            <item.icon className="h-3.5 w-3.5" />{item.label}
          </Link>;
        })}
      </nav>
    </header>
    {(message || error) && <div className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ring-1 ${error ? "ring-red-200 bg-red-50 text-red-800" : "ring-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || message}</span></div>}
    {tab === "rates" && <div className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
      <div className="space-y-5">
        <Section
          title="New rate plan"
          copy="Create a reusable price for direct bookings and connected channels."
          action={<button type="button" title="A rate plan controls who can book, what is included and how the nightly price is calculated." aria-label="About rate plans" className="inline-flex h-8 w-8 cursor-help appearance-none items-center justify-center rounded-full border-0 bg-white text-neutral-400 outline-none ring-1 ring-neutral-200 transition hover:text-emerald-700 hover:ring-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500"><Info className="h-4 w-4" /></button>}
        >
          <div className="space-y-5">
            {/* Step 1: identity */}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,.42fr)]">
              <label htmlFor="rate-plan-name" className="grid min-w-0 gap-1.5 text-xs font-semibold text-neutral-700">Plan name<input id="rate-plan-name" className={inputClass} value={rate.name} onChange={(event) => setRate({ ...rate, name: event.target.value })} placeholder="e.g. Best Available Rate" /></label>
              <label htmlFor="rate-plan-code" className="grid min-w-0 gap-1.5 text-xs font-semibold text-neutral-700">
                Code
                <span className="relative block">
                  {/* Ring-based, matching inputClass. A `border-red-300` here
                      would draw a second outline outside the neutral ring. */}
                  <input id="rate-plan-code" aria-invalid={Boolean(duplicateRatePlan)} aria-describedby={duplicateRatePlan ? "rate-plan-code-error" : undefined} autoCapitalize="characters" spellCheck={false} className={`${inputClass} uppercase ${duplicateRatePlan ? "bg-red-50/40 pr-9 ring-red-400 focus:ring-2 focus:ring-red-500" : ""}`} value={rate.code} onChange={(event) => setRate({ ...rate, code: event.target.value })} placeholder="e.g. BAR" />
                  {duplicateRatePlan && <span title={`Already used by ${duplicateRatePlan.name}`} aria-hidden="true" className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 text-red-500"><AlertTriangle className="h-4 w-4" /></span>}
                  {duplicateRatePlan && <span id="rate-plan-code-error" className="sr-only">Already used by {duplicateRatePlan.name}.</span>}
                </span>
              </label>
            </div>
            {/* A negative margin used to pull this under the field, where a
                two-line message collided with whatever followed. It is a
                proper alert now, so it can wrap to any height safely. */}
            {duplicateRatePlan && <p className="m-0 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold leading-4 text-red-700 ring-1 ring-red-200"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /><span>Code &ldquo;{normalizedRateCode}&rdquo; already belongs to {duplicateRatePlan.name}. Choose another code.</span></p>}

            {/* Step 2: what the guest gets */}
            <div className="pt-4 shadow-[inset_0_1px_0_0_#f5f5f5]">
              <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">What guests get</p>
              <label htmlFor="rate-plan-room-type" className="grid gap-1.5 text-xs font-semibold text-neutral-700">Room type<select id="rate-plan-room-type" className={inputClass} value={rate.roomTypeId} onChange={(event) => setRate({ ...rate, roomTypeId: event.target.value })}><option value="">All room types</option>{data?.roomTypes.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
              <p className="mb-1.5 mt-4 text-xs font-semibold text-neutral-700">Meal plan</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Meal plan">
                {[["ROOM_ONLY", "Room only"], ["BREAKFAST", "Breakfast"], ["HALF_BOARD", "Half board"], ["FULL_BOARD", "Full board"]].map(([value, label]) => {
                  const active = rate.mealPlan === value;
                  return <button key={value} type="button" aria-pressed={active} onClick={() => setRate({ ...rate, mealPlan: value })} className={`min-h-9 rounded-full border px-3.5 text-[11px] font-bold transition ${active ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>{label}</button>;
                })}
              </div>
            </div>

            {/* Step 3: pricing method as tap tiles */}
            <div className="pt-4 shadow-[inset_0_1px_0_0_#f5f5f5]">
              <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">How this plan is priced</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { value: "BASE", label: "Room base rate", hint: "Follows each room's own price", Icon: BedDouble },
                  { value: "FIXED", label: "Fixed nightly", hint: "One set price per night", Icon: Tag },
                  { value: "OFFSET", label: "Adjust by amount", hint: "Add or subtract TZS", Icon: Coins },
                  { value: "PERCENT", label: "Adjust by percent", hint: "Raise or lower by a %", Icon: Percent },
                ].map(({ value, label, hint, Icon }) => {
                  const active = rate.adjustmentType === value;
                  return (
                    <button key={value} type="button" aria-pressed={active} onClick={() => setRate({ ...rate, adjustmentType: value, adjustment: value === "BASE" ? "0" : rate.adjustment })} className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${active ? "border-emerald-600 bg-emerald-50 ring-1 ring-inset ring-emerald-600" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-500"}`}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0"><span className="block text-xs font-bold text-neutral-900">{label}</span><span className="mt-0.5 block text-[10px] leading-4 text-neutral-500">{hint}</span></span>
                    </button>
                  );
                })}
              </div>
              {rate.adjustmentType === "BASE"
                ? <p className="mt-3 flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />No price to set. Each room is sold at the base rate you configure on its room type.</p>
                : <label htmlFor="rate-plan-value" className="mt-3 grid gap-1.5 text-xs font-semibold text-neutral-700">{rate.adjustmentType === "FIXED" ? "Nightly price" : rate.adjustmentType === "PERCENT" ? "Percentage change" : "Amount change"}
                    <span className="relative block">
                      {rate.adjustmentType !== "PERCENT" && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400">TZS</span>}
                      <input id="rate-plan-value" type="number" step="1" className={`${inputClass} ${rate.adjustmentType === "PERCENT" ? "!pr-9" : "!pl-12"}`} value={rate.adjustment} onChange={(event) => setRate({ ...rate, adjustment: event.target.value })} placeholder={rate.adjustmentType === "FIXED" ? "120000" : rate.adjustmentType === "PERCENT" ? "10 or -10" : "10000 or -10000"} />
                      {rate.adjustmentType === "PERCENT" && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400">%</span>}
                    </span>
                    {rate.adjustmentType !== "FIXED" && <span className="text-[10px] font-medium text-neutral-400">Use a minus sign to sell below the base rate, e.g. -10.</span>}
                  </label>}
            </div>

            {/* Step 4: booking rules */}
            <div className="pt-4 shadow-[inset_0_1px_0_0_#f5f5f5]">
              <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Booking rules</p>
              <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
                <label htmlFor="rate-plan-minimum-stay" className="grid gap-1.5 text-xs font-semibold text-neutral-700">Minimum stay<input id="rate-plan-minimum-stay" type="number" min="1" max="365" className={inputClass} value={rate.defaultMinStay} onChange={(event) => setRate({ ...rate, defaultMinStay: event.target.value })} placeholder="1 night" /></label>
                <label htmlFor="rate-plan-default" className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg ring-1 ring-neutral-200 bg-neutral-50 px-3 text-xs font-semibold text-neutral-700"><input id="rate-plan-default" type="checkbox" checked={rate.isDefault} onChange={(event) => setRate({ ...rate, isDefault: event.target.checked })} />Default direct rate</label>
              </div>
            </div>

            {/* Live preview of the plan being built */}
            {(() => {
              const roomName = rate.roomTypeId ? (data?.roomTypes.find((room) => String(room.id) === rate.roomTypeId)?.name || "the selected room") : "all room types";
              const mealLabel = ({ ROOM_ONLY: "room only", BREAKFAST: "breakfast included", HALF_BOARD: "half board", FULL_BOARD: "full board" } as Record<string, string>)[rate.mealPlan];
              const amount = Number(rate.adjustment) || 0;
              const price = rate.adjustmentType === "BASE" ? "each room's base rate"
                : rate.adjustmentType === "FIXED" ? `${money(amount)} per night`
                : rate.adjustmentType === "PERCENT" ? `the base rate ${amount >= 0 ? "+" : "-"}${Math.abs(amount)}%`
                : `the base rate ${amount >= 0 ? "+" : "-"}${money(Math.abs(amount))}`;
              return <div className="flex items-start gap-3 rounded-xl bg-[#f6f8f8] px-4 py-3 ring-1 ring-inset ring-neutral-200/80">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm ring-1 ring-neutral-200/70"><Sparkles className="h-4 w-4" /></span>
                <p className="m-0 text-[11px] leading-5 text-neutral-600"><span className="font-bold text-neutral-900">{rate.name || "This plan"}</span> sells {roomName}, {mealLabel}, at {price}{Number(rate.defaultMinStay) > 1 ? `, ${rate.defaultMinStay}-night minimum` : ""}.{rate.isDefault ? " Shown as the default direct rate." : ""}</p>
              </div>;
            })()}
          </div>
          <div className="mt-5 flex justify-end pt-4 shadow-[inset_0_1px_0_0_#f5f5f5]">
            <button type="button" className={`${buttonClass} w-full sm:w-auto`} disabled={busy === "rate" || Boolean(duplicateRatePlan)} onClick={createRate}>{busy === "rate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save rate plan</button>
          </div>
        </Section>
      <Section title="Seasonal override" copy="Apply one fixed, amount or percentage adjustment to a selected plan for a controlled period."><div className="grid gap-4 sm:grid-cols-2"><Label>Rate plan<select className={inputClass} value={season.ratePlanId} onChange={(event) => setSeason({ ...season, ratePlanId: event.target.value })}><option value="">Select plan</option>{data?.ratePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></Label><Label>Season name<input className={inputClass} value={season.name} onChange={(event) => setSeason({ ...season, name: event.target.value })} placeholder="High season" /></Label><DateField label="From" aria="Season start date" value={season.startDate} onChange={(iso) => setSeason({ ...season, startDate: iso })} /><DateField label="To" aria="Season end date" value={season.endDate} onChange={(iso) => setSeason({ ...season, endDate: iso })} min={season.startDate || undefined} /><Label>Adjustment<select className={inputClass} value={season.adjustmentType} onChange={(event) => setSeason({ ...season, adjustmentType: event.target.value })}><option value="OFFSET">Amount</option><option value="PERCENT">Percentage</option><option value="FIXED">Fixed nightly rate</option></select></Label><Label>Value<input type="number" className={inputClass} value={season.adjustment} onChange={(event) => setSeason({ ...season, adjustment: event.target.value })} /></Label></div><button className={`${buttonClass} mt-5`} disabled={busy === "season" || !season.ratePlanId || !season.name || !season.startDate || !season.endDate} onClick={createSeason}><Plus className="h-4 w-4" />Add season</button></Section>
      <Section title="New restriction" copy="Apply minimum stay, arrival/departure closure or stop-sell for a controlled date range."><div className="grid gap-4 sm:grid-cols-2"><Label>Name<input className={inputClass} value={restriction.name} onChange={(event) => setRestriction({ ...restriction, name: event.target.value })} placeholder="Eid minimum stay" /></Label><Label>Room type<select className={inputClass} value={restriction.roomTypeId} onChange={(event) => setRestriction({ ...restriction, roomTypeId: event.target.value })}><option value="">Entire property</option>{data?.roomTypes.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></Label><DateField label="From" aria="Restriction start date" value={restriction.startDate} onChange={(iso) => setRestriction({ ...restriction, startDate: iso })} /><DateField label="To" aria="Restriction end date" value={restriction.endDate} onChange={(iso) => setRestriction({ ...restriction, endDate: iso })} min={restriction.startDate || undefined} /><Label>Minimum stay<input type="number" min="1" className={inputClass} value={restriction.minStay} onChange={(event) => setRestriction({ ...restriction, minStay: event.target.value })} /></Label><div className="grid gap-2 pt-1 text-xs font-semibold text-neutral-700"><label><input type="checkbox" checked={restriction.stopSell} onChange={(event) => setRestriction({ ...restriction, stopSell: event.target.checked })} /> <span className="ml-1">Stop sell</span></label><label><input type="checkbox" checked={restriction.closedToArrival} onChange={(event) => setRestriction({ ...restriction, closedToArrival: event.target.checked })} /> <span className="ml-1">Closed to arrival</span></label><label><input type="checkbox" checked={restriction.closedToDeparture} onChange={(event) => setRestriction({ ...restriction, closedToDeparture: event.target.checked })} /> <span className="ml-1">Closed to departure</span></label></div></div><button className={`${buttonClass} mt-5`} disabled={busy === "restriction" || !restriction.name || !restriction.startDate || !restriction.endDate || (!restriction.stopSell && !restriction.closedToArrival && !restriction.closedToDeparture && !restriction.minStay)} onClick={createRestriction}><Plus className="h-4 w-4" />Add restriction</button></Section></div>
      <div className="self-start space-y-5">
        <Section title="Rate plans" copy="How each room is packaged and priced, including seasonal adjustments.">
          {data?.ratePlans.length ? <div className="grid gap-3 md:grid-cols-2">{data.ratePlans.map((plan) => <RatePlanRow key={plan.id} plan={plan} />)}</div> : <Empty>No rate plans yet. Start with a default Best Available Rate.</Empty>}
        </Section>
        <Section title="Sales restrictions" copy="Direct and NoLSAF changes are immediate. OTA closures take effect only after each connected provider acknowledges them.">
          {data?.restrictions.length ? <div className="space-y-2">{data.restrictions.map((item) => <RestrictionRow key={item.id} item={item} busy={busy} onPatch={(body, note) => act(`restriction-${item.id}`, () => apiClient.patch(`/api/owner/nrms/market-readiness/${selectedPropertyId}/restrictions/${item.id}`, { version: item.version, ...body }), note)} onApplyStopSell={() => setRestrictionConfirmation({ kind: "APPLY_STOP_SELL", item })} onRemove={() => setRestrictionConfirmation({ kind: "REMOVE", item })} />)}</div> : <Empty>No restrictions have been set.</Empty>}
        </Section>
      </div>
    </div>}

    {tab === "readiness" && <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><Section title="Guided readiness" copy="A required, evidence-backed checklist replaces informal go-live decisions." action={!data?.onboarding || data.onboarding.status !== "IN_PROGRESS" ? <button className={buttonClass} disabled={busy === "start"} onClick={() => act("start", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/onboarding/start`), "Readiness workflow started.")}><Plus className="h-4 w-4" />Start assessment</button> : undefined}>{data?.onboarding ? <><div className="mb-5 flex items-end justify-between gap-4"><div><p className="m-0 text-3xl font-bold text-neutral-950">{progress}%</p><p className="mb-0 mt-1 text-xs text-neutral-500">Required controls verified</p></div><Status value={data.onboarding.status} /></div><div className="mb-5 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} /></div><div className="[&>*]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>*:last-child]:shadow-none outline outline-1 outline-neutral-100">{data.onboarding.checks.map((check: any) => <div key={check.id} className="flex items-center justify-between gap-4 py-3"><div className="flex items-center gap-3"><span className={`flex h-7 w-7 items-center justify-center rounded-full ${check.status === "VERIFIED" ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-400"}`}>{check.status === "VERIFIED" ? <Check className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-current" />}</span><div><p className="m-0 text-xs font-bold text-neutral-900">{check.label}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{check.key}</p></div></div><button type="button" disabled={busy === `check-${check.id}`} onClick={() => act(`check-${check.id}`, () => apiClient.patch(`/api/owner/nrms/market-readiness/${selectedPropertyId}/onboarding/checks/${check.id}`, { status: check.status === "VERIFIED" ? "PENDING" : "VERIFIED", evidence: { confirmedInWorkspace: true } }), "Readiness evidence updated.")} className="min-h-8 rounded-md border border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-600">{check.status === "VERIFIED" ? "Reopen" : "Verify"}</button></div>)}</div><button className={`${buttonClass} mt-5 w-full`} disabled={progress !== 100 || busy === "complete" || data.onboarding.status === "COMPLETED"} onClick={() => act("complete", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/onboarding/complete`), "Property readiness completed.")}><ClipboardCheck className="h-4 w-4" />{data.onboarding.status === "COMPLETED" ? "Readiness approved" : "Complete readiness review"}</button></> : <Empty>No readiness assessment has been started.</Empty>}</Section><Section title="Safe onboarding design" copy="Every setup run keeps validation and rollback evidence so imported data can be inspected before go-live."><div className="space-y-4">{[["Validate before activation", "Room inventory, rates, payment instructions and staff access are checked as a group."], ["No silent overwrite", "Imported identifiers are snapshotted and every checklist decision records who verified it."], ["Controlled rollback", "A setup can be reversed from its captured snapshot without deleting live reservations."], ["Dry-run inventory", "The final gate requires a reservation and availability test before completion."]].map(([title, copy], index) => <div key={title} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">{index + 1}</span><div><p className="m-0 text-xs font-bold text-neutral-900">{title}</p><p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">{copy}</p></div></div>)}</div></Section></div>}

    {tab === "service" && <div className="grid items-start gap-5 xl:grid-cols-[.75fr_1.25fr]">
      <Section title="Open service case" copy="Create a tracked maintenance or guest request. If the network drops, the case is safely queued on this device."><div className="grid gap-4"><Label>Issue title<input className={inputClass} value={service.title} onChange={(event) => setService({ ...service, title: event.target.value })} placeholder="Air conditioner not cooling" /></Label><div className="grid gap-4 sm:grid-cols-2"><Label>Category<select className={inputClass} value={service.category} onChange={(event) => setService({ ...service, category: event.target.value })}><option value="MAINTENANCE">Maintenance</option><option value="GUEST_REQUEST">Guest request</option><option value="SAFETY">Safety</option><option value="IT">IT</option><option value="OTHER">Other</option></select></Label><Label>Priority<select className={inputClass} value={service.priority} onChange={(event) => setService({ ...service, priority: event.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></Label></div><Label>Room<select className={inputClass} value={service.roomUnitId} onChange={(event) => setService({ ...service, roomUnitId: event.target.value })}><option value="">No room</option>{data?.roomUnits.map((room) => <option key={room.id} value={room.id}>{room.code}</option>)}</select></Label><Label>Description<textarea className={`${inputClass} min-h-24 py-3`} value={service.description} onChange={(event) => setService({ ...service, description: event.target.value })} /></Label></div><button className={`${buttonClass} mt-5 w-full`} disabled={busy === "service" || !service.title.trim()} onClick={() => void createService()}>{busy === "service" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}Open case</button></Section>
      <Section title="Service board" copy="Tracked issues stay current across online, offline and shared staff devices.">
        {data?.serviceCases.length ? <div className={`grid gap-3 ${data.serviceCases.length > 1 ? "md:grid-cols-2" : ""}`}>{data.serviceCases.map((item) => <ServiceCaseCard key={item.id} item={item} busy={busy === `case-${item.id}`} onUpdate={(status) => updateCase(item, status)} />)}</div> : <Empty>No service cases are open.</Empty>}
      </Section>
    </div>}

    {tab === "guest" && <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-neutral-300">
        <header className="grid gap-4 px-5 py-5 shadow-[inset_0_-1px_0_0_#d4d4d4] sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"><MessageSquareText className="h-5 w-5" /></span>
            <div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Direct booking conversion</p><h2 className="mb-0 mt-1 text-lg font-bold tracking-tight text-neutral-950">Guest contact channels</h2><p className="mb-0 mt-1 max-w-3xl text-xs leading-5 text-neutral-500">Publish property-owned reception details so every interested guest has a clear next action after checking availability.</p></div>
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] ${guestContact.enabled && publicChannelCount ? "bg-emerald-100 text-emerald-800" : guestContact.enabled ? "bg-amber-100 text-amber-900" : "bg-neutral-100 text-neutral-600"}`}>{guestContact.enabled && publicChannelCount ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{guestContact.enabled && publicChannelCount ? `${publicChannelCount} channels live` : guestContact.enabled ? "Channel required" : "Not published"}</span>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]">
          <div className="p-5 sm:p-6">
            <div className={`flex flex-col gap-4 rounded-xl p-4 shadow-[0_4px_14px_rgba(15,23,42,0.06)] ring-1 sm:flex-row sm:items-center sm:justify-between ${guestContact.enabled ? "ring-emerald-400 bg-emerald-50/70" : "ring-neutral-300 bg-white"}`}>
              <div className="flex min-w-0 items-start gap-3"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${guestContact.enabled ? "bg-emerald-700 text-white" : "bg-white text-neutral-400 ring-1 ring-neutral-200"}`}><Globe2 className="h-4 w-4" /></span><span><span className="block text-sm font-bold text-neutral-950">Publish on the booking page</span><span className="mt-0.5 block text-[11px] leading-5 text-neutral-500">Only completed channels are displayed. Owner personal details are never used as a fallback.</span></span></div>
              <button type="button" role="switch" aria-checked={guestContact.enabled} onClick={() => setGuestContact({ ...guestContact, enabled: !guestContact.enabled })} className={`relative h-7 w-12 shrink-0 rounded-full border-0 p-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${guestContact.enabled ? "bg-emerald-700" : "bg-neutral-300"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${guestContact.enabled ? "left-1 translate-x-5" : "left-1 translate-x-0"}`} /><span className="sr-only">Publish reception channels</span></button>
            </div>

            <div className="mt-6">
              <div className="flex items-end justify-between gap-3"><div><h3 className="m-0 text-sm font-bold text-neutral-900">Social and messaging</h3><p className="mb-0 mt-1 text-[11px] text-neutral-500">Fast conversation channels for booking questions.</p></div><span className="text-[10px] font-semibold text-neutral-400">Optional</span></div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Label><span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-fuchsia-50 text-fuchsia-600"><Instagram className="h-4 w-4" /></span>Instagram username</span><input className={inputClass} value={guestContact.instagramUsername || ""} onChange={(event) => setGuestContact({ ...guestContact, instagramUsername: event.target.value })} placeholder="hotel.username" /></Label>
                <Label><span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><MessageSquareText className="h-4 w-4" /></span>WhatsApp Business</span><input type="tel" className={inputClass} value={guestContact.whatsappPhone || ""} onChange={(event) => setGuestContact({ ...guestContact, whatsappPhone: event.target.value })} placeholder="+255 712 345 678" /></Label>
              </div>
              {(() => {
                const connection = metaConnections?.connections.find((item) => item.provider === "INSTAGRAM");
                const connected = connection?.status === "CONNECTED";
                const ready = Boolean(metaConnections?.readiness.instagramOAuthConfigured);
                const checking = metaConnectionStatus === "loading";
                const unavailable = metaConnectionStatus === "unavailable";
                const statusLabel = connected ? "Connected" : checking ? "Checking availability" : ready ? "Ready to connect" : unavailable ? "Status unavailable" : "Platform setup required";
                return <div className={`mt-4 grid gap-4 rounded-2xl p-4 shadow-[0_5px_16px_rgba(15,23,42,0.07)] ring-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${connected ? "ring-emerald-400 bg-emerald-50/60" : ready ? "ring-fuchsia-400 bg-white" : "ring-neutral-300 bg-white"}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${connected ? "bg-emerald-700 text-white shadow-sm" : "bg-white text-fuchsia-600 ring-1 ring-neutral-200"}`}><Instagram className="h-4 w-4" /></span>
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="m-0 text-xs font-bold text-neutral-900">Instagram inbox</p><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.06em] ${connected ? "bg-emerald-100 text-emerald-800" : ready ? "bg-fuchsia-50 text-fuchsia-700" : "bg-white text-neutral-600 ring-1 ring-neutral-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-600" : ready ? "bg-fuchsia-500" : checking ? "animate-pulse bg-neutral-400" : "bg-amber-500"}`} />{statusLabel}</span></div><p className="mb-0 mt-1.5 text-[10px] leading-4 text-neutral-500">{connected ? `@${String(connection?.displayName || guestContact.instagramUsername || "Instagram").replace(/^@/, "")} is securely routed to ${selectedProperty?.title || "this property"}.` : ready ? "Connect the hotel's Instagram Professional account to route new DMs into Reception inquiries." : unavailable ? "Connection status could not be checked. The public Instagram contact link is not affected." : "Automated Instagram inbox sync is awaiting activation by the NoLSAF platform team."}</p>{connection?.lastError && <p className="mb-0 mt-1 text-[10px] font-semibold text-amber-800">This connection needs attention. Reconnect the account or contact support.</p>}</div>
                  </div>
                  {connected ? <button type="button" disabled={busy === "meta-instagram"} onClick={() => void disconnectInstagram()} className="min-h-9 rounded-lg border border-red-300 bg-white px-3 text-[10px] font-bold text-red-700 transition hover:bg-red-50">Disconnect</button> : ready ? <button type="button" disabled={busy === "meta-instagram"} onClick={() => void connectInstagram()} className={buttonClass}>{busy === "meta-instagram" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Instagram className="h-4 w-4" />}Connect account</button> : <span className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg ring-1 ring-neutral-300 bg-white px-3 text-[10px] font-bold text-neutral-600 shadow-sm">{checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}{checking ? "Checking" : "Admin setup"}</span>}
                </div>;
              })()}
              {(() => {
                const connection = metaConnections?.connections.find((item) => item.provider === "WHATSAPP");
                const registrationRequired = Boolean(connection?.externalAccountId && !connection.phoneRegistrationComplete && ["PENDING", "CONNECTED", "ERROR"].includes(connection.status));
                const connected = connection?.status === "CONNECTED" && connection.phoneRegistrationComplete === true;
                const ready = Boolean(metaConnections?.readiness.whatsappEmbeddedSignupConfigured);
                const checking = metaConnectionStatus === "loading";
                const unavailable = metaConnectionStatus === "unavailable";
                const statusLabel = connected ? "Connected" : registrationRequired ? "Registration required" : checking ? "Checking availability" : ready ? "Ready to connect" : unavailable ? "Status unavailable" : "Platform setup required";
                return <div className={`mt-3 grid gap-4 rounded-2xl p-4 shadow-[0_5px_16px_rgba(15,23,42,0.07)] ring-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${connected ? "ring-emerald-400 bg-emerald-50/60" : registrationRequired ? "ring-amber-400 bg-amber-50/60" : ready ? "ring-emerald-400 bg-white" : "ring-neutral-300 bg-white"}`}>
                   <div className="flex min-w-0 items-start gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${connected ? "bg-[#128C7E] text-white shadow-sm" : "bg-white text-emerald-700 ring-1 ring-neutral-200"}`}><MessageSquareText className="h-4 w-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="m-0 text-xs font-bold text-neutral-900">WhatsApp inbox</p><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.06em] ${connected ? "bg-emerald-100 text-emerald-800" : registrationRequired ? "bg-amber-100 text-amber-900" : ready ? "bg-emerald-50 text-emerald-700" : "bg-white text-neutral-600 ring-1 ring-neutral-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-600" : registrationRequired ? "bg-amber-500" : ready ? "bg-emerald-500" : checking ? "animate-pulse bg-neutral-400" : "bg-amber-500"}`} />{statusLabel}</span></div><p className="mb-0 mt-1.5 text-[10px] leading-4 text-neutral-500">{connected ? `${connection?.displayName || "WhatsApp Business"} is securely routed to ${selectedProperty?.title || "this property"}.` : registrationRequired ? "Finish Meta phone registration with the hotel's six-digit PIN before messaging can start." : ready ? "Connect the hotel's WhatsApp Business account and phone number to receive guest conversations in NRMS." : unavailable ? "Connection status could not be checked. The public WhatsApp contact link is not affected." : "Automated WhatsApp inbox sync is awaiting activation by the NoLSAF platform team."}</p>{connection?.lastError && <p className="mb-0 mt-1 text-[10px] font-semibold text-amber-800">This connection needs attention. Reconnect the account or contact support.</p>}</div></div>
                  {registrationRequired ? <div className="flex flex-wrap gap-2"><button type="button" disabled={busy === "meta-whatsapp-register"} onClick={openWhatsAppRegistration} className={buttonClass}><MessageSquareText className="h-4 w-4" />Activate WhatsApp</button><button type="button" disabled={busy === "meta-whatsapp"} onClick={() => void disconnectWhatsApp()} className="min-h-9 rounded-lg border border-red-300 bg-white px-3 text-[10px] font-bold text-red-700 transition hover:bg-red-50">Disconnect</button></div> : connected ? <button type="button" disabled={busy === "meta-whatsapp"} onClick={() => void disconnectWhatsApp()} className="min-h-9 rounded-lg border border-red-300 bg-white px-3 text-[10px] font-bold text-red-700 transition hover:bg-red-50">Disconnect</button> : ready ? <button type="button" disabled={busy === "meta-whatsapp"} onClick={() => void connectWhatsApp()} className={buttonClass}>{busy === "meta-whatsapp" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}Connect account</button> : <span className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg ring-1 ring-neutral-300 bg-white px-3 text-[10px] font-bold text-neutral-600 shadow-sm">{checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}{checking ? "Checking" : "Admin setup"}</span>}
                </div>;
              })()}
              {metaConnectionStatus === "ready" && (!metaConnections?.readiness.instagramOAuthConfigured || !metaConnections?.readiness.whatsappEmbeddedSignupConfigured) && <div className="mt-3 flex items-start gap-3 rounded-xl bg-sky-50/80 px-4 py-3 text-sky-950 shadow-[0_4px_12px_rgba(14,116,144,0.07)] ring-1 ring-sky-300"><span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-sky-700 ring-1 ring-sky-300"><Info className="h-3.5 w-3.5" /></span><div><p className="m-0 text-[11px] font-bold">Messaging automation is being prepared</p><p className="mb-0 mt-1 text-[10px] leading-4 text-sky-800">Guests can still use the published Instagram and WhatsApp contact links. Automated incoming messages will appear in Reception inquiries after the NoLSAF connection service is activated.</p></div></div>}
              {metaConnectionStatus === "unavailable" && <div className="mt-3 flex items-start gap-3 rounded-xl ring-1 ring-neutral-300 bg-neutral-50 px-4 py-3 text-neutral-700 shadow-[0_3px_10px_rgba(15,23,42,0.04)]"><Info className="mt-0.5 h-4 w-4 shrink-0" /><p className="m-0 text-[10px] leading-4"><span className="font-bold text-neutral-900">Messaging status is temporarily unavailable.</span> Guest-facing contact links remain available while NRMS retries the connection check.</p></div>}
            </div>

            <div className="mt-6 pt-5 shadow-[inset_0_1px_0_0_#f5f5f5]">
              <div className="flex items-end justify-between gap-3"><div><h3 className="m-0 text-sm font-bold text-neutral-900">Reception desk</h3><p className="mb-0 mt-1 text-[11px] text-neutral-500">Formal contact details owned and answered by this property.</p></div><span className="text-[10px] font-semibold text-neutral-400">Recommended</span></div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Label><span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><Phone className="h-4 w-4" /></span>Reception telephone</span><input type="tel" className={inputClass} value={guestContact.receptionPhone || ""} onChange={(event) => setGuestContact({ ...guestContact, receptionPhone: event.target.value })} placeholder="+255 712 345 678" /></Label>
                <Label><span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Mail className="h-4 w-4" /></span>Reception email</span><input type="email" className={inputClass} value={guestContact.receptionEmail || ""} onChange={(event) => setGuestContact({ ...guestContact, receptionEmail: event.target.value })} placeholder="reservations@hotel.com" /></Label>
                <Label><span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600"><Clock3 className="h-4 w-4" /></span>Contact hours</span><input className={inputClass} value={guestContact.contactHours || ""} onChange={(event) => setGuestContact({ ...guestContact, contactHours: event.target.value })} placeholder="Daily, 06:00–23:00 EAT" /></Label>
                <Label>Greeting language<select className={inputClass} value={guestContact.preferredLanguage} onChange={(event) => setGuestContact({ ...guestContact, preferredLanguage: event.target.value as GuestContact["preferredLanguage"] })}><option value="EN_SW">English and Swahili</option><option value="SW">Swahili</option><option value="EN">English</option></select></Label>
              </div>
            </div>

            <div className="mt-6 pt-5 shadow-[inset_0_1px_0_0_#f5f5f5]">
              <label className="grid gap-1.5 text-xs font-bold text-neutral-700">Welcome message<span className="font-normal leading-5 text-neutral-500">Keep it short and guide the guest toward availability, reception or a booking decision.</span><textarea className={`${inputClass} min-h-24 resize-y py-3`} value={guestContact.greeting || ""} onChange={(event) => setGuestContact({ ...guestContact, greeting: event.target.value })} placeholder="Karibu. View live rooms or contact reception for help with your stay." /></label>
            </div>

            <div className="mt-6 flex flex-col gap-3 pt-5 shadow-[inset_0_1px_0_0_#f5f5f5] sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-[11px] leading-5 text-neutral-500">Changes appear on the direct booking page after saving.</p>
              <button type="button" className={buttonClass} disabled={busy === "guest-contact"} onClick={() => void saveGuestContact()}>{busy === "guest-contact" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save and update preview</button>
            </div>
          </div>

          <aside className="border-t-2 border-neutral-300 bg-neutral-50/80 p-5 sm:p-6 lg:border-l-2 lg:border-t-0">
            <div className="flex items-center justify-between gap-3"><div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-500">Booking page preview</p><p className="mb-0 mt-1 text-[11px] text-neutral-400">What guests see after checking rooms</p></div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${guestContact.enabled ? "bg-emerald-100 text-emerald-800" : "bg-white text-neutral-500 ring-1 ring-neutral-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${guestContact.enabled ? "bg-emerald-600" : "bg-neutral-400"}`} />{guestContact.enabled ? "Visible" : "Draft"}</span></div>
            <div className="mt-4 overflow-hidden rounded-2xl bg-emerald-950 text-white shadow-lg shadow-emerald-950/10 ring-1 ring-white/10">
              <div className="border-b border-white/10 px-5 py-5"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-emerald-200"><MessageSquareText className="h-4 w-4" /></span><p className="mb-0 mt-4 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300">Reception assistance</p><h3 className="mb-0 mt-1.5 text-lg font-bold leading-6">Talk to {selectedProperty?.title || "reception"}</h3><p className="mb-0 mt-2 text-xs leading-5 text-emerald-50/65">{guestContact.greeting || "Choose the channel that is most convenient for you."}</p></div>
              <div className="grid gap-2.5 px-4 py-4">
                {guestContact.instagramUsername && <span className="flex min-h-11 items-center gap-3 rounded-xl bg-white px-3.5 text-xs font-bold text-neutral-900"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#7c3aed,#db2777,#f97316)] text-white"><Instagram className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1 truncate">@{guestContact.instagramUsername.replace(/^@/, "")}</span><ChevronRight className="h-4 w-4 text-neutral-400" /></span>}
                {guestContact.whatsappPhone && <span className="flex min-h-11 items-center gap-3 rounded-xl bg-white px-3.5 text-xs font-bold text-neutral-900"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#25D366] text-white"><MessageSquareText className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1 truncate">WhatsApp reception</span><ChevronRight className="h-4 w-4 text-neutral-400" /></span>}
                {guestContact.receptionPhone && <span className="flex min-h-11 items-center gap-3 rounded-xl bg-white px-3.5 text-xs font-bold text-neutral-900"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-600 text-white"><Phone className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1 truncate">Call reception</span><ChevronRight className="h-4 w-4 text-neutral-400" /></span>}
                {guestContact.receptionEmail && <span className="flex min-h-11 items-center gap-3 rounded-xl bg-white px-3.5 text-xs font-bold text-neutral-900"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-white"><Mail className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1 truncate">Email reception</span><ChevronRight className="h-4 w-4 text-neutral-400" /></span>}
                {!publicChannelCount && <div className="rounded-xl outline outline-1 outline-dashed outline-white/20 px-4 py-7 text-center"><Globe2 className="mx-auto h-5 w-5 text-emerald-200/70" /><p className="mb-0 mt-2 text-xs font-semibold text-white/80">No public channels yet</p><p className="mb-0 mt-1 text-[10px] leading-4 text-white/45">Complete at least one reception channel to finish this preview.</p></div>}
              </div>
              {guestContact.contactHours && <div className="flex items-center gap-2 px-5 py-3 text-[10px] text-emerald-50/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"><Clock3 className="h-3.5 w-3.5 text-emerald-300" /><span>{guestContact.contactHours}</span></div>}
            </div>

            <div className="mt-5 rounded-2xl bg-white p-4 shadow-[0_5px_16px_rgba(15,23,42,0.07)] ring-1 ring-neutral-300">
              <div className="flex items-baseline justify-between gap-3"><h3 className="m-0 text-xs font-bold text-neutral-900">Direct conversion</h3><span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Last 30 days</span></div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                {[["Availability searches", data?.directConversion?.events?.AVAILABILITY_SEARCH || 0], ["Room selections", data?.directConversion?.events?.ROOM_SELECTED || 0], ["Contact actions", (data?.directConversion?.events?.INSTAGRAM_CLICK || 0) + (data?.directConversion?.events?.WHATSAPP_CLICK || 0) + (data?.directConversion?.events?.PHONE_CLICK || 0)], ["Room holds", data?.directConversion?.events?.HOLD_CREATED || 0]].map(([label, value], index) => <div key={String(label)} className={`${index > 1 ? "pt-3 shadow-[inset_0_1px_0_0_#f5f5f5]" : ""}`}><p className="m-0 text-xl font-bold tracking-tight text-neutral-950">{value}</p><p className="mb-0 mt-0.5 text-[10px] leading-4 text-neutral-500">{label}</p></div>)}
              </div>
            </div>
          </aside>
        </div>
      </section>
      <div className="grid items-start gap-5 xl:grid-cols-2">
      <div className="space-y-5">
        <Section title="Automated guest journey" copy="Templates schedule against booking and stay events. Messages use the existing consent-aware delivery layer."><div className="grid gap-4 sm:grid-cols-2"><Label>Template name<input className={inputClass} value={journey.name} onChange={(event) => setJourney({ ...journey, name: event.target.value })} placeholder="Arrival reminder" /></Label><Label>Trigger<select className={inputClass} value={journey.trigger} onChange={(event) => setJourney({ ...journey, trigger: event.target.value })}><option value="BOOKED">Booked</option><option value="PRE_ARRIVAL">Pre arrival</option><option value="CHECK_IN">Check in</option><option value="PRE_DEPARTURE">Pre departure</option><option value="CHECK_OUT">Check out</option></select></Label><Label>Offset in minutes<input type="number" className={inputClass} value={journey.offsetMinutes} onChange={(event) => setJourney({ ...journey, offsetMinutes: event.target.value })} /></Label><Label>Channel<select className={inputClass} value={journey.channel} onChange={(event) => setJourney({ ...journey, channel: event.target.value })}><option value="SMS">SMS</option><option value="EMAIL">Email</option></select></Label><label className="grid gap-1.5 text-xs font-bold text-neutral-700 sm:col-span-2">Message<textarea className={`${inputClass} min-h-24 py-3`} value={journey.message} onChange={(event) => setJourney({ ...journey, message: event.target.value })} /></label></div><div className="mt-5 flex flex-wrap gap-2"><button className={buttonClass} disabled={!journey.name || busy === "journey"} onClick={() => act("journey", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/journeys`, { ...journey, offsetMinutes: Number(journey.offsetMinutes) }), "Journey template saved.")}><Save className="h-4 w-4" />Save template</button><button className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-700" onClick={() => act("schedule", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/journeys/schedule`), "Guest journeys scheduled.")}><Sparkles className="h-4 w-4" />Schedule eligible stays</button></div></Section>
        <Section title="Journey library" copy="Active operational messages and their delivery schedules.">
          {data?.journeys.length ? <div className={`grid gap-3 ${data.journeys.length > 1 ? "md:grid-cols-2" : ""}`}>{data.journeys.map((item) => <JourneyTemplateCard key={item.id} item={item} />)}</div> : <Empty>No journey templates.</Empty>}
        </Section>
      </div>
      <div className="space-y-5">
        <Section title="Direct guest payment request" copy="NRMS sends the hotel’s own payment instructions. Money received is still recorded immutably on the folio."><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-bold text-neutral-700 sm:col-span-2">Reservation<select className={inputClass} value={payment.reservationId} onChange={(event) => setPayment({ ...payment, reservationId: event.target.value })}><option value="">Select a guest stay</option>{data?.eligibleReservations.map((item) => <option key={item.id} value={item.id}>{item.guestProfile?.fullName || "Guest"} · {item.receiptNumber || `Reservation ${item.id}`}</option>)}</select></label><Label>Request type<select className={inputClass} value={payment.kind} onChange={(event) => setPayment({ ...payment, kind: event.target.value })}><option value="DEPOSIT">Deposit</option><option value="BALANCE">Balance</option><option value="INCIDENTAL">Incidental</option></select></Label><Label>Amount<input type="number" min="1" className={inputClass} value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></Label><div className="sm:col-span-2"><DateField label="Due at" aria="Payment due date" value={payment.dueAt} onChange={(iso) => setPayment({ ...payment, dueAt: iso })} /></div></div><button className={`${buttonClass} mt-5`} disabled={!payment.reservationId || !payment.amount || busy === "payment"} onClick={() => act("payment", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/payment-requests`, { reservationId: Number(payment.reservationId), kind: payment.kind, amount: Number(payment.amount), currency: "TZS", dueAt: payment.dueAt ? new Date(payment.dueAt).toISOString() : null }), "Payment request created.")}><CreditCard className="h-4 w-4" />Create request</button></Section>
        <Section title="Payment requests" copy="Status is operational evidence; it never replaces the folio payment record.">{data?.paymentRequests.length ? <div className="space-y-2">{data.paymentRequests.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg ring-1 ring-neutral-200 p-3"><div><p className="m-0 text-xs font-bold">{item.reservation.guestProfile?.fullName || item.reservation.receiptNumber}</p><p className="mb-0 mt-1 text-[10px] text-neutral-500">{item.kind.toLowerCase()} · {money(item.amount, item.currency)}</p></div><Status value={item.status} /></div>)}</div> : <Empty>No payment requests.</Empty>}</Section>
      </div>
      </div>
    </div>}

    {tab === "portfolio" && <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><Section title="Create portfolio" copy="Group properties you own for one operational and performance view."><Label>Portfolio name<input className={inputClass} value={portfolio.name} onChange={(event) => setPortfolio({ ...portfolio, name: event.target.value })} placeholder="Northern circuit hotels" /></Label><div className="mt-4 [&>*]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>*:last-child]:shadow-none outline outline-1 outline-neutral-100">{data?.ownerProperties.map((property) => <label key={property.id} className="flex items-center justify-between gap-3 py-3 text-xs font-semibold text-neutral-700"><span>{property.title}</span><input type="checkbox" checked={portfolio.propertyIds.includes(property.id)} onChange={(event) => setPortfolio({ ...portfolio, propertyIds: event.target.checked ? [...portfolio.propertyIds, property.id] : portfolio.propertyIds.filter((id) => id !== property.id) })} /></label>)}</div><button className={`${buttonClass} mt-5 w-full`} disabled={!portfolio.name || !portfolio.propertyIds.length || busy === "portfolio"} onClick={() => act("portfolio", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/portfolios`, portfolio), "Portfolio created.")}><Layers3 className="h-4 w-4" />Create portfolio</button></Section><Section title="Property groups" copy="Each property stays isolated for operations while portfolio membership supports consolidated management.">{data?.portfolios.length ? <div className="grid gap-3 md:grid-cols-2">{data.portfolios.map((item) => <article key={item.id} className="rounded-lg ring-1 ring-neutral-200 p-4"><div className="flex items-center justify-between gap-2"><h3 className="m-0 text-sm font-bold">{item.name}</h3><span className="text-[10px] font-bold text-neutral-400">{item.properties.length} properties</span></div><div className="mt-3 space-y-2">{item.properties.map((link: any) => <div key={link.propertyId} className="flex items-center gap-2 text-xs text-neutral-600"><BedDouble className="h-3.5 w-3.5 text-emerald-700" />{link.property.title}</div>)}</div></article>)}</div> : <Empty>No portfolios yet. A single property continues to work independently.</Empty>}</Section></div>}

    {tab === "growth" && <div className="space-y-5"><div className="grid gap-4 md:grid-cols-4">{[["Forward occupancy", data?.forecast ? `${(Number(data.forecast.occupancyPct) * 100).toFixed(1)}%` : "Not computed", BarChart3], ["ADR", data?.forecast ? money(data.forecast.adr) : "Not computed", Gauge], ["Loyal guests", String(data?.loyalty.length || 0), Gift], ["Review requests", String(data?.reviews.length || 0), Star]].map(([label, value, Icon]: any) => <div key={label} className="rounded-xl ring-1 ring-neutral-200 bg-white p-4 shadow-sm"><Icon className="h-5 w-5 text-emerald-700" /><p className="mb-0 mt-4 text-2xl font-bold text-neutral-950">{value}</p><p className="mb-0 mt-1 text-xs text-neutral-500">{label}</p></div>)}</div><div className="grid gap-5 xl:grid-cols-2"><Section title="Forecast and pricing guidance" copy="Recommendations are explainable and remain pending until a manager decides to apply them." action={<button className={buttonClass} disabled={busy === "forecast"} onClick={() => act("forecast", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/forecast/recompute`, { horizonDays: 30 }), "Forecast and pricing guidance refreshed.")}><RefreshCw className="h-4 w-4" />Recompute</button>}>{data?.recommendations.length ? <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">{data.recommendations.map((item) => <div key={item.id} className="grid gap-3 rounded-lg ring-1 ring-neutral-200 p-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="m-0 text-xs font-bold">{item.roomType.name} · {shortDate(item.stayDate)}</p><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">{item.reason}</p></div><div className="text-right"><p className="m-0 text-xs text-neutral-400 line-through">{money(item.currentRate, item.currency)}</p><p className="mb-0 mt-1 text-sm font-bold text-emerald-700">{money(item.recommendedRate, item.currency)}</p></div></div>)}</div> : <Empty>Recompute the forecast to create explainable recommendations.</Empty>}</Section><div className="space-y-5"><Section title="Loyalty intelligence" copy="Tier and points are rebuilt only from completed, property-linked stays." action={<button className="inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[10px] font-bold" onClick={() => act("loyalty", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/loyalty/rebuild`), "Loyalty records rebuilt from completed stays.")}><Gift className="h-3.5 w-3.5" />Rebuild</button>}>{data?.loyalty.length ? <><div className="max-h-72 overflow-y-auto pr-1"><div className="grid gap-2 sm:grid-cols-2">{loyaltyView.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg ring-1 ring-neutral-200 px-3 py-2.5"><div className="min-w-0"><p className="m-0 truncate text-xs font-bold text-neutral-900">{item.guestProfile.fullName}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-500">{item.lifetimeStays} {item.lifetimeStays === 1 ? "stay" : "stays"} · {money(item.lifetimeSpend)}</p></div><Status value={item.tier} /></div>)}</div></div><Pager current={loyaltyView.current} pages={loyaltyView.pages} total={loyaltyView.total} onPage={setLoyaltyPage} /></> : <Empty>No completed-stay loyalty records.</Empty>}</Section><Section title="Verified-stay reputation" copy="Queue private review requests only after NRMS has recorded checkout." action={<button className="inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[10px] font-bold" onClick={() => act("reviews", () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/reviews/queue`), "Verified-stay review requests queued.")}><Star className="h-3.5 w-3.5" />Queue eligible</button>}>{data?.reviews.length ? <><div className="max-h-72 overflow-y-auto pr-1"><div className="grid gap-2 sm:grid-cols-2">{reviewView.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg ring-1 ring-neutral-200 px-3 py-2"><span className="flex min-w-0 items-center gap-2"><Star className="h-3.5 w-3.5 shrink-0 text-amber-500" /><span className="truncate text-xs font-bold text-neutral-900">{item.guestProfile?.fullName || item.reservation.receiptNumber}</span></span><Status value={item.status} /></div>)}</div></div><Pager current={reviewView.current} pages={reviewView.pages} total={reviewView.total} onPage={setReviewPage} /></> : <Empty>No review requests queued.</Empty>}</Section>
      <Section title="What guests actually rate" copy="Category scores from verified stays. Choose which questions departing guests are asked, so a property without a restaurant is never asked to rate one.">
        <div className="space-y-4">
          <div>
            {/* An even grid, not wrapped pills: the labels differ in length, so a
                flex-wrap row leaves ragged gaps and no column to scan down. */}
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Questions asked at checkout</p>
              <p className="m-0 text-[10px] text-neutral-400">{(data?.reviewInsights?.selectedCategories ?? []).length} of {(data?.reviewInsights?.availableCategories ?? []).length} on</p>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {(data?.reviewInsights?.availableCategories ?? []).map((category) => {
                const on = (data?.reviewInsights?.selectedCategories ?? []).includes(category.key);
                const pending = busy === `review-category-${category.key}`;
                return (
                  <button
                    key={category.key}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={pending}
                    onClick={() => void toggleReviewCategory(category.key)}
                    className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg border px-3 text-left text-[11px] font-semibold transition disabled:opacity-60 ${on ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300"}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border ${on ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-300 bg-white"}`}>
                      {pending ? <Loader2 className="h-2.5 w-2.5 animate-spin text-neutral-500" /> : on ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="truncate">{category.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {data?.reviewInsights?.categories.length ? <div>
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Category scores</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-2xl font-bold leading-none text-neutral-950">{(data.reviewInsights.overall ?? 0).toFixed(1)}</span>
              <span className="flex gap-px">
                {[1, 2, 3, 4, 5].map((value) => <Star key={value} className={`h-3.5 w-3.5 ${value <= Math.round(data.reviewInsights?.overall ?? 0) ? "fill-amber-400 text-amber-400" : "text-neutral-200"}`} />)}
              </span>
            </div>
            <p className="mb-0 mt-1 text-[11px] text-neutral-500">overall, from {data.reviewInsights.responses} verified {data.reviewInsights.responses === 1 ? "stay" : "stays"}</p>
            {/* Below five responses one guest moves the average by a whole point.
                Presenting that as performance would invite a decision the data
                cannot support, so it is labelled provisional. */}
            {data.reviewInsights.responses < 5 && (
              <p className="mb-0 mt-2.5 rounded-lg ring-1 ring-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">Provisional. Below five responses one guest moves the average by a whole point, so treat these as early signal, not performance.</p>
            )}
            <div className="mt-3">
              {data.reviewInsights.categories.map((category) => {
                const colour = category.average < 3 ? "bg-red-600" : category.average < 4 ? "bg-amber-500" : "bg-emerald-600";
                const text = category.average < 3 ? "text-red-700" : category.average < 4 ? "text-amber-700" : "text-emerald-700";
                return (
                  <div key={category.key} className="grid grid-cols-[minmax(88px,1.25fr)_minmax(70px,2fr)_auto] items-center gap-3 py-1.5 shadow-[inset_0_1px_0_0_#f5f5f5] first:shadow-none">
                    <span className="truncate text-[11px] text-neutral-600">{category.label}</span>
                    {/* Ticks make a full bar read as "5 out of 5" instead of just "full". */}
                    <span className="relative block h-1.5 overflow-hidden rounded-full bg-neutral-100">
                      <span className={`block h-1.5 rounded-full ${colour}`} style={{ width: `${(category.average / 5) * 100}%` }} />
                      {[20, 40, 60, 80].map((tick) => <span key={tick} className="absolute top-0 h-1.5 w-px bg-white" style={{ left: `${tick}%` }} />)}
                    </span>
                    <span className="flex min-w-[54px] items-center justify-end gap-1.5">
                      <span className={`text-[11px] font-bold ${text}`}>{category.average.toFixed(1)}</span>
                      <span className="text-[10px] text-neutral-400">{category.responses}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mb-0 mt-2 text-[10px] text-neutral-400">Weakest first. The right number is how many guests answered that question.</p>
            {data.reviewInsights.responses >= 5 && data.reviewInsights.categories[0] && data.reviewInsights.categories[0].average < 4 && (
              <div className="mt-2.5 rounded-lg ring-1 ring-red-200 bg-red-50 px-3 py-2">
                <p className="m-0 text-[11px] font-bold text-red-900">{data.reviewInsights.categories[0].label} is your weakest score</p>
                <p className="mb-0 mt-0.5 text-[10px] leading-4 text-red-800">{data.reviewInsights.categories[0].responses} guests rated it {data.reviewInsights.categories[0].average.toFixed(1)} of 5. Open the responses that mention it.</p>
              </div>
            )}
          </div> : <Empty>No category scores yet.</Empty>}
          {recoveryQueue.length ? <div className="rounded-lg ring-1 ring-amber-200 bg-amber-50 p-3">
            <p className="m-0 text-[11px] font-bold text-amber-950">{recoveryQueue.length} {recoveryQueue.length === 1 ? "guest needs" : "guests need"} a personal follow-up</p>
            <p className="mb-0 mt-0.5 text-[10px] leading-4 text-amber-900/80">These guests rated the stay 3 or below. They were not asked to recommend the property.</p>
            <div className="mt-2 space-y-1.5">
              {recoveryQueue.slice(0, 8).map((item: any) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-2">
                <span className="min-w-0"><span className="block truncate text-[11px] font-bold text-neutral-900">{item.guestProfile?.fullName || item.reservation.receiptNumber}</span><span className="block truncate text-[10px] text-neutral-500">{item.rating} of 5{item.feedback ? ` · ${item.feedback}` : ""}</span></span>
                <button type="button" disabled={busy === `recovered-${item.id}`} onClick={() => void act(`recovered-${item.id}`, () => apiClient.post(`/api/owner/nrms/market-readiness/${selectedPropertyId}/reviews/${item.id}/recovered`, {}), "Recovery task closed.")}
                  className="min-h-8 shrink-0 rounded-md border border-neutral-200 bg-white px-2.5 text-[10px] font-bold text-neutral-700">Contacted</button>
              </div>)}
            </div>
          </div> : null}
        </div>
      </Section></div></div></div>}
  </div>;
}
