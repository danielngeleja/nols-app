/** Step 2 was added in version 2. Preserve the destination of older drafts. */
export function restoreListingStep(value: unknown, flowVersion?: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return 0;
  return Math.min(6, flowVersion === 2 || value === 0 ? value : value + 1);
}
