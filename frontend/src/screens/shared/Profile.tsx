import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Info, KeyRound, LogOut, Repeat, Send, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth, useMe } from "../../auth/AuthProvider";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, Field, inputCls, List, Row, Section, Segmented, Sheet, Spinner, Toggle } from "../../components/ui";
import { getThemeMode, setThemeMode, THEME_EVENT, type ThemeMode } from "../../lib/theme";
import { api, ApiError, get, patch, post, put } from "../../lib/api";
import { dateTime } from "../../lib/format";
import { tg } from "../../lib/telegram";
import type { CabinetHome, Me } from "../../lib/types";

const ROLE_TITLE = { client: "Клиент — ЛПР компании", manager: "Клиентский менеджер", analyst: "Аналитик СКБ", admin: "Администратор" };
const SOURCE = { crm: "из CRM", inferred: "выведена по правам в интернет-банке", none: "не указана" };

type Demo = { accounts: { email: string; title: string; description: string }[] };

/** Вход личной учётной записью (например, администратора) из Telegram: этот Telegram привязывается к ней. */
function AccountLogin({ onDone }: { onDone: () => void }) {
  const { linkTelegram } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button className="mt-3" block variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setOpen(true)}>
        Войти по логину и паролю
      </Button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await linkTelegram(email.trim(), password);
      toast.show("Вы вошли по учётной записи");
      onDone();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "Не удалось войти", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card mt-3 space-y-3 p-4" noValidate>
      <div className="text-[15px] font-medium">Личная учётная запись</div>
      <Field label="Email" htmlFor="acc-email">
        <input id="acc-email" className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Пароль" htmlFor="acc-pass">
        <input id="acc-pass" className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" block loading={busy} disabled={!email || !password}>Войти</Button>
      <p className="text-[12px] text-hint">Этот Telegram привяжется к учётке. Вернуться к демо-роли можно здесь же.</p>
    </form>
  );
}

export function ProfileScreen() {
  const me = useMe();
  const { inTelegram, logout, refreshMe, demoPersona } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const client = me.user.role === "client";
  const home = useQuery({ queryKey: ["cabinet-home"], queryFn: () => get<CabinetHome>("/cabinet/home"), enabled: client, staleTime: 60_000 });
  const demo = useQuery({ queryKey: ["demo-accounts"], queryFn: () => get<Demo>("/demo/accounts"), enabled: me.demo_mode, retry: false, staleTime: Infinity });
  const [personaOpen, setPersonaOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode);
  useEffect(() => {
    const sync = () => setTheme(getThemeMode());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);
  const [busyPersona, setBusyPersona] = useState<string | null>(null);
  const [link, setLink] = useState<{ code: string; deep_link: string | null; expires_at: string; bot_username: string | null } | null>(null);

  const settings = useMutation({
    mutationFn: (data: Partial<Me["user"]["settings"]>) => patch("/me/settings", data),
    onSuccess: async () => {
      await refreshMe();
      toast.show("Настройки сохранены");
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : "Не удалось сохранить", "error"),
  });
  const consents = useMutation({
    mutationFn: (data: Partial<CabinetHome["consents"]>) => put<CabinetHome["consents"]>("/cabinet/consents", data),
    onSuccess: (c) => {
      qc.setQueryData<CabinetHome>(["cabinet-home"], (h) => (h ? { ...h, consents: c } : h));
      void qc.invalidateQueries({ queryKey: ["cabinet-home"] });
      toast.show(c.all ? "Маркетинговые предложения отключены" : "Предпочтения сохранены");
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : "Не удалось сохранить", "error"),
  });
  const linkCode = useMutation({
    mutationFn: () => post<{ code: string; deep_link: string | null; expires_at: string; bot_username: string | null }>("/me/telegram/link-code"),
    onSuccess: setLink,
    onError: (e) => toast.show(e instanceof ApiError ? e.message : "Не удалось получить код", "error"),
  });
  const unlink = useMutation({
    mutationFn: (id: number) => api("DELETE", `/me/telegram/${id}`),
    onSuccess: async () => {
      toast.show("Telegram отвязан");
      if (inTelegram) await logout();
      else await refreshMe();
    },
  });

  const s = me.user.settings;
  const c = home.data?.consents;
  const initials = me.user.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("");

  const switchPersona = async (email: string) => {
    setBusyPersona(email);
    try {
      await demoPersona(email);
      setPersonaOpen(false);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Не удалось сменить роль", "error");
    } finally {
      setBusyPersona(null);
    }
  };

  return (
    <Screen title="Профиль">
      <div className="card mt-4 flex items-center gap-4 p-4">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-brand font-display text-[20px] text-white">{initials}</div>
        <div className="min-w-0">
          <div className="text-[17px] font-medium">{me.user.full_name}</div>
          <div className="text-[14px] text-hint">{ROLE_TITLE[me.user.role]}</div>
          <div className="truncate text-[13px] text-hint">{me.user.email}</div>
        </div>
      </div>

      {client && (
        <Section title="Организация">
          {home.isLoading ? <div className="card p-4"><Spinner className="text-brand" /></div> : home.data && (
            <List>
              <Row title={home.data.organization.name} subtitle={[home.data.organization.industry_name, home.data.organization.group].filter(Boolean).join(" · ")} />
              <Row title="Ваша роль" subtitle={`${home.data.role.name} · ${SOURCE[home.data.role.source]}`} />
              <Row title="Клиентский менеджер" subtitle={home.data.organization.manager ?? "Будет назначен"} />
            </List>
          )}
        </Section>
      )}

      <Section title="Уведомления в Telegram">
        <List>
          <Toggle checked={s.notify_telegram} onChange={(v) => settings.mutate({ notify_telegram: v })} disabled={settings.isPending}
            label="Присылать в Telegram" description={me.user.telegram.length ? "Сообщения от бота приходят в этот чат" : "Telegram ещё не подключён"} />
          <Toggle checked={s.notify_applications} onChange={(v) => settings.mutate({ notify_applications: v })} disabled={!s.notify_telegram || settings.isPending}
            label="Статусы заявок и ответы" />
          {!client && <Toggle checked={s.notify_tasks} onChange={(v) => settings.mutate({ notify_tasks: v })} disabled={!s.notify_telegram || settings.isPending} label="Новые задачи" />}
          {client && <Toggle checked={s.notify_offers} onChange={(v) => settings.mutate({ notify_offers: v })} disabled={!s.notify_telegram || settings.isPending}
            label="Персональные предложения" description="Не чаще лимитов банка; можно отключить в любой момент" />}
        </List>
      </Section>

      {client && c && (
        <Section title="Коммуникации банка">
          <List>
            <Toggle checked={!c.all} onChange={(v) => consents.mutate({ all: !v })} disabled={consents.isPending}
              label="Маркетинговые предложения" description="Если выключить — банк не будет присылать предложения ни в одном канале" />
            <Toggle checked={!c.email} onChange={(v) => consents.mutate({ email: !v })} disabled={c.all || consents.isPending} label="По email" />
            <Toggle checked={!c.push} onChange={(v) => consents.mutate({ push: !v })} disabled={c.all || consents.isPending} label="Push и сообщения в Telegram" />
            <Toggle checked={s.adaptive_hints} onChange={(v) => settings.mutate({ adaptive_hints: v })} disabled={settings.isPending}
              label="Подсказки при оформлении" description="Сравнение, «оформить сразу», помощь менеджера, если что-то непонятно" />
          </List>
          <p className="mt-2 px-1 text-[12px] text-hint">Сервисные уведомления о ваших заявках не отключаются: без них нельзя узнать о решении банка.</p>
        </Section>
      )}

      <Section title="Telegram">
        <List>
          {me.user.telegram.length === 0 && <Row title="Не подключён" subtitle="Подключите, чтобы получать статусы и ответы в чате" />}
          {me.user.telegram.map((t) => (
            <Row key={t.id} left={<Send className="size-5 text-blue" />} title={t.username ? `@${t.username}` : "Аккаунт Telegram"} subtitle={`Подключён ${dateTime(t.linked_at)}`}
              right={me.user.role === "admin" ? <Button size="sm" variant="danger" loading={unlink.isPending && unlink.variables === t.id}
                onClick={async () => { if (await tg.confirm("Отвязать этот Telegram? Уведомления перестанут приходить.")) unlink.mutate(t.id); }}>Отвязать</Button> : undefined} />
          ))}
        </List>
        {!inTelegram && (
          <div className="mt-3">
            {link ? (
              <Banner tone="info">
                <div className="font-medium">Код привязки действует 15 минут</div>
                {link.deep_link ? (
                  <a className="mt-2 inline-flex items-center gap-1 font-medium text-link" href={link.deep_link} target="_blank" rel="noopener noreferrer">
                    Открыть @{link.bot_username} <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <div className="mt-1">Отправьте боту команду: <code className="rounded bg-subtle px-1">/start {link.code}</code></div>
                )}
              </Banner>
            ) : (
              <Button block variant="secondary" loading={linkCode.isPending} onClick={() => linkCode.mutate()}>Подключить Telegram</Button>
            )}
          </div>
        )}
      </Section>

      <Section title="Оформление">
        <Segmented ariaLabel="Тема" value={theme} onChange={(v) => { setTheme(v); setThemeMode(v); tg.haptic("select"); }}
          options={[{ value: "auto", label: "Как в Telegram" }, { value: "light", label: "Светлая" }, { value: "dark", label: "Тёмная" }]} />
      </Section>

      <Section title="О приложении">
        <List>
          <Row left={<Info className="size-5 text-hint" />} title="Персонализатор СКБ 1.0" subtitle="MVP · команда 13 · Rizz Banking" />
          <Row left={<ShieldCheck className="size-5 text-hint" />} title="Данные" subtitle="Синтетические датасеты кейса и демо-профили. Роль храним как должность, без ФИО." />
        </List>
      </Section>

      <div className="mt-5 space-y-2">
        {me.demo_mode && inTelegram && demo.data && (
          <Button block variant="ghost" icon={<Repeat className="size-4" />} onClick={() => setPersonaOpen(true)}>Сменить демо-роль</Button>
        )}
        {!inTelegram && <Button block variant="danger" icon={<LogOut className="size-4" />} onClick={() => logout()}>Выйти</Button>}
      </div>

      <Sheet open={personaOpen} onClose={() => setPersonaOpen(false)} title="Демо-роль">
        <div className="space-y-2">
          {demo.data?.accounts.map((a) => (
            <Button key={a.email} block variant={a.email === me.user.email ? "secondary" : "ghost"} loading={busyPersona === a.email} disabled={!!busyPersona}
              onClick={() => switchPersona(a.email)} className="!h-auto flex-col !items-start py-3 text-left">
              <span>{a.title}</span>
              <span className="text-[12px] font-normal text-hint">{a.description}</span>
            </Button>
          ))}
        </div>
        <AccountLogin onDone={() => setPersonaOpen(false)} />
      </Sheet>
    </Screen>
  );
}
