import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const INCLUDE_PATTERN = /<!--\s*@include\s+(.+?)\s*-->/g;

function resolveIncludePath(pagePath, includePath) {
  return resolve(dirname(pagePath), includePath.trim());
}

function expandHtmlIncludes(html, pagePath, seen = new Set()) {
  return html.replace(INCLUDE_PATTERN, (_, includePath) => {
    const absolute = resolveIncludePath(pagePath, includePath);

    if (seen.has(absolute)) {
      throw new Error(`Circular HTML include detected: ${absolute}`);
    }

    if (!existsSync(absolute)) {
      throw new Error(`HTML include not found: ${absolute}`);
    }

    const nextSeen = new Set(seen);
    nextSeen.add(absolute);

    const content = readFileSync(absolute, 'utf8');
    return expandHtmlIncludes(content, absolute, nextSeen);
  });
}

/** Подключает HTML-компоненты прямо в pages через <!-- @include path --> */
export function htmlIncludesPlugin() {
  return {
    name: 'html-includes',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const pagePath = ctx.filename;
        if (!pagePath) {
          return html;
        }

        return expandHtmlIncludes(html, pagePath);
      },
    },
  };
}
