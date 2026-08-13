const DAY_MS = 24 * 60 * 60 * 1000;

export type NrmsDunningStage = "CURRENT" | "REMINDER" | "WARNING" | "GRACE" | "PAYMENT_REQUIRED";

export function evaluateNrmsDunning(input: {
  balance: number;
  reminderAmount: number;
  warningAmount: number;
  unpaidLimit: number;
  graceDays: number;
  limitReachedAt?: Date | null;
  trialEndsAt?: Date | null;
  currentStatus?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const balance = Math.max(0, Number(input.balance) || 0);
  const graceDays = Math.max(0, Math.floor(Number(input.graceDays) || 0));
  const baseStatus = input.trialEndsAt && now < input.trialEndsAt ? "TRIAL" : "ACTIVE";

  if (["CLOSED", "FROZEN"].includes(String(input.currentStatus))) {
    return { status: input.currentStatus, stage: "CURRENT" as NrmsDunningStage, limitReachedAt: input.limitReachedAt ?? null, freezeAt: null };
  }
  if (input.currentStatus === "PAYMENT_PENDING") {
    return { status: "PAYMENT_PENDING", stage: "GRACE" as NrmsDunningStage, limitReachedAt: input.limitReachedAt ?? null, freezeAt: null };
  }
  if (balance < input.reminderAmount) {
    return { status: baseStatus, stage: "CURRENT" as NrmsDunningStage, limitReachedAt: null, freezeAt: null };
  }
  if (balance < input.warningAmount) {
    return { status: baseStatus, stage: "REMINDER" as NrmsDunningStage, limitReachedAt: null, freezeAt: null };
  }
  if (balance < input.unpaidLimit) {
    return { status: "WARNING", stage: "WARNING" as NrmsDunningStage, limitReachedAt: null, freezeAt: null };
  }

  const limitReachedAt = input.limitReachedAt ?? now;
  const freezeAt = new Date(limitReachedAt.getTime() + graceDays * DAY_MS);
  const frozen = now >= freezeAt;
  return {
    status: frozen ? "PAYMENT_REQUIRED" : "WARNING",
    stage: frozen ? "PAYMENT_REQUIRED" as NrmsDunningStage : "GRACE" as NrmsDunningStage,
    limitReachedAt,
    freezeAt,
  };
}
