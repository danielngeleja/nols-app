import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CheckCircle2, MapPin } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { fetchBookingDetail } from "../bookings";
import {
  AmountText,
  AppButton,
  AppCard,
  AppInput,
  AppStack,
  AppText,
  BottomActionBar,
  CodeText,
  SafeScreen,
  ScreenHeader,
  StateView,
  StatusBadge
} from "../components";
import { RootStackParamList } from "../navigation/types";
import {
  calculateFarePreview,
  createTransportBooking,
  CreateTransportResult,
  getVehicleTypeLabel,
  PICKUP_POINTS,
  PickupPoint,
  suggestPickupPoints,
  TransportVehicleType,
  VEHICLE_OPTIONS
} from "../transport";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "AddTransport">;

type Destination = { latitude: number; longitude: number } | null;

export function AddTransportScreen({ navigation, route }: Props) {
  const { token, user } = useAuth();
  const { bookingId, mode, propertyId, propertyTitle, propertyArea } = route.params;
  const isScheduled = mode === "scheduled";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [destination, setDestination] = useState<Destination>(null);
  const [destAddress, setDestAddress] = useState(propertyTitle);
  const [currency, setCurrency] = useState("TZS");

  const [pickup, setPickup] = useState<PickupPoint | null>(null);
  const [vehicleType, setVehicleType] = useState<TransportVehicleType>("CAR");
  const [arrivalNumber, setArrivalNumber] = useState("");
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [passengers, setPassengers] = useState("1");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateTransportResult | null>(null);

  const pickupOptions = useMemo(
    () => (isScheduled ? PICKUP_POINTS : suggestPickupPoints(propertyArea)),
    [isScheduled, propertyArea]
  );

  const load = useCallback(async () => {
    if (!token) {
      setLoadError("Please sign in to add transport.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const detail = await fetchBookingDetail(token, bookingId);
      const property = detail.property;
      const lat = property?.latitude ?? null;
      const lng = property?.longitude ?? null;
      if (lat != null && lng != null) {
        setDestination({ latitude: lat, longitude: lng });
      }
      if (property?.currency) setCurrency(property.currency);
      const area = [property?.regionName, property?.district, property?.city].filter(Boolean).join(", ");
      setDestAddress(property?.title ? `${property.title}${area ? `, ${area}` : ""}` : propertyTitle);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load this booking.");
    } finally {
      setLoading(false);
    }
  }, [bookingId, propertyTitle, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const scheduledDateIso = useMemo(() => {
    if (!isScheduled) return new Date().toISOString();
    if (!arrivalDate || !arrivalTime) return null;
    const candidate = new Date(`${arrivalDate}T${arrivalTime}:00`);
    return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
  }, [arrivalDate, arrivalTime, isScheduled]);

  // Peak-time adjustment only applies to a scheduled ride whose time the
  // customer actually picked; an instant ride never surges off the current clock.
  const applySurge = isScheduled && scheduledDateIso != null;

  const fare = useMemo(
    () =>
      calculateFarePreview(
        pickup ? { latitude: pickup.lat, longitude: pickup.lng } : null,
        destination,
        vehicleType,
        currency,
        scheduledDateIso ? new Date(scheduledDateIso) : new Date(),
        applySurge
      ),
    [currency, destination, pickup, scheduledDateIso, vehicleType, applySurge]
  );

  const passengerCount = Math.min(20, Math.max(1, Number(passengers) || 1));

  function validate(): string | null {
    if (!pickup) return "Choose where we should pick you up.";
    if (!destination) {
      return "This stay's location isn't registered yet, so we can't arrange transport to it automatically.";
    }
    if (isScheduled && !scheduledDateIso) return "Enter a valid arrival date and time.";
    return null;
  }

  async function submit() {
    const validationError = validate();
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    if (!token || !pickup || !destination || !scheduledDateIso) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createTransportBooking(token, {
        userId: user?.id,
        propertyId: propertyId ?? undefined,
        vehicleType,
        scheduledDate: scheduledDateIso,
        fromLatitude: pickup.lat,
        fromLongitude: pickup.lng,
        fromAddress: pickup.label,
        toLatitude: destination.latitude,
        toLongitude: destination.longitude,
        toAddress: destAddress,
        arrivalType: isScheduled ? pickup.arrivalType : "OTHER",
        arrivalNumber: isScheduled && arrivalNumber.trim() ? arrivalNumber.trim() : undefined,
        arrivalTime: isScheduled ? scheduledDateIso : undefined,
        pickupLocation: pickup.label,
        numberOfPassengers: passengerCount,
        notes: notes.trim() || undefined
      });
      setResult(created);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not create the transport booking.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeScreen contentStyle={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <AppText variant="bodySmall" tone="muted">
          Loading your booking...
        </AppText>
      </SafeScreen>
    );
  }

  if (loadError) {
    return (
      <SafeScreen>
        <AppStack gap={4}>
          <ScreenHeader title="Add transport" onBack={() => navigation.goBack()} />
          <StateView title="Could not load booking" message={loadError} actionLabel="Try again" onAction={load} />
        </AppStack>
      </SafeScreen>
    );
  }

  if (result) {
    return (
      <SafeScreen>
        <AppStack gap={5}>
          <ScreenHeader title="Transport requested" onBack={() => navigation.goBack()} />
          <AppCard tone="success">
            <AppStack gap={3}>
              <View style={styles.rowStart}>
                <CheckCircle2 color={colors.success} size={24} />
                <AppText variant="titleSm" weight="bold">
                  We're arranging your ride
                </AppText>
              </View>
              <AppText variant="bodySmall" tone="muted">
                A NoLSAF driver will be assigned to bring you to {propertyTitle}.
              </AppText>
              <View style={styles.rowBetween}>
                <AppText variant="label" tone="muted">
                  Fare (confirmed by NoLSAF)
                </AppText>
                <StatusBadge status="requested" />
              </View>
              <AmountText amount={result.amount} currency={result.currency} tone="primary" />
              {result.estimatedDistance != null ? (
                <AppText variant="caption" tone="muted">
                  About {result.estimatedDistance} km, {result.estimatedDuration ?? "?"} min, {getVehicleTypeLabel(result.vehicleType)}
                </AppText>
              ) : null}
              <CodeText value={`TRIP-${result.id}`} />
            </AppStack>
          </AppCard>
          <AppButton title="View my rides" onPress={() => navigation.navigate("MyRides")} />
          <AppButton title="Back to booking" variant="ghost" onPress={() => navigation.goBack()} />
        </AppStack>
      </SafeScreen>
    );
  }

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
          <ScreenHeader
            title={isScheduled ? "Schedule a transfer" : "Pick me up now"}
            subtitle={
              isScheduled
                ? "We collect you at your arrival point and bring you to your booked stay."
                : "Instant pickup that brings you to your booked stay."
            }
            onBack={() => navigation.goBack()}
          />

          {/* Destination locked to the booked property */}
          <AppCard tone="success">
            <AppStack gap={2}>
              <AppText variant="caption" weight="bold" tone="muted" style={styles.label}>
                DESTINATION · YOUR BOOKED STAY
              </AppText>
              <View style={styles.rowStart}>
                <MapPin color={colors.primary} size={20} />
                <AppText variant="bodySmall" weight="semiBold" style={styles.flex}>
                  {destAddress}
                </AppText>
              </View>
              {!destination ? (
                <AppText variant="caption" tone="warning">
                  This stay has no registered map location yet, so transport can't be arranged automatically.
                </AppText>
              ) : null}
            </AppStack>
          </AppCard>

          {/* Pickup selection */}
          <AppCard>
            <AppStack gap={3}>
              <AppText variant="titleSm" weight="bold">
                {isScheduled ? "Where are you arriving?" : "Nearest pickup point"}
              </AppText>
              {!isScheduled ? (
                <AppText variant="caption" tone="muted">
                  Choose the point closest to you. Live GPS pickup is coming soon.
                </AppText>
              ) : null}
              <AppStack gap={2}>
                {pickupOptions.map((point) => {
                  const selected = pickup?.id === point.id;
                  return (
                    <Pressable
                      key={point.id}
                      accessibilityRole="button"
                      onPress={() => setPickup(point)}
                      style={[styles.option, selected && styles.optionSelected]}
                    >
                      <View style={styles.flex}>
                        <AppText variant="bodySmall" weight="semiBold" numberOfLines={2}>
                          {point.shortLabel}
                        </AppText>
                        <AppText variant="caption" tone="muted" numberOfLines={1}>
                          {point.city}
                        </AppText>
                      </View>
                      {selected ? <CheckCircle2 color={colors.primary} size={18} /> : null}
                    </Pressable>
                  );
                })}
              </AppStack>
            </AppStack>
          </AppCard>

          {/* Arrival details (scheduled only) */}
          {isScheduled ? (
            <AppCard>
              <AppStack gap={3}>
                <AppText variant="titleSm" weight="bold">
                  Arrival details
                </AppText>
                <AppInput
                  label="Flight / bus / ferry number (optional)"
                  value={arrivalNumber}
                  onChangeText={setArrivalNumber}
                  placeholder="e.g. TC110"
                  autoCapitalize="characters"
                />
                <AppInput
                  label="Arrival date (YYYY-MM-DD)"
                  value={arrivalDate}
                  onChangeText={setArrivalDate}
                  placeholder="2026-06-10"
                  keyboardType="numbers-and-punctuation"
                />
                <AppInput
                  label="Arrival time (24h, HH:MM)"
                  value={arrivalTime}
                  onChangeText={setArrivalTime}
                  placeholder="14:30"
                  keyboardType="numbers-and-punctuation"
                />
              </AppStack>
            </AppCard>
          ) : null}

          {/* Vehicle */}
          <AppCard>
            <AppStack gap={3}>
              <AppText variant="titleSm" weight="bold">
                Vehicle
              </AppText>
              <AppStack gap={2}>
                {VEHICLE_OPTIONS.map((option) => {
                  const selected = vehicleType === option.type;
                  return (
                    <Pressable
                      key={option.type}
                      accessibilityRole="button"
                      onPress={() => setVehicleType(option.type)}
                      style={[styles.option, selected && styles.optionSelected]}
                    >
                      <View style={styles.flex}>
                        <AppText variant="bodySmall" weight="semiBold">
                          {option.label}
                        </AppText>
                        <AppText variant="caption" tone="muted" numberOfLines={1}>
                          {option.hint}
                        </AppText>
                      </View>
                      {selected ? <CheckCircle2 color={colors.primary} size={18} /> : null}
                    </Pressable>
                  );
                })}
              </AppStack>
            </AppStack>
          </AppCard>

          {/* Passengers + notes */}
          <AppCard>
            <AppStack gap={3}>
              <AppInput
                label="Passengers"
                value={passengers}
                onChangeText={setPassengers}
                placeholder="1"
                keyboardType="number-pad"
              />
              <AppInput
                label="Notes for the driver (optional)"
                value={notes}
                onChangeText={setNotes}
                placeholder="Luggage, meeting point, etc."
                multiline
              />
            </AppStack>
          </AppCard>

          {/* Fare preview */}
          <AppCard tone="brand">
            <AppStack gap={2}>
              <AppText variant="caption" weight="bold" tone="inverse" style={styles.label}>
                ESTIMATED FARE
              </AppText>
              <AmountText amount={fare.total} currency={fare.currency} tone="inverse" />
              {fare.surgeAmount > 0 ? (
                <AppStack gap={1}>
                  <View style={styles.rowBetween}>
                    <AppText variant="caption" tone="inverse">Base ride fare</AppText>
                    <AppText variant="caption" weight="semiBold" tone="inverse">
                      {fare.subtotal.toLocaleString()} {fare.currency}
                    </AppText>
                  </View>
                  <View style={styles.rowBetween}>
                    <AppText variant="caption" weight="bold" tone="inverse">
                      Peak fare ({Math.round((fare.surgeMultiplier - 1) * 100)}%)
                    </AppText>
                    <AppText variant="caption" weight="bold" tone="inverse">
                      +{fare.surgeAmount.toLocaleString()} {fare.currency}
                    </AppText>
                  </View>
                </AppStack>
              ) : null}
              <AppText variant="caption" tone="inverse">
                {fare.approximate
                  ? "Base rate only. NoLSAF confirms the final fare once the route is set."
                  : `About ${fare.distanceKm.toFixed(1)} km, ${fare.estimatedMinutes} min, ${getVehicleTypeLabel(fare.vehicleType)}`}
              </AppText>
              <AppText variant="caption" tone="inverse">
                NoLSAF confirms the final fare on the server when the driver is assigned.
              </AppText>
            </AppStack>
          </AppCard>

          {submitError ? (
            <AppText variant="bodySmall" tone="danger">
              {submitError}
            </AppText>
          ) : null}
        </AppStack>
      </SafeScreen>

      <BottomActionBar>
        <AppButton
          title={isScheduled ? "Request scheduled transfer" : "Request pickup"}
          loading={submitting}
          disabled={!pickup || !destination}
          onPress={submit}
        />
      </BottomActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  screen: {
    paddingBottom: spacing[6]
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  label: {
    letterSpacing: 1.2
  },
  rowStart: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  rowBetween: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  option: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.brand[50]
  }
});
