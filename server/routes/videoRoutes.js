const express = require('express');
const multer = require('multer');
const path = require('path');
const videoController = require('../controllers/videoController');
const adInsertionController = require('../controllers/adInsertionController');
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
    if (['.jpg', '.jpeg', '.png', '.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(extension)) {
      return callback(null, true);
    }
    callback(new ApiError(400, 'Ad creative must be JPG, PNG, MP4, MOV, WebM, MKV, or AVI'));
  },
});

router.get('/', paginationValidators, videoController.getVideos);
router.get('/stats', videoController.getStats);
router.get('/:id', videoIdValidators, videoController.getVideo);
router.delete('/:id', videoIdValidators, deleteLimiter, videoController.deleteVideo);
router.post(
  '/upload',
  uploadLimiter,
  uploadVideoAssets,
  validateUploadedFiles,
  createVideoValidators,
  videoController.uploadVideo,
);
router.post(
  '/:id/ads',
  videoIdValidators,
  adCreativeUpload.single('creative'),
  adInsertionController.addAd,
);
router.delete(
  '/:id/ads/:adId',
  videoIdValidators,
  deleteLimiter,
  adInsertionController.removeAd,
);

module.exports = router;
