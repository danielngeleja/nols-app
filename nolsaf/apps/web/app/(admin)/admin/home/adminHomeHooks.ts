"use client";

import { useEffect, useRef, useState } from "react";

export type AdminSearchSuggestion = {
  label?: string;
  name?: string;
  href?: string;
  url?: string;
  type?: string;
};

export type AdminSummaryResponse = {
  activeSessions?: number;
  pendingApprovals?: number;
  invoicesReceived?: number;
  bookings?: number;
};

export type DriversSummaryResponse = {
  tripsPendingReconciliation?: number;
};

export type UsersSummaryResponse = {
  newCustomersLast7Days?: number;
};

export type RevenueSummaryResponse = {
  delta?: string;
};

export type PaymentsSummaryResponse = {
  waiting?: number;
  payouts?: { open?: number; paid?: number };
  exceptions?: { unmatched?: number; variance?: number; total?: number };
};

export type AdminMonitoring = {
  activeSessions: number;
  pendingApprovals: number;
  invoicesReceived: number;
  bookings: number;
};

export type AdminAuditEntry = {
  id?: string | number;
  action?: string;
  details?: unknown;
  createdAt?: string | null;
};

export type AdminPerformanceHighlights = {
  windowDays: number;
  /** Bookings per region in the window; first row equals mostBookedRegion. */
  regions?: Array<{ regionName: string; bookings: number }>;
  from: string;
  to: string;
  bestPropertyType: null | {
    type: string;
    bookings: number;
    interactions: number;
    interactionsBreakdown?: { reviews: number; saves: number };
  };
  bestDriver: null | {
    driverId: number;
    name: string;
    bookings: number;
    nolsRevenue: number;
  };
  bestOwner: null | {
    ownerId: number;
    name: string;
    bookings: number;
    nolsRevenue: number;
  };
  mostBookedRegion: null | {
    regionName: string;
    bookings: number;
  };
  topProperty: null | {
    propertyId: number;
    title: string;
    type: string;
    regionName: string;
    bookings: number;
    interactions: number;
    interactionsBreakdown?: { reviews: number; saves: number };
  };
};

function toNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchJsonSafe<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useAdminSearch(navigate: (href: string) => void) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AdminSearchSuggestion[]>([]);
  const [selected, setSelected] = useState(-1);
  const debounceRef = useRef<number | null>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      if (selected >= 0 && suggestions[selected]) {
        const item = suggestions[selected];
        const href = item.href || item.url || `/admin/search?query=${encodeURIComponent(item.label || item.name || query)}`;
        navigate(href);
      } else {
        navigate(`/admin/search?query=${encodeURIComponent(query)}`);
      }
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setSelected(-1);
    }
  }

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      setSelected(-1);
      return;
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const data = await fetchJsonSafe<unknown>(`/api/admin/search?q=${encodeURIComponent(query)}`);
      const arr = Array.isArray(data) ? (data as AdminSearchSuggestion[]) : [];
      setSuggestions(arr);
      setSelected(-1);
    }, 300);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  return { query, setQuery, suggestions, selected, setSelected, onKeyDown };
}

export function useAdminMonitoring() {
  const [monitoring, setMonitoring] = useState<AdminMonitoring | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function load() {
      const data = await fetchJsonSafe<AdminSummaryResponse>("/api/admin/summary", controller.signal);
      if (!mounted) return;

      if (!data) {
        setMonitoring(null);
        return;
      }

      setMonitoring({
        activeSessions: toNumber(data.activeSessions, 0),
        pendingApprovals: toNumber(data.pendingApprovals, 0),
        invoicesReceived: toNumber(data.invoicesReceived, 0),
        bookings: toNumber(data.bookings, 0),
      });
    }

    load();
    const t = setInterval(load, 30_000);
    return () => {
      mounted = false;
      controller.abort();
      clearInterval(t);
    };
  }, []);

  return { monitoring };
}

export function useAdminHomeKpis() {
  const [driversPending, setDriversPending] = useState<number | null>(null);
  const [usersNew, setUsersNew] = useState<number | null>(null);
  const [revenueDelta, setRevenueDelta] = useState<string | null>(null);
  const [paymentsWaiting, setPaymentsWaiting] = useState<number | null>(null);
  const [paymentExceptions, setPaymentExceptions] = useState<number | null>(null);
  const [payoutsInProgress, setPayoutsInProgress] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadAll() {
      const [drivers, users, revenue, payments] = await Promise.all([
        fetchJsonSafe<DriversSummaryResponse>("/api/admin/drivers/summary", controller.signal),
        fetchJsonSafe<UsersSummaryResponse>("/api/admin/users/summary", controller.signal),
        fetchJsonSafe<RevenueSummaryResponse>("/api/admin/revenue/summary", controller.signal),
        fetchJsonSafe<PaymentsSummaryResponse>("/api/admin/payments/summary", controller.signal),
      ]);

      if (!mounted) return;

      setDriversPending(toNumber(drivers?.tripsPendingReconciliation, 0));
      setUsersNew(toNumber(users?.newCustomersLast7Days, 0));
      setRevenueDelta(typeof revenue?.delta === "string" ? revenue.delta : null);
      setPaymentsWaiting(toNumber(payments?.waiting, 0));
      setPaymentExceptions(toNumber(payments?.exceptions?.total, 0));
      setPayoutsInProgress(toNumber(payments?.payouts?.open, 0));
    }

    loadAll();
    const t = setInterval(loadAll, 30_000);
    return () => {
      mounted = false;
      controller.abort();
      clearInterval(t);
    };
  }, []);

  return { driversPending, usersNew, revenueDelta, paymentsWaiting, paymentExceptions, payoutsInProgress };
}

export function useAdminRecentActivities() {
  const [recentActivities, setRecentActivities] = useState<AdminAuditEntry[] | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch("/api/admin/audits", { signal: controller.signal });
        if (!mounted) return;

        if (!res.ok) {
          setRecentActivities([]);
          return;
        }

        // Handle backends that may send empty body or non-JSON.
        const txt = await res.text();
        if (!mounted) return;

        if (!txt || !txt.trim()) {
          setRecentActivities([]);
          return;
        }

        let parsed: unknown = [];
        try {
          parsed = JSON.parse(txt);
        } catch {
          parsed = [];
        }

        const fromWrappedResponse = (() => {
          if (!parsed || typeof parsed !== "object") return null;
          const data = (parsed as any).data;
          const items = data?.items;
          return Array.isArray(items) ? (items as AdminAuditEntry[]) : null;
        })();

        const items = (Array.isArray(parsed) ? (parsed as AdminAuditEntry[]) : fromWrappedResponse ?? []).slice(0, 5);
        setRecentActivities(items);
      } catch {
        if (!mounted) return;
        setRecentActivities([]);
      }
    }


    load();
    const t = setInterval(load, 30_000);
    return () => {
      mounted = false;
      controller.abort();
      clearInterval(t);
    };
  }, []);

  return {
    recentActivities,
    refresh: () => {
      // Avoid forcing an abort; just run a one-off refresh.
      setRecentActivities((prev) => prev);
      // fire-and-forget fetch; the effect interval will also refresh
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (async () => {
        try {
          const res = await fetch("/api/admin/audits");
          if (!res.ok) return;
          const txt = await res.text();
          if (!txt || !txt.trim()) {
            setRecentActivities([]);
            return;
          }
          let parsed: unknown = [];
          try {
            parsed = JSON.parse(txt);
          } catch {
            parsed = [];
          }
          const fromWrappedResponse = (() => {
            if (!parsed || typeof parsed !== "object") return null;
            const data = (parsed as any).data;
            const items = data?.items;
            return Array.isArray(items) ? (items as AdminAuditEntry[]) : null;
          })();
          const items = (Array.isArray(parsed) ? (parsed as AdminAuditEntry[]) : fromWrappedResponse ?? []).slice(0, 5);
          setRecentActivities(items);
        } catch {
          // ignore
        }
      })();
    },
  };
}

export function useAdminPerformanceHighlights(days = 30) {
  const [highlights, setHighlights] = useState<AdminPerformanceHighlights | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function load() {
      const d = Number.isFinite(Number(days)) ? Math.round(Number(days)) : 30;
      const url = `/api/admin/performance/highlights?days=${encodeURIComponent(String(d))}`;
      const data = await fetchJsonSafe<AdminPerformanceHighlights>(url, controller.signal);
      if (!mounted) return;
      setHighlights(data ?? null);
    }

    load();
    const t = setInterval(load, 60_000);
    return () => {
      mounted = false;
      controller.abort();
      clearInterval(t);
    };
  }, [days]);

  return { highlights };
}
