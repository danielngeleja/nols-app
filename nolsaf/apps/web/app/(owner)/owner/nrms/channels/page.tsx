"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, Link2, Loader2, LockKeyhole, Plus, Plug, RefreshCw, Save, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";
import CalendarFeeds from "./CalendarFeeds";

type ProviderCode = "EXPEDIA" | "BOOKING_COM" | "AIRBNB";
type RoomType = { id: number; name: string; units?: Array<{ id: number; code: string; status: string }> };
type DateOverride = { from: string; to: string; price?: number | null; closed?: boolean | null; minimumStay?: number | null; maximumStay?: number | null; closedOnArrival?: boolean | null; closedOnDeparture?: boolean | null };
type AriPolicy = { pricingMode?: "BASE" | "FIXED" | "OFFSET" | "MULTIPLIER" | null; pricingValue?: number | null; dateOverrides?: DateOverride[] | null; minimumStay?: number | null; maximumStay?: number | null; closedOnArrival?: boolean | null; closedOnDeparture?: boolean | null };
type Channel = {
  id: number;
  provider: { code: ProviderCode; name: string } | null;
  status: string;
  trustTier: string;
  externalPropertyId: string | null;
  lastSuccessAt: string | null;
  lastErrorMessage: string | null;
  ariEndpointConfigured?: boolean;
  propertyMapping: { externalId: string; status: string } | null;
  roomMappings: Array<{ roomTypeId: number; externalId: string; externalName: string | null; status: string }>;
  rateMappings: Array<{ roomTypeId: number | null; externalId: string; externalName: string | null; currency: string | null; status: string; ariPolicy?: AriPolicy | null }>;
};
type CommandCenter = {
  summary: { inbound: Record<string, number>; outbound: Record<string, number>; openIssues: number; criticalIssues: number };
  runs: Array<{ id: number; kind: string; status: string; startedAt: string; successCount: number; failureCount: number }>;
  deliveries: Array<{ id: number; eventType: string; status: string; attemptCount: number; lastError: string | null }>;
  issues: Array<{ id: number; kind: string; severity: string; externalRef: string | null; internalRef: string | null; lastSeenAt: string }>;
};
type Action = "connect" | "test" | "sync" | "ari" | "rooms" | "rates" | "disconnect" | "retry" | "resolve" | null;
type RateDraft = { externalId: string; externalName: string; currency: string; pricingMode: "BASE" | "FIXED" | "OFFSET" | "MULTIPLIER"; pricingValue: string };
type DateOverrideDraft = { id: string; from: string; to: string; price: string; closed: boolean; minimumStay: string; maximumStay: string; closedOnArrival: boolean; closedOnDeparture: boolean };

const PROVIDERS: Record<ProviderCode, { name: string; slug: string; subtitle: string; propertyLabel: string; roomLabel: string; rateLabel: string; color: string }> = {
  EXPEDIA: { name: "Expedia Group", slug: "expedia", subtitle: "Reservations, rates and inventory", propertyLabel: "Expedia property ID", roomLabel: "Expedia room type ID", rateLabel: "Expedia rate plan ID", color: "bg-[#172f5f]" },
  BOOKING_COM: { name: "Booking.com", slug: "booking-com", subtitle: "Connection retained for reopening", propertyLabel: "Booking.com hotel ID", roomLabel: "Booking.com room ID", rateLabel: "Booking.com rate plan ID", color: "bg-[#003b95]" },
  AIRBNB: { name: "Airbnb", slug: "ical", subtitle: "Calendar sync, availability only", propertyLabel: "Airbnb listing ID", roomLabel: "Airbnb listing ID", rateLabel: "Not applicable", color: "bg-[#ff385c]" },
};

/**
 * Providers connected by calendar link rather than by API credentials. They
 * have no mappings, no rate push and no command centre, so the page hands the
 * whole panel over to the calendar component instead.
 */
const CALENDAR_PROVIDERS = new Set<ProviderCode>(["AIRBNB"]);

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not yet";
}

function statusMeta(status: string, held = false) {
  if (held) return { label: "On hold", className: "bg-amber-50 text-amber-800", dotClass: "bg-amber-500" };
  if (status === "ACTIVE") return { label: "Connected", className: "bg-emerald-50 text-emerald-700", dotClass: "bg-emerald-500" };
  if (status === "ERROR") return { label: "Needs attention", className: "bg-red-50 text-red-700", dotClass: "bg-red-500" };
  if (status === "DISCONNECTED") return { label: "Disconnected", className: "bg-neutral-100 text-neutral-600", dotClass: "bg-neutral-400" };
  return { label: status === "NOT_CONNECTED" ? "Not connected" : status.replaceAll("_", " "), className: "bg-neutral-100 text-neutral-600", dotClass: "bg-neutral-400" };
}

export default function NrmsChannelsPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [providerCode, setProviderCode] = useState<ProviderCode>("EXPEDIA");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [bookingPaused, setBookingPaused] = useState(true);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [commandCenter, setCommandCenter] = useState<CommandCenter | null>(null);
  const [externalPropertyId, setExternalPropertyId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [roomExternalIds, setRoomExternalIds] = useState<Record<number, string>>({});
  const [rateDrafts, setRateDrafts] = useState<Record<number, RateDraft>>({});
  const [dateOverrides, setDateOverrides] = useState<DateOverrideDraft[]>([]);
  const [minimumStay, setMinimumStay] = useState("");
  const [maximumStay, setMaximumStay] = useState("");
  const [closedOnArrival, setClosedOnArrival] = useState(false);
  const [closedOnDeparture, setClosedOnDeparture] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const config = PROVIDERS[providerCode];
  const isCalendarProvider = CALENDAR_PROVIDERS.has(providerCode);
  const channel = channels.find((item) => item.provider?.code === providerCode) ?? null;
  const connected = channel?.status === "ACTIVE" || channel?.status === "PILOT";
  const held = providerCode === "BOOKING_COM" && bookingPaused && !channel;
  const meta = statusMeta(channel?.status ?? "NOT_CONNECTED", held);
  const mappedRoomCount = useMemo(() => roomTypes.filter((room) => roomExternalIds[room.id]?.trim()).length, [roomExternalIds, roomTypes]);
  const connectedChannelCount = channels.filter((item) => item.status === "ACTIVE" || item.status === "PILOT").length;
  const baseUrl = selectedPropertyId ? `/api/owner/nrms/channels/${selectedPropertyId}/${config.slug}` : "";

  const applyProviderState = useCallback((nextChannels: Channel[], nextRooms: RoomType[], code: ProviderCode) => {
    const nextChannel = nextChannels.find((item) => item.provider?.code === code) ?? null;
    setExternalPropertyId(nextChannel?.externalPropertyId ?? nextChannel?.propertyMapping?.externalId ?? "");
    setRoomExternalIds(Object.fromEntries(nextRooms.map((room) => [room.id, nextChannel?.roomMappings.find((mapping) => mapping.roomTypeId === room.id)?.externalId ?? ""])));
    setRateDrafts(Object.fromEntries(nextRooms.map((room) => {
      const existing = nextChannel?.rateMappings.find((mapping) => mapping.roomTypeId === room.id && mapping.status === "MAPPED");
      return [room.id, { externalId: existing?.externalId ?? "", externalName: existing?.externalName ?? "", currency: existing?.currency ?? "TZS", pricingMode: existing?.ariPolicy?.pricingMode ?? "BASE", pricingValue: existing?.ariPolicy?.pricingValue == null ? "" : String(existing.ariPolicy.pricingValue) }];
    })));
    const policy = nextChannel?.rateMappings.find((mapping) => mapping.status === "MAPPED")?.ariPolicy;
    setMinimumStay(policy?.minimumStay == null ? "" : String(policy.minimumStay));
    setMaximumStay(policy?.maximumStay == null ? "" : String(policy.maximumStay));
    setClosedOnArrival(policy?.closedOnArrival === true);
    setClosedOnDeparture(policy?.closedOnDeparture === true);
    setDateOverrides((policy?.dateOverrides ?? []).map((override, index) => ({ id: `${override.from}:${override.to}:${index}`, from: override.from, to: override.to, price: override.price == null ? "" : String(override.price), closed: override.closed === true, minimumStay: override.minimumStay == null ? "" : String(override.minimumStay), maximumStay: override.maximumStay == null ? "" : String(override.maximumStay), closedOnArrival: override.closedOnArrival === true, closedOnDeparture: override.closedOnDeparture === true })));
  }, []);

  const load = useCallback(async () => {
    if (!selectedPropertyId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const provider = PROVIDERS[providerCode];
      const [channelResponse, roomResponse, commandResponse] = await Promise.all([
        apiClient.get<any>(`/api/owner/nrms/channels/${selectedPropertyId}`),
        apiClient.get<any>(`/api/owner/nrms/rooms/${selectedPropertyId}`),
        // A calendar connection has no command centre to read, and asking for
        // one would fail the whole load.
        CALENDAR_PROVIDERS.has(providerCode)
          ? Promise.resolve(null)
          : apiClient.get<any>(`/api/owner/nrms/channels/${selectedPropertyId}/${provider.slug}/command-center`),
      ]);
      const nextChannels = (channelResponse.data?.channels ?? []) as Channel[];
      const nextRooms = (roomResponse.data?.roomTypes ?? []) as RoomType[];
      setChannels(nextChannels);
      setRoomTypes(nextRooms);
      setBookingPaused(channelResponse.data?.bookingCom?.onboardingPaused !== false);
      setCommandCenter(commandResponse?.data?.summary ? commandResponse.data as CommandCenter : null);
      applyProviderState(nextChannels, nextRooms, providerCode);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Failed to load OTA channel settings");
    } finally { setLoading(false); }
  }, [applyProviderState, providerCode, selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (next: Exclude<Action, null>, request: () => Promise<void>) => {
    setAction(next); setError(null); setNotice(null);
    try { await request(); await load(); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || "The OTA request could not be completed"); }
    finally { setAction(null); }
  };

  const connect = async () => {
    if (!selectedPropertyId) return;
    if (held) { setError("Booking.com is not accepting new connectivity providers. The prepared connector remains locked until applications reopen."); return; }
    if (!externalPropertyId.trim() || !username.trim() || !password) { setError(`Enter the ${config.propertyLabel.toLowerCase()}, API username, and password.`); return; }
    await run("connect", async () => {
      const payload = providerCode === "EXPEDIA"
        ? { expediaPropertyId: externalPropertyId.trim(), username: username.trim(), password }
        : { hotelId: Number(externalPropertyId), clientId: username.trim(), clientSecret: password };
      await apiClient.post(baseUrl, payload);
      setPassword("");
      setNotice(`${config.name} access was verified. Map rooms and rate plans before sending live inventory.`);
    });
  };

  const saveRooms = async () => {
    const mappings = roomTypes.map((room) => ({ roomTypeId: room.id, externalId: roomExternalIds[room.id]?.trim() ?? "" })).filter((mapping) => mapping.externalId);
    if (!mappings.length) { setError(`Enter at least one ${config.roomLabel}.`); return; }
    await run("rooms", async () => { await apiClient.post(`${baseUrl}/mappings/rooms`, { mappings }); setNotice(`${mappings.length} room mapping${mappings.length === 1 ? "" : "s"} saved.`); });
  };

  const saveRates = async () => {
    const configuredRates = roomTypes.map((room) => ({ roomTypeId: room.id, ...rateDrafts[room.id] })).filter((mapping) => mapping.externalId?.trim());
    if (configuredRates.some((mapping) => mapping.pricingMode !== "BASE" && !mapping.pricingValue.trim())) { setError("Enter a pricing value for every derived or fixed rate plan."); return; }
    const overrides = dateOverrides.filter((override) => override.from && override.to).map((override) => ({ from: override.from, to: override.to, price: override.price ? Number(override.price) : null, closed: override.closed, minimumStay: override.minimumStay ? Number(override.minimumStay) : null, maximumStay: override.maximumStay ? Number(override.maximumStay) : null, closedOnArrival: override.closedOnArrival, closedOnDeparture: override.closedOnDeparture }));
    const mappings = configuredRates.map((mapping) => ({ roomTypeId: mapping.roomTypeId, externalId: mapping.externalId.trim(), externalName: mapping.externalName?.trim() || null, currency: (mapping.currency || "TZS").toUpperCase(), ariPolicy: { pricingMode: mapping.pricingMode, pricingValue: mapping.pricingMode === "BASE" ? null : Number(mapping.pricingValue), dateOverrides: overrides, minimumStay: minimumStay ? Number(minimumStay) : null, maximumStay: maximumStay ? Number(maximumStay) : null, closedOnArrival, closedOnDeparture } }));
    if (!mappings.length) { setError(`Enter at least one ${config.rateLabel}.`); return; }
    await run("rates", async () => { await apiClient.post(`${baseUrl}/mappings/rates`, { mappings }); setNotice(`${mappings.length} room-rate mapping${mappings.length === 1 ? "" : "s"} saved.`); });
  };

  if (!selectedPropertyId) return <p className="py-10 text-center text-sm text-neutral-500">Add a property first to configure OTA channels.</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS integrations</p><h1 className="m-0 text-2xl font-bold tracking-tight text-neutral-950">OTA channels</h1><p className="mb-0 mt-1 max-w-2xl text-sm text-neutral-500">One inventory truth, provider-specific credentials and mappings, and visible delivery evidence.</p></div>
        <button type="button" onClick={() => void load()} disabled={loading || action !== null} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </header>

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div>
            <h2 className="m-0 text-sm font-bold text-neutral-950">Channel connections</h2>
            <p className="mb-0 mt-0.5 text-xs text-neutral-500">Select a provider to manage its connection, mappings and synchronization.</p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((slot) => <span key={slot} className={`h-1.5 w-6 rounded-full transition-colors ${slot < connectedChannelCount ? "bg-emerald-500" : "bg-neutral-200"}`} />)}
            </div>
            <p className="m-0 text-xs font-semibold text-neutral-500"><span className="text-neutral-900">{connectedChannelCount}</span> of 3 connected</p>
          </div>
        </div>
        <nav className="grid gap-3 border-t border-neutral-200 bg-neutral-50/60 p-4 sm:grid-cols-2 lg:grid-cols-3 sm:p-5" aria-label="OTA providers" role="tablist">
          {(["EXPEDIA", "BOOKING_COM", "AIRBNB"] as ProviderCode[]).map((code) => {
            const provider = PROVIDERS[code];
            const connection = channels.find((item) => item.provider?.code === code);
            const providerHeld = code === "BOOKING_COM" && bookingPaused && !connection;
            const state = statusMeta(connection?.status ?? "NOT_CONNECTED", providerHeld);
            const selected = providerCode === code;
            const metaLine = providerHeld
              ? "Retained for reopening"
              : connection?.status === "ERROR"
                ? CALENDAR_PROVIDERS.has(code) ? "Calendar needs attention" : "Delivery needs attention"
                : connection && connection.lastSuccessAt
                  ? `Synced ${formatDate(connection.lastSuccessAt)}`
                  : CALENDAR_PROVIDERS.has(code) ? "Connect by calendar link" : "Not linked yet";
            return <button
              key={code}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => { setProviderCode(code); setError(null); setNotice(null); }}
              className={`group relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-white p-4 text-left transition-all ${selected ? "border-neutral-900 shadow-md ring-1 ring-neutral-900" : "border-neutral-200 shadow-sm hover:border-neutral-300 hover:shadow-md"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${provider.color}`}><Link2 className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-bold text-neutral-950">{provider.name}</p>
                    <p className="mb-0 mt-0.5 truncate text-xs text-neutral-500">{provider.subtitle}</p>
                  </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${state.className}`}><span className={`h-1.5 w-1.5 rounded-full ${state.dotClass}`} />{state.label}</span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-2.5">
                <span className="min-w-0 truncate text-[11px] text-neutral-500">{metaLine}</span>
                <span className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold transition-colors ${selected ? "text-neutral-900" : "text-neutral-400 group-hover:text-neutral-700"}`}>Manage<ChevronRight className="h-3.5 w-3.5" /></span>
              </div>
            </button>;
          })}
        </nav>
      </section>

      {error && <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-100 p-5 sm:p-6">
          <div className="flex items-start gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-md text-white ${config.color}`}><Link2 className="h-5 w-5" /></span><div><h2 className="m-0 text-lg font-bold text-neutral-950">{config.name}</h2><p className="mb-0 mt-1 text-xs text-neutral-500">{config.subtitle}</p></div></div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${meta.className}`}>{loading ? "Loading…" : meta.label}</span>
        </div>

        {isCalendarProvider ? <CalendarFeeds propertyId={selectedPropertyId} providerCode={providerCode} providerName={config.name} onConnectionChange={load} /> : !connected ? <div className="p-5 sm:p-6">
          {held && <div className="mb-5 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" /><div><p className="m-0 text-sm font-bold text-amber-950">New Booking.com connections are paused</p><p className="mb-0 mt-1 text-xs leading-5 text-amber-900/80">The setup remains visible and locked so NRMS can resume from this point when provider intake reopens.</p></div></div>}
          {providerCode === "EXPEDIA" && <div className="mb-5 flex flex-wrap items-start gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" /><p className="m-0 min-w-0 flex-1 text-xs leading-5 text-neutral-600"><span className="font-bold text-neutral-800">Defined scope:</span> Lodging Supply GraphQL reservations and webhooks, XML Availability and Rates, and Property Status verification. Expedia Rapid is not used.</p><span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">Pilot access required</span></div>}
          <fieldset disabled={held} className="m-0 border-0 p-0">
            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <label className="block min-w-0 text-xs font-bold text-neutral-700">{config.propertyLabel}<input value={externalPropertyId} onChange={(event) => setExternalPropertyId(event.target.value)} placeholder="Provider property identifier" className="mt-1.5 box-border h-10 w-full min-w-0 rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:text-neutral-400" /></label>
              <label className="block min-w-0 text-xs font-bold text-neutral-700">{providerCode === "EXPEDIA" ? "API username" : "Client ID"}<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" placeholder={providerCode === "EXPEDIA" ? "Usually prefixed EQC" : "Machine account client ID"} className="mt-1.5 box-border h-10 w-full min-w-0 rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:text-neutral-400" /></label>
              <label className="block min-w-0 text-xs font-bold text-neutral-700">{providerCode === "EXPEDIA" ? "API password" : "Client secret"}<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="Stored encrypted after verification" className="mt-1.5 box-border h-10 w-full min-w-0 rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:text-neutral-400" /></label>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4"><p className="m-0 flex items-center gap-2 text-xs text-neutral-500"><LockKeyhole className="h-4 w-4" />Credentials are verified server-side and encrypted before storage.</p><button type="button" onClick={() => void connect()} disabled={action !== null || held} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-5 text-xs font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500">{action === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} {held ? "Connect when available" : "Verify and connect"}</button></div>
          </fieldset>
        </div> : <div className="p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="border border-neutral-100 bg-neutral-50 p-3"><p className="m-0 text-[11px] font-semibold text-neutral-500">Property ID</p><p className="mb-0 mt-1 text-sm font-bold text-neutral-900">{channel?.externalPropertyId ?? "—"}</p></div><div className="border border-neutral-100 bg-neutral-50 p-3"><p className="m-0 text-[11px] font-semibold text-neutral-500">Trust tier</p><p className="mb-0 mt-1 text-sm font-bold text-neutral-900">{channel?.trustTier ?? "—"}</p></div><div className="border border-neutral-100 bg-neutral-50 p-3"><p className="m-0 text-[11px] font-semibold text-neutral-500">Last success</p><p className="mb-0 mt-1 text-sm font-bold text-neutral-900">{formatDate(channel?.lastSuccessAt ?? null)}</p></div><div className="flex items-center justify-between border border-neutral-200 p-3"><div><p className="m-0 text-[11px] font-semibold text-neutral-500">Credentials</p><p className="mb-0 mt-1 text-sm font-bold text-emerald-700">Encrypted and active</p></div><LockKeyhole className="h-4 w-4 text-emerald-700" /></div></div>
          {channel?.lastErrorMessage && <p className="mt-4 text-xs text-red-700">Last provider error: {channel.lastErrorMessage}</p>}
          <div className="mt-5 flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
            <button type="button" onClick={() => void run("test", async () => { await apiClient.post(`${baseUrl}/test`); setNotice(`${config.name} GraphQL/property access passed.`); })} disabled={action !== null} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">{action === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Test connection</button>
            <button type="button" onClick={() => void run("sync", async () => { const response = await apiClient.post<any>(`${baseUrl}/sync/reservations`); setNotice(`Reservation sync: ${response.data?.result?.processed ?? 0} processed, ${response.data?.result?.failed ?? 0} failed.`); })} disabled={action !== null} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">{action === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync reservations</button>
            <button type="button" onClick={() => void run("ari", async () => { const response = await apiClient.post<any>(`${baseUrl}/sync/ari`); setNotice(`ARI resync queued ${response.data?.queued ?? 0} batches; ${response.data?.delivery?.acknowledged ?? 0} delivered immediately.`); })} disabled={action !== null || (providerCode === "EXPEDIA" && channel?.ariEndpointConfigured === false)} title={providerCode === "EXPEDIA" && channel?.ariEndpointConfigured === false ? "Available after Expedia assigns the ARI endpoint" : undefined} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 text-xs font-bold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50">{action === "ari" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {providerCode === "EXPEDIA" && channel?.ariEndpointConfigured === false ? "Awaiting Expedia ARI" : "Sync rates and restrictions"}</button>
            <button type="button" onClick={() => { if (window.confirm(`Disconnect ${config.name} for this property?`)) void run("disconnect", async () => { await apiClient.post(`${baseUrl}/disconnect`); setNotice(`${config.name} disconnected and credentials revoked.`); }); }} disabled={action !== null} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">{action === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />} Disconnect</button>
          </div>
        </div>}
      </section>

      {connected && !isCalendarProvider && <>
        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="m-0 text-base font-bold text-neutral-950">Room mapping</h2><p className="mb-0 mt-1 text-sm text-neutral-500">Match every NRMS room type to the exact provider unit ID.</p></div><span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold text-neutral-600">{mappedRoomCount}/{roomTypes.length} mapped</span></div><div className="mt-5 divide-y divide-neutral-100 border-y border-neutral-100">{roomTypes.map((room) => <div key={room.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center"><div><p className="m-0 text-sm font-bold text-neutral-900">{room.name}</p><p className="mb-0 mt-0.5 text-xs text-neutral-500">{room.units?.length ?? 0} NRMS units</p></div><input value={roomExternalIds[room.id] ?? ""} onChange={(event) => setRoomExternalIds((current) => ({ ...current, [room.id]: event.target.value }))} placeholder={config.roomLabel} className="min-h-10 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /><span className={`text-xs font-bold ${roomExternalIds[room.id]?.trim() ? "text-emerald-700" : "text-amber-700"}`}>{roomExternalIds[room.id]?.trim() ? "Ready" : "Needs ID"}</span></div>)}</div><div className="mt-4 flex justify-end"><button type="button" onClick={() => void saveRooms()} disabled={action !== null || !roomTypes.length} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50">{action === "rooms" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save room mappings</button></div></section>

        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-indigo-50 text-indigo-700"><Link2 className="h-4 w-4" /></span>
            <div><h2 className="m-0 text-base font-bold text-neutral-950">Room and rate mapping</h2><p className="mb-0 mt-1 text-sm text-neutral-500">Map provider rate plans and define how each price is calculated from the NRMS room rate.</p></div>
          </div>
          <div className="mt-5 divide-y divide-neutral-100 border-y border-neutral-100">
            {roomTypes.map((room) => {
              const draft = rateDrafts[room.id] ?? { externalId: "", externalName: "", currency: "TZS", pricingMode: "BASE" as const, pricingValue: "" };
              const valueLabel = draft.pricingMode === "FIXED" ? "Fixed amount" : draft.pricingMode === "OFFSET" ? "Amount to add" : draft.pricingMode === "MULTIPLIER" ? "Multiplier" : "Uses room base rate";
              return <div key={room.id} className="grid gap-3 py-4 md:grid-cols-2 xl:grid-cols-[minmax(140px,.8fr)_1fr_1fr_90px_150px_140px] xl:items-end">
                <div><p className="m-0 text-sm font-bold text-neutral-900">{room.name}</p><p className="mb-0 mt-1 text-[11px] text-neutral-500">Unit: {roomExternalIds[room.id]?.trim() || "not mapped"}</p></div>
                <label className="block text-xs font-bold text-neutral-700">Rate plan ID<input value={draft.externalId} onChange={(event) => setRateDrafts((current) => ({ ...current, [room.id]: { ...draft, externalId: event.target.value } }))} placeholder={config.rateLabel} className="mt-1.5 min-h-10 w-full rounded-md border border-neutral-200 px-3 text-sm font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /></label>
                <label className="block text-xs font-bold text-neutral-700">Rate plan name<input value={draft.externalName} onChange={(event) => setRateDrafts((current) => ({ ...current, [room.id]: { ...draft, externalName: event.target.value } }))} placeholder="Standard flexible" className="mt-1.5 min-h-10 w-full rounded-md border border-neutral-200 px-3 text-sm font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /></label>
                <label className="block text-xs font-bold text-neutral-700">Currency<input value={draft.currency} onChange={(event) => setRateDrafts((current) => ({ ...current, [room.id]: { ...draft, currency: event.target.value.toUpperCase().slice(0, 3) } }))} maxLength={3} className="mt-1.5 min-h-10 w-full rounded-md border border-neutral-200 px-3 text-sm font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /></label>
                <label className="block text-xs font-bold text-neutral-700">Pricing rule<select value={draft.pricingMode} onChange={(event) => setRateDrafts((current) => ({ ...current, [room.id]: { ...draft, pricingMode: event.target.value as RateDraft["pricingMode"], pricingValue: event.target.value === "BASE" ? "" : draft.pricingValue } }))} className="mt-1.5 min-h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm font-normal"><option value="BASE">Room base rate</option><option value="FIXED">Fixed price</option><option value="OFFSET">Base plus amount</option><option value="MULTIPLIER">Base multiplied</option></select></label>
                <label className="block text-xs font-bold text-neutral-700">{valueLabel}<input type="number" step={draft.pricingMode === "MULTIPLIER" ? "0.01" : "0.01"} value={draft.pricingValue} disabled={draft.pricingMode === "BASE"} onChange={(event) => setRateDrafts((current) => ({ ...current, [room.id]: { ...draft, pricingValue: event.target.value } }))} className="mt-1.5 min-h-10 w-full rounded-md border border-neutral-200 px-3 text-sm font-normal disabled:bg-neutral-100 disabled:text-neutral-400" /></label>
              </div>;
            })}
          </div>
          <div className="mt-4 border border-neutral-100 bg-neutral-50 p-4">
            <p className="m-0 text-xs font-bold text-neutral-800">Default provider restrictions</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-xs font-semibold text-neutral-600">Minimum stay<input value={minimumStay} onChange={(event) => setMinimumStay(event.target.value.replace(/\D/g, ""))} inputMode="numeric" className="mt-1.5 min-h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm font-normal" /></label>
              <label className="block text-xs font-semibold text-neutral-600">Maximum stay<input value={maximumStay} onChange={(event) => setMaximumStay(event.target.value.replace(/\D/g, ""))} inputMode="numeric" className="mt-1.5 min-h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm font-normal" /></label>
              <label className="flex min-h-10 items-center gap-2 self-end rounded-md border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"><input type="checkbox" checked={closedOnArrival} onChange={(event) => setClosedOnArrival(event.target.checked)} /> Closed on arrival</label>
              <label className="flex min-h-10 items-center gap-2 self-end rounded-md border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"><input type="checkbox" checked={closedOnDeparture} onChange={(event) => setClosedOnDeparture(event.target.checked)} /> Closed on departure</label>
            </div>
          </div>
          {providerCode === "EXPEDIA" && <div className="mt-4 border border-neutral-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="m-0 text-xs font-bold text-neutral-800">Date specific pricing and restrictions</p><p className="mb-0 mt-1 text-[11px] text-neutral-500">Overrides are applied to every mapped Expedia rate plan for the selected dates.</p></div><button type="button" onClick={() => setDateOverrides((current) => [...current, { id: `${Date.now()}:${current.length}`, from: "", to: "", price: "", closed: false, minimumStay: "", maximumStay: "", closedOnArrival: false, closedOnDeparture: false }])} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-700"><Plus className="h-3.5 w-3.5" /> Add date range</button></div>
            <div className="mt-3 space-y-3">{dateOverrides.length ? dateOverrides.map((override) => <div key={override.id} className="grid gap-3 border border-neutral-100 bg-neutral-50 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_90px_90px_auto] lg:items-end">
              <label className="text-[11px] font-semibold text-neutral-600">From<input type="date" value={override.from} onChange={(event) => setDateOverrides((current) => current.map((item) => item.id === override.id ? { ...item, from: event.target.value } : item))} className="mt-1 min-h-10 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs" /></label>
              <label className="text-[11px] font-semibold text-neutral-600">To<input type="date" value={override.to} onChange={(event) => setDateOverrides((current) => current.map((item) => item.id === override.id ? { ...item, to: event.target.value } : item))} className="mt-1 min-h-10 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs" /></label>
              <label className="text-[11px] font-semibold text-neutral-600">Exact nightly price<input type="number" min="0" step="0.01" value={override.price} onChange={(event) => setDateOverrides((current) => current.map((item) => item.id === override.id ? { ...item, price: event.target.value } : item))} placeholder="Optional" className="mt-1 min-h-10 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs" /></label>
              <label className="text-[11px] font-semibold text-neutral-600">Min stay<input inputMode="numeric" value={override.minimumStay} onChange={(event) => setDateOverrides((current) => current.map((item) => item.id === override.id ? { ...item, minimumStay: event.target.value.replace(/\D/g, "") } : item))} className="mt-1 min-h-10 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs" /></label>
              <label className="text-[11px] font-semibold text-neutral-600">Max stay<input inputMode="numeric" value={override.maximumStay} onChange={(event) => setDateOverrides((current) => current.map((item) => item.id === override.id ? { ...item, maximumStay: event.target.value.replace(/\D/g, "") } : item))} className="mt-1 min-h-10 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs" /></label>
              <button type="button" aria-label="Remove date override" onClick={() => setDateOverrides((current) => current.filter((item) => item.id !== override.id))} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-100 bg-white text-red-700"><Trash2 className="h-4 w-4" /></button>
              <div className="flex flex-wrap gap-3 sm:col-span-2 lg:col-span-6"><label className="flex items-center gap-2 text-[11px] font-semibold text-neutral-600"><input type="checkbox" checked={override.closed} onChange={(event) => setDateOverrides((current) => current.map((item) => item.id === override.id ? { ...item, closed: event.target.checked } : item))} /> Stop sell</label><label className="flex items-center gap-2 text-[11px] font-semibold text-neutral-600"><input type="checkbox" checked={override.closedOnArrival} onChange={(event) => setDateOverrides((current) => current.map((item) => item.id === override.id ? { ...item, closedOnArrival: event.target.checked } : item))} /> Closed on arrival</label><label className="flex items-center gap-2 text-[11px] font-semibold text-neutral-600"><input type="checkbox" checked={override.closedOnDeparture} onChange={(event) => setDateOverrides((current) => current.map((item) => item.id === override.id ? { ...item, closedOnDeparture: event.target.checked } : item))} /> Closed on departure</label></div>
            </div>) : <p className="m-0 border border-neutral-200 p-4 text-center text-xs text-neutral-500">No date overrides configured. Expedia will use each rate plan&apos;s pricing rule and default restrictions.</p>}</div>
          </div>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="m-0 flex items-center gap-2 text-xs text-neutral-500"><CircleHelp className="h-4 w-4" />IDs must come from the property&apos;s provider connectivity account.</p><button type="button" onClick={() => void saveRates()} disabled={action !== null} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50">{action === "rates" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save rate mappings</button></div>
        </section>
      </>}

      {connected && !isCalendarProvider && commandCenter && <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"><div><p className="mb-1 text-[11px] font-bold uppercase tracking-[.14em] text-indigo-700">Operations</p><h2 className="m-0 text-lg font-bold text-neutral-950">Sync command center</h2><p className="mb-0 mt-1 text-sm text-neutral-500">Provider-specific queues, reconciliation evidence, and safe recovery controls.</p></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Inbound failed", commandCenter.summary.inbound.FAILED ?? 0, "text-red-700"], ["Outbound pending", (commandCenter.summary.outbound.PENDING ?? 0) + (commandCenter.summary.outbound.SENDING ?? 0), "text-amber-700"], ["Dead letters", commandCenter.summary.outbound.DEAD_LETTER ?? 0, "text-red-700"], ["Open issues", commandCenter.summary.openIssues, "text-indigo-700"]].map(([label, value, color]) => <div key={String(label)} className="border border-neutral-100 bg-neutral-50 p-3"><p className="m-0 text-[11px] font-semibold text-neutral-500">{label}</p><p className={`mb-0 mt-1 text-xl font-bold ${color}`}>{value}</p></div>)}</div><div className="mt-5 grid gap-5 lg:grid-cols-2"><div><h3 className="m-0 text-sm font-bold">Recent sync runs</h3><div className="mt-2 divide-y divide-neutral-100 border border-neutral-100">{commandCenter.runs.length ? commandCenter.runs.slice(0, 6).map((runItem) => <div key={runItem.id} className="flex items-center justify-between gap-3 p-3"><div><p className="m-0 text-xs font-bold">{runItem.kind.replaceAll("_", " ")}</p><p className="mb-0 mt-1 text-[11px] text-neutral-500">{formatDate(runItem.startedAt)} · {runItem.successCount} passed · {runItem.failureCount} failed</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${runItem.status === "SUCCEEDED" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{runItem.status}</span></div>) : <p className="m-0 p-4 text-xs text-neutral-500">No sync runs yet.</p>}</div></div><div><h3 className="m-0 text-sm font-bold">Open issues</h3><div className="mt-2 divide-y divide-neutral-100 border border-neutral-100">{commandCenter.issues.length ? commandCenter.issues.slice(0, 6).map((issue) => <div key={issue.id} className="flex items-center justify-between gap-3 p-3"><div className="min-w-0"><p className="m-0 truncate text-xs font-bold">{issue.kind.replaceAll("_", " ")}</p><p className="mb-0 mt-1 truncate text-[11px] text-neutral-500">{issue.externalRef ?? issue.internalRef ?? "No reference"} · {formatDate(issue.lastSeenAt)}</p></div><button type="button" onClick={() => void run("resolve", async () => { await apiClient.post(`${baseUrl}/command-center/issues/${issue.id}/resolve`); setNotice("Issue marked resolved."); })} disabled={action !== null} className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-[10px] font-bold">Resolve</button></div>) : <p className="m-0 p-4 text-xs text-emerald-700">No open issues.</p>}</div></div></div>{commandCenter.deliveries.filter((delivery) => ["FAILED", "DEAD_LETTER"].includes(delivery.status)).map((delivery) => <div key={delivery.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-red-100 bg-red-50/50 p-3"><div><p className="m-0 text-xs font-bold">{delivery.eventType.replaceAll("_", " ")} · attempt {delivery.attemptCount}</p><p className="mb-0 mt-1 text-[11px] text-red-700">{delivery.lastError ?? "Delivery failed"}</p></div><button type="button" onClick={() => void run("retry", async () => { await apiClient.post(`${baseUrl}/command-center/deliveries/${delivery.id}/retry`); setNotice("Delivery returned to the retry queue."); })} className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-[10px] font-bold text-amber-800"><RefreshCw className="h-3.5 w-3.5" /> Retry</button></div>)}</section>}

      {providerCode === "EXPEDIA" && !connected && <section className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-5 text-sm text-sky-900"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" /><div><p className="m-0 font-bold">Expedia is being activated</p><p className="mb-0 mt-1 text-sky-800">Your setup is ready, but bookings will not sync until we finish activating Expedia for this property. We will let you know the moment it goes live. No action is needed from you right now.</p></div></section>}
      {!connected && !loading && <p className="m-0 text-xs text-neutral-400">Property: {selectedProperty?.title ?? "NRMS property"}</p>}
    </div>
  );
}
