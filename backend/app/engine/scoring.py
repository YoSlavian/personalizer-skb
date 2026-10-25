"""Скор продукта = склонность × доход (AS IS) × K отрасли × K момента × K роли × K структуры × вес источника роли.

Нулевой коэффициент исключает продукт. Логика перенесена из прототипа команды без изменений поведения.
"""

from app.engine.catalog import INDUSTRIES, PRODUCTS, ROLES
from app.engine.profile import AsIs, ClientProfile, ScoreRow
from app.engine.rules import RulesConfig

_UNSET = object()


def activity_level(logins: int, cfg: RulesConfig) -> str:
    if logins >= cfg.activity.high_min:
        return "high"
    if logins >= cfg.activity.mid_min:
        return "mid"
    return "low"


def completeness(p: ClientProfile) -> int:
    """Полнота профиля, %: источник роли (CRM 40 / выведено 25 / нет 0) + отрасль 20 + структура 20 + активность 20."""
    c = {"crm": 40, "inferred": 25, "none": 0}[p.role_source]
    c += 0 if p.industry == "unk" else 20
    return c + 40


def is_season(p: ClientProfile, industry: str) -> bool:
    return p.seasonal and INDUSTRIES[industry].seasonal


def score_products(
    p: ClientProfile,
    cfg: RulesConfig,
    *,
    industry: str | None = None,
    role: object = _UNSET,
    structure: str | None = None,
) -> list[ScoreRow]:
    ind = industry or p.industry
    eff_role = p.effective_role if role is _UNSET else role
    is_group = (structure or p.structure) == "group"
    m = cfg.momentum
    src_k = getattr(cfg.role_source_weight, p.role_source)
    rows: list[ScoreRow] = []

    for code, pr in PRODUCTS.items():
        base_cfg = cfg.products[code]
        base = base_cfg.p * base_cfg.rev
        k_ind, k_mom, k_role, k_str = 1.0, 1.0, 1.0, 1.0
        why: list[str] = []
        off: str | None = None

        # Что и когда: отрасль
        k_ind = cfg.industry_k.get(ind, {}).get(code, 1.0)
        if code == "ved" and not p.fx_payment and ind != "trade":
            k_ind, off = 0.0, "нет валютных операций"

        # Что и когда: момент (сезон, события)
        if code in ("working", "concession") and is_season(p, ind):
            if m.season_window_min <= p.weeks_to_peak <= m.season_window_max:
                k_mom = m.season_window_k
                why.append(f"окно {m.season_window_min}–{m.season_window_max} недель до пика")
            elif p.weeks_to_peak < m.season_window_min:
                k_mom = m.season_near_k
                why.append(f"пик ближе {m.season_window_min} недель")
            else:
                k_mom = m.season_off_k
                why.append("вне сезонного окна")
        if code == "ved" and p.fx_payment:
            k_mom = m.fx_k
            why.append("валютный платёж сегодня")
        if code == "deposit" and p.deposit_ending:
            k_mom = m.deposit_k
            why.append("депозит заканчивается")
        if p.bki_request and code in ("working", "concession", "project"):
            k_mom *= m.bki_k
            why.append("запрос в БКИ")
        if code in p.hidden_products:
            k_mom, off = 0.0, f"скрыл баннер: пауза {cfg.hidden_pause_days} дней"
        if code in p.stopped_products:
            k_mom = 0.0
            off = off or f"стоп-кран: {cfg.stop_crane.clicks} клика без заявки, пауза {cfg.stop_crane.days} дней"

        # Кому: роль получателя
        if eff_role:
            r = ROLES[eff_role]
            if not r.lpr and pr.lpr:
                k_role = 0.0
                off = off or "не тот получатель → уйдёт ЛПР"
            else:
                k_role = cfg.role_k.get(eff_role, {}).get(code, 1.0)

        # Кому: структура бизнеса
        if pr.group:
            if not is_group:
                k_str = 0.0
                off = off or "только для групп"
            elif pr.large and p.size != "large":
                k_str = 0.0
                off = off or "для крупных групп"
            elif code == "pool":
                k_str = cfg.structure.pool_mixed_k if p.mixed_balances else cfg.structure.pool_k
                why.append("разнонаправленные остатки" if p.mixed_balances else "группа компаний")
            else:
                k_str = cfg.structure.group_k

        total = base * k_ind * k_mom * k_role * k_str * src_k
        rows.append(
            ScoreRow(
                code=code,
                name=pr.name,
                base=round(base, 6),
                k_industry=k_ind,
                k_moment=round(k_mom, 4),
                k_role=k_role,
                k_structure=k_str,
                k_source=src_k,
                total=round(total, 6),
                excluded_reason=(off or "исключён") if total == 0 else None,
                why=why,
            )
        )

    rows.sort(key=lambda r: r.total, reverse=True)
    return rows


def as_is(p: ClientProfile, cfg: RulesConfig) -> AsIs:
    """AS IS: тот же скор склонность × доход без новых признаков, одинаковый для всех ролей и отраслей."""
    candidates = [c for c, pr in PRODUCTS.items() if not pr.group]
    top = max(candidates, key=lambda c: cfg.products[c].p * cfg.products[c].rev)
    return AsIs(
        product_code=top,
        product_name=PRODUCTS[top].name,
        headline="Кредит для бизнеса на выгодных условиях",
        who="Все пользователи кабинета, часто бухгалтер или операционист",
        channel="Баннер в интернет-банке",
        channel_code="banner_ib",
        frequency="По лимитам канала и продукта, без учёта активности",
        group="Отдельное предложение каждому юрлицу группы" if p.structure == "group" else "—",
    )
