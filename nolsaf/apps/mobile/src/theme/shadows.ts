import { Platform } from "react-native";

export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: "#020617",
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 }
    },
    android: {
      elevation: 2
    },
    default: {}
  }),
  sheet: Platform.select({
    ios: {
      shadowColor: "#020617",
      shadowOpacity: 0.16,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 }
    },
    android: {
      elevation: 8
    },
    default: {}
  })
} as const;
