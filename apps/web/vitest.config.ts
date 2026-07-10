import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig "paths" ("@/*" → "./src/*") so tests can import route
    // handlers and vi.mock("@/auth") the way app code does.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
  },
});
