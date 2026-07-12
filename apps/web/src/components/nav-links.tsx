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

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/data", label: "Data", icon: "upload_file" },
  { href: "/forecasts", label: "Forecasts", icon: "trending_up" },
  { href: "/recommendations", label: "Recommendations", icon: "fact_check" },
  { href: "/alerts", label: "Alerts", icon: "notifications" },
  { href: "/reports/pilot", label: "Pilot report", icon: "insights" },
];

const ACTIVE_CLASS = "bg-primary text-white font-semibold";
const INACTIVE_CLASS = "text-muted hover:bg-surface-alt";
const ITEM_CLASS = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`${ITEM_CLASS} ${active ? ACTIVE_CLASS : INACTIVE_CLASS}`}
    >
      <span
        className="material-symbols-outlined flex-shrink-0 text-[20px]"
        aria-hidden="true"
      >
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

// Global nav workflow order: Dashboard -> Data -> Forecasts -> Recommendations
// -> Alerts -> Pilot report [-> Policy]. Rendered as the left sidebar (Stitch
// design system) with the active item shown as a filled dark pill.
export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <aside className="hidden h-full w-64 flex-shrink-0 flex-col justify-between border-r border-border bg-surface-alt p-4 md:flex">
      <div className="flex flex-col gap-8">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-primary text-white">
            <span className="material-symbols-outlined" aria-hidden="true">
              dataset
            </span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold text-primary">PDI</span>
            <span className="text-[10px] uppercase tracking-widest text-muted">
              Procurement Intelligence
            </span>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavRow key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          {canEditPolicy(role) ? (
            <NavRow
              item={{ href: "/settings/policy", label: "Policy", icon: "tune" }}
              active={isActive(pathname, "/settings/policy")}
            />
          ) : null}
        </nav>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <form action={signOutAction}>
          <button
            type="submit"
            data-action="sign-out"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface-alt"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              logout
            </span>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

// Top bar: brand, alert bell (F7 nav badge), role chip, user email. No
// pathname/active-state logic needed, so this stays a plain function even
// though the module is "use client" (sign-out lives in Sidebar; this reads
// only the props it's given).
export function TopBar({ role, openAlertCount, userLabel }: NavLinksProps) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
      <div className="text-sm font-semibold uppercase tracking-wider text-primary">
        Usha Martin Intelligence
      </div>
      <div className="flex items-center gap-4">
        <Link
          href="/alerts"
          data-testid="alert-bell"
          className="relative rounded p-2 text-muted hover:bg-surface-alt"
          aria-label="Alerts"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            notifications
          </span>
          {openAlertCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-risk px-1 text-[10px] font-semibold text-white">
              {openAlertCount}
            </span>
          ) : null}
        </Link>
        <span className="hidden text-sm text-muted sm:inline">{userLabel}</span>
        <span
          data-testid="role-chip"
          className="rounded-full bg-primary-surface px-3 py-1 text-xs font-medium text-primary"
        >
          {role}
        </span>
      </div>
    </header>
  );
}
