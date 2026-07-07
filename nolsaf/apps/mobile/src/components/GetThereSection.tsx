import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Bike, ChevronRight, Clock3, Home, MapPin, Navigation, PlaneLanding, Zap } from "lucide-react-native";
import { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Pattern, Rect, Stop } from "react-native-svg";

import { TransportBookingContext } from "../bookings";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, shadows, spacing } from "../theme";
import { AppStack } from "./AppStack";
import { AppText } from "./AppText";

type GetThereSectionProps = {
  /** The paid stay this transport will bring the customer to. When omitted the
   *  section is a guest teaser that routes to booking a stay first. */
  booking?: TransportBookingContext;
};

/**
 * "One Trip, One Tap": NoLSAF transport that always ends at the customer's
 * booked property. NoLSAF does not sell standalone rides, so the action either
 * adds transport to a paid booking or (for guests) sends them to book a stay
 * first.
 */
export function GetThereSection({ booking }: GetThereSectionProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  function openTransport(mode: "scheduled" | "instant") {
    if (!booking) {
      // No stay booked yet, and transport needs a destination, so book a stay first.
      navigation.navigate("VerifiedStays");
      return;
    }
    navigation.navigate("AddTransport", {
      bookingId: booking.bookingId,
      mode,
      propertyId: booking.propertyId,
      propertyTitle: booking.propertyTitle,
      propertyArea: booking.propertyArea
    });
  }

  return (
    <AppStack gap={3}>
      {/* Header panel: signals this block explains a NoLSAF capability */}
      <View style={styles.hero}>
        <Svg pointerEvents="none" style={styles.heroGradient} width="100%" height="100%">
          <Defs>
            <LinearGradient id="getThereGradient" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="1" />
              <Stop offset="1" stopColor="#eef4f3" stopOpacity="1" />
            </LinearGradient>
            {/* Faint neutral dots for a subtle textured white panel */}
            <Pattern id="getThereDots" patternUnits="userSpaceOnUse" width="22" height="22">
              <Circle cx="4" cy="4" r="1.4" fill="#64748b" fillOpacity="0.1" />
              <Circle cx="15" cy="15" r="1.4" fill="#64748b" fillOpacity="0.1" />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#getThereGradient)" />
          <Rect width="100%" height="100%" fill="url(#getThereDots)" />
        </Svg>

        <View style={styles.heroContent}>
          <View style={styles.eyebrowPill}>
            <Zap color={colors.primary} size={12} />
            <AppText variant="caption" weight="bold" tone="primary" style={styles.eyebrowText}>
              ONE TRIP, ONE TAP
            </AppText>
          </View>

          <AppText variant="headline" weight="extraBold">
            Get there
          </AppText>
          <AppText variant="bodySmall" tone="muted">
            {booking
              ? `Add transport to ${booking.propertyTitle}. We bring you to your booked stay, with no extra app and no separate booking.`
              : "NoLSAF brings you to the stay you book, with no separate ride app. Book a verified stay, then add a transfer or instant pickup to it."}
          </AppText>

          <RouteIllustration />
        </View>
      </View>

      <ModeCard
        icon={<PlaneLanding color={colors.primary} size={22} />}
        title="Schedule a transfer"
        description="Airport, bus or ferry pickup, timed to your arrival, straight to your stay."
        tag="Plan ahead"
        tagIcon={<Clock3 color={colors.primary} size={12} />}
        onPress={() => openTransport("scheduled")}
      />
      <ModeCard
        icon={<Navigation color={colors.warning} size={22} />}
        iconTone="warning"
        title="Pick me up now"
        description="Instant pickup from where you are to your booked stay."
        tag="Right now"
        tagIcon={<Zap color={colors.warning} size={12} />}
        tagTone="warning"
        onPress={() => openTransport("instant")}
      />
    </AppStack>
  );
}

/** Small "rider going from one place to another" graphic, drawn for attention. */
function RouteIllustration() {
  return (
    <View style={styles.route}>
      <Endpoint icon={<MapPin color={colors.primary} size={16} />} label="Pickup" />
      <View style={styles.track}>
        <DotRow />
        <View style={styles.bikeChip}>
          <Bike color={colors.white} size={18} />
        </View>
        <DotRow />
      </View>
      <Endpoint icon={<Home color={colors.primary} size={16} />} label="Your stay" />
    </View>
  );
}

function Endpoint({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <View style={styles.endpoint}>
      <View style={styles.endpointDot}>{icon}</View>
      <AppText variant="caption" weight="semiBold" tone="muted" style={styles.endpointLabel}>
        {label}
      </AppText>
    </View>
  );
}

function DotRow() {
  return (
    <View style={styles.dotRow}>
      {Array.from({ length: 5 }).map((_, index) => (
        <View key={index} style={styles.dot} />
      ))}
    </View>
  );
}

function ModeCard({
  icon,
  iconTone = "primary",
  title,
  description,
  tag,
  tagIcon,
  tagTone = "primary",
  onPress
}: {
  icon: ReactNode;
  iconTone?: "primary" | "warning";
  title: string;
  description: string;
  tag: string;
  tagIcon: ReactNode;
  tagTone?: "primary" | "warning";
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={[styles.iconWrap, iconTone === "warning" && styles.iconWrapWarning]}>{icon}</View>
      <View style={styles.cardText}>
        <AppText variant="bodySmall" weight="bold">
          {title}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={3}>
          {description}
        </AppText>
        <View style={[styles.tag, tagTone === "warning" && styles.tagWarning]}>
          {tagIcon}
          <AppText
            variant="caption"
            weight="bold"
            tone={tagTone === "warning" ? "warning" : "primary"}
            style={styles.tagText}
          >
            {tag}
          </AppText>
        </View>
      </View>
      <ChevronRight color={colors.softText} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    ...shadows.card
  },
  heroGradient: {
    ...StyleSheet.absoluteFill
  },
  heroContent: {
    padding: spacing[5],
    gap: spacing[2]
  },
  eyebrowPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    marginBottom: spacing[1]
  },
  eyebrowText: {
    letterSpacing: 1.6
  },
  route: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3]
  },
  endpoint: {
    alignItems: "center",
    gap: spacing[1],
    width: 58
  },
  endpointDot: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  endpointLabel: {
    textAlign: "center"
  },
  track: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  dotRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: "#cbd5e1"
  },
  bikeChip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.white
  },
  card: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing[4]
  },
  cardPressed: {
    backgroundColor: colors.brand[50],
    borderColor: colors.brand[100]
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  iconWrapWarning: {
    backgroundColor: "#fff8e6"
  },
  cardText: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1]
  },
  tag: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginTop: spacing[1],
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    backgroundColor: colors.brand[50]
  },
  tagWarning: {
    backgroundColor: "#fff8e6"
  },
  tagText: {
    textTransform: "uppercase",
    letterSpacing: 0.8
  }
});
