"use client";

import { createContext, useContext } from "react";

/**
 * Where the listing wizard's long-stay helpers live (eligibility, quote, lease
 * preview). Owners use their own endpoints; a Sales Partner listing for an
 * owner uses the assisted-listing endpoints, which give the same answers
 * (docs/LONG_STAY_RENTALS.md section 15).
 */
export const OWNER_LONG_STAY_API = "/api/owner/long-stay";

export const LongStayApiBaseContext = createContext<string>(OWNER_LONG_STAY_API);

export function useLongStayApiBase(): string {
  return useContext(LongStayApiBaseContext);
}
