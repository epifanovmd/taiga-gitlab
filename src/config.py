"""
Конфигурация приложения.

Все параметры читаются из переменных окружения (с префиксом TG_).
Если переменная не задана — используется значение по умолчанию.
"""

import os
import re
from dataclasses import dataclass, field


def _env(name: str, fallback: str) -> str:
    return os.environ.get(name, fallback)


def _env_int(name: str, fallback: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return fallback
    try:
        return int(raw)
    except ValueError:
        return fallback


def _build_regex(name: str, fallback: str) -> re.Pattern[str]:
    raw = os.environ.get(name)
    return re.compile(raw) if raw else re.compile(fallback)


@dataclass
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8000
    max_body_size: int = 1_048_576  # 1 МБ


@dataclass
class TaigaCredentials:
    username: str = "username"
    password: str = "password"


@dataclass
class TaigaConfig:
    base_url: str = "http://localhost:9000/api/v1"
    credentials: TaigaCredentials = field(default_factory=TaigaCredentials)
    project_id: int = 2
    target_status_name: str = "Ready for test"


@dataclass
class GitLabConfig:
    match_user: str = "FRONT_SCRIPT,Андрей Епифанов"
    match_ref: str = "qa"
    match_status: str = "pending"
    task_pattern: re.Pattern[str] = field(default_factory=lambda: re.compile(r"TG-(\d+)"))


@dataclass
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    taiga: TaigaConfig = field(default_factory=TaigaConfig)
    gitlab: GitLabConfig = field(default_factory=GitLabConfig)


def load_config() -> Config:
    """Собирает конфигурацию из переменных окружения."""
    return Config(
        server=ServerConfig(
            host=_env("TG_SERVER_HOST", "0.0.0.0"),
            port=_env_int("TG_SERVER_PORT", 8000),
            max_body_size=_env_int("TG_SERVER_MAX_BODY_SIZE", 1_048_576),
        ),
        taiga=TaigaConfig(
            base_url=_env("TG_TAIGA_BASE_URL", "http://localhost:9000/api/v1"),
            credentials=TaigaCredentials(
                username=_env("TG_TAIGA_USERNAME", "username"),
                password=_env("TG_TAIGA_PASSWORD", "password"),
            ),
            project_id=_env_int("TG_TAIGA_PROJECT_ID", 2),
            target_status_name=_env("TG_TAIGA_TARGET_STATUS", "Ready for test"),
        ),
        gitlab=GitLabConfig(
            match_user=_env("TG_GITLAB_MATCH_USER", "FRONT_SCRIPT,Андрей Епифанов"),
            match_ref=_env("TG_GITLAB_MATCH_REF", "qa"),
            match_status=_env("TG_GITLAB_MATCH_STATUS", "pending"),
            task_pattern=_build_regex("TG_GITLAB_TASK_PATTERN", r"TG-(\d+)"),
        ),
    )


# Единственный экземпляр конфигурации (импортируется всеми модулями)
CONFIG = load_config()
