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
    // exhaustive-deps is on (warn), so every remaining
    // `eslint-disable react-hooks/exhaustive-deps` comment must justify a real
    // suppression — report any that no longer suppress anything as an error.
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Catches effects/memos/callbacks that read a value but omit it from the
      // dependency array (a common source of stale-data-on-screen bugs). Set to
      // error now that all pre-existing warnings are resolved; each intentional
      // exception carries a one-line `// Keep:` justification.
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
