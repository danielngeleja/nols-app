"use client";

import { useId, useState } from "react";
import { CheckCircle2, Globe } from "lucide-react";

// Same list and behaviour as the public booking confirm page, so a guest's
// nationality reads identically whether they booked online or at the desk.
// Tanzania and the region first, then common visitor origins.
export const NATIONALITIES: string[] = [
  "Tanzanian", "Kenyan", "Ugandan", "Rwandan", "Burundian", "Congolese", "Zambian", "Malawian", "Mozambican",
  "South Sudanese", "Somali", "Ethiopian", "Comorian", "South African", "Zimbabwean", "Botswanan", "Namibian",
  "Nigerian", "Ghanaian", "Egyptian", "Moroccan", "Algerian", "Tunisian", "Sudanese", "Senegalese", "Cameroonian",
  "Ivorian", "Malagasy", "Mauritian", "Angolan",
  "British", "American", "Canadian", "German", "French", "Italian", "Spanish", "Dutch", "Belgian", "Swiss",
  "Swedish", "Norwegian", "Danish", "Finnish", "Irish", "Polish", "Portuguese", "Russian", "Ukrainian", "Czech",
  "Austrian", "Chinese", "Indian", "Pakistani", "Japanese", "Korean", "Emirati", "Saudi", "Omani", "Qatari",
  "Israeli", "Turkish", "Iranian", "Australian", "New Zealander", "Brazilian", "Mexican", "Argentine",
];

const OTHER = "__other__";

function sanitize(value: string): string {
  return String(value ?? "").replace(/\d+/g, "").replace(/\s+/g, " ");
}

/**
 * Type to search a known list; anything else is kept as typed ("Other").
 */
export default function NationalityPicker({
  value,
  onChange,
  inputClassName,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  inputClassName: string;
  hint?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listId = useId();

  const q = value.trim().toLowerCase();
  const known = NATIONALITIES.some((n) => n.toLowerCase() === q);
  const matches = (q
    ? NATIONALITIES.filter((n) => n.toLowerCase().startsWith(q)).concat(
        NATIONALITIES.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q)),
      )
    : NATIONALITIES.slice(0, 8)
  ).slice(0, 7);
  const showOther = q.length >= 2 && !known;
  const options = [...matches, ...(showOther ? [OTHER] : [])];

  const pick = (next: string) => {
    onChange(sanitize(next).trim());
    setOpen(false);
  };

  return (
    <span className="relative block">
      <span className="relative block">
        <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
        <input
          type="text"
          required
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          onFocus={() => { setOpen(true); setCursor(0); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => { onChange(sanitize(event.target.value)); setOpen(true); setCursor(0); }}
          onKeyDown={(event) => {
            if (!open || options.length === 0) return;
            if (event.key === "ArrowDown") { event.preventDefault(); setCursor((c) => Math.min(options.length - 1, c + 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            else if (event.key === "Enter") { event.preventDefault(); const chosen = options[cursor]; pick(chosen === OTHER ? value : chosen); }
            else if (event.key === "Escape") setOpen(false);
          }}
          className={`${inputClassName} pl-9 pr-16`}
          placeholder="Search, e.g. Tanzanian"
        />
        {known ? (
          <CheckCircle2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" aria-hidden />
        ) : value.trim() ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-neutral-500">Other</span>
        ) : null}
      </span>

      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 m-0 mt-1 max-h-64 list-none overflow-y-auto rounded-xl border border-solid border-neutral-200 bg-white p-1 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.35)]"
        >
          {options.map((option, index) => {
            const active = index === cursor;
            const isOther = option === OTHER;
            return (
              <li
                key={option}
                role="option"
                aria-selected={active}
                onMouseDown={(event) => { event.preventDefault(); pick(isOther ? value : option); }}
                onMouseEnter={() => setCursor(index)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${active ? "bg-[#02665e]/[0.07] text-[#02665e]" : "text-neutral-700"} ${isOther ? "mt-1 border-0 border-t border-solid border-neutral-100" : ""}`}
              >
                {isOther ? (
                  <span className="min-w-0 truncate">
                    Use <span className="font-semibold">&ldquo;{value.trim()}&rdquo;</span>
                    <span className="ml-1.5 text-xs text-neutral-400">Other</span>
                  </span>
                ) : (
                  <span className="min-w-0 truncate">{option}</span>
                )}
                {!isOther && option.toLowerCase() === q && <CheckCircle2 className="h-4 w-4 flex-none text-[#02665e]" aria-hidden />}
              </li>
            );
          })}
        </ul>
      )}

      {hint && !open && <span className="mt-1.5 block text-[11px] text-neutral-400">{hint}</span>}
    </span>
  );
}
