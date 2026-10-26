/** Оформление приложения: как в Telegram (по умолчанию), светлое или тёмное. Хранится на устройстве. */
export type ThemeMode = "auto" | "light" | "dark";

const KEY = "app.theme";
const COLORS = { light: "#f1f1f4", dark: "#000000" } as const;

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyThemeMode(mode: ThemeMode = getThemeMode()): void {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-mode");
  else root.setAttribute("data-mode", mode);
  // Шапка и фон Telegram под выбранную тему (если приложение открыто в Telegram)
  const wa = (window as unknown as { Telegram?: { WebApp?: { setHeaderColor?: (c: string) => void; setBackgroundColor?: (c: string) => void } } }).Telegram?.WebApp;
  if (mode !== "auto" && wa) {
    try {
      wa.setHeaderColor?.(COLORS[mode]);
      wa.setBackgroundColor?.(COLORS[mode]);
    } catch {
      /* старые клиенты Telegram */
    }
  }
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* без хранилища тема действует до перезапуска */
  }
  applyThemeMode(mode);
}
