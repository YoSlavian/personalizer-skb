import { useQuery } from "@tanstack/react-query";
import { BarChart3, Briefcase, Building2, Calculator, ChevronRight, LogIn, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Banner, Button, Field, inputCls, Spinner } from "../components/ui";
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
        {!compact && <div className="text-[13px] text-hint">Прототип кейс-школы Альфа-Будущее · синтетические данные</div>}
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
    <div className="mt-6 space-y-3">
      {[
        { icon: Sparkles, text: "Предложение под задачи вашей компании: отрасль, сезон, роль в бизнесе" },
        { icon: Calculator, text: "Расчёт и заявка за пару минут — с подсказками, если что-то непонятно" },
        { icon: ShieldCheck, text: "Статусы заявок и ответы менеджера — здесь и в чате бота" },
      ].map(({ icon: Icon, text }) => (
        <div key={text} className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Icon className="size-4" />
          </div>
          <p className="text-[15px]">{text}</p>
        </div>
      ))}
    </div>
  );
}

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
      <div className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-hint">Демо-режим: войти как</div>
      <div className="card divide-y divide-sep overflow-hidden">
        {demo.data.accounts.map((a) => {
          const Icon = ROLE_ICON[a.role] ?? UserRound;
          return (
            <button key={a.email} type="button" onClick={() => onPick(a.email)} disabled={!!busyEmail}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-subtle disabled:opacity-60">
              <div className="flex size-9 items-center justify-center rounded-xl bg-subtle text-text"><Icon className="size-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{a.title}</div>
                <div className="truncate text-[13px] text-hint">{a.description}</div>
              </div>
              {busyEmail === a.email ? <Spinner className="text-brand" /> : <ChevronRight className="size-4 text-hint" />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[12px] text-hint">Все компании, люди и суммы синтетические. Это не сервис Альфа-Банка.</p>
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
      <div className="mt-5">
        <Banner tone="info">Приложение рассчитано на Telegram: откройте его кнопкой в боте. В браузере доступен вход по учётной записи.</Banner>
      </div>
      <div className="card mt-4 p-4">
        <PasswordForm submitLabel="Войти" onSubmit={loginWithPassword} />
      </div>
      {error && <div className="mt-3"><Banner tone="warn">{error}</Banner></div>}
      <DemoList onPick={pick} busyEmail={busy} />
    </div>
  );
}
