"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  ClipboardCheck,
  MapPinned,
  Send,
  UserRound,
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

const inputClass =
  "mt-1.5 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const labelClass = "block text-xs font-bold text-slate-700";

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

export default function SalesLeadForm({
  initial,
  submitLabel,
  submitting,
  onSubmit,
}: {
  initial?: Partial<SalesLeadFormValue>;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (value: SalesLeadFormValue) => Promise<void> | void;
}) {
  const [value, setValue] = useState<SalesLeadFormValue>({ ...EMPTY, ...initial });
  const set = <K extends keyof SalesLeadFormValue>(key: K, next: SalesLeadFormValue[K]) =>
    setValue((current) => ({ ...current, [key]: next }));

  const selectedRegion = useMemo(
    () => REGIONS_FULL_DATA.find((region) => locationKey(region.name) === locationKey(value.region)),
    [value.region],
  );
  const districts = selectedRegion?.districts || [];
  const selectedDistrict = useMemo(
    () => districts.find((district) => locationKey(district.name) === locationKey(value.district)),
    [districts, value.district],
  );
  const wards = selectedDistrict?.wards || [];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(value);
      }}
      className="space-y-4"
    >
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
            <Building2 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="m-0 text-sm font-black text-slate-900">Property and contact</h2>
            <p className="mb-0 mt-0.5 text-[10px] text-slate-400">Core prospect identity and the primary decision-maker.</p>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>
            Property name <span className="text-red-500">*</span>
            <input
              required
              minLength={2}
              maxLength={200}
              value={value.propertyName}
              onChange={(event) => set("propertyName", event.target.value)}
              className={inputClass}
              placeholder="Enter the official or trading name"
            />
          </label>

          <label className={labelClass}>
            Property type
            <select
              value={value.propertyType}
              onChange={(event) => set("propertyType", event.target.value)}
              className={inputClass}
            >
              <option value="">Select property type</option>
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Contact person
            <input
              value={value.contactPerson}
              onChange={(event) => set("contactPerson", event.target.value)}
              className={inputClass}
              placeholder="Full name"
            />
          </label>

          <label className={labelClass}>
            Phone
            <input
              value={value.contactPhone}
              onChange={(event) => set("contactPhone", event.target.value)}
              className={inputClass}
              inputMode="tel"
              placeholder="+255 ..."
            />
          </label>

          <label className={labelClass}>
            Email
            <input
              value={value.contactEmail}
              onChange={(event) => set("contactEmail", event.target.value)}
              className={inputClass}
              type="email"
              placeholder="name@example.com"
            />
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-700">
            <MapPinned className="h-4 w-4" />
          </span>
          <div>
            <h2 className="m-0 text-sm font-black text-slate-900">Property location</h2>
            <p className="mb-0 mt-0.5 text-[10px] text-slate-400">Select the hierarchy in order, then add a useful street or landmark.</p>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className={labelClass}>
            Region
            <select
              value={value.region}
              onChange={(event) => {
                setValue((current) => ({
                  ...current,
                  region: event.target.value,
                  district: "",
                  ward: "",
                }));
              }}
              className={inputClass}
            >
              <option value="">Select region</option>
              {REGIONS_FULL_DATA.map((region) => (
                <option key={`${region.code || ""}-${region.name}`} value={region.name}>
                  {locationLabel(region.name)}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            District
            <select
              value={value.district}
              onChange={(event) => {
                setValue((current) => ({
                  ...current,
                  district: event.target.value,
                  ward: "",
                }));
              }}
              className={inputClass}
              disabled={!selectedRegion}
            >
              <option value="">{selectedRegion ? "Select district" : "Select region first"}</option>
              {districts.map((district) => (
                <option key={`${district.code || ""}-${district.name}`} value={district.name}>
                  {locationLabel(district.name)}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Ward
            <select
              value={value.ward}
              onChange={(event) => set("ward", event.target.value)}
              className={inputClass}
              disabled={!selectedDistrict}
            >
              <option value="">{selectedDistrict ? "Select ward" : "Select district first"}</option>
              {wards.map((ward) => (
                <option key={`${ward.code || ""}-${ward.name}`} value={ward.name}>
                  {locationLabel(ward.name)}
                </option>
              ))}
            </select>
          </label>

          <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
            Street, area or nearby landmark
            <input
              value={value.location}
              onChange={(event) => set("location", event.target.value)}
              className={inputClass}
              placeholder="For example: Mikocheni, near the main road"
            />
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-700">
            <ClipboardCheck className="h-4 w-4" />
          </span>
          <div>
            <h2 className="m-0 text-sm font-black text-slate-900">Opportunity details</h2>
            <p className="mb-0 mt-0.5 text-[10px] text-slate-400">Qualification, product interest and the next accountable action.</p>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <label className={labelClass}>
            Estimated rooms
            <input
              value={value.estimatedRooms}
              onChange={(event) => set("estimatedRooms", event.target.value)}
              className={inputClass}
              type="number"
              min={1}
              max={100000}
              placeholder="Number of rooms"
            />
          </label>

          <label className={labelClass}>
            Proposed product
            <select
              value={value.proposedProduct}
              onChange={(event) => set("proposedProduct", event.target.value as SalesLeadFormValue["proposedProduct"])}
              className={inputClass}
            >
              <option value="NRMS">NRMS</option>
              <option value="MARKETPLACE">Marketplace</option>
              <option value="NRMS_AND_MARKETPLACE">NRMS and marketplace</option>
            </select>
          </label>

          <div className="sm:col-span-2">
            <SalesDateTimeField
              label="Next follow-up"
              value={value.nextFollowUpAt}
              onChangeAction={(next) => set("nextFollowUpAt", next)}
            />
          </div>

          <label className={labelClass}>
            Registration number
            <input
              value={value.registrationNumber}
              onChange={(event) => set("registrationNumber", event.target.value)}
              className={inputClass}
              placeholder="Optional"
            />
          </label>

          <label className={labelClass}>
            Tax number
            <input
              value={value.taxNumber}
              onChange={(event) => set("taxNumber", event.target.value)}
              className={inputClass}
              placeholder="Optional"
            />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Notes
            <textarea
              value={value.notes}
              onChange={(event) => set("notes", event.target.value)}
              className={`${inputClass} min-h-28 resize-y`}
              maxLength={5000}
              placeholder="Add useful context, requirements or agreed next steps"
            />
          </label>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-emerald-900/70">
          <UserRound className="h-4 w-4 shrink-0 text-emerald-700" />
          The prospect is recorded under your active sales workspace.
        </div>
        <button
          type="submit"
          disabled={submitting || value.propertyName.trim().length < 2}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#073c35] px-5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          <Send className="h-4 w-4" />
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
