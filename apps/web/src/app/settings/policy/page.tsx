import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { canEditPolicy } from "@/auth/access";

// Approver/admin only (PRD F1). The middleware already gates this route; this
// per-page check is defense-in-depth (PRD: "middleware + per-action"). On denial we
// redirect BEFORE rendering any policy data, so the response carries none (F1-AC2).
export default async function PolicyPage() {
  const session = await auth();
  if (!canEditPolicy(session?.user?.role)) {
    redirect("/?denied=1");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-8">
      <h1 className="text-lg font-semibold">Policy settings</h1>
      <p className="text-sm text-gray-500">
        Policy editing UI lands with the policy feature. Placeholder for now.
      </p>
    </main>
  );
}
