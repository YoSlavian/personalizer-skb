"""Обработчики бота. Бот — точка входа в Mini App и мобильный канал: push-предложения, статусы заявок, задачи КМ."""

import html
import logging

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandObject, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, ErrorEvent, InlineKeyboardButton, Message
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import keyboards as kb
from app.config import get_settings
from app.demo_accounts import BOT_DEMO_PERSONAS
from app.engine.catalog import product_name
from app.errors import AppError
from app.models import Application, Notification, Task, TelegramLink, User
from app.models.enums import AppStatus, TaskStatus, UserRole
from app.services import applications as app_svc
from app.services import auth as auth_svc
from app.services import notifications as notif_svc
from app.services import tasks as task_svc
from app.services.communications import register_interaction

log = logging.getLogger("bot")
router = Router(name="main")

ROLE_TITLES = {UserRole.client: "клиент", UserRole.manager: "клиентский менеджер", UserRole.analyst: "аналитик СКБ", UserRole.admin: "администратор"}
DEMO_NOTE = "\n\n<i>Демо-режим: компании и суммы демонстрационные.</i>"


class TaskDone(StatesGroup):
    comment = State()


def esc(v: object) -> str:
    return html.escape(str(v)) if v is not None else ""


def rub(v: int) -> str:
    return f"{v / 1e6:.1f}".replace(".", ",") + " млн ₽"


async def _greet(message: Message, user: User) -> None:
    text = (
        f"Здравствуйте, {esc(user.full_name.split()[0])}! Вы вошли как <b>{ROLE_TITLES[user.role]}</b>.\n\n"
        + {
            UserRole.client: "Здесь — персональные предложения под задачи вашей компании, статусы заявок и ответы менеджера. "
                             "Основная работа — в приложении: расчёт, заявка, переписка.",
            UserRole.manager: "Сюда приходят задачи от правил персонализации и новые заявки портфеля. "
                              "Задачу можно взять в работу и закрыть прямо из сообщения.",
        }.get(user.role, "В приложении — симулятор персонализации, аналитика A/B и запуск кампаний.")
    )
    if not kb.miniapp_url():
        text += "\n\n⚠️ Адрес Mini App не настроен (PUBLIC_BASE_URL с HTTPS). Доступны статусы и задачи в чате."
    await message.answer(text + DEMO_NOTE, reply_markup=kb.main_menu(user.role))
    btn = kb.open_app_button()
    if btn:
        await message.answer("Откройте приложение:", reply_markup=kb.inline([btn]))


@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject, db: AsyncSession, user: User | None, state: FSMContext) -> None:
    await state.clear()
    code = (command.args or "").strip()
    if code:
        try:
            user = await auth_svc.consume_link_code(db, code, telegram_user_id=message.from_user.id, chat_id=message.chat.id,
                                                    username=message.from_user.username)
        except AppError as e:
            await message.answer(f"Не удалось привязать аккаунт: {esc(e.message)}")
            return
        await message.answer("✅ Telegram привязан к вашему аккаунту. Уведомления будут приходить сюда.")
        await _greet(message, user)
        return
    if user:
        await _greet(message, user)
        return
    text = (
        "Здравствуйте! Это <b>Персонализатор СКБ</b> — персонализация коммуникаций с корпоративными клиентами.\n\n"
        "Что умеет:\n• персональное предложение под отрасль, роль и сезон компании;\n• расчёт и заявка в приложении;\n"
        "• статусы заявок и ответы менеджера;\n• задачи клиентского менеджера.\n\n"
        "Чтобы начать, откройте приложение и войдите — Telegram привяжется автоматически."
    )
    markup = None
    if get_settings().demo_mode:
        text += "\n\n<b>Демо-режим:</b> выберите роль ниже."
        markup = kb.demo_personas()
        btn = kb.open_app_button("Открыть приложение")
        if btn:
            markup.inline_keyboard.insert(0, [btn])
    elif kb.open_app_button():
        markup = kb.inline([kb.open_app_button()])
    await message.answer(text + DEMO_NOTE, reply_markup=markup)


@router.callback_query(F.data.startswith("persona:"))
async def cb_persona(query: CallbackQuery, db: AsyncSession) -> None:
    if not get_settings().demo_mode:
        await query.answer("Демо-режим выключен", show_alert=True)
        return
    email = BOT_DEMO_PERSONAS.get(query.data.split(":", 1)[1])
    target = (await db.execute(select(User).where(User.email == email, User.is_active.is_(True)))).scalar_one_or_none() if email else None
    if target is None:
        await query.answer("Демо-учётка не найдена. Запустите заполнение демо-данных", show_alert=True)
        return
    await auth_svc.link_telegram_account(db, target, telegram_user_id=query.from_user.id, chat_id=query.message.chat.id,
                                         username=query.from_user.username, via="demo")
    await query.answer(f"Вы вошли как {target.full_name}")
    await _greet(query.message, target)


@router.message(Command("help"))
@router.message(F.text == "ℹ️ Помощь")
async def cmd_help(message: Message, user: User | None) -> None:
    await message.answer(
        "<b>Команды</b>\n/start — начало и привязка аккаунта\n/app — открыть приложение\n/status — мои заявки\n"
        "/tasks — мои задачи (для менеджера)\n/notifications — непрочитанные уведомления\n/cancel — отменить текущее действие\n"
        "/unlink — отвязать Telegram от аккаунта\n\nПерсональные предложения можно скрыть кнопкой «Не интересно» "
        "или отключить push в профиле приложения. Сервисные уведомления о заявках продолжат приходить.",
        reply_markup=kb.main_menu(user.role if user else None),
    )


@router.message(Command("app"))
async def cmd_app(message: Message) -> None:
    btn = kb.open_app_button()
    if not btn:
        await message.answer("Адрес Mini App не настроен на сервере (PUBLIC_BASE_URL с HTTPS).")
        return
    await message.answer("Приложение откроется внутри Telegram:", reply_markup=kb.inline([btn]))


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext, user: User | None) -> None:
    current = await state.get_state()
    await state.clear()
    await message.answer("Действие отменено." if current else "Нечего отменять.", reply_markup=kb.main_menu(user.role if user else None))


@router.message(Command("unlink"))
async def cmd_unlink(message: Message, db: AsyncSession, user: User | None, link: TelegramLink | None = None) -> None:
    if not user or not link:
        await message.answer("Этот Telegram не привязан к аккаунту.")
        return
    await db.delete(link)
    await message.answer("Telegram отвязан. Уведомления сюда больше не придут. Привязать снова: /start.")


async def _need_user(message: Message, user: User | None) -> bool:
    if user is None:
        await message.answer("Сначала войдите: /start")
        return False
    return True


@router.message(Command("status"))
@router.message(F.text.in_({"📄 Мои заявки", "📄 Заявки"}))
async def cmd_status(message: Message, db: AsyncSession, user: User | None) -> None:
    if not await _need_user(message, user):
        return
    statuses = [AppStatus.submitted, AppStatus.in_review, AppStatus.needs_info, AppStatus.approved, AppStatus.declined]
    items, total = await app_svc.list_applications(db, user, statuses=statuses, org_id=None, product=None,
                                                   assignee="me" if user.role == UserRole.manager else None, search=None, page=1, size=5, sort="-updated")
    if not items:
        await message.answer("Заявок пока нет. Оформить заявку можно в приложении после расчёта.", reply_markup=kb.inline([kb.open_app_button()]))
        return
    lines = [f"<b>Заявки</b> (последние {len(items)} из {total}):"]
    for a in items:
        lines.append(f"• <b>{esc(a.number)}</b> · {esc(product_name(a.product_code))}, {rub(a.amount_rub)} — {esc(app_svc.STATUS_NAMES[a.status])}"
                     + (f"\n  {esc(a.organization.name)}" if user.role != UserRole.client else ""))
    await message.answer("\n".join(lines), reply_markup=kb.inline(*[[kb.open_app_button(f"{a.number}", f"/applications/{a.id}")] for a in items[:3]]))


@router.message(Command("tasks"))
@router.message(F.text == "✅ Мои задачи")
async def cmd_tasks(message: Message, db: AsyncSession, user: User | None) -> None:
    if not await _need_user(message, user):
        return
    if user.role == UserRole.client:
        await message.answer("Задачи доступны клиентским менеджерам.")
        return
    items, total = await task_svc.list_tasks(db, user, page=1, size=5, sort="due", statuses=[TaskStatus.open, TaskStatus.in_progress],
                                             assignee="me", org_id=None, kind=None, priority=None, overdue=False, search=None)
    if not items:
        await message.answer("Открытых задач нет 👌")
        return
    await message.answer(f"<b>Открытые задачи:</b> {total}. Ближайшие по сроку:")
    for t in items:
        await message.answer(_task_text(t), reply_markup=kb.task_keyboard(t.id, t.status.value))


def _task_text(t: Task) -> str:
    due = f"\nСрок: {t.due_at:%d.%m %H:%M} UTC" if t.due_at else ""
    prio = {"high": "🔴", "normal": "🟡", "low": "⚪"}[t.priority.value]
    return (f"{prio} <b>{esc(t.title)}</b>\n{esc(t.organization.name)} · {esc(task_svc.TASK_STATUS_NAMES[t.status])}{due}"
            + (f"\n{esc(t.description[:300])}" if t.description else ""))


@router.message(Command("notifications"))
@router.message(F.text == "🔔 Уведомления")
async def cmd_notifications(message: Message, db: AsyncSession, user: User | None) -> None:
    if not await _need_user(message, user):
        return
    items, total = await notif_svc.list_for(db, user, unread_only=True, page=1, size=5)
    if not items:
        await message.answer("Новых уведомлений нет.")
        return
    lines = [f"<b>Непрочитанные:</b> {total}"] + [f"• {esc(n.title)}" for n in items]
    await message.answer("\n".join(lines), reply_markup=kb.inline([InlineKeyboardButton(text="Отметить прочитанными", callback_data="notif_read_all")],
                                                                  [kb.open_app_button("Все уведомления", "/notifications")]))


@router.callback_query(F.data == "notif_read_all")
async def cb_read_all(query: CallbackQuery, db: AsyncSession, user: User | None) -> None:
    if user is None:
        await query.answer("Сначала войдите: /start", show_alert=True)
        return
    n = await notif_svc.mark_all_read(db, user)
    await query.answer(f"Прочитано: {n}")
    try:
        await query.message.edit_reply_markup(reply_markup=None)
    except TelegramBadRequest:
        pass


@router.callback_query(F.data.regexp(r"^offer_(hide|unsub|open):\d+$"))
async def cb_offer(query: CallbackQuery, db: AsyncSession, user: User | None) -> None:
    if user is None:
        await query.answer("Сначала войдите: /start", show_alert=True)
        return
    action, comm_id = query.data.split(":")
    kind = {"offer_hide": "hidden", "offer_unsub": "unsubscribe_push", "offer_open": "clicked"}[action]
    try:
        comm = await register_interaction(db, user, int(comm_id), kind)
    except AppError as e:
        await query.answer(e.message, show_alert=True)
        return
    if kind == "hidden":
        await query.answer("Скрыли это предложение — больше не покажем его 30 дней")
    elif kind == "unsubscribe_push":
        await query.answer("Push-предложения отключены. Сервисные уведомления о заявках продолжат приходить", show_alert=True)
    else:
        await query.answer()
        await query.message.answer(f"<b>{esc(comm.headline)}</b>\n{esc(comm.body)}\n\nРасчёт и заявка доступны в приложении.")
        return
    try:
        await query.message.edit_reply_markup(reply_markup=None)
    except TelegramBadRequest:
        pass


@router.callback_query(F.data.regexp(r"^app:\d+$"))
async def cb_app(query: CallbackQuery, db: AsyncSession, user: User | None) -> None:
    if user is None:
        await query.answer("Сначала войдите: /start", show_alert=True)
        return
    try:
        a = await app_svc.get_application(db, user, int(query.data.split(":")[1]))
    except AppError as e:
        await query.answer(e.message, show_alert=True)
        return
    await query.answer(f"{a.number}: {app_svc.STATUS_NAMES[a.status]}", show_alert=True)


@router.callback_query(F.data.regexp(r"^task_take:\d+$"))
async def cb_task_take(query: CallbackQuery, db: AsyncSession, user: User | None) -> None:
    if user is None or user.role == UserRole.client:
        await query.answer("Недоступно", show_alert=True)
        return
    task_id = int(query.data.split(":")[1])
    try:
        t = await task_svc.change_status(db, user, task_id, TaskStatus.in_progress)
    except AppError as e:
        await query.answer(e.message, show_alert=True)  # повторное нажатие → «уже в статусе»
        return
    t = await task_svc.get_task(db, user, t.id)
    await query.answer("Задача в работе")
    try:
        await query.message.edit_text(_task_text(t), reply_markup=kb.task_keyboard(t.id, t.status.value))
    except TelegramBadRequest:
        pass


@router.callback_query(F.data.regexp(r"^task_done:\d+$"))
async def cb_task_done(query: CallbackQuery, state: FSMContext, db: AsyncSession, user: User | None) -> None:
    if user is None or user.role == UserRole.client:
        await query.answer("Недоступно", show_alert=True)
        return
    task_id = int(query.data.split(":")[1])
    try:
        t = await task_svc.get_task(db, user, task_id)
    except AppError as e:
        await query.answer(e.message, show_alert=True)
        return
    if t.status in (TaskStatus.done, TaskStatus.cancelled):
        await query.answer("Задача уже закрыта", show_alert=True)
        return
    await state.set_state(TaskDone.comment)
    await state.update_data(task_id=task_id)
    await query.answer()
    await query.message.answer(f"Задача «{esc(t.title)}».\nНапишите коротко результат (до 500 символов). /skip — без комментария, /cancel — отмена.")


@router.message(StateFilter(TaskDone.comment), Command("skip"))
@router.message(StateFilter(TaskDone.comment), F.text)
async def task_done_comment(message: Message, state: FSMContext, db: AsyncSession, user: User | None) -> None:
    if message.text.startswith("/") and message.text.split()[0] not in ("/skip",):
        await message.answer("Напишите результат текстом, /skip или /cancel.")
        return
    data = await state.get_data()
    comment = None if message.text.startswith("/skip") else message.text.strip()
    if comment and len(comment) > 500:
        await message.answer("Слишком длинно: до 500 символов. Попробуйте короче.")
        return
    try:
        t = await task_svc.change_status(db, user, int(data["task_id"]), TaskStatus.done, comment)
    except AppError as e:
        await message.answer(f"Не удалось закрыть задачу: {esc(e.message)}\nНапишите результат или /cancel.")
        return
    await state.clear()
    await message.answer(f"✅ Задача «{esc(t.title)}» выполнена.", reply_markup=kb.main_menu(user.role))


@router.message(StateFilter(TaskDone.comment))
async def task_done_other(message: Message) -> None:
    await message.answer("Ожидаю текст результата. /skip — без комментария, /cancel — отмена.")


@router.message()
async def fallback(message: Message, user: User | None) -> None:
    await message.answer("Не понял сообщение. Воспользуйтесь меню или /help.", reply_markup=kb.main_menu(user.role if user else None))


@router.errors()
async def on_error(event: ErrorEvent) -> bool:
    log.exception("Ошибка обработки update: %s", event.exception)
    upd = event.update
    try:
        if upd.callback_query:
            await upd.callback_query.answer("Что-то пошло не так. Попробуйте ещё раз", show_alert=True)
        elif upd.message:
            await upd.message.answer("Что-то пошло не так. Попробуйте ещё раз или откройте приложение.")
    except Exception:  # noqa: BLE001
        pass
    return True


async def render_notification(db: AsyncSession, n: Notification) -> tuple[str, object]:
    """Текст и клавиатура для доставки уведомления в Telegram."""
    p = n.tg_payload or {}
    t = p.get("type")
    if t == "offer":
        return (f"<b>{esc(n.title)}</b>\n{esc(n.body)}\n\n<i>Персональное предложение</i>",
                kb.offer_keyboard(int(p["communication_id"]), str(p.get("cta") or "Рассчитать")))
    if t == "application":
        return f"📄 <b>{esc(n.title)}</b>\n{esc(n.body)}", kb.application_keyboard(int(p["application_id"]), True)
    if t == "task":
        task = await db.get(Task, int(p["task_id"]))
        status = task.status.value if task else "done"
        return f"✅ <b>{esc(n.title)}</b>\n{esc(n.body)}", kb.task_keyboard(int(p["task_id"]), status)
    btn = kb.open_app_button("Открыть", n.link) if n.link else None
    return f"🔔 <b>{esc(n.title)}</b>\n{esc(n.body)}", kb.inline([btn]) if btn else None


async def application_for(db: AsyncSession, app_id: int) -> Application | None:
    return await db.get(Application, app_id)
