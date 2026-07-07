import { AppText, AppTextProps } from "./AppText";

type AmountTextProps = AppTextProps & {
  amount: number;
  currency?: string;
};

export function AmountText({ amount, currency = "TZS", ...props }: AmountTextProps) {
  return (
    <AppText variant="title" weight="bold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} {...props}>
      {amount.toLocaleString()} {currency}
    </AppText>
  );
}
