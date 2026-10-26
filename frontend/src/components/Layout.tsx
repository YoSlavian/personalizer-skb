import { useQuery } from "@tanstack/react-query";
import { Bell, BarChart3, ClipboardList, FileText, Home, Moon, SlidersHorizontal, Sun, UserPlus, UserRound, Users, WifiOff } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useMe } from "../auth/AuthProvider";
import { get } from "../lib/api";
import { useOnline, useSlowNetwork } from "../lib/hooks";
import { tg } from "../lib/telegram";
import { isDarkNow, THEME_EVENT, toggleTheme } from "../lib/theme";
import type { Role } from "../lib/types";
import { cx } from "./ui";

type Tab = { to: string; label: string; icon: typeof Home };

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

/** Системная кнопка «Назад» Telegram: видна на вложенных экранах, скрыта на корневых вкладках. */
function useTelegramBack(roots: string[]) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (SELF_MANAGED_BACK.has(location.pathname)) return; // экран сам управляет шагами «назад»
    if (roots.includes(location.pathname)) {
      tg.backButton(null);
      return;
    }
    const parent = "/" + location.pathname.split("/").filter(Boolean).slice(0, -1).join("/");
    return tg.backButton(() => {
      tg.haptic("light");
      if (location.key !== "default" && window.history.length > 1) navigate(-1);
      else navigate(parent || "/", { replace: true });
    });
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
  useEffect(() => tg.settingsButton(() => navigate("/profile")), [navigate]);

  return (
    <div className="mx-auto min-h-[var(--tg-viewport-stable-height,100dvh)] max-w-lg">
      {!online && (
        <div role="alert" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-ink px-4 py-2 text-[13px] text-white">
          <WifiOff className="size-4" /> Нет соединения. Показаны сохранённые данные
        </div>
      )}
      {online && slow && (
        <div role="status" className="sticky top-0 z-40 bg-warning/90 px-4 py-1.5 text-center text-[13px] text-ink">Медленное соединение — ждём ответ сервера…</div>
      )}
      <main className="px-4 pb-28">
        <Outlet />
      </main>
      <nav aria-label="Разделы" className="fixed inset-x-0 bottom-0 z-30 border-t border-sep bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur pb-safe">
        <div className="mx-auto flex max-w-lg">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => tg.haptic("select")}
              className={({ isActive }) => cx("relative flex flex-1 flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-medium", isActive ? "text-brand" : "text-hint")}
            >
              <Icon className="size-[22px]" strokeWidth={2} aria-hidden />
              {label}
              {to === "/notifications" && unread > 0 && (
                <span className="absolute left-1/2 top-1.5 ml-2 min-w-[18px] rounded-full bg-brand px-1 text-center text-[11px] leading-[18px] text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function Screen({ title, subtitle, right, children }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="animate-fade-up pt-safe">
      <header className="flex items-start gap-3 pb-1 pt-5">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] leading-[1.1] tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="mt-1 text-[14px] text-hint">{subtitle}</p>}
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
      className="flex size-10 items-center justify-center rounded-2xl bg-surface shadow-[var(--shadow)] active:scale-95">
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

export function BellButton() {
  const unread = useUnread();
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/notifications")} aria-label={`Уведомления${unread ? `: ${unread} новых` : ""}`}
      className="relative flex size-10 items-center justify-center rounded-2xl bg-surface shadow-[var(--shadow)]">
      <Bell className="size-5" />
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[11px] leading-[18px] text-white">{unread > 9 ? "9+" : unread}</span>}
    </button>
  );
}
