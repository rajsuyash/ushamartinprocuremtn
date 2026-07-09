import { SHARED_PACKAGE_NAME } from "@pdi/shared";

// ponytail: placeholder dashboard — real cockpit lands at F6/M5.
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-gray-500">
        PDI walking skeleton — wired to {SHARED_PACKAGE_NAME}
      </p>
    </main>
  );
}
