"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";

export type AdminNavCounts = { listings: number; payouts: number; trips: number; groupStays: number; cancellations: number };

/**
 * What waits in each admin section (GET /api/admin/nav-counts). Shared by the
 * sidebar and the header tabs. Refreshed once a minute and when the tab regains
 * focus; a failed load keeps the last known numbers.
 */
export function useAdminNavCounts() {
  const [counts, setCounts] = useState<AdminNavCounts | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiClient.get<AdminNavCounts>("/api/admin/nav-counts");
        if (!cancelled && res.data) setCounts(res.data);
      } catch {
        // A count is a hint; keep the last known value.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return counts;
}
