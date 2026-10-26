import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileText, UserRound } from "../../components/icons";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, cx, ErrorState, Field, IconBadge, inputCls, List, Row, Section, Sheet, Skeleton, Tag, TaskPill } from "../../components/ui";
import { ApiError, get, post } from "../../lib/api";
import { dateTime, relative } from "../../lib/format";
import { tg } from "../../lib/telegram";
import type { TaskDetail as TD, TaskStatus } from "../../lib/types";
import { IndustryBadge } from "../analyst/Clients";
import { Timeline } from "../shared/Timeline";
import { TaskBadge, taskDescription } from "./Tasks";

const PRIORITY = { high: "Высокий приоритет", normal: "Обычный приоритет", low: "Низкий приоритет" };

function TaskSkeleton() {
  return (
    <div className="pt-5" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="mt-2 h-4 w-1/3" />
      <Skeleton className="mt-5 h-[168px] rounded-[22px]" />
      <Skeleton className="mt-5 h-[128px] rounded-[22px]" />
    </div>
  );
}

export function TaskDetail() {
  const { id } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["task", Number(id)];
  const q = useQuery({ queryKey: key, queryFn: () => get<TD>(`/tasks/${id}`) });
  const [doneOpen, setDoneOpen] = useState(false);
  const [result, setResult] = useState("");
  const resultRef = useRef<HTMLTextAreaElement>(null);
  // Sheet при открытии фокусирует себя (после autoFocus) — фокус в поле ставим следом
  useEffect(() => {
    if (!doneOpen) return;
    const raf = requestAnimationFrame(() => resultRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [doneOpen]);

  const change = useMutation({
    mutationFn: ({ to, comment }: { to: TaskStatus; comment?: string }) => post<TD>(`/tasks/${id}/status`, { status: to, comment: comment || null }),
    onSuccess: (t) => {
      qc.setQueryData(key, t);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setDoneOpen(false);
      setResult("");
      toast.show(t.status === "done" ? "Задача выполнена" : `Статус: ${t.status_name}`);
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : "Не удалось изменить статус", "error"),
  });

  if (q.isLoading) return <TaskSkeleton />;
  if (q.isError) return <div className="pt-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const t = q.data!;
  const canAct = me.user.role !== "analyst" && (t.assignee === null || t.assignee.id === me.user.id || me.user.role === "admin");
  const needsResult = t.kind === "update_crm_role";
  const active = t.status === "open" || t.status === "in_progress";
  const why = taskDescription(t.description, true);

  return (
    <Screen
      title={<span lang="ru" className="block hyphens-auto break-words">{t.kind_name}</span>}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {`Задача #${t.id} · создана ${relative(t.created_at)}`}
          <TaskPill status={t.status} />
        </span>
      }>
      {t.overdue && active && (
        <div className="mt-4">
          <Banner tone="brand" icon={<Clock className="size-5 text-brand" weight="fill" />}>
            Срок истёк {relative(t.due_at)} — клиент ждёт контакта
          </Banner>
        </div>
      )}

      <div className="card mt-4 p-4">
        <div className="flex items-start gap-3">
          <TaskBadge t={t} />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-hint">Что сделать</div>
            <div className="mt-0.5 text-[17px] font-medium leading-snug">{t.title}</div>
          </div>
        </div>
        {why && (
          <div className="mt-3 rounded-[18px] bg-subtle px-3.5 py-3">
            <div className="text-[12px] text-hint">Почему создана</div>
            <p className="mt-0.5 text-[14px] leading-snug">{why}</p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className={cx("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap",
            t.overdue && active ? "bg-brand-soft text-brand" : "bg-subtle text-text")}>
            <Clock className="size-3.5" aria-hidden />
            {t.due_at ? `до ${dateTime(t.due_at)}` : "Без срока"}
          </span>
          <Tag tone={t.priority === "high" ? "brand" : "neutral"}>{PRIORITY[t.priority]}</Tag>
        </div>
      </div>

      {t.result && (
        <Section title="Результат">
          <div className="card flex gap-3 px-4 py-3.5">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" weight="fill" aria-hidden />
            <p className="min-w-0 flex-1 text-[15px] leading-snug">{t.result}</p>
          </div>
        </Section>
      )}

      {canAct && (
        <div className="mt-4 grid gap-2">
          {t.status === "open" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" loading={change.isPending && change.variables?.to === "in_progress"} onClick={() => change.mutate({ to: "in_progress" })}>Взять в работу</Button>
              <Button size="lg" variant="secondary" onClick={() => setDoneOpen(true)}>Выполнено</Button>
            </div>
          ) : t.status === "in_progress" ? (
            <Button size="lg" block onClick={() => setDoneOpen(true)}>Выполнено</Button>
          ) : null}
          {active && (
            <Button block variant="danger" disabled={change.isPending}
              onClick={async () => { if (await tg.confirm("Отменить задачу?")) change.mutate({ to: "cancelled" }); }}>Отменить задачу</Button>
          )}
          {(t.status === "done" || t.status === "cancelled") && (
            <Button block variant="ghost" loading={change.isPending} onClick={() => change.mutate({ to: t.status === "done" ? "in_progress" : "open" })}>Вернуть в работу</Button>
          )}
        </div>
      )}

      <Section title="Клиент">
        <List>
          <Row left={<IndustryBadge industry={t.organization.industry} />} title={t.organization.name} subtitle={t.organization.industry_name}
            onClick={() => navigate(`/clients/${t.organization.id}`)} />
          {t.application_id && (
            <Row left={<IconBadge tone="neutral"><FileText className="size-5" /></IconBadge>} title="Связанная заявка" subtitle="Открыть заявку клиента"
              onClick={() => navigate(`/applications/${t.application_id}`)} />
          )}
          <Row left={<IconBadge tone="neutral"><UserRound className="size-5" /></IconBadge>} title="Исполнитель"
            right={<span className="text-[14px] text-hint">{t.assignee?.full_name ?? "Не назначен"}</span>} />
        </List>
      </Section>

      {t.history.length > 0 && (
        <Section title="История">
          <Timeline items={t.history} />
        </Section>
      )}

      <Sheet open={doneOpen} onClose={() => setDoneOpen(false)} title="Результат задачи">
        <div className="space-y-3">
          <Field label={needsResult ? "Какую роль уточнили в CRM (обязательно)" : "Коротко, что сделано"} htmlFor="result">
            <textarea id="result" ref={resultRef} className={cx(inputCls, "min-h-28 resize-none bg-subtle!")} value={result} maxLength={2000} onChange={(e) => setResult(e.target.value)}
              placeholder={needsResult ? "Например: ФД, подтверждено на звонке" : "Например: клиент получил расчёт, ждём документы"} />
          </Field>
          <Button block size="lg" disabled={needsResult && !result.trim()} loading={change.isPending} onClick={() => change.mutate({ to: "done", comment: result.trim() })}>Отметить выполненной</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
