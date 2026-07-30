#!/usr/bin/env bash
# Деплой taiga-gitlab webhook на VPS.
# Использование: make deploy root@<ip>
set -euo pipefail

HOST="${1:?Использование: make deploy root@<ip>}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Проверяем наличие .env
if [ ! -f .env ]; then
  echo "❌ Файл .env не найден!"
  echo "   Скопируйте .env.example: cp .env.example .env"
  echo "   Затем заполните свои данные."
  exit 1
fi

echo "=== Синхронизация файлов на $HOST ==="
rsync -avz --delete \
  -e "ssh -o StrictHostKeyChecking=accept-new" \
  --exclude=.git \
  --exclude='*.log' \
  --exclude=.DS_Store \
  --exclude=node_modules \
  --exclude=dist \
  ./ "$HOST:~/development/taiga-gitlab/" >/dev/null 2>&1

# .env копируем отдельно (чтобы не светить в rsync-логах)
echo "=== Копирование .env ==="
scp -q -o StrictHostKeyChecking=accept-new .env "$HOST:~/development/taiga-gitlab/.env"

echo "=== Сборка и запуск на $HOST ==="
ssh "$HOST" \
  "cd ~/development/taiga-gitlab && \
   docker compose down 2>/dev/null; \
   docker compose up -d --build --remove-orphans" >&2

sleep 2

echo "=== Проверка ==="
ssh "$HOST" "docker compose -f ~/development/taiga-gitlab/docker-compose.yml ps"

PORT=$(grep -E '^TG_SERVER_PORT=' .env | cut -d= -f2)
PORT=${PORT:-8000}
echo ""
echo "✅ Деплой завершён: http://$HOST:$PORT/webhook"
