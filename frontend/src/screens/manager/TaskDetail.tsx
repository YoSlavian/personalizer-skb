import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarClock, FileText, Flag } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, cx, ErrorState, Field, inputCls, List, Row, Section, Sheet, Skeleton, TaskPill } from "../../components/ui";
import { ApiError, get, post } from "../../lib/api";
import { dateTime, relative } from "../../lib/format";
import { tg } from "../../lib/telegram";
import type { TaskDetail as TD, TaskStatus } from "../../lib/types";
import { Timeline } from "../shared/Timeline";

const PRIORITY = { high: "Высокий", normal: "Обычный", low: "Низкий" };

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

  if (q.isLoading) return <div className="space-y-3 pt-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 rounded-[18px]" /></div>;
  if (q.isError) return <div className="pt-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const t = q.data!;
  const canAct = me.user.role !== "analyst" && (t.assignee === null || t.assignee.id === me.user.id || me.user.role === "admin");
  const needsResult = t.kind === "update_crm_role";

  return (
    <Screen title={t.title} subtitle={t.kind_name} right={<TaskPill status={t.status} />}>
      {t.overdue && <div className="mt-4"><Banner tone="warn">Срок истёк {relative(t.due_at)}. Клиент ждёт контакта.</Banner></div>}
      <Section title="Детали">
        <List>
          <Row left={<Building2 className="size-5 text-hint" />} title={t.organization.name} subtitle={t.organization.industry_name} onClick={() => navigate(`/clients/${t.organization.id}`)} />
          <Row left={<CalendarClock className="size-5 text-hint" />} title="Срок" right={<span className={cx("text-[14px]", t.overdue && "font-medium text-danger")}>{t.due_at ? dateTime(t.due_at) : "Без срока"}</span>} />
          <Row left={<Flag className="size-5 text-hint" />} title="Приоритет" right={<span className="text-[14px]">{PRIORITY[t.priority]}</span>} />
          {t.application_id && <Row left={<FileText className="size-5 text-hint" />} title="Связанная заявка" onClick={() => navigate(`/applications/${t.application_id}`)} />}
          <Row title="Исполнитель" right={<span className="text-[14px]">{t.assignee?.full_name ?? "Не назначен"}</span>} />
        </List>
      </Section>
      {t.description && (
        <Section title="Почему создана">
          <div className="card px-4 py-3 text-[15px]">{t.description}</div>
        </Section>
      )}
      {t.result && (
        <Section title="Результат">
          <div className="card px-4 py-3 text-[15px]">{t.result}</div>
        </Section>
      )}

      {canAct && (
        <div className="mt-4 grid gap-2">
          {t.status === "open" && <Button block loading={change.isPending && change.variables?.to === "in_progress"} onClick={() => change.mutate({ to: "in_progress" })}>Взять в работу</Button>}
          {(t.status === "open" || t.status === "in_progress") && (
            <Button block variant={t.status === "open" ? "secondary" : "primary"} onClick={() => setDoneOpen(true)}>Выполнено</Button>
          )}
          {(t.status === "open" || t.status === "in_progress") && (
            <Button block variant="danger" disabled={change.isPending}
              onClick={async () => { if (await tg.confirm("Отменить задачу?")) change.mutate({ to: "cancelled" }); }}>Отменить</Button>
          )}
          {(t.status === "done" || t.status === "cancelled") && (
            <Button block variant="ghost" loading={change.isPending} onClick={() => change.mutate({ to: t.status === "done" ? "in_progress" : "open" })}>Вернуть в работу</Button>
          )}
        </div>
      )}

      <Section title="История">
        <Timeline items={t.history} />
      </Section>

      <Sheet open={doneOpen} onClose={() => setDoneOpen(false)} title="Результат задачи">
        <div className="space-y-3">
          <Field label={needsResult ? "Какую роль уточнили в CRM (обязательно)" : "Коротко, что сделано"} htmlFor="result">
            <textarea id="result" className={cx(inputCls, "min-h-28 resize-none bg-subtle shadow-none")} value={result} maxLength={2000} onChange={(e) => setResult(e.target.value)} autoFocus
              placeholder={needsResult ? "Например: ФД, подтверждено на звонке" : "Например: клиент получил расчёт, ждём документы"} />
          </Field>
          <Button block disabled={needsResult && !result.trim()} loading={change.isPending} onClick={() => change.mutate({ to: "done", comment: result.trim() })}>Отметить выполненной</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
