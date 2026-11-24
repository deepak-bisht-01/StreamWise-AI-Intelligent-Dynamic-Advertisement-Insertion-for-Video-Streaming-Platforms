const express = require('express');
const aiController = require('../controllers/aiController');

const router = express.Router();

router.post('/process', aiController.processVideo);

module.exports = router;
