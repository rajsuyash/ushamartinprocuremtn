"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOutAction } from "@/app/actions";
import { canEditPolicy, type Role } from "@/auth/access";

interface NavLinksProps {
  role: Role;
  openAlertCount: number;
  userLabel: string;
}

// Active-state matching: exact match for "/", prefix match otherwise, so
// /recommendations/:id still highlights the Recommendations link.
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ACTIVE_CLASS = "border-b-2 border-gray-900 font-medium text-gray-900";
const INACTIVE_CLASS = "border-b-2 border-transparent text-gray-600 hover:text-gray-900";

function NavAnchor({
  href,
  active,
  testId,
  children,
}: {
  href: string;
  active: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} data-testid={testId} className={active ? ACTIVE_CLASS : INACTIVE_CLASS}>
      {children}
    </Link>
  );
}

// Global nav (workflow order: Dashboard -> Data -> Forecasts -> Recommendations
// -> Alerts -> Pilot report [-> Policy]) plus the role chip and sign-out button
// that used to live in the dashboard header — consolidated here so every route
// is discoverable, not just the 3 the old header linked to.
export function NavLinks({ role, openAlertCount, userLabel }: NavLinksProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <NavAnchor href="/" active={isActive(pathname, "/")}>
          Dashboard
        </NavAnchor>
        <NavAnchor href="/data" active={isActive(pathname, "/data")}>
          Data
        </NavAnchor>
        <NavAnchor href="/forecasts" active={isActive(pathname, "/forecasts")}>
          Forecasts
        </NavAnchor>
        <NavAnchor href="/recommendations" active={isActive(pathname, "/recommendations")}>
          Recommendations
        </NavAnchor>
        <NavAnchor href="/alerts" active={isActive(pathname, "/alerts")} testId="alert-bell">
          Alerts
          {openAlertCount > 0 ? (
            <span className="ml-1 inline-block rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {openAlertCount}
            </span>
          ) : null}
        </NavAnchor>
        <NavAnchor href="/reports/pilot" active={isActive(pathname, "/reports/pilot")}>
          Pilot report
        </NavAnchor>
        {canEditPolicy(role) ? (
          <NavAnchor href="/settings/policy" active={isActive(pathname, "/settings/policy")}>
            Policy
          </NavAnchor>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-gray-500">{userLabel}</span>
        <span
          data-testid="role-chip"
          className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700"
        >
          {role}
        </span>
        <form action={signOutAction}>
          <button
            type="submit"
            data-action="sign-out"
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
