import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Hint } from "../../components/Hint";
import { BellButton, Screen } from "../../components/Layout";
import { Button, Chips, EmptyState, ErrorState, inputCls, List, ListSkeleton, Row, Tag } from "../../components/ui";
import { get, qs } from "../../lib/api";
import { useDebounced, useStoredState } from "../../lib/hooks";
import type { Org, Page } from "../../lib/types";

const SEG_LABEL: Record<string, string> = { S1: "Группа", S2: "Сезон", S3: "Онлайн", S4: "ВЭД" };

export function Clients() {
  const navigate = useNavigate();
  const [segment, setSegment] = useStoredState<string>("clients.segment", "all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const list = useInfiniteQuery({
    queryKey: ["orgs", segment, q],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => get<Page<Org>>(`/orgs${qs({ segment: segment === "all" ? null : segment, search: q, page: pageParam, size: 25 })}`, signal),
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen title="Клиенты" subtitle={list.data ? `${list.data.pages[0].total} компаний` : " "} right={<BellButton />}>
      <Hint id="clients" steps={[
        "Здесь все компании базы, в том числе из датасетов кейса. Фильтры сверху — по сегментам.",
        "Откройте компанию — увидите её профиль и решение системы.",
        "Кнопка «Что если… (открыть в симуляторе)» позволяет поменять признаки этой компании и посмотреть «что если».",
      ]} />
      <div className="mt-4 space-y-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-hint" />
          <input className={`${inputCls} pl-9`} placeholder="Название или ИНН" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск клиентов" />
        </label>
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
          <Chips ariaLabel="Сегмент" value={segment} onChange={setSegment}
            options={[{ value: "all", label: "Все" }, { value: "S1", label: "S1 Группы" }, { value: "S2", label: "S2 АПК/сезон" }, { value: "S3", label: "S3 Онлайн" }, { value: "S4", label: "S4 ВЭД" }]} />
        </div>
      </div>
      <div className="mt-3">
        {list.isLoading && <ListSkeleton rows={6} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && <EmptyState icon={<Users className="size-6" />} title="Никого не нашли" text="Измените поиск или сегмент" />}
        {items.length > 0 && (
          <List>
            {items.map((o) => (
              <Row key={o.id} onClick={() => navigate(`/clients/${o.id}`)} title={o.name}
                subtitle={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>{o.industry_name} · {o.primary_role_name}</span>
                    {o.segments.map((s) => <Tag key={s} tone="violet">{SEG_LABEL[s]}</Tag>)}
                    <Tag tone={o.ab_variant === "test" ? "blue" : "neutral"}>{o.ab_variant === "test" ? "тест" : "контроль"}</Tag>
                  </span>
                }
              />
            ))}
          </List>
        )}
        {list.hasNextPage && <Button className="mt-3" block variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Показать ещё</Button>}
      </div>
    </Screen>
  );
}
