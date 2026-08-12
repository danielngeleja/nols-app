import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppCard, AppText, colors, radius, spacing } from "@nolsaf/native-ui";
import { ArrowLeft, ChevronRight, FileText, IdCard, ShieldCheck } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { ReactElement } from "react";

import { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Management">;

const LINKS: Array<{
  key: "License" | "Insurance" | "Contract";
  label: string;
  description: string;
  icon: (color: string) => ReactElement;
}> = [
  { key: "License", label: "License", description: "Your driving license details", icon: (c) => <IdCard color={c} size={20} /> },
  { key: "Insurance", label: "Insurance", description: "Your vehicle insurance document", icon: (c) => <ShieldCheck color={c} size={20} /> },
  { key: "Contract", label: "Contract", description: "Your NoLSAF driver agreement", icon: (c) => <FileText color={c} size={20} /> }
];

export function ManagementScreen({ navigation }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color={colors.ink} size={22} />
        </Pressable>
        <AppText variant="title" weight="bold">
          Management
        </AppText>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {LINKS.map((link) => (
          <Pressable key={link.key} accessibilityRole="button" onPress={() => navigation.navigate(link.key)}>
            <AppCard style={styles.linkCard}>
              <View style={styles.linkIcon}>{link.icon(colors.primary)}</View>
              <View style={styles.linkText}>
                <AppText variant="bodySmall" weight="bold">
                  {link.label}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {link.description}
                </AppText>
              </View>
              <ChevronRight color={colors.mutedText} size={18} />
            </AppCard>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4]
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  scrollContent: {
    gap: spacing[3],
    padding: spacing[4],
    paddingBottom: spacing[8]
  },
  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  linkText: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1]
  }
});
