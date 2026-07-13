// Entry point for the ADMIN PWA served at /admin (loaded by client/admin.html).
// This is a completely separate installable app from the customer PWA: its own
// HTML entry, its own manifest (/admin-manifest.json), and its own
// service-worker registration scoped to /admin.

import { createRoot } from "react-dom/client";
import AdminApp from "./admin-app";
import "./index.css";
import { configurePushScope, registerServiceWorker } from "./lib/push-notifications";
import { createStaleDeployReloadHandler } from "./lib/stale-deploy";
import { setupSafeAreaInsets } from "./lib/safe-area";

// MUST run before anything touches push/service-worker helpers so every
// register/getRegistration/subscribe call is scoped to /admin instead of /.
configurePushScope("/admin");

setupSafeAreaInsets();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    registerServiceWorker();
  });

  // Auto-recover from a stale-deploy white screen: reload when the admin
  // service worker reports it can't satisfy a hashed-bundle request.
  navigator.serviceWorker.addEventListener(
    "message",
    createStaleDeployReloadHandler({ reload: () => window.location.reload() }),
  );
}

createRoot(document.getElementById("root")!).render(<AdminApp />);
