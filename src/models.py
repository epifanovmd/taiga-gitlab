"""
Типы данных приложения.

Содержит внутренние структуры (PipelineMatchResult) и аннотации
для ответов Taiga API.
"""

from dataclasses import dataclass
from typing import TypedDict


# ── Pipeline Match Result ────────────────────────────────────────


@dataclass
class PipelineMatchResult:
    """Результат успешного сопоставления события GitLab с критериями."""

    task_number: str
    """Номер задачи из коммита (например, "4545" из "TG-4545")."""
    pipeline_id: int
    """ID пайплайна GitLab."""
    pipeline_url: str
    """Ссылка на пайплайн в GitLab."""


# ── Taiga API Response Types ─────────────────────────────────────

# TypedDict ниже служат документацией и подсказками типа —
# парсинг ответов происходит через обычный json / dict.


class TaigaAuthResponse(TypedDict):
    auth_token: str
    refresh_token: str


class TaigaRefreshResponse(TypedDict):
    auth_token: str


class TaigaUserStory(TypedDict):
    id: int
    ref: int
    subject: str
    version: int
    status: int


class TaigaStatus(TypedDict):
    id: int
    name: str
    project: int
