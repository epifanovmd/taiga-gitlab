"""
Сервис для выполнения бизнес-операций в Taiga.

Координирует вызовы TaigaAPI в правильной последовательности:
  1. Аутентификация (если ещё не авторизованы)
  2. Поиск User Story по номеру задачи
  3. Получение списка статусов проекта
  4. Поиск нужного статуса ("Ready for test")
  5. Обновление статуса User Story с комментарием

Каждый шаг логирует результат с контекстом задачи и пайплайна.
"""

import logging
import time

from .config import CONFIG
from .models import PipelineMatchResult
from .taiga_api import TaigaAPI

logger = logging.getLogger(__name__)


class TaigaService:
    """Бизнес-логика обработки найденного пайплайна."""

    def __init__(self, api: TaigaAPI) -> None:
        self._api = api

    async def process_pipeline_match(self, match: PipelineMatchResult) -> None:
        """Обработать найденный пайплайн-матч: найти User Story в Taiga,
        перевести её в статус "Ready for test" и прикрепить комментарий
        со ссылкой на пайплайн.

        Args:
            match: Результат фильтрации события GitLab.

        Raises:
            RuntimeError: если User Story или целевой статус не найдены.
        """
        task_number = match.task_number
        pipeline_url = match.pipeline_url
        pipeline_id = match.pipeline_id

        logger.info("")
        logger.info("═══════════════════════════════════════════════════════════")
        logger.info("🚀 Начинаю обработку пайплайна в Taiga")
        logger.info("   Pipeline:  #%s", pipeline_id)
        logger.info("   Задача:    TG-%s", task_number)
        logger.info("   Проект:    #%s", CONFIG.taiga.project_id)
        logger.info("═══════════════════════════════════════════════════════════")

        start_time = time.monotonic()

        try:
            # ── 1. Аутентификация ─────────────────────────────────────────────
            logger.info("")
            logger.info("🔑 Шаг 1/5 — Проверка авторизации в Taiga...")

            if self._api.access_token is None:
                logger.info("   → Токен отсутствует, выполняю login...")
                await self._api.login()
            else:
                logger.info("   → Уже авторизован (токен есть)")

            # ── 2. Поиск User Story ──────────────────────────────────────────
            logger.info("")
            logger.info("🔍 Шаг 2/5 — Поиск User Story по номеру TG-%s...", task_number)

            user_story = await self._api.find_user_story(
                int(task_number),
                CONFIG.taiga.project_id,
            )

            logger.info(
                '   ✅ Найдено: #%s "%s"',
                user_story["ref"],
                user_story["subject"],
            )
            logger.info("   📍 Текущий статус ID: %s", user_story["status"])

            # ── 3. Получение статусов проекта ────────────────────────────────
            logger.info("")
            logger.info("📋 Шаг 3/5 — Загрузка доступных статусов проекта...")

            statuses = await self._api.get_project_statuses(
                CONFIG.taiga.project_id,
            )

            logger.info("   → Всего статусов: %s", len(statuses))
            for s in statuses:
                marker = (
                    " ← ЦЕЛЕВОЙ"
                    if s.get("name") == CONFIG.taiga.target_status_name
                    else ""
                )
                logger.info('     • #%s — "%s"%s', s.get("id"), s.get("name"), marker)

            # ── 4. Поиск целевого статуса ────────────────────────────────────
            logger.info("")
            logger.info(
                '🎯 Шаг 4/5 — Поиск статуса "%s"...',
                CONFIG.taiga.target_status_name,
            )

            target_status = next(
                (
                    s
                    for s in statuses
                    if s.get("name") == CONFIG.taiga.target_status_name
                ),
                None,
            )

            if target_status is None:
                raise RuntimeError(
                    f'Статус "{CONFIG.taiga.target_status_name}" не найден '
                    f"в проекте {CONFIG.taiga.project_id}"
                )

            logger.info(
                '   ✅ Найден: #%s — "%s"',
                target_status["id"],
                target_status["name"],
            )

            # ── 5. Обновление статуса + комментарий ─────────────────────────
            logger.info("")
            logger.info("✏️  Шаг 5/5 — Обновление статуса User Story...")

            comment = f"✅ Пайплайн: {pipeline_url}"

            logger.info('   → Новый статус: #%s — "%s"', target_status["id"], target_status["name"])
            logger.info("   → Комментарий: %s", comment)
            logger.info("   → Версия US:   %s", user_story["version"])

            await self._api.update_user_story(
                user_story["id"],
                target_status["id"],
                user_story["version"],
                comment,
            )

            elapsed = time.monotonic() - start_time

            logger.info("")
            logger.info("═══════════════════════════════════════════════════════════")
            logger.info(
                "✅ УСПЕХ! User Story #%s обработана (%.1fс)",
                user_story["ref"],
                elapsed,
            )
            logger.info("   📌 Статус:    %s", target_status["name"])
            logger.info("   🔗 Pipeline:  %s", pipeline_url)
            logger.info("═══════════════════════════════════════════════════════════")

            # ── Текущий статус User Story после обновления (если нужно) ────
            if user_story["status"] == target_status["id"]:
                logger.info("   ⚠️  User Story уже была в целевом статусе")

        except Exception as exc:
            elapsed = time.monotonic() - start_time
            message = str(exc)

            logger.info("")
            logger.info("═══════════════════════════════════════════════════════════")
            logger.info("❌ ОШИБКА! (%.1fс)", elapsed)
            logger.info("   Pipeline: #%s", pipeline_id)
            logger.info("   Задача:   TG-%s", task_number)
            logger.info("   Причина:  %s", message)
            logger.info("═══════════════════════════════════════════════════════════")

            raise RuntimeError(
                f"Ошибка обработки задачи #{task_number}: {message}",
            ) from exc
