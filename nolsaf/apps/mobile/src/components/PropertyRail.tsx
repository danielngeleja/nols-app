import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { useReducedMotion } from "../lib/useReducedMotion";
import { PublicPropertyCard } from "../properties";
import { colors, radius, shadows, spacing } from "../theme";
import { AppText } from "./AppText";
import { PropertyCard } from "./PropertyCard";

type PropertyRailProps = {
  items: PublicPropertyCard[];
  onCardPress?: (property: PublicPropertyCard) => void;
  /** When false the row never moves on its own; the user slides it by hand and
   *  photos do not auto cycle. Used by the calm main inventory rows. */
  autoRotate?: boolean;
  /** System default commission percent, used when a property has no override. */
  systemCommission?: number;
  /** IDs of properties the traveller has saved. Omit to hide the bookmark icon. */
  savedIds?: Set<number>;
  /** Toggles the saved state for a property. */
  onToggleSave?: (property: PublicPropertyCard) => void;
};

const GAP = spacing[3];
const SCREEN_PADDING = spacing[4] * 2;
const ROTATE_MS = 4000;
const RESUME_MS = 6000;

/**
 * Horizontal row of property tiles. Two show by default; the rest slide in. It
 * auto rotates so the row never sits static, pauses briefly after a manual
 * swipe, and shows chevron hints plus dots so hidden tiles are discoverable.
 */
export function PropertyRail({ items, onCardPress, autoRotate = true, systemCommission = 0, savedIds, onToggleSave }: PropertyRailProps) {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  const pausedRef = useRef(false);
  const hoverCount = useRef(0);
  const hoverPausedRef = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [index, setIndex] = useState(0);

  const containerWidth = Math.max(0, width - SCREEN_PADDING);
  const cardWidth = (containerWidth - GAP) / 2;
  const step = cardWidth + GAP;
  const maxIndex = Math.max(0, items.length - 2);
  const canSlide = items.length > 2;

  useEffect(() => {
    if (!autoRotate || !canSlide || reducedMotion) return;
    const id = setInterval(() => {
      if (pausedRef.current || hoverPausedRef.current) return;
      const next = indexRef.current >= maxIndex ? 0 : indexRef.current + 1;
      indexRef.current = next;
      setIndex(next);
      scrollRef.current?.scrollTo({ x: next * step, animated: true });
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [autoRotate, canSlide, reducedMotion, maxIndex, step]);

  useEffect(() => {
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const x = event.nativeEvent.contentOffset.x;
    const i = step > 0 ? Math.round(x / step) : 0;
    indexRef.current = i;
    setIndex(i);
  }

  function pause() {
    pausedRef.current = true;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
  }

  function resumeSoon() {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      pausedRef.current = false;
    }, RESUME_MS);
  }

  // Any hovered or pressed tile pauses the row rotation. A count keeps it stable
  // when the pointer moves directly from one tile to the next.
  function handleCardInteract(active: boolean) {
    hoverCount.current = Math.max(0, hoverCount.current + (active ? 1 : -1));
    hoverPausedRef.current = hoverCount.current > 0;
  }

  const chevronTop = cardWidth * 0.5;
  const showLeft = canSlide && index > 0;
  const showRight = canSlide && index < maxIndex;

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={step}
        snapToAlignment="start"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={pause}
        onScrollEndDrag={resumeSoon}
        contentContainerStyle={styles.rail}
      >
        {items.map((property) => (
          <View key={property.id} style={{ width: cardWidth }}>
            <PropertyCard
              property={property}
              onPress={onCardPress ? () => onCardPress(property) : undefined}
              onInteractChange={handleCardInteract}
              autoSlidePhotos={autoRotate && !reducedMotion}
              systemCommission={systemCommission}
              saved={savedIds?.has(property.id)}
              onToggleSave={onToggleSave ? () => onToggleSave(property) : undefined}
            />
          </View>
        ))}
      </ScrollView>

      {showLeft ? (
        <View style={[styles.navHint, styles.navLeft, { top: chevronTop }]} pointerEvents="none">
          <ChevronLeft color={colors.primary} size={18} />
        </View>
      ) : null}
      {showRight ? (
        <View style={[styles.navHint, styles.navRight, { top: chevronTop }]} pointerEvents="none">
          <ChevronRight color={colors.primary} size={18} />
        </View>
      ) : null}

      {canSlide ? (
        <View style={styles.dots}>
          {items.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      ) : null}

      {canSlide && !autoRotate ? (
        <AppText variant="caption" tone="soft" style={styles.slideHint}>
          Slide
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 0,
    position: "relative"
  },
  rail: {
    gap: GAP
  },
  navHint: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card
  },
  navLeft: {
    left: -spacing[1]
  },
  navRight: {
    right: -spacing[1]
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing[1],
    marginTop: spacing[3]
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.border
  },
  dotActive: {
    width: 18,
    backgroundColor: colors.primary
  },
  slideHint: {
    textAlign: "center",
    fontStyle: "italic",
    fontSize: 11,
    marginTop: spacing[1]
  }
});
