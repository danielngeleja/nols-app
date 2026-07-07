import { ArrowUpDown, Check, MapPin, Tag, X } from "lucide-react-native";
import { ReactNode, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

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

/** Group sites by country so each country shows as its own separated lane. Tanzania
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

/** Bottom sheet of advanced tour filters, classified into Category, Parks and sites,
 *  and Sort, each with its own iconed header and a horizontal row of chips. Edits a
 *  draft and applies on Apply, the same calm pattern the Verified Stays filters use. */
export function TourFiltersSheet({ visible, value, categories, sites, getCount, onApply, onClose }: TourFiltersSheetProps) {
  const [draft, setDraft] = useState<TourFilterValue>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const count = getCount ? getCount(draft) : null;
  const siteGroups = groupSitesByCountry(sites);

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
            <Section Icon={Tag} label="Category">
              <Chip label="All" active={draft.category === "All"} onPress={() => setDraft((c) => ({ ...c, category: "All" }))} />
              {categories.map((cat) => (
                <Chip key={cat} label={cat} active={draft.category === cat} onPress={() => setDraft((c) => ({ ...c, category: cat }))} />
              ))}
            </Section>

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <View style={styles.sectionIcon}>
                  <MapPin color={colors.primary} size={14} />
                </View>
                <AppText variant="bodySmall" weight="bold">
                  Parks and sites
                </AppText>
              </View>

              {siteGroups.map((group) => (
                <View key={group.country} style={styles.countryGroup}>
                  <View style={styles.countryHead}>
                    <AppText variant="caption" weight="bold" tone="muted" style={styles.countryLabel}>
                      {group.country.toUpperCase()}
                    </AppText>
                    <View style={styles.countryLine} />
                    <AppText variant="caption" tone="soft">
                      {group.sites.length}
                    </AppText>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
                    {group.sites.map((s) => (
                      <Chip
                        key={String(s.id ?? s.name)}
                        label={s.name}
                        active={draft.site === s.name}
                        onPress={() => setDraft((c) => ({ ...c, site: c.site === s.name ? "All" : s.name }))}
                      />
                    ))}
                  </ScrollView>
                </View>
              ))}
            </View>

            <Section Icon={ArrowUpDown} label="Sort by">
              {TOUR_SORT_OPTIONS.map((o) => (
                <Chip key={o.value} label={o.label} active={draft.sort === o.value} onPress={() => setDraft((c) => ({ ...c, sort: o.value }))} />
              ))}
            </Section>
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

function Section({ Icon, label, children }: { Icon: typeof Tag; label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <Icon color={colors.primary} size={14} />
        </View>
        <AppText variant="bodySmall" weight="bold">
          {label}
        </AppText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && !active && styles.chipPressed]}
    >
      {active ? <Check color={colors.white} size={14} /> : null}
      <AppText variant="bodySmall" weight="semiBold" tone={active ? "inverse" : "default"}>
        {label}
      </AppText>
    </Pressable>
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
  countryGroup: { gap: spacing[2] },
  countryHead: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  countryLabel: { letterSpacing: 1.2 },
  countryLine: { flex: 1, height: 1, backgroundColor: colors.border },
  chipRow: { gap: spacing[2], paddingRight: spacing[2], paddingVertical: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    minHeight: 42,
    justifyContent: "center"
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary, ...shadows.card },
  chipPressed: { backgroundColor: colors.brand[50], borderColor: colors.brand[100] },
  footer: { flexDirection: "row", gap: spacing[3], paddingTop: spacing[4], marginTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.border },
  flex: { flex: 1, minWidth: 0 },
  flexTwo: { flex: 1.4, minWidth: 0 }
});
