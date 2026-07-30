"""
HTTP-клиент для Taiga API.

Отвечает исключительно за транспортный уровень:
  - авторизация / refresh токена
  - выполнение HTTP-запросов
  - автоматическая обработка 401 (retry с обновлением токена)
  - очередь запросов во время обновления токена

Не содержит бизнес-логики — этим занимается TaigaService.
"""

import asyncio
import json
import logging
from typing import Any

import aiohttp

from .config import CONFIG

logger = logging.getLogger(__name__)


class TaigaAPI:
    """HTTP-клиент для Taiga API с поддержкой автоматического refresh токена."""

    def __init__(self) -> None:
        self.access_token: str | None = None
        """Текущий access-токен. Публичное поле — для проверки авторизации."""

        self._refresh_token: str | None = None
        self._is_refreshing: bool = False
        self._pending_requests: list[
            tuple[str, str, dict[str, Any] | None, asyncio.Future]
        ] = []
        self._http_session: aiohttp.ClientSession | None = None

    # ── Lifecycle ──────────────────────────────────────────────────────────

    async def close(self) -> None:
        """Закрыть HTTP-сессию."""
        if self._http_session is not None and not self._http_session.closed:
            await self._http_session.close()
            self._http_session = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Получить (или создать) HTTP-сессию."""
        if self._http_session is None or self._http_session.closed:
            self._http_session = aiohttp.ClientSession()
        return self._http_session

    # ── Public API ─────────────────────────────────────────────────────────

    async def login(self) -> dict[str, Any]:
        """Авторизация в Taiga (type = normal).

        Вызывается автоматически при первом запросе, если токена нет.
        """
        logger.info("🔑 Авторизация в Taiga...")

        session = await self._get_session()
        async with session.post(
            f"{CONFIG.taiga.base_url}/auth",
            json={
                "type": "normal",
                "username": CONFIG.taiga.credentials.username,
                "password": CONFIG.taiga.credentials.password,
            },
        ) as resp:
            if not resp.ok:
                raise RuntimeError(f"Ошибка авторизации: {resp.status}")

            data: dict[str, Any] = await resp.json()
            self.access_token = data["auth_token"]
            self._refresh_token = data.get("refresh_token")

            logger.info("✅ Авторизация успешна")
            return data

    async def find_user_story(
        self, ref: int, project_id: int
    ) -> dict[str, Any]:
        """Поиск User Story по номеру задачи (ref) в указанном проекте.

        Raises:
            RuntimeError: если User Story не найдена.
        """
        logger.info("   → GET /userstories/by_ref?ref=%s&project=%s", ref, project_id)

        data = await self._request(
            f"/userstories/by_ref?ref={ref}&project={project_id}"
        )

        if not data or "id" not in data:
            raise RuntimeError(
                f"User Story #{ref} не найдена в проекте {project_id}"
            )

        return data

    async def get_project_statuses(self, project_id: int) -> list[dict[str, Any]]:
        """Получение списка статусов проекта."""
        logger.info("   → GET /userstory-statuses?project=%s", project_id)

        data = await self._request(
            f"/userstory-statuses?project={project_id}"
        )

        if not isinstance(data, list):
            raise RuntimeError("Неожиданный формат ответа статусов проекта")

        logger.info("   ✅ Получено %s статусов", len(data))
        return data

    async def update_user_story(
        self,
        user_story_id: int,
        status_id: int,
        version: int,
        comment: str | None = None,
    ) -> dict[str, Any]:
        """Обновление статуса User Story (опционально — с комментарием)."""
        body: dict[str, Any] = {
            "status": status_id,
            "version": version,
        }
        if comment is not None:
            body["comment"] = comment

        logger.info(
            "   → PATCH /userstories/%s (status=%s, version=%s)",
            user_story_id,
            status_id,
            version,
        )

        result = await self._request(
            f"/userstories/{user_story_id}",
            method="PATCH",
            body=body,
        )

        logger.info("   ✅ Статус обновлён")
        return result

    # ── Private: transport layer ───────────────────────────────────────────

    async def _request(
        self,
        endpoint: str,
        method: str = "GET",
        body: dict[str, Any] | None = None,
    ) -> Any:
        """Базовый метод для выполнения HTTP-запроса к Taiga API.

        - Добавляет Authorization header при наличии токена.
        - Автоматически обрабатывает 401 (попытка refresh и retry).
        - Парсит JSON-ответ, проверяет _error_message.
        """
        url = f"{CONFIG.taiga.base_url}{endpoint}"
        headers: dict[str, str] = {"Content-Type": "application/json"}

        if self.access_token is not None:
            headers["Authorization"] = f"Bearer {self.access_token}"

        session = await self._get_session()

        async with session.request(
            method, url, headers=headers, json=body
        ) as response:
            # 401 → пытаемся обновить токен и повторить
            if response.status == 401:
                return await self._handle_unauthorized(endpoint, method, body)

            # Читаем тело ответа (может быть пустым — 204 No Content)
            text = await response.text()

        if not text:
            return {}

        data = json.loads(text)

        if isinstance(data, dict) and "_error_message" in data:
            raise RuntimeError(data["_error_message"])

        return data

    async def _handle_unauthorized(
        self,
        endpoint: str,
        method: str,
        body: dict[str, Any] | None,
    ) -> Any:
        """Обработка 401.

        Если refresh уже запущен — встаём в очередь.
        Иначе — обновляем токен, дожидаемся очереди, ретраим текущий запрос.
        Если refresh не удался — пробуем авторизоваться заново.
        """
        # Если refresh уже идёт — паркуем запрос в очередь
        if self._is_refreshing:
            loop = asyncio.get_running_loop()
            future = loop.create_future()
            self._pending_requests.append((endpoint, method, body, future))
            return await future

        self._is_refreshing = True

        try:
            await self._refresh_access_token()

            # Снимаем очередь (пока isRefreshing ещё True → новые 401 не запустят
            # повторный refresh)
            pending = self._pending_requests.copy()
            self._pending_requests.clear()

            for ep, m, b, fut in pending:
                asyncio.create_task(self._relay(ep, m, b, fut))

            self._is_refreshing = False

            # Ретраим исходный запрос
            return await self._request(endpoint, method=method, body=body)

        except Exception as exc:
            logger.warning(
                "Не удалось обновить токен (%s), пробуем авторизоваться заново...",
                exc,
            )

            pending = self._pending_requests.copy()
            self._pending_requests.clear()
            self._is_refreshing = False

            # Пробуем залогиниться с кредами
            await self.login()

            # Ретраим всё, что лежало в очереди
            for ep, m, b, fut in pending:
                asyncio.create_task(self._relay(ep, m, b, fut))

            # Ретраим исходный запрос
            return await self._request(endpoint, method=method, body=body)

    async def _relay(
        self,
        endpoint: str,
        method: str,
        body: dict[str, Any] | None,
        future: asyncio.Future,
    ) -> None:
        """Выполнить запрос и передать результат в future (для очереди)."""
        try:
            result = await self._request(endpoint, method=method, body=body)
            future.set_result(result)
        except Exception as exc:
            future.set_exception(exc)

    async def _refresh_access_token(self) -> None:
        """Обновление access-токена через refresh-токен."""
        if self._refresh_token is None:
            raise RuntimeError("Нет refresh токена")

        logger.info("🔄 Обновление токена...")

        session = await self._get_session()
        async with session.post(
            f"{CONFIG.taiga.base_url}/auth/refresh",
            json={"refresh": self._refresh_token},
        ) as resp:
            if not resp.ok:
                raise RuntimeError(f"Ошибка обновления токена: {resp.status}")

            data: dict[str, Any] = await resp.json()
            self.access_token = data["auth_token"]

        logger.info("🔄 Токен обновлён")
