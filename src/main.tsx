import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Remove the static boot screen from index.html once React has painted, so the
// hand off is seamless: the splash is only ever seen while the webview starts.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const boot = document.getElementById("boot");
    if (!boot) return;
    boot.classList.add("boot-out");
    window.setTimeout(() => boot.remove(), 200);
  });
});
