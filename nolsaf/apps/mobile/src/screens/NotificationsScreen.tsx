import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ArrowLeft, Bell, CheckCheck, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { AppText, CustomerBottomNav, SafeScreen, StateView } from "../components";
import { RootStackParamList } from "../navigation/types";
import {
  deleteCustomerNotification,
  deleteCustomerReadNotifications,
  fetchCustomerNotifications,
  markCustomerNotificationRead,
  NotificationItem
} from "../notifications";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;

type Tab = "unread" | "viewed";

function formatWhen(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function NotificationsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("unread");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [viewedCount, setViewedCount] = useState(0);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!token) {
        setError("Please sign in to view your notifications.");
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await fetchCustomerNotifications(token, { tab, page: 1, pageSize: 50 });
        setItems(response.items || []);
        if (tab === "unread") setUnreadCount(response.total ?? response.items?.length ?? 0);
        else setViewedCount(response.total ?? response.items?.length ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load notifications.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, tab]
  );

  const loadOtherCount = useCallback(async () => {
    if (!token) return;
    const otherTab = tab === "unread" ? "viewed" : "unread";
    try {
      const response = await fetchCustomerNotifications(token, { tab: otherTab, page: 1, pageSize: 1 });
      const count = response.total ?? 0;
      if (otherTab === "unread") setUnreadCount(count);
      else setViewedCount(count);
    } catch {
      // ignore - counts are best-effort
    }
  }, [token, tab]);

  useEffect(() => {
    void load();
    void loadOtherCount();
  }, [load, loadOtherCount]);

  const markRead = useCallback(
    async (id: NotificationItem["id"]) => {
      if (!token) return;
      try {
        await markCustomerNotificationRead(token, id);
        setItems((prev) => prev.filter((n) => n.id !== id));
        setUnreadCount((prev) => Math.max(0, prev - 1));
        setViewedCount((prev) => prev + 1);
      } catch {
        // ignore - list will refresh on next load
      }
    },
    [token]
  );

  const removeOne = useCallback(
    async (id: NotificationItem["id"]) => {
      if (!token) return;
      try {
        await deleteCustomerNotification(token, id);
        setItems((prev) => prev.filter((n) => n.id !== id));
        setViewedCount((prev) => Math.max(0, prev - 1));
      } catch {
        // ignore
      }
    },
    [token]
  );

  const clearRead = useCallback(async () => {
    if (!token) return;
    try {
      await deleteCustomerReadNotifications(token);
      setItems([]);
      setViewedCount(0);
    } catch {
      // ignore
    }
  }, [token]);

  return (
    <View style={styles.root}>
      <SafeScreen scroll={false} padded={false} contentStyle={styles.flex}>
        <View style={styles.headerWrap}>
          <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
          <View style={styles.headerTextWrap}>
            <AppText variant="title" weight="bold" style={styles.centerText}>
              Notifications
            </AppText>
            <AppText variant="bodySmall" tone="muted" style={styles.centerText}>
              Updates on your bookings, rides, payments and account.
            </AppText>
          </View>
        </View>

        <View style={styles.tabsRow}>
          <Pressable accessibilityRole="button" onPress={() => setTab("unread")} style={[styles.tab, tab === "unread" && styles.tabOn]}>
            <AppText variant="bodySmall" weight="bold" tone={tab === "unread" ? "inverse" : "muted"}>
              Unread
            </AppText>
            <View style={[styles.tabCount, tab === "unread" && styles.tabCountOn]}>
              <AppText variant="caption" weight="bold" tone={tab === "unread" ? "inverse" : "muted"}>
                {unreadCount}
              </AppText>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setTab("viewed")} style={[styles.tab, tab === "viewed" && styles.tabOn]}>
            <AppText variant="bodySmall" weight="bold" tone={tab === "viewed" ? "inverse" : "muted"}>
              Viewed
            </AppText>
            <View style={[styles.tabCount, tab === "viewed" && styles.tabCountOn]}>
              <AppText variant="caption" weight="bold" tone={tab === "viewed" ? "inverse" : "muted"}>
                {viewedCount}
              </AppText>
            </View>
          </Pressable>
          {tab === "viewed" && items.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={clearRead} style={styles.clearButton}>
              <Trash2 color={colors.danger} size={14} />
              <AppText variant="caption" weight="bold" style={{ color: colors.danger }}>
                Clear all
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="bodySmall" tone="muted">
              Loading notifications...
            </AppText>
          </View>
        ) : error ? (
          <View style={styles.stateWrap}>
            <StateView title="Could not load notifications" message={error} actionLabel="Try again" onAction={() => load()} />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(n) => String(n.id)}
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
                onPress={() => (tab === "unread" ? markRead(item.id) : undefined)}
                onLongPress={() => (tab === "viewed" ? removeOne(item.id) : undefined)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={[styles.cardIcon, item.unread && styles.cardIconUnread]}>
                  <Bell color={item.unread ? colors.primary : colors.softText} size={16} />
                </View>
                <View style={styles.cardBody}>
                  <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
                    {item.title}
                  </AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={3}>
                    {item.body}
                  </AppText>
                  <AppText variant="caption" tone="soft">
                    {formatWhen(item.createdAt)}
                  </AppText>
                </View>
                {tab === "unread" ? <CheckCheck color={colors.brand[300]} size={16} /> : null}
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.stateWrap}>
                <StateView
                  title={tab === "unread" ? "You're all caught up" : "Nothing here yet"}
                  message={
                    tab === "unread"
                      ? "New updates about your bookings, rides and payments will show up here."
                      : "Notifications you have read will appear in this tab."
                  }
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
  headerWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[4], alignItems: "center", gap: spacing[3] },
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
  tabsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabCount: {
    minWidth: 22,
    alignItems: "center",
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[1]
  },
  tabCountOn: { backgroundColor: "rgba(255,255,255,0.22)" },
  clearButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  loading: { alignItems: "center", justifyContent: "center", gap: spacing[3], padding: spacing[6] },
  stateWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[5] },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing[4], paddingBottom: spacing[10] },
  sep: { height: spacing[3] },
  card: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3],
    ...shadows.card
  },
  cardPressed: { opacity: 0.85 },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  },
  cardIconUnread: { backgroundColor: colors.brand[50] },
  cardBody: { flex: 1, minWidth: 0, gap: spacing[1] }
});
