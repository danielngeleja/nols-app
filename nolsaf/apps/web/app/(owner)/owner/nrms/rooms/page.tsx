"use client";

// NRMS Rooms and room types (doc 7.1, 10.4): normalized inventory management
// with roomsSpec reconciliation and one-click import.
import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  AlertTriangle,
  BadgeCheck,
  BedDouble,
  DownloadCloud,
  Loader2,
  PauseCircle,
  Plus,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";
import { NrmsDirectoryShell, NrmsLifecycleRail } from "../_components/NrmsDirectory";

type RoomUnit = {
  id: number;
  roomTypeId: number;
  code: string;
  floor: number | null;
  status: string;
  notes: string | null;
  bedCount: number;
};

type RoomType = {
  id: number;
  name: string;
  description: string | null;
  capacityAdults: number;
  capacityChildren: number;
  bedSetup: string | null;
  baseRate: number | null;
  staffRateFloor: number | null;
  currency: string;
  status: string;
  units: RoomUnit[];
};

type Reconciliation = {
  spec: Array<{ specKey: string; name: string; expectedUnits: number; configuredUnits: number; state: string }>;
  reconciled: boolean;
  specTotalUnits: number;
  configuredTotalUnits: number;
};

const UNIT_STATUS_META: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Ready", cls: "bg-emerald-50 text-emerald-700" },
  INACTIVE: { label: "Inactive", cls: "bg-neutral-100 text-neutral-500" },
  MAINTENANCE: { label: "Maintenance", cls: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200" },
  OUT_OF_SERVICE: { label: "Out of service", cls: "bg-red-50 text-red-600" },
};

const UNIT_STATUSES = ["ACTIVE", "INACTIVE", "MAINTENANCE", "OUT_OF_SERVICE"];

const PROPERTY_CURRENCIES = [
  { code: "TZS", enabled: true },
  { code: "USD", enabled: false },
  { code: "EUR", enabled: false },
  { code: "KES", enabled: false },
];

export default function NrmsRoomsPage() {
  const { selectedPropertyId, selectedProperty, activateProperty, refresh } = useNrms();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [totals, setTotals] = useState<{ roomTypes: number; roomUnits: number; sellableUnits: number } | null>(null);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [importing, setImporting] = useState(false);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [unitFormType, setUnitFormType] = useState<RoomType | null>(null);
  const [editUnit, setEditUnit] = useState<RoomUnit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currencyChoice, setCurrencyChoice] = useState("TZS");
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [view, setView] = useState<"cards" | "list">("cards");
  const needsCurrency = !!notice && /property currency/i.test(notice);

  useEffect(() => {
    try { setView(window.localStorage.getItem("nrms.rooms.view") === "list" ? "list" : "cards"); } catch {}
  }, []);

  const changeView = (next: "cards" | "list") => {
    setView(next);
    try { window.localStorage.setItem("nrms.rooms.view", next); } catch {}
  };

  const setPropertyCurrency = async () => {
    if (!selectedPropertyId) return;
    setSavingCurrency(true);
    try {
      await apiClient.patch(`/api/owner/properties/${selectedPropertyId}/currency`, { currency: currencyChoice });
      await refresh();
      setNotice(`Currency set to ${currencyChoice}. You can import or add room types now.`);
    } catch (e: any) {
      setNotice(e?.response?.data?.error || "Failed to set currency");
    } finally {
      setSavingCurrency(false);
    }
  };

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const [roomsRes, reconRes] = await Promise.all([
        apiClient.get<any>(`/api/owner/nrms/rooms/${selectedPropertyId}`),
        apiClient.get<any>(`/api/owner/nrms/rooms/${selectedPropertyId}/reconciliation`),
      ]);
      setRoomTypes(roomsRes.data?.roomTypes ?? []);
      setTotals(roomsRes.data?.totals ?? null);
      setRecon(reconRes.data ?? null);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load rooms");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onImport = async () => {
    if (!selectedPropertyId) return;
    setImporting(true);
    setNotice(null);
    try {
      const r = await apiClient.post<any>(`/api/owner/nrms/rooms/${selectedPropertyId}/import`, {});
      setNotice(`Imported ${r.data?.createdTypes ?? 0} room types and ${r.data?.createdUnits ?? 0} rooms from your property setup.`);
      await load();
    } catch (e: any) {
      setNotice(e?.response?.data?.error || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const mismatch = recon && !recon.reconciled && recon.spec.length > 0;
  const units = useMemo(() => roomTypes.flatMap((roomType) => roomType.units.map((unit) => ({ ...unit, roomType }))), [roomTypes]);
  const statusCounts = useMemo(() => Object.fromEntries(UNIT_STATUSES.map((status) => [status, units.filter((unit) => unit.status === status).length])), [units]);
  const visibleUnits = useMemo(() => {
    const term = query.trim().toLowerCase();
    return units.filter((unit) => (!statusFilter || unit.status === statusFilter) && (!term || unit.code.toLowerCase().includes(term) || unit.roomType.name.toLowerCase().includes(term) || String(unit.floor ?? "").includes(term)));
  }, [query, statusFilter, units]);
  const visibleTypes = useMemo(() => roomTypes.map((roomType) => ({ ...roomType, units: visibleUnits.filter((unit) => unit.roomTypeId === roomType.id) })).filter((roomType) => roomType.units.length > 0), [roomTypes, visibleUnits]);
  const roomStages = [
    { key: "ACTIVE", label: "Ready", hint: "Available for room inventory", count: statusCounts.ACTIVE ?? 0, icon: BadgeCheck, text: "text-emerald-700", bar: "bg-emerald-500", soft: "bg-emerald-50" },
    { key: "MAINTENANCE", label: "Maintenance", hint: "Repair or service in progress", count: statusCounts.MAINTENANCE ?? 0, icon: Wrench, text: "text-amber-700", bar: "bg-amber-400", soft: "bg-amber-50" },
    { key: "OUT_OF_SERVICE", label: "Out of service", hint: "Removed from room inventory", count: statusCounts.OUT_OF_SERVICE ?? 0, icon: XCircle, text: "text-rose-600", bar: "bg-rose-400", soft: "bg-rose-50" },
    { key: "INACTIVE", label: "Inactive", hint: "Configured but not in use", count: statusCounts.INACTIVE ?? 0, icon: PauseCircle, text: "text-neutral-600", bar: "bg-neutral-400", soft: "bg-neutral-100" },
  ];

  if (!selectedPropertyId) {
    return <p className="text-sm text-neutral-500 py-10 text-center">Add a property first to manage rooms.</p>;
  }

  return (
    <div className="pb-10">
      {selectedProperty && !selectedProperty.nrmsActivatedAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 mb-4 text-sm text-emerald-800">
          <span>Confirm your rooms below, then activate this property to start using NRMS operations.</span>
          <button
            type="button"
            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5"
            onClick={async () => {
              const r = await activateProperty(selectedPropertyId);
              if (!r.ok) setNotice(r.message || "Activation failed");
            }}
          >
            Activate property
          </button>
        </div>
      )}

      {mismatch && (
        <div className="flex gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 mb-4 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            Your property setup lists {recon!.specTotalUnits} rooms but {recon!.configuredTotalUnits} rooms are configured here.
            Import the missing rooms or add them manually so availability stays accurate.
          </div>
        </div>
      )}

      {notice && needsCurrency && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 mb-4 text-sm text-amber-900">
          <div className="flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
              <X className="w-4 h-4 text-amber-400" />
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <select
              value={currencyChoice}
              onChange={(e) => setCurrencyChoice(e.target.value)}
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900"
              aria-label="Property currency"
            >
              {PROPERTY_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code} disabled={!c.enabled}>
                  {c.code}{c.enabled ? "" : " (coming soon)"}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={setPropertyCurrency}
              disabled={savingCurrency}
              className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-60"
            >
              {savingCurrency ? "Saving..." : "Set currency"}
            </button>
          </div>
        </div>
      )}

      {notice && !needsCurrency && (
        <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-2.5 mb-4 text-sm text-neutral-700 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X className="w-4 h-4 text-neutral-400" />
          </button>
        </div>
      )}

      <div className="space-y-5">
        <NrmsLifecycleRail stages={roomStages} selected={statusFilter} onSelect={setStatusFilter} />
        <NrmsDirectoryShell
          title={statusFilter ? `${UNIT_STATUS_META[statusFilter]?.label ?? statusFilter} rooms` : "All rooms"}
          count={visibleUnits.length}
          loading={loading}
          query={query}
          onQueryChange={setQuery}
          placeholder="Search room, category or floor"
          view={view}
          onViewChange={changeView}
          filter={statusFilter}
          onClearFilter={() => setStatusFilter("")}
          toolbar={<div className="flex gap-2">
          <button
            type="button"
            onClick={onImport}
            disabled={importing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-sm px-3 py-2 disabled:opacity-60"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
            Import from property setup
          </button>
          <button
            type="button"
            onClick={() => setShowTypeForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-3 py-2"
          >
            <Plus className="w-4 h-4" /> Add room type
          </button>
        </div>}
        >

      {loading ? (
        <div className="flex justify-center py-16 text-neutral-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      ) : roomTypes.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-neutral-300 rounded-2xl">
          <BedDouble className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
          <p className="text-sm text-neutral-500 mb-3">No rooms configured yet.</p>
          <p className="text-xs text-neutral-400">Import from your property setup or add a room type manually.</p>
        </div>
      ) : visibleUnits.length === 0 ? (
        <div className="border-t border-neutral-100 px-6 py-14 text-center text-sm text-neutral-500">No rooms match this search or status.</div>
      ) : view === "cards" ? (
        <div className="space-y-4 border-t border-neutral-100 p-3 sm:p-4">
          {visibleTypes.map((type) => (
            <div key={type.id} className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-neutral-900">{type.name}</h2>
                    {type.status !== "ACTIVE" && (
                      <span className="text-xs bg-neutral-100 text-neutral-500 rounded-full px-2 py-0.5">Inactive</span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Sleeps {type.capacityAdults + type.capacityChildren}
                    {type.bedSetup ? ` · ${type.bedSetup}` : ""} · {type.units.length} room{type.units.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-neutral-900">
                    {type.baseRate != null ? `${type.currency} ${type.baseRate.toLocaleString()}` : "No rate set"}
                  </div>
                  <div className="text-[11px] text-neutral-400">base rate per night</div>
                  <StaffRateFloorControl roomType={type} onSaved={load} />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {type.units.map((unit) => {
                  const meta = UNIT_STATUS_META[unit.status] ?? UNIT_STATUS_META.ACTIVE;
                  return (
                    <button
                      type="button"
                      key={unit.id}
                      onClick={() => setEditUnit(unit)}
                      className="rounded-xl border border-neutral-200 hover:border-neutral-300 bg-white px-2 py-2.5 text-center"
                    >
                      <div className="text-sm font-semibold text-neutral-900">{unit.code}</div>
                      <div className={`inline-block text-[11px] rounded-full px-2 py-0.5 mt-1 ${meta.cls}`}>{meta.label}</div>
                      {unit.floor != null && <div className="text-[10px] text-neutral-400 mt-0.5">Floor {unit.floor}</div>}
                      <div className="text-[10px] text-neutral-400 mt-0.5">{unit.bedCount} bed{unit.bedCount === 1 ? "" : "s"}</div>
                    </button>
                  );
                })}
                {!query && !statusFilter && <button
                  type="button"
                  onClick={() => setUnitFormType(type)}
                  className="rounded-xl border border-dashed border-neutral-300 hover:border-neutral-400 text-neutral-400 hover:text-neutral-600 px-2 py-2.5 text-center text-sm"
                >
                  <Plus className="w-4 h-4 mx-auto" />
                  <span className="text-[11px]">Add room</span>
                </button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto border-t border-neutral-100">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead><tr className="bg-neutral-50/70 text-[11px] font-semibold text-neutral-400"><th className="px-5 py-2.5">Room</th><th className="px-4 py-2.5">Category</th><th className="px-4 py-2.5">Floor</th><th className="px-4 py-2.5">Beds</th><th className="px-4 py-2.5">Status</th><th className="px-5 py-2.5 text-right">Action</th></tr></thead>
            <tbody>{visibleUnits.map((unit) => { const meta = UNIT_STATUS_META[unit.status] ?? UNIT_STATUS_META.ACTIVE; return <tr key={unit.id} className="border-t border-neutral-100 hover:bg-neutral-50/70"><td className="px-5 py-3 font-bold text-neutral-900">{unit.code}</td><td className="px-4 py-3 text-neutral-700">{unit.roomType.name}</td><td className="px-4 py-3 text-neutral-500">{unit.floor == null ? "Not set" : `Floor ${unit.floor}`}</td><td className="px-4 py-3 text-neutral-500">{unit.bedCount}</td><td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span></td><td className="px-5 py-3 text-right"><button type="button" onClick={() => setEditUnit(unit)} className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-bold text-neutral-700 hover:border-emerald-200 hover:bg-emerald-50">Edit</button></td></tr>; })}</tbody>
          </table>
        </div>
      )}
        </NrmsDirectoryShell>
      </div>

      {showTypeForm && selectedPropertyId && (
        <TypeFormModal
          propertyId={selectedPropertyId}
          currency={selectedProperty?.currency ?? null}
          onClose={() => setShowTypeForm(false)}
          onSaved={async () => {
            setShowTypeForm(false);
            await load();
          }}
        />
      )}
      {unitFormType && selectedPropertyId && (
        <UnitFormModal
          propertyId={selectedPropertyId}
          roomType={unitFormType}
          onClose={() => setUnitFormType(null)}
          onSaved={async () => {
            setUnitFormType(null);
            await load();
          }}
        />
      )}
      {editUnit && (
        <UnitEditModal
          unit={editUnit}
          onClose={() => setEditUnit(null)}
          onSaved={async () => {
            setEditUnit(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white border border-neutral-200 px-3 py-2">
      <div className="text-[11px] text-neutral-400">{label}</div>
      <div className="text-base font-bold text-neutral-900">{value}</div>
    </div>
  );
}

function ModalFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-6">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative my-auto box-border max-h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:max-h-[calc(100dvh-3rem)] sm:p-6">
        <div className="mb-5 flex min-w-0 items-center justify-between gap-4">
          <h3 className="font-semibold text-neutral-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900">
            <X className="w-4 h-4 text-neutral-400" />
          </button>
        </div>
        <div className="min-w-0 max-w-full">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "block box-border w-full min-w-0 max-w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";

/**
 * The lowest rate a staff member may agree for this room type on a group block.
 *
 * A block's nightly rate becomes the guest's rate once the block is picked up,
 * so whoever agrees the block is exercising discount authority. Only the owner
 * sees or sets this, and the owner is never bound by it.
 *
 * Unset means the base rate above is the limit: discounting is granted, not
 * assumed. Clearing the field returns to that. Zero removes the limit.
 */
function StaffRateFloorControl({ roomType, onSaved }: { roomType: RoomType; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(roomType.staffRateFloor == null ? "" : String(roomType.staffRateFloor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = value.trim();
      await apiClient.patch(`/api/owner/nrms/rooms/types/${roomType.id}`, {
        staffRateFloor: trimmed === "" ? null : Number(trimmed),
      });
      setEditing(false);
      await onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not save the limit");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    const label = roomType.staffRateFloor == null
      ? (roomType.baseRate == null ? "No limit, this type has no rate" : "Staff limit: base rate")
      : roomType.staffRateFloor === 0
        ? "Staff limit: none"
        : `Staff limit: ${roomType.currency} ${roomType.staffRateFloor.toLocaleString()}`;
    return (
      <button
        type="button"
        onClick={() => { setValue(roomType.staffRateFloor == null ? "" : String(roomType.staffRateFloor)); setEditing(true); }}
        className="mt-1 cursor-pointer appearance-none border-0 bg-transparent p-0 text-[11px] font-semibold text-emerald-700 underline decoration-emerald-200 underline-offset-4 hover:text-emerald-900"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="mt-1.5 w-52 rounded-lg bg-neutral-50 p-2 text-left ring-1 ring-neutral-200">
      <p className="m-0 text-[11px] font-bold text-neutral-800">Lowest rate staff may agree</p>
      <p className="m-0 mt-0.5 text-[10px] leading-4 text-neutral-500">
        Leave empty to hold them at the base rate. Enter 0 to let them agree any rate. You are never limited.
      </p>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={roomType.baseRate != null ? String(roomType.baseRate) : "0"}
        className="mt-1.5 box-border w-full rounded-lg border border-solid border-neutral-300 px-2 py-1.5 text-xs"
      />
      {error && <p className="m-0 mt-1 text-[10px] font-semibold text-red-600">{error}</p>}
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="flex-1 cursor-pointer appearance-none rounded-lg border-0 bg-emerald-700 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null); }}
          className="cursor-pointer appearance-none rounded-lg border-0 bg-white px-2 py-1.5 text-[11px] font-bold text-neutral-600 ring-1 ring-neutral-300 hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function TypeFormModal({ propertyId, currency, onClose, onSaved }: { propertyId: number; currency: string | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [bedSetup, setBedSetup] = useState("");
  const [capacityAdults, setCapacityAdults] = useState(2);
  const [baseRate, setBaseRate] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/rooms/${propertyId}/types`, {
        name,
        bedSetup: bedSetup || null,
        capacityAdults,
        baseRate: baseRate ? Number(baseRate) : null,
      });
      await onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to create room type");
      setBusy(false);
    }
  };

  return (
    <ModalFrame title="Add room type" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-neutral-600">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard room" />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-600">Bed setup</span>
          <input className={inputCls} value={bedSetup} onChange={(e) => setBedSetup(e.target.value)} placeholder="1 double bed" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-neutral-600">Sleeps (adults)</span>
            <input
              type="number"
              min={1}
              className={inputCls}
              value={capacityAdults}
              onChange={(e) => setCapacityAdults(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="block text-sm">
            <span className="text-neutral-600">Rate per night{currency ? ` (${currency})` : ""}</span>
            <input type="number" min={0} className={inputCls} value={baseRate} onChange={(e) => setBaseRate(e.target.value)} placeholder="45000" />
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Create room type"}
        </button>
      </div>
    </ModalFrame>
  );
}

function UnitFormModal({
  propertyId,
  roomType,
  onClose,
  onSaved,
}: {
  propertyId: number;
  roomType: RoomType;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [floor, setFloor] = useState<string>("");
  const [bedCount, setBedCount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/rooms/${propertyId}/units`, {
        roomTypeId: roomType.id,
        code,
        floor: floor === "" ? null : Number(floor),
        bedCount: Number(bedCount),
      });
      await onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to create room");
      setBusy(false);
    }
  };

  return (
    <ModalFrame title={`Add room to ${roomType.name}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-neutral-600">Room number or code</span>
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="R101" />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-600">Floor (optional)</span>
          <input type="number" className={inputCls} value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="1" />
        </label>
        <label className="block text-sm"><span className="text-neutral-600">Physical beds <small className="text-neutral-400">(for NBS statistics)</small></span><input type="number" min={1} max={20} className={inputCls} value={bedCount} onChange={(e) => setBedCount(e.target.value)} /></label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !code.trim()}
          className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Add room"}
        </button>
      </div>
    </ModalFrame>
  );
}

function UnitEditModal({ unit, onClose, onSaved }: { unit: RoomUnit; onClose: () => void; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState(unit.status);
  const [reason, setReason] = useState("");
  const [bedCount, setBedCount] = useState(String(unit.bedCount || 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/api/owner/nrms/rooms/units/${unit.id}`, {
        status,
        bedCount: Number(bedCount),
        ...(reason ? { statusReason: reason } : {}),
      });
      await onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to update room");
      setBusy(false);
    }
  };

  return (
    <ModalFrame title={`Room ${unit.code}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-neutral-600 flex items-center gap-1"><Wrench className="w-3.5 h-3.5" /> Status</span>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {UNIT_STATUS_META[s]?.label ?? s}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm"><span className="text-neutral-600">Physical beds <small className="text-neutral-400">(NBS capacity)</small></span><input type="number" min={1} max={20} className={inputCls} value={bedCount} onChange={(e) => setBedCount(e.target.value)} /></label>
        {status !== unit.status && (
          <label className="block text-sm">
            <span className="text-neutral-600">Reason (kept in the room history)</span>
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Plumbing repair" />
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={busy || (status === unit.status && Number(bedCount) === unit.bedCount)}
          className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save changes"}
        </button>
      </div>
    </ModalFrame>
  );
}
