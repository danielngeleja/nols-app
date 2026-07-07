import { apiRequest } from "../lib/apiClient";
import { ReferralInfo } from "./types";

/** The authenticated traveller's invite code, shareable link, and referral stats. */
export async function fetchReferralInfo(token: string) {
  return apiRequest<ReferralInfo>("/api/customer/referrals", { token });
}
