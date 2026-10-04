"use client";

// The NRMS home page for a sales executive.
//
// The default NRMS home is a front desk: tonight's occupancy, arrivals to
// check in, departures to settle. None of that is a sales executive's work.
// Their day is demand that has not been answered yet, held rooms running
// towards a cut-off date, and agency relationships waiting on the hotel, so
// this screen opens on exactly those three queues and on the conversion the
// property is actually achieving.
//
// Everything here is read from endpoints a SALES_EXECUTIVE membership is
// already allowed to call (guest inquiries, the group block list, the agent
// link list). Nothing is computed that the sales role cannot see, and nothing
// is invented: an empty property renders empty states, not sample numbers.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  CheckCircle2,
  Clock3,
  Handshake,
  Inbox,
  Instagram,
  Layers,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "./NrmsProvider";

type Inquiry = {
  id: number;
  reference: string;
  channel: string;
  source: string;
  status: string;
  guestName: string | null;
  guestHandle: string | null;
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  children: number;
  createdAt: string;
  lastMessageAt: string | null;
  firstResponseAt: string | null;
  roomType: { id: number; name: string } | null;
  assignedTo: { id: number; name: string | null; fullName: string | null } | null;
};

type ConversionReport = {
  periodDays: number;
  funnel: { visits: number; inquiries: number; responded: number; holds: number; confirmed: number };
  rates: { visitToInquiryPct: number | null; inquiryToHoldPct: number | null; holdToConfirmedPct: number | null };
  averageFirstResponseMinutes: number | null;
  sources: Array<{ source: string; visits: number; inquiries: number; responded: number; holds: number; confirmed: number }>;
};

type GroupBlock = {
  id: number;
  reference: string;
  agencyName: string | null;
  contactName: string | null;
  checkIn: string;
  checkOut: string;
  cutOffAt: string;
  cutOffPassed: boolean;
  status: string;
  currency: string;
  roomsTotal: number;
  roomsHeld: number;
  roomsPickedUp: number;
  blockValue: number;
};

type AgentLink = {
  id: number;
  status: string;
  initiatedBy: string;
  requestedAt: string | null;
  agency: { id: number; name: string | null } | null;
};

type AgentBookingRequest = {
  id: number;
  status: string;
  agency: { legalName: string; reference: string } | null;
  rooms: number;
  roomType: string | null;
  checkIn: string;
  holdExpiresAt: string | null;
};

const BLOCK_STATUS_CLS: Record<string, string> = {
  HELD: "bg-blue-50 text-blue-700",
  PARTIALLY_PICKED_UP: "bg-amber-50 text-amber-700",
  PICKED_UP: "bg-emerald-50 text-emerald-700",
  RELEASED: "bg-neutral-100 text-neutral-600",
  CANCELLED: "bg-red-50 text-red-600",
};
const BLOCK_STATUS_LABEL: Record<string, string> = {
  HELD: "Holding",
  PARTIALLY_PICKED_UP: "Part picked up",
  PICKED_UP: "Picked up",
  RELEASED: "Released",
  CANCELLED: "Cancelled",
};
const CHANNEL_CLS: Record<string, string> = {
  INSTAGRAM: "bg-fuchsia-50 text-fuchsia-700",
  WHATSAPP: "bg-emerald-50 text-emerald-700",
  PHONE: "bg-sky-50 text-sky-700",
  EMAIL: "bg-amber-50 text-amber-700",
  WEB: "bg-neutral-100 text-neutral-700",
};

// The API treats an unanswered inquiry older than ten minutes as overdue
// (owner.nrms.inquiries live-count). This screen uses the same threshold so
// the sidebar badge and this page never disagree about what is late.
const OVERDUE_MINUTES = 10;

function label(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function ChannelIcon({ channel, className = "h-3.5 w-3.5" }: { channel: string; className?: string }) {
  const Icon =
    channel === "INSTAGRAM" ? Instagram
      : channel === "WHATSAPP" ? MessageCircle
      : channel === "PHONE" ? Phone
      : channel === "EMAIL" ? Mail
      : AtSign;
  return <Icon className={className} />;
}

function minutesSince(value: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

function waitingFor(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function responseTime(minutes: number | null): string {
  if (minutes == null) return "No replies yet";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours * 10) / 10} hr`;
  return `${Math.round(hours / 24 * 10) / 10} days`;
}

function stayLabel(checkIn: string | null, checkOut: string | null): string | null {
  if (!checkIn || !checkOut) return null;
  const nights = Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000));
  const from = new Date(checkIn).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const to = new Date(checkOut).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${from} to ${to} (${nights} ${nights === 1 ? "night" : "nights"})`;
}

function daysUntil(value: string): number {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function money(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString()}`;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export default function SalesHome() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [reporting, setReporting] = useState<ConversionReport | null>(null);
  const [blocks, setBlocks] = useState<GroupBlock[]>([]);
  const [links, setLinks] = useState<AgentLink[]>([]);
  const [agentBookings, setAgentBookings] = useState<AgentBookingRequest[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  // Re-rendered on a minute tick so "Updated just now" stops being true when it
  // stops being true. Without it the label freezes at whatever it said when the
  // last piece of state changed, which is worse than showing no time at all.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClockTick((tick) => tick + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      // One failing queue should not blank the whole workspace, so each request
      // is settled on its own and a rejected one leaves that section empty
      // rather than replacing the page with an error.
      const [inquiryResult, blockResult, agentResult, agentBookingResult] = await Promise.allSettled([
        apiClient.get<any>(`/api/owner/nrms/inquiries/property/${selectedPropertyId}`, { params: { pageSize: 100 } }),
        apiClient.get<any>(`/api/owner/nrms/group-blocks/property/${selectedPropertyId}/blocks`),
        apiClient.get<any>(`/api/owner/nrms/agents/property/${selectedPropertyId}`),
        apiClient.get<any>(`/api/owner/nrms/agents/property/${selectedPropertyId}/requests`),
      ]);

      if (inquiryResult.status === "fulfilled") {
        setInquiries(inquiryResult.value.data?.inquiries ?? []);
        setReporting(inquiryResult.value.data?.reporting ?? null);
      } else {
        setInquiries([]);
        setReporting(null);
      }
      setBlocks(blockResult.status === "fulfilled" ? blockResult.value.data?.blocks ?? [] : []);
      setLinks(agentResult.status === "fulfilled" ? agentResult.value.data?.links ?? [] : []);
      setAgentBookings(agentBookingResult.status === "fulfilled" ? agentBookingResult.value.data?.requests ?? [] : []);

      const failed = [inquiryResult, blockResult, agentResult, agentBookingResult].find((result) => result.status === "rejected");
      if (failed && failed.status === "rejected") {
        setError((failed.reason as any)?.response?.data?.error || "Part of the sales workspace could not be loaded.");
      }
      setLastLoadedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

  // The reply queue: demand that has reached the property and has had no
  // answer. Oldest first, because the one that has waited longest is the one
  // most likely to have booked somewhere else already.
  const awaitingReply = useMemo(
    () =>
      inquiries
        .filter((inquiry) => ["NEW", "OPEN"].includes(inquiry.status) && !inquiry.firstResponseAt)
        .map((inquiry) => ({ ...inquiry, waited: minutesSince(inquiry.createdAt) }))
        .sort((a, b) => b.waited - a.waited),
    [inquiries],
  );
  const overdueCount = useMemo(
    () => awaitingReply.filter((inquiry) => inquiry.waited >= OVERDUE_MINUTES).length,
    [awaitingReply],
  );
  // Answered but not yet resolved: the conversation is live and still needs
  // working, which is a different queue from the unanswered one.
  const inConversation = useMemo(
    () => inquiries.filter((inquiry) => ["OPEN", "WAITING_GUEST"].includes(inquiry.status) && inquiry.firstResponseAt).length,
    [inquiries],
  );

  const liveBlocks = useMemo(
    () => blocks.filter((block) => ["HELD", "PARTIALLY_PICKED_UP"].includes(block.status)),
    [blocks],
  );
  const roomsOnHold = useMemo(() => liveBlocks.reduce((sum, block) => sum + block.roomsHeld, 0), [liveBlocks]);
  // What the desk is carrying: rooms committed to a group that has not picked
  // them up yet, valued at the agreed rates.
  const heldValue = useMemo(
    () => liveBlocks.reduce((sum, block) => sum + (block.roomsTotal > 0 ? block.blockValue * (block.roomsHeld / block.roomsTotal) : 0), 0),
    [liveBlocks],
  );
  const heldCurrency = liveBlocks[0]?.currency ?? selectedProperty?.currency ?? "TZS";
  // Cut-off is the decision point: past it the rooms should go back on sale,
  // and a week out is when the group needs chasing for names.
  const cutOffSoon = useMemo(
    () =>
      liveBlocks
        .filter((block) => block.roomsHeld > 0 && daysUntil(block.cutOffAt) <= 7)
        .sort((a, b) => new Date(a.cutOffAt).getTime() - new Date(b.cutOffAt).getTime()),
    [liveBlocks],
  );

  const agentQueue = useMemo(
    () => links.filter((link) => link.status === "REQUESTED" || link.status === "AGENT_ACCEPTED"),
    [links],
  );
  const pendingAgentBookings = useMemo(
    () => agentBookings.filter((request) => request.status === "PENDING"),
    [agentBookings],
  );
  const activeAgents = useMemo(() => links.filter((link) => link.status === "ACTIVE").length, [links]);

  const freshness = lastLoadedAt == null
    ? "not yet"
    : (() => {
      const minutes = Math.floor((Date.now() - lastLoadedAt) / 60_000);
      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
      const hours = Math.floor(minutes / 60);
      return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    })();

  const funnel = reporting?.funnel;
  const funnelSteps = useMemo(() => {
    if (!funnel) return [];
    const top = Math.max(funnel.visits, funnel.inquiries, 1);
    return [
      { key: "visits", label: "Page views", value: funnel.visits, cls: "bg-neutral-300", note: "Direct booking page opened" },
      { key: "inquiries", label: "Inquiries", value: funnel.inquiries, cls: "bg-sky-400", note: "Guest asked a question" },
      { key: "responded", label: "Answered", value: funnel.responded, cls: "bg-violet-400", note: "The property replied" },
      { key: "holds", label: "Held", value: funnel.holds, cls: "bg-amber-400", note: "Turned into a reservation hold" },
      { key: "confirmed", label: "Confirmed", value: funnel.confirmed, cls: "bg-emerald-500", note: "Hold became a stay" },
    ].map((step, index, all) => ({
      ...step,
      widthPct: Math.max(step.value > 0 ? 4 : 0, pct(step.value, top)),
      fromPrevious: index === 0 ? null : pct(step.value, all[index - 1].value),
    }));
  }, [funnel]);

  if (!selectedPropertyId) {
    return <p className="py-10 text-center text-sm text-neutral-500">Select a property to open the sales workspace.</p>;
  }

  return (
    <div className="space-y-4 pb-10">
      {/* No title band. The workspace header directly above already carries the
          property name and names this workspace, and the tab row under it
          carries the destinations.

          What is left is a status line, not a floating button. A lone chip
          pinned to the right margin reads as something that came loose; paired
          with what it tells you, the row has a reason to be there. It also
          answers the question a queue screen actually raises, which is how old
          these numbers are. */}
      <div className="-mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[11px] text-neutral-400">
          {loading && !lastLoadedAt ? "Loading the workspace" : `Updated ${freshness}`}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          // border-0 because preflight is off: a bare button keeps the user
          // agent border and would draw a grey box here.
          className="inline-flex min-h-7 shrink-0 cursor-pointer appearance-none items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[11px] font-bold text-neutral-500 transition hover:bg-white hover:text-emerald-800 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Reload
        </button>
      </div>

      {error ? (
        <p className="m-0 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Inbox className="h-4 w-4" />}
          tone={overdueCount > 0 ? "alert" : "neutral"}
          label="Waiting for a reply"
          value={awaitingReply.length}
          note={
            awaitingReply.length === 0 ? "Inbox is clear"
              : overdueCount > 0 ? `${overdueCount} past ${OVERDUE_MINUTES} minutes`
              : "All still within target"
          }
          href="/owner/nrms/inquiries"
        />
        <StatCard
          icon={<Clock3 className="h-4 w-4" />}
          tone="neutral"
          label="Average first reply"
          value={responseTime(reporting?.averageFirstResponseMinutes ?? null)}
          note={reporting ? `Last ${reporting.periodDays} days` : "No data yet"}
          href="/owner/nrms/inquiries"
        />
        <StatCard
          icon={<Layers className="h-4 w-4" />}
          tone={cutOffSoon.length > 0 ? "warn" : "neutral"}
          label="Rooms held for groups"
          value={roomsOnHold}
          note={
            liveBlocks.length === 0 ? "No live blocks"
              : `${money(heldValue, heldCurrency)} across ${liveBlocks.length} ${liveBlocks.length === 1 ? "block" : "blocks"}`
          }
          href="/owner/nrms/groups"
        />
        <StatCard
          icon={<Handshake className="h-4 w-4" />}
          tone={agentQueue.length + pendingAgentBookings.length > 0 ? "warn" : "neutral"}
          label="Agent work waiting"
          value={agentQueue.length + pendingAgentBookings.length}
          note={`${pendingAgentBookings.length} booking · ${agentQueue.length} partnership`}
          href={pendingAgentBookings.length > 0 ? "/owner/nrms/agents/requests" : "/owner/nrms/agents"}
        />
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-black text-neutral-900">Answer these first</h2>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">
                Longest wait at the top. {inConversation} {inConversation === 1 ? "conversation is" : "conversations are"} already open.
              </p>
            </div>
            <Link href="/owner/nrms/inquiries" className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 no-underline hover:underline">
              Open inbox <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {loading && awaitingReply.length === 0 ? (
            <p className="m-0 py-8 text-center text-xs text-neutral-400">Loading the inbox...</p>
          ) : awaitingReply.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-5 w-5" />}
              title="Nothing is waiting"
              body="Every inquiry that reached this property has had a first reply."
            />
          ) : (
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {awaitingReply.slice(0, 6).map((inquiry) => {
                const overdue = inquiry.waited >= OVERDUE_MINUTES;
                const stay = stayLabel(inquiry.checkIn, inquiry.checkOut);
                return (
                  <li key={inquiry.id}>
                    <Link
                      href="/owner/nrms/inquiries"
                      className="flex items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2.5 no-underline ring-1 ring-neutral-200 transition hover:bg-white hover:no-underline hover:ring-emerald-300"
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${CHANNEL_CLS[inquiry.channel] ?? CHANNEL_CLS.WEB}`}>
                        <ChannelIcon channel={inquiry.channel} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-neutral-900">
                          {inquiry.guestName || inquiry.guestHandle || inquiry.reference}
                        </span>
                        <span className="block truncate text-[11px] leading-4 text-neutral-500">
                          {stay ?? label(inquiry.channel)}
                          {inquiry.roomType ? ` · ${inquiry.roomType.name}` : ""}
                          {inquiry.adults + inquiry.children > 0 ? ` · ${inquiry.adults + inquiry.children} guests` : ""}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${overdue ? "bg-red-50 text-red-700" : "bg-neutral-200 text-neutral-700"}`}>
                        {waitingFor(inquiry.waited)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {awaitingReply.length > 6 ? (
            <p className="m-0 mt-2 text-center text-[11px] text-neutral-500">
              {awaitingReply.length - 6} more waiting in the inbox
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-sm font-black text-neutral-900">Where the bookings are lost</h2>
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-bold text-neutral-600">
              {reporting ? `${reporting.periodDays} days` : "No data"}
            </span>
          </div>

          {funnelSteps.length === 0 || !funnel ? (
            <EmptyState
              icon={<TrendingUp className="h-5 w-5" />}
              title="No conversion data yet"
              body="Once guests open the direct booking page and start asking questions, the drop between each stage appears here."
            />
          ) : (
            <>
              <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
                {funnelSteps.map((step) => (
                  <li key={step.key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-bold text-neutral-700">{step.label}</span>
                      <span className="shrink-0 text-[11px] text-neutral-500">
                        <b className="text-neutral-900">{step.value.toLocaleString()}</b>
                        {step.fromPrevious == null ? "" : ` · ${step.fromPrevious}% carried`}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div className={`h-full rounded-full ${step.cls}`} style={{ width: `${step.widthPct}%` }} />
                    </div>
                    <p className="m-0 mt-0.5 text-[10px] leading-4 text-neutral-400">{step.note}</p>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-3 rounded-xl bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-600 ring-1 ring-neutral-200">
                {funnel.inquiries === 0
                  ? "No inquiries arrived in this period."
                  : funnel.responded < funnel.inquiries
                    ? `${funnel.inquiries - funnel.responded} of ${funnel.inquiries} inquiries never got a first reply. That is the cheapest gap to close.`
                    : funnel.holds === 0
                      ? "Every inquiry was answered, but none turned into a held reservation yet."
                      : `${funnel.confirmed} of ${funnel.holds} holds became confirmed stays.`}
              </p>
            </>
          )}
        </section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-black text-neutral-900">Group cut-offs</h2>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">Rooms still held with the decision date inside a week.</p>
            </div>
            <Link href="/owner/nrms/groups" className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 no-underline hover:underline">
              All blocks <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {cutOffSoon.length === 0 ? (
            <EmptyState
              icon={<Layers className="h-5 w-5" />}
              title={liveBlocks.length === 0 ? "No live group blocks" : "No cut-off inside a week"}
              body={
                liveBlocks.length === 0
                  ? "Blocks you hold for agencies and companies appear here as their release date approaches."
                  : `${liveBlocks.length} ${liveBlocks.length === 1 ? "block is" : "blocks are"} live with more time to run.`
              }
            />
          ) : (
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {cutOffSoon.slice(0, 5).map((block) => {
                const days = daysUntil(block.cutOffAt);
                return (
                  <li key={block.id}>
                    <Link
                      href="/owner/nrms/groups"
                      className="block rounded-xl bg-neutral-50 px-3 py-2.5 no-underline ring-1 ring-neutral-200 transition hover:bg-white hover:no-underline hover:ring-emerald-300"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-bold text-neutral-900">
                          {block.agencyName || block.contactName || block.reference}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${BLOCK_STATUS_CLS[block.status] ?? BLOCK_STATUS_CLS.HELD}`}>
                          {BLOCK_STATUS_LABEL[block.status] ?? label(block.status)}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${block.cutOffPassed ? "bg-red-50 text-red-700" : days <= 2 ? "bg-amber-50 text-amber-800" : "bg-neutral-200 text-neutral-700"}`}>
                          {block.cutOffPassed ? "Cut-off passed" : days <= 0 ? "Cut-off today" : `${days} ${days === 1 ? "day" : "days"} left`}
                        </span>
                      </span>
                      <span className="mt-1 block text-[11px] leading-4 text-neutral-500">
                        {block.roomsHeld} of {block.roomsTotal} rooms still held · {new Date(block.checkIn).toLocaleDateString(undefined, { day: "numeric", month: "short" })} to {new Date(block.checkOut).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {money(block.blockValue, block.currency)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-black text-neutral-900">Agent decisions</h2>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">Booking holds first, followed by partnership requests.</p>
            </div>
            <Link href="/owner/nrms/agents" className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 no-underline hover:underline">
              All agents <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {pendingAgentBookings.length === 0 && agentQueue.length === 0 ? (
            <EmptyState
              icon={<Handshake className="h-5 w-5" />}
              title="Nothing pending"
              body={
                activeAgents === 0
                  ? "Invite a travel agency and their requests will queue here for a decision."
                  : `${activeAgents} ${activeAgents === 1 ? "agency is" : "agencies are"} active and selling this property.`
              }
            />
          ) : (
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {pendingAgentBookings.slice(0, 5).map((request) => (
                <li key={`booking-${request.id}`}>
                  <Link href="/owner/nrms/agents/requests" className="flex items-center gap-3 rounded-xl bg-amber-50 px-3 py-2.5 no-underline ring-1 ring-amber-200 transition hover:bg-white hover:no-underline hover:ring-amber-300">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800"><Clock3 className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-neutral-900">{request.agency?.legalName || "Travel agent booking"}</span><span className="block truncate text-[11px] leading-4 text-neutral-500">{request.rooms} × {request.roomType || "room"} · arrival {new Date(request.checkIn).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span></span>
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">Decide</span>
                  </Link>
                </li>
              ))}
              {agentQueue.slice(0, Math.max(0, 5 - pendingAgentBookings.length)).map((link) => (
                <li key={link.id}>
                  <Link
                    href="/owner/nrms/agents"
                    className="flex items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2.5 no-underline ring-1 ring-neutral-200 transition hover:bg-white hover:no-underline hover:ring-emerald-300"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                      <Handshake className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-neutral-900">{link.agency?.name || `Agency #${link.id}`}</span>
                      <span className="block truncate text-[11px] leading-4 text-neutral-500">
                        {link.status === "REQUESTED"
                          ? "Asked to sell this property"
                          : "Accepted your invitation, waiting for activation"}
                        {link.requestedAt ? ` · ${waitingFor(minutesSince(link.requestedAt))} ago` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-800">Decide</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {reporting && reporting.sources.length > 0 ? (
        <section className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
          <h2 className="m-0 text-sm font-black text-neutral-900">Which channel actually books</h2>
          <p className="m-0 mt-0.5 text-xs text-neutral-500">
            Last {reporting.periodDays} days, by the source the guest arrived from.
          </p>
          <div className="mt-3 -mx-3.5 overflow-x-auto px-3.5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[420px] border-collapse text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-500">
                  <th className="pb-2 pr-2 font-bold">Source</th>
                  <th className="pb-2 px-2 text-right font-bold">Views</th>
                  <th className="pb-2 px-2 text-right font-bold">Inquiries</th>
                  <th className="pb-2 px-2 text-right font-bold">Held</th>
                  <th className="pb-2 pl-2 text-right font-bold">Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {reporting.sources.slice(0, 6).map((source) => (
                  <tr key={source.source} className="shadow-[inset_0_1px_0_0_rgb(229,229,229)]">
                    <td className="py-2 pr-2 font-bold text-neutral-900">{label(source.source)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-neutral-600">{source.visits.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-neutral-600">{source.inquiries.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-neutral-600">{source.holds.toLocaleString()}</td>
                    <td className="py-2 pl-2 text-right tabular-nums font-bold text-emerald-800">{source.confirmed.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({ icon, label: title, value, note, tone, href }: {
  icon: ReactNode;
  label: string;
  value: number | string;
  note: string;
  tone: "neutral" | "warn" | "alert";
  href: string;
}) {
  const ring = tone === "alert" ? "ring-red-200" : tone === "warn" ? "ring-amber-200" : "ring-neutral-200";
  const chip = tone === "alert" ? "bg-red-50 text-red-700" : tone === "warn" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700";
  // A count and a phrase are not the same kind of value. "12" carries at
  // display size; "No replies yet" set that large reads as a headline shouting
  // that nothing happened, so words drop to roughly the size of the label.
  const size = typeof value === "number" ? "text-base sm:text-lg" : "text-xs sm:text-sm";
  return (
    <Link href={href} className={`block rounded-2xl bg-white p-3 no-underline ring-1 transition hover:no-underline hover:ring-emerald-300 sm:p-3.5 ${ring}`}>
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg ${chip}`}>{icon}</span>
      <span className={`mt-1.5 block truncate font-black leading-tight text-neutral-900 ${size}`}>{value}</span>
      <span className="mt-0.5 block text-[11px] font-bold leading-4 text-neutral-700">{title}</span>
      <span className="mt-0.5 block text-[10px] leading-4 text-neutral-500">{note}</span>
    </Link>
  );
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="mt-3 rounded-xl bg-neutral-50 px-3 py-6 text-center ring-1 ring-neutral-200">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-400 ring-1 ring-neutral-200">{icon}</span>
      <p className="m-0 mt-2 text-xs font-bold text-neutral-700">{title}</p>
      <p className="m-0 mt-1 text-[11px] leading-5 text-neutral-500">{body}</p>
    </div>
  );
}
