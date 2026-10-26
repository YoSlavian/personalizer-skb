import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { Brand, BrowserLogin, TelegramOnboarding } from "./auth/AuthScreens";
import { AppShell } from "./components/Layout";
import { ToastProvider } from "./components/toast";
import { Button, ErrorState, Spinner } from "./components/ui";
import { ApiError } from "./lib/api";
import { tg } from "./lib/telegram";
import { applyThemeMode } from "./lib/theme";
import type { Role } from "./lib/types";
import { UsersScreen } from "./screens/admin/Users";
import { AnalystHome } from "./screens/analyst/AnalystHome";
import { Campaign } from "./screens/analyst/Campaign";
import { ClientDetail } from "./screens/analyst/ClientDetail";
import { Clients } from "./screens/analyst/Clients";
import { Simulator } from "./screens/analyst/Simulator";
import { ClientHome } from "./screens/client/ClientHome";
import { Journey } from "./screens/client/Journey";
import { ManagerHome } from "./screens/manager/ManagerHome";
import { TaskDetail } from "./screens/manager/TaskDetail";
import { Tasks } from "./screens/manager/Tasks";
import { ApplicationDetail } from "./screens/shared/ApplicationDetail";
import { Applications } from "./screens/shared/Applications";
import { Notifications } from "./screens/shared/Notifications";
import { NotFound } from "./screens/shared/NotFound";
import { ProfileScreen } from "./screens/shared/Profile";

export const BASENAME = "/miniapp";

function makeClient() {
  return new QueryClient({
    queryCache: new QueryCache(),
    mutationCache: new MutationCache(),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, e) => !(e instanceof ApiError && [401, 403, 404, 422].includes(e.status)) && count < 2,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

/** Переход по ссылке из бота (?route=/applications/12) или по start_param (app_12, task_3, offer_5). */
function DeepLink() {
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const params = new URLSearchParams(window.location.search);
    let route = params.get("route");
    const sp = tg.startParam();
    if (!route && sp) {
      const m = sp.match(/^(app|task|offer)_(\d+)$/);
      if (m) route = m[1] === "app" ? `/applications/${m[2]}` : m[1] === "task" ? `/tasks/${m[2]}` : `/journey?offer=${m[2]}`;
    }
    if (route && route.startsWith("/") && !route.startsWith("//")) navigate(route, { replace: true });
  }, [navigate]);
  return null;
}

function RoleRoutes({ role }: { role: Role }) {
  const staff = role !== "client";
  const analyst = role === "analyst" || role === "admin";
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={role === "client" ? <ClientHome /> : role === "manager" ? <ManagerHome /> : <Simulator />} />
        {analyst && <Route path="pilot" element={<AnalystHome />} />}
        <Route path="applications" element={<Applications />} />
        <Route path="applications/:id" element={<ApplicationDetail />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<ProfileScreen />} />
        {role === "client" && <Route path="journey" element={<Journey />} />}
        {staff && <Route path="tasks" element={<Tasks />} />}
        {staff && <Route path="tasks/:id" element={<TaskDetail />} />}
        {staff && <Route path="clients" element={<Clients />} />}
        {staff && <Route path="clients/:id" element={<ClientDetail />} />}
        {staff && <Route path="simulator" element={<Simulator />} />}
        {analyst && <Route path="campaign" element={<Campaign />} />}
        {role === "admin" && <Route path="users" element={<UsersScreen />} />}
        <Route path="cabinet" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function Splash({ children }: { children?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[var(--tg-viewport-stable-height,100dvh)] max-w-lg flex-col items-center justify-center gap-6 px-6 text-center">
      <Brand compact />
      {children ?? <Spinner className="size-6 text-brand" />}
    </div>
  );
}

function Gate() {
  const { state, retry } = useAuth();
  const [readySent, setReadySent] = useState(false);
  // ready() — когда интерфейс готов к показу (после проверки входа), чтобы Telegram не показывал пустой экран
  useEffect(() => {
    if (state.status !== "loading" && !readySent) {
      tg.ready();
      setReadySent(true);
    }
  }, [state.status, readySent]);
  useEffect(() => {
    const off = tg.on("themeChanged", () => { tg.applyTheme(); applyThemeMode(); });
    return off;
  }, []);

  if (state.status === "loading") return <Splash />;
  if (state.status === "unlinked") return <TelegramOnboarding />;
  if (state.status === "login") return <BrowserLogin reason={state.reason} />;
  if (state.status === "error") {
    const e = state.error;
    const notConfigured = e instanceof ApiError && e.code === "telegram_not_configured";
    return (
      <Splash>
        <div className="w-full">
          {notConfigured ? (
            <p className="text-[15px] text-hint">Сервер ещё не настроен для Telegram (нет токена бота). Откройте приложение в браузере или обратитесь к администратору.</p>
          ) : (
            <ErrorState error={e} onRetry={retry} />
          )}
          {notConfigured && <Button className="mt-4" variant="secondary" onClick={retry}>Повторить</Button>}
        </div>
      </Splash>
    );
  }
  return (
    <>
      <DeepLink />
      <RoleRoutes role={state.me.user.role} />
    </>
  );
}

export default function App() {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter basename={BASENAME}>
        <ToastProvider>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
