HOST := $(word 2,$(MAKECMDGOALS))
$(eval $(HOST):;@:)

# ── Загружаем .env, если есть ──────────────────────────────────────────────
-include .env
export

.PHONY: build up down logs ps deploy dev start lint lint-fix format format-fix typecheck build-ts clean-env clean help

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
	npx tsx watch src/index.ts

start:
	npx tsx src/index.ts

# --- Контроль качества ---
lint:
	npx eslint src/

lint-fix:
	npx eslint src/ --fix

format:
	npx prettier --check src/

format-fix:
	npx prettier --write src/

typecheck:
	npx tsc --noEmit

build-ts:
	npx tsc

# --- Очистка ---
clean-env:
	@rm -f .env
	@echo "🗑️  .env удалён. Скопируйте .env.example заново: cp .env.example .env"

clean:
	docker compose down -v 2>/dev/null; true
	rm -rf dist/ node_modules/ 2>/dev/null; true

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
	@echo "    make dev            Запустить с hot-reload"
	@echo "    make start          Запустить"
	@echo ""
	@echo "  Качество:"
	@echo "    make lint           Проверить ESLint"
	@echo "    make format         Проверить Prettier"
	@echo "    make typecheck      Проверить TypeScript"
	@echo "    make build-ts       Собрать JS"
	@echo ""
	@echo "  Обслуживание:"
	@echo "    make clean          Очистить всё"
	@echo "    make clean-env      Удалить .env"
