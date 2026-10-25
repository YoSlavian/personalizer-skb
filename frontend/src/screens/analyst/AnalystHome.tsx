import { useQuery } from "@tanstack/react-query";
import { Megaphone, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { BellButton, Screen } from "../../components/Layout";
import { Banner, Card, Chips, ErrorState, IconBadge, Section, Skeleton, Stat } from "../../components/ui";
import { get } from "../../lib/api";
import { dec, pct, signedPct } from "../../lib/format";
import type { Analytics } from "../../lib/types";

function CrChart({ data }: { data: Analytics["weekly"] }) {
  const pts = data.filter((d) => d.test_cr !== null || d.control_cr !== null);
  if (pts.length < 2) return <p className="px-4 py-6 text-center text-[13px] text-hint">Недостаточно недель для графика</p>;
  const max = Math.max(0.01, ...pts.flatMap((d) => [d.test_cr ?? 0, d.control_cr ?? 0]));
  const W = 320, H = 120, P = 8;
  const x = (i: number) => P + (i * (W - 2 * P)) / (pts.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = (key: "test_cr" | "control_cr") => pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key] ?? 0).toFixed(1)}`).join(" ");
  return (
    <figure className="px-4 pb-3 pt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" role="img" aria-label="CR в заявку по неделям: тест и контроль">
        <path d={line("control_cr")} fill="none" stroke="var(--hint)" strokeWidth={2} strokeDasharray="4 4" />
        <path d={line("test_cr")} fill="none" stroke="var(--brand)" strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
      <figcaption className="flex gap-4 text-[12px] text-hint">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-brand" />Тест (персонализация)</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-hint" />Контроль (AS IS)</span>
      </figcaption>
    </figure>
  );
}

export function AnalystHome() {
  const me = useMe();
  const navigate = useNavigate();
  const [days, setDays] = useState("90");
  const a = useQuery({ queryKey: ["analytics", days], queryFn: () => get<Analytics>(`/analytics/overview?days=${days}`) });
  const t = a.data?.variants.test;
  const c = a.data?.variants.control;
  const p = a.data?.significance_cr.p_value;

  return (
    <Screen title="Пилот персонализации" subtitle={`${me.user.full_name} · A/B: персонализация против AS IS`} right={<BellButton />}>
      <div className="mt-4"><Chips ariaLabel="Период" value={days} onChange={setDays} options={[{ value: "30", label: "30 дней" }, { value: "90", label: "90 дней" }, { value: "180", label: "180 дней" }]} /></div>
      {a.isError && <div className="mt-4"><ErrorState error={a.error} onRetry={() => a.refetch()} /></div>}
      {a.isLoading && <div className="mt-4 grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[86px] rounded-[18px]" />)}</div>}
      {a.data && t && c && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Stat label="CR в заявку · тест" value={pct(t.cr)} hint={`контроль ${pct(c.cr)} · ${signedPct(a.data.uplift.cr)}`} tone="brand" />
            <Stat label="CTR · тест" value={pct(t.ctr)} hint={`контроль ${pct(c.ctr)} · ${signedPct(a.data.uplift.ctr)}`} />
            <Stat label="Time to Action" value={t.time_to_action_hours !== null ? `${dec(t.time_to_action_hours)} ч` : "—"} hint={`контроль ${dec(c.time_to_action_hours)} ч`} />
            <Stat label="Просмотр → сделка" value={pct(t.view_to_deal)} hint={`контроль ${pct(c.view_to_deal)} · база 0,5%`} />
            <Stat label="Сообщений на группу в нед." value={dec(t.messages_per_group_week, 2)} hint={`контроль ${dec(c.messages_per_group_week, 2)}`} />
            <Stat label="Отписки и скрытия" value={t.opt_outs + t.hidden} hint={`контроль ${c.opt_outs + c.hidden}`} />
          </div>
          <div className="mt-3">
            <Banner tone={p !== null && p !== undefined && p < 0.05 ? "success" : "warn"}>
              {p === null || p === undefined ? "Недостаточно данных для z-теста." : p < 0.05
                ? `Разница CR статистически значима (z-тест, p = ${p.toFixed(3).replace(".", ",")}).`
                : `Разница CR пока не значима (p = ${p.toFixed(3).replace(".", ",")}): нужно больше показов — продолжаем пилот.`}
            </Banner>
          </div>

          <Section title="CR в заявку по неделям">
            <Card><CrChart data={a.data.weekly} /></Card>
          </Section>

          <Section title="Адаптивный путь (UX-метрики)">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Дошли до заявки" value={pct(a.data.journey.adaptive.apply_rate, 0)} hint={`без адаптации ${pct(a.data.journey.static.apply_rate, 0)}`} tone="brand" />
              <Stat label="Время до заявки" value={a.data.journey.adaptive.median_time_to_apply_sec ? `${a.data.journey.adaptive.median_time_to_apply_sec} с` : "—"}
                hint={`без адаптации ${a.data.journey.static.median_time_to_apply_sec ?? "—"} с`} />
              <Stat label="Drop-off калькулятор → заявка" value={pct(a.data.journey.adaptive.dropoff_calc_to_form, 0)} hint={`без адаптации ${pct(a.data.journey.static.dropoff_calc_to_form, 0)}`} />
              <Stat label="Подсказок закрыто" value={`${a.data.journey.adaptive.hints_closed}/${a.data.journey.adaptive.hints_shown}`} hint="контроль раздражения" />
            </div>
          </Section>

          <Section title="По сегментам">
            <div className="card divide-y divide-sep overflow-hidden">
              {a.data.segments.map((s) => (
                <div key={s.code} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">{s.code} · {s.name}</div>
                    <div className="text-[13px] text-hint">CR {pct(s.test.cr)} против {pct(s.control.cr)} · показов {s.test.shown}/{s.control.shown}</div>
                  </div>
                  <span className="font-display text-[16px] tabular">{signedPct(s.uplift_cr)}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Действия">
            <div className="grid grid-cols-2 gap-2">
              <Card className="p-4" onClick={() => navigate("/campaign")}>
                <IconBadge><Megaphone className="size-4" /></IconBadge>
                <div className="mt-2 font-medium">Кампания</div>
                <div className="text-[13px] text-hint">Прогон оптимизатора с лимитами частоты</div>
              </Card>
              <Card className="p-4" onClick={() => navigate("/simulator")}>
                <IconBadge tone="violet"><SlidersHorizontal className="size-4" /></IconBadge>
                <div className="mt-2 font-medium">Симулятор</div>
                <div className="text-[13px] text-hint">Профиль → предложение, канал, частота</div>
              </Card>
            </div>
          </Section>
          <p className="mt-4 px-1 text-[12px] text-hint">{a.data.disclaimer} Рандомизация A/B — на уровне группы компаний.</p>
        </>
      )}
    </Screen>
  );
}
