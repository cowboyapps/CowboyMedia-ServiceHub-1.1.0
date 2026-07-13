import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("/{*path}", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      // The admin PWA has its own HTML entry: any /admin navigation gets
      // admin.html (which loads /src/admin-main.tsx); everything else gets the
      // customer app's index.html. `/admin-manifest.json` and `/icons/admin/*`
      // never reach this fallback — vite.middlewares serves them from
      // client/public first.
      const pathname = url.split("?")[0];
      const isAdminApp = pathname === "/admin" || pathname.startsWith("/admin/");
      const templateName = isAdminApp ? "admin.html" : "index.html";
      const entrySrc = isAdminApp ? "/src/admin-main.tsx" : "/src/main.tsx";
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        templateName,
      );

      // always reload the template file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="${entrySrc}"`,
        `src="${entrySrc}?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
