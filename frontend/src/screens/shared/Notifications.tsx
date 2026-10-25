import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, ClipboardList, FileText, Megaphone, Settings } from "lucide-react";
import { useNavigate } from "react-router";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Button, cx, EmptyState, ErrorState, IconBadge, ListSkeleton } from "../../components/ui";
import { get, post, qs } from "../../lib/api";
import { relative } from "../../lib/format";
import type { Notification, Page } from "../../lib/types";

const ICON = { application: FileText, task: ClipboardList, offer: Megaphone, system: Bell } as const;
const TONE = { application: "blue", task: "violet", offer: "brand", system: "neutral" } as const;

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
      right={
        <div className="flex gap-2">
          <button type="button" onClick={() => navigate("/profile")} aria-label="Настройки уведомлений" className="flex size-10 items-center justify-center rounded-2xl bg-surface shadow-[var(--shadow)]">
            <Settings className="size-5" />
          </button>
          <button type="button" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate()} aria-label="Прочитать все"
            className="flex size-10 items-center justify-center rounded-2xl bg-surface shadow-[var(--shadow)] disabled:opacity-40">
            <CheckCheck className="size-5" />
          </button>
        </div>
      }
    >
      <div className="mt-4">
        {list.isLoading && <ListSkeleton rows={6} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && (
          <EmptyState icon={<Bell className="size-6" />} title="Пока тихо" text="Здесь появятся изменения статусов, ответы менеджера и важные предложения" />
        )}
        {items.length > 0 && (
          <div className="card divide-y divide-sep overflow-hidden">
            {items.map((n) => {
              const Icon = ICON[n.kind];
              return (
                <button key={n.id} type="button" onClick={() => open(n)} className="flex w-full gap-3 px-4 py-3 text-left active:bg-subtle">
                  <IconBadge tone={TONE[n.kind]}><Icon className="size-4" /></IconBadge>
                  <div className="min-w-0 flex-1">
                    <div className={cx("text-[15px]", !n.is_read && "font-medium")}>{n.title}</div>
                    {n.body && <div className="mt-0.5 line-clamp-2 text-[13px] text-hint">{n.body}</div>}
                    <div className="mt-1 text-[12px] text-hint">{relative(n.created_at)}{n.telegram === "sent" ? " · отправлено в Telegram" : ""}</div>
                  </div>
                  {!n.is_read && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-brand" aria-label="Не прочитано" />}
                </button>
              );
            })}
          </div>
        )}
        {list.hasNextPage && <Button className="mt-3" block variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Показать ещё</Button>}
      </div>
    </Screen>
  );
}
