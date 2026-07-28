"use client";

import { useState } from "react";
import SalesDateTimeField from "@/components/sales/SalesDateTimeField";

export type SalesLeadFormValue = {
  propertyName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  location: string;
  region: string;
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
  propertyType: "",
  estimatedRooms: "",
  registrationNumber: "",
  taxNumber: "",
  proposedProduct: "NRMS",
  nextFollowUpAt: "",
  notes: "",
};

export function toSalesLeadPayload(value: SalesLeadFormValue) {
  const optional = (input: string) => input.trim() || null;
  return {
    propertyName: value.propertyName.trim(),
    contactPerson: optional(value.contactPerson),
    contactPhone: optional(value.contactPhone),
    contactEmail: optional(value.contactEmail),
    location: optional(value.location),
    region: optional(value.region),
    propertyType: optional(value.propertyType),
    estimatedRooms: value.estimatedRooms ? Number(value.estimatedRooms) : null,
    registrationNumber: optional(value.registrationNumber),
    taxNumber: optional(value.taxNumber),
    proposedProduct: value.proposedProduct,
    nextFollowUpAt: value.nextFollowUpAt ? new Date(value.nextFollowUpAt).toISOString() : null,
    notes: optional(value.notes),
  };
}

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

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

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(value);
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <label className="text-sm font-medium text-gray-800 sm:col-span-2">
        Property name
        <input
          required
          minLength={2}
          maxLength={200}
          value={value.propertyName}
          onChange={(event) => set("propertyName", event.target.value)}
          className={inputClass}
        />
      </label>

      <label className="text-sm font-medium text-gray-800">
        Contact person
        <input value={value.contactPerson} onChange={(event) => set("contactPerson", event.target.value)} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-gray-800">
        Phone
        <input value={value.contactPhone} onChange={(event) => set("contactPhone", event.target.value)} className={inputClass} inputMode="tel" />
      </label>
      <label className="text-sm font-medium text-gray-800">
        Email
        <input value={value.contactEmail} onChange={(event) => set("contactEmail", event.target.value)} className={inputClass} type="email" />
      </label>
      <label className="text-sm font-medium text-gray-800">
        Location
        <input value={value.location} onChange={(event) => set("location", event.target.value)} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-gray-800">
        Region
        <input value={value.region} onChange={(event) => set("region", event.target.value)} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-gray-800">
        Property type
        <input
          value={value.propertyType}
          onChange={(event) => set("propertyType", event.target.value)}
          className={inputClass}
          placeholder="Hotel, lodge, apartment"
        />
      </label>
      <label className="text-sm font-medium text-gray-800">
        Estimated rooms
        <input
          value={value.estimatedRooms}
          onChange={(event) => set("estimatedRooms", event.target.value)}
          className={inputClass}
          type="number"
          min={1}
          max={100000}
        />
      </label>
      <label className="text-sm font-medium text-gray-800">
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
      <SalesDateTimeField
        label="Next follow-up"
        value={value.nextFollowUpAt}
        onChangeAction={(next) => set("nextFollowUpAt", next)}
      />
      <label className="text-sm font-medium text-gray-800">
        Registration number
        <input value={value.registrationNumber} onChange={(event) => set("registrationNumber", event.target.value)} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-gray-800">
        Tax number
        <input value={value.taxNumber} onChange={(event) => set("taxNumber", event.target.value)} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-gray-800 sm:col-span-2">
        Notes
        <textarea
          value={value.notes}
          onChange={(event) => set("notes", event.target.value)}
          className={`${inputClass} min-h-28`}
          maxLength={5000}
        />
      </label>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={submitting || value.propertyName.trim().length < 2}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
