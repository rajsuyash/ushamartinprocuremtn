import type { DefaultSession } from "next-auth";

import type { Role } from "./access";

// Session/JWT carry { userId, email, role } (PRD F1). Augmentation only — erased at
// runtime; makes the callbacks in ./config.ts and session reads in RSC type-safe.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: Role;
  }
}
