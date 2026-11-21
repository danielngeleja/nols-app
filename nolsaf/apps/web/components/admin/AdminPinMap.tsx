"use client";

/**
 * Admin "Location & pin" card. Answers one question: is the saved pin where
 * the address says the home is?
 *   - The map shows the saved pin; when the address resolves somewhere else it
 *     shows both points and fits them, so a pin in the wrong town is obvious.
 *   - The panel names the place the pin actually sits in (reverse geocode),
 *     the distance to the address, the coordinates, and the actions: fix the
 *     pin, open it in Google Maps or Street View.
 * Rides, distances and long-stay inspections all use this pin.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Loader2, MapPin, Navigation, Pencil, ScanEye } from "lucide-react";
import { PIN_MISMATCH_KM, addressLine, geocodeTz, haversineKm, type PinAddress } from "./PropertyPinEditor";

type Point = { lat: number; lng: number };

function fmtKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

async function placeOfPin(p: Point): Promise<string | null> {
  try {
    const resp = await fetch("/api/geocoding/public/reverse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: p.lat, lng: p.lng, types: ["neighborhood", "locality", "place"], limit: 1 }),
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const f = Array.isArray(data?.features) ? data.features[0] : null;
    return f ? String(f.placeName || f.text || "").replace(/,\s*Tanzania$/i, "") || null : null;
  } catch {
    return null;
  }
}

export default function AdminPinMap({ latitude, longitude, address, onFix }: {
  latitude: number | null;
  longitude: number | null;
  address: PinAddress;
  onFix: () => void;
}) {
  const pin: Point | null = latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0)
    ? { lat: latitude, lng: longitude }
    : null;
  const addr = useMemo(() => addressLine(address), [address]);
  const [addressPoint, setAddressPoint] = useState<(Point & { label: string }) | null>(null);
  const [pinPlace, setPinPlace] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  useEffect(() => {
    let alive = true;
    setChecking(true);
    setMapLoaded(false);
    setMapFailed(false);
    setAddressPoint(null);
    setPinPlace(null);
    void (async () => {
      const attempts = addr ? [addr, addressLine({ district: address.district, regionName: address.regionName || address.city })] : [];
      let found: (Point & { label: string }) | null = null;
      for (const q of attempts) {
        if (!q) continue;
        const hits = await geocodeTz(`${q}, Tanzania`, 1);
        if (hits[0]) { found = hits[0]; break; }
      }
      const place = pin ? await placeOfPin(pin) : null;
      if (!alive) return;
      setAddressPoint(found);
      setPinPlace(place);
      setChecking(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr, pin?.lat, pin?.lng]);

  const km = pin && addressPoint ? haversineKm(pin, addressPoint) : null;
  const far = km != null && km > PIN_MISMATCH_KM;
  const tone = !pin ? "missing" : checking ? "checking" : far ? "far" : km != null ? "ok" : "unknown";

  const mapSrc = (() => {
    if (!token || !pin) return null;
    // Plain markers (the same form the public map uses). `padding` is only valid
    // with `auto`; Mapbox refuses it next to a fixed centre, which broke the image.
    const markers = [`pin-l+02665e(${pin.lng},${pin.lat})`];
    if (far && addressPoint) markers.push(`pin-l+ea580c(${addressPoint.lng},${addressPoint.lat})`);
    const both = markers.length > 1;
    const view = both ? "auto" : `${pin.lng},${pin.lat},15,0`;
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${markers.join(",")}/${view}/1280x560@2x?${both ? "padding=80&" : ""}access_token=${encodeURIComponent(token)}`;
  })();

  const copy = async () => {
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(`${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const status = {
    missing: { cls: "bg-amber-50 text-amber-800 ring-amber-200", Icon: MapPin, text: "Pin missing" },
    checking: { cls: "bg-slate-50 text-slate-500 ring-slate-200", Icon: Loader2, text: "Checking the pin" },
    far: { cls: "bg-rose-50 text-rose-700 ring-rose-200", Icon: AlertTriangle, text: `Pin is ${km != null ? fmtKm(km) : ""} from the address` },
    ok: { cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", Icon: CheckCircle2, text: `Pin matches the address${km != null ? ` (${fmtKm(km)})` : ""}` },
    unknown: { cls: "bg-slate-50 text-slate-600 ring-slate-200", Icon: MapPin, text: "Address could not be placed on the map" },
  }[tone];

  const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold no-underline transition-colors [font-family:inherit]";

  return (
    <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]"><MapPin className="h-5 w-5" aria-hidden /></span>
          <div className="min-w-0">
            <h2 className="m-0 text-lg font-semibold text-slate-900 sm:text-xl">Location &amp; pin</h2>
            <p className="m-0 mt-0.5 truncate text-sm text-slate-500">{addr || "No address given"}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-2 self-start rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset sm:self-auto ${status.cls}`}>
          <status.Icon className={`h-4 w-4 ${tone === "checking" ? "animate-spin" : ""}`} />{status.text}
        </span>
      </div>

      <div className="grid border-0 border-t border-solid border-slate-100 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* Map */}
        <div className="relative min-h-[280px] bg-slate-100 sm:min-h-[340px]">
          {mapSrc && !mapFailed ? (
            <>
              {!mapLoaded ? (
                <div className="absolute inset-0 grid animate-pulse place-items-center bg-slate-100">
                  <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading the map</span>
                </div>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mapSrc} alt="The saved pin on the map" onLoad={() => setMapLoaded(true)} onError={() => setMapFailed(true)}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${mapLoaded ? "opacity-100" : "opacity-0"}`} />
              <div className="absolute left-3 top-3 flex flex-wrap gap-1.5 text-[11.5px] font-semibold">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-slate-700 shadow-sm"><span className="h-2.5 w-2.5 rounded-full bg-[#02665e]" />Saved pin</span>
                {far && addressPoint ? <span className="inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-slate-700 shadow-sm"><span className="h-2.5 w-2.5 rounded-full bg-orange-600" />Where the address is</span> : null}
              </div>
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center px-6 text-center">
              <div>
                <MapPin className={`mx-auto h-8 w-8 ${pin ? "text-[#02665e]/50" : "text-amber-500"}`} />
                <p className="m-0 mt-2 text-sm font-semibold text-slate-800">{pin ? "Pin saved" : "Location pin needed"}</p>
                <p className="m-0 mt-1 text-[13px] text-slate-500">
                  {!pin ? "Place the pin on the building so directions, distances and inspections are accurate."
                    : mapFailed ? "The map image could not load. Open the pin in Google Maps to check it."
                    : "The map preview is not configured here. Open the pin in Google Maps to check it."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Facts and actions */}
        <div className="flex flex-col gap-4 border-0 border-t border-solid border-slate-100 p-5 lg:border-l lg:border-t-0">
          <dl className="m-0 space-y-3 text-[13px]">
            <div>
              <dt className="text-[11.5px] font-semibold text-slate-400">Address as written</dt>
              <dd className="m-0 mt-0.5 text-slate-800">{addr || "Not given"}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold text-slate-400">The pin is in</dt>
              <dd className={`m-0 mt-0.5 ${far ? "font-semibold text-rose-700" : "text-slate-800"}`}>
                {!pin ? "No pin yet" : checking ? "Looking it up" : pinPlace || "Unknown place"}
              </dd>
            </div>
            {pin ? (
              <div>
                <dt className="text-[11.5px] font-semibold text-slate-400">Coordinates</dt>
                <dd className="m-0 mt-0.5 flex items-center gap-2">
                  <span className="font-mono text-[12.5px] text-slate-700">{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</span>
                  <button type="button" onClick={() => void copy()} aria-label="Copy coordinates" className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border-0 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </dd>
              </div>
            ) : null}
            {km != null ? (
              <div>
                <dt className="text-[11.5px] font-semibold text-slate-400">Distance to the address</dt>
                <dd className="m-0 mt-1">
                  <span className="relative block h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, Math.max(4, (km / (PIN_MISMATCH_KM * 2)) * 100))}%`, background: far ? "#e11d48" : "#059669" }} />
                  </span>
                  <span className={`mt-1 block text-[12.5px] font-semibold ${far ? "text-rose-700" : "text-emerald-700"}`}>
                    {fmtKm(km)} {far ? `(more than ${PIN_MISMATCH_KM} km: the pin is in the wrong place)` : "(close enough)"}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-auto flex flex-wrap gap-2">
            <button type="button" onClick={onFix}
              className={`${btn} cursor-pointer border-0 ${far || !pin ? "bg-[#02665e] text-white hover:bg-[#014e47]" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:text-[#02665e]"}`}>
              {pin ? <Pencil className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}{pin ? (far ? "Fix pin" : "Adjust pin") : "Place pin"}
            </button>
            {pin ? (
              <>
                <a href={`https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:text-[#02665e]`}>
                  <ExternalLink className="h-4 w-4" />Google Maps
                </a>
                <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${pin.lat},${pin.lng}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:text-[#02665e]`}>
                  <ScanEye className="h-4 w-4" />Street View
                </a>
                {far && addressPoint ? (
                  <a href={`https://www.google.com/maps/dir/?api=1&origin=${pin.lat},${pin.lng}&destination=${addressPoint.lat},${addressPoint.lng}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:text-[#02665e]`}>
                    <Navigation className="h-4 w-4" />Compare both
                  </a>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
