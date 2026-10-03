"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError } from "../../../_components/stockFormat";

export type RecipeLine = { stockItemId: number; stockItemName: string; baseUnit: string; quantity: number; yieldPercent: number; lineCost: number };
export type RecipeMenuItem = { id: number; name: string; category: string | null; price: number; legacyTracked: boolean; lines: RecipeLine[]; cost: number; marginPercent: number | null };
export type RecipeOutlet = { id: number; name: string; type: string; menuItems: RecipeMenuItem[] };

export type StockWorkspace = {
  overview: StockOverview | null;
  recipes: RecipeOutlet[] | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Menu items per stock item, for "used by" lists. */
  usedBy: Map<number, Array<{ menuItemId: number; name: string; outletName: string }>>;
  coverage: { linked: number; total: number };
};

/** Overview and recipes load together: most screens here need both. */
export function useStockWorkspace(propertyId: number | null | undefined): StockWorkspace {
  const [overview, setOverview] = useState<StockOverview | null>(null);
  const [recipes, setRecipes] = useState<RecipeOutlet[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!propertyId) return;
    setError(null);
    try {
      const overviewRes = await apiClient.get<StockOverview>(`/api/nrms/stock/property/${propertyId}/overview`);
      setOverview(overviewRes.data);
      if (overviewRes.data.canManageCatalog) {
        const recipeRes = await apiClient.get<{ outlets: RecipeOutlet[] }>(`/api/nrms/stock/property/${propertyId}/recipes`);
        setRecipes(recipeRes.data.outlets);
      } else {
        setRecipes([]);
      }
    } catch (cause) {
      setError(apiError(cause, "Unable to load stock"));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { setLoading(true); void reload(); }, [reload]);

  const usedBy = useMemo(() => {
    const map = new Map<number, Array<{ menuItemId: number; name: string; outletName: string }>>();
    for (const outlet of recipes ?? []) {
      for (const item of outlet.menuItems) {
        for (const line of item.lines) {
          const list = map.get(line.stockItemId) ?? [];
          list.push({ menuItemId: item.id, name: item.name, outletName: outlet.name });
          map.set(line.stockItemId, list);
        }
      }
    }
    return map;
  }, [recipes]);

  const coverage = useMemo(() => {
    const all = (recipes ?? []).flatMap((outlet) => outlet.menuItems);
    return { linked: all.filter((item) => item.lines.length > 0).length, total: all.length };
  }, [recipes]);

  return { overview, recipes, loading, error, reload, usedBy, coverage };
}
