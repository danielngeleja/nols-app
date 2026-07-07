import { View } from "react-native";

import { colors } from "../theme";

export type SparklineProps = {
  values: number[];
  color?: string;
  height?: number;
};

// Discrete bars on a shared baseline. Daily counts are sparse and zero heavy, so
// bars read cleaner than a line, and older days fade so the latest reads first.
// Matches the web Sparkline in apps/web/app/account/agent/page.tsx.
export function Sparkline({ values, color = colors.primary, height = 30 }: SparklineProps) {
  const max = Math.max(1, ...values);
  const n = values.length;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height, gap: 3 }}>
      {values.map((raw, i) => {
        const v = Number.isFinite(raw) ? raw : 0;
        const pct = Math.max(0, Math.min(1, v / max));
        const isLast = i === n - 1;
        const opacity = isLast ? 1 : 0.25 + (i / Math.max(1, n - 1)) * 0.55;
        return (
          <View
            key={i}
            style={{
              flex: 1,
              minWidth: 0,
              height: `${Math.round(pct * 100)}%`,
              minHeight: v > 0 ? 3 : 0,
              backgroundColor: color,
              opacity,
              borderRadius: 2
            }}
          />
        );
      })}
    </View>
  );
}
