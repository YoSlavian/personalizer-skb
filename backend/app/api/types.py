import re
from typing import Annotated

from pydantic import AfterValidator, Field

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s.]{2,24}$")


def _email(v: str) -> str:
    v = v.strip().lower()
    if not _EMAIL.match(v):
        raise ValueError("Некорректный email")
    return v


# Синтаксическая проверка без DNS: демо-учётки используют служебные домены (.local, .demo)
Email = Annotated[str, Field(max_length=255), AfterValidator(_email)]
