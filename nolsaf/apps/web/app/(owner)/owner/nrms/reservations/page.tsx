"use client";

// NRMS reservations (doc 7.3, 7.4): list, create external/walk-in
// reservations, and run the stay lifecycle with payments and balances.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import TablePagination from "@/components/TablePagination";
import { AlertTriangle, ArrowRight, ArrowUpDown, BadgeCheck, BedDouble, Building2, CalendarDays, CalendarPlus, Check, ChevronDown, ChevronUp, CircleDollarSign, Clock3, DoorOpen, FileClock, Filter, Globe2, History, Loader2, LockKeyhole, LogOut, Mail, Minus, Phone, Plus, Printer, ReceiptText, Search, ShieldCheck, Store, UserRound, Users, WalletCards } from "lucide-react";
import { NRMS_CHARGE_CATEGORIES, NRMS_CHARGE_CATEGORY_LABELS } from "@nolsaf/shared";
import { tallyRoomLabels } from "@/lib/roomLabels";
import { useNrms } from "../_components/NrmsProvider";
import { useNrmsAccessRole } from "../_components/NrmsAccessRole";
import ModalFrame from "../_components/NrmsModalFrame";
import NrmsBillingBlockModal, { type NrmsBillingBlock } from "../_components/NrmsBillingBlockModal";
import { NrmsDirectoryShell, NrmsLifecycleRail } from "../_components/NrmsDirectory";
import { roomReadiness, roomAssignmentRequirement } from "@/lib/nrmsRoomReadiness";
import NrmsRoomAssignmentPicker from "../_components/NrmsRoomAssignmentPicker";

type Allocation = {
  id: number;
  roomTypeId: number;
  roomTypeName?: string;
  roomUnitId: number | null;
  roomUnitCode: string | null;
  roomUnitFloor?: number | null;
  status: string;
};

type Payment = {
  id: number;
  amount: number | null;
  currency: string;
  method: string;
  reference: string | null;
  voidedAt: string | null;
  createdAt: string;
};

type Charge = {
  id: number;
  category: string;
  description: string | null;
  amount: number | null;
  currency: string;
  voidedAt: string | null;
  voidReason?: string | null;
  createdAt: string;
  outletOrder?: {
    id: number;
    orderNumber: string;
    status: string;
    settlementMode: string;
    outlet: { id: number; name: string; type: string };
    items: Array<{ id: number; name: string; quantity: number; lineTotal: number | null }>;
  } | null;
};

type OutletOrder = {
  id: number;
  orderNumber: string;
  status: string;
  settlementMode: string;
  settlementMethod: string | null;
  currency: string;
  total: number | null;
  note: string | null;
  confirmedAt: string | null;
  servedAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  outlet: { id: number; name: string; type: string };
  settledBy: { fullName: string | null; name: string | null; email: string } | null;
  items: Array<{ id: number; name: string; quantity: number; lineTotal: number | null }>;
};

type Reservation = {
  id: number;
  bookingId: number | null;
  source: string;
  status: string;
  checkIn: string;
  checkOut: string;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  earlyCheckInApproved?: boolean;
  earlyCheckInResolution?: {
    resolution: "APPROVE_EARLY_CHECKIN";
    reason: string | null;
    operationalArrival: string | null;
    createdAt: string;
    actorId: number | null;
  } | null;
  adults: number;
  children: number;
  currency: string;
  totalAmount: number | null;
  amountPaid: number | null;
  chargesTotal: number | null;
  transferredToMaster: number;
  balance: number | null;
  effectivePaid?: number;
  supersededByRooms?: boolean;
  agencySettlement: {
    source: "GROUP" | "AGENT_BOOKING";
    /** Present only for AGENT_BOOKING: what the agency paid on its own folio. */
    paidAmount?: number;
    billingMode: string;
    masterFolioReference: string;
    status: string;
    settled: boolean;
    settledAt: string | null;
    methods: string[];
  } | null;
  cancelReason: string | null;
  guestProfile: { id: number; fullName: string; phone: string | null; email: string | null; nationality: string | null } | null;
  marketplaceBooking: {
    id: number;
    reference: string;
    status: string;
    guestName: string | null;
    guestPhone: string | null;
    guestEmail: string | null;
    nationality: string | null;
    sex: string | null;
    ageGroup: string | null;
    roomsQty: number;
    totalAmount: number | null;
    customerPaidTotal: number | null;
    accommodationGross: number | null;
    transportFare: number;
    commissionPercent: number | null;
    commissionAmount: number | null;
    ownerPayout: number | null;
    financialStatus: "RECORDED" | "CALCULATED" | "UNAVAILABLE";
    financialReviewReason: string | null;
    paymentStatus: string | null;
    paymentMethod: string | null;
    invoiceIssuedAt: string | null;
    invoiceVerifiedAt: string | null;
    invoiceApprovedAt: string | null;
    invoicePaidAt: string | null;
    receiptNumber: string | null;
    ownerInvoice: {
      reference: string | null;
      status: string;
      amount: number | null;
      issuedAt: string | null;
      verifiedAt: string | null;
      approvedAt: string | null;
      paidAt: string | null;
    } | null;
    ownerDisbursement: {
      status: string;
      amount: number | null;
      currency: string;
      channel: string | null;
      paidAt: string | null;
    } | null;
    /** The reference the guest holds, shown instead of the internal id. */
    invoiceNumber: string | null;
    checkInCodeStatus: string | null;
  } | null;
  allocations?: Allocation[];
  payments?: Payment[];
  charges?: Charge[];
  outletOrders?: OutletOrder[];
  group: { id: number; reference: string; name: string; status: string } | null;
  agentBooking: {
    requestId: number;
    guestManifestStatus: string;
    incidentalBilling: string | null;
    travellerCount: number;
    agencyName: string | null;
    leadGuest: { fullName: string | null; phone: string | null; nationality: string | null } | null;
  } | null;
};

type GuestSearchResult = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  reservationCount: number;
  lastStay: { checkIn: string; checkOut: string; status: string } | null;
};

type GuestHistory = GuestSearchResult & {
  notes?: string | null;
  createdAt?: string | null;
  reservations: Array<{ id: number; bookingId: number | null; commercialManaged?: boolean; status: string; source: string; checkIn: string; checkOut: string; currency: string; totalAmount: number | null; amountPaid?: number | null; chargesTotal?: number; transferredToMaster?: number; balance?: number | null }>;
};

type RoomType = {
  id: number;
  name: string;
  baseRate: number | null;
  currency: string;
  units: Array<{ id: number; code: string; floor?: number | null; status: string; housekeepingStatus?: string | null }>;
};
type CreateDefaults = { checkIn?: string; roomTypeId?: number; roomUnitId?: number };
type SortField = "guest" | "phone" | "nationality" | "checkIn" | "source" | "adults" | "amountPaid" | "balance" | "status";
type SortOrder = "asc" | "desc";

const STATUS_CLS: Record<string, string> = {
  HELD: "bg-amber-50 text-amber-700",
  CONFIRMED: "bg-blue-50 text-blue-700",
  CHECKED_IN: "bg-emerald-50 text-emerald-700",
  CHECKED_OUT: "bg-neutral-100 text-neutral-600",
  CANCELLED: "bg-red-50 text-red-600",
  NO_SHOW: "bg-red-50 text-red-600",
  DRAFT: "bg-neutral-100 text-neutral-500",
  EXPIRED: "bg-neutral-100 text-neutral-500",
};

const MANUAL_CHARGE_CATEGORIES = NRMS_CHARGE_CATEGORIES.filter(
  (category) => category !== "RESTAURANT" && category !== "BAR",
);

const SOURCES = ["NOLSAF", "WALK_IN", "PHONE", "DIRECT", "AIRBNB", "BOOKING_COM", "EXPEDIA", "OTHER"];
const SOURCE_LABEL: Record<string, string> = {
  NOLSAF: "NoLSAF",
  WALK_IN: "Walk-in",
  PHONE: "Phone",
  DIRECT: "Direct link",
  AIRBNB: "Airbnb",
  BOOKING_COM: "Booking.com",
  EXPEDIA: "Expedia",
  OTHER: "Other",
};
const SOURCE_STYLE: Record<string, { row: string; badge: string; dot: string }> = {
  NOLSAF: {
    row: "bg-emerald-50/55 hover:bg-emerald-100/70",
    badge: "border-emerald-200 bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-600",
  },
  WALK_IN: {
    row: "bg-emerald-50/55 hover:bg-emerald-100/70",
    badge: "border-emerald-200 bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-500",
  },
  PHONE: {
    row: "bg-sky-50/60 hover:bg-sky-100/75",
    badge: "border-sky-200 bg-sky-100 text-sky-800",
    dot: "bg-sky-500",
  },
  DIRECT: {
    row: "bg-teal-50/60 hover:bg-teal-100/75",
    badge: "border-teal-200 bg-teal-100 text-teal-800",
    dot: "bg-teal-500",
  },
  AIRBNB: {
    row: "bg-rose-50/55 hover:bg-rose-100/70",
    badge: "border-rose-200 bg-rose-100 text-rose-800",
    dot: "bg-rose-500",
  },
  BOOKING_COM: {
    row: "bg-blue-50/60 hover:bg-blue-100/75",
    badge: "border-blue-200 bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
  },
  EXPEDIA: {
    row: "bg-amber-50/65 hover:bg-amber-100/80",
    badge: "border-amber-200 bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
  },
  OTHER: {
    row: "bg-violet-50/55 hover:bg-violet-100/70",
    badge: "border-violet-200 bg-violet-100 text-violet-800",
    dot: "bg-violet-500",
  },
};
const DEFAULT_SOURCE_STYLE = {
  row: "bg-neutral-50/40 hover:bg-neutral-100/70",
  badge: "border-neutral-200 bg-neutral-100 text-neutral-700",
  dot: "bg-neutral-400",
};
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile money",
  BANK: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};
const PAGE_SIZE = 10;

const inputCls =
  "h-11 w-full min-w-0 max-w-full box-border rounded-xl border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

function fmtDate(v: string): string {
  return new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fmtChargeTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Timestamp unavailable";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "--";
  return `${part("day")}/${part("month")}/${part("year")} · ${part("hour")}:${part("minute")}:${part("second")} EAT`;
}

function money(v: number | null, currency: string): string {
  return v == null ? "-" : `${currency} ${v.toLocaleString()}`;
}

function allocationRoomLabel(allocation: Allocation): string | undefined {
  if ((allocation.roomUnitId == null || !allocation.roomUnitCode)) return allocation.roomTypeName;
  if (allocation.roomUnitFloor == null) return allocation.roomUnitCode;
  return `${allocation.roomUnitCode} · ${allocation.roomUnitFloor === 0 ? "Floor G" : `Floor ${allocation.roomUnitFloor}`}`;
}

function ReservationRoomIdentity({ allocations }: { allocations: Allocation[] }) {
  const active = allocations.filter((allocation) => allocation.status === "ACTIVE");
  const assigned = active.filter((allocation) => allocation.roomUnitId != null && allocation.roomUnitCode);
  const unassigned = active.filter((allocation) => (allocation.roomUnitId == null || !allocation.roomUnitCode));
  const roomNames = tallyRoomLabels(assigned.map((allocation) => allocation.roomUnitCode), "");
  const categoryNames = tallyRoomLabels(unassigned.map((allocation) => allocation.roomTypeName), "Room");
  const floors = [...new Set(assigned.flatMap((allocation) => allocation.roomUnitFloor == null ? [] : [allocation.roomUnitFloor]))].sort((a, b) => a - b);
  const floorText = floors.length === 1
    ? floors[0] === 0 ? "Ground" : `Floor ${floors[0]}`
    : floors.length > 1
      ? `${floors.length} floors`
      : null;
  const title = tallyRoomLabels(active.map(allocationRoomLabel), "Unassigned");

  if (assigned.length === 0) {
    return <div className="grid w-full min-w-[13rem] max-w-[15rem] grid-cols-[28px_minmax(0,1fr)_1px_74px] items-center gap-2 whitespace-nowrap" title={`${categoryNames} · unit unassigned`}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"><DoorOpen className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 truncate text-xs font-bold text-amber-800">{categoryNames}</span>
      <span className="h-4 w-px bg-amber-200" aria-hidden="true" />
      <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-amber-700">Pending</span>
    </div>;
  }

  return <div className="grid w-full min-w-[13rem] max-w-[15rem] grid-cols-[28px_minmax(0,1fr)_1px_74px] items-center gap-2 whitespace-nowrap" title={title}>
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100"><BedDouble className="h-3.5 w-3.5" /></span>
    <span className="min-w-0 truncate text-xs font-bold text-neutral-900">{roomNames}</span>
    <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
    {floorText ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-neutral-500"><Building2 className="h-3 w-3 shrink-0 text-emerald-700" />{floorText}</span> : <span className={`text-[10px] font-medium ${unassigned.length > 0 ? "text-amber-700" : "text-neutral-300"}`}>{unassigned.length > 0 ? "+ pending" : "No floor"}</span>}
  </div>;
}

function MarketplaceSettlement({ reservation }: { reservation: Reservation }) {
  const marketplace = reservation.marketplaceBooking;
  if (!marketplace) return null;
  const customerPaymentStatus = (marketplace.paymentStatus ?? "PENDING").toUpperCase();
  const customerPaymentLabel = ["PAID", "CUSTOMER_PAID"].includes(customerPaymentStatus)
    ? "received"
    : customerPaymentStatus.replace(/_/g, " ").toLowerCase();
  const hasAccommodationCommission = (marketplace.commissionPercent ?? 0) > 0 || (marketplace.commissionAmount ?? 0) > 0;
  const ownerDisbursement = marketplace.ownerDisbursement;
  const ownerDisbursed = ownerDisbursement?.status?.toUpperCase() === "PAID";
  const ownerInvoiceStatus = marketplace.ownerInvoice?.status?.toUpperCase() ?? null;
  const ownerClaimRank: Record<string, number> = { DRAFT: 0, REQUESTED: 1, VERIFIED: 2, APPROVED: 3, PROCESSING: 3, PAID: 3 };
  const ownerWorkflowRank = ownerDisbursed ? 4 : ownerClaimRank[ownerInvoiceStatus ?? ""] ?? 0;
  const ownerWorkflowStages = ["Requested", "Verified", "Approved", "Disbursed"];
  const ownerDisbursementLabel = ownerDisbursed
    ? "Disbursed"
    : ownerDisbursement?.status?.replace(/_/g, " ").toLowerCase()
      ?? (["PAID", "PROCESSING"].includes(ownerInvoiceStatus ?? "")
        ? "Awaiting disbursement"
        : ownerInvoiceStatus?.replace(/_/g, " ").toLowerCase())
      ?? "Not requested";

  return <section className="overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm shadow-neutral-200/40">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-4 shadow-[inset_3px_0_0_0_#059669]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 ring-1 ring-inset ring-emerald-200"><ShieldCheck className="h-4.5 w-4.5" /></span>
        <div className="min-w-0"><p className="m-0 text-sm font-bold text-neutral-950">Marketplace settlement</p><p className="mb-0 mt-1 text-[11px] leading-5 text-neutral-600">NoLSAF holds the booking payment; NRMS manages the room and property incidentals.</p></div>
      </div>
      <div className="flex shrink-0 items-center gap-2"><span className="font-mono text-[11px] text-neutral-500">{marketplace.invoiceNumber ?? marketplace.reference}</span><span className={`rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] ${customerPaymentStatus === "PAID" || customerPaymentStatus === "CUSTOMER_PAID" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>Guest payment {customerPaymentLabel}</span></div>
    </header>

    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-600">Owner payout workflow</p><span className="text-[10px] font-bold capitalize text-neutral-700">{ownerDisbursementLabel}</span></div>
    <div className="grid grid-cols-4 gap-px border-b border-neutral-200 bg-neutral-200" aria-label={`Owner payout status: ${ownerDisbursementLabel}`}>
      {ownerWorkflowStages.map((stage, index) => {
        const reached = ownerWorkflowRank >= index + 1;
        return <div key={stage} className={`flex min-w-0 items-center gap-2 px-3 py-2.5 ${reached ? "bg-emerald-50 text-emerald-800" : "bg-neutral-50 text-neutral-400"}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${reached ? "border-emerald-500 bg-emerald-600 text-white" : "border-neutral-300 bg-white"}`}>{reached ? <Check className="h-3 w-3" /> : index + 1}</span><span className="truncate text-[10px] font-bold uppercase tracking-[0.05em]">{stage}</span></div>;
      })}
    </div>

    <div className="grid gap-px border-b border-neutral-300 bg-neutral-300 lg:grid-cols-2">
      <section className="min-w-0 bg-white">
        <header className="border-b border-neutral-200 bg-neutral-50 px-4 py-2.5"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-600">NoLSAF marketplace</p></header>
        <div className="border-b border-neutral-200 px-4 py-4"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">Customer paid</p><p className="mb-0 mt-1.5 text-xl font-bold tabular-nums text-neutral-950">{money(marketplace.customerPaidTotal, reservation.currency)}</p><p className="mb-0 mt-1 text-[11px] leading-5 text-neutral-500">Accommodation{marketplace.transportFare > 0 ? " and transport" : ""} collected through NoLSAF</p></div>
        <div className="grid grid-cols-2 gap-px bg-neutral-200">
          <div className="bg-neutral-50 px-4 py-3.5"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.06em] text-neutral-500">Accommodation</p><p className="mb-0 mt-1.5 text-[13px] font-bold tabular-nums text-neutral-900">{money(marketplace.accommodationGross, reservation.currency)}</p></div>
          {hasAccommodationCommission && <div className="bg-neutral-50 px-4 py-3.5"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.06em] text-neutral-500">NoLSAF commission{marketplace.commissionPercent != null ? ` · ${marketplace.commissionPercent}%` : ""}</p><p className="mb-0 mt-1.5 text-[13px] font-bold tabular-nums text-neutral-900">{money(marketplace.commissionAmount, reservation.currency)}</p></div>}
          {marketplace.transportFare > 0 && <div className="bg-neutral-50 px-4 py-3.5"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.06em] text-neutral-500">Transport collected</p><p className="mb-0 mt-1.5 text-[13px] font-bold tabular-nums text-neutral-900">{money(marketplace.transportFare, reservation.currency)}</p></div>}
        </div>
      </section>
      <section className="min-w-0 bg-white">
        <header className="border-b border-emerald-200 bg-emerald-50 px-4 py-2.5"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-800">Property settlement</p></header>
        <div className="border-b border-emerald-200 bg-emerald-50/35 px-4 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700">Accommodation payout</p><span className={`rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.05em] ${ownerDisbursed ? "border-emerald-300 bg-white text-emerald-700" : ownerDisbursement ? "border-blue-200 bg-blue-50 text-blue-700" : "border-neutral-300 bg-white text-neutral-500"}`}>{ownerDisbursementLabel}</span></div><p className="mb-0 mt-1.5 text-xl font-bold tabular-nums text-emerald-800">{money(marketplace.ownerPayout, reservation.currency)}</p><p className="mb-0 mt-1 text-[11px] leading-5 text-neutral-600">{ownerDisbursed ? `Paid to the property${ownerDisbursement?.channel ? ` via ${ownerDisbursement.channel}` : ""}` : "Accommodation after NoLSAF commission"}</p></div>
        <div className="bg-neutral-50 px-4 py-3.5"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.06em] text-neutral-500">NRMS incidentals</p><p className="mb-0 mt-1.5 text-[13px] font-bold tabular-nums text-neutral-900">{money(reservation.chargesTotal ?? 0, reservation.currency)}</p></div>
      </section>
    </div>

    <footer className="border-t border-neutral-100 px-4 py-3 text-[11px] leading-5 text-neutral-500">
      <span>{marketplace.receiptNumber ? `Receipt ${marketplace.receiptNumber} · ` : ""}Property payout = accommodation - NoLSAF commission.</span>
    </footer>
  </section>;
}

function paymentMethodSummary(payments: Payment[] | undefined): { label: string; title: string } {
  const methods = [...new Set((payments ?? []).filter((payment) => !payment.voidedAt).map((payment) => PAYMENT_METHOD_LABEL[payment.method] ?? payment.method.replace(/_/g, " ").toLowerCase()))];
  if (methods.length === 0) return { label: "Not recorded", title: "No payment method recorded" };
  if (methods.length === 1) return { label: methods[0], title: methods[0] };
  return { label: "Mixed", title: methods.join(" + ") };
}

function reservationPaymentMethod(reservation: Reservation): { label: string; title: string; agency: boolean } {
  const guest = paymentMethodSummary(reservation.payments);
  const agency = reservation.agencySettlement;
  if (!agency) return { ...guest, agency: false };

  const agencyMethods = agency.methods.map((method) => PAYMENT_METHOD_LABEL[method] ?? method.replace(/_/g, " ").toLowerCase());
  const agencyMethod = agencyMethods.length === 0 ? "Master folio" : agencyMethods.length === 1 ? agencyMethods[0] : "Mixed";
  const state = agency.settled ? "settled" : "still due";
  if (guest.label === "Not recorded") {
    return {
      label: `Agency · ${agencyMethod}`,
      title: `${agency.masterFolioReference} · Agency bill ${state}${agencyMethods.length > 1 ? ` · ${agencyMethods.join(" + ")}` : ""}`,
      agency: true,
    };
  }
  return {
    label: "Guest + agency",
    title: `Guest: ${guest.title} · Agency: ${agencyMethod} (${agency.masterFolioReference}, ${state})`,
    agency: true,
  };
}

function staffLabel(user: OutletOrder["settledBy"]): string {
  return user?.fullName || user?.name || user?.email || "Staff member not recorded";
}

function chargeNeedsManualVerification(charge: Charge): boolean {
  return !(
    charge.outletOrder?.status === "POSTED_TO_FOLIO" &&
    charge.outletOrder?.settlementMode === "ROOM_FOLIO"
  );
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T00:00:00`).getTime();
  const end = new Date(`${checkOut}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
}

function groupSelectionEligibility(reservation: Reservation): { eligible: boolean; reason: string } {
  if (reservation.group) return { eligible: false, reason: `Already belongs to ${reservation.group.name}` };
  if (reservation.bookingId != null) return { eligible: false, reason: "NoLSAF marketplace bookings cannot be moved into NRMS groups" };
  if (reservation.agentBooking) return { eligible: false, reason: "Agency reservations are managed through their agency group and rooming list" };
  if (!["HELD", "CONFIRMED"].includes(reservation.status)) {
    return { eligible: false, reason: "Only held or confirmed reservations can be grouped before check-in" };
  }
  return { eligible: true, reason: "Select for a group reservation" };
}

function reservationsShareCommonNight(reservations: Reservation[]): boolean {
  if (reservations.length < 2) return true;
  const latestArrival = Math.max(...reservations.map((reservation) => new Date(reservation.checkIn).getTime()));
  const earliestDeparture = Math.min(...reservations.map((reservation) => new Date(reservation.checkOut).getTime()));
  return Number.isFinite(latestArrival) && Number.isFinite(earliestDeparture) && latestArrival < earliestDeparture;
}

function groupSelectionEligibilityForCohort(reservation: Reservation, selected: Reservation[]): { eligible: boolean; reason: string } {
  const base = groupSelectionEligibility(reservation);
  if (!base.eligible || selected.some((item) => item.id === reservation.id) || selected.length === 0) return base;
  if (!reservationsShareCommonNight([...selected, reservation])) {
    return { eligible: false, reason: "This stay does not share a common night with the selected party" };
  }
  return base;
}

function StayProgress({ reservation }: { reservation: Reservation }) {
  const checkIn = reservation.checkIn.slice(0, 10);
  const checkOut = reservation.checkOut.slice(0, 10);
  const today = localDateKey();
  const nights = nightsBetween(checkIn, checkOut);
  const dayMs = 24 * 60 * 60 * 1000;
  const elapsed = Math.max(0, Math.floor((new Date(`${today}T00:00:00`).getTime() - new Date(`${checkIn}T00:00:00`).getTime()) / dayMs));
  const overdueDays = Math.max(0, Math.floor((new Date(`${today}T00:00:00`).getTime() - new Date(`${checkOut}T00:00:00`).getTime()) / dayMs));
  const closed = ["CANCELLED", "NO_SHOW", "EXPIRED"].includes(reservation.status);
  const overdue = reservation.status === "CHECKED_IN" && today > checkOut;
  const completed = reservation.status === "CHECKED_OUT";
  const inHouse = reservation.status === "CHECKED_IN";
  const filled = completed || overdue ? 5 : inHouse ? Math.min(5, Math.max(1, Math.ceil(((elapsed + 1) / Math.max(nights, 1)) * 5))) : 0;
  const fillClass = overdue ? "bg-red-500" : completed || inHouse ? "bg-emerald-500" : "bg-neutral-300";
  const label = overdue
    ? `${overdueDays} ${overdueDays === 1 ? "day" : "days"} overdue`
    : completed
      ? "Completed"
      : inHouse
        ? `Night ${Math.min(elapsed + 1, nights)} of ${nights}`
        : closed
          ? "Stay closed"
          : today >= checkIn
            ? "Arrival due"
            : "Not started";

  return (
    <span className="inline-flex flex-col items-start gap-1.5" title={label}>
      <span className="inline-flex items-end gap-[3px]" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className={`w-[3px] rounded-sm ${index < filled ? fillClass : "bg-neutral-200"}`} style={{ height: `${6 + index * 2.5}px` }} />
        ))}
      </span>
      <span className={`whitespace-nowrap text-[10px] font-semibold ${overdue ? "text-red-600" : inHouse || completed ? "text-emerald-700" : "text-neutral-400"}`}>{label}</span>
    </span>
  );
}

function SelectionCheckbox({ checked, onChange, label, disabled = false, title }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition focus-within:ring-2 focus-within:ring-emerald-500/20 ${checked ? "bg-emerald-50" : "bg-transparent"} ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-white hover:shadow-sm"}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="sr-only" aria-label={label} />
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md border border-solid shadow-sm transition ${checked ? "border-emerald-700 bg-emerald-700 text-white ring-2 ring-emerald-100" : "border-neutral-300 bg-white text-transparent hover:border-emerald-400"}`} aria-hidden="true">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    </label>
  );
}

export default function NrmsReservationsPage() {
  const router = useRouter();
  const { selectedPropertyId } = useNrms();
  const { accessRole } = useNrmsAccessRole();
  const isSalesExecutive = accessRole === "SALES_EXECUTIVE";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [totalReservations, setTotalReservations] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [view, setView] = useState<"cards" | "list">("list");
  const [sortBy, setSortBy] = useState<SortField>("checkIn");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<CreateDefaults>({});
  const [selectedReservationId, setSelectedReservationId] = useState<number | null>(null);
  const [roomAssignment, setRoomAssignment] = useState<Reservation | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedReservations = useMemo(
    () => reservations.filter((reservation) => selectedIds.includes(reservation.id)),
    [reservations, selectedIds],
  );

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const [reservationResponse] = await Promise.all([
        apiClient.get<any>(`/api/owner/nrms/reservations/property/${selectedPropertyId}`, {
          params: {
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(sourceFilter ? { source: sourceFilter } : {}),
            ...(debouncedQuery ? { q: debouncedQuery } : {}),
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
            sortBy,
            sortOrder,
          },
        }),
      ]);
      setReservations(reservationResponse.data?.reservations ?? []);
      setTotalReservations(Number(reservationResponse.data?.total ?? 0));
      setStatusCounts(reservationResponse.data?.statusCounts ?? {});
      setSelectedIds((current) => current.filter((id) => (reservationResponse.data?.reservations ?? []).some((reservation: Reservation) => reservation.id === id && groupSelectionEligibility(reservation).eligible)));
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load reservations");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, page, selectedPropertyId, sortBy, sortOrder, sourceFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    try { setView(window.localStorage.getItem("nrms.reservations.view") === "cards" ? "cards" : "list"); } catch {}
  }, []);

  const changeView = (next: "cards" | "list") => {
    setView(next);
    try { window.localStorage.setItem("nrms.reservations.view", next); } catch {}
  };


  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [selectedPropertyId]);

  const changeSort = (field: SortField) => {
    if (field === sortBy) setSortOrder((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortOrder(field === "checkIn" ? "desc" : "asc");
    }
    setPage(1);
  };

  const openReservation = (reservationId: number) => {
    setSelectedReservationId(reservationId);
    const url = new URL(window.location.href);
    url.searchParams.set("reservationId", String(reservationId));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const closeReservation = () => {
    setSelectedReservationId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("reservationId");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedReservationId = Number(params.get("reservationId"));
    if (Number.isInteger(requestedReservationId) && requestedReservationId > 0) {
      setSelectedReservationId(requestedReservationId);
    }

    if (params.get("create") !== "1") return;

    if (!isSalesExecutive) {
      const roomTypeId = Number(params.get("roomTypeId"));
      const roomUnitId = Number(params.get("roomUnitId"));
      setCreateDefaults({
        checkIn: params.get("checkIn") || undefined,
        roomTypeId: Number.isInteger(roomTypeId) && roomTypeId > 0 ? roomTypeId : undefined,
        roomUnitId: Number.isInteger(roomUnitId) && roomUnitId > 0 ? roomUnitId : undefined,
      });
      setShowCreate(true);
    }
    params.delete("create");
    params.delete("checkIn");
    params.delete("roomTypeId");
    params.delete("roomUnitId");
    const remainingQuery = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ""}`);
  }, [isSalesExecutive]);

  if (!selectedPropertyId) {
    return <p className="text-sm text-neutral-500 py-10 text-center">Add a property first to manage reservations.</p>;
  }

  const reservationStages = [
    { key: "HELD", label: "Held", hint: "Awaiting confirmation or payment", count: statusCounts.HELD ?? 0, icon: Clock3, text: "text-amber-700", bar: "bg-amber-400", soft: "bg-amber-50" },
    { key: "CONFIRMED", label: "Confirmed", hint: "Arrival is secured", count: statusCounts.CONFIRMED ?? 0, icon: BadgeCheck, text: "text-blue-700", bar: "bg-blue-500", soft: "bg-blue-50" },
    { key: "CHECKED_IN", label: "Checked in", hint: "Guest is currently in house", count: statusCounts.CHECKED_IN ?? 0, icon: DoorOpen, text: "text-emerald-700", bar: "bg-emerald-500", soft: "bg-emerald-50" },
    { key: "CHECKED_OUT", label: "Checked out", hint: "Stay has been completed", count: statusCounts.CHECKED_OUT ?? 0, icon: LogOut, text: "text-neutral-600", bar: "bg-neutral-400", soft: "bg-neutral-100" },
  ];
  const activeStageLabel = reservationStages.find((stage) => stage.key === statusFilter)?.label;

  return (
    <div className="space-y-5 pb-10">
      {!isSalesExecutive && <div className="flex justify-end"><button
          type="button"
          onClick={() => {
            setCreateDefaults({});
            setShowCreate(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-3 py-2"
        >
          <Plus className="w-4 h-4" /> New reservation
        </button></div>}

      <NrmsLifecycleRail stages={reservationStages} selected={statusFilter} onSelect={(next) => { setStatusFilter(next); setPage(1); }} />

      {!isSalesExecutive && selectedIds.length > 0 && (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Users className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-bold text-emerald-950">{selectedIds.length} selected</p>
              <p className="m-0 mt-0.5 text-xs text-emerald-800">
                {selectedIds.length < 2
                  ? "Select another direct pre-arrival stay that overlaps this guest's dates."
                  : `Common stay ${fmtDate(new Date(Math.max(...selectedReservations.map((reservation) => new Date(reservation.checkIn).getTime()))).toISOString())} to ${fmtDate(new Date(Math.min(...selectedReservations.map((reservation) => new Date(reservation.checkOut).getTime()))).toISOString())} · Each folio remains separate.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSelectedIds([])} className="cursor-pointer rounded-lg border border-solid border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-100">Clear</button>
            <Link
              href={`/owner/nrms/groups?select=${selectedIds.join(",")}`}
              aria-disabled={selectedIds.length < 2}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold text-white no-underline transition ${selectedIds.length < 2 ? "pointer-events-none bg-emerald-700/40" : "bg-emerald-700 hover:bg-emerald-800"}`}
            >
              Continue to Group reservations <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      )}

      <NrmsDirectoryShell
        title={activeStageLabel ? `${activeStageLabel} reservations` : "All reservations"}
        count={totalReservations}
        loading={loading}
        query={query}
        onQueryChange={setQuery}
        placeholder="Search guest name or phone"
        view={view}
        onViewChange={changeView}
        toolbar={<div className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="h-10 appearance-none rounded-lg border border-neutral-200 bg-white pl-8 pr-8 text-xs font-semibold text-neutral-700 shadow-sm shadow-neutral-100/70 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" aria-label="Filter by reservation status"><option value="">All statuses</option>{Object.keys(STATUS_CLS).map((status) => <option key={status} value={status}>{status.replace(/_/g, " ").toLowerCase()}</option>)}</select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        </div>}
        secondaryToolbar={<div className="flex min-w-0 items-center gap-3">
          <div className="hidden shrink-0 items-center gap-2 border-r border-neutral-200 pr-3 sm:flex"><Globe2 className="h-3.5 w-3.5 text-neutral-400" /><span className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">Booking source</span></div>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto" role="group" aria-label="Filter reservations by booking source">
            <button type="button" onClick={() => { setSourceFilter(""); setPage(1); }} aria-pressed={!sourceFilter} className={`shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[10px] font-bold transition ${!sourceFilter ? "border-neutral-900 bg-neutral-900 text-white" : "border-transparent text-neutral-500 hover:border-neutral-200 hover:bg-neutral-50"}`}>All</button>
            {SOURCES.map((source) => {
              const style = SOURCE_STYLE[source] ?? DEFAULT_SOURCE_STYLE;
              const active = sourceFilter === source;
              return <button key={source} type="button" onClick={() => { setSourceFilter(active ? "" : source); setPage(1); }} aria-pressed={active} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[10px] font-bold transition ${active ? style.badge : "border-transparent text-neutral-500 hover:border-neutral-200 hover:bg-neutral-50"}`}><span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />{SOURCE_LABEL[source] ?? source}</button>;
            })}
          </div>
        </div>}
      >
      {loading ? (
        <div className="flex justify-center py-16 text-neutral-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      ) : reservations.length === 0 ? (
        <div className="border-t border-neutral-100 py-14 text-center">
          <p className="text-sm font-semibold text-neutral-700">No reservations found</p>
          <p className="mt-1 text-xs text-neutral-400">{isSalesExecutive ? "No reservations match the current filters." : "Record a walk-in, phone or external reservation to begin."}</p>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 border-t border-neutral-100 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
          {reservations.map((reservation) => {
            const activeAllocations = (reservation.allocations ?? []).filter((allocation) => allocation.status === "ACTIVE");
            // Keep this identical to ReservationRoomIdentity: if the row says
            // the physical room is pending, the assignment action must exist.
            const unassignedAllocation = activeAllocations.find((allocation) => (allocation.roomUnitId == null || !allocation.roomUnitCode)) ?? null;
            const guest = reservation.guestProfile?.fullName ?? reservation.agentBooking?.leadGuest?.fullName ?? "Guest";
            const nights = nightsBetween(reservation.checkIn.slice(0, 10), reservation.checkOut.slice(0, 10));
            const sourceStyle = SOURCE_STYLE[reservation.source] ?? DEFAULT_SOURCE_STYLE;
            return <article key={reservation.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:border-neutral-300 hover:shadow-[0_14px_30px_-24px_rgba(15,23,42,0.5)]">
              <button type="button" onClick={() => openReservation(reservation.id)} className={`block w-full border-0 px-4 py-3 text-left ${sourceStyle.row}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="m-0 truncate text-sm font-bold text-neutral-900">{guest}</p><p className="mb-0 mt-0.5 truncate text-xs text-neutral-500">{reservation.guestProfile?.phone ?? reservation.agentBooking?.leadGuest?.phone ?? "No phone recorded"}</p></div><span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_CLS[reservation.status] ?? "bg-neutral-100 text-neutral-500"}`}>{reservation.status.replace(/_/g, " ").toLowerCase()}</span></div>
              </button>
              <div className="grid grid-cols-2 gap-px bg-neutral-100"><div className="bg-white px-4 py-3"><p className="m-0 text-[10px] font-semibold text-neutral-400">Stay</p><p className="mb-0 mt-1 text-xs font-bold text-neutral-800">{fmtDate(reservation.checkIn)} to {fmtDate(reservation.checkOut)}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{nights} {nights === 1 ? "night" : "nights"}</p></div><div className="min-w-0 bg-white px-4 py-3"><p className="m-0 text-[10px] font-semibold text-neutral-400">Room</p><div className="mt-1 min-w-0 overflow-hidden"><ReservationRoomIdentity allocations={activeAllocations} /></div><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{SOURCE_LABEL[reservation.source] ?? reservation.source}</p></div></div>
              <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3"><StayProgress reservation={reservation} /><div className="flex items-center justify-end gap-2">{!isSalesExecutive && unassignedAllocation && ["CONFIRMED", "CHECKED_IN"].includes(reservation.status) && <button type="button" onClick={() => setRoomAssignment(reservation)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-bold text-white"><DoorOpen className="h-3.5 w-3.5" />Assign room</button>}<button type="button" onClick={() => openReservation(reservation.id)} className="whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-50">View</button></div></div>
            </article>;
          })}
          <div className="col-span-full"><TablePagination page={page} pageSize={PAGE_SIZE} total={totalReservations} onPageChange={setPage} /></div>
        </div>
      ) : (
        <div className="overflow-hidden border-t border-neutral-100 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1600px] border-collapse text-left text-sm [&_th]:whitespace-nowrap">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                  {!isSalesExecutive && <th className="w-11 px-3 py-3 text-center"><Users className="mx-auto h-3.5 w-3.5 text-neutral-400" aria-label="Build a reservation group" /></th>}
                  <SortableHeader label="Guest" field="guest" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <SortableHeader label="Phone" field="phone" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <SortableHeader label="Nationality" field="nationality" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <SortableHeader label="Stay" field="checkIn" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <th className="px-4 py-3">Stay progress</th>
                  <SortableHeader label="Source" field="source" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} />
                  <th className="px-4 py-3">Room</th>
                  <SortableHeader label="Guests" field="adults" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} align="center" />
                  <SortableHeader label="Paid" field="amountPaid" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} align="right" />
                  <th className="px-4 py-3 text-center">Payment method</th>
                  <SortableHeader label="Amount due" field="balance" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} align="right" />
                  <SortableHeader label="Status" field="status" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} align="center" />
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {reservations.map((reservation) => {
                  const activeAllocations = (reservation.allocations ?? []).filter((allocation) => allocation.status === "ACTIVE");
                  // `roomUnitCode` is the physical-room fact displayed in the
                  // Room column. Using roomUnitId here previously let the row
                  // show Pending while silently hiding Assign room.
                  const unassignedAllocation = activeAllocations.find((allocation) => (allocation.roomUnitId == null || !allocation.roomUnitCode)) ?? null;
                  const agentLead = reservation.agentBooking?.leadGuest ?? null;
                  const nights = nightsBetween(reservation.checkIn.slice(0, 10), reservation.checkOut.slice(0, 10));
                  const paymentMethod = reservationPaymentMethod(reservation);
                  const sourceStyle = SOURCE_STYLE[reservation.source] ?? DEFAULT_SOURCE_STYLE;
                  const isMarketplace = reservation.bookingId != null;
                  const groupEligibility = groupSelectionEligibilityForCohort(reservation, selectedReservations);
                  const agencySettlement = reservation.agencySettlement;
                  const agencyBillDue = Boolean(agencySettlement && !agencySettlement.settled);
                  const ownerDisbursement = reservation.marketplaceBooking?.ownerDisbursement ?? null;
                  const ownerDisbursementStatus = ownerDisbursement?.status?.toUpperCase() ?? null;
                  const ownerDisbursed = ownerDisbursementStatus === "PAID";
                  const ownerInvoiceStatus = reservation.marketplaceBooking?.ownerInvoice?.status?.toUpperCase() ?? null;
                  const ownerDisbursementLabel = ownerDisbursed
                    ? "Disbursed"
                    : ownerDisbursementStatus
                      ? ownerDisbursementStatus.replace(/_/g, " ").toLowerCase()
                      : ["PAID", "PROCESSING"].includes(ownerInvoiceStatus ?? "")
                        ? "Awaiting disbursement"
                        : ownerInvoiceStatus
                          ? ownerInvoiceStatus.replace(/_/g, " ").toLowerCase()
                        : "Not requested";
                  // The API resolves which ledger holds the money for this
                  // stay. The local sum is only a fallback for an older payload.
                  const countsTransferSeparately = agencySettlement?.settled && agencySettlement.source !== "AGENT_BOOKING";
                  const effectivePaid = reservation.effectivePaid ?? (Number(reservation.amountPaid ?? 0) + (countsTransferSeparately ? Number(reservation.transferredToMaster ?? 0) : 0));
                  return (
                    <tr
                      key={reservation.id}
                      tabIndex={0}
                      aria-label={`Open reservation for ${reservation.guestProfile?.fullName ?? agentLead?.fullName ?? "guest"}`}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("button, a, input, select, textarea, label, [role='button']")) return;
                        openReservation(reservation.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                        event.preventDefault();
                        openReservation(reservation.id);
                      }}
                      className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 ${sourceStyle.row}`}
                    >
                      {!isSalesExecutive && <td className="px-3 py-3.5 text-center">
                        {groupEligibility.eligible ? <SelectionCheckbox
                          label={`Select ${reservation.guestProfile?.fullName ?? "reservation"}`}
                          checked={selectedIds.includes(reservation.id)}
                          title={groupEligibility.reason}
                          onChange={(checked) => setSelectedIds((current) => checked ? [...new Set([...current, reservation.id])] : current.filter((id) => id !== reservation.id))}
                        /> : <span className="inline-block h-8 w-8" title={groupEligibility.reason} aria-label={groupEligibility.reason} />}
                      </td>}
                      {/* Two lines, never more. A long name and a long agency
                          each used to wrap, dragging every row taller. */}
                      <td className="max-w-[15rem] px-4 py-3.5">
                        <div className="truncate font-bold text-neutral-900" title={reservation.guestProfile?.fullName ?? agentLead?.fullName ?? "Guest"}>{reservation.guestProfile?.fullName ?? agentLead?.fullName ?? "Guest"}</div>
                        {reservation.group && <Link href="/owner/nrms/groups" title={reservation.group.name} className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-wide text-emerald-700 no-underline hover:underline">{reservation.group.name}</Link>}
                        {reservation.agentBooking && <Link href={`/owner/nrms/agents/requests/${reservation.agentBooking.requestId}/guests`} title={reservation.agentBooking.agencyName ?? "Agency booking"} className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-wide text-teal-700 no-underline hover:underline">{reservation.agentBooking.agencyName ?? "Agency booking"}</Link>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium text-neutral-600">
                        {reservation.guestProfile?.phone ?? agentLead?.phone ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-neutral-600">
                        {reservation.guestProfile?.nationality ?? agentLead?.nationality ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <div className="font-semibold text-neutral-800">{fmtDate(reservation.checkIn)} to {fmtDate(reservation.checkOut)}</div>
                        <div className="mt-0.5 text-xs text-neutral-400">{nights} {nights === 1 ? "night" : "nights"}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5"><StayProgress reservation={reservation} /></td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex whitespace-nowrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${sourceStyle.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${sourceStyle.dot}`} />
                          {SOURCE_LABEL[reservation.source] ?? reservation.source}
                        </span>
                      </td>
                      <td className="w-60 px-4 py-3.5">
                        <ReservationRoomIdentity allocations={activeAllocations} />
                      </td>
                      <td className="px-4 py-3.5 text-center text-neutral-600">
                        {isMarketplace ? <>{reservation.marketplaceBooking?.roomsQty ?? 1}<span className="ml-1 text-xs text-neutral-400">room(s)</span></> : <>{reservation.adults + reservation.children}<span className="ml-1 text-xs text-neutral-400">total</span></>}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3.5 text-right font-semibold ${isMarketplace || effectivePaid > 0 ? "text-emerald-700" : agencyBillDue ? "text-amber-700" : "text-neutral-400"}`}>
                        {reservation.supersededByRooms ? <span className="text-neutral-400">On the room stays</span> : isMarketplace ? (
                          <>
                            <span className="block">{money(reservation.marketplaceBooking?.ownerPayout ?? null, reservation.currency)}</span>
                            <span className={`mt-0.5 block text-[9px] font-bold uppercase tracking-wide ${ownerDisbursed ? "text-emerald-700" : "text-neutral-500"}`}>{ownerDisbursed ? "Disbursed to property" : "Owner entitlement"}</span>
                          </>
                        ) : (
                          <>
                            <span className="block">{money(effectivePaid, reservation.currency)}</span>
                            {agencySettlement && (
                              <span className={`mt-0.5 block text-[9px] font-bold uppercase tracking-wide ${agencySettlement.settled ? "text-emerald-600" : "text-amber-600"}`}>
                                {agencySettlement.settled ? "Paid by agency" : "Agency payment pending"}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-center">
                        <span
                          title={isMarketplace ? `${ownerDisbursementLabel}${ownerDisbursement?.channel ? ` via ${ownerDisbursement.channel}` : ""}` : paymentMethod.title}
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${isMarketplace ? ownerDisbursed ? "bg-emerald-50 text-emerald-700" : ownerDisbursement ? "bg-blue-50 text-blue-700" : "bg-neutral-100 text-neutral-500" : paymentMethod.label === "Not recorded" ? "bg-neutral-100 text-neutral-400" : agencyBillDue ? "bg-amber-50 text-amber-700" : paymentMethod.agency ? "bg-teal-50 text-teal-700" : "bg-emerald-50 text-emerald-700"}`}
                        >
                          {reservation.supersededByRooms ? "Split into rooms" : isMarketplace ? ownerDisbursementLabel : paymentMethod.label}
                        </span>
                      </td>
                      <td
                        title={agencySettlement ? `${agencySettlement.masterFolioReference} · ${agencySettlement.settled ? "settled" : "payment outstanding"}` : undefined}
                        className={`whitespace-nowrap px-4 py-3.5 text-right font-semibold ${reservation.balance != null && reservation.balance > 0 || agencyBillDue ? "text-amber-700" : "text-emerald-700"}`}
                      >
                        {reservation.supersededByRooms ? <span className="font-semibold text-neutral-400">Replaced by rooms</span> : isMarketplace ? "No guest balance" : reservation.balance != null && reservation.balance > 0 ? money(reservation.balance, reservation.currency) : agencyBillDue ? "Agency bill due" : "Paid in full"}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${STATUS_CLS[reservation.status] ?? "bg-neutral-100 text-neutral-500"}`}>
                          {reservation.status.replace(/_/g, " ").toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!isSalesExecutive && unassignedAllocation && ["CONFIRMED", "CHECKED_IN"].includes(reservation.status) && (
                            <button
                              type="button"
                              onClick={() => setRoomAssignment(reservation)}
                              title="Assign a room number from the paid room category"
                              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-800"
                            >
                              <DoorOpen className="h-3.5 w-3.5" />
                              Assign room
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openReservation(reservation.id)}
                            className="whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} pageSize={PAGE_SIZE} total={totalReservations} onPageChange={setPage} />
        </div>
      )}
      </NrmsDirectoryShell>

      {!isSalesExecutive && showCreate && (
        <CreateReservationModal
          propertyId={selectedPropertyId}
          initialCheckIn={createDefaults.checkIn}
          initialRoomTypeId={createDefaults.roomTypeId}
          initialRoomUnitId={createDefaults.roomUnitId}
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            if (page === 1) await load();
            else setPage(1);
          }}
        />
      )}
      {selectedReservationId && (
        <ReservationDetailModal
          reservationId={selectedReservationId}
          readOnly={isSalesExecutive}
          onClose={closeReservation}
          onChanged={load}
          onAssignRoom={(reservation) => { closeReservation(); setRoomAssignment(reservation); }}
        />
      )}
      {roomAssignment && selectedPropertyId && (
        <AssignRoomModal
          propertyId={selectedPropertyId}
          reservation={roomAssignment}
          onClose={() => setRoomAssignment(null)}
          onRecordPayment={() => {
            if (roomAssignment.agencySettlement) {
              router.push(roomAssignment.agentBooking ? "/owner/nrms/agents/requests/" + roomAssignment.agentBooking.requestId + "/guests" : "/owner/nrms/groups");
              return;
            }
            const reservationId = roomAssignment.id;
            setRoomAssignment(null);
            openReservation(reservationId);
          }}
          onAssigned={async () => {
            const response = await apiClient.get<any>("/api/owner/nrms/reservations/" + roomAssignment.id);
            const updated = response.data?.reservation as Reservation | undefined;
            if (!updated) throw new Error("Could not reload room assignment");
            if (roomReadiness(updated).ready) { setRoomAssignment(null); openReservation(updated.id); }
            else setRoomAssignment(updated);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AssignRoomModal({
  propertyId,
  reservation,
  onClose,
  onRecordPayment,
  onAssigned,
}: {
  propertyId: number;
  reservation: Reservation;
  onClose: () => void;
  onRecordPayment: () => void;
  onAssigned: () => Promise<void>;
}) {
  const allocation = (reservation.allocations ?? []).find((item) => item.status === "ACTIVE" && (item.roomUnitId == null || !item.roomUnitCode)) ?? null;
  const requirement = roomAssignmentRequirement(reservation);
  const [units, setUnits] = useState<Array<{ id: number; code: string; floor?: number | null; housekeepingStatus?: string | null }>>([]);
  const [totalFloors, setTotalFloors] = useState<number | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guestName = reservation.guestProfile?.fullName ?? reservation.marketplaceBooking?.guestName ?? "Guest";

  useEffect(() => {
    if (!allocation || !requirement.ready) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSelectedUnitId("");
    setError(null);
    Promise.all([
      apiClient.get<any>(`/api/owner/nrms/rooms/${propertyId}`),
      apiClient.get<any>(`/api/owner/nrms/rooms/${propertyId}/availability`, {
        params: { roomTypeId: allocation.roomTypeId, checkIn: reservation.checkIn, checkOut: reservation.checkOut },
      }),
    ])
      .then(([roomsResponse, availabilityResponse]) => {
        if (cancelled) return;
        setTotalFloors(roomsResponse.data?.property?.totalFloors ?? null);
        const roomType = (roomsResponse.data?.roomTypes ?? []).find((item: RoomType) => item.id === allocation.roomTypeId) as RoomType | undefined;
        const availableIds = new Set<number>(
          (availabilityResponse.data?.units ?? [])
            .filter((item: any) => item.available)
            .map((item: any) => Number(item.id)),
        );
        setUnits((roomType?.units ?? []).filter((unit) => unit.status === "ACTIVE" && availableIds.has(unit.id)));
      })
      .catch((requestError: any) => {
        if (!cancelled) setError(requestError?.response?.data?.error || "Could not load available room numbers");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [allocation, propertyId, requirement.ready, reservation.checkIn, reservation.checkOut]);

  const assign = async () => {
    if (!allocation || selectedUnitId === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservation.id}/move-room`, {
        allocationId: allocation.id,
        roomUnitId: Number(selectedUnitId),
        reason: "Assigned from the NRMS reservations register",
      });
      await onAssigned();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "The room could not be assigned");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="Assign a room"
      subtitle={guestName}
      icon={<DoorOpen className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={requirement.ready ? (
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void assign()} disabled={busy || selectedUnitId === "" || loading} className="inline-flex min-w-32 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-emerald-700 bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {busy ? "Assigning..." : "Assign room"}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50">Cancel</button>
          {requirement.kind === "RECORD_PAYMENT" && (
            <button type="button" onClick={onRecordPayment} className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-emerald-700 bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800"><CircleDollarSign className="h-4 w-4" />{reservation.agencySettlement ? "Open agency folio" : "Record payment"}</button>
          )}
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-neutral-100 py-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-bold text-neutral-950">{guestName}</p>
            <p className="mb-0 mt-1 text-xs text-neutral-500">{fmtDate(reservation.checkIn)} to {fmtDate(reservation.checkOut)} · {nightsBetween(reservation.checkIn.slice(0, 10), reservation.checkOut.slice(0, 10))} nights</p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${requirement.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {requirement.ready ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {requirement.ready ? (reservation.bookingId != null ? "NoLSAF booking confirmed" : "Payment recorded") : "Action required"}
          </span>
        </div>

        {requirement.ready ? (
          <NrmsRoomAssignmentPicker
            roomTypeName={allocation?.roomTypeName ?? "Room type unavailable"}
            units={units}
            totalFloors={totalFloors}
            selectedUnitId={selectedUnitId}
            onSelect={setSelectedUnitId}
            loading={loading}
            disabled={busy || !allocation}
          />
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-700 ring-1 ring-amber-200"><AlertTriangle className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-bold">Room assignment is not ready</p>
              <p className="mb-0 mt-1 text-xs leading-5 text-amber-800">{requirement.message}</p>
            </div>
          </div>
        )}

        {error && <div className="rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">{error}</div>}
      </div>
    </ModalFrame>
  );
}

function SortableHeader({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
  align = "left",
}: {
  label: string;
  field: SortField;
  sortBy: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  align?: "left" | "center" | "right";
}) {
  const active = sortBy === field;
  const alignment = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <th
      className={`px-4 py-3 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`}
      aria-sort={active ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex w-full appearance-none items-center gap-1.5 ${alignment} !m-0 !border-0 !bg-transparent !p-0 !shadow-none !outline-none transition hover:text-emerald-700 focus-visible:text-emerald-700`}
      >
        <span>{label}</span>
        {active ? (
          sortOrder === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-neutral-300" />
        )}
      </button>
    </th>
  );
}

function ReturningGuestMatches({
  guests,
  align = "left",
  loading = false,
  error = null,
  query = "",
  onSelect,
}: {
  guests: GuestSearchResult[];
  align?: "left" | "right";
  loading?: boolean;
  error?: string | null;
  query?: string;
  onSelect: (guest: GuestSearchResult) => void;
}) {
  // While a query is in flight the previous query's rows are stale, so they are
  // replaced by placeholders rather than left on screen looking like results.
  const showRows = !loading && !error && guests.length > 0;
  return (
    <span className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-20 mt-1 block w-[min(36rem,calc(100vw-3rem))] overflow-hidden rounded-md border border-neutral-300 bg-white shadow-[0_14px_35px_-18px_rgba(15,23,42,0.28)]`}>
      <span className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-800">Returning guests</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
          {loading ? <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Checking</> : error ? "Unavailable" : `${guests.length} match${guests.length === 1 ? "" : "es"}`}
        </span>
      </span>
      {loading && (
        <span className="block px-4 py-4" role="status" aria-live="polite">
          <span className="block h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <span className="block h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-emerald-200 via-emerald-500 to-emerald-200" />
          </span>
          <span className="mt-2 block text-[11px] text-neutral-500">Checking saved guest records…</span>
        </span>
      )}
      {!loading && error && <span className="block px-4 py-4 text-xs text-red-700">{error}</span>}
      {!loading && !error && guests.length === 0 && (
        <span className="block px-4 py-4 text-xs text-neutral-500">
          No returning guest matches {query ? <b className="font-semibold text-neutral-700">{query}</b> : "that search"}. Keep typing to register a new guest.
        </span>
      )}
      {showRows && <span className="hidden border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500 sm:grid sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] sm:gap-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_auto]">
        <span>Guest</span>
        <span>Phone</span>
        <span>Nationality</span>
        <span className="hidden lg:block">Email</span>
        <span className="text-right">Stays</span>
      </span>}
      {showRows && guests.map((guest, index) => (
        <button key={guest.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(guest)} className={`grid w-full cursor-pointer appearance-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 border-b px-4 py-3 text-left transition last:border-b-0 focus-visible:outline-none sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_auto] ${index % 3 === 0 ? "border-sky-100 bg-sky-50/75 hover:bg-sky-100 focus-visible:bg-sky-100" : index % 3 === 1 ? "border-amber-100 bg-amber-50/75 hover:bg-amber-100 focus-visible:bg-amber-100" : "border-violet-100 bg-violet-50/70 hover:bg-violet-100 focus-visible:bg-violet-100"}`}>
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-neutral-900">{guest.fullName}</span>
            <span className="block truncate text-[10px] text-neutral-400 sm:hidden">{guest.phone || "No contact recorded"}</span>
            <span className="hidden truncate font-mono text-[10px] text-neutral-400 sm:block">G-{String(guest.id).padStart(4, "0")}</span>
          </span>
          <span className="hidden min-w-0 truncate text-[11px] text-neutral-600 sm:block">{guest.phone || "Not recorded"}</span>
          <span className="hidden min-w-0 truncate text-[11px] text-neutral-600 sm:block">{guest.nationality || "Not recorded"}</span>
          <span className="hidden min-w-0 truncate text-[11px] text-neutral-600 lg:block">{guest.email || "Not recorded"}</span>
          <span className="shrink-0 text-right text-[10px] font-bold text-neutral-500">{guest.reservationCount} stay{guest.reservationCount === 1 ? "" : "s"}</span>
        </button>
      ))}
      <span className="block border-t border-neutral-200 bg-white px-4 py-2.5 text-[10px] font-medium text-neutral-500">Select a guest to review the full profile</span>
    </span>
  );
}

function CreateReservationModal({
  propertyId,
  initialCheckIn,
  initialRoomTypeId,
  initialRoomUnitId,
  onClose,
  onSaved,
}: {
  propertyId: number;
  initialCheckIn?: string;
  initialRoomTypeId?: number;
  initialRoomUnitId?: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const todayKey = localDateKey();
  const defaultCheckIn = initialCheckIn && initialCheckIn >= todayKey ? initialCheckIn : todayKey;
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [nationality, setNationality] = useState("");
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
  const [guestMatches, setGuestMatches] = useState<GuestSearchResult[]>([]);
  const [guestHistory, setGuestHistory] = useState<GuestHistory | null>(null);
  const [searchingGuests, setSearchingGuests] = useState(false);
  const [guestSearchError, setGuestSearchError] = useState<string | null>(null);
  const [billingBlock, setBillingBlock] = useState<NrmsBillingBlock | null>(null);
  const [showGuestMatches, setShowGuestMatches] = useState(false);
  const [guestSearchField, setGuestSearchField] = useState<"name" | "phone" | null>(null);
  const [source, setSource] = useState("WALK_IN");
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(() => shiftDate(defaultCheckIn, 1));
  const [roomTypeId, setRoomTypeId] = useState<number | "">(() => initialRoomTypeId ?? "");
  const [roomUnitId, setRoomUnitId] = useState<number | "">(() => initialRoomUnitId ?? "");
  const [adults, setAdults] = useState(1);
  const [total, setTotal] = useState<string>("");
  const [totalManuallyEdited, setTotalManuallyEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unitAvailability, setUnitAvailability] = useState<Record<number, boolean>>({});
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [previewGuest, setPreviewGuest] = useState<GuestSearchResult | null>(null);
  const [previewDetail, setPreviewDetail] = useState<GuestHistory | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    apiClient
      .get<any>(`/api/owner/nrms/rooms/${propertyId}`)
      .then((r) => setRoomTypes(r.data?.roomTypes ?? []))
      .catch(() => setRoomTypes([]));
  }, [propertyId]);

  useEffect(() => {
    const query = guestSearchField === "phone" ? guestPhone.trim() : guestSearchField === "name" ? guestName.trim() : "";
    const minimumLength = guestSearchField === "phone" ? 3 : 2;
    if (selectedGuestId || !guestSearchField || query.length < minimumLength) {
      setGuestMatches([]);
      setSearchingGuests(false);
      setGuestSearchError(null);
      return;
    }
    let cancelled = false;
    // Enter the loading state on the keystroke, not when the debounce fires.
    // Setting it inside the timer left the first 250ms with no feedback at all,
    // which reads as a dead input on anything slower than a local connection.
    setSearchingGuests(true);
    setGuestSearchError(null);
    setShowGuestMatches(true);
    const timer = window.setTimeout(() => {
      apiClient
        .get<any>(`/api/owner/nrms/guests/${propertyId}`, { params: { q: query, pageSize: 6 } })
        .then((response) => {
          if (cancelled) return;
          setGuestMatches(response.data?.guests ?? []);
          setShowGuestMatches(true);
        })
        .catch(() => {
          if (cancelled) return;
          setGuestMatches([]);
          setGuestSearchError("Guest search is unavailable right now. You can still type the name to create a new guest.");
        })
        .finally(() => {
          if (!cancelled) setSearchingGuests(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [guestName, guestPhone, guestSearchField, propertyId, selectedGuestId]);

  const openGuestPreview = async (guest: GuestSearchResult) => {
    setShowGuestMatches(false);
    setPreviewGuest(guest);
    setPreviewDetail(null);
    setPreviewLoading(true);
    try {
      const response = await apiClient.get<any>(`/api/owner/nrms/guests/${propertyId}/${guest.id}`);
      setPreviewDetail(response.data?.guest ?? { ...guest, reservations: [] });
    } catch {
      setPreviewDetail({ ...guest, reservations: [] });
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmPreviewGuest = () => {
    if (!previewGuest) return;
    const detail = previewDetail;
    setSelectedGuestId(previewGuest.id);
    setGuestName(detail?.fullName ?? previewGuest.fullName);
    setGuestPhone(detail?.phone ?? previewGuest.phone ?? "");
    setNationality(detail?.nationality ?? previewGuest.nationality ?? "");
    setGuestMatches([]);
    setShowGuestMatches(false);
    setGuestSearchField(null);
    setGuestHistory(detail ?? { ...previewGuest, reservations: [] });
    setPreviewGuest(null);
    setPreviewDetail(null);
  };

  const clearReturningGuest = () => {
    setSelectedGuestId(null);
    setGuestHistory(null);
  };

  const type = roomTypes.find((t) => t.id === roomTypeId) || null;
  const activeUnits = type ? type.units.filter((u) => u.status === "ACTIVE") : [];
  const nights = nightsBetween(checkIn, checkOut);
  const calculatedTotal = type?.baseRate != null ? Number(type.baseRate) * nights : null;
  const previewStats = useMemo(() => {
    const rows = previewDetail?.reservations ?? [];
    const spend = rows.reduce((sum, row) => sum + (row.totalAmount ?? 0) + (row.chargesTotal ?? 0), 0);
    const paid = rows.reduce((sum, row) => sum + (row.amountPaid ?? 0), 0);
    const balance = rows.reduce((sum, row) => sum + Math.max(0, row.balance ?? ((row.totalAmount ?? 0) + (row.chargesTotal ?? 0) - (row.amountPaid ?? 0) - (row.transferredToMaster ?? 0))), 0);
    return { rows, spend, paid, balance, currency: rows[0]?.currency || "TZS", stays: rows.length };
  }, [previewDetail]);

  useEffect(() => {
    if (!roomTypeId || !checkIn || !checkOut || checkOut <= checkIn) {
      setUnitAvailability({});
      return;
    }
    let cancelled = false;
    setLoadingAvailability(true);
    apiClient
      .get<any>(`/api/owner/nrms/rooms/${propertyId}/availability`, { params: { roomTypeId, checkIn, checkOut } })
      .then((r) => {
        if (cancelled) return;
        const map: Record<number, boolean> = {};
        for (const unit of r.data?.units ?? []) map[unit.id] = unit.available;
        setUnitAvailability(map);
      })
      .catch(() => {
        if (!cancelled) setUnitAvailability({});
      })
      .finally(() => {
        if (!cancelled) setLoadingAvailability(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, roomTypeId, checkIn, checkOut]);

  useEffect(() => {
    if (roomUnitId !== "" && unitAvailability[roomUnitId] === false) setRoomUnitId("");
  }, [roomUnitId, unitAvailability]);

  useEffect(() => {
    if (totalManuallyEdited) return;
    setTotal(calculatedTotal != null ? String(calculatedTotal) : "");
  }, [calculatedTotal, totalManuallyEdited]);

  const changeCheckIn = (nextCheckIn: string) => {
    setCheckIn(nextCheckIn);
    if (!checkOut || new Date(`${checkOut}T00:00:00`).getTime() <= new Date(`${nextCheckIn}T00:00:00`).getTime()) {
      setCheckOut(shiftDate(nextCheckIn, 1));
    }
  };

  const submit = async () => {
    if (!guestName.trim()) {
      setError("Guest name is required");
      return;
    }
    if (guestPhone.trim().length < 7) {
      setError("Enter a valid guest phone number");
      return;
    }
    if (!nationality.trim()) {
      setError("Guest nationality is required");
      return;
    }
    if (!checkIn || !checkOut) {
      setError("Check-in and check-out dates are required");
      return;
    }
    if (checkIn < localDateKey()) {
      setError("Past check-in dates are not allowed");
      return;
    }
    if (new Date(`${checkOut}T00:00:00`).getTime() <= new Date(`${checkIn}T00:00:00`).getTime()) {
      setError("Check-out must be after check-in");
      return;
    }
    if (!roomTypeId) {
      setError("Select a room type");
      return;
    }
    if (!total.trim() || !Number.isFinite(Number(total)) || Number(total) < 0) {
      setError("Enter the total reservation amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/property/${propertyId}`, {
        source,
        status: "CONFIRMED",
        checkIn,
        checkOut,
        adults,
        guest: {
          ...(selectedGuestId ? { guestProfileId: selectedGuestId } : {}),
          fullName: guestName.trim(),
          phone: guestPhone.trim(),
          nationality: nationality.trim(),
        },
        rooms: [{ roomTypeId: Number(roomTypeId), roomUnitId: roomUnitId === "" ? null : Number(roomUnitId) }],
        totalAmount: Number(total),
      });
      await onSaved();
    } catch (e: any) {
      const billing = e?.response?.status === 402 ? e?.response?.data?.billing : null;
      if (billing) { setBillingBlock(billing as NrmsBillingBlock); setError(null); }
      else setError(e?.response?.data?.error || "Failed to create reservation");
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="New reservation"
      subtitle="Add a guest stay and assign a room"
      icon={<CalendarPlus className="h-5 w-5" />}
      onClose={onClose}
      extraWide
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
              <Clock3 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.1em] text-neutral-400">Stay summary</p>
              <p className="mb-0 mt-0.5 truncate text-sm text-neutral-600">{nights} {nights === 1 ? "night" : "nights"}{type ? ` · ${type.name}` : " · Room not selected"}</p>
              <p className="mb-0 mt-0.5 text-lg font-semibold text-neutral-950">{total.trim() ? `${type?.currency || "TZS"} ${Number(total).toLocaleString()}` : "Total pending"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !guestName.trim() || guestPhone.trim().length < 7 || !nationality.trim() || !checkIn || !checkOut || !roomTypeId || !total.trim()}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-52"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Saving reservation..." : "Create reservation"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <section className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><UserRound className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h4 className="m-0 text-sm font-semibold text-neutral-900">Guest details</h4>
                <p className="mb-0 mt-0.5 text-xs text-neutral-500">Identity and primary contact information</p>
              </div>
            </div>
            <span className="text-[11px] text-neutral-400"><span className="text-red-500">*</span> Required fields</span>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="relative block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Guest name <span className="text-red-500">*</span></span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  required
                  autoComplete="off"
                  className={`${inputCls} pl-9 pr-3`}
                  value={guestName}
                  onFocus={() => {
                    if (guestSearchField !== "name") setGuestMatches([]);
                    setGuestSearchField("name");
                    if (guestName.trim().length >= 2) setShowGuestMatches(true);
                  }}
                  onBlur={() => setShowGuestMatches(false)}
                  onChange={(e) => {
                    clearReturningGuest();
                    setGuestSearchField("name");
                    setGuestName(e.target.value);
                  }}
                  placeholder="Search returning guest or enter a new name"
                />
              </span>
              {showGuestMatches && guestSearchField === "name" && !selectedGuestId && guestName.trim().length >= 2 && <ReturningGuestMatches guests={guestMatches} loading={searchingGuests} error={guestSearchError} query={guestName.trim()} onSelect={(guest) => void openGuestPreview(guest)} />}
            </label>
            <label className="relative block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Phone number <span className="text-red-500">*</span></span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  required
                  type="tel"
                  autoComplete="off"
                  className={`${inputCls} pl-9 pr-3`}
                  value={guestPhone}
                  onFocus={() => {
                    if (guestSearchField !== "phone") setGuestMatches([]);
                    setGuestSearchField("phone");
                    if (guestPhone.trim().length >= 3) setShowGuestMatches(true);
                  }}
                  onBlur={() => setShowGuestMatches(false)}
                  onChange={(e) => {
                    clearReturningGuest();
                    setGuestSearchField("phone");
                    setGuestPhone(e.target.value);
                  }}
                  placeholder="Search by phone or enter a new number"
                />
              </span>
              {showGuestMatches && guestSearchField === "phone" && !selectedGuestId && guestPhone.trim().length >= 3 && <ReturningGuestMatches guests={guestMatches} align="right" loading={searchingGuests} error={guestSearchError} query={guestPhone.trim()} onSelect={(guest) => void openGuestPreview(guest)} />}
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Nationality <span className="text-red-500">*</span></span>
              <input required autoComplete="country-name" className={inputCls} value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Tanzanian" />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Booking source</span>
              <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedGuestId && guestHistory && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <History className="mt-0.5 h-4 w-4 text-emerald-700" />
                  <div>
                    <p className="text-xs font-bold text-emerald-950">Returning guest profile selected</p>
                    <p className="mt-0.5 text-[11px] text-emerald-800">{guestHistory.reservations.length} previous reservation{guestHistory.reservations.length === 1 ? "" : "s"} at this property.</p>
                  </div>
                </div>
                <button type="button" onClick={clearReturningGuest} className="inline-flex shrink-0 cursor-pointer appearance-none items-center rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-900">Use a new guest</button>
              </div>
              {guestHistory.reservations.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {guestHistory.reservations.slice(0, 3).map((stay) => (
                    <div key={stay.id} className="rounded-lg border border-white bg-white/80 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{stay.status.replace(/_/g, " ")}</p>
                      <p className="mt-1 text-xs font-semibold text-neutral-800">{fmtDate(stay.checkIn)} to {fmtDate(stay.checkOut)}</p>
                      <p className="mt-0.5 text-[10px] text-neutral-500">{SOURCE_LABEL[stay.source] ?? stay.source}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 sm:p-5">
          <div className="mb-4 flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><CalendarDays className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h4 className="m-0 text-sm font-semibold text-neutral-900">Stay details</h4>
              <p className="mb-0 mt-0.5 text-xs text-neutral-500">Dates, room assignment and agreed pricing</p>
            </div>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Check-in <span className="text-red-500">*</span></span>
              <DatePickerField
                label="Check-in date"
                value={checkIn}
                onChangeAction={changeCheckIn}
                allowPast={false}
                twoMonths={false}
                widthClassName="w-full"
              />
            </div>
            <div className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Check-out <span className="text-red-500">*</span></span>
              <DatePickerField
                label="Check-out date"
                value={checkOut}
                onChangeAction={setCheckOut}
                min={checkIn ? shiftDate(checkIn, 1) : undefined}
                allowPast={false}
                twoMonths={false}
                widthClassName="w-full"
              />
            </div>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Room type <span className="text-red-500">*</span></span>
              <select
                className={inputCls}
                value={roomTypeId}
                onChange={(e) => {
                  setRoomTypeId(e.target.value ? Number(e.target.value) : "");
                  setRoomUnitId("");
                  setTotalManuallyEdited(false);
                }}
              >
                <option value="">Select room type</option>
                {roomTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">
                Room <span className="font-normal text-neutral-400">(optional{loadingAvailability ? ", checking availability..." : ""})</span>
              </span>
              <select className={inputCls} value={roomUnitId} onChange={(e) => setRoomUnitId(e.target.value ? Number(e.target.value) : "")} disabled={!type}>
                <option value="">Assign later</option>
                {activeUnits.map((u) => {
                  const occupied = unitAvailability[u.id] === false;
                  return (
                    <option key={u.id} value={u.id} disabled={occupied}>
                      {u.code}{occupied ? " (occupied)" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Adults</span>
              <div className="flex h-11 items-center justify-between rounded-xl border border-neutral-300 bg-white px-1.5">
                <button type="button" aria-label="Fewer adults" onClick={() => setAdults(Math.max(1, adults - 1))} disabled={adults <= 1} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                <span className="min-w-8 text-center text-sm font-bold text-neutral-900">{adults}</span>
                <button type="button" aria-label="More adults" onClick={() => setAdults(adults + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200"><Plus className="h-4 w-4" /></button>
              </div>
            </div>
            <label className="block min-w-0 text-sm">
              <span className="mb-1.5 block font-medium text-neutral-700">Total amount <span className="text-red-500">*</span></span>
              <span className="flex h-11 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 transition focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15">
                <span className="shrink-0 text-sm font-bold text-neutral-500">{type?.currency || "TZS"}</span>
                <input
                  required
                  type="text"
                  inputMode="numeric"
                  className="h-full w-full min-w-0 border-0 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                  value={total}
                  onChange={(e) => {
                    setTotal(e.target.value.replace(/[^\d.]/g, ""));
                    setTotalManuallyEdited(true);
                  }}
                  placeholder="90,000"
                />
              </span>
              {type?.baseRate != null && (
                <span className="mt-1.5 block text-[11px] text-neutral-400">
                  {nights} {nights === 1 ? "night" : "nights"} × {type.currency} {Number(type.baseRate).toLocaleString()}. You can edit this total.
                </span>
              )}
            </label>
          </div>
        </section>

        {billingBlock && <NrmsBillingBlockModal block={billingBlock} title="External stay paused" subtitle="The reservation was not created" reassurance="Check-ins, checkouts, folio postings, outlet orders and every existing reservation are unaffected. Only opening a new external stay is paused." onClose={() => setBillingBlock(null)} />}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

        {previewGuest && (
          <ModalFrame
            title="Guest profile"
            subtitle="Review the guest identity and stay relationship before continuing"
            icon={<UserRound className="h-5 w-5" />}
            onClose={() => { setPreviewGuest(null); setPreviewDetail(null); }}
            elevated
            wide
            compactFooter
            footer={
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex max-w-sm items-start gap-2 text-[11px] leading-4 text-neutral-500">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>Using this profile keeps the new stay attached to the guest&apos;s existing history.</span>
                </div>
                <div className="flex shrink-0 flex-col-reverse gap-2 min-[400px]:flex-row">
                  <button type="button" onClick={() => { setPreviewGuest(null); setPreviewDetail(null); }} className="inline-flex h-9 min-h-0 items-center justify-center rounded-lg border border-neutral-200 bg-white px-4 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-900">Cancel</button>
                  <button type="button" onClick={confirmPreviewGuest} disabled={previewLoading} className="inline-flex h-9 min-h-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Use this guest</button>
                </div>
              </div>
            }
          >
            {previewLoading ? (
              <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-neutral-400"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /><span className="text-xs">Loading guest relationship…</span></div>
            ) : (
              <div className="space-y-6">
                <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_14px_38px_-34px_rgba(15,23,42,0.45)]">
                  <div className="flex flex-col gap-4 bg-gradient-to-r from-emerald-50/70 via-white to-white p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm ring-4 ring-white" aria-hidden="true">
                        <UserRound className="h-6 w-6" strokeWidth={1.8} />
                      </span>
                      <div className="min-w-0">
                        <h4 className="m-0 truncate text-xl font-semibold tracking-[-0.02em] text-neutral-950 sm:text-2xl">{previewDetail?.fullName ?? previewGuest.fullName}</h4>
                        <p className="mb-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500"><span className="inline-flex items-center gap-1.5 text-emerald-700"><History className="h-3.5 w-3.5" />Returning guest</span><span className="text-neutral-300" aria-hidden>•</span><span>{previewDetail?.createdAt ? `Guest since ${fmtDate(previewDetail.createdAt)}` : "Existing guest profile"}</span></p>
                      </div>
                    </div>
                    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-emerald-100 bg-white/90 px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-sm"><Check className="h-3.5 w-3.5" />Recognised profile</span>
                  </div>
                  <div className="grid gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 p-3 sm:grid-cols-3">
                    <div className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-neutral-100"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><BedDouble className="h-4 w-4" /></span><div><p className="m-0 text-[10px] text-neutral-500">Recorded stays</p><p className="mb-0 mt-0.5 text-base font-semibold text-neutral-900">{previewStats.stays}</p></div></div>
                    <div className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-neutral-100"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><CircleDollarSign className="h-4 w-4" /></span><div><p className="m-0 text-[10px] text-neutral-500">Lifetime value</p><p className="mb-0 mt-0.5 text-base font-semibold text-neutral-900">{previewStats.currency} {previewStats.spend.toLocaleString()}</p></div></div>
                    <div className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-neutral-100"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${previewStats.balance > 0 ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}><WalletCards className="h-4 w-4" /></span><div><p className="m-0 text-[10px] text-neutral-500">Open balance</p><p className={`mb-0 mt-0.5 text-base font-semibold ${previewStats.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{previewStats.currency} {Math.max(0, previewStats.balance).toLocaleString()}</p></div></div>
                  </div>
                </section>

                <section>
                  <div className="mb-2.5 flex items-center justify-between gap-3"><h4 className="m-0 text-sm font-medium text-neutral-700">Guest details</h4><span className="text-[10px] text-neutral-400">Property record</span></div>
                  <div className="grid gap-2 rounded-2xl bg-neutral-50 p-2 sm:grid-cols-3">
                    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-white p-3.5 ring-1 ring-neutral-100"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-50 text-emerald-600"><Phone className="h-4 w-4" /></span><div className="min-w-0"><p className="m-0 text-[10px] text-neutral-400">Phone</p><p className="mb-0 mt-1 truncate text-sm font-medium text-neutral-800">{previewDetail?.phone || previewGuest.phone || "Not recorded"}</p></div></div>
                    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-white p-3.5 ring-1 ring-neutral-100"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-50 text-emerald-600"><Mail className="h-4 w-4" /></span><div className="min-w-0"><p className="m-0 text-[10px] text-neutral-400">Email</p><p className="mb-0 mt-1 truncate text-sm font-medium text-neutral-800" title={previewDetail?.email || previewGuest.email || "Not recorded"}>{previewDetail?.email || previewGuest.email || "Not recorded"}</p></div></div>
                    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-white p-3.5 ring-1 ring-neutral-100"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-50 text-emerald-600"><Globe2 className="h-4 w-4" /></span><div className="min-w-0"><p className="m-0 text-[10px] text-neutral-400">Nationality</p><p className="mb-0 mt-1 truncate text-sm font-medium text-neutral-800">{previewDetail?.nationality || previewGuest.nationality || "Not recorded"}</p></div></div>
                  </div>
                </section>

                {previewDetail?.notes && <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-xs text-amber-950"><p className="m-0 font-medium">Front-desk note</p><p className="mb-0 mt-1 leading-5 text-amber-800">{previewDetail.notes}</p></div>}

                <section>
                  <div className="mb-2.5 flex items-end justify-between gap-3"><div><h4 className="m-0 text-sm font-medium text-neutral-700">Stay records</h4><p className="mb-0 mt-1 text-[11px] text-neutral-400">Most recent property reservations</p></div><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-medium text-neutral-500">{previewStats.rows.length} total</span></div>
                  {previewStats.rows.length ? (
                    <div className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
                      {previewStats.rows.slice(0, 8).map((row) => {
                        const rowBalance = Math.max(0, row.balance ?? ((row.totalAmount ?? 0) + (row.chargesTotal ?? 0) - (row.amountPaid ?? 0) - (row.transferredToMaster ?? 0)));
                        return (
                        <div key={row.id} className="grid gap-3 px-4 py-3.5 transition hover:bg-neutral-50 sm:grid-cols-[1fr_auto] sm:items-center">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500"><BedDouble className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2"><p className="m-0 text-xs font-medium text-neutral-800">{fmtDate(row.checkIn)} to {fmtDate(row.checkOut)}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase ${STATUS_CLS[row.status] ?? "bg-neutral-100 text-neutral-600"}`}>{row.status.replace(/_/g, " ")}</span></div>
                              <p className="mb-0 mt-1 text-[10px] text-neutral-500">{SOURCE_LABEL[row.source] ?? row.source}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-5 text-right sm:min-w-52">
                            <div><p className="m-0 text-[9px] uppercase tracking-wide text-neutral-400">Stay total</p><p className="mb-0 mt-1 text-xs font-semibold text-neutral-800">{row.currency} {(row.totalAmount ?? 0).toLocaleString()}</p></div>
                            <div><p className="m-0 text-[9px] uppercase tracking-wide text-neutral-400">{row.commercialManaged ? "Payment" : rowBalance > 0 ? "Balance" : "Payment"}</p><p className={`mb-0 mt-1 text-xs font-semibold ${row.commercialManaged ? "text-emerald-700" : rowBalance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{row.commercialManaged ? "NoLSAF managed" : rowBalance > 0 ? `${row.currency} ${rowBalance.toLocaleString()}` : "Settled"}</p></div>
                          </div>
                        </div>
                      )})}
                    </div>
                  ) : (
                    <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center"><BedDouble className="mb-2 h-5 w-5 text-neutral-300" /><p className="m-0 text-xs font-bold text-neutral-600">No stay records yet</p><p className="mb-0 mt-1 text-[10px] text-neutral-400">This guest has no reservations recorded at this property.</p></div>
                  )}
                </section>
              </div>
            )}
          </ModalFrame>
        )}
      </div>
    </ModalFrame>
  );
}

function SalesReservationSummary({ reservation: r }: { reservation: Reservation }) {
  const guestName = r.guestProfile?.fullName ?? r.agentBooking?.leadGuest?.fullName ?? "Guest";
  const rooms = tallyRoomLabels((r.allocations ?? []).filter((allocation) => allocation.status === "ACTIVE").map(allocationRoomLabel), "Unassigned");
  const partySize = r.bookingId != null ? `${r.marketplaceBooking?.roomsQty ?? 1} room(s)` : `${r.adults + r.children} guest(s)`;
  return <div className="space-y-4 text-sm">
    <section className="flex flex-wrap items-start justify-between gap-3 border border-neutral-200 bg-neutral-50 px-4 py-3">
      <div className="min-w-0"><p className="m-0 truncate text-base font-semibold text-neutral-950">{guestName}</p><p className="mb-0 mt-1 text-xs text-neutral-500">{fmtDate(r.checkIn)} to {fmtDate(r.checkOut)} · {SOURCE_LABEL[r.source] ?? r.source}</p></div>
      <span className={`inline-flex px-2.5 py-1 text-[10px] font-semibold capitalize ${STATUS_CLS[r.status] ?? "bg-neutral-100 text-neutral-500"}`}>{r.status.replace(/_/g, " ").toLowerCase()}</span>
    </section>
    <div className="grid gap-px bg-neutral-200 ring-1 ring-neutral-200 sm:grid-cols-3">
      {[["Room", rooms], ["Party", partySize], ["Reservation value", money(r.bookingId != null ? r.marketplaceBooking?.totalAmount ?? null : r.totalAmount, r.currency)]].map(([label, value]) => <div key={label} className="bg-white px-4 py-3"><p className="m-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400">{label}</p><p className="mb-0 mt-1 text-sm font-semibold text-neutral-900">{value}</p></div>)}
    </div>
    <section className="grid gap-3 border border-neutral-200 bg-white p-4 sm:grid-cols-2">
      <div><p className="m-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Phone</p><p className="mb-0 mt-1 text-xs font-medium text-neutral-800">{r.guestProfile?.phone ?? r.agentBooking?.leadGuest?.phone ?? "Not recorded"}</p></div>
      <div><p className="m-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Email</p><p className="mb-0 mt-1 truncate text-xs font-medium text-neutral-800">{r.guestProfile?.email ?? "Not recorded"}</p></div>
      {r.group && <div className="sm:col-span-2"><p className="m-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Group</p><Link href="/owner/nrms/groups" className="mb-0 mt-1 inline-block text-xs font-semibold text-emerald-800 no-underline hover:underline">{r.group.name}</Link></div>}
      {r.agentBooking && <div className="sm:col-span-2"><p className="m-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Travel agency</p><Link href={`/owner/nrms/agents/requests/${r.agentBooking.requestId}/guests`} className="mb-0 mt-1 inline-block text-xs font-semibold text-emerald-800 no-underline hover:underline">{r.agentBooking.agencyName ?? "Agency booking"}</Link></div>}
    </section>
    <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" /><span>This reservation is read-only in the Sales workspace. Ask Reception or a manager to assign rooms, change the stay, record payments, check in, or check out the guest.</span></div>
  </div>;
}

function ReservationDetailModal({
  reservationId,
  readOnly,
  onClose,
  onChanged,
  onAssignRoom,
}: {
  reservationId: number;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onAssignRoom: (reservation: Reservation) => void;
}) {
  const { selectedPropertyId } = useNrms();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomNotReady, setRoomNotReady] = useState<string | null>(null);
  const [roomPreparationIssue, setRoomPreparationIssue] = useState<{ message: string; code: string | null } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payAmountManuallyEdited, setPayAmountManuallyEdited] = useState(false);
  const [payMethod, setPayMethod] = useState("CASH");
  const paymentRequest = useRef<{ signature: string; key: string } | null>(null);
  const [chargeCategory, setChargeCategory] = useState<string>("LAUNDRY");
  const [chargeDescription, setChargeDescription] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [voidingCharge, setVoidingCharge] = useState<Charge | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [verifiedChargeIds, setVerifiedChargeIds] = useState<number[]>([]);
  const [tenderCorrections, setTenderCorrections] = useState<Record<number, string>>({});
  const [checkoutConfirmOpen, setCheckoutConfirmOpen] = useState(false);
  const [roomVacantConfirmed, setRoomVacantConfirmed] = useState(false);
  const [earlyDepartureReason, setEarlyDepartureReason] = useState("");
  const [arrivalResolution, setArrivalResolution] = useState<"CORRECT_ARRIVAL_DATE" | "APPROVE_EARLY_CHECKIN">("CORRECT_ARRIVAL_DATE");
  const [arrivalResolutionReason, setArrivalResolutionReason] = useState("");
  const [arrivalResolutionNotice, setArrivalResolutionNotice] = useState<string | null>(null);
  const [arrivalResolutionError, setArrivalResolutionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await apiClient.get<any>(`/api/owner/nrms/reservations/${reservationId}`);
    setReservation(r.data?.reservation ?? null);
  }, [reservationId]);

  useEffect(() => {
    reload().catch((e: any) => setError(e?.response?.data?.error || "Failed to load reservation"));
  }, [reload]);

  useEffect(() => {
    if (payAmountManuallyEdited) return;
    const balance = reservation?.balance;
    setPayAmount(balance != null && balance > 0 ? String(balance) : "");
  }, [payAmountManuallyEdited, reservation?.balance]);

  useEffect(() => {
    const activeIds = new Set((reservation?.charges ?? [])
      .filter((charge) => !charge.voidedAt && chargeNeedsManualVerification(charge))
      .map((charge) => charge.id));
    setVerifiedChargeIds((current) => current.filter((id) => activeIds.has(id)));
  }, [reservation]);

  const runAction = async (action: string, body?: Record<string, unknown>) => {
    setBusyAction(action);
    setError(null);
    setRoomNotReady(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservationId}/${action}`, body ?? {});
      await reload();
      await onChanged();
      return true;
    } catch (e: any) {
      if (action === "check-in" && e?.response?.data?.code === "ROOM_NOT_READY") {
        setRoomNotReady(e?.response?.data?.error || "The assigned room has not been cleaned yet.");
      } else if (action === "check-in" && e?.response?.data?.code === "ROOM_ASSIGNMENT_REQUIRED") {
        setError("Room setup is incomplete. Review the room assignment section above before checking in.");
        // Another operator may have changed allocations since this detail opened.
        await reload().catch(() => undefined);
      } else {
        setError(e?.response?.data?.error || "Action failed");
      }
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const prepareRoomAssignment = async () => {
    setBusyAction("prepare-room-assignment");
    setError(null);
    setRoomPreparationIssue(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/reservations/${reservationId}/room-assignment/prepare`);
      const updated = response.data?.reservation as Reservation | undefined;
      if (!updated || roomReadiness(updated).missingAllocation) {
        setRoomPreparationIssue({ message: "The booked room category could not be restored.", code: null });
        return;
      }
      setReservation(updated);
      await onChanged();
      onAssignRoom(updated);
    } catch (requestError: any) {
      setRoomPreparationIssue({
        message: requestError?.response?.data?.error || "The booked room category could not be prepared.",
        code: requestError?.response?.data?.code ?? null,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const recordPayment = async () => {
    if (!payAmount) return;
    const signature = JSON.stringify([reservationId, Number(payAmount), payMethod]);
    if (paymentRequest.current?.signature !== signature) paymentRequest.current = { signature, key: crypto.randomUUID() };
    setBusyAction("payments");
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservationId}/payments`, {
        amount: Number(payAmount),
        method: payMethod,
        idempotencyKey: paymentRequest.current.key,
      });
      paymentRequest.current = null;
      setPayAmount("");
      setPayAmountManuallyEdited(false);
      await reload();
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to record payment");
    } finally {
      setBusyAction(null);
    }
  };

  const classifyOutletTender = async (orderId: number) => {
    const method = tenderCorrections[orderId];
    if (!selectedPropertyId || !method) return;
    setBusyAction(`classify-tender-${orderId}`);
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/outlet-orders/${orderId}/classify`, { method });
      await reload();
      await onChanged();
      setTenderCorrections((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to classify the outlet payment method");
    } finally {
      setBusyAction(null);
    }
  };

  const postCharge = async () => {
    if (!chargeAmount) return;
    setBusyAction("charges");
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservationId}/charges`, {
        category: chargeCategory,
        description: chargeDescription.trim() || undefined,
        amount: Number(chargeAmount),
      });
      setChargeDescription("");
      setChargeAmount("");
      await reload();
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to post charge");
    } finally {
      setBusyAction(null);
    }
  };

  const openVoidCharge = (charge: Charge) => {
    setVoidReason("");
    setVoidError(null);
    setVoidingCharge(charge);
  };

  const closeVoidCharge = () => {
    if (busyAction === "void-charge") return;
    setVoidingCharge(null);
    setVoidReason("");
    setVoidError(null);
  };

  const submitVoidCharge = async () => {
    if (!voidingCharge || !voidReason.trim()) return;
    setBusyAction("void-charge");
    setVoidError(null);
    try {
      await apiClient.post(`/api/owner/nrms/reservations/${reservationId}/charges/${voidingCharge.id}/void`, {
        reason: voidReason.trim(),
      });
      await reload();
      await onChanged();
      setVoidingCharge(null);
      setVoidReason("");
    } catch (e: any) {
      setVoidError(e?.response?.data?.error || "Failed to record the charge void");
    } finally {
      setBusyAction(null);
    }
  };

  const resolveEarlyCheckIn = async () => {
    if (!arrivalResolutionReason.trim()) return;
    setBusyAction("arrival-resolution");
    setError(null);
    setArrivalResolutionNotice(null);
    setArrivalResolutionError(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/reservations/${reservationId}/early-check-in-resolution`, {
        resolution: isMarketplace ? "APPROVE_EARLY_CHECKIN" : arrivalResolution,
        reason: arrivalResolutionReason.trim(),
      });
      setArrivalResolutionReason("");
      setArrivalResolutionNotice(response.data?.message || "Early check-in resolved.");
      await reload();
      await onChanged();
    } catch (e: any) {
      const code = e?.response?.data?.code;
      setArrivalResolutionError(
        code === "ROOM_TYPE_CAPACITY_CONFLICT"
          ? "The room type has no available inventory for part of the earlier stay period. Review overlapping stays or assign available inventory, then try again."
          : code === "ROOM_CONFLICT"
            ? "The assigned room overlaps another stay during the earlier period. Review the room assignment or the conflicting stay, then try again."
            : e?.response?.data?.error || "The arrival-date resolution could not be saved. Please try again.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const r = reservation;
  const checkoutGuestName = r?.guestProfile?.fullName ?? r?.agentBooking?.leadGuest?.fullName ?? "Guest";
  const checkoutRoomLabel = tallyRoomLabels((r?.allocations ?? []).filter((allocation) => allocation.status === "ACTIVE").map((allocation) => allocation.roomUnitCode ?? `Any ${allocation.roomTypeName ?? "room"}`), "assigned room");
  const readiness = roomReadiness(r ?? {});
  const isMarketplace = r?.bookingId != null;
  const paymentLocked = r?.balance != null && r.balance <= 0;
  const activeCharges = (r?.charges ?? []).filter((charge) => !charge.voidedAt);
  const chargesRequiringVerification = activeCharges.filter(chargeNeedsManualVerification);
  const outletVerifiedChargeCount = activeCharges.length - chargesRequiringVerification.length;
  const outletPaidOrders = (r?.outletOrders ?? []).filter((order) => order.settlementMode === "OUTLET_PAYMENT");
  const unclassifiedOutletPayments = outletPaidOrders.filter(
    (order) => order.status === "SETTLED" && !order.voidedAt && !order.settlementMethod,
  );
  const outletTenderTotals = outletPaidOrders
    .filter((order) => order.status === "SETTLED" && !order.voidedAt && order.settlementMethod)
    .reduce<Record<string, number>>((totals, order) => {
      const method = order.settlementMethod as string;
      totals[method] = (totals[method] ?? 0) + (order.total ?? 0);
      return totals;
    }, {});
  const settledAtOutletTotal = outletPaidOrders
    .filter((order) => order.status === "SETTLED" && !order.voidedAt)
    .reduce((sum, order) => sum + (order.total ?? 0), 0);
  const folioTotal = (r?.totalAmount ?? 0) + (r?.chargesTotal ?? 0);
  const totalGuestSpend = folioTotal + settledAtOutletTotal;
  const totalCollected = (r?.amountPaid ?? 0) + settledAtOutletTotal;
  const folioBalanceBlocked = r?.status === "CHECKED_IN" && (r.balance == null || Math.abs(r.balance) > 0.005);
  const chargesNeedVerification = r?.status === "CHECKED_IN" && chargesRequiringVerification.some((charge) => !verifiedChargeIds.includes(charge.id));
  const outletReconciliationBlocked = r?.status === "CHECKED_IN" && unclassifiedOutletPayments.length > 0;
  const checkoutBlocked = folioBalanceBlocked || chargesNeedVerification || outletReconciliationBlocked;
  const plannedCheckOutKey = r?.checkOut?.slice(0, 10) ?? "";
  const departureDateKey = localDateKey();
  const earlyDeparture = Boolean(r?.status === "CHECKED_IN" && plannedCheckOutKey > departureDateKey);
  const actualCheckInDateKey = r?.checkedInAt ? localDateKey(new Date(r.checkedInAt)) : "";
  const unresolvedEarlyCheckIn = Boolean(
    r?.status === "CHECKED_IN"
      && actualCheckInDateKey
      && r.checkIn.slice(0, 10) > actualCheckInDateKey
      && !r.earlyCheckInApproved,
  );
  const checkoutDeclarationReady = roomVacantConfirmed && (!earlyDeparture || earlyDepartureReason.trim().length >= 2);
  const checkoutReady = !unresolvedEarlyCheckIn && checkoutDeclarationReady;
  const checkoutNextStep = unresolvedEarlyCheckIn
    ? "Resolve the arrival-date mismatch to continue."
    : earlyDeparture && earlyDepartureReason.trim().length < 2
      ? "Add the reason for the early departure."
      : !roomVacantConfirmed
        ? "Confirm that the room is vacant."
        : "Ready to complete checkout.";
  // Incidentals and the folio document are the property's own business on a
  // marketplace stay: only the accommodation rate and its payment belong to
  // NoLSAF. A NoLSAF guest orders from the bar and takes a receipt like anyone.
  const canPostCharges = r != null && ["CONFIRMED", "CHECKED_IN"].includes(r.status);
  const canPrintInvoice = r != null && ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(r.status);
  // Confirm, check-in, no-show and cancel are commercial state a marketplace
  // booking owns: check-in happens against the guest's code, and the rest would
  // let NRMS and NoLSAF disagree about what the guest owes. Check-out is the
  // property closing its own stay, and the folio opened above has to be
  // settleable from the same place it is posted.
  const actions: Array<{ key: string; label: string; show: boolean; disabled?: boolean }> = r
    ? [
        { key: "confirm", label: "Confirm", show: !isMarketplace && ["DRAFT", "HELD"].includes(r.status) },
        { key: "check-in", label: "Check in", show: !isMarketplace && r.status === "CONFIRMED", disabled: !readiness.ready },
        { key: "check-out", label: folioBalanceBlocked ? "Settle balance first" : outletReconciliationBlocked ? "Classify outlet payments" : chargesNeedVerification ? "Verify every charge" : "Check out", show: r.status === "CHECKED_IN", disabled: checkoutBlocked },
        { key: "no-show", label: "No show", show: !isMarketplace && r.status === "CONFIRMED" },
        { key: "cancel", label: "Cancel", show: !isMarketplace && ["DRAFT", "HELD", "CONFIRMED"].includes(r.status) },
      ]
    : [];

  return (
    <>
    <ModalFrame title="Reservation" onClose={onClose} closeOnEscape={!voidingCharge && !checkoutConfirmOpen} extraWide>
      {!r ? (
        <div className="flex justify-center py-10 text-neutral-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : readOnly ? (
        <SalesReservationSummary reservation={r} />
      ) : (
        <div className="space-y-3 text-sm">
          <section className="flex min-w-0 flex-wrap items-stretch justify-between overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm shadow-neutral-200/40">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2">
              <div className="min-w-0 flex-1 px-4 py-3.5 shadow-[inset_3px_0_0_0_#059669]">
                {/* An agency stay is billed to the agency, so the drawer leads
                    with the agency and keeps the traveller underneath. */}
                <div className="truncate font-bold text-neutral-900">{r.agentBooking?.agencyName ?? r.guestProfile?.fullName ?? r.agentBooking?.leadGuest?.fullName ?? "Guest"}</div>
                <div className="mt-1 text-xs text-neutral-500">
                  {r.agentBooking ? <>{r.guestProfile?.fullName ?? r.agentBooking.leadGuest?.fullName ?? "Travellers on the manifest"} · </> : null}
                  {fmtDate(r.checkIn)} to {fmtDate(r.checkOut)} · {SOURCE_LABEL[r.source] ?? r.source} · {r.adults} adult{r.adults === 1 ? "" : "s"}
                </div>
              </div>
              {r.allocations && r.allocations.length > 0 && (
                <div className="border-l border-neutral-200 px-5 py-3.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-neutral-500">Room</div>
                  <div className="mt-1 text-[13px] font-semibold text-neutral-800">{tallyRoomLabels(r.allocations.filter((a) => a.status === "ACTIVE").map((a) => a.roomUnitCode ?? `Any ${a.roomTypeName ?? "room"}`), "None active")}</div>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 border-l border-neutral-200 bg-neutral-50 px-3.5 py-3">
              {canPrintInvoice && (
                <button
                  type="button"
                  onClick={() => window.open(`/api/owner/nrms/reservations/${r.id}/invoice.pdf`, "_blank", "noopener")}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print invoice
                </button>
              )}
              <span className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${STATUS_CLS[r.status] ?? "bg-neutral-100 text-neutral-500"}`}>
                {r.status.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>
          </section>

          {["CONFIRMED", "CHECKED_IN"].includes(r.status) && !readiness.ready && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="Room assignment required">
              <p className="m-0 font-semibold">{readiness.missingAllocation ? "Booked room category needs recovery" : readiness.assigned + " of " + readiness.total + " rooms assigned"}</p>
              <p className="my-2 text-xs">{readiness.missingAllocation ? "Restore the category already recorded by the booking source, then choose a room number from that category." : roomAssignmentRequirement(r).message}</p>
              {readiness.missingAllocation && <button type="button" disabled={busyAction != null} onClick={() => void prepareRoomAssignment()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busyAction === "prepare-room-assignment" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{busyAction === "prepare-room-assignment" ? "Restoring category..." : "Continue to room assignment"}</button>}
              {!readiness.missingAllocation && <button type="button" disabled={busyAction != null} onClick={() => onAssignRoom(r)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Assign room</button>}
              {roomPreparationIssue && <div className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2.5 text-xs text-red-700"><p className="m-0 font-semibold">{roomPreparationIssue.message}</p>{roomPreparationIssue.code === "ROOM_CATEGORY_MAPPING_REQUIRED" && <Link href="/owner/nrms/rooms" className="mt-2 inline-flex font-bold text-red-800 underline">Open room categories</Link>}</div>}
            </section>
          )}

          {isMarketplace && <MarketplaceSettlement reservation={r} />}

          {!isMarketplace && <section className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 sm:grid-cols-3">
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Room</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{money(r.totalAmount, r.currency)}</p>
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Folio extras</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{money(r.chargesTotal ?? 0, r.currency)}</p>
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Outlet paid</p>
              <p className={`mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums ${unclassifiedOutletPayments.length > 0 ? "text-amber-700" : "text-emerald-700"}`}>{money(settledAtOutletTotal, r.currency)}</p>
              {unclassifiedOutletPayments.length > 0 && <p className="mb-0 mt-0.5 text-[9px] font-semibold text-amber-700">Payment method missing</p>}
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Total spend</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{money(totalGuestSpend, r.currency)}</p>
            </div>
            <div className="min-w-0 bg-white px-3 py-3">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">Total collected</p>
              <p className="mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-emerald-700">{money(totalCollected, r.currency)}</p>
            </div>
            <div className={`min-w-0 px-3 py-3 ${r.balance != null && r.balance > 0 && !isMarketplace ? "bg-amber-50" : "bg-emerald-50"}`}>
              <p className={`m-0 text-[9px] font-bold uppercase tracking-[0.08em] ${r.balance != null && r.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>Amount due</p>
              <p className={`mb-0 mt-1 whitespace-nowrap text-sm font-bold tabular-nums ${r.balance != null && r.balance > 0 ? "text-amber-900" : "text-emerald-900"}`}>{r.balance != null && r.balance > 0 ? money(r.balance, r.currency) : "Paid in full"}</p>
            </div>
          </section>}

          {(canPostCharges || (r.charges && r.charges.length > 0) || outletPaidOrders.length > 0) && (
            <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <header className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white"><ReceiptText className="h-4 w-4" /></span>
                  <div className="min-w-0"><h3 className="m-0 text-xs font-bold text-neutral-900">Guest charges and outlet orders</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-500">Review every transaction linked to this stay before checkout.</p></div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {r.status === "CHECKED_IN" && unclassifiedOutletPayments.length > 0 && <span className="shrink-0 rounded-md bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">{unclassifiedOutletPayments.length} outlet payment {unclassifiedOutletPayments.length === 1 ? "method" : "methods"} required</span>}
                  {r.status === "CHECKED_IN" && chargesRequiringVerification.length > 0 && <span className={`shrink-0 rounded-md px-2.5 py-1 text-[10px] font-bold ${chargesNeedVerification ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{verifiedChargeIds.length} of {chargesRequiringVerification.length} manual charges verified</span>}
                  {r.status === "CHECKED_IN" && outletVerifiedChargeCount > 0 && <span className="shrink-0 rounded-md bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800">{outletVerifiedChargeCount} outlet {outletVerifiedChargeCount === 1 ? "charge" : "charges"} verified by workflow</span>}
                </div>
              </header>
              <div className="space-y-4 p-3">
              {outletPaidOrders.length > 0 && (
                <section className="space-y-2">
                  <div className="flex flex-wrap items-end justify-between gap-3 px-0.5">
                    <div>
                      <h4 className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">Outlet settlement register</h4>
                      <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Payment method, staff member and settlement time for every outlet order linked to this guest.</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {Object.entries(outletTenderTotals).map(([method, total]) => (
                        <span key={method} className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[9px] font-semibold text-neutral-600">
                          {PAYMENT_METHOD_LABEL[method] ?? method.replaceAll("_", " ")} <strong className="ml-1 tabular-nums text-neutral-900">{money(total, r.currency)}</strong>
                        </span>
                      ))}
                      {unclassifiedOutletPayments.length > 0 && <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-800">{unclassifiedOutletPayments.length} method required</span>}
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                    <div className="hidden grid-cols-[minmax(13rem,1.2fr)_minmax(12rem,1.1fr)_minmax(10rem,.8fr)_minmax(13rem,1fr)_8rem] gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:grid">
                      <span>Outlet and order</span><span>Items ordered</span><span>Settlement</span><span>Recorded</span><span className="text-right">Amount</span>
                    </div>
                  {outletPaidOrders.map((order) => {
                    const settled = order.status === "SETTLED" && !order.voidedAt;
                    const inactive = ["CANCELLED", "VOIDED"].includes(order.status) || Boolean(order.voidedAt);
                    const missingTender = settled && !order.settlementMethod;
                    const statusLabel = missingTender ? "Payment method required" : settled ? "Settlement recorded" : order.status === "PREPARING" ? "Preparing" : order.status === "CONFIRMED" ? "Awaiting service" : order.status.replaceAll("_", " ").toLowerCase();
                    const recordedAt = order.settledAt || order.confirmedAt || order.createdAt;
                    return (
                      <div key={`outlet-${order.id}`} className={`grid min-w-0 gap-3 border-b border-neutral-200 px-3 py-3 last:border-b-0 lg:grid-cols-[minmax(13rem,1.2fr)_minmax(12rem,1.1fr)_minmax(10rem,.8fr)_minmax(13rem,1fr)_8rem] lg:items-center ${inactive ? "bg-neutral-50 opacity-60" : missingTender ? "bg-amber-50/70" : settled ? "bg-emerald-50/40" : "bg-amber-50/60"}`}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${missingTender ? "bg-amber-100 text-amber-800" : settled ? "bg-emerald-100 text-emerald-800" : inactive ? "bg-neutral-200 text-neutral-500" : "bg-amber-100 text-amber-800"}`}><Store className="h-4 w-4" /></span>
                          <div className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Outlet and order</span><strong className={`block truncate text-xs ${inactive ? "text-neutral-400 line-through" : "text-neutral-800"}`}>{order.outlet.name}</strong><span className="mt-0.5 block truncate text-[10px] font-semibold text-neutral-500">{order.orderNumber}</span></div>
                        </div>
                        <div className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Items ordered</span><span className="mt-0.5 block text-[10px] leading-4 text-neutral-600">{order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}</span></div>
                        <div className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Settlement</span><div className="mt-1 flex flex-wrap gap-1 lg:mt-0"><span className={`rounded-md px-2 py-0.5 text-[9px] font-bold ${missingTender ? "bg-amber-200 text-amber-900" : settled ? "bg-emerald-100 text-emerald-800" : inactive ? "bg-neutral-200 text-neutral-500" : "bg-amber-100 text-amber-800"}`}>{statusLabel}</span>{settled && order.settlementMethod && <span className="rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-[9px] font-bold text-emerald-800">{PAYMENT_METHOD_LABEL[order.settlementMethod] ?? order.settlementMethod.replaceAll("_", " ")}</span>}</div><span className={`mt-1 block text-[9px] leading-4 ${missingTender ? "text-amber-800" : settled ? "text-emerald-700" : "text-amber-700"}`}>{missingTender ? "Method needed for reconciliation" : settled ? "Included in guest spend" : "Awaiting outlet completion"}</span></div>
                        <div className="min-w-0 text-[10px] text-neutral-500"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Recorded</span><time dateTime={recordedAt} title={`Recorded as ${new Date(recordedAt).toISOString()}`} className="mt-1 flex items-center gap-1 tabular-nums lg:mt-0"><Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />{fmtChargeTimestamp(recordedAt)}</time>{settled && <span className="mt-1 block truncate">By <strong className="font-semibold text-neutral-700">{staffLabel(order.settledBy)}</strong></span>}</div>
                        <div className="min-w-0 lg:text-right"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400 lg:hidden">Amount</span><strong className={`mt-0.5 block whitespace-nowrap text-xs tabular-nums ${inactive ? "text-neutral-400 line-through" : settled ? "text-emerald-800" : "text-neutral-800"}`}>{money(order.total, order.currency)}</strong><span className="mt-0.5 block text-[9px] text-neutral-400">Outlet total</span></div>
                        {missingTender && (
                          <div className="grid gap-2 border-t border-amber-200 pt-2 sm:grid-cols-[minmax(0,1fr)_auto] lg:col-span-5">
                            <select value={tenderCorrections[order.id] ?? ""} onChange={(event) => setTenderCorrections((current) => ({ ...current, [order.id]: event.target.value }))} className="h-9 min-w-0 rounded-lg border border-amber-300 bg-white px-2.5 text-[10px] font-semibold text-neutral-700 outline-none focus:border-emerald-500" aria-label={`Payment method for ${order.orderNumber}`}>
                              <option value="">Select the payment method received</option>
                              <option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option>
                            </select>
                            <button type="button" onClick={() => void classifyOutletTender(order.id)} disabled={!tenderCorrections[order.id] || busyAction === `classify-tender-${order.id}`} className="h-9 rounded-lg border-0 bg-neutral-900 px-3 text-[10px] font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400">
                              {busyAction === `classify-tender-${order.id}` ? "Saving..." : "Save payment method"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </section>
              )}
              {r.charges && r.charges.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-end justify-between gap-3 px-0.5">
                    <div><h4 className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">Room folio charges</h4><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Outlet-posted charges are verified by their completed workflow. Only manual entries require front-desk confirmation.</p></div>
                    <div className="shrink-0 text-right"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400">Charges total</span><strong className="mt-0.5 block text-xs tabular-nums text-neutral-800">{money(r.chargesTotal ?? 0, r.currency)}</strong></div>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                    <div className="hidden min-w-0 grid-cols-[3rem_minmax(8rem,1fr)_minmax(13rem,1.4fr)_9.5rem_7rem_3.5rem] items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-neutral-400 md:grid">
                      <span>Control</span><span>Charge</span><span>Source or reference</span><span>Posted</span><span className="text-right">Amount</span><span className="text-right">Action</span>
                    </div>
                    <div className="divide-y divide-neutral-200">
                      {r.charges.map((c) => {
                        const checked = verifiedChargeIds.includes(c.id);
                        const needsManualVerification = !c.voidedAt && chargeNeedsManualVerification(c);
                        const workflowVerified = !c.voidedAt && !needsManualVerification;
                        const categoryLabel = NRMS_CHARGE_CATEGORY_LABELS[c.category as keyof typeof NRMS_CHARGE_CATEGORY_LABELS] ?? c.category.replace(/_/g, " ").toLowerCase();
                        return (
                          <div key={c.id} className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 md:grid-cols-[3rem_minmax(8rem,1fr)_minmax(13rem,1.4fr)_9.5rem_7rem_3.5rem] md:gap-3 ${c.voidedAt ? "bg-neutral-50 opacity-60" : checked || workflowVerified ? "bg-emerald-50/50" : "bg-white"}`}>
                            <div className="row-span-3 flex items-center md:row-auto">
                              {r.status === "CHECKED_IN" && needsManualVerification ? (
                                <label className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border ${checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white text-transparent hover:border-emerald-400"}`}>
                                  <input type="checkbox" checked={checked} onChange={(event) => setVerifiedChargeIds((current) => event.target.checked ? [...current, c.id] : current.filter((id) => id !== c.id))} aria-label={`Verify charge ${c.description || c.category}`} className="sr-only" />
                                  <Check className="h-3.5 w-3.5" />
                                </label>
                              ) : workflowVerified ? <span title="Verified by completed outlet workflow" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-emerald-100 text-emerald-700"><Check className="h-3.5 w-3.5" /></span> : <span className="text-[10px] font-bold text-neutral-400">—</span>}
                            </div>
                            <div className={`min-w-0 md:col-auto ${c.voidedAt ? "line-through" : ""}`}>
                              <span className="block truncate text-xs font-bold text-neutral-800">{categoryLabel}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-neutral-500">{c.description || "No description"}</span>
                            </div>
                            <div className="col-start-2 min-w-0 md:col-auto">
                              {c.outletOrder ? <><span className="block truncate text-[10px] font-bold text-neutral-700">{c.outletOrder.orderNumber} · {c.outletOrder.outlet.name}</span><span className="mt-0.5 block truncate text-[10px] text-neutral-400">{c.outletOrder.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}</span></> : <><span className="block text-[10px] font-bold text-neutral-600">Manual entry</span><span className="mt-0.5 block text-[10px] text-neutral-400">Front desk adjustment</span></>}
                            </div>
                            <time dateTime={c.createdAt} title={`Recorded as ${new Date(c.createdAt).toISOString()}`} className="col-start-2 flex items-center gap-1 whitespace-nowrap text-[10px] tabular-nums text-neutral-400 md:col-auto">
                              <Clock3 className="h-3 w-3" aria-hidden="true" />{fmtChargeTimestamp(c.createdAt)}
                            </time>
                            <span className={`col-start-3 row-start-1 whitespace-nowrap text-right text-xs font-bold tabular-nums md:col-auto md:row-auto ${c.voidedAt ? "line-through text-neutral-400" : "text-neutral-800"}`}>{money(c.amount, c.currency)}</span>
                            <div className="col-start-3 row-start-3 text-right md:col-auto md:row-auto">
                              {!c.voidedAt ? <button type="button" onClick={() => openVoidCharge(c)} disabled={busyAction != null} className="rounded-md border border-red-200 bg-white px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">Void</button> : <span className="text-[9px] font-bold uppercase text-red-500" title={c.voidReason || undefined}>Voided</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}
              {canPostCharges && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3">
                  <div>
                    <p className="m-0 text-xs font-bold text-neutral-900">Add a manual extra charge</p>
                    <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">Record a service or item that increased the guest&apos;s bill but was not already posted through a restaurant or bar order.</p>
                  </div>
                  <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 xl:col-span-3">
                      Charge category
                      <select
                        className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
                        value={chargeCategory}
                        onChange={(e) => setChargeCategory(e.target.value)}
                        disabled={busyAction === "charges"}
                      >
                        {MANUAL_CHARGE_CATEGORIES.map((category) => (
                          <option key={category} value={category}>{NRMS_CHARGE_CATEGORY_LABELS[category]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 xl:col-span-4">
                      What was provided?
                      <input type="text" maxLength={300} disabled={busyAction === "charges"} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400" value={chargeDescription} onChange={(e) => setChargeDescription(e.target.value)} placeholder="Example: Laundry service" />
                    </label>
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 xl:col-span-3">
                      Amount to add ({r.currency})
                      <input type="number" min={1} disabled={busyAction === "charges"} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} placeholder="0" />
                    </label>
                    <button type="button" onClick={postCharge} disabled={busyAction === "charges" || !chargeAmount} className="box-border inline-flex !h-10 w-full items-center justify-center rounded-lg border-0 bg-emerald-700 px-3 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 sm:col-span-2 xl:col-span-2">{busyAction === "charges" ? "Posting..." : "Add to folio"}</button>
                  </div>
                  <p className="mb-0 mt-2 text-[10px] leading-4 text-neutral-500">Restaurant and bar charges are posted automatically from Outlet Operations and cannot be entered manually here.</p>
                </div>
              )}
              </div>
            </section>
          )}

          {!["CANCELLED", "EXPIRED", "NO_SHOW"].includes(r.status) && (
            <section className="overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm shadow-neutral-200/40">
              <header className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-200 bg-white px-4 py-3.5 shadow-[inset_3px_0_0_0_#059669]">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700">
                    <WalletCards className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-[13px] font-bold text-neutral-950">Record guest payment</p>
                    <p className="mb-0 mt-1 text-[11px] leading-5 text-neutral-600">Post money already received directly to this guest folio.</p>
                  </div>
                </div>
                <span className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[11px] font-bold text-emerald-800">
                  Outstanding&nbsp; {money(r.balance, r.currency)}
                </span>
              </header>
              {paymentLocked ? (
                <div className="m-4 flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs font-semibold text-emerald-800">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-700"><LockKeyhole className="h-3.5 w-3.5" /></span>
                  This folio is fully paid. Additional payment entry is locked.
                </div>
              ) : (
                <div className="p-4">
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500 sm:col-span-2 xl:col-span-5">
                      <span className="flex items-center justify-between gap-2"><span>Amount received</span><span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-600">{r.currency}</span></span>
                      <input type="number" inputMode="decimal" min={1} max={r.balance ?? undefined} disabled={busyAction === "payments"} className="mt-1.5 box-border !h-11 w-full min-w-0 appearance-none rounded-md border border-neutral-300 bg-white px-3.5 py-0 text-base font-bold normal-case tracking-normal text-neutral-950 outline-none placeholder:text-xs placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={payAmount} onChange={(e) => { setPayAmount(e.target.value); setPayAmountManuallyEdited(true); }} placeholder="Enter amount" />
                    </label>
                    <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500 xl:col-span-3">
                      Payment method
                      <span className="mt-1.5 block">
                        <select className="box-border !h-11 w-full min-w-0 rounded-md border border-neutral-300 bg-white px-3.5 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} disabled={busyAction === "payments"}>
                          <option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="BANK">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other method</option>
                        </select>
                      </span>
                    </label>
                    <button type="button" onClick={recordPayment} disabled={busyAction === "payments" || !payAmount} className="box-border inline-flex !h-11 w-full items-center justify-center gap-2 rounded-md border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none sm:col-span-2 xl:col-span-4">
                      {busyAction === "payments" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Recording payment...</> : <><CircleDollarSign className="h-4 w-4" />Confirm received payment</>}
                    </button>
                  </div>
                  <div className="mt-3 flex items-start gap-2 border-t border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[11px] leading-4 text-neutral-600">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span>The amount cannot exceed {money(r.balance, r.currency)}. Confirm the actual payment method before recording.</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {r.payments && r.payments.length > 0 && (
            <div className="text-xs text-neutral-500 space-y-1">
              {r.payments.map((p) => (
                <div key={p.id} className={`flex justify-between ${p.voidedAt ? "line-through text-neutral-300" : ""}`}>
                  <span>
                    {new Date(p.createdAt).toLocaleDateString()} · {p.method.replace(/_/g, " ").toLowerCase()}
                  </span>
                  <span>{money(p.amount, p.currency)}</span>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {roomNotReady && r.status === "CONFIRMED" && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
              <p className="m-0">{roomNotReady}</p>
              <button
                type="button"
                onClick={() => runAction("check-in", { overrideRoomReadiness: true })}
                disabled={busyAction != null}
                className="mt-2 inline-flex appearance-none items-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
              >
                Check in anyway
              </button>
            </div>
          )}

          {checkoutBlocked && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong>Checkout blocked.</strong>
                {folioBalanceBlocked && <p className="m-0 mt-1">Record the full outstanding payment or resolve the guest credit.</p>}
                {chargesNeedVerification && <p className="m-0 mt-1">Verify the {chargesRequiringVerification.length} manual room-folio {chargesRequiringVerification.length === 1 ? "charge" : "charges"} listed above. Charges posted through the completed outlet workflow are already verified.</p>}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {actions.filter((a) => a.show).map((a) => (
              <button
                type="button"
                key={a.key}
                onClick={() => {
                  if (a.key === "check-out") {
                    if (!earlyDeparture) {
                      void runAction("check-out", { verifiedChargeIds });
                      return;
                    }
                    setRoomVacantConfirmed(false);
                    setEarlyDepartureReason("");
                    setArrivalResolutionError(null);
                    setCheckoutConfirmOpen(true);
                    return;
                  }
                  void runAction(a.key);
                }}
                disabled={busyAction != null || a.disabled}
                className={`rounded-lg text-xs font-semibold px-3 py-2 disabled:opacity-60 ${
                  a.key === "cancel" || a.key === "no-show"
                    ? "border border-red-200 text-red-600 hover:bg-red-50"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                }`}
              >
                {busyAction === a.key ? "Working..." : a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </ModalFrame>
    {checkoutConfirmOpen && r?.status === "CHECKED_IN" && (
      <ModalFrame title={earlyDeparture ? "Early checkout" : "Guest checkout"} subtitle={`${checkoutGuestName} · ${checkoutRoomLabel}`} icon={<LogOut className="h-5 w-5" />} onClose={() => setCheckoutConfirmOpen(false)} elevated wide footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className={`m-0 text-sm font-medium ${checkoutReady ? "text-emerald-700" : "text-neutral-500"}`}>{checkoutNextStep}</p>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <button type="button" onClick={() => setCheckoutConfirmOpen(false)} disabled={busyAction === "check-out"} className="inline-flex h-11 items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Not yet</button>
            {checkoutReady && (
              <button
                type="button"
                disabled={busyAction === "check-out"}
                onClick={async () => {
                  const completed = await runAction("check-out", {
                    verifiedChargeIds,
                    roomVacantConfirmed,
                    earlyDepartureReason: earlyDeparture ? earlyDepartureReason.trim() : undefined,
                  });
                  if (completed) setCheckoutConfirmOpen(false);
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60"
              >
                {busyAction === "check-out" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Check out guest
              </button>
            )}
          </div>
        </div>
      }>
        <div className="space-y-5">
          <div className="space-y-3">
            <section className="rounded-xl border border-solid border-neutral-200 bg-neutral-50/70 p-4">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">Stay details</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-[1.35fr_1fr_1fr] sm:items-end">
                <div>
                  <span className="text-xs font-medium text-neutral-500">Guest</span>
                  <h4 className="mb-0 mt-1 text-base font-bold text-neutral-950">{checkoutGuestName}</h4>
                </div>
                <dl className="m-0 contents">
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Room</dt>
                    <dd className="mb-0 mt-1 text-sm font-semibold text-neutral-900">{checkoutRoomLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Planned departure</dt>
                    <dd className="mb-0 mt-1 text-sm font-semibold text-neutral-900">{fmtDate(r.checkOut)}</dd>
                  </div>
                </dl>
              </div>
            </section>
            {earlyDeparture && (
              <div className="flex items-start gap-3 rounded-xl border border-solid border-amber-200 bg-amber-50/70 px-4 py-3 text-amber-950">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <p className="m-0 text-sm leading-5"><span className="font-bold">Unused nights will be released.</span> Checkout today returns the remaining dates to availability and bills only occupied room-nights.</p>
              </div>
            )}
          </div>

          <div className="min-w-0 border-t border-solid border-neutral-200 pt-5">
            {unresolvedEarlyCheckIn ? (
              <div className="space-y-3">
                {arrivalResolutionError && (
                  <div role="alert" className="flex items-start gap-3 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-red-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-bold">Earlier arrival cannot be saved</p>
                      <p className="mb-0 mt-1 text-sm leading-5 text-red-800">{arrivalResolutionError}</p>
                    </div>
                  </div>
                )}
              <section className="rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Resolve early check-in">
                <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600"><AlertTriangle className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-base font-bold text-neutral-950">Resolve the arrival date first</p>
                  <p className="mb-0 mt-1 text-sm leading-5 text-neutral-600">
                    Actual check-in was {fmtDate(r.checkedInAt!)} but the reservation arrival is {fmtDate(r.checkIn)}. Choose the accurate resolution; the original values and your reason remain in the audit history.
                  </p>
                  <div className="mt-4 grid overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                    {!isMarketplace && (
                      <label className={`cursor-pointer p-4 transition ${arrivalResolution === "CORRECT_ARRIVAL_DATE" ? "bg-emerald-50/70" : "bg-white hover:bg-neutral-50"}`}>
                        <input type="radio" name="arrival-resolution" className="sr-only" checked={arrivalResolution === "CORRECT_ARRIVAL_DATE"} onChange={() => { setArrivalResolution("CORRECT_ARRIVAL_DATE"); setArrivalResolutionError(null); }} />
                        <span className="flex items-start justify-between gap-3">
                          <span className="block text-sm font-bold text-neutral-900">Correct arrival date</span>
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${arrivalResolution === "CORRECT_ARRIVAL_DATE" ? "border-emerald-700" : "border-neutral-300"}`} aria-hidden="true">
                            {arrivalResolution === "CORRECT_ARRIVAL_DATE" && <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" />}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-neutral-600">Use the immutable actual check-in date as the stay arrival date.</span>
                      </label>
                    )}
                    <label className={`cursor-pointer p-4 transition ${!isMarketplace ? "border-t border-solid border-neutral-200" : ""} ${arrivalResolution === "APPROVE_EARLY_CHECKIN" || isMarketplace ? "bg-emerald-50/70" : "bg-white hover:bg-neutral-50"}`}>
                      <input type="radio" name="arrival-resolution" className="sr-only" checked={arrivalResolution === "APPROVE_EARLY_CHECKIN" || isMarketplace} onChange={() => { setArrivalResolution("APPROVE_EARLY_CHECKIN"); setArrivalResolutionError(null); }} />
                      <span className="flex items-start justify-between gap-3">
                        <span className="block text-sm font-bold text-neutral-900">Approve genuine early check-in</span>
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${arrivalResolution === "APPROVE_EARLY_CHECKIN" || isMarketplace ? "border-emerald-700" : "border-neutral-300"}`} aria-hidden="true">
                          {(arrivalResolution === "APPROVE_EARLY_CHECKIN" || isMarketplace) && <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" />}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-neutral-600">Keep the scheduled date, but extend operational room occupancy to the actual arrival.</span>
                    </label>
                  </div>
                  <label className="mt-4 block text-sm font-semibold text-neutral-800">
                    What was verified?
                    <textarea value={arrivalResolutionReason} onChange={(event) => setArrivalResolutionReason(event.target.value)} maxLength={300} rows={3} placeholder="Record the evidence or explanation" className="mt-2 box-border w-full resize-y rounded-xl border border-solid border-neutral-300 bg-white px-4 py-3 text-sm font-medium text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" />
                    {arrivalResolutionReason.trim().length < 2 && <span className="mt-1.5 block text-xs font-medium text-neutral-500">Add a reason to continue.</span>}
                  </label>
                  <div className="mt-4 border-t border-solid border-neutral-200 pt-4">
                    <p className="m-0 text-xs leading-5 text-neutral-500">Pricing remains protected. The folio will be flagged for financial review.</p>
                    {arrivalResolutionReason.trim().length >= 2 && (
                      <div className="mt-3 flex justify-end">
                        <button type="button" onClick={resolveEarlyCheckIn} disabled={busyAction === "arrival-resolution"} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60 sm:w-auto">
                          {busyAction === "arrival-resolution" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                          Resolve arrival date
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                </div>
              </section>
              </div>
            ) : (
              <div className="space-y-5">
                {(arrivalResolutionNotice || (r.earlyCheckInApproved && r.earlyCheckInResolution)) && (
                  <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                    <span>{arrivalResolutionNotice || `Arrival date resolved on ${fmtDate(r.earlyCheckInResolution!.createdAt)}. ${r.earlyCheckInResolution!.reason || "Recorded in audit history."}`}</span>
                  </div>
                )}
                {earlyDeparture && (
                  <label className="block text-sm font-bold text-neutral-900">
                    Why is the guest leaving early?
                    <textarea value={earlyDepartureReason} onChange={(event) => setEarlyDepartureReason(event.target.value)} rows={5} maxLength={300} placeholder="Example: Guest changed travel plans" className="mt-2 box-border w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-normal text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" />
                  </label>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={roomVacantConfirmed}
                  onClick={() => setRoomVacantConfirmed((confirmed) => !confirmed)}
                  className={`flex w-full cursor-pointer appearance-none items-center justify-between gap-5 rounded-2xl border p-5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/30 ${roomVacantConfirmed ? "border-emerald-400 bg-emerald-50" : "border-neutral-300 bg-white hover:border-emerald-300 hover:bg-emerald-50/30"}`}
                >
                  <span className="min-w-0">
                    <span className="block text-base font-bold text-neutral-950">Confirm the room is vacant</span>
                    <span className="mt-1 block text-sm leading-6 text-neutral-600">{checkoutGuestName} has left {checkoutRoomLabel} and the room is ready for the departure workflow.</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`hidden text-sm font-semibold sm:inline ${roomVacantConfirmed ? "text-emerald-700" : "text-neutral-500"}`}>{roomVacantConfirmed ? "Confirmed" : "Confirm"}</span>
                    <span className={`relative block h-7 w-12 rounded-full transition-colors ${roomVacantConfirmed ? "bg-emerald-700" : "bg-neutral-300"}`} aria-hidden="true">
                      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${roomVacantConfirmed ? "translate-x-5" : "translate-x-0.5"}`} />
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </ModalFrame>
    )}
    {voidingCharge && (
      <ModalFrame title="Void extra charge" onClose={closeVoidCharge} elevated compact>
        <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3">
          <div className="min-w-0 space-y-2">
            <div className="rounded-xl border border-red-100 bg-red-50/70 p-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <p className="truncate text-xs font-bold text-neutral-900">Charge being voided</p>
              </div>
              <p className="mt-2 truncate text-[11px] font-medium text-neutral-600">
                {NRMS_CHARGE_CATEGORY_LABELS[voidingCharge.category as keyof typeof NRMS_CHARGE_CATEGORY_LABELS] ?? voidingCharge.category.replace(/_/g, " ").toLowerCase()}
                {voidingCharge.description ? ` · ${voidingCharge.description}` : ""}
              </p>
              <p className="mt-1 text-sm font-extrabold text-neutral-900">{money(voidingCharge.amount, voidingCharge.currency)}</p>
              <p className="mt-0.5 text-[9px] tabular-nums leading-3 text-neutral-500">Posted {fmtChargeTimestamp(voidingCharge.createdAt)}</p>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[10px] leading-4 text-amber-900">
              <FileClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p>
                <span className="font-bold">Permanently recorded.</span> The original charge stays in audit history with your account, reason, and timestamp.
              </p>
            </div>
          </div>

          <div className="flex w-full min-w-0 max-w-full flex-col overflow-hidden">
            <label className="block w-full min-w-0 max-w-full text-xs">
              <span className="mb-1 block font-bold text-neutral-800">
                Reason for voiding <span className="text-red-500">*</span>
              </span>
              <textarea
                autoFocus
                required
                rows={3}
                maxLength={300}
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
                disabled={busyAction === "void-charge"}
                placeholder="Example: Charge entered twice"
                className="block w-full min-w-0 max-w-full box-border resize-none rounded-xl border border-neutral-300 bg-white px-2.5 py-2 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-red-400 focus:ring-2 focus:ring-red-500/10 disabled:bg-neutral-100"
              />
              <span className="mt-0.5 block text-right text-[9px] tabular-nums text-neutral-400">{voidReason.length}/300</span>
            </label>

            {voidError && <p role="alert" className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] text-red-700">{voidError}</p>}

            <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={closeVoidCharge}
                disabled={busyAction === "void-charge"}
                className="min-h-9 rounded-lg border border-neutral-300 bg-white px-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Keep charge
              </button>
              <button
                type="button"
                onClick={submitVoidCharge}
                disabled={busyAction === "void-charge" || !voidReason.trim()}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busyAction === "void-charge" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {busyAction === "void-charge" ? "Recording..." : "Record void"}
              </button>
            </div>
          </div>
        </div>
      </ModalFrame>
    )}
    </>
  );
}
