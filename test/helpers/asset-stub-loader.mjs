// Node ESM loader hook used by render tests that mount real client components.
//
// Vite resolves the `@assets/*` alias (see vite.config.ts) and turns imported
// image files into URL strings at build time. Under `tsx --test` there is no
// Vite, and Node cannot import a `.png` as a module, so any component that does
// `import logo from "@assets/foo.png"` (e.g. brand-logo.tsx, pulled in by the
// auth page) blows up with ERR_MODULE_NOT_FOUND before the test can render.
//
// This hook short-circuits every `@assets/*` specifier to a tiny data: module
// that exports an empty string — exactly the shape (a string URL) the
// components expect — so the component tree evaluates and renders normally.
const STUB = "data:text/javascript," + encodeURIComponent("export default '';");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@assets/")) {
    return { url: STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
