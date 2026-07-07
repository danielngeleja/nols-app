import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CheckCircle2, Clock3, CreditCard, Landmark, ReceiptText, ShieldCheck, Smartphone } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ImageSourcePropType, Pressable, StyleSheet, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { useAuth } from "../auth";
import {
  fetchInvoice,
  initiateBankPayment,
  initiateCardPayment,
  initiateMnoPayment,
  type InvoiceData,
  type MnoProvider
} from "../bookings";
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
import { colors, radius, spacing } from "../theme";

import airtelLogo from "../../assets/payments/airtel.png";
import crdbLogo from "../../assets/payments/crdb.png";
import visaLogo from "../../assets/payments/visa.png";
import halopesaLogo from "../../assets/payments/halopesa.png";
import mixxLogo from "../../assets/payments/mixx.png";
import mpesaLogo from "../../assets/payments/mpesa.png";
import nmbLogo from "../../assets/payments/nmb.png";

type Props = NativeStackScreenProps<RootStackParamList, "BookingPayment">;

type PayStatus = "idle" | "pending" | "success" | "timeout" | "failed";
type Channel = "MNO" | "BANK" | "CARD";

const CARD_RETURN_URL = "nolsaf://card-return";

const PAYMENT_WAIT_SECONDS = 4 * 60;
const POLL_MAX_ATTEMPTS = 45;

const PROVIDERS: Array<{ id: MnoProvider; name: string; logo: ImageSourcePropType }> = [
  { id: "Mpesa", name: "Mpesa", logo: mpesaLogo },
  { id: "Tigo", name: "Mixx by Yas", logo: mixxLogo },
  { id: "Airtel", name: "Airtel Money", logo: airtelLogo },
  { id: "Halopesa", name: "HaloPesa", logo: halopesaLogo }
];

// AzamPay Bank Checkout only settles CRDB and NMB. Listing more would let a
// guest pick a bank that always fails. Add others only when AzamPay confirms them.
// To show real logos, drop crdb.png / nmb.png into assets/payments and set `logo`.
const BANKS: Array<{ code: string; name: string; tagline: string; color: string; logo?: ImageSourcePropType }> = [
  { code: "CRDB", name: "CRDB Bank", tagline: "Pay from your CRDB account", color: "#0E7C3A", logo: crdbLogo },
  { code: "NMB", name: "NMB Bank", tagline: "Pay from your NMB account", color: "#00A1DE", logo: nmbLogo }
];

function formatCountdown(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function BookingPaymentScreen({ navigation, route }: Props) {
  const { token } = useAuth();
  const { invoiceId, accessToken } = route.params;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);

  const [channel, setChannel] = useState<Channel>("MNO");
  const [provider, setProvider] = useState<MnoProvider | null>(null);
  const [phone, setPhone] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankMobile, setBankMobile] = useState("");
  const [bankOtp, setBankOtp] = useState("");
  const [status, setStatus] = useState<PayStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(PAYMENT_WAIT_SECONDS);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const inv = await fetchInvoice(invoiceId, accessToken);
      setInvoice(inv);
      // Do not prefill: the payer enters the number for the account they want
      // charged, which may differ from the booking contact.
      if (inv.status === "PAID") setStatus("success");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this invoice.");
    } finally {
      setLoading(false);
    }
  }, [invoiceId, accessToken]);

  useEffect(() => {
    load();
    return () => stopPolling();
  }, [load, stopPolling]);

  const beginPolling = useCallback(() => {
    attemptsRef.current = 0;
    setRemaining(PAYMENT_WAIT_SECONDS);

    countdownRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          stopPolling();
          setStatus((s) => (s === "pending" ? "timeout" : s));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const pollOnce = async (): Promise<boolean> => {
      const inv = await fetchInvoice(invoiceId, accessToken);
      setInvoice(inv);
      if (inv.status === "PAID") {
        stopPolling();
        setStatus("success");
        setError(null);
        return true;
      }
      return false;
    };

    const scheduleNext = () => {
      if (attemptsRef.current >= POLL_MAX_ATTEMPTS) {
        stopPolling();
        setStatus((s) => (s === "pending" ? "timeout" : s));
        return;
      }
      const delay = attemptsRef.current < 20 ? 3000 : 10000;
      pollRef.current = setTimeout(async () => {
        attemptsRef.current += 1;
        try {
          const done = await pollOnce();
          if (done) return;
        } catch {
          // transient — keep polling
        }
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }, [invoiceId, accessToken, stopPolling]);

  async function handlePay() {
    if (!invoice || !provider) {
      setError("Choose a mobile network to continue.");
      return;
    }
    const phoneForApi = normalizeTzPhone(phone);
    if (!phoneForApi) {
      setError("Enter a valid phone, for example 0712 345 678 or +255 712 345 678.");
      return;
    }

    setError(null);
    setStatus("pending");
    try {
      const res = await initiateMnoPayment(token, {
        invoiceId: invoice.id,
        phoneNumber: phoneForApi,
        provider,
        accessToken
      });
      setPaymentRef(res.paymentRef || res.transactionId || invoice.paymentRef || null);
      beginPolling();
    } catch (err) {
      handlePayError(err);
    }
  }

  async function handleBankPay() {
    if (!invoice || !bankCode) {
      setError("Choose your bank to continue.");
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
      const res = await initiateBankPayment(token, {
        invoiceId: invoice.id,
        bankCode,
        accountNumber: bankAccount.trim(),
        merchantMobileNumber: bankMobileForApi,
        otp: bankOtp.trim(),
        accessToken
      });
      setPaymentRef(res.paymentRef || res.transactionId || invoice.paymentRef || null);
      beginPolling();
    } catch (err) {
      handlePayError(err);
    }
  }

  async function handleCardPay() {
    if (!invoice) return;
    setError(null);
    try {
      const res = await initiateCardPayment(token, { invoiceId: invoice.id, accessToken });
      const url = res.checkoutUrl;
      if (!url) {
        setError("Card payment could not start. Please use mobile money or bank for now.");
        return;
      }
      setPaymentRef(res.paymentRef || res.transactionId || invoice.paymentRef || null);
      // Open the hosted card checkout page. The session resolves when the user is
      // redirected back or closes it; either way we confirm via polling, since
      // the webhook is the authoritative "paid" signal.
      await WebBrowser.openAuthSessionAsync(url, CARD_RETURN_URL);
      setStatus("pending");
      beginPolling();
    } catch (err) {
      const api = err as ApiError;
      if (api?.status === 503) {
        setError(api?.message || "Card payment is being set up. Please use mobile money or bank for now.");
      } else if (api?.status === 401) {
        setError("Your session expired. Please sign in again to pay.");
      } else {
        setError(api?.message || "Could not start the card payment. Please try again.");
      }
    }
  }

  function handlePayError(err: unknown) {
    const api = err as ApiError;
    if (api?.status === 429) {
      setError("Too many payment attempts. Please wait a moment and try again.");
    } else if (api?.status === 401) {
      setError("Your session expired. Please sign in again to pay.");
    } else {
      setError(api?.message || "Could not start the payment. Please try again.");
    }
    setStatus("failed");
  }

  if (loading) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Payment" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeScreen>
    );
  }

  if (loadError || !invoice) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Payment" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <StateView title="Could not load payment" message={loadError || "Invoice not found."} actionLabel="Try again" onAction={load} />
        </View>
      </SafeScreen>
    );
  }

  const currency = invoice.currency || "TZS";
  const breakdown = invoice.priceBreakdown;
  const bookingCode = invoice.booking.bookingCode;
  const bankInstruction = getBankOtpInstruction(bankCode);
  const bankReady = Boolean(bankCode && bankAccount.trim() && normalizeTzPhone(bankMobile) && bankOtp.trim());

  // ── Success ──
  if (status === "success") {
    return (
      <SafeScreen contentStyle={styles.body}>
        <View style={styles.successMark}>
          <CheckCircle2 color={colors.success} size={40} />
        </View>
        <AppText variant="title" weight="extraBold" style={styles.center}>
          Payment successful
        </AppText>
        <AppText variant="bodySmall" tone="muted" style={styles.center}>
          Your stay at {invoice.property.title} is confirmed.
        </AppText>

        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              BOOKING CODE
            </AppText>
            {bookingCode ? (
              <CodeText value={bookingCode} variant="title" weight="bold" tone="primary" maxLines={1} />
            ) : (
              <AppText variant="bodySmall" tone="muted">
                Your booking code is being generated and will appear in My Bookings shortly.
              </AppText>
            )}
            <AppText variant="caption" tone="soft">
              Present this code at check in.
            </AppText>
          </AppStack>
        </AppCard>

        <AppButton
          title="Go to My Bookings"
          icon={<ReceiptText color={colors.white} size={18} />}
          onPress={() => navigation.navigate("MyBookings")}
        />
        <AppButton title="Back to home" variant="secondary" onPress={() => navigation.navigate("Onboarding")} />
      </SafeScreen>
    );
  }

  // ── Pending ──
  if (status === "pending") {
    return (
      <SafeScreen contentStyle={styles.body}>
        <ScreenHeader title="Waiting for payment" onBack={() => navigation.goBack()} />
        <AppCard>
          <AppStack gap={4}>
            <View style={styles.pendingHead}>
              <ActivityIndicator color={colors.primary} />
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="bold">
                  {channel === "BANK" ? "Confirm in your bank" : channel === "CARD" ? "Verifying your card" : "Check your phone"}
                </AppText>
                <AppText variant="bodySmall" tone="muted">
                  {channel === "BANK"
                    ? `We are confirming the ${BANKS.find((b) => b.code === bankCode)?.name || "bank"} checkout using the OTP you generated.`
                    : channel === "CARD"
                      ? "We are confirming your card payment. This can take a moment."
                      : `We sent a payment request to ${phone}. Approve the prompt on your mobile money account to confirm.`}
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
              <View style={styles.refRow}>
                <AppText variant="caption" tone="soft">
                  Reference
                </AppText>
                <CodeText value={paymentRef} maxLines={1} />
              </View>
            ) : null}
            <AppText variant="caption" tone="soft" style={styles.center}>
              Keep this screen open while we confirm.
            </AppText>
          </AppStack>
        </AppCard>
      </SafeScreen>
    );
  }

  // ── Idle / failed / timeout: choose method + pay ──
  return (
    <View style={styles.flex}>
      <SafeScreen contentStyle={styles.body}>
        <ScreenHeader title="Payment" subtitle="Choose how to pay to confirm your stay." onBack={() => navigation.goBack()} />

        {status === "timeout" ? (
          <View style={styles.noticeWarn}>
            <AppText variant="caption" weight="semiBold" tone="warning">
              We did not get a confirmation yet. Your booking is saved. You can send the request again below.
            </AppText>
          </View>
        ) : null}

        {/* Summary */}
        <AppCard>
          <AppStack gap={3}>
            <View style={styles.summaryHead}>
              {invoice.property.primaryImage ? (
                <Image source={{ uri: invoice.property.primaryImage }} style={styles.summaryImage} />
              ) : (
                <View style={[styles.summaryImage, styles.summaryImageEmpty]} />
              )}
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
                  {invoice.property.title}
                </AppText>
                <AppText variant="caption" tone="soft">
                  {invoice.booking.nights} {invoice.booking.nights === 1 ? "night" : "nights"}
                  {invoice.booking.roomCode ? ` · ${invoice.booking.roomCode}` : ""}
                </AppText>
              </View>
            </View>
            <View style={styles.divider} />
            {breakdown ? (
              <>
                <Row label="Accommodation" value={`${breakdown.accommodationSubtotal.toLocaleString()} ${currency}`} />
                {breakdown.transportFare > 0 ? (
                  <Row label="Transport" value={`${breakdown.transportFare.toLocaleString()} ${currency}`} />
                ) : null}
                {/* Tax is always shown for transparency, even when it is 0. */}
                <Row
                  label={`Tax${breakdown.taxPercent ? ` (${breakdown.taxPercent}%)` : ""}`}
                  value={`${(breakdown.taxAmount || 0).toLocaleString()} ${currency}`}
                />
                {breakdown.discount > 0 ? <Row label="Discount" value={`-${breakdown.discount.toLocaleString()} ${currency}`} /> : null}
                <View style={styles.divider} />
              </>
            ) : null}
            <View style={styles.priceRow}>
              <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                Total
              </AppText>
              <AmountText amount={invoice.totalAmount} currency={currency} variant="titleSm" weight="extraBold" tone="primary" />
            </View>
          </AppStack>
        </AppCard>

        {/* Payment method */}
        <AppCard>
          <AppStack gap={3}>
            <AppText variant="label" weight="bold" tone="muted">
              PAY WITH
            </AppText>

            {/* Channel selector */}
            <View style={styles.channelRow}>
              {(
                [
                  { key: "MNO", label: "Mobile money", Icon: Smartphone, color: "#dc2626" },
                  { key: "BANK", label: "Bank", Icon: Landmark, color: "#15803d" },
                  { key: "CARD", label: "Card", Icon: CreditCard, color: "#6d28d9" }
                ] as Array<{ key: Channel; label: string; Icon: typeof Smartphone; color: string }>
              ).map(({ key, label, Icon, color }) => {
                const on = channel === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    onPress={() => {
                      setChannel(key);
                      setError(null);
                    }}
                    style={[styles.channelTab, on && styles.channelTabOn]}
                  >
                    <Icon color={color} size={18} />
                    <AppText variant="caption" weight="bold" tone={on ? "primary" : "default"} numberOfLines={1}>
                      {label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.methodPanel}>
              <AppStack gap={3}>
            {channel === "MNO" ? (
              <>
                <View style={styles.providerGrid}>
                  {PROVIDERS.map((p) => {
                    const active = provider === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        accessibilityRole="button"
                        accessibilityLabel={p.name}
                        onPress={() => setProvider(p.id)}
                        style={[styles.providerTile, active && styles.providerTileOn]}
                      >
                        <Image source={p.logo} style={styles.providerLogo} resizeMode="contain" />
                        <AppText variant="caption" weight="semiBold" tone={active ? "primary" : "muted"} numberOfLines={1}>
                          {p.name}
                        </AppText>
                        {active ? (
                          <View style={styles.providerCheck}>
                            <CheckCircle2 color={colors.primary} size={16} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
                <AppInput
                  label="Phone number"
                  value={phone}
                  onChangeText={(t) => setPhone(capTzPhoneInput(t))}
                  placeholder="07XXXXXXXX or +255 7XXXXXXXX"
                  keyboardType="phone-pad"
                  maxLength={13}
                />
                {provider ? (
                  <AppText variant="caption" tone="soft">
                    Enter the number linked to your {PROVIDERS.find((p) => p.id === provider)?.name} account.
                  </AppText>
                ) : null}
              </>
            ) : channel === "BANK" ? (
              <>
                <AppText variant="caption" weight="semiBold" tone="muted">
                  Select your bank
                </AppText>
                <View style={styles.bankList}>
                  {BANKS.map((b) => {
                    const active = bankCode === b.code;
                    return (
                      <Pressable
                        key={b.code}
                        accessibilityRole="button"
                        onPress={() => setBankCode(b.code)}
                        style={[styles.bankTile, active && styles.bankTileOn]}
                      >
                        {b.logo ? (
                          <Image source={b.logo} style={styles.bankLogo} resizeMode="contain" />
                        ) : (
                          <View style={[styles.bankBadge, { backgroundColor: b.color }]}>
                            <AppText variant="caption" weight="extraBold" tone="inverse">
                              {b.code}
                            </AppText>
                          </View>
                        )}
                        <View style={styles.flex}>
                          <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                            {b.name}
                          </AppText>
                          <AppText variant="caption" tone="soft" numberOfLines={1}>
                            {b.tagline}
                          </AppText>
                        </View>
                        <View style={[styles.bankRadio, active && styles.bankRadioOn]}>
                          {active ? <CheckCircle2 color={colors.white} size={14} /> : null}
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
                  onChangeText={(t) => setBankMobile(capTzPhoneInput(t))}
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
                <AppText variant="caption" tone="soft">
                  Use the OTP generated from your bank SIM menu. The OTP is submitted securely to confirm this checkout.
                </AppText>
              </>
            ) : (
              <>
                <View style={styles.cardHead}>
                  <Image source={visaLogo} style={styles.cardBrand} resizeMode="contain" />
                  <View style={styles.cardMastercard}>
                    <View style={[styles.mcDot, styles.mcRed]} />
                    <View style={[styles.mcDot, styles.mcYellow]} />
                  </View>
                </View>
                <View style={styles.cardNote}>
                  <ShieldCheck color={colors.primary} size={16} />
                  <AppText variant="caption" tone="muted" style={styles.flex}>
                    You will be taken to a secure hosted checkout page to enter your card details, then brought back here. We
                    never see your card number.
                  </AppText>
                </View>
              </>
            )}
              </AppStack>
            </View>
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
            Payments are processed securely through our payment partner.
          </AppText>
        </View>
      </SafeScreen>

      <BottomActionBar>
        <AppButton
          title={
            status === "timeout" || status === "failed"
              ? "Try again"
              : channel === "CARD"
                ? `Continue to card ${invoice.totalAmount.toLocaleString()} ${currency}`
                : `Pay ${invoice.totalAmount.toLocaleString()} ${currency}`
          }
          icon={
            channel === "BANK" ? (
              <Landmark color={colors.white} size={18} />
            ) : channel === "CARD" ? (
              <CreditCard color={colors.white} size={18} />
            ) : (
              <Smartphone color={colors.white} size={18} />
            )
          }
          onPress={channel === "BANK" ? handleBankPay : channel === "CARD" ? handleCardPay : handlePay}
          disabled={channel === "BANK" ? !bankReady : channel === "CARD" ? false : !provider || !phone.trim()}
        />
      </BottomActionBar>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.priceRow}>
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
  flex: { flex: 1, backgroundColor: colors.surface },
  body: { gap: spacing[4], paddingBottom: spacing[6] },
  center: { alignItems: "center", justifyContent: "center", textAlign: "center" },
  successMark: {
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e9f7ef",
    marginTop: spacing[4]
  },
  pendingHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3], minWidth: 0 },
  countdownBox: {
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    paddingVertical: spacing[4]
  },
  refRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  summaryHead: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  summaryImage: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.brand[50] },
  summaryImageEmpty: { borderWidth: 1, borderColor: colors.border },
  divider: { height: 1, backgroundColor: colors.border },
  priceRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  channelRow: { flexDirection: "row", gap: spacing[2] },
  channelTab: {
    flex: 1,
    minWidth: 0,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1]
  },
  channelTabOn: { backgroundColor: colors.brand[50], borderColor: colors.primary },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  cardBrand: { width: 56, height: 34 },
  cardMastercard: { flexDirection: "row", alignItems: "center" },
  mcDot: { width: 22, height: 22, borderRadius: radius.full },
  mcRed: { backgroundColor: "#EB001B" },
  mcYellow: { backgroundColor: "#F79E1B", marginLeft: -8, opacity: 0.9 },
  cardNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    padding: spacing[3]
  },
  methodPanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: "#f3faf9",
    padding: spacing[3]
  },
  bankList: { gap: spacing[2] },
  bankTile: {
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
  bankTileOn: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  bankBadge: {
    minWidth: 52,
    height: 38,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[2]
  },
  bankLogo: { width: 52, height: 38 },
  bankRadio: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  bankRadioOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  otpGuide: {
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  providerGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  providerTile: {
    width: "48%",
    minWidth: 0,
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
  providerCheck: { position: "absolute", top: 6, right: 6 },
  errorBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: "#fdecec",
    padding: spacing[3]
  },
  noticeWarn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: "#fff7ed",
    padding: spacing[3]
  },
  secureRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], minWidth: 0 }
});
