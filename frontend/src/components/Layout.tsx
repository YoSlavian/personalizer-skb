import { useQuery } from "@tanstack/react-query";
import { Bell, BarChart3, ChevronLeft, ClipboardList, FileText, Home, type IconType, Moon, SlidersHorizontal, Sun, UserPlus, UserRound, Users, WifiOff } from "./icons";
import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, NavigationType, Outlet, useLocation, useNavigate, useNavigationType } from "react-router";
import { useMe } from "../auth/AuthProvider";
import { get } from "../lib/api";
import { useOnline, useSlowNetwork } from "../lib/hooks";
import { isTelegram, tg } from "../lib/telegram";
import { isDarkNow, THEME_EVENT, toggleTheme } from "../lib/theme";
import type { Role } from "../lib/types";
import { cx } from "./ui";

type Tab = { to: string; label: string; icon: IconType };

export const TABS: Record<Role, Tab[]> = {
  client: [
    { to: "/", label: "Главная", icon: Home },
    { to: "/applications", label: "Заявки", icon: FileText },
    { to: "/notifications", label: "Уведомления", icon: Bell },
    { to: "/profile", label: "Профиль", icon: UserRound },
  ],
  manager: [
    { to: "/", label: "Главная", icon: Home },
    { to: "/tasks", label: "Задачи", icon: ClipboardList },
    { to: "/applications", label: "Заявки", icon: FileText },
    { to: "/profile", label: "Профиль", icon: UserRound },
  ],
  // Симулятор — первый экран: это главное, что показывает решение
  analyst: [
    { to: "/", label: "Симулятор", icon: SlidersHorizontal },
    { to: "/pilot", label: "Пилот A/B", icon: BarChart3 },
    { to: "/clients", label: "Клиенты", icon: Users },
    { to: "/profile", label: "Профиль", icon: UserRound },
  ],
  admin: [
    { to: "/", label: "Симулятор", icon: SlidersHorizontal },
    { to: "/users", label: "Участники", icon: UserPlus },
    { to: "/pilot", label: "Пилот A/B", icon: BarChart3 },
    { to: "/clients", label: "Клиенты", icon: Users },
    { to: "/profile", label: "Профиль", icon: UserRound },
  ],
};

export function useUnread(): number {
  const q = useQuery({ queryKey: ["unread"], queryFn: () => get<{ unread: number }>("/notifications/unread-count"), refetchInterval: 30_000 });
  return q.data?.unread ?? 0;
}

const SELF_MANAGED_BACK = new Set(["/journey"]);

/** Вложенные экраны без своей вкладки: подсвечиваем вкладку, из которой они открываются. */
const TAB_OF: Record<string, string> = { "/campaign": "/pilot", "/journey": "/" };

function sectionOf(pathname: string): string {
  return "/" + (pathname.split("/").filter(Boolean)[0] ?? "");
}

/** Активная вкладка: своя, «родительская» из TAB_OF, иначе та, с которой пришли (как в iOS при переходе вглубь). */
function useActiveTab(tabs: Tab[]): string | null {
  const { pathname } = useLocation();
  const last = useRef<string | null>(null);
  const section = sectionOf(pathname);
  const has = (to: string | undefined) => !!to && tabs.some((t) => t.to === to);
  const direct = has(section) ? section : has(TAB_OF[section]) ? TAB_OF[section] : null;
  const active = direct ?? last.current;
  useEffect(() => {
    if (direct) last.current = direct;
  }, [direct]);
  return active;
}

/** Позиции прокрутки по записям истории: «назад» возвращает список туда, где его оставили. */
const scrollByKey = new Map<string, number>();

/** Новый экран открывается сверху; при «назад» (POP) прокрутка восстанавливается. */
function useRouteScroll() {
  const { key } = useLocation();
  const navType = useNavigationType();
  const shown = useRef(key);
  // Позицию уходящего экрана снимаем во время рендера: DOM ещё прежний, и прокрутку не обрезал более короткий новый экран
  if (shown.current !== key) {
    scrollByKey.set(shown.current, window.scrollY);
    shown.current = key;
  }
  useEffect(() => {
    try {
      if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    } catch {
      /* не критично */
    }
  }, []);
  useLayoutEffect(() => {
    const target = navType === NavigationType.Pop ? (scrollByKey.get(key) ?? 0) : 0;
    window.scrollTo(0, target);
    if (target <= 0 || window.scrollY >= target - 1) return;
    // Список ещё догружается и короче сохранённой позиции — догоняем ~1 с, пока пользователь сам не начал листать
    let tries = 0;
    let timer = 0;
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("wheel", stop);
    };
    const step = () => {
      window.scrollTo(0, target);
      if (window.scrollY >= target - 1 || ++tries > 20) stop();
      else timer = window.setTimeout(step, 50);
    };
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("wheel", stop, { passive: true });
    timer = window.setTimeout(step, 50);
    return stop;
  }, [key, navType]);
}

/** Корневая ли вкладка открыта: на вложенных экранах вне Telegram Screen рисует свою кнопку «назад». */
const RootContext = createContext<{ isRoot: boolean; back: () => void }>({ isRoot: true, back: () => {} });

/**
 * Куда вести «назад», когда истории нет (открыли по ссылке): на родительскую вкладку, если она есть у роли,
 * иначе на главную. Иначе ссылка /tasks/12 у клиента вела бы на /tasks — ещё одну «Страницу не найдено».
 */
function parentOf(pathname: string, roots: string[]): string {
  const parent = "/" + pathname.split("/").filter(Boolean).slice(0, -1).join("/");
  return roots.includes(parent) ? parent : "/";
}

/**
 * Есть ли позади запись истории самого приложения. idx ведёт react-router: растёт при push, сохраняется при replace.
 * Открыли по ссылке (в том числе ?route= — DeepLink подменяет адрес через replace) — idx 0, и navigate(-1)
 * увёл бы со страницы приложения туда, откуда пришли, или в Telegram Web — по его собственной истории.
 */
function hasAppHistory(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  return idx > 0;
}

/**
 * Системная кнопка «Назад» Telegram: на вложенных экранах — обработчик маршрута внизу стека (lib/telegram → pushBack).
 * На корневых вкладках своего обработчика нет: кнопка скрыта («Закрыть»), пока шторка не положит свой поверх.
 */
function useTelegramBack(roots: string[]) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (SELF_MANAGED_BACK.has(location.pathname)) return; // экран сам управляет шагами «назад»
    if (roots.includes(location.pathname)) return;
    const parent = parentOf(location.pathname, roots);
    return tg.pushBack(() => {
      tg.haptic("light");
      if (hasAppHistory()) navigate(-1);
      else navigate(parent, { replace: true });
    }, "route");
  }, [location, navigate, roots]);
}

export function AppShell() {
  const me = useMe();
  const tabs = TABS[me.user.role];
  const navigate = useNavigate();
  const online = useOnline();
  const slow = useSlowNetwork();
  const unread = useUnread();
  const roots = useMemo(() => tabs.map((t) => t.to), [tabs]);
  useTelegramBack(roots);
  useRouteScroll();
  const activeTab = useActiveTab(tabs);
  // Отписка прячет кнопку: после выхода (экран входа/привязки) «Настройки» в меню Telegram не висит без действия.
  // «Назад» прячется сама — обработчики маршрута и шторок снимаются из стека вместе с оболочкой.
  useEffect(() => tg.settingsButton(() => navigate("/profile")), [navigate]);
  const location = useLocation();
  const nav = useMemo(() => {
    const isRoot = roots.includes(location.pathname) || SELF_MANAGED_BACK.has(location.pathname);
    const parent = parentOf(location.pathname, roots);
    const back = () => {
      if (hasAppHistory()) navigate(-1);
      else navigate(parent, { replace: true });
    };
    return { isRoot, back };
  }, [roots, location, navigate]);

  return (
    <RootContext.Provider value={nav}>
    <div className="mx-auto min-h-[var(--tg-viewport-stable-height,100dvh)] max-w-lg">
      {!online && (
        <div role="alert" className="sticky top-[var(--app-top)] z-40 flex items-center justify-center gap-2 bg-ink px-4 py-2 text-[13px] text-white">
          <WifiOff className="size-4" /> Нет соединения. Показаны сохранённые данные
        </div>
      )}
      {online && slow && (
        <div role="status" className="sticky top-[var(--app-top)] z-40 bg-ink px-4 py-1.5 text-center text-[13px] text-white">Медленное соединение — ждём ответ сервера…</div>
      )}
      <main className="px-4 pb-28">
        <Outlet />
      </main>
      <nav aria-label="Разделы" className="fixed inset-x-0 bottom-0 z-30 border-t border-sep bg-[var(--nav)] backdrop-blur-xl pb-safe">
        <div className="mx-auto flex max-w-lg">
          {tabs.map(({ to, label, icon: Icon }) => {
            const isActive = activeTab === to;
            return (
              <Link
                key={to}
                to={to}
                aria-current={isActive ? "page" : undefined}
                onClick={() => tg.haptic("select")}
                className={cx("relative flex min-h-[50px] flex-1 flex-col items-center gap-[3px] pb-1.5 pt-2 text-[11px] transition-colors", isActive ? "font-medium text-brand" : "text-hint")}
              >
                {/* Как в iOS: активная вкладка — залитая иконка, остальные — контур */}
                <Icon className="size-[26px]" weight={isActive ? "fill" : "regular"} aria-hidden />
                {label}
                {to === "/notifications" && unread > 0 && (
                  <span className="absolute left-1/2 top-1 ml-2 min-w-[18px] rounded-full bg-brand px-1 text-center text-[11px] font-medium leading-[18px] text-white ring-2 ring-[var(--surface)]">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
    </RootContext.Provider>
  );
}

/** Кегли заголовка экрана: от 32 px вниз, пока длинное слово не влезет рядом с кнопками, а название — в две строки. */
const TITLE_SIZES = [32, 28, 26, 24, 22];
/** Меньше 22 px — только чтобы не рвать слово (узкие экраны 360–375 px): число строк здесь уже не важно. */
const TITLE_WORD_SIZES = [20, 18];
const TITLE_LEADING = 1.04; // как у .title-xl

/**
 * Влезает ли текст по ширине без переноса внутри слова. Мерим дробные ширины строк (Range): scrollWidth и clientWidth
 * округлены до целых, и слово шире блока на доли пикселя проходило проверку, а потом рвалось («УЧАСТНИК / И»).
 */
function titleFits(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth + 1) return false;
  const cs = getComputedStyle(el);
  const right = el.getBoundingClientRect().right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
  const range = document.createRange();
  if (typeof range.getClientRects !== "function") return true; // jsdom: раскладки нет
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    // Допуск меньше шага раскладки (1/64 px): слово шире строки хоть на долю пикселя будет перенесено
    if (rects[i].width > 0 && rects[i].right > right + 0.01) return false;
  }
  return true;
}

function useFitTitle() {
  const ref = useRef<HTMLHeadingElement>(null);
  const fitted = useRef("");
  const fit = useRef((force?: boolean) => {
    const el = ref.current;
    if (!el) return;
    const sig = `${el.textContent ?? ""}|${el.clientWidth}`;
    if (!force && sig === fitted.current) return;
    fitted.current = sig;
    el.style.overflowWrap = "normal"; // мерим без переноса внутри слова
    const apply = (s: number) => {
      el.style.fontSize = `${s}px`;
    };
    let size: number | null = null;
    for (const s of TITLE_SIZES) {
      apply(s);
      const lines = Math.round(el.scrollHeight / (s * TITLE_LEADING));
      if (titleFits(el) && lines <= 2) {
        size = s;
        break;
      }
    }
    // В две строки не уложились: берём наименьший обычный кегль, а если и в нём слово не влезает — ещё мельче
    if (size === null) {
      for (const s of [TITLE_SIZES[TITLE_SIZES.length - 1], ...TITLE_WORD_SIZES]) {
        apply(s);
        if (titleFits(el)) {
          size = s;
          break;
        }
      }
    }
    apply(size ?? TITLE_WORD_SIZES[TITLE_WORD_SIZES.length - 1]);
    el.style.overflowWrap = ""; // последний рубеж — перенос внутри слова (класс break-words)
  });
  useLayoutEffect(() => fit.current());
  useEffect(() => {
    const refit = () => fit.current(true);
    window.addEventListener("resize", refit);
    // Styrene грузится с font-display: swap — после загрузки ширины букв другие
    document.fonts?.ready.then(refit).catch(() => {});
    return () => window.removeEventListener("resize", refit);
  }, []);
  return ref;
}

export function Screen({ title, subtitle, right, children }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode }) {
  const { isRoot, back } = useContext(RootContext);
  const titleRef = useFitTitle();
  // В Telegram «назад» — системная кнопка слева вверху (вместо «Закрыть»); свою рисуем только в браузере
  const showBack = !isRoot && !isTelegram();
  return (
    <div className="animate-fade-up pt-safe">
      {showBack && (
        <button type="button" onClick={back} aria-label="Назад"
          className="-ml-1 mt-2.5 flex h-11 items-center gap-1 rounded-full pl-1 pr-3 text-[15px] font-medium text-link active:bg-subtle">
          <ChevronLeft className="size-5" weight="bold" /> Назад
        </button>
      )}
      <header className={cx("flex items-start gap-3 pb-1", showBack ? "pt-2" : "pt-5")}>
        <div className="min-w-0 flex-1">
          <h1 ref={titleRef} className="title-xl break-words text-[32px]">{title}</h1>
          {/* Строка подзаголовка резервируется, даже пока в ней пробел (счётчик грузится) — без скачка вёрстки */}
          {subtitle && <p className="mt-1.5 min-h-[1.375em] text-[14px] leading-snug text-hint">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          <ThemeButton />
        </div>
      </header>
      {children}
    </div>
  );
}

/** Смена оформления в правом верхнем углу каждого экрана (светлая ↔ тёмная). */
export function ThemeButton() {
  const [dark, setDark] = useState(isDarkNow);
  useEffect(() => {
    const sync = () => setDark(isDarkNow());
    window.addEventListener(THEME_EVENT, sync);
    const off = tg.on("themeChanged", sync);
    return () => { window.removeEventListener(THEME_EVENT, sync); off(); };
  }, []);
  return (
    <button type="button" onClick={() => { toggleTheme(); tg.haptic("select"); }}
      aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"} title={dark ? "Светлая тема" : "Тёмная тема"}
      className="flex size-11 items-center justify-center rounded-full bg-surface active:scale-95">
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

export function BellButton() {
  const unread = useUnread();
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/notifications")} aria-label={`Уведомления${unread ? `: ${unread} новых` : ""}`}
      className="relative flex size-11 items-center justify-center rounded-full bg-surface active:scale-95">
      <Bell className="size-5" />
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[11px] leading-[18px] text-white">{unread > 9 ? "9+" : unread}</span>}
    </button>
  );
}
