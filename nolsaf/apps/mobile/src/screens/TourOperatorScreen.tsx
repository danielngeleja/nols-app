import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BedDouble,
  Binoculars,
  Building2,
  Car,
  CreditCard,
  Compass,
  Clock3,
  Globe,
  Info,
  Landmark,
  Lock,
  Mail,
  MapPin,
  Mountain,
  Package,
  Phone,
  Radio,
  Plane,
  ShieldPlus,
  ShieldCheck,
  Smartphone,
  Star,
  Users,
  Languages,
  Camera,
  Wifi,
  Waves,
  Wrench
} from "lucide-react-native";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { AppText, SafeScreen, StateView } from "../components";
import { RootStackParamList } from "../navigation/types";
import { DiscoveryOperator, DiscoveryPackage, fetchTourOperator } from "../tours";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "TourOperator">;

/** Pick a tasteful icon for a tour category, so package cards do not rely on photos. */
function categoryIcon(category: string): typeof Globe {
  const n = category.toLowerCase();
  if (/(beach|marine|ocean|island|snorkel|diving|sea|coast)/.test(n)) return Waves;
  if (/(mountain|hiking|trek|climb|kilimanjaro|meru)/.test(n)) return Mountain;
  if (/(cultural|heritage|history|museum|tribe)/.test(n)) return Landmark;
  if (/(city|urban|town|classic move|transfer)/.test(n)) return Building2;
  if (/(safari|wildlife|game|nature|park|serengeti)/.test(n)) return Compass;
  return Globe;
}

function toolIcon(tool: string): typeof Wrench {
  const n = tool.toLowerCase();
  if (/(guide|driver|professional|certified)/.test(n)) return BadgeCheck;
  if (/(first.?aid|emergency|evacuation|safety)/.test(n)) return ShieldPlus;
  if (/(radio|communication)/.test(n)) return Radio;
  if (/(gps|tracking|satellite)/.test(n)) return MapPin;
  if (/(binocular)/.test(n)) return Binoculars;
  if (/(camp|tent|equipment|gear)/.test(n)) return Package;
  if (/(translation|language)/.test(n)) return Languages;
  if (/(photo|camera|film)/.test(n)) return Camera;
  if (/(wifi|internet)/.test(n)) return Wifi;
  if (/(vehicle|car|seat)/.test(n)) return Car;
  return Wrench;
}

/** Split into columns of `size` items each, for a fixed-row horizontal slider. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function TourOperatorScreen({ route, navigation }: Props) {
  const { agentId, operatorName } = route.params;
  const { width } = useWindowDimensions();
  const [operator, setOperator] = useState<DiscoveryOperator | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [autoSlide, setAutoSlide] = useState(true);
  const galleryRef = useRef<ScrollView | null>(null);
  const galleryWidth = width - spacing[4] * 2;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const op = await fetchTourOperator(agentId);
      if (!op) throw new Error("This operator has no approved packages right now.");
      setOperator(op);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load operator.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto slide the gallery while nothing is being touched.
  useEffect(() => {
    if (!autoSlide || !operator || operator.images.length <= 1) return;
    const timer = setInterval(() => {
      setPhotoIndex((cur) => {
        const next = (cur + 1) % operator.images.length;
        galleryRef.current?.scrollTo({ x: next * galleryWidth, animated: true });
        return next;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [autoSlide, operator, galleryWidth]);

  if (loading) {
    return (
      <SafeScreen>
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="bodySmall" tone="muted">
            Loading operator...
          </AppText>
        </View>
      </SafeScreen>
    );
  }

  if (error || !operator) {
    return (
      <SafeScreen>
        <View style={styles.headerWrap}>
          <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
            <ArrowLeft color={colors.ink} size={20} />
          </Pressable>
        </View>
        <View style={styles.stateWrap}>
          <StateView title="Could not load operator" message={error || "Operator not found."} actionLabel="Try again" onAction={() => load()} />
        </View>
      </SafeScreen>
    );
  }

  const images = operator.images;

  return (
    <View style={styles.root}>
      <SafeScreen scroll padded={false}>
        <View style={styles.body}>
          {/* Gallery */}
          <View style={styles.gallery}>
            {images.length > 0 ? (
              <ScrollView
                ref={galleryRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={galleryWidth}
                decelerationRate="fast"
                onScrollBeginDrag={() => setAutoSlide(false)}
                onMomentumScrollEnd={(e) => setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / galleryWidth))}
              >
                {images.map((uri) => (
                  <Image key={uri} source={{ uri }} style={{ width: galleryWidth, height: 230 }} resizeMode="cover" />
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.galleryPlaceholder, { width: galleryWidth, height: 230 }]}>
                <Building2 color={colors.brand[300]} size={40} />
              </View>
            )}
            <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.galleryBack} hitSlop={6}>
              <ArrowLeft color={colors.ink} size={20} />
            </Pressable>
            {images.length > 1 ? (
              <View style={styles.galleryCounter}>
                <AppText variant="caption" weight="bold" tone="inverse">
                  {photoIndex + 1}/{images.length}
                </AppText>
              </View>
            ) : null}
            {images.length > 1 ? (
              <View style={styles.galleryDots}>
                {images.slice(0, 6).map((uri, i) => (
                  <View key={`g-${uri}`} style={[styles.galleryDot, i === Math.min(photoIndex, 5) && styles.galleryDotActive]} />
                ))}
              </View>
            ) : null}
          </View>

          {/* Profile band */}
          <View style={styles.band}>
            <View style={styles.bandTop}>
              <View style={styles.logoBox}>
                {operator.logoUrl ? (
                  <Image source={{ uri: operator.logoUrl }} style={styles.logoImg} resizeMode="contain" />
                ) : (
                  <Building2 color={colors.primary} size={28} />
                )}
              </View>
              <View style={styles.flex}>
                <View style={styles.nameRow}>
                  <AppText variant="titleSm" weight="extraBold" tone="inverse" numberOfLines={2} style={styles.flex}>
                    {operator.operatorName || operatorName}
                  </AppText>
                  <View style={styles.verifiedChip}>
                    <BadgeCheck color={colors.white} size={12} />
                    <AppText variant="caption" weight="bold" tone="inverse">
                      Verified
                    </AppText>
                  </View>
                </View>
                <View style={styles.bandDivider} />
                <View style={styles.contactRow}>
                  {operator.location ? (
                    <View style={styles.contactItem}>
                      <MapPin color="rgba(255,255,255,0.6)" size={12} />
                      <AppText variant="caption" style={styles.contactText} numberOfLines={1}>
                        {operator.location}
                      </AppText>
                    </View>
                  ) : null}
                  {operator.contactPhone ? (
                    <View style={styles.contactItem}>
                      <Phone color="rgba(255,255,255,0.6)" size={12} />
                      <AppText variant="caption" style={styles.contactText} numberOfLines={1}>
                        {operator.contactPhone}
                      </AppText>
                    </View>
                  ) : null}
                  {operator.contactEmail ? (
                    <View style={styles.contactItem}>
                      <Mail color="rgba(255,255,255,0.6)" size={12} />
                      <AppText variant="caption" style={styles.contactText} numberOfLines={1}>
                        {operator.contactEmail}
                      </AppText>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            <View style={styles.bandStats}>
              <BandStat label="Years in operation" value={operator.yearsInOperation != null ? `${operator.yearsInOperation}+` : "Not set"} />
              <BandStat label="Team size" value={operator.teamSize != null ? String(operator.teamSize) : "Not set"} />
              <BandStat label="Languages" value={operator.languages || "Not set"} wide />
            </View>

            {operator.tourismTypes.length ? (
              <View style={styles.bandPills}>
                {operator.tourismTypes.slice(0, 4).map((t, i) => (
                  <View key={t} style={[styles.bandPill, i === 0 && styles.bandPillActive]}>
                    <AppText variant="caption" weight="semiBold" style={i === 0 ? styles.bandPillTextActive : styles.bandPillText} numberOfLines={1}>
                      {t}
                    </AppText>
                  </View>
                ))}
                {operator.tourismTypes.length > 4 ? (
                  <View style={styles.bandPill}>
                    <AppText variant="caption" weight="bold" style={styles.bandPillText}>
                      +{operator.tourismTypes.length - 4}
                    </AppText>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Stats strip */}
          <View style={styles.statsStrip}>
            <StatItem Icon={Globe} value={operator.tourismTypes.length} label="Tour Types" desc="Types of tours offered" />
            <StatItem Icon={Car} value={operator.vehicleCount} label="Vehicles" desc="Fleet available for guests" />
            <StatItem Icon={Package} value={operator.packageCount} label="Packages" desc="Ready to book packages" />
            <StatItem Icon={Wrench} value={operator.toolCount} label="Tools" desc="Equipment and gear" />
          </View>

          {/* One connected journey: pickup to stay to tour */}
          <View style={styles.journey}>
            <View style={styles.journeyRow}>
              <JourneyStep Icon={Plane} label="Pickup" />
              <ArrowRight color={colors.primary} size={16} style={styles.journeyArrow} />
              <JourneyStep Icon={BedDouble} label="Stay" />
              <ArrowRight color={colors.primary} size={16} style={styles.journeyArrow} />
              <JourneyStep Icon={Globe} label="Tour" />
            </View>
          </View>

          {/* About this operator */}
          {operator.description ? (
            <View style={styles.aboutCard}>
              <View style={styles.aboutHead}>
                <View style={styles.aboutIcon}>
                  <Info color={colors.primary} size={14} />
                </View>
                <AppText variant="bodySmall" weight="bold">
                  About this operator
                </AppText>
              </View>
              <AppText variant="bodySmall" tone="muted" style={styles.aboutText}>
                {operator.description}
              </AppText>
            </View>
          ) : null}

          {/* Services, three row horizontal slider */}
          {operator.services.length ? (
            <View style={styles.section}>
              <AppText variant="bodySmall" weight="bold">
                What this operator offers
              </AppText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.servicesSlider}
                keyboardShouldPersistTaps="handled"
              >
                {chunk(operator.services, 3).map((col, ci) => (
                  <View key={ci} style={styles.servicesColumn}>
                    {col.map((s) => (
                      <View key={s} style={styles.serviceChip}>
                        <AppText variant="caption" weight="semiBold" tone="primary" numberOfLines={1}>
                          {s}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Available now / Book the Packages */}
          {operator.packageCount > 0 ? (
            <View style={styles.bookCard}>
              {/* Dark header */}
              <View style={styles.bookHeader}>
                <Package color="rgba(255,255,255,0.06)" size={96} style={styles.bookWatermark} />
                <AppText variant="caption" weight="bold" style={styles.bookLabel}>
                  AVAILABLE NOW
                </AppText>
                <AppText variant="title" weight="extraBold" tone="inverse">
                  Book the Packages
                </AppText>
                <View style={styles.bookDivider} />
                <AppText variant="bodySmall" style={styles.bookSub}>
                  {operator.packageCount} tour package{operator.packageCount === 1 ? "" : "s"} ready. Pick your experience and secure your spot.
                </AppText>
              </View>

              {/* White payments + CTA */}
              <View style={styles.bookBody}>
                <AppText variant="caption" weight="bold" tone="muted" style={styles.payLabel}>
                  ACCEPTED PAYMENTS
                </AppText>
                <View style={styles.payGrid}>
                  <PayMethod Icon={CreditCard} label="Visa / Mastercard" badgeBg="#dbeafe" iconColor="#2563eb" />
                  <PayMethod Icon={Smartphone} label="Mobile Money" badgeBg="#d1fae5" iconColor="#059669" />
                  <PayMethod Icon={Building2} label="Bank Transfer" badgeBg="#fef3c7" iconColor="#d97706" full />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    navigation.navigate("TourPackageDetail", {
                      agentId: operator.agentId,
                      packageId: operator.packages[0]?.id ?? null,
                      operatorName: operator.operatorName
                    })
                  }
                  style={({ pressed }) => [styles.bookButton, pressed && styles.pressed]}
                >
                  <AppText variant="bodySmall" weight="bold" tone="inverse">
                    Book & Pay
                  </AppText>
                </Pressable>
                <View style={styles.sslRow}>
                  <Lock color={colors.softText} size={12} />
                  <AppText variant="caption" tone="soft">
                    256 bit SSL encrypted. Your payment is fully secure.
                  </AppText>
                </View>
              </View>
            </View>
          ) : null}

          {/* Packages, two column grid */}
          <View style={styles.packageGrid}>
            {operator.packages.map((pkg, index) => {
              const Cat = categoryIcon(pkg.category || "");
              return (
              <Pressable
                key={`${String(pkg.id ?? index)}-${pkg.title}`}
                accessibilityRole="button"
                onPress={() =>
                  navigation.navigate("TourPackageDetail", {
                    agentId: operator.agentId,
                    packageId: pkg.id,
                    operatorName: operator.operatorName
                  })
                }
                style={({ pressed }) => [styles.pkgCard, pressed && styles.pressed]}
              >
                <View style={styles.pkgHeader}>
                  <Cat color="rgba(255,255,255,0.12)" size={78} style={styles.pkgWatermark} />
                  <View style={styles.pkgHeaderIcon}>
                    <Cat color={colors.white} size={24} />
                  </View>
                  {pkg.category ? (
                    <View style={styles.pkgCatBadge}>
                      <AppText variant="caption" weight="bold" tone="inverse" numberOfLines={1}>
                        {pkg.category}
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <View style={styles.pkgBody}>
                  <AppText variant="bodySmall" weight="bold" numberOfLines={2} style={styles.pkgTitle}>
                    {pkg.title}
                  </AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={2} style={styles.pkgMeaning}>
                    Tour package with day plan, booking, and secure payment.
                  </AppText>
                  <View style={styles.pkgMetaRow}>
                    <MapPin color={colors.softText} size={11} />
                    <AppText variant="caption" tone="soft" numberOfLines={1} style={styles.flex}>
                      {pkg.destination}
                    </AppText>
                  </View>
                  <View style={styles.pkgInfoRow}>
                    {pkg.duration ? (
                      <View style={styles.pkgInfoPill}>
                        <Clock3 color={colors.primary} size={11} />
                        <AppText variant="caption" weight="semiBold" tone="primary" numberOfLines={1}>
                          {pkg.duration}
                        </AppText>
                      </View>
                    ) : null}
                    {pkg.groupSize ? (
                      <View style={styles.pkgInfoPill}>
                        <Users color={colors.primary} size={11} />
                        <AppText variant="caption" weight="semiBold" tone="primary" numberOfLines={1}>
                          {pkg.groupSize}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.pkgPriceRow}>
                    {pkg.pricePerPerson && pkg.pricePerPerson > 0 ? (
                      <>
                        <AppText variant="bodySmall" weight="extraBold" tone="primary" numberOfLines={1}>
                          {pkg.pricePerPerson.toLocaleString()} {pkg.currency}
                        </AppText>
                        <AppText variant="caption" tone="soft">
                          / person
                        </AppText>
                      </>
                    ) : (
                      <AppText variant="caption" weight="bold" tone="primary">
                        Price on request
                      </AppText>
                    )}
                  </View>
                  <View style={styles.pkgActionRow}>
                    <AppText variant="caption" weight="bold" tone="primary">
                      View itinerary
                    </AppText>
                    <ArrowRight color={colors.primary} size={13} />
                  </View>
                </View>
              </Pressable>
              );
            })}
          </View>

          {/* More operator details, placed after packages so booking stays first */}
          {operator.operatingRegions.length || operator.registeredParks.length ? (
            <DetailSection Icon={MapPin} title="Areas of operation">
              <View style={styles.coverageCard}>
                <View style={styles.coverageTop}>
                  <View style={styles.coverageMetric}>
                    <AppText variant="titleSm" weight="extraBold" tone="primary">
                      {operator.operatingRegions.length}
                    </AppText>
                    <AppText variant="caption" weight="bold" tone="muted">
                      Regions
                    </AppText>
                  </View>
                  <View style={styles.coverageDivider} />
                  <View style={styles.coverageMetric}>
                    <AppText variant="titleSm" weight="extraBold" tone="primary">
                      {operator.registeredParks.length}
                    </AppText>
                    <AppText variant="caption" weight="bold" tone="muted">
                      Parks
                    </AppText>
                  </View>
                </View>
                <View style={styles.coverageBody}>
                {operator.operatingRegions.length ? (
                  <View style={styles.operationPanel}>
                    <View style={styles.operationHead}>
                      <MapPin color={colors.primary} size={14} />
                      <AppText variant="caption" weight="bold" tone="muted">
                        REGIONS
                      </AppText>
                    </View>
                    <CoverageList items={operator.operatingRegions} />
                  </View>
                ) : null}
                {operator.registeredParks.length ? (
                  <View style={styles.operationPanel}>
                    <View style={styles.operationHead}>
                      <ShieldCheck color={colors.success} size={14} />
                      <AppText variant="caption" weight="bold" tone="muted">
                        PERMITTED PARKS
                      </AppText>
                    </View>
                    <CoverageList items={operator.registeredParks} strong />
                  </View>
                ) : null}
                </View>
              </View>
            </DetailSection>
          ) : null}

          {operator.vehiclePhotos.length || operator.fleet.length ? (
            <DetailSection Icon={Car} title="Vehicle gallery">
              {operator.vehiclePhotos.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vehicleRail}>
                  {operator.vehiclePhotos.map((uri, index) => (
                    <View key={`${uri}-${index}`} style={styles.vehiclePhotoCard}>
                      <Image source={{ uri }} style={styles.vehiclePhoto} resizeMode="cover" />
                      <View style={styles.vehiclePhotoBadge}>
                        <AppText variant="caption" weight="bold" tone="inverse">
                          Fleet photo {index + 1}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              {operator.fleet.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fleetRail}>
                  {operator.fleet.map((vehicle, index) => (
                    <View key={`${vehicle.type}-${index}`} style={styles.fleetCard}>
                      <View style={styles.fleetIcon}>
                        <Car color={colors.primary} size={16} />
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                          {vehicle.type}
                        </AppText>
                        <View style={styles.fleetMetaWrap}>
                          {[
                            vehicle.count ? `${vehicle.count} available` : null,
                            vehicle.capacity ? `${vehicle.capacity} seats` : null,
                            vehicle.serviceMode,
                            vehicle.condition
                          ]
                            .filter(Boolean)
                            .map((item) => (
                              <View key={item} style={styles.fleetMetaPill}>
                                <AppText variant="caption" weight="semiBold" tone="primary" numberOfLines={1}>
                                  {item}
                                </AppText>
                              </View>
                            ))}
                        </View>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
            </DetailSection>
          ) : null}

          {operator.tools.length ? (
            <DetailSection Icon={Wrench} title="Tools and equipment">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolRail}>
                {chunk(operator.tools, 2).map((col, index) => (
                  <View key={`tools-${index}`} style={styles.toolColumn}>
                    {col.map((tool) => (
                      <View key={tool} style={styles.toolCard}>
                        <View style={styles.toolIcon}>
                          {(() => {
                            const Icon = toolIcon(tool);
                            return <Icon color={colors.primary} size={14} />;
                          })()}
                        </View>
                        <AppText variant="caption" weight="semiBold" tone="primary" numberOfLines={2} style={styles.toolText}>
                          {tool}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </DetailSection>
          ) : null}

          {operator.specializations.length ? (
            <DetailSection Icon={Star} title="Specializations">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.specialRail}>
                {chunk(operator.specializations, 2).map((col, index) => (
                  <View key={`special-${index}`} style={styles.specialColumn}>
                    {col.map((item) => (
                      <View key={item} style={styles.specialCard}>
                        <View style={styles.specialIcon}>
                          <Star color={colors.white} size={14} />
                        </View>
                        <AppText variant="caption" weight="bold" tone="inverse" numberOfLines={2} style={styles.specialText}>
                          {item}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </DetailSection>
          ) : null}
        </View>
      </SafeScreen>
    </View>
  );
}

function DetailSection({ Icon, title, children }: { Icon: typeof Globe; title: string; children: ReactNode }) {
  return (
    <View style={styles.detailSection}>
      <View style={styles.detailHead}>
        <View style={styles.detailIcon}>
          <Icon color={colors.primary} size={15} />
        </View>
        <AppText variant="bodySmall" weight="bold">
          {title}
        </AppText>
      </View>
      {children}
    </View>
  );
}

function DetailChip({ label, tone = "default" }: { label: string; tone?: "default" | "soft" | "strong" }) {
  return (
    <View style={[styles.detailChip, tone === "soft" && styles.detailChipSoft, tone === "strong" && styles.detailChipStrong]}>
      <AppText variant="caption" weight="semiBold" tone={tone === "strong" ? "inverse" : "primary"} numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

function CoverageChip({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <View style={[styles.coverageChip, strong && styles.coverageChipStrong]}>
      <AppText variant="caption" weight="semiBold" tone={strong ? "inverse" : "primary"} numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

function CoverageList({ items, strong }: { items: string[]; strong?: boolean }) {
  if (items.length > 2) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.coverageRail}>
        {items.map((item) => (
          <CoverageChip key={item} label={item} strong={strong} />
        ))}
      </ScrollView>
    );
  }
  return (
    <View style={styles.coverageTwoCol}>
      {items.map((item) => (
        <View key={item} style={styles.coverageTwoColItem}>
          <CoverageChip label={item} strong={strong} />
        </View>
      ))}
    </View>
  );
}

function BandStat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <View style={[styles.bandStat, wide && styles.bandStatWide]}>
      <AppText variant="caption" weight="bold" style={styles.bandStatLabel}>
        {label.toUpperCase()}
      </AppText>
      <AppText variant="bodySmall" weight="extraBold" tone="inverse" numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

function StatItem({ Icon, value, label, desc }: { Icon: typeof Globe; value: number; label: string; desc: string }) {
  return (
    <View style={styles.statItem}>
      <View style={styles.statIconBox}>
        <Icon color={colors.primary} size={18} />
      </View>
      <View style={styles.flex}>
        <AppText variant="titleSm" weight="extraBold" tone="primary">
          {value}
        </AppText>
        <AppText variant="caption" weight="bold">
          {label}
        </AppText>
        <AppText variant="caption" tone="soft" numberOfLines={1}>
          {desc}
        </AppText>
      </View>
    </View>
  );
}

function PayMethod({
  Icon,
  label,
  badgeBg,
  iconColor,
  full
}: {
  Icon: typeof Globe;
  label: string;
  badgeBg: string;
  iconColor: string;
  full?: boolean;
}) {
  return (
    <View style={[styles.payMethod, full && styles.payMethodFull]}>
      <View style={[styles.payBadge, { backgroundColor: badgeBg }]}>
        <Icon color={iconColor} size={14} />
      </View>
      <AppText variant="caption" weight="semiBold" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function JourneyStep({ Icon, label }: { Icon: typeof Plane; label: string }) {
  return (
    <View style={styles.journeyStep}>
      <View style={styles.journeyIcon}>
        <Icon color={colors.white} size={20} />
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
  center: { textAlign: "center" },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing[3], padding: spacing[6] },
  headerWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
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
  stateWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[5] },

  // Gallery
  gallery: { width: "100%", height: 230, borderRadius: radius.xl, overflow: "hidden", backgroundColor: colors.brand[50], ...shadows.card },
  galleryPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brand[50] },
  galleryBack: {
    position: "absolute",
    top: spacing[3],
    left: spacing[4],
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)"
  },
  galleryCounter: {
    position: "absolute",
    top: spacing[3],
    right: spacing[4],
    borderRadius: radius.full,
    backgroundColor: "rgba(2,42,38,0.7)",
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  galleryDots: { position: "absolute", bottom: spacing[5], left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 },
  galleryDot: { width: 14, height: 4, borderRadius: radius.full, backgroundColor: "rgba(255,255,255,0.55)" },
  galleryDotActive: { width: 22, backgroundColor: colors.white },

  body: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[10], gap: spacing[4] },

  // Profile band
  band: { borderRadius: radius.xl, backgroundColor: colors.primary, padding: spacing[4], gap: spacing[3], ...shadows.sheet },
  bandTop: { flexDirection: "row", gap: spacing[3], minWidth: 0 },
  logoBox: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    overflow: "hidden"
  },
  logoImg: { width: "84%", height: "84%" },
  nameRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], minWidth: 0 },
  verifiedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  bandDivider: { width: 28, height: 2, borderRadius: radius.full, backgroundColor: "rgba(255,255,255,0.3)", marginVertical: spacing[2] },
  contactRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3], minWidth: 0 },
  contactItem: { flexDirection: "row", alignItems: "center", gap: spacing[1], minWidth: 0, maxWidth: "100%" },
  contactText: { color: "rgba(255,255,255,0.72)" },
  bandStats: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  bandStat: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: 2
  },
  bandStatWide: { flexBasis: "100%" },
  bandStatLabel: { color: "rgba(255,255,255,0.55)", letterSpacing: 1 },
  bandPills: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing[1] },
  bandPill: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: spacing[3],
    paddingVertical: 4
  },
  bandPillActive: { backgroundColor: "rgba(255,255,255,0.18)", borderColor: "rgba(255,255,255,0.4)" },
  bandPillText: { color: "rgba(255,255,255,0.7)" },
  bandPillTextActive: { color: colors.white },

  // Stats strip
  statsStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    ...shadows.card
  },
  statItem: {
    width: "50%",
    minWidth: 0,
    flexDirection: "row",
    gap: spacing[2],
    padding: spacing[3]
  },
  statIconBox: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },

  // Journey
  journey: {
    borderRadius: radius.xl,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[3],
    alignItems: "center"
  },
  journeyRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: spacing[2] },
  journeyArrow: { marginTop: 16 },
  journeyStep: { alignItems: "center", gap: spacing[1], width: 62 },
  journeyIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    ...shadows.card
  },
  journeyStepLabel: { textAlign: "center" },

  // About
  aboutCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[4],
    gap: spacing[3],
    ...shadows.card
  },
  aboutHead: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  aboutIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  aboutText: { lineHeight: 22 },

  // Book the Packages
  bookCard: {
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card
  },
  bookHeader: { backgroundColor: colors.primaryDeep, padding: spacing[4], gap: spacing[1], overflow: "hidden" },
  bookWatermark: { position: "absolute", right: spacing[2], top: spacing[3] },
  bookLabel: { color: "rgba(255,255,255,0.55)", letterSpacing: 1.5 },
  bookDivider: { width: 32, height: 2, borderRadius: radius.full, backgroundColor: colors.brand[300], marginVertical: spacing[2] },
  bookSub: { color: "rgba(255,255,255,0.7)", lineHeight: 20 },
  bookBody: { padding: spacing[4], gap: spacing[3] },
  payLabel: { letterSpacing: 1.2 },
  payGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  payMethod: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  payMethodFull: { flexBasis: "100%", justifyContent: "center" },
  payBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center"
  },
  bookButton: {
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing[3],
    marginTop: spacing[1]
  },
  sslRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[1] },

  // Sections
  section: { gap: spacing[2], minWidth: 0 },
  servicesSlider: { gap: spacing[2], paddingRight: spacing[3], paddingVertical: 2 },
  servicesColumn: { gap: spacing[2] },
  serviceChip: {
    width: 180,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  packageGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing[3] },
  pkgCard: {
    width: "48.5%",
    minWidth: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: "hidden",
    ...shadows.card
  },
  pressed: { opacity: 0.9 },
  pkgHeader: {
    width: "100%",
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.primaryDeep
  },
  pkgWatermark: { position: "absolute", right: -8, bottom: -10 },
  pkgHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)"
  },
  pkgCatBadge: {
    position: "absolute",
    top: spacing[2],
    left: spacing[2],
    maxWidth: "82%",
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  pkgBody: { padding: spacing[3], gap: spacing[1], minWidth: 0 },
  pkgTitle: { minHeight: 34 },
  pkgMeaning: { lineHeight: 17 },
  pkgMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing[1], minWidth: 0 },
  pkgInfoRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[1], marginTop: spacing[1] },
  pkgInfoPill: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  pkgPriceRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: spacing[1], marginTop: 2 },
  pkgActionRow: {
    marginTop: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[2]
  },

  // Detail sections below packages
  detailSection: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4],
    ...shadows.card
  },
  detailHead: { flexDirection: "row", alignItems: "center", gap: spacing[2], minWidth: 0 },
  detailIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  detailChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  detailChip: {
    maxWidth: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  detailChipSoft: { backgroundColor: colors.surface, borderColor: colors.border },
  detailChipStrong: { backgroundColor: colors.primary, borderColor: colors.primary },
  coverageCard: {
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white
  },
  coverageTop: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brand[50],
    borderBottomWidth: 1,
    borderBottomColor: colors.brand[100]
  },
  coverageMetric: { flex: 1, alignItems: "center", paddingVertical: spacing[3], gap: 1 },
  coverageDivider: { width: 1, height: 34, backgroundColor: colors.brand[100] },
  coverageBody: { gap: spacing[2], padding: spacing[3] },
  operationPanel: {
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: "#fbfdfd",
    padding: spacing[3]
  },
  operationHead: { flexDirection: "row", alignItems: "center", gap: spacing[1], minWidth: 0 },
  coverageRail: { gap: spacing[2], paddingRight: spacing[4], paddingVertical: 1 },
  coverageTwoCol: { flexDirection: "row", gap: spacing[2] },
  coverageTwoColItem: { flex: 1, minWidth: 0 },
  coverageChip: {
    width: "100%",
    minWidth: 150,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 5
  },
  coverageChipStrong: { backgroundColor: colors.primary, borderColor: colors.primary },
  vehicleRail: { gap: spacing[3], paddingRight: spacing[4], paddingVertical: 2 },
  vehiclePhotoCard: {
    width: 286,
    height: 178,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.brand[50]
  },
  vehiclePhoto: {
    width: "100%",
    height: "100%"
  },
  vehiclePhotoBadge: {
    position: "absolute",
    left: spacing[2],
    bottom: spacing[2],
    borderRadius: radius.full,
    backgroundColor: "rgba(2,42,38,0.72)",
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  fleetRail: { gap: spacing[3], paddingRight: spacing[4], paddingVertical: 2 },
  fleetCard: {
    width: 256,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[3]
  },
  fleetIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  fleetMetaWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[1], marginTop: spacing[2] },
  fleetMetaPill: {
    maxWidth: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  toolRail: { gap: spacing[3], paddingRight: spacing[4], paddingVertical: 2 },
  toolColumn: { gap: spacing[2] },
  toolCard: {
    width: 210,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  toolIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  toolText: { flex: 1, minWidth: 0 },
  specialRail: { gap: spacing[3], paddingRight: spacing[4], paddingVertical: 2 },
  specialColumn: { gap: spacing[2] },
  specialCard: {
    width: 218,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    ...shadows.card
  },
  specialIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)"
  },
  specialText: { flex: 1, minWidth: 0 }
});
