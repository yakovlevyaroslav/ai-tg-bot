import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const LOCAL_PHOTO_PREFIX = 'local:';
export const BROADCAST_MEDIA_DIR = path.join(process.cwd(), 'data/broadcast-media');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

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

function extensionFromRef(mediaRef) {
  const raw = String(mediaRef ?? '').trim();
  if (!raw) {
    return '';
  }

  if (isLocalPhotoRef(raw)) {
    return path.extname(raw.slice(LOCAL_PHOTO_PREFIX.length)).toLowerCase();
  }

  try {
    const pathname = new URL(raw).pathname;
    return path.extname(pathname).toLowerCase();
  } catch {
    return path.extname(raw).toLowerCase();
  }
}

/** @returns {'photo' | 'video'} */
export function detectBroadcastMediaKind(mediaRef) {
  const ext = extensionFromRef(mediaRef);
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }
  return 'photo';
}

export function getMediaContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image/jpeg';
  return 'application/octet-stream';
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
