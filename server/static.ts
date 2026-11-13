import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express, distPath = path.resolve(__dirname, "public")) {
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    },
  }));

  // A missing old hashed bundle must be a real failure, not an HTML shell
  // with status 200 (which the service worker would cache as JavaScript).
  app.use("/assets", (_req, res) => {
    res.status(404).set("Cache-Control", "no-store").type("text/plain").send("Asset not found");
  });

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.set("Cache-Control", "no-store").sendFile(path.resolve(distPath, "index.html"));
  });
}
