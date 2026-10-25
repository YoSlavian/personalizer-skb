from enum import StrEnum


class UserRole(StrEnum):
    admin = "admin"
    analyst = "analyst"
    manager = "manager"
    client = "client"


STAFF_ROLES = {UserRole.admin, UserRole.analyst, UserRole.manager}


class Industry(StrEnum):
    agro = "agro"
    retail = "retail"
    it = "it"
    log = "log"
    trade = "trade"
    mfg = "mfg"
    unk = "unk"


class Position(StrEnum):
    """Роль ЛПР по CRM (должность, без ФИО — 152-ФЗ)."""

    owner = "owner"
    fd = "fd"
    acc = "acc"
    ops = "ops"


class IbRights(StrEnum):
    """Права пользователя в интернет-банке: по ним роль выводится, если CRM пуст."""

    first_signature = "first_signature"
    second_signature = "second_signature"
    none = "none"


class BalanceKind(StrEnum):
    credit = "credit"
    surplus = "surplus"


class AbVariant(StrEnum):
    control = "control"  # AS IS: текущий оптимизатор
    test = "test"  # TO BE: новые признаки и правила


class SignalKind(StrEnum):
    fx_payment = "fx_payment"
    deposit_ending = "deposit_ending"
    bki_request = "bki_request"


class Channel(StrEnum):
    banner_ib = "banner_ib"
    boss = "boss"
    fx_placement = "fx_placement"
    push = "push"
    email = "email"
    km_call = "km_call"


PLACEMENT_CHANNELS = {Channel.banner_ib, Channel.boss, Channel.fx_placement}


class ConsentChannel(StrEnum):
    email = "email"
    push = "push"
    all = "all"


class CommStatus(StrEnum):
    planned = "planned"  # плейсмент ждёт показа в кабинете
    sent = "sent"
    shown = "shown"
    clicked = "clicked"
    converted = "converted"
    hidden = "hidden"
    blocked = "blocked"  # не отправлено политикой коммуникаций
    failed = "failed"


class AppStatus(StrEnum):
    draft = "draft"
    submitted = "submitted"
    in_review = "in_review"
    needs_info = "needs_info"
    approved = "approved"
    declined = "declined"
    cancelled = "cancelled"


class AppSource(StrEnum):
    web = "web"
    miniapp = "miniapp"
    bot = "bot"
    manager = "manager"


class TaskStatus(StrEnum):
    open = "open"
    in_progress = "in_progress"
    done = "done"
    cancelled = "cancelled"


class TaskKind(StrEnum):
    call_48h = "call_48h"
    update_crm_role = "update_crm_role"
    meeting = "meeting"
    hesitation = "hesitation"
    application_review = "application_review"
    group_offer = "group_offer"
    manual = "manual"


class Priority(StrEnum):
    low = "low"
    normal = "normal"
    high = "high"


class NotificationKind(StrEnum):
    application = "application"
    task = "task"
    offer = "offer"
    system = "system"


class SessionKind(StrEnum):
    web = "web"
    miniapp = "miniapp"
