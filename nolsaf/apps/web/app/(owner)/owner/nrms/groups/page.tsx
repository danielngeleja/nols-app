"use client";
// Group reservations: the front desk's home for parties travelling together.
// Distinct from the Owner workspace "Group Stays" (/owner/group-stays), which is
// the NoLSAF-brokered marketplace product. Here a group is simply a set of NRMS
// reservations worked as one unit, and grouping never changes a stay itself.
//
// The reservations table hands a selection over as ?select=1,2,3 rather than
// duplicating the create flow on both pages.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { ArrowRight, ArrowUpDown, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Plus, Search, TriangleAlert, Users, X } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";
import {
  CreateReservationGroupModal,
  ReservationGroupModal,
  type GroupPickReservation,
  type ReservationGroup,
} from "../_components/NrmsGroupModals";
import {
  CreateGroupBlockModal,
  GroupBlockDetailModal,
  type GroupBlock,
} from "../_components/NrmsGroupBlockModals";

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

const GROUP_STATUS_CLS: Record<string, string> = {
  ACTIVE: "bg-blue-50 text-blue-700",
  PARTIALLY_CHECKED_IN: "bg-amber-50 text-amber-700",
  CHECKED_IN: "bg-emerald-50 text-emerald-700",
  PARTIALLY_CHECKED_OUT: "bg-amber-50 text-amber-700",
  CHECKED_OUT: "bg-neutral-100 text-neutral-600",
  CANCELLED: "bg-red-50 text-red-600",
};

const PAGE_SIZE = 10;

function ListPagination({ page, totalItems, onPageChange }: { page: number; totalItems: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const firstItem = totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, totalItems);
  return (
    <nav aria-label="List pagination" className="flex flex-col gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 text-[11px] font-medium text-neutral-500">
        Showing <span className="font-bold tabular-nums text-neutral-800">{firstItem}-{lastItem}</span> of <span className="font-bold tabular-nums text-neutral-800">{totalItems}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white p-0 text-neutral-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-300 disabled:shadow-none"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-24 text-center text-[11px] font-semibold tabular-nums text-neutral-600">Page <strong className="text-neutral-900">{page}</strong> of {pageCount}</span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white p-0 text-neutral-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-300 disabled:shadow-none"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

function fmtDate(v: string): string {
  return new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Block counterpart of the reservations StayProgress bars: four room squares
 * that fill as the agency names its rooms, coloured by where the block stands.
 */
function BlockProgress({ block }: { block: GroupBlock }) {
  const live = block.status === "HELD" || block.status === "PARTIALLY_PICKED_UP";
  const overdue = live && block.cutOffPassed && block.roomsHeld > 0;
  const ratio = block.roomsTotal > 0 ? block.roomsPickedUp / block.roomsTotal : 0;
  const filled = ratio >= 1 ? 4 : ratio > 0 ? Math.max(1, Math.floor(ratio * 4)) : 0;
  const stage = block.status === "CANCELLED"
    ? { label: "Cancelled", fill: "bg-red-400", text: "text-red-600" }
    : block.status === "RELEASED"
      ? { label: "Released", fill: "bg-neutral-400", text: "text-neutral-400" }
      : ratio >= 1
        ? { label: "All named", fill: "bg-emerald-500", text: "text-emerald-700" }
        : block.status === "PICKED_UP"
          ? { label: "Picked up, rest let go", fill: "bg-emerald-500", text: "text-emerald-700" }
        : overdue
          ? { label: "Deadline passed", fill: "bg-amber-500", text: "text-amber-700" }
          : block.roomsPickedUp > 0
            ? { label: "Naming", fill: "bg-emerald-500", text: "text-emerald-700" }
            : { label: "New", fill: "bg-blue-500", text: "text-blue-700" };
  // A brand-new block has nothing named yet; its first square shows it is live.
  const shown = stage.label === "New" ? 1 : filled;
  return (
    <span className="inline-flex items-center gap-2.5" title={`${stage.label} · ${block.roomsPickedUp} of ${block.roomsTotal} rooms named`}>
      <span className="grid shrink-0 grid-cols-2 gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={`h-[7px] w-[7px] rounded-[2px] ${index < shown ? stage.fill : "bg-neutral-200"}`} />
        ))}
      </span>
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-xs font-semibold tabular-nums text-neutral-900">
          {block.roomsPickedUp} of {block.roomsTotal} named
        </span>
        <span className={`mt-0.5 block whitespace-nowrap text-[10px] font-semibold ${stage.text}`}>
          {stage.label}{live && block.roomsHeld > 0 ? ` · ${block.roomsHeld} held` : ""}
        </span>
      </span>
    </span>
  );
}

type SortOrder = "asc" | "desc";
type SortState<F extends string> = { field: F; order: SortOrder };
type BlockSortField = "name" | "agency" | "stay" | "progress" | "namesDue" | "payment" | "status";
type GroupSortField = "name" | "party" | "stay" | "billing" | "status";

// Lifecycle order, so sorting by status reads as the work moves forward.
const BLOCK_STATUS_RANK: Record<string, number> = { HELD: 0, PARTIALLY_PICKED_UP: 1, PICKED_UP: 2, RELEASED: 3, CANCELLED: 4 };
const GROUP_STATUS_RANK: Record<string, number> = { ACTIVE: 0, PARTIALLY_CHECKED_IN: 1, CHECKED_IN: 2, PARTIALLY_CHECKED_OUT: 3, CHECKED_OUT: 4, CANCELLED: 5 };

function blockSortValue(block: GroupBlock, field: BlockSortField): string | number {
  switch (field) {
    case "name": return block.name.toLowerCase();
    case "agency": return (block.agencyName || "Direct").toLowerCase();
    case "stay": return block.checkIn;
    case "progress": return block.roomsTotal > 0 ? block.roomsPickedUp / block.roomsTotal : 0;
    case "namesDue": return block.cutOffAt;
    // Money still owed first, so the list reads as a collections queue.
    case "payment": return blockPaymentState(block).rank * 1e12 - (block.masterFolio?.paymentDue ?? 0);
    case "status": return BLOCK_STATUS_RANK[block.status] ?? 99;
  }
}

function groupSortValue(group: ReservationGroup, field: GroupSortField): string | number {
  switch (field) {
    case "name": return group.name.toLowerCase();
    case "party": return group.members.length || group.memberCount;
    case "stay": return group.members.map((member) => member.checkIn).filter(Boolean).sort()[0] ?? "";
    case "billing": return group.billingMode;
    case "status": return GROUP_STATUS_RANK[group.status] ?? 99;
  }
}

function sortRows<T, F extends string>(rows: T[], sort: SortState<F>, value: (row: T, field: F) => string | number): T[] {
  const direction = sort.order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a, sort.field);
    const right = value(b, sort.field);
    const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return compared * direction;
  });
}

function nextSort<F extends string>(current: SortState<F>, field: F): SortState<F> {
  return current.field === field ? { field, order: current.order === "asc" ? "desc" : "asc" } : { field, order: "asc" };
}

function SortHeader<F extends string>({ label, field, sort, onSort }: { label: string; field: F; sort: SortState<F>; onSort: (field: F) => void }) {
  const active = sort.field === field;
  return (
    <th
      className="border-0 border-b border-solid border-neutral-200 px-4 py-3"
      aria-sort={active ? (sort.order === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex cursor-pointer appearance-none items-center gap-1.5 !m-0 !border-0 !bg-transparent !p-0 text-[10px] font-bold uppercase tracking-[0.1em] !shadow-none !outline-none transition hover:text-emerald-700 focus-visible:text-emerald-700 ${active ? "text-neutral-900" : "text-neutral-500"}`}
      >
        {label}
        {active
          ? sort.order === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
          : <ArrowUpDown className="h-3.5 w-3.5 text-neutral-300" />}
      </button>
    </th>
  );
}

type BlockFilters = { q: string; status: string; agency: string; from: string; to: string; attention: boolean; payment?: string };
type GroupFilters = { q: string; status: string; billing: string; source: string; from: string; to: string; attention?: boolean };
const EMPTY_BLOCK_FILTERS: BlockFilters = { q: "", status: "", agency: "", from: "", to: "", attention: false };
const EMPTY_GROUP_FILTERS: GroupFilters = { q: "", status: "", billing: "", source: "", from: "", to: "" };

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** A stay [checkIn, checkOut) touches the chosen window when it has at least one night inside it. */
function stayTouchesWindow(checkIn: string, checkOut: string, from: string, to: string): boolean {
  if (from && checkOut.slice(0, 10) <= from) return false;
  if (to && checkIn.slice(0, 10) > to) return false;
  return true;
}

// These mirror the sidebar's Group reservations badge (nrmsAttention.ts), so
// every unit of that number can be found on this page.

/** The agency submitted its rooming list and the desk has not reviewed it yet. */
function blockNamesWaiting(block: GroupBlock): boolean {
  return block.roomingList?.status === "SUBMITTED";
}

/** A live block whose names deadline has passed. */
function blockDeadlinePassed(block: GroupBlock): boolean {
  return (block.status === "HELD" || block.status === "PARTIALLY_PICKED_UP") && block.cutOffPassed;
}

function blockNeedsAttention(block: GroupBlock): boolean {
  return blockNamesWaiting(block) || blockDeadlinePassed(block);
}

/** Members due in today (still confirmed) or due out today (still in house). */
function groupDueToday(group: ReservationGroup): { arrivals: number; departures: number } {
  const tomorrow = new Date(`${todayKey()}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const cutoff = tomorrow.getTime();
  return {
    arrivals: group.members.filter((member) => member.status === "CONFIRMED" && new Date(member.checkIn).getTime() < cutoff).length,
    departures: group.members.filter((member) => member.status === "CHECKED_IN" && new Date(member.checkOut).getTime() < cutoff).length,
  };
}

function groupNeedsAttention(group: ReservationGroup): boolean {
  const due = groupDueToday(group);
  return due.arrivals + due.departures > 0;
}

/** Pulsing dot used on every surface that feeds the sidebar badge. */
function AttentionDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-2.5 w-2.5 shrink-0 ${className}`} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
    </span>
  );
}

function filterBlocks(blocks: GroupBlock[], filters: BlockFilters): GroupBlock[] {
  const needle = filters.q.trim().toLowerCase();
  return blocks.filter((block) => {
    if (needle && ![block.name, block.reference, block.agencyName ?? "Direct"].some((text) => text.toLowerCase().includes(needle))) return false;
    if (filters.status && block.status !== filters.status) return false;
    if (filters.agency && (block.agencyName || "Direct") !== filters.agency) return false;
    if (filters.payment && blockPaymentState(block).key !== filters.payment) return false;
    if (!stayTouchesWindow(block.checkIn, block.checkOut, filters.from, filters.to)) return false;
    if (filters.attention && !blockNeedsAttention(block)) return false;
    return true;
  });
}

function filterGroups(groups: ReservationGroup[], filters: GroupFilters): ReservationGroup[] {
  const needle = filters.q.trim().toLowerCase();
  return groups.filter((group) => {
    if (needle) {
      const haystack = [
        group.name,
        group.reference,
        group.sourceBlock?.reference ?? "",
        ...group.members.flatMap((member) => [member.guestProfile?.fullName ?? "", ...member.rooms.map((room) => room.roomUnitCode ?? "")]),
      ];
      if (!haystack.some((text) => text.toLowerCase().includes(needle))) return false;
    }
    if (filters.status && group.status !== filters.status) return false;
    if (filters.billing && group.billingMode !== filters.billing) return false;
    if (filters.source === "BLOCK" && !group.sourceBlock) return false;
    if (filters.source === "DESK" && group.sourceBlock) return false;
    if (filters.attention && !groupNeedsAttention(group)) return false;
    if (filters.from || filters.to) {
      const dates = group.members.flatMap((member) => [member.checkIn, member.checkOut]).filter(Boolean).sort();
      if (!dates.length || !stayTouchesWindow(dates[0], dates[dates.length - 1], filters.from, filters.to)) return false;
    }
    return true;
  });
}

const filterControlCls = "box-border h-10 min-w-0 rounded-xl border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-800 shadow-sm outline-none transition hover:border-neutral-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

function FilterField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{label}</span>
      {children}
    </div>
  );
}

function FilterSelect({ label, allLabel, value, onChange, options }: { label: string; allLabel: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <FilterField label={label}>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={`${filterControlCls} min-w-[10rem] cursor-pointer pr-8 ${value ? "border-emerald-300 bg-emerald-50/60 font-semibold text-emerald-900" : ""}`}>
        <option value="">{allLabel}</option>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </FilterField>
  );
}

/**
 * Shared toolbar: search, the tab's own selects, a stay window and a count.
 * Filtering is client-side because the page already holds every block and group.
 */
function FilterBar({
  query,
  onQuery,
  placeholder,
  from,
  to,
  onFrom,
  onTo,
  activeCount,
  shown,
  total,
  noun,
  onClear,
  children,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  activeCount: number;
  shown: number;
  total: number;
  noun: string;
  onClear: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-0 border-b border-solid border-neutral-200">
      <div className="flex flex-wrap items-end gap-3 bg-neutral-50/70 px-4 py-4 sm:px-5">
        <FilterField label="Search" className="min-w-[16rem] flex-1 basis-64">
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className={`${filterControlCls} w-full pl-9 ${query.trim() ? "border-emerald-300" : ""}`}
            />
          </span>
        </FilterField>
        {children}
        <FilterField label="Stay window">
          <span className="flex items-center gap-2">
            <DatePickerField label="Stay from" value={from} onChangeAction={onFrom} max={to || undefined} size="sm" twoMonths={false} widthClassName="w-[9.75rem]" />
            <span className="text-sm text-neutral-400">to</span>
            <DatePickerField label="Stay to" value={to} onChangeAction={onTo} min={from || undefined} size="sm" twoMonths={false} widthClassName="w-[9.75rem]" />
            {(from || to) && (
              <button
                type="button"
                onClick={() => { onFrom(""); onTo(""); }}
                aria-label="Clear stay window"
                className="inline-flex h-10 w-10 shrink-0 cursor-pointer appearance-none items-center justify-center rounded-xl border border-solid border-neutral-200 bg-white p-0 text-neutral-500 shadow-sm transition hover:border-red-200 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </span>
        </FilterField>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-500 sm:px-5">
        <span className="flex flex-wrap items-center gap-2">
          <span>Showing <strong className="tabular-nums text-neutral-900">{shown}</strong> of <strong className="tabular-nums text-neutral-900">{total}</strong> {noun}</span>
          {activeCount > 0 && <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800">{activeCount} {activeCount === 1 ? "filter" : "filters"} on</span>}
        </span>
        {activeCount > 0 && (
          <button type="button" onClick={onClear} className="inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-emerald-700 transition hover:text-emerald-900">
            <X className="h-4 w-4" /> Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function FilteredEmpty({ noun, onClear }: { noun: string; onClear: () => void }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="m-0 text-sm font-bold text-neutral-900">No {noun} match these filters</p>
      <p className="m-0 mt-1 text-xs text-neutral-500">Loosen a filter or clear them all to see every {noun.replace(/s$/, "")}.</p>
      <button type="button" onClick={onClear} className="mt-3 inline-flex cursor-pointer appearance-none items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-emerald-300 hover:text-emerald-800">
        <X className="h-3.5 w-3.5" /> Clear filters
      </button>
    </div>
  );
}

/**
 * Where the agency's money stands on a block. Blocks billed per guest have no
 * agency account, so there is nothing for the agency to pay.
 */
function blockPaymentState(block: GroupBlock): { key: string; label: string; detail: string | null; cls: string; rank: number } {
  const folio = block.masterFolio;
  const amount = (value: number) => `${folio?.currency ?? block.currency} ${Math.round(value).toLocaleString()}`;
  if (!folio) return { key: "GUESTS", label: "Guests pay", detail: "Each guest's own folio", cls: "text-neutral-500", rank: 5 };
  if (folio.credit > 0.005) return { key: "CREDIT", label: "Credit", detail: `${amount(folio.credit)} to refund`, cls: "text-blue-700", rank: 1 };
  if (folio.paymentDue > 0.005 && folio.paid > 0.005) return { key: "PART", label: "Part paid", detail: `${amount(folio.paymentDue)} due`, cls: "text-amber-700", rank: 2 };
  if (folio.paymentDue > 0.005) return { key: "UNPAID", label: "Unpaid", detail: `${amount(folio.paymentDue)} due`, cls: "text-red-600", rank: 0 };
  if (folio.paid > 0.005) return { key: "PAID", label: "Paid", detail: amount(folio.paid), cls: "text-emerald-700", rank: 3 };
  return { key: "NOT_INVOICED", label: "Not invoiced", detail: "No charges or Pro Forma yet", cls: "text-neutral-500", rank: 4 };
}

const PAYMENT_FILTER_OPTIONS: Array<[string, string]> = [
  ["UNPAID", "Unpaid"],
  ["PART", "Part paid"],
  ["PAID", "Paid"],
  ["CREDIT", "Credit to refund"],
  ["NOT_INVOICED", "Not invoiced"],
  ["GUESTS", "Guests pay"],
];

/** Same room squares as BlockProgress, filled by how far the party is through its stay. */
function GroupProgress({ group }: { group: ReservationGroup }) {
  const total = group.members.length || group.memberCount;
  const inHouse = group.members.filter((member) => member.status === "CHECKED_IN").length;
  const out = group.members.filter((member) => member.status === "CHECKED_OUT").length;
  const arrived = inHouse + out;
  const ratio = total > 0 ? arrived / total : 0;
  const filled = ratio >= 1 ? 4 : ratio > 0 ? Math.max(1, Math.floor(ratio * 4)) : 0;
  const firstArrival = group.members.map((member) => member.checkIn).filter(Boolean).sort()[0];
  const stage = group.status === "CANCELLED"
    ? { label: "Cancelled", fill: "bg-red-400", text: "text-red-600", shown: 0 }
    : total > 0 && out === total
      ? { label: "All checked out", fill: "bg-neutral-400", text: "text-neutral-500", shown: 4 }
      : inHouse > 0
        ? { label: `${inHouse} of ${total} in house`, fill: "bg-emerald-500", text: "text-emerald-700", shown: filled }
        : { label: firstArrival ? `Arriving ${fmtDate(firstArrival)}` : "Arriving", fill: "bg-blue-500", text: "text-blue-700", shown: 1 };
  return (
    <span className="inline-flex items-center gap-2.5" title={`${stage.label} · ${total} ${total === 1 ? "room" : "rooms"}`}>
      <span className="grid shrink-0 grid-cols-2 gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={`h-[7px] w-[7px] rounded-[2px] ${index < stage.shown ? stage.fill : "bg-neutral-200"}`} />
        ))}
      </span>
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-xs font-semibold tabular-nums text-neutral-900">{total} {total === 1 ? "room" : "rooms"}</span>
        <span className={`mt-0.5 block whitespace-nowrap text-[10px] font-semibold ${stage.text}`}>{stage.label}</span>
      </span>
    </span>
  );
}

const GROUP_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PARTIALLY_CHECKED_IN: "Part checked in",
  CHECKED_IN: "Checked in",
  PARTIALLY_CHECKED_OUT: "Part checked out",
  CHECKED_OUT: "Checked out",
  CANCELLED: "Cancelled",
};

const BILLING_LABEL: Record<ReservationGroup["billingMode"], { label: string; detail: string }> = {
  MASTER: { label: "Agency pays all", detail: "Rooms and extras on one folio" },
  SPLIT: { label: "Agency pays rooms", detail: "Guests settle their own extras" },
  INDIVIDUAL: { label: "Each guest pays", detail: "Separate folio per room" },
};

function reservationsShareCommonNight(reservations: GroupPickReservation[]): boolean {
  if (reservations.length < 2) return true;
  const latestArrival = Math.max(...reservations.map((reservation) => new Date(reservation.checkIn).getTime()));
  const earliestDeparture = Math.min(...reservations.map((reservation) => new Date(reservation.checkOut).getTime()));
  return Number.isFinite(latestArrival) && Number.isFinite(earliestDeparture) && latestArrival < earliestDeparture;
}

/** Earliest arrival and latest departure across the members, the party's window. */
function groupWindow(group: ReservationGroup): string {
  const dates = group.members.flatMap((member) => [member.checkIn, member.checkOut]).filter(Boolean);
  if (!dates.length) return "Dates not set";
  const sorted = [...dates].sort();
  return `${fmtDate(sorted[0])} to ${fmtDate(sorted[sorted.length - 1])}`;
}

export default function NrmsGroupReservationsPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const accessRole = selectedProperty?.nrmsAccessRole ?? "OWNER";
  const ownerWorkspace = accessRole === "OWNER";
  // Two different jobs on one page, and only one of them is the owner's alone.
  //
  // A block is a commercial agreement with an agency: rooms held before any
  // guest exists. That is the sales executive's own work and the API now admits
  // them (loadGroupManageAccess). Building a GROUP, on the other hand, gathers
  // reservations that already exist into one travelling party, which is a
  // reservations action sales holds no capability for, so it stays with
  // ownerWorkspace below.
  const canManageBlocks = ["OWNER", "MANAGER", "SALES_EXECUTIVE"].includes(accessRole);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [groups, setGroups] = useState<ReservationGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<number | null>(null);
  const [pending, setPending] = useState<GroupPickReservation[] | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"BLOCKS" | "GROUPS">("BLOCKS");
  const [blocks, setBlocks] = useState<GroupBlock[]>([]);
  const [showCreateBlock, setShowCreateBlock] = useState(false);
  const [openBlockId, setOpenBlockId] = useState<number | null>(null);
  const [blockPage, setBlockPage] = useState(1);
  const [groupPage, setGroupPage] = useState(1);

  const selectParam = searchParams.get("select");
  const selectedIds = useMemo(
    () => (selectParam ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0),
    [selectParam],
  );

  // ?group=<GRP- reference> opens that party straight away, so a verified
  // agency manifest can hand the desk to its rooms in one click. The URL carries
  // the group's random reference, never its numeric id; it is matched against
  // the groups this property already loads.
  const groupParam = searchParams.get("group");
  // Open once per link: the list reloads after every group action, and a
  // closed group must not pop back open.
  const openedGroupParam = useRef<string | null>(null);
  useEffect(() => {
    if (!groupParam || openedGroupParam.current === groupParam) return;
    const match = groups.find((group) => group.reference === groupParam);
    if (!match) return;
    openedGroupParam.current = groupParam;
    setTab("GROUPS");
    setOpenGroupId(match.id);
  }, [groupParam, groups]);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const blockResponse = await apiClient.get<any>(`/api/owner/nrms/group-blocks/property/${selectedPropertyId}/blocks`);
      setBlocks(blockResponse.data?.blocks ?? []);
      const groupResponse = await apiClient.get<any>(`/api/owner/nrms/reservations/property/${selectedPropertyId}/groups`);
      setGroups(groupResponse.data?.groups ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load group reservations");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

  const [blockFilters, setBlockFilters] = useState<BlockFilters>(EMPTY_BLOCK_FILTERS);
  const [groupFilters, setGroupFilters] = useState<GroupFilters>(EMPTY_GROUP_FILTERS);
  const filteredBlocks = useMemo(() => filterBlocks(blocks, blockFilters), [blocks, blockFilters]);
  const filteredGroups = useMemo(() => filterGroups(groups, groupFilters), [groups, groupFilters]);
  const blockFilterCount = [blockFilters.q.trim(), blockFilters.status, blockFilters.payment, blockFilters.agency, blockFilters.from || blockFilters.to, blockFilters.attention].filter(Boolean).length;
  const groupFilterCount = [groupFilters.q.trim(), groupFilters.status, groupFilters.billing, groupFilters.source, groupFilters.from || groupFilters.to, groupFilters.attention].filter(Boolean).length;
  const agencyOptions = useMemo(() => [...new Set(blocks.map((block) => block.agencyName || "Direct"))].sort((a, b) => a.localeCompare(b)), [blocks]);
  const attentionCount = useMemo(() => blocks.filter(blockNeedsAttention).length, [blocks]);
  const namesWaitingCount = useMemo(() => blocks.filter(blockNamesWaiting).length, [blocks]);
  const groupAttentionCount = useMemo(() => groups.filter(groupNeedsAttention).length, [groups]);
  const headerStats = useMemo(() => {
    const liveBlocks = blocks.filter((block) => block.status === "HELD" || block.status === "PARTIALLY_PICKED_UP");
    const roomsHeld = liveBlocks.reduce((sum, block) => sum + block.roomsHeld, 0);
    const inHouse = groups.filter((group) => group.members.some((member) => member.status === "CHECKED_IN"));
    const today = todayKey();
    const weekAhead = new Date(`${today}T00:00:00`);
    weekAhead.setDate(weekAhead.getDate() + 7);
    const arriving = groups.filter((group) => group.members.some((member) =>
      member.status === "CONFIRMED" || member.status === "HELD"
        ? member.checkIn.slice(0, 10) >= today && new Date(member.checkIn).getTime() <= weekAhead.getTime()
        : false));
    return [
      { label: "Live blocks", value: liveBlocks.length, note: `${roomsHeld} ${roomsHeld === 1 ? "room" : "rooms"} held for agencies`, tone: "text-neutral-950" },
      {
        label: "Needs attention",
        value: attentionCount + groupAttentionCount,
        note: attentionCount + groupAttentionCount === 0
          ? "Nothing waiting on the desk"
          : [
              namesWaitingCount ? `${namesWaitingCount} rooming ${namesWaitingCount === 1 ? "list" : "lists"} to review` : "",
              attentionCount - namesWaitingCount > 0 ? `${attentionCount - namesWaitingCount} past deadline` : "",
              groupAttentionCount ? `${groupAttentionCount} due today` : "",
            ].filter(Boolean).join(" · "),
        tone: attentionCount + groupAttentionCount > 0 ? "text-amber-700" : "text-neutral-950",
      },
      { label: "Groups in house", value: inHouse.length, note: `${inHouse.reduce((sum, group) => sum + group.members.filter((member) => member.status === "CHECKED_IN").length, 0)} rooms occupied by parties`, tone: inHouse.length > 0 ? "text-emerald-700" : "text-neutral-950" },
      { label: "Arriving this week", value: arriving.length, note: arriving.length > 0 ? "Parties due in the next 7 days" : "No parties due in 7 days", tone: "text-neutral-950" },
    ];
  }, [attentionCount, blocks, groupAttentionCount, groups, namesWaitingCount]);
  const updateBlockFilters = (patch: Partial<BlockFilters>) => { setBlockFilters((current) => ({ ...current, ...patch })); setBlockPage(1); };
  const updateGroupFilters = (patch: Partial<GroupFilters>) => { setGroupFilters((current) => ({ ...current, ...patch })); setGroupPage(1); };

  const blockPageCount = Math.max(1, Math.ceil(filteredBlocks.length / PAGE_SIZE));
  const groupPageCount = Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE));
  const [blockSort, setBlockSort] = useState<SortState<BlockSortField>>({ field: "stay", order: "asc" });
  const [groupSort, setGroupSort] = useState<SortState<GroupSortField>>({ field: "stay", order: "asc" });
  const sortedBlocks = useMemo(() => sortRows(filteredBlocks, blockSort, blockSortValue), [filteredBlocks, blockSort]);
  const sortedGroups = useMemo(() => sortRows(filteredGroups, groupSort, groupSortValue), [filteredGroups, groupSort]);
  const visibleBlocks = useMemo(() => sortedBlocks.slice((blockPage - 1) * PAGE_SIZE, blockPage * PAGE_SIZE), [blockPage, sortedBlocks]);
  const visibleGroups = useMemo(() => sortedGroups.slice((groupPage - 1) * PAGE_SIZE, groupPage * PAGE_SIZE), [groupPage, sortedGroups]);
  const changeBlockSort = (field: BlockSortField) => { setBlockSort((current) => nextSort(current, field)); setBlockPage(1); };
  const changeGroupSort = (field: GroupSortField) => { setGroupSort((current) => nextSort(current, field)); setGroupPage(1); };

  useEffect(() => { setBlockPage((current) => Math.min(current, blockPageCount)); }, [blockPageCount]);
  useEffect(() => { setGroupPage((current) => Math.min(current, groupPageCount)); }, [groupPageCount]);
  useEffect(() => {
    setBlockPage(1);
    setGroupPage(1);
    setBlockFilters(EMPTY_BLOCK_FILTERS);
    setGroupFilters(EMPTY_GROUP_FILTERS);
  }, [selectedPropertyId]);

  // A selection arriving from the reservations table is resolved here so the
  // create modal can show who is in the party before it is committed.
  useEffect(() => {
    if (!ownerWorkspace || !selectedPropertyId || selectedIds.length < 2) { setPending(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const response = await apiClient.get<any>(`/api/owner/nrms/reservations/property/${selectedPropertyId}`, {
          params: { limit: 200, offset: 0, sortBy: "checkIn", sortOrder: "asc" },
        });
        if (cancelled) return;
        const all: GroupPickReservation[] = response.data?.reservations ?? [];
        const picked = all.filter((reservation) => selectedIds.includes(reservation.id));
        if (picked.length !== selectedIds.length) {
          setPendingError("Some selected reservations are no longer available for grouping. Reopen the selection from Reservations.");
          setPending(null);
          return;
        }
        if (picked.some((reservation) => reservation.agentBooking)) {
          setPendingError("Agency reservations stay in their agency group and rooming-list workflow.");
          setPending(null);
          return;
        }
        if (picked.some((reservation) => !["HELD", "CONFIRMED"].includes(reservation.status))) {
          setPendingError("Only held or confirmed reservations can form a group before check-in.");
          setPending(null);
          return;
        }
        if (!reservationsShareCommonNight(picked)) {
          setPendingError("The selected reservations do not share a common night and cannot form one travelling party.");
          setPending(null);
          return;
        }
        setPendingError(null);
        setPending(picked);
      } catch {
        if (!cancelled) setPendingError("Could not load the selected reservations");
      }
    })();
    return () => { cancelled = true; };
  }, [ownerWorkspace, selectedIds, selectedPropertyId]);

  useEffect(() => { if (pending) setTab("GROUPS"); }, [pending]);

  const clearSelection = useCallback(() => {
    setPending(null);
    setPendingError(null);
    setShowCreate(false);
    router.replace("/owner/nrms/groups");
  }, [router]);

  const addSelectionToGroup = useCallback(async (groupId: number) => {
    setAdding(true);
    setPendingError(null);
    try {
      await apiClient.post<any>(`/api/owner/nrms/reservations/groups/${groupId}/members`, { reservationIds: selectedIds });
      clearSelection();
      await load();
      setOpenGroupId(groupId);
    } catch (e: any) {
      setPendingError(e?.response?.data?.error || "Failed to add the selected reservations to that group");
    } finally {
      setAdding(false);
    }
  }, [clearSelection, load, selectedIds]);

  return (
    <div className="min-w-0 max-w-full pb-10">
      <section className="mb-5 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
        <header className="flex flex-col gap-4 px-5 pb-4 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-solid border-emerald-100 bg-emerald-50 text-emerald-700">
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Front desk · Groups</p>
              <h1 className="m-0 mt-0.5 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Group reservations</h1>
              <p className="mb-0 mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                {tab === "BLOCKS"
                  ? "Rooms held for an agency before the guest names arrive. Nobody else can sell them until the names deadline."
                  : "Parties travelling together. Every member keeps their own room, folio, payment and audit trail."}
              </p>
            </div>
          </div>
          {canManageBlocks && tab === "BLOCKS" ? (
            <button
              type="button"
              onClick={() => setShowCreateBlock(true)}
              className="inline-flex min-h-11 w-full shrink-0 cursor-pointer appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 sm:w-auto"
            >
              <Plus className="h-4 w-4" /> Create group block
            </button>
          ) : ownerWorkspace ? (
            <Link
              href="/owner/nrms/reservations"
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-bold text-white no-underline shadow-sm transition-colors hover:bg-emerald-800 sm:w-auto"
            >
              <Plus className="h-4 w-4" /> Build a group
            </Link>
          ) : null}
        </header>

        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-neutral-100 bg-neutral-100 lg:grid-cols-4">
          {headerStats.map((stat) => (
            <div key={stat.label} className="min-w-0 bg-white px-5 py-3.5 sm:px-6">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{stat.label}</dt>
              <dd className={`m-0 mt-1 text-2xl font-bold tabular-nums tracking-tight ${stat.tone}`}>{stat.value}</dd>
              <p className="m-0 mt-0.5 truncate text-xs text-neutral-400">{stat.note}</p>
            </div>
          ))}
        </dl>

        <nav role="tablist" aria-label="Group reservation views" className="flex gap-1 border-0 border-t border-solid border-neutral-200 px-3 sm:px-4">
          {([
            ["BLOCKS", "Blocks", blocks.length, attentionCount],
            ["GROUPS", "Reservation groups", groups.length, groupAttentionCount],
          ] as const).map(([value, label, count, alerts]) => {
            const active = tab === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(value)}
                className={`-mb-px inline-flex h-12 cursor-pointer appearance-none items-center gap-2 border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-semibold transition-colors ${active ? "border-emerald-700 text-emerald-800" : "border-transparent text-neutral-500 hover:text-neutral-900"}`}
              >
                {value === "BLOCKS" ? <CalendarClock className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                <span>{label}</span>
                <span className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${active ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-500"}`}>{count}</span>
                {alerts > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 py-0.5 pl-1.5 pr-2 text-xs font-bold tabular-nums text-amber-800" title={`${alerts} need attention`}>
                    <AttentionDot /> {alerts}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </section>

      {pendingError && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-3">
          <p className="m-0 text-xs font-semibold text-amber-900">{pendingError}</p>
          <button type="button" onClick={clearSelection} className="cursor-pointer rounded-lg border border-solid border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 transition hover:bg-amber-100">Dismiss</button>
        </div>
      )}
      {error && <p className="m-0 mb-4 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {pending && (
        <section className="mb-4 rounded-2xl border border-solid border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Users className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="m-0 text-sm font-bold text-emerald-950">{pending.length} reservations carried over from Reservations</p>
                <p className="m-0 mt-0.5 truncate text-xs text-emerald-800">{pending.map((reservation) => reservation.guestProfile?.fullName ?? "Guest").join(", ")}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {groups.length > 0 && (
                <select
                  aria-label="Add the carried-over reservations to an existing group"
                  value=""
                  disabled={adding}
                  onChange={(event) => { if (event.target.value) void addSelectionToGroup(Number(event.target.value)); }}
                  className="cursor-pointer rounded-lg border border-solid border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 disabled:opacity-50"
                >
                  <option value="">Add to an existing group</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              )}
              <button type="button" onClick={() => setShowCreate(true)} disabled={adding} className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create a new group
              </button>
              <button type="button" onClick={clearSelection} disabled={adding} className="cursor-pointer rounded-lg border border-solid border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50">Clear</button>
            </div>
          </div>
        </section>
      )}

      {loading ? (
        <div className="flex justify-center py-20 text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : tab === "BLOCKS" ? (
        blocks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CalendarClock className="h-5 w-5" /></span>
            <p className="m-0 text-sm font-bold text-neutral-900">No group blocks yet</p>
            <p className="m-0 mx-auto mt-1 max-w-lg text-xs leading-5 text-neutral-500">
              A block holds rooms for a party before anyone knows the guest names. Agree the rooms, dates and rate with the agency now, collect the names later, and nobody can sell those rooms in the meantime.
            </p>
            {canManageBlocks && <button
              type="button"
              onClick={() => setShowCreateBlock(true)}
              className="mt-4 inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800"
            >
              <Plus className="h-3.5 w-3.5" /> New group block
            </button>}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
            <FilterBar
              query={blockFilters.q}
              onQuery={(q) => updateBlockFilters({ q })}
              placeholder="Search block, reference or agency"
              from={blockFilters.from}
              to={blockFilters.to}
              onFrom={(from) => updateBlockFilters({ from })}
              onTo={(to) => updateBlockFilters({ to })}
              activeCount={blockFilterCount}
              shown={filteredBlocks.length}
              total={blocks.length}
              noun="blocks"
              onClear={() => { setBlockFilters(EMPTY_BLOCK_FILTERS); setBlockPage(1); }}
            >
              <FilterSelect
                label="Status"
                allLabel="All statuses"
                value={blockFilters.status}
                onChange={(status) => updateBlockFilters({ status })}
                options={Object.entries(BLOCK_STATUS_LABEL)}
              />
              <FilterSelect
                label="Payment"
                allLabel="Any payment"
                value={blockFilters.payment ?? ""}
                onChange={(payment) => updateBlockFilters({ payment })}
                options={PAYMENT_FILTER_OPTIONS}
              />
              <FilterSelect
                label="Agency"
                allLabel="All agencies"
                value={blockFilters.agency}
                onChange={(agency) => updateBlockFilters({ agency })}
                options={agencyOptions.map((agency) => [agency, agency])}
              />
              <FilterField label="Quick filter">
                <button
                  type="button"
                  aria-pressed={blockFilters.attention}
                  onClick={() => updateBlockFilters({ attention: !blockFilters.attention })}
                  title="Rooming lists waiting for review, or live blocks past their names deadline"
                  className={`inline-flex h-10 cursor-pointer appearance-none items-center gap-2 rounded-xl border border-solid px-3 text-sm font-semibold shadow-sm transition ${blockFilters.attention ? "border-amber-300 bg-amber-50 text-amber-800" : "border-neutral-200 bg-white text-neutral-700 hover:border-amber-200 hover:text-amber-800"}`}
                >
                  <TriangleAlert className="h-4 w-4" /> Needs attention
                  <span className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold ${attentionCount > 0 ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-500"}`}>{attentionCount}</span>
                </button>
              </FilterField>
            </FilterBar>
            {filteredBlocks.length === 0 ? <FilteredEmpty noun="blocks" onClear={() => { setBlockFilters(EMPTY_BLOCK_FILTERS); setBlockPage(1); }} /> : <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <SortHeader label="Block" field="name" sort={blockSort} onSort={changeBlockSort} />
                    <SortHeader label="Agency" field="agency" sort={blockSort} onSort={changeBlockSort} />
                    <SortHeader label="Stay" field="stay" sort={blockSort} onSort={changeBlockSort} />
                    <SortHeader label="Progress" field="progress" sort={blockSort} onSort={changeBlockSort} />
                    <SortHeader label="Names due" field="namesDue" sort={blockSort} onSort={changeBlockSort} />
                    <SortHeader label="Payment" field="payment" sort={blockSort} onSort={changeBlockSort} />
                    <SortHeader label="Status" field="status" sort={blockSort} onSort={changeBlockSort} />
                    <th className="w-10 border-0 border-b border-solid border-neutral-200 px-4 py-3"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child_td]:border-b-0">
                  {visibleBlocks.map((block) => {
                    // Only a live block still holds rooms; a released or cancelled
                    // one has nothing waiting on the agency, so no deadline warning.
                    const live = block.status === "HELD" || block.status === "PARTIALLY_PICKED_UP";
                    const overdue = live && block.cutOffPassed && block.roomsHeld > 0;
                    const nights = Math.max(1, Math.round((new Date(block.checkOut).getTime() - new Date(block.checkIn).getTime()) / 86_400_000));
                    return (
                      <tr
                        key={block.id}
                        onClick={() => setOpenBlockId(block.id)}
                        className="group cursor-pointer transition hover:bg-emerald-50/50"
                      >
                        <td className="max-w-64 border-0 border-b border-solid border-neutral-200 px-4 py-3 align-middle">
                          <span className="flex min-w-0 items-center gap-2">
                            {blockNeedsAttention(block) && <AttentionDot />}
                            <span className="truncate font-bold text-neutral-900" title={block.name}>{block.name}</span>
                          </span>
                          <span className="mt-0.5 block font-mono text-[10px] tracking-wide text-neutral-400">{block.reference}</span>
                          {blockNamesWaiting(block) && (
                            <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                              New names in rooming list{block.roomingList?.rowCount ? ` · ${block.roomingList.rowCount}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="max-w-48 border-0 border-b border-solid border-neutral-200 px-4 py-3 align-middle text-neutral-700">
                          <span className="block truncate" title={block.agencyName ?? ""}>{block.agencyName || "Direct"}</span>
                        </td>
                        <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-4 py-3 align-middle">
                          <span className="block tabular-nums text-neutral-800">{fmtDate(block.checkIn)} to {fmtDate(block.checkOut)}</span>
                          <span className="mt-0.5 block text-[11px] text-neutral-400">{nights} {nights === 1 ? "night" : "nights"}</span>
                        </td>
                        <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-4 py-3 align-middle">
                          <BlockProgress block={block} />
                        </td>
                        <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-4 py-3 align-middle">
                          <span className={`block tabular-nums ${overdue ? "font-semibold text-amber-700" : live ? "text-neutral-800" : "text-neutral-400"}`}>{fmtDate(block.cutOffAt)}</span>
                          <span className={`mt-0.5 block text-[11px] ${overdue ? "font-semibold text-amber-700" : "text-neutral-400"}`}>
                            {blockNamesWaiting(block) ? "Names received, review" : overdue ? "Deadline passed" : live ? "Waiting for names" : "Closed"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-4 py-3 align-middle">
                          {(() => {
                            const payment = blockPaymentState(block);
                            return (
                              <>
                                <span className={`block text-xs font-bold ${payment.cls}`}>{payment.label}</span>
                                {payment.detail && <span className="mt-0.5 block text-[11px] tabular-nums text-neutral-500">{payment.detail}</span>}
                              </>
                            );
                          })()}
                        </td>
                        <td className="border-0 border-b border-solid border-neutral-200 px-4 py-3 align-middle">
                          <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${BLOCK_STATUS_CLS[block.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                            {BLOCK_STATUS_LABEL[block.status] ?? block.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="border-0 border-b border-solid border-neutral-200 px-4 py-3 text-right align-middle">
                          <ArrowRight className="ml-auto h-4 w-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPagination page={blockPage} totalItems={filteredBlocks.length} onPageChange={setBlockPage} />
            </>}
          </div>
        )
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Users className="h-5 w-5" /></span>
          <p className="m-0 text-sm font-bold text-neutral-900">No group reservations yet</p>
          <p className="m-0 mx-auto mt-1 max-w-md text-xs leading-5 text-neutral-500">
            Open Reservations, tick two or more stays that are travelling together, then choose Create a group. You can check the whole party in or out from here afterwards.
          </p>
          <Link
            href="/owner/nrms/reservations"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white no-underline transition hover:bg-emerald-800"
          >
            Go to Reservations <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
          <FilterBar
            query={groupFilters.q}
            onQuery={(q) => updateGroupFilters({ q })}
            placeholder="Search group, reference, guest or room"
            from={groupFilters.from}
            to={groupFilters.to}
            onFrom={(from) => updateGroupFilters({ from })}
            onTo={(to) => updateGroupFilters({ to })}
            activeCount={groupFilterCount}
            shown={filteredGroups.length}
            total={groups.length}
            noun="groups"
            onClear={() => { setGroupFilters(EMPTY_GROUP_FILTERS); setGroupPage(1); }}
          >
            <FilterSelect
              label="Status"
              allLabel="All statuses"
              value={groupFilters.status}
              onChange={(status) => updateGroupFilters({ status })}
              options={Object.entries(GROUP_STATUS_LABEL)}
            />
            <FilterSelect
              label="Billing"
              allLabel="Any billing"
              value={groupFilters.billing}
              onChange={(billing) => updateGroupFilters({ billing })}
              options={(Object.keys(BILLING_LABEL) as Array<ReservationGroup["billingMode"]>).map((mode) => [mode, BILLING_LABEL[mode].label])}
            />
            <FilterSelect
              label="Origin"
              allLabel="Any origin"
              value={groupFilters.source}
              onChange={(source) => updateGroupFilters({ source })}
              options={[["BLOCK", "From a block"], ["DESK", "Built at the desk"]]}
            />
            <FilterField label="Quick filter">
              <button
                type="button"
                aria-pressed={Boolean(groupFilters.attention)}
                onClick={() => updateGroupFilters({ attention: !groupFilters.attention })}
                title="Groups with guests to check in or out today"
                className={`inline-flex h-10 cursor-pointer appearance-none items-center gap-2 rounded-xl border border-solid px-3 text-sm font-semibold shadow-sm transition ${groupFilters.attention ? "border-amber-300 bg-amber-50 text-amber-800" : "border-neutral-200 bg-white text-neutral-700 hover:border-amber-200 hover:text-amber-800"}`}
              >
                <TriangleAlert className="h-4 w-4" /> Due today
                <span className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold ${groupAttentionCount > 0 ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-500"}`}>{groupAttentionCount}</span>
              </button>
            </FilterField>
          </FilterBar>
          {filteredGroups.length === 0 ? <FilteredEmpty noun="groups" onClear={() => { setGroupFilters(EMPTY_GROUP_FILTERS); setGroupPage(1); }} /> : <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-neutral-50 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                  <SortHeader label="Group" field="name" sort={groupSort} onSort={changeGroupSort} />
                  <SortHeader label="Party" field="party" sort={groupSort} onSort={changeGroupSort} />
                  <SortHeader label="Stay" field="stay" sort={groupSort} onSort={changeGroupSort} />
                  <SortHeader label="Billing" field="billing" sort={groupSort} onSort={changeGroupSort} />
                  <SortHeader label="Status" field="status" sort={groupSort} onSort={changeGroupSort} />
                  <th className="w-10 border-0 border-b border-solid border-neutral-200 px-4 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child_td]:border-b-0">
                {visibleGroups.map((group) => {
                  const dates = group.members.flatMap((member) => [member.checkIn, member.checkOut]).filter(Boolean).sort();
                  const nights = dates.length ? Math.max(1, Math.round((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86_400_000)) : null;
                  // Groups born from a block carry an auto-generated note that only
                  // repeats the block reference; show the reference itself instead.
                  const autoNote = Boolean(group.sourceBlock && group.notes?.startsWith("Group block "));
                  const billing = BILLING_LABEL[group.billingMode] ?? BILLING_LABEL.INDIVIDUAL;
                  const cell = "border-0 border-b border-solid border-neutral-200 px-4 py-3 align-middle";
                  return (
                  <tr
                    key={group.id}
                    onClick={() => setOpenGroupId(group.id)}
                    className="group cursor-pointer transition hover:bg-emerald-50/50"
                  >
                    <td className={`max-w-72 ${cell}`}>
                      <span className="flex min-w-0 items-center gap-2">
                        {groupNeedsAttention(group) && <AttentionDot />}
                        <span className="truncate font-bold text-neutral-900" title={group.name}>{group.name}</span>
                      </span>
                      {(() => {
                        const due = groupDueToday(group);
                        if (due.arrivals + due.departures === 0) return null;
                        return (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {due.arrivals > 0 && <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">{due.arrivals} to check in today</span>}
                            {due.departures > 0 && <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">{due.departures} to check out today</span>}
                          </span>
                        );
                      })()}
                      <span className="mt-0.5 block truncate font-mono text-[10px] tracking-wide text-neutral-400">
                        {group.reference}{group.sourceBlock ? ` · from ${group.sourceBlock.reference}` : ""}
                      </span>
                      {group.notes && !autoNote && <span className="mt-0.5 block truncate text-[11px] text-neutral-500" title={group.notes}>{group.notes}</span>}
                    </td>
                    <td className={`whitespace-nowrap ${cell}`}><GroupProgress group={group} /></td>
                    <td className={`whitespace-nowrap ${cell}`}>
                      <span className="block tabular-nums text-neutral-800">{groupWindow(group)}</span>
                      {nights != null && <span className="mt-0.5 block text-[11px] text-neutral-400">{nights} {nights === 1 ? "night" : "nights"}</span>}
                    </td>
                    <td className={`whitespace-nowrap ${cell}`}>
                      <span className="block text-xs font-semibold text-neutral-800">{billing.label}</span>
                      <span className="mt-0.5 block text-[11px] text-neutral-400">{billing.detail}</span>
                    </td>
                    <td className={cell}>
                      <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${GROUP_STATUS_CLS[group.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                        {GROUP_STATUS_LABEL[group.status] ?? group.status.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </td>
                    <td className={`text-right ${cell}`}>
                      <ArrowRight className="ml-auto h-4 w-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ListPagination page={groupPage} totalItems={filteredGroups.length} onPageChange={setGroupPage} />
          </>}
        </div>
      )}

      {pending && showCreate && selectedPropertyId && (
        <CreateReservationGroupModal
          propertyId={selectedPropertyId}
          reservationIds={selectedIds}
          reservations={pending}
          onClose={() => setShowCreate(false)}
          onSaved={async (groupId) => {
            clearSelection();
            await load();
            if (Number.isInteger(groupId) && groupId > 0) setOpenGroupId(groupId);
          }}
        />
      )}

      {openGroupId && (
        <ReservationGroupModal
          groupId={openGroupId}
          onClose={() => setOpenGroupId(null)}
          onChanged={load}
        />
      )}

      {showCreateBlock && selectedPropertyId && (
        <CreateGroupBlockModal
          propertyId={selectedPropertyId}
          accessRole={accessRole}
          onClose={() => setShowCreateBlock(false)}
          onSaved={async () => { setShowCreateBlock(false); await load(); }}
        />
      )}

      {openBlockId && (
        <GroupBlockDetailModal
          blockId={openBlockId}
          accessRole={accessRole}
          onClose={() => setOpenBlockId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
