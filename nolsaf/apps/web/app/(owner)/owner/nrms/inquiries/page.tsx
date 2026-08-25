"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, AtSign, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, ExternalLink, Inbox, Instagram, Loader2, Mail, MessageCircle, Paperclip, Phone, Radio, RefreshCw, Search, Send, UserRound, WifiOff } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { useNrms } from "../_components/NrmsProvider";
import { useSocket } from "@/hooks/useSocket";

type RoomType = { id: number; name: string; baseRate: number; currency: string };
type Inquiry = {
  id: number; reference: string; channel: string; source: string; status: string; intent: string; version: number;
  externalConversationId: string | null;
  guestName: string | null; guestHandle: string | null; guestPhone: string | null; guestEmail: string | null;
  checkIn: string | null; checkOut: string | null; adults: number; children: number; createdAt: string; updatedAt: string; lastMessageAt: string | null; firstResponseAt: string | null;
  roomType: RoomType | null; reservation: { id: number; status: string; receiptNumber: string | null } | null;
  assignedTo: { id: number; name: string | null; fullName: string | null; email: string | null } | null;
  messages: Array<{ id: number; direction: string; channel: string; senderName: string | null; body: string; deliveryStatus: string; attemptCount: number; errorMessage: string | null; createdAt: string; metadata: { attachment?: { type: string; fileName: string | null; mimeType: string | null }; automated?: boolean } | null }>;
};
type ConversionReport = {
  periodDays: number;
  funnel: { visits: number; inquiries: number; responded: number; holds: number; confirmed: number };
  rates: { visitToInquiryPct: number | null; inquiryToHoldPct: number | null; holdToConfirmedPct: number | null };
  averageFirstResponseMinutes: number | null;
  sources: Array<{ source: string; visits: number; inquiries: number; responded: number; holds: number; confirmed: number }>;
};
type InboxData = { total: number; inquiries: Inquiry[]; assignees: Array<{ id: number; name: string | null; fullName: string | null; email: string | null; role: string }>; roomTypes: RoomType[]; reporting?: ConversionReport; messagingConnections?: Array<{ provider: string; status: string; displayName: string | null; lastWebhookAt: string | null; lastError: string | null }>; messagingOperations?: { webhookPending: number; webhookDead: number; outboundRetrying: number; outboundFailed: number; templateRequired: number }; metaReadiness?: { appConfigured: boolean; webhookConfigured: boolean; graphVersion: string | null } };
type MessagingDiagnostic = {
  provider: "WHATSAPP"; propertyId: number; checkedAt: string;
  verdict: "HEALTHY" | "CONFIGURATION_BROKEN" | "PROCESSING_BROKEN" | "AWAITING_META_WEBHOOK" | "ATTENTION_REQUIRED";
  checks: Array<{ id: string; label: string; status: "PASS" | "WARN" | "FAIL"; detail: string }>;
  evidence: { reportedCallback: string | null; connectedPhoneNumber: string | null; phoneStatus: string | null; codeVerificationStatus: string | null; lastWebhookAt: string | null; latestWebhookJobStatus: string | null; latestInboundAt: string | null };
};

const inputClass = "box-border min-h-10 w-full rounded-lg bg-white px-3 text-sm text-neutral-900 outline-none ring-1 ring-neutral-300 transition focus:ring-2 focus:ring-emerald-600";
const statusStyle: Record<string, string> = { NEW: "bg-violet-100 text-violet-800", OPEN: "bg-sky-100 text-sky-800", WAITING_GUEST: "bg-amber-100 text-amber-800", RESOLVED: "bg-emerald-100 text-emerald-800", CONVERTED: "bg-emerald-700 text-white", CLOSED: "bg-neutral-200 text-neutral-600" };
const channelStyle: Record<string, string> = { INSTAGRAM: "bg-fuchsia-50 text-fuchsia-700", WHATSAPP: "bg-emerald-50 text-emerald-700", PHONE: "bg-sky-50 text-sky-700", EMAIL: "bg-amber-50 text-amber-700", WEB: "bg-neutral-100 text-neutral-700" };

function ChannelIcon({ channel, className = "h-4 w-4" }: { channel: string; className?: string }) {
  const Icon = channel === "INSTAGRAM" ? Instagram : channel === "WHATSAPP" ? MessageCircle : channel === "PHONE" ? Phone : channel === "EMAIL" ? Mail : AtSign;
  return <Icon className={className} />;
}
function label(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()); }
function timeAgo(value: string | null) {
  if (!value) return "No activity";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Just now"; if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; return `${Math.floor(hours / 24)}d ago`;
}
function dateOnly(value: string | null) { return value ? value.slice(0, 10) : ""; }
function nights(checkIn: string, checkOut: string) { return Math.max(0, Math.round((new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86_400_000)); }
function conversionPercent(previous: number, current: number) { return previous > 0 ? Math.round((current / previous) * 1000) / 10 : null; }

export default function NrmsGuestInquiriesPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const { socket, connected: liveConnected } = useSocket(undefined, { enabled: true, joinDriverRoom: false });
  const [data, setData] = useState<InboxData>({ total: 0, inquiries: [], assignees: [], roomTypes: [] });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [status, setStatus] = useState(""); const [channel, setChannel] = useState(""); const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [messagingDiagnostic, setMessagingDiagnostic] = useState<MessagingDiagnostic | null>(null);
  const [response, setResponse] = useState(""); const [responseKind, setResponseKind] = useState<"OUTBOUND" | "INTERNAL">("OUTBOUND");
  const [conversion, setConversion] = useState({ guestName: "", guestPhone: "", guestEmail: "", checkIn: "", checkOut: "", roomTypeId: "", adults: "1" });

  const load = useCallback(async (silent = false) => {
    if (!selectedPropertyId) return; if (!silent) setLoading(true); if (!silent) setError(null);
    try {
      const result = await apiClient.get<InboxData>(`/api/owner/nrms/inquiries/property/${selectedPropertyId}`, { params: { ...(status ? { status } : {}), ...(channel ? { channel } : {}), ...(query.trim() ? { q: query.trim() } : {}) } });
      setData(result.data); setSelectedId((current) => current && result.data.inquiries.some((item) => item.id === current) ? current : result.data.inquiries[0]?.id ?? null);
    } catch (requestError: any) { if (!silent) setError(requestError?.response?.data?.error || "The reception inbox could not be loaded."); }
    finally { if (!silent) setLoading(false); }
  }, [channel, query, selectedPropertyId, status]);
  useEffect(() => { setMessagingDiagnostic(null); }, [selectedPropertyId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = (event?: { propertyId?: number }) => {
      if (!event?.propertyId || event.propertyId === selectedPropertyId) void load(true);
    };
    const timer = window.setInterval(() => void load(true), 20_000);
    socket?.on("nrms:inbox:update", refresh);
    return () => { window.clearInterval(timer); socket?.off("nrms:inbox:update", refresh); };
  }, [load, selectedPropertyId, socket]);
  const selected = data.inquiries.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    const room = selected.roomType ?? data.roomTypes[0] ?? null;
    const checkIn = dateOnly(selected.checkIn); const checkOut = dateOnly(selected.checkOut);
    setConversion({ guestName: selected.guestName || "", guestPhone: selected.guestPhone || "", guestEmail: selected.guestEmail || "", checkIn, checkOut, roomTypeId: room ? String(room.id) : "", adults: String(selected.adults || 1) });
    setResponse(""); setNotice(null); setError(null);
  }, [data.roomTypes, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutate = async (key: string, request: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(null); setNotice(null);
    try { await request(); setNotice(success); await load(); }
    catch (requestError: any) {
      setError(requestError?.response?.data?.error || "The inquiry could not be updated.");
      if (requestError?.response?.data?.code === "VERSION_CONFLICT") await load(true);
    }
    finally { setBusy(null); }
  };
  const patchInquiry = (body: Record<string, unknown>, success: string) => selected && mutate("update", () => apiClient.patch(`/api/owner/nrms/inquiries/property/${selectedPropertyId}/${selected.id}`, { version: selected.version, ...body }), success);
  const liveConnection = selected ? data.messagingConnections?.find((item) => item.provider === selected.channel && item.status === "CONNECTED") : null;
  const canSendLive = Boolean(liveConnection && selected?.externalConversationId);
  const recordResponse = () => selected && response.trim() && mutate("message", () => apiClient.post(`/api/owner/nrms/inquiries/property/${selectedPropertyId}/${selected.id}/messages`, { version: selected.version, body: response, direction: responseKind, deliveryMode: responseKind === "OUTBOUND" && canSendLive ? "SEND" : "RECORD" }), responseKind === "INTERNAL" ? "Internal note added." : canSendLive ? `Reply queued securely for ${label(selected.channel)}.` : "External response recorded.");
  const replayFailures = () => mutate("replay", () => apiClient.post(`/api/owner/nrms/inquiries/property/${selectedPropertyId}/messaging-failures/replay`), "Failed messages queued for another delivery attempt.");
  const runMessagingDiagnostic = async () => {
    if (!selectedPropertyId) return;
    setBusy("messaging-diagnostic"); setError(null);
    try {
      const result = await apiClient.post<{ diagnostic: MessagingDiagnostic }>(`/api/owner/nrms/messaging/property/${selectedPropertyId}/whatsapp/diagnose`);
      setMessagingDiagnostic(result.data.diagnostic);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "The messaging diagnostic could not be completed.");
    } finally { setBusy(null); }
  };
  const selectedRoom = data.roomTypes.find((room) => String(room.id) === conversion.roomTypeId) ?? null;
  const estimatedTotal = selectedRoom && conversion.checkIn && conversion.checkOut ? selectedRoom.baseRate * nights(conversion.checkIn, conversion.checkOut) : 0;
  const conversionReady = Boolean(conversion.guestName.trim().length >= 2 && conversion.guestPhone.trim().length >= 7 && conversion.checkIn && conversion.checkOut && nights(conversion.checkIn, conversion.checkOut) > 0 && selectedRoom);
  const createHold = () => {
    if (!selected || !selectedRoom || !conversionReady) return;
    return mutate("convert", () => apiClient.post(`/api/owner/nrms/inquiries/property/${selectedPropertyId}/${selected.id}/hold`, {
      version: selected.version,
      checkIn: conversion.checkIn, checkOut: conversion.checkOut, adults: Number(conversion.adults), children: selected.children || 0,
      guestName: conversion.guestName, guestPhone: conversion.guestPhone, guestEmail: conversion.guestEmail || null, roomTypeId: selectedRoom.id,
    }), "Inquiry converted to a one-hour room hold.");
  };

  const counts = useMemo(() => ({ new: data.inquiries.filter((item) => item.status === "NEW").length, open: data.inquiries.filter((item) => item.status === "OPEN").length, waiting: data.inquiries.filter((item) => item.status === "WAITING_GUEST").length }), [data.inquiries]);
  /**
   * `counts` is derived from the response, which the server has already scoped
   * to the active status. Reading it straight into the status cards would zero
   * the two cards you are not filtering by, the moment you filter. So the last
   * unfiltered tally is held and shown while a status filter is on.
   */
  const [baselineCounts, setBaselineCounts] = useState(counts);
  useEffect(() => { if (!status) setBaselineCounts(counts); }, [status, counts]);
  const statusCounts = status ? baselineCounts : counts;
  const funnelStages = useMemo(() => {
    if (!data.reporting) return [];
    const funnel = data.reporting.funnel;
    return [
      { label: "Ad / page visits", value: funnel.visits, rate: null },
      { label: "Inquiries", value: funnel.inquiries, rate: conversionPercent(funnel.visits, funnel.inquiries) },
      { label: "Human responses", value: funnel.responded, rate: conversionPercent(funnel.inquiries, funnel.responded) },
      { label: "Room holds", value: funnel.holds, rate: conversionPercent(funnel.responded, funnel.holds) },
      { label: "Confirmed", value: funnel.confirmed, rate: conversionPercent(funnel.holds, funnel.confirmed) },
    ];
  }, [data.reporting]);
  const hasFunnelActivity = funnelStages.some((stage) => stage.value > 0);
  const connectionHealth = useMemo(() => ["INSTAGRAM", "WHATSAPP"].map((provider) => ({
    provider,
    connection: data.messagingConnections?.find((item) => item.provider === provider) ?? null,
  })), [data.messagingConnections]);
  const webhookObserved = Boolean(data.messagingConnections?.some((connection) => connection.lastWebhookAt));

  return <div className="reception-inbox mx-auto max-w-[1500px] space-y-4 pb-10">
    <style jsx global>{`
      .reception-inbox .text-\\[8px\\],
      .reception-inbox .text-\\[9px\\] { font-size: 0.75rem !important; }
      .reception-inbox .text-\\[10px\\],
      .reception-inbox .text-\\[11px\\] { font-size: 0.8125rem !important; }
    `}</style>
    {/* Preflight is disabled app-wide, so `border-*` sets a width against
        border-style: none and paints nothing. Every edge here is a ring. */}
    <header className="overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-950 shadow-[0_18px_44px_-30px_rgba(6,78,59,0.8)] ring-1 ring-emerald-900">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4 px-5 py-5 sm:px-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-800/70 text-emerald-100 ring-1 ring-emerald-700/70"><Inbox className="h-5 w-5" /></span>
        <div className="min-w-[16rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[.18em] text-emerald-300">Direct conversion</p>
            <span className="h-1 w-1 rounded-full bg-emerald-700" aria-hidden="true" />
            <span className="truncate text-[10px] font-semibold uppercase tracking-[.12em] text-emerald-400/90">{selectedProperty?.title || "Reception workspace"}</span>
          </div>
          <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Reception inquiries</h1>
          <p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-emerald-100/70 sm:text-sm">Turn availability interest into a tracked conversation, room hold and confirmed reservation.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Whether the inbox is live was buried three blocks down, under a
              heading. It belongs beside the thing it describes. */}
          <span className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-[10px] font-bold ring-1 ${liveConnected ? "bg-emerald-800/60 text-emerald-100 ring-emerald-700/70" : "bg-amber-500/15 text-amber-200 ring-amber-500/40"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${liveConnected ? "animate-pulse bg-emerald-300" : "bg-amber-300"}`} aria-hidden="true" />
            {liveConnected ? "Live" : "Reconnecting"}
          </span>
          {/* No total here on purpose: the three status cards below carry the
              per-status counts and the Inbox panel header carries the total. */}
          <button type="button" onClick={() => void load()} className="inline-flex min-h-9 items-center gap-2 rounded-lg border-0 bg-white px-3.5 text-xs font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
      </div>
    </header>

    {/* These three were read-only tiles sitting above a status dropdown that
        did the same job. They are now the filter: click to scope the inbox,
        click again to clear. */}
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        { key: "NEW", name: "New", detail: "Awaiting first review", count: statusCounts.new, icon: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500", bar: "bg-violet-500", active: "ring-2 ring-violet-500 bg-[linear-gradient(135deg,#ffffff_55%,#f5f3ff)]" },
        { key: "OPEN", name: "Being handled", detail: "Reception is working", count: statusCounts.open, icon: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500", bar: "bg-sky-500", active: "ring-2 ring-sky-500 bg-[linear-gradient(135deg,#ffffff_55%,#f0f9ff)]" },
        { key: "WAITING_GUEST", name: "Waiting for guest", detail: "Reception has replied", count: statusCounts.waiting, icon: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500", bar: "bg-amber-500", active: "ring-2 ring-amber-500 bg-[linear-gradient(135deg,#ffffff_55%,#fffbeb)]" },
      ].map((item) => {
        const on = status === item.key;
        return <button
          key={item.key}
          type="button"
          aria-pressed={on}
          onClick={() => setStatus(on ? "" : item.key)}
          className={`relative flex min-h-[92px] w-full appearance-none items-center gap-3 overflow-hidden rounded-xl border-0 px-4 py-3.5 text-left shadow-[0_6px_18px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_-14px_rgba(15,23,42,0.35)] ${on ? item.active : "bg-white ring-1 ring-neutral-200"}`}
        >
          <span className={`absolute inset-y-3 left-0 w-1 rounded-r-full transition-opacity ${item.bar} ${on ? "opacity-100" : "opacity-40"}`} aria-hidden="true" />
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${item.icon}`}><Inbox className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex items-center gap-1.5 text-xs font-bold text-neutral-900"><span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />{item.name}</p>
            <p className="mb-0 mt-1 truncate text-[10px] font-medium text-neutral-500">{on ? "Filtering the inbox · tap to clear" : item.detail}</p>
          </div>
          {/* A zero recedes so a real number carries the eye. */}
          <strong className={`shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-2xl tabular-nums tracking-tight shadow-sm ring-1 ring-neutral-200 ${item.count > 0 ? "text-neutral-950" : "text-neutral-300"}`}>{item.count}</strong>
        </button>;
      })}
    </div>

    <section className="overflow-hidden rounded-xl bg-white shadow-[0_5px_16px_rgba(15,23,42,0.06)] ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 bg-[linear-gradient(110deg,#ffffff_0%,#f8fafc_100%)] px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"><Radio className="h-4 w-4" /></span>
        <div className="min-w-[12rem] flex-1">
          <h2 className="m-0 text-xs font-bold text-neutral-950">Messaging readiness</h2>
          <p className="mb-0 mt-0.5 text-xs leading-4 text-neutral-500">Guests messaging you on Instagram or WhatsApp land in this inbox.</p>
        </div>
        <span className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[10px] font-bold shadow-sm ring-1 ${webhookObserved ? "bg-emerald-50 text-emerald-800 ring-emerald-300" : data.metaReadiness?.appConfigured && data.metaReadiness?.webhookConfigured ? "bg-amber-50 text-amber-900 ring-amber-300" : "bg-red-50 text-red-800 ring-red-300"}`}>
          {webhookObserved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {webhookObserved ? "Webhook receiving" : data.metaReadiness?.appConfigured && data.metaReadiness?.webhookConfigured ? "Webhook not yet verified" : "Meta setup incomplete"}
        </span>
        <button type="button" disabled={busy === "messaging-diagnostic"} onClick={() => void runMessagingDiagnostic()} className="inline-flex min-h-9 shrink-0 appearance-none items-center justify-center gap-2 rounded-lg border-0 bg-slate-900 px-3.5 text-[10px] font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60">
          {busy === "messaging-diagnostic" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}Run diagnostics
        </button>
      </div>

      {/* Each provider gets a row with a way out. "Not connected" used to be a
          statement with nothing behind it, on the one screen where an owner is
          most likely to want to fix exactly that. */}
      <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
        {connectionHealth.map(({ provider, connection }) => {
          const connected = connection?.status === "CONNECTED";
          const name = provider === "INSTAGRAM" ? "Instagram" : "WhatsApp";
          return <div key={provider} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 bg-white px-4 py-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${provider === "INSTAGRAM" ? "bg-fuchsia-50 text-fuchsia-700" : "bg-emerald-50 text-emerald-700"}`}>
              <ChannelIcon channel={provider} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 flex items-center gap-1.5 text-xs font-bold text-neutral-900">
                {name}
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-neutral-300"}`} aria-hidden="true" />
              </p>
              <p className={`mb-0 mt-0.5 truncate text-[10px] font-semibold ${connected ? "text-emerald-700" : "text-neutral-400"}`}>
                {connected
                  ? connection?.lastWebhookAt ? `Active ${timeAgo(connection.lastWebhookAt)}` : connection?.displayName || "Connected"
                  : connection?.status ? label(connection.status) : "Not connected"}
              </p>
            </div>
            {!connected && (
              <Link href="/owner/nrms/controls?section=guest" className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg bg-white px-3 text-[10px] font-bold text-emerald-800 no-underline ring-1 ring-emerald-200 transition hover:bg-emerald-50 hover:no-underline">
                Connect<ChevronRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>;
        })}
      </div>
    </section>

    {messagingDiagnostic && <section className={`rounded-xl p-4 shadow-[0_6px_18px_rgba(15,23,42,0.06)] ring-1 ${messagingDiagnostic.verdict === "HEALTHY" ? "ring-emerald-300 bg-emerald-50/60" : messagingDiagnostic.verdict === "AWAITING_META_WEBHOOK" ? "ring-amber-300 bg-amber-50/70" : "ring-red-300 bg-red-50/70"}`} aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${messagingDiagnostic.verdict === "HEALTHY" ? "bg-emerald-700 text-white" : messagingDiagnostic.verdict === "AWAITING_META_WEBHOOK" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{messagingDiagnostic.verdict === "HEALTHY" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</span><div><h2 className="m-0 text-sm font-bold text-neutral-950">WhatsApp end-to-end diagnosis</h2><p className="mb-0 mt-1 text-xs leading-5 text-neutral-700">{messagingDiagnostic.verdict === "HEALTHY" ? "Meta configuration and the NoLSAF processing path are healthy." : messagingDiagnostic.verdict === "CONFIGURATION_BROKEN" ? "The failure is in Meta or account configuration. Review the failed checks below." : messagingDiagnostic.verdict === "PROCESSING_BROKEN" ? "Meta is connected, but the NoLSAF queue or worker is broken." : messagingDiagnostic.verdict === "AWAITING_META_WEBHOOK" ? "Configuration looks valid, but Meta has not delivered a webhook to this property yet." : "One or more messaging checks require attention."}</p></div></div>
        <span className="rounded-full bg-white/80 px-3 py-1.5 text-[10px] font-bold ring-1 ring-current/20">Checked {timeAgo(messagingDiagnostic.checkedAt)}</span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {messagingDiagnostic.checks.map((check) => <article key={check.id} className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-neutral-200"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${check.status === "PASS" ? "bg-emerald-500" : check.status === "WARN" ? "bg-amber-500" : "bg-red-500"}`} /><h3 className="m-0 text-xs font-bold text-neutral-900">{check.label}</h3><span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-bold ${check.status === "PASS" ? "bg-emerald-100 text-emerald-800" : check.status === "WARN" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>{check.status}</span></div><p className="mb-0 mt-2 text-[10px] leading-4 text-neutral-600">{check.detail}</p></article>)}
      </div>
    </section>}

    {data.messagingOperations && (data.messagingOperations.webhookPending + data.messagingOperations.webhookDead + data.messagingOperations.outboundRetrying + data.messagingOperations.outboundFailed + data.messagingOperations.templateRequired > 0) && <section className={`flex flex-col gap-3 rounded-xl px-4 py-3 ring-1 sm:flex-row sm:items-center sm:justify-between ${data.messagingOperations.webhookDead + data.messagingOperations.outboundFailed + data.messagingOperations.templateRequired > 0 ? "ring-red-300 bg-red-50" : "ring-amber-300 bg-amber-50"}`} role="status">
      <div className="flex items-start gap-3"><AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${data.messagingOperations.webhookDead + data.messagingOperations.outboundFailed + data.messagingOperations.templateRequired > 0 ? "text-red-700" : "text-amber-700"}`} /><div><h2 className="m-0 text-sm font-bold text-neutral-950">Message delivery operations</h2><p className="mb-0 mt-1 text-xs leading-5 text-neutral-700">{data.messagingOperations.webhookPending} inbound event(s) processing · {data.messagingOperations.outboundRetrying} outbound reply/replies retrying · {data.messagingOperations.webhookDead + data.messagingOperations.outboundFailed} need intervention{data.messagingOperations.templateRequired ? ` · ${data.messagingOperations.templateRequired} require an approved WhatsApp template` : ""}.</p></div></div>
      {(data.messagingOperations.webhookDead + data.messagingOperations.outboundFailed > 0) && <button type="button" disabled={busy === "replay"} onClick={() => void replayFailures()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-white px-4 text-xs font-bold text-red-800 ring-1 ring-red-300 disabled:opacity-50">{busy === "replay" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Retry failed messages</button>}
    </section>}

    {data.reporting && <section className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_rgba(15,23,42,0.07)] ring-1 ring-slate-200">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 px-4 py-4 shadow-[inset_0_-1px_0_0_#cbd5e1] sm:px-5"><div><h2 className="m-0 text-sm font-bold text-neutral-950">Direct conversion funnel</h2><p className="mb-0 mt-1 text-[10px] text-neutral-500">Last {data.reporting.periodDays} days · property-scoped attribution</p></div><span className={`rounded-full px-3 py-1.5 text-[10px] font-bold shadow-sm ring-1 ${data.reporting.averageFirstResponseMinutes == null ? "bg-white text-neutral-600 ring-neutral-300" : "bg-emerald-50 text-emerald-800 ring-emerald-300"}`}>{data.reporting.averageFirstResponseMinutes == null ? "No human responses yet" : `Average human response ${data.reporting.averageFirstResponseMinutes} min`}</span></header>

      {!hasFunnelActivity ? <div className="bg-emerald-50/30 p-3 sm:p-5">
        <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#ffffff_0%,#f0fdf4_100%)] shadow-[0_10px_30px_rgba(6,78,59,0.08)] ring-1 ring-emerald-200">
          <span className="pointer-events-none absolute -right-12 -top-24 h-64 w-64 rounded-full bg-emerald-200/30 blur-3xl" aria-hidden="true" />
          <div className="relative p-5 sm:p-7">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="flex min-w-0 items-start gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-950 text-emerald-100 shadow-[0_8px_20px_rgba(6,78,59,0.2)]"><Inbox className="h-6 w-6" /></span>
                {/* Wording no longer says "check a channel below": the channel
                    cards that used to sit here duplicated the Messaging
                    readiness panel above, so they were removed. */}
                <div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-[.2em] text-emerald-700">Reception inbox · Ready for testing</p><h3 className="mb-0 mt-1.5 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Bring the first guest conversation into NRMS</h3><p className="mb-0 mt-2 max-w-3xl text-xs leading-5 text-neutral-600 sm:text-sm">Your direct inquiry pipeline is empty. Connect a channel in Messaging readiness above, send one guest message, and the conversation will appear here for reception to handle.</p></div>
              </div>
              <Link href="/owner/nrms/controls?section=guest" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 text-xs font-bold text-white no-underline shadow-[0_7px_18px_rgba(6,95,70,0.22)] transition hover:-translate-y-0.5 hover:bg-emerald-900 hover:text-white hover:no-underline lg:w-auto">Manage guest channels<ChevronRight className="h-4 w-4" /></Link>
            </div>

            <ol className="m-0 mt-6 grid list-none gap-3 p-0 sm:grid-cols-3">
              {[
                { number: "1", title: "Send a guest message", detail: "Use a separate guest account or phone." },
                { number: "2", title: "Open the inquiry", detail: "Refresh Reception and select the new chat." },
                { number: "3", title: "Reply and convert", detail: "Respond, then create a room hold." },
              ].map((step) => <li key={step.number} className="rounded-xl bg-white/80 p-4 shadow-sm ring-1 ring-emerald-200"><div className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-[10px] font-black text-white shadow-sm">{step.number}</span><span className="h-px flex-1 bg-emerald-100" /></div><p className="mb-0 mt-3 text-xs font-bold text-neutral-950">{step.title}</p><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">{step.detail}</p></li>)}
            </ol>
          </div>
        </div>
      </div> : (
        // Five columns of zeros under a panel already saying the pipeline is
        // empty said the same thing twice, so the stages only render once
        // there is something to stage.
        <div className="overflow-x-auto bg-slate-50/70 p-3"><div className="grid min-w-[760px] grid-cols-5 gap-2">{funnelStages.map((stage, index) => <div key={stage.label} className={`relative flex min-h-[124px] flex-col rounded-xl px-4 py-4 shadow-sm ring-1 ${["ring-violet-300 bg-violet-50/70", "ring-sky-300 bg-sky-50/70", "ring-cyan-300 bg-cyan-50/70", "ring-amber-300 bg-amber-50/70", "ring-emerald-300 bg-emerald-50/70"][index]}`}><span className={`mb-3 h-1 w-8 rounded-full ${["bg-violet-500", "bg-sky-500", "bg-cyan-600", "bg-amber-500", "bg-emerald-600"][index]}`} aria-hidden="true" /><p className="m-0 text-[9px] font-bold uppercase tracking-[.12em] text-neutral-600">{stage.label}</p><strong className={`mt-2 text-2xl tabular-nums tracking-tight ${stage.value > 0 ? "text-neutral-950" : "text-neutral-300"}`}>{stage.value}</strong><p className="mb-0 mt-auto pt-2 text-[9px] font-semibold text-neutral-500">{index === 0 ? "Starting audience" : stage.rate == null ? "No prior-stage data" : `${stage.rate}% from prior stage`}</p>{index < funnelStages.length - 1 && <ChevronRight className="absolute -right-4 top-1/2 z-10 h-6 w-6 -translate-y-1/2 rounded-full bg-white p-1 text-neutral-700 shadow-sm ring-1 ring-slate-300" />}</div>)}</div></div>
      )}

      {data.reporting.sources.length > 0 && <div className="px-4 py-3 shadow-[inset_0_1px_0_0_#f1f5f9] sm:px-5"><div className="grid grid-cols-[minmax(7rem,1fr)_repeat(4,minmax(3.5rem,.55fr))] gap-2 text-[9px] font-bold uppercase tracking-wide text-neutral-400"><span>Source</span><span>Visits</span><span>Inquiries</span><span>Holds</span><span>Confirmed</span></div><div className="mt-1">{data.reporting.sources.slice(0, 6).map((item) => <div key={item.source} className="grid grid-cols-[minmax(7rem,1fr)_repeat(4,minmax(3.5rem,.55fr))] gap-2 py-2 text-[11px] tabular-nums text-neutral-600 shadow-[inset_0_-1px_0_0_#f5f5f5] last:shadow-none"><strong className="truncate text-neutral-800">{label(item.source)}</strong><span>{item.visits}</span><span>{item.inquiries}</span><span>{item.holds}</span><span>{item.confirmed}</span></div>)}</div></div>}
    </section>}

    <section className="grid gap-3 rounded-xl bg-white p-3 shadow-[0_5px_16px_rgba(15,23,42,0.05)] ring-1 ring-neutral-300 md:grid-cols-[1fr_180px_180px_auto]">
      <label className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" /><input className={`${inputClass} pl-9`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Guest, handle, phone or reference" /></label>
      <select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter inquiry status"><option value="">All statuses</option>{["NEW", "OPEN", "WAITING_GUEST", "RESOLVED", "CONVERTED", "CLOSED"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select>
      <select className={inputClass} value={channel} onChange={(event) => setChannel(event.target.value)} aria-label="Filter inquiry channel"><option value="">All channels</option>{["WEB", "INSTAGRAM", "WHATSAPP", "PHONE", "EMAIL"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select>
      <button type="button" onClick={() => void load()} className="min-h-10 rounded-lg border-0 bg-emerald-800 px-4 text-xs font-bold text-white">Apply</button>
    </section>

    {(error || notice) && <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${error ? "ring-red-200 bg-red-50 text-red-700" : "ring-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || notice}</div>}

    <div className="grid min-h-[36rem] items-start gap-4 xl:grid-cols-[23rem_minmax(0,1fr)]">
      <section className="overflow-hidden rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.06)] ring-1 ring-neutral-300">
        <div className="flex items-center justify-between px-4 py-3 shadow-[inset_0_-1px_0_0_#d4d4d4]"><h2 className="m-0 text-sm font-bold">Inbox</h2><span className="text-[10px] font-semibold text-neutral-400">{data.total} inquiries</span></div>
        <div className="max-h-[44rem] overflow-y-auto">
          {loading && !data.inquiries.length ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-700" /></div> : data.inquiries.length ? data.inquiries.map((item) => {
            const active = item.id === selectedId; const overdue = !item.firstResponseAt && ["NEW", "OPEN"].includes(item.status) && Date.now() - new Date(item.createdAt).getTime() > 10 * 60_000;
            return <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`block w-full appearance-none border-0 p-4 text-left shadow-[inset_0_-1px_0_0_#f5f5f5] transition ${active ? "bg-emerald-50" : "bg-white hover:bg-neutral-50"}`}>
              <div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${channelStyle[item.channel] || channelStyle.WEB}`}><ChannelIcon channel={item.channel} /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="m-0 truncate text-sm font-bold text-neutral-950">{item.guestName || item.guestHandle || `${label(item.channel)} visitor`}</p><span className="shrink-0 text-[9px] text-neutral-400">{timeAgo(item.lastMessageAt || item.createdAt)}</span></div><p className="mb-0 mt-1 truncate text-[11px] text-neutral-500">{item.roomType?.name || "Room not selected"}{item.checkIn ? ` · ${dateOnly(item.checkIn)}` : ""}</p><div className="mt-2 flex flex-wrap items-center gap-1.5"><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${statusStyle[item.status] || statusStyle.OPEN}`}>{label(item.status)}</span>{overdue && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-bold text-red-700">Response overdue</span>}</div></div><ChevronRight className={`mt-2 h-4 w-4 shrink-0 ${active ? "text-emerald-700" : "text-neutral-300"}`} /></div>
            </button>;
          }) : <div className="px-5 py-16 text-center"><Check className="mx-auto h-6 w-6 text-emerald-600" /><p className="mb-0 mt-3 text-sm font-bold">No matching inquiries</p><p className="mb-0 mt-1 text-xs text-neutral-400">New direct guest activity will appear here.</p></div>}
        </div>
      </section>

      {selected ? <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <header className="grid gap-4 p-4 shadow-[inset_0_-1px_0_0_#f5f5f5] sm:grid-cols-[1fr_auto] sm:p-5">
          <div className="flex min-w-0 items-start gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${channelStyle[selected.channel] || channelStyle.WEB}`}><ChannelIcon channel={selected.channel} className="h-5 w-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-lg font-bold text-neutral-950">{selected.guestName || selected.guestHandle || `${label(selected.channel)} visitor`}</h2><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${statusStyle[selected.status] || statusStyle.OPEN}`}>{label(selected.status)}</span></div><p className="mb-0 mt-1 text-xs text-neutral-500">{selected.reference} · {label(selected.channel)} from {label(selected.source)}</p></div></div>
          <select className={`${inputClass} sm:w-48`} value={selected.assignedTo?.id || ""} onChange={(event) => void patchInquiry({ assignedToId: event.target.value ? Number(event.target.value) : null, status: selected.status === "NEW" ? "OPEN" : selected.status }, "Inquiry assigned.")} aria-label="Assign inquiry"><option value="">Unassigned</option>{data.assignees.map((person) => <option key={person.id} value={person.id}>{person.fullName || person.name || person.email} · {label(person.role)}</option>)}</select>
        </header>

        {["INSTAGRAM", "WHATSAPP"].includes(selected.channel) && selected.messages.every((message) => message.direction !== "INBOUND") && <div className="mx-4 mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-900 ring-1 ring-amber-200 sm:mx-5"><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>This records that the guest opened {label(selected.channel)}. The actual social messages become visible here after the Meta messaging connection is enabled.</span></div>}

        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[[UserRound, "Guest", selected.guestPhone || selected.guestEmail || "Contact not supplied"], [CalendarDays, "Stay", selected.checkIn && selected.checkOut ? `${dateOnly(selected.checkIn)} → ${dateOnly(selected.checkOut)}` : "Dates not supplied"], [Inbox, "Room", selected.roomType?.name || "Not selected"], [Clock3, "Response", selected.firstResponseAt ? `Responded ${timeAgo(selected.firstResponseAt)}` : `Waiting ${timeAgo(selected.createdAt)}`]].map(([Icon, title, value]: any) => <div key={title} className="rounded-xl bg-neutral-50 p-3"><Icon className="h-4 w-4 text-emerald-700" /><p className="mb-0 mt-2 text-[9px] font-bold uppercase tracking-wide text-neutral-400">{title}</p><p className="mb-0 mt-1 break-words text-[11px] font-semibold text-neutral-700">{value}</p></div>)}
            </div>

            <div className="rounded-xl border border-neutral-200">
              <div className="px-4 py-3 shadow-[inset_0_-1px_0_0_#f5f5f5]"><h3 className="m-0 text-sm font-bold">Conversation record</h3></div>
              <div className="max-h-80 space-y-3 overflow-y-auto bg-neutral-50/70 p-4">
                {selected.messages.map((message) => <div key={message.id} className={`flex ${message.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-xl px-3 py-2.5 ${message.direction === "OUTBOUND" ? "bg-emerald-800 text-white" : message.direction === "INTERNAL" ? "bg-amber-50 text-amber-950 ring-1 ring-amber-200" : "bg-white text-neutral-700 ring-1 ring-neutral-200"}`}><p className="m-0 text-xs font-bold opacity-70">{message.direction === "INTERNAL" ? "Internal note" : message.senderName || label(message.direction)}</p>{message.metadata?.attachment && <div className="mt-2"><p className="m-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-current/20"><Paperclip className="h-3.5 w-3.5" />{message.metadata.attachment.fileName || label(message.metadata.attachment.type)}</p><a href={`/api/owner/nrms/inquiries/property/${selectedPropertyId}/${selected.id}/messages/${message.id}/media`} target="_blank" rel="noreferrer" className="ml-2 text-xs font-bold text-current underline underline-offset-2">Open attachment</a></div>}<p className="mb-0 mt-1 whitespace-pre-wrap text-sm leading-5">{message.body}</p><div className="mt-1.5 flex flex-wrap items-center justify-end gap-2 text-xs opacity-70"><span>{new Date(message.createdAt).toLocaleString()}</span>{message.direction === "OUTBOUND" && <span className={message.deliveryStatus === "FAILED" ? "font-bold text-red-200" : "font-semibold"}>{label(message.deliveryStatus)}{message.attemptCount > 1 ? ` · attempt ${message.attemptCount}` : ""}</span>}</div>{message.errorMessage && <p className="mb-0 mt-1 max-w-md text-xs font-semibold text-red-100">{message.errorMessage.includes("WHATSAPP_CUSTOMER_WINDOW_CLOSED") ? "WhatsApp requires an approved template because the 24-hour reply window closed." : "Delivery needs another attempt."}</p>}</div></div>)}
              </div>
              {!['RESOLVED', 'CONVERTED', 'CLOSED'].includes(selected.status) && <div className="p-3 shadow-[inset_0_1px_0_0_#f5f5f5]"><div className="mb-2 flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${canSendLive ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>{canSendLive ? `${label(selected.channel)} connected · sends live` : "Manual channel · records reply"}</span>{liveConnection?.lastError && <span className="truncate text-[9px] text-red-600" title={liveConnection.lastError}>Last delivery needs attention</span>}</div><div className="flex gap-2"><select className={`${inputClass} w-36 shrink-0`} value={responseKind} onChange={(event) => setResponseKind(event.target.value as typeof responseKind)}><option value="OUTBOUND">{canSendLive ? "Send reply" : "Response made"}</option><option value="INTERNAL">Internal note</option></select><textarea className={`${inputClass} min-h-20 py-2`} value={response} onChange={(event) => setResponse(event.target.value)} placeholder={responseKind === "OUTBOUND" ? canSendLive ? `Write a reply to send on ${label(selected.channel)}…` : "Record what reception replied on the external channel…" : "Add a private handover note…"} /></div><button type="button" disabled={!response.trim() || busy === "message"} onClick={() => void recordResponse()} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border-0 bg-emerald-800 px-4 text-xs font-bold text-white disabled:bg-neutral-200">{busy === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{responseKind === "OUTBOUND" && canSendLive ? "Send reply" : "Record update"}</button></div>}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-neutral-200 p-4"><h3 className="m-0 text-sm font-bold">Queue controls</h3><div className="mt-3 grid gap-2"><button type="button" disabled={busy === "update" || selected.status === "OPEN"} onClick={() => void patchInquiry({ status: "OPEN" }, "Inquiry opened.")} className="min-h-9 rounded-lg border border-sky-200 bg-sky-50 text-xs font-bold text-sky-800 disabled:opacity-40">Mark being handled</button><button type="button" disabled={busy === "update" || selected.status === "RESOLVED"} onClick={() => void patchInquiry({ status: "RESOLVED" }, "Inquiry resolved.")} className="min-h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800 disabled:opacity-40">Resolve inquiry</button><button type="button" disabled={busy === "update"} onClick={() => void patchInquiry({ status: "CLOSED" }, "Inquiry closed.")} className="min-h-9 rounded-lg border border-neutral-200 bg-white text-xs font-bold text-neutral-600 disabled:opacity-40">Close without booking</button></div></div>

            {!selected.reservation && !['RESOLVED', 'CLOSED', 'CONVERTED'].includes(selected.status) && <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4"><h3 className="m-0 text-sm font-bold text-emerald-950">Create room hold</h3><p className="mb-0 mt-1 text-[10px] leading-4 text-emerald-800/70">Available to reception, managers and owners. Pricing and inventory are checked on the server.</p><div className="mt-3 grid gap-3"><label className="grid gap-1 text-[10px] font-bold text-neutral-600">Guest name<input className={inputClass} value={conversion.guestName} onChange={(event) => setConversion({ ...conversion, guestName: event.target.value })} /></label><label className="grid gap-1 text-[10px] font-bold text-neutral-600">Guest phone<input className={inputClass} value={conversion.guestPhone} onChange={(event) => setConversion({ ...conversion, guestPhone: event.target.value })} /></label><div className="grid grid-cols-2 gap-2"><DatePickerField label="Inquiry check-in" value={conversion.checkIn} onChangeAction={(value) => setConversion({ ...conversion, checkIn: value })} widthClassName="w-full" /><DatePickerField label="Inquiry check-out" value={conversion.checkOut} onChangeAction={(value) => setConversion({ ...conversion, checkOut: value })} widthClassName="w-full" /></div><label className="grid gap-1 text-[10px] font-bold text-neutral-600">Room type<select className={inputClass} value={conversion.roomTypeId} onChange={(event) => setConversion({ ...conversion, roomTypeId: event.target.value })}><option value="">Select room</option>{data.roomTypes.map((room) => <option key={room.id} value={room.id}>{room.name} · {new Intl.NumberFormat().format(room.baseRate)} {room.currency}</option>)}</select></label><label className="grid gap-1 text-[10px] font-bold text-neutral-600">Estimated stay total<input readOnly className={`${inputClass} bg-neutral-50`} value={selectedRoom ? `${new Intl.NumberFormat().format(estimatedTotal)} ${selectedRoom.currency}` : "Select a room"} /></label></div><button type="button" disabled={!conversionReady || busy === "convert"} onClick={() => void createHold()} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border-0 bg-emerald-800 text-xs font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-500">{busy === "convert" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}Create one-hour hold</button></div>}
            {selected.reservation && <Link href="/owner/nrms/reservations" className="flex min-h-11 items-center justify-between rounded-xl bg-emerald-800 px-4 text-xs font-bold text-white no-underline hover:text-white"><span>Reservation {selected.reservation.receiptNumber || `#${selected.reservation.id}`}</span><ChevronRight className="h-4 w-4" /></Link>}
          </aside>
        </div>
      </section> : <section className="flex min-h-96 items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white text-sm text-neutral-400">Select an inquiry to open its reception workspace.</section>}
    </div>
  </div>;
}
