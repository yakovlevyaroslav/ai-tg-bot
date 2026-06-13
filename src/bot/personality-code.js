import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePersonalityCodes } from '../shared/personality-code-math.js';
import { complete } from './ai/index.js';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');
const TELEGRAM_MAX_LENGTH = 4096;

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

export { computePersonalityCodes };

export function buildPersonalityCodeMessages(data) {
  const codes = computePersonalityCodes(data);
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

  return {
    codes,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content:
          'Сформируй мой Код личности по данным анкеты. Следуй структуре и используй только вычисленные числа.',
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
