import { ReactNode, useState } from "react";
import { Pressable, TextInput, TextInputProps, StyleSheet, View } from "react-native";
import { Eye, EyeOff } from "lucide-react-native";

import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

type AppInputProps = TextInputProps & {
  label: string;
  error?: string;
  /** Adds a red asterisk after the label to mark the field as required. */
  required?: boolean;
  /** Optional adornment shown at the right of the label row (e.g. a status). */
  hint?: ReactNode;
  /** Fixed, non-editable value shown inside the left side of the field. */
  prefix?: string;
};

export function AppInput({ label, error, required, hint, prefix, style, ...props }: AppInputProps) {
  // On Android, a custom fontFamily on a secureTextEntry input breaks masking and
  // renders the password in plain text. Use the system font for secure fields so
  // the characters are always masked.
  const secure = Boolean(props.secureTextEntry);
  const [revealed, setRevealed] = useState(false);

  const field = (
    <TextInput
      placeholderTextColor={colors.softText}
      style={[
        styles.input,
        secure ? styles.secureInput : styles.brandInput,
        secure && styles.inputWithAdornment,
        prefix && styles.inputWithPrefix,
        error && styles.errorInput,
        style
      ]}
      {...props}
      // Secure fields render an eye toggle; honor the reveal state.
      secureTextEntry={secure && !revealed}
    />
  );

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
      {secure ? (
        <View style={styles.secureWrap}>
          {field}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            hitSlop={8}
            onPress={() => setRevealed((current) => !current)}
            style={styles.eyeButton}
          >
            {revealed ? (
              <EyeOff color={colors.mutedText} size={20} />
            ) : (
              <Eye color={colors.mutedText} size={20} />
            )}
          </Pressable>
        </View>
      ) : prefix ? (
        <View style={styles.prefixWrap}>
          {field}
          <View pointerEvents="none" style={styles.prefixBox}>
            <AppText variant="body" weight="semiBold" tone="primary">
              {prefix}
            </AppText>
          </View>
        </View>
      ) : (
        field
      )}
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
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    color: colors.ink,
    fontSize: 16
  },
  // Brand font for normal fields.
  brandInput: {
    fontFamily: fonts.regular
  },
  // Secure fields deliberately omit the custom fontFamily so Android masks them.
  secureInput: {},
  // Leaves room for the eye toggle so the text never sits under it.
  inputWithAdornment: {
    paddingRight: 48
  },
  inputWithPrefix: {
    paddingLeft: 86
  },
  prefixWrap: {
    position: "relative",
    justifyContent: "center"
  },
  prefixBox: {
    position: "absolute",
    left: 1,
    top: 1,
    bottom: 1,
    width: 70,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.brand[50],
    borderTopLeftRadius: radius.md - 1,
    borderBottomLeftRadius: radius.md - 1
  },
  secureWrap: {
    position: "relative",
    justifyContent: "center"
  },
  eyeButton: {
    position: "absolute",
    right: spacing[3],
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing[1]
  },
  errorInput: {
    borderColor: colors.danger
  }
});
