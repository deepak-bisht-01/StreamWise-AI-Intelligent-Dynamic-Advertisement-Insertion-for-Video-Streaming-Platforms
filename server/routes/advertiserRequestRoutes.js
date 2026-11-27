const express = require('express');
const multer = require('multer');
const path = require('path');
const controller = require('../controllers/advertiserRequestController');
const { requireAuth, requireAdmin } = require('../middlewares/requireAuth');
const { ApiError } = require('../utils/ApiError');

const router = express.Router();
const logoExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (logoExtensions.has(path.extname(file.originalname || '').toLowerCase())) return callback(null, true);
    callback(new ApiError(400, 'Brand logo must be JPG, PNG, or WebP'));
  },
});

router.use(requireAuth);
router.get('/rate-card', controller.getRateCard);
router.get('/inventory', controller.getInventory);
router.get('/admin', requireAdmin, controller.listRequests);
router.put('/rate-card', requireAdmin, controller.updateRateCard);
router.post('/', logoUpload.single('logo'), controller.createRequest);
router.post('/:id/quote', requireAdmin, controller.issueQuote);
router.post('/:id/payment', requireAdmin, controller.confirmPayment);
router.post('/:id/payment-reference', controller.submitPaymentReference);
router.post('/:id/reject', requireAdmin, controller.rejectRequest);
router.post('/:id/retry', requireAdmin, controller.retryRequest);
router.get('/:id/receipt', controller.getReceipt);
router.get('/:id', controller.getRequest);
router.get('/', controller.listRequests);

module.exports = router;
