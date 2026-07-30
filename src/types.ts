// =============================================================================
// GitLab Webhook Payload
// =============================================================================

/** GitLab-событие пайплайна (объект со всеми полями, что нас интересуют) */
export interface GitLabPipelineEvent {
  object_kind: string;
  object_attributes: {
    id: number;
    ref: string;
    status: string;
    url: string;
    [key: string]: unknown;
  };
  user: {
    name: string;
    [key: string]: unknown;
  };
  commit: {
    id: string;
    message: string;
    title: string;
    [key: string]: unknown;
  };
  project: {
    id: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// =============================================================================
// Pipeline Match Result
// =============================================================================

/** Результат успешного сопоставления события GitLab с нашими критериями */
export interface PipelineMatchResult {
  /** Номер задачи из коммита (например, "4545" из "TG-4545") */
  taskNumber: string;
  /** ID пайплайна GitLab */
  pipelineId: number;
  /** Ссылка на пайплайн в GitLab */
  pipelineUrl: string;
}

// =============================================================================
// Taiga API Responses
// =============================================================================

/** Ответ на запрос авторизации */
export interface TaigaAuthResponse {
  auth_token: string;
  refresh_token: string;
}

/** Ответ на запрос обновления токена */
export interface TaigaRefreshResponse {
  auth_token: string;
}

/** Объект User Story из Taiga */
export interface TaigaUserStory {
  id: number;
  ref: number;
  subject: string;
  version: number;
  status: number;
  [key: string]: unknown;
}

/** Статус User Story (колонка на доске) */
export interface TaigaStatus {
  id: number;
  name: string;
  project: number;
  [key: string]: unknown;
}
