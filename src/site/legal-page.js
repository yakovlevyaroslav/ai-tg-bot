import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../shared/config.js';
import { escapeHtml, renderSitePage } from './html.js';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');
const templateCache = new Map();

export function resolveSupportContact() {
  if (config.paymentSupportUsername) {
    return config.paymentSupportUsername;
  }
  if (config.yookassaReceiptEmail) {
    return config.yookassaReceiptEmail;
  }
  return 'контакт поддержки в Telegram-боте';
}

export function loadLegalTemplate(customFile, defaultFilename) {
  const cacheKey = customFile || defaultFilename;
  if (templateCache.has(cacheKey)) {
    return templateCache.get(cacheKey);
  }

  const filePath = customFile
    ? resolve(process.cwd(), customFile)
    : resolve(promptsDir, defaultFilename);

  if (!existsSync(filePath)) {
    throw new Error(`Legal page file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf8').trim();
  templateCache.set(cacheKey, content);
  return content;
}

export function fillLegalTemplate(template, replacements) {
  return template.replace(/\{(\w+)\}/g, (_, key) => replacements[key] ?? '');
}

export function renderLegalBody(text) {
  const blocks = text.split(/\n\n+/).filter(Boolean);
  const parts = [];

  for (const [index, block] of blocks.entries()) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);

    if (index === 0 && lines.length === 1) {
      parts.push(`<h1>${escapeHtml(lines[0])}</h1>`);
      continue;
    }

    if (lines.length === 1 && /^\d+\.\s/.test(lines[0]) && lines[0].length < 120) {
      parts.push(`<h2>${escapeHtml(lines[0])}</h2>`);
      continue;
    }

    let paragraph = [];
    let listItems = [];

    const flushParagraph = () => {
      if (paragraph.length) {
        parts.push(`<p>${escapeHtml(paragraph.join(' '))}</p>`);
        paragraph = [];
      }
    };

    const flushList = () => {
      if (listItems.length) {
        parts.push(`<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
        listItems = [];
      }
    };

    for (const line of lines) {
      if (line.startsWith('- ')) {
        flushParagraph();
        listItems.push(line.slice(2));
      } else {
        flushList();
        paragraph.push(line);
      }
    }

    flushList();
    flushParagraph();
  }

  return `<div class="prose">${parts.join('\n')}</div>`;
}

export function renderLegalPage({ title, description, activeNav, customFile, defaultFilename, replacements }) {
  const template = fillLegalTemplate(
    loadLegalTemplate(customFile, defaultFilename),
    replacements,
  );
  const bodyHtml = renderLegalBody(template);

  return renderSitePage({
    title,
    description,
    activeNav,
    bodyHtml,
  });
}

export function baseLegalReplacements({ privacyUrl, cookiesUrl, updatedDate }) {
  return {
    site_name: config.publicSiteName,
    bot_username: config.publicBotUsername || 'bot',
    operator_name: config.privacyOperatorName || config.publicSiteName,
    support_contact: resolveSupportContact(),
    privacy_url: privacyUrl,
    cookies_url: cookiesUrl,
    updated_date: updatedDate,
  };
}
