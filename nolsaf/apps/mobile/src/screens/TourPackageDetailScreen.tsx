import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ArrowRight,
  BedDouble,
  Building2,
  CalendarDays,
  Car,
  Check,
  Clock3,
  Compass,
  Gauge,
  Globe,
  Info,
  Landmark,
  MapPin,
  Mountain,
  Plane,
  ShieldCheck,
  Sparkles,
  Users,
  Utensils,
  Waves,
  X
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { AppText, SafeScreen, ScreenHeader, StateView } from "../components";
import { RootStackParamList } from "../navigation/types";
import { DiscoveryEvent, DiscoveryOperator, DiscoveryPackage, fetchTourOperator } from "../tours";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "TourPackageDetail">;

function categoryIcon(category: string): typeof Globe {
  const n = (category || "").toLowerCase();
  if (/(beach|marine|ocean|island|snorkel|diving|sea|coast)/.test(n)) return Waves;
  if (/(mountain|hiking|trek|climb|kilimanjaro|meru)/.test(n)) return Mountain;
  if (/(cultural|heritage|history|museum|tribe)/.test(n)) return Landmark;
  if (/(city|urban|town|classic move|transfer)/.test(n)) return Building2;
  if (/(safari|wildlife|game|nature|park|serengeti)/.test(n)) return Compass;
  return Globe;
}

function difficultyTone(difficulty: string): { bg: string; color: string } {
  const n = difficulty.toLowerCase();
  if (n === "easy") return { bg: "#e9f7ef", color: colors.success };
  if (n === "moderate") return { bg: "#fff8e6", color: colors.warning };
  if (n === "challenging") return { bg: "#fdecec", color: colors.danger };
  return { bg: colors.brand[50], color: colors.primary };
}

export function TourPackageDetailScreen({ route, navigation }: Props) {
  const { agentId, packageId, operatorName } = route.params;
  const { token } = useAuth();
  const [operator, setOperator] = useState<DiscoveryOperator | null>(null);
  const [pkg, setPkg] = useState<DiscoveryPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const op = await fetchTourOperator(agentId);
      if (!op) throw new Error("This package is no longer available.");
      const found = op.packages.find((p) => String(p.id ?? "") === String(packageId ?? "")) ?? op.packages[0] ?? null;
      if (!found) throw new Error("This package is no longer available.");
      setOperator(op);
      setPkg(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load package.");
    } finally {
      setLoading(false);
    }
  }, [agentId, packageId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <SafeScreen>
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="bodySmall" tone="muted">
            Loading package...
          </AppText>
        </View>
      </SafeScreen>
    );
  }

  if (error || !operator || !pkg) {
    return (
      <SafeScreen>
        <View style={styles.headerWrap}>
          <ScreenHeader onBack={() => navigation.goBack()} title="Package" />
        </View>
        <View style={styles.stateWrap}>
          <StateView title="Could not load package" message={error || "Package not found."} actionLabel="Try again" onAction={() => load()} />
        </View>
      </SafeScreen>
    );
  }

  const Cat = categoryIcon(pkg.category);
  const priced = pkg.pricePerPerson && pkg.pricePerPerson > 0;
  const openBooking = () => {
    if (!token) {
      navigation.navigate("Login");
      return;
    }
    navigation.navigate("TourBookingReview", {
      agentId: operator.agentId,
      packageId: pkg.id ?? packageId ?? "",
      packageName: pkg.title,
      operatorName: operator.operatorName
    });
  };

  const meta: Array<{ Icon: typeof Globe; label: string; value: string }> = [];
  if (pkg.duration) meta.push({ Icon: Clock3, label: "Duration", value: pkg.duration });
  if (pkg.groupSize) meta.push({ Icon: Users, label: "Group size", value: pkg.groupSize });
  if (pkg.accommodation) meta.push({ Icon: BedDouble, label: "Accommodation", value: pkg.accommodation });
  if (pkg.mealPlan) meta.push({ Icon: Utensils, label: "Meal plan", value: pkg.mealPlan });
  if (pkg.mode) meta.push({ Icon: Car, label: "Travel mode", value: pkg.mode });
  if (pkg.meetingPoint) meta.push({ Icon: MapPin, label: "Meeting point", value: pkg.meetingPoint });

  return (
    <View style={styles.root}>
      <SafeScreen scroll padded={false}>
        <View style={styles.headerWrap}>
          <ScreenHeader onBack={() => navigation.goBack()} title="Package" />
        </View>

        <View style={styles.body}>
          {/* Icon header */}
          <View style={styles.hero}>
            <Cat color="rgba(255,255,255,0.1)" size={130} style={styles.heroWatermark} />
            <View style={styles.heroIcon}>
              <Cat color={colors.white} size={30} />
            </View>
            <View style={styles.heroBadges}>
              <View style={styles.heroBadge}>
                <AppText variant="caption" weight="bold" tone="inverse" numberOfLines={1}>
                  {pkg.category}
                </AppText>
              </View>
              {pkg.difficulty ? (
                <View style={[styles.diffBadge, { backgroundColor: difficultyTone(pkg.difficulty).bg }]}>
                  <Gauge color={difficultyTone(pkg.difficulty).color} size={12} />
                  <AppText variant="caption" weight="bold" style={{ color: difficultyTone(pkg.difficulty).color }}>
                    {pkg.difficulty}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>

          {/* Title */}
          <View style={styles.titleBlock}>
            <AppText variant="caption" weight="bold" tone="primary">
              Your next adventure is waiting
            </AppText>
            <AppText variant="title" weight="extraBold" numberOfLines={3}>
              {pkg.title}
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate("TourOperator", { agentId: operator.agentId, operatorName: operator.operatorName })}
              style={styles.metaInline}
            >
              <Building2 color={colors.primary} size={14} />
              <AppText variant="bodySmall" weight="semiBold" tone="primary" numberOfLines={1} style={styles.flex}>
                {operator.operatorName || operatorName}
              </AppText>
            </Pressable>
            <View style={styles.metaInline}>
              <MapPin color={colors.softText} size={13} />
              <AppText variant="bodySmall" tone="muted" numberOfLines={1} style={styles.flex}>
                {pkg.destination}
              </AppText>
            </View>
          </View>

          {/* Price */}
          <View style={styles.priceCard}>
            <AppText variant="caption" tone="muted">
              Starting from
            </AppText>
            {priced ? (
              <AppText variant="headline" weight="extraBold" tone="primary">
                {pkg.pricePerPerson!.toLocaleString()} {pkg.currency}
              </AppText>
            ) : (
              <AppText variant="titleSm" weight="bold">
                Price on request
              </AppText>
            )}
            <AppText variant="caption" tone="soft">
              per person, commission included
            </AppText>
          </View>

          {/* Meta tiles */}
          {meta.length ? (
            <View style={styles.metaGrid}>
              {meta.map((m) => (
                <View key={m.label} style={styles.metaTile}>
                  <View style={styles.metaIcon}>
                    <m.Icon color={colors.primary} size={15} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="caption" weight="bold" tone="muted" style={styles.metaLabel}>
                      {m.label.toUpperCase()}
                    </AppText>
                    <AppText variant="bodySmall" weight="semiBold" numberOfLines={2}>
                      {m.value}
                    </AppText>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* About */}
          {pkg.description ? (
            <View style={styles.card}>
              <SectionHead Icon={Info} title="About this package" />
              <AppText variant="bodySmall" tone="muted" style={styles.bodyText}>
                {pkg.description}
              </AppText>
              {pkg.notes ? (
                <View style={styles.noteBox}>
                  <AppText variant="caption" weight="bold" tone="primary" style={styles.metaLabel}>
                    OPERATOR NOTE
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {pkg.notes}
                  </AppText>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* How your trip comes together */}
          <View style={styles.journey}>
            <AppText variant="caption" weight="bold" tone="muted" style={styles.journeyLabel}>
              HOW YOUR TRIP COMES TOGETHER
            </AppText>
            <View style={styles.journeyRow}>
              <JourneyStep Icon={Plane} label="Pickup" />
              <View style={styles.journeyLine} />
              <JourneyStep Icon={BedDouble} label="Stay" />
              <View style={styles.journeyLine} />
              <JourneyStep Icon={Compass} label="Experience" />
            </View>
          </View>

          {/* Included / Not included */}
          {pkg.included.length ? (
            <View style={styles.card}>
              <SectionHead Icon={Check} title="Included" />
              {pkg.included.map((item) => (
                <View key={item} style={styles.listRow}>
                  <Check color={colors.success} size={15} />
                  <AppText variant="bodySmall" style={styles.flex}>
                    {item}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          {pkg.excluded.length ? (
            <View style={styles.card}>
              <SectionHead Icon={X} title="Not included" />
              {pkg.excluded.map((item) => (
                <View key={item} style={styles.listRow}>
                  <X color={colors.danger} size={15} />
                  <AppText variant="bodySmall" tone="muted" style={styles.flex}>
                    {item}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          {/* Day by day itinerary */}
          {pkg.itinerary.length ? (
            <View style={styles.card}>
              <View style={styles.itinHead}>
                <SectionHead Icon={MapPin} title="Day by day itinerary" />
                <View style={styles.daysPill}>
                  <AppText variant="caption" weight="bold" tone="primary">
                    {pkg.itinerary.length} {pkg.itinerary.length === 1 ? "day" : "days"}
                  </AppText>
                </View>
              </View>
              <View style={styles.timeline}>
                {pkg.itinerary.map((d, i) => (
                  <View key={`${d.day}-${i}`} style={styles.dayRow}>
                    <View style={styles.dayTrack}>
                      <View style={styles.dayDot}>
                        <AppText variant="caption" weight="extraBold" tone="inverse">
                          {d.day}
                        </AppText>
                      </View>
                      {i < pkg.itinerary.length - 1 ? <View style={styles.dayLine} /> : null}
                    </View>
                    <View style={styles.dayBody}>
                      {d.title ? (
                        <AppText variant="bodySmall" weight="bold">
                          {d.title}
                        </AppText>
                      ) : null}
                      {d.description ? (
                        <AppText variant="caption" tone="muted" style={styles.bodyText}>
                          {d.description}
                        </AppText>
                      ) : null}

                      {d.events.length ? (
                        <View style={styles.eventRailWrap}>
                          <ScrollView
                            horizontal
                            nestedScrollEnabled
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.eventRail}
                          >
                            {d.events.map((evt, ei) => (
                              <TimelineEventCard key={`${d.day}-evt-${ei}`} event={evt} index={ei} />
                            ))}
                          </ScrollView>
                        </View>
                      ) : (
                        <View style={styles.timetableEmpty}>
                          <Clock3 color={colors.softText} size={12} />
                          <AppText variant="caption" tone="soft" style={styles.flex}>
                            Detailed timetable appears once the operator adds event times.
                          </AppText>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Booking */}
          <Pressable accessibilityRole="button" onPress={openBooking} style={styles.bookingCta}>
            <View style={styles.bookingCtaText}>
              <AppText variant="titleSm" weight="extraBold" tone="inverse">
                Book this Package
              </AppText>
            </View>
          </Pressable>
        </View>
      </SafeScreen>
    </View>
  );
}

function TimelineEventCard({ event, index }: { event: DiscoveryEvent; index: number }) {
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventCardGlow} />
      <View style={styles.eventTopRow}>
        <View style={styles.timeChip}>
          <AppText variant="bodySmall" weight="extraBold" tone="primary" numberOfLines={1}>
            {event.start || "Flexible"}
          </AppText>
          {event.end ? (
            <AppText variant="caption" tone="soft" numberOfLines={1}>
              {event.end}
            </AppText>
          ) : null}
        </View>
        <View style={styles.eventIndexPill}>
          <AppText variant="caption" weight="bold" tone="primary">
            EVENT {index + 1}
          </AppText>
        </View>
      </View>
      <AppText variant="bodySmall" weight="bold" numberOfLines={6} style={styles.eventTitle}>
        {event.activity || "Activity"}
      </AppText>
      <View style={styles.eventBottomRow}>
        <View style={styles.vibePill}>
          <Sparkles color={colors.primary} size={12} />
          <AppText variant="caption" weight="bold" tone="primary" numberOfLines={3} style={styles.flex}>
            {event.vibe || "Any"}
          </AppText>
        </View>
      </View>
    </View>
  );
}

function SectionHead({ Icon, title }: { Icon: typeof Globe; title: string }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionIcon}>
        <Icon color={colors.primary} size={14} />
      </View>
      <AppText variant="bodySmall" weight="bold">
        {title}
      </AppText>
    </View>
  );
}

function JourneyStep({ Icon, label }: { Icon: typeof Plane; label: string }) {
  return (
    <View style={styles.journeyStep}>
      <View style={styles.journeyIcon}>
        <Icon color={colors.white} size={18} />
      </View>
      <AppText variant="caption" weight="semiBold" style={styles.journeyStepLabel}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing[3], padding: spacing[6] },
  headerWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  stateWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[5] },
  body: { paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: spacing[10], gap: spacing[4] },

  // Hero icon header
  hero: {
    height: 120,
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.primaryDeep,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card
  },
  heroWatermark: { position: "absolute", right: -12, bottom: -16 },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)"
  },
  heroBadges: { position: "absolute", top: spacing[3], left: spacing[3], right: spacing[3], flexDirection: "row", justifyContent: "space-between", gap: spacing[2] },
  heroBadge: {
    maxWidth: "70%",
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  diffBadge: { flexDirection: "row", alignItems: "center", gap: spacing[1], borderRadius: radius.full, paddingHorizontal: spacing[2], paddingVertical: 3 },

  titleBlock: { gap: spacing[1], minWidth: 0 },
  metaInline: { flexDirection: "row", alignItems: "center", gap: spacing[1], minWidth: 0 },

  priceCard: {
    gap: 2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4],
    ...shadows.card
  },

  metaGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  metaTile: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 0,
    flexDirection: "row",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[3]
  },
  metaIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  metaLabel: { letterSpacing: 1 },

  card: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4],
    ...shadows.card
  },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  sectionIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  bodyText: { lineHeight: 22 },
  noteBox: { gap: 2, borderRadius: radius.md, backgroundColor: colors.brand[50], borderWidth: 1, borderColor: colors.brand[100], padding: spacing[3] },

  listRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], minWidth: 0 },

  // Journey
  journey: {
    borderRadius: radius.xl,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    padding: spacing[4],
    alignItems: "center",
    gap: spacing[3]
  },
  journeyLabel: { letterSpacing: 1.2, alignSelf: "center" },
  journeyRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: spacing[1] },
  journeyLine: { width: 22, height: 2, borderRadius: radius.full, backgroundColor: colors.brand[200], marginTop: 21 },
  journeyStep: { alignItems: "center", gap: spacing[1], width: 80 },
  journeyIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    ...shadows.card
  },
  journeyStepLabel: { textAlign: "center" },

  // Itinerary
  itinHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  daysPill: { borderRadius: radius.full, backgroundColor: colors.brand[50], borderWidth: 1, borderColor: colors.brand[100], paddingHorizontal: spacing[2], paddingVertical: 2 },
  timeline: { gap: 0 },
  dayRow: { flexDirection: "row", gap: spacing[3], minWidth: 0 },
  dayTrack: { alignItems: "center", width: 28 },
  dayDot: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  dayLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2, minHeight: 8 },
  dayBody: { flex: 1, minWidth: 0, gap: spacing[1], paddingBottom: spacing[4] },

  // Per day event rail
  eventRailWrap: { marginTop: spacing[2], marginRight: -spacing[4], marginLeft: -spacing[1] },
  eventRail: { gap: spacing[3], paddingLeft: spacing[1], paddingRight: spacing[4], paddingVertical: 2 },
  eventCard: {
    width: 236,
    minHeight: 172,
    gap: spacing[3],
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    padding: spacing[3],
    ...shadows.card
  },
  eventCardGlow: {
    position: "absolute",
    top: -44,
    right: -36,
    width: 120,
    height: 120,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50]
  },
  eventTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing[2] },
  eventIndexPill: {
    flexShrink: 1,
    minWidth: 0,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 4
  },
  eventTitle: { lineHeight: 22, minHeight: 66 },
  eventBottomRow: { marginTop: "auto", minWidth: 0 },
  timeChip: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 78,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  vibePill: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[1],
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  timetableEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    minWidth: 0
  },
  bookingCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.brand[200],
    padding: spacing[4],
    minWidth: 0,
    ...shadows.card
  },
  bookingCtaText: { alignItems: "center" },

  soonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: "#fff8e6",
    borderWidth: 1,
    borderColor: "#fde68a",
    padding: spacing[3],
    minWidth: 0
  }
});
