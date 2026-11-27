const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middlewares/requireAuth');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { ApiError } = require('../utils/ApiError');

const router = express.Router();
const credentialAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many unsuccessful attempts. Wait a few minutes and try again.', data: null },
});
router.post('/sign-up', credentialAttemptLimiter, authController.signUp);
router.post('/sign-in', credentialAttemptLimiter, authController.signIn);
router.post('/sign-out', requireAuth, authController.signOut);
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { data: profile, error } = await req.db.from('profiles').select('*').eq('id', req.user.id).single();
  if (error || !profile) throw new ApiError(404, 'Profile not found. Apply the personalization database migration.');
  res.json(ApiResponse.success('Account loaded', { user: req.user, profile }));
}));

module.exports = router;
