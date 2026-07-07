import { useRef, useState } from "react";
import { LayoutChangeEvent, PanResponder, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { AppText } from "./AppText";

const THUMB = 26;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function abbr(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(n % 1000 ? 1 : 0))}k`;
  return String(Math.round(n));
}

function niceRound(n: number): number {
  if (n <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.max(1, Math.round(n / mag) * mag);
}

type PriceRangeSliderProps = {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  currency?: string;
  onChange: (lo: number, hi: number) => void;
};

/**
 * Dual thumb price slider with a connected fill that grows as you drag. Built on
 * PanResponder so it needs no native dependency and works on web and devices.
 */
export function PriceRangeSlider({ min, max, valueMin, valueMax, currency, onChange }: PriceRangeSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);

  const widthRef = useRef(0);
  const minRef = useRef(min);
  const rangeRef = useRef(Math.max(1, max - min));
  const stepRef = useRef(Math.max(1, niceRound(Math.max(1, max - min) / 50)));
  const loRef = useRef(valueMin);
  const hiRef = useRef(valueMax);
  const onChangeRef = useRef(onChange);
  const startX = useRef(0);

  widthRef.current = trackWidth;
  minRef.current = min;
  rangeRef.current = Math.max(1, max - min);
  stepRef.current = Math.max(1, niceRound(rangeRef.current / 50));
  loRef.current = valueMin;
  hiRef.current = valueMax;
  onChangeRef.current = onChange;

  function valueToX(v: number): number {
    return ((clamp(v, minRef.current, minRef.current + rangeRef.current) - minRef.current) / rangeRef.current) * widthRef.current;
  }
  function xToValue(x: number): number {
    const w = Math.max(1, widthRef.current);
    const raw = minRef.current + (clamp(x, 0, widthRef.current) / w) * rangeRef.current;
    return Math.round(raw / stepRef.current) * stepRef.current;
  }

  const loPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startX.current = valueToX(loRef.current);
      },
      onPanResponderMove: (_e, g) => {
        if (widthRef.current <= 0) return;
        const v = clamp(xToValue(startX.current + g.dx), minRef.current, hiRef.current - stepRef.current);
        onChangeRef.current(v, hiRef.current);
      }
    })
  ).current;

  const hiPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startX.current = valueToX(hiRef.current);
      },
      onPanResponderMove: (_e, g) => {
        if (widthRef.current <= 0) return;
        const v = clamp(xToValue(startX.current + g.dx), loRef.current + stepRef.current, minRef.current + rangeRef.current);
        onChangeRef.current(loRef.current, v);
      }
    })
  ).current;

  function onLayout(e: LayoutChangeEvent) {
    setTrackWidth(e.nativeEvent.layout.width);
  }

  const loX = valueToX(valueMin);
  const hiX = valueToX(valueMax);

  return (
    <View style={styles.wrap}>
      <View style={styles.labels}>
        <AppText variant="bodySmall" weight="bold" tone="primary">
          {abbr(valueMin)}
          {currency ? ` ${currency}` : ""}
        </AppText>
        <AppText variant="bodySmall" weight="bold" tone="primary">
          {abbr(valueMax)}
          {valueMax >= max ? "+" : ""}
          {currency ? ` ${currency}` : ""}
        </AppText>
      </View>

      <View style={styles.trackArea}>
        <View style={styles.track} onLayout={onLayout}>
          <View style={styles.rail} />
          <View style={[styles.fill, { left: loX, width: Math.max(0, hiX - loX) }]} />
          <View style={[styles.thumb, { left: loX - THUMB / 2 }]} hitSlop={10} {...loPan.panHandlers} />
          <View style={[styles.thumb, { left: hiX - THUMB / 2 }]} hitSlop={10} {...hiPan.panHandlers} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[2]
  },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  trackArea: {
    paddingHorizontal: THUMB / 2,
    paddingVertical: spacing[2]
  },
  track: {
    height: THUMB,
    justifyContent: "center"
  },
  rail: {
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border
  },
  fill: {
    position: "absolute",
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.primary
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.primary,
    ...shadows.card
  }
});
