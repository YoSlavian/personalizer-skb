import { useInfiniteQuery } from "@tanstack/react-query";
import { ClipboardCheck, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { BellButton, Screen } from "../../components/Layout";
import { Button, Chips, cx, EmptyState, ErrorState, inputCls, List, ListSkeleton, Segmented, TaskPill, Toggle } from "../../components/ui";
import { get, qs } from "../../lib/api";
import { relative } from "../../lib/format";
import { useDebounced, useStoredState } from "../../lib/hooks";
import type { Page, Task } from "../../lib/types";

const PRIO = { high: "bg-brand", normal: "bg-warning", low: "bg-subtle-2" };

export function TaskRow({ t, onClick }: { t: Task; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-subtle">
      <span className={cx("mt-1.5 size-2.5 shrink-0 rounded-full", PRIO[t.priority])} aria-label={`Приоритет: ${t.priority}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium leading-snug">{t.title}</div>
        <div className="mt-0.5 truncate text-[13px] text-hint">{t.organization.name} · {t.kind_name}</div>
        {t.due_at && (
          <div className={cx("mt-1 text-[12px]", t.overdue ? "font-medium text-danger" : "text-hint")}>
            {t.overdue ? "Просрочено " : "Срок "}{relative(t.due_at)}
          </div>
        )}
      </div>
      <TaskPill status={t.status} />
    </button>
  );
}

export function Tasks() {
  const me = useMe();
  const navigate = useNavigate();
  const [scope, setScope] = useStoredState<"me" | "all">("tasks.scope", me.user.role === "manager" ? "me" : "all");
  const [status, setStatus] = useStoredState<"active" | "open" | "in_progress" | "done">("tasks.status", "active");
  const [overdue, setOverdue] = useState(false);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const statuses = status === "active" ? ["open", "in_progress"] : [status];

  const list = useInfiniteQuery({
    queryKey: ["tasks", scope, status, overdue, q],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      get<Page<Task>>(`/tasks${qs({ status: statuses, assignee: scope === "me" ? "me" : null, overdue, search: q, sort: status === "done" ? "-created" : "due", page: pageParam, size: 20 })}`, signal),
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen title="Задачи" subtitle={list.data ? `${list.data.pages[0].total} в выборке` : " "} right={<BellButton />}>
      <div className="mt-4 space-y-3">
        <Segmented ariaLabel="Чьи задачи" value={scope} onChange={setScope} options={[{ value: "me", label: "Мои" }, { value: "all", label: "Все в портфеле" }]} />
        <Chips ariaLabel="Статус" value={status} onChange={setStatus}
          options={[{ value: "active", label: "Активные" }, { value: "open", label: "Новые" }, { value: "in_progress", label: "В работе" }, { value: "done", label: "Выполненные" }]} />
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-hint" />
          <input className={`${inputCls} pl-9`} placeholder="Задача или компания" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск задач" />
        </label>
        {status !== "done" && <div className="card -mx-0"><Toggle checked={overdue} onChange={setOverdue} label="Только просроченные" /></div>}
      </div>
      <div className="mt-3">
        {list.isLoading && <ListSkeleton rows={5} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title={overdue ? "Просроченных нет" : "Задач нет"}
            text={status === "done" ? "Выполненные задачи появятся здесь" : "Новые задачи придут от правил персонализации и заявок"} />
        )}
        {items.length > 0 && <List>{items.map((t) => <TaskRow key={t.id} t={t} onClick={() => navigate(`/tasks/${t.id}`)} />)}</List>}
        {list.hasNextPage && <Button className="mt-3" block variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Показать ещё</Button>}
      </div>
    </Screen>
  );
}
