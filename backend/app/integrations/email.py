"""Email-канал. В демо — MockEmailAdapter: письмо не уходит наружу, текст сохраняется в журнале коммуникаций.

Для реальной отправки подключается корпоративный шлюз рассылок банка через тот же интерфейс.
"""

import uuid
from typing import Protocol

from app.integrations.base import log


class EmailAdapter(Protocol):
    name: str

    async def send(self, *, recipient_ref: str, subject: str, body: str) -> str: ...


class MockEmailAdapter:
    name = "mock"

    def __init__(self) -> None:
        self.outbox: list[dict] = []

    async def send(self, *, recipient_ref: str, subject: str, body: str) -> str:
        message_id = f"mock-{uuid.uuid4().hex[:12]}"
        self.outbox.append({"id": message_id, "to": recipient_ref, "subject": subject})
        self.outbox = self.outbox[-200:]
        log.info("email[mock] %s → %s: %s", message_id, recipient_ref, subject)
        return message_id


email_adapter: EmailAdapter = MockEmailAdapter()
