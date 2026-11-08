import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

type CodeBoxesProps = {
  value: string;
  onChange: (value: string) => void;
  /** Called once when all digits are in, so the code verifies with no extra tap. */
  onComplete?: (value: string) => void;
  length?: number;
  error?: boolean;
  autoFocus?: boolean;
  editable?: boolean;
};

/**
 * One box per digit. A single real TextInput sits on top (almost transparent),
 * so the keyboard, paste, iOS one-time-code autofill and Android SMS suggestions
 * all keep working exactly as with a normal field.
 */
export function CodeBoxes({ value, onChange, onComplete, length = 6, error = false, autoFocus = true, editable = true }: CodeBoxesProps) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const lastCompleted = useRef<string | null>(null);

  useEffect(() => {
    if (value.length < length) lastCompleted.current = null;
  }, [length, value]);

  const digits = value.split("");
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable accessibilityLabel={`Verification code, ${length} digits`} onPress={() => inputRef.current?.focus()} style={styles.row}>
      {Array.from({ length }).map((_, index) => {
        const filled = index < digits.length;
        const active = focused && index === activeIndex && value.length < length;
        return (
          <View key={index} style={[styles.box, filled && styles.boxFilled, active && styles.boxActive, error && styles.boxError]}>
            <AppText variant="title" weight="bold">
              {digits[index] ?? ""}
            </AppText>
          </View>
        );
      })}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(raw) => {
          const next = raw.replace(/\D/g, "").slice(0, length);
          onChange(next);
          if (next.length === length && lastCompleted.current !== next) {
            lastCompleted.current = next;
            onComplete?.(next);
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus={autoFocus}
        editable={editable}
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        caretHidden
        selectionColor="transparent"
        style={styles.hiddenInput}
        accessibilityLabel="Verification code"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing[2],
    position: "relative"
  },
  box: {
    flex: 1,
    maxWidth: 52,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  boxFilled: {
    borderColor: colors.brand[200]
  },
  boxActive: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.brand[50]
  },
  boxError: {
    borderColor: colors.danger
  },
  // Covers the boxes so a tap or a long-press paste lands in the real field.
  hiddenInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.02,
    color: "transparent",
    fontFamily: fonts.regular,
    fontSize: 1
  }
});
