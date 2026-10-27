import { useInfiniteQuery } from "@tanstack/react-query";
import { Desktop, Factory, Package } from "@phosphor-icons/react";
import { Building2, ChevronRight, type IconType, Plant, Search, Storefront, Truck, Users } from "../../components/icons";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Hint } from "../../components/Hint";
import { BellButton, Screen } from "../../components/Layout";
import { Button, Chips, cx, EmptyState, ErrorState, inputCls, List, ListSkeleton, Tag } from "../../components/ui";
import { get, qs } from "../../lib/api";
import { plural } from "../../lib/format";
import { useDebounced, useStoredState } from "../../lib/hooks";
import type { Org, Page } from "../../lib/types";

const SEG_LABEL: Record<string, string> = { S1: "Группа", S2: "Сезон", S3: "Онлайн", S4: "ВЭД" };

/** «Компания U_106390 · Нижний Новгород» → название и город отдельно: город уходит в подзаголовок, не обрезается. */
export function splitName(name: string): [string, string | null] {
  const i = name.indexOf(" · ");
  return i > 0 ? [name.slice(0, i), name.slice(i + 3)] : [name, null];
}

const INDUSTRY_ICON: Record<string, IconType> = { agro: Plant, retail: Storefront, it: Desktop, log: Truck, trade: Package, mfg: Factory };

/** Плитка отрасли: одна иконка на отрасль во всех списках клиентов. */
export function IndustryBadge({ industry, className }: { industry: string | null | undefined; className?: string }) {
  const Icon = (industry && INDUSTRY_ICON[industry]) || Building2;
  return (
    <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-subtle text-text", className)} aria-hidden>
      <Icon className="size-5" />
    </span>
  );
}

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
  const total = list.data?.pages[0].total;

  return (
    <Screen title="Клиенты" subtitle={total !== undefined ? `${total} ${plural(total, "компания", "компании", "компаний")}` : " "} right={<BellButton />}>
      <Hint id="clients" steps={[
        "Фильтр — по сегментам S1–S4, поиск — по названию или ИНН.",
        "В карточке компании — профиль и решение оптимизатора.",
        "«Открыть в симуляторе» — поменять признаки и посмотреть «что если».",
      ]} />
      <div className="mt-4 space-y-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-hint" />
          <input className={`${inputCls} pl-10`} placeholder="Название или ИНН" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск клиентов" />
        </label>
        <div className="no-scrollbar -mx-4 overflow-x-auto">
          <div className="w-max px-4 [&_button]:shrink-0 [&_button]:whitespace-nowrap [&>div]:flex-nowrap">
            <Chips ariaLabel="Сегмент" value={segment} onChange={setSegment}
              options={[{ value: "all", label: "Все" }, { value: "S1", label: "S1 Группы" }, { value: "S2", label: "S2 АПК/сезон" }, { value: "S3", label: "S3 Онлайн" }, { value: "S4", label: "S4 ВЭД" }]} />
          </div>
        </div>
      </div>
      <div className="mt-3">
        {list.isLoading && <ListSkeleton rows={6} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && <EmptyState icon={<Users className="size-6" />} title="Никого не нашли" text="Измените поиск или сегмент" />}
        {items.length > 0 && (
          <List>
            {items.map((o) => {
              const [name, city] = splitName(o.name);
              return (
                <button key={o.id} type="button" onClick={() => navigate(`/clients/${o.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-subtle">
                  <IndustryBadge industry={o.industry} />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[15px] font-medium leading-snug">{name}</div>
                    <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-hint">{[city, o.industry_name, o.primary_role_name].filter(Boolean).join(" · ")}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Tag tone={o.ab_variant === "test" ? "violet" : "neutral"}>{o.ab_variant === "test" ? "тест" : "контроль"}</Tag>
                      {o.segments.map((s) => <Tag key={s} tone="neutral">{SEG_LABEL[s] ?? s}</Tag>)}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-hint" aria-hidden />
                </button>
              );
            })}
          </List>
        )}
        {list.hasNextPage && <Button className="mt-3" block variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Показать ещё</Button>}
      </div>
    </Screen>
  );
}
