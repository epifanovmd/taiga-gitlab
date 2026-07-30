/**
 * Фильтр входящих GitLab-событий.
 *
 * Чистая функция: принимает payload, возвращает PipelineMatchResult или null.
 * Каждый шаг проверки логирует результат — видно, на каком условии отсеялось.
 *
 * Условия срабатывания (из ТЗ):
 *   1. object_kind === 'pipeline'
 *   2. object_attributes.ref === 'qa'
 *   3. user.name === 'FRONT_SCRIPT'
 *   4. object_attributes.status === 'pending'
 *   5. commit.message.startsWith('Merge branch')
 *   6. commit.message содержит TG-(\d+)
 */

import { CONFIG } from './config.js';
import type { GitLabPipelineEvent, PipelineMatchResult } from './types.js';

/**
 * Проверяет, подходит ли входящий webhook-payload под наши критерии.
 *
 * @param payload — распарсенный JSON тела запроса.
 * @returns PipelineMatchResult если событие подходит, null — если нет.
 */
export const matchPipelineEvent = (
  payload: unknown,
): PipelineMatchResult | null => {
  // ── 1. Проверка структуры ──────────────────────────────────────────────

  if (!isPipelineEvent(payload)) {
    console.log('⏭️  Событие пропущено: не pipeline (или не хватает полей)');
    return null;
  }

  const { object_attributes: attrs, user, commit } = payload;

  // ── 2. Проверка условий фильтрации ──────────────────────────────────────

  if (attrs.ref !== CONFIG.gitlab.matchRef) {
    console.log(
      `⏭️  Пропущено: ref "${attrs.ref}" !== "${CONFIG.gitlab.matchRef}"`,
    );
    return null;
  }

  const allowedUsers = CONFIG.gitlab.matchUser.split(',').map((s) => s.trim());

  if (!allowedUsers.includes(user.name)) {
    console.log(`⏭️  Пропущено: user "${user.name}" !== "${allowedUsers.join(',')}"`);
    return null;
  }

  if (attrs.status !== CONFIG.gitlab.matchStatus) {
    console.log(
      `⏭️  Пропущено: status "${attrs.status}" !== "${CONFIG.gitlab.matchStatus}"`,
    );
    return null;
  }

  if (!commit.message.startsWith('Merge branch')) {
    console.log('⏭️  Пропущено: commit не является merge-коммитом');
    return null;
  }

  // ── 3. Событие подходит ────────────────────────────────────────────────

  const shortSha = commit.id ? commit.id.slice(0, 8) : 'unknown';
  console.log('');
  console.log('🎯 Найден целевой пайплайн!');
  console.log(`   ┌ Pipeline:  #${attrs.id}`);
  console.log(`   ├ Ref:       ${attrs.ref}`);
  console.log(`   ├ Status:    ${attrs.status}`);
  console.log(`   ├ User:      ${user.name}`);
  console.log(`   ├ Commit:    ${shortSha} — ${commit.title}`);
  console.log(`   └ URL:       ${attrs.url}`);

  // ── 4. Извлечение номера задачи ───────────────────────────────────────

  const match = commit.message.match(CONFIG.gitlab.taskPattern);

  if (!match) {
    console.log(
      '⚠️  TG-XXXX не найден в сообщении коммита — задача не будет обработана',
    );
    console.log(`   Сообщение: "${commit.message.replace(/\n/g, '\\n')}"`);
    return null;
  }

  const taskNumber = match[1];
  console.log(`🔢 Номер задачи из коммита: TG-${taskNumber}`);

  return {
    taskNumber,
    pipelineId: attrs.id,
    pipelineUrl: attrs.url,
  };
};

// -----------------------------------------------------------------------------
// Type guard
// -----------------------------------------------------------------------------

/**
 * Проверяет, что payload — это GitLabPipelineEvent с обязательными полями.
 * Использует структурную проверку, чтобы не упасть на неполных данных.
 */
const isPipelineEvent = (payload: unknown): payload is GitLabPipelineEvent => {
  if (!payload || typeof payload !== 'object') {
    console.log('⚠️  payload не является объектом');
    return false;
  }

  const p = payload as Record<string, unknown>;

  if (p.object_kind !== 'pipeline') {
    return false;
  }

  if (!isRecord(p.object_attributes)) {
    console.log('⚠️  object_attributes отсутствует или не объект');
    return false;
  }

  if (!isRecord(p.user)) {
    console.log('⚠️  user отсутствует или не объект');
    return false;
  }

  if (!isRecord(p.commit)) {
    console.log('⚠️  commit отсутствует или не объект');
    return false;
  }

  return true;
};

/** Проверка, что значение — не-null объект (Record). */
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
