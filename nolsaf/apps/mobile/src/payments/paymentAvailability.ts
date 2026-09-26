import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest } from "../lib/apiClient";

export type PaymentChannel = "MNO" | "BANK" | "CARD";
export type PaymentAvailabilityItem = {
  provider: string;
  label: string;
  isEnabled: boolean;
  reason: string | null;
};

const CHANNEL_PROVIDERS: Record<PaymentChannel, string[]> = {
  MNO: ["Mpesa", "Tigo", "Airtel", "Halopesa", "Azampesa"],
  BANK: ["BANK_CRDB", "BANK_NMB"],
  CARD: ["CARD"]
};

export function usePaymentAvailability() {
  const [items, setItems] = useState<PaymentAvailabilityItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await apiRequest<PaymentAvailabilityItem[]>("/api/public/service-availability/payment-methods");
      if (!Array.isArray(response)) throw new Error("Invalid payment availability response.");
      setItems(response);
      setStatus("ready");
    } catch {
      setItems([]);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byProvider = useMemo(() => new Map(items.map((item) => [item.provider, item])), [items]);
  const isProviderEnabled = useCallback(
    (provider: string) => status === "ready" && (byProvider.get(provider)?.isEnabled ?? true),
    [byProvider, status]
  );
  const providerReason = useCallback(
    (provider: string) => byProvider.get(provider)?.reason || "This payment method is temporarily unavailable.",
    [byProvider]
  );
  const isChannelEnabled = useCallback(
    (channel: PaymentChannel) => CHANNEL_PROVIDERS[channel].some(isProviderEnabled),
    [isProviderEnabled]
  );
  const channelReason = useCallback(
    (channel: PaymentChannel) => {
      const providers = CHANNEL_PROVIDERS[channel];
      return providers.map((provider) => byProvider.get(provider)).find((item) => item && !item.isEnabled)?.reason ||
        "This payment option is temporarily unavailable.";
    },
    [byProvider]
  );
  const hasAnyChannel = status === "ready" && (["MNO", "BANK", "CARD"] as PaymentChannel[]).some(isChannelEnabled);

  return useMemo(
    () => ({ status, reload, isProviderEnabled, providerReason, isChannelEnabled, channelReason, hasAnyChannel }),
    [status, reload, isProviderEnabled, providerReason, isChannelEnabled, channelReason, hasAnyChannel]
  );
}
