"use client";

// Which role's workspace is being drawn.
//
// The role itself is resolved server side (Property.nrmsAccessRole, from
// NrmsStaffMembership) and reaches the browser through NrmsProvider. The
// layout is where it gets combined with the development-only preview
// override, and pages need the same answer as the sidebar beside them: the
// NRMS home page shows a front desk to a receptionist and a pipeline to a
// sales executive, and it must not re-derive the role from a query string of
// its own.
//
// This carries no authority. It decides which screen is composed; the API
// decides what that screen is allowed to load.

import { createContext, useContext, type ReactNode } from "react";

export type NrmsAccessRoleValue = {
  /** The role the workspace is drawn for, preview included. */
  accessRole: string;
  /** The role the signed-in account actually holds on this property. */
  realAccessRole: string;
  /** Set only while a development preview is active. */
  previewRole: string | null;
};

// Owner is the safe default: it is what NrmsProvider falls back to when a
// property carries no staff membership for the signed-in account.
const NrmsAccessRoleContext = createContext<NrmsAccessRoleValue>({
  accessRole: "OWNER",
  realAccessRole: "OWNER",
  previewRole: null,
});

export function NrmsAccessRoleProvider({ value, children }: { value: NrmsAccessRoleValue; children: ReactNode }) {
  return <NrmsAccessRoleContext.Provider value={value}>{children}</NrmsAccessRoleContext.Provider>;
}

export function useNrmsAccessRole(): NrmsAccessRoleValue {
  return useContext(NrmsAccessRoleContext);
}
