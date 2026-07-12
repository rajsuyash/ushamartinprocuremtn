import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { getOpenAlertCount } from "@/app/alerts/queries";
import { auth } from "@/auth";
import { Sidebar, TopBar } from "@/components/nav-links";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

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
    <html lang="en" className={inter.variable}>
      <head>
        {/* Loaded via <link>, not CSS @import — the production bundler strips remote
            @imports that end up after next/font's injected @font-face rules. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
      </head>
      <body className="h-screen overflow-hidden bg-canvas font-sans text-ink antialiased">
        {session?.user ? (
          <div className="flex h-full">
            <Sidebar role={session.user.role} />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar
                role={session.user.role}
                openAlertCount={openAlertCount}
                userLabel={session.user.name ?? session.user.email ?? ""}
              />
              <div className="flex-1 overflow-y-auto">{children}</div>
            </div>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
