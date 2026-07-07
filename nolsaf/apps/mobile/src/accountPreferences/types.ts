export type NotificationPreferences = {
  bookings: boolean;
  promotions: boolean;
  referrals: boolean;
};

export type NotificationPreferencesResponse = {
  ok: boolean;
  data: { preferences: NotificationPreferences };
};
