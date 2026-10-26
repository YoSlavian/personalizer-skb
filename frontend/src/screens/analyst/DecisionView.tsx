import { Equals } from "@phosphor-icons/react";
import { AlertTriangle, BellOff, Check, ChevronDown, Route, X, Zap } from "../../components/icons";
import { type ReactNode, useState } from "react";
import { OfferCard } from "../../components/Offer";
import { Banner, cx, IconBadge, Section, Tag } from "../../components/ui";
import type { DecisionResult, ScoreRow } from "../../lib/types";

/**
 * Решение по клиенту, разобранное на блоки: что получит клиент, почему именно это, было / стало.
 * Блоки собирает симулятор (с метками «изменилось») и карточка клиента (DecisionView целиком).
 */

const ACTIVITY = { high: "высокая", mid: "средняя", low: "низкая" };
const SEGMENT = { S1: "S1 Группы", S2: "S2 АПК/сезон", S3: "S3 Онлайн", S4: "S4 ВЭД" } as Record<string, string>;
// Причины из скоринга, которые относятся к структуре бизнеса, а не к моменту
const STRUCTURE_WHY = new Set(["разнонаправленные остатки", "группа компаний"]);

const dec2 = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
/** Множитель поправки: ×1,82 */
export const mult = (v: number) => `×${dec2(v)}`;
/** Балл: два знака, для малых значений три — иначе 0,045 превращается в 0,05 */
export const score = (v: number) => {
  let s = v >= 0.1 || v === 0 ? v.toFixed(2) : v.toFixed(3);
  if (s.length > 4 && s.endsWith("0")) s = s.slice(0, -1); // 0,070 → 0,07
  return s.replace(".", ",");
};
const productsWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "продукта" : "продуктов");
export const channelNames = (r: DecisionResult) => r.channels.map((c) => c.label.split(":")[0].trim());

/* ───────────── Что получит клиент ───────────── */

export type FactKey = "product" | "recipient" | "channel" | "frequency" | "nba";
export function factsOf(r: DecisionResult): Record<FactKey, string> {
  return {
    product: r.suppressed ? "Не предлагаем" : r.offer?.product_name ?? "—",
    recipient: r.recipient,
    channel: r.channels.map((c) => c.label).join(" + ") || "—",
    frequency: r.frequency,
    nba: r.nba,
  };
}
const FACT_LABEL: [FactKey, string][] = [
  ["product", "Продукт"],
  ["recipient", "Кому"],
  ["channel", "Канал"],
  ["frequency", "Частота"],
  ["nba", "Действие"],
];

/** «ФД головной (3 юрлица = 1 получатель)» → основная строка + пояснение второй строкой */
function splitParen(s: string): [string, string | null] {
  const m = /^(.*?)\s*\((.+)\)$/.exec(s);
  return m ? [m[1], m[2]] : [s, null];
}

export function ChannelTags({ r }: { r: DecisionResult }) {
  const names = channelNames(r);
  if (!names.length) return null;
  return (
    <ul aria-label="Каналы" className="flex flex-wrap gap-1.5">
      {names.map((n, i) => (
        <li key={`${n}-${i}`}
          className={cx("inline-flex h-8 max-w-full items-center truncate rounded-full px-3.5 text-[13px] font-medium",
            i === 0 ? "bg-text text-bg" : "bg-surface text-hint")}>
          {n}
        </li>
      ))}
    </ul>
  );
}

/** Карточка фактов: продукт, получатель, канал, частота, следующее действие. changed — строки с меткой «изменилось». */
export function ResultFacts({ r, changed }: { r: DecisionResult; changed?: ReadonlySet<FactKey> }) {
  const f = factsOf(r);
  return (
    <dl className="card divide-y divide-sep overflow-hidden">
      {FACT_LABEL.map(([k, label]) => {
        const [main, sub] = k === "recipient" ? splitParen(f[k]) : [f[k], null];
        const isChanged = changed?.has(k);
        return (
          <div key={k} className="grid grid-cols-[76px_minmax(0,1fr)] gap-2 px-4 py-3">
            <dt className="pt-px text-[13px] text-hint">{label}</dt>
            <dd className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[14px] font-medium leading-snug">{main}</span>
                {isChanged && <span className="animate-fade"><Tag tone="lime">изменилось</Tag></span>}
              </div>
              {sub && <div className="mt-0.5 text-[13px] leading-snug text-hint">{sub}</div>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function SuppressedCard() {
  return (
    <div className="card flex items-start gap-3 p-4 animate-fade">
      <div className="shrink-0"><IconBadge tone="neutral"><BellOff className="size-5" /></IconBadge></div>
      <div className="min-w-0">
        <div className="text-[16px] font-medium">Ничего не отправляем</div>
        <p className="mt-0.5 text-[14px] leading-snug text-hint">Клиент отказался от маркетинга — сервисные уведомления приходят как раньше.</p>
      </div>
    </div>
  );
}

export function FallbackBanner({ r }: { r: DecisionResult }) {
  if (!r.fallback) return null;
  return (
    <Banner tone="warn" icon={<AlertTriangle className="size-4 text-warning" weight="fill" />}>
      <b className="font-medium">Данных мало ({r.completeness}%).</b> Показываем AS IS, КМ уточнит отрасль и роль в CRM.
    </Banner>
  );
}

export function ResultBanners({ r }: { r: DecisionResult }) {
  if (r.suppressed || (!r.routing && !r.event_note && !r.notes.length)) return null;
  return (
    <div className="space-y-2">
      {r.routing && <Banner tone="info" icon={<Route className="size-4 text-hint" />}>{r.routing}</Banner>}
      {r.event_note && <Banner tone="info" icon={<Zap className="size-4 text-brand" weight="fill" />}>{r.event_note}</Banner>}
      {r.notes.map((n) => <Banner key={n} tone="brand">{n}</Banner>)}
    </div>
  );
}

/* ───────────── Почему именно это ───────────── */

function Step({ n, title, sub, right }: { n: number; title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-[12px] font-medium tabular">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium leading-snug">{title}</div>
        <div className="mt-0.5 text-[13px] leading-snug text-hint">{sub}</div>
      </div>
      {right !== undefined && (
        <div className="shrink-0 font-display text-[16px] tabular">
          {/* tabular-nums в подмножестве шрифта подменяет «×» на «=» — знак выводим без него */}
          {typeof right === "string" && right.startsWith("×") ? <><span className="[font-variant-numeric:normal]">×</span>{right.slice(1)}</> : right}
        </div>
      )}
    </div>
  );
}

/** Конвейер решения: скор оптимизатора → фильтры → что и когда → кому → как → итог. */
export function WhyPipeline({ r, industryName }: { r: DecisionResult; industryName?: string }) {
  const w = r.winner;
  const excluded = r.rows.filter((x) => x.total === 0).length;
  const moments = (w?.why ?? []).filter((x) => !STRUCTURE_WHY.has(x));
  const structureWhy = (w?.why ?? []).filter((x) => STRUCTURE_WHY.has(x));

  let what = "без поправок";
  let who = "без поправок";
  if (w) {
    const parts: string[] = [];
    if (w.k_industry !== 1) parts.push(`${industryName ?? "отрасль"} ${mult(w.k_industry)}`);
    if (w.k_moment !== 1) parts.push(`${moments.join(", ") || "момент"} ${mult(w.k_moment)}`);
    if (parts.length) what = parts.join(" · ");
    const role = !r.role ? "роли нет в CRM: нейтральный текст" : w.k_source < 1 ? `роль выведена: ${r.role_name?.toLowerCase()}` : `роль из CRM: ${r.role_name?.toLowerCase()}`;
    const whoParts = [role];
    if (w.k_structure !== 1) whoParts.push(`${structureWhy[0] ?? "группа"} ${mult(w.k_structure)}`);
    who = whoParts.join(" · ");
  }
  const channels = channelNames(r);
  const rank = w ? r.rows.findIndex((x) => x.code === w.code) + 1 : 0;
  const n = r.rows.length;

  return (
    <div className="card divide-y divide-sep overflow-hidden">
      <Step n={1} title="ML-скор оптимизатора" sub="склонность × доход, AS IS" right={w ? score(w.base) : "—"} />
      <Step n={2} title="Фильтры"
        sub={r.suppressed ? "отказ от маркетинговых коммуникаций" : excluded ? `отказы, лимиты, согласия: −${excluded}` : "отказы, лимиты, согласия"}
        right={r.suppressed ? <X className="size-5 text-brand" weight="bold" aria-label="Не прошёл" /> : <Check className="size-5" weight="bold" aria-label="Пройдены" />} />
      <Step n={3} title="Что и когда" sub={what} right={w ? mult(w.k_industry * w.k_moment) : undefined} />
      <Step n={4} title="Кому" sub={who} right={w ? mult(w.k_role * w.k_structure * w.k_source) : undefined} />
      <Step n={5} title="Как" sub={channels.length ? `${ACTIVITY[r.activity_level]} активность → ${channels.join(" + ")}` : "канала нет: ничего не отправляем"} />
      <div className="flex items-center gap-3 bg-creative px-4 py-3.5 text-white">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-lime text-ink">
          {w && !r.suppressed ? <Equals className="size-4" weight="bold" /> : <BellOff className="size-4" weight="bold" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] font-medium leading-snug">{w && !r.suppressed ? w.name : "Ничего не отправляем"}</div>
          <div className="text-[13px] text-white/60">
            {!w || r.suppressed ? "клиент отказался" : rank === 1 ? `лучший из ${n} ${productsWord(n)}` : `событие важнее скора · ${rank}-й из ${n}`}
          </div>
        </div>
        <div className="shrink-0 font-display text-[20px] text-lime tabular">{w && !r.suppressed ? score(w.total) : "0"}</div>
      </div>
    </div>
  );
}

const FACTORS = [
  ["k_industry", "Отрасль"],
  ["k_moment", "Момент"],
  ["k_role", "Роль"],
  ["k_structure", "Структура"],
  ["k_source", "Источник"],
] as const;

function Factor({ label, v }: { label: string; v: number }) {
  const cls = v === 0 ? "bg-text text-bg" : v > 1 ? "bg-lime text-ink" : "bg-brand-soft text-brand";
  return <span className={cx("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap", cls)}>{label} {mult(v)}</span>;
}

/** Все продукты по убыванию балла: полоса — доля от лучшего, чипы — сработавшие поправки. */
export function ScoreList({ r }: { r: DecisionResult }) {
  const max = Math.max(...r.rows.map((x) => x.total), 0.0001);
  return (
    <ol className="card divide-y divide-sep overflow-hidden">
      {r.rows.map((x: ScoreRow, i) => {
        const win = r.winner?.code === x.code;
        const factors = FACTORS.filter(([k]) => x[k] !== 1);
        return (
          <li key={x.code} className={cx("flex items-start gap-3 px-4 py-3", x.total === 0 && "opacity-60")}>
            <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-medium tabular",
              win ? "bg-brand text-white" : "bg-subtle text-hint")}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 text-[14px] font-medium leading-snug">{x.name}</div>
                <div className="shrink-0 font-display text-[15px] tabular">{score(x.total)}</div>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-subtle">
                <div className={cx("h-full rounded-full", win ? "bg-brand" : "bg-text/25")} style={{ width: `${(x.total / max) * 100}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="inline-flex h-5 items-center rounded-full bg-subtle px-2 text-[11px] text-hint tabular">база {score(x.base)}</span>
                {factors.map(([k, label]) => <Factor key={k} label={label} v={x[k]} />)}
              </div>
              {x.excluded_reason ? (
                <div className="mt-1.5 text-[12px] text-brand">Исключён: {x.excluded_reason}</div>
              ) : x.why.length > 0 ? (
                <div className="mt-1.5 text-[12px] text-hint">{x.why.join(", ")}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Раскрывающийся список всех продуктов под конвейером. */
export function AllProducts({ r, open, onToggle, id }: { r: DecisionResult; open: boolean; onToggle: () => void; id?: string }) {
  return (
    <div id={id} className="mt-2 scroll-mt-4">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-surface text-[14px] font-medium transition-transform active:scale-[0.97]">
        Все продукты ({r.rows.length})
        <ChevronDown className={cx("size-4 text-hint transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 animate-fade">
          <ScoreList r={r} />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] text-hint">
            <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-lime" />усиливает</span>
            <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-brand" />ослабляет</span>
            <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-text" />×0 — исключает</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── Было / стало ───────────── */

export function AsIsToBe({ r }: { r: DecisionResult }) {
  const asis: [string, string][] = [
    ["Продукт", r.as_is.product_name],
    ["Кому", r.as_is.who],
    ["Текст", `«${r.as_is.headline}»`],
    ["Канал", r.as_is.channel],
    ["Частота", r.as_is.frequency],
  ];
  const tobe: [string, string][] = [
    ["Продукт", r.suppressed ? "—" : r.offer?.product_name ?? "—"],
    ["Кому", r.recipient],
    ["Текст", r.offer && !r.suppressed ? `«${r.offer.headline}»` : "—"],
    ["Канал", r.channels.map((c) => c.label).join(" + ") || "—"],
    ["Частота", r.frequency],
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-[18px] bg-surface p-3.5">
        <Tag>AS IS</Tag>
        <dl className="mt-1 text-[13px] leading-snug">
          {asis.map(([k, v]) => (
            <div key={k} className="mt-2.5">
              <dt className="text-[11px] text-hint">{k}</dt>
              <dd className="mt-0.5 text-text/75 [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {/* Инвертированная подложка: чёрная в светлой теме, белая в тёмной — «стало» всегда контрастно к «было» */}
      <div className="rounded-[18px] bg-text p-3.5 text-bg">
        <Tag tone="lime">TO BE</Tag>
        <dl className="mt-1 text-[13px] leading-snug">
          {tobe.map(([k, v]) => (
            <div key={k} className="mt-2.5">
              <dt className="text-[11px] text-bg/55">{k}</dt>
              <dd className="mt-0.5 font-medium [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/* ───────────── Сводки ───────────── */

export function DecisionSummary({ r }: { r: DecisionResult }) {
  if (r.suppressed) return <span className="text-hint">Ничего не отправляем — клиент отказался</span>;
  return (
    <span>
      <b className="font-medium">{r.offer?.product_name ?? "—"}</b>
      <span className="text-hint"> · {channelNames(r).join(" + ") || "—"}</span>
    </span>
  );
}

/**
 * Решение целиком — для карточки клиента. variant — группа A/B, в которой клиент.
 * Полноту профиля самого клиента показывает вкладка «Профиль», здесь её не дублируем.
 * groupLevel — решение принято по головной: тогда показываем полноту профиля головной, с явной подписью.
 */
export function DecisionView({ r, variant, industryName, groupLevel }: { r: DecisionResult; variant?: "test" | "control"; industryName?: string; groupLevel?: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {variant && <Tag tone={variant === "test" ? "violet" : "neutral"}>{variant === "test" ? "A/B: тест" : "A/B: контроль (AS IS)"}</Tag>}
        {groupLevel && <Tag tone={r.completeness >= 50 ? "neutral" : "brand"}>Полнота профиля головной {r.completeness}%</Tag>}
        <Tag>Активность: {ACTIVITY[r.activity_level]}</Tag>
        {r.segments.map((s) => <Tag key={s}>{SEGMENT[s] ?? s}</Tag>)}
      </div>
      <div className="mt-3"><ChannelTags r={r} /></div>
      {r.fallback && <div className="mt-3"><FallbackBanner r={r} /></div>}
      <div className="mt-3">
        {r.suppressed ? <SuppressedCard /> : r.offer && (
          <OfferCard kicker={r.offer.product_name} headline={r.offer.headline} body={r.offer.body} cta={r.offer.cta} visual={r.visual_data} />
        )}
      </div>
      <div className="mt-3"><ResultFacts r={r} /></div>
      {!r.suppressed && (r.routing || r.event_note || r.notes.length > 0) && <div className="mt-3"><ResultBanners r={r} /></div>}

      <Section title="Почему именно это">
        <WhyPipeline r={r} industryName={industryName} />
        <AllProducts r={r} open={all} onToggle={() => setAll((v) => !v)} />
      </Section>

      <Section title="Было / стало">
        <AsIsToBe r={r} />
      </Section>
    </div>
  );
}
