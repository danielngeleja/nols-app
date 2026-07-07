import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { AppButton } from "./AppButton";
import { AppText } from "./AppText";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayYmd(): string {
  const t = new Date();
  return ymd(t.getFullYear(), t.getMonth(), t.getDate());
}

type CalendarRangeSheetProps = {
  visible: boolean;
  checkIn: string;
  checkOut: string;
  onClose: () => void;
  onApply: (checkIn: string, checkOut: string) => void;
  mode?: "range" | "single";
  title?: string;
};

/**
 * Custom check in and check out calendar. No native date picker dependency, so
 * it behaves identically on web and on device. Dates are YYYY-MM-DD strings,
 * which compare correctly with simple string comparison.
 */
export function CalendarRangeSheet({ visible, checkIn, checkOut, onClose, onApply, mode = "range", title = "Select dates" }: CalendarRangeSheetProps) {
  const [inDate, setInDate] = useState(checkIn);
  const [outDate, setOutDate] = useState(checkOut);
  const [view, setView] = useState(() => {
    const base = checkIn ? new Date(`${checkIn}T00:00:00`) : new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  useEffect(() => {
    if (!visible) return;
    setInDate(checkIn);
    setOutDate(checkOut);
    const base = checkIn ? new Date(`${checkIn}T00:00:00`) : new Date();
    setView({ y: base.getFullYear(), m: base.getMonth() });
  }, [visible, checkIn, checkOut]);

  const today = todayYmd();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const cells: Array<string | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(ymd(view.y, view.m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  function shiftMonth(delta: number) {
    setView((v) => {
      const next = new Date(v.y, v.m + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });
  }

  function pickDay(day: string) {
    if (mode === "single") {
      setInDate(day);
      setOutDate("");
      return;
    }
    if (!inDate || (inDate && outDate)) {
      setInDate(day);
      setOutDate("");
      return;
    }
    if (day <= inDate) {
      setInDate(day);
      return;
    }
    setOutDate(day);
  }

  const canApply = mode === "single" ? Boolean(inDate) : Boolean(inDate && outDate);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <AppText variant="title" weight="bold">
              {title}
            </AppText>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.close}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <AppText variant="caption" tone="muted">
                {mode === "single" ? "Travel date" : "Check in"}
              </AppText>
              <AppText variant="bodySmall" weight="bold">
                {inDate || "Select"}
              </AppText>
            </View>
            {mode === "range" ? (
              <View style={styles.summaryItem}>
                <AppText variant="caption" tone="muted">
                  Check out
                </AppText>
                <AppText variant="bodySmall" weight="bold">
                  {outDate || "Select"}
                </AppText>
              </View>
            ) : null}
          </View>

          <View style={styles.monthRow}>
            <Pressable accessibilityRole="button" onPress={() => shiftMonth(-1)} hitSlop={8} style={styles.monthNav}>
              <ChevronLeft color={colors.ink} size={20} />
            </Pressable>
            <AppText variant="bodySmall" weight="bold">
              {MONTHS[view.m]} {view.y}
            </AppText>
            <Pressable accessibilityRole="button" onPress={() => shiftMonth(1)} hitSlop={8} style={styles.monthNav}>
              <ChevronRight color={colors.ink} size={20} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <View key={i} style={styles.weekCell}>
                <AppText variant="caption" weight="bold" tone="muted">
                  {w}
                </AppText>
              </View>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, i) => {
              if (!day) return <View key={i} style={styles.dayCell} />;
              const isPast = day < today;
              const isIn = day === inDate;
              const isOut = mode === "range" && day === outDate;
              const inRange = Boolean(mode === "range" && inDate && outDate && day > inDate && day < outDate);
              const isEdge = isIn || isOut;
              const num = Number(day.slice(-2));
              return (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  disabled={isPast}
                  onPress={() => pickDay(day)}
                  style={[styles.dayCell, inRange && styles.dayInRange, isEdge && styles.dayEdge]}
                >
                  <AppText
                    variant="bodySmall"
                    weight={isEdge ? "bold" : "regular"}
                    tone={isEdge ? "inverse" : isPast ? "soft" : "default"}
                    style={isPast ? styles.dayPast : undefined}
                  >
                    {num}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.footer}>
            <View style={styles.flex}>
              <AppButton
                title="Clear"
                variant="ghost"
                onPress={() => {
                  setInDate("");
                  setOutDate("");
                }}
              />
            </View>
            <View style={styles.flex}>
              <AppButton title="Apply" disabled={!canApply} onPress={() => onApply(inDate, mode === "single" ? inDate : outDate)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.42)"
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.white,
    paddingTop: spacing[5],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
    ...shadows.sheet
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[4]
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  },
  summary: {
    flexDirection: "row",
    gap: spacing[3],
    marginBottom: spacing[4]
  },
  summaryItem: {
    flex: 1,
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[3]
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[3]
  },
  monthNav: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  },
  weekRow: {
    flexDirection: "row"
  },
  weekCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing[2]
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  dayInRange: {
    backgroundColor: colors.brand[50]
  },
  dayEdge: {
    backgroundColor: colors.primary,
    borderRadius: radius.full
  },
  dayPast: {
    textDecorationLine: "line-through"
  },
  footer: {
    flexDirection: "row",
    gap: spacing[3],
    marginTop: spacing[4]
  },
  flex: {
    flex: 1,
    minWidth: 0
  }
});
