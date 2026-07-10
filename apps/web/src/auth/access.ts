// Pure, dependency-free auth-boundary logic (PRD F1). Kept free of next-auth / db
// imports so it is unit-testable in a plain node runner and safe to import from the
// edge middleware. The middleware is a thin shell; every branch lives here.

export type Role = "viewer" | "buyer" | "admin" | "approver";

// /settings/policy is approver/admin only (PRD F1 role matrix).
export const POLICY_EDIT_ROLES: readonly Role[] = ["approver", "admin"];

export function canEditPolicy(role: Role | undefined | null): boolean {
  return !!role && POLICY_EDIT_ROLES.includes(role);
}

// Single source of truth for the paths the middleware guards. NOTE: Next statically
// extracts `config.matcher` and ignores non-literal values, so middleware.ts repeats
// this string as an inline literal — access.test.ts asserts the two stay in sync.
export const MIDDLEWARE_MATCHER =
  "/((?!api/auth|_next/static|_next/image|favicon.ico).*)";

/** True when a path is NOT excluded by the matcher (i.e. the middleware runs for it). */
export function pathIsGuarded(path: string): boolean {
  return new RegExp(`^${MIDDLEWARE_MATCHER}$`).test(path);
}

export type MiddlewareAction =
  | { type: "next" }
  | { type: "redirect"; to: string }
  | { type: "unauthenticated" };

/**
 * Decides what the middleware should do for a request. Unauthenticated pages 302 to
 * /login; unauthenticated /api/* gets the UNAUTHENTICATED envelope directly (our
 * documented choice — F1-AC3 holds before T7's handlers exist). /settings/policy is
 * role-gated with a redirect that carries zero policy data.
 */
export function decideAccess(args: {
  path: string;
  isLoggedIn: boolean;
  role?: Role;
}): MiddlewareAction {
  const { path, isLoggedIn, role } = args;

  // Excluded by the matcher in practice, but stay defensive if it ever changes.
  if (path.startsWith("/api/auth")) return { type: "next" };

  const isApi = path.startsWith("/api");

  if (!isLoggedIn) {
    if (path === "/login") return { type: "next" };
    return isApi ? { type: "unauthenticated" } : { type: "redirect", to: "/login" };
  }

  if (path.startsWith("/settings/policy") && !canEditPolicy(role)) {
    return { type: "redirect", to: "/?denied=1" };
  }

  return { type: "next" };
}
