import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFormattingInstructions } from './telegram-format.js';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');

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

/** Системная инструкция для ответов на вопросы */
export function loadQuestionsSystemPrompt() {
  const base = loadPromptFile('questions.txt');
  const formatting = loadFormattingInstructions();
  const styleBlock = loadPromptFile('style.txt');

  return [base, formatting, styleBlock].filter(Boolean).join('\n\n');
}

/** Дополнение к промпту базового разбора */
export function loadCodeStylePrompt() {
  const styleBlock = loadPromptFile('code-style.txt');
  const formatting = loadFormattingInstructions();

  return [styleBlock, formatting].filter(Boolean).join('\n\n');
}
