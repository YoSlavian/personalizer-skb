import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Info, KeyRound, LogOut, Repeat, Send } from "../../components/icons";
import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth, useMe } from "../../auth/AuthProvider";
import { type DemoAccount, PersonaRow, sortAccounts } from "../../auth/AuthScreens";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, Field, IconBadge, inputCls, List, Row, Section, Sheet, Skeleton, Toggle } from "../../components/ui";
import { api, ApiError, get, patch, post, put } from "../../lib/api";
import { dateTime } from "../../lib/format";
import { tg } from "../../lib/telegram";
import type { CabinetHome, Me } from "../../lib/types";

const ROLE_TITLE = { client: "Клиент — ЛПР компании", manager: "Клиентский менеджер", analyst: "Аналитик СКБ", admin: "Администратор" };
const SOURCE = { crm: "CRM", inferred: "права в интернет-банке", none: "не указан" };

type Demo = { accounts: DemoAccount[] };

/** Поле ввода внутри шторки: фон шторки — surface, поэтому поле на подложке. */
const sheetInputCls = `${inputCls} bg-subtle!`;

/** Кнопка прямо на фоне экрана: подложка-карточка, иначе в тёмной теме «пилюля» сливается с чёрным фоном. */
const onPageBtn = "bg-surface! active:opacity-80";

/** Строка «подпись — значение» в карточке-списке. */
function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-3">
      <span className="shrink-0 text-[15px] text-hint">{label}</span>
      <span className="min-w-0 text-right text-[15px] font-medium">{children}</span>
    </div>
  );
}

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
      <Button className="mt-4" block variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setOpen(true)}>
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
    <form onSubmit={submit} className="mt-5 space-y-3 animate-fade" noValidate>
      <div className="px-1 font-display text-[15px] uppercase leading-tight">Учётная запись</div>
      <Field label="Email" htmlFor="acc-email">
        <input id="acc-email" className={sheetInputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Пароль" htmlFor="acc-pass">
        <input id="acc-pass" className={sheetInputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" block size="lg" loading={busy} disabled={!email || !password}>Войти</Button>
      <p className="px-1 text-[12px] text-hint">Telegram привяжется к учётной записи. Вернуться к демо-роли можно здесь же.</p>
    </form>
  );
}

export function ProfileScreen() {
  const me = useMe();
  const { inTelegram, logout, refreshMe, demoPersona } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const client = me.user.role === "client";
  const home = useQuery({ queryKey: ["cabinet-home"], queryFn: () => get<CabinetHome>("/cabinet/home"), enabled: client, staleTime: 60_000 });
  const demo = useQuery({ queryKey: ["demo-accounts"], queryFn: () => get<Demo>("/demo/accounts"), enabled: me.demo_mode, retry: false, staleTime: Infinity });
  const [personaOpen, setPersonaOpen] = useState(false);
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
      if (inTelegram) {
        await logout();
        // Экран выбора роли откроется поверх /profile — после входа нужна главная новой роли, а не профиль
        navigate("/", { replace: true });
      } else await refreshMe();
    },
  });

  const s = me.user.settings;
  const c = home.data?.consents;
  const initials = me.user.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const org = home.data?.organization;
  const linked = me.user.telegram.length > 0;
  // Список привязок нужен админу (отвязать) и в браузере (подключить бота); в Mini App остальным он ни к чему
  const showTelegram = me.user.role === "admin" || !inTelegram;
  // Без привязки бот писать некуда: показываем фактическое «выключено», сохранённые значения не трогаем
  const tgOn = linked && s.notify_telegram;

  const switchPersona = async (email: string) => {
    setBusyPersona(email);
    try {
      await demoPersona(email);
      setPersonaOpen(false);
      // Новая роль начинает с главной, а не с профиля прежней
      navigate("/", { replace: true });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Не удалось сменить роль", "error");
    } finally {
      setBusyPersona(null);
    }
  };

  return (
    <Screen title="Профиль">
      <div className="card mt-4 flex items-center gap-3.5 p-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-text font-display text-[20px] text-bg" aria-hidden>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-medium leading-tight">{me.user.full_name}</div>
          {client ? (
            home.data ? (
              <>
                <div className="mt-1 truncate text-[14px]">{home.data.role.name}</div>
                <div className="truncate text-[13px] text-hint">{home.data.organization.name}</div>
              </>
            ) : (
              <div className="mt-2 space-y-1.5" aria-hidden>
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            )
          ) : (
            <>
              <div className="mt-1 truncate text-[14px]">{ROLE_TITLE[me.user.role]}</div>
              <div className="truncate text-[13px] text-hint">{me.user.email}</div>
            </>
          )}
        </div>
      </div>

      {client && (home.isLoading || org) && (
        <Section title="Компания">
          {org && home.data ? (
            <List>
              <KV label="Отрасль">{org.industry_name}</KV>
              {org.group && <KV label="Группа">{org.group}</KV>}
              <KV label="Источник роли">{SOURCE[home.data.role.source]}</KV>
              <KV label="Менеджер">{org.manager ?? "Будет назначен"}</KV>
            </List>
          ) : (
            <div className="card divide-y divide-sep overflow-hidden" aria-busy="true" aria-label="Загрузка">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex min-h-11 items-center justify-between px-4 py-3">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="Уведомления">
        <List>
          <Toggle checked={tgOn} onChange={(v) => settings.mutate({ notify_telegram: v })} disabled={!linked || settings.isPending}
            label="Дублировать в Telegram" description={linked ? "В чат с ботом" : showTelegram ? "Подключите Telegram ниже" : undefined} />
          <Toggle checked={tgOn && s.notify_applications} onChange={(v) => settings.mutate({ notify_applications: v })} disabled={!tgOn || settings.isPending}
            label="Статусы заявок" />
          {!client && <Toggle checked={tgOn && s.notify_tasks} onChange={(v) => settings.mutate({ notify_tasks: v })} disabled={!tgOn || settings.isPending} label="Новые задачи" />}
          {client && <Toggle checked={tgOn && s.notify_offers} onChange={(v) => settings.mutate({ notify_offers: v })} disabled={!tgOn || settings.isPending}
            label="Персональные предложения" description="В пределах лимитов частоты" />}
        </List>
      </Section>

      {showTelegram && (
        <Section title="Telegram">
          <List>
            {!linked && (
              <Row left={<IconBadge tone="neutral"><Send className="size-5" /></IconBadge>} title="Не подключён" subtitle="Статусы и ответы — в чате с ботом" />
            )}
            {me.user.telegram.map((t) => (
              <Row key={t.id} left={<IconBadge tone="neutral"><Send className="size-5" /></IconBadge>} title={t.username ? `@${t.username}` : "Аккаунт Telegram"}
                subtitle={`Подключён ${dateTime(t.linked_at)}`}
                right={me.user.role === "admin" ? <Button size="sm" variant="danger" loading={unlink.isPending && unlink.variables === t.id}
                  onClick={async () => { if (await tg.confirm("Отвязать этот Telegram? Уведомления перестанут приходить.")) unlink.mutate(t.id); }}>Отвязать</Button> : undefined} />
            ))}
          </List>
          {!inTelegram && (
            <div className="mt-3">
              {link ? (
                <Banner tone="info">
                  <div className="font-medium">Код действует 15 минут</div>
                  {link.deep_link ? (
                    <a className="mt-1.5 inline-flex min-h-11 items-center gap-1 font-medium text-link" href={link.deep_link} target="_blank" rel="noopener noreferrer">
                      Открыть @{link.bot_username} <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    <div className="mt-1">Отправьте боту: <code className="rounded-md bg-subtle px-1.5 py-0.5">/start {link.code}</code></div>
                  )}
                </Banner>
              ) : (
                <Button block variant="secondary" className={onPageBtn} icon={<Send className="size-4" />} loading={linkCode.isPending} onClick={() => linkCode.mutate()}>Подключить Telegram</Button>
              )}
            </div>
          )}
        </Section>
      )}

      {/* Согласия — на всю компанию; выше — личная доставка в Telegram */}
      {client && c && (
        <Section title="Реклама">
          <List>
            <Toggle checked={!c.all} onChange={(v) => consents.mutate({ all: !v })} disabled={consents.isPending}
              label="Все рассылки" description="Для всей компании" />
            <Toggle checked={!c.email} onChange={(v) => consents.mutate({ email: !v })} disabled={c.all || consents.isPending} label="По email" />
            <Toggle checked={!c.push} onChange={(v) => consents.mutate({ push: !v })} disabled={c.all || consents.isPending} label="Push" />
          </List>
        </Section>
      )}

      <Section title="Приложение">
        <List>
          {client && (
            <Toggle checked={s.adaptive_hints} onChange={(v) => settings.mutate({ adaptive_hints: v })} disabled={settings.isPending}
              label="Подсказки при оформлении" description="Сравнение, помощь менеджера" />
          )}
          <Row left={<IconBadge tone="neutral"><Info className="size-5" /></IconBadge>} title="Персонализатор СКБ 1.0" subtitle="MVP · команда 13 · Rizz Banking" />
        </List>
      </Section>

      <div className="mt-6 space-y-2">
        {me.demo_mode && inTelegram && demo.data && (
          <Button block size="lg" variant="secondary" className={onPageBtn} icon={<Repeat className="size-4" />} onClick={() => setPersonaOpen(true)}>Сменить демо-роль</Button>
        )}
        {!inTelegram && <Button block size="lg" variant="danger" className={onPageBtn} icon={<LogOut className="size-4" />} onClick={() => logout()}>Выйти</Button>}
      </div>

      <Sheet open={personaOpen} onClose={() => setPersonaOpen(false)} title="Демо-роль">
        {demo.data && (
          // Вставная группа без -mx-4: у скролл-контейнера шторки нет своих полей, иначе список ездит вбок и режется слева
          <div className="divide-y divide-sep overflow-hidden rounded-[18px] bg-subtle">
            {sortAccounts(demo.data.accounts).map((a) => (
              <PersonaRow key={a.email} account={a} inset highlight={false} current={a.email === me.user.email} busy={busyPersona === a.email}
                disabled={!!busyPersona} onClick={() => switchPersona(a.email)} />
            ))}
          </div>
        )}
        <AccountLogin onDone={() => setPersonaOpen(false)} />
      </Sheet>
    </Screen>
  );
}
