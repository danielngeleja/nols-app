import { ExternalLink, MapPin } from "lucide-react-native";
import { Image, Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { env } from "../lib/env";
import { colors, radius, shadows, spacing } from "../theme";
import { AppText } from "./AppText";

type LocationMapCardProps = {
  latitude: number | null;
  longitude: number | null;
  address: string;
  precision?: "EXACT" | "APPROXIMATE";
  radiusMeters?: number | null;
};

/**
 * Lightweight location card. Uses the Mapbox Static Images API (a single image,
 * no live GL rendering) so there is no battery drain or device heat. Tapping it
 * opens the native maps app for full interactivity.
 */
export function LocationMapCard({ latitude, longitude, address, precision = "EXACT", radiusMeters }: LocationMapCardProps) {
  const { width } = useWindowDimensions();
  const hasCoords = latitude != null && longitude != null;
  const isApproximate = precision === "APPROXIMATE";
  const token = env.mapboxToken;

  const imgW = Math.min(640, Math.round(width - spacing[4] * 2));
  const imgH = 170;
  const mapUrl =
    hasCoords && token
      ? isApproximate
        ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${longitude},${latitude},12,0/${imgW}x${imgH}@2x?access_token=${token}`
        : `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+02665e(${longitude},${latitude})/${longitude},${latitude},14,0/${imgW}x${imgH}@2x?access_token=${token}`
      : null;

  function openMaps() {
    if (!hasCoords || isApproximate) return;
    const label = encodeURIComponent(address || "Property");
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?ll=${latitude},${longitude}&q=${label}`
        : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    Linking.openURL(url).catch(() => undefined);
  }

  return (
    <View style={styles.card}>
      {hasCoords ? (
        <Pressable
          accessibilityRole={isApproximate ? undefined : "button"}
          disabled={isApproximate}
          onPress={openMaps}
          style={[styles.mapWrap, { height: imgH }]}
        >
          {mapUrl ? (
            <Image source={{ uri: mapUrl }} style={styles.map} resizeMode="cover" />
          ) : (
            <View style={styles.placeholder}>
              <MapPin color={colors.primary} size={28} />
              <AppText variant="caption" tone="muted">
                {isApproximate ? "Approximate area" : "Tap to open in maps"}
              </AppText>
            </View>
          )}
          <View style={styles.openChip}>
            {isApproximate ? <MapPin color={colors.primary} size={13} /> : <ExternalLink color={colors.primary} size={13} />}
            <AppText variant="caption" weight="bold" tone="primary">
              {isApproximate ? "Approximate area" : "Open in maps"}
            </AppText>
          </View>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole={hasCoords && !isApproximate ? "button" : undefined}
        onPress={openMaps}
        disabled={!hasCoords || isApproximate}
        style={styles.addressRow}
      >
        <MapPin color={colors.primary} size={18} />
        <View style={styles.flex}>
          <AppText variant="bodySmall" tone="muted">
            {address || "Location shared after booking"}
          </AppText>
          {isApproximate ? (
            <AppText variant="caption" tone="soft">
              Exact directions are shared after booking{radiusMeters ? ` · shown within about ${Math.round(radiusMeters / 100) / 10} km` : ""}.
            </AppText>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: "hidden",
    ...shadows.card
  },
  mapWrap: {
    width: "100%",
    backgroundColor: colors.brand[50]
  },
  map: {
    width: "100%",
    height: "100%"
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    backgroundColor: colors.brand[50]
  },
  openChip: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.94)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  addressRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    padding: spacing[3]
  },
  flex: {
    flex: 1,
    minWidth: 0
  }
});
