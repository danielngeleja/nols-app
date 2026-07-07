import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ArrowLeft, BadgeCheck, Compass, Scale, Search, ShieldCheck, SlidersHorizontal, TicketsPlane, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View
} from "react-native";
import { AnimatedCounter, AppText, countTourFilters, FeaturedOperatorCarousel, SafeScreen, StateView, TourFiltersSheet } from "../components";
import { RootStackParamList } from "../navigation/types";
import {
  applyFeaturedTourFilters,
  FeaturedTourOperator,
  fetchAllFeaturedTourOperators,
  fetchTourCategories,
  fetchTourismSites,
  TourismSite,
  TourSortKey
} from "../tours";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "TourPackages">;

export function TourPackagesScreen({ navigation }: Props) {
  const [operators, setOperators] = useState<FeaturedTourOperator[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [sites, setSites] = useState<TourismSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [site, setSite] = useState("All");
  const [sort, setSort] = useState<TourSortKey>("recommended");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [ops, cats, ts] = await Promise.all([fetchAllFeaturedTourOperators(), fetchTourCategories(), fetchTourismSites()]);
      setOperators(ops);
      setCategories(cats);
      setSites(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tour operators.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => applyFeaturedTourFilters(operators, { search, category, site, sort }),
    [operators, search, category, site, sort]
  );

  const hasLookup = Boolean(search.trim()) || category !== "All" || site !== "All";
  const advancedCount = countTourFilters({ category, site, sort });

  const clearAll = () => {
    setSearch("");
    setCategory("All");
    setSite("All");
    setSort("recommended");
  };

  // Collapse the hero as the (tall) operator card is scrolled, expand on scroll up.
  const scrollY = useRef(new Animated.Value(0)).current;
  const heroMaxHeight = scrollY.interpolate({ inputRange: [0, 150], outputRange: [320, 0], extrapolate: "clamp" });
  const heroOpacity = scrollY.interpolate({ inputRange: [0, 95], outputRange: [1, 0], extrapolate: "clamp" });
  const heroTranslateY = scrollY.interpolate({ inputRange: [0, 150], outputRange: [0, -16], extrapolate: "clamp" });

  return (
    <View style={styles.root}>
      <SafeScreen scroll={false} padded={false} contentStyle={styles.flex}>
        <Animated.View
          style={[styles.headerWrap, { maxHeight: heroMaxHeight, opacity: heroOpacity, transform: [{ translateY: heroTranslateY }] }]}
        >
          <TourHero onBack={() => navigation.goBack()} count={operators.length} />
        </Animated.View>

        {/* Search + filters control */}
        <View style={styles.controls}>
          <View style={styles.searchBox}>
            <Search color={colors.softText} size={18} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search package or operator"
              placeholderTextColor={colors.softText}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {search ? (
              <Pressable accessibilityRole="button" onPress={() => setSearch("")} hitSlop={8}>
                <X color={colors.softText} size={16} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFiltersOpen(true)}
            style={[styles.filterButton, advancedCount > 0 && styles.filterButtonOn]}
          >
            <SlidersHorizontal color={advancedCount > 0 ? colors.white : colors.primary} size={18} />
            {advancedCount > 0 ? (
              <View style={styles.filterBadge}>
                <AppText variant="caption" weight="bold" tone="inverse">
                  {advancedCount}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Category chips */}
        {!loading && !error ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            style={styles.chipsScroll}
          >
            {["All", ...categories].map((c) => {
              const on = category === c;
              return (
                <Pressable
                  key={c}
                  accessibilityRole="button"
                  onPress={() => setCategory(c)}
                  style={({ pressed }) => [styles.catChip, on && styles.catChipOn, pressed && !on && styles.catChipPressed]}
                >
                  <AppText variant="bodySmall" weight={on ? "bold" : "semiBold"} tone={on ? "inverse" : "muted"}>
                    {c}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Active filter summary */}
        {hasLookup || sort !== "recommended" ? (
          <View style={styles.activeRow}>
            <AppText variant="caption" tone="muted" style={styles.flex} numberOfLines={1}>
              {filtered.length} {filtered.length === 1 ? "operator" : "operators"}
            </AppText>
            <Pressable accessibilityRole="button" onPress={clearAll} hitSlop={8}>
              <AppText variant="caption" weight="bold" tone="primary">
                Clear all
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="bodySmall" tone="muted">
              Loading tour operators...
            </AppText>
          </View>
        ) : error ? (
          <View style={styles.stateWrap}>
            <StateView title="Could not load operators" message={error} actionLabel="Try again" onAction={() => load()} />
          </View>
        ) : (
          <Animated.ScrollView
            style={styles.list}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} colors={[colors.primary]} />
            }
          >
            {filtered.length === 0 ? (
              <View style={styles.stateWrap}>
                {operators.length === 0 ? (
                  <StateView
                    title="Tour packages onboarding"
                    message="We are onboarding verified tour operators and packages. Check back soon, or explore stays in the meantime."
                    actionLabel="Browse stays"
                    onAction={() => navigation.navigate("VerifiedStays")}
                  />
                ) : (
                  <StateView
                    title="No approved package found yet"
                    message="We could not find an approved package matching your search or filters. Try another destination, park, site, or category."
                    actionLabel="Clear all"
                    onAction={clearAll}
                  />
                )}
              </View>
            ) : (
              <View style={styles.carouselWrap}>
                <FeaturedOperatorCarousel
                  operators={filtered}
                  onPressOperator={(op) => navigation.navigate("TourOperator", { agentId: op.agentId, operatorName: op.operatorName })}
                />
              </View>
            )}
          </Animated.ScrollView>
        )}
      </SafeScreen>

      {/* Advanced filters sheet, classified and slide up, matching Verified Stays */}
      <TourFiltersSheet
        visible={filtersOpen}
        value={{ category, site, sort }}
        categories={categories}
        sites={sites}
        getCount={(draft) => applyFeaturedTourFilters(operators, { search, ...draft }).length}
        onApply={(next) => {
          setCategory(next.category);
          setSite(next.site);
          setSort(next.sort);
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

function TourHero({ onBack, count }: { onBack: () => void; count: number }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.heroBack} hitSlop={6}>
          <ArrowLeft color={colors.ink} size={20} />
        </Pressable>
        <View style={styles.heroBadge}>
          <ShieldCheck color={colors.primary} size={12} />
          {count > 0 ? (
            <View style={styles.heroBadgeCount}>
              <AnimatedCounter value={count} variant="caption" weight="bold" tone="primary" />
              <AppText variant="caption" weight="bold" tone="primary">
                {` verified ${count === 1 ? "operator" : "operators"}`}
              </AppText>
            </View>
          ) : (
            <AppText variant="caption" weight="bold" tone="primary">
              Verified operators
            </AppText>
          )}
        </View>
      </View>

      <View style={styles.heroRow}>
        <View style={styles.heroIcon}>
          <TicketsPlane color={colors.white} size={24} />
        </View>
        <View style={styles.flex}>
          <AppText variant="title" weight="extraBold">
            Tour Packages
          </AppText>
        </View>
      </View>

      <AppText variant="bodySmall" tone="muted" style={styles.heroSubtitle}>
        Browse approved operators and compare safari, beach, cultural, and city packages in one place.
      </AppText>

      <View style={styles.heroChips}>
        <HeroChip Icon={Compass} label="Discover" />
        <HeroChip Icon={Scale} label="Compare" />
        <HeroChip Icon={BadgeCheck} label="Verified" />
      </View>
    </View>
  );
}

function HeroChip({ Icon, label }: { Icon: typeof Compass; label: string }) {
  return (
    <View style={styles.heroChip}>
      <Icon color={colors.primary} size={13} />
      <AppText variant="caption" weight="bold" tone="primary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  headerWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[4], overflow: "hidden" },
  hero: {
    borderRadius: radius.xl,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    padding: spacing[4],
    ...shadows.card
  },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing[3] },
  heroBack: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: 5
  },
  heroBadgeCount: { flexDirection: "row", alignItems: "center" },
  heroRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    ...shadows.card
  },
  heroSubtitle: { marginTop: spacing[2] },
  heroChips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing[2], marginTop: spacing[3] },
  heroChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: 5
  },
  controls: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  searchBox: {
    flex: 1,
    minWidth: 0,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    ...shadows.card
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, padding: 0 },
  filterButton: {
    width: 50,
    height: 50,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    ...shadows.card
  },
  filterButtonOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.warning,
    paddingHorizontal: 4
  },
  chipsScroll: { flexGrow: 0, flexShrink: 0, marginTop: spacing[4] },
  chipsRow: { paddingHorizontal: spacing[4], paddingVertical: spacing[1], gap: spacing[2] },
  catChip: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2]
  },
  catChipOn: { backgroundColor: colors.primary, borderColor: colors.primary, ...shadows.card },
  catChipPressed: { backgroundColor: colors.brand[50], borderColor: colors.brand[100] },
  activeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3]
  },
  list: { flex: 1 },
  scrollContent: { paddingTop: spacing[4], paddingBottom: spacing[10], flexGrow: 1 },
  carouselWrap: { paddingTop: spacing[1] },
  center: { alignItems: "center", justifyContent: "center", gap: spacing[3], padding: spacing[6] },
  stateWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[5] }
});
