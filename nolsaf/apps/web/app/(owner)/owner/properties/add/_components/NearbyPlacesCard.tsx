"use client";

import { useState, type ComponentType } from "react";
import {
  AlertCircle,
  Bike,
  Building2,
  Bus,
  Car,
  Check,
  ExternalLink,
  Footprints,
  Fuel,
  Hospital,
  Landmark,
  MapPin,
  Pencil,
  Pill,
  Plane,
  Plus,
  Route,
  Shield,
  Stethoscope,
  Trash2,
} from "lucide-react";

/* The shape saved in services.nearbyFacilities. Kept identical to the page's NearbyFacility. */
export type PlaceType =
  | "Hospital"
  | "Pharmacy"
  | "Polyclinic"
  | "Clinic"
  | "Police station"
  | "Airport"
  | "Bus station"
  | "Petrol station"
  | "Conference center"
  | "Stadium"
  | "Main road";
export type ReachMode = "Walking" | "Boda" | "Public Transport" | "Car/Taxi";
export type NearbyPlace = {
  id: string;
  type: PlaceType;
  name: string;
  ownership: "Public/Government" | "Private" | "";
  distanceKm: number | "";
  reachableBy: ReachMode[];
  url?: string;
};

type Icon = ComponentType<{ className?: string }>;

const GROUPS: { label: string; types: PlaceType[] }[] = [
  { label: "Medical", types: ["Hospital", "Pharmacy", "Polyclinic", "Clinic"] },
  { label: "Transport", types: ["Airport", "Bus station", "Petrol station", "Main road"] },
  { label: "Public places", types: ["Police station", "Conference center", "Stadium"] },
];

const TYPE_ICONS: Record<PlaceType, Icon> = {
  Hospital: Hospital,
  Pharmacy: Pill,
  Polyclinic: Stethoscope,
  Clinic: Stethoscope,
  "Police station": Shield,
  Airport: Plane,
  "Bus station": Bus,
  "Petrol station": Fuel,
  "Conference center": Landmark,
  Stadium: Building2,
  "Main road": Route,
};

const PLACEHOLDERS: Record<PlaceType, string> = {
  Hospital: "e.g. Aga Khan Hospital",
  Pharmacy: "e.g. Medipharm Pharmacy",
  Polyclinic: "e.g. City Polyclinic",
  Clinic: "e.g. Community Health Clinic",
  "Police station": "e.g. Central Police Station",
  Airport: "e.g. Julius Nyerere International Airport",
  "Bus station": "e.g. Ubungo Bus Terminal",
  "Petrol station": "e.g. Total Petrol Station",
  "Conference center": "e.g. Mlimani City Conference Center",
  Stadium: "e.g. Benjamin Mkapa Stadium",
  "Main road": "e.g. Bagamoyo Road",
};

const WITH_OWNERSHIP: PlaceType[] = ["Hospital", "Pharmacy", "Polyclinic", "Clinic"];
const REACH: { mode: ReachMode; label: string; Icon: Icon }[] = [
  { mode: "Walking", label: "Walking", Icon: Footprints },
  { mode: "Boda", label: "Boda", Icon: Bike },
  { mode: "Public Transport", label: "Public transport", Icon: Bus },
  { mode: "Car/Taxi", label: "Car or taxi", Icon: Car },
];

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function emptyPlace(type: PlaceType): NearbyPlace {
  return { id: newId(), type, name: "", ownership: "", distanceKm: "", reachableBy: [], url: undefined };
}

/* ------------------------------------------------------------------ form -- */
function PlaceForm({
  initial,
  isNew,
  lockedTypes,
  onSave,
  onCancel,
}: {
  initial: NearbyPlace;
  isNew: boolean;
  lockedTypes: Set<PlaceType>;
  onSave: (p: NearbyPlace) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<NearbyPlace>(initial);
  const [tried, setTried] = useState(false);
  // Typed text is kept as is ("2." while typing); the number follows it
  const [distanceText, setDistanceText] = useState(initial.distanceKm === "" ? "" : String(initial.distanceKm));
  const set = (patch: Partial<NearbyPlace>) => setDraft((d) => ({ ...d, ...patch }));

  const nameError = (tried || draft.name.length > 0) && draft.name.trim().length < 2 ? "At least 2 characters" : "";
  const urlError = draft.url && !/^https?:\/\/.+/.test(draft.url) ? "Start with http:// or https://" : "";
  const distanceError = typeof draft.distanceKm === "number" && draft.distanceKm < 0 ? "Cannot be negative" : "";
  const canSave = draft.name.trim().length >= 2 && !urlError && !distanceError;

  const save = () => {
    setTried(true);
    if (!canSave) return;
    onSave({
      ...draft,
      name: draft.name.trim(),
      ownership: WITH_OWNERSHIP.includes(draft.type) ? draft.ownership : "",
      url: draft.url ? draft.url.trim() : undefined,
    });
  };

  return (
    <div className="ap-place-form">
      {!isNew ? (
        <div className="ap-fields-3">
          <div>
            <label className="ap-label" htmlFor={`place-type-${draft.id}`}>Type</label>
            <select
              id={`place-type-${draft.id}`}
              value={draft.type}
              onChange={(e) => {
                const t = e.target.value as PlaceType;
                set({ type: t, ownership: WITH_OWNERSHIP.includes(t) ? draft.ownership : "" });
              }}
              className="ap-select is-set"
            >
              {GROUPS.flatMap((g) => g.types).map((t) => (
                <option key={t} value={t} disabled={t !== initial.type && lockedTypes.has(t)}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div className="ap-fields-3">
        <div>
          <label className="ap-label" htmlFor={`place-name-${draft.id}`}>
            Name <span className="text-red-300">*</span>
          </label>
          <input
            id={`place-name-${draft.id}`}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={PLACEHOLDERS[draft.type]}
            className={`ap-input${nameError ? " is-invalid" : draft.name.trim().length >= 2 ? " is-set" : ""}`}
            autoFocus
          />
          {nameError ? <p className="ap-field-error">{nameError}</p> : null}
        </div>
        <div>
          <label className="ap-label" htmlFor={`place-distance-${draft.id}`}>Distance</label>
          <div className="ap-price">
            <input
              id={`place-distance-${draft.id}`}
              type="text"
              inputMode="decimal"
              value={distanceText}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                setDistanceText(raw);
                const n = Number(raw);
                set({ distanceKm: raw === "" || !Number.isFinite(n) ? "" : n });
              }}
              placeholder="2.5"
            />
            <span className="ap-price-unit">km</span>
          </div>
          {distanceError ? <p className="ap-field-error">{distanceError}</p> : null}
        </div>
        <div>
          <label className="ap-label" htmlFor={`place-url-${draft.id}`}>
            Link <span className="font-normal text-white/40">optional</span>
          </label>
          <input
            id={`place-url-${draft.id}`}
            type="url"
            value={draft.url ?? ""}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://"
            className={`ap-input${urlError ? " is-invalid" : ""}`}
          />
          {urlError ? <p className="ap-field-error">{urlError}</p> : null}
        </div>
      </div>

      <div className="ap-fields-3">
        {WITH_OWNERSHIP.includes(draft.type) ? (
          <div>
            <span className="ap-label">Ownership</span>
            <div className="ap-toggles" role="radiogroup" aria-label="Ownership">
              {(["Public/Government", "Private"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={draft.ownership === o}
                  onClick={() => set({ ownership: draft.ownership === o ? "" : o })}
                  className={`ap-toggle${draft.ownership === o ? " is-on" : ""}`}
                >
                  {o === "Public/Government" ? "Public" : "Private"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className={WITH_OWNERSHIP.includes(draft.type) ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-3"}>
          <span className="ap-label">Reachable by</span>
          <div className="ap-reach" role="group" aria-label="Reachable by">
            {REACH.map(({ mode, label, Icon }) => {
              const on = draft.reachableBy.includes(mode);
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ reachableBy: on ? draft.reachableBy.filter((m) => m !== mode) : [...draft.reachableBy, mode] })}
                  className={`ap-toggle${on ? " is-on" : ""}`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="ap-form-actions">
        <button type="button" onClick={onCancel} className="ap-btn">
          Cancel
        </button>
        <button type="button" onClick={save} disabled={tried && !canSave} className="ap-btn is-primary">
          <Check className="h-4 w-4" />
          {isNew ? "Add place" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ card -- */
export function NearbyPlacesCard({
  cardNo,
  places,
  setPlaces,
}: {
  cardNo: number;
  places: NearbyPlace[];
  setPlaces: (updater: (prev: NearbyPlace[]) => NearbyPlace[]) => void;
}) {
  const [composing, setComposing] = useState<NearbyPlace | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const lockedTypes = new Set(places.map((p) => p.type));

  return (
    <section className="ap-card">
      <header className="ap-card-head">
        <span className="ap-card-head-no">{cardNo}</span>
        <div className="ap-card-head-copy">
          <h3 className="ap-card-title">Nearby places</h3>
          <p className="ap-card-sub">Hospitals, transport and landmarks guests ask about.</p>
        </div>
        {places.length > 0 ? (
          <span className="ap-card-tag">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {places.length} added
          </span>
        ) : (
          <span className="ap-card-tag is-todo">Optional</span>
        )}
      </header>

      {places.length > 0 ? (
        <div className="ap-place-tiles">
          {places.map((p, idx) => {
            const Icon = TYPE_ICONS[p.type] || MapPin;
            const own = p.ownership ? (p.ownership === "Private" ? "Private" : "Public") : "";
            return (
              <div key={p.id ?? idx} className={`ap-place-tile${editingId === p.id ? " is-editing" : ""}`}>
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="ap-floor-no">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-[13.5px] font-semibold text-white" title={p.name}>{p.name}</p>
                    <p className="m-0 truncate text-[11.5px] text-white/50">
                      {p.type}
                      {own ? ` · ${own}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setComposing(null);
                        setEditingId(editingId === p.id ? null : p.id);
                      }}
                      className="ap-icon-btn is-sm"
                      title="Edit"
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (editingId === p.id) setEditingId(null);
                        setPlaces((list) => list.filter((_, i) => i !== idx));
                      }}
                      className="ap-icon-btn is-sm is-danger"
                      title="Remove"
                      aria-label={`Remove ${p.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="ap-place-foot">
                  {typeof p.distanceKm === "number" ? (
                    <span className="ap-place-dist">
                      <strong>{p.distanceKm}</strong> km
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-white/40">No distance</span>
                  )}
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    {REACH.filter((r) => p.reachableBy?.includes(r.mode)).map(({ mode, label, Icon: ModeIcon }) => (
                      <span key={mode} className="ap-reach-dot" title={label} aria-label={label}>
                        <ModeIcon className="h-3 w-3" />
                      </span>
                    ))}
                  </span>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="ap-reach-dot is-link" title={p.url} aria-label="Open link">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {editingId && places.some((p) => p.id === editingId) ? (
        <div className="ap-card-body ap-divided">
          <PlaceForm
            key={editingId}
            initial={places.find((p) => p.id === editingId)!}
            isNew={false}
            lockedTypes={lockedTypes}
            onCancel={() => setEditingId(null)}
            onSave={(next) => {
              setPlaces((list) => list.map((x) => (x.id === editingId ? next : x)));
              setEditingId(null);
            }}
          />
        </div>
      ) : null}

      {/* Add a place: three columns of kinds, then one short form below */}
      <div className={`ap-svc-cols${places.length > 0 ? " ap-divided" : ""}`}>
        {GROUPS.map((g) => (
          <div key={g.label} className="ap-svc-col">
            <div className="ap-svc-group">
              <div className="ap-svc-head">
                <span>{g.label}</span>
              </div>
              {g.types.map((t) => {
                const Icon = TYPE_ICONS[t];
                const added = lockedTypes.has(t);
                const on = composing?.type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={added}
                    aria-pressed={on}
                    onClick={() => {
                      setEditingId(null);
                      setComposing(on ? null : emptyPlace(t));
                    }}
                    className={`ap-svc-item ap-place-pick${on ? " is-on" : ""}${added ? " is-added" : ""}`}
                  >
                    <span className="ap-svc-ico">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">{t}</span>
                    {added ? (
                      <span className="ap-place-state is-added">
                        <Check className="h-3 w-3" /> Added
                      </span>
                    ) : (
                      <span className="ap-place-state">
                        <Plus className="h-3 w-3" /> {on ? "Adding" : "Add"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {composing ? (
        <div className="ap-card-body ap-divided">
          <PlaceForm
            key={composing.id}
            initial={composing}
            isNew
            lockedTypes={lockedTypes}
            onCancel={() => setComposing(null)}
            onSave={(p) => {
              setPlaces((list) => [...list, p]);
              setComposing(null);
            }}
          />
        </div>
      ) : places.length === 0 ? (
        <div className="ap-card-body ap-divided">
          <p className="m-0 ap-note">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Guests often check the nearest hospital and how to get from the airport.
          </p>
        </div>
      ) : null}
    </section>
  );
}
