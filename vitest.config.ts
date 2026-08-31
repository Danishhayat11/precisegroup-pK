import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Component tests live alongside source under src/. Logic-only tests
    // (no DOM) continue to work because jsdom is a superset of the node env
    // for our suites.
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
