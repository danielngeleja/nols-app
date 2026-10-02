import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Bike, Home, MapPin, Navigation, PlaneLanding } from "lucide-react-native";
import { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { TransportBookingContext } from "../bookings";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";
import { AppStack } from "./AppStack";
import { AppText } from "./AppText";

type GetThereSectionProps = {
  /** The paid stay this transport will bring the customer to. When omitted the
   *  section is a guest entry that routes to booking a stay first. */
  booking?: TransportBookingContext;
};

/**
 * NoLSAF transport always ends at the customer's booked property, so the route
 * itself is the message: any pickup on the left, the stay as the fixed,
 * filled end on the right. Two actions, no pitch. Guests are sent to book a
 * stay first, since a ride needs a destination.
 */
export function GetThereSection({ booking }: GetThereSectionProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  function openTransport(mode: "scheduled" | "instant") {
    if (!booking) {
      navigation.navigate("VerifiedStays");
      return;
    }
    navigation.navigate("AddTransport", {
      bookingId: booking.bookingId,
      bookingRef: booking.bookingReference,
      mode,
      propertyId: booking.propertyId,
      propertyTitle: booking.propertyTitle,
      propertyArea: booking.propertyArea
    });
  }

  return (
    <AppStack gap={3}>
      <View style={styles.header}>
        <AppText variant="title" weight="extraBold" numberOfLines={1}>Get there</AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {booking ? "Rides to your booked stay" : "Book a stay, then add a ride"}
        </AppText>
      </View>

      <View style={styles.card}>
        <View style={styles.route} accessible accessibilityLabel={`From any pickup to ${booking ? booking.propertyTitle : "your stay"}`}>
          <View style={styles.end}>
            <View style={styles.from}>
              <MapPin color={colors.primary} size={16} />
            </View>
            <AppText variant="caption" weight="semiBold" tone="muted" numberOfLines={1}>Pickup</AppText>
          </View>

          <View style={styles.track}>
            <View style={styles.line}>
              {Array.from({ length: 14 }).map((_, i) => (
                <View key={i} style={styles.dash} />
              ))}
            </View>
            <View style={styles.rider}>
              <Bike color={colors.primary} size={14} />
            </View>
          </View>

          <View style={[styles.end, styles.endRight]}>
            <View style={styles.to}>
              <Home color={colors.white} size={16} />
            </View>
            <AppText variant="caption" weight="bold" numberOfLines={1} style={styles.stayLabel}>
              {booking ? booking.propertyTitle : "Your stay"}
            </AppText>
          </View>
        </View>

        <View style={styles.actions}>
          <Action
            icon={<PlaneLanding color={colors.primary} size={18} />}
            label="Transfer"
            hint="Timed to arrival"
            onPress={() => openTransport("scheduled")}
          />
          <View style={styles.divider} />
          <Action
            icon={<Navigation color={colors.warning} size={18} />}
            warm
            label="Pickup now"
            hint="From where you are"
            onPress={() => openTransport("instant")}
          />
        </View>
      </View>
    </AppStack>
  );
}

function Action({ icon, label, hint, warm, onPress }: { icon: ReactNode; label: string; hint: string; warm?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${hint}`}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      <View style={[styles.actionIcon, warm && styles.actionIconWarm]}>{icon}</View>
      <View style={styles.actionText}>
        <AppText variant="bodySmall" weight="bold" numberOfLines={1}>{label}</AppText>
        <AppText variant="caption" tone="soft" numberOfLines={1}>{hint}</AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 2
  },
  card: {
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card
  },
  route: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[2]
  },
  end: {
    alignItems: "flex-start",
    gap: 6,
    maxWidth: 110
  },
  endRight: {
    alignItems: "flex-end"
  },
  from: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.white
  },
  to: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  stayLabel: {
    textAlign: "right"
  },
  track: {
    flex: 1,
    height: 32,
    justifyContent: "center",
    alignItems: "center"
  },
  line: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between"
  },
  dash: {
    width: 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(2,102,94,0.35)"
  },
  rider: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  actions: {
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  divider: {
    width: 1,
    backgroundColor: colors.border
  },
  action: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  actionPressed: {
    backgroundColor: colors.brand[50]
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  actionIconWarm: {
    backgroundColor: "#fff8e6"
  },
  actionText: {
    flex: 1,
    minWidth: 0
  }
});
