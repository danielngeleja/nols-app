import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ArrowLeft, SearchX, ShieldCheck, SlidersHorizontal, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../auth";
import { fetchSystemCommission } from "../bookings/checkoutApi";
import {
  AnimatedCounter,
  AppCard,
  AppInput,
  AppStack,
  AppText,
  countAdvancedFilters,
  DEFAULT_PROPERTY_FILTERS,
  GuestBottomNav,
  PROPERTY_TYPES,
  PropertyFilters,
  PropertyFiltersSheet,
  PropertyRail,
  SORT_OPTIONS,
  StateView
} from "../components";
import { TANZANIA_REGIONS as REGIONS } from "../data/destinations";
import { RootStackParamList } from "../navigation/types";
import { fetchPropertiesAvailability, fetchPublicProperties, PublicPropertyCard, useSavedProperties } from "../properties";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "VerifiedStays">;

const FEATURED_COUNT = 8;
const COLUMNS_PER_ROW = 5;

function chunk<T>(list: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    rows.push(list.slice(i, i + size));
  }
  return rows;
}

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDayOptions(count: number): Array<{ value: string; label: string }> {
  const today = new Date();
  return Array.from({ length: count }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
    return { value: toYmd(d), label };
  });
}

const DAY_OPTIONS = buildDayOptions(7);

function abbreviateAmount(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(n % 1000 ? 1 : 0))}k`;
  return String(Math.round(n));
}

export function VerifiedStaysScreen({ navigation, route }: Props) {
  const { status, token } = useAuth();
  const { savedIds, toggleSave } = useSavedProperties(token);
  const [items, setItems] = useState<PublicPropertyCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [region, setRegion] = useState(route.params?.region ?? "");
  const [availabilityDate, setAvailabilityDate] = useState("");
  const [availabilityMap, setAvailabilityMap] = useState<Record<number, number | null>>({});
  const [filters, setFilters] = useState<PropertyFilters>(
    route.params?.propertyType ? { ...DEFAULT_PROPERTY_FILTERS, types: [route.params.propertyType] } : DEFAULT_PROPERTY_FILTERS
  );
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);
  const [pricePoints, setPricePoints] = useState<number[]>([]);
  const [priceCurrency, setPriceCurrency] = useState("");
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [systemCommission, setSystemCommission] = useState(0);

  useEffect(() => {
    fetchSystemCommission().then(setSystemCommission).catch(() => setSystemCommission(0));
  }, []);

  const runSearch = useCallback(
    async (override?: { q?: string; region?: string }) => {
      const q = (override?.q ?? query).trim();
      const reg = override?.region ?? region;
      setLoading(true);
      setError(null);
      try {
        const response = await fetchPublicProperties({
          q: q || undefined,
          region: reg || undefined,
          types: filters.types.length ? filters.types.join(",") : undefined,
          minPrice: filters.minPrice ? Number(filters.minPrice) : undefined,
          maxPrice: filters.maxPrice ? Number(filters.maxPrice) : undefined,
          page: 1,
          pageSize: 50,
          sort: filters.sort
        });
        setItems(response.items || []);
        setTotal(response.total || 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load verified stays.");
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [query, region, filters]
  );

  // Auto search whenever filters change. Typing is debounced; the initial mount
  // and region taps run immediately.
  useEffect(() => {
    const delay = query.trim() ? 350 : 0;
    const handle = setTimeout(() => {
      void runSearch();
    }, delay);
    return () => clearTimeout(handle);
  }, [runSearch, query]);

  // When a day is chosen, fetch rooms left for the loaded properties and merge
  // it onto the cards. Cleared date removes the availability signal.
  useEffect(() => {
    if (!availabilityDate || items.length === 0) {
      setAvailabilityMap({});
      return;
    }
    let cancelled = false;
    fetchPropertiesAvailability(items.map((i) => i.id), availabilityDate)
      .then((res) => {
        if (cancelled) return;
        const map: Record<number, number | null> = {};
        res.items.forEach((it) => {
          map[it.id] = it.roomsAvailable;
        });
        setAvailabilityMap(map);
      })
      .catch(() => {
        if (!cancelled) setAvailabilityMap({});
      });
    return () => {
      cancelled = true;
    };
  }, [items, availabilityDate]);

  // Derive the price slider bounds and currency from the real data. Recompute
  // only while no price filter is active so the bounds stay stable while dragging.
  useEffect(() => {
    if (filters.minPrice || filters.maxPrice) return;
    const prices = items.map((i) => i.basePrice).filter((p): p is number => typeof p === "number" && p > 0);
    if (prices.length === 0) return;
    setPriceCurrency(items.find((i) => i.currency)?.currency || "TZS");
    setPriceMin(Math.min(...prices));
    setPriceMax(Math.max(...prices));
    setPricePoints(prices);
  }, [items, filters.minPrice, filters.maxPrice]);

  // Count stays per property type, so each type chip shows what is available.
  // Held stable while a type filter is active (it narrows the set).
  useEffect(() => {
    if (filters.types.length) return;
    const counts: Record<string, number> = {};
    items.forEach((i) => {
      const t = String(i.type || "").toUpperCase();
      if (t) counts[t] = (counts[t] || 0) + 1;
    });
    setTypeCounts(counts);
  }, [items, filters.types.length]);

  function openProperty(property: PublicPropertyCard) {
    navigation.navigate("PropertyDetail", { id: property.id, title: property.title });
  }

  function selectRegion(next: string) {
    setRegion(next);
  }

  function clearAll() {
    setQuery("");
    setRegion("");
    setAvailabilityDate("");
    setFilters(DEFAULT_PROPERTY_FILTERS);
  }

  const advancedCount = countAdvancedFilters(filters);
  const sortLabel = SORT_OPTIONS.find((s) => s.value === filters.sort)?.label ?? "Newest";
  const hasFilters = Boolean(query.trim() || region || advancedCount > 0);

  const activeChips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (region) activeChips.push({ key: "region", label: region, onRemove: () => setRegion("") });
  if (availabilityDate) {
    const dayLabel = DAY_OPTIONS.find((d) => d.value === availabilityDate)?.label ?? availabilityDate;
    activeChips.push({ key: "date", label: dayLabel, onRemove: () => setAvailabilityDate("") });
  }
  filters.types.forEach((t) => {
    const label = PROPERTY_TYPES.find((pt) => pt.value === t)?.label ?? t;
    activeChips.push({
      key: `type-${t}`,
      label,
      onRemove: () => setFilters((c) => ({ ...c, types: c.types.filter((x) => x !== t) }))
    });
  });
  if (filters.minPrice || filters.maxPrice) {
    const lo = filters.minPrice ? Number(filters.minPrice) : priceMin;
    const hi = filters.maxPrice ? Number(filters.maxPrice) : priceMax;
    const priceLabel = `${abbreviateAmount(lo)} to ${abbreviateAmount(hi)}${filters.maxPrice ? "" : "+"}${priceCurrency ? ` ${priceCurrency}` : ""}`;
    activeChips.push({
      key: "price",
      label: priceLabel,
      onRemove: () => setFilters((c) => ({ ...c, minPrice: "", maxPrice: "" }))
    });
  }
  if (filters.sort !== "newest") {
    activeChips.push({ key: "sort", label: sortLabel, onRemove: () => setFilters((c) => ({ ...c, sort: "newest" })) });
  }

  // Merge rooms left onto the cards when a day is selected.
  const decoratedItems = availabilityDate
    ? items.map((p) => (p.id in availabilityMap ? { ...p, roomsAvailable: availabilityMap[p.id] } : p))
    : items;

  // Motion lives only in a small featured strip, and only on the calm All view.
  const featured = !hasFilters && decoratedItems.length > 4 ? decoratedItems.slice(0, FEATURED_COUNT) : [];

  // The full inventory is laid out as compact rows of up to five tiles. Each row
  // slides by hand only (no auto rotation) to keep things calm and save space.
  const rows = chunk(decoratedItems, COLUMNS_PER_ROW);

  const header = (
    <AppStack gap={5}>
      <AppCard tone="success" style={styles.heroCard}>
        <AppStack gap={4}>
          <View style={styles.topRow}>
            <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
              <ArrowLeft color={colors.ink} size={22} />
            </Pressable>
            <View style={styles.titleText}>
              <AppText variant="title" weight="bold" numberOfLines={1}>
                Verified stays
              </AppText>
              <AppText variant="bodySmall" tone="muted" numberOfLines={2}>
                Approved NoLSAF stays, ready to book.
              </AppText>
            </View>
            <View style={styles.iconWrap}>
              <ShieldCheck color={colors.primary} size={22} />
            </View>
          </View>

          <AnimatedCounter value={total} variant="display" weight="extraBold" tone="primary" />
        </AppStack>
      </AppCard>

      <AppCard style={styles.filtersCard}>
        <AppStack gap={3}>
          <AppInput
            label="Search stays"
            placeholder="Region, district, ward or property name"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            keyboardShouldPersistTaps="handled"
          >
            <FilterChip label="All" active={region === ""} onPress={() => selectRegion("")} />
            {REGIONS.map((r) => (
              <FilterChip key={r} label={r} active={region === r} onPress={() => selectRegion(r)} />
            ))}
          </ScrollView>

          <AppText variant="label" weight="semiBold" tone="muted">
            Available on
          </AppText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            keyboardShouldPersistTaps="handled"
          >
            <FilterChip label="Any day" active={availabilityDate === ""} onPress={() => setAvailabilityDate("")} />
            {DAY_OPTIONS.map((day) => (
              <FilterChip
                key={day.value}
                label={day.label}
                active={availabilityDate === day.value}
                onPress={() => setAvailabilityDate(day.value)}
              />
            ))}
          </ScrollView>

          <View style={styles.controlRow}>
            <Pressable accessibilityRole="button" onPress={() => setFiltersVisible(true)} style={styles.filtersButton}>
              <SlidersHorizontal color={colors.primary} size={16} />
              <AppText variant="bodySmall" weight="semiBold" tone="primary">
                Filters
              </AppText>
              {advancedCount > 0 ? (
                <View style={styles.badge}>
                  <AppText variant="caption" weight="bold" tone="inverse">
                    {advancedCount}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setFiltersVisible(true)} hitSlop={8}>
              <AppText variant="bodySmall" tone="muted">
                Sort: {sortLabel}
              </AppText>
            </Pressable>
          </View>
        </AppStack>
      </AppCard>

      {activeChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {activeChips.map((chip) => (
            <Pressable key={chip.key} accessibilityRole="button" onPress={chip.onRemove} style={styles.activeChip}>
              <AppText variant="caption" weight="semiBold" tone="primary">
                {chip.label}
              </AppText>
              <X color={colors.primary} size={13} />
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={clearAll} hitSlop={6} style={styles.clearAllBtn}>
            <AppText variant="caption" weight="bold" tone="muted">
              Clear all
            </AppText>
          </Pressable>
        </ScrollView>
      ) : null}

      {featured.length > 0 ? (
        <AppStack gap={3}>
          <AppText variant="titleSm" weight="bold">
            Featured
          </AppText>
          <PropertyRail
            items={featured}
            onCardPress={openProperty}
            systemCommission={systemCommission}
            savedIds={savedIds}
            onToggleSave={status === "authenticated" ? (property) => toggleSave(property.id) : undefined}
          />
        </AppStack>
      ) : null}

      {!hasFilters && items.length > 0 ? (
        <AppText variant="titleSm" weight="bold">
          All approved stays
        </AppText>
      ) : null}
    </AppStack>
  );

  const empty =
    loading ? (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
        <AppText variant="bodySmall" tone="muted">
          Loading verified stays...
        </AppText>
      </View>
    ) : error ? (
      <StateView title="Could not load stays" message={error} actionLabel="Try again" onAction={() => runSearch()} />
    ) : (
      <View style={styles.empty}>
        <SearchX color={colors.softText} size={26} />
        <AppText variant="titleSm" weight="bold" style={styles.emptyCenter}>
          No stays found
        </AppText>
        <AppText variant="bodySmall" tone="muted" style={styles.emptyCenter}>
          {hasFilters ? "Try another region, or clear the filters." : "Please check back soon."}
        </AppText>
        {hasFilters ? (
          <Pressable accessibilityRole="button" onPress={clearAll} hitSlop={8}>
            <AppText variant="bodySmall" weight="semiBold" tone="primary">
              Clear filters
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <FlatList
          data={rows}
          keyExtractor={(row, index) => `row-${row[0]?.id ?? index}`}
          contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          ListHeaderComponentStyle={styles.headerSpacing}
          renderItem={({ item }) => (
            <PropertyRail
              items={item}
              autoRotate={false}
              onCardPress={openProperty}
              systemCommission={systemCommission}
              savedIds={savedIds}
              onToggleSave={status === "authenticated" ? (property) => toggleSave(property.id) : undefined}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
          ListEmptyComponent={empty}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
        />
      </SafeAreaView>

      {status === "authenticated" ? null : <GuestBottomNav active="Search" />}

      <PropertyFiltersSheet
        visible={filtersVisible}
        value={filters}
        priceMin={priceMin}
        priceMax={priceMax}
        priceCurrency={priceCurrency}
        prices={pricePoints}
        typeCounts={typeCounts}
        onApply={(next) => {
          setFilters(next);
          setFiltersVisible(false);
        }}
        onClose={() => setFiltersVisible(false)}
      />
    </View>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && !active && styles.chipPressed]}
    >
      <AppText variant="bodySmall" weight="semiBold" tone={active ? "inverse" : "muted"}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  safe: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[8]
  },
  headerSpacing: {
    marginBottom: spacing[4]
  },
  rowSeparator: {
    height: spacing[5]
  },
  heroCard: {
    borderRadius: radius.sm
  },
  filtersCard: {
    borderRadius: radius.sm
  },
  topRow: {
    minWidth: 0,
    flexDirection: "row",
    gap: spacing[3],
    alignItems: "center"
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  titleText: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1]
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  chipRow: {
    gap: spacing[2],
    paddingRight: spacing[2]
  },
  chip: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  chipPressed: {
    backgroundColor: colors.brand[50],
    borderColor: colors.brand[100]
  },
  controlRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  filtersButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: radius.full,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  activeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  clearAllBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[2]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    padding: spacing[6]
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    paddingVertical: spacing[10]
  },
  emptyCenter: {
    textAlign: "center"
  }
});
