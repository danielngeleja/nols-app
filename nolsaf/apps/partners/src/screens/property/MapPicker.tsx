import { AppText, colors, radius, spacing } from "@nolsaf/native-ui";
import MapboxGL from "@rnmapbox/maps";
import * as Location from "expo-location";
import { MapPin, Navigation2, PenLine } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "");

const TZ_CENTER: [number, number] = [34.8888, -6.3690];

type Props = {
  latitude: string;
  longitude: string;
  onChange: (lat: string, lng: string) => void;
};

export function MapPicker({ latitude, longitude, onChange }: Props) {
  const camera  = useRef<any>(null);
  const [locating, setLocating] = useState(false);

  // Local mirror — lets user type freely; committed on blur if valid
  const [localLat, setLocalLat] = useState(latitude);
  const [localLng, setLocalLng] = useState(longitude);

  // Keep local state in sync when map tap / GPS updates the parent
  useEffect(() => { setLocalLat(latitude); }, [latitude]);
  useEffect(() => { setLocalLng(longitude); }, [longitude]);

  const hasPin = latitude !== "" && longitude !== "" &&
    !isNaN(Number(latitude)) && !isNaN(Number(longitude));

  const pinCoord: [number, number] | null = hasPin
    ? [parseFloat(longitude), parseFloat(latitude)]
    : null;

  const placePin = (lng: number, lat: number) => {
    onChange(lat.toFixed(6), lng.toFixed(6));
  };

  const commitManual = () => {
    const lat = parseFloat(localLat);
    const lng = parseFloat(localLng);
    if (isNaN(lat) || isNaN(lng)) return;
    onChange(localLat, localLng);
    camera.current?.setCamera({
      centerCoordinate: [lng, lat],
      zoomLevel: 15,
      animationDuration: 500,
    });
  };

  useEffect(() => {
    if (pinCoord) {
      camera.current?.setCamera({
        centerCoordinate: pinCoord,
        zoomLevel: 15,
        animationDuration: 0,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLocate = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      placePin(pos.coords.longitude, pos.coords.latitude);
      camera.current?.setCamera({
        centerCoordinate: [pos.coords.longitude, pos.coords.latitude],
        zoomLevel: 16,
        animationDuration: 600,
      });
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={styles.wrap}>

      {/* ── Map — native only (Mapbox has no web renderer) ── */}
      {Platform.OS !== "web" && <View style={styles.mapContainer}>
        <MapboxGL.MapView
          style={styles.map}
          styleURL={MapboxGL.StyleURL.Street}
          attributionEnabled={false}
          logoEnabled={false}
          onPress={(e: any) => {
            const coords = (e.geometry as unknown as { coordinates: [number, number] }).coordinates;
            placePin(coords[0], coords[1]);
          }}
        >
          <MapboxGL.Camera
            ref={camera}
            zoomLevel={5}
            centerCoordinate={pinCoord ?? TZ_CENTER}
            animationMode="none"
          />
          {pinCoord ? (
            <MapboxGL.PointAnnotation
              id="property-pin"
              coordinate={pinCoord}
              draggable
              onDragEnd={(e: any) => {
                const [lng, lat] = e.geometry.coordinates as [number, number];
                placePin(lng, lat);
              }}
            >
              <View style={styles.pinWrap}>
                <MapPin size={30} color={colors.primary} fill={colors.primary} />
              </View>
              <MapboxGL.Callout title="Your property" />
            </MapboxGL.PointAnnotation>
          ) : null}
        </MapboxGL.MapView>

        {/* GPS button — floats inside map area */}
        <Pressable
          onPress={handleLocate}
          style={styles.gpsBtn}
          disabled={locating}
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
        >
          {locating
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Navigation2 size={18} color={colors.primary} />
          }
        </Pressable>

        {/* No-pin hint — stays within map bounds */}
        {!hasPin && (
          <View style={styles.hintOverlay} pointerEvents="none">
            <View style={styles.hintBubble}>
              <MapPin size={14} color={colors.white} />
              <AppText variant="caption" weight="medium" style={styles.hintText}>
                Tap map or use GPS to pin your property
              </AppText>
            </View>
          </View>
        )}
      </View>}

      {/* Web fallback — map not available */}
      {Platform.OS === "web" && (
        <View style={styles.webFallback}>
          <MapPin size={20} color={colors.softText} />
          <AppText variant="caption" tone="muted" style={{ textAlign: "center" }}>
            Interactive map available on the Android app.{"\n"}Use the fields below to enter coordinates manually.
          </AppText>
        </View>
      )}

      {/* ── Coordinate readout strip ── */}
      <View style={styles.readout}>
        {hasPin ? (
          <View style={styles.coordRow}>
            <View style={styles.coordChip}>
              <AppText variant="caption" style={styles.coordKey}>LAT</AppText>
              <AppText variant="caption" weight="medium">{latitude}</AppText>
            </View>
            <View style={styles.coordDivider} />
            <View style={styles.coordChip}>
              <AppText variant="caption" style={styles.coordKey}>LNG</AppText>
              <AppText variant="caption" weight="medium">{longitude}</AppText>
            </View>
          </View>
        ) : (
          <AppText variant="caption" tone="muted" style={styles.noCoord}>
            No location pinned yet
          </AppText>
        )}
      </View>

      {/* ── Manual entry ── */}
      <View style={styles.manualWrap}>
        <View style={styles.manualHeader}>
          <PenLine size={12} color={colors.softText} />
          <AppText variant="caption" style={styles.manualLabel}>
            Or enter coordinates manually
          </AppText>
        </View>
        <View style={styles.manualRow}>
          <View style={styles.manualField}>
            <AppText variant="caption" style={styles.fieldLabel}>Latitude</AppText>
            <TextInput
              style={styles.fieldInput}
              value={localLat}
              onChangeText={setLocalLat}
              onBlur={commitManual}
              placeholder="-3.3869"
              placeholderTextColor={colors.softText}
              keyboardType="decimal-pad"
              returnKeyType="next"
            />
          </View>
          <View style={styles.manualDivider} />
          <View style={styles.manualField}>
            <AppText variant="caption" style={styles.fieldLabel}>Longitude</AppText>
            <TextInput
              style={styles.fieldInput}
              value={localLng}
              onChangeText={setLocalLng}
              onBlur={commitManual}
              placeholder="36.6827"
              placeholderTextColor={colors.softText}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={commitManual}
            />
          </View>
        </View>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  mapContainer: {
    height: 230,
    overflow: "hidden",
  },
  webFallback: {
    height: 100,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    backgroundColor: colors.surface,
  },
  map: { height: 230 },

  gpsBtn: {
    position: "absolute",
    top: spacing[3],
    right: spacing[3],
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pinWrap: { alignItems: "center", justifyContent: "center" },

  hintOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    bottom: 40,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: spacing[3],
  },
  hintBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
  },
  hintText: { color: colors.white },

  // Readout strip
  readout: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    minHeight: 38,
    justifyContent: "center",
  },
  coordRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  coordChip: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing[1] },
  coordKey: { color: colors.softText, fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  coordDivider: { width: 1, height: 14, backgroundColor: colors.border },
  noCoord: { textAlign: "center" },

  // Manual entry
  manualWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  manualHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  manualLabel: { color: colors.softText },
  manualRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  manualField: { flex: 1, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  manualDivider: { width: 1, height: 36, backgroundColor: colors.border },
  fieldLabel: { color: colors.softText, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, marginBottom: 2 },
  fieldInput: {
    fontSize: 13,
    color: colors.ink,
    padding: 0,
  },
});
