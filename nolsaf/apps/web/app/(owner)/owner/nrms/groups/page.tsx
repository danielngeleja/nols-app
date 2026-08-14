"use client";
// Group reservations: the front desk's home for parties travelling together.
// Distinct from the Owner workspace "Group Stays" (/owner/group-stays), which is
// the NoLSAF-brokered marketplace product. Here a group is simply a set of NRMS
// reservations worked as one unit, and grouping never changes a stay itself.
//
// The reservations table hands a selection over as ?select=1,2,3 rather than
// duplicating the create flow on both pages.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { ArrowRight, CalendarClock, ChevronLeft, ChevronRight, Loader2, Plus, Users } from "lucide-react";
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

  const blockPageCount = Math.max(1, Math.ceil(blocks.length / PAGE_SIZE));
  const groupPageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const visibleBlocks = useMemo(() => blocks.slice((blockPage - 1) * PAGE_SIZE, blockPage * PAGE_SIZE), [blockPage, blocks]);
  const visibleGroups = useMemo(() => groups.slice((groupPage - 1) * PAGE_SIZE, groupPage * PAGE_SIZE), [groupPage, groups]);

  useEffect(() => { setBlockPage((current) => Math.min(current, blockPageCount)); }, [blockPageCount]);
  useEffect(() => { setGroupPage((current) => Math.min(current, groupPageCount)); }, [groupPageCount]);
  useEffect(() => { setBlockPage(1); setGroupPage(1); }, [selectedPropertyId]);

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
        <header className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="m-0 text-xl font-bold tracking-tight text-neutral-950">Group reservations</h1>
              <p className="mb-0 mt-1 max-w-3xl text-xs leading-5 text-neutral-500 sm:text-sm">
                Manage room blocks and travelling parties while each reservation keeps its own room, folio, payments and audit trail.
              </p>
            </div>
          </div>
          {ownerWorkspace && tab === "BLOCKS" ? (
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

        <nav aria-label="Group reservation views" className="flex gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-3 py-3 sm:px-5">
          {([
            ["BLOCKS", "Blocks", blocks.filter((block) => block.roomsHeld > 0).length],
            ["GROUPS", "Groups in house", groups.length],
          ] as const).map(([value, label, count]) => {
            const active = tab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`inline-flex min-h-10 cursor-pointer appearance-none items-center justify-center gap-2 rounded-xl border border-solid px-3.5 text-xs font-bold transition-all ${active ? "border-emerald-200 bg-white text-emerald-800 shadow-sm" : "border-transparent bg-transparent text-neutral-500 hover:bg-white hover:text-neutral-800"}`}
              >
                {value === "BLOCKS" ? <CalendarClock className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                <span>{label}</span>
                <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200/70 text-neutral-600"}`}>{count}</span>
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
            {ownerWorkspace && <button
              type="button"
              onClick={() => setShowCreateBlock(true)}
              className="mt-4 inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800"
            >
              <Plus className="h-3.5 w-3.5" /> New group block
            </button>}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-solid border-neutral-200 bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="px-4 py-3">Block</th>
                    <th className="px-4 py-3">Agency</th>
                    <th className="px-4 py-3">Stay dates</th>
                    <th className="px-4 py-3 text-center">Held</th>
                    <th className="whitespace-nowrap px-4 py-3 text-center">Picked up</th>
                    <th className="px-4 py-3">Names by</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBlocks.map((block) => (
                    <tr
                      key={block.id}
                      onClick={() => setOpenBlockId(block.id)}
                      className="cursor-pointer border-b border-solid border-neutral-100 transition last:border-b-0 hover:bg-emerald-50/60"
                    >
                      <td className="max-w-64 px-4 py-3">
                        <span className="block truncate font-bold text-neutral-900" title={block.name}>{block.name}</span>
                        <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">{block.reference}</span>
                      </td>
                      <td className="max-w-48 px-4 py-3 text-neutral-600"><span className="block truncate" title={block.agencyName ?? ""}>{block.agencyName || "Direct"}</span></td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-600">{fmtDate(block.checkIn)} to {fmtDate(block.checkOut)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-center font-semibold tabular-nums text-emerald-700">{block.roomsHeld}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-center tabular-nums text-neutral-600">{block.roomsPickedUp} of {block.roomsTotal}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`tabular-nums ${block.cutOffPassed && block.roomsHeld > 0 ? "font-bold text-amber-700" : "text-neutral-600"}`}>{fmtDate(block.cutOffAt)}</span>
                        {block.cutOffPassed && block.roomsHeld > 0 && <span className="ml-1.5 text-[10px] font-bold uppercase text-amber-700">passed</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${BLOCK_STATUS_CLS[block.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                          {BLOCK_STATUS_LABEL[block.status] ?? block.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">Open <ArrowRight className="h-3.5 w-3.5" /></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListPagination page={blockPage} totalItems={blocks.length} onPageChange={setBlockPage} />
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-solid border-neutral-200 bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3 text-center">Rooms</th>
                  <th className="px-4 py-3">Party window</th>
                  <th className="px-4 py-3">Billing</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((group) => (
                  <tr
                    key={group.id}
                    onClick={() => setOpenGroupId(group.id)}
                    className="cursor-pointer border-b border-solid border-neutral-100 transition last:border-b-0 hover:bg-emerald-50/60"
                  >
                    <td className="max-w-72 px-4 py-3">
                      <span className="block truncate font-bold text-neutral-900" title={group.name}>{group.name}</span>
                      {group.notes && <span className="mt-0.5 block truncate text-xs text-neutral-400" title={group.notes}>{group.notes}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold tracking-wide text-neutral-500">{group.reference}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-center font-semibold text-neutral-700">{group.memberCount}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-600">{groupWindow(group)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-neutral-600">
                      {group.billingMode === "MASTER" ? "Agency · all" : group.billingMode === "SPLIT" ? "Agency · rooms" : "Individual"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${GROUP_STATUS_CLS[group.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                        {group.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPagination page={groupPage} totalItems={groups.length} onPageChange={setGroupPage} />
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
