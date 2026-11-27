const express = require('express');
const multer = require('multer');
const path = require('path');
const brandController = require('../controllers/brandController');
const { requireAuth, requireAdmin } = require('../middlewares/requireAuth');
const { ApiError } = require('../utils/ApiError');

const router = express.Router();
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const creativeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (VIDEO_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension)) return callback(null, true);
    callback(new ApiError(400, 'Creative must be JPG, PNG, WebP, MP4, MOV, WebM, MKV, or AVI'));
  },
});

router.use(requireAuth, requireAdmin);
router.get('/ads', brandController.listCampaigns);
router.post('/ads', creativeUpload.single('creative'), brandController.createCampaign);
router.post('/ads/import', brandController.importCampaigns);
router.delete('/ads/:id', brandController.deleteCampaign);

module.exports = router;
