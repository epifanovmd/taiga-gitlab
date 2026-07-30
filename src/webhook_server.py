"""
HTTP-сервер для приёма webhook'ов от GitLab.

Единственная ответственность: слушать порт, парсить входящие POST-запросы
на /webhook, передавать payload в filter/service и всегда отвечать 200.

Особенности:
  - Работает на aiohttp.
  - Каждый запрос обрабатывается изолированно; ошибки в одном не влияют
    на другие.
  - Ответ 200 возвращается сразу, обработка Taiga — в фоне.
"""

import asyncio
import json
import logging

from aiohttp import web

from .config import CONFIG
from .models import PipelineMatchResult
from .pipeline_filter import match_pipeline_event
from .taiga_service import TaigaService

logger = logging.getLogger(__name__)


def create_app(taiga_service: TaigaService) -> web.Application:
    """Создаёт и настраивает aiohttp-приложение.

    Args:
        taiga_service: Сервис бизнес-логики Taiga.

    Returns:
        Настроенное aiohttp-приложение.
    """
    app = web.Application(client_max_size=CONFIG.server.max_body_size)
    app["taiga_service"] = taiga_service
    app.router.add_post("/webhook", _handle_webhook)

    # Graceful shutdown логи
    app.on_shutdown.append(_on_shutdown)
    app.on_cleanup.append(_on_cleanup)

    return app


# ── Request handler ──────────────────────────────────────────────


async def _handle_webhook(request: web.Request) -> web.Response:
    """Обработчик POST /webhook."""
    # Принимаем только POST /webhook
    if request.method != "POST" or request.path != "/webhook":
        logger.info(
            "⏭️  %s %s — игнорирую (только POST /webhook)",
            request.method,
            request.path,
        )
        return web.json_response({"error": "Not Found"}, status=404)

    event_type = request.headers.get("X-Gitlab-Event", "Unknown Event")
    remote_addr = request.remote or "unknown"

    try:
        # 1. Читаем тело запроса
        raw_body = await request.read()
        payload_size_kb = len(raw_body) / 1024

        if not raw_body:
            logger.info("⚠️  Пустое тело запроса")
            return _json_response(400, {"status": "error", "message": "Empty body"})

        # 2. Парсим JSON
        try:
            payload = json.loads(raw_body)
        except json.JSONDecodeError:
            logger.info("⚠️  Тело запроса не является валидным JSON")
            return _json_response(400, {"status": "error", "message": "Invalid JSON"})

        # 3. Логируем входящее событие
        logger.info("")
        logger.info("╔══════════════════════════════════════════════════════════╗")
        logger.info("║ 📨 Входящий webhook")
        logger.info("║    Тип:     %s", event_type)
        logger.info("║    От:      %s", remote_addr)
        logger.info("║    Размер:  %.1f KB", payload_size_kb)
        logger.info("╚══════════════════════════════════════════════════════════╝")

        # 4. Пытаемся сопоставить событие с критериями
        match = match_pipeline_event(payload)

        if match is not None:
            logger.info("")
            logger.info("⚡ Событие подходит — запускаю обработку в Taiga...")

            # Обработка Taiga — в фоне, не блокируем ответ GitLab.
            # GitLab получит 200 сразу, а мы доделаем в тишине (или с ошибкой).
            taiga_service: TaigaService = request.app["taiga_service"]
            asyncio.create_task(
                _process_background(taiga_service, match),
            )
        else:
            logger.info("💤 Событие не прошло фильтр — ответ 200 без действий")

        # 5. Всегда отвечаем 200 — GitLab не должен переотправлять
        return _json_response(200, {"status": "ok"})

    except Exception:
        logger.exception("❌ Ошибка при обработке запроса")
        return _json_response(500, {"status": "error", "message": "Internal server error"})


async def _process_background(
    taiga_service: TaigaService,
    match: PipelineMatchResult,
) -> None:
    """Обработка пайплайна в фоновой задаче."""
    try:
        await taiga_service.process_pipeline_match(match)
    except Exception as exc:
        logger.error("❌ Ошибка обработки пайплайна: %s", exc)


def _json_response(status: int, data: dict) -> web.Response:
    return web.json_response(data, status=status)


# ── Lifecycle handlers ───────────────────────────────────────────


async def _on_shutdown(app: web.Application) -> None:
    """on_shutdown — вызывается при graceful shutdown перед закрытием."""
    # Сообщение о получении сигнала выводится в __main__.py


async def _on_cleanup(app: web.Application) -> None:
    """on_cleanup — закрываем HTTP-сессию TaigaAPI."""
    taiga_service: TaigaService | None = app.get("taiga_service")
    if taiga_service is not None:
        await taiga_service._api.close()  # noqa: SLF001
