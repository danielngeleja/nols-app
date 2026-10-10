export type NotificationPreferences = {
  bookings: boolean;
  promotions: boolean;
  referrals: boolean;
};

export type AccountSession = {
  id: string;
  userAgent?: string | null;
  ip?: string | null;
  createdAt?: string | null;
  lastSeenAt?: string | null;
};

export type LoginRecord = {
  id: string;
  at: string;
  ip?: string | null;
  platform?: string | null;
  details?: string | null;
  success?: boolean | null;
};

/** Counts behind the Account hub tiles; null means that service could not be reached. */
export type AccountOverview = {
  stays: number | null;
  rides: number | null;
  groupStays: number | null;
  tours: number | null;
  saved: number | null;
};

export type NotificationPreferencesResponse = {
  ok: boolean;
  data: { preferences: NotificationPreferences };
};
