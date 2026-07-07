import {
  Armchair,
  Bath,
  Car,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Gamepad2,
  LucideIcon,
  Microwave,
  Refrigerator,
  ShowerHead,
  Shirt,
  Sparkles,
  Tv,
  Utensils,
  Waves,
  WashingMachine,
  Wifi,
  Wind
} from "lucide-react-native";
import { ScrollView, StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";

/** Maps an amenity label to a sensible icon. */
function amenityIcon(label: string): LucideIcon {
  const n = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.includes("wifi") || n.includes("internet")) return Wifi;
  if (n.includes("flatscreen") || n.includes("television") || n.includes("tv") || n.includes("screen")) return Tv;
  if (n.includes("aircondition") || n.includes("aircon")) return Wind;
  if (n.includes("heat")) return Flame;
  if (n.includes("coffee")) return Coffee;
  if (n.includes("chair") || n.includes("sofa") || n.includes("seat")) return Armchair;
  if (n.includes("wardrobe") || n.includes("closet") || n.includes("iron") || n.includes("shirt")) return Shirt;
  if (n.includes("playstation") || n.includes("psstation") || n.includes("console") || n.includes("game")) return Gamepad2;
  if (n.includes("fridge") || n.includes("refriger")) return Refrigerator;
  if (n.includes("microwave")) return Microwave;
  if (n.includes("laundry") || n.includes("washing") || n.includes("washer")) return WashingMachine;
  if (n.includes("kitchen") || n.includes("cook") || n.includes("stove")) return Utensils;
  if (n.includes("bathtub") || n.includes("tub")) return Bath;
  if (n.includes("shower")) return ShowerHead;
  if (n.includes("towel") || n.includes("soap") || n.includes("toiletr")) return Droplets;
  if (n.includes("parking") || n.includes("garage")) return Car;
  if (n.includes("pool") || n.includes("swim")) return Waves;
  if (n.includes("gym") || n.includes("fitness")) return Dumbbell;
  return Sparkles;
}

export function AmenityChip({ label }: { label: string }) {
  const Icon = amenityIcon(label);
  return (
    <View style={styles.chip}>
      <View style={styles.iconWrap}>
        <Icon color={colors.primary} size={13} />
      </View>
      <AppText variant="caption" weight="semiBold">
        {label}
      </AppText>
    </View>
  );
}

/**
 * Amenities laid out in a fixed number of rows (default three), filling top to
 * bottom then continuing into more columns that slide horizontally.
 */
export function AmenityGrid({ items, rows = 3 }: { items: string[]; rows?: number }) {
  const columns: string[][] = [];
  for (let i = 0; i < items.length; i += rows) columns.push(items.slice(i, i + rows));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sliderRow} keyboardShouldPersistTaps="handled">
      {columns.map((col, ci) => (
        <View key={ci} style={styles.column}>
          {col.map((label, i) => {
            const Icon = amenityIcon(label);
            return (
              <View key={i} style={styles.item}>
                <View style={styles.iconWrap}>
                  <Icon color={colors.primary} size={14} />
                </View>
                <AppText variant="bodySmall" weight="medium" numberOfLines={1} style={styles.cellLabel}>
                  {label}
                </AppText>
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingLeft: spacing[1],
    paddingRight: spacing[3],
    paddingVertical: spacing[1]
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  sliderRow: {
    gap: spacing[5],
    paddingRight: spacing[3]
  },
  column: {
    gap: spacing[3]
  },
  item: {
    width: 168,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  cellLabel: {
    flex: 1,
    minWidth: 0
  }
});
