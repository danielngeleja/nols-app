import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { radius, spacing } from "../theme";
import { AppText } from "./AppText";

export type HeroStatProps = {
  label: string;
  value: string | number;
  accent: string;
  icon?: ReactNode;
  prefix?: string;
  footer?: string;
};

// The translucent "glass" stat card that sits inside PartnerHero (for example
// BOOKINGS and NET REVENUE on the Owner home). White on the dark hero, with a
// role accent color on the label and icon.
export function HeroStat({ label, value, accent, icon, prefix, footer }: HeroStatProps) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <AppText variant="caption" weight="medium" numberOfLines={1} style={{ color: accent, letterSpacing: 1 }}>
          {label}
        </AppText>
        {icon ? <View style={styles.icon}>{icon}</View> : null}
      </View>
      {prefix ? (
        <AppText variant="caption" style={styles.prefix}>
          {prefix}
        </AppText>
      ) : null}
      <AppText variant="headline" weight="extraBold" numberOfLines={1} style={styles.value}>
        {String(value)}
      </AppText>
      {footer ? (
        <AppText variant="caption" numberOfLines={1} style={styles.footer}>
          {footer}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.md,
    padding: spacing[3]
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  icon: { marginLeft: spacing[2] },
  prefix: { color: "rgba(255,255,255,0.55)", marginTop: 4 },
  value: { color: "#ffffff", marginTop: 4 },
  footer: { color: "rgba(255,255,255,0.5)", marginTop: 6 }
});
