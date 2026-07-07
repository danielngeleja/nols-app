import { Text, TextProps, TextStyle } from "react-native";

import { colors, fonts, fontSize, lineHeight } from "../theme";

type TextVariant = "caption" | "label" | "bodySmall" | "body" | "titleSm" | "title" | "headline" | "display";
type TextWeight = "regular" | "medium" | "semiBold" | "bold" | "extraBold" | "mono";
type TextTone = "default" | "muted" | "soft" | "primary" | "success" | "warning" | "danger" | "inverse";

const toneColor: Record<TextTone, string> = {
  default: colors.ink,
  muted: colors.mutedText,
  soft: colors.softText,
  primary: colors.primary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  inverse: colors.white
};

const variantStyle: Record<TextVariant, TextStyle> = {
  caption: { fontSize: fontSize.caption, lineHeight: lineHeight.caption },
  label: { fontSize: fontSize.label, lineHeight: lineHeight.label },
  bodySmall: { fontSize: fontSize.bodySmall, lineHeight: lineHeight.bodySmall },
  body: { fontSize: fontSize.body, lineHeight: lineHeight.body },
  titleSm: { fontSize: fontSize.titleSm, lineHeight: lineHeight.titleSm },
  title: { fontSize: fontSize.title, lineHeight: lineHeight.title },
  headline: { fontSize: fontSize.headline, lineHeight: lineHeight.headline },
  display: { fontSize: fontSize.display, lineHeight: lineHeight.display }
};

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  weight?: TextWeight;
  tone?: TextTone;
};

export function AppText({
  variant = "body",
  weight = "regular",
  tone = "default",
  style,
  maxFontSizeMultiplier = 1.35,
  ...props
}: AppTextProps) {
  return (
    <Text
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        variantStyle[variant],
        {
          color: toneColor[tone],
          fontFamily: fonts[weight],
          flexShrink: 1
        },
        style
      ]}
      {...props}
    />
  );
}
