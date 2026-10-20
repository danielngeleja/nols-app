import { X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MAX_ZOOM = 4;
const DOUBLE_TAP_MS = 280;
const THUMB_STEP = 60;

function clamp(value: number, lower: number, upper: number) {
  return Math.min(upper, Math.max(lower, value));
}

function PhotoCanvas({
  uri,
  width,
  height,
  active,
  onZoomChange,
  onToggleChrome
}: {
  uri: string;
  width: number;
  height: number;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
  onToggleChrome: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scaleRef = useRef(1);
  const xRef = useRef(0);
  const yRef = useRef(0);
  const lastTapRef = useRef(0);
  const pinchStartRef = useRef(1);
  const distanceStartRef = useRef(1);
  const panStartRef = useRef({ x: 0, y: 0, dx: 0, dy: 0 });
  const modeRef = useRef<"pan" | "pinch" | null>(null);
  const zoomedRef = useRef(false);
  const pinchCenterRef = useRef({ x: 0, y: 0 });
  const pinchOffsetRef = useRef({ x: 0, y: 0 });
  const [imageRatio, setImageRatio] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);

  const setZoomed = useCallback((value: boolean) => {
    if (zoomedRef.current === value) return;
    zoomedRef.current = value;
    if (active) onZoomChange(value);
  }, [active, onZoomChange]);

  const bounds = useCallback((nextScale: number) => {
    const displayedWidth = imageRatio ? Math.min(width, height * imageRatio) : width;
    const displayedHeight = imageRatio ? Math.min(height, width / imageRatio) : height;
    return {
      x: Math.max(0, (displayedWidth * nextScale - width) / 2),
      y: Math.max(0, (displayedHeight * nextScale - height) / 2)
    };
  }, [width, height, imageRatio]);

  const settle = useCallback((nextScale: number, nextX: number, nextY: number) => {
    const targetScale = clamp(nextScale, 1, MAX_ZOOM);
    const limit = bounds(targetScale);
    const targetX = clamp(nextX, -limit.x, limit.x);
    const targetY = clamp(nextY, -limit.y, limit.y);
    scaleRef.current = targetScale;
    xRef.current = targetX;
    yRef.current = targetY;
    setZoomed(targetScale > 1.01);
    Animated.parallel([
      Animated.spring(scale, { toValue: targetScale, useNativeDriver: true, damping: 22, stiffness: 220 }),
      Animated.spring(translateX, { toValue: targetX, useNativeDriver: true, damping: 22, stiffness: 220 }),
      Animated.spring(translateY, { toValue: targetY, useNativeDriver: true, damping: 22, stiffness: 220 })
    ]).start();
  }, [bounds, scale, setZoomed, translateX, translateY]);

  useEffect(() => {
    if (!active) settle(1, 0, 0);
  }, [active, settle]);

  const startPinch = useCallback((touches: readonly { pageX: number; pageY: number }[]) => {
    modeRef.current = "pinch";
    pinchStartRef.current = scaleRef.current;
    distanceStartRef.current = Math.hypot(
      touches[0].pageX - touches[1].pageX,
      touches[0].pageY - touches[1].pageY
    ) || 1;
    pinchCenterRef.current = {
      x: (touches[0].pageX + touches[1].pageX) / 2 - width / 2,
      y: (touches[0].pageY + touches[1].pageY) / 2 - height / 2
    };
    pinchOffsetRef.current = { x: xRef.current, y: yRef.current };
  }, [width, height]);

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) =>
      event.nativeEvent.touches.length >= 2 ||
      (scaleRef.current > 1.01 && (Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3)),
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        startPinch(touches);
      } else {
        modeRef.current = "pan";
        panStartRef.current = { x: xRef.current, y: yRef.current, dx: 0, dy: 0 };
      }
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        if (modeRef.current !== "pinch") startPinch(touches);
        const distance = Math.hypot(
          touches[0].pageX - touches[1].pageX,
          touches[0].pageY - touches[1].pageY
        );
        const nextScale = clamp(pinchStartRef.current * distance / distanceStartRef.current, 1, MAX_ZOOM);
        const ratio = nextScale / pinchStartRef.current;
        const limit = bounds(nextScale);
        const centerX = (touches[0].pageX + touches[1].pageX) / 2 - width / 2;
        const centerY = (touches[0].pageY + touches[1].pageY) / 2 - height / 2;
        xRef.current = clamp(centerX - (pinchCenterRef.current.x - pinchOffsetRef.current.x) * ratio, -limit.x, limit.x);
        yRef.current = clamp(centerY - (pinchCenterRef.current.y - pinchOffsetRef.current.y) * ratio, -limit.y, limit.y);
        scaleRef.current = nextScale;
        scale.setValue(nextScale);
        translateX.setValue(xRef.current);
        translateY.setValue(yRef.current);
        if (nextScale > 1.01) setZoomed(true);
      } else if (touches.length === 1 && scaleRef.current > 1.01) {
        if (modeRef.current !== "pan") {
          modeRef.current = "pan";
          panStartRef.current = { x: xRef.current, y: yRef.current, dx: gesture.dx, dy: gesture.dy };
        }
        const limit = bounds(scaleRef.current);
        xRef.current = clamp(panStartRef.current.x + gesture.dx - panStartRef.current.dx, -limit.x, limit.x);
        yRef.current = clamp(panStartRef.current.y + gesture.dy - panStartRef.current.dy, -limit.y, limit.y);
        translateX.setValue(xRef.current);
        translateY.setValue(yRef.current);
      }
    },
    onPanResponderRelease: () => {
      modeRef.current = null;
      settle(scaleRef.current < 1.05 ? 1 : scaleRef.current, xRef.current, yRef.current);
    },
    onPanResponderTerminate: () => {
      modeRef.current = null;
      settle(scaleRef.current < 1.05 ? 1 : scaleRef.current, xRef.current, yRef.current);
    }
  }), [bounds, scale, setZoomed, settle, startPinch, translateX, translateY, width, height]);

  return (
    <View style={{ width, height }} {...responder.panHandlers}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Photo. Double tap to zoom, or swipe to see another photo"
        onPress={(event) => {
          const now = Date.now();
          if (now - lastTapRef.current < DOUBLE_TAP_MS) {
            if (scaleRef.current > 1.01) {
              settle(1, 0, 0);
            } else {
              const point = event.nativeEvent;
              const nextScale = 2.5;
              const limit = bounds(nextScale);
              settle(
                nextScale,
                clamp((width / 2 - point.locationX) * (nextScale - 1), -limit.x, limit.x),
                clamp((height / 2 - point.locationY) * (nextScale - 1), -limit.y, limit.y)
              );
            }
            lastTapRef.current = 0;
          } else {
            lastTapRef.current = now;
            onToggleChrome();
          }
        }}
        style={styles.photoTouch}
      >
        <Animated.View style={{ width, height, transform: [{ translateX }, { translateY }] }}>
          <Animated.Image
            key={`${uri}-${retry}`}
            source={{ uri }}
            resizeMode="contain"
            style={{ width, height, transform: [{ scale }] }}
            onLoad={({ nativeEvent: { source } }) => {
              if (source.height > 0) setImageRatio(source.width / source.height);
              setLoadState("ready");
            }}
            onError={() => setLoadState("error")}
          />
        </Animated.View>
      </Pressable>
      {active && loadState === "loading" ? (
        <View pointerEvents="none" style={styles.imageStatus}>
          <ActivityIndicator color="#ffffff" />
        </View>
      ) : null}
      {active && loadState === "error" ? (
        <View style={styles.imageStatus}>
          <Text style={styles.imageError}>This photo could not load.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading photo"
            onPress={() => {
              setLoadState("loading");
              setRetry((value) => value + 1);
            }}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function ImmersivePhotoViewer({
  images,
  initialIndex,
  title,
  onIndexChange,
  onClose
}: {
  images: string[];
  initialIndex: number;
  title: string;
  onIndexChange?: (index: number) => void;
  onClose: (index: number) => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<string>>(null);
  const thumbsRef = useRef<FlatList<string>>(null);
  const indexRef = useRef(clamp(initialIndex, 0, images.length - 1));
  const prefetchedRef = useRef(new Set<string>());
  const [index, setIndex] = useState(indexRef.current);
  const [zoomed, setZoomed] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  useEffect(() => {
    for (const neighbor of [index + 1, index - 1]) {
      const uri = images[neighbor];
      if (!uri || prefetchedRef.current.has(uri)) continue;
      prefetchedRef.current.add(uri);
      void Image.prefetch(uri).then((cached) => {
        if (!cached) prefetchedRef.current.delete(uri);
      }).catch(() => {
        prefetchedRef.current.delete(uri);
      });
    }
  }, [images, index]);

  const thumbnailOffset = useCallback((photoIndex: number) =>
    Math.max(0, photoIndex * THUMB_STEP - width / 2 + THUMB_STEP / 2), [width]);

  const changeIndex = useCallback((next: number) => {
    indexRef.current = next;
    setIndex(next);
    onIndexChange?.(next);
    setZoomed(false);
    thumbsRef.current?.scrollToOffset({ offset: thumbnailOffset(next), animated: true });
  }, [onIndexChange, thumbnailOffset]);

  const onSwipeEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    changeIndex(clamp(Math.round(event.nativeEvent.contentOffset.x / width), 0, images.length - 1));
  }, [changeIndex, images.length, width]);

  const jumpTo = useCallback((next: number) => {
    changeIndex(next);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  }, [changeIndex]);

  return (
    <View style={styles.viewer}>
      <StatusBar hidden />
        <FlatList
          ref={listRef}
          data={images}
          keyExtractor={(item, photoIndex) => `${photoIndex}-${item}`}
          horizontal
          pagingEnabled
          extraData={index}
          removeClippedSubviews={false}
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={indexRef.current}
          getItemLayout={(_, photoIndex) => ({ length: width, offset: width * photoIndex, index: photoIndex })}
          onMomentumScrollEnd={onSwipeEnd}
          onScrollToIndexFailed={({ index: failedIndex }) => listRef.current?.scrollToOffset({ offset: failedIndex * width, animated: false })}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={3}
          renderItem={({ item, index: photoIndex }) => (
            <PhotoCanvas
              uri={item}
              width={width}
              height={height}
              active={photoIndex === index}
              onZoomChange={setZoomed}
              onToggleChrome={() => setChromeVisible((value) => !value)}
            />
          )}
        />

        {chromeVisible ? (
          <>
            <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close photo"
                onPress={() => onClose(indexRef.current)}
                hitSlop={10}
                style={styles.closeButton}
              >
                <X size={23} color="#ffffff" />
              </Pressable>
              <Text style={styles.counter}>{index + 1} / {images.length}</Text>
            </View>
            <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) + 10 }]}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              {images.length > 1 ? (
                <FlatList
                  ref={thumbsRef}
                  data={images}
                  keyExtractor={(uri, photoIndex) => `${photoIndex}-${uri}`}
                  horizontal
                  extraData={index}
                  showsHorizontalScrollIndicator={false}
                  initialScrollIndex={indexRef.current}
                  getItemLayout={(_, photoIndex) => ({ length: THUMB_STEP, offset: THUMB_STEP * photoIndex, index: photoIndex })}
                  onLayout={() => thumbsRef.current?.scrollToOffset({ offset: thumbnailOffset(indexRef.current), animated: false })}
                  initialNumToRender={5}
                  maxToRenderPerBatch={5}
                  windowSize={3}
                  contentContainerStyle={styles.thumbRow}
                  renderItem={({ item: uri, index: photoIndex }) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Photo ${photoIndex + 1} of ${images.length}`}
                      accessibilityState={{ selected: photoIndex === index }}
                      onPress={() => jumpTo(photoIndex)}
                      style={[styles.thumb, photoIndex === index && styles.thumbSelected]}
                    >
                      <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
                    </Pressable>
                  )}
                />
              ) : null}
            </View>
          </>
        ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flex: 1, backgroundColor: "#05070b" },
  photoTouch: { flex: 1, justifyContent: "center", alignItems: "center" },
  imageStatus: { ...StyleSheet.absoluteFill, justifyContent: "center", alignItems: "center", gap: 14 },
  imageError: { color: "#ffffff", fontSize: 15 },
  retryButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)" },
  retryText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(5,7,11,0.68)"
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)"
  },
  counter: { color: "#ffffff", fontSize: 15, fontWeight: "700", letterSpacing: 0.3 },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 18,
    backgroundColor: "rgba(5,7,11,0.72)"
  },
  title: { color: "#ffffff", fontSize: 14, fontWeight: "600", marginHorizontal: 20, marginBottom: 12 },
  thumbRow: { paddingHorizontal: 20, gap: 8 },
  thumb: { width: 52, height: 52, padding: 2, borderRadius: 9, borderWidth: 2, borderColor: "transparent" },
  thumbSelected: { borderColor: "#ffffff" },
  thumbImage: { width: "100%", height: "100%", borderRadius: 5 }
});
