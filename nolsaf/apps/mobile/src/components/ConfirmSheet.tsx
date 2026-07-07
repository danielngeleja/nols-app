import { Modal, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { AppButton } from "./AppButton";
import { AppStack } from "./AppStack";
import { AppText } from "./AppText";

type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel
}: ConfirmSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <AppStack gap={5}>
            <AppStack gap={2}>
              <AppText variant="title" weight="bold">
                {title}
              </AppText>
              <AppText variant="body" tone="muted">
                {message}
              </AppText>
            </AppStack>
            <AppStack gap={2}>
              <AppButton
                title={confirmLabel}
                variant={destructive ? "danger" : "primary"}
                loading={loading}
                onPress={onConfirm}
              />
              <AppButton title={cancelLabel} variant="ghost" onPress={onCancel} />
            </AppStack>
          </AppStack>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.42)",
    padding: spacing[4]
  },
  sheet: {
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    padding: spacing[5],
    ...shadows.sheet
  }
});
