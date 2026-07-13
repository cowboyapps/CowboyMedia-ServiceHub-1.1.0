import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to the right app shell if the file doesn't exist: /admin
  // navigations get the admin PWA's entry (admin.html), everything else gets
  // the customer app's index.html. Static files (e.g. /admin-manifest.json,
  // /icons/admin/*) are already handled by express.static above.
  app.use("/{*path}", (req, res) => {
    const pathname = req.originalUrl.split("?")[0];
    const isAdminApp = pathname === "/admin" || pathname.startsWith("/admin/");
    res.sendFile(path.resolve(distPath, isAdminApp ? "admin.html" : "index.html"));
  });
}
