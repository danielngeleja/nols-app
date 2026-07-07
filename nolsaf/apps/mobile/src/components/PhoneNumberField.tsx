import { ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import {
  getCountryFlag,
  getPhoneLengthHint,
  getPhonePlaceholder,
  isPhoneLengthValid,
  PHONE_COUNTRY_CODES,
  sanitizePhoneDigits
} from "../lib/phone";
import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";
import { OptionPickerSheet } from "./OptionPickerSheet";

type Props = {
  label: string;
  countryCode: string;
  onCountryCodeChange: (code: string) => void;
  /** National number digits only, without the calling code. */
  value: string;
  onChangeText: (value: string) => void;
};

const COUNTRY_OPTIONS = PHONE_COUNTRY_CODES.map((c) => ({
  value: c.code,
  label: `${c.flag}  ${c.code}`,
  description: c.label
}));

export function PhoneNumberField({ label, countryCode, onCountryCodeChange, value, onChangeText }: Props) {
  const [pickerVisible, setPickerVisible] = useState(false);
  const showHint = value.length > 0 && !isPhoneLengthValid(value, countryCode);

  return (
    <View style={styles.wrap}>
      <AppText variant="label" weight="semiBold" tone="muted">
        {label}
      </AppText>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={() => setPickerVisible(true)} style={styles.codeButton}>
          <AppText variant="bodySmall">{getCountryFlag(countryCode)}</AppText>
          <AppText variant="bodySmall" weight="semiBold">
            {countryCode}
          </AppText>
          <ChevronDown color={colors.softText} size={16} />
        </Pressable>
        <TextInput
          value={value}
          onChangeText={(text) => onChangeText(sanitizePhoneDigits(text, countryCode))}
          placeholder={getPhonePlaceholder(countryCode)}
          placeholderTextColor={colors.softText}
          keyboardType="number-pad"
          textContentType="telephoneNumber"
          style={styles.input}
        />
      </View>
      {showHint ? (
        <AppText variant="caption" tone="warning" weight="semiBold">
          {getPhoneLengthHint(countryCode)}
        </AppText>
      ) : null}

      <OptionPickerSheet
        visible={pickerVisible}
        title="Select country code"
        options={COUNTRY_OPTIONS}
        value={countryCode}
        onSelect={onCountryCodeChange}
        onClose={() => setPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[2],
    minWidth: 0
  },
  row: {
    flexDirection: "row",
    gap: spacing[2],
    minWidth: 0
  },
  codeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3]
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 16
  }
});
