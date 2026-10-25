"""Группа = один клиент: отрасль на двух уровнях, продукты группы и юрлиц без дублей, план касаний на неделю."""

from pydantic import BaseModel

from app.engine.catalog import PRODUCTS, industry_name
from app.engine.profile import ClientProfile, GroupInfo
from app.engine.rules import RulesConfig
from app.engine.scoring import score_products


class MainIndustry(BaseModel):
    industry: str | None
    share: int
    diversified: bool
    top: str | None = None


class EntityOffer(BaseModel):
    name: str
    org_id: int | None
    industry: str
    industry_name: str
    balance: str
    product_code: str | None
    product_name: str | None
    score: float | None


class PlanItem(BaseModel):
    week: int
    who: str
    product_code: str
    product_name: str
    why: str
    score: float


class GroupProduct(BaseModel):
    code: str
    name: str
    score: float
    why: list[str]


class GroupPlan(BaseModel):
    name: str
    main_industry: MainIndustry
    group_products: list[GroupProduct]
    entity_offers: list[EntityOffer]
    plan: list[PlanItem]
    before: str
    rules: list[str]


def main_industry(g: GroupInfo) -> MainIndustry:
    by: dict[str, int] = {}
    for e in g.entities:
        by[e.industry] = by.get(e.industry, 0) + e.share
    best, bs = None, 0
    for k, v in by.items():
        if v > bs:
            best, bs = k, v
    if bs >= 50:
        return MainIndustry(industry=best, share=bs, diversified=False)
    return MainIndustry(industry=None, share=bs, diversified=True, top=best)


def plan_group(p: ClientProfile, cfg: RulesConfig) -> GroupPlan:
    if not p.group:
        raise ValueError("В профиле нет состава группы")
    g = p.group
    m = main_industry(g)
    p_group = p.model_copy(update={"structure": "group"})
    group_rows = [
        x
        for x in score_products(p_group, cfg, industry=m.industry or "unk", role="fd", structure="group")
        if PRODUCTS[x.code].group and x.total > 0
    ]
    pool_in_plan = bool(group_rows) and group_rows[0].code == "pool"

    used: set[str] = set()
    entity_offers: list[EntityOffer] = []
    for e in g.entities:
        scored = []
        for x in score_products(p, cfg, industry=e.industry, role="fd", structure="solo"):
            t = x.total
            if x.code == "deposit" and e.balance == "surplus":
                t = 0 if pool_in_plan else t * 1.3
            if x.code == "working" and e.balance == "credit":
                t = t * 1.1
            if t > 0 and not PRODUCTS[x.code].group and x.code not in used:
                scored.append((t, x))
        scored.sort(key=lambda it: it[0], reverse=True)
        best = scored[0] if scored else None
        if best:
            used.add(best[1].code)
        entity_offers.append(
            EntityOffer(
                name=e.name.replace(" (головная)", ""),
                org_id=e.org_id,
                industry=e.industry,
                industry_name=industry_name(e.industry),
                balance=e.balance,
                product_code=best[1].code if best else None,
                product_name=best[1].name if best else None,
                score=round(best[0], 6) if best else None,
            )
        )

    queue: list[tuple[str, str, str, float]] = []
    if group_rows:
        queue.append(("ФД головной", group_rows[0].code, "групповой продукт", group_rows[0].total))
    for o in entity_offers:
        if o.product_code and not any(q[1] == o.product_code for q in queue):
            queue.append((f"ЛПР {o.name}", o.product_code, f"{o.industry_name} · скор {o.score:.3f}".replace(".", ","), o.score or 0))
    queue.sort(key=lambda q: q[3], reverse=True)
    plan = [
        PlanItem(week=i + 1, who=q[0], product_code=q[1], product_name=PRODUCTS[q[1]].name, why=q[2], score=round(q[3], 6))
        for i, q in enumerate(queue[:4])
    ]
    return GroupPlan(
        name=g.name,
        main_industry=m,
        group_products=[GroupProduct(code=x.code, name=x.name, score=x.total, why=x.why) for x in group_rows[:3]],
        entity_offers=entity_offers,
        plan=plan,
        before=f"Было: каждое юрлицо получало своё предложение независимо, до {len(g.entities)} сообщений в неделю разным людям одной группы.",
        rules=[
            "Все юрлица группы в одной группе A/B-теста",
            f"Не больше 1 предложения на группу раз в {cfg.frequency.group} дней, дубли по юрлицам снимаются",
            "Если продукт есть на уровне группы, юрлицам его не дублируем",
            f"Разнонаправленные остатки → «Единый остаток» ×{str(cfg.structure.pool_mixed_k).replace('.', ',')}",
        ],
    )
