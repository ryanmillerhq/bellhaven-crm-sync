import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": here("."), "server-only": here("./tests/stubs/server-only.ts") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
