/**
 * Конфигурация приложения.
 *
 * Все параметры читаются из переменных окружения (с префиксом TG_).
 * Если переменная не задана — используется значение по умолчанию.
 */

const env = (name: string, fallback: string): string =>
  process.env[name] ?? fallback;

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
};

export const CONFIG = {
  /** Настройки HTTP-сервера */
  server: {
    host: env('TG_SERVER_HOST', '0.0.0.0'),
    port: envInt('TG_SERVER_PORT', 8000),
    /** Максимальный размер тела запроса в байтах (1 МБ) */
    maxBodySize: envInt('TG_SERVER_MAX_BODY_SIZE', 1_048_576),
  },

  /** Настройки подключения к Taiga */
  taiga: {
    baseUrl: env('TG_TAIGA_BASE_URL', 'http://localhost:9000/api/v1'),
    credentials: {
      username: env('TG_TAIGA_USERNAME', 'username'),
      password: env('TG_TAIGA_PASSWORD', 'password'),
    },
    /** ID проекта Taiga, в котором ищем User Story */
    projectId: envInt('TG_TAIGA_PROJECT_ID', 2),
    /** Название статуса, в который переводить задачу */
    targetStatusName: env('TG_TAIGA_TARGET_STATUS', 'Ready for test'),
  },

  /** Условия фильтрации GitLab-событий */
  gitlab: {
    /** Имя пользователя, от которого приходят merge-коммиты */
    matchUser: env('TG_GITLAB_MATCH_USER', 'FRONT_SCRIPT,Андрей Епифанов'),
    /** Ветка, на которую делается merge */
    matchRef: env('TG_GITLAB_MATCH_REF', 'qa'),
    /** Статус пайплайна при создании */
    matchStatus: env('TG_GITLAB_MATCH_STATUS', 'pending'),
    /** Регулярное выражение для поиска номера задачи в коммите */
    taskPattern: (() => {
      const raw = process.env['TG_GITLAB_TASK_PATTERN'];
      return raw ? new RegExp(raw) : /TG-(\d+)/;
    })(),
  },
};
