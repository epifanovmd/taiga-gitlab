"""
Точка входа (Composition Root).

Собирает приложение вместе:
  1. Создаёт TaigaAPI
  2. Оборачивает его в TaigaService
  3. Создаёт aiohttp-приложение с TaigaService
  4. Запускает сервер
  5. Регистрирует graceful shutdown
"""

import asyncio
import logging
import signal
import sys

from aiohttp import web
from dotenv import load_dotenv

# Загружаем .env перед любыми импортами конфигурации
load_dotenv()

from .config import CONFIG
from .taiga_api import TaigaAPI
from .taiga_service import TaigaService
from .webhook_server import create_app

# ── Настройка логирования ────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    stream=sys.stdout,
)

logger = logging.getLogger(__name__)

# ── Main ─────────────────────────────────────────────────────────


async def main() -> None:
    """Сборка зависимостей и запуск сервера."""
    # Сборка зависимостей
    api = TaigaAPI()
    service = TaigaService(api)
    app = create_app(service)

    # Graceful shutdown
    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _signal_handler() -> None:
        logger.info("")
        logger.info("⚠️  Получен сигнал завершения. Останавливаем сервер...")
        if not stop_event.is_set():
            stop_event.set()

        # Если сервер не закрылся за 10 секунд — форсируем
        def force_exit() -> None:
            logger.error("⏱️  Принудительное завершение (timeout).")
            sys.exit(1)

        loop.call_later(10, force_exit)

    try:
        loop.add_signal_handler(signal.SIGINT, _signal_handler)
        loop.add_signal_handler(signal.SIGTERM, _signal_handler)
    except NotImplementedError:
        pass

    # Запуск aiohttp runner
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, CONFIG.server.host, CONFIG.server.port)
    await site.start()

    logger.info(
        "🚀 Сервер слушает %s:%s (эндпоинт: /webhook)",
        CONFIG.server.host,
        CONFIG.server.port,
    )
    logger.info(
        "📋 GitLab → Settings → Webhooks → URL: http://<IP>:%s/webhook",
        CONFIG.server.port,
    )

    # Ждём сигнала остановки
    await stop_event.wait()

    # Graceful shutdown
    await runner.cleanup()
    logger.info("👋 Сервер остановлен.")


# ── Run ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as err:
        logger.error("❌ Фатальная ошибка при запуске: %s", err)
        sys.exit(1)
