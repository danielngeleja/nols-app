import { X } from "lucide-react-native";
import { ReactNode, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

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
  onApply: (filters: PropertyFilters) => void;
  onClose: () => void;
};

/** Bottom sheet of advanced filters. Every section is a single horizontal scroll
 *  row of identical pill chips, so the sheet stays compact and consistent. */
export function PropertyFiltersSheet({ visible, value, priceMin, priceMax, priceCurrency, prices, typeCounts, onApply, onClose }: PropertyFiltersSheetProps) {
  const [draft, setDraft] = useState<PropertyFilters>(value);

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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <AppText variant="title" weight="bold">
              Filters
            </AppText>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.close}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <AppStack gap={6}>
              <Section label="Property type">
                {PROPERTY_TYPES.map((t) => (
                  <Chip
                    key={t.value}
                    label={t.label}
                    count={typeCounts[t.value] ?? 0}
                    active={draft.types.includes(t.value)}
                    onPress={() => toggleType(t.value)}
                  />
                ))}
              </Section>

              {priceMax > priceMin ? (
                <View style={styles.section}>
                  <AppText variant="label" weight="bold" tone="muted" style={styles.sectionLabel}>
                    {priceLabel.toUpperCase()}
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

              <Section label="Sort by">
                {SORT_OPTIONS.map((s) => (
                  <Chip key={s.value} label={s.label} active={draft.sort === s.value} onPress={() => setDraft((c) => ({ ...c, sort: s.value }))} />
                ))}
              </Section>
            </AppStack>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.flex}>
              <AppButton title="Reset" variant="ghost" onPress={() => setDraft(DEFAULT_PROPERTY_FILTERS)} />
            </View>
            <View style={styles.flex}>
              <AppButton title="Apply" onPress={() => onApply(draft)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="label" weight="bold" tone="muted" style={styles.sectionLabel}>
        {label.toUpperCase()}
      </AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  count
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && !active && styles.chipPressed]}
    >
      <View style={styles.chipInner}>
        <AppText variant="bodySmall" weight="semiBold" tone={active ? "inverse" : "default"}>
          {label}
        </AppText>
        {count != null ? (
          <AppText
            variant="caption"
            weight="bold"
            tone={active ? "inverse" : "muted"}
            style={count === 0 ? styles.countZero : styles.count}
          >
            {count}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.42)"
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
  sectionLabel: {
    letterSpacing: 1
  },
  chipRow: {
    gap: spacing[2],
    paddingRight: spacing[2]
  },
  chip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    minHeight: 40,
    justifyContent: "center"
  },
  chipInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  count: {
    opacity: 0.85
  },
  countZero: {
    opacity: 0.4
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
