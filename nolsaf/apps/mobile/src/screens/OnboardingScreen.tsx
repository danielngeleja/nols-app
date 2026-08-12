import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Bell, Building2, CheckCircle2, ExternalLink, Filter, GalleryHorizontal, Home, Landmark, MapPin, MapPinned, PackageCheck, Route, Search, TicketsPlane, TrendingUp, UsersRound } from "lucide-react-native";
import { Animated, Easing, ImageBackground, ImageSourcePropType, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useAuth } from "../auth";
import { AppButton, AppCard, AppStack, AppText, CustomerBottomNav, FeaturedTourOperatorCard, GetThereSection, GuestBottomNav, NolsafLogoMark, SafeScreen } from "../components";
import { TOURISM_COUNTRIES } from "../data/destinations";
import { RootStackParamList } from "../navigation/types";
import { fetchCustomerNotifications } from "../notifications";
import { fetchPublicProperties, fetchPublicPropertiesHomeSummary, PublicPropertyCard } from "../properties";
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

const propertyTypes: Array<{
  key: PropertyTypeKey;
  title: string;
  accent: string;
}> = [
  { key: "HOTEL", title: "Hotel", accent: "#02b4f5" },
  { key: "LODGE", title: "Lodge", accent: "#10b981" },
  { key: "APARTMENT", title: "Apartment", accent: "#fbbf24" },
  { key: "VILLA", title: "Villa", accent: "#a78bfa" },
  { key: "GUEST_HOUSE", title: "Guest house", accent: "#fb7185" },
  { key: "BUNGALOW", title: "Bungalow", accent: "#02b4f5" },
  { key: "CABIN", title: "Cabin", accent: "#10b981" },
  { key: "HOMESTAY", title: "Homestay", accent: "#fbbf24" },
  { key: "CONDO", title: "Condo", accent: "#a78bfa" },
  { key: "HOUSE", title: "House", accent: "#fb7185" }
];

const propertyTypeRows = [propertyTypes.slice(0, 5), propertyTypes.slice(5)];

const majorCities: Array<{
  key: string;
  name: string;
  country: "Tanzania" | "Uganda" | "Kenya";
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
  { key: "pemba", name: "Pemba", country: "Tanzania" },
  { key: "kampala", name: "Kampala", country: "Uganda" },
  { key: "entebbe", name: "Entebbe", country: "Uganda" },
  { key: "nairobi", name: "Nairobi", country: "Kenya" },
  { key: "mombasa", name: "Mombasa", country: "Kenya" }
];

const tourismCountries = TOURISM_COUNTRIES;

function rotateItems<T>(items: T[], startIndex: number) {
  if (items.length === 0) return items;
  const offset = startIndex % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

export function OnboardingScreen({ navigation }: Props) {
  const { status, token } = useAuth();
  const isAuthed = status === "authenticated";
  const { width: windowWidth } = useWindowDimensions();
  const [unreadCount, setUnreadCount] = useState(0);
  const [destination, setDestination] = useState("");
  const [activeQuickAction, setActiveQuickAction] = useState("all");
  const [promptIndex, setPromptIndex] = useState(0);
  const [typeCounts, setTypeCounts] = useState<Record<string, number | null>>({});
  const [typeSamples, setTypeSamples] = useState<Record<string, PublicPropertyCard | null>>({});
  const [cityCounts, setCityCounts] = useState<Record<string, number | null>>({});
  const [citySamples, setCitySamples] = useState<Record<string, PublicPropertyCard | null>>({});
  const [cityRotationIndex, setCityRotationIndex] = useState(0);
  const [cityAutoRotateEnabled, setCityAutoRotateEnabled] = useState(true);
  const [featuredOperators, setFeaturedOperators] = useState<FeaturedTourOperator[]>([]);
  const [operatorsLoading, setOperatorsLoading] = useState(true);
  const [featuredOperatorIndex, setFeaturedOperatorIndex] = useState(0);
  const [operatorAutoSlideEnabled, setOperatorAutoSlideEnabled] = useState(true);
  const cityRotationOpacity = useRef(new Animated.Value(1)).current;
  const cityRotationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const operatorScrollRef = useRef<ScrollView | null>(null);
  const propertyCardWidth = Math.max(150, Math.floor((windowWidth - spacing[4] * 2 - spacing[3]) / 2));
  const cityCardWidth = Math.max(128, Math.floor((windowWidth - spacing[4] * 2 - spacing[3]) / 2.35));
  const featuredOperatorWidth = Math.max(284, windowWidth - spacing[4] * 2 - spacing[3] * 2);
  const countryTourismCardWidth = Math.max(292, windowWidth - spacing[4] * 2);
  const rotatedCities = rotateItems(majorCities, cityRotationIndex);
  const majorCityRows = [rotatedCities.slice(0, 10), rotatedCities.slice(10)];
  const quickVisibleCount = windowWidth >= 520 ? 4 : 3;
  const quickActionWidth = Math.max(
    92,
    Math.floor((windowWidth - spacing[4] * 4 - spacing[2] * (quickVisibleCount - 1)) / quickVisibleCount)
  );

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
    if (destination.trim()) return;
    const timer = setInterval(() => {
      setPromptIndex((current) => (current + 1) % searchPrompts.length);
    }, 3000);

    return () => clearInterval(timer);
  }, [destination]);

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
    if (!operatorAutoSlideEnabled || featuredOperators.length <= 1) return;

    const timer = setInterval(() => {
      const nextIndex = (featuredOperatorIndex + 1) % featuredOperators.length;
      setFeaturedOperatorIndex(nextIndex);
      operatorScrollRef.current?.scrollTo({
        x: nextIndex * (featuredOperatorWidth + spacing[3]),
        animated: true
      });
    }, 15000);

    return () => clearInterval(timer);
  }, [featuredOperatorIndex, featuredOperatorWidth, featuredOperators.length, operatorAutoSlideEnabled]);

  function stopOperatorAutoSlide() {
    setOperatorAutoSlideEnabled(false);
  }

  useEffect(() => {
    if (!cityAutoRotateEnabled) return;

    const timer = setInterval(() => {
      Animated.sequence([
        Animated.timing(cityRotationOpacity, {
          toValue: 0.35,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        }),
        Animated.timing(cityRotationOpacity, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        })
      ]).start();

      cityRotationTimeout.current = setTimeout(() => {
        setCityRotationIndex((current) => (current + 4) % majorCities.length);
      }, 230);
    }, 15000);

    return () => {
      clearInterval(timer);
      if (cityRotationTimeout.current) {
        clearTimeout(cityRotationTimeout.current);
      }
    };
  }, [cityAutoRotateEnabled, cityRotationOpacity]);

  function stopCityAutoRotate() {
    if (cityRotationTimeout.current) {
      clearTimeout(cityRotationTimeout.current);
      cityRotationTimeout.current = null;
    }
    setCityAutoRotateEnabled(false);
  }

  useEffect(() => {
    let mounted = true;

    setOperatorsLoading(true);
    fetchFeaturedTourOperators(10)
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

    Promise.all(
      majorCities.map(async (city) => {
        try {
          const response = await fetchPublicProperties({
            city: city.name,
            page: 1,
            pageSize: 1,
            sort: "newest"
          });
          return [city.key, response.total ?? 0, response.items?.[0] ?? null] as const;
        } catch {
          return [city.key, null, null] as const;
        }
      })
    ).then((entries) => {
      if (!mounted) return;
      setCityCounts(Object.fromEntries(entries.map(([key, count]) => [key, count])));
      setCitySamples(Object.fromEntries(entries.map(([key, , sample]) => [key, sample])));
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

  const quickActions = [
    {
      key: "all",
      label: "All",
      accessibilityLabel: "Open all NoLSAF discovery",
      icon: Home,
      onPress: () => runSearch("all")
    },
    {
      key: "stays",
      label: "Verified Stays",
      accessibilityLabel: "Open verified properties and stays",
      icon: Building2,
      onPress: () => navigation.navigate("VerifiedStays")
    },
    {
      key: "tours",
      label: "Tour Packages",
      accessibilityLabel: "Open tour packages",
      icon: TicketsPlane,
      onPress: () => navigation.navigate("TourPackages")
    },
    {
      key: "groups",
      label: "Group Stays",
      accessibilityLabel: "Request a group stay",
      icon: UsersRound,
      onPress: () => navigation.navigate(isAuthed ? "GroupStayRequest" : "Login")
    },
    {
      key: "places",
      label: "Destinations",
      accessibilityLabel: "Browse regions, parks and countries",
      icon: MapPin,
      onPress: () => navigation.navigate("Search", { filter: "places" })
    }
  ];

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
        <FadeInUp>
          <View style={styles.hero}>
          <View pointerEvents="none" style={styles.heroPattern}>
            <View style={styles.logoWatermark}>
              <NolsafLogoMark color={colors.white} width={190} height={190} opacity={0.06} />
            </View>
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
                <NolsafLogoMark color={colors.white} width={38} height={38} />
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
                Quality Stay for Every Wallet
              </AppText>
            </AppStack>

            <ServiceRail />
          </AppStack>
          </View>
        </FadeInUp>

        <FadeInUp delay={120}>
          <AppCard style={styles.searchCard}>
            <View pointerEvents="none" style={styles.searchCardAccent}>
              <View style={styles.searchAccentDot} />
              <View style={styles.searchAccentLine} />
            </View>
            <View style={styles.searchHeader}>
              <View style={styles.searchIcon}>
                <Search color={colors.primary} size={20} />
              </View>
              <AppStack gap={1} style={styles.searchText}>
                <AppText variant="titleSm" weight="bold">
                  Find your destination
                </AppText>
                <AppText variant="bodySmall" tone="muted">
                  Search NoLSAF.
                </AppText>
              </AppStack>
              <Pressable accessibilityRole="button" onPress={() => runSearch()} style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}>
                <Filter color={colors.primary} size={20} />
              </Pressable>
            </View>
            <View style={styles.searchBar}>
              <MapPin color={colors.softText} size={17} />
              <TextInput
                value={destination}
                onChangeText={setDestination}
                placeholder={`Search ${searchPrompts[promptIndex]}...`}
                placeholderTextColor={colors.softText}
                returnKeyType="search"
                onSubmitEditing={() => runSearch()}
                style={styles.searchInput}
              />
            </View>
            <QuickActionRail
              activeKey={activeQuickAction}
              itemWidth={quickActionWidth}
              items={quickActions}
              onSelect={setActiveQuickAction}
            />
          </AppCard>
        </FadeInUp>

        <FadeInUp delay={200}>
          <AppStack gap={3}>
            <View style={styles.propertyTypeHeader}>
              <View style={styles.propertyTypeTitleRow}>
                <View style={styles.propertyTypeTitleText}>
                  <AppText variant="title" weight="extraBold">
                    Browse by property type
                  </AppText>
                  <AppText variant="bodySmall" tone="muted">
                    Choose a category to view filtered stays.
                  </AppText>
                </View>
                <SwipeCue />
              </View>
            </View>
            <View style={styles.propertyCarouselShell}>
              <View style={styles.propertyTypeRows}>
                {propertyTypeRows.map((row, rowIndex) => (
                  <ScrollView
                    key={`property-type-row-${rowIndex}`}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.propertyTypeRail}
                  >
                    <View style={styles.propertyTypeCarouselRow}>
                      {row.map((item) => (
                        <PropertyTypeCard
                          key={item.key}
                          title={item.title}
                          width={propertyCardWidth}
                          image={typeSamples[item.key]?.primaryImage ? { uri: typeSamples[item.key]?.primaryImage || "" } : null}
                          accent={item.accent}
                          count={typeCounts[item.key]}
                          onPress={() =>
                            navigation.navigate("VerifiedStays", {
                              propertyType: item.key
                            })
                          }
                        />
                      ))}
                    </View>
                  </ScrollView>
                ))}
              </View>
              <View style={styles.propertySlideHint}>
                <View style={styles.propertySlideLine} />
                <View style={styles.propertySlideDot} />
              </View>
            </View>
          </AppStack>
        </FadeInUp>

        <FadeInUp delay={280}>
          <AppStack gap={3}>
            <View style={styles.citySectionHeader}>
              <View style={styles.cityHeaderText}>
                <AppText variant="title" weight="extraBold">
                  East Africa cities
                </AppText>
                <AppText variant="bodySmall" tone="muted">
                  Strong availability for fast filtering.
                </AppText>
              </View>
            </View>
            <Animated.View style={[styles.cityRows, { opacity: cityRotationOpacity }]} onTouchStart={stopCityAutoRotate}>
              {majorCityRows.map((row, rowIndex) => (
                <ScrollView
                  key={`city-row-${rowIndex}`}
                  horizontal
                  onScrollBeginDrag={stopCityAutoRotate}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.cityRail}
                >
                  <View style={styles.cityCarouselRow}>
                    {row.map((city) => (
                      <CityAvailabilityCard
                        key={city.key}
                        city={city.name}
                        country={city.country}
                        count={cityCounts[city.key]}
                        image={citySamples[city.key]?.primaryImage ? { uri: citySamples[city.key]?.primaryImage || "" } : null}
                        width={cityCardWidth}
                        onPress={() => {
                          stopCityAutoRotate();
                          navigation.navigate("VerifiedStays", {
                            region: city.name
                          });
                        }}
                      />
                    ))}
                  </View>
                </ScrollView>
              ))}
            </Animated.View>
          </AppStack>
        </FadeInUp>

        <FadeInUp delay={340}>
          <View style={styles.tourShowcaseSection}>
            <View style={styles.tourShowcaseLabel}>
              <TicketsPlane color={colors.primary} size={16} />
              <AppText variant="caption" weight="extraBold" tone="primary" numberOfLines={1} style={styles.tourShowcaseLabelText}>
                TOUR MARKETPLACE
              </AppText>
            </View>
            <AppStack gap={3}>
            <View style={styles.featuredPackagesHeader}>
              <View pointerEvents="none" style={styles.featuredHeaderDecor}>
                <View style={styles.featuredHeaderGlow} />
                <View style={styles.featuredHeaderRing} />
              </View>
              <View style={styles.featuredHeaderMain}>
                <View style={styles.featuredHeaderCopy}>
                  <View style={styles.featuredHeaderTop}>
                    <View style={styles.featuredHeaderIcon}>
                      <PackageCheck color={colors.primary} size={18} />
                    </View>
                    <AppText variant="caption" weight="extraBold" tone="primary" style={styles.featuredEyebrow}>
                      APPROVED OPERATORS
                    </AppText>
                  </View>
                  <AppText variant="title" weight="extraBold">
                    Featured tour operators
                  </AppText>
                  <AppText variant="bodySmall" tone="muted" style={styles.featuredHeaderDescription}>
                    Approved companies with visible packages, pricing and confidence signals.
                  </AppText>
                </View>
                <View style={styles.featuredHeaderBadge}>
                  <AppText variant="titleSm" weight="extraBold" tone="primary" numberOfLines={1}>
                    {operatorsLoading ? "-" : featuredOperators.length}
                  </AppText>
                  <AppText variant="caption" weight="bold" tone="soft" style={styles.featuredHeaderBadgeText} numberOfLines={1}>
                    live companies
                  </AppText>
                </View>
              </View>
              <View style={styles.featuredHeaderFooter}>
                <View style={styles.featuredMiniPill}>
                  <CheckCircle2 color={colors.primary} size={13} />
                  <AppText variant="caption" weight="bold" tone="primary" numberOfLines={1}>
                    Verified profiles
                  </AppText>
                </View>
                <View style={styles.featuredMiniPill}>
                  <TrendingUp color={colors.primary} size={13} />
                  <AppText variant="caption" weight="bold" tone="primary" numberOfLines={1}>
                    Ranked by activity
                  </AppText>
                </View>
              </View>
            </View>

            {operatorsLoading ? (
              <View style={styles.featuredPackagesRail}>
                <View style={[styles.tourPackageCard, { width: featuredOperatorWidth }]}>
                  <View style={styles.tourPackageSkeletonImage} />
                  <View style={styles.tourPackageBody}>
                    <View style={styles.skeletonLineWide} />
                    <View style={styles.skeletonLine} />
                    <View style={styles.skeletonLineWide} />
                  </View>
                </View>
              </View>
            ) : featuredOperators.length > 0 ? (
              <View style={styles.featuredPackageCarousel}>
                <ScrollView
                  ref={operatorScrollRef}
                  horizontal
                  pagingEnabled={false}
                  decelerationRate="fast"
                  snapToInterval={featuredOperatorWidth + spacing[3]}
                  snapToAlignment="start"
                  onScrollBeginDrag={stopOperatorAutoSlide}
                  onMomentumScrollEnd={(event) => {
                    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / (featuredOperatorWidth + spacing[3]));
                    setFeaturedOperatorIndex(Math.max(0, Math.min(nextIndex, featuredOperators.length - 1)));
                  }}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.featuredPackagesRail}
                >
                  {featuredOperators.map((operator) => (
                    <FeaturedTourOperatorCard
                      key={operator.key}
                      item={operator}
                      width={featuredOperatorWidth}
                      onPress={() => {
                        stopOperatorAutoSlide();
                        runSearch("tours", operator.operatorName);
                      }}
                    />
                  ))}
                </ScrollView>
                <View style={styles.featuredDots}>
                  {featuredOperators.map((operator, index) => (
                    <View key={`featured-dot-${operator.key}`} style={[styles.featuredDot, index === featuredOperatorIndex && styles.featuredDotActive]} />
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.tourPackageEmpty}>
                <PackageCheck color={colors.primary} size={22} />
                <AppText variant="bodySmall" weight="bold" tone="primary">
                  Approved tour operators will appear here.
                </AppText>
              </View>
            )}
            </AppStack>
          </View>
        </FadeInUp>

        <FadeInUp delay={420}>
          <AppStack gap={3}>
            <View style={styles.countryTourismHeader}>
              <View style={styles.countryTourismIcon}>
                <MapPinned color={colors.primary} size={18} />
              </View>
              <View style={styles.countryTourismHeaderText}>
                <AppText variant="title" weight="extraBold">
                  Explore tourism by country
                </AppText>
                <AppText variant="bodySmall" tone="muted">
                  Country quick links into parks, stays and trip support.
                </AppText>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.countryTourismRail}>
              {tourismCountries.map((country, index) => (
                <TourismCountryCard
                  key={country.key}
                  country={country}
                  index={index}
                  width={countryTourismCardWidth}
                  onCountryPress={() => runSearch("places", country.name)}
                  onParkPress={(park) => runSearch("places", `${park} ${country.name}`)}
                />
              ))}
            </ScrollView>
          </AppStack>
        </FadeInUp>

        <FadeInUp delay={460}>
          <GetThereSection />
        </FadeInUp>

        <FadeInUp delay={500}>
          <AppStack gap={2}>
          <AppButton title="Explore verified stays" icon={<Search color={colors.white} size={18} />} onPress={() => navigation.navigate("VerifiedStays")} />
          <AppButton title="Search destinations" variant="secondary" onPress={() => navigation.navigate("Search")} />
          </AppStack>
        </FadeInUp>
        </AppStack>
      </SafeScreen>

      {isAuthed ? <CustomerBottomNav active="Onboarding" /> : <GuestBottomNav active="Onboarding" />}
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
        duration: 420,
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
  const flow = useFlowValue();
  const connectorOpacity = flow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 0.45]
  });
  const glowTranslate = flow.interpolate({
    inputRange: [0, 1],
    outputRange: ["-80%", "80%"]
  });

  return (
    <View style={styles.servicePath}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.serviceConnector,
          {
            opacity: connectorOpacity
          }
        ]}
      >
        <Animated.View style={[styles.serviceFlowGlow, { transform: [{ translateX: glowTranslate }] }]} />
      </Animated.View>
      <View style={styles.serviceRow}>
        <ServiceWord label="Stays" />
        <ServiceWord label="Tours" />
        <ServiceWord label="Rides" />
        <ServiceWord label="Pay" />
      </View>
    </View>
  );
}

function useFlowValue() {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        })
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [value]);

  return value;
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
  accessibilityLabel: string;
  icon: typeof Home;
  onPress: () => void;
};

function QuickActionRail({
  items,
  activeKey,
  itemWidth,
  onSelect
}: {
  items: QuickActionItem[];
  activeKey: string;
  itemWidth: number;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.quickRailShell}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRail}>
        {items.map((item) => (
          <QuickActionButton
            key={item.key}
            item={item}
            width={itemWidth}
            active={activeKey === item.key}
            onPress={() => {
              onSelect(item.key);
              item.onPress();
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function QuickActionButton({ item, active, width, onPress }: { item: QuickActionItem; active: boolean; width: number; onPress: () => void }) {
  const Icon = item.icon;

  return (
    <Pressable
      accessibilityLabel={item.accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickActionButton,
        { width },
        active && styles.quickActionButtonActive,
        pressed && styles.pressed
      ]}
    >
      <View style={[styles.quickActionIcon, active && styles.quickActionIconActive]}>
        <Icon color={active ? colors.white : colors.primary} size={17} />
      </View>
      <AppText variant="caption" weight="bold" tone={active ? "primary" : "muted"} numberOfLines={2} style={styles.quickActionLabel}>
        {item.label}
      </AppText>
    </Pressable>
  );
}

function SwipeCue() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 950,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 950,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true
        })
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        styles.propertySwipeBadge,
        {
          transform: [
            {
              scale: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.12]
              })
            }
          ],
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.84, 1]
          })
        }
      ]}
    >
      <GalleryHorizontal color={colors.primary} size={18} />
    </Animated.View>
  );
}

function PropertyTypeCard({
  title,
  image,
  accent,
  count,
  width,
  onPress
}: {
  title: string;
  image: ImageSourcePropType | null;
  accent: string;
  count?: number | null;
  width: number;
  onPress: () => void;
}) {
  const hoverValue = useRef(new Animated.Value(0)).current;

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
            {image ? (
              <ImageBackground source={image} resizeMode="cover" style={styles.propertyImage} imageStyle={styles.propertyImageRadius}>
                <View style={styles.propertyOverlay} />
              </ImageBackground>
            ) : (
              <View style={[styles.propertyImage, styles.propertyImageFallback, { backgroundColor: accent }]}>
                <Building2 color={colors.white} size={34} strokeWidth={1.8} />
                <AppText variant="caption" weight="bold" tone="inverse">
                  Verified {title}
                </AppText>
              </View>
            )}
          </Animated.View>
          <View style={[styles.propertyStatus, { borderColor: accent }]}>
            <View style={[styles.propertyStatusDot, { backgroundColor: accent }]} />
            <AppText variant="caption" weight="bold" tone="inverse" numberOfLines={1}>
              {typeof count === "number" ? count.toLocaleString() : "-"}
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

function CityAvailabilityCard({
  city,
  country,
  count,
  image,
  width,
  onPress
}: {
  city: string;
  country: string;
  count?: number | null;
  image?: ImageSourcePropType | null;
  width: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`Browse stays in ${city}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.cityCard, { width }, pressed && styles.pressed]}
    >
      <View style={styles.cityImageWrap}>
        {image ? (
          <ImageBackground source={image} resizeMode="cover" style={styles.cityImage} imageStyle={styles.cityImageRadius}>
            <View style={styles.cityImageOverlay} />
          </ImageBackground>
        ) : (
          <View style={styles.cityImageFallback}>
            <MapPin color={colors.primary} size={22} />
          </View>
        )}
        <View style={styles.cityCountPill}>
          <View style={styles.cityCountDot} />
          <AppText variant="caption" weight="extraBold" tone={image ? "inverse" : "default"} numberOfLines={1}>
            {typeof count === "number" ? count.toLocaleString() : "-"}
          </AppText>
        </View>
      </View>
      <View style={styles.cityMeta}>
        <AppText variant="bodySmall" weight="extraBold" numberOfLines={1} style={styles.cityName}>
          {city}
        </AppText>
        <AppText variant="caption" weight="semiBold" tone="muted" numberOfLines={1}>
          {country}
        </AppText>
      </View>
    </Pressable>
  );
}

function TourismCountryCard({
  country,
  index,
  width,
  onCountryPress,
  onParkPress
}: {
  country: (typeof tourismCountries)[number];
  index: number;
  width: number;
  onCountryPress: () => void;
  onParkPress: (park: string) => void;
}) {
  const visibleParks = country.parks.slice(0, 6);
  const remainingParks = Math.max(0, country.parks.length - visibleParks.length);

  return (
    <View style={[styles.countryTourismCard, { width }]}>
      <Svg pointerEvents="none" style={styles.countryFlagGradient} width="100%" height="100%">
        <Defs>
          <LinearGradient id={`countryFlagGradient-${country.key}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={country.flagColors[0]} stopOpacity="0.12" />
            <Stop offset="0.35" stopColor={country.flagColors[1]} stopOpacity="0.09" />
            <Stop offset="0.72" stopColor={country.flagColors[2]} stopOpacity="0.08" />
            <Stop offset="1" stopColor={country.flagColors[3]} stopOpacity="0.08" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#countryFlagGradient-${country.key})`} />
      </Svg>
      <View pointerEvents="none" style={styles.countryTourismDecor}>
        <View style={styles.countryTourismOrb} />
        <View style={styles.countryTourismRing} />
      </View>
      <View style={styles.countryTourismTop}>
        <View style={styles.countryNumber}>
          <AppText variant="caption" weight="extraBold" tone="primary" numberOfLines={1}>
            {String(index + 1).padStart(2, "0")}
          </AppText>
        </View>
        <View style={styles.countryParkCount}>
          <Landmark color={colors.primary} size={13} />
          <AppText variant="caption" weight="bold" tone="primary" numberOfLines={1}>
            {country.parks.length} sites
          </AppText>
        </View>
      </View>

      <Pressable accessibilityRole="button" onPress={onCountryPress} style={({ pressed }) => [styles.countryMainLink, pressed && styles.pressed]}>
        <View style={styles.countryTextBlock}>
          <AppText variant="title" weight="extraBold" numberOfLines={1}>
            {country.name}
          </AppText>
          <AppText variant="bodySmall" weight="semiBold" tone="primary" numberOfLines={1}>
            {country.subtitle}
          </AppText>
        </View>
        <View style={styles.countryOpenMark}>
          <ExternalLink color={colors.primary} size={16} />
        </View>
      </Pressable>

      <View style={styles.countryParkGrid}>
        {visibleParks.map((park) => (
          <Pressable key={park} accessibilityRole="button" onPress={() => onParkPress(park)} style={({ pressed }) => [styles.countryParkChip, pressed && styles.pressed]}>
            <MapPin color={colors.primary} size={12} />
            <AppText variant="caption" weight="semiBold" tone="default" numberOfLines={1} style={styles.countryParkText}>
              {park}
            </AppText>
          </Pressable>
        ))}
        {remainingParks > 0 ? (
          <Pressable accessibilityRole="button" onPress={onCountryPress} style={({ pressed }) => [styles.countryParkMore, pressed && styles.pressed]}>
            <AppText variant="caption" weight="extraBold" tone="primary" numberOfLines={1}>
              +{remainingParks} more
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  heroTitle: {
    textAlign: "center",
    maxWidth: 310
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
  quickRailShell: {
    minWidth: 0,
    position: "relative"
  },
  quickRail: {
    gap: spacing[2],
    paddingRight: spacing[2]
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
  countryTourismHeader: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[1]
  },
  countryTourismIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  countryTourismHeaderText: {
    minWidth: 0,
    flex: 1,
    gap: 2
  },
  countryTourismRail: {
    gap: spacing[3],
    paddingRight: spacing[6],
    paddingVertical: spacing[1]
  },
  countryTourismCard: {
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[4],
    gap: spacing[3],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 2
  },
  countryFlagGradient: {
    ...StyleSheet.absoluteFill
  },
  countryTourismDecor: {
    ...StyleSheet.absoluteFill
  },
  countryTourismOrb: {
    position: "absolute",
    right: -42,
    top: -38,
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: "rgba(2,102,94,0.07)"
  },
  countryTourismRing: {
    position: "absolute",
    right: 30,
    bottom: -48,
    width: 124,
    height: 124,
    borderRadius: 62,
    borderWidth: 1,
    borderColor: "rgba(2,102,94,0.08)"
  },
  countryTourismTop: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  countryNumber: {
    width: 42,
    height: 42,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  countryParkCount: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: "rgba(233,245,244,0.78)",
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  countryMainLink: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  countryTextBlock: {
    minWidth: 0,
    flex: 1,
    gap: 3
  },
  countryOpenMark: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  countryParkGrid: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    paddingTop: spacing[2]
  },
  countryParkChip: {
    minWidth: 0,
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  countryParkText: {
    flex: 1
  },
  countryParkMore: {
    width: "48%",
    alignItems: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
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
  propertyImageFallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2]
  },
  propertyImageRadius: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22
  },
  propertyOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(1,42,38,0.44)"
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
