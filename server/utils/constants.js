const { env } = require('../config/env');

const VIDEO_FOLDER = 'videos';
const THUMBNAIL_FOLDER = 'thumbnails';

const VIDEO_MIME_TYPES = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
};

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

const IMAGE_MIME_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_VIDEO_BYTES = env.limits.maxVideoSizeMb * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = env.limits.maxThumbnailSizeMb * 1024 * 1024;

module.exports = {
  VIDEO_FOLDER,
  THUMBNAIL_FOLDER,
  VIDEO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MAX_VIDEO_BYTES,
  MAX_THUMBNAIL_BYTES,
};
