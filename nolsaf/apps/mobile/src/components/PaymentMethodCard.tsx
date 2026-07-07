import { CreditCard, Landmark, Smartphone } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AppCard } from "./AppCard";
import { AppStack } from "./AppStack";
import { AppText } from "./AppText";
import { StatusBadge } from "./StatusBadge";

type PaymentKind = "mobile_money" | "bank" | "card";

type PaymentMethodCardProps = {
  kind: PaymentKind;
  label: string;
  detail: string;
  status?: "pending" | "paid" | "failed" | "approved";
};

const iconMap = {
  mobile_money: Smartphone,
  bank: Landmark,
  card: CreditCard
};

export function PaymentMethodCard({ kind, label, detail, status = "pending" }: PaymentMethodCardProps) {
  const Icon = iconMap[kind];

  return (
    <AppCard>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Icon color={colors.primary} size={22} />
        </View>
        <StatusBadge status={status} />
      </View>
      <AppStack gap={1}>
        <AppText variant="caption" weight="bold" tone="muted" style={styles.label}>
          PAYMENT METHOD
        </AppText>
        <AppText variant="titleSm" weight="bold" numberOfLines={2}>
          {label}
        </AppText>
        <AppText variant="bodySmall" tone="muted" numberOfLines={2}>
          {detail}
        </AppText>
      </AppStack>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  header: {
    minWidth: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing[3],
    marginBottom: spacing[4]
  },
  iconWrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.brand[50]
  },
  label: {
    letterSpacing: 1.2
  }
});
