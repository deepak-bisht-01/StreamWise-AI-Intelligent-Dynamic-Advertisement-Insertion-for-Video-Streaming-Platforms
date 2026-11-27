const crypto = require('crypto');
const { env } = require('../config/env');

// Video players issue additional byte-range requests during long playback.
const MEDIA_LINK_LIFETIME_SECONDS = 6 * 60 * 60;

function signatureFor(kind, videoId, assetId, userId, sessionId, expiresAt) {
  const payload = [kind, videoId, assetId || '', userId, sessionId, expiresAt].join(':');
  return crypto.createHmac('sha256', env.supabase.serviceRoleKey).update(payload).digest('hex');
}

function createSignedMediaUrl(kind, videoId, assetId, userId, sessionId) {
  const expiresAt = Math.floor(Date.now() / 1000) + MEDIA_LINK_LIFETIME_SECONDS;
  const signature = signatureFor(kind, videoId, assetId, userId, sessionId, expiresAt);
  const query = new URLSearchParams({ user: userId, session: sessionId, expires: String(expiresAt), signature });
  if (kind === 'preview') return `/api/media/preview/${videoId}?${query.toString()}`;
  return `/api/media/ad/${videoId}/${assetId}?${query.toString()}`;
}

function verifySignedMediaUrl({ kind, videoId, assetId = '', userId, sessionId, expiresAt, signature }) {
  if (!userId || !sessionId || !/^\d+$/.test(String(expiresAt)) || !/^[a-f0-9]{64}$/i.test(String(signature || ''))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const expiry = Number(expiresAt);
  const now = Math.floor(Date.now() / 1000);
  if (expiry < now || expiry > now + MEDIA_LINK_LIFETIME_SECONDS + 30) return null;
  const expected = Buffer.from(signatureFor(kind, videoId, assetId, userId, sessionId, expiry), 'hex');
  const supplied = Buffer.from(signature, 'hex');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  return { userId, sessionId };
}

module.exports = { createSignedMediaUrl, verifySignedMediaUrl };
