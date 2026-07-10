import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authorizeCredentials } from "./authorize";
import authConfig from "./config";

// Full (node-runtime) Auth.js instance: edge-safe config + the Credentials provider
// whose authorize() touches postgres + bcrypt. Server Components and the
// /api/auth/[...nextauth] route import from here; the middleware does NOT (it builds
// its own instance from ./config to stay edge-compatible).
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: (creds) => authorizeCredentials(creds),
    }),
  ],
});
