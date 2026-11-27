const fs = require('fs');
const path = require('path');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { ApiError } = require('../utils/ApiError');
const { insertAd, deleteAdResult, setAdApproval } = require('../services/adInsertionService');
const { adminSupabase } = require('../config/supabase');
const videoService = require('../services/videoService');

const AD_RESULTS_DIR = path.resolve(__dirname, '..', 'storage', 'ad-results');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const addAd = asyncHandler(async (req, res) => {
  const { slotId, campaignId } = req.body || {};
  if (!slotId) throw new ApiError(400, 'Choose a detected billboard slot');
  if (!campaignId && !req.file) throw new ApiError(400, 'Choose a brand campaign or upload an ad image or video');

  const result = await insertAd({
    videoId: req.params.id,
    slotId,
    creative: req.file,
    campaignId,
    targeting: req.body || {},
    createdBy: req.user.id,
  });
  res.status(201).json(ApiResponse.success('Ad inserted into the detected billboard slot', result));
});

const approveAd = asyncHandler(async (req, res) => {
  const approved = req.body?.approved;
  if (typeof approved !== 'boolean') throw new ApiError(400, 'Choose whether to approve this ad video');
  const result = await setAdApproval({
    videoId: req.params.id,
    adId: req.params.adId,
    approved,
    reviewedBy: req.user.id,
  });
  res.json(ApiResponse.success(approved ? 'Ad video approved for viewers' : 'Ad video approval removed', result));
});

const streamAdResult = asyncHandler(async (req, res) => {
  const { id: videoId, adId } = req.params;
  if (!UUID_REGEX.test(videoId) || !UUID_REGEX.test(adId)) throw new ApiError(400, 'Video and ad ids must be valid UUIDs');
  const { data: video, error } = await adminSupabase.from('videos').select('analysis_meta').eq('id', videoId).single();
  if (error || !video) throw new ApiError(404, 'Video not found');
  const results = Array.isArray(video.analysis_meta?.adResults) ? video.analysis_meta.adResults : [];
  const ad = results.find((item) => item.id === adId);
  if (!ad) throw new ApiError(404, 'Ad video not found');
  if (req.profile?.role !== 'admin' && !videoService.isApprovedAdForLocation(ad, req.profile)) {
    throw new ApiError(404, 'No approved ad video is available for your location');
  }
  const resultRoot = path.resolve(AD_RESULTS_DIR, videoId);
  const filePath = path.resolve(resultRoot, `${adId}.mp4`);
  if (!filePath.startsWith(`${resultRoot}${path.sep}`) || !fs.existsSync(filePath)) throw new ApiError(404, 'Rendered ad video file not found');
  res.type('video/mp4').sendFile(filePath);
});

const removeAd = asyncHandler(async (req, res) => {
  const result = await deleteAdResult({ videoId: req.params.id, adId: req.params.adId });
  res.status(200).json(ApiResponse.success('Ad result deleted successfully', result));
});

module.exports = { addAd, removeAd, setAdApproval: approveAd, streamAdResult };
