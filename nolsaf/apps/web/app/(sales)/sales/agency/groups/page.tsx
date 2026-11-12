"use client";

// Agency Desk group stays: prepare a request for a client and follow it.
// The client confirms from their own phone; owners send offers; the partner
// shortlists; the client chooses and pays NoLSAF in full.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Handshake, Loader2, Plus, Send, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import AgencyTabs from "@/components/sales/AgencyTabs";
import DatePicker from "@/components/ui/DatePicker";
import InfoTip from "@/components/sales/InfoTip";
import GroupDestinationFields, { EMPTY_DESTINATION, destinationPayload, type Destination } from "@/components/sales/GroupDestinationFields";
import GuestListEditor, { guestPhoneProblem, guestsToRoster, type Guest } from "@/components/sales/GuestListEditor";

type Row = {
  reference: string;
  status: string;
  client: { reference: string | null; name: string };
  destination: string | null;
  headcount: number | null;
  roomsNeeded: number | null;
  checkIn: string | null;
  createdAt: string;
  linkExpiresAt: string | null;
  shortlistStatus: string;
  booking: { status: string; paid: boolean; checkedIn: boolean; bids: number } | null;
};
type ClientOption = { reference: string; name: string; contactName: string | null; phone: string | null; status: string };

const GROUP_TYPES = ["family", "workers", "event", "students", "team", "safari_stay", "other"];
const ACCOMMODATION = ["hotel", "lodge", "guest_house", "apartment", "hostel", "villa", "house", "homestay", "other"];
const STARS = ["basic", "simple", "moderate", "high", "luxury"];
const card = "min-w-0 rounded-lg border border-solid border-slate-300 bg-white";
const input = "mt-1.5 block min-h-10 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";
const field = "block min-w-0 text-xs font-medium text-slate-600";
const primary = "inline-flex min-h-10 items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "-");
const words = (v: string) => v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type Bucket = "action" | "moving" | "done" | "closed";
const TONE: Record<Bucket, string> = {
  action: "bg-amber-50 text-amber-800",
  moving: "bg-sky-50 text-sky-800",
  done: "bg-emerald-50 text-emerald-800",
  closed: "bg-slate-100 text-slate-600",
};

/** Where a group stands, whose move it is, and the one-line next step. */
function stage(r: Row): { label: string; bucket: Bucket; next: string } {
  const b = r.booking;
  if (["CANCELLED", "EXPIRED"].includes(r.status) || ["CANCELED", "CANCELLED", "EXPIRED"].includes(String(b?.status || "").toUpperCase())) {
    return { label: r.status === "EXPIRED" ? "Link expired" : "Closed", bucket: "closed", next: "-" };
  }
  if (r.status === "AWAITING_CLIENT") return { label: "Waiting for client", bucket: "moving", next: "Client confirms by SMS" };
  if (!b) return { label: "Confirmed", bucket: "moving", next: "Setting up" };
  if (b.checkedIn) return { label: "Checked in", bucket: "done", next: "Earning follows" };
  if (b.paid) return { label: "Paid", bucket: "done", next: "Wait for check-in" };
  if (r.shortlistStatus === "PENDING_REVIEW") return { label: "With NoLSAF", bucket: "moving", next: "NoLSAF is checking" };
  if (r.shortlistStatus === "PUBLISHED") return { label: "Client choosing", bucket: "action", next: "Follow up with client" };
  if (b.bids) return { label: `${b.bids} offer${b.bids === 1 ? "" : "s"}`, bucket: "action", next: "Shortlist up to three" };
  return { label: "No offers yet", bucket: "action", next: "Invite owners" };
}

const FILTERS: Array<{ key: "open" | Bucket | "all"; label: string }> = [
  { key: "open", label: "Open" },
  { key: "action", label: "Your move" },
  { key: "done", label: "Paid" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const emptyForm = {
  clientRef: "", clientName: "", clientPhone: "", groupType: "event", accommodationType: "hotel", minHotelStarLabel: "moderate",
  headcount: "", roomSize: "2", checkIn: "", checkOut: "", meals: false, pickup: false, transport: false, guide: false, notes: "", biddingDays: "3",
};

export default function AgencyGroupsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [destination, setDestination] = useState<Destination>(EMPTY_DESTINATION);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");

  const staged = useMemo(() => rows.map((r) => ({ row: r, s: stage(r) })), [rows]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0, action: 0, moving: 0, done: 0, closed: 0, all: staged.length };
    for (const { s } of staged) {
      c[s.bucket] += 1;
      if (s.bucket !== "closed") c.open += 1;
    }
    return c;
  }, [staged]);
  const visible = useMemo(
    () => staged.filter(({ s }) => (filter === "all" ? true : filter === "open" ? s.bucket !== "closed" : s.bucket === filter)),
    [staged, filter],
  );

  const load = useCallback(async () => {
    try {
      const [g, c] = await Promise.all([apiClient.get("/api/sales/agency/groups"), apiClient.get("/api/sales/agency/clients")]);
      setRows(g.data?.items || []);
      setClients((c.data?.items || []).filter((x: ClientOption) => x.status === "ACTIVE"));
    } catch (cause: any) {
      if (cause?.response?.status === 404 || cause?.response?.status === 403) setUnavailable(true);
      else setError(cause?.response?.data?.error || "Could not load group stays.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rooms = useMemo(() => {
    const h = Number(form.headcount) || 0;
    const s = Math.max(1, Number(form.roomSize) || 1);
    return h ? Math.ceil(h / s) : 0;
  }, [form.headcount, form.roomSize]);

  const submit = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const roster = guestsToRoster(guests);
      const body: any = {
        ...(form.clientRef ? { clientRef: form.clientRef } : { clientName: form.clientName.trim(), clientPhone: form.clientPhone.trim() }),
        biddingDays: Number(form.biddingDays) || 3,
        request: {
          groupType: form.groupType,
          ...destinationPayload(destination),
          accommodationType: form.accommodationType,
          minHotelStarLabel: form.accommodationType === "hotel" ? form.minHotelStarLabel : null,
          headcount: Number(form.headcount),
          roomSize: Number(form.roomSize),
          roomsNeeded: rooms,
          needsPrivateRoom: false,
          privateRoomCount: 0,
          checkin: form.checkIn ? new Date(`${form.checkIn}T12:00:00`).toISOString() : null,
          checkout: form.checkOut ? new Date(`${form.checkOut}T10:00:00`).toISOString() : null,
          useDates: !!form.checkIn,
          arrangements: { pickup: form.pickup, transport: form.transport, meals: form.meals, guide: form.guide, equipment: false, notes: form.notes.trim() || null },
          roster,
        },
      };
      const res = await apiClient.post("/api/sales/agency/groups", body);
      setNotice(res.data?.smsSent ? "Sent. Your client got an SMS to confirm the request from their own phone." : "Saved, but the SMS did not go out. Use Resend on the request.");
      setForm(emptyForm);
      setDestination(EMPTY_DESTINATION);
      setGuests([]);
      setCreating(false);
      router.push(`/sales/agency/groups/${res.data.reference}`);
    } catch (cause: any) {
      const details = cause?.response?.data?.details;
      setError(details?.[0]?.message ? `${cause.response.data.error}: ${details[0].message}` : cause?.response?.data?.error || "Could not send the request.");
    } finally {
      setBusy(false);
    }
  };

  const guestProblems = guests.some((g) => (g.name.trim() || g.phone.trim()) && (!g.name.trim() || guestPhoneProblem(g.phone)));
  const canSubmit =
    (form.clientRef || (form.clientName.trim().length >= 2 && form.clientPhone.trim().length >= 9)) &&
    !!destination.region && Number(form.headcount) > 0 && rooms > 0 && !guestProblems;

  return (
    <SalesShell>
      <div className="min-w-0 space-y-4">
        <SalesPageHeader
          icon={Handshake}
          title="Group stays"
          description="Prepare a group stay for a client. They confirm it on their own phone and pay NoLSAF in full."
          actions={!unavailable ? <button type="button" className={primary} aria-expanded={creating} onClick={() => setCreating((v) => !v)}>{creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{creating ? "Close form" : "New group stay"}</button> : null}
        />
        {!unavailable ? <AgencyTabs /> : null}
        {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        {notice ? <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

        {unavailable ? (
          <article className={`${card} p-5 text-sm text-slate-600`}>The Agency Desk is not available on your account.</article>
        ) : (
          <>
            {creating ? (
              <article className={`${card} overflow-hidden`}>
                <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                  <FormSection title="Client" tip={<>Your client gets an SMS and confirms on their own phone, signed in with that number verified. Nothing goes to owners until they confirm.</>}>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                      <label className={field}>Client
                        <select value={form.clientRef} onChange={(e) => setForm({ ...form, clientRef: e.target.value })} className={input}>
                          <option value="">Someone not in my client book</option>
                          {clients.map((c) => <option key={c.reference} value={c.reference}>{c.name}</option>)}
                        </select>
                      </label>
                      {!form.clientRef ? (
                        <>
                          <label className={field}>Client name<input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className={input} /></label>
                          <label className={field}>Client phone<input value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} inputMode="tel" placeholder="0712 345 678" className={input} /></label>
                        </>
                      ) : null}
                    </div>
                  </FormSection>

                  <FormSection title="Where" tip={<>Owners in this region, and district if you pick one, can send offers. Add a ward and street only when the group must stay near a specific venue.</>}>
                    <GroupDestinationFields value={destination} onChange={setDestination} />
                  </FormSection>

                  <FormSection title="What and when">
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className={field}>Group type
                        <select value={form.groupType} onChange={(e) => setForm({ ...form, groupType: e.target.value })} className={input}>{GROUP_TYPES.map((t) => <option key={t} value={t}>{words(t)}</option>)}</select>
                      </label>
                      <label className={field}>Accommodation
                        <select value={form.accommodationType} onChange={(e) => setForm({ ...form, accommodationType: e.target.value })} className={input}>{ACCOMMODATION.map((t) => <option key={t} value={t}>{words(t)}</option>)}</select>
                      </label>
                      {form.accommodationType === "hotel" ? (
                        <label className={field}>Hotel level at least
                          <select value={form.minHotelStarLabel} onChange={(e) => setForm({ ...form, minHotelStarLabel: e.target.value })} className={input}>{STARS.map((t) => <option key={t} value={t}>{words(t)}</option>)}</select>
                        </label>
                      ) : null}
                      <div className="relative min-w-0">
                        <span className="block text-xs font-medium text-slate-600">Dates</span>
                        <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen((v) => !v)} className={`${input} flex items-center gap-2 text-left text-slate-700`}>
                          <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="min-w-0 truncate">{form.checkIn ? `${day(form.checkIn)} to ${form.checkOut ? day(form.checkOut) : "?"}` : "Flexible dates"}</span>
                        </button>
                        {dateOpen ? (
                          <div className="absolute left-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)]">
                            <DatePicker
                              selected={form.checkIn ? (form.checkOut ? [form.checkIn, form.checkOut] : form.checkIn) : undefined}
                              allowRange
                              resetRangeAnchor
                              onSelectAction={(value) => {
                                if (Array.isArray(value)) {
                                  setForm((f) => ({ ...f, checkIn: value[0] || "", checkOut: value[value.length - 1] || "" }));
                                  setDateOpen(false);
                                } else {
                                  setForm((f) => ({ ...f, checkIn: value, checkOut: "" }));
                                }
                              }}
                              onCloseAction={() => setDateOpen(false)}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </FormSection>

                  <FormSection title="Size and offers" tip={<>Rooms are worked out from people and people per room. Owners have the number of days you choose to send offers, then bidding closes.</>}>
                    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
                      <label className={field}>People<input value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" className={input} /></label>
                      <label className={field}>People per room<input value={form.roomSize} onChange={(e) => setForm({ ...form, roomSize: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" className={input} /></label>
                      <div className="min-w-0 text-xs font-medium text-slate-600">Rooms<p className="m-0 mt-1.5 flex min-h-10 items-center rounded-md bg-slate-50 px-3 text-sm font-semibold tabular-nums text-slate-900">{rooms || "-"}</p></div>
                      <label className={field}>Days for offers
                        <select value={form.biddingDays} onChange={(e) => setForm({ ...form, biddingDays: e.target.value })} className={input}>{[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}</select>
                      </label>
                    </div>
                  </FormSection>

                  <FormSection title="Extras">
                    <div className="flex flex-wrap gap-2">
                      {(["meals", "pickup", "transport", "guide"] as const).map((k) => (
                        <label key={k} className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-solid px-3 text-sm ${form[k] ? "border-[#02665e] bg-[#02665e]/[0.06] text-[#02665e]" : "border-slate-300 bg-white text-slate-700"}`}>
                          <input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />{words(k)}
                        </label>
                      ))}
                    </div>
                    <label className={`${field} mt-3`}>Notes for owners (optional)
                      <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} maxLength={1000}
                        placeholder="Conference hall nearby, late check-in on the first night" className={`${input} py-2`} />
                    </label>
                  </FormSection>

                  <FormSection title="Guests" tip={<>Optional. Add each person with their phone, or paste a list from WhatsApp. You can leave it empty and share names later.</>}>
                    <GuestListEditor guests={guests} onChange={setGuests} headcount={Number(form.headcount) || 0} />
                  </FormSection>

                  <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-300 bg-slate-50 px-4 py-3">
                    <button type="submit" className={primary} disabled={busy || !canSubmit}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send to client to confirm</button>
                    {!canSubmit ? (
                      <span className="text-xs text-slate-500">
                        {guestProblems ? "Fix the highlighted guest rows: each needs a name, and phones need 9 to 15 digits." : "Needs a client, a region and the number of people."}
                      </span>
                    ) : null}
                  </div>
                </form>
              </article>
            ) : null}

            <article className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center gap-1.5 border-0 border-b border-solid border-slate-200 px-4 py-3" role="tablist" aria-label="Filter group stays">
                {FILTERS.map((f) => {
                  const on = filter === f.key;
                  return (
                    <button key={f.key} type="button" role="tab" aria-selected={on} onClick={() => setFilter(f.key)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md border border-solid px-3 text-xs font-semibold ${on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
                      {f.label}<span className={`tabular-nums ${on ? "text-white/80" : "text-slate-400"}`}>{counts[f.key] ?? 0}</span>
                    </button>
                  );
                })}
                <InfoTip label="Your move" className="ml-0.5">Groups waiting on you: offers to shortlist, or a client to follow up while they choose. Everything else is with the client, the owners or NoLSAF.</InfoTip>
              </div>

              {loading ? (
                <div className="grid h-24 place-items-center text-[#02665e]"><Loader2 className="h-4 w-4 animate-spin" /></div>
              ) : !visible.length ? (
                <p className="m-0 px-4 py-6 text-center text-sm text-slate-500">
                  {rows.length ? "Nothing here under this filter." : "No group stays yet. Use New group stay to prepare one for a client."}
                </p>
              ) : (
                <>
                  {/* Phones: one row per group */}
                  <ul className="m-0 list-none p-0 md:hidden">
                    {visible.map(({ row: r, s }) => (
                      <li key={r.reference} className="border-0 border-t border-solid border-slate-200 first:border-t-0">
                        <Link href={`/sales/agency/groups/${r.reference}`} className="block px-4 py-3 text-inherit no-underline hover:bg-slate-50">
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{r.client.name}</span>
                            <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${TONE[s.bucket]}`}>{s.label}</span>
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {[r.destination, `${r.headcount ?? "-"} people`, r.checkIn ? day(r.checkIn) : "Flexible dates"].filter(Boolean).join(" · ")}
                          </span>
                          {s.next !== "-" ? (
                            <span className={`mt-1.5 flex items-center gap-1 text-xs ${s.bucket === "action" ? "font-semibold text-amber-800" : "text-slate-500"}`}>
                              <ArrowRight className="h-3 w-3 shrink-0" />{s.next}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {/* Wider screens: table, fixed columns so nothing pushes sideways */}
                  <table className="hidden w-full table-fixed border-collapse text-left text-sm md:table">
                    <colgroup><col className="w-[24%]" /><col className="w-[16%]" /><col className="w-[12%]" /><col className="w-[14%]" /><col className="w-[15%]" /><col /></colgroup>
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Client</th>
                        <th className="px-3 py-2.5 font-medium">Destination</th>
                        <th className="px-3 py-2.5 font-medium">People / rooms</th>
                        <th className="px-3 py-2.5 font-medium">Check-in</th>
                        <th className="px-3 py-2.5 font-medium">Where it stands</th>
                        <th className="px-4 py-2.5 font-medium">Next</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(({ row: r, s }) => (
                        <tr key={r.reference} className="border-0 border-t border-solid border-slate-200 hover:bg-slate-50">
                          <td className="truncate px-4 py-3"><Link href={`/sales/agency/groups/${r.reference}`} title={r.client.name} className="font-medium text-slate-900 no-underline hover:text-[#02665e] hover:underline">{r.client.name}</Link></td>
                          <td className="truncate px-3 py-3 text-slate-600" title={r.destination || undefined}>{r.destination || "-"}</td>
                          <td className="px-3 py-3 tabular-nums text-slate-600">{r.headcount ?? "-"} / {r.roomsNeeded ?? "-"}</td>
                          <td className="px-3 py-3 text-slate-600">{day(r.checkIn)}</td>
                          <td className="px-3 py-3"><span className={`inline-block max-w-full truncate rounded-md px-2 py-0.5 align-middle text-xs font-semibold ${TONE[s.bucket]}`}>{s.label}</span></td>
                          <td className={`px-4 py-3 text-xs ${s.bucket === "action" ? "font-semibold text-amber-800" : "text-slate-500"}`}>{s.next}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </article>
          </>
        )}
      </div>
    </SalesShell>
  );
}

/** One titled band of the form, with an optional explanation behind an info icon. */
function FormSection({ title, tip, children }: { title: string; tip?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 border-0 border-b border-solid border-slate-200 px-4 py-4 last-of-type:border-b-0 sm:px-5">
      <h3 className="m-0 mb-3 flex items-center gap-1 text-[13px] font-semibold text-slate-900">
        {title}
        {tip ? <InfoTip label={title}>{tip}</InfoTip> : null}
      </h3>
      {children}
    </section>
  );
}
