"use client";

/**
 * One region list for every place that creates a sales partner (Promote user,
 * team invite approval). The partner code is built from the region, so free
 * text would let "Dar", "Dar es salaam" and "DSM" drift into three codes.
 */
export const TANZANIA_REGIONS = [
  "Arusha", "Dar es Salaam", "Dodoma", "Geita", "Iringa", "Kagera", "Katavi", "Kigoma", "Kilimanjaro",
  "Lindi", "Manyara", "Mara", "Mbeya", "Morogoro", "Mtwara", "Mwanza", "Njombe", "Pwani", "Rukwa",
  "Ruvuma", "Shinyanga", "Simiyu", "Singida", "Songwe", "Tabora", "Tanga",
  "Pemba North", "Pemba South", "Zanzibar North", "Zanzibar South", "Zanzibar Urban West",
] as const;

/** The closest listed region for a stored value, or "" when none matches. */
export function matchRegion(value: string | null | undefined): string {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  return TANZANIA_REGIONS.find((r) => r.toLowerCase() === v) ?? TANZANIA_REGIONS.find((r) => v.startsWith(r.toLowerCase().split(" ")[0])) ?? "";
}

export default function RegionSelect({
  value,
  onChange,
  className = "",
  id,
}: {
  value: string;
  onChange: (region: string) => void;
  className?: string;
  id?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={className} aria-label="Region">
      <option value="">Choose a region</option>
      {TANZANIA_REGIONS.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}
