"use client";

// Where a group stays: region and district from the official Tanzania list,
// with ward and street kept out of the way until the partner asks for them
// (an event at a specific venue). Values are sent as readable names so they
// match property locations when owners make offers.
import { useMemo } from "react";
import { ChevronDown, MapPin, Plus, X } from "lucide-react";
import { REGIONS_FULL_DATA } from "@/lib/tzRegionsFull";

export type Destination = { region: string; district: string; ward: string; street: string; precise: boolean };
export const EMPTY_DESTINATION: Destination = { region: "", district: "", ward: "", street: "", precise: false };

const SMALL_WORDS = new Set(["es", "wa", "ya", "na", "la", "cha", "za"]);

/** "DAR ES SALAAM" -> "Dar es Salaam". */
export function placeLabel(value: string): string {
  return value
    .toLocaleLowerCase("en")
    .replaceAll("-", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part, i) => (i > 0 && SMALL_WORDS.has(part) ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ");
}

const select = "block h-10 w-full min-w-0 appearance-none rounded-md border border-solid border-slate-300 bg-white pl-3 pr-9 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const label = "block min-w-0 text-xs font-medium text-slate-600";

function Select({ id, value, onChange, disabled, placeholder, options }: {
  id: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder: string; options: string[];
}) {
  return (
    <span className="relative mt-1.5 block">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={select}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{placeLabel(o)}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
    </span>
  );
}

export default function GroupDestinationFields({ value, onChange }: { value: Destination; onChange: (next: Destination) => void }) {
  const region = useMemo(() => REGIONS_FULL_DATA.find((r) => r.name === value.region), [value.region]);
  const district = useMemo(() => region?.districts?.find((d) => d.name === value.district), [region, value.district]);
  const ward = useMemo(() => district?.wards?.find((w) => w.name === value.ward), [district, value.ward]);
  const streets = (ward?.streets || []) as string[];

  const set = (patch: Partial<Destination>) => onChange({ ...value, ...patch });

  return (
    <div className="min-w-0 space-y-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className={label} htmlFor="dest-region">
          Region
          <Select id="dest-region" value={value.region} placeholder="Choose a region"
            options={REGIONS_FULL_DATA.map((r) => r.name)}
            onChange={(v) => set({ region: v, district: "", ward: "", street: "" })} />
        </label>
        <label className={label} htmlFor="dest-district">
          District
          <Select id="dest-district" value={value.district} disabled={!region} placeholder={region ? "Any district" : "Choose a region first"}
            options={(region?.districts || []).map((d) => d.name)}
            onChange={(v) => set({ district: v, ward: "", street: "" })} />
        </label>
      </div>

      {value.precise ? (
        <div className="min-w-0 rounded-md border border-solid border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-slate-700"><MapPin className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />Exact area</p>
            <button type="button" onClick={() => set({ precise: false, ward: "", street: "" })}
              className="inline-flex h-7 items-center gap-1 rounded border-0 bg-transparent px-2 text-xs font-semibold text-slate-500 hover:bg-white hover:text-slate-800">
              <X className="h-3.5 w-3.5" aria-hidden />Remove
            </button>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className={label} htmlFor="dest-ward">
              Ward
              <Select id="dest-ward" value={value.ward} disabled={!district} placeholder={district ? "Choose a ward" : "Choose a district first"}
                options={(district?.wards || []).map((w) => w.name)}
                onChange={(v) => set({ ward: v, street: "" })} />
            </label>
            <label className={label} htmlFor="dest-street">
              Street or venue
              {value.ward && streets.length ? (
                <Select id="dest-street" value={value.street} placeholder="Choose a street" options={streets} onChange={(v) => set({ street: v })} />
              ) : (
                <input id="dest-street" value={value.street} disabled={!value.ward} maxLength={120}
                  onChange={(e) => set({ street: e.target.value })}
                  placeholder={value.ward ? "Street or venue name" : "Choose a ward first"}
                  className={`${select} mt-1.5 pr-3`} />
              )}
            </label>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => set({ precise: true })} disabled={!value.district}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-[#02665e] hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" aria-hidden />Add ward and street
          <span className="font-normal text-slate-400">{value.district ? "for an exact venue" : "after choosing a district"}</span>
        </button>
      )}
    </div>
  );
}

/** The request fields, as readable names. Ward and street only when asked for. */
export function destinationPayload(d: Destination) {
  return {
    toRegion: d.region ? placeLabel(d.region) : "",
    toDistrict: d.district ? placeLabel(d.district) : null,
    toWard: d.precise && d.ward ? placeLabel(d.ward) : null,
    toLocation: d.precise && d.street.trim() ? (d.street === d.street.toUpperCase() ? placeLabel(d.street) : d.street.trim()) : null,
  };
}
