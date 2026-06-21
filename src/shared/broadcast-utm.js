const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

export function parseBroadcastUtm(query = {}) {
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = String(query[key] ?? '').trim();
    if (value) {
      utm[key] = value;
    }
  }
  return utm;
}

export function hasBroadcastUtm(utm = {}) {
  return UTM_KEYS.some((key) => Boolean(utm[key]));
}

/** Добавляет utm_* к https-ссылкам в inline-кнопках (не t.me ?start=) */
export function appendUtmToUrl(url, utm = {}) {
  if (!hasBroadcastUtm(utm)) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return url;
    }

    if (/^(.*\.)?t\.me$/i.test(parsed.hostname)) {
      return url;
    }

    for (const key of UTM_KEYS) {
      const value = utm[key];
      if (value) {
        parsed.searchParams.set(key, value);
      }
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

export function appendUtmToBroadcastMarkup(replyMarkup, utm = {}) {
  if (!replyMarkup?.inline_keyboard?.length || !hasBroadcastUtm(utm)) {
    return replyMarkup;
  }

  return {
    inline_keyboard: replyMarkup.inline_keyboard.map((row) =>
      row.map((button) => {
        if (!button.url) {
          return button;
        }
        return {
          ...button,
          url: appendUtmToUrl(button.url, utm),
        };
      }),
    ),
  };
}
