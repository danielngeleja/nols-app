import { Star, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { AppButton } from "./AppButton";
import { AppInput } from "./AppInput";
import { AppStack } from "./AppStack";
import { AppText } from "./AppText";

const RATING_LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "customerCare", label: "Customer care" },
  { key: "security", label: "Security" },
  { key: "reality", label: "Reality" },
  { key: "comfort", label: "Comfort" }
];

const EMPTY_CATEGORIES: Record<string, number> = { customerCare: 0, security: 0, reality: 0, comfort: 0 };

type ReviewSheetProps = {
  visible: boolean;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (rating: number, title: string, comment: string, categoryRatings: Record<string, number>) => void;
};

function StarRow({ value, onChange, size = 30 }: { value: number; onChange: (n: number) => void; size?: number }) {
  return (
    <View style={styles.starsRow}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Pressable key={i} accessibilityRole="button" onPress={() => onChange(i + 1)} hitSlop={4}>
          <Star size={size} color="#f59e0b" fill={i < value ? "#f59e0b" : "transparent"} />
        </Pressable>
      ))}
    </View>
  );
}

/** Form for a guest to leave an overall rating, optional title, comment, and per category ratings. */
export function ReviewSheet({ visible, submitting, error, onClose, onSubmit }: ReviewSheetProps) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [categories, setCategories] = useState<Record<string, number>>(EMPTY_CATEGORIES);

  useEffect(() => {
    if (visible) {
      setRating(0);
      setTitle("");
      setComment("");
      setCategories(EMPTY_CATEGORIES);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <AppText variant="title" weight="bold">
              Write a review
            </AppText>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.close}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <AppStack gap={5}>
              <AppStack gap={2}>
                <AppText variant="label" weight="semiBold" tone="muted">
                  Overall rating
                </AppText>
                <View style={styles.ratingRow}>
                  <StarRow value={rating} onChange={setRating} />
                  {rating > 0 ? (
                    <AppText variant="bodySmall" weight="semiBold" tone="muted">
                      {RATING_LABELS[rating]}
                    </AppText>
                  ) : null}
                </View>
              </AppStack>

              <AppInput label="Title (optional)" value={title} onChangeText={setTitle} placeholder="Give your review a title" />

              <AppInput
                label="Your review"
                value={comment}
                onChangeText={setComment}
                placeholder="Share details about your stay"
                multiline
                style={styles.commentInput}
              />

              <AppStack gap={3}>
                <AppText variant="label" weight="semiBold" tone="muted">
                  Rate by category
                </AppText>
                {CATEGORIES.map((c) => {
                  const v = categories[c.key] ?? 0;
                  return (
                    <View key={c.key} style={styles.catBlock}>
                      <AppText variant="caption" weight="semiBold">
                        {c.label}
                      </AppText>
                      <View style={styles.catControls}>
                        <View style={styles.catBarTrack}>
                          <View style={[styles.catBarFill, { width: `${(v / 5) * 100}%` }]} />
                        </View>
                        <View style={styles.catStars}>
                          {[1, 2, 3, 4, 5].map((n) => {
                            const on = n <= v;
                            return (
                              <Pressable
                                key={n}
                                accessibilityRole="button"
                                onPress={() => setCategories((prev) => ({ ...prev, [c.key]: n }))}
                                style={[styles.starBox, on && styles.starBoxOn]}
                              >
                                <Star size={12} color={on ? "#d97706" : "#cbd5e1"} fill={on ? "#f59e0b" : "transparent"} />
                              </Pressable>
                            );
                          })}
                        </View>
                        <AppText variant="caption" weight="bold" style={styles.catValue}>
                          {v > 0 ? v.toFixed(1) : "0.0"}
                        </AppText>
                      </View>
                    </View>
                  );
                })}
              </AppStack>

              {error ? (
                <AppText variant="bodySmall" tone="danger">
                  {error}
                </AppText>
              ) : null}
            </AppStack>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.flex}>
              <AppButton title="Cancel" variant="ghost" onPress={onClose} />
            </View>
            <View style={styles.flex}>
              <AppButton
                title="Submit review"
                loading={submitting}
                disabled={rating === 0}
                onPress={() => onSubmit(rating, title.trim(), comment.trim(), categories)}
              />
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
    maxHeight: "90%",
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
  body: {
    paddingBottom: spacing[4]
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  starsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  commentInput: {
    minHeight: 110,
    paddingTop: spacing[3],
    textAlignVertical: "top"
  },
  catBlock: {
    gap: spacing[2]
  },
  catControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  catBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: "#e2e8f0",
    overflow: "hidden"
  },
  catBarFill: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary
  },
  catStars: {
    flexDirection: "row",
    gap: spacing[1]
  },
  starBox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  starBoxOn: {
    backgroundColor: "#fffbeb",
    borderColor: "#fcd34d"
  },
  catValue: {
    minWidth: 30,
    textAlign: "right"
  },
  footer: {
    flexDirection: "row",
    gap: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  flex: {
    flex: 1,
    minWidth: 0
  }
});
