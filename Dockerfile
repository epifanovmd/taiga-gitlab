# =============================================================================
# Этап 1: Сборка зависимостей (builder)
# =============================================================================
FROM python:3.13-alpine AS builder

WORKDIR /app

# Копируем только requirements — используем кэш слоёв
COPY requirements.txt ./

# Создаём виртуальное окружение и устанавливаем зависимости
RUN python -m venv /venv && \
    /venv/bin/pip install --no-cache-dir -r requirements.txt

# =============================================================================
# Этап 2: Минимальный рантайм
# =============================================================================
FROM python:3.13-alpine

WORKDIR /app

ENV PYTHONUNBUFFERED=1

# Создаём непривилегированного пользователя
RUN addgroup -S app && adduser -S app -G app

# Переносим виртуальное окружение из builder
COPY --from=builder /venv /venv

# Переносим исходный код
COPY src/ ./src/

# Настраиваем PATH на виртуальное окружение
ENV PATH="/venv/bin:$PATH"

USER app

EXPOSE 8000

CMD ["python", "-m", "src"]
