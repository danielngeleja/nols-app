import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ArrowLeft,
  Banknote,
  Building2,
  Bus,
  Calendar,
  CalendarClock,
  Car,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Headset,
  MapPin,
  Navigation,
  Plane,
  Radar,
  ShieldCheck,
  Ship,
  Star,
  Train,
  User,
  Users
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";

import Svg, { Circle, Rect } from "react-native-svg";

import { useAuth } from "../auth";
import { AmountText, AppText, SafeScreen, StateView } from "../components";
import { env } from "../lib/env";
import { RootStackParamList } from "../navigation/types";
import { fetchRideDetail, RideDetail, RideDriverDetail } from "../transport";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "RideDetail">;

function statusMeta(status: string): { label: string; color: string; tint: string } {
  const s = String(status || "").toUpperCase();
  if (s === "COMPLETED") return { label: "Completed", color: colors.success, tint: "#e9f7ef" };
  if (s === "CANCELED" || s === "CANCELLED") return { label: "Cancelled", color: colors.danger, tint: "#fdecec" };
  if (s === "EXPIRED") return { label: "Expired", color: colors.danger, tint: "#fdecec" };
  if (s === "PENDING_ASSIGNMENT") return { label: "Finding driver", color: colors.primary, tint: colors.brand[50] };
  if (s === "PENDING_ADMIN_ASSIGNMENT") return { label: "Team assigning", color: colors.warning, tint: "#fff8e6" };
  if (s === "IN_PROGRESS") return { label: "In progress", color: colors.primary, tint: colors.brand[50] };
  return { label: "Scheduled", color: colors.primary, tint: colors.brand[50] };
}

function ArrivalIcon({ type, size = 16, color = colors.warning }: { type?: string | null; size?: number; color?: string }) {
  const t = String(type || "").toUpperCase();
  if (t === "FLIGHT") return <Plane color={color} size={size} />;
  if (t === "BUS") return <Bus color={color} size={size} />;
  if (t === "TRAIN") return <Train color={color} size={size} />;
  if (t === "FERRY") return <Ship color={color} size={size} />;
  return <Car color={color} size={size} />;
}

function arrivalLucide(type?: string | null): typeof Car {
  const t = String(type || "").toUpperCase();
  if (t === "FLIGHT") return Plane;
  if (t === "BUS") return Bus;
  if (t === "TRAIN") return Train;
  if (t === "FERRY") return Ship;
  return Car;
}

function arrivalNumberLabel(type?: string | null) {
  const t = String(type || "").toUpperCase();
  if (t === "FLIGHT") return "Flight no.";
  if (t === "BUS") return "Bus no.";
  if (t === "TRAIN") return "Train no.";
  if (t === "FERRY") return "Ferry no.";
  return "Transport no.";
}

function formatDate(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function RideDetailScreen({ route, navigation }: Props) {
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const rideId = route.params?.id;

  const [ride, setRide] = useState<RideDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!token) {
        setError("Please sign in to view this ride.");
        return;
      }
      setRide(await fetchRideDetail(token, rideId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ride details.");
    } finally {
      setLoading(false);
    }
  }, [rideId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("MyRides"));

  if (loading) {
    return (
      <SafeScreen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="bodySmall" tone="muted">
            Loading ride details...
          </AppText>
        </View>
      </SafeScreen>
    );
  }

  if (error || !ride) {
    return (
      <SafeScreen>
        <Pressable accessibilityRole="button" onPress={back} style={styles.backButton}>
          <ArrowLeft color={colors.ink} size={22} />
        </Pressable>
        <View style={styles.stateWrap}>
          <StateView title="Could not load ride" message={error || "Ride not found."} actionLabel="Try again" onAction={() => load()} />
        </View>
      </SafeScreen>
    );
  }

  const meta = statusMeta(ride.status);
  const hasRoute =
    ride.fromLatitude != null && ride.fromLongitude != null && ride.toLatitude != null && ride.toLongitude != null;
  const mapW = Math.min(640, Math.round(width - spacing[4] * 2));
  const mapH = 190;
  const mapUrl =
    hasRoute && env.mapboxToken
      ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
        `pin-s+64748b(${ride.fromLongitude},${ride.fromLatitude}),` +
        `pin-s+02665e(${ride.toLongitude},${ride.toLatitude})/auto/${mapW}x${mapH}@2x?padding=48&access_token=${env.mapboxToken}`
      : null;

  const openDirections = () => {
    if (!hasRoute) return;
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?saddr=${ride.fromLatitude},${ride.fromLongitude}&daddr=${ride.toLatitude},${ride.toLongitude}`
        : `https://www.google.com/maps/dir/?api=1&origin=${ride.fromLatitude},${ride.fromLongitude}&destination=${ride.toLatitude},${ride.toLongitude}`;
    Linking.openURL(url).catch(() => undefined);
  };

  const tripDate = formatDate(ride.scheduledDate);
  const overview: Array<{ label: string; value: string; Icon: typeof Car }> = [];
  if (tripDate) overview.push({ label: "Date", value: tripDate, Icon: Calendar });
  if (formatTime(ride.pickupTime)) overview.push({ label: "Pickup", value: formatTime(ride.pickupTime)!, Icon: Clock3 });
  if (formatTime(ride.dropoffTime)) overview.push({ label: "Dropoff", value: formatTime(ride.dropoffTime)!, Icon: Clock3 });
  if (ride.vehicleType) overview.push({ label: "Vehicle", value: ride.vehicleType, Icon: Car });
  if (ride.numberOfPassengers) overview.push({ label: "Passengers", value: String(ride.numberOfPassengers), Icon: Users });

  const ArrivalLucide = arrivalLucide(ride.arrivalType);
  const arrivalStats: Array<{ label: string; value: string; Icon: typeof Car }> = [];
  if (ride.pickupLocation) arrivalStats.push({ label: "Pickup point", value: ride.pickupLocation, Icon: MapPin });
  if (ride.arrivalType) arrivalStats.push({ label: "Arrival type", value: ride.arrivalType, Icon: ArrivalLucide });
  if (ride.arrivalNumber) arrivalStats.push({ label: arrivalNumberLabel(ride.arrivalType), value: ride.arrivalNumber, Icon: ArrivalLucide });
  if (ride.transportCompany) arrivalStats.push({ label: "Operator", value: ride.transportCompany, Icon: Building2 });
  if (formatTime(ride.arrivalTime)) arrivalStats.push({ label: "Arrival time", value: formatTime(ride.arrivalTime)!, Icon: Clock3 });

  const isPast = ["COMPLETED", "EXPIRED", "CANCELED", "CANCELLED"].includes(String(ride.status).toUpperCase());
  const canDirect = hasRoute && !isPast;
  const startsAt = ride.scheduledDate ? new Date(ride.scheduledDate).getTime() : 0;
  const scheduledTrip = !!ride.arrivalType || startsAt - Date.now() > 90 * 60 * 1000;

  return (
    <SafeScreen>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={back} style={styles.backButton}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
          <View style={styles.flex}>
            <AppText variant="title" weight="bold">
              Ride details
            </AppText>
          </View>
          <View style={[styles.statusPill, { backgroundColor: meta.tint }]}>
            <AppText variant="caption" weight="bold" style={{ color: meta.color }}>
              {meta.label}
            </AppText>
          </View>
        </View>

        {/* Route map. Directions are offered only for fresh (upcoming) trips;
            completed or expired trips show the route as a static record. */}
        <View style={styles.mapCard}>
          {mapUrl ? (
            canDirect ? (
              <Pressable accessibilityRole="button" onPress={openDirections} style={[styles.mapWrap, { height: mapH }]}>
                <Image source={{ uri: mapUrl }} style={styles.map} resizeMode="cover" />
                <View style={styles.openChip}>
                  <ExternalLink color={colors.primary} size={13} />
                  <AppText variant="caption" weight="bold" tone="primary">
                    Directions
                  </AppText>
                </View>
              </Pressable>
            ) : (
              <View style={[styles.mapWrap, { height: mapH }]}>
                <Image source={{ uri: mapUrl }} style={styles.map} resizeMode="cover" />
              </View>
            )
          ) : hasRoute ? (
            canDirect ? (
              <Pressable accessibilityRole="button" onPress={openDirections} style={[styles.mapWrap, styles.mapPlaceholder, { height: mapH }]}>
                <Navigation color={colors.primary} size={26} />
                <AppText variant="caption" tone="muted">
                  Tap for directions
                </AppText>
              </Pressable>
            ) : (
              <View style={[styles.mapWrap, styles.mapPlaceholder, { height: mapH }]}>
                <Navigation color={colors.primary} size={26} />
                <AppText variant="caption" tone="muted">
                  Route
                </AppText>
              </View>
            )
          ) : null}

          {/* From / To track */}
          <View style={styles.routeRow}>
            <View style={styles.track}>
              <View style={[styles.dot, { backgroundColor: colors.softText }]} />
              <View style={styles.trackLine} />
              <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            </View>
            <View style={styles.routeCol}>
              <View style={[styles.locCard, styles.locFrom]}>
                <View style={styles.locLabel}>
                  <MapPin color={colors.softText} size={12} />
                  <AppText variant="caption" weight="bold" tone="soft" style={styles.locLabelText}>
                    PICKUP
                  </AppText>
                </View>
                <AppText variant="bodySmall" weight="semiBold" numberOfLines={3}>
                  {ride.fromAddress || ride.pickupLocation || "Pickup point"}
                </AppText>
              </View>
              <View style={[styles.locCard, styles.locTo]}>
                <View style={styles.locLabel}>
                  <Navigation color={colors.primary} size={12} />
                  <AppText variant="caption" weight="bold" tone="primary" style={styles.locLabelText}>
                    DROPOFF
                  </AppText>
                </View>
                <AppText variant="bodySmall" weight="semiBold" numberOfLines={3}>
                  {ride.property?.title || ride.toAddress || "Your booked stay"}
                </AppText>
              </View>
            </View>
          </View>
        </View>

        {/* Trip overview */}
        {overview.length ? (
          <View style={styles.card}>
            <SectionTitle Icon={Car} title="Trip overview" />
            <View style={styles.statGrid}>
              {overview.map((item) => (
                <StatTile key={item.label} label={item.label} value={item.value} Icon={item.Icon} />
              ))}
            </View>
          </View>
        ) : null}

        {/* Driver */}
        <DriverSection
          driver={ride.driver}
          status={ride.status}
          isPast={isPast}
          scheduled={scheduledTrip}
          createdAt={ride.createdAt}
          contentWidth={Math.max(180, Math.min(348, Math.round(width - spacing[4] * 4)))}
        />

        {/* Arrival info */}
        {arrivalStats.length ? (
          <View style={styles.card}>
            <SectionTitle IconNode={<ArrivalIcon type={ride.arrivalType} size={16} color={colors.warning} />} title="Arrival information" />
            <View style={styles.statGrid}>
              {arrivalStats.map((item) => (
                <StatTile key={item.label} label={item.label} value={item.value} Icon={item.Icon} />
              ))}
            </View>
          </View>
        ) : null}

        {/* Payment */}
        <View style={styles.card}>
          <SectionTitle Icon={Banknote} title="Payment" />
          <View style={styles.payRow}>
            <AppText variant="bodySmall" tone="muted">
              Fare
            </AppText>
            {ride.amount != null ? (
              <AmountText amount={ride.amount} currency={ride.currency || "TZS"} variant="titleSm" weight="extraBold" />
            ) : (
              <AppText variant="bodySmall" weight="bold">
                Pending
              </AppText>
            )}
          </View>
          <View style={styles.payRow}>
            <AppText variant="bodySmall" tone="muted">
              Status
            </AppText>
            <View style={[styles.payPill, ride.paymentStatus === "PAID" ? styles.payPaid : styles.payPending]}>
              {ride.paymentStatus === "PAID" ? (
                <CheckCircle2 color={colors.success} size={12} />
              ) : (
                <Clock3 color={colors.warning} size={12} />
              )}
              <AppText
                variant="caption"
                weight="bold"
                style={{ color: ride.paymentStatus === "PAID" ? colors.success : colors.warning }}
              >
                {ride.paymentStatus === "PAID" ? "Paid" : ride.paymentStatus || "Pending"}
              </AppText>
            </View>
          </View>
        </View>

        {/* Destination property */}
        {ride.property ? (
          <View style={styles.card}>
            <SectionTitle Icon={Building2} title="Destination stay" />
            <View style={styles.propertyRow}>
              <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
                {ride.property.title}
              </AppText>
              {ride.property.district || ride.property.regionName ? (
                <AppText variant="caption" tone="muted">
                  {[ride.property.district, ride.property.regionName].filter(Boolean).join(", ")}
                </AppText>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </SafeScreen>
  );
}

function SectionTitle({
  title,
  Icon,
  IconNode
}: {
  title: string;
  Icon?: typeof Car;
  IconNode?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionTitle}>
      <View style={styles.sectionIcon}>{IconNode ?? (Icon ? <Icon color={colors.primary} size={15} /> : null)}</View>
      <AppText variant="bodySmall" weight="bold">
        {title}
      </AppText>
    </View>
  );
}

function StatTile({ label, value, Icon }: { label: string; value: string; Icon: typeof Car }) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statIcon}>
        <Icon color={colors.primary} size={15} />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" weight="bold" tone="muted" style={styles.gridLabel}>
          {label}
        </AppText>
        <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

/** The driver ID card (shown whenever a driver was assigned, including past trips),
 *  or the live "finding a driver" state for upcoming rides with none yet. */
function DriverSection({
  driver,
  status,
  isPast,
  scheduled,
  createdAt,
  contentWidth
}: {
  driver?: RideDriverDetail | null;
  status: string;
  isPast: boolean;
  scheduled: boolean;
  createdAt: string;
  contentWidth: number;
}) {
  if (driver) {
    const idNo = `NLS-${String(driver.id).padStart(4, "0")}-${new Date(createdAt).getFullYear()}`;
    const vehicle = [driver.vehicleMake, driver.vehicleType].filter(Boolean).join(" · ") || "—";
    const rounded = driver.rating != null ? Math.round(driver.rating) : 0;
    const initial = (driver.name ?? "?").trim().charAt(0).toUpperCase();
    return (
      <View>
        <View style={styles.idCard}>
          <View style={styles.idAccent} />
          {/* faint concentric arcs, top-right */}
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Circle cx="100%" cy="0%" r={120} stroke="rgba(255,255,255,0.05)" strokeWidth={1} fill="none" />
            <Circle cx="100%" cy="0%" r={84} stroke="rgba(255,255,255,0.04)" strokeWidth={1} fill="none" />
            <Circle cx="100%" cy="0%" r={50} stroke="rgba(255,255,255,0.035)" strokeWidth={1} fill="none" />
          </Svg>

          {/* top brand row */}
          <View style={styles.idTopRow}>
            <View>
              <AppText variant="caption" weight="bold" style={styles.idBrand}>
                NoLSAF
              </AppText>
              <AppText variant="caption" weight="bold" style={styles.idBrandSub}>
                DRIVER ID CARD
              </AppText>
            </View>
            <View style={styles.idWheel}>
              <Car color={colors.brand[200]} size={18} />
            </View>
          </View>

          {/* identity row */}
          <View style={styles.idIdentity}>
            <View style={styles.idAvatarWrap}>
              <View style={styles.idAvatarRing}>
                <View style={styles.idAvatar}>
                  {driver.avatarUrl ? (
                    <Image source={{ uri: driver.avatarUrl }} style={styles.idAvatarImg} />
                  ) : (
                    <AppText variant="title" weight="extraBold" tone="inverse">
                      {initial}
                    </AppText>
                  )}
                </View>
              </View>
              <View style={styles.idVerifiedBadge}>
                <Check color={colors.white} size={11} strokeWidth={3} />
              </View>
            </View>
            <View style={styles.idIdentityText}>
              <AppText variant="titleSm" weight="extraBold" tone="inverse" numberOfLines={2}>
                {driver.name || "Driver"}
              </AppText>
              <AppText variant="caption" weight="bold" style={styles.idCertified}>
                {driver.isVipDriver ? "★ Premium Certified" : "NoLSAF Certified Driver"}
              </AppText>
              {driver.rating != null ? (
                <View style={styles.idStars}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star
                      key={i}
                      size={12}
                      color={i <= rounded ? colors.warning : "rgba(255,255,255,0.25)"}
                      fill={i <= rounded ? colors.warning : "transparent"}
                    />
                  ))}
                  <AppText variant="caption" weight="bold" style={styles.idRatingNum}>
                    {driver.rating.toFixed(1)}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>

          {/* key fields, single row */}
          <View style={styles.idGrid}>
            <IdField label="ID No." value={idNo} />
            <IdField label="Plate No." value={driver.plateNumber || driver.vehiclePlate || "—"} />
            <IdField label="Vehicle" value={vehicle} />
          </View>

          {/* barcode footer with live status */}
          <View style={styles.idBarcodeRow}>
            <IdBarcode seed={driver.id} width={contentWidth} />
            <View style={styles.idBarcodeMeta}>
              <AppText variant="caption" weight="bold" style={styles.idBarcodeCode}>
                {idNo}
              </AppText>
              <View style={styles.idScanRow}>
                <View style={[styles.idActiveDot, isPast && styles.idActiveDotPast]} />
                <AppText variant="caption" weight="bold" style={styles.idScanText}>
                  {isPast ? "Trip ended" : "Active"}
                </AppText>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // No driver assigned yet (only happens on upcoming rides).
  if (!isPast) {
    const isTeam = String(status).toUpperCase() === "PENDING_ADMIN_ASSIGNMENT";
    let title: string;
    let detail: string;
    let Icon: typeof Radar;
    let chips: Array<{ Icon: typeof Radar; label: string }>;
    if (isTeam) {
      title = "Our team is on it";
      detail = "We are hand picking your driver now. Their full ID card shows up here once confirmed.";
      Icon = Headset;
      chips = [{ Icon: Headset, label: "Hand picked" }, { Icon: ShieldCheck, label: "Verified driver" }];
    } else if (scheduled) {
      title = "Driver locked in before pickup";
      detail = "For scheduled trips we confirm your driver ahead of time, so they are ready the moment you arrive.";
      Icon = CalendarClock;
      chips = [{ Icon: CalendarClock, label: "Confirmed ahead" }, { Icon: ShieldCheck, label: "Verified driver" }];
    } else {
      title = "Finding your driver";
      detail = "We are matching you with the nearest driver right now.";
      Icon = Radar;
      chips = [{ Icon: Radar, label: "Nearest driver" }, { Icon: ShieldCheck, label: "Verified driver" }];
    }
    return (
      <View style={styles.findingBlock}>
        <View style={styles.findingIcon}>
          <Icon color={colors.primary} size={18} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodySmall" weight="bold">
            {title}
          </AppText>
          <AppText variant="caption" tone="soft">
            {detail}
          </AppText>
          <View style={styles.findingChips}>
            {chips.map((c) => (
              <View key={c.label} style={styles.findingChip}>
                <c.Icon color={colors.primary} size={11} />
                <AppText variant="caption" weight="bold" tone="primary">
                  {c.label}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <SectionTitle Icon={User} title="Driver" />
      <AppText variant="bodySmall" tone="muted">
        No driver was assigned to this ride.
      </AppText>
    </View>
  );
}

/** A deterministic barcode drawn from the driver id (same seeding idea as web),
 *  so the same driver always renders the same bars. Purely decorative ID styling. */
function IdBarcode({ seed, width }: { seed: number; width: number }) {
  const height = 26;
  const bars: Array<{ x: number; w: number }> = [];
  let x = 0;
  let s = (Math.abs((seed * 1664525 + 1013904223) | 0) >>> 0) || 1;
  const next = () => {
    s = ((s * 1664525 + 1013904223) >>> 0) || 1;
    return s;
  };
  while (x < width) {
    const barW = (next() % 3) + 1;
    const gap = (next() % 3) + 2;
    if (x + barW <= width) bars.push({ x, w: barW });
    x += barW + gap;
  }
  return (
    <Svg width={width} height={height}>
      {bars.map((b) => (
        <Rect key={b.x} x={b.x} y={0} width={b.w} height={height} fill="rgba(255,255,255,0.85)" />
      ))}
    </Svg>
  );
}

function IdField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.idField}>
      <AppText variant="caption" weight="bold" style={styles.idFieldLabel}>
        {label.toUpperCase()}
      </AppText>
      <AppText variant="caption" weight="bold" tone="inverse" numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[4], minWidth: 0 },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing[3], padding: spacing[6] },
  stateWrap: { paddingTop: spacing[5] },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
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
  statusPill: { borderRadius: radius.full, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },

  // Map + route
  mapCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: "hidden",
    ...shadows.card
  },
  mapWrap: { width: "100%", backgroundColor: colors.brand[50] },
  mapPlaceholder: { alignItems: "center", justifyContent: "center", gap: spacing[2] },
  map: { width: "100%", height: "100%" },
  openChip: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.94)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  routeRow: { flexDirection: "row", gap: spacing[3], minWidth: 0, padding: spacing[4] },
  track: { alignItems: "center", paddingVertical: 6 },
  dot: { width: 9, height: 9, borderRadius: radius.full },
  trackLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  routeCol: { flex: 1, minWidth: 0, gap: spacing[2] },
  locCard: { minWidth: 0, borderRadius: radius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  locFrom: { backgroundColor: "#f1f5f9" },
  locTo: { backgroundColor: colors.brand[50] },
  locLabel: { flexDirection: "row", alignItems: "center", gap: spacing[1], marginBottom: 2 },
  locLabelText: { letterSpacing: 1 },

  // Generic card
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4],
    gap: spacing[3],
    minWidth: 0,
    ...shadows.card
  },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  gridItem: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    padding: spacing[3],
    gap: spacing[1]
  },
  gridLabel: { textTransform: "uppercase", letterSpacing: 1 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing[2] },
  statTile: {
    width: "48%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3]
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },

  // Payment
  payRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3], minWidth: 0 },
  payPill: { flexDirection: "row", alignItems: "center", gap: spacing[1], borderRadius: radius.full, paddingHorizontal: spacing[2], paddingVertical: 3 },
  payPaid: { backgroundColor: "#e9f7ef" },
  payPending: { backgroundColor: "#fff8e6" },
  propertyRow: { borderRadius: radius.md, backgroundColor: "#f8fafc", padding: spacing[3], gap: spacing[1] },

  // Driver ID card
  idCard: {
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
    aspectRatio: 1.6,
    justifyContent: "space-between",
    borderRadius: radius.lg,
    backgroundColor: colors.primaryDeep,
    padding: spacing[4],
    overflow: "hidden",
    ...shadows.sheet
  },
  idAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.primary },
  idTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  idBrand: { color: "rgba(255,255,255,0.55)", letterSpacing: 3 },
  idBrandSub: { color: "rgba(255,255,255,0.4)", letterSpacing: 2 },
  idWheel: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)"
  },
  idIdentity: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  idAvatarWrap: { width: 60, height: 60, alignItems: "center", justifyContent: "center" },
  idAvatarRing: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,102,94,0.35)",
    borderWidth: 1,
    borderColor: "rgba(118,194,183,0.4)"
  },
  idAvatar: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryDark,
    borderWidth: 2,
    borderColor: "rgba(118,194,183,0.7)",
    overflow: "hidden"
  },
  idAvatarImg: { width: "100%", height: "100%" },
  idVerifiedBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.primaryDeep
  },
  idIdentityText: { flex: 1, minWidth: 0 },
  idCertified: { color: colors.brand[200], letterSpacing: 1, marginTop: 2 },
  idStars: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 },
  idRatingNum: { color: "rgba(255,255,255,0.55)", marginLeft: spacing[1] },
  idGrid: { flexDirection: "row", gap: spacing[2] },
  idField: { flex: 1, minWidth: 0, gap: 2 },
  idFieldLabel: { color: "rgba(255,255,255,0.4)", letterSpacing: 1.2 },
  idActiveRow: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  idActiveDot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.success },
  idActiveDotPast: { backgroundColor: "rgba(255,255,255,0.4)" },
  idBarcodeRow: {
    gap: spacing[1],
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingTop: spacing[2]
  },
  idBarcodeMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  idBarcodeCode: { color: "rgba(255,255,255,0.7)", letterSpacing: 2 },
  idScanRow: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  idScanText: { color: colors.brand[200], letterSpacing: 0.5 },
  driverNote: { marginTop: spacing[2], paddingHorizontal: spacing[1] },

  // Finding state
  findingBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[4]
  },
  findingIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  findingChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[2]
  },
  findingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  }
});
