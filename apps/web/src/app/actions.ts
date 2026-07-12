"use server";

// Module-level "use server" — every export here is a Server Action. NavLinks
// (a client component) imports signOutAction directly; the dashboard page
// imports dismissWelcomeAction for the welcome card's dismiss form. A file with
// a top-level "use server" directive may only export async functions, so the
// shared cookie name lives in ./guidance.ts instead of here.

import { cookies } from "next/headers";

import { signOut } from "@/auth";

import { WELCOME_COOKIE_NAME } from "./guidance";

const WELCOME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year (plan §3)

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export async function dismissWelcomeAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(WELCOME_COOKIE_NAME, "1", {
    maxAge: WELCOME_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}
