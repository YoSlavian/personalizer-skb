import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Megaphone, SlidersHorizontal } from "../../components/icons";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { Hint } from "../../components/Hint";
import { BellButton, Screen } from "../../components/Layout";
import { Card, cx, ErrorState, IconBadge, List, Row, Section, Segmented, Skeleton } from "../../components/ui";
import { get } from "../../lib/api";
import { dec, pct } from "../../lib/format";
import type { Analytics } from "../../lib/types";

type Tone = "good" | "bad" | "flat";

/** Относительное изменение теста к контролю. better: в какую сторону изменение — хорошо. */
function delta(test: number | null | undefined, control: number | null | undefined, better: "up" | "down" = "up"): { text: string; tone: Tone } | null {
  if (test === null || test === undefined || control === null || control === undefined || control === 0) return null;
  return deltaOf((test - control) / control, better);
}

function deltaOf(rel: number | null | undefined, better: "up" | "down" = "up"): { text: string; tone: Tone } | null {
  if (rel === null || rel === undefined || !Number.isFinite(rel)) return null;
  const r = Math.round(rel * 100);
  if (Math.abs(r) < 2) return { text: "=", tone: "flat" };
  const good = better === "up" ? r > 0 : r < 0;
  return { text: `${r > 0 ? "+" : "−"}${Math.abs(r)}%`, tone: good ? "good" : "bad" };
}

function DeltaPill({ d, onDark }: { d: { text: string; tone: Tone } | null; onDark?: boolean }) {
  if (!d) return null;
  const cls =
    d.tone === "good" ? "bg-lime text-ink"
    : d.tone === "bad" ? (onDark ? "bg-brand text-white" : "bg-brand-soft text-brand")
    : onDark ? "bg-white/15 text-white" : "bg-subtle text-hint";
  // tabular-nums в подмножестве шрифта подменяет «=» на «×» — у плашки «без изменений» его не включаем
  return <span className={cx("inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[12px] font-medium whitespace-nowrap", d.tone !== "flat" && "tabular", cls)}>{d.text}</span>;
}

function Kpi({ label, value, control, d }: { label: string; value: ReactNode; control: ReactNode; d?: { text: string; tone: Tone } | null }) {
  return (
    <div className="min-w-0 rounded-[18px] bg-surface p-3.5">
      <div className="truncate text-[12px] text-hint">{label}</div>
      <div className="mt-1.5 flex items-center justify-between gap-1.5">
        <span className="truncate font-display text-[22px] leading-none tabular">{value}</span>
        <DeltaPill d={d ?? null} />
      </div>
      <div className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-hint">{control}</div>
    </div>
  );
}

const hours = (h: number | null | undefined) => (h === null || h === undefined ? "—" : `${dec(h)} ч`);
function seconds(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return m ? `${m} мин ${s % 60} с` : `${s} с`;
}

function CrChart({ data }: { data: Analytics["weekly"] }) {
  const pts = data.filter((d) => d.test_cr !== null || d.control_cr !== null);
  if (pts.length < 2) return <p className="px-4 py-6 text-center text-[13px] text-hint">Недостаточно недель для графика</p>;
  const max = Math.max(0.01, ...pts.flatMap((d) => [d.test_cr ?? 0, d.control_cr ?? 0]));
  const W = 320, H = 120, P = 8;
  const x = (i: number) => P + (i * (W - 2 * P)) / (pts.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = (key: "test_cr" | "control_cr") => pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key] ?? 0).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <figure className="px-4 pb-3.5 pt-3">
      <div className="flex items-baseline justify-between text-[12px] text-hint">
        <span>макс. {pct(max)}</span>
        <span>{pts.length} нед.</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-32 w-full overflow-visible" role="img" aria-label="CR показ → заявка по неделям: тест и контроль">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} stroke="var(--separator)" strokeWidth={1} />
        ))}
        <path d={line("control_cr")} fill="none" stroke="var(--hint)" strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
        <path d={line("test_cr")} fill="none" stroke="var(--brand)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(last.test_cr ?? 0)} r={4} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} />
      </svg>
      <figcaption className="mt-2 flex gap-4 text-[12px] text-hint">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-brand" />Тест</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-hint" />Контроль (AS IS)</span>
      </figcaption>
    </figure>
  );
}

function PilotSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка">
      <Skeleton className="mt-4 h-[156px] rounded-[24px]" />
      <div className="mt-2 grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] rounded-[18px]" />)}</div>
    </div>
  );
}

export function AnalystHome() {
  const navigate = useNavigate();
  const [days, setDays] = useState("90");
  // При смене периода держим прошлые цифры, пока грузятся новые — страница не прыгает
  const a = useQuery({ queryKey: ["analytics", days], queryFn: () => get<Analytics>(`/analytics/overview?days=${days}`), placeholderData: keepPreviousData });
  const t = a.data?.variants.test;
  const c = a.data?.variants.control;
  const p = a.data?.significance_cr.p_value;
  const hasP = p !== null && p !== undefined;
  const pText = hasP ? p.toFixed(3).replace(".", ",") : "";

  return (
    <Screen title="Пилот" subtitle="Тест — персонализация, контроль — текущий оптимизатор (AS IS)" right={<BellButton />}>
      <Hint id="pilot" steps={[
        "Тест получает персональные предложения, контроль — как сейчас (AS IS).",
        "Чёрная карточка — демо-расчёт CR показ → заявка и z-тест; главная метрика пилота — CR90 по группам и компаниям.",
        "Плашки: лайм — лучше контроля, красная — хуже, «=» — без изменений.",
      ]} />
      <div className="mt-4">
        <Segmented ariaLabel="Период" value={days} onChange={setDays}
          options={[{ value: "30", label: "30 дней" }, { value: "90", label: "90 дней" }, { value: "180", label: "180 дней" }]} />
      </div>
      {a.isError && <div className="mt-4"><ErrorState error={a.error} onRetry={() => a.refetch()} /></div>}
      {a.isLoading && <PilotSkeleton />}
      {a.data && t && c && (
        <div className={cx("animate-fade transition-opacity", a.isPlaceholderData && "opacity-60")} aria-busy={a.isPlaceholderData || undefined}>
          <section className="mt-4 rounded-[24px] bg-creative p-5 text-white" aria-label="Демо-расчёт CR показ → заявка">
            <div className="text-[13px] text-white/60">CR показ → заявка · демо-расчёт</div>
            <div className="mt-2.5 flex items-center gap-2.5">
              <span className="font-display text-[44px] leading-[0.9] tabular">{pct(t.cr, 2)}</span>
              <DeltaPill d={deltaOf(a.data.uplift.cr)} onDark />
            </div>
            <div className="mt-3 text-[13px] text-white/75">
              контроль {pct(c.cr, 2)} · {hasP ? <>z-тест p = {pText} · {p < 0.05 ? "значимо" : "не значимо"}</> : "недостаточно данных для z-теста"}
            </div>
            <div className="mt-1 text-[12px] text-white/50">Вывод — только по окончании окна пилота на заранее рассчитанной выборке.</div>
          </section>
          <p className="mt-2 px-1 text-[12px] leading-snug text-hint">{a.data.disclaimer}</p>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Kpi label="CTR" value={pct(t.ctr)} control={`контроль ${pct(c.ctr)}`} d={deltaOf(a.data.uplift.ctr)} />
            <Kpi label="Time to Action" value={hours(t.time_to_action_hours)} control={`контроль ${hours(c.time_to_action_hours)}`}
              d={delta(t.time_to_action_hours, c.time_to_action_hours, "down")} />
            <Kpi label="Просмотр → сделка" value={pct(t.view_to_deal)} control={`контроль ${pct(c.view_to_deal)} · база\u00a00,5%`}
              d={delta(t.view_to_deal, c.view_to_deal)} />
            <Kpi label="Отписки и скрытия" value={t.opt_outs + t.hidden} control={`контроль ${c.opt_outs + c.hidden}`}
              d={delta(t.opt_outs + t.hidden, c.opt_outs + c.hidden, "down")} />
            <Kpi label="Сообщений на группу" value={dec(t.messages_per_group_week, 2)} control={`контроль ${dec(c.messages_per_group_week, 2)} · в нед.`}
              d={delta(t.messages_per_group_week, c.messages_per_group_week, "down")} />
            <Kpi label="Компаний" value={t.organizations} control={`контроль ${c.organizations}`} />
          </div>

          <Section title="CR показ → заявка по неделям">
            <Card><CrChart data={a.data.weekly} /></Card>
          </Section>

          <Section title="Адаптивный путь (UX-метрики)">
            <List>
              <Row title="Дошли до заявки" subtitle={`без адаптации ${pct(a.data.journey.static.apply_rate, 0)}`}
                right={<span className="font-display text-[17px] tabular">{pct(a.data.journey.adaptive.apply_rate, 0)}</span>} />
              <Row title="Время до заявки" subtitle={`медиана · без адаптации ${seconds(a.data.journey.static.median_time_to_apply_sec)}`}
                right={<span className="font-display text-[17px] tabular">{seconds(a.data.journey.adaptive.median_time_to_apply_sec)}</span>} />
              <Row title="Ушли после расчёта" subtitle={`drop-off калькулятор → заявка · без адаптации ${pct(a.data.journey.static.dropoff_calc_to_form, 0)}`}
                right={<span className="font-display text-[17px] tabular">{pct(a.data.journey.adaptive.dropoff_calc_to_form, 0)}</span>} />
              <Row title="Подсказок закрыто" subtitle="контроль раздражения"
                right={<span className="font-display text-[17px] tabular">{a.data.journey.adaptive.hints_closed}/{a.data.journey.adaptive.hints_shown}</span>} />
            </List>
          </Section>

          <Section title="По сегментам">
            <List>
              {a.data.segments.map((s) => (
                <Row key={s.code}
                  left={<span className="flex size-10 items-center justify-center rounded-[14px] bg-subtle font-display text-[13px]">{s.code}</span>}
                  title={s.name}
                  subtitle={`CR ${pct(s.test.cr)} · контроль ${pct(s.control.cr)} · показов ${s.test.shown}/${s.control.shown}`}
                  right={<DeltaPill d={deltaOf(s.uplift_cr) ?? { text: "—", tone: "flat" }} />} />
              ))}
            </List>
          </Section>

          <Section title="Действия">
            <List>
              <Row onClick={() => navigate("/campaign")} left={<IconBadge tone="neutral"><Megaphone className="size-5" /></IconBadge>}
                title="Кампания" subtitle="Прогон оптимизатора с лимитами частоты" />
              <Row onClick={() => navigate("/")} left={<IconBadge tone="neutral"><SlidersHorizontal className="size-5" /></IconBadge>}
                title="Симулятор" subtitle="Профиль → предложение, канал, частота" />
            </List>
          </Section>
          <p className="mt-4 px-1 text-[12px] leading-snug text-hint">Рандомизация — по группе. Главная метрика пилота — CR90 по группам и компаниям; z-тест по показам — демонстрация расчёта.</p>
        </div>
      )}
    </Screen>
  );
}
