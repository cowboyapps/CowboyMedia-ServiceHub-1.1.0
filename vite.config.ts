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
    rollupOptions: {
      output: {
        // Do not pull shared React/runtime dependencies into an optional
        // editor/chart chunk: that makes startup import the entire chunk too.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/recharts/")) return "vendor-charts";
          if (id.includes("/@tiptap/") || id.includes("/prosemirror-")) return "vendor-tiptap";
          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
