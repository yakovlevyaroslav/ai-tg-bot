/**
 * Резолв города рождения → координаты + IANA timezone (Open-Meteo Geocoding).
 * Время рождения трактуем как местное гражданское время в этом поясе.
 */

function getOffsetMs(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Локальные дата/время в IANA-зоне → момент UTC. */
export function zonedLocalToUtc(year, month, day, hour, minute, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = getOffsetMs(timeZone, new Date(utcGuess));
  const utc2 = utcGuess - offset1;
  const offset2 = getOffsetMs(timeZone, new Date(utc2));
  return new Date(utcGuess - offset2);
}

export function formatUtcOffsetLabel(timeZone, date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name) {
      return name.replace('GMT', 'UTC');
    }
  } catch {
    // ignore
  }

  const offsetMs = getOffsetMs(timeZone, date);
  const totalMin = Math.round(offsetMs / 60000);
  const sign = totalMin >= 0 ? '+' : '-';
  const abs = Math.abs(totalMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return mm === '00' ? `UTC${sign}${Number(hh)}` : `UTC${sign}${hh}:${mm}`;
}

function parseBirthDateTime(birthDate, birthTime) {
  const [day, month, year] = String(birthDate || '')
    .split('.')
    .map(Number);
  const [hour, minute] = String(birthTime || '12:00')
    .split(':')
    .map(Number);

  if (![day, month, year].every(Number.isFinite) || !year) {
    return null;
  }

  return {
    day,
    month,
    year,
    hour: Number.isFinite(hour) ? hour : 12,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function formatPlaceLabel(hit, fallback) {
  const bits = [hit.name, hit.admin1, hit.country].filter(Boolean);
  const unique = [...new Set(bits)];
  return unique.join(', ') || fallback;
}

/**
 * @returns {Promise<{
 *   birth_place_label: string,
 *   birth_place_lat: number|null,
 *   birth_place_lon: number|null,
 *   birth_timezone: string|null,
 *   birth_utc_offset: string|null,
 *   birth_time_context: string,
 * }>}
 */
export async function resolveBirthPlace(placeQuery, { birthDate, birthTime } = {}) {
  const query = String(placeQuery || '').trim();
  const empty = {
    birth_place_label: query,
    birth_place_lat: null,
    birth_place_lon: null,
    birth_timezone: null,
    birth_utc_offset: null,
    birth_time_context:
      'Часовой пояс по городу не определён; трактуй время рождения как местное у указанного места без точного смещения UTC.',
  };

  if (!query) {
    return empty;
  }

  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', query);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'ru');
    url.searchParams.set('format', 'json');

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return empty;
    }

    const payload = await response.json();
    const hit = payload?.results?.[0];
    if (!hit?.timezone) {
      return empty;
    }

    const label = formatPlaceLabel(hit, query);
    const parsed = parseBirthDateTime(birthDate, birthTime);
    let utcOffset = null;
    let timeContext = `Время рождения — местное гражданское время в часовом поясе ${hit.timezone}.`;

    if (parsed) {
      const utcMoment = zonedLocalToUtc(
        parsed.year,
        parsed.month,
        parsed.day,
        parsed.hour,
        parsed.minute,
        hit.timezone,
      );
      utcOffset = formatUtcOffsetLabel(hit.timezone, utcMoment);
      timeContext =
        `Время рождения ${String(birthTime || '').trim()} — местное гражданское время в ${hit.timezone} ` +
        `(смещение на дату рождения: ${utcOffset}). ` +
        `Для Human Design, астрологии и Джойтиш учитывай этот пояс: местное время → момент на шкале UTC через ${utcOffset}.`;
    }

    return {
      birth_place_label: label,
      birth_place_lat: hit.latitude ?? null,
      birth_place_lon: hit.longitude ?? null,
      birth_timezone: hit.timezone,
      birth_utc_offset: utcOffset,
      birth_time_context: timeContext,
    };
  } catch (err) {
    console.warn('Birth place geocode failed:', err?.message ?? err);
    return empty;
  }
}

/** Дополняет onboarding_data полями пояса, если их ещё нет. */
export async function enrichOnboardingWithTimezone(data) {
  if (!data) {
    return data;
  }

  if (data.birth_timezone && data.birth_time_context) {
    return data;
  }

  const place = data.birth_place_label || data.birth_place;
  if (!place) {
    return data;
  }

  const resolved = await resolveBirthPlace(place, {
    birthDate: data.birth_date,
    birthTime: data.birth_time,
  });

  return {
    ...data,
    birth_place_label: data.birth_place_label || resolved.birth_place_label,
    birth_place_lat: data.birth_place_lat ?? resolved.birth_place_lat,
    birth_place_lon: data.birth_place_lon ?? resolved.birth_place_lon,
    birth_timezone: data.birth_timezone || resolved.birth_timezone,
    birth_utc_offset: data.birth_utc_offset || resolved.birth_utc_offset,
    birth_time_context: data.birth_time_context || resolved.birth_time_context,
  };
}
