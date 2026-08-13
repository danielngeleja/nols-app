"use client";
// Group block (allotment) dialogs: agree rooms for a party before any guest
// name exists. The rooming list and pickup follow; a block on its own already
// does the important job of stopping the desk overselling rooms it promised.
import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { AlertTriangle, ArrowLeftRight, BedDouble, Building2, CalendarClock, Check, Download, Eye, EyeOff, FileText, Landmark, Link2, Loader2, LockKeyhole, Mail, Plus, ReceiptText, Send, ShieldCheck, Trash2, UserPlus, UserRound, X } from "lucide-react";
import ModalFrame from "./NrmsModalFrame";
import NrmsRoomingListModal from "./NrmsRoomingListModal";

export type GroupBlockRoom = {
  id: number;
  roomTypeId: number;
  roomTypeName: string | null;
  ratePlanId: number | null;
  ratePlanName: string | null;
  quantity: number;
  pickedUp: number;
  held: number;
  nightlyRate: number;
  mealPlan: string | null;
};

export type GroupBlock = {
  id: number;
  reference: string;
  name: string;
  agencyName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  checkIn: string;
  checkOut: string;
  cutOffAt: string;
  cutOffPassed: boolean;
  status: string;
  currency: string;
  billingMode: string;
  notes: string | null;
  groupId: number | null;
  nights: number;
  roomsTotal: number;
  roomsHeld: number;
  roomsPickedUp: number;
  blockValue: number;
  masterFolio: {
    id: number;
    reference: string;
    billingMode: string;
    settlementPolicy: string;
    billToName: string;
    status: string;
    currency: string;
    billed: number;
    quoted: number;
    paymentsReceived: number;
    refunded: number;
    paid: number;
    balance: number;
    credit: number;
    paymentDue: number;
    settledAt: string | null;
    revisionRequired: boolean;
    proFormas: Array<{
      id: number;
      number: string;
      revision: number;
      status: string;
      paymentStatus: string;
      currency: string;
      issuedAt: string;
      dueAt: string;
      validUntil: string;
      billToName: string;
      contactName: string;
      contactEmail: string;
      contactPhone: string | null;
      quotedTotal: number;
      paidAtIssue: number;
      balanceDueAtIssue: number;
      paidNow: number;
      liveBalance: number;
      bankName: string;
      bankAccountName: string;
      bankAccountLast4: string;
      bankSource: string;
      bankCurrency: string | null;
      publicUrl: string;
      sentAt: string | null;
      sentToEmail: string | null;
      deliveryProvider: string | null;
      viewCount: number;
      lastViewedAt: string | null;
      supersededAt: string | null;
      createdAt: string;
    }>;
    items: Array<{ id: number; reservationId: number; kind: string; description: string | null; amount: number; createdAt: string; voidedAt: string | null; voidReason: string | null }>;
    payments: Array<{ id: number; amount: number; method: string; reference: string | null; receiptNumber: string; note: string | null; createdAt: string; voidedAt: string | null; voidReason: string | null }>;
    refunds: Array<{ id: number; amount: number; method: string; reference: string | null; refundNumber: string; reason: string; createdAt: string; voidedAt: string | null; voidReason: string | null }>;
  } | null;
  chargeRegister: Array<{
    id: string;
    occurredAt: string;
    sourceType: "ROOM" | "OUTLET_ORDER" | "MANUAL_CHARGE";
    sourceReference: string;
    category: string;
    description: string;
    outlet: string | null;
    orderStatus: string | null;
    reservationId: number;
    reservationStatus: string;
    guestName: string;
    room: string;
    payer: "AGENCY" | "GUEST";
    destination: string;
    settlementStatus: "PAID_BY_AGENCY" | "AGENCY_DUE" | "GUEST_FOLIO_SETTLED" | "GUEST_DUE" | "VOIDED";
    documentRevisionRequired: boolean;
    amount: number;
    currency: string;
  }>;
  rooms: GroupBlockRoom[];
};

type RoomTypeOption = { id: number; name: string; baseRate: number | null };

type DraftLine = { roomTypeId: number | ""; quantity: number; nightlyRate: string };

const BILLING_MODES: Array<{ value: string; label: string; detail: string }> = [
  { value: "INDIVIDUAL", label: "Each guest pays their own", detail: "Rooms and extras settle on each guest's own folio." },
  { value: "SPLIT", label: "Agency pays rooms, guests pay extras", detail: "The usual tour arrangement. Rooms and tax to the agency, bar and laundry to the guest." },
  { value: "MASTER", label: "Agency pays everything", detail: "Rooms, tax and extras all settle on the agency account." },
];

const inputCls =
  "h-11 w-full min-w-0 max-w-full box-border rounded-xl border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

const labelCls = "mb-1.5 block text-xs font-semibold text-neutral-700";

function BillingModeCards({ value, onChange, name, disabled = false }: { value: string; onChange: (value: string) => void; name: string; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {BILLING_MODES.map((mode) => {
        const selected = value === mode.value;
        const Icon = mode.value === "INDIVIDUAL" ? UserRound : mode.value === "SPLIT" ? ArrowLeftRight : Building2;
        return (
          <label
            key={mode.value}
            aria-disabled={disabled}
            className={`relative flex items-start gap-2.5 rounded-xl border border-solid p-3 transition-all focus-within:ring-2 focus-within:ring-emerald-500/20 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${selected ? "border-emerald-500 bg-emerald-50/70 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]" : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm"}`}
          >
            <input type="radio" name={name} checked={selected} disabled={disabled} onChange={() => onChange(mode.value)} className="sr-only" />
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold leading-4 text-neutral-950">{mode.label}</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-neutral-500">{mode.detail}</span>
            </span>
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-solid ${selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white text-transparent"}`}>
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
          </label>
        );
      })}
    </div>
  );
}

function todayIso(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function fmtStay(checkIn: string, checkOut: string): string {
  return `${fmtLongDate(checkIn)} to ${fmtLongDate(checkOut)}`;
}

function fmtLongDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "that date";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fmtDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T00:00:00`).getTime();
  const end = new Date(`${checkOut}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 86_400_000);
}

const CHARGE_STATUS_LABEL: Record<string, string> = {
  PAID_BY_AGENCY: "Paid by agency",
  AGENCY_DUE: "Agency due",
  GUEST_FOLIO_SETTLED: "Guest folio settled",
  GUEST_DUE: "Guest due",
  VOIDED: "Voided",
};

function chargeStatusClass(status: string): string {
  if (status === "PAID_BY_AGENCY" || status === "GUEST_FOLIO_SETTLED") return "bg-emerald-100 text-emerald-800";
  if (status === "AGENCY_DUE" || status === "GUEST_DUE") return "bg-amber-100 text-amber-800";
  return "bg-neutral-100 text-neutral-500";
}

function GroupChargeRegister({ block }: { block: GroupBlock }) {
  const rows = block.chargeRegister ?? [];
  const activeRows = rows.filter((row) => row.settlementStatus !== "VOIDED");
  const agencyRows = activeRows.filter((row) => row.payer === "AGENCY");
  const guestRows = activeRows.filter((row) => row.payer === "GUEST");
  const agencyAmount = agencyRows.reduce((sum, row) => sum + row.amount, 0);
  const guestAmount = guestRows.reduce((sum, row) => sum + row.amount, 0);

  return (
    <section className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-0 border-b border-solid border-neutral-200 bg-neutral-50/80 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><ReceiptText className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="m-0 text-sm font-bold text-neutral-950">Group charge register</p>
            <p className="m-0 mt-0.5 text-[10px] leading-4 text-neutral-500">Every room and extra traced from its source to the person responsible for payment.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-bold text-sky-800">Agency · {agencyAmount.toLocaleString()} {block.currency}</span>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">Guests · {guestAmount.toLocaleString()} {block.currency}</span>
          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-neutral-600 ring-1 ring-inset ring-neutral-200">{activeRows.length} active</span>
        </div>
      </div>

      {block.masterFolio?.revisionRequired && (
        <div className="flex items-start gap-2.5 border-0 border-b border-solid border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="m-0 text-xs font-bold text-amber-950">New agency charges need a Pro Forma revision</p>
            <p className="m-0 mt-0.5 text-[10px] leading-4 text-amber-800">At least one extra was posted after the current document was issued. Generate a revision before requesting the remaining payment.</p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="m-0 text-xs font-bold text-neutral-700">No routed charges yet</p>
          <p className="m-0 mt-1 text-[10px] text-neutral-500">Room charges appear after pickup; food, bar and service orders appear after they are posted to a room folio.</p>
        </div>
      ) : (
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead className="sticky top-0 z-[1] bg-white shadow-[0_1px_0_0_#e5e5e5]">
              <tr className="text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                <th className="px-3 py-2.5">Source</th>
                <th className="px-3 py-2.5">Guest / room</th>
                <th className="px-3 py-2.5">Responsible payer</th>
                <th className="px-3 py-2.5">Invoice / folio</th>
                <th className="px-3 py-2.5">Settlement</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((row) => {
                const SourceIcon = row.sourceType === "ROOM" ? BedDouble : ReceiptText;
                return (
                  <tr key={row.id} className={row.settlementStatus === "VOIDED" ? "bg-neutral-50 opacity-60" : "hover:bg-neutral-50/80"}>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${row.sourceType === "ROOM" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"}`}><SourceIcon className="h-3.5 w-3.5" /></span>
                        <div className="min-w-0">
                          <p className="m-0 text-[11px] font-bold text-neutral-900">{row.sourceReference}</p>
                          {(row.outlet || row.orderStatus) && <p className="m-0 mt-0.5 text-[9px] font-semibold text-neutral-500">{[row.outlet, row.orderStatus?.replace(/_/g, " ").toLowerCase()].filter(Boolean).join(" · ")}</p>}
                          <p className="m-0 mt-0.5 max-w-56 truncate text-[9px] text-neutral-500" title={row.description}>{row.description}</p>
                          <p className="m-0 mt-1 text-[9px] text-neutral-400">{fmtDateTime(row.occurredAt)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top"><p className="m-0 text-[11px] font-bold text-neutral-900">{row.guestName}</p><p className="m-0 mt-0.5 text-[9px] text-neutral-500">{row.room} · {row.category.replace(/_/g, " ")}</p></td>
                    <td className="px-3 py-3 align-top"><span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold ${row.payer === "AGENCY" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}>{row.payer === "AGENCY" ? block.masterFolio?.billToName || "Agency" : row.guestName}</span></td>
                    <td className="px-3 py-3 align-top"><p className="m-0 text-[10px] font-semibold text-neutral-700">{row.destination}</p>{row.documentRevisionRequired && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-800">Revision required</span>}</td>
                    <td className="px-3 py-3 align-top"><span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold ${chargeStatusClass(row.settlementStatus)}`}>{CHARGE_STATUS_LABEL[row.settlementStatus] || row.settlementStatus.replace(/_/g, " ")}</span></td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right align-top text-[11px] font-bold tabular-nums ${row.settlementStatus === "VOIDED" ? "text-neutral-400 line-through" : "text-neutral-950"}`}>{row.amount.toLocaleString()} {row.currency}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CreateGroupBlockModal({
  propertyId,
  onClose,
  onSaved,
}: {
  propertyId: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([]);
  const [name, setName] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [checkIn, setCheckIn] = useState(todayIso(7));
  const [checkOut, setCheckOut] = useState(todayIso(10));
  const [cutOffAt, setCutOffAt] = useState(todayIso(3));
  const [billingMode, setBillingMode] = useState("SPLIT");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ roomTypeId: "", quantity: 1, nightlyRate: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<any>(`/api/owner/nrms/rooms/${propertyId}`)
      .then((r) => setRoomTypes(r.data?.roomTypes ?? []))
      .catch(() => setRoomTypes([]));
  }, [propertyId]);

  const nights = nightsBetween(checkIn, checkOut);
  const cutOffLabel = fmtLongDate(cutOffAt);
  // Allowed, but worth saying out loud: past arrival the deadline stops doing
  // the one job it has, which is giving the desk time to resell what the party
  // did not take.
  const lateCutOff = Boolean(checkIn && cutOffAt >= checkIn);
  const totals = useMemo(() => {
    const rooms = lines.reduce((sum, line) => sum + (line.roomTypeId ? line.quantity : 0), 0);
    const value = lines.reduce((sum, line) => sum + (line.roomTypeId ? Number(line.nightlyRate || 0) * line.quantity * nights : 0), 0);
    return { rooms, value };
  }, [lines, nights]);

  const usedTypeIds = lines.map((line) => line.roomTypeId).filter(Boolean) as number[];

  const setLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const save = async () => {
    if (name.trim().length < 2) return setError("Give the block a name the desk will recognise");
    if (contactName.trim().length < 2) return setError("Enter the group leader or agency contact name");
    if (!/^\S+@\S+\.\S+$/.test(contactEmail.trim())) return setError("Enter the email address that should receive the group documents");
    if (billingMode !== "INDIVIDUAL" && agencyName.trim().length < 2) return setError("Enter the agency or company that will receive the bill");
    if (nights < 1) return setError("Departure must be after arrival");
    const rooms = lines.filter((line) => line.roomTypeId).map((line) => ({
      roomTypeId: Number(line.roomTypeId),
      quantity: line.quantity,
      nightlyRate: Number(line.nightlyRate || 0),
    }));
    if (!rooms.length) return setError("Add at least one room type to hold");
    setBusy(true);
    setError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/property/${propertyId}/blocks`, {
        name: name.trim(),
        agencyName: agencyName.trim() || null,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim() || null,
        contactEmail: contactEmail.trim(),
        checkIn,
        checkOut,
        cutOffAt,
        billingMode,
        notes: notes.trim() || null,
        rooms,
      });
      await onSaved();
    } catch (e: any) {
      const data = e?.response?.data;
      if (data?.code === "ROOM_TYPE_CAPACITY_CONFLICT" && data.conflict) {
        setError(`Only ${data.conflict.available} of that room type are free for these dates, and ${data.conflict.requested} were requested.`);
      } else {
        setError(data?.error || "Failed to create the group block");
      }
      setBusy(false);
    }
  };

  return (
    <ModalFrame title="New group block" subtitle="Hold rooms for a party before the names are known" onClose={onClose} extraWide>
      <div className="space-y-5">
        <div className="rounded-xl border border-solid border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <p className="m-0 text-sm font-bold text-emerald-950">The rooms are held from the moment you save</p>
              <p className="m-0 mt-1 text-xs leading-5 text-emerald-800">
                Nobody else can sell them. Any room still without a guest name by the date you set below returns to sale on its own.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Block name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Kilimanjaro Tour, August" autoFocus />
          </label>
          <label className="block">
            <span className={labelCls}>Agency or company {billingMode === "INDIVIDUAL" && <span className="font-normal text-neutral-400">(optional)</span>}</span>
            <input className={inputCls} required={billingMode !== "INDIVIDUAL"} value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Serengeti Adventures Ltd" />
          </label>
          <label className="block">
            <span className={labelCls}>Group leader or agency contact</span>
            <input className={inputCls} required value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name" />
          </label>
          <label className="block">
            <span className={labelCls}>Contact phone <span className="font-normal text-neutral-400">(optional)</span></span>
            <input className={inputCls} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+255..." />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>Document email</span>
            <input className={inputCls} type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="bookings@agency.co.tz" />
            <span className="mt-1 block text-[11px] text-neutral-500">Pro Forma invoices and other group documents go here.</span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="min-w-0">
            <DatePickerField
              label="Arrival"
              value={checkIn}
              onChangeAction={(next) => {
                setCheckIn(next);
                const nextCheckOut = nightsBetween(next, checkOut) < 1 ? shiftDate(next, 1) : checkOut;
                if (nextCheckOut !== checkOut) setCheckOut(nextCheckOut);
                // Only pull the deadline in when it has fallen outside the stay
                // entirely. Snapping it to arrival used to leave the picker with
                // a single selectable day whenever arrival was today.
                if (cutOffAt > nextCheckOut) setCutOffAt(nextCheckOut);
              }}
              allowPast={false}
              twoMonths={false}
              widthClassName="w-full"
            />
            <p className="m-0 mt-1.5 text-[11px] leading-4 text-neutral-500">Party checks in.</p>
          </div>
          <div className="min-w-0">
            <DatePickerField
              label="Departure"
              value={checkOut}
              onChangeAction={setCheckOut}
              min={checkIn ? shiftDate(checkIn, 1) : undefined}
              allowPast={false}
              twoMonths={false}
              widthClassName="w-full"
            />
            <p className="m-0 mt-1.5 text-[11px] leading-4 text-neutral-500">
              Party checks out. {nights > 0 ? `${nights} ${nights === 1 ? "night" : "nights"}.` : "Must be after arrival."}
            </p>
          </div>
          <div className="min-w-0">
            <DatePickerField
              label="Names needed by"
              value={cutOffAt}
              onChangeAction={setCutOffAt}
              max={checkOut || undefined}
              allowPast={false}
              twoMonths={false}
              widthClassName="w-full"
            />
            <p className={`m-0 mt-1.5 text-[11px] leading-4 ${lateCutOff ? "text-amber-700" : "text-neutral-500"}`}>
              {lateCutOff
                ? `On or after arrival, so unsold rooms cannot be resold in time.`
                : `Held until ${cutOffLabel}, then back on sale.`}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-3.5">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Rooms to hold</p>
            <span className="text-xs font-semibold text-neutral-500">{nights} {nights === 1 ? "night" : "nights"}</span>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_84px_minmax(0,140px)_32px] items-center gap-2">
                <select
                  aria-label="Room type"
                  className="box-border h-10 w-full min-w-0 cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-sm"
                  value={line.roomTypeId}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : "";
                    const fallback = roomTypes.find((type) => type.id === Number(id))?.baseRate;
                    setLine(index, { roomTypeId: id, ...(line.nightlyRate ? {} : { nightlyRate: fallback ? String(fallback) : "" }) });
                  }}
                >
                  <option value="">Choose a room type</option>
                  {roomTypes.map((type) => (
                    <option key={type.id} value={type.id} disabled={usedTypeIds.includes(type.id) && line.roomTypeId !== type.id}>{type.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  aria-label="Rooms"
                  className="box-border h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-sm tabular-nums"
                  value={line.quantity}
                  onChange={(e) => setLine(index, { quantity: Math.max(1, Number(e.target.value || 1)) })}
                />
                <input
                  type="number"
                  min={0}
                  aria-label="Agreed nightly rate"
                  placeholder="Rate per night"
                  className="box-border h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-sm tabular-nums"
                  value={line.nightlyRate}
                  onChange={(e) => setLine(index, { nightlyRate: e.target.value })}
                />
                <button
                  type="button"
                  aria-label="Remove this room line"
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  className="inline-flex h-8 w-8 cursor-pointer appearance-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-neutral-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLines((current) => [...current, { roomTypeId: "", quantity: 1, nightlyRate: "" }])}
            className="mt-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 py-1.5 text-xs font-bold text-neutral-700 transition hover:bg-neutral-100"
          >
            <Plus className="h-3.5 w-3.5" /> Add another room type
          </button>
        </div>

        <div>
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-xs font-semibold text-neutral-700">Who settles the bill</span>
            <span className="text-[10px] text-neutral-500">Choose where room charges and guest extras will settle.</span>
          </div>
          <BillingModeCards value={billingMode} onChange={setBillingMode} name="billingMode" />
        </div>

        <label className="block">
          <span className={labelCls}>Desk note <span className="font-normal text-neutral-400">(optional)</span></span>
          <textarea
            className="box-border min-h-20 w-full min-w-0 max-w-full resize-y rounded-xl border border-solid border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Arrival transport, meal arrangement, invoicing instructions"
          />
        </label>

        {error && <p className="m-0 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-3 border-0 border-t border-solid border-neutral-100 pt-4">
          <span className="mr-auto text-xs font-semibold text-neutral-500">
            Holding {totals.rooms} {totals.rooms === 1 ? "room" : "rooms"}
            {totals.value > 0 && ` · ${totals.value.toLocaleString()} total`}
          </span>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-4 py-2.5 text-sm font-bold text-neutral-600 transition hover:bg-neutral-50">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Hold these rooms
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}

export function GroupBlockDetailModal({
  blockId,
  accessRole = "OWNER",
  onClose,
  onChanged,
}: {
  blockId: number;
  accessRole?: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [block, setBlock] = useState<GroupBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [namingLine, setNamingLine] = useState<GroupBlockRoom | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showRoomingList, setShowRoomingList] = useState(false);
  const [draft, setDraft] = useState({ name: "", agencyName: "", contactName: "", contactPhone: "", contactEmail: "", cutOffAt: "", billingMode: "INDIVIDUAL", notes: "" });
  const [roomAmendments, setRoomAmendments] = useState<Array<{ id: number; roomTypeName: string; quantity: string; nightlyRate: string }>>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestNationality, setGuestNationality] = useState("");
  const [agencyPaymentAmount, setAgencyPaymentAmount] = useState("");
  const [agencyPaymentMethod, setAgencyPaymentMethod] = useState("BANK");
  const [agencyPaymentReference, setAgencyPaymentReference] = useState("");
  const [proFormaError, setProFormaError] = useState<{ message: string; code?: string } | null>(null);
  const [proFormaNotice, setProFormaNotice] = useState<string | null>(null);
  const [statementNotice, setStatementNotice] = useState<string | null>(null);
  const [showManualBank, setShowManualBank] = useState(false);
  const [showManualAccountNumber, setShowManualAccountNumber] = useState(false);
  const [manualBankBusy, setManualBankBusy] = useState(false);
  const [manualBankError, setManualBankError] = useState<string | null>(null);
  const [manualBankPolicyAccepted, setManualBankPolicyAccepted] = useState(false);
  const [manualBank, setManualBank] = useState({ bankName: "", accountName: "", accountNumber: "", accountCurrency: "TZS", branchName: "", bankAddress: "", swiftCode: "", iban: "", routingCode: "", instructions: "" });
  const [voidingAgencyPaymentId, setVoidingAgencyPaymentId] = useState<number | null>(null);
  const [agencyPaymentVoidReason, setAgencyPaymentVoidReason] = useState("");
  const [agencyPaymentVoidError, setAgencyPaymentVoidError] = useState<string | null>(null);
  const [agencyRefundAmount, setAgencyRefundAmount] = useState("");
  const [agencyRefundMethod, setAgencyRefundMethod] = useState("BANK");
  const [agencyRefundReference, setAgencyRefundReference] = useState("");
  const [agencyRefundReason, setAgencyRefundReason] = useState("");
  const [voidingAgencyRefundId, setVoidingAgencyRefundId] = useState<number | null>(null);
  const [agencyRefundVoidReason, setAgencyRefundVoidReason] = useState("");
  const [agencyRefundError, setAgencyRefundError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const response = await apiClient.get<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}`);
    const next: GroupBlock | null = response.data?.block ?? null;
    setBlock(next);
    return next;
  }, [blockId]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}`)
      .then((r) => { if (!cancelled) setBlock(r.data?.block ?? null); })
      .catch((e: any) => { if (!cancelled) setError(e?.response?.data?.error || "Failed to load the group block"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [blockId]);

  const openEditor = () => {
    if (!block) return;
    setDraft({
      name: block.name,
      agencyName: block.agencyName ?? "",
      contactName: block.contactName ?? "",
      contactPhone: block.contactPhone ?? "",
      contactEmail: block.contactEmail ?? "",
      cutOffAt: String(block.cutOffAt).slice(0, 10),
      billingMode: block.billingMode,
      notes: block.notes ?? "",
    });
    setRoomAmendments(block.rooms.map((room) => ({ id: room.id, roomTypeName: room.roomTypeName || "Room type", quantity: String(room.quantity), nightlyRate: String(room.nightlyRate) })));
    setError(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!block) return;
    if (draft.name.trim().length < 2) return setError("Give the block a name the desk will recognise");
    if (draft.contactName.trim().length < 2) return setError("Enter the group leader or agency contact name");
    if (!/^\S+@\S+\.\S+$/.test(draft.contactEmail.trim())) return setError("Enter the email address that should receive the group documents");
    if (draft.billingMode !== "INDIVIDUAL" && draft.agencyName.trim().length < 2) return setError("Enter the agency or company that will receive the bill");
    if (block.roomsPickedUp === 0 && roomAmendments.some((room) => !Number.isInteger(Number(room.quantity)) || Number(room.quantity) < 1 || !Number.isFinite(Number(room.nightlyRate)) || Number(room.nightlyRate) < 0)) return setError("Enter a valid quantity and rate for every room line");
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}`, {
        name: draft.name.trim(),
        agencyName: draft.agencyName.trim() || null,
        contactName: draft.contactName.trim(),
        contactPhone: draft.contactPhone.trim() || null,
        contactEmail: draft.contactEmail.trim(),
        cutOffAt: draft.cutOffAt,
        billingMode: draft.billingMode,
        notes: draft.notes.trim() || null,
        ...(block.roomsPickedUp === 0 ? { rooms: roomAmendments.map((room) => ({ id: room.id, quantity: Number(room.quantity), nightlyRate: Number(room.nightlyRate) })) } : {}),
      });
      await reload();
      await onChanged();
      setEditing(false);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to save the changes");
    } finally {
      setBusy(false);
    }
  };

  const cancelBlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/cancel`, {});
      await onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to cancel the block");
      setBusy(false);
    }
  };

  const pickUp = async () => {
    if (!namingLine) return;
    if (guestName.trim().length < 2) return setNameError("Enter the guest's full name");
    if (guestPhone.trim().length < 7) return setNameError("Enter a phone number for the guest");
    setBusy(true);
    setNameError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/pickup`, {
        blockRoomId: namingLine.id,
        guest: {
          fullName: guestName.trim(),
          phone: guestPhone.trim(),
          email: guestEmail.trim() || null,
          nationality: guestNationality.trim() || null,
        },
      });
      // Kept open on purpose: a rooming list is worked through one guest after
      // another, so the form clears and stays ready for the next name.
      setGuestName("");
      setGuestPhone("");
      setGuestEmail("");
      setGuestNationality("");
      const next = await reload();
      await onChanged();
      const line = next?.rooms.find((room) => room.id === namingLine.id) ?? null;
      setNamingLine(line && line.held > 0 ? line : null);
    } catch (e: any) {
      setNameError(e?.response?.data?.error || "Failed to name this guest");
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/release`, {});
      await onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to release the block");
      setBusy(false);
    }
  };

  const recordAgencyPayment = async () => {
    if (!block?.masterFolio) return;
    const amount = Number(agencyPaymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter the agency payment amount");
    setBusy(true);
    setError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/master-folio/payments`, {
        amount,
        method: agencyPaymentMethod,
        reference: agencyPaymentReference.trim() || null,
      });
      await reload();
      setAgencyPaymentAmount("");
      setAgencyPaymentReference("");
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to record the agency payment");
    } finally {
      setBusy(false);
    }
  };

  const generateProForma = async () => {
    setBusy(true);
    setError(null);
    setProFormaError(null);
    setProFormaNotice(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/pro-formas`, {});
      await reload();
      await onChanged();
    } catch (e: any) {
      setProFormaError({
        message: e?.response?.data?.error || "Failed to generate the Pro Forma invoice",
        code: e?.response?.data?.code,
      });
    } finally {
      setBusy(false);
    }
  };

  const openManualBank = () => {
    setManualBank((current) => ({ ...current, accountCurrency: current.accountCurrency || block?.currency || "TZS" }));
    setManualBankError(null);
    setManualBankPolicyAccepted(false);
    setShowManualAccountNumber(false);
    setShowManualBank(true);
  };

  const saveManualBank = async () => {
    if (manualBank.bankName.trim().length < 2) return setManualBankError("Enter the bank name");
    if (manualBank.accountName.trim().length < 2) return setManualBankError("Enter the account holder name");
    if (manualBank.accountNumber.trim().length < 4) return setManualBankError("Enter the bank account number");
    if (!/^[A-Za-z]{3}$/.test(manualBank.accountCurrency.trim())) return setManualBankError("Use a three-letter currency code, for example TZS or USD");
    if (!manualBankPolicyAccepted) return setManualBankError("Accept the manual bank verification policy before continuing");
    setManualBankBusy(true);
    setManualBankError(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/pro-forma-bank-account`, {
        ...manualBank,
        bankName: manualBank.bankName.trim(),
        accountName: manualBank.accountName.trim(),
        accountNumber: manualBank.accountNumber.trim(),
        accountCurrency: manualBank.accountCurrency.trim().toUpperCase(),
        branchName: manualBank.branchName.trim() || null,
        bankAddress: manualBank.bankAddress.trim() || null,
        swiftCode: manualBank.swiftCode.trim() || null,
        iban: manualBank.iban.trim() || null,
        routingCode: manualBank.routingCode.trim() || null,
        instructions: manualBank.instructions.trim() || null,
        policyAccepted: true,
      });
      const saved = response.data?.bankAccount;
      setShowManualBank(false);
      setProFormaError(null);
      setProFormaNotice(`${saved?.bankName || manualBank.bankName} account ending ${saved?.accountNumberLast4 || manualBank.accountNumber.slice(-4)} added to this property's Pro Forma instructions. You can now generate the Pro Forma.`);
      setManualBank((current) => ({ ...current, accountNumber: "" }));
      setManualBankPolicyAccepted(false);
    } catch (e: any) {
      setManualBankError(e?.response?.data?.error || "Failed to save the bank instructions");
    } finally {
      setManualBankBusy(false);
    }
  };

  const sendProForma = async (proFormaId: number) => {
    setBusy(true);
    setError(null);
    setProFormaError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/pro-formas/${proFormaId}/send`, {});
      await reload();
      await onChanged();
    } catch (e: any) {
      setProFormaError({ message: e?.response?.data?.error || "Failed to email the Pro Forma invoice", code: e?.response?.data?.code });
    } finally {
      setBusy(false);
    }
  };

  const downloadProForma = async (proFormaId: number, number: string) => {
    setBusy(true);
    setError(null);
    setProFormaError(null);
    try {
      const response = await apiClient.get<Blob>(`/api/owner/nrms/group-blocks/blocks/${blockId}/pro-formas/${proFormaId}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${number}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setProFormaError({ message: e?.response?.data?.error || "Failed to download the Pro Forma invoice", code: e?.response?.data?.code });
    } finally {
      setBusy(false);
    }
  };

  const downloadMasterStatement = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiClient.get<Blob>(`/api/owner/nrms/group-blocks/blocks/${blockId}/master-folio/statement.pdf`, { responseType: "blob" });
      const disposition = String(response.headers?.["content-disposition"] || "");
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `${block?.masterFolio?.reference || "agency-account"}.pdf`;
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to download the agency account document");
    } finally {
      setBusy(false);
    }
  };

  const sendMasterStatement = async () => {
    setBusy(true);
    setError(null);
    setStatementNotice(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/master-folio/statement/send`, {});
      setStatementNotice(`${response.data?.title === "FINAL PAYMENT RECEIPT" ? "Final receipt" : "Account statement"} sent to ${response.data?.sentToEmail || block?.contactEmail}.`);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to email the agency account document");
    } finally {
      setBusy(false);
    }
  };

  const voidAgencyPayment = async () => {
    if (!voidingAgencyPaymentId) return;
    const reason = agencyPaymentVoidReason.trim();
    if (reason.length < 2) return setAgencyPaymentVoidError("Enter a clear reason before voiding this payment");
    setBusy(true);
    setError(null);
    setAgencyPaymentVoidError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/master-folio/payments/${voidingAgencyPaymentId}/void`, { reason });
      await reload();
      setVoidingAgencyPaymentId(null);
      setAgencyPaymentVoidReason("");
      await onChanged();
    } catch (e: any) {
      setAgencyPaymentVoidError(e?.response?.data?.error || "Failed to void the agency payment");
    } finally {
      setBusy(false);
    }
  };

  const recordAgencyRefund = async () => {
    if (!block?.masterFolio) return;
    const amount = Number(agencyRefundAmount);
    if (!Number.isFinite(amount) || amount <= 0) return setAgencyRefundError("Enter the amount actually returned to the agency");
    if (agencyRefundReason.trim().length < 2) return setAgencyRefundError("Enter the reason for this refund");
    setBusy(true);
    setAgencyRefundError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/master-folio/refunds`, {
        amount,
        method: agencyRefundMethod,
        reference: agencyRefundReference.trim() || null,
        reason: agencyRefundReason.trim(),
      });
      await reload();
      setAgencyRefundAmount("");
      setAgencyRefundReference("");
      setAgencyRefundReason("");
      await onChanged();
    } catch (e: any) {
      setAgencyRefundError(e?.response?.data?.error || "Failed to record the agency refund");
    } finally {
      setBusy(false);
    }
  };

  const voidAgencyRefund = async () => {
    if (!voidingAgencyRefundId) return;
    if (agencyRefundVoidReason.trim().length < 2) return setAgencyRefundError("Enter a clear reason before voiding this refund");
    setBusy(true);
    setAgencyRefundError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/group-blocks/blocks/${blockId}/master-folio/refunds/${voidingAgencyRefundId}/void`, { reason: agencyRefundVoidReason.trim() });
      await reload();
      setVoidingAgencyRefundId(null);
      setAgencyRefundVoidReason("");
      await onChanged();
    } catch (e: any) {
      setAgencyRefundError(e?.response?.data?.error || "Failed to void the agency refund");
    } finally {
      setBusy(false);
    }
  };

  const live = block ? ["HELD", "PARTIALLY_PICKED_UP"].includes(block.status) : false;
  const canPickupRooms = ["OWNER", "MANAGER", "FRONT_DESK"].includes(accessRole);
  const canWorkRoomingList = ["OWNER", "MANAGER", "FRONT_DESK"].includes(accessRole);
  const canManageBlockAgreement = accessRole === "OWNER";
  const canVoidAgencyPayment = accessRole === "OWNER" || accessRole === "MANAGER";
  const canManageAgencyRefunds = accessRole === "OWNER" || accessRole === "MANAGER";

  return (
    <ModalFrame title={block?.name || "Group block"} onClose={onClose} extraWide>
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
      ) : !block ? (
        <p className="m-0 py-10 text-center text-sm text-neutral-500">Group block not found.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">{block.reference}</p>
              <p className="m-0 mt-1 text-sm font-bold text-neutral-900">
                {block.roomsHeld} held · {block.roomsPickedUp} picked up · {block.roomsTotal} agreed
              </p>
              {block.agencyName && <p className="m-0 mt-0.5 text-xs text-neutral-500">{block.agencyName}</p>}
            </div>
            <div className="min-w-0 sm:text-right">
              <p className="m-0 text-xs text-neutral-500">{block.nights} {block.nights === 1 ? "night" : "nights"}</p>
              <p className="m-0 mt-0.5 text-sm font-bold tabular-nums text-neutral-900">{block.blockValue.toLocaleString()} {block.currency}</p>
            </div>
          </div>

          {block.billingMode !== "INDIVIDUAL" && (
            <div className="rounded-xl border border-solid border-sky-200 bg-sky-50 p-4">
              {!block.masterFolio ? (
                <div>
                  <p className="m-0 text-sm font-bold text-sky-950">Agency master folio</p>
                  <p className="m-0 mt-1 text-xs leading-5 text-sky-800">The agency account is being prepared. Refresh the group before generating a document.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-600">{block.masterFolio.reference}</p>
                      <p className="m-0 mt-1 text-sm font-bold text-sky-950">Bill to {block.masterFolio.billToName}</p>
                      <p className="m-0 mt-0.5 text-xs text-sky-800">{block.billingMode === "SPLIT" ? "Rooms on agency; extras on guests" : "Rooms and extras on agency"}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${block.masterFolio.status === "SETTLED" ? "bg-emerald-100 text-emerald-800" : block.masterFolio.status === "CREDIT" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>
                      {block.masterFolio.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-lg bg-white p-3"><p className="m-0 text-[10px] font-semibold uppercase text-neutral-400">Quoted</p><p className="m-0 mt-1 text-sm font-bold tabular-nums text-neutral-900">{block.masterFolio.quoted.toLocaleString()}</p></div>
                    <div className="rounded-lg bg-white p-3"><p className="m-0 text-[10px] font-semibold uppercase text-neutral-400">Billed</p><p className="m-0 mt-1 text-sm font-bold tabular-nums text-neutral-900">{block.masterFolio.billed.toLocaleString()}</p></div>
                    <div className="rounded-lg bg-white p-3"><p className="m-0 text-[10px] font-semibold uppercase text-neutral-400">Net paid</p><p className="m-0 mt-1 text-sm font-bold tabular-nums text-neutral-900">{block.masterFolio.paid.toLocaleString()}</p>{block.masterFolio.refunded > 0 && <p className="m-0 mt-0.5 text-[9px] text-neutral-500">Received {block.masterFolio.paymentsReceived.toLocaleString()} · refunded {block.masterFolio.refunded.toLocaleString()}</p>}</div>
                    <div className="rounded-lg bg-white p-3"><p className="m-0 text-[10px] font-semibold uppercase text-neutral-400">{block.masterFolio.credit > 0.005 ? "Credit to refund" : "Payment due"}</p><p className={`m-0 mt-1 text-sm font-bold tabular-nums ${block.masterFolio.credit > 0.005 ? "text-blue-800" : "text-sky-950"}`}>{(block.masterFolio.credit > 0.005 ? block.masterFolio.credit : block.masterFolio.paymentDue).toLocaleString()} {block.masterFolio.currency}</p></div>
                  </div>

                  <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><FileText className="h-4 w-4" /></span>
                        <div className="min-w-0">
                          <p className="m-0 text-sm font-bold text-neutral-950">Pro Forma invoice</p>
                          <p className="m-0 mt-0.5 text-[11px] leading-4 text-neutral-500">Request payment directly to the property&apos;s selected bank account.</p>
                        </div>
                      </div>
                      {block.masterFolio.status !== "SETTLED" && block.masterFolio.paymentDue > 0.005 && (
                        <button type="button" onClick={() => void generateProForma()} disabled={busy} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {block.masterFolio.proFormas.length ? "Generate revision" : "Generate Pro Forma"}
                        </button>
                      )}
                    </div>
                    {proFormaError && (
                      <div role="alert" className="mt-3 flex items-start gap-2.5 rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-2.5">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-[11px] font-semibold leading-4 text-red-800">{proFormaError.message}</p>
                          {proFormaError.code === "VERIFIED_BANK_REQUIRED" && (
                            accessRole === "OWNER" ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button type="button" onClick={openManualBank} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-red-700 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-red-800"><Landmark className="h-3 w-3" /> Add bank details here</button>
                                <a href="/owner/profile" className="inline-flex items-center rounded-md border border-solid border-red-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-red-700 no-underline hover:bg-red-100">Use a verified My Profile bank</a>
                              </div>
                            ) : (
                              <p className="m-0 mt-1 text-[10px] leading-4 text-red-700">Ask the property owner to add the bank instructions or select a verified payout bank.</p>
                            )
                          )}
                        </div>
                        <button type="button" aria-label="Dismiss Pro Forma error" onClick={() => setProFormaError(null)} className="cursor-pointer border-0 bg-transparent p-0 text-sm leading-none text-red-400 hover:text-red-700">×</button>
                      </div>
                    )}
                    {proFormaNotice && <div role="status" className="mt-3 flex items-start gap-2.5 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-3 py-2.5"><Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" /><p className="m-0 flex-1 text-[11px] font-semibold leading-4 text-emerald-800">{proFormaNotice}</p><button type="button" aria-label="Dismiss bank notice" onClick={() => setProFormaNotice(null)} className="cursor-pointer border-0 bg-transparent p-0 text-sm leading-none text-emerald-500 hover:text-emerald-800">×</button></div>}
                    {block.masterFolio.proFormas.length === 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-0 border-t border-solid border-neutral-100 pt-3">
                        {["Charges and payments", "Bank instructions", "Secure QR verification"].map((item) => (
                          <span key={item} className="inline-flex items-center gap-2 text-[10px] font-semibold text-neutral-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {item}
                          </span>
                        ))}
                        {accessRole === "OWNER" && <button type="button" onClick={openManualBank} className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold text-emerald-700 underline decoration-emerald-200 underline-offset-4 hover:text-emerald-900">Use another bank for this Pro Forma</button>}
                      </div>
                    ) : (() => {
                      const proForma = block.masterFolio!.proFormas[0];
                      return (
                        <div className="mt-3 rounded-lg border border-solid border-neutral-200 bg-neutral-50 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="m-0 text-xs font-bold text-neutral-900">{proForma.number} <span className="font-semibold text-neutral-500">· Rev {proForma.revision}</span></p>
                              <p className="m-0 mt-1 text-[10px] text-neutral-500">Issued {fmtLongDate(proForma.issuedAt.slice(0, 10))} · Due {fmtLongDate(proForma.dueAt.slice(0, 10))} · Account ending {proForma.bankAccountLast4}</p>
                              {proForma.bankSource === "MANUAL_UNVERIFIED" && <p className="m-0 mt-1 text-[9px] font-bold uppercase tracking-wide text-amber-700">Manual bank · Not verified by NoLSAF or AzamPay</p>}
                            </div>
                            <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${proForma.paymentStatus === "PAID" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{proForma.paymentStatus.replace(/_/g, " ")}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-neutral-200 pt-2">
                            <p className="m-0 text-[11px] font-semibold text-neutral-700">Due now: <span className="font-bold tabular-nums text-neutral-950">{proForma.liveBalance.toLocaleString()} {proForma.currency}</span>{proForma.sentAt ? ` · Sent to ${proForma.sentToEmail}` : ""}{proForma.viewCount ? ` · Viewed ${proForma.viewCount} time${proForma.viewCount === 1 ? "" : "s"}` : ""}</p>
                            <div className="flex flex-wrap gap-1.5">
                              <button type="button" onClick={() => void downloadProForma(proForma.id, proForma.number)} disabled={busy} className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-solid border-neutral-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"><Download className="h-3 w-3" /> PDF</button>
                              <a href={proForma.publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-solid border-neutral-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-neutral-700 no-underline hover:bg-neutral-100"><Link2 className="h-3 w-3" /> Verify</a>
                              <button type="button" onClick={() => void sendProForma(proForma.id)} disabled={busy} className="inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-emerald-700 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50">{proForma.sentAt ? <Mail className="h-3 w-3" /> : <Send className="h-3 w-3" />} {proForma.sentAt ? "Resend" : `Send to ${block.contactEmail}`}</button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {block.masterFolio.status === "SETTLED" && <p className="m-0 mt-3 text-[10px] font-semibold text-emerald-800">This agency account is settled. Use the final receipt or statement rather than issuing another request for payment.</p>}
                  </div>

                  <div className="flex flex-col gap-3 rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${block.masterFolio.status === "SETTLED" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}><FileText className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <p className="m-0 text-sm font-bold text-neutral-950">{block.masterFolio.status === "SETTLED" ? "Final payment receipt" : "Agency account statement"}</p>
                        <p className="m-0 mt-0.5 text-[11px] leading-4 text-neutral-500">Consolidated charges, payments, refunds and the current balance, issued directly by this property.</p>
                        {statementNotice && <p className="m-0 mt-1 text-[10px] font-semibold text-emerald-700">{statementNotice}</p>}
                      </div>
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-2">
                      <button type="button" onClick={() => void downloadMasterStatement()} disabled={busy} className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-[10px] font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"><Download className="h-3 w-3" /> Download PDF</button>
                      <button type="button" onClick={() => void sendMasterStatement()} disabled={busy} className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-sky-700 px-3 text-[10px] font-bold text-white hover:bg-sky-800 disabled:opacity-50"><Mail className="h-3 w-3" /> Email agency</button>
                    </div>
                  </div>

                  {block.masterFolio.paymentDue > 0.005 && (
                    <div className="grid gap-2 sm:grid-cols-[1fr_160px_1fr_auto]">
                      <input className={inputCls} type="number" min="0.01" max={block.masterFolio.paymentDue} step="0.01" value={agencyPaymentAmount} onChange={(e) => setAgencyPaymentAmount(e.target.value)} placeholder={`Amount (max ${block.masterFolio.paymentDue.toLocaleString()})`} />
                      <select className={inputCls} value={agencyPaymentMethod} onChange={(e) => setAgencyPaymentMethod(e.target.value)}>
                        <option value="BANK">Bank</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="CASH">Cash</option><option value="OTHER">Other</option>
                      </select>
                      <input className={inputCls} value={agencyPaymentReference} onChange={(e) => setAgencyPaymentReference(e.target.value)} placeholder="Transfer reference (optional)" />
                      <button type="button" onClick={() => void recordAgencyPayment()} disabled={busy} className="cursor-pointer rounded-xl border-0 bg-sky-700 px-4 text-xs font-bold text-white hover:bg-sky-800 disabled:opacity-50">Record payment</button>
                    </div>
                  )}
                  {block.masterFolio.payments.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-solid border-sky-200 bg-white">
                      {block.masterFolio.payments.map((payment) => (
                        <div key={payment.id} className="border-0 border-b border-solid border-sky-100 last:border-b-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                            <div className={payment.voidedAt ? "opacity-50 line-through" : ""}>
                              <p className="m-0 text-xs font-bold text-neutral-900">{payment.amount.toLocaleString()} {block.masterFolio!.currency} · {payment.method.replace(/_/g, " ")}</p>
                              <p className="m-0 mt-0.5 text-[10px] text-neutral-500">{payment.receiptNumber}{payment.reference ? ` · ${payment.reference}` : ""}</p>
                              <p className="m-0 mt-1 text-[10px] font-semibold text-neutral-600">Paid at: {fmtDateTime(payment.createdAt)}</p>
                            </div>
                            {!payment.voidedAt && canVoidAgencyPayment && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setVoidingAgencyPaymentId(payment.id);
                                  setAgencyPaymentVoidReason("");
                                  setAgencyPaymentVoidError(null);
                                }}
                                className="cursor-pointer rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                              >
                                Void
                              </button>
                            )}
                          </div>
                          {payment.voidedAt && (
                            <p className="mx-3 mb-2 mt-0 rounded-md bg-neutral-50 px-2.5 py-2 text-[10px] text-neutral-600">
                              <span className="font-bold">Voided at:</span> {fmtDateTime(payment.voidedAt)}{payment.voidReason ? ` · Reason: ${payment.voidReason}` : ""}
                            </p>
                          )}
                          {voidingAgencyPaymentId === payment.id && (
                            <div className="border-0 border-t border-solid border-red-100 bg-red-50 p-3">
                              <p className="m-0 text-xs font-bold text-red-950">Void this agency payment?</p>
                              <p className="m-0 mt-1 text-[10px] leading-4 text-red-800">The payment will no longer settle the master folio. Enter the audit reason before continuing.</p>
                              <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-red-900" htmlFor={`agency-payment-void-reason-${payment.id}`}>Reason for voiding</label>
                              <textarea
                                id={`agency-payment-void-reason-${payment.id}`}
                                value={agencyPaymentVoidReason}
                                onChange={(event) => { setAgencyPaymentVoidReason(event.target.value); setAgencyPaymentVoidError(null); }}
                                rows={3}
                                maxLength={300}
                                autoFocus
                                placeholder="For example: Card transaction was entered twice"
                                className="mt-1.5 box-border w-full resize-y rounded-lg border border-solid border-red-200 bg-white px-3 py-2 text-xs text-neutral-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                              />
                              {agencyPaymentVoidError && <p className="m-0 mt-2 text-[10px] font-semibold text-red-700">{agencyPaymentVoidError}</p>}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button type="button" disabled={busy} onClick={() => void voidAgencyPayment()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-red-700 px-3 py-2 text-[10px] font-bold text-white transition hover:bg-red-800 disabled:opacity-50">
                                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Confirm void
                                </button>
                                <button type="button" disabled={busy} onClick={() => { setVoidingAgencyPaymentId(null); setAgencyPaymentVoidReason(""); setAgencyPaymentVoidError(null); }} className="cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-3 py-2 text-[10px] font-bold text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50">Keep payment</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {block.masterFolio.credit > 0.005 && canManageAgencyRefunds && (
                    <div className="rounded-xl border border-solid border-blue-200 bg-blue-50 p-3">
                      <div className="mb-3">
                        <p className="m-0 text-xs font-bold text-blue-950">Record money returned to the agency</p>
                        <p className="m-0 mt-0.5 text-[10px] leading-4 text-blue-800">Available credit: {block.masterFolio.credit.toLocaleString()} {block.masterFolio.currency}. Record this only after the refund has actually been sent.</p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[1fr_150px_1fr]">
                        <input className={inputCls} type="number" min="0.01" max={block.masterFolio.credit} step="0.01" value={agencyRefundAmount} onChange={(e) => { setAgencyRefundAmount(e.target.value); setAgencyRefundError(null); }} placeholder={`Refund amount (max ${block.masterFolio.credit.toLocaleString()})`} />
                        <select className={inputCls} value={agencyRefundMethod} onChange={(e) => setAgencyRefundMethod(e.target.value)}><option value="BANK">Bank</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select>
                        <input className={inputCls} value={agencyRefundReference} onChange={(e) => setAgencyRefundReference(e.target.value)} placeholder="Refund reference (optional)" />
                      </div>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <input className={inputCls} value={agencyRefundReason} onChange={(e) => { setAgencyRefundReason(e.target.value); setAgencyRefundError(null); }} maxLength={300} placeholder="Reason, for example: one room released after advance payment" />
                        <button type="button" onClick={() => void recordAgencyRefund()} disabled={busy} className="min-h-11 shrink-0 cursor-pointer rounded-xl border-0 bg-blue-700 px-4 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50">Confirm refund sent</button>
                      </div>
                      {agencyRefundError && <p className="m-0 mt-2 text-[10px] font-semibold text-red-700">{agencyRefundError}</p>}
                    </div>
                  )}
                  {block.masterFolio.refunds.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-solid border-blue-200 bg-white">
                      <div className="border-0 border-b border-solid border-blue-100 bg-blue-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-blue-800">Agency refunds</div>
                      {block.masterFolio.refunds.map((refund) => (
                        <div key={refund.id} className="border-0 border-b border-solid border-blue-100 last:border-b-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                            <div className={refund.voidedAt ? "opacity-50 line-through" : ""}>
                              <p className="m-0 text-xs font-bold text-neutral-900">-{refund.amount.toLocaleString()} {block.masterFolio!.currency} · {refund.method.replace(/_/g, " ")}</p>
                              <p className="m-0 mt-0.5 text-[10px] text-neutral-500">{refund.refundNumber}{refund.reference ? ` · ${refund.reference}` : ""}</p>
                              <p className="m-0 mt-1 text-[10px] text-neutral-600">{refund.reason} · {fmtDateTime(refund.createdAt)}</p>
                            </div>
                            {!refund.voidedAt && canManageAgencyRefunds && <button type="button" disabled={busy} onClick={() => { setVoidingAgencyRefundId(refund.id); setAgencyRefundVoidReason(""); setAgencyRefundError(null); }} className="cursor-pointer rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">Void</button>}
                          </div>
                          {refund.voidedAt && <p className="mx-3 mb-2 mt-0 rounded-md bg-neutral-50 px-2.5 py-2 text-[10px] text-neutral-600"><span className="font-bold">Voided at:</span> {fmtDateTime(refund.voidedAt)}{refund.voidReason ? ` · Reason: ${refund.voidReason}` : ""}</p>}
                          {voidingAgencyRefundId === refund.id && (
                            <div className="border-0 border-t border-solid border-red-100 bg-red-50 p-3">
                              <p className="m-0 text-xs font-bold text-red-950">Void this refund record?</p>
                              <p className="m-0 mt-1 text-[10px] text-red-800">Use this only when the refund was entered incorrectly; it restores the agency credit.</p>
                              <textarea value={agencyRefundVoidReason} onChange={(e) => { setAgencyRefundVoidReason(e.target.value); setAgencyRefundError(null); }} rows={2} maxLength={300} autoFocus placeholder="Reason for voiding" className="mt-2 box-border w-full resize-y rounded-lg border border-solid border-red-200 bg-white px-3 py-2 text-xs outline-none focus:border-red-500" />
                              {agencyRefundError && <p className="m-0 mt-2 text-[10px] font-semibold text-red-700">{agencyRefundError}</p>}
                              <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void voidAgencyRefund()} className="cursor-pointer rounded-lg border-0 bg-red-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Confirm void</button><button type="button" disabled={busy} onClick={() => { setVoidingAgencyRefundId(null); setAgencyRefundVoidReason(""); setAgencyRefundError(null); }} className="cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-3 py-2 text-[10px] font-bold text-neutral-700">Keep refund</button></div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {block.groupId && <GroupChargeRegister block={block} />}

          {block.cutOffPassed && live && (
            <div className="flex items-start gap-3 rounded-xl border border-solid border-amber-300 bg-amber-50 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="min-w-0">
                <p className="m-0 text-sm font-bold text-amber-950">The deadline for names has passed</p>
                <p className="m-0 mt-1 text-xs leading-5 text-amber-900">
                  The {block.roomsHeld} unnamed {block.roomsHeld === 1 ? "room is" : "rooms are"} back on sale already. Close the block to tidy it off the list, or use Edit details to push the deadline back if the agency is still coming.
                </p>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-solid border-neutral-200 bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="px-4 py-2.5">Room type</th>
                    <th className="px-4 py-2.5 text-center">Agreed</th>
                    <th className="px-4 py-2.5 text-center">Picked up</th>
                    <th className="px-4 py-2.5 text-center">Still held</th>
                    <th className="px-4 py-2.5 text-right">Rate per night</th>
                    <th className="px-4 py-2.5 text-right">Name a guest</th>
                  </tr>
                </thead>
                <tbody>
                  {block.rooms.map((room) => (
                    <tr key={room.id} className="border-b border-solid border-neutral-100 last:border-b-0">
                      <td className="px-4 py-2.5 font-semibold text-neutral-900">{room.roomTypeName ?? "Room type"}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums text-neutral-700">{room.quantity}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums text-neutral-700">{room.pickedUp}</td>
                      <td className="px-4 py-2.5 text-center font-semibold tabular-nums text-emerald-700">{room.held}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700">{room.nightlyRate.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right">
                        {canPickupRooms && live && room.held > 0 && (
                          <button
                            type="button"
                            onClick={() => { setNamingLine(room); setNameError(null); }}
                            className="inline-flex cursor-pointer appearance-none items-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-800"
                          >
                            <UserPlus className="h-3 w-3" /> Name a guest
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {namingLine && (
            <div className="rounded-xl border border-solid border-emerald-200 bg-emerald-50 p-4">
              <p className="m-0 text-sm font-bold text-emerald-950">Name a guest in {namingLine.roomTypeName ?? "this room type"}</p>
              <p className="m-0 mt-0.5 text-xs text-emerald-800">
                {namingLine.held} still waiting. This creates a confirmed stay for {fmtStay(block.checkIn, block.checkOut)} and adds it to the group.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input className={inputCls} value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Guest full name" autoFocus />
                <input className={inputCls} value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="Phone number" />
                <input className={inputCls} value={guestNationality} onChange={(e) => setGuestNationality(e.target.value)} placeholder="Nationality (optional)" />
                <input className={inputCls} value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="Email (optional)" />
              </div>
              {nameError && <p className="m-0 mt-3 rounded-lg border border-solid border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700">{nameError}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void pickUp()} disabled={busy} className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirm this guest
                </button>
                <button type="button" onClick={() => setNamingLine(null)} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-emerald-300 bg-white px-3.5 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50">Cancel</button>
              </div>
            </div>
          )}

          {block.notes && <p className="m-0 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-3 text-xs leading-5 text-neutral-600">{block.notes}</p>}
          {error && <p className="m-0 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          {confirmRelease && (
            <div className="rounded-xl border border-solid border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><AlertTriangle className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold text-amber-950">Release the rooms still being held?</p>
                  <p className="m-0 mt-1 text-xs leading-5 text-amber-900">
                    {block.roomsHeld} {block.roomsHeld === 1 ? "room goes" : "rooms go"} back on sale immediately.
                    {block.roomsPickedUp > 0 && ` The ${block.roomsPickedUp} already picked up stay exactly as they are, with their own rooms, folios and payments.`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void release()} disabled={busy} className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-amber-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-amber-800 disabled:opacity-50">
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Yes, release
                    </button>
                    <button type="button" onClick={() => setConfirmRelease(false)} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50">Keep holding</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {confirmCancel && (
            <div className="rounded-xl border border-solid border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><AlertTriangle className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold text-amber-950">Cancel this block?</p>
                  <p className="m-0 mt-1 text-xs leading-5 text-amber-900">
                    The agreement is called off and all {block.roomsHeld} held {block.roomsHeld === 1 ? "room goes" : "rooms go"} straight back on sale.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void cancelBlock()} disabled={busy} className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-amber-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-amber-800 disabled:opacity-50">
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Yes, cancel it
                    </button>
                    <button type="button" onClick={() => setConfirmCancel(false)} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50">Keep the block</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {editing && (
            <div className="rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-4">
              <p className="m-0 mb-3 text-sm font-bold text-neutral-900">Edit block details</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={labelCls}>Block name</span>
                  <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className="block">
                  <span className={labelCls}>Agency or company {draft.billingMode === "INDIVIDUAL" && <span className="font-normal text-neutral-400">(optional)</span>}</span>
                  <input className={inputCls} required={draft.billingMode !== "INDIVIDUAL"} value={draft.agencyName} onChange={(e) => setDraft({ ...draft, agencyName: e.target.value })} />
                </label>
                <label className="block">
                  <span className={labelCls}>Group leader or agency contact</span>
                  <input className={inputCls} required value={draft.contactName} onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} />
                </label>
                <label className="block">
                  <span className={labelCls}>Contact phone</span>
                  <input className={inputCls} value={draft.contactPhone} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} placeholder="Optional" />
                </label>
                <label className="block">
                  <span className={labelCls}>Document email</span>
                  <input className={inputCls} type="email" required value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} />
                </label>
                <div className="min-w-0">
                  <DatePickerField
                    label="Names needed by"
                    value={draft.cutOffAt}
                    onChangeAction={(next) => setDraft({ ...draft, cutOffAt: next })}
                    max={String(block.checkOut).slice(0, 10)}
                    allowPast={false}
                    twoMonths={false}
                    widthClassName="w-full"
                  />
                  <p className="m-0 mt-1.5 text-[11px] leading-4 text-neutral-500">Push this back if the agency needs longer.</p>
                </div>
              </div>
              {block.roomsPickedUp === 0 && (
                <div className="mt-3 rounded-xl border border-solid border-neutral-200 bg-white p-3">
                  <div className="mb-2 flex items-baseline justify-between gap-3"><p className="m-0 text-xs font-bold text-neutral-800">Room amendment</p><p className="m-0 text-[10px] text-neutral-500">Updates availability and supersedes the current Pro Forma.</p></div>
                  <div className="space-y-2">
                    {roomAmendments.map((room, index) => (
                      <div key={room.id} className="grid items-end gap-2 sm:grid-cols-[1fr_110px_160px]">
                        <p className="m-0 pb-3 text-xs font-semibold text-neutral-700">{room.roomTypeName}</p>
                        <label className="block"><span className={labelCls}>Rooms</span><input className={inputCls} type="number" min="1" max="200" value={room.quantity} onChange={(e) => setRoomAmendments((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: e.target.value } : item))} /></label>
                        <label className="block"><span className={labelCls}>Rate per night</span><input className={inputCls} type="number" min="0" step="0.01" value={room.nightlyRate} onChange={(e) => setRoomAmendments((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, nightlyRate: e.target.value } : item))} /></label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3">
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-xs font-semibold text-neutral-700">Who settles the bill</span>
                  <span className="text-[10px] text-neutral-500">Choose where room charges and guest extras will settle.</span>
                </div>
                <BillingModeCards value={draft.billingMode} onChange={(billingMode) => setDraft({ ...draft, billingMode })} name="editBillingMode" disabled={block.roomsPickedUp > 0} />
                {block.roomsPickedUp > 0 && <p className="m-0 mt-1.5 text-[11px] text-neutral-500">Billing responsibility is fixed after the first room is picked up.</p>}
              </div>
              <label className="mt-3 block">
                <span className={labelCls}>Desk note</span>
                <textarea
                  className="box-border min-h-16 w-full min-w-0 max-w-full resize-y rounded-xl border border-solid border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void saveEdit()} disabled={busy} className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save changes
                </button>
                <button type="button" onClick={() => setEditing(false)} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50">Discard</button>
              </div>
            </div>
          )}

          {(canWorkRoomingList || canManageBlockAgreement) && live && !confirmRelease && !confirmCancel && !editing && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 pt-4">
              {canManageBlockAgreement && (
                <button type="button" onClick={openEditor} disabled={busy} className="mr-auto cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50">
                  Edit details
                </button>
              )}
              {canWorkRoomingList && (
                <button type="button" onClick={() => setShowRoomingList(true)} disabled={busy} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-emerald-300 bg-white px-3.5 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50 disabled:opacity-50">
                  <Link2 className="h-3.5 w-3.5" /> Rooming list
                </button>
              )}
              {canManageBlockAgreement && block.roomsPickedUp === 0 && (
                <button type="button" onClick={() => setConfirmCancel(true)} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-3.5 py-2 text-xs font-bold text-neutral-600 transition hover:border-amber-300 hover:text-amber-800 disabled:opacity-50">
                  Cancel block
                </button>
              )}
              {canManageBlockAgreement && (
                <button type="button" onClick={() => setConfirmRelease(true)} disabled={busy} className="cursor-pointer rounded-lg border border-solid border-neutral-300 bg-white px-3.5 py-2 text-xs font-bold text-neutral-600 transition hover:border-amber-300 hover:text-amber-800 disabled:opacity-50">
                  Release held rooms
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showRoomingList && block && (
        <NrmsRoomingListModal
          blockId={block.id}
          blockRooms={block.rooms}
          onClose={() => setShowRoomingList(false)}
          onChanged={async () => { await reload(); await onChanged(); }}
        />
      )}

      {showManualBank && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-neutral-950/55 p-3 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-labelledby="manual-bank-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !manualBankBusy) setShowManualBank(false); }}>
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[16px] border border-solid border-neutral-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]">
            <div className="z-10 flex shrink-0 items-start justify-between gap-4 border-0 border-b border-solid border-neutral-100 bg-white px-5 py-4 sm:px-6">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Landmark className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="manual-bank-title" className="m-0 text-base font-bold text-neutral-950">Bank instructions for Pro Forma</h2>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-800">Manual · Not verified</span>
                  </div>
                  <p className="m-0 mt-1 text-[11px] leading-4 text-neutral-500">Saved only for this property&apos;s Pro Formas. Not added to My Profile or AzamPay.</p>
                </div>
              </div>
              <button type="button" aria-label="Close manual bank details" disabled={manualBankBusy} onClick={() => setShowManualBank(false)} className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-neutral-100 p-0 text-neutral-500 hover:bg-neutral-200 disabled:opacity-50"><X className="h-4 w-4" /></button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-5 sm:p-6">
              <div className="flex items-start gap-3 rounded-xl border border-solid border-amber-200 bg-amber-50 p-3.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div>
                  <p className="m-0 text-xs font-bold text-amber-950">The property owner is responsible for these instructions</p>
                  <p className="m-0 mt-1 text-[11px] leading-5 text-amber-900">NoLSAF and AzamPay will not validate this account. The agency will be told to independently confirm the bank details with the property before transferring money.</p>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2"><Building2 className="h-4 w-4 text-neutral-400" /><p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">Required bank details</p></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block"><span className={labelCls}>Bank name</span><input className={inputCls} value={manualBank.bankName} onChange={(event) => setManualBank({ ...manualBank, bankName: event.target.value })} placeholder="Bank of Tanzania" autoFocus /></label>
                  <label className="block"><span className={labelCls}>Account currency</span><input className={`${inputCls} uppercase`} value={manualBank.accountCurrency} maxLength={3} onChange={(event) => setManualBank({ ...manualBank, accountCurrency: event.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder="TZS" /></label>
                  <label className="block sm:col-span-2"><span className={labelCls}>Account holder name</span><input className={inputCls} value={manualBank.accountName} onChange={(event) => setManualBank({ ...manualBank, accountName: event.target.value })} placeholder="Property or company legal name" /></label>
                  <label className="block sm:col-span-2">
                    <span className={labelCls}>Account number</span>
                    <span className="relative block">
                      <input className={`${inputCls} pr-11 font-mono tracking-wide`} type={showManualAccountNumber ? "text" : "password"} autoComplete="off" value={manualBank.accountNumber} onChange={(event) => setManualBank({ ...manualBank, accountNumber: event.target.value })} placeholder="Enter the complete account number" />
                      <button type="button" aria-label={showManualAccountNumber ? "Hide account number" : "Show account number"} onClick={() => setShowManualAccountNumber((current) => !current)} className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">{showManualAccountNumber ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                    </span>
                    <span className="mt-1.5 flex items-center gap-1 text-[10px] text-neutral-500"><LockKeyhole className="h-3 w-3" /> Encrypted before it is stored.</span>
                  </label>
                </div>
              </div>

              <details className="group rounded-xl border border-solid border-neutral-200 bg-neutral-50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-bold text-neutral-800">International and branch details <span className="text-[10px] font-semibold text-neutral-400 group-open:hidden">Optional</span><span className="hidden text-[10px] font-semibold text-neutral-400 group-open:inline">Hide</span></summary>
                <div className="grid gap-4 border-0 border-t border-solid border-neutral-200 p-4 sm:grid-cols-2">
                  <label className="block"><span className={labelCls}>Branch name <span className="font-normal text-neutral-400">(optional)</span></span><input className={inputCls} value={manualBank.branchName} onChange={(event) => setManualBank({ ...manualBank, branchName: event.target.value })} /></label>
                  <label className="block"><span className={labelCls}>SWIFT / BIC <span className="font-normal text-neutral-400">(optional)</span></span><input className={`${inputCls} uppercase`} value={manualBank.swiftCode} onChange={(event) => setManualBank({ ...manualBank, swiftCode: event.target.value.toUpperCase() })} placeholder="ABCDEFGH" /></label>
                  <label className="block sm:col-span-2"><span className={labelCls}>IBAN <span className="font-normal text-neutral-400">(where applicable)</span></span><input className={`${inputCls} font-mono uppercase`} value={manualBank.iban} onChange={(event) => setManualBank({ ...manualBank, iban: event.target.value.toUpperCase() })} /></label>
                  <label className="block"><span className={labelCls}>Routing / clearing code <span className="font-normal text-neutral-400">(optional)</span></span><input className={inputCls} value={manualBank.routingCode} onChange={(event) => setManualBank({ ...manualBank, routingCode: event.target.value })} /></label>
                  <label className="block"><span className={labelCls}>Bank address <span className="font-normal text-neutral-400">(optional)</span></span><input className={inputCls} value={manualBank.bankAddress} onChange={(event) => setManualBank({ ...manualBank, bankAddress: event.target.value })} /></label>
                  <label className="block sm:col-span-2"><span className={labelCls}>Transfer instructions <span className="font-normal text-neutral-400">(optional)</span></span><textarea rows={3} maxLength={500} className="box-border w-full resize-y rounded-xl border border-solid border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" value={manualBank.instructions} onChange={(event) => setManualBank({ ...manualBank, instructions: event.target.value })} placeholder="Correspondent bank or transfer notes" /></label>
                </div>
              </details>

              <label className={`flex cursor-pointer items-start gap-3.5 rounded-xl border border-solid p-4 transition-all duration-200 focus-within:ring-2 focus-within:ring-emerald-500/25 ${manualBankPolicyAccepted ? "border-emerald-300 bg-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]" : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"}`}>
                <input type="checkbox" checked={manualBankPolicyAccepted} onChange={(event) => { setManualBankPolicyAccepted(event.target.checked); setManualBankError(null); }} className="sr-only" />
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${manualBankPolicyAccepted ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-400"}`}><ShieldCheck className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><strong className="text-xs text-neutral-950">Manual bank verification policy</strong><span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${manualBankPolicyAccepted ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{manualBankPolicyAccepted ? "Accepted" : "Required"}</span></span>
                  <span className="mt-1.5 block text-[11px] leading-5 text-neutral-600">I confirm I am authorised to provide this account, the details are accurate, and I accept responsibility for confirming them with the agency.</span>
                  <span className="mt-1 block text-[10px] leading-4 text-neutral-500">This account is not verified by NoLSAF or AzamPay and will not be added to My Profile or used for payouts.</span>
                </span>
                <span aria-hidden="true" className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors duration-300 ease-out ${manualBankPolicyAccepted ? "bg-emerald-600" : "bg-neutral-300"}`}>
                  <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-300 ease-out ${manualBankPolicyAccepted ? "translate-x-5" : "translate-x-0"}`} />
                </span>
              </label>

              {manualBankError && <div role="alert" className="flex items-start gap-2 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /><p className="m-0 text-xs font-semibold leading-5 text-red-800">{manualBankError}</p></div>}

              <div className="flex flex-wrap items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 pt-4">
                <button type="button" disabled={manualBankBusy} onClick={() => setShowManualBank(false)} className="cursor-pointer rounded-xl border border-solid border-neutral-300 bg-white px-4 py-2.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
                <button type="button" disabled={manualBankBusy || !manualBankPolicyAccepted} onClick={() => void saveManualBank()} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45">{manualBankBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />} Add to Pro Forma</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ModalFrame>
  );
}
