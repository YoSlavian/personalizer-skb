import { AlertTriangle, ArrowRightLeft, BellOff, Route, Zap } from "lucide-react";
import { useState } from "react";
import { OfferCard } from "../../components/Offer";
import { Banner, Card, cx, Section, Tag } from "../../components/ui";
import { num } from "../../lib/format";
import type { DecisionResult } from "../../lib/types";

const ACTIVITY = { high: "высокая", mid: "средняя", low: "низкая" };
const SEGMENT = { S1: "S1 Группы", S2: "S2 АПК/сезон", S3: "S3 Онлайн", S4: "S4 ВЭД" } as Record<string, string>;

function Mult({ v }: { v: number }) {
  if (v === 0) return <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-medium text-white">×0</span>;
  if (v === 1) return <span className="text-[12px] text-hint">×1</span>;
  return (
    <span className={cx("rounded-md px-1.5 py-0.5 text-[11px] font-medium", v > 1 ? "bg-lime text-ink" : "bg-brand-soft text-brand")}>
      ×{String(Math.round(v * 100) / 100).replace(".", ",")}
    </span>
  );
}

const FACTORS = [
  ["k_industry", "Отрасль"],
  ["k_moment", "Момент"],
  ["k_role", "Роль"],
  ["k_structure", "Структура"],
  ["k_source", "Источник роли"],
] as const;

/** Разбор выбора: продукты по убыванию балла, полоса — доля от лучшего, чипы — только сработавшие поправки. */
function ScoreList({ r }: { r: DecisionResult }) {
  const [all, setAll] = useState(false);
  const max = Math.max(...r.rows.map((x) => x.total), 0.0001);
  const rows = all ? r.rows : r.rows.slice(0, 5);
  return (
    <div className="space-y-2">
      {rows.map((x, i) => {
        const win = r.winner?.code === x.code;
        const factors = FACTORS.filter(([k]) => x[k] !== 1);
        return (
          <Card key={x.code} className={cx("p-3.5", win && "ring-2 ring-brand", x.total === 0 && "opacity-60")}>
            <div className="flex items-start gap-3">
              <div className={cx("flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                win ? "bg-brand text-white" : "bg-subtle text-hint")}>{i + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[15px] font-medium leading-snug">{x.name}</div>
                  <div className="shrink-0 text-right">
                    <div className="font-display text-[17px] tabular leading-none">{num(x.total)}</div>
                    <div className="text-[11px] text-hint">балл</div>
                  </div>
                </div>
                {win && <div className="mt-1"><Tag tone="brand">Выбрано</Tag></div>}
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className={cx("h-full rounded-full", win ? "bg-brand" : "bg-ink/40")} style={{ width: `${(x.total / max) * 100}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className="rounded-md bg-subtle px-1.5 py-0.5 text-hint">база {num(x.base)}</span>
                  {factors.length === 0 && <span className="text-hint">без поправок</span>}
                  {factors.map(([k, label]) => (
                    <span key={k} className="inline-flex items-center gap-1"><span className="text-hint">{label}</span><Mult v={x[k]} /></span>
                  ))}
                </div>
                {x.why.length > 0 && <div className="mt-1.5 text-[12px] text-hint">Почему: {x.why.join(", ")}</div>}
                {x.excluded_reason && <div className="mt-1.5 text-[12px] text-brand">Исключён: {x.excluded_reason}</div>}
              </div>
            </div>
          </Card>
        );
      })}
      {r.rows.length > 5 && (
        <button type="button" onClick={() => setAll(!all)} className="w-full py-2 text-[14px] font-medium text-link">
          {all ? "Свернуть" : `Показать все продукты (${r.rows.length})`}
        </button>
      )}
    </div>
  );
}

export function DecisionSummary({ r }: { r: DecisionResult }) {
  if (r.suppressed) return <span className="text-hint">Ничего не отправляем — клиент отказался</span>;
  return (
    <span>
      <b>{r.offer?.product_name ?? "—"}</b>
      <span className="text-hint"> · {r.channels.map((c) => c.label.split(":")[0]).join(" + ") || "—"}</span>
    </span>
  );
}

export function DecisionView({ r, variant }: { r: DecisionResult; variant?: "test" | "control" }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone={r.completeness >= 50 ? "lime" : "brand"}>Полнота профиля {r.completeness}%</Tag>
        <Tag>Активность: {ACTIVITY[r.activity_level]}</Tag>
        {r.segments.map((s) => <Tag key={s} tone="violet">{SEGMENT[s] ?? s}</Tag>)}
        {variant && <Tag tone={variant === "test" ? "blue" : "neutral"}>{variant === "test" ? "A/B: тест" : "A/B: контроль (AS IS)"}</Tag>}
      </div>

      {r.suppressed ? (
        <Card className="flex items-start gap-3 p-4">
          <BellOff className="mt-0.5 size-5 text-hint" />
          <div>
            <div className="font-medium">Ничего не отправляем</div>
            <p className="text-[14px] text-hint">Клиент отказался от маркетинговых коммуникаций. Действие оптимизатора — «ничего не делать». Сервисные уведомления не затрагиваются.</p>
          </div>
        </Card>
      ) : (
        <>
          {r.fallback && (
            <Banner tone="warn" icon={<AlertTriangle className="size-4 text-warning" />}>
              <b>Данных мало.</b> Полнота профиля ниже порога: показываем AS IS, КМ получает задачу уточнить отрасль и роль в CRM.
            </Banner>
          )}
          {r.offer && (
            <OfferCard kicker={r.offer.product_name} headline={r.offer.headline} body={r.offer.body} cta={r.offer.cta} visual={r.visual_data} />
          )}
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Кому", r.recipient],
              ["Канал", r.channels.map((c) => c.label).join(" + ") || "—"],
              ["Частота", r.frequency],
              ["Следующее действие", r.nba],
            ].map(([k, v]) => (
              <div key={k} className="card px-3 py-2.5">
                <div className="text-[12px] text-hint">{k}</div>
                <div className="mt-0.5 text-[14px] font-medium leading-snug">{v}</div>
              </div>
            ))}
          </div>
          {r.routing && <Banner tone="info" icon={<Route className="size-4 text-blue" />}><b>Маршрутизация по роли:</b> {r.routing}.</Banner>}
          {r.event_note && <Banner tone="success" icon={<Zap className="size-4 text-success" />}>{r.event_note}.</Banner>}
          {r.notes.map((n) => <Banner key={n} tone="brand">{n}</Banner>)}
        </>
      )}

      <Section title="Было / стало">
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <Card className="p-3">
            <div className="mb-2 flex items-center gap-1 text-[12px] font-medium uppercase text-hint"><ArrowRightLeft className="size-3.5" /> AS IS</div>
            <dl className="space-y-1.5">
              <dt className="text-hint">Продукт</dt><dd>{r.as_is.product_name}</dd>
              <dt className="text-hint">Кому</dt><dd>{r.as_is.who}</dd>
              <dt className="text-hint">Текст</dt><dd>«{r.as_is.headline}»</dd>
              <dt className="text-hint">Канал</dt><dd>{r.as_is.channel}</dd>
              <dt className="text-hint">Частота</dt><dd>{r.as_is.frequency}</dd>
            </dl>
          </Card>
          <Card className="p-3 ring-2 ring-brand">
            <div className="mb-2 text-[12px] font-medium uppercase text-brand">TO BE</div>
            <dl className="space-y-1.5">
              <dt className="text-hint">Продукт</dt><dd className="font-medium">{r.suppressed ? "—" : r.offer?.product_name ?? "—"}</dd>
              <dt className="text-hint">Кому</dt><dd className="font-medium">{r.recipient}</dd>
              <dt className="text-hint">Текст</dt><dd className="font-medium">{r.offer ? `«${r.offer.headline}»` : "—"}</dd>
              <dt className="text-hint">Канал</dt><dd className="font-medium">{r.channels.map((c) => c.label).join(" + ") || "—"}</dd>
              <dt className="text-hint">Частота</dt><dd className="font-medium">{r.frequency}</dd>
            </dl>
          </Card>
        </div>
      </Section>

      <Section title="Почему именно это предложение">
        <ScoreList r={r} />
        <p className="mt-2 px-1 text-[12px] text-hint">
          Балл = базовый скор оптимизатора (склонность × доход) × поправки. Зелёные усиливают продукт, красные ослабляют, «×0» — исключает.
          До выбора работают фильтры: отказ от коммуникаций, лимиты частоты, 152-ФЗ, валютное законодательство.
        </p>
      </Section>
    </div>
  );
}
