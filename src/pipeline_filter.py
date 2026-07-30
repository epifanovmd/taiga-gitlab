"""
Фильтр входящих GitLab-событий.

Чистая функция: принимает payload, возвращает PipelineMatchResult или None.
Каждый шаг проверки логирует результат — видно, на каком условии отсеялось.

Условия срабатывания:
  1. object_kind === 'pipeline'
  2. object_attributes.ref === TG_GITLAB_MATCH_REF
  3. user.name в списке TG_GITLAB_MATCH_USER
  4. object_attributes.status === TG_GITLAB_MATCH_STATUS
  5. commit.message начинается с 'Merge branch'
  6. commit.message содержит TG-XXXX
"""

import logging

from .config import CONFIG
from .models import PipelineMatchResult

logger = logging.getLogger(__name__)


def match_pipeline_event(payload: object) -> PipelineMatchResult | None:
    """Проверяет, подходит ли входящий webhook-payload под наши критерии.

    Args:
        payload: Распарсенный JSON тела запроса.

    Returns:
        PipelineMatchResult если событие подходит, None — если нет.
    """
    # ── 1. Проверка структуры ──────────────────────────────────────────────

    if not _is_pipeline_event(payload):
        logger.info("⏭️  Событие пропущено: не pipeline (или не хватает полей)")
        return None

    attrs: dict = payload["object_attributes"]  # type: ignore[index]
    user: dict = payload["user"]  # type: ignore[index]
    commit: dict = payload["commit"]  # type: ignore[index]

    # ── 2. Проверка условий фильтрации ──────────────────────────────────────

    if attrs.get("ref") != CONFIG.gitlab.match_ref:
        logger.info(
            '⏭️  Пропущено: ref "%s" != "%s"',
            attrs.get("ref"),
            CONFIG.gitlab.match_ref,
        )
        return None

    allowed_users = [u.strip() for u in CONFIG.gitlab.match_user.split(",")]

    if user.get("name") not in allowed_users:
        logger.info(
            '⏭️  Пропущено: user "%s" != %s',
            user.get("name"),
            allowed_users,
        )
        return None

    if attrs.get("status") != CONFIG.gitlab.match_status:
        logger.info(
            '⏭️  Пропущено: status "%s" != "%s"',
            attrs.get("status"),
            CONFIG.gitlab.match_status,
        )
        return None

    message: str = commit.get("message", "")

    if not message.startswith("Merge branch"):
        logger.info("⏭️  Пропущено: commit не является merge-коммитом")
        return None

    # ── 3. Событие подходит ────────────────────────────────────────────────

    short_sha = commit.get("id", "unknown")[:8]
    logger.info("")
    logger.info("🎯 Найден целевой пайплайн!")
    logger.info("   ┌ Pipeline:  #%s", attrs.get("id"))
    logger.info("   ├ Ref:       %s", attrs.get("ref"))
    logger.info("   ├ Status:    %s", attrs.get("status"))
    logger.info("   ├ User:      %s", user.get("name"))
    logger.info("   ├ Commit:    %s — %s", short_sha, commit.get("title"))
    logger.info("   └ URL:       %s", attrs.get("url"))

    # ── 4. Извлечение номера задачи ───────────────────────────────────────

    pattern = CONFIG.gitlab.task_pattern
    match = pattern.search(message)

    if not match:
        logger.info(
            "⚠️  TG-XXXX не найден в сообщении коммита — задача не будет обработана",
        )
        escaped = message.replace("\n", "\\n")
        logger.info('   Сообщение: "%s"', escaped)
        return None

    task_number = match.group(1)
    logger.info("🔢 Номер задачи из коммита: TG-%s", task_number)

    return PipelineMatchResult(
        task_number=task_number,
        pipeline_id=attrs["id"],
        pipeline_url=attrs["url"],
    )


# ── Type guard ───────────────────────────────────────────────────


def _is_pipeline_event(payload: object) -> bool:
    """Проверяет, что payload — это pipeline-событие с обязательными полями.

    Использует структурную проверку, чтобы не упасть на неполных данных.
    """
    if not isinstance(payload, dict):
        logger.info("⚠️  payload не является объектом")
        return False

    if payload.get("object_kind") != "pipeline":
        return False

    if not isinstance(payload.get("object_attributes"), dict):
        logger.info("⚠️  object_attributes отсутствует или не объект")
        return False

    if not isinstance(payload.get("user"), dict):
        logger.info("⚠️  user отсутствует или не объект")
        return False

    if not isinstance(payload.get("commit"), dict):
        logger.info("⚠️  commit отсутствует или не объект")
        return False

    return True
