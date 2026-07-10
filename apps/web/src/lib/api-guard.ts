import { fail } from "@pdi/shared";
import type { Session } from "next-auth";
import type { NextRequest } from "next/server";

import { auth } from "@/auth";
import type { Role } from "@/auth/access";

// Per-route auth guard (PRD F1: "middleware + per-action"). The middleware already
// 401s unauthenticated /api/*; this wrapper re-enforces it per handler and adds the
// role check, so no route is safe only by matcher configuration.
//
// Semantics:
//   - no session            → 401 { code: "UNAUTHENTICATED" }
//   - roles: "authenticated"→ any authenticated role passes (= CAPABILITIES.VIEW);
//                             the sentinel is deliberate — `roles` is REQUIRED, so a
//                             mutating route can never silently skip its role check
//                             by omission (review finding, T7).
//   - roles: Role[]         → session role must be in the list, else 403
//                             { code: "FORBIDDEN_ROLE" }; an EMPTY array therefore
//                             denies every role (fail closed).
//   - handler throws        → 500 { code: "INTERNAL" }, structured server log,
//                             never a stack trace in the body.

type GuardedHandler<P> = (
  req: NextRequest,
  ctx: { session: Session; params: P },
) => Response | Promise<Response>;

export function withApiAuth<P = undefined>(
  handler: GuardedHandler<P>,
  opts: { roles: readonly Role[] | "authenticated" },
) {
  return async (req: NextRequest, routeCtx?: { params: P }): Promise<Response> => {
    const session = await auth();

    if (!session?.user?.id) {
      return Response.json(fail("UNAUTHENTICATED", "Authentication required."), {
        status: 401,
      });
    }

    if (opts.roles !== "authenticated" && !opts.roles.includes(session.user.role)) {
      return Response.json(
        fail("FORBIDDEN_ROLE", "Your role does not permit this action."),
        { status: 403 },
      );
    }

    try {
      return await handler(req, { session, params: routeCtx?.params as P });
    } catch (err) {
      // Structured server-side log; the response body carries only the envelope.
      console.error(
        JSON.stringify({
          level: "error",
          requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(),
          userId: session.user.id,
          path: req.nextUrl.pathname,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return Response.json(fail("INTERNAL", "Internal server error."), {
        status: 500,
      });
    }
  };
}
