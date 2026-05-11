import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./lib/push-notifications";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { createStaleDeployReloadHandler } from "./lib/stale-deploy";
import { pruneOldDrafts } from "./lib/tiptap-drafts";

try {
  pruneOldDrafts();
} catch {
  // ignore
}

const AUTO_RELOAD_DELAY_MS = 1800;
const DEFERRED_RELOAD_DELAY_MS = 30000;

function isUserMidInput(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type?.toLowerCase() || "text";
    const editableTypes = new Set([
      "text",
      "search",
      "email",
      "url",
      "tel",
      "password",
      "number",
      "date",
      "datetime-local",
      "month",
      "time",
      "week",
    ]);
    return editableTypes.has(type);
  }
  if (el.isContentEditable) return true;
  return false;
}

function performReload() {
  try {
    sessionStorage.removeItem("splashShown");
  } catch {}
  window.location.reload();
}

function showReloadNotice() {
  if (isUserMidInput()) {
    toast({
      title: "A new version is available",
      description: "Finish what you're typing — we'll reload in 30 seconds.",
      duration: DEFERRED_RELOAD_DELAY_MS,
      action: (
        <ToastAction
          altText="Reload now"
          onClick={performReload}
          data-testid="button-reload-new-version"
        >
          Reload now
        </ToastAction>
      ),
    });
    // Fallback auto-reload so stale-deploy recovery is still guaranteed
    // even if the user never clicks "Reload now".
    setTimeout(performReload, DEFERRED_RELOAD_DELAY_MS);
    return;
  }

  toast({
    title: "A new version is available",
    description: "Reloading\u2026",
    duration: AUTO_RELOAD_DELAY_MS,
  });
  setTimeout(performReload, AUTO_RELOAD_DELAY_MS);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    registerServiceWorker();
  });

  // Auto-recover from stale-deploy white-screen: the service worker tells us
  // when it can't satisfy a request for a hashed JS/CSS bundle (deploy
  // mismatch). Surface a brief toast so the user understands why the page
  // is about to reload, and defer the reload if they're mid-input. The
  // shared handler guarantees we only fire the notice once even if the SW
  // posts the message multiple times.
  navigator.serviceWorker.addEventListener(
    "message",
    createStaleDeployReloadHandler({ reload: showReloadNotice }),
  );
}

createRoot(document.getElementById("root")!).render(<App />);
