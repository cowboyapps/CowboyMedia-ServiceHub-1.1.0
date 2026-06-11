import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

// Minimal ESLint config focused on catching the "hooks after an early/conditional
// return" class of bug (React: "Rendered more hooks than during the previous
// render"), which white-screens the app. Scope is intentionally narrow: only the
// React client tree, only the rules-of-hooks rule.
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "migrations/**",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },
  {
    files: ["client/src/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    // We intentionally enable only rules-of-hooks, so pre-existing
    // `eslint-disable react-hooks/exhaustive-deps` comments would otherwise be
    // flagged as "unused directive" noise. Don't report them.
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
