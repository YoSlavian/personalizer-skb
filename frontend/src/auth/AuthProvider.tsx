import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { ApiError, get, onUnauthorized, post, setToken } from "../lib/api";
import { isTelegram, tg } from "../lib/telegram";
import type { Me } from "../lib/types";

export type AuthState =
  | { status: "loading" }
  | { status: "ready"; me: Me }
  | { status: "unlinked" } // Telegram-аккаунт подтверждён, но не привязан к пользователю
  | { status: "login"; reason?: "expired" | "logout" }
  | { status: "error"; error: ApiError | Error };

type Ctx = {
  state: AuthState;
  me: Me | null;
  inTelegram: boolean;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  linkTelegram: (email: string, password: string) => Promise<void>;
  demoPersona: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  retry: () => void;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const inTelegram = isTelegram();
  const reauthing = useRef(false);
  // navigate меняется с каждым адресом, а accept должен оставаться стабильным (от него зависит boot) — держим свежий в ref
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useLayoutEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  // Кто был в приложении последним. После истёкшей сессии или отвязки тот же человек возвращается на прежний адрес,
  // а другой (выбрал иную демо-роль, привязал другую учётную запись) начинает с главной своей роли
  const lastUserId = useRef<number | null>(null);

  const accept = useCallback((me: Me) => {
    if (me.token) setToken(me.token);
    const prev = lastUserId.current;
    lastUserId.current = me.user.id;
    if (prev === null || prev === me.user.id) {
      setState({ status: "ready", me });
      return;
    }
    // Адрес прежнего пользователя (например, заявка клиента /applications/44) новой роли чужой: без вкладки, «Назад» не туда.
    // react-router меняет адрес в переходе (startTransition) — вход кладём в тот же переход, иначе на кадр откроется чужой экран
    startTransition(() => {
      navigateRef.current("/", { replace: true });
      setState({ status: "ready", me });
    });
  }, []);

  const boot = useCallback(async () => {
    setState({ status: "loading" });
    const initData = tg.initData();
    try {
      if (initData) {
        // Подлинность пользователя проверяет сервер по подписи initData; клиентским данным не доверяем
        accept(await post<Me>("/auth/telegram", { init_data: initData }, { quiet401: true }));
      } else {
        accept(await get<Me>("/auth/me"));
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "telegram_not_linked") setState({ status: "unlinked" });
      else if (e instanceof ApiError && e.status === 401 && !initData) setState({ status: "login" });
      else setState({ status: "error", error: e as Error });
    }
  }, [accept]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Истёкшая сессия: в Telegram тихо входим заново по initData, в браузере — экран входа
  useEffect(
    () =>
      onUnauthorized(() => {
        setToken(null);
        const initData = tg.initData();
        if (initData && !reauthing.current) {
          reauthing.current = true;
          post<Me>("/auth/telegram", { init_data: initData }, { quiet401: true })
            .then((me) => {
              accept(me);
              void qc.invalidateQueries();
            })
            .catch((e) => {
              qc.clear();
              // Telegram отвязали (или пользователя отключили), пока шла сессия: вход по паролю его не привяжет —
              // показываем онбординг с «Войти и привязать Telegram», как при первом запуске
              if (e instanceof ApiError && e.code === "telegram_not_linked") setState({ status: "unlinked" });
              else setState({ status: "login", reason: "expired" });
            })
            .finally(() => {
              reauthing.current = false;
            });
        } else if (!initData) {
          qc.clear();
          setState({ status: "login", reason: "expired" });
        }
      }),
    [accept, qc],
  );

  const value = useMemo<Ctx>(
    () => ({
      state,
      me: state.status === "ready" ? state.me : null,
      inTelegram,
      loginWithPassword: async (email, password) => {
        const me = await post<Me>("/auth/login", { email, password }, { quiet401: true });
        setToken(null);
        qc.clear();
        accept(me);
      },
      linkTelegram: async (email, password) => {
        accept(await post<Me>("/auth/telegram/link-login", { init_data: tg.initData(), email, password }, { quiet401: true }));
      },
      demoPersona: async (email) => {
        const me = await post<Me>("/demo/telegram-persona", { init_data: tg.initData(), email }, { quiet401: true });
        qc.clear();
        accept(me);
      },
      logout: async () => {
        try {
          await post("/auth/logout");
        } catch {
          /* сессия уже недействительна */
        }
        setToken(null);
        qc.clear();
        setState(inTelegram ? { status: "unlinked" } : { status: "login", reason: "logout" });
      },
      refreshMe: async () => {
        const me = await get<Me>("/auth/me");
        setState({ status: "ready", me });
      },
      retry: () => void boot(),
    }),
    [state, inTelegram, accept, qc, boot],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth вне AuthProvider");
  return ctx;
}

export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("Пользователь не загружен");
  return me;
}
