import { apiRequest } from "../lib/apiClient";
import { KaribuJourney, KaribuPreferencesInput, KaribuPreferencesResponse } from "./types";

/** The travel story: completed stays, next stay, and welcomes actually issued. */
export function fetchKaribuJourney(token: string) {
  return apiRequest<KaribuJourney>("/api/customer/karibu", { token });
}

export function fetchKaribuPreferences(token: string) {
  return apiRequest<KaribuPreferencesResponse>("/api/customer/karibu/preferences", { token });
}

export function saveKaribuPreferences(token: string, input: KaribuPreferencesInput) {
  return apiRequest<KaribuPreferencesResponse>("/api/customer/karibu/preferences", {
    token,
    method: "PUT",
    body: { ...input, birthday: input.celebrateOptIn ? input.birthday : null, dietaryNote: input.dietaryNote?.trim() || null }
  });
}

/** One action clears every preference. */
export function clearKaribuPreferences(token: string) {
  return apiRequest<KaribuPreferencesResponse>("/api/customer/karibu/preferences", { token, method: "DELETE" });
}

/** Sharing on or off without touching the other preferences. */
export function setKaribuSharing(token: string, shareWithProperty: boolean) {
  return apiRequest<KaribuPreferencesResponse>("/api/customer/karibu/preferences/sharing", {
    token,
    method: "PATCH",
    body: { shareWithProperty }
  });
}

/** Once per served welcome: did it arrive, and how was it. */
export function sendKaribuFeedback(token: string, gestureId: number, input: { received: boolean; rating: number | null; note: string | null }) {
  return apiRequest<{ ok: boolean }>(`/api/customer/karibu/${gestureId}/feedback`, { token, method: "POST", body: input });
}
