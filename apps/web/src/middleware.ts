import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { decideAccess, type Role } from "./auth/access";
import authConfig from "./auth/config";

// Edge instance built from the provider-less config (no db/bcrypt) so the middleware
// stays edge-compatible. It only decodes the JWT session cookie; all branching is in
// decideAccess(). Unauthenticated /api/* gets the envelope directly (documented choice).
const { auth } = NextAuth(authConfig);

const UNAUTHENTICATED = {
  success: false,
  data: null,
  error: { code: "UNAUTHENTICATED", message: "Authentication required." },
} as const;

export default auth((req) => {
  const action = decideAccess({
    path: req.nextUrl.pathname,
    isLoggedIn: !!req.auth,
    role: req.auth?.user?.role as Role | undefined,
  });

  switch (action.type) {
    case "unauthenticated":
      return NextResponse.json(UNAUTHENTICATED, { status: 401 });
    case "redirect":
      // 302 to match the PRD F1 routes table (NextResponse.redirect defaults to 307).
      return NextResponse.redirect(new URL(action.to, req.nextUrl), 302);
    case "next":
      return NextResponse.next();
  }
});

// Keep this literal in sync with MIDDLEWARE_MATCHER in ./auth/access.ts — Next
// statically extracts config.matcher and ignores non-literal (imported) values.
// Excludes /api/auth/*, _next static/image, and favicon so login never loops
// (PRD F1 known pitfall). access.test.ts guards the two copies against drift.
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
