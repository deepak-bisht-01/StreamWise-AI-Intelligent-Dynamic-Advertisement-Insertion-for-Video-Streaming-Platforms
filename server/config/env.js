const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

function getEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value;
}

function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function validateNumber(value, min, max) {
  const num = Number(value);
  return !isNaN(num) && Number.isFinite(num) && num >= min && num <= max;
}

function assertEnv() {
  const missing = required.filter((key) => !getEnv(key));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate URLs
  const supabaseUrl = getEnv('SUPABASE_URL');
  if (!validateUrl(supabaseUrl)) {
    throw new Error('SUPABASE_URL must be a valid URL');
  }

  // Validate numeric values
  const port = getEnv('PORT', '5000');
  if (!validateNumber(port, 1, 65535)) {
    throw new Error('PORT must be a valid port number (1-65535)');
  }

  const maxVideoSize = getEnv('MAX_VIDEO_SIZE_MB', '500');
  if (!validateNumber(maxVideoSize, 1, 10000)) {
    throw new Error('MAX_VIDEO_SIZE_MB must be between 1 and 10000');
  }

  const maxThumbnailSize = getEnv('MAX_THUMBNAIL_SIZE_MB', '10');
  if (!validateNumber(maxThumbnailSize, 1, 100)) {
    throw new Error('MAX_THUMBNAIL_SIZE_MB must be between 1 and 100');
  }

  // Validate node environment
  const nodeEnv = getEnv('NODE_ENV', 'development');
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, production, or test');
  }
}

const env = {
  nodeEnv: getEnv('NODE_ENV', 'development'),
  port: Number(getEnv('PORT', '5000')),
  clientOrigin: getEnv('CLIENT_ORIGIN', 'http://localhost:5173'),
  supabase: {
    url: getEnv('SUPABASE_URL'),
    anonKey: getEnv('SUPABASE_ANON_KEY'),
  },
  cloudinary: {
    cloudName: getEnv('CLOUDINARY_CLOUD_NAME'),
    apiKey: getEnv('CLOUDINARY_API_KEY'),
    apiSecret: getEnv('CLOUDINARY_API_SECRET'),
  },
  limits: {
    maxVideoSizeMb: Number(getEnv('MAX_VIDEO_SIZE_MB', '500')),
    maxThumbnailSizeMb: Number(getEnv('MAX_THUMBNAIL_SIZE_MB', '10')),
  },
};

env.isProduction = env.nodeEnv === 'production';

module.exports = { env, assertEnv, getEnv };
