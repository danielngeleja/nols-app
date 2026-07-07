import { useCallback, useEffect, useState } from "react";
import { fetchSavedProperties, saveProperty, unsaveProperty } from "./propertiesApi";

/** Tracks which properties the traveller has saved and toggles save state with
 *  an optimistic update, rolling back if the API call fails. */
export function useSavedProperties(token: string | null | undefined) {
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!token) {
      setSavedIds(new Set());
      return;
    }
    let cancelled = false;
    fetchSavedProperties(token, { page: 1, pageSize: 100 })
      .then((res) => {
        if (!cancelled) setSavedIds(new Set((res.items || []).map((i) => i.id)));
      })
      .catch(() => {
        // ignore - saved state is best-effort
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const toggleSave = useCallback(
    async (propertyId: number) => {
      if (!token) return;
      const wasSaved = savedIds.has(propertyId);
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.delete(propertyId);
        else next.add(propertyId);
        return next;
      });
      try {
        if (wasSaved) await unsaveProperty(token, propertyId);
        else await saveProperty(token, propertyId);
      } catch {
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (wasSaved) next.add(propertyId);
          else next.delete(propertyId);
          return next;
        });
      }
    },
    [token, savedIds]
  );

  return { savedIds, toggleSave };
}
