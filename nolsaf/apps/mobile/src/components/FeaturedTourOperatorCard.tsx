import { CheckCircle2, ExternalLink, MapPin, PackageCheck, TicketsPlane, TrendingUp } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ImageBackground, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { FeaturedTourOperator } from "../tours";
import { AppText } from "./AppText";

type FeaturedTourOperatorCardProps = {
  item: FeaturedTourOperator;
  width: number;
  onPress: () => void;
};

/**
 * The detailed tour operator card shown on the home page rail. Shared so the Tour
 * Packages discovery screen renders the exact same card. Includes the photo carousel,
 * verified and confidence badges, trip confidence, service chips, package list, and the
 * Preview and Book action.
 */
export function FeaturedTourOperatorCard({ item, width, onPress }: FeaturedTourOperatorCardProps) {
  const images = item.images.length > 0 ? item.images : item.image ? [item.image] : [];
  const imageWidth = width - spacing[3] * 2;
  const imageScrollRef = useRef<ScrollView | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  useEffect(() => {
    setActiveImageIndex(0);
    imageScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [item.key]);

  useEffect(() => {
    if (images.length <= 1) return;
    const timer = setInterval(() => {
      setActiveImageIndex((current) => {
        const next = (current + 1) % images.length;
        imageScrollRef.current?.scrollTo({ x: next * imageWidth, animated: true });
        return next;
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [imageWidth, images.length]);

  return (
    <Pressable
      accessibilityLabel={`Open ${item.operatorName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.tourPackageCard, { width }, pressed && styles.pressed]}
    >
      <View style={styles.tourOperatorHeader}>
        <AppText variant="titleSm" weight="extraBold" numberOfLines={1}>
          {item.operatorName}
        </AppText>
      </View>

      <View style={styles.tourPackageImageWrap}>
        {images.length > 0 ? (
          <ScrollView
            ref={imageScrollRef}
            horizontal
            style={styles.tourImageScroller}
            scrollEnabled={images.length > 1}
            showsHorizontalScrollIndicator={false}
            snapToInterval={imageWidth}
            decelerationRate="fast"
            onMomentumScrollEnd={(event) => {
              const nextIndex = Math.round(event.nativeEvent.contentOffset.x / imageWidth);
              setActiveImageIndex(Math.max(0, Math.min(nextIndex, images.length - 1)));
            }}
          >
            {images.map((image) => (
              <ImageBackground key={image} source={{ uri: image }} resizeMode="cover" style={[styles.tourPackageImage, { width: imageWidth }]} imageStyle={styles.tourPackageImageRadius}>
                <View style={styles.tourPackageImageOverlay} />
              </ImageBackground>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.tourPackageFallback}>
            <TicketsPlane color={colors.white} size={30} />
          </View>
        )}
        <View style={styles.tourVerifiedBadge}>
          <CheckCircle2 color={colors.white} size={12} />
          <AppText variant="caption" weight="extraBold" tone="inverse" style={styles.tourBadgeText}>
            Verified
          </AppText>
        </View>
        {item.confidenceScore ? (
          <View style={styles.tourConfidenceBadge}>
            <TrendingUp color={colors.white} size={12} />
            <AppText variant="caption" weight="extraBold" tone="inverse" style={styles.tourBadgeText}>
              {Math.round(item.confidenceScore)}%
            </AppText>
          </View>
        ) : null}
        {images.length > 1 ? (
          <View style={styles.tourPhotoDots}>
            {images.slice(0, 6).map((image, index) => (
              <View key={`tour-photo-dot-${item.key}-${image}`} style={[styles.tourPhotoDot, index === Math.min(activeImageIndex, 5) && styles.tourPhotoDotActive]} />
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.tourPackageBody}>
        <View style={styles.tourPriceRow}>
          <View style={styles.tourDestination}>
            <MapPin color={colors.primary} size={15} />
            <AppText variant="bodySmall" tone="muted" numberOfLines={1} style={styles.tourDestinationText}>
              {item.location}
            </AppText>
          </View>
          {item.lowestPricePerPerson ? (
            <View style={styles.tourPriceGroup}>
              <AppText variant="titleSm" weight="extraBold" tone="primary" numberOfLines={1}>
                {item.currency} {item.lowestPricePerPerson.toLocaleString()}
              </AppText>
              <AppText variant="caption" tone="soft" numberOfLines={1}>
                from
              </AppText>
            </View>
          ) : null}
        </View>

        {item.confidenceScore ? (
          <View style={styles.tourConfidencePanel}>
            <View style={styles.tourConfidenceTop}>
              <View style={styles.tourConfidenceTitle}>
                <TrendingUp color={colors.primary} size={15} />
                <AppText variant="caption" weight="extraBold" tone="primary" numberOfLines={1}>
                  Trip Confidence
                </AppText>
              </View>
              <View style={styles.tourConfidenceScore}>
                <AppText variant="caption" weight="extraBold" tone="inverse" numberOfLines={1}>
                  {Math.round(item.confidenceScore)}%
                </AppText>
              </View>
            </View>
            <AppText variant="caption" tone="muted" numberOfLines={2}>
              {item.averageRating ? `Recent ${item.averageRating.toFixed(1)}/5` : "Recent tour signals"}
              {item.totalRatings ? ` from ${item.totalRatings} event ratings` : ""}
              {item.topFeeling ? ` - ${item.topFeeling}` : ""}
            </AppText>
          </View>
        ) : null}

        {item.services.length > 0 ? (
          <View style={styles.tourServicesGrid}>
            {item.services.slice(0, 4).map((service) => (
              <View key={service} style={styles.tourServiceChip}>
                <CheckCircle2 color={colors.primary} size={12} />
                <AppText variant="caption" tone="primary" numberOfLines={1} style={styles.tourServiceText}>
                  {service}
                </AppText>
              </View>
            ))}
            {item.services.length > 4 ? (
              <View style={styles.tourServiceMore}>
                <AppText variant="caption" tone="soft" numberOfLines={1}>
                  +{item.services.length - 4} more
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}

        {item.packageTitles.length > 0 ? (
          <View style={styles.tourPackageList}>
            {item.packageTitles.map((title) => (
              <View key={title} style={styles.tourPackageListItem}>
                <PackageCheck color={colors.primary} size={13} />
                <AppText variant="caption" weight="semiBold" tone="default" numberOfLines={1} style={styles.tourServiceText}>
                  {title}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.tourMetaRow}>
          <View style={styles.tourPackageCount}>
            <PackageCheck color={colors.primary} size={14} />
            <AppText variant="caption" weight="semiBold" tone="soft" numberOfLines={1}>
              {item.packageCount} tour package{item.packageCount === 1 ? "" : "s"} available
            </AppText>
          </View>
          {item.completedTrips > 0 ? (
            <View style={styles.tourCategoryPill}>
              <AppText variant="caption" weight="bold" tone="primary" numberOfLines={1} style={styles.tourCategoryText}>
                {item.completedTrips} completed
              </AppText>
            </View>
          ) : null}
        </View>

        <View style={styles.tourPreviewButton}>
          <AppText variant="bodySmall" weight="extraBold" tone="inverse" numberOfLines={1}>
            Preview & Book
          </AppText>
          <ExternalLink color={colors.white} size={15} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tourPackageCard: {
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 3
  },
  pressed: { transform: [{ scale: 0.98 }] },
  tourOperatorHeader: { minWidth: 0, paddingHorizontal: spacing[3], paddingBottom: spacing[2], paddingTop: spacing[3] },
  tourPackageImageWrap: {
    height: 220,
    marginHorizontal: spacing[3],
    borderRadius: radius.lg,
    position: "relative",
    overflow: "hidden",
    backgroundColor: colors.primaryDeep
  },
  tourImageScroller: { flex: 1 },
  tourPackageImage: { height: "100%" },
  tourPackageImageRadius: { borderRadius: radius.lg },
  tourPackageImageOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(1,42,38,0.34)" },
  tourPackageFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.lg },
  tourVerifiedBadge: {
    position: "absolute",
    left: spacing[2],
    top: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.full,
    backgroundColor: colors.success,
    paddingHorizontal: spacing[2],
    paddingVertical: 4
  },
  tourBadgeText: { fontSize: 10, lineHeight: 12 },
  tourConfidenceBadge: {
    position: "absolute",
    right: spacing[2],
    top: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.full,
    backgroundColor: "rgba(1,42,38,0.74)",
    paddingHorizontal: spacing[2],
    paddingVertical: 4
  },
  tourPhotoDots: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5
  },
  tourPhotoDot: { width: 14, height: 4, borderRadius: radius.full, backgroundColor: "rgba(255,255,255,0.58)" },
  tourPhotoDotActive: { width: 22, backgroundColor: colors.white },
  tourPackageBody: { minWidth: 0, gap: spacing[3], padding: spacing[3], paddingTop: spacing[4] },
  tourPriceRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  tourDestination: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  tourDestinationText: { flex: 1 },
  tourPriceGroup: { minWidth: 0, alignItems: "flex-end" },
  tourConfidencePanel: {
    minWidth: 0,
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  tourConfidenceTop: { minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  tourConfidenceTitle: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing[1] },
  tourConfidenceScore: {
    minWidth: 44,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[2]
  },
  tourServicesGrid: { minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  tourServiceChip: {
    minWidth: 0,
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  tourServiceText: { flex: 1 },
  tourServiceMore: { width: "48%", borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing[2], paddingVertical: spacing[2] },
  tourPackageList: { minWidth: 0, gap: spacing[2], borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing[2] },
  tourPackageListItem: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  tourMetaRow: { minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  tourPackageCount: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing[1] },
  tourCategoryPill: { minWidth: 0, alignSelf: "flex-start", borderRadius: radius.full, backgroundColor: colors.brand[50], paddingHorizontal: spacing[2], paddingVertical: 4 },
  tourCategoryText: { textAlign: "center" },
  tourPreviewButton: {
    minHeight: 46,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    backgroundColor: colors.primary,
    marginTop: spacing[1]
  }
});
