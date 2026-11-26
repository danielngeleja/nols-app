import { z } from "zod";

export const ApprovePropertyInput = z.object({
  note: z.string().max(1000).optional(),
  /** Assisted long stay: the admin called the owner, who agreed the rent the partner set. */
  ownerRentConfirmedByPhone: z.boolean().optional(),
});

export const RejectPropertyInput = z.object({
  reasons: z.array(z.string().min(2).max(200)).min(1),
  note: z.string().max(2000).optional(),
});

export const SuspendPropertyInput = z.object({
  notifyOwner: z.boolean().optional().default(true),
  reason: z.string().min(3).max(500),
});

export const UnsuspendPropertyInput = z.object({
  reason: z.string().min(3).max(500),
});

export type ApprovePropertyInput = z.infer<typeof ApprovePropertyInput>;
export type RejectPropertyInput  = z.infer<typeof RejectPropertyInput>;
export type SuspendPropertyInput = z.infer<typeof SuspendPropertyInput>;
export type UnsuspendPropertyInput = z.infer<typeof UnsuspendPropertyInput>;
