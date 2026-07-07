import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CheckCircle2, Clock3, CreditCard, Landmark, MapPin, ReceiptText, ShieldCheck, Smartphone, Users } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ImageSourcePropType, Pressable, StyleSheet, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

import {
  AmountText,
  AppButton,
  AppCard,
  AppInput,
  AppStack,
  AppText,
  BottomActionBar,
  CodeText,
  SafeScreen,
  ScreenHeader,
  StateView
} from "../components";
import { ApiError } from "../lib/apiClient";
import { getBankOtpInstruction } from "../lib/bankOtp";
import { capTzPhoneInput, normalizeTzPhone } from "../lib/phone";
import { RootStackParamList } from "../navigation/types";
import {
  fetchTourPaymentStatus,
  initiateTourBankPayment,
  initiateTourCardPayment,
  initiateTourMnoPayment,
  TourPaymentBooking
} from "../tours";
import { colors, radius, spacing } from "../theme";

import airtelLogo from "../../assets/payments/airtel.png";
import crdbLogo from "../../assets/payments/crdb.png";
import halopesaLogo from "../../assets/payments/halopesa.png";
import mastercardLogo from "../../assets/payments/mastercard.png";
import mixxLogo from "../../assets/payments/mixx.png";
import mpesaLogo from "../../assets/payments/mpesa.png";
import nmbLogo from "../../assets/payments/nmb.png";
import visaLogo from "../../assets/payments/visa.png";

type Props = NativeStackScreenProps<RootStackParamList, "TourBookingPayment">;
type Status = "idle" | "pending" | "success" | "timeout" | "failed";
type Channel = "MNO" | "BANK" | "CARD";
type MnoProvider = "Mpesa" | "Tigo" | "Airtel" | "Halopesa";
type TourMnoProviderCode = "MPESA" | "Mixx" | "Airtel" | "Halopesa";

const CARD_RETURN_URL = "nolsaf://tour-card-return";
const PAYMENT_WAIT_SECONDS = 4 * 60;
const POLL_MAX_ATTEMPTS = 45;

const PROVIDERS: Array<{ id: MnoProvider; name: string; logo: ImageSourcePropType }> = [
  { id: "Mpesa", name: "Mpesa", logo: mpesaLogo },
  { id: "Tigo", name: "Tigo", logo: mixxLogo },
  { id: "Airtel", name: "Airtel Money", logo: airtelLogo },
  { id: "Halopesa", name: "HaloPesa", logo: halopesaLogo }
];

const TOUR_PROVIDER_CODES: Record<MnoProvider, TourMnoProviderCode> = {
  Mpesa: "MPESA",
  Tigo: "Mixx",
  Airtel: "Airtel",
  Halopesa: "Halopesa"
};

const BANKS: Array<{ code: "CRDB" | "NMB"; name: string; logo: ImageSourcePropType }> = [
  { code: "CRDB", name: "CRDB Bank", logo: crdbLogo },
  { code: "NMB", name: "NMB Bank", logo: nmbLogo }
];

function formatCountdown(total: number) {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function prettyDate(value?: string | null) {
  if (!value) return "Date not set";
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function TourBookingPaymentScreen({ navigation, route }: Props) {
  const { bookingId, accessToken } = route.params;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [booking, setBooking] = useState<TourPaymentBooking | null>(null);
  const [channel, setChannel] = useState<Channel>("MNO");
  const [showChannelChoices, setShowChannelChoices] = useState(false);
  const [provider, setProvider] = useState<MnoProvider | null>(null);
  const [phone, setPhone] = useState("");
  const [bankCode, setBankCode] = useState<"CRDB" | "NMB" | "">("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankMobile, setBankMobile] = useState("");
  const [bankOtp, setBankOtp] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(PAYMENT_WAIT_SECONDS);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    pollRef.current = null;
    countdownRef.current = null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchTourPaymentStatus(bookingId, accessToken);
      setBooking(res.booking);
      if (res.booking.paymentStatus === "PAID") setStatus("success");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this tour payment.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, bookingId]);

  useEffect(() => {
    load();
    return () => stopPolling();
  }, [load, stopPolling]);

  const beginPolling = useCallback(() => {
    stopPolling();
    attemptsRef.current = 0;
    setRemaining(PAYMENT_WAIT_SECONDS);

    countdownRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          stopPolling();
          setStatus((current) => (current === "pending" ? "timeout" : current));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const scheduleNext = () => {
      if (attemptsRef.current >= POLL_MAX_ATTEMPTS) {
        stopPolling();
        setStatus((current) => (current === "pending" ? "timeout" : current));
        return;
      }
      const delay = attemptsRef.current < 20 ? 3000 : 10000;
      pollRef.current = setTimeout(async () => {
        attemptsRef.current += 1;
        try {
          const res = await fetchTourPaymentStatus(bookingId, accessToken);
          setBooking(res.booking);
          if (res.booking.paymentStatus === "PAID") {
            stopPolling();
            setStatus("success");
            setError(null);
            return;
          }
        } catch {
          // Keep polling through short network interruptions.
        }
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }, [accessToken, bookingId, stopPolling]);

  function handleError(err: unknown) {
    const api = err as ApiError;
    setError(api?.message || "Could not start payment. Please try again.");
    setStatus("failed");
  }

  async function payMobileMoney() {
    const phoneForApi = normalizeTzPhone(phone);
    if (!provider) {
      setError("Choose a mobile money provider.");
      return;
    }
    if (!phoneForApi) {
      setError("Enter a valid phone number.");
      return;
    }
    setError(null);
    setStatus("pending");
    try {
      const res = await initiateTourMnoPayment({ bookingId, accessToken, phoneNumber: phoneForApi, provider: TOUR_PROVIDER_CODES[provider] });
      setPaymentRef(res.paymentRef || res.transactionId || null);
      beginPolling();
    } catch (err) {
      handleError(err);
    }
  }

  async function payBank() {
    if (!bankCode) {
      setError("Choose your bank.");
      return;
    }
    const bankMobileForApi = normalizeTzPhone(bankMobile);
    if (!bankAccount.trim()) {
      setError("Enter the bank account number you selected while generating the OTP.");
      return;
    }
    if (!bankMobileForApi) {
      setError("Enter the mobile number registered with your bank account.");
      return;
    }
    if (!bankOtp.trim()) {
      setError("Enter the OTP generated from your bank menu.");
      return;
    }
    setError(null);
    setStatus("pending");
    try {
      const res = await initiateTourBankPayment({
        bookingId,
        accessToken,
        bankCode,
        accountNumber: bankAccount.trim(),
        merchantMobileNumber: bankMobileForApi,
        otp: bankOtp.trim()
      });
      setPaymentRef(res.paymentRef || res.transactionId || null);
      beginPolling();
    } catch (err) {
      handleError(err);
    }
  }

  async function payCard() {
    setError(null);
    try {
      const res = await initiateTourCardPayment({ bookingId, accessToken });
      if (!res.checkoutUrl) {
        setError("Card payment is not available yet. Use mobile money or bank.");
        return;
      }
      setPaymentRef(res.paymentRef || res.transactionId || null);
      await WebBrowser.openAuthSessionAsync(res.checkoutUrl, CARD_RETURN_URL);
      setStatus("pending");
      beginPolling();
    } catch (err) {
      handleError(err);
    }
  }

  if (loading) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Tour payment" onBack={() => navigation.goBack()} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeScreen>
    );
  }

  if (loadError || !booking) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Tour payment" onBack={() => navigation.goBack()} />
        <View style={styles.centerFill}>
          <StateView title="Could not load payment" message={loadError || "Tour booking not found."} actionLabel="Try again" onAction={load} />
        </View>
      </SafeScreen>
    );
  }

  const currency = booking.currency || "TZS";
  const total = Number(booking.grossAmount || 0);
  const operatorName = booking.operatorSnapshot?.companyName || "Tour operator";
  const bankInstruction = getBankOtpInstruction(bankCode);
  const bankReady = Boolean(bankCode && bankAccount.trim() && normalizeTzPhone(bankMobile) && bankOtp.trim());

  if (status === "success") {
    return (
      <SafeScreen contentStyle={styles.body}>
        <View style={styles.successMark}>
          <CheckCircle2 color={colors.success} size={42} />
        </View>
        <AppText variant="title" weight="extraBold" style={styles.centerText}>
          Payment confirmed
        </AppText>
        <AppText variant="bodySmall" tone="muted" style={styles.centerText}>
          Your tour package is paid. Keep the booking code ready for your trip.
        </AppText>
        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              BOOKING CODE
            </AppText>
            {booking.bookingCode ? (
              <CodeText value={booking.bookingCode} variant="title" weight="extraBold" tone="primary" maxLines={1} />
            ) : (
              <AppText variant="bodySmall" tone="muted">
                Your booking code will appear shortly.
              </AppText>
            )}
            <SummaryRows booking={booking} currency={currency} />
          </AppStack>
        </AppCard>
        <AppButton title="Open My Tours" onPress={() => navigation.navigate("MyTours")} icon={<ReceiptText color={colors.white} size={18} />} />
        <AppButton title="Browse more tours" variant="secondary" onPress={() => navigation.navigate("TourPackages")} />
      </SafeScreen>
    );
  }

  if (status === "pending") {
    return (
      <SafeScreen contentStyle={styles.body}>
        <ScreenHeader title="Confirming payment" onBack={() => navigation.goBack()} />
        <AppCard>
          <AppStack gap={4}>
            <View style={styles.pendingHead}>
              <ActivityIndicator color={colors.primary} />
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="bold">
                  {channel === "BANK" ? "Confirm in your bank" : channel === "CARD" ? "Verifying card payment" : "Check your phone"}
                </AppText>
                <AppText variant="bodySmall" tone="muted">
                  {channel === "BANK"
                    ? "We are confirming the bank checkout using the OTP you generated."
                    : channel === "CARD"
                      ? "We are checking the card payment result."
                      : "Approve the mobile money prompt to complete payment."}
                </AppText>
              </View>
            </View>
            <View style={styles.countdownBox}>
              <Clock3 color={colors.primary} size={16} />
              <AppText variant="title" weight="extraBold" tone="primary">
                {formatCountdown(remaining)}
              </AppText>
              <AppText variant="caption" tone="soft">
                time left
              </AppText>
            </View>
            {paymentRef ? (
              <View style={styles.refBox}>
                <AppText variant="caption" tone="soft">
                  Reference
                </AppText>
                <CodeText value={paymentRef} maxLines={1} />
              </View>
            ) : null}
          </AppStack>
        </AppCard>
      </SafeScreen>
    );
  }

  return (
    <View style={styles.flex}>
      <SafeScreen contentStyle={styles.body}>
        <ScreenHeader title="Tour payment" subtitle="Pay now to confirm your tour." onBack={() => navigation.goBack()} />

        {status === "timeout" ? (
          <View style={styles.noticeWarn}>
            <AppText variant="caption" weight="semiBold" tone="warning">
              Payment confirmation took too long. You can try again below.
            </AppText>
          </View>
        ) : null}

        <AppCard>
          <AppStack gap={3}>
            <View style={styles.heroSummary}>
              <View style={styles.summaryIcon}>
                <MapPin color={colors.white} size={20} />
              </View>
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="extraBold" tone="inverse" numberOfLines={2}>
                  {booking.title || "Tour package"}
                </AppText>
                <AppText variant="caption" tone="inverse" numberOfLines={1} style={styles.heroSubtitle}>
                  {operatorName}
                </AppText>
              </View>
            </View>
            <SummaryRows booking={booking} currency={currency} />
            <View style={styles.divider} />
            <View style={styles.totalRow}>
              <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                Total
              </AppText>
              <AmountText amount={total} currency={currency} variant="titleSm" weight="extraBold" tone="primary" />
            </View>
          </AppStack>
        </AppCard>

        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              PAY WITH
            </AppText>
            <View style={styles.channelRow}>
              {[
                { key: "MNO" as Channel, label: "Mobile", Icon: Smartphone, color: "#dc2626", bg: "#fff1f2", border: "#fecdd3" },
                { key: "BANK" as Channel, label: "Bank", Icon: Landmark, color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
                { key: "CARD" as Channel, label: "Card", Icon: CreditCard, color: "#6d28d9", bg: "#f5f3ff", border: "#ddd6fe" }
              ]
                .filter((item) => showChannelChoices || item.key === channel)
                .map(({ key, label, Icon, color, bg, border }) => {
                const active = channel === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    onPress={() => {
                      setChannel(key);
                      setShowChannelChoices(false);
                      setError(null);
                    }}
                    style={[styles.channelTab, active && { backgroundColor: bg, borderColor: color }, !active && { borderColor: border }]}
                  >
                    <Icon color={color} size={18} />
                    <AppText variant="caption" weight="bold" style={{ color: active ? color : colors.mutedText }} numberOfLines={1}>
                      {label}
                    </AppText>
                  </Pressable>
                );
              })}
              {!showChannelChoices ? (
                <Pressable accessibilityRole="button" onPress={() => setShowChannelChoices(true)} style={styles.changeChannelBtn}>
                  <AppText variant="caption" weight="bold" tone="primary">
                    Change
                  </AppText>
                </Pressable>
              ) : null}
            </View>

            {channel === "MNO" ? (
              <>
                <View style={styles.providerGrid}>
                  {PROVIDERS.map((item) => {
                    const active = provider === item.id;
                    return (
                      <Pressable key={item.id} accessibilityRole="button" onPress={() => setProvider(item.id)} style={[styles.providerTile, active && styles.providerTileOn]}>
                        <Image source={item.logo} style={styles.providerLogo} resizeMode="contain" />
                        <AppText variant="caption" weight="semiBold" tone={active ? "primary" : "muted"} numberOfLines={1}>
                          {item.name}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
                <AppInput
                  label="Mobile money number"
                  value={phone}
                  onChangeText={(value) => setPhone(capTzPhoneInput(value))}
                  placeholder="07XXXXXXXX or +255 7XXXXXXXX"
                  keyboardType="phone-pad"
                  maxLength={13}
                />
              </>
            ) : channel === "BANK" ? (
              <>
                <View style={styles.bankList}>
                  {BANKS.map((item) => {
                    const active = bankCode === item.code;
                    return (
                      <Pressable key={item.code} accessibilityRole="button" onPress={() => setBankCode(item.code)} style={[styles.bankTile, active && styles.bankTileOn]}>
                        <Image source={item.logo} style={styles.bankLogo} resizeMode="contain" />
                        <View style={styles.flex}>
                          <AppText variant="bodySmall" weight="bold">
                            {item.name}
                          </AppText>
                          <AppText variant="caption" tone="soft">
                            OTP checkout
                          </AppText>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                {bankInstruction ? (
                  <View style={styles.otpGuide}>
                    <AppText variant="caption" weight="bold" tone="primary">
                      {bankInstruction.title}
                    </AppText>
                    {bankInstruction.steps.map((step, index) => (
                      <AppText key={step} variant="caption" tone="muted">
                        {index + 1}. {step}
                      </AppText>
                    ))}
                  </View>
                ) : null}
                <AppInput
                  label="Bank account number"
                  required
                  value={bankAccount}
                  onChangeText={setBankAccount}
                  placeholder="Account number selected for OTP"
                  keyboardType="number-pad"
                  maxLength={30}
                />
                <AppInput
                  label="Bank registered mobile number"
                  required
                  value={bankMobile}
                  onChangeText={(value) => setBankMobile(capTzPhoneInput(value))}
                  placeholder="07XXXXXXXX or +255 7XXXXXXXX"
                  keyboardType="phone-pad"
                  maxLength={13}
                />
                <AppInput
                  label="Bank OTP"
                  required
                  value={bankOtp}
                  onChangeText={setBankOtp}
                  placeholder="Enter OTP from bank menu"
                  keyboardType="number-pad"
                  maxLength={50}
                />
              </>
            ) : (
              <View style={styles.cardPanel}>
                <View style={styles.cardLogos}>
                  <Image source={visaLogo} style={styles.cardLogo} resizeMode="contain" />
                  <Image source={mastercardLogo} style={styles.cardLogo} resizeMode="contain" />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="bold">
                    Card checkout
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    Opens secure hosted checkout.
                  </AppText>
                </View>
              </View>
            )}
          </AppStack>
        </AppCard>

        {error ? (
          <View style={styles.errorBox}>
            <AppText variant="caption" weight="semiBold" tone="danger">
              {error}
            </AppText>
          </View>
        ) : null}

        <View style={styles.secureRow}>
          <ShieldCheck color={colors.primary} size={15} />
          <AppText variant="caption" tone="soft" style={styles.flex}>
            Payments are processed securely.
          </AppText>
        </View>
      </SafeScreen>

      <BottomActionBar>
        <AppButton
          title={`Pay ${total.toLocaleString()} ${currency}`}
          onPress={channel === "BANK" ? payBank : channel === "CARD" ? payCard : payMobileMoney}
          disabled={channel === "BANK" ? !bankReady : channel === "CARD" ? false : !provider || !phone.trim()}
          icon={channel === "BANK" ? <Landmark color={colors.white} size={18} /> : channel === "CARD" ? <CreditCard color={colors.white} size={18} /> : <Smartphone color={colors.white} size={18} />}
        />
      </BottomActionBar>
    </View>
  );
}

function SummaryRows({ booking, currency }: { booking: TourPaymentBooking; currency: string }) {
  return (
    <AppStack gap={3}>
      <View style={styles.summaryGrid}>
        {booking.destination ? <SummaryTile label="Destination" value={booking.destination} /> : null}
        <SummaryTile label="Travel date" value={prettyDate(booking.startDate)} />
        <SummaryTile label="Travelers" value={String(booking.travelerCount || 1)} Icon={Users} />
        {booking.unitPrice ? <SummaryTile label="Package price" value={`${Number(booking.unitPrice).toLocaleString()} ${currency}`} /> : null}
      </View>
      <View style={styles.breakdownBox}>
        <PriceLine label="VAT or Tax" value={`0 ${currency}`} />
        <PriceLine label="Extra charges" value={`0 ${currency}`} />
      </View>
    </AppStack>
  );
}

function SummaryTile({ label, value, Icon }: { label: string; value: string; Icon?: typeof Users }) {
  return (
    <View style={styles.summaryTile}>
      <View style={styles.tileLabel}>
        {Icon ? <Icon color={colors.softText} size={13} /> : null}
        <AppText variant="caption" weight="bold" tone="muted" numberOfLines={1} style={styles.flex}>
          {label}
        </AppText>
      </View>
      <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

function PriceLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.priceLine}>
      <AppText variant="bodySmall" tone="muted" style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="semiBold">
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  body: { gap: spacing[4], paddingBottom: spacing[6] },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing[5] },
  centerText: { textAlign: "center" },
  successMark: {
    alignSelf: "center",
    width: 76,
    height: 76,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e9f7ef",
    marginTop: spacing[4]
  },
  heroSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryDeep,
    padding: spacing[4]
  },
  heroSubtitle: { opacity: 0.78 },
  summaryIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)"
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  summaryTile: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 0,
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  tileLabel: { flexDirection: "row", alignItems: "center", gap: spacing[1], minWidth: 0 },
  breakdownBox: {
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[3]
  },
  priceLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    minWidth: 0
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    padding: spacing[3]
  },
  divider: { height: 1, backgroundColor: colors.border },
  channelRow: { flexDirection: "row", gap: spacing[2], alignItems: "stretch" },
  channelTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: spacing[3]
  },
  channelTabOn: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  changeChannelBtn: {
    minWidth: 82,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3]
  },
  providerGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  providerTile: {
    width: "48%",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2]
  },
  providerTileOn: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  providerLogo: { width: 64, height: 28 },
  bankList: { gap: spacing[2] },
  bankTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  bankTileOn: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  bankLogo: { width: 52, height: 34 },
  otpGuide: {
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  cardPanel: {
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
  cardLogos: { flexDirection: "row", gap: spacing[2] },
  cardLogo: { width: 46, height: 30 },
  pendingHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3], minWidth: 0 },
  countdownBox: { alignItems: "center", gap: spacing[1], borderRadius: radius.md, backgroundColor: colors.brand[50], paddingVertical: spacing[4] },
  refBox: { gap: spacing[1], borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing[3] },
  noticeWarn: { borderRadius: radius.md, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fff8e6", padding: spacing[3] },
  errorBox: { borderRadius: radius.md, borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2", padding: spacing[3] },
  secureRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], minWidth: 0, paddingHorizontal: spacing[1] }
});
