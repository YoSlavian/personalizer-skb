/**
 * Обёртка над Telegram Mini Apps API (window.Telegram.WebApp, https://core.telegram.org/bots/webapps).
 * Все вызовы проверяют версию клиента: на старых версиях метод пропускается, а не падает.
 * initDataUnsafe не используется для авторизации — на сервер уходит только исходная строка initData.
 */

type Haptic = "light" | "medium" | "heavy" | "rigid" | "soft";
type Notice = "error" | "success" | "warning";

interface BottomButton {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean; has_shine_effect?: boolean }): BottomButton;
  onClick(cb: () => void): BottomButton;
  offClick(cb: () => void): BottomButton;
  show(): BottomButton;
  hide(): BottomButton;
  enable(): BottomButton;
  disable(): BottomButton;
  showProgress(leaveActive?: boolean): BottomButton;
  hideProgress(): BottomButton;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name?: string } };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string | undefined>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  disableVerticalSwipes?(): void;
  close(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  onEvent(event: string, cb: (...args: unknown[]) => void): void;
  offEvent(event: string, cb: (...args: unknown[]) => void): void;
  showConfirm(message: string, cb?: (ok: boolean) => void): void;
  showAlert(message: string, cb?: () => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  MainButton: BottomButton;
  SecondaryButton?: BottomButton;
  BackButton: { isVisible: boolean; onClick(cb: () => void): void; offClick(cb: () => void): void; show(): void; hide(): void };
  SettingsButton?: { onClick(cb: () => void): void; offClick(cb: () => void): void; show(): void; hide(): void };
  HapticFeedback: { impactOccurred(s: Haptic): void; notificationOccurred(t: Notice): void; selectionChanged(): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  const wa = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
  return wa && wa.initData ? wa : null;
}

export const isTelegram = (): boolean => getWebApp() !== null;

function atLeast(v: string): boolean {
  const wa = getWebApp();
  try {
    return !!wa && wa.isVersionAtLeast(v);
  } catch {
    return false;
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* метод недоступен в этой версии клиента — пропускаем */
  }
}

/**
 * Системная «Назад» — стек обработчиков. Telegram вызывает все подписчики BackButton.onClick разом,
 * поэтому к кнопке подключён один диспетчер, а он зовёт только верхний обработчик: шторка поверх экрана
 * закрывается первой, следующее нажатие уводит с экрана. Кнопка видна, пока стек не пуст.
 * Слои: route — вложенный маршрут (Layout), screen — шаги внутри экрана, overlay — шторки; выше слой — раньше срабатывает.
 */
export type BackLayer = "route" | "screen" | "overlay";
const BACK_LAYERS: Record<BackLayer, number> = { route: 0, screen: 1, overlay: 2 };
type BackEntry = { handler: () => void; layer: number; seq: number };
const back = { stack: [] as BackEntry[], seq: 0, attachedTo: null as TelegramWebApp | null, hideQueued: false };

function backTop(): BackEntry | undefined {
  let top: BackEntry | undefined;
  for (const e of back.stack) if (!top || e.layer > top.layer || (e.layer === top.layer && e.seq > top.seq)) top = e;
  return top;
}

function onBackPressed(): void {
  backTop()?.handler();
}

function syncBackButton(): void {
  const wa = getWebApp();
  const prev = back.attachedTo;
  if (prev && prev !== wa) {
    safe(() => prev.BackButton.offClick(onBackPressed));
    back.attachedTo = null;
  }
  if (!wa || !atLeast("6.1")) return;
  if (back.stack.length) {
    if (back.attachedTo !== wa) {
      safe(() => wa.BackButton.onClick(onBackPressed));
      back.attachedTo = wa;
    }
    if (!wa.BackButton.isVisible) safe(() => wa.BackButton.show());
    return;
  }
  if (back.attachedTo) {
    safe(() => wa.BackButton.offClick(onBackPressed));
    back.attachedTo = null;
  }
  // Прячем после коммита: при переходе между вложенными экранами старый обработчик снимается и новый ставится
  // в одном проходе эффектов — кнопка не мигает «Закрыть»
  if (back.hideQueued) return;
  back.hideQueued = true;
  queueMicrotask(() => {
    back.hideQueued = false;
    if (!back.stack.length) safe(() => getWebApp()?.BackButton.hide());
  });
}

function pushBack(handler: () => void, layer: BackLayer = "screen"): () => void {
  const entry: BackEntry = { handler, layer: BACK_LAYERS[layer], seq: ++back.seq };
  back.stack.push(entry);
  syncBackButton();
  return () => {
    const i = back.stack.indexOf(entry);
    if (i < 0) return;
    back.stack.splice(i, 1);
    syncBackButton();
  };
}

/** Подписчики SettingsButton: кнопка прячется, когда последний отписался (оболочка приложения размонтирована). */
let settingsSubscribers = 0;

export const tg = {
  initData(): string | null {
    return getWebApp()?.initData || null;
  },
  startParam(): string | null {
    return getWebApp()?.initDataUnsafe?.start_param ?? null;
  },
  platform(): string {
    return getWebApp()?.platform ?? "browser";
  },
  ready(): void {
    safe(() => getWebApp()?.ready());
  },
  /** На всю высоту; на телефоне — полноэкранный режим без шторки Telegram (клиенты 8.0+). */
  expand(): void {
    const wa = getWebApp();
    safe(() => wa?.expand());
    if (!wa || !atLeast("8.0") || !["ios", "android"].includes(wa.platform)) return;
    safe(() => wa.requestFullscreen?.());
    // Свайп вниз по списку не должен сворачивать приложение
    safe(() => wa.disableVerticalSwipes?.());
  },
  applyTheme(): void {
    const wa = getWebApp();
    const root = document.documentElement;
    if (!wa) {
      root.removeAttribute("data-tg");
      return;
    }
    root.setAttribute("data-tg", wa.platform);
    root.setAttribute("data-theme", wa.colorScheme);
    // Шапка и фон Telegram — в цвет фона приложения (палитра своя, от Telegram берём только светлая/тёмная)
    const bg = wa.colorScheme === "dark" ? "#000000" : "#ececec";
    if (atLeast("6.1")) {
      safe(() => wa.setHeaderColor(bg));
      safe(() => wa.setBackgroundColor(bg));
    }
    if (atLeast("7.10")) safe(() => wa.setBottomBarColor?.(bg));
  },
  on(event: string, cb: () => void): () => void {
    const wa = getWebApp();
    if (!wa) return () => {};
    safe(() => wa.onEvent(event, cb));
    return () => safe(() => wa.offEvent(event, cb));
  },
  haptic(kind: Haptic | Notice | "select" = "light"): void {
    const wa = getWebApp();
    if (!wa || !atLeast("6.1")) return;
    safe(() => {
      if (kind === "select") wa.HapticFeedback.selectionChanged();
      else if (kind === "success" || kind === "error" || kind === "warning") wa.HapticFeedback.notificationOccurred(kind);
      else wa.HapticFeedback.impactOccurred(kind);
    });
  },
  confirm(message: string): Promise<boolean> {
    const wa = getWebApp();
    if (wa && atLeast("6.2")) {
      return new Promise((resolve) => safe(() => wa.showConfirm(message, (ok) => resolve(ok))));
    }
    return Promise.resolve(window.confirm(message));
  },
  closingConfirmation(on: boolean): void {
    const wa = getWebApp();
    if (!wa || !atLeast("6.2")) return;
    safe(() => (on ? wa.enableClosingConfirmation() : wa.disableClosingConfirmation()));
  },
  /**
   * Обработчик системной «Назад» поверх стека (см. pushBack): возвращает функцию снятия.
   * null — экрану «Назад» не нужна: свой обработчик он не ставит, видимость решают остальные записи стека.
   */
  backButton(handler: (() => void) | null): () => void {
    if (!handler) {
      syncBackButton();
      return () => {};
    }
    return pushBack(handler, "screen");
  },
  /** «Назад» с явным слоем: route — маршрут (Layout), screen — шаги экрана, overlay — шторка. */
  pushBack,
  settingsButton(handler: () => void): () => void {
    const wa = getWebApp();
    const sb = wa?.SettingsButton;
    if (!wa || !sb || !atLeast("7.0")) return () => {};
    settingsSubscribers += 1;
    safe(() => {
      sb.onClick(handler);
      sb.show();
    });
    let off = false;
    return () => {
      if (off) return;
      off = true;
      settingsSubscribers -= 1;
      safe(() => sb.offClick(handler));
      // Без подписчиков кнопка в меню Telegram ничего не делает — прячем; повторная подписка в том же коммите её оставит
      queueMicrotask(() => {
        if (settingsSubscribers === 0) safe(() => sb.hide());
      });
    };
  },
  mainButton(): BottomButton | null {
    return getWebApp()?.MainButton ?? null;
  },
  openTelegramLink(url: string): void {
    const wa = getWebApp();
    if (wa && atLeast("6.1")) safe(() => wa.openTelegramLink(url));
    else window.open(url, "_blank", "noopener");
  },
};
