import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./lib/push-notifications";

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerServiceWorker();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
