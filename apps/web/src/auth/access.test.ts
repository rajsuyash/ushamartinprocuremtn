import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  canEditPolicy,
  decideAccess,
  MIDDLEWARE_MATCHER,
  pathIsGuarded,
} from "./access";

describe("canEditPolicy (PRD F1 role matrix)", () => {
  it("permits approver and admin", () => {
    expect(canEditPolicy("approver")).toBe(true);
    expect(canEditPolicy("admin")).toBe(true);
  });

  it("denies viewer, buyer, and absent role", () => {
    expect(canEditPolicy("viewer")).toBe(false);
    expect(canEditPolicy("buyer")).toBe(false);
    expect(canEditPolicy(undefined)).toBe(false);
    expect(canEditPolicy(null)).toBe(false);
  });
});

describe("middleware matcher (login-loop pitfall)", () => {
  it("excludes /api/auth/* and static assets", () => {
    expect(pathIsGuarded("/api/auth/session")).toBe(false);
    expect(pathIsGuarded("/api/auth/callback/credentials")).toBe(false);
    expect(pathIsGuarded("/_next/static/chunk.js")).toBe(false);
    expect(pathIsGuarded("/_next/image")).toBe(false);
    expect(pathIsGuarded("/favicon.ico")).toBe(false);
  });

  it("guards app pages and non-auth /api/* routes", () => {
    expect(pathIsGuarded("/")).toBe(true);
    expect(pathIsGuarded("/settings/policy")).toBe(true);
    expect(pathIsGuarded("/api/recommendations")).toBe(true);
  });

  it("middleware.ts keeps the inline matcher literal in sync with MIDDLEWARE_MATCHER", () => {
    const middlewarePath = fileURLToPath(
      new URL("../middleware.ts", import.meta.url),
    );
    const src = readFileSync(middlewarePath, "utf8");
    expect(src).toContain(MIDDLEWARE_MATCHER);
  });
});

describe("decideAccess (auth boundary)", () => {
  it("redirects an unauthenticated page request to /login", () => {
    expect(decideAccess({ path: "/", isLoggedIn: false })).toEqual({
      type: "redirect",
      to: "/login",
    });
    expect(
      decideAccess({ path: "/settings/policy", isLoggedIn: false }),
    ).toEqual({ type: "redirect", to: "/login" });
  });

  it("returns the UNAUTHENTICATED envelope signal for unauthenticated /api/*", () => {
    expect(
      decideAccess({ path: "/api/recommendations", isLoggedIn: false }),
    ).toEqual({ type: "unauthenticated" });
  });

  it("lets the login page and /api/auth/* through", () => {
    expect(decideAccess({ path: "/login", isLoggedIn: false })).toEqual({
      type: "next",
    });
    expect(
      decideAccess({ path: "/api/auth/session", isLoggedIn: false }),
    ).toEqual({ type: "next" });
  });

  it("denies viewer/buyer for /settings/policy with a data-free redirect", () => {
    expect(
      decideAccess({ path: "/settings/policy", isLoggedIn: true, role: "viewer" }),
    ).toEqual({ type: "redirect", to: "/?denied=1" });
    expect(
      decideAccess({ path: "/settings/policy", isLoggedIn: true, role: "buyer" }),
    ).toEqual({ type: "redirect", to: "/?denied=1" });
  });

  it("permits approver/admin for /settings/policy", () => {
    expect(
      decideAccess({
        path: "/settings/policy",
        isLoggedIn: true,
        role: "approver",
      }),
    ).toEqual({ type: "next" });
    expect(
      decideAccess({ path: "/settings/policy", isLoggedIn: true, role: "admin" }),
    ).toEqual({ type: "next" });
  });

  it("lets an authenticated user reach ordinary routes", () => {
    expect(decideAccess({ path: "/", isLoggedIn: true, role: "viewer" })).toEqual(
      { type: "next" },
    );
  });
});
