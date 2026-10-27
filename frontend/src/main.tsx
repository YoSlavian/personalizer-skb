import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadTelegramSdk, tg } from "./lib/telegram";
import { applyThemeMode } from "./lib/theme";

// Выбранная на устройстве тема — сразу, ещё до SDK
applyThemeMode();

// SDK Telegram — только внутри Telegram (lib/telegram → loadTelegramSdk); в браузере рисуем сразу
void loadTelegramSdk().then(() => {
  // До первой отрисовки: тема Telegram и раскрытие на всю высоту
  tg.applyTheme();
  applyThemeMode();
  tg.expand();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
