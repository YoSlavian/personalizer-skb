import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { ToastProvider } from "../components/toast";
import type { Me } from "../lib/types";

export type Route = { method?: string; path: string | RegExp; status?: number; body?: unknown; delay?: number };
export type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

/** Подменяет fetch: маршруты проверяются по порядку, первый совпавший отвечает. Возвращает журнал вызовов. */
export function mockApi(routes: Route[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body, headers: (init.headers ?? {}) as Record<string, string> });
      const route = routes.find((r) => (r.method ?? "GET") === method && (typeof r.path === "string" ? url.startsWith(`/api${r.path}`) : r.path.test(url)));
      if (!route) return new Response(JSON.stringify({ error: { code: "not_found", message: `Нет мока для ${method} ${url}` } }), { status: 404 });
      if (route.delay) await new Promise((r) => setTimeout(r, route.delay));
      return new Response(route.body === undefined ? "" : JSON.stringify(route.body), { status: route.status ?? 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

export function me(role: Me["user"]["role"] = "client", extra: Partial<Me> = {}): Me {
  return {
    user: {
      id: 7,
      email: "fd@pole-invest.demo",
      full_name: "Мария Ковалёва",
      role,
      settings: { notify_telegram: true, notify_applications: true, notify_tasks: true, notify_offers: true, adaptive_hints: true },
      telegram: [],
    },
    organizations: [{ id: 1, contact_id: 1 }],
    csrf_token: "csrf",
    demo_mode: true,
    bot_username: "test_bot",
    ...extra,
  };
}

/** Как Gate в приложении: экраны, которым нужен пользователь, рендерятся только после входа. */
function WhenReady({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  return state.status === "ready" ? <>{children}</> : null;
}

export function renderWithProviders(
  ui: ReactNode,
  { route = "/", withAuth = false, waitReady = false }: { route?: string; withAuth?: boolean; waitReady?: boolean } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <ToastProvider>{withAuth ? <AuthProvider>{waitReady ? <WhenReady>{children}</WhenReady> : children}</AuthProvider> : children}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

/** Мок Telegram WebApp: initData — непрозрачная подписанная строка, которую проверяет только сервер. */
export function installTelegram(initData = "query_id=AA&user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc") {
  const mainButton = {
    setParams: vi.fn().mockReturnThis(),
    onClick: vi.fn().mockReturnThis(),
    offClick: vi.fn().mockReturnThis(),
    showProgress: vi.fn().mockReturnThis(),
    hideProgress: vi.fn().mockReturnThis(),
    hide: vi.fn().mockReturnThis(),
    show: vi.fn().mockReturnThis(),
  };
  const wa = {
    initData,
    initDataUnsafe: { user: { id: 999, first_name: "Подмена" } },
    version: "8.0",
    platform: "ios",
    colorScheme: "dark",
    themeParams: {},
    isVersionAtLeast: (v: string) => Number(v) <= 8,
    ready: vi.fn(),
    expand: vi.fn(),
    setHeaderColor: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBottomBarColor: vi.fn(),
    enableClosingConfirmation: vi.fn(),
    disableClosingConfirmation: vi.fn(),
    onEvent: vi.fn(),
    offEvent: vi.fn(),
    showConfirm: vi.fn((_m: string, cb: (ok: boolean) => void) => cb(true)),
    HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn(), selectionChanged: vi.fn() },
    MainButton: mainButton,
    BackButton: { onClick: vi.fn(), offClick: vi.fn(), show: vi.fn(), hide: vi.fn() },
    SettingsButton: { onClick: vi.fn(), offClick: vi.fn(), show: vi.fn(), hide: vi.fn() },
  };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: wa };
  return wa;
}
