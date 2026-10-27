import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowsDownUp } from "@phosphor-icons/react";
import { FileText, Plus, Search, X } from "../../components/icons";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { BellButton, Screen } from "../../components/Layout";
import { Button, Chips, EmptyState, ErrorState, inputCls, List, ListSkeleton } from "../../components/ui";
import { get, qs } from "../../lib/api";
import { useDebounced, useStoredState } from "../../lib/hooks";
import type { Application, Page } from "../../lib/types";
import { AppRow } from "./AppRow";

const ACTIVE = ["submitted", "in_review", "needs_info", "draft"];
const CLOSED = ["approved", "declined", "cancelled"];

export function Applications() {
  const me = useMe();
  const navigate = useNavigate();
  const staff = me.user.role !== "client";
  const [tab, setTab] = useStoredState<"active" | "closed">("apps.tab", "active");
  const [sort, setSort] = useStoredState<"-updated" | "-created" | "created" | "-amount">("apps.sort", "-updated");
  const [mine, setMine] = useStoredState<boolean>("apps.mine", me.user.role === "manager");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);

  const list = useInfiniteQuery({
    queryKey: ["applications", tab, sort, q, mine],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      get<Page<Application>>(`/applications${qs({ status: tab === "active" ? ACTIVE : CLOSED, sort, search: q, page: pageParam, size: 20, assignee: staff && mine ? "me" : null })}`, signal),
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <Screen
      title="Заявки"
      subtitle={list.data ? `${total} ${tab === "active" ? "в работе" : "завершено"}` : " "}
      right={staff ? <BellButton /> : <Button size="sm" icon={<Plus className="size-4" weight="bold" />} onClick={() => navigate("/journey")}>Новая</Button>}
    >
      <div className="mt-4 space-y-2.5">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-hint" aria-hidden />
          <input className={`${inputCls} pl-10 pr-10`} enterKeyHint="search"
            placeholder={staff ? "Номер или компания" : "Номер заявки"} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск" />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Очистить поиск"
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-hint active:bg-subtle">
              <X className="size-4" />
            </button>
          )}
        </label>
        {/* Фильтры — группы чипов переносятся строкой целиком (ничего не прячется за край), сортировка — круглая кнопка справа */}
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 pt-0.5">
            <Chips ariaLabel="Статус" value={tab} onChange={setTab} options={[{ value: "active", label: "Активные" }, { value: "closed", label: "Завершённые" }]} />
            {me.user.role === "manager" && (
              <Chips ariaLabel="Чьи заявки" value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")}
                options={[{ value: "mine", label: "Мои" }, { value: "all", label: "Портфель" }]} />
            )}
          </div>
          <label title="Сортировка"
            className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-surface transition-transform active:scale-95 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand">
            <ArrowsDownUp className="size-5" aria-hidden />
            {sort !== "-updated" && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand" aria-hidden />}
            <select aria-label="Сортировка" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
              className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0">
              <option value="-updated">Сначала обновлённые</option>
              <option value="-created">Сначала новые</option>
              <option value="created">Сначала старые</option>
              <option value="-amount">По сумме</option>
            </select>
          </label>
        </div>
      </div>
      <div className="mt-3">
        {list.isLoading && <ListSkeleton rows={5} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && (
          <EmptyState
            icon={<FileText className="size-6" />}
            title={q ? "Ничего не найдено" : tab === "active" ? "Активных заявок нет" : "Завершённых заявок нет"}
            text={q ? "Измените запрос" : staff ? "Новые заявки клиентов появятся здесь" : "Рассчитайте продукт — статус заявки будет здесь"}
            action={!staff && !q ? <Button onClick={() => navigate("/journey")}>Рассчитать</Button> : undefined}
          />
        )}
        {items.length > 0 && (
          <List>
            {items.map((a) => (
              <AppRow key={a.id} a={a} staff={staff} onClick={() => navigate(`/applications/${a.id}`)} />
            ))}
          </List>
        )}
        {list.hasNextPage && (
          <Button className="mt-3" block variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Показать ещё</Button>
        )}
      </div>
    </Screen>
  );
}
