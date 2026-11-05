/** Node tests exercise pure reducers and real TCP connections. */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tools/**/*.test.ts"],
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      include: ["packages/shared/src/{framing,reducer,undo}.ts"],
    },
  },
});
