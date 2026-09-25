// Labels shared by the counts list, the count sheet and the variance report.

export const COUNT_STATUS: Record<string, { label: string; tone: "ok" | "low" | "out" | "muted" | "info" }> = {
  IN_PROGRESS: { label: "Counting", tone: "info" },
  SUBMITTED: { label: "Waiting review", tone: "low" },
  RECOUNT: { label: "Recount asked", tone: "low" },
  APPROVED: { label: "Approved", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export const SCOPE_LABELS: Record<string, string> = { FULL: "Full count", SPOT: "Spot count", HANDOVER: "Handover count" };
