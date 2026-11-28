"use client";

import { useId, useState } from "react";
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { Check, ChevronDown, Pencil } from "lucide-react";

export function RoomTypePicker({ value, groups, onChange }: {
  value: string;
  groups: ReadonlyArray<{ label: string; names: readonly string[] }>;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const helpId = useId();
  const filtered = groups.map((group) => ({ ...group, names: group.names.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase())) })).filter((group) => group.names.length);
  const showOther = "other".includes(query.trim().toLowerCase());
  return <Combobox value={value} onChange={(next) => { if (next) onChange(next); }} onClose={() => setQuery("")} immediate>
    <div className="ap-room-type-picker">
      <ComboboxInput id="room-type" className={`ap-select ap-room-type-input${value ? " is-set" : ""}`} displayValue={(selected: string) => selected === "__custom__" ? "Custom room name" : selected || ""}
        placeholder="Search or select a room type" autoComplete="off" spellCheck={false} aria-describedby={helpId} onChange={(event) => setQuery(event.target.value)} />
      <ComboboxButton className="ap-room-type-trigger" aria-label="Show room types"><ChevronDown aria-hidden /></ComboboxButton>
      <span id={helpId} className="sr-only">Type to search. Use the arrow keys to choose a room type and Enter to select.</span>
    </div>
    <ComboboxOptions anchor={{ to: "bottom start", gap: 6, padding: 12 }} portal modal={false} className="ap-room-type-options">
      {filtered.map((group) => <div key={group.label} role="group" aria-label={group.label}>
        <div className="ap-room-type-group" aria-hidden>{group.label}</div>
        {group.names.map((name) => <ComboboxOption key={name} value={name} className="ap-room-type-option">{({ selected }) => <><span>{name}</span>{selected ? <Check aria-hidden /> : null}</>}</ComboboxOption>)}
      </div>)}
      {showOther ? <ComboboxOption value="Other" className="ap-room-type-option">{({ selected }) => <><span>Other</span>{selected ? <Check aria-hidden /> : null}</>}</ComboboxOption> : null}
      {!filtered.length && !showOther ? <p className="ap-room-type-empty">No matching room types. You can use a custom name.</p> : null}
      <ComboboxOption value="__custom__" className="ap-room-type-option ap-room-type-custom">{({ selected }) => <><span><Pencil aria-hidden />Custom room name</span>{selected ? <Check aria-hidden /> : null}</>}</ComboboxOption>
    </ComboboxOptions>
  </Combobox>;
}
