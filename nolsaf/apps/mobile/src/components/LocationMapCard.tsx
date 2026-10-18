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
 * no live GL rendering) so there is no battery drain or device heat. Exact
 * locations can open the native maps app; private homes show only an area.
 */
export function LocationMapCard({ latitude, longitude, address, precision, radiusMeters }: LocationMapCardProps) {
  const { width } = useWindowDimensions();
  const hasCoords = typeof latitude === "number" && Number.isFinite(latitude) && typeof longitude === "number" && Number.isFinite(longitude);
  // Older API responses without a precision flag must not become exact pins.
  const approximate = precision !== "EXACT";
  const radius = typeof radiusMeters === "number" && Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : 500;
  const token = env.mapboxToken;

  const imgW = Math.min(640, Math.round(width - spacing[4] * 2));
  const imgH = 170;
  const latitudeCosine = hasCoords ? Math.max(0.2, Math.cos(((latitude ?? 0) * Math.PI) / 180)) : 1;
  const zoom = approximate
    ? Number(Math.max(11, Math.min(15, Math.log2((40_075_016.686 * latitudeCosine * imgH * 0.3) / (512 * radius)))).toFixed(1))
    : 14;
  const metresPerPixel = (40_075_016.686 * latitudeCosine) / (512 * 2 ** zoom);
  const circleSize = Math.round((2 * radius) / metresPerPixel);
  const pin = hasCoords && !approximate ? `pin-l+02665e(${longitude},${latitude})/` : "";
  const mapUrl =
    hasCoords && token
      ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pin}${longitude},${latitude},${zoom},0/${imgW}x${imgH}@2x?access_token=${token}`
      : null;

  function openMaps() {
    if (!hasCoords || approximate) return;
    const label = encodeURIComponent(address || "Property");
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?ll=${latitude},${longitude}&q=${label}`
        : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    Linking.openURL(url).catch(() => undefined);
  }

  const mapVisual = (
    <>
      {mapUrl ? (
        <Image source={{ uri: mapUrl }} style={styles.map} resizeMode="cover" />
      ) : (
        <View style={styles.placeholder}>
          <MapPin color={colors.primary} size={28} />
          <AppText variant="caption" tone="muted">
            {approximate ? "Approximate location" : "Tap to open in maps"}
          </AppText>
        </View>
      )}
      {approximate ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.approximateCircle, {
              width: circleSize,
              height: circleSize,
              borderRadius: circleSize / 2,
              marginLeft: -circleSize / 2,
              marginTop: -circleSize / 2
            }]}
          />
          <View style={styles.areaChip}>
            <AppText variant="caption" weight="bold" tone="primary">Approximate area</AppText>
          </View>
        </>
      ) : (
        <View style={styles.openChip}>
          <ExternalLink color={colors.primary} size={13} />
          <AppText variant="caption" weight="bold" tone="primary">Open in maps</AppText>
        </View>
      )}
    </>
  );

  return (
    <View style={styles.card}>
      {hasCoords ? (
        approximate ? (
          <View style={[styles.mapWrap, { height: imgH }]}>{mapVisual}</View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Open exact location in maps" onPress={openMaps} style={[styles.mapWrap, { height: imgH }]}>
            {mapVisual}
          </Pressable>
        )
      ) : null}

      {approximate ? (
        <View style={styles.addressRow}>
          <MapPin color={colors.primary} size={18} />
          <View style={styles.flex}>
            <AppText variant="bodySmall" tone="muted">{address || "General area shown"}</AppText>
            <AppText variant="caption" tone="muted">Exact address shared after booking is confirmed.</AppText>
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={openMaps} disabled={!hasCoords} style={styles.addressRow}>
          <MapPin color={colors.primary} size={18} />
          <AppText variant="bodySmall" tone="muted" style={styles.flex}>
            {address || "Location unavailable"}
          </AppText>
        </Pressable>
      )}
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
  approximateCircle: {
    position: "absolute",
    left: "50%",
    top: "50%",
    borderWidth: 2,
    borderColor: "rgba(2,102,94,0.65)",
    backgroundColor: "rgba(2,102,94,0.18)"
  },
  areaChip: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.94)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
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
