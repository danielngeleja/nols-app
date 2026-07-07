import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { ArrowLeft, Ban, ChevronRight, MapPin } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { CancellationListItem, cancellationStatusMeta, fetchCancellations } from "../cancellations";
import { AppCard, AppStack, AppText, CodeText, SafeScreen, StateView } from "../components";
import { getErrorMessage } from "../lib/apiClient";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "MyCancellations">;

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function MyCancellationsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [items, setItems] = useState<CancellationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("Please sign in to view your cancellation claims.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCancellations(token);
      setItems(res.items || []);
    } catch (e) {
      setError(getErrorMessage(e, "Could not load your cancellation claims."));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <SafeScreen contentStyle={styles.body}>
      <View style={styles.hero}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.heroBack}>
          <ArrowLeft color={colors.white} size={20} />
        </Pressable>
        <View style={styles.heroIconWrap}>
          <Ban color={colors.white} size={24} />
        </View>
        <View style={styles.heroTitleRow}>
          <AppText variant="headline" weight="extraBold" tone="inverse">
            Cancellation claims
          </AppText>
          {items.length > 0 ? (
            <View style={styles.heroCount}>
              <View style={styles.heroCountDot} />
              <AppText variant="caption" weight="extraBold" tone="inverse">
                {items.length} {items.length === 1 ? "claim" : "claims"}
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="bodySmall" style={styles.heroSubtitle}>
          Track your submitted requests, refunds, and messages with the NoLSAF team.
        </AppText>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <StateView title="Could not load" message={error} actionLabel="Try again" onAction={load} />
      ) : items.length === 0 ? (
        <StateView
          title="No claims yet"
          message="When you request a booking cancellation, it will appear here so you can follow its progress."
        />
      ) : (
        <AppStack gap={3}>
          {items.map((item) => {
            const meta = cancellationStatusMeta(item.status);
            const title = item.booking?.property?.title || "NoLSAF stay";
            const area = [item.booking?.property?.regionName, item.booking?.property?.district, item.booking?.property?.city]
              .filter(Boolean)
              .join(", ");
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => navigation.navigate("CancellationDetail", { id: item.id })}
                style={({ pressed }) => [pressed && styles.pressed]}
              >
                <AppCard>
                  <AppStack gap={3}>
                    <View style={styles.topRow}>
                      <View style={[styles.idBadge, { backgroundColor: meta.tint }]}>
                        <AppText variant="caption" weight="extraBold" style={{ color: meta.color }}>
                          #{item.id}
                        </AppText>
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
                          {title}
                        </AppText>
                        {area ? (
                          <View style={styles.metaRow}>
                            <MapPin color={colors.softText} size={12} />
                            <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>
                              {area}
                            </AppText>
                          </View>
                        ) : null}
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: meta.tint }]}>
                        <AppText variant="caption" weight="bold" style={{ color: meta.color, textTransform: "uppercase" }}>
                          {meta.label}
                        </AppText>
                      </View>
                    </View>
                    <View style={styles.footer}>
                      <CodeText value={item.bookingCode} />
                      <View style={styles.footerRight}>
                        {formatDate(item.createdAt) ? (
                          <AppText variant="caption" tone="soft">
                            {formatDate(item.createdAt)}
                          </AppText>
                        ) : null}
                        <ChevronRight color={colors.softText} size={16} />
                      </View>
                    </View>
                  </AppStack>
                </AppCard>
              </Pressable>
            );
          })}
        </AppStack>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { gap: spacing[4], paddingBottom: spacing[8] },
  hero: {
    alignItems: "center",
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[6],
    paddingBottom: spacing[6],
    overflow: "hidden"
  },
  heroBack: {
    position: "absolute",
    top: spacing[3],
    left: spacing[3],
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)"
  },
  heroIconWrap: {
    width: 54,
    height: 54,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    marginBottom: spacing[3]
  },
  heroTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: spacing[2] },
  heroCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  heroCountDot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.brand[300] },
  heroSubtitle: { color: colors.brand[200], textAlign: "center", marginTop: spacing[2] },
  center: { paddingVertical: spacing[8], alignItems: "center" },
  pressed: { opacity: 0.78 },
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  idBadge: {
    minWidth: 44,
    height: 36,
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center"
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing[1], minWidth: 0 },
  statusPill: { borderRadius: radius.full, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[3]
  },
  footerRight: { flexDirection: "row", alignItems: "center", gap: spacing[2] }
});
