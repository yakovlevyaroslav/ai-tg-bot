import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Markup } from 'telegraf';
import { config } from './config.js';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '../prompts/specialists');

export const SPECIALISTS = {
  tarolog: {
    id: 'tarolog',
    title: 'Таролог',
    button: '🔮 Таролог',
    description: 'Символический расклад и образы карт для вашей ситуации.',
  },
  numerolog: {
    id: 'numerolog',
    title: 'Нумеролог',
    button: '🔢 Нумеролог',
    description: 'Числа судьбы, даты рождения и циклы.',
  },
  rodolog: {
    id: 'rodolog',
    title: 'Родолог',
    button: '🌳 Родолог',
    description: 'Родовые сценарии, семья и связь поколений.',
  },
};

const promptCache = new Map();

function loadPromptFile(specialistId) {
  if (promptCache.has(specialistId)) {
    return promptCache.get(specialistId);
  }

  const path = resolve(promptsDir, `${specialistId}.txt`);
  if (!existsSync(path)) {
    throw new Error(`Prompt file not found: ${path}`);
  }

  const text = readFileSync(path, 'utf8').trim();
  promptCache.set(specialistId, text);
  return text;
}

export function getSpecialist(id) {
  return SPECIALISTS[id] ?? null;
}

export function getSpecialistPrompt(specialistId) {
  const specialist = getSpecialist(specialistId);
  if (!specialist) {
    return config.systemPrompt;
  }

  try {
    return loadPromptFile(specialistId);
  } catch {
    return config.systemPrompt;
  }
}

export function isValidSpecialist(id) {
  return Boolean(SPECIALISTS[id]);
}

export function specialistPickerKeyboard() {
  const rows = Object.values(SPECIALISTS).map((s) => [
    Markup.button.callback(s.button, `specialist:${s.id}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

export function formatSpecialistLine(specialistId) {
  const s = getSpecialist(specialistId);
  return s ? s.button : 'не выбран';
}
