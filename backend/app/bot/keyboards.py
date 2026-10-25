from urllib.parse import urlencode

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup, WebAppInfo

from app.config import get_settings
from app.models.enums import UserRole


def miniapp_url(route: str | None = None) -> str | None:
    """URL Mini App с маршрутом внутри приложения (?route=/applications/12). Telegram требует HTTPS."""
    base = get_settings().miniapp_url
    if not base or not base.startswith("https://"):
        return None
    return f"{base}?{urlencode({'route': route})}" if route else base


def open_app_button(text: str = "Открыть приложение", route: str | None = None) -> InlineKeyboardButton | None:
    url = miniapp_url(route)
    return InlineKeyboardButton(text=text, web_app=WebAppInfo(url=url)) if url else None


def main_menu(role: UserRole | None) -> ReplyKeyboardMarkup:
    rows: list[list[KeyboardButton]] = []
    url = miniapp_url()
    if url:
        rows.append([KeyboardButton(text="📱 Открыть приложение", web_app=WebAppInfo(url=url))])
    if role == UserRole.client:
        rows.append([KeyboardButton(text="📄 Мои заявки"), KeyboardButton(text="🔔 Уведомления")])
    elif role in (UserRole.manager, UserRole.admin, UserRole.analyst):
        rows.append([KeyboardButton(text="✅ Мои задачи"), KeyboardButton(text="📄 Заявки")])
        rows.append([KeyboardButton(text="🔔 Уведомления")])
    rows.append([KeyboardButton(text="ℹ️ Помощь")])
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True, is_persistent=True)


def inline(*rows: list[InlineKeyboardButton | None]) -> InlineKeyboardMarkup | None:
    """Клавиатура из непустых кнопок; None, если кнопок нет (например, не настроен адрес Mini App)."""
    clean = [[b for b in row if b] for row in rows]
    clean = [row for row in clean if row]
    return InlineKeyboardMarkup(inline_keyboard=clean) if clean else None


def demo_personas() -> InlineKeyboardMarkup:
    return inline(
        [InlineKeyboardButton(text="Клиент: ФД агрохолдинга", callback_data="persona:client_fd")],
        [InlineKeyboardButton(text="Клиент: бухгалтер IT-компании", callback_data="persona:client_acc")],
        [InlineKeyboardButton(text="Клиентский менеджер", callback_data="persona:manager")],
    )


def offer_keyboard(comm_id: int, cta: str) -> InlineKeyboardMarkup:
    return inline(
        [open_app_button(cta or "Рассчитать", f"/journey?offer={comm_id}") or InlineKeyboardButton(text=cta or "Подробнее", callback_data=f"offer_open:{comm_id}")],
        [InlineKeyboardButton(text="Не интересно", callback_data=f"offer_hide:{comm_id}"),
         InlineKeyboardButton(text="Отписаться от push", callback_data=f"offer_unsub:{comm_id}")],
    )


def application_keyboard(app_id: int, client: bool) -> InlineKeyboardMarkup:
    return inline([open_app_button("Открыть заявку", f"/applications/{app_id}") or InlineKeyboardButton(text="Статус заявки", callback_data=f"app:{app_id}")])


def task_keyboard(task_id: int, status: str) -> InlineKeyboardMarkup:
    actions = []
    if status == "open":
        actions.append(InlineKeyboardButton(text="Взять в работу", callback_data=f"task_take:{task_id}"))
    if status in ("open", "in_progress"):
        actions.append(InlineKeyboardButton(text="Выполнено", callback_data=f"task_done:{task_id}"))
    return inline(actions, [open_app_button("Открыть задачу", f"/tasks/{task_id}")])
