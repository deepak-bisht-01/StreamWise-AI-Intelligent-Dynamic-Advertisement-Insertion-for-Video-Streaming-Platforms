const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth, requireAdmin } = require('../middlewares/requireAuth');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { createSignedMediaUrl } = require('../services/signedMediaService');

const PREVIEW_DIR = path.resolve(__dirname, '..', 'storage', 'ai-previews');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mount at /api/videos  ->  GET /:id/analysis , POST /:id/analyze */
module.exports = function adAnalysisRoutes(adAnalysis) {
  const router = express.Router();

  router.get('/:id/analysis/preview', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    if (!UUID_REGEX.test(req.params.id)) throw new ApiError(400, 'Video id must be a valid UUID');
    const filePath = path.resolve(PREVIEW_DIR, `${req.params.id}.mp4`);
    if (!filePath.startsWith(`${PREVIEW_DIR}${path.sep}`) || !fs.existsSync(filePath)) {
      throw new ApiError(404, 'Detection preview video not found');
    }
    res.type('video/mp4').sendFile(filePath);
  }));

  router.get('/:id/analysis', requireAuth, requireAdmin, async (req, res) => {
    const data = await adAnalysis.getAnalysis(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Video not found', data: null });
    if (data.previewUrl) data.previewUrl = createSignedMediaUrl('preview', req.params.id, null, req.user.id, req.sessionId);
    data.adResults = data.adResults.map((ad) => ({
      ...ad,
      outputUrl: createSignedMediaUrl('ad', req.params.id, ad.id, req.user.id, req.sessionId),
    }));
    res.json({ success: true, message: 'Analysis fetched successfully', data });
  });

  // Manual retry (e.g. after a failed run)
  router.post('/:id/analyze', requireAuth, requireAdmin, async (req, res) => {
    const data = await adAnalysis.getAnalysis(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Video not found', data: null });
    if (data.status === 'processing') {
      return res.status(409).json({ success: false, message: 'Analysis already running', data: null });
    }
    const queued = await adAnalysis.retry(req.params.id);
    if (!queued) {
      return res.status(503).json({ success: false, message: 'Could not queue analysis. Check the database migration.', data: null });
    }
    res.status(202).json({ success: true, message: 'Analysis queued', data: null });
  });

  return router;
};
