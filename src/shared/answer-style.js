import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFormattingInstructions } from './telegram-format.js';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');

export const ANSWER_STYLES = {
  simple: 'simple',
  professional: 'professional',
};

export const ANSWER_STYLE_LABELS = {
  [ANSWER_STYLES.simple]: 'Простой',
  [ANSWER_STYLES.professional]: 'Профессиональный',
};

const cache = new Map();

function loadPromptFile(filename) {
  if (cache.has(filename)) {
    return cache.get(filename);
  }

  const path = resolve(promptsDir, filename);
  if (!existsSync(path)) {
    cache.set(filename, '');
    return '';
  }

  const content = readFileSync(path, 'utf8').trim();
  cache.set(filename, content);
  return content;
}

export function normalizeAnswerStyle(value) {
  return value === ANSWER_STYLES.simple
    ? ANSWER_STYLES.simple
    : ANSWER_STYLES.professional;
}

export function getAnswerStyleLabel(style) {
  return ANSWER_STYLE_LABELS[normalizeAnswerStyle(style)];
}

function loadStyleBlock(style, kind) {
  const normalized = normalizeAnswerStyle(style);
  return loadPromptFile(`${kind}-style-${normalized}.txt`);
}

/** Системная инструкция для ответов на вопросы */
export function loadQuestionsSystemPrompt(style = ANSWER_STYLES.professional) {
  const base = loadPromptFile('questions.txt');
  const formatting = loadFormattingInstructions();
  const styleBlock = loadStyleBlock(style, 'style');

  return [base, formatting, styleBlock].filter(Boolean).join('\n\n');
}

/** Дополнение к промпту базового разбора */
export function loadCodeStylePrompt(style = ANSWER_STYLES.professional) {
  const styleBlock = loadStyleBlock(style, 'code');
  const formatting = loadFormattingInstructions();

  return [styleBlock, formatting].filter(Boolean).join('\n\n');
}
