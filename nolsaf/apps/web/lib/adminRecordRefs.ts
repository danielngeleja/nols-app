"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";

/**
 * Admin page URLs carry opaque references (us_..., ow_..., bk_...) instead of
 * database ids. References are HMACs made on the API, so the browser asks for
 * them in batches and caches them for the session.
 *
 * - useAdminHref() gives a `href(kind, id)` function for links.
 * - adminPath(kind, id) resolves a path for router.push.
 * - useAdminRecordId(kind, param) turns the address-bar value back into the id
 *   a page uses for its API calls, and swaps an old numeric URL for the
 *   reference one.
 *
 * While a reference is still loading, href falls back to the numeric path; the
 * detail page then replaces it with the reference, so a fast click still works.
 */
export type AdminRecordKind =
  | "booking" | "user" | "owner" | "driver" | "agent" | "tour" | "cancellation" | "tour-case"
  | "disbursement-batch" | "property" | "merchant-application" | "transport-payout" | "owner-invoice" | "group-stay";

/** Default detail page for each kind. */
export const ADMIN_RECORD_BASE: Record<AdminRecordKind, string> = {
  booking: "/admin/bookings",
  user: "/admin/users",
  owner: "/admin/owners",
  driver: "/admin/drivers/audit",
  agent: "/admin/agents",
  tour: "/admin/agents/tour-revenue",
  cancellation: "/admin/cancellations",
  "tour-case": "/admin/cancellations/tours",
  "disbursement-batch": "/admin/disbursements/batches",
  property: "/admin/nrms",
  "merchant-application": "/admin/nrms/merchants",
  "transport-payout": "/admin/drivers/invoices/review",
  "owner-invoice": "/admin/revenue",
  "group-stay": "/admin/group-stays/bookings",
};

const cache = new Map<string, string>();
/** Reverse of `cache` ("kind:ref" -> id), so a page opened from a link resolves without a round trip. */
const ids = new Map<string, number>();
const pending = new Set<string>();
const waiters = new Map<string, Array<(ref: string | null) => void>>();
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function toId(id: unknown): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function remember(key: string, ref: string) {
  cache.set(key, ref);
  const at = key.indexOf(":");
  ids.set(`${key.slice(0, at)}:${ref}`, Number(key.slice(at + 1)));
}

async function flush() {
  timer = null;
  const keys = Array.from(pending);
  pending.clear();
  if (!keys.length) return;
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    try {
      const items = chunk.map((key) => {
        const at = key.indexOf(":");
        return { kind: key.slice(0, at), id: Number(key.slice(at + 1)) };
      });
      const res = await apiClient.post<{ refs?: Record<string, string> }>("/api/admin/record-refs/batch", { items });
      Object.entries(res.data?.refs ?? {}).forEach(([key, ref]) => remember(key, String(ref)));
    } catch {
      // Links keep their numeric fallback; detail pages still canonicalize.
    }
  }
  keys.forEach((key) => {
    const list = waiters.get(key);
    if (!list) return;
    waiters.delete(key);
    list.forEach((resolve) => resolve(cache.get(key) ?? null));
  });
  emit();
}

function request(key: string) {
  if (cache.has(key) || pending.has(key)) return;
  pending.add(key);
  if (!timer) timer = setTimeout(() => void flush(), 15);
}

/** The cached reference for a record, or null (and fetches it in the background). */
export function adminRecordRef(kind: AdminRecordKind, id: unknown): string | null {
  const n = toId(id);
  if (!n) return null;
  const key = `${kind}:${n}`;
  const hit = cache.get(key);
  if (!hit) request(key);
  return hit ?? null;
}

/** For query strings: the reference when cached, else the id. Pair with useAdminHref() so the component re-renders when it lands. */
export function adminRefOrId(kind: AdminRecordKind, id: unknown): string {
  return adminRecordRef(kind, id) ?? String(id ?? "");
}

/** Waits for a record's reference. */
export function loadAdminRecordRef(kind: AdminRecordKind, id: unknown): Promise<string | null> {
  const n = toId(id);
  if (!n) return Promise.resolve(null);
  const key = `${kind}:${n}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const list = waiters.get(key) ?? [];
    list.push(resolve);
    waiters.set(key, list);
    request(key);
  });
}

type HrefOptions = { base?: string; suffix?: string };

function buildPath(kind: AdminRecordKind, segment: string | number, options?: HrefOptions) {
  return `${options?.base ?? ADMIN_RECORD_BASE[kind]}/${encodeURIComponent(String(segment))}${options?.suffix ?? ""}`;
}

/** Path for router.push and similar, resolved to the reference. */
export async function adminPath(kind: AdminRecordKind, id: unknown, options?: HrefOptions): Promise<string> {
  const ref = await loadAdminRecordRef(kind, id);
  return buildPath(kind, ref ?? String(id), options);
}

/**
 * Link builder that re-renders the component once references arrive.
 *   const href = useAdminHref();
 *   <Link href={href("owner", owner.id)} />
 *   <Link href={href("property", id, { base: "/admin/nrms/integrity" })} />
 */
export function useAdminHref() {
  const current = useSyncExternalStore(subscribe, () => version, () => 0);
  return useCallback(
    (kind: AdminRecordKind, id: unknown, options?: HrefOptions) => {
      const ref = adminRecordRef(kind, id);
      return buildPath(kind, ref ?? String(id ?? ""), options);
    },
    // `current` changes when new references land, so links pick them up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current],
  );
}

/**
 * Resolves a record carried in the query string (for example `?driverId=dv_...`)
 * to its id, or null while it resolves or when absent. A legacy numeric value
 * works straight away and is swapped for the reference in the address bar.
 */
export function useAdminQueryId(kind: AdminRecordKind, raw: string | null | undefined, name: string): number | null {
  const value = String(raw ?? "").trim();
  const numeric = /^\d+$/.test(value) ? Number(value) : null;
  const known = numeric ?? (value ? ids.get(`${kind}:${value}`) ?? null : null);
  const [resolved, setResolved] = useState<{ value: string; id: number | null }>({ value: "", id: null });

  useEffect(() => {
    let cancelled = false;
    if (numeric) {
      void loadAdminRecordRef(kind, numeric).then((ref) => {
        if (cancelled || !ref || typeof window === "undefined") return;
        const url = new URL(window.location.href);
        if (url.searchParams.get(name) !== value) return;
        url.searchParams.set(name, ref);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      });
    } else if (value && !known) {
      apiClient
        .get<{ id: number }>("/api/admin/record-refs/resolve", { params: { kind, ref: value } })
        .then((res) => {
          const id = toId(res.data?.id);
          if (id) remember(`${kind}:${id}`, value);
          if (!cancelled) setResolved({ value, id });
        })
        .catch(() => {
          if (!cancelled) setResolved({ value, id: null });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [kind, name, value, numeric, known]);

  if (known) return known;
  return resolved.value === value ? resolved.id : null;
}

export type AdminRecordState ={ id: number | null; loading: boolean; error: string | null };

/**
 * Resolves the address-bar value of a detail page to the record id.
 * A legacy numeric value resolves immediately and the URL is replaced with the
 * reference version (via `canonical`, which receives the reference).
 */
export function useAdminRecordId(
  kind: AdminRecordKind,
  raw: string | string[] | null | undefined,
  canonical?: (ref: string) => string,
): AdminRecordState {
  const router = useRouter();
  const value = String(Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
  const numeric = /^\d+$/.test(value) ? Number(value) : null;
  const known = numeric ? null : ids.get(`${kind}:${value}`) ?? null;
  const [state, setState] = useState<AdminRecordState>(() =>
    numeric || known
      ? { id: numeric ?? known, loading: false, error: null }
      : { id: null, loading: Boolean(value), error: value ? null : "Missing record reference" },
  );

  useEffect(() => {
    let cancelled = false;
    if (known) {
      setState((prev) => (prev.id === known && !prev.loading ? prev : { id: known, loading: false, error: null }));
      return;
    }
    if (numeric) {
      setState((prev) => (prev.id === numeric && !prev.loading ? prev : { id: numeric, loading: false, error: null }));
      if (canonical) {
        void loadAdminRecordRef(kind, numeric).then((ref) => {
          if (!cancelled && ref) router.replace(canonical(ref), { scroll: false });
        });
      }
      return () => {
        cancelled = true;
      };
    }
    if (!value) {
      setState({ id: null, loading: false, error: "Missing record reference" });
      return;
    }
    setState({ id: null, loading: true, error: null });
    apiClient
      .get<{ id: number }>("/api/admin/record-refs/resolve", { params: { kind, ref: value } })
      .then((res) => {
        if (cancelled) return;
        const id = toId(res.data?.id);
        if (id) remember(`${kind}:${id}`, value);
        setState(id ? { id, loading: false, error: null } : { id: null, loading: false, error: "Record not found" });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setState({ id: null, loading: false, error: err?.response?.status === 404 ? "Record not found" : "Could not open this record" });
      });
    return () => {
      cancelled = true;
    };
    // `canonical` is a path builder; re-running when its identity changes is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, value, numeric, known, router]);

  return state;
}
