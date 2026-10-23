/** Physical beds in one sellable room or entire unit. Legacy specs may use a number. */
export function bedsPerSellableUnit(spec: any): number {
  const beds = spec?.beds ?? spec?.bedsPerRoom ?? spec?.bedsCount ?? spec?.capacity;
  if (beds && typeof beds === "object" && !Array.isArray(beds)) {
    const count = ["twin", "full", "queen", "king"].reduce((sum, key) => sum + Math.max(0, Number(beds[key]) || 0), 0);
    return Math.max(1, Math.floor(count));
  }
  const count = Number(beds);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
}
