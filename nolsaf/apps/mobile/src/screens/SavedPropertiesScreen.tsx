import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ArrowLeft, ChevronRight, Home, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { getPropertyCommission, priceWithCommission } from "../bookings/priceUtils";
import { fetchSystemCommission } from "../bookings/checkoutApi";
import { AmountText, AppText, CustomerBottomNav, SafeScreen, StateView } from "../components";
import { RootStackParamList } from "../navigation/types";
import { fetchSavedProperties, SavedPropertyItem, unsaveProperty } from "../properties";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "SavedProperties">;

export function SavedPropertiesScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [items, setItems] = useState<SavedPropertyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemCommission, setSystemCommission] = useState(0);

  useEffect(() => {
    fetchSystemCommission().then(setSystemCommission).catch(() => setSystemCommission(0));
  }, []);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!token) {
        setError("Please sign in to view your saved stays.");
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await fetchSavedProperties(token, { page: 1, pageSize: 50 });
        setItems(response.items || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load saved stays.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (id: number) => {
      if (!token) return;
      try {
        await unsaveProperty(token, id);
        setItems((prev) => prev.filter((p) => p.id !== id));
      } catch {
        // ignore - list will refresh on next load
      }
    },
    [token]
  );

  return (
    <View style={styles.root}>
      <SafeScreen scroll={false} padded={false} contentStyle={styles.flex}>
        <View style={styles.headerWrap}>
          <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
          <View style={styles.headerTextWrap}>
            <AppText variant="title" weight="bold" style={styles.centerText}>
              Saved
            </AppText>
            <AppText variant="bodySmall" tone="muted" style={styles.centerText}>
              Saved stays, tours, and useful places.
            </AppText>
          </View>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="bodySmall" tone="muted">
              Loading your saved stays...
            </AppText>
          </View>
        ) : error ? (
          <View style={styles.stateWrap}>
            <StateView title="Could not load saved stays" message={error} actionLabel="Try again" onAction={() => load()} />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(p) => String(p.id)}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} colors={[colors.primary]} />
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate("PropertyDetail", { id: item.id, title: item.title })}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={styles.imageWrap}>
                  {item.primaryImage ? (
                    <Image source={{ uri: item.primaryImage }} style={styles.image} resizeMode="cover" />
                  ) : (
                    <View style={styles.placeholder}>
                      <Home color={colors.primary} size={22} />
                    </View>
                  )}
                </View>
                <View style={styles.cardBody}>
                  <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                    {item.title}
                  </AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {item.location}
                  </AppText>
                  {item.basePrice != null ? (
                    <AmountText
                      amount={priceWithCommission(item.basePrice, getPropertyCommission(item.services, systemCommission))}
                      currency={item.currency || "TZS"}
                      variant="bodySmall"
                      weight="bold"
                      tone="primary"
                    />
                  ) : null}
                </View>
                <Pressable accessibilityRole="button" onPress={() => remove(item.id)} style={styles.removeButton}>
                  <Trash2 color={colors.danger} size={16} />
                </Pressable>
                <ChevronRight color={colors.softText} size={16} />
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.stateWrap}>
                <StateView
                  title="Nothing saved yet"
                  message="Tap the bookmark on a stay, tour, or place to keep it here for later."
                  actionLabel="Browse stays"
                  onAction={() => navigation.navigate("VerifiedStays")}
                />
              </View>
            }
          />
        )}
      </SafeScreen>

      <CustomerBottomNav active="Account" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  headerWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[2], alignItems: "center", gap: spacing[3] },
  backButton: {
    alignSelf: "flex-start",
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  headerTextWrap: { alignItems: "center", gap: spacing[1] },
  centerText: { textAlign: "center" },
  loading: { alignItems: "center", justifyContent: "center", gap: spacing[3], padding: spacing[6] },
  stateWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[5] },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: spacing[10] },
  sep: { height: spacing[3] },
  card: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3],
    ...shadows.card
  },
  cardPressed: { opacity: 0.85 },
  imageWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.brand[50]
  },
  image: { width: "100%", height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, minWidth: 0, gap: spacing[1] },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  }
});
