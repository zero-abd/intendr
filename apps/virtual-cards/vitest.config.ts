import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // The sandbox test hits the live Lithic sandbox and is skipped unless
    // RUN_LITHIC_SANDBOX_TESTS=true (see tests/lithic.sandbox.test.ts).
    testTimeout: 20_000,
    clearMocks: true,
    restoreMocks: true,
  },
});
