import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Banknote, Calendar, ChevronDown, ChevronUp, Clock3, FileText, MapPin, MessageCircle, Send, Sparkles, Users } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { useAuth } from "../auth";
import { AppButton, AppCard, AppInput, AppStack, AppText, SafeScreen, ScreenHeader, StateView, StatusBadge } from "../components";
import { apiBaseUrl } from "../lib/apiClient";
import {
  ACCOMMODATION_TYPE_OPTIONS,
  ARRANGEMENT_OPTIONS,
  AuctionOffer,
  confirmAuctionOffer,
  fetchAuctionOffers,
  fetchGroupBookingById,
  fetchGroupBookingDepositReceiptToken,
  fetchGroupStayMessages,
  GROUP_TYPE_OPTIONS,
  GroupBookingDetail,
  GroupBookingMessage,
  HOTEL_STAR_OPTIONS,
  ROOM_SIZE_OPTIONS,
  sendGroupStayMessage
} from "../groupStays";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "GroupStayDetail">;

function labelFor(options: { value: string; label: string }[], value?: string | null) {
  if (!value) return undefined;
  return options.find((o) => o.value === value)?.label || value;
}

function toBadgeStatus(status: string): "pending" | "approved" | "completed" | "cancelled" | "awaiting" {
  const s = status.toUpperCase();
  if (s === "AWAITING_DEPOSIT") return "awaiting";
  if (s === "CONFIRMED" || s === "PROCESSING") return "approved";
  if (s === "COMPLETED") return "completed";
  if (s === "CANCELED" || s === "CANCELLED" || s === "EXPIRED") return "cancelled";
  return "pending";
}

function badgeLabel(status: string): string | undefined {
  const s = status.toUpperCase();
  if (s === "AWAITING_DEPOSIT") return "Deposit due";
  if (s === "EXPIRED") return "Expired";
  return undefined;
}

function formatDueCountdown(ms: number): string {
  if (ms <= 0) return "Offer expired";
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `Expires in ${hours}h ${minutes}m`;
  return `Expires in ${minutes}m`;
}

function formatDateTime(iso?: string | null) {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatAmount(amount?: number | null, currency?: string | null) {
  if (!amount) return undefined;
  return `${Number(amount).toLocaleString()} ${currency || "TZS"}`;
}

function toTitleCase(value?: string | null) {
  if (!value) return undefined;
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.summaryRow}>
      <AppText variant="caption" tone="soft" style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="semiBold" numberOfLines={3} style={styles.summaryValue}>
        {value || "Not set"}
      </AppText>
    </View>
  );
}

const OFFER_CARD_GAP = spacing[3];

export function GroupStayDetailScreen({ navigation, route }: Props) {
  const { token } = useAuth();
  const { id } = route.params;
  const { width: windowWidth } = useWindowDimensions();
  const offerCardWidth = Math.min(windowWidth - spacing[4] * 4, 420);
  const [activeOfferIndex, setActiveOfferIndex] = useState(0);
  const [booking, setBooking] = useState<GroupBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupBookingMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [followUpText, setFollowUpText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [offers, setOffers] = useState<AuctionOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersLoaded, setOffersLoaded] = useState(false);
  const [offersExpanded, setOffersExpanded] = useState(false);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const downloadReceipt = useCallback(async () => {
    if (!token) return;
    setReceiptLoading(true);
    setReceiptError(null);
    try {
      const res = await fetchGroupBookingDepositReceiptToken(token, id);
      const url = `${apiBaseUrl()}/api/public/group-stays/receipt?token=${encodeURIComponent(res.token)}`;
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      setReceiptError(e instanceof Error ? e.message : "Could not open the receipt. Please try again.");
    } finally {
      setReceiptLoading(false);
    }
  }, [token, id]);

  const load = useCallback(async () => {
    if (!token) {
      setError("Please sign in to view this group stay request.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchGroupBookingById(token, id);
      setBooking(response.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load this group stay request.");
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  const loadMessages = useCallback(async () => {
    if (!token) return;
    setMessagesLoading(true);
    try {
      const response = await fetchGroupStayMessages(token, id);
      setMessages(response.messages || []);
    } catch {
      // Conversation history is best-effort; ignore failures.
    } finally {
      setMessagesLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    void load();
    void loadMessages();
  }, [load, loadMessages]);

  const loadOffers = useCallback(async () => {
    if (!token) return;
    setOffersLoading(true);
    setOffersError(null);
    try {
      const response = await fetchAuctionOffers(token, id);
      setOffers(response.offers || []);
      setOffersLoaded(true);
    } catch (e) {
      setOffersError(e instanceof Error ? e.message : "Failed to load offers.");
    } finally {
      setOffersLoading(false);
    }
  }, [token, id]);

  const handleOfferScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const interval = offerCardWidth + OFFER_CARD_GAP;
      const index = Math.round(event.nativeEvent.contentOffset.x / interval);
      setActiveOfferIndex(index);
    },
    [offerCardWidth]
  );

  const toggleOffers = useCallback(() => {
    setOffersExpanded((prev) => {
      const next = !prev;
      if (next && !offersLoaded && !offersLoading) {
        void loadOffers();
      }
      return next;
    });
  }, [offersLoaded, offersLoading, loadOffers]);

  const chooseOffer = useCallback(
    async (propertyId: number) => {
      if (!token) return;
      setConfirmingId(propertyId);
      setConfirmError(null);
      try {
        await confirmAuctionOffer(token, id, propertyId);
        await load();
        await loadOffers();
      } catch (e) {
        setConfirmError(e instanceof Error ? e.message : "Failed to confirm this offer.");
      } finally {
        setConfirmingId(null);
      }
    },
    [token, id, load, loadOffers]
  );

  const sendFollowUp = useCallback(
    async (text: string) => {
      if (!token || !text.trim()) return;
      setSending(true);
      setSendError(null);
      setSent(false);
      try {
        await sendGroupStayMessage(token, id, text.trim());
        setFollowUpText("");
        setSent(true);
        await loadMessages();
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "Failed to send your message.");
      } finally {
        setSending(false);
      }
    },
    [token, id, loadMessages]
  );

  const destination = booking ? [booking.toRegion, booking.toDistrict, booking.toWard].filter(Boolean).join(", ") : "";
  const origin = booking
    ? [booking.fromRegion, booking.fromDistrict, booking.fromWard, booking.fromLocation].filter(Boolean).join(", ") ||
      labelFor([{ value: "tanzania", label: "Tanzania" }], booking.fromCountry || undefined)
    : undefined;
  const offerCount = booking?.recommendedPropertyIds?.length || 0;
  const hasOffers = booking != null && Boolean(booking.isOpenForClaims) && offerCount > 0 && !booking.confirmedPropertyId;
  const amount = booking ? formatAmount(booking.totalAmount, booking.currency) : undefined;
  const isAwaitingDeposit = booking != null && booking.status.toUpperCase() === "AWAITING_DEPOSIT" && !booking.depositPaid;
  const depositLabel = booking ? formatAmount(booking.depositAmount, booking.currency) : undefined;
  const remainingLabel = booking
    ? formatAmount(Math.max(0, Number(booking.totalAmount || 0) - Number(booking.depositAmount || 0)), booking.currency)
    : undefined;
  const commissionPercent = booking?.commissionPercent != null ? Number(booking.commissionPercent) : null;
  const depositDueAt = booking?.depositDueAt ? new Date(booking.depositDueAt).getTime() : null;
  const msUntilDepositDue = depositDueAt ? depositDueAt - now : null;
  const genderBreakdown = booking
    ? [
        booking.maleCount ? `${booking.maleCount} male` : null,
        booking.femaleCount ? `${booking.femaleCount} female` : null,
        booking.otherCount ? `${booking.otherCount} other` : null
      ]
        .filter(Boolean)
        .join(", ")
    : undefined;

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
          <ScreenHeader title={destination || "Group stay request"} subtitle="Track the status and details of this request." onBack={() => navigation.goBack()} />

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="bodySmall" tone="muted">
                Loading request details...
              </AppText>
            </View>
          ) : error ? (
            <StateView title="Could not load this request" message={error} actionLabel="Try again" onAction={load} />
          ) : booking ? (
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              <AppStack gap={3}>
                <View style={styles.statusRow}>
                  <StatusBadge status={toBadgeStatus(booking.status)} label={badgeLabel(booking.status)} />
                  <AppText variant="caption" tone="muted">
                    Requested {formatDateTime(booking.createdAt)}
                  </AppText>
                </View>

                {isAwaitingDeposit ? (
                  <AppCard style={styles.depositCard}>
                    <AppStack gap={2}>
                      <View style={styles.depositHeaderRow}>
                        <View style={styles.depositIconWrap}>
                          <Banknote color="#b45309" size={18} />
                        </View>
                        <View style={styles.flex}>
                          <AppText variant="bodySmall" weight="extraBold" style={styles.depositText}>
                            Deposit required to confirm
                          </AppText>
                          <AppText variant="caption" tone="muted">
                            You chose an offer. Pay the deposit below to lock in this property and dates.
                          </AppText>
                        </View>
                      </View>
                      <View style={styles.depositDivider} />
                      {amount ? (
                        <View style={styles.depositAmountRow}>
                          <AppText variant="caption" tone="muted">Total cost</AppText>
                          <AppText variant="bodySmall" weight="semiBold">{amount}</AppText>
                        </View>
                      ) : null}
                      <View style={styles.depositAmountRow}>
                        <AppText variant="caption" tone="muted">
                          Deposit due
                        </AppText>
                        {depositLabel ? (
                          <AppText variant="title" weight="bold" style={styles.depositText}>
                            {depositLabel}
                          </AppText>
                        ) : null}
                      </View>
                      {remainingLabel ? (
                        <View style={styles.depositAmountRow}>
                          <AppText variant="caption" tone="muted">Stay balance</AppText>
                          <AppText variant="bodySmall" weight="semiBold">{remainingLabel}</AppText>
                        </View>
                      ) : null}
                      {msUntilDepositDue != null ? (
                        <View style={styles.dueRow}>
                          <Clock3 color={msUntilDepositDue < 3 * 60 * 60 * 1000 ? colors.danger : "#b45309"} size={14} />
                          <AppText variant="caption" weight="bold" tone={msUntilDepositDue < 3 * 60 * 60 * 1000 ? "danger" : "muted"}>
                            {formatDueCountdown(msUntilDepositDue)}
                          </AppText>
                        </View>
                      ) : null}
                      <AppButton title="Pay deposit now" onPress={() => navigation.navigate("GroupStayDeposit", { id })} />
                    </AppStack>
                  </AppCard>
                ) : null}

                {booking.depositPaid ? (
                  <AppCard>
                    <AppStack gap={2}>
                      <View style={styles.depositHeaderRow}>
                        <View style={styles.depositIconWrap}>
                          <FileText color={colors.primary} size={18} />
                        </View>
                        <View style={styles.flex}>
                          <AppText variant="bodySmall" weight="extraBold">
                            Deposit receipt
                          </AppText>
                          <AppText variant="caption" tone="muted">
                            Download a PDF receipt for your deposit payment.
                          </AppText>
                        </View>
                      </View>
                      {receiptError ? (
                        <AppText variant="caption" tone="danger">
                          {receiptError}
                        </AppText>
                      ) : null}
                      <AppButton title="Download receipt" variant="secondary" loading={receiptLoading} onPress={downloadReceipt} />
                    </AppStack>
                  </AppCard>
                ) : null}

                {hasOffers ? (
                  <AppCard>
                    <AppStack gap={2}>
                      <Pressable accessibilityRole="button" onPress={toggleOffers} style={styles.offerBanner}>
                        <View style={styles.offerBannerIconWrap}>
                          <Sparkles color={colors.primary} size={18} />
                        </View>
                        <View style={styles.flex}>
                          <AppText variant="bodySmall" weight="extraBold" tone="primary">
                            {offerCount} {offerCount === 1 ? "property" : "properties"} responded with an offer
                          </AppText>
                          <AppText variant="caption" tone="muted">
                            {offersExpanded ? "Compare prices and amenities below" : "Tap to compare prices and choose your favorite"}
                          </AppText>
                        </View>
                        {offersExpanded ? (
                          <ChevronUp color={colors.primary} size={20} />
                        ) : (
                          <ChevronDown color={colors.primary} size={20} />
                        )}
                      </Pressable>

                      {offersExpanded ? (
                        offersLoading ? (
                          <View style={styles.loading}>
                            <ActivityIndicator color={colors.primary} />
                            <AppText variant="bodySmall" tone="muted">
                              Loading offers...
                            </AppText>
                          </View>
                        ) : offersError ? (
                          <AppText variant="caption" tone="danger">
                            {offersError}
                          </AppText>
                        ) : offers.length === 0 ? (
                          <AppText variant="bodySmall" tone="soft">
                            No offers available yet.
                          </AppText>
                        ) : (
                          <AppStack gap={2}>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              snapToInterval={offerCardWidth + OFFER_CARD_GAP}
                              decelerationRate="fast"
                              snapToAlignment="start"
                              onMomentumScrollEnd={handleOfferScroll}
                              contentContainerStyle={styles.offerScrollContent}
                              style={styles.offerScroll}
                            >
                            {(() => {
                              const totals = offers
                                .map((o) => Number(o.offer.customerTotalAmount ?? o.offer.totalAmount ?? 0))
                                .filter((n) => n > 0);
                              const bestTotal = totals.length > 0 ? Math.min(...totals) : null;

                              return offers.map((offer) => {
                                const offerLocation = [
                                  toTitleCase(offer.property.regionName),
                                  toTitleCase(offer.property.district),
                                  toTitleCase(offer.property.ward || offer.property.city)
                                ]
                                  .filter(Boolean)
                                  .join(", ");

                                const offeredPerNight = Number(offer.offer.customerPricePerNight ?? offer.offer.offeredPricePerNight ?? 0);
                                const discountPercent = Number(offer.offer.discountPercent || 0);
                                const total = Number(offer.offer.customerTotalAmount ?? offer.offer.totalAmount ?? 0);
                                const roomsNeeded = Math.max(1, Number(booking?.roomsNeeded || 1));
                                const hasDiscount = discountPercent > 0 && offeredPerNight > 0;
                                const customerOriginalPerNight = Number(offer.offer.customerOriginalPricePerNight ?? 0);
                                const originalPerNight = customerOriginalPerNight > 0 ? customerOriginalPerNight : (hasDiscount ? offeredPerNight / (1 - discountPercent / 100) : null);
                                const nights = offeredPerNight > 0 ? Math.round(total / offeredPerNight / roomsNeeded) : null;
                                const customerOriginalTotal = Number(offer.offer.customerOriginalTotalAmount ?? 0);
                                const originalTotal = customerOriginalTotal > 0 ? customerOriginalTotal : (hasDiscount && originalPerNight && nights ? originalPerNight * nights * roomsNeeded : null);
                                const customerSavings = Number(offer.offer.customerSavingsAmount ?? 0);
                                const savings = customerSavings > 0 ? customerSavings : (originalTotal && total ? originalTotal - total : null);

                                const pricePerNight = formatAmount(offeredPerNight, offer.offer.currency);
                                const originalPricePerNight = originalPerNight ? formatAmount(originalPerNight, offer.offer.currency) : undefined;
                                const totalLabel = formatAmount(total, offer.offer.currency);
                                const originalTotalLabel = originalTotal ? formatAmount(originalTotal, offer.offer.currency) : undefined;
                                const savingsLabel = savings ? formatAmount(savings, offer.offer.currency) : undefined;

                                const amenities = (offer.offer.specialOffers || "")
                                  .split(/[,\n]/)
                                  .map((s) => s.trim())
                                  .filter(Boolean);

                                const isBestPrice = bestTotal != null && total > 0 && total === bestTotal && offers.length > 1;
                                const confirming = confirmingId === offer.property.id;

                                return (
                                  <View key={offer.claimId} style={[styles.offerCard, { width: offerCardWidth }]}>
                                    <View style={styles.offerHeaderRow}>
                                      {offer.property.imageUrl ? (
                                        <Image source={{ uri: offer.property.imageUrl }} style={styles.offerImage} />
                                      ) : (
                                        <View style={[styles.offerImage, styles.offerImageEmpty]} />
                                      )}
                                      <View style={styles.flex}>
                                        <View style={styles.offerTitleRow}>
                                          <AppText variant="bodySmall" weight="bold" numberOfLines={2} style={styles.flex}>
                                            {offer.property.title}
                                          </AppText>
                                          {isBestPrice ? (
                                            <View style={styles.bestPriceBadge}>
                                              <AppText variant="caption" weight="bold" tone="success">
                                                Best price
                                              </AppText>
                                            </View>
                                          ) : null}
                                        </View>
                                        {offerLocation ? (
                                          <AppText variant="caption" tone="muted" numberOfLines={1}>
                                            {offerLocation}
                                          </AppText>
                                        ) : null}
                                      </View>
                                    </View>

                                    <View style={styles.offerPriceBlock}>
                                      <View style={styles.offerPriceTopRow}>
                                        <View style={styles.offerPriceMain}>
                                          {pricePerNight ? (
                                            <AppText variant="title" weight="bold" tone="primary">
                                              {pricePerNight}
                                            </AppText>
                                          ) : null}
                                          <AppText variant="caption" tone="muted">
                                            / night
                                          </AppText>
                                        </View>
                                        {hasDiscount ? (
                                          <View style={styles.discountBadge}>
                                            <AppText variant="caption" weight="bold" tone="inverse">
                                              -{discountPercent}% OFF
                                            </AppText>
                                          </View>
                                        ) : null}
                                      </View>

                                      {originalPricePerNight ? (
                                        <AppText variant="caption" tone="muted" style={styles.strikethrough}>
                                          Was {originalPricePerNight} / night
                                        </AppText>
                                      ) : null}

                                      <View style={styles.offerDivider} />

                                      <View style={styles.offerTotalRow}>
                                        <View style={styles.flex}>
                                          {totalLabel ? (
                                            <AppText variant="bodySmall" weight="semiBold">
                                              {totalLabel}
                                              {nights
                                                ? ` · ${nights} ${nights === 1 ? "night" : "nights"}${
                                                    roomsNeeded > 1 ? ` x ${roomsNeeded} rooms` : ""
                                                  }`
                                                : ""}
                                            </AppText>
                                          ) : null}
                                          {originalTotalLabel ? (
                                            <AppText variant="caption" tone="muted" style={styles.strikethrough}>
                                              {originalTotalLabel}
                                            </AppText>
                                          ) : null}
                                        </View>
                                        {savingsLabel ? (
                                          <View style={styles.savingsBadge}>
                                            <AppText variant="caption" weight="bold" tone="success">
                                              Save {savingsLabel}
                                            </AppText>
                                          </View>
                                        ) : null}
                                      </View>
                                    </View>

                                    {amenities.length > 0 ? (
                                      <ScrollView
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        style={styles.amenityScroll}
                                      >
                                        <View style={styles.amenityGrid}>
                                          {amenities.map((a, idx) => (
                                            <View key={`${offer.claimId}-${idx}`} style={styles.amenityChip}>
                                              <AppText variant="caption" tone="soft" numberOfLines={1}>
                                                {a}
                                              </AppText>
                                            </View>
                                          ))}
                                        </View>
                                      </ScrollView>
                                    ) : null}

                                    {offer.offer.notes ? (
                                      <AppText variant="caption" tone="soft">
                                        {offer.offer.notes}
                                      </AppText>
                                    ) : null}

                                    <AppButton
                                      title="Choose this offer"
                                      loading={confirming}
                                      disabled={confirmingId !== null && !confirming}
                                      onPress={() => chooseOffer(offer.property.id)}
                                    />
                                  </View>
                                );
                              });
                            })()}
                            </ScrollView>

                            {offers.length > 1 ? (
                              <View style={styles.offerDots}>
                                {offers.map((offer, idx) => (
                                  <View
                                    key={offer.claimId}
                                    style={[styles.offerDot, idx === activeOfferIndex && styles.offerDotActive]}
                                  />
                                ))}
                              </View>
                            ) : null}
                          </AppStack>
                        )
                      ) : null}

                      {confirmError ? (
                        <AppText variant="caption" tone="danger">
                          {confirmError}
                        </AppText>
                      ) : null}
                    </AppStack>
                  </AppCard>
                ) : null}

                <AppCard>
                  <AppStack gap={2}>
                    <View style={styles.sectionTitleRow}>
                      <Users color={colors.primary} size={16} />
                      <AppText variant="label" weight="bold" tone="muted">
                        TRIP OVERVIEW
                      </AppText>
                    </View>
                    <SummaryRow label="Group type" value={labelFor(GROUP_TYPE_OPTIONS, booking.groupType)} />
                    <SummaryRow label="Accommodation type" value={labelFor(ACCOMMODATION_TYPE_OPTIONS, booking.accommodationType)} />
                    {booking.accommodationType === "hotel" ? (
                      <SummaryRow label="Hotel rating" value={labelFor(HOTEL_STAR_OPTIONS, booking.minHotelStarLabel)} />
                    ) : null}
                    <SummaryRow label="Headcount" value={`${booking.headcount} ${booking.headcount === 1 ? "person" : "people"}`} />
                    {genderBreakdown ? <SummaryRow label="Gender breakdown" value={genderBreakdown} /> : null}
                  </AppStack>
                </AppCard>

                <AppCard>
                  <AppStack gap={2}>
                    <View style={styles.sectionTitleRow}>
                      <MapPin color={colors.primary} size={16} />
                      <AppText variant="label" weight="bold" tone="muted">
                        ORIGIN AND DESTINATION
                      </AppText>
                    </View>
                    {origin ? <SummaryRow label="Travelling from" value={origin} /> : null}
                    <SummaryRow label="Destination" value={[destination, booking.toLocation].filter(Boolean).join(", ")} />
                  </AppStack>
                </AppCard>

                <AppCard>
                  <AppStack gap={2}>
                    <View style={styles.sectionTitleRow}>
                      <Calendar color={colors.primary} size={16} />
                      <AppText variant="label" weight="bold" tone="muted">
                        DATES AND ROOMS
                      </AppText>
                    </View>
                    <SummaryRow label="Check in" value={booking.useDates ? formatDateTime(booking.checkIn) : "Dates flexible"} />
                    <SummaryRow label="Check out" value={booking.useDates ? formatDateTime(booking.checkOut) : "Dates flexible"} />
                    <SummaryRow label="Room size" value={labelFor(ROOM_SIZE_OPTIONS, String(booking.roomSize))} />
                    <SummaryRow label="Rooms needed" value={String(booking.roomsNeeded)} />
                    <SummaryRow label="Private rooms" value={booking.needsPrivateRoom ? `Yes, ${booking.privateRoomCount}` : "No"} />
                  </AppStack>
                </AppCard>

                <AppCard>
                  <AppStack gap={2}>
                    <AppText variant="label" weight="bold" tone="muted">
                      ARRANGEMENTS
                    </AppText>
                    {ARRANGEMENT_OPTIONS.map((option) => {
                      const active =
                        option.key === "pickup"
                          ? booking.arrPickup
                          : option.key === "transport"
                          ? booking.arrTransport
                          : option.key === "meals"
                          ? booking.arrMeals
                          : option.key === "guide"
                          ? booking.arrGuide
                          : booking.arrEquipment;
                      return <SummaryRow key={option.key} label={option.label} value={active ? "Yes" : "No"} />;
                    })}
                    {booking.arrPickup && booking.pickupLocation ? <SummaryRow label="Pickup location" value={booking.pickupLocation} /> : null}
                    {booking.arrPickup && booking.pickupTime ? <SummaryRow label="Pickup time" value={booking.pickupTime} /> : null}
                    {booking.arrangementNotes ? <SummaryRow label="Notes" value={booking.arrangementNotes} /> : null}
                  </AppStack>
                </AppCard>

                {booking.roster && booking.roster.length > 0 ? (
                  <AppCard>
                    <AppStack gap={2}>
                      <AppText variant="label" weight="bold" tone="muted">
                        PASSENGER ROSTER
                      </AppText>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View>
                          <View style={styles.rosterRow}>
                            <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColName}>
                              Name
                            </AppText>
                            <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColGender}>
                              Gender
                            </AppText>
                            <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColAge}>
                              Age
                            </AppText>
                            <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColNationality}>
                              Nationality
                            </AppText>
                            <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColPhone}>
                              Phone
                            </AppText>
                          </View>
                          {booking.roster.map((p, index) => (
                            <View key={`${p.firstname}-${index}`} style={[styles.rosterRow, styles.rosterRowData]}>
                              <AppText variant="bodySmall" weight="semiBold" numberOfLines={1} style={styles.rosterColName}>
                                {index + 1}. {p.firstname} {p.lastname}
                              </AppText>
                              <AppText variant="bodySmall" numberOfLines={1} style={styles.rosterColGender}>
                                {p.gender || "-"}
                              </AppText>
                              <AppText variant="bodySmall" numberOfLines={1} style={styles.rosterColAge}>
                                {p.age || "-"}
                              </AppText>
                              <AppText variant="bodySmall" numberOfLines={1} style={styles.rosterColNationality}>
                                {p.nationality || "-"}
                              </AppText>
                              <AppText variant="bodySmall" numberOfLines={1} style={styles.rosterColPhone}>
                                {p.phone || "-"}
                              </AppText>
                            </View>
                          ))}
                        </View>
                      </ScrollView>
                    </AppStack>
                  </AppCard>
                ) : null}

                {amount || booking.adminNotes ? (
                  <AppCard tone={amount ? "success" : "default"}>
                    <AppStack gap={2}>
                      <View style={styles.sectionTitleRow}>
                        <Banknote color={colors.primary} size={16} />
                        <AppText variant="label" weight="bold" tone="muted">
                          PRICING AND NOTES
                        </AppText>
                      </View>
                      {amount ? <SummaryRow label="Estimated total" value={amount} /> : null}
                      {booking.adminNotes ? <SummaryRow label="Note from NoLSAF" value={booking.adminNotes} /> : null}
                    </AppStack>
                  </AppCard>
                ) : null}

                <AppCard>
                  <AppStack gap={3}>
                    <View style={styles.sectionTitleRow}>
                      <MessageCircle color={colors.primary} size={16} />
                      <AppText variant="label" weight="bold" tone="muted">
                        FOLLOW UP
                      </AppText>
                    </View>
                    <AppText variant="caption" tone="soft">
                      Ask our team where this request stands. We will reply here and notify you.
                    </AppText>

                    {messagesLoading ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : messages.length > 0 ? (
                      <AppStack gap={2}>
                        {messages.map((m) => {
                          const fromUser = m.senderRole === "USER";
                          return (
                            <View key={m.id} style={[styles.messageBubble, fromUser ? styles.messageBubbleUser : styles.messageBubbleOther]}>
                              <AppText variant="caption" weight="bold" tone={fromUser ? "inverse" : "primary"}>
                                {fromUser ? "You" : m.senderName || "NoLSAF"}
                              </AppText>
                              <AppText variant="bodySmall" tone={fromUser ? "inverse" : "default"}>
                                {m.message}
                              </AppText>
                              <AppText variant="caption" tone={fromUser ? "inverse" : "muted"} style={styles.messageDate}>
                                {m.formattedDate || formatDateTime(m.createdAt)}
                              </AppText>
                            </View>
                          );
                        })}
                      </AppStack>
                    ) : null}

                    <AppButton
                      title="Ask for a status update"
                      variant="secondary"
                      loading={sending}
                      onPress={() => sendFollowUp("Hi, could you please share a status update on this group stay request?")}
                    />

                    <View style={styles.followUpRow}>
                      <View style={styles.flex}>
                        <AppInput
                          label="Your message"
                          placeholder="Write a message to NoLSAF"
                          value={followUpText}
                          onChangeText={setFollowUpText}
                          multiline
                        />
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => sendFollowUp(followUpText)}
                        disabled={sending || !followUpText.trim()}
                        style={[styles.sendButton, (sending || !followUpText.trim()) && styles.sendButtonDisabled]}
                      >
                        <Send color={colors.white} size={18} />
                      </Pressable>
                    </View>

                    {sendError ? (
                      <AppText variant="caption" tone="danger">
                        {sendError}
                      </AppText>
                    ) : sent ? (
                      <AppText variant="caption" tone="primary" weight="bold">
                        Message sent. Our team will respond here.
                      </AppText>
                    ) : null}
                  </AppStack>
                </AppCard>
              </AppStack>
            </ScrollView>
          ) : null}
        </AppStack>
      </SafeScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  screen: { gap: spacing[5], flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  body: { gap: spacing[3], paddingBottom: spacing[8] },
  loading: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[8] },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  messageBubble: {
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: spacing[1],
    maxWidth: "85%"
  },
  messageBubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.primary
  },
  messageBubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: colors.brand[50]
  },
  messageDate: { opacity: 0.7 },
  followUpRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing[2] },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  sendButtonDisabled: { opacity: 0.5 },
  depositCard: {
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb"
  },
  depositHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  depositIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white
  },
  depositText: { color: "#b45309" },
  depositDivider: { height: 1, backgroundColor: "#fde68a" },
  depositAmountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  offerBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  offerBannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white
  },
  offerScroll: { marginHorizontal: -spacing[4] },
  offerScrollContent: { paddingHorizontal: spacing[4], gap: spacing[3] },
  offerCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing[3],
    gap: spacing[2]
  },
  offerDots: { flexDirection: "row", justifyContent: "center", gap: spacing[1], marginTop: spacing[1] },
  offerDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.border
  },
  offerDotActive: {
    backgroundColor: colors.primary,
    width: 18
  },
  offerHeaderRow: { flexDirection: "row", gap: spacing[3], alignItems: "flex-start" },
  offerImage: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.brand[50] },
  offerImageEmpty: { borderWidth: 1, borderColor: colors.border },
  offerTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  bestPriceBadge: {
    borderRadius: radius.full,
    backgroundColor: "#dcfce7",
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  offerPriceBlock: {
    gap: spacing[1],
    backgroundColor: colors.brand[50],
    borderRadius: radius.md,
    padding: spacing[3]
  },
  offerPriceTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  offerPriceMain: { flexDirection: "row", alignItems: "flex-end", gap: spacing[1] },
  offerDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing[1] },
  offerTotalRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  strikethrough: { textDecorationLine: "line-through" },
  discountBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  savingsBadge: {
    borderRadius: radius.full,
    backgroundColor: "#dcfce7",
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  amenityScroll: { maxHeight: 76 },
  amenityGrid: {
    flexDirection: "column",
    flexWrap: "wrap",
    alignContent: "flex-start",
    gap: spacing[2],
    height: 76,
    paddingVertical: spacing[1]
  },
  amenityChip: {
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  summaryValue: { flex: 1, minWidth: 0, textAlign: "right" },
  rosterRow: { flexDirection: "row", alignItems: "center", gap: spacing[4], paddingVertical: spacing[2] },
  rosterRowData: { borderTopWidth: 1, borderTopColor: colors.border },
  rosterColName: { width: 160 },
  rosterColGender: { width: 70 },
  rosterColAge: { width: 50 },
  rosterColNationality: { width: 110 },
  rosterColPhone: { width: 120 }
});
