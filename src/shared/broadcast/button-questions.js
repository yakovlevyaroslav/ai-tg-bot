import { getPool } from '../db.js';
import { parseBroadcastButtons } from '../telegram-api.js';

const QUESTION_CALLBACK_PREFIX = 'question:';
export const BROADCAST_QUESTION_CALLBACK_PREFIX = 'bcq:';

export async function insertBroadcastButtonQuestion(questionText) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO broadcast_button_questions (question_text)
     VALUES ($1)
     RETURNING id`,
    [questionText],
  );
  return rows[0].id;
}

export async function getBroadcastButtonQuestion(id) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT question_text FROM broadcast_button_questions WHERE id = $1`,
    [id],
  );
  return rows[0]?.question_text ?? null;
}

function isQuestionCallback(callbackData) {
  return callbackData.startsWith(QUESTION_CALLBACK_PREFIX);
}

/** Подставляет bcq:{id} вместо question:… — текст вопроса хранится в БД (лимит Telegram 64 байта). */
export async function resolveBroadcastButtons(text) {
  const parsed = parseBroadcastButtons(text);
  if (!parsed?.inline_keyboard?.length) {
    return null;
  }

  const inline_keyboard = [];

  for (const row of parsed.inline_keyboard) {
    const resolvedRow = [];

    for (const button of row) {
      if (!button.callback_data) {
        resolvedRow.push(button);
        continue;
      }

      if (!isQuestionCallback(button.callback_data)) {
        resolvedRow.push(button);
        continue;
      }

      const questionText = button.callback_data.slice(QUESTION_CALLBACK_PREFIX.length).trim();
      if (!questionText) {
        continue;
      }

      const id = await insertBroadcastButtonQuestion(questionText);
      resolvedRow.push({
        text: button.text,
        callback_data: `${BROADCAST_QUESTION_CALLBACK_PREFIX}${id}`,
      });
    }

    if (resolvedRow.length) {
      inline_keyboard.push(resolvedRow);
    }
  }

  return inline_keyboard.length ? { inline_keyboard } : null;
}
