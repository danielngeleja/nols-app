import { apiRequest } from "../lib/apiClient";
import { SupportedCurrencyCode, TzsPerUnit } from "./money";

export type FxRatesResponse = {
  base?: string;
  tzsPerUnit?: Partial<TzsPerUnit>;
  updatedAt?: string | null;
  source?: string;
  stale?: boolean;
};

export function fetchDisplayRates() {
  return apiRequest<FxRatesResponse>("/api/fx/rates");
}

export function fetchDisplayCurrencyPreference(token: string) {
  return apiRequest<{ currency?: string }>("/api/fx/preference", { token });
}

export function updateDisplayCurrencyPreference(token: string, currency: SupportedCurrencyCode) {
  return apiRequest<{ currency: string }>("/api/fx/preference", {
    method: "PUT",
    token,
    body: { currency }
  });
}
