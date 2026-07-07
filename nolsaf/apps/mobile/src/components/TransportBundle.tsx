import {
  Bike,
  Bus,
  CalendarClock,
  Car,
  CheckCircle2,
  ChevronRight,
  Crown,
  LocateFixed,
  MapPin,
  Navigation,
  Plane,
  Ship,
  TrainFront,
  Truck
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from "react-native";

import type { CreateBookingInput } from "../bookings";
import { detectCurrentLocation, type DeviceLocation } from "../lib/location";
import { useReducedMotion } from "../lib/useReducedMotion";
import {
  calculateFarePreview,
  getVehicleTypeLabel,
  PickupPoint,
  rankNearest,
  TransportVehicleType,
  usePickupPoints,
  VEHICLE_OPTIONS
} from "../transport";
import { colors, radius, spacing } from "../theme";
import { AppCard } from "./AppCard";
import { AppInput } from "./AppInput";
import { AppStack } from "./AppStack";
import { AppText } from "./AppText";
import { PickupPickerSheet } from "./PickupPickerSheet";

/** What the bundle reports up to the booking review screen. */
export type TransportSelection = {
  include: boolean;
  /** Ride fare to add to the total (0 when not included). */
  fare: number;
  /** Ride fare before any peak-time adjustment. */
  fareSubtotal: number;
  surgeMultiplier: number;
  surgeAmount: number;
  /** True when the selection is complete enough to submit. */
  ready: boolean;
  /** Fields to merge into the create-booking request. */
  fields: Partial<CreateBookingInput>;
};

type Props = {
  destination: { latitude: number; longitude: number } | null;
  currency: string;
  /** Booking check-in (YYYY-MM-DD), used as the default arrival date. */
  defaultArrivalDate?: string;
  onChange: (selection: TransportSelection) => void;
};

type Mode = "instant" | "scheduled";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** An icon per vehicle tier, so the choices read at a glance. */
const VEHICLE_ICON: Record<TransportVehicleType, typeof Car> = {
  BODA: Bike,
  BAJAJI: Truck,
  CAR: Car,
  XL: Bus,
  PREMIUM: Crown
};

/** Short capacity label kept compact so all five fit in one row. */
const VEHICLE_CAP: Record<TransportVehicleType, string> = {
  BODA: "1 seat",
  BAJAJI: "Up to 3",
  CAR: "Up to 4",
  XL: "Up to 6",
  PREMIUM: "VIP"
};

/** Split a list into rows of two for a clean two column grid. */
function pairRows<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

/** A single shimmering placeholder bar, used while the fare computes. */
function Shimmer({ width, height = 12 }: { width: number | `${number}%`; height?: number }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 650, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, opacity]);

  return <Animated.View style={{ width, height, borderRadius: 6, backgroundColor: colors.brand[100], opacity: reduced ? 0.6 : opacity }} />;
}

/** Fare row skeleton, matching the real fare row layout so it does not jump. */
function FareSkeleton() {
  return (
    <View style={styles.fareRow}>
      <View style={styles.fareSkeletonLeft}>
        <Shimmer width={84} height={11} />
        <Shimmer width={132} height={10} />
      </View>
      <Shimmer width={92} height={20} />
    </View>
  );
}

export function TransportBundle({ destination, currency, defaultArrivalDate, onChange }: Props) {
  const [include, setInclude] = useState(false);
  const [mode, setMode] = useState<Mode>("instant");
  const [vehicleType, setVehicleType] = useState<TransportVehicleType>("CAR");
  const [pickupId, setPickupId] = useState<string | null>(null);
  const [arrivalNumber, setArrivalNumber] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [arrivalDate, setArrivalDate] = useState(defaultArrivalDate || "");
  const [arrivalTime, setArrivalTime] = useState("12:00");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [currentLoc, setCurrentLoc] = useState<DeviceLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  // Smooth fade when switching pickup modes, so the two flows feel distinct.
  const reducedMotion = useReducedMotion();
  const modeFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reducedMotion) {
      modeFade.setValue(1);
      return;
    }
    modeFade.setValue(0);
    const anim = Animated.timing(modeFade, { toValue: 1, duration: 220, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [mode, modeFade, reducedMotion]);

  const { points } = usePickupPoints();
  const destLat = destination?.latitude ?? null;
  const destLng = destination?.longitude ?? null;
  const suggested = useMemo(
    () => rankNearest(points, destLat != null && destLng != null ? { latitude: destLat, longitude: destLng } : null, 4),
    [points, destLat, destLng]
  );
  const pickup: PickupPoint | null = useMemo(
    () => points.find((p) => p.id === pickupId) ?? null,
    [points, pickupId]
  );

  const detectLocation = useCallback(async () => {
    setLocError(null);
    setLocating(true);
    try {
      const loc = await detectCurrentLocation();
      setCurrentLoc(loc);
      setPickupId(null);
    } catch (e) {
      setLocError(e instanceof Error ? e.message : "Could not get your location.");
    } finally {
      setLocating(false);
    }
  }, []);

  // Instant pickup prefers the live device location; otherwise a chosen preset.
  // Scheduled pickup always uses an arrival preset.
  const usingCurrent = mode === "instant" && !!currentLoc;
  const originPoint =
    usingCurrent && currentLoc
      ? { latitude: currentLoc.latitude, longitude: currentLoc.longitude }
      : pickup
        ? { latitude: pickup.lat, longitude: pickup.lng }
        : null;
  const originAddress = usingCurrent && currentLoc ? currentLoc.address : pickup?.shortLabel ?? "";
  const originLat = originPoint?.latitude ?? null;
  const originLng = originPoint?.longitude ?? null;

  // Only a scheduled pickup with a valid date+time has a real ride moment, so
  // that is the only case where a peak-time adjustment can apply. Instant rides
  // never surge off the current clock — we don't want the adjustment to appear
  // by default just because the customer happens to open this at a busy hour.
  const scheduledMoment = useMemo(() => {
    if (mode !== "scheduled" || !arrivalDate || !TIME_RE.test(arrivalTime)) return null;
    const date = new Date(`${arrivalDate}T${arrivalTime}:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [arrivalDate, arrivalTime, mode]);

  const fare = useMemo(
    () => calculateFarePreview(originPoint, destination, vehicleType, currency, scheduledMoment ?? new Date(), scheduledMoment != null),
    [originLat, originLng, destination, vehicleType, currency, scheduledMoment]
  );

  // Briefly show a skeleton when the inputs that drive the fare change, so the
  // ride price feels computed rather than popping in.
  const [calculating, setCalculating] = useState(false);
  useEffect(() => {
    if (!include || !originPoint) {
      setCalculating(false);
      return;
    }
    setCalculating(true);
    const t = setTimeout(() => setCalculating(false), 550);
    return () => clearTimeout(t);
  }, [include, originLat, originLng, vehicleType, destLat, destLng]);

  // Keep arrival date sensible when the booking dates change.
  useEffect(() => {
    if (defaultArrivalDate && !arrivalDate) setArrivalDate(defaultArrivalDate);
  }, [defaultArrivalDate, arrivalDate]);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(arrivalDate) && !Number.isNaN(new Date(`${arrivalDate}T00:00:00`).getTime());
  const timeValid = TIME_RE.test(arrivalTime);
  const pickupLocValid = pickupLocation.trim().length > 0;
  const scheduledReady = !!pickup && dateValid && timeValid && pickupLocValid;
  const ready = !include || (mode === "instant" ? !!originPoint : scheduledReady);

  const selection = useMemo<TransportSelection>(() => {
    if (!include || !originPoint) {
      return { include, fare: 0, fareSubtotal: 0, surgeMultiplier: 1, surgeAmount: 0, ready: !include, fields: {} };
    }
    const base: Partial<CreateBookingInput> = {
      includeTransport: true,
      transportPickupMode: mode === "instant" ? "current" : "arrival",
      transportVehicleType: vehicleType,
      transportOriginLat: originPoint.latitude,
      transportOriginLng: originPoint.longitude,
      transportOriginAddress: originAddress,
      transportFare: fare.total
    };
    if (mode === "scheduled" && pickup) {
      base.arrivalType = pickup.arrivalType;
      base.arrivalNumber = arrivalNumber.trim() || null;
      base.pickupLocation = pickupLocation.trim() || null;
      base.arrivalTime =
        arrivalDate && TIME_RE.test(arrivalTime)
          ? new Date(`${arrivalDate}T${arrivalTime}:00`).toISOString()
          : null;
    }
    return {
      include: true,
      fare: fare.total,
      fareSubtotal: fare.subtotal,
      surgeMultiplier: fare.surgeMultiplier,
      surgeAmount: fare.surgeAmount,
      ready,
      fields: base
    };
  }, [include, originLat, originLng, originAddress, mode, pickup, vehicleType, fare.total, fare.subtotal, fare.surgeMultiplier, fare.surgeAmount, arrivalNumber, pickupLocation, arrivalDate, arrivalTime, ready]);

  useEffect(() => {
    onChange(selection);
  }, [onChange, selection]);

  const renderPickupChooser = () => (
    <AppStack gap={2}>
      <Pressable accessibilityRole="button" onPress={() => setSheetOpen(true)} style={styles.pickTrigger}>
        <View style={styles.pickIcon}>
          {pickup?.category === "airport" ? (
            <Plane color={colors.primary} size={16} />
          ) : pickup?.category === "ferry_port" ? (
            <Ship color={colors.primary} size={16} />
          ) : pickup?.category === "train_station" ? (
            <TrainFront color={colors.primary} size={16} />
          ) : (
            <MapPin color={colors.primary} size={16} />
          )}
        </View>
        <View style={styles.flex}>
          {pickup ? (
            <>
              <AppText variant="bodySmall" weight="semiBold" numberOfLines={1}>
                {pickup.shortLabel}
              </AppText>
              <AppText variant="caption" tone="soft" numberOfLines={1}>
                {pickup.city}
                {pickup.iataCode ? `  ·  ${pickup.iataCode}` : ""}
              </AppText>
            </>
          ) : (
            <>
              <AppText variant="bodySmall" weight="semiBold">
                Choose a pickup point
              </AppText>
              <AppText variant="caption" tone="soft">
                Search airports, bus terminals and ferries
              </AppText>
            </>
          )}
        </View>
        <ChevronRight color={colors.softText} size={18} />
      </Pressable>

      {!pickup && suggested.length > 0 ? (
        <View style={styles.suggestWrap}>
          <View style={styles.suggestHead}>
            <Navigation color={colors.primary} size={12} />
            <AppText variant="caption" weight="semiBold" tone="muted">
              {destLat != null ? "Closest to this stay" : "Suggested pickups"}
            </AppText>
          </View>
          {pairRows(suggested).map((row, ri) => (
            <View key={ri} style={styles.suggestRow}>
              {row.map((s) => {
                const Icon =
                  s.category === "airport"
                    ? Plane
                    : s.category === "ferry_port"
                      ? Ship
                      : s.category === "train_station"
                        ? TrainFront
                        : MapPin;
                return (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    onPress={() => setPickupId(s.id)}
                    style={styles.suggestChip}
                  >
                    <View style={styles.suggestChipLeft}>
                      <Icon color={colors.primary} size={13} />
                      <AppText variant="caption" weight="semiBold" tone="default" numberOfLines={1} style={styles.flex}>
                        {s.shortLabel}
                      </AppText>
                    </View>
                    {s.distanceKm > 0 ? (
                      <View style={styles.distancePill}>
                        <AppText variant="caption" weight="bold" tone="primary">
                          {Math.round(s.distanceKm)} km
                        </AppText>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
              {row.length === 1 ? <View style={styles.flex} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </AppStack>
  );

  return (
    <AppCard>
      <AppStack gap={include ? 4 : 0}>
        {/* Header / toggle */}
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: include }}
          onPress={() => setInclude((v) => !v)}
          style={styles.headerRow}
        >
          <View style={styles.headerIcon}>
            <Car color={colors.primary} size={18} />
          </View>
          <View style={styles.flex}>
            <AppText variant="caption" weight="bold" tone="primary" style={styles.eyebrow}>
              ONE TRIP · ONE TAP
            </AppText>
            <AppText variant="bodySmall" weight="bold">
              Add a ride to your stay
            </AppText>
            <AppText variant="caption" tone="soft">
              Door to door pickup, straight to this booked stay.
            </AppText>
          </View>
          <View style={[styles.switch, include && styles.switchOn]}>
            <View style={[styles.knob, include && styles.knobOn]} />
          </View>
        </Pressable>

        {include ? (
          <View style={styles.panel}>
            <AppStack gap={4}>
            {/* Mode */}
            <View style={styles.segment}>
              {(["instant", "scheduled"] as Mode[]).map((m) => {
                const active = mode === m;
                const MIcon = m === "instant" ? LocateFixed : CalendarClock;
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="button"
                    onPress={() => setMode(m)}
                    style={[styles.segmentItem, active && styles.segmentItemOn]}
                  >
                    <MIcon color={active ? colors.white : colors.primary} size={15} />
                    <AppText variant="caption" weight="semiBold" tone={active ? "inverse" : "muted"}>
                      {m === "instant" ? "Pick me up now" : "Schedule a transfer"}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            <Animated.View style={{ opacity: modeFade }}>
              <AppStack gap={4}>
                <AppText variant="caption" tone="soft">
                  {mode === "instant"
                    ? "We collect you from where you are now and bring you to this stay."
                    : "We meet your flight, bus or ferry and bring you to this stay."}
                </AppText>

                {mode === "instant" ? (
                  <AppStack gap={2}>
                    <AppText variant="label" weight="bold" tone="muted">
                      YOUR PICKUP
                      <AppText variant="label" weight="bold" tone="danger">
                        {" *"}
                      </AppText>
                    </AppText>

                    {currentLoc ? (
                      <View style={styles.currentCard}>
                        <View style={styles.currentIcon}>
                          <LocateFixed color={colors.white} size={16} />
                        </View>
                        <View style={styles.flex}>
                          <AppText variant="bodySmall" weight="bold">
                            Current location
                          </AppText>
                          <AppText variant="caption" tone="soft" numberOfLines={2}>
                            {currentLoc.address}
                          </AppText>
                        </View>
                        <Pressable accessibilityRole="button" onPress={() => setCurrentLoc(null)} hitSlop={8}>
                          <AppText variant="caption" weight="bold" tone="primary">
                            Change
                          </AppText>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={detectLocation}
                        disabled={locating}
                        style={styles.detectBtn}
                      >
                        {locating ? (
                          <ActivityIndicator color={colors.primary} />
                        ) : (
                          <View style={styles.currentIcon}>
                            <LocateFixed color={colors.white} size={16} />
                          </View>
                        )}
                        <AppText variant="bodySmall" weight="bold" tone="primary" style={styles.flex}>
                          {locating ? "Finding your location..." : "Use my current location"}
                        </AppText>
                      </Pressable>
                    )}

                    {locError ? (
                      <AppText variant="caption" tone="danger">
                        {locError}
                      </AppText>
                    ) : null}

                    {!currentLoc ? (
                      <>
                        <View style={styles.orRow}>
                          <View style={styles.orLine} />
                          <AppText variant="caption" tone="soft">
                            or choose a point
                          </AppText>
                          <View style={styles.orLine} />
                        </View>
                        {renderPickupChooser()}
                      </>
                    ) : null}
                  </AppStack>
                ) : (
                  <AppStack gap={2}>
                    <AppText variant="label" weight="bold" tone="muted">
                      ARRIVAL POINT
                      <AppText variant="label" weight="bold" tone="danger">
                        {" *"}
                      </AppText>
                    </AppText>
                    {renderPickupChooser()}
                  </AppStack>
                )}
              </AppStack>
            </Animated.View>

            {/* Vehicle */}
            <View style={styles.sectionDivider} />
            <AppStack gap={2}>
              <View style={styles.vehicleHead}>
                <Car color={colors.primary} size={15} />
                <AppText variant="label" weight="bold" tone="muted">
                  CHOOSE YOUR VEHICLE
                </AppText>
              </View>
              <View style={styles.vehicleRow}>
                {VEHICLE_OPTIONS.map((v) => {
                  const active = vehicleType === v.type;
                  const Icon = VEHICLE_ICON[v.type];
                  return (
                    <Pressable
                      key={v.type}
                      accessibilityRole="button"
                      onPress={() => setVehicleType(v.type)}
                      style={[styles.vehicleCard, active && styles.vehicleCardOn]}
                    >
                      <View style={[styles.vehicleIcon, active && styles.vehicleIconOn]}>
                        <Icon color={active ? colors.white : colors.primary} size={17} />
                      </View>
                      <AppText variant="caption" weight="bold" tone={active ? "inverse" : "default"} numberOfLines={1} style={styles.vehicleText}>
                        {v.label}
                      </AppText>
                      <AppText variant="caption" tone={active ? "inverse" : "soft"} numberOfLines={1} style={styles.vehicleText}>
                        {VEHICLE_CAP[v.type]}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </AppStack>

            {/* Arrival details (scheduled only) */}
            {mode === "scheduled" ? (
              <AppStack gap={3}>
                <AppInput
                  label={`${pickup ? pickup.arrivalType.charAt(0) + pickup.arrivalType.slice(1).toLowerCase() : "Flight or bus"} number (optional)`}
                  value={arrivalNumber}
                  onChangeText={setArrivalNumber}
                  placeholder="e.g. PW 474"
                  autoCapitalize="characters"
                />
                <View style={styles.dateTimeRow}>
                  <View style={styles.flex}>
                    <AppInput
                      label="Arrival date"
                      required
                      value={arrivalDate}
                      onChangeText={setArrivalDate}
                      placeholder="YYYY-MM-DD"
                    />
                  </View>
                  <View style={styles.timeBox}>
                    <AppInput
                      label="Time"
                      required
                      value={arrivalTime}
                      onChangeText={setArrivalTime}
                      placeholder="HH:MM"
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                </View>
                <AppInput
                  label="Pickup area or terminal"
                  required
                  value={pickupLocation}
                  onChangeText={setPickupLocation}
                  placeholder="e.g. Terminal 2, arrivals"
                />
              </AppStack>
            ) : null}

            {/* Fare */}
            {!originPoint ? (
              <View style={styles.hintRow}>
                <CheckCircle2 color={colors.softText} size={14} />
                <AppText variant="caption" tone="soft" style={styles.flex}>
                  Set your pickup to see the ride fare.
                </AppText>
              </View>
            ) : calculating ? (
              <FareSkeleton />
            ) : (
              <AppStack gap={2}>
              <View style={styles.fareRow}>
                <View style={styles.flex}>
                  <AppText variant="caption" weight="semiBold" tone="muted">
                    Ride fare
                  </AppText>
                  {!fare.approximate ? (
                    <AppText variant="caption" tone="soft">
                      {fare.distanceKm} km · {fare.estimatedMinutes} min · {getVehicleTypeLabel(vehicleType)}
                    </AppText>
                  ) : (
                    <AppText variant="caption" tone="soft">
                      Final fare confirmed by your driver
                    </AppText>
                  )}
                </View>
                <AppText variant="titleSm" weight="extraBold" tone="primary">
                  {fare.total.toLocaleString()} {currency}
                </AppText>
              </View>
              {fare.surgeAmount > 0 ? (
                <View style={styles.surgeDisclosure}>
                  <View style={styles.flex}>
                    <AppText variant="caption" weight="bold" tone="warning">
                      Peak fare ({Math.round((fare.surgeMultiplier - 1) * 100)}%)
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      Base ride {fare.subtotal.toLocaleString()} {currency}
                    </AppText>
                  </View>
                  <AppText variant="caption" weight="bold" tone="warning">
                    +{fare.surgeAmount.toLocaleString()} {currency}
                  </AppText>
                </View>
              ) : null}
              </AppStack>
            )}
            </AppStack>
          </View>
        ) : null}
      </AppStack>

      <PickupPickerSheet
        visible={sheetOpen}
        selectedId={pickupId}
        points={points}
        title={mode === "instant" ? "Where should we pick you up?" : "Select your arrival point"}
        subtitle={mode === "instant" ? "Airport, bus terminal, or ferry port" : "We will meet you here on arrival"}
        onClose={() => setSheetOpen(false)}
        onSelect={(p) => setPickupId(p.id)}
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { letterSpacing: 1, marginBottom: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  panel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: "#f3faf9",
    padding: spacing[3]
  },
  fareSkeletonLeft: { flex: 1, minWidth: 0, gap: spacing[2] },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  switch: {
    width: 46,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    padding: 3,
    justifyContent: "center"
  },
  switchOn: { backgroundColor: colors.primary },
  knob: { width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.white },
  knobOn: { alignSelf: "flex-end" },
  segment: { flexDirection: "row", gap: spacing[2] },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[1]
  },
  segmentItemOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  currentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[200],
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  currentIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  detectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.brand[50],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3]
  },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  pickTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  pickIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  suggestWrap: { gap: spacing[2] },
  suggestHead: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  suggestRow: { flexDirection: "row", alignItems: "stretch", gap: spacing[2] },
  suggestChip: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[200],
    backgroundColor: colors.white,
    paddingLeft: spacing[2],
    paddingRight: spacing[1],
    paddingVertical: spacing[2]
  },
  suggestChipLeft: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing[1] },
  distancePill: {
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 1
  },
  sectionDivider: { height: 1, backgroundColor: colors.brand[100], marginVertical: spacing[1] },
  vehicleHead: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  vehicleRow: { flexDirection: "row", gap: spacing[1] },
  vehicleCard: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: spacing[2],
    paddingHorizontal: 2
  },
  vehicleCardOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  vehicleText: { textAlign: "center" },
  vehicleIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    marginBottom: 2
  },
  vehicleIconOn: { backgroundColor: "rgba(255,255,255,0.22)" },
  dateTimeRow: { flexDirection: "row", gap: spacing[3], minWidth: 0 },
  timeBox: { width: 120 },
  fareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[200],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  surgeDisclosure: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#f2c879",
    backgroundColor: "#fff8e8",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  hintRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], minWidth: 0 }
});
