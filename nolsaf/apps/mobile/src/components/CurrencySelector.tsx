import { ChevronDown } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  CURRENCY_META,
  normalizeCurrency,
  SUPPORTED_CURRENCY_CODES,
  useCurrency
} from "../currency";
import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";
import { OptionPickerSheet } from "./OptionPickerSheet";

type CurrencySelectorProps = {
  compact?: boolean;
  /** A slim chip (flag, code, chevron) for dark header bands. */
  onDark?: boolean;
};

export function CurrencySelector({ compact = false, onDark = false }: CurrencySelectorProps) {
  const { currency, setCurrency, isLoading } = useCurrency();
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () =>
      SUPPORTED_CURRENCY_CODES.map((code) => ({
        value: code,
        label: CURRENCY_META[code].name,
        description: code === "TZS" ? "Original stay prices" : `Reference-rate display in ${code}`,
        badge: code
      })),
    []
  );

  return (
    <>
      {onDark ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Display currency ${currency}. Change`}
          disabled={isLoading}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.darkChip, pressed && styles.darkChipPressed]}
        >
          <AppText style={styles.darkFlag}>{CURRENCY_META[currency].flag}</AppText>
          <AppText variant="caption" weight="extraBold" tone="inverse">
            {currency}
          </AppText>
          <ChevronDown color={colors.brand[200]} size={14} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Display currency ${currency}`}
          disabled={isLoading}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.button, compact && styles.buttonCompact, pressed && styles.buttonPressed]}
        >
          <View style={[styles.icon, compact && styles.iconCompact]}>
            <AppText style={styles.flag}>{CURRENCY_META[currency].flag}</AppText>
          </View>
          <View style={styles.labelWrap}>
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {compact ? "Currency" : "Display currency"}
            </AppText>
            <AppText variant="bodySmall" weight="extraBold" tone="primary" numberOfLines={1}>
              {compact ? `${currency} · ${CURRENCY_META[currency].symbol}` : currency}
            </AppText>
          </View>
          <ChevronDown color={colors.primary} size={compact ? 15 : 18} />
        </Pressable>
      )}

      <OptionPickerSheet
        visible={open}
        title="Choose display currency"
        subtitle="Reference rates change stay price labels only. Payments remain in TZS."
        options={options}
        value={currency}
        appearance="cards"
        onSelect={(value) => {
          const next = normalizeCurrency(value);
          if (next) void setCurrency(next);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  labelWrap: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  button: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  buttonCompact: {
    width: 148,
    minWidth: 148,
    minHeight: 52,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "flex-start",
    gap: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    borderColor: colors.brand[100]
  },
  buttonPressed: {
    borderColor: colors.brand[200],
    backgroundColor: colors.brand[50]
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  iconCompact: {
    width: 30,
    height: 30,
    borderRadius: radius.sm
  },
  flag: {
    fontSize: 18,
    lineHeight: 22
  },
  darkChip: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: spacing[2]
  },
  darkChipPressed: {
    backgroundColor: "rgba(255,255,255,0.16)"
  },
  darkFlag: {
    fontSize: 15,
    lineHeight: 19
  }
});
