type AuthLoginAlias = {
  defaultNext?: string;
  forcedRole?: string;
  preserveRoleAndRef?: boolean;
};

const AUTH_LOGIN_ALIASES: Readonly<Record<string, AuthLoginAlias>> = {
  "/login": { preserveRoleAndRef: true },
  "/account/login": { preserveRoleAndRef: true },
  "/owner/login": { forcedRole: "owner", defaultNext: "/owner" },
  "/driver/login": { forcedRole: "driver", defaultNext: "/driver" },
  "/admin/login": { forcedRole: "admin", defaultNext: "/admin/home" },
};

function safeRelativePath(raw: string | null): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

function optionalTrimmedValue(raw: string | null): string | undefined {
  const value = raw?.trim();
  return value || undefined;
}

/**
 * Convert legacy login URLs into the unified account login URL before React
 * renders. Returning an HTTP redirect avoids hydrating a streamed redirect
 * page whose server HTML can race with the destination's client tree.
 */
export function buildAuthLoginRedirect(source: URL): URL | null {
  const alias = AUTH_LOGIN_ALIASES[source.pathname];
  if (!alias) return null;

  const destination = new URL("/account/register", source);
  destination.search = "";
  destination.searchParams.set("mode", "login");

  const next = safeRelativePath(source.searchParams.get("next")) ?? alias.defaultNext;
  if (next) destination.searchParams.set("next", next);

  if (alias.forcedRole) {
    destination.searchParams.set("role", alias.forcedRole);
  } else if (alias.preserveRoleAndRef) {
    const role = optionalTrimmedValue(source.searchParams.get("role"));
    const ref = optionalTrimmedValue(source.searchParams.get("ref"));
    if (role) destination.searchParams.set("role", role);
    if (ref) destination.searchParams.set("ref", ref);
  }

  return destination;
}

export function isSafeRelativeLoginTarget(raw: string | null): boolean {
  return safeRelativePath(raw) !== undefined;
}
