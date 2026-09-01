import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { convertFromTzs, formatCurrency, useCurrency } from "../currency";
import { AmountText } from "./AmountText";
import { AppText, AppTextProps } from "./AppText";

type DisplayPriceProps = AppTextProps & {
  /** Authoritative property/stay amount in TZS. This value is display-only here. */
  amountTzs: number;
  /** Web parity: compact cards can hide the supporting settlement note. */
  showSettlementNote?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
};

export function DisplayPrice({
  amountTzs,
  showSettlementNote = true,
  containerStyle,
  ...textProps
}: DisplayPriceProps) {
  const { currency, tzsPerUnit, ratesStale } = useCurrency();
  const converted = convertFromTzs(amountTzs, currency, tzsPerUnit);
  const canShowConverted = currency !== "TZS" && converted != null;

  return (
    <View style={[styles.root, containerStyle]}>
      <AppText
        variant="title"
        weight="bold"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        {...textProps}
      >
        {canShowConverted ? formatCurrency(converted, currency) : formatCurrency(amountTzs, "TZS")}
      </AppText>
      {canShowConverted && showSettlementNote ? (
        <AppText variant="caption" tone={ratesStale ? "warning" : "soft"} numberOfLines={1}>
          ≈ {formatCurrency(amountTzs, "TZS")}{ratesStale ? " · rate may be outdated" : ""}
        </AppText>
      ) : null}
    </View>
  );
}

type StayPriceProps = Omit<DisplayPriceProps, "amountTzs"> & {
  amount: number;
  currency?: string | null;
};

/**
 * Display-currency boundary for property/stay UI only. Non-TZS inventory is
 * rendered unchanged so tours or future foreign-currency stays are never
 * accidentally treated as TZS.
 */
export function StayPrice({ amount, currency = "TZS", ...props }: StayPriceProps) {
  if (String(currency || "TZS").toUpperCase() !== "TZS") {
    const { showSettlementNote: _showSettlementNote, containerStyle: _containerStyle, ...textProps } = props;
    return <AmountText amount={amount} currency={String(currency)} {...textProps} />;
  }
  return <DisplayPrice amountTzs={amount} {...props} />;
}

const styles = StyleSheet.create({
  root: {
    minWidth: 0,
    alignSelf: "flex-start"
  }
});
