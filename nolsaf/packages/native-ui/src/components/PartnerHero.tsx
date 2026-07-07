import { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";

import { radius, spacing } from "../theme";
import { AppText } from "./AppText";

export type PartnerHeroProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
  subtitle?: string;
  live?: boolean;
  align?: "center" | "left";
  /** Optional action rendered at the top right of the hero (for example a bell or sign out). */
  headerRight?: ReactNode;
}>;

const BACKDROP_BARS = [235, 250, 265, 280, 295, 310, 325, 340];

// The premium dark teal hero shared across the Partners app, reused from the web
// portal look (gradient, eyebrow, optional Live pill, big title, subtitle, and a
// faint trend backdrop). Children render below the title (for example the glass
// HeroStat cards). The gradient and backdrop use react-native-svg so no extra
// dependency is needed. align="center" matches the Owner home, "left" the
// Operator home.
export function PartnerHero({ eyebrow, title, subtitle, live, align = "center", headerRight, children }: PartnerHeroProps) {
  const alignItems = align === "center" ? "center" : "flex-start";
  const textAlign = align === "center" ? "center" : "left";

  return (
    <View style={styles.wrap}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 360 260" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="partnerHeroGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#04211d" />
            <Stop offset="0.5" stopColor="#053a31" />
            <Stop offset="1" stopColor="#0a6253" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="360" height="260" fill="url(#partnerHeroGrad)" />
        {/* Watermark — large diagonal "OWNER PORTAL" in the background */}
        <SvgText
          x="180"
          y="145"
          fontSize="46"
          fontWeight="bold"
          fill="#3ec9a6"
          fillOpacity={0.06}
          textAnchor="middle"
          letterSpacing="8"
          transform="rotate(-18, 180, 145)"
        >
          OWNER PORTAL
        </SvgText>
        <Path
          d="M0 210 L70 160 L120 185 L180 80 L235 130 L285 105 L360 70"
          stroke="#3ec9a6"
          strokeWidth={2}
          fill="none"
          strokeOpacity={0.4}
        />
        {BACKDROP_BARS.map((x, i) => (
          <Rect key={i} x={x} y={188 + (i % 3) * 8} width={9} height={72 - (i % 3) * 8} fill="#1d9e75" fillOpacity={0.25} />
        ))}
      </Svg>

      {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}

      <View style={[styles.content, { alignItems }]}>
        <AppText variant="caption" style={styles.eyebrow}>
          {eyebrow}
        </AppText>

        {live ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <AppText variant="caption" style={styles.liveText}>
              Live
            </AppText>
          </View>
        ) : null}

        <AppText variant="headline" weight="extraBold" style={[styles.title, { textAlign }]}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="bodySmall" style={[styles.subtitle, { textAlign }]}>
            {subtitle}
          </AppText>
        ) : null}

        {children ? <View style={styles.childrenWrap}>{children}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radius.xl,
    backgroundColor: "#053a31"
  },
  content: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: spacing[5]
  },
  headerRight: {
    position: "absolute",
    top: spacing[4],
    right: spacing[4],
    zIndex: 2
  },
  eyebrow: {
    color: "rgba(127,217,191,0.35)",
    letterSpacing: 4,
    fontSize: 10,
    fontWeight: "700",
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.07)"
  },
  liveDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: "#2fd39e" },
  liveText: { color: "#cdeee2" },
  title: { color: "#ffffff", marginTop: spacing[3] },
  subtitle: { color: "rgba(255,255,255,0.6)", marginTop: spacing[2] },
  childrenWrap: { width: "100%", marginTop: spacing[4] }
});
