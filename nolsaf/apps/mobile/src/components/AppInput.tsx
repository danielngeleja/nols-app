import { ReactNode } from "react";
import { TextInput, TextInputProps, StyleSheet, View } from "react-native";

import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

type AppInputProps = TextInputProps & {
  label: string;
  error?: string;
  /** Adds a red asterisk after the label to mark the field as required. */
  required?: boolean;
  /** Optional adornment shown at the right of the label row (e.g. a status). */
  hint?: ReactNode;
  /** Optional icon rendered inside the field at the left (e.g. a search glyph). */
  leftIcon?: ReactNode;
};

export function AppInput({ label, error, required, hint, leftIcon, style, ...props }: AppInputProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <AppText variant="label" weight="semiBold" tone="muted">
          {label}
          {required ? (
            <AppText variant="label" weight="bold" tone="danger">
              {" *"}
            </AppText>
          ) : null}
        </AppText>
        {hint ?? null}
      </View>
      <View style={styles.fieldWrap}>
        {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}
        <TextInput
          placeholderTextColor={colors.softText}
          style={[styles.input, leftIcon ? styles.inputWithIcon : null, error && styles.errorInput, style]}
          {...props}
        />
      </View>
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[2],
    minWidth: 0
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    minWidth: 0
  },
  fieldWrap: {
    minWidth: 0,
    justifyContent: "center"
  },
  leftIcon: {
    position: "absolute",
    left: spacing[4],
    zIndex: 1
  },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 16
  },
  inputWithIcon: {
    paddingLeft: spacing[4] + 26
  },
  errorInput: {
    borderColor: colors.danger
  }
});
