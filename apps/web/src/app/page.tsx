import { auth, signOut } from "@/auth";

// Minimal authenticated shell (F6/M5 builds the real cockpit). The middleware already
// guarantees a session here; we read it server-side for the name/role chip. A `?denied=1`
// query param (set by the /settings/policy role gate) renders a "Not permitted" banner.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const session = await auth();
  const { denied } = await searchParams;
  const user = session?.user;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      {denied ? (
        <div
          role="alert"
          data-testid="denied-toast"
          className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          Not permitted
        </div>
      ) : null}

      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Signed in as</p>
          <p className="font-medium">{user?.name ?? user?.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            data-testid="role-chip"
            className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
          >
            {user?.role}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              data-action="sign-out"
              className="rounded border border-gray-300 px-3 py-1 text-sm"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <p className="text-sm text-gray-500">
        PDI dashboard — walking skeleton. Full cockpit lands at M5 (F6).
      </p>
    </main>
  );
}
