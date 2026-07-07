import { CalendarCheck } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AmountText } from "./AmountText";
import { AppCard } from "./AppCard";
import { AppStack } from "./AppStack";
import { AppText } from "./AppText";
import { CodeText } from "./CodeText";
import { StatusBadge } from "./StatusBadge";

type BookingSummaryCardProps = {
  title: string;
  code: string;
  amount: number;
  currency?: string;
  status: "requested" | "verified" | "approved" | "paid" | "completed" | "cancelled";
};

export function BookingSummaryCard({ title, code, amount, currency = "TZS", status }: BookingSummaryCardProps) {
  return (
    <AppCard>
      <AppStack gap={4}>
        <View style={styles.header}>
          <View style={styles.iconWrap}>
            <CalendarCheck color={colors.primary} size={22} />
          </View>
          <StatusBadge status={status} />
        </View>
        <AppStack gap={2}>
          <AppText variant="titleSm" weight="bold" numberOfLines={2}>
            {title}
          </AppText>
          <CodeText value={code} />
        </AppStack>
        <AmountText amount={amount} currency={currency} tone="primary" />
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
    gap: spacing[3]
  },
  iconWrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.brand[50]
  }
});
