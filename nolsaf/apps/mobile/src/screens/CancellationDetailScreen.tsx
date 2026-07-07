import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BadgeCheck, CalendarDays, Check, RefreshCw, Search, Send, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAuth } from "../auth";
import {
  CancellationDetail,
  cancellationStatusMeta,
  fetchCancellation,
  refundOutcomeLabel,
  sendCancellationMessage,
  type CancellationMessage
} from "../cancellations";
import { AppCard, AppStack, AppText, CodeText, SafeScreen, ScreenHeader, StateView } from "../components";
import { getErrorMessage } from "../lib/apiClient";
import { RootStackParamList } from "../navigation/types";
import { colors, fonts, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "CancellationDetail">;

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function CancellationDetailScreen({ navigation, route }: Props) {
  const { token, user } = useAuth();
  const { id } = route.params;

  const [item, setItem] = useState<CancellationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("Please sign in to view this claim.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCancellation(token, id);
      setItem(res.item);
    } catch (e) {
      setError(getErrorMessage(e, "Could not load this cancellation claim."));
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    const body = draft.trim();
    if (!token || !item || !body) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await sendCancellationMessage(token, item.id, body);
      setItem((prev) => (prev ? { ...prev, messages: [...prev.messages, res.message] } : prev));
      setDraft("");
    } catch (e) {
      setSendError(getErrorMessage(e, "Could not send your message."));
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Cancellation claim" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeScreen>
    );
  }

  if (error || !item) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Cancellation claim" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <StateView title="Could not load" message={error || "Claim not found."} actionLabel="Try again" onAction={load} />
        </View>
      </SafeScreen>
    );
  }

  const meta = cancellationStatusMeta(item.status);
  const title = item.booking?.property?.title || "NoLSAF stay";
  const area = [item.booking?.property?.regionName, item.booking?.property?.district, item.booking?.property?.city]
    .filter(Boolean)
    .join(", ");

  return (
    <SafeScreen contentStyle={styles.body}>
      <ScreenHeader title={`Claim #${item.id}`} subtitle={title} onBack={() => navigation.goBack()} />

      {/* Status + outcome */}
      <AppCard>
        <AppStack gap={3}>
          <View style={styles.statusRow}>
            <View style={styles.flex}>
              <AppText variant="label" weight="bold" tone="soft" style={styles.eyebrow}>
                STATUS
              </AppText>
              {item.policyEligible ? (
                <AppText variant="caption" tone="muted">
                  Policy outcome: <AppText variant="caption" weight="bold" tone="success">{refundOutcomeLabel(item.policyRefundPercent)}</AppText>
                </AppText>
              ) : null}
            </View>
            <View style={[styles.statusPill, { backgroundColor: meta.tint }]}>
              <AppText variant="caption" weight="bold" style={{ color: meta.color, textTransform: "uppercase" }}>
                {meta.label}
              </AppText>
            </View>
          </View>

          <StatusSteps status={item.status} />

          {item.decisionNote ? (
            <View style={styles.noteBox}>
              <AppText variant="caption" weight="bold" tone="muted" style={styles.eyebrow}>
                DECISION NOTE
              </AppText>
              <AppText variant="bodySmall">{item.decisionNote}</AppText>
            </View>
          ) : null}
        </AppStack>
      </AppCard>

      {/* Booking */}
      <AppCard>
        <AppStack gap={2}>
          <AppText variant="label" weight="bold" tone="muted" style={styles.eyebrow}>
            BOOKING
          </AppText>
          <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
            {title}
          </AppText>
          {area ? (
            <AppText variant="caption" tone="muted" numberOfLines={2}>
              {area}
            </AppText>
          ) : null}
          <View style={styles.datesRow}>
            <View style={styles.metaRow}>
              <CalendarDays color={colors.primary} size={13} />
              <AppText variant="caption" tone="muted">
                {formatDate(item.booking?.checkIn)} → {formatDate(item.booking?.checkOut)}
              </AppText>
            </View>
          </View>
          <CodeText value={item.bookingCode} />
        </AppStack>
      </AppCard>

      {/* Your reason */}
      {item.reason ? (
        <AppCard>
          <AppStack gap={2}>
            <AppText variant="label" weight="bold" tone="muted" style={styles.eyebrow}>
              YOUR REASON
            </AppText>
            <AppText variant="bodySmall" tone="muted">
              {item.reason}
            </AppText>
          </AppStack>
        </AppCard>
      ) : null}

      {/* Messages */}
      <AppCard>
        <AppStack gap={3}>
          <AppText variant="label" weight="bold" tone="muted" style={styles.eyebrow}>
            MESSAGES
          </AppText>
          {item.messages.length === 0 ? (
            <AppText variant="caption" tone="soft">
              No messages yet. Send a note below if you need to add details for the review team.
            </AppText>
          ) : (
            <AppStack gap={2}>
              {item.messages.map((m) => (
                <MessageBubble key={m.id} message={m} mine={user?.id != null && m.senderId === user.id} />
              ))}
            </AppStack>
          )}

          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message..."
              placeholderTextColor={colors.softText}
              multiline
              style={styles.composerInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={sending || draft.trim().length === 0}
              onPress={send}
              style={[styles.sendBtn, (sending || draft.trim().length === 0) && styles.sendBtnOff]}
            >
              {sending ? <ActivityIndicator color={colors.white} size="small" /> : <Send color={colors.white} size={18} />}
            </Pressable>
          </View>
          {sendError ? (
            <AppText variant="caption" tone="danger">
              {sendError}
            </AppText>
          ) : null}
        </AppStack>
      </AppCard>
    </SafeScreen>
  );
}

type Step = { label: string; Icon: typeof Check };

const NORMAL_STEPS: Step[] = [
  { label: "Submitted", Icon: Check },
  { label: "Reviewing", Icon: Search },
  { label: "Processing", Icon: RefreshCw },
  { label: "Refunded", Icon: BadgeCheck }
];

const REJECTED_STEPS: Step[] = [
  { label: "Submitted", Icon: Check },
  { label: "Reviewing", Icon: Search },
  { label: "Rejected", Icon: X }
];

/** Horizontal pipeline showing how far the request has moved. Each stage carries
 *  its own icon: completed and current stages fill with the accent colour and the
 *  current one gets a ring, while upcoming stages stay muted. A rejected claim
 *  swaps the final node for a red "Rejected" terminal; a refund turns the track
 *  green. NEED_INFO sits at the review stage. */
function StatusSteps({ status }: { status: string }) {
  const s = String(status || "").toUpperCase();
  const rejected = s === "REJECTED";
  const refunded = s === "REFUNDED";
  const steps = rejected ? REJECTED_STEPS : NORMAL_STEPS;
  const indexByStatus: Record<string, number> = { SUBMITTED: 0, REVIEWING: 1, NEED_INFO: 1, PROCESSING: 2, REFUNDED: 3 };
  const current = rejected ? 2 : indexByStatus[s] ?? 0;
  const accent = rejected ? colors.danger : refunded ? colors.success : colors.primary;
  const haloByAccent =
    accent === colors.danger ? "#fef2f2" : accent === colors.success ? "#f0fdf4" : colors.brand[50];

  return (
    <View style={styles.steps}>
      {steps.map(({ label, Icon }, i) => {
        const active = i <= current;
        const isCurrent = i === current;
        const last = i === steps.length - 1;
        return (
          <View key={label} style={styles.step}>
            <View style={styles.stepTrack}>
              <View style={[styles.stepLine, i === 0 && styles.stepLineHidden, active && { backgroundColor: accent }]} />
              <View style={[styles.stepRing, isCurrent && { borderColor: accent, backgroundColor: haloByAccent }]}>
                <View style={[styles.stepDot, active && { backgroundColor: accent, borderColor: accent }]}>
                  <Icon color={active ? colors.white : colors.softText} size={14} strokeWidth={2.5} />
                </View>
              </View>
              <View style={[styles.stepLine, last && styles.stepLineHidden, i < current && { backgroundColor: accent }]} />
            </View>
            <AppText
              variant="caption"
              weight={isCurrent ? "bold" : "regular"}
              numberOfLines={1}
              style={{ color: active ? accent : colors.softText, textAlign: "center" }}
            >
              {label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

function MessageBubble({ message, mine }: { message: CancellationMessage; mine: boolean }) {
  return (
    <View style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine ? (
          <AppText variant="caption" weight="bold" tone="primary" style={styles.bubbleSender}>
            NoLSAF team
          </AppText>
        ) : null}
        <AppText variant="bodySmall" tone={mine ? "inverse" : "default"}>
          {message.body}
        </AppText>
        <AppText variant="caption" tone={mine ? "inverse" : "soft"} style={styles.bubbleTime}>
          {formatTimestamp(message.createdAt)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { gap: spacing[4], paddingBottom: spacing[8] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing[5] },
  eyebrow: { letterSpacing: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  statusPill: { borderRadius: radius.full, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  noteBox: {
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[3]
  },
  steps: { flexDirection: "row", alignItems: "flex-start", paddingVertical: spacing[1] },
  step: { flex: 1, minWidth: 0, alignItems: "center", gap: spacing[2] },
  stepTrack: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.border },
  stepLineHidden: { backgroundColor: "transparent" },
  stepRing: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center"
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  datesRow: { flexDirection: "row", gap: spacing[3], marginTop: spacing[1] },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing[1], minWidth: 0 },
  bubbleWrap: { flexDirection: "row", minWidth: 0 },
  bubbleWrapMine: { justifyContent: "flex-end" },
  bubbleWrapTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "86%", borderRadius: radius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[2], gap: 2 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubbleSender: { marginBottom: 1 },
  bubbleTime: { marginTop: 2, opacity: 0.85 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing[2], minWidth: 0 },
  composerInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 15
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  sendBtnOff: { backgroundColor: colors.softText }
});
