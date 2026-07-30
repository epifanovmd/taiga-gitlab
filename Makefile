HOST := $(word 2,$(MAKECMDGOALS))
$(eval $(HOST):;@:)

# ── Загружаем .env, если есть ──────────────────────────────────────────────
-include .env
export

.PHONY: build up down logs ps deploy dev start lint lint-fix format format-fix clean-env clean help

# --- Docker ---
build:
	docker compose build

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

# --- Деплой на VPS ---
deploy:
	@test -n "$(HOST)" || { echo "Использование: make deploy root@<ip>"; exit 1; }
	@bash scripts/deploy.sh $(HOST)

# --- Локально (env подхватывается через -include .env + export) ---
dev:
	python -m src

start:
	python -m src

# --- Контроль качества ---
lint:
	@command -v ruff >/dev/null 2>&1 || { echo "Установите ruff: pip install ruff"; exit 1; }
	ruff check src/

lint-fix:
	@command -v ruff >/dev/null 2>&1 || { echo "Установите ruff: pip install ruff"; exit 1; }
	ruff check src/ --fix

format:
	@command -v ruff >/dev/null 2>&1 || { echo "Установите ruff: pip install ruff"; exit 1; }
	ruff format src/ --check

format-fix:
	@command -v ruff >/dev/null 2>&1 || { echo "Установите ruff: pip install ruff"; exit 1; }
	ruff format src/

# --- Очистка ---
clean-env:
	@rm -f .env
	@echo "🗑️  .env удалён. Скопируйте .env.example заново: cp .env.example .env"

clean:
	docker compose down -v 2>/dev/null; true
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true
	rm -rf .venv/ 2>/dev/null; true

# --- Справка ---
help:
	@echo "Доступные команды:"
	@echo ""
	@echo "  Docker:"
	@echo "    make build          Собрать образ"
	@echo "    make up             Запустить контейнер"
	@echo "    make down           Остановить контейнер"
	@echo "    make logs           Логи контейнера"
	@echo "    make ps             Статус контейнера"
	@echo ""
	@echo "  Деплой:"
	@echo "    make deploy <host>  Залить и запустить на VPS"
	@echo ""
	@echo "  Локально:"
	@echo "    make dev            Запустить"
	@echo "    make start          Запустить"
	@echo ""
	@echo "  Качество (требуется ruff):"
	@echo "    make lint           Проверить lint"
	@echo "    make format         Проверить форматирование"
	@echo "    make lint-fix       Исправить lint-ошибки"
	@echo "    make format-fix     Отформатировать код"
	@echo ""
	@echo "  Обслуживание:"
	@echo "    make clean          Очистить всё"
	@echo "    make clean-env      Удалить .env"
