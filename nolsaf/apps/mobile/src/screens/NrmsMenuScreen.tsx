import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import {
  AlertTriangle,
  CheckCircle2,
  ChefHat,
  Clock3,
  Minus,
  Plus,
  ReceiptText,
  ShoppingBasket,
  UtensilsCrossed,
  Wine,
  XCircle
} from "lucide-react-native";

import { AppButton, AppCard, AppStack, AppText, SafeScreen, ScreenHeader } from "../components";
import { ApiError, getErrorMessage } from "../lib/apiClient";
import { RootStackParamList } from "../navigation/types";
import {
  fetchNrmsMenu,
  fetchNrmsOrder,
  NRMS_PAYMENT_METHODS,
  NrmsMenuData,
  NrmsMenuItem,
  NrmsOutlet,
  NrmsPaymentMethod,
  NrmsPublicOrder,
  placeNrmsOrder
} from "../nrms";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "NrmsMenu">;

/** Server caps (NRMS_QR_ORDERING.md section 6). Mirrored so the UI never builds a rejected order. */
const MAX_LINES = 20;
const MAX_QTY_PER_LINE = 20;
const MAX_NOTE = 200;
const STATUS_POLL_MS = 7000;

const PAYMENT_LABELS: Record<NrmsPaymentMethod, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile money",
  BANK: "Bank transfer",
  CARD: "Card",
  OTHER: "Other"
};

function isStayClosedError(error: unknown): boolean {
  return ((error as ApiError | undefined)?.payload as { code?: unknown } | undefined)?.code === "STAY_LINK_CLOSED";
}

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Categories in the outlet's configured order first, then anything left over. */
function orderedCategories(outlet: NrmsOutlet): Array<{ key: string; label: string; items: NrmsMenuItem[] }> {
  const buckets = new Map<string, NrmsMenuItem[]>();
  for (const item of outlet.menuItems) {
    const key = (item.category || "").trim() || "__other";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const configured = Array.isArray(outlet.categoryOrder) ? outlet.categoryOrder : [];
  const seen = new Set<string>();
  const sections: Array<{ key: string; label: string; items: NrmsMenuItem[] }> = [];

  for (const category of configured) {
    const key = String(category || "").trim();
    if (!key || seen.has(key)) continue;
    const items = buckets.get(key);
    if (!items?.length) continue;
    seen.add(key);
    sections.push({ key, label: key, items });
  }

  for (const [key, items] of buckets) {
    if (seen.has(key) || !items.length) continue;
    sections.push({ key, label: key === "__other" ? "More" : key, items });
  }

  return sections;
}

function statusCopy(status: string): { label: string; note: string } {
  switch (status) {
    case "PLACED":
      return { label: "Sent to the outlet", note: "Waiting for staff to accept your order." };
    case "CONFIRMED":
      return { label: "Accepted", note: "The outlet has your order." };
    case "PREPARING":
      return { label: "Being prepared", note: "Your order is being made now." };
    case "SERVING":
      return { label: "On the way", note: "Your order is being brought to you." };
    case "SERVED":
      return { label: "Served", note: "Enjoy." };
    case "CANCELLED":
      return { label: "Cancelled", note: "This order was cancelled by the outlet." };
    default:
      return { label: status, note: "" };
  }
}

export function NrmsMenuScreen({ navigation, route }: Props) {
  const token = String(route.params?.token || "").trim();
  const [menu, setMenu] = useState<NrmsMenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stayClosed, setStayClosed] = useState(false);
  const [activeOutletId, setActiveOutletId] = useState<number | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [note, setNote] = useState("");
  const [chargeToRoom, setChargeToRoom] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<NrmsPaymentMethod | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [order, setOrder] = useState<NrmsPublicOrder | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  // Absent `orderingEnabled` is treated as disabled: a preview token must never
  // surface a cart, and the server rejects the order anyway.
  const orderingEnabled = menu?.orderingEnabled === true;
  const roomChargeAvailable = orderingEnabled && menu?.roomChargeAvailable === true;

  const load = useCallback(() => {
    const generation = ++loadGeneration.current;
    if (!token) {
      setMenu(null);
      setLoading(false);
      setError("This menu link is not valid.");
      setStayClosed(false);
      return;
    }

    // A native-stack screen may remain mounted while another screen checks the
    // guest out. Remove every ordering affordance before the network response,
    // so stale room access is never displayed during refresh or after failure.
    setMenu(null);
    setActiveOutletId(null);
    setCartOpen(false);
    setPlaceError(null);
    setLoading(true);
    setError(null);
    setStayClosed(false);
    fetchNrmsMenu(token)
      .then((data) => {
        if (generation !== loadGeneration.current) return;
        setMenu(data);
        setActiveOutletId((current) => current ?? data.outlets[0]?.id ?? null);
      })
      .catch((err) => {
        if (generation !== loadGeneration.current) return;
        if (isStayClosedError(err)) {
          setQuantities({});
          setNote("");
          setChargeToRoom(false);
          setPaymentMethod(null);
          setStayClosed(true);
          setError("Room ordering ended when this stay was checked out.");
          return;
        }
        setError(getErrorMessage(err, "This menu could not be loaded right now."));
      })
      .finally(() => {
        if (generation === loadGeneration.current) setLoading(false);
      });
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        // Ignore a response that arrives after this screen loses focus. The
        // next focus starts a fresh, checkout-sensitive request.
        loadGeneration.current += 1;
      };
    }, [load])
  );

  useEffect(() => {
    if (roomChargeAvailable) setChargeToRoom(true);
  }, [roomChargeAvailable]);

  const activeOutlet = useMemo(
    () => menu?.outlets.find((outlet) => outlet.id === activeOutletId) ?? menu?.outlets[0] ?? null,
    [menu, activeOutletId]
  );

  // The API takes one outlet per order, so the cart is scoped to the outlet the
  // guest is browsing. Switching outlet keeps each basket separate.
  const cartLines = useMemo(() => {
    if (!activeOutlet) return [];
    return activeOutlet.menuItems
      .filter((item) => (quantities[item.id] ?? 0) > 0)
      .map((item) => ({ item, quantity: quantities[item.id] ?? 0 }));
  }, [activeOutlet, quantities]);

  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cartLines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const currency = activeOutlet?.currency || "TZS";

  function changeQty(itemId: number, delta: number) {
    setPlaceError(null);
    setQuantities((current) => {
      const next = { ...current };
      const value = (next[itemId] ?? 0) + delta;
      if (value <= 0) {
        delete next[itemId];
        return next;
      }
      if (value > MAX_QTY_PER_LINE) return current;
      const distinctLines = Object.keys(next).filter((key) => Number(key) !== itemId).length;
      if (!current[itemId] && distinctLines >= MAX_LINES) return current;
      next[itemId] = value;
      return next;
    });
  }

  async function submitOrder() {
    if (!activeOutlet || !cartLines.length) return;
    if (!chargeToRoom && !paymentMethod) {
      setPlaceError("Choose how you intend to pay before sending the order.");
      return;
    }
    setPlacing(true);
    setPlaceError(null);
    try {
      const response = await placeNrmsOrder(token, {
        outletId: activeOutlet.id,
        items: cartLines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
        note: note.trim() ? note.trim() : null,
        chargeToRoom,
        paymentMethod: chargeToRoom ? null : paymentMethod
      });
      setPublicCode(response.publicCode);
      setOrder(response.order);
      setQuantities({});
      setNote("");
      setCartOpen(false);
    } catch (err) {
      if (isStayClosedError(err)) {
        setMenu(null);
        setQuantities({});
        setCartOpen(false);
        setChargeToRoom(false);
        setStayClosed(true);
        setError("Room ordering ended when this stay was checked out.");
        return;
      }
      setPlaceError(getErrorMessage(err, "This order could not be sent. Please try again."));
    } finally {
      setPlacing(false);
    }
  }

  // Poll while the order is still moving. Stops on a terminal status so a
  // finished order does not keep the device awake on the network.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!publicCode || !order) return;
    if (order.status === "SERVED" || order.status === "CANCELLED") return;

    pollRef.current = setInterval(() => {
      fetchNrmsOrder(publicCode)
        .then((data) => setOrder(data.order))
        .catch(() => {});
    }, STATUS_POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [publicCode, order]);

  const heading = menu?.property.title || route.params?.title || "Menu";
  const pointLabel = menu?.point.label || "";

  return (
    // SafeScreen scrolls its children, so the cart bar sits outside it: inside, an
    // absolutely positioned bar anchors to the bottom of the content, not the screen.
    <View style={styles.screen}>
      <SafeScreen>
      <AppStack gap={4}>
        <ScreenHeader
          title={heading}
          subtitle={orderingEnabled && pointLabel ? `Ordering for ${pointLabel}` : "Live restaurant and bar menu"}
          onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
        />

        {loading ? (
          <AppCard style={styles.centerCard}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="bodySmall" tone="muted">
              Loading the menu
            </AppText>
          </AppCard>
        ) : error ? (
          <AppCard style={styles.centerCard}>
            <AlertTriangle color={colors.danger} size={22} />
            <AppText variant="bodySmall" weight="bold" style={styles.center}>
              {error}
            </AppText>
            <AppButton
              title={stayClosed ? "Back to property" : "Try again"}
              variant="secondary"
              onPress={stayClosed && navigation.canGoBack() ? () => navigation.goBack() : load}
            />
          </AppCard>
        ) : order ? (
          <OrderStatusView
            order={order}
            onBrowseAgain={() => {
              setOrder(null);
              setPublicCode(null);
            }}
          />
        ) : !menu?.outlets.length ? (
          <AppCard style={styles.centerCard}>
            <ChefHat color={colors.softText} size={22} />
            <AppText variant="bodySmall" tone="muted" style={styles.center}>
              This property has no outlet taking orders right now.
            </AppText>
          </AppCard>
        ) : (
          <>
            {!orderingEnabled ? (
              <View style={styles.previewBanner}>
                <UtensilsCrossed color={colors.primary} size={18} />
                <AppText variant="caption" tone="muted" style={styles.flex}>
                  Preview menu. Ordering opens once you are checked in, or scan the QR code in your room or at your table.
                </AppText>
              </View>
            ) : null}

            {menu.outlets.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.outletTabs}>
                {menu.outlets.map((outlet) => {
                  const active = outlet.id === activeOutlet?.id;
                  return (
                    <Pressable
                      key={outlet.id}
                      accessibilityRole="button"
                      onPress={() => setActiveOutletId(outlet.id)}
                      style={[styles.outletTab, active && styles.outletTabActive]}
                    >
                      {outlet.type === "BAR" ? (
                        <Wine color={active ? colors.white : colors.primary} size={16} />
                      ) : (
                        <UtensilsCrossed color={active ? colors.white : colors.primary} size={16} />
                      )}
                      <AppText variant="caption" weight="bold" tone={active ? "inverse" : "default"}>
                        {outlet.name}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {activeOutlet
              ? orderedCategories(activeOutlet).map((section) => (
                  <AppStack key={section.key} gap={2}>
                    <AppText variant="bodySmall" weight="extraBold" style={styles.sectionLabel}>
                      {section.label}
                    </AppText>
                    {section.items.map((item) => (
                      <MenuItemRow
                        key={item.id}
                        item={item}
                        currency={activeOutlet.currency}
                        quantity={quantities[item.id] ?? 0}
                        orderingEnabled={orderingEnabled}
                        onChange={(delta) => changeQty(item.id, delta)}
                      />
                    ))}
                  </AppStack>
                ))
              : null}
          </>
        )}
      </AppStack>
      </SafeScreen>

      {orderingEnabled && cartCount > 0 && !order ? (
        <Pressable accessibilityRole="button" onPress={() => setCartOpen(true)} style={styles.cartBar}>
          <ShoppingBasket color={colors.white} size={20} />
          <AppText variant="bodySmall" weight="bold" tone="inverse" style={styles.flex}>
            {cartCount} {cartCount === 1 ? "item" : "items"}
          </AppText>
          <AppText variant="bodySmall" weight="extraBold" tone="inverse">
            {money(cartTotal, currency)}
          </AppText>
        </Pressable>
      ) : null}

      <Modal visible={cartOpen} animationType="slide" transparent onRequestClose={() => setCartOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <AppText variant="titleSm" weight="bold" style={styles.flex}>
                Your order
              </AppText>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setCartOpen(false)}>
                <XCircle color={colors.ink} size={22} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
              {cartLines.map((line) => (
                <View key={line.item.id} style={styles.cartLine}>
                  <AppText variant="bodySmall" weight="bold" style={styles.flex} numberOfLines={2}>
                    {line.item.name}
                  </AppText>
                  <View style={styles.stepper}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove one ${line.item.name}`}
                      onPress={() => changeQty(line.item.id, -1)}
                      style={styles.stepperButton}
                    >
                      <Minus color={colors.white} size={14} />
                    </Pressable>
                    <AppText variant="caption" weight="bold" tone="inverse">
                      {line.quantity}
                    </AppText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add one ${line.item.name}`}
                      onPress={() => changeQty(line.item.id, 1)}
                      style={styles.stepperButton}
                    >
                      <Plus color={colors.white} size={14} />
                    </Pressable>
                  </View>
                  <AppText variant="bodySmall" weight="bold">
                    {money(line.item.price * line.quantity, currency)}
                  </AppText>
                </View>
              ))}

              <View style={styles.noteWrap}>
                <AppText variant="caption" weight="bold" tone="muted">
                  Note for the kitchen (optional)
                </AppText>
                <TextInput
                  value={note}
                  onChangeText={(value) => setNote(value.slice(0, MAX_NOTE))}
                  placeholder="No ice, extra chilli..."
                  placeholderTextColor={colors.softText}
                  multiline
                  style={styles.noteInput}
                />
                <AppText variant="caption" tone="soft" style={styles.noteCount}>
                  {note.length}/{MAX_NOTE}
                </AppText>
              </View>

              <AppStack gap={2}>
                <AppText variant="caption" weight="bold" tone="muted">
                  How you will pay
                </AppText>
                {roomChargeAvailable ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setChargeToRoom(true)}
                    style={[styles.payOption, chargeToRoom && styles.payOptionActive]}
                  >
                    <ReceiptText color={chargeToRoom ? colors.primary : colors.softText} size={18} />
                    <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                      Add to my room bill
                    </AppText>
                  </Pressable>
                ) : null}

                {NRMS_PAYMENT_METHODS.map((method) => {
                  const active = !chargeToRoom && paymentMethod === method;
                  return (
                    <Pressable
                      key={method}
                      accessibilityRole="button"
                      onPress={() => {
                        setChargeToRoom(false);
                        setPaymentMethod(method);
                      }}
                      style={[styles.payOption, active && styles.payOptionActive]}
                    >
                      <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                        Pay at the counter: {PAYMENT_LABELS[method]}
                      </AppText>
                    </Pressable>
                  );
                })}
                <AppText variant="caption" tone="soft">
                  Payment goes directly to the property. Staff confirm what you actually pay when they settle the order.
                </AppText>
              </AppStack>

              {placeError ? (
                <AppText variant="caption" tone="danger">
                  {placeError}
                </AppText>
              ) : null}
            </ScrollView>

            <View style={styles.sheetFooter}>
              <View style={styles.flex}>
                <AppText variant="caption" tone="muted">
                  Total
                </AppText>
                <AppText variant="titleSm" weight="extraBold">
                  {money(cartTotal, currency)}
                </AppText>
              </View>
              <AppButton
                title="Send order"
                loading={placing}
                disabled={!cartLines.length}
                onPress={submitOrder}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MenuItemRow({
  item,
  currency,
  quantity,
  orderingEnabled,
  onChange
}: {
  item: NrmsMenuItem;
  currency: string;
  quantity: number;
  orderingEnabled: boolean;
  onChange: (delta: number) => void;
}) {
  const unavailable = !item.inStock;

  return (
    <View style={[styles.itemRow, unavailable && styles.itemRowMuted]}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.itemImage} resizeMode="cover" />
      ) : (
        <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
          <ChefHat color={colors.softText} size={18} />
        </View>
      )}
      <View style={styles.flex}>
        <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
          {item.name}
        </AppText>
        {item.description ? (
          <AppText variant="caption" tone="muted" numberOfLines={2}>
            {item.description}
          </AppText>
        ) : null}
        <AppText variant="bodySmall" weight="extraBold" tone="primary" style={styles.itemPrice}>
          {money(item.price, currency)}
        </AppText>
      </View>

      {unavailable ? (
        <View style={styles.unavailablePill}>
          <AppText variant="caption" weight="bold" tone="soft">
            Not available today
          </AppText>
        </View>
      ) : !orderingEnabled ? null : quantity === 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${item.name}`}
          onPress={() => onChange(1)}
          style={styles.addButton}
        >
          <Plus color={colors.primary} size={14} />
          <AppText variant="caption" weight="bold" tone="primary">
            Add
          </AppText>
        </Pressable>
      ) : (
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove one ${item.name}`}
            onPress={() => onChange(-1)}
            style={styles.stepperButton}
          >
            <Minus color={colors.white} size={14} />
          </Pressable>
          <AppText variant="caption" weight="bold" tone="inverse">
            {quantity}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add one ${item.name}`}
            onPress={() => onChange(1)}
            style={styles.stepperButton}
          >
            <Plus color={colors.white} size={14} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function OrderStatusView({ order, onBrowseAgain }: { order: NrmsPublicOrder; onBrowseAgain: () => void }) {
  const copy = statusCopy(order.status);
  const cancelled = order.status === "CANCELLED";
  const served = order.status === "SERVED";

  return (
    <AppStack gap={3}>
      <AppCard style={styles.statusCard}>
        <View style={styles.statusIcon}>
          {cancelled ? (
            <XCircle color={colors.danger} size={26} />
          ) : served ? (
            <CheckCircle2 color={colors.success} size={26} />
          ) : (
            <Clock3 color={colors.primary} size={26} />
          )}
        </View>
        <AppText variant="titleSm" weight="extraBold" style={styles.center}>
          {copy.label}
        </AppText>
        {copy.note ? (
          <AppText variant="bodySmall" tone="muted" style={styles.center}>
            {copy.note}
          </AppText>
        ) : null}
        <AppText variant="caption" tone="soft">
          Order {order.orderNumber}
          {order.point?.label ? ` · ${order.point.label}` : ""}
        </AppText>
      </AppCard>

      <AppCard>
        <AppStack gap={2}>
          {order.items.map((line, index) => (
            <View key={`${line.name}-${index}`} style={styles.statusLine}>
              <AppText variant="bodySmall" style={styles.flex} numberOfLines={2}>
                {line.quantity} x {line.name}
              </AppText>
              <AppText variant="bodySmall" weight="bold">
                {money(line.lineTotal, order.currency)}
              </AppText>
            </View>
          ))}
          <View style={styles.statusTotal}>
            <AppText variant="bodySmall" weight="bold" style={styles.flex}>
              Total
            </AppText>
            <AppText variant="bodySmall" weight="extraBold">
              {money(order.total, order.currency)}
            </AppText>
          </View>
          {order.note ? (
            <AppText variant="caption" tone="muted">
              Note: {order.note}
            </AppText>
          ) : null}
        </AppStack>
      </AppCard>

      <AppButton title="Back to the menu" variant="secondary" onPress={onBrowseAgain} />
    </AppStack>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  center: {
    textAlign: "center"
  },
  centerCard: {
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[8]
  },
  previewBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[3]
  },
  outletTabs: {
    gap: spacing[2],
    paddingRight: spacing[4]
  },
  outletTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2]
  },
  outletTabActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary
  },
  sectionLabel: {
    marginTop: spacing[2]
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  itemRowMuted: {
    opacity: 0.6
  },
  itemImage: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface
  },
  itemImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center"
  },
  itemPrice: {
    marginTop: spacing[1]
  },
  unavailablePill: {
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[200],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1]
  },
  stepperButton: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center"
  },
  cartBar: {
    position: "absolute",
    left: spacing[4],
    right: spacing[4],
    bottom: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4]
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.45)"
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[5]
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingBottom: spacing[3]
  },
  sheetBody: {
    gap: spacing[4],
    paddingBottom: spacing[4]
  },
  cartLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  noteWrap: {
    gap: spacing[2]
  },
  noteInput: {
    minHeight: 72,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    color: colors.ink,
    textAlignVertical: "top"
  },
  noteCount: {
    textAlign: "right"
  },
  payOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  payOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.brand[50]
  },
  sheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderStyle: "solid",
    paddingTop: spacing[3]
  },
  statusCard: {
    alignItems: "center",
    gap: spacing[2]
  },
  statusIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  statusTotal: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderStyle: "solid",
    paddingTop: spacing[2]
  }
});
