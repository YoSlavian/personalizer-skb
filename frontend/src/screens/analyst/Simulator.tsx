import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { Building2, ChevronDown, Info, RotateCcw, SlidersHorizontal } from "../../components/icons";
import { Screen } from "../../components/Layout";
import { OfferCard } from "../../components/Offer";
import { Banner, Button, Chips, cx, ErrorState, IconBadge, Row, Section, Segmented, Sheet, Skeleton, Spinner, Tag, Toggle } from "../../components/ui";
import { get, post } from "../../lib/api";
import { useDebounced, useStoredState } from "../../lib/hooks";
import { tg } from "../../lib/telegram";
import type { Catalog, DecisionResult, Profile } from "../../lib/types";
import {
  AllProducts, AsIsToBe, ChannelTags, channelNames, FallbackBanner, type FactKey, factsOf, ResultBanners, ResultFacts, SuppressedCard, useCtaPreview,
  WhyPipeline,
} from "./DecisionView";
import { type GroupPlan, GroupPlanView } from "./GroupPlanView";
import { GROUPS, PRESETS } from "./presets";

const ACT_LABEL = (n: number) => (n >= 8 ? "высокая" : n >= 2 ? "средняя" : "низкая");
type Act = "low" | "mid" | "high";
const ACT_LEVEL = (n: number): Act => (n >= 8 ? "high" : n >= 2 ? "mid" : "low");
const ACT_LOGINS: Record<Act, number> = { low: 0, mid: 4, high: 22 };

const ROLE_SHORT: Record<string, string> = { owner: "Собств.", fd: "ФД", acc: "Бухг.", ops: "Опер." };
const ROLE_FALLBACK = [
  { code: "owner", name: "Собственник" },
  { code: "fd", name: "Финдиректор" },
  { code: "acc", name: "Главный бухгалтер" },
  { code: "ops", name: "Операционист" },
];
const INDUSTRY_SHORT: Record<string, string> = { trade: "Торговля" };
const SOURCE_NOTE: Record<Profile["role_source"], string> = {
  crm: "Роль из CRM — полный вес персонализации.",
  inferred: "Выведена по правам в ИБ: вес ×0,9, метка «выведено».",
  none: "Роли нет: нейтральный текст, задача КМ уточнить. Вес ×0,85.",
};
const FACT_KEYS: FactKey[] = ["product", "recipient", "channel", "frequency", "nba"];
const entitiesWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "юрлицо" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "юрлица" : "юрлиц");

// Подписи признаков для журнала изменений
const FIELD: Record<string, string> = {
  industry: "Отрасль", seasonal: "Сезонность", weeks_to_peak: "Недель до пика", role: "Роль", role_source: "Источник роли",
  structure: "Структура", size: "Размер", group: "Состав группы", mixed_balances: "Разнонаправленные остатки", logins_30d: "Входов за 30 дней",
  fx_payment: "Валютный платёж", deposit_ending: "Конец депозита", bki_request: "Запрос в БКИ", hidden_products: "Скрыл баннер",
  opt_out_email: "Отказ от email", opt_out_push: "Отказ от push", opt_out_all: "Отказ от всех коммуникаций",
};
type LogEntry = { at: string; change: string; product: string; channel: string; changed: boolean };

/* ───────────── Компактные контролы панели профиля ───────────── */

/**
 * Сегменты в строку: инвертированный бегунок, как Segmented, но ниже и уже — помещается рядом с подписью.
 * fit — ширина сегмента по подписи (короткое «ФД» уже, «Собств.» шире), иначе сегменты равные.
 * Ширину под жирное начертание резервирует невидимая копия подписи — выбор не сдвигает соседей и не обрезает текст.
 */
function SegRow<T extends string>({ value, options, onChange, ariaLabel, disabled, fit }: {
  value: T | null; options: { value: T; label: string; full?: string }[]; onChange: (v: T) => void; ariaLabel: string; disabled?: boolean; fit?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined}
      className={cx("flex gap-0.5 rounded-[12px] bg-subtle p-[3px]", disabled && "opacity-45")}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.full} disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cx("h-9 min-w-0 rounded-[10px] text-[13px] transition-colors", fit ? "flex-auto px-1.5" : "flex-1 px-1",
              on ? "bg-text text-bg" : "text-text enabled:active:bg-subtle-2")}>
            <span className="grid min-w-0">
              <span aria-hidden className="invisible col-start-1 row-start-1 truncate font-medium">{o.label}</span>
              <span className={cx("col-start-1 row-start-1 truncate", on && "font-medium")}>{o.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Чипы одной строкой с горизонтальной прокруткой; выбранный чип докручивается в видимую часть.
 * С мышью (pointer: fine — браузер на ноутбуке, Telegram Desktop) колесо не крутит строку вбок,
 * поэтому там чипы переносятся на следующую строку и видны все сразу.
 */
function ChipRow<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!box || !el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < box.scrollLeft || right > box.scrollLeft + box.clientWidth - 14) box.scrollTo({ left: Math.max(0, left - 4), behavior: "smooth" });
  }, [value, options.length]);
  return (
    <div ref={ref} role="radiogroup" aria-label={ariaLabel} className="no-scrollbar relative -mr-3.5 flex gap-1.5 overflow-x-auto pr-3.5 pointer-fine:mr-0 pointer-fine:flex-wrap pointer-fine:pr-0">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cx("h-9 shrink-0 rounded-full px-3.5 text-[13px] transition-colors",
              on ? "bg-brand font-medium text-white" : "bg-subtle text-text active:bg-subtle-2")}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SheetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-1">
      <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.04em] text-hint">{title}</h3>
      {children}
    </div>
  );
}

/* ───────────── Журнал ───────────── */

/** Журнал: что меняли в профиле и как после этого изменилось предложение. Свёрнут, чтобы не отвлекать на демо. */
function ChangeLog({ log, onClear }: { log: LogEntry[]; onClear: () => void }) {
  if (!log.length) return null;
  return (
    <details className="group card mt-5 overflow-hidden">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors active:bg-subtle [&::-webkit-details-marker]:hidden">
        <span className="flex-1 text-[15px] font-medium">Журнал изменений</span>
        <span className="text-[13px] text-hint tabular">{log.length}</span>
        <ChevronDown className="size-4 text-hint transition-transform group-open:rotate-180" />
      </summary>
      <ul className="divide-y divide-sep border-t border-sep">
        {log.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex gap-3 px-4 py-3">
            <span className={cx("mt-1.5 size-2.5 shrink-0 rounded-full", e.changed ? "bg-brand" : "bg-subtle-2")} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[14px] font-medium leading-snug">{e.change}</div>
                <div className="shrink-0 text-[11px] text-hint tabular">{e.at}</div>
              </div>
              <div className="mt-0.5 text-[13px] leading-snug">
                {e.changed ? <span className="text-brand">→ </span> : <span className="text-hint">без изменений: </span>}
                <span className={e.changed ? "font-medium" : "text-hint"}>{e.product}</span>
                <span className="text-hint"> · {e.channel}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-sep py-1 pl-4 pr-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-hint">
          <span className="size-2 rounded-full bg-brand" /> предложение или канал изменились
        </span>
        <button type="button" onClick={onClear} className="h-10 rounded-full px-3 text-[13px] font-medium text-link active:bg-subtle">Очистить</button>
      </div>
    </details>
  );
}

function ResultSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка">
      <div className="flex gap-1.5">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-[360px] rounded-[24px]" />
      <Skeleton className="mt-3 h-[236px] rounded-[22px]" />
    </div>
  );
}

// Цели переходов («Было / стало», «Все продукты», плашка) встают верхом под полосу кнопок Telegram: scroll-mt = --app-top + 16 px
const JUMP_TARGET = "scroll-mt-[calc(var(--app-top)+16px)]";
const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

// Видимая полоса экрана: сверху — статус-бар и кнопки Telegram (берём scroll-margin блока результата: --app-top + 16 px),
// снизу — таб-бар и сама плашка
const BAND_BOTTOM = 96;
const MIN_VISIBLE = 120;
/** Где блок результата относительно экрана: в кадре (видно ≥120 px) — null, иначе куда крутить. */
function resultOffscreen(el: HTMLElement | null): "down" | "up" | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const bandTop = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const bottomEdge = window.innerHeight - BAND_BOTTOM;
  const visible = Math.min(rect.bottom, bottomEdge) - Math.max(rect.top, bandTop);
  if (visible >= Math.min(MIN_VISIBLE, rect.height)) return null;
  return rect.top >= bandTop ? "down" : "up";
}

export function Simulator() {
  const location = useLocation();
  const fromClient = (location.state as { profile?: Profile; company?: string } | null)?.profile;
  const [profile, setProfile] = useStoredState<Profile>("sim.profile", fromClient ?? PRESETS[0].profile);
  const [preset, setPreset] = useStoredState<string | null>("sim.preset", fromClient ? null : "A");
  const [more, setMore] = useState(false);
  const ctaPreview = useCtaPreview();
  const [allOpen, setAllOpen] = useState(false);
  const closeMore = useCallback(() => setMore(false), []);
  useEffect(() => {
    if (fromClient) {
      setProfile(fromClient);
      setPreset(null);
    }
    // профиль клиента подставляем один раз при переходе из карточки
  }, [fromClient]); // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => get<Catalog>("/catalog"), staleTime: Infinity });
  const p = useDebounced(profile, 200);

  const sim = useQuery({
    queryKey: ["simulate", p],
    queryFn: () => post<{ result: DecisionResult }>("/decisions/simulate", { profile: p }),
    placeholderData: keepPreviousData,
  });
  const plan = useQuery({
    queryKey: ["simulate-group", p],
    queryFn: () => post<{ plan: GroupPlan }>("/groups/plan/simulate", { profile: p }),
    enabled: p.structure === "group" && !!p.group,
    placeholderData: keepPreviousData,
  });

  const [log, setLog] = useStoredState<LogEntry[]>("sim.log.v2", []);
  const pending = useRef<string | null>(null);
  const [tick, setTick] = useState(0); // каждое действие пользователя, даже если профиль не изменился
  const set = (patch: Partial<Profile>) => {
    tg.haptic("select");
    setPreset(null);
    pending.current = Object.keys(patch).map((k) => FIELD[k] ?? k).join(", ");
    setTick((t) => t + 1);
    setProfile((prev) => ({ ...prev, ...patch }));
  };
  const pickPreset = (id: string, title: string, prof: Profile) => {
    pending.current = `Клиент ${id} · ${title}`;
    setTick((t) => t + 1);
    setPreset(id);
    setProfile(prof);
  };
  const r = sim.data?.result;

  // Метки «изменилось» на строках результата и плашка «Предложение изменилось», если результат вне экрана
  const lastFacts = useRef<Record<FactKey, string> | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [changed, setChanged] = useState<ReadonlySet<FactKey>>(() => new Set());
  const [pill, setPill] = useState<"down" | "up" | null>(null);

  // Как только пришёл результат для изменённого профиля — записываем строку журнала и сравниваем с прошлым результатом
  useEffect(() => {
    // Ждём, пока результат посчитан именно для текущего профиля (запрос идёт с задержкой 200 мс)
    if (!r || sim.isFetching || JSON.stringify(p) !== JSON.stringify(profile)) return;
    const facts = factsOf(r);
    const prevFacts = lastFacts.current;
    lastFacts.current = facts;
    if (!pending.current) return;
    const product = r.suppressed ? "Ничего не отправляем" : r.offer?.product_name ?? "—";
    const channel = channelNames(r).join(" + ") || "—";
    const prev = log[0];
    setLog([{ at: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), change: pending.current, product, channel,
      changed: !prev || prev.product !== product || prev.channel !== channel }, ...log].slice(0, 30));
    pending.current = null;

    const diff = prevFacts ? FACT_KEYS.filter((k) => prevFacts[k] !== facts[k]) : [];
    setChanged(new Set(diff));
    if (diff.length) {
      tg.haptic("light");
      // Плашка — только если карточку предложения сейчас не видно; иначе она закрыла бы текст оффера
      setPill(resultOffscreen(resultRef.current));
    }
  }, [r, sim.isFetching, tick, p]); // eslint-disable-line react-hooks/exhaustive-deps

  // Метки гаснут через 6 секунд (или при следующем изменении — тогда набор меток новый и таймер начинается заново)
  useEffect(() => {
    if (!changed.size) return;
    const t = window.setTimeout(() => setChanged(new Set()), 6000);
    return () => window.clearTimeout(t);
  }, [changed]);

  // Плашка живёт 4 секунды и прячется, как только результат прокрутили в видимую часть
  useEffect(() => {
    if (!pill) return;
    const t = window.setTimeout(() => setPill(null), 4000);
    const onScroll = () => {
      if (!resultOffscreen(resultRef.current)) setPill(null);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pill]);

  const goToResult = () => {
    tg.haptic("light");
    setPill(null);
    setChanged((c) => new Set(c)); // перезапускаем таймер меток, чтобы их успели увидеть
    scrollToId("sim-result");
  };

  const industryName = catalog.data?.industries.find((i) => i.code === p.industry)?.name;
  const industry = catalog.data?.industries.find((i) => i.code === profile.industry);
  const groupKey = profile.group?.name === GROUPS.div.name ? "div" : "agro";
  const groupSize = (profile.group ?? GROUPS.agro).entities.length;
  const roles = catalog.data?.roles ?? ROLE_FALLBACK;
  const extras = [
    profile.seasonal, profile.fx_payment, profile.deposit_ending, profile.bki_request, profile.hidden_products.length > 0,
    profile.opt_out_email, profile.opt_out_push, profile.opt_out_all, profile.size === "large", profile.structure === "group" && profile.mixed_balances,
  ].filter(Boolean).length;
  const openAll = () => {
    setAllOpen(true);
    requestAnimationFrame(() => scrollToId("sim-all"));
  };

  return (
    <Screen title="Симулятор" subtitle="Меняем профиль — меняется предложение">
      {fromClient && (
        <div className="mt-3">
          <Banner tone="info" icon={<Info className="size-4 text-hint" />}>
            Профиль «{fromClient.company}» из базы — изменения не сохраняются
          </Banner>
        </div>
      )}

      {/* Пресеты клиентов A–D: на телефоне — карусель, с мышью — сетка 2×2, чтобы все четыре были видны */}
      <div role="radiogroup" aria-label="Пресет клиента"
        className="no-scrollbar -mx-4 mt-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pointer-fine:grid pointer-fine:grid-cols-2">
        {PRESETS.map((x) => {
          const on = preset === x.id;
          return (
            <button key={x.id} type="button" role="radio" aria-checked={on}
              onClick={() => { pickPreset(x.id, x.title, x.profile); tg.haptic("light"); }}
              className={cx("w-[140px] shrink-0 snap-start rounded-[18px] pointer-fine:w-auto pointer-fine:min-w-0 px-3.5 py-3 text-left transition-[transform,background-color] duration-150 active:scale-[0.97]",
                on ? "bg-brand text-white" : "bg-surface")}>
              <div className="truncate text-[15px] font-medium">{x.title}</div>
              <div className={cx("mt-0.5 line-clamp-2 h-8 text-[12px] leading-4", on ? "text-white/80" : "text-hint")}>{x.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Профиль клиента: четыре главных признака */}
      <div className="card mt-2 px-3.5 py-3">
        <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-x-2 gap-y-3">
          <span className="text-[12px] leading-tight text-hint">Отрасль</span>
          {catalog.data ? (
            <ChipRow ariaLabel="Отрасль" value={profile.industry} onChange={(v) => set({ industry: v })}
              options={catalog.data.industries.map((i) => ({ value: i.code, label: INDUSTRY_SHORT[i.code] ?? i.name }))} />
          ) : (
            <Skeleton className="h-9 rounded-full" />
          )}

          <span className="text-[12px] leading-tight text-hint">
            Роль ЛПР
            {profile.role_source === "none" && <span className="mt-0.5 block text-[11px] font-medium text-brand">нет в CRM</span>}
            {profile.role_source === "inferred" && <span className="mt-0.5 block text-[11px]">выведена</span>}
          </span>
          <SegRow fit ariaLabel="Роль ЛПР" value={profile.role_source === "none" ? null : profile.role} disabled={profile.role_source === "none"}
            onChange={(v) => set({ role: v })}
            options={roles.map((x) => ({ value: x.code, label: ROLE_SHORT[x.code] ?? x.name, full: x.name }))} />

          <span className="text-[12px] leading-tight text-hint">Структура</span>
          <SegRow ariaLabel="Структура" value={profile.structure}
            onChange={(v) => set({ structure: v, group: v === "group" ? profile.group ?? GROUPS.agro : null })}
            options={[{ value: "solo", label: "Одна компания" }, { value: "group", label: `Группа · ${groupSize}` }]} />

          <span className="text-[12px] leading-tight text-hint">Цифровая активность</span>
          <SegRow ariaLabel="Цифровая активность" value={ACT_LEVEL(profile.logins_30d)}
            onChange={(v) => set({ logins_30d: ACT_LOGINS[v] })}
            options={[{ value: "low", label: "Низкая" }, { value: "mid", label: "Средняя" }, { value: "high", label: "Высокая" }]} />
        </div>
        <Button className="mt-3" block variant="secondary" icon={<SlidersHorizontal className="size-4" />} onClick={() => setMore(true)}>
          Ещё признаки
          {extras > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-text px-1.5 text-[11px] font-medium text-bg tabular" aria-label={`включено: ${extras}`}>
              {extras}
            </span>
          )}
        </Button>
      </div>

      {/* Что получит клиент */}
      <div id="sim-result" ref={resultRef} className={JUMP_TARGET}>
        <Section
          title={<span className="inline-flex items-center gap-2">Что получит клиент{sim.isFetching && r && <Spinner className="size-3.5 text-hint" />}</span>}
          action={r && <button type="button" onClick={() => scrollToId("sim-asis")} className="-my-2 h-9 text-[13px] font-medium text-link">Было / стало</button>}
        >
          {!r && sim.isError && <ErrorState error={sim.error} onRetry={() => sim.refetch()} />}
          {!r && !sim.isError && <ResultSkeleton />}
          {r && (
            <>
              {sim.isError && (
                <div className="mb-3">
                  <Banner tone="warn">
                    Не удалось пересчитать.{" "}
                    <button type="button" onClick={() => sim.refetch()} className="font-medium text-link">Повторить</button>
                  </Banner>
                </div>
              )}
              <ChannelTags r={r} />
              {r.fallback && <div className="mt-3"><FallbackBanner r={r} /></div>}
              <div className="mt-3">
                {r.suppressed ? <SuppressedCard /> : r.offer && (
                  <OfferCard key={`${r.offer.product_code}-${r.offer.headline}`} kicker={r.offer.product_name} headline={r.offer.headline}
                    body={r.offer.body} cta={r.offer.cta} visual={r.visual_data} onCta={ctaPreview(r.offer)} />
                )}
              </div>
              <div className="mt-3"><ResultFacts r={r} changed={changed} /></div>
              {!r.suppressed && (r.routing || r.event_note || r.notes.length > 0) && <div className="mt-3"><ResultBanners r={r} /></div>}
            </>
          )}
        </Section>
      </div>

      {r && (
        <>
          <Section title="Почему именно это"
            action={<button type="button" onClick={openAll} className="-my-2 h-9 text-[13px] font-medium text-link">Все продукты</button>}>
            <WhyPipeline r={r} industryName={industryName} />
            <AllProducts id="sim-all" r={r} open={allOpen} onToggle={() => setAllOpen((v) => !v)} />
          </Section>

          <div id="sim-asis" className={JUMP_TARGET}>
            <Section title="Было / стало">
              <AsIsToBe r={r} />
            </Section>
          </div>
        </>
      )}

      {/* Группа компаний: одно предложение на группу, план касаний по юрлицам */}
      {profile.structure === "group" ? (
        <Section title={plan.data?.plan.name ?? profile.group?.name ?? "Группа"}
          action={<Tag tone="lime">{groupSize} {entitiesWord(groupSize)} = 1 получатель</Tag>}>
          {plan.isError && !plan.data && <ErrorState error={plan.error} onRetry={() => plan.refetch()} />}
          {!plan.data && !plan.isError && (
            <div aria-busy="true" aria-label="Загрузка">
              <Skeleton className="h-[228px] rounded-[22px]" />
              <Skeleton className="mt-5 h-[260px] rounded-[22px]" />
            </div>
          )}
          {plan.data && <GroupPlanView plan={plan.data.plan} />}
        </Section>
      ) : (
        <Section>
          <div className="card overflow-hidden">
            <Row left={<IconBadge tone="neutral"><Building2 className="size-5" /></IconBadge>} title="Самостоятельная компания"
              subtitle={<span className="text-link">Показать на агрохолдинге</span>}
              onClick={() => { pickPreset("A", PRESETS[0].title, PRESETS[0].profile); tg.haptic("light"); }} />
          </div>
        </Section>
      )}

      <ChangeLog log={log} onClear={() => setLog([])} />

      {/* Остальные признаки — в шторке, чтобы главный экран оставался коротким */}
      {/* Внутри шторки без -mx-4: у её скролл-контейнера нет своих полей, иначе контент ездит вбок. У Toggle снимаем px-4 — подписи на одной линии с заголовками групп. */}
      <Sheet open={more} onClose={closeMore} title="Ещё признаки">
        <SheetGroup title="Сезон">
          <div className="[&>div]:px-0">
            <Toggle checked={profile.seasonal} onChange={(v) => set({ seasonal: v })} label="Сезонный пик по оборотам РКО"
              description={industry && !industry.seasonal ? "Для этой отрасли не учитывается" : "Окно предложения — 4–6 недель до пика"} />
          </div>
          {profile.seasonal && (
            <div className="pb-1">
              <div className="flex items-baseline justify-between text-[14px]">
                <span className="text-hint">До пика закупок</span>
                <span className="font-medium tabular">{profile.weeks_to_peak} нед.</span>
              </div>
              <input type="range" min={0} max={12} value={profile.weeks_to_peak} onChange={(e) => set({ weeks_to_peak: Number(e.target.value) })} aria-label="Недель до пика" />
            </div>
          )}
        </SheetGroup>

        <SheetGroup title="Откуда знаем роль">
          <Chips ariaLabel="Источник роли" value={profile.role_source} onChange={(v) => set({ role_source: v })}
            options={(catalog.data?.role_sources ?? []).map((s) => ({ value: s.code as Profile["role_source"], label: s.name }))} />
          <p className="mt-2 text-[13px] leading-snug text-hint">{SOURCE_NOTE[profile.role_source]}</p>
        </SheetGroup>

        <SheetGroup title="Компания">
          <Segmented ariaLabel="Размер" value={profile.size} onChange={(v) => set({ size: v })}
            options={[{ value: "mid", label: "Средний бизнес" }, { value: "large", label: "Крупный" }]} />
          {profile.structure === "group" && (
            <>
              <div className="mt-3">
                <Chips ariaLabel="Состав группы" value={groupKey} onChange={(v) => set({ group: GROUPS[v] })}
                  options={[{ value: "agro", label: "Агрохолдинг · АПК 62%" }, { value: "div", label: "Диверсифицированная" }]} />
              </div>
              <div className="mt-1 [&>div]:px-0">
                <Toggle checked={profile.mixed_balances} onChange={(v) => set({ mixed_balances: v })} label="Разнонаправленные остатки"
                  description="Одно юрлицо в кредите, другое держит свободные деньги" />
              </div>
            </>
          )}
        </SheetGroup>

        <SheetGroup title="Активность">
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="text-hint">Входов в ИБ и Альфа-Босс за 30 дней</span>
            <span className="shrink-0 font-medium tabular">{profile.logins_30d} · {ACT_LABEL(profile.logins_30d)}</span>
          </div>
          <input type="range" min={0} max={30} value={profile.logins_30d} onChange={(e) => set({ logins_30d: Number(e.target.value) })} aria-label="Входов за 30 дней" />
        </SheetGroup>

        <SheetGroup title="События">
          <div className="divide-y divide-sep [&>div]:px-0">
            <Toggle checked={profile.fx_payment} onChange={(v) => set({ fx_payment: v })} label="Валютный платёж сегодня" />
            <Toggle checked={profile.deposit_ending} onChange={(v) => set({ deposit_ending: v })} label="Депозит заканчивается через 14 дней" />
            <Toggle checked={profile.bki_request} onChange={(v) => set({ bki_request: v })} label="Запрос в БКИ: ищет кредит в другом банке" />
            <Toggle checked={profile.hidden_products.includes("working")} label="Скрыл баннер по оборотному кредиту"
              onChange={(v) => set({ hidden_products: v ? ["working"] : [] })} />
          </div>
        </SheetGroup>

        <SheetGroup title="Согласия">
          <div className="divide-y divide-sep [&>div]:px-0">
            <Toggle checked={profile.opt_out_email} onChange={(v) => set({ opt_out_email: v })} label="Отказ от email" />
            <Toggle checked={profile.opt_out_push} onChange={(v) => set({ opt_out_push: v })} label="Отказ от push" />
            <Toggle checked={profile.opt_out_all} onChange={(v) => set({ opt_out_all: v })} label="Отказ от всех маркетинговых коммуникаций" />
          </div>
        </SheetGroup>

        <Button className="mt-5" block variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => { setPreset("A"); setProfile(PRESETS[0].profile); }}>
          Сбросить к пресету A
        </Button>
      </Sheet>

      {/* «Предложение изменилось»: результат ниже или выше экрана.
          Над таб-баром: --app-bottom (тот же нижний отступ, что у таб-бара; на Android env() = 0) + 72 = таб-бар 58 px + рамка 1 px + зазор 13 px */}
      {pill && createPortal(
        <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
          style={{ bottom: "calc(var(--app-bottom) + 72px)" }}>
          <button type="button" onClick={goToResult}
            className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full bg-text px-5 text-[14px] font-medium text-bg shadow-[0_8px_24px_rgba(0,0,0,0.18)] ring-2 ring-bg transition-transform active:scale-[0.97] animate-fade-up">
            Предложение изменилось
            {pill === "down" ? <ArrowDown className="size-4" weight="bold" /> : <ArrowUp className="size-4" weight="bold" />}
          </button>
        </div>,
        document.body,
      )}
    </Screen>
  );
}
