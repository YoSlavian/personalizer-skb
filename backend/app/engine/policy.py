"""Коммуникационная политика поверх решения: лимиты частоты, «стоп-кран», пауза после скрытия баннера.

Отказ от коммуникаций уже учтён в решении (жёсткий фильтр до выбора предложения). Здесь — проверки,
которым нужна история коммуникаций.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.engine.rules import RulesConfig

DELIVERED = {"planned", "sent", "shown", "clicked", "converted", "hidden"}


@dataclass(frozen=True)
class HistoryItem:
    channel: str
    product_code: str
    status: str
    created_at: datetime
    clicks: int = 0
    clicked_at: datetime | None = None
    hidden_at: datetime | None = None
    converted_at: datetime | None = None


def _days_ago(now: datetime, ts: datetime) -> float:
    return (now - ts).total_seconds() / 86400


def stopped_products(history: list[HistoryItem], now: datetime, cfg: RulesConfig) -> list[str]:
    """«Стоп-кран»: N кликов без заявки за окно → продукт скрывается."""
    window = cfg.stop_crane.days
    clicks: dict[str, int] = {}
    converted: set[str] = set()
    for h in history:
        if h.clicked_at and _days_ago(now, h.clicked_at) <= window:
            clicks[h.product_code] = clicks.get(h.product_code, 0) + h.clicks
        if h.converted_at and _days_ago(now, h.converted_at) <= window:
            converted.add(h.product_code)
    return sorted(code for code, n in clicks.items() if n >= cfg.stop_crane.clicks and code not in converted)


def hidden_products(history: list[HistoryItem], now: datetime, cfg: RulesConfig) -> list[str]:
    return sorted({h.product_code for h in history if h.hidden_at and _days_ago(now, h.hidden_at) <= cfg.hidden_pause_days})


def frequency_block(
    *,
    channel: str,
    product_code: str,
    activity_level: str,
    event_driven: bool,
    org_history: list[HistoryItem],
    group_history: list[HistoryItem] | None,
    now: datetime,
    cfg: RulesConfig,
) -> str | None:
    """Возвращает причину блокировки или None, если отправка разрешена."""
    f = cfg.frequency
    delivered = [h for h in org_history if h.status in DELIVERED]

    if channel == "fx_placement":
        for h in delivered:
            if h.channel == "fx_placement" and h.product_code == product_code and _days_ago(now, h.created_at) < f.fx_repeat and not h.clicked_at:
                return f"Плейсмент уже показан: без клика повтор не раньше чем через {f.fx_repeat} дней"
        return None

    if channel == "km_call":
        for h in delivered:
            if h.channel == "km_call" and _days_ago(now, h.created_at) < f.low_km:
                return f"КМ: не чаще 1 касания в {f.low_km} дней"
        return None

    # Email — не чаще раза в low_email дней при любой активности: норма банка, общая для всех получателей
    if channel == "email":
        for h in delivered:
            if h.channel == "email" and _days_ago(now, h.created_at) < f.low_email:
                return f"Email не чаще 1 раза в {f.low_email} дней"

    if event_driven:
        # Событийные предложения не ждут общего окна, но не повторяются по тому же продукту чаще раза в неделю
        for h in delivered:
            if h.product_code == product_code and h.channel == channel and _days_ago(now, h.created_at) < 7:
                return "Событийное предложение по этому продукту уже отправлено на этой неделе"
        return None

    window = {"high": f.high, "mid": f.mid}.get(activity_level, f.low_email if channel == "email" else f.mid)
    for h in delivered:
        if h.channel != "km_call" and _days_ago(now, h.created_at) < window:
            return f"Лимит частоты: не чаще 1 предложения в {window} дн. (последнее {h.created_at:%d.%m})"

    if group_history is not None:
        for h in group_history:
            if h.status in DELIVERED and h.channel != "km_call" and _days_ago(now, h.created_at) < f.group:
                return f"Лимит на группу: не чаще 1 предложения в {f.group} дн."
    return None


def as_is_block(*, channel: str, product_code: str, org_history: list[HistoryItem], now: datetime, cfg: RulesConfig) -> str | None:
    """AS IS: лимит только по каналу и продукту."""
    for h in org_history:
        if h.status in DELIVERED and h.channel == channel and h.product_code == product_code and _days_ago(now, h.created_at) < cfg.frequency.mid:
            return f"Лимит канала и продукта: не чаще 1 раза в {cfg.frequency.mid} дн."
    return None


def window_start(now: datetime, cfg: RulesConfig) -> datetime:
    """С какого момента нужна история для всех проверок."""
    return now - timedelta(days=max(cfg.frequency.low_email, cfg.hidden_pause_days, cfg.stop_crane.days, cfg.frequency.fx_repeat) + 1)
