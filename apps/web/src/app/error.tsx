"use client";

// Route-level error boundary: named message + retry, never a raw stack trace
// (PRD §11 — error responses/pages must not leak internals).
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">
        The page failed to render. Your data is safe — try again.
      </p>
      <button onClick={reset} className="rounded border px-4 py-2 text-sm underline">
        Retry
      </button>
    </main>
  );
}
