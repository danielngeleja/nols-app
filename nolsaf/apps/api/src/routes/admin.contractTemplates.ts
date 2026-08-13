import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { contractTemplateFieldDictionarySchema } from "../schemas/contractTemplateSchemas.js";

type NormalizedValidationError = {
  code: string;
  path: string;
  message: string;
};

const router = Router();
router.use(requireAuth as any, requireRole("ADMIN") as any);

function normalizePath(path: PropertyKey[]): string {
  if (!path.length) return "$";
  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : String(segment)))
    .join(".")
    .replace(/\.\[/g, "[");
}

function normalizeValidationErrors(issues: ReadonlyArray<{ code: string; path: PropertyKey[]; message: string }>): NormalizedValidationError[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: normalizePath(issue.path),
    message: issue.message,
  }));
}

// POST /admin/contracts/templates/validate
// POST /api/admin/contracts/templates/validate
router.post("/validate", (req, res) => {
  const parsed = contractTemplateFieldDictionarySchema.safeParse(req.body);

  if (!parsed.success) {
    const errors = normalizeValidationErrors(parsed.error.issues);
    return res.status(400).json({
      ok: false,
      valid: false,
      errors,
    });
  }

  const data = parsed.data;
  return res.json({
    ok: true,
    valid: true,
    errors: [],
    summary: {
      templateName: data.template.name,
      templateVersion: data.template.version,
      fieldCount: data.fields.length,
    },
  });
});

export default router;
