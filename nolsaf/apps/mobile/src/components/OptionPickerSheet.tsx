import { Check, Search, X, type LucideIcon } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { AppText } from "./AppText";

export type PickerOption = { value: string; label: string; description?: string; icon?: LucideIcon };

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: PickerOption[];
  value?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
};

export function OptionPickerSheet({ visible, title, subtitle, options, value, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dy > 100 || gesture.vy > 0.8) {
          Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: true }).start(() => {
            translateY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        }
      }
    })
  ).current;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q));
  }, [query, options]);

  const searchable = options.length > 8;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View {...panResponder.panHandlers}>
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>
            <View style={styles.header}>
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="bold">
                  {title}
                </AppText>
                {subtitle ? (
                  <AppText variant="caption" tone="muted">
                    {subtitle}
                  </AppText>
                ) : null}
              </View>
              <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.close}>
                <X color={colors.ink} size={20} />
              </Pressable>
            </View>
          </View>

          {searchable ? (
            <View style={styles.searchRow}>
              <Search color={colors.softText} size={16} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
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
          ) : null}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <View style={styles.empty}>
                <AppText variant="bodySmall" tone="muted">
                  No options match "{query}"
                </AppText>
              </View>
            ) : (
              filtered.map((option) => {
                const active = option.value === value;
                const Icon = option.icon;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    onPress={() => {
                      onSelect(option.value);
                      onClose();
                    }}
                    style={[styles.row, active && styles.rowActive]}
                  >
                    {Icon ? (
                      <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                        <Icon color={active ? colors.primary : colors.softText} size={18} />
                      </View>
                    ) : null}
                    <View style={styles.flex}>
                      <AppText variant="bodySmall" weight={active ? "bold" : "medium"} tone={active ? "primary" : "default"}>
                        {option.label}
                      </AppText>
                      {option.description ? (
                        <AppText variant="caption" tone="soft" numberOfLines={2}>
                          {option.description}
                        </AppText>
                      ) : null}
                    </View>
                    {active ? <Check color={colors.primary} size={18} /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(2,6,23,0.42)" },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.white,
    paddingTop: spacing[2],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[3],
    maxHeight: "80%",
    ...shadows.sheet
  },
  handleWrap: { alignItems: "center", paddingVertical: spacing[2] },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border
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
  listContent: { paddingBottom: spacing[5], gap: spacing[1] },
  empty: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[10] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  rowActive: { backgroundColor: colors.brand[50] },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  iconWrapActive: {
    backgroundColor: colors.white,
    borderColor: colors.brand[100]
  }
});
