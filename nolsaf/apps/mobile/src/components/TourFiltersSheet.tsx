import { ArrowUpDown, Check, MapPin, Search, Tag, X } from "lucide-react-native";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { TourismSite, TourSortKey } from "../tours";
import { AppButton } from "./AppButton";
import { AppText } from "./AppText";

export type TourFilterValue = {
  category: string;
  site: string;
  sort: TourSortKey;
};

export const DEFAULT_TOUR_FILTERS: TourFilterValue = {
  category: "All",
  site: "All",
  sort: "recommended"
};

export const TOUR_SORT_OPTIONS: Array<{ value: TourSortKey; label: string }> = [
  { value: "recommended", label: "Recommended" },
  { value: "rating", label: "Top rated" },
  { value: "price-asc", label: "Price low to high" },
  { value: "price-desc", label: "Price high to low" }
];

/** Count of advanced filters that are set, for the Filters button badge. */
export function countTourFilters(f: TourFilterValue): number {
  return (f.category !== "All" ? 1 : 0) + (f.site !== "All" ? 1 : 0) + (f.sort !== "recommended" ? 1 : 0);
}

/** Group sites by country so each country reads as its own labelled group. Tanzania
 *  leads, then the rest alphabetically. */
function groupSitesByCountry(sites: TourismSite[]): Array<{ country: string; sites: TourismSite[] }> {
  const map = new Map<string, TourismSite[]>();
  for (const s of sites) {
    const country = (s.country || "Other").trim() || "Other";
    if (!map.has(country)) map.set(country, []);
    map.get(country)!.push(s);
  }
  const rank = (c: string) => (c.toLowerCase() === "tanzania" ? 0 : 1);
  return Array.from(map.entries())
    .map(([country, list]) => ({ country, sites: list }))
    .sort((a, b) => rank(a.country) - rank(b.country) || a.country.localeCompare(b.country));
}

type TourFiltersSheetProps = {
  visible: boolean;
  value: TourFilterValue;
  categories: string[];
  sites: TourismSite[];
  /** Live result count for the draft, shown on the Apply button. */
  getCount?: (value: TourFilterValue) => number;
  onApply: (value: TourFilterValue) => void;
  onClose: () => void;
};

/** Bottom sheet of tour filters: Category, Parks and sites (searchable), and Sort.
 *  Chips wrap so nothing is clipped, and a search narrows the long places list. */
export function TourFiltersSheet({ visible, value, categories, sites, getCount, onApply, onClose }: TourFiltersSheetProps) {
  const [draft, setDraft] = useState<TourFilterValue>(value);
  const [siteQuery, setSiteQuery] = useState("");

  useEffect(() => {
    if (visible) {
      setDraft(value);
      setSiteQuery("");
    }
  }, [visible, value]);

  const count = getCount ? getCount(draft) : null;

  const siteGroups = useMemo(() => {
    const q = siteQuery.trim().toLowerCase();
    return groupSitesByCountry(sites)
      .map((g) => ({ ...g, sites: q ? g.sites.filter((s) => s.name.toLowerCase().includes(q)) : g.sites }))
      .filter((g) => g.sites.length > 0);
  }, [sites, siteQuery]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.overlayTap} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.flex}>
              <AppText variant="title" weight="bold">
                Filters
              </AppText>
              <AppText variant="caption" tone="muted">
                Narrow operators by category, place, and value.
              </AppText>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.close}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
              <SectionHead Icon={Tag} label="Category" />
              <ChipRows
                items={[
                  <Chip
                    key="All"
                    label="All"
                    active={draft.category === "All"}
                    onPress={() => setDraft((c) => ({ ...c, category: "All" }))}
                  />,
                  ...categories.map((cat) => (
                    <Chip
                      key={cat}
                      label={cat}
                      active={draft.category === cat}
                      onPress={() => setDraft((c) => ({ ...c, category: cat }))}
                    />
                  ))
                ]}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <SectionHead Icon={MapPin} label="Parks and sites" />
              <View style={styles.search}>
                <Search color={colors.softText} size={16} />
                <TextInput
                  value={siteQuery}
                  onChangeText={setSiteQuery}
                  placeholder="Search parks, beaches, cities"
                  placeholderTextColor={colors.softText}
                  style={styles.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {siteQuery ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setSiteQuery("")}>
                    <X color={colors.softText} size={16} />
                  </Pressable>
                ) : null}
              </View>

              {siteGroups.length === 0 ? (
                <AppText variant="caption" tone="muted" style={styles.noMatch}>
                  No places match that search.
                </AppText>
              ) : (
                siteGroups.map((group) => (
                  <View key={group.country} style={styles.countryGroup}>
                    <AppText variant="caption" weight="semiBold" tone="muted" style={styles.countryLabel}>
                      {group.country.toUpperCase()}
                    </AppText>
                    <ChipRows
                      items={group.sites.map((s) => (
                        <Chip
                          key={String(s.id ?? s.name)}
                          label={s.name}
                          active={draft.site === s.name}
                          onPress={() => setDraft((c) => ({ ...c, site: c.site === s.name ? "All" : s.name }))}
                        />
                      ))}
                    />
                  </View>
                ))
              )}
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <SectionHead Icon={ArrowUpDown} label="Sort by" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRowsContent}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.chipRowLine}>
                  {TOUR_SORT_OPTIONS.map((o) => (
                    <Chip key={o.value} label={o.label} active={draft.sort === o.value} onPress={() => setDraft((c) => ({ ...c, sort: o.value }))} />
                  ))}
                </View>
              </ScrollView>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.flex}>
              <AppButton title="Reset" variant="ghost" onPress={() => setDraft(DEFAULT_TOUR_FILTERS)} />
            </View>
            <View style={styles.flexTwo}>
              <AppButton
                title={count != null ? `Show ${count} ${count === 1 ? "operator" : "operators"}` : "Apply"}
                onPress={() => onApply(draft)}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SectionHead({ Icon, label }: { Icon: typeof Tag; label: string }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionIcon}>
        <Icon color={colors.primary} size={14} />
      </View>
      <AppText variant="bodySmall" weight="bold">
        {label}
      </AppText>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && !active && styles.chipPressed]}
    >
      {active ? <Check color={colors.white} size={14} /> : null}
      <AppText variant="bodySmall" weight="semiBold" tone={active ? "inverse" : "default"} numberOfLines={1} style={styles.chipLabel}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Two fixed rows that slide horizontally — a compact, systematic chip carousel
 *  instead of a tall free-wrap. Items alternate top/bottom so both rows stay even. */
function ChipRows({ items }: { items: ReactNode[] }) {
  const top: ReactNode[] = [];
  const bottom: ReactNode[] = [];
  items.forEach((node, i) => (i % 2 === 0 ? top : bottom).push(node));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRowsContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.chipRows}>
        <View style={styles.chipRowLine}>{top}</View>
        <View style={styles.chipRowLine}>{bottom}</View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,6,23,0.45)" },
  overlayTap: { ...StyleSheet.absoluteFill },
  sheet: {
    maxHeight: "86%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.white,
    paddingTop: spacing[2],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
    ...shadows.sheet
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: radius.full, backgroundColor: colors.border, marginBottom: spacing[4] },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing[3], marginBottom: spacing[5] },
  close: { width: 36, height: 36, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  body: { paddingBottom: spacing[4], gap: spacing[5] },
  section: { gap: spacing[3] },
  divider: { height: 1, backgroundColor: colors.border },
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
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3]
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 0 },
  noMatch: { marginTop: spacing[1] },
  countryGroup: { gap: spacing[2] },
  countryLabel: { letterSpacing: 0.6, marginTop: spacing[2] },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  chipRowsContent: { paddingRight: spacing[2], paddingVertical: 2 },
  chipRows: { gap: spacing[2] },
  chipRowLine: { flexDirection: "row", gap: spacing[2] },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    minHeight: 36,
    maxWidth: "100%",
    justifyContent: "center"
  },
  chipLabel: { flexShrink: 1 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipPressed: { backgroundColor: colors.brand[50], borderColor: colors.brand[100] },
  footer: { flexDirection: "row", gap: spacing[3], paddingTop: spacing[4], marginTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.border },
  flex: { flex: 1, minWidth: 0 },
  flexTwo: { flex: 1.4, minWidth: 0 }
});
