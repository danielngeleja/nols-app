import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Bell, Building2, ChevronRight, GalleryHorizontal, Home, Landmark, MapPin, Route, Search, TicketsPlane, UsersRound } from "lucide-react-native";
import { Animated, Easing, ImageSourcePropType, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useAuth } from "../auth";
import { AppCard, AppStack, AppText, CustomerBottomNav, GetThereSection, GuestBottomNav, NolsafLogoMark, PLACE_TILE_WIDTH, PlaceTile, PlaceTileSkeleton, SafeScreen, TourOperatorTile } from "../components";
import { RootStackParamList } from "../navigation/types";
import { fetchCustomerNotifications } from "../notifications";
import { fetchCitySummary, fetchParkSummary, ParkSummaryItem } from "../properties/propertiesApi";
import { fetchMyBookings } from "../bookings/bookingsApi";
import type { BookingListItem } from "../bookings/types";
import { fetchPublicPropertiesHomeSummary, PublicPropertyCard } from "../properties";
import campsiteFallback from "../../assets/property-types/campsite.jpg";
import guestHouseFallback from "../../assets/property-types/guest_house.jpg";
import hotelFallback from "../../assets/property-types/hotel.jpg";
import localHousesFallback from "../../assets/property-types/local_houses.jpg";
import villaFallback from "../../assets/property-types/villa.jpg";
import villageStayFallback from "../../assets/property-types/village_stay.jpg";
import { colors, radius, spacing } from "../theme";
import { FeaturedTourOperator, fetchFeaturedTourOperators } from "../tours";

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding">;
type HeroFilter = "all" | "stays" | "tours" | "places";
type PropertyTypeKey = "HOTEL" | "LODGE" | "APARTMENT" | "VILLA" | "GUEST_HOUSE" | "BUNGALOW" | "CABIN" | "HOMESTAY" | "CONDO" | "HOUSE";

const searchPrompts = [
  "Dar es Salaam",
  "Serengeti",
  "Hotels",
  "Lodges",
  "Tour packages",
  "National parks",
  "Arusha",
  "Zanzibar",
  "Regions and wards"
];

// `fallbackImage` mirrors the web home page: when a type has no approved listing with a
// renderable photo, the card still shows a stock image instead of a flat colour block.
const propertyTypes: Array<{
  key: PropertyTypeKey;
  title: string;
  accent: string;
  fallbackImage: ImageSourcePropType;
}> = [
  { key: "HOTEL", title: "Hotel", accent: "#02b4f5", fallbackImage: hotelFallback },
  { key: "LODGE", title: "Lodge", accent: "#10b981", fallbackImage: guestHouseFallback },
  { key: "APARTMENT", title: "Apartment", accent: "#fbbf24", fallbackImage: localHousesFallback },
  { key: "VILLA", title: "Villa", accent: "#a78bfa", fallbackImage: villaFallback },
  { key: "GUEST_HOUSE", title: "Guest house", accent: "#fb7185", fallbackImage: villageStayFallback },
  { key: "BUNGALOW", title: "Bungalow", accent: "#02b4f5", fallbackImage: villaFallback },
  { key: "CABIN", title: "Cabin", accent: "#10b981", fallbackImage: campsiteFallback },
  { key: "HOMESTAY", title: "Homestay", accent: "#fbbf24", fallbackImage: localHousesFallback },
  { key: "CONDO", title: "Condo", accent: "#a78bfa", fallbackImage: localHousesFallback },
  { key: "HOUSE", title: "House", accent: "#fb7185", fallbackImage: localHousesFallback }
];


// NoLSAF covers Tanzania only (Kenya and Uganda were removed from the web and search).
const majorCities: Array<{
  key: string;
  name: string;
  country: "Tanzania";
}> = [
  { key: "dar-es-salaam", name: "Dar es Salaam", country: "Tanzania" },
  { key: "arusha", name: "Arusha", country: "Tanzania" },
  { key: "zanzibar", name: "Zanzibar", country: "Tanzania" },
  { key: "dodoma", name: "Dodoma", country: "Tanzania" },
  { key: "mwanza", name: "Mwanza", country: "Tanzania" },
  { key: "kilimanjaro", name: "Kilimanjaro", country: "Tanzania" },
  { key: "tanga", name: "Tanga", country: "Tanzania" },
  { key: "morogoro", name: "Morogoro", country: "Tanzania" },
  { key: "mbeya", name: "Mbeya", country: "Tanzania" },
  { key: "iringa", name: "Iringa", country: "Tanzania" },
  { key: "kigoma", name: "Kigoma", country: "Tanzania" },
  { key: "mtwara", name: "Mtwara", country: "Tanzania" },
  { key: "lindi", name: "Lindi", country: "Tanzania" },
  { key: "tabora", name: "Tabora", country: "Tanzania" },
  { key: "bagamoyo", name: "Bagamoyo", country: "Tanzania" },
  { key: "pemba", name: "Pemba", country: "Tanzania" }
];

/**
 * The search box with its rotating hint ("Search Serengeti..."). Kept in its own
 * component so the hint changing every few seconds re-renders only this input,
 * not the whole landing screen.
 */
/**
 * A photo that fades in once it has loaded, over a soft tint, instead of popping
 * in after a blank box. Children (scrims, labels) show straight away.
 */
function FadeImageBackground({ source, style, imageStyle, onError, children }: { source: ImageSourcePropType; style: any; imageStyle?: any; onError?: () => void; children?: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  return (
    <View style={[style, { backgroundColor: "rgba(2,102,94,0.08)", overflow: "hidden" }, imageStyle?.borderRadius != null ? { borderRadius: imageStyle.borderRadius } : null]}>
      <Animated.Image
        source={source}
        resizeMode="cover"
        onLoad={() => Animated.timing(opacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()}
        onError={onError}
        style={[StyleSheet.absoluteFillObject, imageStyle, { opacity, width: undefined, height: undefined }]}
      />
      {children}
    </View>
  );
}

/** What is worth knowing this month about travelling in Tanzania. */
function seasonHint(date = new Date()) {
  const month = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", month: "numeric" }).format(date));
  if (month >= 6 && month <= 10) return { tag: "Migration season", line: "The Great Migration is in the northern Serengeti" };
  if (month === 1 || month === 2) return { tag: "Calving season", line: "Calving herds in the southern Serengeti" };
  if (month >= 3 && month <= 5) return { tag: "Green season", line: "Quieter parks and lower prices" };
  if (month === 11) return { tag: "Short rains", line: "Fewer crowds, lush landscapes" };
  return { tag: "Festive season", line: "Coast and Zanzibar at their busiest" };
}

const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

function RotatingSearchInput({ value, onChangeText, onSubmit, style }: { value: string; onChangeText: (v: string) => void; onSubmit: () => void; style: any }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (value.trim()) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % searchPrompts.length), 3500);
    return () => clearInterval(timer);
  }, [value]);
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={`Search ${searchPrompts[index]}...`}
      placeholderTextColor={colors.softText}
      returnKeyType="search"
      onSubmitEditing={onSubmit}
      style={style}
    />
  );
}

export function OnboardingScreen({ navigation }: Props) {
  const { status, token } = useAuth();
  const isAuthed = status === "authenticated";
  const { width: windowWidth } = useWindowDimensions();
  const [unreadCount, setUnreadCount] = useState(0);
  const [destination, setDestination] = useState("");
  const [typeCounts, setTypeCounts] = useState<Record<string, number | null>>({});
  const [typeSamples, setTypeSamples] = useState<Record<string, PublicPropertyCard | null>>({});
  const [cityCounts, setCityCounts] = useState<Record<string, number | null>>({});
  const [citySamples, setCitySamples] = useState<Record<string, PublicPropertyCard | null>>({});
  const [citiesLoaded, setCitiesLoaded] = useState(false);
  const [featuredOperators, setFeaturedOperators] = useState<FeaturedTourOperator[]>([]);
  const [operatorsLoading, setOperatorsLoading] = useState(true);
  const [parks, setParks] = useState<ParkSummaryItem[]>([]);
  // Two cards and a slice of the third are visible, so the row clearly slides.
  const propertyCardWidth = Math.max(140, Math.floor((windowWidth - spacing[4] * 2 - spacing[3] * 2) / 2.35));
  // One operator card and a slice of the next, so the row reads as a slider.
  const featuredOperatorWidth = Math.max(220, Math.round((windowWidth - spacing[4] * 2) * 0.68));
  // Busiest first once counts arrive; cities with no stays are left out (they come back as soon as they have one).
  const rankedCities = [...majorCities]
    .sort((x, y) => (cityCounts[y.key] ?? -1) - (cityCounts[x.key] ?? -1))
    .filter((city) => (cityCounts[city.key] ?? 0) > 0)
    .slice(0, 10);
  // The six best-stocked stay types; the rest are one tap away under "All stays".
  const rankedTypes = [...propertyTypes].sort((x, y) => (typeCounts[y.key] ?? -1) - (typeCounts[x.key] ?? -1)).slice(0, 6);
  // A slide is most of the card's width; the next one peeks in to invite a swipe.
  const quickVisibleCount = 1;
  const quickActionWidth = Math.max(220, Math.round((windowWidth - spacing[4] * 4) * 0.74 * quickVisibleCount));

  // The traveller's next stay (or one waiting for payment) leads the rail.
  const [nextTrip, setNextTrip] = useState<{ kind: "upcoming" | "unpaid"; booking: BookingListItem } | null>(null);
  useEffect(() => {
    if (!isAuthed || !token) {
      setNextTrip(null);
      return;
    }
    let cancelled = false;
    fetchMyBookings(token, { page: 1, pageSize: 20 })
      .then((res: any) => {
        if (cancelled) return;
        const items: BookingListItem[] = Array.isArray(res?.items) ? res.items : [];
        const now = Date.now();
        const upcoming = items
          .filter((b) => b.isPaid && b.checkIn && new Date(b.checkOut || b.checkIn).getTime() >= now)
          .sort((x, y) => new Date(x.checkIn!).getTime() - new Date(y.checkIn!).getTime())[0];
        const unpaid = items.find((b) => !b.isPaid && b.dashboardBucket === "DRAFT" && (!b.checkIn || new Date(b.checkIn).getTime() >= now));
        setNextTrip(upcoming ? { kind: "upcoming", booking: upcoming } : unpaid ? { kind: "unpaid", booking: unpaid } : null);
      })
      .catch(() => {
        if (!cancelled) setNextTrip(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthed, token]);

  useEffect(() => {
    if (!isAuthed || !token) {
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    fetchCustomerNotifications(token, { tab: "unread", page: 1, pageSize: 1 })
      .then((res) => {
        if (!cancelled) setUnreadCount(res.totalUnread ?? res.total ?? 0);
      })
      .catch(() => {
        if (!cancelled) setUnreadCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthed, token]);

  useEffect(() => {
    let mounted = true;
    fetchPublicPropertiesHomeSummary()
      .then((summary) => {
        if (!mounted) return;
        setTypeCounts(summary.propertyTypes?.counts ?? {});
        setTypeSamples(summary.propertyTypes?.samples ?? {});
      })
      .catch(() => {
        if (!mounted) return;
        setTypeCounts({});
        setTypeSamples({});
      });

    return () => {
      mounted = false;
    };
  }, []);


  useEffect(() => {
    let mounted = true;

    setOperatorsLoading(true);
    fetchFeaturedTourOperators(5)
      .then((items) => {
        if (!mounted) return;
        setFeaturedOperators(items);
      })
      .catch(() => {
        if (!mounted) return;
        setFeaturedOperators([]);
      })
      .finally(() => {
        if (!mounted) return;
        setOperatorsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    fetchParkSummary(8).then((items) => {
      if (mounted) setParks(items);
    });

    fetchCitySummary(majorCities.map((city) => city.name)).then((items) => {
      if (!mounted) return;
      const byName = new Map(items.map((item) => [item.city.toLowerCase(), item]));
      setCityCounts(Object.fromEntries(majorCities.map((city) => [city.key, byName.get(city.name.toLowerCase())?.count ?? null])));
      setCitySamples(Object.fromEntries(majorCities.map((city) => [city.key, byName.get(city.name.toLowerCase())?.sample ?? null])));
      setCitiesLoaded(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  function runSearch(filter: HeroFilter = "all", nextDestination = destination) {
    navigation.navigate("Search", {
      destination: nextDestination.trim() || undefined,
      filter
    });
  }

  const totalStays = Object.values(typeCounts).reduce<number>((sum, n) => sum + (typeof n === "number" ? n : 0), 0);
  const citiesWithStays = majorCities.filter((city) => (cityCounts[city.key] ?? 0) > 0).length;
  const season = seasonHint();

  const tripSlide: QuickActionItem[] = nextTrip
    ? [
        {
          key: "trip",
          label: nextTrip.booking.property?.title || "Your stay",
          description:
            nextTrip.kind === "upcoming" && nextTrip.booking.checkIn
              ? (() => {
                  const d = daysUntil(nextTrip.booking.checkIn);
                  const where = nextTrip.booking.property?.city || nextTrip.booking.property?.regionName || "";
                  return `${where ? `${where} · ` : ""}${d <= 0 ? "Checking in today" : d === 1 ? "Check-in tomorrow" : `Check-in in ${d} days`}`;
                })()
              : "Pay to confirm your booking",
          tag: nextTrip.kind === "upcoming" ? "Your next stay" : "Waiting for payment",
          accent: nextTrip.kind === "upcoming" ? "#02665e" : "#b45309",
          personal: true,
          accessibilityLabel: "Open my bookings",
          icon: Building2,
          onPress: () => navigation.navigate("MyBookings")
        }
      ]
    : [];

  const quickActions: QuickActionItem[] = [
    ...tripSlide,
    {
      key: "stays",
      label: "Verified stays",
      description: "Checked by NoLSAF",
      tag: totalStays > 0 ? `${totalStays.toLocaleString()} stays` : undefined,
      accent: "#02665e",
      accessibilityLabel: "Open verified properties and stays",
      icon: Building2,
      onPress: () => navigation.navigate("VerifiedStays")
    },
    {
      key: "tours",
      label: "Tour packages",
      description: "Safaris, set prices",
      tag: featuredOperators.length ? `${featuredOperators.length} operators` : undefined,
      accent: "#0284c7",
      accessibilityLabel: "Open tour packages",
      icon: TicketsPlane,
      onPress: () => navigation.navigate("TourPackages")
    },
    {
      key: "places",
      label: "Destinations",
      description: season.tag,
      tag: season.tag,
      accent: "#7c3aed",
      accessibilityLabel: "Browse regions, parks and cities",
      icon: MapPin,
      onPress: () => navigation.navigate("Search", { filter: "places" })
    },
    {
      key: "groups",
      label: "Group stays",
      description: "One request, many offers",
      tag: citiesWithStays ? `${citiesWithStays} cities` : undefined,
      accent: "#b45309",
      accessibilityLabel: "Request a group stay",
      icon: UsersRound,
      onPress: () => navigation.navigate(isAuthed ? "GroupStayRequest" : "Login")
    }
  ];

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
        <FadeInUp>
          <View style={styles.hero}>
          <View pointerEvents="none" style={styles.heroPattern}>
            <View style={[styles.bgPanel, styles.bgPanelOne]} />
            <View style={[styles.bgPanel, styles.bgPanelTwo]} />
            <View style={[styles.bgLine, styles.bgLineOne]} />
            <View style={[styles.bgLine, styles.bgLineTwo]} />
            <View style={[styles.bgDot, styles.bgDotOne]} />
            <View style={[styles.bgDot, styles.bgDotTwo]} />
          </View>
          <AppStack gap={4} style={styles.heroContent}>
            <View style={styles.heroTopBar}>
              <View style={styles.logoMark}>
                <NolsafLogoMark color={colors.white} width={30} height={33} />
              </View>
              <View style={styles.authLinks}>
                {isAuthed ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => navigation.navigate("Notifications")}
                    style={({ pressed }) => [styles.notificationButton, pressed && styles.pressed]}
                  >
                    <Bell color={colors.white} size={20} />
                    {unreadCount > 0 ? (
                      <View style={styles.notificationBadge}>
                        <AppText variant="caption" weight="bold" tone="inverse" style={styles.notificationBadgeText}>
                          {unreadCount > 9 ? "9+" : String(unreadCount)}
                        </AppText>
                      </View>
                    ) : null}
                  </Pressable>
                ) : (
                  <>
                    <TopAuthLink label="Register" onPress={() => navigation.navigate("Register")} />
                    <View style={styles.authDivider} />
                    <TopAuthLink label="Login" onPress={() => navigation.navigate("Login")} />
                  </>
                )}
              </View>
            </View>

            <AppStack gap={3} style={styles.heroCenter}>
              <AppText variant="headline" weight="extraBold" tone="inverse" style={styles.heroTitle}>
                Quality stays for every wallet
              </AppText>
            </AppStack>

            <ServiceRail />
          </AppStack>
          </View>
        </FadeInUp>

        {/* Search first: one field and a short list of ways in (Hick's law: few, clear choices). */}
        <FadeInUp delay={60}>
          <AppCard style={styles.searchCard}>
            <View style={styles.searchBar}>
              <Search color={colors.primary} size={18} />
              <RotatingSearchInput value={destination} onChangeText={setDestination} onSubmit={() => runSearch()} style={styles.searchInput} />
            </View>
            <QuickActionRail
              activeKey=""
              itemWidth={quickActionWidth}
              items={quickActions}
              onSelect={() => undefined}
            />
          </AppCard>
        </FadeInUp>

        {/* Stay types: the most stocked first, capped, with a way to see everything. */}
        <FadeInUp delay={100}>
          <AppStack gap={3}>
            <SectionHeader title="Stays by type" actionLabel="All stays" onAction={() => navigation.navigate("VerifiedStays")} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={propertyCardWidth + spacing[3]}
              snapToAlignment="start"
              contentContainerStyle={styles.propertyTypeRail}
            >
              <View style={styles.propertyTypeCarouselRow}>
                {rankedTypes.map((item) => (
                  <PropertyTypeCard
                    key={item.key}
                    title={item.title}
                    width={propertyCardWidth}
                    image={typeSamples[item.key]?.primaryImage ? { uri: typeSamples[item.key]?.primaryImage || "" } : item.fallbackImage}
                    fallbackImage={item.fallbackImage}
                    accent={item.accent}
                    count={typeCounts[item.key]}
                    onPress={() => navigation.navigate("VerifiedStays", { propertyType: item.key })}
                  />
                ))}
                <SeeAllStaysCard onPress={() => navigation.navigate("VerifiedStays")} />
              </View>
            </ScrollView>
          </AppStack>
        </FadeInUp>

        {/* Cities: busiest first, only those with stays; skeletons until counts arrive. */}
        {!citiesLoaded || rankedCities.length > 0 ? (
        <FadeInUp delay={140}>
          <AppStack gap={3}>
            <SectionHeader title="Popular cities" actionLabel="Search" onAction={() => runSearch("places")} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={PLACE_TILE_WIDTH + spacing[2]} snapToAlignment="start" contentContainerStyle={styles.parkRail}>
              {!citiesLoaded
                ? [0, 1, 2].map((n) => <PlaceTileSkeleton key={n} />)
                : rankedCities.map((city) => (
                    <PlaceTile
                      key={city.key}
                      name={city.name}
                      stays={cityCounts[city.key] ?? 0}
                      image={citySamples[city.key]?.primaryImage || null}
                      onPress={() => navigation.navigate("VerifiedStays", { region: city.name })}
                    />
                  ))}
              {citiesLoaded ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Search all places" onPress={() => runSearch("places")} style={({ pressed }) => [styles.seeAllEnd, pressed && styles.pressed]}>
                  <View style={styles.seeAllCircle}>
                    <ChevronRight color={colors.primary} size={22} />
                  </View>
                  <AppText variant="caption" weight="bold" tone="primary">See all</AppText>
                </Pressable>
              ) : null}
            </ScrollView>
          </AppStack>
        </FadeInUp>
        ) : null}

        {/* Tours: approved operators as bookable cards; the rest are one tap away. */}
        {operatorsLoading || featuredOperators.length > 0 ? (
          <FadeInUp delay={170}>
            <AppStack gap={3}>
              <SectionHeader title="Tour operators" subtitle="Approved companies, book and pay in the app" actionLabel="See all" onAction={() => navigation.navigate("TourPackages")} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={featuredOperatorWidth + spacing[3]}
                snapToAlignment="start"
                contentContainerStyle={styles.operatorRail}
              >
                {operatorsLoading
                  ? [0, 1].map((n) => (
                      <View key={n} style={[styles.operatorSkeleton, { width: featuredOperatorWidth }]}>
                        <View style={styles.skeletonLineWide} />
                        <View style={styles.operatorSkeletonImage} />
                        <View style={styles.skeletonLine} />
                      </View>
                    ))
                  : featuredOperators.map((operator) => (
                      <TourOperatorTile
                        key={operator.key}
                        item={operator}
                        width={featuredOperatorWidth}
                        onPress={() => navigation.navigate("TourOperator", { agentId: operator.agentId, operatorKey: operator.operatorKey, operatorName: operator.operatorName })}
                      />
                    ))}
                {!operatorsLoading ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="See all tour operators" onPress={() => navigation.navigate("TourPackages")} style={({ pressed }) => [styles.seeAllEnd, pressed && styles.pressed]}>
                    <View style={styles.seeAllCircle}>
                      <ChevronRight color={colors.primary} size={22} />
                    </View>
                    <AppText variant="caption" weight="bold" tone="primary">See all</AppText>
                  </Pressable>
                ) : null}
              </ScrollView>
            </AppStack>
          </FadeInUp>
        ) : null}

        {/* Parks with real stays linked to them; hidden until there is something to book. */}
        {parks.length > 0 ? (
        <FadeInUp delay={200}>
          <AppStack gap={3}>
            <SectionHeader title="Safari stays" subtitle="Launched in Tanzania. Growing across Africa." actionLabel="Search" onAction={() => runSearch("places")} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={PLACE_TILE_WIDTH + spacing[2]} snapToAlignment="start" contentContainerStyle={styles.parkRail}>
              {parks.map((park) => (
                <PlaceTile key={park.slug} kind="park" name={park.name} stays={park.stays} image={park.image} onPress={() => runSearch("places", park.name)} />
              ))}
              <Pressable accessibilityRole="button" accessibilityLabel="See all parks" onPress={() => runSearch("places")} style={({ pressed }) => [styles.seeAllEnd, pressed && styles.pressed]}>
                <View style={styles.seeAllCircle}>
                  <ChevronRight color={colors.primary} size={22} />
                </View>
                <AppText variant="caption" weight="bold" tone="primary">See all</AppText>
              </Pressable>
            </ScrollView>
          </AppStack>
        </FadeInUp>
        ) : null}

        <FadeInUp delay={220}>
          <GetThereSection />
        </FadeInUp>
        </AppStack>
      </SafeScreen>

      {isAuthed ? <CustomerBottomNav active="Onboarding" /> : <GuestBottomNav active="Onboarding" />}
    </View>
  );
}

/** One header style for every landing section: title, optional line, optional "see all". */
function SectionHeader({ title, subtitle, actionLabel, onAction }: { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <AppText variant="title" weight="extraBold" numberOfLines={1}>{title}</AppText>
        {subtitle ? <AppText variant="caption" tone="muted" numberOfLines={1}>{subtitle}</AppText> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8} style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}>
          <AppText variant="caption" weight="bold" tone="primary">{actionLabel}</AppText>
          <ChevronRight color={colors.primary} size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

function FadeInUp({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 420,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      })
    ]).start();
  }, [delay, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

function ServiceWord({ label }: { label: string }) {
  const iconColor = colors.brand[100];
  const icon = {
    Stays: <Home color={iconColor} size={15} />,
    Tours: <TicketsPlane color={iconColor} size={15} />,
    Rides: <Route color={iconColor} size={15} />,
    Pay: <Landmark color={iconColor} size={15} />
  }[label];

  return (
    <View style={styles.serviceStep}>
      <View style={styles.serviceNode}>{icon}</View>
      <AppText variant="caption" weight="bold" tone="inverse" style={styles.serviceWord} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function ServiceRail() {
  return (
    <View style={styles.servicePath} accessible accessibilityLabel="Stays, tours, rides and payments in one app">
      <View pointerEvents="none" style={[styles.serviceConnector, { opacity: 0.3 }]} />
      <View style={styles.serviceRow}>
        <ServiceWord label="Stays" />
        <ServiceWord label="Tours" />
        <ServiceWord label="Rides" />
        <ServiceWord label="Pay" />
      </View>
    </View>
  );
}

function TopAuthLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.topAuthLink, pressed && styles.pressed]}>
      <AppText variant="caption" weight="bold" tone="inverse" numberOfLines={1} style={styles.topAuthText}>
        {label}
      </AppText>
    </Pressable>
  );
}

type QuickActionItem = {
  key: string;
  label: string;
  description: string;
  accent: string;
  /** Short chip on the slide: a live count, the season, or the trip state. */
  tag?: string;
  image?: ImageSourcePropType;
  /** The traveller's own trip: drawn as a solid card, not a photo. */
  personal?: boolean;
  accessibilityLabel: string;
  icon: typeof Home;
  onPress: () => void;
};

function QuickActionRail({
  items
}: {
  items: QuickActionItem[];
  activeKey?: string;
  itemWidth?: number;
  onSelect?: (key: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRail}>
      {items.map((item) => (
        <QuickActionSlide key={item.key} item={item} />
      ))}
    </ScrollView>
  );
}

/**
 * A compact way in: tinted icon, name, and one live line (a count, the season,
 * or the trip state). The traveller's own trip is the one dark card.
 */
function QuickActionSlide({ item }: { item: QuickActionItem }) {
  const Icon = item.icon;
  const line = item.personal ? item.description : item.tag || item.description;
  return (
    <Pressable
      accessibilityLabel={item.accessibilityLabel}
      accessibilityRole="button"
      onPress={item.onPress}
      style={({ pressed }) => [
        styles.quickChip,
        item.personal && styles.quickChipPersonal,
        // Pressed: the border takes the chip's own colour, with a faint wash of it.
        pressed && !item.personal && { borderColor: `${item.accent}66`, backgroundColor: `${item.accent}0A` },
        pressed && styles.quickChipPressed
      ]}
    >
      <View style={[styles.quickChipIcon, { backgroundColor: item.personal ? "rgba(255,255,255,0.14)" : `${item.accent}14` }]}>
        <Icon color={item.personal ? colors.white : item.accent} size={15} />
      </View>
      <View style={styles.quickChipText}>
        <AppText variant="bodySmall" weight="bold" tone={item.personal ? "inverse" : "default"} numberOfLines={1} style={styles.quickChipTitle}>{item.label}</AppText>
        <AppText variant="caption" tone={item.personal ? "inverse" : "muted"} numberOfLines={1} style={[styles.quickChipLine, item.personal && styles.quickChipLinePersonal]}>{line}</AppText>
      </View>
    </Pressable>
  );
}

/** The end of the row: a small round "see all" button, centred against the cards. */
function SeeAllStaysCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="See all stays" onPress={onPress} style={({ pressed }) => [styles.seeAllEnd, pressed && styles.pressed]}>
      <View style={styles.seeAllCircle}>
        <ChevronRight color={colors.primary} size={22} />
      </View>
      <AppText variant="caption" weight="bold" tone="primary">See all</AppText>
    </Pressable>
  );
}

function PropertyTypeCard({
  title,
  image,
  fallbackImage,
  accent,
  count,
  width,
  onPress
}: {
  title: string;
  image: ImageSourcePropType | null;
  fallbackImage: ImageSourcePropType;
  accent: string;
  count?: number | null;
  width: number;
  onPress: () => void;
}) {
  const hoverValue = useRef(new Animated.Value(0)).current;
  // A listing photo that fails to load (expired CDN link, offline) drops back to the
  // bundled stock image rather than leaving an empty card.
  const [imageFailed, setImageFailed] = useState(false);
  const source = !image || imageFailed ? fallbackImage : image;
  const gradientId = title.replace(/[^a-zA-Z0-9]+/g, "-");

  useEffect(() => {
    setImageFailed(false);
  }, [image]);

  function animateHover(next: boolean) {
    Animated.timing(hoverValue, {
      toValue: next ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }

  const cardAnimatedStyle = {
    transform: [
      {
        translateY: hoverValue.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -4]
        })
      }
    ]
  };

  const imageAnimatedStyle = {
    transform: [
      {
        scale: hoverValue.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.035]
        })
      }
    ]
  };

  const ctaAnimatedStyle = {
    opacity: hoverValue,
    transform: [
      {
        translateY: hoverValue.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0]
        })
      }
    ]
  };

  return (
    <Pressable
      accessibilityLabel={`Browse ${title} stays`}
      accessibilityRole="button"
      onHoverIn={() => animateHover(true)}
      onHoverOut={() => animateHover(false)}
      onPress={onPress}
      style={({ pressed }) => [styles.propertyTypePressable, { width }, pressed && styles.pressed]}
    >
      <Animated.View style={[styles.propertyTypeCard, cardAnimatedStyle]}>
        <View style={styles.propertyImageClip}>
          <Animated.View style={[styles.propertyImageZoom, imageAnimatedStyle]}>
            <FadeImageBackground
              source={source}
              style={styles.propertyImage}
              imageStyle={styles.propertyImageRadius}
              onError={() => setImageFailed(true)}
            >
              {/* Same scrim as the web card: dark at the bottom for label legibility, close
                  to clear at the top so the photo itself stays visible. */}
              <View pointerEvents="none" style={styles.propertyOverlay}>
                <Svg width="100%" height="100%">
                  <Defs>
                    <LinearGradient id={`propertyScrim-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor="#000000" stopOpacity="0.1" />
                      <Stop offset="0.5" stopColor="#000000" stopOpacity="0.2" />
                      <Stop offset="1" stopColor="#000000" stopOpacity="0.75" />
                    </LinearGradient>
                    <LinearGradient id={`propertyTint-${gradientId}`} x1="0" y1="1" x2="0" y2="0">
                      <Stop offset="0" stopColor={accent} stopOpacity="0.16" />
                      <Stop offset="0.55" stopColor={accent} stopOpacity="0" />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height="100%" fill={`url(#propertyScrim-${gradientId})`} />
                  <Rect width="100%" height="100%" fill={`url(#propertyTint-${gradientId})`} />
                </Svg>
              </View>
            </FadeImageBackground>
          </Animated.View>
          <View style={[styles.propertyStatus, { borderColor: accent }]}>
            <View style={[styles.propertyStatusDot, { backgroundColor: accent }]} />
            <AppText variant="caption" weight="bold" tone="inverse" numberOfLines={1}>
              {typeof count === "number" ? count.toLocaleString() : "..."}
            </AppText>
          </View>
          <Animated.View style={[styles.propertyHoverCta, { backgroundColor: accent }, ctaAnimatedStyle]}>
            <AppText variant="caption" weight="bold" tone="inverse" numberOfLines={1}>
              Browse -&gt;
            </AppText>
          </Animated.View>
        </View>
        <View style={styles.propertyTypeFooter}>
          <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
            {title}
          </AppText>
          <View style={styles.propertyAccentWrap}>
            <View style={[styles.propertyAccentLine, { backgroundColor: accent }]} />
            <View style={[styles.propertyAccentDot, { backgroundColor: accent }]} />
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12
  },
  sectionHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  sectionAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 4
  },
  quietRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(2,102,94,0.14)",
    backgroundColor: colors.white
  },
  quietRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,102,94,0.08)"
  },
  quietRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  screen: {
    justifyContent: "center",
    paddingBottom: spacing[4]
  },
  hero: {
    overflow: "hidden",
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[6],
    gap: spacing[5]
  },
  heroPattern: {
    ...StyleSheet.absoluteFill,
    opacity: 1
  },
  logoWatermark: {
    position: "absolute",
    right: -42,
    top: 58
  },
  bgPanel: {
    position: "absolute",
    borderWidth: 1,
    borderColor: "rgba(164,215,208,0.12)",
    backgroundColor: "rgba(2,138,122,0.16)"
  },
  bgPanelOne: {
    width: 220,
    height: 220,
    borderRadius: 56,
    right: -74,
    top: -78,
    transform: [{ rotate: "28deg" }]
  },
  bgPanelTwo: {
    width: 160,
    height: 160,
    borderRadius: 42,
    left: -86,
    bottom: -66,
    transform: [{ rotate: "-24deg" }]
  },
  bgLine: {
    position: "absolute",
    height: 2,
    borderRadius: 99,
    backgroundColor: "rgba(164,215,208,0.16)"
  },
  bgLineOne: {
    width: 170,
    right: -38,
    top: 92,
    transform: [{ rotate: "-21deg" }]
  },
  bgLineTwo: {
    width: 140,
    left: -32,
    bottom: 82,
    transform: [{ rotate: "18deg" }]
  },
  bgDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand[300],
    opacity: 0.5
  },
  bgDotOne: {
    right: 46,
    bottom: 84
  },
  bgDotTwo: {
    left: 42,
    top: 78
  },
  heroContent: {
    alignItems: "center"
  },
  heroTopBar: {
    minWidth: 0,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    marginBottom: spacing[2]
  },
  logoMark: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center"
  },
  authLinks: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing[2]
  },
  topAuthLink: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing[1]
  },
  notificationButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)"
  },
  notificationBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.primaryDeep
  },
  notificationBadgeText: {
    fontSize: 10,
    lineHeight: 12
  },
  topAuthText: {
    color: "#eefaf7"
  },
  authDivider: {
    width: 1,
    height: 16,
    backgroundColor: "rgba(255,255,255,0.24)"
  },
  heroCenter: {
    alignItems: "center",
    width: "100%"
  },
  eyebrow: {
    letterSpacing: 2,
    textAlign: "center"
  },
  // Sized for Inter, which now loads before the first frame: at the 28px headline
  // it reads heavier and wraps than the system font it used to show in.
  heroTitle: {
    textAlign: "center",
    maxWidth: 310,
    fontSize: 23,
    lineHeight: 29,
    letterSpacing: -0.2
  },
  servicePath: {
    alignSelf: "stretch",
    minWidth: 0,
    marginTop: spacing[4],
    position: "relative",
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[3]
  },
  serviceConnector: {
    position: "absolute",
    left: 34,
    right: 34,
    top: 30,
    height: 2,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: "rgba(164,215,208,0.28)"
  },
  serviceFlowGlow: {
    width: "54%",
    height: 2,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    opacity: 0.75
  },
  serviceRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[1]
  },
  serviceStep: {
    minWidth: 0,
    flex: 1,
    alignItems: "center",
    gap: spacing[2]
  },
  serviceNode: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: colors.primaryDeep
  },
  serviceWord: {
    color: "#e6f4f1",
    textAlign: "center",
    fontSize: 12
  },
  pressed: {
    transform: [{ scale: 0.98 }]
  },
  searchCard: {
    gap: spacing[4],
    overflow: "hidden"
  },
  searchCardAccent: {
    ...StyleSheet.absoluteFill
  },
  searchAccentDot: {
    position: "absolute",
    width: 74,
    height: 74,
    borderRadius: 37,
    right: -28,
    top: -30,
    backgroundColor: colors.brand[50]
  },
  searchAccentLine: {
    position: "absolute",
    width: 86,
    height: 2,
    right: 8,
    top: 38,
    borderRadius: radius.full,
    backgroundColor: colors.brand[100],
    transform: [{ rotate: "-18deg" }]
  },
  searchHeader: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  searchIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  searchText: {
    flex: 1
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  searchBar: {
    minWidth: 0,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4]
  },
  searchInput: {
    minWidth: 0,
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    paddingVertical: spacing[2]
  },
  quickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 128,
    maxWidth: 200,
    height: 48,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 11,
    // A clear but soft outline, with a light lift so each chip reads as its own card.
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.14)",
    backgroundColor: colors.white,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1
  },
  quickChipPressed: {
    transform: [{ scale: 0.98 }]
  },
  quickChipPersonal: {
    minWidth: 176,
    borderColor: "#0b2420",
    backgroundColor: "#0b2420"
  },
  quickChipIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  quickChipText: {
    flexShrink: 1,
    minWidth: 0,
    gap: 0
  },
  quickChipTitle: {
    fontSize: 13,
    lineHeight: 17
  },
  quickChipLine: {
    fontSize: 11,
    lineHeight: 14
  },
  quickChipLinePersonal: {
    opacity: 0.75
  },
  quickRailShell: {
    minWidth: 0,
    position: "relative"
  },
  quickRail: {
    gap: spacing[2],
    paddingRight: spacing[2],
    // Room for the chips' soft shadow, which a horizontal scroll would otherwise clip.
    paddingVertical: 4
  },
  quickActionButton: {
    minHeight: 82,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  quickActionButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.white,
    shadowColor: colors.primaryDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 2
  },
  quickActionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  quickActionIconActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  quickActionLabel: {
    textAlign: "center",
    maxWidth: "100%",
    lineHeight: 15
  },
  citySectionHeader: {
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 1
  },
  cityHeaderText: {
    minWidth: 0,
    gap: spacing[1]
  },
  cityRows: {
    gap: spacing[2]
  },
  cityRail: {
    paddingRight: spacing[6],
    paddingVertical: spacing[1]
  },
  cityCarouselRow: {
    flexDirection: "row",
    gap: spacing[2]
  },
  cityCard: {
    minWidth: 0,
    minHeight: 142,
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2
  },
  cityImageWrap: {
    height: 92,
    position: "relative",
    overflow: "hidden",
    backgroundColor: colors.brand[50]
  },
  cityImage: {
    flex: 1,
    alignItems: "flex-end"
  },
  cityImageRadius: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg
  },
  cityImageOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(1,42,38,0.36)"
  },
  cityImageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  cityCountPill: {
    position: "absolute",
    right: spacing[2],
    top: spacing[2],
    minWidth: 44,
    height: 26,
    borderRadius: radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    backgroundColor: "rgba(1,42,38,0.72)",
    paddingHorizontal: spacing[2]
  },
  cityCountDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brand[300]
  },
  cityMeta: {
    minWidth: 0,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  cityName: {
    marginBottom: 2
  },
  tourShowcaseSection: {
    minWidth: 0,
    gap: spacing[3],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: "rgba(233,245,244,0.58)",
    padding: spacing[3]
  },
  tourShowcaseLabel: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  tourShowcaseLabelText: {
    letterSpacing: 1.1
  },
  featuredPackagesHeader: {
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(164,215,208,0.55)",
    backgroundColor: "rgba(255,255,255,0.88)",
    padding: spacing[4],
    gap: spacing[4],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 2
  },
  featuredHeaderDecor: {
    ...StyleSheet.absoluteFill
  },
  featuredHeaderGlow: {
    position: "absolute",
    right: -60,
    top: -58,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "rgba(69,170,153,0.09)"
  },
  featuredHeaderRing: {
    position: "absolute",
    right: spacing[4],
    bottom: -42,
    width: 138,
    height: 138,
    borderRadius: 69,
    borderWidth: 1,
    borderColor: "rgba(2,102,94,0.08)"
  },
  featuredHeaderMain: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  featuredHeaderCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1]
  },
  featuredHeaderTop: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginBottom: spacing[1]
  },
  featuredHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  featuredEyebrow: {
    letterSpacing: 1.3,
    opacity: 0.9
  },
  featuredHeaderDescription: {
    opacity: 0.92
  },
  featuredHeaderBadge: {
    width: 86,
    minHeight: 78,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(233,245,244,0.78)",
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  featuredHeaderBadgeText: {
    opacity: 0.76,
    textAlign: "center"
  },
  featuredHeaderFooter: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  featuredMiniPill: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: "rgba(233,245,244,0.72)",
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  featuredPackageCarousel: {
    gap: spacing[2]
  },
  featuredPackagesRail: {
    flexDirection: "row",
    gap: spacing[3],
    paddingRight: spacing[6],
    paddingVertical: spacing[1]
  },
  featuredDots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    paddingTop: spacing[1]
  },
  featuredDot: {
    width: 14,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.brand[100]
  },
  featuredDotActive: {
    width: 24,
    backgroundColor: colors.primary
  },
  tourPackageCard: {
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 3
  },
  tourOperatorHeader: {
    minWidth: 0,
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    paddingTop: spacing[3]
  },
  tourPackageImageWrap: {
    height: 220,
    marginHorizontal: spacing[3],
    borderRadius: radius.lg,
    position: "relative",
    overflow: "hidden",
    backgroundColor: colors.primaryDeep
  },
  tourImageScroller: {
    flex: 1
  },
  tourPackageImage: {
    height: "100%"
  },
  tourPackageImageRadius: {
    borderRadius: radius.lg
  },
  tourPackageImageOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(1,42,38,0.34)"
  },
  tourPackageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.lg
  },
  tourVerifiedBadge: {
    position: "absolute",
    left: spacing[2],
    top: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.full,
    backgroundColor: colors.success,
    paddingHorizontal: spacing[2],
    paddingVertical: 4
  },
  tourConfidenceBadge: {
    position: "absolute",
    right: spacing[2],
    top: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.full,
    backgroundColor: "rgba(1,42,38,0.74)",
    paddingHorizontal: spacing[2],
    paddingVertical: 4
  },
  tourBadgeText: {
    fontSize: 10,
    lineHeight: 12
  },
  tourPhotoDots: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5
  },
  tourPhotoDot: {
    width: 14,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.58)"
  },
  tourPhotoDotActive: {
    width: 22,
    backgroundColor: colors.white
  },
  tourPackageBody: {
    minWidth: 0,
    gap: spacing[3],
    padding: spacing[3],
    paddingTop: spacing[4]
  },
  tourPackageTitle: {
    minHeight: 48
  },
  tourPriceRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  tourDestination: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  tourDestinationText: {
    flex: 1
  },
  tourPriceGroup: {
    minWidth: 0,
    alignItems: "flex-end"
  },
  tourConfidencePanel: {
    minWidth: 0,
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  tourConfidenceTop: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  tourConfidenceTitle: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  tourConfidenceScore: {
    minWidth: 44,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[2]
  },
  tourServicesGrid: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  tourServiceChip: {
    minWidth: 0,
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  tourServiceText: {
    flex: 1
  },
  tourServiceMore: {
    width: "48%",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  tourPackageList: {
    minWidth: 0,
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing[2]
  },
  tourPackageListItem: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  tourMetaRow: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  tourPackageCount: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  tourCategoryPill: {
    minWidth: 0,
    alignSelf: "flex-start",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 4
  },
  tourCategoryText: {
    textAlign: "center"
  },
  tourPreviewButton: {
    minHeight: 46,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    backgroundColor: colors.primary,
    marginTop: spacing[1]
  },
  tourPackageEmpty: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[4]
  },
  tourPackageSkeletonImage: {
    height: 220,
    backgroundColor: colors.border
  },
  parkRail: {
    gap: spacing[2],
    paddingRight: spacing[4],
    paddingVertical: spacing[1]
  },
  skeletonLineWide: {
    height: 14,
    width: "82%",
    borderRadius: radius.full,
    backgroundColor: colors.border
  },
  skeletonLine: {
    height: 12,
    width: "55%",
    borderRadius: radius.full,
    backgroundColor: colors.border
  },
  propertyTypeHeader: {
    minWidth: 0,
    gap: spacing[1],
    paddingHorizontal: spacing[1]
  },
  propertyTypeTitleRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  propertyTypeTitleText: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1]
  },
  propertySwipeBadge: {
    width: 38,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2]
  },
  propertyCarouselShell: {
    minWidth: 0,
    position: "relative",
    gap: spacing[2]
  },
  operatorRail: {
    gap: spacing[3],
    paddingRight: spacing[4],
    paddingVertical: spacing[1]
  },
  operatorSkeleton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3],
    gap: spacing[2]
  },
  operatorSkeletonImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#eef2f1"
  },
  seeAllEnd: {
    width: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  seeAllCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(2,102,94,0.25)",
    backgroundColor: colors.white
  },
  propertyTypeRail: {
    paddingRight: spacing[6],
    paddingVertical: spacing[1]
  },
  propertyTypeRows: {
    gap: spacing[3]
  },
  propertyTypeCarouselRow: {
    flexDirection: "row",
    gap: spacing[3]
  },
  propertyTypePressable: {
    minWidth: 0,
    borderRadius: 22
  },
  propertySlideHint: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingRight: spacing[1]
  },
  propertySlideLine: {
    width: 26,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: colors.brand[100]
  },
  propertySlideDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary
  },
  propertyTypeCard: {
    minWidth: 0,
    width: "100%",
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.13,
    shadowRadius: 18,
    elevation: 4
  },
  propertyImageClip: {
    height: 190,
    overflow: "hidden",
    position: "relative",
    backgroundColor: colors.surface
  },
  propertyImageZoom: {
    ...StyleSheet.absoluteFill
  },
  propertyImage: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "flex-end",
    backgroundColor: colors.surface
  },
  propertyImageRadius: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22
  },
  propertyOverlay: {
    ...StyleSheet.absoluteFill
  },
  propertyStatus: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    margin: spacing[2],
    alignSelf: "flex-end",
    minWidth: 44,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.38)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    flexGrow: 0,
    flexShrink: 0
  },
  propertyStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  propertyHoverCta: {
    position: "absolute",
    bottom: spacing[3],
    alignSelf: "center",
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 3
  },
  propertyTypeFooter: {
    minHeight: 52,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  propertyAccentWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  propertyAccentLine: {
    width: 24,
    height: 2,
    borderRadius: radius.full
  },
  propertyAccentDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  }
});
