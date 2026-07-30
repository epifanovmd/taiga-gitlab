/**
 * HTTP-клиент для Taiga API.
 *
 * Отвечает исключительно за транспортный уровень:
 *   - авторизация / refresh токена
 *   - выполнение HTTP-запросов
 *   - автоматическая обработка 401 (retry с обновлением токена)
 *   - очередь запросов во время обновления токена
 *
 * Не содержит бизнес-логики — этим занимается TaigaService.
 */

import { CONFIG } from './config.js';
import type {
  TaigaAuthResponse,
  TaigaRefreshResponse,
  TaigaUserStory,
  TaigaStatus,
} from './types.js';

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/** Внутренний тип опций — body может быть любым, сериализуем сами. */
type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

interface QueuedRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  endpoint: string;
  options: ApiRequestOptions;
}

// -----------------------------------------------------------------------------
// TaigaAPI
// -----------------------------------------------------------------------------

export class TaigaAPI {
  /** Текущий access-токен. Публичное поле — для проверки авторизованы ли мы. */
  accessToken: string | null = null;

  private refreshToken: string | null = null;
  private isRefreshing = false;
  private requestQueue: QueuedRequest[] = [];

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Авторизация в Taiga (type = normal).
   * Вызывается автоматически при первом запросе, если токена нет.
   */
  async login(): Promise<TaigaAuthResponse> {
    console.log('🔑 Авторизация в Taiga...');

    const response = await fetch(`${CONFIG.taiga.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'normal',
        username: CONFIG.taiga.credentials.username,
        password: CONFIG.taiga.credentials.password,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ошибка авторизации: ${response.status}`);
    }

    const data = (await response.json()) as TaigaAuthResponse;
    this.accessToken = data.auth_token;
    this.refreshToken = data.refresh_token;

    console.log('✅ Авторизация успешна');
    return data;
  }

  /** Поиск User Story по номеру задачи (ref) в указанном проекте. */
  async findUserStory(ref: number, projectId: number): Promise<TaigaUserStory> {
    console.log(`   → GET /userstories/by_ref?ref=${ref}&project=${projectId}`);

    const data = await this.request<TaigaUserStory>(
      `/userstories/by_ref?ref=${ref}&project=${projectId}`,
    );

    if (!data?.id) {
      throw new Error(`User Story #${ref} не найдена в проекте ${projectId}`);
    }

    return data;
  }

  /** Получение списка статусов проекта. */
  async getProjectStatuses(projectId: number): Promise<TaigaStatus[]> {
    console.log(`   → GET /userstory-statuses?project=${projectId}`);

    const data = await this.request<TaigaStatus[]>(
      `/userstory-statuses?project=${projectId}`,
    );

    console.log(`   ✅ Получено ${data.length} статусов`);
    return data;
  }

  /** Обновление статуса User Story (опционально — с комментарием). */
  async updateUserStory(
    userStoryId: number,
    statusId: number,
    version: number,
    comment?: string,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      status: statusId,
      version,
    };

    if (comment) {
      body.comment = comment;
    }

    console.log(
      `   → PATCH /userstories/${userStoryId} (status=${statusId}, version=${version})`,
    );

    const result = await this.request<Record<string, unknown>>(`/userstories/${userStoryId}`, {
      method: 'PATCH',
      body,
    });

    console.log(`   ✅ Статус обновлён`);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private: transport layer
  // ---------------------------------------------------------------------------

  /**
   * Базовый метод для выполнения HTTP-запроса к Taiga API.
   * - Добавляет Authorization header при наличии токена.
   * - Автоматически обрабатывает 401 (попытка refresh и retry).
   * - Парсит JSON-ответ, проверяет _error_message.
   */
  private async request<T>(
    endpoint: string,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    const url = `${CONFIG.taiga.baseUrl}${endpoint}`;

    // Формируем заголовки
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    // Подготавливаем конфиг запроса
    const config: RequestInit = {
      ...options,
      headers,
      body: options.body != null ? JSON.stringify(options.body) : undefined,
    };

    // Выполняем запрос
    const response = await fetch(url, config);

    // 401 → пытаемся обновить токен и повторить
    if (response.status === 401) {
      return this.handleUnauthorized<T>(endpoint, options);
    }

    // Читаем тело ответа (может быть пустым — 204 No Content)
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    const data = JSON.parse(text) as Record<string, unknown>;

    if (typeof data._error_message === 'string') {
      throw new Error(data._error_message);
    }

    return data as unknown as T;
  }

  /**
   * Обработка 401.
   *
   * Если refresh уже запущен — встаём в очередь.
   * Иначе — обновляем токен, дожидаемся очереди, ретраим текущий запрос.
   * Если refresh не удался — пробуем авторизоваться заново.
   */
  private async handleUnauthorized<T>(
    endpoint: string,
    options: ApiRequestOptions,
  ): Promise<T> {
    // Если refresh уже идёт — паркуем запрос в очередь
    if (this.isRefreshing) {
      return new Promise<T>((resolve, reject) => {
        this.requestQueue.push({
          resolve: resolve as (value: unknown) => void,
          reject,
          endpoint,
          options,
        });
      });
    }

    this.isRefreshing = true;

    try {
      await this.refreshAccessToken();

      // Снимаем очередь (пока isRefreshing ещё true → новые 401 не запустят
      // повторный refresh)
      const pending = [...this.requestQueue];
      this.requestQueue = [];

      for (const item of pending) {
        this.request<T>(item.endpoint, item.options)
          .then(item.resolve)
          .catch(item.reject);
      }

      this.isRefreshing = false;

      // Ретраим исходный запрос
      return this.request<T>(endpoint, options);
    } catch (error) {
      console.warn(
        `[${error instanceof Error ? error.message : String(error)}] ` +
          `Не удалось обновить токен, пробуем авторизоваться заново...`,
      );

      const pending = [...this.requestQueue];
      this.requestQueue = [];
      this.isRefreshing = false;

      // Пробуем залогиниться с кредами
      await this.login();

      // Ретраим всё, что лежало в очереди
      for (const item of pending) {
        this.request<T>(item.endpoint, item.options)
          .then(item.resolve)
          .catch(item.reject);
      }

      // Ретраим исходный запрос
      return this.request<T>(endpoint, options);
    }
  }

  /**
   * Обновление access-токена через refresh-токен.
   */
  private async refreshAccessToken(): Promise<TaigaRefreshResponse> {
    if (!this.refreshToken) {
      throw new Error('Нет refresh токена');
    }

    console.log('🔄 Обновление токена...');

    const response = await fetch(`${CONFIG.taiga.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: this.refreshToken }),
    });

    if (!response.ok) {
      throw new Error(`Ошибка обновления токена: ${response.status}`);
    }

    const data = (await response.json()) as TaigaRefreshResponse;
    this.accessToken = data.auth_token;

    console.log('🔄 Токен обновлен');
    return data;
  }
}
