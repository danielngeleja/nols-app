import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth";
import { fetchDisplayCurrencyPreference, fetchDisplayRates, updateDisplayCurrencyPreference } from "./currencyApi";
import {
  FALLBACK_TZS_PER_UNIT,
  normalizeCurrency,
  sanitizeTzsPerUnit,
  SupportedCurrencyCode,
  TzsPerUnit
} from "./money";

const STORAGE_KEY = "nolsaf.display-currency";

type CurrencyContextValue = {
  currency: SupportedCurrencyCode;
  tzsPerUnit: TzsPerUnit;
  ratesUpdatedAt: string | null;
  ratesStale: boolean;
  isLoading: boolean;
  setCurrency: (currency: SupportedCurrencyCode) => Promise<void>;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: PropsWithChildren) {
  const { token } = useAuth();
  const [currency, setCurrencyState] = useState<SupportedCurrencyCode>("TZS");
  const [tzsPerUnit, setTzsPerUnit] = useState<TzsPerUnit>(FALLBACK_TZS_PER_UNIT);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<string | null>(null);
  const [ratesStale, setRatesStale] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      setIsLoading(true);
      try {
        const stored = normalizeCurrency(await AsyncStorage.getItem(STORAGE_KEY));
        if (active && stored) setCurrencyState(stored);

        const [ratesResult, preferenceResult] = await Promise.allSettled([
          fetchDisplayRates(),
          token ? fetchDisplayCurrencyPreference(token) : Promise.resolve(null)
        ]);

        if (!active) return;
        if (ratesResult.status === "fulfilled") {
          setTzsPerUnit(sanitizeTzsPerUnit(ratesResult.value.tzsPerUnit));
          setRatesUpdatedAt(ratesResult.value.updatedAt || null);
          setRatesStale(Boolean(ratesResult.value.stale));
        }

        if (preferenceResult.status === "fulfilled" && preferenceResult.value) {
          const serverCurrency = normalizeCurrency(preferenceResult.value.currency);
          if (serverCurrency) {
            setCurrencyState(serverCurrency);
            await AsyncStorage.setItem(STORAGE_KEY, serverCurrency);
          }
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [token]);

  const setCurrency = useCallback(
    async (next: SupportedCurrencyCode) => {
      const normalized = normalizeCurrency(next);
      if (!normalized) return;
      setCurrencyState(normalized);
      await AsyncStorage.setItem(STORAGE_KEY, normalized);
      if (token) {
        try {
          await updateDisplayCurrencyPreference(token, normalized);
        } catch {
          // Local display preference remains usable while offline. A later app
          // session will reconcile with the authenticated server preference.
        }
      }
    },
    [token]
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({ currency, tzsPerUnit, ratesUpdatedAt, ratesStale, isLoading, setCurrency }),
    [currency, isLoading, ratesStale, ratesUpdatedAt, setCurrency, tzsPerUnit]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const value = useContext(CurrencyContext);
  if (!value) throw new Error("useCurrency must be used inside CurrencyProvider.");
  return value;
}
