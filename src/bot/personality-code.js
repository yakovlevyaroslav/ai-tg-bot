import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichOnboardingWithTimezone } from '../shared/birth-place-timezone.js';
import { computePersonalityCodes } from '../shared/personality-code-math.js';
import { loadCodeStylePrompt } from '../shared/answer-style.js';
import { splitFormattedMessage } from '../shared/telegram-format.js';
import { complete } from './ai/index.js';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');

let cachedPrompt = null;
let cachedConclusionPrompt = null;

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

function loadConclusionPromptTemplate() {
  if (cachedConclusionPrompt) {
    return cachedConclusionPrompt;
  }

  const path = resolve(promptsDir, 'code-conclusion.txt');
  if (!existsSync(path)) {
    throw new Error(`Prompt file not found: ${path}`);
  }

  cachedConclusionPrompt = readFileSync(path, 'utf8').trim();
  return cachedConclusionPrompt;
}

function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function splitMessage(text) {
  return splitFormattedMessage(text);
}

function templateVars(data, codes, extra = {}) {
  const timezoneLabel = data.birth_timezone
    ? `${data.birth_timezone}${data.birth_utc_offset ? ` (${data.birth_utc_offset})` : ''}`
    : 'не определён';

  return {
    name: data.name,
    gender_label: data.gender_label,
    birth_date: data.birth_date,
    birth_time: data.birth_time,
    birth_place_label: data.birth_place_label,
    birth_timezone_label: timezoneLabel,
    birth_time_context:
      data.birth_time_context ||
      'Время рождения трактуй как местное у указанного города; точный часовой пояс не определён.',
    full_code: codes.fullCode,
    astrology_code: codes.astrologyCode,
    human_design_code: codes.humanDesignCode,
    numerology_code: codes.numerologyCode,
    life_path_number: codes.lifePathNumber,
    birthday_number: codes.birthdayNumber,
    personal_year_number: codes.personalYearNumber,
    personal_year_calendar: codes.personalYearCalendar,
    sucai_code: codes.sucaiCode,
    sucai_consciousness_number: codes.sucaiConsciousnessNumber,
    sucai_mission_number: codes.sucaiMissionNumber,
    jyotish_code: codes.jyotishCode,
    astrology_formula: codes.astrologyFormula,
    human_design_formula: codes.humanDesignFormula,
    numerology_formula: codes.numerologyFormula,
    life_path_formula: codes.lifePathFormula,
    birthday_number_formula: codes.birthdayNumberFormula,
    personal_year_formula: codes.personalYearFormula,
    sucai_formula: codes.sucaiFormula,
    sucai_consciousness_formula: codes.sucaiConsciousnessFormula,
    sucai_mission_formula: codes.sucaiMissionFormula,
    jyotish_formula: codes.jyotishFormula,
    ...extra,
  };
}

function ensureConclusionHeading(text) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    return '';
  }
  if (/Общий\s+вывод/i.test(raw)) {
    return raw;
  }
  return `💡 <b>Общий вывод</b>\n\n${raw}`;
}

export { computePersonalityCodes };

export function buildPersonalityCodeMessages(data) {
  const codes = computePersonalityCodes(data);
  const styleBlock = loadCodeStylePrompt();
  const systemPrompt = fillTemplate(loadCodePromptTemplate(), templateVars(data, codes));
  const fullSystemPrompt = styleBlock ? `${systemPrompt}\n\n${styleBlock}` : systemPrompt;

  return {
    codes,
    messages: [
      { role: 'system', content: fullSystemPrompt },
      {
        role: 'user',
        content:
          'Сформируй мой Код личности по данным анкеты (блоки 1–6). Следуй структуре, используй только вычисленные числа, примени HTML-оформление. Не пиши «Общий вывод».',
      },
    ],
  };
}

export function buildPersonalityCodeConclusionMessages(data, codes, mainContent) {
  const styleBlock = loadCodeStylePrompt();
  const mainSummary = String(mainContent ?? '')
    .replace(/<[^>]+>/g, '')
    .slice(0, 3500);
  const systemPrompt = fillTemplate(
    loadConclusionPromptTemplate(),
    templateVars(data, codes, { main_summary: mainSummary }),
  );
  const fullSystemPrompt = styleBlock ? `${systemPrompt}\n\n${styleBlock}` : systemPrompt;

  return [
    { role: 'system', content: fullSystemPrompt },
    {
      role: 'user',
      content:
        'Напиши только блок «Общий вывод» по структуре из инструкции. Начни с заголовка 💡 <b>Общий вывод</b>.',
    },
  ];
}

export async function generatePersonalityCode(data) {
  const enriched = await enrichOnboardingWithTimezone(data);
  const { codes, messages } = buildPersonalityCodeMessages(enriched);
  const mainResult = await complete(messages);
  const mainContent = mainResult.content.trim();

  const conclusionMessages = buildPersonalityCodeConclusionMessages(enriched, codes, mainContent);
  const conclusionResult = await complete(conclusionMessages);
  const conclusionContent = ensureConclusionHeading(conclusionResult.content.trim());

  const usage = {
    prompt_tokens:
      (mainResult.usage?.prompt_tokens ?? 0) + (conclusionResult.usage?.prompt_tokens ?? 0),
    completion_tokens:
      (mainResult.usage?.completion_tokens ?? 0) + (conclusionResult.usage?.completion_tokens ?? 0),
  };

  return {
    codes,
    content: [mainContent, conclusionContent].filter(Boolean).join('\n\n'),
    mainContent,
    conclusionContent,
    model: conclusionResult.model ?? mainResult.model,
    usage,
    onboardingDataPatch: {
      birth_place_label: enriched.birth_place_label,
      birth_place_lat: enriched.birth_place_lat ?? null,
      birth_place_lon: enriched.birth_place_lon ?? null,
      birth_timezone: enriched.birth_timezone ?? null,
      birth_utc_offset: enriched.birth_utc_offset ?? null,
      birth_time_context: enriched.birth_time_context ?? null,
    },
  };
}

/** Разбивает ответ на чанки; «Общий вывод» — отдельным сообщением (или группой чанков). */
export function splitPersonalityCodeReply(text, { mainContent, conclusionContent } = {}) {
  if (mainContent != null || conclusionContent != null) {
    const chunks = [];
    if (mainContent) {
      chunks.push(...splitMessage(String(mainContent).trim()));
    }
    if (conclusionContent) {
      chunks.push(...splitMessage(ensureConclusionHeading(conclusionContent)));
    }
    return chunks.length ? chunks : splitMessage(String(text ?? '').trim());
  }

  const raw = String(text ?? '').trim();
  if (!raw) {
    return [];
  }

  const marker = /(?:^|\n)\s*(?:💡\s*)?(?:<b>\s*)?Общий\s+вывод(?:\s*<\/b>)?/i;
  const match = raw.match(marker);

  if (!match || match.index == null) {
    return splitMessage(raw);
  }

  const main = raw.slice(0, match.index).trim();
  const conclusion = raw.slice(match.index).trim();
  const chunks = [];

  if (main) {
    chunks.push(...splitMessage(main));
  }
  if (conclusion) {
    chunks.push(...splitMessage(conclusion));
  }

  return chunks.length ? chunks : splitMessage(raw);
}
