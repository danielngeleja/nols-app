import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Printer, ReceiptText, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import {
  StayReceiptFile,
  canPrintReceipts,
  discardStayReceipt,
  downloadStayReceipt,
  openStayReceipt,
  printStayReceipt
} from "../bookings/stayReceipt";
import { colors, radius, shadows, spacing } from "../theme";
import { AppButton } from "./AppButton";
import { AppText } from "./AppText";
import { SheetModal, useSheetBottomInset } from "./SheetModal";

type Props = {
  visible: boolean;
  onClose: () => void;
  token: string;
  /** The opaque bk_ reference, or the booking number where only that is known. */
  bookingKey: string | number;
  bookingCode?: string | null;
  propertyTitle: string;
  /** e.g. "12 Oct 2026 to 14 Oct 2026" */
  datesLabel?: string | null;
  /** e.g. "480,000 TZS" */
  amountLabel?: string | null;
};

type Stage = "loading" | "ready" | "failed";

/**
 * The official stay receipt, the same PDF the website gives on the booking's
 * receipt page. It downloads as soon as the sheet opens, then offers open,
 * share and print.
 */
export function StayReceiptSheet({ visible, onClose, token, bookingKey, bookingCode, propertyTitle, datesLabel, amountLabel }: Props) {
  const bottomInset = useSheetBottomInset(spacing[5]);
  const [stage, setStage] = useState<Stage>("loading");
  const [receipt, setReceipt] = useState<StayReceiptFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "open" | "print">("");

  const load = useCallback(async () => {
    setStage("loading");
    setError(null);
    try {
      setReceipt(await downloadStayReceipt(token, bookingKey, bookingCode));
      setStage("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not download your receipt.");
      setStage("failed");
    }
  }, [token, bookingKey, bookingCode]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  function close() {
    discardStayReceipt(receipt);
    setReceipt(null);
    onClose();
  }

  async function run(kind: "open" | "print") {
    if (!receipt) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "open") await openStayReceipt(receipt);
      else await printStayReceipt(receipt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy("");
    }
  }

  const facts = [
    bookingCode ? { label: "Booking code", value: bookingCode, mono: true } : null,
    datesLabel ? { label: "Stay", value: datesLabel, mono: false } : null,
    amountLabel ? { label: "Amount paid", value: amountLabel, mono: false } : null
  ].filter(Boolean) as { label: string; value: string; mono: boolean }[];

  return (
    <SheetModal visible={visible} onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close receipt" />
        <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
          <View style={styles.head}>
            <View style={styles.headIcon}>
              <ReceiptText color={colors.brand[200]} size={18} />
            </View>
            <View style={styles.flex}>
              <AppText variant="titleSm" weight="extraBold">
                Booking receipt
              </AppText>
              <AppText variant="caption" tone="soft" numberOfLines={1}>
                {propertyTitle}
              </AppText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={styles.closeBtn}>
              <X color={colors.softText} size={18} />
            </Pressable>
          </View>

          {facts.length ? (
            <View style={styles.facts}>
              {facts.map((fact, i) => (
                <View key={fact.label} style={[styles.factRow, i > 0 && styles.factDivider]}>
                  <AppText variant="caption" tone="soft">
                    {fact.label}
                  </AppText>
                  <AppText variant="bodySmall" weight="extraBold" style={fact.mono ? styles.mono : undefined} numberOfLines={1}>
                    {fact.value}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          {stage === "loading" ? (
            <View style={styles.fileCard}>
              <View style={styles.fileIcon}>
                <ActivityIndicator color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="extraBold">
                  Preparing your receipt
                </AppText>
                <AppText variant="caption" tone="soft">
                  The official PDF from NoLSAF
                </AppText>
              </View>
            </View>
          ) : stage === "ready" && receipt ? (
            <View style={[styles.fileCard, styles.fileCardReady]}>
              <View style={[styles.fileIcon, styles.fileIconReady]}>
                <FileText color={colors.primary} size={20} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
                  {receipt.fileName}
                </AppText>
                <AppText variant="caption" tone="soft">
                  PDF · {receipt.sizeLabel}
                </AppText>
              </View>
              <CheckCircle2 color={colors.success} size={20} />
            </View>
          ) : (
            <View style={[styles.fileCard, styles.fileCardFailed]}>
              <View style={[styles.fileIcon, styles.fileIconFailed]}>
                <AlertTriangle color={colors.danger} size={18} />
              </View>
              <AppText variant="caption" weight="semiBold" tone="danger" style={styles.flex}>
                {error}
              </AppText>
            </View>
          )}

          {stage === "ready" && error ? (
            <AppText variant="caption" weight="bold" tone="danger">
              {error}
            </AppText>
          ) : null}

          {stage === "failed" ? (
            <AppButton title="Try again" onPress={() => void load()} />
          ) : (
            <View style={styles.actions}>
              {canPrintReceipts() ? (
                <AppButton
                  title="Print"
                  variant="secondary"
                  disabled={stage !== "ready"}
                  loading={busy === "print"}
                  onPress={() => void run("print")}
                  icon={<Printer color={colors.primary} size={16} />}
                  style={styles.flex}
                />
              ) : null}
              <AppButton
                title="Open or share"
                disabled={stage !== "ready"}
                loading={busy === "open"}
                onPress={() => void run("open")}
                icon={<ExternalLink color={colors.white} size={16} />}
                style={styles.flex}
              />
            </View>
          )}

          <AppText variant="caption" tone="soft" style={styles.center}>
            The official NoLSAF receipt, the same one you get on nolsaf.com.
          </AppText>
        </View>
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(2,12,10,0.58)" },
  sheet: {
    gap: spacing[4],
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.white,
    padding: spacing[5],
    ...shadows.sheet
  },
  flex: { flex: 1, minWidth: 0 },
  center: { textAlign: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  headIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryDeep },
  closeBtn: { width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  facts: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  factRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  factDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  mono: { fontFamily: "monospace", letterSpacing: 1, color: colors.primary },
  fileCard: { flexDirection: "row", alignItems: "center", gap: spacing[3], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing[3] },
  fileCardReady: { borderColor: "#a7f3d0", backgroundColor: "#ecfdf5" },
  fileCardFailed: { borderColor: "#fecaca", backgroundColor: "#fef2f2" },
  fileIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  fileIconReady: { backgroundColor: colors.white },
  fileIconFailed: { backgroundColor: colors.white },
  actions: { flexDirection: "row", gap: spacing[2] }
});
