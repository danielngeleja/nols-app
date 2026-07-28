export type AdminChannelHealthInput = {
  status: string;
  connectionType: string;
  hasActiveCredential: boolean;
  lastSuccessAt: Date | string | null;
  pendingDeliveries: number;
  sendingDeliveries: number;
  failedDeliveries: number;
  deadLetterDeliveries: number;
  failedInboundEvents: number;
  openIssues: number;
  criticalIssues: number;
  stuckDeliveries: number;
};

export type AdminChannelOperationalState = "HEALTHY" | "SYNCING" | "ATTENTION" | "CRITICAL" | "PAUSED" | "DISCONNECTED";

export function classifyAdminChannelHealth(input: AdminChannelHealthInput, now = new Date()): { state: AdminChannelOperationalState; lagMinutes: number | null; reasons: string[] } {
  const successAt = input.lastSuccessAt ? new Date(input.lastSuccessAt) : null;
  const lagMinutes = successAt && !Number.isNaN(successAt.getTime())
    ? Math.max(0, Math.floor((now.getTime() - successAt.getTime()) / 60_000))
    : null;
  if (input.status === "DISCONNECTED") return { state: "DISCONNECTED", lagMinutes, reasons: ["Connection is disconnected"] };
  if (input.status === "PAUSED") return { state: "PAUSED", lagMinutes, reasons: ["Delivery is paused by operations"] };

  const reasons: string[] = [];
  if (input.status === "ERROR") reasons.push("Provider connection is in error state");
  if (input.connectionType === "API" && !input.hasActiveCredential) reasons.push("No active credential version");
  if (input.deadLetterDeliveries > 0) reasons.push(`${input.deadLetterDeliveries} dead-letter deliver${input.deadLetterDeliveries === 1 ? "y" : "ies"}`);
  if (input.stuckDeliveries > 0) reasons.push(`${input.stuckDeliveries} delivery lease${input.stuckDeliveries === 1 ? "" : "s"} stuck`);
  if (input.criticalIssues > 0) reasons.push(`${input.criticalIssues} critical reconciliation issue${input.criticalIssues === 1 ? "" : "s"}`);
  if (reasons.length) return { state: "CRITICAL", lagMinutes, reasons };

  if (input.failedInboundEvents > 0) reasons.push(`${input.failedInboundEvents} inbound event${input.failedInboundEvents === 1 ? "" : "s"} failed`);
  if (input.failedDeliveries > 0) reasons.push(`${input.failedDeliveries} outbound deliver${input.failedDeliveries === 1 ? "y" : "ies"} failed`);
  if (input.openIssues > 0) reasons.push(`${input.openIssues} open reconciliation issue${input.openIssues === 1 ? "" : "s"}`);
  if (lagMinutes == null) reasons.push("No successful synchronization recorded");
  else if (lagMinutes > 15) reasons.push(`Last success was ${lagMinutes} minutes ago`);
  if (reasons.length) return { state: "ATTENTION", lagMinutes, reasons };

  if (input.pendingDeliveries > 0 || input.sendingDeliveries > 0) {
    return { state: "SYNCING", lagMinutes, reasons: [`${input.pendingDeliveries + input.sendingDeliveries} outbound update${input.pendingDeliveries + input.sendingDeliveries === 1 ? "" : "s"} in progress`] };
  }
  return { state: "HEALTHY", lagMinutes, reasons: [] };
}
