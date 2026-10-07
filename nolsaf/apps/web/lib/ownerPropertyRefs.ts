"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";

/**
 * Owner property pages carry an opaque pp_ reference in the URL, never the
 * database id. The API hands over every {id, ref} pair for the owner's own
 * properties in one call; this module caches it for the session.
 *
 * - useOwnerPropertyHref() gives `href(id, suffix)` for links.
 * - ownerPropertyPath(id, suffix) resolves a path for router.push.
 * - useOwnerPropertyId(param) turns the address-bar value back into the id the
 *   page uses for its API calls, and swaps an old numeric URL for the reference.
 *
 * While references load, href falls back to the numeric path; the page then
 * replaces it with the reference, so a fast click still lands.
 */
const refById = new Map<number, string>();
const idByRef = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;
let inflight: Promise<void> | null = null;
let loaded = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function toId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Fetches the owner's references. `force` refetches, for a property added after the first load. */
export function loadOwnerPropertyRefs(force = false): Promise<void> {
  if (inflight) return inflight;
  if (loaded && !force) return Promise.resolve();
  inflight = apiClient
    .get<{ refs?: Array<{ id: number; ref: string }> }>("/api/owner/properties/refs")
    .then((res) => {
      (res.data?.refs ?? []).forEach(({ id, ref }) => {
        const n = toId(id);
        if (!n || !ref) return;
        refById.set(n, String(ref));
        idByRef.set(String(ref), n);
      });
      loaded = true;
    })
    .catch(() => {
      // Links keep their numeric fallback.
    })
    .finally(() => {
      inflight = null;
      version += 1;
      listeners.forEach((listener) => listener());
    });
  return inflight;
}

function buildPath(segment: string | number, suffix = "") {
  return `/owner/properties/${encodeURIComponent(String(segment))}${suffix}`;
}

/** The cached reference for a property, or null (and fetches in the background). */
export function ownerPropertyRef(id: unknown): string | null {
  const n = toId(id);
  if (!n) return null;
  const hit = refById.get(n);
  if (!hit && !loaded) void loadOwnerPropertyRefs();
  return hit ?? null;
}

/** For query strings: the reference when cached, else the id. Pair with useOwnerPropertyHref() so it re-renders. */
export function ownerPropertyRefOrId(id: unknown): string {
  return ownerPropertyRef(id) ?? String(id ?? "");
}

/** Path for router.push, resolved to the reference. */
export async function ownerPropertyPath(id: unknown, suffix = ""): Promise<string> {
  const n = toId(id);
  if (n && !refById.has(n)) await loadOwnerPropertyRefs(loaded);
  return buildPath(ownerPropertyRefOrId(id), suffix);
}

/**
 * Link builder that re-renders once references arrive.
 *   const href = useOwnerPropertyHref();
 *   <Link href={href(property.id, "/availability")} />
 */
export function useOwnerPropertyHref() {
  const current = useSyncExternalStore(subscribe, () => version, () => 0);
  return useCallback(
    (id: unknown, suffix = "") => buildPath(ownerPropertyRefOrId(id), suffix),
    // `current` changes when references land, so links pick them up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current],
  );
}

/** Resolves a reference string (from a path or query) to the id, without touching the URL. */
export async function resolveOwnerPropertyRef(value: string): Promise<number | null> {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const numeric = toId(raw);
  if (numeric && /^\d+$/.test(raw)) return numeric;
  if (!idByRef.has(raw)) await loadOwnerPropertyRefs(loaded);
  return idByRef.get(raw) ?? null;
}

export type OwnerPropertyState = { id: number | null; loading: boolean; error: string | null };

/**
 * Resolves the address-bar value of a property page to the property id.
 * A legacy numeric value works straight away and the URL is replaced with the
 * reference version via `canonical`, which receives the reference.
 */
export function useOwnerPropertyId(
  raw: string | string[] | null | undefined,
  canonical?: (ref: string) => string,
): OwnerPropertyState {
  const router = useRouter();
  const value = String(Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
  const numeric = /^\d+$/.test(value) ? Number(value) : null;
  const known = numeric ?? (value ? idByRef.get(value) ?? null : null);
  const [state, setState] = useState<OwnerPropertyState>(() =>
    known ? { id: known, loading: false, error: null } : { id: null, loading: Boolean(value), error: value ? null : "Missing property" },
  );

  useEffect(() => {
    let cancelled = false;
    if (numeric) {
      setState((prev) => (prev.id === numeric && !prev.loading ? prev : { id: numeric, loading: false, error: null }));
      if (canonical) {
        void ownerPropertyPath(numeric).then(() => {
          const ref = refById.get(numeric);
          if (!cancelled && ref) router.replace(canonical(ref), { scroll: false });
        });
      }
      return () => {
        cancelled = true;
      };
    }
    if (!value) {
      setState({ id: null, loading: false, error: "Missing property" });
      return;
    }
    if (known) {
      setState((prev) => (prev.id === known && !prev.loading ? prev : { id: known, loading: false, error: null }));
      return;
    }
    setState({ id: null, loading: true, error: null });
    void resolveOwnerPropertyRef(value).then((id) => {
      if (cancelled) return;
      setState(id ? { id, loading: false, error: null } : { id: null, loading: false, error: "Property not found" });
    });
    return () => {
      cancelled = true;
    };
    // `canonical` is a path builder; re-running when its identity changes is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, numeric, known, router]);

  return state;
}
