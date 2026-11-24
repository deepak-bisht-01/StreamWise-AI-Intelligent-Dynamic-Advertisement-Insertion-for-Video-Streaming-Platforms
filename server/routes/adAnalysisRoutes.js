const express = require('express');

/** Mount at /api/videos  ->  GET /:id/analysis , POST /:id/analyze */
module.exports = function adAnalysisRoutes(adAnalysis) {
  const router = express.Router();

  router.get('/:id/analysis', async (req, res) => {
    const data = await adAnalysis.getAnalysis(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Video not found', data: null });
    res.json({ success: true, message: 'Analysis fetched successfully', data });
  });

  // Manual retry (e.g. after a failed run)
  router.post('/:id/analyze', async (req, res) => {
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
