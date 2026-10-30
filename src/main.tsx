import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles/fonts.css";
import { UiLocaleProvider } from "./i18n/LocaleContext";
import { App } from "./app/App";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/editor.css";
import "./styles/workbench.css";

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const LazyLabApp = import.meta.env.DEV
  ? lazy(() => import("./app/LabApp").then((module) => ({ default: module.LabApp })))
  : undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiLocaleProvider><AppErrorBoundary>
      {LazyLabApp && pathname === "/lab" ? (
        <Suspense fallback={<main className="app-shell">正在载入 Visual Lab…</main>}>
          <LazyLabApp />
        </Suspense>
      ) : <App />}
    </AppErrorBoundary></UiLocaleProvider>
  </StrictMode>,
);
