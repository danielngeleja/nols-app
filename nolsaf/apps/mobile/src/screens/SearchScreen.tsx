import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ArrowRight, Building2, Car, ChevronRight, Clock, Compass, Search, TicketsPlane, UsersRound, Wallet, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAuth } from "../auth";
import { fetchSystemCommission } from "../bookings/checkoutApi";
import {
  AppStack,
  AppText,
  FeaturedOperatorCarousel,
  GuestBottomNav,
  PropertyCard,
  SafeScreen,
  ScreenHeader,
  StateView
} from "../components";
import { RootStackParamList } from "../navigation/types";
import { fetchPublicProperties, PublicPropertyCard } from "../properties";
import { colors, radius, shadows, spacing } from "../theme";
import { applyFeaturedTourFilters, FeaturedTourOperator, fetchAllFeaturedTourOperators } from "../tours";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

type IconType = typeof Building2;

const RECENT_SEARCHES_KEY = "nolsaf:recentDestinationSearches";
const MAX_RECENT_SEARCHES = 5;

const SERVICE_TONES = {
  stays: { accent: colors.primary, tint: colors.brand[50] },
  tours: { accent: "#9A5A13", tint: "#FFF7E8" },
  groups: { accent: "#4F5FA8", tint: "#F1F3FB" },
  rides: { accent: "#176B78", tint: "#EDF7F8" }
} as const;

export function SearchScreen({ navigation, route }: Props) {
  const { status } = useAuth();
  const isAuthed = status === "authenticated";

  if (route.params?.filter === "places") {
    return <PlacesSearch navigation={navigation} route={route} />;
  }

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
          <ScreenHeader title="NoLSAF" subtitle="Why we exist, and where to start." onBack={() => navigation.goBack()} />

          <View style={styles.mission}>
            <AppText variant="caption" weight="bold" style={styles.missionEyebrow}>
              Our mission
            </AppText>
            <AppText variant="title" weight="extraBold" tone="inverse">
              Trusted travel across Africa, in one place.
            </AppText>
            <AppText variant="bodySmall" style={styles.missionBody}>
              Verified stays, curated tours, group trips, rides and payments, together in one account with no fragmentation.
            </AppText>
            <View style={styles.missionPills}>
              {["Verified", "Curated", "One account"].map((label) => (
                <View key={label} style={styles.missionPill}>
                  <View style={styles.missionDot} />
                  <AppText variant="caption" weight="bold" tone="inverse">
                    {label}
                  </AppText>
                </View>
              ))}
            </View>
          </View>

          <AppStack gap={3}>
            <View style={styles.sectionHeading}>
              <AppText variant="titleSm" weight="extraBold">
                Our services
              </AppText>
              <AppText variant="caption" tone="soft">
                Trusted essentials for every part of your journey.
              </AppText>
            </View>
            <View style={styles.serviceGrid}>
              <ServiceCard
                Icon={Building2}
                title="Verified Stays"
                text="Hotels, lodges and stays"
                {...SERVICE_TONES.stays}
                onPress={() => navigation.navigate("VerifiedStays")}
              />
              <ServiceCard
                Icon={TicketsPlane}
                title="Tour Packages"
                text="From trusted operators"
                {...SERVICE_TONES.tours}
                onPress={() => navigation.navigate("TourPackages")}
              />
              <ServiceCard
                Icon={UsersRound}
                title="Group Stays"
                text="Book trips together"
                {...SERVICE_TONES.groups}
                onPress={() => navigation.navigate(isAuthed ? "GroupStayRequest" : "Login")}
              />
              <ServiceCard
                Icon={Car}
                title="Rides"
                text="Airport and local rides"
                {...SERVICE_TONES.rides}
                onPress={() => navigation.navigate(isAuthed ? "MyRides" : "Login")}
              />
            </View>
          </AppStack>

          <AppStack gap={3}>
            <AppText variant="titleSm" weight="extraBold" style={styles.sectionHeading}>
              More
            </AppText>
            <View style={styles.moreGroup}>
              <MoreRow Icon={Wallet} title="Payments" text="Methods and payment guidance" onPress={() => navigation.navigate("Payments")} />
              <MoreRow
                Icon={Compass}
                title="Browse destinations"
                text="Regions, parks and countries across Africa"
                divider
                onPress={() => navigation.navigate("Search", { filter: "places" })}
              />
            </View>
          </AppStack>
        </AppStack>
      </SafeScreen>

      {isAuthed ? null : <GuestBottomNav active="Search" />}
    </View>
  );
}

function ServiceCard({
  Icon,
  title,
  text,
  accent,
  tint,
  onPress
}: {
  Icon: IconType;
  title: string;
  text: string;
  accent: string;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${text}`}
      onPress={onPress}
      style={({ pressed }) => [styles.serviceTile, pressed && styles.serviceTilePressed]}
    >
      <View style={styles.serviceTopRow}>
        <View style={[styles.serviceIcon, { backgroundColor: tint }]}>
          <Icon color={accent} size={19} strokeWidth={2.2} />
        </View>
        <ChevronRight color={colors.softText} size={16} strokeWidth={2.2} />
      </View>
      <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
        {title}
      </AppText>
      <AppText variant="caption" tone="soft" numberOfLines={1}>
        {text}
      </AppText>
    </Pressable>
  );
}

function MoreRow({ Icon, title, text, divider, onPress }: { Icon: IconType; title: string; text: string; divider?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.moreRow, pressed && styles.moreRowPressed]}>
      <View style={styles.moreIcon}>
        <Icon color={colors.primary} size={17} />
      </View>
      <View style={[styles.moreBody, divider && styles.moreDivider]}>
        <View style={styles.flex}>
          <AppText variant="bodySmall" weight="bold">
            {title}
          </AppText>
          <AppText variant="caption" tone="soft" numberOfLines={1}>
            {text}
          </AppText>
        </View>
        <ChevronRight color={colors.softText} size={17} />
      </View>
    </Pressable>
  );
}

function PlacesSearch({ navigation, route }: Props) {
  const { status, user } = useAuth();
  const recentSearchesKey = `${RECENT_SEARCHES_KEY}:${status === "authenticated" && user ? user.id : "guest"}`;
  const initialDestination = route.params?.destination ?? "";
  const initialCity = route.params?.city;
  const initialPropertyType = route.params?.propertyType;
  const didRunInitialSearch = useRef(false);
  const [destination, setDestination] = useState(initialDestination);
  const [query, setQuery] = useState<string | null>(null);
  const [items, setItems] = useState<PublicPropertyCard[]>([]);
  const [operators, setOperators] = useState<FeaturedTourOperator[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemCommission, setSystemCommission] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    fetchSystemCommission().then(setSystemCommission).catch(() => setSystemCommission(0));
  }, []);

  useEffect(() => {
    fetchAllFeaturedTourOperators().then(setOperators).catch(() => setOperators([]));
  }, []);

  useEffect(() => {
    setRecentSearches([]);
    AsyncStorage.getItem(recentSearchesKey)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecentSearches(parsed.filter((x) => typeof x === "string"));
      })
      .catch(() => {});
  }, [recentSearchesKey]);

  function rememberSearch(term: string) {
    setRecentSearches((prev) => {
      const next = [term, ...prev.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, MAX_RECENT_SEARCHES);
      AsyncStorage.setItem(recentSearchesKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function clearRecentSearches() {
    setRecentSearches([]);
    AsyncStorage.removeItem(recentSearchesKey).catch(() => {});
  }

  const tourResults = useMemo(
    () => (query ? applyFeaturedTourFilters(operators, { search: query }) : operators),
    [operators, query]
  );

  async function submitSearch(nextQuery = destination) {
    const q = nextQuery.trim();
    if (!q) {
      setSearched(false);
      setQuery(null);
      setItems([]);
      setError(null);
      return;
    }
    setSearched(true);
    setQuery(q);
    rememberSearch(q);
    setLoading(true);
    setError(null);
    try {
      const response = await fetchPublicProperties({
        q,
        city: initialCity,
        types: initialPropertyType,
        page: 1,
        pageSize: 12,
        sort: "newest"
      });
      setItems(response.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to search properties.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (didRunInitialSearch.current || !initialDestination) return;
    didRunInitialSearch.current = true;
    void submitSearch(initialDestination);
  }, [initialCity, initialDestination, initialPropertyType]);

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
          <ScreenHeader
            title="Browse destinations"
            subtitle="Verified stays and tours around any place in Tanzania."
            onBack={() => navigation.goBack()}
          />

          <View style={styles.searchBar}>
            <Search color={colors.softText} size={18} />
            <TextInput
              value={destination}
              onChangeText={setDestination}
              placeholder="City, town or national park"
              placeholderTextColor={colors.softText}
              returnKeyType="search"
              onSubmitEditing={() => submitSearch()}
              autoCorrect={false}
              style={styles.searchInput}
            />
            {destination ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setDestination("")} hitSlop={8} style={styles.searchClear}>
                <X color={colors.softText} size={14} strokeWidth={2.5} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search"
              onPress={() => submitSearch()}
              disabled={loading}
              style={({ pressed }) => [styles.searchGo, (!destination.trim() || loading) && styles.searchGoIdle, pressed && styles.pressed]}
            >
              {loading ? <ActivityIndicator color={colors.white} size="small" /> : <ArrowRight color={colors.white} size={18} strokeWidth={2.5} />}
            </Pressable>
          </View>

          {!searched && recentSearches.length > 0 ? (
            <AppStack gap={3}>
              <View style={styles.recentHeader}>
                <AppText variant="titleSm" weight="extraBold">
                  Recent searches
                </AppText>
                <Pressable accessibilityRole="button" onPress={clearRecentSearches} hitSlop={8}>
                  <AppText variant="caption" weight="extraBold" tone="primary">
                    Clear
                  </AppText>
                </Pressable>
              </View>
              <View style={styles.moreGroup}>
                {recentSearches.map((term, index) => (
                  <Pressable
                    key={term}
                    accessibilityRole="button"
                    onPress={() => {
                      setDestination(term);
                      void submitSearch(term);
                    }}
                    style={({ pressed }) => [styles.recentRowItem, index > 0 && styles.moreDivider, pressed && styles.moreRowPressed]}
                  >
                    <Clock color={colors.softText} size={16} />
                    <AppText variant="bodySmall" weight="semiBold" numberOfLines={1} style={styles.flex}>
                      {term}
                    </AppText>
                    <ChevronRight color={colors.softText} size={16} />
                  </Pressable>
                ))}
              </View>
            </AppStack>
          ) : null}

          {searched && query && !loading ? (
            <View style={styles.resultsHead}>
              <AppText variant="bodySmall" tone="muted" numberOfLines={1} style={styles.flex}>
                Results for <AppText variant="bodySmall" weight="extraBold">"{query}"</AppText>
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDestination("");
                  void submitSearch("");
                }}
                hitSlop={8}
              >
                <AppText variant="caption" weight="extraBold" tone="primary">
                  New search
                </AppText>
              </Pressable>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="bodySmall" tone="muted">
                Searching verified stays and tours
              </AppText>
            </View>
          ) : error ? (
            <StateView title="Search failed" message={error} actionLabel="Try again" onAction={submitSearch} />
          ) : searched && items.length === 0 && tourResults.length === 0 ? (
            <StateView
              title="No matching results"
              message="Try Tanzania, Dar es Salaam, Arusha, Zanzibar, hotel, lodge, park or tour."
            />
          ) : searched ? (
            <>
              {items.length > 0 ? (
                <AppStack gap={3}>
                  <View style={styles.recentHeader}>
                    <AppText variant="titleSm" weight="extraBold">
                      Stays
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      {items.length} {items.length === 1 ? "stay" : "stays"}
                    </AppText>
                  </View>
                  {items.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      systemCommission={systemCommission}
                      onPress={() => {
                        navigation.push("VerifiedStays", undefined);
                        navigation.push("PropertyDetail", { id: property.id, slug: property.slug, title: property.title });
                      }}
                    />
                  ))}
                </AppStack>
              ) : null}

              {tourResults.length > 0 ? (
                <AppStack gap={3}>
                  <View style={styles.recentHeader}>
                    <AppText variant="titleSm" weight="extraBold">
                      Tour packages
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      {tourResults.length} {tourResults.length === 1 ? "operator" : "operators"}
                    </AppText>
                  </View>
                  <FeaturedOperatorCarousel
                    operators={tourResults}
                    onPressOperator={(op) => {
                      navigation.push("TourPackages", undefined);
                      navigation.push("TourOperator", { agentId: op.agentId, operatorKey: op.operatorKey, operatorName: op.operatorName });
                    }}
                  />
                </AppStack>
              ) : null}
            </>
          ) : null}
        </AppStack>
      </SafeScreen>

      {status === "authenticated" ? null : <GuestBottomNav active="Search" />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  screen: {
    paddingBottom: spacing[4]
  },
  sectionHeading: {
    gap: 2,
    paddingHorizontal: 2
  },
  mission: {
    gap: spacing[3],
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    padding: spacing[5]
  },
  missionEyebrow: {
    color: colors.brand[200]
  },
  missionBody: {
    color: colors.brand[200]
  },
  missionPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[1]
  },
  missionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: spacing[3],
    paddingVertical: 5
  },
  missionDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.brand[200]
  },
  serviceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3]
  },
  // Same tile as My Stay's "My travel" grid.
  serviceTile: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 136,
    gap: 2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4],
    ...shadows.card
  },
  serviceTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing[3]
  },
  serviceIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md
  },
  moreGroup: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: "hidden",
    ...shadows.card
  },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingLeft: spacing[4]
  },
  moreRowPressed: {
    backgroundColor: colors.surface
  },
  moreIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  moreBody: {
    flex: 1,
    minWidth: 0,
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingRight: spacing[3]
  },
  moreDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  serviceTilePressed: {
    opacity: 0.86,
    transform: [{ scale: 0.985 }]
  },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minHeight: 56,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingLeft: spacing[4],
    paddingRight: 6,
    ...shadows.card
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 52,
    color: colors.ink,
    fontSize: 15
  },
  searchClear: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  },
  searchGo: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  searchGoIdle: {
    opacity: 0.55
  },
  recentRowItem: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4]
  },
  resultsHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: 2
  },
  loadingBox: {
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[8]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  }
});
