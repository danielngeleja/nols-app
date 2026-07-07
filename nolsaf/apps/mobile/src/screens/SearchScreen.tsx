import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ArrowRight, Building2, Car, Clock, Compass, TicketsPlane, UsersRound, Wallet } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { fetchSystemCommission } from "../bookings/checkoutApi";
import {
  AppButton,
  AppCard,
  AppInput,
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
import { colors, radius, spacing } from "../theme";
import { applyFeaturedTourFilters, FeaturedTourOperator, fetchAllFeaturedTourOperators } from "../tours";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

type IconType = typeof Building2;

const RECENT_SEARCHES_KEY = "nolsaf:recentDestinationSearches";
const MAX_RECENT_SEARCHES = 5;

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

          <AppCard tone="brand">
            <AppStack gap={2}>
              <AppText variant="titleSm" weight="extraBold" tone="inverse">
                Our mission
              </AppText>
              <AppText variant="bodySmall" tone="inverse">
                NoLSAF exists to bring trusted travel across Africa into one place: verified stays, curated tours,
                group trips, rides, and payments, all in a single click with no fragmentation.
              </AppText>
            </AppStack>
          </AppCard>

          <AppStack gap={3}>
            <AppText variant="titleSm" weight="bold">
              Our services
            </AppText>
            <View style={styles.serviceGrid}>
              <ServiceCard
                Icon={Building2}
                title="Verified Stays"
                text="Approved hotels, lodges and stays"
                onPress={() => navigation.navigate("VerifiedStays")}
              />
              <ServiceCard
                Icon={TicketsPlane}
                title="Tour Packages"
                text="Curated tours from trusted operators"
                onPress={() => navigation.navigate("TourPackages")}
              />
              <ServiceCard
                Icon={UsersRound}
                title="Group Stays"
                text="Plan and book trips together"
                onPress={() => navigation.navigate(isAuthed ? "GroupStayRequest" : "Login")}
              />
              <ServiceCard
                Icon={Car}
                title="Rides"
                text="Airport transfers and local rides"
                onPress={() => navigation.navigate(isAuthed ? "MyRides" : "Login")}
              />
            </View>
          </AppStack>

          <AppButton
            title="Payments"
            icon={<Wallet color={colors.primary} size={18} />}
            variant="secondary"
            onPress={() => navigation.navigate("Payments")}
          />

          <AppCard>
            <AppStack gap={2} style={styles.placesRow}>
              <View style={styles.placesIcon}>
                <Compass color={colors.primary} size={18} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold">
                  Browse destinations
                </AppText>
                <AppText variant="caption" tone="muted">
                  Regions, parks and countries across Africa.
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate("Search", { filter: "places" })}
                hitSlop={8}
              >
                <ArrowRight color={colors.primary} size={20} />
              </Pressable>
            </AppStack>
          </AppCard>
        </AppStack>
      </SafeScreen>

      {isAuthed ? null : <GuestBottomNav active="Search" />}
    </View>
  );
}

function ServiceCard({ Icon, title, text, onPress }: { Icon: IconType; title: string; text: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.serviceTile, pressed && styles.pressed]}>
      <View style={styles.serviceIcon}>
        <Icon color={colors.primary} size={18} />
      </View>
      <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
        {title}
      </AppText>
      <AppText variant="caption" tone="muted" numberOfLines={2}>
        {text}
      </AppText>
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
            subtitle="Type any place in Tanzania, a city, town, or national park like Serengeti or Ngorongoro, to browse verified stays and tour packages around it."
            onBack={() => navigation.goBack()}
          />

          <AppCard>
            <AppStack gap={4}>
              <AppInput
                label="Destination"
                value={destination}
                onChangeText={setDestination}
                placeholder="Dar es Salaam, Arusha, Zanzibar..."
                returnKeyType="search"
                onSubmitEditing={() => submitSearch()}
              />
              <AppButton title="Search" loading={loading} onPress={() => submitSearch()} />

              {recentSearches.length > 0 ? (
                <AppStack gap={2}>
                  <View style={styles.recentHeader}>
                    <AppText variant="caption" weight="bold" tone="muted">
                      Recent searches
                    </AppText>
                    <Pressable accessibilityRole="button" onPress={clearRecentSearches} hitSlop={8}>
                      <AppText variant="caption" weight="bold" tone="primary">
                        Clear
                      </AppText>
                    </Pressable>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
                    {recentSearches.map((term) => (
                      <Pressable
                        key={term}
                        accessibilityRole="button"
                        onPress={() => {
                          setDestination(term);
                          void submitSearch(term);
                        }}
                        style={({ pressed }) => [styles.recentChip, pressed && styles.pressed]}
                      >
                        <Clock color={colors.softText} size={14} />
                        <AppText variant="bodySmall" weight="semiBold">
                          {term}
                        </AppText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </AppStack>
              ) : null}
            </AppStack>
          </AppCard>

          {loading ? (
            <AppCard>
              <AppStack gap={3} style={{ alignItems: "center" }}>
                <ActivityIndicator color={colors.primary} />
                <AppText variant="bodySmall" tone="muted">
                  Searching NoLSAF approved stays...
                </AppText>
              </AppStack>
            </AppCard>
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
                  <AppText variant="titleSm" weight="bold">
                    Stays
                  </AppText>
                  {items.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      systemCommission={systemCommission}
                      onPress={() => {
                        navigation.push("VerifiedStays", undefined);
                        navigation.push("PropertyDetail", { id: property.id, title: property.title });
                      }}
                    />
                  ))}
                </AppStack>
              ) : null}

              {tourResults.length > 0 ? (
                <AppStack gap={3}>
                  <AppText variant="titleSm" weight="bold">
                    Tour packages
                  </AppText>
                  <FeaturedOperatorCarousel
                    operators={tourResults}
                    onPressOperator={(op) => {
                      navigation.push("TourPackages", undefined);
                      navigation.push("TourOperator", { agentId: op.agentId, operatorName: op.operatorName });
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
  serviceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  serviceTile: {
    width: "48.5%",
    minHeight: 118,
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  serviceIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50]
  },
  placesRow: {
    flexDirection: "row",
    alignItems: "center"
  },
  placesIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50]
  },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  recentRow: {
    gap: spacing[2],
    paddingRight: spacing[2]
  },
  recentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
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
