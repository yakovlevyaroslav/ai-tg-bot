import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePersonalityCodes } from '../shared/personality-code-math.js';
import { loadCodeStylePrompt } from '../shared/answer-style.js';
import { splitFormattedMessage } from '../shared/telegram-format.js';
import { complete } from './ai/index.js';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');

let cachedPrompt = null;

function loadCodePromptTemplate() {
  if (cachedPrompt) {
    return cachedPrompt;
  }

  const path = resolve(promptsDir, 'code.txt');
  if (!existsSync(path)) {
    throw new Error(`Prompt file not found: ${path}`);
  }

  cachedPrompt = readFileSync(path, 'utf8').trim();
  return cachedPrompt;
}

function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function splitMessage(text) {
  return splitFormattedMessage(text);
}

export { computePersonalityCodes };

export function buildPersonalityCodeMessages(data) {
  const codes = computePersonalityCodes(data);
  const styleBlock = loadCodeStylePrompt(data?.answer_style);
  const systemPrompt = fillTemplate(loadCodePromptTemplate(), {
    name: data.name,
    gender_label: data.gender_label,
    birth_date: data.birth_date,
    birth_time: data.birth_time,
    birth_place_label: data.birth_place_label,
    full_code: codes.fullCode,
    astrology_code: codes.astrologyCode,
    human_design_code: codes.humanDesignCode,
    numerology_code: codes.numerologyCode,
    sucai_code: codes.sucaiCode,
    jyotish_code: codes.jyotishCode,
    astrology_formula: codes.astrologyFormula,
    human_design_formula: codes.humanDesignFormula,
    numerology_formula: codes.numerologyFormula,
    sucai_formula: codes.sucaiFormula,
    jyotish_formula: codes.jyotishFormula,
  });
  const fullSystemPrompt = styleBlock ? `${systemPrompt}\n\n${styleBlock}` : systemPrompt;

  return {
    codes,
    messages: [
      { role: 'system', content: fullSystemPrompt },
      {
        role: 'user',
        content:
          'Сформируй мой Код личности по данным анкеты. Следуй структуре, используй только вычисленные числа и обязательно примени HTML-оформление из инструкции.',
      },
    ],
  };
}

export async function generatePersonalityCode(data) {
  const { codes, messages } = buildPersonalityCodeMessages(data);
  const result = await complete(messages);
  return {
    codes,
    content: result.content.trim(),
    model: result.model,
    usage: result.usage,
  };
}

export function splitPersonalityCodeReply(text) {
  return splitMessage(text);
}
