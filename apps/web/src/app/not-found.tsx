import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-gray-500">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link href="/" className="text-sm underline">
        Back to dashboard
      </Link>
    </main>
  );
}
