/** Stable section indices; event hire is optional and review always stays last. */
export function listingStepOrder(includeEvents: boolean): number[] {
  return [0, 1, 2, 3, 4, 5, ...(includeEvents ? [6] : []), 7];
}

/** Preserve the destination of drafts made before setup or event sections existed. */
export function restoreListingStep(value: unknown, flowVersion?: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return 0;
  if (flowVersion === 3) return Math.min(7, value);
  const oldStep = Math.min(6, flowVersion === 2 || value === 0 ? value : value + 1);
  return oldStep === 6 ? 7 : oldStep;
}
