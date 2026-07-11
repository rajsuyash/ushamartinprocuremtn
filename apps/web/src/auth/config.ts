import type { NextAuthConfig } from "next-auth";

import type { Role } from "./access";

// Edge-safe Auth.js config: NO db/bcrypt imports so it can run inside the middleware
// (edge runtime). The real Credentials provider — which touches postgres + bcrypt —
// is added only in ./index.ts (node runtime). Role is written to the token at
// sign-in (from what authorize() read out of the DB) and never re-queried after.
export default {
  // trustHost is required off-Vercel (docker/localhost) or Auth.js rejects the host.
  trustHost: true,
  // PRD §11/ENV-6: Secure cookies must not depend on proxy header detection —
  // a plain-http production deploy would otherwise ship non-Secure session cookies.
  useSecureCookies: process.env.APP_ENV === "production",
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.email = user.email ?? undefined;
        token.role = (user as { role?: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      // A token without a userId claim must not become a session with a
      // fabricated blank identity — fail the session at the trust boundary.
      if (
        session.user &&
        typeof token.userId === "string" &&
        token.userId.length > 0
      ) {
        session.user.id = token.userId;
        session.user.email = (token.email as string) ?? session.user.email;
        session.user.role = token.role as Role;
        return session;
      }
      return { ...session, user: undefined } as unknown as typeof session;
    },
  },
} satisfies NextAuthConfig;
