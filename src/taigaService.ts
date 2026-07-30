/**
 * Сервис для выполнения бизнес-операций в Taiga.
 *
 * Координирует вызовы TaigaAPI в правильной последовательности:
 *   1. Аутентификация (если ещё не авторизованы)
 *   2. Поиск User Story по номеру задачи
 *   3. Получение списка статусов проекта
 *   4. Поиск нужного статуса ("Ready for test")
 *   5. Обновление статуса User Story с комментарием
 *
 * Каждый шаг логирует результат с контекстом задачи и пайплайна.
 */

import { CONFIG } from './config.js';
import { TaigaAPI } from './taigaApi.js';
import type { PipelineMatchResult } from './types.js';

export class TaigaService {
  constructor(private readonly api: TaigaAPI) {}

  /**
   * Обработать найденный пайплайн-матч: найти User Story в Taiga,
   * перевести её в статус "Ready for test" и прикрепить комментарий
   * со ссылкой на пайплайн.
   *
   * @param match — результат фильтрации события GitLab.
   * @throws {Error} если User Story или целевой статус не найдены.
   */
  async processPipelineMatch(match: PipelineMatchResult): Promise<void> {
    const { taskNumber, pipelineUrl, pipelineId } = match;

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 Начинаю обработку пайплайна в Taiga');
    console.log(`   Pipeline:  #${pipelineId}`);
    console.log(`   Задача:    TG-${taskNumber}`);
    console.log(`   Проект:    #${CONFIG.taiga.projectId}`);
    console.log('═══════════════════════════════════════════════════════════');

    const startTime = Date.now();

    try {
      // ── 1. Аутентификация ─────────────────────────────────────────────
      console.log('');
      console.log('🔑 Шаг 1/5 — Проверка авторизации в Taiga...');

      if (!this.api.accessToken) {
        console.log('   → Токен отсутствует, выполняю login...');
        await this.api.login();
      } else {
        console.log('   → Уже авторизован (токен есть)');
      }

      // ── 2. Поиск User Story ──────────────────────────────────────────
      console.log('');
      console.log(
        `🔍 Шаг 2/5 — Поиск User Story по номеру TG-${taskNumber}...`,
      );

      const userStory = await this.api.findUserStory(
        Number(taskNumber),
        CONFIG.taiga.projectId,
      );

      console.log(`   ✅ Найдено: #${userStory.ref} "${userStory.subject}"`);
      console.log(`   📍 Текущий статус ID: ${userStory.status}`);

      // ── 3. Получение статусов проекта ────────────────────────────────
      console.log('');
      console.log('📋 Шаг 3/5 — Загрузка доступных статусов проекта...');

      const statuses = await this.api.getProjectStatuses(
        CONFIG.taiga.projectId,
      );

      console.log(`   → Всего статусов: ${statuses.length}`);
      statuses.forEach((s) => {
        const marker =
          s.name === CONFIG.taiga.targetStatusName ? ' ← ЦЕЛЕВОЙ' : '';
        console.log(`     • #${s.id} — "${s.name}"${marker}`);
      });

      // ── 4. Поиск целевого статуса ────────────────────────────────────
      console.log('');
      console.log(
        `🎯 Шаг 4/5 — Поиск статуса "${CONFIG.taiga.targetStatusName}"...`,
      );

      const targetStatus = statuses.find(
        (s) => s.name === CONFIG.taiga.targetStatusName,
      );

      if (!targetStatus) {
        throw new Error(
          `Статус "${CONFIG.taiga.targetStatusName}" не найден в проекте ${CONFIG.taiga.projectId}`,
        );
      }

      console.log(`   ✅ Найден: #${targetStatus.id} — "${targetStatus.name}"`);

      // ── 5. Обновление статуса + комментарий ─────────────────────────
      console.log('');
      console.log('✏️  Шаг 5/5 — Обновление статуса User Story...');

      const comment = `✅ Пайплайн: ${pipelineUrl}`;

      console.log(
        `   → Новый статус: #${targetStatus.id} — "${targetStatus.name}"`,
      );
      console.log(`   → Комментарий: ${comment}`);
      console.log(`   → Версия US:   ${userStory.version}`);

      await this.api.updateUserStory(
        userStory.id,
        targetStatus.id,
        userStory.version,
        comment,
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log('');
      console.log(
        '═══════════════════════════════════════════════════════════',
      );
      console.log(
        `✅ УСПЕХ! User Story #${userStory.ref} обработана (${elapsed}с)`,
      );
      console.log(`   📌 Статус:    ${targetStatus.name}`);
      console.log(`   🔗 Pipeline:  ${pipelineUrl}`);
      console.log(
        '═══════════════════════════════════════════════════════════',
      );

      // ── Текущий статус User Story после обновления (если нужно) ────
      if (userStory.status === targetStatus.id) {
        console.log('   ⚠️  User Story уже была в целевом статусе');
      }
    } catch (cause) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const message = cause instanceof Error ? cause.message : String(cause);

      console.log('');
      console.log(
        '═══════════════════════════════════════════════════════════',
      );
      console.log(`❌ ОШИБКА! (${elapsed}с)`);
      console.log(`   Pipeline: #${pipelineId}`);
      console.log(`   Задача:   TG-${taskNumber}`);
      console.log(`   Причина:  ${message}`);
      console.log(
        '═══════════════════════════════════════════════════════════',
      );

      throw new Error(`Ошибка обработки задачи #${taskNumber}: ${message}`, {
        cause,
      });
    }
  }
}
