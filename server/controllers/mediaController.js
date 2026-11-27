const fs = require('fs');
const path = require('path');
const { adminSupabase } = require('../config/supabase');
const { ApiError } = require('../utils/ApiError');
const { verifySignedMediaUrl } = require('../services/signedMediaService');
const videoService = require('../services/videoService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AD_RESULTS_DIR = path.resolve(__dirname, '..', 'storage', 'ad-results');
const PREVIEW_DIR = path.resolve(__dirname, '..', 'storage', 'ai-previews');

async function resolveSignedIdentity(req, kind, videoId, assetId = '') {
  if (!UUID_REGEX.test(videoId) || (assetId && !UUID_REGEX.test(assetId))) throw new ApiError(400, 'Media ids must be valid UUIDs');
  const identity = verifySignedMediaUrl({
    kind,
    videoId,
    assetId,
    userId: req.query.user,
    sessionId: req.query.session,
    expiresAt: req.query.expires,
    signature: req.query.signature,
  });
  if (!identity) throw new ApiError(401, 'This media link is invalid or expired. Reload the video.');

  const { data: session, error: sessionError } = await adminSupabase.from('app_sessions')
    .select('id').eq('id', identity.sessionId).eq('user_id', identity.userId)
    .is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (sessionError || !session) throw new ApiError(401, 'Your session expired. Sign in again to continue.');

  const { data: profile, error: profileError } = await adminSupabase.from('profiles')
    .select('*').eq('id', identity.userId).single();
  if (profileError || !profile) throw new ApiError(403, 'Your account profile is not available.');
  return { profile };
}

async function streamAdResult(req, res, next) {
  try {
    const { videoId, adId } = req.params;
    const { profile } = await resolveSignedIdentity(req, 'ad', videoId, adId);
    const { data: video, error } = await adminSupabase.from('videos')
      .select('analysis_meta').eq('id', videoId).single();
    if (error || !video) throw new ApiError(404, 'Video not found');
    const results = Array.isArray(video.analysis_meta?.adResults) ? video.analysis_meta.adResults : [];
    const ad = results.find((item) => item.id === adId);
    if (!ad) throw new ApiError(404, 'Ad video not found');
    if (profile.role !== 'admin' && !videoService.isApprovedAdForLocation(ad, profile)) {
      throw new ApiError(404, 'No approved ad video is available for your location');
    }
    const resultRoot = path.resolve(AD_RESULTS_DIR, videoId);
    const filePath = path.resolve(resultRoot, `${adId}.mp4`);
    if (!filePath.startsWith(`${resultRoot}${path.sep}`) || !fs.existsSync(filePath)) throw new ApiError(404, 'Rendered ad video file not found');
    res.type('video/mp4').sendFile(filePath);
  } catch (error) {
    next(error);
  }
}

async function streamAnalysisPreview(req, res, next) {
  try {
    const { videoId } = req.params;
    const { profile } = await resolveSignedIdentity(req, 'preview', videoId);
    if (profile.role !== 'admin') throw new ApiError(403, 'Administrator access is required for detection previews');
    const filePath = path.resolve(PREVIEW_DIR, `${videoId}.mp4`);
    if (!filePath.startsWith(`${PREVIEW_DIR}${path.sep}`) || !fs.existsSync(filePath)) throw new ApiError(404, 'Detection preview video not found');
    res.type('video/mp4').sendFile(filePath);
  } catch (error) {
    next(error);
  }
}

module.exports = { streamAdResult, streamAnalysisPreview };
