"""Решение оптимизатора: ML-скор → фильтры → что и когда → кому → как → действие (NBA)."""

from app.engine.catalog import CHANNELS, INDUSTRIES, PRODUCTS, ROLES
from app.engine.profile import Action, ChannelOut, ClientProfile, DecisionResult, Offer
from app.engine.rules import RulesConfig
from app.engine.scoring import activity_level, as_is, completeness, score_products
from app.engine.texts import text_for


def _ch(code: str, label: str | None = None) -> ChannelOut:
    return ChannelOut(code=code, label=label or CHANNELS[code])


def _period(days: int) -> str:
    if days == 7:
        return "в неделю"
    if days % 7 == 0:
        return f"в {days // 7} недели" if days // 7 < 5 else f"в {days // 7} недель"
    return f"в {days} дн."


def channels(p: ClientProfile, recipient_lpr: bool, cfg: RulesConfig) -> tuple[str, list[ChannelOut], str, str | None]:
    """Канал и частота по цифровой активности ЛПР; отказы — жёсткий фильтр."""
    lvl = activity_level(p.logins_30d, cfg)
    if p.opt_out_all:
        return lvl, [], "Ничего не отправляем", "Ничего не делать: клиент отказался от маркетинговых коммуникаций"
    if lvl == "high":
        lst = [_ch("boss") if recipient_lpr else _ch("banner_ib"), _ch("push")]
    elif lvl == "mid":
        lst = [_ch("email"), _ch("boss", "Альфа-Босс: плейсмент") if recipient_lpr else _ch("banner_ib")]
    else:
        lst = [_ch("km_call"), _ch("email")]
    if p.opt_out_email:
        lst = [c for c in lst if c.code != "email"]
    if p.opt_out_push:
        lst = [c for c in lst if c.code != "push"]
    if not lst:
        lst = [_ch("km_call")]
    f = cfg.frequency
    if lvl == "high":
        freq = f"Не чаще 1 предложения {_period(f.high)} на ЛПР"
    elif lvl == "mid":
        freq = f"Не чаще 1 предложения {_period(f.mid)}"
    else:
        freq = f"КМ: 1 касание {_period(f.low_km) if f.low_km != 30 else 'в месяц'}; email не чаще 1 раза в {f.low_email} дней"
    if p.structure == "group":
        freq += f"; на группу не чаще 1 {_period(f.group)}"
    return lvl, lst, freq, None


def group_entities_count(p: ClientProfile) -> int | None:
    return len(p.group.entities) if p.structure == "group" and p.group else None


def segments(p: ClientProfile, cfg: RulesConfig) -> list[str]:
    seg = []
    if p.structure == "group":
        seg.append("S1")
    if p.seasonal and INDUSTRIES[p.industry].seasonal:
        seg.append("S2")
    if activity_level(p.logins_30d, cfg) == "high":
        seg.append("S3")
    if p.industry == "trade" or p.fx_payment:
        seg.append("S4")
    return seg


def visual_data(p: ClientProfile, visual: str) -> dict:
    data: dict = {"type": visual}
    if visual == "season":
        months = p.turnover_by_month or [3, 3, 5, 8, 9, 6, 4, 4, 7, 9, 5, 3]
        top = max(months) or 1
        data |= {
            "months": [round(v / top, 3) for v in months],
            "peak_index": months.index(max(months)),
            "big": f"{p.weeks_to_peak} нед." if p.seasonal else "Обороты",
            "small": "до пика закупок" if p.seasonal else "по месяцам",
            "note": "по оборотам РКО клиента",
        }
    elif visual == "group" and p.group:
        data |= {
            "entities": [{"share": e.share, "balance": e.balance} for e in p.group.entities[:4]],
            "big": f"{len(p.group.entities)} → 1",
            "small": "юрлица, одно предложение",
            "note": "чёрные: кредит · зелёные: остатки",
        }
    elif visual == "deposit":
        data |= {"big": "Остатки", "small": "продлеваем до окончания" if p.deposit_ending else "работают, а не лежат"}
    else:
        data |= {
            "fx": {"big": "Сейчас", "small": "в момент валютного платежа"},
            "sync": {"big": "Без ручного", "small": "переноса выписок и платежей"},
            "truck": {"big": "Лизинг", "small": "без единовременных затрат"},
            "invoice": {"big": "Деньги", "small": "по поставке, не ждём оплаты"},
            "group": {"big": "Группа", "small": "одно предложение"},
        }.get(visual, {"big": "Развитие", "small": "проект и инвестиции"})
    return data


def decide(p: ClientProfile, cfg: RulesConfig) -> DecisionResult:
    comp = completeness(p)
    role = p.effective_role
    r = ROLES[role] if role else None
    rows = score_products(p, cfg)
    win = next((x for x in rows if x.total > 0), None)
    by_code = {x.code: x for x in rows}

    # Событийные правила: в момент события продукт занимает контекстный плейсмент
    event_note = None
    if p.fx_payment and by_code["ved"].total > 0 and not p.opt_out_all:
        win = by_code["ved"]
        event_note = "Событийное правило: продукт занимает контекстный плейсмент в момент платежа, даже если его скор не максимальный"
    elif p.deposit_ending and by_code["deposit"].total > 0 and not p.opt_out_all:
        win = by_code["deposit"]
        event_note = "Событийное правило: пролонгация до окончания депозита"

    fallback = comp < cfg.completeness_threshold
    lvl, ch_list, freq, nba = channels(p, r.lpr if r else True, cfg)
    if event_note and win and win.code == "ved":
        ch_list = [_ch("fx_placement")]
        freq = f"Один показ в момент платежа; без клика повтор не раньше чем через {cfg.frequency.fx_repeat} дней"
    if event_note and win and win.code == "deposit":
        ch_list = [_ch("km_call", "Звонок КМ") if lvl == "low" else _ch("banner_ib", "Плейсмент на главной ИБ")]
        if not p.opt_out_email:
            ch_list.append(_ch("email"))
        freq = "За 14 и за 3 дня до окончания депозита"

    # Маршрутизация по роли: продукт для ЛПР уходит ЛПР, не бухгалтеру
    routing = None
    if r and not r.lpr:
        lpr_best = next((x for x in score_products(p, cfg, role="fd") if x.total > 0 and PRODUCTS[x.code].lpr), None)
        if lpr_best:
            routing = f"«{lpr_best.name}» уходит ЛПР компании через Альфа-Босс, а {r.name.lower()} получает операционное предложение"

    actions: list[Action] = []
    if not nba and p.bki_request:
        nba = "Задача КМ: позвонить в течение 48 часов, клиент ищет кредит в другом банке"
    if not nba and lvl == "low":
        nba = "Передать КМ: предложение обсуждается на звонке или встрече"
    if not nba and p.role_source == "none":
        nba = "Нейтральный текст; КМ получает задачу уточнить роль в CRM"

    ac = as_is(p, cfg)
    notes: list[str] = []
    for code in p.hidden_products:
        notes.append(f"Клиент скрыл баннер «{PRODUCTS[code].name}»: продукт на паузе {cfg.hidden_pause_days} дней для этого получателя.")
    for code in p.stopped_products:
        notes.append(f"Стоп-кран по «{PRODUCTS[code].name}»: {cfg.stop_crane.clicks} клика без заявки, скрываем на {cfg.stop_crane.days} дней.")

    offer = None
    if p.opt_out_all:
        actions.append(Action(type="nothing", title="Клиент отказался от маркетинговых коммуникаций"))
        nba = nba or "Ничего не делать"
    elif fallback:
        top = PRODUCTS[ac.product_code]
        offer = Offer(product_code=top.code, product_name=top.name, headline=ac.headline,
                      body="Финансирование для вашего бизнеса. Рассчитайте условия онлайн.", cta="Рассчитать условия", visual=top.visual)
        ch_list = [_ch("banner_ib")]
        freq = ac.frequency
        actions.append(Action(type="show_offer"))
        actions.append(Action(type="km_task", kind="update_crm_role", title="Уточнить отрасль и роль ЛПР в CRM", priority="low", due_hours=24 * 14))
        nba = "Данных мало: показываем AS IS, КМ уточняет отрасль и роль в CRM"
    elif win:
        head, body, cta = text_for(win.code, role, p, cfg, entities=group_entities_count(p))
        offer = Offer(product_code=win.code, product_name=win.name, headline=head, body=body, cta=cta, visual=PRODUCTS[win.code].visual)
        actions.append(Action(type="show_offer"))
        if p.bki_request:
            actions.append(Action(type="km_task", kind="call_48h", title="Позвонить: клиент ищет кредит в другом банке", priority="high", due_hours=48))
        if lvl == "low":
            actions.append(Action(type="km_task", kind="meeting", title=f"Обсудить «{win.name}» на звонке или встрече", priority="normal", due_hours=24 * 7))
        if p.role_source == "none":
            actions.append(Action(type="km_task", kind="update_crm_role", title="Уточнить роль ЛПР в CRM", priority="low", due_hours=24 * 14))
        if (p.structure == "group" or p.size == "large") and win.total >= cfg.large_meeting_score and lvl != "low":
            actions.append(Action(type="km_task", kind="group_offer", title=f"Встреча: комплексное предложение «{win.name}»", priority="normal", due_hours=24 * 10))
    else:
        actions.append(Action(type="nothing", title="Все продукты исключены правилами"))
        nba = nba or "Ничего не делать: все продукты исключены правилами"

    if p.structure == "group" and p.group:
        who = f"ФД или казначей головной компании ({len(p.group.entities)} юрлица = 1 получатель)"
    elif r:
        who = r.name
    else:
        who = "Пользователи Альфа-Босс (доступ есть у ЛПР)"

    visual = offer.visual if offer else "growth"
    return DecisionResult(
        company=p.company,
        completeness=comp,
        fallback=fallback,
        suppressed=p.opt_out_all,
        activity_level=lvl,
        role=role,
        role_name=r.name if r else None,
        winner=win if not p.opt_out_all else None,
        offer=offer,
        recipient=who,
        channels=ch_list if not p.opt_out_all else [],
        frequency=freq,
        nba=nba or "Показать предложение",
        actions=actions,
        routing=routing,
        event_note=event_note,
        notes=notes,
        rows=rows,
        as_is=ac,
        segments=segments(p, cfg),
        visual_data=visual_data(p, visual),
    )
