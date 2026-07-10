import LoginForm from "./login-form";

// Public route (excluded from the auth middleware). The interactive form is a client
// component; this page stays a thin server shell.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <LoginForm />
    </main>
  );
}
