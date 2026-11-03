import { AmountText, AppButton, AppStack, AppText, colors, radius, shadows, spacing } from "@nolsaf/native-ui";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { Car, CheckCircle2, Clock, MapPin, Sparkles, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet, Vibration, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TripOffer } from "../driver/types";

type TripOfferModalProps = {
  offer: TripOffer | null;
  loading: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onExpire: () => void;
};

function getVehicleLabel(type?: string | null) {
  if (!type) return "Vehicle";
  if (type === "PREMIUM") return "VIP";
  return type;
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function TripOfferModal({ offer, loading, onAccept, onDecline, onExpire }: TripOfferModalProps) {
  const [remainingMs, setRemainingMs] = useState(0);
  const [initialMs, setInitialMs] = useState(1);
  const insets = useSafeAreaInsets();
  const player = useAudioPlayer(require("../../assets/sounds/trip-offer.wav"));

  useEffect(() => {
    if (!offer) return;
    const expiresAt = new Date(offer.offer.expiresAt).getTime();
    setInitialMs(Math.max(1, expiresAt - Date.now()));

    const tick = () => {
      const left = expiresAt - Date.now();
      setRemainingMs(left);
      if (left <= 0) onExpire();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [offer, onExpire]);

  useEffect(() => {
    if (!offer) return;

    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "duckOthers" });
    player.loop = true;
    player.seekTo(0);
    player.play();
    Vibration.vibrate([0, 500, 1000], true);

    return () => {
      player.pause();
      player.seekTo(0);
      Vibration.cancel();
    };
  }, [offer, player]);

  if (!offer) return null;

  const progress = Math.max(0, Math.min(1, remainingMs / initialMs));
  const isUrgent = remainingMs <= 30000;
  const accentColor = isUrgent ? colors.danger : colors.warning;
  const badgeBackground = isUrgent ? "#fef2f2" : "#fffbeb";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!loading) onDecline(); }}>
      <ScrollView style={styles.overlay} contentContainerStyle={[styles.overlayContent, { paddingTop: Math.max(insets.top, spacing[4]), paddingBottom: Math.max(insets.bottom, spacing[4]) }]}>
        <View style={styles.sheet}>
          <AppStack gap={4}>
            <View style={styles.headerRow}>
              <View style={styles.titleGroup}>
                <View style={styles.titleIconBubble}>
                  <Sparkles color={colors.primary} size={20} />
                </View>
                <View style={styles.titleTextColumn}>
                  <AppText variant="bodySmall" weight="bold">
                    New trip nearby!
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    A rider is waiting
                  </AppText>
                </View>
              </View>
              <View style={[styles.countdownBadge, { backgroundColor: badgeBackground }]}>
                <Clock color={accentColor} size={12} />
                <AppText variant="caption" weight="bold" style={{ color: accentColor }}>
                  {formatCountdown(remainingMs)}
                </AppText>
              </View>
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: accentColor }]} />
            </View>

            {offer.amount != null ? (
              <View style={styles.earningsCard}>
                <AppText variant="caption" tone="muted">
                  Total fare
                </AppText>
                <AmountText amount={offer.amount} currency={offer.currency || "TZS"} variant="display" weight="extraBold" />
                <View style={styles.chipsRow}>
                  <View style={styles.metaChip}>
                    <View style={styles.metaChipIcon}>
                      <Car color={colors.primary} size={12} />
                    </View>
                    <AppText variant="caption" weight="medium">
                      {getVehicleLabel(offer.vehicleType)}
                    </AppText>
                  </View>
                  {offer.offer?.radiusKm != null ? (
                    <View style={styles.metaChip}>
                      <View style={styles.metaChipIcon}>
                        <MapPin color={colors.primary} size={12} />
                      </View>
                      <AppText variant="caption" weight="medium">
                        within {offer.offer.radiusKm} km
                      </AppText>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={styles.routeCard}>
              <View style={styles.routeRow}>
                <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                <View style={styles.routeTextColumn}>
                  <AppText variant="caption" tone="muted">
                    Pickup
                  </AppText>
                  <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                    {offer.fromAddress || "Pickup location"}
                  </AppText>
                </View>
              </View>

              <View style={styles.routeLineRow}>
                <View style={styles.routeLine} />
              </View>

              <View style={styles.routeRow}>
                <View style={[styles.dot, { backgroundColor: colors.danger }]} />
                <View style={styles.routeTextColumn}>
                  <AppText variant="caption" tone="muted">
                    Drop-off
                  </AppText>
                  <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                    {offer.toAddress || "Drop-off location"}
                  </AppText>
                </View>
              </View>
            </View>

            <AppStack gap={2}>
              <AppButton title="Accept trip" icon={<CheckCircle2 color={colors.white} size={18} />} onPress={onAccept} loading={loading} />
              <AppButton title="Decline" icon={<X color={colors.ink} size={18} />} variant="ghost" onPress={onDecline} disabled={loading} />
            </AppStack>
          </AppStack>
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.5)"
  },
  overlayContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing[4]
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    padding: spacing[4],
    ...shadows.sheet
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  titleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    flex: 1
  },
  titleIconBubble: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center"
  },
  titleTextColumn: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  progressTrack: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    overflow: "hidden"
  },
  progressFill: {
    height: 4
  },
  countdownBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: radius.full
  },
  earningsCard: {
    alignItems: "center",
    gap: spacing[1],
    backgroundColor: colors.brand[50],
    borderRadius: radius.lg,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[3]
  },
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    marginTop: spacing[2]
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: radius.full
  },
  metaChipIcon: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: colors.brand[100],
    alignItems: "center",
    justifyContent: "center"
  },
  routeCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  routeLineRow: {
    paddingLeft: 3
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full
  },
  routeLine: {
    width: 2,
    height: 16,
    marginVertical: 2,
    backgroundColor: colors.border
  },
  routeTextColumn: {
    flex: 1,
    minWidth: 0,
    gap: 1
  }
});
