import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { tg } from "./lib/telegram";
import { applyThemeMode } from "./lib/theme";

// До первой отрисовки: тема Telegram и раскрытие на всю высоту
tg.applyTheme();
applyThemeMode();
tg.expand();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
