import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Let Rollup group shared dependencies with their initialization order
    // intact. Partial manual groups (e.g. Recharts without its D3 dependencies)
    // can import back from a lazy page and throw before that page initializes.
    // Route-level dynamic imports still keep secondary pages deferred.
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
