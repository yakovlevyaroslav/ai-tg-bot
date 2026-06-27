import './dns-ipv4-first.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { config } from './config.js';
import { BOT_REPLY_PARSE_MODE, splitFormattedMessage } from './telegram-format.js';
import {
  isLocalPhotoRef,
  resolveLocalPhotoPath,
} from './broadcast/media.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramToken}`;
const TIMEOUT_MS = Number(process.env.TELEGRAM_API_TIMEOUT_MS || 30000);

let cachedDispatcher = null;

function getDispatcher() {
  if (cachedDispatcher) {
    return cachedDispatcher;
  }

  const connect = { family: 4, timeout: TIMEOUT_MS };

  if (config.telegramApiProxy) {
    cachedDispatcher = new ProxyAgent({
      uri: config.telegramApiProxy,
      connect,
      bodyTimeout: TIMEOUT_MS,
      headersTimeout: TIMEOUT_MS,
    });
    console.log(
      `[telegram-api] using proxy: ${config.telegramApiProxy.replace(/\/\/[^@]+@/, '//***@')}`,
    );
  } else {
    cachedDispatcher = new Agent({
      connect,
      bodyTimeout: TIMEOUT_MS,
      headersTimeout: TIMEOUT_MS,
    });
  }

  return cachedDispatcher;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTelegramNetworkError(err) {
  const cause = err?.cause;
  const code = cause?.code || cause?.errno || err?.code;
  const via = config.telegramApiProxy ? ' (через прокси)' : '';

  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
    return `Таймаут подключения к api.telegram.org${via}. Проверьте VPN или задайте TELEGRAM_API_PROXY в .env`;
  }

  if (code === 'ENOTFOUND') {
    return `Не удалось разрешить api.telegram.org (${code})${via}`;
  }

  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    return `Нет связи с api.telegram.org (${code})${via}`;
  }

  return err?.message || 'fetch failed';
}

async function telegramFetch(url, init = {}) {
  try {
    return await undiciFetch(url, { ...init, dispatcher: getDispatcher() });
  } catch (err) {
    return { networkError: formatTelegramNetworkError(err) };
  }
}

async function callTelegramMultipart(method, fields, fileField, filePath) {
  const form = new FormData();
  const filename = path.basename(filePath);

  for (const [key, value] of Object.entries(fields)) {
    if (value != null && value !== '') {
      form.append(key, String(value));
    }
  }

  const buffer = await readFile(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.gif'
          ? 'image/gif'
          : 'image/jpeg';

  form.append(fileField, new Blob([buffer], { type: mime }), filename);

  const response = await telegramFetch(`${API_BASE}/${method}`, {
    method: 'POST',
    body: form,
  });

  if (response.networkError) {
    return { ok: false, description: response.networkError };
  }

  const data = await response.json().catch(() => ({}));

  if (data.ok) {
    return { ok: true, result: data.result };
  }

  return {
    ok: false,
    errorCode: data.error_code,
    description: data.description ?? response.statusText,
  };
}

function extractPhotoFileId(result) {
  const photos = result?.photo;
  if (!Array.isArray(photos) || !photos.length) {
    return null;
  }
  return photos[photos.length - 1]?.file_id ?? null;
}

function buildPhotoRequestFields(chatId, captionText, parseMode, replyMarkup, { stringifyMarkup = false } = {}) {
  const fields = { chat_id: chatId };

  if (captionText) {
    fields.caption = captionText.slice(0, 1024);
    fields.parse_mode = parseMode;
  }

  if (replyMarkup) {
    fields.reply_markup = stringifyMarkup ? JSON.stringify(replyMarkup) : replyMarkup;
  }

  return fields;
}

async function callTelegram(method, body, { retries = 2 } = {}) {
  let attempt = 0;

  while (attempt <= retries) {
    attempt += 1;

    const response = await telegramFetch(`${API_BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.networkError) {
      return { ok: false, description: response.networkError };
    }

    const data = await response.json().catch(() => ({}));

    if (data.ok) {
      return { ok: true, result: data.result };
    }

    const description = data.description ?? response.statusText;

    if (data.error_code === 429 && data.parameters?.retry_after) {
      await sleep(Number(data.parameters.retry_after) * 1000);
      continue;
    }

    if (attempt <= retries && response.status >= 500) {
      await sleep(500 * attempt);
      continue;
    }

    return { ok: false, errorCode: data.error_code, description };
  }

  return { ok: false, description: 'Telegram API unavailable' };
}

/** Строки кнопок: «Текст => https://url» или «Текст => callback:action», строки — ряды, «||» — кнопки в ряду */
export function parseBroadcastButtons(text) {
  const lines = String(text ?? '')
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  const inline_keyboard = lines
    .map((line) =>
      line
        .split('||')
        .map((part) => {
          const sep = part.includes('=>') ? '=>' : part.includes('|') ? '|' : null;
          if (!sep) {
            return null;
          }
          const [rawLabel, rawAction] = part.split(sep).map((item) => item.trim());
          if (!rawLabel || !rawAction) {
            return null;
          }

          if (/^https?:\/\//i.test(rawAction)) {
            return { text: rawLabel, url: rawAction };
          }

          const callbackData = rawAction.startsWith('callback:')
            ? rawAction.slice('callback:'.length)
            : rawAction;

          if (callbackData.startsWith('question:')) {
            const questionText = callbackData.slice('question:'.length).trim();
            if (!questionText) {
              return null;
            }
            return { text: rawLabel, callback_data: `question:${questionText}` };
          }

          if (callbackData.length > 64) {
            return null;
          }

          return { text: rawLabel, callback_data: callbackData };
        })
        .filter(Boolean),
    )
    .filter((row) => row.length);

  if (!inline_keyboard.length) {
    return null;
  }

  return { inline_keyboard };
}

export async function sendTelegramMessage({
  chatId,
  text,
  parseMode = BOT_REPLY_PARSE_MODE,
  replyMarkup = null,
}) {
  const chunks = splitFormattedMessage(String(text ?? ''));
  let lastResult = null;

  for (let i = 0; i < chunks.length; i += 1) {
    const isLast = i === chunks.length - 1;
    const payload = {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: parseMode,
      ...(isLast && replyMarkup ? { reply_markup: replyMarkup } : {}),
    };

    let result = await callTelegram('sendMessage', payload);

    if (!result.ok && parseMode) {
      result = await callTelegram('sendMessage', {
        chat_id: chatId,
        text: chunks[i].replace(/<[^>]+>/g, ''),
        ...(isLast && replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    }

    if (!result.ok) {
      return result;
    }

    lastResult = result;
  }

  return lastResult ?? { ok: true };
}

export async function sendTelegramPhoto({
  chatId,
  photoUrl = '',
  photoFileId = '',
  caption = '',
  parseMode = BOT_REPLY_PARSE_MODE,
  replyMarkup = null,
}) {
  const captionText = String(caption ?? '').trim();
  let result;

  if (photoFileId) {
    result = await callTelegram('sendPhoto', {
      ...buildPhotoRequestFields(chatId, captionText, parseMode, replyMarkup),
      photo: photoFileId,
    });
  } else if (isLocalPhotoRef(photoUrl)) {
    const filePath = resolveLocalPhotoPath(photoUrl);
    if (!filePath) {
      return { ok: false, description: 'Файл картинки не найден на сервере' };
    }

    result = await callTelegramMultipart(
      'sendPhoto',
      buildPhotoRequestFields(chatId, captionText, parseMode, replyMarkup, {
        stringifyMarkup: true,
      }),
      'photo',
      filePath,
    );
  } else {
    result = await callTelegram('sendPhoto', {
      ...buildPhotoRequestFields(chatId, captionText, parseMode, replyMarkup),
      photo: photoUrl,
    });
  }

  if (!result.ok && parseMode && captionText) {
    const plainCaption = captionText.slice(0, 1024).replace(/<[^>]+>/g, '');

    if (photoFileId) {
      result = await callTelegram('sendPhoto', {
        chat_id: chatId,
        photo: photoFileId,
        caption: plainCaption,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    } else if (isLocalPhotoRef(photoUrl)) {
      const filePath = resolveLocalPhotoPath(photoUrl);
      if (filePath) {
        result = await callTelegramMultipart(
          'sendPhoto',
          {
            chat_id: chatId,
            caption: plainCaption,
            ...(replyMarkup ? { reply_markup: JSON.stringify(replyMarkup) } : {}),
          },
          'photo',
          filePath,
        );
      }
    } else {
      result = await callTelegram('sendPhoto', {
        chat_id: chatId,
        photo: photoUrl,
        caption: plainCaption,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    }
  }

  if (!result.ok) {
    return result;
  }

  if (captionText.length > 1024) {
    const rest = await sendTelegramMessage({
      chatId,
      text: captionText.slice(1024),
      parseMode,
    });
    if (!rest.ok) {
      return rest;
    }
  }

  return { ...result, fileId: extractPhotoFileId(result.result) };
}

export async function cacheTelegramPhotoFileId(photoRef) {
  if (!isLocalPhotoRef(photoRef)) {
    return null;
  }

  const adminIds = config.adminTelegramIds.filter(Number.isFinite);
  if (!adminIds.length) {
    console.warn('[broadcast] cannot cache photo: ADMIN_TELEGRAM_IDS is empty');
    return null;
  }

  const result = await sendTelegramPhoto({
    chatId: adminIds[0],
    photoUrl: photoRef,
    caption: '\u200b',
  });

  return result.ok ? result.fileId ?? null : null;
}

export async function sendTelegramBroadcast({
  chatId,
  text,
  photoUrl = '',
  photoFileId = '',
  parseMode = BOT_REPLY_PARSE_MODE,
  replyMarkup = null,
}) {
  const photo = String(photoUrl ?? '').trim();

  if (photo || photoFileId) {
    return sendTelegramPhoto({
      chatId,
      photoUrl: photo,
      photoFileId,
      caption: text,
      parseMode,
      replyMarkup,
    });
  }

  return sendTelegramMessage({
    chatId,
    text,
    parseMode,
    replyMarkup,
  });
}
