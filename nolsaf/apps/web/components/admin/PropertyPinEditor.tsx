"use client";

/**
 * Admin tool to verify and correct a property's map pin.
 *
 * Drag the map so the centre pin sits on the building, or search the address.
 * It compares the saved pin with the property's declared address, so a pin
 * dropped in the wrong region (e.g. a Dar es Salaam hotel pinned near Kahama)
 * is flagged before anyone books a ride to it.
 *
 * Saving goes through PATCH /api/admin/properties/:id, which requires a reason
 * and records old/new coordinates in the audit history.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Crosshair, ExternalLink, Loader2, MapPin, RotateCcw, Save, Search, X } from "lucide-react";

export type PinAddress = {
  street?: string | null;
  ward?: string | null;
  district?: string | null;
  regionName?: string | null;
  city?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  propertyTitle: string;
  address: PinAddress;
  latitude: number | null;
  longitude: number | null;
  saving?: boolean;
  onSave: (next: { latitude: number; longitude: number; reason: string }) => Promise<void> | void;
};

type Geo = { lat: number; lng: number; label: string };

/** Beyond this, a saved pin is almost certainly not at the declared address. */
export const PIN_MISMATCH_KM = 25;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function tidy(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function addressLine(address: PinAddress): string {
  const seen = new Set<string>();
  return [address.street, address.ward, address.district, address.regionName || address.city]
    .map(tidy)
    .filter((p) => {
      const k = p.toLowerCase().replace(/[^a-z]/g, "");
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(", ");
}

function fmtKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

function validCoord(lat: unknown, lng: unknown): lat is number {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180 && !(a === 0 && b === 0);
}

/** Forward geocode through our API (Tanzania only), most precise first. */
export async function geocodeTz(query: string, limit = 5): Promise<Geo[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const resp = await fetch("/api/geocoding/public/forward", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, country: "TZ", limit }),
    });
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => null);
    const features: any[] = Array.isArray(data?.features) ? data.features : [];
    return features
      .map((f) => {
        const c = f?.coordinates;
        const lng = Array.isArray(c) ? Number(c[0]) : NaN;
        const lat = Array.isArray(c) ? Number(c[1]) : NaN;
        return { lat, lng, label: String(f?.placeName || f?.text || q) };
      })
      .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lng));
  } catch {
    return [];
  }
}

const REASONS = [
  "Pin was in the wrong region",
  "Moved pin to the building entrance",
  "Owner reported the wrong location",
  "Verified during site inspection",
];

export default function PropertyPinEditor({ open, onClose, propertyTitle, address, latitude, longitude, saving, onSave }: Props) {
  const saved = validCoord(latitude, longitude) ? { lat: Number(latitude), lng: Number(longitude) } : null;
  const addr = useMemo(() => addressLine(address), [address]);

  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(saved);
  const [declared, setDeclared] = useState<Geo | null>(null);
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState(addr);
  const [results, setResults] = useState<Geo[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [latText, setLatText] = useState(saved ? saved.lat.toFixed(6) : "");
  const [lngText, setLngText] = useState(saved ? saved.lng.toFixed(6) : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const savedMarkerRef = useRef<any>(null);
  const addressMarkerRef = useRef<any>(null);

  // Reset when reopened
  useEffect(() => {
    if (!open) return;
    setPin(saved);
    setLatText(saved ? saved.lat.toFixed(6) : "");
    setLngText(saved ? saved.lng.toFixed(6) : "");
    setQuery(addr);
    setResults([]);
    setReason("");
    setError(null);
    setSearchNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Where the declared address actually is, to judge the saved pin
  useEffect(() => {
    if (!open || !addr) return;
    let alive = true;
    setChecking(true);
    void (async () => {
      // Try the full address first, then broaden to district/region
      const attempts = [addr, addressLine({ district: address.district, regionName: address.regionName || address.city })];
      for (const q of attempts) {
        const hits = await geocodeTz(`${q}, Tanzania`, 1);
        if (!alive) return;
        if (hits[0]) {
          setDeclared(hits[0]);
          break;
        }
      }
      if (alive) setChecking(false);
    })();
    return () => {
      alive = false;
    };
  }, [open, addr, address.district, address.regionName, address.city]);

  // Map: created once per open, pin = map centre
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const el = containerRef.current;
    if (!el) return;

    void (async () => {
      try {
        let token =
          (process.env.NEXT_PUBLIC_MAPBOX_TOKEN as string) || (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN as string) || "";
        if (!token) {
          const r = await fetch("/config/map-token", { cache: "no-store" }).catch(() => null);
          const j = r && r.ok ? await r.json().catch(() => null) : null;
          token = String(j?.token || "");
        }
        if (!token) {
          setMapError("Map token is not configured. You can still search the address or type coordinates.");
          return;
        }
        const mod = await import("mapbox-gl");
        if (disposed) return;
        const mapboxgl = (mod as any).default ?? mod;
        mapboxgl.accessToken = token;
        const start = saved ?? { lat: -6.7924, lng: 39.2083 };
        const map = new mapboxgl.Map({
          container: el,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [start.lng, start.lat],
          zoom: saved ? 15 : 11,
          attributionControl: false,
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
        map.dragRotate?.disable?.();
        map.touchZoomRotate?.disableRotation?.();
        map.on("load", () => !disposed && setMapReady(true));
        map.on("moveend", () => {
          const c = map.getCenter();
          const next = { lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) };
          setPin(next);
          setLatText(next.lat.toFixed(6));
          setLngText(next.lng.toFixed(6));
        });
        mapRef.current = map;

        // Grey marker: where the pin is saved today
        if (saved) {
          const dot = document.createElement("div");
          dot.title = "Saved pin";
          dot.style.cssText = "width:14px;height:14px;border-radius:9999px;background:#94a3b8;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)";
          savedMarkerRef.current = new mapboxgl.Marker({ element: dot }).setLngLat([saved.lng, saved.lat]).addTo(map);
        }
      } catch (e: any) {
        if (!disposed) setMapError(e?.message || "Unable to load the map.");
      }
    })();

    return () => {
      disposed = true;
      setMapReady(false);
      try {
        mapRef.current?.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
      savedMarkerRef.current = null;
      addressMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Amber marker: where the declared address geocodes to
  useEffect(() => {
    if (!mapReady || !declared || !mapRef.current) return;
    void (async () => {
      const mod = await import("mapbox-gl");
      const mapboxgl = (mod as any).default ?? mod;
      addressMarkerRef.current?.remove?.();
      const ring = document.createElement("div");
      ring.title = "Declared address";
      ring.style.cssText = "width:22px;height:22px;border-radius:9999px;background:rgba(245,158,11,.25);border:2px solid #f59e0b";
      addressMarkerRef.current = new mapboxgl.Marker({ element: ring }).setLngLat([declared.lng, declared.lat]).addTo(mapRef.current);
    })();
  }, [mapReady, declared]);

  const flyTo = useCallback((lat: number, lng: number, zoom = 16) => {
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [lng, lat], zoom, essential: true, speed: 1.6 });
    } else {
      setPin({ lat, lng });
      setLatText(lat.toFixed(6));
      setLngText(lng.toFixed(6));
    }
  }, []);

  const runSearch = useCallback(async () => {
    setSearching(true);
    setSearchNote(null);
    const hits = await geocodeTz(query.includes("Tanzania") ? query : `${query}, Tanzania`, 5);
    setResults(hits);
    setSearching(false);
    if (hits.length === 0) setSearchNote("No match. Try a nearby landmark, street or ward name.");
    else if (hits.length === 1) flyTo(hits[0].lat, hits[0].lng);
  }, [query, flyTo]);

  const applyTyped = () => {
    const lat = Number(latText);
    const lng = Number(lngText);
    if (!validCoord(lat, lng)) {
      setError("Enter a valid latitude (-90 to 90) and longitude (-180 to 180).");
      return;
    }
    setError(null);
    flyTo(lat, lng);
  };

  if (!open || typeof document === "undefined") return null;

  const savedFromAddress = saved && declared ? haversineKm(saved, declared) : null;
  const pinFromAddress = pin && declared ? haversineKm(pin, declared) : null;
  const moved = pin && saved ? haversineKm(pin, saved) : null;
  const savedLooksWrong = savedFromAddress !== null && savedFromAddress > PIN_MISMATCH_KM;
  const pinLooksWrong = pinFromAddress !== null && pinFromAddress > PIN_MISMATCH_KM;
  const changed = Boolean(pin && (!saved || (moved ?? 0) > 0.001));
  const canSave = Boolean(pin && changed && reason.trim().length >= 5 && !saving);

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={() => !saving && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-editor-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="box-border flex max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[calc(100vh-2rem)] sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-0 border-b border-solid border-slate-200 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
              <MapPin className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="pin-editor-title" className="m-0 text-[17px] font-bold text-slate-900">
                Verify location pin
              </h2>
              <p className="m-0 mt-0.5 truncate text-[12.5px] text-slate-500">
                {tidy(propertyTitle)}
                {addr ? ` · ${addr}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
          {/* Map */}
          <div className="relative min-h-[320px] bg-slate-100 lg:min-h-0">
            <div ref={containerRef} className="absolute inset-0" />
            {/* Centre pin = the new location */}
            {!mapError && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className="flex -translate-y-4 flex-col items-center">
                  <MapPin className="h-9 w-9 fill-[#02665e] text-white drop-shadow-[0_3px_4px_rgba(0,0,0,0.35)]" strokeWidth={1.5} />
                  <span className="-mt-1 h-1.5 w-3 rounded-full bg-black/25 blur-[1px]" />
                </div>
              </div>
            )}
            {/* Search over the map */}
            <div className="absolute left-3 right-14 top-3 z-20">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSearch();
                }}
                className="flex gap-1.5"
              >
                <span className="relative block min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search street, landmark or ward"
                    className="box-border h-10 w-full rounded-lg border border-solid border-slate-200 bg-white pl-9 pr-3 text-[13.5px] text-slate-900 shadow-md outline-none focus:border-[#02665e]"
                  />
                </span>
                <button
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="inline-flex h-10 flex-none items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 text-[13px] font-semibold text-white shadow-md hover:bg-[#014e47] disabled:opacity-50"
                >
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
                </button>
              </form>
              {(results.length > 1 || searchNote) && (
                <div className="mt-1.5 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-lg">
                  {searchNote && <p className="m-0 px-3 py-2 text-[12.5px] text-slate-500">{searchNote}</p>}
                  {results.length > 1 &&
                    results.map((r) => (
                      <button
                        key={`${r.lat},${r.lng}`}
                        type="button"
                        onClick={() => {
                          flyTo(r.lat, r.lng);
                          setResults([]);
                        }}
                        className="flex w-full items-start gap-2 border-0 border-t border-solid border-slate-100 bg-white px-3 py-2 text-left text-[12.5px] text-slate-700 first:border-t-0 hover:bg-slate-50"
                      >
                        <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none text-[#02665e]" aria-hidden />
                        <span className="min-w-0">{r.label}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            {/* Legend */}
            {!mapError && (
              <div className="absolute bottom-3 left-3 z-20 flex flex-wrap gap-1.5 text-[11px] font-medium text-slate-700">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 shadow">
                  <MapPin className="h-3.5 w-3.5 fill-[#02665e] text-white" /> New pin
                </span>
                {saved && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 shadow">
                    <span className="h-2.5 w-2.5 rounded-full border-2 border-solid border-white bg-slate-400 shadow" /> Saved pin
                  </span>
                )}
                {declared && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 shadow">
                    <span className="h-3 w-3 rounded-full border-2 border-solid border-amber-500 bg-amber-200/60" /> Address area
                  </span>
                )}
              </div>
            )}
            {mapError && (
              <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center">
                <p className="m-0 max-w-xs text-[13px] text-slate-500">{mapError}</p>
              </div>
            )}
          </div>

          {/* Side panel */}
          <div className="space-y-4 border-0 border-t border-solid border-slate-200 p-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
            {/* Health of the saved pin */}
            {checking ? (
              <p className="m-0 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking the saved pin against the address
              </p>
            ) : !saved ? (
              <p className="m-0 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 ring-1 ring-inset ring-amber-200">
                <AlertTriangle className="mt-px h-4 w-4 flex-none text-amber-600" /> No pin saved yet. Place it on the building.
              </p>
            ) : savedLooksWrong ? (
              <div className="rounded-lg bg-rose-50 px-3 py-2.5 ring-1 ring-inset ring-rose-200">
                <p className="m-0 flex items-start gap-2 text-[13px] font-semibold text-rose-800">
                  <AlertTriangle className="mt-px h-4 w-4 flex-none text-rose-600" />
                  Saved pin is {fmtKm(savedFromAddress!)} from the address
                </p>
                <p className="m-0 mt-1 pl-6 text-[12px] text-rose-700">Rides and distances use this pin, so they are wrong until it is fixed.</p>
                {declared && (
                  <button
                    type="button"
                    onClick={() => flyTo(declared.lat, declared.lng, 15)}
                    className="ml-6 mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border-0 bg-rose-600 px-2.5 text-[12px] font-semibold text-white hover:bg-rose-700"
                  >
                    <Crosshair className="h-3.5 w-3.5" /> Go to the address area
                  </button>
                )}
              </div>
            ) : savedFromAddress !== null ? (
              <p className="m-0 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-900 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="mt-px h-4 w-4 flex-none text-emerald-600" />
                Saved pin is within {fmtKm(savedFromAddress)} of the address area. Zoom in to confirm the exact building.
              </p>
            ) : (
              <p className="m-0 rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-500">Couldn't locate the address automatically. Check the pin visually.</p>
            )}

            {/* New pin readout */}
            <div className="rounded-lg border border-solid border-slate-200 p-3">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">New pin</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11.5px] text-slate-500">Latitude</span>
                  <input
                    value={latText}
                    onChange={(e) => setLatText(e.target.value)}
                    onBlur={applyTyped}
                    inputMode="decimal"
                    className="box-border h-9 w-full rounded-md border border-solid border-slate-300 px-2 font-mono text-[12.5px] outline-none focus:border-[#02665e]"
                  />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11.5px] text-slate-500">Longitude</span>
                  <input
                    value={lngText}
                    onChange={(e) => setLngText(e.target.value)}
                    onBlur={applyTyped}
                    inputMode="decimal"
                    className="box-border h-9 w-full rounded-md border border-solid border-slate-300 px-2 font-mono text-[12.5px] outline-none focus:border-[#02665e]"
                  />
                </label>
              </div>
              <div className="mt-2 space-y-1 text-[12px]">
                {moved !== null && (
                  <p className="m-0 flex justify-between text-slate-600">
                    <span>Moves from saved pin</span>
                    <span className="font-semibold tabular-nums text-slate-900">{fmtKm(moved)}</span>
                  </p>
                )}
                {pinFromAddress !== null && (
                  <p className={`m-0 flex justify-between ${pinLooksWrong ? "text-rose-700" : "text-slate-600"}`}>
                    <span>From address area</span>
                    <span className="font-semibold tabular-nums">{fmtKm(pinFromAddress)}</span>
                  </p>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {saved && changed && (
                  <button
                    type="button"
                    onClick={() => flyTo(saved.lat, saved.lng, 15)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-solid border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Back to saved
                  </button>
                )}
                {pin && (
                  <a
                    href={`https://www.google.com/maps?q=${pin.lat},${pin.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-solid border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-600 no-underline hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Check in Google Maps
                  </a>
                )}
              </div>
            </div>

            {/* Reason */}
            <div>
              <p className="m-0 mb-1.5 text-[12.5px] font-semibold text-slate-700">
                Reason for the change<span className="ml-0.5 text-rose-500">*</span>
              </p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={`rounded-md border border-solid px-2 py-1 text-[11.5px] font-medium transition ${
                      reason === r ? "border-[#02665e] bg-[#02665e]/10 text-[#02665e]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="What did you check?"
                className="box-border block w-full resize-none rounded-lg border border-solid border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-[#02665e]"
              />
              <p className="m-0 mt-1 text-[11px] text-slate-400">Saved in the audit history with the old and new coordinates.</p>
            </div>

            {pinLooksWrong && changed && (
              <p className="m-0 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-inset ring-amber-200">
                <AlertTriangle className="mt-px h-4 w-4 flex-none text-amber-600" />
                The new pin is still far from the declared address. Save only if the address itself is wrong.
              </p>
            )}
            {error && <p className="m-0 text-[12.5px] font-medium text-rose-600">{error}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-0 border-t border-solid border-slate-200 bg-slate-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 hidden text-[12px] text-slate-500 sm:block">Drag the map until the green pin sits on the building entrance.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-10 flex-1 rounded-lg border border-solid border-slate-300 bg-white px-4 text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:flex-none"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={async () => {
                if (!pin) return;
                setError(null);
                try {
                  await onSave({ latitude: pin.lat, longitude: pin.lng, reason: reason.trim() });
                } catch (e: any) {
                  setError(e?.message || "Could not save the pin.");
                }
              }}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-[13.5px] font-semibold text-white hover:bg-[#014e47] disabled:cursor-not-allowed disabled:bg-slate-300 sm:flex-none"
              title={!changed ? "Move the pin first" : reason.trim().length < 5 ? "Add a reason" : undefined}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving" : "Save pin"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
