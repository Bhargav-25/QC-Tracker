import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";

const root = createRoot(document.getElementById("root"));
const preview = import.meta.env.DEV && window.location.hash.startsWith("#/__preview");

if (preview) {
  const { default: PreviewApp } = await import("./preview/PreviewApp.jsx");
  root.render(
    <StrictMode>
      <HashRouter>
        <PreviewApp />
      </HashRouter>
    </StrictMode>
  );
} else {
  root.render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>
  );
}
