/**
 * Точка входа (Composition Root).
 *
 * Собирает приложение вместе:
 *   1. Создаёт TaigaAPI
 *   2. Оборачивает его в TaigaService
 *   3. Создаёт HTTP-сервер с TaigaService
 *   4. Запускает сервер
 *   5. Регистрирует graceful shutdown
 */

import 'dotenv/config';
import { CONFIG } from './config.js';
import { TaigaAPI } from './taigaApi.js';
import { TaigaService } from './taigaService.js';
import { createWebhookServer } from './webhookServer.js';

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

const main = async (): Promise<void> => {
  // Сборка зависимостей
  const taigaApi = new TaigaAPI();
  const taigaService = new TaigaService(taigaApi);
  const server = createWebhookServer(taigaService);

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n⚠️  Получен ${signal}. Завершаем сервер...`);
    server.close(() => {
      console.log('👋 Сервер остановлен.');
      process.exit(0);
    });

    // Если сервер не закрылся за 10 секунд — форсируем
    setTimeout(() => {
      console.error('⏱️  Принудительное завершение (timeout).');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Запуск
  server.listen(CONFIG.server.port, CONFIG.server.host, () => {
    console.log(
      `🚀 Сервер слушает ${CONFIG.server.host}:${CONFIG.server.port} (эндпоинт: /webhook)`,
    );
    console.log(
      `📋 GitLab → Settings → Webhooks → URL: http://<IP>:${CONFIG.server.port}/webhook`,
    );
  });
};

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

main().catch((err) => {
  console.error('❌ Фатальная ошибка при запуске:', err);
  process.exit(1);
});
