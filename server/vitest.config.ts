import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: "forks",
    // Each API test file boots its own embedded Postgres (WASM); cap parallelism to bound memory.
    maxWorkers: 2,
  },
});
