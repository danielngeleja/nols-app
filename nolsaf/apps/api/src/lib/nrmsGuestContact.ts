import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform((value) => value || null);

const optionalPhone = z.string().trim().max(40).nullable().optional()
  .transform((value) => value ? value.replace(/[\s().-]/g, "") : null)
  .refine((value) => value === null || /^\+?[1-9]\d{6,14}$/.test(value), {
    message: "Use an international phone number, for example +255712345678",
  });

const optionalInstagramUsername = z.string().trim().max(30).nullable().optional()
  .transform((value) => value ? value.replace(/^@/, "") : null)
  .refine((value) => value === null || /^[A-Za-z0-9._]+$/.test(value), {
    message: "Enter the Instagram username without a profile URL",
  });

export const nrmsGuestContactSchema = z.object({
  enabled: z.boolean().default(false),
  instagramUsername: optionalInstagramUsername,
  whatsappPhone: optionalPhone,
  receptionPhone: optionalPhone,
  receptionEmail: z.string().trim().email().max(160).nullable().optional()
    .or(z.literal(""))
    .transform((value) => value || null),
  contactHours: optionalText(160),
  preferredLanguage: z.enum(["EN", "SW", "EN_SW"]).default("EN_SW"),
  greeting: optionalText(500),
}).superRefine((value, context) => {
  if (value.enabled && !value.instagramUsername && !value.whatsappPhone && !value.receptionPhone && !value.receptionEmail) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["enabled"], message: "Add at least one guest contact channel before publishing" });
  }
});

export type NrmsGuestContactSettings = z.infer<typeof nrmsGuestContactSchema>;

export const EMPTY_NRMS_GUEST_CONTACT: NrmsGuestContactSettings = {
  enabled: false,
  instagramUsername: null,
  whatsappPhone: null,
  receptionPhone: null,
  receptionEmail: null,
  contactHours: null,
  preferredLanguage: "EN_SW",
  greeting: null,
};

export function parseNrmsGuestContactSettings(value: unknown): NrmsGuestContactSettings {
  const parsed = nrmsGuestContactSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : EMPTY_NRMS_GUEST_CONTACT;
}

export function publicNrmsGuestContact(value: unknown): NrmsGuestContactSettings | null {
  const settings = parseNrmsGuestContactSettings(value);
  return settings.enabled ? settings : null;
}
