import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SheetModal, useSheetBottomInset } from "./SheetModal";

import { colors, radius, shadows, spacing } from "../theme";
import { AppButton } from "./AppButton";
import { AppStack } from "./AppStack";
import { AppText } from "./AppText";
import { PriceRangeSlider } from "./PriceRangeSlider";

export type PropertySort = "newest" | "price_asc" | "price_desc";

export type PropertyFilters = {
  types: string[];
  minPrice: string;
  maxPrice: string;
  sort: PropertySort;
};

export const DEFAULT_PROPERTY_FILTERS: PropertyFilters = {
  types: [],
  minPrice: "",
  maxPrice: "",
  sort: "newest"
};

export const PROPERTY_TYPES: Array<{ value: string; label: string }> = [
  { value: "HOTEL", label: "Hotel" },
  { value: "LODGE", label: "Lodge" },
  { value: "APARTMENT", label: "Apartment" },
  { value: "VILLA", label: "Villa" },
  { value: "GUEST_HOUSE", label: "Guest house" },
  { value: "BUNGALOW", label: "Bungalow" },
  { value: "HOMESTAY", label: "Homestay" },
  { value: "CABIN", label: "Cabin" },
  { value: "CONDO", label: "Condo" },
  { value: "HOUSE", label: "House" }
];

export const SORT_OPTIONS: Array<{ value: PropertySort; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price low to high" },
  { value: "price_desc", label: "Price high to low" }
];

/** Count of advanced filters that are set, for the Filters button badge. */
export function countAdvancedFilters(f: PropertyFilters): number {
  return f.types.length + (f.minPrice || f.maxPrice ? 1 : 0) + (f.sort !== "newest" ? 1 : 0);
}

type PropertyFiltersSheetProps = {
  visible: boolean;
  value: PropertyFilters;
  priceMin: number;
  priceMax: number;
  priceCurrency?: string;
  /** Property prices in the current set, for the live "stays in this range" count. */
  prices: number[];
  /** How many stays exist per type, so each type chip shows what is available. */
  typeCounts: Record<string, number>;
  /** The loaded stays (type and nightly price), for the live "Show N stays" count. */
  stays?: Array<{ type?: string | null; basePrice?: number | null }>;
  onApply: (filters: PropertyFilters) => void;
  onClose: () => void;
};

/**
 * Bottom sheet of advanced filters. Only stay types that have stays are
 * offered (busiest first), sort is one compact segmented control, and the
 * button says how many stays the choice will show before it is applied.
 */
export function PropertyFiltersSheet({ visible, value, priceMin, priceMax, priceCurrency, prices, typeCounts, stays, onApply, onClose }: PropertyFiltersSheetProps) {
  // Clears the phone navigation bar, which edge-to-edge Android draws over.
  const bottomInset = useSheetBottomInset(spacing[4]);
  const [draft, setDraft] = useState<PropertyFilters>(value);
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  function toggleType(type: string) {
    setDraft((current) => ({
      ...current,
      types: current.types.includes(type)
        ? current.types.filter((t) => t !== type)
        : [...current.types, type]
    }));
  }

  const priceLabel = priceCurrency ? `Price per night (${priceCurrency})` : "Price per night";

  // Types with stays, busiest first; a type already selected stays visible so it can be cleared.
  const hasCounts = Object.values(typeCounts).some((n) => n > 0);
  const offeredTypes = hasCounts
    ? PROPERTY_TYPES.filter((t) => (typeCounts[t.value] ?? 0) > 0 || draft.types.includes(t.value)).sort(
        (a, b) => (typeCounts[b.value] ?? 0) - (typeCounts[a.value] ?? 0)
      )
    : PROPERTY_TYPES;

  // Live result count over the loaded stays.
  const matchCount = stays
    ? stays.filter((s) => {
        if (draft.types.length && !draft.types.includes(String(s.type || "").toUpperCase())) return false;
        const p = typeof s.basePrice === "number" ? s.basePrice : null;
        if (draft.minPrice && (p == null || p < Number(draft.minPrice))) return false;
        if (draft.maxPrice && (p == null || p > Number(draft.maxPrice))) return false;
        return true;
      }).length
    : null;
  const applyTitle = matchCount == null ? "Apply" : matchCount === 0 ? "No stays match" : `Show ${matchCount} ${matchCount === 1 ? "stay" : "stays"}`;
  const dirty = countAdvancedFilters(draft) > 0;

  return (
    <SheetModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="Close filters" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <AppText variant="title" weight="bold">
              Filters
            </AppText>
            <View style={styles.headerActions}>
              {dirty ? (
                <Pressable accessibilityRole="button" onPress={() => setDraft(DEFAULT_PROPERTY_FILTERS)} hitSlop={8}>
                  <AppText variant="bodySmall" weight="semiBold" tone="primary">
                    Clear all
                  </AppText>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={styles.close}>
                <X color={colors.ink} size={18} />
              </Pressable>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <AppStack gap={5}>
              <View style={styles.section}>
                <AppText variant="bodySmall" weight="bold">
                  Type of stay
                </AppText>
                {/* An even three-column grid: equal tiles, no ragged edge. */}
                <View style={styles.chipWrap} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
                  {offeredTypes.map((t) => (
                    <Chip
                      key={t.value}
                      width={gridWidth ? Math.floor((gridWidth - GRID_GAP * 2) / 3) : undefined}
                      label={t.label}
                      count={hasCounts ? typeCounts[t.value] ?? 0 : undefined}
                      active={draft.types.includes(t.value)}
                      onPress={() => toggleType(t.value)}
                    />
                  ))}
                </View>
              </View>

              {priceMax > priceMin ? (
                <View style={styles.section}>
                  <AppText variant="bodySmall" weight="bold">
                    {priceLabel}
                  </AppText>
                  <PriceRangeSlider
                    min={priceMin}
                    max={priceMax}
                    valueMin={draft.minPrice ? Number(draft.minPrice) : priceMin}
                    valueMax={draft.maxPrice ? Number(draft.maxPrice) : priceMax}
                    currency={priceCurrency}
                    onChange={(lo, hi) =>
                      setDraft((c) => ({
                        ...c,
                        minPrice: lo <= priceMin ? "" : String(lo),
                        maxPrice: hi >= priceMax ? "" : String(hi)
                      }))
                    }
                  />
                  {(() => {
                    const lo = draft.minPrice ? Number(draft.minPrice) : priceMin;
                    const hi = draft.maxPrice ? Number(draft.maxPrice) : priceMax;
                    const inRange = prices.filter((p) => p >= lo && p <= hi).length;
                    return (
                      <AppText variant="caption" tone="muted">
                        {inRange} {inRange === 1 ? "stay" : "stays"} in this range
                      </AppText>
                    );
                  })()}
                </View>
              ) : null}

              <View style={styles.section}>
                <AppText variant="bodySmall" weight="bold">
                  Sort by
                </AppText>
                <View style={styles.segment}>
                  {SORT_OPTIONS.map((s) => {
                    const active = draft.sort === s.value;
                    return (
                      <Pressable
                        key={s.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setDraft((c) => ({ ...c, sort: s.value }))}
                        style={[styles.segmentItem, active && styles.segmentItemActive]}
                      >
                        <AppText variant="caption" weight={active ? "bold" : "semiBold"} tone={active ? "primary" : "muted"} numberOfLines={1}>
                          {SORT_SHORT[s.value]}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </AppStack>
          </ScrollView>

          <View style={styles.footer}>
            <AppButton title={applyTitle} disabled={matchCount === 0} onPress={() => onApply(draft)} />
          </View>
        </View>
      </View>
    </SheetModal>
  );
}

const SORT_SHORT: Record<PropertySort, string> = {
  newest: "Newest",
  price_asc: "Lowest price",
  price_desc: "Highest price"
};

const GRID_GAP = spacing[2];

/** One stay type as an equal grid tile: the name, and its count underneath. */
function Chip({
  label,
  active,
  onPress,
  count,
  width
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
  width?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, width ? { width } : styles.chipFallback, active && styles.chipActive, pressed && !active && styles.chipPressed]}
    >
      <AppText variant="bodySmall" weight="semiBold" tone={active ? "inverse" : "default"} numberOfLines={1} style={styles.chipLabel}>
        {label}
      </AppText>
      {count != null ? (
        <AppText variant="caption" tone={active ? "inverse" : "soft"} numberOfLines={1} style={styles.chipLabel}>
          {count} {count === 1 ? "stay" : "stays"}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.42)"
  },
  backdrop: {
    ...StyleSheet.absoluteFill
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginBottom: spacing[3]
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4]
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP
  },
  segment: {
    flexDirection: "row",
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing[2],
    borderRadius: radius.sm
  },
  segmentItemActive: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  sheet: {
    maxHeight: "85%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.white,
    paddingTop: spacing[5],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
    ...shadows.sheet
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[4]
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  },
  body: {
    paddingBottom: spacing[4]
  },
  section: {
    gap: spacing[3]
  },
  chip: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    alignItems: "center",
    justifyContent: "center",
    gap: 1
  },
  chipFallback: {
    width: "31%"
  },
  chipLabel: {
    textAlign: "center"
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  chipPressed: {
    backgroundColor: colors.brand[50],
    borderColor: colors.brand[100]
  },
  footer: {
    flexDirection: "row",
    gap: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  flex: {
    flex: 1,
    minWidth: 0
  }
});
