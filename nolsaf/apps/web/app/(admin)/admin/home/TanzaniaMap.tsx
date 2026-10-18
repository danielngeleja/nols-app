"use client";

// Tanzania activity map for the admin home. Static, no map service: a simplified
// national outline and region capitals, projected from longitude/latitude into the
// SVG. Region names from the database are matched loosely ("ARUSHA CBD",
// "Dar-es-Salaam", "Unguja") to one of the 31 regions.

import { useMemo, useState } from "react";

type RegionPoint = { key: string; name: string; lon: number; lat: number; aliases: string[] };

export type RegionBookings = { regionName: string; bookings: number };
export type PendingListing = { title: string; regionName?: string | null };

const W = 400;
const H = 392;
const LON0 = 29.2;
const LON1 = 40.6;
const LAT0 = -0.8;
const LAT1 = -11.9;
const px = (lon: number) => ((lon - LON0) / (LON1 - LON0)) * W;
const py = (lat: number) => ((LAT0 - lat) / (LAT0 - LAT1)) * H;

// Mainland border, simplified, clockwise from the north-west shore of Lake Victoria.
const BORDER: Array<[number, number]> = [
  [30.48, -1.0], [33.9, -1.0], [34.1, -1.05], [35.6, -1.95], [36.9, -2.6], [37.6, -3.0], [37.7, -3.45], [38.7, -4.05], [39.2, -4.67],
  [39.05, -5.3], [38.85, -5.95], [39.25, -6.6], [39.4, -7.2], [39.3, -7.85], [39.55, -8.6], [39.6, -9.2], [39.85, -9.8], [40.2, -10.3], [40.45, -10.47],
  [39.85, -10.85], [39.2, -11.15], [38.5, -11.38], [37.8, -11.55], [37.1, -11.68], [36.4, -11.7], [35.8, -11.45], [35.0, -11.55],
  [34.65, -11.05], [34.55, -10.45], [34.3, -9.75], [33.95, -9.55], [33.3, -9.45], [32.95, -9.38], [32.4, -9.1], [31.65, -8.75], [31.05, -8.6], [30.75, -8.2],
  [30.45, -7.4], [30.15, -6.85], [29.75, -6.3], [29.55, -5.6], [29.45, -4.9], [29.75, -4.45], [30.25, -4.05], [30.55, -3.6], [30.75, -3.25], [30.85, -2.75],
  [30.7, -2.35], [30.5, -1.95], [30.45, -1.45],
];

// The Tanzanian part of Lake Victoria, south of the border line, simplified.
const LAKE_VICTORIA: Array<[number, number]> = [
  [31.95, -1.0], [33.65, -1.0], [33.65, -1.5], [33.35, -2.05], [33.0, -2.3], [32.6, -2.25], [32.15, -2.0], [31.98, -1.55],
];

const REGIONS: RegionPoint[] = [
  { key: "dar", name: "Dar es Salaam", lon: 39.28, lat: -6.8, aliases: ["dar es salaam", "dar-es-salaam", "dar", "dsm", "kinondoni", "ilala", "temeke", "ubungo", "kigamboni"] },
  { key: "arusha", name: "Arusha", lon: 36.68, lat: -3.37, aliases: ["arusha", "arumeru", "karatu", "monduli", "ngorongoro", "longido"] },
  { key: "kilimanjaro", name: "Kilimanjaro", lon: 37.34, lat: -3.35, aliases: ["kilimanjaro", "moshi", "hai", "rombo", "mwanga", "same"] },
  { key: "zanzibar", name: "Zanzibar", lon: 39.2, lat: -6.16, aliases: ["zanzibar", "unguja", "mjini magharibi", "stone town", "kaskazini unguja", "kusini unguja"] },
  { key: "pemba", name: "Pemba", lon: 39.75, lat: -5.2, aliases: ["pemba", "kaskazini pemba", "kusini pemba", "chake chake", "wete"] },
  { key: "tanga", name: "Tanga", lon: 39.1, lat: -5.07, aliases: ["tanga", "lushoto", "pangani", "muheza", "korogwe"] },
  { key: "pwani", name: "Pwani", lon: 38.9, lat: -6.95, aliases: ["pwani", "coast", "kibaha", "bagamoyo", "mafia", "rufiji"] },
  { key: "morogoro", name: "Morogoro", lon: 37.66, lat: -6.82, aliases: ["morogoro", "kilombero", "ifakara", "mikumi"] },
  { key: "dodoma", name: "Dodoma", lon: 35.74, lat: -6.17, aliases: ["dodoma"] },
  { key: "mwanza", name: "Mwanza", lon: 32.9, lat: -2.52, aliases: ["mwanza", "ilemela", "nyamagana"] },
  { key: "mara", name: "Mara", lon: 33.8, lat: -1.5, aliases: ["mara", "musoma", "serengeti", "tarime", "bunda"] },
  { key: "kagera", name: "Kagera", lon: 31.81, lat: -1.33, aliases: ["kagera", "bukoba"] },
  { key: "geita", name: "Geita", lon: 32.23, lat: -2.87, aliases: ["geita"] },
  { key: "simiyu", name: "Simiyu", lon: 33.98, lat: -2.8, aliases: ["simiyu", "bariadi"] },
  { key: "shinyanga", name: "Shinyanga", lon: 33.42, lat: -3.66, aliases: ["shinyanga", "kahama"] },
  { key: "manyara", name: "Manyara", lon: 35.75, lat: -4.2, aliases: ["manyara", "babati", "mbulu"] },
  { key: "singida", name: "Singida", lon: 34.74, lat: -4.82, aliases: ["singida"] },
  { key: "tabora", name: "Tabora", lon: 32.8, lat: -5.02, aliases: ["tabora"] },
  { key: "kigoma", name: "Kigoma", lon: 29.63, lat: -4.88, aliases: ["kigoma"] },
  { key: "katavi", name: "Katavi", lon: 31.07, lat: -6.34, aliases: ["katavi", "mpanda"] },
  { key: "rukwa", name: "Rukwa", lon: 31.62, lat: -7.96, aliases: ["rukwa", "sumbawanga"] },
  { key: "iringa", name: "Iringa", lon: 35.69, lat: -7.77, aliases: ["iringa", "mufindi"] },
  { key: "mbeya", name: "Mbeya", lon: 33.46, lat: -8.9, aliases: ["mbeya"] },
  { key: "songwe", name: "Songwe", lon: 32.93, lat: -9.1, aliases: ["songwe", "vwawa", "tunduma"] },
  { key: "njombe", name: "Njombe", lon: 34.77, lat: -9.33, aliases: ["njombe", "makete"] },
  { key: "ruvuma", name: "Ruvuma", lon: 35.65, lat: -10.68, aliases: ["ruvuma", "songea", "mbinga"] },
  { key: "lindi", name: "Lindi", lon: 39.71, lat: -10.0, aliases: ["lindi", "kilwa"] },
  { key: "mtwara", name: "Mtwara", lon: 40.18, lat: -10.27, aliases: ["mtwara", "masasi", "newala"] },
];

// Zones: the familiar groupings of regions. Each zone tints its part of the land and
// colours its booking circles. Pastel fills keep the data readable on top.
type ZoneKey = "lake" | "northern" | "eastern" | "central" | "western" | "highlands" | "southern" | "zanzibar";
export const ZONES: Record<ZoneKey, { name: string; fill: string; strong: string }> = {
  lake: { name: "Lake", fill: "#dde9f4", strong: "#2c6aa8" },
  northern: { name: "Northern", fill: "#ebe4f6", strong: "#6d48b8" },
  eastern: { name: "Eastern", fill: "#d9eee8", strong: "#02665e" },
  central: { name: "Central", fill: "#f4ebd2", strong: "#a06a10" },
  western: { name: "Western", fill: "#e4eedb", strong: "#4d7c0f" },
  highlands: { name: "Southern Highlands", fill: "#f4e1e3", strong: "#b13a4f" },
  southern: { name: "Southern", fill: "#ebe5dc", strong: "#7a5a3a" },
  zanzibar: { name: "Zanzibar", fill: "#d4eef2", strong: "#0e7490" },
};
const ZONE_OF: Record<string, ZoneKey> = {
  mwanza: "lake", mara: "lake", kagera: "lake", geita: "lake", simiyu: "lake", shinyanga: "lake",
  arusha: "northern", kilimanjaro: "northern", manyara: "northern", tanga: "northern",
  dar: "eastern", pwani: "eastern", morogoro: "eastern",
  dodoma: "central", singida: "central",
  tabora: "western", kigoma: "western", katavi: "western",
  iringa: "highlands", mbeya: "highlands", songwe: "highlands", njombe: "highlands", rukwa: "highlands",
  lindi: "southern", mtwara: "southern", ruvuma: "southern",
  zanzibar: "zanzibar", pemba: "zanzibar",
};
const zoneOf = (key: string): ZoneKey => ZONE_OF[key] ?? "eastern";

// Approximate region areas: a Voronoi cell around each mainland capital, clipped to the
// border at render time. A schematic, not survey boundaries; it only carries the zone tint.
type Pt = [number, number];
function clipHalf(poly: Pt[], a: Pt, b: Pt): Pt[] {
  // Keep the side of the bisector nearer to a.
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1];
  const side = (p: Pt) => (p[0] - mx) * dx + (p[1] - my) * dy;
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

const MAINLAND = REGIONS.filter((r) => zoneOf(r.key) !== "zanzibar");
const CELLS = MAINLAND.map((r) => {
  const a: Pt = [px(r.lon), py(r.lat)];
  let poly: Pt[] = [[-20, -20], [W + 20, -20], [W + 20, H + 20], [-20, H + 20]];
  for (const o of MAINLAND) if (o !== r) poly = clipHalf(poly, a, [px(o.lon), py(o.lat)]);
  return { key: r.key, zone: zoneOf(r.key), d: poly.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + " Z" };
});

const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

/** Match a free-text region name to one of the regions above, or null. */
export function matchRegion(name?: string | null): RegionPoint | null {
  const n = norm(name || "");
  if (!n || n === "unknown") return null;
  for (const r of REGIONS) if (r.aliases.some((a) => n === norm(a))) return r;
  for (const r of REGIONS) if (r.aliases.some((a) => norm(a).length >= 4 && n.includes(norm(a)))) return r;
  return null;
}

export default function TanzaniaMap({
  regions,
  pending,
  selected,
  onSelect,
}: {
  regions: RegionBookings[];
  pending: PendingListing[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  // Fold the database rows into map regions.
  const data = useMemo(() => {
    const byKey = new Map<string, { region: RegionPoint; bookings: number; pending: string[] }>();
    let unplacedBookings = 0;
    let unplacedPending = 0;
    for (const row of regions) {
      const r = matchRegion(row.regionName);
      if (!r) { unplacedBookings += row.bookings; continue; }
      const cur = byKey.get(r.key) || { region: r, bookings: 0, pending: [] };
      cur.bookings += row.bookings;
      byKey.set(r.key, cur);
    }
    for (const p of pending) {
      const r = matchRegion(p.regionName);
      if (!r) { unplacedPending += 1; continue; }
      const cur = byKey.get(r.key) || { region: r, bookings: 0, pending: [] };
      cur.pending.push(p.title);
      byKey.set(r.key, cur);
    }
    const list = [...byKey.values()].sort((a, b) => b.bookings - a.bookings);
    return { list, unplacedBookings, unplacedPending, max: Math.max(1, ...list.map((x) => x.bookings)) };
  }, [regions, pending]);

  const outline = BORDER.map(([lon, lat], i) => `${i ? "L" : "M"}${px(lon).toFixed(1)} ${py(lat).toFixed(1)}`).join(" ") + " Z";
  const lake = LAKE_VICTORIA.map(([lon, lat], i) => `${i ? "L" : "M"}${px(lon).toFixed(1)} ${py(lat).toFixed(1)}`).join(" ") + " Z";
  const focus = data.list.find((x) => x.region.key === (hover ?? selected)) ?? null;
  const ranked = data.list.filter((x) => x.bookings > 0);
  const labelled = new Set(ranked.slice(0, 4).map((x) => x.region.key));
  const leader = ranked[0]?.region.key ?? null;
  // The zone of the focused region comes forward; the others fade.
  const activeZone: ZoneKey | null = focus ? zoneOf(focus.region.key) : null;
  const zoneDim = (z: ZoneKey) => (activeZone && activeZone !== z ? 0.35 : 1);

  return (
    <div className="min-w-0">
      <style>{`@media (prefers-reduced-motion: reduce) { .tzmap-pulse { display: none; } }`}</style>
      <svg viewBox={`-8 -8 ${W + 16} ${H + 16}`} className="block h-auto w-full" role="img" aria-label="Bookings and listings waiting for review across Tanzania's regions, coloured by zone">
        <defs>
          <clipPath id="tzmap-clip"><path d={outline} /></clipPath>
          <filter id="tzmap-lift" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#0b2420" floodOpacity="0.08" />
          </filter>
        </defs>

        {/* Land tinted by zone, then the lake and the coast on top */}
        <path d={outline} fill="#f4f6f5" filter="url(#tzmap-lift)" />
        <g clipPath="url(#tzmap-clip)">
          {CELLS.map((c) => (
            <path key={c.key} d={c.d} fill={ZONES[c.zone].fill} stroke="#ffffff" strokeWidth="0.8" strokeOpacity="0.7" fillOpacity={zoneDim(c.zone)} style={{ transition: "fill-opacity 180ms" }} />
          ))}
        </g>
        <path d={outline} fill="none" stroke="#c3cfca" strokeWidth="1.2" strokeLinejoin="round" />
        <path d={lake} fill="#e6f0f4" stroke="#c9dbe2" strokeWidth="0.8" strokeLinejoin="round" />
        <text x={px(32.8)} y={py(-1.55)} textAnchor="middle" fontSize="7.5" letterSpacing="1.2" fill="#7f9ba6">LAKE VICTORIA</text>
        <text x={px(40.25)} y={py(-7.6)} textAnchor="middle" fontSize="8" letterSpacing="1.6" fill="#a9bcc4" transform={`rotate(90 ${px(40.25)} ${py(-7.6)})`}>INDIAN OCEAN</text>
        {/* Unguja and Pemba */}
        <ellipse cx={px(39.32)} cy={py(-6.15)} rx="5" ry="11" fill={ZONES.zanzibar.fill} fillOpacity={zoneDim("zanzibar")} stroke="#a9cfd6" strokeWidth="1.2" />
        <ellipse cx={px(39.77)} cy={py(-5.2)} rx="3.5" ry="8" fill={ZONES.zanzibar.fill} fillOpacity={zoneDim("zanzibar")} stroke="#a9cfd6" strokeWidth="1.2" />
        {/* Every region as a faint anchor so the map reads even when quiet */}
        {REGIONS.map((r) => <circle key={`a-${r.key}`} cx={px(r.lon)} cy={py(r.lat)} r="1.6" fill={ZONES[zoneOf(r.key)].strong} fillOpacity="0.35" />)}

        {data.list.map(({ region, bookings, pending: waiting }) => {
          const x = px(region.lon);
          const y = py(region.lat);
          const radius = bookings > 0 ? 5 + Math.sqrt(bookings / data.max) * 19 : 0;
          const active = (hover ?? selected) === region.key;
          const pinned = selected === region.key;
          const shown = waiting.slice(0, 4);
          const zone = zoneOf(region.key);
          const color = ZONES[zone].strong;
          return (
            <g
              key={region.key}
              onMouseEnter={() => setHover(region.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(selected === region.key ? null : region.key)}
              style={{ cursor: "pointer", opacity: activeZone && activeZone !== zone ? 0.45 : 1, transition: "opacity 180ms" }}
            >
              <circle cx={x} cy={y} r={Math.max(radius, 9)} fill="transparent" />
              {/* The month's leading region breathes, softly */}
              {region.key === leader && bookings > 0 ? (
                <circle className="tzmap-pulse" cx={x} cy={y} r={radius} fill="none" stroke={color} strokeWidth="1.5">
                  <animate attributeName="r" values={`${radius};${radius + 12}`} dur="2.6s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" values="0.45;0" dur="2.6s" repeatCount="indefinite" />
                </circle>
              ) : null}
              {pinned ? <circle cx={x} cy={y} r={Math.max(radius, 6) + 5} fill="none" stroke="#0b2420" strokeWidth="1.2" strokeDasharray="3 3" /> : null}
              {bookings > 0 ? (
                <circle cx={x} cy={y} r={radius} fill={color} fillOpacity={active ? 0.95 : 0.8} stroke="#ffffff" strokeWidth={active ? 2.5 : 1.5} style={{ transition: "fill-opacity 160ms" }} />
              ) : null}
              {bookings > 0 && radius >= 13 ? (
                <text x={x} y={y + 4} textAnchor="middle" fontSize={radius >= 18 ? 12 : 10} fontWeight="700" fill="#ffffff" style={{ pointerEvents: "none" }}>{bookings}</text>
              ) : null}
              {shown.map((_, i) => {
                const angle = -Math.PI / 4 + i * 0.75;
                const d = (radius || 2) + 5;
                return <circle key={i} cx={x + Math.cos(angle) * d} cy={y + Math.sin(angle) * d} r="3.6" fill="#d97706" stroke="#ffffff" strokeWidth="1.2" />;
              })}
              {waiting.length > shown.length ? (
                <text x={x + Math.cos(-Math.PI / 4 + shown.length * 0.75) * ((radius || 2) + 6)} y={y + Math.sin(-Math.PI / 4 + shown.length * 0.75) * ((radius || 2) + 6) + 3} fontSize="9" fontWeight="700" fill="#b45309">+{waiting.length - shown.length}</text>
              ) : null}
              {labelled.has(region.key) || active ? (
                <text x={x} y={y + Math.max(radius, 4) + 14} textAnchor="middle" fontSize="11" fontWeight={active ? 700 : 600} fill="#1f2a27" style={{ paintOrder: "stroke", stroke: "#ffffff", strokeWidth: 3.5, strokeLinejoin: "round" }}>
                  {region.name}
                  {bookings && radius < 13 ? <tspan fill={color} fontWeight="700">{`  ${bookings}`}</tspan> : null}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {/* Readout: the focused region, or the month's ranking you can click into */}
      <div className="mt-2 min-h-[2.75rem] rounded-xl border border-solid border-neutral-100 bg-neutral-50/80 px-3 py-2 text-xs">
        {focus ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13px] font-bold text-neutral-950">{focus.region.name}</span>
            <span className="text-[11px] font-semibold" style={{ color: ZONES[zoneOf(focus.region.key)].strong }}>{ZONES[zoneOf(focus.region.key)].name} zone</span>
            <span className="inline-flex items-center gap-1.5 text-neutral-600"><span className="h-2 w-2 rounded-full" style={{ background: ZONES[zoneOf(focus.region.key)].strong }} aria-hidden />{focus.bookings} {focus.bookings === 1 ? "booking" : "bookings"} in 30 days</span>
            {focus.pending.length ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-amber-800"><span className="h-2 w-2 shrink-0 rounded-full bg-amber-600" aria-hidden /><span className="truncate">{focus.pending.length} waiting: {focus.pending.slice(0, 2).join(", ")}{focus.pending.length > 2 ? ` +${focus.pending.length - 2}` : ""}</span></span>
            ) : null}
            {selected ? <button type="button" onClick={() => onSelect(null)} className="ml-auto cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800">Clear</button> : null}
          </div>
        ) : ranked.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {ranked.slice(0, 4).map((x, i) => (
              <button key={x.region.key} type="button" onClick={() => onSelect(x.region.key)} onMouseEnter={() => setHover(x.region.key)} onMouseLeave={() => setHover(null)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-solid border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:border-neutral-300">
                <span className="text-neutral-400 tabular-nums">{i + 1}</span>{x.region.name}<span className="tabular-nums" style={{ color: ZONES[zoneOf(x.region.key)].strong }}>{x.bookings}</span>
              </button>
            ))}
            {data.unplacedBookings || data.unplacedPending ? (
              <span className="ml-auto text-[11px] text-neutral-400">{[data.unplacedBookings ? `${data.unplacedBookings} bookings` : null, data.unplacedPending ? `${data.unplacedPending} listings` : null].filter(Boolean).join(" and ")} without a recognisable region</span>
            ) : null}
          </div>
        ) : (
          <p className="m-0 py-1 text-neutral-500">
            No bookings placed on the map in the last 30 days.
            {data.unplacedPending ? <span className="text-neutral-400"> {data.unplacedPending} listings have no recognisable region.</span> : null}
          </p>
        )}
      </div>
    </div>
  );
}
