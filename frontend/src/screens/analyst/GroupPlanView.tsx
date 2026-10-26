import { Desktop, Factory, Globe, type Icon } from "@phosphor-icons/react";
import { AlertTriangle, Briefcase, Building2, Check, Plant, Storefront, Truck } from "../../components/icons";
import { Banner, cx, IconBadge, Section, Tag } from "../../components/ui";

export interface GroupPlan {
  name: string;
  main_industry: { industry: string | null; share: number; diversified: boolean; top: string | null };
  group_products: { code: string; name: string; score: number; why: string[] }[];
  entity_offers: { name: string; industry?: string; industry_name: string; balance: string; product_name: string | null; score: number | null }[];
  plan: { week: number; who: string; product_name: string; why: string; score: number }[];
  before: string;
  rules: string[];
}

const INDUSTRY_ICON: Record<string, Icon> = {
  agro: Plant,
  log: Truck,
  retail: Storefront,
  it: Desktop,
  trade: Globe,
  mfg: Factory,
};

/** В карточке группы город и пометка «(головная)» лишние: роль уже в подписи, город — в карточке клиента. */
const shortName = (name: string) => {
  const i = name.indexOf(" · ");
  return (i > 0 ? name.slice(0, i) : name).replace(/\s*\(головная\)$/, "");
};

const sc = (v: number) => (v >= 0.1 ? v.toFixed(2) : v.toFixed(3)).replace(".", ",");

/**
 * Группа = один клиент: юрлица с их продуктами, план касаний (одно сообщение группе в неделю), правила.
 * Первое юрлицо — головная (бэкенд отдаёт головную первой).
 */
export function GroupPlanView({ plan }: { plan: GroupPlan }) {
  const m = plan.main_industry;
  const mainName = plan.entity_offers.find((e) => e.industry && e.industry === m.industry)?.industry_name;
  const weekOf = (name: string) => plan.plan.find((w) => w.who.includes(name))?.week;

  return (
    <div>
      <div className="card divide-y divide-sep overflow-hidden">
        {plan.entity_offers.map((e, i) => {
          const head = i === 0;
          const Ico = (e.industry && INDUSTRY_ICON[e.industry]) || Briefcase;
          const week = weekOf(e.name);
          return (
            <div key={e.name} className="flex items-center gap-3 px-4 py-3">
              <div className="shrink-0">
                <IconBadge tone={head ? "brand" : "neutral"}>
                  {head ? <Building2 className="size-5" weight="fill" /> : <Ico className="size-5" />}
                </IconBadge>
              </div>
              {/* Без truncate: продукт юрлица — смысл карточки, переносим строки, а не режем */}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 break-words text-[15px] font-medium leading-snug">{shortName(e.name)}</div>
                <div className="mt-0.5 break-words text-[13px] leading-snug text-hint">
                  {head ? "головная · " : ""}{e.industry_name} · {e.balance === "credit" ? "в кредите" : "свободные остатки"}
                </div>
                <div className="mt-0.5 break-words text-[13px] leading-snug">→ {e.product_name ?? "без продукта"}</div>
              </div>
              {week !== undefined && <div className="shrink-0 self-start pt-0.5"><Tag tone={week === 1 ? "violet" : "neutral"}>нед. {week}</Tag></div>}
            </div>
          );
        })}
      </div>

      <div className="mt-2">
        {m.diversified ? (
          <Banner tone="warn" icon={<AlertTriangle className="size-4 text-warning" weight="fill" />}>
            Ни одна отрасль не даёт 50% оборотов (макс. {m.share}%) — на уровне группы только ликвидность.
          </Banner>
        ) : (
          <p className="px-1 text-[13px] text-hint">
            Отрасль группы — {mainName ?? "основная"}: {m.share}% оборотов РКО (порог 50%).
          </p>
        )}
      </div>

      <Section title="План касаний" action={<span className="text-[12px] text-hint">1 сообщение в неделю</span>}>
        <ol className="card divide-y divide-sep overflow-hidden">
          {plan.plan.map((w, i) => (
            <li key={w.week} className="flex items-center gap-3 px-4 py-3">
              <div className={cx("flex size-10 shrink-0 flex-col items-center justify-center rounded-[14px]", i === 0 ? "bg-text text-bg" : "bg-subtle text-text")}>
                <span className="font-display text-[15px] leading-none tabular">{w.week}</span>
                <span className="mt-0.5 text-[9px] leading-none opacity-70">нед</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] font-medium leading-snug">{w.product_name}</div>
                <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-hint">{w.who} · {w.why}</div>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-2 px-1 text-[13px] leading-snug text-hint">{plan.before}</p>
      </Section>

      <Section title="Уровень группы" action={<span className="text-[12px] text-hint">ФД головной</span>}>
        <div className="card divide-y divide-sep overflow-hidden">
          {plan.group_products.length === 0 && <div className="px-4 py-3 text-[14px] text-hint">Групповых продуктов нет</div>}
          {plan.group_products.map((g) => (
            <div key={g.code} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium leading-snug">{g.name}</div>
                {g.why.length > 0 && <div className="mt-0.5 text-[13px] text-hint">{g.why.join(", ")}</div>}
              </div>
              <span className="shrink-0 font-display text-[15px] tabular text-hint">{sc(g.score)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Правила для группы">
        <ul className="card space-y-2.5 px-4 py-3.5">
          {plan.rules.map((r) => (
            <li key={r} className="flex gap-2.5 text-[14px] leading-snug">
              <Check className="mt-0.5 size-4 shrink-0 text-brand" weight="bold" aria-hidden />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
