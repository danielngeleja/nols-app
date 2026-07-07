export type ReferralEntry = {
  name: string;
  joinedAt: string;
};

export type ReferralInfo = {
  ok: boolean;
  code: string;
  link: string;
  total: number;
  referrals: ReferralEntry[];
};
