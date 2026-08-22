// The roles the Partners app gates on. The backend issues a single role per
// account (see apps/api/src/middleware/auth.ts), so v1 routes to exactly one
// dashboard. OWNER and AGENT are the partner roles; anything else is refused.
export type AccountRole = "OWNER" | "AGENT" | "USER" | "CUSTOMER" | "DRIVER" | "ADMIN" | string;

export type AuthUser = {
  id: number;
  role: AccountRole;
  email?: string | null;
  name?: string | null;
  fullName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  suspendedAt?: string | null;
  registrationStatus?: "INCOMPLETE" | "COMPLETE";
  registrationSource?: string | null;
  profileCompletedAt?: string | null;
  hasPassword?: boolean;
};

export type LoginResponse = {
  ok: boolean;
  token?: string;
  user?: AuthUser;
  error?: string;
  message?: string;
};

export type AuthState = {
  status: "loading" | "guest" | "authenticated";
  token: string | null;
  user: AuthUser | null;
  error: string | null;
};

// The operator (agent) context, read from /api/agent/me. A 403 with
// error "AGENT_SUSPENDED" means the gate must show the suspended state.
export type AgentMe = {
  agent?: {
    level?: string | null;
    performanceMetrics?: {
      overallRating?: number | null;
      totalReviews?: number | null;
    } | null;
  } | null;
};
