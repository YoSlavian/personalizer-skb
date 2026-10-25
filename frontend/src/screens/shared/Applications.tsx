import { useInfiniteQuery } from "@tanstack/react-query";
import { FileText, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { BellButton, Screen } from "../../components/Layout";
import { Button, EmptyState, ErrorState, inputCls, List, ListSkeleton, Row, Segmented, StatusPill } from "../../components/ui";
import { get, qs } from "../../lib/api";
import { mln, relative } from "../../lib/format";
import { useDebounced, useStoredState } from "../../lib/hooks";
import type { Application, Page } from "../../lib/types";

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
      right={staff ? <BellButton /> : <Button size="sm" icon={<Plus className="size-4" />} onClick={() => navigate("/journey")}>Новая</Button>}
    >
      <div className="mt-4 space-y-3">
        <Segmented ariaLabel="Статус" value={tab} onChange={setTab} options={[{ value: "active", label: "Активные" }, { value: "closed", label: "Завершённые" }]} />
        <div className="flex gap-2">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-hint" />
            <input className={`${inputCls} pl-9`} placeholder={staff ? "Номер или компания" : "Номер заявки"} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск" />
          </label>
          <select aria-label="Сортировка" className={`${inputCls} w-auto pr-8`} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="-updated">Обновлённые</option>
            <option value="-created">Новые</option>
            <option value="created">Старые</option>
            <option value="-amount">По сумме</option>
          </select>
        </div>
        {me.user.role === "manager" && (
          <Segmented ariaLabel="Чьи заявки" value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")}
            options={[{ value: "mine", label: "Мои" }, { value: "all", label: "Портфель" }]} />
        )}
      </div>
      <div className="mt-3">
        {list.isLoading && <ListSkeleton rows={5} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && (
          <EmptyState
            icon={<FileText className="size-6" />}
            title={q ? "Ничего не найдено" : tab === "active" ? "Активных заявок нет" : "Завершённых заявок нет"}
            text={q ? "Измените запрос поиска" : staff ? "Новые заявки клиентов появятся здесь" : "Рассчитайте продукт и подайте заявку — статус будет виден здесь"}
            action={!staff && !q ? <Button onClick={() => navigate("/journey")}>Рассчитать</Button> : undefined}
          />
        )}
        {items.length > 0 && (
          <List>
            {items.map((a) => (
              <Row
                key={a.id}
                onClick={() => navigate(`/applications/${a.id}`)}
                title={staff ? a.organization.name : a.product_name}
                subtitle={`${a.number} · ${staff ? `${a.product_name}, ` : ""}${mln(a.amount_rub)} · ${relative(a.updated_at)}`}
                right={<StatusPill status={a.status} />}
                chevron={false}
              />
            ))}
          </List>
        )}
        {list.hasNextPage && (
          <Button className="mt-3" block variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Показать ещё</Button>
        )}
      </div>
    </Screen>
  );
}
