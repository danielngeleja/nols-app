import * as Clipboard from "expo-clipboard";
import { Check, Copy, Share2, ShieldAlert } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Share, StyleSheet, Switch, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AppButton } from "./AppButton";
import { AppText } from "./AppText";

/**
 * Backup codes, shown the one time the API returns them (turning the
 * authenticator on, or generating new ones). The API keeps only hashes, so
 * this is the person's only chance to keep them. Matches the web
 * BackupCodesPanel: numbered grid, copy, save elsewhere, and it stays until
 * they confirm the codes are saved.
 */
export function BackupCodesPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!codes.length) return null;

  const text = [
    "NoLSAF backup codes",
    `Created ${new Date().toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} (EAT)`,
    "Each code works once. Keep them somewhere safe and private.",
    "",
    ...codes
  ].join("\n");

  async function copy() {
    try {
      await Clipboard.setStringAsync(codes.join("\n"));
      setCopied(true);
      setSaved(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable: saving through the share sheet still works.
    }
  }

  async function saveElsewhere() {
    try {
      const result = await Share.share({ title: "NoLSAF backup codes", message: text });
      if (result.action === Share.sharedAction) setSaved(true);
    } catch {
      // Share sheet dismissed or unavailable.
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <ShieldAlert color={colors.white} size={18} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodySmall" weight="extraBold" style={styles.headTitle}>
            Save your backup codes now
          </AppText>
          <AppText variant="caption" style={styles.headText}>
            If you lose your phone, each code signs you in once. You will not see these codes again.
          </AppText>
        </View>
      </View>

      <View style={styles.grid}>
        {codes.map((code, index) => (
          <View key={code} style={styles.codeCell}>
            <AppText variant="caption" tone="soft" style={styles.codeIndex}>
              {index + 1}
            </AppText>
            <AppText variant="bodySmall" weight="mono" selectable style={styles.code}>
              {code}
            </AppText>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => void copy()} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
          {copied ? <Check color={colors.success} size={16} /> : <Copy color={colors.primary} size={16} />}
          <AppText variant="caption" weight="bold" tone="primary">
            {copied ? "Copied" : "Copy"}
          </AppText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void saveElsewhere()} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
          <Share2 color={colors.primary} size={16} />
          <AppText variant="caption" weight="bold" tone="primary">
            Save to notes or a password manager
          </AppText>
        </Pressable>
      </View>

      <View style={styles.confirmRow}>
        <AppText variant="bodySmall" weight="semiBold" style={styles.flex}>
          I have saved these codes somewhere safe
        </AppText>
        <Switch
          accessibilityLabel="I have saved these codes somewhere safe"
          value={saved}
          onValueChange={setSaved}
          trackColor={{ false: colors.border, true: colors.brand[300] }}
          thumbColor={saved ? colors.primary : colors.white}
        />
      </View>
      <AppButton title="Done" disabled={!saved} onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSurface,
    padding: spacing[3]
  },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3]
  },
  headIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.warning
  },
  headTitle: {
    color: colors.warningText
  },
  headText: {
    color: colors.warningText
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing[2]
  },
  codeCell: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  codeIndex: {
    width: 16,
    textAlign: "right"
  },
  code: {
    letterSpacing: 1
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  actionPressed: {
    backgroundColor: colors.brand[50]
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  }
});
