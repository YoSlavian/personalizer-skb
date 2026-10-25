from datetime import UTC, datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """Хранит время в UTC без зоны (одинаково для SQLite и PostgreSQL), отдаёт aware-datetime."""

    impl = sa.DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:  # noqa: ANN001
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:  # noqa: ANN001
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def enum_type(enum_cls: type[StrEnum], name: str) -> sa.Enum:
    """VARCHAR + CHECK-ограничение со списком значений: переносимо между SQLite и PostgreSQL."""
    return sa.Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=32,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )
