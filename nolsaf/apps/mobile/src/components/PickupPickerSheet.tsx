import { Bus, Check, MapPin, Plane, Search, Ship, TrainFront, X } from "lucide-react-native";
import { ReactNode, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { PICKUP_CATEGORY_LABELS, PickupCategory, PickupPoint } from "../transport";
import { colors, radius, shadows, spacing } from "../theme";
import { AppText } from "./AppText";

const CATEGORY_ORDER: PickupCategory[] = ["airport", "bus_terminal", "train_station", "ferry_port"];

const CATEGORY_ICON: Record<PickupCategory, ReactNode> = {
  airport: <Plane color="#0369a1" size={16} />,
  bus_terminal: <Bus color={colors.primary} size={16} />,
  train_station: <TrainFront color="#b45309" size={16} />,
  ferry_port: <Ship color="#6d28d9" size={16} />
};

const CATEGORY_TINT: Record<PickupCategory, string> = {
  airport: "#e7f3fb",
  bus_terminal: colors.brand[50],
  train_station: "#fef3e7",
  ferry_port: "#efeafe"
};

/** Split items into columns of two, so each rail column shows a top and bottom
 *  tile and the user slides horizontally through the set. */
function chunkPairs<T>(items: T[]): T[][] {
  const columns: T[][] = [];
  for (let i = 0; i < items.length; i += 2) columns.push(items.slice(i, i + 2));
  return columns;
}

type Props = {
  visible: boolean;
  selectedId: string | null;
  points: PickupPoint[];
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSelect: (point: PickupPoint) => void;
};

export function PickupPickerSheet({ visible, selectedId, points, title, subtitle, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? points.filter(
          (p) =>
            p.label.toLowerCase().includes(q) ||
            p.city.toLowerCase().includes(q) ||
            (p.iataCode?.toLowerCase().includes(q) ?? false)
        )
      : points;
    return CATEGORY_ORDER.map((cat) => ({
      key: cat,
      label: PICKUP_CATEGORY_LABELS[cat],
      items: matches.filter((p) => p.category === cat)
    })).filter((g) => g.items.length > 0);
  }, [query, points]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.flex}>
              <AppText variant="titleSm" weight="bold">
                {title || "Select pickup point"}
              </AppText>
              <AppText variant="caption" tone="muted">
                {subtitle || "Airport, bus terminal, or ferry port"}
              </AppText>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.close}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Search color={colors.softText} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search city, terminal, or code"
              placeholderTextColor={colors.softText}
              style={styles.searchInput}
              autoCorrect={false}
            />
            {query ? (
              <Pressable accessibilityRole="button" onPress={() => setQuery("")} hitSlop={8}>
                <X color={colors.softText} size={15} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
            {groups.length === 0 ? (
              <View style={styles.empty}>
                <Search color={colors.softText} size={24} />
                <AppText variant="bodySmall" tone="muted">
                  No pickup points match "{query}"
                </AppText>
              </View>
            ) : (
              groups.map((group) => (
                <View key={group.key} style={styles.group}>
                  <View style={styles.groupHead}>
                    <AppText variant="caption" weight="bold" tone="muted" style={styles.groupLabel}>
                      {group.label.toUpperCase()}
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      {group.items.length}
                    </AppText>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.railContent}
                    keyboardShouldPersistTaps="handled"
                  >
                    {chunkPairs(group.items).map((col, ci) => (
                      <View key={ci} style={styles.col}>
                        {col.map((p) => {
                          const active = selectedId === p.id;
                          return (
                            <Pressable
                              key={p.id}
                              accessibilityRole="button"
                              onPress={() => {
                                onSelect(p);
                                onClose();
                              }}
                              style={[styles.tile, active && styles.tileActive]}
                            >
                              <View
                                style={[
                                  styles.badge,
                                  { backgroundColor: active ? "rgba(255,255,255,0.22)" : CATEGORY_TINT[p.category] }
                                ]}
                              >
                                {active ? <MapPin color={colors.white} size={16} /> : CATEGORY_ICON[p.category]}
                              </View>
                              <View style={styles.flex}>
                                <AppText variant="bodySmall" weight="bold" tone={active ? "inverse" : "default"} numberOfLines={1}>
                                  {p.shortLabel}
                                </AppText>
                                <AppText variant="caption" tone={active ? "inverse" : "soft"} numberOfLines={1}>
                                  {p.city}
                                  {p.iataCode ? `  ·  ${p.iataCode}` : ""}
                                </AppText>
                              </View>
                              {active ? <Check color={colors.white} size={15} /> : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,6,23,0.42)" },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.white,
    paddingTop: spacing[5],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[3],
    maxHeight: "86%",
    ...shadows.sheet
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3], marginBottom: spacing[4] },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    height: 48,
    marginBottom: spacing[3]
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, padding: 0 },
  list: { alignSelf: "stretch" },
  listContent: { paddingBottom: spacing[5], gap: spacing[4] },
  empty: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[10] },
  group: { gap: spacing[2] },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupLabel: { letterSpacing: 1 },
  railContent: { gap: spacing[2], paddingRight: spacing[2] },
  col: { gap: spacing[2] },
  tile: {
    width: 246,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  tileActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  badge: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center"
  }
});
