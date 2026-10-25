import { Banner, Card, List, Row, Section } from "../../components/ui";
import { num } from "../../lib/format";

export interface GroupPlan {
  name: string;
  main_industry: { industry: string | null; share: number; diversified: boolean; top: string | null };
  group_products: { code: string; name: string; score: number; why: string[] }[];
  entity_offers: { name: string; industry_name: string; balance: string; product_name: string | null; score: number | null }[];
  plan: { week: number; who: string; product_name: string; why: string; score: number }[];
  before: string;
  rules: string[];
}

const COLORS = ["#EF3124", "#2B72FE", "#6F2AFF", "#A9F000"];

export function GroupPlanView({ plan }: { plan: GroupPlan }) {
  const m = plan.main_industry;
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="font-medium">{plan.name}: группа = один клиент</div>
        <div className="mt-3 space-y-2.5">
          {plan.entity_offers.map((e) => (
            <div key={e.name}>
              <div className="flex items-baseline justify-between text-[14px]">
                <span className="font-medium">{e.name}</span>
                <span className="text-hint">{e.industry_name} · {e.balance === "credit" ? "кредит" : "свободные остатки"}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          {m.diversified ? (
            <Banner tone="warn"><b>Диверсифицированная группа:</b> ни одна отрасль не даёт ≥50% оборотов (максимум {m.share}%). На уровне группы — только универсальные продукты ликвидности.</Banner>
          ) : (
            <Banner tone="success"><b>Отрасль группы определена</b> — {m.share}% оборотов РКО (порог ≥50%).</Banner>
          )}
        </div>
      </Card>

      <Section title="Уровень группы → ФД или казначей головной">
        <List>
          {plan.group_products.length === 0 && <Row title="Групповых продуктов нет" />}
          {plan.group_products.map((g) => <Row key={g.code} title={g.name} subtitle={g.why.join(", ") || undefined} right={<span className="tabular text-[13px] text-hint">{num(g.score)}</span>} />)}
        </List>
      </Section>
      <Section title="Уровень юрлица → ЛПР юрлица">
        <List>
          {plan.entity_offers.map((e) => <Row key={e.name} title={e.product_name ?? "—"} subtitle={e.name} right={e.score ? <span className="tabular text-[13px] text-hint">{num(e.score)}</span> : undefined} />)}
        </List>
      </Section>
      <Section title="План касаний: одно сообщение группе в неделю">
        <div className="space-y-2">
          {plan.plan.map((w, i) => (
            <Card key={w.week} className="flex items-center gap-3 p-3">
              <div className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl text-[11px] font-medium text-white" style={{ background: COLORS[i % COLORS.length], color: i === 3 ? "#0B0B0B" : undefined }}>
                <span className="font-display text-[16px] leading-none">{w.week}</span>нед.
              </div>
              <div className="min-w-0">
                <div className="font-medium">{w.product_name}</div>
                <div className="text-[13px] text-hint">{w.who} · {w.why}</div>
              </div>
            </Card>
          ))}
        </div>
        <p className="mt-2 px-1 text-[13px] text-hint">{plan.before}</p>
      </Section>
      <Section title="Правила для группы">
        <List>{plan.rules.map((r) => <Row key={r} title={<span className="whitespace-normal text-[14px] font-normal">{r}</span>} />)}</List>
      </Section>
    </div>
  );
}
