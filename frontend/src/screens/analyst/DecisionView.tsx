import { AlertTriangle, ArrowRightLeft, BellOff, Route, Zap } from "lucide-react";
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
        <Card className="overflow-hidden">
          <p className="px-4 pt-3 text-[12px] text-hint">Скор = склонность × доход (AS IS) × K отрасли × K момента × K роли × K структуры × вес источника роли. Нулевой коэффициент исключает продукт.</p>
          <div className="mt-2 overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase text-hint">
                  <th className="px-4 py-2 font-medium">Продукт</th><th className="py-2 font-medium">AS IS</th><th className="py-2 font-medium">Отр.</th>
                  <th className="py-2 font-medium">Момент</th><th className="py-2 font-medium">Роль</th><th className="py-2 font-medium">Стр.</th><th className="py-2 pr-4 text-right font-medium">Итог</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.slice(0, 8).map((x) => (
                  <tr key={x.code} className={cx("border-t border-sep align-top", r.winner?.code === x.code && "bg-brand-soft", x.total === 0 && "opacity-55")}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{x.name}</div>
                      {x.why.length > 0 && <div className="text-[11px] text-hint">{x.why.join(", ")}</div>}
                      {x.excluded_reason && <div className="text-[11px] text-hint">{x.excluded_reason}</div>}
                    </td>
                    <td className="py-2 tabular">{num(x.base)}</td>
                    <td className="py-2"><Mult v={x.k_industry} /></td>
                    <td className="py-2"><Mult v={x.k_moment} /></td>
                    <td className="py-2"><Mult v={x.k_role} />{x.k_source !== 1 && <> <Mult v={x.k_source} /></>}</td>
                    <td className="py-2"><Mult v={x.k_structure} /></td>
                    <td className="py-2 pr-4 text-right font-medium tabular">{num(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 pb-3 pt-2 text-[12px] text-hint">Фильтры до выбора: отказ от коммуникаций, лимиты частоты, 152-ФЗ, валютное законодательство. Коэффициенты стартовые, калибруются на пилоте.</p>
        </Card>
      </Section>
    </div>
  );
}
