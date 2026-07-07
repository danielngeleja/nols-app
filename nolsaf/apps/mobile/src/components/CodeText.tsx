import { AppText, AppTextProps } from "./AppText";

type CodeTextProps = AppTextProps & {
  value: string;
  maxLines?: number;
};

export function CodeText({ value, maxLines = 2, ...props }: CodeTextProps) {
  return (
    <AppText
      variant="bodySmall"
      weight="mono"
      numberOfLines={maxLines}
      ellipsizeMode="middle"
      {...props}
    >
      {value}
    </AppText>
  );
}
