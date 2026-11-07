"use client";

/**
 * Register or edit a lead. One card with three section rows (what it is,
 * where it is, what we are selling) and a live "Lead check" beside it that
 * says what is missing, catches a bad phone or email before saving, and
 * explains duplicate checks and lead protection.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  Building2,
  Check,
  CircleAlert,
  ClipboardCheck,
  Hotel,
  LayoutGrid,
  Loader2,
  MapPinned,
  MonitorSmartphone,
  Save,
  ShieldCheck,
} from "lucide-react";
import SalesDateTimeField from "@/components/sales/SalesDateTimeField";
import { REGIONS_FULL_DATA } from "@/lib/tzRegionsFull";

export type SalesLeadFormValue = {
  propertyName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  location: string;
  region: string;
  district: string;
  ward: string;
  propertyType: string;
  estimatedRooms: string;
  registrationNumber: string;
  taxNumber: string;
  proposedProduct: "NRMS" | "MARKETPLACE" | "NRMS_AND_MARKETPLACE";
  nextFollowUpAt: string;
  notes: string;
};

const EMPTY: SalesLeadFormValue = {
  propertyName: "",
  contactPerson: "",
  contactPhone: "",
  contactEmail: "",
  location: "",
  region: "",
  district: "",
  ward: "",
  propertyType: "",
  estimatedRooms: "",
  registrationNumber: "",
  taxNumber: "",
  proposedProduct: "NRMS",
  nextFollowUpAt: "",
  notes: "",
};

const PROPERTY_TYPES = [
  "Villa",
  "Apartment",
  "Hotel",
  "Lodge",
  "Condo",
  "Guest House",
  "Bungalow",
  "Cabin",
  "Homestay",
  "Townhouse",
  "House",
  "Other",
] as const;

const PRODUCTS: Array<{ value: SalesLeadFormValue["proposedProduct"]; title: string; hint: string; Icon: typeof Hotel }> = [
  { value: "NRMS", title: "NRMS", hint: "Run the property", Icon: MonitorSmartphone },
  { value: "MARKETPLACE", title: "Marketplace", hint: "Get bookings", Icon: Hotel },
  { value: "NRMS_AND_MARKETPLACE", title: "Both", hint: "Run it and fill it", Icon: LayoutGrid },
];

const field =
  "mt-1.5 block h-10 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400";
const fieldBad = "border-rose-400 hover:border-rose-500 focus:border-rose-500 focus:ring-rose-100";
const labelText = "block min-w-0 text-[12px] font-semibold text-slate-700";

function locationKey(value: string) {
  return value.toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "");
}

function locationLabel(value: string) {
  const connectingWords = new Set(["es", "wa", "ya", "na"]);
  return value
    .toLocaleLowerCase("en")
    .replaceAll("-", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => (
      index > 0 && connectingWords.has(part)
        ? part
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    ))
    .join(" ");
}

/** A Tanzanian mobile or landline in any common shape (07XX, 7XX, 255 7XX, +255 22...), or any other +country number. */
function phoneProblem(raw: string): string | null {
  const compact = raw.replace(/[\s().-]/g, "");
  if (!compact) return null;
  if (!/^\+?\d+$/.test(compact)) return "Use digits only, for example +255 712 345 678.";
  if (compact.startsWith("+") && !compact.startsWith("+255")) {
    return compact.length >= 9 && compact.length <= 16 ? null : "That international number looks too short or too long.";
  }
  const national = compact.replace(/^\+?255/, "").replace(/^0/, "");
  if (national.length !== 9) return "A Tanzanian number has 9 digits after +255.";
  if (!/^[2-7]/.test(national)) return "That does not look like a Tanzanian number.";
  return null;
}

function emailProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? null : "That email address looks incomplete.";
}

export function toSalesLeadPayload(value: SalesLeadFormValue) {
  const optional = (input: string) => input.trim() || null;
  return {
    propertyName: value.propertyName.trim(),
    contactPerson: optional(value.contactPerson),
    contactPhone: optional(value.contactPhone),
    contactEmail: optional(value.contactEmail),
    location: optional(value.location),
    region: optional(value.region),
    district: optional(value.district),
    ward: optional(value.ward),
    propertyType: optional(value.propertyType),
    estimatedRooms: value.estimatedRooms ? Number(value.estimatedRooms) : null,
    registrationNumber: optional(value.registrationNumber),
    taxNumber: optional(value.taxNumber),
    proposedProduct: value.proposedProduct,
    nextFollowUpAt: value.nextFollowUpAt ? new Date(value.nextFollowUpAt).toISOString() : null,
    notes: optional(value.notes),
  };
}

function Section({ step, icon: Icon, title, hint, children }: { step: number; icon: typeof Building2; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-0 border-t border-solid border-slate-200 px-4 py-5 first:border-t-0 sm:px-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
      <div className="flex items-start gap-3 lg:block">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><Icon className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0 lg:mt-2.5">
          <p className="m-0 text-[11px] font-semibold text-slate-400">Step {step} of 3</p>
          <h2 className="m-0 text-sm font-semibold text-slate-900">{title}</h2>
          <p className="m-0 mt-0.5 text-[12px] leading-5 text-slate-500">{hint}</p>
        </div>
      </div>
      <div className="grid min-w-0 content-start gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-rose-700"><CircleAlert className="h-3 w-3 shrink-0" aria-hidden />{text}</span>;
}

export default function SalesLeadForm({
  initial,
  submitLabel,
  submitting,
  onSubmit,
}: {
  initial?: Partial<SalesLeadFormValue>;
  submitLabel: string;
  /** Kept for callers; the Lead check panel now always holds the save button. */
  showTopSubmit?: boolean;
  submitting: boolean;
  onSubmit: (value: SalesLeadFormValue) => Promise<void> | void;
}) {
  const [value, setValue] = useState<SalesLeadFormValue>({ ...EMPTY, ...initial });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);
  const set = <K extends keyof SalesLeadFormValue>(key: K, next: SalesLeadFormValue[K]) =>
    setValue((current) => ({ ...current, [key]: next }));
  const touch = (key: string) => () => setTouched((t) => ({ ...t, [key]: true }));

  const selectedRegion = useMemo(
    () => REGIONS_FULL_DATA.find((region) => locationKey(region.name) === locationKey(value.region)),
    [value.region],
  );
  const districts = selectedRegion?.districts || [];
  const selectedDistrict = districts.find((district) => locationKey(district.name) === locationKey(value.district));
  const wards = selectedDistrict?.wards || [];

  const nameOk = value.propertyName.trim().length >= 2;
  const phoneErr = phoneProblem(value.contactPhone);
  const emailErr = emailProblem(value.contactEmail);
  const reachable = (!!value.contactPhone.trim() && !phoneErr) || (!!value.contactEmail.trim() && !emailErr);
  const roomsErr = value.estimatedRooms && (!/^\d+$/.test(value.estimatedRooms) || Number(value.estimatedRooms) < 1) ? "Enter a whole number of rooms." : null;

  // What makes a lead worth chasing, in the order it matters.
  const checks = [
    { ok: nameOk, label: "Property name", need: true },
    { ok: reachable, label: "A phone or email to reach them" },
    { ok: !!value.contactPerson.trim(), label: "Who you spoke to" },
    { ok: !!value.region, label: "Region" },
    { ok: !!value.district, label: "District" },
    { ok: !!value.nextFollowUpAt, label: "Next follow-up" },
    { ok: !!(value.registrationNumber.trim() || value.taxNumber.trim()), label: "Registration or tax number" },
  ];
  const done = checks.filter((c) => c.ok).length;
  const percent = Math.round((done / checks.length) * 100);
  const blocked = !nameOk || !!phoneErr || !!emailErr || !!roomsErr;
  const showErr = (key: string) => tried || touched[key];

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (blocked || submitting) return;
        void onSubmit(value);
      }}
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <div className="min-w-0 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        <Section step={1} icon={Building2} title="Property and contact" hint="The name the owner uses, and the person you are talking to.">
          <label className={`${labelText} sm:col-span-2`}>
            Property name <span className="text-rose-600">*</span>
            <input
              required
              minLength={2}
              maxLength={200}
              value={value.propertyName}
              onChange={(event) => set("propertyName", event.target.value)}
              onBlur={touch("propertyName")}
              className={`${field} ${showErr("propertyName") && !nameOk ? fieldBad : ""}`}
              placeholder="Official or trading name"
              aria-invalid={showErr("propertyName") && !nameOk}
            />
            <Problem text={showErr("propertyName") && !nameOk ? "Enter at least 2 characters." : null} />
          </label>

          <label className={labelText}>
            Property type
            <select value={value.propertyType} onChange={(event) => set("propertyType", event.target.value)} className={field}>
              <option value="">Choose a type</option>
              {PROPERTY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>

          <label className={labelText}>
            Contact person
            <input value={value.contactPerson} onChange={(event) => set("contactPerson", event.target.value)} className={field} placeholder="Full name" autoComplete="off" />
          </label>

          <label className={labelText}>
            Phone
            <input
              value={value.contactPhone}
              onChange={(event) => set("contactPhone", event.target.value)}
              onBlur={touch("contactPhone")}
              className={`${field} ${showErr("contactPhone") && phoneErr ? fieldBad : ""}`}
              inputMode="tel"
              placeholder="+255 712 345 678"
              aria-invalid={showErr("contactPhone") && !!phoneErr}
            />
            <Problem text={showErr("contactPhone") ? phoneErr : null} />
          </label>

          <label className={labelText}>
            Email
            <input
              value={value.contactEmail}
              onChange={(event) => set("contactEmail", event.target.value)}
              onBlur={touch("contactEmail")}
              className={`${field} ${showErr("contactEmail") && emailErr ? fieldBad : ""}`}
              type="email"
              placeholder="owner@lodge.co.tz"
              aria-invalid={showErr("contactEmail") && !!emailErr}
            />
            <Problem text={showErr("contactEmail") ? emailErr : null} />
          </label>
        </Section>

        <Section step={2} icon={MapPinned} title="Location" hint="Region, district and ward come from the official list, so leads in the same place match.">
          <label className={`${labelText} sm:col-span-2`}>
            Region
            <select
              value={value.region}
              onChange={(event) => setValue((current) => ({ ...current, region: event.target.value, district: "", ward: "" }))}
              className={field}
            >
              <option value="">Choose a region</option>
              {REGIONS_FULL_DATA.map((region) => (
                <option key={`${region.code || ""}-${region.name}`} value={region.name}>{locationLabel(region.name)}</option>
              ))}
            </select>
          </label>

          <label className={labelText}>
            District
            <select
              value={value.district}
              onChange={(event) => setValue((current) => ({ ...current, district: event.target.value, ward: "" }))}
              className={field}
              disabled={!selectedRegion}
            >
              <option value="">{selectedRegion ? "Choose a district" : "Choose a region first"}</option>
              {districts.map((district) => (
                <option key={`${district.code || ""}-${district.name}`} value={district.name}>{locationLabel(district.name)}</option>
              ))}
            </select>
          </label>

          <label className={labelText}>
            Ward
            <select value={value.ward} onChange={(event) => set("ward", event.target.value)} className={field} disabled={!selectedDistrict}>
              <option value="">{selectedDistrict ? "Choose a ward" : "Choose a district first"}</option>
              {wards.map((ward) => (
                <option key={`${ward.code || ""}-${ward.name}`} value={ward.name}>{locationLabel(ward.name)}</option>
              ))}
            </select>
          </label>

          <label className={`${labelText} sm:col-span-2`}>
            Street, area or landmark
            <input value={value.location} onChange={(event) => set("location", event.target.value)} className={field} placeholder="Mikocheni, near the main road" />
          </label>
        </Section>

        <Section step={3} icon={ClipboardCheck} title="Opportunity" hint="What you are proposing and when you will speak to them next.">
          <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2">
            <legend className={`${labelText} p-0`}>Proposed product</legend>
            <div className="mt-1.5 grid grid-cols-3 gap-2" role="radiogroup">
              {PRODUCTS.map(({ value: product, title, hint, Icon }) => {
                const on = value.proposedProduct === product;
                return (
                  <button
                    key={product}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set("proposedProduct", product)}
                    className={`flex min-w-0 items-start gap-2 rounded-md border border-solid px-3 py-2.5 text-left transition ${on ? "border-[#02665e] bg-[#02665e]/[0.06] ring-1 ring-[#02665e]" : "border-slate-300 bg-white hover:border-slate-400"}`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${on ? "text-[#02665e]" : "text-slate-400"}`} aria-hidden />
                    <span className="min-w-0">
                      <span className={`block truncate text-[13px] font-semibold ${on ? "text-[#02665e]" : "text-slate-800"}`}>{title}</span>
                      <span className="block truncate text-[11px] text-slate-500">{hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className={labelText}>
            Estimated rooms
            <input
              value={value.estimatedRooms}
              onChange={(event) => set("estimatedRooms", event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
              onBlur={touch("estimatedRooms")}
              className={`${field} ${showErr("estimatedRooms") && roomsErr ? fieldBad : ""}`}
              inputMode="numeric"
              placeholder="12"
            />
            <Problem text={showErr("estimatedRooms") ? roomsErr : null} />
          </label>

          <div className="min-w-0 sm:col-span-2">
            <SalesDateTimeField label="Next follow-up" value={value.nextFollowUpAt} onChangeAction={(next) => set("nextFollowUpAt", next)} />
          </div>

          <label className={labelText}>
            Registration number
            <input value={value.registrationNumber} onChange={(event) => set("registrationNumber", event.target.value)} className={field} placeholder="BRELA or licence number" />
          </label>

          <label className={labelText}>
            Tax number
            <input value={value.taxNumber} onChange={(event) => set("taxNumber", event.target.value)} className={field} placeholder="TIN" />
          </label>

          <label className={`${labelText} sm:col-span-2`}>
            Notes
            <textarea
              value={value.notes}
              onChange={(event) => set("notes", event.target.value)}
              className={`${field} h-auto min-h-24 resize-y py-2 leading-5`}
              maxLength={5000}
              placeholder="What they need, what they use today, and what you agreed"
            />
            <span className="mt-1 block text-right text-[11px] tabular-nums text-slate-400">{value.notes.length} / 5000</span>
          </label>
        </Section>
      </div>

      {/* Lead check */}
      <aside className="min-w-0 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white lg:sticky lg:top-4">
        <div className="border-0 border-b border-solid border-slate-100 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-sm font-semibold text-slate-900">Lead check</h2>
            <span className={`text-[12px] font-semibold tabular-nums ${percent >= 70 ? "text-[#02665e]" : "text-slate-500"}`}>{percent}% complete</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-[#02665e] transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <ul className="m-0 list-none space-y-1.5 px-4 py-3">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-[12px]">
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${c.ok ? "bg-[#02665e] text-white" : "border border-solid border-slate-300 bg-white"}`}>
                {c.ok ? <Check className="h-2.5 w-2.5" aria-hidden /> : null}
              </span>
              <span className={c.ok ? "text-slate-700" : "text-slate-500"}>{c.label}</span>
              {c.need && !c.ok ? <span className="ml-auto text-[11px] font-semibold text-rose-600">Required</span> : null}
            </li>
          ))}
        </ul>
        <div className="space-y-2 border-0 border-t border-solid border-slate-100 px-4 py-3 text-[12px] leading-5 text-slate-600">
          <p className="m-0 flex gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />{initial ? "Logging progress keeps this lead protected for you." : "Once saved, this lead is protected for you for 60 days. Logging calls, meetings and proposals extends it."}</p>
          <p className="m-0 flex gap-2"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />Phone, email, registration and tax numbers are checked against every lead. A match is saved and flagged for review, not refused.</p>
        </div>
        <div className="border-0 border-t border-solid border-slate-100 p-4">
          {tried && blocked ? <p className="m-0 mb-2 text-[12px] font-medium text-rose-700" role="alert">Fix the fields marked in red first.</p> : null}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {submitting ? "Saving" : submitLabel}
          </button>
          {!initial ? <p className="m-0 mt-2 text-center text-[11px] text-slate-400">Calls and meetings go in the lead&apos;s activity timeline after this.</p> : null}
        </div>
      </aside>
    </form>
  );
}
