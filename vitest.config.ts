import { defineConfig } from "vitest/config";
import path from "path";

// Freeze the timezone before any Date is constructed in a worker. Date-only
// strings ("2011-03-20") parse as UTC midnight, so formatting them in a
// UTC-behind zone (America/New_York) yields the previous day and the
// DOB/formatDate assertions fail on a clean checkout. Production users are in
// IST, so tests assert the IST-observed behaviour.
process.env.TZ = "Asia/Kolkata";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    // Vitest only defaults NODE_ENV to "test" when the shell hasn't set it, so
    // a shell exporting NODE_ENV=development silently turns ~25 tests red
    // (Toast renders inline only under NODE_ENV==="test"). Pin it.
    env: { NODE_ENV: "test" },
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "e2e"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.d.ts",
        "src/types/**",
        "src/app/api/auth/**",
      ],
      reportsDirectory: "./unit-coverage",
      reporter: ["text", "json-summary", "html"],
    },
  },
});
