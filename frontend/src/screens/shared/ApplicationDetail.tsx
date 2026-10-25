import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Lock, Send, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, cx, ErrorState, Field, inputCls, List, Row, Section, Sheet, Skeleton, StatusPill, Toggle } from "../../components/ui";
import { ApiError, get, newIdempotencyKey, post } from "../../lib/api";
import { date, dateTime, mln } from "../../lib/format";
import { tg } from "../../lib/telegram";
import type { ApplicationDetail as AppDetail, AppStatus } from "../../lib/types";
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
  const [msg, setMsg] = useState("");
  const [internal, setInternal] = useState(false);
  const commentKey = useRef(newIdempotencyKey());

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
      setSheet(a);
      return;
    }
    if (a.confirm && !(await tg.confirm(a.confirm))) return;
    status.mutate({ to: a.to });
  };

  if (q.isLoading) return <div className="space-y-3 pt-6"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-40 rounded-[18px]" /><Skeleton className="h-32 rounded-[18px]" /></div>;
  if (q.isError) return <div className="pt-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const a = q.data!;
  const role = me.user.role;
  const staff = role !== "client";
  const actions = actionsFor(role, a.status, a.author?.id === me.user.id);

  return (
    <Screen title={a.product_name} subtitle={`${a.number} · создана ${date(a.created_at)}`} right={<StatusPill status={a.status} />}>
      {a.status === "needs_info" && role === "client" && (
        <div className="mt-4"><Banner tone="warn">Менеджеру нужны уточнения — ответьте в переписке ниже или кнопкой «Отправить уточнение».</Banner></div>
      )}
      {a.status === "draft" && role === "client" && (
        <div className="mt-4"><Banner tone="info">Это черновик: заявка ещё не отправлена. <button type="button" className="font-medium text-link" onClick={() => navigate(`/journey?product=${a.product_code}&draft=${a.id}`)}>Продолжить оформление</button></Banner></div>
      )}
      <Section title="Параметры">
        <List>
          <Row title="Сумма" right={<span className="font-medium tabular">{mln(a.amount_rub)}</span>} />
          <Row title="Срок" right={<span className="font-medium">{a.term_months} мес.</span>} />
          {staff && <Row onClick={() => navigate(`/clients/${a.organization.id}`)} left={<Building2 className="size-5 text-hint" />} title={a.organization.name} subtitle={a.organization.industry_name} />}
          <Row left={<UserRound className="size-5 text-hint" />} title={a.assignee ? a.assignee.full_name : "Менеджер ещё не назначен"} subtitle="Ответственный · клиентский менеджер"
            right={staff && role !== "analyst" && a.assignee?.id !== me.user.id && !["approved", "declined", "cancelled"].includes(a.status)
              ? <Button size="sm" variant="secondary" loading={assign.isPending} onClick={() => assign.mutate()}>Взять</Button> : undefined} />
          {a.comment && <Row title="Комментарий клиента" subtitle={a.comment} />}
          {a.decided_at && <Row title="Решение принято" right={<span className="text-[14px]">{dateTime(a.decided_at)}</span>} />}
        </List>
      </Section>

      {actions.length > 0 && (
        <div className="mt-4 grid gap-2">
          {actions.map((x) => (
            <Button key={x.to + x.label} variant={x.variant} block loading={status.isPending && status.variables?.to === x.to} disabled={status.isPending} onClick={() => run(x)}>
              {x.label}
            </Button>
          ))}
        </div>
      )}

      <Section title="История">
        <Timeline items={a.history} />
      </Section>

      <Section title="Переписка">
        <div className="space-y-2">
          {a.comments.length === 0 && <p className="px-1 text-[14px] text-hint">Сообщений пока нет. Задайте вопрос — ответ придёт уведомлением в Telegram.</p>}
          {a.comments.map((c) => {
            const mine = c.author?.id === me.user.id;
            return (
              <div key={c.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[85%] rounded-2xl px-3.5 py-2.5", c.internal ? "border border-dashed border-warning bg-[color-mix(in_srgb,var(--warning)_10%,var(--surface))]" : mine ? "bg-brand text-white" : "card")}>
                  {c.internal && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-[#b06f00]"><Lock className="size-3" /> Внутренний — клиент не видит</div>}
                  <div className="whitespace-pre-wrap text-[14px]">{c.body}</div>
                  <div className={cx("mt-1 text-[11px]", mine && !c.internal ? "text-white/75" : "text-hint")}>{c.author?.full_name ?? "Система"} · {dateTime(c.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
        {!["cancelled"].includes(a.status) && role !== "analyst" && (
          <div className="card mt-3 p-3">
            <textarea className={cx(inputCls, "min-h-20 resize-none shadow-none bg-subtle")} placeholder="Сообщение" value={msg} maxLength={4000}
              onChange={(e) => setMsg(e.target.value)} aria-label="Текст сообщения" />
            {staff && <div className="-mx-4"><Toggle checked={internal} onChange={setInternal} label="Внутренний комментарий" description="Виден только сотрудникам банка" /></div>}
            <Button className="mt-2" block icon={<Send className="size-4" />} disabled={!msg.trim()} loading={comment.isPending} onClick={() => !comment.isPending && comment.mutate()}>
              Отправить
            </Button>
          </div>
        )}
      </Section>

      <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.label}>
        {sheet && (
          <div className="space-y-3">
            <Field label={sheet.prompt ?? "Комментарий"} htmlFor="sheet-text" error={sheet.needsComment && status.error instanceof ApiError ? status.error.fieldErrors.comment : undefined}>
              <textarea id="sheet-text" className={cx(inputCls, "min-h-28 resize-none bg-subtle shadow-none")} value={sheetText} maxLength={2000} onChange={(e) => setSheetText(e.target.value)} autoFocus />
            </Field>
            <Button block variant={sheet.variant === "danger" ? "dark" : "primary"} disabled={!!sheet.needsComment && !sheetText.trim()} loading={status.isPending}
              onClick={() => status.mutate({ to: sheet.to, comment: sheetText.trim() })}>
              {sheet.label}
            </Button>
            {sheet.needsComment && <p className="text-[12px] text-hint">Комментарий увидит клиент и получит уведомление.</p>}
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
