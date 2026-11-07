"use client";

/**
 * Pick a sales partner by name or partner code, never by typing a database id.
 * Searches active partners; the chosen partner's internal key stays in code.
 */
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type PickedPartner = { id: number; name: string; agentCode: string; region: string | null };

export default function SalesPartnerPicker({
  value,
  onChange,
  excludeIds = [],
  placeholder = "Search name or partner code",
  className = "",
}: {
  value: PickedPartner | null;
  onChange: (partner: PickedPartner | null) => void;
  excludeIds?: number[];
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedPartner[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A stable key: the default `[]` (or an inline array from the parent) is a
  // new array every render, which re-ran this effect and looped forever.
  const excludeKey = excludeIds.join(",");

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults((prev) => (prev.length ? [] : prev));
      return;
    }
    const excluded = new Set(excludeKey ? excludeKey.split(",").map(Number) : []);
    timer.current = setTimeout(async () => {
      try {
        const { data } = await apiClient.get("/api/admin/sales/partners", { params: { q: query.trim(), status: "ACTIVE", pageSize: 8 } });
        setResults(
          (data.partners ?? [])
            .filter((p: any) => !excluded.has(p.id))
            .map((p: any) => ({ id: p.id, name: p.user?.name || p.user?.email || "Partner", agentCode: p.agentCode, region: p.region ?? null })),
        );
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, excludeKey]);

  if (value) {
    return (
      <span className={`inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-2 text-xs text-emerald-900 ${className}`}>
        <span className="truncate font-semibold">{value.name}</span>
        <span className="font-mono text-emerald-700">{value.agentCode}</span>
        <button type="button" onClick={() => onChange(null)} className="ml-auto border-0 bg-transparent p-0 text-emerald-700" aria-label="Clear partner">
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="h-8 w-full min-w-0 rounded-md border border-solid border-neutral-200 pl-7 pr-2 text-xs outline-none focus:border-emerald-400"
        aria-label="Find a sales partner"
      />
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-9 z-20 m-0 max-h-56 list-none overflow-y-auto rounded-md border border-solid border-neutral-200 bg-white p-1 shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded border-0 bg-transparent px-2 py-1.5 text-left text-xs text-neutral-800 [font-family:inherit] hover:bg-neutral-50"
              >
                <span className="truncate font-semibold">{p.name}</span>
                <span className="shrink-0 text-neutral-500"><span className="font-mono">{p.agentCode}</span>{p.region ? ` · ${p.region}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
