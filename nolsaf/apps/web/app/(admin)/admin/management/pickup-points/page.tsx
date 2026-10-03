"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  LockOpen,
  MapPin,
  Pencil,
  Plane,
  Plus,
  RefreshCw,
  Search,
  Ship,
  ShieldCheck,
  TrainFront,
  Trash2,
  X,
} from "lucide-react";

const api = axios.create({ baseURL: "" });

type Category = "airport" | "bus_terminal" | "ferry_port" | "train_station";
type ArrivalType = "FLIGHT" | "BUS" | "TRAIN" | "FERRY" | "OTHER";

interface PickupPoint {
  id: number;
  code: string;
  name: string;
  shortLabel: string;
  city: string;
  category: Category;
  arrivalType: ArrivalType;
  latitude: number;
  longitude: number;
  iataCode: string | null;
  verified: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES: Array<{ key: Category; label: string; plural: string; icon: typeof Plane; arrival: ArrivalType; text: string; bar: string; soft: string }> = [
  { key: "airport", label: "Airport", plural: "Airports", icon: Plane, arrival: "FLIGHT", text: "text-sky-700", bar: "bg-sky-500", soft: "bg-sky-50/70" },
  { key: "bus_terminal", label: "Bus terminal", plural: "Bus terminals", icon: Bus, arrival: "BUS", text: "text-emerald-700", bar: "bg-emerald-500", soft: "bg-emerald-50/70" },
  { key: "ferry_port", label: "Ferry port", plural: "Ferry ports", icon: Ship, arrival: "FERRY", text: "text-indigo-700", bar: "bg-indigo-500", soft: "bg-indigo-50/70" },
  { key: "train_station", label: "Train station", plural: "Train stations", icon: TrainFront, arrival: "TRAIN", text: "text-amber-700", bar: "bg-amber-400", soft: "bg-amber-50/70" },
];
const categoryMeta = (c: Category) => CATEGORIES.find((x) => x.key === c)!;

const EMPTY_FORM = {
  code: "",
  name: "",
  shortLabel: "",
  city: "",
  category: "bus_terminal" as Category,
  arrivalType: "BUS" as ArrivalType,
  latitude: "",
  longitude: "",
  iataCode: "",
  verified: false,
  isActive: true,
};

type Status = "all" | "unverified" | "verified" | "locked";
const PAGE_SIZE = 12;

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";
const fieldClass =
  "box-border h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 disabled:bg-neutral-50 disabled:text-neutral-500";
const sectionLabel = "m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400";

/** Rough service area: mainland Tanzania plus Zanzibar and Mafia. */
const TZ_BOUNDS = { minLat: -11.8, maxLat: -0.9, minLng: 29.2, maxLng: 40.6 };

/** Plain-language problems with a coordinate pair, or null when it looks right. */
function coordinateProblem(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const inside = (a: number, b: number) => a >= TZ_BOUNDS.minLat && a <= TZ_BOUNDS.maxLat && b >= TZ_BOUNDS.minLng && b <= TZ_BOUNDS.maxLng;
  if (inside(lat, lng)) return null;
  if (inside(lng, lat)) return "Latitude and longitude look swapped.";
  if (lat > 0 && inside(-lat, lng)) return "Latitude should be negative (south of the equator).";
  return "This pin is outside Tanzania.";
}

function mapsUrl(lat: number | string, lng: number | string) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function errorText(err: any, fallback: string) {
  return err?.response?.data?.error || err?.response?.data?.message || fallback;
}

export default function PickupPointsAdminPage() {
  const [items, setItems] = useState<PickupPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [status, setStatus] = useState<Status>("all");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PickupPoint | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/api/admin/pickup-points", { withCredentials: true });
      setItems(res.data.items || []);
    } catch {
      setError("Could not load pickup points.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!modalOpen && !deleteTarget) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleteTarget && !deleting) setDeleteTarget(null);
      else if (modalOpen && !saving) setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, deleteTarget, saving, deleting]);

  const flash = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess((current) => (current === message ? null : current)), 4000);
  };

  const verifiedCount = items.filter((p) => p.verified).length;
  const unverifiedCount = items.length - verifiedCount;
  const lockedCount = items.filter((p) => !p.isActive).length;
  const suspectCount = items.filter((p) => coordinateProblem(p.latitude, p.longitude)).length;
  const cities = new Set(items.map((p) => p.city.trim().toLowerCase()).filter(Boolean)).size;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      if (category && p.category !== category) return false;
      if (status === "unverified" && p.verified) return false;
      if (status === "verified" && !p.verified) return false;
      if (status === "locked" && p.isActive) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.city.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.iataCode?.toLowerCase().includes(q) ?? false);
    });
  }, [items, query, category, status]);

  useEffect(() => {
    setPage(1);
  }, [query, category, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(p: PickupPoint) {
    setEditingId(p.id);
    setForm({
      code: p.code,
      name: p.name,
      shortLabel: p.shortLabel,
      city: p.city,
      category: p.category,
      arrivalType: p.arrivalType,
      latitude: String(p.latitude),
      longitude: String(p.longitude),
      iataCode: p.iataCode || "",
      verified: p.verified,
      isActive: p.isActive,
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function save() {
    setFormError(null);
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.name.trim()) return setFormError("Name is required.");
    if (!form.city.trim()) return setFormError("City is required.");
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return setFormError("Latitude must be between -90 and 90.");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return setFormError("Longitude must be between -180 and 180.");

    const payload = {
      code: form.code.trim() || undefined,
      name: form.name.trim(),
      shortLabel: form.shortLabel.trim() || form.name.trim(),
      city: form.city.trim(),
      category: form.category,
      arrivalType: form.arrivalType,
      latitude: lat,
      longitude: lng,
      iataCode: form.iataCode.trim() || null,
      verified: form.verified,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      if (editingId) await api.put(`/api/admin/pickup-points/${editingId}`, payload, { withCredentials: true });
      else await api.post("/api/admin/pickup-points", payload, { withCredentials: true });
      setModalOpen(false);
      flash(editingId ? `${payload.name} saved.` : `${payload.name} added.`);
      await load();
    } catch (err: any) {
      setFormError(errorText(err, "Could not save. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/admin/pickup-points/${deleteTarget.id}`, { withCredentials: true });
      flash(`${deleteTarget.name} deleted.`);
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      setDeleteTarget(null);
      setError(errorText(err, "Could not delete this pickup point."));
    } finally {
      setDeleting(false);
    }
  }

  async function patch(p: PickupPoint, body: Partial<PickupPoint>, message: string) {
    setBusyId(p.id);
    try {
      await api.put(`/api/admin/pickup-points/${p.id}`, body, { withCredentials: true });
      flash(message);
      await load();
    } catch (err: any) {
      setError(errorText(err, "Could not update this pickup point."));
    } finally {
      setBusyId(null);
    }
  }

  // Lock takes a pickup offline (isActive = false) when an area is hard to
  // operate; unlocking restores it. Locked points never reach the app.
  const toggleActive = (p: PickupPoint) => patch(p, { isActive: !p.isActive }, p.isActive ? `${p.name} is offline.` : `${p.name} is back online.`);
  const toggleVerified = (p: PickupPoint) => patch(p, { verified: !p.verified }, p.verified ? `${p.name} marked approximate.` : `${p.name} marked verified.`);

  const verifiedShare = items.length ? Math.round((verifiedCount / items.length) * 100) : 0;
  const facts = [
    { label: "Pickup points", value: loading && !items.length ? "..." : String(items.length), detail: `across ${cities} ${cities === 1 ? "city" : "cities"}`, tone: "text-white" },
    { label: "Verified", value: loading && !items.length ? "..." : `${verifiedShare}%`, detail: `${verifiedCount} pinned exactly`, tone: verifiedShare === 100 ? "text-emerald-300" : "text-white" },
    { label: "Needs verifying", value: loading && !items.length ? "..." : String(unverifiedCount), detail: unverifiedCount ? "approximate coordinates" : "every pin is exact", tone: unverifiedCount ? "text-amber-300" : "text-white" },
    { label: "Offline", value: loading && !items.length ? "..." : String(lockedCount), detail: lockedCount ? "locked, hidden from the app" : "all live in the app", tone: lockedCount ? "text-rose-300" : "text-white" },
  ];

  const formLat = Number(form.latitude);
  const formLng = Number(form.longitude);
  const formHasPin = form.latitude.trim() !== "" && form.longitude.trim() !== "" && Number.isFinite(formLat) && Number.isFinite(formLng);
  const formProblem = formHasPin ? coordinateProblem(formLat, formLng) : null;

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Transport</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Pickup points</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Airports, bus terminals, ferry ports and train stations where drivers collect travellers. Drivers navigate to these exact coordinates.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={openCreate} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-emerald-400 px-3 text-xs font-semibold text-[#0b2420] transition-colors hover:bg-emerald-300">
                <Plus className="h-3.5 w-3.5" /> Add pickup point
              </button>
              <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
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
          {items.length > 0 && (
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10" title={`${verifiedShare}% verified`}>
              <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${verifiedShare}%` }} />
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{success}</span>
          <button type="button" onClick={() => setSuccess(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}
      {(unverifiedCount > 0 || suspectCount > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-solid border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1">
            {unverifiedCount > 0 && <>{unverifiedCount} {unverifiedCount === 1 ? "point carries" : "points carry"} approximate coordinates. Open each, pin the exact spot, then mark it verified.</>}
            {suspectCount > 0 && <> {suspectCount} {suspectCount === 1 ? "pin looks" : "pins look"} wrong (outside Tanzania or swapped).</>}
          </span>
          {unverifiedCount > 0 && status !== "unverified" && (
            <button type="button" onClick={() => { setStatus("unverified"); setCategory(null); }} className="inline-flex h-8 items-center rounded-lg border border-solid border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-50">
              Show them
            </button>
          )}
        </div>
      )}

      {/* Categories, doubling as a filter */}
      <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const inCat = items.filter((p) => p.category === c.key);
            const done = inCat.filter((p) => p.verified).length;
            const share = inCat.length ? Math.round((done / inCat.length) * 100) : 0;
            const selected = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(selected ? null : c.key)}
                aria-pressed={selected}
                className={`min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${selected ? `border-neutral-900 ${c.soft}` : "border-transparent bg-neutral-50 ring-1 ring-inset ring-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${c.text}`}><Icon className="h-3.5 w-3.5" /> {c.plural}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{share}% verified</span>
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{loading && !items.length ? "..." : inCat.length}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{inCat.length ? `${done} exact · ${inCat.length - done} approximate` : "None yet"}</span>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <span className={`block h-full rounded-full ${c.bar}`} style={{ width: `${inCat.length ? Math.max(share, 4) : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Directory */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{category ? categoryMeta(category).plural : "All pickup points"}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading..." : `${filtered.length} ${filtered.length === 1 ? "point" : "points"}`}</p>
          </div>
          <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" role="group" aria-label="Status">
            {([["all", "All"], ["unverified", "Needs verifying"], ["verified", "Verified"], ["locked", "Offline"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setStatus(key)} aria-pressed={status === key} className={`inline-flex h-8 items-center rounded-md border-0 px-2.5 text-xs font-semibold transition-colors ${status === key ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-300" : "bg-transparent text-neutral-500 hover:text-neutral-900"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full min-w-0 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, city, code or IATA" aria-label="Search pickup points" className={`${fieldClass} pl-9 pr-9`} />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading pickup points</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-5 sm:px-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><MapPin className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-neutral-900">{items.length ? "No pickup points match" : "No pickup points yet"}</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">{items.length ? "Try another search or clear the filters." : "Add the first airport or terminal drivers collect travellers from."}</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left text-sm">
              <thead>
                <tr className="text-[11px] text-neutral-400">
                  <th className="px-4 py-2.5 font-semibold sm:px-5">Pickup point</th>
                  <th className="w-56 px-3 py-2.5 font-semibold">Coordinates</th>
                  <th className="w-40 px-3 py-2.5 font-semibold">Status</th>
                  <th className="w-[260px] px-4 py-2.5 text-right font-semibold sm:px-5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => {
                  const meta = categoryMeta(p.category);
                  const Icon = meta.icon;
                  const problem = coordinateProblem(p.latitude, p.longitude);
                  const busy = busyId === p.id;
                  return (
                    <tr key={p.id} className={`border-0 border-t border-solid border-neutral-200 transition-colors hover:bg-neutral-50/80 ${p.isActive ? "" : "bg-neutral-50/70"}`}>
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex items-center gap-3">
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${p.isActive ? `${meta.soft} ${meta.text}` : "bg-neutral-200 text-neutral-500"}`}><Icon className="h-4 w-4" /></span>
                          <div className="min-w-0">
                            <div className={`truncate font-semibold ${p.isActive ? "text-neutral-900" : "text-neutral-500"}`}>{p.name}</div>
                            <div className="truncate text-xs text-neutral-400">
                              {meta.label} · {p.city} · <span className="font-mono">{p.code}</span>
                              {p.iataCode ? <> · <span className="font-semibold text-neutral-600">{p.iataCode}</span></> : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <a href={mapsUrl(p.latitude, p.longitude)} target="_blank" rel="noreferrer" title="Open in Google Maps" className="inline-flex items-center gap-1.5 font-mono text-xs text-neutral-700 no-underline hover:text-emerald-700">
                          <MapPin className="h-3.5 w-3.5 text-neutral-400" /> {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)} <ExternalLink className="h-3 w-3 text-neutral-400" />
                        </a>
                        {problem && <div className="mt-0.5 text-[11px] font-semibold text-rose-600">{problem}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${p.verified ? "text-emerald-700" : "text-amber-700"}`}>
                            {p.verified ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                            {p.verified ? "Verified" : "Approximate"}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 text-[11px] ${p.isActive ? "text-neutral-500" : "font-semibold text-rose-600"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${p.isActive ? "bg-emerald-500" : "bg-rose-500"}`} /> {p.isActive ? "Live in app" : "Offline"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button type="button" onClick={() => void toggleVerified(p)} disabled={busy} className={`inline-flex h-8 items-center gap-1 rounded-lg border border-solid px-2.5 text-xs font-semibold transition-colors disabled:opacity-50 ${p.verified ? "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50" : "border-transparent bg-[#0b2420] text-white hover:bg-[#12342f]"}`}>
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : p.verified ? null : <ShieldCheck className="h-3.5 w-3.5" />}
                            {p.verified ? "Unverify" : "Verify"}
                          </button>
                          <button type="button" onClick={() => void toggleActive(p)} disabled={busy} title={p.isActive ? "Take offline" : "Bring back online"} aria-label={p.isActive ? `Take ${p.name} offline` : `Bring ${p.name} back online`} className={`grid h-8 w-8 place-items-center rounded-lg border border-solid transition-colors disabled:opacity-50 ${p.isActive ? "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900" : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}>
                            {p.isActive ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                          </button>
                          <button type="button" onClick={() => openEdit(p)} title="Edit" aria-label={`Edit ${p.name}`} className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-900">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(p)} title="Delete" aria-label={`Delete ${p.name}`} className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-4 py-3 sm:px-5">
            <span className="text-xs text-neutral-500">Showing <span className="font-semibold tabular-nums text-neutral-900">{(safePage - 1) * PAGE_SIZE + 1} to {Math.min(safePage * PAGE_SIZE, filtered.length)}</span> of <span className="font-semibold tabular-nums text-neutral-900">{filtered.length}</span></span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={safePage <= 1} className="inline-flex h-8 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Previous</button>
              <span className="text-xs tabular-nums text-neutral-500">Page <span className="font-semibold text-neutral-900">{safePage}</span> of <span className="font-semibold text-neutral-900">{totalPages}</span></span>
              <button type="button" onClick={() => setPage((n) => Math.min(totalPages, n + 1))} disabled={safePage >= totalPages} className="inline-flex h-8 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </section>

      {/* Add / edit dialog */}
      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={editingId ? "Edit pickup point" : "Add pickup point"} onClick={() => !saving && setModalOpen(false)}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-3.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><MapPin className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-sm font-bold text-neutral-900">{editingId ? `Edit ${form.name || "pickup point"}` : "Add pickup point"}</h2>
                <p className="m-0 text-xs text-neutral-400">Drivers navigate to these coordinates. Keep them exact.</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} disabled={saving} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {formError && (
                <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="flex-1">{formError}</span>
                </div>
              )}

              <div className="px-5 py-4">
                <p className={sectionLabel}>Type</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Category">
                  {CATEGORIES.map((c) => {
                    const Icon = c.icon;
                    const selected = form.category === c.key;
                    return (
                      <button key={c.key} type="button" role="radio" aria-checked={selected} onClick={() => setForm({ ...form, category: c.key, arrivalType: c.arrival })} className={`flex items-center gap-2 rounded-lg border border-solid px-3 py-2.5 text-left text-xs font-semibold transition-colors ${selected ? `border-neutral-900 ${c.soft} ${c.text}` : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>
                        <Icon className="h-4 w-4 shrink-0" /> {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 border-0 border-t border-solid border-neutral-200 px-5 py-4">
                <label className="block">
                  <span className={sectionLabel}>Name</span>
                  <input className={`${fieldClass} mt-1.5 h-10 font-semibold`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="John Magufuli Bus Terminal (Mbezi)" />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className={sectionLabel}>Short label</span>
                    <input className={`${fieldClass} mt-1.5`} value={form.shortLabel} onChange={(e) => setForm({ ...form, shortLabel: e.target.value })} placeholder="Magufuli, Dar es Salaam" />
                  </label>
                  <label className="block min-w-0">
                    <span className={sectionLabel}>City or area</span>
                    <input className={`${fieldClass} mt-1.5`} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Dar es Salaam" />
                  </label>
                </div>
              </div>

              <div className="border-0 border-t border-solid border-neutral-200 px-5 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className={sectionLabel}>Exact location</p>
                  {formHasPin && (
                    <a href={mapsUrl(form.latitude, form.longitude)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 no-underline hover:underline">
                      Check the pin on Google Maps <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="text-[11px] text-neutral-500">Latitude</span>
                    <input className={`${fieldClass} mt-1 font-mono ${formProblem ? "border-rose-300" : ""}`} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="-6.78463" inputMode="decimal" />
                  </label>
                  <label className="block min-w-0">
                    <span className="text-[11px] text-neutral-500">Longitude</span>
                    <input className={`${fieldClass} mt-1 font-mono ${formProblem ? "border-rose-300" : ""}`} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="39.10892" inputMode="decimal" />
                  </label>
                </div>
                {formProblem ? (
                  <p className="m-0 mt-2 flex items-center gap-1.5 text-xs font-semibold text-rose-600"><AlertTriangle className="h-3.5 w-3.5" /> {formProblem}</p>
                ) : formHasPin ? (
                  <p className="m-0 mt-2 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Inside Tanzania. Open the map to confirm the exact entrance.</p>
                ) : (
                  <p className="m-0 mt-2 text-xs text-neutral-400">Right-click the spot in Google Maps and copy the numbers it shows.</p>
                )}
              </div>

              <div className="grid grid-cols-1 border-0 border-t border-solid border-neutral-200 sm:grid-cols-3">
                <label className="block min-w-0 px-5 py-4">
                  <span className={sectionLabel}>Arrival type</span>
                  <select className={`${fieldClass} mt-1.5`} value={form.arrivalType} onChange={(e) => setForm({ ...form, arrivalType: e.target.value as ArrivalType })}>
                    <option value="FLIGHT">Flight</option>
                    <option value="BUS">Bus</option>
                    <option value="TRAIN">Train</option>
                    <option value="FERRY">Ferry</option>
                    <option value="OTHER">Other</option>
                  </select>
                </label>
                <label className="block min-w-0 border-0 border-t border-solid border-neutral-200 px-5 py-4 sm:border-l sm:border-t-0">
                  <span className={sectionLabel}>IATA code</span>
                  <input className={`${fieldClass} mt-1.5 font-mono uppercase`} value={form.iataCode} onChange={(e) => setForm({ ...form, iataCode: e.target.value.toUpperCase() })} placeholder={form.category === "airport" ? "DAR" : "Airports only"} maxLength={8} />
                </label>
                <label className="block min-w-0 border-0 border-t border-solid border-neutral-200 px-5 py-4 sm:border-l sm:border-t-0">
                  <span className={sectionLabel}>Code</span>
                  <input className={`${fieldClass} mt-1.5 font-mono`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Made from the name" disabled={!!editingId} />
                </label>
              </div>

              <div className="grid grid-cols-1 border-0 border-t border-solid border-neutral-200 sm:grid-cols-2">
                {([
                  ["verified", "Coordinates verified", "You have checked the pin on a map.", ShieldCheck],
                  ["isActive", "Live in the app", "Travellers can choose it and drivers see it.", LockOpen],
                ] as const).map(([key, label, hint, Icon], i) => {
                  const on = Boolean(form[key]);
                  return (
                    <button key={key} type="button" role="switch" aria-checked={on} onClick={() => setForm({ ...form, [key]: !on })} className={`flex items-center gap-3 border-0 bg-white px-5 py-4 text-left hover:bg-neutral-50 ${i ? "border-t border-solid border-neutral-200 sm:border-l sm:border-t-0" : ""}`}>
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${on ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-400"}`}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-neutral-900">{label}</span>
                        <span className="block text-[11px] text-neutral-500">{hint}</span>
                      </span>
                      <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${on ? "bg-[#02665e]" : "bg-neutral-300"}`}>
                        <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              {formProblem && <span className="mr-auto text-xs font-semibold text-rose-600">Check the coordinates before saving.</span>}
              <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#12342f] disabled:opacity-50">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingId ? "Save changes" : "Add pickup point"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm delete" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 px-5 py-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600"><Trash2 className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-bold text-neutral-900">Delete {deleteTarget.name}?</h2>
                <p className="m-0 mt-1 text-xs leading-5 text-neutral-500">Travellers can no longer choose it. To pause it for a while, take it offline instead. This cannot be undone.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
              {deleteTarget.isActive && (
                <button type="button" onClick={() => { const p = deleteTarget; setDeleteTarget(null); void toggleActive(p); }} disabled={deleting} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                  <Lock className="h-3.5 w-3.5" /> Take offline
                </button>
              )}
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
