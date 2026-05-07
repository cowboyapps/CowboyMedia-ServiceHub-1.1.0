import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./lib/push-notifications";

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerServiceWorker();
  });

  // Auto-recover from stale-deploy white-screen: the service worker tells us
  // when it can't satisfy a request for a hashed JS/CSS bundle (deploy
  // mismatch). Reload once to pick up the fresh shell.
  let reloadingForStaleDeploy = false;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'SW_RELOAD_REQUIRED' && !reloadingForStaleDeploy) {
      reloadingForStaleDeploy = true;
      try {
        sessionStorage.removeItem('splashShown');
      } catch {}
      window.location.reload();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
