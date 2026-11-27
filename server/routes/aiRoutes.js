const express = require('express');
const aiController = require('../controllers/aiController');
const { requireAuth, requireAdmin } = require('../middlewares/requireAuth');

const router = express.Router();

router.post('/process', requireAuth, requireAdmin, aiController.processVideo);

module.exports = router;
