import { BadgeCheck, Bookmark, Home, MapPin } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Platform, Pressable, StyleSheet, View } from "react-native";

import { getPropertyCommission, priceWithCommission } from "../bookings/priceUtils";
import { PublicPropertyCard } from "../properties";
import { colors, radius, shadows, spacing } from "../theme";
import { AmountText } from "./AmountText";
import { AppText } from "./AppText";

type PropertyCardProps = {
  property: PublicPropertyCard;
  onPress?: () => void;
  /** Notifies the parent rail when this tile is hovered or pressed, so the row
   *  can pause its own auto rotation while the user is engaging. */
  onInteractChange?: (active: boolean) => void;
  /** When true the image cycles through the gallery while idle. Off by default
   *  so the main grid stays calm; only the featured rail enables it. */
  autoSlidePhotos?: boolean;
  /** System default commission percent, used when the property has no override. */
  systemCommission?: number;
  /** Whether the traveller has saved this property. Omit the bookmark entirely when undefined. */
  saved?: boolean;
  /** Toggles the saved state for this property. */
  onToggleSave?: () => void;
};

const PHOTO_INTERVAL_MS = 10000;
const useNativeDriver = Platform.OS !== "web";

function availability(rooms: number): { label: string; bg: string; color: string } {
  if (rooms <= 0) return { label: "Sold out", bg: "#f1f5f9", color: colors.mutedText };
  if (rooms === 1) return { label: "Last room", bg: "#fff8e6", color: colors.warning };
  return { label: `${rooms} rooms left`, bg: "#dcfce7", color: colors.success };
}

/**
 * Compact property tile matching the web approved property card: title on top,
 * a square image with a verified icon badge, location, and price per night.
 * The image auto slides through the property photos every 10 seconds when more
 * than one is available, and the whole tile springs on press.
 */
export function PropertyCard({ property, onPress, onInteractChange, autoSlidePhotos = false, systemCommission = 0, saved, onToggleSave }: PropertyCardProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const [photoIndex, setPhotoIndex] = useState(0);
  const [interacting, setInteracting] = useState(false);

  const photos = useMemo(() => {
    const gallery = (property.images || []).filter(Boolean) as string[];
    if (gallery.length) return gallery;
    return property.primaryImage ? [property.primaryImage] : [];
  }, [property.images, property.primaryImage]);

  const location =
    property.location ||
    [property.district, property.regionName].filter(Boolean).join(", ") ||
    property.country ||
    "Location pending";

  // Auto advance the photo every 10s, but only while idle. Hover or press pauses
  // it so the slide is purely for attention when the user is not engaging.
  useEffect(() => {
    if (!autoSlidePhotos || photos.length <= 1 || interacting) return;
    const id = setInterval(() => {
      setPhotoIndex((current) => (current + 1) % photos.length);
    }, PHOTO_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoSlidePhotos, photos.length, interacting]);

  // Fade each new photo in for attention.
  useEffect(() => {
    fade.setValue(0.35);
    const animation = Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver });
    animation.start();
    return () => animation.stop();
  }, [photoIndex, fade]);

  function animateTo(toValue: number) {
    Animated.spring(scale, { toValue, useNativeDriver, speed: 30, bounciness: toValue < 1 ? 0 : 10 }).start();
  }

  function setInteract(active: boolean) {
    setInteracting(active);
    onInteractChange?.(active);
  }

  const currentPhoto = photos[photoIndex] ?? null;

  const commission = getPropertyCommission(property.services, systemCommission);
  const grossBasePrice = property.basePrice != null ? priceWithCommission(Number(property.basePrice), commission) : null;

  return (
    <Animated.View style={[styles.wrap, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => {
          setInteract(true);
          animateTo(0.95);
        }}
        onPressOut={() => {
          setInteract(false);
          animateTo(1);
        }}
        onHoverIn={() => {
          setInteract(true);
          animateTo(1.03);
        }}
        onHoverOut={() => {
          setInteract(false);
          animateTo(1);
        }}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
          {property.title || "Verified stay"}
        </AppText>

        <View style={styles.imageWrap}>
          {currentPhoto ? (
            <Animated.Image source={{ uri: currentPhoto }} style={[styles.image, { opacity: fade }]} resizeMode="cover" />
          ) : (
            <View style={styles.placeholder}>
              <Home color={colors.primary} size={26} />
            </View>
          )}

          <View style={styles.badge} accessibilityLabel="Verified">
            <BadgeCheck color={colors.primary} size={18} />
          </View>

          {onToggleSave ? (
            <Pressable
              accessibilityLabel={saved ? "Remove from saved" : "Save"}
              onPress={(e) => {
                e.stopPropagation();
                onToggleSave();
              }}
              style={[styles.saveBadge, saved && styles.saveBadgeOn]}
            >
              <Bookmark color={saved ? colors.white : colors.ink} size={16} fill={saved ? colors.white : "transparent"} />
            </Pressable>
          ) : null}

          {photos.length > 1 ? (
            <View style={styles.photoDots}>
              {photos.map((_, i) => (
                <View key={i} style={[styles.photoDot, i === photoIndex && styles.photoDotActive]} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.locationRow}>
          <MapPin color={colors.softText} size={14} />
          <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>
            {location}
          </AppText>
        </View>

        {grossBasePrice != null ? (
          <AmountText
            amount={grossBasePrice}
            currency={property.currency || "TZS"}
            variant="titleSm"
            weight="bold"
            tone="primary"
          />
        ) : (
          <AppText variant="bodySmall" weight="semiBold" tone="muted">
            Price on details
          </AppText>
        )}
        <View style={styles.priceFooter}>
          <AppText variant="caption" tone="soft">
            per night
          </AppText>
          {property.roomsAvailable != null ? (
            <View style={[styles.availChip, { backgroundColor: availability(property.roomsAvailable).bg }]}>
              <AppText
                variant="caption"
                weight="bold"
                numberOfLines={1}
                style={{ color: availability(property.roomsAvailable).color }}
              >
                {availability(property.roomsAvailable).label}
              </AppText>
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    minWidth: 0
  },
  card: {
    width: "100%",
    minWidth: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing[3],
    gap: spacing[2],
    ...shadows.card
  },
  cardPressed: {
    borderColor: colors.brand[200],
    backgroundColor: colors.brand[50]
  },
  imageWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.brand[50]
  },
  image: {
    width: "100%",
    height: "100%"
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
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
  saveBadge: {
    position: "absolute",
    top: spacing[2],
    left: spacing[2],
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
  saveBadgeOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  photoDots: {
    position: "absolute",
    bottom: spacing[2],
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing[1]
  },
  photoDot: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.6)"
  },
  photoDotActive: {
    width: 14,
    backgroundColor: colors.white
  },
  locationRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  priceFooter: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  availChip: {
    flexShrink: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  }
});
