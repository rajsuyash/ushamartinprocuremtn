import type { Metadata } from "next";

import { getOpenAlertCount } from "@/app/alerts/queries";
import { auth } from "@/auth";
import { NavLinks } from "@/components/nav-links";

import "./globals.css";

export const metadata: Metadata = {
  title: "PDI",
  description: "Procurement Decision Intelligence",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const openAlertCount = session?.user ? await getOpenAlertCount() : 0;

  return (
    <html lang="en">
      <body>
        {session?.user ? (
          <nav className="border-b border-gray-200 px-8 py-3">
            <div className="mx-auto max-w-4xl text-sm">
              <NavLinks
                role={session.user.role}
                openAlertCount={openAlertCount}
                userLabel={session.user.name ?? session.user.email ?? ""}
              />
            </div>
          </nav>
        ) : null}
        {children}
      </body>
    </html>
  );
}
