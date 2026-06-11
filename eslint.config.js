import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

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
  // Type-aware lint coverage for the server + shared trees. The React client has
  // its hooks guard above; this block catches the equivalent class of latent
  // bugs on the backend — unawaited promises (lost writes / unhandled
  // rejections), unused bindings (dead/stale code), and accidental fall-through.
  // Rules are deliberately conservative so they don't fight the existing style.
  {
    files: ["server/**/*.ts", "shared/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // Unawaited promises silently swallow rejections and can let a response
      // return before a DB write lands — the server-side analogue of a
      // stale-data bug. Fire-and-forget calls must say so with `void`.
      "@typescript-eslint/no-floating-promises": "error",
      // A promise used where a non-promise is expected (e.g. an un-awaited async
      // call in an `if`/`&&`) is almost always a forgotten `await`.
      "@typescript-eslint/no-misused-promises": "error",
      // Unused bindings are dead/stale code; allow leading-underscore opt-outs.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // `await` on a non-thenable is a sign the awaited value isn't what the
      // author thinks it is (often a missing `()` or wrong return type).
      "@typescript-eslint/await-thenable": "error",
      // `case` blocks that fall through are nearly always a missing `break`.
      "no-fallthrough": "error",
    },
  },
];
