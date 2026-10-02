import { useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { BadgeCheck, Building2, Clock3, MapPin, Star } from "lucide-react-native";

import { colors, radius, shadows, spacing } from "../theme";
import type { FeaturedTourOperator } from "../tours/types";
import { AppText } from "./AppText";

/**
 * Card for one approved tour operator, the twin of the web marketplace card
 * (PublicTourOperatorCard) and of the app's stay card: name and rating on top,
 * a square photo with the verified badge and a tour count, where and how long,
 * the lowest price per person, and one action. The whole card is one tap.
 */
export function TourOperatorTile({ item, width, onPress }: { item: FeaturedTourOperator; width: number; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = !photoFailed ? item.image : null;
  const hasRating = item.averageRating != null && item.totalRatings > 0;
  const multiple = item.packageCount > 1;

  const press = (to: number) => Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 30, bounciness: to < 1 ? 0 : 8 }).start();

  return (
    <Animated.View style={{ width, transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Book a tour with ${item.operatorName}${item.lowestPricePerPerson ? `, from ${item.currency} ${Math.round(item.lowestPricePerPerson).toLocaleString()} per person` : ""}`}
        onPress={onPress}
        onPressIn={() => press(0.97)}
        onPressOut={() => press(1)}
        style={styles.card}
      >
        <View style={styles.titleRow}>
          <AppText variant="bodySmall" weight="bold" numberOfLines={1} style={styles.flex}>
            {item.operatorName}
          </AppText>
          {hasRating ? (
            <View style={styles.rating}>
              <Star color="#f59e0b" fill="#f59e0b" size={13} />
              <AppText variant="caption" weight="bold">{item.averageRating!.toFixed(1)}</AppText>
            </View>
          ) : null}
        </View>

        <View style={styles.imageWrap}>
          {photo ? (
            <Animated.Image
              source={{ uri: photo }}
              resizeMode="cover"
              onLoad={() => Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }).start()}
              onError={() => setPhotoFailed(true)}
              style={[styles.image, { opacity: fade }]}
            />
          ) : (
            <View style={styles.placeholder}>
              <Building2 color={colors.softText} size={30} />
            </View>
          )}
          <View style={styles.badge} accessibilityLabel="Verified">
            <BadgeCheck color={colors.primary} size={18} />
          </View>
          {multiple ? (
            <View style={styles.toursPill}>
              <AppText variant="caption" weight="bold">{item.packageCount} tours</AppText>
            </View>
          ) : null}
        </View>

        <View style={styles.infoRow}>
          <View style={styles.flex}>
            <View style={styles.metaRow}>
              <MapPin color={colors.softText} size={13} />
              <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>{item.where}</AppText>
            </View>
            {item.leadDuration ? (
              <View style={styles.metaRow}>
                <Clock3 color={colors.softText} size={13} />
                <AppText variant="caption" tone="soft" numberOfLines={1} style={styles.flex}>{multiple ? `From ${item.leadDuration}` : item.leadDuration}</AppText>
              </View>
            ) : null}
          </View>
          <View style={styles.price}>
            {item.lowestPricePerPerson ? (
              <>
                <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                  {multiple ? <AppText variant="caption" weight="semiBold" tone="muted">from </AppText> : null}
                  {item.currency} {Math.round(item.lowestPricePerPerson).toLocaleString()}
                </AppText>
                <AppText variant="caption" tone="soft">per person</AppText>
              </>
            ) : (
              <AppText variant="caption" weight="semiBold" tone="muted">Price on request</AppText>
            )}
          </View>
        </View>

        {/* An action, not a peek: the operator page is where the tour is booked. */}
        <View style={styles.action}>
          <AppText variant="caption" weight="bold" tone="inverse">Book & Pay</AppText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing[3],
    gap: spacing[2],
    ...shadows.card
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  imageWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.brand[50]
  },
  image: { width: "100%", height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#eef2f1" },
  badge: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
    ...shadows.card
  },
  toursPill: {
    position: "absolute",
    left: spacing[2],
    bottom: spacing[2],
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.95)"
  },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  price: { alignItems: "flex-end", flexShrink: 0 },
  action: {
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  }
});
