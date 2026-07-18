import { randomUUID } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import {
  BROADCAST_MEDIA_DIR,
  ensureBroadcastMediaDir,
  toLocalPhotoRef,
  isLocalPhotoRef,
  resolveLocalPhotoPath,
  resolveBroadcastPhoto,
  resolveAdminPhotoPreviewUrl,
  getMediaContentType,
} from '../../shared/broadcast/media.js';

export {
  LOCAL_PHOTO_PREFIX,
  BROADCAST_MEDIA_DIR,
  isLocalPhotoRef,
  toLocalPhotoRef,
  resolveLocalPhotoPath,
  resolveAdminPhotoPreviewUrl,
  resolveBroadcastPhoto,
  getMediaContentType,
} from '../../shared/broadcast/media.js';

export const BROADCAST_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
]);

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-m4v': '.m4v',
};

export const broadcastPhotoUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      try {
        ensureBroadcastMediaDir();
        cb(null, BROADCAST_MEDIA_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename(_req, file, cb) {
      const ext =
        path.extname(file.originalname)?.toLowerCase() ||
        EXT_BY_MIME[file.mimetype] ||
        '.bin';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: {
    fileSize: BROADCAST_MEDIA_MAX_BYTES,
    files: 1,
  },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Допустимы JPEG, PNG, WebP, GIF или видео MP4/MOV/WebM до 100 МБ'));
      return;
    }
    cb(null, true);
  },
});

export function broadcastUploadMiddleware(req, res, next) {
  broadcastPhotoUpload.single('photo_file')(req, res, (err) => {
    if (err) {
      req.uploadError =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Файл слишком большой (максимум 100 МБ)'
          : err?.message ?? 'Не удалось загрузить файл';
    }
    next();
  });
}

export function getUploadErrorMessage(req) {
  return req.uploadError ?? null;
}
