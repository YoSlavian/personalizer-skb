import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { Building2, ChatCircle, FileEdit, Info, Lock, UserRound } from "../../components/icons";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { Screen } from "../../components/Layout";
import { PrimaryAction } from "../../components/PrimaryAction";
import { useToast } from "../../components/toast";
import { Banner, Button, cx, ErrorState, Field, IconBadge, inputCls, List, Row, Section, Sheet, Skeleton, Spinner, StatusPill, Toggle } from "../../components/ui";
import { ApiError, get, newIdempotencyKey, post } from "../../lib/api";
import { date, dateTime, mln } from "../../lib/format";
import { isTelegram, tg } from "../../lib/telegram";
import type { ApplicationDetail as AppDetail, AppStatus } from "../../lib/types";
import { ago } from "./AppRow";
import { Timeline } from "./Timeline";

type Action = { to: AppStatus; label: string; variant: "primary" | "secondary" | "danger" | "ghost"; needsComment?: boolean; confirm?: string; prompt?: string };

function actionsFor(role: string, status: AppStatus, isAuthor: boolean): Action[] {
  if (role === "client") {
    if (status === "draft" && isAuthor) return [{ to: "cancelled", label: "Удалить черновик", variant: "danger", confirm: "Удалить черновик заявки?" }];
    if (status === "submitted") return [{ to: "cancelled", label: "Отменить заявку", variant: "danger", confirm: "Отменить заявку? Менеджер получит уведомление." }];
    if (status === "needs_info")
      return [
        { to: "in_review", label: "Отправить уточнение", variant: "primary", needsComment: true, prompt: "Ответ менеджеру" },
        { to: "cancelled", label: "Отменить заявку", variant: "danger", confirm: "Отменить заявку?" },
      ];
    return [];
  }
  if (role === "analyst") return [];
  if (status === "submitted")
    return [
      { to: "in_review", label: "Взять на рассмотрение", variant: "primary" },
      { to: "declined", label: "Отказать", variant: "danger", needsComment: true, prompt: "Причина отказа для клиента" },
    ];
  if (status === "in_review")
    return [
      { to: "approved", label: "Одобрить", variant: "primary", prompt: "Комментарий для клиента (необязательно)" },
      { to: "needs_info", label: "Запросить уточнения", variant: "secondary", needsComment: true, prompt: "Что нужно уточнить" },
      { to: "declined", label: "Отказать", variant: "danger", needsComment: true, prompt: "Причина отказа для клиента" },
    ];
  if (status === "needs_info")
    return [
      { to: "in_review", label: "Вернуть в работу", variant: "secondary" },
      { to: "declined", label: "Отказать", variant: "danger", needsComment: true, prompt: "Причина отказа для клиента" },
    ];
  return [];
}

/** Шаги, которые заявке ещё предстоит пройти, — бледными точками в истории. */
const FUTURE: Record<AppStatus, string[]> = {
  draft: ["Отправлена", "На рассмотрении", "Решение"],
  submitted: ["На рассмотрении", "Решение"],
  in_review: ["Решение"],
  needs_info: ["На рассмотрении", "Решение"],
  approved: [],
  declined: [],
  cancelled: [],
};

export function ApplicationDetail() {
  const { id } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["application", Number(id)];
  const q = useQuery({ queryKey: key, queryFn: () => get<AppDetail>(`/applications/${id}`) });
  const [sheet, setSheet] = useState<Action | null>(null);
  const [sheetText, setSheetText] = useState("");
  // Для какого перехода набран sheetText: черновик одного действия не должен уйти комментарием другого
  const sheetTextFor = useRef<AppStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [internal, setInternal] = useState(false);
  const commentKey = useRef(newIdempotencyKey());
  const sheetOpenedAt = useRef(0);

  const setData = (data: AppDetail) => {
    qc.setQueryData(key, data);
    void qc.invalidateQueries({ queryKey: ["applications"] });
    void qc.invalidateQueries({ queryKey: ["cabinet-home"] });
  };

  const status = useMutation({
    mutationFn: ({ to, comment }: { to: AppStatus; comment?: string }) => post<AppDetail>(`/applications/${id}/status`, { status: to, comment: comment || null }),
    onSuccess: (data) => {
      setData(data);
      setSheet(null);
      setSheetText("");
      toast.show(`Статус: ${data.status_name}`);
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : "Не удалось изменить статус", "error"),
  });
  const comment = useMutation({
    mutationFn: () => post<AppDetail>(`/applications/${id}/comments`, { body: msg.trim(), internal }, { idempotencyKey: commentKey.current }),
    onSuccess: (data) => {
      setData(data);
      setMsg("");
      commentKey.current = newIdempotencyKey();
      tg.haptic("success");
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : "Комментарий не отправлен", "error"),
  });
  const assign = useMutation({
    mutationFn: () => post<AppDetail>(`/applications/${id}/assign`, {}),
    onSuccess: (data) => { setData(data); toast.show("Заявка назначена на вас"); },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : "Не удалось назначить", "error"),
  });

  const run = async (a: Action) => {
    if (status.isPending) return;
    if (a.needsComment || a.prompt) {
      // Причина отказа не должна оказаться комментарием к одобрению: текст и ошибка поля — только своего действия
      if (sheetTextFor.current !== a.to) {
        sheetTextFor.current = a.to;
        setSheetText("");
        status.reset();
      }
      sheetOpenedAt.current = Date.now();
      setSheet(a);
      return;
    }
    if (a.confirm && !(await tg.confirm(a.confirm))) return;
    status.mutate({ to: a.to });
  };

  // Загрузка и ошибка — тоже внутри Screen: в браузере у них есть «‹ Назад» и смена темы, как у самой заявки
  if (q.isLoading)
    return (
      <Screen
        title={<span className="skeleton block h-8 w-2/3" aria-hidden />}
        subtitle={<span className="skeleton inline-block h-4 w-1/3 align-middle" aria-hidden />}
      >
        <div className="mt-4 space-y-3" aria-busy="true" aria-label="Загрузка">
          <Skeleton className="h-[132px] rounded-[22px]" />
          <Skeleton className="h-[120px] rounded-[22px]" />
          <Skeleton className="h-[160px] rounded-[22px]" />
        </div>
      </Screen>
    );
  if (q.isError)
    return (
      <Screen title="Заявка">
        <div className="pt-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
      </Screen>
    );
  const a = q.data!;
  const role = me.user.role;
  const staff = role !== "client";
  const actions = actionsFor(role, a.status, a.author?.id === me.user.id);
  // В Telegram главное действие — нативная MainButton внизу окна; остальные (отказ, уточнения) остаются на странице
  const inTelegram = isTelegram();
  const primary = inTelegram ? actions.find((x) => x.variant === "primary") : undefined;
  const inPage = primary ? actions.filter((x) => x !== primary) : actions;
  const submitSheet = () => {
    if (!sheet) return;
    // MainButton при открытии листа остаётся на том же месте: второй тап двойного нажатия не должен сразу отправить решение
    if (inTelegram && Date.now() - sheetOpenedAt.current < 600) return;
    status.mutate({ to: sheet.to, comment: sheetText.trim() });
  };
  const closed = ["approved", "declined", "cancelled"].includes(a.status);
  const longTitle = a.product_name.length > 18;
  const canComment = !["cancelled"].includes(a.status) && role !== "analyst";
  // Обещаем Telegram, только если он привязан и уведомления туда включены; иначе — уведомления в приложении
  const viaTelegram = me.user.telegram.length > 0 && me.user.settings.notify_telegram;

  return (
    <Screen
      title={<span lang="ru" className={cx("block hyphens-manual break-words", longTitle && "text-[26px]")}>{a.product_name}</span>}
      subtitle={`${a.number} · создана ${date(a.created_at)}`}
    >
      {/* Сводка: сумма крупно, статус, срок и решение */}
      <div className="card mt-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] text-hint">Сумма</div>
            <div className="mt-0.5 font-display text-[34px] leading-none tabular">{mln(a.amount_rub)}</div>
          </div>
          <StatusPill status={a.status} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-sep pt-3">
          <div>
            <div className="text-[12px] text-hint">Срок</div>
            <div className="mt-0.5 font-display text-[18px] tabular">{a.term_months} мес.</div>
          </div>
          <div>
            <div className="text-[12px] text-hint">{a.decided_at ? "Решение" : "Обновлена"}</div>
            <div className="mt-0.5 whitespace-nowrap font-display text-[18px] tabular">{a.decided_at ? date(a.decided_at) : ago(a.updated_at, true)}</div>
          </div>
        </div>
      </div>

      {a.status === "needs_info" && role === "client" && (
        <div className="mt-3">
          <Banner tone="warn" icon={<Info className="size-4" weight="fill" />}>Менеджеру нужны уточнения — ответьте в переписке</Banner>
        </div>
      )}
      {a.status === "draft" && role === "client" && (
        <button type="button" onClick={() => navigate(`/journey?product=${a.product_code}&draft=${a.id}`)}
          className="card mt-3 flex w-full items-center gap-3 p-3 pr-4 text-left transition-transform active:scale-[0.99]">
          <IconBadge><FileEdit className="size-5" weight="fill" /></IconBadge>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">Продолжить оформление</div>
            <div className="text-[13px] text-hint">Черновик ещё не отправлен</div>
          </div>
        </button>
      )}

      {inPage.length > 0 && (
        <div className="mt-3 grid gap-2">
          {inPage.map((x) => (
            <Button key={x.to + x.label} variant={x.variant} block loading={status.isPending && status.variables?.to === x.to} disabled={status.isPending} onClick={() => run(x)}>
              {x.label}
            </Button>
          ))}
        </div>
      )}
      {/* Пока открыт лист статуса, MainButton принадлежит ему: две PrimaryAction разом сработали бы на одно нажатие */}
      {primary && !sheet && (
        <PrimaryAction text={primary.label} onClick={() => void run(primary)} disabled={status.isPending}
          loading={status.isPending && status.variables?.to === primary.to} />
      )}

      <Section title="Участники">
        <List>
          {staff && (
            <Row onClick={() => navigate(`/clients/${a.organization.id}`)} left={<IconBadge tone="neutral"><Building2 className="size-5" /></IconBadge>}
              title={a.organization.name} subtitle={a.organization.industry_name} />
          )}
          <Row left={<IconBadge tone="neutral"><UserRound className="size-5" /></IconBadge>} title={a.assignee ? a.assignee.full_name : "Менеджер ещё не назначен"} subtitle="Клиентский менеджер"
            right={staff && role !== "analyst" && a.assignee?.id !== me.user.id && !closed
              ? <Button size="sm" variant="secondary" loading={assign.isPending} onClick={() => assign.mutate()}>Взять</Button> : undefined} />
          {a.comment && <Row left={<IconBadge tone="neutral"><ChatCircle className="size-5" /></IconBadge>} title="Комментарий клиента" subtitle={a.comment} />}
          {a.decided_at && <Row title="Решение принято" right={<span className="text-[14px] tabular text-hint">{dateTime(a.decided_at)}</span>} />}
        </List>
      </Section>

      <Section title="История">
        <Timeline items={a.history} future={FUTURE[a.status]} />
      </Section>

      <Section title="Переписка">
        <div className="space-y-2">
          {a.comments.length === 0 && (
            <div className="card px-4 py-5 text-center text-[14px] text-hint">Сообщений пока нет. {viaTelegram ? "Ответ придёт в Telegram" : "Ответ появится в уведомлениях"}</div>
          )}
          {a.comments.map((c) => {
            const mine = c.author?.id === me.user.id;
            return (
              <div key={c.id} className={cx("flex animate-fade", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cx(
                    "max-w-[85%] rounded-[20px] px-3.5 py-2.5",
                    mine ? "rounded-br-[6px]" : "rounded-bl-[6px]",
                    c.internal ? "border border-dashed border-hint/60 bg-subtle text-text" : mine ? "bg-text text-bg" : "bg-surface text-text",
                  )}
                >
                  {c.internal && (
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-hint"><Lock className="size-3" weight="fill" /> Внутренний — клиент не видит</div>
                  )}
                  <div className="whitespace-pre-wrap break-words text-[15px] leading-snug">{c.body}</div>
                  <div className={cx("mt-1 text-[11px]", mine && !c.internal ? "opacity-60" : "text-hint")}>
                    {mine ? "Вы" : c.author?.full_name ?? "Система"} · {dateTime(c.created_at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {canComment && (
          <div className="card mt-3 p-2">
            <div className="flex items-end gap-2">
              <textarea
                className="max-h-40 min-h-11 w-full flex-1 resize-none rounded-[18px] bg-subtle px-4 py-2.5 text-[15px] leading-snug outline-none [field-sizing:content] placeholder:text-hint focus:ring-2 focus:ring-brand/40"
                placeholder="Сообщение" value={msg} maxLength={4000} rows={1}
                onChange={(e) => setMsg(e.target.value)} aria-label="Текст сообщения" />
              <button type="button" aria-label="Отправить" disabled={!msg.trim() || comment.isPending}
                onClick={() => !comment.isPending && comment.mutate()}
                className={cx("flex size-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] active:scale-95 disabled:active:scale-100",
                  msg.trim() ? "bg-brand text-white" : "bg-subtle text-hint")}>
                {comment.isPending ? <Spinner /> : <PaperPlaneRight className="size-5" weight="fill" />}
              </button>
            </div>
            {staff && <div className="-mx-2 -mb-1"><Toggle checked={internal} onChange={setInternal} label="Внутренний комментарий" description="Виден только сотрудникам банка" /></div>}
          </div>
        )}
      </Section>

      <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.label}>
        {sheet && (
          <div className="space-y-3">
            <Field label={sheet.prompt ?? "Комментарий"} htmlFor="sheet-text" error={sheet.needsComment && status.error instanceof ApiError ? status.error.fieldErrors.comment : undefined}>
              <textarea id="sheet-text" className={cx(inputCls, "min-h-28 resize-none bg-subtle!")} value={sheetText} maxLength={2000} onChange={(e) => setSheetText(e.target.value)} autoFocus />
            </Field>
            {inTelegram ? (
              <PrimaryAction text={sheet.label} onClick={submitSheet} disabled={!!sheet.needsComment && !sheetText.trim()} loading={status.isPending} />
            ) : (
              <Button block size="lg" variant={sheet.variant === "danger" ? "dark" : "primary"} disabled={!!sheet.needsComment && !sheetText.trim()} loading={status.isPending}
                onClick={submitSheet}>
                {sheet.label}
              </Button>
            )}
            {sheet.needsComment && (
              <p className="text-center text-[12px] text-hint">
                {role === "client" ? "Менеджер увидит ответ и получит уведомление" : "Клиент увидит комментарий и получит уведомление"}
              </p>
            )}
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
