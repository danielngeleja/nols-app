import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { FeaturedTourOperator } from "../tours";
import { FeaturedTourOperatorCard } from "./FeaturedTourOperatorCard";

type FeaturedOperatorCarouselProps = {
  operators: FeaturedTourOperator[];
  onPressOperator: (operator: FeaturedTourOperator) => void;
  /** Horizontal padding around the rail. Defaults to the screen gutter. */
  gutter?: number;
};

/**
 * The home page tour operator rail, reused as is. One card shows per view with the next
 * hidden in a horizontal slide, snapping per card, with dots, and auto rotating every 15
 * seconds while nothing is being touched. The first drag stops the auto rotation.
 */
export function FeaturedOperatorCarousel({ operators, onPressOperator, gutter = spacing[4] }: FeaturedOperatorCarouselProps) {
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.max(284, windowWidth - gutter * 2 - spacing[3] * 2);
  const step = cardWidth + spacing[3];

  const scrollRef = useRef<ScrollView | null>(null);
  const [index, setIndex] = useState(0);
  const [autoSlide, setAutoSlide] = useState(true);

  useEffect(() => {
    if (!autoSlide || operators.length <= 1) return;
    const timer = setInterval(() => {
      const next = (index + 1) % operators.length;
      setIndex(next);
      scrollRef.current?.scrollTo({ x: next * step, animated: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [autoSlide, index, operators.length, step]);

  // Keep the index in range when the filtered list shrinks.
  useEffect(() => {
    if (index > operators.length - 1) {
      const clamped = Math.max(0, operators.length - 1);
      setIndex(clamped);
      scrollRef.current?.scrollTo({ x: clamped * step, animated: false });
    }
  }, [operators.length, index, step]);

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        decelerationRate="fast"
        snapToInterval={step}
        snapToAlignment="start"
        onScrollBeginDrag={() => setAutoSlide(false)}
        onMomentumScrollEnd={(event) => {
          const next = Math.round(event.nativeEvent.contentOffset.x / step);
          setIndex(Math.max(0, Math.min(next, operators.length - 1)));
        }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.rail, { paddingHorizontal: gutter }]}
      >
        {operators.map((operator) => (
          <FeaturedTourOperatorCard
            key={operator.key}
            item={operator}
            width={cardWidth}
            onPress={() => {
              setAutoSlide(false);
              onPressOperator(operator);
            }}
          />
        ))}
      </ScrollView>
      {operators.length > 1 ? (
        <View style={styles.dots}>
          {operators.map((operator, i) => (
            <View key={`op-dot-${operator.key}`} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { gap: spacing[3] },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: spacing[3] },
  dot: { width: 14, height: 4, borderRadius: radius.full, backgroundColor: colors.border },
  dotActive: { width: 22, backgroundColor: colors.primary }
});
