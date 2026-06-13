import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');
const TELEGRAM_MAX_LENGTH = 4096;

export const BOT_REPLY_PARSE_MODE = 'HTML';

let cachedFormatting = null;

export function loadFormattingInstructions() {
  if (cachedFormatting !== null) {
    return cachedFormatting;
  }

  const path = resolve(promptsDir, 'formatting.txt');
  cachedFormatting = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
  return cachedFormatting;
}

function stripHtml(text) {
  return String(text).replace(/<[^>]+>/g, '');
}

function isParseModeError(err) {
  const message = `${err?.description ?? ''} ${err?.response?.description ?? ''} ${err?.message ?? ''}`;
  return /parse entities|can't parse|can't find end tag/i.test(message);
}

/** Отправка ответа бота с HTML; при ошибке разметки — plain text */
export async function replyFormatted(ctx, text, extra = undefined) {
  const options = {
    parse_mode: BOT_REPLY_PARSE_MODE,
    ...(extra ?? {}),
  };

  try {
    await ctx.reply(text, options);
  } catch (err) {
    if (!isParseModeError(err)) {
      throw err;
    }

    const { parse_mode: _ignored, ...plainOptions } = options;
    await ctx.reply(stripHtml(text), plainOptions);
  }
}

export function splitFormattedMessage(text) {
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    return [text];
  }

  const chunks = [];
  let rest = text;

  while (rest.length > TELEGRAM_MAX_LENGTH) {
    let cut = rest.lastIndexOf('\n\n', TELEGRAM_MAX_LENGTH);
    if (cut < TELEGRAM_MAX_LENGTH / 2) {
      cut = rest.lastIndexOf('\n', TELEGRAM_MAX_LENGTH);
    }
    if (cut < TELEGRAM_MAX_LENGTH / 2) {
      cut = TELEGRAM_MAX_LENGTH;
    }
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest) {
    chunks.push(rest);
  }

  return chunks;
}
