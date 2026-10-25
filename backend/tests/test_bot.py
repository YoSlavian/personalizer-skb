"""Telegram-бот: команды, демо-персоны, callback-кнопки, повторные нажатия и update, FSM, доставка уведомлений."""

from datetime import datetime
from itertools import count

import pytest
from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.exceptions import TelegramForbiddenError, TelegramNetworkError
from aiogram.methods import SendMessage, TelegramMethod
from aiogram.types import CallbackQuery, Chat, Message, Update, User as TgUser
from sqlalchemy import select

from app import db as dbmod
from app.bot.outbox import deliver_one
from app.bot.runtime import build_dispatcher
from app.models import Notification, ProcessedUpdate, Task, TelegramLink, User
from app.models.enums import NotificationKind

_ids = count(1_000_000)


class FakeSession(BaseSession):
    """Подменяет HTTP к Telegram: записывает вызовы, отвечает минимальными валидными объектами."""

    def __init__(self, fail: Exception | None = None) -> None:
        super().__init__()
        self.calls: list[TelegramMethod] = []
        self.fail = fail

    async def make_request(self, bot, method, timeout=None):  # noqa: ANN001
        self.calls.append(method)
        if self.fail and isinstance(method, SendMessage):
            raise self.fail
        if isinstance(method, SendMessage):
            return Message(message_id=next(_ids), date=datetime.now(), chat=Chat(id=method.chat_id, type="private"), text=method.text)
        return True

    async def close(self) -> None:
        pass

    async def stream_content(self, *a, **kw):  # noqa: ANN002, ANN003
        yield b""

    def texts(self) -> list[str]:
        return [m.text for m in self.calls if isinstance(m, SendMessage)]


def make_bot(session: FakeSession) -> Bot:
    return Bot("123456:TEST-TOKEN-not-real", session=session)


def msg_update(tg_id: int, text: str, update_id: int | None = None) -> Update:
    user = TgUser(id=tg_id, is_bot=False, first_name="Тест")
    return Update(update_id=update_id or next(_ids), message=Message(message_id=next(_ids), date=datetime.now(),
                                                                       chat=Chat(id=tg_id, type="private"), from_user=user, text=text))


def cb_update(tg_id: int, data: str, update_id: int | None = None) -> Update:
    user = TgUser(id=tg_id, is_bot=False, first_name="Тест")
    msg = Message(message_id=next(_ids), date=datetime.now(), chat=Chat(id=tg_id, type="private"), from_user=user, text="…")
    return Update(update_id=update_id or next(_ids), callback_query=CallbackQuery(id=str(next(_ids)), from_user=user, chat_instance="x",
                                                                                 message=msg, data=data))


@pytest.fixture
def harness():
    session = FakeSession()
    bot, dp = make_bot(session), build_dispatcher()

    async def feed(update: Update) -> None:
        await dp.feed_update(bot, update)

    return session, feed


async def test_start_unlinked_offers_demo_personas_and_links(harness):
    session, feed = harness
    await feed(msg_update(990001, "/start"))
    sent = [m for m in session.calls if isinstance(m, SendMessage)]
    assert "Персонализатор СКБ" in sent[-1].text
    buttons = [b.callback_data for row in sent[-1].reply_markup.inline_keyboard for b in row if b.callback_data]
    assert "persona:manager" in buttons
    await feed(cb_update(990001, "persona:manager"))
    async with dbmod.session_factory()() as s:
        link = (await s.execute(select(TelegramLink).where(TelegramLink.telegram_user_id == 990001))).scalar_one()
        assert link.via == "demo" and link.user.email == "km.ivanova@demo.local"
    assert any("клиентский менеджер" in t for t in session.texts())


async def test_link_code_deep_link(harness, client):
    from tests.conftest import login

    await login(client, "buh@kod-servis.demo")
    code = (await client.post("/api/me/telegram/link-code")).json()
    assert code["deep_link"].startswith("https://t.me/personalizer_test_bot?start=")
    session, feed = harness
    await feed(msg_update(990002, f"/start {code['code']}"))
    assert any("привязан" in t for t in session.texts())
    await feed(msg_update(990003, f"/start {code['code']}"))  # код одноразовый
    assert any("Не удалось привязать" in t for t in session.texts())


async def test_status_and_unknown_text(harness):
    session, feed = harness
    await feed(cb_update(990004, "persona:client_fd"))
    await feed(msg_update(990004, "/status"))
    assert any("Заявки" in t and "З-" in t for t in session.texts())
    await feed(msg_update(990004, "привет"))
    assert "Не понял" in session.texts()[-1]


async def test_task_buttons_repeat_press_and_fsm_done(harness):
    session, feed = harness
    await feed(cb_update(990005, "persona:manager"))
    async with dbmod.session_factory()() as s:
        km = (await s.execute(select(User).where(User.email == "km.ivanova@demo.local"))).scalar_one()
        task = (await s.execute(select(Task).where(Task.assignee_id == km.id, Task.status == "open", Task.kind != "update_crm_role"))).scalars().first()
    await feed(cb_update(990005, f"task_take:{task.id}"))
    await feed(cb_update(990005, f"task_take:{task.id}"))  # повторное нажатие
    answers = [m for m in session.calls if type(m).__name__ == "AnswerCallbackQuery"]
    assert answers[-2].text == "Задача в работе" and "уже" in answers[-1].text
    await feed(cb_update(990005, f"task_done:{task.id}"))
    assert "Напишите коротко результат" in session.texts()[-1]
    await feed(msg_update(990005, "Перезвонили, клиент думает"))
    assert "выполнена" in session.texts()[-1]
    async with dbmod.session_factory()() as s:
        t = await s.get(Task, task.id)
        assert t.status.value == "done" and t.result == "Перезвонили, клиент думает"


async def test_same_update_processed_once(harness):
    session, feed = harness
    upd = msg_update(990006, "/help", update_id=55_000_001)
    await feed(upd)
    before = len(session.calls)
    await feed(msg_update(990006, "/help", update_id=55_000_001))
    assert len(session.calls) == before
    async with dbmod.session_factory()() as s:
        assert await s.get(ProcessedUpdate, 55_000_001)


async def _notification_for(email: str, tg_id: int) -> int:
    async with dbmod.session_factory()() as s:
        u = (await s.execute(select(User).where(User.email == email))).scalar_one()
        if not (await s.execute(select(TelegramLink).where(TelegramLink.telegram_user_id == tg_id))).scalar_one_or_none():
            s.add(TelegramLink(user_id=u.id, telegram_user_id=tg_id, chat_id=tg_id))
        n = Notification(user_id=u.id, kind=NotificationKind.system, title="Проверка доставки", body="текст", tg_status="pending")
        s.add(n)
        await s.commit()
        return n.id


async def test_outbox_delivery_success_retry_and_blocked():
    nid = await _notification_for("admin@demo.local", 990007)
    ok = FakeSession()
    assert await deliver_one(make_bot(ok), nid) == "sent"
    assert await deliver_one(make_bot(ok), nid) == "skipped"  # повторно не отправляем

    nid = await _notification_for("admin@demo.local", 990007)
    net = FakeSession(fail=TelegramNetworkError(method=SendMessage(chat_id=1, text="x"), message="timeout"))
    assert await deliver_one(make_bot(net), nid) == "retry"

    nid = await _notification_for("admin@demo.local", 990007)
    blocked = FakeSession(fail=TelegramForbiddenError(method=SendMessage(chat_id=1, text="x"), message="bot was blocked by the user"))
    assert await deliver_one(make_bot(blocked), nid) == "failed"
