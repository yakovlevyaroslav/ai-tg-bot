import { config } from './config.js';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const PHOTON_BASE = 'https://photon.komoot.io';
const MAX_PLACES = 5;

const ADDRESS_LEVELS = ['city', 'town', 'village', 'municipality', 'hamlet', 'county'];

function nominatimUserAgent() {
  if (config.nominatimUserAgent) {
    return config.nominatimUserAgent;
  }

  const app = config.publicSiteName || 'PersonalityCodeBot';
  const contact = config.nominatimContactEmail;

  if (contact) {
    return `${app}/1.0 (contact: ${contact})`;
  }

  return `${app}/1.0 (telegram-bot)`;
}

function buildFetchHeaders(service) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': nominatimUserAgent(),
  };

  if (service === 'nominatim') {
    headers['Accept-Language'] = 'ru';
    if (config.publicSiteUrl) {
      headers.Referer = config.publicSiteUrl;
    }
  }

  return headers;
}

async function fetchJson(url, { service = 'nominatim' } = {}) {
  const response = await fetch(url, {
    headers: buildFetchHeaders(service),
    signal: AbortSignal.timeout(config.geocodingTimeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${service} HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }

  return response.json();
}

function buildPlaceLabel(name, region, country) {
  return [name, region, country].filter(Boolean).join(', ');
}

function placeFromAddress(address = {}, fallbackName = '', lat = null, lon = null) {
  const name =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.hamlet ||
    address.county ||
    fallbackName;

  if (!name) {
    return null;
  }

  const region = address.state || address.region || address.state_district;
  const country = address.country;

  return {
    label: buildPlaceLabel(name, region, country),
    name,
    region: region ?? null,
    country: country ?? null,
    lat,
    lon,
  };
}

function placesFromReverseAddress(address, lat, lon) {
  const region = address.state || address.region || address.state_district;
  const country = address.country;
  const candidates = [];

  for (const level of ADDRESS_LEVELS) {
    if (!address[level]) {
      continue;
    }
    candidates.push({
      label: buildPlaceLabel(address[level], region, country),
      name: address[level],
      region: region ?? null,
      country: country ?? null,
      lat,
      lon,
    });
  }

  return candidates;
}

function placeFromSearchResult(item) {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  const fromAddress = placeFromAddress(item.address, item.name, lat, lon);

  if (fromAddress) {
    return fromAddress;
  }

  return {
    label: item.display_name,
    name: item.name || item.display_name,
    region: null,
    country: item.address?.country ?? null,
    lat,
    lon,
  };
}

function placeFromPhotonFeature(feature) {
  const [lon, lat] = feature.geometry?.coordinates ?? [];
  const props = feature.properties ?? {};
  const name =
    props.city || props.name || props.locality || props.county || props.state || props.country;

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const region = props.state || props.county || null;
  const country = props.country || null;

  return {
    label: buildPlaceLabel(name, region, country),
    name,
    region,
    country,
    lat,
    lon,
  };
}

function dedupePlaces(places) {
  const seen = new Set();
  const result = [];

  for (const place of places) {
    const key = place.label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(place);
    if (result.length >= MAX_PLACES) {
      break;
    }
  }

  return result;
}

async function searchNominatim(query) {
  const url = new URL('/search', NOMINATIM_BASE);
  url.searchParams.set('q', query.trim());
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(MAX_PLACES));
  url.searchParams.set('accept-language', 'ru');

  const items = await fetchJson(url, { service: 'nominatim' });

  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return dedupePlaces(items.map(placeFromSearchResult));
}

async function searchPhoton(query) {
  const url = new URL('/api/', PHOTON_BASE);
  url.searchParams.set('q', query.trim());
  url.searchParams.set('limit', String(MAX_PLACES));
  url.searchParams.set('lang', 'en');

  const data = await fetchJson(url, { service: 'photon' });
  const features = Array.isArray(data?.features) ? data.features : [];

  return dedupePlaces(
    features.map(placeFromPhotonFeature).filter(Boolean),
  );
}

/** Поиск населённых пунктов по названию */
export async function searchBirthPlaces(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  let nominatimError = null;

  try {
    const places = await searchNominatim(trimmed);
    if (places.length > 0) {
      return places;
    }
  } catch (err) {
    nominatimError = err;
    console.warn('[geocoding] Nominatim failed:', err?.message ?? err);
  }

  try {
    const places = await searchPhoton(trimmed);
    if (places.length > 0) {
      return places;
    }
  } catch (err) {
    console.warn('[geocoding] Photon failed:', err?.message ?? err);
    if (nominatimError) {
      throw nominatimError;
    }
    throw err;
  }

  return [];
}

/** Варианты места по координатам геолокации */
export async function birthPlacesFromCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  const url = new URL('/reverse', NOMINATIM_BASE);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '10');
  url.searchParams.set('accept-language', 'ru');

  const item = await fetchJson(url, { service: 'nominatim' });

  if (!item || item.error) {
    return [];
  }

  const places = dedupePlaces(placesFromReverseAddress(item.address || {}, lat, lon));

  if (places.length > 0) {
    return places;
  }

  const fallback = placeFromAddress(item.address, item.name, lat, lon);
  if (fallback) {
    return [fallback];
  }

  return [
    {
      label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      region: null,
      country: null,
      lat,
      lon,
    },
  ];
}

export function warnIfGeocodingMisconfigured() {
  if (!config.nominatimContactEmail && !config.nominatimUserAgent) {
    console.warn(
      '[geocoding] NOMINATIM_CONTACT_EMAIL is not set — Nominatim may block city search on production. ' +
        'Set NOMINATIM_CONTACT_EMAIL in .env (see .env.example).',
    );
  }
}
