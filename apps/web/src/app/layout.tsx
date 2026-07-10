import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";

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

  return (
    <html lang="en">
      <body>
        {session?.user ? (
          <nav className="border-b border-gray-200 px-8 py-3">
            <div className="mx-auto flex max-w-3xl gap-4 text-sm">
              <Link href="/" className="font-medium text-gray-700 hover:underline">
                Dashboard
              </Link>
              <Link href="/data" className="font-medium text-gray-700 hover:underline">
                Data
              </Link>
            </div>
          </nav>
        ) : null}
        {children}
      </body>
    </html>
  );
}
