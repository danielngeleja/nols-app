"use client";

/**
 * What is near the property, as a compact grid: nearest first, an icon per
 * kind of place, the distance in plain words (a walk, a short ride...), and
 * how to get there. Up to six show at once; the rest open on demand.
 */
import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  Bike, Building2, Bus, Car, ChevronDown, Church, Dumbbell, Fuel, GraduationCap, HeartPulse, Landmark,
  Link as LinkIcon, MapPin, Pill, Plane, ShoppingBag, ShoppingCart, Ship, Train, TreePalm, Utensils, Footprints,
} from "lucide-react";

type Icon = ComponentType<{ className?: string }>;

function transportIcon(mode: string): Icon | null {
  const m = mode.toLowerCase();
  if (m.includes("walk")) return Footprints;
  if (m.includes("car") || m.includes("taxi")) return Car;
  if (m.includes("boda") || m.includes("motorcycle") || m.includes("bike") || m.includes("bajaj")) return Bike;
  if (m.includes("public") || m.includes("bus") || m.includes("transport") || m.includes("daladala")) return Bus;
  return null;
}

function placeIcon(type: string, name: string): Icon {
  const s = `${type} ${name}`.toLowerCase();
  if (/airport|airstrip/.test(s)) return Plane;
  if (/rail|train|sgr/.test(s)) return Train;
  if (/ferry|port|harbou?r|boat/.test(s)) return Ship;
  if (/bus|stand|terminal|brt|daladala/.test(s)) return Bus;
  if (/hospital|clinic|health|medical/.test(s)) return HeartPulse;
  if (/pharma|chemist|dawa/.test(s)) return Pill;
  if (/school|college|universit|campus/.test(s)) return GraduationCap;
  if (/supermarket|grocery/.test(s)) return ShoppingCart;
  if (/mall|shop|market|store/.test(s)) return ShoppingBag;
  if (/restaurant|cafe|food|bar|eat/.test(s)) return Utensils;
  if (/beach|park|garden/.test(s)) return TreePalm;
  if (/church|mosque|temple/.test(s)) return Church;
  if (/bank|atm/.test(s)) return Landmark;
  if (/gym|fitness/.test(s)) return Dumbbell;
  if (/fuel|petrol|gas station/.test(s)) return Fuel;
  if (/office|embassy|government/.test(s)) return Building2;
  return MapPin;
}

/** Distance as people judge it. */
function closeness(km: number): { label: string; cls: string } {
  if (km <= 1) return { label: "Walkable", cls: "bg-emerald-50 text-emerald-700" };
  if (km <= 5) return { label: "Short ride", cls: "bg-teal-50 text-teal-700" };
  if (km <= 15) return { label: "In the city", cls: "bg-sky-50 text-sky-700" };
  return { label: "Further out", cls: "bg-slate-100 text-slate-600" };
}

function fmtKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km % 1 === 0 ? km : km.toFixed(1)} km`;
}

type NearbyServicesProps = {
  facilities: any[];
  defaultExpanded?: boolean;
  showExpandButton?: boolean;
  /** How many show before "Show all". */
  maxInitialDisplay?: number;
};

export default function NearbyServices({
  facilities,
  defaultExpanded = false,
  showExpandButton = true,
  maxInitialDisplay = 6,
}: NearbyServicesProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const sorted = useMemo(() => {
    const list = Array.isArray(facilities) ? facilities.filter((f) => f && (f.name || f.type)) : [];
    return [...list].sort((a, b) => {
      const da = typeof a.distanceKm === "number" ? a.distanceKm : Number.POSITIVE_INFINITY;
      const db = typeof b.distanceKm === "number" ? b.distanceKm : Number.POSITIVE_INFINITY;
      return da - db;
    });
  }, [facilities]);

  if (!sorted.length) return null;

  // Never hide a single leftover behind a button: show it.
  const limit = sorted.length - maxInitialDisplay <= 1 ? sorted.length : maxInitialDisplay;
  const shown = expanded ? sorted : sorted.slice(0, limit);
  const hidden = sorted.length - shown.length;
  const nearest = sorted.find((f) => typeof f.distanceKm === "number");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-xl font-bold text-slate-900 sm:text-2xl">Nearby</h2>
        <span className="text-[12.5px] text-slate-500">
          {sorted.length} {sorted.length === 1 ? "place" : "places"}
          {nearest ? ` · nearest ${fmtKm(nearest.distanceKm)}` : ""}
        </span>
      </div>

      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((f: any, idx: number) => {
          const Icon = placeIcon(String(f.type || ""), String(f.name || ""));
          const km = typeof f.distanceKm === "number" ? f.distanceKm : null;
          const near = km != null ? closeness(km) : null;
          const modes: string[] = Array.isArray(f.reachableBy) ? f.reachableBy : [];
          return (
            <li key={`${f.name || f.type}-${idx}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-solid border-slate-200 bg-white px-3 py-2.5">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="m-0 flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-900">
                  <span className="truncate" title={f.name || f.type}>{f.name || f.type}</span>
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noopener noreferrer" title="Website" className="flex-none text-slate-400 hover:text-[#02665e]">
                      <LinkIcon className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </p>
                <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500">
                  {f.name && f.type ? <span className="truncate">{f.type}</span> : null}
                  {modes.length ? (
                    <span className="flex flex-none items-center gap-1 text-slate-400" title={`By ${modes.join(", ").toLowerCase()}`}>
                      <span aria-hidden>·</span>
                      {modes.map((m, i) => {
                        const T = transportIcon(m);
                        return T ? <T key={i} className="h-3.5 w-3.5" /> : <span key={i} className="text-[10px] font-semibold">{m.charAt(0)}</span>;
                      })}
                    </span>
                  ) : null}
                </p>
              </div>
              {km != null ? (
                <div className="flex-none text-right">
                  <p className="m-0 text-[14px] font-bold tabular-nums text-slate-900">{fmtKm(km)}</p>
                  <span className={`mt-0.5 inline-block rounded px-1.5 py-px text-[10.5px] font-semibold ${near!.cls}`}>{near!.label}</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {showExpandButton && (hidden > 0 || expanded) && sorted.length > limit ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2.5 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13px] font-semibold text-[#02665e] hover:underline [font-family:inherit]"
        >
          {expanded ? "Show fewer" : `Show all ${sorted.length} places`}
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      ) : null}
    </div>
  );
}
