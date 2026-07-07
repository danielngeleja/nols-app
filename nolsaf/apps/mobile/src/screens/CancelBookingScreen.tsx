import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Mail,
  MapPin,
  Phone,
  XCircle
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAuth } from "../auth";
import {
  CANCELLATION_EMAIL,
  CancellationLookup,
  lookupCancellation,
  refundOutcomeLabel,
  requestCancellation
} from "../cancellations";
import {
  AmountText,
  AppButton,
  AppCard,
  AppStack,
  AppText,
  CodeText,
  SafeScreen,
  ScreenHeader,
  StateView
} from "../components";
import { getErrorMessage } from "../lib/apiClient";
import { RootStackParamList } from "../navigation/types";
import { colors, fonts, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "CancelBooking">;

const MIN_WORDS = 50;
const MAX_WORDS = 100;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A labelled on/off toggle, styled like the transport bundle switch. */
function ConsentToggle({ value, onToggle, children }: { value: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={onToggle}
      style={[styles.consentRow, value && styles.consentRowOn]}
    >
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
      <AppText variant="caption" tone="muted" style={styles.flex}>
        {children}
      </AppText>
    </Pressable>
  );
}

export function CancelBookingScreen({ navigation, route }: Props) {
  const { token } = useAuth();
  const { bookingCode, propertyTitle } = route.params;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<CancellationLookup | null>(null);

  const [reason, setReason] = useState("");
  const [confirmPolicy, setConfirmPolicy] = useState(false);
  const [confirmTerms, setConfirmTerms] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoadError("Please sign in to cancel a booking.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      setLookup(await lookupCancellation(token, bookingCode));
    } catch (e) {
      setLoadError(getErrorMessage(e, "Could not load this booking."));
    } finally {
      setLoading(false);
    }
  }, [token, bookingCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const words = useMemo(() => countWords(reason), [reason]);
  const reasonOk = words >= MIN_WORDS && words <= MAX_WORDS;
  const canSubmit =
    !!lookup && lookup.eligibility.eligible && !lookup.existingRequest && confirmPolicy && confirmTerms && reasonOk && !submitting;

  const emailSupport = () => {
    const subject = encodeURIComponent(`Cancellation Request - Booking ${bookingCode}`);
    Linking.openURL(`mailto:${CANCELLATION_EMAIL}?subject=${subject}`).catch(() => undefined);
  };

  async function submit() {
    if (!token || !lookup) return;
    setError(null);
    if (!reasonOk) {
      setError(`Your reason must be ${MIN_WORDS}–${MAX_WORDS} words. You have ${words}.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await requestCancellation(token, { code: bookingCode, reason, confirmPolicy: true });
      navigation.replace("CancellationDetail", { id: res.request.id });
    } catch (e) {
      setError(getErrorMessage(e, "Could not submit your cancellation request."));
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Cancel booking" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeScreen>
    );
  }

  if (loadError || !lookup) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Cancel booking" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <StateView title="Could not load" message={loadError || "Booking not found."} actionLabel="Try again" onAction={load} />
        </View>
      </SafeScreen>
    );
  }

  const { booking, eligibility, existingRequest } = lookup;
  const area = [booking.property.regionName, booking.property.district, booking.property.city].filter(Boolean).join(", ");

  return (
    <SafeScreen contentStyle={styles.body}>
      <ScreenHeader
        title="Cancel booking"
        subtitle="Subject to the NoLSAF cancellation policy."
        onBack={() => navigation.goBack()}
      />

      {/* Booking summary */}
      <AppCard>
        <AppStack gap={3}>
          <View style={styles.summaryHead}>
            <View style={styles.summaryIcon}>
              <Ban color={colors.danger} size={18} />
            </View>
            <View style={styles.flex}>
              <AppText variant="caption" weight="bold" tone="soft" style={styles.eyebrow}>
                BOOKING
              </AppText>
              <AppText variant="titleSm" weight="bold" numberOfLines={2}>
                {booking.property.title || propertyTitle || "Your stay"}
              </AppText>
              {area ? (
                <View style={styles.metaRow}>
                  <MapPin color={colors.softText} size={13} />
                  <AppText variant="caption" tone="muted" numberOfLines={2} style={styles.flex}>
                    {area}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.datesRow}>
            <View style={styles.dateBox}>
              <AppText variant="caption" weight="bold" tone="soft" style={styles.eyebrow}>
                CHECK-IN
              </AppText>
              <View style={styles.metaRow}>
                <CalendarDays color={colors.primary} size={13} />
                <AppText variant="caption" weight="bold">
                  {formatDate(booking.checkIn)}
                </AppText>
              </View>
            </View>
            <View style={styles.dateBox}>
              <AppText variant="caption" weight="bold" tone="soft" style={styles.eyebrow}>
                CHECK-OUT
              </AppText>
              <View style={styles.metaRow}>
                <CalendarDays color={colors.primary} size={13} />
                <AppText variant="caption" weight="bold">
                  {formatDate(booking.checkOut)}
                </AppText>
              </View>
            </View>
          </View>

          <View style={styles.amountRow}>
            <AppText variant="bodySmall" tone="muted">
              Amount paid
            </AppText>
            <AmountText amount={Number(booking.totalAmount || 0)} currency="TZS" variant="titleSm" weight="extraBold" tone="primary" />
          </View>
          <CodeText value={booking.bookingCode} />
        </AppStack>
      </AppCard>

      {/* Eligibility */}
      {existingRequest ? (
        <Pressable accessibilityRole="button" onPress={() => navigation.replace("CancellationDetail", { id: existingRequest.id })}>
          <AppCard style={styles.warnCard}>
            <View style={styles.bannerRow}>
              <AlertTriangle color={colors.warning} size={22} />
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold" tone="warning">
                  Request already pending
                </AppText>
                <AppText variant="caption" tone="muted">
                  Request #{existingRequest.id} is being reviewed. Tap to view its status and messages.
                </AppText>
              </View>
            </View>
          </AppCard>
        </Pressable>
      ) : eligibility.eligible ? (
        <AppCard style={styles.okCard}>
          <View style={styles.bannerRow}>
            <CheckCircle2 color={colors.success} size={22} />
            <View style={styles.flex}>
              <AppText variant="bodySmall" weight="bold" tone="success">
                Eligible via platform
              </AppText>
              <AppText variant="caption" tone="muted">
                Refund policy outcome: <AppText variant="caption" weight="bold" tone="success">{refundOutcomeLabel(eligibility.refundPercent)}</AppText>
              </AppText>
            </View>
          </View>
        </AppCard>
      ) : (
        <AppCard style={styles.badCard}>
          <AppStack gap={3}>
            <View style={styles.bannerRow}>
              <XCircle color={colors.danger} size={22} />
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold" tone="danger">
                  Not eligible via platform
                </AppText>
                <AppText variant="caption" tone="muted">
                  {eligibility.reason || "This booking doesn't qualify for platform cancellation. Contact us directly for help."}
                </AppText>
              </View>
            </View>
            <View style={styles.supportRow}>
              <View style={styles.flex}>
                <AppButton title="Email support" variant="secondary" icon={<Mail color={colors.primary} size={16} />} onPress={emailSupport} />
              </View>
              <View style={styles.flex}>
                <AppButton
                  title="Call support"
                  variant="ghost"
                  icon={<Phone color={colors.primary} size={16} />}
                  onPress={() => Linking.openURL("tel:+255").catch(() => undefined)}
                />
              </View>
            </View>
          </AppStack>
        </AppCard>
      )}

      {/* Policy summary (collapsible) */}
      <AppCard>
        <Pressable accessibilityRole="button" onPress={() => setPolicyOpen((v) => !v)} style={styles.policyHead}>
          <AppText variant="label" weight="bold" tone="muted" style={styles.flex}>
            CANCELLATION POLICY
          </AppText>
          <ChevronDown color={colors.softText} size={18} style={policyOpen ? styles.chevOpen : undefined} />
        </Pressable>
        <AppStack gap={2}>
          <PolicyLine bold="Free cancellation" rest="within 24h of booking and at least 72h before check-in." />
          <PolicyLine bold="50% refund" rest="at least 96h before check-in (after the free window)." />
          {policyOpen ? (
            <>
              <PolicyLine bold="Non-refundable" rest="some promotions, last-minute or special-term bookings." />
              <PolicyLine bold="After check-in" rest={`generally no refund. Exceptional cases: email ${CANCELLATION_EMAIL}.`} />
              <AppText variant="caption" tone="soft">
                Eligible refunds are returned to your original payment method within 5–10 business days after confirmation.
              </AppText>
            </>
          ) : null}
        </AppStack>
      </AppCard>

      {/* Request form — only when eligible and no pending request */}
      {eligibility.eligible && !existingRequest ? (
        <AppCard>
          <AppStack gap={4}>
            <AppText variant="label" weight="bold" tone="muted">
              SUBMIT CANCELLATION REQUEST
            </AppText>

            <View>
              <View style={styles.reasonLabelRow}>
                <AppText variant="label" weight="semiBold" tone="muted">
                  Reason for cancellation
                  <AppText variant="label" weight="bold" tone="danger">{" *"}</AppText>
                </AppText>
                <AppText
                  variant="caption"
                  weight="bold"
                  tone={words === 0 ? "soft" : reasonOk ? "success" : "warning"}
                >
                  {words} / {MIN_WORDS}–{MAX_WORDS} words
                </AppText>
              </View>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder={`Explain why you need to cancel (minimum ${MIN_WORDS} words)...`}
                placeholderTextColor={colors.softText}
                multiline
                textAlignVertical="top"
                style={styles.reasonInput}
              />
              {words > 0 && words < MIN_WORDS ? (
                <AppText variant="caption" tone="warning" style={styles.reasonHint}>
                  {MIN_WORDS - words} more word{MIN_WORDS - words !== 1 ? "s" : ""} required.
                </AppText>
              ) : words > MAX_WORDS ? (
                <AppText variant="caption" tone="danger" style={styles.reasonHint}>
                  {words - MAX_WORDS} word{words - MAX_WORDS !== 1 ? "s" : ""} over the limit.
                </AppText>
              ) : null}
            </View>

            <ConsentToggle value={confirmPolicy} onToggle={() => setConfirmPolicy((v) => !v)}>
              I have read and agree to the cancellation policy, and understand this is a request for review.
            </ConsentToggle>
            <ConsentToggle value={confirmTerms} onToggle={() => setConfirmTerms((v) => !v)}>
              I have read and agree to the terms and conditions.
            </ConsentToggle>

            {error ? (
              <View style={styles.errorBox}>
                <AppText variant="caption" weight="semiBold" tone="danger">
                  {error}
                </AppText>
              </View>
            ) : null}

            <AppButton title="Submit request" variant="danger" loading={submitting} disabled={!canSubmit} onPress={submit} />
            <AppText variant="caption" tone="soft" style={styles.help}>
              Need help? Email {CANCELLATION_EMAIL}
            </AppText>
          </AppStack>
        </AppCard>
      ) : null}
    </SafeScreen>
  );
}

function PolicyLine({ bold, rest }: { bold: string; rest: string }) {
  return (
    <View style={styles.policyLine}>
      <View style={styles.policyDot} />
      <AppText variant="caption" tone="muted" style={styles.flex}>
        <AppText variant="caption" weight="bold" tone="default">
          {bold}
        </AppText>
        : {rest}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { gap: spacing[4], paddingBottom: spacing[8] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing[5] },
  eyebrow: { letterSpacing: 1 },
  summaryHead: { flexDirection: "row", gap: spacing[3], minWidth: 0 },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef2f2"
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing[1], minWidth: 0 },
  datesRow: { flexDirection: "row", gap: spacing[2] },
  dateBox: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  amountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  bannerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3], minWidth: 0 },
  okCard: { borderColor: "#bbf7d0", backgroundColor: "#f0fdf4" },
  warnCard: { borderColor: "#fde68a", backgroundColor: "#fffbeb" },
  badCard: { borderColor: "#fecaca", backgroundColor: "#fef2f2" },
  supportRow: { flexDirection: "row", gap: spacing[2] },
  policyHead: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginBottom: spacing[3] },
  chevOpen: { transform: [{ rotate: "180deg" }] },
  policyLine: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], minWidth: 0 },
  policyDot: { width: 5, height: 5, borderRadius: radius.full, backgroundColor: colors.primary, marginTop: 6 },
  reasonLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2], marginBottom: spacing[2] },
  reasonInput: {
    minHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3],
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 15
  },
  reasonHint: { marginTop: spacing[1] },
  consentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[3]
  },
  consentRowOn: { borderColor: colors.brand[200], backgroundColor: colors.brand[50] },
  switch: {
    width: 46,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    padding: 3,
    justifyContent: "center"
  },
  switchOn: { backgroundColor: colors.primary },
  knob: { width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.white },
  knobOn: { alignSelf: "flex-end" },
  errorBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: "#fdecec",
    padding: spacing[3]
  },
  help: { textAlign: "center" }
});
