import './dns-ipv4-first.js';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { config } from './config.js';
import { BOT_REPLY_PARSE_MODE, splitFormattedMessage } from './telegram-format.js';
import {
  detectBroadcastMediaKind,
  getMediaContentType,
  isLocalPhotoRef,
  resolveLocalPhotoPath,
} from './broadcast/media.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramToken}`;
const TIMEOUT_MS = Number(process.env.TELEGRAM_API_TIMEOUT_MS || 30000);
const MULTIPART_TIMEOUT_MS = Number(process.env.TELEGRAM_MEDIA_UPLOAD_TIMEOUT_MS || 600000);

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
    return await undiciFetch(url, {
      ...init,
      dispatcher: init.dispatcher ?? getDispatcher(),
    });
  } catch (err) {
    return { networkError: formatTelegramNetworkError(err) };
  }
}

async function fileToBlob(filePath, mime) {
  if (typeof fs.openAsBlob === 'function') {
    try {
      return await fs.openAsBlob(filePath, { type: mime });
    } catch {
      // fallback below
    }
  }
  const buffer = await readFile(filePath);
  return new Blob([buffer], { type: mime });
}

async function callTelegramMultipart(method, fields, fileField, filePath) {
  const form = new FormData();
  const filename = path.basename(filePath);
  const mime = getMediaContentType(filename);

  for (const [key, value] of Object.entries(fields)) {
    if (value != null && value !== '') {
      form.append(key, String(value));
    }
  }

  const blob = await fileToBlob(filePath, mime);
  form.append(fileField, blob, filename);

  const response = await telegramFetch(`${API_BASE}/${method}`, {
    method: 'POST',
    body: form,
    dispatcher: (() => {
      const connect = { family: 4, timeout: MULTIPART_TIMEOUT_MS };
      if (config.telegramApiProxy) {
        return new ProxyAgent({
          uri: config.telegramApiProxy,
          connect,
          bodyTimeout: MULTIPART_TIMEOUT_MS,
          headersTimeout: MULTIPART_TIMEOUT_MS,
        });
      }
      return new Agent({
        connect,
        bodyTimeout: MULTIPART_TIMEOUT_MS,
        headersTimeout: MULTIPART_TIMEOUT_MS,
      });
    })(),
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

function extractVideoFileId(result) {
  return result?.video?.file_id ?? null;
}

function buildMediaCaptionFields(chatId, captionText, parseMode, replyMarkup, { stringifyMarkup = false } = {}) {
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

async function sendTelegramMediaMessage({
  chatId,
  mediaUrl = '',
  mediaFileId = '',
  mediaKind = 'photo',
  caption = '',
  parseMode = BOT_REPLY_PARSE_MODE,
  replyMarkup = null,
}) {
  const captionText = String(caption ?? '').trim();
  const isVideo = mediaKind === 'video';
  const method = isVideo ? 'sendVideo' : 'sendPhoto';
  const field = isVideo ? 'video' : 'photo';
  const missingLocal = isVideo
    ? 'Файл видео не найден на сервере (local:…). При двух VPS медиа нужно кэшировать в file_id на сайте при создании рассылки.'
    : 'Файл картинки не найден на сервере (local:…). При двух VPS медиа нужно кэшировать в file_id на сайте при создании рассылки.';
  let result;

  if (mediaFileId) {
    result = await callTelegram(method, {
      ...buildMediaCaptionFields(chatId, captionText, parseMode, replyMarkup),
      [field]: mediaFileId,
    });
  } else if (isLocalPhotoRef(mediaUrl)) {
    const filePath = resolveLocalPhotoPath(mediaUrl);
    if (!filePath) {
      return { ok: false, description: missingLocal };
    }

    result = await callTelegramMultipart(
      method,
      buildMediaCaptionFields(chatId, captionText, parseMode, replyMarkup, {
        stringifyMarkup: true,
      }),
      field,
      filePath,
    );
  } else {
    result = await callTelegram(method, {
      ...buildMediaCaptionFields(chatId, captionText, parseMode, replyMarkup),
      [field]: mediaUrl,
    });
  }

  if (!result.ok && parseMode && captionText) {
    const plainCaption = captionText.slice(0, 1024).replace(/<[^>]+>/g, '');

    if (mediaFileId) {
      result = await callTelegram(method, {
        chat_id: chatId,
        [field]: mediaFileId,
        caption: plainCaption,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    } else if (isLocalPhotoRef(mediaUrl)) {
      const filePath = resolveLocalPhotoPath(mediaUrl);
      if (filePath) {
        result = await callTelegramMultipart(
          method,
          {
            chat_id: chatId,
            caption: plainCaption,
            ...(replyMarkup ? { reply_markup: JSON.stringify(replyMarkup) } : {}),
          },
          field,
          filePath,
        );
      }
    } else {
      result = await callTelegram(method, {
        chat_id: chatId,
        [field]: mediaUrl,
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

  return {
    ...result,
    fileId: isVideo
      ? extractVideoFileId(result.result)
      : extractPhotoFileId(result.result),
  };
}

export async function sendTelegramPhoto({
  chatId,
  photoUrl = '',
  photoFileId = '',
  caption = '',
  parseMode = BOT_REPLY_PARSE_MODE,
  replyMarkup = null,
}) {
  return sendTelegramMediaMessage({
    chatId,
    mediaUrl: photoUrl,
    mediaFileId: photoFileId,
    mediaKind: 'photo',
    caption,
    parseMode,
    replyMarkup,
  });
}

export async function sendTelegramVideo({
  chatId,
  videoUrl = '',
  videoFileId = '',
  caption = '',
  parseMode = BOT_REPLY_PARSE_MODE,
  replyMarkup = null,
}) {
  return sendTelegramMediaMessage({
    chatId,
    mediaUrl: videoUrl,
    mediaFileId: videoFileId,
    mediaKind: 'video',
    caption,
    parseMode,
    replyMarkup,
  });
}

/**
 * Загружает локальный файл (local:…) в Telegram и возвращает file_id.
 * Нужно на сервере сайта: файл лежит в data/broadcast-media, а воркер бота
 * на другом VPS этого файла не видит — отправка идёт по file_id.
 */
export async function cacheBroadcastMediaFileId(mediaRef) {
  if (!isLocalPhotoRef(mediaRef)) {
    return { ok: false, fileId: null, description: 'Не локальный файл' };
  }

  if (!resolveLocalPhotoPath(mediaRef)) {
    return {
      ok: false,
      fileId: null,
      description: 'Файл медиа не найден на сервере сайта (data/broadcast-media)',
    };
  }

  const adminIds = config.adminTelegramIds.filter(Number.isFinite);
  if (!adminIds.length) {
    return {
      ok: false,
      fileId: null,
      description: 'Задайте ADMIN_TELEGRAM_IDS — нужен чат для подготовки медиа',
    };
  }

  const mediaKind = detectBroadcastMediaKind(mediaRef);
  const result = await sendTelegramMediaMessage({
    chatId: adminIds[0],
    mediaUrl: mediaRef,
    mediaKind,
    caption: '\u200b',
  });

  if (!result.ok) {
    return {
      ok: false,
      fileId: null,
      description: result.description ?? 'Не удалось загрузить медиа в Telegram',
    };
  }

  if (!result.fileId) {
    return {
      ok: false,
      fileId: null,
      description: 'Telegram не вернул file_id для медиа',
    };
  }

  return { ok: true, fileId: result.fileId, description: null };
}

/** @deprecated используйте cacheBroadcastMediaFileId */
export async function cacheTelegramPhotoFileId(photoRef) {
  const result = await cacheBroadcastMediaFileId(photoRef);
  return result.ok ? result.fileId : null;
}

export async function sendTelegramBroadcast({
  chatId,
  text,
  photoUrl = '',
  photoFileId = '',
  parseMode = BOT_REPLY_PARSE_MODE,
  replyMarkup = null,
}) {
  const media = String(photoUrl ?? '').trim();
  const fileId = String(photoFileId ?? '').trim();

  if (media || fileId) {
    // Тип всегда по URL/пути (расширение); file_id расширения не имеет.
    const mediaKind = detectBroadcastMediaKind(media);
    return sendTelegramMediaMessage({
      chatId,
      mediaUrl: media,
      mediaFileId: fileId,
      mediaKind,
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
