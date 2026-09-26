import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BadgeCheck, CalendarDays, CheckSquare2, ExternalLink, Minus, Plane, Plus, Square, Users } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
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
  StateView
} from "../components";
import { ApiError } from "../lib/apiClient";
import { capTzPhoneInput, normalizeTzPhone } from "../lib/phone";
import { webOrigin } from "../lib/webOrigin";
import { RootStackParamList } from "../navigation/types";
import { createTourBooking, DiscoveryOperator, DiscoveryPackage, fetchTourOperator } from "../tours";
import { colors, radius, spacing } from "../theme";
import airtelLogo from "../../assets/payments/airtel.png";
import crdbLogo from "../../assets/payments/crdb.png";
import halopesaLogo from "../../assets/payments/halopesa.png";
import mastercardLogo from "../../assets/payments/mastercard.png";
import mixxLogo from "../../assets/payments/mixx.png";
import mpesaLogo from "../../assets/payments/mpesa.png";
import nmbLogo from "../../assets/payments/nmb.png";
import visaLogo from "../../assets/payments/visa.png";

type Props = NativeStackScreenProps<RootStackParamList, "TourBookingReview">;

type Airport = {
  id: string;
  label: string;
  shortLabel: string;
  city: string;
  iataCode: string;
  lat: number;
  lng: number;
};

const INTERNATIONAL_AIRPORTS: Airport[] = [
  {
    id: "jnia",
    label: "Julius Nyerere International Airport",
    shortLabel: "Julius Nyerere",
    city: "Dar es Salaam",
    iataCode: "DAR",
    lat: -6.8781,
    lng: 39.2026
  },
  {
    id: "kia",
    label: "Kilimanjaro International Airport",
    shortLabel: "Kilimanjaro",
    city: "Kilimanjaro",
    iataCode: "JRO",
    lat: -3.4294,
    lng: 37.0745
  },
  {
    id: "znz",
    label: "Abeid Amani Karume International Airport",
    shortLabel: "Abeid Amani Karume",
    city: "Zanzibar",
    iataCode: "ZNZ",
    lat: -6.222,
    lng: 39.2249
  }
];

const SEX_OPTIONS = ["Male", "Female", "Other"] as const;

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function ymdToIso(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toISOString();
}

function prettyDate(ymd: string): string {
  if (!ymd) return "Select";
  const d = new Date(`${ymd}T00:00:00`);
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  if (isNaN(d.getTime())) return false;
  return value === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (next: number) => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
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
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[styles.stepperBtn, value >= max && styles.stepperBtnOff]}
      >
        <Plus color={value >= max ? colors.softText : colors.primary} size={16} />
      </Pressable>
    </View>
  );
}

export function TourBookingReviewScreen({ navigation, route }: Props) {
  const { token, user } = useAuth();
  const { operatorKey, packageId, packageName, operatorName } = route.params;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operator, setOperator] = useState<DiscoveryOperator | null>(null);
  const [pkg, setPkg] = useState<DiscoveryPackage | null>(null);

  const [travelers, setTravelers] = useState(1);
  const [travelDate, setTravelDate] = useState("");
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [airportId, setAirportId] = useState("");
  const [wantsHotel, setWantsHotel] = useState(false);
  const [guestName, setGuestName] = useState(user?.fullName || user?.name || "");
  const [guestPhone, setGuestPhone] = useState(user?.phone || "");
  const [guestEmail, setGuestEmail] = useState(user?.email || "");
  const [nationality, setNationality] = useState("");
  const [sex, setSex] = useState<(typeof SEX_OPTIONS)[number] | "">("");
  const [notes, setNotes] = useState("");
  const [cancellationPolicyAccepted, setCancellationPolicyAccepted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const op = await fetchTourOperator(operatorKey);
      if (!op) throw new Error("This tour operator is no longer available.");
      const found = op.packages.find((item) => String(item.id ?? "") === String(packageId)) ?? null;
      if (!found) throw new Error("This tour package is no longer available.");
      setOperator(op);
      setPkg(found);
      const min = Math.max(1, Math.round(found.minPax || 1));
      setTravelers(min);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this tour package.");
    } finally {
      setLoading(false);
    }
  }, [operatorKey, packageId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    setGuestName((prev) => prev || user.fullName || user.name || "");
    setGuestPhone((prev) => prev || user.phone || "");
    setGuestEmail((prev) => prev || user.email || "");
  }, [user]);

  const minTravelers = Math.max(1, Math.round(pkg?.minPax || 1));
  const maxTravelers = Math.max(minTravelers, Math.round(pkg?.maxPax || 30));
  const currency = pkg?.currency || "TZS";
  const unitPrice = pkg?.pricePerPerson || 0;
  const total = unitPrice * travelers;
  const airport = useMemo(() => INTERNATIONAL_AIRPORTS.find((item) => item.id === airportId) || null, [airportId]);
  const phoneValid = Boolean(normalizeTzPhone(guestPhone));
  const emailValid = guestEmail.trim().length > 0 && isValidEmail(guestEmail);
  const dateValid = isValidYmd(travelDate);
  const canSubmit =
    !!pkg &&
    !!token &&
    dateValid &&
    guestName.trim().length >= 2 &&
    phoneValid &&
    emailValid &&
    nationality.trim().length >= 2 &&
    cancellationPolicyAccepted &&
    travelers >= minTravelers &&
    travelers <= maxTravelers &&
    !submitting;

  async function submit() {
    if (!pkg || !operator || !token || submitting) return;
    setFormError(null);

    const phoneForApi = normalizeTzPhone(guestPhone);
    if (!dateValid) {
      setFormError("Please enter a valid travel date, for example 2026-06-17.");
      return;
    }
    if (guestName.trim().length < 2) {
      setFormError("Please enter your full name.");
      return;
    }
    if (!phoneForApi) {
      setFormError("Please enter a valid Tanzania phone number.");
      return;
    }
    if (!emailValid) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (nationality.trim().length < 2) {
      setFormError("Please enter your nationality.");
      return;
    }
    if (!cancellationPolicyAccepted) {
      setFormError("Please accept the cancellation policy before creating the booking.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createTourBooking(token, {
        operatorAgentId: operator.agentId,
        packageId,
        travelerCount: travelers,
        startDate: ymdToIso(travelDate),
        guestName: guestName.trim(),
        guestPhone: phoneForApi,
        guestEmail: guestEmail.trim(),
        nationality: nationality.trim(),
        cancellationPolicyAccepted: true,
        notes: notes.trim(),
        metadata: {
          departureAirport: airport
            ? {
                id: airport.id,
                label: airport.label,
                shortLabel: airport.shortLabel,
                city: airport.city,
                iataCode: airport.iataCode,
                lat: airport.lat,
                lng: airport.lng
              }
            : null,
          hotelLodgeBooking: {
            wantsToBookViaNolsaf: wantsHotel
          },
          sex: sex || null
        }
      });

      const bookingId = result.booking?.id ?? result.bookingId ?? result.tourBookingId;
      if (!bookingId || !result.accessToken) {
        throw new Error("Booking was created, but payment details were missing.");
      }
      navigation.replace("TourBookingPayment", {
        bookingId: Number(bookingId),
        accessToken: result.accessToken
      });
    } catch (err) {
      const api = err as ApiError;
      setFormError(api?.message || "Could not create your tour booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Tour booking" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeScreen>
    );
  }

  if (loadError || !operator || !pkg) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Tour booking" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <StateView title="Could not load tour" message={loadError || "Tour package not found."} actionLabel="Try again" onAction={load} />
        </View>
      </SafeScreen>
    );
  }

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.body}>
        <ScreenHeader title="Tour booking" subtitle="Confirm your travelers, arrival, and contact details." onBack={() => navigation.goBack()} />

        <AppCard>
          <AppStack gap={3}>
            <View style={styles.packageTop}>
              <View style={styles.packageIcon}>
                <BadgeCheck color={colors.primary} size={18} />
              </View>
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="extraBold" numberOfLines={2}>
                  {pkg.title || packageName || "Tour package"}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={2}>
                  {operator.operatorName || operatorName}
                </AppText>
              </View>
            </View>
            <View style={styles.paymentStrip}>
              <AppText variant="caption" weight="bold" tone="muted" style={styles.paymentLabel}>
                PAY WITH
              </AppText>
              {[mpesaLogo, mixxLogo, airtelLogo, halopesaLogo, crdbLogo, nmbLogo, visaLogo, mastercardLogo].map((logo, index) => (
                <View key={index} style={styles.paymentLogoWrap}>
                  <Image source={logo} style={styles.paymentLogo} resizeMode="contain" />
                </View>
              ))}
            </View>
          </AppStack>
        </AppCard>

        <AppCard>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: cancellationPolicyAccepted }}
            onPress={() => setCancellationPolicyAccepted((accepted) => !accepted)}
            style={({ pressed }) => [styles.policyRow, pressed && styles.pressed]}
          >
            {cancellationPolicyAccepted ? (
              <CheckSquare2 color={colors.primary} size={22} />
            ) : (
              <Square color={colors.softText} size={22} />
            )}
            <View style={styles.flex}>
              <AppText variant="bodySmall" weight="bold">
                I accept the cancellation policy
              </AppText>
              <AppText variant="caption" tone="muted">
                Includes the 24-hour cooling-off period, partial-refund windows, non-refundable items, and rules after a tour starts.
              </AppText>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => Linking.openURL(`${webOrigin()}/cancellation-policy`).catch(() => undefined)}
            style={styles.policyLink}
          >
            <AppText variant="caption" weight="bold" tone="primary">Read the full policy</AppText>
            <ExternalLink color={colors.primary} size={13} />
          </Pressable>
        </AppCard>

        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              TRAVELERS
            </AppText>
            <View style={styles.counterRow}>
              <View style={styles.rowIcon}>
                <Users color={colors.primary} size={17} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold">
                  Number of travelers
                </AppText>
                <AppText variant="caption" tone="soft">
                  {minTravelers} to {maxTravelers} travelers for this package
                </AppText>
              </View>
              <Stepper value={travelers} min={minTravelers} max={maxTravelers} onChange={setTravelers} />
            </View>
          </AppStack>
        </AppCard>

        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              TRAVEL DATE
              <AppText variant="label" weight="bold" tone="danger">
                {" *"}
              </AppText>
            </AppText>
            <Pressable accessibilityRole="button" onPress={() => setCalendarVisible(true)} style={styles.dateButton}>
              <View style={styles.rowIcon}>
                <CalendarDays color={colors.primary} size={17} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold">
                  {travelDate ? prettyDate(travelDate) : "Choose start date"}
                </AppText>
                <AppText variant="caption" tone="soft">
                  {travelDate ? "Tap to change date" : "Tap to open calendar"}
                </AppText>
              </View>
            </Pressable>
          </AppStack>
        </AppCard>

        <AppCard>
          <AppStack gap={3}>
            <View>
              <AppText variant="label" weight="bold" tone="muted">
                ARRIVAL AIRPORT
              </AppText>
              <AppText variant="caption" tone="soft">
                Optional, helps the operator plan your airport pickup.
              </AppText>
            </View>
            {INTERNATIONAL_AIRPORTS.map((item) => {
              const active = item.id === airportId;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => setAirportId(active ? "" : item.id)}
                  style={[styles.airportRow, active && styles.airportRowOn]}
                >
                  <View style={styles.airportCode}>
                    <AppText variant="caption" weight="extraBold" tone="primary">
                      {item.iataCode}
                    </AppText>
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
                      {item.shortLabel}
                    </AppText>
                    <AppText variant="caption" tone="soft" numberOfLines={1}>
                      {item.city}
                    </AppText>
                  </View>
                  <Plane color={active ? colors.primary : colors.softText} size={17} />
                </Pressable>
              );
            })}
          </AppStack>
        </AppCard>

        <AppCard>
          <AppStack gap={3}>
            <View style={styles.sectionIntro}>
              <AppText variant="label" weight="bold" tone="muted">
                HOTEL OR LODGE
              </AppText>
              <AppText variant="caption" tone="muted" style={styles.helperText}>
                Choose your own verified stay, or keep the accommodation included in the tour package.
              </AppText>
            </View>
            <View style={styles.choiceRow}>
              {[
                { label: "Choose my stay", value: true, hint: "Browse Verified Stays" },
                { label: "Use package stay", value: false, hint: "Keep the operator option" }
              ].map((item) => {
                const active = wantsHotel === item.value;
                return (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    onPress={() => {
                      setWantsHotel(item.value);
                      if (item.value) navigation.navigate("VerifiedStays");
                    }}
                    style={[styles.choiceCard, active && styles.choiceCardOn]}
                  >
                    <AppText variant="bodySmall" weight="bold" tone={active ? "primary" : "default"}>
                      {item.label}
                    </AppText>
                    <AppText variant="caption" tone="soft" numberOfLines={2}>
                      {item.hint}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </AppStack>
        </AppCard>

        <AppCard>
          <AppStack gap={4}>
            <AppText variant="label" weight="bold" tone="muted">
              YOUR DETAILS
            </AppText>
            <AppInput label="Full name" required value={guestName} onChangeText={setGuestName} placeholder="As on your passport" autoCapitalize="words" />
            <AppInput
              label="Phone"
              required
              value={guestPhone}
              onChangeText={(value) => setGuestPhone(capTzPhoneInput(value))}
              placeholder="07XXXXXXXX or +255 7XXXXXXXX"
              keyboardType="phone-pad"
              maxLength={13}
              error={guestPhone.length > 0 && !phoneValid ? "Enter a valid Tanzania phone number." : undefined}
            />
            <AppInput
              label="Email"
              required
              value={guestEmail}
              onChangeText={setGuestEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              error={guestEmail.length > 0 && !emailValid ? "Enter a valid email address." : undefined}
            />
            <AppInput
              label="Nationality"
              required
              value={nationality}
              onChangeText={(value) => setNationality(value.replace(/\d+/g, ""))}
              placeholder="Tanzanian"
              autoCapitalize="words"
            />
            <View>
              <AppText variant="label" weight="semiBold" tone="muted" style={styles.sexLabel}>
                Sex (optional)
              </AppText>
              <View style={styles.segment}>
                {SEX_OPTIONS.map((option) => {
                  const active = sex === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      onPress={() => setSex(active ? "" : option)}
                      style={[styles.segmentItem, active && styles.segmentItemOn]}
                    >
                      <AppText variant="caption" weight="semiBold" tone={active ? "inverse" : "muted"}>
                        {option}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <AppInput
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Arrival details, accessibility needs, or preferences"
              multiline
              style={styles.notesInput}
            />
          </AppStack>
        </AppCard>

        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              PRICE
            </AppText>
            <View style={styles.priceRow}>
              <AppText variant="bodySmall" tone="muted" style={styles.flex}>
                {unitPrice ? `${unitPrice.toLocaleString()} ${currency} x ${travelers} travelers` : "Operator will confirm the price"}
              </AppText>
              {unitPrice ? (
                <AppText variant="bodySmall" weight="semiBold">
                  {total.toLocaleString()} {currency}
                </AppText>
              ) : null}
            </View>
            <View style={styles.divider} />
            <View style={styles.priceRow}>
              <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                Total
              </AppText>
              {unitPrice ? (
                <AmountText amount={total} currency={currency} variant="titleSm" weight="extraBold" tone="primary" />
              ) : (
                <AppText variant="titleSm" weight="bold" tone="primary">
                  Price on request
                </AppText>
              )}
            </View>
          </AppStack>
        </AppCard>

        {formError ? (
          <View style={styles.errorBox}>
            <AppText variant="caption" weight="semiBold" tone="danger">
              {formError}
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
            {unitPrice ? (
              <AmountText amount={total} currency={currency} variant="titleSm" weight="extraBold" />
            ) : (
              <AppText variant="titleSm" weight="extraBold">
                Request price
              </AppText>
            )}
          </View>
          <AppButton title="Create booking" onPress={submit} loading={submitting} disabled={!canSubmit} style={styles.barButton} />
        </View>
      </BottomActionBar>

      <CalendarRangeSheet
        visible={calendarVisible}
        checkIn={travelDate}
        checkOut={travelDate}
        mode="single"
        title="Select travel date"
        onClose={() => setCalendarVisible(false)}
        onApply={(date) => {
          setTravelDate(date);
          setCalendarVisible(false);
        }}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  body: { gap: spacing[4], paddingBottom: spacing[6] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing[5] },
  packageTop: { flexDirection: "row", gap: spacing[3], minWidth: 0 },
  packageIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  paymentStrip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    minWidth: 0
  },
  paymentLabel: { marginRight: spacing[1] },
  paymentLogoWrap: {
    width: 34,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 3
  },
  paymentLogo: { width: 28, height: 16 },
  counterRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50]
  },
  stepperBtnOff: { backgroundColor: colors.surface, borderColor: colors.border },
  stepperValue: { minWidth: 24, textAlign: "center" },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    minWidth: 0
  },
  airportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3],
    minWidth: 0
  },
  airportRowOn: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  airportCode: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  sectionIntro: { gap: spacing[1], minWidth: 0 },
  helperText: { lineHeight: 18 },
  choiceRow: { flexDirection: "row", gap: spacing[3] },
  choiceCard: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  choiceCardOn: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  sexLabel: { marginBottom: spacing[2] },
  segment: {
    flexDirection: "row",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: "hidden"
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  segmentItemOn: { backgroundColor: colors.primary },
  notesInput: { minHeight: 96, paddingTop: spacing[3], textAlignVertical: "top" },
  policyRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3], minWidth: 0 },
  policyLink: { flexDirection: "row", alignItems: "center", gap: spacing[1], marginTop: spacing[3], paddingLeft: 34 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  divider: { height: 1, backgroundColor: colors.border },
  errorBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    padding: spacing[3]
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  barButton: { minWidth: 150 },
  pressed: { opacity: 0.78 },
});
