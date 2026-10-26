import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, ClipboardList, FileText, Megaphone, Settings } from "../../components/icons";
import { type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Button, cx, EmptyState, ErrorState, IconBadge, ListSkeleton } from "../../components/ui";
import { get, post, qs } from "../../lib/api";
import type { Notification, Page } from "../../lib/types";
import { taskDescription } from "../manager/Tasks";
import { ago } from "./AppRow";

const ICON = { application: FileText, task: ClipboardList, offer: Megaphone, system: Bell } as const;
// Предложение — «для вас» (лайм), остальное — нейтральные плитки: красный остаётся за непрочитанным
const TONE = { application: "neutral", task: "neutral", offer: "lime", system: "neutral" } as const;

/** Номер заявки («З-2026-000038») не переносится по дефисам — оборачиваем его в неразрывный фрагмент. */
const APP_NUMBER = /([A-ZА-ЯЁ]-\d{4}-\d+)/;
function keepNumbers(text: string): ReactNode {
  const parts = text.split(APP_NUMBER);
  return parts.length === 1 ? text : parts.map((p, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{p}</span> : p));
}

/**
 * Заголовок задачи — как в списке задач: «Новая задача: Рассмотреть заявку З-2026-000043: Оборотный кредит»
 * → «Новая задача: Рассмотреть заявку · Оборотный кредит» (номер — на экране задачи). Остальные заголовки — как есть.
 */
function notificationTitle(n: Notification): string {
  if (n.kind !== "task") return n.title;
  const m = /^(Новая задача|Вам назначена задача):\s*(.+)$/.exec(n.title);
  if (!m) return n.title;
  const app = /^(.*?)\s+[A-ZА-ЯЁ]-\d{4}-\d+:\s*(.+)$/.exec(m[2]);
  return `${m[1]}: ${app ? `${app[1]} · ${app[2]}` : m[2].replace(/:\s+/, " · ")}`;
}

/** Текст — тем же форматом, что на экране задачи: «20,0 млн ₽», «Канал подачи: веб-версия.» */
function notificationBody(n: Notification): string {
  if (!n.body) return "";
  if (n.kind === "task") return taskDescription(n.body, true);
  // Заявки и комментарии: только суммы (комментарий пишет человек — остальной текст не трогаем)
  return n.body.replace(/(\d)\.(\d+)(?=\s*млн)/g, "$1,$2").replace(/(\d)\s+млн\s+₽/g, "$1 млн ₽");
}

export function Notifications() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useInfiniteQuery({
    queryKey: ["notifications"],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => get<Page<Notification> & { unread: number }>(`/notifications${qs({ page: pageParam, size: 20 })}`, signal),
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
  const readOne = useMutation({ mutationFn: (id: number) => post(`/notifications/${id}/read`) });
  const readAll = useMutation({
    mutationFn: () => post<{ updated: number }>("/notifications/read-all"),
    onSuccess: (r) => {
      toast.show(r.updated ? "Все уведомления прочитаны" : "Новых уведомлений нет", "info");
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["unread"] });
    },
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = list.data?.pages[0]?.unread ?? 0;

  const open = async (n: Notification) => {
    if (!n.is_read) {
      try {
        await readOne.mutateAsync(n.id);
      } catch {
        /* переход важнее отметки */
      }
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["unread"] });
    }
    if (n.link) navigate(n.link);
  };

  return (
    <Screen
      title="Уведомления"
      subtitle={list.data ? (unread ? `${unread} новых` : "Всё прочитано") : " "}
    >
      {/* Действия списка — под заголовком: в шапке остаётся только смена темы, и заголовок помещается целиком */}
      <div className="mt-3 flex items-center justify-end gap-2">
        {unread > 0 && (
          <button type="button" disabled={readAll.isPending} onClick={() => readAll.mutate()} aria-label="Прочитать все"
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-[14px] font-medium text-link transition-transform active:scale-[0.97] disabled:opacity-50">
            <CheckCheck className="size-4" weight="bold" /> Прочитать все
          </button>
        )}
        <button type="button" onClick={() => navigate("/profile")} aria-label="Настройки уведомлений"
          className="flex size-10 items-center justify-center rounded-full bg-surface transition-transform active:scale-95">
          <Settings className="size-5" />
        </button>
      </div>
      <div className="mt-3">
        {list.isLoading && <ListSkeleton rows={6} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && (
          <EmptyState icon={<Bell className="size-6" />} title="Пока тихо" text="Статусы заявок, ответы менеджера и предложения появятся здесь" />
        )}
        {items.length > 0 && (
          <div className="card divide-y divide-sep overflow-hidden">
            {items.map((n) => {
              const Icon = ICON[n.kind];
              const body = notificationBody(n);
              return (
                <button key={n.id} type="button" onClick={() => open(n)}
                  className="flex min-h-[64px] w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-subtle">
                  <IconBadge tone={TONE[n.kind]}>
                    <Icon className="size-5" weight={n.kind === "offer" ? "fill" : "regular"} />
                  </IconBadge>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className={cx("min-w-0 flex-1 text-[15px] leading-snug", n.is_read ? "text-text" : "font-medium")}>{keepNumbers(notificationTitle(n))}</div>
                      <span className="shrink-0 pt-0.5 text-[12px] text-hint tabular">{ago(n.created_at)}</span>
                    </div>
                    {body && <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-hint">{keepNumbers(body)}</div>}
                    {n.telegram === "sent" && <div className="mt-1 text-[12px] text-hint">Отправлено в Telegram</div>}
                  </div>
                  <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.is_read ? "bg-transparent" : "bg-brand")}
                    aria-label={n.is_read ? undefined : "Не прочитано"} aria-hidden={n.is_read || undefined} />
                </button>
              );
            })}
          </div>
        )}
        {list.hasNextPage && <Button className="mt-3" block variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Показать ещё</Button>}
      </div>
    </Screen>
  );
}
