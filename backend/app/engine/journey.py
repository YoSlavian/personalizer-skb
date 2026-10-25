"""Адаптивный цифровой путь: сигналы сессии → адаптации интерфейса.

Триггеры (из решения команды):
- быстрый клиент: калькулятор ≤ quick_seconds от баннера → «Оформить сразу»;
- изучает и возвращается: ≥ returns_threshold возвратов на витрину → «Коротко» и сравнение 2 продуктов;
- сомневается: ≥ recalc_threshold пересчётов или пауза → подсказка (сохранить, сравнить, менеджер / отправить ФД);
- бросил заявку: ушёл с формы → «Продолжить черновик» на главной.
Не больше max_hints подсказок за сессию, каждую можно закрыть, ядро навигации не меняется.
"""

from dataclasses import dataclass, field
from datetime import datetime

from app.engine.rules import RulesConfig

SCREENS = {"home", "showcase", "calc", "form", "done"}
EVENT_KINDS = {"view", "recalc", "idle", "hint_close", "hint_action", "form_leave", "submit"}
HINT_ACTIONS = {"save", "compare", "ask_manager", "send_fd"}


@dataclass
class JourneyState:
    screen: str = "home"
    steps: int = 0
    returns: int = 0
    recalcs: int = 0
    hints_shown: int = 0
    hints_closed: int = 0
    hint_count: int = 0
    hint_open: bool = False
    compare_given: bool = False
    quick_given: bool = False
    draft: bool = False
    done: bool = False
    entered_calc_at: str | None = None
    log: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return dict(vars(self))

    @classmethod
    def from_dict(cls, d: dict | None) -> "JourneyState":
        st = cls()
        for k, v in (d or {}).items():
            if hasattr(st, k):
                setattr(st, k, v)
        return st


@dataclass
class EventResult:
    new: list[dict]
    side_effects: list[str]


def _elapsed(now: datetime, since: datetime) -> float:
    return (now - since).total_seconds()


def _hint(st: JourneyState, reason: str, adapt: bool, cfg: RulesConfig, role_lpr: bool, new: list[dict]) -> None:
    if not adapt or st.hint_count >= cfg.journey.max_hints or st.hint_open:
        return
    st.hint_count += 1
    st.hints_shown += 1
    st.hint_open = True
    st.log.append("Триггер: пауза → подсказка" if reason == "idle" else f"Триггер: ≥{cfg.journey.recalc_threshold} пересчёта → подсказка")
    new.append({"type": "hint_sheet", "variant": "ask_manager" if role_lpr else "send_to_fd", "reason": reason})


def apply_event(
    st: JourneyState,
    *,
    kind: str,
    screen: str | None,
    action: str | None,
    now: datetime,
    started_at: datetime,
    last_event_at: datetime,
    adapt: bool,
    role_lpr: bool,
    cfg: RulesConfig,
    idle_seconds: int,
) -> EventResult:
    if kind not in EVENT_KINDS:
        raise ValueError(f"Неизвестное событие: {kind}")
    new: list[dict] = []
    effects: list[str] = []
    j = cfg.journey

    if kind == "view":
        if screen not in SCREENS:
            raise ValueError(f"Неизвестный экран: {screen}")
        if st.screen == "calc" and screen == "showcase":
            st.returns += 1
            st.log.append("Возврат на витрину")
        if st.screen == "form" and screen == "home" and not st.done:
            st.draft = True
            st.log.append("Ушёл с формы: черновик сохранён")
            effects.append("save_draft")
        st.screen = screen
        st.steps += 1
        st.hint_open = False if screen != "calc" else st.hint_open
        if screen == "calc":
            st.entered_calc_at = now.isoformat()
        if screen == "showcase" and adapt and st.returns >= j.returns_threshold and not st.compare_given:
            st.compare_given = True
            st.hints_shown += 1
            st.log.append(f"Триггер: ≥{j.returns_threshold} возврата → блок «Коротко» и сравнение")
            new.append({"type": "compare_block"})

    elif kind == "recalc":
        st.recalcs += 1
        st.log.append(f"Пересчёт #{st.recalcs}")
        entered = datetime.fromisoformat(st.entered_calc_at) if st.entered_calc_at else None
        if adapt and st.recalcs == 1 and entered and _elapsed(entered, started_at) <= j.quick_seconds and not st.quick_given:
            st.quick_given = True
            st.hints_shown += 1
            st.log.append("Триггер: быстрый клиент → «Оформить сразу»")
            new.append({"type": "quick_apply"})
        if st.recalcs >= j.recalc_threshold:
            _hint(st, "recalc", adapt, cfg, role_lpr, new)

    elif kind == "idle":
        # Не доверяем клиентскому таймеру полностью: пауза должна быть видна и по серверному времени
        if st.screen == "calc" and _elapsed(now, last_event_at) >= idle_seconds * 0.8:
            st.log.append("Пауза в калькуляторе")
            _hint(st, "idle", adapt, cfg, role_lpr, new)

    elif kind == "hint_close":
        if st.hint_open:
            st.hints_closed += 1
            st.hint_open = False
            st.log.append("Подсказку закрыли")

    elif kind == "hint_action":
        if action not in HINT_ACTIONS:
            raise ValueError(f"Неизвестное действие подсказки: {action}")
        st.hint_open = False
        st.log.append({"save": "Расчёт сохранён", "compare": "Открыто сравнение", "ask_manager": "Запрос менеджеру", "send_fd": "Расчёт отправлен ФД"}[action])
        effects.append(action)

    elif kind == "form_leave":
        if not st.done:
            st.draft = True
            effects.append("save_draft")

    elif kind == "submit":
        st.done = True
        st.draft = False
        st.screen = "done"
        st.log.append("Заявка отправлена")

    st.log = st.log[-50:]
    return EventResult(new=new, side_effects=effects)


def active_adaptations(st: JourneyState, adapt: bool, role_lpr: bool) -> list[dict]:
    """Что интерфейс должен показывать сейчас (идемпотентно, можно запрашивать повторно)."""
    if not adapt:
        return []
    out: list[dict] = []
    if st.draft and st.screen == "home":
        out.append({"type": "draft_resume"})
    if st.compare_given and st.screen == "showcase":
        out.append({"type": "compare_block"})
    if st.quick_given and st.screen == "calc":
        out.append({"type": "quick_apply"})
    if st.hint_open and st.screen == "calc":
        out.append({"type": "hint_sheet", "variant": "ask_manager" if role_lpr else "send_to_fd"})
    return out
