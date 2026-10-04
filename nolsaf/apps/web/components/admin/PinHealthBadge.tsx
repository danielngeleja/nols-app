"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MapPin } from "lucide-react";
import { PIN_MISMATCH_KM, addressLine, geocodeTz, haversineKm, type PinAddress } from "./PropertyPinEditor";

/**
 * Admin-only status next to a property's map: is the saved pin where the address says?
 * Geocodes the declared address and compares distance to the saved pin.
 */
export default function PinHealthBadge({
  latitude,
  longitude,
  address,
  onFix,
}: {
  latitude: number | null;
  longitude: number | null;
  address: PinAddress;
  onFix: () => void;
}) {
  const addr = useMemo(() => addressLine(address), [address]);
  const hasPin = latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
  const [state, setState] = useState<{ kind: "checking" | "ok" | "far" | "unknown"; km?: number }>({ kind: "checking" });

  useEffect(() => {
    if (!hasPin || !addr) {
      setState({ kind: "unknown" });
      return;
    }
    let alive = true;
    setState({ kind: "checking" });
    void (async () => {
      const attempts = [addr, addressLine({ district: address.district, regionName: address.regionName || address.city })];
      for (const q of attempts) {
        const hits = await geocodeTz(`${q}, Tanzania`, 1);
        if (!alive) return;
        if (hits[0]) {
          const km = haversineKm({ lat: latitude!, lng: longitude! }, hits[0]);
          setState({ kind: km > PIN_MISMATCH_KM ? "far" : "ok", km });
          return;
        }
      }
      if (alive) setState({ kind: "unknown" });
    })();
    return () => {
      alive = false;
    };
  }, [addr, hasPin, latitude, longitude, address.district, address.regionName, address.city]);

  if (!hasPin) {
    return (
      <button
        type="button"
        onClick={onFix}
        className="inline-flex items-center gap-2 rounded-lg border-0 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
      >
        <MapPin className="h-4 w-4" /> No pin saved · Place pin
      </button>
    );
  }

  if (state.kind === "checking") {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-500 ring-1 ring-inset ring-slate-200">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking pin
      </span>
    );
  }

  if (state.kind === "far") {
    const km = state.km ?? 0;
    return (
      <button
        type="button"
        onClick={onFix}
        title="The saved pin is far from the declared address. Rides and distances use this pin."
        className="inline-flex items-center gap-2 rounded-lg border-0 bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-100"
      >
        <AlertTriangle className="h-4 w-4" />
        Pin is {Math.round(km).toLocaleString()} km from the address · Fix pin
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onFix}
      className="inline-flex items-center gap-2 rounded-lg border-0 bg-white px-3 py-2 text-[12.5px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:text-[#02665e] hover:ring-[#02665e]/40"
    >
      {state.kind === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <MapPin className="h-4 w-4" />}
      {state.kind === "ok" ? "Pin matches address · Verify pin" : "Verify pin"}
    </button>
  );
}
