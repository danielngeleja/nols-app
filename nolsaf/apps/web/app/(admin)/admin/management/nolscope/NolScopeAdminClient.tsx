"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Edit2,
  Globe,
  Loader2,
  MapPin,
  Mountain,
  Plus,
  RefreshCw,
  Route,
  Save,
  Shield,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
  X,
  Clock,
  History,
  User,
  Trash2,
  TreePine,
} from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

const API = "";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab = "activities" | "park-fees" | "visa-fees" | "transport" | "seasonal" | "destinations" | "tourism-sites";

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: "destinations",  label: "Destinations",    Icon: MapPin      },
  { id: "tourism-sites", label: "Tourism Sites",   Icon: TreePine    },
  { id: "activities",    label: "Activities",      Icon: Activity    },
  { id: "park-fees",     label: "Park Fees",        Icon: Mountain    },
  { id: "visa-fees",     label: "Visa Fees",        Icon: Globe       },
  { id: "transport",     label: "Transport",        Icon: Route       },
  { id: "seasonal",      label: "Seasonal Rules",   Icon: TrendingUp  },
];

// ─── Inline edit field ────────────────────────────────────────────────────────

function EditableField({
  label,
  value,
  type = "text",
  prefix,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string | number | null | undefined;
  type?: "text" | "number";
  prefix?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const safeValue = value ?? (type === "number" ? 0 : "");
  return (
    <div>
      <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">
        {label}
      </label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-xs text-slate-400">{prefix}</span>}
        <input
          type={type}
          value={safeValue}
          onChange={(e) => !disabled && onChange(e.target.value)}
          disabled={disabled}
          className={`w-full text-sm border rounded-lg px-2.5 py-1.5 focus:outline-none border-solid ${
            disabled
              ? "border-neutral-200 bg-slate-50 text-slate-400 cursor-not-allowed"
              : "border-neutral-300 focus:ring-2 focus:ring-[#02665e]/30 focus:border-[#02665e]"
          }`}
        />
      </div>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full  ${
        active
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200 border-solid"
          : "bg-slate-100 text-slate-500 border border-neutral-300 border-solid"
      }`}
    >
      {active ? <CheckCircle2 className="w-3 h-3" /> : <X className="w-3 h-3" />}
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function SaveBar({
  saving,
  error,
  onSave,
  onCancel,
}: {
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-0 flex items-center gap-2 pt-2 border-t border-neutral-200 mt-3 border-solid">
      {error && (
        <span className="flex items-center gap-1 text-xs text-red-600 flex-1">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </span>
      )}
      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-neutral-300 rounded-lg hover:bg-slate-50 border-solid"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#02665e] text-white rounded-lg hover:bg-[#015a52] disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save changes
        </button>
      </div>
    </div>
  );
}

// ─── HISTORY PANEL ────────────────────────────────────────────────────────────

function HistoryPanel({ entity, entityId, label, onClose }: { entity: string; entityId: number; label: string; onClose: () => void }) {
  const [logs, setLogs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    setLoading(true); setError("");
    apiFetch(`/api/admin/nolscope/audit/${entity}/${entityId}`)
      .then((d) => setLogs(d.logs ?? []))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [entity, entityId]);

  function diffFields(before: any, after: any) {
    if (!before || !after) return [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changes: { field: string; from: any; to: any }[] = [];
    for (const k of keys) {
      if (k === "updatedAt" || k === "lastVerified" || k === "lastUpdated") continue;
      const bv = before[k]; const av = after[k];
      if (JSON.stringify(bv) !== JSON.stringify(av)) changes.push({ field: k, from: bv, to: av });
    }
    return changes;
  }

  function fmt(v: any): string {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  return (
    <div className="border-0 border-t border-neutral-200 bg-slate-50/80 px-4 py-4 border-solid">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[#02665e]" />
          <span className="text-sm font-semibold text-slate-800">Change history</span>
          <span className="text-xs text-slate-400 truncate max-w-[160px]">{label}</span>
        </div>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
          <X className="w-4 h-4" />
        </button>
      </div>

      {loading && <Loader2 className="w-4 h-4 animate-spin text-[#02665e] mx-auto my-4" />}
      {error   && <p className="text-xs text-red-500 py-2">{error}</p>}

      {!loading && !error && logs.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-4">No changes recorded yet. Changes will appear here after the first save.</p>
      )}

      {!loading && logs.length > 0 && (
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {logs.map((log) => {
            const isCreate = log.action?.endsWith("_CREATE");
            const changes = isCreate ? [] : diffFields(log.beforeJson, log.afterJson);
            const actor = log.actor;
            const after = log.afterJson ?? {};
            const categoryLabel = after.category ?? after.transportType ?? after.seasonName ?? null;
            return (
              <div key={String(log.id)} className={`bg-white border rounded-xl p-3 shadow-sm border-solid ${isCreate ? "border-emerald-200" : "border-neutral-200"}`}>
                {/* meta row */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {isCreate ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">
                      <Plus className="w-3 h-3" /> Record created
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-[#02665e]/10 text-[#02665e] rounded-full">
                      <Edit2 className="w-3 h-3" /> Updated
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[10px] text-slate-500 px-2 py-0.5 bg-slate-100 rounded-full">
                    <Clock className="w-3 h-3" />
                    {new Date(log.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  {actor ? (
                    <span className="flex items-center gap-1 text-[10px] text-slate-600 px-2 py-0.5 bg-slate-100 rounded-full">
                      <User className="w-3 h-3" />
                      {actor.fullName ?? actor.name ?? actor.email} <span className="text-slate-400 ml-0.5">({actor.email})</span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 px-2 py-0.5 bg-slate-50 rounded-full">System / seed</span>
                  )}
                  {categoryLabel && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full ml-auto">{categoryLabel}</span>
                  )}
                </div>

                {/* create: show a summary of key initial values */}
                {isCreate && (
                  <div className="space-y-1 mt-1">
                    {Object.entries(after)
                      .filter(([k]) => !["id","createdAt","updatedAt","lastVerified","lastUpdated","isActive"].includes(k))
                      .slice(0, 8)
                      .map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[140px_1fr] gap-1 text-xs">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide truncate">{k}</span>
                          <span className="text-slate-700 truncate font-medium" title={fmt(v)}>{fmt(v)}</span>
                        </div>
                      ))}
                  </div>
                )}

                {/* update: show changed fields */}
                {!isCreate && (
                  changes.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No field changes recorded</p>
                  ) : (
                    <div className="space-y-1">
                      {changes.map((c) => (
                        <div key={c.field} className="grid grid-cols-[120px_1fr_1fr] gap-1 text-xs">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide truncate">{c.field}</span>
                          <span className="text-red-500 line-through truncate" title={fmt(c.from)}>{fmt(c.from)}</span>
                          <span className="text-emerald-700 font-medium truncate" title={fmt(c.to)}>{fmt(c.to)}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ACTIVITIES tab ───────────────────────────────────────────────────────────

function ActivitiesTab() {
  const [rows, setRows]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [draft, setDraft]         = useState<any>(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState("");
  const [filter, setFilter]       = useState("");
  const [destFilter, setDestFilter] = useState("");
  const [page, setPage]           = useState(1);
  const [sortBy, setSortBy]       = useState<"activity" | "category" | "destination" | "min" | "avg" | "max" | "status">("activity");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("asc");
  const [showAdd, setShowAdd]     = useState(false);
  const [newRow, setNewRow]       = useState({ activityCode: "", activityName: "", category: "safari", destination: "", minCost: "0", maxCost: "0", averageCost: "0", description: "" });
  const [adding, setAdding]       = useState(false);
  const pageSize = 10;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const d = await apiFetch("/api/admin/nolscope/activities");
      setRows(d.activities ?? []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const destinations = [...new Set(rows.map((r) => r.destination))].sort();

  const filteredRows = rows.filter((r) => {
    const q = filter.toLowerCase();
    const matchQ = !q || r.activityName.toLowerCase().includes(q) || r.activityCode.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q);
    const matchD = !destFilter || r.destination === destFilter;
    return matchQ && matchD;
  });

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const valueOf = (row: any): string | number => {
      switch (sortBy) {
        case "activity": return `${String(row.activityName ?? "").toLowerCase()} ${String(row.activityCode ?? "").toLowerCase()}`;
        case "category": return String(row.category ?? "").toLowerCase();
        case "destination": return String(row.destination ?? "").toLowerCase();
        case "min": return Number(row.minCost ?? 0);
        case "avg": return Number(row.averageCost ?? 0);
        case "max": return Number(row.maxCost ?? 0);
        case "status": return row.isActive ? 1 : 0;
        default: return "";
      }
    };
    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredRows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const pagedRows = sortedRows.slice(start, end);

  useEffect(() => {
    setPage(1);
  }, [filter, destFilter, sortBy, sortDir, rows.length]);

  const handleSort = (field: "activity" | "category" | "destination" | "min" | "avg" | "max" | "status") => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  };

  const renderSortIcon = (field: "activity" | "category" | "destination" | "min" | "avg" | "max" | "status") => {
    if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3.5 h-3.5 text-[#02665e]" />
      : <ChevronDown className="w-3.5 h-3.5 text-[#02665e]" />;
  };

  function openEdit(row: any) {
    setExpanded(row.id);
    setDraft({ ...row });
    setSaveError("");
  }

  function closeEdit() { setExpanded(null); setDraft(null); }

  async function save() {
    if (!draft) return;
    setSaving(true); setSaveError("");
    try {
      const { id, activityCode, createdAt, updatedAt, ...rest } = draft;
      const d = await apiFetch(`/api/admin/nolscope/activities/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      setRows((prev) => prev.map((r) => r.id === id ? d.updated : r));
      closeEdit();
    } catch (e: any) { setSaveError(e.message); }
    finally { setSaving(false); }
  }

  async function toggleActive(row: any) {
    try {
      const d = await apiFetch(`/api/admin/nolscope/activities/${row.id}`, { method: "PUT", body: JSON.stringify({ isActive: !row.isActive }) });
      setRows((prev) => prev.map((r) => r.id === row.id ? d.updated : r));
    } catch {}
  }

  async function addNew() {
    if (!newRow.activityCode || !newRow.activityName || !newRow.destination) return;
    setAdding(true);
    try {
      const d = await apiFetch("/api/admin/nolscope/activities", { method: "POST", body: JSON.stringify({ ...newRow, minCost: Number(newRow.minCost), maxCost: Number(newRow.maxCost), averageCost: Number(newRow.averageCost) }) });
      setRows((prev) => [...prev, d.created]);
      setShowAdd(false);
      setNewRow({ activityCode: "", activityName: "", category: "safari", destination: "", minCost: "0", maxCost: "0", averageCost: "0", description: "" });
    } catch {}
    finally { setAdding(false); }
  }

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-[#02665e] mx-auto mt-8" />;
  if (error)   return <p className="text-sm text-red-600 p-4">{error}</p>;

  return (
    <div className="space-y-3">
      {/* filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          placeholder="Search activities…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[160px] text-sm border border-neutral-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid"
        />
        <select
          value={destFilter}
          onChange={(e) => setDestFilter(e.target.value)}
          className="text-sm border border-neutral-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid"
        >
          <option value="">All destinations</option>
          {destinations.map((d) => <option key={d}>{d}</option>)}
        </select>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[#02665e] text-white rounded-xl hover:bg-[#015a52]">
          <Plus className="w-4 h-4" /> Add activity
        </button>
        <button onClick={load} className="p-2 text-slate-400 hover:text-[#02665e] border border-neutral-300 rounded-xl border-solid">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-slate-400">{sortedRows.length} of {rows.length} activities</p>

      {/* add form */}
      {showAdd && (
        <div className="bg-white border border-solid border-neutral-300 rounded-xl p-4 space-y-3 shadow-sm">
          <h4 className="text-sm font-bold text-neutral-900">New Activity</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <EditableField label="Activity Code (unique slug)" value={newRow.activityCode} onChange={(v) => setNewRow((p) => ({ ...p, activityCode: v }))} />
            <EditableField label="Activity Name" value={newRow.activityName} onChange={(v) => setNewRow((p) => ({ ...p, activityName: v }))} />
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Destination</label>
              <div className="flex items-center gap-1">
                <input list="dest-list" value={newRow.destination} onChange={(e) => setNewRow((p) => ({ ...p, destination: e.target.value }))}
                  className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid" />
              </div>
              <datalist id="dest-list">{destinations.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Category</label>
              <div className="flex items-center gap-1">
                <select value={newRow.category} onChange={(e) => setNewRow((p) => ({ ...p, category: e.target.value }))}
                  className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                  {["safari","water-sports","cultural","adventure","wellness","dining"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <EditableField label="Min cost (USD)" value={newRow.minCost} type="number" prefix="$" onChange={(v) => setNewRow((p) => { const min = Number(v); const max = Number(p.maxCost); return { ...p, minCost: v, averageCost: String(Math.round((min + max) / 2 * 100) / 100) }; })} />
            <div className="relative">
              <EditableField label="Avg cost (USD)" value={newRow.averageCost} type="number" prefix="$" disabled onChange={(v) => setNewRow((p) => ({ ...p, averageCost: v }))} />
              <span className="absolute top-0 right-0 text-[8px] font-bold text-[#02665e] bg-[#02665e]/10 rounded px-1 py-0.5 leading-none">AUTO</span>
            </div>
            <EditableField label="Max cost (USD)" value={newRow.maxCost} type="number" prefix="$" onChange={(v) => setNewRow((p) => { const max = Number(v); const min = Number(p.minCost); return { ...p, maxCost: v, averageCost: String(Math.round((min + max) / 2 * 100) / 100) }; })} />
            <EditableField label="Description" value={newRow.description} onChange={(v) => setNewRow((p) => ({ ...p, description: v }))} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-slate-600 border border-neutral-300 rounded-lg hover:bg-slate-50 border-solid">Cancel</button>
            <button onClick={addNew} disabled={adding} className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#02665e] text-white rounded-lg hover:bg-[#015a52] disabled:opacity-50">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
            </button>
          </div>
        </div>
      )}

      {/* rows */}
      <div className="overflow-x-auto rounded-xl border border-solid border-neutral-300 bg-white">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-0 border-b border-solid border-neutral-300 bg-neutral-50">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("activity")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Activity {renderSortIcon("activity")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("category")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Category {renderSortIcon("category")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("destination")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Destination {renderSortIcon("destination")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("min")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Min {renderSortIcon("min")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("avg")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Avg {renderSortIcon("avg")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("max")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Max {renderSortIcon("max")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Status {renderSortIcon("status")}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">Actions</th>
            </tr>
          </thead>
          <tbody className="[&>*]:border-0 [&>*]:border-t [&>*]:border-solid [&>*]:border-neutral-200 [&>*:first-child]:border-t-0">
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">No activities found</td>
              </tr>
            )}
            {pagedRows.map((row) => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800 leading-tight">{row.activityName}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{row.activityCode}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-medium px-2 py-0.5 bg-[#02665e]/10 text-[#02665e] rounded-full capitalize whitespace-nowrap">{row.category}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{row.destination}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">{fmtUSD(row.minCost)}</td>
                  <td className="px-4 py-3 text-right text-xs font-semibold text-slate-800">{fmtUSD(row.averageCost)}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">{fmtUSD(row.maxCost)}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge active={row.isActive} /></td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => toggleActive(row)} className="p-1.5 text-slate-400 hover:text-[#02665e] rounded-lg hover:bg-[#02665e]/5" title={row.isActive ? "Deactivate" : "Activate"}>
                        {row.isActive ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4" />}
                      </button>
                      <button onClick={() => setHistoryId(historyId === row.id ? null : row.id)} className="p-1.5 text-slate-400 hover:text-[#02b4f5] rounded-lg hover:bg-[#02b4f5]/5" title="Change history">
                        <History className="w-4 h-4" />
                      </button>
                      <button onClick={() => expanded === row.id ? closeEdit() : openEdit(row)} className="p-1.5 text-slate-400 hover:text-[#02665e] rounded-lg hover:bg-[#02665e]/5">
                        {expanded === row.id ? <ChevronUp className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded === row.id && draft && (
                  <tr>
                    <td colSpan={8} className="border-0 p-0 border-t border-neutral-200 border-solid">
                      <div className="px-4 py-4 bg-neutral-50 overflow-hidden">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          <EditableField label="Activity Name" value={draft.activityName} onChange={(v) => setDraft((p: any) => ({ ...p, activityName: v }))} />
                          <EditableField label="Destination" value={draft.destination} onChange={(v) => setDraft((p: any) => ({ ...p, destination: v }))} />
                          <div>
                            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Category</label>
                            <div className="flex items-center gap-1">
                              <select value={draft.category} onChange={(e) => setDraft((p: any) => ({ ...p, category: e.target.value }))}
                                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 bg-white border-solid">
                                {["safari","water-sports","cultural","adventure","wellness","dining"].map((c) => <option key={c}>{c}</option>)}
                              </select>
                            </div>
                          </div>
                          <EditableField label="Min cost (USD)" value={draft.minCost} type="number" prefix="$" onChange={(v) => setDraft((p: any) => { const min = Number(v); const max = Number(p.maxCost); return { ...p, minCost: v, averageCost: String(Math.round((min + max) / 2 * 100) / 100) }; })} />
                          <div className="relative">
                            <EditableField label="Avg cost (USD)" value={draft.averageCost} type="number" prefix="$" disabled onChange={(v) => setDraft((p: any) => ({ ...p, averageCost: v }))} />
                            <span className="absolute top-0 right-0 text-[8px] font-bold text-[#02665e] bg-[#02665e]/10 rounded px-1 py-0.5 leading-none">AUTO</span>
                          </div>
                          <EditableField label="Max cost (USD)" value={draft.maxCost} type="number" prefix="$" onChange={(v) => setDraft((p: any) => { const max = Number(v); const min = Number(p.minCost); return { ...p, maxCost: v, averageCost: String(Math.round((min + max) / 2 * 100) / 100) }; })} />
                          <EditableField label="Peak multiplier" value={draft.peakMultiplier ?? 1} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, peakMultiplier: v }))} />
                          <EditableField label="Off-peak multiplier" value={draft.offPeakMultiplier ?? 1} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, offPeakMultiplier: v }))} />
                          <EditableField label="Duration" value={draft.duration ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, duration: v }))} />
                          <EditableField label="Group size" value={draft.groupSize ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, groupSize: v }))} />
                          <EditableField label="Provider" value={draft.provider ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, provider: v }))} />
                          <EditableField label="Popularity (1–100)" value={draft.popularity ?? 0} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, popularity: v }))} />
                          <div className="md:col-start-2 min-w-0">
                            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Description</label>
                            <textarea rows={2} value={draft.description ?? ""} onChange={(e) => setDraft((p: any) => ({ ...p, description: e.target.value }))}
                              className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 resize-none border-solid" />
                          </div>
                        </div>
                        <SaveBar saving={saving} error={saveError} onSave={save} onCancel={closeEdit} />
                      </div>
                    </td>
                  </tr>
                )}
                {historyId === row.id && (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <HistoryPanel entity="NOLSCOPE_ACTIVITY" entityId={row.id} label={row.activityName} onClose={() => setHistoryId(null)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-solid border-neutral-300 rounded-xl px-3 py-2 bg-white">
        <span className="text-xs text-slate-500">Showing {sortedRows.length === 0 ? 0 : start + 1}-{Math.min(end, sortedRows.length)} of {sortedRows.length}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Previous</button>
          <span className="text-xs font-semibold text-slate-600">Page {safePage} of {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Next</button>
        </div>
      </div>
    </div>
  );
}

// ─── PARK FEES tab ────────────────────────────────────────────────────────────

function ParkFeesTab() {
  const [rows, setRows]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [draft, setDraft]         = useState<any>(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showAdd, setShowAdd]     = useState(false);
  const [page, setPage]           = useState(1);
  const [sortBy, setSortBy]       = useState<"park" | "region" | "adultIntl" | "adultRes" | "vehicle" | "status">("park");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("asc");
  const [newRow, setNewRow]       = useState({ parkCode: "", parkName: "", category: "national-park", region: "", adultForeignerFee: "0", adultResidentFee: "0", childForeignerFee: "", vehicleFee: "", campingFee: "", description: "" });
  const [adding, setAdding]       = useState(false);
  const pageSize = 10;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const d = await apiFetch("/api/admin/nolscope/park-fees"); setRows(d.parkFees ?? []); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const valueOf = (row: any): string | number => {
      switch (sortBy) {
        case "park": return `${String(row.parkName ?? "").toLowerCase()} ${String(row.parkCode ?? "").toLowerCase()}`;
        case "region": return String(row.region ?? "").toLowerCase();
        case "adultIntl": return Number(row.adultForeignerFee ?? 0);
        case "adultRes": return Number(row.adultResidentFee ?? 0);
        case "vehicle": return Number(row.vehicleFee ?? 0);
        case "status": return row.isActive ? 1 : 0;
        default: return "";
      }
    };
    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const pagedRows = sortedRows.slice(start, end);

  useEffect(() => {
    setPage(1);
  }, [sortBy, sortDir, rows.length]);

  const handleSort = (field: "park" | "region" | "adultIntl" | "adultRes" | "vehicle" | "status") => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  };

  const renderSortIcon = (field: "park" | "region" | "adultIntl" | "adultRes" | "vehicle" | "status") => {
    if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3.5 h-3.5 text-[#02665e]" />
      : <ChevronDown className="w-3.5 h-3.5 text-[#02665e]" />;
  };

  function openEdit(row: any) { setExpanded(row.id); setDraft({ ...row }); setSaveError(""); }
  function closeEdit() { setExpanded(null); setDraft(null); }

  async function save() {
    if (!draft) return;
    setSaving(true); setSaveError("");
    try {
      const { id, createdAt, updatedAt, parkCode, parkName, category, region, ...rest } = draft;
      const d = await apiFetch(`/api/admin/nolscope/park-fees/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      setRows((prev) => prev.map((r) => r.id === id ? d.updated : r));
      closeEdit();
    } catch (e: any) { setSaveError(e.message); }
    finally { setSaving(false); }
  }

  async function addNew() {
    if (!newRow.parkCode || !newRow.parkName || !newRow.region) return;
    setAdding(true);
    try {
      const d = await apiFetch("/api/admin/nolscope/park-fees", { method: "POST", body: JSON.stringify({ ...newRow, adultForeignerFee: Number(newRow.adultForeignerFee), adultResidentFee: Number(newRow.adultResidentFee) }) });
      setRows((prev) => [...prev, d.created]);
      setShowAdd(false);
      setNewRow({ parkCode: "", parkName: "", category: "national-park", region: "", adultForeignerFee: "0", adultResidentFee: "0", childForeignerFee: "", vehicleFee: "", campingFee: "", description: "" });
    } catch {}
    finally { setAdding(false); }
  }

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-[#02665e] mx-auto mt-8" />;
  if (error)   return <p className="text-sm text-red-600 p-4">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{sortedRows.length} park fee records</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[#02665e] text-white rounded-xl hover:bg-[#015a52]">
            <Plus className="w-4 h-4" /> Add park
          </button>
          <button onClick={load} className="p-2 text-slate-400 hover:text-[#02665e] border border-neutral-300 rounded-xl border-solid"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {/* add form */}
      {showAdd && (
        <div className="bg-white border border-solid border-neutral-300 rounded-xl p-4 space-y-3 shadow-sm">
          <h4 className="text-sm font-bold text-neutral-900">New Park / Conservation Area</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <EditableField label="Park Code (unique)" value={newRow.parkCode} onChange={(v) => setNewRow((p) => ({ ...p, parkCode: v }))} />
            <EditableField label="Park Name" value={newRow.parkName} onChange={(v) => setNewRow((p) => ({ ...p, parkName: v }))} />
            <EditableField label="Region" value={newRow.region} onChange={(v) => setNewRow((p) => ({ ...p, region: v }))} />
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Category</label>
              <div className="flex items-center gap-1">
                <select value={newRow.category} onChange={(e) => setNewRow((p) => ({ ...p, category: e.target.value }))}
                  className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                  {["national-park","conservation-area","marine-park","game-reserve"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <EditableField label="Adult foreigner fee/day (USD)" value={newRow.adultForeignerFee} type="number" prefix="$" onChange={(v) => setNewRow((p) => ({ ...p, adultForeignerFee: v }))} />
            <EditableField label="Adult resident fee/day (USD)" value={newRow.adultResidentFee} type="number" prefix="$" onChange={(v) => setNewRow((p) => ({ ...p, adultResidentFee: v }))} />
            <EditableField label="Child foreigner fee (USD)" value={newRow.childForeignerFee} type="number" prefix="$" onChange={(v) => setNewRow((p) => ({ ...p, childForeignerFee: v }))} />
            <EditableField label="Vehicle fee (USD)" value={newRow.vehicleFee} type="number" prefix="$" onChange={(v) => setNewRow((p) => ({ ...p, vehicleFee: v }))} />
            <EditableField label="Camping fee/night (USD)" value={newRow.campingFee} type="number" prefix="$" onChange={(v) => setNewRow((p) => ({ ...p, campingFee: v }))} />
            <EditableField label="Description" value={newRow.description} onChange={(v) => setNewRow((p) => ({ ...p, description: v }))} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-slate-600 border border-neutral-300 rounded-lg hover:bg-slate-50 border-solid">Cancel</button>
            <button onClick={addNew} disabled={adding} className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#02665e] text-white rounded-lg hover:bg-[#015a52] disabled:opacity-50">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-solid border-neutral-300 bg-white">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-0 border-b border-solid border-neutral-300 bg-neutral-50">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("park")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Park {renderSortIcon("park")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("region")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Region {renderSortIcon("region")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("adultIntl")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Adult (intl) {renderSortIcon("adultIntl")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("adultRes")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Adult (res.) {renderSortIcon("adultRes")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("vehicle")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Vehicle {renderSortIcon("vehicle")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Status {renderSortIcon("status")}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">Actions</th>
            </tr>
          </thead>
          <tbody className="[&>*]:border-0 [&>*]:border-t [&>*]:border-solid [&>*]:border-neutral-200 [&>*:first-child]:border-t-0">
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">No park fee records found</td>
              </tr>
            )}
            {pagedRows.map((row) => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800 leading-tight">{row.parkName}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{row.parkCode}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full whitespace-nowrap border-solid">{row.region}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-semibold text-slate-800 whitespace-nowrap">{fmtUSD(Number(row.adultForeignerFee))}/day</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500 whitespace-nowrap">{fmtUSD(Number(row.adultResidentFee))}/day</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">{row.vehicleFee > 0 ? fmtUSD(Number(row.vehicleFee)) : "—"}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge active={row.isActive} /></td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setHistoryId(historyId === row.id ? null : row.id)} className="p-1.5 text-slate-400 hover:text-[#02b4f5] rounded-lg hover:bg-[#02b4f5]/5" title="Change history">
                        <History className="w-4 h-4" />
                      </button>
                      <button onClick={() => expanded === row.id ? closeEdit() : openEdit(row)} className="p-1.5 text-slate-400 hover:text-[#02665e] rounded-lg hover:bg-[#02665e]/5">
                        {expanded === row.id ? <ChevronUp className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded === row.id && draft && (
                  <tr>
                    <td colSpan={7} className="border-0 p-0 border-t border-neutral-200 border-solid">
                      <div className="px-4 py-4 bg-neutral-50 overflow-hidden">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          <EditableField label="Adult foreigner fee/day (USD)" value={draft.adultForeignerFee} type="number" prefix="$" onChange={(v) => setDraft((p: any) => ({ ...p, adultForeignerFee: v }))} />
                          <EditableField label="Adult resident fee/day (USD)" value={draft.adultResidentFee} type="number" prefix="$" onChange={(v) => setDraft((p: any) => ({ ...p, adultResidentFee: v }))} />
                          <EditableField label="Child foreigner fee/day (USD)" value={draft.childForeignerFee ?? 0} type="number" prefix="$" onChange={(v) => setDraft((p: any) => ({ ...p, childForeignerFee: v }))} />
                          <EditableField label="Child resident fee/day (USD)" value={draft.childResidentFee ?? 0} type="number" prefix="$" onChange={(v) => setDraft((p: any) => ({ ...p, childResidentFee: v }))} />
                          <EditableField label="Vehicle fee (USD)" value={draft.vehicleFee ?? 0} type="number" prefix="$" onChange={(v) => setDraft((p: any) => ({ ...p, vehicleFee: v }))} />
                          <EditableField label="Camping fee/night (USD)" value={draft.campingFee ?? 0} type="number" prefix="$" onChange={(v) => setDraft((p: any) => ({ ...p, campingFee: v }))} />
                          <EditableField label="Guide fee (USD)" value={draft.guideFee ?? 0} type="number" prefix="$" onChange={(v) => setDraft((p: any) => ({ ...p, guideFee: v }))} />
                          <EditableField label="Min days" value={draft.minimumDays ?? 1} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, minimumDays: v }))} />
                          <div>
                            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Active</label>
                            <div className="flex items-center gap-1">
                              <select value={String(draft.isActive)} onChange={(e) => setDraft((p: any) => ({ ...p, isActive: e.target.value === "true" }))}
                                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 bg-white border-solid">
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                              </select>
                            </div>
                          </div>
                          <div className="md:col-start-2 min-w-0">
                            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Description</label>
                            <textarea rows={2} value={draft.description ?? ""} onChange={(e) => setDraft((p: any) => ({ ...p, description: e.target.value }))}
                              className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 resize-none border-solid" />
                          </div>
                        </div>
                        <SaveBar saving={saving} error={saveError} onSave={save} onCancel={closeEdit} />
                      </div>
                    </td>
                  </tr>
                )}
                {historyId === row.id && (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <HistoryPanel entity="NOLSCOPE_PARK_FEE" entityId={row.id} label={row.parkName} onClose={() => setHistoryId(null)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-solid border-neutral-300 rounded-xl px-3 py-2 bg-white">
        <span className="text-xs text-slate-500">Showing {sortedRows.length === 0 ? 0 : start + 1}-{Math.min(end, sortedRows.length)} of {sortedRows.length}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Previous</button>
          <span className="text-xs font-semibold text-slate-600">Page {safePage} of {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Next</button>
        </div>
      </div>
    </div>
  );
}

// ─── VISA FEES tab ────────────────────────────────────────────────────────────────

function VisaFeesTab() {
  const [rows, setRows]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [draft, setDraft]         = useState<any>(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState("");
  const [filter, setFilter]       = useState("");
  const [page, setPage]           = useState(1);
  const [sortBy, setSortBy]       = useState<"code" | "fee" | "type" | "entries" | "processing" | "status">("code");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("asc");
  const [showAdd, setShowAdd]     = useState(false);
  const [newRow, setNewRow]       = useState({ nationality: "", amount: "50", visaType: "tourist", entries: "single", durationDays: "90", processingTime: "on-arrival", description: "" });
  const [adding, setAdding]       = useState(false);
  const pageSize = 10;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const d = await apiFetch("/api/admin/nolscope/visa-fees"); setRows(d.visaFees ?? []); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openEdit(row: any) { setExpanded(row.id); setDraft({ ...row }); setSaveError(""); }
  function closeEdit() { setExpanded(null); setDraft(null); }

  async function save() {
    if (!draft) return;
    setSaving(true); setSaveError("");
    try {
      const { id, nationality, visaType, createdAt, updatedAt, ...rest } = draft;
      const d = await apiFetch(`/api/admin/nolscope/visa-fees/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      setRows((prev) => prev.map((r) => r.id === id ? d.updated : r));
      closeEdit();
    } catch (e: any) { setSaveError(e.message); }
    finally { setSaving(false); }
  }

  async function addNew() {
    if (!newRow.nationality) return;
    setAdding(true);
    try {
      const d = await apiFetch("/api/admin/nolscope/visa-fees", { method: "POST", body: JSON.stringify({ ...newRow, amount: Number(newRow.amount), durationDays: Number(newRow.durationDays) }) });
      setRows((prev) => [...prev, d.created]);
      setShowAdd(false);
      setNewRow({ nationality: "", amount: "50", visaType: "tourist", entries: "single", durationDays: "90", processingTime: "on-arrival", description: "" });
    } catch {}
    finally { setAdding(false); }
  }

  const filteredRows = rows.filter((r) => {
    const q = filter.toLowerCase();
    return !q || r.nationality.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q);
  });

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const valueOf = (row: any): string | number => {
      switch (sortBy) {
        case "code": return String(row.nationality ?? "").toLowerCase();
        case "fee": return Number(row.amount ?? 0);
        case "type": return String(row.visaType ?? "").toLowerCase();
        case "entries": return String(row.entries ?? "").toLowerCase();
        case "processing": return String(row.processingTime ?? "").toLowerCase();
        case "status": return row.isActive ? 1 : 0;
        default: return "";
      }
    };
    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredRows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const pagedRows = sortedRows.slice(start, end);

  useEffect(() => {
    setPage(1);
  }, [filter, sortBy, sortDir, rows.length]);

  const handleSort = (field: "code" | "fee" | "type" | "entries" | "processing" | "status") => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  };

  const renderSortIcon = (field: "code" | "fee" | "type" | "entries" | "processing" | "status") => {
    if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3.5 h-3.5 text-[#02665e]" />
      : <ChevronDown className="w-3.5 h-3.5 text-[#02665e]" />;
  };

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-[#02665e] mx-auto mt-8" />;
  if (error)   return <p className="text-sm text-red-600 p-4">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <input placeholder="Search nationality…" value={filter} onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[160px] text-sm border border-neutral-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid" />
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[#02665e] text-white rounded-xl hover:bg-[#015a52]">
          <Plus className="w-4 h-4" /> Add country
        </button>
        <button onClick={load} className="p-2 text-slate-400 hover:text-[#02665e] border border-neutral-300 rounded-xl border-solid"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <p className="text-xs text-slate-400">{sortedRows.length} of {rows.length} visa fee rules</p>

      {/* add form */}
      {showAdd && (
        <div className="bg-white border border-solid border-neutral-300 rounded-xl p-4 space-y-3 shadow-sm">
          <h4 className="text-sm font-bold text-neutral-900">New Visa Fee Rule</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Nationality Code (ISO 2)</label>
              <input value={newRow.nationality} onChange={(e) => setNewRow((p) => ({ ...p, nationality: e.target.value.toUpperCase().slice(0,2) }))}
                placeholder="e.g. GB" maxLength={2}
                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 font-mono uppercase border-solid" />
            </div>
            <EditableField label="Fee (USD)" value={newRow.amount} type="number" prefix="$" onChange={(v) => setNewRow((p) => ({ ...p, amount: v }))} />
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Visa Type</label>
              <select value={newRow.visaType} onChange={(e) => setNewRow((p) => ({ ...p, visaType: e.target.value }))}
                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                {["tourist","business","multiple-entry","transit","visa-free"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Entries</label>
              <select value={newRow.entries} onChange={(e) => setNewRow((p) => ({ ...p, entries: e.target.value }))}
                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                {["single","double","multiple"].map((e) => <option key={e}>{e}</option>)}
              </select>
            </div>
            <EditableField label="Duration (days)" value={newRow.durationDays} type="number" onChange={(v) => setNewRow((p) => ({ ...p, durationDays: v }))} />
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Processing</label>
              <select value={newRow.processingTime} onChange={(e) => setNewRow((p) => ({ ...p, processingTime: e.target.value }))}
                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                {["on-arrival","e-visa","embassy","visa-free"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <EditableField label="Description" value={newRow.description} onChange={(v) => setNewRow((p) => ({ ...p, description: v }))} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-slate-600 border border-neutral-300 rounded-lg hover:bg-slate-50 border-solid">Cancel</button>
            <button onClick={addNew} disabled={adding || !newRow.nationality} className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#02665e] text-white rounded-lg hover:bg-[#015a52] disabled:opacity-50">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-solid border-neutral-300 bg-white">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-0 border-b border-solid border-neutral-300 bg-neutral-50">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("code")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Code {renderSortIcon("code")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("fee")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Fee (USD) {renderSortIcon("fee")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("type")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Type {renderSortIcon("type")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("entries")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Entries {renderSortIcon("entries")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("processing")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Processing {renderSortIcon("processing")}
                </button>
              </th>
              <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Status {renderSortIcon("status")}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">Actions</th>
            </tr>
          </thead>
          <tbody className="[&>*]:border-0 [&>*]:border-t [&>*]:border-solid [&>*]:border-neutral-200 [&>*:first-child]:border-t-0">
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">No visa fee rules found</td>
              </tr>
            )}
            {pagedRows.map((row) => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="text-sm font-bold text-slate-800 font-mono">{row.nationality}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-slate-800">{fmtUSD(Number(row.amount))}</td>
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{row.visaType}</td>
                  <td className="px-4 py-3 text-xs text-slate-600 capitalize whitespace-nowrap">{row.entries}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{row.processingTime}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge active={row.isActive} /></td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setHistoryId(historyId === row.id ? null : row.id)} className="p-1.5 text-slate-400 hover:text-[#02b4f5] rounded-lg hover:bg-[#02b4f5]/5" title="Change history">
                        <History className="w-4 h-4" />
                      </button>
                      <button onClick={() => expanded === row.id ? closeEdit() : openEdit(row)} className="p-1.5 text-slate-400 hover:text-[#02665e] rounded-lg hover:bg-[#02665e]/5">
                        {expanded === row.id ? <ChevronUp className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded === row.id && draft && (
                  <tr>
                    <td colSpan={7} className="border-0 p-0 border-t border-neutral-200 border-solid">
                      <div className="px-4 py-4 bg-neutral-50 overflow-hidden">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          <EditableField label="Fee (USD)" value={draft.amount} type="number" prefix="$" onChange={(v) => setDraft((p: any) => ({ ...p, amount: v }))} />
                          <EditableField label="Entries" value={draft.entries ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, entries: v }))} />
                          <EditableField label="Duration (days)" value={draft.durationDays ?? 90} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, durationDays: v }))} />
                          <EditableField label="Processing time" value={draft.processingTime ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, processingTime: v }))} />
                          <div>
                            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Active</label>
                            <div className="flex items-center gap-1">
                              <select value={String(draft.isActive)} onChange={(e) => setDraft((p: any) => ({ ...p, isActive: e.target.value === "true" }))}
                                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 bg-white border-solid">
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                              </select>
                            </div>
                          </div>
                          <div className="md:col-start-2 min-w-0">
                            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Description</label>
                            <textarea rows={2} value={draft.description ?? ""} onChange={(e) => setDraft((p: any) => ({ ...p, description: e.target.value }))}
                              className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 resize-none border-solid" />
                          </div>
                        </div>
                        <SaveBar saving={saving} error={saveError} onSave={save} onCancel={closeEdit} />
                      </div>
                    </td>
                  </tr>
                )}
                {historyId === row.id && (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <HistoryPanel entity="NOLSCOPE_VISA_FEE" entityId={row.id} label={`${row.nationality} – ${row.visaType}`} onClose={() => setHistoryId(null)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-solid border-neutral-300 rounded-xl px-3 py-2 bg-white">
        <span className="text-xs text-slate-500">Showing {sortedRows.length === 0 ? 0 : start + 1}-{Math.min(end, sortedRows.length)} of {sortedRows.length}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Previous</button>
          <span className="text-xs font-semibold text-slate-600">Page {safePage} of {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Next</button>
        </div>
      </div>
    </div>
  );
}

// ─── TRANSPORT tab ────────────────────────────────────────────────────────────────

function TransportTab() {
  const [rows, setRows]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [draft, setDraft]         = useState<any>(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage]           = useState(1);
  const [sortBy, setSortBy]       = useState<"from" | "to" | "type" | "min" | "avg" | "max" | "provider" | "status">("from");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("asc");
  const [showAdd, setShowAdd]     = useState(false);
  const [newRow, setNewRow]       = useState({ fromLocation: "", toLocation: "", transportType: "flight", minCost: "0", maxCost: "0", averageCost: "0", provider: "", description: "" });
  const [adding, setAdding]       = useState(false);
  const pageSize = 10;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const d = await apiFetch("/api/admin/nolscope/transport-routes"); setRows(d.routes ?? []); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openEdit(row: any) { setExpanded(row.id); setDraft({ ...row }); setSaveError(""); }
  function closeEdit() { setExpanded(null); setDraft(null); }

  async function save() {
    if (!draft) return;
    setSaving(true); setSaveError("");
    try {
      const { id, fromLocation, toLocation, transportType, createdAt, updatedAt, ...rest } = draft;
      const d = await apiFetch(`/api/admin/nolscope/transport-routes/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      setRows((prev) => prev.map((r) => r.id === id ? d.updated : r));
      closeEdit();
    } catch (e: any) { setSaveError(e.message); }
    finally { setSaving(false); }
  }

  async function addNew() {
    if (!newRow.fromLocation || !newRow.toLocation) return;
    setAdding(true);
    try {
      const d = await apiFetch("/api/admin/nolscope/transport-routes", { method: "POST", body: JSON.stringify({ ...newRow, minCost: Number(newRow.minCost), maxCost: Number(newRow.maxCost), averageCost: Number(newRow.averageCost) }) });
      setRows((prev) => [...prev, d.created]);
      setShowAdd(false);
      setNewRow({ fromLocation: "", toLocation: "", transportType: "flight", minCost: "0", maxCost: "0", averageCost: "0", provider: "", description: "" });
    } catch {}
    finally { setAdding(false); }
  }

  const types = [...new Set(rows.map((r) => r.transportType))].sort();
  const filteredRows = typeFilter ? rows.filter((r) => r.transportType === typeFilter) : rows;

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const valueOf = (row: any): string | number => {
      switch (sortBy) {
        case "from": return String(row.fromLocation ?? "").toLowerCase();
        case "to": return String(row.toLocation ?? "").toLowerCase();
        case "type": return String(row.transportType ?? "").toLowerCase();
        case "min": return Number(row.minCost ?? 0);
        case "avg": return Number(row.averageCost ?? 0);
        case "max": return Number(row.maxCost ?? 0);
        case "provider": return String(row.provider ?? "").toLowerCase();
        case "status": return row.isActive ? 1 : 0;
        default: return "";
      }
    };
    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredRows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const pagedRows = sortedRows.slice(start, end);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, sortBy, sortDir, rows.length]);

  const handleSort = (field: "from" | "to" | "type" | "min" | "avg" | "max" | "provider" | "status") => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  };

  const renderSortIcon = (field: "from" | "to" | "type" | "min" | "avg" | "max" | "provider" | "status") => {
    if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3.5 h-3.5 text-[#02665e]" />
      : <ChevronDown className="w-3.5 h-3.5 text-[#02665e]" />;
  };

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-[#02665e] mx-auto mt-8" />;
  if (error)   return <p className="text-sm text-red-600 p-4">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="text-sm border border-neutral-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
          <option value="">All types</option>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[#02665e] text-white rounded-xl hover:bg-[#015a52]">
          <Plus className="w-4 h-4" /> Add route
        </button>
        <button onClick={load} className="p-2 text-slate-400 hover:text-[#02665e] border border-neutral-300 rounded-xl border-solid"><RefreshCw className="w-4 h-4" /></button>
        <p className="text-xs text-slate-400">{sortedRows.length} routes</p>
      </div>

      {/* add form */}
      {showAdd && (
        <div className="bg-white border border-solid border-neutral-300 rounded-xl p-4 space-y-3 shadow-sm">
          <h4 className="text-sm font-bold text-neutral-900">New Transport Route</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <EditableField label="From" value={newRow.fromLocation} onChange={(v) => setNewRow((p) => ({ ...p, fromLocation: v }))} />
            <EditableField label="To" value={newRow.toLocation} onChange={(v) => setNewRow((p) => ({ ...p, toLocation: v }))} />
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Transport Type</label>
              <select value={newRow.transportType} onChange={(e) => setNewRow((p) => ({ ...p, transportType: e.target.value }))}
                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                {["flight","bus","ferry","private-car","shared-taxi","train"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <EditableField label="Min cost (USD)" value={newRow.minCost} type="number" prefix="$" onChange={(v) => setNewRow((p) => { const min = Number(v); const max = Number(p.maxCost); return { ...p, minCost: v, averageCost: String(Math.round((min + max) / 2 * 100) / 100) }; })} />
            <div className="relative">
              <EditableField label="Avg cost (USD)" value={newRow.averageCost} type="number" prefix="$" disabled onChange={(v) => setNewRow((p) => ({ ...p, averageCost: v }))} />
              <span className="absolute top-0 right-0 text-[8px] font-bold text-[#02665e] bg-[#02665e]/10 rounded px-1 py-0.5 leading-none">AUTO</span>
            </div>
            <EditableField label="Max cost (USD)" value={newRow.maxCost} type="number" prefix="$" onChange={(v) => setNewRow((p) => { const max = Number(v); const min = Number(p.minCost); return { ...p, maxCost: v, averageCost: String(Math.round((min + max) / 2 * 100) / 100) }; })} />
            <EditableField label="Provider" value={newRow.provider} onChange={(v) => setNewRow((p) => ({ ...p, provider: v }))} />
            <EditableField label="Description" value={newRow.description} onChange={(v) => setNewRow((p) => ({ ...p, description: v }))} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-slate-600 border border-neutral-300 rounded-lg hover:bg-slate-50 border-solid">Cancel</button>
            <button onClick={addNew} disabled={adding || !newRow.fromLocation || !newRow.toLocation} className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#02665e] text-white rounded-lg hover:bg-[#015a52] disabled:opacity-50">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-solid border-neutral-300 bg-white">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-0 border-b border-solid border-neutral-300 bg-neutral-50">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("from")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">From {renderSortIcon("from")}</button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("to")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">To {renderSortIcon("to")}</button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("type")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Type {renderSortIcon("type")}</button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("min")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Min {renderSortIcon("min")}</button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("avg")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Avg {renderSortIcon("avg")}</button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("max")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Max {renderSortIcon("max")}</button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("provider")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Provider {renderSortIcon("provider")}</button>
              </th>
              <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Status {renderSortIcon("status")}</button>
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">Actions</th>
            </tr>
          </thead>
          <tbody className="[&>*]:border-0 [&>*]:border-t [&>*]:border-solid [&>*]:border-neutral-200 [&>*:first-child]:border-t-0">
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">No transport routes found</td>
              </tr>
            )}
            {pagedRows.map((row) => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-800 whitespace-nowrap">{row.fromLocation}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-800 whitespace-nowrap">{row.toLocation}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full capitalize whitespace-nowrap border-solid">{row.transportType}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">{fmtUSD(Number(row.minCost))}</td>
                  <td className="px-4 py-3 text-right text-xs font-semibold text-slate-800">{fmtUSD(Number(row.averageCost))}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">{fmtUSD(Number(row.maxCost))}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[180px] truncate">{row.provider ?? "—"}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge active={row.isActive} /></td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setHistoryId(historyId === row.id ? null : row.id)} className="p-1.5 text-slate-400 hover:text-[#02b4f5] rounded-lg hover:bg-[#02b4f5]/5" title="Change history">
                        <History className="w-4 h-4" />
                      </button>
                      <button onClick={() => expanded === row.id ? closeEdit() : openEdit(row)} className="p-1.5 text-slate-400 hover:text-[#02665e] rounded-lg hover:bg-[#02665e]/5">
                        {expanded === row.id ? <ChevronUp className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded === row.id && draft && (
                  <tr>
                    <td colSpan={9} className="border-0 p-0 border-t border-neutral-200 border-solid">
                      <div className="px-4 py-4 bg-neutral-50 overflow-hidden">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          <EditableField label="Min cost (USD)" value={draft.minCost} type="number" prefix="$" onChange={(v) => setDraft((p: any) => { const min = Number(v); const max = Number(p.maxCost); return { ...p, minCost: v, averageCost: String(Math.round((min + max) / 2 * 100) / 100) }; })} />
                          <div className="relative">
                            <EditableField label="Avg cost (USD)" value={draft.averageCost} type="number" prefix="$" disabled onChange={(v) => setDraft((p: any) => ({ ...p, averageCost: v }))} />
                            <span className="absolute top-0 right-0 text-[8px] font-bold text-[#02665e] bg-[#02665e]/10 rounded px-1 py-0.5 leading-none">AUTO</span>
                          </div>
                          <EditableField label="Max cost (USD)" value={draft.maxCost} type="number" prefix="$" onChange={(v) => setDraft((p: any) => { const max = Number(v); const min = Number(p.minCost); return { ...p, maxCost: v, averageCost: String(Math.round((min + max) / 2 * 100) / 100) }; })} />
                          <EditableField label="Peak multiplier" value={draft.peakMultiplier ?? 1} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, peakMultiplier: v }))} />
                          <EditableField label="Off-peak multiplier" value={draft.offPeakMultiplier ?? 1} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, offPeakMultiplier: v }))} />
                          <EditableField label="Duration (hours)" value={draft.durationHours ?? ""} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, durationHours: v }))} />
                          <EditableField label="Provider" value={draft.provider ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, provider: v }))} />
                          <EditableField label="Frequency" value={draft.frequency ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, frequency: v }))} />
                          <div>
                            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Active</label>
                            <div className="flex items-center gap-1">
                              <select value={String(draft.isActive)} onChange={(e) => setDraft((p: any) => ({ ...p, isActive: e.target.value === "true" }))}
                                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 bg-white border-solid">
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                              </select>
                            </div>
                          </div>
                          <div className="md:col-start-2 min-w-0">
                            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Description</label>
                            <textarea rows={2} value={draft.description ?? ""} onChange={(e) => setDraft((p: any) => ({ ...p, description: e.target.value }))}
                              className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 resize-none border-solid" />
                          </div>
                        </div>
                        <SaveBar saving={saving} error={saveError} onSave={save} onCancel={closeEdit} />
                      </div>
                    </td>
                  </tr>
                )}
                {historyId === row.id && (
                  <tr>
                    <td colSpan={9} className="p-0">
                      <HistoryPanel entity="NOLSCOPE_TRANSPORT" entityId={row.id} label={`${row.fromLocation} → ${row.toLocation}`} onClose={() => setHistoryId(null)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-solid border-neutral-300 rounded-xl px-3 py-2 bg-white">
        <span className="text-xs text-slate-500">Showing {sortedRows.length === 0 ? 0 : start + 1}-{Math.min(end, sortedRows.length)} of {sortedRows.length}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Previous</button>
          <span className="text-xs font-semibold text-slate-600">Page {safePage} of {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Next</button>
        </div>
      </div>
    </div>
  );
}

// ─── SEASONAL RULES tab ───────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function SeasonalTab() {
  const [rows, setRows]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [draft, setDraft]         = useState<any>(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState("");
  const [page, setPage]           = useState(1);
  const [sortBy, setSortBy]       = useState<"season" | "multiplier" | "months" | "destination" | "status">("season");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("asc");
  const pageSize = 10;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const d = await apiFetch("/api/admin/nolscope/pricing-rules"); setRows(d.pricingRules ?? []); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const monthRangeValue = (row: any) => {
      const sm = Number(row.startMonth || 0);
      const em = Number(row.endMonth || 0);
      return sm * 100 + em;
    };
    const valueOf = (row: any): string | number => {
      switch (sortBy) {
        case "season": return String(row.seasonName ?? row.ruleName ?? "").toLowerCase();
        case "multiplier": return Number(row.priceMultiplier ?? 0);
        case "months": return monthRangeValue(row);
        case "destination": return String(row.destination ?? "").toLowerCase();
        case "status": return row.isActive ? 1 : 0;
        default: return "";
      }
    };
    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const pagedRows = sortedRows.slice(start, end);

  useEffect(() => {
    setPage(1);
  }, [sortBy, sortDir, rows.length]);

  const handleSort = (field: "season" | "multiplier" | "months" | "destination" | "status") => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  };

  const renderSortIcon = (field: "season" | "multiplier" | "months" | "destination" | "status") => {
    if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3.5 h-3.5 text-[#02665e]" />
      : <ChevronDown className="w-3.5 h-3.5 text-[#02665e]" />;
  };

  function openEdit(row: any) { setExpanded(row.id); setDraft({ ...row }); setSaveError(""); }
  function closeEdit() { setExpanded(null); setDraft(null); }

  async function save() {
    if (!draft) return;
    setSaving(true); setSaveError("");
    try {
      const { id, ruleName, ruleType, createdAt, updatedAt, ...rest } = draft;
      const d = await apiFetch(`/api/admin/nolscope/pricing-rules/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      setRows((prev) => prev.map((r) => r.id === id ? d.updated : r));
      closeEdit();
    } catch (e: any) { setSaveError(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-[#02665e] mx-auto mt-8" />;
  if (error)   return <p className="text-sm text-red-600 p-4">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{sortedRows.length} pricing rules</p>
        <button onClick={load} className="p-2 text-slate-400 hover:text-[#02665e] border border-neutral-300 rounded-xl border-solid"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-solid border-neutral-300 bg-white">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-0 border-b border-solid border-neutral-300 bg-neutral-50">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("season")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Season {renderSortIcon("season")}</button>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("multiplier")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Multiplier {renderSortIcon("multiplier")}</button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("months")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Months {renderSortIcon("months")}</button>
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("destination")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Destination {renderSortIcon("destination")}</button>
              </th>
              <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">Status {renderSortIcon("status")}</button>
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">Actions</th>
            </tr>
          </thead>
          <tbody className="[&>*]:border-0 [&>*]:border-t [&>*]:border-solid [&>*]:border-neutral-200 [&>*:first-child]:border-t-0">
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">No pricing rules found</td>
              </tr>
            )}
            {pagedRows.map((row) => {
              const sm = Number(row.startMonth); const em = Number(row.endMonth);
              const monthRange = sm && em ? `${MONTHS[sm-1]} – ${MONTHS[em-1]}` : "—";
              return (
                <React.Fragment key={row.id}>
                  <tr className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{row.seasonName}</div>
                      {row.description && <div className="text-[10px] text-slate-400 mt-0.5 max-w-[200px] truncate">{row.description}</div>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-full whitespace-nowrap border-solid">{Number(row.priceMultiplier)}× rate</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{monthRange}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{row.destination ?? <span className="text-slate-300 italic">all</span>}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge active={row.isActive} /></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setHistoryId(historyId === row.id ? null : row.id)} className="p-1.5 text-slate-400 hover:text-[#02b4f5] rounded-lg hover:bg-[#02b4f5]/5" title="Change history">
                          <History className="w-4 h-4" />
                        </button>
                        <button onClick={() => expanded === row.id ? closeEdit() : openEdit(row)} className="p-1.5 text-slate-400 hover:text-[#02665e] rounded-lg hover:bg-[#02665e]/5">
                          {expanded === row.id ? <ChevronUp className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === row.id && draft && (
                    <tr>
                      <td colSpan={6} className="border-0 p-0 border-t border-neutral-200 border-solid">
                        <div className="px-4 py-4 bg-neutral-50 overflow-hidden">
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            <EditableField label="Season name" value={draft.seasonName} onChange={(v) => setDraft((p: any) => ({ ...p, seasonName: v }))} />
                            <EditableField label="Price multiplier" value={draft.priceMultiplier} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, priceMultiplier: v }))} />
                            <EditableField label="Priority" value={draft.priority ?? 0} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, priority: v }))} />
                            <div>
                              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Start month</label>
                              <div className="flex items-center gap-1">
                                <select value={draft.startMonth ?? ""} onChange={(e) => setDraft((p: any) => ({ ...p, startMonth: e.target.value }))}
                                  className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 bg-white border-solid">
                                  <option value="">—</option>
                                  {MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">End month</label>
                              <div className="flex items-center gap-1">
                                <select value={draft.endMonth ?? ""} onChange={(e) => setDraft((p: any) => ({ ...p, endMonth: e.target.value }))}
                                  className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 bg-white border-solid">
                                  <option value="">—</option>
                                  {MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
                                </select>
                              </div>
                            </div>
                            <EditableField label="Destination (blank = all)" value={draft.destination ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, destination: v }))} />
                            <div>
                              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Active</label>
                              <div className="flex items-center gap-1">
                                <select value={String(draft.isActive)} onChange={(e) => setDraft((p: any) => ({ ...p, isActive: e.target.value === "true" }))}
                                  className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 bg-white border-solid">
                                  <option value="true">Active</option>
                                  <option value="false">Inactive</option>
                                </select>
                              </div>
                            </div>
                            <div className="md:col-start-2 min-w-0">
                              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Description</label>
                              <textarea rows={2} value={draft.description ?? ""} onChange={(e) => setDraft((p: any) => ({ ...p, description: e.target.value }))}
                                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 resize-none border-solid" />
                            </div>
                          </div>
                          <SaveBar saving={saving} error={saveError} onSave={save} onCancel={closeEdit} />
                        </div>
                      </td>
                    </tr>
                  )}
                  {historyId === row.id && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <HistoryPanel entity="NOLSCOPE_PRICING_RULE" entityId={row.id} label={row.seasonName ?? row.ruleName} onClose={() => setHistoryId(null)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-solid border-neutral-300 rounded-xl px-3 py-2 bg-white">
        <span className="text-xs text-slate-500">Showing {sortedRows.length === 0 ? 0 : start + 1}-{Math.min(end, sortedRows.length)} of {sortedRows.length}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Previous</button>
          <span className="text-xs font-semibold text-slate-600">Page {safePage} of {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid">Next</button>
        </div>
      </div>
    </div>
  );
}

// ─── DESTINATIONS TAB ────────────────────────────────────────────────────────

function DestinationsTab() {
  const [rows, setRows]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [draft, setDraft]         = useState<any>(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState("");
  const [filter, setFilter]       = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showAdd, setShowAdd]     = useState(false);
  const [page, setPage]           = useState(1);
  const [sortBy, setSortBy]       = useState<"code" | "name" | "type" | "region" | "acc" | "pop" | "status">("name");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("asc");
  const [newRow, setNewRow]       = useState({
    destinationCode: "", destinationName: "", displayName: "",
    destinationType: "national-park", region: "", nearestCity: "",
    mainAirport: "", accessDifficulty: "moderate",
    accommodationMultiplier: "1.0", popularity: "50", avgStayDays: "",
    description: "",
  });
  const [adding, setAdding] = useState(false);
  const pageSize = 10;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const d = await apiFetch("/api/admin/nolscope/destinations");
      setRows(d.destinations ?? []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const destTypes = [...new Set(rows.map((r) => r.destinationType))].sort();

  const filteredRows = rows.filter((r) => {
    const q = filter.toLowerCase();
    const matchQ = !q || r.destinationName.toLowerCase().includes(q) || r.destinationCode.toLowerCase().includes(q) || r.region?.toLowerCase().includes(q);
    const matchT = !typeFilter || r.destinationType === typeFilter;
    return matchQ && matchT;
  });

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const valueOf = (row: any): string | number => {
      switch (sortBy) {
        case "code": return String(row.destinationCode ?? "").toLowerCase();
        case "name": return String(row.destinationName ?? "").toLowerCase();
        case "type": return String(row.destinationType ?? "").toLowerCase();
        case "region": return String(row.region ?? "").toLowerCase();
        case "acc": return Number(row.accommodationMultiplier ?? 0);
        case "pop": return Number(row.popularity ?? 0);
        case "status": return row.isActive ? 1 : 0;
        default: return "";
      }
    };
    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredRows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const pagedRows = sortedRows.slice(start, end);

  useEffect(() => {
    setPage(1);
  }, [filter, typeFilter, sortBy, sortDir, rows.length]);

  const handleSort = (field: "code" | "name" | "type" | "region" | "acc" | "pop" | "status") => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  };

  const renderSortIcon = (field: "code" | "name" | "type" | "region" | "acc" | "pop" | "status") => {
    if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3.5 h-3.5 text-[#02665e]" />
      : <ChevronDown className="w-3.5 h-3.5 text-[#02665e]" />;
  };

  function openEdit(row: any) { setExpanded(row.id); setDraft({ ...row }); setSaveError(""); }
  function closeEdit() { setExpanded(null); setDraft(null); }

  async function save() {
    if (!draft) return;
    setSaving(true); setSaveError("");
    try {
      const { id, destinationCode, createdAt, updatedAt, ...rest } = draft;
      const d = await apiFetch(`/api/admin/nolscope/destinations/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      setRows((prev) => prev.map((r) => r.id === id ? d.updated : r));
      closeEdit();
    } catch (e: any) { setSaveError(e.message); }
    finally { setSaving(false); }
  }

  async function toggleActive(row: any) {
    try {
      const d = await apiFetch(`/api/admin/nolscope/destinations/${row.id}`, { method: "PUT", body: JSON.stringify({ isActive: !row.isActive }) });
      setRows((prev) => prev.map((r) => r.id === row.id ? d.updated : r));
    } catch {}
  }

  async function addNew() {
    if (!newRow.destinationCode || !newRow.destinationName || !newRow.region) return;
    setAdding(true);
    try {
      const d = await apiFetch("/api/admin/nolscope/destinations", {
        method: "POST",
        body: JSON.stringify({
          ...newRow,
          accommodationMultiplier: Number(newRow.accommodationMultiplier),
          popularity: Number(newRow.popularity),
          avgStayDays: newRow.avgStayDays ? Number(newRow.avgStayDays) : null,
        }),
      });
      setRows((prev) => [...prev, d.created]);
      setShowAdd(false);
      setNewRow({ destinationCode: "", destinationName: "", displayName: "", destinationType: "national-park", region: "", nearestCity: "", mainAirport: "", accessDifficulty: "moderate", accommodationMultiplier: "1.0", popularity: "50", avgStayDays: "", description: "" });
    } catch {}
    finally { setAdding(false); }
  }

  const DEST_TYPES = ["national-park","conservation-area","marine-park","game-reserve","island","city","region","mountain","beach"];

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-[#02665e] mx-auto mt-8" />;
  if (error)   return <p className="text-sm text-red-600 p-4">{error}</p>;

  return (
    <div className="space-y-3">
      {/* filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          placeholder="Search destinations…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[160px] text-sm border border-neutral-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-sm border border-neutral-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid"
        >
          <option value="">All types</option>
          {destTypes.map((t) => <option key={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[#02665e] text-white rounded-xl hover:bg-[#015a52]">
          <Plus className="w-4 h-4" /> Add destination
        </button>
        <button onClick={load} className="p-2 text-slate-400 hover:text-[#02665e] border border-neutral-300 rounded-xl border-solid">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-slate-400">{sortedRows.length} of {rows.length} destinations</p>

      {/* add form */}
      {showAdd && (
        <div className="bg-white border border-solid border-neutral-300 rounded-xl p-4 space-y-3 shadow-sm">
          <h4 className="text-sm font-bold text-neutral-900">New Destination</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <EditableField label="Destination Code (unique, e.g. SERENP)" value={newRow.destinationCode} onChange={(v) => setNewRow((p) => ({ ...p, destinationCode: v.toUpperCase() }))} />
            <EditableField label="Destination Name" value={newRow.destinationName} onChange={(v) => setNewRow((p) => ({ ...p, destinationName: v }))} />
            <EditableField label="Display Name (optional, full name)" value={newRow.displayName} onChange={(v) => setNewRow((p) => ({ ...p, displayName: v }))} />
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Type</label>
              <select value={newRow.destinationType} onChange={(e) => setNewRow((p) => ({ ...p, destinationType: e.target.value }))}
                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                {DEST_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <EditableField label="Region" value={newRow.region} onChange={(v) => setNewRow((p) => ({ ...p, region: v }))} />
            <EditableField label="Nearest City" value={newRow.nearestCity} onChange={(v) => setNewRow((p) => ({ ...p, nearestCity: v }))} />
            <EditableField label="Main Airport" value={newRow.mainAirport} onChange={(v) => setNewRow((p) => ({ ...p, mainAirport: v }))} />
            <div>
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Access Difficulty</label>
              <select value={newRow.accessDifficulty} onChange={(e) => setNewRow((p) => ({ ...p, accessDifficulty: e.target.value }))}
                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                {["easy","moderate","difficult"].map((v) => <option key={v}>{v}</option>)}
              </select>
            </div>
            <EditableField label="Accommodation Multiplier" value={newRow.accommodationMultiplier} type="number" onChange={(v) => setNewRow((p) => ({ ...p, accommodationMultiplier: v }))} />
            <EditableField label="Popularity (0–100)" value={newRow.popularity} type="number" onChange={(v) => setNewRow((p) => ({ ...p, popularity: v }))} />
            <EditableField label="Avg Stay Days" value={newRow.avgStayDays} type="number" onChange={(v) => setNewRow((p) => ({ ...p, avgStayDays: v }))} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Description</label>
            <textarea rows={2} value={newRow.description} onChange={(e) => setNewRow((p) => ({ ...p, description: e.target.value }))}
              className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 resize-none border-solid" />
          </div>
          <div className="flex gap-2">
            <button onClick={addNew} disabled={adding || !newRow.destinationCode || !newRow.destinationName || !newRow.region}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#02665e] text-white rounded-xl disabled:opacity-50">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save destination
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-slate-600 border border-neutral-300 rounded-xl hover:bg-slate-50 border-solid">Cancel</button>
          </div>
        </div>
      )}

      {/* table */}
      <div className="overflow-x-auto rounded-2xl border border-neutral-200 shadow-sm border-solid">
        <table className="w-full text-sm min-w-[700px] border-collapse">
          <thead>
            <tr className="border-0 bg-slate-50 border-b border-neutral-200 text-left border-solid">
              <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("code")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Code {renderSortIcon("code")}
                </button>
              </th>
              <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Name {renderSortIcon("name")}
                </button>
              </th>
              <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("type")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Type {renderSortIcon("type")}
                </button>
              </th>
              <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("region")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Region {renderSortIcon("region")}
                </button>
              </th>
              <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("acc")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Acc.× {renderSortIcon("acc")}
                </button>
              </th>
              <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("pop")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Pop. {renderSortIcon("pop")}
                </button>
              </th>
              <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">
                <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                  Status {renderSortIcon("status")}
                </button>
              </th>
              <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">Actions</th>
            </tr>
          </thead>
          <tbody className="[&>*]:border-0 [&>*]:border-t [&>*]:border-solid [&>*]:border-neutral-200 [&>*:first-child]:border-t-0">
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">No destinations found</td>
              </tr>
            )}
            {pagedRows.map((row) => (
              <React.Fragment key={row.id}>
                <tr className={`group transition-colors  ${!row.isActive ? "opacity-50" : "hover:bg-slate-50/60"}`}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[11px] font-bold text-[#02665e] bg-[#02665e]/8 px-1.5 py-0.5 rounded">{row.destinationCode}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-800 text-xs leading-tight">{row.destinationName}</p>
                    {row.displayName && row.displayName !== row.destinationName && (
                      <p className="text-[10px] text-slate-400 leading-tight">{row.displayName}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">{row.destinationType}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{row.region}</td>
                  <td className="px-4 py-3 text-xs text-slate-700 font-medium">{row.accommodationMultiplier}×</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{row.popularity}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(row)}
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full  ${
                        row.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}>
                      {row.isActive ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                      {row.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => expanded === row.id ? closeEdit() : openEdit(row)}
                        className="p-1.5 text-slate-400 hover:text-[#02665e] hover:bg-[#02665e]/8 rounded-lg transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setHistoryId(historyId === row.id ? null : row.id)}
                        className="p-1.5 text-slate-400 hover:text-[#02665e] hover:bg-[#02665e]/8 rounded-lg transition-colors">
                        <History className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded === row.id && draft && (
                  <tr>
                    <td colSpan={8} className="px-4 py-4 bg-slate-50/80">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <EditableField label="Destination Name" value={draft.destinationName} onChange={(v) => setDraft((p: any) => ({ ...p, destinationName: v }))} />
                        <EditableField label="Display Name" value={draft.displayName ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, displayName: v }))} />
                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Type</label>
                          <select value={draft.destinationType} onChange={(e) => setDraft((p: any) => ({ ...p, destinationType: e.target.value }))}
                            className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                            {DEST_TYPES.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                        <EditableField label="Region" value={draft.region ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, region: v }))} />
                        <EditableField label="Nearest City" value={draft.nearestCity ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, nearestCity: v }))} />
                        <EditableField label="Main Airport" value={draft.mainAirport ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, mainAirport: v }))} />
                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Access Difficulty</label>
                          <select value={draft.accessDifficulty} onChange={(e) => setDraft((p: any) => ({ ...p, accessDifficulty: e.target.value }))}
                            className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 border-solid">
                            {["easy","moderate","difficult"].map((v) => <option key={v}>{v}</option>)}
                          </select>
                        </div>
                        <EditableField label="Accommodation Multiplier" value={draft.accommodationMultiplier} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, accommodationMultiplier: v }))} />
                        <EditableField label="Popularity (0–100)" value={draft.popularity} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, popularity: v }))} />
                        <EditableField label="Avg Stay Days" value={draft.avgStayDays ?? ""} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, avgStayDays: v }))} />
                        <EditableField label="Official Website" value={draft.officialWebsite ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, officialWebsite: v }))} />
                        <EditableField label="Image URL" value={draft.imageUrl ?? ""} onChange={(v) => setDraft((p: any) => ({ ...p, imageUrl: v }))} />
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Description</label>
                          <textarea rows={3} value={draft.description ?? ""} onChange={(e) => setDraft((p: any) => ({ ...p, description: e.target.value }))}
                            className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 resize-none border-solid" />
                        </div>
                      </div>
                      <SaveBar saving={saving} error={saveError} onSave={save} onCancel={closeEdit} />
                    </td>
                  </tr>
                )}
                {historyId === row.id && (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <HistoryPanel entity="NOLSCOPE_DESTINATION" entityId={row.id} label={row.destinationName} onClose={() => setHistoryId(null)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-solid border-neutral-300 rounded-xl px-3 py-2 bg-white">
        <span className="text-xs text-slate-500">
          Showing {sortedRows.length === 0 ? 0 : start + 1}-{Math.min(end, sortedRows.length)} of {sortedRows.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid"
          >
            Previous
          </button>
          <span className="text-xs font-semibold text-slate-600">Page {safePage} of {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TOURISM SITES TAB ────────────────────────────────────────────────────────

function TourismSitesTab() {
  const [rows, setRows]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [search, setSearch]       = useState("");
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [draft, setDraft]         = useState<any>(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newRow, setNewRow]         = useState({ name: "", slug: "", country: "Tanzania", description: "", latitude: "", longitude: "" });
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState("");
  const [deleteId, setDeleteId]     = useState<number | null>(null);
  const [deleting, setDeleting]     = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [page, setPage]             = useState(1);
  const [sortBy, setSortBy]         = useState<"name" | "slug" | "country" | "properties" | "coordinates">("name");
  const [sortDir, setSortDir]       = useState<"asc" | "desc">("asc");
  const pageSize = 10;

  const load = useCallback(() => {
    setLoading(true); setError("");
    apiFetch("/api/admin/nolscope/tourism-sites")
      .then((d) => setRows(d.tourismSites ?? []))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredRows = rows.filter((r) =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.country.toLowerCase().includes(search.toLowerCase())
  );

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const coordValue = (row: any) => {
      if (row.latitude === null || row.latitude === undefined || row.longitude === null || row.longitude === undefined) return "";
      return `${Number(row.latitude).toFixed(4)},${Number(row.longitude).toFixed(4)}`;
    };
    const valueOf = (row: any): string | number => {
      switch (sortBy) {
        case "name": return String(row.name ?? "").toLowerCase();
        case "slug": return String(row.slug ?? "").toLowerCase();
        case "country": return String(row.country ?? "").toLowerCase();
        case "properties": return Number(row.propertyCount ?? 0);
        case "coordinates": return coordValue(row);
        default: return "";
      }
    };
    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredRows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const pagedRows = sortedRows.slice(start, end);

  useEffect(() => {
    setPage(1);
  }, [search, sortBy, sortDir, rows.length]);

  const handleSort = (field: "name" | "slug" | "country" | "properties" | "coordinates") => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  };

  const renderSortIcon = (field: "name" | "slug" | "country" | "properties" | "coordinates") => {
    if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3.5 h-3.5 text-[#02665e]" />
      : <ChevronDown className="w-3.5 h-3.5 text-[#02665e]" />;
  };

  function openEdit(row: any) {
    setExpanded(row.id);
    setDraft({ ...row });
    setSaveError("");
  }
  function closeEdit() { setExpanded(null); setDraft(null); setSaveError(""); }

  async function save() {
    if (!draft) return;
    setSaving(true); setSaveError("");
    const { id, propertyCount, ...rest } = draft;
    try {
      const d = await apiFetch(`/api/admin/nolscope/tourism-sites/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...d.updated } : r));
      closeEdit();
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    setCreating(true); setCreateError("");
    try {
      const payload: any = {
        name:    newRow.name,
        country: newRow.country || "Tanzania",
      };
      if (newRow.slug)        payload.slug        = newRow.slug;
      if (newRow.description) payload.description = newRow.description;
      if (newRow.latitude)    payload.latitude    = parseFloat(newRow.latitude);
      if (newRow.longitude)   payload.longitude   = parseFloat(newRow.longitude);
      const d = await apiFetch("/api/admin/nolscope/tourism-sites", { method: "POST", body: JSON.stringify(payload) });
      setRows((prev) => [...prev, { ...d.created, propertyCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
      setShowCreate(false);
      setNewRow({ name: "", slug: "", country: "Tanzania", description: "", latitude: "", longitude: "" });
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true); setDeleteError("");
    try {
      await apiFetch(`/api/admin/nolscope/tourism-sites/${deleteId}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== deleteId));
      setDeleteId(null);
    } catch (e: any) {
      setDeleteError(e.message);
    } finally {
      setDeleting(false);
    }
  }

  const deleteTarget = rows.find((r) => r.id === deleteId);

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <input
            type="text"
            placeholder="Search by name or country…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm border border-neutral-300 rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 focus:border-[#02665e] border-solid"
          />
          <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <button onClick={load} className="p-2 text-slate-500 hover:text-[#02665e] hover:bg-[#02665e]/8 rounded-xl border border-neutral-300 transition-colors border-solid">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button
          onClick={() => { setShowCreate((v) => !v); setCreateError(""); }}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#02665e] text-white rounded-xl hover:bg-[#015a52] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Tourism Site
        </button>
      </div>

      {/* create form */}
      {showCreate && (
        <div className="bg-white border border-[#02665e]/20 rounded-2xl p-5 shadow-sm border-solid">
          <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#02665e]" /> New Tourism Site
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <EditableField label="Name *" value={newRow.name} onChange={(v) => setNewRow((p) => ({ ...p, name: v }))} />
            <EditableField label="Country" value={newRow.country} onChange={(v) => setNewRow((p) => ({ ...p, country: v }))} />
            <EditableField label="Slug (auto-generated if blank)" value={newRow.slug} onChange={(v) => setNewRow((p) => ({ ...p, slug: v }))} />
            <div />
            <EditableField label="Latitude" value={newRow.latitude} type="number" onChange={(v) => setNewRow((p) => ({ ...p, latitude: v }))} />
            <EditableField label="Longitude" value={newRow.longitude} type="number" onChange={(v) => setNewRow((p) => ({ ...p, longitude: v }))} />
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Description</label>
              <textarea rows={3} value={newRow.description} onChange={(e) => setNewRow((p) => ({ ...p, description: e.target.value }))}
                className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 resize-none border-solid" />
            </div>
          </div>
          {createError && (
            <p className="flex items-center gap-1 text-xs text-red-600 mb-3">
              <AlertTriangle className="w-3.5 h-3.5" /> {createError}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-neutral-300 rounded-lg hover:bg-slate-50 border-solid">Cancel</button>
            <button
              onClick={create}
              disabled={creating || !newRow.name.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#02665e] text-white rounded-lg hover:bg-[#015a52] disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Create
            </button>
          </div>
        </div>
      )}

      {/* delete confirm modal */}
      {deleteId && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Delete Tourism Site</h3>
                <p className="text-xs text-slate-500 mt-0.5">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-slate-700 mb-4">
              Delete <strong>{deleteTarget.name}</strong>?
              {deleteTarget.propertyCount > 0 && (
                <span className="block mt-1 text-amber-600 font-medium">
                  ⚠ {deleteTarget.propertyCount} propert{deleteTarget.propertyCount === 1 ? "y is" : "ies are"} linked — unlink them first.
                </span>
              )}
            </p>
            {deleteError && <p className="text-xs text-red-600 mb-3 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{deleteError}</p>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setDeleteId(null); setDeleteError(""); }} className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-neutral-300 rounded-lg hover:bg-slate-50 border-solid">Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={deleting || deleteTarget.propertyCount > 0}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[#02665e]" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-red-600 py-8 justify-center">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-solid border-neutral-300 overflow-hidden">
          <div className="border-0 px-4 py-3 border-b border-neutral-200 flex items-center justify-between border-solid">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {sortedRows.length} site{sortedRows.length !== 1 ? "s" : ""}
            </span>
          </div>
          <table className="w-full text-sm border-collapse">
            <thead className="border-0 bg-slate-50 border-b border-neutral-200 border-solid">
              <tr>
                <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] text-left">
                  <button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                    Name {renderSortIcon("name")}
                  </button>
                </th>
                <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] text-left">
                  <button type="button" onClick={() => handleSort("slug")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                    Slug {renderSortIcon("slug")}
                  </button>
                </th>
                <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] text-left">
                  <button type="button" onClick={() => handleSort("country")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                    Country {renderSortIcon("country")}
                  </button>
                </th>
                <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] text-left">
                  <button type="button" onClick={() => handleSort("properties")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                    Properties {renderSortIcon("properties")}
                  </button>
                </th>
                <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] text-left">
                  <button type="button" onClick={() => handleSort("coordinates")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-slate-700">
                    Coordinates {renderSortIcon("coordinates")}
                  </button>
                </th>
                <th className="px-4 py-3 text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em]">Actions</th>
              </tr>
            </thead>
            <tbody className="[&>*]:border-0 [&>*]:border-t [&>*]:border-solid [&>*]:border-neutral-200 [&>*:first-child]:border-t-0">
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                    No tourism sites found
                  </td>
                </tr>
              )}
              {pagedRows.map((row) => (
                <React.Fragment key={row.id}>
                  <tr className="group hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800 text-xs leading-tight">{row.name}</p>
                      {row.description && (
                        <p className="text-[10px] text-slate-400 leading-tight line-clamp-1 max-w-[200px]">{row.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[11px] text-[#02665e] bg-[#02665e]/8 px-1.5 py-0.5 rounded">{row.slug}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{row.country}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full  ${
                        row.propertyCount > 0
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200 border-solid"
                          : "bg-slate-100 text-slate-500"
                      }`}>
                        {row.propertyCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">
                      {row.latitude && row.longitude
                        ? `${Number(row.latitude).toFixed(4)}, ${Number(row.longitude).toFixed(4)}`
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => expanded === row.id ? closeEdit() : openEdit(row)}
                          className="p-1.5 text-slate-400 hover:text-[#02665e] hover:bg-[#02665e]/8 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { setDeleteId(row.id); setDeleteError(""); }}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === row.id && draft && (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 bg-slate-50/80">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <EditableField label="Name *" value={draft.name} onChange={(v) => setDraft((p: any) => ({ ...p, name: v }))} />
                          <EditableField label="Country" value={draft.country} onChange={(v) => setDraft((p: any) => ({ ...p, country: v }))} />
                          <EditableField label="Slug" value={draft.slug} onChange={(v) => setDraft((p: any) => ({ ...p, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} />
                          <div />
                          <EditableField label="Latitude" value={draft.latitude ?? ""} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, latitude: v === "" ? null : v }))} />
                          <EditableField label="Longitude" value={draft.longitude ?? ""} type="number" onChange={(v) => setDraft((p: any) => ({ ...p, longitude: v === "" ? null : v }))} />
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-[0.12em] mb-1">Description</label>
                            <textarea rows={3} value={draft.description ?? ""} onChange={(e) => setDraft((p: any) => ({ ...p, description: e.target.value }))}
                              className="w-full text-sm border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 resize-none border-solid" />
                          </div>
                        </div>
                        <SaveBar saving={saving} error={saveError} onSave={save} onCancel={closeEdit} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <div className="border-0 px-4 py-3 border-t border-neutral-200 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-solid">
            <span className="text-xs text-slate-500">
              Showing {sortedRows.length === 0 ? 0 : start + 1}-{Math.min(end, sortedRows.length)} of {sortedRows.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid"
              >
                Previous
              </button>
              <span className="text-xs font-semibold text-slate-600">Page {safePage} of {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-neutral-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border-solid"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ROOT component ───────────────────────────────────────────────────────────

type SectionCount = { total: number; active: number } | null;

type EstimateStats = {
  totalEstimates: number;
  convertedToBooking: number;
  conversionRate: number;
  avgTotalCost: number | null;
  topDestinations: Array<{ destination: string; count: number }>;
};

/** Where each tab's records live, and the key the list comes back under. */
const SECTION_SOURCES: Record<Tab, { path: string; key: string }> = {
  "destinations":  { path: "/api/admin/nolscope/destinations",     key: "destinations" },
  "tourism-sites": { path: "/api/admin/nolscope/tourism-sites",    key: "tourismSites" },
  "activities":    { path: "/api/admin/nolscope/activities",       key: "activities" },
  "park-fees":     { path: "/api/admin/nolscope/park-fees",        key: "parkFees" },
  "visa-fees":     { path: "/api/admin/nolscope/visa-fees",        key: "visaFees" },
  "transport":     { path: "/api/admin/nolscope/transport-routes", key: "routes" },
  "seasonal":      { path: "/api/admin/nolscope/pricing-rules",    key: "pricingRules" },
};

export default function NolScopeAdminClient() {
  const [tab, setTab] = useState<Tab>("destinations");
  const [counts, setCounts] = useState<Partial<Record<Tab, SectionCount>>>({});
  const [stats, setStats] = useState<EstimateStats | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // One pass over every section for the tab counts, plus estimator usage for
  // the header. Each tab still loads and owns its own data when opened.
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    const entries = await Promise.all(
      (Object.keys(SECTION_SOURCES) as Tab[]).map(async (id) => {
        try {
          const data = await apiFetch(SECTION_SOURCES[id].path);
          const rows: any[] = Array.isArray(data?.[SECTION_SOURCES[id].key]) ? data[SECTION_SOURCES[id].key] : [];
          const active = rows.filter((r) => r?.isActive !== false).length;
          return [id, { total: rows.length, active }] as const;
        } catch {
          return [id, null] as const;
        }
      }),
    );
    setCounts(Object.fromEntries(entries));
    try {
      setStats(await apiFetch("/api/admin/nolscope/estimates/stats"));
    } catch {
      setStats(null);
    }
    setSummaryLoading(false);
  }, []);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const totalRecords = Object.values(counts).reduce((sum, c) => sum + (c?.total ?? 0), 0);
  const inactiveRecords = Object.values(counts).reduce((sum, c) => sum + (c ? c.total - c.active : 0), 0);
  const topDestination = stats?.topDestinations?.[0];

  const facts = [
    {
      label: "Estimates made",
      value: stats ? stats.totalEstimates.toLocaleString() : summaryLoading ? "..." : "Unavailable",
      detail: stats ? `${stats.convertedToBooking.toLocaleString()} became bookings` : "trip estimates by travellers",
      tone: "text-white",
    },
    {
      label: "Conversion",
      value: stats ? `${stats.conversionRate}%` : summaryLoading ? "..." : "Unavailable",
      detail: "estimates that turned into a booking",
      tone: stats && stats.conversionRate > 0 ? "text-emerald-300" : "text-white",
    },
    {
      label: "Average trip",
      value: stats?.avgTotalCost != null ? fmtUSD(stats.avgTotalCost) : summaryLoading ? "..." : "None yet",
      detail: topDestination ? `Most estimated: ${topDestination.destination}` : "per estimate, in USD",
      tone: "text-white",
    },
    {
      label: "Rate records",
      value: summaryLoading && !totalRecords ? "..." : totalRecords.toLocaleString(),
      detail: inactiveRecords ? `${inactiveRecords} switched off, left out of estimates` : "all active in estimates",
      tone: inactiveRecords ? "text-amber-300" : "text-white",
    },
  ];

  return (
    <div id="nolscope-admin" className="w-full min-w-0 space-y-5">
      {/* With preflight off a bare "border" class draws nothing; give the full-border
          controls in this workspace a solid style. One-sided borders (border-t etc.)
          do not carry the bare "border" token, so they are untouched. */}
      <style>{`
        #nolscope-admin :is(input, select, textarea, button)[class~="border"] { border-style: solid; }
        #nolscope-admin :is(input, select, textarea) { box-sizing: border-box; }
      `}</style>

      {/* Header: what the estimator is doing, and the rate sections as tabs */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">NoLScope estimator</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Rate manager</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">The costs NoLScope uses to price trips. Every change applies to the next estimate a traveller makes.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-emerald-400/30 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-200">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
                Edits go live immediately
              </span>
              <button type="button" onClick={() => void loadSummary()} disabled={summaryLoading} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-white/15 bg-white/[0.06] text-white/85 transition-colors hover:bg-white/[0.12] disabled:opacity-60" aria-label="Refresh summary" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${summaryLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Rate sections">
            {TABS.map(({ id, label, Icon }) => {
              const c = counts[id];
              const selected = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(id)}
                  className={`relative inline-flex h-11 shrink-0 items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${selected ? "text-white" : "text-white/50 hover:text-white/80"}`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {c && (
                    <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${selected ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/60"}`} title={c.total - c.active ? `${c.active} active of ${c.total}` : `${c.total} records`}>
                      {c.total - c.active ? `${c.active}/${c.total}` : c.total}
                    </span>
                  )}
                  {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400" aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Guidance, kept short and next to the data it is about */}
      <div className="flex items-start gap-2.5 rounded-xl border border-solid border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-900">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span>Check rates against the official source before saving. Switching a record off removes it from every future estimate; it is not deleted.</span>
      </div>

      {/* Active section */}
      <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-4 shadow-sm sm:p-5">
        {tab === "destinations"  && <DestinationsTab  />}
        {tab === "tourism-sites" && <TourismSitesTab  />}
        {tab === "activities"    && <ActivitiesTab    />}
        {tab === "park-fees"     && <ParkFeesTab      />}
        {tab === "visa-fees"     && <VisaFeesTab      />}
        {tab === "transport"     && <TransportTab     />}
        {tab === "seasonal"      && <SeasonalTab      />}
      </section>
    </div>
  );
}
