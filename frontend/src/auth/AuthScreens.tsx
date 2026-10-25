import { useQuery } from "@tanstack/react-query";
import { BarChart3, Briefcase, Building2, Calculator, ChevronRight, LogIn, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Banner, Button, cx, Field, inputCls, Spinner } from "../components/ui";
import { ApiError, get } from "../lib/api";
import { useAuth } from "./AuthProvider";

type DemoAccounts = { password: string; accounts: { email: string; title: string; description: string; role: string }[] };

const ROLE_ICON: Record<string, typeof UserRound> = { client: Building2, manager: Briefcase, analyst: BarChart3, admin: ShieldCheck };

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-11 items-center justify-center rounded-[14px] bg-brand text-white shadow-[0_6px_20px_rgba(239,49,36,.35)]">
        <Sparkles className="size-5" />
      </div>
      <div>
        <div className="font-display text-[20px] leading-tight">Персонализатор СКБ</div>
        {!compact && <div className="text-[13px] text-hint">Кому, когда и как предлагать · MVP</div>}
      </div>
    </div>
  );
}

function useDemoAccounts() {
  return useQuery({
    queryKey: ["demo-accounts"],
    queryFn: () => get<DemoAccounts>("/demo/accounts"),
    retry: false,
    staleTime: Infinity,
  });
}

function Intro() {
  return (
    <div className="card mt-6 p-4">
      <div className="text-[15px] font-medium">Что это</div>
      <p className="mt-1 text-[14px] text-hint">
        Сейчас банк показывает всем компаниям одинаковую рекламу. Здесь система подбирает каждой компании своё предложение:
        какой продукт, с каким текстом, кому из сотрудников, по какому каналу и как часто.
      </p>
    <div className="mt-3 space-y-3">
      {[
        { icon: Sparkles, text: "Предложение под отрасль, сезон и роль человека в компании" },
        { icon: Calculator, text: "Расчёт и заявка с подсказками, если клиент сомневается" },
        { icon: ShieldCheck, text: "Менеджер получает задачи, клиент — статусы в чате бота" },
      ].map(({ icon: Icon, text }) => (
        <div key={text} className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Icon className="size-4" />
          </div>
          <p className="text-[15px]">{text}</p>
        </div>
      ))}
    </div>
    </div>
  );
}

// Порядок и понятные описания ролей: с чего начать и что увидите
const ROLE_ORDER = ["analyst", "client", "manager", "admin"];
const ROLE_TEXT: Record<string, string> = {
  analyst: "Главное: выбираете компанию — видите, что ей предложит система и почему",
  client: "Глазами компании: личное предложение, расчёт и заявка",
  manager: "Глазами менеджера банка: задачи, которые создала система",
  admin: "Пользователи и журнал действий",
};

function PasswordForm({ submitLabel, onSubmit, prefill }: { submitLabel: string; onSubmit: (email: string, password: string) => Promise<void>; prefill?: { email: string; password: string } }) {
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [password, setPassword] = useState(prefill?.password ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "unknown", "Не удалось войти"));
    } finally {
      setBusy(false);
    }
  };
  const fe = error?.fieldErrors ?? {};
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label="Email" htmlFor="email" error={fe.email}>
        <input id="email" className={inputCls} type="email" autoComplete="username" inputMode="email" value={email}
          onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fe.email} required placeholder="name@company.ru" />
      </Field>
      <Field label="Пароль" htmlFor="password" error={fe.password}>
        <input id="password" className={inputCls} type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fe.password} required />
      </Field>
      {error && !Object.keys(fe).length && <Banner tone="warn">{error.message}</Banner>}
      <Button type="submit" block size="lg" loading={busy} disabled={!email || !password} icon={<LogIn className="size-4" />}>
        {submitLabel}
      </Button>
    </form>
  );
}

function DemoList({ onPick, busyEmail }: { onPick: (email: string) => void; busyEmail: string | null }) {
  const demo = useDemoAccounts();
  if (demo.isLoading) return <div className="py-4 text-center text-hint"><Spinner /></div>;
  if (!demo.data) return null;
  return (
    <div className="mt-6">
      <div className="mb-2 px-1 text-[15px] font-medium">Выберите, чьими глазами смотреть</div>
      <div className="card divide-y divide-sep overflow-hidden">
        {[...demo.data.accounts].sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role)).map((a, i) => {
          const Icon = ROLE_ICON[a.role] ?? UserRound;
          const first = i === 0;
          return (
            <button key={a.email} type="button" onClick={() => onPick(a.email)} disabled={!!busyEmail}
              className={cx("flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-subtle disabled:opacity-60", first && "bg-brand-soft")}>
              <div className={cx("flex size-10 items-center justify-center rounded-xl", first ? "bg-brand text-white" : "bg-subtle text-text")}><Icon className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[15px] font-medium">
                  {a.title}
                  {first && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">начните здесь</span>}
                </div>
                <div className="text-[13px] leading-snug text-hint">{ROLE_TEXT[a.role] ?? a.description}</div>
              </div>
              {busyEmail === a.email ? <Spinner className="text-brand" /> : <ChevronRight className="size-4 text-hint" />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[12px] text-hint">Демо-режим: компании, люди и суммы демонстрационные.</p>
    </div>
  );
}

/** Mini App открыт в Telegram, но аккаунт не привязан: демо-персона или вход по email. */
export function TelegramOnboarding() {
  const { demoPersona, linkTelegram } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const pick = async (email: string) => {
    setBusy(email);
    setError(null);
    try {
      await demoPersona(email);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось войти");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mx-auto max-w-lg px-4 pb-10 pt-8 animate-fade-up">
      <Brand />
      <Intro />
      {error && <div className="mt-4"><Banner tone="warn">{error}</Banner></div>}
      <DemoList onPick={pick} busyEmail={busy} />
      <div className="mt-6">
        {showForm ? (
          <div className="card p-4">
            <div className="mb-3 text-[15px] font-medium">Вход по учётной записи</div>
            <PasswordForm submitLabel="Войти и привязать Telegram" onSubmit={linkTelegram} />
            <p className="mt-3 text-[12px] text-hint">Telegram привяжется к аккаунту после проверки подписи на сервере. Следующий вход — без пароля.</p>
          </div>
        ) : (
          <Button variant="ghost" block onClick={() => setShowForm(true)}>У меня есть учётная запись</Button>
        )}
      </div>
    </div>
  );
}

/** Открыто в браузере (вне Telegram): вход по email и паролю. */
export function BrowserLogin({ reason }: { reason?: "expired" | "logout" }) {
  const { loginWithPassword } = useAuth();
  const demo = useDemoAccounts();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const pick = async (email: string) => {
    if (!demo.data) return;
    setBusy(email);
    setError(null);
    try {
      await loginWithPassword(email, demo.data.password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось войти");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mx-auto max-w-lg px-4 pb-10 pt-8 animate-fade-up">
      <Brand />
      {reason === "expired" && <div className="mt-5"><Banner tone="warn">Сессия истекла. Войдите снова — данные не потеряны.</Banner></div>}
      <Intro />
      {error && <div className="mt-3"><Banner tone="warn">{error}</Banner></div>}
      <DemoList onPick={pick} busyEmail={busy} />
      <div className="mt-6">
        {showForm || !demo.data ? (
          <div className="card p-4">
            <div className="mb-3 text-[15px] font-medium">Вход по учётной записи</div>
            <PasswordForm submitLabel="Войти" onSubmit={loginWithPassword} />
          </div>
        ) : (
          <Button variant="ghost" block onClick={() => setShowForm(true)}>У меня есть учётная запись</Button>
        )}
      </div>
    </div>
  );
}
