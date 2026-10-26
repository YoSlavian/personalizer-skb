import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Calculator,
  Check,
  ChevronRight,
  type IconType,
  KeyRound,
  LogIn,
  Plant,
  ShieldCheck,
  SlidersHorizontal,
  Storefront,
  Truck,
  UserRound,
} from "../components/icons";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ThemeButton } from "../components/Layout";
import { Banner, Button, cx, Field, IconBadge, inputCls, Section, Skeleton, Spinner, Tag } from "../components/ui";
import { ApiError, get } from "../lib/api";
import { useAuth } from "./AuthProvider";

export type DemoAccount = { email: string; title: string; description: string; role: string };
type DemoAccounts = { password: string; accounts: DemoAccount[] };

/** Словесный знак: компактный — красный стикер (сплэш), полный — заголовок с подписью. */
export function Brand({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <span className="sticker px-3.5 py-2 text-[17px] leading-none">Персонализатор СКБ</span>;
  }
  return (
    <div>
      <div className="title-xl text-[24px]">Персонализатор СКБ</div>
      <div className="mt-1 text-[13px] text-hint">Кому, когда и как предлагать</div>
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

// С чего начать и что увидите: аналитик первым, затем клиенты, менеджер, админ
const ROLE_ORDER = ["analyst", "client", "manager", "admin"];

type Persona = { title: string; subtitle: string; Icon: IconType; start: boolean };

/** Подпись и иконка демо-аккаунта: короткий заголовок и одна строка «что увидите». */
export function personaOf(a: DemoAccount): Persona {
  if (a.role === "analyst") return { title: a.title, subtitle: "Меняем профиль — меняется предложение", Icon: SlidersHorizontal, start: true };
  if (a.role === "manager") return { title: a.title, subtitle: "Задачи, которые создали правила", Icon: Briefcase, start: false };
  if (a.role === "admin") return { title: a.title, subtitle: "Участники и журнал действий", Icon: ShieldCheck, start: false };
  if (a.role !== "client") return { title: a.title, subtitle: a.description, Icon: UserRound, start: false };

  const raw = a.title.replace(/^Клиент:\s*/, "").replace(/^ФД(?=\s|$)/, "Финдиректор");
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  const text = `${a.title} ${a.description}`.toLowerCase();
  if (text.includes("агро") || text.includes("апк")) return { title, subtitle: "Личное предложение, расчёт, заявка", Icon: Plant, start: false };
  if (text.includes("бухгалтер")) return { title, subtitle: "Другая роль — другое предложение", Icon: Calculator, start: false };
  if (text.includes("логист")) return { title, subtitle: a.description, Icon: Truck, start: false };
  if (text.includes("ритейл") || text.includes("торгов")) return { title, subtitle: a.description, Icon: Storefront, start: false };
  return { title, subtitle: a.description, Icon: Building2, start: false };
}

export function sortAccounts(accounts: DemoAccount[]): DemoAccount[] {
  return [...accounts].sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role));
}

/** Строка демо-аккаунта: плитка-иконка, заголовок, одна строка пояснения, шеврон. */
export function PersonaRow({
  account,
  onClick,
  busy = false,
  disabled = false,
  current = false,
  highlight = true,
  inset = false,
}: {
  account: DemoAccount;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  current?: boolean;
  highlight?: boolean;
  /** Строка внутри серой вставной группы (в шторке): плитка и нажатие на тон светлее/темнее фона группы. */
  inset?: boolean;
}) {
  const p = personaOf(account);
  const start = highlight && p.start;
  const strong = start || current;
  const Icon = p.Icon;
  const glyph = <Icon className="size-5" weight={strong ? "fill" : "regular"} />;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={current || undefined}
      className={cx(
        "flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left transition-colors",
        inset ? "active:bg-subtle-2" : "active:bg-subtle",
        start && "bg-brand-soft",
        disabled && !busy && "opacity-60",
      )}
    >
      {inset && !strong ? (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-surface text-text">{glyph}</div>
      ) : (
        <IconBadge tone={strong ? "brand" : "neutral"}>{glyph}</IconBadge>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-medium leading-tight">{p.title}</span>
          {start && <Tag tone="lime">начните здесь</Tag>}
        </div>
        <div className="mt-0.5 text-[13px] leading-snug text-hint">{p.subtitle}</div>
      </div>
      {busy ? (
        <Spinner className="shrink-0 text-brand" />
      ) : current ? (
        <Check className="size-5 shrink-0 text-brand" weight="bold" aria-label="Текущая роль" />
      ) : (
        <ChevronRight className="size-4 shrink-0 text-hint" aria-hidden />
      )}
    </button>
  );
}

function DemoListSkeleton() {
  return (
    <div className="card divide-y divide-sep overflow-hidden" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex min-h-[64px] items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 rounded-[14px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DemoList({ onPick, busyEmail }: { onPick: (email: string) => void; busyEmail: string | null }) {
  const demo = useDemoAccounts();
  if (!demo.isLoading && !demo.data) return null;
  return (
    <Section title="Смотреть глазами" className="mt-8">
      {demo.isLoading || !demo.data ? (
        <DemoListSkeleton />
      ) : (
        <div className="card divide-y divide-sep overflow-hidden">
          {sortAccounts(demo.data.accounts).map((a) => (
            <PersonaRow key={a.email} account={a} onClick={() => onPick(a.email)} busy={busyEmail === a.email} disabled={!!busyEmail} />
          ))}
        </div>
      )}
    </Section>
  );
}

function Hero() {
  return (
    <header className="pt-8">
      {/* Смена оформления — в том же углу, что и на экранах приложения */}
      <div className="flex items-start justify-between gap-3">
        {/* Кегль от ширины экрана: самая длинная строка ≈ 0.69 vw, рядом кнопка 44 px — три строки без переноса и наезда от 290 px */}
        <h1 className="title-xl min-w-0 text-[clamp(28px,8.7vw,40px)] leading-[0.95]!">
          Кому, когда
          <br />и как
          <br />
          предлагать
        </h1>
        <div className="shrink-0">
          <ThemeButton />
        </div>
      </div>
      <div className="relative mt-2.5">
        <span className="sticker px-3 py-1.5 text-[13px] leading-none">Персонализатор СКБ</span>
      </div>
      <p className="mt-4 text-[15px] leading-snug">
        Слой поверх ML-оптимизатора банка: продукт, текст, получатель, канал и частота под каждую компанию.
      </p>
    </header>
  );
}

function Footer() {
  return <p className="mt-8 text-center text-[12px] text-hint">Все компании и данные — синтетические</p>;
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

/** Вход по учётной записи: свёрнут в одну кнопку, пока есть демо-аккаунты. */
function AccountForm({ open, onOpen, children, note }: { open: boolean; onOpen: () => void; children: ReactNode; note?: string }) {
  if (!open) {
    return (
      <div className="mt-3">
        {/* Кнопка прямо на фоне экрана: подложка-карточка, иначе в тёмной теме она сливается с чёрным фоном */}
        <Button variant="ghost" block className="bg-surface! active:opacity-80" icon={<KeyRound className="size-4" />} onClick={onOpen}>
          У меня есть учётная запись
        </Button>
      </div>
    );
  }
  return (
    <Section title="Учётная запись" className="mt-8 animate-fade">
      {children}
      {note && <p className="mt-2.5 px-1 text-[12px] text-hint">{note}</p>}
    </Section>
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
    <div className="mx-auto max-w-lg px-4 pb-10 pt-safe animate-fade-up">
      <Hero />
      {error && <div className="mt-5"><Banner tone="warn">{error}</Banner></div>}
      <DemoList onPick={pick} busyEmail={busy} />
      <AccountForm open={showForm} onOpen={() => setShowForm(true)} note="Telegram привяжется к учётной записи — следующий вход без пароля.">
        <PasswordForm submitLabel="Войти и привязать Telegram" onSubmit={linkTelegram} />
      </AccountForm>
      <Footer />
    </div>
  );
}

/** Открыто в браузере (вне Telegram): демо-роль или вход по email и паролю. */
export function BrowserLogin({ reason }: { reason?: "expired" | "logout" }) {
  const { loginWithPassword } = useAuth();
  const navigate = useNavigate();
  // После «Выйти» адрес остаётся прежним (например, /profile) — сбрасываем на главную, чтобы новая роль открылась с начала.
  // При истёкшей сессии адрес не трогаем: после входа человек вернётся туда, где был.
  useEffect(() => {
    if (reason === "logout") navigate("/", { replace: true });
  }, [reason, navigate]);
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
  // Без демо-аккаунтов форма — единственный способ войти, поэтому сразу раскрыта
  const formOpen = showForm || (!demo.isLoading && !demo.data);
  return (
    <div className="mx-auto max-w-lg px-4 pb-10 pt-safe animate-fade-up">
      <Hero />
      {reason === "expired" && <div className="mt-5"><Banner tone="warn">Сессия истекла — войдите снова. Данные сохранены.</Banner></div>}
      {error && <div className="mt-5"><Banner tone="warn">{error}</Banner></div>}
      <DemoList onPick={pick} busyEmail={busy} />
      <AccountForm open={formOpen} onOpen={() => setShowForm(true)}>
        <PasswordForm submitLabel="Войти" onSubmit={loginWithPassword} />
      </AccountForm>
      <Footer />
    </div>
  );
}
