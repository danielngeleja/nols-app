import { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { acceptTrip, declineTrip, fetchLiveOffers } from "../driver/driverApi";
import { TripOffer } from "../driver/types";
import { useDriverSocket } from "../hooks/useDriverSocket";
import { onTestTripOffer } from "../lib/tripOfferTestBus";
import { requestTrackingSync } from "../lib/trackingSync";
import { RootStackParamList } from "../navigation/types";
import { TripOfferModal } from "./TripOfferModal";

type TripOfferProviderProps = {
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
};

export function TripOfferProvider({ navigationRef }: TripOfferProviderProps) {
  const { token } = useAuth();
  const [offers, setOffers] = useState<TripOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const handledIds = useRef(new Set<number>());

  const isLiveOffer = useCallback((offer: TripOffer | null | undefined): offer is TripOffer =>
    !!offer && Number.isInteger(offer.bookingId) && offer.bookingId > 0 &&
    Number.isFinite(Date.parse(offer.offer?.expiresAt ?? "")) && Date.parse(offer.offer.expiresAt) > Date.now(), []);

  const refreshOffers = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetchLiveOffers(token);
      setOffers((response.offers ?? []).filter((offer) => isLiveOffer(offer) && !handledIds.current.has(offer.bookingId)));
    } catch {
      // Socket offers still work while the recovery endpoint is unreachable.
    }
  }, [isLiveOffer, token]);

  useEffect(() => {
    void refreshOffers();
    const interval = setInterval(() => void refreshOffers(), 15_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshOffers();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refreshOffers]);

  const dequeue = useCallback((bookingId: number) => {
    setOffers((current) => current.filter((item) => item.bookingId !== bookingId));
  }, []);

  useDriverSocket(
    {
      "transport:booking:created": (payload) => {
        const offer = payload as TripOffer | null;
        if (!isLiveOffer(offer) || handledIds.current.has(offer.bookingId)) return;
        setOffers((current) => (current.some((item) => item.bookingId === offer.bookingId) ? current : [...current, offer]));
      }
    },
    { requireFocus: false }
  );

  useEffect(() => {
    if (!__DEV__) return undefined;
    return onTestTripOffer((offer) => {
      setOffers((current) => (current.some((item) => item.bookingId === offer.bookingId) ? current : [...current, offer]));
    });
  }, []);

  const current = offers[0] ?? null;

  const handleAccept = useCallback(async () => {
    if (!token || !current) return;
    setLoading(true);
    try {
      await acceptTrip(token, current.bookingId);
      requestTrackingSync();
      handledIds.current.add(current.bookingId);
      dequeue(current.bookingId);
      navigationRef.current?.navigate("TripDetail", { tripId: current.bookingId });
    } catch (e) {
      Alert.alert("Could not accept trip", e instanceof Error ? e.message : "This trip may have already been taken.");
      void refreshOffers();
    } finally {
      setLoading(false);
    }
  }, [token, current, dequeue, navigationRef, refreshOffers]);

  const handleDecline = useCallback(async () => {
    if (!current) return;
    const bookingId = current.bookingId;
    if (!token) return;
    setLoading(true);
    try {
      await declineTrip(token, bookingId);
      handledIds.current.add(bookingId);
      dequeue(bookingId);
    } catch (e) {
      Alert.alert("Could not decline trip", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [token, current, dequeue]);

  const handleExpire = useCallback(() => {
    if (!current) return;
    handledIds.current.add(current.bookingId);
    dequeue(current.bookingId);
  }, [current, dequeue]);

  return <TripOfferModal offer={current} loading={loading} onAccept={handleAccept} onDecline={handleDecline} onExpire={handleExpire} />;
}
