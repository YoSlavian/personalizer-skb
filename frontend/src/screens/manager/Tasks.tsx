import { useInfiniteQuery } from "@tanstack/react-query";
import { Building2, ChatCircle, ClipboardCheck, ClipboardList, Clock, FileText, IdentificationCard, type IconType, Phone, Search, Zap } from "../../components/icons";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { BellButton, Screen } from "../../components/Layout";
import { Button, Chips, cx, EmptyState, ErrorState, inputCls, List, ListSkeleton, Segmented, TaskPill } from "../../components/ui";
import { get, qs } from "../../lib/api";
import { date, plural } from "../../lib/format";
import { useDebounced, useStoredState } from "../../lib/hooks";
import type { Page, Task } from "../../lib/types";

const KIND_ICON: Record<string, IconType> = {
  hesitation: Zap,
  call_48h: Phone,
  meeting: ChatCircle,
  update_crm_role: IdentificationCard,
  application_review: FileText,
  group_offer: Building2,
  manual: ClipboardList,
};
const PRIO_NAME = { high: "высокий", normal: "обычный", low: "низкий" };

const isActive = (t: Task) => t.status === "open" || t.status === "in_progress";
/** Красная плитка — только то, что требует реакции сейчас: клиент сомневается или срок уже прошёл. */
const isUrgent = (t: Task) => isActive(t) && (t.kind === "hesitation" || t.overdue);

const SOURCE_NAME: Record<string, string> = { web: "веб-версия", miniapp: "Mini App", "mini app": "Mini App", bot: "бот", manager: "менеджер" };

/**
 * Описание задачи от бэкенда для показа: «20.0 млн ₽» → «20,0 млн ₽» (без переноса внутри суммы),
 * «Источник: web.» → «Канал подачи: веб-версия.» (withSource) или убирается.
 */
export function taskDescription(desc: string | null | undefined, withSource = false): string {
  if (!desc) return "";
  return desc
    .replace(/(\d)\.(\d+)(?=\s*млн)/g, "$1,$2")
    .replace(/(\d)\s+млн\s+₽/g, "$1\u00a0млн\u00a0₽") // сумма не разрывается переносом
    .replace(/\s*Источник:\s*([^.]+)\.?/, (_, src: string) => {
      const name = SOURCE_NAME[src.trim().toLowerCase()];
      return withSource && name ? ` Канал подачи: ${name}.` : "";
    })
    .trim();
}

/** «Рассмотреть заявку З-2026-000038: Лизинг» → «Рассмотреть заявку · Лизинг»: продукт виден, номер — на экране задачи. */
function shortTitle(title: string): string {
  const m = /^(.*?)\s+З-\d{4}-\d+:\s*(.+)$/.exec(title);
  return m ? `${m[1]} · ${m[2]}` : title;
}

/** Первая фраза описания — для строки списка: «Клиент не заходит в цифровые каналы». */
function shortDescription(desc: string): string {
  return taskDescription(desc).split(/\s+—\s+|(?<!мес)\.\s/)[0].replace(/(?<!мес)\.$/, "");
}

const hhmm = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Срок короткой пилюлей: «просрочена», «до 18:00», «завтра», «3 дня», «5 нояб.». */
function dueLabel(t: Task): { label: string; urgent: boolean } | null {
  if (!t.due_at) return null;
  if (t.overdue) return { label: "просрочена", urgent: true };
  const due = new Date(t.due_at);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (due.toDateString() === now.toDateString()) return { label: `до ${hhmm.format(due)}`, urgent: true };
  if (due.toDateString() === tomorrow.toDateString()) return { label: "завтра", urgent: t.priority === "high" };
  const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  if (days < 7) return { label: `${days} ${plural(days, "день", "дня", "дней")}`, urgent: false };
  return { label: date(t.due_at), urgent: false };
}

/** Плитка с иконкой вида задачи — та же, что в списке, на экране задачи. */
export function TaskBadge({ t }: { t: Task }) {
  const Icon = KIND_ICON[t.kind] ?? ClipboardList;
  const urgent = isUrgent(t);
  return (
    <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-[14px]", urgent ? "bg-brand text-white" : "bg-subtle text-text")} aria-hidden>
      <Icon className="size-5" weight={urgent ? "fill" : "regular"} />
    </span>
  );
}

export function TaskRow({ t, onClick }: { t: Task; onClick: () => void }) {
  const due = isActive(t) ? dueLabel(t) : null;
  const title = shortTitle(t.title);
  const meta = [t.organization.name, shortDescription(t.description)].filter(Boolean).join(" · ");
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-subtle">
      <TaskBadge t={t} />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[15px] font-medium leading-snug">{title}</div>
        <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-hint">{meta}</div>
        <span className="sr-only">Приоритет: {PRIO_NAME[t.priority]}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {isActive(t) ? (
          <>
            {due && (
              <span className={cx("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap tabular", due.urgent ? "bg-brand-soft text-brand" : "bg-subtle text-text")}>
                {due.label}
              </span>
            )}
            {t.status === "in_progress" && <span className="text-[11px] text-hint">в работе</span>}
            {!due && t.status === "open" && <span className="text-[11px] text-hint">новая</span>}
          </>
        ) : (
          <TaskPill status={t.status} />
        )}
      </div>
    </button>
  );
}

type StatusFilter = "active" | "open" | "in_progress" | "done";

export function Tasks() {
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [scope, setScope] = useStoredState<"me" | "all">("tasks.scope", me.user.role === "manager" ? "me" : "all");
  const [status, setStatus] = useStoredState<StatusFilter>("tasks.status", "active");
  // С главной можно прийти сразу к просроченным (плитка «просрочено»)
  const [overdue, setOverdue] = useState(() => !!(location.state as { overdue?: boolean } | null)?.overdue);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const statuses = status === "active" ? ["open", "in_progress"] : [status];

  useEffect(() => {
    if (overdue && status === "done") setStatus("active");
  }, [overdue, status, setStatus]);

  const list = useInfiniteQuery({
    queryKey: ["tasks", scope, status, overdue, q],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      get<Page<Task>>(`/tasks${qs({ status: statuses, assignee: scope === "me" ? "me" : null, overdue, search: q, sort: status === "done" ? "-created" : "due", page: pageParam, size: 20 })}`, signal),
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0].total;

  return (
    <Screen title="Задачи" subtitle={total !== undefined ? `${total} ${plural(total, "задача", "задачи", "задач")} в выборке` : " "} right={<BellButton />}>
      <div className="mt-4 space-y-3">
        <Segmented ariaLabel="Чьи задачи" value={scope} onChange={setScope} options={[{ value: "me", label: "Мои" }, { value: "all", label: "Все в портфеле" }]} />
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-hint" />
          <input className={`${inputCls} pl-10`} placeholder="Задача или компания" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск задач" />
        </label>
        <div className="no-scrollbar -mx-4 overflow-x-auto">
          <div className="flex w-max items-center gap-1.5 px-4 [&_button]:shrink-0 [&_button]:whitespace-nowrap [&>div]:flex-nowrap">
            <Chips ariaLabel="Статус" value={status}
              onChange={(v) => { setStatus(v); if (v === "done") setOverdue(false); }}
              options={[{ value: "active", label: "Активные" }, { value: "open", label: "Новые" }, { value: "in_progress", label: "В работе" }, { value: "done", label: "Выполненные" }]} />
            {status !== "done" && (
              <>
                <span className="mx-0.5 h-5 w-px bg-sep" aria-hidden />
                <button type="button" aria-pressed={overdue} onClick={() => setOverdue(!overdue)}
                  className={cx("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-colors", overdue ? "bg-brand font-medium text-white" : "bg-subtle text-text active:bg-subtle-2")}>
                  <Clock className="size-4" weight={overdue ? "fill" : "regular"} aria-hidden />
                  Просроченные
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3">
        {list.isLoading && <ListSkeleton rows={5} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title={overdue ? "Просроченных нет" : "Задач нет"}
            text={status === "done" ? "Выполненные задачи появятся здесь" : "Новые задачи создадут правила персонализации и заявки"} />
        )}
        {items.length > 0 && <List>{items.map((t) => <TaskRow key={t.id} t={t} onClick={() => navigate(`/tasks/${t.id}`)} />)}</List>}
        {list.hasNextPage && <Button className="mt-3" block variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Показать ещё</Button>}
      </div>
    </Screen>
  );
}
