import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";

import { radius, spacing } from "../theme";
import { AppText } from "./AppText";

export type TrendSeries = {
  values: number[];
  color: string;
  dashed?: boolean;
};

export type MiniTrendChartProps = {
  title?: string;
  meta?: string;
  series: TrendSeries[];
  legend?: { label: string; color: string }[];
  height?: number;
};

const VIEW_WIDTH = 280;
const PAD_Y = 8;

function buildPath(values: number[], height: number, max: number): string {
  const n = values.length;
  if (n === 0) return "";
  const stepX = VIEW_WIDTH / Math.max(1, n - 1);
  const usable = height - PAD_Y * 2;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = PAD_Y + (1 - (Number.isFinite(v) ? v : 0) / max) * usable;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return "M " + points.join(" L ");
}

// The dark trend chart card from the web dashboards (14 day line series over a
// faint grid). Read only: the caller passes the series; the chart only draws.
// Built on react-native-svg, already a native-ui dependency.
export function MiniTrendChart({ title, meta, series, legend, height = 96 }: MiniTrendChartProps) {
  const max = useMemo(
    () => Math.max(1, ...series.flatMap((s) => s.values.map((v) => (Number.isFinite(v) ? v : 0)))),
    [series]
  );
  const paths = useMemo(
    () => series.map((s) => ({ ...s, d: buildPath(s.values, height, max) })),
    [series, height, max]
  );
  const gridYs = [0.2, 0.5, 0.8].map((p) => Math.round(p * height));

  return (
    <View style={styles.card}>
      {title || meta ? (
        <View style={styles.headerRow}>
          <AppText variant="caption" style={styles.title}>
            {title ?? ""}
          </AppText>
          {meta ? (
            <AppText variant="caption" style={styles.meta}>
              {meta}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <Svg width="100%" height={height} viewBox={`0 0 ${VIEW_WIDTH} ${height}`} preserveAspectRatio="none">
        {gridYs.map((y, i) => (
          <Line key={i} x1={0} y1={y} x2={VIEW_WIDTH} y2={y} stroke="#ffffff" strokeOpacity={0.1} strokeWidth={1} />
        ))}
        {paths.map((p, i) => (
          <Path
            key={i}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeDasharray={p.dashed ? "4 3" : undefined}
          />
        ))}
      </Svg>

      {legend && legend.length > 0 ? (
        <View style={styles.legendRow}>
          {legend.map((item, i) => (
            <View key={i} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <AppText variant="caption" style={styles.legendLabel}>
                {item.label}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#04211d",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: spacing[3]
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing[2]
  },
  title: { color: "rgba(255,255,255,0.85)" },
  meta: { color: "rgba(255,255,255,0.6)" },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3], marginTop: spacing[2] },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: radius.full },
  legendLabel: { color: "rgba(255,255,255,0.8)" }
});
