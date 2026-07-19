export type ExistingNrmsStaffAssignment = {
  status: string;
  role: string;
  outletId: number | null;
};

export function nrmsAssignmentNeedsConfirmation(
  existing: ExistingNrmsStaffAssignment | null,
  requestedRole: string,
  requestedOutletId: number | null,
): boolean {
  if (!existing || existing.status !== "ACTIVE") return true;
  return existing.role !== requestedRole || existing.outletId !== requestedOutletId;
}
