"""Движок персонализации: чистые функции без доступа к БД, одинаковые для веба, бота и тестов."""

from app.engine.decide import decide
from app.engine.holding import plan_group
from app.engine.profile import ClientProfile, DecisionResult
from app.engine.rules import RulesConfig, default_rules

__all__ = ["ClientProfile", "DecisionResult", "RulesConfig", "decide", "default_rules", "plan_group"]
