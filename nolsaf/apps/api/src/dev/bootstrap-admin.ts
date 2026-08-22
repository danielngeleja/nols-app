import { config } from "dotenv";
import { resolve } from "path";
import * as readline from "readline";

// Load only the env files for the requested target.
// Usage:
//   npx tsx src/dev/bootstrap-admin.ts              -> local .env + optional .env.local
//   npx tsx src/dev/bootstrap-admin.ts --staging    -> .env.staging + optional .env.staging.local
//   npx tsx src/dev/bootstrap-admin.ts --production -> .env.production + optional .env.production.local
const isProd = process.argv.includes("--production");
const isStaging = process.argv.includes("--staging");
const isLocal = !isProd && !isStaging;

if (isProd && isStaging) {
  throw new Error("[bootstrap] Choose one target only: --staging or --production, not both.");
}

function clearBootstrapEnv(): void {
  for (const key of [
    "DATABASE_URL",
    "ENCRYPTION_KEY",
    "JWT_SECRET",
    "BOOTSTRAP_ADMIN_ALLOW_WHEN_ADMIN_EXISTS",
    "BOOTSTRAP_ADMIN_PROMOTE_EXISTING",
  ]) {
    delete process.env[key];
  }
}

function requireEnv(keys: string[], mode: string): void {
  const missing = keys.filter((key) => !String(process.env[key] ?? "").trim());
  if (missing.length > 0) {
    throw new Error(`[bootstrap] ${mode} is missing required env: ${missing.join(", ")}`);
  }
}

function loadEnvFiles(files: string[]): void {
  for (const file of files) {
    config({ path: resolve(__dirname, "../..", file), override: true });
  }
}

if (isProd) {
  clearBootstrapEnv();
  process.env.NODE_ENV = "production";
  loadEnvFiles([".env.production", ".env.production.local"]);
  requireEnv(["DATABASE_URL", "ENCRYPTION_KEY", "JWT_SECRET"], "PRODUCTION");
  console.log("[bootstrap] Target: PRODUCTION (.env.production + optional .env.production.local)");
} else if (isStaging) {
  clearBootstrapEnv();
  process.env.NODE_ENV = "staging";
  loadEnvFiles([".env.staging", ".env.staging.local"]);
  requireEnv(["DATABASE_URL", "ENCRYPTION_KEY", "JWT_SECRET"], "STAGING");
  console.log("[bootstrap] Target: STAGING (.env.staging + optional .env.staging.local)");
} else if (isLocal) {
  process.env.NODE_ENV = process.env.NODE_ENV || "development";
  loadEnvFiles([".env", ".env.local"]);
  requireEnv(["DATABASE_URL"], "LOCAL");
  console.log("[bootstrap] Target: LOCAL (.env + optional .env.local)");
}

type NotificationDeps = {
  sendSms: (phone: string, message: string) => Promise<any>;
  sendMail: (to: string, subject: string, html: string) => Promise<any>;
  getAdminWelcomeEmail: (args: { name: string; email: string; isNewlyCreated: boolean }) => { subject: string; html: string };
  getAdminWelcomeSms: (args: { name: string; isNewlyCreated: boolean }) => string;
};

// ─── Prompt helpers ───────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

// ─── Password strength ──────

interface PasswordCheck { label: string; pass: boolean; }

function checkPasswordStrength(pw: string): PasswordCheck[] {
  const acceptedSpecialCharacters = "!@#$%^&*()-_=+[]{};:'\"\\|,<.>/?`~";
  return [
    { label: "Between 12 and 128 characters long",      pass: pw.length >= 12 && pw.length <= 128 },
    { label: "Contains an uppercase letter (A–Z)",       pass: /[A-Z]/.test(pw) },
    { label: "Contains a lowercase letter (a–z)",       pass: /[a-z]/.test(pw) },
    { label: "Contains a digit (0–9)",                  pass: /[0-9]/.test(pw) },
    { label: "Contains a special character (!@#$…)",    pass: Array.from(pw).some((character) => acceptedSpecialCharacters.includes(character)) },
    { label: "Does not contain spaces",                 pass: !/\s/.test(pw) },
  ];
}

function printPasswordRequirements(): void {
  console.log("\n  Password requirements:");
  console.log("  ──────────────────────────────────────────────");
  console.log("  ✔  Between 12 and 128 characters long");
  console.log("  ✔  At least one uppercase letter  (A–Z)");
  console.log("  ✔  At least one lowercase letter  (a–z)");
  console.log("  ✔  At least one digit             (0–9)");
  console.log("  ✔  At least one special character (!@#$%^&*…)");
  console.log("  ✔  Must not contain spaces");
  console.log("  ──────────────────────────────────────────────\n");
}

function askPassword(prompt: string): Promise<string> {
  return new Promise(resolve => {
    process.stdout.write(prompt);
    let password = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (char: string) => {
      if (char === "\r" || char === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.removeAllListeners("data");
        process.stdout.write("\n");
        resolve(password);
      } else if (char === "\x03") {
        console.log("\nAborted.");
        process.exit(0);
      } else if (char === "\x7F") {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(prompt + "*".repeat(password.length));
        }
      } else {
        password += char;
        process.stdout.write("*");
      }
    };
    process.stdin.on("data", onData);
  });
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function sendAdminNotifications(
  user: { id: number; email: string; name: string | null; phone: string | null },
  isNewlyCreated: boolean,
  deps: NotificationDeps
) {
  const { sendSms, sendMail, getAdminWelcomeEmail, getAdminWelcomeSms } = deps;
  const adminName = user.name || "Admin";
  if (user.phone) {
    try {
      await sendSms(user.phone, getAdminWelcomeSms({ name: adminName, isNewlyCreated }));
      console.log(`📱 SMS sent to ${user.phone}`);
    } catch (err) {
      console.warn(`⚠️  SMS failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    const { subject, html } = getAdminWelcomeEmail({ name: adminName, email: user.email, isNewlyCreated });
    await sendMail(user.email, subject, html);
    console.log(`📧 Email sent to ${user.email}`);
  } catch (err) {
    console.warn(`⚠️  Email failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load app modules only after env files are loaded to avoid stale config.
  const [prismaMod, cryptoMod, smsMod, mailerMod, templatesMod] = await Promise.all([
    import("@nolsaf/prisma"),
    import("../lib/crypto.js"),
    import("../lib/sms.js"),
    import("../lib/mailer.js"),
    import("../lib/adminEmailTemplates.js"),
  ]);

  const prisma = prismaMod.prisma;
  const hashPassword = cryptoMod.hashPassword;
  const notifyDeps: NotificationDeps = {
    sendSms: smsMod.sendSms,
    sendMail: mailerMod.sendMail,
    getAdminWelcomeEmail: templatesMod.getAdminWelcomeEmail,
    getAdminWelcomeSms: templatesMod.getAdminWelcomeSms,
  };

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║     NoLSAF  Bootstrap Admin Setup        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // Guard: block if admin already exists (env flag can override)
  const existingAdminCount = await prisma.user.count({ where: { role: "ADMIN" as any } });
  if (existingAdminCount > 0) {
    const allowWhenExists = String(process.env.BOOTSTRAP_ADMIN_ALLOW_WHEN_ADMIN_EXISTS ?? "")
      .trim().toUpperCase() === "YES";
    if (!allowWhenExists) {
      throw new Error(
        `\n❌ BLOCKED: Database already has ${existingAdminCount} ADMIN user(s).\n` +
        `   Set BOOTSTRAP_ADMIN_ALLOW_WHEN_ADMIN_EXISTS=YES in .env to allow adding another.`
      );
    }
    console.log(`⚠️  Warning: ${existingAdminCount} ADMIN user(s) already exist in the DB.\n`);
  }

  // ── Collect inputs interactively ─────────────────────────────────────────
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const emailRaw = (await ask(rl, "📧 Admin email address        : ")).trim().toLowerCase();
  if (!emailRaw || !emailRaw.includes("@")) {
    rl.close();
    throw new Error("❌ Invalid email address.");
  }

  rl.close(); // must close before raw-mode password prompt

  printPasswordRequirements();

  // Re-prompt until password passes all checks
  let password = "";
  while (true) {
    password = await askPassword("🔑 Password (hidden input)    : ");
    const checks = checkPasswordStrength(password);
    const failed = checks.filter(c => !c.pass);
    if (failed.length === 0) break;
    console.log("\n  ❌ Password does not meet the following requirements:");
    for (const f of failed) console.log(`     • ${f.label}`);
    console.log("  Please try again.\n");
  }

  const confirm2 = await askPassword("🔑 Confirm password           : ");
  if (confirm2 !== password) {
    throw new Error("❌ Passwords do not match.");
  }
  console.log("  ✅ Password strength: OK\n");

  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const nameRaw  = (await ask(rl2, "👤 Full name   (Enter to skip): ")).trim() || null;
  const phoneRaw = (await ask(rl2, "📱 Phone +255…  (Enter to skip): ")).trim() || null;
  rl2.close();

  const email = emailRaw;
  const name  = nameRaw;
  const phone = phoneRaw;

  // ── Review summary ───────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────");
  console.log("  Review before proceeding:");
  console.log(`  Email : ${email}`);
  console.log(`  Name  : ${name  ?? "(not set)"}`);
  console.log(`  Phone : ${phone ?? "(not set)"}`);
  console.log("──────────────────────────────────────────────");

  const rl3 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirm = (await ask(rl3, "\n  Type YES to confirm: ")).trim().replace(/[^A-Za-z]/g, "").toUpperCase();
  rl3.close();

  if (confirm !== "YES") {
    console.log("Aborted — nothing was changed.");
    return;
  }

  // ── Duplicate detection ──────────────────────────────────────────────────
  const byEmail = await (prisma.user as any).findUnique({
    where: { email },
    select: { id: true, role: true, email: true, phone: true, name: true },
  });

  const byPhone = phone
    ? await (prisma.user as any).findUnique({
        where: { phone },
        select: { id: true, role: true, email: true, phone: true, name: true },
      })
    : null;

  if (byPhone && byEmail && byPhone.id !== byEmail.id) {
    throw new Error(
      `\n❌ CONFLICT: Email "${email}" is userId=${byEmail.id} but phone "${phone}" belongs to userId=${byPhone.id} — different accounts.\n` +
      `   Use a different phone number or leave phone blank.`
    );
  }

  if (byPhone && !byEmail) {
    throw new Error(
      `\n❌ PHONE ALREADY REGISTERED:\n` +
      `   Phone "${phone}" belongs to userId=${byPhone.id} (${byPhone.role}, email=${byPhone.email ?? "none"}).\n` +
      `   Use a different phone number or leave phone blank.`
    );
  }

  const existing = byEmail;
  const passwordHash = await hashPassword(password);
  const now = new Date();

  // ── Promote existing user ────────────────────────────────────────────────
  if (existing) {
    const currentRole = String(existing.role ?? "").toUpperCase();

    if (currentRole === "ADMIN") {
      console.log(`\nℹ️  No changes — userId=${existing.id} (${email}) is already an ADMIN.`);
      return;
    }

    const allowPromote = String(process.env.BOOTSTRAP_ADMIN_PROMOTE_EXISTING ?? "")
      .trim().toUpperCase() === "YES";

    if (!allowPromote) {
      throw new Error(
        `\n❌ EMAIL ALREADY REGISTERED as userId=${existing.id} (role=${currentRole}).\n` +
        `   To promote this existing user to ADMIN, set BOOTSTRAP_ADMIN_PROMOTE_EXISTING=YES in .env`
      );
    }

    console.log(`\n⚠️  Existing account userId=${existing.id} | role=${currentRole} — promoting to ADMIN...`);

    await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: "ADMIN" as any,
        passwordHash: passwordHash as any,
        ...(name ? { name } : {}),
        ...(phone ? { phone } : {}),
        emailVerifiedAt: now as any,
        phoneVerifiedAt: phone ? (now as any) : (undefined as any),
      } as any,
    });

    console.log(`✅ Promoted userId=${existing.id} to ADMIN.`);
    await sendAdminNotifications({ id: existing.id, email, name, phone }, false, notifyDeps);
    return;
  }

  // ── Create new admin ─────────────────────────────────────────────────────
  console.log(`\n  Creating new ADMIN account...`);

  const created = await prisma.user.create({
    data: {
      email,
      name,
      phone,
      role: "ADMIN" as any,
      passwordHash: passwordHash as any,
      emailVerifiedAt: now as any,
      phoneVerifiedAt: phone ? (now as any) : (undefined as any),
    } as any,
    select: { id: true, email: true, role: true, name: true, phone: true },
  });

  console.log(`✅ Created ADMIN: userId=${created.id} | email=${created.email} | phone=${created.phone ?? "none"}`);
  await sendAdminNotifications(
    { id: created.id, email: created.email, name: created.name || name, phone: created.phone || phone },
    true,
    notifyDeps
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("\n❌ bootstrap-admin failed:", err?.message || err);
    process.exit(1);
  });
