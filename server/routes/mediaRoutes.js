const express = require('express');
const mediaController = require('../controllers/mediaController');

const router = express.Router();
router.get('/ad/:videoId/:adId', mediaController.streamAdResult);
router.get('/preview/:videoId', mediaController.streamAnalysisPreview);

module.exports = router;
