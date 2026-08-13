"use client";

// Calendar (iCal) channel panel.
//
// Airbnb has no self-serve API, so a property connects it the way Airbnb
// actually allows: two links per listing. NRMS polls theirs to learn which
// nights are gone, and publishes one of its own for Airbnb to poll back.
// Everything here is per room type, because that is what a listing maps to.

import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  CheckCircle2,
  Clock,
  Copy,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

type Feed = {
  id: number;
  direction: "IMPORT" | "EXPORT";
  status: string;
  roomTypeId: number | null;
  roomTypeName: string | null;
  label: string | null;
  exportBuffer: number;
  address: string | null;
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  nextPollAt: string | null;
  lastError: string | null;
  providerCode: string | null;
  providerName: string | null;
};
type RoomTypeOption = { id: number; name: string; capacity: number };

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not yet";
}

type CalendarFeedsProps = {
  propertyId: number;
  providerCode: string;
  providerName: string;
  onConnectionChange?: () => Promise<void> | void;
};

export default function CalendarFeeds({ propertyId, providerCode, providerName, onConnectionChange }: CalendarFeedsProps) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([]);
  const [roomTypeId, setRoomTypeId] = useState<number | "">("");
  const [importUrl, setImportUrl] = useState("");
  const [label, setLabel] = useState("");
  const [publishExport, setPublishExport] = useState(true);
  const [exportBuffer, setExportBuffer] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  // The margin can never reach capacity: holding back every room would close
  // the listing on the provider for good.
  const selectedCapacity = roomTypes.find((roomType) => roomType.id === roomTypeId)?.capacity ?? 0;
  const bufferChoices = Array.from({ length: Math.max(1, Math.min(selectedCapacity, 4)) }, (_, index) => index);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<any>(`/api/owner/nrms/channels/${propertyId}/ical`);
      setFeeds(((response.data?.feeds ?? []) as Feed[]).filter((feed) => feed.providerCode === providerCode));
      setRoomTypes((response.data?.roomTypes ?? []) as RoomTypeOption[]);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Failed to load calendar connections");
    } finally {
      setLoading(false);
    }
  }, [propertyId, providerCode]);

  useEffect(() => { void load(); }, [load]);

  // Switching to a smaller room type must not leave a margin behind that would
  // close its listing.
  useEffect(() => {
    setExportBuffer((current) => Math.min(current, Math.max(0, selectedCapacity - 1)));
  }, [selectedCapacity]);

  const act = async (key: string, request: () => Promise<string | null>) => {
    setBusy(key); setError(null); setNotice(null);
    try {
      const message = await request();
      await load();
      await onConnectionChange?.();
      if (message) setNotice(message);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "The calendar request could not be completed");
    } finally {
      setBusy(null);
    }
  };

  const attach = async () => {
    if (!roomTypeId) { setError("Choose which room type this listing is."); return; }
    if (!importUrl.trim() && !publishExport) { setError("Add the provider link, publish a calendar, or both."); return; }
    await act("attach", async () => {
      const response = await apiClient.post<any>(`/api/owner/nrms/channels/${propertyId}/ical/feeds`, {
        providerCode,
        roomTypeId: Number(roomTypeId),
        importUrl: importUrl.trim() || null,
        label: label.trim() || null,
        publishExport,
        exportBuffer,
      });
      setImportUrl(""); setLabel("");
      const first = response.data?.firstImport;
      if (first && typeof first === "object" && "created" in first) {
        return `Connected. First import held ${first.created} date range${first.created === 1 ? "" : "s"}${first.conflicts ? `, with ${first.conflicts} inventory conflict${first.conflicts === 1 ? "" : "s"} needing review` : ""}.`;
      }
      return "Calendar connected.";
    });
  };

  const copy = async (feed: Feed) => {
    if (!feed.address) return;
    try {
      await navigator.clipboard.writeText(feed.address);
      setCopied(feed.id);
      setTimeout(() => setCopied((current) => (current === feed.id ? null : current)), 2000);
    } catch {
      setError("Copying failed. Select the address and copy it by hand.");
    }
  };

  const grouped = roomTypes
    .map((roomType) => ({
      roomType,
      importFeed: feeds.find((feed) => feed.roomTypeId === roomType.id && feed.direction === "IMPORT") ?? null,
      exportFeed: feeds.find((feed) => feed.roomTypeId === roomType.id && feed.direction === "EXPORT") ?? null,
    }))
    .filter((row) => row.importFeed || row.exportFeed);

  const importCount = feeds.filter((feed) => feed.direction === "IMPORT").length;
  const exportCount = feeds.filter((feed) => feed.direction === "EXPORT").length;

  return (
    <div className="bg-neutral-50/60 p-4 sm:p-5 lg:p-6">
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <Clock className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-sm font-bold text-neutral-950">Calendar sync</p>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Every few hours</span>
            </div>
            <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">Availability dates only. No guest names, rates or booking details are shared.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4 border-t border-neutral-100 pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <div>
            <p className="m-0 text-base font-bold tabular-nums text-neutral-950">{importCount}</p>
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Imports</p>
          </div>
          <div>
            <p className="m-0 text-base font-bold tabular-nums text-neutral-950">{exportCount}</p>
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Published</p>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div className="mb-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-start gap-3 border-b border-neutral-100 px-4 py-4 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-950 text-white"><Plus className="h-4 w-4" /></span>
          <div>
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-400">New connection</p>
            <h3 className="mb-0 mt-0.5 text-base font-bold text-neutral-950">Connect a {providerName} listing</h3>
            <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">Match one listing to one NRMS room type, then exchange both calendar links.</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
          <div className="min-w-0 p-4 sm:p-5 lg:border-r lg:border-neutral-100">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff385c] text-[11px] font-bold text-white">1</span>
              <div>
                <p className="m-0 text-sm font-bold text-neutral-900">Import {providerName} availability</p>
                <p className="m-0 text-[11px] text-neutral-500">Blocks dates already booked on {providerName}.</p>
              </div>
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="block min-w-0 text-xs font-bold text-neutral-700" htmlFor="calendar-room-type">Room type
                <select id="calendar-room-type" value={roomTypeId} onChange={(event) => setRoomTypeId(event.target.value ? Number(event.target.value) : "")} className="mt-1.5 box-border h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10">
                  <option value="">Select room type</option>
                  {roomTypes.map((roomType) => <option key={roomType.id} value={roomType.id}>{roomType.name}</option>)}
                </select>
              </label>
              <label className="block min-w-0 text-xs font-bold text-neutral-700" htmlFor="calendar-listing-name">Listing name <span className="font-normal text-neutral-400">(optional)</span>
                <input id="calendar-listing-name" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Garden double room" className="mt-1.5 box-border h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
              </label>
              <label className="block min-w-0 text-xs font-bold text-neutral-700 sm:col-span-2" htmlFor="calendar-import-url">{providerName} export link
                <div className="relative mt-1.5">
                  <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input id="calendar-import-url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://www.airbnb.com/calendar/ical/..." className="box-border h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-white pl-10 pr-3 text-sm font-medium text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                </div>
                <span className="mt-1.5 block text-[11px] font-normal leading-4 text-neutral-400">In {providerName}: Calendar availability → Connect another website → Export calendar.</span>
              </label>
            </div>
          </div>

          <div className="bg-neutral-50/80 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-[11px] font-bold text-white">2</span>
              <div>
                <p className="m-0 text-sm font-bold text-neutral-900">Publish NRMS availability</p>
                <p className="m-0 text-[11px] text-neutral-500">Gives {providerName} your latest availability.</p>
              </div>
            </div>
            <button type="button" role="switch" aria-checked={publishExport} onClick={() => setPublishExport((current) => !current)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-neutral-300">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><ArrowUpFromLine className="h-4 w-4" /></span>
                <span>
                  <span className="block text-xs font-bold text-neutral-900">Publish calendar link</span>
                  <span className="mt-0.5 block text-[11px] text-neutral-500">Recommended for two-way protection</span>
                </span>
              </span>
              <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition ${publishExport ? "bg-emerald-700" : "bg-neutral-300"}`}>
                <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${publishExport ? "left-6" : "left-1"}`} />
              </span>
            </button>
            <div className={`mt-3 transition ${publishExport ? "opacity-100" : "pointer-events-none opacity-45"}`}>
              <label className="block text-xs font-bold text-neutral-700" htmlFor="calendar-safety-margin">Safety margin
                <select id="calendar-safety-margin" disabled={!publishExport} value={exportBuffer} onChange={(event) => setExportBuffer(Number(event.target.value))} className="mt-1.5 box-border h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed">
                  {bufferChoices.map((choice) => <option key={choice} value={choice}>{choice === 0 ? "No safety margin" : `Hold back ${choice} ${choice === 1 ? "room" : "rooms"}`}</option>)}
                </select>
              </label>
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[11px] leading-4 text-amber-900">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p className="m-0">{!roomTypeId
                  ? "Choose a room type to see the protection available."
                  : selectedCapacity <= 1
                    ? `No room can be held back for this type. ${providerName} may sell the last room before its next refresh.`
                    : exportBuffer === 0
                      ? `${providerName} can sell the final room. Add a margin to reduce delayed-sync risk.`
                      : `${providerName} stops selling when ${exportBuffer === 1 ? "one room is" : `${exportBuffer} rooms are`} left.`}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-neutral-100 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="m-0 flex items-center gap-2 text-[11px] leading-5 text-neutral-500"><ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" /> Calendar links are stored securely and used only for availability sync.</p>
          <button type="button" onClick={() => void attach()} disabled={busy !== null} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-neutral-950 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500">
            {busy === "attach" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Connect listing
          </button>
        </div>
      </section>

      <div className="mb-3 mt-6 flex items-end justify-between gap-3">
        <div>
          <h3 className="m-0 text-sm font-bold text-neutral-950">Connected listings</h3>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Monitor both calendar directions and resolve sync issues.</p>
        </div>
        {!loading && <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-bold text-neutral-600">{grouped.length} {grouped.length === 1 ? "listing" : "listings"}</span>}
      </div>
      <div className="space-y-3">
        {loading && <div className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white py-10 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading calendars…</div>}
        {!loading && !grouped.length && <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-5 py-10 text-center"><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-500"><CalendarDays className="h-5 w-5" /></span><p className="mb-0 mt-3 text-sm font-bold text-neutral-800">No connected listings</p><p className="mx-auto mb-0 mt-1 max-w-sm text-xs leading-5 text-neutral-500">Complete the two steps above to keep availability aligned with {providerName}.</p></div>}
        {grouped.map(({ roomType, importFeed, exportFeed }) => (
          <div key={roomType.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50/60 px-4 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-700 shadow-sm ring-1 ring-neutral-200"><CalendarDays className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold text-neutral-950">{roomType.name}</p>
                  <p className="mb-0 mt-0.5 text-xs text-neutral-500">{importFeed?.label || exportFeed?.label || `${providerName} listing`} · {roomType.capacity} {roomType.capacity === 1 ? "room" : "rooms"}</p>
                </div>
              </div>
              {importFeed?.lastError
                ? <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-700">Needs attention</span>
                : <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active</span>}
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500"><ArrowDownToLine className="h-3.5 w-3.5 text-[#d42f52]" />Imported from {providerName}</p>
                {importFeed ? <>
                  <p className="mb-0 mt-1.5 truncate text-xs text-neutral-600" title={importFeed.address ?? ""}>{importFeed.address ?? "Address unavailable"}</p>
                  <p className="mb-0 mt-1 text-[11px] text-neutral-500">Last read {formatDate(importFeed.lastSuccessAt)}. Next check {formatDate(importFeed.nextPollAt)}.</p>
                  {importFeed.lastError && <p className="mb-0 mt-1 text-[11px] font-semibold text-red-700">{importFeed.lastError}</p>}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void act(`poll-${importFeed.id}`, async () => { const response = await apiClient.post<any>(`/api/owner/nrms/channels/${propertyId}/ical/feeds/${importFeed.id}/poll`); const summary = response.data?.summary; return `Read now: ${summary?.created ?? 0} added, ${summary?.updated ?? 0} changed, ${summary?.cancelled ?? 0} released.`; })} disabled={busy !== null} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
                      {busy === `poll-${importFeed.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Read now
                    </button>
                    <button type="button" onClick={() => void act(`drop-${importFeed.id}`, async () => { await apiClient.delete(`/api/owner/nrms/channels/${propertyId}/ical/feeds/${importFeed.id}`); return "Import stopped. Existing availability holds stay in place."; })} disabled={busy !== null} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" /> Stop importing
                    </button>
                  </div>
                </> : <p className="mb-0 mt-1.5 text-xs text-neutral-500">Not importing. Paste the listing's export link above to block these dates automatically.</p>}
              </div>

              <div className="min-w-0">
                <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500"><ArrowUpFromLine className="h-3.5 w-3.5 text-emerald-700" />Published to {providerName}</p>
                {exportFeed ? <>
                  <p className="mb-0 mt-1.5 break-all text-xs text-neutral-600">{exportFeed.address ?? "Address unavailable"}</p>
                  <p className="mb-0 mt-1 text-[11px] text-neutral-500">
                    Paste this into the listing's calendar import settings. No guest details.
                    {exportFeed.exportBuffer > 0
                      ? ` Closes once ${exportFeed.exportBuffer === 1 ? "one room is" : `${exportFeed.exportBuffer} rooms are`} left, as a safety margin.`
                      : " Closes only when this type is completely full."}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copy(exportFeed)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-700 hover:bg-neutral-50">
                      <Copy className="h-3.5 w-3.5" /> {copied === exportFeed.id ? "Copied" : "Copy link"}
                    </button>
                    <button type="button" onClick={() => void act(`rotate-${exportFeed.id}`, async () => { await apiClient.post(`/api/owner/nrms/channels/${propertyId}/ical/feeds/${exportFeed.id}/rotate`); return "A new address was issued. Update it on the provider now, the old one has stopped working."; })} disabled={busy !== null} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                      {busy === `rotate-${exportFeed.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} New address
                    </button>
                    <button type="button" onClick={() => void act(`drop-${exportFeed.id}`, async () => { await apiClient.delete(`/api/owner/nrms/channels/${propertyId}/ical/feeds/${exportFeed.id}`); return "This room type is no longer published."; })} disabled={busy !== null} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" /> Stop publishing
                    </button>
                  </div>
                </> : <p className="mb-0 mt-1.5 text-xs text-neutral-500">Not published. {providerName} will keep selling nights this room type has already lost elsewhere.</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
