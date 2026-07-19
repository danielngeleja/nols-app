"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  AlertTriangle,
  BedDouble,
  Building2,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UtensilsCrossed,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type RoomUnit = { id: number; code: string; floor: number | null; status: string };
type PayInstruction = { label: string; value: string; name: string | null };
type FloorFilter = "ALL" | "UNASSIGNED" | "TABLES" | number;
type OrderPoint = {
  id: number;
  propertyId: number;
  type: "ROOM" | "TABLE";
  label: string;
  roomUnitId: number | null;
  token: string;
  active: boolean;
  menuUrl: string | null;
  roomUnit: RoomUnit | null;
  createdAt: string;
};

export default function QrCodesPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const accessRole = selectedProperty?.nrmsAccessRole ?? "OWNER";
  const canManage = accessRole === "OWNER" || accessRole === "MANAGER";
  const [points, setPoints] = useState<OrderPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAddTable, setShowAddTable] = useState(false);
  const [tableLabel, setTableLabel] = useState("");

  const [payRows, setPayRows] = useState<PayInstruction[]>([]);
  const [payDirty, setPayDirty] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [floorFilter, setFloorFilter] = useState<FloorFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    id: number;
    action: "rotate" | "deactivate" | "delete";
    label: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/order-points`);
      setPoints(res.data?.orderPoints ?? []);
      setPayRows(Array.isArray(res.data?.guestPayInstructions) ? res.data.guestPayInstructions : []);
      setPayDirty(false);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load order points");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const generateRooms = async () => {
    if (!selectedPropertyId || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/order-points/generate-rooms`);
      const created = res.data?.created ?? 0;
      setNotice(created > 0 ? `Generated QR codes for ${created} room${created > 1 ? "s" : ""}` : res.data?.message || "All rooms already have QR codes");
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to generate room QR codes");
    } finally {
      setBusy(false);
    }
  };

  const addTable = async () => {
    if (!selectedPropertyId || busy || !tableLabel.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/order-points`, {
        type: "TABLE",
        label: tableLabel.trim(),
      });
      setTableLabel("");
      setShowAddTable(false);
      setNotice(`Table "${tableLabel.trim()}" added`);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to add table");
    } finally {
      setBusy(false);
    }
  };

  const updatePayRow = (index: number, patch: Partial<PayInstruction>) => {
    setPayRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setPayDirty(true);
  };

  const savePayInstructions = async () => {
    if (!selectedPropertyId || savingPay) return;
    const cleaned = payRows
      .map((row) => ({ label: row.label.trim(), value: row.value.trim(), name: row.name?.trim() || null }))
      .filter((row) => row.label && row.value);
    setSavingPay(true);
    setError(null);
    try {
      await apiClient.patch(`/api/nrms/operations/property/${selectedPropertyId}/guest-pay-instructions`, { instructions: cleaned });
      setPayRows(cleaned);
      setPayDirty(false);
      setNotice("Guest payment details saved");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to save payment details");
    } finally {
      setSavingPay(false);
    }
  };

  const executeAction = async () => {
    if (!confirmAction || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (confirmAction.action === "rotate") {
        await apiClient.post(`/api/nrms/operations/order-points/${confirmAction.id}/rotate`);
        setNotice(`Token rotated for "${confirmAction.label}". Old QR code is now invalid.`);
      } else if (confirmAction.action === "deactivate") {
        await apiClient.post(`/api/nrms/operations/order-points/${confirmAction.id}/deactivate`);
        setNotice(`"${confirmAction.label}" deactivated`);
      } else {
        await apiClient.delete(`/api/nrms/operations/order-points/${confirmAction.id}`);
        setNotice(`"${confirmAction.label}" deleted`);
      }
      setConfirmAction(null);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadQr = async (point: OrderPoint) => {
    try {
      const res = await apiClient.get(`/api/nrms/operations/order-points/${point.id}/qr.png`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `QR_${point.type}_${point.label.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to download QR code");
    }
  };

  const downloadSheet = async (typeFilter?: string) => {
    if (!selectedPropertyId) return;
    setBusy(true);
    try {
      const query = typeFilter ? `?type=${typeFilter}` : "";
      const res = await apiClient.get(
        `/api/nrms/operations/property/${selectedPropertyId}/order-points/qr-sheet.pdf${query}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "QR_Sheet.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to download QR sheet");
    } finally {
      setBusy(false);
    }
  };

  const rooms = points.filter((p) => p.type === "ROOM");
  const tables = points.filter((p) => p.type === "TABLE");
  const activeCount = points.filter((p) => p.active).length;
  const floors = [...new Set(rooms.map((point) => point.roomUnit?.floor).filter((floor): floor is number => floor != null))].sort((a, b) => a - b);
  const unassignedRooms = rooms.filter((point) => point.roomUnit?.floor == null).length;
  const visiblePoints = useMemo(
    () => points.filter((point) => {
      const matchesStatus = statusFilter === "ALL" || (statusFilter === "ACTIVE" ? point.active : !point.active);
      const matchesFloor = floorFilter === "ALL"
        || (floorFilter === "TABLES" && point.type === "TABLE")
        || (floorFilter === "UNASSIGNED" && point.type === "ROOM" && point.roomUnit?.floor == null)
        || (typeof floorFilter === "number" && point.type === "ROOM" && point.roomUnit?.floor === floorFilter);
      return matchesStatus && matchesFloor;
    }),
    [points, floorFilter, statusFilter],
  );
  const visibleRooms = visiblePoints.filter((point) => point.type === "ROOM");
  const visibleTables = visiblePoints.filter((point) => point.type === "TABLE");
  const floorGroups = useMemo(() => {
    const groups = new Map<string, { label: string; order: number; points: OrderPoint[] }>();
    for (const point of visibleRooms) {
      const floor = point.roomUnit?.floor ?? null;
      const key = floor == null ? "unassigned" : String(floor);
      if (!groups.has(key)) groups.set(key, { label: floor == null ? "Floor not assigned" : `Floor ${floor}`, order: floor ?? Number.MAX_SAFE_INTEGER, points: [] });
      groups.get(key)!.points.push(point);
    }
    for (const group of groups.values()) group.points.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return [...groups.values()].sort((a, b) => a.order - b.order);
  }, [visibleRooms]);

  const copyMenuUrl = async (point: OrderPoint) => {
    if (!point.menuUrl) return;
    try {
      await navigator.clipboard.writeText(point.menuUrl);
      setCopiedId(point.id);
      window.setTimeout(() => setCopiedId((current) => current === point.id ? null : current), 1800);
    } catch {
      setError("Could not copy the guest menu link");
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-5 pb-8">
        <div className="h-64 animate-pulse rounded-[28px] bg-emerald-950/90" />
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-48 animate-pulse rounded-3xl border border-neutral-200 bg-white" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      {selectedProperty?.nrmsQrOrderingFrozenAt && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="m-0 text-sm font-bold">Guest QR ordering is temporarily paused</p>
              <p className="mb-0 mt-1 text-xs leading-5">Staff operations remain available. Contact partnerships and quote the reference below for review.</p>
              {selectedProperty.qrRestriction?.referenceCode && (
                <a
                  href={`mailto:partners@nolsaf.com?subject=${encodeURIComponent(`QR ordering appeal ${selectedProperty.qrRestriction.referenceCode}`)}`}
                  className="mt-2 inline-flex break-all font-mono text-xs font-bold text-[#02665e] underline underline-offset-2"
                >
                  {selectedProperty.qrRestriction.referenceCode}
                </a>
              )}
            </div>
          </div>
        </section>
      )}
      {/* Premium command header */}
      <section className="relative overflow-hidden rounded-[28px] bg-[#0b302a] text-white shadow-[0_24px_55px_-34px_rgba(6,78,59,0.8)]">
        <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-teal-300/10 blur-3xl" />
        <div className="relative p-5 sm:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-emerald-200 shadow-inner">
                  <QrCode className="h-6 w-6" />
                </span>
                <div>
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200/70">Guest self-service</p>
                  <h1 className="mb-0 mt-1 text-2xl font-bold tracking-tight sm:text-3xl">QR order points</h1>
                </div>
              </div>
              <p className="mb-0 mt-4 max-w-xl text-sm leading-6 text-emerald-50/65">
                Give every room and table a secure guest menu. Create, print and control every QR experience for {selectedProperty?.title ?? "your property"} from one place.
              </p>
            </div>

            {canManage && (
              <div className="grid gap-2.5 sm:grid-cols-3 xl:min-w-[34rem]">
                <button type="button" onClick={generateRooms} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white bg-white px-4 text-xs font-bold text-emerald-950 shadow-sm transition hover:bg-emerald-50 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} Generate rooms
                </button>
                <button type="button" onClick={() => setShowAddTable((open) => !open)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 text-xs font-bold text-white transition hover:bg-white/[0.13]">
                  <Plus className="h-4 w-4" /> Add table
                </button>
                <button type="button" onClick={() => downloadSheet()} disabled={busy || activeCount === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 text-xs font-bold text-white transition hover:bg-white/[0.13] disabled:opacity-40">
                  <FileDown className="h-4 w-4" /> PDF sheet
                </button>
              </div>
            )}
          </div>

          <div className="mt-7 grid gap-2.5 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3.5 backdrop-blur-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-200"><CheckCircle2 className="h-4 w-4" /></span>
              <div><p className="m-0 text-xl font-bold">{activeCount}</p><p className="mb-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100/50">Active points</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3.5 backdrop-blur-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-200"><BedDouble className="h-4 w-4" /></span>
              <div><p className="m-0 text-xl font-bold">{rooms.length}</p><p className="mb-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100/50">Guest rooms</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3.5 backdrop-blur-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-200"><UtensilsCrossed className="h-4 w-4" /></span>
              <div><p className="m-0 text-xl font-bold">{tables.length}</p><p className="mb-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100/50">Dining tables</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* Notices */}
      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-700 shadow-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm font-medium text-emerald-800 shadow-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message" className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg border-0 bg-transparent text-emerald-600 hover:bg-emerald-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Add table inline form */}
      {showAddTable && canManage && (
        <section className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-white p-3.5 shadow-sm lg:flex-row lg:items-end sm:p-4">
          <div className="flex min-w-0 items-center gap-3 lg:w-72 lg:shrink-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><UtensilsCrossed className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0 flex-1"><h2 className="m-0 text-sm font-bold text-neutral-950">Create a table order point</h2><p className="mb-0 mt-1 text-xs text-neutral-500">Use a name guests and staff can identify immediately.</p></div>
          </div>
          <label className="min-w-0 flex-1"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-500">Table label</span><input autoFocus type="text" value={tableLabel} onChange={(event) => setTableLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addTable(); }} placeholder="e.g. Table 1, Poolside A" maxLength={60} className="box-border h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" /></label>
          <button type="button" onClick={addTable} disabled={busy || !tableLabel.trim()} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create table
          </button>
          <button type="button" onClick={() => { setShowAddTable(false); setTableLabel(""); }} aria-label="Close add table form" className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"><X className="h-4 w-4" /></button>
        </section>
      )}

      {/* Guest payment details: the property's own receiving channels */}
      {canManage && (
        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-neutral-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><WalletCards className="h-5 w-5" /></span>
              <div>
                <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-base font-bold tracking-tight text-neutral-950">Guest payment channels</h2><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-700">Direct to property</span></div>
                <p className="mb-0 mt-1.5 max-w-2xl text-xs leading-5 text-neutral-500">These details appear after a guest places a QR order. Funds go directly to your own Lipa Namba, bank account, card terminal or cashier.</p>
              </div>
            </div>
            <button type="button" onClick={savePayInstructions} disabled={savingPay || !payDirty} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none">
              {savingPay ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {savingPay ? "Saving…" : payDirty ? "Save changes" : "Saved"}
            </button>
          </div>

          <div className="space-y-2.5 p-4 sm:p-5">
            {payRows.map((row, index) => (
              <div key={index} className="grid min-w-0 gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50/70 p-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                <label className="min-w-0"><span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-neutral-500">Channel</span><input type="text" value={row.label} onChange={(event) => updatePayRow(index, { label: event.target.value.slice(0, 40) })} placeholder="M-Pesa Lipa Namba" className="box-border h-9 w-full min-w-0 max-w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" /></label>
                <label className="min-w-0"><span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-neutral-500">Number or account</span><input type="text" value={row.value} onChange={(event) => updatePayRow(index, { value: event.target.value.slice(0, 80) })} placeholder="512345" className="box-border h-9 w-full min-w-0 max-w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" /></label>
                <label className="min-w-0"><span className="mb-1 block truncate text-[9px] font-bold uppercase tracking-wide text-neutral-500">Account name <span className="font-medium normal-case text-neutral-400">(optional)</span></span><input type="text" value={row.name ?? ""} onChange={(event) => updatePayRow(index, { name: event.target.value.slice(0, 60) })} placeholder="Property or business name" className="box-border h-9 w-full min-w-0 max-w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" /></label>
                <button type="button" onClick={() => { setPayRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index)); setPayDirty(true); }} aria-label={`Remove payment channel ${index + 1}`} title={`Remove payment channel ${index + 1}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center justify-self-end rounded-lg border border-red-100 bg-white text-red-500 transition hover:border-red-200 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {payRows.length === 0 && (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-5 py-8 text-center"><WalletCards className="mx-auto h-7 w-7 text-neutral-300" /><p className="mb-0 mt-3 text-sm font-bold text-neutral-700">No payment channels yet</p><p className="mb-0 mt-1 text-xs text-neutral-400">Add your Lipa Namba or bank details so guests know exactly where to pay.</p></div>
            )}
            {payRows.length < 6 && <button type="button" onClick={() => { setPayRows((rows) => [...rows, { label: "", value: "", name: null }]); setPayDirty(true); }} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white px-3.5 text-xs font-bold text-neutral-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 sm:w-auto"><Plus className="h-3.5 w-3.5" /> Add payment channel</button>}
          </div>
          <div className="flex items-start gap-2 border-t border-neutral-100 bg-emerald-50/50 px-5 py-3.5 text-[11px] leading-5 text-emerald-900/70 sm:px-6"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" /><span>NoLSAF displays these instructions but does not collect or hold the guest&apos;s outlet payment.</span></div>
        </section>
      )}

      {/* Order-point library controls */}
      {points.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Building2 className="h-4 w-4" /></span>
              <div className="min-w-0"><h2 className="m-0 text-sm font-bold tracking-tight text-neutral-950">Order-point library</h2><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{visiblePoints.length} of {points.length} points shown</p></div>
            </div>
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | "ACTIVE" | "INACTIVE")} className="h-8 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-[11px] font-bold normal-case tracking-normal text-neutral-700 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"><option value="ALL">All statuses</option><option value="ACTIVE">Active only</option><option value="INACTIVE">Paused only</option></select></label>
          </header>
          <div className="flex gap-1.5 overflow-x-auto border-t border-neutral-100 bg-neutral-50/70 px-3 py-2" aria-label="Filter order points by floor">
            <FloorFilterButton active={floorFilter === "ALL"} onClick={() => setFloorFilter("ALL")} label="All floors" count={rooms.length} />
            {floors.map((floor) => <FloorFilterButton key={floor} active={floorFilter === floor} onClick={() => setFloorFilter(floor)} label={`Floor ${floor}`} count={rooms.filter((point) => point.roomUnit?.floor === floor).length} />)}
            {unassignedRooms > 0 && <FloorFilterButton active={floorFilter === "UNASSIGNED"} onClick={() => setFloorFilter("UNASSIGNED")} label="No floor" count={unassignedRooms} />}
            {tables.length > 0 && <FloorFilterButton active={floorFilter === "TABLES"} onClick={() => setFloorFilter("TABLES")} label="Tables" count={tables.length} />}
          </div>
        </section>
      )}

      {/* Rooms section */}
      {rooms.length > 0 && visibleRooms.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div><h2 className="m-0 text-sm font-bold text-neutral-900">Guest rooms</h2><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Organized by floor</p></div>
            {canManage && rooms.some((point) => point.active) && <button type="button" onClick={() => downloadSheet("room")} disabled={busy} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-[10px] font-bold text-emerald-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 disabled:opacity-50"><FileDown className="h-3.5 w-3.5" /> Rooms PDF</button>}
          </div>
          {floorGroups.map((group) => {
            const activeCount = group.points.filter((point) => point.active).length;
            const pausedCount = group.points.length - activeCount;
            return (
              <div key={group.label} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
                <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 bg-gradient-to-r from-white via-white to-emerald-50/50 px-4 py-3">
                  <span className="absolute inset-y-0 left-0 w-1 bg-emerald-500" />
                  <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Building2 className="h-4 w-4" /></span><div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-700">Floor zone</p><h3 className="m-0 truncate text-sm font-bold text-neutral-900">{group.label}</h3></div></div>
                  <div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full bg-neutral-100 px-2 py-1 text-[9px] font-bold text-neutral-600">{group.points.length} {group.points.length === 1 ? "room" : "rooms"}</span>{activeCount > 0 && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700">{activeCount} live</span>}{pausedCount > 0 && <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700">{pausedCount} paused</span>}</div>
                </header>
                <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {group.points.map((point) => <PointCard key={point.id} point={point} canManage={canManage} copied={copiedId === point.id} onCopy={copyMenuUrl} onDownload={downloadQr} onAction={setConfirmAction} />)}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Tables section */}
      {tables.length > 0 && visibleTables.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 bg-gradient-to-r from-white via-white to-emerald-50/50 px-4 py-3">
            <span className="absolute inset-y-0 left-0 w-1 bg-emerald-500" />
            <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><UtensilsCrossed className="h-4 w-4" /></span><div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-700">Service zone</p><h2 className="m-0 text-sm font-bold text-neutral-900">Dining tables</h2></div></div>
            <div className="flex items-center gap-2"><span className="rounded-full bg-neutral-100 px-2 py-1 text-[9px] font-bold text-neutral-600">{visibleTables.length} {visibleTables.length === 1 ? "table" : "tables"}</span>{canManage && tables.some((point) => point.active) && <button type="button" onClick={() => downloadSheet("table")} disabled={busy} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-[10px] font-bold text-emerald-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 disabled:opacity-50"><FileDown className="h-3.5 w-3.5" /> Tables PDF</button>}</div>
          </header>
          <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visibleTables.map((point) => <PointCard key={point.id} point={point} canManage={canManage} copied={copiedId === point.id} onCopy={copyMenuUrl} onDownload={downloadQr} onAction={setConfirmAction} />)}
          </div>
        </section>
      )}

      {points.length > 0 && visiblePoints.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-12 text-center"><Building2 className="mx-auto h-8 w-8 text-neutral-300" /><p className="mb-0 mt-3 text-sm font-bold text-neutral-700">No order points in this view</p><p className="mb-0 mt-1 text-xs text-neutral-400">This floor and status combination has no matching rooms or tables.</p><button type="button" onClick={() => { setFloorFilter("ALL"); setStatusFilter("ALL"); }} className="mt-4 inline-flex min-h-9 items-center rounded-lg border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-600 hover:bg-neutral-50">Show all points</button></div>
      )}

      {/* Empty state */}
      {points.length === 0 && (
        <div className="rounded-[26px] border border-dashed border-neutral-300 bg-white px-6 py-16 text-center shadow-sm"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><QrCode className="h-7 w-7" /></span><p className="mb-0 mt-4 text-base font-bold text-neutral-900">Create your first QR order point</p><p className="mx-auto mb-0 mt-1.5 max-w-md text-xs leading-5 text-neutral-500">Generate secure QR codes for every room, then print and place them where guests can scan to browse the live menu.</p>{canManage && <button type="button" onClick={generateRooms} disabled={busy} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-0 bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"><QrCode className="h-4 w-4" /> Generate room QR codes</button>}</div>
      )}

      {/* Confirmation dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close confirmation"
            className="absolute inset-0 border-0 bg-neutral-950/50 backdrop-blur-[3px]"
            onClick={() => !busy && setConfirmAction(null)}
          />
          <div role="dialog" aria-modal="true" aria-labelledby="qr-confirm-title" className="relative w-full max-w-md overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
            <div className="px-5 py-5">
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm ${
                  confirmAction.action === "delete"
                    ? "border-red-100 bg-red-50 text-red-600"
                    : "border-amber-100 bg-amber-50 text-amber-600"
                }`}>
                  {confirmAction.action === "rotate" ? <RefreshCw className="h-5 w-5" /> : confirmAction.action === "deactivate" ? <XCircle className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <h3 id="qr-confirm-title" className="m-0 text-base font-bold tracking-tight text-neutral-950">
                    {confirmAction.action === "rotate" ? "Rotate QR token" : confirmAction.action === "deactivate" ? "Deactivate order point" : "Delete order point"}
                  </h3>
                  <p className="mb-0 mt-1.5 text-sm text-neutral-600">
                    {confirmAction.action === "rotate"
                      ? `Rotate token for "${confirmAction.label}"? The current QR code will stop working and a new one will be generated.`
                      : confirmAction.action === "deactivate"
                        ? `Deactivate "${confirmAction.label}"? Guests will no longer be able to scan this QR code.`
                        : `Delete "${confirmAction.label}"? This cannot be undone.`}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  disabled={busy}
                  className="inline-flex min-h-10 items-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeAction}
                  disabled={busy}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-xl border-0 px-5 text-xs font-bold text-white disabled:opacity-50 ${
                    confirmAction.action === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
                  }`}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {confirmAction.action === "rotate" ? "Rotate" : confirmAction.action === "deactivate" ? "Deactivate" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FloorFilterButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-bold transition ${active ? "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm" : "border-transparent bg-transparent text-neutral-500 hover:border-neutral-200 hover:bg-white hover:text-neutral-800"}`}>
      {label}<span className={`rounded-full px-1.5 py-0.5 text-[8px] ${active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200/70 text-neutral-500"}`}>{count}</span>
    </button>
  );
}

function PointCard({
  point,
  canManage,
  copied,
  onCopy,
  onDownload,
  onAction,
}: {
  point: OrderPoint;
  canManage: boolean;
  copied: boolean;
  onCopy: (p: OrderPoint) => void;
  onDownload: (p: OrderPoint) => void;
  onAction: (action: { id: number; action: "rotate" | "deactivate" | "delete"; label: string }) => void;
}) {
  const typeLabel = point.type === "ROOM" ? "Room" : "Table";
  return (
    <article className={`group overflow-hidden rounded-xl border border-l-4 bg-white shadow-sm transition duration-200 hover:shadow-md ${point.active ? "border-neutral-200 border-l-emerald-500" : "border-neutral-200 border-l-neutral-300 bg-neutral-50/70"}`}>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="m-0 truncate text-sm font-bold tracking-tight text-neutral-950">{point.label}</p><p className="mb-0 mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">{typeLabel}{point.roomUnit?.floor != null ? ` · Floor ${point.roomUnit.floor}` : ""}</p></div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-bold ${point.active ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${point.active ? "bg-emerald-500" : "bg-neutral-400"}`} />{point.active ? "Live" : "Paused"}</span>
        </div>

        <div className="mt-3 border-t border-dashed border-neutral-200 pt-2.5">
          {point.active && point.menuUrl ? (
            <div className="flex items-end gap-1.5"><div className="min-w-0 flex-1"><p className="m-0 text-[8px] font-bold uppercase tracking-[0.12em] text-neutral-400">Guest menu</p><p className="mb-0 mt-1 truncate text-[10px] font-medium text-neutral-600" title={point.menuUrl}>{point.menuUrl}</p></div><button type="button" onClick={() => onCopy(point)} title="Copy guest menu link" aria-label={`Copy guest menu link for ${point.label}`} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-white transition ${copied ? "border-emerald-200 text-emerald-700" : "border-neutral-200 text-neutral-500 hover:border-emerald-200 hover:text-emerald-700"}`}>{copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</button><a href={point.menuUrl} target="_blank" rel="noreferrer" title="Preview guest menu" aria-label={`Preview guest menu for ${point.label}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 no-underline transition hover:border-emerald-200 hover:text-emerald-700 hover:no-underline"><ExternalLink className="h-3 w-3" /></a></div>
          ) : (
            <div className="flex items-center gap-2 text-neutral-400"><XCircle className="h-3.5 w-3.5 shrink-0" /><p className="m-0 text-[10px] font-medium">Guest access is paused</p></div>
          )}
        </div>
      </div>

      {canManage && (
        <div className="border-t border-neutral-100 bg-neutral-50/70 px-3.5 py-3">
          {point.active ? <button type="button" onClick={() => onDownload(point)} className="inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-800 transition hover:bg-emerald-100"><Download className="h-3.5 w-3.5" /> Download QR</button> : <button type="button" onClick={() => onAction({ id: point.id, action: "rotate", label: point.label })} className="inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-800 transition hover:bg-emerald-100"><RefreshCw className="h-3.5 w-3.5" /> Reactivate</button>}
          {point.active && <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-dashed border-neutral-200 pt-2.5"><span className="text-[8px] font-bold uppercase tracking-[0.12em] text-neutral-400">Other actions</span><div className="flex items-center gap-1.5"><button type="button" onClick={() => onAction({ id: point.id, action: "rotate", label: point.label })} title="Replace the current QR token" className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[9px] font-bold text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900"><RefreshCw className="h-3 w-3" /> Rotate</button><button type="button" onClick={() => onAction({ id: point.id, action: "deactivate", label: point.label })} className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 text-[9px] font-bold text-amber-700 transition hover:bg-amber-100"><XCircle className="h-3 w-3" /> Pause</button>{point.type === "TABLE" && <button type="button" onClick={() => onAction({ id: point.id, action: "delete", label: point.label })} aria-label={`Delete ${point.label}`} title="Delete table order point" className="flex h-7 w-7 items-center justify-center rounded-md border border-red-100 bg-white text-red-500 transition hover:border-red-200 hover:bg-red-50"><Trash2 className="h-3 w-3" /></button>}</div></div>}
        </div>
      )}
    </article>
  );
}
