import { MapPin, Navigation } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AppCard } from "./AppCard";
import { AppStack } from "./AppStack";
import { AppText } from "./AppText";
import { ResponsiveRow } from "./ResponsiveRow";

type RouteSummaryCardProps = {
  pickup: string;
  dropoff: string;
  distanceKm?: number;
  durationHours?: number;
  tripType?: "scheduled" | "auto-dispatched";
};

export function RouteSummaryCard({ pickup, dropoff, distanceKm, durationHours, tripType }: RouteSummaryCardProps) {
  return (
    <AppCard>
      <AppStack gap={4}>
        <ResponsiveRow stackAt={440}>
          <View style={styles.routeCell}>
            <MapPin color={colors.primary} size={20} />
            <AppStack gap={1} style={styles.routeText}>
              <AppText variant="caption" weight="bold" tone="muted" style={styles.label}>
                PICKUP
              </AppText>
              <AppText variant="bodySmall" weight="medium" numberOfLines={3}>
                {pickup}
              </AppText>
            </AppStack>
          </View>
          <View style={styles.routeCell}>
            <Navigation color={colors.primary} size={20} />
            <AppStack gap={1} style={styles.routeText}>
              <AppText variant="caption" weight="bold" tone="muted" style={styles.label}>
                DROPOFF
              </AppText>
              <AppText variant="bodySmall" weight="medium" numberOfLines={3}>
                {dropoff}
              </AppText>
            </AppStack>
          </View>
        </ResponsiveRow>
        <ResponsiveRow stackAt={380}>
          {tripType ? <Meta label="Trip type" value={tripType} /> : null}
          {distanceKm != null ? <Meta label="Distance" value={`${distanceKm.toFixed(1)} KM`} /> : null}
          {durationHours != null ? <Meta label="Hours" value={`${durationHours.toFixed(1)} HRS`} /> : null}
        </ResponsiveRow>
      </AppStack>
    </AppCard>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <AppText variant="caption" weight="bold" tone="muted" style={styles.label}>
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  routeCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: spacing[3],
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    padding: spacing[3]
  },
  routeText: {
    flex: 1
  },
  meta: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    padding: spacing[3],
    gap: spacing[1]
  },
  label: {
    textTransform: "uppercase",
    letterSpacing: 1.2
  }
});
