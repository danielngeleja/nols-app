import { useEffect, useState } from "react";

import { PICKUP_POINTS, PickupPoint } from "./tanzaniaLocations";
import { fetchPickupPoints } from "./transportApi";

/**
 * Pickup points from the admin-managed source, with the bundled list as an
 * immediate and offline fallback. Starts with the bundled list so the UI never
 * waits, then swaps to the live list once it loads.
 */
export function usePickupPoints(): { points: PickupPoint[]; loading: boolean } {
  const [points, setPoints] = useState<PickupPoint[]>(PICKUP_POINTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchPickupPoints()
      .then((items) => {
        if (!cancelled && items.length > 0) setPoints(items);
      })
      .catch(() => {
        // keep the bundled fallback
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { points, loading };
}
