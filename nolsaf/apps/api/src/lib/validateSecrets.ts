/**
 * Security: Environment Variable Validation
 * 
 * This module validates all required secrets at application startup.
 * If any required secret is missing, the application will fail to start.
 * 
 * IMPORTANT: Never log actual secret values, only indicate which keys are missing.
 */

type SecretConfig = {
  key: string;
  required: boolean;
  description: string;
  validate?: (value: string) => boolean;
};

const REQUIRED_SECRETS: SecretConfig[] = [
  {
    key: "AZAMPAY_API_KEY",
    required: true,
    description: "AzamPay API key for payment processing",
    validate: (v) => v.length >= 20,
  },
  {
    key: "AZAMPAY_CLIENT_ID",
    required: true,
    description: "AzamPay client ID",
    validate: (v) => v.length >= 5,
  },
  {
    key: "AZAMPAY_CLIENT_SECRET",
    required: true,
    description: "AzamPay client secret",
    validate: (v) => v.length >= 20,
  },
  {
    key: "AZAMPAY_WEBHOOK_SECRET",
    required: true,
    description: "AzamPay webhook signature secret",
    validate: (v) => v.length >= 20,
  },
  {
    key: "AZAMPAY_APP_NAME",
    required: true,
    description: "AzamPay app name (used in token requests)",
    validate: (v) => v.length >= 2,
  },
  {
    key: "DATABASE_URL",
    required: true,
    description: "Database connection string",
    validate: (v) => v.startsWith("mysql://") || v.startsWith("postgresql://"),
  },
  {
    key: "JWT_SECRET",
    required: true,
    description: "JWT signing secret",
    validate: (v) => v.length >= 32,
  },
];

const PRODUCTION_REQUIRED_SECRETS: SecretConfig[] = [
  {
    key: "ENCRYPTION_KEY",
    required: true,
    description: "Application encryption key",
    validate: (v) => v.length >= 32,
  },
  {
    key: "INTERNAL_PROXY_SECRET",
    required: true,
    description: "Shared secret between web proxy and API",
    validate: (v) => v.length >= 32,
  },
  {
    key: "WEB_ORIGIN",
    required: true,
    description: "Public web origin for CORS/CSRF allowlist",
    validate: (v) => v.startsWith("https://"),
  },
  {
    key: "APP_ORIGIN",
    required: true,
    description: "App origin for CORS/CSRF allowlist",
    validate: (v) => v.startsWith("https://"),
  },
  {
    key: "CORS_ORIGIN",
    required: true,
    description: "Comma-separated CORS allowlist",
    validate: (v) => v.split(",").map((s) => s.trim()).filter(Boolean).every((origin) => origin.startsWith("https://")),
  },
  {
    key: "CLOUDINARY_CLOUD_NAME",
    required: true,
    description: "Cloudinary cloud name for uploads",
    validate: (v) => v.length >= 2,
  },
  {
    key: "CLOUDINARY_API_KEY",
    required: true,
    description: "Cloudinary API key for uploads",
    validate: (v) => v.length >= 6,
  },
  {
    key: "CLOUDINARY_API_SECRET",
    required: true,
    description: "Cloudinary API secret for upload signing",
    validate: (v) => v.length >= 16,
  },
  {
    key: "AZAMPAY_CARD_RETURN_URL",
    required: true,
    description: "Base URL for AzamPay card payment callbacks — must be HTTPS in production",
    validate: (v) => v.startsWith("https://"),
  },
];

const OPTIONAL_SECRETS: SecretConfig[] = [
  // AzamPay optional overrides
  {
    key: "AZAMPAY_AUTH_URL",
    required: false,
    description: "AzamPay authenticator base URL (default: https://authenticator.azampay.co.tz)",
    validate: (v) => v.startsWith("https://"),
  },
  {
    key: "AZAMPAY_API_URL",
    required: false,
    description: "AzamPay API base URL (default: https://api.azampay.co.tz)",
    validate: (v) => v.startsWith("https://"),
  },
  {
    key: "AZAMPAY_WEBHOOK_ALLOWED_IPS",
    required: false,
    description: "Comma-separated AzamPay server IPs for webhook source validation (optional but recommended in production)",
  },
  {
    key: "AZAMPAY_WEBHOOK_ENFORCE_TIMESTAMP",
    required: false,
    description: "Set to 'true' to reject AzamPay webhook calls with timestamps older than 5 minutes",
  },
  // CoralCommerce hosted card checkout
  {
    key: "CORAL_UCF_ENABLED",
    required: false,
    description: "Set to 'true' to enable CoralCommerce hosted card checkout",
  },
  {
    key: "CORAL_UCF_API_URL",
    required: false,
    description: "CoralCommerce UCF execute endpoint",
    validate: (v) => v.startsWith("https://"),
  },
  {
    key: "CORAL_UCF_USERNAME",
    required: false,
    description: "CoralCommerce technical username",
  },
  {
    key: "CORAL_UCF_PASSWORD",
    required: false,
    description: "CoralCommerce technical password",
  },
  {
    key: "CORAL_UCF_ALIAS",
    required: false,
    description: "CoralCommerce merchant alias",
  },
  {
    key: "CORAL_UCF_CURRENCY",
    required: false,
    description: "Optional CoralCommerce fallback currency when an invoice/property currency is unavailable",
    validate: (v) => /^[A-Z]{3}$/.test(v),
  },
  {
    key: "CORAL_UCF_SHARED_ENCRYPTION_KEY",
    required: false,
    description: "CoralCommerce shared key for encrypted callbacks/postbacks",
  },
  {
    key: "CORAL_UCF_CALLBACK_URL",
    required: false,
    description: "Public CoralCommerce asynchronous callback URL",
    validate: (v) => v.startsWith("https://"),
  },
  {
    key: "CORAL_UCF_POSTBACK_SUCCESS_URL",
    required: false,
    description: "Public CoralCommerce success postback URL",
    validate: (v) => v.startsWith("https://"),
  },
  {
    key: "CORAL_UCF_POSTBACK_FAILURE_URL",
    required: false,
    description: "Public CoralCommerce failure postback URL",
    validate: (v) => v.startsWith("https://"),
  },
  // Email providers
  {
    key: "RESEND_API_KEY",
    required: false,
    description: "Resend API key for transactional emails (recommended)",
  },
  {
    key: "RESEND_FROM_DOMAIN",
    required: false,
    description: "Resend verified domain (e.g., onboarding@resend.dev or no-reply@yourdomain.com)",
  },
  {
    key: "SMTP_HOST",
    required: false,
    description: "SMTP server host (fallback if Resend not configured)",
  },
  {
    key: "SMTP_PORT",
    required: false,
    description: "SMTP server port (default: 587)",
  },
  {
    key: "SMTP_USER",
    required: false,
    description: "SMTP username",
  },
  {
    key: "SMTP_PASS",
    required: false,
    description: "SMTP password",
  },
  {
    key: "EMAIL_FROM",
    required: false,
    description: "Default sender email address (e.g. notifications@nolsaf.com)",
  },
  {
    key: "EMAIL_FROM_SECURITY",
    required: false,
    description: "Sender address for security emails: password reset/changed, login alerts (e.g. security@nolsaf.com)",
  },
  // SMS providers
  {
    key: "SMS_PROVIDER",
    required: false,
    description: "SMS provider: 'africastalking' (recommended), 'twilio', or 'console'",
  },
  {
    key: "AFRICASTALKING_USERNAME",
    required: false,
    description: "Africa's Talking username (for Tanzania/East Africa)",
  },
  {
    key: "AFRICASTALKING_API_KEY",
    required: false,
    description: "Africa's Talking API key",
  },
  {
    key: "AFRICASTALKING_SENDER_ID",
    required: false,
    description: "Africa's Talking sender ID (default: 'NoLSAF')",
  },
  {
    key: "TWILIO_ACCOUNT_SID",
    required: false,
    description: "Twilio account SID (alternative SMS provider)",
  },
  {
    key: "TWILIO_AUTH_TOKEN",
    required: false,
    description: "Twilio auth token",
  },
  {
    key: "TWILIO_PHONE_NUMBER",
    required: false,
    description: "Twilio phone number",
  },
  {
    key: "SMS_API_KEY",
    required: false,
    description: "Generic SMS API key (for custom providers)",
  },
  {
    key: "SMS_API_URL",
    required: false,
    description: "Generic SMS API endpoint URL",
  },
  // AWS
  {
    key: "AWS_ACCESS_KEY_ID",
    required: false,
    description: "AWS access key for S3",
  },
  {
    key: "AWS_SECRET_ACCESS_KEY",
    required: false,
    description: "AWS secret key for S3",
  },
  // Expedia Group lodging-supply connectivity. These remain optional until
  // Expedia assigns NRMS enrollment, sandbox and callback configuration.
  {
    key: "EXPEDIA_ARI_URL",
    required: false,
    description: "Expedia Availability and Rates endpoint assigned during enrollment",
    validate: (v) => v.startsWith("https://"),
  },
  {
    key: "EXPEDIA_NOTIFICATION_API_KEY",
    required: false,
    description: "API key configured on the Expedia notification callback",
    validate: (v) => v.length >= 16,
  },
  {
    key: "EXPEDIA_NOTIFICATION_SECRET",
    required: false,
    description: "Current Expedia notification HMAC secret",
    validate: (v) => v.length >= 24,
  },
  {
    key: "EXPEDIA_NOTIFICATION_PREVIOUS_SECRET",
    required: false,
    description: "Previous Expedia notification HMAC secret during rotation overlap",
    validate: (v) => v.length >= 24,
  },
];

/**
 * Validates all required environment variables
 * Throws an error if any required secret is missing or invalid
 */
export function validateSecrets(): void {
  const missing: string[] = [];
  const invalid: Array<{ key: string; reason: string }> = [];

  // Check required secrets
  const requiredSecrets =
    process.env.NODE_ENV === "production"
      ? [...REQUIRED_SECRETS, ...PRODUCTION_REQUIRED_SECRETS]
      : REQUIRED_SECRETS;

  for (const config of requiredSecrets) {
    const value = process.env[config.key];
    
    if (!value || value.trim() === "") {
      missing.push(config.key);
      continue;
    }

    // Run custom validation if provided
    if (config.validate && !config.validate(value)) {
      invalid.push({
        key: config.key,
        reason: `Invalid format or too short`,
      });
    }
  }

  if (String(process.env.CORAL_UCF_ENABLED || "").toLowerCase() === "true") {
    const coralRequired = [
      "CORAL_UCF_API_URL",
      "CORAL_UCF_USERNAME",
      "CORAL_UCF_PASSWORD",
      "CORAL_UCF_ALIAS",
      "CORAL_UCF_SHARED_ENCRYPTION_KEY",
      "CORAL_UCF_CALLBACK_URL",
      "CORAL_UCF_POSTBACK_SUCCESS_URL",
    ];
    for (const key of coralRequired) {
      const value = process.env[key];
      if (!value || value.trim() === "") {
        missing.push(key);
      }
    }
  }

  // Check optional secrets (warn if missing but don't fail)
  const missingOptional: string[] = [];
  for (const config of OPTIONAL_SECRETS) {
    const value = process.env[config.key];
    if (!value || value.trim() === "") {
      missingOptional.push(config.key);
    }
  }

  // Report errors
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join("\n")}\n\n` +
      `Please ensure all required secrets are set in your apps/api/.env file.`
    );
  }

  if (invalid.length > 0) {
    throw new Error(
      `Invalid environment variables:\n${invalid.map((i) => `  - ${i.key}: ${i.reason}`).join("\n")}\n\n` +
      `Please check your apps/api/.env file and ensure all secrets are properly formatted.`
    );
  }

  // Warn about missing optional secrets (non-fatal)
  if (missingOptional.length > 0 && process.env.NODE_ENV !== "test") {
    console.warn(
      `⚠️  Warning: Optional environment variables not set:\n${missingOptional.map((k) => `  - ${k}`).join("\n")}`
    );
  }

  // Security check: Ensure we're not in a compromised state
  if (process.env.NODE_ENV === "production") {
    // In production, double-check critical secrets
    const criticalSecrets = [
      "AZAMPAY_WEBHOOK_SECRET",
      "AZAMPAY_CARD_RETURN_URL",
      "JWT_SECRET",
      "DATABASE_URL",
      "ENCRYPTION_KEY",
      "INTERNAL_PROXY_SECRET",
      "CLOUDINARY_API_SECRET",
    ];

    for (const key of criticalSecrets) {
      const value = process.env[key];
      const normalized = String(value || "").toLowerCase();
      if (
        value &&
        (normalized.includes("example") ||
          normalized.includes("placeholder") ||
          normalized.includes("changeme") ||
          normalized.includes("change_me") ||
          normalized.includes("dev_") ||
          value === "changeme")
      ) {
        throw new Error(
          `Security Error: ${key} appears to be a placeholder value. ` +
          `This is not allowed in production. Please set a real secret.`
        );
      }
    }
  }

  console.log("✅ All required secrets validated successfully");
}

/**
 * Gets a secret value with validation
 * Use this instead of direct process.env access for critical secrets
 */
export function getSecret(key: string, required = true): string {
  const value = process.env[key];
  
  if (required && (!value || value.trim() === "")) {
    throw new Error(`Required secret ${key} is not set`);
  }
  
  return value || "";
}

/**
 * Checks if we're in a secure environment
 */
export function isSecureEnvironment(): boolean {
  // Don't allow production-like operations in development without explicit flag
  if (process.env.NODE_ENV === "development" && !process.env.ALLOW_DEV_PAYMENTS) {
    return false;
  }
  
  return process.env.NODE_ENV === "production";
}

