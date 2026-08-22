export type PasswordPolicy = {
  minLength: number
  maxLength: number
  requireUpper: boolean
  requireLower: boolean
  requireNumber: boolean
  requireSpecial: boolean
  noSpaces: boolean
  specialCharacters: string
}

export type PasswordRequirement = {
  id: "length" | "upper" | "lower" | "number" | "special" | "spaces"
  label: string
  pass: boolean
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  maxLength: 128,
  requireUpper: true,
  requireLower: true,
  requireNumber: true,
  requireSpecial: true,
  noSpaces: true,
  specialCharacters: "!@#$%^&*()-_=+[]{};:'\"\\|,<.>/?`~",
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

export function normalizePasswordPolicy(value: unknown): PasswordPolicy {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const maxLength = boundedInteger(raw.maxLength, DEFAULT_PASSWORD_POLICY.maxLength, 8, 128)
  const minLength = boundedInteger(raw.minLength, DEFAULT_PASSWORD_POLICY.minLength, 8, maxLength)
  const specialCharacters =
    typeof raw.specialCharacters === "string" && raw.specialCharacters.length > 0
      ? raw.specialCharacters
      : DEFAULT_PASSWORD_POLICY.specialCharacters

  return {
    minLength,
    maxLength,
    requireUpper: typeof raw.requireUpper === "boolean" ? raw.requireUpper : DEFAULT_PASSWORD_POLICY.requireUpper,
    requireLower: typeof raw.requireLower === "boolean" ? raw.requireLower : DEFAULT_PASSWORD_POLICY.requireLower,
    requireNumber: typeof raw.requireNumber === "boolean" ? raw.requireNumber : DEFAULT_PASSWORD_POLICY.requireNumber,
    requireSpecial: typeof raw.requireSpecial === "boolean" ? raw.requireSpecial : DEFAULT_PASSWORD_POLICY.requireSpecial,
    noSpaces: typeof raw.noSpaces === "boolean" ? raw.noSpaces : DEFAULT_PASSWORD_POLICY.noSpaces,
    specialCharacters,
  }
}

export function withMinimumLength(policy: PasswordPolicy, minimumLength: number): PasswordPolicy {
  return { ...policy, minLength: Math.min(policy.maxLength, Math.max(policy.minLength, minimumLength)) }
}

export function validatePasswordAgainstPolicy(password: string, policy: PasswordPolicy) {
  const requirements: PasswordRequirement[] = [
    {
      id: "length",
      label: `At least ${policy.minLength} characters`,
      pass: password.length >= policy.minLength && password.length <= policy.maxLength,
    },
  ]

  if (policy.requireUpper) requirements.push({ id: "upper", label: "One uppercase letter (A-Z)", pass: /[A-Z]/.test(password) })
  if (policy.requireLower) requirements.push({ id: "lower", label: "One lowercase letter (a-z)", pass: /[a-z]/.test(password) })
  if (policy.requireNumber) requirements.push({ id: "number", label: "One number (0-9)", pass: /[0-9]/.test(password) })
  if (policy.requireSpecial) {
    requirements.push({
      id: "special",
      label: "One accepted special character (!@#$%&*)",
      pass: Array.from(password).some((character) => policy.specialCharacters.includes(character)),
    })
  }
  if (policy.noSpaces) requirements.push({ id: "spaces", label: "No spaces", pass: !/\s/.test(password) })

  const failed = requirements.filter((requirement) => !requirement.pass)
  const score = requirements.length === 0 ? 0 : Math.round((requirements.filter((requirement) => requirement.pass).length / requirements.length) * 100)
  return {
    valid: password.length > 0 && failed.length === 0,
    reasons: failed.map((requirement) => requirement.label),
    requirements,
    score,
    strength: failed.length === 0 && password.length > 0 ? ("strong" as const) : failed.length <= 2 ? ("medium" as const) : ("weak" as const),
  }
}

export async function fetchPasswordPolicy(signal?: AbortSignal): Promise<PasswordPolicy> {
  const response = await fetch("/api/auth/password-policy", {
    credentials: "include",
    cache: "no-store",
    signal,
  })
  if (!response.ok) throw new Error("Password policy is unavailable")
  const body = await response.json().catch(() => ({}))
  return normalizePasswordPolicy(body?.policy)
}
