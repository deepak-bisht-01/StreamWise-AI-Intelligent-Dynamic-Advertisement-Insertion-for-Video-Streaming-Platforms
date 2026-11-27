const fs = require('fs');
const path = require('path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { adminSupabase } = require('../config/supabase');
const { ApiError } = require('../utils/ApiError');
const { uploadRenderedAd, deleteRenderedAdAsset } = require('./cloudinaryService');

const AD_RESULTS_DIR = path.resolve(__dirname, '..', 'storage', 'ad-results');

function validateCloudinaryUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new ApiError(404, 'Rendered video storage URL is invalid'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
    throw new ApiError(404, 'Rendered video is not available in shared storage');
  }
  return value;
}

async function getSharedAdUrl(videoId, adId, ad) {
  if (ad.cloudinaryUrl) return validateCloudinaryUrl(ad.cloudinaryUrl);

  const resultRoot = path.resolve(AD_RESULTS_DIR, videoId);
  const filePath = path.resolve(resultRoot, `${adId}.mp4`);
  if (!filePath.startsWith(`${resultRoot}${path.sep}`) || !fs.existsSync(filePath)) {
    throw new ApiError(404, 'Rendered ad file is missing from this server. Re-render the ad from the admin video page to publish it for other devices.');
  }

  // Migrate older local-only ad renders to shared storage when they are first played.
  const asset = await uploadRenderedAd(filePath, videoId, adId);
  const { data: latest, error: readError } = await adminSupabase.from('videos')
    .select('analysis_meta').eq('id', videoId).single();
  if (readError || !latest) {
    await deleteRenderedAdAsset(asset.publicId).catch(() => {});
    throw new ApiError(502, 'Could not save the shared video link');
  }

  const currentResults = Array.isArray(latest.analysis_meta?.adResults) ? latest.analysis_meta.adResults : [];
  const found = currentResults.some((item) => item.id === adId);
  if (!found) {
    await deleteRenderedAdAsset(asset.publicId).catch(() => {});
    throw new ApiError(404, 'Ad video was removed while it was being prepared');
  }

  const updatedResults = currentResults.map((item) => item.id === adId ? {
    ...item,
    cloudinaryPublicId: asset.publicId,
    cloudinaryUrl: asset.secureUrl,
  } : item);
  const { error: updateError } = await adminSupabase.from('videos').update({
    analysis_meta: { ...(latest.analysis_meta || {}), adResults: updatedResults },
  }).eq('id', videoId);
  if (updateError) throw new ApiError(502, 'Rendered video uploaded, but its shared link could not be saved', updateError.message);
  return validateCloudinaryUrl(asset.secureUrl);
}

async function streamSharedAd(req, res, url) {
  const controller = new AbortController();
  const abortOnDisconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', abortOnDisconnect);
  try {
    const headers = { 'Accept-Encoding': 'identity' };
    if (req.headers.range) headers.Range = req.headers.range;
    if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
    const remote = await fetch(validateCloudinaryUrl(url), { headers, signal: controller.signal });
    if (![200, 206, 416].includes(remote.status)) {
      if (remote.body) await remote.body.cancel().catch(() => {});
      throw new ApiError(remote.status === 404 ? 404 : 502, 'Shared video storage could not return this rendered video');
    }

    res.status(remote.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = remote.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (!remote.headers.has('content-type')) res.type('video/mp4');
    if (!remote.headers.has('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
    if (!remote.body) return res.end();
    await pipeline(Readable.fromWeb(remote.body), res);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) return;
    throw new ApiError(502, 'Could not stream the rendered video from shared storage', error.message);
  } finally {
    res.off('close', abortOnDisconnect);
  }
}

module.exports = { getSharedAdUrl, validateCloudinaryUrl, streamSharedAd };
