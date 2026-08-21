"use client";
// Agent portal — Book a stay. The agent picks an approved hotel, searches live
// availability at their negotiated rates, and books (request-to-book or instant).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { BadgeCheck, Ban, BedDouble, CalendarSearch, CheckCircle2, Clock, Handshake, Loader2, Minus, Plus, Search, ShieldAlert, Users, X } from "lucide-react";

type Hotel = { linkId: number; property: { id: number; title: string }; currency: string; bookingMode: string; ratePlans: number; prepayWindowMinutes: number };
type Invitation = { linkId: number; property: { id: number; title: string }; currency: string; bookingMode: string };
type OutgoingRequest = { linkId: number; requestedAt: string; property: { id: number; title: string }; hotelConsentStatus: string };
type Room = {
  roomType: { id: number; name: string; capacityAdults: number; capacityChildren: number };
  ratePlan: { id: number; name: string; refundable: boolean; mealPlan: string };
  currency: string; nightly: Array<{ date: string; rate: number }>; subtotal: number; tax: number; fees: number; total: number; available: number;
};

const money = (n: number) => Math.round(n).toLocaleString();
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (s: string, d: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + d * 86400000).toISOString().slice(0, 10);
const nights = (a: string, b: string) => Math.max(0, Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000));
const stayDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function GuestStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-500">{label}</span>
      <div className="flex h-10 items-center justify-between rounded-xl border border-solid border-neutral-200 bg-white px-1.5 shadow-sm">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="grid h-7 w-7 place-items-center rounded-lg border-0 bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-35" aria-label={`Remove one ${label.toLowerCase()}`}><Minus className="h-3 w-3" /></button>
        <span className="min-w-8 text-center text-sm font-extrabold tabular-nums text-neutral-900">{value}</span>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="grid h-7 w-7 place-items-center rounded-lg border-0 bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-35" aria-label={`Add one ${label.toLowerCase()}`}><Plus className="h-3 w-3" /></button>
      </div>
    </div>
  );
}

export default function AgentBookPage() {
  const [hotels, setHotels] = useState<Hotel[] | null>(null);
  const [canBook, setCanBook] = useState(true);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [awaitingApproval, setAwaitingApproval] = useState<Array<{ linkId: number; property: { id: number; title: string } }>>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingRequest[]>([]);
  const [hotelId, setHotelId] = useState<number | null>(null);
  const [q, setQ] = useState({ checkIn: addDays(todayStr(), 7), checkOut: addDays(todayStr(), 9), adults: 2, children: 0 });
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [completedBookingId, setCompletedBookingId] = useState<number | null>(null);
  const [booking, setBooking] = useState<Room | null>(null);

  const hotel = useMemo(() => hotels?.find((h) => h.linkId === hotelId) ?? null, [hotels, hotelId]);

  const loadHotels = useCallback(async (live = true) => {
      try {
        const res = await apiClient.get<any>("/api/agent-portal/hotels");
        if (!live) return;
        const nextHotels = (res.data?.hotels ?? []) as Hotel[];
        setHotels(nextHotels);
        setCanBook(res.data?.canBook ?? false);
        setInvitations(res.data?.invitations ?? []);
        setAwaitingApproval(res.data?.awaitingHotelApproval ?? []);
        setOutgoingRequests(res.data?.outgoingRequests ?? []);
        setHotelId((current) => current && nextHotels.some((entry) => entry.linkId === current) ? current : nextHotels[0]?.linkId ?? null);
      } catch (e: any) {
        if (live) setError(e?.response?.data?.error || "Failed to load your hotels");
      }
  }, []);

  useEffect(() => {
    let live = true;
    void loadHotels(live);
    return () => { live = false; };
  }, [loadHotels]);

  const decideInvitation = async (linkId: number, action: "accept" | "reject") => {
    setError(null);
    try {
      await apiClient.post(`/api/agent-portal/hotels/${linkId}/${action}`, {});
      setNotice(action === "accept" ? "Invitation accepted. The hotel can activate you after NoLSAF verification." : "Invitation declined.");
      await loadHotels();
    } catch (e: any) {
      setError(e?.response?.data?.error || "The invitation could not be updated");
    }
  };

  const search = useCallback(async () => {
    if (!hotelId) return;
    setSearching(true); setError(null); setRooms(null);
    try {
      const res = await apiClient.get<any>(`/api/agent-portal/hotels/${hotelId}/availability`, { params: q });
      setRooms(res.data?.rooms ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Availability could not be loaded");
    } finally {
      setSearching(false);
    }
  }, [hotelId, q]);

  const stayNights = nights(q.checkIn, q.checkOut);

  if (hotels === null) {
    return <div className="flex items-center gap-2 rounded-2xl border border-solid border-neutral-200 bg-white p-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  const invitationPanel = invitations.length > 0 ? (
    <section className="rounded-2xl border border-solid border-blue-200 bg-blue-50 p-4">
      <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-blue-900"><Handshake className="h-4 w-4" /> Hotel invitations</h2>
      <p className="m-0 mt-1 text-xs text-blue-700">Accept only hotels your agency intends to work with. Acceptance does not expose raw KYC documents.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{invitations.map((invitation) => <div key={invitation.linkId} className="rounded-xl border border-blue-100 bg-white p-3"><p className="m-0 text-sm font-bold text-neutral-900">{invitation.property.title}</p><p className="m-0 mt-1 text-[11px] text-neutral-500">{invitation.bookingMode === "INSTANT" ? "Instant confirmation" : "Request to book"} · {invitation.currency}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => void decideInvitation(invitation.linkId, "accept")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"><CheckCircle2 className="h-3.5 w-3.5" /> Accept</button><button type="button" onClick={() => void decideInvitation(invitation.linkId, "reject")} className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-bold text-neutral-600"><Ban className="h-3.5 w-3.5" /> Decline</button></div></div>)}</div>
    </section>
  ) : null;
  const outgoingPanel = outgoingRequests.length > 0 ? (
    <section className="rounded-2xl border border-solid border-cyan-200 bg-cyan-50 p-4">
      <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-cyan-900"><Handshake className="h-4 w-4" /> Partnership requests</h2>
      <p className="m-0 mt-1 text-xs text-cyan-700">Waiting for each hotel to review and explicitly approve your request.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{outgoingRequests.map((request) => <div key={request.linkId} className="rounded-xl border border-cyan-100 bg-white p-3"><p className="m-0 text-sm font-bold text-neutral-900">{request.property.title}</p><p className="m-0 mt-1 text-[11px] text-neutral-500">Requested {new Date(request.requestedAt).toLocaleDateString()} · Hotel decision pending</p></div>)}</div>
    </section>
  ) : null;

  if (!canBook) {
    return (
      <div className="flex flex-col gap-4">{invitationPanel}{outgoingPanel}<div className="rounded-2xl border border-solid border-amber-200 bg-amber-50 p-8 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-amber-500" />
        <p className="m-0 mt-2 text-[15px] font-bold text-amber-800">Your agency is awaiting NoLSAF verification</p>
        <p className="m-0 mt-1 text-[13px] text-amber-700">Once verified, the hotels that approved you will appear here and you can start booking.</p>
      </div></div>
    );
  }

  if (hotels.length === 0) {
    return (
      <div className="flex flex-col gap-4">{invitationPanel}{outgoingPanel}{awaitingApproval.length > 0 && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">Awaiting hotel activation: {awaitingApproval.map((row) => row.property.title).join(", ")}.</div>}<div className="rounded-2xl border border-dashed border-solid border-neutral-200 bg-white p-8 text-center">
        <BedDouble className="mx-auto h-8 w-8 text-neutral-300" />
        <p className="m-0 mt-2 text-[15px] font-bold text-neutral-700">No hotels yet</p>
        <p className="m-0 mt-1 text-[13px] text-neutral-500">When a hotel approves your agency, it will show here for booking.</p>
      </div></div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {invitationPanel}
      {outgoingPanel}
      {awaitingApproval.length > 0 && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">Accepted and awaiting hotel activation: {awaitingApproval.map((row) => row.property.title).join(", ")}.</div>}
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl border border-solid border-emerald-100 bg-emerald-50 text-emerald-700"><CalendarSearch className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0">
          <h1 className="m-0 text-xl font-extrabold tracking-[-0.02em] text-neutral-950">Book a stay</h1>
          <p className="m-0 mt-1 text-[13px] text-neutral-500">Search live availability and your negotiated rates at an approved partner hotel.</p>
        </div>
      </div>

      {notice && <div className="flex flex-col gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-800 sm:flex-row sm:items-center sm:justify-between"><span>{notice}</span>{completedBookingId ? <Link href={`/agent-portal/bookings/${completedBookingId}/guests`} className="inline-flex h-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white no-underline hover:bg-emerald-800">Add traveller details</Link> : null}</div>}
      {error && <div className="rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}

      {/* Hotel context and availability search */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-0 border-b border-solid border-neutral-200 bg-neutral-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-neutral-200"><BedDouble className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Selected hotel</p>
              <p className="m-0 mt-0.5 truncate text-sm font-extrabold text-neutral-900">{hotel?.property.title || "Choose a partner hotel"}</p>
              {hotel ? <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-medium text-neutral-500"><span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 text-amber-500" /> Owner review & invoice</span><span>{hotel.currency}</span><span>{hotel.ratePlans} rate plan{hotel.ratePlans === 1 ? "" : "s"}</span></p> : null}
            </div>
          </div>
          {hotels.length > 1 ? (
            <label className="min-w-0 sm:w-64">
              <span className="sr-only">Change hotel</span>
              <select value={hotelId ?? ""} onChange={(event) => { setHotelId(Number(event.target.value)); setRooms(null); setError(null); }} className="h-10 w-full rounded-xl border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                {hotels.map((entry) => <option key={entry.linkId} value={entry.linkId}>{entry.property.title}</option>)}
              </select>
            </label>
          ) : null}
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-2.5 p-3 sm:grid-cols-2 md:grid-cols-5">
          <div className="min-w-0">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-500">Check-in</span>
            <DatePickerField label="Check-in date" value={q.checkIn} min={todayStr()} allowPast={false} widthClassName="w-full" size="sm" onChangeAction={(next) => { setQ((current) => ({ ...current, checkIn: next, checkOut: next >= current.checkOut ? addDays(next, 1) : current.checkOut })); setRooms(null); }} />
          </div>
          <div className="min-w-0">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-500">Check-out</span>
            <DatePickerField label="Check-out date" value={q.checkOut} min={addDays(q.checkIn, 1)} allowPast={false} widthClassName="w-full" size="sm" onChangeAction={(next) => { setQ((current) => ({ ...current, checkOut: next })); setRooms(null); }} />
          </div>
          <GuestStepper label="Adults" value={q.adults} min={1} max={20} onChange={(value) => { setQ((current) => ({ ...current, adults: value })); setRooms(null); }} />
          <GuestStepper label="Children" value={q.children} min={0} max={20} onChange={(value) => { setQ((current) => ({ ...current, children: value })); setRooms(null); }} />
          <div className="flex min-w-0 flex-col justify-end sm:col-span-2 md:col-span-1">
            <span className="mb-1 truncate text-[9px] font-semibold text-neutral-400">{stayNights} night{stayNights === 1 ? "" : "s"} · {q.adults + q.children} guest{q.adults + q.children === 1 ? "" : "s"}</span>
            <button type="button" onClick={() => void search()} disabled={!hotelId || searching || stayNights < 1} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-solid border-emerald-700 bg-emerald-700 px-3 text-xs font-bold text-white shadow-sm transition hover:border-emerald-800 hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {searching ? "Searching..." : "Search rooms"}
            </button>
          </div>
        </div>
      </section>

      {/* Results */}
      {rooms !== null && (
        rooms.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-solid border-neutral-200 bg-white p-8 text-center text-[13px] text-neutral-500">No rooms available for those dates. Try different dates.</div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[12px] font-semibold text-neutral-500">{rooms.length} room type(s) available · {stayNights} night(s) at {hotel?.property.title}</p>
            {rooms.map((r) => (
              <div key={r.roomType.id} className="flex flex-col gap-3 rounded-2xl border border-solid border-neutral-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-bold text-neutral-900">{r.roomType.name}</span>
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{r.ratePlan.mealPlan.replace(/_/g, " ")}</span>
                    <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">{r.ratePlan.name}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-neutral-500">
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Up to {r.roomType.capacityAdults} adults</span>
                    <span className={`inline-flex items-center gap-1 font-semibold ${r.available <= 3 ? "text-amber-600" : "text-emerald-700"}`}><BedDouble className="h-3.5 w-3.5" /> {r.available} left</span>
                    {r.ratePlan.refundable && <span className="inline-flex items-center gap-1 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /> Refundable</span>}
                  </div>
                </div>
                <div className="flex w-full flex-shrink-0 items-center justify-between gap-4 sm:w-auto sm:justify-start">
                  <div className="min-w-0 text-left sm:text-right">
                    <span className="block text-[17px] font-extrabold text-neutral-900">{r.currency} {money(r.total)}</span>
                    <span className="block text-[10px] text-neutral-400">total · {r.currency} {money(r.total / stayNights)}/night</span>
                  </div>
                  <button type="button" onClick={() => setBooking(r)} className="rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700">Book</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {booking && hotel && (
        <BookConfirm hotel={hotel} room={booking} query={q} nights={stayNights} onClose={() => setBooking(null)}
          onDone={(msg, requestId, confirmed) => { setBooking(null); setNotice(msg); setCompletedBookingId(confirmed ? requestId : null); setRooms(null); }} onError={setError} />
      )}
    </div>
  );
}

function BookConfirm({ hotel, room, query, nights, onClose, onDone, onError }: {
  hotel: Hotel; room: Room; query: { checkIn: string; checkOut: string; adults: number; children: number }; nights: number;
  onClose: () => void; onDone: (msg: string, requestId: number, confirmed: boolean) => void; onError: (m: string) => void;
}) {
  const [roomsQty, setRoomsQty] = useState(1);
  const [bookingAdults, setBookingAdults] = useState(query.adults);
  const [bookingChildren, setBookingChildren] = useState(query.children);
  const [incidentalBilling, setIncidentalBilling] = useState<"AGENCY" | "INDIVIDUAL_GUEST">("INDIVIDUAL_GUEST");
  const [saving, setSaving] = useState(false);
  const maxRooms = Math.max(1, Math.min(10, room.available));
  const adultsPerRoom = Math.ceil(bookingAdults / roomsQty);
  const childrenPerRoom = Math.ceil(bookingChildren / roomsQty);
  const occupancyError = bookingAdults < roomsQty
    ? `Add at least ${roomsQty} adults so every room has an adult.`
    : adultsPerRoom > room.roomType.capacityAdults
      ? `${room.roomType.name} supports up to ${room.roomType.capacityAdults} adult${room.roomType.capacityAdults === 1 ? "" : "s"} per room. Add rooms or reduce adults.`
      : bookingChildren > 0 && room.roomType.capacityChildren === 0
        ? `${room.roomType.name} is configured for adults only. Choose a child-friendly room type or remove the child.`
      : childrenPerRoom > room.roomType.capacityChildren
        ? `${room.roomType.name} supports up to ${room.roomType.capacityChildren} child${room.roomType.capacityChildren === 1 ? "" : "ren"} per room. Add rooms or reduce children.`
        : null;

  const confirm = async () => {
    setSaving(true);
    try {
      const res = await apiClient.post<any>(`/api/agent-portal/hotels/${hotel.linkId}/book`, {
        roomTypeId: room.roomType.id, ratePlanId: room.ratePlan.id,
        checkIn: query.checkIn, checkOut: query.checkOut, adults: bookingAdults, children: bookingChildren,
        rooms: roomsQty, incidentalBilling,
      });
      onDone("Request sent to the hotel for review. If accepted, the property will issue its invoice; traveller details open after the hotel confirms receipt of payment.", Number(res.data?.requestId), false);
    } catch (e: any) {
      onError(e?.response?.data?.error || "The booking could not be created");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-solid border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-0 border-b border-solid border-neutral-100 px-5 py-4 sm:px-6">
          <h2 className="m-0 text-lg font-extrabold text-neutral-950">Request to book</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border-0 bg-transparent p-1 text-neutral-400 hover:text-neutral-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="rounded-xl border border-solid border-neutral-100 bg-neutral-50 p-4 text-sm">
            <p className="m-0 text-[15px] font-extrabold text-neutral-950">{hotel.property.title}</p>
            <p className="m-0 mt-1 font-medium text-neutral-700">{room.roomType.name} · {room.ratePlan.mealPlan.replace(/_/g, " ")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-neutral-700">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5"><CalendarSearch className="h-4 w-4 text-neutral-500" /> {stayDate(query.checkIn)} <span className="text-neutral-300">→</span> {stayDate(query.checkOut)}</span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-neutral-200"><Clock className="h-4 w-4 text-neutral-500" /> {nights} night{nights === 1 ? "" : "s"}</span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-neutral-200"><Users className="h-4 w-4 text-neutral-500" /> {bookingAdults} adult{bookingAdults === 1 ? "" : "s"}{bookingChildren ? ` · ${bookingChildren} child${bookingChildren === 1 ? "" : "ren"}` : ""}</span>
            </div>
          </div>
          <section className="rounded-xl border border-solid border-neutral-200 p-3.5 sm:p-4">
            <div className="mb-3"><h3 className="m-0 text-[13px] font-extrabold text-neutral-900">Rooms and travellers</h3><p className="m-0 mt-0.5 text-[12px] text-neutral-500">Set each quantity separately for the complete booking.</p></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <BookingStepper label="Rooms" value={roomsQty} min={1} max={maxRooms} onChange={(value) => setRoomsQty(Math.min(maxRooms, Math.max(1, value)))} />
              <BookingStepper label="Adults" value={bookingAdults} min={1} max={20} onChange={setBookingAdults} />
              <BookingStepper label="Children" value={bookingChildren} min={0} max={Math.min(20, room.roomType.capacityChildren * maxRooms)} onChange={setBookingChildren} />
            </div>
            <div className={`mt-3 rounded-lg px-3 py-2 text-[12px] leading-5 ${occupancyError ? "bg-amber-50 font-semibold text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{occupancyError || `${roomsQty} room${roomsQty === 1 ? "" : "s"} for ${bookingAdults + bookingChildren} traveller${bookingAdults + bookingChildren === 1 ? "" : "s"} · occupancy is valid.`}</div>
          </section>
          <fieldset className="m-0 rounded-xl border border-solid border-neutral-200 p-3">
            <legend className="px-1 text-[13px] font-extrabold text-neutral-900">Who covers food, drinks and other hotel services?</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {([{"value":"INDIVIDUAL_GUEST","title":"Each guest pays","copy":"Guests settle their own extras at the hotel."},{"value":"AGENCY","title":"Agency covers extras","copy":"Post approved incidentals to the agency booking."}] as const).map((choice) => <label key={choice.value} className={`cursor-pointer rounded-lg border border-solid p-3 transition ${incidentalBilling === choice.value ? "border-emerald-500 bg-emerald-50" : "border-neutral-200 bg-white hover:border-neutral-300"}`}><span className="flex items-center gap-2 text-[13px] font-bold text-neutral-800"><input type="radio" name="incidentalBilling" value={choice.value} checked={incidentalBilling === choice.value} onChange={() => setIncidentalBilling(choice.value)} className="accent-emerald-700" />{choice.title}</span><span className="mt-1 block pl-5 text-[12px] leading-5 text-neutral-500">{choice.copy}</span></label>)}
            </div>
          </fieldset>
          <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5">
            <span className="text-[12px] font-semibold text-emerald-800">Total ({roomsQty} room{roomsQty > 1 ? "s" : ""})</span>
            <span className="text-[16px] font-extrabold text-emerald-800">{room.currency} {money(room.total * roomsQty)}</span>
          </div>
          <p className="m-0 flex items-start gap-2 text-[12px] leading-5 text-neutral-600"><Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />The hotel reviews every request. If approved, it decides any discount and sends a property-direct invoice. NoLSAF and AzamPay do not collect this payment.</p>
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-[13px] font-semibold text-neutral-600 hover:border-neutral-300">Cancel</button>
            <button type="button" onClick={() => void confirm()} disabled={saving || Boolean(occupancyError)} className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:bg-neutral-300">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Send request</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookingStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <div className="min-w-0"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500">{label}</span><div className="flex h-12 items-center justify-between rounded-xl border border-solid border-neutral-200 bg-white p-1.5 shadow-sm"><button type="button" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Decrease ${label.toLowerCase()}`} className="grid h-9 w-9 place-items-center rounded-lg border-0 bg-neutral-100 text-neutral-700 hover:bg-neutral-200 disabled:text-neutral-300"><Minus className="h-4 w-4" /></button><b className="text-base tabular-nums text-neutral-950">{value}</b><button type="button" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label={`Increase ${label.toLowerCase()}`} className="grid h-9 w-9 place-items-center rounded-lg border-0 bg-neutral-100 text-neutral-700 hover:bg-neutral-200 disabled:text-neutral-300"><Plus className="h-4 w-4" /></button></div></div>;
}
