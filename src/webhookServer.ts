/**
 * HTTP-сервер для приёма webhook'ов от GitLab.
 *
 * Единственная ответственность: слушать порт, парсить входящие POST-запросы
 * на /webhook, передавать payload в filter/service и всегда отвечать 200.
 *
 * Особенности:
 *   - Работает на чистом Node.js http — без фреймворков, без внешних
 *     зависимостей в runtime.
 *   - Каждый запрос обрабатывается изолированно; ошибки в одном не влияют
 *     на другие.
 *   - Ответ 200 возвращается сразу, обработка Taiga — в фоне.
 *   - Graceful shutdown по SIGINT/SIGTERM.
 */

import http from 'node:http';
import { CONFIG } from './config.js';
import { matchPipelineEvent } from './pipelineFilter.js';
import { TaigaService } from './taigaService.js';

// -----------------------------------------------------------------------------
// Server factory
// -----------------------------------------------------------------------------

export const createWebhookServer = (
  taigaService: TaigaService,
): http.Server => {
  const server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      handleRequest(req, res, taigaService);
    },
  );

  return server;
};

// -----------------------------------------------------------------------------
// Request handler
// -----------------------------------------------------------------------------

const handleRequest = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taigaService: TaigaService,
): Promise<void> => {
  // Принимаем только POST /webhook
  if (req.method !== 'POST' || req.url !== '/webhook') {
    console.log(
      `⏭️  ${req.method} ${req.url} — игнорирую (только POST /webhook)`,
    );
    res.writeHead(404).end('Not Found');
    return;
  }

  const eventType = req.headers['x-gitlab-event'] ?? 'Unknown Event';
  const remoteAddr = req.socket.remoteAddress ?? 'unknown';

  try {
    // 1. Читаем тело запроса
    const rawBody = await collectBody(req, CONFIG.server.maxBodySize);

    if (!rawBody) {
      console.log('⚠️  Пустое тело запроса');
      sendJson(res, 400, { status: 'error', message: 'Empty body' });
      return;
    }

    const payloadSizeKb = (Buffer.byteLength(rawBody) / 1024).toFixed(1);

    // 2. Парсим JSON
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.log('⚠️  Тело запроса не является валидным JSON');
      sendJson(res, 400, { status: 'error', message: 'Invalid JSON' });
      return;
    }

    // 3. Логируем входящее событие
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log(`║ 📨 Входящий webhook`);
    console.log(`║    Тип:     ${eventType}`);
    console.log(`║    От:      ${remoteAddr}`);
    console.log(`║    Размер:  ${payloadSizeKb} KB`);
    console.log('╚══════════════════════════════════════════════════════════╝');

    // 4. Пытаемся сопоставить событие с критериями
    const match = matchPipelineEvent(payload);

    if (match) {
      console.log('');
      console.log('⚡ Событие подходит — запускаю обработку в Taiga...');

      // Обработка Taiga — в фоне, не блокируем ответ GitLab.
      // GitLab получит 200 сразу, а мы доделаем в тишине (или с ошибкой).
      taigaService.processPipelineMatch(match).catch((err: Error) => {
        console.error('❌ Ошибка обработки пайплайна:', err.message);
      });
    } else {
      console.log('💤 Событие не прошло фильтр — ответ 200 без действий');
    }

    // 5. Всегда отвечаем 200 — GitLab не должен переотправлять
    sendJson(res, 200, { status: 'ok' });
  } catch (err) {
    console.error('❌ Ошибка при обработке запроса:', err);
    sendJson(res, 500, { status: 'error', message: 'Internal server error' });
  }
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Собирает тело HTTP-запроса как строку.
 * Защита от больших тел: при превышении maxBytes закрываем соединение.
 */
const collectBody = (
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;

    req.on('data', (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > maxBytes) {
        // Превышение лимита — уничтожаем соединение
        req.destroy(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
};

/** Отправляет JSON-ответ. */
const sendJson = (
  res: http.ServerResponse,
  statusCode: number,
  data: Record<string, unknown>,
): void => {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};
