import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-test/**",
    ".claude/**",
    ".ralph/**",
    "coverage/**",
    "unit-coverage/**",
    "assets/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
    ".next-test/**",
    ".v8-coverage/**",
    "assets/**",
    "blob-report/**",
    "coverage/**",
    "monocart-report/**",
    "playwright-report/**",
    "test-results/**",
    "unit-coverage/**",
  ]),
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["e2e/fixtures/auth.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: [
      "src/app/dashboard/page.tsx",
      "src/components/performance/**/*.tsx",
      "src/components/ui/*.tsx",
      "src/components/visits/IndividualStudentDiscussionForm.tsx",
    ],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
