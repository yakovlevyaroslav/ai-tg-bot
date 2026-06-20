import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const LOCAL_PHOTO_PREFIX = 'local:';
export const BROADCAST_MEDIA_DIR = path.join(process.cwd(), 'data/broadcast-media');

function safeBasename(value) {
  const name = path.basename(String(value ?? '').trim());
  if (!name || name === '.' || name === '..') {
    return null;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return null;
  }
  return name;
}

export function ensureBroadcastMediaDir() {
  if (!existsSync(BROADCAST_MEDIA_DIR)) {
    mkdirSync(BROADCAST_MEDIA_DIR, { recursive: true });
  }
}

export function isLocalPhotoRef(photoRef) {
  return String(photoRef ?? '').startsWith(LOCAL_PHOTO_PREFIX);
}

export function toLocalPhotoRef(filename) {
  const safe = safeBasename(filename);
  return safe ? `${LOCAL_PHOTO_PREFIX}${safe}` : '';
}

export function resolveLocalPhotoPath(photoRef) {
  if (!isLocalPhotoRef(photoRef)) {
    return null;
  }

  const filename = safeBasename(photoRef.slice(LOCAL_PHOTO_PREFIX.length));
  if (!filename) {
    return null;
  }

  const absolute = path.join(BROADCAST_MEDIA_DIR, filename);
  if (!existsSync(absolute)) {
    return null;
  }

  return absolute;
}

export function resolveAdminPhotoPreviewUrl(photoRef) {
  if (!isLocalPhotoRef(photoRef)) {
    return '';
  }

  const filename = safeBasename(photoRef.slice(LOCAL_PHOTO_PREFIX.length));
  return filename ? `/admin/broadcast/media/${encodeURIComponent(filename)}` : '';
}

export function getMediaContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

export function resolveBroadcastPhoto(body = {}, file = null) {
  if (file?.filename) {
    return toLocalPhotoRef(file.filename);
  }

  const local = String(body.photo_local ?? '').trim();
  if (isLocalPhotoRef(local) && resolveLocalPhotoPath(local)) {
    return local;
  }

  const url = String(body.photo_url ?? '').trim();
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return '';
}

export function resolveCampaignPhotoPreviewUrl(photoRef) {
  if (/^https?:\/\//i.test(String(photoRef ?? ''))) {
    return photoRef;
  }
  return resolveAdminPhotoPreviewUrl(photoRef);
}
