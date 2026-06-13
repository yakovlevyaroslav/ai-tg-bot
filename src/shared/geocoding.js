import { config } from './config.js';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const MAX_PLACES = 5;

const ADDRESS_LEVELS = ['city', 'town', 'village', 'municipality', 'hamlet', 'county'];

function userAgent() {
  return `${config.publicSiteName}/1.0 (telegram-bot)`;
}

async function nominatimFetch(path, params) {
  const url = new URL(path, NOMINATIM_BASE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent(),
      Accept: 'application/json',
      'Accept-Language': 'ru',
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim HTTP ${response.status}`);
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

/** Поиск населённых пунктов по названию */
export async function searchBirthPlaces(query) {
  const items = await nominatimFetch('/search', {
    q: query.trim(),
    format: 'json',
    addressdetails: 1,
    limit: MAX_PLACES,
    'accept-language': 'ru',
  });

  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return dedupePlaces(items.map(placeFromSearchResult));
}

/** Варианты места по координатам геолокации */
export async function birthPlacesFromCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  const item = await nominatimFetch('/reverse', {
    lat,
    lon,
    format: 'json',
    addressdetails: 1,
    zoom: 10,
    'accept-language': 'ru',
  });

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
