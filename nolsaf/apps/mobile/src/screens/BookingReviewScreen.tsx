import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Lock,
  Minus,
  Plus,
  ShieldCheck,
  XCircle
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import {
  createBooking,
  createInvoiceFromBooking,
  fetchSystemCommission,
  getPropertyCommission,
  priceWithCommission,
  type GuestSex
} from "../bookings";
import {
  AmountText,
  AppButton,
  AppCard,
  AppInput,
  AppStack,
  AppText,
  BottomActionBar,
  CalendarRangeSheet,
  SafeScreen,
  ScreenHeader,
  StateView,
  TransportBundle,
  type TransportSelection
} from "../components";
import { ApiError } from "../lib/apiClient";
import { capTzPhoneInput, normalizeTzPhone } from "../lib/phone";
import { RootStackParamList } from "../navigation/types";
import { fetchAvailabilityRange, fetchPropertyDetail, normalizeRoom, type PublicPropertyDetail } from "../properties";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "BookingReview">;

const SEX_OPTIONS: GuestSex[] = ["Male", "Female", "Other"];

function labelize(value: string): string {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ymdToIso(ymd: string): string {
  // Noon local avoids any timezone day-shift when converting to ISO.
  return new Date(`${ymd}T12:00:00`).toISOString();
}

function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(`${checkIn}T00:00:00`).getTime();
  const b = new Date(`${checkOut}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.max(1, Math.round((b - a) / 86400000));
}

function formatPretty(ymd: string): string {
  if (!ymd) return "Select";
  const d = new Date(`${ymd}T00:00:00`);
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function Stepper({
  value,
  onChange,
  min = 0,
  max = 99
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease"
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[styles.stepperBtn, value <= min && styles.stepperBtnOff]}
      >
        <Minus color={value <= min ? colors.softText : colors.primary} size={16} />
      </Pressable>
      <AppText variant="bodySmall" weight="bold" style={styles.stepperValue}>
        {value}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase"
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[styles.stepperBtn, value >= max && styles.stepperBtnOff]}
      >
        <Plus color={value >= max ? colors.softText : colors.primary} size={16} />
      </Pressable>
    </View>
  );
}

/** A read-only detail pulled from the verified account. Locked so it cannot be
 *  edited, mirroring AppInput's layout for a consistent look. */
function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.lockWrap}>
      <View style={styles.lockLabelRow}>
        <AppText variant="label" weight="semiBold" tone="muted">
          {label}
        </AppText>
        <View style={styles.lockTag}>
          <Lock color={colors.success} size={11} />
          <AppText variant="caption" weight="semiBold" tone="success">
            From your account
          </AppText>
        </View>
      </View>
      <View style={styles.lockedBox}>
        <AppText variant="body" weight="semiBold" numberOfLines={1} style={styles.flex}>
          {value}
        </AppText>
        <Lock color={colors.softText} size={15} />
      </View>
    </View>
  );
}

export function BookingReviewScreen({ navigation, route }: Props) {
  const { token, user } = useAuth();
  const { propertyId, propertyTitle } = route.params;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublicPropertyDetail | null>(null);
  const [commission, setCommission] = useState(0);

  const [checkIn, setCheckIn] = useState(route.params.checkIn || "");
  const [checkOut, setCheckOut] = useState(route.params.checkOut || "");
  const [calendarVisible, setCalendarVisible] = useState(false);

  const [roomCode, setRoomCode] = useState<string | null>(route.params.roomCode ?? null);
  const [rooms, setRooms] = useState(1);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [pets, setPets] = useState(0);

  const [guestName, setGuestName] = useState(user?.fullName || user?.name || "");
  const [guestPhone, setGuestPhone] = useState(user?.phone || "");
  const [guestEmail, setGuestEmail] = useState(user?.email || "");
  const [nationality, setNationality] = useState("");
  const [sex, setSex] = useState<GuestSex | "">("");

  const [avail, setAvail] = useState<number | null | undefined>(undefined);
  const [availLoading, setAvailLoading] = useState(false);

  const [transport, setTransport] = useState<TransportSelection>({
    include: false,
    fare: 0,
    fareSubtotal: 0,
    surgeMultiplier: 1,
    surgeAmount: 0,
    ready: true,
    fields: {}
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onTransportChange = useCallback((sel: TransportSelection) => setTransport(sel), []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [d, sys] = await Promise.all([fetchPropertyDetail(propertyId), fetchSystemCommission()]);
      setDetail(d);
      setCommission(getPropertyCommission(d.services, sys));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this stay.");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Autofill the guest details from the signed-in account. Only fills blanks so
  // it never clobbers what the user is typing, and it runs once the account is
  // available (the profile may resolve after first render).
  useEffect(() => {
    if (!user) return;
    setGuestName((prev) => prev || user.fullName || user.name || "");
    setGuestPhone((prev) => prev || user.phone || "");
    setGuestEmail((prev) => prev || user.email || "");
  }, [user]);

  const roomOptions = useMemo(() => {
    if (!detail) return [];
    return (detail.roomsSpec || []).map((r, i) => normalizeRoom(r, i, detail.currency, detail.basePrice));
  }, [detail]);

  const selectedRoom = useMemo(() => {
    if (!roomCode) return null;
    return roomOptions.find((r) => r.roomType === roomCode) ?? null;
  }, [roomOptions, roomCode]);

  const currency = detail?.currency || "TZS";
  const netPerNight = selectedRoom?.pricePerNight ?? (detail?.basePrice ? Number(detail.basePrice) : 0);
  const grossPerNight = priceWithCommission(netPerNight, commission);
  const nights = nightsBetween(checkIn, checkOut);
  const subtotal = grossPerNight * Math.max(1, nights) * rooms;
  const transportFare = transport.include ? transport.fare : 0;
  const total = subtotal + transportFare;

  // Live availability for the chosen dates and room type.
  useEffect(() => {
    if (!checkIn || !checkOut || nights <= 0) {
      setAvail(undefined);
      return;
    }
    let cancelled = false;
    setAvailLoading(true);
    fetchAvailabilityRange(propertyId, checkIn, checkOut, roomCode || undefined)
      .then((res) => {
        if (!cancelled) setAvail(res.items[0]?.roomsAvailable ?? null);
      })
      .catch(() => {
        if (!cancelled) setAvail(null);
      })
      .finally(() => {
        if (!cancelled) setAvailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, checkIn, checkOut, roomCode, nights]);

  const soldOut = avail === 0;
  const phoneValid = !!normalizeTzPhone(guestPhone);

  // Lock the details that come from the verified account so they cannot be edited.
  const nameLocked = !!(user?.fullName || user?.name);
  const phoneLocked = !!user?.phone && phoneValid;
  const emailLocked = !!user?.email;
  const roomOk = roomOptions.length === 0 || !!roomCode;
  const canContinue =
    !!checkIn &&
    !!checkOut &&
    nights > 0 &&
    !soldOut &&
    roomOk &&
    guestName.trim().length >= 2 &&
    phoneValid &&
    transport.ready &&
    !submitting;

  async function handleContinue() {
    if (!detail) return;
    setError(null);

    if (!checkIn || !checkOut || nights <= 0) {
      setError("Please choose your check in and check out dates.");
      return;
    }
    if (guestName.trim().length < 2) {
      setError("Please enter the guest's full name.");
      return;
    }
    const phoneForApi = normalizeTzPhone(guestPhone);
    if (!phoneForApi) {
      setError("Enter a valid phone, for example 0712 345 678 or +255 712 345 678.");
      return;
    }
    const emailForApi = guestEmail.trim().replace(/\s+/g, "");

    if (transport.include && !transport.ready) {
      setError("Please complete the ride details, or turn off the ride add on.");
      return;
    }

    setSubmitting(true);
    try {
      const booking = await createBooking(token, {
        propertyId,
        checkIn: ymdToIso(checkIn),
        checkOut: ymdToIso(checkOut),
        guestName: guestName.trim(),
        guestPhone: phoneForApi,
        guestEmail: emailForApi || null,
        nationality: nationality.trim() || null,
        sex: sex || null,
        adults,
        children,
        pets,
        rooms,
        roomCode: roomCode || null,
        ...(transport.include ? transport.fields : {})
      });

      const invoice = await createInvoiceFromBooking(booking.bookingId, booking.bookingAccessToken);

      navigation.replace("BookingPayment", {
        invoiceId: invoice.invoiceId,
        accessToken: invoice.accessToken
      });
    } catch (err) {
      const api = err as ApiError;
      setError(api?.message || "Could not start your booking. Please try again.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Review booking" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeScreen>
    );
  }

  if (loadError || !detail) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Review booking" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <StateView title="Could not load" message={loadError || "Stay not found."} actionLabel="Try again" onAction={load} />
        </View>
      </SafeScreen>
    );
  }

  const location = [detail.regionName, detail.district, detail.city].filter(Boolean).join(", ");
  const cover = detail.images?.[0] || null;

  return (
    <View style={styles.flex}>
      <SafeScreen contentStyle={styles.body}>
        <ScreenHeader title="Review booking" subtitle="Confirm the details, then pay to lock it in." onBack={() => navigation.goBack()} />

        {/* Property summary */}
        <AppCard>
          <View style={styles.propRow}>
            {cover ? (
              <Image source={{ uri: cover }} style={styles.propImage} />
            ) : (
              <View style={[styles.propImage, styles.propImageEmpty]} />
            )}
            <View style={styles.flex}>
              <AppText variant="titleSm" weight="bold" numberOfLines={2}>
                {detail.title || propertyTitle || "Stay"}
              </AppText>
              {location ? (
                <AppText variant="caption" tone="muted" numberOfLines={2}>
                  {location}
                </AppText>
              ) : null}
              <View style={styles.verifiedRow}>
                <ShieldCheck color={colors.success} size={13} />
                <AppText variant="caption" weight="semiBold" tone="success">
                  Verified stay
                </AppText>
              </View>
            </View>
          </View>
        </AppCard>

        {/* Dates */}
        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              YOUR DATES
              <AppText variant="label" weight="bold" tone="danger">
                {" *"}
              </AppText>
            </AppText>
            {checkIn && checkOut && nights > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => setCalendarVisible(true)} style={styles.dateCard}>
                <View style={styles.dateIcon}>
                  <CalendarDays color={colors.primary} size={16} />
                </View>
                <View style={styles.dateCol}>
                  <AppText variant="caption" weight="semiBold" tone="muted">
                    CHECK IN
                  </AppText>
                  <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                    {formatPretty(checkIn)}
                  </AppText>
                </View>
                <View style={styles.dateMid}>
                  <View style={styles.nightsPill}>
                    <AppText variant="caption" weight="bold" tone="primary">
                      {nights} {nights === 1 ? "night" : "nights"}
                    </AppText>
                  </View>
                  <ArrowRight color={colors.softText} size={14} />
                </View>
                <View style={[styles.dateCol, styles.dateColEnd]}>
                  <AppText variant="caption" weight="semiBold" tone="muted">
                    CHECK OUT
                  </AppText>
                  <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                    {formatPretty(checkOut)}
                  </AppText>
                </View>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setCalendarVisible(true)} style={styles.dateRow}>
                <View style={styles.dateIcon}>
                  <CalendarDays color={colors.primary} size={16} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="bold">
                    Choose your dates
                  </AppText>
                  <AppText variant="caption" tone="soft">
                    Check in and check out
                  </AppText>
                </View>
                <ChevronRight color={colors.softText} size={18} />
              </Pressable>
            )}

            {checkIn && checkOut && nights > 0 ? (
              <View
                style={[
                  styles.availPill,
                  availLoading ? styles.availNeutral : soldOut ? styles.availBad : avail != null ? styles.availOk : styles.availNeutral
                ]}
              >
                {availLoading ? (
                  <AppText variant="caption" weight="semiBold" tone="muted">
                    Checking availability...
                  </AppText>
                ) : avail != null ? (
                  <>
                    {soldOut ? <XCircle color={colors.mutedText} size={13} /> : <CheckCircle2 color={colors.success} size={13} />}
                    <AppText variant="caption" weight="bold" tone={soldOut ? "muted" : "success"}>
                      {soldOut ? "Sold out for your dates" : `${avail} available for your dates`}
                    </AppText>
                  </>
                ) : (
                  <AppText variant="caption" weight="semiBold" tone="muted">
                    Availability will be confirmed at payment
                  </AppText>
                )}
              </View>
            ) : null}
          </AppStack>
        </AppCard>

        {/* Room */}
        {roomOptions.length > 0 ? (
          <AppCard>
            <AppStack gap={3}>
              <AppText variant="label" weight="bold" tone="muted">
                ROOM
                <AppText variant="label" weight="bold" tone="danger">
                  {" *"}
                </AppText>
              </AppText>
              {roomOptions.map((room) => {
                const active = roomCode === room.roomType;
                return (
                  <Pressable
                    key={room.roomType}
                    accessibilityRole="button"
                    onPress={() => setRoomCode(active ? null : room.roomType)}
                    style={[styles.roomRow, active && styles.roomRowActive]}
                  >
                    <View style={styles.roomIcon}>
                      <BedDouble color={colors.primary} size={16} />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                        {labelize(room.roomType)}
                      </AppText>
                      {room.bedsSummary ? (
                        <AppText variant="caption" tone="soft" numberOfLines={1}>
                          {room.bedsSummary}
                        </AppText>
                      ) : null}
                    </View>
                    {room.pricePerNight != null ? (
                      <AppText variant="caption" weight="semiBold" tone="soft">
                        {priceWithCommission(room.pricePerNight, commission).toLocaleString()} {currency}
                      </AppText>
                    ) : null}
                    <View style={[styles.radio, active && styles.radioOn]}>{active ? <View style={styles.radioDot} /> : null}</View>
                  </Pressable>
                );
              })}
            </AppStack>
          </AppCard>
        ) : null}

        {/* Guests + rooms */}
        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              GUESTS
            </AppText>
            <View style={styles.counterRow}>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="semiBold">
                  Adults
                </AppText>
                <AppText variant="caption" tone="soft">
                  Ages 13+
                </AppText>
              </View>
              <Stepper value={adults} onChange={setAdults} min={1} max={30} />
            </View>
            <View style={styles.counterRow}>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="semiBold">
                  Children
                </AppText>
                <AppText variant="caption" tone="soft">
                  Ages 0 to 12
                </AppText>
              </View>
              <Stepper value={children} onChange={setChildren} min={0} max={30} />
            </View>
            <View style={styles.counterRow}>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="semiBold">
                  Pets
                </AppText>
              </View>
              <Stepper value={pets} onChange={setPets} min={0} max={10} />
            </View>
            <View style={styles.divider} />
            <View style={styles.counterRow}>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="semiBold">
                  Rooms
                </AppText>
                <AppText variant="caption" tone="soft">
                  How many of this room
                </AppText>
              </View>
              <Stepper value={rooms} onChange={setRooms} min={1} max={20} />
            </View>
          </AppStack>
        </AppCard>

        {/* Guest details */}
        <AppCard>
          <AppStack gap={4}>
            <View style={styles.detailsHead}>
              <AppText variant="label" weight="bold" tone="muted">
                YOUR DETAILS
              </AppText>
              {nameLocked || phoneLocked || emailLocked ? (
                <AppText variant="caption" tone="soft">
                  Verified details are locked
                </AppText>
              ) : null}
            </View>
            {nameLocked ? (
              <LockedField label="Full name" value={guestName} />
            ) : (
              <AppInput label="Full name" value={guestName} onChangeText={setGuestName} placeholder="As on your ID" autoCapitalize="words" />
            )}
            {phoneLocked ? (
              <LockedField label="Phone" value={guestPhone} />
            ) : (
              <AppInput
                label="Phone"
                value={guestPhone}
                onChangeText={(t) => setGuestPhone(capTzPhoneInput(t))}
                placeholder="07XXXXXXXX or +255 7XXXXXXXX"
                keyboardType="phone-pad"
                maxLength={13}
                error={guestPhone.length > 0 && !phoneValid ? "Enter a valid Tanzania phone number." : undefined}
              />
            )}
            {emailLocked ? (
              <LockedField label="Email" value={guestEmail} />
            ) : (
              <AppInput
                label="Email (optional)"
                value={guestEmail}
                onChangeText={setGuestEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            )}
            <AppInput
              label="Nationality (optional)"
              value={nationality}
              onChangeText={(t) => setNationality(t.replace(/\d+/g, ""))}
              placeholder="Tanzanian"
              autoCapitalize="words"
            />
            <View>
              <AppText variant="label" weight="semiBold" tone="muted" style={styles.sexLabel}>
                Sex (optional)
              </AppText>
              <View style={styles.segment}>
                {SEX_OPTIONS.map((opt) => {
                  const active = sex === opt;
                  return (
                    <Pressable
                      key={opt}
                      accessibilityRole="button"
                      onPress={() => setSex(active ? "" : opt)}
                      style={[styles.segmentItem, active && styles.segmentItemOn]}
                    >
                      <AppText variant="caption" weight="semiBold" tone={active ? "inverse" : "muted"}>
                        {opt}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </AppStack>
        </AppCard>

        {/* Transport add-on */}
        <TransportBundle
          destination={
            detail.latitude != null && detail.longitude != null
              ? { latitude: Number(detail.latitude), longitude: Number(detail.longitude) }
              : null
          }
          currency={currency}
          defaultArrivalDate={checkIn || undefined}
          onChange={onTransportChange}
        />

        {/* Price summary */}
        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              PRICE
            </AppText>
            <View style={styles.priceRow}>
              <AppText variant="bodySmall" tone="muted" style={styles.flex}>
                {grossPerNight.toLocaleString()} {currency} × {Math.max(1, nights)} {nights === 1 ? "night" : "nights"}
                {rooms > 1 ? ` × ${rooms} rooms` : ""}
              </AppText>
              <AppText variant="bodySmall" weight="semiBold">
                {subtotal.toLocaleString()} {currency}
              </AppText>
            </View>
            {transportFare > 0 ? (
              <AppStack gap={2}>
                <View style={styles.priceRow}>
                  <AppText variant="bodySmall" tone="muted" style={styles.flex}>
                    Ride to the stay
                  </AppText>
                  <AppText variant="bodySmall" weight="semiBold">
                    {(transport.surgeAmount > 0 ? transport.fareSubtotal : transportFare).toLocaleString()} {currency}
                  </AppText>
                </View>
                {transport.surgeAmount > 0 ? (
                  <View style={styles.priceRow}>
                    <AppText variant="caption" tone="warning" weight="semiBold" style={styles.flex}>
                      Peak fare ({Math.round((transport.surgeMultiplier - 1) * 100)}%)
                    </AppText>
                    <AppText variant="bodySmall" tone="warning" weight="semiBold">
                      +{transport.surgeAmount.toLocaleString()} {currency}
                    </AppText>
                  </View>
                ) : null}
              </AppStack>
            ) : null}
            <View style={styles.divider} />
            <View style={styles.priceRow}>
              <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                Total
              </AppText>
              <AmountText amount={total} currency={currency} variant="titleSm" weight="extraBold" tone="primary" />
            </View>
            <AppText variant="caption" tone="soft">
              You pay this securely on the next step.
            </AppText>
          </AppStack>
        </AppCard>

        {error ? (
          <View style={styles.errorBox}>
            <AppText variant="caption" weight="semiBold" tone="danger">
              {error}
            </AppText>
          </View>
        ) : null}
      </SafeScreen>

      <BottomActionBar>
        <View style={styles.barRow}>
          <View style={styles.flex}>
            <AppText variant="caption" tone="soft">
              Total
            </AppText>
            <AmountText amount={total} currency={currency} variant="titleSm" weight="extraBold" />
          </View>
          <AppButton
            title={soldOut ? "Sold out" : "Continue to payment"}
            onPress={handleContinue}
            loading={submitting}
            disabled={!canContinue}
            style={styles.barBtn}
          />
        </View>
      </BottomActionBar>

      <CalendarRangeSheet
        visible={calendarVisible}
        checkIn={checkIn}
        checkOut={checkOut}
        onClose={() => setCalendarVisible(false)}
        onApply={(ci, co) => {
          setCheckIn(ci);
          setCheckOut(co);
          setCalendarVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  body: { gap: spacing[4], paddingBottom: spacing[6] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing[5] },
  propRow: { flexDirection: "row", gap: spacing[3], minWidth: 0 },
  propImage: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.brand[50] },
  propImageEmpty: { borderWidth: 1, borderColor: colors.border },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: spacing[1], marginTop: spacing[1] },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  dateCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  dateIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  dateCol: { flex: 1, minWidth: 0, gap: 2 },
  dateColEnd: { alignItems: "flex-end" },
  dateMid: { alignItems: "center", gap: 3, width: 76 },
  nightsPill: {
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 1
  },
  availPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  availOk: { backgroundColor: "#e9f7ef" },
  availBad: { backgroundColor: colors.brand[50] },
  availNeutral: { backgroundColor: colors.brand[50] },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  roomRowActive: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  roomIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 9, height: 9, borderRadius: radius.full, backgroundColor: colors.primary },
  counterRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  stepperBtnOff: { borderColor: colors.border },
  stepperValue: { minWidth: 20, textAlign: "center" },
  divider: { height: 1, backgroundColor: colors.border },
  detailsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  lockWrap: { gap: spacing[2], minWidth: 0 },
  lockLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  lockTag: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  lockedBox: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[4]
  },
  sexLabel: { marginBottom: spacing[2] },
  segment: {
    flexDirection: "row",
    gap: spacing[2]
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: spacing[2]
  },
  segmentItemOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  priceRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  errorBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: "#fdecec",
    padding: spacing[3]
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  barBtn: { flexShrink: 0 }
});
