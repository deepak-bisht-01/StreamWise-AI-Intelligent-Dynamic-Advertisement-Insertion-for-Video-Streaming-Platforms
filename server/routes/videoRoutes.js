const express = require('express');
const multer = require('multer');
const path = require('path');
const videoController = require('../controllers/videoController');
const adInsertionController = require('../controllers/adInsertionController');
const { requireAuth, requireAdmin } = require('../middlewares/requireAuth');
const { ApiError } = require('../utils/ApiError');
const { uploadVideoAssets, validateUploadedFiles } = require('../middlewares/upload');
const { createVideoValidators, videoIdValidators, paginationValidators } = require('../middlewares/videoValidators');
const { uploadLimiter, deleteLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();
const adCreativeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(extension)) {
      return callback(null, true);
    }
    callback(new ApiError(400, 'Ad creative must be JPG, PNG, WebP, MP4, MOV, WebM, MKV, or AVI'));
  },
});

router.get('/admin', requireAuth, requireAdmin, paginationValidators, videoController.getAdminVideos);
router.get('/mine', requireAuth, videoController.getMyVideos);
router.get('/', requireAuth, paginationValidators, videoController.getVideos);
router.get('/stats', requireAuth, requireAdmin, videoController.getStats);
router.get('/:id', requireAuth, videoIdValidators, videoController.getVideo);
router.get('/:id/ads/:adId/file', requireAuth, videoIdValidators, adInsertionController.streamAdResult);
router.delete('/:id', requireAuth, requireAdmin, videoIdValidators, deleteLimiter, videoController.deleteVideo);
router.post(
  '/upload',
  requireAuth,
  uploadLimiter,
  uploadVideoAssets,
  validateUploadedFiles,
  createVideoValidators,
  videoController.uploadVideo,
);
router.post('/:id/ad-review', requireAuth, requireAdmin, videoIdValidators, videoController.selectVideoForAdReview);
router.patch('/:id/advertiser-priority', requireAuth, requireAdmin, videoIdValidators, videoController.setAdvertiserPriorityTier);
router.post(
  '/:id/ads',
  requireAuth,
  requireAdmin,
  videoIdValidators,
  adCreativeUpload.single('creative'),
  adInsertionController.addAd,
);
router.delete(
  '/:id/ads/:adId',
  requireAuth,
  requireAdmin,
  videoIdValidators,
  deleteLimiter,
  adInsertionController.removeAd,
);

router.post(
  '/:id/ads/:adId/approval',
  requireAuth,
  requireAdmin,
  videoIdValidators,
  adInsertionController.setAdApproval,
);

module.exports = router;
