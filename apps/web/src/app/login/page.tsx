import LoginForm from "./login-form";

// Public route (excluded from the auth middleware). The interactive form is a client
// component; this page stays a thin server shell.

// Demo deployment: FIX-1 seed credentials shown openly so anyone can explore.
// Remove this panel (and rotate the seed password) for any client-facing deploy.
const DEMO_USERS = [
  { email: "buyer@pdi.test", role: "buyer — upload data, trigger runs, decide" },
  { email: "approver@pdi.test", role: "approver — buyer rights + policy" },
  { email: "admin@pdi.test", role: "admin — everything" },
  { email: "viewer@pdi.test", role: "viewer — read-only" },
] as const;

const DEMO_PASSWORD = "pdi-demo-2026";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <LoginForm />
      <section
        data-testid="demo-credentials"
        className="w-full max-w-sm rounded border border-warn bg-warn-surface p-4 text-sm"
      >
        <p className="mb-2 font-medium text-warn">Demo access — try any role</p>
        <table className="w-full text-left text-xs text-warn">
          <tbody>
            {DEMO_USERS.map((u) => (
              <tr key={u.email} className="border-b border-warn last:border-0">
                <td className="py-1 pr-2 font-mono">{u.email}</td>
                <td className="py-1 text-warn">{u.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-warn">
          Password (all users): <span className="font-mono font-medium">{DEMO_PASSWORD}</span>
        </p>
      </section>
    </main>
  );
}
