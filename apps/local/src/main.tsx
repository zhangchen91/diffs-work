import * as React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "@diffs/i18n";
import "./styles/globals.css";

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");

createRoot(el).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
