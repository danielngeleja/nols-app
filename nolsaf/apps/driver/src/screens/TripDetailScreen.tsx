import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AmountText, AppButton, AppCard, AppStack, AppText, colors, radius, SafeScreen, spacing, StateView } from "@nolsaf/native-ui";
import { ArrowLeft, Check, CheckCheck, Flag, Globe, MapPin, Navigation, Phone, User, UserCheck } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { formatTripWhen } from "../components/TripCard";
import { TripMap } from "../components/TripMap";
import { TripStatusBadge } from "../components/TripStatusBadge";
import {
  acceptTrip,
  declineTrip,
  fetchDriverMap,
  fetchMessageTemplates,
  fetchTripDetail,
  sendQuickMessage,
  updateTripStage
} from "../driver/driverApi";
import { MessageTemplate, TRIP_STAGE_FLOW, TRIP_STAGE_LABELS, TripDetail, TripStage } from "../driver/types";
import { useLocationPing } from "../hooks/useLocationPing";
import { formatEta, haversineDistanceKm } from "../lib/eta";
import { requestTrackingSync } from "../lib/trackingSync";
import { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "TripDetail">;

const ARRIVAL_RADIUS_KM = 0.1;

function formatDistance(km: number) {
  if (km < 1) return `${Math.max(0, Math.round(km * 1000))} m`;
  return `${km.toFixed(1)} km`;
}

const LANGUAGE_LABELS: Record<string, string> = {
  sw: "Swahili",
  en: "English",
  ar: "Arabic",
  fr: "French"
};

function languageLabel(code: string) {
  return LANGUAGE_LABELS[code.toLowerCase()] ?? code;
}

const STAGE_ICONS: Record<TripStage, typeof MapPin> = {
  arrived_at_pickup: MapPin,
  passenger_picked_up: UserCheck,
  in_transit: Navigation,
  arrived_at_destination: Flag,
  completed: CheckCheck
};

function formatDuration(fromIso: string, toIso: string) {
  const minutes = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function openExternalNavigation(point: { lat: number; lng: number }) {
  const { lat, lng } = point;
  const url = Platform.select({
    ios: `maps://app?daddr=${lat},${lng}&dirflg=d`,
    android: `google.navigation:q=${lat},${lng}`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving&dir_action=navigate`
  });
  Linking.openURL(url!).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving&dir_action=navigate`));
}

export function TripDetailScreen({ navigation, route }: Props) {
  const { tripId } = route.params;
  const { token } = useAuth();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [sentKey, setSentKey] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (!token) {
      setError("Please sign in to view this trip.");
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const detail = await fetchTripDetail(token, tripId);
      setTrip(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load this trip.");
    } finally {
      setLoading(false);
    }
  }, [token, tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isActive = trip?.status === "CONFIRMED" || trip?.status === "IN_PROGRESS";

  const { position: livePosition } = useLocationPing({ enabled: Boolean(isActive), token });
  const [seedPosition, setSeedPosition] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!token || !isActive) return;
    fetchDriverMap(token)
      .then((res) => {
        if (res.driverLocation) setSeedPosition({ lat: res.driverLocation.lat, lng: res.driverLocation.lng });
      })
      .catch(() => {});
  }, [token, isActive]);

  const driverPosition = livePosition || seedPosition;

  const pickupPoint = trip?.pickupLat != null && trip?.pickupLng != null ? { lat: trip.pickupLat, lng: trip.pickupLng } : null;
  const dropoffPoint = trip?.dropoffLat != null && trip?.dropoffLng != null ? { lat: trip.dropoffLat, lng: trip.dropoffLng } : null;
  const etaTarget = trip?.status === "IN_PROGRESS" ? dropoffPoint : pickupPoint;
  const etaText = driverPosition && etaTarget ? formatEta(driverPosition, etaTarget) : null;

  useEffect(() => {
    if (!token || !isActive) return;
    fetchMessageTemplates(token)
      .then((res) => setTemplates(res.templates || []))
      .catch(() => setTemplates([]));
  }, [token, isActive]);

  const stageHistory = trip?.stageHistory ?? [];
  const completedStages = useMemo(() => new Set((trip?.stageHistory || []).map((entry) => entry.stage)), [trip?.stageHistory]);
  const nextStage = useMemo(() => TRIP_STAGE_FLOW.find((stage) => !completedStages.has(stage)) ?? null, [completedStages]);
  const pickupConfirmed = completedStages.has("arrived_at_pickup");

  const distanceToDropoffKm = driverPosition && dropoffPoint ? haversineDistanceKm(driverPosition, dropoffPoint) : null;
  const isArrivalStage = nextStage === "arrived_at_destination";
  const arrivalGateActive = isArrivalStage && distanceToDropoffKm != null;
  const isNearDestination = !arrivalGateActive || distanceToDropoffKm! <= ARRIVAL_RADIUS_KM;

  async function handleAccept() {
    if (!token || !trip) return;
    setActionLoading(true);
    try {
      await acceptTrip(token, trip.id);
      requestTrackingSync();
      setTrip((current) => current ? { ...current, status: "CONFIRMED" } : current);
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept this trip.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDecline() {
    if (!token || !trip) return;
    setActionLoading(true);
    try {
      await declineTrip(token, trip.id);
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decline this trip.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAdvanceStage() {
    if (!token || !trip || !nextStage) return;
    setActionLoading(true);
    try {
      const response = await updateTripStage(token, trip.id, { stage: nextStage });
      requestTrackingSync();
      setTrip((current) => current ? {
        ...current,
        status: response.trip.status,
        stageHistory: current.stageHistory.some((entry) => entry.stage === nextStage)
          ? current.stageHistory
          : [...current.stageHistory, { stage: nextStage, at: response.trip.at }]
      } : current);
      if (nextStage === "passenger_picked_up" && dropoffPoint) {
        openExternalNavigation(dropoffPoint);
      }
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the trip stage.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleQuickMessage(template: MessageTemplate) {
    if (!token || !trip) return;
    setSendingKey(template.key);
    try {
      await sendQuickMessage(token, String(trip.passengerUserId), template.key);
      setSentKey(template.key);
      setTimeout(() => setSentKey(null), 2500);
    } catch {
      // best effort - the driver can try again
    } finally {
      setSendingKey(null);
    }
  }

  function callPassenger() {
    if (!trip?.phoneNumber) return;
    Linking.openURL(`tel:${trip.phoneNumber}`);
  }

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.content}>
        <View style={styles.headerRow}>
          <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
          <AppText variant="title" weight="bold">
            Trip details
          </AppText>
        </View>

        {loading ? (
          <StateView title="Loading trip" message="Fetching the trip details." />
        ) : error && !trip ? (
          <StateView title="Could not load this trip" message={error} actionLabel="Try again" onAction={() => load()} />
        ) : trip ? (
          <AppStack gap={3}>
            {error ? (
              <AppCard>
                <AppText variant="bodySmall" style={{ color: colors.danger }}>{error}</AppText>
                <AppButton title="Refresh trip" variant="ghost" onPress={() => void load(false)} />
              </AppCard>
            ) : null}
            <AppCard>
              <AppStack gap={2}>
                <View style={styles.topRow}>
                  <TripStatusBadge status={trip.status} />
                  {trip.tripCode ? (
                    <AppText variant="caption" tone="soft">
                      {trip.tripCode}
                    </AppText>
                  ) : null}
                </View>
                <View style={styles.pickupTimeRow}>
                  <AppText variant="caption" tone="muted">
                    Pick-up time
                  </AppText>
                  <AppText variant="bodySmall" weight="bold">
                    {formatTripWhen(trip.pickupTime || trip.scheduledDate) || "Time not set"}
                  </AppText>
                </View>
                {trip.amount != null ? <AmountText amount={trip.amount} currency={trip.currency || "TZS"} /> : null}
              </AppStack>
            </AppCard>

            {isActive && (pickupPoint || dropoffPoint) ? (
              <AppStack gap={2}>
                <TripMap pickup={pickupPoint} dropoff={dropoffPoint} driverPosition={driverPosition} />
                <View style={styles.mapFooterRow}>
                  <View style={styles.etaInfo}>
                    <View style={styles.etaIconBubble}>
                      <MapPin color={colors.primary} size={16} />
                    </View>
                    <View>
                      <AppText variant="caption" tone="muted">
                        {trip.status === "IN_PROGRESS" ? "Drop-off location" : "Pickup location"}
                      </AppText>
                      <AppText variant="bodySmall" weight="bold" tone="primary">
                        {etaText || "Distance unavailable"}
                      </AppText>
                    </View>
                  </View>
                  {etaTarget ? (
                    <Pressable accessibilityRole="button" onPress={() => openExternalNavigation(etaTarget)} style={styles.navigateButton}>
                      <Navigation color={colors.white} size={16} />
                      <AppText variant="caption" weight="bold" style={styles.navigateButtonText}>
                        Navigate
                      </AppText>
                    </Pressable>
                  ) : null}
                </View>
              </AppStack>
            ) : null}

            <AppCard>
              <AppStack gap={3}>
                <AppText variant="titleSm" weight="bold">
                  Route
                </AppText>
                <View style={styles.routeRow}>
                  <MapPin color={colors.primary} size={18} />
                  <AppStack gap={0} style={styles.routeText}>
                    <AppText variant="caption" tone="muted">
                      Pickup
                    </AppText>
                    <AppText variant="bodySmall" weight="medium">
                      {trip.pickupAddress || trip.pickup || "Not specified"}
                    </AppText>
                  </AppStack>
                </View>
                <View style={styles.routeRow}>
                  <MapPin color={colors.mutedText} size={18} />
                  <AppStack gap={0} style={styles.routeText}>
                    <AppText variant="caption" tone="muted">
                      Dropoff
                    </AppText>
                    <AppText variant="bodySmall" weight="medium">
                      {trip.dropoffAddress || trip.dropoff || "Not specified"}
                    </AppText>
                  </AppStack>
                </View>
              </AppStack>
            </AppCard>

            {stageHistory.length > 0 ? (
              <AppCard>
                <AppStack gap={4}>
                  <View style={styles.timelineHeader}>
                    <AppText variant="titleSm" weight="bold">
                      Trip timeline
                    </AppText>
                    <View style={styles.timelineCountBadge}>
                      <AppText variant="caption" weight="bold" tone="primary">
                        {stageHistory.length}/{TRIP_STAGE_FLOW.length} steps
                      </AppText>
                    </View>
                  </View>
                  <AppStack gap={0}>
                    {stageHistory.map((entry, index) => {
                      const StageIcon = STAGE_ICONS[entry.stage] || Check;
                      const isLast = index === stageHistory.length - 1;
                      const previous = index > 0 ? stageHistory[index - 1] : null;
                      return (
                        <View key={`${entry.stage}-${index}`} style={styles.timelineRow}>
                          <View style={styles.timelineRail}>
                            <View style={[styles.timelineDot, isLast && styles.timelineDotCurrent]}>
                              <StageIcon color={isLast ? colors.primary : colors.white} size={14} />
                            </View>
                            {!isLast ? <View style={styles.timelineLine} /> : null}
                          </View>
                          <View style={[styles.timelineContent, isLast && styles.timelineContentLast]}>
                            <View style={styles.timelineTitleRow}>
                              <AppText variant="bodySmall" weight="bold">
                                {TRIP_STAGE_LABELS[entry.stage] || entry.stage}
                              </AppText>
                              {previous ? (
                                <View style={styles.timelineDurationBadge}>
                                  <AppText variant="caption" weight="medium" tone="muted">
                                    +{formatDuration(previous.at, entry.at)}
                                  </AppText>
                                </View>
                              ) : null}
                            </View>
                            <AppText variant="caption" tone="muted">
                              {formatTripWhen(entry.at)}
                            </AppText>
                          </View>
                        </View>
                      );
                    })}
                  </AppStack>
                </AppStack>
              </AppCard>
            ) : null}

            {trip.passengerName || trip.phoneNumber ? (
              <AppCard>
                <View style={styles.passengerRow}>
                  <View style={styles.passengerIcon}>
                    <User color={colors.primary} size={20} />
                  </View>
                  <AppStack gap={0} style={styles.routeText}>
                    <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                      {trip.passengerName || "Passenger"}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {trip.notes || "No notes for this trip"}
                    </AppText>
                    {trip.requiredLanguage ? (
                      <View style={styles.languageRow}>
                        <Globe color={colors.primary} size={12} />
                        <AppText variant="caption" tone="primary">
                          Speaks {languageLabel(trip.requiredLanguage)}
                        </AppText>
                      </View>
                    ) : null}
                  </AppStack>
                  {trip.phoneNumber && !pickupConfirmed ? (
                    <Pressable accessibilityRole="button" onPress={callPassenger} style={styles.callButton}>
                      <Phone color={colors.white} size={18} />
                    </Pressable>
                  ) : null}
                </View>
              </AppCard>
            ) : null}

            {trip.status === "PENDING" ? (
              <AppStack gap={2}>
                <AppButton title="Accept trip" onPress={handleAccept} loading={actionLoading} />
                <AppButton title="Decline" variant="ghost" onPress={handleDecline} loading={actionLoading} />
              </AppStack>
            ) : null}

            {isActive ? (
              <AppStack gap={3}>
                {nextStage ? (
                  isArrivalStage && !isNearDestination ? (
                    <View style={styles.nearDestinationBanner}>
                      <AppText variant="bodySmall" weight="bold" tone="primary">
                        Near destination
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        Get within 100m of the drop-off to mark arrival
                        {distanceToDropoffKm != null ? ` (${formatDistance(distanceToDropoffKm)} away)` : ""}
                      </AppText>
                    </View>
                  ) : (
                    <AppButton
                      title={nextStage === "passenger_picked_up" ? "Start trip & navigate" : TRIP_STAGE_LABELS[nextStage]}
                      icon={nextStage === "passenger_picked_up" ? <Navigation color={colors.white} size={16} /> : undefined}
                      onPress={handleAdvanceStage}
                      loading={actionLoading}
                    />
                  )
                ) : null}

                {templates.length > 0 && !pickupConfirmed ? (
                  <AppStack gap={2}>
                    <AppText variant="titleSm" weight="bold">
                      Quick messages
                    </AppText>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.messagesRow}
                    >
                      {templates.map((tpl) => (
                        <Pressable
                          key={tpl.key}
                          accessibilityRole="button"
                          onPress={() => handleQuickMessage(tpl)}
                          disabled={sendingKey === tpl.key}
                          style={[styles.messageChip, sentKey === tpl.key && styles.messageChipSent]}
                        >
                          <AppText variant="caption" weight="medium" tone={sentKey === tpl.key ? "success" : "default"} numberOfLines={1}>
                            {sentKey === tpl.key ? "Sent" : tpl.text}
                          </AppText>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </AppStack>
                ) : null}
              </AppStack>
            ) : null}
          </AppStack>
        ) : null}
      </SafeScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  content: {
    gap: spacing[4]
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  pickupTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  mapFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  etaInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexShrink: 1
  },
  etaIconBubble: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center"
  },
  navigateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full
  },
  navigateButtonText: {
    color: colors.white
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minWidth: 0
  },
  nearDestinationBanner: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[1]
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    minWidth: 0
  },
  routeText: {
    flex: 1,
    minWidth: 0
  },
  languageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginTop: 2
  },
  timelineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  timelineCountBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  timelineRow: {
    flexDirection: "row",
    gap: spacing[3]
  },
  timelineRail: {
    alignItems: "center"
  },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  timelineDotCurrent: {
    backgroundColor: colors.brand[50],
    borderWidth: 2,
    borderColor: colors.primary
  },
  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: spacing[5],
    marginVertical: spacing[1],
    backgroundColor: colors.brand[100]
  },
  timelineContent: {
    flex: 1,
    minWidth: 0,
    paddingBottom: spacing[4],
    gap: 2
  },
  timelineContentLast: {
    paddingBottom: 0
  },
  timelineTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  timelineDurationBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  passengerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  passengerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  callButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  messagesRow: {
    flexDirection: "row",
    gap: spacing[2],
    paddingRight: spacing[1]
  },
  messageChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3]
  },
  messageChipSent: {
    backgroundColor: colors.brand[50],
    borderColor: colors.brand[100]
  }
});
